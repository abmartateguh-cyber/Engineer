/**
 * OmniEng performance-evidence suite.
 *
 * Measures honest wall-clock performance of key production compute paths on
 * this host and asserts generous, non-fake budgets (>= 3x measured headroom)
 * so that gate failures only reflect real regressions, not loaded-host noise.
 *
 * Determinism: all inputs come from seeded PRNGs; Math.random is never used.
 *
 * Run standalone:  node test/test_performance_evidence.js
 */

'use strict';

const assert = require('assert');

const { Poisson2DDirichletDirectSolver } = require('../src/core/math/poisson_2d_direct');
const { WasmSparseMultifrontalSolver } = require('../src/core/math/wasm_sparse_multifrontal');
const { FEASolver } = require('../src/core/cae/fea_structural');
const { ODESolvers } = require('../src/core/math/ode_solvers');
const { GPUParallelPCGSolver } = require('../src/core/math/gpu_parallel_pcg_solver');

console.log('================================================================');
console.log('   RUNNING PERFORMANCE EVIDENCE SUITE (REAL WALL-CLOCK MEASUREMENTS)');
console.log('================================================================\n');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

function report(label, elapsedMs, budgetMs, extra) {
  const pct = ((100 * elapsedMs) / budgetMs).toFixed(0);
  console.log(
    `  ✓ [${label}] measured ${elapsedMs.toFixed(1)} ms / budget ${budgetMs} ms (${pct}%)` +
      (extra ? ` — ${extra}` : '')
  );
}

function buildUniformPoisson2D(gridSize) {
  const unknowns = gridSize * gridSize;
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
  return solver;
}

function buildHex20Mesh(nElemsPerAxis, cellSize) {
  const g = 2 * nElemsPerAxis;
  const nodeGrid = Array.from({ length: g + 1 }, () =>
    Array.from({ length: g + 1 }, () => new Int32Array(g + 1).fill(-1))
  );
  const nodes = [];
  for (let iz = 0; iz <= g; iz++) {
    for (let iy = 0; iy <= g; iy++) {
      for (let ix = 0; ix <= g; ix++) {
        const oddCount = (ix % 2) + (iy % 2) + (iz % 2);
        if (oddCount > 1) continue;
        nodeGrid[iz][iy][ix] = nodes.length;
        nodes.push({ id: nodes.length, x: ix * cellSize, y: iy * cellSize, z: iz * cellSize });
      }
    }
  }
  const fea = new FEASolver();
  for (const nd of nodes) fea.addNode(nd.x, nd.y, nd.z);
  const material = { E: 210e9, nu: 0.3, yieldStress: 250e6 };
  for (let ez = 0; ez < nElemsPerAxis; ez++) {
    for (let ey = 0; ey < nElemsPerAxis; ey++) {
      for (let ex = 0; ex < nElemsPerAxis; ex++) {
        const x0 = 2 * ex;
        const y0 = 2 * ey;
        const z0 = 2 * ez;
        const nodeIds = [
          nodeGrid[z0][y0][x0],
          nodeGrid[z0][y0][x0 + 2],
          nodeGrid[z0][y0 + 2][x0 + 2],
          nodeGrid[z0][y0 + 2][x0],
          nodeGrid[z0 + 2][y0][x0],
          nodeGrid[z0 + 2][y0][x0 + 2],
          nodeGrid[z0 + 2][y0 + 2][x0 + 2],
          nodeGrid[z0 + 2][y0 + 2][x0],
          nodeGrid[z0][y0][x0 + 1],
          nodeGrid[z0][y0 + 1][x0 + 2],
          nodeGrid[z0][y0 + 2][x0 + 1],
          nodeGrid[z0][y0 + 1][x0],
          nodeGrid[z0 + 2][y0][x0 + 1],
          nodeGrid[z0 + 2][y0 + 1][x0 + 2],
          nodeGrid[z0 + 2][y0 + 2][x0 + 1],
          nodeGrid[z0 + 2][y0 + 1][x0],
          nodeGrid[z0 + 1][y0][x0],
          nodeGrid[z0 + 1][y0][x0 + 2],
          nodeGrid[z0 + 1][y0 + 2][x0 + 2],
          nodeGrid[z0 + 1][y0 + 2][x0]
        ];
        fea.addElement(nodeIds, material);
      }
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].z === 0) fea.fixNode(i, true, true, true);
    if (nodes[i].z === g * cellSize) fea.applyForce(i, 0, 0, -1000);
  }
  return { fea, nodes };
}

function independentPoissonResidual(gridSize, rhs, solution) {
  let residualSquared = 0;
  let rhsSquared = 0;
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const i = y * gridSize + x;
      let value = 4 * solution[i];
      if (x > 0) value -= solution[i - 1];
      if (x + 1 < gridSize) value -= solution[i + 1];
      if (y > 0) value -= solution[i - gridSize];
      if (y + 1 < gridSize) value -= solution[i + gridSize];
      const residual = rhs[i] - value;
      residualSquared += residual * residual;
      rhsSquared += rhs[i] * rhs[i];
    }
  }
  return Math.sqrt(residualSquared) / (Math.sqrt(rhsSquared) || 1);
}

