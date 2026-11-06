/**
 * Non-equilibrium rate-based packed-column model.
 *
 * Implements the two-film theory of mass transfer with a Maxwell-Stefan
 * correction for multicomponent diffusivity, Onda correlations for packed
 * columns (wetted area, liquid-film and vapor-film coefficients), and direct
 * packing-height calculation (height of an overall gas-phase transfer unit
 * H_OG times number of transfer units N_OG, or equivalently the integral of
 * the rate equation along the column).
 *
 * The model is self-contained and deterministic: no external dependencies, no
 * bundled property database.  All physical inputs are supplied explicitly by
 * the caller with units documented in the JSDoc of each method.
 */

'use strict';

const GRAVITY = 9.80665; // m / s^2
const R_GAS = 8.314462618; // J / (mol * K)
const R_GAS_KMOL = 8314.462618; // J / (kmol * K), used so Onda k_G is kmol-based

/**
 * Small, dependency-free dense matrix helpers (3x3 and smaller).
 */

/** Matrix-vector product. */
function matVec(A, v) {
  const n = A.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i][j] * v[j];
    out[i] = s;
  }
  return out;
}

/** Determinant of a square matrix (cofactor expansion, small sizes only). */
function determinant(M) {
  const n = M.length;
  if (n === 1) return M[0][0];
  if (n === 2) return M[0][0] * M[1][1] - M[0][1] * M[1][0];
  let det = 0;
  for (let j = 0; j < n; j++) {
    const sub = [];
    for (let i = 1; i < n; i++) {
      const row = [];
      for (let k = 0; k < n; k++) if (k !== j) row.push(M[i][k]);
      sub.push(row);
    }
    det += (j % 2 === 0 ? 1 : -1) * M[0][j] * determinant(sub);
  }
  return det;
}

/** Inverse of a square matrix via cofactors (small sizes only). Throws if singular. */
function inverseMatrix(M) {
  const n = M.length;
  const det = determinant(M);
  if (!Number.isFinite(det) || det === 0) {
    throw new Error(`RateBased: matrix is singular (det=${det}).`);
  }
  const inv = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) {
      const sub = [];
      for (let r = 0; r < n; r++) {
        if (r === i) continue;
        const srow = [];
        for (let c = 0; c < n; c++) {
          if (c === j) continue;
          srow.push(M[r][c]);
        }
        sub.push(srow);
      }
      row.push((((i + j) % 2 === 0 ? 1 : -1) * determinant(sub)) / det);
    }
    inv.push(row);
  }
  return inv;
}

/**
 * Sylvester criterion: a real symmetric matrix is positive definite iff all
 * leading principal minors are positive. Only used for <= 3x3 matrices here.
 */
function isSymmetricPositiveDefinite(M) {
  const n = M.length;
  for (let k = 1; k <= n; k++) {
    const minor = [];
    for (let i = 0; i < k; i++) {
      const row = [];
      for (let j = 0; j < k; j++) row.push(M[i][j]);
      minor.push(row);
    }
    if (!(determinant(minor) > 0)) return false;
  }
  return true;
}

/** Symmetric part of a square matrix. */
function symmetricPart(M) {
  const n = M.length;
  const S = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) row.push((M[i][j] + M[j][i]) / 2);
    S.push(row);
  }
  return S;
}

/**
 * Adaptive Simpson quadrature (deterministic, fixed maximum recursion depth).
 * Returns the integral of f over [a, b] with relative/absolute tolerance tol.
 */
function adaptiveSimpson(f, a, b, tol, maxDepth) {
  const depthLimit = maxDepth === undefined ? 24 : maxDepth;
  function simpson(x0, x1, f0, fm, f1) {
    return ((x1 - x0) * (f0 + 4 * fm + f1)) / 6;
  }
  function rec(x0, x1, f0, fm, f1, whole, depth) {
    const xm = (x0 + x1) / 2;
    const xl = (x0 + xm) / 2;
    const xr = (xm + x1) / 2;
    const fl = f(xl);
    const fr = f(xr);
    const left = simpson(x0, xm, f0, fl, fm);
    const right = simpson(xm, x1, fm, fr, f1);
    const delta = left + right - whole;
    if (depth >= depthLimit || Math.abs(delta) <= 15 * tol) {
      return left + right + delta / 15;
    }
    return rec(x0, xm, f0, fl, fm, left, depth + 1) + rec(xm, x1, fm, fr, f1, right, depth + 1);
  }
  const fa = f(a);
  const fb = f(b);
  const fm = f((a + b) / 2);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || !Number.isFinite(fm)) {
    throw new Error('RateBased: integrand is not finite on the interval.');
  }
  return rec(a, b, fa, fm, fb, simpson(a, b, fa, fm, fb), 0);
}

