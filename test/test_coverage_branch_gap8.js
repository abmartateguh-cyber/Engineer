'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 8).
 *
 * Narrow, high-confidence checks for a final set of uncovered blocks in the
 * largest-gap files: manipulator conventions, adapter execute variants,
 * rocket ascent success path, archive V1 sections, STEP cylinder NURBS,
 * edge-blender serialized hydration, EDA DC spice, and OmniAI tool routing.
 */

const assert = require('assert');

const { SerialManipulatorEngine, PUMA_560_DH } = require('../src/core/robotics/serial_manipulator_kinematics');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { NasaRocketPropulsion } = require('../src/core/aerospace/nasa_rocket_propulsion');
const { OmniArchive } = require('../src/core/storage/omni_archive');
const { StepTranslator } = require('../src/core/cad/step_translator');
const { EdgeBlender } = require('../src/core/cad/edge_blender');
const { EDAEngineAdapter } = require('../src/core/eda/eda_engine_adapter');
const { OmniAIEngine } = require('../src/core/ai/omni_ai_engine');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');

async function runBranchGapEightCoverageTests() {
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

  const rejects = async (fn) => {
    try {
      await fn();
    } catch (err) {
      return err;
    }
    return null;
  };

  check('SerialManipulatorEngine convention and PoE branches', () => {
    const fkModified = SerialManipulatorEngine.forwardKinematics(
      PUMA_560_DH,
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      'modified'
    );
    assert(fkModified && typeof fkModified === 'object');
    const fkPoE = SerialManipulatorEngine.forwardKinematics(
      {
        screwAxes: [
          [0, 0, 1, 0, 0, 0],
          [0, 0, 1, 0, 0, 0]
        ],
        homeTransform: [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0.4],
          [0, 0, 0, 1]
        ]
      },
      [0.2, 0.3]
    );
    assert(fkPoE && typeof fkPoE === 'object');
    const jac = SerialManipulatorEngine.computeGeometricJacobian(PUMA_560_DH, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    assert(jac && typeof jac.jacobian === 'object');
    assert.throws(() => SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, [0.1]), /joint angles/);
  });

  check('RoboticsEngineAdapter dynamics and trajectory execute branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    const links = [
      { mass: 4, com: [0, 0, 0.05], inertia: { ixx: 0.1, iyy: 0.1, izz: 0.05, ixy: 0, ixz: 0, iyz: 0 } },
      { mass: 3, com: [0, 0, 0.04], inertia: { ixx: 0.08, iyy: 0.08, izz: 0.04, ixy: 0, ixz: 0, iyz: 0 } },
      { mass: 2, com: [0, 0, 0.03], inertia: { ixx: 0.05, iyy: 0.05, izz: 0.02, ixy: 0, ixz: 0, iyz: 0 } },
      { mass: 1, com: [0, 0, 0.02], inertia: { ixx: 0.02, iyy: 0.02, izz: 0.01, ixy: 0, ixz: 0, iyz: 0 } },
      { mass: 0.8, com: [0, 0, 0.015], inertia: { ixx: 0.01, iyy: 0.01, izz: 0.005, ixy: 0, ixz: 0, iyz: 0 } },
      { mass: 0.5, com: [0, 0, 0.01], inertia: { ixx: 0.005, iyy: 0.005, izz: 0.002, ixy: 0, ixz: 0, iyz: 0 } }
    ];
    const dyn = await adapter.execute(
      {
        jobId: 'd1',
        domain: 'robotics',
        operation: 'inverse_dynamics',
        parameters: {
          preset: 'PUMA_560',
          q: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
          qd: [0, 0, 0, 0, 0, 0],
          qdd: [0, 0, 0, 0, 0, 0],
          linkDynamics: links,
          gravity: [0, 0, -9.81],
          fTip: [0, 0, 0, 0, 0, 0]
        }
      },
      () => {},
      null
    );
    assert.strictEqual(dyn.status, 'COMPLETED');
    const traj = await adapter.execute(
      {
        jobId: 't1',
        domain: 'robotics',
        operation: 'trajectory_plan',
        parameters: {
          dhTable: PUMA_560_DH,
          q0: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
          qf: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
          duration: 1.0
        }
      },
      () => {},
      null
    );
    assert.strictEqual(traj.status, 'COMPLETED');
  });

  check('NasaRocketPropulsion ascent success path', () => {
    const rocket = new NasaRocketPropulsion();
    const ascent = rocket.simulateAscentTrajectory({
      stage1EngineCount: 2,
      stage1EngineThrustN: 2e6,
      stage1PropellantMassKg: 100000,
      liftOffMassKg: 150000,
      burnTimeS: 120,
      Isp_sl: 280,
      Isp_vac: 330,
      dragCoefficientByMach: [
        [0, 0.5],
        [1, 0.4],
        [2, 0.35]
      ],
      pitchAngleByAltitude: [
        [0, 90],
        [5000, 80],
        [20000, 45]
      ],
      stageMassKg: 20000
    });
    assert(ascent && typeof ascent === 'object');
    const badRange = rocket.simulateAscentTrajectory({
      stage1EngineCount: 2,
      stage1EngineThrustN: 2e6,
      stage1PropellantMassKg: 100000,
      liftOffMassKg: 150000,
      burnTimeS: 120,
      Isp_sl: 280,
      Isp_vac: 330,
      dragCoefficientByMach: [
        [0, 0.5],
        [1, 0.4],
        [2, 0.35]
      ],
      pitchAngleByAltitude: [
        [0, 90],
        [5000, 80],
        [20000, 45]
      ],
      stageMassKg: 20000,
      maxAltitudeM: 100
    });
    assert.strictEqual(badRange.success, false);
  });

  check('OmniArchive V1 section branches', () => {
    const archive = new OmniArchive({ projectName: 'P', author: 'a' });
    archive.addSection('input', JSON.stringify({ x: 1 }));
    assert.strictEqual(archive.hasSection('input'), true);
    assert.strictEqual(archive.getSection('input', true).x, 1);
    assert.strictEqual(archive.hasSection('missing'), false);
    assert.strictEqual(archive.getSection('missing'), null);
    const buf = archive.saveToBuffer();
    const reloaded = OmniArchive.loadFromBuffer(buf);
    assert.strictEqual(reloaded.hasSection('input'), true);
  });

  check('StepTranslator cylinder NURBS path', () => {
    const cylinder = BRepPrimitives.createCylinder(1, 2, 16);
    const nurbs = StepTranslator.exportNurbsSurfaces(cylinder);
    assert(nurbs && typeof nurbs === 'string');
    assert(nurbs.length > 1000);
  });

  check('EdgeBlender serialized solid hydration', () => {
    const solid = BRepPrimitives.createBox(1, 1, 1);
    const serialized = {
      vertices: solid.vertices.map((v) => ({ id: v.id, point: { x: v.point.x, y: v.point.y, z: v.point.z } })),
      faces: solid.faces.map((f) => ({ id: f.id, vertices: f.vertices.map((idx) => idx) })),
      edges: solid.edges.map((e) => ({ id: e.id, start: e.start, end: e.end }))
    };
    const ok = EdgeBlender.applyFillet(serialized, serialized.edges[0], 0.05);
    assert(ok && typeof ok === 'object');
  });

  check('EDAEngineAdapter DC spice branch', async () => {
    const adapter = new EDAEngineAdapter();
    const out = await adapter.execute(
      {
        jobId: 'e1',
        domain: 'eda',
        operation: 'simulate_spice_dc',
        parameters: {
          components: [
            { type: 'V', id: 'v1', nPlus: 'n1', nMinus: '0', dcValue: 5 },
            { type: 'R', id: 'r1', n1: 'n1', n2: 'n2', value: 1000 },
            { type: 'R', id: 'r2', n1: 'n2', n2: '0', value: 1000 }
          ]
        }
      },
      () => {}
    );
    assert.strictEqual(out.status, 'COMPLETED');
  });

  check('OmniAIEngine tool routing branches', () => {
    const ai = new OmniAIEngine();
    const rcwa = ai.processPrompt('simulate RCWA grating');
    assert(rcwa && typeof rcwa === 'object');
    const flash = ai.processPrompt('plant flash separation');
    assert(flash && typeof flash === 'object');
    const opticsFit = ai.processPrompt('fit optical glass data');
    assert(opticsFit && typeof opticsFit === 'object');
    const calc = ai.processPrompt('calculate 2+2');
    assert(calc && typeof calc === 'object');
  });

  await Promise.all(pending);

  console.log('\n================================================================');
  console.log(`   BRANCH-GAP-8 RESULTS: ${passedTests}/${totalTests} passed; ${failedTests} failed`);
  console.log('================================================================');
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapEightCoverageTests };

if (require.main === module) {
  runBranchGapEightCoverageTests().then((stats) => {
    if (stats.failed > 0) process.exitCode = 1;
  });
}