async function main() {
  const summary = [];

  // ---------------------------------------------------------------- 1. Poisson DST-I
  {
    const gridSize = 255;
    const unknowns = gridSize * gridSize;
    const prng = mulberry32(0xc0ffee);
    const rhs = new Float64Array(unknowns);
    for (let i = 0; i < unknowns; i++) rhs[i] = 1 + prng() * 7;

    const solver = new Poisson2DDirichletDirectSolver(gridSize);
    const t0 = nowMs();
    const result = solver.solve(rhs);
    const elapsedMs = nowMs() - t0;

    const relResidual = independentPoissonResidual(gridSize, rhs, result.solution);
    const budgetMs = 20000;
    assert(
      Number.isFinite(relResidual) && relResidual < 1e-9,
      `Poisson DST-I relative residual ${relResidual} must be < 1e-9`
    );
    assert(elapsedMs < budgetMs, `Poisson DST-I took ${elapsedMs.toFixed(0)} ms; budget ${budgetMs} ms`);
    report(
      'P-1 Poisson 2D DST-I (255x255, 65025 unknowns)',
      elapsedMs,
      budgetMs,
      `independent residual ${relResidual.toExponential(2)}`
    );
    summary.push({ id: 'poisson-dst1-255', elapsedMs, budgetMs, residual: relResidual });
  }

  // -------------------------------------------------------- 2. Sparse Cholesky 1600
  {
    const gridSize = 40;
    const unknowns = gridSize * gridSize;
    const solver = buildUniformPoisson2D(gridSize);
    const prng = mulberry32(0xbeef);
    const rhs = new Float64Array(unknowns);
    for (let i = 0; i < unknowns; i++) rhs[i] = 1 + prng() * 3;

    const t0 = nowMs();
    solver.finalizeCSR();
    solver.factorize();
    const result = solver.solve(rhs);
    const elapsedMs = nowMs() - t0;

    const budgetMs = 5000;
    assert(
      result.relativeResidual < 1e-9,
      `Sparse Cholesky relative residual ${result.relativeResidual} must be < 1e-9`
    );
    assert(result.converged, 'Sparse Cholesky solve did not report convergence');
    assert(elapsedMs < budgetMs, `Sparse Cholesky took ${elapsedMs.toFixed(0)} ms; budget ${budgetMs} ms`);
    report(
      'P-2 Sparse Cholesky (1600 unknowns, general path)',
      elapsedMs,
      budgetMs,
      `relative residual ${result.relativeResidual.toExponential(2)}`
    );
    summary.push({ id: 'sparse-cholesky-1600', elapsedMs, budgetMs, residual: result.relativeResidual });
  }

  // ------------------------------------------------------------- 3. FEA HEX20 4^3
  {
    const { fea } = buildHex20Mesh(4, 0.25);
    const t0 = nowMs();
    const results = fea.solveStatic();
    const elapsedMs = nowMs() - t0;

    const budgetMs = 21000;
    assert(Number.isFinite(results.maxDisplacement), 'FEA displacement must be finite');
    assert(Number.isFinite(results.maxStress), 'FEA stress must be finite');
    assert(results.maxDisplacement > 0 && results.maxStress > 0, 'FEA solution must be non-trivial');
    const relResidual = fea.computeRelativeEquilibriumResidual();
    assert(
      Number.isFinite(relResidual) && relResidual < 1e-4,
      `FEA equilibrium residual ${relResidual} must be < 1e-4`
    );
    assert(elapsedMs < budgetMs, `FEA HEX20 took ${elapsedMs.toFixed(0)} ms; budget ${budgetMs} ms`);
    report(
      'P-3 FEA HEX20 assembly+solve (4x4x4 = 64 elements, 1275 dof)',
      elapsedMs,
      budgetMs,
      `maxDisp ${results.maxDisplacement.toExponential(2)} m, relRes ${relResidual.toExponential(2)}`
    );
    summary.push({ id: 'fea-hex20-4x4x4', elapsedMs, budgetMs, residual: relResidual });
  }

  // ------------------------------------------------ 4. ODE RK4 stiff spring-mass-damper
  {
    const k = 1e6;
    const m = 1;
    const c = 2e3;
    const derivative = (t, y) => [y[1], (-k * y[0] - c * y[1]) / m];
    const y0 = [0.01, 0];
    const steps = 10000;
    const dt = 1e-4;

    const t0 = nowMs();
    const trajectory = ODESolvers.solveRK4(derivative, 0, y0, dt, steps);
    const elapsedMs = nowMs() - t0;

    const energy = (y) => 0.5 * m * y[1] * y[1] + 0.5 * k * y[0] * y[0];
    const energy0 = energy(y0);
    let maxEnergyRatio = 0;
    for (const step of trajectory) {
      assert(Number.isFinite(step.y[0]) && Number.isFinite(step.y[1]), 'RK4 state must remain finite');
      maxEnergyRatio = Math.max(maxEnergyRatio, energy(step.y) / energy0);
    }
    const finalEnergy = energy(trajectory[trajectory.length - 1].y);
    const budgetMs = 1000;
    assert(
      Number.isFinite(finalEnergy) && finalEnergy <= energy0 * 1.01,
      'RK4 energy must be bounded by initial energy'
    );
    assert(maxEnergyRatio <= 1.01, `RK4 peak energy ratio ${maxEnergyRatio} must stay <= 1.01`);
    assert(trajectory.length === steps + 1, 'RK4 must produce exactly steps+1 trajectory samples');
    assert(elapsedMs < budgetMs, `ODE RK4 took ${elapsedMs.toFixed(0)} ms; budget ${budgetMs} ms`);
    report(
      'P-4 ODE RK4 stiff spring-mass-damper (10000 steps)',
      elapsedMs,
      budgetMs,
      `peak E/E0 ${maxEnergyRatio.toFixed(4)}, final E/E0 ${(finalEnergy / energy0).toExponential(2)}`
    );
    summary.push({ id: 'ode-rk4-stiff-10000', elapsedMs, budgetMs, maxEnergyRatio });
  }

  // ------------------------------------ 5. Matrix-free worker-pool PCG, 100 small solves
  {
    const gridSize = 8;
    const unknowns = gridSize * gridSize;
    const buildSystem = (seed) => {
      const rowPtr = new Int32Array(unknowns + 1);
      const colIdx = [];
      const values = [];
      const rhs = new Float64Array(unknowns);
      for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
          const i = y * gridSize + x;
          const row = [[i, 4]];
          if (x > 0) row.push([i - 1, -1]);
          if (x + 1 < gridSize) row.push([i + 1, -1]);
          if (y > 0) row.push([i - gridSize, -1]);
          if (y + 1 < gridSize) row.push([i + gridSize, -1]);
          row.sort((a, b) => a[0] - b[0]);
          for (const [j, v] of row) {
            colIdx.push(j);
            values.push(v);
          }
          rowPtr[i + 1] = values.length;
          rhs[i] = 1 + ((i + seed) % 5);
        }
      }
      return { n: unknowns, rowPtr, colIdx, values, b: rhs };
    };

    // Direct reference: one general sparse Cholesky factorization recomputed per RHS.
    const refSolver = buildUniformPoisson2D(gridSize);
    refSolver.finalizeCSR();
    refSolver.factorize();

    const poolSolver = new GPUParallelPCGSolver({
      maxIterations: 500,
      tolerance: 1e-6,
      maxWorkers: 2
    });

    // Warmup (untimed): cold-start worker module loads are not steady-state throughput.
    for (let s = 0; s < 3; s++) poolSolver.solve(buildSystem(s), buildSystem(s).b);

    const solveCount = 100;
    const t0 = nowMs();
    let maxAbsDiff = 0;
    let workerThreadsUsed = 0;
    let solved = 0;
    for (let s = 0; s < solveCount; s++) {
      const system = buildSystem(s + 10);
      const out = poolSolver.solve(system, system.b);
      assert(out.converged, `Worker-pool PCG solve ${s} did not converge: ${out.terminationReason}`);
      const ref = refSolver.solve(system.b);
      for (let i = 0; i < unknowns; i++) {
        maxAbsDiff = Math.max(maxAbsDiff, Math.abs(out.solution[i] - ref.solution[i]));
      }
      workerThreadsUsed = Math.max(workerThreadsUsed, out.workerThreadsUsed);
      solved++;
    }
    const elapsedMs = nowMs() - t0;

    const budgetMs = 20000;
    assert(solved === solveCount, 'All 100 worker-pool solves must complete');
    assert(maxAbsDiff < 1e-4, `Worker-pool solves must match direct (maxAbsDiff ${maxAbsDiff})`);
    assert(workerThreadsUsed > 0, 'Worker-pool backend must actually be used for SpMV');
    assert(elapsedMs < budgetMs, `Worker-pool dispatch took ${elapsedMs.toFixed(0)} ms; budget ${budgetMs} ms`);
    report(
      'P-5 Matrix-free worker-pool PCG (100 small solves, 64 unknowns each)',
      elapsedMs,
      budgetMs,
      `workerThreadsUsed ${workerThreadsUsed}, maxAbsDiff vs direct ${maxAbsDiff.toExponential(2)}`
    );
    summary.push({ id: 'workerpool-pcg-100', elapsedMs, budgetMs, maxAbsDiff });
  }

  console.log('\n================================================================');
  console.log('   PERFORMANCE EVIDENCE SUMMARY');
  console.log('================================================================');
  for (const row of summary) {
    console.log(`  ${row.id.padEnd(30)} ${row.elapsedMs.toFixed(1).padStart(9)} ms / ${row.budgetMs} ms budget`);
  }
  console.log('================================================================');
  console.log('   ALL PERFORMANCE EVIDENCE CHECKS PASSED');
  console.log('================================================================');
}

main()
  .then(async () => {
    await GPUParallelPCGSolver.releaseSharedWorkerPools();
    process.exit(0);
  })
  .catch((error) => {
    console.error('PERFORMANCE EVIDENCE FAILURE:', error.message);
    process.exit(1);
  });
