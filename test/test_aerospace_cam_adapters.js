'use strict';

const assert = require('assert');
const { CAMEngineAdapter } = require('../src/core/cam/cam_engine_adapter');
const { CNCToolpathEngine } = require('../src/core/cam/cnc_toolpath_engine');
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
  assert.throws(() => new CNCToolpathEngine(), /requires explicit tool options/);
  const explicitCamEngine = new CNCToolpathEngine({
    toolDiameter: 10,
    toolType: 'flat_endmill',
    spindleRpm: 6000,
    feedRateMmMin: 800,
    plungeRateMmMin: 250,
    stepoverMm: 5,
    stepdownMm: 2,
    safeZ: 20
  });
  assert.throws(() => explicitCamEngine.planRoughingToolpath(), /requires explicit finite bounds/);
  assert.throws(() => explicitCamEngine.generateGCode({}, 'O1001'), /requires caller-supplied roughing toolpath/);

  const camToolOptions = {
    toolDiameter: 12.0,
    toolType: 'flat_endmill',
    spindleRpm: 9000,
    feedRateMmMin: 1500,
    plungeRateMmMin: 300,
    stepoverMm: 6,
    stepdownMm: 2.5,
    safeZ: 20
  };
  const camPlanReq = new JobRequest({
    domain: 'cam',
    operation: 'plan_roughing_toolpath',
    parameters: {
      bounds: { minX: 0, maxX: 80, minY: 0, maxY: 80, minZ: 0, maxZ: 10 },
      toolOptions: camToolOptions
    }
  });

  const planRes = await camAdapter.execute(camPlanReq);
  assert.strictEqual(planRes.status, JobStatus.SUCCEEDED);
  const camReq = new JobRequest({
    domain: 'cam',
    operation: 'generate_gcode',
    parameters: { toolpaths: planRes.outputData, toolOptions: camToolOptions, programNumber: 'O5001' }
  });
  const camRes = await camAdapter.execute(camReq);
  assert.strictEqual(camRes.status, JobStatus.SUCCEEDED);
  assert(
    camRes.outputData.gcode.includes('G21 G90'),
    'Illustrative output must contain metric and absolute-mode codes'
  );
  assert(camRes.outputData.gcode.includes('M30'), 'Must end with M30 program rewind');
  assert(camRes.outputData.lineCount > 10, 'Must produce multiple G-code motion lines');
  console.log(
    `  ✓ PASSED: CAM generated ${camRes.outputData.lineCount} lines of unvalidated illustrative G-code text\n`
  );

  // 1B. Constant Scallop 3D Finishing Sizing
  console.log('[1B] Testing CAMEngineAdapter (Constant Scallop)...');
  const scallopReq = new JobRequest({
    domain: 'cam',
    operation: 'calculate_constant_scallop',
    parameters: {
      toolOptions: camToolOptions,
      toolRadiusMm: 6.0,
      scallopHeightMm: 0.01,
      surfaceCurvature: 0.02
    }
  });
  const scallopRes = await camAdapter.execute(scallopReq);
  assert.strictEqual(scallopRes.status, JobStatus.SUCCEEDED);
  assert(scallopRes.outputData.stepoverMm > 0 && scallopRes.outputData.stepoverMm < 1.0);
  console.log(`  ✓ PASSED: Constant scallop stepover = ${scallopRes.outputData.stepoverMm.toFixed(4)} mm\n`);

  // 1C. Trochoidal Milling Sizing
  console.log('[1C] Testing CAMEngineAdapter (Trochoidal Toolpath)...');
  const trochReq = new JobRequest({
    domain: 'cam',
    operation: 'plan_trochoidal_toolpath',
    parameters: {
      toolOptions: camToolOptions,
      startPoint: [0, 0, -2],
      endPoint: [60, 0, -2],
      slotWidthMm: 16.0
    }
  });
  const trochRes = await camAdapter.execute(trochReq);
  assert.strictEqual(trochRes.status, JobStatus.SUCCEEDED);
  assert(trochRes.outputData.loopCount > 10);
  console.log(`  ✓ PASSED: Trochoidal milling generated ${trochRes.outputData.loopCount} circular trochoid loops\n`);

  // 1D. 5-Axis Simultaneous RTCP Toolpath
  console.log('[1D] Testing CAMEngineAdapter (5-Axis RTCP G43.4 Toolpath)...');
  const fiveAxisReq = new JobRequest({
    domain: 'cam',
    operation: 'plan_5axis_toolpath',
    parameters: {
      toolOptions: camToolOptions,
      toolpathPoints: [
        { x: 0, y: 0, z: 10, i: 0, j: 0, k: 1 },
        { x: 20, y: 10, z: 8, i: 0.1, j: 0.05, k: 0.9937 },
        { x: 40, y: 20, z: 6, i: 0.15, j: 0.1, k: 0.9836 }
      ]
    }
  });
  const fiveAxisRes = await camAdapter.execute(fiveAxisReq);
  assert.strictEqual(fiveAxisRes.status, JobStatus.SUCCEEDED);
  assert(fiveAxisRes.outputData.gcode.includes('G43.4'));
  assert(fiveAxisRes.outputData.rtcpActive === true);
  console.log(`  ✓ PASSED: 5-Axis RTCP post-processor produced G43.4 toolpath for ${fiveAxisRes.outputData.pointCount} points\n`);

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
  console.log(
    `  ✓ PASSED: Vacuum Thrust = ${(perfRes.outputData.thrustVacuumN / 1e3).toFixed(1)} kN, Isp = ${perfRes.outputData.ispVacuumS.toFixed(1)} s\n`
  );

  console.log('================================================================');
  console.log('   ALL CAM & AEROSPACE DOMAIN ENGINE ADAPTER TESTS PASSED!      ');
  console.log('================================================================\n');
})();
