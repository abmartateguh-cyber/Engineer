'use strict';

/**
 * FeatureDAGEngine: parametric feature tree with persistent topological naming.
 *
 * A feature DAG where each feature produces named faces/edges/vertices.
 * Feeding re-identification maps old names to new names after a rebuild by
 * matching geometry to the previous title (centroid proximity, adjacency to
 * named neighbors, edge-length matching). Suppression marks consumers dirty;
 * re-enabling them rebuilds and re-resolves.
 *
 * The solid model is intentionally lightweight (planar polygon faces + edges)
 * — enough to exercise naming stability, suppression/reorder, and downstream
 * reference retention without a full B-Rep kernel.
 */

'use strict';

class FeatureDAGEngine {
  constructor() {
    this.features = new Map(); // id -> feature record
    this.dependencies = new Map(); // featureId -> Set(childIds)
    this.topology = new Map(); // featureId -> {faces: Map(name -> face), edges: Map(name -> edge)}
    this._nextSeq = 1;
  }

  _seq() {
    return this._nextSeq++;
  }

  /**
   * Add a feature. kind: 'sketch' | 'extrude' | 'boss' | 'fillet' | 'hole' | 'cut'
   * params: {w,h,r,depth,...}; parent: feature id or null.
   */
  addFeature(id, kind, params = {}, parent = null) {
    if (this.features.has(id)) throw new Error(`Feature '${id}' already exists.`);
    const record = { id, kind, params: { ...params }, parent, seq: this._seq(), suppressed: false, dirty: false };
    this.features.set(id, record);
    if (parent) {
      if (!this.features.has(parent)) throw new Error(`Parent feature '${parent}' not found.`);
      if (!this.dependencies.has(parent)) this.dependencies.set(parent, new Set());
      this.dependencies.get(parent).add(id);
    }
    this._build(id);
    if (parent) {
      record._parentRef = { parentId: parent, refName: this._pickRefName(parent) };
    }
    return record;
  }

