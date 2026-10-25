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
    this.useThreads = options.useThreads !== false && this.isNode;
    this.executionMode = this.useThreads ? 'worker-threads' : 'main-event-loop';
    this._nextTaskId = 1;
    this._workerScript = path.join(__dirname, 'worker_thread_kernel.js');
    this._closing = false;

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
    } catch (_) {
      this.useThreads = false;
      this.executionMode = 'main-event-loop';
      this.maxWorkers = 1;
    }
  }

  _spawnWorker(slotIndex) {
    const { Worker } = require('worker_threads');
    const worker = new Worker(this._workerScript);
    const workerSlot = {
      id: slotIndex,
      worker,
      busy: false,
      currentTask: null,
      timer: null
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

  _replaceWorker(slot) {
    if (this._closing) return;
    try {
      slot.worker.terminate();
    } catch (_) {}
    this._spawnWorker(slot.id);
    this._drainQueue();
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
    const task = slot.currentTask;
    if (task) {
      if (slot.timer) clearTimeout(slot.timer);
      const omniErr = new OmniError(OmniErrorCode.INTERNAL, `Worker thread error: ${error.message}`);
      this._failTask(slot, task, omniErr);
    }
    this._replaceWorker(slot);
  }

  _onWorkerExit(slot, code) {
    const task = slot.currentTask;
    if (task) {
      if (slot.timer) clearTimeout(slot.timer);
      const omniErr = new OmniError(OmniErrorCode.RESOURCE_EXHAUSTED, `Worker exited unexpectedly with code ${code}`);
      this._failTask(slot, task, omniErr);
    }
    if (!this._closing) {
      this._spawnWorker(slot.id);
      this._drainQueue();
    }
  }

  _completeTask(slot, task, resolution) {
    slot.busy = false;
    slot.currentTask = null;
    slot.timer = null;
    this.activeTasks = Math.max(0, this.activeTasks - 1);
    this.completedTasksCount++;
    this.totalExecutionTimeMs += resolution.computeTimeMs || 0;
    task.resolve(resolution);
    this._drainQueue();
  }

  _failTask(slot, task, error) {
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
      const idleSlot = this.workers.find((w) => !w.busy);
      if (!idleSlot) return;

      const task = this.taskQueue.shift();
      if (!task) return;

      idleSlot.busy = true;
      idleSlot.currentTask = task;
      this.activeTasks++;

      idleSlot.timer = setTimeout(() => {
        this._handleTaskTimeout(idleSlot, task);
      }, task.timeoutMs);

      idleSlot.worker.postMessage({
        type: 'EXECUTE',
        taskId: task.id,
        taskType: task.taskType,
        payload: task.payload
      });

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
    this._replaceWorker(slot);
    this._failTask(slot, task, timeoutErr);
  }

  async cancel(taskId) {
    const queueIdx = this.taskQueue.findIndex((t) => t.id === taskId);
    if (queueIdx !== -1) {
      const [removed] = this.taskQueue.splice(queueIdx, 1);
      removed.reject(new OmniError(OmniErrorCode.CANCELLED, `Task ${taskId} cancelled before execution`));
      return true;
    }

    const activeSlot = this.workers.find((w) => w.busy && w.currentTask?.id === taskId);
    if (!activeSlot) return false;

    const task = activeSlot.currentTask;
    if (activeSlot.timer) clearTimeout(activeSlot.timer);

    const cancelErr = new OmniError(OmniErrorCode.CANCELLED, `Task ${taskId} cancelled`);
    this._replaceWorker(activeSlot);
    this._failTask(activeSlot, task, cancelErr);
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
    this._closing = true;
    this.taskQueue.forEach((t) => {
      t.reject(new OmniError(OmniErrorCode.CANCELLED, 'Worker pool terminated'));
    });
    this.taskQueue = [];
    const termPromises = this.workers.map((slot) => {
      if (slot.timer) clearTimeout(slot.timer);
      return slot.worker ? slot.worker.terminate() : Promise.resolve();
    });
    await Promise.all(termPromises);
    this.workers = [];
    this.activeTasks = 0;
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