/**
 * Maxwell-Stefan correction for multicomponent diffusion.
 *
 * Builds the generalized Fick matrix from binary-pair diffusivities using the
 * simplified MS friction matrix:   O_ii = sum_{j!=i} x_j / D_ij,
 * O_ij = -x_i / D_ij.  Because row sums vanish (the system is singular before
 * fixing a reference frame), one component is dropped and the reduced
 * (N-1)x(N-1) matrix is inverted to give the effective diffusivity matrix.
 * The symmetric part of the reduced matrix is positive definite (it is the
 * dissipation ( of the multicomponent friction problem), which we expose for
 * verification.
 */
function maxwellStefanEffectiveDiffusivity(x, Dij, droppedIndex) {
  const n = x.length;
  if (!Array.isArray(x) || n < 2 || !Array.isArray(Dij) || Dij.length !== n) {
    throw new TypeError('RateBased: Maxwell-Stefan input must be an N-vector and N x N matrix.');
  }
  for (let i = 0; i < n; i++) {
    if (!(x[i] > 0) || !Number.isFinite(x[i])) {
      throw new TypeError(`RateBased: mole fractions must be positive (x[${i}]=${x[i]}).`);
    }
    if (!Array.isArray(Dij[i]) || Dij[i].length !== n) {
      throw new TypeError('RateBased: Dij must be an N x N binary-pair diffusivity matrix.');
    }
    for (let j = 0; j < n; j++) {
      if (!(Dij[i][j] > 0) || !Number.isFinite(Dij[i][j])) {
        throw new TypeError(`RateBased: Dij[${i}][${j}] must be positive and finite.`);
      }
    }
  }
  const drop = droppedIndex === undefined ? n - 1 : droppedIndex;
  if (drop < 0 || drop >= n) throw new RangeError('RateBased: droppedIndex out of range.');
  const r = n - 1;

  const Omega = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      if (i === j) {
        let s = 0;
        for (let k = 0; k < n; k++) if (k !== i) s += x[k] / Dij[i][k];
        row[j] = s;
      } else {
        row[j] = -x[i] / Dij[i][j];
      }
    }
    Omega.push(row);
  }

  const order = [];
  for (let i = 0; i < n; i++) if (i !== drop) order.push(i);
  const Breduced = [];
  for (const i of order) {
    const row = [];
    for (const j of order) row.push(Omega[i][j]);
    Breduced.push(row);
  }
  const Deff = inverseMatrix(Breduced);
  return {
    omega: Omega,
    reducedOrder: order,
    droppedIndex: drop,
    breduced: Breduced,
    deff: Deff,
    deffSymmetric: symmetricPart(Deff),
    positiveDefinite: isSymmetricPositiveDefinite(symmetricPart(Deff)),
    diagonal: Deff.map((row, i) => row[i])
  };
}

/**
 * Douglas correlations for wetted area and film mass-transfer coefficients in
 * packed columns (ceramic/metal/plastic random packings).  All inputs are SI.
 */
