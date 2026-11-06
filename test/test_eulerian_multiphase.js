'use strict';

/**
 * Verification gate for the Eulerian-Eulerian two-fluid bubble column model
 * (src/core/cae/eulerian_multiphase.js).
 *
 * Covers: exact phase continuity, Schiller-Naumann drag closure (including
 * the low-Reynolds Stokes limit), Tomiyama lift closure, holdup trend and
 * bounds, liquid recirculation direction with zero net flux, the standard
 * air-water condition (U_G = 0.1 m/s, D = 0.1 m) against the published
 * bubbly-flow holdup window, and determinism.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EulerianMultiphaseBubbleColumn,
  schillerNaumannDrag,
  tomiyamaLift
} = require('../src/core/cae/eulerian_multiphase');

const SCHILLER_NAUMANN = (re) => Math.max((24 / re) * (1 + 0.15 * Math.pow(re, 0.687)), 0.44);

test('drag closure matches Schiller-Naumann exactly', () => {
  for (const re of [0.1, 10, 1000, 2.5, 55.5, 0.5]) {
    const cd = schillerNaumannDrag(re);
    const ref = SCHILLER_NAUMANN(re);
    assert.ok(Math.abs(cd - ref) < 1e-9, `Re=${re}: CD=${cd} vs ${ref}`);
  }
  assert.equal(schillerNaumannDrag(1000), 0.44, 'high-Re branch must clamp to 0.44');
  const cdStokes = schillerNaumannDrag(1e-4);
  assert.ok(Math.abs(cdStokes - 24 / 1e-4) / (24 / 1e-4) < 5e-4, 'Re->0 limit must approach 24/Re');
  assert.ok(Math.abs(cdStokes - SCHILLER_NAUMANN(1e-4)) < 1e-9, 'formula closure must hold for Re->0');
});

test('drag closure rejects non-positive Reynolds numbers', () => {
  assert.throws(() => schillerNaumannDrag(0));
  assert.throws(() => schillerNaumannDrag(-1));
  assert.throws(() => schillerNaumannDrag(NaN));
});

test('Tomiyama lift closure is a deterministic function of Re and Eo', () => {
  const anchors = [
    [100, 1.0, 0.288, 1e-6], // Eo_d < 4: min(0.288 tanh(0.121 Re), f(Eo_d))
    [1000, 1.0, 0.288, 1e-6],
    [1000, 20.0, -0.27, 1e-12], // Eo_d > 10 (large/deformed bubbles): -0.27
    [1000, 50.0, -0.27, 1e-12]
  ];
  for (const [re, eo, exact, tol] of anchors) {
    const cl = tomiyamaLift(re, eo);
    assert.ok(Math.abs(cl - exact) < tol, `Re=${re}, Eo=${eo}: CL=${cl} vs ${exact}`);
  }
  const a = tomiyamaLift(150, 2.0);
  const b = tomiyamaLift(150, 2.0);
  assert.equal(a, b, 'Tomiyama CL must be deterministic');
  assert.ok(Number.isFinite(a) && a >= -1 && a <= 1);
  assert.throws(() => tomiyamaLift(0, 1));
  assert.throws(() => tomiyamaLift(1, 0));
});

test('phase continuity: alpha_g + alpha_l = 1 exactly at all stations', () => {
  const model = new EulerianMultiphaseBubbleColumn();
  for (const ug of [0.03, 0.1, 0.2]) {
    const out = model.solveRadialProfile(ug);
    assert.equal(out.alphaGas.length, out.alphaLiquid.length);
    for (let i = 0; i < out.alphaGas.length; i++) {
      assert.ok(
        Math.abs(out.alphaGas[i] + out.alphaLiquid[i] - 1) < 1e-12,
        `station ${i} U_G=${ug}: alpha_g+alpha_l = ${out.alphaGas[i] + out.alphaLiquid[i]}`
      );
    }
  }
});

test('holdup increases monotonically with superficial gas velocity and stays in [0,1]', () => {
  const model = new EulerianMultiphaseBubbleColumn();
  const sweep = [0.03, 0.05, 0.075, 0.1, 0.15, 0.2];
  let previous = -1;
  for (const ug of sweep) {
    const out = model.solveRadialProfile(ug);
    assert.ok(out.averageHoldup > previous, `U_G=${ug}: holdup ${out.averageHoldup} must exceed ${previous}`);
    assert.ok(out.averageHoldup > 0 && out.averageHoldup < 1, `U_G=${ug}: mean holdup bounded in (0,1)`);
    for (const a of out.alphaGas) {
      assert.ok(a >= 0 && a <= 1, `U_G=${ug}: station holdup ${a} not in [0,1]`);
    }
    previous = out.averageHoldup;
  }
});

test('liquid recirculation: core upflow, wall downflow, exact zero net flux', () => {
  const model = new EulerianMultiphaseBubbleColumn();
  for (const ug of [0.05, 0.1, 0.15, 0.2]) {
    const out = model.solveRadialProfile(ug);
    assert.ok(out.liquidCenterlineVelocity > 0, `U_G=${ug}: centerline liquid velocity must be upward`);
    assert.ok(out.minLiquidVelocity < 0, `U_G=${ug}: liquid profile must include downflow near the wall`);
    assert.ok(Math.abs(out.netLiquidFlux) < 1e-9, `U_G=${ug}: net liquid flux must vanish (${out.netLiquidFlux})`);
  }
});

test('standard condition: air-water, D=0.1 m, U_G=0.1 m/s gives published bubbly-flow holdup', () => {
  const model = new EulerianMultiphaseBubbleColumn({ columnDiameterM: 0.1 });
  const out = model.solveRadialProfile(0.1);
  assert.ok(
    out.averageHoldup >= 0.05 && out.averageHoldup <= 0.2,
    `average holdup ${out.averageHoldup} outside published bubbly-flow window [0.05, 0.2]`
  );
  process.stdout.write(
    `[report] standard condition: average gas holdup = ${out.averageHoldup.toFixed(5)} at U_G=0.1 m/s, D=0.1 m (air-water)\n`
  );
});

test('determinism: identical inputs produce identical outputs', () => {
  const model = new EulerianMultiphaseBubbleColumn();
  const first = model.solveRadialProfile(0.1);
  const second = model.solveRadialProfile(0.1);
  assert.deepEqual(first, second);
  assert.deepEqual(first.alphaGas, second.alphaGas);
  assert.deepEqual(first.uLiquid, second.uLiquid);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('standard condition is invariant to grid refinement (mesh convergence smoke check)', () => {
  const coarse = new EulerianMultiphaseBubbleColumn({ gridPoints: 32 }).solveRadialProfile(0.1);
  const fine = new EulerianMultiphaseBubbleColumn({ gridPoints: 128 }).solveRadialProfile(0.1);
  assert.ok(Math.abs(coarse.averageHoldup - fine.averageHoldup) < 1e-3);
});
