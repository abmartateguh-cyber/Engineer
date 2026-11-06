'use strict';

const assert = require('assert');
const path = require('path');
const { Worker } = require('worker_threads');

const { PersistentWorkerPool } = require('../src/core/math/worker_pool');
const { LinearSolver } = require('../src/core/math/linear_algebra');
const { SparseMatrixCSR } = require('../src/core/math/sparse_cholesky');
const { WasmSparseMultifrontalSolver } = require('../src/core/math/wasm_sparse_multifrontal');
const { measureStructuredPoissonBudget } = require('../src/core/vv/poisson_performance');

const WORKER_KERNEL_PATH = path.join(__dirname, '..', 'src', 'core', 'math', 'worker_thread_kernel.js');

console.log('================================================================');
console.log('   PHASE 0 KERNELS: SHARED MEMORY & SPARSE SOLVER ROBUSTNESS     ');
console.log('================================================================');

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildRandomSpd(n, seed) {
  const rand = createSeededRandom(seed);
  const B = Array.from({ length: n }, () => Array.from({ length: n }, () => rand() * 2 - 1));
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += B[i][k] * B[j][k];
      A[i][j] = sum;
    }
    A[i][i] += n;
  }
  return A;
}

function sparseCsrFromDense(dense) {
  const n = dense.length;
  const csr = new SparseMatrixCSR(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (dense[i][j] !== 0) csr.addEntry(i, j, dense[i][j]);
    }
  }
  csr.finalize();
  return csr;
}

function directWorkerDaxpy(x, y, alpha) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_KERNEL_PATH);
    const flags = new Int32Array(new SharedArrayBuffer(4));
    let settled = false;
    const finish = (error, payload) => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => {});
      if (error) reject(error);
      else resolve(payload);
    };
    worker.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'RESULT') {
        let spins = 0;
        while (spins < 100000 && Atomics.load(flags, 0) === 0) spins++;
        finish(null, message.result);
      } else if (message.type === 'ERROR') {
        const error = new Error(message.error.message);
        error.code = message.error.code;
        finish(error);
      }
    });
    worker.on('error', finish);
    worker.on('exit', (code) => {
      if (!settled && code !== 0) finish(new Error(`Direct worker exited with code ${code}`));
    });
    worker.postMessage({
      type: 'EXECUTE',
      taskId: 'direct-daxpy',
      taskType: 'WASM_SIMD_BLAS',
      payload: { operation: 'daxpy', x, y, alpha },
      sabCompletion: { flags, flagIndex: 0 }
    });
  });
}

