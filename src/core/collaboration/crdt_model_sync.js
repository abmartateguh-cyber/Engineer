'use strict';

/**
 * crdt_model_sync.js — state-based CRDT for concurrent CAD/assembly edit sync.
 * Battalion 9, Agent 85.
 *
 * Model: a grow-only map of per-entity records, i.e. an LWW-element-set
 * hybrid:
 *
 *   - The state is a map `elements` of records, one per entity key.
 *     A record is `{ key, value, timestamp, actor, removed }`.
 *   - Each applied op writes exactly one record whose key is
 *     `<componentId>:<opType>` (for addRelation, `<relationId>:addRelation`).
 *   - `addComponent` / `transformComponent` / `addRelation` write a live
 *     record (`removed: false`) carrying the op payload.
 *   - `deleteComponent` writes a tombstone record (`removed: true`).
 *     A component is logically present iff its `addComponent` record exists
 *     and dominates (see ordering rule) its `deleteComponent` record.
 *
 * Ordering rule (documented, deterministic):
 *   Records are totally ordered by the lexicographic pair
 *   `(timestamp, actor)`. `timestamp` is a Lamport-style logical clock
 *   counter: each replica's per-actor counter in its version vector,
 *   bumped on every local apply. Two records are causally ordered when one
 *   carries a strictly larger timestamp (vector-clock ordering for
 *   causally related ops). Concurrent writes to the same key are resolved
 *   by the `(timestamp, actor)` lexicographic tie-break — a larger
 *   timestamp wins; on equal timestamps (truly concurrent) the
 *   lexicographically larger actor id wins. This makes `merge` convergent,
 *   commutative, idempotent and associative (per-key max under a total
 *   order).
 *
 * Sync surface:
 *   - `applyLocal(op)`   — record a local op, bump local vector clock.
 *   - `merge(other)`     — monotonic state merge (element-wise max).
 *   - `snapshot()`       — canonical, deterministic full state (for sync
 *                          checksums and deep-equality).
 *   - `digest()`         — stable FNV-1a hash of the canonical snapshot.
 *   - `diff(other)`      — minimal record set this replica holds that
 *                          `other` is missing or has dominated by.
 *
 * Dependency-free, deterministic, CommonJS.
 */

const OP_TYPES = new Set(['addComponent', 'transformComponent', 'deleteComponent', 'addRelation']);

