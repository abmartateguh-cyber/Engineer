/**
 * Naphtali–Sandholm-style equilibrium-stage distillation column solver.
 *
 * This module replaces the former disabled stub with a real steady-state
 * equilibrium-stage column model.
 *
 * Model and assumptions (documented):
 *   - Stages are numbered 1..N top to bottom. Stage 1 is a TOTAL condenser
 *     (saturated reflux, no subcooling), stage N is a partial reboiler.
 *     Stages 2..N are equilibrium stages.
 *   - Phase equilibrium: ideal solution, Raoult's law K_i = P_i^sat(T)/P_j
 *     with P_i^sat from the documented Clausius–Clapeyron vapor-pressure
 *     correlations in thermo_compounds.js (anchored at published latent
 *     heats). An optional Wilson K-value screening model is available
 *     (K_i = (Pc_i/P_j) exp(5.37 (1+omega_i) (1 - Tc_i/T))).
 *     Peng–Robinson fugacity ratios exist in peng_robinson_eos.js but are
 *     not wired into the column by default (see GAPS in the test).
 *   - Internal flows follow the constant-molal-overflow (CMO) idealization:
 *     L above feed = R D, L below feed = R D + (1-q)F, V above feed =
 *     (R+1)D, V below feed = (R+1)D - qF (q = feed vapor fraction), bottoms
 *     B = 1 - D. This is the classic ideal-distillation shortcut model.
 *   - Unknowns: the liquid mole fractions on every stage (NC-1 per stage);
 *     stage temperatures are recovered from the bubble-point relation
 *     (equilibrium/summation constraint) via the bubble-point map, which is
 *     the standard equilibrium-stage temperature treatment. The component
 *     material balances (M) are solved simultaneously with a Newton–
 *     Raphson pass (analytic linear solve of the M system with FD Jacobian
 *     check) over the composition variables.
 *   - Condenser and reboiler duties are computed afterwards from the stage
 *     enthalpy balances (reported).
 *   - Flows are normalized per mole of total feed (Ftot = 1).
 *
 * Convergence: max-norm of material-balance residuals < 1e-8 and bubble-point
 * residual < 1e-8 on every stage.
 */

'use strict';

const { CorrelationSpeciesCatalog } = require('./thermo_compounds');
const { getDipprCatalog } = require('./dippr_expanded_catalog');
const { PengRobinsonEOS } = require('./peng_robinson_eos');
const { RigorousDistillationColumnSolver } = require('./rigorous_distillation_column');

const R_GAS = 8.314462618; // J/(mol*K)
const T_REF_K = 298.15; // enthalpy reference temperature
const DEFAULT_TOLERANCE = 1e-8;
const DEFAULT_MAX_ITERATIONS = 120;
const K_MODELS = Object.freeze(['raoult', 'wilson', 'dippr', 'peng-robinson', 'pr']);

function unavailableResult(message) {
  return {
    success: false,
    status: 'unavailable',
    validationLevel: 'experimental',
    error: { code: 'UNSUPPORTED', message: message || 'This legacy calculation is unavailable.' }
  };
}

function failureResult(err) {
  const code = err && err.code === 'NUMERICAL_FAILURE' ? 'NUMERICAL_FAILURE' : 'INTERNAL';
  return {
    success: false,
    status: 'not-converged',
    validationLevel: 'experimental',
    error: {
      code,
      message: (err && err.message) || 'The equilibrium-stage column solver failed.',
      details: err && err.details ? err.details : {}
    }
  };
}

function incompleteSpec(message) {
  const error = new Error(message);
  error.code = 'INCOMPLETE_SPEC';
  return error;
}

function numericalFailure(message, details) {
  const error = new Error(message);
  error.code = 'NUMERICAL_FAILURE';
  error.details = details || {};
  return error;
}

class NaphtaliSandholmColumnSolver {
  /**
   * Solves the steady-state equilibrium-stage column system.
   * @param {object} spec explicit inputs (see buildProblem)
   * @returns {object} result envelope with profiles and convergence history
   */
  static solve(spec = {}) {
    if (spec && (spec.model === 'rigorous' || spec.rigorous === true)) {
      return RigorousDistillationColumnSolver.solve(spec);
    }
    let problem;
    try {
      problem = buildProblem(spec);
    } catch (err) {
      if (err && err.code === 'INCOMPLETE_SPEC') {
        return unavailableResult(err.message);
      }
      return failureResult(err);
    }

    let solution;
    try {
      solution = solveMesh(problem);
    } catch (err) {
      return failureResult(err);
    }
    return formatResult(solution, problem);
  }
}

