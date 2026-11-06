'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 11).
 *
 * Focused checks for uncovered branches in the domain engine adapters:
 * robotics, aerospace, plant, optics, controls, PDM, geometry, and EDA.
 * Each check drives explicit validation failures, fallback defaults, and a
 * small number of successful execution paths.
 */

const assert = require('assert');

const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { AerospaceEngineAdapter } = require('../src/core/aerospace/aerospace_engine_adapter');
const { NasaRocketPropulsion } = require('../src/core/aerospace/nasa_rocket_propulsion');
const { PlantEngineAdapter } = require('../src/core/plant/plant_engine_adapter');
const { OpticsEngineAdapter } = require('../src/core/optics/optics_engine_adapter');
const { ControlsEngineAdapter } = require('../src/core/controls/controls_engine_adapter');
const { PDMEngineAdapter } = require('../src/core/pdm/pdm_engine_adapter');
const { GeometryEngineAdapter } = require('../src/core/cad/geometry_engine_adapter');
const { EDAEngineAdapter } = require('../src/core/eda/eda_engine_adapter');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');

async function runBranchGapElevenCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const pending = [];

  function check(name, fn) {
    totalTests++;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        pending.push(
          Promise.resolve(result).then(
            () => {
              passedTests++;
              console.log(`  ✓ PASSED: ${name}`);
            },
            (err) => {
              failedTests++;
              console.error(`  ✗ FAILED: ${name}`);
              console.error(`    ${err.message}`);
            }
          )
        );
        return;
      }
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  const rejects = async (fn, regex) => {
    try {
      await fn();
    } catch (err) {
      assert.match(String(err.message || err), regex);
      return;
    }
    throw new Error(`expected rejection matching ${regex}, but no error was thrown`);
  };

  const rocket = new NasaRocketPropulsion();
  const enginePerf = rocket.calculateEnginePerformance({
    propellantType: 'LOX_LCH4',
    chamberPressureBar: 100,
    ofRatio: 3.4,
    throatDiameterM: 0.1,
    expansionRatio: 10,
    ambientPressureBar: 1.01325
  });
  const coolantProps = {
    gasViscosityPaS: 8e-5,
    gasSpecificHeatJKgK: 1800,
    gasPrandtl: 0.9,
    bartzCorrectionFactor: 0.9,
    recoveryFactor: 0.9,
    throatRadiusOfCurvatureM: 0.2,
    coolantChannelCount: 20,
    channelWidthM: 0.002,
    channelHeightM: 0.002,
    wallThicknessM: 0.001,
    coolantInletTempK: 300,
    coolantMassFlowKgS: 10,
    coolantDensityKgM3: 800,
    coolantViscosityPaS: 1e-4,
    coolantSpecificHeatJKgK: 4200,
    coolantPrandtl: 6,
    coolantThermalConductivityWmK: 0.5,
    linerThermalConductivityWmK: 20,
    effectiveHeatTransferAreaM2: 0.2,
    coolantChannelLengthM: 0.5,
    inputSourceDescription: 'test fixture'
  };
  const pumpProps = {
    fuelDensityKgM3: 800,
    oxidizerDensityKgM3: 1140,
    fuelPumpEfficiency: 0.7,
    oxidizerPumpEfficiency: 0.7,
    injectorPressureDropPa: 2e6,
    oxidizerAdditionalPressureDropPa: 1e6,
    fuelPumpSpeedRPM: 30000,
    oxidizerPumpSpeedRPM: 30000,
    fuelImpellerTipSpeedM_s: 400,
    oxidizerImpellerTipSpeedM_s: 400,
    turbineEfficiency: 0.6,
    oxidizerTankPressurePa: 5e6,
    oxidizerVaporPressurePa: 1e5,
    oxidizerNpshRequiredM: 5,
    inputSourceDescription: 'test fixture'
  };

  check('RoboticsEngineAdapter validate rejects malformed requests', async () => {
    const adapter = new RoboticsEngineAdapter();
    await rejects(() => adapter.validate(null), /null request/);
    await rejects(
      () => adapter.validate({ domain: 'cad', operation: 'forward_kinematics', parameters: {} }),
      /Domain mismatch/
    );
    await rejects(() => adapter.validate({ domain: 'robotics', parameters: {} }), /valid string operation/);
    await rejects(
      () => adapter.validate({ domain: 'robotics', operation: 'bogus', parameters: {} }),
      /Unsupported robotics operation/
    );
  });

  check('RoboticsEngineAdapter validate FK manipulator error branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { dhTable: [], q: [] }
        }),
      /non-empty dhTable/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { dhTable: [null], q: [0] }
        }),
      /dhTable\[0\]/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { dhTable: [{ a: Number.NaN }], q: [0] }
        }),
      /non-finite kinematic parameters/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { dhTable: [{ a: 1 }], q: [0], qd: [1, 2] }
        }),
      /does not match DOF/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { preset: 'NOT_A_REAL_PRESET', q: [0, 0, 0, 0, 0, 0] }
        }),
      /Unsupported manipulator preset/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: {}
        }),
      /explicit manipulator specification/
    );
  });

  check('RoboticsEngineAdapter validate inverse kinematics branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: { dhTable: [{ a: 1 }], targetPose: undefined }
        }),
      /requires targetPose/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: { dhTable: [{ a: 1 }], targetPose: [1, 2] }
        }),
      /4x4 homogeneous transform/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: { dhTable: [{ a: 1 }], targetPose: { position: [1, 2] } }
        }),
      /targetPose.position/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: { poeConfig: { screwAxes: [[0, 0, 1, 0, 0, 0]], homeTransform: [] }, targetPose: [1, 2, 3] }
        }),
      /DH-parameterized/
    );
  });

  check('RoboticsEngineAdapter validate inverse dynamics branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'inverse_dynamics',
          parameters: { dhTable: [{ a: 1 }] }
        }),
      /requires 'q'/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'inverse_dynamics',
          parameters: {
            dhTable: [{ a: 1 }],
            q: [0],
            qd: [0],
            qdd: [0],
            linkDynamics: [],
            gravity: [0, 0, -9.81],
            fTip: [0, 0, 0, 0, 0, 0]
          }
        }),
      /linkDynamics/
    );
  });

  check('RoboticsEngineAdapter validate trajectory and URDF branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'trajectory_plan',
          parameters: { q0: [0, 0], qf: [1, 1], duration: 0 }
        }),
      /finite positive duration/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'parse_urdf',
          parameters: { urdf: 'not xml' }
        }),
      /missing <robot>/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'parse_urdf',
          parameters: { urdf: '<robot><joint name="j" type="weird"/></robot>' }
        }),
      /Unsupported URDF joint type/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'parse_urdf',
          parameters: { urdf: { joints: [{ type: 'bogus' }] } }
        }),
      /Unsupported URDF joint type/
    );
  });

  check('RoboticsEngineAdapter execute forward kinematics success', async () => {
    const adapter = new RoboticsEngineAdapter();
    const result = await adapter.execute({
      jobId: 'rob-fk-1',
      domain: 'robotics',
      operation: 'forward_kinematics',
      parameters: { preset: 'PUMA_560', q: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] }
    });
    assert.strictEqual(result.status, 'COMPLETED');
    assert.strictEqual(result.outputData.positionVector.length, 3);
  });

  check('AerospaceEngineAdapter validate operation branches', async () => {
    const adapter = new AerospaceEngineAdapter();
    await rejects(
      () => adapter.validate({ domain: 'aerospace', operation: 'regenerative_cooling', parameters: {} }),
      /regenerative_cooling/
    );
    await rejects(
      () => adapter.validate({ domain: 'aerospace', operation: 'turbopump_analysis', parameters: {} }),
      /turbopump_analysis/
    );
    await rejects(
      () => adapter.validate({ domain: 'aerospace', operation: 'compile_rocket_nozzle', parameters: {} }),
      /compile_rocket_nozzle/
    );
    await rejects(
      () => adapter.validate({ domain: 'aerospace', operation: 'run_aerospace_cfd', parameters: {} }),
      /run_aerospace_cfd/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'aerospace',
          operation: 'calculate_orbital_transfer',
          parameters: { r1Meters: 1e7, r2Meters: 1e6 }
        }),
      /calculate_orbital_transfer/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'aerospace',
          operation: 'calculate_orbital_transfer',
          parameters: { r1Meters: 1e7, r2Meters: 2e7, biElliptic: true, intermediateRadiusM: 1e7 }
        }),
      /intermediateRadiusM/
    );
  });

  check('AerospaceEngineAdapter execute success paths', async () => {
    const adapter = new AerospaceEngineAdapter();
    const perf = await adapter.execute({
      jobId: 'asco-perf-1',
      domain: 'aerospace',
      operation: 'calculate_engine_performance',
      parameters: {
        propellantType: 'LOX_LCH4',
        chamberPressureBar: 100,
        ofRatio: 3.4,
        throatDiameterM: 0.1,
        expansionRatio: 10,
        ambientPressureBar: 1.01325
      }
    });
    assert.strictEqual(perf.status, 'COMPLETED');
    assert(perf.outputData.thrustSeaLevelN > 0);

    const cooling = await adapter.execute({
      jobId: 'asco-cool-1',
      domain: 'aerospace',
      operation: 'regenerative_cooling',
      parameters: { enginePerf, coolantProps }
    });
    assert.strictEqual(cooling.status, 'COMPLETED');

    const tp = await adapter.execute({
      jobId: 'asco-tp-1',
      domain: 'aerospace',
      operation: 'turbopump_analysis',
      parameters: { enginePerf, coolingResult: { success: true, coolantPressureDropPa: 5e6 }, pumpProps }
    });
    assert.strictEqual(tp.status, 'COMPLETED');
  });

  check('PlantEngineAdapter validate operation branches', async () => {
    const adapter = new PlantEngineAdapter();
    await rejects(
      () => adapter.validate({ domain: 'plant', operation: 'solve_vle_flash', parameters: {} }),
      /solve_vle_flash/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'plant',
          operation: 'solve_vle_flash',
          parameters: {
            components: [],
            k_ij: [],
            temperatureK: 300,
            pressurePa: 1e5,
            maxIter: 50,
            tol: 1e-8,
            feedComposition: [1]
          }
        }),
      /non-empty components/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'plant',
          operation: 'solve_vle_flash',
          parameters: {
            components: ['A'],
            k_ij: [],
            temperatureK: 300,
            pressurePa: 1e5,
            maxIter: 50,
            tol: 1e-8,
            feedComposition: [1]
          }
        }),
      /component property records/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'plant',
          operation: 'solve_vle_flash',
          parameters: {
            components: [{ name: 'A' }],
            k_ij: [],
            temperatureK: 0,
            pressurePa: 1e5,
            maxIter: 50,
            tol: 1e-8,
            feedComposition: [1]
          }
        }),
      /positive temperature/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'plant',
          operation: 'solve_vle_flash',
          parameters: {
            components: [{ name: 'A' }],
            k_ij: [],
            temperatureK: 300,
            pressurePa: 1e5,
            maxIter: 50,
            tol: 1e-8,
            feedComposition: [0.5, 0.5]
          }
        }),
      /feed composition matching/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'plant',
          operation: 'solve_vle_flash',
          parameters: {
            components: [{ name: 'A' }, { name: 'B' }],
            k_ij: [],
            temperatureK: 300,
            pressurePa: 1e5,
            maxIter: 50,
            tol: 1e-8,
            feedComposition: [0.6, 0.5]
          }
        }),
      /sum to one/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'plant',
          operation: 'calculate_nrtl_activity',
          parameters: { liquidComposition: [0.5] }
        }),
      /calculate_nrtl_activity/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'plant',
          operation: 'solve_recycle_loop',
          parameters: { x0: 'nope' }
        }),
      /solve_recycle_loop/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'plant',
          operation: 'calculate_pinch_targets',
          parameters: { streams: 'nope' }
        }),
      /calculate_pinch_targets/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'plant',
          operation: 'simulate_dynamic_valve',
          parameters: {}
        }),
      /simulate_dynamic_valve/
    );
    await rejects(
      () =>
        adapter.validate({
          domain: 'plant',
          operation: 'simulate_dynamic_blowdown',
          parameters: {}
        }),
      /simulate_dynamic_blowdown/
    );
    await rejects(
      () => adapter.validate({ domain: 'plant', operation: 'solve_vle_flash', parameters: null }),
      /explicit parameter object/
    );
  });

  check('PlantEngineAdapter execute final paths', async () => {
    const adapter = new PlantEngineAdapter();
    const nrtl = await adapter.execute({
      jobId: 'plant-nrtl-1',
      domain: 'plant',
      operation: 'calculate_nrtl_activity',
      parameters: {
        liquidComposition: [0.4, 0.6],
        temperatureK: 350,
        delta_g: [
          [0, 500],
          [500, 0]
        ],
        alpha: [
          [0.3, 0.3],
          [0.3, 0.3]
        ]
      }
    });
    assert.strictEqual(nrtl.status, 'COMPLETED');
    assert.strictEqual(nrtl.outputData.activityCoefficients.length, 2);
  });

  check('OpticsEngineAdapter execute validation branches', async () => {
    const adapter = new OpticsEngineAdapter();
    await rejects(
      () => adapter.execute({ jobId: 'opt-1', domain: 'optics', operation: 'generate_pupil_rays', parameters: {} }),
      /pupil radius/
    );
    await rejects(
      () =>
        adapter.execute({
          jobId: 'opt-1',
          domain: 'optics',
          operation: 'generate_pupil_rays',
          parameters: {
            pupilRadiusMm: 10,
            numRings: 99,
            raysPerRing: 8,
            fieldAngleDeg: 0,
            wavelengthUm: 0.55,
            pupilPlaneZMm: -10
          }
        }),
      /Pupil ring count/
    );
    await rejects(
      () =>
        adapter.execute({
          jobId: 'opt-1',
          domain: 'optics',
          operation: 'generate_pupil_rays',
          parameters: {
            pupilRadiusMm: 10,
            numRings: 3,
            raysPerRing: 8,
            fieldAngleDeg: 90,
            wavelengthUm: 0.55,
            pupilPlaneZMm: -10
          }
        }),
      /Field angle/
    );
    await rejects(
      () =>
        adapter.execute({
          jobId: 'opt-1',
          domain: 'optics',
          operation: 'trace_skew_rays',
          parameters: {}
        }),
      /Supply between 1 and 128 optical surfaces/
    );
    await rejects(
      () =>
        adapter.execute({ jobId: 'opt-1', domain: 'optics', operation: 'calculate_refractive_index', parameters: {} }),
      /optical material name/
    );
    await rejects(
      () =>
        adapter.execute({
          jobId: 'opt-1',
          domain: 'optics',
          operation: 'calculate_refractive_index',
          parameters: { glass: 'BOGUS-GLASS', wavelengthUm: 0.55, temperatureC: 25 }
        }),
      /is unavailable|explicit material record/
    );
    await assert.doesNotReject(() =>
      adapter.execute({
        jobId: 'opt-1',
        domain: 'optics',
        operation: 'calculate_refractive_index',
        parameters: { glass: 'N-BK7', wavelengthUm: 0.55, temperatureC: 25 }
      })
    );
    await rejects(
      () =>
        adapter.execute({
          jobId: 'opt-1',
          domain: 'optics',
          operation: 'run_optical_tolerancing',
          parameters: {}
        }),
      /surfaces/
    );
    await rejects(
      () => adapter.execute({ jobId: 'opt-1', domain: 'optics', operation: 'bogus_op', parameters: {} }),
      /not supported/
    );
  });

  check('ControlsEngineAdapter execute state-space branches', async () => {
    const adapter = new ControlsEngineAdapter();
    await rejects(
      () => adapter.execute({ jobId: 'ctl-1', domain: 'controls', operation: 'solve_state_space', parameters: {} }),
      /State space requires A, B, C, D/
    );
    const result = await adapter.execute({
      jobId: 'ctl-1',
      domain: 'controls',
      operation: 'solve_state_space',
      parameters: {
        A: [
          [0, 1],
          [-1, -0.2]
        ],
        B: [[0], [1]],
        C: [[1, 0]],
        D: [[0]],
        initialX: [0, 0],
        tEnd: 1,
        dt: 0.25,
        u: [1]
      }
    });
    assert.strictEqual(result.status, 'COMPLETED');
    assert.strictEqual(result.outputData.time.length, 5);
  });

  check('PDMEngineAdapter validate and execute branches', async () => {
    const adapter = new PDMEngineAdapter();
    await rejects(
      () => adapter.validate({ domain: 'pdm', operation: 'where_used', parameters: null }),
      /parameter object/
    );
    await rejects(
      () => adapter.validate({ domain: 'pdm', operation: 'where_used', parameters: { partNumber: 'B' } }),
      /where_used/
    );
    await rejects(
      () => adapter.validate({ domain: 'pdm', operation: 'visual_diff_cad', parameters: {} }),
      /visual_diff_cad/
    );
    await rejects(
      () =>
        adapter.execute({
          jobId: 'pdm-1',
          domain: 'pdm',
          operation: 'validate_lifecycle',
          parameters: { rootAssembly: {}, targetState: 'NOT_A_STATE' }
        }),
      /Invalid target lifecycle state/
    );
    const rollup = await adapter.execute({
      jobId: 'pdm-1',
      domain: 'pdm',
      operation: 'compute_bom_rollup',
      parameters: {
        rootAssembly: {
          partNumber: 'A',
          name: 'Assembly A',
          quantity: 1,
          unitMassKg: 1,
          unitCostUsd: 10,
          children: [{ partNumber: 'B', name: 'Part B', quantity: 2, unitMassKg: 0.5, unitCostUsd: 2 }]
        }
      }
    });
    assert.strictEqual(rollup.status, 'COMPLETED');
    const lifecycle = await adapter.execute({
      jobId: 'pdm-1',
      domain: 'pdm',
      operation: 'validate_lifecycle',
      parameters: { rootAssembly: {}, targetState: 'RELEASED', fromState: 'OBSOLETE', toState: 'RELEASED' }
    });
    assert.strictEqual(lifecycle.status, 'COMPLETED');
    assert(lifecycle.outputData.errors.length > 0);
  });

  check('GeometryEngineAdapter validate and execute branches', async () => {
    const adapter = new GeometryEngineAdapter();
    await rejects(
      () => adapter.execute({ jobId: 'geo-1', domain: 'cad', operation: 'apply_edge_blend', parameters: {} }),
      /apply_edge_blend|solid|Edge/
    );
    await rejects(
      () => adapter.execute({ jobId: 'geo-1', domain: 'cad', operation: 'evaluate_nurbs', parameters: {} }),
      /Insufficient control point grid/
    );
    const nurbs = await adapter.execute({
      jobId: 'geo-1',
      domain: 'cad',
      operation: 'evaluate_nurbs',
      parameters: {
        surface: {
          degreeU: 1,
          degreeV: 1,
          controlPoints: [
            [
              [0, 0, 0],
              [1, 0, 0]
            ],
            [
              [0, 1, 0],
              [1, 1, 1]
            ]
          ],
          knotsU: [0, 0, 1, 1],
          knotsV: [0, 0, 1, 1]
        },
        u: 0.5,
        v: 0.25
      }
    });
    assert.strictEqual(nurbs.status, 'COMPLETED');
    await rejects(
      () => adapter.execute({ jobId: 'geo-1', domain: 'cad', operation: 'boolean_union', parameters: {} }),
      /boolean_union|solid|CSG/i
    );
    await rejects(
      () => adapter.execute({ jobId: 'geo-1', domain: 'cad', operation: 'not_real', parameters: {} }),
      /not supported by adapter/
    );
    const box = BRepPrimitives.createBox(2, 2, 2, 'BoxA');
    const fillet = await adapter.execute({
      jobId: 'geo-1',
      domain: 'cad',
      operation: 'apply_edge_blend',
      parameters: { solid: box, targetEdge: box.edges[0].id, radius: 0.2, lengthUnit: 'mm' }
    });
    assert.strictEqual(fillet.status, 'COMPLETED');
  });

  check('EDAEngineAdapter transient registration and execute branches', async () => {
    const adapter = new EDAEngineAdapter();
    await rejects(
      () =>
        adapter.execute({
          jobId: 'eda-1',
          domain: 'eda',
          operation: 'simulate_spice_transient',
          parameters: { components: [{ type: 'X' }], analysis: { stopTimeS: 0.001, stepS: 1e-5 } }
        }),
      /Unsupported circuit component type/
    );
  });

  const pendingSettled = await Promise.race([
    Promise.all(pending).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 30000))
  ]);
  if (!pendingSettled) {
    failedTests += pending.length;
    console.error('  ✗ WARN: timed out waiting for pending checks; marking them failed');
  }

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapElevenCoverageTests };
