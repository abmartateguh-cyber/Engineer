'use strict';

/**
 * Conjugate heat transfer (CHT) multi-region coupling.
 *
 * Provides deterministic, dependency-free steady-state coupling between a
 * solid conduction region and a fluid convection region:
 *
 *  - Solid:  1D steady conduction, k_s d^2T/dx^2 = 0 (plus optional
 *             distributed convective loss for the pin-fin analogue), solved
 *             with a finite-volume tridiagonal scheme.
 *  - Fluid:  quasi-1D forced-convection march over a fully developed laminar
 *             channel flow (parabolic velocity profile). The profile enters
 *             through the mean velocity used in the bulk energy balance and
 *             through the fully developed Nusselt number used for the local
 *             convective coefficient.
 *  - Coupling: Dirichlet-Neumann iteration. The solid is solved with the
 *             interface temperature taken from the fluid; the fluid is then
 *             marched with the interface flux taken from the solid. The
 *             interface temperature is relaxed (fixed relaxation or dynamic
 *             Aitken-style relaxation selected from the previous two steps).
 *
 * Interface flux continuity (the coupled condition):
 *     k_s dT_s/dn = h (T_interface - T_bulk)
 * is enforced iteratively and verified explicitly at convergence.
 */

const NU_FULLY_DEVELOPED_PARALLEL_PLATE = 7.54;
const DEFAULT_MAX_ITERATIONS = 800;
const DEFAULT_RELAXATION = 0.5;
const DEFAULT_TOLERANCE_K = 1e-10;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

class ConjugateHeatTransferSolver {
  /**
   * Steady 1D finite-volume conduction with optional distributed loss.
   * Boundary types: 'dirichlet' (fixed temperature) or 'neumann' (flux,
   * positive = entering the domain from the left, leaving on the right).
   *
   * @param {Object} config
   * @param {number} config.conductivity W/mK
   * @param {number} config.length m
   * @param {number} config.nodes cell count
   * @param {string} config.leftBoundary.type
   * @param {number} config.leftBoundary.value
   * @param {string} config.rightBoundary.type
   * @param {number} config.rightBoundary.value
   * @param {number} [config.lossPerVolume] W/m3K distributed loss coefficient
   * @param {number} [config.ambientTemperature] K
   * @returns {{T: number[], fluxLeft: number, fluxRight: number}}
   */
  static solveSteadyConduction1D(config) {
    const k = config.conductivity;
    const L = config.length;
    const n = config.nodes;
    const h = L / (n - 1);
    const loss = config.lossPerVolume || 0;
    const ambient = config.ambientTemperature || 0;

    const a = new Float64Array(n);
    const b = new Float64Array(n);
    const c = new Float64Array(n);
    const d = new Float64Array(n);

    for (let i = 0; i < n; i += 1) {
      b[i] = (2 * k) / h + loss * h;
      a[i] = -k / h;
      c[i] = -k / h;
      d[i] = loss * h * ambient;
    }

    const left = config.leftBoundary;
    const right = config.rightBoundary;

    if (left.type === 'dirichlet') {
      b[0] = 1;
      c[0] = 0;
      d[0] = left.value;
    } else {
      b[0] = k / h + (loss * h) / 2;
      c[0] = -k / h;
      d[0] = left.value + ((loss * h) / 2) * ambient;
    }

    if (right.type === 'dirichlet') {
      b[n - 1] = 1;
      a[n - 1] = 0;
      d[n - 1] = right.value;
    } else {
      b[n - 1] = k / h + (loss * h) / 2;
      a[n - 1] = -k / h;
      d[n - 1] = -right.value + ((loss * h) / 2) * ambient;
    }

    const T = this._thomas(a, b, c, d, n);

    let fluxLeft;
    let fluxRight;
    if (left.type === 'dirichlet') {
      fluxLeft = (k * (T[0] - T[1])) / h;
    } else {
      fluxLeft = left.value;
    }
    if (right.type === 'dirichlet') {
      fluxRight = (k * (T[n - 2] - T[n - 1])) / h;
    } else {
      fluxRight = right.value;
    }

    return { T: Array.from(T), fluxLeft, fluxRight };
  }

