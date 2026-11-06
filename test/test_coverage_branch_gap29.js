'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 29).
 *
 * Targets remaining uncovered branch blocks in the robotics (kinematics,
 * adapter, collision), HPC (cloud cluster, gateway, adapter, local scheduler,
 * local worker), AI (neural net, omni AI engine, symbolic reasoner),
 * controls/PDM engine adapters, dynamic Simulink utilities (block graph, HIL
 * telemetry, MC/DC coverage, multi-rate scheduler, S-function plugin host),
 * CAM (toolpath engine, planar offset geometry, adapter), co-simulation
 * (FMU reader, domain route), and materials modules. No production source is
 * modified.
 */

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  CloudHPCEngine,
  LocalComputeProvider,
  SlurmComputeProvider,
  PbsComputeProvider
} = require('../src/core/hpc/cloud_cluster');
const { LocalCluster, JOB_STATES } = require('../src/core/hpc/local_scheduler');
const { HpcClusterGateway } = require('../src/core/hpc/hpc_cluster_gateway');
const { HPCEngineAdapter, shutdownSharedLocalCluster } = require('../src/core/hpc/hpc_engine_adapter');
const {
  NeuralNetwork,
  createNetwork,
  gradientCheck,
  trainSurrogate,
  predictSurrogate,
  saveModel,
  loadModel
} = require('../src/core/ai/neural_net');
const { OmniAIEngine } = require('../src/core/ai/omni_ai_engine');
const {
  PhysicalDimension,
  SymbolicPhysicsKnowledgeGraph,
  NelderMeadOptimizer,
  DeterministicIntentLexer,
  SymbolicReasoner
} = require('../src/core/ai/symbolic_reasoner');
const { ControlsEngineAdapter } = require('../src/core/controls/controls_engine_adapter');
const { CAMEngineAdapter } = require('../src/core/cam/cam_engine_adapter');
const { CNCToolpathEngine } = require('../src/core/cam/cnc_toolpath_engine');
const planar = require('../src/core/cam/planar_offset_geometry');
const { BlockDiagramGraph, BlockGraph } = require('../src/core/dynamic_simulink/block_graph');
const {
  ScheduledTask,
  MultiRateScheduler,
  AlgebraicLoopSolver,
  ModernControlSynthesis
} = require('../src/core/dynamic_simulink/multi_rate_scheduler');
const { SFunctionPluginHost } = require('../src/core/dynamic_simulink/s_function_plugin_host');
const { HILTelemetryEngine } = require('../src/core/dynamic_simulink/hil_telemetry');
const { MCDCCoverageAnalyzer } = require('../src/core/dynamic_simulink/mcdc_coverage');
const { MaterialManager, MATERIAL_DATABASE, interpolateProperty } = require('../src/core/materials/material_database');
const { CosimDomainRoute } = require('../src/core/cosim/cosim_domain_route');
const { FmuReader, FmuExecutionHost, FmuError } = require('../src/core/cosim/fmu_reader');
const { PDMEngineAdapter } = require('../src/core/pdm/pdm_engine_adapter');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { SerialManipulatorEngine, PUMA_560_DH } = require('../src/core/robotics/serial_manipulator_kinematics');
const coll = require('../src/core/robotics/collision_checks');

const ZEROS6 = [0, 0, 0, 0, 0, 0];

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function toolOptions(overrides = {}) {
  return {
    toolDiameter: 6,
    toolType: 'flat_endmill',
    spindleRpm: 12000,
    feedRateMmMin: 600,
    plungeRateMmMin: 200,
    stepoverMm: 2.4,
    stepdownMm: 1.5,
    safeZ: 10,
    ...overrides
  };
}

function simpleBounds() {
  return { minX: 0, maxX: 40, minY: 0, maxY: 30, minZ: 0, maxZ: 8 };
}

function simpleBoundary() {
  return [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 30 },
    { x: 0, y: 30 }
  ];
}

function bomNode(partNumber, name, quantity, children = [], extra = {}) {
  return { partNumber, name, quantity, unitMassKg: 1.2, unitCostUsd: 3.4, children, ...extra };
}

async function runBranchGapTwentyNineCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const pending = [];
  if (process.env.GAP29_SEQ === '1') console.error('[gap29] start');

  function check(name, fn) {
    totalTests++;
    pending.push(async () => {
      try {
        await fn();
        passedTests++;
        console.log(`  ✓ PASSED: ${name}`);
      } catch (err) {
        failedTests++;
        console.error(`  ✗ FAILED: ${name}`);
        console.error(`    ${err.message}`);
      }
    });
  }

  // ------------------------------------------------------------------
  // HPC cluster gateway
  // ------------------------------------------------------------------
  check('HpcClusterGateway script generators, transitions, telemetry', async () => {
    const slurm = HpcClusterGateway.generateSlurmScript({
      jobName: 'cov29',
      partition: 'compute',
      nodes: 2,
      ntasksPerNode: 8,
      cpusPerTask: 2,
      gpusPerNode: 1,
      memoryPerNode: '32GB',
      walltime: '02:30:00',
      account: 'acct',
      qos: 'normal',
      email: 'a@b.c',
      modules: ['gcc/11', 'openmpi/4'],
      executable: 'omnieng',
      args: ['-x', '1'],
      command: ['omnieng', '-c', '2']
    });
    assert.strictEqual(slurm.scheduler, 'SLURM');
    assert(slurm.script.includes('--gres=gpu:1'));
    assert(slurm.script.includes('--account=acct'));
    assert(slurm.script.includes('--mail-user=a@b.c'));
    assert(slurm.script.includes('omnieng -c 2'));
    assert.throws(() => HpcClusterGateway.generateSlurmScript(null), /job spec object/);
    assert.throws(() => HpcClusterGateway.generateSlurmScript([]), /job spec object/);
    assert.throws(() => HpcClusterGateway.generateSlurmScript({ nodes: 'two' }), /integer/);
    assert.throws(() => HpcClusterGateway.generateSlurmScript({ walltime: '25:99:99' }), /HH:MM:SS/);
    assert.throws(() => HpcClusterGateway.generateSlurmScript({ modules: [7] }), /non-empty strings/);

    const pbs = HpcClusterGateway.generatePbsProScript({
      queue: 'batch',
      nodes: 2,
      mpiRanksPerNode: 4,
      memoryPerNode: '16GB',
      account: 'acct',
      email: 'x@y.z',
      command: 'run.sh'
    });
    assert.strictEqual(pbs.scheduler, 'PBS_PRO');
    assert(pbs.script.includes('#PBS -A acct'));
    assert(pbs.script.includes('#PBS -M x@y.z'));
    assert.throws(() => HpcClusterGateway.generatePbsProScript([1]), /job spec object/);

    const parts = HpcClusterGateway.partitionRcb(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 }
      ],
      4
    );
    assert.strictEqual(parts.status, 'PARTITIONED');
    assert.strictEqual(parts.numPartitions, 4);
    assert(parts.domains.some((d) => d.indices.length === 1));
    assert.strictEqual(HpcClusterGateway.partitionRcb([]).length, 0);

    const gw = new HpcClusterGateway();
    const job = gw.submitJob({ scheduler: 'SLURM', jobName: 't', nodes: 1, ntasksPerNode: 2 });
    gw.markRunning(job.jobId);
    assert.throws(() => gw.markRunning(job.jobId), /Illegal/);
    gw.failJob(job.jobId, new Error('boom'));
    assert.strictEqual(gw.getJob(job.jobId).status, 'FAILED');
    assert.throws(() => gw.markCompleted(job.jobId), /Illegal/);
    const job2 = gw.submitJob({ scheduler: 'SLURM', jobName: 't2', nodes: 1 });
    gw.markRunning(job2.jobId);
    gw.markCompleted(job2.jobId);
    assert.throws(() => gw.markCompleted(job2.jobId), /Illegal/);
    assert.throws(() => gw.getJob('missing'), /Unknown HPC job/);
    assert.throws(() => gw._transition('nope', 'RUNNING', 'x'), /Unknown HPC job/);
    assert.strictEqual(gw.listJobs({ status: 'QUEUED' }).length, 0);
    assert.strictEqual(gw.listJobs({ status: 'FAILED' }).length, 1);

    const gw2 = new HpcClusterGateway({ workerPool: {} });
    const tele = gw2.getTelemetry();
    assert(tele.workerPool && typeof tele.workerPool === 'object');
    gw2.setMembership(false);
    assert.strictEqual(gw2.getClusterStatus().status, 'OFFLINE');
    assert.throws(() => gw.submitJob({ scheduler: 'BAD' }), /Unsupported scheduler/);
    assert.throws(() => gw.submitSimulationJob('', {}, 1), /job type/);
    assert.throws(() => gw.submitSimulationJob('x', null, 1), /parameter object/);
    assert.throws(() => gw.submitSimulationJob('x', {}, 0), /rank count/);
    const sj = gw2.submitSimulationJob('solve', { jobName: 'q' }, 4);
    assert.strictEqual(sj.success, true);
  });

  // ------------------------------------------------------------------
  // Local cluster scheduler + worker
  // ------------------------------------------------------------------
  check('LocalCluster submit/waitFor/cancel/verify edge branches', async () => {
    const cluster = new LocalCluster({ maxWorkers: 1 });
    assert.throws(() => cluster.submit(null), /descriptor object/);
    assert.throws(() => cluster.submit([]), /descriptor object/);
    const circular = {};
    circular.self = circular;
    assert.throws(() => cluster.submit(circular), /JSON-serializable/);
    await assert.rejects(() => cluster.waitFor('unknown-job'), /Unknown job id/);

    const spin = cluster.submit({ taskType: 'spin_wait', spinMs: 5 });
    const spinJob = await cluster.waitFor(spin.jobId, { timeoutMs: 20000 });
    assert.strictEqual(spinJob.status, JOB_STATES.COMPLETED);
    const again = await cluster.waitFor(spin.jobId, { timeoutMs: 5000 });
    assert.strictEqual(again.status, JOB_STATES.COMPLETED);
    assert.strictEqual(cluster.cancel(spin.jobId), false);
    assert.throws(() => cluster.cancel('missing'), /Unknown job id/);
    assert.strictEqual(cluster.getJob(spin.jobId).result.spinMs, 5);
    assert.strictEqual(cluster.listJobs().length, 1);
    assert.strictEqual(cluster.listJobs({ status: 'COMPLETED' }).length, 1);

    const bad = cluster.submit({ taskType: 'not_a_task' });
    const badJob = await cluster.waitFor(bad.jobId, { timeoutMs: 20000 });
    assert.strictEqual(badJob.status, JOB_STATES.FAILED);
    cluster.shutdown();
  });

  check('LocalCluster queued/running cancel, shutdown, worker exit', async () => {
    const cluster = new LocalCluster({ maxWorkers: 1 });
    const slow1 = cluster.submit({ taskType: 'spin_wait', spinMs: 4000 });
    await new Promise((resolve) => setImmediate(resolve));
    const queued = cluster.submit({ taskType: 'spin_wait', spinMs: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(queued.status, JOB_STATES.QUEUED);
    assert.strictEqual(cluster.cancel(queued.jobId), true);
    const qJob = cluster.getJob(queued.jobId);
    assert.strictEqual(qJob.status, JOB_STATES.FAILED);
    assert.strictEqual(qJob.error.code, 'CANCELLED');
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(cluster.cancel(slow1.jobId), true);
    const rJob = await cluster.waitFor(slow1.jobId, { timeoutMs: 20000 });
    assert.strictEqual(rJob.status, JOB_STATES.FAILED);
    assert.strictEqual(rJob.error.code, 'CANCELLED');
    cluster.shutdown();
  });

  check('LocalCluster verifyResult branches and worker exit handling', async () => {
    const cluster = new LocalCluster({ maxWorkers: 1, jobTimeoutMs: 30000 });
    const mkJob = (spec) => ({
      jobId: 'j',
      spec,
      status: JOB_STATES.RUNNING,
      transitions: [{ from: null, to: JOB_STATES.QUEUED, event: 'submit', at: new Date().toISOString() }]
    });

    assert.strictEqual(cluster._verifyResult(mkJob({}), null), 'Worker returned a non-object result');
    let job = mkJob({ taskType: 'spin_wait' });
    assert.strictEqual(
      cluster._verifyResult(job, { checksum: 'bad', spinMs: 1, elapsedMs: 1 }),
      'Result checksum mismatch (IPC payload integrity check failed)'
    );
    job = mkJob({ taskType: 'poisson_sparse_cholesky', n: 5 });
    let payload = { solution: 'nope', relativeResidual: 0, elapsedMs: 1 };
    assert.strictEqual(
      cluster._verifyResult(job, { ...payload, checksum: sha256(payload) }),
      'Result is missing a valid solution vector'
    );
    payload = { solution: new Array(24).fill(0), relativeResidual: 0, elapsedMs: 1 };
    const dimMsg = cluster._verifyResult(job, { ...payload, checksum: sha256(payload) });
    assert(dimMsg && dimMsg.includes('Solver dimension mismatch'));
    payload = { solution: new Array(25).fill(0), relativeResidual: 1, elapsedMs: 1 };
    let v = cluster._verifyResult(job, { ...payload, checksum: sha256(payload) });
    assert(v && v.includes('exceeds tolerance'));
    const { buildPoissonSystem } = require('../src/core/hpc/poisson_system');
    const { SparseCholeskySolver } = require('../src/core/math/sparse_cholesky');
    const { A, b } = buildPoissonSystem(5);
    const solved = SparseCholeskySolver.solve(A, b, { maxIterations: 1000, tolerance: 1e-10 });
    payload = { solution: Array.from(solved.x), relativeResidual: 0.5, elapsedMs: 1 };
    v = cluster._verifyResult(job, { ...payload, checksum: sha256(payload) });
    assert(v && v.includes('inconsistent'));
    job = mkJob({ taskType: 'poisson_sparse_cholesky', n: 5, tolerance: 10 });
    payload = { solution: new Array(25).fill(0), relativeResidual: 1, elapsedMs: -1 };
    v = cluster._verifyResult(job, { ...payload, checksum: sha256(payload) });
    assert(v && v.includes('elapsed time'));
    job = mkJob({ taskType: 'spin_wait' });
    payload = { spinMs: 'x', elapsedMs: NaN };
    assert.strictEqual(
      cluster._verifyResult(job, { ...payload, checksum: sha256(payload) }),
      'Spin task returned non-finite metrics'
    );
    payload = { spinMs: 1, elapsedMs: 2 };
    assert.strictEqual(cluster._verifyResult(job, { ...payload, checksum: sha256(payload) }), null);
    job = mkJob({ taskType: 'mystery' });
    assert(cluster._verifyResult(job, { checksum: sha256({}) }).includes('unknown task type'));

    const fresh = mkJob({ taskType: 'spin_wait' });
    cluster._failJob(fresh, 'CODE', 'msg');
    assert.strictEqual(fresh.status, JOB_STATES.FAILED);
    assert.strictEqual(fresh.error.code, 'CODE');
    cluster._failJob(fresh, 'CODE2', 'ignored');
    assert.strictEqual(fresh.error.code, 'CODE');

    const box = new LocalCluster({ maxWorkers: 1, jobTimeoutMs: 20000 });
    const spin = box.submit({ taskType: 'spin_wait', spinMs: 20000 });
    await new Promise((resolve) => setImmediate(resolve));
    const entry = box._running.get(spin.jobId);
    assert(entry && entry.worker, 'worker should be running');
    entry.worker.kill('SIGKILL');
    const term = await box.waitFor(spin.jobId, { timeoutMs: 20000 });
    assert.strictEqual(term.status, JOB_STATES.FAILED);
    box.shutdown();
  });

  // ------------------------------------------------------------------
  // Cloud cluster providers
  // ------------------------------------------------------------------
  check('CloudHPCEngine provider forms and script-only submissions', async () => {
    const local = new CloudHPCEngine({ provider: 'local' });
    assert.strictEqual(local.getClusterStatus().status, 'READY');
    assert.strictEqual(local.setMembership(true).active, true);
    assert.strictEqual(local.setMembership(false).active, false);
    assert.strictEqual(local.setMembership(true).active, true);
    const dom = local.computeDomainDecomposition();
    assert(dom.numPartitions >= 1);
    const dom2 = local.computeDomainDecomposition(10, 2);
    assert(dom2.numPartitions >= 1);

    const slurm = new CloudHPCEngine({ provider: 'slurm' });
    const s = slurm.submitSimulationJob('solve', { jobName: 'cov' }, 32);
    assert.strictEqual(s.success, true);
    assert.strictEqual(s.provider, 'slurm');
    assert(s.submissionSpec.script.includes('srun'));
    const pbs = new CloudHPCEngine({ provider: 'pbs' });
    const p = pbs.submitSimulationJob('solve', {}, 9);
    assert.strictEqual(p.success, true);
    assert(p.submissionSpec.script.includes('mpiexec'));
    assert.strictEqual(pbs.getClusterStatus().success, false);
    assert.strictEqual(pbs.setMembership().success, false);

    const asObj = new CloudHPCEngine({ provider: { type: 'local' } });
    assert.strictEqual(asObj.getClusterStatus().provider, 'local');
    const asSlurm = new CloudHPCEngine({ provider: { type: 'slurm' } });
    assert.strictEqual(asSlurm.submitSimulationJob('x', {}, 4).success, true);
    const asPbs = new CloudHPCEngine({ provider: { type: 'pbs' } });
    assert.strictEqual(asPbs.submitSimulationJob('x', {}, 4).success, true);
    const custom = new CloudHPCEngine({ provider: { type: 'custom' } });
    assert.strictEqual(custom.getClusterStatus().success, false);
    assert.strictEqual(custom.setMembership(true).success, false);
    assert.strictEqual(custom.computeDomainDecomposition(5).success, false);
    assert.strictEqual(custom.submitSimulationJob('x', {}, 2).success, false);
    const none = new CloudHPCEngine({ provider: null });
    assert.strictEqual(none.getClusterStatus().success, false);
    assert.strictEqual(none.setMembership().success, false);
    assert.strictEqual(none.computeDomainDecomposition().success, false);
    assert.strictEqual(none.submitSimulationJob('x', {}).success, false);

    const provider = new LocalComputeProvider();
    assert.strictEqual(provider.getClusterStatus().active, true);
    provider.setMembership(false);
    assert.strictEqual(provider.getClusterStatus().status, 'OFFLINE');
    const slurmProvider = new SlurmComputeProvider();
    assert.strictEqual(slurmProvider.getClusterStatus().status, 'UNAVAILABLE');
    const pbsProvider = new PbsComputeProvider();
    assert.strictEqual(pbsProvider.getClusterStatus().status, 'UNAVAILABLE');
    assert.strictEqual(pbsProvider.setMembership().success, false);
  });

  // ------------------------------------------------------------------
  // HPC engine adapter
  // ------------------------------------------------------------------
  check('HPCEngineAdapter validation branches', async () => {
    const adapter = new HPCEngineAdapter();
    const job = (operation, parameters) => ({ jobId: `h29-${operation}`, domain: 'hpc', operation, parameters });
    const rejects = async (operation, parameters, pattern) => {
      await assert.rejects(() => adapter.execute(job(operation, parameters)), pattern);
    };
    await rejects('partition_rcb', {}, /non-empty points/);
    await rejects('partition_rcb', { points: [{ x: NaN, y: 0, z: 0 }] }, /finite x, y, z/);
    await rejects('partition_rcb', { points: [{ x: 0, y: 0, z: 0 }], numPartitions: 0 }, /numPartitions/);
    await rejects('partition_rcb', { points: [{ x: 0, y: 0, z: 0 }], numPartitions: 65 }, /numPartitions/);
    await rejects('plan_out_of_core', {}, /DOF count/);
    await rejects('plan_out_of_core', { dofCount: 10, availableRamBytes: 1e9 }, /matrix\/factor entries/);
    await rejects(
      'plan_out_of_core',
      { dofCount: 10, availableRamBytes: 1e9, assumptions: { matrixNonzerosPerDof: 0, factorEntriesPerDof: 2 } },
      /matrix\/factor entries/
    );
    await rejects(
      'plan_out_of_core',
      { dofCount: 10, availableRamBytes: 1e9, assumptions: { matrixNonzerosPerDof: 1e13, factorEntriesPerDof: 2 } },
      /matrix\/factor entries/
    );
    await rejects('execute_local_parallel', {}, /taskType/);
    await rejects('execute_local_parallel', { taskType: 'x' }, /payload object/);
    await rejects('execute_local_parallel', { taskType: 'x', payload: { a: 1 }, timeoutMs: 50 }, /timeoutMs/);
    await rejects('execute_local_parallel', { taskType: 'x', payload: { a: 1 }, priority: 'URGENT' }, /priority/);
    await rejects('hpc:local-dispatch', {}, /descriptor object/);
    await rejects('hpc:local-dispatch', { descriptor: { taskType: 'weird' } }, /not supported by the local worker/);
    await rejects('hpc:local-dispatch', { descriptor: { taskType: 'spin_wait' }, timeoutMs: 10 }, /timeoutMs/);
    await rejects('unknown_op', { a: 1 }, /not supported by adapter/);
    const abortedJob = job('generate_slurm_script', {});
    await assert.rejects(() => adapter.execute(abortedJob, () => {}, { aborted: true }), /cancelled/i);
  });

  check('HPCEngineAdapter execute success paths', async () => {
    const adapter = new HPCEngineAdapter();
    const job = (operation, parameters) => ({ jobId: `h29x-${operation}`, domain: 'hpc', operation, parameters });
    const slurm = await adapter.execute(job('generate_slurm_script', { jobName: 'cov', nodes: 1 }));
    assert.strictEqual(slurm.status, 'COMPLETED');
    assert(slurm.outputData.script.includes('#SBATCH'));
    const pbs = await adapter.execute(job('generate_pbs_script', {}));
    assert(pbs.outputData.script.includes('#PBS'));
    const rcb = await adapter.execute(
      job('partition_rcb', {
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 }
        ],
        numPartitions: 2
      })
    );
    assert.strictEqual(rcb.outputData.numPartitions, 2);
    const ooc = await adapter.execute(
      job('plan_out_of_core', {
        dofCount: 100,
        availableRamBytes: 1e9,
        assumptions: { matrixNonzerosPerDof: 10, factorEntriesPerDof: 20 }
      })
    );
    assert.strictEqual(ooc.outputData.status, 'ESTIMATE_ONLY');
    const tele = await adapter.execute(job('get_cluster_telemetry', {}));
    assert(tele.outputData.workerPool && typeof tele.outputData.workerPool === 'object');
    assert(Array.isArray(tele.outputData.perWorkerBusy));

    const spin = await adapter.execute(job('hpc:local-dispatch', { descriptor: { taskType: 'spin_wait', spinMs: 5 } }));
    assert.strictEqual(spin.status, 'COMPLETED');
    assert.strictEqual(spin.outputData.status, 'COMPLETED');
    assert.strictEqual(spin.outputData.executionPerformed, true);

    const fail = await adapter.execute(
      job('hpc:local-dispatch', { descriptor: { taskType: 'poisson_sparse_cholesky', n: 3, tolerance: NaN } })
    );
    assert.strictEqual(fail.status, 'FAILED');
    assert.strictEqual(fail.outputData.status, 'FAILED');
    assert(fail.outputData.error);

    shutdownSharedLocalCluster();
  });

  // ------------------------------------------------------------------
  // Neural network API edges
  // ------------------------------------------------------------------
  check('NeuralNetwork config-from-layers and validation branches', () => {
    const layers = [
      {
        fanIn: 2,
        fanOut: 3,
        activation: 'tanh',
        W: [
          [0.1, 0.2],
          [0.3, 0.4],
          [0.5, 0.6]
        ],
        b: [0, 0, 0]
      },
      { fanIn: 3, fanOut: 1, activation: 'linear', W: [[0.1, 0.2, 0.3]], b: [0] }
    ];
    const net = new NeuralNetwork({ inputSize: 2, layers, loss: 'mse', meta: { tag: 'x' } });
    assert.strictEqual(net.loss, 'mse');
    assert.deepStrictEqual(net.meta, { tag: 'x' });
    assert.throws(() => new NeuralNetwork({ inputSize: 0 }), /inputSize/);
    assert.throws(() => new NeuralNetwork({ inputSize: 2, outputSize: 1, hiddenUnits: [0] }), /hiddenUnits/);
    assert.throws(() => new NeuralNetwork({ inputSize: 2, outputSize: 1, activation: 'softmax' }), /Hidden activation/);
    assert.throws(() => new NeuralNetwork({ inputSize: 2, outputSize: 1, loss: 'bogus' }), /Loss/);
    assert.throws(
      () => new NeuralNetwork({ inputSize: 2, outputSize: 1, outputActivation: 'bogus' }),
      /output activation/
    );
    assert.throws(() => new NeuralNetwork({ inputSize: 2, outputSize: 1, outputActivation: 'softmax' }), /softmax/);
    assert.throws(
      () => new NeuralNetwork({ inputSize: 2, outputSize: 1, loss: 'crossEntropy', outputActivation: 'linear' }),
      /crossEntropy/
    );

    const trained = createNetwork({ inputSize: 2, outputSize: 1, hiddenUnits: [3] });
    assert.throws(() => trained.train([], []), /non-empty/);
    assert.throws(() => trained.train([[1, 2]], [[0.5], [0.5]]), /equal length/);
    assert.throws(() => trained.train([[1]], [[0.5]]), /inputSize/);
    assert.throws(() => trained.train([[1, 2]], [[0.5, 0.5]]), /output size/);
    const r = trained.train(
      [
        [1, 2],
        [0, 1]
      ],
      [[0.5], [0.8]],
      { epochs: -3, batchSize: 16 }
    );
    assert(Array.isArray(r.lossHistory) && r.lossHistory.length > 0);
    assert.throws(() => trained.train([[1, 'x']], [[0.5]]), /finite numbers/);

    assert.throws(() => gradientCheck('not-a-net', [], []), /gradientCheck requires/);
    assert.throws(() => gradientCheck(trained, [[1, 2]], [[0.5]], { loss: 'bad' }), /Unknown loss/);
    const gc = gradientCheck(trained, [[1, 2]], [[0.5]], { maxChecks: 2 });
    assert(gc.checks <= 2);
    assert.throws(() => trainSurrogate({ inputs: [1], outputs: [1, 2] }), /equal length/);
    assert.throws(() => trainSurrogate({ inputs: [], outputs: [] }), /non-empty/);
    assert.strictEqual(
      trainSurrogate(
        [
          [[1], [2]],
          [[3], [4]]
        ],
        { epochs: 2 }
      ).trainingSamples,
      2
    );
    assert.strictEqual(trainSurrogate([{ x: [1], y: [2] }], { epochs: 2 }).trainingSamples, 1);
    assert.strictEqual(trainSurrogate([{ input: [1], output: [2] }], { epochs: 2 }).trainingSamples, 1);
    assert.throws(() => trainSurrogate([[1, 2, 3]]), /pairs/);
    assert.throws(() => trainSurrogate([]), /must not be empty/);
    assert.throws(() => trainSurrogate(null), /Dataset/);
    assert.throws(
      () =>
        trainSurrogate({
          inputs: [
            [1, 2],
            [3, 4, 5]
          ],
          outputs: [[0.5], [0.8]]
        }),
      /consistent input and output/
    );
    assert.throws(() => predictSurrogate({}, [1]), /predictSurrogate requires/);
    assert.deepStrictEqual(
      predictSurrogate(trained, [
        [1, 2],
        [0, 1]
      ]).length,
      2
    );
    assert.throws(() => saveModel({}, '/tmp/x.json'), /saveModel requires/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-gap29-'));
    const jsonPath = path.join(dir, 'model.json');
    saveModel(trained, jsonPath);
    const loaded = loadModel(jsonPath);
    assert(loaded instanceof NeuralNetwork);
    assert.throws(() => NeuralNetwork.fromJSON({ format: 'wrong' }), /Invalid neural network JSON/);
    assert.throws(() => NeuralNetwork.fromJSON({ format: 'omnieng-neural-net-v1', layers: [] }), /no layers/);
    assert.throws(
      () =>
        NeuralNetwork.fromJSON({
          format: 'omnieng-neural-net-v1',
          layers: [{ W: [[1]], b: [1, 2], activation: 'tanh' }]
        }),
      /inconsistent bias/
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------
  // Omni AI engine prompt routing
  // ------------------------------------------------------------------
  check('OmniAIEngine processPrompt branch matrix', () => {
    const ai = new OmniAIEngine();
    const run = (prompt, ctx) => ai.processPrompt(prompt, ctx);
    assert.strictEqual(run('self-heal the bracket').matchedTool, 'self_heal_design');
    assert.strictEqual(run('run the design wizard for a drone').toolInput.wizardType, 'drone');
    assert.strictEqual(run('guide me with a lens wizard 200mm f/2.8').toolInput.wizardType, 'camera_lens');
    const pcb = run('wizard pcb 4 layer board');
    assert(pcb.matchedTool === 'run_design_wizard');
    const dropWiz = run('wizard drop test');
    assert.strictEqual(dropWiz.result.status, 'INVALID_INPUT');
    assert.strictEqual(run('asme pressure vessel report').matchedTool, 'evaluate_asme_section_viii');
    assert.strictEqual(run('heal this dirty cad').matchedTool, 'heal_cad_geometry');
    assert.strictEqual(run('solve variational sketch constraints').matchedTool, 'solve_variational_sketch');
    assert.strictEqual(run('cad diff between revisions').matchedTool, 'diff_3d_cad_models');
    assert.strictEqual(run('ebom cost rollup').matchedTool, 'rollup_ebom_costs');
    assert.strictEqual(run('dls optical optimizer').matchedTool, 'optimize_optical_dls');
    assert.strictEqual(run('sheet metal bend deduction').matchedTool, 'unfold_sheet_metal');
    assert.strictEqual(run('gdt true position check').matchedTool, 'inspect_gdt_tolerance');
    assert.strictEqual(run('sparse multifrontal solve').matchedTool, 'solve_sparse_multifrontal');
    assert.strictEqual(run('parallel pcg gpu').matchedTool, 'solve_gpu_parallel_pcg');
    assert.strictEqual(run('fmu co-simulation master').matchedTool, 'run_fmi_cosimulation');
    assert.strictEqual(run('package this project .omni').matchedTool, 'package_omni_archive');
    const lensView = run('lens camera cutaway closed without rays');
    assert.strictEqual(lensView.matchedTool, 'design_camera_lens_optics');
    assert.strictEqual(lensView.result.status, 'INVALID_INPUT');
    const lensOk = run(
      'design lens focal length 100mm f/2 subject distance 5m wavelength 550nm circle of confusion 0.03mm closed without rays'
    );
    assert.strictEqual(lensOk.matchedTool, 'design_camera_lens_optics');
    assert(lensOk.result && lensOk.result.numericalAperture !== undefined);
    assert.strictEqual(lensOk.toolInput.cutawayAngle, 0);
    assert.strictEqual(lensOk.toolInput.showRays, false);
    assert.strictEqual(lensOk.suggestedManualEdits.length >= 2, true);
    const dropOk = run('drop test 2 m 200 g on the corner');
    assert.strictEqual(dropOk.matchedTool, 'run_phone_drop_test');
    assert(dropOk.result && dropOk.result.peakDeceleration_G !== undefined);
    assert.strictEqual(run('thermal simulation of the phone').matchedTool, 'simulate_mobile_thermal');
    const verilog = run(
      'synthesize this verilog:\n```verilog\nmodule m(input a, input b, output y);\nassign y = a & b;\nendmodule\n```'
    );
    assert.strictEqual(verilog.matchedTool, 'synthesize_verilog_chip');
    assert(verilog.result && verilog.result.success === true);
    assert.strictEqual(run('synthesize verilog without code').matchedTool, 'synthesize_verilog_chip');
    assert.strictEqual(run('drc layout spacing check').matchedTool, 'run_calibre_drc_check');
    assert.strictEqual(run('drone flight at altitude').matchedTool, 'simulate_drone_flight');
    const piping = run('piping stress at 150 C without expansion loop');
    assert.strictEqual(piping.matchedTool, 'calculate_asme_piping_stress');
    assert.strictEqual(piping.toolInput.operatingTempC, 150);
    assert.strictEqual(piping.toolInput.hasExpansionLoop, false);
    assert.strictEqual(run('hysys flash distillation').matchedTool, 'run_hysys_flash_distillation');
    assert.strictEqual(run('spot diagram mtf').matchedTool, 'solve_skew_optics');
    assert.strictEqual(run('spice transient waveform').matchedTool, 'solve_spice_circuit');
    assert.strictEqual(run('flowsheet recycle wegstein').matchedTool, 'solve_flowsheet');
    assert.strictEqual(run('export step brep').matchedTool, 'export_step');
    assert.strictEqual(run('gerber pcb export').matchedTool, 'export_gerber');
    assert.strictEqual(run('dls optical optimizer with merit').matchedTool, 'optimize_optical_dls');
    assert.strictEqual(run('asme viii linearization').matchedTool, 'evaluate_asme_section_viii');
    assert.strictEqual(run('cad diff revision b').matchedTool, 'diff_3d_cad_models');
    assert.strictEqual(run('ebom hardware consolidation').matchedTool, 'rollup_ebom_costs');
    assert.strictEqual(run('fmi co-simulation setup').matchedTool, 'run_fmi_cosimulation');
    assert.strictEqual(run('archive package project').matchedTool, 'package_omni_archive');
    assert.strictEqual(run('lens optics').matchedTool, 'design_camera_lens_optics');
    assert.strictEqual(run('drop impact on edge').matchedTool, 'run_phone_drop_test');
    const fallback = run('order a pizza');
    assert(fallback.assistantMessage.includes('did not match'));
    assert.strictEqual(ai.parseUserIntent('self-heal').matchedTool, 'self_heal_design');
    assert.strictEqual(ai.parseUserIntent('heal watertight').matchedTool, 'topological_healing');
    assert.strictEqual(ai.parseUserIntent('asme div 2').matchedTool, 'asme_viii_div2_report');
    assert.strictEqual(ai.parseUserIntent('cad diff reva').matchedTool, 'git_cad_visual_diff');
    assert.strictEqual(ai.parseUserIntent('ebom consolidation').matchedTool, 'engineering_bom_rollup');
    assert(ai.parseUserIntent('random words').matchedTool !== undefined);
    const ds = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
      [7, 7]
    ];
    const tr = ai.trainSurrogate({ inputs: ds.map((d) => [d[0]]), outputs: ds.map((d) => [d[1]]) }, { epochs: 5 });
    assert(tr.model instanceof NeuralNetwork);
    assert.strictEqual(ai.predictSurrogate(tr.model, [2])[0] !== undefined, true);
    const serialized = tr.model.toJSON();
    assert.strictEqual(ai.predictSurrogate(serialized, [3]).length, 1);
  });

  // ------------------------------------------------------------------
  // Symbolic reasoner
  // ------------------------------------------------------------------
  check('SymbolicReasoner dimension ops, flow regimes, optimizer, lexer', () => {
    const mass = new PhysicalDimension(1, 0, 0, 0, 0, 0, 0);
    const length = PhysicalDimension.length();
    assert(mass.add({ m: 1, l: 0, t: 0, i: 0, theta: 0, n: 0, j: 0 }) instanceof PhysicalDimension);
    assert.throws(() => mass.add({ l: 1 }), /Incompatible dimensions/);
    assert(mass.sub({ m: 1 }) instanceof PhysicalDimension);
    assert.throws(() => mass.sub({ l: 1 }), /Incompatible dimensions/);
    const energy = mass.mul({ l: 1, t: 0, m: 1, i: 0, theta: 0, n: 0, j: 0 });
    assert.strictEqual(energy.l, 1);
    const divided = mass.div({ m: 1 });
    assert.strictEqual(divided.m, 0);
    assert(length.equals([0, 1, 0, 0, 0, 0, 0]));
    assert(new PhysicalDimension([0, 1, 0, 0, 0]).equals(length));
    assert.strictEqual(length.equals([1, 1, 1, 1, 1, 1, 1]), false);
    assert.strictEqual(length.equals(null), false);
    const dimI = new PhysicalDimension({ i: 2 });
    const dimN = new PhysicalDimension({ n: 1 });
    const dimJ = new PhysicalDimension({ j: 3 });
    assert(dimI.format().includes('I^2'));
    assert(dimN.format().includes('N^1'));
    assert(dimJ.format().includes('J^3'));
    assert.strictEqual(new PhysicalDimension().format(), 'Dimensionless');
    assert.throws(() => new PhysicalDimension([1, 2]), /PhysicalDimension array/);
    assert.throws(() => new PhysicalDimension([1, 2, 3, 4, 5, 6, 7, 8]), /PhysicalDimension array/);

    const kg = new SymbolicPhysicsKnowledgeGraph();
    const laminar = kg.calculatePipePressureDrop(1e-5, 2, 0.04, 1e-5, 1000, 0.001);
    assert.strictEqual(laminar.flowRegime, 'Laminar');
    const transitional = kg.calculatePipePressureDrop(9e-5, 2, 0.04, 1e-5, 1000, 0.001);
    assert.strictEqual(transitional.flowRegime, 'Transitional');
    const turbulent = kg.calculatePipePressureDrop(0.02, 2, 0.04, 1e-5, 1000, 0.001);
    assert.strictEqual(turbulent.flowRegime, 'Turbulent');
    assert.throws(() => kg.calculateDroneHoverAerodynamics(1, 0, 10, 0.8, 1.225, 9.81), /rotorCount/);
    assert.throws(() => kg.calculateDroneHoverAerodynamics(1, 4, 10, 1.2, 1.225, 9.81), /figure of merit/);
    assert.throws(() => kg.calculateDroneHoverAerodynamics(1e308, 4, 10, 0.8, 1.225, 9.81), /finite numeric range/);

    const opt = new NelderMeadOptimizer({ maxIterations: 30 });
    const res = opt.minimize((p) => (p[0] - 3) * (p[0] - 3), [5], [{ min: 10, max: 20 }]);
    assert(Array.isArray(res.optimalParams));
    const res2 = opt.minimize((p) => (p[0] - 3) * (p[0] - 3), [15], [{ min: 0, max: 10 }]);
    assert(Array.isArray(res2.optimalParams));

    const lexer = new DeterministicIntentLexer();
    assert.strictEqual(lexer.parse('drop test 2 m').action, 'DROP_TEST');
    assert.strictEqual(lexer.parse('drop test 2 m').params.heightM, 2);
    assert.strictEqual(lexer.parse('thicken wall to 3 mm').action, 'OPTIMIZE_WALL');
    assert.strictEqual(lexer.parse('thicken wall to 3 mm').params.targetValue, 0.003);
    assert.strictEqual(lexer.parse('design lens 50mm f/2.8').action, 'DESIGN_LENS');
    assert.strictEqual(lexer.parse('design lens 50mm f/2.8').params.focalLengthMm, 50);
    assert.strictEqual(lexer.parse('design lens 50mm f/2.8').params.fStop, 2.8);
    assert.strictEqual(lexer.parse('design lens').params.focalLengthMm, 50);
    assert.strictEqual(lexer.parse('design lens').params.fStop, 1.4);
    assert.strictEqual(lexer.parse('drone 2 kg').action, 'DRONE_TUNE');
    assert.strictEqual(lexer.parse('drone 2 kg').params.payloadKg, 2);
    assert.strictEqual(lexer.parse('drone').params.payloadKg, 0.25);
    assert.strictEqual(lexer.parse('pipe 10 bar').action, 'PIPING_STRESS');
    assert.strictEqual(lexer.parse('pipe 10 bar').params.designPressurePa, 1e6);
    assert.strictEqual(lexer.parse('pipe').params.designPressurePa, 2e6);
    assert.strictEqual(lexer.parse('hello world').action, 'GENERAL_QUERY');
    assert.strictEqual(lexer.parse('').action, 'UNKNOWN');
    assert.strictEqual(lexer.parse(null).action, 'UNKNOWN');

    const sr = new SymbolicReasoner();
    assert.throws(() => sr.estimateCantileverThickness(null, 2), /design object/);
    assert.throws(() => sr.estimateCantileverThickness({}, 2), /Explicit finite design inputs/);
    assert.throws(
      () =>
        sr.estimateCantileverThickness(
          {
            wallThicknessMm: 5,
            loadN: 10,
            lengthMm: 200,
            widthMm: 50,
            yieldStrengthMPa: 250,
            youngsModulusGPa: 200,
            minThicknessMm: 3,
            maxThicknessMm: 10
          },
          NaN
        ),
      /safetyFactor/
    );
    assert.throws(
      () =>
        sr.estimateCantileverThickness(
          {
            wallThicknessMm: 0,
            loadN: 10,
            lengthMm: 200,
            widthMm: 50,
            yieldStrengthMPa: 250,
            youngsModulusGPa: 200,
            minThicknessMm: 3,
            maxThicknessMm: 10
          },
          2
        ),
      /positive, ordered/
    );
    const est = sr.estimateCantileverThickness(
      {
        wallThicknessMm: 5,
        loadN: 10,
        lengthMm: 200,
        widthMm: 50,
        yieldStrengthMPa: 250,
        youngsModulusGPa: 200,
        minThicknessMm: 3,
        maxThicknessMm: 10
      },
      2
    );
    assert.strictEqual(est.status, 'ESTIMATE_ONLY');
  });

  // ------------------------------------------------------------------
  // Controls engine adapter
  // ------------------------------------------------------------------
  check('ControlsEngineAdapter execute signal/state-space/MPC/EKF branches', async () => {
    const adapter = new ControlsEngineAdapter();
    const job = (operation, parameters) => ({ jobId: `c29-${operation}`, domain: 'controls', operation, parameters });
    await assert.rejects(
      () => adapter.execute(job('simulate_block_diagram', {}), () => {}, { aborted: true }),
      /cancelled/i
    );

    const ss = await adapter.execute(
      job('solve_state_space', {
        A: [
          [0, 1],
          [-2, -3]
        ],
        B: [[0], [1]],
        C: [[1, 0]],
        D: [[0, 0.5]],
        initialX: [0, 0],
        tEnd: 0.05,
        dt: 0.01,
        u: [2]
      })
    );
    assert.strictEqual(ss.status, 'COMPLETED');
    assert.strictEqual(ss.outputData.outputs[0].length, 1);

    let sees = 0;
    const flipSignal = {
      get aborted() {
        sees++;
        return sees > 3;
      }
    };
    await assert.rejects(
      () =>
        adapter.execute(
          job('solve_state_space', {
            A: [
              [0, 1],
              [-2, -3]
            ],
            B: [[0], [1]],
            C: [[1, 0]],
            D: [[0]],
            tEnd: 0.2,
            dt: 0.005
          }),
          () => {},
          flipSignal
        ),
      /aborted|cancelled/i
    );

    const mpc = await adapter.execute(
      job('solve_mpc', {
        A: [
          [1, 0.1],
          [0, 1]
        ],
        B: [[0], [0.1]],
        C: [[1, 0]],
        x0: [0, 0],
        reference: [1]
      })
    );
    assert.strictEqual(mpc.status, 'COMPLETED');
    assert(Array.isArray(mpc.outputData.optimalControl));

    const ekf = await adapter.execute(job('estimate_ekf', { recordTrajectory: true }));
    assert.strictEqual(ekf.status, 'COMPLETED');
    assert(Array.isArray(ekf.outputData.trajectory));
    const ekf2 = await adapter.execute(
      job('estimate_ekf', {
        steps: [
          { dt: 0.01, gyro: [0, 0, 0], accel: [0, 0, -9.8] },
          { dt: 0.01, baroAlt: 100, gpsPos: [1, 2, 3] }
        ]
      })
    );
    assert.strictEqual(ekf2.outputData.stepsProcessed, 2);
  });

  // ------------------------------------------------------------------
  // CAM engine adapter
  // ------------------------------------------------------------------
  check('CAMEngineAdapter validation and execute branches', async () => {
    const adapter = new CAMEngineAdapter();
    const job = (operation, parameters) => ({ jobId: `cam29-${operation}`, domain: 'cam', operation, parameters });
    await assert.rejects(() => adapter.execute(job('plan_roughing_toolpath', null)), /parameter object/);
    await assert.rejects(
      () =>
        adapter.execute(
          job('plan_roughing_toolpath', {
            legacyMode: false,
            boundary: [[0, 0]],
            bounds: simpleBounds(),
            toolOptions: toolOptions()
          })
        ),
      /boundary polygon/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('plan_roughing_toolpath', {
            legacyMode: false,
            boundary: simpleBoundary(),
            bounds: { minX: 0, maxX: 5, minY: 0, maxY: 5, minZ: 3, maxZ: 2 },
            toolOptions: toolOptions()
          })
        ),
      /positive extents/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('plan_3axis_toolpath', {
            boundary: simpleBoundary(),
            bounds: simpleBounds(),
            finishAllowanceMm: -1,
            toolOptions: toolOptions()
          })
        ),
      /non-negative/
    );
    await assert.rejects(
      () => adapter.execute(job('generate_gcode', { programNumber: 'O1', toolOptions: toolOptions() })),
      /toolpath layers/
    );
    await assert.rejects(
      () => adapter.execute(job('generate_gcode', { toolpaths: { layers: [] }, toolOptions: toolOptions() })),
      /program identifier/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('generate_gcode', { toolpaths: { layers: [] }, programNumber: 'X1', toolOptions: toolOptions() })
        ),
      /program identifier/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('plan_roughing_toolpath', { bounds: simpleBounds(), toolOptions: toolOptions() }),
          () => {},
          { aborted: true }
        ),
      /cancelled/i
    );

    const rough = await adapter.execute(
      job('plan_roughing_toolpath', { bounds: simpleBounds(), toolOptions: toolOptions() })
    );
    assert.strictEqual(rough.status, 'COMPLETED');
    assert(rough.outputData.layers.length > 0);

    const contour = await adapter.execute(
      job('plan_3axis_toolpath', {
        boundary: simpleBoundary(),
        bounds: simpleBounds(),
        finishAllowanceMm: 0.2,
        retractPlane: 12,
        cornerRadiusMm: 1,
        toolOptions: toolOptions()
      })
    );
    assert.strictEqual(contour.status, 'COMPLETED');
    assert(contour.outputData.telemetry.contourCount > 0);

    const gcode = await adapter.execute(
      job('generate_gcode', {
        toolpaths: { layers: contour.outputData.layers, telemetry: { a: 1 } },
        programNumber: 'O1001',
        toolOptions: toolOptions()
      })
    );
    assert.strictEqual(gcode.status, 'COMPLETED');
    assert.strictEqual(gcode.outputData.telemetry.a, 1);
    assert(gcode.outputData.gcode.includes('O1001'));
  });

  // ------------------------------------------------------------------
  // CNC toolpath engine
  // ------------------------------------------------------------------
  check('CNCToolpathEngine validation and G-code arc branches', () => {
    assert.throws(() => new CNCToolpathEngine({}), /explicit tool options/);
    assert.throws(() => new CNCToolpathEngine(toolOptions({ toolDiameter: 0 })), /finite and physically positive/);
    assert.throws(() => new CNCToolpathEngine(toolOptions({ toolType: 'drill' })), /finite and physically positive/);
    assert.throws(() => new CNCToolpathEngine(toolOptions({ finishFeedRateMmMin: -5 })), /finishFeedRateMmMin/);
    assert.throws(
      () => new CNCToolpathEngine(toolOptions({ radialEngagementFraction: 1 })),
      /radialEngagementFraction/
    );
    assert.throws(() => new CNCToolpathEngine(toolOptions({ retractPlane: 5 })), /retractPlane/);
    assert.throws(() => new CNCToolpathEngine(toolOptions({ cornerRadiusMm: -1 })), /cornerRadiusMm/);

    const engine = new CNCToolpathEngine(toolOptions());
    assert.throws(() => engine.planRoughingToolpath(null), /explicit finite bounds/);
    assert.throws(
      () => engine.planRoughingToolpath({ minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 4 }),
      /exceed the tool diameter/
    );
    assert.throws(
      () =>
        engine.plan3AxisToolpath({
          boundary: simpleBoundary(),
          bounds: { minX: 0, maxX: 40, minY: 0, maxY: 30, minZ: 0, maxZ: 12 }
        }),
      /safeZ/
    );
    assert.throws(
      () =>
        engine.plan3AxisToolpath({
          boundary: [
            { x: 0, y: 0 },
            { x: 1, y: 0 }
          ],
          bounds: simpleBounds()
        }),
      /closed 2D boundary/
    );
    assert.throws(
      () =>
        engine.plan3AxisToolpath({
          boundary: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 }
          ],
          bounds: simpleBounds()
        }),
      /positive XY extents/
    );
    assert.throws(
      () => engine.plan3AxisToolpath({ boundary: simpleBoundary(), bounds: simpleBounds(), finishAllowanceMm: NaN }),
      /finishAllowanceMm/
    );
    const tinyEngine = new CNCToolpathEngine(toolOptions({ safeZ: 100 }));
    const tinyResult = tinyEngine.plan3AxisToolpath({
      boundary: [
        { x: 0, y: 0 },
        { x: 0.1, y: 0 },
        { x: 0.1, y: 0.1 },
        { x: 0, y: 0.1 }
      ],
      bounds: simpleBounds()
    });
    assert(tinyResult.layers.length > 0);
    const legacy = new CNCToolpathEngine(toolOptions({ legacyMode: true }));
    const lp = legacy.planToolpath({ bounds: simpleBounds() });
    assert(lp.layers.length > 0);
    const modern = new CNCToolpathEngine(toolOptions({ cornerRadiusMm: 1 }));
    const mp = modern.planToolpath({ boundary: simpleBoundary(), bounds: simpleBounds() });
    assert(mp.telemetry.arcLengthMm >= 0);

    assert.throws(() => engine.generateGCode({}, 'O1'), /toolpath layers/);
    assert.throws(() => engine.generateGCode({ layers: [] }, 'x'), /program number/);
    assert.throws(() => engine.generateGCode({ layers: [{}] }, 'O1'), /layers to be arrays/);
    assert.throws(
      () => engine.generateGCode({ layers: [[{ x: 0, y: 0, z: 0, type: 'jump' }]] }, 'O1'),
      /supported motion types/
    );
    assert.throws(
      () => engine.generateGCode({ layers: [[{ x: 0, y: 0, z: 0, type: 'arc' }]] }, 'O1'),
      /i\/j center offsets/
    );
    assert.throws(
      () => engine.generateGCode({ layers: [[{ x: 0, y: 0, z: 0, type: 'cut', f: -1 }]] }, 'O1'),
      /feed overrides/
    );
    const tool = new CNCToolpathEngine(toolOptions());
    const gc = tool.generateGCode(
      {
        layers: [
          [
            { x: 0, y: 0, z: 2, type: 'rapid' },
            { x: 0, y: 0, z: 0, type: 'plunge' },
            { x: 5, y: 0, z: 0, type: 'cut' },
            { x: 5, y: 2, z: 0, type: 'arc', i: 0, j: 2, arcDir: 'CCW', f: 300 },
            { x: 5, y: 2, z: 0, type: 'arc', i: 0, j: -2, arcDir: 'CW' },
            { x: 5, y: 0, z: 0, type: 'finish' }
          ]
        ]
      },
      'O7777'
    );
    assert(gc.includes('G03'));
    assert(gc.includes('G02'));
    assert(gc.includes('G01 Z0.000 F200'));
    assert(gc.includes('F300'));
  });

  // ------------------------------------------------------------------
  // Planar offset geometry
  // ------------------------------------------------------------------
  check('planar_offset_geometry predicates and offset edges', () => {
    const cw = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 }
    ];
    const ccw = planar.toCcw(cw);
    assert(planar.isCcw(ccw));
    const de = planar.dedupeConsecutive([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0 }
    ]);
    assert.strictEqual(de.length, 2);
    const de2 = planar.dedupeConsecutive([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 0 }
    ]);
    assert.strictEqual(de2.length, 2);
    const dA = { x: 0, y: 0 };
    const dB = { x: 0, y: 0 };
    assert.strictEqual(planar.distancePointToSegment({ x: 3, y: 4 }, dA, dB), 5);
    const cross = planar.segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 });
    assert.strictEqual(cross.intersects, true);
    assert.strictEqual(cross.collinear, false);
    const touch = planar.segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 });
    assert.strictEqual(touch.intersects, true);
    assert.strictEqual(touch.collinear, true);
    const missv = planar.segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 });
    assert.strictEqual(missv.intersects, false);
    assert(planar.pointInPolygon({ x: 5, y: 5 }, ccw));
    assert(planar.pointInPolygon({ x: 0, y: 5 }, ccw));
    assert(!planar.pointInPolygon({ x: 20, y: 20 }, ccw));
    assert(!planar.pointInPolygonEvenOdd({ x: 20, y: 20 }, ccw));

    const miter = planar.offsetPolygonMiter(ccw, 1);
    assert.strictEqual(miter.length, 4);
    const degenerate = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 }
    ];
    const mDeg = planar.offsetPolygonMiter(degenerate, 1);
    assert(Array.isArray(mDeg));
    assert.strictEqual(planar.resolveSelfIntersections([], 1e-6).length, 0);
    const star = [
      { x: 3, y: 0 },
      { x: 4, y: 3 },
      { x: 6, y: 1 },
      { x: 5, y: 4 },
      { x: 8, y: 4 },
      { x: 5, y: 5 },
      { x: 8, y: 8 },
      { x: 4, y: 7 },
      { x: 3, y: 10 },
      { x: 2, y: 7 },
      { x: -2, y: 8 },
      { x: 1, y: 5 },
      { x: -2, y: 4 },
      { x: 2, y: 4 },
      { x: 1, y: 1 },
      { x: 5, y: 2 }
    ];
    const loops = planar.resolveSelfIntersections(star, 1e-6);
    assert(loops.length > 0);
    const offsetLoops = planar.offsetRegion(ccw, 1, 1e-6, ccw);
    assert(offsetLoops.length > 0);
    assert.strictEqual(
      planar.offsetRegion(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 }
        ],
        1,
        1e-6
      ).length,
      0
    );
    const rounded = planar.applyRoundedCorners(ccw, 1);
    assert(rounded.some((p) => p.arc === true));
    const sharp = planar.applyRoundedCorners(ccw, 0);
    assert(!sharp.some((p) => p.arc === true));
    const dim1 = planar.applyRoundedCorners([ccw[0]], 1);
    assert.strictEqual(dim1.length, 0);
    const bb = planar.loopBoundingBox(ccw);
    assert.strictEqual(bb.minX, 0);
  });

  // ------------------------------------------------------------------
  // Block diagram graph
  // ------------------------------------------------------------------
  check('BlockGraph config addBlock and simulate branches', () => {
    const g = new BlockGraph();
    const src = g.addBlock({
      id: 's',
      type: 'source_sine',
      name: 'sine',
      parameters: { frequency: 1, amplitude: 2 },
      x: 1,
      y: 2
    });
    assert.strictEqual(src.id, 's');
    assert.strictEqual(src.x, 1);
    const gain = g.addBlock({ type: 'gain', params: { k: 2 } });
    assert(gain.id.startsWith('blk_'));
    assert.strictEqual(gain.type, 'gain');
    const sum = g.addBlock({ type: 'sum' });
    assert.strictEqual(sum.type, 'sum');
    const pid = g.addBlock({
      type: 'pid',
      parameters: { kp: 1, ki: 0.1, kd: 0.01, initialState: 0, limitMin: -5, limitMax: 5 }
    });
    assert.strictEqual(pid.type, 'pid');
    const sc = g.addBlock('scope', 'scope1');
    g.connect(src.id, gain.id);
    g.connect(gain.id, sum.id);
    g.connect(sum.id, pid.id);
    g.connect(pid.id, sc.id);
    const sim = g.simulate(0.5, 0.05);
    assert(sim.t.length > 0);
    assert(sim.signals[sc.id] !== undefined);
    g.removeBlock(src.id);
    assert(!g.blocks.has(src.id));

    const g2 = new BlockDiagramGraph();
    const b1 = g2.addBlock('source_constant', 'c', { value: 1 });
    const b2 = g2.addBlock('gain', 'g', { k: 3 });
    g2.connect(b1.id, b2.id);
    const badPid = g2.addBlock('pid', 'p', { kp: 1, ki: 1, kd: 1, initialState: 0, limitMin: 5, limitMax: -5 });
    g2.connect(b1.id, badPid.id);
    assert.throws(() => g2.simulate(1, 0.1), /invalid PID output limits/);
    const g3 = new BlockDiagramGraph();
    const b3 = g3.addBlock('source_constant', 'c', { value: 1 });
    const b4 = g3.addBlock('gain', 'g', []);
    g3.connect(b3.id, b4.id);
    assert.throws(() => g3.simulate(1, 0.1), /finite 'k'/);
    const g4 = new BlockDiagramGraph();
    g4.addBlock('source_constant', 'c', { value: 1 });
    g4.connect('missing-source', 'missing-gain');
    assert.throws(() => g4.simulate(1, 0.1), /missing block/);
    const g5 = new BlockDiagramGraph();
    g5.addBlock('source_constant', 'c', { value: 1 });
    assert.throws(() => g5.simulate(NaN, 1), /positive finite/);
    const g5empty = new BlockDiagramGraph();
    assert.throws(() => g5empty.simulate(1, 0.1), /at least one configured block/);
    const g6 = new BlockDiagramGraph();
    g6.addBlock('source_step', 's', { stepTime: 0.5, initialValue: 0, finalValue: 1 });
    const r6 = g6.simulate(1, 0.1);
    assert(r6.signals[Array.from(g6.blocks.keys())[0]].length > 0);
  });

  // ------------------------------------------------------------------
  // Multi-rate scheduler, algebraic loops, modern control synthesis
  // ------------------------------------------------------------------
  check('MultiRateScheduler and control synthesis branches', () => {
    const t1 = new ScheduledTask('a', 1);
    assert.strictEqual(t1.sampleRateHz, 1);
    const t2 = new ScheduledTask('b', 1000);
    assert.strictEqual(t2.sampleRateHz, 1000);
    const t3 = new ScheduledTask('c', 0.05);
    assert.strictEqual(t3.sampleRateHz, 20);
    const t4 = new ScheduledTask(null);
    assert(t4.id.startsWith('task_'));
    assert.strictEqual(t4.sampleRateHz, 100);
    const t5 = new ScheduledTask({ id: 'd', sampleRateHz: 200 });
    assert.strictEqual(t5.id, 'd');

    const sched = new MultiRateScheduler();
    assert.strictEqual(sched.baseRateHz, 1000);
    const sched2 = new MultiRateScheduler({ baseRateHz: 100 });
    assert.strictEqual(sched2.baseRateHz, 100);
    const task = sched2.addTask({ id: 'fast', sampleRateHz: 100, stepFn: (t, dt, inputs) => ({ out: 1 }) });
    assert(task instanceof ScheduledTask);
    const task2 = sched2.addTask(task);
    assert.strictEqual(task2, task);
    assert.strictEqual(sched2.shouldTaskFire(task, 0), true);
    const huge = new ScheduledTask({ id: 'huge', sampleRateHz: 1e9 });
    assert.strictEqual(sched2.shouldTaskFire(huge, 0), true);
    sched2.connectTasks('fast', 'huge');
    const summary = sched2.step();
    assert.strictEqual(summary.executedTasks.length >= 1, true);

    const mapLoops = AlgebraicLoopSolver.findAlgebraicLoops(
      new Map([
        ['a', ['b']],
        ['b', ['a']],
        ['c', []]
      ])
    );
    assert(mapLoops.length >= 1);
    const objLoops = AlgebraicLoopSolver.findAlgebraicLoops({ x: ['y'], y: ['z'], z: ['x'] });
    assert(objLoops.length >= 1);
    assert.strictEqual(AlgebraicLoopSolver.findAlgebraicLoops({ p: ['q'], q: [] }).length, 0);

    const root = AlgebraicLoopSolver.solveBroyden((x) => x, [1, 2]);
    assert.strictEqual(root.converged, true);
    assert.strictEqual(root.iterations, 0);
    const fp = AlgebraicLoopSolver.solveBroyden((x) => [Math.cos(x[0]), Math.cos(x[1])], [0.5, 0.5], {
      tol: 1e-9,
      maxIter: 100
    });
    assert.strictEqual(fp.converged, true);
    assert.throws(
      () => ModernControlSynthesis.solveContinuousLQR([[2]], [[1]], [[1]], [[1]], 0, 1e-6),
      /iteration and tolerance/
    );
    assert.throws(
      () => ModernControlSynthesis.solveContinuousLQR([[2]], [[1]], [[1]], [[1]], 50, 0),
      /iteration and tolerance/
    );
    const A = [
      [1, 0.1],
      [0, 1]
    ];
    const B = [[0], [0.1]];
    const Q = [
      [1, 0],
      [0, 1]
    ];
    const R = [[0.1]];
    const disc = ModernControlSynthesis.solveDiscreteLQR(A, B, Q, R);
    assert(Array.isArray(disc.K));
    const R2 = [
      [0.1, 0],
      [0, 0.1]
    ];
    const B2 = [
      [0.1, 0],
      [0, 0.1]
    ];
    const disc2 = ModernControlSynthesis.solveDiscreteLQR(
      [
        [1, 0.1],
        [0, 1]
      ],
      B2,
      Q,
      R2
    );
    assert(Array.isArray(disc2.K));
    assert.throws(
      () =>
        ModernControlSynthesis._invertMatrix([
          [1, 1],
          [1, 1]
        ]),
      /Singular/
    );
    const inv2 = ModernControlSynthesis._invertMatrix([
      [2, 1],
      [1, 1]
    ]);
    assert.strictEqual(inv2[0][0], 1);
    const inv3 = ModernControlSynthesis._invertMatrix([
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 1]
    ]);
    assert.strictEqual(inv3[1][0], 1);
    assert.throws(
      () =>
        ModernControlSynthesis._invertMatrix([
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9]
        ]),
      /singular/
    );
    const inv1 = ModernControlSynthesis._invertMatrix([[5]]);
    assert.strictEqual(inv1[0][0], 0.2);
  });

  // ------------------------------------------------------------------
  // S-Function plugin host
  // ------------------------------------------------------------------
  check('SFunctionPluginHost lifecycle branches', () => {
    assert.throws(() => new SFunctionPluginHost().registerDefinition(null), /Invalid S-Function definition/);
    const host = new SFunctionPluginHost({ name: 'block', parameters: { p: 1 } });
    host.registerDefinition({
      mdlInitializeSizes(ss) {
        ss.numContStates = 2;
        ss.numDiscStates = 1;
        ss.numInputs = 2;
        ss.numOutputs = 1;
      },
      mdlInitializeSampleTimes() {},
      mdlStart(ss, ctx) {
        ctx.continuousStates.set([1, 2]);
      },
      mdlOutputs(ss, t, ctx) {
        ctx.outputs[0] = 42;
      },
      mdlDerivatives(ss, t, ctx) {
        ctx.derivatives[0] = 1;
        ctx.derivatives[1] = -1;
      },
      mdlUpdate(ss, t, ctx) {
        ctx.discreteStates[0] = 7;
      },
      mdlTerminate() {}
    });
    assert.strictEqual(host.name, 'block');

    const host2 = new SFunctionPluginHost();
    host2.loadCPlugin({
      mdlOutputs(ss, t, ctx) {
        ctx.outputs[0] = 5;
      }
    });
    assert.strictEqual(host2.name, 'CPlugin');
    const host3 = new SFunctionPluginHost();
    host3.loadCPlugin('myPlugin', { mdlOutputs() {} });
    assert.strictEqual(host3.name, 'myPlugin');

    host.setContinuousStates([0, 0]);
    host.setContinuousStates([3, 4, 5]);
    assert.strictEqual(host.simStruct.numContStates, 3);
    host.setDiscreteStates([0]);
    host.setDiscreteStates([1, 2, 3]);
    assert.strictEqual(host.simStruct.numDiscStates, 3);
    host.setInputs([1, 2]);
    const out = host.evaluateOutputs(0);
    assert.strictEqual(out[0], 42);
    assert.strictEqual(host.isInitialized, true);
    const derivs = host.evaluateDerivatives(0);
    assert.strictEqual(derivs[0], 1);
    const disc = host.updateDiscreteStates(0);
    assert.strictEqual(disc[0], 7);
    host.stepContinuousRK4(0, 0.01);
    assert.strictEqual(host.continuousStates.length, 3);

    const empty = new SFunctionPluginHost();
    empty.registerDefinition({ mdlOutputs() {} });
    empty.stepContinuousRK4(0, 0.01);
    assert.strictEqual(empty.simStruct.numContStates, 0);
    const auto = new SFunctionPluginHost();
    auto.registerDefinition({
      mdlInitializeSizes(ss) {
        ss.numOutputs = 1;
      },
      mdlOutputs(ss, t, ctx) {
        ctx.outputs[0] = 9;
      }
    });
    assert.strictEqual(auto.evaluateOutputs(0)[0], 9);
    assert.strictEqual(auto.isInitialized, true);
    auto.terminate();
    assert.strictEqual(auto.isInitialized, false);
  });

  // ------------------------------------------------------------------
  // HIL telemetry
  // ------------------------------------------------------------------
  check('HILTelemetryEngine codec error branches', () => {
    assert.throws(() => HILTelemetryEngine.packFrame(-1, 0, new Float64Array(1)), /Sequence ID/);
    assert.throws(() => HILTelemetryEngine.packFrame(0, -1, new Float64Array(1)), /Timestamp/);
    assert.throws(() => HILTelemetryEngine.packFrame(0, 0, 'state'), /Float64Array or array/);
    assert.throws(() => HILTelemetryEngine.packFrame(0, 0, new Float64Array(70000)), /at most 65535/);
    assert.throws(() => HILTelemetryEngine.packFrame(0, 0, [0, NaN]), /finite values/);
    const packed = HILTelemetryEngine.packFrame(7, 123456, new Float64Array([1, 2, 3]));
    const unpacked = HILTelemetryEngine.unpackFrame(packed);
    assert.strictEqual(unpacked.seqId, 7);
    assert.strictEqual(unpacked.numStates, 3);
    assert.throws(() => HILTelemetryEngine.unpackFrame(new Uint8Array(10)), /at least 20 bytes/);
    assert.throws(() => HILTelemetryEngine.unpackFrame(new Uint8Array(20)), /magic header/);
    const badLen = new Uint8Array(24);
    badLen.set([0x48, 0x4c]);
    assert.throws(() => HILTelemetryEngine.unpackFrame(badLen), /length does not match/);
    const fixCrc = (bytes) => {
      const crcOffset = bytes.byteLength - 4;
      const payload = new Uint8Array(bytes.buffer, bytes.byteOffset, crcOffset);
      new DataView(bytes.buffer).setUint32(crcOffset, HILTelemetryEngine.calculateCrc32(payload), false);
    };
    const tampered = new Uint8Array(packed);
    tampered[8] ^= 0xff;
    assert.throws(() => HILTelemetryEngine.unpackFrame(tampered), /CRC mismatch/);
    const badTime = new Uint8Array(packed);
    new DataView(badTime.buffer).setFloat64(6, -5, false);
    fixCrc(badTime);
    assert.throws(() => HILTelemetryEngine.unpackFrame(badTime), /timestamp is invalid/);
    const nanStates = new Uint8Array(packed);
    new DataView(nanStates.buffer).setFloat64(16, NaN, false);
    fixCrc(nanStates);
    assert.throws(() => HILTelemetryEngine.unpackFrame(nanStates), /state is non-finite/);
    assert.throws(() => HILTelemetryEngine.evaluateJitter([], 1, 2), /At least one positive/);
    assert.throws(() => HILTelemetryEngine.evaluateJitter([1, -2], 1, 2), /At least one positive/);
    assert.throws(() => HILTelemetryEngine.evaluateJitter([1], 0, 2), /Positive finite target/);
    const jitter = HILTelemetryEngine.evaluateJitter([1, 2, 3, 10], 2, 4);
    assert.strictEqual(jitter.deadlineMissesCount, 1);
  });

  // ------------------------------------------------------------------
  // MC/DC coverage
  // ------------------------------------------------------------------
  check('MCDCCoverageAnalyzer edge branches', () => {
    const empty = MCDCCoverageAnalyzer.evaluateMCDCCoverage([], () => true, []);
    assert.strictEqual(empty.mcdcCoveragePercent, 0);
    const suite = MCDCCoverageAnalyzer.generateMCDCTestSuite(['a', 'b'], (a, b) => a && b);
    assert(suite.testSuite.length >= 3);
    assert(suite.coverage.allConditionsHavePairs);
    const unused = MCDCCoverageAnalyzer.generateMCDCTestSuite(['a', 'b'], (a) => a);
    assert(unused.coverage.conditionStatus.some((c) => !c.hasIndependencePair));
    const minimal = MCDCCoverageAnalyzer.generateMinimalANDSuite(3);
    assert.strictEqual(minimal.length, 4);
    const analyzer = new MCDCCoverageAnalyzer();
    assert.strictEqual(analyzer.generateMinimalANDSuite(2).length, 3);
    const dos = analyzer.generateDO178CDossier('D1', ['a'], (a) => a, [[true], [false]]);
    assert(dos.sha256Seal.length === 64);
    const analyzed = analyzer.evaluateMCDCCoverage(['a'], (a) => a, [[true], [false]]);
    assert.strictEqual(analyzed.coveredConditions, 1);
    const suites = analyzer.generateMCDCTestSuite(['a', 'b'], (a, b) => a || b);
    assert(suites.testSuite.length >= 3);
  });

  // ------------------------------------------------------------------
  // Materials
  // ------------------------------------------------------------------
  check('material_database and certified interpolation branches', () => {
    assert.throws(() => MaterialManager.computeInertiaCuboid('NOT_A_MATERIAL', 1, 1, 1), /no reviewed record/);
    assert.throws(() => MaterialManager.computeInertiaCuboid('AL-7075-T6', 0, 1, 1), /finite positive values/);
    const ok = MaterialManager.computeInertiaCuboid('AL-7075-T6', 0.1, 0.2, 0.3);
    assert(ok.massKg > 0);
    assert.throws(
      () =>
        MaterialManager.computeCuboidMassProperties({
          widthM: 1,
          heightM: 1,
          depthM: 1,
          densityKgM3: 0,
          densitySource: 'x'
        }),
      /explicit finite positive values/
    );
    assert.throws(
      () =>
        MaterialManager.computeCuboidMassProperties({
          widthM: 1,
          heightM: 1,
          depthM: 1,
          densityKgM3: 1,
          densitySource: ''
        }),
      /density source/
    );
    assert.throws(
      () =>
        MaterialManager.computeCuboidMassProperties({
          widthM: 1,
          heightM: 1,
          depthM: 1,
          densityKgM3: 1,
          densitySource: 'x'.repeat(1001)
        }),
      /density source/
    );
    assert.throws(
      () =>
        MaterialManager.computeCuboidMassProperties({
          widthM: 1e200,
          heightM: 1e200,
          depthM: 1e200,
          densityKgM3: 1e200,
          densitySource: 'src'
        }),
      /exceed the finite numeric range/
    );
    const props = MaterialManager.computeCuboidMassProperties({
      widthM: 2,
      heightM: 3,
      depthM: 4,
      densityKgM3: 5,
      densitySource: '  catalog  '
    });
    assert.strictEqual(props.success, true);
    assert.strictEqual(props.inputs.densitySource, 'catalog');

    const card = MATERIAL_DATABASE['AL-7075-T6'];
    assert.throws(() => interpolateProperty(card, 'E', 'hot'), /Temperature must be a finite number/);
    assert.throws(() => interpolateProperty(card, 'nonexistentProp', 300), /Property ladder/);
    const first = interpolateProperty(card, 'E', -1000);
    assert.strictEqual(first, card.E[0]);
    const last = interpolateProperty(card, 'E', 1e9);
    assert.strictEqual(last, card.E[card.E.length - 1]);
    const mid = interpolateProperty(card, 'E', 300);
    assert(Number.isFinite(mid));
  });

  // ------------------------------------------------------------------
  // Cosim route + FMU reader parser errors
  // ------------------------------------------------------------------
  check('CosimDomainRoute and FmuReader parse branches', async () => {
    const route = new CosimDomainRoute();
    await assert.rejects(
      () => route.execute('read_fmu_package', { fmu: 'not-base64!' }),
      (e) => e instanceof FmuError && e.code === 'INVALID_INPUT'
    );
    await assert.rejects(
      () => route.execute('read_fmu_package', { fmu: 'A'.repeat(90 * 1024 * 1024) }),
      /base64 exceeds/
    );
    await assert.rejects(() => route.execute('read_fmu_package', { fmu: 42 }), /Buffer, Uint8Array, or base64 string/);
    await assert.rejects(() => route.execute('read_fmu_package', { fmu: Buffer.from('junk') }), /not a zip archive/);
    await assert.rejects(() => route.execute('parse_model_description', {}), /requires an xml string/);
    await assert.rejects(() => route.execute('unknown_route', {}), /unknown cosim route operation/);

    const validXml = (body) =>
      `<fmiModelDescription fmiVersion="2.0" modelName="m" guid="g" generationTool="t" numberOfContinuousStates="1"><ModelVariables>${body}</ModelVariables><ModelStructure><Outputs><Unknown name="o" index="1" dependencies="x" dependenciesKind="dependent"/></Outputs></ModelStructure></fmiModelDescription>`;
    const realVar = (attrs, typeEl) =>
      `<ScalarVariable name="x" valueReference="1" causality="input" variability="continuous" initial="exact" description="d">${typeEl}</ScalarVariable>`;
    const reader = new FmuReader();
    const good = reader.parseModelDescription(
      validXml(
        realVar(
          '',
          '<Real start="0.5" min="0" max="1" nominal="0.5" unit="m" displayUnit="mm" fixed="true" quantity="length"/>'
        )
      )
    );
    assert.strictEqual(good.variables[0].type.unit, 'm');
    assert.strictEqual(good.variables[0].type.displayUnit, 'mm');
    assert.strictEqual(good.variables[0].type.fixed, true);
    assert.strictEqual(good.variables[0].type.quantity, 'length');
    const intVar = reader.parseModelDescription(validXml(realVar('', '<Integer start="3" min="1" max="9"/>')));
    assert.strictEqual(intVar.variables[0].type.start, 3);
    const boolVar = reader.parseModelDescription(validXml(realVar('', '<Boolean start="true"/>')));
    assert.strictEqual(boolVar.variables[0].type.start, true);
    const strVar = reader.parseModelDescription(validXml(realVar('', '<String start="hello"/>')));
    assert.strictEqual(strVar.variables[0].type.start, 'hello');

    assert.throws(() => reader.parseModelDescription('plain text'), /text outside root element/);
    assert.throws(
      () => reader.parseModelDescription('text<fmiModelDescription fmiVersion="2.0"></fmiModelDescription>'),
      /text outside root element/
    );
    assert.throws(
      () =>
        reader.parseModelDescription('<!-- comment --><fmiModelDescription fmiVersion="2.0"></fmiModelDescription>'),
      /ModelVariables/
    );
    const cdata =
      '<fmiModelDescription fmiVersion="2.0"><ModelVariables><![CDATA[raw]]></ModelVariables></fmiModelDescription>';
    assert.throws(() => reader.parseModelDescription(cdata), /at least one ScalarVariable/);
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<?xml version="1.0"?><fmiModelDescription fmiVersion="2.0"></fmiModelDescription>'
        ),
      /ModelVariables/
    );
    assert.throws(
      () => reader.parseModelDescription('<!DOCTYPE fmi><fmiModelDescription fmiVersion="2.0"></fmiModelDescription>'),
      /ModelVariables/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"></fmiModelDescription></fmiModelDescription>'
        ),
      /unexpected closing tag/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables></ModelVariables></fmiModelDescription>'
        ),
      /at least one ScalarVariable/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable></ScalarVariable></ModelVariables></fmiModelDescription>'
        ),
      /missing name attribute/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x"><Real/><Integer/></ScalarVariable></ModelVariables></fmiModelDescription>'
        ),
      /exactly one type element/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x"><Real start="abc"/></ScalarVariable></ModelVariables></fmiModelDescription>'
        ),
      /non-numeric/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x"><Integer start="1.5"/></ScalarVariable></ModelVariables></fmiModelDescription>'
        ),
      /non-integer/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x"><Boolean start="maybe"/></ScalarVariable></ModelVariables></fmiModelDescription>'
        ),
      /invalid boolean/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x" valueReference="q"><Real/></ScalarVariable></ModelVariables></fmiModelDescription>'
        ),
      /non-integer/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription><ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables></fmiModelDescription>'
        ),
      /missing fmiVersion attribute/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="9.9"><ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables></fmiModelDescription>'
        ),
      /unsupported fmiVersion/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<notRoot fmiVersion="2.0"><ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables></notRoot>'
        ),
      /root element must be/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0" bogus="a" bogus="b"><ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables></fmiModelDescription>'
        ),
      /duplicate attribute/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0" badattr><ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables></fmiModelDescription>'
        ),
      /malformed attribute syntax/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables></fmiModelDescription><extra/>'
        ),
      /multiple root elements/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables><ModelStructure><Outputs><Unknown/></Outputs></ModelStructure></fmiModelDescription>'
        ),
      /missing name attribute/
    );
    const entity = reader.parseModelDescription(
      '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x" description="a &amp; b"><Real/></ScalarVariable></ModelVariables></fmiModelDescription>'
    );
    assert.strictEqual(entity.variables[0].description, 'a & b');
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables><!-- unclosed comment</fmiModelDescription>'
        ),
      /Error|unterminated/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables><?pi</fmiModelDescription>'
        ),
      /unterminated processing instruction/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables><![CDATA[oops</fmiModelDescription>'
        ),
      /Error/
    );
    const doctypeModel = reader.parseModelDescription(
      '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables><!doctype></fmiModelDescription>'
    );
    assert.strictEqual(doctypeModel.variables.length, 1);
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables><bad tag/></fmiModelDescription>'
        ),
      /malformed attribute syntax|invalid tag name/
    );
    assert.throws(
      () =>
        reader.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0"><ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables><1abc/></fmiModelDescription>'
        ),
      /invalid tag name/
    );
    const innerTextModel = reader.parseModelDescription(
      '<fmiModelDescription fmiVersion="2.0">plain <ModelVariables><ScalarVariable name="x"><Real/></ScalarVariable></ModelVariables></fmiModelDescription>'
    );
    assert.strictEqual(innerTextModel.variables.length, 1);

    assert.throws(() => reader.parseModelDescription(123), /XML content must be a string/);
    const bomXml = '\uFEFF' + validXml(realVar('', '<Real/>'));
    const bomModel = reader.parseModelDescription(bomXml);
    assert.strictEqual(bomModel.variables.length, 1);
    assert.throws(() => new FmuExecutionHost(null), /parsed model description/);
    assert.throws(
      () => new FmuExecutionHost({ fmiVersion: '2.0', variables: [] }),
      /at least one continuous-time state derivative/
    );
    assert.throws(
      () =>
        new FmuExecutionHost(
          { fmiVersion: '2.0', variables: [{ name: 'x', type: { kind: 'Real' } }], startValues: new Map() },
          { derivativeFns: { x: 'not-fn' } }
        ),
      /must be a function/
    );
    assert.throws(
      () =>
        new FmuExecutionHost(
          { fmiVersion: '2.0', variables: [{ name: 'x', type: { kind: 'Real' } }], startValues: new Map() },
          { derivativeFns: { y: () => 0 } }
        ),
      /unknown variable/
    );
    assert.throws(
      () =>
        new FmuExecutionHost(
          { fmiVersion: '2.0', variables: [{ name: 'x', type: { kind: 'Integer' } }], startValues: new Map() },
          { derivativeFns: { x: () => 0 } }
        ),
      /must be of type Real/
    );
  });

  check('FmuExecutionHost simulate and input branches', () => {
    const model = {
      fmiVersion: '2.0',
      variables: [
        { name: 'x', valueReference: 1, causality: 'local', variability: 'continuous', type: { kind: 'Real' } },
        { name: 'u', valueReference: 2, causality: 'input', variability: 'continuous', type: { kind: 'Real' } }
      ],
      startValues: new Map([['x', 0]])
    };
    const host = new FmuExecutionHost(model, { derivativeFns: { x: (t, view) => view.u } });
    assert.throws(() => host.setInput('nope', 1), /not found in model/);
    assert.throws(() => host.setInput('x', 1), /not an input/);
    assert.throws(() => host.setInput('u', Infinity), /finite number/);
    assert.throws(() => host.setInput('u', {}), /finite number or a time function/);
    assert.strictEqual(host.getInputValue(0, 'u'), 0);
    host.setInput('u', 2);
    assert.strictEqual(host.getInputValue(0, 'u'), 2);
    host.setInput('u', (t) => t);
    assert.strictEqual(host.getInputValue(0.5, 'u'), 0.5);
    assert.throws(() => host.simulate({ t0: 0, tEnd: 0 }), /finite t0 < tEnd/);
    assert.throws(() => host.simulate({ t0: 0, tEnd: 2e6 }), /limited to/);
    const sim = host.simulate({ t0: 0, tEnd: 0.1, method: 'rk4', dt: 0.01 });
    assert.strictEqual(sim.success, true);
    assert.strictEqual(sim.method, 'rk4');
    assert.throws(() => host.simulate({ tEnd: 0.1, method: 'rk4', dt: -5 }), /dt/);
    assert.throws(() => host.simulate({ tEnd: 0.1, method: 'rk4', dt: 1e-9 }), /steps/);
    const host45 = new FmuExecutionHost(model, { derivativeFns: { x: (t, view) => 1 } });
    const sim45 = host45.simulate({ tEnd: 0.1, method: 'rk45', tol: 1e-5, h0: 0.01 });
    assert.strictEqual(sim45.method, 'rk45');
    assert.throws(() => host45.simulate({ tEnd: 0.1, method: 'rk45', h0: 0 }), /h0/);
    assert.throws(() => host45.simulate({ tEnd: 0.1, method: 'rk45', h0: 1e-12 }), /h0 must be at least/);
    assert.throws(() => host45.simulate({ tEnd: 0.1, method: 'euler' }), /unknown solver method/);

    assert.throws(() => new FmuReader().readZip(Buffer.from('garbage')), /not a zip archive/);
    assert.throws(() => new FmuReader().readZip(new Uint8Array([1, 2, 3])), /not a zip archive/);
    assert.throws(() => new FmuReader().readZip(new ArrayBuffer(8)), /not a zip archive/);
    assert.throws(() => new FmuReader().readZip(12), /Buffer, Uint8Array, ArrayBuffer, or string/);
  });

  // ------------------------------------------------------------------
  // PDM adapter
  // ------------------------------------------------------------------
  check('PDMEngineAdapter operations', async () => {
    const adapter = new PDMEngineAdapter();
    const job = (operation, parameters) => ({ jobId: `pdm29-${operation}`, domain: 'pdm', operation, parameters });
    const root = bomNode('A-100', 'Assembly', 1, [
      bomNode('B-200', 'Sub', 2, [bomNode('C-300', 'Part', 4)]),
      bomNode('C-300', 'Part', 3)
    ]);
    await assert.rejects(() => adapter.execute(job('compute_bom_rollup', null)), /parameter object/);
    await assert.rejects(() => adapter.execute(job('compute_bom_rollup', {})), /requires rootAssembly or bom/);
    await assert.rejects(() => adapter.execute(job('where_used', { rootAssembly: root })), /partNumber/);
    await assert.rejects(() => adapter.execute(job('visual_diff_cad', {})), /revisionA and revisionB/);
    await assert.rejects(() => adapter.execute(job('unknown_op', { rootAssembly: root })), /not supported by adapter/);
    await assert.rejects(
      () => adapter.execute(job('compute_bom_rollup', { rootAssembly: root }), () => {}, { aborted: true }),
      /cancelled/i
    );

    const rollup = await adapter.execute(job('compute_bom_rollup', { rootAssembly: root }));
    assert.strictEqual(rollup.status, 'COMPLETED');
    assert(rollup.outputData.rollup);
    const indented = await adapter.execute(job('generate_indented_bom', { rootAssembly: root }));
    assert(Array.isArray(indented.outputData.indented));
    const flattened = await adapter.execute(job('generate_flattened_bom', { rootAssembly: root }));
    assert.strictEqual(flattened.outputData.uniquePartCount >= 1, true);
    const csv = await adapter.execute(job('export_bom_csv', { rootAssembly: root, format: 'flattened' }));
    assert(csv.outputData.csv.includes('C-300'));
    const csv2 = await adapter.execute(job('export_bom_csv', { rootAssembly: root }));
    assert.strictEqual(csv2.outputData.format, 'indented');

    const used = await adapter.execute(job('where_used', { rootAssembly: root, partNumber: 'C-300' }));
    assert.strictEqual(used.outputData.totalOccurrences, 2);

    const draftChild = bomNode('D-1', 'Draft Part', 1, [], { lifecycleState: 'DRAFT' });
    const obsoleteChild = bomNode('E-1', 'Obsolete Part', 1, [], { lifecycleState: 'OBSOLETE' });
    const relRoot = bomNode('R-1', 'Released Assembly', 1, [draftChild, obsoleteChild], { lifecycleState: 'RELEASED' });
    const compliant = await adapter.execute(
      job('validate_lifecycle', {
        rootAssembly: relRoot,
        targetState: 'RELEASED',
        fromState: 'DRAFT',
        toState: 'RELEASED'
      })
    );
    assert.strictEqual(compliant.outputData.valid, false);
    assert(compliant.outputData.errors.length >= 1);
    assert(compliant.outputData.warnings.length >= 1);
    const skipped = await adapter.execute(
      job('validate_lifecycle', { rootAssembly: relRoot, fromState: 'DRAFT', toState: 'RELEASED', skipReview: true })
    );
    assert(skipped.outputData.warnings.every((w) => !w.includes('Bypassing')));
    const obsolete = await adapter.execute(
      job('validate_lifecycle', { rootAssembly: relRoot, fromState: 'OBSOLETE', toState: 'RELEASED' })
    );
    assert(obsolete.outputData.valid === false);
    await assert.rejects(
      () => adapter.execute(job('validate_lifecycle', { rootAssembly: relRoot, targetState: 'NOPE' })),
      /Invalid target lifecycle state/
    );

    const revA = {
      commitId: 'r1',
      units: { length: 'mm', volume: 'mm3' },
      volumeMm3: 100,
      faces: [{ id: 'f1', centroidMm: { x: 0, y: 0, z: 0 } }]
    };
    const revB = {
      commitId: 'r2',
      units: { length: 'mm', volume: 'mm3' },
      volumeMm3: 110,
      faces: [
        { id: 'f1', persistentId: 'p1', centroidMm: { x: 1, y: 0, z: 0 } },
        { id: 'f2', centroidMm: { x: 5, y: 5, z: 5 } }
      ]
    };
    const diff = await adapter.execute(job('visual_diff_cad', { revisionA: revA, revisionB: revB }));
    assert.strictEqual(diff.status, 'COMPLETED');
    assert(diff.outputData.quantities);
  });

  // ------------------------------------------------------------------
  // Robotics adapter validation
  // ------------------------------------------------------------------
  check('RoboticsEngineAdapter validation branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    const job = (operation, parameters, extra = {}) => ({
      jobId: `r29v-${operation}`,
      domain: 'robotics',
      operation,
      parameters,
      ...extra
    });
    await assert.rejects(() => adapter.execute(null), /received null request|non-object/);
    await assert.rejects(
      () => adapter.execute({ jobId: 'x', domain: 'cad', operation: 'forward_kinematics', parameters: {} }),
      /Domain mismatch/
    );
    await assert.rejects(() => adapter.execute(job('bogus_op', {})), /Unsupported robotics operation/);
    await assert.rejects(() => adapter.execute(job('forward_kinematics', {})), /explicit manipulator specification/);
    await assert.rejects(() => adapter.execute(job('forward_kinematics', { dhTable: [] })), /non-empty dhTable array/);
    await assert.rejects(
      () => adapter.execute(job('forward_kinematics', { dhTable: new Array(60).fill({ a: 0, alpha: 0, d: 0 }) })),
      /limited to/
    );
    await assert.rejects(
      () => adapter.execute(job('forward_kinematics', { dhTable: [{ a: NaN, alpha: 0, d: 0 }], q: [0] })),
      /non-finite kinematic parameters/
    );
    await assert.rejects(
      () => adapter.execute(job('forward_kinematics', { dhTable: [null], q: [0] })),
      /must be an object/
    );
    await assert.rejects(
      () => adapter.execute(job('forward_kinematics', { poeConfig: {} })),
      /screwAxes and 4x4 homeTransform/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('forward_kinematics', {
            screwAxes: new Array(60).fill([0, 0, 1, 0, 0, 0]),
            homeTransform: [
              [1, 0, 0, 0],
              [0, 1, 0, 0],
              [0, 0, 1, 0],
              [0, 0, 0, 1]
            ]
          })
        ),
      /limited to/
    );
    await assert.rejects(
      () => adapter.execute(job('forward_kinematics', { preset: 'BOSTON_DYNAMICS' })),
      /Unsupported manipulator preset/
    );
    await assert.rejects(() => adapter.execute(job('forward_kinematics', { urdf: '' })), /non-empty URDF/);
    await assert.rejects(
      () => adapter.execute(job('forward_kinematics', { urdf: '<robot name="x"></robot>' })),
      /URDF parse error|no valid <link>/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('forward_kinematics', {
            urdf: '<robot name="x"><link name="l"/><joint name="j" type="ball"><parent link="b"/><child link="l"/></joint></robot>'
          })
        ),
      /Unsupported URDF joint type/
    );
    await assert.rejects(
      () => adapter.execute(job('forward_kinematics', { urdf: { joints: [{ type: 'planar' }] } })),
      /Unsupported URDF joint type/
    );
    await assert.rejects(() => adapter.execute(job('forward_kinematics', { urdf: 42 })), /must be a string or object/);
    await assert.rejects(() => adapter.execute(job('inverse_kinematics', { preset: 'PUMA_560' })), /targetPose/);
    await assert.rejects(
      () =>
        adapter.execute(
          job('inverse_kinematics', {
            preset: 'PUMA_560',
            targetPose: [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
              [0, 0, 0]
            ]
          })
        ),
      /4x4 homogeneous transform/
    );
    await assert.rejects(
      () => adapter.execute(job('inverse_kinematics', { preset: 'PUMA_560', targetPose: { position: [1, 0] } })),
      /targetPose.position/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('inverse_kinematics', {
            poeConfig: {
              screwAxes: [[0, 0, 1, 0, 0, 0]],
              homeTransform: [
                [1, 0, 0, 0],
                [0, 1, 0, 0],
                [0, 0, 1, 0],
                [0, 0, 0, 1]
              ]
            },
            targetPose: { position: [0.2, 0, 0.4] }
          })
        ),
      /DH-parameterized/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('inverse_dynamics', {
            preset: 'PUMA_560',
            q: ZEROS6,
            qd: ZEROS6,
            qdd: ZEROS6,
            gravity: [0, 0, -9.81],
            externalWrench: [0, 0, 0, 0, 0, 0]
          })
        ),
      /linkDynamics/
    );
    await assert.rejects(
      () => adapter.execute(job('trajectory_plan', { q0: ZEROS6, qf: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1] })),
      /finite positive duration/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('trajectory_plan', { q0: ZEROS6, qf: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], duration: 1, numSteps: 1 })
        ),
      /numSteps/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('trajectory_plan', { q0: ZEROS6, qf: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], duration: 1, a0: [0, 0] })
        ),
      /'a0'/
    );
    await assert.rejects(
      () => adapter.execute(job('collision_check', { preset: 'PUMA_560', qStart: ZEROS6, qEnd: ZEROS6 })),
      /non-empty obstacles array/
    );
    await assert.rejects(
      () =>
        adapter.execute(job('collision_check', { preset: 'PUMA_560', qStart: ZEROS6, qEnd: ZEROS6, obstacles: [{}] })),
      /must expose triangles/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('collision_check', {
            preset: 'PUMA_560',
            qStart: ZEROS6,
            qEnd: ZEROS6,
            obstacles: [{ triangles: [['bad']] }],
            step: 0
          })
        ),
      /opts.step/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('collision_check', {
            preset: 'PUMA_560',
            qStart: ZEROS6,
            qEnd: ZEROS6,
            obstacles: [{ triangles: [['bad']] }],
            numSamples: 1
          })
        ),
      /numSamples/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('collision_check', {
            preset: 'PUMA_560',
            qStart: ZEROS6,
            qEnd: ZEROS6,
            obstacles: [{ triangles: [['bad']] }],
            linkRadius: -1
          })
        ),
      /linkRadius/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('collision_check', { preset: 'PUMA_560', qStart: [0], qEnd: ZEROS6, obstacles: [{ triangles: [[]] }] })
        ),
      /'qStart'/
    );
    await assert.rejects(() => adapter.execute(job('parse_urdf', {})), /non-empty URDF/);
  });

  check('RoboticsEngineAdapter execute paths', async () => {
    const adapter = new RoboticsEngineAdapter();
    const job = (operation, parameters) => ({ jobId: `r29e-${operation}`, domain: 'robotics', operation, parameters });
    const screw = [
      [0, 0, 1, 0, 0, 0],
      [0, 0, 1, 0, 0, 0],
      [0, 0, 1, 0, 0, 0]
    ];
    const home = [
      [1, 0, 0, 0.3],
      [0, 1, 0, 0],
      [0, 0, 1, 0.4],
      [0, 0, 0, 1]
    ];
    const fkPoe = await adapter.execute(
      job('forward_kinematics', {
        screwAxes: screw,
        homeTransform: home,
        q: [0.1, 0.2, 0.3],
        qd: [0.1, 0.1, 0.1],
        targetPose: home,
        targetOrientation: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1]
        ]
      })
    );
    assert.strictEqual(fkPoe.status, 'COMPLETED');
    assert(fkPoe.output.endEffectorLinearSpeed !== null);
    assert(fkPoe.output.residualHistory[0] !== null);
    const fkD = await adapter.execute(
      job('forward_kinematics', {
        preset: 'PUMA_560',
        q: ZEROS6,
        targetPosition: [0.1, 0.1, 0.1],
        jointVelocities: ZEROS6
      })
    );
    assert.strictEqual(fkD.status, 'COMPLETED');
    const fkPose3 = await adapter.execute(
      job('forward_kinematics', { preset: 'PUMA_560', q: ZEROS6, targetPose: [0.5, 0.5, 0.5] })
    );
    assert.strictEqual(fkPose3.status, 'COMPLETED');

    const urdfXml = `<robot name="mini">
      <link name="base"><inertial><mass value="1.0"/><origin xyz="0 0 0" rpy="0 0 0"/><inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/></inertial></link>
      <link name="l1"><inertial><mass value="0.5"/><origin xyz="0 0 0.1" rpy="0 0 0"/><inertia ixx="0.01" ixy="0" ixz="0" iyy="0.01" iyz="0" izz="0.01"/></inertial></link>
      <joint name="j1" type="revolute"><parent link="base"/><child link="l1"/><origin xyz="0 0 0.2" rpy="0 0 0"/><axis xyz="0 0 1"/><limit lower="-3.14" upper="3.14" effort="10" velocity="2"/></joint>
    </robot>`;
    const parsed = await adapter.execute(job('parse_urdf', { xml: urdfXml }));
    assert.strictEqual(parsed.status, 'COMPLETED');
    assert(parsed.output.urdfResidual !== null);
    const parsedJson = await adapter.execute(
      job('parse_urdf', {
        urdf: {
          name: 'j',
          links: [
            { name: 'base', inertial: { mass: 1, com: [0, 0, 0], inertia: [0.1, 0.1, 0.1] } },
            { name: 'l1', inertial: { mass: 1, com: [0, 0, 0], inertia: [0.1, 0.1, 0.1] } }
          ],
          joints: [
            {
              name: 'j1',
              type: 'revolute',
              parent: 'base',
              child: 'l1',
              origin: { xyz: [0, 0, 0.1], rpy: [0, 0, 0] },
              axis: [0, 0, 1],
              limit: { lower: -1, upper: 1, effort: 5, velocity: 1 }
            }
          ]
        }
      })
    );
    assert.strictEqual(parsedJson.output.dofCount, 1);

    const ikQ0 = [0.1, 0.2, 0.1, 0.2, 0.1, 0.2];
    const ikFk = SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, ikQ0);
    const ikTarget = [...ikFk.endEffectorTransform.map((row) => [...row])];
    const ik = await adapter.execute(
      job('inverse_kinematics', {
        preset: 'PUMA_560',
        targetPose: ikTarget,
        q0: ikQ0,
        maxIterations: 300,
        positionTolerance: 1e-3,
        orientationTolerance: 1e-2,
        damping: 0.05
      })
    );
    assert.strictEqual(ik.status, 'COMPLETED');
    assert.strictEqual(ik.output.converged, true);

    const linkDynamics = PUMA_560_DH.linkInertias.map((l) => ({ ...l, comFromJoint: false }));
    const invDyn = await adapter.execute(
      job('inverse_dynamics', {
        preset: 'PUMA_560',
        q: ZEROS6,
        qd: ZEROS6,
        qdd: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
        linkDynamics,
        gravity: [0, 0, -9.81],
        externalWrench: [0, 0, 0, 0, 0, 0]
      })
    );
    assert.strictEqual(invDyn.status, 'COMPLETED');
    assert(invDyn.output.torques.length === 6);

    const traj = await adapter.execute(
      job('trajectory_plan', {
        preset: 'PUMA_560',
        q0: ZEROS6,
        qf: [0.2, 0.1, 0.1, 0.1, 0.1, 0.1],
        v0: ZEROS6,
        vf: ZEROS6,
        a0: ZEROS6,
        af: ZEROS6,
        duration: 1,
        numSteps: 11,
        velocityLimits: [1, 1, 1, 1, 1, 1],
        accelerationLimits: [3, 3, 3, 3, 3, 3],
        torqueLimits: [50, 50, 50, 50, 50, 50]
      })
    );
    assert.strictEqual(traj.status, 'COMPLETED');
    assert(traj.output.maxCartesianSpeed !== null);

    const obstacle = {
      triangles: [
        [
          [0, 0, 0.5],
          [1, 0, 0.5],
          [0, 1, 0.5]
        ]
      ]
    };
    const clear = await adapter.execute(
      job('collision_check', {
        preset: 'PUMA_560',
        qStart: ZEROS6,
        qEnd: [0.1, -0.1, 0.1, 0.1, 0.1, 0.1],
        obstacles: [obstacle]
      })
    );
    assert.strictEqual(clear.status, 'COMPLETED');
    const emptyObs = await adapter.execute(
      job('collision_check', {
        preset: 'PUMA_560',
        qStart: ZEROS6,
        qEnd: [0.1, 0, 0, 0, 0, 0],
        obstacles: [{ toTriangles: () => [] }]
      })
    );
    assert.strictEqual(emptyObs.output.collided, false);
    await assert.rejects(
      () =>
        adapter.execute(
          job('collision_check', {
            preset: 'PUMA_560',
            qStart: ZEROS6,
            qEnd: [0.1, 0, 0, 0, 0, 0],
            obstacles: [
              {
                toTriangles: () => {
                  throw new Error('bad mesh');
                }
              }
            ]
          })
        ),
      /RoboticsEngineAdapter execution error/
    );

    const badTarget = [
      [1, 0, 0, 999],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
    await assert.rejects(
      () =>
        adapter.execute(
          job('inverse_kinematics', {
            preset: 'PUMA_560',
            targetPose: badTarget,
            q0: ZEROS6,
            maxIterations: 4,
            positionTolerance: 1e-12,
            orientationTolerance: 1e-12
          })
        ),
      /converge|divergence/
    );
  });

  // ------------------------------------------------------------------
  // Kinematics direct
  // ------------------------------------------------------------------
  check('SerialManipulatorEngine direct branch edges', () => {
    assert.throws(
      () =>
        SerialManipulatorEngine.forwardKinematicsPoE(
          [],
          [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1]
          ],
          []
        ),
      /non-empty screwAxes/
    );
    assert.throws(
      () =>
        SerialManipulatorEngine.forwardKinematicsPoE(
          [[0, 0, 1, 0, 0, 0]],
          [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1]
          ],
          [0.1, 0.2]
        ),
      /joint angles/
    );
    const poe = SerialManipulatorEngine.forwardKinematicsPoE(
      [
        [0, 0, 1, 0, 0, 0],
        [0, 0, 1, 0, 0, 0]
      ],
      null,
      [0.1, 0.2]
    );
    assert.strictEqual(poe.convention, 'poe');
    const specQ = SerialManipulatorEngine.forwardKinematics({ dhTable: PUMA_560_DH, q: ZEROS6 });
    assert.strictEqual(specQ.position.length, 3);
    const chainSpec = SerialManipulatorEngine.forwardKinematics(
      { dhTable: PUMA_560_DH, jointAngles: ZEROS6 },
      undefined,
      'standard_dh'
    );
    assert.strictEqual(chainSpec.position.length, 3);
    assert.throws(
      () => SerialManipulatorEngine.forwardKinematics({ dhTable: [] }, []),
      /cannot be empty|non-empty dhTable/
    );
    assert.throws(
      () => SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, [0, 0, 0, 0, 0, NaN]),
      /finite joint angles/
    );
    const urdfRow = {
      urdfOrigin: { xyz: [0, 0, 0.2], rpy: [0, 0, 0] },
      urdfAxis: [0, 0, 1],
      type: 'prismatic'
    };
    const prismaticFk = SerialManipulatorEngine.forwardKinematics(
      [urdfRow, { ...urdfRow, type: 'fixed' }, { ...urdfRow, type: 'revolute' }],
      [0.05, 0.1, 0.2]
    );
    assert.strictEqual(prismaticFk.position.length, 3);
    const dhPrismatic = SerialManipulatorEngine.forwardKinematics(
      [
        { a: 0, alpha: 0, d: 0.2, type: 'prismatic' },
        { a: 0.1, alpha: 0, d: 0, type: 'revolute', convention: 'modified_dh' }
      ],
      [0.05, 0.2],
      'standard_dh'
    );
    assert.strictEqual(dhPrismatic.position.length, 3);

    const home = [
      [1, 0, 0, 0.3],
      [0, 1, 0, 0],
      [0, 0, 1, 0.4],
      [0, 0, 0, 1]
    ];
    assert.throws(() => SerialManipulatorEngine.inverseKinematics(null), /inverseKinematics requires/);
    assert.throws(
      () => SerialManipulatorEngine.inverseKinematics([], [1, 2, 3], [0]),
      /cannot be empty|targetPosition/
    );
    const ikTough = SerialManipulatorEngine.inverseKinematics({
      dhTable: PUMA_560_DH,
      targetPosition: [0.2, 0.1, 0.3],
      q0: ZEROS6,
      maxIterations: 3,
      tolerance: 1e-12
    });
    assert(Array.isArray(ikTough.q) && ikTough.q.length === 6);
    const ikOk = SerialManipulatorEngine.inverseKinematics({
      dhTable: PUMA_560_DH,
      targetPose: home,
      initialGuess: [0.1, 0.2, 0.1, 0.2, 0.1, 0.2],
      maxIterations: 200
    });
    assert(ikOk.converged === true || ikOk.q.length === 6);
    const ikPos = SerialManipulatorEngine.inverseKinematics(
      PUMA_560_DH,
      [0.3, 0.2, 0.5],
      [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      { maxIterations: 80 }
    );
    assert(ikPos.q.length === 6);

    const inertObj = SerialManipulatorEngine._parseInertiaTensor({ ixx: 1, iyy: 2, izz: 3, ixy: 0.5, ixz: 0, iyz: 0 });
    assert.strictEqual(inertObj[0][1], 0.5);
    assert(SerialManipulatorEngine._parseInertiaTensor(null)[0][0] === 0);
    assert(SerialManipulatorEngine._parseInertiaTensor([1, 2, 3])[1][1] === 2);
    assert(
      SerialManipulatorEngine._parseInertiaTensor([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ])[0][0] === 1
    );
    assert(SerialManipulatorEngine._parseInertiaTensor([1, 2, 3, 4, 5, 6])[0][1] === 4);

    const fixed = { a: 0, alpha: 0, d: 0.1, type: 'fixed' };
    const mixed = [
      { a: 0, alpha: 0, d: 0.2, type: 'revolute' },
      fixed,
      { a: 0.1, alpha: 0, d: 0.05, type: 'prismatic' }
    ];
    const dyn = SerialManipulatorEngine.inverseDynamics({
      dhTable: mixed,
      linkInertias: [
        { mass: 1, com: [0, 0, 0], inertia: [0.1, 0.1, 0.1] },
        { mass: 1, com: [0, 0, 0], inertia: [0.1, 0.1, 0.1] },
        { mass: 1, com: [0, 0, 0], inertia: [0.1, 0.1, 0.1] }
      ],
      q: [0.1, 0.2, 0.05],
      qd: [0.1, 0.1, 0.1],
      qdd: [0.1, 0.1, 0.1],
      gravity: [0, 0, -9.81],
      externalWrench: [0, 0, 0, 0, 0, 0]
    });
    assert.strictEqual(dyn.torques.length, 3);
    assert.strictEqual(dyn.torques[1], 0);
    assert.throws(
      () =>
        SerialManipulatorEngine.inverseDynamics({
          dhTable: PUMA_560_DH.slice(),
          q: ZEROS6,
          qd: ZEROS6,
          qdd: ZEROS6,
          gravity: [0, 0, -9.81],
          externalWrench: [0, 0, 0, 0, 0, 0]
        }),
      /linkInertias/
    );
    assert.throws(
      () =>
        SerialManipulatorEngine.inverseDynamics({
          dhTable: PUMA_560_DH,
          linkInertias: PUMA_560_DH.linkInertias,
          q: ZEROS6,
          qd: ZEROS6,
          qdd: ZEROS6,
          gravity: [0, 0]
        }),
      /gravity vector/
    );
    assert.throws(
      () =>
        SerialManipulatorEngine.inverseDynamics({
          dhTable: PUMA_560_DH,
          linkInertias: PUMA_560_DH.linkInertias,
          q: ZEROS6,
          qd: ZEROS6,
          qdd: ZEROS6,
          gravity: [0, 0, -9.81],
          externalWrench: [0, 0, 0]
        }),
      /externalWrench/
    );
    assert.throws(
      () =>
        SerialManipulatorEngine.inverseDynamics({
          dhTable: PUMA_560_DH,
          linkInertias: PUMA_560_DH.linkInertias.map((l) => ({ ...l, mass: -1 })),
          q: ZEROS6,
          qd: ZEROS6,
          qdd: ZEROS6,
          gravity: [0, 0, -9.81],
          externalWrench: [0, 0, 0, 0, 0, 0]
        }),
      /mass must be a non-negative/
    );
    assert.throws(() => SerialManipulatorEngine.inverseDynamics(null), /inverseDynamics requires/);
    const mm = SerialManipulatorEngine.computeMassMatrix({ dhTable: PUMA_560_DH }, PUMA_560_DH.linkInertias, ZEROS6);
    assert.strictEqual(mm.length, 6);
    assert.strictEqual(mm[0].length, 6);

    assert.throws(() => SerialManipulatorEngine.planQuinticTrajectory(null), /configuration object/);
    assert.throws(() => SerialManipulatorEngine.planQuinticTrajectory({}), /qStart/);
    assert.throws(() => SerialManipulatorEngine.planQuinticTrajectory({ qStart: [0, 0], qEnd: [1] }), /qEnd/);
    assert.throws(
      () => SerialManipulatorEngine.planQuinticTrajectory({ qStart: [0, 0], qEnd: [1, 1], duration: 0 }),
      /positive finite duration/
    );
    assert.throws(
      () => SerialManipulatorEngine.planQuinticTrajectory({ qStart: [0, 0], qEnd: [1, 1], duration: 1, dt: -1 }),
      /positive finite dt/
    );
    const q = SerialManipulatorEngine.planQuinticTrajectory({
      qStart: [0, 0],
      qEnd: [1, 1],
      duration: 2,
      numSteps: 21,
      v0: [0, 0],
      vf: [0.2, 0.2],
      a0: [0, 0],
      af: [0, 0]
    });
    assert(q.samples.length > 1);
    const q2 = SerialManipulatorEngine.planQuinticTrajectory({
      q0: [0],
      qf: [1],
      T: 0.5,
      v0: [0.1],
      vf: [0.2],
      a0: [0.05],
      af: [0.1]
    });
    assert(q2.waypoints.length > 1);

    assert.throws(() => SerialManipulatorEngine.parseURDF(''), /non-empty URDF/);
    assert.throws(() => SerialManipulatorEngine.parseURDF(null), /non-empty URDF/);
    assert.throws(() => SerialManipulatorEngine.parseURDF(123), /non-empty string or object/);
    assert.throws(
      () => SerialManipulatorEngine.parseURDF('<robot name="x"></robot>'),
      /at least one <joint>|missing <robot>/
    );
    const jsonChain = SerialManipulatorEngine.parseURDF({
      name: 'jsonbot',
      links: [
        { name: 'base', inertial: { mass: 2, com: [0, 0, 0], inertia: [0.2, 0.2, 0.2] } },
        { name: 'l1', inertial: { mass: 1, com: [0, 0, 0.05], inertia: [0.1, 0.1, 0.1] } },
        { name: 'l2', inertial: { mass: 1, com: [0, 0, 0.05], inertia: [0.1, 0.1, 0.1] } },
        { name: 'orphan', inertial: null }
      ],
      joints: [
        {
          name: 'j1',
          type: 'revolute',
          parent: 'base',
          child: 'l1',
          origin: { xyz: [0, 0, 0.2], rpy: [0, 0, 0] },
          axis: [0, 0, 1],
          limit: { lower: -1, upper: 1, effort: 10, velocity: 2 }
        },
        { name: 'j2', type: 'continuous', parent: 'l1', child: 'l2', axis: [1, 0, 0], limit: {} },
        { name: 'j3', type: 'fixed', parent: 'orphan', child: 'l2', origin: { xyz: [0.1, 0, 0] } }
      ]
    });
    assert(jsonChain.dhTable.length >= 2);
    assert.strictEqual(jsonChain.joints.length, 3);
    assert.strictEqual(jsonChain.rootLink, 'base');
  });

  // ------------------------------------------------------------------
  // Collision checks
  // ------------------------------------------------------------------
  check('collision_checks primitives and mesh/path checks', () => {
    const home = [
      [1, 0, 0, 0.3],
      [0, 1, 0, 0],
      [0, 0, 1, 0.4],
      [0, 0, 0, 1]
    ];
    const obstacle = {
      triangles: [
        [
          [0, 0, 0.5],
          [1, 0, 0.5],
          [0, 1, 0.5]
        ]
      ]
    };
    assert.throws(() => coll.toVec3(null), /null vector/);
    assert.throws(() => coll.toVec3([1, 2]), /3 components/);
    assert.throws(() => coll.toVec3({ x: 1, y: 2 }), /finite numbers/);
    assert.throws(() => coll.toVec3(5), /array or \{x,y,z\}/);
    assert.deepStrictEqual(coll.toVec3({ x: 1, y: 2, z: 3 }), [1, 2, 3]);
    assert.deepStrictEqual(coll.toVec3([1, 2, 3]), [1, 2, 3]);
    assert.strictEqual(coll.normalizeTriangle({ a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] }).length, 3);
    assert.strictEqual(coll.normalizeTriangle({ a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0] }), null);
    assert.throws(() => coll.normalizeTriangle({ a: 1, b: 2, c: 3 }), /vector must be|triangle must be/);
    assert.throws(
      () =>
        coll.normalizeTriangle([
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, NaN]
        ]),
      /finite/
    );
    assert.throws(() => coll.extractTriangles(null), /obstacle must be an object/);
    assert.strictEqual(
      coll.extractTriangles({
        triangles: [
          [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0]
          ]
        ]
      }).length,
      1
    );
    assert.strictEqual(
      coll.extractTriangles({
        mesh: {
          triangles: [
            [
              [0, 0, 0],
              [1, 0, 0],
              [0, 1, 0]
            ]
          ]
        }
      }).length,
      1
    );
    assert.strictEqual(
      coll.extractTriangles({
        toTriangles: () => [
          [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0]
          ]
        ]
      }).length,
      1
    );
    assert.strictEqual(
      coll.extractTriangles({
        solid: {
          toTriangles: () => [
            [
              [0, 0, 0],
              [1, 0, 0],
              [0, 1, 0]
            ]
          ]
        }
      }).length,
      1
    );
    assert.throws(() => coll.extractTriangles({ foo: 1 }), /must expose triangles/);

    const T1 = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0]
    ];
    const T2 = [
      [0.2, 0.2, 0],
      [1.2, 0.2, 0],
      [0.2, 1.2, 0]
    ];
    const Tfar = [
      [5, 5, 5],
      [6, 5, 5],
      [5, 6, 5]
    ];
    assert.throws(
      () => coll.trianglesIntersect([0, 0, NaN], [1, 0, 0], [0, 1, 0], [0.2, 0.2, 0], [1.2, 0.2, 0], [0.2, 1.2, 0]),
      /finite numbers/
    );
    assert.strictEqual(
      coll.trianglesIntersect([0, 0, 0], [0, 0, 0], [0, 0, 0], [0.2, 0.2, 0], [1.2, 0.2, 0], [0.2, 1.2, 0]).degenerate,
      true
    );
    assert.strictEqual(coll.trianglesIntersect(T1[0], T1[1], T1[2], Tfar[0], Tfar[1], Tfar[2]).collided, false);
    const coplanarHit = coll.trianglesIntersect(T1[0], T1[1], T1[2], T2[0], T2[1], T2[2]);
    assert.strictEqual(coplanarHit.collided, true);
    assert.strictEqual(coplanarHit.coplanar, true);
    const coplanarMiss = coll.trianglesIntersect(T1[0], T1[1], T1[2], [3, 3, 0], [4, 3, 0], [3, 4, 0]);
    assert.strictEqual(coplanarMiss.collided, false);
    const parallel = coll.trianglesIntersect(T1[0], T1[1], T1[2], [0, 0, 2], [1, 0, 2], [0, 1, 2]);
    assert.strictEqual(parallel.collided, false);
    const crossing = coll.trianglesIntersect(T1[0], T1[1], T1[2], [0.5, -0.5, 0], [0.5, 1.5, 0], [0.5, 0.5, 2]);
    assert.strictEqual(crossing.collided, true);
    assert(crossing.segment && crossing.segment.length === 2);

    const tri = [T1[0], T1[1], T1[2]];
    assert.strictEqual(coll.closestPointOnTriangle([-1, -1, 0], ...tri).point[0], 0);
    const onB = coll.closestPointOnTriangle([2, 0, 0], ...tri);
    assert(Math.abs(onB.point[0] - 1) < 1e-6);
    const onC = coll.closestPointOnTriangle([0, 2, 0], ...tri);
    assert(Math.abs(onC.point[1] - 1) < 1e-6);
    const onAB = coll.closestPointOnTriangle([0.5, -1, 0], ...tri);
    assert(Math.abs(onAB.point[1]) < 1e-6);
    const onAC = coll.closestPointOnTriangle([-1, 0.5, 0], ...tri);
    assert(Math.abs(onAC.point[0]) < 1e-6);
    const onBC = coll.closestPointOnTriangle([1.2, 1.2, 0], ...tri);
    assert(onBC.sqDist > 0);
    const interior = coll.closestPointOnTriangle([0.2, 0.2, 0], ...tri);
    assert(interior.sqDist < 1e-9);
    assert(coll.pointTriangleDistanceSq([10, 10, 10], tri).sqDist > 0);
    const st = coll.segmentTriangleDistanceSq([0.5, 0.5, -1], [0.5, 0.5, 1], tri);
    assert.strictEqual(st.sqDist, 0);
    const st2 = coll.segmentTriangleDistanceSq([5, 5, 5], [6, 6, 6], tri);
    assert(st2.sqDist > 0);
    const stZero = coll.segmentTriangleDistanceSq(
      [0, 0, 0],
      [0, 0, 0],
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ]
    );
    assert(stZero.sqDist > 0);

    assert.strictEqual(coll.meshCollision([], [T2]), false);
    assert.strictEqual(coll.meshCollision([T1], [Tfar]), false);
    assert.strictEqual(coll.meshCollision([T1], [T2]), true);
    assert.strictEqual(coll.meshCollision([T1], [T2], { returnDetails: true }).phase, 'narrowphase');
    assert.strictEqual(coll.meshCollision([], [], { returnDetails: true }).reason, 'empty-mesh');
    assert.strictEqual(coll.meshCollision({ triangles: [T1] }, { triangles: [T2] }), true);
    assert.strictEqual(coll.meshCollision({ toTriangles: () => [T1] }, { solid: { toTriangles: () => [T2] } }), true);
    assert.throws(() => coll.meshCollision('bad', T2), /mesh must be/);

    const sphere = { type: 'sphere', center: [0.5, 0.5, 0.05], radius: 0.4 };
    const cap = { type: 'capsule', start: [0.2, 0.2, -0.5], end: [0.2, 0.2, 1.5], radius: 0.3 };
    const obsList = [{ index: 0, triangles: [tri], aabb: coll.computeTrianglesAABB([tri]) }];
    assert.strictEqual(coll.testPrimitiveVsObstacles(sphere, obsList).hit, true);
    assert.strictEqual(coll.testPrimitiveVsObstacles(cap, obsList).hit, true);
    const missSphere = { type: 'sphere', center: [10, 10, 10], radius: 0.1 };
    assert.strictEqual(coll.testPrimitiveVsObstacles(missSphere, obsList).hit, false);
    assert.throws(
      () => coll.testPrimitiveVsObstacles({ type: 'box', start: [0, 0, 0], end: [1, 1, 1], radius: 1 }, obsList),
      /unsupported link primitive type/
    );

    const cw = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 }
    ];
    const ccw = planar.toCcw(cw);
    assert.throws(() => coll.checkRobotPath('PUMA_560', [0], ZEROS6, [obstacle]), /qStart/);
    assert.throws(() => coll.checkRobotPath('PUMA_560', ZEROS6, [0], [obstacle]), /qEnd/);
    assert.throws(() => coll.checkRobotPath('PUMA_560', ZEROS6, ZEROS6, []), /non-empty array/);
    assert.throws(() => coll.checkRobotPath('PUMA_560', ZEROS6, ZEROS6, [obstacle], { step: 0 }), /opts.step/);
    assert.throws(
      () => coll.checkRobotPath('PUMA_560', ZEROS6, ZEROS6, [obstacle], { linkRadius: -1 }),
      /opts.linkRadius/
    );
    assert.throws(() => coll.checkRobotPath('PUMA_560', ZEROS6, ZEROS6, [obstacle], { numSamples: 1 }), /numSamples/);
    assert.strictEqual(coll.checkRobotPath('PUMA_560', ZEROS6, ZEROS6, [{ toTriangles: () => [] }]), null);
    const p1 = coll.checkRobotPath('PUMA_560', ZEROS6, [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], [obstacle], {
      numSamples: 5,
      linkRadius: 0.02
    });
    assert(p1 === null || p1.collided === true);
    const p2 = coll.checkRobotPath(
      'PUMA_560',
      ZEROS6,
      [0.05, 0, 0, 0, 0, 0],
      [
        {
          triangles: [
            [
              [0, 0, 0.02],
              [1, 0, 0.02],
              [0, 1, 0.02]
            ]
          ]
        }
      ]
    );
    assert(p2 === null || p2.collided === true);
    const linkGeo = coll.buildLinkPrimitives(
      { jointFrames: [home, home, home, home, home, home, home] },
      6,
      {
        linkGeometry: [
          [{ type: 'sphere', center: [0, 0, 0], radius: 0.1 }],
          [{ type: 'capsule', start: [0, 0, 0], end: [0, 0, 0.2], radius: 0.05 }]
        ]
      },
      0.04
    );
    assert.strictEqual(linkGeo.length, 6);
    assert.throws(
      () =>
        coll.buildLinkPrimitives(
          { jointFrames: [home, home] },
          1,
          { linkGeometry: [[{ type: 'cone', center: [0, 0, 0], radius: 1 }]] },
          0.04
        ),
      /unsupported linkGeometry primitive/
    );
  });

  let pendingSettled = true;
  if (process.env.GAP29_SEQ === '1') {
    console.error(`[gap29] checks registered: ${pending.length}`);
    for (let idx = 0; idx < pending.length; idx++) {
      const run = pending[idx];
      const t0 = Date.now();
      console.error(`[gap29] starting check ${idx + 1}/${pending.length}`);
      try {
        await run();
      } catch (err) {
        console.error(`[seq] unexpected run error: ${err.message}`);
      }
      console.error(`[seq] check ${idx + 1} took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  } else {
    pendingSettled = await Promise.race([
      Promise.all(pending.map((run) => run())).then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 120000))
    ]);
    if (!pendingSettled) {
      failedTests += pending.length;
      console.error('  ✗ WARN: timed out waiting for pending checks; marking them failed');
    }
  }

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapTwentyNineCoverageTests };

if (require.main === module) {
  runBranchGapTwentyNineCoverageTests().then(async (stats) => {
    const { getGlobalPersistentWorkerPool } = require('../src/core/math/worker_pool');
    try {
      await getGlobalPersistentWorkerPool().terminateAll();
    } catch (_) {}
    console.log(`gap29: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
