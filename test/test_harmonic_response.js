/**
 * HARMONIC_RESPONSE - modal analysis and harmonic response verification gate.
 * Battalion 5, Agent 46.
 *
 * Checks:
 *  1. Cantilever beam modal frequencies (Euler-Bernoulli closed form):
 *     f_i = (beta_i^2 / (2*pi*L^2)) * sqrt(E*I/(rho*A)) with beta*L =
 *     1.8751, 4.6941, 7.8548. A 20-element uniform cantilever FE model
 *     (consistent mass) must match the first three frequencies to better
 *     than 0.5% (mesh-converged).
 *  2. Rayleigh damping: alpha/beta from two target damping ratios must
 *     match the closed-form solution of
 *     [1/(2*w1), w1/2; 1/(2*w2), w2/2] [alpha; beta] = [zeta1; zeta2]
 *     to 1e-9.
 *  3. SDOF harmonic response: |X/F| = 1/sqrt((k - m*w^2)^2 + (c*w)^2),
 *     phase = atan2(-c*w, k - m*w^2); engine matches closed form to
 *     1e-9 relative at w/wn = 0.5, 1.0, 1.5 for zeta = 0.05 (magnitude
 *     and phase).
 *  4. Modal superposition: a 2-DOF mass-spring system with analytic modes
 *     computed by hand in this test; the engine's modal-coordinate harmonic
 *     response equals the direct full-system response to 1e-6.
 *  5. Resonance peak: for SDOF the exact damped peak occurs at
 *     w = wn*sqrt(1 - 2*zeta^2); the engine's sweep must report the peak
 *     at this frequency.
 *
 * Run standalone:  node --test test/test_harmonic_response.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assembleBeamSystem,
  solveModalSubspace,
  rayleighFromTargets
} = require('../src/core/cae/beam_dynamic_response');
const {
  solveGeneralizedEigen,
  rayleighDampingCoefficients,
  sdofHarmonicResponse,
  sdofResonanceFrequency,
  modalHarmonicFRF,
  directHarmonicFRF
} = require('../src/core/cae/structural_dynamics_eigensolver');

const CANTILEVER_BETA_L = [1.87510406871196, 4.69409113297417, 7.85475743823761];

function eulerBernoulliCantileverHz(betaL, p) {
  const EI = p.E * p.I;
  return ((betaL * betaL) / (2 * Math.PI * p.L * p.L)) * Math.sqrt(EI / (p.rho * p.A));
}

function buildCantileverBeam(nElements) {
  const L = 1.0;
  const width = 0.02;
  const depth = 0.01;
  const nodesY = [];
  for (let i = 0; i <= nElements; i++) nodesY.push((i * L) / nElements);
  const elements = [];
  for (let i = 0; i < nElements; i++) elements.push({ a: i, b: i + 1, width, depth });
  const fixedDofs = new Set([0, 1]);
  return assembleBeamSystem({
    nodesY,
    elements,
    E: 210e9,
    nu: 0.3,
    rho: 7850,
    fixedDofs
  });
}

test('cantilever beam first 3 modal frequencies vs Euler-Bernoulli closed form', () => {
  const p = { E: 210e9, I: (0.02 * 0.01 * 0.01 * 0.01) / 12, rho: 7850, A: 0.02 * 0.01, L: 1.0 };

  const coarse = solveModalSubspace(buildCantileverBeam(10), { count: 5, tol: 1e-11 });
  const fine = solveModalSubspace(buildCantileverBeam(20), { count: 5, tol: 1e-11 });

  const measured = [];
  const relErrs = [];
  const refs = [];
  for (let i = 0; i < 3; i++) {
    const fMeasured = fine.modes[i].fHz;
    const fRef = eulerBernoulliCantileverHz(CANTILEVER_BETA_L[i], p);
    const relErr = Math.abs(fMeasured - fRef) / fRef;
    measured.push(fMeasured);
    relErrs.push(relErr);
    refs.push(fRef);
    assert.ok(
      relErr < 0.005,
      `mode ${i + 1}: measured ${fMeasured.toFixed(6)} Hz vs closed form ${fRef.toFixed(6)} Hz (rel err ${(relErr * 100).toFixed(4)}%)`
    );
    const meshChange = Math.abs(fine.modes[i].fHz - coarse.modes[i].fHz) / fine.modes[i].fHz;
    assert.ok(
      meshChange < 5e-4,
      `mode ${i + 1}: mesh not converged (10 vs 20 elements change ${(meshChange * 100).toFixed(4)}%)`
    );
  }
  console.log(`  cantilever (20 elements) measured f1-f3 = ${measured.map((f) => f.toFixed(4)).join(', ')} Hz`);
  console.log(`  closed form f1-f3 = ${refs.map((f) => f.toFixed(4)).join(', ')} Hz`);
  console.log(
    `  rel err vs Euler-Bernoulli closed form = ${relErrs.map((e) => (e * 100).toFixed(4) + '%').join(', ')}`
  );
});

test('Rayleigh damping alpha/beta from two targets match hand-solved 2x2', () => {
  const w1 = 10;
  const w2 = 30;
  const zeta1 = 0.02;
  const zeta2 = 0.05;

  const den = w2 * w2 - w1 * w1;
  const alphaRef = (2 * w1 * w2 * (zeta1 * w2 - zeta2 * w1)) / den;
  const betaRef = (2 * (zeta2 * w2 - zeta1 * w1)) / den;

  const fromBeamModule = rayleighFromTargets([w1, w2], [zeta1, zeta2]);
  const fromStructuralModule = rayleighDampingCoefficients(w1, w2, zeta1, zeta2);

  for (const r of [fromBeamModule, fromStructuralModule]) {
    assert.ok(Math.abs(r.alpha - alphaRef) <= 1e-9, `alpha = ${r.alpha}, reference ${alphaRef}`);
    assert.ok(Math.abs(r.beta - betaRef) <= 1e-9, `beta = ${r.beta}, reference ${betaRef}`);
  }
});

function sdofReference(p, omega) {
  const re = p.k - p.m * omega * omega;
  const im = p.c * omega;
  const mag = 1 / Math.sqrt(re * re + im * im);
  const phase = Math.atan2(-im, re);
  return { mag, phase };
}

test('SDOF harmonic response matches closed form at w/wn = 0.5, 1.0, 1.5', () => {
  const k = 100;
  const m = 1;
  const zeta = 0.05;
  const wn = Math.sqrt(k / m);
  const c = 2 * zeta * wn * m;
  const p = { k, m, c };

  const ratios = [0.5, 1.0, 1.5];
  const omegas = ratios.map((r) => r * wn);
  const engine = sdofHarmonicResponse(p, omegas);

  for (let i = 0; i < omegas.length; i++) {
    const ref = sdofReference(p, omegas[i]);
    const relMag = Math.abs(engine[i].mag - ref.mag) / ref.mag;
    const relPhase = Math.abs(engine[i].phaseRad - ref.phase) / Math.max(Math.abs(ref.phase), 1e-12);
    assert.ok(relMag <= 1e-9, `w/wn=${ratios[i]} mag rel err ${relMag}`);
    assert.ok(relPhase <= 1e-9, `w/wn=${ratios[i]} phase rel err ${relPhase}`);
  }
});

function twoDofSystem() {
  const sq5 = Math.sqrt(5);
  const lambda1 = (3 - sq5) / 2;
  const lambda2 = (3 + sq5) / 2;
  const omega1 = Math.sqrt(lambda1);
  const omega2 = Math.sqrt(lambda2);

  const q1 = (1 + sq5) / 2;
  const q2 = (1 - sq5) / 2;
  const norm1 = Math.sqrt(1 + q1 * q1);
  const norm2 = Math.sqrt(1 + q2 * q2);

  const K = [
    [2, -1],
    [-1, 1]
  ];
  const M = [
    [1, 0],
    [0, 1]
  ];

  const zeta1 = 0.02;
  const zeta2 = 0.04;
  const damp = rayleighDampingCoefficients(omega1, omega2, zeta1, zeta2);
  const C = [
    [damp.alpha * M[0][0] + damp.beta * K[0][0], damp.alpha * M[0][1] + damp.beta * K[0][1]],
    [damp.alpha * M[1][0] + damp.beta * K[1][0], damp.alpha * M[1][1] + damp.beta * K[1][1]]
  ];
  return { K, M, C, omega1, omega2, q1, q2, norm1, norm2 };
}

test('2-DOF modal superposition equals direct harmonic response (analytic modes)', () => {
  const { K, M, C, omega1, omega2, q1, q2, norm1, norm2 } = twoDofSystem();

  const eig = solveGeneralizedEigen(K, M, { count: 2, tol: 1e-13 });
  assert.ok(eig.converged, 'subspace iteration must converge');
  assert.ok(Math.abs(eig.modes[0].omega - omega1) / omega1 <= 1e-9, 'mode 1 frequency vs analytic');
  assert.ok(Math.abs(eig.modes[1].omega - omega2) / omega2 <= 1e-9, 'mode 2 frequency vs analytic');

  const shape1 = eig.modes[0].shape;
  const shape2 = eig.modes[1].shape;
  const e1x = 1 / norm1;
  const e1y = q1 / norm1;
  const e2x = 1 / norm2;
  const e2y = q2 / norm2;
  assert.ok(Math.abs(shape1[0] * e1x + shape1[1] * e1y) >= 1 - 1e-9, 'mode 1 shape aligns with analytic eigenvector');
  assert.ok(Math.abs(shape2[0] * e2x + shape2[1] * e2y) >= 1 - 1e-9, 'mode 2 shape aligns with analytic eigenvector');

  const damp = rayleighDampingCoefficients(omega1, omega2, 0.02, 0.04);
  const omegas = [0.3, 0.6, omega1, 0.8, 1.2, omega2, 2.0];

  for (const loadDof of [0, 1]) {
    for (const responseDof of [0, 1]) {
      const modal = modalHarmonicFRF(eig.modes, damp, omegas, loadDof, responseDof);
      const direct = directHarmonicFRF(K, M, C, omegas, loadDof, responseDof);
      for (let i = 0; i < omegas.length; i++) {
        const relMag = Math.abs(modal[i].mag - direct[i].mag) / Math.max(direct[i].mag, 1e-30);
        const relRe = Math.abs(modal[i].re - direct[i].re) / Math.max(Math.abs(direct[i].re), 1e-30);
        const relIm = Math.abs(modal[i].im - direct[i].im) / Math.max(Math.abs(direct[i].im), 1e-30);
        assert.ok(
          relMag <= 1e-6,
          `modal vs direct mag rel err ${relMag} (load ${loadDof}, resp ${responseDof}, w=${omegas[i]})`
        );
        assert.ok(relRe <= 1e-6, `modal vs direct re rel err ${relRe}`);
        assert.ok(relIm <= 1e-6, `modal vs direct im rel err ${relIm}`);
      }
    }
  }
});

test('SDOF resonance peak reported at w = wn*sqrt(1 - 2*zeta^2)', () => {
  const k = 100;
  const m = 1;
  const zeta = 0.05;
  const wn = Math.sqrt(k / m);
  const c = 2 * zeta * wn * m;
  const p = { k, m, c };

  const wPeak = sdofResonanceFrequency(wn, zeta);
  const wLo = wn * 0.95;
  const wHi = wn * 1.05;
  const step = 0.001;
  const omegas = [];
  for (let w = wLo; w <= wHi + 1e-12; w += step) omegas.push(w);

  const engine = sdofHarmonicResponse(p, omegas);
  let peakIdx = 0;
  for (let i = 1; i < engine.length; i++) {
    if (engine[i].mag > engine[peakIdx].mag) peakIdx = i;
  }
  const wReported = engine[peakIdx].omega;
  assert.ok(Math.abs(wReported - wPeak) <= 0.0015, `reported peak ${wReported} vs exact damped peak ${wPeak}`);

  const ref = sdofReference(p, wPeak);
  const relMag = Math.abs(engine[peakIdx].mag - ref.mag) / ref.mag;
  assert.ok(relMag <= 1e-3, `peak magnitude rel err ${relMag}`);
  console.log(
    `  SDOF zeta=0.05: exact damped peak w=${wPeak.toFixed(5)} rad/s, engine argmax w=${wReported.toFixed(5)} rad/s, |X/F|_peak=${engine[peakIdx].mag.toFixed(6)}`
  );
});