  /**
   * Generate the topological faces/edges for a feature from its params, with
   * names derived from kind + role + index. Faces are planar polygons (CCW
   * in the XY projection) with a centroid and normal; edges are segments.
   */
  _generateGeometry(kind, params) {
    const faces = new Map();
    const edges = new Map();
    const w = params.w || 10;
    const h = params.h || 10;
    const depth = params.depth || 5;
    const r = params.r || 2;

    if (kind === 'sketch' || kind === 'extrude' || kind === 'boss' || kind === 'cut') {
      // base: a box with w x h footprint, depth tall
      const z0 = 0;
      const z1 = depth;
      const side = (name, pts) => {
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        faces.set(name, { centroid: [cx, cy, (pts[0][2] + pts[1][2]) / 2], pts });
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          edges.set(`${name}.E${i}`, { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) });
        }
      };
      side('Bottom', [
        [0, 0, z0],
        [w, 0, z0],
        [w, h, z0],
        [0, h, z0]
      ]);
      side('Top', [
        [0, 0, z1],
        [w, 0, z1],
        [w, h, z1],
        [0, h, z1]
      ]);
      side('Front', [
        [0, 0, z0],
        [w, 0, z0],
        [w, 0, z1],
        [0, 0, z1]
      ]);
      side('Back', [
        [0, h, z0],
        [w, h, z0],
        [w, h, z1],
        [0, h, z1]
      ]);
      side('Left', [
        [0, 0, z0],
        [0, h, z0],
        [0, h, z1],
        [0, 0, z1]
      ]);
      side('Right', [
        [w, 0, z0],
        [w, h, z0],
        [w, h, z1],
        [w, 0, z1]
      ]);
    } else if (kind === 'fillet') {
      // fillet: an arc edge approximation on the top face corner
      const cx = params.cx !== undefined ? params.cx : w / 2;
      const cy = params.cy !== undefined ? params.cy : h / 2;
      const pts = [];
      const N = 8;
      for (let i = 0; i <= N; i++) {
        const a = (Math.PI / 2) * (1 - i / N);
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), depth]);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        edges.set(`Fillet.E${i}`, {
          a: pts[i],
          b: pts[i + 1],
          len: Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        });
      }
      faces.set('FilletFace', { centroid: [cx + r * 0.5, cy + r * 0.5, depth], pts });
    }
    return { faces, edges };
  }

  _build(id) {
    const record = this.features.get(id);
    const { faces, edges } = this._generateGeometry(record.kind, record.params);
    this.topology.set(id, { faces, edges });
    record.dirty = false;
  }

  /**
   * Edit a feature's parameters (e.g., sketch width/diameter), rebuild it, and
   * re-map downstream names through the DAG.
   */
  editFeature(id, params) {
    const record = this.features.get(id);
    if (!record) throw new Error(`Feature '${id}' not found.`);
    if (record.suppressed) throw new Error(`Feature '${id}' is suppressed.`);
    const old = this.topology.get(id);
    record.params = { ...record.params, ...params };
    this._build(id);
    const neu = this.topology.get(id);
    // re-map names: match old faces/edges to new by centroid/edge-length proximity
    const remap = new Map();
    for (const [oldName, oldFace] of old.faces) {
      let best = null;
      let bestScore = Infinity;
      for (const [newName, newFace] of neu.faces) {
        const d = Math.hypot(
          newFace.centroid[0] - oldFace.centroid[0],
          newFace.centroid[1] - oldFace.centroid[1],
          newFace.centroid[2] - oldFace.centroid[2]
        );
        if (d < bestScore) {
          bestScore = d;
          best = newName;
        }
      }
      if (best) remap.set(oldName, best);
    }
    for (const [oldName, oldEdge] of old.edges) {
      let best = null;
      let bestScore = Infinity;
      for (const [newName, newEdge] of neu.edges) {
        const d = Math.abs(newEdge.len - oldEdge.len);
        if (d < bestScore) {
          bestScore = d;
          best = newName;
        }
      }
      if (best) remap.set(oldName, best);
    }
    record._lastRemap = remap;
    // propagate to children (rebuild + remap downstream)
    for (const childId of this.dependencies.get(id) || []) {
      if (this.features.get(childId) && !this.features.get(childId).suppressed) {
        this._build(childId);
        const child = this.features.get(childId);
        // keep the child's semantic reference: remap the OLD reference name to
        // its new name if the parent's topology changed
        let refName = this._pickRefName(id);
        if (child._parentRef && child._parentRef.parentId === id) {
          const oldName = child._parentRef.refName;
          const mapped = remap.get(oldName);
          if (mapped) refName = mapped;
          else if (this.topology.get(id).faces.has(oldName)) refName = oldName;
        }
        child._parentRef = { parentId: id, refName };
        child.dirty = false;
      }
    }
    return remap;
  }

  _pickRefName(id) {
    const topo = this.topology.get(id);
    const faces = [...topo.faces.keys()];
    return faces.find((f) => /Top|Side|Face4|FilletFace/.test(f)) || faces[0];
  }

  suppress(id) {
    const record = this.features.get(id);
    if (!record) throw new Error(`Feature '${id}' not found.`);
    record.suppressed = true;
    record.dirty = true;
    for (const childId of this.dependencies.get(id) || []) {
      const child = this.features.get(childId);
      if (child) {
        child.dirty = true;
        child.dirtyCause = `parent '${id}' suppressed`;
      }
    }
  }

  unsuppress(id) {
    const record = this.features.get(id);
    if (!record) throw new Error(`Feature '${id}' not found.`);
    record.suppressed = false;
    this._build(id);
    for (const childId of this.dependencies.get(id) || []) {
      const child = this.features.get(childId);
      if (child && child.dirty && child.dirtyCause) {
        child.dirty = false;
        child.dirtyCause = null;
        this._build(childId);
        child._parentRef = { parentId: id, refName: this._pickRefName(id) };
      }
    }
  }

  reorder(id, newParent) {
    // remove from old parent, attach to new, rebuild dependency sets
    for (const [pid, children] of this.dependencies) {
      if (children.has(id)) {
        children.delete(id);
        break;
      }
    }
    const record = this.features.get(id);
    record.parent = newParent;
    if (newParent) {
      if (!this.dependencies.has(newParent)) this.dependencies.set(newParent, new Set());
      this.dependencies.get(newParent).add(id);
    }
    this._build(id);
  }

  resolveReference(childId) {
    const child = this.features.get(childId);
    if (!child || child.suppressed) return { resolved: false, reason: 'missing or suppressed' };
    if (child.dirty) return { resolved: false, reason: 'dirty (upstream change)' };
    const ref = child._parentRef;
    if (!ref) return { resolved: true, name: null };
    const parentTopo = this.topology.get(ref.parentId);
    const resolved = parentTopo && parentTopo.faces.has(ref.refName);
    return { resolved: !!resolved, name: ref.refName, featureId: ref.parentId };
  }

  faceExists(featureId, faceName) {
    const topo = this.topology.get(featureId);
    return !!(topo && topo.faces.has(faceName));
  }
}

module.exports = { FeatureDAGEngine };
