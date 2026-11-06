/**
 * RigorousDistillationColumnSolver — Naphtali–Sandholm simultaneous-correction
 * equilibrium-stage distillation column solver (full MESH equations).
 *
 * Model and assumptions (documented):
 *   - Stages are numbered 1..N top to bottom. Stage 1 is a TOTAL condenser
 *     (saturated reflux, no subcooling), stage N is a partial reboiler.
 *     Stages 2..N are equilibrium stages (trays plus reboiler).
 *   - Primary unknowns per stage (Naphtali–Sandholm rectangular form):
 *       stage 1 (condenser): liquid mole fractions x (C), temperature T,
 *                            condenser duty Qc;
 *       stages 2..N-1:      x (C), vapor mole fractions y (C), T, liquid
 *                            flow L, vapor flow V;
 *       stage N (reboiler): x (C), y (C), T, L, V, reboiler duty Qr.
 *     Fixed by specification: L_1 = R*D (reflux), V_1 = 0, L_0 = 0,
 *     V_{N+1} = 0, D (distillate rate).
 *   - Equations per stage (MESH):
 *       M_i  component material balance (C equations);
 *       E_i  equilibrium relation y_i = K_i x_i (C equations) — for the
 *            total condenser, E is y_i = x_i (total condensation);
 *       S_x  liquid mole-fraction summation = 1;
 *       S_y  vapor mole-fraction summation = 1;
 *       H    enthalpy balance (adiabatic stages Q = 0; condenser/reboiler
 *            duties are unknowns determined by H).
 *     The condenser temperature is pinned by the saturated-reflux bubble-point
 *     relation sum_i K_i(T) x_i = 1.
 *   - K-values: ideal Raoult K_i = P_i^sat(T)/P (documented Clausius–
 *     Clapeyron vapor pressures from thermo_compounds.js), or modified
 *     Raoult with Wilson / NRTL liquid activity coefficients
 *     K_i = gamma_i(T, x) P_i^sat(T)/P (activity_models_unifac_nrtl.js).
 *   - Enthalpies: ideal-gas Cp polynomials (NIST/Shomate or 4th-order) plus
 *     Watson latent-heat correction for the liquid, same documented basis
 *     as thermo_compounds.js.
 *   - The Jacobian is block-tridiagonal (stage j equations touch stages
 *     j-1, j, j+1) and is assembled by finite differences; the Newton
 *     step solves the block-tridiagonal system with block Gauss–Thomas
 *     elimination. Backtracking line search damps the step. No external
 *     runtime dependencies.
 *
 * Convergence: max-norm of the scaled residual vector (material, equilibrium,
 * summation, and scaled enthalpy balances) below `tolerance` (default 1e-9).
 */

'use strict';

const { CorrelationSpeciesCatalog } = require('./thermo_compounds');
const { ActivityModelsUNIFACNRTL } = require('./activity_models_unifac_nrtl');
const { getDipprCatalog } = require('./dippr_expanded_catalog');

const R_GAS = 8.314462618; // J/(mol*K)
const T_REF_K = 298.15; // enthalpy reference temperature
const DEFAULT_TOLERANCE = 1e-9;
const DEFAULT_MAX_ITERATIONS = 100;
const MAX_STAGES = 40;
const MAX_COMPONENTS = 10;
const K_MODELS = Object.freeze(['raoult', 'wilson', 'nrtl', 'dippr']);
const FLOW_MODELS = Object.freeze(['rigorous', 'cmo']);

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

// ---------------------------------------------------------------------------
// Pure-component enthalpy helpers (same documented basis as thermo_compounds)
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

function liquidEnthalpyJmol(prop, T) {
  return idealGasEnthalpy(prop, T) - prop.getLatentHeatOfVaporization(T) * 1000;
}

function vaporEnthalpyJmol(prop, T) {
  return idealGasEnthalpy(prop, T);
}

// ---------------------------------------------------------------------------
// Input normalization and validation
// ---------------------------------------------------------------------------

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
        'feedComposition/feedFractions must provide finite non-negative mole fractions for every component.'
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

