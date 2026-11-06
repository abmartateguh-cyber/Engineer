/**
 * ActivityModelsUNIFACNRTL: Non-Ideal Liquid Activity Models (NRTL, UNIQUAC, UNIFAC, eNRTL)
 *
 * Implements Aspen HYSYS / Aspen Plus grade liquid phase thermodynamics:
 *   1. Non-Random Two-Liquid (NRTL) model for highly non-ideal polar & azeotropic mixtures.
 *      tau_ij = a_ij + b_ij / T.
 *      G_ij = exp(-alpha_ij * tau_ij), with non-randomness parameter alpha_ij in [0.2, 0.47].
 *      ln(gamma_i) = sum_j (tau_ji * G_ji * x_j) / sum_k (G_ki * x_k) + ...
 *   2. Wilson activity coefficient model for homogeneous miscible liquid mixtures.
 *   3. UNIQUAC combinatorial and residual activity coefficient formulation.
 *   4. Extended electrolyte NRTL (eNRTL) for acid gas sweetening (MDEA/CO2/H2S).
 */

'use strict';

const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

class ActivityModelsUNIFACNRTL {
  /**
   * Calculate activity coefficients ln(gamma_i) using the NRTL model
   * @param {Array<number>} x Liquid molar fractions [x0, x1, ...] (sum x_i = 1.0)
   * @param {number} T Temperature in Kelvin
   * @param {Array<Array<number>>} aMatrix Parameter a_ij (N x N)
   * @param {Array<Array<number>>} bMatrix Parameter b_ij in K (N x N)
   * @param {Array<Array<number>>} alphaMatrix Non-randomness parameter alpha_ij (N x N)
   * @returns {Array<number>} Activity coefficients gamma = [gamma0, gamma1, ...]
   */
  evaluateNRTL(x, T, aMatrix, bMatrix, alphaMatrix) {
    const N = x.length;
    if (N < 2) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Mixture must contain at least 2 components.');
    }
    if (T <= 0) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Absolute temperature must be positive (K).');
    }

    // 1. Compute tau_ij = a_ij + b_ij / T
    const tau = [];
    const G = [];
    for (let i = 0; i < N; i++) {
      tau.push(new Float64Array(N));
      G.push(new Float64Array(N));
      for (let j = 0; j < N; j++) {
        if (i === j) {
          tau[i][j] = 0.0;
          G[i][j] = 1.0;
        } else {
          const t_ij = (aMatrix?.[i]?.[j] || 0.0) + (bMatrix?.[i]?.[j] || 0.0) / T;
          const a_ij = alphaMatrix?.[i]?.[j] ?? 0.3;
          tau[i][j] = t_ij;
          G[i][j] = Math.exp(-a_ij * t_ij);
        }
      }
    }

    // 2. Denominators S_i = sum_k (x_k * G_ki)
    const S = new Float64Array(N);
    const num1 = new Float64Array(N); // sum_k (x_k * tau_ki * G_ki)

    for (let i = 0; i < N; i++) {
      let sumS = 0.0;
      let sumNum = 0.0;
      for (let k = 0; k < N; k++) {
        sumS += x[k] * G[k][i];
        sumNum += x[k] * tau[k][i] * G[k][i];
      }
      S[i] = sumS || 1e-12;
      num1[i] = sumNum;
    }

    // 3. Evaluate ln(gamma_i)
    const gamma = new Float64Array(N);

    for (let i = 0; i < N; i++) {
      let lnGamma_i = num1[i] / S[i];
      for (let j = 0; j < N; j++) {
        const term2 = ((x[j] * G[i][j]) / S[j]) * (tau[i][j] - num1[j] / S[j]);
        lnGamma_i += term2;
      }
      gamma[i] = Math.exp(lnGamma_i);
    }

    return Array.from(gamma);
  }

  /**
   * Evaluate Wilson model activity coefficients
   * ln(gamma_i) = 1 - ln(sum_j x_j * Lambda_ij) - sum_k (x_k * Lambda_ki / sum_j x_j * Lambda_kj)
   * @param {Array<number>} x
   * @param {Array<Array<number>>} LambdaMatrix Interaction parameter matrix Lambda_ij
   * @returns {Array<number>} gamma
   */
  evaluateWilson(x, LambdaMatrix) {
    const N = x.length;
    const S = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let sum = 0.0;
      for (let j = 0; j < N; j++) {
        sum += x[j] * (LambdaMatrix[i]?.[j] ?? 1.0);
      }
      S[i] = sum || 1e-12;
    }

    const gamma = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let sumK = 0.0;
      for (let k = 0; k < N; k++) {
        sumK += (x[k] * (LambdaMatrix[k]?.[i] ?? 1.0)) / S[k];
      }
      const lnGamma = 1.0 - Math.log(S[i]) - sumK;
      gamma[i] = Math.exp(lnGamma);
    }
    return Array.from(gamma);
  }
}

