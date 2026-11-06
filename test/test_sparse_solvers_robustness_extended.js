/**
 * SPARSE_SOLVERS_ROBUSTNESS_EXTENDED
 *
 * Independent robustness suite for the production sparse solver surface:
 *
 *   1. src/core/math/wasm_sparse_multifrontal.js
 *      - WasmSparseMultifrontalSolver: sparse direct Cholesky (nested
 *        dissection ordering) plus a separable DST-I fast path for uniform
 *        2D Poisson operators. factorize() throws a plain Error on a
 *        non-positive pivot; solve() auto-factorizes. Structured Poisson
 *        solves return the raw Poisson2DDirichletDirectSolver result.
 *   2. src/core/math/sparse_cholesky.js
 *      - SparseCholeskySolver.solve: Jacobi-preconditioned CG (iterative,
 *        no factorization). Returns {x, converged, iterations, residualNorm}
 *        and does NOT throw on degenerate systems; it reports converged=false.
 *      - SparseCholeskySolver.solveBlockTiledOutOfCore: relaxed block
 *        Gauss-Seidel (used by the worker queue path).
 *   3. src/core/math/wasm_kernel_engine.js
 *      - WasmKernelEngine: WASM CSR spmv kernel (cross-checked against a
 *        naive JS matvec).
 *   4. src/core/math/worker_pool.js
 *      - PersistentWorkerPool (worker_threads) and ExperimentalCalculationQueue
 *        (in-process legacy queue).
 *
 * What this suite exercises that the existing suites do not:
 *   - assembled 2D Poisson stencils at several sizes through BOTH the
 *     structured DST-I path and the general sparse Cholesky path (diagonal
 *     perturbation forces the general path),
 *   - tridiagonal SPD systems of size 8/32/128/512,
 *   - an ill-conditioned SPD scaled Laplacian (kappa ~ 1e8),
 *   - fail-closed behavior for zero, negative-definite, singular, and
 *     symmetric-indefinite inputs (typed-error or failure-flag assertions),
 *   - the worker-pool path (PersistentWorkerPool spmv dispatch +
 *     ExperimentalCalculationQueue out-of-core sparse solve),
 *   - determinism of repeated solves on identical seeded inputs.
 *
 * Honest findings documented by this suite:
 *   - PersistentWorkerPool task type 'SPARSE_CHOLESKY' always rejects: the
 *     worker kernel calls WasmSparseMultifrontalSolver.factorizeAndSolve(),
 *     which does not exist on the production class (documented gap; sparse
 *     SOLVE dispatch through the real worker pool is therefore unavailable).
 *   - SparseCholeskySolver.solve (PCG) fails CLOSED via its converged flag
 *     rather than by throwing; on large tridiagonal systems it can stop
 *     early with converged=false at a small-but-true residual even though
 *     the returned solution is accurate (the pAp < 1e-20 break path).
 *   - WasmSparseMultifrontalSolver.factorize() throws a plain Error (not an
 *     OmniError) on non-SPD input; it fails closed, but the error type is
 *     an untyped Error.
 *
 * All inputs are deterministic; no Math.random() is used.
 */

'use strict';

const assert = require('node:assert');

const { WasmSparseMultifrontalSolver } = require('../src/core/math/wasm_sparse_multifrontal');
const { SparseCholeskySolver, SparseMatrixCSR } = require('../src/core/math/sparse_cholesky');
const { WasmKernelEngine } = require('../src/core/math/wasm_kernel_engine');
const { PersistentWorkerPool, ExperimentalCalculationQueue } = require('../src/core/math/worker_pool');

const REL_RES_TOL = 1e-10;
const SOL_ABS_TOL = 1e-8;

let passedChecks = 0;
let failedChecks = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passedChecks++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failedChecks++;
    failures.push({ name, message: err.message });
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

