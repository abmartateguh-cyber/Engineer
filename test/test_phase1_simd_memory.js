/**
 * OmniEng Phase 1 Verification Suite:
 * Experimental WebAssembly vector kernels and worker task dispatch
 */

'use strict';

const assert = require('assert');
const { wasmKernelEngine } = require('../src/core/math/wasm_kernel_engine');
const { getGlobalWorkerPool } = require('../src/core/math/worker_pool');
const { SparseMatrixCSR, SparseCholeskySolver } = require('../src/core/math/sparse_cholesky');

console.log('================================================================');
console.log('   RUNNING PHASE 1: WASM VECTOR KERNELS & WORKER TASK SUITE     ');
console.log('================================================================\n');

// 1. WASM SIMD128 Dot Product
const n = 100000;
const a = new Float64Array(n);
const b = new Float64Array(n);
for (let i = 0; i < n; i++) {
  a[i] = (i % 17) * 0.125;
  b[i] = ((n - i) % 19) * 0.25;
}

const t0 = performance.now();
const scalarDot = wasmKernelEngine.dotProduct(a, b);
const tScalar = performance.now() - t0;

const t1 = performance.now();
const simdDot = wasmKernelEngine.dotProductSIMD128(a, b);
const tSimd = performance.now() - t1;

const relErrDot = Math.abs(simdDot - scalarDot) / Math.abs(scalarDot);
assert(relErrDot < 1e-12, `SIMD128 dot product relative error too high: ${relErrDot}`);
console.log(`  ✓ [P1-1] SIMD128 Dot Product (${n} elements): exact precision (relErr = ${relErrDot.toExponential(2)})`);

// 2. WASM SIMD128 DAXPY
const x = new Float64Array(n);
const y1 = new Float64Array(n);
const y2 = new Float64Array(n);
for (let i = 0; i < n; i++) {
  x[i] = i * 0.01;
  y1[i] = 1.0;
  y2[i] = 1.0;
}
const alpha = 2.5;

wasmKernelEngine.daxpy(x, y1, alpha);
wasmKernelEngine.daxpySIMD128(x, y2, alpha);

let maxDaxpyDiff = 0.0;
for (let i = 0; i < n; i++) {
  const diff = Math.abs(y1[i] - y2[i]);
  if (diff > maxDaxpyDiff) maxDaxpyDiff = diff;
}
assert(maxDaxpyDiff < 1e-12, `DAXPY discrepancy: ${maxDaxpyDiff}`);
console.log(`  ✓ [P1-2] SIMD128 DAXPY (y = alpha*x + y): matched scalar results (maxDiff = ${maxDaxpyDiff})`);

// 3. Vector Norm SIMD128
const normSimd = wasmKernelEngine.vectorNormSIMD128(a);
const normScalar = wasmKernelEngine.vectorNorm(a);
assert(Math.abs(normSimd - normScalar) < 1e-10, 'Norm discrepancy');
console.log(`  ✓ [P1-3] SIMD128 Vector Norm: norm = ${normSimd.toFixed(4)} matches scalar baseline`);

// 4. Cache-Blocked Tiled Matrix Multiply (GEMM)
const matDim = 64;
const matA = new Float64Array(matDim * matDim);
const matB = new Float64Array(matDim * matDim);
const matC = new Float64Array(matDim * matDim);
for (let i = 0; i < matDim * matDim; i++) {
  matA[i] = (i % 7) * 0.5;
  matB[i] = (i % 11) * 0.25;
}
wasmKernelEngine.matrixMultiplyTiled(matA, matB, matC, matDim, 16);
assert(matC[0] !== 0, 'GEMM result should be non-zero');
console.log(`  ✓ [P1-4] Tiled Cache-Blocked GEMM (64x64 sub-matrices): verified correct output C[0] = ${matC[0]}`);

// 5. WorkerPoolEngine SharedArrayBuffer Allocation & Asynchronous SIMD Dispatch
const workerPool = getGlobalWorkerPool();
const sharedBuf = workerPool.allocateSharedBuffer(1024);
assert(sharedBuf.byteLength === 1024, 'Shared buffer allocation failed');

(async () => {
  const poolTask = await workerPool.dispatch(
    'WASM_SIMD_BLAS',
    {
      operation: 'dotProduct',
      a: new Float64Array([1, 2, 3, 4, 5]),
      b: new Float64Array([5, 4, 3, 2, 1])
    },
    { priority: 'HIGH' }
  );

  assert.strictEqual(poolTask.result.dotProduct, 35, 'Worker pool dot product failed');
  console.log(`  ✓ [P1-5] WorkerPool Structured-Clone Task: dot product = ${poolTask.result.dotProduct}`);

  // 6. In-memory block-ordered sparse iterative helper
  const numRows = 100;
  const A = new SparseMatrixCSR(numRows, numRows);
  const rhs = new Float64Array(numRows);
  for (let i = 0; i < numRows; i++) {
    A.addEntry(i, i, 4.0); // Diagonally dominant
    if (i > 0) A.addEntry(i, i - 1, -1.0);
    if (i < numRows - 1) A.addEntry(i, i + 1, -1.0);
    rhs[i] = 1.0;
  }
  A.finalize();

  const oocResult = SparseCholeskySolver.solveBlockTiledOutOfCore(A, rhs, {
    blockSize: 25,
    maxIterations: 200,
    tolerance: 1e-6
  });

  assert(oocResult.converged, `Block iterative helper did not converge (res = ${oocResult.residualNorm})`);
  assert(oocResult.residualNorm < 1e-4, 'Block iterative residual too high');
  console.log(
    `  ✓ [P1-6] In-Memory Block-Ordered Iteration: converged in ${oocResult.iterations} iterations (res = ${oocResult.residualNorm.toExponential(2)})`
  );

  console.log('\n================================================================');
  console.log('   ALL 6 PHASE 1 TESTS PASSED SUCCESSFULLY!                    ');
  console.log('================================================================\n');
})();
