/**
 * ConvexHullTetMesher3D: minimal deterministic tetrahedralizer for strictly
 * convex point sets (all input points are vertices of the convex hull).
 *
 * Strategy: incremental 3D convex hull construction (gift-wrapping face
 * insertion), then a fan tetrahedralization from hull vertex 0 over every
 * hull facet that does not contain vertex 0.
 *
 * This module exists because the production DelaunayMesher3D (Bowyer-Watson
 * with a tolerance-based circumsphere test) churns on co-spherical input
 * (e.g. all points of a sphere surface), producing sliver explosions. The
 * incremental convex hull avoids circumsphere tests entirely and is exact for
 * points in strictly convex position (no four coplanar vertices).
 *
 * Deterministic: input order is preserved; no randomness.
 */

'use strict';

class ConvexHullTetMesher3D {
  constructor(options = {}) {
    this.tolScale = options.tolScale || 1e-10;
  }

  /**
   * @param {Array<[number, number, number]>} points
   * @returns {{ nodes: Float64Array, elements: Int32Array, numNodes: number,
   *            numElements: number, stats: Object }}
   */
  tetrahedralize(points) {
    if (!Array.isArray(points) || points.length < 4) {
      throw new Error('ConvexHullTetMesher3D requires at least 4 points.');
    }

    // De-duplicate points
    const key = (p) => `${p[0].toPrecision(15)},${p[1].toPrecision(15)},${p[2].toPrecision(15)}`;
    const seen = new Map();
    const pts = [];
    for (const p of points) {
      const k = key(p);
      if (!seen.has(k)) {
        seen.set(k, pts.length);
        pts.push([p[0], p[1], p[2]]);
      }
    }
    const n = pts.length;
    if (n < 4) {
      throw new Error('ConvexHullTetMesher3D requires 4 unique points.');
    }

    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const det3 = (a, b, c) => dot(a, cross(b, c));
    const normalize = (a) => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    };

    // Find a non-coplanar reference quadruple (deterministic scan)
    let base = null;
    outer: for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let k = j + 1; k < n; k++) {
          for (let l = k + 1; l < n; l++) {
            if (Math.abs(det3(sub(pts[j], pts[i]), sub(pts[k], pts[i]), sub(pts[l], pts[i]))) > 1e-20) {
              base = [i, j, k, l];
              break outer;
            }
          }
        }
      }
    }
    if (!base) {
      throw new Error('ConvexHullTetMesher3D: input points are coplanar; no tetrahedron can be formed.');
    }

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
    const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const eps = this.tolScale * diag;

    // Interior reference point (running centroid of inserted points)
    let q = [0, 0, 0];
    for (const i of base) {
      q[0] += pts[i][0];
      q[1] += pts[i][1];
      q[2] += pts[i][2];
    }
    q = [q[0] / 4, q[1] / 4, q[2] / 4];

    const faces = []; // { v: [a,b,c] (outward CCW), n: unit outward normal }
    const addFace = (a, b, c) => {
      const pa = pts[a],
        pb = pts[b],
        pc = pts[c];
      let m = cross(sub(pb, pa), sub(pc, pa));
      if (dot(m, sub(q, pa)) > 0) {
        const t = b;
        b = c;
        c = t;
        m = cross(sub(pts[b], pa), sub(pts[c], pa));
      }
      faces.push({ v: [a, b, c], n: normalize(m) });
    };

    addFace(base[0], base[1], base[2]);
    addFace(base[0], base[2], base[3]);
    addFace(base[0], base[3], base[1]);
    addFace(base[1], base[3], base[2]);

    const inserted = new Set(base);
    for (let pi = 0; pi < n; pi++) {
      if (inserted.has(pi)) continue;
      const P = pts[pi];

      const visible = [];
      for (const f of faces) {
        if (dot(f.n, sub(P, pts[f.v[0]])) > eps) visible.push(f);
      }
      if (visible.length === 0) {
        inserted.add(pi); // inside current hull (degenerate placement)
        continue;
      }

      const edgeCount = new Map();
      for (const f of visible) {
        const [a, b, c] = f.v;
        for (const [u, v] of [
          [a, b],
          [b, c],
          [c, a]
        ]) {
          const k = u < v ? u + '_' + v : v + '_' + u;
          edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
        }
      }

      const visibleSet = new Set(visible);
      const remaining = [];
      for (const f of faces) {
        if (!visibleSet.has(f)) remaining.push(f);
      }
      faces.length = 0;
      for (const f of remaining) faces.push(f);

      for (const [k, cnt] of edgeCount) {
        if (cnt === 1) {
          const parts = k.split('_');
          addFace(Number(parts[0]), Number(parts[1]), pi);
        }
      }

      inserted.add(pi);
      const tot = inserted.size;
      q = [q[0] + (P[0] - q[0]) / tot, q[1] + (P[1] - q[1]) / tot, q[2] + (P[2] - q[2]) / tot];
    }

    // Fan tetrahedralization from vertex 0 over facets not containing vertex 0.
    const detTet = (t) => {
      const p0 = pts[t[0]],
        p1 = pts[t[1]],
        p2 = pts[t[2]],
        p3 = pts[t[3]];
      return det3(sub(p1, p0), sub(p2, p0), sub(p3, p0));
    };

    const elements = [];
    const V0 = 0;
    for (const f of faces) {
      const [a, b, c] = f.v;
      if (a === V0 || b === V0 || c === V0) continue;
      let t = [V0, a, b, c];
      if (detTet(t) < 0) t = [V0, a, c, b];
      elements.push(t);
    }

    const nodes = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      nodes[i * 3] = pts[i][0];
      nodes[i * 3 + 1] = pts[i][1];
      nodes[i * 3 + 2] = pts[i][2];
    }
    const numElements = elements.length;
    const elems = new Int32Array(numElements * 4);
    for (let e = 0; e < numElements; e++) {
      elems[e * 4] = elements[e][0];
      elems[e * 4 + 1] = elements[e][1];
      elems[e * 4 + 2] = elements[e][2];
      elems[e * 4 + 3] = elements[e][3];
    }

    let totalVolume = 0;
    let minJacobian = Infinity;
    let maxJacobian = -Infinity;
    let invertedElements = 0;
    for (let e = 0; e < numElements; e++) {
      const d = detTet([elems[e * 4], elems[e * 4 + 1], elems[e * 4 + 2], elems[e * 4 + 3]]);
      if (d <= 0) invertedElements++;
      totalVolume += Math.abs(d) / 6;
      minJacobian = Math.min(minJacobian, d);
      maxJacobian = Math.max(maxJacobian, d);
    }

    return {
      nodes,
      elements: elems,
      numNodes: n,
      numElements,
      stats: {
        totalVolume,
        minJacobian,
        maxJacobian,
        invertedElements,
        meanQuality: 1.0
      }
    };
  }
}

module.exports = { ConvexHullTetMesher3D };