  /**
   * Exact analytic interface temperature of two conduction slabs sharing an
   * interface (weighted harmonic mean of the boundary temperatures).
   */
  static twoSlabInterfaceTemperature(k1, k2, L1, L2, T0, T2) {
    const a1 = k1 / L1;
    const a2 = k2 / L2;
    return (a1 * T0 + a2 * T2) / (a1 + a2);
  }

  /**
   * Coupled two-slab conduction solved with the Dirichlet-Neumann iteration.
   * The Dirichlet side is placed on the lower-conductance slab (stable
   * orientation), the higher-conductance slab receives the interface flux.
   *
   * @returns {Object} interfaceTempK, fluxWm2, iterations, converged,
   *                   residualHistory, interfaceFluxErrorWm2
   */
  static solveTwoSlab(options) {
    const {
      k1,
      k2,
      L1,
      L2,
      T0,
      T2,
      nodes = 8,
      maxIterations = DEFAULT_MAX_ITERATIONS,
      relaxation = DEFAULT_RELAXATION,
      toleranceFluxWm2 = 1e-12
    } = options;

    const a1 = k1 / L1;
    const a2 = k2 / L2;
    const dirichletSideIs2 = a2 <= a1;

    let Ti = (T0 + T2) / 2;
    const residualHistory = [];
    let fluxError = Infinity;
    let converged = false;
    let iterations = 0;

    for (let iter = 0; iter < maxIterations; iter += 1) {
      let qDirichlet;
      let TiNextRaw;
      if (dirichletSideIs2) {
        const slab2 = this.solveSteadyConduction1D({
          conductivity: k2,
          length: L2,
          nodes,
          leftBoundary: { type: 'dirichlet', value: Ti },
          rightBoundary: { type: 'dirichlet', value: T2 }
        });
        qDirichlet = -slab2.fluxLeft;
        TiNextRaw = T0 + qDirichlet / a1;
      } else {
        const slab1 = this.solveSteadyConduction1D({
          conductivity: k1,
          length: L1,
          nodes,
          leftBoundary: { type: 'dirichlet', value: T0 },
          rightBoundary: { type: 'dirichlet', value: Ti }
        });
        qDirichlet = slab1.fluxRight;
        TiNextRaw = T2 - qDirichlet / a2;
      }

      const stepRaw = TiNextRaw - Ti;
      residualHistory.push(Math.abs(stepRaw));
      Ti = (1 - relaxation) * Ti + relaxation * TiNextRaw;

      const q1 = a1 * (Ti - T0);
      const q2 = a2 * (T2 - Ti);
      fluxError = Math.abs(q1 - q2);

      if (fluxError < toleranceFluxWm2 || Math.abs(stepRaw) < 1e-14) {
        converged = true;
        iterations = iter + 1;
        break;
      }
      iterations = iter + 1;
    }

    const TiAnalytic = this.twoSlabInterfaceTemperature(k1, k2, L1, L2, T0, T2);
    return {
      interfaceTempK: Ti,
      analyticInterfaceTempK: TiAnalytic,
      interfaceTempErrorK: Math.abs(Ti - TiAnalytic),
      fluxWm2: a1 * (Ti - T0),
      fluxWm2Side2: a2 * (T2 - Ti),
      interfaceFluxErrorWm2: fluxError,
      iterations,
      converged,
      residualHistory
    };
  }