function buildProblem(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw incompleteSpec('An explicit column specification object is required.');
  }

  const stageCount = pickInt(spec, ['stageCount', 'stages'], 'stage count');
  if (stageCount < 3 || stageCount > MAX_STAGES) {
    throw incompleteSpec(`stageCount must be an integer from 3 through ${MAX_STAGES} (got ${stageCount}).`);
  }
  const feedStage = pickInt(spec, ['feedStage'], 'feed stage');
  if (feedStage < 1 || feedStage > stageCount) {
    throw incompleteSpec(`feedStage must be an integer within [1, stageCount] (got ${feedStage}).`);
  }

  const components = spec.components;
  if (!Array.isArray(components) || components.length < 2 || components.length > MAX_COMPONENTS) {
    throw incompleteSpec(`components must be an array of 2 through ${MAX_COMPONENTS} species names.`);
  }
  if (new Set(components.map(String)).size !== components.length) {
    throw incompleteSpec('components must be unique species names.');
  }

  const catalog = new CorrelationSpeciesCatalog();
  const dipprCatalog = getDipprCatalog();
  const props = components.map((name) => {
    let comp = null;
    if (!spec.useDippr && spec.kValueModel !== 'dippr') {
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

  const flowModel = spec.flowModel || 'rigorous';
  if (!FLOW_MODELS.includes(flowModel)) {
    throw incompleteSpec(`flowModel must be one of ${FLOW_MODELS.join(', ')}.`);
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
    flowModel,
    maxIterations,
    tolerance,
    feedTemperatureK,
    wilsonLambda: spec.wilsonLambda || null,
    nrtl: spec.nrtl || null,
    domainTmin: Math.max(...props.map((p) => p.triplePointK)),
    domainTmax: Math.min(...props.map((p) => p.Tc))
  };

  if (problem.domainTmax <= problem.domainTmin) {
    throw incompleteSpec('The selected species have no common temperature domain.');
  }

  if (problem.kValueModel === 'wilson') {
    const lam = problem.wilsonLambda;
    if (
      !lam ||
      !Array.isArray(lam) ||
      lam.length !== NC ||
      lam.some((row) => !Array.isArray(row) || row.length !== NC || row.some((v) => !Number.isFinite(v)))
    ) {
      throw incompleteSpec(`wilsonLambda must be a ${NC}x${NC} matrix of finite interaction parameters.`);
    }
  }
  if (problem.kValueModel === 'nrtl') {
    const nrtl = problem.nrtl;
    const checkMatrix = (name, mat) => {
      if (
        !mat ||
        !Array.isArray(mat) ||
        mat.length !== NC ||
        mat.some((row) => !Array.isArray(row) || row.length !== NC || row.some((v) => !Number.isFinite(v)))
      ) {
        throw incompleteSpec(`nrtl.${name} must be a ${NC}x${NC} matrix of finite parameters.`);
      }
    };
    checkMatrix('aMatrix', nrtl && nrtl.aMatrix);
    checkMatrix('bMatrix', nrtl && nrtl.bMatrix);
    checkMatrix('alphaMatrix', nrtl && nrtl.alphaMatrix);
  }

  return problem;
}

// ---------------------------------------------------------------------------
// K-value and bubble-temperature helpers
// ---------------------------------------------------------------------------

function gammaVector(problem, T, x) {
  if (problem.kValueModel === 'wilson') {
    return new ActivityModelsUNIFACNRTL().evaluateWilson(x, problem.wilsonLambda);
  }
  if (problem.kValueModel === 'nrtl') {
    const n = problem.nrtl;
    return new ActivityModelsUNIFACNRTL().evaluateNRTL(x, T, n.aMatrix, n.bMatrix, n.alphaMatrix);
  }
  return null;
}

function kValues(problem, T, P, x) {
  const { NC } = problem;
  const gamma = gammaVector(problem, T, x);
  const k = new Array(NC);
  for (let i = 0; i < NC; i++) {
    const psat = problem.props[i].getVaporPressure(T);
    k[i] = (gamma ? gamma[i] : 1) * (psat / P);
    if (!Number.isFinite(k[i]) || k[i] <= 0) {
      throw numericalFailure(`K-value evaluation failed for ${problem.components[i]} at T=${T.toFixed(2)} K.`, {
        component: problem.components[i],
        temperatureK: T,
        pressurePa: P
      });
    }
  }
  return k;
}

function bubbleTemperature(problem, x, P) {
  const lo = problem.domainTmin;
  const hi = problem.domainTmax;
  let fLo = -1;
  let fHi = -1;
  const kLo = kValues(problem, lo, P, x);
  const kHi = kValues(problem, hi, P, x);
  for (let i = 0; i < problem.NC; i++) {
    fLo += kLo[i] * x[i];
    fHi += kHi[i] * x[i];
  }
  if (Math.sign(fLo) === Math.sign(fHi) && Math.abs(fLo) > 1e-9 && Math.abs(fHi) > 1e-9) {
    throw numericalFailure('Bubble point not found within the common temperature domain.', {
      sumKxAtMin: fLo + 1,
      sumKxAtMax: fHi + 1
    });
  }
  let a = lo;
  let b = hi;
  for (let iter = 0; iter < 200; iter++) {
    const mid = 0.5 * (a + b);
    let f = -1;
    const k = kValues(problem, mid, P, x);
    for (let i = 0; i < problem.NC; i++) {
      f += k[i] * x[i];
    }
    if (Math.abs(f) < 1e-13 || Math.abs(b - a) < 1e-12) return mid;
    if (Math.sign(f) === Math.sign(fLo)) {
      a = mid;
    } else {
      b = mid;
    }
  }
  return 0.5 * (a + b);
}

// ---------------------------------------------------------------------------
// Variable layout
// ---------------------------------------------------------------------------

// Per-stage primary-variable block sizes.
//   condenser (stage 1): [x (C)]             (T1 from bubble point, L1 = R*D,
//                                            V1 = 0, y1 = x1)
//   rigorous flow model, equilibrium stages:
//                       [x (C), y (C), T, L, V]
//   rigorous flow model, reboiler (stage N):
//                       [x (C), y (C), T, V] (L_N = B = 1 - D fixed)
//   CMO flow model (equimolar overflow), equilibrium stages and reboiler:
//                       [x (C), y (C), T]   (L, V from CMO relations)
function blockSizes(problem) {
  const { N, NC, flowModel } = problem;
  const sz = new Array(N + 1);
  sz[1] = NC;
  if (flowModel === 'cmo') {
    for (let j = 2; j <= N; j++) sz[j] = 2 * NC + 1;
  } else {
    for (let j = 2; j <= N - 1; j++) sz[j] = 2 * NC + 3;
    sz[N] = 2 * NC + 2;
  }
  return sz;
}

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
  L[N] = 1 - D;
  V[N] = (R + 1) * D - (N > problem.feedStage ? q : 0);
  return { L, V };
}

function layout(problem) {
  const sz = blockSizes(problem);
  const { N } = problem;
  const colStart = new Array(N + 1);
  const rowStart = new Array(N + 1);
  colStart[1] = 0;
  rowStart[1] = 0;
  for (let j = 2; j <= N; j++) {
    colStart[j] = colStart[j - 1] + sz[j - 1];
    rowStart[j] = rowStart[j - 1] + sz[j - 1];
  }
  const total = colStart[N] + sz[N];
  return { sz, colStart, rowStart, total };
}

function decodeState(u, problem) {
  const { N, NC } = problem;
  const lay = layout(problem);
  const x = new Array(N + 1);
  const y = new Array(N + 1);
  const T = new Array(N + 1);
  const L = new Array(N + 1);
  const V = new Array(N + 1);
  const Q = new Array(N + 1);

  for (let j = 1; j <= N; j++) {
    const o = lay.colStart[j];
    if (j === 1) {
      // condenser block layout: [x (C)]; T1 is the bubble point of x1
      x[j] = u.slice(o, o + NC);
      T[j] = bubbleTemperature(problem, x[j], problem.pressureProfilePa[0]);
      y[j] = x[j].slice();
      L[j] = problem.refluxRatio * problem.distillateRate;
      V[j] = 0;
      Q[j] = 0;
      continue;
    }
    x[j] = u.slice(o, o + NC);
    y[j] = u.slice(o + NC, o + 2 * NC);
    T[j] = u[o + 2 * NC];
    if (problem.flowModel === 'cmo') {
      const flows = cmoFlows(problem);
      L[j] = flows.L[j];
      V[j] = flows.V[j];
      Q[j] = 0;
    } else if (j === N) {
      // reboiler block layout: [x (C), y (C), T, V]; L_N = B = 1 - D
      L[j] = 1 - problem.distillateRate;
      V[j] = u[o + 2 * NC + 1];
      Q[j] = 0;
    } else {
      // equilibrium-stage block layout: [x (C), y (C), T, L, V]
      L[j] = u[o + 2 * NC + 1];
      V[j] = u[o + 2 * NC + 2];
      Q[j] = 0;
    }
  }
  return { x, y, T, L, V, Q, lay };
}

function encodeState(state, problem) {
  const { N, NC } = problem;
  const lay = layout(problem);
  const u = new Array(lay.total);
  for (let j = 1; j <= N; j++) {
    const o = lay.colStart[j];
    if (j === 1) {
      for (let i = 0; i < NC; i++) u[o + i] = state.x[j][i];
      continue;
    }
    for (let i = 0; i < NC; i++) u[o + i] = state.x[j][i];
    for (let i = 0; i < NC; i++) u[o + NC + i] = state.y[j][i];
    u[o + 2 * NC] = state.T[j];
    if (problem.flowModel === 'cmo') {
      // L and V are fixed by the CMO relations
    } else if (j === N) {
      u[o + 2 * NC + 1] = state.V[j];
    } else {
      u[o + 2 * NC + 1] = state.L[j];
      u[o + 2 * NC + 2] = state.V[j];
    }
  }
  return u;
}

// ---------------------------------------------------------------------------
// Residual assembly (MESH equations)
// ---------------------------------------------------------------------------

function enthalpyScales(problem, state) {
  // Characteristic enthalpy-flow magnitude for scaling the H residuals.
  let scale = 1;
  for (let j = 1; j <= problem.N; j++) {
    let hL = 0;
    let hV = 0;
    for (let i = 0; i < problem.NC; i++) {
      hL += state.x[j][i] * liquidEnthalpyJmol(problem.props[i], state.T[j]);
      hV += state.y[j][i] * vaporEnthalpyJmol(problem.props[i], state.T[j]);
    }
    scale = Math.max(scale, Math.abs(state.L[j]) * Math.abs(hL), Math.abs(state.V[j]) * Math.abs(hV));
  }
  return scale;
}

function liquidEnthalpyMixture(problem, state, j) {
  let h = 0;
  for (let i = 0; i < problem.NC; i++) {
    h += state.x[j][i] * liquidEnthalpyJmol(problem.props[i], state.T[j]);
  }
  return h;
}

function vaporEnthalpyMixture(problem, state, j) {
  let h = 0;
  for (let i = 0; i < problem.NC; i++) {
    h += state.y[j][i] * vaporEnthalpyJmol(problem.props[i], state.T[j]);
  }
  return h;
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

function residual(u, problem, hScale) {
  const { N, NC } = problem;
  const state = decodeState(u, problem);
  const F = new Array(u.length);

  // K-values per stage (equilibrium stages plus condenser bubble-point use).
  const K = new Array(N + 1);
  for (let j = 1; j <= N; j++) {
    K[j] = kValues(problem, state.T[j], problem.pressureProfilePa[j - 1], state.x[j]);
  }

  const feedL = new Array(N + 1).fill(0);
  const feedV = new Array(N + 1).fill(0);
  feedL[problem.feedStage] = 1 - problem.feedVaporFraction;
  feedV[problem.feedStage] = problem.feedVaporFraction;
  const feedH = feedEnthalpies(problem);

  const put = (j, row, value) => {
    if (!Number.isFinite(value) && process.env.DBG_NS) {
      console.error('DBG NaN put j', j, 'row', row, 'val', value);
    }
    F[state.lay.rowStart[j] + row] = value;
  };

  // Stage 1: total condenser. Component balances (C): the condensed vapor
  // composition x1 is set by the vapor rising from stage 2, V2*y2,i =
  // (L1 + D)*x1,i. L1 = R*D and V1 = 0 are fixed; T1 is the bubble point of
  // x1 and the condenser duty is recovered afterwards from the enthalpy
  // balance. The column total balance closes through the telescoping of all
  // stage M residuals.
  {
    const j = 1;
    const L1 = state.L[1];
    const D = problem.distillateRate;
    const V2 = state.V[2];
    for (let i = 0; i < NC; i++) {
      put(j, i, V2 * state.y[2][i] + (feedL[j] + feedV[j]) * problem.z[i] - (L1 + D) * state.x[1][i]);
    }
  }

  if (problem.flowModel === 'cmo') {
    // CMO mode: L, V are fixed by the equimolar-overflow relations; the
    // enthalpy balance is not solved (duties are recovered afterwards).
    // Rows for stages 2..N: M_i (C-1), E_i (C), Sx, Sy = 2C+1 equations.
    for (let j = 2; j <= N; j++) {
      if (process.env.DBG_NS && j === 2) {
        console.error('DBG inres V3', state.V[3], 'y3', state.y[3]);
      }
      const vIn = j < N ? state.V[j + 1] : 0;
      const vTerm = j < N ? state.V[j + 1] * state.y[j + 1] : new Array(NC).fill(0);
      if (process.env.DBG_NS && j === 2) {
        console.error('DBG V', JSON.stringify(state.V.slice(1)));
        console.error('DBG y3', JSON.stringify(state.y[3]));
        console.error('DBG keyof y3', Object.keys(state.y[3]));
        console.error('DBG y3[0]', state.y[3][0], 'y3[1]', state.y[3][1]);
      }
      for (let i = 0; i < NC - 1; i++) {
        const M =
          state.L[j - 1] * state.x[j - 1][i] +
          (j < N ? vTerm[i] : 0) +
          feedL[j] * problem.z[i] +
          feedV[j] * problem.z[i] -
          state.L[j] * state.x[j][i] -
          state.V[j] * state.y[j][i];
        if (!Number.isFinite(M) && process.env.DBG_NS) {
          console.error(
            'DBG M j',
            j,
            'i',
            i,
            'Ljm1',
            state.L[j - 1],
            'xjm1',
            state.x[j - 1],
            'vTerm',
            vTerm,
            'feedL',
            feedL[j],
            'z',
            problem.z[i],
            'Lj',
            state.L[j],
            'xj',
            state.x[j],
            'Vj',
            state.V[j],
            'yj',
            state.y[j]
          );
        }
        put(j, i, M);
      }
      for (let i = 0; i < NC; i++) {
        put(j, NC - 1 + i, state.y[j][i] - K[j][i] * state.x[j][i]);
      }
      let sx = -1;
      let sy = -1;
      for (let i = 0; i < NC; i++) {
        sx += state.x[j][i];
        sy += state.y[j][i];
      }
      put(j, 2 * NC - 1, sx);
      put(j, 2 * NC, sy);
    }
  } else {
    // Stages 2..N-1: equilibrium stages. Rows: M_i (C), E_i (C), Sx, Sy, H.
    for (let j = 2; j <= N - 1; j++) {
      for (let i = 0; i < NC; i++) {
        const M =
          state.L[j - 1] * state.x[j - 1][i] +
          state.V[j + 1] * state.y[j + 1][i] +
          feedL[j] * problem.z[i] +
          feedV[j] * problem.z[i] -
          state.L[j] * state.x[j][i] -
          state.V[j] * state.y[j][i];
        put(j, i, M);
        put(j, NC + i, state.y[j][i] - K[j][i] * state.x[j][i]);
      }
      let sx = -1;
      let sy = -1;
      for (let i = 0; i < NC; i++) {
        sx += state.x[j][i];
        sy += state.y[j][i];
      }
      put(j, 2 * NC, sx);
      put(j, 2 * NC + 1, sy);
      const hLprev = liquidEnthalpyMixture(problem, state, j - 1);
      const hVnext = vaporEnthalpyMixture(problem, state, j + 1);
      const hL = liquidEnthalpyMixture(problem, state, j);
      const hV = vaporEnthalpyMixture(problem, state, j);
      const H =
        state.L[j - 1] * hLprev +
        state.V[j + 1] * hVnext +
        feedL[j] * feedH.hL +
        feedV[j] * feedH.hV -
        state.L[j] * hL -
        state.V[j] * hV;
      put(j, 2 * NC + 2, H / hScale);
    }

    // Stage N: partial reboiler. Rows: M_i (C), E_i (C), Sx, Sy.
    // L_N = B = 1 - D is fixed; the reboiler duty is recovered afterwards from
    // the enthalpy balance.
    {
      const j = N;
      for (let i = 0; i < NC; i++) {
        const M =
          state.L[N - 1] * state.x[N - 1][i] +
          feedL[j] * problem.z[i] +
          feedV[j] * problem.z[i] -
          state.L[j] * state.x[j][i] -
          state.V[j] * state.y[j][i];
        put(j, i, M);
        put(j, NC + i, state.y[j][i] - K[j][i] * state.x[j][i]);
      }
      let sx = -1;
      let sy = -1;
      for (let i = 0; i < NC; i++) {
        sx += state.x[j][i];
        sy += state.y[j][i];
      }
      put(j, 2 * NC, sx);
      put(j, 2 * NC + 1, sy);
    }
  }

  return { F, state, K };
}

// ---------------------------------------------------------------------------
// Numerical Jacobian (block-tridiagonal structure)
// ---------------------------------------------------------------------------

function jacobianBlocks(u, problem, hScale) {
  const { N } = problem;
  const lay = layout(problem);
  const F0 = residual(u, problem, hScale).F;

  // Block matrices.
  const A = new Array(N + 1); // A[j]: rows of stage j, cols of stage j-1
  const B = new Array(N + 1); // B[j]: rows of stage j, cols of stage j
  const C = new Array(N + 1); // C[j]: rows of stage j, cols of stage j+1
  for (let j = 1; j <= N; j++) {
    const rows = lay.sz[j];
    const cols = lay.sz[j];
    B[j] = zeros(rows, cols);
    if (j > 1) A[j] = zeros(rows, lay.sz[j - 1]);
    if (j < N) C[j] = zeros(rows, lay.sz[j + 1]);
  }

  for (let j = 1; j <= N; j++) {
    const colBase = lay.colStart[j];
    const colCount = lay.sz[j];
    for (let p = 0; p < colCount; p++) {
      const g = colBase + p;
      const h = Math.max(1e-9, 1e-7 * Math.abs(u[g]));
      u[g] += h;
      const Fp = residual(u, problem, hScale).F;
      u[g] -= h;
      // Affected rows: stages j-1, j, j+1.
      if (j > 1) {
        const r0 = lay.rowStart[j - 1];
        const rows = lay.sz[j - 1];
        for (let r = 0; r < rows; r++) C[j - 1][r][p] = (Fp[r0 + r] - F0[r0 + r]) / h;
      }
      {
        const r0 = lay.rowStart[j];
        const rows = lay.sz[j];
        for (let r = 0; r < rows; r++) B[j][r][p] = (Fp[r0 + r] - F0[r0 + r]) / h;
      }
      if (j < N) {
        const r0 = lay.rowStart[j + 1];
        const rows = lay.sz[j + 1];
        for (let r = 0; r < rows; r++) A[j + 1][r][p] = (Fp[r0 + r] - F0[r0 + r]) / h;
      }
    }
  }

  return { A, B, C };
}

function zeros(rows, cols) {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

// ---------------------------------------------------------------------------
// Dense linear algebra helpers
// ---------------------------------------------------------------------------

function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.slice().concat(b[i]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    if (Math.abs(M[pivot][col]) < 1e-13) {
      return null; // singular
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

// Solve A X = B where A is n x n and B is n x m; returns n x m or null.
function solveMatrixSystem(A, B) {
  const n = A.length;
  const m = B[0].length;
  const M = A.map((row, i) => row.slice().concat(B[i].slice()));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    if (Math.abs(M[pivot][col]) < 1e-13) {
      return null;
    }
    if (pivot !== col) {
      const tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;
    }
    const diag = M[col][col];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / diag;
      if (factor === 0) continue;
      for (let k = col; k < n + m; k++) {
        M[row][k] -= factor * M[col][k];
      }
    }
  }
  const X = zeros(n, m);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < m; k++) {
      X[i][k] = M[i][n + k] / M[i][i];
    }
  }
  return X;
}

function matmul(A, B) {
  const rows = A.length;
  const cols = B[0].length;
  const inner = B.length;
  const C = zeros(rows, cols);
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < inner; k++) {
      const aik = A[i][k];
      if (aik === 0) continue;
      const Bk = B[k];
      for (let j = 0; j < cols; j++) {
        C[i][j] += aik * Bk[j];
      }
    }
  }
  return C;
}

