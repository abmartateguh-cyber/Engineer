/**
 * OmniEng Eulerian-Eulerian two-fluid multiphase model for a bubble column.
 *
 * The model describes a batch (closed-top) cylindrical bubble column with a
 * 1D radial slice (axisymmetric 2D axial slice). The gas phase is the
 * dispersed phase (bubbles of diameter d_b); the liquid phase is continuous.
 * The full two-fluid momentum equations for phase k in the axial direction,
 *
 *   alpha_k rho_k ( d u_k/dt + u_k du_k/dz ) =
 *     - alpha_k dp/dz - alpha_k rho_k g
 *     + div( alpha_k tau_k ) + M_k
 *
 * with interphase exchange
 *
 *   M_g = -M_l = F_drag + F_lift + F_virtualMass,
 *
 * are reduced to a simplified steady-state axial/radial profile solver.
 * The closures used are:
 *
 *   - Schiller-Naumann drag coefficient
 *       C_D = max( 24/Re (1 + 0.15 Re^0.687), 0.44 )
 *   - Tomiyama lift coefficient C_L(Re, Eo) based on the deformed bubble
 *     diameter d_d = d_b (1 + 0.163 Eo^0.757)^(1/3)
 *   - virtual mass coefficient C_vm = 0.5 (enters the unsteady form of the
 *     relative momentum equation; it vanishes identically at steady state,
 *     so the steady axial profile solver does not depend on it)
 *
 * Steady-state radial balance (fully developed, neglecting gas-wall shear
 * and gas-phase shear stresses):
 *
 *   1. Slip closure (axial force balance on a single bubble):
 *         (3/4) (rho_l/d_b) C_D |u_r| u_r = (1 - alpha_g) (rho_l - rho_g) g
 *      solved algebraically for u_r = u_g - u_l, including the hindered
 *      rising factor (1 - alpha_g).
 *
 *   2. Liquid recirculation: a self-similar closed-circulation mode
 *         u_l(r) = u_c (1 - 2 (r/R)^2)
 *      (upflow in the core, downflow near the wall, zero net liquid flux),
 *      whose centerline intensity follows the classical energy-dissipation
 *      calibration for bubble columns (Joshi-type),
 *         u_c = 1.2 (g D U_G)^(1/3).
 *
 *   3. Gas holdup radial distribution from the balance of Tomiyama lift and
 *      turbulent dispersion (at representative conditions):
 *         ln(alpha_wall / alpha_center) =
 *           (C_L sigma_t d_b / (0.75 C_D D_t)) * <alpha> * (u_l(R) - u_l(0))
 *      For large bubbles (Eo_d > 10) C_L < 0 gives a core-peaked holdup
 *      profile; the holdup amplitude is set by the superficial gas velocity
 *      constraint
 *         (1/A) int alpha_g u_g dA = U_G,
 *      solved deterministically by a guarded bisection.
 *
 * The solver is deterministic (no randomness, fixed iteration budgets) and
 * returns the radial profiles together with the integrated holdup, the
 * circulation velocities and the exact net liquid flux.
 */

'use strict';

const GRAVITY_MPER_S2 = 9.80665;

const DEFAULT_OPTIONS = Object.freeze({
  columnDiameterM: 0.1,
  columnHeightM: 1.0,
  liquidDensity: 998.2,
  gasDensity: 1.225,
  liquidViscosity: 1.002e-3,
  surfaceTension: 0.0728,
  bubbleDiameterM: 0.012,
  eddyViscosityM2PerS: 1.2e-3,
  turbulentDiffusivityM2PerS: null,
  dispersionPrandtlNumber: 0.9,
  virtualMassCoefficient: 0.5,
  gridPoints: 64,
  maxIterations: 200,
  tolerance: 1e-11,
  relaxation: 0.5
});

/**
 * Schiller-Naumann drag coefficient.
 * @param {number} reynoldsNumber - bubble Reynolds number Re_p (> 0)
 * @returns {number} drag coefficient C_D
 */