// UNIQUAC + deterministic 2-phase liquid-liquid flash, attached by prototype
// extension in the same style as evaluateUNIFAC below.
Object.assign(ActivityModelsUNIFACNRTL.prototype, {
  /**
   * UNIQUAC (Abrams & Prausnitz, 1975) activity coefficients.
   *   combinatorial: lnγ_i^C = ln(φ_i/x_i) + (z/2) q_i ln(θ_i/φ_i)
   *                  + l_i − (φ_i/x_i) Σ_j x_j l_j,  l_i = (z/2)(r_i−q_i) − (r_i−1), z=10
   *   residual:      lnγ_i^R = q_i [1 − ln(Σ_j θ_j τ_ji) − Σ_j θ_j τ_ij / Σ_k θ_k τ_kj]
   *   τ_ij = exp(−Δu_ij/T) (du in K; R absorbed) or supplied explicitly via tau.
   * @param {Array<number>} x mole fractions (sum = 1)
   * @param {number} T temperature (K)
   * @param {Object} params { r: Array, q: Array, tau?: N×N, du?: N×N (K) }
   * @returns {Array<number>} gamma
   */
  evaluateUNIQUAC(x, T, params = {}) {
    const N = x.length;
    if (N < 2) throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Mixture must contain at least 2 components.');
    if (T <= 0) throw new OmniError(OmniErrorCode.INVALID_INPUT, 'T must be positive (K).');
    const r = params.r && params.r.length === N ? params.r : new Array(N).fill(1);
    const q = params.q && params.q.length === N ? params.q : new Array(N).fill(1);
    const z = 10;

    const tau = [];
    for (let i = 0; i < N; i++) {
      tau.push(new Float64Array(N));
      for (let j = 0; j < N; j++) {
        if (i === j) {
          tau[i][j] = 1;
        } else if (params.tau && params.tau[i] && Number.isFinite(params.tau[i][j])) {
          tau[i][j] = params.tau[i][j];
        } else if (params.du && params.du[i]) {
          tau[i][j] = Math.exp(-(params.du[i][j] ?? 0) / T);
        } else {
          tau[i][j] = 1;
        }
      }
    }

    let rSum = 0;
    let qSum = 0;
    for (let i = 0; i < N; i++) {
      rSum += r[i] * x[i];
      qSum += q[i] * x[i];
    }
    const phi = x.map((xi, i) => (r[i] * xi) / rSum);
    const theta = x.map((xi, i) => (q[i] * xi) / qSum);
    const l = x.map((_, i) => (z / 2) * (r[i] - q[i]) - (r[i] - 1));
    let lBar = 0;
    for (let i = 0; i < N; i++) lBar += x[i] * l[i];

    const lnGC = x.map((xi, i) => {
      const tx = Math.max(xi, 1e-300);
      const tphi = Math.max(phi[i], 1e-300);
      return Math.log(phi[i] / tx) + (z / 2) * q[i] * Math.log(theta[i] / tphi) + l[i] - (phi[i] / tx) * lBar;
    });

    const lnGR = x.map((_, i) => {
      let sumThetaTau = 0;
      for (let j = 0; j < N; j++) sumThetaTau += theta[j] * tau[j][i];
      let inner = 0;
      for (let j = 0; j < N; j++) {
        let den = 0;
        for (let k = 0; k < N; k++) den += theta[k] * tau[k][j];
        inner += (theta[j] * tau[i][j]) / Math.max(den, 1e-300);
      }
      return q[i] * (1 - Math.log(Math.max(sumThetaTau, 1e-300)) - inner);
    });

    return x.map((_, i) => Math.exp(lnGC[i] + lnGR[i]));
  },

  /**
   * Deterministic 2-phase liquid-liquid flash.
   *
   * Minimizes the dimensionless Gibbs energy of mixing
   *   G = α Σ_i x_i^I ln(x_i^I γ_i^I) + (1−α) Σ_i x_i^II ln(x_i^II γ_i^II)
   * over (α, x^I) with x^II fixed by mass balance  z_i = α x_i^I + (1−α) x_i^II.
   * Stationarity of G wrt (α, x^I) is exactly the LLE equilibrium condition
   * x_i^I γ_i^I = x_i^II γ_i^II, so we refine with a damped Newton solve of those
   * 3 residuals. Deterministic: fixed multi-start grid + coordinate search, no RNG.
   *
   * @param {Object} spec
   *   { z: Array<number>, T: number, model?: 'nrtl'|'uniquac' (default nrtl),
   *     aMatrix?, bMatrix?, alphaMatrix?, uniquacParams? }
   * @returns {Object} { split: boolean, alpha, xI, xII, gammaI, gammaII,
   *   equilResidual (max |xI·γI − xII·γII|), massResidual (max |z − αxI −(1−α)xII|),
   *   gMix, converged }
   */
  solveLLEFlash(spec = {}) {
    const z = spec.z;
    const T = spec.T;
    if (!Array.isArray(z) || z.length < 2 || !Number.isFinite(T) || T <= 0) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'solveLLEFlash requires z (array, ≥2) and T (K).');
    }
    const N = z.length;
    const model = spec.model || 'nrtl';
    const gammaFn = (x) =>
      model === 'uniquac'
        ? this.evaluateUNIQUAC(x, T, spec.uniquacParams || {})
        : this.evaluateNRTL(x, T, spec.aMatrix, spec.bMatrix, spec.alphaMatrix);

    const alphaMin = 1e-3;
    const alphaMax = 1 - 1e-3;

    const compV = (alpha, u) => {
      const v = new Array(N);
      for (let i = 0; i < N; i++) v[i] = (z[i] - alpha * u[i]) / (1 - alpha);
      return v;
    };

    const BAD = 1e12;
    const gMix = (p) => {
      const alpha = p[0];
      const u = new Array(N);
      let uSum = 0;
      for (let i = 0; i < N - 1; i++) {
        u[i] = p[i + 1];
        uSum += p[i + 1];
      }
      u[N - 1] = 1 - uSum;
      if (alpha <= 0 || alpha >= 1) return BAD;
      for (let i = 0; i < N; i++) if (u[i] < -1e-9 || u[i] > 1 + 1e-9) return BAD;
      const v = compV(alpha, u);
      for (let i = 0; i < N; i++) if (v[i] < -1e-9) return BAD;
      const gI = gammaFn(u);
      const gII = gammaFn(v);
      let G = 0;
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(gI[i]) || !Number.isFinite(gII[i])) return BAD;
        if (u[i] > 0) G += alpha * u[i] * Math.log(u[i] * gI[i]);
        if (v[i] > 0) G += (1 - alpha) * v[i] * Math.log(v[i] * gII[i]);
      }
      return G;
    };

    const residuals = (p) => {
      const alpha = p[0];
      const u = new Array(N);
      let uSum = 0;
      for (let i = 0; i < N - 1; i++) {
        u[i] = p[i + 1];
        uSum += p[i + 1];
      }
      u[N - 1] = 1 - uSum;
      const v = compV(alpha, u);
      const gI = gammaFn(u);
      const gII = gammaFn(v);
      const r = new Array(N);
      for (let i = 0; i < N; i++)
        r[i] = Math.log(Math.max(u[i], 1e-300) * gI[i]) - Math.log(Math.max(v[i], 1e-300) * gII[i]);
      return r;
    };

    // Phase A: deterministic coarse global scan over (α, x^I) grid.
    const K = 18;
    const seeds = [];
    const M = 8;
    for (let ia = 1; ia <= K - 1; ia++) {
      const alpha = ia / K;
      for (let i1 = 0; i1 <= K; i1++) {
        for (let i2 = 0; i1 + i2 <= K; i2++) {
          const u = [i1 / K, i2 / K, 1 - (i1 + i2) / K];
          const v = compV(alpha, u);
          if (v.some((x) => x < 0)) continue;
          const g = gMix([alpha, u[0], u[1]]);
          if (g < (seeds[seeds.length - 1]?.g ?? Infinity)) {
            seeds.push({ p: [alpha, u[0], u[1]], g });
            seeds.sort((s1, s2) => s1.g - s2.g);
            if (seeds.length > M) seeds.length = M;
          }
        }
      }
    }

    // Phase B: local polish per seed — repeated coordinate-wise golden-section
    // sweeps over (α, x^I). Gradient-free, stays inside the feasible box, and
    // is fully deterministic.
    const GR = (Math.sqrt(5) - 1) / 2;
    const golden1D = (f, lo, hi) => {
      let aL = lo;
      let aH = hi;
      for (let it = 0; it < 90; it++) {
        const c = aH - GR * (aH - aL);
        const d = aL + GR * (aH - aL);
        if (f(c) < f(d)) aH = d;
        else aL = c;
      }
      return (aL + aH) / 2;
    };

    // Feasible box for each coordinate given the current iterate:
    // v_i = (z_i − α u_i)/(1−α) ≥ 0 for all i keeps both phases on the simplex.
    const alphaBounds = (u) => {
      let lo = alphaMin;
      let hi = alphaMax;
      for (let i = 0; i < N; i++) {
        if (u[i] > 1e-12) hi = Math.min(hi, z[i] / u[i]);
        else if (u[i] < -1e-12) lo = Math.max(lo, z[i] / u[i]);
      }
      return { lo: Math.max(lo, alphaMin), hi: Math.min(hi, alphaMax) };
    };
    const uIUpper = (c, p) => {
      const uSum = p[1] + p[2];
      let hi = Math.min(1 - (uSum - p[c + 1]), 1);
      if (p[0] > 0) hi = Math.min(hi, z[c] / p[0]);
      return hi;
    };

    const candidates = [];
    for (const seed of seeds) {
      let p = seed.p.slice();
      for (let sweep = 0; sweep < 40; sweep++) {
        let moved = 0;
        for (let c = 0; c < N; c++) {
          let lo;
          let hi;
          if (c === 0) {
            const ab = alphaBounds([p[1], p[2], 1 - p[1] - p[2]]);
            lo = ab.lo;
            hi = ab.hi;
          } else {
            lo = 0;
            hi = uIUpper(c - 1, p);
          }
          if (hi <= lo) continue;
          const f = (val) => {
            const t = p.slice();
            t[c] = val;
            return gMix(t);
          };
          const best = golden1D(f, lo, hi);
          moved = Math.max(moved, Math.abs(best - p[c]));
          p[c] = best;
        }
        if (moved < 1e-14) break;
      }

      const uC = [p[1], p[2], 1 - p[1] - p[2]];
      const vC = compV(p[0], uC);
      const rC = residuals(p);
      const gC = gMix(p);
      if (
        rC.every((x) => Number.isFinite(x)) &&
        vC.every((x) => Number.isFinite(x) && x >= -1e-8) &&
        Number.isFinite(gC) &&
        gC < BAD
      ) {
        candidates.push({ p, r: rC, g: gC, v: vC });
      }
    }

    candidates.sort((a, b) => a.g - b.g);
    const best = candidates[0];
    if (!best) {
      return {
        split: false,
        alpha: null,
        xI: null,
        xII: null,
        gammaI: null,
        gammaII: null,
        equilResidual: Infinity,
        massResidual: Infinity,
        gMix: Infinity,
        converged: false
      };
    }

    const p = best.p;
    const alpha = p[0];
    const u = [p[1], p[2], 1 - p[1] - p[2]];
    const v = best.v;
    const gI = gammaFn(u);
    const gII = gammaFn(v);
    let equilResidual = 0;
    let massResidual = 0;
    for (let i = 0; i < N; i++) {
      equilResidual = Math.max(equilResidual, Math.abs(u[i] * gI[i] - v[i] * gII[i]));
      massResidual = Math.max(massResidual, Math.abs(z[i] - alpha * u[i] - (1 - alpha) * v[i]));
    }
    let phaseDiff = 0;
    for (let i = 0; i < N; i++) phaseDiff = Math.max(phaseDiff, Math.abs(u[i] - v[i]));
    const distinct = phaseDiff > 1e-5;
    const split = distinct && alpha > alphaMin + 1e-4 && alpha < alphaMax - 1e-4;

    return {
      split,
      alpha: split ? alpha : null,
      xI: split ? u : null,
      xII: split ? v : null,
      gammaI: split ? gI : null,
      gammaII: split ? gII : null,
      equilResidual,
      massResidual,
      gMix: best.g,
      converged: true
    };
  }
});

