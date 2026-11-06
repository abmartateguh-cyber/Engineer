/**
 * OmniEng Persistent Topological Naming Engine
 *
 * Experimental attempt to track topological entities across feature changes:
 * 1. Semantic geometric fingerprinting for faces, edges, and vertices based on history ancestry.
 * 2. Stable naming graphs surviving upstream sketch alterations, extrusions, cuts, and patterns.
 * 3. Topological mutation tracking mapping parent entities to split, merged, or modified children.
 * 4. Automatic downstream feature re-attachment for fillets, chamfers, and assembly mates.
 *
 * Naming stability has not been benchmarked against independently prepared edit sequences or
 * compared with commercial CAD systems.
 *
 * Additionally implements an Euler-operator-style topological history log. Every topological
 * operation (create, split, merge, delete, modify) appends a history entry carrying the
 * affected entity ids, a monotonic generation counter, and the parent (lineage) ids.
 * The history is queryable via getHistory(), getCurrentGeneration(), and traceEntity().
 */

'use strict';

class PersistentNamingManager {
  constructor() {
    this.entityRegistry = new Map(); // UUID / Tag -> Entity descriptor
    this.historyGraph = []; // Array of feature modification operations (legacy)
    this.topologyHistory = []; // Euler-operator-style topological history log
    this._generation = 0; // Monotonic generation counter
    this._opCounter = 0; // Monotonic operation sequence counter
    this._keyToEntity = new Map(); // Geometry key -> { tag, entityType } (topology identity)
  }

  // ------------------------------------------------------------------
  // Topology-aware geometric keys
  // ------------------------------------------------------------------

  static _coordStr(v) {
    const n = Number(v) || 0;
    const r = Math.abs(n) < 5e-4 ? 0 : n;
    return r.toFixed(3);
  }

  static _comp3(obj, i) {
    if (obj == null) return 0;
    if (typeof obj === 'object' && 'x' in obj && obj.x !== undefined) {
      return i === 0 ? obj.x : i === 1 ? obj.y : obj.z;
    }
    const arr = Array.isArray(obj) ? obj : [obj.x, obj.y, obj.z];
    return Number(arr[i]) || 0;
  }

  static _keyString3(pt) {
    return `(${PersistentNamingManager._coordStr(PersistentNamingManager._comp3(pt, 0))},${PersistentNamingManager._coordStr(
      PersistentNamingManager._comp3(pt, 1)
    )},${PersistentNamingManager._coordStr(PersistentNamingManager._comp3(pt, 2))})`;
  }

  /**
   * Deterministic short digest (djb2-xor) for geometry keys -> compact tag suffix.
   * @param {string} str
   * @returns {string} 8 hex chars
   */
  static _digest(str) {
    let h = 5381;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  /**
   * Computes a canonical geometric key for a topological entity from actual geometry.
   * - VERTEX: rounded coordinates
   * - EDGE: canonicalized endpoints + midpoint
   * - FACE: centroid + normal + area
   * @param {string} entityType 'VERTEX' | 'EDGE' | 'FACE'
   * @param {Object} attributes
   * @returns {string|null} canonical geometry key (null if insufficient data)
   */
  static computeGeometryKey(entityType = 'FACE', attributes = {}) {
    const type = String(entityType).toUpperCase();
    const a = attributes || {};
    if (type === 'VERTEX') {
      const pt = a.point || a.coords || a;
      if (!pt) return null;
      return `V:${PersistentNamingManager._keyString3(pt)}`;
    }
    if (type === 'EDGE') {
      const s = a.start || a.a;
      const e = a.end || a.b;
      if (!s || !e) return null;
      const ks = PersistentNamingManager._keyString3(s);
      const ke = PersistentNamingManager._keyString3(e);
      const [lo, hi] = ks <= ke ? [ks, ke] : [ke, ks];
      const mx = (PersistentNamingManager._comp3(s, 0) + PersistentNamingManager._comp3(e, 0)) / 2;
      const my = (PersistentNamingManager._comp3(s, 1) + PersistentNamingManager._comp3(e, 1)) / 2;
      const mz = (PersistentNamingManager._comp3(s, 2) + PersistentNamingManager._comp3(e, 2)) / 2;
      return `E:${lo}|(${PersistentNamingManager._coordStr(mx)},${PersistentNamingManager._coordStr(my)},${PersistentNamingManager._coordStr(mz)})|${hi}`;
    }
    const c = a.centroid || { x: 0, y: 0, z: 0 };
    const n = a.normal || { x: 0, y: 0, z: 1 };
    const area = Number(a.area) || 0;
    return `F:c=(${PersistentNamingManager._coordStr(PersistentNamingManager._comp3(c, 0))},${PersistentNamingManager._coordStr(
      PersistentNamingManager._comp3(c, 1)
    )},${PersistentNamingManager._coordStr(PersistentNamingManager._comp3(c, 2))});n=(${PersistentNamingManager._coordStr(
      PersistentNamingManager._comp3(n, 0)
    )},${PersistentNamingManager._coordStr(PersistentNamingManager._comp3(n, 1))},${PersistentNamingManager._coordStr(
      PersistentNamingManager._comp3(n, 2)
    )});a=${PersistentNamingManager._coordStr(area)}`;
  }

  static _entityTypeFromKey(key) {
    const c = String(key).charAt(0);
    if (c === 'V') return 'VERTEX';
    if (c === 'E') return 'EDGE';
    return 'FACE';
  }

  _resolveOrCreateByKey(key, opts = {}) {
    if (this._keyToEntity.has(key)) {
      const rec = this._keyToEntity.get(key);
      return { tag: rec.tag, created: false };
    }
    const entityType = PersistentNamingManager._entityTypeFromKey(key);
    const tag = opts.tag || `${key.charAt(0)}:${PersistentNamingManager._digest(key)}`;
    this.entityRegistry.set(tag, {
      featureId: 'TopoOwner',
      entityType,
      localIndex: 0,
      attributes: { geometryKey: key },
      alive: true,
      geometryKey: key
    });
    this._keyToEntity.set(key, { tag, entityType });
    this.recordOperation('CREATE', {
      entityIds: [tag],
      resultIds: [tag],
      details: { geometryKey: key }
    });
    return { tag, created: true };
  }

  /**
   * Registers / reuses an entity purely by its geometric key.
   * Same coordinates -> same tag (geometry-key identity across re-evaluation).
   * @param {string} entityType
   * @param {Object} attributes
   * @returns {Object} { tag, key, created }
   */
  getOrCreateEntityByGeometry(entityType, attributes = {}) {
    const key = PersistentNamingManager.computeGeometryKey(entityType, attributes);
    if (!key) return { tag: null, key: null, created: false };
    const res = this._resolveOrCreateByKey(key);
    return { tag: res.tag, key, created: res.created };
  }

  /**
   * Looks up an existing entity by geometry key without creating anything.
   * @param {string} entityType
   * @param {Object} attributes
   * @returns {Object} { tag, key, found }
   */
  getEntityByGeometry(entityType, attributes = {}) {
    const key = PersistentNamingManager.computeGeometryKey(entityType, attributes);
    if (!key) return { tag: null, key: null, found: false };
    const rec = this._keyToEntity.get(key);
    return { tag: rec ? rec.tag : null, key, found: Boolean(rec) };
  }

  /**
   * Assigns stable topological child ids from parent geometry keys and child keys,
   * recording the split/merge derivation in the topological history log.
   * @param {Array<string|Object>} beforeKeys Parent geometric keys (or {entityType, attributes})
   * @param {Array<string|Object>} afterKeys Child geometric keys (or {entityType, attributes})
   * @returns {Object} { op, parentTags, childTags }
   */
  registerTopologicalEntities(beforeKeys = [], afterKeys = []) {
    const normKey = (k) => {
      if (k == null) return null;
      if (typeof k === 'string') return k;
      return PersistentNamingManager.computeGeometryKey(k.entityType || 'FACE', k.attributes || k);
    };

    const parents = [];
    for (const k of beforeKeys) {
      const key = normKey(k);
      if (!key) continue;
      const rec = this._keyToEntity.get(key);
      parents.push(rec ? rec.tag : null);
    }

    const parentKey = normKey(beforeKeys[0]);
    const children = [];
    for (let i = 0; i < afterKeys.length; i++) {
      const key = normKey(afterKeys[i]);
      if (!key) continue;
      if (this._keyToEntity.has(key)) {
        children.push(this._keyToEntity.get(key).tag);
        continue;
      }
      const letter = key.charAt(0);
      const tag =
        parents.length === 1 && parentKey
          ? `${letter}:${PersistentNamingManager._digest(parentKey)}:${i}`
          : `${letter}:${PersistentNamingManager._digest(key)}`;
      const res = this._resolveOrCreateByKey(key, { tag });
      children.push(res.tag);
    }

    const parentTags = parents.filter(Boolean);
    let op = 'MODIFY';
    if (parentTags.length === 0) op = 'CREATE';
    else if (parentTags.length === 1 && children.length > 1) op = 'SPLIT';
    else if (parentTags.length > 1 && children.length === 1) op = 'MERGE';

    const entry = {
      op,
      entityIds: parentTags,
      lineage: parentTags,
      resultIds: children,
      details: { afterKeys }
    };

    if (op === 'SPLIT') {
      if (parentTags.length === 1) {
        const d = this.entityRegistry.get(parentTags[0]);
        if (d) d.alive = false;
      }
    } else if (op === 'MERGE') {
      for (const p of parentTags) {
        const d = this.entityRegistry.get(p);
        if (d) d.alive = false;
      }
    }
    this.recordOperation(entry.op, entry);
    return { op, parentTags, childTags: children };
  }

  /**
   * Generates a stable semantic tag for a topological face or edge
   * @param {string} featureId - e.g. 'Extrude1', 'Fillet2'
   * @param {string} entityType - 'FACE', 'EDGE', 'VERTEX'
   * @param {number} localIndex - Index within the feature
   * @param {Object} [geometryAttributes] - { normal, centroid, length, area }
   * @returns {string} Deterministic persistent tag
   */
  generateTag(featureId, entityType, localIndex, geometryAttributes = {}) {
    const norm = geometryAttributes.normal || { x: 0, y: 0, z: 1 };
    const normHash = `${norm.x.toFixed(2)}_${norm.y.toFixed(2)}_${norm.z.toFixed(2)}`;
    const tag = `${featureId}:${entityType}:${localIndex}@(${normHash})`;

    this.entityRegistry.set(tag, {
      featureId,
      entityType,
      localIndex,
      attributes: geometryAttributes,
      alive: true
    });

    return tag;
  }

  /**
   * Records a feature re-evaluation step and maps topological mutations
   * @param {string} opName
   * @param {Array<Object>} mutations - Array of { parentTag, childTags, action: 'SPLIT'|'MERGE'|'MODIFY'|'DELETE' }
   */
  recordMutation(opName, mutations = []) {
    this.historyGraph.push({ opName, mutations, timestamp: Date.now() });

    for (const m of mutations) {
      if (m.action === 'DELETE' && this.entityRegistry.has(m.parentTag)) {
        this.entityRegistry.get(m.parentTag).alive = false;
      }
    }
  }

  /**
   * Appends an Euler-operator-style topological history entry.
   * @param {string} op - 'CREATE' | 'SPLIT' | 'MERGE' | 'DELETE' | 'MODIFY' | custom
   * @param {Object} options
   *   entityIds: array of entity ids involved in the operation (operands)
   *   lineage: array of parent entity ids (optional)
   *   resultIds: array of entity ids created by the operation (optional)
   *   details: arbitrary metadata (optional)
   * @returns {Object} The appended history entry
   */
  recordOperation(op, options = {}) {
    const entry = {
      op,
      opId: ++this._opCounter,
      generation: ++this._generation,
      entityIds: Array.isArray(options.entityIds) ? [...options.entityIds] : [],
      lineage: Array.isArray(options.lineage) ? [...options.lineage] : [],
      resultIds: Array.isArray(options.resultIds) ? [...options.resultIds] : [],
      details: options.details || {},
      timestamp: Date.now()
    };
    this.topologyHistory.push(entry);
    return entry;
  }

  /**
   * Registers a new entity and records a CREATE operation.
   * @param {string} tag
   * @param {Object} [attributes]
   * @returns {string} tag
   */
  createEntity(tag, attributes = {}) {
    if (!this.entityRegistry.has(tag)) {
      this.entityRegistry.set(tag, {
        featureId: attributes.originatingFeatureId || 'Feature1',
        entityType: attributes.entityType || 'FACE',
        localIndex: attributes.localIndex || 0,
        attributes,
        alive: true
      });
    }
    this.recordOperation('CREATE', { entityIds: [tag], resultIds: [tag], details: { attributes } });
    return tag;
  }

  /**
   * Splits an entity into child entities (Euler split) and records a SPLIT operation.
   * @param {string} parentTag
   * @param {Array<string>} childTags
   */
  splitEntity(parentTag, childTags) {
    const children = Array.isArray(childTags) ? childTags : [childTags];
    for (const child of children) {
      if (!this.entityRegistry.has(child)) {
        this.entityRegistry.set(child, {
          featureId: 'Split',
          entityType: 'FACE',
          localIndex: 0,
          attributes: {},
          alive: true
        });
      }
    }
    if (this.entityRegistry.has(parentTag)) {
      this.entityRegistry.get(parentTag).alive = false;
    }
    this.recordOperation('SPLIT', {
      entityIds: [parentTag],
      lineage: [parentTag],
      resultIds: children,
      details: { children }
    });
    return children;
  }

  /**
   * Merges several entities into one (Euler merge) and records a MERGE operation.
   * @param {Array<string>} tags
   * @param {string} resultTag
   */
  mergeEntities(tags, resultTag) {
    const parents = Array.isArray(tags) ? tags : [tags];
    for (const p of parents) {
      if (this.entityRegistry.has(p)) {
        this.entityRegistry.get(p).alive = false;
      }
    }
    if (!this.entityRegistry.has(resultTag)) {
      this.entityRegistry.set(resultTag, {
        featureId: 'Merge',
        entityType: 'FACE',
        localIndex: 0,
        attributes: {},
        alive: true
      });
    }
    this.recordOperation('MERGE', {
      entityIds: parents,
      lineage: parents,
      resultIds: [resultTag],
      details: { resultTag }
    });
    return resultTag;
  }

  /**
   * Deletes an entity and records a DELETE operation.
   * @param {string} tag
   */
  deleteEntity(tag) {
    if (this.entityRegistry.has(tag)) {
      this.entityRegistry.get(tag).alive = false;
    }
    this.recordOperation('DELETE', { entityIds: [tag], lineage: [tag] });
    return tag;
  }

  /**
   * Modifies an entity's attributes and records a MODIFY operation.
   * @param {string} tag
   * @param {Object} attributes
   */
  modifyEntity(tag, attributes = {}) {
    if (this.entityRegistry.has(tag)) {
      const desc = this.entityRegistry.get(tag);
      desc.attributes = { ...desc.attributes, ...attributes };
    }
    this.recordOperation('MODIFY', { entityIds: [tag], lineage: [tag], details: { attributes } });
    return tag;
  }

  /**
   * Returns a copy of the full topological history log.
   * @returns {Array<Object>}
   */
  getHistory() {
    return this.topologyHistory.map((e) => ({ ...e, entityIds: [...e.entityIds], lineage: [...e.lineage], resultIds: [...e.resultIds] }));
  }

  /**
   * Returns the current generation counter (number of recorded operations).
   * @returns {number}
   */
  getCurrentGeneration() {
    return this._generation;
  }

  /**
   * Traces an entity through the topological history: returns the history entries
   * that involve it, its transitive ancestor lineage chain, and its final alive state.
   * @param {string} id
   * @returns {Object} { id, alive, currentTag, generation, entries, ancestors }
   */
  traceEntity(id) {
    const entries = [];
    const ancestors = [];
    const seenAncestors = new Set();

    for (const entry of this.topologyHistory) {
      const involves =
        entry.entityIds.includes(id) || entry.resultIds.includes(id) || entry.lineage.includes(id);
      if (!involves) continue;
      entries.push(entry);
    }

    // Transitive ancestor closure: follow creation edges (resultIds -> lineage)
    const stack = [id];
    const visited = new Set();
    while (stack.length > 0) {
      const cur = stack.pop();
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const entry of this.topologyHistory) {
        if (!entry.resultIds.includes(cur)) continue;
        for (const parent of entry.lineage) {
          if (parent === cur) continue;
          if (!seenAncestors.has(parent)) {
            seenAncestors.add(parent);
            ancestors.push(parent);
            stack.push(parent);
          }
        }
      }
    }

    const desc = this.entityRegistry.get(id);
    const alive = desc ? desc.alive : false;
    const generation = entries.length > 0 ? entries[entries.length - 1].generation : 0;

    return {
      id,
      alive,
      currentTag: alive ? id : entries.length > 0 ? entries[entries.length - 1].resultIds[0] || null : null,
      generation,
      entries,
      ancestors
    };
  }

  /**
   * Resolves a target tag after upstream parametric edits
   * @param {string} queryTag
   * @returns {Object} Resolution result with matching entities
   */
  resolveTag(queryTag) {
    if (this._keyToEntity.has(queryTag)) {
      const rec = this._keyToEntity.get(queryTag);
      const desc = this.entityRegistry.get(rec.tag);
      if (desc && desc.alive) {
        return { resolved: true, activeTag: rec.tag, entity: desc, geometryKeyResolved: true };
      }
    }

    if (this.entityRegistry.has(queryTag) && this.entityRegistry.get(queryTag).alive) {
      return { resolved: true, activeTag: queryTag, entity: this.entityRegistry.get(queryTag) };
    }

    // Traverse mutation graph to find surviving children or descendants
    let currentTag = queryTag;
    for (const step of this.historyGraph) {
      for (const m of step.mutations) {
        if (m.parentTag === currentTag) {
          if (m.childTags && m.childTags.length > 0) {
            currentTag = m.childTags[0];
          }
        }
      }
    }

    if (this.entityRegistry.has(currentTag) && this.entityRegistry.get(currentTag).alive) {
      return { resolved: true, activeTag: currentTag, entity: this.entityRegistry.get(currentTag), remapped: true };
    }

    return { resolved: false, activeTag: null, remapped: false };
  }

  registerEntity(entityType, attributes = {}) {
    const feat = attributes.originatingFeatureId || 'Feature1';
    const tag = this.generateTag(feat, entityType, this.entityRegistry.size, attributes);
    return {
      persistentId: tag,
      entityType,
      attributes
    };
  }

  resolveEntity(persistentId, candidates = []) {
    const tagRes = this.resolveTag(persistentId);
    let bestMatch = null;
    let highestSim = 0.0;

    const queryDesc = this.entityRegistry.get(persistentId);
    const qAttrs = (queryDesc && queryDesc.attributes) || {};

    for (const cand of candidates) {
      let sim = 0.0;
      if (cand.geometryType && qAttrs.geometryType && cand.geometryType === qAttrs.geometryType) sim += 0.4;
      if (cand.area && qAttrs.area && Math.abs(cand.area - qAttrs.area) / qAttrs.area < 0.1) sim += 0.3;
      if (cand.centroid && qAttrs.centroid) {
        const dx = cand.centroid.x - qAttrs.centroid.x;
        const dy = cand.centroid.y - qAttrs.centroid.y;
        const dz = cand.centroid.z - qAttrs.centroid.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        sim += Math.max(0.0, 0.3 * (1.0 - dist / 50.0));
      }
      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = cand;
      }
    }

    return {
      matchFound: highestSim >= 0.5 || tagRes.resolved,
      similarityScore: Math.max(highestSim, tagRes.resolved ? 0.95 : 0.0),
      matchedEntity: bestMatch
    };
  }
}

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PersistentNamingManager };
}
if (typeof window !== 'undefined') {
  window.PersistentNamingManager = PersistentNamingManager;
}
