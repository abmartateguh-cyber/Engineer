/**
 * OmniEng 2D steady heat-conduction finite element solver with mixed
 * Dirichlet / convection (Robin) / flux boundary conditions, used for the
 * reconstructed NAFEMS T1-style conduction case. Q4 bilinear quadrilaterals.
 * Self-contained, deterministic, direct sparse Cholesky solver.
 */

'use strict';

const { WasmSparseMultifrontalSolver } = require('../math/wasm_sparse_multifrontal');

const GAUSS2 = [1 / Math.sqrt(3), -1 / Math.sqrt(3)];

function sparseGet(A, r, c) {
  const lo = A.rowPtr[r];
  const hi = A.rowPtr[r + 1];
  let a = lo;
  let b = hi - 1;
  while (a <= b) {
    const m = (a + b) >> 1;
    const cc = A.colIdx[m];
    if (cc === c) return A.values[m];
    if (cc < c) a = m + 1;
    else b = m - 1;
  }
  return 0;
}

function q4Shape(xi, eta) {
  const N = new Float64Array(4);
  const dNdxi = new Float64Array(4);
  const dNdeta = new Float64Array(4);
  const xs = [-1, 1, 1, -1];
  const ys = [-1, -1, 1, 1];
  for (let i = 0; i < 4; i++) {
    N[i] = 0.25 * (1 + xi * xs[i]) * (1 + eta * ys[i]);
    dNdxi[i] = 0.25 * xs[i] * (1 + eta * ys[i]);
    dNdeta[i] = 0.25 * ys[i] * (1 + xi * xs[i]);
  }
  return { N, dNdxi, dNdeta };
}

class Poisson2DMixed {
  constructor(options = {}) {
    this.k = options.conductivity;
    this.nodes = [];
    this.elements = [];
    this._fixedT = new Map();
    this._convection = [];
    this._flux = [];
    this._last = null;
  }

  addNode(x, y) {
    const id = this.nodes.length;
    this.nodes.push({ x, y });
    return id;
  }

  addQuad(nodeIds) {
    if (nodeIds.length !== 4) throw new RangeError('Q4 element requires 4 node ids.');
    this.elements.push(nodeIds.slice());
  }

  addTriangle(nodeIds) {
    if (nodeIds.length !== 3) throw new RangeError('TRI3 element requires 3 node ids.');
    this.elements.push(nodeIds.slice());
  }

  /**
   * Builds a solver from a constrained Delaunay triangle mesh produced by
   * DelaunayConstrained2D (see delaunay_constrained_2d.js). Assumes mesh.nodes
   * entries are { id, x, y } and mesh.triangles entries are { nodeIds }.
   */
  static fromConstrainedTriMesh(mesh, options = {}) {
    const solver = new Poisson2DMixed(options);
    for (const node of mesh.nodes) {
      solver.addNode(node.x, node.y);
    }
    for (const tri of mesh.triangles) {
      solver.addTriangle(tri.nodeIds);
    }
    return solver;
  }

  setTemperature(id, T) {
    this._fixedT.set(id, T);
  }

  addConvectionEdge(nodeIds, h, Tinf) {
    this._convection.push({ nodeIds, h, Tinf });
  }

  addHeatFluxEdge(nodeIds, qn) {
    this._flux.push({ nodeIds, qn });
  }

