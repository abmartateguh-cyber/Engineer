'use strict';

const assert = require('assert');
const { SixDofDynamics } = require('../src/core/aerospace/six_dof_dynamics');
const { AerospaceEngineAdapter } = require('../src/core/aerospace/aerospace_engine_adapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');

const G0 = 9.80665;
const R_EARTH = 6378137.0;

function ballisticParams(overrides = {}) {
  return {
    gravityModel: 'constant',
    initialState: {
      positionM: [0, 0, 0],
      velocityM_s: [100 * Math.sqrt(0.5), 0, 100 * Math.sqrt(0.5)],
      quaternion: [1, 0, 0, 0],
      angularRateRad_s: [0, 0, 0]
    },
    massKg: 1,
    inertiaKgM2: [1, 1, 1],
    thrust: null,
    coefficients: null,
    dt: 0.01,
    steps: 2000,
    ...overrides
  };
}

(async () => {
  console.log('================================================================');
  console.log('      TESTING AEROSPACE 6-DOF RIGID-BODY FLIGHT DYNAMICS      ');
  console.log('================================================================\n');

  const engine = new SixDofDynamics();

  // (i) Ballistic projectile: range vs closed-form vacuum range (flat-earth, constant g)
  console.log('[1] Ballistic projectile range vs closed-form vacuum range...');
  const ballistic = engine.simulateSixDof(ballisticParams());
  assert.strictEqual(ballistic.success, true, 'Ballistic simulation must succeed');
  assert.strictEqual(ballistic.events.impact.detected, true, 'Impact must be detected');
  const rangeClosedForm = (100 * 100 * Math.sin(Math.PI / 2)) / G0; // v0^2 * sin(2*theta)/g
  const rangeSim = ballistic.events.impact.positionM[0];
  const rangeError = Math.abs(rangeSim - rangeClosedForm) / rangeClosedForm;
  assert(
    rangeError < 0.01,
    `Ballistic range must match closed form within 1%, got error ${(rangeError * 100).toFixed(4)}%`
  );
  console.log(
    `  ✓ PASSED: simulated range = ${rangeSim.toFixed(2)} m vs closed-form ${rangeClosedForm.toFixed(2)} m (error ${(rangeError * 100).toFixed(3)}%)\n`
  );

  // (ii) Vertical launch with constant thrust: monotonic sanity and finite states
  console.log('[2] Vertical launch with constant thrust (inverse-square gravity)...');
  const launch = engine.simulateSixDof({
    gravityModel: 'inverse-square',
    initialState: {
      positionM: [0, 0, R_EARTH],
      velocityM_s: [0, 0, 0],
      quaternion: [1, 0, 0, 0],
      angularRateRad_s: [0, 0, 0]
    },
    massKg: 1000,
    inertiaKgM2: [1000, 1000, 1000],
    thrust: { magnitudeN: 25000, directionBody: [0, 0, 1] },
    coefficients: null,
    dt: 0.05,
    steps: 400
  });
  assert.strictEqual(launch.success, true, 'Vertical launch must succeed');
  assert.strictEqual(launch.stability.statesFinite, true, 'All states must be finite');
  let altitudeMonotonic = true;
  let velocityMonotonic = true;
  for (let i = 1; i < launch.trajectory.length; i++) {
    if (launch.trajectory[i].altitudeM < launch.trajectory[i - 1].altitudeM - 1e-9) altitudeMonotonic = false;
    if (launch.trajectory[i].velocityM_s[2] < launch.trajectory[i - 1].velocityM_s[2] - 1e-6) {
      velocityMonotonic = false;
    }
    assert(Number.isFinite(launch.trajectory[i].altitudeM), 'Altitude must be finite');
    assert(Number.isFinite(launch.trajectory[i].velocityM_s[2]), 'Vertical velocity must be finite');
  }
  assert(altitudeMonotonic, 'Altitude must be monotonically non-decreasing under constant thrust');
  assert(velocityMonotonic, 'Vertical velocity must be monotonically non-decreasing under constant thrust > weight');
  const finalAltitude = launch.trajectory[launch.trajectory.length - 1].altitudeM;
  const finalVelocity = launch.trajectory[launch.trajectory.length - 1].velocityM_s[2];
  console.log(
    `  ✓ PASSED: final altitude = ${finalAltitude.toFixed(1)} m, final vz = ${finalVelocity.toFixed(1)} m/s at t = 20 s (states finite)\n`
  );

  // (iii) Apogee event within one step of analytic apogee time (vacuum vertical, t = v0/g)
  console.log('[3] Apogee event vs analytic apogee time...');
  const v0 = 100; // m/s
  const tApogeeClosedForm = v0 / G0;
  const apogeeRun = engine.simulateSixDof({
    gravityModel: 'constant',
    initialState: {
      positionM: [0, 0, 0],
      velocityM_s: [0, 0, v0],
      quaternion: [1, 0, 0, 0],
      angularRateRad_s: [0, 0, 0]
    },
    massKg: 1,
    inertiaKgM2: [1, 1, 1],
    thrust: null,
    coefficients: null,
    dt: 0.01,
    steps: 1500
  });
  assert.strictEqual(apogeeRun.success, true);
  assert.strictEqual(apogeeRun.events.apogee.detected, true, 'Apogee must be detected');
  const apogeeError = Math.abs(apogeeRun.events.apogee.timeS - tApogeeClosedForm);
  assert(
    apogeeError <= 0.01,
    `Apogee time must be within one step (0.01 s) of analytic ${tApogeeClosedForm.toFixed(3)} s, got ${apogeeRun.events.apogee.timeS.toFixed(4)} s`
  );
  console.log(
    `  ✓ PASSED: apogee at t = ${apogeeRun.events.apogee.timeS.toFixed(4)} s vs analytic ${tApogeeClosedForm.toFixed(4)} s (off ${(apogeeError * 1000).toFixed(2)} ms), altitude = ${apogeeRun.events.apogee.altitudeM.toFixed(2)} m\n`
  );

  // (iv) Impact event detected with state capture (vertical drop)
  console.log('[4] Impact event detection (vertical drop)...');
  const dropHeight = 100;
  const drop = engine.simulateSixDof({
    gravityModel: 'constant',
    initialState: {
      positionM: [0, 0, dropHeight],
      velocityM_s: [0, 0, 0],
      quaternion: [1, 0, 0, 0],
      angularRateRad_s: [0, 0, 0]
    },
    massKg: 1,
    inertiaKgM2: [1, 1, 1],
    thrust: null,
    coefficients: null,
    dt: 0.01,
    steps: 1000
  });
  assert.strictEqual(drop.success, true);
  assert.strictEqual(drop.events.impact.detected, true, 'Impact must be detected');
  const tImpactClosedForm = Math.sqrt((2 * dropHeight) / G0);
  const impactError = Math.abs(drop.events.impact.timeS - tImpactClosedForm);
  assert(impactError <= 0.01, 'Impact time must be within one step of analytic');
  assert(Math.abs(drop.events.impact.altitudeM) < 0.1, 'Captured impact altitude must be ~0');
  assert(
    Array.isArray(drop.events.impact.velocityM_s) && drop.events.impact.velocityM_s.length === 3,
    'Impact state must be captured'
  );
  const impactSpeed = Math.hypot(
    drop.events.impact.velocityM_s[0],
    drop.events.impact.velocityM_s[1],
    drop.events.impact.velocityM_s[2]
  );
  console.log(
    `  ✓ PASSED: impact at t = ${drop.events.impact.timeS.toFixed(4)} s (analytic ${tImpactClosedForm.toFixed(4)} s), speed = ${impactSpeed.toFixed(2)} m/s, captured altitude = ${drop.events.impact.altitudeM.toExponential(1)} m\n`
  );

  // (v) Quaternion unit-norm drift after 10k steps
  console.log('[5] Quaternion unit-norm drift after 10,000 RK4 steps...');
  const spin = engine.simulateSixDof({
    gravityModel: 'constant',
    initialState: {
      positionM: [0, 0, 0],
      velocityM_s: [0, 0, 0],
      quaternion: [1, 0, 0, 0],
      angularRateRad_s: [0.1, 0.05, 0.03]
    },
    massKg: 1,
    inertiaKgM2: [1, 1, 1],
    thrust: null,
    coefficients: null,
    dt: 0.01,
    steps: 10000
  });
  assert.strictEqual(spin.success, true);
  const drift = spin.stability.quaternionNormDriftMax;
  assert(drift < 1e-12, `Quaternion norm drift must be < 1e-12 after 10k steps, got ${drift.toExponential(3)}`);
  console.log(`  ✓ PASSED: max |norm(q) - 1| = ${drift.toExponential(3)} after 10,000 steps (dt = 0.01 s)\n`);

  // (vi) Determinism
  console.log('[6] Determinism (identical repeated runs)...');
  const runA = engine.simulateSixDof(ballisticParams());
  const runB = engine.simulateSixDof(ballisticParams());
  assert.strictEqual(JSON.stringify(runA), JSON.stringify(runB), 'Identical inputs must produce identical outputs');
  console.log('  ✓ PASSED: two identical runs produced byte-identical results\n');

  // (vii) Adapter route end-to-end: aerospace:six-dof-sim
  console.log('[7] AerospaceEngineAdapter route aerospace:six-dof-sim (end-to-end)...');
  const adapter = new AerospaceEngineAdapter();
  assert(
    adapter.describeCapabilities().supportedOperations.includes('six_dof_sim'),
    'Adapter must advertise six_dof_sim'
  );
  const request = new JobRequest({
    domain: 'aerospace',
    operation: 'six_dof_sim',
    parameters: ballisticParams({ steps: 2000 })
  });
  const events = [];
  const result = await adapter.execute(request, (e) => events.push(e));
  assert.strictEqual(result.status, JobStatus.SUCCEEDED);
  assert.strictEqual(result.outputData.success, true, 'Adapter must return a successful simulation');
  assert(result.outputData.trajectory.length === 2001, 'Trajectory must contain steps + 1 samples');
  assert.strictEqual(result.outputData.events.impact.detected, true, 'Adapter simulation must detect impact');
  assert(events.length >= 2, 'Progress events must be emitted');
  console.log(
    `  ✓ PASSED: route produced ${result.outputData.trajectory.length} samples, impact at t = ${result.outputData.events.impact.timeS.toFixed(2)} s, range = ${result.outputData.events.impact.positionM[0].toFixed(2)} m\n`
  );

  console.log('================================================================');
  console.log('      ALL AEROSPACE 6-DOF FLIGHT DYNAMICS TESTS PASSED!       ');
  console.log('================================================================\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
