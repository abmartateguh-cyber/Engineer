/**
 * NAFEMS FV32: Cantilevered Tapered Membrane In-Plane Vibration Benchmark.
 *
 * Official NAFEMS FV32 Problem Specification:
 * - Cantilevered tapered membrane plate:
 *     * Length L = 10.0 m (along x-axis, from x = 0 to x = 10 m).
 *     * Width at root (x = 0 m): W = 5.0 m (y in [-2.5, 2.5] m).
 *     * Width at tip (x = 10.0 m): w = 1.0 m (y in [-0.5, 0.5] m).
 *     * Thickness: t = 0.05 m.
 * - Material Properties:
 *     * Young's Modulus: E = 200 GPa (200e9 Pa).
 *     * Poisson's Ratio: nu = 0.3.
 *     * Mass Density: rho = 8000 kg/m^3.
 * - Boundary Conditions:
 *     * Clamped along root edge at x = 0 m: u = 0, v = 0.
 *     * Other edges free.
 * - Declared Reference Target:
 *     * Mode 1 natural frequency: f1 = 44.623 Hz (+-2.0% tolerance).
 *
 * Solver: PlaneStressQ8 (8-node quadratic serendipity quadrilateral) with
 * consistent mass matrix integration and inverse power iteration.
 */

'use strict';

const { PlaneStressQ8, q8Shape } = require('../../../src/core/cae/fe2d_q8_plane_stress');

const E = 200e9;
const NU = 0.3;
const RHO = 8000;
const T = 0.05;
const L = 10.0;
const W_ROOT = 5.0;
const W_TIP = 1.0;
const TARGET_F1 = 44.623;
const TOLERANCE_PERCENT = 2.0;

function factorLU(A, n) {
  const Lmat = [];
  const Umat = [];
  for (let i = 0; i < n; i++) {
    Lmat.push(new Float64Array(n));
    Umat.push(new Float64Array(n));
    Lmat[i][i] = 1.0;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < i; k++) sum += Lmat[i][k] * Umat[k][j];
      Umat[i][j] = A[i][j] - sum;
    }
    for (let j = i + 1; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < i; k++) sum += Lmat[j][k] * Umat[k][i];
      Lmat[j][i] = (A[j][i] - sum) / (Umat[i][i] || 1e-30);
    }
  }
  return { L: Lmat, U: Umat };
}

function solveLU(LU, b, n) {
  const { L: Lmat, U: Umat } = LU;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < i; k++) sum += Lmat[i][k] * y[k];
    y[i] = b[i] - sum;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let k = i + 1; k < n; k++) sum += Umat[i][k] * x[k];
    x[i] = (y[i] - sum) / (Umat[i][i] || 1e-30);
  }
  return x;
}

