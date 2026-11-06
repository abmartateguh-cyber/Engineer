'use strict';

const { parentPort, isMainThread } = require('worker_threads');

if (isMainThread) {
  throw new Error('worker_thread_kernel.js must be executed inside a Worker thread, not the main thread.');
}

/**
 * Kernel execution dispatcher for isolated compute workers.
 */
async function executeKernel(taskType, payload) {
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
    case 'PCG_SPMV_PARTIAL': {
      // Partition of (y = A*x) for the parallel preconditioned conjugate gradient
      // solver. rowPtr/colIdx are cloned per dispatch; values/x/y are SharedArrayBuffer
      // Float64Array views, so the vector and matrix-value memory is shared zero-copy.
      // Upon completion the worker raises its completion flag and notifies the main
      // thread, which synchronizes on Atomics.wait.
      const { rowPtr, colIdx, values, x, y, startRow, endRow, flags, flagIndex } = payload;
      if (
        !rowPtr ||
        !colIdx ||
        !values ||
        !x ||
        !y ||
        !Number.isInteger(startRow) ||
        !Number.isInteger(endRow) ||
        startRow < 0 ||
        endRow > x.length ||
        startRow >= endRow ||
        rowPtr.length < endRow + 1 ||
        colIdx.length > values.length
      ) {
        const invalid = new Error('PCG partial SpMV payload is malformed or out of bounds.');
        invalid.code = 'INVALID_INPUT';
        throw invalid;
      }
      const xLength = x.length;
      const valuesLength = values.length;
      for (let row = startRow; row < endRow; row++) {
        for (let entry = rowPtr[row]; entry < rowPtr[row + 1]; entry++) {
          if (entry >= valuesLength || colIdx[entry] < 0 || colIdx[entry] >= xLength) {
            const outOfRange = new Error('PCG partial SpMV entry index is out of bounds.');
            outOfRange.code = 'INVALID_INPUT';
            throw outOfRange;
          }
        }
      }
      for (let row = startRow; row < endRow; row++) {
        let sum = 0;
        for (let entry = rowPtr[row]; entry < rowPtr[row + 1]; entry++) {
          sum += values[entry] * x[colIdx[entry]];
        }
        y[row] = sum;
      }
      if (flags instanceof Int32Array && Number.isInteger(flagIndex)) {
        Atomics.store(flags, flagIndex, 1);
        Atomics.notify(flags, flagIndex);
      }
      return { rowsComputed: endRow - startRow };
    }
    case 'VARIATIONAL_SOLVE': {
      const { VariationalConstraintSolver } = require('../cad/variational_constraint_solver');
      const solver = new VariationalConstraintSolver();
      if (payload.points) {
        payload.points.forEach((point) => solver.addPoint(point.id, point.x, point.y, point.fixed));
      }
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
      if (payload.operation === 'norm') {
        return { norm: wasmKernelEngine.vectorNormSIMD128(payload.vec) };
      }
      break;
    }
    case 'ECHO_TEST': {
      // Diagnostic smoke and performance verification
      if (payload.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, payload.delayMs));
      }
      return { echo: payload.message || 'ok', threadId: require('worker_threads').threadId };
    }
    default:
      break;
  }

  const error = new Error(`Unsupported experimental task type: ${taskType}`);
  error.code = 'UNSUPPORTED';
  throw error;
}

let activeTaskId = null;
let cancelRequested = false;

parentPort.on('message', async (message) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'PING') {
    parentPort.postMessage({ type: 'PONG', threadId: require('worker_threads').threadId });
    return;
  }

  if (message.type === 'CANCEL') {
    if (activeTaskId === message.taskId) {
      cancelRequested = true;
    }
    return;
  }

  if (message.type === 'EXECUTE') {
    const { taskId, taskType, payload } = message;
    activeTaskId = taskId;
    cancelRequested = false;
    const tStart = performance.now();

    try {
      const result = await executeKernel(taskType, payload);
      const elapsed = performance.now() - tStart;

      if (cancelRequested) {
        parentPort.postMessage({
          type: 'CANCELLED',
          taskId,
          computeTimeMs: elapsed
        });
      } else {
        if (message.sabCompletion && message.sabCompletion.flags instanceof Int32Array) {
          Atomics.store(message.sabCompletion.flags, message.sabCompletion.flagIndex || 0, 1);
        }
        parentPort.postMessage({
          type: 'RESULT',
          taskId,
          result,
          computeTimeMs: elapsed
        });
      }
    } catch (err) {
      const elapsed = performance.now() - tStart;
      parentPort.postMessage({
        type: 'ERROR',
        taskId,
        error: {
          message: err.message,
          code: err.code || 'NUMERICAL_FAILURE',
          stack: err.stack
        },
        computeTimeMs: elapsed
      });
    } finally {
      activeTaskId = null;
      cancelRequested = false;
    }
  }
});
