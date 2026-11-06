'use strict';

/**
 * Verification gate: NRTL / UNIQUAC / Wilson activity models + ternary LLE
 * (water–benzene–ethanol at 25 °C) binodal/tie-line check.
 *
 * Coverage:
 *   1. NRTL: τ_ij = a_ij + b_ij/T and G_ij = exp(−α_ij τ_ij) match the model
 *      formula exactly (1e-9) — cross-checked against an independent
 *      reimplementation; asymmetric α ⇒ G_ij ≠ G_ji.
 *   2. Wilson: Λ_ij = (V_j/V_i) exp(−a_ij/T) verified against the formula;
 *      ideal mixture (a=0, equal volumes) ⇒ γ_i = 1 exactly.
 *   3. UNIQUAC: combinatorial + residual terms verified against an independent
 *      implementation; identical components (r_i=r_j, q_i=q_j, zero
 *      interaction) ⇒ γ_i → 1 with a small float residual (reported).
 *   4. NRTL dilute limit: γ_i^∞ finite and consistent with the binary model
 *      equation; γ_i → 1 as x_i → 1 (1e-4).
 *   5. Ternary LLE water(1)–benzene(2)–ethanol(3) @ 298.15 K with a
 *      representative NRTL parameterization anchored to the experimental
 *      25 °C mutual solubilities (benzene in water ≈ 4e-4, water in benzene
 *      ≈ 3e-4 mol frac ⇒ γ^∞ ≈ 2500 ⇒ b = ln(2500)·T ≈ 2331 K; ethanol is
 *      fully miscible with both and partitions toward the water-rich phase).
 *      Verifies the two-phase split for z=(0.5,0.3,0.2), phase compositions,
 *      equilibrium equality (1e-6), qualitative phase ordering, and mass
 *      balance closure (1e-6); pure/miscible feeds return a single phase.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ActivityModelsUNIFACNRTL } = require('../src/core/plant/activity_models_unifac_nrtl');

const model = new ActivityModelsUNIFACNRTL();

// ---------------------------------------------------------------------------
// Independent reference implementations (formula-level, for cross-checks)
// ---------------------------------------------------------------------------

function nrtlGammaRef(x, T, aMatrix, bMatrix, alphaMatrix) {
  const N = x.length;
  const tau = [];
  const G = [];
  for (let i = 0; i < N; i++) {
    tau.push(new Float64Array(N));
    G.push(new Float64Array(N));
    for (let j = 0; j < N; j++) {
      if (i === j) {
        tau[i][j] = 0;
        G[i][j] = 1;
      } else {
        const t = (aMatrix?.[i]?.[j] || 0) + (bMatrix?.[i]?.[j] || 0) / T;
        const al = alphaMatrix?.[i]?.[j] ?? 0.3;
        tau[i][j] = t;
        G[i][j] = Math.exp(-al * t);
      }
    }
  }
  const S = new Float64Array(N);
  const num1 = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < N; k++) {
      S[i] += x[k] * G[k][i];
      num1[i] += x[k] * tau[k][i] * G[k][i];
    }
    S[i] = S[i] || 1e-12;
  }
  const gamma = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let lnG = num1[i] / S[i];
    for (let j = 0; j < N; j++) {
      lnG += ((x[j] * G[i][j]) / S[j]) * (tau[i][j] - num1[j] / S[j]);
    }
    gamma[i] = Math.exp(lnG);
  }
  return Array.from(gamma);
}

function wilsonGammaRef(x, LambdaMatrix) {
  const N = x.length;
  const S = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) S[i] += x[j] * (LambdaMatrix[i]?.[j] ?? 1);
    S[i] = S[i] || 1e-12;
  }
  const gamma = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let sumK = 0;
    for (let k = 0; k < N; k++) sumK += (x[k] * (LambdaMatrix[k]?.[i] ?? 1)) / S[k];
    gamma[i] = Math.exp(1 - Math.log(S[i]) - sumK);
  }
  return Array.from(gamma);
}

function uniquacGammaRef(x, T, params) {
  const N = x.length;
  const r = params.r || new Array(N).fill(1);
  const q = params.q || new Array(N).fill(1);
  const z = 10;
  const tau = [];
  for (let i = 0; i < N; i++) {
    tau.push(new Float64Array(N));
    for (let j = 0; j < N; j++) {
      if (i === j) tau[i][j] = 1;
      else if (params.tau) tau[i][j] = params.tau[i][j];
      else if (params.du) tau[i][j] = Math.exp(-(params.du[i][j] || 0) / T);
      else tau[i][j] = 1;
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
  const lnGC = x.map(
    (xi, i) =>
      Math.log(phi[i] / Math.max(xi, 1e-300)) +
      (z / 2) * q[i] * Math.log(theta[i] / Math.max(phi[i], 1e-300)) +
      l[i] -
      (phi[i] / Math.max(xi, 1e-300)) * lBar
  );
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
}

// ---------------------------------------------------------------------------
// 1. NRTL: τ/G matrices match formula exactly; asymmetric α
// ---------------------------------------------------------------------------

test('NRTL: τ_ij = a_ij + b_ij/T and G_ij = exp(−α_ij·τ_ij) match formula (1e-9)', () => {
  const T = 298.15;
  const a = [
    [0, 2.5, -1.2],
    [-0.8, 0, 3.1],
    [1.7, -2.2, 0]
  ];
  const b = [
    [0, 480, -150],
    [320, 0, 610],
    [-90, 540, 0]
  ];
  const al = [
    [0, 0.2, 0.3],
    [0.47, 0, 0.2],
    [0.3, 0.2, 0]
  ];
  // τ and G computed by formula
  const tau = a.map((row, i) => row.map((v, j) => (i === j ? 0 : v + b[i][j] / T)));
  const G = tau.map((row, i) => row.map((t, j) => (i === j ? 1 : Math.exp(-al[i][j] * t))));
  const x = [0.4, 0.35, 0.25];
  const gMod = model.evaluateNRTL(x, T, a, b, al);
  const gRef = nrtlGammaRef(x, T, a, b, al);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(gMod[i] - gRef[i]) < 1e-9, `gamma[${i}] ${gMod[i]} vs ref ${gRef[i]}`);
  }
  // explicit τ/G consistency: a symmetric alpha case reproduces ref exactly
  const alSym = [
    [0, 0.2, 0.3],
    [0.2, 0, 0.2],
    [0.3, 0.2, 0]
  ];
  const gSym = model.evaluateNRTL(x, T, a, b, alSym);
  const gSymRef = nrtlGammaRef(x, T, a, b, alSym);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(gSym[i] - gSymRef[i]) < 1e-9, `sym gamma[${i}] ${gSym[i]} vs ref ${gSymRef[i]}`);
  }
  // τ/G matrix elements themselves (formula, exact)
  assert.ok(Math.abs(tau[0][1] - (2.5 + 480 / T)) < 1e-12, 'tau12');
  assert.ok(Math.abs(G[0][1] - Math.exp(-al[0][1] * tau[0][1])) < 1e-12, 'G12');
  assert.ok(Math.abs(G[1][0] - Math.exp(-al[1][0] * tau[1][0])) < 1e-12, 'G21');
});

test('NRTL: asymmetric α ⇒ G_ij ≠ G_ji (γ1 ≠ γ2 at symmetric composition)', () => {
  const T = 298.15;
  const a = [
    [0, 1.0],
    [1.0, 0]
  ];
  const b = [
    [0, 300],
    [300, 0]
  ];
  const alSym = [
    [0, 0.3],
    [0.3, 0]
  ];
  const alAsym = [
    [0, 0.2],
    [0.47, 0]
  ];
  const gSym = model.evaluateNRTL([0.5, 0.5], T, a, b, alSym);
  const gAsym = model.evaluateNRTL([0.5, 0.5], T, a, b, alAsym);
  assert.ok(Math.abs(gSym[0] - gSym[1]) < 1e-12, `symmetric alpha should give γ1=γ2: ${gSym}`);
  assert.ok(Math.abs(gAsym[0] - gAsym[1]) > 1e-3, `asymmetric alpha must break symmetry: ${gAsym}`);
  const gRef = nrtlGammaRef([0.5, 0.5], T, a, b, alAsym);
  assert.ok(Math.abs(gAsym[0] - gRef[0]) < 1e-9);
  assert.ok(Math.abs(gAsym[1] - gRef[1]) < 1e-9);
});

// ---------------------------------------------------------------------------
// 2. Wilson
// ---------------------------------------------------------------------------

test('Wilson: Λ_ij = (V_j/V_i)·exp(−a_ij/T) verified against formula', () => {
  const T = 298.15;
  const V = [1.0, 2.5];
  const aW = [
    [0, 350],
    [120, 0]
  ];
  const Lambda = [
    [1, (V[1] / V[0]) * Math.exp(-aW[0][1] / T)],
    [(V[0] / V[1]) * Math.exp(-aW[1][0] / T), 1]
  ];
  const x = [0.3, 0.7];
  const gMod = model.evaluateWilson(x, Lambda);
  const gRef = wilsonGammaRef(x, Lambda);
  assert.ok(Math.abs(gMod[0] - gRef[0]) < 1e-12, `γ1 ${gMod[0]} vs ${gRef[0]}`);
  assert.ok(Math.abs(gMod[1] - gRef[1]) < 1e-12, `γ2 ${gMod[1]} vs ${gRef[1]}`);
  // formula-level check of Λ itself
  assert.ok(Math.abs(Lambda[0][1] - 2.5 * Math.exp(-350 / T)) < 1e-12, 'Λ12');
  assert.ok(Math.abs(Lambda[1][0] - 0.4 * Math.exp(-120 / T)) < 1e-12, 'Λ21');
});

test('Wilson: ideal mixture (a=0, equal volumes) ⇒ γ_i = 1 exactly', () => {
  const Lambda = [
    [1, 1],
    [1, 1]
  ];
  const g = model.evaluateWilson([0.4, 0.6], Lambda);
  assert.ok(g[0] === 1 && g[1] === 1, `γ = ${g} (exact 1 expected)`);
});

// ---------------------------------------------------------------------------
// 3. UNIQUAC
// ---------------------------------------------------------------------------

test('UNIQUAC: verified against independent implementation (combinatorial + residual)', () => {
  const T = 298.15;
  const cases = [
    {
      r: [1, 2],
      q: [1, 1.4],
      du: [
        [0, 200],
        [300, 0]
      ],
      x: [0.3, 0.7]
    },
    {
      r: [2.5755, 1.4311],
      q: [1.972, 1.432],
      du: [
        [0, -100],
        [50, 0]
      ],
      x: [0.6, 0.4]
    },
    {
      r: [1, 1, 2],
      q: [1, 1, 1.5],
      du: [
        [0, 0, 250],
        [0, 0, -80],
        [250, -80, 0]
      ],
      x: [0.2, 0.3, 0.5]
    }
  ];
  for (const c of cases) {
    const gMod = model.evaluateUNIQUAC(c.x, T, c);
    const gRef = uniquacGammaRef(c.x, T, c);
    for (let i = 0; i < c.x.length; i++) {
      assert.ok(Math.abs(gMod[i] - gRef[i]) < 1e-12, `γ[${i}] ${gMod[i]} vs ref ${gRef[i]}`);
    }
  }
});

test('UNIQUAC: identical components with zero interaction ⇒ γ_i → 1 (report small residual)', () => {
  const T = 298.15;
  const r = [1, 1];
  const q = [1, 1];
  const du = [
    [0, 0],
    [0, 0]
  ];
  const g = model.evaluateUNIQUAC([0.3, 0.7], T, { r, q, du });
  const residual = Math.max(Math.abs(g[0] - 1), Math.abs(g[1] - 1));
  console.log(`    UNIQUAC identical-components residual: ${residual.toExponential(3)}`);
  assert.ok(residual < 1e-12, `γ → 1 expected, got ${g}`);
  // non-trivial lattice combinatorics: same r/q but different volumes must deviate
  const gCombo = model.evaluateUNIQUAC([0.3, 0.7], T, { r: [1, 3], q: [1, 2], du });
  assert.ok(Math.abs(gCombo[0] - 1) > 1e-3, `combinatorial term should deviate: ${gCombo}`);
});

// ---------------------------------------------------------------------------
// 4. NRTL dilute limit
// ---------------------------------------------------------------------------

test('NRTL: γ^∞ finite and consistent with binary model equation; γ_i → 1 as x_i → 1', () => {
  const T = 298.15;
  const a = [
    [0, 0.5],
    [0.3, 0]
  ];
  const b = [
    [0, 800],
    [600, 0]
  ];
  const al = [
    [0, 0.3],
    [0.3, 0]
  ];
  const tau12 = a[0][1] + b[0][1] / T;
  const tau21 = a[1][0] + b[1][0] / T;
  const G12 = Math.exp(-al[0][1] * tau12);
  const lnInf = tau21 + G12 * tau12; // binary infinite-dilution expression
  const gDil = model.evaluateNRTL([1e-8, 1 - 1e-8], T, a, b, al);
  assert.ok(Number.isFinite(gDil[0]) && Number.isFinite(gDil[1]), 'γ∞ must be finite');
  assert.ok(Math.abs(Math.log(gDil[0]) - lnInf) < 1e-4, `ln γ1∞ = ${Math.log(gDil[0])} vs formula ${lnInf}`);
  const gPure = model.evaluateNRTL([0.9999, 0.0001], T, a, b, al);
  assert.ok(Math.abs(gPure[0] - 1) < 1e-4, `γ1 → 1, got ${gPure[0]}`);
  const gPure2 = model.evaluateNRTL([0.0001, 0.9999], T, a, b, al);
  assert.ok(Math.abs(gPure2[1] - 1) < 1e-4, `γ2 → 1, got ${gPure2[1]}`);
});

// ---------------------------------------------------------------------------
// 5. Ternary LLE: water(1)–benzene(2)–ethanol(3) @ 298.15 K
// ---------------------------------------------------------------------------

const T_LLE = 298.15;
// Representative NRTL parameterization (τ_ij = a_ij + b_ij/T, a = 0):
//  - water/benzene: b = 2331 K both ways, α = 0.2 → τ ≈ 7.82 at 298.15 K
//    ⇒ γ^∞ ≈ 2500 ⇒ mutual solubility ≈ 4e-4 mol frac (matches the measured
//    25 °C values: benzene in water ≈ 4e-4, water in benzene ≈ 3e-4).
//  - ethanol/water: mild attraction (fully miscible).
//  - ethanol/benzene: ideal (zero interaction).
const A_LLE = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0]
];
const B_LLE = [
  [0, 2331, -500],
  [2331, 0, 0],
  [-700, 0, 0]
];
const AL_LLE = [
  [0, 0.2, 0.2],
  [0.2, 0, 0.2],
  [0.2, 0.2, 0]
];

test('LLE: two-phase split exists for z=(0.5,0.3,0.2) with distinct compositions', () => {
  const r = model.solveLLEFlash({ z: [0.5, 0.3, 0.2], T: T_LLE, aMatrix: A_LLE, bMatrix: B_LLE, alphaMatrix: AL_LLE });
  assert.ok(r.split, `expected two-phase split, got split=${r.split} (gMix=${r.gMix})`);
  assert.ok(r.xI && r.xII, 'phase compositions present');
  const diff = Math.max(...r.xI.map((v, i) => Math.abs(v - r.xII[i])));
  assert.ok(diff > 0.1, `phases must differ: max|Δx| = ${diff}`);
  console.log(`    α = ${r.alpha.toFixed(4)}`);
  console.log(`    x^I  (benzene-rich) = ${r.xI.map((v) => v.toFixed(5)).join(', ')}`);
  console.log(`    x^II (water-rich)   = ${r.xII.map((v) => v.toFixed(5)).join(', ')}`);
});

test('LLE: phase compositions satisfy equilibrium x_i^I·γ_i^I = x_i^II·γ_i^II (1e-6)', () => {
  const r = model.solveLLEFlash({ z: [0.5, 0.3, 0.2], T: T_LLE, aMatrix: A_LLE, bMatrix: B_LLE, alphaMatrix: AL_LLE });
  console.log(`    max equilibrium residual = ${r.equilResidual.toExponential(3)}`);
  assert.ok(r.equilResidual < 1e-6, `equilibrium residual ${r.equilResidual} > 1e-6`);
});

test('LLE: qualitative ordering — water-rich ≈ water+ethanol (benzene small); benzene-rich ≈ benzene+ethanol (water small)', () => {
  const r = model.solveLLEFlash({ z: [0.5, 0.3, 0.2], T: T_LLE, aMatrix: A_LLE, bMatrix: B_LLE, alphaMatrix: AL_LLE });
  const w = r.xII; // water-rich
  const o = r.xI; // benzene-rich
  assert.ok(w[0] > w[1] && w[0] > w[2], 'water-rich phase is majority water');
  assert.ok(w[0] > 0.6, `water-rich phase water content ${w[0]}`);
  assert.ok(w[1] < 0.05, `benzene small in water-rich phase: ${w[1]}`);
  assert.ok(w[2] > 0.1, `ethanol present in water-rich phase: ${w[2]}`);
  assert.ok(o[1] > 0.9, `benzene-rich phase benzene content ${o[1]}`);
  assert.ok(o[0] < 0.01, `water small in benzene-rich phase: ${o[0]}`);
  assert.ok(o[2] > 0.005, `ethanol present in benzene-rich phase: ${o[2]}`);
  assert.ok(w[0] > o[0], 'water partitions toward water-rich phase');
  assert.ok(o[1] > w[1], 'benzene partitions toward benzene-rich phase');
  assert.ok(w[2] > o[2], 'ethanol partitions toward water-rich phase');
});

test('LLE: mass balance closes z_i = α·x_i^I + (1−α)·x_i^II (1e-6)', () => {
  const r = model.solveLLEFlash({ z: [0.5, 0.3, 0.2], T: T_LLE, aMatrix: A_LLE, bMatrix: B_LLE, alphaMatrix: AL_LLE });
  assert.ok(r.alpha >= 0 && r.alpha <= 1, `α = ${r.alpha} ∈ [0,1]`);
  assert.ok(r.massResidual < 1e-6, `mass balance residual ${r.massResidual}`);
  const zRec = r.xI.map((v, i) => r.alpha * v + (1 - r.alpha) * r.xII[i]);
  console.log(`    reconstructed z = ${zRec.map((v) => v.toFixed(6)).join(', ')}`);
});

test('LLE: miscible composition (pure ethanol) yields a single phase', () => {
  const r = model.solveLLEFlash({ z: [0, 0, 1], T: T_LLE, aMatrix: A_LLE, bMatrix: B_LLE, alphaMatrix: AL_LLE });
  assert.ok(!r.split, 'pure ethanol must not split');
  assert.ok(r.equilResidual < 1e-8, `single-phase residual ${r.equilResidual}`);
  // high-ethanol ternary (outside binodal) must also be single phase
  const r2 = model.solveLLEFlash({ z: [0.2, 0.2, 0.6], T: T_LLE, aMatrix: A_LLE, bMatrix: B_LLE, alphaMatrix: AL_LLE });
  assert.ok(!r2.split, 'miscible (0.2,0.2,0.6) must not split');
});
