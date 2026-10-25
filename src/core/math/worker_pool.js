/**
 * Persistent Worker Pool for high-performance isolated engineering computation.
 *
 * Provides:
 * 1. PersistentWorkerPool: Multi-threaded worker isolation using Node.js worker_threads,
 *    task prioritization, true cancellation within 2 seconds, configurable timeouts,
 *    crash recovery, and execution telemetry.
 * 2. ExperimentalCalculationQueue: Legacy single-threaded event-loop calculation queue
 *    retained for backward compatibility.
 */

'use strict';

const path = require('path');
const os = require('os');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const TASK_PRIORITIES = Object.freeze(new Set(['HIGH', 'NORMAL', 'BATCH', 'BACKGROUND']));
const MAX_WORKER_RESTARTS_WITHOUT_SUCCESS = 3;

function unsupportedQueueOption(optionName) {
  const error = new Error(
    `ExperimentalCalculationQueue cannot honor '${optionName}' without worker isolation; the option was not applied.`
  );
  error.code = 'UNSUPPORTED';
  return error;
}

function validateLegacyQueueOptions(options, kind) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(`${kind} options must be an object.`);
  }

  if (kind === 'Worker pool' && Object.hasOwn(options, 'maxWorkers') && options.maxWorkers !== 1) {
    throw unsupportedQueueOption('maxWorkers');
  }

  const allowed = kind === 'Worker pool' ? new Set(['maxWorkers']) : new Set(['priority']);
  const unsupported = Object.keys(options).find((key) => !allowed.has(key));
  if (unsupported) throw unsupportedQueueOption(unsupported);

  if (kind === 'Dispatch' && options.priority !== undefined && !TASK_PRIORITIES.has(options.priority)) {
    const error = new TypeError(`Unsupported task priority '${options.priority}'.`);
    error.code = 'INVALID_INPUT';
    throw error;
  }
}

/**
 * Legacy single-threaded calculation queue for backward compatibility.
 */
class ExperimentalCalculationQueue {
  constructor(options = {}) {
    validateLegacyQueueOptions(options, 'Worker pool');
    this.maxWorkers = 1;
    this.taskQueue = [];
    this.activeTasks = 0;
    this.completedTasksCount = 0;
    this.totalExecutionTimeMs = 0;
    this.executionMode = 'main-event-loop';
    this.isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
    this._nextTaskId = 1;
  }

  async dispatch(taskType, payload, options = {}) {
    if (typeof taskType !== 'string' || !taskType.trim()) throw new TypeError('A task type is required.');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('A task payload object is required.');
    }
    validateLegacyQueueOptions(options, 'Dispatch');
    const priorityWeight = { HIGH: 3, NORMAL: 2, BATCH: 1, BACKGROUND: 1 }[options.priority ?? 'NORMAL'] || 2;

    return new Promise((resolve, reject) => {
      const task = {
        id: `task_${this._nextTaskId++}`,
        taskType,
        payload,
        priorityWeight,
        resolve,
        reject
      };
      this.taskQueue.push(task);
      this.taskQueue.sort((a, b) => b.priorityWeight - a.priorityWeight);
      this._drainQueue();
    });
  }

  async _drainQueue() {
    if (this.activeTasks > 0 || this.taskQueue.length === 0) return;
    const task = this.taskQueue.shift();
    this.activeTasks = 1;
    const tStart = performance.now();

    try {
      const result = await this._executeKernel(task.taskType, task.payload);
      const elapsed = performance.now() - tStart;
      this.completedTasksCount++;
      this.totalExecutionTimeMs += elapsed;
      task.resolve({
        success: true,
        taskId: task.id,
        taskType: task.taskType,
        computeTimeMs: elapsed,
        executionMode: this.executionMode,
        validationLevel: 'experimental',
        result
      });
    } catch (error) {
      task.reject(error);
    } finally {
      this.activeTasks = 0;
      this._drainQueue();
    }
  }

  async _executeKernel(taskType, payload) {
    await new Promise((resolve) => {
      if (typeof setImmediate === 'function') setImmediate(resolve);
      else setTimeout(resolve, 0);
    });

    switch (taskType) {
      case 'SPARSE_CHOLESKY': {
        const { WasmSparseMultifrontalSolver } = require('./wasm_sparse_multifrontal');
        const solver = new WasmSparseMultifrontalSolver(payload);
        return solver.factorizeAndSolve();
      }
      case 'PCG_SOLVE': {
        const { GPUParallelPCGSolver } = require('./gpu_parallel_pcg_solver');
        const solver = new GPUParallelPCGSolver(payload);
        return solver.solveLinearSystem(payload.A, payload.b);
      }
      case 'VARIATIONAL_SOLVE': {
        const { VariationalConstraintSolver } = require('../cad/variational_constraint_solver');
        const solver = new VariationalConstraintSolver();
        if (payload.points) payload.points.forEach((point) => solver.addPoint(point.id, point.x, point.y, point.fixed));
        if (payload.constraints) {
          payload.constraints.forEach((constraint) =>
            solver.addConstraint(constraint.type, constraint.point1, constraint.point2, constraint.value)
          );
        }
        return solver.solve();
      }
      case 'DLS_OPT': {
        const { DampedLeastSquaresOptimizer } = require('../optics/damped_least_squares_optimizer');
        const optimizer = new DampedLeastSquaresOptimizer(payload.options);
        return optimizer.optimize(payload.system, payload.variables, payload.operands);
      }
      case 'OUT_OF_CORE_SPARSE': {
        const { SparseCholeskySolver } = require('./sparse_cholesky');
        return SparseCholeskySolver.solveBlockTiledOutOfCore(payload.A, payload.b, payload.options);
      }
      case 'WASM_SIMD_BLAS': {
        const { wasmKernelEngine } = require('./wasm_kernel_engine');
        if (payload.operation === 'dotProduct') {
          return { dotProduct: wasmKernelEngine.dotProductSIMD128(payload.a, payload.b) };
        }
        if (payload.operation === 'daxpy') {
          wasmKernelEngine.daxpySIMD128(payload.x, payload.y, payload.alpha);
          return { y: payload.y };
        }
        if (payload.operation === 'spmv') {
          wasmKernelEngine.spmvSIMD128(
            payload.rowPtr,
            payload.colInd,
            payload.values,
            payload.x,
            payload.y,
            payload.nRows
          );
          return { y: payload.y };
        }
        if (payload.operation === 'norm') return { norm: wasmKernelEngine.vectorNormSIMD128(payload.vec) };
        break;
      }
      case 'ECHO_TEST': {
        if (payload.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, payload.delayMs));
        }
        return { echo: payload.message || 'ok' };
      }
      default:
        break;
    }

    const error = new Error(`Unsupported experimental task type: ${taskType}`);
    error.code = 'UNSUPPORTED';
    throw error;
  }

  allocateSharedBuffer(byteLength) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new TypeError('A non-negative byte length is required.');
    }
    if (typeof SharedArrayBuffer !== 'undefined') {
      try {
        return new SharedArrayBuffer(byteLength);
      } catch (_) {}
    }
    return new ArrayBuffer(byteLength);
  }

  getTelemetry() {
    const averageExecutionTimeMs =
      this.completedTasksCount > 0 ? this.totalExecutionTimeMs / this.completedTasksCount : 0;
    return {
      maxWorkers: this.maxWorkers,
      activeWorkers: this.activeTasks,
      averageComputeTimeMs: averageExecutionTimeMs,
      executionMode: this.executionMode,
      activeTasks: this.activeTasks,
      queuedTasks: this.taskQueue.length,
      completedTasksCount: this.completedTasksCount,
      averageExecutionTimeMs,
      cancellationSupported: false,
      timeoutEnforced: false
    };
  }
}

/**
 * Production PersistentWorkerPool with isolated worker threads, priority, timeouts, and cancellation.
 */
class PersistentWorkerPool {
  constructor(options = {}) {
    const cpuCount = typeof os.cpus === 'function' ? os.cpus().length : 4;
    const requestedWorkers = Number(options.maxWorkers);
    this.maxWorkers =
      Number.isInteger(requestedWorkers) && requestedWorkers >= 1
        ? requestedWorkers
        : Math.min(Math.max(cpuCount, 1), 8);

    this.defaultTimeoutMs = Math.max(500, Number(options.defaultTimeoutMs) || 60000);
    this.taskQueue = [];
    this.workers = [];
    this.activeTasks = 0;
    this.completedTasksCount = 0;
    this.totalExecutionTimeMs = 0;
    this.isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
    if (!this.isNode || options.useThreads === false) {
      throw new OmniError(
        OmniErrorCode.UNSUPPORTED,
        'PersistentWorkerPool requires Node.js worker_threads; use ExperimentalCalculationQueue for event-loop execution.'
      );
    }
    this.useThreads = true;
    this.executionMode = 'worker-threads';
    this._nextTaskId = 1;
    this._workerScript = path.join(__dirname, 'worker_thread_kernel.js');
    this._closing = false;
    this._terminationPromise = null;
    this._terminalError = null;

    if (this.useThreads) {
      this._initWorkers();
    }
  }

  _initWorkers() {
    try {
      const { Worker } = require('worker_threads');
      for (let i = 0; i < this.maxWorkers; i++) {
        this._spawnWorker(i);
      }
    } catch (error) {
      this._closing = true;
      const partialWorkers = this.workers.splice(0);
      for (const slot of partialWorkers) {
        try {
          Promise.resolve(slot.worker.terminate()).catch(() => {});
        } catch (_) {}
      }
      throw new OmniError(
        OmniErrorCode.RESOURCE_EXHAUSTED,
        'PersistentWorkerPool could not start its required worker threads.',
        { requestedWorkers: this.maxWorkers },
        error
      );
    }
  }

  _spawnWorker(slotIndex, restartCount = 0) {
    const { Worker } = require('worker_threads');
    const worker = new Worker(this._workerScript);
    const workerSlot = {
      id: slotIndex,
      worker,
      busy: false,
      currentTask: null,
      timer: null,
      restartCount
    };

    worker.on('message', (msg) => this._onWorkerMessage(workerSlot, msg));
    worker.on('error', (err) => this._onWorkerError(workerSlot, err));
    worker.on('exit', (code) => {
      if (this._closing || this.workers[slotIndex]?.worker !== worker) {
        return;
      }
      this._onWorkerExit(workerSlot, code);
    });

    this.workers[slotIndex] = workerSlot;
    return workerSlot;
  }

  _replaceWorker(slot, countRestart = false) {
    if (this._closing) return false;

    try {
      slot.worker?.terminate();
    } catch (_) {}

    const restartCount = slot.restartCount + Number(countRestart);
    if (restartCount > MAX_WORKER_RESTARTS_WITHOUT_SUCCESS) {
      this._failPool(
        new Error(
          `Worker ${slot.id} exceeded ${MAX_WORKER_RESTARTS_WITHOUT_SUCCESS} restarts without a successful task.`
        )
      );
      return false;
    }

    try {
      this._spawnWorker(slot.id, restartCount);
      this._drainQueue();
      return true;
    } catch (error) {
      this._failPool(error);
      return false;
    }
  }

  _failPool(cause) {
    if (this._closing) return;

    this._closing = true;
    this.executionMode = 'failed';
    this._terminalError = new OmniError(
      OmniErrorCode.RESOURCE_EXHAUSTED,
      'PersistentWorkerPool could not recover a failed worker.',
      { maxWorkers: this.maxWorkers },
      cause
    );

    this.taskQueue.forEach((task) => task.reject(this._terminalError));
    this.taskQueue = [];

    const terminations = this.workers.filter(Boolean).map((slot) => {
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = null;
      if (slot.currentTask) {
        slot.currentTask.reject(this._terminalError);
        slot.currentTask = null;
      }
      slot.busy = false;
      try {
        return slot.worker ? slot.worker.terminate() : Promise.resolve();
      } catch (_) {
        return Promise.resolve();
      }
    });

    this.workers = [];
    this.activeTasks = 0;
    this._terminationPromise = Promise.allSettled(terminations).then(() => {});
  }

  _failWorker(slot, error, countRestart = false) {
    if (this._closing || this.workers[slot.id] !== slot) return;

    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    this.workers[slot.id] = null;

    if (slot.currentTask) this._failTask(slot, slot.currentTask, error);
    this._replaceWorker(slot, countRestart);
  }

