/**
 * NIST_VV_SPARSE_SUITE - sparse solver V&V.
 *
 * Section A (NIST V&V case): the bundled Matrix Market files under
 * test/vv/references/matrixmarket/ are parsed and solved with the production
 * sparse direct Cholesky solver (WasmSparseMultifrontalSolver,
 * src/core/math/wasm_sparse_multifrontal.js). bcsstk01.mtx and nos4.mtx are
 * genuine NIST archive downloads pinned by SHA-256; wathen100_synthetic.mtx
 * is a clearly-labelled deterministic synthetic substitute. This section
 * requires relative residual ||b - A x||2 / ||b||2 <= 1e-8 and records the
 * actual residuals.
 *
 * Section B (separate, clearly-labelled): the generated ill-conditioned SPD
 * suite with known solutions (A = D + eps*(B*B'/||B*B'||), x_exact known),
 * kept unchanged from the original benchmark. Systems solve with the same
 * production solver; relative residual is compared against a 1e-8 threshold
 * for condition numbers up to ~1e8. Systems with higher condition are solved
 * and reported but are not expected to meet the tight threshold in double
 * precision.
 */
'use strict';

const { WasmSparseMultifrontalSolver } = require('../../../src/core/math/wasm_sparse_multifrontal');
const { runManufacturedSparseSPD } = require('../../../src/core/vv/manufactured_sparse_spd');
const { runMatrixMarketSuite } = require('../../../src/core/math/matrix_market_suite');

const N = 300;

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function rankOneLowRankB(n, lowRank, density, rng) {
  const B = Array.from({ length: n }, () => new Float64Array(lowRank));
  for (let r = 0; r < n; r++) {
    const chosen = new Set();
    while (chosen.size < Math.max(2, Math.floor(density * lowRank))) {
      chosen.add(Math.floor(rng() * lowRank));
    }
    for (const q of chosen) {
      B[r][q] = rng() > 0.5 ? 1 : -1;
    }
  }
  return B;
}

function buildSPDSystem(alpha, eps, seed) {
  const rng = seededRandom(seed);
  const B = rankOneLowRankB(N, 50, 0.12, rng);

  const C = Array.from({ length: N }, () => new Float64Array(N));
  for (let q = 0; q < 50; q++) {
    const rows = [];
    for (let r = 0; r < N; r++) {
      if (B[r][q] !== 0) rows.push(r);
    }
    for (let a = 0; a < rows.length; a++) {
      for (let b = a; b < rows.length; b++) {
        const val = B[rows[a]][q] * B[rows[b]][q];
        C[rows[a]][rows[b]] += val;
        if (a !== b) C[rows[b]][rows[a]] += val;
      }
    }
  }

  let cNorm = 0;
  {
    const y = new Float64Array(N);
    const x = new Float64Array(N);
    for (let i = 0; i < N; i++) x[i] = 1;
    for (let iter = 0; iter < 15; iter++) {
      for (let i = 0; i < N; i++) {
        let s = 0;
        const Ci = C[i];
        for (let j = 0; j < N; j++) s += Ci[j] * x[j];
        y[i] = s;
      }
      let norm = 0;
      for (let i = 0; i < N; i++) norm += y[i] * y[i];
      norm = Math.sqrt(norm) || 1;
      cNorm = norm;
      for (let i = 0; i < N; i++) x[i] = y[i] / norm;
    }
  }

  const A = Array.from({ length: N }, () => new Float64Array(N));
  for (let i = 0; i < N; i++) {
    const d = Math.pow(10, -alpha * (i / (N - 1)));
    for (let j = 0; j < N; j++) {
      if (i === j) {
        A[i][j] = d + eps * (C[i][j] / cNorm) + 1e-12;
      } else {
        A[i][j] = eps * (C[i][j] / cNorm);
      }
    }
  }

  const xExact = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    xExact[i] = Math.sin((i + 1) * 0.05) + 1;
  }

  const b = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    const Ai = A[i];
    for (let j = 0; j < N; j++) s += Ai[j] * xExact[j];
    b[i] = s;
  }

  return { A, b, xExact };
}

function solveWithSparseCholesky(A, b) {
  const solver = new WasmSparseMultifrontalSolver(N, N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (A[i][j] !== 0) solver.addEntry(i, j, A[i][j]);
    }
  }
  solver.finalizeCSR();
  const fact = solver.factorize();
  const res = solver.solve(b);
  return { fact, res, solver };
}