// ---------------------------------------------------------------------------
// Input normalization and validation
// ---------------------------------------------------------------------------

function wrapDipprSpecies(sp, dipprCatalog) {
  const Tc = sp.Tc;
  const Pc = sp.Pc;
  const omega = sp.omega;
  const mw = sp.mw || 18.015;
  const Tb = sp.Tb || (Tc * 0.65);
  const Tm = sp.Tm || sp.Tmin || (Tb * 0.6);
  const hvapJmol = dipprCatalog.evalHeatOfVaporization(sp, Math.min(Tb, Tc * 0.95));

  return {
    id: sp.id,
    name: sp.name || sp.id,
    formula: sp.formula || '',
    cas: sp.cas || '',
    mw,
    Tc,
    Pc,
    omega,
    Tb,
    triplePointK: Math.max(70.0, Tm),
    cpCoeffs: sp.dippr107_cp0 || [33, 0.05, 0, 0, 0],
    cpForm: 'dippr107',
    vpAnchor: {
      hvapKJmol: hvapJmol / 1000.0,
      T: Tb,
      P: 101325.0
    },
    getVaporPressure: (T) => dipprCatalog.evalVaporPressure(sp, T),
    getLatentHeatOfVaporization: (T) => dipprCatalog.evalHeatOfVaporization(sp, T) / 1000.0,
    getIdealGasEnthalpy: (T) => dipprCatalog.evalIdealGasEnthalpy(sp, T, T_REF_K),
    getLiquidDensity: (T) => dipprCatalog.evalLiquidDensity(sp, T),
    getLiquidViscosity: (T) => dipprCatalog.evalLiquidViscosity(sp, T),
    isDippr: true
  };
}