  _onWorkerMessage(slot, message) {
    if (!message || typeof message !== 'object') return;
    const task = slot.currentTask;

    if (message.type === 'RESULT' && task && task.id === message.taskId) {
      if (slot.timer) clearTimeout(slot.timer);
      this._completeTask(slot, task, {
        success: true,
        taskId: task.id,
        taskType: task.taskType,
        computeTimeMs: message.computeTimeMs,
        executionMode: this.executionMode,
        validationLevel: 'experimental',
        result: message.result
      });
    } else if (message.type === 'CANCELLED' && task && task.id === message.taskId) {
      if (slot.timer) clearTimeout(slot.timer);
      const cancelErr = new OmniError(OmniErrorCode.CANCELLED, `Task ${task.id} cancelled`);
      this._failTask(slot, task, cancelErr);
    } else if (message.type === 'ERROR' && task && task.id === message.taskId) {
      if (slot.timer) clearTimeout(slot.timer);
      const err = new OmniError(
        message.error.code || OmniErrorCode.NUMERICAL_FAILURE,
        message.error.message || 'Worker execution failed',
        { stack: message.error.stack }
      );
      this._failTask(slot, task, err);
    }
  }

  _onWorkerError(slot, error) {
    const omniErr = new OmniError(OmniErrorCode.INTERNAL, `Worker thread error: ${error.message}`);
    this._failWorker(slot, omniErr, true);
  }

  _onWorkerExit(slot, code) {
    const omniErr = new OmniError(OmniErrorCode.RESOURCE_EXHAUSTED, `Worker exited unexpectedly with code ${code}`);
    this._failWorker(slot, omniErr, true);
  }

  _completeTask(slot, task, resolution) {
    if (slot.currentTask !== task) return;
    slot.busy = false;
    slot.currentTask = null;
    slot.timer = null;
    slot.restartCount = 0;
    this.activeTasks = Math.max(0, this.activeTasks - 1);
    this.completedTasksCount++;
    this.totalExecutionTimeMs += resolution.computeTimeMs || 0;
    task.resolve(resolution);
    this._drainQueue();
  }

  _failTask(slot, task, error) {
    if (slot.currentTask !== task) return;
    slot.busy = false;
    slot.currentTask = null;
    slot.timer = null;
    this.activeTasks = Math.max(0, this.activeTasks - 1);
    task.reject(error);
    this._drainQueue();
  }

  async dispatch(taskType, payload, options = {}) {
    if (typeof taskType !== 'string' || !taskType.trim()) {
      throw new TypeError('A task type is required.');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('A task payload object is required.');
    }
    if (this._closing) {
      throw (
        this._terminalError ||
        new OmniError(OmniErrorCode.CANCELLED, 'Worker pool is terminated and cannot accept new tasks.')
      );
    }

    const priorityWeight = { HIGH: 3, NORMAL: 2, BATCH: 1, BACKGROUND: 1 }[options.priority ?? 'NORMAL'] || 2;
    const timeoutMs = Math.max(200, Number(options.timeoutMs) || this.defaultTimeoutMs);

    return new Promise((resolve, reject) => {
      const task = {
        id: `task_${this._nextTaskId++}`,
        taskType,
        payload,
        priorityWeight,
        timeoutMs,
        resolve,
        reject,
        queuedAt: performance.now()
      };
      this.taskQueue.push(task);
      this.taskQueue.sort((a, b) => b.priorityWeight - a.priorityWeight);
      this._drainQueue();
    });
  }

  _drainQueue() {
    if (this._closing || this.taskQueue.length === 0) return;

    if (this.useThreads) {
      const idleSlot = this.workers.find((w) => w && !w.busy);
      if (!idleSlot) return;

      const task = this.taskQueue.shift();
      if (!task) return;

      idleSlot.busy = true;
      idleSlot.currentTask = task;
      this.activeTasks++;

      idleSlot.timer = setTimeout(() => {
        this._handleTaskTimeout(idleSlot, task);
      }, task.timeoutMs);

      try {
        idleSlot.worker.postMessage({
          type: 'EXECUTE',
          taskId: task.id,
          taskType: task.taskType,
          payload: task.payload
        });
      } catch (error) {
        if (error.code === 'ERR_WORKER_NOT_RUNNING') {
          this._failWorker(
            idleSlot,
            new OmniError(OmniErrorCode.INTERNAL, `Worker thread rejected task ${task.id}.`, {}, error),
            true
          );
        } else {
          if (idleSlot.timer) clearTimeout(idleSlot.timer);
          const inputError = new OmniError(
            OmniErrorCode.INVALID_INPUT,
            `Task ${task.id} payload could not be cloned for worker execution.`,
            {},
            error
          );
          this._failTask(idleSlot, task, inputError);
        }
        return;
      }

      if (this.taskQueue.length > 0) {
        this._drainQueue();
      }
    }
  }

