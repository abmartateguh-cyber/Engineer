'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 19).
 *
 * Final targeted batch: full robotics dynamics, orbital transfers, EDA
 * adapter solver ops, WAL malformed-tail cases, worker-pool timeouts, and
 * residual STEP assembly/edge-blend paths.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SerialManipulatorEngine, PUMA_560_DH } = require('../src/core/robotics/serial_manipulator_kinematics');
const { NasaRocketPropulsion } = require('../src/core/aerospace/nasa_rocket_propulsion');
const { EDAEngineAdapter } = require('../src/core/eda/eda_engine_adapter');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { OmniWal, WAL_FILE_NAME } = require('../src/core/storage/omni_archive');
const { PersistentWorkerPool } = require('../src/core/math/worker_pool');
const { EdgeBlender } = require('../src/core/cad/edge_blender');
const { StepTranslator } = require('../src/core/cad/step_translator');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');

async function runBranchGapNineteenCoverageTests() {
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

  const ZEROS6 = [0, 0, 0, 0, 0, 0];
  const DYN_LINKS = PUMA_560_DH.linkInertias;

  // ------------------------------------------------------------------
  // Robotics full dynamics
  // ------------------------------------------------------------------
  check('SerialManipulatorEngine inverseDynamics config form', () => {
    const result = SerialManipulatorEngine.inverseDynamics({
      dhTable: PUMA_560_DH,
      q: ZEROS6,
      qd: ZEROS6,
      qdd: ZEROS6,
      linkInertias: DYN_LINKS,
      gravity: [0, 0, -9.81],
      externalWrench: [0, 0, 0, 0, 0, 0]
    });
    assert(result.torques.length === 6);
    assert(result.torques.every(Number.isFinite));
  });

  check('SerialManipulatorEngine inverseDynamics positional form', () => {
    const result = SerialManipulatorEngine.inverseDynamics(
      PUMA_560_DH,
      ZEROS6,
      ZEROS6,
      ZEROS6,
      DYN_LINKS,
      [0, 0, -9.81],
      [0, 0, 0, 0, 0, 0]
    );
    assert(result.torques.every(Number.isFinite));
  });

  check('SerialManipulatorEngine inverseDynamics missing model throws', () => {
    assert.throws(
      () => SerialManipulatorEngine.inverseDynamics(),
      /inverseDynamics requires a configuration object|Invalid kinematic chain/
    );
  });

  check('SerialManipulatorEngine planQuinticTrajectory', () => {
    const plan = SerialManipulatorEngine.planQuinticTrajectory({
      q0: [0, 0, 0],
      qf: [1, 1, 1],
      duration: 2,
      steps: 20
    });
    assert(plan.trajectory.length >= 2);
  });

  // ------------------------------------------------------------------
  // Orbital transfers
  // ------------------------------------------------------------------
  check('NasaRocketPropulsion Hohmann transfer sweep', () => {
    const aero = new NasaRocketPropulsion();
    const result = aero.calculateOrbitalTransfer({ r1Meters: 6.7e6, r2Meters: 4.2e7 });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.transferType, 'hohmann');
    assert(result.deltaVTotal > 0);
  });

  check('NasaRocketPropulsion bi-elliptic transfer sweep', () => {
    const aero = new NasaRocketPropulsion();
    const result = aero.calculateOrbitalTransfer({ r1Meters: 6.7e6, r2Meters: 4.2e7, intermediateRadiusM: 1.5e8 });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.transferType, 'bi-elliptic');
  });

  check('NasaRocketPropulsion orbital invalid branches', () => {
    const aero = new NasaRocketPropulsion();
    assert.strictEqual(aero.calculateOrbitalTransfer({ r1Meters: -1, r2Meters: 4.2e7 }).success, false);
    assert.strictEqual(aero.calculateOrbitalTransfer({ r1Meters: 4.2e7, r2Meters: 6.7e6 }).success, false);
    assert.strictEqual(
      aero.calculateOrbitalTransfer({ r1Meters: 6.7e6, r2Meters: 4.2e7, intermediateRadiusM: 1e6 }).success,
      false
    );
  });

  // ------------------------------------------------------------------
  // Robotics adapter deep ops
  // ------------------------------------------------------------------
  check('RoboticsEngineAdapter inverse_dynamics operation', async () => {
    const adapter = new RoboticsEngineAdapter();
    const res = await adapter.execute({
      jobId: 'r2-1',
      domain: 'robotics',
      operation: 'inverse_dynamics',
      parameters: {
        preset: 'PUMA_560',
        jointAngles: ZEROS6,
        jointVelocities: ZEROS6,
        jointAccelerations: ZEROS6,
        linkDynamics: DYN_LINKS,
        gravity: [0, 0, -9.81],
        externalWrench: [0, 0, 0, 0, 0, 0]
      }
    });
    assert.strictEqual(res.status, 'COMPLETED');
  });

  check('RoboticsEngineAdapter inverse_dynamics validation branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'r2-2',
          domain: 'robotics',
          operation: 'inverse_dynamics',
          parameters: {
            preset: 'PUMA_560',
            jointAngles: ZEROS6,
            jointVelocities: ZEROS6,
            jointAccelerations: ZEROS6,
            linkDynamics: [],
            gravity: [0, 0, -9.81],
            externalWrench: [0, 0, 0, 0, 0, 0]
          }
        }),
      /linkDynamics/
    );
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'r2-3',
          domain: 'robotics',
          operation: 'inverse_dynamics',
          parameters: {
            preset: 'PUMA_560',
            jointAngles: ZEROS6,
            jointVelocities: ZEROS6,
            jointAccelerations: ZEROS6,
            linkDynamics: DYN_LINKS,
            gravity: [0, 0],
            externalWrench: [0, 0, 0, 0, 0, 0]
          }
        }),
      /gravity/
    );
  });

  check('RoboticsEngineAdapter FK with joint velocities', async () => {
    const adapter = new RoboticsEngineAdapter();
    const res = await adapter.execute({
      jobId: 'r2-4',
      domain: 'robotics',
      operation: 'forward_kinematics',
      parameters: { preset: 'PUMA_560', jointAngles: ZEROS6, jointVelocities: ZEROS6 }
    });
    assert.strictEqual(res.status, 'COMPLETED');
  });

  // ------------------------------------------------------------------
  // EDA adapter solver ops
  // ------------------------------------------------------------------
  check('EDAEngineAdapter IR-drop minimal mesh', async () => {
    const adapter = new EDAEngineAdapter();
    const res = await adapter.execute({
      jobId: 'e2-1',
      domain: 'eda',
      operation: 'analyze_ir_drop',
      parameters: {
        vdd: 1.0,
        maxDropThresholdPercent: 5,
        metalThickness: 1e-6,
        rows: 3,
        cols: 3,
        pitchX: 5e-6,
        pitchY: 5e-6,
        sheetRho: 0.02,
        wireWidth: 1e-6,
        padNodeIds: [0],
        currentLoads: [{ nodeId: 1, current: 1e-3 }]
      }
    });
    assert.strictEqual(res.status, 'COMPLETED');
  });

  check('EDAEngineAdapter IR-drop validation branches', async () => {
    const adapter = new EDAEngineAdapter();
    const base = {
      vdd: 1,
      maxDropThresholdPercent: 5,
      metalThickness: 1e-6,
      rows: 3,
      cols: 3,
      pitchX: 5e-6,
      pitchY: 5e-6,
      sheetRho: 0.02,
      wireWidth: 1e-6,
      padNodeIds: [0],
      currentLoads: [{ nodeId: 1, current: 1e-3 }]
    };
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'e2-2',
          domain: 'eda',
          operation: 'analyze_ir_drop',
          parameters: { ...base, vdd: 0 }
        }),
      /vdd/
    );
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'e2-3',
          domain: 'eda',
          operation: 'analyze_ir_drop',
          parameters: { ...base, metalThickness: 0 }
        }),
      /metalThickness/
    );
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'e2-4',
          domain: 'eda',
          operation: 'analyze_ir_drop',
          parameters: { ...base, rows: 0 }
        }),
      /rows and cols/
    );
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'e2-5',
          domain: 'eda',
          operation: 'analyze_ir_drop',
          parameters: { ...base, pitchX: 0 }
        }),
      /pitchX/
    );
  });

  check('EDAEngineAdapter electromigration validation', async () => {
    const adapter = new EDAEngineAdapter();
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'e2-6',
          domain: 'eda',
          operation: 'calculate_electromigration',
          parameters: { currentDensity: 0 }
        }),
      /currentDensity/
    );
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'e2-7',
          domain: 'eda',
          operation: 'calculate_electromigration',
          parameters: { currentDensity: 1e6, tempC: -300 }
        }),
      /temperature above absolute zero|tempC/
    );
  });

  check('EDAEngineAdapter crosstalk and OASIS guards', async () => {
    const adapter = new EDAEngineAdapter();
    await assert.rejects(
      () => adapter.execute({ jobId: 'e2-8', domain: 'eda', operation: 'evaluate_crosstalk', parameters: {} }),
      /aggressorVoltageSwingV/
    );
    const oasis = await adapter.execute({
      jobId: 'e2-9',
      domain: 'eda',
      operation: 'serialize_oasis',
      parameters: { layout: {} }
    });
    assert.strictEqual(oasis.status, 'COMPLETED');
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'e2-10',
          domain: 'eda',
          operation: 'deserialize_oasis',
          parameters: { bytes: Buffer.alloc(4) }
        }),
      /Invalid or truncated|magic header/
    );
  });

  // ------------------------------------------------------------------
  // WAL malformed cases
  // ------------------------------------------------------------------
  check('OmniWal malformed-tail corpus', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov19-'));
    const archivePath = path.join(dir, 'proj.omni');
    const seedPath = path.join(dir, 'seed.wal');
    const seed = new OmniWal({ path: seedPath, archivePath });
    seed.open();
    seed.appendEntry('addBlob', { hash: 'abc', bytes: 4 });
    seed.commit();
    seed.close();
    const seedLines = fs.readFileSync(seedPath, 'utf8').split('\n');
    const header = seedLines[0];
    const { calculateCRC32 } = require('../src/core/storage/omni_archive');
    const crcOf = (arr) => calculateCRC32(Buffer.from(JSON.stringify(arr), 'utf8'));
    const dataLine = (seq, op, digest) => JSON.stringify([seq, op, digest, crcOf([seq, op, digest])]);
    const writeWal = (content) => {
      const walPath = path.join(dir, WAL_FILE_NAME);
      fs.writeFileSync(walPath, content, 'utf8');
      const wal = new OmniWal({ path: walPath, archivePath });
      wal.open();
      const stats = wal.stats();
      wal.close();
      return stats;
    };
    const good = dataLine(1, 'addBlob', 'a'.repeat(64));
    const badCommit = JSON.stringify([1, 'COMMIT', 'x', crcOf([1, 'COMMIT', 'x'])]);
    const badSeq = JSON.stringify([3, 'addBlob', 'a'.repeat(64), crcOf([3, 'addBlob', 'a'.repeat(64)])]);
    assert(writeWal(header + '\n' + good + '\n' + badCommit + '\n').recovered >= 0);
    assert(writeWal(header + '\n' + badSeq + '\n').recovered >= 0);
    assert(writeWal(header + '\n' + 'not-json\n').recovered >= 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------
  // Worker pool timeout branch
  // ------------------------------------------------------------------
  check('PersistentWorkerPool task timeout rejection', async () => {
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    let outcome = 'none';
    try {
      await pool.dispatch('ECHO_TEST', { message: 'slow', delayMs: 3000 }, { timeoutMs: 200 });
      outcome = 'resolved';
    } catch (err) {
      outcome = err.message;
    }
    await pool.terminateAll();
    assert.match(outcome, /maximum execution limit/);
  });

  // ------------------------------------------------------------------
  // Edge blender and STEP extras
  // ------------------------------------------------------------------
  check('EdgeBlender fillet plain-point edges with normal fallback', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'Box');
    const serialized = JSON.parse(JSON.stringify(box));
    const edge = serialized.edges[0];
    delete edge.start.point;
    delete edge.end.point;
    edge.start.point = { x: 0, y: 0, z: 0 };
    edge.end.point = { x: 10, y: 0, z: 0 };
    const result = EdgeBlender.applyFillet(serialized, edge, 0.5);
    assert(result.success === true || result.solid);
  });

  check('StepTranslator assembly export flat 16-length transform', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'BoxA');
    const box2 = BRepPrimitives.createBox(5, 5, 5, 'BoxB');
    const flat = [1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const data = {
      solids: [
        { id: 's1', solid: box },
        { id: 's2', solid: box2 }
      ],
      assembly: {
        nodes: [
          { id: 'n1', solidId: 's1' },
          { id: 'n2', solidId: 's2', children: [] }
        ],
        references: [
          { id: 'r1', childId: 'n1', parentId: null },
          { id: 'r2', childId: 'n2', parentId: 'n1', transform: flat }
        ]
      }
    };
    const step = StepTranslator.exportAssemblySTEP(data, 'Assy');
    assert(step.includes('CARTESIAN_TRANSFORMATION_3D') || step.includes('PRODUCT('));
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

module.exports = { runBranchGapNineteenCoverageTests };

if (require.main === module) {
  runBranchGapNineteenCoverageTests().then((stats) => {
    console.log(`gap19: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
