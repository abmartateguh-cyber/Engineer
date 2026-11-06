/**
 * test/test_nozzle_loads.js
 * Verification gate for the rotating-equipment nozzle load evaluator
 * (src/core/plant/nozzle_load_evaluator.js).
 *
 * Sources:
 *  - API 610 (11th ed.) Table 5 — centrifugal pump nozzle allowable loads
 *  - NEMA SM 23 — steam turbine flange allowable moments (representative)
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  NozzleLoadEvaluator,
  API610_TABLE_5,
  NEMA_SM23_FRAMES,
  API610_SIZE_ORDER,
  NEMA_FRAME_ORDER
} = require('../src/core/plant/nozzle_load_evaluator');

const TOL = 1e-9;

const hypot3 = (a, b, c) => Math.sqrt(a * a + b * b + c * c);

const componentUtilization = (name, actual, allowables) => Math.abs(actual) / allowables[name];

test('API 610: 3-inch suction nozzle with loads within Table 5 allowables passes', () => {
  const loads = {
    sizeCategory: '3-4',
    nozzle: 'suction',
    Fx: 850,
    Fy: 710,
    Fz: 710,
    Mx: 470,
    My: 350,
    Mz: 350
  };
  const result = NozzleLoadEvaluator.evaluateApi610(loads);

  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.standard, 'API 610 (11th ed.) Table 5');
  assert.strictEqual(result.sizeCategory, '3-4');
  assert.strictEqual(result.nozzle, 'suction');

  const allow = API610_TABLE_5['3-4'].suction;
  assert.strictEqual(allow.Fx, 890);
  assert.strictEqual(allow.Fy, 710);
  assert.strictEqual(allow.Fz, 890);
  assert.strictEqual(allow.Mx, 470);
  assert.strictEqual(allow.My, 350);
  assert.strictEqual(allow.Mz, 470);

  for (const component of result.components) {
    assert.ok(component.utilization <= 1.0, `${component.name} utilization must be <= 1`);
    assert.strictEqual(component.pass, true);
  }

  const expectedCombined = Math.max(
    componentUtilization('Fx', 850, allow),
    componentUtilization('Fy', 710, allow),
    componentUtilization('Fz', 710, allow),
    componentUtilization('Mx', 470, allow),
    componentUtilization('My', 350, allow),
    componentUtilization('Mz', 350, allow)
  );
  assert.ok(Math.abs(result.combinedUtilization - expectedCombined) < TOL);
  assert.strictEqual(result.combinedUtilization, 1.0);
  assert.strictEqual(result.pass, true);
});

test('API 610: doubling the axial force beyond the limit flags Fz with utilization > 1', () => {
  const result = NozzleLoadEvaluator.evaluateApi610({
    sizeCategory: '3-4',
    nozzle: 'suction',
    Fx: 850,
    Fy: 710,
    Fz: 1420,
    Mx: 470,
    My: 350,
    Mz: 350
  });

  assert.strictEqual(result.pass, false);

  const fz = result.components.find((c) => c.name === 'Fz');
  assert.strictEqual(fz.pass, false);
  assert.strictEqual(fz.actual, 1420);
  assert.strictEqual(fz.allowable, 890);
  assert.ok(fz.utilization > 1.0);
  assert.ok(Math.abs(fz.utilization - 1420 / 890) < TOL);

  const otherComponentsPass = result.components.filter((c) => c.name !== 'Fz').every((c) => c.pass);
  assert.strictEqual(otherComponentsPass, true);
});

test('API 610: combined utilization formula matches the independent per-component method', () => {
  const cases = [
    { sizeCategory: '1-2', nozzle: 'suction', Fx: 400, Fy: 300, Fz: 500, Mx: 200, My: 150, Mz: 250 },
    { sizeCategory: '3-4', nozzle: 'discharge', Fx: 1000, Fy: 800, Fz: 1200, Mx: 500, My: 400, Mz: 600 },
    { sizeCategory: '6-8', nozzle: 'suction', Fx: 1500, Fy: 1200, Fz: 1300, Mx: 700, My: 600, Mz: 800 },
    { sizeCategory: '10-12', nozzle: 'discharge', Fx: 2000, Fy: 1800, Fz: 2100, Mx: 1000, My: 900, Mz: 1100 },
    { sizeCategory: '14+', nozzle: 'suction', Fx: 2500, Fy: 2000, Fz: 2400, Mx: 1200, My: 1000, Mz: 1300 }
  ];

  for (const c of cases) {
    const result = NozzleLoadEvaluator.evaluateApi610(c);
    const allow = API610_TABLE_5[c.sizeCategory][c.nozzle];

    const expectedCombined = Math.max(
      componentUtilization('Fx', c.Fx, allow),
      componentUtilization('Fy', c.Fy, allow),
      componentUtilization('Fz', c.Fz, allow),
      componentUtilization('Mx', c.Mx, allow),
      componentUtilization('My', c.My, allow),
      componentUtilization('Mz', c.Mz, allow)
    );
    assert.ok(Math.abs(result.combinedUtilization - expectedCombined) < TOL, 'combined utilization mismatch');
    assert.strictEqual(result.pass, expectedCombined <= 1.0);

    const expectedForceRatio = hypot3(c.Fx, c.Fy, c.Fz) / allow.Fx;
    const expectedMomentRatio = hypot3(c.Mx, c.My, c.Mz) / allow.Mx;
    assert.ok(Math.abs(result.forceRatio - expectedForceRatio) < TOL, 'force ratio mismatch');
    assert.ok(Math.abs(result.momentRatio - expectedMomentRatio) < TOL, 'moment ratio mismatch');
  }
});

test('NEMA SM 23: frame-4 exhaust flange — moment slightly below passes, slightly above fails', () => {
  const frame = NEMA_SM23_FRAMES['4'];
  const M_allow = frame.exhaust;

  const below = NozzleLoadEvaluator.evaluateNemaSm23({
    frameSize: '4',
    flange: 'exhaust',
    Mx: M_allow - 1,
    My: 0,
    Mz: 0
  });
  assert.strictEqual(below.pass, true);
  assert.ok(Math.abs(below.utilization - (M_allow - 1) / M_allow) < TOL);
  assert.ok(below.utilization < 1.0);
  assert.strictEqual(below.allowableMoment, M_allow);

  const above = NozzleLoadEvaluator.evaluateNemaSm23({
    frameSize: '4',
    flange: 'exhaust',
    Mx: M_allow + 1,
    My: 0,
    Mz: 0
  });
  assert.strictEqual(above.pass, false);
  assert.ok(above.utilization > 1.0);

  const diagonal = NozzleLoadEvaluator.evaluateNemaSm23({
    frameSize: '4',
    flange: 'exhaust',
    Mx: (M_allow - 1) / Math.sqrt(3),
    My: (M_allow - 1) / Math.sqrt(3),
    Mz: (M_allow - 1) / Math.sqrt(3)
  });
  assert.ok(Math.abs(diagonal.momentResultant - (M_allow - 1)) < 1e-6);
  assert.ok(Math.abs(diagonal.utilization - (M_allow - 1) / M_allow) < TOL);
  assert.strictEqual(diagonal.pass, true);
});

test('NEMA SM 23: inlet flange limits are enforced independently', () => {
  const frame = NEMA_SM23_FRAMES['4'];
  const M_inlet = frame.inlet;

  const passCase = NozzleLoadEvaluator.evaluateNemaSm23({
    frameSize: '4',
    flange: 'inlet',
    Mx: M_inlet - 10,
    My: 0,
    Mz: 0
  });
  assert.strictEqual(passCase.pass, true);

  const failCase = NozzleLoadEvaluator.evaluateNemaSm23({
    frameSize: '4',
    flange: 'inlet',
    Mx: M_inlet + 10,
    My: 0,
    Mz: 0
  });
  assert.strictEqual(failCase.pass, false);
});

test('Spring hanger relief: required added support = F_z - F_z_allow exactly', () => {
  const Fz = 2000;
  const FzAllow = API610_TABLE_5['3-4'].suction.Fz;

  const result = NozzleLoadEvaluator.evaluateApi610({
    sizeCategory: '3-4',
    nozzle: 'suction',
    Fx: 0,
    Fy: 0,
    Fz,
    Mx: 0,
    My: 0,
    Mz: 0
  });
  assert.strictEqual(result.pass, false);

  const relief = NozzleLoadEvaluator.computeSpringHangerRelief(result);
  assert.strictEqual(relief.required, true);
  assert.strictEqual(relief.component, 'Fz');
  assert.strictEqual(relief.requiredReduction_N, Fz - FzAllow);
  assert.strictEqual(relief.requiredReduction_N, 1110);
  assert.strictEqual(relief.adjustedActual_N, FzAllow);
});

test('Spring hanger relief: no relief required when the nozzle passes', () => {
  const result = NozzleLoadEvaluator.evaluateApi610({
    sizeCategory: '3-4',
    nozzle: 'suction',
    Fx: 850,
    Fy: 710,
    Fz: 710,
    Mx: 470,
    My: 350,
    Mz: 350
  });
  const relief = NozzleLoadEvaluator.computeSpringHangerRelief(result);
  assert.strictEqual(relief.required, false);
  assert.strictEqual(relief.requiredReduction_N, 0);
});

test('Catalog integrity: API 610 Table 5 entries are non-negative, finite, and monotonic', () => {
  const keys = ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'];

  for (const nozzle of ['suction', 'discharge']) {
    const previous = { Fx: -Infinity, Fy: -Infinity, Fz: -Infinity, Mx: -Infinity, My: -Infinity, Mz: -Infinity };

    for (const size of API610_SIZE_ORDER) {
      const entry = API610_TABLE_5[size][nozzle];
      assert.ok(entry, `missing API 610 entry for ${size}/${nozzle}`);

      for (const key of keys) {
        const value = entry[key];
        assert.ok(Number.isFinite(value), `${size}/${nozzle} ${key} must be finite (no NaN)`);
        assert.ok(value >= 0, `${size}/${nozzle} ${key} must be non-negative`);
        assert.ok(value >= previous[key], `API 610 ${key} must be monotonic non-decreasing (${size})`);
        previous[key] = value;
      }
    }
  }
});

test('Catalog integrity: NEMA SM 23 frames are non-negative, finite, monotonic, exhaust >= inlet', () => {
  let previousInlet = -Infinity;
  let previousExhaust = -Infinity;

  for (const frame of NEMA_FRAME_ORDER) {
    const entry = NEMA_SM23_FRAMES[frame];
    assert.ok(entry, `missing NEMA SM 23 entry for frame ${frame}`);

    for (const key of ['inlet', 'exhaust']) {
      const value = entry[key];
      assert.ok(Number.isFinite(value), `frame ${frame} ${key} must be finite (no NaN)`);
      assert.ok(value >= 0, `frame ${frame} ${key} must be non-negative`);
    }

    assert.ok(entry.inlet >= previousInlet, `NEMA inlet M must be monotonic non-decreasing (frame ${frame})`);
    assert.ok(entry.exhaust >= previousExhaust, `NEMA exhaust M must be monotonic non-decreasing (frame ${frame})`);
    assert.ok(entry.exhaust >= entry.inlet, `NEMA exhaust allowance must be >= inlet allowance (frame ${frame})`);
    previousInlet = entry.inlet;
    previousExhaust = entry.exhaust;
  }
});

test('API 610 size category resolution maps nominal sizes correctly', () => {
  assert.strictEqual(NozzleLoadEvaluator.resolveApi610Category(1), '1-2');
  assert.strictEqual(NozzleLoadEvaluator.resolveApi610Category(2), '1-2');
  assert.strictEqual(NozzleLoadEvaluator.resolveApi610Category(3), '3-4');
  assert.strictEqual(NozzleLoadEvaluator.resolveApi610Category(4), '3-4');
  assert.strictEqual(NozzleLoadEvaluator.resolveApi610Category(6), '6-8');
  assert.strictEqual(NozzleLoadEvaluator.resolveApi610Category(8), '6-8');
  assert.strictEqual(NozzleLoadEvaluator.resolveApi610Category(10), '10-12');
  assert.strictEqual(NozzleLoadEvaluator.resolveApi610Category(12), '10-12');
  assert.strictEqual(NozzleLoadEvaluator.resolveApi610Category(14), '14+');
  assert.strictEqual(NozzleLoadEvaluator.resolveApi610Category(24), '14+');
  assert.throws(() => NozzleLoadEvaluator.resolveApi610Category(0));
  assert.throws(() => NozzleLoadEvaluator.resolveApi610Category('abc'));
});