function runNafemsFV32() {
  const nx = 8;
  const ny = 4;

  const pointAt = (xiNorm, etaNorm) => {
    const x = xiNorm * L;
    const halfW = 0.5 * (W_ROOT + (W_TIP - W_ROOT) * xiNorm);
    return [x, (etaNorm * 2 - 1) * halfW];
  };

  const solver = new PlaneStressQ8({ E, nu: NU, thickness: T });
  const nodes = [];
  const nodeMap = new Map();
  const node = (t, i, j, x, y) => {
    const k = `${t}:${i}:${j}`;
    if (nodeMap.has(k)) return nodeMap.get(k);
    const id = nodes.length;
    nodes.push({ x, y });
    nodeMap.set(k, id);
    return id;
  };

  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const p = pointAt(i / nx, j / ny);
      node('C', i, j, p[0], p[1]);
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const p = pointAt((i + 0.5) / nx, j / ny);
      node('X', i, j, p[0], p[1]);
    }
  }
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j < ny; j++) {
      const p = pointAt(i / nx, (j + 0.5) / ny);
      node('Y', i, j, p[0], p[1]);
    }
  }
  for (const n of nodes) solver.addNode(n.x, n.y);

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      solver.addQuad([
        node('C', i, j),
        node('C', i + 1, j),
        node('C', i + 1, j + 1),
        node('C', i, j + 1),
        node('X', i, j),
        node('Y', i + 1, j),
        node('X', i, j + 1),
        node('Y', i, j)
      ]);
    }
  }

  const nDof = nodes.length * 2;
  const M = Array.from({ length: nDof }, () => new Float64Array(nDof));
  const K = Array.from({ length: nDof }, () => new Float64Array(nDof));
  const GAUSS3 = [
    { w: 5 / 9, x: -Math.sqrt(3 / 5) },
    { w: 8 / 9, x: 0 },
    { w: 5 / 9, x: Math.sqrt(3 / 5) }
  ];
  const GAUSS2 = [1 / Math.sqrt(3), -1 / Math.sqrt(3)];
  const D = solver._stiffness();

  for (const elem of solver.elements) {
    const coords = elem.map((id) => solver.nodes[id]);
    const edofs = [];
    for (const id of elem) edofs.push(2 * id, 2 * id + 1);

    // Consistent mass integration
    for (const gx of GAUSS3) {
      for (const gy of GAUSS3) {
        const { N, dNdxi, dNdeta } = q8Shape(gx.x, gy.x);
        let j00 = 0,
          j01 = 0,
          j10 = 0,
          j11 = 0;
        for (let i = 0; i < 8; i++) {
          j00 += dNdxi[i] * coords[i].x;
          j01 += dNdxi[i] * coords[i].y;
          j10 += dNdeta[i] * coords[i].x;
          j11 += dNdeta[i] * coords[i].y;
        }
        const detJ = Math.abs(j00 * j11 - j01 * j10);
        const dV = detJ * T * gx.w * gy.w * RHO;
        for (let i = 0; i < 8; i++) {
          for (let j = 0; j < 8; j++) {
            const val = N[i] * N[j] * dV;
            M[edofs[2 * i]][edofs[2 * j]] += val;
            M[edofs[2 * i + 1]][edofs[2 * j + 1]] += val;
          }
        }
      }
    }

    // Stiffness integration
    for (const gx of GAUSS2) {
      for (const gy of GAUSS2) {
        const { N, dNdxi, dNdeta } = q8Shape(gx, gy);
        let j00 = 0,
          j01 = 0,
          j10 = 0,
          j11 = 0;
        for (let i = 0; i < 8; i++) {
          j00 += dNdxi[i] * coords[i].x;
          j01 += dNdxi[i] * coords[i].y;
          j10 += dNdeta[i] * coords[i].x;
          j11 += dNdeta[i] * coords[i].y;
        }
        const detJ = j00 * j11 - j01 * j10;
        const inv = [
          [j11 / detJ, -j01 / detJ],
          [-j10 / detJ, j00 / detJ]
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
          for (let j = 0; j < 16; j++) {
            let sum = 0;
            for (let k = 0; k < 3; k++) sum += B[k * 16 + i] * DB[k * 16 + j];
            K[edofs[i]][edofs[j]] += sum * detJ * T;
          }
        }
      }
    }
  }

  // Clamped at x = 0: free DOFs only
  const freeDofs = [];
  for (let id = 0; id < solver.nodes.length; id++) {
    if (Math.abs(solver.nodes[id].x) >= 1e-9) freeDofs.push(2 * id, 2 * id + 1);
  }
  const nFree = freeDofs.length;
  const Kff = Array.from({ length: nFree }, () => new Float64Array(nFree));
  const Mff = Array.from({ length: nFree }, () => new Float64Array(nFree));
  for (let i = 0; i < nFree; i++) {
    const r = freeDofs[i];
    for (let j = 0; j < nFree; j++) {
      const c = freeDofs[j];
      Kff[i][j] = K[r][c];
      Mff[i][j] = M[r][c];
    }
  }

  let lu;
  try {
    lu = factorLU(Kff, nFree);
  } catch (err) {
    return {
      id: 'NAFEMS_FV32',
      name: 'NAFEMS FV32: Cantilevered tapered membrane, mode 1 natural frequency',
      targetValue: TARGET_F1,
      calculatedValue: null,
      units: 'Hz',
      errorPercent: null,
      tolerancePercent: TOLERANCE_PERCENT,
      passed: false,
      status: 'failed',
      reason: `Eigenvalue factorization failed: ${err.message}`
    };
  }

  // Inverse power iteration for fundamental frequency f1
  let v = new Float64Array(nFree);
  for (let i = 0; i < nFree; i++) v[i] = Math.sin((i + 1) * 1.3);

  let omega = 0;
  for (let iter = 0; iter < 30; iter++) {
    const y = new Float64Array(nFree);
    for (let i = 0; i < nFree; i++) {
      for (let j = 0; j < nFree; j++) y[i] += Mff[i][j] * v[j];
    }
    const z = solveLU(lu, y, nFree);
    let num = 0,
      den = 0;
    for (let i = 0; i < nFree; i++) {
      num += z[i] * y[i];
      let mz = 0;
      for (let j = 0; j < nFree; j++) mz += Mff[i][j] * z[j];
      den += z[i] * mz;
    }
    const lambda = num / Math.max(den, 1e-30);
    omega = Math.sqrt(Math.max(lambda, 0));
    const norm = Math.sqrt(Math.max(den, 1e-30));
    for (let i = 0; i < nFree; i++) v[i] = z[i] / norm;
  }

  const calculatedF1 = omega / (2 * Math.PI);
  const error = Math.abs(calculatedF1 - TARGET_F1) / TARGET_F1;
  const passed = error * 100 <= TOLERANCE_PERCENT;

  return {
    id: 'NAFEMS_FV32',
    name: 'NAFEMS FV32: Cantilevered tapered membrane, mode 1 natural frequency',
    targetValue: TARGET_F1,
    calculatedValue: calculatedF1,
    units: 'Hz',
    errorPercent: error * 100,
    tolerancePercent: TOLERANCE_PERCENT,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : `Mode 1 frequency deviates from NAFEMS FV32 reference (${TARGET_F1} Hz) by ${(error * 100).toFixed(2)}%.`,
    measured: {
      mode1Hz: calculatedF1,
      targetHz: TARGET_F1,
      errorPercent: error * 100,
      dofCount: nFree,
      elementCount: solver.elements.length
    },
    expected: { mode1Hz: TARGET_F1 },
    details: {
      reference: 'NAFEMS FV32: Cantilevered tapered membrane natural frequency f1 = 44.623 Hz (+-2.0%).',
      dimensions: { lengthM: L, widthRootM: W_ROOT, widthTipM: W_TIP, thicknessM: T },
      material: { E, nu: NU, rhoKgPerM3: RHO },
      boundaryCondition: 'Clamped at root x = 0',
      solver: 'PlaneStressQ8 modal eigensolver with consistent mass matrix',
      mesh: { nx, ny, elements: solver.elements.length }
    }
  };
}

module.exports = { runNafemsFV32 };