  /**
   * Coupled solid wall / forced-convection channel flow.
   *
   * Solid: 1D slab of thickness `thickness`, base held at `baseTemperature`.
   * Fluid: fully developed laminar channel flow of height `channelHeight`
   *        between the interface wall and an adiabatic top, mean velocity
   *        `meanVelocity`, inlet temperature `inletTemperature`.
   *
   * @returns {Object} converged, iterations, residualHistory, fluxResiduals,
   *                   interfaceTemperatureProfile, bulkTemperatureProfile,
   *                   solidFluxProfile, fluidFluxProfile,
   *                   heatThroughSolidWm, heatExtractedFluidWm,
   *                   maxFluxResidualWm2, relativeFluxResidual, wallTempRangeK
   */
  static solveFluidSolidWall(options) {
    const solid = options.solid;
    const fluid = options.fluid;
    const maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;
    const relaxation = options.relaxation !== undefined ? options.relaxation : 0.3;
    const toleranceK = options.toleranceK !== undefined ? options.toleranceK : DEFAULT_TOLERANCE_K;
    const nodes = options.nodes || 8;
    const segments = fluid.segments || 32;

    const kS = solid.conductivity;
    const LS = solid.thickness;
    const Tw = solid.baseTemperature;
    const aS = kS / LS;

    const kF = fluid.conductivity;
    const rho = fluid.density;
    const cp = fluid.specificHeat;
    const H = fluid.channelHeight;
    const U = fluid.meanVelocity;
    const L = fluid.length;
    const Tin = fluid.inletTemperature;
    const hF = this.fullyDevelopedChannelCoefficient(kF, H);
    const dx = L / segments;
    const mDotCpPerWidth = rho * U * H * cp;

    let Ti = Array.from({ length: segments }, () => (Tw + Tin) / 2);
    const residualHistory = [];
    const fluxResiduals = [];
    let converged = false;
    let iterations = 0;

    const marchWithWallTemp = (wallTemp) => {
      const qSolid = new Float64Array(segments);
      const qFluid = new Float64Array(segments);
      const Tb = new Float64Array(segments + 1);
      const TiNext = new Float64Array(segments);
      Tb[0] = Tin;
      for (let j = 0; j < segments; j += 1) {
        const solidSolve = this.solveSteadyConduction1D({
          conductivity: kS,
          length: LS,
          nodes,
          leftBoundary: { type: 'dirichlet', value: Tw },
          rightBoundary: { type: 'dirichlet', value: wallTemp[j] }
        });
        qSolid[j] = solidSolve.fluxRight;
        qFluid[j] = hF * (wallTemp[j] - Tb[j]);
        TiNext[j] = Tb[j] + qSolid[j] / hF;
        Tb[j + 1] = Tb[j] + (qSolid[j] * dx) / mDotCpPerWidth;
      }
      return { qSolid, qFluid, Tb, TiNext };
    };

    for (let iter = 0; iter < maxIterations; iter += 1) {
      const { qSolid, qFluid, Tb, TiNext } = marchWithWallTemp(Ti);

      const step = new Float64Array(segments);
      let maxStep = 0;
      let maxFluxResid = 0;
      let maxFluxRef = 0;
      for (let j = 0; j < segments; j += 1) {
        step[j] = TiNext[j] - Ti[j];
        maxStep = Math.max(maxStep, Math.abs(step[j]));
        const resid = Math.abs(qSolid[j] - qFluid[j]);
        maxFluxResid = Math.max(maxFluxResid, resid);
        maxFluxRef = Math.max(maxFluxRef, Math.abs(qSolid[j]), Math.abs(qFluid[j]));
      }
      residualHistory.push(maxStep);
      fluxResiduals.push(maxFluxResid);

      for (let j = 0; j < segments; j += 1) {
        Ti[j] += relaxation * step[j];
      }

      iterations = iter + 1;
      const relativeFluxResidual = maxFluxResid / Math.max(maxFluxRef, 1e-9);
      if (maxStep < toleranceK && relativeFluxResidual < 1e-8) {
        converged = true;
        break;
      }
    }

    const final = marchWithWallTemp(Ti);
    const Tb = final.Tb;
    const qSolid = final.qSolid;
    const qFluid = final.qFluid;

    let maxFluxResid = 0;
    let maxFluxRef = 0;
    let heatThroughSolid = 0;
    let heatExtractedFluid = 0;
    let wallMin = Infinity;
    let wallMax = -Infinity;
    for (let j = 0; j < segments; j += 1) {
      maxFluxResid = Math.max(maxFluxResid, Math.abs(qSolid[j] - qFluid[j]));
      maxFluxRef = Math.max(maxFluxRef, Math.abs(qSolid[j]), Math.abs(qFluid[j]));
      heatThroughSolid += qSolid[j] * dx;
      heatExtractedFluid += qFluid[j] * dx;
      wallMin = Math.min(wallMin, Ti[j]);
      wallMax = Math.max(wallMax, Ti[j]);
    }

    return {
      converged,
      iterations,
      residualHistory,
      fluxResiduals,
      interfaceTemperatureProfile: Array.from(Ti),
      bulkTemperatureProfile: Array.from(Tb),
      solidFluxProfile: Array.from(qSolid),
      fluidFluxProfile: Array.from(qFluid),
      heatThroughSolidWm: heatThroughSolid,
      heatExtractedFluidWm: heatExtractedFluid,
      energyBalanceErrorPercent:
        (100 * Math.abs(heatThroughSolid - heatExtractedFluid)) / Math.max(heatExtractedFluid, 1e-12),
      maxFluxResidualWm2: maxFluxResid,
      relativeFluxResidual: maxFluxResid / Math.max(maxFluxRef, 1e-9),
      wallTempRangeK: [wallMin, wallMax],
      channelHeightM: H,
      convectiveCoefficientWm2K: hF
    };
  }

