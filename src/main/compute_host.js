/**
 * Process-local asynchronous task queue for experimental calculations.
 *
 * Tasks are currently dispatched with setImmediate on the main JavaScript event loop.
 * This class does not provide worker isolation, CPU parallelism, or remote compute.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

const { EventEmitter } = require('events');

const COMPUTE_PRIORITIES = new Set(['HIGH', 'NORMAL', 'LOW']);

function createUnsupportedOptionError(optionName, componentName) {
  const error = new Error(
    `${componentName} does not support '${optionName}' in its process-local event-loop implementation; the option was not applied.`
  );
  error.code = 'UNSUPPORTED';
  return error;
}

function validateConstructorOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Compute host constructor options must be an object.');
  }
  const unsupported = Object.keys(options);
  if (unsupported.length > 0) throw createUnsupportedOptionError(unsupported[0], 'Compute host');
}

function validateJobOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Compute job options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => key !== 'priority');
  if (unsupported.length > 0) throw createUnsupportedOptionError(unsupported[0], 'Compute host');
  if (options.priority !== undefined && !COMPUTE_PRIORITIES.has(options.priority)) {
    const error = new TypeError(`Unsupported compute priority '${options.priority}'.`);
    error.code = 'INVALID_INPUT';
    throw error;
  }
}

class ComputeHostProcess extends EventEmitter {
  /**
   * @param {Object} options
   * Jobs execute serially on the main JavaScript event loop. This queue provides
   * asynchronous dispatch only; it does not isolate CPU work or enforce timeouts.
   */
  constructor(options = {}) {
    super();
    validateConstructorOptions(options);
    this.executionMode = 'main-event-loop';
    this.activeJobs = new Map();
    this.pendingQueue = [];
    this._nextJobId = 1;
    this._nextQueueOrder = 1;
    queueMicrotask(() => this.emit('ready', { concurrency: 1, executionMode: this.executionMode }));
  }

  /**
   * Dispatches a computationally intensive job asynchronously.
   *
   * @param {string} taskType - e.g. 'FEA_SOLVE', 'SPARSE_CHOLESKY', 'CFD_SIMPLE', 'OPTICAL_DLS'
   * @param {Object} payload - Task inputs, matrices, or mesh buffers
   * @param {Object} [options] - Execution options: priority only. Timeout and cancellation options are unsupported.
   * @returns {Promise<Object>} Job execution result with compute telemetry
   */
  async submitJob(taskType, payload, options = {}) {
    if (typeof taskType !== 'string' || !taskType.trim()) {
      throw new TypeError('A compute task type is required.');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('A compute task payload object is required.');
    }
    validateJobOptions(options);
    const jobId = `job_${Date.now()}_${this._nextJobId++}`;
    const priority = options.priority ?? 'NORMAL'; // 'HIGH', 'NORMAL', 'LOW'

    const job = {
      id: jobId,
      taskType,
      payload,
      options: { priority },
      priority,
      status: 'QUEUED',
      createdAt: Date.now(),
      queueOrder: this._nextQueueOrder++,
      startedAt: null,
      completedAt: null,
      progress: 0.0,
      cancellationToken: null
    };

    const promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;

      this.activeJobs.set(jobId, job);
      this._enqueue(job);
    });
    job.promise = promise;
    return promise;
  }

  _enqueue(job) {
    this.pendingQueue.push(job);
    const priorityWeight = { HIGH: 3, NORMAL: 2, LOW: 1 };
    this.pendingQueue.sort(
      (left, right) =>
        priorityWeight[right.priority] - priorityWeight[left.priority] || left.queueOrder - right.queueOrder
    );
    this.emit('job:queued', { jobId: job.id, taskType: job.taskType });
    this._processNext();
  }

  _processNext() {
    const running = Array.from(this.activeJobs.values()).some((j) => j.status === 'RUNNING');
    if (running || this.pendingQueue.length === 0) {
      return;
    }

    const job = this.pendingQueue.shift();
    if (!job) return;
    if (job.status === 'CANCELLED') return this._processNext();

    job.status = 'RUNNING';
    job.startedAt = Date.now();
    this.emit('job:started', { jobId: job.id, taskType: job.taskType });

    // Defer dispatch to the event loop; CPU work itself is not isolated.
    setImmediate(async () => {
      try {
        const result = await this._executeKernel(job);
        job.status = 'COMPLETED';
        job.completedAt = Date.now();
        const durationMs = job.completedAt - job.startedAt;

        const telemetry = {
          jobId: job.id,
          taskType: job.taskType,
          durationMs,
          heapUsedAtCompletionMb: Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 100) / 100,
          status: 'COMPLETED',
          validationLevel: 'experimental',
          executionMode: this.executionMode
        };

        this.emit('job:completed', { jobId: job.id, telemetry });
        job.resolve({ success: true, result, telemetry });
      } catch (err) {
        job.status = 'FAILED';
        job.completedAt = Date.now();
        this.emit('job:failed', { jobId: job.id, error: err.message });
        job.reject(err);
        if (job.promise && typeof job.promise.catch === 'function') {
          job.promise.catch(() => {});
        }
      } finally {
        this.activeJobs.delete(job.id);
        this._processNext();
      }
    });
  }

  /**
   * Executes domain compute kernel dispatch.
   */
  async _executeKernel(job) {
    const { taskType, payload } = job;

    switch (taskType) {
      case 'SPARSE_CHOLESKY': {
        const { WasmSparseMultifrontalSolver } = require('../core/math/wasm_sparse_multifrontal');
        const n = payload.n || 0;
        const solver = new WasmSparseMultifrontalSolver(n, n);
        if (payload.entries && Array.isArray(payload.entries)) {
          for (const e of payload.entries) {
            solver.addEntry(e[0], e[1], e[2]);
          }
        }
        solver.finalizeCSR();
        const fac = solver.factorize();
        let sol = null;
        if (payload.b) {
          sol = solver.solve(payload.b);
        }
        return { factorization: fac, solution: sol };
      }

      case 'PARALLEL_PCG': {
        const { GPUParallelPCGSolver } = require('../core/math/gpu_parallel_pcg_solver');
        const pcg = new GPUParallelPCGSolver(payload.options || {});
        return pcg.solve(payload.csr, payload.b);
      }

      case 'PDN_IR_DROP': {
        const { PowerGridIRDropAnalyzer } = require('../core/eda/power_grid_ir_drop');
        const analyzer = new PowerGridIRDropAnalyzer(payload.options);
        const mesh = analyzer.createGridMesh(
          payload.rows,
          payload.cols,
          payload.pitchX,
          payload.pitchY,
          payload.sheetRho,
          payload.wireWidth
        );
        return analyzer.solveStaticIRDrop(mesh, payload.pads, payload.loads);
      }

      case 'OPTICAL_DLS': {
        const { DampedLeastSquaresOptimizer } = require('../core/optics/damped_least_squares_optimizer');
        const opt = new DampedLeastSquaresOptimizer(payload.options);
        return opt.optimize(payload.system, payload.variables, payload.operands);
      }

      default: {
        const err = new Error(`Unsupported compute task type: ${taskType}`);
        err.code = 'UNSUPPORTED';
        throw err;
      }
    }
  }

  /**
   * Cancels a queued job. A running event-loop calculation cannot be interrupted.
   * @param {string} jobId
   * @returns {boolean} True if cancelled
   */
  cancelJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) return false;

    if (job.status !== 'QUEUED') return false;

    const queueIndex = this.pendingQueue.findIndex((queuedJob) => queuedJob.id === jobId);
    if (queueIndex < 0) return false;

    job.status = 'CANCELLED';
    job.completedAt = Date.now();
    const err = new Error(`Job ${jobId} was cancelled by user`);
    err.code = 'ERR_JOB_CANCELLED';
    job.reject(err);
    if (job.promise && typeof job.promise.catch === 'function') {
      job.promise.catch(() => {});
    }
    this.pendingQueue.splice(queueIndex, 1);
    this.activeJobs.delete(jobId);
    this.emit('job:cancelled', { jobId });
    this._processNext();
    return true;
  }

  /**
   * Returns telemetry for all running/queued jobs.
   */
  getTelemetry() {
    const runningCount = Array.from(this.activeJobs.values()).filter((job) => job.status === 'RUNNING').length;
    return {
      concurrency: 1,
      executionMode: this.executionMode,
      cancellationSupported: 'queued-jobs-only',
      timeoutEnforced: false,
      runningCount,
      activeCount: this.activeJobs.size,
      outstandingCount: this.activeJobs.size,
      queuedCount: this.pendingQueue.filter((job) => job.status === 'QUEUED').length,
      heapUsedMb: (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)
    };
  }
}

// Singleton compute host instance
let defaultComputeHost = null;
function getComputeHost(options) {
  validateConstructorOptions(options ?? {});
  if (!defaultComputeHost) {
    defaultComputeHost = new ComputeHostProcess(options ?? {});
  }
  return defaultComputeHost;
}

module.exports = {
  ComputeHostProcess,
  getComputeHost
};
