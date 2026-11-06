'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 7).
 *
 * Targets the remaining uncovered non-entry blocks in the highest-gap files:
 * serial manipulator helpers, PID engine warn/fallback paths, robotics
 * adapter execute variants, archive/WAL paths, stenographer proposal paths,
 * system IPC project-manifest branches, STEP single-part/NURBS paths,
 * edge blender chamfer success, aerospace adapter twin, plant adapter
 * validation matrix, and worker-pool kernel dispatch.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { SerialManipulatorEngine, PUMA_560_DH, UR5E_DH } = require('../src/core/robotics/serial_manipulator_kinematics');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { PIDEngine } = require('../src/core/plant/pid_engine');
const { NasaRocketPropulsion } = require('../src/core/aerospace/nasa_rocket_propulsion');
const { OmniArchiveV2, OmniWal, CommandJournal, saveAtomicSync } = require('../src/core/storage/omni_archive');
const { StenographerSupervisor } = require('../src/main/stenographer_supervisor');
const {
  processStenographerQuery,
  handleGenericSparseSolve,
  normalizeSparseMatrixInput
} = require('../src/main/ipc/system_ipc');
const { StepTranslator } = require('../src/core/cad/step_translator');
const { EdgeBlender } = require('../src/core/cad/edge_blender');
const { AerospaceEngineAdapter } = require('../src/core/aerospace/aerospace_engine_adapter');
const { PlantEngineAdapter } = require('../src/core/plant/plant_engine_adapter');
const { PersistentWorkerPool } = require('../src/core/math/worker_pool');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');

