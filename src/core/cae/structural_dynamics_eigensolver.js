/**
 * STRUCTURAL_DYNAMICS_EIGENSOLVER - deterministic modal analysis and
 * harmonic response verification kernels.
 *
 * Provides:
 *   - Generalized eigenproblem solution K x = lambda M x via block subspace
 *     iteration (deterministic seeded start, dense Cholesky for the inverse
 *     iteration solve). Modes are returned M-orthonormal (modal mass = 1,
 *     modal stiffness = lambda = omega^2).
 *   - Rayleigh damping coefficients alpha/beta from two target modal damping
 *     ratios: solve the exact 2x2 system
 *       [1/(2*w1), w1/2; 1/(2*w2), w2/2] * [alpha; beta] = [zeta1; zeta2].
 *   - SDOF harmonic response |X/F| = 1/sqrt((k - m*w^2)^2 + (c*w)^2) with
 *     phase = atan2(-c*w, k - m*w^2), and the exact damped resonance
 *     frequency w = wn*sqrt(1 - 2*zeta^2).
 *   - Modal superposition FRF (mass-normalized modes, Rayleigh damping) and
 *     direct full-system harmonic FRF via a dense complex solve, so the two
 *     paths can be cross-checked.
 *
 * No external runtime dependencies; 'use strict' CommonJS.
 */

'use strict';

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

function denseCholeskyFactor(A) {
  const n = A.length;
  const L = new Array(n);
  for (let i = 0; i < n; i++) L[i] = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 0)) throw new Error('StructuralEigensolver: non-positive-definite matrix in Cholesky');
        L[i][j] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}

function denseCholeskySolve(L, b) {
  const n = b.length;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

function denseMatVec(A, x) {
  const n = A.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = A[i];
    let s = 0;
    for (let j = 0; j < n; j++) s += row[j] * x[j];
    out[i] = s;
  }
  return out;
}

/**
 * Block subspace iteration for the lowest generalized eigenvalues of
 * (K, M) with K symmetric positive definite. Deterministic seeded start.
 *
 * @param {Array<Array<number>>} K dense stiffness matrix
 * @param {Array<Array<number>>} M dense mass matrix
 * @param {Object} [opts]
 * @param {number} [opts.count=6]
 * @param {number} [opts.maxIter=400]
 * @param {number} [opts.tol=1e-12]
 * @param {number} [opts.seed=0x5eed1234]
 * @returns {{ modes: Array<{lambda:number,omega:number,fHz:number,shape:Float64Array}>,
 *             iterations:number, converged:boolean }}
 */
