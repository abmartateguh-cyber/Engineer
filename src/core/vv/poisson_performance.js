'use strict';

const { WasmSparseMultifrontalSolver } = require('../math/wasm_sparse_multifrontal');

function measureStructuredPoissonBudget({ gridSize = 316, rightHandSide = 1, performanceBudgetMs = 2000 } = {}) {
  if (!Number.isInteger(gridSize) || gridSize < 2) {
    throw new RangeError('gridSize must be an integer greater than one.');
  }
  if (!Number.isFinite(rightHandSide)) {
    throw new TypeError('rightHandSide must be finite.');
  }
  if (!Number.isFinite(performanceBudgetMs) || performanceBudgetMs <= 0) {
    throw new RangeError('performanceBudgetMs must be a positive finite number.');
  }

  const unknowns = gridSize * gridSize;
  const matrix = new WasmSparseMultifrontalSolver(unknowns, unknowns);
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
    }
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
    relativeResidual: result.relativeResidual,
    independentResidualRms: Math.sqrt(residualSquared / unknowns)
  };
}

module.exports = { measureStructuredPoissonBudget };