async function runBranchGapSevenCoverageTests() {
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

  // ---------------------------------------------------------------
  // Serial manipulator: PoE, trajectory errors, URDF dynamics
  // ---------------------------------------------------------------
  check('SerialManipulatorEngine PoE and trajectory branches', () => {
    const home = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0.4],
      [0, 0, 0, 1]
    ];
    const screws = [
      [0, 0, 1, 0, 0, 0],
      [0, 0, 1, 0, 0, 0]
    ];
    const poe = SerialManipulatorEngine.forwardKinematicsPoE(screws, home, [0.2, 0.3]);
    assert(poe && typeof poe === 'object');
    assert.throws(() => SerialManipulatorEngine.forwardKinematicsPoE(screws, home, [0.2]), /joint angles/);
    assert.throws(
      () => SerialManipulatorEngine.planQuinticTrajectory({ qStart: [0, 0], qEnd: [1], duration: 1 }),
      /qEnd/
    );
    assert.throws(
      () => SerialManipulatorEngine.planQuinticTrajectory({ qStart: [0, 0], qEnd: [1, 1], duration: 0 }),
      /duration/
    );
    const plan = SerialManipulatorEngine.planQuinticTrajectory({ qStart: [0, 0], qEnd: [1, 1], duration: 1, dt: 0.1 });
    assert(plan && typeof plan === 'object');
  });

  check('SerialManipulatorEngine URDF prismatic dynamics', () => {
    const urdf =
      '<robot name="r"><link name="base"/><link name="s1"/><link name="s2"/><joint name="j1" type="prismatic"><parent link="base"/><child link="s1"/><origin xyz="0 0 0" rpy="0 0 0"/><axis xyz="0 0 1"/></joint><joint name="j2" type="fixed"><parent link="s1"/><child link="s2"/><origin xyz="0.1 0 0" rpy="0 0 0"/></joint></robot>';
    const parsed = SerialManipulatorEngine.parseURDF(urdf);
    const links = [
      { mass: 2, com: [0, 0, 0.05], inertia: { ixx: 0.1, iyy: 0.1, izz: 0.05, ixy: 0, ixz: 0, iyz: 0 } },
      { mass: 1, com: [0, 0, 0.05], inertia: { ixx: 0.05, iyy: 0.05, izz: 0.02, ixy: 0, ixz: 0, iyz: 0 } }
    ];
    const id = SerialManipulatorEngine.inverseDynamics(
      parsed.dhTable,
      [0.2],
      [0.01],
      [0],
      links,
      [0, 0, -9.81],
      [0, 0, 0, 0, 0, 0]
    );
    assert(id && id.torques.length === 1);
    const M = SerialManipulatorEngine.computeMassMatrix(parsed.dhTable, links, [0.2]);
    assert(M && M.length === 1);
  });

  // ---------------------------------------------------------------
  // Robotics adapter execute variants
  // ---------------------------------------------------------------
  check('RoboticsEngineAdapter FK target-position and UR5E branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    const out = await adapter.execute(
      {
        jobId: 'f1',
        domain: 'robotics',
        operation: 'forward_kinematics',
        parameters: { preset: 'UR5E', q: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], targetPosition: [0.3, 0.2, 0.4] }
      },
      () => {},
      null
    );
    assert.strictEqual(out.status, 'COMPLETED');
    const out2 = await adapter.execute(
      {
        jobId: 'f2',
        domain: 'robotics',
        operation: 'forward_kinematics',
        parameters: { dhTable: PUMA_560_DH, q: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] }
      },
      () => {},
      null
    );
    assert.strictEqual(out2.status, 'COMPLETED');
  });

  // ---------------------------------------------------------------
  // PID engine: warnings-only config and unknown-symbol fallback
  // ---------------------------------------------------------------
  check('PIDEngine validateConfig warning branches and fallback symbols', () => {
    const engine = new PIDEngine();
    const config = {
      project: { revision: '1' },
      areas: [
        {
          id: 'A-1',
          equipment: [
            {
              tag: 'E-1',
              type: 'vertical_separator',
              x: 0,
              y: 0,
              nozzles: [{ id: 'N1' }, { id: 'V1' }],
              inletNozzles: ['N1'],
              outletNozzles: [],
              ventNozzles: ['V1']
            }
          ]
        }
      ],
      lines: [
        {
          lineNumber: 'L-1010-25-CS-999-A1F',
          sizeIn: 25,
          material: 'CS',
          class: '999',
          from: { tag: 'E-1', nozzle: 'N1' },
          to: { tag: 'E-1', nozzle: 'N1' },
          service: 'hydrocarbon'
        }
      ],
      instruments: [
        { tag: 'I-1', location: 'bogus' },
        { tag: 'I-2', connectedTo: { tag: 'E-1', nozzle: 'N1' } }
      ],
      valves: [{ tag: 'V-1', type: 'gate', actuator: 'bogus', lineNumber: 'L-1010-25-CS-999-A1F' }],
      controlLoops: [{ loopTag: 'L-1', sensorTag: 'I-1', controllerTag: 'I-1', finalElementTag: 'V-1', type: 'bogus' }]
    };
    const result = engine.createPID(config);
    assert(result.validation.warnings.length >= 7);
    assert(result.validation.warnings.some((w) => w.includes('revision')));
    assert(result.validation.warnings.some((w) => w.includes('exceeds 24 in')));
    assert(result.validation.warnings.some((w) => w.includes('nonstandard')));
    assert(result.validation.warnings.some((w) => w.includes('insulation')));
    assert(result.validation.warnings.some((w) => w.includes('location')));
    assert(result.validation.warnings.some((w) => w.includes('no connectedTo')));
    assert(result.validation.warnings.some((w) => w.includes('actuator')));
    assert(result.validation.warnings.some((w) => w.includes('not a standard loop type')));
    assert(result.validation.warnings.some((w) => w.includes('PSV relief device')));
    assert(result.validation.warnings.some((w) => w.includes('vent nozzle')));
    const unknownSymbols = engine.createPID({
      project: { revision: '0' },
      areas: [
        {
          id: 'A-1',
          equipment: [
            {
              tag: 'Z-1',
              type: 'wobble_thing',
              x: 0,
              y: 0,
              nozzles: [],
              inletNozzles: [],
              outletNozzles: [],
              ventNozzles: []
            }
          ]
        }
      ],
      lines: [],
      instruments: [],
      valves: [],
      controlLoops: []
    });
    assert(unknownSymbols && typeof unknownSymbols === 'object');
  });

  // ---------------------------------------------------------------
  // NASA rocket: turbopump/cooling inputs (probe-driven)
  // ---------------------------------------------------------------
  check('NasaRocketPropulsion cooling/turbopump input branches', () => {
    const rocket = new NasaRocketPropulsion();
    const perf = rocket.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.6,
      throatDiameterM: 0.1,
      expansionRatio: 16,
      ambientPressureBar: 1
    });
    assert.strictEqual(perf.success, true);
    const c = rocket.calculateBartzRegenerativeCooling(perf, { coolantRe: 50000, coolantInletTempK: 300 });
    assert(c && typeof c === 'object');
    const tp = rocket.calculateTurbopumpSystem(perf, c, {
      fuelPumpEfficiency: 0.7,
      oxidizerPumpEfficiency: 0.7,
      turbineEfficiency: 0.7
    });
    assert(tp && typeof tp === 'object');
    const badPump = rocket.calculateTurbopumpSystem(perf, c, {
      fuelPumpEfficiency: 1.5,
      oxidizerPumpEfficiency: 0.7,
      turbineEfficiency: 0.7
    });
    assert.strictEqual(badPump.success, false);
    const lowAtm = rocket.runAerospaceCFD({ alphaDeg: 2 });
    assert(lowAtm && typeof lowAtm === 'object');
  });

  // ---------------------------------------------------------------
  // Archive storage branches
  // ---------------------------------------------------------------
  check('OmniArchive buffer and encrypted round-trips', () => {
    const archive = new OmniArchiveV2({ projectName: 'P', author: 'tester' });
    const blob = archive.addBlob(Buffer.from('hello blob'));
    assert(blob && typeof blob.hash === 'string');
    assert.strictEqual(archive.getBlob(blob.hash).toString(), 'hello blob');
    const buf = archive.saveToBuffer();
    const reloaded = OmniArchiveV2.loadFromBuffer(buf);
    assert(reloaded && typeof reloaded === 'object');
    assert(Array.isArray(archive.listBlobs()));
  });

  check('OmniWal replay and CommandJournal import branches', () => {
    const walPath = path.join(os.tmpdir(), `omnieng-wal7-${Date.now()}.log`);
    const archivePath = path.join(os.tmpdir(), `omnieng-arch7-${Date.now()}.omni`);
    const wal = new OmniWal({ path: walPath, archivePath });
    wal.open();
    wal.appendEntry('write', { path: '/x' });
    wal.commit();
    wal.close();
    fs.unlinkSync(walPath);
    const journal = new CommandJournal();
    journal.execute('edit', { a: 1 }, { a: 0 });
    const data = journal.export();
    const journal2 = new CommandJournal();
    journal2.import(data);
    assert.strictEqual(journal2.canUndo(), true);
    assert.throws(() => journal2.import({}), /Invalid journal import/);
  });

  // ---------------------------------------------------------------
  // Stenographer supervisor proposal branches
  // ---------------------------------------------------------------
  check('StenographerSupervisor proposeToolCall branches', () => {
    const supervisor = new StenographerSupervisor({});
    assert.throws(() => supervisor.proposeToolCall(null));
    assert.throws(() => supervisor.proposeToolCall({ toolName: '' }));
    const proposal = supervisor.proposeToolCall({
      toolName: 'pdm.compute_bom_rollup',
      args: {},
      originatingProjectRevision: 1
    });
    assert(proposal && typeof proposal === 'object');
    assert.throws(() =>
      supervisor.proposeToolCall({ toolName: 'pdm.compute_bom_rollup', args: {}, originatingProjectRevision: 0 })
    );
    assert.throws(() =>
      supervisor.proposeToolCall({
        toolName: 'pdm.compute_bom_rollup',
        args: {},
        originatingProjectRevision: 1,
        approvalClass: 'wrong'
      })
    );
  });

  // ---------------------------------------------------------------
  // System IPC manifest branch
  // ---------------------------------------------------------------
  check('processStenographerQuery manifest branches', () => {
    const supervisor = { processQuery: () => ({ success: true }) };
    const projectService = {
      getManifest: () => ({ revision: 3, projectId: 'prj' })
    };
    const bad = processStenographerQuery(supervisor, projectService, { prompt: '  ' });
    assert.strictEqual(bad.success, false);
    const stale = processStenographerQuery(supervisor, projectService, { prompt: 'hello', projectRevision: 4 });
    assert.strictEqual(stale.success, false);
    const noService = processStenographerQuery(supervisor, null, { prompt: 'hello' });
    assert.strictEqual(noService.success, true);
    const passed = processStenographerQuery(supervisor, projectService, {
      prompt: 'hello',
      projectRevision: 3,
      context: {}
    });
    assert.strictEqual(passed.success, true);
  });

  // ---------------------------------------------------------------
  // STEP single part export
  // ---------------------------------------------------------------
  check('StepTranslator single-part export', () => {
    const solid = BRepPrimitives.createBox(2, 3, 4);
    const step = StepTranslator.exportSTEP(solid, 'BoxPart');
    assert(step && typeof step === 'string');
    assert(step.includes('BoxPart'));
    const parsed = StepTranslator.parseSTEP(step);
    assert(parsed && typeof parsed === 'object');
  });

  // ---------------------------------------------------------------
  // Edge blender chamfer success
  // ---------------------------------------------------------------
  check('EdgeBlender chamfer success', () => {
    const solid = BRepPrimitives.createBox(1, 1, 1);
    const ok = EdgeBlender.applyChamfer(solid, solid.edges[0], 0.05, 0.1);
    assert(ok && typeof ok === 'object');
    const blend = EdgeBlender.blendEdges(solid, [0]);
    assert(blend && typeof blend === 'object');
  });

  // ---------------------------------------------------------------
  // Aerospace adapter execute branches
  // ---------------------------------------------------------------
  check('AerospaceEngineAdapter execute branches', async () => {
    const adapter = new AerospaceEngineAdapter();
    const nozzle = await adapter.execute(
      {
        jobId: 'a1',
        domain: 'aerospace',
        operation: 'compile_rocket_nozzle',
        parameters: { chamberPressurePa: 10e6, expansionRatio: 16, throatDiameterM: 0.1 }
      },
      () => {}
    );
    assert.strictEqual(nozzle.status, 'COMPLETED');
    const cfd = await adapter.execute(
      {
        jobId: 'a2',
        domain: 'aerospace',
        operation: 'run_aerospace_cfd',
        parameters: {
          alphaDeg: 2,
          machNumber: 2.5,
          chordM: 0.5,
          altitudeM: 10000,
          wedgeHalfAngleDeg: 10,
          referenceAreaM2: 1
        }
      },
      () => {}
    );
    assert.strictEqual(cfd.status, 'COMPLETED');
    assert(
      (await rejects(() =>
        adapter.execute(
          {
            jobId: 'a3',
            domain: 'aerospace',
            operation: 'regenerative_cooling',
            parameters: {
              enginePerf: { thermo: { gamma: 1.2 } },
              coolantProps: { coolantRe: 50000, coolantInletTempK: 300 }
            }
          },
          () => {}
        )
      )) !== null
    );
  });

  // ---------------------------------------------------------------
  // Plant adapter validation matrix
  // ---------------------------------------------------------------
  check('PlantEngineAdapter validation branches', async () => {
    const adapter = new PlantEngineAdapter();
    assert((await rejects(() => adapter.validate(null))) !== null);
    assert(
      (await rejects(() =>
        adapter.validate({ domain: 'plant', operation: 'calculate_steam_properties', parameters: {} })
      )) !== null
    );
    assert(
      (await rejects(() =>
        adapter.validate({ domain: 'plant', operation: 'calculate_water_hammer', parameters: {} })
      )) !== null
    );
    const ok = await adapter.validate({
      domain: 'plant',
      operation: 'calculate_steam_properties',
      parameters: { pressurePa: 101325, temperatureK: 400 }
    });
    assert.strictEqual(ok, true);
  });

  // ---------------------------------------------------------------
  // Worker pool kernel dispatch
  // ---------------------------------------------------------------
  check('PersistentWorkerPool kernel dispatch', async () => {
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    const r = await pool.dispatch('ECHO_TEST', { message: 'ping' }, {});
    assert.strictEqual(r.result.echo, 'ping');
    await pool.terminateAll();
  });

  await Promise.all(pending);

  console.log('\n================================================================');
  console.log(`   BRANCH-GAP-7 RESULTS: ${passedTests}/${totalTests} passed; ${failedTests} failed`);
  console.log('================================================================');
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapSevenCoverageTests };

if (require.main === module) {
  runBranchGapSevenCoverageTests().then((stats) => {
    if (stats.failed > 0) process.exitCode = 1;
  });
}
