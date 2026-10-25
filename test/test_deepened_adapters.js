'use strict';

const assert = require('assert');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { GeometryEngineAdapter } = require('../src/core/cad/geometry_engine_adapter');
const { ControlsEngineAdapter } = require('../src/core/controls/controls_engine_adapter');
const { PlantEngineAdapter } = require('../src/core/plant/plant_engine_adapter');
const { getExperimentalThermoProperties } = require('./support/experimental_property_examples');

async function testDeepenedAdapters() {
  console.log('================================================================');
  console.log('   TESTING DEEPENED DOMAIN ENGINE ADAPTER OPERATIONS            ');
  console.log('================================================================\n');

  // 1. Test 2D Variational Sketch Constraint Solving via CAD Adapter
  console.log('[1] Testing CAD Variational Sketch Solver (ConstraintSolver2D)...');
  const cadAdapter = new GeometryEngineAdapter();
  const sketchReq = new JobRequest({
    jobId: 'job-sketch-001',
    domain: 'cad',
    operation: 'solve_variational_sketch',
    parameters: {
      points: [
        { id: 'p0', x: 0, y: 0, fixed: true },
        { id: 'p1', x: 8, y: 1 },
        { id: 'p2', x: 7, y: 6 }
      ],
      constraints: [
        { type: 'HORIZONTAL', params: { p1: 'p0', p2: 'p1' } },
        { type: 'DISTANCE_POINTS', params: { p1: 'p0', p2: 'p1', distance: 10.0 } },
        { type: 'VERTICAL', params: { p1: 'p1', p2: 'p2' } },
        { type: 'DISTANCE_POINTS', params: { p1: 'p1', p2: 'p2', distance: 5.0 } }
      ]
    }
  });
  const sketchRes = await cadAdapter.execute(sketchReq);
  assert(sketchRes.outputData.converged === true, 'Variational sketch must converge');
  const p1 = sketchRes.outputData.points.find((p) => p.id === 'p1');
  const p2 = sketchRes.outputData.points.find((p) => p.id === 'p2');
  assert(Math.abs(p1.x - 10.0) < 1e-4, 'Point p1 x must equal 10.0');
  assert(Math.abs(p1.y - 0.0) < 1e-4, 'Point p1 y must equal 0.0');
  assert(Math.abs(p2.x - 10.0) < 1e-4, 'Point p2 x must equal 10.0');
  assert(Math.abs(p2.y - 5.0) < 1e-4, 'Point p2 y must equal 5.0');
  console.log(
    `  ✓ PASSED: 2D Variational sketch solved in ${sketchRes.outputData.iterations} iterations. p1=[${p1.x}, ${p1.y}], p2=[${p2.x}, ${p2.y}]\n`
  );

  // 2. Test Extended Kalman Filter (EKF) State Estimation via Controls Adapter
  console.log('[2] Testing Controls Extended Kalman Filter (EKF 10-state)...');
  const controlsAdapter = new ControlsEngineAdapter();
  const ekfReq = new JobRequest({
    jobId: 'job-ekf-001',
    domain: 'controls',
    operation: 'estimate_ekf',
    parameters: {
      initialState: [0, 0, -100, 10, 0, 0, 1, 0, 0, 0], // altitude 100m, vx = 10 m/s
      steps: [
        { dt: 0.1, gyro: [0.01, 0.0, 0.0], accel: [1.0, 0.0, -9.80665], baroAlt: 100.5, gpsPos: [1.0, 0.0, -100.5] },
        { dt: 0.1, gyro: [0.01, 0.0, 0.0], accel: [1.0, 0.0, -9.80665], baroAlt: 101.2, gpsPos: [2.1, 0.0, -101.2] },
        { dt: 0.1, gyro: [0.0, 0.0, 0.0], accel: [0.0, 0.0, -9.80665], baroAlt: 102.0, gpsPos: [3.2, 0.0, -102.0] }
      ],
      recordTrajectory: true
    }
  });
  const ekfRes = await controlsAdapter.execute(ekfReq);
  assert(ekfRes.outputData.stepsProcessed === 3, 'Must process 3 EKF steps');
  assert(ekfRes.outputData.finalState.position[0] > 0, 'X position must advance forward');
  assert(Math.abs(ekfRes.outputData.finalState.position[2]) > 90, 'Altitude must remain near 100m');
  console.log(
    `  ✓ PASSED: EKF processed 3 steps. Pos=[${ekfRes.outputData.finalState.position.map((v) => v.toFixed(2)).join(', ')}], Roll=${ekfRes.outputData.finalState.eulerDeg.rollDeg.toFixed(2)}°\n`
  );

  // 3. Test Multicomponent VLE Phase Envelope via Plant Adapter
  console.log('[3] Testing Plant VLE P-T Phase Envelope...');
  const plantAdapter = new PlantEngineAdapter();
  const vleReq = new JobRequest({
    jobId: 'job-vle-001',
    domain: 'plant',
    operation: 'generate_vle_envelope',
    parameters: {
      composition: { Methane: 0.8, Ethane: 0.15, Propane: 0.05 },
      pMinBar: 2.0,
      pMaxBar: 30.0,
      points: 5,
      componentProperties: getExperimentalThermoProperties(['Methane', 'Ethane', 'Propane']),
      tMinC: -40,
      tMaxC: 160
    }
  });
  const vleRes = await plantAdapter.execute(vleReq);
  assert.strictEqual(vleRes.outputData.dataStatus, 'caller-supplied-unverified-data');
  assert(Array.isArray(vleRes.outputData.points), 'Envelope points must be an array');
  assert(vleRes.outputData.points.length === 5, 'Envelope points must contain 5 points');
  for (const pt of vleRes.outputData.points) {
    for (const [status, temperature, iterations, bracket] of [
      [pt.bubblePointStatus, pt.bubblePointTempC, pt.bubblePointIterations, pt.bubblePointTemperatureBracketC],
      [pt.dewPointStatus, pt.dewPointTempC, pt.dewPointIterations, pt.dewPointTemperatureBracketC]
    ]) {
      if (status === 'converged') {
        assert(Number.isFinite(temperature), 'Converged saturation temperature must be finite');
        assert(Number.isInteger(iterations) && iterations >= 0, 'Converged saturation search reports iterations');
        assert(Array.isArray(bracket) && bracket.length === 2, 'Converged saturation search reports its bracket');
      } else {
        assert(['unbracketed', 'not-converged'].includes(status));
        assert.strictEqual(temperature, null, 'Unresolved saturation targets must not report a boundary temperature');
      }
    }
    if (pt.status === 'experimental-estimate') {
      assert(Number.isFinite(pt.bubblePointTempC), 'Bracketed bubble point temperature must be finite');
      assert(Number.isFinite(pt.dewPointTempC), 'Bracketed dew point temperature must be finite');
      assert(pt.bubblePointTempC <= pt.dewPointTempC, 'Bubble point T must be <= Dew point T');
      assert(pt.twoPhaseWidthC >= 0, 'Two-phase width must be non-negative');
    } else {
      assert.strictEqual(pt.status, 'unavailable');
      assert.strictEqual(pt.twoPhaseWidthC, null, 'Unbracketed envelope points must not report a width');
    }
  }
  assert(
    vleRes.outputData.points.some(
      (pt) => pt.bubblePointStatus === 'unbracketed' || pt.dewPointStatus === 'unbracketed'
    ),
    'Temperature targets outside the caller-supplied range must be reported as unbracketed.'
  );
  console.log(`  ✓ PASSED: VLE P-T Envelope generated across 5 pressure levels:`);
  for (const pt of vleRes.outputData.points) {
    console.log(
      `     P = ${pt.pressureBar} bar: T_bubble = ${pt.bubblePointTempC}°C, T_dew = ${pt.dewPointTempC}°C (width: ${pt.twoPhaseWidthC}°C)`
    );
  }

  console.log('\n================================================================');
  console.log('   ALL DEEPENED ADAPTER TESTS PASSED!                           ');
  console.log('================================================================');
}

testDeepenedAdapters().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
