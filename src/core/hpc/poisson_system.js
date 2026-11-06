'use strict';

const { SparseMatrixCSR } = require('../math/sparse_cholesky');

/**
 * Builds the 5-point finite-difference discretization of the 2D Poisson
 * operator -Delta u = f on a uniform N x N interior grid with Dirichlet
 * boundary conditions (u = 0 on the boundary). The resulting system is
 * symmetric positive-definite, which is the target of the production
 * SparseCholeskySolver in src/core/math/sparse_cholesky.js.
 *
 * The RHS mixes low-order Fourier modes with a smooth bump so the system is
 * non-trivial and requires genuine iterative work to converge.
 *
 * @param {number} n - Interior grid points per side (system dimension is n*n)
 * @param {object} [options]
 * @param {string} [options.rhsMode='multi-mode'] - 'multi-mode' | 'single-mode'
 * @returns {{A: SparseMatrixCSR, b: Float64Array, n: number, nnz: number}}
 */
function buildPoissonSystem(n, options = {}) {
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new TypeError(`buildPoissonSystem requires a positive integer grid size, received ${JSON.stringify(n)}`);
  }
  const rhsMode = options.rhsMode || 'multi-mode';
  const n2 = n * n;
  const A = new SparseMatrixCSR(n2, n2);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const row = j * n + i;
      A.addEntry(row, row, 4);
      if (i > 0) A.addEntry(row, row - 1, -1);
      if (i < n - 1) A.addEntry(row, row + 1, -1);
      if (j > 0) A.addEntry(row, row - n, -1);
      if (j < n - 1) A.addEntry(row, row + n, -1);
    }
  }
  A.finalize();

  const b = new Float64Array(n2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = (i + 1) / (n + 1);
      const y = (j + 1) / (n + 1);
      if (rhsMode === 'single-mode') {
        b[k] = Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
      } else {
        const dx = x - 0.5;
        const dy = y - 0.5;
        b[k] =
          Math.sin(Math.PI * x) * Math.sin(Math.PI * y) +
          0.5 * Math.sin(3 * Math.PI * x) * Math.sin(2 * Math.PI * y) +
          0.25 * Math.exp(-(dx * dx + dy * dy) * 12);
      }
    }
  }

  return { A, b, n, nnz: A.rowPtr[n2] };
}

module.exports = {
  buildPoissonSystem
};