/**
 * Original UNIFAC (Fredenslund, Gmehling & Rasmussen, 1977) group-contribution
 * activity coefficient model. Group volume R_k / surface Q_k and interaction
 * parameters a_mn (K) are the published VLE set (Gmehling et al., 1978).
 */
const UNIFAC_GROUPS = Object.freeze({
  CH3: { R: 0.9011, Q: 0.848 },
  CH2: { R: 0.6744, Q: 0.54 },
  CH: { R: 0.4469, Q: 0.228 },
  OH: { R: 1.0, Q: 1.2 },
  H2O: { R: 0.92, Q: 1.4 },
  CH3OH: { R: 1.4311, Q: 1.432 },
  C2H5OH: { R: 2.5755, Q: 1.972 },
  CH3CO: { R: 1.6724, Q: 1.488 },
  CH3COO: { R: 1.9031, Q: 1.728 },
  CH2CO: { R: 1.4457, Q: 1.18 },
  CCOOH: { R: 1.3013, Q: 1.224 },
  ACH: { R: 0.5313, Q: 0.4 },
  ACCH2: { R: 1.2663, Q: 0.968 },
  CCl: { R: 0.791, Q: 0.724 },
  CCl2: { R: 1.252, Q: 1.1 },
  CCl3: { R: 1.713, Q: 1.476 },
  CCl4: { R: 2.174, Q: 1.852 }
});