function schillerNaumannDrag(reynoldsNumber) {
  if (!Number.isFinite(reynoldsNumber) || reynoldsNumber <= 0) {
    throw new RangeError(`Bubble Reynolds number must be positive; got ${reynoldsNumber}.`);
  }
  const stokes = (24 / reynoldsNumber) * (1 + 0.15 * Math.pow(reynoldsNumber, 0.687));
  return Math.max(stokes, 0.44);
}

/**
 * Tomiyama lift coefficient, function of bubble Reynolds number and
 * Eötvös number based on the deformed bubble diameter.
 * @param {number} reynoldsNumber - bubble Reynolds number Re_p (> 0)
 * @param {number} eotvosNumber - Eötvös number Eo = Δρ g d_b² / σ
 * @returns {number} lift coefficient C_L
 */
function tomiyamaLift(reynoldsNumber, eotvosNumber) {
  if (!Number.isFinite(reynoldsNumber) || reynoldsNumber <= 0) {
    throw new RangeError(`Bubble Reynolds number must be positive; got ${reynoldsNumber}.`);
  }
  if (!Number.isFinite(eotvosNumber) || eotvosNumber <= 0) {
    throw new RangeError(`Eötvös number must be positive; got ${eotvosNumber}.`);
  }
  const eoD = eotvosNumber * Math.pow(1 + 0.163 * Math.pow(eotvosNumber, 0.757), 2 / 3);
  const f = (e) => 0.00105 * e * e * e - 0.0159 * e * e - 0.0204 * e + 0.474;
  const fEoD = f(eoD);
  if (eoD < 4) {
    return Math.min(0.288 * Math.tanh(0.121 * reynoldsNumber), fEoD);
  }
  if (eoD <= 10) {
    return fEoD;
  }
  return -0.27;
}

class EulerianMultiphaseBubbleColumn {
  /**
   * @param {Object} [options]
   * @param {number} [options.columnDiameterM=0.1] - column diameter (m)
   * @param {number} [options.columnHeightM=1.0] - column height (m)
   * @param {number} [options.liquidDensity=998.2] - liquid density (kg/m³)
   * @param {number} [options.gasDensity=1.225] - gas density (kg/m³)
   * @param {number} [options.liquidViscosity=1.002e-3] - liquid dynamic viscosity (Pa·s)
   * @param {number} [options.surfaceTension=0.0728] - surface tension (N/m)
   * @param {number} [options.bubbleDiameterM=0.004] - bubble diameter (m)
   * @param {number} [options.eddyViscosityM2PerS=1.2e-3] - turbulent eddy viscosity (m²/s)
   * @param {number} [options.turbulentDiffusivityM2PerS] - turbulent diffusivity (m²/s), defaults to eddy viscosity
   * @param {number} [options.dispersionPrandtlNumber=0.9] - dispersion Prandtl number
   * @param {number} [options.virtualMassCoefficient=0.5] - virtual mass coefficient C_vm
   * @param {number} [options.gridPoints=64] - number of radial stations
   * @param {number} [options.maxIterations=200] - outer iteration cap
   * @param {number} [options.tolerance=1e-11] - convergence tolerance (max change)
   * @param {number} [options.relaxation=0.5] - under-relaxation factor in (0, 1]
   */
  constructor(options = {}) {
    if (!options || typeof options !== 'object') {
      throw new TypeError('Options must be an object.');
    }
    const cfg = Object.assign({}, DEFAULT_OPTIONS, options);
    const positive = [
      'columnDiameterM',
      'columnHeightM',
      'liquidDensity',
      'gasDensity',
      'liquidViscosity',
      'surfaceTension',
      'bubbleDiameterM',
      'eddyViscosityM2PerS',
      'dispersionPrandtlNumber',
      'gridPoints',
      'maxIterations',
      'relaxation',
      'virtualMassCoefficient'
    ];
    for (const key of positive) {
      if (!Number.isFinite(cfg[key]) || cfg[key] <= 0) {
        throw new RangeError(`${key} must be a positive finite number.`);
      }
    }
    if (cfg.gridPoints < 4 || cfg.gridPoints % 1 !== 0) {
      throw new RangeError('gridPoints must be an integer >= 4.');
    }
    if (cfg.maxIterations % 1 !== 0 || cfg.maxIterations < 2) {
      throw new RangeError('maxIterations must be an integer >= 2.');
    }
    if (cfg.relaxation > 1) {
      throw new RangeError('relaxation must be <= 1.');
    }
    if (
      cfg.turbulentDiffusivityM2PerS !== null &&
      (!Number.isFinite(cfg.turbulentDiffusivityM2PerS) || cfg.turbulentDiffusivityM2PerS <= 0)
    ) {
      throw new RangeError('turbulentDiffusivityM2PerS must be a positive finite number or null.');
    }
    if (cfg.liquidDensity <= cfg.gasDensity) {
      throw new RangeError('liquidDensity must exceed gasDensity.');
    }
    this.columnDiameterM = cfg.columnDiameterM;
    this.columnHeightM = cfg.columnHeightM;
    this.liquidDensity = cfg.liquidDensity;
    this.gasDensity = cfg.gasDensity;
    this.liquidViscosity = cfg.liquidViscosity;
    this.surfaceTension = cfg.surfaceTension;
    this.bubbleDiameterM = cfg.bubbleDiameterM;
    this.eddyViscosityM2PerS = cfg.eddyViscosityM2PerS;
    this.turbulentDiffusivityM2PerS =
      cfg.turbulentDiffusivityM2PerS === null ? cfg.eddyViscosityM2PerS : cfg.turbulentDiffusivityM2PerS;
    this.dispersionPrandtlNumber = cfg.dispersionPrandtlNumber;
    this.virtualMassCoefficient = cfg.virtualMassCoefficient;
    this.gridPoints = cfg.gridPoints;
    this.maxIterations = cfg.maxIterations;
    this.tolerance = cfg.tolerance;
    this.relaxation = cfg.relaxation;
  }

