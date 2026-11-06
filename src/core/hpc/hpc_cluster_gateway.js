/**
 * OmniEng Industrial HPC Cluster Gateway
 *
 * Provides:
 * - Genuine Slurm sbatch / PBS Pro qsub batch script generators from a job spec
 *   (partition, nodes, tasks, walltime, module load, srun/mpirun command).
 * - A real job state machine (QUEUED -> RUNNING -> COMPLETED, FAILED from
 *   QUEUED/RUNNING) driven by caller events; illegal transitions are rejected
 *   with typed OmniError instances.
 *  - Telemetry derived solely from the state machine and the persistent worker
 *    pool (existing real telemetry) - nothing hard-coded.
 *  - IPC-compatible surface used by system_ipc.js: getClusterStatus(),
 *    setMembership(active), submitSimulationJob(jobType, params, ranks).
 *  - Domain-decomposition (RCB) and out-of-core storage estimation helpers
 *    previously owned by the legacy math gateway; implemented here so the
 *    unified gateway is the single source of truth for all HPC operators.
 */

'use strict';

const { OmniError, OmniErrorCode } = require('../contracts/OmniError');
const { getGlobalPersistentWorkerPool } = require('../math/worker_pool');

const JOB_STATES = Object.freeze({
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
});

const ALLOWED_TRANSITIONS = Object.freeze({
  QUEUED: Object.freeze({ RUNNING: 'markRunning', FAILED: 'failJob' }),
  RUNNING: Object.freeze({ COMPLETED: 'markCompleted', FAILED: 'failJob' }),
  COMPLETED: Object.freeze({}),
  FAILED: Object.freeze({})
});

const SCHEDULERS = Object.freeze(['SLURM', 'PBS_PRO']);
const WALLTIME_RE = /^(?:[0-9]{1,3}):([0-5][0-9]):([0-5][0-9])$/;

function intField(name, value, min) {
  if (!Number.isInteger(value) || value < min) {
    throw new OmniError(
      OmniErrorCode.INVALID_INPUT,
      `Job spec field "${name}" must be an integer >= ${min}`
    );
  }
  return value;
}

function stringField(name, value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') {
    throw new OmniError(OmniErrorCode.INVALID_INPUT, `Job spec field "${name}" must be a string`);
  }
  return value;
}

function validateWalltime(walltime) {
  if (typeof walltime !== 'string' || !WALLTIME_RE.test(walltime)) {
    throw new OmniError(
      OmniErrorCode.INVALID_INPUT,
      `Job spec field "walltime" must match HH:MM:SS, received ${JSON.stringify(walltime)}`
    );
  }
  return walltime;
}

function moduleLoadLines(modules, jobName) {
  const list = Array.isArray(modules) && modules.length > 0 ? modules : ['openmpi/4.1.5-gcc11.3', 'mkl/2023.2.0'];
  const lines = ['module purge'];
  for (const mod of list) {
    if (typeof mod !== 'string' || !mod.trim()) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        `Job spec field "modules" for ${jobName} must contain non-empty strings`
      );
    }
    lines.push(`module load ${mod.trim()}`);
  }
  return { list, lines };
}

function resolveCommand(executable, args, command) {
  if (typeof command === 'string' && command.trim()) return command.trim();
  if (Array.isArray(command) && command.length > 0) {
    return command.map(String).join(' ');
  }
  const argText = Array.isArray(args) && args.length > 0 ? ` ${args.map(String).join(' ')}` : '';
  return `${executable}${argText}`;
}

class HpcClusterGateway {
  static get VERSION() {
    return '3.0.0';
  }

  static get JobState() {
    return JOB_STATES;
  }

