'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { SerialManipulatorEngine } = require('../src/core/robotics/serial_manipulator_kinematics');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { SymbolicReasoner, PhysicalDimension, DimensionalQuantity } = require('../src/core/ai/symbolic_reasoner');
const { LocalComputeProvider, SlurmComputeProvider, PbsComputeProvider } = require('../src/core/hpc/cloud_cluster');
const {
  ExperimentalCalculationQueue,
  PersistentWorkerPool,
  getGlobalWorkerPool,
  getGlobalPersistentWorkerPool
} = require('../src/core/math/worker_pool');
const { OmniArchive, OmniArchiveV2 } = require('../src/core/storage/omni_archive');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobResult } = require('../src/core/contracts/JobResult');

async function runRoboticsAiHpcCoverageTests() {
  console.log('================================================================');
  console.log('   TESTING ROBOTICS, SYMBOLIC AI, HPC & STORAGE COVERAGE       ');
  console.log('================================================================');

  let passedTests = 0;
  let failedTests = 0;
  let currentSection = 'suite setup';
  const localPools = [];

  try {
    currentSection = '[1/6] Serial Manipulator Kinematics';
    // 1. Serial Manipulator Kinematics & Delegates
    console.log('\n[1] Serial Manipulator Kinematics & Delegates...');
    {
      const engine = new SerialManipulatorEngine();

      // Standard 2-link planar DH parameters
      const dhTable = [
        { a: 1.0, alpha: 0.0, d: 0.0, theta: 0.0 },
        { a: 1.0, alpha: 0.0, d: 0.0, theta: 0.0 }
      ];

      // Delegate forwardKinematics
      const fk = engine.forwardKinematics(dhTable, [0.0, 0.0]);
      assert(Array.isArray(fk.position));

      // Delegate computeGeometricJacobian
      const jac = engine.computeGeometricJacobian(dhTable, [0.0, 0.0]);
      assert(jac.jacobian.length === 6);

      // PoE Forward Kinematics (exercises se3Exp, axisAngleToRot3, skew3, mat3Mul)
      const screwAxes = [
        [0, 0, 1, 0, 0, 0],
        [0, 0, 1, 0, -1, 0]
      ];
      const homeTransform = [
        [1, 0, 0, 2],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1]
      ];
      const fkPoE = engine.forwardKinematicsPoE(screwAxes, homeTransform, [Math.PI / 4, -Math.PI / 4]);
      assert.strictEqual(fkPoE.transform.length, 4);

      // Inverse Kinematics with RPY and Quaternion orientation (exercises rpyToRot3, quaternionToRot3, computeOrientationError)
      const ikRpy = engine.inverseKinematics(dhTable, [1.5, 0.5, 0.0], {
        targetOrientation: { roll: 0, pitch: 0, yaw: 0 },
        qInit: [0.1, 0.1],
        maxIterations: 20
      });
      assert(Array.isArray(ikRpy.q));

      const ikQuat = engine.inverseKinematics(dhTable, [1.5, 0.5, 0.0], {
        targetOrientation: [0, 0, 0, 1],
        qInit: [0.1, 0.1],
        maxIterations: 20
      });
      assert(Array.isArray(ikQuat.q));

      // Delegate planQuinticTrajectory
      const traj = engine.planQuinticTrajectory({
        q0: [0, 0],
        qf: [1, 1],
        duration: 1.0,
        vf: [0, 0],
        af: [0, 0],
        numSteps: 10
      });
      assert.strictEqual(traj.samples.length, 10);

      // Delegate parseURDF
      const urdfContent = `
      <robot name="two_link">
        <link name="base_link">
          <inertial>
            <origin xyz="0 0 0" rpy="0 0 0"/>
            <mass value="1.0"/>
            <inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/>
          </inertial>
        </link>
        <link name="link1">
          <inertial>
            <origin xyz="0 0 0.5" rpy="0 0 0"/>
            <mass value="2.0"/>
            <inertia ixx="0.2" ixy="0" ixz="0" iyy="0.2" iyz="0" izz="0.2"/>
          </inertial>
        </link>
        <joint name="joint1" type="revolute">
          <parent link="base_link"/>
          <child link="link1"/>
          <origin xyz="0 0 1" rpy="0 0 0"/>
          <axis xyz="0 0 1"/>
          <limit lower="-3.14" upper="3.14" effort="10" velocity="1"/>
        </joint>
      </robot>
    `;
      const parsedUrdf = engine.parseURDF(urdfContent);
      assert.strictEqual(parsedUrdf.name, 'two_link');

      // Delegate inverseDynamics
      const linkInertias = [
        { mass: 1.0, com: [0.5, 0, 0], Ixx: 0.1, Iyy: 0.1, Izz: 0.1, Ixy: 0, Ixz: 0, Iyz: 0 },
        { mass: 1.0, com: [0.5, 0, 0], Ixx: 0.1, Iyy: 0.1, Izz: 0.1, Ixy: 0, Ixz: 0, Iyz: 0 }
      ];
      const invDyn = engine.inverseDynamics(
        dhTable,
        [0, 0],
        [0.1, 0.1],
        [0.01, 0.01],
        linkInertias,
        [0, 0, -9.81],
        [0, 0, 0, 0, 0, 0]
      );
      assert.strictEqual(invDyn.torques.length, 2);

      // computeMassMatrix
      const massMat = SerialManipulatorEngine.computeMassMatrix(dhTable, linkInertias, [0, 0]);
      assert.strictEqual(massMat.length, 2);
      passedTests++;
      console.log('  ✓ PASSED: SerialManipulatorEngine kinematic and dynamic methods covered');
    }

    // 2. Robotics Engine Adapter - Trajectory & URDF
    currentSection = '[2/6] Robotics Engine Adapter';
    console.log('\n[2] Robotics Engine Adapter Trajectory & URDF...');
    {
      const adapter = new RoboticsEngineAdapter();

      // trajectory_plan with explicit boundary conditions and limits
      const trajReq = new JobRequest({
        jobId: 'rob_traj_cov',
        domain: 'robotics',
        operation: 'trajectory_plan',
        parameters: {
          q0: [0.0, 0.0],
          qf: [1.0, 1.0],
          duration: 1.0,
          vf: [0.0, 0.0],
          af: [0.0, 0.0],
          numSteps: 5,
          dhTable: [
            { a: 1.0, alpha: 0.0, d: 0.0, theta: 0.0 },
            { a: 1.0, alpha: 0.0, d: 0.0, theta: 0.0 }
          ]
        }
      });
      const trajRes = await adapter.execute(trajReq);
      assert.strictEqual(trajRes.outputData.operation, 'trajectory_plan');
      assert(trajRes.outputData.perJointMaxPosition.length === 2);

      // parse_urdf with complete mass
      const urdfXml = `
      <robot name="arm3">
        <link name="base">
          <inertial>
            <origin xyz="0 0 0" rpy="0 0 0"/>
            <mass value="5.0"/>
            <inertia ixx="0.5" ixy="0" ixz="0" iyy="0.5" iyz="0" izz="0.5"/>
          </inertial>
        </link>
        <link name="forearm">
          <inertial>
            <origin xyz="0.5 0 0" rpy="0 0 0"/>
            <mass value="2.5"/>
            <inertia ixx="0.25" ixy="0" ixz="0" iyy="0.25" iyz="0" izz="0.25"/>
          </inertial>
        </link>
        <joint name="j1" type="revolute">
          <parent link="base"/>
          <child link="forearm"/>
          <origin xyz="1 0 0" rpy="0 0 0"/>
          <axis xyz="0 0 1"/>
          <limit lower="-1.5" upper="1.5" effort="50" velocity="2"/>
        </joint>
      </robot>
    `;
      const urdfReq = new JobRequest({
        jobId: 'rob_urdf_cov',
        domain: 'robotics',
        operation: 'parse_urdf',
        parameters: { urdfXml }
      });
      const urdfRes = await adapter.execute(urdfReq);
      assert.strictEqual(urdfRes.outputData.name, 'arm3');
      assert.strictEqual(urdfRes.outputData.totalMass.valueSi, 7.5);
      passedTests++;
      console.log('  ✓ PASSED: RoboticsEngineAdapter trajectory and URDF paths covered');
    }

    // 3. Symbolic Engineering Reasoner & Physical Dimensions
    currentSection = '[3/6] Symbolic Reasoner';
    console.log('\n[3] Symbolic Reasoner & Physical Dimensions...');
    {
      const dim1 = new PhysicalDimension([1, 2, -2, 0, 0, 0, 0]); // Energy (J)
      assert.strictEqual(dim1.toArray().length, 7);
      assert.strictEqual([...dim1].length, 7);

      const dimFromArray = PhysicalDimension.fromArray([1, 2, -2, 0, 0, 0, 0]);
      assert.strictEqual(dimFromArray.equals(dim1), true);

      const dimLegacy = PhysicalDimension.fromLegacy5(1, 2, -2, 0, 0);
      assert.strictEqual(dimLegacy.equals(dim1), true);

      const dimVisc = PhysicalDimension.dynamicViscosity();
      assert.strictEqual(dimVisc.m, 1);
      assert.strictEqual(dimVisc.l, -1);
      assert.strictEqual(dimVisc.t, -1);

      const dimTherm = PhysicalDimension.thermalConductivity();
      assert.strictEqual(dimTherm.m, 1);
      assert.strictEqual(dimTherm.l, 1);
      assert.strictEqual(dimTherm.t, -3);

      const dimSum = dim1.add(dimFromArray);
      assert.strictEqual(dimSum.l, 2);
      const dimDiff = dim1.sub(dimFromArray);
      assert.strictEqual(dimDiff.l, 2);

      const qty = new DimensionalQuantity(100, 'J', dim1);
      const archQty = qty.toQuantity();
      assert.strictEqual(archQty.valueSi, 100);

      const reasoner = new SymbolicReasoner();
      const heatFlux = reasoner.knowledgeGraph.calculateHeatFlux(0.05, 50.0, 2.0, 400.0, 300.0);
      assert(heatFlux.heatFlowWatts > 0);

      const qCreated = reasoner.createQuantity(50, 'kg');
      assert.strictEqual(qCreated.magnitude, 50);

      const qVerify = reasoner.verifyEquation(
        new DimensionalQuantity(10, 'N'),
        new DimensionalQuantity(10, 'N'),
        'ForceEquivalence'
      );
      assert.strictEqual(qVerify, true);

      // Regex prompt extraction in lexer
      const intentPayload = reasoner.parseIntent('design a payload of 500 g with 10 bar pressure');
      assert.strictEqual(typeof intentPayload, 'object');

      const intentTemp = reasoner.parseIntent('cool to 25.5 C');
      assert.strictEqual(typeof intentTemp, 'object');

      const healed = reasoner.selfHealStructuralYield(
        {
          wallThicknessMm: 2.0,
          loadN: 100,
          lengthMm: 100,
          widthMm: 10,
          yieldStrengthMPa: 250,
          youngsModulusGPa: 200,
          minThicknessMm: 1.0,
          maxThicknessMm: 10.0
        },
        1.5
      );
      assert(healed.estimate.candidateThicknessMm > 0);
      passedTests++;
      console.log('  ✓ PASSED: SymbolicEngineeringReasoner and PhysicalDimension covered');
    }

    // 4. Cloud & HPC Compute Providers
    currentSection = '[4/6] HPC Compute Providers';
    console.log('\n[4] Cloud & HPC Compute Providers...');
    {
      // LocalComputeProvider
      const local = new LocalComputeProvider();
      assert.strictEqual(local.type, 'local');
      assert.strictEqual(local.setMembership(false).success, true);
      assert.strictEqual(local.setMembership(true).success, true);
      assert.strictEqual(local.getClusterStatus().success, true);
      const localDecomp = local.computeDomainDecomposition(100, 4);
      assert.strictEqual(localDecomp.numPartitions, 4);
      assert.strictEqual(localDecomp.domains.length, 4);
      const localJob = await local.submitSimulationJob('ECHO_TEST', { message: 'local-job' }, 1);
      assert.strictEqual(localJob.result.result.echo, 'ok');

      // SlurmComputeProvider
      const slurm = new SlurmComputeProvider({ partition: 'gpu', nodes: 2 });
      assert.strictEqual(slurm.type, 'slurm');
      assert.strictEqual(slurm.setMembership(true).success, false);
      assert.strictEqual(slurm.getClusterStatus().configured, false);
      assert.strictEqual(slurm.getClusterStatus().status, 'UNAVAILABLE');
      const slurmDecomp = slurm.computeDomainDecomposition(50, 2);
      assert.strictEqual(slurmDecomp.numPartitions, 2);
      const slurmJob = slurm.submitSimulationJob('cfd_rans', { mesh: 'wing' }, 2);
      assert.strictEqual(slurmJob.scheduler, 'SLURM');
      assert.strictEqual(slurmJob.status, 'SCRIPT_TEMPLATE_ONLY');
      assert.strictEqual(slurmJob.submitted, false);

      // PbsComputeProvider
      const pbs = new PbsComputeProvider({ queue: 'workq' });
      assert.strictEqual(pbs.type, 'pbs');
      assert.strictEqual(pbs.setMembership(true).success, false);
      assert.strictEqual(pbs.getClusterStatus().configured, false);
      assert.strictEqual(pbs.getClusterStatus().status, 'UNAVAILABLE');
      const pbsDecomp = pbs.computeDomainDecomposition(80, 4);
      assert.strictEqual(pbsDecomp.numPartitions, 4);
      const pbsJob = pbs.submitSimulationJob('fea_modal', { nodes: 100 }, 4);
      assert.strictEqual(pbsJob.scheduler, 'PBS_PRO');
      assert.strictEqual(pbsJob.status, 'SCRIPT_TEMPLATE_ONLY');
      assert.strictEqual(pbsJob.submitted, false);
      passedTests++;
      console.log('  ✓ PASSED: Local, Slurm, and PBS HPC compute providers covered');
    }

    // 5. Worker Pool: Legacy Queue & PersistentWorkerPool Telemetry
    currentSection = '[5/6] Worker Pool';
    console.log('\n[5] Worker Pool Methods & Telemetry...');
    {
      // ExperimentalCalculationQueue: priority scheduling, timeout, buffer
      const queue = new ExperimentalCalculationQueue();
      const p1 = queue.dispatch('ECHO_TEST', { message: 'task-batch', delayMs: 1 }, { priority: 'BATCH' });
      const p2 = queue.dispatch('ECHO_TEST', { message: 'task-high', delayMs: 1 }, { priority: 'HIGH' });
      const [res1, res2] = await Promise.all([p1, p2]);
      assert.strictEqual(res1.result.echo, 'task-batch');
      assert.strictEqual(res2.result.echo, 'task-high');

      const buf = queue.allocateSharedBuffer(1024);
      assert.strictEqual(buf.byteLength, 1024);

      // PersistentWorkerPool: telemetry, shared buffer, global accessors
      const pool = new PersistentWorkerPool({ maxWorkers: 1 });
      localPools.push(pool);
      const pEcho = await pool.dispatch('ECHO_TEST', { message: 'pool-test' }, { priority: 'HIGH' });
      assert.strictEqual(pEcho.result.echo, 'pool-test');

      const poolBuf = pool.allocateSharedBuffer(2048);
      assert.strictEqual(poolBuf.byteLength, 2048);

      const telemetry = pool.getTelemetry();
      assert(telemetry.completedTasksCount >= 1);
      assert.strictEqual(telemetry.activeTasks, 0);

      // Global singletons
      const gPool = getGlobalWorkerPool();
      assert(gPool instanceof ExperimentalCalculationQueue);
      const gPersist = getGlobalPersistentWorkerPool();
      assert(gPersist instanceof PersistentWorkerPool);

      await pool.terminateAll();
      passedTests++;
      console.log('  ✓ PASSED: Worker Pool priority scheduling, buffers, and telemetry covered');
    }

    // 6. OmniArchive v2 Extended Methods
    currentSection = '[6/6] OmniArchive Storage';
    console.log('\n[6] OmniArchive Storage & Manifest Methods...');
    {
      const archive = new OmniArchiveV2();
      assert.strictEqual(archive.manifest.revision, 1);

      // bumpRevision
      archive.bumpRevision({ name: 'Pump Revision 2' });
      assert.strictEqual(archive.manifest.revision, 2);
      assert.strictEqual(archive.manifest.name, 'Pump Revision 2');

      // recordResult
      const jobRes = new JobResult({
        jobId: 'j_arch_test',
        domain: 'cad',
        status: 'COMPLETED',
        outputData: { mesh: 'ok' }
      });
      archive.recordResult(jobRes);
      assert.strictEqual(archive.results.length, 1);

      // Blobs
      const artRef = archive.addBlob(Buffer.from('engineering blob data'));
      assert.strictEqual(archive.hasBlob(artRef.hash), true);
      assert(archive.listBlobs().includes(artRef.hash));

      // Journal & History
      archive.journal.execute('cad.create_box', { width: 10 }, { width: 0 }, 'Created box', 'Engineer');
      assert.strictEqual(archive.journal.canUndo(), true);
      archive.journal.undo();
      assert.strictEqual(archive.journal.canRedo(), true);
      archive.journal.redo();
      const history = archive.journal.getHistory();
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].actionType, 'cad.create_box');

      // Atomic sync and crash recovery
      const tmpDir = os.tmpdir();
      const testProjPath = path.join(tmpDir, `test_omni_${Date.now()}.omni`);
      archive.saveAtomicSync(testProjPath);
      assert.strictEqual(fs.existsSync(testProjPath), true);

      OmniArchiveV2.recordAcknowledgedCommandSync(testProjPath, {
        id: 'cmd_1',
        actionType: 'cad.fillet',
        description: 'Fillet edge'
      });
      const recovered = OmniArchiveV2.recoverFromCrash(testProjPath);
      assert.strictEqual(recovered.recoveredCount, 1);
      assert.strictEqual(recovered.commands[0].actionType, 'cad.fillet');

      // Cleanup temp files
      try {
        if (fs.existsSync(testProjPath)) fs.unlinkSync(testProjPath);
        const recFile = `${testProjPath}.recovery.journal`;
        if (fs.existsSync(recFile)) fs.unlinkSync(recFile);
      } catch (_) {}

      // fromV1
      assert.throws(() => OmniArchiveV2.fromV1({}), /fromV1 requires an OmniArchive instance/);
      const v1 = new OmniArchive();
      v1.addSection('mesh_data', Buffer.from('v1 mesh content'));
      const migrated = OmniArchiveV2.fromV1(v1);
      assert(migrated instanceof OmniArchiveV2);
      assert(migrated.listBlobs().length >= 1);
      passedTests++;
      console.log('  ✓ PASSED: OmniArchive extended storage and crash recovery covered');
      // Clean up persistent global pool
      await getGlobalPersistentWorkerPool().terminateAll();
    }
  } catch (error) {
    failedTests++;
    console.error(`  ✗ FAILED: ${currentSection}`);
    console.error(error?.stack || error);
  } finally {
    for (const pool of localPools) await pool.terminateAll();
    await getGlobalPersistentWorkerPool().terminateAll();
  }

  const totalTests = passedTests + failedTests;
  console.log('\n================================================================');
  console.log(`   ROBOTICS/AI/HPC COVERAGE: ${passedTests}/${totalTests} sections passed; ${failedTests} failed`);
  console.log('================================================================');
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

if (require.main === module) {
  runRoboticsAiHpcCoverageTests()
    .then((stats) => {
      if (stats.failed > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error('Test suite setup failed:', error?.stack || error);
      process.exitCode = 1;
    });
}

module.exports = { runRoboticsAiHpcCoverageTests };
