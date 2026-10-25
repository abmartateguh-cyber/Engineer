'use strict';

const assert = require('assert');
const { EDAEngineAdapter } = require('../src/core/eda/eda_engine_adapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');

(async () => {
  console.log('================================================================');
  console.log('       TESTING EDA & ELECTRONICS ENGINE ADAPTER                 ');
  console.log('================================================================\n');

  const adapter = new EDAEngineAdapter();
  const caps = adapter.describeCapabilities();
  assert.strictEqual(caps.domain, 'eda');
  assert(caps.supportedOperations.includes('simulate_spice_dc'));
  assert(caps.supportedOperations.includes('static_timing_analysis'));
  assert(caps.supportedOperations.includes('extract_wire_parasitics'));
  assert(caps.supportedOperations.includes('run_drc'));

  // 1. SPICE DC Operating Point (Voltage Divider: V1 = 10V, R1 = 1k, R2 = 1k)
  console.log('[1] Testing SPICE DC Operating Point...');
  const dcReq = new JobRequest({
    domain: 'eda',
    operation: 'simulate_spice_dc',
    parameters: {
      components: [
        { type: 'V', id: 'V1', nPlus: '1', nMinus: '0', dcValue: 10.0 },
        { type: 'R', id: 'R1', n1: '1', n2: '2', value: 1000.0 },
        { type: 'R', id: 'R2', n1: '2', n2: '0', value: 1000.0 }
      ]
    }
  });

  const dcRes = await adapter.execute(dcReq);
  assert.strictEqual(dcRes.status, JobStatus.SUCCEEDED);
  assert(dcRes.outputData.converged, 'DC solver must converge');
  assert.strictEqual(Math.round(dcRes.outputData.nodeVoltages['1']), 10);
  assert.strictEqual(Math.round(dcRes.outputData.nodeVoltages['2']), 5);
  console.log(`  ✓ PASSED: SPICE DC operating point solved: V(1)=${dcRes.outputData.nodeVoltages['1']}V, V(2)=${dcRes.outputData.nodeVoltages['2']}V\n`);

  // 2. Static Timing Analysis (Setup and Hold Verification)
  console.log('[2] Testing Static Timing Analysis (STA)...');
  const staReq = new JobRequest({
    domain: 'eda',
    operation: 'static_timing_analysis',
    parameters: {
      name: 'ALU_Accumulator_Path',
      clockPeriodNs: 4.0, // 250 MHz
      clockSkewNs: 0.05,
      tLaunchCqNs: 0.30,
      tSetupNs: 0.12,
      tHoldNs: 0.06,
      gateDelaysNs: [0.35, 0.40, 0.38],
      wireDelaysNs: [0.10, 0.15, 0.12]
    }
  });

  const staRes = await adapter.execute(staReq);
  assert.strictEqual(staRes.status, JobStatus.SUCCEEDED);
  assert(staRes.outputData.arrivalTimeNs > 0, 'Arrival time must be positive');
  assert(typeof staRes.outputData.setupSlackNs === 'number', 'Setup slack must be calculated');
  assert(staRes.outputData.maxAchievableFrequencyMHz > 100, 'Max frequency must exceed 100 MHz');
  console.log(`  ✓ PASSED: STA path evaluated. Slack: ${staRes.outputData.setupSlackNs}ns, Max Freq: ${staRes.outputData.maxAchievableFrequencyMHz} MHz\n`);

  // 3. Interconnect Parasitic Extraction (PEX)
  console.log('[3] Testing Interconnect Parasitic Extraction...');
  const pexReq = new JobRequest({
    domain: 'eda',
    operation: 'extract_wire_parasitics',
    parameters: {
      lengthMm: 2.0,
      widthUm: 1.5,
      thicknessUm: 0.6,
      dielectricHeightUm: 1.2,
      dielectricConstant: 3.9
    }
  });

  const pexRes = await adapter.execute(pexReq);
  assert.strictEqual(pexRes.status, JobStatus.SUCCEEDED);
  assert(pexRes.outputData.resistanceOhms > 0, 'Resistance must be positive');
  assert(pexRes.outputData.capacitancePf > 0, 'Capacitance must be positive');
  console.log(`  ✓ PASSED: Parasitics extracted: R=${pexRes.outputData.resistanceOhms}Ω, C=${pexRes.outputData.capacitancePf}pF\n`);

  // 4. Physical DRC Screening
  console.log('[4] Testing Physical DRC Screening...');
  const drcReq = new JobRequest({
    domain: 'eda',
    operation: 'run_drc',
    parameters: {
      shapes: [
        { id: 'rect1', layer: 'metal1', x: 0, y: 0, w: 10, h: 5 },
        { id: 'rect2', layer: 'metal1', x: 20, y: 0, w: 10, h: 5 }
      ],
      rules: {
        minWidth: 2,
        minSpacing: 4,
        minArea: 8
      }
    }
  });

  const drcRes = await adapter.execute(drcReq);
  assert.strictEqual(drcRes.status, JobStatus.SUCCEEDED);
  assert.strictEqual(drcRes.outputData.success, true);
  assert.strictEqual(drcRes.outputData.violations.length, 0);
  console.log(`  ✓ PASSED: DRC screening clean across ${drcReq.parameters.shapes.length} layout geometries\n`);

  console.log('================================================================');
  console.log('   ALL EDA ENGINE ADAPTER TESTS PASSED!                         ');
  console.log('================================================================\n');
})();