  _handleTaskTimeout(slot, task) {
    if (!slot.busy || slot.currentTask?.id !== task.id) return;
    const timeoutErr = new OmniError(
      OmniErrorCode.TIMEOUT,
      `Task ${task.id} exceeded maximum execution limit of ${task.timeoutMs} ms`
    );
    this._failWorker(slot, timeoutErr);
  }

  async cancel(taskId) {
    const queueIdx = this.taskQueue.findIndex((t) => t.id === taskId);
    if (queueIdx !== -1) {
      const [removed] = this.taskQueue.splice(queueIdx, 1);
      removed.reject(new OmniError(OmniErrorCode.CANCELLED, `Task ${taskId} cancelled before execution`));
      return true;
    }

    const activeSlot = this.workers.find((w) => w && w.busy && w.currentTask?.id === taskId);
    if (!activeSlot) return false;

    const task = activeSlot.currentTask;
    const cancelErr = new OmniError(OmniErrorCode.CANCELLED, `Task ${taskId} cancelled`);
    this._failWorker(activeSlot, cancelErr);
    return true;
  }

  allocateSharedBuffer(byteLength) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new TypeError('A non-negative byte length is required.');
    }
    if (typeof SharedArrayBuffer !== 'undefined') {
      try {
        return new SharedArrayBuffer(byteLength);
      } catch (_) {}
    }
    return new ArrayBuffer(byteLength);
  }

  getTelemetry() {
    const averageExecutionTimeMs =
      this.completedTasksCount > 0 ? this.totalExecutionTimeMs / this.completedTasksCount : 0;
    return {
      maxWorkers: this.maxWorkers,
      activeWorkers: this.activeTasks,
      averageComputeTimeMs: averageExecutionTimeMs,
      executionMode: this.executionMode,
      activeTasks: this.activeTasks,
      queuedTasks: this.taskQueue.length,
      completedTasksCount: this.completedTasksCount,
      averageExecutionTimeMs,
      cancellationSupported: true,
      timeoutEnforced: true
    };
  }

  async terminateAll() {
    if (this._terminationPromise) return this._terminationPromise;

    this._closing = true;
    this.executionMode = 'terminated';
    this.taskQueue.forEach((task) => {
      task.reject(new OmniError(OmniErrorCode.CANCELLED, 'Worker pool terminated'));
    });
    this.taskQueue = [];

    const termPromises = this.workers.map((slot) => {
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = null;
      if (slot.currentTask) {
        slot.currentTask.reject(new OmniError(OmniErrorCode.CANCELLED, 'Worker pool terminated'));
        slot.currentTask = null;
      }
      slot.busy = false;
      try {
        return slot.worker ? slot.worker.terminate() : Promise.resolve();
      } catch (_) {
        return Promise.resolve();
      }
    });
    this.activeTasks = 0;
    this._terminationPromise = Promise.allSettled(termPromises).then(() => {
      this.workers = [];
    });
    await this._terminationPromise;
  }
}

// Backward compatibility: WorkerPoolEngine is ExperimentalCalculationQueue
const WorkerPoolEngine = ExperimentalCalculationQueue;
let globalWorkerPool = null;

function getGlobalWorkerPool(options = {}) {
  if (!globalWorkerPool) globalWorkerPool = new ExperimentalCalculationQueue(options);
  return globalWorkerPool;
}

let globalPersistentPool = null;
function getGlobalPersistentWorkerPool(options = {}) {
  if (!globalPersistentPool) globalPersistentPool = new PersistentWorkerPool(options);
  return globalPersistentPool;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PersistentWorkerPool,
    ExperimentalCalculationQueue,
    WorkerPoolEngine,
    getGlobalWorkerPool,
    getGlobalPersistentWorkerPool
  };
}
if (typeof window !== 'undefined') {
  window.PersistentWorkerPool = PersistentWorkerPool;
  window.ExperimentalCalculationQueue = ExperimentalCalculationQueue;
  window.WorkerPoolEngine = WorkerPoolEngine;
  window.getGlobalWorkerPool = getGlobalWorkerPool;
}