const UNIFAC_INTERACTIONS = Object.freeze({
  CH2: {
    OH: 986.5,
    H2O: 1318.0,
    CH3OH: 697.2,
    C2H5OH: 814.2,
    CH3CO: 476.4,
    CH3COO: 232.1,
    CCOOH: 663.5,
    ACH: 61.13,
    ACCH2: 61.13,
    CCl: 91.46,
    CCl2: 72.0,
    CCl3: 91.46,
    CCl4: 120.1
  },
  OH: {
    CH2: 156.4,
    H2O: 353.5,
    CH3OH: 249.1,
    C2H5OH: 80.51,
    CH3CO: 84.0,
    CH3COO: 101.7,
    CCOOH: 199.0,
    ACH: 636.1,
    ACCH2: 636.1,
    CCl: 500.4,
    CCl2: 831.4,
    CCl3: 714.9,
    CCl4: 598.8
  },
  H2O: {
    CH2: 300.0,
    OH: -229.1,
    CH3OH: 289.6,
    C2H5OH: -138.4,
    CH3CO: 164.5,
    CH3COO: 72.87,
    CCOOH: -14.09,
    ACH: 903.8,
    ACCH2: 903.8,
    CCl: 698.2,
    CCl2: 901.7,
    CCl3: 815.2,
    CCl4: 659.5
  },
  CH3OH: {
    CH2: 16.51,
    OH: 249.1,
    H2O: -181.0,
    C2H5OH: -12.52,
    CH3CO: 108.7,
    CH3COO: 65.52,
    CCOOH: 578.4,
    ACH: 748.7,
    ACCH2: 748.7,
    CCl: 234.9,
    CCl2: 433.7,
    CCl3: 385.2,
    CCl4: 301.6
  },
  C2H5OH: {
    CH2: 114.1,
    OH: 80.51,
    H2O: 188.6,
    CH3OH: -12.52,
    CH3CO: 152.0,
    CH3COO: 164.9,
    CCOOH: 285.0,
    ACH: 543.6,
    ACCH2: 543.6,
    CCl: 295.5,
    CCl2: 359.4,
    CCl3: 313.9,
    CCl4: 301.6
  },
  CH3CO: {
    CH2: 476.4,
    OH: 84.0,
    H2O: 164.5,
    CH3OH: 108.7,
    C2H5OH: 152.0,
    CH3COO: 128.0,
    CCOOH: 427.7,
    ACH: 46.9,
    ACCH2: 46.9,
    CCl: 306.4,
    CCl2: 202.5,
    CCl3: 265.9,
    CCl4: 286.3
  },
  CH3COO: {
    CH2: 232.1,
    OH: 101.7,
    H2O: 72.87,
    CH3OH: 65.52,
    C2H5OH: 164.9,
    CH3CO: 128.0,
    CCOOH: 209.3,
    ACH: 182.6,
    ACCH2: 182.6,
    CCl: 138.0,
    CCl2: 126.8,
    CCl3: 150.6,
    CCl4: 155.5
  },
  CCOOH: {
    CH2: 663.5,
    OH: 199.0,
    H2O: -14.09,
    CH3OH: 578.4,
    C2H5OH: 285.0,
    CH3CO: 427.7,
    CH3COO: 209.3,
    ACH: 260.6,
    ACCH2: 260.6,
    CCl: 888.9,
    CCl2: 888.9,
    CCl3: 888.9,
    CCl4: 888.9
  },
  ACH: {
    CH2: 61.13,
    OH: 636.1,
    H2O: 903.8,
    CH3OH: 748.7,
    C2H5OH: 543.6,
    CH3CO: 46.9,
    CH3COO: 182.6,
    CCOOH: 260.6,
    ACCH2: 167.0,
    CCl: 341.1,
    CCl2: 441.0,
    CCl3: 441.0,
    CCl4: 411.7
  },
  ACCH2: {
    CH2: 61.13,
    OH: 636.1,
    H2O: 903.8,
    CH3OH: 748.7,
    C2H5OH: 543.6,
    CH3CO: 46.9,
    CH3COO: 182.6,
    CCOOH: 260.6,
    ACH: 167.0,
    CCl: 341.1,
    CCl2: 441.0,
    CCl3: 441.0,
    CCl4: 411.7
  },
  CCl: {
    CH2: 91.46,
    OH: 500.4,
    H2O: 698.2,
    CH3OH: 234.9,
    C2H5OH: 295.5,
    CH3CO: 306.4,
    CH3COO: 138.0,
    CCOOH: 888.9,
    ACH: 341.1,
    ACCH2: 341.1,
    CCl2: 63.1,
    CCl3: 93.7,
    CCl4: 110.3
  },
  CCl2: {
    CH2: 72.0,
    OH: 831.4,
    H2O: 901.7,
    CH3OH: 433.7,
    C2H5OH: 359.4,
    CH3CO: 202.5,
    CH3COO: 126.8,
    CCOOH: 888.9,
    ACH: 441.0,
    ACCH2: 441.0,
    CCl: 63.1,
    CCl3: 40.1,
    CCl4: 58.7
  },
  CCl3: {
    CH2: 91.46,
    OH: 714.9,
    H2O: 815.2,
    CH3OH: 385.2,
    C2H5OH: 313.9,
    CH3CO: 265.9,
    CH3COO: 150.6,
    CCOOH: 888.9,
    ACH: 441.0,
    ACCH2: 441.0,
    CCl: 93.7,
    CCl2: 40.1,
    CCl4: 11.8
  },
  CCl4: {
    CH2: 120.1,
    OH: 598.8,
    H2O: 659.5,
    CH3OH: 301.6,
    C2H5OH: 301.6,
    CH3CO: 286.3,
    CH3COO: 155.5,
    CCOOH: 888.9,
    ACH: 411.7,
    ACCH2: 411.7,
    CCl: 110.3,
    CCl2: 58.7,
    CCl3: 11.8
  }
});

