'use strict';

const assert = require('assert');
const { defaultEngineRegistry } = require('../src/core/contracts/engine_registry');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');

(async () => {
  console.log('================================================================');
  console.log('       TESTING UNIFIED CENTRAL ENGINE REGISTRY                  ');
  console.log('================================================================\n');

  const domains = defaultEngineRegistry.listRegisteredDomains();
  console.log(`Registered domains (${domains.length}):`, domains.join(', '));
  assert.strictEqual(domains.length, 9);
  assert(domains.includes('cad'));
  assert(domains.includes('cae'));
  assert(domains.includes('cfd'));
  assert(domains.includes('controls'));
  assert(domains.includes('eda'));
  assert(domains.includes('optics'));
  assert(domains.includes('plant'));
  assert(domains.includes('cam'));
  assert(domains.includes('aerospace'));

  const allCaps = defaultEngineRegistry.describeAllCapabilities();
  for (const domain of domains) {
    assert(allCaps[domain], `Capabilities must exist for domain ${domain}`);
    assert(allCaps[domain].supportedOperations.length > 0, `Supported operations must exist for ${domain}`);
  }
  console.log('  ✓ PASSED: All 9 domain capabilities verified\n');

  // Test dispatching a CAD evaluation job through registry
  console.log('[Dispatch] Testing CAD job dispatch...');
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

  const cadRes = await defaultEngineRegistry.dispatch(cadReq);
  assert.strictEqual(cadRes.status, JobStatus.SUCCEEDED);
  assert(cadRes.outputData.point, 'Must return point from CAD dispatch');
  console.log(`  ✓ PASSED: CAD job dispatched successfully via registry\n`);

  // Test dispatching an EDA SPICE job through registry
  console.log('[Dispatch] Testing EDA job dispatch...');
  const edaReq = new JobRequest({
    domain: 'eda',
    operation: 'simulate_spice_dc',
    parameters: {
      components: [
        { type: 'V', id: 'V1', nPlus: '1', nMinus: '0', dcValue: 12.0 },
        { type: 'R', id: 'R1', n1: '1', n2: '2', value: 2000.0 },
        { type: 'R', id: 'R2', n1: '2', n2: '0', value: 4000.0 }
      ]
    }
  });

  const edaRes = await defaultEngineRegistry.dispatch(edaReq);
  assert.strictEqual(edaRes.status, JobStatus.SUCCEEDED);
  assert.strictEqual(Math.round(edaRes.outputData.nodeVoltages['2']), 8); // 12V * (4/(2+4)) = 8V
  console.log(`  ✓ PASSED: EDA job dispatched successfully via registry: V(2) = ${edaRes.outputData.nodeVoltages['2']} V\n`);

  console.log('================================================================');
  console.log('   ALL ENGINE REGISTRY DISPATCH TESTS PASSED!                   ');
  console.log('================================================================\n');
})();