class OndaCorrelations {
  /**
   * @param {Object} packing
   * @param {number} packing.ac  specific surface area of the dry packing, m^2 / m^3
   * @param {number} packing.dp  nominal packing size, m
   * @param {number} [packing.sigmaC] critical surface tension of packing material,
   *                 N/m (ceramic ~ 0.061, metal ~ 0.075, plastic ~ 0.033)
   */
  constructor(packing) {
    if (!packing || typeof packing !== 'object') {
      throw new TypeError('RateBased: Onda correlations require a packing record.');
    }
    const { ac, dp, sigmaC } = packing;
    if (!(ac > 0) || !Number.isFinite(ac)) throw new TypeError('RateBased: packing.ac must be positive.');
    if (!(dp > 0) || !Number.isFinite(dp)) throw new TypeError('RateBased: packing.dp must be positive.');
    this.ac = ac;
    this.dp = dp;
    this.sigmaC = sigmaC === undefined ? 0.061 : sigmaC;
    if (!(this.sigmaC > 0) || !Number.isFinite(this.sigmaC)) {
      throw new TypeError('RateBased: packing.sigmaC must be positive.');
    }
  }

  /**
   * Wetted area a_w (m^2 / m^3).
   * @param {Object} liq liquid side
   * @param {number} liq.L    superficial liquid mass velocity, kg / (m^2 * s)
   * @param {number} liq.rhoL liquid density, kg / m^3
   * @param {number} liq.muL  liquid dynamic viscosity, Pa * s
   * @param {number} liq.sigmaL liquid surface tension, N/m
   */
  wettedArea(liq) {
    const { L, rhoL, muL, sigmaL } = liq;
    for (const [k, v] of Object.entries({ L, rhoL, muL, sigmaL })) {
      if (!(v > 0) || !Number.isFinite(v)) throw new TypeError(`RateBased: ${k} must be positive.`);
    }
    const ReL = L / (this.ac * muL);
    const FrL = (L * L * this.ac) / (rhoL * rhoL * GRAVITY);
    const WeL = (L * L) / (rhoL * sigmaL * this.ac);
    const sigmaRatio = Math.pow(this.sigmaC / sigmaL, 0.75);
    const exponent = -1.45 * sigmaRatio * Math.pow(ReL, 0.1) * Math.pow(FrL, -0.05) * Math.pow(WeL, 0.2);
    return this.ac * (1 - Math.exp(exponent));
  }

  /**
   * Liquid-film mass-transfer coefficient k_L (m/s).
   * @param {Object} liq as in wettedArea(), plus DL (liquid diffusivity, m^2/s)
   */
  liquidCoefficient(liq) {
    const { L, rhoL, muL, sigmaL, DL } = liq;
    for (const [k, v] of Object.entries({ L, rhoL, muL, sigmaL, DL })) {
      if (!(v > 0) || !Number.isFinite(v)) throw new TypeError(`RateBased: ${k} must be positive.`);
    }
    const ReL = L / (this.ac * muL);
    const ScL = muL / (rhoL * DL);
    return (
      0.0051 *
      Math.pow(ReL, 2 / 3) *
      Math.pow(ScL, -0.5) *
      Math.pow(this.ac * this.dp, 0.4) *
      Math.pow((GRAVITY * muL) / rhoL, 1 / 3)
    );
  }

  /**
   * Vapor-film mass-transfer coefficient k_G in mole-fraction driving-force
   * units: kmol / (m^2 * s) per unit y driving force (equals the classical
   * Onda k_G at P atm multiplied by total pressure).
   * @param {Object} gas gas side
   * @param {number} gas.G    superficial vapor mass velocity, kg / (m^2 * s)
   * @param {number} gas.rhoG vapor density, kg / m^3
   * @param {number} gas.muG  vapor dynamic viscosity, Pa * s
   * @param {number} gas.DG   vapor-phase diffusivity of the transferring species, m^2 / s
   * @param {number} gas.P    total pressure, Pa
   * @param {number} gas.T    temperature, K
   */
  vaporCoefficient(gas) {
    const { G, rhoG, muG, DG, P, T } = gas;
    for (const [k, v] of Object.entries({ G, rhoG, muG, DG, P, T })) {
      if (!(v > 0) || !Number.isFinite(v)) throw new TypeError(`RateBased: ${k} must be positive.`);
    }
    const ReG = G / (this.ac * muG);
    const ScG = muG / (rhoG * DG);
    const C = this.dp < 0.015 ? 5.23 : 2.0;
    return (
      C *
      ((this.ac * DG * P) / (R_GAS_KMOL * T)) *
      Math.pow(ReG, 0.7) *
      Math.pow(ScG, 1 / 3) *
      Math.pow(this.ac * this.dp, -2)
    );
  }
}

