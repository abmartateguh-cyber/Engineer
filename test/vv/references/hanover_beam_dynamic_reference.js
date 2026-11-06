/**
 * Independent analytic reference for cantilever-beam free-vibration frequency
 * (Euler-Bernoulli theory) plus a genuine modal analysis driver.
 *
 * Production side of the analysis:
 *   - stiffness matrix assembled from TimoshenkoBeam3D
 *     (src/core/cae/beam_timoshenko_3d.js), a production 3D beam element;
 *   - the modal system is the pure-bending sub-block of that assembly
 *     (transverse deflection v and cross-section rotation theta_z per node),
 *     extracted so the problem is a classical beam-vibration problem;
 *   - the linear solves inside the inverse iteration use the production
 *     sparse Cholesky solver (WasmSparseMultifrontalSolver).
 *
 * The consistent mass matrix (standard cubic-Hermite beam consistent mass
 * including rotary inertia) and the closed-form natural-frequency reference
 * are coded in this module, independently of the code under test.
 *
 * Analytic reference (published canonical result, e.g. Timoshenko, "Vibration
 * Problems in Engineering"):
 *   omega_n = (beta_n L)^2 sqrt(EI / (rho A L^4))
 * with the cantilever root of cos(beta L) cosh(beta L) = -1:
 *   (beta_1 L) = 1.87510406871196.
 *
 * The production Timoshenko element includes shear flexibility; for the
 * slender benchmark beam (L/h = 40) the shear correction is ~0.04%, so the
 * numerical frequency is expected to sit just below the Euler-Bernoulli value.
 */
'use strict';

function seededRandom32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const __seededRandom = seededRandom32(0x5eed1234);

const { TimoshenkoBeam3D } = require('../../../src/core/cae/beam_timoshenko_3d');
const { LinearSolver } = require('../../../src/core/math/linear_algebra');
const { WasmSparseMultifrontalSolver } = require('../../../src/core/math/wasm_sparse_multifrontal');
const { runHanoverBeamDynamics } = require('../../test_hanover_beam_dynamics');

/**
 * First cantilever eigenvalue constant: root of cos(bL)cosh(bL) = -1.
 */
const CANTILEVER_BETA1L = 1.87510406871196;

/**
 * Euler-Bernoulli cantilever first natural frequency.
 * @param {Object} p
 * @param {number} p.E Young's modulus (Pa)
 * @param {number} p.I second moment of area (m^4)
 * @param {number} p.rho density (kg/m^3)
 * @param {number} p.A cross-section area (m^2)
 * @param {number} p.L length (m)
 * @returns {number} frequency (rad/s)
 */
function eulerBernoulliCantileverOmega1(p) {
  return CANTILEVER_BETA1L * CANTILEVER_BETA1L * Math.sqrt((p.E * p.I) / (p.rho * p.A * Math.pow(p.L, 4)));
}

/**
 * Standard cubic-Hermite Euler-Bernoulli consistent mass matrix (4x4) for a
 * beam element of length le, per unit transverse DOF pair (w, theta).
 * @param {number} le
 * @param {number} rho
 * @param {number} A
 * @returns {number[][]}
 */
function bernoulliConsistentMassElement(le, rho, A) {
  const m = rho * A * le;
  return [
    [156, 22 * le, 54, -13 * le],
    [22 * le, 4 * le * le, 13 * le, -3 * le * le],
    [54, 13 * le, 156, -22 * le],
    [-13 * le, -3 * le * le, -22 * le, 4 * le * le]
  ].map((row) => row.map((v) => (v * m) / 420));
}

/**
 * Assemble the vertical-plane bending sub-block (v, theta_z per node) of a
 * cantilever built from production TimoshenkoBeam3D elements.
 *
 * @param {Object} opts
 * @param {number} opts.L length (m)
 * @param {number} opts.b section width (m)
 * @param {number} opts.h section height (m)
 * @param {number} opts.E
 * @param {number} opts.nu
 * @param {number} opts.rho
 * @param {number} opts.nEl number of beam elements
 * @returns {{K: number[][], M: number[][], dofCount: number}}
 */
