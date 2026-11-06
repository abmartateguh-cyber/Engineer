'use strict';

const assert = require('assert');
const { defaultEngineRegistry } = require('../src/core/contracts/engine_registry');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');
const { ValidationMaturity } = require('../src/core/contracts/ValidationRecord');
const { getFeatureMaturity } = require('../src/core/maturity/feature_maturity');

async function runEngineRegistryTests() {
  console.log('================================================================');
  console.log('       TESTING UNIFIED CENTRAL ENGINE REGISTRY                  ');
  console.log('================================================================\n');

  const results = [];
  async function runCase(name, fn) {
    try {
      await fn();
      results.push({ ok: true });
    } catch (err) {
      results.push({ ok: false });
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  await runCase('Registered domain capabilities remain experimental', async () => {
    const domains = defaultEngineRegistry.listRegisteredDomains();
    console.log(`Registered domains (${domains.length}):`, domains.join(', '));
    assert.deepStrictEqual(
      [...domains].sort(),
      ['cad', 'cae', 'cfd', 'controls', 'eda', 'optics', 'plant', 'cam', 'aerospace', 'pdm', 'hpc', 'robotics'].sort()
    );

    const allCaps = defaultEngineRegistry.describeAllCapabilities();
    for (const domain of domains) {
      assert(allCaps[domain], `Capabilities must exist for domain ${domain}`);
      assert(allCaps[domain].supportedOperations.length > 0, `Supported operations must exist for ${domain}`);
      assert.strictEqual(
        allCaps[domain].maturity,
        ValidationMaturity.EXPERIMENTAL,
        `${domain} adapter must remain experimental until its own independent validation evidence exists`
      );
      assert.strictEqual(getFeatureMaturity(domain).state, 'experimental');
      assert.strictEqual(getFeatureMaturity(domain).releaseApproved, false);
    }
    console.log(`  ✓ PASSED: All ${domains.length} registered domain capabilities are experimental`);
  });

  // Test dispatching a CAD evaluation job through registry
  await runCase('[Dispatch] CAD job dispatch', async () => {
    console.log('[Dispatch] Testing CAD job dispatch...');
    const cadReq = new JobRequest({
      domain: 'cad',
      operation: 'evaluate_nurbs',
      parameters: {
        surface: {
          controlPoints: [
            [
              [0, 0, 0],
              [10, 0, 2],
              [20, 0, 0]
            ],
            [
              [0, 10, 2],
              [10, 10, 8],
              [20, 10, 2]
            ],
            [
              [0, 20, 0],
              [10, 20, 2],
              [20, 20, 0]
            ]
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
    console.log('  ✓ PASSED: CAD job dispatched successfully via registry');
  });

  // Test dispatching an EDA SPICE job through registry
  await runCase('[Dispatch] EDA job dispatch', async () => {
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
    console.log(
      `  ✓ PASSED: EDA job dispatched successfully via registry: V(2) = ${edaRes.outputData.nodeVoltages['2']} V`
    );
  });

  // Test dispatching a Plant steam properties job through registry
  await runCase('[Dispatch] Plant job dispatch', async () => {
    console.log('[Dispatch] Testing Plant job dispatch...');
    const plantReq = new JobRequest({
      domain: 'plant',
      operation: 'calculate_steam_properties',
      parameters: {
        pressurePa: 101325,
        temperatureK: 373.15
      }
    });
    const plantRes = await defaultEngineRegistry.dispatch(plantReq);
    assert.strictEqual(plantRes.status, JobStatus.SUCCEEDED);
    assert(
      plantRes.outputData.specificEnthalpy_J_kg !== undefined,
      'Must return specific enthalpy from Plant dispatch'
    );
    console.log(
      `  ✓ PASSED: Plant job dispatched successfully via registry: h = ${plantRes.outputData.specificEnthalpy_J_kg.toFixed(1)} J/kg`
    );
  });

  // Test dispatching a Controls EKF job through registry
  await runCase('[Dispatch] Controls job dispatch', async () => {
    console.log('[Dispatch] Testing Controls job dispatch...');
    const controlsReq = new JobRequest({
      domain: 'controls',
      operation: 'estimate_ekf',
      parameters: {
        dt: 0.01,
        gyro: [0, 0, 0],
        accel: [0, 0, -9.80665],
        recordTrajectory: true
      }
    });
    const controlsRes = await defaultEngineRegistry.dispatch(controlsReq);
    assert.strictEqual(controlsRes.status, JobStatus.SUCCEEDED);
    assert(controlsRes.outputData.finalState, 'Must return estimated finalState from Controls dispatch');
    console.log('  ✓ PASSED: Controls job dispatched successfully via registry');
  });

  // Test dispatching a Robotics kinematics job through registry
  await runCase('[Dispatch] Robotics job dispatch', async () => {
    console.log('[Dispatch] Testing Robotics job dispatch...');
    const roboticsReq = new JobRequest({
      domain: 'robotics',
      operation: 'forward_kinematics',
      parameters: {
        dhTable: [
          { a: 1, alpha: 0, d: 0 },
          { a: 1, alpha: 0, d: 0 }
        ],
        q: [0, 0]
      }
    });
    const roboticsRes = await defaultEngineRegistry.dispatch(roboticsReq);
    assert.strictEqual(roboticsRes.status, JobStatus.SUCCEEDED);
    assert(roboticsRes.outputData.position, 'Must return position from Robotics dispatch');
    console.log(
      `  ✓ PASSED: Robotics job dispatched successfully via registry: x = ${roboticsRes.outputData.position.x.valueSi} m`
    );
  });

  // Test dispatching an HPC out-of-core plan job through registry
  await runCase('[Dispatch] HPC job dispatch', async () => {
    console.log('[Dispatch] Testing HPC job dispatch...');
    const hpcReq = new JobRequest({
      domain: 'hpc',
      operation: 'plan_out_of_core',
      parameters: {
        dofCount: 1000000,
        availableRamBytes: 8 * 1024 * 1024 * 1024,
        assumptions: { matrixNonzerosPerDof: 10, factorEntriesPerDof: 30 }
      }
    });
    const hpcRes = await defaultEngineRegistry.dispatch(hpcReq);
    assert.strictEqual(hpcRes.status, JobStatus.SUCCEEDED);
    assert(hpcRes.outputData.chunkSizeDofs, 'Must return chunkSizeDofs from HPC dispatch');
    assert.strictEqual(hpcRes.outputData.status, 'ESTIMATE_ONLY');
    assert.strictEqual(hpcRes.outputData.isOutOfCore, null);
    console.log(`  ✓ PASSED: HPC job dispatched successfully via registry: chunks = ${hpcRes.outputData.totalChunks}`);
  });

  // Test dispatching a PDM BOM rollup job through registry
  await runCase('[Dispatch] PDM job dispatch', async () => {
    console.log('[Dispatch] Testing PDM job dispatch...');
    const pdmReq = new JobRequest({
      domain: 'pdm',
      operation: 'compute_bom_rollup',
      parameters: {
        rootAssembly: {
          partNumber: 'ASSY-001',
          name: 'Gearbox Housing',
          quantity: 1,
          unitMassKg: 5.0,
          unitCostUsd: 120.0,
          children: [
            { partNumber: 'PART-001', name: 'Bolt M8', quantity: 6, unitCostUsd: 0.5, unitMassKg: 0.02 },
            { partNumber: 'PART-002', name: 'Flange Plate', quantity: 1, unitCostUsd: 45.0, unitMassKg: 3.5 }
          ]
        }
      }
    });
    const pdmRes = await defaultEngineRegistry.dispatch(pdmReq);
    assert.strictEqual(pdmRes.status, JobStatus.SUCCEEDED);
    assert(pdmRes.outputData.rollup, 'Must return rollup from PDM dispatch');
    assert.strictEqual(pdmRes.outputData.rollup.totalPartCount, 7);
    assert.ok(Math.abs(pdmRes.outputData.rollup.rolledUpMassKg - 8.62) < 1e-9);
    console.log(
      `  ✓ PASSED: PDM job dispatched successfully via registry: totalParts = ${pdmRes.outputData.rollup.totalPartCount}, mass = ${pdmRes.outputData.rollup.rolledUpMassKg.toFixed(2)} kg`
    );
  });

  // Test dispatching a CAE structural job through registry
  await runCase('[Dispatch] CAE job dispatch', async () => {
    console.log('[Dispatch] Testing CAE job dispatch...');
    const caeReq = new JobRequest({
      domain: 'cae',
      operation: 'linear_elastic_3d',
      parameters: {
        nodes: [
          { x: 0, y: 0, z: 0, fixed: [true, true, true] },
          { x: 10, y: 0, z: 0, fixed: [true, true, true] },
          { x: 0, y: 10, z: 0, fixed: [true, true, true] },
          { x: 0, y: 0, z: 10, force: [0, -5000, 0] }
        ],
        elements: [{ nodeIds: [0, 1, 2, 3], material: { E: 200e9, nu: 0.3, yieldStress: 250e6 } }]
      }
    });
    const caeRes = await defaultEngineRegistry.dispatch(caeReq);
    assert.strictEqual(caeRes.status, JobStatus.SUCCEEDED);
    assert(caeRes.outputData.maxStress > 0, 'Must return positive maxStress from CAE dispatch');
    console.log(
      `  ✓ PASSED: CAE job dispatched successfully via registry: maxStress = ${(caeRes.outputData.maxStress / 1e6).toFixed(4)} MPa`
    );
  });

  // Test dispatching a CFD job through registry
  await runCase('[Dispatch] CFD job dispatch', async () => {
    console.log('[Dispatch] Testing CFD job dispatch...');
    const cfdReq = new JobRequest({
      domain: 'cfd',
      operation: 'fvm_navier_stokes_3d',
      parameters: {
        nx: 4,
        ny: 4,
        nz: 4,
        lx: 0.5,
        ly: 0.5,
        lz: 0.5,
        steps: 3,
        inletVelocity: 10.0
      }
    });
    const cfdRes = await defaultEngineRegistry.dispatch(cfdReq);
    assert.strictEqual(cfdRes.status, JobStatus.SUCCEEDED);
    assert(cfdRes.outputData.cellCount > 0, 'Must return cellCount from CFD dispatch');
    console.log(`  ✓ PASSED: CFD job dispatched successfully via registry: cells = ${cfdRes.outputData.cellCount}`);
  });

  // Test dispatching a CAM toolpath job through registry
  await runCase('[Dispatch] CAM job dispatch', async () => {
    console.log('[Dispatch] Testing CAM job dispatch...');
    const camReq = new JobRequest({
      domain: 'cam',
      operation: 'plan_roughing_toolpath',
      parameters: {
        bounds: { minX: 0, maxX: 50, minY: 0, maxY: 50, minZ: 0, maxZ: 10 },
        toolOptions: {
          toolDiameter: 10,
          toolType: 'flat_endmill',
          spindleRpm: 8000,
          feedRateMmMin: 1200,
          plungeRateMmMin: 300,
          stepoverMm: 4,
          stepdownMm: 2.5,
          safeZ: 15
        }
      }
    });
    const camRes = await defaultEngineRegistry.dispatch(camReq);
    assert.strictEqual(camRes.status, JobStatus.SUCCEEDED);
    assert(camRes.outputData.layers && camRes.outputData.layers.length > 0, 'Must return layers from CAM dispatch');
    console.log(
      `  ✓ PASSED: CAM job dispatched successfully via registry: layers = ${camRes.outputData.layers.length}`
    );
  });

  // Test dispatching an Optics refractive index job through registry
  await runCase('[Dispatch] Optics job dispatch', async () => {
    console.log('[Dispatch] Testing Optics job dispatch...');
    const opticsReq = new JobRequest({
      domain: 'optics',
      operation: 'calculate_refractive_index',
      parameters: {
        glass: 'FusedSilica',
        wavelengthUm: 0.58756,
        temperatureC: 20,
        customGlassRecord: {
          name: 'FusedSilica',
          formula: 'sellmeier1',
          referenceTemperatureC: 20,
          B: [0.6961663, 0.4079426, 0.8974794],
          C: [0.0684043 ** 2, 0.1162414 ** 2, 9.896161 ** 2],
          dndTPerK: 1.28e-5
        }
      }
    });
    const opticsRes = await defaultEngineRegistry.dispatch(opticsReq);
    assert.strictEqual(opticsRes.status, JobStatus.SUCCEEDED);
    assert(opticsRes.outputData.refractiveIndex > 1.0, 'Must return refractiveIndex > 1.0 from Optics dispatch');
    console.log(
      `  ✓ PASSED: Optics job dispatched successfully via registry: n = ${opticsRes.outputData.refractiveIndex}`
    );
  });

  // Test dispatching an Aerospace combustion job through registry
  await runCase('[Dispatch] Aerospace job dispatch', async () => {
    console.log('[Dispatch] Testing Aerospace job dispatch...');
    const aeroReq = new JobRequest({
      domain: 'aerospace',
      operation: 'evaluate_combustion',
      parameters: {
        propellantType: 'LOX_LCH4',
        chamberPressureBar: 100.0,
        ofRatio: 3.4
      }
    });
    const aeroRes = await defaultEngineRegistry.dispatch(aeroReq);
    assert.strictEqual(aeroRes.status, JobStatus.SUCCEEDED);
    assert(aeroRes.outputData.chamberTemperatureK > 0, 'Must return chamberTemperatureK from Aerospace dispatch');
    console.log(
      `  ✓ PASSED: Aerospace job dispatched successfully via registry: Tc = ${aeroRes.outputData.chamberTemperatureK.toFixed(1)} K`
    );
  });

  const total = results.length;
  const failed = results.filter((r) => !r.ok).length;
  const passed = total - failed;
  console.log('================================================================');
  console.log(`   ENGINE REGISTRY SUMMARY: ${passed}/${total} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');
  return { total, passed, failed };
}

if (require.main === module) {
  runEngineRegistryTests()
    .then((stats) => {
      if (stats.failed > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { runEngineRegistryTests };