function estimateCondition(A, solver) {
  const n = A.length;
  const rayleigh = (v) => {
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      const Ai = A[i];
      for (let j = 0; j < n; j++) s += Ai[j] * v[j];
      num += v[i] * s;
      den += v[i] * v[i];
    }
    return den > 0 ? num / den : 0;
  };
  let lambdaMax = 0;
  {
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = 1;
    for (let iter = 0; iter < 30; iter++) {
      for (let i = 0; i < n; i++) {
        let s = 0;
        const Ai = A[i];
        for (let j = 0; j < n; j++) s += Ai[j] * x[j];
        y[i] = s;
      }
      lambdaMax = rayleigh(y);
      let norm = 0;
      for (let i = 0; i < n; i++) norm += y[i] * y[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < n; i++) x[i] = y[i] / norm;
    }
  }
  let lambdaMin = 0;
  {
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = 1;
    for (let iter = 0; iter < 30; iter++) {
      const y = solver.solve(x).solution;
      let norm = 0;
      for (let i = 0; i < n; i++) norm += y[i] * y[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < n; i++) x[i] = y[i] / norm;
    }
    lambdaMin = rayleigh(x);
  }
  return lambdaMin > 0 ? lambdaMax / lambdaMin : Infinity;
}

function runNistSparseRobustness() {
  const cases = [
    { alpha: 2, eps: 0.05, seed: 1234, label: 'kappa~1e2' },
    { alpha: 8, eps: 0.05, seed: 5678, label: 'kappa~1e8' },
    { alpha: 10, eps: 0.05, seed: 9012, label: 'kappa~1e10 (reported only)' }
  ];

  const outcomes = [];
  for (const c of cases) {
    const { A, b, xExact } = buildSPDSystem(c.alpha, c.eps, c.seed);
    let solved;
    try {
      solved = solveWithSparseCholesky(A, b);
    } catch (err) {
      outcomes.push({ ...c, error: err.message });
      continue;
    }
    const { res } = solved;
    let relResidual = null;
    let maxSolutionError = null;
    if (res.solution) {
      let resSq = 0;
      let bSq = 0;
      for (let i = 0; i < N; i++) {
        let ax = 0;
        const Ai = A[i];
        for (let j = 0; j < N; j++) ax += Ai[j] * res.solution[j];
        const r = b[i] - ax;
        resSq += r * r;
        bSq += b[i] * b[i];
      }
      relResidual = Math.sqrt(resSq) / (Math.sqrt(bSq) || 1);
      let maxErr = 0;
      for (let i = 0; i < N; i++) {
        maxErr = Math.max(maxErr, Math.abs(res.solution[i] - xExact[i]));
      }
      maxSolutionError = maxErr;
    }
    const kappaEstimate = estimateCondition(A, solved.solver);
    outcomes.push({
      ...c,
      relResidual,
      maxSolutionError,
      kappaEstimate,
      nnzL: solved.fact.nnzL,
      factorMs: solved.fact.factorizationMs
    });
  }

  const primary = outcomes.find((o) => o.label.startsWith('kappa~1e8'));
  const reliable = outcomes.find((o) => o.label.startsWith('kappa~1e2'));

  const residualTolerance = 1e-8;
  const solutionTolerance = 1e-6;
  const primaryPass =
    primary &&
    primary.relResidual !== null &&
    primary.relResidual <= residualTolerance &&
    primary.maxSolutionError <= solutionTolerance;
  const reliablePass =
    reliable &&
    reliable.relResidual !== null &&
    reliable.relResidual <= residualTolerance &&
    reliable.maxSolutionError <= solutionTolerance;

  const passed = Boolean(primaryPass && reliablePass);

  return {
    id: 'SPARSE_SPD_GENERATED_SUITE',
    name: 'Generated sparse SPD solver robustness suite over ill-conditioned systems',
    targetValue: residualTolerance,
    calculatedValue: primary ? primary.relResidual : null,
    units: 'relative residual',
    errorPercent: null,
    tolerancePercent: null,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : 'Sparse Cholesky residual or solution accuracy exceeded thresholds for the generated ill-conditioned SPD systems.',
    measured: {
      primaryCase: primary
        ? {
            label: primary.label,
            relResidual: primary.relResidual,
            maxSolutionError: primary.maxSolutionError,
            kappaEstimate: primary.kappaEstimate
          }
        : null,
      allCases: outcomes.map((o) => ({
        label: o.label,
        relResidual: o.relResidual,
        maxSolutionError: o.maxSolutionError,
        kappaEstimate: o.kappaEstimate,
        nnzL: o.nnzL,
        factorMs: o.factorMs,
        error: o.error || null
      }))
    },
    expected: {
      residualThreshold: residualTolerance,
      solutionThreshold: solutionTolerance,
      note: 'Original NIST archive is not bundled or used; this is a separate generated sparse SPD suite.'
    },
    details: {
      reference: 'Generated sparse SPD robustness suite; not the original NIST archive.',
      solver: 'WasmSparseMultifrontalSolver (production sparse Cholesky, nested-dissection ordering)',
      construction: {
        dimension: N,
        family: "A = D + eps * (B*B' / ||B*B'||), D_i = 10^(-alpha i/(n-1))",
        lowRankB: 'n x 50 random sparse +/-1 (density 12%)',
        knownSolution: 'x_exact[i] = sin((i+1)*0.05) + 1; b = A x_exact'
      }
    }
  };
}

