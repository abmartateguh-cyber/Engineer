'use strict';

const crypto = require('crypto');
const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { Quantity } = require('../contracts/Quantity');
const { ValidationRecord, ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { HpcClusterGateway } = require('./hpc_cluster_gateway');
const { LocalCluster } = require('./local_scheduler');
const { getGlobalPersistentWorkerPool } = require('../math/worker_pool');

const MAX_PARTITION_POINTS = 100000;
const MAX_PARTITIONS = 64;
const MAX_LOCAL_TASK_PAYLOAD_BYTES = 16 * 1024 * 1024;
const MIN_JOB_TIMEOUT_MS = 100;
const MAX_JOB_TIMEOUT_MS = 3600000;
const MAX_PLAN_DOF_COUNT = 1e9;
const MAX_ASSUMPTION_RATIO = 1e12;
const ALLOWED_LOCAL_TASK_TYPES = new Set(['poisson_sparse_cholesky', 'spin_wait']);

let sharedHpcGateway = null;
function getSharedHpcGateway() {
  if (!sharedHpcGateway) sharedHpcGateway = new HpcClusterGateway();
  return sharedHpcGateway;
}

let sharedLocalCluster = null;
function getSharedLocalCluster() {
  if (!sharedLocalCluster) sharedLocalCluster = new LocalCluster({ maxWorkers: 4 });
  return sharedLocalCluster;
}

/**
 * Experimental adapter for scheduler script templates, local worker tasks, and in-memory decomposition helpers.
 */
class HPCEngineAdapter extends EngineAdapter {
  constructor() {
    super('hpc', 'hpc-cluster-gateway-adapter', '2.0.0');
  }

  describeCapabilities() {
    return {
      domain: 'hpc',
      name: this.name,
      version: this.version,
      gatewayVersion: HpcClusterGateway.VERSION,
      supportedOperations: [
        'generate_slurm_script',
        'generate_pbs_script',
        'partition_rcb',
        'plan_out_of_core',
        'execute_local_parallel',
        'hpc:local-dispatch',
        'get_cluster_telemetry'
      ],
      maturity: ValidationMaturity.EXPERIMENTAL,
      native: false
    };
  }

  async validate(jobRequest) {
    await super.validate(jobRequest);
    const params = jobRequest.parameters;
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'HPC operations require an explicit parameter object');
    }

    switch (jobRequest.operation) {
      case 'partition_rcb': {
        if (!Array.isArray(params.points) || params.points.length === 0) {
          throw new OmniError(OmniErrorCode.INVALID_INPUT, 'partition_rcb requires a non-empty points array');
        }
        if (params.points.length > MAX_PARTITION_POINTS) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            `partition_rcb is limited to ${MAX_PARTITION_POINTS} points`
          );
        }
        for (let i = 0; i < params.points.length; i++) {
          const p = params.points[i];
          if (!p || typeof p !== 'object' || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              `partition_rcb points[${i}] must be an object with finite x, y, z coordinates`
            );
          }
        }
        if (
          params.numPartitions !== undefined &&
          (!Number.isInteger(params.numPartitions) || params.numPartitions < 1 || params.numPartitions > MAX_PARTITIONS)
        ) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            `partition_rcb numPartitions must be an integer from 1 through ${MAX_PARTITIONS}`
          );
        }
        break;
      }
      case 'plan_out_of_core':
        if (
          !Number.isSafeInteger(params.dofCount) ||
          params.dofCount <= 0 ||
          params.dofCount > MAX_PLAN_DOF_COUNT ||
          !Number.isFinite(params.availableRamBytes) ||
          params.availableRamBytes <= 0 ||
          !Number.isFinite(params.assumptions?.matrixNonzerosPerDof) ||
          params.assumptions.matrixNonzerosPerDof <= 0 ||
          params.assumptions.matrixNonzerosPerDof > MAX_ASSUMPTION_RATIO ||
          !Number.isFinite(params.assumptions?.factorEntriesPerDof) ||
          params.assumptions.factorEntriesPerDof <= 0 ||
          params.assumptions.factorEntriesPerDof > MAX_ASSUMPTION_RATIO
        ) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'plan_out_of_core requires DOF count, available memory, and caller-supplied matrix/factor entries per DOF within supported bounds'
          );
        }
        break;
      case 'execute_local_parallel': {
        if (typeof params.taskType !== 'string' || !params.taskType.trim() || params.taskType.length > 128) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'execute_local_parallel requires a taskType string of at most 128 characters'
          );
        }
        if (!params.payload || typeof params.payload !== 'object' || Array.isArray(params.payload)) {
          throw new OmniError(OmniErrorCode.INVALID_INPUT, 'execute_local_parallel requires a payload object');
        }
        try {
          const serializedLength = Buffer.byteLength(JSON.stringify(params.payload), 'utf8');
          if (serializedLength > MAX_LOCAL_TASK_PAYLOAD_BYTES) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              `task payload exceeds the ${MAX_LOCAL_TASK_PAYLOAD_BYTES}-byte limit`
            );
          }
        } catch (err) {
          if (err instanceof OmniError) throw err;
          throw new OmniError(OmniErrorCode.INVALID_INPUT, `Task payload must be JSON-serializable: ${err.message}`);
        }
        if (params.timeoutMs !== undefined) {
          if (
            !Number.isFinite(params.timeoutMs) ||
            params.timeoutMs < MIN_JOB_TIMEOUT_MS ||
            params.timeoutMs > MAX_JOB_TIMEOUT_MS
          ) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              `timeoutMs must be a finite number from ${MIN_JOB_TIMEOUT_MS} through ${MAX_JOB_TIMEOUT_MS}`
            );
          }
        }
        if (params.priority !== undefined && !['HIGH', 'NORMAL', 'BATCH', 'BACKGROUND'].includes(params.priority)) {
          throw new OmniError(OmniErrorCode.INVALID_INPUT, 'priority must be one of HIGH, NORMAL, BATCH, BACKGROUND');
        }
        break;
      }
      case 'hpc:local-dispatch': {
        const descriptor = params.descriptor;
        if (
          !descriptor ||
          typeof descriptor !== 'object' ||
          Array.isArray(descriptor) ||
          typeof descriptor.taskType !== 'string' ||
          !descriptor.taskType.trim() ||
          descriptor.taskType.length > 128
        ) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'hpc:local-dispatch requires a descriptor object with a taskType string'
          );
        }
        if (!ALLOWED_LOCAL_TASK_TYPES.has(descriptor.taskType)) {
          throw new OmniError(
            OmniErrorCode.UNSUPPORTED,
            `hpc:local-dispatch taskType "${descriptor.taskType}" is not supported by the local worker`
          );
        }
        try {
          const serializedLength = Buffer.byteLength(JSON.stringify(descriptor), 'utf8');
          if (serializedLength > MAX_LOCAL_TASK_PAYLOAD_BYTES) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              `local task descriptor exceeds the ${MAX_LOCAL_TASK_PAYLOAD_BYTES}-byte payload limit`
            );
          }
        } catch (err) {
          if (err instanceof OmniError) throw err;
          throw new OmniError(OmniErrorCode.INVALID_INPUT, `Task descriptor must be JSON-serializable: ${err.message}`);
        }
        if (params.timeoutMs !== undefined) {
          if (
            !Number.isFinite(params.timeoutMs) ||
            params.timeoutMs < MIN_JOB_TIMEOUT_MS ||
            params.timeoutMs > MAX_JOB_TIMEOUT_MS
          ) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              `timeoutMs must be a finite number from ${MIN_JOB_TIMEOUT_MS} through ${MAX_JOB_TIMEOUT_MS}`
            );
          }
        }
        break;
      }
      default:
        break;
    }
    return true;
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(
      new JobEvent({ jobId, type: JobEventType.STARTED, message: `Starting HPC operation "${jobRequest.operation}"` })
    );

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      const params = jobRequest.parameters || {};

      switch (jobRequest.operation) {
        case 'generate_slurm_script': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: 'Generating parameterized Slurm sbatch script'
            })
          );
          outputData = HpcClusterGateway.generateSlurmScript(params);
          outputData.status = 'SCRIPT_TEMPLATE_ONLY';
          outputData.submitted = false;
          outputData.executionPerformed = false;
          outputData.scheduler = 'SLURM';
          outputData.label = 'Batch script template only; remote Slurm submission is unavailable';
          break;
        }

        case 'generate_pbs_script': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: 'Generating parameterized PBS Pro qsub script'
            })
          );
          outputData = HpcClusterGateway.generatePbsScript(params);
          outputData.status = 'SCRIPT_TEMPLATE_ONLY';
          outputData.submitted = false;
          outputData.executionPerformed = false;
          outputData.scheduler = 'PBS_PRO';
          outputData.label = 'Batch script template only; remote PBS Pro submission is unavailable';
          break;
        }

        case 'partition_rcb': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Executing Recursive Coordinate Bisection (RCB) domain decomposition'
            })
          );
          outputData = HpcClusterGateway.partitionRcb(params.points, params.numPartitions || 4);
          break;
        }

        case 'plan_out_of_core': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: 'Estimating storage from caller-supplied matrix and factor ratios'
            })
          );
          outputData = HpcClusterGateway.planOutOfCoreFrontal(
            params.dofCount,
            params.availableRamBytes,
            params.assumptions
          );
          break;
        }

        case 'execute_local_parallel': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 20,
              message: 'Dispatching task to PersistentWorkerPool'
            })
          );
          const pool = getGlobalPersistentWorkerPool();
          const taskType = params.taskType || 'PARALLEL_COMPUTE';
          const payload = params.payload || {};
          const options = {
            timeoutMs: params.timeoutMs,
            priority: params.priority
          };

          const taskPromise = pool.dispatch(taskType, payload, options);

          let abortListener = null;
          if (signal) {
            abortListener = () => {
              const activeWorker = pool.workers.find((w) => w.busy && w.currentTask?.payload === payload);
              if (activeWorker?.currentTask) {
                pool.cancel(activeWorker.currentTask.id).catch(() => {});
              }
            };
            signal.addEventListener('abort', abortListener, { once: true });
          }

          try {
            outputData = await taskPromise;
          } finally {
            if (signal && abortListener) {
              signal.removeEventListener('abort', abortListener);
            }
          }
          break;
        }

        case 'hpc:local-dispatch': {
          const cluster = getSharedLocalCluster();
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 20,
              message: 'Submitting task descriptor to local multi-process scheduler'
            })
          );
          const timeoutMs = params.timeoutMs || jobRequest.resourceBudget?.maxTimeMs || 120000;
          const submission = cluster.submit(params.descriptor, { timeoutMs });
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: `Local job ${submission.jobId} queued`
            })
          );
          const job = await cluster.waitFor(submission.jobId, { timeoutMs: timeoutMs + 5000 });
          outputData = {
            jobId: job.jobId,
            status: job.status,
            provider: 'local',
            scheduler: 'LOCAL_MULTIPROCESS',
            submitted: true,
            executionPerformed: job.status === HpcClusterGateway.JobState.COMPLETED,
            taskType: job.spec.taskType,
            workerPid: job.workerPid,
            stdout: job.stdout,
            stderr: job.stderr,
            transitions: job.transitions,
            result: job.result,
            error: job.error,
            executionDurationMs:
              job.startedAt && job.finishedAt ? Date.parse(job.finishedAt) - Date.parse(job.startedAt) : null
          };
          if (job.status === HpcClusterGateway.JobState.FAILED) {
            onEvent(
              new JobEvent({
                jobId,
                type: JobEventType.FAILED,
                message: `Local job failed: ${job.error.code} — ${job.error.message}`
              })
            );
            return new JobResult({
              jobId,
              status: JobStatus.FAILED,
              outputData,
              error: new OmniError(OmniErrorCode.INTERNAL, `${job.error.code}: ${job.error.message}`),
              backendName: this.name,
              backendVersion: this.version,
              executionDurationMs: Date.now() - tStart,
              peakMemoryMb: process.memoryUsage().heapUsed / (1024 * 1024)
            });
          }
          break;
        }

        case 'get_cluster_telemetry': {
          const gatewayTelemetry = getSharedHpcGateway().getTelemetry();
          const pool = getGlobalPersistentWorkerPool();
          const poolTelemetry = pool.getTelemetry();
          outputData = {
            configured: gatewayTelemetry.configured,
            provider: gatewayTelemetry.provider,
            gatewayVersion: gatewayTelemetry.gatewayVersion,
            schedulersSupported: [...gatewayTelemetry.schedulersSupported],
            jobs: gatewayTelemetry.jobs,
            workerPool: poolTelemetry,
            threadCount: pool.maxWorkers,
            perWorkerBusy: (Array.isArray(pool.workers) ? pool.workers : []).map((worker) => ({
              id: worker.id,
              busy: Boolean(worker.busy),
              currentTaskId: worker.currentTask?.id || null
            })),
            queueDepth: Array.isArray(pool.taskQueue) ? pool.taskQueue.length : 0,
            activeTasks: pool.activeTasks,
            completedTasksCount: pool.completedTasksCount,
            averageComputeTimeMs: poolTelemetry.averageComputeTimeMs,
            cancellationSupported: poolTelemetry.cancellationSupported,
            timeoutEnforced: poolTelemetry.timeoutEnforced,
            executionMode: poolTelemetry.executionMode
          };
          break;
        }

        default:
          throw new OmniError(
            OmniErrorCode.UNSUPPORTED,
            `Operation "${jobRequest.operation}" not implemented in HPCEngineAdapter`
          );
      }

      onEvent(
        new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 100, message: 'HPC operation complete' })
      );

      const inputHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ operation: jobRequest.operation, parameters: params }))
        .digest('hex');

      const validationRecord = new ValidationRecord({
        maturity: ValidationMaturity.EXPERIMENTAL,
        benchmarkSet: `HPC-${jobRequest.operation.toUpperCase()}-01`,
        errors: { loadImbalance: Number.isFinite(outputData?.loadImbalance) ? outputData.loadImbalance : 0 },
        tolerances: { maxLoadImbalance: 0.25 }
      });

      if (outputData && typeof outputData === 'object' && !Array.isArray(outputData)) {
        const quantities = {};
        if (Number.isFinite(outputData.estimatedMemoryBytes)) {
          quantities.estimatedMemoryBytes = Quantity.from(outputData.estimatedMemoryBytes, '1').toJSON();
        }
        if (Number.isFinite(outputData.numPartitions)) {
          quantities.numPartitions = Quantity.from(outputData.numPartitions, '1').toJSON();
        }
        if (Number.isFinite(outputData.loadImbalance)) {
          quantities.loadImbalance = Quantity.from(outputData.loadImbalance, '1').toJSON();
        }
        outputData.inputSha256 = inputHash;
        outputData.validationRecord = validationRecord.toJSON();
        outputData.quantities = quantities;
      }

      const outputHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(outputData || {}))
        .digest('hex');

      const durationMs = Date.now() - tStart;
      const result = new JobResult({
        jobId,
        status: JobStatus.SUCCEEDED,
        outputData,
        inputArtifactHashes: [inputHash],
        resultArtifactHashes: [outputHash],
        validationMaturity: ValidationMaturity.EXPERIMENTAL,
        backendName: this.name,
        backendVersion: this.version,
        executionDurationMs: durationMs,
        peakMemoryMb: process.memoryUsage().heapUsed / (1024 * 1024)
      });

      onEvent(new JobEvent({ jobId, type: JobEventType.COMPLETED, message: `Completed in ${durationMs}ms` }));
      return result;
    } catch (err) {
      onEvent(new JobEvent({ jobId, type: JobEventType.FAILED, message: err.message }));
      throw err;
    }
  }
}

function shutdownSharedLocalCluster() {
  if (sharedLocalCluster) {
    sharedLocalCluster.shutdown();
    sharedLocalCluster = null;
  }
  return true;
}

module.exports = {
  HPCEngineAdapter,
  shutdownSharedLocalCluster
};