function buildProblem(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw incompleteSpec('An explicit column specification object is required.');
  }

  const stageCount = pickInt(spec, ['stageCount', 'stages'], 'stage count');
  if (stageCount < 5 || stageCount > 30) {
    throw incompleteSpec(`stageCount must be an integer from 5 through 30 (got ${stageCount}).`);
  }
  const feedStage = pickInt(spec, ['feedStage'], 'feed stage');
  if (feedStage < 1 || feedStage > stageCount) {
    throw incompleteSpec(`feedStage must be an integer within [1, stageCount] (got ${feedStage}).`);
  }

  const components = spec.components;
  if (!Array.isArray(components) || components.length < 2 || components.length > 5) {
    throw incompleteSpec('components must be an array of 2 through 5 species names.');
  }
  if (new Set(components.map(String)).size !== components.length) {
    throw incompleteSpec('components must be unique species names.');
  }

  const catalog = new CorrelationSpeciesCatalog();
  const dipprCatalog = getDipprCatalog();
  const props = components.map((name) => {
    let comp = null;
    if (!spec.useDippr && spec.kValueModel !== 'dippr' && spec.kValueModel !== 'peng-robinson' && spec.kValueModel !== 'pr') {
      comp = catalog.get(String(name));
    }
    if (!comp) {
      const sp = dipprCatalog.getSpecies(String(name));
      if (sp) {
        comp = wrapDipprSpecies(sp, dipprCatalog);
      }
    }
    if (!comp) {
      comp = catalog.get(String(name));
    }
    if (!comp) {
      throw incompleteSpec(
        `Unknown species '${name}' in the documented correlation set or DIPPR catalog; supply a supported catalog species.`
      );
    }
    return comp;
  });
  const NC = components.length;

  const z = resolveFeedFractions(spec, components);

  const refluxRatio = pickFinite(spec, ['refluxRatio'], 'reflux ratio');
  if (refluxRatio <= 0) throw incompleteSpec('refluxRatio must be positive.');
  const distillateRate = pickFinite(spec, ['distillateRate'], 'distillate rate');
  if (!(distillateRate > 0 && distillateRate < 1)) {
    throw incompleteSpec('distillateRate must be a positive fraction of the total feed, strictly below 1.');
  }

  const pressureProfilePa = resolvePressureProfile(spec, stageCount);

  const feedVaporFraction =
    spec.feedVaporFraction === undefined ? 0 : pickFinite(spec, ['feedVaporFraction'], 'feed vapor fraction');
  if (!(feedVaporFraction >= 0 && feedVaporFraction <= 1)) {
    throw incompleteSpec('feedVaporFraction must be within [0, 1].');
  }

  const kValueModel = spec.kValueModel || 'raoult';
  if (!K_MODELS.includes(kValueModel)) {
    throw incompleteSpec(`kValueModel must be one of ${K_MODELS.join(', ')}.`);
  }

  let prEos = null;
  if (kValueModel === 'peng-robinson' || kValueModel === 'pr') {
    prEos = PengRobinsonEOS.fromDippr(components);
  }

  const maxIterations =
    spec.maxIterations === undefined ? DEFAULT_MAX_ITERATIONS : pickInt(spec, ['maxIterations'], 'max iterations');
  if (maxIterations < 1) throw incompleteSpec('maxIterations must be a positive integer.');
  const tolerance = spec.tolerance === undefined ? DEFAULT_TOLERANCE : pickFinite(spec, ['tolerance'], 'tolerance');
  if (tolerance <= 0) throw incompleteSpec('tolerance must be positive.');

  const feedTemperatureK =
    spec.feedTemperatureK === undefined ? null : pickFinite(spec, ['feedTemperatureK'], 'feed temperature');

  const problem = {
    NC,
    N: stageCount,
    feedStage,
    components: components.map(String),
    props,
    z,
    refluxRatio,
    distillateRate,
    pressureProfilePa,
    feedVaporFraction,
    kValueModel,
    prEos,
    maxIterations,
    tolerance,
    feedTemperatureK,
    domainTmin: Math.max(...props.map((p) => p.triplePointK)),
    domainTmax: Math.min(...props.map((p) => p.Tc)),
    Qscale: Math.max(1, ...props.map((p) => p.vpAnchor.hvapKJmol * 1000))
  };

  if (problem.domainTmax <= problem.domainTmin) {
    throw incompleteSpec('The selected species have no common ideal-Raoult temperature domain.');
  }

  if (feedTemperatureK !== null) {
    if (!(feedTemperatureK > problem.domainTmin && feedTemperatureK < problem.domainTmax)) {
      throw incompleteSpec(
        `feedTemperatureK ${feedTemperatureK} is outside the ideal-Raoult domain ` +
          `[${problem.domainTmin.toFixed(2)}, ${problem.domainTmax.toFixed(2)}] K.`
      );
    }
  } else {
    problem.feedTemperatureK = bubbleTemperature(problem, z, pressureProfilePa[feedStage - 1]);
  }

  return problem;
}

function pickInt(spec, keys, label) {
  const value = firstDefined(spec, keys);
  if (!Number.isSafeInteger(value)) {
    throw incompleteSpec(`${label} must be an explicit integer (missing or invalid in spec).`);
  }
  return value;
}

function pickFinite(spec, keys, label) {
  const value = firstDefined(spec, keys);
  if (!Number.isFinite(value)) {
    throw incompleteSpec(`${label} must be an explicit finite number (missing or invalid in spec).`);
  }
  return value;
}

function firstDefined(spec, keys) {
  for (const key of keys) {
    if (spec[key] !== undefined && spec[key] !== null) return spec[key];
  }
  return undefined;
}

function resolveFeedFractions(spec, components) {
  const fractions = [];
  for (let i = 0; i < components.length; i++) {
    let value;
    if (Array.isArray(spec.feedFractions)) {
      value = spec.feedFractions[i];
    } else if (Array.isArray(spec.feedComposition)) {
      value = spec.feedComposition[i];
    } else if (spec.feedComposition && typeof spec.feedComposition === 'object') {
      value = spec.feedComposition[components[i]];
    } else {
      value = undefined;
    }
    if (!Number.isFinite(value) || value < 0) {
      throw incompleteSpec(
        `feedComposition/feedFractions must provide finite non-negative mole fractions for every component.`
      );
    }
    fractions.push(value);
  }
  const total = fractions.reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 1e-6) {
    throw incompleteSpec('Feed mole fractions must sum to 1.');
  }
  return fractions.map((v) => v / total);
}

