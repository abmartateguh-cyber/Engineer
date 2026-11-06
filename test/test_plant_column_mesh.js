/**
 * Test suite for the equilibrium-stage (MESH) distillation column solver
 * (src/core/plant/naphtali_sandholm_mesh.js) and its plant adapter route.
 *
 * Verified documented case: benzene/toluene binary split at 1 atm, 10
 * equilibrium stages (total condenser + 8 trays + partial reboiler), feed
 * stage 5, saturated liquid feed 50/50, reflux ratio 2.0, distillate rate
 * 0.5 (fraction of feed). The reported top/bottom compositions are compared
 * against an independent tray-by-tray Lewis-Matheson-style re-implementation
 * using the same documented vapor-pressure correlations (tolerance 5%
 * absolute mole fraction).
 */

'use strict';

const assert = require('assert');
const { NaphtaliSandholmColumnSolver } = require('../src/core/plant/naphtali_sandholm_mesh');
const { CorrelationSpeciesCatalog } = require('../src/core/plant/thermo_compounds');
const { PlantEngineAdapter } = require('../src/core/plant/plant_engine_adapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');

const BINARY_CASE = {
  stageCount: 10,
  feedStage: 5,
  components: ['Benzene', 'Toluene'],
  feedComposition: { Benzene: 0.5, Toluene: 0.5 },
  refluxRatio: 2.0,
  distillateRate: 0.5,
  pressurePa: 101325,
  kValueModel: 'raoult'
};

// ---------------------------------------------------------------------------
// Independent tray-by-tray reference implementation (Lewis-Matheson style)
// ---------------------------------------------------------------------------

function independentReference(problem) {
  const catalog = new CorrelationSpeciesCatalog();
  const benz = catalog.resolveRequired('Benzene');
  const tol = catalog.resolveRequired('Toluene');
  const D = problem.distillateRate;
  const R = problem.refluxRatio;
  const N = problem.stageCount;
  const feedStage = problem.feedStage;
  const zF = problem.feedComposition.Benzene;

  // CMO flows (same idealization, independent code path)
  const L1 = R * D;
  const V2 = (R + 1) * D;
  const L = new Array(N + 1);
  const V = new Array(N + 1);
  L[1] = L1;
  V[1] = 0;
  for (let j = 2; j < N; j++) {
    L[j] = L1 + (j >= feedStage ? 1 : 0);
    V[j] = V2;
  }
  L[N] = 1 - D;
  V[N] = V2;

  const bubbleK = (x) => {
    const f = (T) =>
      (benz.getVaporPressure(T) / problem.pressurePa) * x[0] +
      (tol.getVaporPressure(T) / problem.pressurePa) * x[1] -
      1;
    let a = 278.68;
    let b = 562.05;
    for (let it = 0; it < 100; it++) {
      const mid = 0.5 * (a + b);
      if (f(mid) < 0) a = mid;
      else b = mid;
    }
    const T = 0.5 * (a + b);
    return [benz.getVaporPressure(T) / problem.pressurePa, tol.getVaporPressure(T) / problem.pressurePa];
  };

  // tridiagonal component-balance solve for the full column (benzene only;
  // toluene by closure)
  const solveComposition = (T, xOld) => {
    const A = [];
    const b = [];
    let row = new Array(N).fill(0);
    row[0] = L1 + D;
    const K2 = bubbleK(xOld[2]);
    row[1] = -V2 * K2[0];
    A.push(row);
    b.push(0);
    for (let j = 2; j <= N - 1; j++) {
      const Kj = bubbleK(xOld[j]);
      const Kj1 = bubbleK(xOld[j + 1]);
      row = new Array(N).fill(0);
      row[j - 2] = L[j - 1];
      row[j - 1] = -(L[j] + V[j] * Kj[0]);
      row[j] = V[j + 1] * Kj1[0];
      A.push(row);
      b.push(-(j === feedStage ? 1 : 0) * zF);
    }
    row = new Array(N).fill(0);
    row[N - 2] = L[N - 1];
    const KN = bubbleK(xOld[N]);
    row[N - 1] = -(L[N] + V[N] * KN[0]);
    A.push(row);
    b.push(0);

    for (let col = 0; col < N; col++) {
      let pivot = col;
      for (let r = col + 1; r < N; r++) {
        if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
      }
      if (pivot !== col) {
        const t = A[col];
        A[col] = A[pivot];
        A[pivot] = t;
        const tb = b[col];
        b[col] = b[pivot];
        b[pivot] = tb;
      }
      for (let r = 0; r < N; r++) {
        if (r === col) continue;
        const factor = A[r][col] / A[col][col];
        if (factor === 0) continue;
        for (let k = col; k < N; k++) A[r][k] -= factor * A[col][k];
        b[r] -= factor * b[col];
      }
    }
    const xs = b.map((v, i) => Math.max(1e-12, v / A[i][i]));
    return xs;
  };

  let x = new Array(N + 1);
  for (let j = 1; j <= N; j++) {
    x[j] = [0.5, 0.5];
  }
  for (let iter = 0; iter < 120; iter++) {
    const xs = solveComposition(null, x);
    for (let j = 1; j <= N; j++) {
      x[j][0] = xs[j - 1];
      x[j][1] = 1 - xs[j - 1];
    }
  }
  return { xD: x[1][0], xB: x[N][0] };
}

// ---------------------------------------------------------------------------
console.log('================================================================');
console.log('   RUNNING PLANT COLUMN MESH SOLVER TESTS');
console.log('================================================================\n');