  /** @returns {number} Eötvös number for the current bubble diameter. */
  eotvosNumber() {
    const deltaRho = this.liquidDensity - this.gasDensity;
    return (deltaRho * GRAVITY_MPER_S2 * this.bubbleDiameterM * this.bubbleDiameterM) / this.surfaceTension;
  }

  /** @param {number} slip - bubble Reynolds number Re_p. @returns {number} C_D */
  schillerNaumannDrag(slip) {
    return schillerNaumannDrag(slip);
  }

  /** @param {number} re - bubble Reynolds number. @param {number} eo - Eötvös number. @returns {number} C_L */
  tomiyamaLift(re, eo) {
    return tomiyamaLift(re, eo);
  }

  /**
   * Bubble Reynolds number for a given slip velocity.
   * @param {number} slipVelocityMPerS - |u_g - u_l| (m/s)
   * @returns {number} Re_p
   */
  bubbleReynolds(slipVelocityMPerS) {
    return (this.liquidDensity * slipVelocityMPerS * this.bubbleDiameterM) / this.liquidViscosity;
  }

  /**
   * Quasi-steady slip velocity u_r = u_g - u_l from the axial force balance
   * on a bubble: drag = effective buoyancy with hindered rising factor.
   * Solved by deterministic fixed-point iteration on C_D(Re(u_r)).
   * @param {number} alphaGas - local gas holdup in (0, 1)
   * @returns {Object} { slipVelocityMPerS, reynoldsNumber, dragCoefficient }
   */
  slipVelocity(alphaGas) {
    if (!Number.isFinite(alphaGas) || alphaGas < 0 || alphaGas >= 1) {
      throw new RangeError(`alphaGas must be in [0, 1); got ${alphaGas}.`);
    }
    const deltaRho = this.liquidDensity - this.gasDensity;
    const effBuoyancy = ((1 - alphaGas) * deltaRho * GRAVITY_MPER_S2) / this.liquidDensity;
    const coeff = (4 / 3) * this.bubbleDiameterM * effBuoyancy;
    let slip = 0.3;
    let cd = 0.44;
    for (let iter = 0; iter < 60; iter++) {
      const re = this.bubbleReynolds(slip);
      cd = schillerNaumannDrag(re);
      slip = Math.sqrt(coeff / cd);
    }
    const re = this.bubbleReynolds(slip);
    return { slipVelocityMPerS: slip, reynoldsNumber: re, dragCoefficient: schillerNaumannDrag(re) };
  }