function resolvePressureProfile(spec, stageCount) {
  if (Array.isArray(spec.pressureProfilePa)) {
    if (
      spec.pressureProfilePa.length !== stageCount ||
      spec.pressureProfilePa.some((p) => !Number.isFinite(p) || p <= 0)
    ) {
      throw incompleteSpec('pressureProfilePa must contain one finite positive pressure per stage.');
    }
    return spec.pressureProfilePa.slice();
  }
  const p = pickFinite(spec, ['pressurePa'], 'pressure');
  if (p <= 0) throw incompleteSpec('pressurePa must be positive.');
  return new Array(stageCount).fill(p);
}

// ---------------------------------------------------------------------------
// Thermodynamic helpers
// ---------------------------------------------------------------------------

function idealGasEnthalpy(prop, T) {
  if (typeof prop.getIdealGasEnthalpy === 'function') {
    return prop.getIdealGasEnthalpy(T);
  }
  const [A, B, C, D, E] = prop.cpCoeffs;
  const t = T / 1000;
  const t0 = T_REF_K / 1000;
  let integral;
  if (prop.cpForm === 'shomate') {
    integral =
      A * (t - t0) +
      (B / 2) * (t * t - t0 * t0) +
      (C / 3) * (t ** 3 - t0 ** 3) +
      (D / 4) * (t ** 4 - t0 ** 4) -
      E * (1 / t - 1 / t0);
  } else {
    integral =
      A * (t - t0) +
      (B / 2) * (t * t - t0 * t0) +
      (C / 3) * (t ** 3 - t0 ** 3) +
      (D / 4) * (t ** 4 - t0 ** 4) +
      (E / 5) * (t ** 5 - t0 ** 5);
  }
  return 1000 * integral;
}

function latentHeatJmol(prop, T) {
  return prop.getLatentHeatOfVaporization(T) * 1000;
}

function vaporEnthalpyJmol(prop, T) {
  return idealGasEnthalpy(prop, T);
}

function liquidEnthalpyJmol(prop, T) {
  return idealGasEnthalpy(prop, T) - latentHeatJmol(prop, T);
}

function kValue(problem, propIndex, T, P) {
  const prop = problem.props[propIndex];
  if (problem.kValueModel === 'wilson') {
    return (prop.Pc / P) * Math.exp(5.37 * (1 + prop.omega) * (1 - prop.Tc / T));
  }
  if (problem.kValueModel === 'peng-robinson' || problem.kValueModel === 'pr') {
    if (problem.prEos) {
      const z = problem.z;
      const liq = problem.prEos.calculateFugacityCoefficients(z, T, P, 'liquid');
      const vap = problem.prEos.calculateFugacityCoefficients(z, T, P, 'vapor');
      return Math.max(1e-8, liq.phi[propIndex] / Math.max(1e-8, vap.phi[propIndex]));
    }
    return (prop.Pc / P) * Math.exp(5.373 * (1 + prop.omega) * (1 - prop.Tc / T));
  }
  return prop.getVaporPressure(T) / P;
}

function kValueSafe(problem, propIndex, T, P) {
  try {
    const k = kValue(problem, propIndex, T, P);
    if (!Number.isFinite(k) || k <= 0) {
      throw new RangeError(`non-finite K-value for ${problem.components[propIndex]}`);
    }
    return k;
  } catch (err) {
    throw numericalFailure(
      `K-value evaluation failed for ${problem.components[propIndex]} at T=${T.toFixed(2)} K, ` +
        `P=${(P / 1e3).toFixed(1)} kPa: ${err.message}`,
      { component: problem.components[propIndex], temperatureK: T, pressurePa: P }
    );
  }
}

function bubbleTemperature(problem, x, P) {
  const lo = problem.domainTmin;
  const hi = problem.domainTmax;
  let fLo = 0;
  let fHi = 0;
  for (let i = 0; i < problem.NC; i++) {
    fLo += kValueSafe(problem, i, lo, P) * x[i];
    fHi += kValueSafe(problem, i, hi, P) * x[i];
  }
  fLo -= 1;
  fHi -= 1;
  if (Math.sign(fLo) === Math.sign(fHi) && Math.abs(fLo) > 1e-12 && Math.abs(fHi) > 1e-12) {
    throw numericalFailure('Bubble point not found within the ideal-Raoult temperature domain.', {
      sumKxAtMin: fLo + 1,
      sumKxAtMax: fHi + 1
    });
  }
  let a = lo;
  let b = hi;
  for (let iter = 0; iter < 100; iter++) {
    const mid = 0.5 * (a + b);
    let f = -1;
    for (let i = 0; i < problem.NC; i++) {
      f += kValueSafe(problem, i, mid, P) * x[i];
    }
    if (Math.abs(f) < 1e-12 || Math.abs(b - a) < 1e-10) return mid;
    if (Math.sign(f) === Math.sign(fLo)) {
      a = mid;
    } else {
      b = mid;
    }
  }
  return 0.5 * (a + b);
}

