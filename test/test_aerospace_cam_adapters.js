'use strict';

const assert = require('assert');
const { CAMEngineAdapter } = require('../src/core/cam/cam_engine_adapter');
const { AerospaceEngineAdapter } = require('../src/core/aerospace/aerospace_engine_adapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');

(async () => {
  console.log('================================================================');
  console.log('       TESTING CAM & AEROSPACE DOMAIN ENGINE ADAPTERS           ');
  console.log('================================================================\n');

  // 1. CAM CNC Toolpath Engine Adapter
  console.log('[1] Testing CAMEngineAdapter...');
  const camAdapter = new CAMEngineAdapter();
  const camCaps = camAdapter.describeCapabilities();
  assert.strictEqual(camCaps.domain, 'cam');
  assert(camCaps.supportedOperations.includes('plan_roughing_toolpath'));
  assert(camCaps.supportedOperations.includes('generate_gcode'));

  const camReq = new JobRequest({
    domain: 'cam',
    operation: 'generate_gcode',
    parameters: {
      bounds: { minX: 0, maxX: 80, minY: 0, maxY: 80, minZ: 0, maxZ: 10 },
      toolOptions: { toolDiameter: 12.0, feedRateMmMin: 1500, spindleRpm: 9000 },
      programNumber: 'O5001'
    }
  });

  const camRes = await camAdapter.execute(camReq);
  assert.strictEqual(camRes.status, JobStatus.SUCCEEDED);
  assert(camRes.outputData.gcode.includes('G21 G90'), 'Must contain ISO metric header');
  assert(camRes.outputData.gcode.includes('M30'), 'Must end with M30 program rewind');
  assert(camRes.outputData.lineCount > 10, 'Must produce multiple G-code motion lines');
  console.log(`  ✓ PASSED: CAM generated ${camRes.outputData.lineCount} lines of ISO G-Code for CNC milling\n`);

  // 2. Aerospace Liquid Propulsion Engine Adapter
  console.log('[2] Testing AerospaceEngineAdapter (Combustion & Performance)...');
  const aeroAdapter = new AerospaceEngineAdapter();
  const aeroCaps = aeroAdapter.describeCapabilities();
  assert.strictEqual(aeroCaps.domain, 'aerospace');
  assert(aeroCaps.supportedOperations.includes('evaluate_combustion'));
  assert(aeroCaps.supportedOperations.includes('calculate_engine_performance'));

  // A. Evaluate combustion
  const combReq = new JobRequest({
    domain: 'aerospace',
    operation: 'evaluate_combustion',
    parameters: {
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 120.0,
      ofRatio: 3.5
    }
  });

  const combRes = await aeroAdapter.execute(combReq);
  assert.strictEqual(combRes.status, JobStatus.SUCCEEDED);
  assert(combRes.outputData.success, 'Combustion equilibrium must succeed');
  const Tc = combRes.outputData.chamberTemperatureK;
  const cStar = combRes.outputData.characteristicVelocityM_s;
  assert(Tc > 3000, `Chamber flame temperature must exceed 3000 K, got ${Tc}`);
  assert(cStar > 1500, `Characteristic exhaust velocity must exceed 1500 m/s, got ${cStar}`);
  console.log(`  ✓ PASSED: LOX/Methane combustion solved: Tc = ${Tc.toFixed(1)} K, c* = ${cStar.toFixed(1)} m/s\n`);

  // B. Rocket engine performance
  const perfReq = new JobRequest({
    domain: 'aerospace',
    operation: 'calculate_engine_performance',
    parameters: {
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100.0,
      ofRatio: 3.4,
      throatDiameterM: 0.25,
      expansionRatio: 35.0
    }
  });

  const perfRes = await aeroAdapter.execute(perfReq);
  assert.strictEqual(perfRes.status, JobStatus.SUCCEEDED);
  assert(perfRes.outputData.success, 'Engine performance calculation must succeed');
  assert(perfRes.outputData.thrustVacuumN > 100000, 'Vacuum thrust must be > 100 kN');
  assert(perfRes.outputData.ispVacuumS > 300, 'Vacuum Isp must exceed 300 s');
  console.log(`  ✓ PASSED: Vacuum Thrust = ${(perfRes.outputData.thrustVacuumN / 1e3).toFixed(1)} kN, Isp = ${perfRes.outputData.ispVacuumS.toFixed(1)} s\n`);

  console.log('================================================================');
  console.log('   ALL CAM & AEROSPACE DOMAIN ENGINE ADAPTER TESTS PASSED!      ');
  console.log('================================================================\n');
})();
