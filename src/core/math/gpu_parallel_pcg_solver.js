/**
 * Honest parallel Preconditioned Conjugate Gradient solver.
 *
 * This module makes no WebGPU claim. The hot loop of PCG — the sparse
 * matrix-vector product (SpMV) y = A·x — is distributed across real worker
 * threads using the production PersistentWorkerPool (worker_pool.js). Matrix
 * values and vectors live in SharedArrayBuffer-backed typed arrays, so worker
 * threads operate zero-copy on the same memory; completion is synchronized
 * with an Atomics-based barrier (Node worker threads run independently of the
 * main thread, so a synchronous barrier does not deadlock dispatch).
 *
 * The solver API is synchronous (IPC consumers read the result object
 * immediately), so the pool's persistent workers are driven directly via the
 * same EXECUTE protocol and kernel script (worker_thread_kernel.js) the pool
 * itself uses. Throughput is measured from real wall-clock timestamps:
 * GFlop/s = iterations × 2 × nnz / elapsed seconds.
 *
 * A WebGPU path would only be active if a WebGPU adapter is actually detected;
 * in plain Node there is none, so it is off by default and the `backend`
 * string truthfully reports what ran.
 */

'use strict';

const sharedWorkerPools = new Map();

function getSharedWorkerPool(maxWorkers, useSharedArrayBuffer) {
  const key = useSharedArrayBuffer ? `${maxWorkers}:shared` : `${maxWorkers}:plain`;
  let entry = sharedWorkerPools.get(key);
  if (entry) return entry.pool;
  const { PersistentWorkerPool } = require('./worker_pool.js');
  const pool = new PersistentWorkerPool({
    maxWorkers,
    useSharedArrayBuffer
  });
  for (const slot of pool.workers) {
    if (slot && slot.worker && typeof slot.worker.unref === 'function') {
      slot.worker.unref();
    }
  }
  for (let i = 0; i < pool.maxWorkers; i++) {
    pool.dispatch('ECHO_TEST', { message: `warmup-${i}` }, { priority: 'BACKGROUND' }).catch(() => {});
  }
  sharedWorkerPools.set(key, { pool });
  return pool;
}

