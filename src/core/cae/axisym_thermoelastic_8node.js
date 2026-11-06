/**
 * OmniEng axisymmetric 8-node quadrilateral thermoelastic finite element
 * solver (temperature load included), used for the reconstructed NAFEMS
 * LE11 thermoelastic case. Self-contained, deterministic, direct sparse
 * Cholesky solver. Experimental numerical engine.
 *
 * Geometry/loading notes: the solver is geometry-agnostic; the benchmark
 * model is defined in test/vv/nafems/test_nafems_le11.js. The thermal load
 * is applied as an initial (eigen) strain field. Delta T(r, z) = r + z
 * (metres) evaluated at each Gauss point:
 *   - if the constructor receives `deltaTField: (r, z) => number`, the
 *     field is evaluated directly at the Gauss point coordinates (this is
 *     the mode used by the LE11 reconstruction);
 *   - otherwise a per-node `deltaT` value (if present) is interpolated
 *     with the element shape functions at the Gauss point.
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

class AxisymThermoelastic8Node {
  constructor(options = {}) {
    this.E = options.E;
    this.nu = options.nu;
    this.alpha = options.alpha;
    this.deltaTField = typeof options.deltaTField === 'function' ? options.deltaTField : null;
    this.nodes = [];
    this.elements = [];
    this._fix = [];
    this._prescribed = [];
    this._last = null;
  }

  addNode(r, z) {
    const id = this.nodes.length;
    this.nodes.push({ r, z });
    this._fix.push([false, false]);
    this._prescribed.push([0, 0]);
    return id;
  }

  addQuad(nodeIds) {
    if (nodeIds.length !== 8) throw new RangeError('Axisymmetric 8-node element requires 8 node ids.');
    this.elements.push(nodeIds.slice());
  }

  fixNode(id, fixR, fixZ) {
    this._fix[id] = [!!fixR, !!fixZ];
  }

  prescribeDisplacement(id, axis, value) {
    this._prescribed[id][axis] = value;
    this._fix[id][axis] = true;
  }

  _stiffness() {
    const E = this.E;
    const nu = this.nu;
    const c = E / ((1 + nu) * (1 - 2 * nu));
    return [
      [c * (1 - nu), c * nu, c * nu, 0],
      [c * nu, c * (1 - nu), c * nu, 0],
      [c * nu, c * nu, c * (1 - nu), 0],
      [0, 0, 0, c * (0.5 - nu)]
    ];
  }

  _deltaTAtPoint(coords, N, r0, z0) {
    if (this.deltaTField) return this.deltaTField(r0, z0);
    let dT = 0;
    for (let i = 0; i < 8; i++) dT += N[i] * (coords[i].deltaT || 0);
    return dT;
  }

  _elementGeometry(coords, xi, eta) {
    const { N, dNdxi, dNdeta } = q8Shape(xi, eta);
    let J00 = 0,
      J01 = 0,
      J10 = 0,
      J11 = 0,
      r0 = 0,
      z0 = 0;
    for (let i = 0; i < 8; i++) {
      J00 += dNdxi[i] * coords[i].r;
      J01 += dNdxi[i] * coords[i].z;
      J10 += dNdeta[i] * coords[i].r;
      J11 += dNdeta[i] * coords[i].z;
      r0 += N[i] * coords[i].r;
      z0 += N[i] * coords[i].z;
    }
    const detJ = J00 * J11 - J01 * J10;
    if (detJ <= 0 || r0 <= 0) throw new Error('Axisymmetric element has non-positive Jacobian or radius.');
    const inv = [
      [J11 / detJ, -J01 / detJ],
      [-J10 / detJ, J00 / detJ]
    ];
    const dNdr = new Float64Array(8);
    const dNdz = new Float64Array(8);
    for (let i = 0; i < 8; i++) {
      dNdr[i] = inv[0][0] * dNdxi[i] + inv[0][1] * dNdeta[i];
      dNdz[i] = inv[1][0] * dNdxi[i] + inv[1][1] * dNdeta[i];
    }
    return { N, dNdr, dNdz, detJ, r0 };
  }

  solve() {
    const n = this.nodes.length * 2;
    const A = new WasmSparseMultifrontalSolver(n, n);
    const F = new Float64Array(n);
    const D = this._stiffness();

    for (const elem of this.elements) {
      const coords = elem.map((id) => this.nodes[id]);
      const Ke = new Float64Array(16 * 16);
      const Fe = new Float64Array(16);
      for (const gx of GAUSS2) {
        for (const gy of GAUSS2) {
          const { N, dNdr, dNdz, detJ, r0 } = this._elementGeometry(coords, gx, gy);
          const B = new Float64Array(4 * 16);
          for (let i = 0; i < 8; i++) {
            const c = i * 2;
            B[0 * 16 + c] = dNdr[i];
            B[1 * 16 + c + 1] = dNdz[i];
            B[2 * 16 + c] = N[i] / r0;
            B[3 * 16 + c] = dNdz[i];
            B[3 * 16 + c + 1] = dNdr[i];
          }
          const DB = new Float64Array(4 * 16);
          for (let r = 0; r < 4; r++) {
            for (let cc = 0; cc < 16; cc++) {
              let sum = 0;
              for (let k = 0; k < 4; k++) sum += D[r][k] * B[k * 16 + cc];
              DB[r * 16 + cc] = sum;
            }
          }
          let z0 = 0;
          for (let i = 0; i < 8; i++) z0 += N[i] * coords[i].z;
          const dV = detJ * r0 * 2 * Math.PI;
          for (let i = 0; i < 16; i++) {
            for (let j = i; j < 16; j++) {
              let sum = 0;
              for (let k = 0; k < 4; k++) sum += B[k * 16 + i] * DB[k * 16 + j];
              const v = sum * dV;
              Ke[i * 16 + j] += v;
              if (i !== j) Ke[j * 16 + i] += v;
            }
          }
          const dT = this._deltaTAtPoint(coords, N, r0, z0);
          const eth = [this.alpha * dT, this.alpha * dT, this.alpha * dT, 0];
          for (let i = 0; i < 16; i++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) sum += DB[k * 16 + i] * eth[k];
            Fe[i] += sum * dV;
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
        F[edofs[i]] += Fe[i];
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
    const fixed = [];
    for (let id = 0; id < this.nodes.length; id++) {
      for (let d = 0; d < 2; d++) {
        if (this._fix[id][d]) fixed.push(2 * id + d);
      }
    }
    const rp = A.rowPtr;
    const ci = A.colIdx;
    const av = A.values;
    const origRows = new Map();
    for (const dof of fixed) {
      const entries = [];
      for (let p = rp[dof]; p < rp[dof + 1]; p++) entries.push([ci[p], av[p]]);
      origRows.set(dof, entries);
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
      const ud = this._prescribed[Math.floor(dof / 2)][dof % 2] || 0;
      if (ud !== 0) {
        const row = origRows.get(dof);
        for (const [j, v] of row) {
          if (j !== dof && !origRows.has(j)) F[j] -= v * ud;
        }
      }
      F[dof] = diagScale * ud;
    }

    A.finalizeCSR();
    const u = A.solve(F).solution;
    const stresses = [];
    for (const elem of this.elements) {
      const coords = elem.map((id) => this.nodes[id]);
      const ue = [];
      for (const id of elem) ue.push(u[id * 2], u[id * 2 + 1]);
      const { N, dNdr, dNdz, r0 } = this._elementGeometry(coords, 0, 0);
      let er = 0,
        ez = 0,
        et = 0,
        grz = 0;
      for (let i = 0; i < 8; i++) {
        er += dNdr[i] * ue[i * 2];
        ez += dNdz[i] * ue[i * 2 + 1];
        et += (N[i] / r0) * ue[i * 2];
        grz += dNdz[i] * ue[i * 2] + dNdr[i] * ue[i * 2 + 1];
      }
      const eps = [er, ez, et, grz];
      let z0 = 0;
      for (let i = 0; i < 8; i++) z0 += N[i] * coords[i].z;
      const dT = this._deltaTAtPoint(coords, N, r0, z0);
      const eth = [this.alpha * dT, this.alpha * dT, this.alpha * dT, 0];
      const sig = [0, 0, 0, 0];
      for (let r = 0; r < 4; r++) {
        for (let k = 0; k < 4; k++) sig[r] += D[r][k] * (eps[k] - eth[k]);
      }
      stresses.push({ sr: sig[0], sz: sig[1], st: sig[2], srz: sig[3] });
    }

    this._last = {
      solverExecuted: true,
      displacement: u,
      stresses,
      nodeCount: this.nodes.length,
      elementCount: this.elements.length,
      dofCount: n
    };
    return this._last;
  }

  /**
   * Nodal stress recovery: for node `id`, evaluate the element strain
   * recovery at the node's isoparametric location in each adjacent element
   * and average. Returns { sr, sz, st, srz } or null if the node is not
   * part of any element. Require the solved displacement field.
   */
  stressAtNode(id) {
    if (!this._last) return null;
    const u = this._last.displacement;
    const D = this._stiffness();
    const x = this.nodes[id].r;
    const z = this.nodes[id].z;
    const sums = { sr: 0, sz: 0, st: 0, srz: 0 };
    let count = 0;
    for (const elem of this.elements) {
      const local = elem.indexOf(id);
      if (local < 0) continue;
      const coords = elem.map((nid) => this.nodes[nid]);
      const ue = [];
      for (const nid of elem) ue.push(u[nid * 2], u[nid * 2 + 1]);
      const [xi0, eta0] = Q8_CORNERS[local];
      const { N, dNdr, dNdz, r0 } = this._elementGeometry(coords, xi0, eta0);
      let er = 0,
        ez = 0,
        et = 0,
        grz = 0;
      for (let i = 0; i < 8; i++) {
        er += dNdr[i] * ue[i * 2];
        ez += dNdz[i] * ue[i * 2 + 1];
        et += (N[i] / r0) * ue[i * 2];
        grz += dNdz[i] * ue[i * 2] + dNdr[i] * ue[i * 2 + 1];
      }
      const eps = [er, ez, et, grz];
      const dT = this.deltaTField ? this.deltaTField(x, z) : x + z;
      const eth = [this.alpha * dT, this.alpha * dT, this.alpha * dT, 0];
      const sig = [0, 0, 0, 0];
      for (let r = 0; r < 4; r++) {
        for (let k = 0; k < 4; k++) sig[r] += D[r][k] * (eps[k] - eth[k]);
      }
      sums.sr += sig[0];
      sums.sz += sig[1];
      sums.st += sig[2];
      sums.srz += sig[3];
      count++;
    }
    if (count === 0) return null;
    return {
      sr: sums.sr / count,
      sz: sums.sz / count,
      st: sums.st / count,
      srz: sums.srz / count
    };
  }

  /**
   * Superconvergent nodal stress recovery: for node `id`, evaluate the
   * element strain at each 2x2 Gauss (Barlow) point of every adjacent
   * element, bilinearly extrapolate the Gauss-point stresses to the node
   * with the barycentric weights
   *   w = 0.25 * (1 + sqrt(3)*xi*gXi) * (1 + sqrt(3)*eta*gEta)
   * (Gauss coordinates xi,eta = +-1/sqrt(3); node natural coordinates
   * gXi,gEta), and average the contributions over all attached elements.
   * Returns { sr, sz, st, srz } or null if the node is not part of any
   * element. Require the solved displacement field.
   */
  stressAtNodeSuperconvergent(id) {
    if (!this._last) return null;
    const u = this._last.displacement;
    const D = this._stiffness();
    const SQRT3 = Math.sqrt(3);
    const sums = { sr: 0, sz: 0, st: 0, srz: 0 };
    let count = 0;
    for (const elem of this.elements) {
      const local = elem.indexOf(id);
      if (local < 0) continue;
      const coords = elem.map((nid) => this.nodes[nid]);
      const ue = [];
      for (const nid of elem) ue.push(u[nid * 2], u[nid * 2 + 1]);
      const [gXi, gEta] = Q8_CORNERS[local];
      const sig = [0, 0, 0, 0];
      for (const gx of GAUSS2) {
        for (const gy of GAUSS2) {
          const w = 0.25 * (1 + SQRT3 * gx * gXi) * (1 + SQRT3 * gy * gEta);
          const { N, dNdr, dNdz, r0 } = this._elementGeometry(coords, gx, gy);
          let er = 0,
            ez = 0,
            et = 0,
            grz = 0;
          for (let i = 0; i < 8; i++) {
            er += dNdr[i] * ue[i * 2];
            ez += dNdz[i] * ue[i * 2 + 1];
            et += (N[i] / r0) * ue[i * 2];
            grz += dNdz[i] * ue[i * 2] + dNdr[i] * ue[i * 2 + 1];
          }
          const eps = [er, ez, et, grz];
          let z0 = 0;
          for (let i = 0; i < 8; i++) z0 += N[i] * coords[i].z;
          const dT = this._deltaTAtPoint(coords, N, r0, z0);
          const eth = [this.alpha * dT, this.alpha * dT, this.alpha * dT, 0];
          for (let r = 0; r < 4; r++) {
            for (let k = 0; k < 4; k++) sig[r] += w * D[r][k] * (eps[k] - eth[k]);
          }
        }
      }
      sums.sr += sig[0];
      sums.sz += sig[1];
      sums.st += sig[2];
      sums.srz += sig[3];
      count++;
    }
    if (count === 0) return null;
    return {
      sr: sums.sr / count,
      sz: sums.sz / count,
      st: sums.st / count,
      srz: sums.srz / count
    };
  }
}

module.exports = { AxisymThermoelastic8Node, q8Shape };