function assembleCantileverBendingSystem(opts) {
  const { L, b, h, E, nu, rho, nEl } = opts;
  const A = b * h;
  const I = (b * Math.pow(h, 3)) / 12;
  const J = 0.1406 * Math.pow(b, 4);
  const le = L / nEl;
  const nDof = 2 * (nEl + 1);

  const globalK = Array.from({ length: 6 * (nEl + 1) }, () => new Float64Array(6 * (nEl + 1)));
  for (let e = 0; e < nEl; e++) {
    const el = new TimoshenkoBeam3D(
      e,
      [e, e + 1],
      [
        { x: e * le, y: 0, z: 0 },
        { x: (e + 1) * le, y: 0, z: 0 }
      ],
      { E, nu, A, Iy: I, Iz: I, J, ky: 5 / 6, kz: 5 / 6 }
    );
    const Ke = el.computeLocalStiffnessMatrix();
    const d = [
      6 * e,
      6 * e + 1,
      6 * e + 2,
      6 * e + 3,
      6 * e + 4,
      6 * e + 5,
      6 * e + 6,
      6 * e + 7,
      6 * e + 8,
      6 * e + 9,
      6 * e + 10,
      6 * e + 11
    ];
    for (let a = 0; a < 12; a++) {
      for (let c = 0; c < 12; c++) {
        globalK[d[a]][d[c]] += Ke[a * 12 + c];
      }
    }
  }

  const map = [];
  for (let k = 0; k <= nEl; k++) {
    map.push(6 * k + 1);
    map.push(6 * k + 5);
  }
  const Kq = Array.from({ length: nDof }, () => new Float64Array(nDof));
  for (let a = 0; a < nDof; a++) {
    for (let c = 0; c < nDof; c++) {
      Kq[a][c] = globalK[map[a]][map[c]];
    }
  }

  const M2 = bernoulliConsistentMassElement(le, rho, A);
  const Mq = Array.from({ length: nDof }, () => new Float64Array(nDof));
  for (let e = 0; e < nEl; e++) {
    const d = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3];
    for (let a = 0; a < 4; a++) {
      for (let c = 0; c < 4; c++) {
        Mq[d[a]][d[c]] += M2[a][c];
      }
    }
  }

  for (let c = 0; c < nDof; c++) {
    Kq[0][c] = 0;
    Kq[c][0] = 0;
    Kq[1][c] = 0;
    Kq[c][1] = 0;
  }
  Kq[0][0] = 1e25;
  Kq[1][1] = 1e25;

  return { K: Kq, M: Mq, dofCount: nDof, A, I };
}

/**
 * Run the modal analysis on the production-beam cantilever.
 *
 * @param {Object} opts
 * @param {number} opts.L beam length (m)
 * @param {number} opts.b section width (m)
 * @param {number} opts.h section height (m)
 * @param {number} opts.E
 * @param {number} opts.nu
 * @param {number} opts.rho
 * @param {number} opts.nEl
 * @returns {Object}
 */
