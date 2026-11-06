/**
 * Verification gate for the coupled viscoplasticity + Johnson-Cook damage
 * module (Battalion 5, Agent 44).
 *
 * Targets: src/core/cae/viscoplasticity_damage.js
 *
 * Checks:
 *   1. JC flow stress at reference conditions (eps_dot = eps0_dot, T = T_room)
 *      reduces to sigma = A + B*eps^n; verified to 1e-9 for Inconel 718
 *      (A=1013 MPa, B=984 MPa, n=0.36, C=0.016, m=1.7, T_melt=1570 K,
 *      T_room=293 K).
 *   2. Strain-rate sensitivity: sigma(1000/s)/sigma_ref = 1 + C*ln(1000)
 *      ~= 1.1105, verified to 1e-6.
 *   3. Thermal softening at T=1000 K: T* = (1000-293)/(1570-293) = 0.55364,
 *      factor 1 - T*^1.7 ~= 0.6339, verified to 1e-9.
 *   4. Adiabatic heating: dT = beta*sigma*d_eps_p/(rho*cp) exactly from the
 *      module's energy bookkeeping.
 *   5. Damage accumulation: isothermal monotonic loading; D = eps_p/eps_f
 *      exactly; element-deleted flag flips when D >= 1 at the JC fracture
 *      strain computed analytically in-test.
 *   6. Creep: constant-stress hold, Arrhenius-Norton law
 *      eps_cr = A*sigma^n*t*exp(-Q/(RT)) linear in t; slope verified to 1e-9.
 *   7. Coupled high-strain-rate tension: adiabatic feedback produces a
 *      nonmonotonic stress-strain curve (peak exists, then thermal softening).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ViscoplasticityDamageModel,
  INCONEL_718_LIKE,
  GAS_CONSTANT
} = require('../src/core/cae/viscoplasticity_damage');

const IC718 = (overrides) => ({ ...INCONEL_718_LIKE, ...(overrides || {}) });

test('JC flow stress: reference conditions reduce to sigma = A + B*eps^n', () => {
  const mat = IC718();
  const model = new ViscoplasticityDamageModel(mat);
  for (const ep of [0.01, 0.1, 0.5]) {
    const expected = mat.A + mat.B * Math.pow(ep, mat.n);
    const got = model.flowStress(ep, mat.eps0_dot, mat.T_room);
    assert.ok(Math.abs(got - expected) <= 1e-9, `eps=${ep}: got ${got}, expected ${expected}`);
  }
});

test('JC flow stress: strain-rate sensitivity ratio = 1 + C*ln(1000)', () => {
  const mat = IC718();
  const model = new ViscoplasticityDamageModel(mat);
  const ep = 0.1;
  const sRef = model.flowStress(ep, mat.eps0_dot, mat.T_room);
  const sFast = model.flowStress(ep, 1000, mat.T_room);
  const ratio = sFast / sRef;
  const expectedRatio = 1 + mat.C * Math.log(1000);
  assert.ok(Math.abs(ratio - expectedRatio) <= 1e-6, `ratio ${ratio}, expected ${expectedRatio}`);
});

test('JC flow stress: thermal softening factor 1 - T*^m at T=1000 K', () => {
  const mat = IC718();
  const model = new ViscoplasticityDamageModel(mat);
  const T = 1000;
  const tStar = (T - mat.T_room) / (mat.T_melt - mat.T_room);
  const factor = 1 - Math.pow(tStar, mat.m);
  const ep = 0.2;
  const sHot = model.flowStress(ep, mat.eps0_dot, T);
  const sCold = model.flowStress(ep, mat.eps0_dot, mat.T_room);
  assert.ok(Math.abs(sHot / sCold - factor) <= 1e-9, `ratio ${sHot / sCold}, factor ${factor}`);
});

test('Adiabatic heating: dT = beta*sigma*d_eps_p/(rho*cp) exactly', () => {
  const mat = IC718();
  const model = new ViscoplasticityDamageModel(mat);
  let cumExpected = 0;
  for (let i = 0; i < 20; i++) {
    const res = model.step(0.01, 1e-4, { strainRate: 1000 });
    const dTExpected = (mat.beta * res.stressMPa * 1e6 * res.plasticIncrement) / (mat.rho * mat.cp);
    assert.ok(
      Math.abs(res.temperatureIncrement - dTExpected) <= 1e-12 * Math.max(1, Math.abs(dTExpected)),
      `step ${i}: dT ${res.temperatureIncrement}, expected ${dTExpected}`
    );
    cumExpected += dTExpected;
  }
  assert.ok(Math.abs(model.temperature - (mat.T_room + cumExpected)) <= 1e-9 * Math.max(1, cumExpected));
});

test('Damage: D = eps_p/eps_f exactly; element deleted at D >= 1', () => {
  const mat = IC718({ beta: 0, D4: 0, D5: 0, D1: 0.05, D2: 0.2 });
  const model = new ViscoplasticityDamageModel(mat);
  const eta = 1 / 3;
  const epsF = model.fractureStrain(eta, mat.eps0_dot, mat.T_room);
  const analyticEpsF = mat.D1 + mat.D2 * Math.exp(mat.D3 * eta);
  assert.ok(Math.abs(epsF - analyticEpsF) <= 1e-12, `epsF ${epsF}, analytic ${analyticEpsF}`);
  const dEp = 0.001;
  let deletedStep = -1;
  for (let i = 0; i < 500; i++) {
    const res = model.step(dEp, 1e-3, { strainRate: mat.eps0_dot, triaxiality: eta });
    const analyticD = res.plasticStrain / epsF;
    assert.ok(
      Math.abs(res.damage - analyticD) <= 1e-12 * Math.max(1, analyticD),
      `step ${i}: D ${res.damage}, analytic ${analyticD}`
    );
    const analyticDeleted = res.plasticStrain >= epsF;
    if (analyticDeleted && deletedStep < 0) {
      deletedStep = i;
    }
    assert.strictEqual(res.deleted, analyticDeleted, `step ${i}: deleted ${res.deleted}, analytic ${analyticDeleted}`);
    if (deletedStep >= 0 && i > deletedStep) {
      break;
    }
  }
  assert.ok(deletedStep >= 0, 'element never deleted');
  assert.ok(model.deleted === true);
  assert.ok(
    model.plasticStrain >= epsF && model.plasticStrain <= epsF + 1.5 * dEp,
    `plastic strain ${model.plasticStrain} vs epsF ${epsF}`
  );
});

test('Creep: epsilon_cr = A*sigma^n*t*exp(-Q/(RT)) linear in t', () => {
  const mat = IC718({ A_creep: 1e-12, n_creep: 5, Q_act: 250000, R: GAS_CONSTANT });
  const model = new ViscoplasticityDamageModel(mat);
  const sigma0 = 100;
  const Tcreep = 1200;
  assert.ok(sigma0 < model.flowStress(0, mat.eps0_dot, Tcreep), 'hold must be elastic at elevated temperature');
  model.temperature = Tcreep;
  model.step(sigma0 / mat.E, 1e-3, { strainRate: mat.eps0_dot });
  const dt = 10;
  const N = 1000;
  const tEnd = N * dt;
  const rate = model.creepRate(sigma0, Tcreep);
  assert.ok(rate > 0);
  let creepSum = 0;
  for (let i = 0; i < N; i++) {
    const dCr = model.predictCreepIncrement(dt);
    creepSum += dCr;
    const res = model.step(dCr, dt, { strainRate: mat.eps0_dot });
    assert.ok(Math.abs(res.stressMPa - sigma0) <= 1e-9 * sigma0, `stress ${res.stressMPa}`);
  }
  const expected = rate * tEnd;
  const relErr = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
  assert.ok(relErr(creepSum, expected) <= 1e-9, `creepSum ${creepSum} vs expected ${expected}`);
  assert.ok(relErr(model.creepStrain, expected) <= 1e-9, `creepStrain ${model.creepStrain} vs expected ${expected}`);
  const slope = model.creepStrain / tEnd;
  assert.ok(relErr(slope, rate) <= 1e-9, `slope ${slope}, rate ${rate}`);
});

test('Coupled: high-strain-rate tension bar shows a nonmonotonic stress-strain peak', () => {
  const mat = IC718();
  const model = new ViscoplasticityDamageModel(mat);
  const epsDot = 1000;
  const dEp = 1e-4;
  const dt = dEp / epsDot;
  const N = 12000;
  const stresses = [];
  for (let i = 0; i < N; i++) {
    const res = model.step(dEp, dt, { strainRate: epsDot });
    assert.ok(Number.isFinite(res.stressMPa));
    assert.ok(!Number.isNaN(res.stressMPa));
    stresses.push(res.stressMPa);
  }
  let peakIdx = 0;
  for (let i = 1; i < N; i++) {
    if (stresses[i] > stresses[peakIdx]) peakIdx = i;
  }
  assert.ok(peakIdx > 0 && peakIdx < N - 1, `peak at edge: ${peakIdx}`);
  assert.ok(stresses[peakIdx] > stresses[peakIdx - 1] + 1e-9);
  assert.ok(stresses[peakIdx] > stresses[peakIdx + 1] + 1e-9);
  assert.ok(stresses[N - 1] < stresses[peakIdx], 'no thermal softening after the peak');
});