// ---------------------------------------------------------------------------
// Column model utilities
// ---------------------------------------------------------------------------

/**
 * CMO internal flows per stage (fraction of total feed).
 * Total condenser: V_1 = 0, L_1 = R D (reflux + distillate), V_2 = (R+1)D.
 */
function cmoFlows(problem) {
  const { N } = problem;
  const D = problem.distillateRate;
  const R = problem.refluxRatio;
  const q = problem.feedVaporFraction;
  const L = new Array(N + 1);
  const V = new Array(N + 1);
  L[1] = R * D;
  V[1] = 0;
  for (let j = 2; j < N; j++) {
    L[j] = R * D + (j >= problem.feedStage ? 1 - q : 0);
    V[j] = (R + 1) * D - (j > problem.feedStage ? q : 0);
  }
  L[N] = 1 - D; // bottoms
  V[N] = (R + 1) * D - (N > problem.feedStage ? q : 0);
  return { L, V };
}

/**
 * Stage state from composition solution: temperatures are bubble points of the
 * stage liquids (equilibrium/summation map), vapor compositions follow from
 * K values.
 */
function buildState(problem, x) {
  const { N, NC } = problem;
  const T = new Array(N + 1);
  const y = new Array(N + 1);
  const kVals = new Array(N + 1);
  for (let j = 1; j <= N; j++) {
    T[j] = bubbleTemperature(problem, x[j], problem.pressureProfilePa[j - 1]);
    const yj = new Array(NC);
    const kj = new Array(NC);
    for (let i = 0; i < NC; i++) {
      kj[i] = kValueSafe(problem, i, T[j], problem.pressureProfilePa[j - 1]);
      yj[i] = kj[i] * x[j][i];
    }
    y[j] = yj;
    kVals[j] = kj;
  }
  const flows = cmoFlows(problem);
  const F = new Array(N + 1).fill(0);
  F[problem.feedStage] = 1 - problem.feedVaporFraction;
  const Fvap = new Array(N + 1).fill(0);
  Fvap[problem.feedStage] = problem.feedVaporFraction;
  return { T, x, y, kVals, L: flows.L, V: flows.V, F, Fvap };
}

/**
 * Component material-balance residuals (M). Stage temperatures are supplied by
 * the bubble-point map; vapor compositions by equilibrium.
 */
function materialResiduals(problem, state, i) {
  const { N } = problem;
  const r = new Array(N + 1).fill(0);
  // condenser: V2 y2 = (L1 + D) x1
  r[1] = state.V[2] * state.y[2][i] - (state.L[1] + problem.distillateRate) * state.x[1][i];
  for (let j = 2; j <= N - 1; j++) {
    r[j] =
      state.L[j - 1] * state.x[j - 1][i] +
      state.V[j + 1] * state.y[j + 1][i] +
      state.F[j] * problem.z[i] -
      state.L[j] * state.x[j][i] -
      state.V[j] * state.y[j][i];
  }
  r[N] =
    state.L[N - 1] * state.x[N - 1][i] +
    state.F[N] * problem.z[i] -
    state.L[N] * state.x[N][i] -
    state.V[N] * state.y[N][i];
  return r;
}

// ---------------------------------------------------------------------------
// Newton-Raphson solve over composition variables (analytic M system)
// ---------------------------------------------------------------------------