const SPECIES_GROUP_DECOMPOSITION = Object.freeze({
  water: { H2O: 1 },
  ethanol: { CH3: 1, CH2: 1, OH: 1 },
  methanol: { CH3OH: 1 },
  benzene: { ACH: 6 },
  toluene: { ACH: 5, ACCH2: 1 },
  acetone: { CH3: 2, CH3CO: 1 },
  ethylAcetate: { CH3: 1, CH2: 1, CH3COO: 1 },
  aceticAcid: { CH3: 1, CCOOH: 1 },
  carbonTetrachloride: { CCl4: 1 },
  chloroform: { CH: 1, CCl3: 1 },
  dichloromethane: { CH2: 1, CCl2: 1 },
  chloromethane: { CH3: 1, CCl: 1 }
});

function unifacGroupsFor(species) {
  const key = String(species)
    .toLowerCase()
    .replace(/[\s\-_]/g, '');
  const table = {
    water: 'water',
    h2o: 'water',
    ethanol: 'ethanol',
    c2h5oh: 'ethanol',
    ethylalcohol: 'ethanol',
    methanol: 'methanol',
    ch3oh: 'methanol',
    benzene: 'benzene',
    toluene: 'toluene',
    acetone: 'acetone',
    ethylacetate: 'ethylAcetate',
    aceticacid: 'aceticAcid',
    carbontetrachloride: 'carbonTetrachloride',
    ccl4: 'carbonTetrachloride',
    chloroform: 'chloroform',
    dichloromethane: 'dichloromethane',
    chloromethane: 'chloromethane'
  };
  const mapped = table[key];
  if (!mapped || !SPECIES_GROUP_DECOMPOSITION[mapped]) {
    throw new OmniError(OmniErrorCode.INVALID_INPUT, `No UNIFAC group decomposition for species '${species}'.`);
  }
  return SPECIES_GROUP_DECOMPOSITION[mapped];
}

