/**
 * Standalone industrial tests for:
 *  - .omni v3 WAL (journal.wal) round-trip, torn-write recovery, atomicity
 *  - HPC Cluster Gateway Slurm/PBS script generators and job state machine
 *
 * Run directly: node test/test_storage_hpc_industrial.js
 * Exposes runStorageHpcIndustrialTests() -> { total, passed, failed }.
 * Intentionally NOT registered in run_all_tests.js.
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { OmniArchiveV2, OmniWal } = require('../src/core/storage/omni_archive');
const { HpcClusterGateway, JOB_STATES } = require('../src/core/hpc/hpc_cluster_gateway');
const { HpcClusterGateway: LegacyHpcClusterGateway } = require('../src/core/math/hpc_cluster_gateway');
const { OmniError, OmniErrorCode } = require('../src/core/contracts/OmniError');
const { JobResult, JobStatus } = require('../src/core/contracts/JobResult');
const { PersistentWorkerPool } = require('../src/core/math/worker_pool');

function sha256Of(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function mkTemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runStorageHpcIndustrialTests() {
  const results = [];
  let total = 0;
  let passed = 0;
  let failed = 0;

  function t(name, fn) {
    total++;
    try {
      fn();
      passed++;
      results.push(`  PASS  ${name}`);
    } catch (err) {
      failed++;
      results.push(
        `  FAIL  ${name}\n        ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n        ') : err}`
      );
    }
  }

  // ------------------------------------------------------------------ WAL --
  t('WAL: round-trip — committed ops survive reopen with recovered:true', () => {
    const dir = mkTemp('omni-wal-rt-');
    try {
      const archivePath = path.join(dir, 'proj.omni');
      const archive = new OmniArchiveV2({ projectName: 'WAL Round Trip' });
      archive.saveToFile(archivePath);

      const walPath = path.join(dir, 'journal.wal');
      const enabled = archive.enableWal();
      assert.strictEqual(enabled.path, walPath);
      assert.strictEqual(fs.existsSync(walPath), true);

      const content = 'MESH_BINARY_PAYLOAD_001';
      const first = archive.appendWalEntry('add_blob', {
        dataBase64: Buffer.from(content, 'utf8').toString('base64'),
        mimeType: 'application/x-omni-mesh+json',
        name: 'mesh.bin'
      });
      assert.strictEqual(first.seq, 1);
      assert.strictEqual(first.digest.length, 64);

      archive.appendWalEntry('journal_execute', {
        actionType: 'CAD_ADD_HOLE',
        forwardPatch: { x: 1, y: 2, d: 5 },
        reversePatch: { deleted: true },
        description: 'Add M5 hole',
        author: 'tester'
      });
      archive.appendWalEntry('record_result', {
        result: new JobResult({ jobId: 'job-1', status: JobStatus.COMPLETED, output: { maxStressMpa: 42 } }).toJSON()
      });

      let stats = archive.getWalStats();
      assert.strictEqual(stats.committed, 0);
      assert.strictEqual(stats.pending, 3);

      const committed = archive.commitTransaction();
      assert.strictEqual(committed.committed, 3);
      assert.strictEqual(committed.pending, 0);
      assert.strictEqual(committed.wal, true);
      assert.strictEqual(committed.seq, 4);

      stats = archive.getWalStats();
      assert.strictEqual(stats.committed, 3);
      assert.strictEqual(stats.seq, 4);
      assert.strictEqual(stats.recovered, false);

      const reloaded = OmniArchiveV2.loadFromFile(archivePath);
      const hash = sha256Of(content);
      assert.strictEqual(reloaded.hasBlob(hash), true);
      assert.strictEqual(reloaded.getBlob(hash).toString('utf8'), content);
      assert.strictEqual(reloaded.journal.history.length, 1);
      assert.strictEqual(reloaded.journal.history[0].actionType, 'CAD_ADD_HOLE');
      assert.strictEqual(reloaded.results.length, 1);
      assert.strictEqual(reloaded.results[0].jobId, 'job-1');

      const rec = reloaded.getWalStats();
      assert.strictEqual(rec.recovered, true);
      assert.strictEqual(rec.committed, 3);
      assert.strictEqual(rec.seq, 4);
      assert.strictEqual(rec.pending, 0);
      assert.strictEqual(rec.path, walPath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  t('WAL: torn mid-append write recovers last committed state (recovered:true)', () => {
    const dir = mkTemp('omni-wal-torn-');
    try {
      const archivePath = path.join(dir, 'proj.omni');
      const archive = new OmniArchiveV2({ projectName: 'Torn Write' });
      archive.saveToFile(archivePath);
      archive.enableWal();

      const committedContent = 'COMMITTED_BLOB';
      archive.appendWalEntry('add_blob', {
        dataBase64: Buffer.from(committedContent, 'utf8').toString('base64'),
        name: 'committed.bin'
      });
      archive.commitTransaction();

      const tornContent = 'TORN_UNCOMMITTED_BLOB';
      archive.appendWalEntry('add_blob', {
        dataBase64: Buffer.from(tornContent, 'utf8').toString('base64'),
        name: 'torn.bin'
      });
      archive.flushWal();
      const walPath = path.join(dir, 'journal.wal');
      const raw = fs.readFileSync(walPath, 'utf8');
      assert.ok(
        raw.includes(Buffer.from(tornContent, 'utf8').toString('base64')),
        'flushed uncommitted entry must be present on disk before truncation'
      );
      archive.disableWal();

      fs.writeFileSync(walPath, raw.slice(0, Math.max(1, raw.length - 9)));

      const reloaded = OmniArchiveV2.loadFromFile(archivePath);
      const stats = reloaded.getWalStats();
      assert.strictEqual(stats.recovered, true);
      assert.strictEqual(stats.committed, 1);
      assert.strictEqual(stats.seq, 2);
      assert.strictEqual(stats.pending, 0);

      const committedHash = sha256Of(committedContent);
      const tornHash = sha256Of(tornContent);
      assert.strictEqual(reloaded.hasBlob(committedHash), true, 'committed blob must survive');
      assert.strictEqual(reloaded.hasBlob(tornHash), false, 'torn uncommitted blob must be discarded');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  t('WAL: atomicity — complete-but-uncommitted tail is discarded on reopen', () => {
    const dir = mkTemp('omni-wal-atomic-');
    try {
      const archivePath = path.join(dir, 'proj.omni');
      const archive = new OmniArchiveV2({ projectName: 'Atomicity' });
      archive.saveToFile(archivePath);
      archive.enableWal();

      const firstContent = 'FIRST_COMMITTED';
      archive.appendWalEntry('add_blob', {
        dataBase64: Buffer.from(firstContent, 'utf8').toString('base64')
      });
      archive.commitTransaction();

      const uncommittedContent = 'UNCOMMITTED_TAIL';
      archive.appendWalEntry('add_blob', {
        dataBase64: Buffer.from(uncommittedContent, 'utf8').toString('base64')
      });
      archive.flushWal();
      archive.disableWal();

      const reloaded = OmniArchiveV2.loadFromFile(archivePath);
      const stats = reloaded.getWalStats();
      assert.strictEqual(stats.recovered, true);
      assert.strictEqual(stats.committed, 1);
      assert.strictEqual(stats.discarded, 1);
      assert.strictEqual(reloaded.hasBlob(sha256Of(firstContent)), true);
      assert.strictEqual(reloaded.hasBlob(sha256Of(uncommittedContent)), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  t('WAL: atomic save rebases the WAL; reopen reports recovered:false', () => {
    const dir = mkTemp('omni-wal-rebase-');
    try {
      const archivePath = path.join(dir, 'proj.omni');
      const archive = new OmniArchiveV2({ projectName: 'Rebase' });
      archive.saveToFile(archivePath);
      archive.enableWal();

      archive.addBlob(Buffer.from('SNAPSHOT_BLOB', 'utf8'));
      archive.appendWalEntry('add_blob', {
        dataBase64: Buffer.from('SNAPSHOT_BLOB', 'utf8').toString('base64')
      });
      archive.commitTransaction();
      archive.saveToFile(archivePath);

      const stats = archive.getWalStats();
      assert.strictEqual(stats.committed, 0);
      assert.strictEqual(stats.seq, 1);
      assert.strictEqual(stats.pending, 0);

      const reloaded = OmniArchiveV2.loadFromFile(archivePath);
      const rec = reloaded.getWalStats();
      assert.strictEqual(rec.recovered, false);
      assert.strictEqual(rec.committed, 0);
      assert.strictEqual(rec.seq, 1);
      assert.strictEqual(reloaded.hasBlob(sha256Of('SNAPSHOT_BLOB')), true, 'snapshot content retained');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  t('WAL: stats shape and no-WAL defaults', () => {
    const dir = mkTemp('omni-wal-stats-');
    try {
      const archive = new OmniArchiveV2({ projectName: 'Stats' });
      const stats = archive.getWalStats();
      assert.strictEqual(stats.path, null);
      assert.strictEqual(stats.seq, 0);
      assert.strictEqual(stats.committed, 0);
      assert.strictEqual(stats.recovered, false);
      assert.strictEqual(stats.pending, 0);

      const noWalCommit = archive.commitTransaction();
      assert.strictEqual(noWalCommit.wal, false);

      const archivePath = path.join(dir, 'proj.omni');
      archive.saveToFile(archivePath);
      archive.enableWal();
      assert.throws(
        () => archive.appendWalEntry(123, {}),
        (e) => e instanceof OmniError
      );
      const loaded = OmniArchiveV2.loadFromFile(archivePath);
      assert.strictEqual(loaded.getWalStats().recovered, false);
      assert.strictEqual(OmniWal.derivePath(archivePath), path.join(dir, 'journal.wal'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ------------------------------------------------------------- Slurm ----
  t('HPC: generateSlurmScript emits genuine SBATCH headers and srun command', () => {
    const spec = HpcClusterGateway.generateSlurmScript({
      jobName: 'fea_run',
      partition: 'gpu_q',
      nodes: 2,
      ntasksPerNode: 8,
      cpusPerTask: 2,
      gpusPerNode: 4,
      memoryPerNode: '256GB',
      walltime: '02:30:00',
      account: 'eng-prod',
      qos: 'high',
      email: 'eng@example.com',
      modules: ['openmpi/4.1.5', 'cuda/12.2'],
      executable: 'omnieng-headless-daemon',
      args: ['--mode=mpi_distributed', '--decomposition=rcb']
    });
    assert.strictEqual(spec.scheduler, 'SLURM');
    assert.strictEqual(spec.totalMpiRanks, 16);
    assert.strictEqual(spec.totalCores, 32);
    assert.strictEqual(spec.totalGpus, 8);
    const s = spec.script;
    assert.ok(s.startsWith('#!/bin/bash\n'));
    assert.ok(s.includes('#SBATCH --job-name=fea_run'));
    assert.ok(s.includes('#SBATCH --partition=gpu_q'));
    assert.ok(s.includes('#SBATCH --nodes=2'));
    assert.ok(s.includes('#SBATCH --ntasks-per-node=8'));
    assert.ok(s.includes('#SBATCH --cpus-per-task=2'));
    assert.ok(s.includes('#SBATCH --gres=gpu:4'));
    assert.ok(s.includes('#SBATCH --mem=256GB'));
    assert.ok(s.includes('#SBATCH --time=02:30:00'));
    assert.ok(s.includes('#SBATCH --account=eng-prod'));
    assert.ok(s.includes('#SBATCH --qos=high'));
    assert.ok(s.includes('#SBATCH --mail-user=eng@example.com'));
    assert.ok(s.includes('module load openmpi/4.1.5'));
    assert.ok(s.includes('module load cuda/12.2'));
    assert.ok(
      s.includes('srun --mpi=pmix_v3 -n 16 omnieng-headless-daemon --mode=mpi_distributed --decomposition=rcb')
    );
  });

  t('HPC: generateSlurmScript defaults and gres omission', () => {
    const spec = HpcClusterGateway.generateSlurmScript({ jobName: 'def' });
    assert.strictEqual(spec.nodes, 1);
    assert.strictEqual(spec.ntasksPerNode, 16);
    assert.strictEqual(spec.totalMpiRanks, 16);
    assert.ok(!spec.script.includes('--gres='));
    assert.ok(spec.script.includes('#SBATCH --partition=compute_gpu'));
  });

  t('HPC: generatePbsProScript emits genuine #PBS headers and mpiexec command', () => {
    const spec = HpcClusterGateway.generatePbsProScript({
      jobName: 'cfd_sweep',
      queue: 'workq',
      nodes: 3,
      mpiRanksPerNode: 8,
      cpusPerRank: 4,
      walltime: '08:00:00',
      memoryPerNode: '512GB',
      account: 'eng-prod',
      email: 'eng@example.com',
      modules: ['mpt/2.28', 'intel-oneapi-mkl/2023.2.0'],
      executable: 'omnieng-headless-daemon',
      args: ['--mode=pbs_distributed']
    });
    assert.strictEqual(spec.scheduler, 'PBS_PRO');
    assert.strictEqual(spec.totalMpiRanks, 24);
    const s = spec.script;
    assert.ok(s.startsWith('#!/bin/bash\n'));
    assert.ok(s.includes('#PBS -N cfd_sweep'));
    assert.ok(s.includes('#PBS -q workq'));
    assert.ok(s.includes('#PBS -l select=3:ncpus=32:mpiprocs=8:ompthreads=4'));
    assert.ok(s.includes('#PBS -l walltime=08:00:00'));
    assert.ok(s.includes('#PBS -l mem=512GB'));
    assert.ok(s.includes('#PBS -A eng-prod'));
    assert.ok(s.includes('#PBS -M eng@example.com'));
    assert.ok(s.includes('cd $PBS_O_WORKDIR'));
    assert.ok(s.includes('module load mpt/2.28'));
    assert.ok(s.includes('mpiexec -n 24 omnieng-headless-daemon --mode=pbs_distributed'));
  });

  t('HPC: script generators reject invalid specs with typed error', () => {
    assert.throws(
      () => HpcClusterGateway.generateSlurmScript({ nodes: 0 }),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => HpcClusterGateway.generateSlurmScript({ walltime: '99:99:99' }),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => HpcClusterGateway.generatePbsProScript({ mpiRanksPerNode: -1 }),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => HpcClusterGateway.generateSlurmScript(null),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
  });

  // ------------------------------------------------------ State machine ----
  t('HPC: job state machine transitions QUEUED -> RUNNING -> COMPLETED', () => {
    const gateway = new HpcClusterGateway({ provider: 'test' });
    const job = gateway.submitJob({ scheduler: 'SLURM', jobName: 'mesh' });
    assert.strictEqual(job.status, JOB_STATES.QUEUED);
    assert.strictEqual(job.submissionSpec.scheduler, 'SLURM');

    const running = gateway.markRunning(job.jobId);
    assert.strictEqual(running.status, JOB_STATES.RUNNING);
    assert.strictEqual(running.transitions.length, 2);

    const completed = gateway.markCompleted(job.jobId);
    assert.strictEqual(completed.status, JOB_STATES.COMPLETED);
    assert.ok(completed.completedAt);

    const fetched = gateway.getJob(job.jobId);
    assert.strictEqual(fetched.status, JOB_STATES.COMPLETED);
    assert.strictEqual(gateway.listJobs({ status: 'COMPLETED' }).length, 1);
    assert.strictEqual(gateway.listJobs({ status: 'RUNNING' }).length, 0);
  });

  t('HPC: failJob transitions from QUEUED and RUNNING to FAILED', () => {
    const gateway = new HpcClusterGateway({ provider: 'test' });
    const queued = gateway.submitJob({ scheduler: 'PBS_PRO', jobName: 'a' });
    const failedQueued = gateway.failJob(queued.jobId, new Error('scheduler rejected'));
    assert.strictEqual(failedQueued.status, JOB_STATES.FAILED);
    assert.strictEqual(failedQueued.error.message, 'scheduler rejected');

    const running = gateway.submitJob({ scheduler: 'SLURM', jobName: 'b' });
    gateway.markRunning(running.jobId);
    const failedRunning = gateway.failJob(running.jobId);
    assert.strictEqual(failedRunning.status, JOB_STATES.FAILED);
  });

  t('HPC: illegal transitions are rejected with typed errors', () => {
    const gateway = new HpcClusterGateway({ provider: 'test' });
    const job = gateway.submitJob({ scheduler: 'SLURM', jobName: 'x' });

    assert.throws(
      () => gateway.markCompleted(job.jobId),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT && /Illegal/.test(e.message)
    );
    gateway.markRunning(job.jobId);
    assert.throws(
      () => gateway.markRunning(job.jobId),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    gateway.markCompleted(job.jobId);
    assert.throws(
      () => gateway.markRunning(job.jobId),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => gateway.markCompleted(job.jobId),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => gateway.failJob(job.jobId),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => gateway.markRunning('does-not-exist'),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => gateway.submitJob({ scheduler: 'LSF' }),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    assert.strictEqual(job.status, JOB_STATES.COMPLETED, 'original job must stay in last legal state');
  });

  t('HPC: telemetry derived from state machine + real worker pool', () => {
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    const gateway = new HpcClusterGateway({ provider: 'test', workerPool: pool });
    try {
      const j1 = gateway.submitJob({ scheduler: 'SLURM', jobName: 'a' });
      const j2 = gateway.submitJob({ scheduler: 'PBS_PRO', jobName: 'b' });
      const j3 = gateway.submitJob({ scheduler: 'SLURM', jobName: 'c' });
      gateway.markRunning(j1.jobId);
      gateway.markCompleted(j1.jobId);
      gateway.failJob(j3.jobId);

      const telemetry = gateway.getTelemetry();
      assert.strictEqual(telemetry.jobs.total, 3);
      assert.deepStrictEqual(telemetry.jobs.byState, {
        QUEUED: 1,
        RUNNING: 0,
        COMPLETED: 1,
        FAILED: 1
      });
      assert.ok(telemetry.workerPool && typeof telemetry.workerPool.activeWorkers === 'number');
      assert.strictEqual(telemetry.workerPool.executionMode, 'worker-threads');
      assert.ok(telemetry.schedulersSupported.includes('SLURM'));
      assert.ok(telemetry.schedulersSupported.includes('PBS_PRO'));
      assert.strictEqual(telemetry.gatewayVersion, HpcClusterGateway.VERSION);
      assert.strictEqual(telemetry.provider, 'test');
    } finally {
      pool.terminateAll();
    }
  });

  t('HPC: IPC-compatible surface getClusterStatus/setMembership/submitSimulationJob', () => {
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    const gateway = new HpcClusterGateway({ workerPool: pool });
    try {
      const status = gateway.getClusterStatus();
      assert.strictEqual(status.success, true);
      assert.strictEqual(status.configured, true);
      assert.strictEqual(status.active, true);
      assert.strictEqual(status.status, 'READY');
      assert.ok(status.telemetry.jobs);
      assert.ok(status.telemetry.workerPool);

      const membership = gateway.setMembership(false);
      assert.strictEqual(membership.active, false);
      assert.strictEqual(gateway.getClusterStatus().status, 'OFFLINE');

      const submitted = gateway.submitSimulationJob('CFD_SOLVE', { mesh: 'wing' }, 32);
      assert.strictEqual(submitted.success, true);
      assert.strictEqual(submitted.status, JOB_STATES.QUEUED);
      assert.ok(submitted.jobId);
      assert.strictEqual(submitted.scheduler, 'SLURM');
      assert.ok(submitted.submissionSpec.script.includes('#SBATCH --job-name=CFD_SOLVE'));
      assert.strictEqual(submitted.submissionSpec.totalMpiRanks, 32);

      assert.throws(() => gateway.submitSimulationJob('', {}, 1), OmniError);
      assert.throws(() => gateway.submitSimulationJob('X', {}, 0), OmniError);
      assert.throws(() => gateway.submitSimulationJob('X', null, 2), OmniError);
    } finally {
      pool.terminateAll();
    }
  });

  // ----------------------------------- Unified delegation (legacy facade) ----
  t('HPC: legacy facade Slurm output is content-identical to the unified gateway', () => {
    const spec = {
      jobName: 'fea_run',
      partition: 'gpu_q',
      nodes: 2,
      ntasksPerNode: 8,
      cpusPerTask: 2,
      gpusPerNode: 4,
      memoryPerNode: '256GB',
      walltime: '02:30:00',
      account: 'eng-prod',
      qos: 'high',
      email: 'eng@example.com',
      modules: ['openmpi/4.1.5', 'cuda/12.2'],
      executable: 'omnieng-headless-daemon',
      args: ['--mode=mpi_distributed', '--decomposition=rcb']
    };
    const legacy = LegacyHpcClusterGateway.generateSlurmScript(spec);
    const unified = HpcClusterGateway.generateSlurmScript(spec);
    assert.strictEqual(legacy.script, unified.script);
    assert.strictEqual(legacy.scheduler, unified.scheduler);
    assert.deepStrictEqual(legacy, unified);
    assert.ok(legacy.script.startsWith('#!/bin/bash\n'));
    assert.ok(legacy.script.includes('#SBATCH --job-name=fea_run'));
    assert.ok(legacy.script.includes('#SBATCH --partition=gpu_q'));
    assert.ok(legacy.script.includes('#SBATCH --nodes=2'));
    assert.ok(legacy.script.includes('#SBATCH --ntasks-per-node=8'));
    assert.ok(legacy.script.includes('#SBATCH --gres=gpu:4'));
    assert.ok(legacy.script.includes('#SBATCH --mem=256GB'));
    assert.ok(legacy.script.includes('#SBATCH --time=02:30:00'));
    assert.ok(legacy.script.includes('#SBATCH --account=eng-prod'));
    assert.ok(
      legacy.script.includes('srun --mpi=pmix_v3 -n 16 omnieng-headless-daemon --mode=mpi_distributed --decomposition=rcb')
    );
  });

  t('HPC: legacy facade PBS output is content-identical to the unified gateway', () => {
    const spec = {
      jobName: 'cfd_sweep',
      queue: 'workq',
      nodes: 3,
      mpiRanksPerNode: 8,
      cpusPerRank: 4,
      walltime: '08:00:00',
      memoryPerNode: '512GB',
      account: 'eng-prod',
      email: 'eng@example.com',
      modules: ['mpt/2.28', 'intel-oneapi-mkl/2023.2.0'],
      executable: 'omnieng-headless-daemon',
      args: ['--mode=pbs_distributed']
    };
    const legacy = LegacyHpcClusterGateway.generatePbsScript(spec);
    const unified = HpcClusterGateway.generatePbsProScript(spec);
    assert.strictEqual(legacy.script, unified.script);
    assert.strictEqual(legacy.scheduler, 'PBS_PRO');
    assert.deepStrictEqual(legacy, unified);
    assert.ok(legacy.script.startsWith('#!/bin/bash\n'));
    assert.ok(legacy.script.includes('#PBS -N cfd_sweep'));
    assert.ok(legacy.script.includes('#PBS -q workq'));
    assert.ok(legacy.script.includes('#PBS -l select=3:ncpus=32:mpiprocs=8:ompthreads=4'));
    assert.ok(legacy.script.includes('#PBS -l walltime=08:00:00'));
    assert.ok(legacy.script.includes('#PBS -l mem=512GB'));
    assert.ok(legacy.script.includes('#PBS -A eng-prod'));
    assert.ok(legacy.script.includes('module load mpt/2.28'));
    assert.ok(legacy.script.includes('mpiexec -n 24 omnieng-headless-daemon --mode=pbs_distributed'));
  });

  t('HPC: legacy facade maps solverExecutable to the unified executable field', () => {
    const legacy = LegacyHpcClusterGateway.generateSlurmScript({
      jobName: 'legacy_run',
      nodes: 2,
      ntasksPerNode: 4,
      solverExecutable: 'omnieng-cfd-mpi'
    });
    assert.ok(legacy.script.includes('srun --mpi=pmix_v3 -n 8 omnieng-cfd-mpi'));
    const unified = HpcClusterGateway.generateSlurmScript({
      jobName: 'legacy_run',
      nodes: 2,
      ntasksPerNode: 4,
      executable: 'omnieng-cfd-mpi'
    });
    assert.strictEqual(legacy.script, unified.script);
  });

  t('HPC: legacy facade state machine behaves identically to the unified gateway', () => {
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    const gateway = new LegacyHpcClusterGateway({ provider: 'legacy-test', workerPool: pool });
    try {
      const job = gateway.submitJob({ scheduler: 'SLURM', jobName: 'mesh' });
      assert.strictEqual(job.status, JOB_STATES.QUEUED);
      assert.ok(job.submissionSpec.script.includes('#SBATCH --job-name=mesh'));

      const running = gateway.markRunning(job.jobId);
      assert.strictEqual(running.status, JOB_STATES.RUNNING);
      assert.strictEqual(running.transitions.length, 2);

      const completed = gateway.markCompleted(job.jobId);
      assert.strictEqual(completed.status, JOB_STATES.COMPLETED);
      assert.ok(completed.completedAt);

      const fetched = gateway.getJob(job.jobId);
      assert.strictEqual(fetched.status, JOB_STATES.COMPLETED);
      assert.strictEqual(gateway.listJobs({ status: 'COMPLETED' }).length, 1);

      const telemetry = gateway.getTelemetry();
      assert.deepStrictEqual(telemetry.jobs.byState, {
        QUEUED: 0,
        RUNNING: 0,
        COMPLETED: 1,
        FAILED: 0
      });
      assert.strictEqual(telemetry.gatewayVersion, HpcClusterGateway.VERSION);
      assert.strictEqual(telemetry.provider, 'legacy-test');

      const status = gateway.getClusterStatus();
      assert.strictEqual(status.success, true);
      assert.strictEqual(status.status, 'READY');
      assert.strictEqual(status.telemetry.gatewayVersion, HpcClusterGateway.VERSION);

      const membership = gateway.setMembership(false);
      assert.strictEqual(membership.active, false);
      assert.strictEqual(gateway.getClusterStatus().status, 'OFFLINE');

      const submitted = gateway.submitSimulationJob('CFD_SOLVE', { mesh: 'wing' }, 32);
      assert.strictEqual(submitted.success, true);
      assert.strictEqual(submitted.status, JOB_STATES.QUEUED);
      assert.ok(submitted.jobId);
      assert.strictEqual(submitted.scheduler, 'SLURM');
      assert.ok(submitted.submissionSpec.script.includes('#SBATCH --job-name=CFD_SOLVE'));
      assert.strictEqual(submitted.submissionSpec.totalMpiRanks, 32);
    } finally {
      pool.terminateAll();
    }
  });

  t('HPC: legacy facade rejects illegal transitions and invalid specs with unified typed errors', () => {
    const gateway = new LegacyHpcClusterGateway({ provider: 'legacy-test' });
    const job = gateway.submitJob({ scheduler: 'SLURM', jobName: 'x' });
    assert.throws(
      () => gateway.markCompleted(job.jobId),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT && /Illegal/.test(e.message)
    );
    gateway.markRunning(job.jobId);
    gateway.markCompleted(job.jobId);
    assert.throws(
      () => gateway.markRunning(job.jobId),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => gateway.markRunning('does-not-exist'),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => gateway.submitJob({ scheduler: 'LSF' }),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => LegacyHpcClusterGateway.generateSlurmScript({ nodes: 0 }),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => LegacyHpcClusterGateway.generateSlurmScript(null),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => LegacyHpcClusterGateway.generatePbsScript({ mpiRanksPerNode: -1 }),
      (e) => e instanceof OmniError && e.code === OmniErrorCode.INVALID_INPUT
    );
  });

  t('HPC: legacy facade RCB and out-of-core helpers delegate to the unified gateway', () => {
    const points = [];
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        for (let z = 0; z < 4; z++) {
          points.push({ x, y, z });
        }
      }
    }
    assert.strictEqual(LegacyHpcClusterGateway.VERSION, HpcClusterGateway.VERSION);
    const legacyDecomp = LegacyHpcClusterGateway.partitionRcb(points, 4);
    const unifiedDecomp = HpcClusterGateway.partitionRcb(points, 4);
    assert.deepStrictEqual(legacyDecomp, unifiedDecomp);
    assert.strictEqual(legacyDecomp.status, 'PARTITIONED');
    assert.strictEqual(legacyDecomp.numPartitions, 4);
    assert.strictEqual(legacyDecomp.totalNodes, points.length);
    assert.strictEqual(legacyDecomp.isBalanced, true);

    const assumptions = { matrixNonzerosPerDof: 180, factorEntriesPerDof: 450 };
    const legacyPlan = LegacyHpcClusterGateway.planOutOfCoreFrontal(5000000, 16 * 1024 * 1024 * 1024, assumptions);
    const unifiedPlan = HpcClusterGateway.planOutOfCoreFrontal(5000000, 16 * 1024 * 1024 * 1024, assumptions);
    assert.deepStrictEqual(legacyPlan, unifiedPlan);
    assert.strictEqual(legacyPlan.status, 'ESTIMATE_ONLY');
    assert.strictEqual(legacyPlan.solvePerformed, false);
    assert.strictEqual(legacyPlan.estimatedOutOfCore, true);
    assert.strictEqual(legacyPlan.isOutOfCore, null);
    assert.ok(legacyPlan.totalChunks > 1);
  });

  // ------------------------------------------------------------ summary ----
  console.log('================================================================');
  console.log('  STORAGE (.omni v3 WAL) + HPC INDUSTRIAL TEST SUITE');
  console.log('================================================================');
  for (const line of results) console.log(line);
  console.log('================================================================');
  console.log(`  RESULT: ${passed}/${total} passed, ${failed} failed`);
  console.log('================================================================');
  return { total, passed, failed };
}

if (require.main === module) {
  const outcome = runStorageHpcIndustrialTests();
  process.exitCode = outcome.failed > 0 ? 1 : 0;
}

module.exports = { runStorageHpcIndustrialTests };