/**
 * Rate-based packed column: combines the Onda film coefficients with the
 * two-film model and the height integral.  All flows are superficial molar
 * fluxes (kmol / (m^2 * s)); mass fluxes for Onda are derived internally.
 */
class RateBasedPackedColumn {
  /**
   * @param {Object} cfg
   * @param {Object} cfg.packing  Onda packing record ({ac, dp, sigmaC})
   * @param {Object} cfg.flows
   * @param {number} cfg.flows.G  vapor superficial molar flux, kmol / (m^2 * s)
   * @param {number} cfg.flows.L  liquid superficial molar flux, kmol / (m^2 * s)
   * @param {Object} cfg.liq
   * @param {number} cfg.liq.rhoL liquid density, kg / m^3
   * @param {number} cfg.liq.muL  liquid viscosity, Pa * s
   * @param {number} cfg.liq.sigmaL liquid surface tension, N/m
   * @param {number} cfg.liq.DL   solute liquid diffusivity, m^2 / s
   * @param {number} cfg.liq.MwL  liquid molar mass, kg / kmol
   * @param {Object} cfg.gas
   * @param {number} cfg.gas.rhoG vapor density, kg / m^3
   * @param {number} cfg.gas.muG  vapor viscosity, Pa * s
   * @param {number} cfg.gas.DG   solute vapor diffusivity, m^2 / s
   * @param {number} cfg.gas.MwG  vapor molar mass, kg / kmol
   * @param {number} cfg.P total pressure, Pa
   * @param {number} cfg.T temperature, K
   */
  constructor(cfg) {
    if (!cfg || typeof cfg !== 'object') throw new TypeError('RateBased: constructor requires a config object.');
    const { packing, flows, liq, gas, P, T } = cfg;
    if (!flows || !liq || !gas || !(P > 0) || !(T > 0)) {
      throw new TypeError('RateBased: flows, liq, gas, P, T are all required.');
    }
    this.onda = new OndaCorrelations(packing);
    this.G = flows.G;
    this.L = flows.L;
    if (!(this.G > 0) || !(this.L > 0) || !Number.isFinite(this.G) || !Number.isFinite(this.L)) {
      throw new TypeError('RateBased: flows.G and flows.L must be positive molar fluxes.');
    }
    this.liq = liq;
    this.gas = gas;
    this.P = P;
    this.T = T;
    for (const key of ['rhoL', 'muL', 'sigmaL', 'DL', 'MwL']) {
      if (!(liq[key] > 0) || !Number.isFinite(liq[key])) {
        throw new TypeError(`RateBased: liq.${key} must be positive.`);
      }
    }
    for (const key of ['rhoG', 'muG', 'DG', 'MwG']) {
      if (!(gas[key] > 0) || !Number.isFinite(gas[key])) {
        throw new TypeError(`RateBased: gas.${key} must be positive.`);
      }
    }
    this.cLiquid = liq.rhoL / liq.MwL; // kmol / m^3
    this.cVapor = P / (R_GAS * T); // kmol / m^3
  }

  /** Liquid superficial mass velocity, kg / (m^2 * s). */
  liquidMassFlux() {
    return this.L * this.liq.MwL;
  }

  /** Vapor superficial mass velocity, kg / (m^2 * s). */
  vaporMassFlux() {
    return this.G * this.gas.MwG;
  }

  /** Onda wetted area a_w, m^2 / m^3. */
  wettedArea() {
    return this.onda.wettedArea({
      L: this.liquidMassFlux(),
      rhoL: this.liq.rhoL,
      muL: this.liq.muL,
      sigmaL: this.liq.sigmaL
    });
  }

  /** Liquid-film coefficient k_L, m/s. */
  liquidCoefficient() {
    return this.onda.liquidCoefficient({
      L: this.liquidMassFlux(),
      rhoL: this.liq.rhoL,
      muL: this.liq.muL,
      sigmaL: this.liq.sigmaL,
      DL: this.liq.DL
    });
  }

