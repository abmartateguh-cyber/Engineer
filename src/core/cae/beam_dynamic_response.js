/**
 * BEAM_DYNAMIC_RESPONSE - deterministic modal solver for discretized
 * cantilever/tower beams (consistent mass) plus harmonic FRF (direct
 * frequency sweep, modal superposition) and random-vibration PSD response
 * with Rayleigh damping.
 *
 * The beam is a straight 1-D axis (nodes along the axis). Each node has the
 * two bending degrees of freedom of the selected plane: transverse deflection
 * `w` and cross-section rotation `theta` about the bending axis. Elements are
 * 2-node Timoshenko beam elements (shear flexibility included, 5/6 shear
 * factor) with the standard consistent mass matrix (translational cubic
 * Hermite terms plus rotary-inertia terms). Point masses can be lumped onto
 * nodes, base rotational springs and fixed DOFs are supported.
 *
 * Modal analysis uses block subspace iteration (deterministic seeded start)
 * with the production `WasmSparseMultifrontalSolver` (direct sparse
 * Cholesky) for the inverse iteration solve. The projection is restated in
 * M-orthonormalized form; eigenvalues are Rayleigh quotients of the
 * orthonormalized subspace.
 *
 * Harmonic FRF is evaluated by modal superposition at every frequency point
 * of the sweep grid (a direct sweep over the requested frequencies), with
 * Rayleigh damping C = alpha*M + beta*K:
 *   H_pq(omega) = sum_r phi_p,r phi_q,r / (omega_r^2 - omega^2 + i*omega*(alpha + beta*omega_r^2))
 *
 * Random vibration: for an input PSD (force or base motion) applied at one
 * DOF, response PSD at a response DOF is |H|^2 * S_in; RMS is obtained by
 * trapezoidal integration over the sweep band.
 */

'use strict';

const { WasmSparseMultifrontalSolver } = require('../math/wasm_sparse_multifrontal');

/**
 * Deterministic seeded pseudo-random generator (mulberry32).
 */
function createSeededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Euler-Bernoulli cantilever fundamental constant: first root of
 * cos(bL) cosh(bL) = -1.
 */
const CANTILEVER_BETA1L = 1.87510406871196;

function eulerBernoulliCantileverFrequencyHz(omega1) {
  return omega1 / (2 * Math.PI);
}

function eulerBernoulliCantileverOmega1(p) {
  return CANTILEVER_BETA1L * CANTILEVER_BETA1L * Math.sqrt((p.E * p.I) / (p.rho * p.A * Math.pow(p.L, 4)));
}

/**
 * CSR-like sparse row storage helper.
 */
function addEntry(rows, i, j, v) {
  const r = rows[i];
  for (let k = 0; k < r.length; k += 2) {
    if (r[k] === j) {
      r[k + 1] += v;
      return;
    }
  }
  r.push(j, v);
}

function matVec(rows, x, n) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    let s = 0;
    for (let k = 0; k < r.length; k += 2) s += r[k + 1] * x[r[k]];
    out[i] = s;
  }
  return out;
}

function rowDiag(rows, n) {
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    for (let k = 0; k < r.length; k += 2) {
      if (r[k] === i) d[i] += r[k + 1];
    }
  }
  return d;
}

/**
 * Assemble the global and reduced (K, M) bending system for a beam model.
 *
 * @param {Object} cfg
 * @param {number[]} cfg.nodesY axial coordinates of the nodes (m)
 * @param {Array<{a:number,b:number,width:number,depth:number}>} cfg.elements
 *        elements; `a`/`b` are 0-based node indices, `width`/`depth` the
 *        rectangular cross-section dimensions (m)
 * @param {number} cfg.E Young's modulus (Pa)
 * @param {number} cfg.nu Poisson ratio
 * @param {number} cfg.rho density (kg/m^3)
 * @param {Map<number,number>} [cfg.masses] point masses keyed by node index (kg)
 * @param {Set<number>} [cfg.fixedDofs] global DOF indices to remove
 * @param {Map<number,number>} [cfg.springDofs] global DOF -> rotational/translational spring stiffness
 * @param {boolean} [cfg.strongPlane=false] use the perpendicular bending plane
 *        (I = depth*width^3/12 instead of width*depth^3/12)
 * @returns {{ Kred:Array, Mred:Array, nr:number, factor:Object, map:Int32Array,
 *             n:number, nNodes:number }}
 */
