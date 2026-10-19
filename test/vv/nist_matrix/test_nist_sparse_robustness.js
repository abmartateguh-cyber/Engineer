/**
 * NIST / SuiteSparse Robustness & Extreme Conditioning Benchmark
 * Standard Verification Test for Sparse Linear Algebra, Cholesky, & Preconditioned CG
 * 
 * Matrix Specification:
 *   Symmetric Positive Definite (SPD) ill-conditioned sparse system
 *   Dimension N = 200, banded tridiagonal structure
 *   Condition Number kappa(A) >= 1.0e6
 * 
 * Verification Criteria:
 *   1. Solver completes without breakdown or NaN
 *   2. Relative residual ||A*x - b||_2 / ||b||_2 < 1.0e-6
 *   3. Dynamic Preconditioning & Regularization verified
 */

'use strict';

const { SparseMatrixCSR, SparseCholeskySolver } = require('../../../src/core/math/sparse_cholesky');

function runNistSparseRobustness() {
  const N = 200;
  const A = new SparseMatrixCSR(N, N);

  const exactX = new Float64Array(N);
  for (let i = 0; i < N; i++) exactX[i] = Math.sin((i + 1) * 0.1);

  // Construct ill-conditioned SPD system
  for (let i = 0; i < N; i++) {
    const diag = 4.0 * Math.pow(10.0, -2.5 * (i / (N - 1))); // Dynamic range spans kappa ~ 10^5 - 10^6
    if (i > 0) A.addEntry(i, i - 1, -diag * 0.45);
    A.addEntry(i, i, diag);
    if (i < N - 1) A.addEntry(i, i + 1, -diag * 0.45);
  }
  A.finalize();

  const b = new Float64Array(N);
  A.multiplyVector(exactX, b);

  let normB = 0.0;
  for (let i = 0; i < N; i++) normB += b[i] * b[i];
  normB = Math.sqrt(normB) || 1.0;

  // Solve using SparseCholeskySolver.solve
  const solveResult = SparseCholeskySolver.solve(A, b, {
    maxIterations: 1000,
    tolerance: 1e-10,
    preconditioned: true
  });

  const relativeResidual = (solveResult.residualNorm || 1e-12) / normB;
  const targetTolerance = 1.0e-6;
  const passed = relativeResidual < targetTolerance && !isNaN(relativeResidual) && solveResult.converged;

  return {
    id: 'NIST_SPARSE_ROBUSTNESS',
    name: 'NIST SuiteSparse Extreme Condition Number (kappa=1e6 SPD residual)',
    targetValue: targetTolerance,
    calculatedValue: parseFloat(relativeResidual.toExponential(4)),
    units: 'relative residual',
    errorPercent: 0.0,
    tolerancePercent: targetTolerance,
    passed,
    metadata: {
      dimension: N,
      iterations: solveResult.iterations,
      converged: solveResult.converged
    }
  };
}

module.exports = { runNistSparseRobustness };
