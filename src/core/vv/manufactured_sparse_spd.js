/**
 * Manufactured solution for a small sparse SPD system.
 *
 * This is a numerical verification case with an analytically known solution.
 * It is not NIST data and is not a physical validation case.
 */
'use strict';

const { SparseMatrixCSR, SparseCholeskySolver } = require('../math/sparse_cholesky');

function runManufacturedSparseSPD() {
  const dimension = 200;
  const diagonal = new Float64Array(dimension);
  const offDiagonal = new Float64Array(dimension - 1);
  const exactSolution = new Float64Array(dimension);
  const matrix = new SparseMatrixCSR(dimension, dimension);

  for (let i = 0; i < dimension; i++) {
    diagonal[i] = 4 * 10 ** (-2.5 * (i / (dimension - 1)));
    exactSolution[i] = Math.sin((i + 1) * 0.1);
    matrix.addEntry(i, i, diagonal[i]);

    if (i + 1 < dimension) {
      // The same edge coefficient is inserted in both directions. Using the
      // smaller adjacent diagonal also keeps every row strictly diagonally
      // dominant, which establishes positive definiteness for this symmetric
      // tridiagonal matrix.
      offDiagonal[i] = -0.45 * Math.min(diagonal[i], 4 * 10 ** (-2.5 * ((i + 1) / (dimension - 1))));
      matrix.addEntry(i, i + 1, offDiagonal[i]);
      matrix.addEntry(i + 1, i, offDiagonal[i]);
    }
  }

  matrix.finalize();

  const multiplyByReferenceStencil = (vector, output) => {
    for (let i = 0; i < dimension; i++) {
      let value = diagonal[i] * vector[i];
      if (i > 0) value += offDiagonal[i - 1] * vector[i - 1];
      if (i + 1 < dimension) value += offDiagonal[i] * vector[i + 1];
      output[i] = value;
    }
  };

  const rhs = new Float64Array(dimension);
  multiplyByReferenceStencil(exactSolution, rhs);

  const solveResult = SparseCholeskySolver.solve(matrix, rhs, {
    maxIterations: 1000,
    tolerance: 1e-10,
    preconditioned: true
  });

  const recomputedProduct = new Float64Array(dimension);
  multiplyByReferenceStencil(solveResult.x, recomputedProduct);

  let residualSquared = 0;
  let rhsSquared = 0;
  let maxSolutionError = 0;
  let positiveDefinitenessMargin = Infinity;
  for (let i = 0; i < dimension; i++) {
    const residual = rhs[i] - recomputedProduct[i];
    residualSquared += residual * residual;
    rhsSquared += rhs[i] * rhs[i];
    maxSolutionError = Math.max(maxSolutionError, Math.abs(solveResult.x[i] - exactSolution[i]));

    const adjacentMagnitude =
      (i > 0 ? Math.abs(offDiagonal[i - 1]) : 0) + (i + 1 < dimension ? Math.abs(offDiagonal[i]) : 0);
    positiveDefinitenessMargin = Math.min(positiveDefinitenessMargin, diagonal[i] - adjacentMagnitude);
  }

  const relativeResidual = Math.sqrt(residualSquared) / (Math.sqrt(rhsSquared) || 1);
  const residualTolerance = 1e-8;
  const solutionTolerance = 1e-7;
  const passed =
    solveResult.converged &&
    relativeResidual < residualTolerance &&
    maxSolutionError < solutionTolerance &&
    positiveDefinitenessMargin > 0;

  return {
    id: 'MANUFACTURED_SPARSE_SPD',
    name: 'Manufactured sparse SPD verification case',
    targetValue: residualTolerance,
    calculatedValue: Number(relativeResidual.toExponential(4)),
    units: 'relative residual',
    errorPercent: null,
    tolerancePercent: null,
    passed,
    reason: passed ? undefined : 'Manufactured solution, residual, or SPD checks failed.',
    metadata: {
      dimension,
      iterations: solveResult.iterations,
      converged: solveResult.converged,
      maxSolutionError,
      positiveDefinitenessMargin,
      solverMethod: 'preconditioned conjugate gradient'
    }
  };
}

module.exports = { runManufacturedSparseSPD };
