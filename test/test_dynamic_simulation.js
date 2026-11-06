/**
 * Verification Gate: pressure-driven dynamic process simulation with
 * compressor anti-surge control (Battalion 7, Agent 69).
 *
 * Deterministic node:test suite covering:
 *   - steady-state equilibrium matches the hand-solved analytic flow balance
 *     to 1e-4 relative;
 *   - step disturbance: sudden gas-turbine trip (speed -40% over 0.2 s)
 *     drives the uncontrolled compressor into the surge region; the minimum
 *     surge margin is quantified;
 *   - anti-surge: with the PID recycle controller active the valve opens only
 *     when margin < threshold, the margin is restored above threshold within a
 *     bounded time, the valve never exceeds 100%, and the flow never drops
 *     below the surge flow after t = 0.1 s;
 *   - closed-loop stability: monotone, non-growing recovery over the window;
 *   - determinism: identical runs produce identical trajectories.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DynamicProcessSimulator, analyticSteadyState } = require('../src/core/plant/dynamic_process_simulation');

// ---------------------------------------------------------------------------
// Shared scenario constants
// ---------------------------------------------------------------------------

const TRIP_T = 2.0; // turbine trip starts
const TRIP_DUR = 0.2; // speed ramp duration
const TRIP_N = 0.6; // speed after trip (40% drop)
const THRESH = 0.1; // surge margin threshold
const DT = 0.01;

function speedFn(t) {
  if (t <= TRIP_T) return 1.0;
  if (t >= TRIP_T + TRIP_DUR) return TRIP_N;
  return 1.0 - ((1.0 - TRIP_N) * (t - TRIP_T)) / TRIP_DUR;
}

// ---------------------------------------------------------------------------
// Analytic steady state (hand-solved flow balance, recycle valve closed):
//
//   F = Q_c = Q_process
//   H = P_d - P_s = hShut (1 - F / qMax)
//   P_d = P_sink + k F^2
//   P_s = P_d - H
//   margin = (Q_c - a) / a
// ---------------------------------------------------------------------------

const R_SPEC = 519.0;
const TEMP_K = 300.0;
const V_S = 2.0;
const V_D = 8.0;
const F_FEED = 12.0;
const P_SINK = 1.01325e5;
const K_PIPE = 1796.3541667; // Pa/(kg/s)^2 — matches module default exactly
const Q_MAX = 20.0;
const H_SHUT = 6.0e5;
const A_SURGE = 8.0;

function analyticSteady() {
  const q = F_FEED;
  const H = H_SHUT * (1.0 - q / Q_MAX);
  const pD = P_SINK + K_PIPE * q * q;
  const pS = pD - H;
  return { pS, pD, qC: q, qProcess: q, qRC: 0.0, margin: (q - A_SURGE) / A_SURGE, H };
}

// ---------------------------------------------------------------------------
// 1. Steady state vs analytic solution
// ---------------------------------------------------------------------------

test('steady-state: network converges to the analytic flow balance to 1e-4 relative', () => {
  const ana = analyticSteady();
  const sim = new DynamicProcessSimulator();
  const rec = sim.run({ duration: 60.0, dt: DT, speedFn: () => 1.0 });
  const last = rec[rec.length - 1];

  const checks = {
    pS: last.pS,
    pD: last.pD,
    qC: last.qC,
    qProcess: last.qProcess,
    qRC: last.qRC,
    margin: last.margin
  };
  for (const [key, got] of Object.entries(checks)) {
    const ref = ana[key];
    const rel = Math.abs(got - ref) / Math.max(Math.abs(ref), 1e-30);
    assert.ok(rel < 1e-4, `${key}: relative error ${rel} (got ${got}, analytic ${ref})`);
  }
  assert.ok(last.xRC === 0.0, 'recycle valve must be closed at nominal steady state');

  console.log(
    `  steady-state: pS=${last.pS.toFixed(1)} Pa pD=${last.pD.toFixed(1)} Pa ` +
      `qC=${last.qC.toFixed(4)} kg/s qProcess=${last.qProcess.toFixed(4)} kg/s ` +
      `margin=${last.margin.toFixed(6)} (analytic: pS=${ana.pS.toFixed(1)}, pD=${ana.pD.toFixed(1)}, ` +
      `qC=${ana.qC}, margin=${ana.margin})`
  );
});

// ---------------------------------------------------------------------------
// 2. Step disturbance (controller off): quantify minimum surge margin
// ---------------------------------------------------------------------------

test('step disturbance: turbine trip drives the uncontrolled compressor below the surge line', () => {
  const sim = new DynamicProcessSimulator({ controllerEnabled: false });
  const rec = sim.run({ duration: 8.0, dt: DT, speedFn });

  assert.ok(
    Math.abs(rec.find((r) => Math.abs(r.t - 2.1) < 1e-9).N - 0.8) < 1e-12,
    'speed must ramp linearly to 0.8 at t=2.1'
  );

  let minMargin = Infinity;
  let minT = 0;
  let crossedSurge = false;
  for (const r of rec) {
    if (r.t < TRIP_T) continue;
    if (r.margin < minMargin) {
      minMargin = r.margin;
      minT = r.t;
    }
    if (r.margin < 0.0) crossedSurge = true;
  }
  assert.ok(crossedSurge, 'uncontrolled flow must cross the surge line (margin < 0)');
  assert.ok(minMargin < -0.05, `uncontrolled minimum surge margin ${minMargin} must be below -0.05`);

  console.log(
    `  uncontrolled: minimum surge margin = ${minMargin.toFixed(4)} at t=${minT.toFixed(2)} s ` +
      `(surge line crossed: ${crossedSurge})`
  );
});

// ---------------------------------------------------------------------------
// 3. Anti-surge control active
// ---------------------------------------------------------------------------

test('anti-surge: valve opens only below threshold, flow never crosses surge line, margin restored in bounded time', () => {
  const sim = new DynamicProcessSimulator();
  const rec = sim.run({ duration: 8.0, dt: DT, speedFn });

  let maxX = 0;
  let firstOpen = -1;
  let firstOpenMc = null;
  let demandAboveThreshold = false;
  let lastBelow = -1;
  for (const r of rec) {
    if (r.xRC > maxX) maxX = r.xRC;
    if (r.xRC >= 0.05 && firstOpen < 0) {
      firstOpen = r.t;
      firstOpenMc = r.mc;
    }
    if (r.t >= TRIP_T && r.margin < THRESH) lastBelow = r.t;
    if (r.mc >= THRESH - 1e-12 && r.xDemand > 1e-9) demandAboveThreshold = true;
  }

  assert.ok(!demandAboveThreshold, 'controller demand must be zero whenever margin >= threshold');
  assert.ok(firstOpen > 0, 'recycle valve must open during the trip');
  assert.ok(firstOpenMc < THRESH, `valve must open only after margin falls below threshold (mc=${firstOpenMc})`);
  assert.ok(
    firstOpen - TRIP_T > 0.0 && firstOpen - TRIP_T < 0.5,
    `valve response time ${(firstOpen - TRIP_T).toFixed(3)} s must be within 0.5 s`
  );

  // Flow must stay above the surge line at all times after t = 0.1 s.
  let minMarginAfter01 = Infinity;
  for (const r of rec) {
    if (r.t >= 0.1) minMarginAfter01 = Math.min(minMarginAfter01, r.margin);
  }
  assert.ok(
    minMarginAfter01 >= -1e-9,
    `flow must stay at/above surge flow for all t>=0.1 s (min margin ${minMarginAfter01})`
  );

  // Valve must never exceed 100%.
  assert.ok(maxX <= 1.0 + 1e-12, `valve opening ${maxX} must never exceed 100%`);
  assert.ok(maxX > 0.1, `valve must open substantially (max x=${maxX})`);

  // Margin must be restored above threshold within a bounded time.
  assert.ok(lastBelow >= 0, 'margin must fall below threshold at least once');
  assert.ok(
    lastBelow - TRIP_T <= 0.6,
    `margin restored within ${(lastBelow - TRIP_T).toFixed(3)} s of trip (<= 0.6 s)`
  );
  for (const r of rec) {
    if (r.t > lastBelow + 1e-12) {
      assert.ok(
        r.margin >= THRESH - 1e-9,
        `margin must stay above threshold after t=${lastBelow} (t=${r.t}, margin=${r.margin})`
      );
    }
  }

  console.log(
    `  controlled: minimum surge margin = ${minMarginAfter01.toFixed(4)} (t>=0.1 s) ` +
      `valve response time = ${(firstOpen - TRIP_T).toFixed(3)} s ` +
      `max valve opening = ${maxX.toFixed(4)} (${(maxX * 100).toFixed(2)}%) ` +
      `margin restored above ${THRESH} by t=${lastBelow.toFixed(2)} s`
  );
});

// ---------------------------------------------------------------------------
// 4. Closed-loop stability (no oscillation growth over the 5 s window)
// ---------------------------------------------------------------------------

test('closed-loop stability: monotone recovery, no oscillation growth', () => {
  const sim = new DynamicProcessSimulator();
  const rec = sim.run({ duration: 8.0, dt: DT, speedFn });

  // After the transient (t >= 2.6 s) the margin must recover monotonically
  // toward the post-trip equilibrium.
  let prev = -Infinity;
  for (const r of rec) {
    if (r.t < 2.6) continue;
    assert.ok(r.margin >= prev - 1e-7, `margin must be non-decreasing after t=2.6 s (t=${r.t}, ${r.margin} < ${prev})`);
    prev = r.margin;
  }

  const final = rec[rec.length - 1].margin;
  const dev = (t0, t1) => {
    let d = 0;
    for (const r of rec) {
      if (r.t >= t0 && r.t <= t1) d = Math.max(d, Math.abs(r.margin - final));
    }
    return d;
  };
  const devEarly = dev(3.5, 5.0);
  const devLate = dev(5.0, 8.0);
  assert.ok(devLate <= devEarly + 1e-12, `oscillation amplitude must not grow (${devLate} > ${devEarly})`);
  assert.ok(devLate < 0.02, `steady-state deviation must be bounded (${devLate})`);

  console.log(
    `  stability: final margin=${final.toFixed(4)}, deviation [3.5,5]=${devEarly.toFixed(4)}, ` +
      `deviation [5,8]=${devLate.toFixed(4)} (non-growing)`
  );
});

// ---------------------------------------------------------------------------
// 5. Determinism
// ---------------------------------------------------------------------------

test('determinism: identical runs produce identical trajectories', () => {
  const a = new DynamicProcessSimulator().run({ duration: 8.0, dt: DT, speedFn });
  const b = new DynamicProcessSimulator().run({ duration: 8.0, dt: DT, speedFn });
  assert.strictEqual(a.length, b.length);
  assert.deepStrictEqual(a, b);
});

// ---------------------------------------------------------------------------
// 6. Analytic helper self-consistency (module export matches hand solution)
// ---------------------------------------------------------------------------

test('analytic helper matches hand-solved flow balance', () => {
  const hand = analyticSteady();
  const helper = analyticSteadyState();
  for (const key of ['pS', 'pD', 'qC', 'qProcess', 'qRC', 'margin']) {
    assert.ok(Math.abs(hand[key] - helper[key]) < 1e-9, `${key} mismatch`);
  }
});
