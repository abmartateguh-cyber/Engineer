/**
 * Verification Tests for PlateFinHeatExchanger (brazed-aluminum multi-stream
 * plate-fin LNG cold-box rating engine).
 *
 * Verifies:
 *  1. Two-stream counter-flow: duty matches Q = m * integral(cp dT) on each
 *     side to 1e-6 relative; the UA/LMTD method (independent, computed inside
 *     this test from the reported UA and end temperatures) matches the
 *     integrated rating within 2%.
 *  2. Multi-stream LNG cold-box (5 streams): composite curves do not cross,
 *     min dT >= 1.5 K, and every stream heat balance closes to 1e-6 relative.
 *  3. Pressure drop correlates with flow^2 (monotonic, positive).
 *  4. Geometry: longer core -> higher duty (monotonic); higher fin density ->
 *     higher heat-transfer coefficient.
 *  5. Determinism.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PlateFinHeatExchanger, enthalpyIntegral } = require('../src/core/plant/plate_fin_heat_exchanger');

const engine = new PlateFinHeatExchanger();

function cpIntegral(model, T1, T2) {
  const d1 = T1 - model.Tref;
  const d2 = T2 - model.Tref;
  return model.a * (T2 - T1) + 0.5 * model.b * (d2 * d2 - d1 * d1);
}

function cpQuadIntegral(A, B, C, T1, T2) {
  return A * (T2 - T1) + 0.5 * B * (T2 * T2 - T1 * T1) + (C / 3) * (T2 * T2 * T2 - T1 * T1 * T1);
}

const GEOM = {
  coreWidthM: 1.0,
  coreHeightM: 0.72,
  coreLengthM: 6.0,
  finType: 'serrated',
  finDensityPerM: 400,
  finThicknessM: 0.0002,
  plateGapM: 0.006
};

const HOT_MODEL = { a: 2050, b: 2.8, Tref: 200 };
const COLD_MODEL = { a: 3100, b: 4.0, Tref: 120 };
const HOT_INTEGRAL = cpIntegral(HOT_MODEL, 200, 300); // 219000 J/kg
const COLD_INTEGRAL = cpIntegral(COLD_MODEL, 120, 180); // 193200 J/kg
const QHOT = 40 * HOT_INTEGRAL; // 8.76e6 W
const M_COLD = QHOT / COLD_INTEGRAL; // balanced cold flow (kg/s)

function twoStreamCase(opts) {
  const o = opts || {};
  return {
    geometry: { ...GEOM },
    streams: [
      {
        name: 'CH4-gas-hot',
        type: 'hot',
        massFlowKgS: 40,
        TinK: 300,
        ToutK: o.solveOutlets ? undefined : 200,
        fluid: 'methaneGas',
        layers: 60
      },
      {
        name: 'LNG-cold',
        type: 'cold',
        massFlowKgS: M_COLD,
        TinK: 120,
        ToutK: o.solveOutlets ? undefined : 180,
        fluid: 'lng',
        layers: 60
      }
    ]
  };
}

describe('PlateFinHeatExchanger: two-stream counter-flow verification', () => {
  it('duty matches Q = m*cp*dT enthalpy balance to 1e-6 on each side', () => {
    const c = twoStreamCase();
    const r = engine.rate(c.streams, c.geometry);
    assert.equal(r.mode, 'verification');
    const hot = r.streams.find((s) => s.type === 'hot');
    const cold = r.streams.find((s) => s.type === 'cold');
    assert.ok(Math.abs(hot.dutyW - QHOT) / QHOT < 1e-6, `hot duty ${hot.dutyW} vs ${QHOT}`);
    const qColdExpected = M_COLD * COLD_INTEGRAL;
    assert.ok(
      Math.abs(cold.dutyW - qColdExpected) / qColdExpected < 1e-6,
      `cold duty ${cold.dutyW} vs ${qColdExpected}`
    );
    assert.ok(Math.abs(r.balancedDutyW - QHOT) / QHOT < 1e-6, 'balanced duty = hot enthalpy duty');
    assert.ok(r.closureRelative < 1e-9, `closure ${r.closureRelative}`);
    assert.ok(!r.composite.crossed, 'composite curves must not cross');
    assert.ok(r.composite.minDeltaTPhysicalK >= 1.5 - 1e-9, 'physical min approach >= 1.5 K');
    assert.ok(r.composite.minDeltaT_K >= 1.5 - 1e-9, 'composite min dT >= 1.5 K');
  });

  it('solved counter-flow rating matches independent UA/LMTD method within 2%', () => {
    const c = twoStreamCase({ solveOutlets: true });
    const r = engine.rate(c.streams, c.geometry);
    assert.equal(r.mode, 'rating-solved-ntu');
    const hot = r.streams.find((s) => s.type === 'hot');
    const cold = r.streams.find((s) => s.type === 'cold');
    const dT1 = hot.TinK - cold.ToutK;
    const dT2 = hot.ToutK - cold.TinK;
    assert.ok(dT1 > 0 && dT2 > 0, 'counter-flow end approaches must be positive');
    const lmtd = Math.abs(dT1 - dT2) < 1e-9 ? dT1 : (dT1 - dT2) / Math.log(dT1 / dT2);
    const qLmtd = r.totalUAK * lmtd;
    assert.ok(
      Math.abs(r.balancedDutyW - qLmtd) / r.balancedDutyW < 0.02,
      `duty ${r.balancedDutyW} vs UA*LMTD ${qLmtd}`
    );
    const qhSolved = 40 * cpIntegral(HOT_MODEL, hot.ToutK, hot.TinK);
    const qcSolved = M_COLD * cpIntegral(COLD_MODEL, cold.TinK, cold.ToutK);
    assert.ok(Math.abs(qhSolved - qcSolved) / qhSolved < 1e-6, 'enthalpy closure on solved outlets');
    assert.ok(Math.abs(r.balancedDutyW - qhSolved) / qhSolved < 1e-6, 'rating duty = enthalpy duty');
    assert.ok(hot.ToutK > cold.TinK, 'hot outlet above cold inlet');
    assert.ok(cold.ToutK < hot.TinK, 'cold outlet below hot inlet');
    assert.ok(r.composite.minDeltaTPhysicalK >= 1.5 - 1e-9, 'physical min approach >= 1.5 K');
  });

  it('gate rejects a physically infeasible (crossed) specification', () => {
    const qCross = 40 * HOT_INTEGRAL;
    const coldInt = cpIntegral(COLD_MODEL, 120, 310);
    const streams = [
      { name: 'hot', type: 'hot', massFlowKgS: 40, TinK: 300, ToutK: 200, fluid: 'methaneGas', layers: 60 },
      { name: 'cold', type: 'cold', massFlowKgS: qCross / coldInt, TinK: 120, ToutK: 310, fluid: 'lng', layers: 60 }
    ];
    assert.throws(() => engine.rate(streams, GEOM), /physical min approach/);
    const r = engine.rate(streams, GEOM, { strictDeltaTMin: false });
    assert.ok(r.composite.minDeltaTPhysicalK < 0, 'physical min approach must be negative when crossed');
  });
});

describe('PlateFinHeatExchanger: multi-stream LNG cold box', () => {
  const hotNG = {
    name: 'NG-HP',
    type: 'hot',
    massFlowKgS: 40,
    TinK: 285,
    ToutK: 205,
    layers: 50,
    props: {
      cp: { a: 2450, b: 2.6, Tref: 205 },
      viscosity: { a: 9e-6, b: 4e-8, Tref: 205 },
      conductivity: { a: 0.028, b: 1.3e-4, Tref: 205 },
      densityKgM3: 42
    }
  };
  const hotMR = {
    name: 'MR-HP',
    type: 'hot',
    massFlowKgS: 24,
    TinK: 320,
    ToutK: 210,
    layers: 46,
    props: {
      cp: { a: 2150, b: 2.2, Tref: 210 },
      viscosity: { a: 8e-6, b: 3e-8, Tref: 210 },
      conductivity: { a: 0.026, b: 1.1e-4, Tref: 210 },
      densityKgM3: 38
    }
  };
  const coldLP = {
    name: 'MR-LP',
    type: 'cold',
    massFlowKgS: 50,
    TinK: 170,
    ToutK: 192,
    layers: 46,
    props: {
      cp: { a: 2300, b: 2.0, Tref: 170 },
      viscosity: { a: 8.5e-6, b: 3.5e-8, Tref: 170 },
      conductivity: { a: 0.027, b: 1.2e-4, Tref: 170 },
      densityKgM3: 35
    }
  };
  const coldMid = {
    name: 'NG-mid',
    type: 'cold',
    massFlowKgS: 25,
    TinK: 150,
    ToutK: 190,
    layers: 40,
    props: {
      cp: (T) => 2350 + 2.4 * (T - 150) + 0.005 * (T - 150) * (T - 150),
      viscosity: { a: 9.5e-6, b: 4e-8, Tref: 150 },
      conductivity: { a: 0.029, b: 1.25e-4, Tref: 150 },
      densityKgM3: 40
    }
  };
  const coldLNG = {
    name: 'LNG-LP',
    type: 'cold',
    massFlowKgS: 0,
    TinK: 125,
    ToutK: 188,
    layers: 52,
    props: {
      cp: { a: 3250, b: 3.8, Tref: 125 },
      viscosity: { a: 1.5e-4, b: -3e-7, Tref: 125 },
      conductivity: { a: 0.185, b: 0, Tref: 125 },
      densityKgM3: 425
    }
  };

  it('composite curves do not cross, min dT >= 1.5 K, balances close to 1e-6', () => {
    const qNG = 40 * cpIntegral(hotNG.props.cp, 205, 285);
    const qMR = 24 * cpIntegral(hotMR.props.cp, 210, 320);
    const qLP = 50 * cpIntegral(coldLP.props.cp, 170, 192);
    const qMid = 25 * cpQuadIntegral(2102.5, 0.9, 0.005, 150, 190);
    const lngUnit = cpIntegral(coldLNG.props.cp, 125, 188);
    const qHotTotal = qNG + qMR;
    const qColdFixed = qLP + qMid;
    const mLNG = (qHotTotal - qColdFixed) / lngUnit;
    const streams = [hotNG, hotMR, coldLP, coldMid, { ...coldLNG, massFlowKgS: mLNG }];
    const geometry = { ...GEOM, coreHeightM: 234 * 0.006 };
    const r = engine.rate(streams, geometry);

    assert.equal(r.mode, 'verification');
    assert.ok(!r.composite.crossed, 'composite curves must not cross');
    assert.ok(r.composite.minDeltaT_K >= 1.5 - 1e-9, `composite min dT ${r.composite.minDeltaT_K} >= 1.5 K`);
    assert.ok(r.composite.minDeltaTPhysicalK >= 1.5 - 1e-9, 'physical min approach >= 1.5 K');
    assert.ok(r.closureRelative < 1e-6, `global closure ${r.closureRelative}`);

    const expected = { 'NG-HP': qNG, 'MR-HP': qMR, 'MR-LP': qLP, 'NG-mid': qMid, 'LNG-LP': mLNG * lngUnit };
    for (const s of r.streams) {
      const exp = expected[s.name];
      assert.ok(Math.abs(s.dutyW - exp) / exp < 1e-6, `${s.name} duty ${s.dutyW} vs ${exp}`);
    }
    assert.ok(Math.abs(r.balancedDutyW - qHotTotal) / qHotTotal < 1e-6, 'balanced duty = hot total');
  });
});

describe('PlateFinHeatExchanger: pressure drop and geometry', () => {
  it('pressure drop is positive, monotonic and correlates with flow^2', () => {
    const dP = [];
    for (const mult of [1, 1.5, 2]) {
      const c = twoStreamCase();
      c.streams[0].massFlowKgS = 40 * mult;
      c.streams[1].massFlowKgS = M_COLD * mult;
      const r = engine.rate(c.streams, c.geometry);
      const hot = r.streams.find((s) => s.type === 'hot');
      assert.ok(hot.pressureDropPa > 0, 'dP must be positive');
      dP.push(hot.pressureDropPa);
    }
    assert.ok(dP[1] > dP[0] && dP[2] > dP[1], 'dP strictly monotonic with flow');
    assert.ok(dP[1] / dP[0] > 1.5 && dP[1] / dP[0] < 2.5, 'dP ~ flow^1.8');
    assert.ok(dP[2] / dP[0] > 3 && dP[2] / dP[0] < 4, `dP(2x)/dP(1x)=${dP[2] / dP[0]} in (3,4)`);
  });

  it('increasing core length increases duty monotonically', () => {
    const duties = [];
    for (const L of [3, 4.5, 6, 8]) {
      const c = twoStreamCase({ solveOutlets: true });
      c.geometry.coreLengthM = L;
      const r = engine.rate(c.streams, c.geometry);
      duties.push(r.balancedDutyW);
    }
    for (let i = 1; i < duties.length; i++) {
      assert.ok(duties[i] > duties[i - 1], `duty(L) increasing: ${duties.join(', ')}`);
    }
  });

  it('increasing fin density increases heat-transfer coefficient', () => {
    const hHot = [];
    const hCold = [];
    for (const beta of [250, 400, 600]) {
      const c = twoStreamCase();
      c.geometry.finDensityPerM = beta;
      const r = engine.rate(c.streams, c.geometry);
      hHot.push(r.streams.find((s) => s.type === 'hot').h_Wm2K);
      hCold.push(r.streams.find((s) => s.type === 'cold').h_Wm2K);
    }
    for (let i = 1; i < hHot.length; i++) {
      assert.ok(hHot[i] > hHot[i - 1], `h(hot) increasing: ${hHot.join(', ')}`);
      assert.ok(hCold[i] > hCold[i - 1], `h(cold) increasing: ${hCold.join(', ')}`);
    }
  });

  it('is deterministic', () => {
    const c = twoStreamCase();
    const a = JSON.stringify(engine.rate(c.streams, c.geometry));
    const b = JSON.stringify(engine.rate(c.streams, c.geometry));
    assert.equal(a, b);
  });
});