/* FNV-1a 64-bit (BigInt-based), deterministic and dependency-free. */
function fnv1a64(input) {
  let hash = BigInt('0xcbf29ce484222325');
  const prime = BigInt('0x100000001b3');
  const mask = BigInt('0xffffffffffffffff');
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

/* (timestamp, actor) lexicographic total order. Negative: a < b. */
function compareRecords(a, b) {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  if (a.actor < b.actor) return -1;
  if (a.actor > b.actor) return 1;
  return 0;
}

function isRecordDominant(a, b) {
  if (b === undefined || b === null) return true;
  return compareRecords(a, b) > 0;
}

class CrdtModelSync {
  /**
   * @param {Object} [options]
   * @param {string} [options.actor='anon'] - this replica's unique id
   */
  constructor(options = {}) {
    this.actor = String(options.actor || 'anon');
    /** @type {Map<string, {key:string,value:*,timestamp:number,actor:string,removed:boolean}>} */
    this._elements = new Map();
    /** @type {Object<string, number>} version vector: actor -> max counter seen */
    this._versionVector = {};
  }

  /**
   * Current logical-clock counter for this replica.
   * @returns {number}
   */
  get _clock() {
    return this._versionVector[this.actor] || 0;
  }

  _bumpClock() {
    const next = this._clock + 1;
    this._versionVector[this.actor] = next;
    return next;
  }

  /**
   * Apply a local op. Each op writes one CRDT element with key
   * `componentId + ":" + opType`.
   *
   * @param {Object} op
   * @param {string} op.op - 'addComponent'|'transformComponent'|'deleteComponent'|'addRelation'
   * @param {string} op.componentId - component (or relation) id
   * @param {*} [op.value] - payload (required for non-delete ops)
   * @returns {CrdtModelSync} this
   */
  applyLocal(op) {
    if (!op || typeof op !== 'object') {
      throw new TypeError('crdt.applyLocal: op must be an object');
    }
    if (!OP_TYPES.has(op.op)) {
      throw new TypeError(`crdt.applyLocal: unknown op "${op.op}"`);
    }
    if (typeof op.componentId !== 'string' || op.componentId.length === 0) {
      throw new TypeError('crdt.applyLocal: componentId must be a non-empty string');
    }
    if (op.op !== 'deleteComponent' && op.value === undefined) {
      throw new TypeError(`crdt.applyLocal: "${op.op}" requires a value`);
    }
    const timestamp = this._bumpClock();
    const record = {
      key: `${op.componentId}:${op.op}`,
      value: op.op === 'deleteComponent' ? null : clone(op.value),
      timestamp,
      actor: this.actor,
      removed: op.op === 'deleteComponent'
    };
    this._elements.set(record.key, record);
    return this;
  }

  /**
   * Merge another replica's state into this one. Monotonic, deterministic,
   * commutative and idempotent: per key keep the dominating record under
   * the (timestamp, actor) order; version vector takes element-wise max.
   *
   * @param {CrdtModelSync} other
   * @returns {CrdtModelSync} this
   */
  merge(other) {
    if (!(other instanceof CrdtModelSync)) {
      throw new TypeError('crdt.merge: other must be a CrdtModelSync');
    }
    for (const [key, record] of other._elements) {
      const current = this._elements.get(key);
      if (isRecordDominant(record, current)) {
        this._elements.set(key, {
          key,
          value: clone(record.value),
          timestamp: record.timestamp,
          actor: record.actor,
          removed: record.removed
        });
      }
    }
    for (const [actor, counter] of Object.entries(other._versionVector)) {
      const seen = this._versionVector[actor] || 0;
      if (counter > seen) this._versionVector[actor] = counter;
    }
    return this;
  }

  /**
   * True if the component is logically present: addComponent record exists
   * and dominates the deleteComponent tombstone (if any).
   *
   * @param {string} componentId
   * @returns {boolean}
   */
  hasComponent(componentId) {
    const added = this._elements.get(`${componentId}:addComponent`);
    if (!added) return false;
    const tombstone = this._elements.get(`${componentId}:deleteComponent`);
    if (!tombstone) return true;
    return compareRecords(added, tombstone) > 0;
  }

  /**
   * List of logically present component ids, sorted for determinism.
   * @returns {string[]}
   */
  componentIds() {
    const ids = [];
    for (const [key, record] of this._elements) {
      if (
        !record.removed &&
        key.endsWith(':addComponent') &&
        this.hasComponent(key.slice(0, -':addComponent'.length))
      ) {
        ids.push(key.slice(0, -':addComponent'.length));
      }
    }
    return ids.sort();
  }

  /**
   * Canonical, deterministic full-state snapshot: elements sorted by key,
   * version-vector actors sorted.
   *
   * @returns {Object}
   */
  snapshot() {
    const elements = {};
    const keys = [...this._elements.keys()].sort();
    for (const key of keys) {
      const record = this._elements.get(key);
      elements[key] = {
        key: record.key,
        value: record.value === undefined ? undefined : clone(record.value),
        timestamp: record.timestamp,
        actor: record.actor,
        removed: record.removed
      };
    }
    const versionVector = {};
    for (const actor of Object.keys(this._versionVector).sort()) {
      versionVector[actor] = this._versionVector[actor];
    }
    return { elements, versionVector };
  }

  /**
   * Stable digest of the canonical snapshot (FNV-1a 64-bit hex).
   * @returns {string}
   */
  digest() {
    return fnv1a64(JSON.stringify(this.snapshot()));
  }

  /**
   * Incremental sync: records this replica holds that `other` is missing
   * or that dominate `other`'s record for the same key.
   *
   * @param {CrdtModelSync} other
   * @returns {Array<{key:string,value:*,timestamp:number,actor:string,removed:boolean}>}
   */
  diff(other) {
    if (!(other instanceof CrdtModelSync)) {
      throw new TypeError('crdt.diff: other must be a CrdtModelSync');
    }
    const out = [];
    for (const [key, record] of this._elements) {
      const current = other._elements.get(key);
      if (isRecordDominant(record, current)) {
        out.push({
          key,
          value: record.value === undefined ? undefined : clone(record.value),
          timestamp: record.timestamp,
          actor: record.actor,
          removed: record.removed
        });
      }
    }
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return out;
  }

  /**
   * Apply a diff batch produced by `diff` (state-based transfer).
   * @param {Array} batch
   * @returns {CrdtModelSync} this
   */
  applyDiff(batch) {
    if (!Array.isArray(batch)) {
      throw new TypeError('crdt.applyDiff: batch must be an array');
    }
    const carrier = new CrdtModelSync({ actor: '__diff_carrier__' });
    for (const record of batch) {
      if (!record || typeof record.key !== 'string') {
        throw new TypeError('crdt.applyDiff: malformed record');
      }
      carrier._elements.set(record.key, {
        key: record.key,
        value: clone(record.value),
        timestamp: record.timestamp,
        actor: record.actor,
        removed: !!record.removed
      });
      const seen = carrier._versionVector[record.actor] || 0;
      if (record.timestamp > seen) carrier._versionVector[record.actor] = record.timestamp;
    }
    return this.merge(carrier);
  }
}

module.exports = {
  CrdtModelSync,
  compareRecords,
  OP_TYPES
};