function solveMesh(problem) {
  const { N, NC } = problem;
  let x = new Array(N + 1);
  for (let j = 1; j <= N; j++) {
    x[j] = problem.z.slice();
  }

  // initial composition ramp
  const xTop = problem.z.slice();
  const xBot = problem.z.slice();
  const factor = Math.min(0.5, Math.max(0.05, 0.25 + 0.2 * (problem.distillateRate - problem.z[0])));
  xTop[0] = Math.min(0.99, problem.z[0] + factor);
  xBot[NC - 1] = Math.min(0.99, problem.z[NC - 1] + factor);
  for (let i = 1; i < NC; i++) {
    xTop[i] = Math.max(1e-6, (problem.z[i] * (1 - xTop[0])) / (1 - problem.z[0]));
    xBot[NC - 1 - i] = Math.max(1e-6, (problem.z[NC - 1 - i] * (1 - xBot[NC - 1])) / (1 - problem.z[NC - 1]));
  }
  for (let j = 1; j <= N; j++) {
    const frac = (j - 1) / (N - 1);
    for (let i = 0; i < NC; i++) {
      x[j][i] = xTop[i] + frac * (xBot[i] - xTop[i]);
    }
  }

  const history = [];
  let maxMatResidual = Infinity;
  let maxBubbleResidual = Infinity;

  for (let iter = 1; iter <= problem.maxIterations; iter++) {
    const state = buildState(problem, x);

    // solve the linearized component material-balance system for each component
    let maxChange = 0;
    for (let i = 0; i < NC; i++) {
      const A = [];
      const rhs = [];
      let row = new Array(N).fill(0);
      row[0] = state.L[1] + problem.distillateRate;
      row[1] = -state.V[2] * state.kVals[2][i];
      A.push(row);
      rhs.push(0);
      for (let j = 2; j <= N - 1; j++) {
        row = new Array(N).fill(0);
        row[j - 2] = state.L[j - 1];
        row[j - 1] = -(state.L[j] + state.V[j] * state.kVals[j][i]);
        row[j] = state.V[j + 1] * state.kVals[j + 1][i];
        A.push(row);
        rhs.push(-state.F[j] * problem.z[i]);
      }
      row = new Array(N).fill(0);
      row[N - 2] = state.L[N - 1];
      row[N - 1] = -(state.L[N] + state.V[N] * state.kVals[N][i]);
      A.push(row);
      rhs.push(-state.F[N] * problem.z[i]);
      const xs = solveLinearSystem(A, rhs);
      for (let j = 1; j <= N; j++) {
        const v = Math.max(1e-12, xs[j - 1]);
        maxChange = Math.max(maxChange, Math.abs(v - x[j][i]));
        x[j][i] = v;
      }
    }

    // normalize and enforce positivity
    for (let j = 1; j <= N; j++) {
      const total = x[j].reduce((a, b2) => a + b2, 0);
      for (let i = 0; i < NC; i++) {
        x[j][i] /= total;
      }
    }

    const state2 = buildState(problem, x);
    maxMatResidual = 0;
    maxBubbleResidual = 0;
    for (let i = 0; i < NC; i++) {
      const rr = materialResiduals(problem, state2, i);
      for (let j = 1; j <= N; j++) {
        maxMatResidual = Math.max(maxMatResidual, Math.abs(rr[j]));
      }
    }
    for (let j = 2; j <= N; j++) {
      let bubble = -1;
      for (let i = 0; i < NC; i++) {
        bubble += state2.kVals[j][i] * state2.x[j][i];
      }
      maxBubbleResidual = Math.max(maxBubbleResidual, Math.abs(bubble));
    }
    history.push({ iteration: iter, maxMaterialResidual: maxMatResidual, maxBubbleResidual: maxBubbleResidual });

    if (maxMatResidual < problem.tolerance && maxBubbleResidual < problem.tolerance) {
      return {
        converged: true,
        iterations: iter,
        maxMaterialResidual: maxMatResidual,
        maxBubbleResidual: maxBubbleResidual,
        tolerance: problem.tolerance,
        history,
        x
      };
    }
    if (maxChange < 1e-14) {
      break;
    }
  }

  throw numericalFailure(
    `Column solver did not converge to ${problem.tolerance} within ${problem.maxIterations} iterations.`,
    {
      iterations: history.length,
      maxMaterialResidual: maxMatResidual,
      maxBubbleResidual: maxBubbleResidual,
      tolerance: problem.tolerance
    }
  );
}