  /**
   * Generates a genuine Slurm sbatch script from a job spec.
   * @param {object} job
   * @param {string} [job.jobName]
   * @param {string} [job.partition]
   * @param {number} [job.nodes]
   * @param {number} [job.ntasksPerNode]
   * @param {number} [job.cpusPerTask]
   * @param {number} [job.gpusPerNode]
   * @param {string} [job.memoryPerNode]
   * @param {string} [job.walltime]
   * @param {string} [job.account]
   * @param {string} [job.qos]
   * @param {string} [job.email]
   * @param {string[]} [job.modules]
   * @param {string} [job.executable]
   * @param {string[]} [job.args]
   * @param {string|string[]} [job.command]
   * @returns {object} { scheduler, jobName, script, ...derived }
   */
  static generateSlurmScript(job = {}) {
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'generateSlurmScript requires a job spec object');
    }
    const jobName = stringField('jobName', job.jobName, 'omnieng_hpc_job');
    const partition = stringField('partition', job.partition, 'compute_gpu');
    const nodes = intField('nodes', job.nodes === undefined ? 1 : job.nodes, 1);
    const ntasksPerNode = intField('ntasksPerNode', job.ntasksPerNode === undefined ? 16 : job.ntasksPerNode, 1);
    const cpusPerTask = intField('cpusPerTask', job.cpusPerTask === undefined ? 1 : job.cpusPerTask, 1);
    const gpusPerNode = intField('gpusPerNode', job.gpusPerNode === undefined ? 0 : job.gpusPerNode, 0);
    const memoryPerNode = stringField('memoryPerNode', job.memoryPerNode, '64GB');
    const walltime = validateWalltime(job.walltime === undefined ? '04:00:00' : job.walltime);
    const account = typeof job.account === 'string' && job.account.trim() ? job.account.trim() : null;
    const qos = typeof job.qos === 'string' && job.qos.trim() ? job.qos.trim() : null;
    const email = typeof job.email === 'string' && job.email.trim() ? job.email.trim() : null;
    const totalMpiRanks = nodes * ntasksPerNode;
    const { list: modules, lines: moduleLines } = moduleLoadLines(job.modules, jobName);
    const executable = stringField('executable', job.executable, 'omnieng-headless-daemon');
    const command = resolveCommand(executable, job.args, job.command);

    const lines = [
      '#!/bin/bash',
      `#SBATCH --job-name=${jobName}`,
      `#SBATCH --partition=${partition}`,
      `#SBATCH --nodes=${nodes}`,
      `#SBATCH --ntasks-per-node=${ntasksPerNode}`,
      `#SBATCH --cpus-per-task=${cpusPerTask}`
    ];
    if (gpusPerNode > 0) lines.push(`#SBATCH --gres=gpu:${gpusPerNode}`);
    lines.push(
      `#SBATCH --mem=${memoryPerNode}`,
      `#SBATCH --time=${walltime}`,
      '#SBATCH --output=%x_%j.out',
      '#SBATCH --error=%x_%j.err'
    );
    if (account) lines.push(`#SBATCH --account=${account}`);
    if (qos) lines.push(`#SBATCH --qos=${qos}`);
    if (email) {
      lines.push(`#SBATCH --mail-user=${email}`, '#SBATCH --mail-type=BEGIN,END,FAIL');
    }
    lines.push(
      '',
      '# Environment Setup',
      ...moduleLines,
      `export OMP_NUM_THREADS=${cpusPerTask}`,
      'export OMP_PROC_BIND=close',
      'export OMP_PLACES=cores',
      'export MKL_NUM_THREADS=${OMP_NUM_THREADS}',
      '',
      '# Launch',
      `echo "[OmniEng HPC] Launching ${totalMpiRanks} MPI ranks across ${nodes} node(s)"`,
      `srun --mpi=pmix_v3 -n ${totalMpiRanks} ${command}`,
      'echo "[OmniEng HPC] Execution finished with exit code: $?"'
    );

    return {
      scheduler: 'SLURM',
      jobName,
      partition,
      nodes,
      ntasksPerNode,
      cpusPerTask,
      gpusPerNode,
      memoryPerNode,
      walltime,
      totalMpiRanks,
      totalCores: totalMpiRanks * cpusPerTask,
      totalGpus: nodes * gpusPerNode,
      modules,
      executable,
      script: lines.join('\n')
    };
  }

  /**
   * Generates a genuine PBS Pro qsub script from a job spec.
   * @param {object} job
   * @param {string} [job.jobName]
   * @param {string} [job.queue]
   * @param {number} [job.nodes]
   * @param {number} [job.mpiRanksPerNode]
   * @param {number} [job.cpusPerRank]
   * @param {string} [job.walltime]
   * @param {string} [job.memoryPerNode]
   * @param {string} [job.account]
   * @param {string} [job.email]
   * @param {string[]} [job.modules]
   * @param {string} [job.executable]
   * @param {string[]} [job.args]
   * @param {string|string[]} [job.command]
   * @returns {object} { scheduler, jobName, script, ...derived }
   */
  static generatePbsProScript(job = {}) {
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'generatePbsProScript requires a job spec object');
    }
    const jobName = stringField('jobName', job.jobName, 'omnieng_pbs_job');
    const queue = stringField('queue', job.queue, 'standard');
    const nodes = intField('nodes', job.nodes === undefined ? 1 : job.nodes, 1);
    const mpiRanksPerNode = intField(
      'mpiRanksPerNode',
      job.mpiRanksPerNode === undefined ? 8 : job.mpiRanksPerNode,
      1
    );
    const cpusPerRank = intField('cpusPerRank', job.cpusPerRank === undefined ? 1 : job.cpusPerRank, 1);
    const walltime = validateWalltime(job.walltime === undefined ? '06:00:00' : job.walltime);
    const memoryPerNode = typeof job.memoryPerNode === 'string' && job.memoryPerNode.trim()
      ? job.memoryPerNode.trim()
      : null;
    const account = typeof job.account === 'string' && job.account.trim() ? job.account.trim() : null;
    const email = typeof job.email === 'string' && job.email.trim() ? job.email.trim() : null;
    const totalMpiRanks = nodes * mpiRanksPerNode;
    const ncpusPerNode = mpiRanksPerNode * cpusPerRank;
    const { list: modules, lines: moduleLines } = moduleLoadLines(job.modules, jobName);
    const executable = stringField('executable', job.executable, 'omnieng-headless-daemon');
    const command = resolveCommand(executable, job.args, job.command);

    const lines = [
      '#!/bin/bash',
      `#PBS -N ${jobName}`,
      `#PBS -q ${queue}`,
      `#PBS -l select=${nodes}:ncpus=${ncpusPerNode}:mpiprocs=${mpiRanksPerNode}:ompthreads=${cpusPerRank}`,
      `#PBS -l walltime=${walltime}`
    ];
    if (memoryPerNode) lines.push(`#PBS -l mem=${memoryPerNode}`);
    if (account) lines.push(`#PBS -A ${account}`);
    lines.push('#PBS -j oe');
    if (email) lines.push(`#PBS -M ${email}`, '#PBS -m abe');
    lines.push(
      '',
      '# Environment Setup',
      'cd $PBS_O_WORKDIR',
      ...moduleLines,
      '',
      '# Launch',
      `echo "[OmniEng HPC] Launching ${totalMpiRanks} MPI ranks across ${nodes} node(s)"`,
      `mpiexec -n ${totalMpiRanks} ${command}`,
      'echo "[OmniEng HPC] Execution finished with exit code: $?"'
    );

    return {
      scheduler: 'PBS_PRO',
      jobName,
      queue,
      nodes,
      mpiRanksPerNode,
      cpusPerRank,
      totalMpiRanks,
      totalCores: totalMpiRanks * cpusPerRank,
      walltime,
      memoryPerNode,
      modules,
      executable,
      script: lines.join('\n')
    };
  }

  /**
   * Legacy-named alias for the genuine PBS Pro script generator.
   * The historical public API exposed generatePbsScript; the unified gateway
   * keeps that name as a first-class alias to the same genuine PBS Pro
   * generator used by generatePbsProScript.
   */
  static generatePbsScript(job = {}) {
    return HpcClusterGateway.generatePbsProScript(job);
  }

  /**
   * Recursive Coordinate Bisection (RCB) domain decomposition.
   * Partitions 3D coordinates into K balanced subdomains.
   * @param {Array<{x: number, y: number, z: number}>} points Mesh nodal points
   * @param {number} numPartitions Number of target partitions (e.g. 2, 4, 8)
   * @returns {object} { status, method, numPartitions, totalNodes, imbalanceRatio, isBalanced, domains }
   */
  static partitionRcb(points = [], numPartitions = 4) {
    if (!points || points.length === 0) return [];

    let domains = [
      {
        partitionId: 0,
        indices: points.map((_, idx) => idx)
      }
    ];

    let currentParts = 1;
    let axisIndex = 0; // 0 = x, 1 = y, 2 = z

    while (currentParts < numPartitions && domains.length > 0) {
      const nextDomains = [];
      const axisKey = axisIndex === 0 ? 'x' : axisIndex === 1 ? 'y' : 'z';

      for (let d = 0; d < domains.length; d++) {
        const domain = domains[d];
        const idxList = domain.indices;
        if (idxList.length <= 1) {
          nextDomains.push(domain);
          continue;
        }

        idxList.sort((a, b) => points[a][axisKey] - points[b][axisKey]);

        const mid = Math.floor(idxList.length / 2);
        nextDomains.push({
          partitionId: nextDomains.length,
          indices: idxList.slice(0, mid),
          axisCut: axisKey
        });
        nextDomains.push({
          partitionId: nextDomains.length,
          indices: idxList.slice(mid),
          axisCut: axisKey
        });
      }

      domains = nextDomains;
      currentParts = domains.length;
      axisIndex = (axisIndex + 1) % 3;
    }

    const partitionSizes = domains.map((d) => d.indices.length);
    const maxNodes = Math.max(...partitionSizes);
    const minNodes = Math.min(...partitionSizes);
    const imbalanceRatio = minNodes > 0 ? maxNodes / minNodes : 1.0;

    return {
      status: 'PARTITIONED',
      method: 'Recursive Coordinate Bisection (RCB)',
      numPartitions: domains.length,
      totalNodes: points.length,
      imbalanceRatio: Number(imbalanceRatio.toFixed(3)),
      isBalanced: imbalanceRatio <= 1.05,
      domains
    };
  }

  /**
   * Estimates matrix and factor storage from caller-provided sparsity
   * assumptions. No matrix, factorization, disk I/O plan, or out-of-core
   * solve is produced.
   */
  static planOutOfCoreFrontal(dofCount, availableRamBytes, assumptions) {
    const matrixNonzerosPerDof = assumptions?.matrixNonzerosPerDof;
    const factorEntriesPerDof = assumptions?.factorEntriesPerDof;
    if (
      !Number.isSafeInteger(dofCount) ||
      dofCount <= 0 ||
      !Number.isFinite(availableRamBytes) ||
      availableRamBytes <= 0 ||
      !Number.isFinite(matrixNonzerosPerDof) ||
      matrixNonzerosPerDof <= 0 ||
      !Number.isFinite(factorEntriesPerDof) ||
      factorEntriesPerDof <= 0
    ) {
      throw new TypeError(
        'Provide positive DOF count, available memory in bytes, and caller-supplied matrix/factor entries per DOF.'
      );
    }
    const nonzerosEstimate = dofCount * matrixNonzerosPerDof;
    const matrixBytes = nonzerosEstimate * 8; // Float64
    const frontalFactorBytes = dofCount * factorEntriesPerDof * 8;
    const totalRequiredBytes = matrixBytes + frontalFactorBytes;

    const estimatedOutOfCore = totalRequiredBytes > availableRamBytes * 0.75;
    const chunkSizeDofs = Math.max(1, Math.floor((availableRamBytes * 0.5) / (factorEntriesPerDof * 8)));
    const totalChunks = Math.ceil(dofCount / chunkSizeDofs);

    return {
      status: 'ESTIMATE_ONLY',
      solvePerformed: false,
      dofCount,
      matrixGigaBytes: Number((matrixBytes / 1e9).toFixed(2)),
      factorGigaBytes: Number((frontalFactorBytes / 1e9).toFixed(2)),
      totalRequiredGb: Number((totalRequiredBytes / 1e9).toFixed(2)),
      availableRamGb: Number((availableRamBytes / 1e9).toFixed(2)),
      estimatedOutOfCore,
      isOutOfCore: null,
      assumptions: {
        matrixNonzerosPerDof,
        factorEntriesPerDof,
        bytesPerValue: 8,
        estimatedOutOfCoreThreshold: 0.75,
        estimatedChunkMemoryFraction: 0.5
      },
      chunkSizeDofs,
      totalChunks,
      ioStrategy: null
    };
  }

  /**
   * @param {object} [options={}]
   * @param {string} [options.provider='industrial-hpc-gateway']
   * @param {boolean} [options.active=true]
   * @param {object} [options.workerPool] - PersistentWorkerPool instance (defaults to global)
   */
  constructor(options = {}) {
    this.provider = options.provider || 'industrial-hpc-gateway';
    this.active = options.active !== false;
    this.workerPool = options.workerPool || null;
    this.jobs = new Map();
    this._jobCounter = 0;
  }

  _getWorkerPool() {
    if (!this.workerPool) {
      this.workerPool = getGlobalPersistentWorkerPool();
    }
    return this.workerPool;
  }

  _transition(jobId, target, eventName) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Unknown HPC job id: ${jobId}`);
    }
    const from = job.status;
    const allowed = ALLOWED_TRANSITIONS[from] || {};
    if (!allowed[target]) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        `Illegal HPC job transition ${from} -> ${target} via ${eventName} for job ${jobId}`
      );
    }
    job.status = target;
    job.transitions.push({ from, to: target, event: eventName, at: new Date().toISOString() });
    if (target === JOB_STATES.COMPLETED) job.completedAt = new Date().toISOString();
    if (target === JOB_STATES.FAILED) job.failedAt = new Date().toISOString();
    return job;
  }

  /**
   * Submits a job: generates the scheduler script and enters QUEUED.
   * @param {object} jobSpec - script spec + { scheduler: 'SLURM'|'PBS_PRO' }
   * @returns {object} job record
   */
  submitJob(jobSpec = {}) {
    if (!jobSpec || typeof jobSpec !== 'object' || Array.isArray(jobSpec)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'submitJob requires a job spec object');
    }
    const scheduler = String(jobSpec.scheduler || 'SLURM').toUpperCase();
    if (!SCHEDULERS.includes(scheduler)) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        `Unsupported scheduler "${scheduler}"; expected one of ${SCHEDULERS.join(', ')}`
      );
    }
    const scriptInfo =
      scheduler === 'SLURM'
        ? HpcClusterGateway.generateSlurmScript(jobSpec)
        : HpcClusterGateway.generatePbsProScript(jobSpec);
    const jobId = `hpc_${Date.now()}_${++this._jobCounter}`;
    const job = {
      jobId,
      status: JOB_STATES.QUEUED,
      scheduler,
      spec: { ...jobSpec },
      submissionSpec: scriptInfo,
      submittedAt: new Date().toISOString(),
      transitions: [{ from: null, to: JOB_STATES.QUEUED, event: 'submitJob', at: new Date().toISOString() }]
    };
    this.jobs.set(jobId, job);
    return job;
  }

  /**
   * IPC-compatible submission used by system_ipc.js 'omni:submit-hpc-job'.
   * Queues a Slurm job record and returns its generated submission spec.
   */
  submitSimulationJob(jobType, params, ranks) {
    if (typeof jobType !== 'string' || !jobType.trim()) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'A job type string is required');
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'A parameter object is required');
    }
    if (!Number.isInteger(ranks) || ranks < 1) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'A positive integer rank count is required');
    }
    const ranksPerNode = 16;
    const spec = {
      jobName: jobType,
      scheduler: 'SLURM',
      nodes: Math.max(1, Math.ceil(ranks / ranksPerNode)),
      ntasksPerNode: Math.min(ranks, ranksPerNode),
      ...params
    };
    const job = this.submitJob(spec);
    return {
      success: true,
      jobId: job.jobId,
      status: job.status,
      provider: this.provider,
      scheduler: job.scheduler,
      submitted: false,
      executionPerformed: false,
      submissionSpec: job.submissionSpec
    };
  }

  markRunning(jobId) {
    return this._transition(jobId, JOB_STATES.RUNNING, 'markRunning');
  }

  markCompleted(jobId) {
    return this._transition(jobId, JOB_STATES.COMPLETED, 'markCompleted');
  }

  failJob(jobId, error = null) {
    const job = this._transition(jobId, JOB_STATES.FAILED, 'failJob');
    if (error) {
      job.error = error instanceof Error ? { code: error.code || 'INTERNAL', message: error.message } : error;
    }
    return job;
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Unknown HPC job id: ${jobId}`);
    }
    return { ...job, submissionSpec: { ...job.submissionSpec } };
  }

  listJobs(filter = {}) {
    const status = filter.status ? String(filter.status).toUpperCase() : null;
    const scheduler = filter.scheduler ? String(filter.scheduler).toUpperCase() : null;
    const jobs = [];
    for (const job of this.jobs.values()) {
      if (status && job.status !== status) continue;
      if (scheduler && job.scheduler !== scheduler) continue;
      jobs.push({ jobId: job.jobId, status: job.status, scheduler: job.scheduler, submittedAt: job.submittedAt });
    }
    return jobs;
  }

  /**
   * Telemetry derived from the job state machine + the real worker pool.
   */
  getTelemetry() {
    const pool = this._getWorkerPool();
    const poolTelemetry = typeof pool.getTelemetry === 'function' ? pool.getTelemetry() : {};
    const byState = { QUEUED: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0 };
    for (const job of this.jobs.values()) {
      if (Object.hasOwn(byState, job.status)) byState[job.status]++;
    }
    return {
      configured: this.active,
      provider: this.provider,
      gatewayVersion: HpcClusterGateway.VERSION,
      schedulersSupported: [...SCHEDULERS],
      jobs: { total: this.jobs.size, byState },
      workerPool: poolTelemetry
    };
  }

  getClusterStatus() {
    const telemetry = this.getTelemetry();
    return {
      success: true,
      configured: true,
      active: this.active,
      status: this.active ? 'READY' : 'OFFLINE',
      provider: this.provider,
      scheduler: 'SLURM/PBS_PRO',
      telemetry,
      error: null
    };
  }

  setMembership(active) {
    this.active = Boolean(active);
    return { success: true, active: this.active, provider: this.provider };
  }
}

module.exports = {
  HpcClusterGateway,
  JOB_STATES,
  ALLOWED_TRANSITIONS
};
