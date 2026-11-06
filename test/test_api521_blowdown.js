/**
 * Verification gate for the API 521 flare / emergency depressuring (blowdown)
 * module: src/core/plant/flare_depressuring_api521.js
 *
 * Covers:
 *  - Pressure decay of a 100 m^3 vessel from 5 MPa to 0.5 MPa vs an
 *    independent finer-step integration (±10%).
 *  - Adiabatic (isentropic) cooling T2 = T1 (P2/P1)^((gamma-1)/gamma).
 *  - MDMT violation flagged at crossing time; warm scenario not flagged.
 *  - Sonic -> subsonic regime transition as P approaches Pb.
 *  - Flare header network balancing to a converged common header pressure.
 *  - Determinism (identical runs -> identical outputs).
 *
 * Deterministic; plain assert style per repo convention.
 */

'use strict';

const assert = require('assert');
const { test } = require('node:test');
const {
  R_GAS,
  criticalPressureRatio,
  isentropicTemperature,
  orificeMassFlow,
  VesselDepressuringSimulator,
  balanceFlareHeader
} = require('../src/core/plant/flare_depressuring_api521');

const GAMMA = 1.4;
const MW_AIR = 28.97;
const PB = 101325.0;
const ORIFICE_AREA = 0.01;
const CD = 0.85;
const VESSEL = {
  volume: 100.0,
  initialPressure: 5.0e6,
  initialTemperature: 320.0,
  backpressure: PB,
  molecularWeight: MW_AIR,
  gamma: GAMMA,
  orificeArea: ORIFICE_AREA,
  dischargeCoefficient: CD
};

function timeToPressure(series, targetPa) {
  for (let i = 1; i < series.length; i++) {
    if (series[i].pressurePa <= targetPa) {
      const p0 = series[i - 1].pressurePa;
      const p1 = series[i].pressurePa;
      const t0 = series[i - 1].timeSeconds;
      const t1 = series[i].timeSeconds;
      return t0 + ((t1 - t0) * (p0 - targetPa)) / (p0 - p1);
    }
  }
  return null;
}

function integrateFine(spec, dt, targetPa) {
  let P = spec.initialPressure;
  let T = spec.initialTemperature;
  let t = 0.0;
  const series = [];
  while (t < 7200.0 && P > targetPa) {
    const flow = orificeMassFlow({
      area: spec.orificeArea,
      upstreamPressure: P,
      downstreamPressure: spec.backpressure,
      temperature: T,
      gamma: spec.gamma,
      molecularWeight: spec.molecularWeight,
      dischargeCoefficient: spec.dischargeCoefficient
    });
    const dPdt = -(flow.massFlowKgS * 1000.0 * R_GAS * T) / (spec.volume * spec.molecularWeight);
    const Pn = P + dPdt * dt;
    T = isentropicTemperature(P, T, Math.max(Pn, 1e-9), spec.gamma);
    P = Math.max(0.0, Pn);
    series.push({ timeSeconds: t, pressurePa: P, temperatureK: T, massFlowKgS: flow.massFlowKgS, regime: flow.regime });
    t += dt;
  }
  return series;
}

test('depressuring: monotonic pressure decay, time to 0.5 MPa within ±10% of fine integration', () => {
  const target = 5.0e5;
  const coarse = new VesselDepressuringSimulator(VESSEL).simulate({ timeStepS: 0.5, targetPressure: target });
  const fine = integrateFine(VESSEL, 0.005, target);

  for (let i = 1; i < coarse.series.length; i++) {
    assert(
      coarse.series[i].pressurePa < coarse.series[i - 1].pressurePa,
      `pressure not monotonic at t=${coarse.series[i].timeSeconds}`
    );
  }

  const tc = timeToPressure(coarse.series, target);
  const tf = timeToPressure(fine, target);
  assert(tc !== null && tf !== null, 'target pressure never reached');
  const rel = Math.abs(tc - tf) / tf;
  console.log(
    `  blowdown time to 0.5 MPa: coarse=${tc.toFixed(3)} s, fine=${tf.toFixed(3)} s, rel=${(rel * 100).toFixed(2)}%`
  );
  assert(rel < 0.1, `blowdown time ${tc} vs independent ${tf} deviates ${rel * 100}%`);
});

test('adiabatic cooling: T at 0.5 MPa matches isentropic relation to 1e-3 relative', () => {
  const target = 5.0e5;
  const r = new VesselDepressuringSimulator(VESSEL).simulate({ timeStepS: 0.25, targetPressure: target });
  const idx = r.series.findIndex((s) => s.pressurePa <= target);
  assert(idx >= 0, 'target pressure not reached');
  const measured = r.series[idx].temperatureK;
  const expected = isentropicTemperature(VESSEL.initialPressure, VESSEL.initialTemperature, target, GAMMA);
  const rel = Math.abs(measured - expected) / expected;
  console.log(
    `  T at 0.5 MPa: measured=${measured.toFixed(4)} K, isentropic=${expected.toFixed(4)} K, rel=${rel.toExponential(3)}`
  );
  assert(rel < 1e-3, `T ${measured} vs isentropic ${expected} rel error ${rel}`);

  let monotonic = true;
  for (let i = 1; i < r.series.length; i++) {
    if (!(r.series[i].temperatureK < r.series[i - 1].temperatureK)) monotonic = false;
  }
  assert(monotonic, 'temperature not monotonic');
});

