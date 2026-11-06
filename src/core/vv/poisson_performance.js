'use strict';

const { WasmSparseMultifrontalSolver } = require('../math/wasm_sparse_multifrontal');

function resolvePerformanceBudgetMs(explicitBudgetMs) {
  if (explicitBudgetMs !== undefined) return explicitBudgetMs;
  const parsed = Number.parseInt(process.env.POISSON_BUDGET_MS ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10000;
}

function measureStructuredPoissonBudget({
  gridSize = 316,
  rightHandSide = 1,
  performanceBudgetMs = resolvePerformanceBudgetMs(),
  generalSparse = false
} = {}) {
  if (!Number.isInteger(gridSize) || gridSize < 2) {
    throw new RangeError('gridSize must be an integer greater than one.');
  }
  if (!Number.isFinite(rightHandSide)) {
    throw new TypeError('rightHandSide must be finite.');
  }
  if (!Number.isFinite(performanceBudgetMs) || performanceBudgetMs <= 0) {
    throw new RangeError('performanceBudgetMs must be a positive finite number.');
  }
  if (typeof generalSparse !== 'boolean') {
    throw new TypeError('generalSparse must be a boolean.');
  }

  const unknowns = gridSize * gridSize;
  const matrix = new WasmSparseMultifrontalSolver(
    unknowns,
    unknowns,
    generalSparse ? { enableStructuredPoissonDirect: false } : {}
  );
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const i = y * gridSize + x;
      matrix.addEntry(i, i, 4);
      if (x > 0) matrix.addEntry(i, i - 1, -1);
      if (x + 1 < gridSize) matrix.addEntry(i, i + 1, -1);
      if (y > 0) matrix.addEntry(i, i - gridSize, -1);
      if (y + 1 < gridSize) matrix.addEntry(i, i + gridSize, -1);
    }
  }

  const rhs = new Float64Array(unknowns).fill(rightHandSide);
  const startedAt = performance.now();
  const factorization = matrix.factorize();
  const result = matrix.solve(rhs);
  const elapsedMs = performance.now() - startedAt;

  let residualSquared = 0;
  let rhsSquared = 0;
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const i = y * gridSize + x;
      let value = 4 * result.solution[i];
      if (x > 0) value -= result.solution[i - 1];
      if (x + 1 < gridSize) value -= result.solution[i + 1];
      if (y > 0) value -= result.solution[i - gridSize];
      if (y + 1 < gridSize) value -= result.solution[i + gridSize];
      const residual = rhs[i] - value;
      residualSquared += residual * residual;
      rhsSquared += rhs[i] * rhs[i];
    }
  }

  const solutionResidualRelativeL2 = Math.sqrt(residualSquared) / (Math.sqrt(rhsSquared) || 1);

  if (generalSparse && (solutionResidualRelativeL2 >= 1e-9 || result.relativeResidual >= 1e-9)) {
    throw new Error(
      `General sparse Poisson solve failed correctness gate: independent relative residual = ` +
        `${solutionResidualRelativeL2}, solver relative residual = ${result.relativeResidual} (must be < 1e-9).`
    );
  }

  return {
    gridSize,
    unknowns,
    elapsedMs,
    performanceBudgetMs,
    withinPerformanceBudget: elapsedMs < performanceBudgetMs,
    solverMethod: factorization.solverMethod,
    nnzL: factorization.nnzL,
    factorizationStorageBytes: factorization.factorizationStorageBytes,
    solutionResidualRelativeL2,
    relativeResidual: result.relativeResidual,
    independentResidualRms: Math.sqrt(residualSquared / unknowns),
    generalSparse
  };
}

module.exports = { measureStructuredPoissonBudget };