  solve() {
    const n = this.nodes.length;
    const A = new WasmSparseMultifrontalSolver(n, n);
    const F = new Float64Array(n);

    for (const elem of this.elements) {
      const coords = elem.map((id) => this.nodes[id]);
      if (elem.length === 3) {
        const ax = coords[0].x;
        const ay = coords[0].y;
        const bx = coords[1].x;
        const by = coords[1].y;
        const cx = coords[2].x;
        const cy = coords[2].y;
        const detJ = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (detJ <= 0) throw new Error('TRI3 conduction element has non-positive Jacobian.');
        const dNdx = [(by - cy) / detJ, (cy - ay) / detJ, (ay - by) / detJ];
        const dNdy = [(cx - bx) / detJ, (ax - cx) / detJ, (bx - ax) / detJ];
        const Ke = new Float64Array(3 * 3);
        for (let i = 0; i < 3; i++) {
          for (let j = i; j < 3; j++) {
            const v = this.k * (dNdx[i] * dNdx[j] + dNdy[i] * dNdy[j]) * (0.5 * detJ);
            Ke[i * 3 + j] += v;
            if (i !== j) Ke[j * 3 + i] += v;
          }
        }
        for (let i = 0; i < 3; i++) {
          for (let j = i; j < 3; j++) {
            const v = Ke[i * 3 + j];
            if (v === 0) continue;
            const r = elem[i];
            const c = elem[j];
            A.addEntry(r, c, v);
            if (r !== c) A.addEntry(c, r, v);
          }
        }
        continue;
      }
      const Ke = new Float64Array(4 * 4);
      for (const gx of GAUSS2) {
        for (const gy of GAUSS2) {
          const { dNdxi, dNdeta } = q4Shape(gx, gy);
          let J00 = 0,
            J01 = 0,
            J10 = 0,
            J11 = 0;
          for (let i = 0; i < 4; i++) {
            J00 += dNdxi[i] * coords[i].x;
            J01 += dNdxi[i] * coords[i].y;
            J10 += dNdeta[i] * coords[i].x;
            J11 += dNdeta[i] * coords[i].y;
          }
          const detJ = J00 * J11 - J01 * J10;
          if (detJ <= 0) throw new Error('Q4 conduction element has non-positive Jacobian.');
          const inv = [
            [J11 / detJ, -J01 / detJ],
            [-J10 / detJ, J00 / detJ]
          ];
          const dNdx = new Float64Array(4);
          const dNdy = new Float64Array(4);
          for (let i = 0; i < 4; i++) {
            dNdx[i] = inv[0][0] * dNdxi[i] + inv[0][1] * dNdeta[i];
            dNdy[i] = inv[1][0] * dNdxi[i] + inv[1][1] * dNdeta[i];
          }
          for (let i = 0; i < 4; i++) {
            for (let j = i; j < 4; j++) {
              const v = this.k * (dNdx[i] * dNdx[j] + dNdy[i] * dNdy[j]) * detJ;
              Ke[i * 4 + j] += v;
              if (i !== j) Ke[j * 4 + i] += v;
            }
          }
        }
      }
      for (let i = 0; i < 4; i++) {
        for (let j = i; j < 4; j++) {
          const v = Ke[i * 4 + j];
          if (v === 0) continue;
          const r = elem[i];
          const c = elem[j];
          A.addEntry(r, c, v);
          if (r !== c) A.addEntry(c, r, v);
        }
      }
    }

    for (const cv of this._convection) {
      const p0 = this.nodes[cv.nodeIds[0]];
      const p1 = this.nodes[cv.nodeIds[1]];
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const gxi = [1 / Math.sqrt(3), -1 / Math.sqrt(3)];
      for (const xi of gxi) {
        const N = [0.5 * (1 - xi), 0.5 * (1 + xi)];
        for (let i = 0; i < 2; i++) {
          for (let j = i; j < 2; j++) {
            const v = cv.h * N[i] * N[j] * (len / 2);
            const r = cv.nodeIds[i];
            const c = cv.nodeIds[j];
            A.addEntry(r, c, v);
            if (r !== c) A.addEntry(c, r, v);
          }
          F[cv.nodeIds[i]] += cv.h * cv.Tinf * N[i] * (len / 2);
        }
      }
    }
    A.finalizeCSR();

    for (const fl of this._flux) {
      const p0 = this.nodes[fl.nodeIds[0]];
      const p1 = this.nodes[fl.nodeIds[1]];
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      for (let i = 0; i < 2; i++) {
        F[fl.nodeIds[i]] += fl.qn * 0.5 * len;
      }
    }

    let diagSum = 0,
      diagCount = 0;
    for (let i = 0; i < n; i++) {
      const d = sparseGet(A, i, i);
      if (d > 0) {
        diagSum += d;
        diagCount++;
      }
    }
    const diagScale = diagCount > 0 ? diagSum / diagCount : 1;
    const rp = A.rowPtr;
    const ci = A.colIdx;
    const av = A.values;
    const origRows = new Map();
    for (const [id] of this._fixedT) {
      const entries = [];
      for (let p = rp[id]; p < rp[id + 1]; p++) entries.push([ci[p], av[p]]);
      origRows.set(id, entries);
    }
    const fixedSet = new Set(this._fixedT.keys());
    for (const [id] of this._fixedT) {
      for (const [j, v] of origRows.get(id)) {
        if (j === id) continue;
        if (fixedSet.has(j) && j < id) continue;
        A.addEntry(id, j, -v);
        A.addEntry(j, id, -v);
      }
      A.addEntry(id, id, diagScale - sparseGet(A, id, id));
    }
    for (const [id, T] of this._fixedT) {
      const row = origRows.get(id);
      for (const [j, v] of row) {
        if (j !== id && !origRows.has(j)) F[j] -= v * T;
      }
      F[id] = diagScale * T;
    }

    A.finalizeCSR();
    const T = A.solve(F).solution;
    this._last = { solverExecuted: true, temperature: T, nodeCount: n, elementCount: this.elements.length };
    return this._last;
  }
}

module.exports = { Poisson2DMixed, q4Shape };