function approxEqual(actual, expected, tol, label) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: |${actual} - ${expected}| = ${Math.abs(actual - expected)} > ${tol}`
  );
}

function maxAbsDiff(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  return d;
}

function arraysIdentical(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function makeSystem(n, entries, xExact) {
  const b = new Float64Array(n);
  for (const [i, j, v] of entries) b[i] += v * xExact[j];
  return { n, entries, xExact, b };
}

function buildTridiagonalSystem(n, perturbDiag) {
  const entries = [];
  for (let i = 0; i < n; i++) {
    entries.push([i, i, 2 + (perturbDiag ? 1e-9 : 0)]);
    if (i > 0) {
      entries.push([i, i - 1, -1]);
      entries.push([i - 1, i, -1]);
    }
  }
  const xExact = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xExact[i] = Math.sin((3 * Math.PI * (i + 1)) / (n + 1)) + 0.5 * Math.sin((7 * Math.PI * (i + 1)) / (n + 1));
  }
  return makeSystem(n, entries, xExact);
}

function buildPoisson2DSystem(g, perturbDiag) {
  const n = g * g;
  const entries = [];
  for (let y = 0; y < g; y++) {
    for (let x = 0; x < g; x++) {
      const i = y * g + x;
      entries.push([i, i, 4 + (perturbDiag ? 1e-9 : 0)]);
      if (x > 0) {
        entries.push([i, i - 1, -1]);
        entries.push([i - 1, i, -1]);
      }
      if (y > 0) {
        entries.push([i, i - g, -1]);
        entries.push([i - g, i, -1]);
      }
    }
  }
  const xExact = new Float64Array(n);
  for (let y = 0; y < g; y++) {
    for (let x = 0; x < g; x++) {
      const i = y * g + x;
      xExact[i] =
        Math.sin((Math.PI * (x + 1)) / (g + 1)) * Math.sin((Math.PI * (y + 1)) / (g + 1)) +
        0.25 * Math.sin((2 * Math.PI * (x + 1)) / (g + 1)) * Math.cos((Math.PI * (y + 1)) / (g + 1));
    }
  }
  return makeSystem(n, entries, xExact);
}

function toWasmSolver(sys) {
  const s = new WasmSparseMultifrontalSolver(sys.n, sys.n);
  for (const [i, j, v] of sys.entries) s.addEntry(i, j, v);
  s.finalizeCSR();
  return s;
}

function toCsrMatrix(sys) {
  const m = new SparseMatrixCSR(sys.n, sys.n);
  for (const [i, j, v] of sys.entries) m.addEntry(i, j, v);
  m.finalize();
  return m;
}

function denseToWasm(A) {
  const n = A.length;
  const s = new WasmSparseMultifrontalSolver(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (Math.abs(A[i][j]) > 1e-15) s.addEntry(i, j, A[i][j]);
    }
  }
  s.finalizeCSR();
  return s;
}

function naiveMatvec(rowPtr, colIdx, values, x, nRows) {
  const y = new Float64Array(nRows);
  for (let r = 0; r < nRows; r++) {
    let sum = 0;
    for (let p = rowPtr[r]; p < rowPtr[r + 1]; p++) sum += values[p] * x[colIdx[p]];
    y[r] = sum;
  }
  return y;
}

function estimateConditionNumber(solver, sys) {
  const n = sys.n;
  const lamMax = (v) => {
    const w = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      let sum = 0;
      for (let p = solver.rowPtr[r]; p < solver.rowPtr[r + 1]; p++) {
        sum += solver.values[p] * v[solver.colIdx[p]];
      }
      w[r] = sum;
    }
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += v[i] * w[i];
      den += v[i] * v[i];
    }
    const nrm = Math.sqrt(w.reduce((s2, x) => s2 + x * x, 0)) || 1;
    for (let i = 0; i < n; i++) v[i] = w[i] / nrm;
    return den > 0 ? num / den : 0;
  };
  const lamMin = (v) => {
    const w = solver.solve(v).solution;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += v[i] * w[i];
      den += v[i] * v[i];
    }
    const nrm = Math.sqrt(w.reduce((s2, x) => s2 + x * x, 0)) || 1;
    for (let i = 0; i < n; i++) v[i] = w[i] / nrm;
    return den > 0 ? num / den : 0;
  };
  const v1 = new Float64Array(n);
  v1.fill(1);
  let lambdaMax = 0;
  for (let it = 0; it < 40; it++) lambdaMax = lamMax(v1);
  const v2 = new Float64Array(n);
  v2.fill(1);
  let lambdaMin = 0;
  for (let it = 0; it < 40; it++) lambdaMin = lamMin(v2);
  return lambdaMin > 0 ? lambdaMax / lambdaMin : Infinity;
}

// ---------------------------------------------------------------------------
// Section A: structured DST-I path on uniform 2D Poisson stencils
// ---------------------------------------------------------------------------
async function sectionAStructuredPoisson() {
  console.log('[A] Structured DST-I path (uniform 2D Poisson stencils)');
  for (const g of [3, 6, 12, 24]) {
    const sys = buildPoisson2DSystem(g, false);
    const label = `g=${g} n=${sys.n}`;
    await check(`A structured poisson ${label}: factorize reports DST path`, () => {
      const s = toWasmSolver(sys);
      const f = s.factorize();
      assert.strictEqual(f.solverMethod, '2d-poisson-dst1', 'expected structured DST solver method');
      assert.strictEqual(f.nnzL, null, 'structured path does not build sparse L');
    });
    await check(`A structured poisson ${label}: residual < 1e-10, solution matches analytic field`, () => {
      const s = toWasmSolver(sys);
      s.factorize();
      const res = s.solve(sys.b);
      assert.ok(res.relativeResidual < REL_RES_TOL, `relative residual ${res.relativeResidual} >= ${REL_RES_TOL}`);
      assert.ok(res.converged === true, 'structured solve must report converged');
      const err = maxAbsDiff(res.solution, sys.xExact);
      assert.ok(err < SOL_ABS_TOL, `max |x - x_exact| = ${err} >= ${SOL_ABS_TOL}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Section B: general sparse Cholesky path (perturbed stencils, tridiagonal)
