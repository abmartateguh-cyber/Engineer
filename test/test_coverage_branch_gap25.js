'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 25).
 *
 * Targets remaining untested branches in the math cluster: sparse CSR /
 * Cholesky helpers, the WASM multifrontal façade (ordering paths, structured
 * Poisson detection, non-SPD handling), the WASM kernel engine JS fallbacks
 * and SIMD tails, the parallel PCG solver validation/termination guards, the
 * RCB domain-decomposition trim/axis branches, worker-pool cancellation and
 * shared-payload paths, the worker-thread kernel protocol (PING/CANCEL/
 * sabCompletion/error codes), ODE solver edge branches, dense linear-algebra
 * fallback diagnostics, the native accelerator interface JS loops, the
 * Poisson DST-I solver, the MatrixMarket parser symmetry formats, and the
 * legacy HPC gateway façade. No production source is modified.
 */

const assert = require('assert');
const path = require('path');
const { Worker } = require('worker_threads');

const { SparseMatrixCSR, SparseCholeskySolver } = require('../src/core/math/sparse_cholesky');
const { WasmSparseMultifrontalSolver } = require('../src/core/math/wasm_sparse_multifrontal');
const { WasmKernelEngine, wasmKernelEngine } = require('../src/core/math/wasm_kernel_engine');
const { GPUParallelPCGSolver } = require('../src/core/math/gpu_parallel_pcg_solver');
const { DomainDecompositionEngine } = require('../src/core/math/domain_decomposition');
const {
  PersistentWorkerPool,
  ExperimentalCalculationQueue,
  getGlobalWorkerPool,
  getGlobalPersistentWorkerPool
} = require('../src/core/math/worker_pool');
const { ODESolvers, RadauIIA } = require('../src/core/math/ode_solvers');
const { Vector3, Quaternion, LinearSolver } = require('../src/core/math/linear_algebra');
const { NativeAcceleratorInterface, accelerator } = require('../src/core/math/native_accelerator_interface');
const { Poisson2DDirichletDirectSolver } = require('../src/core/math/poisson_2d_direct');
const {
  parseMatrixMarket,
  loadBundledMatrices,
  solveWithProductionSolver,
  runMatrixMarketSuite,
  resolveSuiteDirectory
} = require('../src/core/math/matrix_market_suite');
const { HpcClusterGateway, JOB_STATES } = require('../src/core/math/hpc_cluster_gateway');

const KERNEL_SCRIPT = path.join(__dirname, '..', 'src', 'core', 'math', 'worker_thread_kernel.js');

async function runBranchGapTwentyFiveCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const pending = [];
  const asyncOutcomes = [];

  function check(name, fn) {
    totalTests++;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        pending.push(
          Promise.resolve(result).then(
            () => {
              asyncOutcomes.push('pass');
              console.log(`  ✓ PASSED: ${name}`);
            },
            (err) => {
              asyncOutcomes.push('fail');
              console.error(`  ✗ FAILED: ${name}`);
              console.error(`    ${err.message}`);
            }
          )
        );
        return;
      }
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  function buildSparseMatrix(n, bandwidth, diag, offDiag) {
    const m = new SparseMatrixCSR(n, n);
    for (let i = 0; i < n; i++) {
      m.addEntry(i, i, diag);
      for (let j = Math.max(0, i - bandwidth); j < i; j++) m.addEntry(i, j, offDiag);
      for (let j = i + 1; j <= Math.min(n - 1, i + bandwidth); j++) m.addEntry(i, j, offDiag);
    }
    m.finalize();
    return m;
  }

  function buildMultifrontalGrid(gridSize) {
    const solver = new WasmSparseMultifrontalSolver(gridSize * gridSize, gridSize * gridSize);
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
    return solver;
  }

  function denseSymAdjacency(n, connect) {
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      A[i][i] = 2;
      for (let j = i + 1; j < n; j++) {
        if (connect(i, j)) {
          A[i][j] = 1;
          A[j][i] = 1;
        }
      }
    }
    return A;
  }

  // ------------------------------------------------------------------
  // sparse_cholesky.js
  // ------------------------------------------------------------------
  check('SparseMatrixCSR bounds, duplicate merge, finalize/multiplyVector', () => {
    const m = new SparseMatrixCSR(3, 3);
    m.addEntry(-1, 0, 5);
    m.addEntry(0, 3, 5);
    m.addEntry(3, 0, 5);
    assert.strictEqual(m._entries.size, 0);
    m.addEntry(0, 0, 1);
    m.addEntry(0, 0, 2);
    m.addEntry(0, 1, 1);
    m.addEntry(1, 1, 4);
    m.addEntry(2, 2, 9);
    m.finalize();
    assert.strictEqual(m.rowPtr[1], 2);
    assert.strictEqual(m.values[0], 3);
    const y = new Float64Array(3);
    m.multiplyVector(new Float64Array([1, 2, 3]), y);
    assert.strictEqual(y[0], 5);
    assert.strictEqual(y[1], 8);
    const empty = new SparseMatrixCSR(3, 3);
    empty.finalize();
    assert.strictEqual(empty.nnz === undefined || empty.rowPtr[3] === 0, true);
  });

  check('SparseCholeskySolver computeAMDOrdering degree sort', () => {
    const m = new SparseMatrixCSR(3, 3);
    m.addEntry(0, 0, 1);
    m.addEntry(1, 0, 1);
    m.addEntry(1, 1, 1);
    m.addEntry(2, 0, 1);
    m.addEntry(2, 1, 1);
    m.addEntry(2, 2, 1);
    m.finalize();
    const perm = SparseCholeskySolver.computeAMDOrdering(m);
    assert.strictEqual(perm[0], 0);
    assert.deepStrictEqual(Array.from(perm).sort(), [0, 1, 2]);
  });

  check('SparseCholeskySolver.solve preconditioned/unpreconditioned and zero-diag branches', () => {
    const m = buildSparseMatrix(5, 2, 4, -1);
    const b = new Float64Array([1, 2, 3, 4, 5]);
    const r1 = SparseCholeskySolver.solve(m, b, { maxIterations: 200 });
    assert.strictEqual(r1.converged, true);
    const r2 = SparseCholeskySolver.solve(m, b, { preconditioned: false, maxIterations: 500 });
    assert(r2.x && Number.isFinite(r2.x[0]));
    const r3 = SparseCholeskySolver.solve(m, b, { maxIterations: 1 });
    assert.strictEqual(r3.converged, false);
    const zeroDiag = new SparseMatrixCSR(2, 2);
    zeroDiag.addEntry(0, 1, 1);
    zeroDiag.addEntry(1, 0, 1);
    zeroDiag.finalize();
    const r4 = SparseCholeskySolver.solve(zeroDiag, new Float64Array([1, 1]));
    assert.strictEqual(typeof r4.converged, 'boolean');
  });

  check('SparseCholeskySolver.solveBlockTiledOutOfCore options and non-convergence', () => {
    const m = buildSparseMatrix(4, 1, 10, -1);
    const b = new Float64Array(4).fill(1);
    const ok = SparseCholeskySolver.solveBlockTiledOutOfCore(m, b, { blockSize: 2, maxIterations: 300 });
    assert.strictEqual(ok.converged, true);
    const limited = SparseCholeskySolver.solveBlockTiledOutOfCore(m, b, { blockSize: 2, maxIterations: 1 });
    assert.strictEqual(limited.converged, false);
    const def = SparseCholeskySolver.solveBlockTiledOutOfCore(m, b);
    assert.strictEqual(def.converged, true);
  });

  // ------------------------------------------------------------------
  // wasm_sparse_multifrontal.js
  // ------------------------------------------------------------------
  check('WasmSparseMultifrontalSolver addEntry bounds skip and buffer growth', () => {
    const solver = new WasmSparseMultifrontalSolver(40, 40);
    solver.addEntry(-1, 0, 1);
    solver.addEntry(0, 40, 1);
    solver.addEntry(40, 0, 1);
    assert.strictEqual(solver._cnt, 0);
    for (let i = 0; i < 40; i++) {
      solver.addEntry(i, i, 60);
      for (let j = Math.max(0, i - 20); j < i; j++) solver.addEntry(i, j, -1);
      for (let j = i + 1; j <= Math.min(39, i + 20); j++) solver.addEntry(i, j, -1);
    }
    assert(solver._cnt > 1024, 'expected triplet buffer to grow past 1024');
    solver.finalizeCSR();
    assert(solver.nnz > 1024);
    const fact = solver.factorize();
    assert.strictEqual(fact.solverMethod, 'sparse-cholesky');
    const b = new Float64Array(40).fill(1);
    const res = solver.solve(b);
    assert(res.relativeResidual < 1e-8);
  });

  check('WasmSparseMultifrontalSolver structured Poisson triplet and CSR detection paths', () => {
    const tri = buildMultifrontalGrid(3);
    const factTri = tri.factorize();
    assert.strictEqual(factTri.solverMethod, '2d-poisson-dst1');
    assert.strictEqual(tri.factorized, true);
    assert.strictEqual(tri.rowPtr, null);
    const bTri = new Float64Array(9).fill(1);
    const resTri = tri.solve(bTri);
    assert.strictEqual(resTri.success === undefined || resTri.success === true, true);
    assert(resTri.relativeResidual < 1e-8);
    const csr = buildMultifrontalGrid(3);
    csr.finalizeCSR();
    const factCsr = csr.factorize();
    assert.strictEqual(factCsr.solverMethod, '2d-poisson-dst1');
    const resCsr = csr.solve(bTri);
    assert(resCsr.relativeResidual < 1e-8);
  });

  check('WasmSparseMultifrontalSolver structured-disable and non-SPD throw', () => {
    const disabled = buildMultifrontalGrid(4);
    disabled.enableStructuredPoissonDirect = false;
    const fact = disabled.factorize();
    assert.strictEqual(fact.solverMethod, 'sparse-cholesky');
    const indef = new WasmSparseMultifrontalSolver(2, 2);
    indef.addEntry(0, 0, 1);
    indef.addEntry(1, 1, -1);
    assert.throws(() => indef.factorize(), /not symmetric positive definite/);
    const singular = new WasmSparseMultifrontalSolver(2, 2);
    singular.addEntry(0, 0, 1);
    singular.addEntry(0, 1, 1);
    singular.addEntry(1, 0, 1);
    singular.addEntry(1, 1, 1);
    assert.throws(() => singular.factorize(), /not symmetric positive definite/);
  });

  check('WasmSparseMultifrontalSolver nested-dissection BFS/band/leaf branches', () => {
    const solver = new WasmSparseMultifrontalSolver(26, 26);
    solver.denseToCSR(denseSymAdjacency(26, (i, j) => Math.abs(i - j) === 1));
    solver.computeNestedDissectionOrdering();
    assert(solver.permutation && solver.permutation.length === 26);
    const k26 = new WasmSparseMultifrontalSolver(26, 26);
    k26.denseToCSR(denseSymAdjacency(26, () => true));
    k26.computeNestedDissectionOrdering();
    const bipartite = new WasmSparseMultifrontalSolver(26, 26);
    bipartite.denseToCSR(denseSymAdjacency(26, (i, j) => i < 13 !== j < 13));
    bipartite.computeNestedDissectionOrdering();
    const twoComp = new WasmSparseMultifrontalSolver(26, 26);
    twoComp.denseToCSR(denseSymAdjacency(26, (i, j) => (i < 13 && j < 13) || (i >= 13 && j >= 13)));
    twoComp.computeNestedDissectionOrdering();
    const bigLeaf = new WasmSparseMultifrontalSolver(35, 35);
    bigLeaf.leafSize = 40;
    bigLeaf.denseToCSR(denseSymAdjacency(35, () => true));
    const permBig = bigLeaf.computeNestedDissectionOrdering();
    assert.strictEqual(permBig.length, 35);
    assert.strictEqual(bigLeaf.computeAMDOrdering().length, 35);
  });

  check('WasmSparseMultifrontalSolver solveCholesky/denseToCSR paths', () => {
    const s1 = new WasmSparseMultifrontalSolver(3, 3);
    s1.addEntry(0, 0, 4);
    s1.addEntry(0, 1, 1);
    s1.addEntry(1, 0, 1);
    s1.addEntry(1, 1, 3);
    s1.addEntry(1, 2, 1);
    s1.addEntry(2, 1, 1);
    s1.addEntry(2, 2, 2);
    s1.finalizeCSR();
    const b = [1, 2, 3];
    const x1 = s1.solveCholesky(s1, b);
    assert(Number.isFinite(x1[0]));
    const s2 = new WasmSparseMultifrontalSolver(2, 2);
    const x2 = s2.solveCholesky(s1, b);
    assert.strictEqual(x2.length, 3);
    const denseCsr = s2.denseToCSR([
      [4, 1],
      [1, 3]
    ]);
    assert.strictEqual(denseCsr.nnz, 4);
    const solveRhs = denseCsr.solveRhs([1, 2]);
    assert(Number.isFinite(solveRhs[0]));
  });

  // ------------------------------------------------------------------
  // wasm_kernel_engine.js
  // ------------------------------------------------------------------
  check('WasmKernelEngine uninitialized JS fallback kernels', () => {
    const raw = new WasmKernelEngine();
    assert.strictEqual(raw.isReady, false);
    assert.strictEqual(raw.addF64(2, 3), 5);
    const a = new Float64Array([1, 2, 3]);
    const b = new Float64Array([4, 5, 6]);
    assert.strictEqual(raw.dotProduct(a, b), 32);
    const y = new Float64Array([1, 1, 1]);
    raw.daxpy(a, y, 2);
    assert.deepStrictEqual(Array.from(y), [3, 5, 7]);
    assert(Math.abs(raw.vectorNorm(a) - Math.sqrt(14)) < 1e-12);
    const rowPtr = Int32Array.from([0, 2, 3]);
    const colInd = Int32Array.from([0, 1, 1]);
    const values = Float64Array.from([2, 1, 3]);
    const x = new Float64Array([1, 2]);
    const out = new Float64Array(2);
    raw.spmv(rowPtr, colInd, values, x, out, 2);
    assert.deepStrictEqual(Array.from(out), [4, 6]);
  });

  check('WasmKernelEngine initialized SIMD128 and tiled GEMM branches', () => {
    const eng = new WasmKernelEngine();
    assert.strictEqual(eng.initSync(), true);
    const a = new Float64Array([1, 2, 3, 4, 5]);
    const b = new Float64Array([2, 0, 1, 1, 1]);
    assert.strictEqual(eng.dotProductSIMD128(a, b), 14);
    const y = new Float64Array([0, 0, 0, 0, 0]);
    eng.daxpySIMD128(a, y, 2);
    assert.deepStrictEqual(Array.from(y), [2, 4, 6, 8, 10]);
    assert(Math.abs(eng.vectorNormSIMD128(new Float64Array([3, 4])) - 5) < 1e-12);
    const rowPtr = Int32Array.from([0, 3, 5, 6]);
    const colInd = Int32Array.from([0, 1, 2, 0, 2, 1]);
    const values = Float64Array.from([1, 2, 3, 4, 5, 6]);
    const x = new Float64Array([1, 1, 1]);
    const out = new Float64Array(3);
    eng.spmvSIMD128(rowPtr, colInd, values, x, out, 3);
    assert.deepStrictEqual(Array.from(out), [6, 9, 6]);
    const A = Float64Array.from([1, 0, 2, 1, 0, 1, 0, 1, 2, 0, 1, 0, 1, 1, 0, 2]);
    const B = Float64Array.from([1, 0, 1, 0, 0, 2, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0]);
    const C = new Float64Array(16).fill(1);
    eng.matrixMultiplyTiled(A, B, C, 4, 2);
    assert.strictEqual(C[0], 5);
    const C2 = new Float64Array(9);
    eng.matrixMultiplyTiled(
      Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
      Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      C2,
      3
    );
    assert.strictEqual(C2[4], 5);
  });

  check('WasmKernelEngine memory growth and global singleton', () => {
    wasmKernelEngine.initSync();
    const n = 70000;
    const a = new Float64Array(n);
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = i % 7;
      b[i] = (i % 5) + 1;
    }
    const dot = wasmKernelEngine.dotProduct(a, b);
    let expected = 0;
    for (let i = 0; i < n; i++) expected += a[i] * b[i];
    assert(Math.abs(dot - expected) < 1e-6 * Math.abs(expected));
    assert(wasmKernelEngine.memory.buffer.byteLength > 1024 * 1024);
    const rowPtr = Int32Array.from([0, 2, 3, 5]);
    const colInd = Int32Array.from([0, 1, 1, 0, 2]);
    const values = Float64Array.from([1, 1, 2, 1, 3]);
    const x = new Float64Array([1, 2, 3]);
    const out = new Float64Array(3);
    wasmKernelEngine.spmv(rowPtr, colInd, values, x, out, 3);
    assert.deepStrictEqual(Array.from(out), [3, 4, 10]);
  });

  // ------------------------------------------------------------------
  // gpu_parallel_pcg_solver.js
  // ------------------------------------------------------------------
  check('GPUParallelPCGSolver constructor guard branches', () => {
    assert.throws(() => new GPUParallelPCGSolver([]), /must be an object/);
    assert.throws(() => new GPUParallelPCGSolver({ bogus: 1 }), /does not support/);
    assert.throws(() => new GPUParallelPCGSolver({ maxIterations: 1.5 }), /positive integer/);
    assert.throws(() => new GPUParallelPCGSolver({ tolerance: 0 }), /between zero and one/);
    assert.throws(() => new GPUParallelPCGSolver({ tolerance: 1 }), /between zero and one/);
    assert.throws(() => new GPUParallelPCGSolver({ maxWorkers: 2.5 }), /positive integer/);
    const ok = new GPUParallelPCGSolver({ maxIterations: 50, tolerance: 1e-6, useWebGPU: true, maxWorkers: 2 });
    assert.strictEqual(ok.maxIterations, 50);
    assert.strictEqual(ok.useWebGPU, true);
  });

  check('GPUParallelPCGSolver detectWebGPU with navigator', () => {
    const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    try {
      Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
      assert.strictEqual(GPUParallelPCGSolver.detectWebGPU(), true);
    } finally {
      if (prevDesc) Object.defineProperty(globalThis, 'navigator', prevDesc);
      else delete globalThis.navigator;
    }
    assert.strictEqual(
      GPUParallelPCGSolver.detectWebGPU() === true || GPUParallelPCGSolver.detectWebGPU() === false,
      true
    );
  });

  check('GPUParallelPCGSolver solve validation TypeError branches', () => {
    const solver = new GPUParallelPCGSolver({ useSharedArrayBuffer: false });
    assert.throws(() => solver.solve([], []), /PCG requires/);
    assert.throws(
      () =>
        solver.solve(
          [
            [1, 2, 3],
            [4, 5, 6]
          ],
          [1, 2]
        ),
      /must be square/
    );
    assert.throws(
      () =>
        solver.solve(
          [
            [1, NaN],
            [0, 1]
          ],
          [1, 1]
        ),
      /must be finite/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 2], colIdx: [0, 1], values: [1, 1] }, [1, 1]),
      /consistent lengths/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [5, 0], values: [1, 1] }, [1, 1]),
      /valid matrix columns/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [0, 1], values: [1, Infinity] }, [1, 1]),
      /must be finite/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [0, 1], values: [1, 1] }, [1]),
      /right-hand side/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [0, 1], values: [1, 1] }, [1, NaN]),
      /right-hand side/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [0, 1], values: [1, 1] }, [1, 1], [1]),
      /initial guess/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [1, 0], values: [1, 1] }, [1, 1]),
      /finite positive diagonal/
    );
    assert.throws(() => solver.solve({ n: 1, rowPtr: [0, 1], colIdx: [0], values: [1e-320] }, [1]), /overflows/);
  });

  check('GPUParallelPCGSolver termination reasons: curvature, zero rhs, exact x0', () => {
    const solver = new GPUParallelPCGSolver({ useSharedArrayBuffer: false });
    const nonP = solver.solve({ n: 2, rowPtr: [0, 2, 4], colIdx: [0, 1, 0, 1], values: [1, 2, 2, 1] }, [-1, 1]);
    assert.strictEqual(nonP.terminationReason, 'non-positive-curvature');
    const zeroRhs = solver.solve({ n: 2, rowPtr: [0, 2, 4], colIdx: [0, 1, 0, 1], values: [4, 1, 1, 3] }, [0, 0]);
    assert.strictEqual(zeroRhs.converged, true);
    assert.strictEqual(zeroRhs.iterations, 0);
    const exact = solver.solve(
      { n: 2, rowPtr: [0, 2, 4], colIdx: [0, 1, 0, 1], values: [4, 1, 1, 3] },
      [1, 2],
      [0.0909090909, 0.6363636364]
    );
    assert.strictEqual(exact.converged, true);
    assert.strictEqual(exact.terminationReason, 'tolerance-reached');
  });

  check('GPUParallelPCGSolver dense typed-array row and parallel path', () => {
    const solver = new GPUParallelPCGSolver();
    const res = solver.solve([Float64Array.of(4, 1), Float64Array.of(1, 3)], [1, 2]);
    assert(res.solution && res.solution.length === 2);
    assert.strictEqual(typeof res.backend, 'string');
    assert(res.backend === 'cpu-parallel-workerpool' || res.backend === 'cpu-serial-javascript-fallback');
    if (typeof GPUParallelPCGSolver.releaseSharedWorkerPools === 'function')
      GPUParallelPCGSolver.releaseSharedWorkerPools();
  });

  check('GPUParallelPCGSolver shared-pool release is idempotent', async () => {
    if (typeof GPUParallelPCGSolver.releaseSharedWorkerPools === 'function') {
      await GPUParallelPCGSolver.releaseSharedWorkerPools();
      await GPUParallelPCGSolver.releaseSharedWorkerPools();
    }
  });

  // ------------------------------------------------------------------
  // domain_decomposition.js
  // ------------------------------------------------------------------
  check('DomainDecompositionEngine partitionMesh axis and trim branches', () => {
    const nodes = [];
    const elements = [];
    for (let i = 0; i < 8; i++) {
      nodes.push({ x: i, y: i * i, z: i % 2 });
      elements.push([i]);
    }
    const p5 = DomainDecompositionEngine.partitionMesh(nodes, elements, 5);
    assert.strictEqual(p5.subdomains.length, 5);
    assert(p5.loadImbalanceRatio >= 1);
    const nodesY = [];
    const elementsY = [];
    for (let i = 0; i < 6; i++) {
      nodesY.push({ x: 0, y: i * 10, z: 0 });
      elementsY.push([i, (i + 1) % 6]);
    }
    const pY = DomainDecompositionEngine.partitionMesh(nodesY, elementsY, 2);
    assert.strictEqual(pY.subdomains.length, 2);
    const nodesZ = [];
    const elementsZ = [];
    for (let i = 0; i < 6; i++) {
      nodesZ.push({ x: 0, y: 0, z: i * 10 });
      elementsZ.push([i]);
    }
    const pZ = DomainDecompositionEngine.partitionMesh(nodesZ, elementsZ, 3);
    assert.strictEqual(pZ.subdomains.length, 3);
    const single = DomainDecompositionEngine.partitionMesh(nodes, elements, 1);
    assert.strictEqual(single.subdomains.length, 1);
    assert.strictEqual(single.loadImbalanceRatio, 1);
    const schur = DomainDecompositionEngine.evaluateSchurDimensions(p5, 3);
    assert(schur.interfaceDofsCount >= 0);
    assert.strictEqual(schur.schurDimension, schur.interfaceDofsCount);
  });

  // ------------------------------------------------------------------
  // worker_pool.js (ExperimentalCalculationQueue)
  // ------------------------------------------------------------------
  check('ExperimentalCalculationQueue dispatch guards and kernel branches', async () => {
    const q = new ExperimentalCalculationQueue();
    await assert.rejects(() => q.dispatch('', {}), /task type/);
    await assert.rejects(() => q.dispatch('ECHO_TEST', null), /payload object/);
    await assert.rejects(() => q.dispatch('ECHO_TEST', {}, { priority: 'BOGUS' }), /priority/);
    const echo = await q.dispatch('ECHO_TEST', { message: 'hi', delayMs: 5 });
    assert.strictEqual(echo.result.echo, 'hi');
    assert.strictEqual(echo.success, true);
    await assert.rejects(() => q.dispatch('NOPE_KERNEL', {}), /Unsupported experimental task type/);
    const tele = q.getTelemetry();
    assert.strictEqual(tele.completedTasksCount >= 1, true);
    assert.strictEqual(tele.timeoutEnforced, false);
    assert.strictEqual(tele.cancellationSupported, false);
    assert.throws(() => q.allocateSharedBuffer(-1), /non-negative/);
    const sab = q.allocateSharedBuffer(64);
    assert(sab.byteLength >= 64);
    assert.strictEqual(getGlobalWorkerPool().maxWorkers, 1);
  });

  // ------------------------------------------------------------------
  // worker_pool.js (PersistentWorkerPool)
  // ------------------------------------------------------------------
  check('PersistentWorkerPool dispatch guards, shared payload, and cancellation', async () => {
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    await assert.rejects(() => pool.dispatch('', {}), /task type/);
    await assert.rejects(() => pool.dispatch('ECHO_TEST', []), /payload object/);
    const sharedPayload = { message: 'sab', data: new Float64Array([1, 2, 3]) };
    const res = await pool.dispatch('ECHO_TEST', sharedPayload, { useSharedArrayBuffer: true, priority: 'HIGH' });
    assert.strictEqual(res.result.echo, 'sab');
    assert.strictEqual(pool.completedTasksCount, 1);
    const queued = pool.dispatch('ECHO_TEST', { message: 'slow-1', delayMs: 400 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const second = pool.dispatch('ECHO_TEST', { message: 'queued' });
    const secondTask = pool.taskQueue[0];
    assert(secondTask, 'second task should be queued');
    const cancelled = await pool.cancel(secondTask.id);
    assert.strictEqual(cancelled, true);
    await assert.rejects(() => second, /cancelled before execution/);
    assert.strictEqual(await pool.cancel('task_missing_xyz'), false);
    await queued;
    const active = pool.dispatch('ECHO_TEST', { message: 'slow-2', delayMs: 600 });
    while (!pool.workers[0].busy) await new Promise((resolve) => setTimeout(resolve, 10));
    const activeId = pool.workers[0].currentTask.id;
    assert.strictEqual(await pool.cancel(activeId), true);
    await assert.rejects(() => active, /cancelled/);
    assert.throws(() => pool.allocateSharedFloat64Array(-1), /non-negative/);
    const shared = pool.allocateSharedFloat64Array(8);
    assert.strictEqual(shared.length, 8);
    await pool.terminateAll();
    await assert.rejects(() => pool.dispatch('ECHO_TEST', { message: 'after' }), /terminated|cancelled/i);
  });

  check('PersistentWorkerPool SAB materialized transfer completion flag', async () => {
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    const x = new Float64Array([1, 2, 3, 4]);
    const y = new Float64Array([0, 0, 0, 0]);
    const res = await pool.dispatch(
      'WASM_SIMD_BLAS',
      { operation: 'daxpy', x, y, alpha: 2 },
      { useSharedArrayBuffer: true }
    );
    assert.deepStrictEqual(Array.from(res.result.y), [2, 4, 6, 8]);
    const dot = await pool.dispatch(
      'WASM_SIMD_BLAS',
      { operation: 'dotProduct', a: x, b: x },
      { useSharedArrayBuffer: true }
    );
    assert.strictEqual(dot.result.dotProduct, 30);
    await pool.terminateAll();
  });

  check('PersistentWorkerPool timeout floor and global persistent pool', async () => {
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    await assert.rejects(
      () => pool.dispatch('ECHO_TEST', { message: 'slow', delayMs: 10000 }, { timeoutMs: 5 }),
      /maximum execution limit/
    );
    await pool.terminateAll();
    const globalPool = getGlobalPersistentWorkerPool({ maxWorkers: 1 });
    assert(globalPool instanceof PersistentWorkerPool);
    await globalPool.terminateAll();
  });

  // ------------------------------------------------------------------
  // worker_thread_kernel.js protocol
  // ------------------------------------------------------------------
  function startKernelWorker() {
    const worker = new Worker(KERNEL_SCRIPT);
    const pendingResponse = new Map();
    worker.on('message', (msg) => {
      const key = msg.taskId || msg.type;
      const handler = pendingResponse.get(key);
      if (handler) {
        pendingResponse.delete(key);
        handler.resolve(msg);
      }
    });
    worker.on('error', (err) => {
      for (const handler of pendingResponse.values()) handler.reject(err);
      pendingResponse.clear();
    });
    return {
      worker,
      send(payload) {
        const key = payload.taskId || (payload.type === 'PING' ? 'PONG' : payload.type);
        return new Promise((resolve, reject) => {
          pendingResponse.set(key, { resolve, reject });
          worker.postMessage(payload);
        });
      }
    };
  }

  check('worker_thread_kernel PING/CANCEL/sabCompletion/error protocol', async () => {
    const kernel = startKernelWorker();
    try {
      const pong = await kernel.send({ type: 'PING' });
      assert.strictEqual(pong.type, 'PONG');
      const echo = await kernel.send({
        type: 'EXECUTE',
        taskId: 'k-echo',
        taskType: 'ECHO_TEST',
        payload: { message: 'kernel-ok', delayMs: 20 }
      });
      assert.strictEqual(echo.type, 'RESULT');
      assert.strictEqual(echo.result.echo, 'kernel-ok');
      const unsupported = await kernel.send({
        type: 'EXECUTE',
        taskId: 'k-bad',
        taskType: 'NOT_A_KERNEL',
        payload: {}
      });
      assert.strictEqual(unsupported.type, 'ERROR');
      assert.strictEqual(unsupported.error.code, 'UNSUPPORTED');
      const malformed = await kernel.send({
        type: 'EXECUTE',
        taskId: 'k-malformed',
        taskType: 'PCG_SPMV_PARTIAL',
        payload: {
          startRow: -1,
          endRow: 1,
          rowPtr: new Int32Array(2),
          colIdx: new Int32Array(0),
          values: new Float64Array(0),
          x: new Float64Array(1)
        }
      });
      assert.strictEqual(malformed.type, 'ERROR');
      assert.strictEqual(malformed.error.code, 'INVALID_INPUT');
      const flags = new Int32Array(new SharedArrayBuffer(4));
      const rowPtr = Int32Array.from([0, 2, 3]);
      const colIdx = Int32Array.from([0, 1, 1]);
      const values = Float64Array.from([4, 1, 3]);
      const x = new Float64Array(new SharedArrayBuffer(3 * 8));
      x.set([1, 2, 0]);
      const y = new Float64Array(new SharedArrayBuffer(3 * 8));
      const partial = await kernel.send({
        type: 'EXECUTE',
        taskId: 'k-partial',
        taskType: 'PCG_SPMV_PARTIAL',
        payload: { rowPtr, colIdx, values, x, y, startRow: 0, endRow: 1, flags, flagIndex: 0 },
        sabCompletion: { flags, flagIndex: 0 }
      });
      assert.strictEqual(partial.type, 'RESULT');
      assert.strictEqual(partial.result.rowsComputed, 1);
      assert.strictEqual(y[0], 6);
      assert.strictEqual(Atomics.load(flags, 0), 1);
      const slow = kernel.send({
        type: 'EXECUTE',
        taskId: 'k-slow',
        taskType: 'ECHO_TEST',
        payload: { message: 'cancel-me', delayMs: 800 }
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      kernel.worker.postMessage({ type: 'CANCEL', taskId: 'k-slow' });
      const cancelled = await slow;
      assert.strictEqual(cancelled.type, 'CANCELLED');
    } finally {
      await kernel.worker.terminate();
    }
  });

  // ------------------------------------------------------------------
  // ode_solvers.js
  // ------------------------------------------------------------------
  check('ODESolvers.solveRK4 forms and step guards', () => {
    const f = (t, y) => [y[1], -y[0]];
    const arr = ODESolvers.solveRK4(f, [1, 0], 0, 1);
    assert(arr.length >= 1);
    const classic = ODESolvers.solveRK4(f, 0, [1, 0], 0.01, 20);
    assert.strictEqual(classic.length, 21);
    assert.throws(() => ODESolvers.solveRK4(f, [1, 0], 0, 1, -1), /positive time step/);
    assert.throws(() => ODESolvers.solveRK4(f, 0, [1, 0], -0.1, 10), /positive time step/);
    assert.deepStrictEqual(ODESolvers.rk4(f, 0, [1], 0.1, 2)[0].y, [1]);
  });

  check('ODESolvers.solveRK45 defaults and clamps', () => {
    const f = (t, y) => [-y[0]];
    const arrForm = ODESolvers.solveRK45(f, [1], 0, 1);
    assert(arrForm[arrForm.length - 1].t > 0.99);
    const classic = ODESolvers.solveRK45(f, 0, [1], 1, 1e-8, 1e-4);
    assert(classic[classic.length - 1].t > 0.99);
    const linear = ODESolvers.solveRK45((t, y) => [1], [0], 0, 0.5);
    assert(Math.abs(linear[linear.length - 1].y[0] - 0.5) < 1e-6);
  });

  check('ODESolvers.bdf1Stiff converged and failure branches', () => {
    const f = (t, y) => [-2 * y[0]];
    const jac = () => [[-2]];
    const traj = ODESolvers.bdf1Stiff(f, jac, 0, [1], 0.05, 10);
    assert.strictEqual(traj.length, 11);
    assert(traj[traj.length - 1].y[0] > 0.3);
    assert.throws(
      () =>
        ODESolvers.bdf1Stiff(
          () => [NaN],
          () => [[0]],
          0,
          [1],
          0.1,
          5
        ),
      /failed to converge/
    );
  });

  check('RadauIIA statics, scalar state, and option mapping', () => {
    assert.strictEqual(RadauIIA.ORDER, 5);
    assert.strictEqual(RadauIIA.C.length, 3);
    assert.strictEqual(RadauIIA.A.length, 3);
    const traj = ODESolvers.solveRadauIIA((t, y) => [-y], 0, 1, 1.0, { rtol: 1e-8, atol: 1e-10 });
    assert(traj[traj.length - 1].t > 0.99);
    const sc = ODESolvers.solveRadauIIA((t, y) => [y[1], -y[0]], 0, [1, 0], 0.5);
    assert(sc[sc.length - 1].t > 0.49);
    const custom = new RadauIIA({
      safety: 0.85,
      minFactor: 0.15,
      maxFactor: 4,
      maxSteps: 2000,
      newtonMaxIter: 12,
      newtonTol: 1e-8
    });
    const res = custom.solve((t, y) => [-y[0]], 0, [2], 0.4);
    assert(res[res.length - 1].t > 0.39);
    assert.throws(() => ODESolvers.solveRadauIIA((t, y) => [0], 1, [1], 0), /t0 <= tEnd/);
    assert.throws(() => ODESolvers.solveRadauIIA((t, y) => [0], 0, [1], 1, { rtol: 0 }), /positive rtol/);
    assert.throws(() => ODESolvers.solveRadauIIA((t, y) => [0], 0, [1], 1, { h0: -1 }), /positive initial step/);
    assert.throws(() => ODESolvers.solveRadauIIA((t, y) => [0], 0, 'bad', 1), /initial state/);
  });

  // ------------------------------------------------------------------
  // linear_algebra.js
  // ------------------------------------------------------------------
  check('Vector3/Quaternion degenerate branches', () => {
    const zero = new Vector3(0, 0, 0).normalize();
    assert.deepStrictEqual(zero.toArray(), [0, 0, 0]);
    assert.strictEqual(new Vector3(1, 2, 3).lengthSq(), 14);
    const q = new Quaternion(0, 0, 0, 0).normalize();
    assert.strictEqual(q.w, 0);
    assert.strictEqual(q.x, 0);
    const axis = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 0), 1.2);
    assert(Math.abs(axis.w - 1) < 1e-12);
    assert.strictEqual(axis.x, 0);
    const gimbal = new Quaternion(Math.SQRT1_2, 0, Math.SQRT1_2, 0).toEuler();
    assert.strictEqual(gimbal.pitch, Math.PI / 2);
    const eu = Quaternion.fromEuler(0.1, 0.2, 0.3);
    assert(eu.toEulerAngles().roll >= -Math.PI);
  });

  check('LinearSolver.solveGaussian singular throw', () => {
    assert.throws(
      () =>
        LinearSolver.solveGaussian(
          [
            [1, 1],
            [1, 1]
          ],
          [1, 2]
        ),
      /singular/
    );
    const x = LinearSolver.solveGaussian(
      [
        [4, 1],
        [1, 3]
      ],
      [1, 2]
    );
    assert(Math.abs(x[0] - 0.0909090909) < 1e-6);
  });

  check('LinearSolver.solveConjugateGradient early-exit and break branches', () => {
    const A = [
      [4, 1],
      [1, 3]
    ];
    const exact = LinearSolver.solveConjugateGradient(A, [1, 2], [0.0909090909, 0.6363636364], 10, 1e-6);
    assert(Math.hypot(exact[0] - 0.0909090909, exact[1] - 0.6363636364) < 1e-4);
    const zero = LinearSolver.solveConjugateGradient(
      [
        [0, 0],
        [0, 0]
      ],
      [1, 2]
    );
    assert.deepStrictEqual(zero, [0, 0]);
  });

  check('LinearSolver._toSparseSolver input type branches', () => {
    const csrLike = LinearSolver._toSparseSolver({ nRows: 2, rowPtr: [0, 2, 3], colInd: [0, 1, 1], values: [4, 1, 3] });
    assert.strictEqual(csrLike.n, 2);
    const flat = LinearSolver._toSparseSolver(Float64Array.of(4, 1, 1, 3));
    assert.strictEqual(flat.n, 2);
    assert.throws(() => LinearSolver._toSparseSolver(Float64Array.of(1, 2, 3, 4, 5)), /must be square/);
    assert.throws(() => LinearSolver._toSparseSolver('nope'), /expects a/);
  });

  check('LinearSolver.solveSparse fallback and failure branches', () => {
    const spd = LinearSolver.solveSparse(
      [
        [4, 1],
        [1, 3]
      ],
      [1, 2]
    );
    assert.strictEqual(spd.method, 'sparse-cholesky');
    assert(spd.relativeResidual < 1e-8);
    const asy = LinearSolver.solveSparse(
      [
        [1, 2],
        [3, 4]
      ],
      [1, 2]
    );
    assert.strictEqual(asy.method, 'dense-lu');
    assert(asy.solution && Number.isFinite(asy.solution[0]));
    assert.throws(() => LinearSolver.solveSparse('bad', [1]), /unsupported matrix type/);
    assert.throws(
      () =>
        LinearSolver.solveSparse(
          [
            [1, 1],
            [1, 1]
          ],
          [1, 2]
        ),
      /NUMERICAL_FAILURE|failed/
    );
  });

  check('LinearSolver.isPositiveDefinite diagnostic branches', () => {
    const spd = LinearSolver.isPositiveDefinite([
      [4, 1],
      [1, 3]
    ]);
    assert.strictEqual(spd.positiveDefinite, true);
    assert.strictEqual(spd.factorizationOutcome, 'spd');
    const ind = LinearSolver.isPositiveDefinite([
      [1, 2],
      [2, 1]
    ]);
    assert.strictEqual(ind.positiveDefinite, false);
    assert.strictEqual(ind.symmetric, true);
    const zero = LinearSolver.isPositiveDefinite([
      [0, 0],
      [0, 0]
    ]);
    assert.strictEqual(zero.positiveDefinite, false);
    assert.strictEqual(zero.symmetric, true);
    assert.strictEqual(zero.diagonallyDominant, true);
    const bad = LinearSolver.isPositiveDefinite('nope');
    assert.strictEqual(bad.positiveDefinite, false);
    assert.strictEqual(bad.factorizationOutcome, 'failed');
  });

  // ------------------------------------------------------------------
  // native_accelerator_interface.js
  // ------------------------------------------------------------------
  check('NativeAcceleratorInterface gemm beta/alpha/unroll branches', () => {
    const acc = new NativeAcceleratorInterface();
    const M = 5,
      N = 3,
      K = 4;
    const A = Float64Array.from([1, 0, 2, 1, 0, 1, 0, 1, 2, 0, 1, 0, 1, 1, 0, 2, 0, 0, 1, 1]);
    const B = Float64Array.from([1, 0, 1, 0, 2, 1, 1, 0, 0, 1, 1, 1]);
    const C = new Float64Array(M * N).fill(7);
    acc.gemm(M, N, K, 2, A, B, 0, C);
    let expected = 0;
    for (let k = 0; k < K; k++) expected += A[0 * K + k] * B[k * N + 0];
    assert.strictEqual(C[0], 2 * expected);
    const C2 = new Float64Array(M * N).fill(1);
    acc.gemm(M, N, K, 1, A, B, 2, C2);
    assert.strictEqual(C2[0], 2 + expected);
    const C3 = new Float64Array(1);
    acc.gemm(1, 1, 1, 1, Float64Array.of(3), Float64Array.of(4), 0, C3);
    assert.strictEqual(C3[0], 12);
    const C4 = new Float64Array(4);
    acc.gemm(2, 2, 2, 1, Float64Array.of(1, 0, 0, 1), Float64Array.of(1, 0, 0, 1), 1, C4);
    assert.strictEqual(C4[0], 1);
  });

  check('NativeAcceleratorInterface JS fallback loops and backend info', () => {
    const acc = new NativeAcceleratorInterface();
    acc.wasmEngine = null;
    const x = new Float64Array([1, 2, 3]);
    const y = new Float64Array([1, 1, 1]);
    acc.axpy(2, x, y);
    assert.deepStrictEqual(Array.from(y), [3, 5, 7]);
    const out = new Float64Array(3);
    acc.spmv(
      {
        rows: 3,
        rowPtr: Int32Array.from([0, 2, 3, 5]),
        colInd: Int32Array.from([0, 1, 1, 0, 2]),
        values: Float64Array.from([1, 2, 3, 4, 5])
      },
      x,
      out
    );
    assert.deepStrictEqual(Array.from(out), [5, 6, 19]);
    const y2 = acc.spmv(
      {
        rows: 2,
        rowPtr: Int32Array.from([0, 1, 2]),
        colInd: Int32Array.from([0, 1]),
        values: Float64Array.from([2, 3])
      },
      new Float64Array([1, 1])
    );
    assert.strictEqual(y2.length, 2);
    assert.strictEqual(acc.dot(new Float64Array([1, 2]), new Float64Array([3, 4])), 11);
    assert.strictEqual(acc.dot(new Float64Array([1, 2, 3]), new Float64Array([1, 1, 1])), 6);
    const info = acc.getBackendInfo();
    assert(
      info.activeTier === 'js_typedarrays' ||
        info.activeTier === 'wasm_simd128' ||
        info.activeTier === 'wasm_scalar' ||
        info.activeTier === 'native_napi'
    );
    assert.strictEqual(typeof info.simdCapabilities, 'object');
    const singleton = accelerator.getBackendInfo();
    assert(singleton.activeTier.startsWith('wasm_') || singleton.activeTier.startsWith('js_'));
  });

  // ------------------------------------------------------------------
  // poisson_2d_direct.js
  // ------------------------------------------------------------------
  check('Poisson2DDirichletDirectSolver constructor and solve guards', () => {
    assert.throws(() => new Poisson2DDirichletDirectSolver(0), /positive integer/);
    assert.throws(() => new Poisson2DDirichletDirectSolver(2.5), /positive integer/);
    const p = new Poisson2DDirichletDirectSolver(4);
    assert.throws(() => p.solve(new Float64Array(3)), /exactly 16/);
    assert.throws(
      () => p.solve(Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, NaN])),
      /must be finite/
    );
  });

  check('Poisson2DDirichletDirectSolver even/odd grids', () => {
    for (const g of [2, 3, 5]) {
      const solver = new Poisson2DDirichletDirectSolver(g);
      const b = new Float64Array(g * g).fill(1);
      const res = solver.solve(b);
      assert(res.relativeResidual < 1e-10, `grid ${g} residual ${res.relativeResidual}`);
      assert.strictEqual(res.solverMethod, '2d-poisson-dst1');
    }
  });

  // ------------------------------------------------------------------
  // matrix_market_suite.js
  // ------------------------------------------------------------------
  check('parseMatrixMarket header/format/field error branches', () => {
    assert.throws(() => parseMatrixMarket(''), /missing header/);
    assert.throws(() => parseMatrixMarket('%%MatrixMarket foo matrix coordinate real general'), /unsupported header/);
    assert.throws(() => parseMatrixMarket('%%MatrixMarket matrix X real general'), /unsupported format/);
    assert.throws(() => parseMatrixMarket('%%MatrixMarket matrix coordinate complex general'), /complex field/);
    assert.throws(() => parseMatrixMarket('%%MatrixMarket matrix coordinate real general\n% comment'), /missing size/);
    assert.throws(
      () => parseMatrixMarket('%%MatrixMarket matrix coordinate real general\n2 2 4\n1 1 a\n'),
      /bad entry line/
    );
  });

  check('parseMatrixMarket coordinate symmetric/pattern mirrors', () => {
    const coord = parseMatrixMarket('%%MatrixMarket matrix coordinate real symmetric\n2 2 2\n1 1 4\n2 1 5\n');
    assert.strictEqual(coord.format, 'coordinate');
    assert.strictEqual(coord.nRows, 2);
    assert.strictEqual(coord.nnz, 2);
    assert.strictEqual(coord.entries.length, 4);
    const mirrored = coord.entries.find((e) => e.i === 0 && e.j === 1);
    assert.strictEqual(mirrored.v, 5);
    const pat = parseMatrixMarket('%%MatrixMarket matrix coordinate pattern general\n2 2 1\n2 1\n');
    assert.strictEqual(pat.entries.length, 2);
    assert(pat.entries.every((e) => e.v === 1));
  });

  check('parseMatrixMarket array general/symmetric/skew formats', () => {
    const gen = parseMatrixMarket('%%MatrixMarket matrix array real general\n2 2\n1\n2\n3\n4\n');
    assert.strictEqual(gen.dense[0][0], 2);
    assert.strictEqual(gen.dense[1][0], 2);
    assert.strictEqual(gen.dense[0][1], 1);
    assert.strictEqual(gen.dense[1][1], 2);
    assert.strictEqual(gen.entries.length, 4);
    const sym = parseMatrixMarket('%%MatrixMarket matrix array real symmetric\n2 2\n1\n2\n3\n');
    assert.strictEqual(sym.dense[0][1], 2);
    assert.strictEqual(sym.dense[1][0], 2);
    const skew = parseMatrixMarket('%%MatrixMarket matrix array real skew-symmetric\n3 3\n0\n1\n2\n0\n3\n0\n');
    assert.strictEqual(skew.dense[0][0], 0);
    assert.strictEqual(skew.dense[1][0], 3);
    assert.strictEqual(skew.dense[0][1], -3);
    assert.strictEqual(skew.dense[2][1], 2);
    const dense = parseMatrixMarket('%%MatrixMarket matrix array real general\n2 2\n1\n0\n0\n1\n');
    assert.strictEqual(dense.entries.length, 3);
  });

  check('matrix_market_suite load/solve/run helpers', () => {
    const bundled = loadBundledMatrices();
    assert.strictEqual(bundled.length, 3);
    assert.strictEqual(typeof resolveSuiteDirectory(), 'string');
    const parsed = parseMatrixMarket(
      '%%MatrixMarket matrix coordinate real symmetric\n4 4 5\n1 1 4\n1 2 1\n2 2 3\n2 4 1\n3 3 2\n'
    );
    const solved = solveWithProductionSolver(parsed);
    assert(solved.residual.relativeEuclidean < 1e-6);
    assert(solved.forwardError.relative < 1e-6);
    const suite = runMatrixMarketSuite({ tolerance: 1e-6 });
    assert.strictEqual(suite.id, 'NIST_MATRIX_MARKET_SUITE');
    assert.strictEqual(suite.measured.matrices.length, 3);
    assert.strictEqual(typeof suite.passed, 'boolean');
    assert(suite.calculatedValue === null || suite.calculatedValue <= 1e-6);
  });

  // ------------------------------------------------------------------
  // hpc_cluster_gateway.js facade
  // ------------------------------------------------------------------
  check('HpcClusterGateway static facade branches', () => {
    const slurm = HpcClusterGateway.generateSlurmScript({ jobName: 'cov25', solverExecutable: '/bin/omnieng' });
    assert.strictEqual(slurm.executable, '/bin/omnieng');
    assert(slurm.script.includes('/bin/omnieng'));
    const dual = HpcClusterGateway.generateSlurmScript({ jobName: 'j', solverExecutable: 'a', executable: 'b' });
    assert.strictEqual(dual.executable, 'b');
    assert.throws(() => HpcClusterGateway.generateSlurmScript('string'), /job spec object/);
    const pbs = HpcClusterGateway.generatePbsScript({ jobName: 'p1', walltime: '01:00:00' });
    assert.strictEqual(pbs.scheduler, 'PBS_PRO');
    const rcb = HpcClusterGateway.partitionRcb(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 }
      ],
      2
    );
    assert.strictEqual(rcb.numPartitions, 2);
    assert.deepStrictEqual(HpcClusterGateway.partitionRcb([], 4), []);
    const plan = HpcClusterGateway.planOutOfCoreFrontal(1e6, 1e9, {
      matrixNonzerosPerDof: 20,
      factorEntriesPerDof: 40
    });
    assert.strictEqual(plan.status, 'ESTIMATE_ONLY');
    assert.strictEqual(plan.solvePerformed, false);
    assert.throws(
      () => HpcClusterGateway.planOutOfCoreFrontal(0, 1e9, { matrixNonzerosPerDof: 1, factorEntriesPerDof: 1 }),
      /Provide positive/
    );
    assert.strictEqual(typeof HpcClusterGateway.VERSION, 'string');
    assert.strictEqual(typeof HpcClusterGateway.JobState, 'object');
    assert(JOB_STATES.QUEUED === 'QUEUED');
  });

  check('HpcClusterGateway instance lifecycle and telemetry', async () => {
    const gw = new HpcClusterGateway({ provider: 'test-provider', active: false });
    assert.strictEqual(gw.provider, 'test-provider');
    assert.strictEqual(gw.active, false);
    gw.active = true;
    assert.strictEqual(gw.active, true);
    const job = gw.submitJob({
      jobName: 'cov25',
      scheduler: 'SLURM',
      nodes: 2,
      ntasksPerNode: 8,
      walltime: '01:00:00'
    });
    assert.strictEqual(job.status, JOB_STATES.QUEUED);
    const sim = gw.submitSimulationJob('fea', { case: 'c1' }, 4);
    assert.strictEqual(sim.success, true);
    assert.strictEqual(sim.status, 'QUEUED');
    gw.markRunning(job.jobId);
    assert.strictEqual(gw.getJob(job.jobId).status, 'RUNNING');
    gw.markCompleted(job.jobId);
    assert.strictEqual(gw.getJob(job.jobId).status, 'COMPLETED');
    assert.throws(() => gw.markRunning(job.jobId), /Illegal HPC job transition/);
    const failJob = gw.submitJob({ jobName: 'fail', scheduler: 'PBS_PRO' });
    gw.failJob(failJob.jobId, new Error('boom'));
    assert.strictEqual(gw.getJob(failJob.jobId).error.message, 'boom');
    const failPlain = gw.submitJob({ jobName: 'fail2', scheduler: 'PBS_PRO' });
    gw.failJob(failPlain.jobId, 'plain');
    assert.strictEqual(gw.getJob(failPlain.jobId).error, 'plain');
    assert.throws(() => gw.markRunning('nope'), /Unknown HPC job id/);
    assert.throws(() => gw.getJob('missing'), /Unknown HPC job id/);
    assert.strictEqual(gw.listJobs({ status: 'COMPLETED', scheduler: 'SLURM' }).length, 1);
    assert.strictEqual(gw.listJobs({ status: 'FAILED' }).length, 2);
    assert.strictEqual(gw.listJobs().length, 4);
    assert.strictEqual(gw.jobs.size, 4);
    const tele = gw.getTelemetry();
    assert.strictEqual(tele.provider, 'test-provider');
    assert.strictEqual(tele.jobs.byState.COMPLETED, 1);
    assert.strictEqual(tele.jobs.byState.FAILED, 2);
    assert.strictEqual(gw.getClusterStatus().status, 'READY');
    const membership = gw.setMembership(false);
    assert.strictEqual(membership.active, false);
    assert.strictEqual(gw.getClusterStatus().status, 'OFFLINE');
    const pool = getGlobalPersistentWorkerPool();
    await pool.terminateAll();
  });

  const pendingSettled = await Promise.race([
    Promise.all(pending).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 90000))
  ]);
  passedTests += asyncOutcomes.filter((outcome) => outcome === 'pass').length;
  failedTests += asyncOutcomes.filter((outcome) => outcome === 'fail').length;
  if (!pendingSettled) {
    const unresolved = pending.length - asyncOutcomes.length;
    failedTests += unresolved;
    console.error(`  ✗ WARN: timed out waiting for ${unresolved} pending checks; marking them failed`);
  }

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapTwentyFiveCoverageTests };

if (require.main === module) {
  runBranchGapTwentyFiveCoverageTests().then((stats) => {
    console.log(`gap25: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