function solveGeneralizedEigen(K, M, opts = {}) {
  const n = K.length;
  const count = Math.max(1, Math.min(opts.count || 6, n));
  const maxIter = opts.maxIter || 400;
  const tol = opts.tol || 1e-12;
  const seed = opts.seed || 0x5eed1234;
  const rng = createSeededRandom(seed);
  const mSub = Math.min(count + 3, n);

  const L = denseCholeskyFactor(K);
  let V = [];
  for (let k = 0; k < mSub; k++) {
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = rng() * 2 - 1;
    V.push(v);
  }

  function gram(a) {
    for (let k = 0; k < mSub; k++) {
      for (let pass = 0; pass < 2; pass++) {
        for (let j = 0; j < k; j++) {
          const Mv = denseMatVec(M, a[j]);
          let d = 0;
          for (let i = 0; i < n; i++) d += a[k][i] * Mv[i];
          for (let i = 0; i < n; i++) a[k][i] -= d * a[j][i];
        }
      }
      const Mv = denseMatVec(M, a[k]);
      let ns = 0;
      for (let i = 0; i < n; i++) ns += a[k][i] * Mv[i];
      const sc = Math.sqrt(Math.max(ns, 1e-30));
      for (let i = 0; i < n; i++) a[k][i] /= sc;
    }
  }

  gram(V);
  let lambda = new Float64Array(mSub).fill(1e30);
  let iterations = 0;
  let converged = false;
  for (let it = 0; it < maxIter; it++) {
    const Z = [];
    for (let k = 0; k < mSub; k++) {
      Z.push(denseCholeskySolve(L, denseMatVec(M, V[k])));
    }
    gram(Z);
    const lambdaNew = new Float64Array(mSub);
    for (let k = 0; k < mSub; k++) {
      const Kz = denseMatVec(K, Z[k]);
      const Mz = denseMatVec(M, Z[k]);
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += Z[k][i] * Kz[i];
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
 * Rayleigh damping coefficients from two target modal damping ratios.
 * Solves [1/(2*w1), w1/2; 1/(2*w2), w2/2] [alpha; beta] = [zeta1; zeta2].
 *
 * @param {number} w1
 * @param {number} w2
 * @param {number} zeta1
 * @param {number} zeta2
 * @returns {{alpha:number,beta:number}}
 */
function rayleighDampingCoefficients(w1, w2, zeta1, zeta2) {
  const den = w2 * w2 - w1 * w1;
  const alpha = (2 * w1 * w2 * (zeta1 * w2 - zeta2 * w1)) / den;
  const beta = (2 * (zeta2 * w2 - zeta1 * w1)) / den;
  return { alpha, beta };
}

/**
 * SDOF harmonic transfer H(w) = X/F = 1/(k - m*w^2 + i*c*w).
 *
 * @param {Object} p
 * @param {number} p.k
 * @param {number} p.m
 * @param {number} p.c
 * @param {number[]} omegas rad/s
 * @returns {Array<{omega:number,re:number,im:number,mag:number,phaseRad:number}>}
 */
function sdofHarmonicResponse(p, omegas) {
  const { k, m, c } = p;
  return omegas.map((omega) => {
    const denRe = k - m * omega * omega;
    const denIm = c * omega;
    const d2 = denRe * denRe + denIm * denIm;
    const re = denRe / d2;
    const im = -denIm / d2;
    return {
      omega,
      re,
      im,
      mag: Math.sqrt(re * re + im * im),
      phaseRad: Math.atan2(im, re)
    };
  });
}

/**
 * Exact damped resonance frequency of an SDOF system:
 * w_peak = wn*sqrt(1 - 2*zeta^2).
 *
 * @param {number} wn undamped natural frequency (rad/s)
 * @param {number} zeta damping ratio
 * @returns {number}
 */
function sdofResonanceFrequency(wn, zeta) {
  const arg = 1 - 2 * zeta * zeta;
  return wn * Math.sqrt(Math.max(arg, 0));
}

/**
 * Modal superposition harmonic FRF between a load DOF and a response DOF.
 * Modes must be M-orthonormal (modal mass = 1): H_pq(w) = sum_r
 * phi_p,r*phi_q,r / (lambda_r - w^2 + i*w*(alpha + beta*lambda_r)).
 *
 * @param {Array<{lambda:number,shape:Float64Array}>} modes
 * @param {Object} damp {alpha,beta} Rayleigh coefficients
 * @param {number[]} omegas rad/s
 * @param {number} loadDof
 * @param {number} responseDof
 * @returns {Array<{omega:number,re:number,im:number,mag:number,phaseRad:number}>}
 */
function modalHarmonicFRF(modes, damp, omegas, loadDof, responseDof) {
  const { alpha, beta } = damp;
  return omegas.map((omega) => {
    let re = 0;
    let im = 0;
    for (const md of modes) {
      const w2 = md.lambda;
      const den = w2 - omega * omega;
      const dampTerm = omega * (alpha + beta * md.lambda);
      const num = md.shape[responseDof] * md.shape[loadDof];
      const d2 = den * den + dampTerm * dampTerm;
      re += (num * den) / d2;
      im += (-num * dampTerm) / d2;
    }
    return {
      omega,
      re,
      im,
      mag: Math.sqrt(re * re + im * im),
      phaseRad: Math.atan2(im, re)
    };
  });
}

function denseComplexSolveReal(A, b) {
  const n = A.length;
  const N = 2 * n;
  const Ab = new Array(N);
  for (let i = 0; i < N; i++) Ab[i] = new Float64Array(N + 1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      Ab[i][j] = A[i][j].re;
      Ab[i][n + j] = -A[i][j].im;
      Ab[n + i][j] = A[i][j].im;
      Ab[n + i][n + j] = A[i][j].re;
    }
    Ab[i][N] = b[i].re;
    Ab[n + i][N] = b[i].im;
  }
  for (let col = 0; col < N; col++) {
    let piv = col;
    for (let r = col + 1; r < N; r++) {
      if (Math.abs(Ab[r][col]) > Math.abs(Ab[piv][col])) piv = r;
    }
    if (Ab[piv][col] === 0) throw new Error('StructuralEigensolver: singular system in direct harmonic solve');
    if (piv !== col) {
      const tmp = Ab[col];
      Ab[col] = Ab[piv];
      Ab[piv] = tmp;
    }
    for (let r = col + 1; r < N; r++) {
      const f = Ab[r][col] / Ab[col][col];
      for (let c = col; c <= N; c++) Ab[r][c] -= f * Ab[col][c];
    }
  }
  const x = new Float64Array(N);
  for (let r = N - 1; r >= 0; r--) {
    let s = Ab[r][N];
    for (let c = r + 1; c < N; c++) s -= Ab[r][c] * x[c];
    x[r] = s / Ab[r][r];
  }
  const out = [];
  for (let i = 0; i < n; i++) out.push({ re: x[i], im: x[n + i] });
  return out;
}

/**
 * Direct full-system harmonic FRF: solve
 * (K - w^2 M + i*w*C) x = e_load at each frequency and return x at the
 * response DOF. Used to cross-check modal superposition.
 *
 * @param {Array<Array<number>>} K
 * @param {Array<Array<number>>} M
 * @param {Array<Array<number>>} C
 * @param {number[]} omegas rad/s
 * @param {number} loadDof
 * @param {number} responseDof
 * @returns {Array<{omega:number,re:number,im:number,mag:number,phaseRad:number}>}
 */
function directHarmonicFRF(K, M, C, omegas, loadDof, responseDof) {
  const n = K.length;
  return omegas.map((omega) => {
    const A = new Array(n);
    for (let i = 0; i < n; i++) {
      A[i] = new Array(n);
      for (let j = 0; j < n; j++) {
        const kij = K[i][j] - omega * omega * M[i][j];
        const cij = omega * C[i][j];
        A[i][j] = { re: kij, im: cij };
      }
    }
    const f = new Array(n).fill({ re: 0, im: 0 });
    f[loadDof] = { re: 1, im: 0 };
    const x = denseComplexSolveReal(A, f);
    const re = x[responseDof].re;
    const im = x[responseDof].im;
    return {
      omega,
      re,
      im,
      mag: Math.sqrt(re * re + im * im),
      phaseRad: Math.atan2(im, re)
    };
  });
}

module.exports = {
  createSeededRandom,
  solveGeneralizedEigen,
  rayleighDampingCoefficients,
  sdofHarmonicResponse,
  sdofResonanceFrequency,
  modalHarmonicFRF,
  directHarmonicFRF
};
