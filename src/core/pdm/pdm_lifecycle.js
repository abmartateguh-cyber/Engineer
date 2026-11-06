/**
 * OmniEng PDM Revision Lifecycle State Machine + Engineering Change Order (ECO) Workflow
 *
 * Implements Agent-37 scope:
 *  - Revision state machine: WIP -> IN_REVIEW -> RELEASED -> SUPERSEDED -> OBSOLETE
 *    with legal transitions enforced (the only backward transition in lifecycle rank
 *    is IN_REVIEW -> WIP).
 *  - ECO workflow: create ECO, attach item revisions, approve/reject, apply upon release.
 *  - Immutable cryptographic sealing: every item version carries a SHA-256 hash chain
 *    seal = sha256(prevSeal + canonical fields + status). Any tampering invalidates the chain.
 *  - Assembly revision propagation: releasing a parent assembly records its children's
 *    current revisions as a recursive effective BOM snapshot; later component releases
 *    never retroactively alter released assemblies, and modifying a released assembly
 *    is rejected.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

const crypto = require('node:crypto');

const STATES = Object.freeze({
  WIP: 'WIP',
  IN_REVIEW: 'IN_REVIEW',
  RELEASED: 'RELEASED',
  SUPERSEDED: 'SUPERSEDED',
  OBSOLETE: 'OBSOLETE'
});

const STATE_RANK = Object.freeze({
  WIP: 0,
  IN_REVIEW: 1,
  RELEASED: 2,
  SUPERSEDED: 3,
  OBSOLETE: 4
});

const TRANSITIONS = Object.freeze({
  WIP: Object.freeze([STATES.IN_REVIEW]),
  IN_REVIEW: Object.freeze([STATES.WIP, STATES.RELEASED]),
  RELEASED: Object.freeze([STATES.SUPERSEDED, STATES.OBSOLETE]),
  SUPERSEDED: Object.freeze([STATES.OBSOLETE]),
  OBSOLETE: Object.freeze([])
});

const ZERO_SEAL = '0'.repeat(64);

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Deterministic canonical serialization: object keys sorted lexicographically,
 * arrays order-sensitive, non-finite numbers rejected, -0 normalized to 0.
 */