function assembleBeamSystem(cfg) {
  const { nodesY, elements, E, nu, rho } = cfg;
  const strongPlane = Boolean(cfg.strongPlane);
  const masses = cfg.masses || new Map();
  const fixedDofs = cfg.fixedDofs || new Set();
  const springDofs = cfg.springDofs || new Map();
  const G = E / (2 * (1 + nu));
  const kShear = 5 / 6;

  const nNodes = nodesY.length;
  const n = 2 * nNodes;
  const Krows = new Array(n);
  const Mrows = new Array(n);
  for (let i = 0; i < n; i++) {
    Krows[i] = [];
    Mrows[i] = [];
  }

  for (const el of elements) {
    const { a, b } = el;
    const width = el.width;
    const depth = el.depth;
    const le = nodesY[b] - nodesY[a];
    if (!(le > 0)) throw new Error(`BeamDynamic: non-positive element length at element a=${a}, b=${b}`);
    const A = width * depth;
    const I = strongPlane ? (depth * width * width * width) / 12 : (width * depth * depth * depth) / 12;
    const Phi = (12 * E * I) / (kShear * G * A * le * le);
    const c = 1 + Phi;
    const EI = E * I;
    const k1 = (12 * EI) / (le * le * le * c);
    const k2 = (6 * EI) / (le * le * c);
    const k3 = ((4 + Phi) * EI) / (le * c);
    const k4 = ((2 - Phi) * EI) / (le * c);
    const Ke = [k1, k2, -k1, k2, k2, k3, -k2, k4, -k1, -k2, k1, -k2, k2, k4, -k2, k3];
    const rA = rho * A * le;
    const rI = rho * I * le;
    const mEl = [
      156 / 420,
      (22 * le) / 420,
      54 / 420,
      (-13 * le) / 420,
      (22 * le) / 420,
      (4 * le * le) / 420,
      (13 * le) / 420,
      (-3 * le * le) / 420,
      54 / 420,
      (13 * le) / 420,
      156 / 420,
      (-22 * le) / 420,
      (-13 * le) / 420,
      (-3 * le * le) / 420,
      (-22 * le) / 420,
      (4 * le * le) / 420
    ];
    const mRot = [
      36 / 30,
      (3 * le) / 30,
      -36 / 30,
      (3 * le) / 30,
      (3 * le) / 30,
      (4 * le * le) / 30,
      (-3 * le) / 30,
      (-le * le) / 30,
      -36 / 30,
      (-3 * le) / 30,
      36 / 30,
      (-3 * le) / 30,
      (3 * le) / 30,
      (-le * le) / 30,
      (-3 * le) / 30,
      (4 * le * le) / 30
    ];
    const d = [2 * a, 2 * a + 1, 2 * b, 2 * b + 1];
    for (let r = 0; r < 4; r++) {
      for (let cc = 0; cc < 4; cc++) {
        addEntry(Krows, d[r], d[cc], Ke[r * 4 + cc]);
        addEntry(Mrows, d[r], d[cc], rA * mEl[r * 4 + cc] + rI * mRot[r * 4 + cc]);
      }
    }
  }

  for (const [dof, k] of springDofs) addEntry(Krows, dof, dof, k);
  for (const [node, m] of masses) addEntry(Mrows, 2 * node, 2 * node, m);

  const map = new Int32Array(n).fill(-1);
  let nr = 0;
  for (let i = 0; i < n; i++) if (!fixedDofs.has(i)) map[i] = nr++;

  const Kred = new Array(nr);
  const Mred = new Array(nr);
  for (let i = 0; i < nr; i++) {
    Kred[i] = [];
    Mred[i] = [];
  }
  for (let i = 0; i < n; i++) {
    if (map[i] < 0) continue;
    const r = Krows[i];
    for (let k = 0; k < r.length; k += 2) {
      const j = r[k];
      if (map[j] < 0) continue;
      addEntry(Kred, map[i], map[j], r[k + 1]);
    }
    const rm = Mrows[i];
    for (let k = 0; k < rm.length; k += 2) {
      const j = rm[k];
      if (map[j] < 0) continue;
      addEntry(Mred, map[i], map[j], rm[k + 1]);
    }
  }

  const factor = new WasmSparseMultifrontalSolver(nr, nr);
  for (let i = 0; i < nr; i++) {
    const r = Kred[i];
    for (let k = 0; k < r.length; k += 2) factor.addEntry(i, r[k], r[k + 1]);
  }
  factor.finalizeCSR();
  factor.factorize();

  return { Kred, Mred, nr, factor, map, n, nNodes, Krows, Mrows };
}