// ---------------------------------------------------------------------------
async function sectionBGeneralSparseCholesky() {
  console.log('[B] General sparse Cholesky path (nested dissection + up-looking L)');
  for (const n of [8, 32, 128, 512]) {
    const sys = buildTridiagonalSystem(n, true);
    const label = `tridiag n=${n}`;
    await check(`B ${label}: factorize reports sparse-cholesky with finite fill`, () => {
      const s = toWasmSolver(sys);
      const f = s.factorize();
      assert.strictEqual(f.solverMethod, 'sparse-cholesky', 'expected general sparse Cholesky path');
      assert.ok(Number.isInteger(f.nnzL) && f.nnzL >= n, `nnzL=${f.nnzL}`);
      assert.ok(Number.isFinite(f.fillInRatio) && f.fillInRatio >= 1, `fillInRatio=${f.fillInRatio}`);
    });
    await check(`B ${label}: residual < 1e-10, solution matches analytic field`, () => {
      const s = toWasmSolver(sys);
      s.factorize();
      const res = s.solve(sys.b);
      assert.ok(res.relativeResidual < REL_RES_TOL, `relative residual ${res.relativeResidual}`);
      const err = maxAbsDiff(res.solution, sys.xExact);
      assert.ok(err < SOL_ABS_TOL, `max |x - x_exact| = ${err}`);
    });
  }
  for (const g of [3, 6, 12, 24]) {
    const sys = buildPoisson2DSystem(g, true);
    const label = `perturbed poisson g=${g} n=${sys.n}`;
    await check(`B ${label}: factorize reports sparse-cholesky`, () => {
      const s = toWasmSolver(sys);
      const f = s.factorize();
      assert.strictEqual(f.solverMethod, 'sparse-cholesky', 'expected general path after diagonal perturbation');
    });
    await check(`B ${label}: residual < 1e-10, solution matches analytic field`, () => {
      const s = toWasmSolver(sys);
      s.factorize();
      const res = s.solve(sys.b);
      assert.ok(res.relativeResidual < REL_RES_TOL, `relative residual ${res.relativeResidual}`);
      const err = maxAbsDiff(res.solution, sys.xExact);
      assert.ok(err < SOL_ABS_TOL, `max |x - x_exact| = ${err}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Section C: ill-conditioned SPD scaled Laplacian (kappa ~ 1e8)
// ---------------------------------------------------------------------------
function buildScaledLaplacian(g, diagExponent) {
  const n = g * g;
  const d = [];
  for (let i = 0; i < n; i++) d.push(Math.pow(10, diagExponent * (i / (n - 1))));
  const entries = [];
  for (let y = 0; y < g; y++) {
    for (let x = 0; x < g; x++) {
      const i = y * g + x;
      entries.push([i, i, 4 * d[i] * d[i] + 1e-9]);
      if (x > 0) {
        const v = -d[i] * d[i - 1];
        entries.push([i, i - 1, v]);
        entries.push([i - 1, i, v]);
      }
      if (y > 0) {
        const v = -d[i] * d[i - g];
        entries.push([i, i - g, v]);
        entries.push([i - g, i, v]);
      }
    }
  }
  const xExact = new Float64Array(n);
  for (let i = 0; i < n; i++) xExact[i] = Math.sin((i + 1) * 0.3) + 1;
  return makeSystem(n, entries, xExact);
}

async function sectionCIllConditionedSpd() {
  console.log('[C] Ill-conditioned SPD scaled Laplacian (kappa ~ 1e8)');
  const g = 8;
  const sys = buildScaledLaplacian(g, 3.5);
  let solver = null;
  await check(`C g=${g}: factorize succeeds and kappa in [1e7, 1e9]`, () => {
    solver = toWasmSolver(sys);
    const f = solver.factorize();
    assert.strictEqual(f.solverMethod, 'sparse-cholesky');
    const kappa = estimateConditionNumber(solver, sys);
    assert.ok(kappa >= 1e7 && kappa <= 1e9, `kappa=${kappa} outside [1e7, 1e9]`);
  });
  await check(`C g=${g}: residual < 1e-10 still met for kappa ~ 1e8`, () => {
    if (!solver) throw new Error('factorize check did not populate solver');
    const res = solver.solve(sys.b);
    assert.ok(res.relativeResidual < REL_RES_TOL, `relative residual ${res.relativeResidual}`);
    const ref = sys.xExact.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const relSolErr = maxAbsDiff(res.solution, sys.xExact) / (ref || 1);
    assert.ok(relSolErr < 1e-6, `relative solution error ${relSolErr}`);
  });
}

// ---------------------------------------------------------------------------
// Section D: fail-closed behavior of the direct solver on degenerate matrices
// ---------------------------------------------------------------------------
async function sectionDFailClosedDirect() {
  console.log('[D] Direct solver fail-closed behavior (zero / negative-definite / singular / indefinite)');
  const cases = [
    {
      label: 'zero 4x4',
      A: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0]
      ]
    },
    {
      label: 'negative-definite 3x3',
      A: [
        [-4, 1, 0],
        [1, -4, 1],
        [0, 1, -4]
      ]
    },
    {
      label: 'singular rank-deficient 3x3 (duplicate rows)',
      A: [
        [1, 1, 0],
        [1, 1, 0],
        [0, 0, 1]
      ]
    },
    {
      label: 'symmetric indefinite diag(1,-1,2) 3x3',
      A: [
        [1, 0, 0],
        [0, -1, 0],
        [0, 0, 2]
      ]
    },
    {
      label: 'symmetric indefinite tridiagonal 4x4',
      A: [
        [2, 1, 0, 0],
        [1, -2, 1, 0],
        [0, 1, 2, 1],
        [0, 0, 1, -2]
      ]
    }
  ];
  for (const c of cases) {
    const n = c.A.length;
    await check(`D ${c.label}: factorize() throws non-positive-pivot error`, () => {
      const s = denseToWasm(c.A);
      let threw = false;
      let message = '';
      try {
        s.factorize();
      } catch (err) {
        threw = true;
        message = err.message;
      }
      assert.ok(threw, 'factorize() must throw on non-SPD input (fail closed)');
      assert.match(message, /not symmetric positive definite/);
    });
    await check(`D ${c.label}: solve() auto-factorize also fails closed`, () => {
      const s = denseToWasm(c.A);
      const b = new Float64Array(n);
      b.fill(1);
      assert.throws(() => s.solve(b), /not symmetric positive definite/);
    });
  }
}

// ---------------------------------------------------------------------------
// Section E: PCG solver (SparseCholeskySolver) failure-flag behavior
// ---------------------------------------------------------------------------
async function sectionEPcgFailClosed() {
  console.log('[E] PCG (SparseCholeskySolver.solve) failure-flag behavior');
  const zero4 = new SparseMatrixCSR(4, 4);
  zero4.finalize();
  await check('E zero matrix: converged=false, zero iterations, x = 0', () => {
    const b = new Float64Array(4);
    b.fill(1);
    const r = SparseCholeskySolver.solve(zero4, b, { maxIterations: 200 });
    assert.strictEqual(r.converged, false);
    assert.strictEqual(r.iterations, 0);
    approxEqual(r.residualNorm, Math.sqrt(4), 1e-12, 'residualNorm == ||b||');
    for (let i = 0; i < 4; i++) assert.strictEqual(r.x[i], 0);
  });
  await check('E singular inconsistent system: converged=false (fail closed via flag)', () => {
    const A = [
      [1, 1, 0],
      [1, 1, 0],
      [0, 0, 1]
    ];
    const m = new SparseMatrixCSR(3, 3);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (Math.abs(A[i][j]) > 1e-15) m.addEntry(i, j, A[i][j]);
      }
    }
    m.finalize();
    const b = new Float64Array([1, 2, 1]); // b0 !== b1 => not in range(A)
    const r = SparseCholeskySolver.solve(m, b, { maxIterations: 500 });
    assert.strictEqual(r.converged, false);
    assert.ok(Number.isFinite(r.residualNorm) && r.residualNorm > 1e-3, `residualNorm=${r.residualNorm}`);
    for (let i = 0; i < 3; i++) assert.ok(Number.isFinite(r.x[i]), `x[${i}] finite`);
  });
  await check('E symmetric indefinite 4x4: converged=false after max iterations', () => {
    const A = [
      [2, 1, 0, 0],
      [1, -2, 1, 0],
      [0, 1, 2, 1],
      [0, 0, 1, -2]
    ];
    const m = new SparseMatrixCSR(4, 4);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (Math.abs(A[i][j]) > 1e-15) m.addEntry(i, j, A[i][j]);
      }
    }
    m.finalize();
    const b = new Float64Array(4);
    b.fill(1);
    const r = SparseCholeskySolver.solve(m, b, { maxIterations: 500 });
    assert.strictEqual(r.converged, false);
    assert.strictEqual(r.iterations, 500);
  });
  await check('E consistent singular system: PCG finds a valid solution (documented behavior)', () => {
    const A = [
      [1, 1, 0],
      [1, 1, 0],
      [0, 0, 1]
    ];
    const m = new SparseMatrixCSR(3, 3);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (Math.abs(A[i][j]) > 1e-15) m.addEntry(i, j, A[i][j]);
      }
    }
    m.finalize();
    const b = new Float64Array([1, 1, 1]); // consistent: b0 === b1
    const r = SparseCholeskySolver.solve(m, b, { maxIterations: 200 });
    assert.ok(r.converged, 'consistent singular system has a solution; PCG converges');
    assert.ok(r.residualNorm < 1e-8, `residualNorm=${r.residualNorm}`);
    // x = [0.5, 0.5, 1] is the minimum-norm-ish solution of the consistent system
    approxEqual(r.x[0], 0.5, 1e-8, 'x[0]');
    approxEqual(r.x[1], 0.5, 1e-8, 'x[1]');
    approxEqual(r.x[2], 1, 1e-8, 'x[2]');
  });
}

// ---------------------------------------------------------------------------
// Section F: worker-pool path
// ---------------------------------------------------------------------------
async function sectionFWorkerPool() {
  console.log('[F] Worker-pool path (PersistentWorkerPool + ExperimentalCalculationQueue)');
  const pool = new PersistentWorkerPool({ maxWorkers: 2 });
  try {
    await check('F PersistentWorkerPool: spmv dispatch matches direct matvec for Poisson grids', async () => {
      for (const g of [3, 6, 12, 24]) {
        const sys = buildPoisson2DSystem(g, false);
        const s = toWasmSolver(sys);
        const { rowPtr, colIdx, values } = s;
        const x = sys.xExact;
        const y = new Float64Array(sys.n);
        const res = await pool.dispatch(
          'WASM_SIMD_BLAS',
          { operation: 'spmv', rowPtr, colInd: colIdx, values, x, y, nRows: sys.n },
          { timeoutMs: 10000 }
        );
        const expected = naiveMatvec(rowPtr, colIdx, values, x, sys.n);
        const diff = maxAbsDiff(res.result.y, expected);
        assert.ok(diff < 1e-9, `g=${g} pool spmv maxDiff=${diff}`);
      }
    });
    await check('F PersistentWorkerPool: several dispatches complete (telemetry)', () => {
      const completed = pool.getTelemetry().completedTasksCount;
      assert.ok(completed >= 4, `completedTasksCount=${completed}`);
    });
    await check(
      'F PersistentWorkerPool: SPARSE_CHOLESKY rejects (documented gap: kernel calls missing factorizeAndSolve)',
      async () => {
        const sys = buildTridiagonalSystem(16, false);
        const s = toWasmSolver(sys);
        const payload = {
          n: sys.n,
          m: sys.n,
          rowPtr: Array.from(s.rowPtr),
          colIdx: Array.from(s.colIdx),
          values: Array.from(s.values)
        };
        let threw = false;
        let message = '';
        try {
          await pool.dispatch('SPARSE_CHOLESKY', payload, { timeoutMs: 10000 });
        } catch (err) {
          threw = true;
          message = err.message;
        }
        assert.ok(threw, 'SPARSE_CHOLESKY dispatch must reject');
        assert.match(message, /factorizeAndSolve/);
      }
    );
  } finally {
    await pool.terminateAll();
  }

  const q = new ExperimentalCalculationQueue();
  await check('F ExperimentalCalculationQueue: OUT_OF_CORE_SPARSE matches direct PCG solution', async () => {
    const sys = buildTridiagonalSystem(32, false);
    const csr = toCsrMatrix(sys);
    const res = await q.dispatch('OUT_OF_CORE_SPARSE', {
      A: csr,
      b: sys.b,
      options: { maxIterations: 1500 }
    });
    const result = res.result;
    assert.ok(Number.isFinite(result.residualNorm), `residualNorm=${result.residualNorm}`);
    const pcg = SparseCholeskySolver.solve(csr, sys.b, { maxIterations: 2000 });
    const diff = maxAbsDiff(result.x, pcg.x);
    assert.ok(diff < 1e-3, `queue block-solver vs PCG maxDiff=${diff}`);
    assert.ok(result.iterations >= 0 && Number.isInteger(result.iterations));
  });
}

// ---------------------------------------------------------------------------
// Section G: determinism
// ---------------------------------------------------------------------------
async function sectionGDeterminism() {
  console.log('[G] Determinism (identical seeded input -> identical output)');
  await check('G direct solver: identical inputs produce bit-identical solutions', () => {
    const sys = buildPoisson2DSystem(12, true);
    const s1 = toWasmSolver(sys);
    const s2 = toWasmSolver(sys);
    const f1 = s1.factorize();
    const f2 = s2.factorize();
    assert.strictEqual(f1.nnzL, f2.nnzL);
    const r1 = s1.solve(sys.b);
    const r2 = s2.solve(sys.b);
    assert.ok(arraysIdentical(r1.solution, r2.solution), 'solutions differ');
    assert.strictEqual(r1.relativeResidual, r2.relativeResidual);
  });
  await check('G PCG: identical inputs produce bit-identical solutions and iteration counts', () => {
    const sys = buildTridiagonalSystem(128, false);
    const m1 = toCsrMatrix(sys);
    const m2 = toCsrMatrix(sys);
    const r1 = SparseCholeskySolver.solve(m1, sys.b, { maxIterations: 2000 });
    const r2 = SparseCholeskySolver.solve(m2, sys.b, { maxIterations: 2000 });
    assert.strictEqual(r1.iterations, r2.iterations);
    assert.strictEqual(r1.converged, r2.converged);
    assert.ok(arraysIdentical(r1.x, r2.x), 'PCG solutions differ');
  });
  await check('G system builder: same parameters reproduce identical b / x_exact', () => {
    const s1 = buildPoisson2DSystem(12, false);
    const s2 = buildPoisson2DSystem(12, false);
    assert.ok(arraysIdentical(s1.b, s2.b));
    assert.ok(arraysIdentical(s1.xExact, s2.xExact));
  });
}

// ---------------------------------------------------------------------------
// Section H: WASM kernel engine spmv cross-check
// ---------------------------------------------------------------------------
async function sectionHWasmKernel() {
  console.log('[H] WasmKernelEngine CSR spmv cross-check');
  await check('H kernel engine: initializes and matches naive matvec exactly (same summation order)', () => {
    const eng = new WasmKernelEngine();
    assert.strictEqual(eng.initSync(), true);
    const sys = buildPoisson2DSystem(6, false);
    const s = toWasmSolver(sys);
    const y = new Float64Array(sys.n);
    eng.spmv(s.rowPtr, s.colIdx, s.values, sys.xExact, y, sys.n);
    const expected = naiveMatvec(s.rowPtr, s.colIdx, s.values, sys.xExact, sys.n);
    assert.ok(arraysIdentical(y, expected), 'WASM spmv differs from naive matvec');
  });
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function runExtendedRobustnessSuite() {
  const t0 = Date.now();
  await sectionAStructuredPoisson();
  await sectionBGeneralSparseCholesky();
  await sectionCIllConditionedSpd();
  await sectionDFailClosedDirect();
  await sectionEPcgFailClosed();
  await sectionFWorkerPool();
  await sectionGDeterminism();
  await sectionHWasmKernel();
  const elapsedMs = Date.now() - t0;
  const passed = failedChecks === 0;
  return {
    id: 'SPARSE_SOLVERS_ROBUSTNESS_EXTENDED',
    name: 'Extended robustness suite for production sparse solvers (direct Cholesky, DST-I, PCG, worker pool)',
    passed,
    status: passed ? 'passed' : 'failed',
    totalChecks: passedChecks + failedChecks,
    passedChecks,
    failedChecks,
    elapsedMs,
    failures,
    measured: {
      structuredPoissonGrids: [3, 6, 12, 24],
      generalSparseSizes: [8, 32, 128, 512],
      illConditionedKappaBand: '[1e7, 1e9]',
      workerPoolSparseDispatch:
        'unavailable: SPARSE_CHOLESKY worker kernel calls missing factorizeAndSolve method (rejects with NUMERICAL_FAILURE)',
      solverFailureModes: {
        wasmSparseMultifrontal:
          'throws plain Error "Matrix is not symmetric positive definite (non-positive pivot at step k)" on zero / negative-definite / singular / indefinite matrices (fail closed)',
        sparseCholeskyPcg:
          'does not throw; returns converged=false + residualNorm flag (fail closed). Documented: early-stop at pAp < 1e-20 can set converged=false while solution is accurate; consistent singular and diagonal-indefinite systems can converge to valid solutions.'
      }
    }
  };
}

if (require.main === module) {
  (async () => {
    const r = await runExtendedRobustnessSuite();
    console.log('\n' + r.id);
    console.log(`  status: ${r.status}  (${r.passedChecks}/${r.totalChecks} checks passed, ${r.elapsedMs}ms)`);
    if (r.failedChecks > 0) {
      console.log('  failures:');
      for (const f of r.failures) console.log(`    - ${f.name}: ${f.message}`);
    }
    console.log('  solver failure-mode observations:');
    for (const [solver, observation] of Object.entries(r.measured.solverFailureModes)) {
      console.log(`    ${solver}: ${observation}`);
    }
    if (!r.passed) process.exitCode = 1;
  })().catch((err) => {
    console.error('FATAL runner error:', err);
    process.exitCode = 1;
  });
}

module.exports = { runExtendedRobustnessSuite };