function canonicalize(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('cannot canonicalize non-finite number');
    if (Object.is(value, -0)) return '0';
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (t === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  throw new TypeError(`cannot canonicalize value of type ${t}`);
}

/**
 * seal = sha256(prevSeal + canonical fields + status)
 */
function computeSeal(prevSeal, canonicalFields, status) {
  return sha256Hex(prevSeal + canonicalize(canonicalFields) + status);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

class PDMRevisionLifecycle {
  constructor() {
    this._items = new Map();
    this._history = new Map();
    this._ecos = new Map();
    this._ecoCounter = 0;
  }

  static get STATES() {
    return STATES;
  }

  static get TRANSITIONS() {
    return TRANSITIONS;
  }

  static get STATE_RANK() {
    return STATE_RANK;
  }

  _canonicalFields(record) {
    return {
      partNumber: record.partNumber,
      name: record.name,
      revision: record.revision,
      children: record.children,
      bomSnapshot: record.bomSnapshot
    };
  }

  _writeVersion(partNumber, mutate) {
    const prev = this._items.get(partNumber);
    if (!prev) throw new Error(`unknown part ${partNumber}`);
    const next = {
      partNumber: prev.partNumber,
      name: prev.name,
      revision: prev.revision,
      status: prev.status,
      children: (prev.children || []).map((c) => ({ ...c })),
      bomSnapshot: prev.bomSnapshot ? clone(prev.bomSnapshot) : null,
      prevSeal: prev.seal,
      seal: ''
    };
    mutate(next);
    next.seal = computeSeal(next.prevSeal, this._canonicalFields(next), next.status);
    this._history.get(partNumber).push(next);
    this._items.set(partNumber, next);
    return next;
  }

  /**
   * Creates an item at WIP. Child part references must already exist
   * (this also makes cyclic hierarchies impossible).
   */
  createItem({ partNumber, name, revision = 'A', children = [] }) {
    if (!isNonEmptyString(partNumber)) throw new TypeError('partNumber is required');
    if (this._items.has(partNumber)) throw new Error(`part ${partNumber} already exists`);
    if (!isNonEmptyString(name)) throw new TypeError('name is required');
    if (!isNonEmptyString(revision)) throw new TypeError('revision is required');
    if (!Array.isArray(children)) throw new TypeError('children must be an array');

    const normalized = [];
    const seen = new Set();
    for (const child of children) {
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        throw new TypeError('each child must be an object');
      }
      const childPN = child.partNumber;
      if (!isNonEmptyString(childPN)) throw new TypeError('child.partNumber is required');
      if (!this._items.has(childPN)) {
        throw new Error(`child part ${childPN} does not exist; create children first`);
      }
      if (seen.has(childPN)) throw new Error(`duplicate child part ${childPN}`);
      seen.add(childPN);
      const quantity = child.quantity === undefined ? 1 : child.quantity;
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new TypeError(`child quantity for ${childPN} must be a positive finite number`);
      }
      normalized.push({ partNumber: childPN, quantity });
    }

    const record = {
      partNumber,
      name,
      revision,
      status: STATES.WIP,
      children: normalized,
      bomSnapshot: null,
      prevSeal: ZERO_SEAL,
      seal: ''
    };
    record.seal = computeSeal(record.prevSeal, this._canonicalFields(record), record.status);
    this._history.set(partNumber, [record]);
    this._items.set(partNumber, record);
    return this.getItem(partNumber);
  }

  getItem(partNumber) {
    const record = this._items.get(partNumber);
    return record ? clone(record) : null;
  }

  getRawRecord(partNumber) {
    return this._items.get(partNumber) || null;
  }

  getHistory(partNumber) {
    const history = this._history.get(partNumber);
    return history ? history.map(clone) : [];
  }

  getBOMSnapshot(partNumber) {
    const record = this._items.get(partNumber);
    if (!record || !record.bomSnapshot) return [];
    return clone(record.bomSnapshot);
  }

  listItems() {
    return Array.from(this._items.keys());
  }

  /**
   * Core state machine transition. Enforces the legal transition table;
   * every version is sealed into the per-item SHA-256 hash chain.
   */
  transition(partNumber, toState) {
    const record = this._items.get(partNumber);
    if (!record) throw new Error(`unknown part ${partNumber}`);
    if (!TRANSITIONS[record.status].includes(toState)) {
      throw new Error(`illegal transition ${record.status} -> ${toState} for ${partNumber}`);
    }
    const next = this._writeVersion(partNumber, (v) => {
      v.status = toState;
    });
    return next.seal;
  }

  submitForReview(partNumber) {
    return this.transition(partNumber, STATES.IN_REVIEW);
  }

  returnToWIP(partNumber) {
    return this.transition(partNumber, STATES.WIP);
  }

  release(partNumber) {
    return this.transition(partNumber, STATES.RELEASED);
  }

  supersede(partNumber) {
    return this.transition(partNumber, STATES.SUPERSEDED);
  }

  obsolete(partNumber) {
    return this.transition(partNumber, STATES.OBSOLETE);
  }

  /**
   * Recursively captures the current effective BOM snapshot of an assembly:
   * each child's partNumber, quantity, revision, status and seal at this instant.
   */
  _buildSnapshot(partNumber, seen) {
    if (seen.has(partNumber)) throw new Error(`cycle detected in BOM snapshot at ${partNumber}`);
    seen.add(partNumber);
    const record = this._items.get(partNumber);
    if (!record) throw new Error(`unknown part ${partNumber} in BOM`);
    const snapshot = (record.children || []).map((child) => {
      const childRecord = this._items.get(child.partNumber);
      if (!childRecord) throw new Error(`unknown child ${child.partNumber} of ${partNumber}`);
      return {
        partNumber: child.partNumber,
        quantity: child.quantity,
        revision: childRecord.revision,
        status: childRecord.status,
        seal: childRecord.seal,
        children: this._buildSnapshot(child.partNumber, seen)
      };
    });
    seen.delete(partNumber);
    return snapshot;
  }

  createECO(options = {}) {
    const id = options.id || `eco-${++this._ecoCounter}`;
    if (this._ecos.has(id)) throw new Error(`ECO ${id} already exists`);
    const eco = {
      id,
      title: options.title || '',
      description: options.description || '',
      status: 'OPEN',
      items: [],
      approvals: []
    };
    this._ecos.set(id, eco);
    return this.getECO(id);
  }

  getECO(ecoId) {
    const eco = this._ecos.get(ecoId);
    return eco ? clone(eco) : null;
  }

  listECOs() {
    return Array.from(this._ecos.keys());
  }

  /**
   * Attaches an item revision to an open ECO. The item transitions WIP -> IN_REVIEW.
   * Only WIP items may be attached; released/superseded/obsolete items are frozen,
   * so modifying a released assembly is rejected here.
   */
  attachItemRevision(ecoId, partNumber, opts = {}) {
    const eco = this._ecos.get(ecoId);
    if (!eco) throw new Error(`unknown ECO ${ecoId}`);
    if (eco.status !== 'OPEN') throw new Error(`ECO ${ecoId} is ${eco.status}, not OPEN`);

    const record = this._items.get(partNumber);
    if (!record) throw new Error(`unknown part ${partNumber}`);
    if (record.status !== STATES.WIP) {
      throw new Error(`part ${partNumber} is ${record.status}; only WIP items may be attached for review`);
    }

    const toRevision = opts.toRevision;
    if (!isNonEmptyString(toRevision)) throw new TypeError('toRevision is required');
    if (toRevision === record.revision) throw new Error('toRevision must differ from current revision');

    for (const other of this._ecos.values()) {
      if (other.id === ecoId || other.status !== 'OPEN') continue;
      if (other.items.some((i) => i.partNumber === partNumber)) {
        throw new Error(`part ${partNumber} is already attached to ECO ${other.id}`);
      }
    }
    if (eco.items.some((i) => i.partNumber === partNumber)) {
      throw new Error(`part ${partNumber} is already attached to ECO ${ecoId}`);
    }

    const fromRevision = record.revision;
    this.transition(partNumber, STATES.IN_REVIEW);
    eco.items.push({ partNumber, fromRevision, toRevision });
    return this.getECO(ecoId);
  }

  approveECO(ecoId, reviewer = 'reviewer') {
    const eco = this._ecos.get(ecoId);
    if (!eco) throw new Error(`unknown ECO ${ecoId}`);
    if (eco.status !== 'OPEN') throw new Error(`ECO ${ecoId} is ${eco.status}, cannot approve`);
    if (eco.items.length === 0) throw new Error(`ECO ${ecoId} has no attached items`);
    eco.approvals.push({ reviewer, decision: 'APPROVED' });
    eco.status = 'APPROVED';
    return this.getECO(ecoId);
  }

  rejectECO(ecoId, reviewer = 'reviewer', reason = 'rejected') {
    const eco = this._ecos.get(ecoId);
    if (!eco) throw new Error(`unknown ECO ${ecoId}`);
    if (eco.status !== 'OPEN') throw new Error(`ECO ${ecoId} is ${eco.status}, cannot reject`);
    eco.approvals.push({ reviewer, decision: 'REJECTED', reason });
    eco.status = 'REJECTED';
    for (const item of eco.items) {
      const record = this._items.get(item.partNumber);
      if (record && record.status === STATES.IN_REVIEW) {
        this.transition(item.partNumber, STATES.WIP);
      }
    }
    return this.getECO(ecoId);
  }

  /**
   * Applies an APPROVED ECO: attached items transition IN_REVIEW -> RELEASED,
   * receive their target revision, and (when assemblies) record their recursive
   * effective BOM snapshot. Releasing a component never retroactively alters
   * released assemblies because snapshots are copies frozen at release time.
   */
  applyECO(ecoId) {
    const eco = this._ecos.get(ecoId);
    if (!eco) throw new Error(`unknown ECO ${ecoId}`);
    if (eco.status !== 'APPROVED') {
      throw new Error(`ECO ${ecoId} must be APPROVED before apply (status: ${eco.status})`);
    }
    for (const item of eco.items) {
      const record = this._items.get(item.partNumber);
      if (!record) throw new Error(`part ${item.partNumber} no longer exists`);
      if (record.status !== STATES.IN_REVIEW) {
        throw new Error(`part ${item.partNumber} is ${record.status}; expected IN_REVIEW`);
      }
    }
    for (const item of eco.items) {
      this._writeVersion(item.partNumber, (next) => {
        next.status = STATES.RELEASED;
        next.revision = item.toRevision;
        if (next.children.length > 0) {
          next.bomSnapshot = this._buildSnapshot(item.partNumber, new Set());
        }
      });
    }
    eco.status = 'APPLIED';
    return this.getECO(ecoId);
  }

  /**
   * Recomputes every sealed version in every item chain and validates linkage.
   * Returns { valid, entriesCount, problems, error }.
   */
  verifyChain() {
    const problems = [];
    let entriesCount = 0;
    for (const [partNumber, versions] of this._history) {
      if (!Array.isArray(versions) || versions.length === 0) {
        problems.push(`${partNumber}: empty history`);
        continue;
      }
      let expectedPrev = ZERO_SEAL;
      for (let idx = 0; idx < versions.length; idx++) {
        const v = versions[idx];
        entriesCount++;
        if (v.prevSeal !== expectedPrev) {
          problems.push(`${partNumber}#${idx}: prevSeal ${v.prevSeal} != expected ${expectedPrev}`);
          break;
        }
        const expectedSeal = computeSeal(v.prevSeal, this._canonicalFields(v), v.status);
        if (v.seal !== expectedSeal) {
          problems.push(`${partNumber}#${idx}: seal mismatch (record tampered)`);
        }
        expectedPrev = v.seal;
      }
      const current = this._items.get(partNumber);
      if (!current) {
        problems.push(`${partNumber}: missing current record`);
      } else if (current.seal !== versions[versions.length - 1].seal) {
        problems.push(`${partNumber}: current record seal out of sync with history`);
      }
    }
    return {
      valid: problems.length === 0,
      entriesCount,
      problems,
      error: problems.length > 0 ? problems[0] : null
    };
  }

  /**
   * Convenience tamper detection over verifyChain(). Returns
   * { tampered, tamperedRecords, details, valid }.
   */
  detectTamper() {
    const result = this.verifyChain();
    const tamperedRecords = [];
    const seenParts = new Set();
    for (const problem of result.problems) {
      const part = problem.split('#')[0];
      if (!seenParts.has(part)) {
        seenParts.add(part);
        tamperedRecords.push(part);
      }
    }
    return {
      tampered: !result.valid,
      valid: result.valid,
      tamperedRecords,
      details: result.problems
    };
  }
}

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PDMRevisionLifecycle,
    STATES,
    TRANSITIONS,
    STATE_RANK,
    ZERO_SEAL,
    canonicalize,
    computeSeal,
    sha256Hex
  };
}
if (typeof window !== 'undefined') {
  window.PDMRevisionLifecycle = PDMRevisionLifecycle;
}