async function runPhase0KernelsTests() {
  let total = 0;
  let passed = 0;
  let failed = 0;
  const failedNames = [];
  const pendingAsync = [];

  function run(name, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (error) {
      failed++;
      failedNames.push(name);
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${error && error.stack ? error.stack : error}`);
    }
  }

  function runAsync(name, fn) {
    total++;
    pendingAsync.push(
      (async () => {
        try {
          await fn();
          passed++;
          console.log(`  ✓ PASSED: ${name}`);
        } catch (error) {
          failed++;
          failedNames.push(name);
          console.error(`  ✗ FAILED: ${name}`);
          console.error(`    ${error && error.stack ? error.stack : error}`);
        }
      })()
    );
  }

  run('PersistentWorkerPool is shared-memory capable on this runtime', () => {
    assert.strictEqual(PersistentWorkerPool.isSharedArrayBufferAvailable(), true);
    const pool = new PersistentWorkerPool({ maxWorkers: 1, useSharedArrayBuffer: true });
    try {
      assert.strictEqual(pool.useSharedArrayBuffer, true);
      assert.strictEqual(pool.sharedArrayBufferAvailable, true);
      const shared = pool.allocateSharedFloat64Array(8);
      assert(shared.buffer instanceof SharedArrayBuffer, 'allocateSharedFloat64Array must return SAB-backed memory');
      assert.strictEqual(shared.length, 8);
      shared[0] = 3.25;
      assert.strictEqual(shared[0], 3.25);
    } finally {
      pool.terminateAll();
    }
  });

  run('useSharedArrayBuffer throws a typed error when SharedArrayBuffer is unavailable', () => {
    const realSharedArrayBuffer = globalThis.SharedArrayBuffer;
    Object.defineProperty(globalThis, 'SharedArrayBuffer', { value: undefined, configurable: true });
    try {
      assert.throws(
        () => new PersistentWorkerPool({ maxWorkers: 1, useSharedArrayBuffer: true }),
        (error) => error && error.code === 'UNSUPPORTED',
        'A pool must throw UNSUPPORTED when SharedArrayBuffer is requested but unavailable'
      );
      const pool = new PersistentWorkerPool({ maxWorkers: 1 });
      try {
        assert.throws(
          () => pool.allocateSharedFloat64Array(4),
          (error) => error && error.code === 'UNSUPPORTED',
          'allocateSharedFloat64Array must throw UNSUPPORTED when SharedArrayBuffer is unavailable'
        );
      } finally {
        pool.terminateAll();
      }
    } finally {
      Object.defineProperty(globalThis, 'SharedArrayBuffer', { value: realSharedArrayBuffer, configurable: true });
    }
  });

  run('Default pools do not silently enable shared memory', () => {
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    try {
      assert.strictEqual(pool.useSharedArrayBuffer, false);
      assert.strictEqual(pool.getTelemetry().useSharedArrayBuffer, false);
    } finally {
      pool.terminateAll();
    }
  });

  runAsync('Pooled worker zero-copy daxpy equals reference numeric result', async () => {
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    try {
      const n = 64;
      const x = pool.allocateSharedFloat64Array(n);
      const y = pool.allocateSharedFloat64Array(n);
      const rand = createSeededRandom(424242);
      const expected = new Float64Array(n);
      const alpha = 1.75;
      for (let i = 0; i < n; i++) {
        x[i] = rand() * 2 - 1;
        y[i] = rand() * 2 - 1;
        expected[i] = y[i] + alpha * x[i];
      }
      const response = await pool.dispatch(
        'WASM_SIMD_BLAS',
        { operation: 'daxpy', x, y, alpha },
        { useSharedArrayBuffer: true }
      );
      assert.strictEqual(response.success, true);
      for (let i = 0; i < n; i++) {
        assert.strictEqual(y[i], expected[i], `shared y[${i}] mismatch`);
      }
      assert.strictEqual(
        response.result.y.buffer.byteLength,
        y.buffer.byteLength,
        'returned y must have same byte length'
      );
      assert(y.buffer instanceof SharedArrayBuffer, 'y must remain SAB-backed');
      response.result.y[3] = -777.25;
      assert.strictEqual(y[3], -777.25, 'returned view must alias the shared y memory');
    } finally {
      await pool.terminateAll();
    }
  });

  runAsync('Pooled worker zero-copy spmv equals reference numeric result', async () => {
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    try {
      const nRows = 12;
      const rowPtr = new Int32Array([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36]);
      const colInd = new Int32Array([
        0, 1, 2, 0, 1, 3, 0, 2, 4, 1, 3, 5, 2, 4, 6, 3, 5, 7, 4, 6, 8, 5, 7, 9, 6, 8, 10, 7, 9, 11, 8, 10, 11, 9, 10, 11
      ]);
      const values = new Float64Array(
        [
          4, -1, 0, -1, 4, -1, 0, -1, 4, -1, 4, -1, 0, -1, 4, -1, 4, -1, 0, -1, 4, -1, 4, -1, 0, -1, 4, -1, 4, -1, 0,
          -1, 4, -1, 4, 0
        ].map((v, i) => (i % 3 === 2 ? -1 : v))
      );
      const x = pool.allocateSharedFloat64Array(nRows);
      const y = pool.allocateSharedFloat64Array(nRows);
      const rand = createSeededRandom(9876);
      const expected = new Float64Array(nRows);
      for (let i = 0; i < nRows; i++) x[i] = rand() * 2 - 1;
      for (let r = 0; r < nRows; r++) {
        let sum = 0;
        for (let p = rowPtr[r]; p < rowPtr[r + 1]; p++) sum += values[p] * x[colInd[p]];
        expected[r] = sum;
      }
      const response = await pool.dispatch(
        'WASM_SIMD_BLAS',
        { operation: 'spmv', rowPtr, colInd, values, x, y, nRows },
        { useSharedArrayBuffer: true }
      );
      assert.strictEqual(response.success, true);
      for (let i = 0; i < nRows; i++) {
        assert.strictEqual(y[i], expected[i], `shared y[${i}] mismatch`);
      }
    } finally {
      await pool.terminateAll();
    }
  });

  runAsync('Direct worker zero-copy daxpy equals reference numeric result', async () => {
    const n = 32;
    const sab = new SharedArrayBuffer(n * 8);
    const x = new Float64Array(sab);
    const y = new Float64Array(new SharedArrayBuffer(n * 8));
    const rand = createSeededRandom(20261028);
    const expected = new Float64Array(n);
    const alpha = -0.5;
    for (let i = 0; i < n; i++) {
      x[i] = rand() * 2 - 1;
      y[i] = rand() * 2 - 1;
      expected[i] = y[i] + alpha * x[i];
    }
    const result = await directWorkerDaxpy(x, y, alpha);
    assert(result && result.y instanceof Float64Array, 'direct worker must return a Float64Array y');
    assert.strictEqual(result.y.buffer.byteLength, y.buffer.byteLength, 'returned y must have same byte length');
    for (let i = 0; i < n; i++) {
      assert.strictEqual(y[i], expected[i], `direct shared y[${i}] mismatch`);
    }
    result.y[5] = 42.42;
    assert.strictEqual(y[5], 42.42, 'returned view must alias the shared y memory');
  });

  run('solveSparse solves a random SPD system with residual < 1e-9', () => {
    const n = 40;
    const A = buildRandomSpd(n, 777);
    const rand = createSeededRandom(1234);
    const b = Float64Array.from({ length: n }, () => rand() * 2 - 1);

    const result = LinearSolver.solveSparse(A, b);
    assert.strictEqual(result.method, 'sparse-cholesky');
    assert(result.converged, 'SPD solve must converge');
    assert(result.relativeResidual < 1e-9, `relative residual ${result.relativeResidual} must be < 1e-9`);
    assert(result.residualNorm < 1e-9, `absolute residual ${result.residualNorm} must be < 1e-9`);
    assert(result.solution instanceof Float64Array);

    const diagnostic = LinearSolver.isPositiveDefinite(A);
    assert.strictEqual(diagnostic.positiveDefinite, true);
    assert.strictEqual(diagnostic.factorizationOutcome, 'spd');
    assert.strictEqual(diagnostic.symmetric, true);
  });

  run('solveSparse accepts SparseMatrixCSR input with residual < 1e-9', () => {
    const n = 30;
    const A = buildRandomSpd(n, 555);
    const csr = sparseCsrFromDense(A);
    const rand = createSeededRandom(99);
    const b = Float64Array.from({ length: n }, () => rand() * 2 - 1);
    const result = LinearSolver.solveSparse(csr, b);
    assert.strictEqual(result.method, 'sparse-cholesky');
    assert(result.relativeResidual < 1e-9, `relative residual ${result.relativeResidual} must be < 1e-9`);
  });

  run('Indefinite nonsingular system falls back to dense LU with residual < 1e-9', () => {
    const A = [
      [2, 1],
      [1, -2]
    ];
    const b = Float64Array.from([1, 2]);
    const result = LinearSolver.solveSparse(A, b);
    assert.strictEqual(result.method, 'dense-lu');
    assert(result.relativeResidual < 1e-9, `LU relative residual ${result.relativeResidual} must be < 1e-9`);
    assert(result.converged, 'nonsingular indefinite solve must converge');
    const diagnostic = LinearSolver.isPositiveDefinite(A);
    assert.strictEqual(diagnostic.positiveDefinite, false);
    assert.strictEqual(diagnostic.factorizationOutcome, 'non-spd-pivot');
    assert.strictEqual(diagnostic.symmetric, true);
  });

  run('Singular indefinite input yields a typed NUMERICAL_FAILURE, never fabricated success', () => {
    const A = [
      [1, 2],
      [2, 4]
    ];
    const b = Float64Array.from([3, 6]);
    assert.throws(
      () => LinearSolver.solveSparse(A, b),
      (error) => error && error.code === 'NUMERICAL_FAILURE',
      'singular input must reject with NUMERICAL_FAILURE'
    );
    const diagnostic = LinearSolver.isPositiveDefinite(A);
    assert.strictEqual(diagnostic.positiveDefinite, false);
  });

  run('Poisson generalSparse path solves the 5-point Laplacian with residual < 1e-9 and is deterministic', () => {
    const gridSize = 40;
    const first = measureStructuredPoissonBudget({ gridSize, generalSparse: true });
    const second = measureStructuredPoissonBudget({ gridSize, generalSparse: true });

    assert.strictEqual(first.generalSparse, true);
    assert.strictEqual(first.solverMethod, 'sparse-cholesky');
    assert(Number.isInteger(first.nnzL) && first.nnzL > 0, 'general sparse path must report a real Cholesky fill');
    assert(
      first.solutionResidualRelativeL2 < 1e-9,
      `independent residual ${first.solutionResidualRelativeL2} must be < 1e-9`
    );
    assert(first.relativeResidual < 1e-9, `solver residual ${first.relativeResidual} must be < 1e-9`);
    assert.strictEqual(second.solutionResidualRelativeL2, first.solutionResidualRelativeL2);
    assert.strictEqual(second.relativeResidual, first.relativeResidual);
    assert.strictEqual(second.solverMethod, first.solverMethod);
    assert.strictEqual(second.nnzL, first.nnzL);

    const unknowns = gridSize * gridSize;
    const buildSolve = () => {
      const solver = new WasmSparseMultifrontalSolver(unknowns, unknowns, {
        enableStructuredPoissonDirect: false
      });
      for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
          const i = y * gridSize + x;
          solver.addEntry(i, i, 4);
          if (x > 0) solver.addEntry(i, i - 1, -1);
          if (x + 1 < gridSize) solver.addEntry(i, i + 1, -1);
          if (y > 0) solver.addEntry(i, i - gridSize, -1);
          if (y + 1 < gridSize) solver.addEntry(i, i + gridSize, -1);
        }
      }
      solver.factorize();
      return solver.solve(new Float64Array(unknowns).fill(1)).solution;
    };
    const solutionA = buildSolve();
    const solutionB = buildSolve();
    for (let i = 0; i < unknowns; i++) {
      assert.strictEqual(solutionB[i], solutionA[i], `solution[${i}] differs between runs`);
    }
  });

  await Promise.allSettled(pendingAsync);

  console.log('\n================================================================');
  console.log(`Phase 0 kernel checks finished: ${passed}/${total} passed (${failed} failed)`);
  console.log('================================================================\n');

  return { total, passed, failed };
}

module.exports = { runPhase0KernelsTests };

if (require.main === module) {
  runPhase0KernelsTests().then((stats) => {
    if (stats.failed > 0) process.exit(1);
  });
}