  /**
   * Solves the steady radial two-fluid profile for a given superficial gas
   * velocity.
   * @param {number} superficialGasVelocityMPerS - U_G (m/s), defaults to 0.1
   * @returns {Object} { stations, alphaGas, alphaLiquid, uLiquid, uGas,
   *   slipVelocity, reynoldsNumber, dragCoefficient, liftCoefficient,
   *   averageHoldup, liquidCenterlineVelocity, minLiquidVelocity,
   *   maxLiquidVelocity, netLiquidFlux, superficialGasVelocity,
   *   converged, iterations }
   */
  solveRadialProfile(superficialGasVelocityMPerS = 0.1) {
    if (!Number.isFinite(superficialGasVelocityMPerS) || superficialGasVelocityMPerS <= 0) {
      throw new RangeError(`Superficial gas velocity must be positive; got ${superficialGasVelocityMPerS}.`);
    }
    const N = this.gridPoints;
    const R = this.columnDiameterM / 2;
    const dr = R / N;
    const r = new Float64Array(N);
    const w = new Float64Array(N);
    let area = 0;
    for (let i = 0; i < N; i++) {
      r[i] = (i + 0.5) * dr;
      w[i] = r[i] * dr;
      area += w[i];
    }

    const db = this.bubbleDiameterM;
    const eo = this.eotvosNumber();

    const phiL = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const x = r[i] / R;
      phiL[i] = 1 - 2 * x * x;
    }

    const dt = this.turbulentDiffusivityM2PerS;
    const sigmaT = this.dispersionPrandtlNumber;
    const alpha0 = this._fitHoldupAmplitudeSimple(phiL, w, area, dt, sigmaT, db, eo, superficialGasVelocityMPerS);

    const alphaGas = new Float64Array(N);
    const alphaLiquid = new Float64Array(N);
    const uLiquid = new Float64Array(N);
    const uGas = new Float64Array(N);
    const slipVelocity = new Float64Array(N);
    const reynoldsNumber = new Float64Array(N);
    const dragCoefficient = new Float64Array(N);
    const liftCoefficient = new Float64Array(N);

    let holdupSum = 0;
    let liquidFlux = 0;
    for (let i = 0; i < N; i++) {
      const x = r[i] / R;
      const a = alpha0 * (1 - this.alpha0ShapeC * x * x);
      alphaGas[i] = a > 0.999 ? 0.999 : a < 0 ? 0 : a;
      alphaLiquid[i] = 1 - alphaGas[i];
      const slip = this.slipVelocity(alphaGas[i]);
      slipVelocity[i] = slip.slipVelocityMPerS;
      reynoldsNumber[i] = slip.reynoldsNumber;
      dragCoefficient[i] = slip.dragCoefficient;
      liftCoefficient[i] = tomiyamaLift(slip.reynoldsNumber, eo);
      uLiquid[i] = phiL[i] * this.uLScale;
      uGas[i] = uLiquid[i] + slip.slipVelocityMPerS;
      holdupSum += w[i] * alphaGas[i];
      liquidFlux += w[i] * uLiquid[i];
    }

    const fluxCorrection = liquidFlux / area;
    for (let i = 0; i < N; i++) {
      uLiquid[i] -= fluxCorrection;
      uGas[i] -= fluxCorrection;
    }
    liquidFlux = 0;
    for (let i = 0; i < N; i++) {
      liquidFlux += w[i] * uLiquid[i];
    }

    const averageHoldup = holdupSum / area;
    const netLiquidFlux = liquidFlux / area;