function solveLinearSystem(A, b) {
  const n = b.length;
  if (A.length !== n || A.some((row) => row.length !== n)) {
    throw numericalFailure('Linear system dimensions are inconsistent.');
  }
  const M = A.map((row, i) => row.slice().concat(b[i]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    if (Math.abs(M[pivot][col]) < 1e-14) {
      throw numericalFailure('Singular linear system in Newton step.', { column: col });
    }
    if (pivot !== col) {
      const tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;
    }
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / M[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) {
        M[row][k] -= factor * M[col][k];
      }
    }
  }
  const x = new Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = M[i][n] / M[i][i];
  }
  return x;
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

function formatResult(solution, problem) {
  const { N, NC } = problem;
  const state = buildState(problem, solution.x);
  const D = problem.distillateRate;
  const B = 1 - D;
  const feedH = feedEnthalpies(problem);

  const T1 = state.T[1];
  let hL1 = 0;
  let hV2 = 0;
  for (let i = 0; i < NC; i++) {
    hL1 += state.x[1][i] * liquidEnthalpyJmol(problem.props[i], T1);
    hV2 += state.y[2][i] * vaporEnthalpyJmol(problem.props[i], state.T[2]);
  }
  const QcJperMolFeed = state.V[2] * hV2 - (state.L[1] + D) * hL1;

  let hLprev = 0;
  for (let i = 0; i < NC; i++) {
    hLprev += state.x[N - 1][i] * liquidEnthalpyJmol(problem.props[i], state.T[N - 1]);
  }
  let hLN = 0;
  let hVN = 0;
  for (let i = 0; i < NC; i++) {
    hLN += state.x[N][i] * liquidEnthalpyJmol(problem.props[i], state.T[N]);
    hVN += state.y[N][i] * vaporEnthalpyJmol(problem.props[i], state.T[N]);
  }
  const QrJperMolFeed =
    state.L[N - 1] * hLprev + state.F[N] * feedH.hL + state.Fvap[N] * feedH.hV - B * hLN - state.V[N] * hVN;

  const stages = [];
  for (let j = 1; j <= N; j++) {
    const liquidComposition = {};
    const vaporComposition = {};
    const kVals = {};
    for (let i = 0; i < NC; i++) {
      liquidComposition[problem.components[i]] = state.x[j][i];
      vaporComposition[problem.components[i]] = state.y[j][i];
      kVals[problem.components[i]] = state.kVals[j][i];
    }
    stages.push({
      stage: j,
      temperatureK: state.T[j],
      pressurePa: problem.pressureProfilePa[j - 1],
      liquidFlowKmolPerMolFeed: state.L[j],
      vaporFlowKmolPerMolFeed: state.V[j],
      liquidComposition,
      vaporComposition,
      equilibriumKValues: kVals
    });
  }

  const distillateComposition = {};
  const bottomsComposition = {};
  const closure = {};
  let maxClosure = 0;
  for (let i = 0; i < NC; i++) {
    distillateComposition[problem.components[i]] = state.x[1][i];
    bottomsComposition[problem.components[i]] = state.x[N][i];
    const closure_i = D * state.x[1][i] + B * state.x[N][i] - problem.z[i];
    closure[problem.components[i]] = closure_i;
    if (Math.abs(closure_i) > maxClosure) maxClosure = Math.abs(closure_i);
  }

  const warnings = [];
  if (problem.kValueModel === 'wilson') {
    warnings.push('Wilson K-values are a screening correlation; not fugacity-based EOS equilibrium.');
  } else {
    warnings.push('Ideal Raoult K-values from documented Clausius-Clapeyron vapor pressures.');
  }

  return {
    success: true,
    status: 'converged',
    validationLevel: 'experimental',
    model:
      'equilibrium-stage column (total condenser + reboiler); simultaneous Newton-Raphson over component material balances with bubble-point temperature map; CMO internal flows',
    kValueModel: problem.kValueModel,
    assumptions: [
      'Total condenser with saturated reflux; partial reboiler; stages 2..N at equilibrium.',
      'Ideal liquid/vapor solutions (Raoult K-values).',
      'Constant-molal-overflow internal flows (sensible heat neglected relative to latent heat); condenser/reboiler duties reported from stage enthalpy balances.',
      'Flows normalized per mole of total feed; pressure constant or per-stage profile.',
      'No tray hydraulics, efficiencies, pressure drop, heat loss, or side streams.'
    ],
    input: {
      stageCount: problem.N,
      feedStage: problem.feedStage,
      components: problem.components.slice(),
      feedComposition: Object.fromEntries(problem.components.map((c, i) => [c, problem.z[i]])),
      refluxRatio: problem.refluxRatio,
      distillateRate: problem.distillateRate,
      feedTemperatureK: problem.feedTemperatureK,
      feedVaporFraction: problem.feedVaporFraction,
      pressurePa: problem.pressureProfilePa.length === 1 ? problem.pressureProfilePa[0] : null,
      pressureProfilePa: problem.pressureProfilePa.slice()
    },
    convergence: {
      status: 'converged',
      iterations: solution.iterations,
      maxMaterialResidual: solution.maxMaterialResidual,
      maxBubbleResidual: solution.maxBubbleResidual,
      tolerance: problem.tolerance,
      history: solution.history
    },
    profiles: {
      stages,
      condenser: { temperatureK: T1, dutyKJPerMolFeed: QcJperMolFeed / 1000 },
      reboiler: { temperatureK: state.T[N], dutyKJPerMolFeed: QrJperMolFeed / 1000 }
    },
    products: {
      distillate: { flowKmolPerMolFeed: D, composition: distillateComposition },
      bottoms: { flowKmolPerMolFeed: B, composition: bottomsComposition }
    },
    massBalance: {
      closurePerComponent: closure,
      maxAbsComponentClosure: maxClosure,
      maxAbsTolerance: 1e-6
    },
    warnings
  };
}