/**
 * Block subspace iteration for the lowest eigenvalues of (K, M).
 *
 * @param {Object} system from assembleBeamSystem
 * @param {Object} [opts]
 * @param {number} [opts.count=6] number of modes requested
 * @param {number} [opts.maxIter=300]
 * @param {number} [opts.tol=1e-11]
 * @param {number} [opts.seed=0x5eed1234]
 * @returns {{ modes: Array<{lambda:number,omega:number,fHz:number,shape:Float64Array}>,
 *             iterations:number, converged:boolean }}
 */
function solveModalSubspace(system, opts = {}) {
  const { Kred, Mred, nr } = system;
  const count = Math.max(1, Math.min(opts.count || 6, nr));
  const maxIter = opts.maxIter || 300;
  const tol = opts.tol || 1e-11;
  const seed = opts.seed || 0x5eed1234;
  const rng = createSeededRandom(seed);

  const mSub = Math.min(count + 3, nr);
  let V = [];
  for (let k = 0; k < mSub; k++) {
    const v = new Float64Array(nr);
    for (let i = 0; i < nr; i++) v[i] = rng() * 2 - 1;
    V.push(v);
  }

  function gram(a) {
    for (let k = 0; k < mSub; k++) {
      for (let pass = 0; pass < 2; pass++) {
        for (let j = 0; j < k; j++) {
          const Mv = matVec(Mred, a[j], nr);
          let d = 0;
          for (let i = 0; i < nr; i++) d += a[k][i] * Mv[i];
          for (let i = 0; i < nr; i++) a[k][i] -= d * a[j][i];
        }
      }
      const Mv = matVec(Mred, a[k], nr);
      let ns = 0;
      for (let i = 0; i < nr; i++) ns += a[k][i] * Mv[i];
      const sc = Math.sqrt(Math.max(ns, 1e-30));
      for (let i = 0; i < nr; i++) a[k][i] /= sc;
    }
  }

  gram(V);
  let lambda = new Float64Array(mSub).fill(1e30);
  let iterations = 0;
  let converged = false;
  for (let it = 0; it < maxIter; it++) {
    const Z = [];
    for (let k = 0; k < mSub; k++) Z.push(system.factor.solve(matVec(Mred, V[k], nr)).solution);
    gram(Z);
    const lambdaNew = new Float64Array(mSub);
    const KZ = Z.map((z) => matVec(Kred, z, nr));
    for (let k = 0; k < mSub; k++) {
      const Mz = matVec(Mred, Z[k], nr);
      let num = 0;
      let den = 0;
      for (let i = 0; i < nr; i++) {
        num += Z[k][i] * KZ[k][i];
        den += Z[k][i] * Mz[i];
      }
      lambdaNew[k] = den > 0 ? num / den : 1e30;
    }
    V = Z;
    let d = 0;
    for (let k = 0; k < mSub; k++) d = Math.max(d, Math.abs(lambdaNew[k] - lambda[k]));
    lambda = lambdaNew;
    iterations = it + 1;
    if (d < tol * Math.max(lambda[0], 1e-30)) {
      converged = true;
      break;
    }
  }

  const modes = [];
  for (let k = 0; k < count; k++) {
    const lambdaK = Math.max(lambda[k], 0);
    const omega = Math.sqrt(lambdaK);
    modes.push({
      lambda: lambdaK,
      omega,
      fHz: omega / (2 * Math.PI),
      shape: V[k]
    });
  }
  return { modes, iterations, converged };
}

