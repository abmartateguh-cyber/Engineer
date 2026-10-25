'use strict';

const assert = require('assert');
const { GeometryEngineAdapter } = require('../src/core/cad/geometry_engine_adapter');
const { FEAEngineAdapter } = require('../src/core/cae/fea_engine_adapter');
const { CFDEngineAdapter } = require('../src/core/cae/cfd_engine_adapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');

console.log('================================================================');
console.log('       TESTING DOMAIN ENGINE ADAPTERS (CAD, CAE, CFD)           ');
console.log('================================================================\n');

(async () => {
  // 1. GeometryEngineAdapter
  console.log('[1] Testing GeometryEngineAdapter (CAD)...');
  const cadAdapter = new GeometryEngineAdapter();
  const cadCaps = cadAdapter.describeCapabilities();
  assert.strictEqual(cadCaps.domain, 'cad');
  assert(cadCaps.supportedOperations.includes('evaluate_nurbs'));
  assert(cadCaps.supportedOperations.includes('export_step'));

  // Test NURBS evaluation
  const cadReq = new JobRequest({
    domain: 'cad',
    operation: 'evaluate_nurbs',
    parameters: {
      surface: {
        controlPoints: [
          [[0, 0, 0], [10, 0, 2], [20, 0, 0]],
          [[0, 10, 2], [10, 10, 8], [20, 10, 2]],
          [[0, 20, 0], [10, 20, 2], [20, 20, 0]]
        ],
        degreeU: 2,
        degreeV: 2
      },
      u: 0.5,
      v: 0.5
    }
  });

  const cadEvents = [];
  const cadResult = await cadAdapter.execute(cadReq, (e) => cadEvents.push(e));
  assert.strictEqual(cadResult.status, JobStatus.SUCCEEDED);
  assert(cadResult.outputData.point, 'Output must include evaluated 3D point');
  assert(cadEvents.length >= 2, 'Events must include STARTED and COMPLETED');
  console.log(`  ✓ PASSED: CAD NURBS evaluated at [${cadResult.outputData.point.x.toFixed(2)}, ${cadResult.outputData.point.y.toFixed(2)}, ${cadResult.outputData.point.z.toFixed(2)}]\n`);

  // 2. FEAEngineAdapter
  console.log('[2] Testing FEAEngineAdapter (CAE)...');
  const feaAdapter = new FEAEngineAdapter();
  const feaCaps = feaAdapter.describeCapabilities();
  assert.strictEqual(feaCaps.domain, 'cae');
  assert(feaCaps.supportedOperations.includes('linear_elastic_3d'));

  // Simple 4-node tetrahedron loaded in tension
  const feaReq = new JobRequest({
    domain: 'cae',
    operation: 'linear_elastic_3d',
    parameters: {
      nodes: [
        { x: 0, y: 0, z: 0, fixed: [true, true, true] },
        { x: 10, y: 0, z: 0, fixed: [true, true, true] },
        { x: 5, y: 10, z: 0, fixed: [true, true, true] },
        { x: 5, y: 5, z: 10, force: [0, 0, 5000] }
      ],
      elements: [
        {
          nodes: [0, 1, 2, 3],
          material: { E: 70e9, nu: 0.33, yieldStress: 270e6, name: 'Al 6061-T6' }
        }
      ]
    }
  });

  const feaEvents = [];
  const feaResult = await feaAdapter.execute(feaReq, (e) => feaEvents.push(e));
  assert.strictEqual(feaResult.status, JobStatus.SUCCEEDED);
  assert(feaResult.outputData.maxStress > 0, 'Max von Mises stress must be positive');
  assert(feaResult.outputData.safetyFactor > 0, 'Safety factor must be positive');
  console.log(`  ✓ PASSED: FEA solved. Max Stress = ${(feaResult.outputData.maxStress / 1e6).toFixed(2)} MPa, SF = ${feaResult.outputData.safetyFactor.toFixed(2)}\n`);

  // 3. CFDEngineAdapter
  console.log('[3] Testing CFDEngineAdapter (CFD)...');
  const cfdAdapter = new CFDEngineAdapter();
  const cfdCaps = cfdAdapter.describeCapabilities();
  assert.strictEqual(cfdCaps.domain, 'cfd');
  assert(cfdCaps.supportedOperations.includes('fvm_navier_stokes_3d'));

  const cfdReq = new JobRequest({
    domain: 'cfd',
    operation: 'fvm_navier_stokes_3d',
    parameters: {
      nx: 6,
      ny: 6,
      nz: 4,
      inletVelocity: 12.0,
      steps: 6
    }
  });

  const cfdEvents = [];
  const cfdResult = await cfdAdapter.execute(cfdReq, (e) => cfdEvents.push(e));
  assert.strictEqual(cfdResult.status, JobStatus.SUCCEEDED);
  assert(cfdResult.outputData.cellCount > 0, 'Cell count must be positive');
  assert(cfdResult.outputData.convergenceHistory.length > 0, 'Convergence history must be recorded');
  console.log(`  ✓ PASSED: CFD solved over ${cfdResult.outputData.cellCount} cells across ${cfdResult.outputData.stepCount} steps\n`);

  console.log('================================================================');
  console.log('   ALL DOMAIN ENGINE ADAPTER TESTS PASSED!                      ');
  console.log('================================================================\n');
})();
