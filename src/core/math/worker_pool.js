/**
 * Experimental process-local calculation queue.
 *
 * Legacy module and class names are kept for compatibility. Tasks are deferred
 * with setImmediate and execute on the current JavaScript event loop; there is
 * no worker-thread isolation, CPU parallelism, or interruptible timeout.
 */

'use strict';

const TASK_PRIORITIES = new Set(['HIGH', 'NORMAL', 'BATCH']);

function unsupportedQueueOption(optionName) {
  const error = new Error(
    `ExperimentalCalculationQueue cannot honor '${optionName}' without worker isolation; the option was not applied.`
  );
  error.code = 'UNSUPPORTED';
  return error;
}

function validateQueueOptions(options, kind) {
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

class ExperimentalCalculationQueue {
  constructor(options = {}) {
    validateQueueOptions(options, 'Worker pool');
    this.maxWorkers = 1;
    this.taskQueue = [];
    this.activeTasks = 0;
    this.completedTasksCount = 0;
    this.totalExecutionTimeMs = 0;
    this.executionMode = 'main-event-loop';
    this.isNode = typeof process !== 'undefined' && !!process.versions?.node;
    this._nextTaskId = 1;
  }

  async dispatch(taskType, payload, options = {}) {
    if (typeof taskType !== 'string' || !taskType.trim()) throw new TypeError('A task type is required.');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new TypeError('A task payload object is required.');
    validateQueueOptions(options, 'Dispatch');
    const priorityWeight = { HIGH: 3, NORMAL: 2, BATCH: 1 }[options.priority ?? 'NORMAL'];

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
        if (payload.constraints)
          payload.constraints.forEach((constraint) =>
            solver.addConstraint(constraint.type, constraint.point1, constraint.point2, constraint.value)
          );
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
        if (payload.operation === 'dotProduct')
          return { dotProduct: wasmKernelEngine.dotProductSIMD128(payload.a, payload.b) };
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
      default:
        break;
    }

    const error = new Error(`Unsupported experimental task type: ${taskType}`);
    error.code = 'UNSUPPORTED';
    throw error;
  }

  allocateSharedBuffer(byteLength) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0)
      throw new TypeError('A non-negative byte length is required.');
    if (typeof SharedArrayBuffer !== 'undefined') {
      try {
        return new SharedArrayBuffer(byteLength);
      } catch (_) {
        // Fall through to an ordinary buffer when shared memory is unavailable.
      }
    }
    return new ArrayBuffer(byteLength);
  }

  getTelemetry() {
    const averageExecutionTimeMs =
      this.completedTasksCount > 0 ? this.totalExecutionTimeMs / this.completedTasksCount : 0;
    return {
      // Compatibility fields retained with truthful serial-queue values.
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

// Compatibility export; the implementation is an event-loop queue.
const WorkerPoolEngine = ExperimentalCalculationQueue;
let globalWorkerPool = null;

function getGlobalWorkerPool(options = {}) {
  validateQueueOptions(options, 'Worker pool');
  if (!globalWorkerPool) globalWorkerPool = new ExperimentalCalculationQueue(options);
  return globalWorkerPool;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ExperimentalCalculationQueue, WorkerPoolEngine, getGlobalWorkerPool };
}
if (typeof window !== 'undefined') {
  window.WorkerPoolEngine = WorkerPoolEngine;
  window.getGlobalWorkerPool = getGlobalWorkerPool;
}