/**
 * Rayleigh damping coefficients from two modal damping ratios.
 * @param {number[]} omegaSelected rad/s frequencies at which xi targets are given
 * @param {number[]} xiTargets damping ratios
 * @returns {{alpha:number,beta:number}}
 */
function rayleighFromTargets(omegaSelected, xiTargets) {
  const w1 = omegaSelected[0];
  const w2 = omegaSelected[1] || omegaSelected[0] * 4;
  const x1 = xiTargets[0];
  const x2 = xiTargets[1] || xiTargets[0];
  const alpha = (2 * w1 * w2 * (x1 * w2 - x2 * w1)) / (w2 * w2 - w1 * w1);
  const beta = (2 * (x2 * w2 - x1 * w1)) / (w2 * w2 - w1 * w1);
  return { alpha, beta };
}

/**
 * Harmonic FRF by modal superposition (direct frequency sweep).
 *
 * @param {Object} system
 * @param {Object} params
 * @param {Array} params.modes from solveModalSubspace
 * @param {number[]} params.frequenciesHz sweep grid
 * @param {number} params.alpha Rayleigh damping mass coefficient
 * @param {number} params.beta Rayleigh damping stiffness coefficient
 * @param {number} params.loadDof reduced DOF index of the applied load
 * @param {number} params.responseDof reduced DOF index of the response
 * @returns {Array<{f:number, Hre:number, Him:number, mag:number, phaseDeg:number}>}
 */
function harmonicFRF(system, params) {
  const { modes, frequenciesHz, alpha, beta, loadDof, responseDof } = params;
  const out = [];
  for (const f of frequenciesHz) {
    const omega = 2 * Math.PI * f;
    let re = 0;
    let im = 0;
    for (const md of modes) {
      const w2 = md.lambda;
      const den = w2 - omega * omega;
      const damp = omega * (alpha + beta * md.lambda);
      const num = md.shape[responseDof] * md.shape[loadDof];
      const d2 = den * den + damp * damp;
      re += (num * den) / d2;
      im += (-num * damp) / d2;
    }
    out.push({
      f,
      Hre: re,
      Him: im,
      mag: Math.sqrt(re * re + im * im),
      phaseDeg: (Math.atan2(im, re) * 180) / Math.PI
    });
  }
  return out;
}

/**
 * Random-vibration response to an input PSD applied at one DOF.
 *
 * @param {Object} system
 * @param {Object} params
 * @param {Array} params.modes
 * @param {Array<{f:number,S:number}>} params.inputPsd input PSD (amplitude per Hz)
 * @param {number} params.alpha
 * @param {number} params.beta
 * @param {number} params.loadDof
 * @param {number} params.responseDof
 * @returns {{ points: Array<{f:number,frfMag:number,psdOut:number}>, rms:number }}
 */
function randomVibrationPSD(system, params) {
  const { modes, inputPsd, alpha, beta, loadDof, responseDof } = params;
  const freqs = inputPsd.map((p) => p.f);
  const frf = harmonicFRF(system, { modes, frequenciesHz: freqs, alpha, beta, loadDof, responseDof });
  const points = [];
  let integral = 0;
  for (let i = 0; i < frf.length; i++) {
    const psdOut = frf[i].mag * frf[i].mag * inputPsd[i].S;
    points.push({ f: frf[i].f, frfMag: frf[i].mag, psdOut });
    if (i > 0) {
      const df = frf[i].f - frf[i - 1].f;
      integral += 0.5 * (points[i - 1].psdOut + psdOut) * df;
    }
  }
  return { points, rms: Math.sqrt(Math.max(integral, 0)) };
}

module.exports = {
  createSeededRandom,
  CANTILEVER_BETA1L,
  eulerBernoulliCantileverOmega1,
  eulerBernoulliCantileverFrequencyHz,
  assembleBeamSystem,
  solveModalSubspace,
  rayleighFromTargets,
  harmonicFRF,
  randomVibrationPSD
};