function runCantileverModalAnalysis(opts) {
  const { L, b, h, E, nu, rho, nEl } = opts;
  const sys = assembleCantileverBendingSystem(opts);
  const K = sys.K;
  const M = sys.M;
  const n = sys.dofCount;

  const sparse = new WasmSparseMultifrontalSolver(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (K[i][j] !== 0) sparse.addEntry(i, j, K[i][j]);
    }
  }
  sparse.finalizeCSR();
  const t0 = Date.now();
  sparse.factorize();
  const factorizationMs = Date.now() - t0;

  let v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = __seededRandom();
  let lambda = 0;
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < 80; iter++) {
    const rhs = LinearSolver.matVecMul(M, v);
    const z = sparse.solve(rhs).solution;
    let ns = 0;
    for (let i = 0; i < n; i++) {
      let mz = 0;
      const row = M[i];
      for (let j = 0; j < n; j++) mz += row[j] * z[j];
      ns += z[i] * mz;
    }
    const norm = Math.sqrt(Math.max(ns, 1e-30));
    for (let i = 0; i < n; i++) v[i] = z[i] / norm;

    const kv = LinearSolver.matVecMul(K, v);
    const mv = LinearSolver.matVecMul(M, v);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += v[i] * kv[i];
      den += v[i] * mv[i];
    }
    const lambdaNext = num / den;
    iterations = iter + 1;
    if (Math.abs(lambdaNext - lambda) < 1e-10 * Math.abs(lambdaNext)) {
      lambda = lambdaNext;
      converged = true;
      break;
    }
    lambda = lambdaNext;
  }

  const omegaNumerical = Math.sqrt(Math.max(lambda, 0));
  const omegaAnalytic = eulerBernoulliCantileverOmega1({ E, I: sys.I, rho, A: sys.A, L });
  const errorPercent = (Math.abs(omegaNumerical - omegaAnalytic) / omegaAnalytic) * 100;

  return {
    omegaNumerical,
    omegaAnalytic,
    frequencyHz: omegaNumerical / (2 * Math.PI),
    errorPercent,
    iterations,
    converged,
    dofCount: n,
    factorizationMs,
    nEl,
    eigenvalue: lambda
  };
}

/**
 * Full benchmark runner (result-shape compatible with run_vv.js).
 * @returns {Object} validation result
 */
function runHanoverBeamDynamicResponse() {
  const base = { L: 2, b: 0.05, h: 0.05, E: 210e9, nu: 0.3, rho: 7850 };
  const coarse = runCantileverModalAnalysis({ ...base, nEl: 12 });
  const fine = runCantileverModalAnalysis({ ...base, nEl: 24 });

  const tolerancePercent = 5;
  const passed = fine.errorPercent <= tolerancePercent && fine.converged;

  return {
    id: 'CANTILEVER_FIRST_MODAL_ANALYTIC',
    name: 'Cantilever beam first natural frequency, Euler-Bernoulli analytic reference (not Hannover laboratory data)',
    targetValue: fine.omegaAnalytic,
    calculatedValue: fine.omegaNumerical,
    units: 'rad/s',
    errorPercent: fine.errorPercent,
    tolerancePercent,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : 'First natural frequency deviates from the Euler-Bernoulli cantilever closed form by more than 5%.',
    measured: {
      omegaMeasured: fine.omegaNumerical,
      frequencyHz: fine.frequencyHz,
      omegaAnalytic: fine.omegaAnalytic,
      errorPercent: fine.errorPercent,
      iterations: fine.iterations,
      converged: fine.converged,
      dofCount: fine.dofCount
    },
    expected: {
      omega: fine.omegaAnalytic,
      formula: 'omega_1 = (1.875104)^2 sqrt(EI/(rho A L^4))'
    },
    details: {
      reference:
        'Euler-Bernoulli cantilever root cos(bL)cosh(bL) = -1, beta1L = 1.87510406871196 (Timoshenko, Vibration Problems in Engineering).',
      solver:
        'production TimoshenkoBeam3D stiffness (bending sub-block) + independent consistent beam mass; production sparse Cholesky inverse iteration',
      setup: {
        lengthM: base.L,
        sectionM: { b: base.b, h: base.h },
        material: { E: base.E, nu: base.nu, rho: base.rho }
      },
      convergenceTrend: {
        coarse: { nEl: coarse.nEl, omega: coarse.omegaNumerical, errorPercent: coarse.errorPercent },
        fine: { nEl: fine.nEl, omega: fine.omegaNumerical, errorPercent: fine.errorPercent }
      },
      note: 'Production Timoshenko element includes shear flexibility (~0.04% correction at L/h=40), slightly below the Euler-Bernoulli limit.'
    }
  };
}

module.exports = {
  CANTILEVER_BETA1L,
  eulerBernoulliCantileverOmega1,
  bernoulliConsistentMassElement,
  assembleCantileverBendingSystem,
  runCantileverModalAnalysis,
  runHanoverBeamDynamicResponse,
  runHanoverBeamDynamics
};