// 1. Solver converges with typed convergence history
console.log('[1] Convergence and typed history...');
const result = NaphtaliSandholmColumnSolver.solve(BINARY_CASE);
assert.strictEqual(result.status, 'converged', `solver converged (${JSON.stringify(result.error)})`);
assert.strictEqual(result.success, true);
const conv = result.convergence;
assert(Array.isArray(conv.history) && conv.history.length > 0, 'typed convergence history present');
assert(
  conv.history.every(
    (h) =>
      Number.isInteger(h.iteration) && Number.isFinite(h.maxMaterialResidual) && Number.isFinite(h.maxBubbleResidual)
  )
);
assert(conv.maxMaterialResidual < 1e-8, `material residual < 1e-8 (got ${conv.maxMaterialResidual})`);
assert(conv.maxBubbleResidual < 1e-8, `bubble residual < 1e-8 (got ${conv.maxBubbleResidual})`);
console.log(
  `  ✓ converged in ${conv.iterations} iterations; maxMaterialResidual=${conv.maxMaterialResidual.toExponential(2)}, maxBubbleResidual=${conv.maxBubbleResidual.toExponential(2)}\n`
);

// 2. Component mass balance closure < 1e-6
console.log('[2] Component mass balance closure...');
const mb = result.massBalance;
assert(mb.maxAbsComponentClosure < 1e-6, `component closure < 1e-6 (got ${mb.maxAbsComponentClosure})`);
for (const name of BINARY_CASE.components) {
  assert(Number.isFinite(mb.closurePerComponent[name]));
}
console.log(`  ✓ maxAbsComponentClosure=${mb.maxAbsComponentClosure.toExponential(2)}\n`);

// 3. Monotonic temperature sanity
console.log('[3] Stage temperature profile monotonicity...');
const temps = result.profiles.stages.map((s) => s.temperatureK);
for (let i = 1; i < temps.length; i++) {
  assert(temps[i] >= temps[i - 1] - 1e-6, `temperature stage ${i + 1} >= stage ${i} (${temps[i - 1]} -> ${temps[i]})`);
}
console.log(`  ✓ T1=${temps[0].toFixed(2)} K -> TN=${temps[temps.length - 1].toFixed(2)} K monotonic\n`);

// 4. Independent implementation comparison within 5% absolute
console.log('[4] Cross-check vs independent tray-by-tray implementation...');
const ref = independentReference(BINARY_CASE);
const xD = result.products.distillate.composition.Benzene;
const xB = result.products.bottoms.composition.Benzene;
console.log(`    solver: xD=${xD.toFixed(4)}, xB=${xB.toFixed(4)}`);
console.log(`    ref:   xD=${ref.xD.toFixed(4)}, xB=${ref.xB.toFixed(4)}`);
assert(Math.abs(xD - ref.xD) < 0.05, `top composition within 5% abs (Δ=${Math.abs(xD - ref.xD).toFixed(4)})`);
assert(Math.abs(xB - ref.xB) < 0.05, `bottom composition within 5% abs (Δ=${Math.abs(xB - ref.xB).toFixed(4)})`);
console.log(`  ✓ |ΔxD|=${Math.abs(xD - ref.xD).toFixed(4)}, |ΔxB|=${Math.abs(xB - ref.xB).toFixed(4)} < 0.05\n`);

// 5. Non-convergent spec fails closed with error
console.log('[5] Non-convergent / invalid specs fail closed...');
const failedSpec = { ...BINARY_CASE, maxIterations: 1 };
const failed = NaphtaliSandholmColumnSolver.solve(failedSpec);
assert.strictEqual(failed.success, false);
assert.strictEqual(failed.status, 'not-converged');
assert(failed.error && failed.error.code === 'NUMERICAL_FAILURE', 'numeric failure code surfaced');
const incomplete = NaphtaliSandholmColumnSolver.solve({ stages: 15 });
assert.strictEqual(incomplete.status, 'unavailable');
assert.strictEqual(incomplete.error.code, 'UNSUPPORTED');
console.log('  ✓ bad spec fails closed with NUMERICAL_FAILURE / unavailable\n');

// 6. Determinism
console.log('[6] Determinism...');
const again = NaphtaliSandholmColumnSolver.solve(BINARY_CASE);
assert.strictEqual(JSON.stringify(again.profiles), JSON.stringify(result.profiles));
assert.strictEqual(JSON.stringify(again.convergence.history), JSON.stringify(conv.history));
console.log('  ✓ identical profiles and convergence history across runs\n');

// 7. Plant adapter route
console.log('[7] Plant adapter route (explicit inputs only)...');
(async () => {
  const adapter = new PlantEngineAdapter();
  assert(adapter.describeCapabilities().supportedOperations.includes('solve_distillation_column'));
  const req = new JobRequest({
    jobId: 'col-mesh-1',
    domain: 'plant',
    operation: 'solve_distillation_column',
    parameters: BINARY_CASE
  });
  const job = await adapter.execute(req);
  assert.strictEqual(job.status, 'COMPLETED');
  assert(job.outputData.profiles && job.outputData.profiles.stages.length === 10);
  assert.strictEqual(job.convergenceHistory.length, conv.history.length);
  assert(Number.isFinite(job.outputData.products.distillate.composition.Benzene));
  console.log('  ✓ route executed, COMPLETED, profiles + convergence history wired');

  let validationRejected = false;
  try {
    const badReq = new JobRequest({
      jobId: 'col-mesh-2',
      domain: 'plant',
      operation: 'solve_distillation_column',
      parameters: { ...BINARY_CASE, pressurePa: undefined }
    });
    await adapter.execute(badReq);
  } catch (err) {
    validationRejected = true;
    assert(err.code === 'INVALID_INPUT', 'missing pressure rejected as invalid input');
  }
  assert(validationRejected, 'missing explicit pressure rejected');
  console.log('  ✓ missing explicit pressure rejected');
  console.log('\nALL PLANT COLUMN MESH TESTS PASSED');
})();