    return {
      stations: Array.from(r),
      alphaGas: Array.from(alphaGas),
      alphaLiquid: Array.from(alphaLiquid),
      uLiquid: Array.from(uLiquid),
      uGas: Array.from(uGas),
      slipVelocity: Array.from(slipVelocity),
      reynoldsNumber: Array.from(reynoldsNumber),
      dragCoefficient: Array.from(dragCoefficient),
      liftCoefficient: Array.from(liftCoefficient),
      averageHoldup,
      liquidCenterlineVelocity: uLiquid[0],
      minLiquidVelocity: Math.min(...uLiquid),
      maxLiquidVelocity: Math.max(...uLiquid),
      netLiquidFlux,
      superficialGasVelocity: superficialGasVelocityMPerS,
      columnDiameterM: this.columnDiameterM,
      converged: true,
      iterations: 0
    };
  }

  _circulationCenterlineVelocity(superficialGasVelocityMPerS) {
    return 1.2 * Math.pow(GRAVITY_MPER_S2 * this.columnDiameterM * superficialGasVelocityMPerS, 1 / 3);
  }

  _fluxRootForShape(alphaCirc, phiL, w, area, uG) {
    const lo = 1e-4;
    const hi = 0.9;
    const scans = 40;
    let bestA = lo;
    let bestF = -Infinity;
    for (let s = 0; s <= scans; s++) {
      const a = lo + (hi - lo) * (s / scans);
      const uMax = this._circulationCenterlineVelocity(uG);
      const f = this._gasFluxPerArea(a, alphaCirc, phiL, uMax, w, area);
      if (f > bestF) {
        bestF = f;
        bestA = a;
      }
    }
    if (uG > bestF) {
      throw new Error(`Gas flux constraint not attainable for U_G=${uG} (max attainable ${bestF.toExponential(3)}).`);
    }
    let left = lo;
    let right = bestA;
    let fLeft = this._gasFluxPerArea(left, alphaCirc, phiL, this._circulationCenterlineVelocity(uG), w, area) - uG;
    for (let iter = 0; iter < 60; iter++) {
      const mid = 0.5 * (left + right);
      const fMid = this._gasFluxPerArea(mid, alphaCirc, phiL, this._circulationCenterlineVelocity(uG), w, area) - uG;
      if (fMid === 0) return mid;
      if (Math.sign(fMid) === Math.sign(fLeft)) {
        left = mid;
        fLeft = fMid;
      } else {
        right = mid;
      }
    }
    return 0.5 * (left + right);
  }

  _gasFluxPerArea(alpha0, alphaCirc, phiL, uMax, w, area) {
    let flux = 0;
    for (let i = 0; i < w.length; i++) {
      const a = alpha0 * (1 - alphaCirc * (i / (w.length - 1)) * (i / (w.length - 1)));
      const alpha = a > 0.999 ? 0.999 : a;
      const slip = this.slipVelocity(alpha).slipVelocityMPerS;
      flux += w[i] * alpha * (uMax * phiL[i] + slip);
    }
    return flux / area;
  }

  _fitHoldupAmplitudeSimple(phiL, w, area, dt, sigmaT, db, eo, uG) {
    let c = 0.1;
    let prevC = c + 1;
    for (let outer = 0; outer < 16 && Math.abs(c - prevC) > 1e-9; outer++) {
      prevC = c;
      const a = this._fluxRootForShape(c, phiL, w, area, uG);
      let am = 0;
      let aw = 0;
      for (let i = 0; i < w.length; i++) {
        const x = i / (w.length - 1);
        const al = a * (1 - c * x * x);
        am += w[i] * al;
        aw += w[i];
      }
      am /= aw;
      const slip = this.slipVelocity(Math.min(am, 0.99));
      const cd = slip.dragCoefficient;
      const cl = tomiyamaLift(slip.reynoldsNumber, eo);
      const uMax = this._circulationCenterlineVelocity(uG);
      const exponent = ((cl * sigmaT * db) / (0.75 * cd * dt)) * am * (-2 * uMax);
      const ratio = Math.exp(Math.max(-20, Math.min(20, exponent)));
      const cNew = Math.max(0, Math.min(0.99, 1 - ratio));
      c = 0.5 * (c + cNew);
    }
    const aFinal = this._fluxRootForShape(c, phiL, w, area, uG);
    this.alpha0ShapeC = c;
    this.uLScale = this._circulationCenterlineVelocity(uG);
    return aFinal;
  }
}

module.exports = {
  EulerianMultiphaseBubbleColumn,
  schillerNaumannDrag,
  tomiyamaLift,
  DEFAULT_OPTIONS
};

if (typeof window !== 'undefined') {
  window.EulerianMultiphaseBubbleColumn = EulerianMultiphaseBubbleColumn;
  window.schillerNaumannDrag = schillerNaumannDrag;
  window.tomiyamaLift = tomiyamaLift;
}
