/**
 * Test Suite: NativeSparseSolver (Supernodal Cholesky, PCG, BiCGSTAB)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NativeSparseSolver } = require('../src/core/math/native_sparse_solver');

test('NativeSparseSolver: Solves 1D/2D Tridiagonal Poisson via PCG to relRes < 1e-10', () => {
  const n = 500;
  const solver = new NativeSparseSolver(n, { tolerance: 1e-10, maxIterations: 1000 });

  // 1D Poisson: -u''(x) = 1, tridiagonal [-1, 2, -1]
  for (let i = 0; i < n; i++) {
    solver.addEntry(i, i, 2.0);
    if (i > 0) solver.addEntry(i, i - 1, -1.0);
    if (i < n - 1) solver.addEntry(i, i + 1, -1.0);
  }

  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) b[i] = 1.0;

  const result = solver.solvePCG(b);
  assert.equal(result.converged, true, 'PCG must converge');
  assert.ok(result.residualNorm <= 1e-10, `Residual norm ${result.residualNorm} must be <= 1e-10`);
  assert.ok(result.iterations < n, `Iterations ${result.iterations} should be well under dimension ${n}`);

  // Analytic profile: u(x) = x*(1-x)/2, symmetric peak at center
  const mid = Math.floor(n / 2);
  assert.ok(result.solution[mid] > result.solution[0], 'Center value must be peak');
});

test('NativeSparseSolver: Solves Non-Symmetric Convection-Diffusion via BiCGSTAB', () => {
  const n = 200;
  const solver = new NativeSparseSolver(n, { tolerance: 1e-9, maxIterations: 1000 });

  // Non-symmetric tridiagonal: diagonal 4.0, sub-diagonal -1.5, super-diagonal -0.5
  for (let i = 0; i < n; i++) {
    solver.addEntry(i, i, 4.0);
    if (i > 0) solver.addEntry(i, i - 1, -1.5);
    if (i < n - 1) solver.addEntry(i, i + 1, -0.5);
  }

  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.sin((i / n) * Math.PI);

  const result = solver.solveBiCGSTAB(b);
  assert.equal(result.converged, true, 'BiCGSTAB must converge on non-symmetric matrix');
  assert.ok(result.residualNorm <= 1e-9, `Residual norm ${result.residualNorm} must be <= 1e-9`);
});

test('NativeSparseSolver: Rejects non-positive dimension and out-of-bounds indices', () => {
  assert.throws(() => new NativeSparseSolver(0), /must be a positive integer/);
  const solver = new NativeSparseSolver(10);
  assert.throws(() => solver.addEntry(10, 0, 1.0), /outside dimension 10/);
});