test('MDMT: cool scenario flags at crossing time, warm scenario does not flag', () => {
  const coolSpec = Object.assign({}, VESSEL, { mdmtK: 250.0 });
  const cool = new VesselDepressuringSimulator(coolSpec).simulate({ timeStepS: 0.25, targetPressure: 5.0e5 });

  assert(cool.mdmt.crossed === true, 'MDMT violation not flagged');
  assert(cool.mdmt.crossingTimeS !== null && cool.mdmt.crossingTimeS > 0.0, 'missing crossing time');
  assert(cool.mdmt.minimumWallTemperatureK < 250.0, 'minimum wall T should be below 250 K');

  const fine = integrateFine(coolSpec, 0.005, 5.0e5);
  const fCross = fine.find((s) => s.temperatureK < 250.0);
  assert(fCross !== undefined, 'fine integration never cools below 250 K');
  assert(
    Math.abs(cool.mdmt.crossingTimeS - fCross.timeSeconds) < 0.5,
    `crossing time ${cool.mdmt.crossingTimeS} vs independent ${fCross.timeSeconds}`
  );
  console.log(
    `  MDMT crossing at t=${cool.mdmt.crossingTimeS.toFixed(3)} s (T_wall=250 K), min T=${cool.mdmt.minimumWallTemperatureK.toFixed(2)} K`
  );

  const warmSpec = Object.assign({}, VESSEL, { initialTemperature: 520.0, mdmtK: 250.0 });
  const warm = new VesselDepressuringSimulator(warmSpec).simulate({ timeStepS: 0.25, targetPressure: 5.0e5 });
  assert(warm.mdmt.crossed === false, 'warm scenario must not flag MDMT');
  assert(
    warm.mdmt.minimumWallTemperatureK >= 250.0,
    `warm min wall T ${warm.mdmt.minimumWallTemperatureK} should stay >= 250 K`
  );
  console.log(
    `  warm scenario final T=${warm.finalTemperatureK.toFixed(2)} K, min wall T=${warm.mdmt.minimumWallTemperatureK.toFixed(2)} K (no flag)`
  );
});

test('regime transition: sonic -> subsonic detected as P approaches Pb', () => {
  const r = new VesselDepressuringSimulator(VESSEL).simulate({ timeStepS: 0.25, targetPressure: 1.1e5 });
  const tr = r.regimeTransitions.find((x) => x.from === 'sonic' && x.to === 'subsonic');
  assert(tr !== undefined, 'sonic->subsonic transition not recorded');

  const idx = r.series.findIndex((s) => s.timeSeconds >= tr.timeSeconds);
  const pTrans = r.series[idx].pressurePa;
  const expected = PB / criticalPressureRatio(GAMMA);
  assert(Math.abs(pTrans - expected) / expected < 0.01, `transition at ${pTrans} Pa, expected ~${expected} Pa`);
  console.log(
    `  regime transition at t=${tr.timeSeconds.toFixed(3)} s, P=${pTrans.toFixed(0)} Pa (expected ~${expected.toFixed(0)} Pa)`
  );

  let subsonicAfter = true;
  for (let i = idx; i < r.series.length; i++) {
    if (r.series[i].regime !== 'subsonic') subsonicAfter = false;
  }
  assert(subsonicAfter, 'flow regime after transition must be subsonic');
});

test('header balancing: two sources converge to a common header pressure to 1e-6', () => {
  const KLINE = 50000.0;
  const makeSource = (upstreamPressure, area) => (pb) =>
    orificeMassFlow({
      area,
      upstreamPressure,
      downstreamPressure: pb,
      temperature: 300.0,
      gamma: GAMMA,
      molecularWeight: MW_AIR,
      dischargeCoefficient: CD
    }).massFlowKgS;

  const s1 = makeSource(3.0e6, 0.004);
  const s2 = makeSource(1.5e6, 0.002);
  const cap = (pb) => Math.max(0.0, (pb - PB) / KLINE);

  const res = balanceFlareHeader({
    sources: [{ flowAtBackpressure: s1 }, { flowAtBackpressure: s2 }],
    headerCapacity: cap,
    pbMin: PB,
    pbMax: 1.0e7,
    tolerancePa: 1e-9
  });

  assert(res.headerPressurePa > PB, 'header pressure must exceed flare tip pressure');
  const scale = Math.max(1.0, res.totalFlow, res.capacityFlow);
  assert(Math.abs(res.residual) <= 1e-6 * scale, `header balance residual ${res.residual} exceeds 1e-6*${scale}`);
  assert(
    Math.abs(res.totalFlow - res.capacityFlow) <= 1e-6 * scale,
    'total flow does not match header capacity to 1e-6'
  );
  assert(Math.abs(s1(res.headerPressurePa) - res.flows[0]) < 1e-9, 'source 1 inconsistent at converged Pb');
  assert(Math.abs(s2(res.headerPressurePa) - res.flows[1]) < 1e-9, 'source 2 inconsistent at converged Pb');
  console.log(
    `  header Pb=${res.headerPressurePa.toFixed(6)} Pa, flows=[${res.flows.map((f) => f.toFixed(6)).join(', ')}] kg/s, residual=${res.residual.toExponential(3)}, iterations=${res.iterations}`
  );
});

test('determinism: identical runs produce identical outputs', () => {
  const a = new VesselDepressuringSimulator(VESSEL).simulate({ timeStepS: 0.25, targetPressure: 5.0e5 });
  const b = new VesselDepressuringSimulator(VESSEL).simulate({ timeStepS: 0.25, targetPressure: 5.0e5 });
  assert.strictEqual(JSON.stringify(a.series), JSON.stringify(b.series));
  assert.strictEqual(JSON.stringify(a.regimeTransitions), JSON.stringify(b.regimeTransitions));
  assert.strictEqual(JSON.stringify(a.mdmt), JSON.stringify(b.mdmt));
});