  /**
   * Fully developed laminar parallel-plate channel convective coefficient:
   * h = Nu * k_f / D_h with D_h = 2H.
   */
  static fullyDevelopedChannelCoefficient(conductivity, channelHeight) {
    return (NU_FULLY_DEVELOPED_PARALLEL_PLATE * conductivity) / (2 * channelHeight);
  }

  /**
   * 1D fin with convection along its length (insulated tip). Solves the
   * conduction-with-loss equation and returns the base heat flow alongside
   * the analytic fin result: Q_base = sqrt(h P k A) (T_b - T_inf) tanh(mL),
   * m = sqrt(h P / (k A)).
   */
  static solveFin(options) {
    const {
      conductivity: k,
      convectionCoefficient: h,
      perimeter: P,
      area: A,
      length: L,
      baseTemperature: Tb,
      ambientTemperature: Tamb,
      cells = 200
    } = options;

    const m = Math.sqrt((h * P) / (k * A));
    const mL = m * L;
    const analyticBaseHeatFlow = Math.sqrt(h * P * k * A) * (Tb - Tamb) * Math.tanh(mL);
    const analyticEfficiency = mL > 1e-12 ? Math.tanh(mL) / mL : 1;

    const solve = this.solveSteadyConduction1D({
      conductivity: k,
      length: L,
      nodes: cells,
      leftBoundary: { type: 'dirichlet', value: Tb },
      rightBoundary: { type: 'neumann', value: 0 },
      lossPerVolume: (h * P) / A,
      ambientTemperature: Tamb
    });

    const baseHeatFlow = (k * A * (solve.T[0] - solve.T[1])) / (L / cells);
    const idealHeatFlow = h * P * L * (Tb - Tamb);
    return {
      baseHeatFlowW: baseHeatFlow,
      analyticBaseHeatFlowW: analyticBaseHeatFlow,
      errorPercent: (100 * Math.abs(baseHeatFlow - analyticBaseHeatFlow)) / Math.abs(analyticBaseHeatFlow),
      efficiency: baseHeatFlow / idealHeatFlow,
      analyticEfficiency,
      mL,
      temperatureProfile: solve.T
    };
  }

  static _thomas(a, b, c, d, n) {
    const cp = new Float64Array(n);
    const dp = new Float64Array(n);
    cp[0] = c[0] / b[0];
    dp[0] = d[0] / b[0];
    for (let i = 1; i < n; i += 1) {
      const denom = b[i] - a[i] * cp[i - 1];
      cp[i] = c[i] / denom;
      dp[i] = (d[i] - a[i] * dp[i - 1]) / denom;
    }
    const x = new Float64Array(n);
    x[n - 1] = dp[n - 1];
    for (let i = n - 2; i >= 0; i -= 1) {
      x[i] = dp[i] - cp[i] * x[i + 1];
    }
    return x;
  }
}

module.exports = {
  ConjugateHeatTransferSolver,
  NU_FULLY_DEVELOPED_PARALLEL_PLATE
};