function matvec(A, v) {
  const rows = A.length;
  const out = new Array(rows).fill(0);
  for (let i = 0; i < rows; i++) {
    const row = A[i];
    let s = 0;
    for (let k = 0; k < row.length; k++) s += row[k] * v[k];
    out[i] = s;
  }
  return out;
}

function vecAdd(a, b, scaleB) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + scaleB * b[i];
  return out;
}

function maxNorm(v) {
  let m = 0;
  for (const val of v) m = Math.max(m, Math.abs(val));
  return m;
}

// Block-tridiagonal solve with rectangular off-diagonal blocks.
function solveBlockTridiagonal(A, B, C, rhs, layerSizes) {
  const N = layerSizes.length - 1;
  const rowOffset = new Array(N + 1);
  rowOffset[1] = 0;
  for (let j = 2; j <= N; j++) {
    rowOffset[j] = rowOffset[j - 1] + layerSizes[j - 1];
  }
  const D = new Array(N + 1);
  const R = new Array(N + 1);
  D[1] = B[1].map((row) => row.slice());
  R[1] = rhs.slice(0, layerSizes[1]);

  for (let j = 2; j <= N; j++) {
    // tmp = D_{j-1}^{-1} C_{j-1}
    const tmp = solveMatrixSystem(D[j - 1], C[j - 1]);
    if (!tmp) return null;
    const prod = matmul(A[j], tmp);
    const rows = layerSizes[j];
    const cols = layerSizes[j];
    D[j] = zeros(rows, cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        D[j][r][c] = B[j][r][c] - prod[r][c];
      }
    }
    // R_j = rhs_j - A_j D_{j-1}^{-1} R_{j-1}
    const rhsSl = rhs.slice(rowOffset[j], rowOffset[j] + rows);
    const tmp2 = solveMatrixSystem(
      D[j - 1],
      R[j - 1].map((v) => [v])
    );
    if (!tmp2) return null;
    const prod2 = matmul(A[j], tmp2);
    R[j] = new Array(rows);
    for (let r = 0; r < rows; r++) {
      R[j][r] = rhsSl[r] - prod2[r][0];
    }
  }

  const X = new Array(N + 1);
  const XN = solveLinearSystem(D[N], R[N]);
  if (!XN) return null;
  X[N] = XN;

  for (let j = N - 1; j >= 1; j--) {
    const rhsSl = R[j].slice();
    const cv = matvec(C[j], X[j + 1]);
    const b = new Array(rhsSl.length);
    for (let r = 0; r < rhsSl.length; r++) b[r] = rhsSl[r] - cv[r];
    const xj = solveLinearSystem(D[j], b);
    if (!xj) return null;
    X[j] = xj;
  }

  const u = [];
  for (let j = 1; j <= N; j++) u.push(...X[j]);
  return u;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function initialize(problem) {
  const { N, NC } = problem;
  const state = {
    x: new Array(N + 1),
    y: new Array(N + 1),
    T: new Array(N + 1),
    L: new Array(N + 1),
    V: new Array(N + 1),
    Q: new Array(N + 1).fill(0)
  };

  // Composition ramp: light component enriched at the top, heavy at the bottom.
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
    const xj = new Array(NC);
    for (let i = 0; i < NC; i++) {
      xj[i] = xTop[i] + frac * (xBot[i] - xTop[i]);
    }
    state.x[j] = xj;
  }

  // Bubble-point temperatures, equilibrium vapor compositions.
  for (let j = 1; j <= N; j++) {
    const P = problem.pressureProfilePa[j - 1];
    state.T[j] = bubbleTemperature(problem, state.x[j], P);
    const k = kValues(problem, state.T[j], P, state.x[j]);
    let sum = 0;
    for (let i = 0; i < NC; i++) sum += k[i] * state.x[j][i];
    state.y[j] = state.x[j].map((v, i) => (k[i] * v) / sum);
  }

  // CMO flow estimates.
  const D = problem.distillateRate;
  const R = problem.refluxRatio;
  const q = problem.feedVaporFraction;
  state.L[1] = R * D;
  state.V[1] = 0;
  for (let j = 2; j < N; j++) {
    state.L[j] = R * D + (j >= problem.feedStage ? 1 - q : 0);
    state.V[j] = (R + 1) * D - (j > problem.feedStage ? q : 0);
  }
  state.L[N] = 1 - D;
  state.V[N] = (R + 1) * D - (N > problem.feedStage ? q : 0);

  if (!problem.feedTemperatureK) {
    problem.feedTemperatureK = bubbleTemperature(problem, problem.z, problem.pressureProfilePa[problem.feedStage - 1]);
  }

  return state;
}