  /** Vapor-film coefficient k_G, kmol / (m^2 * s) per unit y driving force. */
  vaporCoefficient() {
    return this.onda.vaporCoefficient({
      G: this.vaporMassFlux(),
      rhoG: this.gas.rhoG,
      muG: this.gas.muG,
      DG: this.gas.DG,
      P: this.P,
      T: this.T
    });
  }

  /**
   * Overall gas-phase mass-transfer coefficient K_y (two-film model), kmol /
   * (m^2 * s) per unit y driving force:
   *   1 / K_y = 1 / k_G + m / (k_L * c_L)
   * with m = y* / x (equilibrium slope, dimensionless).
   * @param {number} m equilibrium slope y* = m x
   */
  overallGasCoefficient(m) {
    if (!(m > 0) || !Number.isFinite(m)) {
      throw new TypeError('RateBased: equilibrium slope m must be positive.');
    }
    const kG = this.vaporCoefficient();
    const kL = this.liquidCoefficient() * this.cLiquid;
    return 1 / (1 / kG + m / kL);
  }

  /**
   * Height of an overall gas-phase transfer unit, H_OG = G / (K_y * a_w), m.
   * @param {number} m equilibrium slope
   */
  heightOfTransferUnit(m) {
    const aw = this.wettedArea();
    if (!(aw > 0) || !Number.isFinite(aw)) {
      throw new Error('RateBased: wetted area must be positive.');
    }
    return this.G / (this.overallGasCoefficient(m) * aw);
  }

  /**
   * Number of overall gas-phase transfer units for binary absorption with a
   * linear equilibrium line y* = m x and constant molar flows:
   *   N_OG = integral_{yOut}^{yIn} dy / (y - y*)
   * where x(y) = (G/L)(y - yOut) from the column material balance.
   */
  numberOfTransferUnits(yIn, yOut, m) {
    if (!(yIn > yOut) || !(yOut > 0) || !Number.isFinite(yIn) || !Number.isFinite(yOut)) {
      throw new TypeError('RateBased: need yIn > yOut > 0.');
    }
    const alpha = (m * this.G) / this.L;
    const integrand = (y) => 1 / (y - alpha * (y - yOut));
    return adaptiveSimpson(integrand, yOut, yIn, 1e-12, 24);
  }

  /**
   * Packing height for binary absorption via direct integration of the rate
   * equation:  H = H_OG * N_OG, computed by adaptive Simpson quadrature on
   * the transfer-unit integral (never by a shortcut formula).
   * @returns {Object} { height, ntu, hOG, ky, aw }
   */
  binaryAbsorptionHeight(yIn, yOut, m) {
    const hOG = this.heightOfTransferUnit(m);
    const ntu = this.numberOfTransferUnits(yIn, yOut, m);
    return {
      height: hOG * ntu,
      ntu,
      hOG,
      ky: this.overallGasCoefficient(m),
      aw: this.wettedArea()
    };
  }

  /**
   * Constant-flux simplification: infinite sink solvent (y* = 0 everywhere),
   * so N_OG = ln(yIn / yOut) exactly and H = H_OG * ln(yIn / yOut).
   * This is the analytic reference used to validate the integrator.
   */
  constantFluxHeight(yIn, yOut, m) {
    const hOG = this.heightOfTransferUnit(m);
    const ntu = Math.log(yIn / yOut);
    return { height: hOG * ntu, ntu, hOG };
  }

  /**
   * Integrated height for the constant-flux case (y* = 0) using the same
   * adaptive quadrature as binaryAbsorptionHeight and the same transfer-unit
   * height basis, for cross-checking against constantFluxHeight.
   */
  integratedConstantFluxHeight(yIn, yOut, m) {
    const hOG = this.heightOfTransferUnit(m);
    const integrand = (y) => 1 / y;
    const ntu = adaptiveSimpson(integrand, yOut, yIn, 1e-12, 24);
    return { height: hOG * ntu, ntu, hOG };
  }
}

module.exports = {
  GRAVITY,
  R_GAS,
  OndaCorrelations,
  RateBasedPackedColumn,
  maxwellStefanEffectiveDiffusivity,
  adaptiveSimpson,
  isSymmetricPositiveDefinite,
  symmetricPart,
  inverseMatrix,
  determinant,
  matVec
};
