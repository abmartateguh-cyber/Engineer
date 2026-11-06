/**
 * OmniEng 2D plane-stress 8-node quadrilateral (Q8, Serendipity) finite
 * element solver, used for the reconstructed NAFEMS LE1-style quarter-ellipse
 * membrane case. Self-contained, deterministic, direct sparse Cholesky solver.
 * Experimental numerical engine; not certified engineering software.
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

const Q8_CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0]
];

function q8Shape(xi, eta) {
  const N = new Float64Array(8);
  const dNdxi = new Float64Array(8);
  const dNdeta = new Float64Array(8);
  for (let i = 0; i < 8; i++) {
    const [xiI, etaI] = Q8_CORNERS[i];
    if (xiI === 0) {
      N[i] = 0.5 * (1 - xi * xi) * (1 + eta * etaI);
      dNdxi[i] = -xi * (1 + eta * etaI);
      dNdeta[i] = 0.5 * (1 - xi * xi) * etaI;
    } else if (etaI === 0) {
      N[i] = 0.5 * (1 + xi * xiI) * (1 - eta * eta);
      dNdxi[i] = 0.5 * xiI * (1 - eta * eta);
      dNdeta[i] = -(1 + xi * xiI) * eta;
    } else {
      N[i] = 0.25 * (1 + xi * xiI) * (1 + eta * etaI) * (xi * xiI + eta * etaI - 1);
      dNdxi[i] = 0.25 * xiI * (1 + eta * etaI) * (2 * xi * xiI + eta * etaI);
      dNdeta[i] = 0.25 * etaI * (1 + xi * xiI) * (xi * xiI + 2 * eta * etaI);
    }
  }
  return { N, dNdxi, dNdeta };
}

class PlaneStressQ8 {
  constructor(options = {}) {
    this.E = options.E;
    this.nu = options.nu;
    this.t = options.thickness !== undefined ? options.thickness : 1;
    this.nodes = [];
    this.elements = [];
    this.loads = new Float64Array(0);
    this._fix = [];
    this._prescribed = [];
    this._last = null;
  }

  addNode(x, y) {
    const id = this.nodes.length;
    this.nodes.push({ x, y });
    this._fix.push([false, false]);
    this._prescribed.push([0, 0]);
    return id;
  }

  addQuad(nodeIds) {
    if (nodeIds.length !== 8) throw new RangeError('Q8 element requires 8 node ids.');
    this.elements.push(nodeIds.slice());
  }

  fixNode(id, fixX, fixY) {
    this._fix[id] = [!!fixX, !!fixY];
  }

  prescribeDisplacement(id, axis, value) {
    this._prescribed[id][axis] = value;
    this._fix[id][axis] = true;
  }

  applyNodalLoad(id, fx, fy) {
    const total = this.nodes.length * 2;
    if (this.loads.length !== total) this.loads = new Float64Array(total);
    this.loads[id * 2] += fx;
    this.loads[id * 2 + 1] += fy;
  }

  _stiffness() {
    const E = this.E;
    const nu = this.nu;
    const c = E / (1 - nu * nu);
    return [
      [c, c * nu, 0],
      [c * nu, c, 0],
      [0, 0, E / (2 * (1 + nu))]
    ];
  }

  solve() {
    const n = this.nodes.length * 2;
    const A = new WasmSparseMultifrontalSolver(n, n);
    const F = Float64Array.from(this.loads.length === n ? this.loads : new Float64Array(n));
    const D = this._stiffness();

    for (const elem of this.elements) {
      const coords = elem.map((id) => this.nodes[id]);
      const Ke = new Float64Array(16 * 16);
      for (const gx of GAUSS2) {
        for (const gy of GAUSS2) {
          const { N, dNdxi, dNdeta } = q8Shape(gx, gy);
          let J00 = 0,
            J01 = 0,
            J10 = 0,
            J11 = 0;
          for (let i = 0; i < 8; i++) {
            J00 += dNdxi[i] * coords[i].x;
            J01 += dNdxi[i] * coords[i].y;
            J10 += dNdeta[i] * coords[i].x;
            J11 += dNdeta[i] * coords[i].y;
          }
          const detJ = J00 * J11 - J01 * J10;
          if (detJ <= 0) throw new Error(`Q8 element has non-positive Jacobian ${detJ}.`);
          const inv = [
            [J11 / detJ, -J01 / detJ],
            [-J10 / detJ, J00 / detJ]
          ];
          const dNdx = new Float64Array(8);
          const dNdy = new Float64Array(8);
          for (let i = 0; i < 8; i++) {
            dNdx[i] = inv[0][0] * dNdxi[i] + inv[0][1] * dNdeta[i];
            dNdy[i] = inv[1][0] * dNdxi[i] + inv[1][1] * dNdeta[i];
          }
          const B = new Float64Array(3 * 16);
          for (let i = 0; i < 8; i++) {
            const c = i * 2;
            B[0 * 16 + c] = dNdx[i];
            B[1 * 16 + c + 1] = dNdy[i];
            B[2 * 16 + c] = dNdy[i];
            B[2 * 16 + c + 1] = dNdx[i];
          }
          const DB = new Float64Array(3 * 16);
          for (let r = 0; r < 3; r++) {
            for (let cc = 0; cc < 16; cc++) {
              let sum = 0;
              for (let k = 0; k < 3; k++) sum += D[r][k] * B[k * 16 + cc];
              DB[r * 16 + cc] = sum;
            }
          }
          for (let i = 0; i < 16; i++) {
            for (let j = i; j < 16; j++) {
              let sum = 0;
              for (let k = 0; k < 3; k++) sum += B[k * 16 + i] * DB[k * 16 + j];
              const v = sum * detJ * this.t;
              Ke[i * 16 + j] += v;
              if (i !== j) Ke[j * 16 + i] += v;
            }
          }
        }
      }
      const edofs = [];
      for (const id of elem) edofs.push(2 * id, 2 * id + 1);
      for (let i = 0; i < 16; i++) {
        for (let j = i; j < 16; j++) {
          const v = Ke[i * 16 + j];
          if (v === 0) continue;
          const r = edofs[i];
          const c = edofs[j];
          A.addEntry(r, c, v);
          if (r !== c) A.addEntry(c, r, v);
        }
      }
    }
    A.finalizeCSR();

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

    const origRows = new Map();
    const fixed = [];
    for (let id = 0; id < this.nodes.length; id++) {
      for (let d = 0; d < 2; d++) {
        if (this._fix[id][d]) fixed.push(2 * id + d);
      }
    }
    const rp = A.rowPtr;
    const ci = A.colIdx;
    const av = A.values;
    const rowEntries = (dof) => {
      const entries = [];
      for (let p = rp[dof]; p < rp[dof + 1]; p++) entries.push([ci[p], av[p]]);
      return entries;
    };
    for (const dof of fixed) {
      origRows.set(dof, rowEntries(dof));
    }
    const fixedSet = new Set(fixed);
    for (const dof of fixed) {
      for (const [j, v] of origRows.get(dof)) {
        if (j === dof) continue;
        if (fixedSet.has(j) && j < dof) continue;
        A.addEntry(dof, j, -v);
        A.addEntry(j, dof, -v);
      }
      A.addEntry(dof, dof, diagScale - sparseGet(A, dof, dof));
    }
    for (const dof of fixed) {
      const ud = this._prescribed[Math.floor(dof / 2)][dof % 2] || 0;
      if (ud !== 0) {
        const row = origRows.get(dof);
        for (const [j, v] of row) {
          if (j !== dof && !origRows.has(j)) F[j] -= v * ud;
        }
        F[dof] = diagScale * ud;
      }
    }

    A.finalizeCSR();
    const u = A.solve(F).solution;
    const displacements = [];
    for (let id = 0; id < this.nodes.length; id++) {
      displacements.push([u[id * 2], u[id * 2 + 1]]);
    }

    const stresses = [];
    for (const elem of this.elements) {
      const coords = elem.map((id) => this.nodes[id]);
      const ue = [];
      for (const id of elem) ue.push(u[id * 2], u[id * 2 + 1]);
      const { dNdxi, dNdeta } = q8Shape(0, 0);
      let J00 = 0,
        J01 = 0,
        J10 = 0,
        J11 = 0;
      for (let i = 0; i < 8; i++) {
        J00 += dNdxi[i] * coords[i].x;
        J01 += dNdxi[i] * coords[i].y;
        J10 += dNdeta[i] * coords[i].x;
        J11 += dNdeta[i] * coords[i].y;
      }
      const detJ = J00 * J11 - J01 * J10;
      const inv = [
        [J11 / detJ, -J01 / detJ],
        [-J10 / detJ, J00 / detJ]
      ];
      const dNdx = new Float64Array(8);
      const dNdy = new Float64Array(8);
      for (let i = 0; i < 8; i++) {
        dNdx[i] = inv[0][0] * dNdxi[i] + inv[0][1] * dNdeta[i];
        dNdy[i] = inv[1][0] * dNdxi[i] + inv[1][1] * dNdeta[i];
      }
      let exx = 0,
        eyy = 0,
        exy = 0;
      for (let i = 0; i < 8; i++) {
        exx += dNdx[i] * ue[i * 2];
        eyy += dNdy[i] * ue[i * 2 + 1];
        exy += dNdy[i] * ue[i * 2] + dNdx[i] * ue[i * 2 + 1];
      }
      const sxx = D[0][0] * exx + D[0][1] * eyy;
      const syy = D[1][0] * exx + D[1][1] * eyy;
      const sxy = D[2][2] * exy;
      stresses.push({ sxx, syy, sxy, vonMises: Math.sqrt(sxx * sxx - sxx * syy + syy * syy + 3 * sxy * sxy) });
    }

    this._last = {
      solverExecuted: true,
      displacement: u,
      displacements,
      stresses,
      nodeCount: this.nodes.length,
      elementCount: this.elements.length,
      dofCount: n
    };
    return this._last;
  }
}

module.exports = { PlaneStressQ8, q8Shape };