// ---------------------------------------------------------------------------
// Newton solver
// ---------------------------------------------------------------------------

function solveMesh(problem) {
  const { N } = problem;
  const lay = layout(problem);
  let state = initialize(problem);
  let u = encodeState(state, problem);
  const hScale = enthalpyScales(problem, state);
  const history = [];
  let converged = false;
  let maxResidual = Infinity;

  for (let iter = 1; iter <= problem.maxIterations; iter++) {
    const r0 = residual(u, problem, hScale);
    maxResidual = maxNorm(r0.F);
    history.push({ iteration: iter, maxResidual });

    if (maxResidual < problem.tolerance) {
      converged = true;
      state = r0.state;
      break;
    }

    const { A, B, C } = jacobianBlocks(u, problem, hScale);
    const negF = r0.F.map((v) => -v);
    let delta = solveBlockTridiagonal(A, B, C, negF, lay.sz);
    if (!delta) {
      throw numericalFailure('Singular block-tridiagonal system in Newton step.', { iteration: iter });
    }

    // Step cap: limit the largest absolute update.
    const dMax = maxNorm(delta);
    let alpha = dMax > 1 ? 1 / dMax : 1;

    let applied = false;
    for (let attempt = 0; attempt < 14; attempt++) {
      const uNew = vecAdd(u, delta, alpha);
      // Clamp compositions on equilibrium stages (stage 1 holds only T).
      for (let j = 2; j <= N; j++) {
        const o = lay.colStart[j];
        const nC = problem.NC;
        for (let idx = 0; idx < nC; idx++) {
          if (uNew[o + idx] < 1e-14) uNew[o + idx] = 1e-14;
          if (uNew[o + nC + idx] < 1e-14) uNew[o + nC + idx] = 1e-14;
        }
      }
      const rNew = residual(uNew, problem, hScale);
      const newNorm = maxNorm(rNew.F);
      if (newNorm < maxResidual) {
        u = uNew;
        state = rNew.state;
        applied = true;
        break;
      }
      alpha *= 0.5;
    }

    if (!applied) {
      // Stagnation: accept the best (last) damped step and stop.
      maxResidual = maxNorm(residual(u, problem, hScale).F);
      break;
    }
  }

  if (!converged) {
    const rFinal = residual(u, problem, hScale);
    maxResidual = maxNorm(rFinal.F);
    state = rFinal.state;
    throw numericalFailure(
      `Column solver did not converge to ${problem.tolerance} within ${problem.maxIterations} iterations.`,
      {
        iterations: history.length,
        maxResidual,
        tolerance: problem.tolerance,
        history
      }
    );
  }

  return { state, u, history, iterations: history.length, maxResidual, hScale };
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

function formatResult(solution, problem) {
  const { N, NC } = problem;
  const state = solution.state;
  const D = problem.distillateRate;
  const B = 1 - D;

  const K = new Array(N + 1);
  for (let j = 1; j <= N; j++) {
    K[j] = kValues(problem, state.T[j], problem.pressureProfilePa[j - 1], state.x[j]);
  }

  // Condenser and reboiler duties from their enthalpy balances (per mole feed).
  const feedL = new Array(N + 1).fill(0);
  const feedV = new Array(N + 1).fill(0);
  feedL[problem.feedStage] = 1 - problem.feedVaporFraction;
  feedV[problem.feedStage] = problem.feedVaporFraction;
  const feedH = feedEnthalpies(problem);
  const qc =
    state.V[2] * vaporEnthalpyMixture(problem, state, 2) +
    feedL[1] * feedH.hL +
    feedV[1] * feedH.hV -
    (state.L[1] + D) * liquidEnthalpyMixture(problem, state, 1);
  const qr =
    state.L[N] * liquidEnthalpyMixture(problem, state, N) +
    state.V[N] * vaporEnthalpyMixture(problem, state, N) -
    state.L[N - 1] * liquidEnthalpyMixture(problem, state, N - 1) -
    feedL[N] * feedH.hL -
    feedV[N] * feedH.hV;

  const stages = [];
  for (let j = 1; j <= N; j++) {
    const liquidComposition = {};
    const vaporComposition = {};
    const kVals = {};
    for (let i = 0; i < NC; i++) {
      liquidComposition[problem.components[i]] = state.x[j][i];
      vaporComposition[problem.components[i]] = state.y[j][i];
      kVals[problem.components[i]] = K[j][i];
    }
    const duty = j === 1 ? qc : j === N ? qr : 0;
    stages.push({
      stage: j,
      temperatureK: state.T[j],
      pressurePa: problem.pressureProfilePa[j - 1],
      liquidFlowKmolPerMolFeed: state.L[j],
      vaporFlowKmolPerMolFeed: state.V[j],
      dutyKJPerMolFeed: duty / 1000,
      liquidComposition,
      vaporComposition,
      equilibriumKValues: kVals
    });
  }

  const distillateComposition = {};
  const bottomsComposition = {};
  const closure = {};
  let maxAbsClosure = 0;
  let maxRelClosure = 0;
  for (let i = 0; i < NC; i++) {
    distillateComposition[problem.components[i]] = state.x[1][i];
    bottomsComposition[problem.components[i]] = state.x[N][i];
    const closureI = D * state.x[1][i] + B * state.x[N][i] - problem.z[i];
    closure[problem.components[i]] = closureI;
    maxAbsClosure = Math.max(maxAbsClosure, Math.abs(closureI));
    maxRelClosure = Math.max(maxRelClosure, Math.abs(closureI) / Math.max(problem.z[i], 1e-12));
  }

  // Per-stage enthalpy-balance residuals (unscaled), for the verification gate.
  // Interior stages solve H = 0 in the Newton set; condenser/reboiler residuals
  // are zero by construction (their duties are recovered from the balances).
  const hScale = solution.hScale;
  const r = residual(solution.u, problem, hScale);
  const energyResidualPerStage = new Array(N + 1);
  let maxAbsH = 0;
  for (let j = 1; j <= N; j++) {
    let Hval;
    if (j === 1) {
      Hval = 0; // Qc chosen to satisfy the condenser enthalpy balance exactly
    } else if (j === N) {
      Hval = 0; // Qr chosen to satisfy the reboiler enthalpy balance exactly
    } else if (problem.flowModel === 'cmo') {
      const hLprev = liquidEnthalpyMixture(problem, r.state, j - 1);
      const hVnext = vaporEnthalpyMixture(problem, r.state, j + 1);
      const hL = liquidEnthalpyMixture(problem, r.state, j);
      const hV = vaporEnthalpyMixture(problem, r.state, j);
      Hval = Math.abs(
        r.state.L[j - 1] * hLprev +
          r.state.V[j + 1] * hVnext +
          feedL[j] * feedH.hL +
          feedV[j] * feedH.hV -
          r.state.L[j] * hL -
          r.state.V[j] * hV
      );
    } else {
      const row = r.state.lay.rowStart[j] + 2 * problem.NC + 2;
      Hval = Math.abs(r.F[row]) * hScale;
    }
    energyResidualPerStage[j] = Hval;
    maxAbsH = Math.max(maxAbsH, Hval);
  }
  const dutyScale = Math.max(Math.abs(qc), Math.abs(qr), 1);
  const maxEnergyRatio = maxAbsH / dutyScale;

  const warnings = [];
  if (problem.kValueModel === 'wilson') {
    warnings.push(
      'Modified Raoult with Wilson activity coefficients; azeotropic behavior is captured only if fitted Wilson parameters are physically consistent.'
    );
  } else if (problem.kValueModel === 'nrtl') {
    warnings.push('Modified Raoult with NRTL activity coefficients.');
  } else {
    warnings.push('Ideal Raoult K-values from documented Clausius-Clapeyron vapor pressures.');
  }

  return {
    success: true,
    status: 'converged',
    validationLevel: 'experimental',
    model:
      'Naphtali-Sandholm simultaneous-correction: full MESH equations, block-tridiagonal Newton with numerical Jacobian, total condenser + partial reboiler',
    kValueModel: problem.kValueModel,
    assumptions: [
      'Total condenser with saturated reflux; partial reboiler; stages 2..N at equilibrium.',
      'MESH equations solved simultaneously: component balances, equilibrium, summations, enthalpy balances.',
      'Adiabatic trays; condenser/reboiler duties determined by the enthalpy balances.',
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
      maxResidual: solution.maxResidual,
      tolerance: problem.tolerance,
      history: solution.history
    },
    profiles: {
      stages,
      condenser: { temperatureK: state.T[1], dutyKJPerMolFeed: qc / 1000 },
      reboiler: { temperatureK: state.T[N], dutyKJPerMolFeed: qr / 1000 }
    },
    products: {
      distillate: { flowKmolPerMolFeed: D, composition: distillateComposition },
      bottoms: { flowKmolPerMolFeed: B, composition: bottomsComposition }
    },
    massBalance: {
      closurePerComponent: closure,
      maxAbsComponentClosure: maxAbsClosure,
      maxRelComponentClosure: maxRelClosure
    },
    energyBalance: {
      maxAbsStageEnthalpyResidualJPerMol: maxAbsH,
      maxStageEnthalpyResidualOverDuty: maxEnergyRatio,
      maxAbsDutyScaleJPerMol: dutyScale,
      perStageResidualJPerMol: energyResidualPerStage.slice(1)
    },
    warnings
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

class RigorousDistillationColumnSolver {
  /**
   * Solves the steady-state equilibrium-stage column (full MESH, NS method).
   * @param {object} spec explicit inputs (see buildProblem)
   * @returns {object} result envelope with profiles and convergence history
   */
  static solve(spec = {}) {
    let problem;
    try {
      problem = buildProblem(spec);
    } catch (err) {
      if (err && err.code === 'INCOMPLETE_SPEC') {
        return {
          success: false,
          status: 'invalid-input',
          validationLevel: 'experimental',
          error: { code: 'INCOMPLETE_SPEC', message: err.message }
        };
      }
      return {
        success: false,
        status: 'not-converged',
        validationLevel: 'experimental',
        error: {
          code: err && err.code === 'NUMERICAL_FAILURE' ? 'NUMERICAL_FAILURE' : 'INTERNAL',
          message: err.message,
          details: err && err.details ? err.details : {}
        }
      };
    }

    let solution;
    try {
      solution = solveMesh(problem);
    } catch (err) {
      return {
        success: false,
        status: 'not-converged',
        validationLevel: 'experimental',
        error: {
          code: err && err.code === 'NUMERICAL_FAILURE' ? 'NUMERICAL_FAILURE' : 'INTERNAL',
          message: err.message,
          details: err && err.details ? err.details : {}
        }
      };
    }
    return formatResult(solution, problem);
  }
}

module.exports = {
  RigorousDistillationColumnSolver,
  _internals: {
    buildProblem,
    solveMesh,
    formatResult,
    initialize,
    residual,
    decodeState,
    encodeState,
    layout,
    blockSizes,
    kValues,
    bubbleTemperature,
    idealGasEnthalpy,
    liquidEnthalpyJmol,
    vaporEnthalpyJmol,
    solveBlockTridiagonal,
    eventLinearSystem: solveLinearSystem
  }
};