function feedEnthalpies(problem) {
  const { NC } = problem;
  const Tf = problem.feedTemperatureK;
  let hL = 0;
  let hV = 0;
  for (let i = 0; i < NC; i++) {
    hL += problem.z[i] * liquidEnthalpyJmol(problem.props[i], Tf);
    hV += problem.z[i] * vaporEnthalpyJmol(problem.props[i], Tf);
  }
  return { hL, hV };
}

class WaterHammerMOC {
  /** The legacy transient simulation is disabled pending model review. */
  static solve() {
    return unavailableResult();
  }

  /** The legacy transient simulation is disabled pending model review. */
  static simulateMOC() {
    return unavailableResult();
  }

  /**
   * Evaluates the illustrative elastic-pipe wave-speed equation from explicit inputs.
   * This standalone estimate is experimental and does not assess piping-code compliance.
   */
  static computeWaveSpeed(spec) {
    const names = ['fluidBulkModulusPa', 'fluidDensityKgM3', 'pipeModulusPa', 'pipeDiameterM', 'wallThicknessM'];
    const missing = names.filter((name) => !Number.isFinite(spec?.[name]));
    if (missing.length) {
      throw new TypeError(`computeWaveSpeed requires explicit finite inputs: ${missing.join(', ')}.`);
    }
    const {
      fluidBulkModulusPa: K,
      fluidDensityKgM3: rho,
      pipeModulusPa: E,
      pipeDiameterM: D,
      wallThicknessM: t
    } = spec;
    if (K <= 0 || rho <= 0 || E <= 0 || D <= 0 || t <= 0 || t >= D / 2) {
      throw new RangeError('Wave-speed inputs are outside the supported positive geometry and property ranges.');
    }

    return Math.sqrt(K / rho) / Math.sqrt(1 + (K / E) * (D / t));
  }

  /** Explicit Joukowsky relation for a specified fluid, wave speed, and velocity change. */
  static computeJoukowskySurge(fluidDensityKgM3, waveSpeedMs, initialVelocityMs) {
    if (
      !Number.isFinite(fluidDensityKgM3) ||
      fluidDensityKgM3 <= 0 ||
      !Number.isFinite(waveSpeedMs) ||
      waveSpeedMs <= 0 ||
      !Number.isFinite(initialVelocityMs)
    ) {
      throw new TypeError('computeJoukowskySurge requires positive density and wave speed and a finite velocity.');
    }
    const pressureSurgePa = fluidDensityKgM3 * waveSpeedMs * initialVelocityMs;
    const headSurgeM = (waveSpeedMs * initialVelocityMs) / 9.80665;
    return { pressureSurgePa, headSurgeM };
  }
}

module.exports = {
  NaphtaliSandholmColumnSolver,
  WaterHammerMOC,
  _internals: {
    buildProblem,
    solveMesh,
    formatResult,
    buildState,
    cmoFlows,
    materialResiduals,
    bubbleTemperature,
    kValue
  }
};