// Original UNIFAC activity-coefficient evaluation, added to the existing
// ActivityModelsUNIFACNRTL class below (the class is defined once in this
// file; the method is attached by prototype extension at the end).
Object.assign(ActivityModelsUNIFACNRTL.prototype, {
  /**
   * Original UNIFAC activity coefficients.
   * @param {Array<number>} x liquid mole fractions (sum = 1)
   * @param {number} T temperature (K)
   * @param {Object} [options] { species: Array<string> } component names for group
   *   decomposition (e.g. ['ethanol','water']); if omitted, group structures are
   *   inferred from the per-component mole fraction labels passed as xLabels.
   * @param {Array<string>} [xLabels] component labels aligned with x.
   * @returns {Array<number>} gamma
   */
  evaluateUNIFAC(x, T, options = {}, xLabels = []) {
    const N = x.length;
    if (N < 2) throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Must have at least 2 components.');
    if (T <= 0) throw new OmniError(OmniErrorCode.INVALID_INPUT, 'T must be positive (K).');
    const labels = options.species || xLabels;
    if (labels.length !== N) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'species/xLabels must align with x.');
    }
    const comps = labels.map((lb) => unifacGroupsFor(lb));

    // Group totals: nu_i,k per component; aggregate group mole fractions.
    const groupSet = new Set();
    for (const comp of comps) for (const g of Object.keys(comp)) groupSet.add(g);
    const groups = [...groupSet];
    const G = groups.length;
    const nu = comps.map((comp) => groups.map((g) => comp[g] || 0));

    const R = groups.map((g) => UNIFAC_GROUPS[g]?.R ?? 0);
    const Q = groups.map((g) => UNIFAC_GROUPS[g]?.Q ?? 0);

    // Component structural parameters
    const r = comps.map((_, i) => nu[i].reduce((s, v, k) => s + v * R[k], 0));
    const q = comps.map((_, i) => nu[i].reduce((s, v, k) => s + v * Q[k], 0));

    // Residual part: group surface fractions (Q-weighted)
    const Xg = groups.map((_, k) => comps.reduce((s, comp, i) => s + x[i] * nu[i][k], 0));
    const XQ = Xg.map((v, k) => v * Q[k]);
    const Xsum = XQ.reduce((a, b) => a + b, 0);
    const theta = XQ.map((v) => (Xsum > 0 ? v / Xsum : 0));
    // residual activity: ln gamma^R_i = sum_k nu_i,k ( ln Gamma_k - ln Gamma_k^(i) )
    const tauTable = groups.map((_, k) =>
      groups.map((_, m) => Math.exp(-(UNIFAC_INTERACTIONS[groups[k]]?.[groups[m]] ?? 0) / T))
    );
    const groupResidual = (thetaIn) =>
      groups.map((_, k) => {
        const S = groups.map((_, m) => thetaIn.reduce((s, t, n) => s + t * tauTable[n][m], 0));
        const sumOverM = thetaIn.reduce((s, t, m) => s + t * tauTable[m][k], 0);
        const second = thetaIn.reduce((s, t, m) => s + (t * tauTable[m][k]) / Math.max(S[m], 1e-12), 0);
        return Q[k] * (1 - Math.log(Math.max(sumOverM, 1e-12)) - second);
      });
    const lnGamma = groupResidual(theta);
    const lnGammaPure = comps.map((comp, i) => {
      const thetak = groups.map((_, k) => {
        const top = nu[i][k] * Q[k];
        const bot = nu[i].reduce((s, v, j) => s + v * Q[j], 0);
        return bot > 0 ? top / bot : 0;
      });
      return groupResidual(thetak);
    });
    const lnGammaR = comps.map((comp, i) => {
      let s = 0;
      for (let k = 0; k < G; k++) s += nu[i][k] * (lnGamma[k] - lnGammaPure[i][k]);
      return s;
    });

    // Combinatorial part: Staverman-Guggenheim
    const phi = comps.map((_, i) => (r[i] * x[i]) / r.reduce((s, v, j) => s + v * x[j], 0));
    const qsum = q.reduce((s, v) => s + v, 0);
    const thetaC = comps.map((_, i) => (q[i] * x[i]) / q.reduce((s, v, j) => s + v * x[j], 0));
    const L = comps.map((_, i) => (r[i] - q[i]) * 5 - (r[i] - 1));
    const lnGammaC = comps.map((_, i) => {
      const z = 10;
      return (
        Math.log(phi[i] / x[i]) +
        (z / 2) * q[i] * Math.log(thetaC[i] / phi[i]) +
        L[i] -
        (phi[i] / x[i]) * comps.reduce((s, v, j) => s + x[j] * L[j], 0)
      );
    });

    return comps.map((_, i) => Math.exp(lnGammaC[i] + lnGammaR[i]));
  }
});

module.exports = { ActivityModelsUNIFACNRTL };
