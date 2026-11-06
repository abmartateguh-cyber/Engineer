/**
 * Verification gate for the large-deformation continuum FEA engine
 * (src/core/cae/nonlinear_continuum_fea.js).
 *
 * Verifies:
 *  - Deformation gradient F, Green-Lagrange strain E, volume ratio J for a
 *    prescribed affine simple shear (analytic values to 1e-9).
 *  - Polar decomposition F = R*U for a pure stretch and a pure rotation.
 *  - Large-displacement cantilever under an end moment M = EI*kappa with
 *    kappa*L = pi/2: the elastica is a circular arc, tip at
 *    (L sin(kL)/kL, L (1 - cos(kL))/kL) = (2L/pi, 2L/pi).
 *  - Small-load recovery of the linear Euler-Bernoulli deflection.
 *  - Newton-Raphson load stepping converges quadratically (residual ratio
 *    below 0.1 between the last two iterations at the final load step).
 *  - Energy balance: external moment work equals internal strain energy.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NonlinearContinuumFEA, NonlinearPlanarBeamSolver } = require('../src/core/cae/nonlinear_continuum_fea');

const fea = new NonlinearContinuumFEA();

function matMul(A, B) {
  const n = A.length;
  const C = [];
  for (let i = 0; i < n; i++) {
    C.push([]);
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += A[i][k] * B[k][j];
      C[i].push(s);
    }
  }
  return C;
}

function matTranspose(A) {
  const n = A.length;
  const T = [];
  for (let j = 0; j < n; j++) {
    T.push([]);
    for (let i = 0; i < n; i++) T[j].push(A[i][j]);
  }
  return T;
}

function matMaxAbsDiff(A, B) {
  let d = 0;
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < A[i].length; j++) {
      d = Math.max(d, Math.abs(A[i][j] - B[i][j]));
    }
  }
  return d;
}

function identity3() {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
}

test('deformation gradient: simple shear gamma=0.5 matches analytic F, E, J to 1e-9', () => {
  const gamma = 0.5;
  const gradU = [
    [0, gamma, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  const { F, E, J } = fea.computeDeformationTensors(gradU);

  const Fexpected = [
    [1, gamma, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  assert.ok(matMaxAbsDiff(F, Fexpected) <= 1e-9, 'F must match prescribed affine deformation');

  const C = matMul(matTranspose(Fexpected), Fexpected);
  const Eexpected = C.map((row, i) => row.map((v, j) => 0.5 * (v - (i === j ? 1 : 0))));
  assert.ok(matMaxAbsDiff(E, Eexpected) <= 1e-9, 'E = 0.5 (F^T F - I) must match analytic Green-Lagrange strain');

  assert.equal(J, 1.0, 'J = det(F) must be 1 for isochoric simple shear');
  assert.ok(Math.abs(E[0][1] - 0.25) <= 1e-9, 'E12 = gamma/2 = 0.25');
  assert.ok(Math.abs(E[1][1] - 0.125) <= 1e-9, 'E22 = gamma^2/2 = 0.125');
});

test('polar decomposition: pure stretch F = diag(2, 0.5) gives R = I, U = F', () => {
  const F = [
    [2, 0, 0],
    [0, 0.5, 0],
    [0, 0, 1]
  ];
  const { R, U } = fea.polarDecompose(F);

  assert.ok(matMaxAbsDiff(R, identity3()) <= 1e-9, 'R must be the identity for a pure stretch');
  assert.ok(matMaxAbsDiff(U, F) <= 1e-9, 'U must equal F for a pure stretch');
  assert.ok(matMaxAbsDiff(U, matTranspose(U)) <= 1e-9, 'U must be symmetric');
  assert.ok(matMaxAbsDiff(matMul(R, matTranspose(R)), identity3()) <= 1e-9, 'R must be orthogonal');
});

test('polar decomposition: pure rotation of 30 deg gives U = I, R = rotation matrix', () => {
  const th = Math.PI / 6;
  const F = [
    [Math.cos(th), -Math.sin(th), 0],
    [Math.sin(th), Math.cos(th), 0],
    [0, 0, 1]
  ];
  const { R, U } = fea.polarDecompose(F);

  assert.ok(matMaxAbsDiff(U, identity3()) <= 1e-9, 'U must be the identity for a pure rotation');
  assert.ok(matMaxAbsDiff(R, F) <= 1e-9, 'R must reproduce the rotation matrix');
  assert.ok(matMaxAbsDiff(matMul(R, matTranspose(R)), identity3()) <= 1e-9, 'R must be orthogonal');
});

function solveCantilever(options) {
  const solver = new NonlinearPlanarBeamSolver(options);
  return solver.solveEndMomentCantilever({
    length: 1.0,
    moment: Math.PI / 2,
    numElements: 48
  });
}

test('cantilever under end moment: 90 deg elastica (tip at (2L/pi, 2L/pi)) within 2%', (t) => {
  const res = solveCantilever({ EI: 1, EA: 1e6, loadSteps: 10, tolerance: 1e-4, maxIterations: 40 });
  assert.ok(res.converged, 'load stepping must converge');

  const L = 1.0;
  const kL = Math.PI / 2;
  const expX = (L * Math.sin(kL)) / kL; // 2L/pi
  const expY = (L * (1 - Math.cos(kL))) / kL; // 2L/pi
  const errX = Math.abs(res.tipX - expX) / expX;
  const errY = Math.abs(res.tipY - expY) / expY;

  t.diagnostic(
    `measured tip = (${res.tipX.toFixed(7)}, ${res.tipY.toFixed(7)}), ` +
      `elastica = (${expX.toFixed(7)}, ${expY.toFixed(7)}), ` +
      `errX = ${(errX * 100).toFixed(4)}%, errY = ${(errY * 100).toFixed(4)}%, ` +
      `tip rotation = ${res.tipRotation.toFixed(7)} rad (target pi/2)`
  );

  assert.ok(errX < 0.02, `tip x must match elastica within 2% (measured err ${errX})`);
  assert.ok(errY < 0.02, `tip y must match elastica within 2% (measured err ${errY})`);
  assert.ok(Math.abs(res.tipRotation - kL) < 0.01, 'tip rotation must reach pi/2 (90 deg)');
});

test('cantilever energy balance: external moment work equals internal strain energy within 1%', (t) => {
  const res = solveCantilever({ EI: 1, EA: 1e6, loadSteps: 10, tolerance: 1e-4, maxIterations: 40 });
  t.diagnostic(
    `internal strain energy = ${res.internalStrainEnergy.toFixed(8)}, ` +
      `external work = ${res.externalWork.toFixed(8)}, ` +
      `relative error = ${(res.relativeEnergyError * 100).toFixed(6)}%`
  );
  assert.ok(res.relativeEnergyError < 0.01, 'external work must equal internal strain energy within 1%');
});

test('St. Venant-Kirchhoff vs linear: small end moment matches Euler-Bernoulli within 1%', (t) => {
  const EI = 1.0;
  const L = 1.0;
  const M = 1e-3;
  const solver = new NonlinearPlanarBeamSolver({ EI, EA: 1e6, loadSteps: 4, tolerance: 1e-6, maxIterations: 30 });
  const res = solver.solveEndMomentCantilever({ length: L, moment: M, numElements: 24 });

  const linearTipDeflection = (M * L * L) / (2 * EI);
  const rel = Math.abs(res.tipY - linearTipDeflection) / linearTipDeflection;
  t.diagnostic(
    `small-load tip y = ${res.tipY.toExponential(6)}, ` +
      `linear Euler-Bernoulli = ${linearTipDeflection.toExponential(6)}, ` +
      `relative difference = ${(rel * 100).toExponential(3)}%`
  );
  assert.ok(rel < 0.01, 'nonlinear solution must reduce to linear Euler-Bernoulli deflection within 1%');
});

test('Newton convergence: residual ratio below 0.1 between last two iterations of final step', (t) => {
  const solver = new NonlinearPlanarBeamSolver({ EI: 1, EA: 1e3, loadSteps: 6, tolerance: 1e-10, maxIterations: 30 });
  const res = solver.solveEndMomentCantilever({ length: 1, moment: 0.5, numElements: 8 });
  assert.ok(res.converged, 'all load steps must converge');

  const finalStep = res.residualHistory[res.residualHistory.length - 1];
  const r = finalStep.residuals;
  assert.ok(r.length >= 2, 'final load step must need at least two Newton iterations');
  const ratio = r[r.length - 1] / r[r.length - 2];
  t.diagnostic(`final step residual sequence: ${r.map((x) => x.toExponential(3)).join(' ')}`);
  t.diagnostic(`residual ratio between last two iterations = ${ratio.toExponential(3)} (must be < 0.1)`);
  assert.ok(ratio < 0.1, 'Newton residual must reduce by more than 10x in the final iteration (quadratic regime)');
  assert.ok(
    finalStep.finalResidual <= solver.tolerance * Math.max(1, Math.abs(0.5)),
    'final residual must satisfy tolerance'
  );
});