/**
 * NIST V&V runner: Section A ingests the bundled Matrix Market suite (real
 * NIST files, production solver, relative residual <= 1e-8); Section B keeps
 * the generated-SPD checks as a separate, clearly-labelled section. The
 * generated checks above are untouched; this wrapper runs both and merges the
 * reports.
 *
 * @returns {Object} validation-style result
 */
function runNistSparseRobustnessWithMatrixMarket() {
  const matrixMarket = runMatrixMarketSuite();
  const generated = runNistSparseRobustness();
  const passed = Boolean(matrixMarket.passed && generated.passed);
  return {
    id: 'NIST_SPARSE_ROBUSTNESS_MATRIX_MARKET_PLUS_GENERATED',
    name: 'NIST V&V sparse case (real Matrix Market files, production sparse Cholesky, relative residual <= 1e-8) + separate generated-SPD checks',
    targetValue: matrixMarket.targetValue,
    calculatedValue: matrixMarket.calculatedValue,
    units: 'relative residual (Euclidean, ||b-Ax||2/||b||2)',
    errorPercent: null,
    tolerancePercent: null,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : 'Either the NIST Matrix Market suite (relative residual threshold 1e-8) or the separate generated-SPD suite exceeded its threshold.',
    measured: {
      nistVVMatrixMarketSuite: matrixMarket.measured,
      generatedSparseSpdSuite: generated.measured,
      nistVVTargetRelativeResidual: matrixMarket.targetValue,
      generatedSuiteThreshold: generated.targetValue
    },
    expected: {
      matrixMarketRelativeResidualThreshold: matrixMarket.targetValue,
      generatedSuiteRelativeResidualThreshold: generated.targetValue,
      note: 'Section A (NIST V&V): real Matrix Market files bcsstk01 and nos4 (+ labelled synthetic wathen substitution), requires relative residual <= 1e-8. Section B (separate): generated-SPD robustness checks. The prescribed bcsstk14.mtx download from math.nist.gov returned HTTP 404 (and .mtx.gz 300); bcsstk14 was not added and the two existing real files are used.'
    },
    details: {
      reference:
        'math.nist.gov/MatrixMarket Harwell-Boeing archive (bcsstk01, nos4) pinned by SHA-256 + documented synthetic substitute.',
      solver: 'WasmSparseMultifrontalSolver (production sparse Cholesky, nested-dissection ordering)',
      residualDefinition:
        'Section A: ||b - A x||2 / ||b||2 (asserted <= 1e-8); componentwise max_i |(Ax-b)_i| / ((|A||x|+|b|)_i) also recorded. Section B: ||b - A x||2 / ||b||2 for the generated SPD systems.'
    }
  };
}

module.exports = {
  runManufacturedSparseSPD,
  runNistSparseRobustness,
  runNistSparseRobustnessWithMatrixMarket
};

if (require.main === module) {
  const r = runNistSparseRobustnessWithMatrixMarket();
  console.log('\n' + r.id);
  console.log('  status:', r.status);
  console.log('  [Section A - NIST V&V] Matrix Market suite (production sparse Cholesky, relative residual <= 1e-8):');
  for (const m of r.measured.nistVVMatrixMarketSuite.matrices) {
    const kind = m.syntheticSubstitute ? 'synthetic substitute (labelled)' : 'real NIST file';
    if (m.error) {
      console.log(`    ${m.id} [${kind}] ERROR: ${m.error}`);
      continue;
    }
    const verdict = m.residual.relativeEuclidean <= r.targetValue ? 'PASS' : 'FAIL';
    console.log(
      `    ${m.id} [${kind}] size=${m.size.nRows}x${m.size.nCols} nnz=${m.size.nnz} ` +
        `relResidual=${m.residual.relativeEuclidean.toExponential(3)} compwise=${m.residual.componentwiseRel.toExponential(3)} ` +
        `sha256Match=${m.hashMatches} => ${verdict}`
    );
  }
  console.log('  [Section B - separate] generated-SPD robustness checks:');
  for (const o of r.measured.generatedSparseSpdSuite.allCases) {
    if (o.error) {
      console.log(`    ${o.label}: ERROR ${o.error}`);
      continue;
    }
    console.log(
      `    ${o.label}: relResidual=${o.relResidual !== null ? o.relResidual.toExponential(3) : 'n/a'} ` +
        `maxSolErr=${o.maxSolutionError !== null ? o.maxSolutionError.toExponential(3) : 'n/a'} ` +
        `kappaEstimate=${o.kappaEstimate !== null && o.kappaEstimate !== Infinity ? o.kappaEstimate.toExponential(2) : 'inf'}`
    );
  }
  console.log(
    '  bcsstk14 note: curl https://math.nist.gov/MatrixMarket/data/Harwell-Boeing/bcsstruc1/bcsstk14.mtx -> HTTP 404 ' +
      '(and .mtx.gz -> 300); bcsstk14 NOT added; the two existing real files are retained.'
  );
  if (!r.passed) process.exitCode = 1;
}
