'use strict';

const assert = require('assert');
const { PlantEngineAdapter } = require('../src/core/plant/plant_engine_adapter');
const { PengRobinsonEOS } = require('../src/core/plant/peng_robinson_eos');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');
const { getExperimentalPengRobinsonComponents } = require('./support/experimental_property_examples');

(async () => {
  console.log('================================================================');
  console.log('       TESTING PLANT & PROCESS ENGINEERING ENGINE ADAPTER       ');
  console.log('================================================================\n');

  const adapter = new PlantEngineAdapter();
  const caps = adapter.describeCapabilities();
  assert.strictEqual(caps.domain, 'plant');
  assert(caps.supportedOperations.includes('solve_vle_flash'));
  assert(caps.supportedOperations.includes('calculate_nrtl_activity'));
  assert(!caps.supportedOperations.includes('solve_distillation_mesh'));
  assert(caps.supportedOperations.includes('calculate_water_hammer'));
  await assert.rejects(
    adapter.execute(new JobRequest({ domain: 'plant', operation: 'solve_distillation_mesh' })),
    (error) => error.code === 'UNSUPPORTED'
  );

  const missingFlashInputs = new JobRequest({ domain: 'plant', operation: 'solve_vle_flash' });
  await assert.rejects(
    adapter.execute(missingFlashInputs),
    (error) => error.code === 'INVALID_INPUT' && /components/.test(error.message)
  );
  const missingPropertyRecords = new JobRequest({
    domain: 'plant',
    operation: 'generate_vle_envelope',
    parameters: { composition: { methane: 1 }, pMinBar: 1, pMaxBar: 2, points: 2, tMinC: -40, tMaxC: 160 }
  });
  await assert.rejects(
    adapter.execute(missingPropertyRecords),
    (error) => error.code === 'INVALID_INPUT' && /componentProperties/.test(error.message)
  );
  assert.throws(() => new PengRobinsonEOS(['Methane'], [[0]]), /property record/);
  assert.throws(
    () => new PengRobinsonEOS(getExperimentalPengRobinsonComponents(['Methane'])),
    /explicit 1x1 binary interaction matrix/
  );
  const methaneEos = new PengRobinsonEOS(getExperimentalPengRobinsonComponents(['Methane']), [[0]]);
  assert.throws(() => methaneEos.flashPT([1], 190, 1e5), /explicit positive maxIter and tol solver controls/);

  // 1. Multicomponent VLE Flash via Peng-Robinson 1978 EOS
  console.log('[1] Testing Peng-Robinson PT Flash (Methane/Ethane/Propane)...');
  const flashReq = new JobRequest({
    domain: 'plant',
    operation: 'solve_vle_flash',
    parameters: {
      components: getExperimentalPengRobinsonComponents(['Methane', 'Ethane', 'Propane']),
      k_ij: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      feedComposition: [0.3, 0.4, 0.3],
      temperatureK: 240.0,
      pressurePa: 3.5e6, // 35 bar
      maxIter: 60,
      tol: 1e-6
    }
  });

  const flashRes = await adapter.execute(flashReq);
  assert.strictEqual(flashRes.status, JobStatus.SUCCEEDED);
  assert.strictEqual(flashRes.outputData.converged, true);
  assert.strictEqual(flashRes.outputData.phaseState, 'liquid-only');
  assert(
    flashRes.convergenceHistory.some((entry) => entry.status === 'single-phase-classified'),
    'Convergence history must include the final single-phase classification after its iterative rows.'
  );
  assert(flashRes.warnings.some((warning) => warning.includes('unverified engineering data')));
  assert(
    flashRes.outputData.vaporFraction >= 0 && flashRes.outputData.vaporFraction <= 1,
    'Vapor fraction must be in [0, 1]'
  );
  const sumX = flashRes.outputData.liquidComposition.reduce((a, b) => a + b, 0);
  const sumY = flashRes.outputData.vaporComposition.reduce((a, b) => a + b, 0);
  assert(Math.abs(sumX - 1.0) < 0.05, `Liquid mole fractions must sum to 1, got ${sumX}`);
  assert(Math.abs(sumY - 1.0) < 0.05, `Vapor mole fractions must sum to 1, got ${sumY}`);
  console.log(
    `  ✓ PASSED: PR-78 Flash solved. Vapor fraction β = ${flashRes.outputData.vaporFraction}, Z_L = ${flashRes.outputData.compressibilityLiquid}, Z_V = ${flashRes.outputData.compressibilityVapor}\n`
  );

  const nonConvergedFlash = new JobRequest({
    domain: 'plant',
    operation: 'solve_vle_flash',
    parameters: {
      components: getExperimentalPengRobinsonComponents(['Methane', 'Ethane', 'Propane']),
      k_ij: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      feedComposition: [0.5, 0.3, 0.2],
      temperatureK: 200,
      pressurePa: 2e6,
      maxIter: 1,
      tol: 1e-20
    }
  });
  await assert.rejects(
    adapter.execute(nonConvergedFlash),
    (error) => error.code === 'NUMERICAL_FAILURE' && error.details.residual > error.details.tolerance
  );

  // 2. NRTL Liquid Activity Coefficients
  console.log('[2] Testing NRTL Activity Coefficients...');
  const nrtlReq = new JobRequest({
    domain: 'plant',
    operation: 'calculate_nrtl_activity',
    parameters: {
      liquidComposition: [0.4, 0.6],
      temperatureK: 323.15, // 50°C
      delta_g: [
        [0.0, 2500.0],
        [1800.0, 0.0]
      ],
      alpha: [
        [0.0, 0.3],
        [0.3, 0.0]
      ]
    }
  });

  const nrtlRes = await adapter.execute(nrtlReq);
  assert.strictEqual(nrtlRes.status, JobStatus.SUCCEEDED);
  assert(nrtlRes.outputData.activityCoefficients.length === 2);
  assert(
    nrtlRes.outputData.activityCoefficients.every((g) => g > 0),
    'Activity coefficients must be positive'
  );
  console.log(`  ✓ PASSED: NRTL activity coefficients: γ = [${nrtlRes.outputData.activityCoefficients.join(', ')}]\n`);

  // 3. Explicit-input Korteweg wave speed and Joukowsky surge
  console.log('[3] Testing Water Hammer Hydraulic Surge...');
  const surgeReq = new JobRequest({
    domain: 'plant',
    operation: 'calculate_water_hammer',
    parameters: {
      fluidDensity: 998.2,
      fluidBulkModulus: 2.19e9,
      pipeElasticModulus: 2.0e11, // Carbon Steel
      pipeDiameter: 0.3, // 300 mm
      pipeWallThickness: 0.008, // 8 mm
      restraintFactor: 1.0,
      steadyVelocity: 2.5, // 2.5 m/s
      runMOC: false
    }
  });

  const surgeRes = await adapter.execute(surgeReq);
  assert.strictEqual(surgeRes.status, JobStatus.SUCCEEDED);
  // Carbon steel water pipe wave speed is typically ~1100-1250 m/s
  const a = surgeRes.outputData.waveSpeedMs;
  assert(a > 1000 && a < 1400, `Expected Korteweg speed ~1100-1250 m/s, got ${a}`);
  assert(surgeRes.outputData.joukowskySurgePressurePa > 2e6, 'Surge pressure must be > 2 MPa');
  console.log(
    `  ✓ PASSED: Water hammer acoustic wave speed = ${a} m/s, Joukowsky surge ΔP = ${(surgeRes.outputData.joukowskySurgePressurePa / 1e6).toFixed(2)} MPa\n`
  );

  console.log('================================================================');
  console.log('   ALL PLANT & PROCESS ENGINE ADAPTER TESTS PASSED!             ');
  console.log('================================================================\n');
})();