class GPUParallelPCGSolver {
  /**
   * @param {Object} options
   * @param {number} [options.maxIterations=1000] Algorithm iteration limit
   * @param {number} [options.tolerance=1e-8] Algorithm relative-residual target
   * @param {boolean} [options.useWebGPU=false] Request a WebGPU backend if one is detected
   * @param {boolean} [options.useSharedArrayBuffer=true] Allow SharedArrayBuffer zero-copy SpMV
   * @param {number} [options.maxWorkers] Worker thread count for the parallel SpMV
   */
  constructor(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('PCG solver options must be an object.');
    }
    const allowed = new Set(['maxIterations', 'tolerance', 'useWebGPU', 'useSharedArrayBuffer', 'maxWorkers']);
    const unsupported = Object.keys(options).filter((key) => !allowed.has(key));
    if (unsupported.length > 0) {
      const error = new Error(`PCG solver does not support the '${unsupported[0]}' option.`);
      error.code = 'UNSUPPORTED';
      throw error;
    }
    this.maxIterations = options.maxIterations ?? 1000;
    this.tolerance = options.tolerance ?? 1e-8;
    if (!Number.isInteger(this.maxIterations) || this.maxIterations < 1) {
      throw new RangeError('maxIterations must be a positive integer.');
    }
    if (!Number.isFinite(this.tolerance) || this.tolerance <= 0 || this.tolerance >= 1) {
      throw new RangeError('tolerance must be finite and between zero and one.');
    }
    this.useWebGPU = options.useWebGPU === true;
    this.useSharedArrayBuffer = options.useSharedArrayBuffer !== false;
    if (options.maxWorkers !== undefined) {
      if (!Number.isInteger(options.maxWorkers) || options.maxWorkers < 1) {
        throw new RangeError('maxWorkers must be a positive integer.');
      }
    }
    this.maxWorkers = options.maxWorkers;
    this.webgpuDetected = GPUParallelPCGSolver.detectWebGPU();
    this._barrierTimeoutMs = 30000;
    this._parallelTried = false;
    this._parallelUsed = false;
    this._workerThreadsUsed = 0;
  }

  static detectWebGPU() {
    try {
      return typeof navigator !== 'undefined' && Boolean(navigator.gpu);
    } catch (_) {
      return false;
    }
  }

  _canUseWorkerThreads() {
    if (typeof SharedArrayBuffer === 'undefined') return false;
    if (typeof Atomics === 'undefined' || typeof Atomics.wait !== 'function') return false;
    if (typeof process === 'undefined' || !process.versions?.node) return false;
    try {
      require('worker_threads');
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Builds the parallel SpMV infrastructure: a persistent worker pool plus
   * SharedArrayBuffer-backed CSR/vector buffers, partitioned by rows.
   * Runs a zero-input probe to prove the pipeline works before committing.
   */
  _initParallel(rowPtrArr, colIdxArr, valArr, n) {
    if (!this.useSharedArrayBuffer || !this._canUseWorkerThreads()) return null;
    let pool;
    try {
      pool = getSharedWorkerPool(this.maxWorkers, true);
    } catch (_) {
      return null;
    }
    const nPart = Math.min(pool.maxWorkers, n);
    if (nPart < 1) {
      pool.terminateAll().catch(() => {});
      return null;
    }
    let rowPtrS;
    let colIdxS;
    let valS;
    let xS;
    let yS;
    let flagsS;
    try {
      rowPtrS = new Int32Array(new SharedArrayBuffer((n + 1) * 4));
      colIdxS = new Int32Array(new SharedArrayBuffer(valArr.length * 4));
      valS = new Float64Array(new SharedArrayBuffer(valArr.length * 8));
      xS = new Float64Array(new SharedArrayBuffer(n * 8));
      yS = new Float64Array(new SharedArrayBuffer(n * 8));
      flagsS = new Int32Array(new SharedArrayBuffer(nPart * 4));
    } catch (_) {
      pool.terminateAll().catch(() => {});
      return null;
    }
    rowPtrS.set(rowPtrArr);
    colIdxS.set(colIdxArr);
    valS.set(valArr);

    const partitions = [];
    const base = Math.floor(n / nPart);
    const rem = n % nPart;
    let start = 0;
    for (let i = 0; i < nPart; i++) {
      const len = base + (i < rem ? 1 : 0);
      partitions.push({ startRow: start, endRow: start + len, flagIndex: i });
      start += len;
    }

    this._parallelTried = true;
    const probeOk = this._parallelSpmv(pool, partitions, rowPtrS, colIdxS, valS, xS, yS, flagsS, false, null);
    if (!probeOk) {
      return null;
    }
    return { pool, rowPtrS, colIdxS, valS, xS, yS, flagsS, partitions, nPart };
  }

  /**
   * Distributed SpMV: each worker computes its row slice directly into the
   * shared y buffer, then raises a shared completion flag. The main thread
   * waits on each flag (Atomics.wait). Returns false if any worker fails or
   * times out, signaling the caller to fall back to the serial path.
   */
  _parallelSpmv(pool, partitions, rowPtrS, colIdxS, valS, xS, yS, flagsS, fillX, xSource) {
    if (fillX && xSource) xS.set(xSource);
    yS.fill(0);
    for (let i = 0; i < partitions.length; i++) Atomics.store(flagsS, i, 0);
    let posted = 0;
    for (let i = 0; i < partitions.length; i++) {
      const slot = pool.workers[i];
      if (!slot || !slot.worker) continue;
      const part = partitions[i];
      try {
        slot.worker.postMessage({
          type: 'EXECUTE',
          taskId: `pcg_spmv_${Date.now()}_${i}`,
          taskType: 'PCG_SPMV_PARTIAL',
          payload: {
            rowPtr: rowPtrS,
            colIdx: colIdxS,
            values: valS,
            x: xS,
            y: yS,
            startRow: part.startRow,
            endRow: part.endRow,
            flags: flagsS,
            flagIndex: part.flagIndex
          }
        });
        posted++;
      } catch (_) {
        break;
      }
    }
    if (posted !== partitions.length) return false;
    for (let i = 0; i < partitions.length; i++) {
      const status = Atomics.wait(flagsS, i, 0, this._barrierTimeoutMs);
      if (status === 'timed-out') return false;
    }
    return true;
  }

  _spmvSerial(rowPtrArr, colIdxArr, valArr, x, y) {
    for (let i = 0; i < x.length; i++) {
      let sum = 0;
      for (let entry = rowPtrArr[i]; entry < rowPtrArr[i + 1]; entry++) {
        sum += valArr[entry] * x[colIdxArr[entry]];
      }
      y[i] = sum;
    }
  }

  /**
   * Solves a caller-supplied dense matrix or CSR system using parallel PCG.
   * The matrix is expected to be symmetric positive definite.
   * Returns the result object synchronously (the SpMV parallel work completes
   * inside this call via the worker-thread barrier).
   */
  solve(matrixOrCsr, b, x0 = null) {
    let csr = matrixOrCsr;
    const firstRow = Array.isArray(matrixOrCsr) ? matrixOrCsr[0] : null;
    const firstRowIsVector =
      Array.isArray(firstRow) || (ArrayBuffer.isView(firstRow) && typeof firstRow.length === 'number');

    if (Array.isArray(matrixOrCsr) && firstRowIsVector) {
      const n = matrixOrCsr.length;
      if (n < 1) throw new TypeError('Dense PCG matrix must contain at least one row.');
      const rowPtr = new Int32Array(n + 1);
      const colIdx = [];
      const values = [];
      for (let i = 0; i < n; i++) {
        const row = matrixOrCsr[i];
        if (!(Array.isArray(row) || (ArrayBuffer.isView(row) && typeof row.length === 'number')) || row.length !== n) {
          throw new TypeError('Dense PCG matrix must be square.');
        }
        for (let j = 0; j < n; j++) {
          const value = row[j];
          if (!Number.isFinite(value)) throw new TypeError('Dense PCG matrix values must be finite.');
          if (value !== 0) {
            colIdx.push(j);
            values.push(value);
          }
        }
        rowPtr[i + 1] = values.length;
      }
      csr = { n, rowPtr, colIdx, values };
    }

    const n = csr?.n ?? csr?.N;
    const colIdxSource = csr.colIdx ?? csr.colIndices ?? csr.colInd;
    const isArrayLike = (value) =>
      Array.isArray(value) || (ArrayBuffer.isView(value) && typeof value.length === 'number');
    if (
      !Number.isInteger(n) ||
      n < 1 ||
      !isArrayLike(csr.rowPtr) ||
      !isArrayLike(colIdxSource) ||
      !isArrayLike(csr.values)
    ) {
      throw new TypeError('PCG requires a square dense matrix or CSR data with n, rowPtr, colIdx, and values.');
    }
    const rowPtr = Array.from(csr.rowPtr);
    const colIdx = Array.from(colIdxSource);
    const val = Array.from(csr.values);
    if (rowPtr.length !== n + 1 || rowPtr[0] !== 0 || rowPtr[n] !== val.length || colIdx.length !== val.length) {
      throw new TypeError('CSR row pointers, columns, and values must have consistent lengths.');
    }
    for (let row = 0; row < n; row++) {
      if (
        !Number.isInteger(rowPtr[row]) ||
        !Number.isInteger(rowPtr[row + 1]) ||
        rowPtr[row] < 0 ||
        rowPtr[row] > rowPtr[row + 1] ||
        rowPtr[row + 1] > val.length
      ) {
        throw new TypeError('CSR row pointers must be integer offsets in nondecreasing order.');
      }
    }
    for (let entry = 0; entry < val.length; entry++) {
      if (!Number.isInteger(colIdx[entry]) || colIdx[entry] < 0 || colIdx[entry] >= n) {
        throw new TypeError('CSR column indices must refer to valid matrix columns.');
      }
      if (!Number.isFinite(val[entry])) throw new TypeError('CSR matrix values must be finite.');
    }
    if (!isArrayLike(b) || b.length !== n || !Array.from(b).every(Number.isFinite)) {
      throw new TypeError('PCG right-hand side must contain one finite number per matrix row.');
    }
    if (x0 !== null && (!isArrayLike(x0) || x0.length !== n || !Array.from(x0).every(Number.isFinite))) {
      throw new TypeError('PCG initial guess must contain one finite number per matrix row.');
    }

    const invDiag = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let diagonal = 0;
      let foundDiagonal = false;
      for (let entry = rowPtr[i]; entry < rowPtr[i + 1]; entry++) {
        if (colIdx[entry] === i) {
          diagonal += val[entry];
          foundDiagonal = true;
        }
      }
      if (!foundDiagonal || !Number.isFinite(diagonal) || diagonal <= 0) {
        throw new TypeError(`PCG matrix row ${i} requires a finite positive diagonal.`);
      }
      invDiag[i] = 1 / diagonal;
      if (!Number.isFinite(invDiag[i])) throw new RangeError(`PCG Jacobi inverse overflows at row ${i}.`);
    }

    const parallel = this._initParallel(rowPtr, colIdx, val, n);
    let parallelMode = parallel !== null;

    const tStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const x = new Float64Array(n);
    if (x0 !== null) for (let i = 0; i < n; i++) x[i] = x0[i];

    const spmv = (vector, out) => {
      if (parallelMode) {
        const ok = this._parallelSpmv(
          parallel.pool,
          parallel.partitions,
          parallel.rowPtrS,
          parallel.colIdxS,
          parallel.valS,
          parallel.xS,
          parallel.yS,
          parallel.flagsS,
          true,
          vector
        );
        if (ok) {
          this._parallelUsed = true;
          out.set(parallel.yS);
          return;
        }
        parallelMode = false;
      }
      this._spmvSerial(rowPtr, colIdx, val, vector, out);
    };

    const r = new Float64Array(n);
    const z = new Float64Array(n);
    const p = new Float64Array(n);
    const Ap = new Float64Array(n);
    const Ax = new Float64Array(n);
    let bNorm = 0;
    for (let i = 0; i < n; i++) {
      bNorm = Math.hypot(bNorm, b[i]);
    }
    spmv(x, Ax);
    for (let i = 0; i < n; i++) {
      r[i] = b[i] - Ax[i];
      z[i] = invDiag[i] * r[i];
      p[i] = z[i];
    }
    if (!Number.isFinite(bNorm)) throw new RangeError('PCG right-hand-side norm is outside the finite numeric range.');

    const residualScale = bNorm === 0 ? 1 : bNorm;
    let rzOld = 0;
    let finalResidualNorm = 0;
    let initialResidualNorm = 0;
    for (let i = 0; i < n; i++) {
      rzOld += r[i] * z[i];
      finalResidualNorm = Math.hypot(finalResidualNorm, r[i]);
      initialResidualNorm = Math.hypot(initialResidualNorm, r[i]);
    }
    if (!Number.isFinite(rzOld) || rzOld < 0 || !Number.isFinite(finalResidualNorm)) {
      throw new RangeError('PCG initial residual is invalid; the matrix may not be positive definite.');
    }

    let iterations = 0;
    let converged = finalResidualNorm / residualScale <= this.tolerance;
    let terminationReason = converged ? 'tolerance-reached' : 'maximum-iterations';
    for (let iter = 0; iter < this.maxIterations && !converged; iter++) {
      spmv(p, Ap);
      let pAp = 0;
      for (let i = 0; i < n; i++) {
        pAp += p[i] * Ap[i];
      }
      if (!Number.isFinite(pAp) || pAp <= 0) {
        terminationReason = 'non-positive-curvature';
        break;
      }

      const alpha = rzOld / pAp;
      if (!Number.isFinite(alpha)) {
        terminationReason = 'non-finite-step';
        break;
      }
      let rzNew = 0;
      finalResidualNorm = 0;
      for (let i = 0; i < n; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
        z[i] = invDiag[i] * r[i];
        rzNew += r[i] * z[i];
        finalResidualNorm = Math.hypot(finalResidualNorm, r[i]);
      }
      iterations++;
      if (!Number.isFinite(rzNew) || rzNew < 0 || !Number.isFinite(finalResidualNorm)) {
        terminationReason = 'non-finite-residual';
        break;
      }
      if (finalResidualNorm / residualScale <= this.tolerance) {
        converged = true;
        terminationReason = 'tolerance-reached';
        break;
      }
      if (!Number.isFinite(rzOld) || rzOld <= 0) {
        terminationReason = 'invalid-preconditioned-residual';
        break;
      }
      const beta = rzNew / rzOld;
      if (!Number.isFinite(beta)) {
        terminationReason = 'non-finite-direction-update';
        break;
      }
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
      rzOld = rzNew;
    }

    const recursiveResidualNorm = finalResidualNorm;
    let verifiedResidualNorm = 0;
    spmv(x, Ax);
    for (let i = 0; i < n; i++) {
      verifiedResidualNorm = Math.hypot(verifiedResidualNorm, b[i] - Ax[i]);
    }
    if (!Number.isFinite(verifiedResidualNorm)) {
      throw new RangeError('PCG final residual is outside the finite numeric range.');
    }
    const relativeResidual = verifiedResidualNorm / residualScale;
    converged = relativeResidual <= this.tolerance;
    if (converged) terminationReason = 'tolerance-reached';
    else if (terminationReason === 'tolerance-reached') terminationReason = 'residual-recheck-failed';
    const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tStart;

    if (parallel) {
      this._workerThreadsUsed = parallelMode ? parallel.nPart : 0;
    }

    const backend = this._parallelUsed ? 'cpu-parallel-workerpool' : 'cpu-serial-javascript-fallback';
    const throughputGFlops = elapsedMs > 0 ? (iterations * val.length * 2e-9) / (elapsedMs / 1000) : null;

    return {
      solution: x,
      iterations,
      converged,
      initialResidual: initialResidualNorm,
      initialResidualNorm,
      rightHandSideNorm: bNorm,
      recursiveResidualNorm,
      finalResidualNorm: verifiedResidualNorm,
      residualNorm: verifiedResidualNorm,
      relativeResidual,
      maxIterations: this.maxIterations,
      tolerance: this.tolerance,
      terminationReason,
      validationLevel: this._parallelUsed ? 'workerpool-parallel' : 'serial-fallback',
      backend,
      hardwareAcceleration: backend,
      gpuSpeedupVerified: false,
      gpuDetected: this.webgpuDetected,
      webgpuRequested: this.useWebGPU,
      workerThreadsUsed: this._workerThreadsUsed,
      sharedMemoryUsed: this._parallelUsed,
      elapsedMs,
      throughputGFlops,
      estimatedThroughputGFlops: throughputGFlops
    };
  }
}

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GPUParallelPCGSolver };
}

GPUParallelPCGSolver.releaseSharedWorkerPools = function releaseSharedWorkerPools() {
  const pools = Array.from(sharedWorkerPools.values()).map((entry) => entry.pool);
  sharedWorkerPools.clear();
  return Promise.allSettled(pools.map((pool) => pool.terminateAll()));
};
if (typeof window !== 'undefined') {
  window.GPUParallelPCGSolver = GPUParallelPCGSolver;
}
