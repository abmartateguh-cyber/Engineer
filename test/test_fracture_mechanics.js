/**
 * Verification Gate: Linear-Elastic Fracture Mechanics (OmniEng)
 *
 * Verifies the fracture mechanics engine in src/core/cae/fracture_mechanics.js
 * against closed-form analytic references evaluated independently in this file:
 *
 *   1. Mode I SIF extraction from the displacement-field crack-tip relation
 *        K_I = (E / (4(1 - nu^2))) * sqrt(2 pi / r) * v(r, theta=pi)
 *      for plane strain, with v the crack-face opening displacement. A small
 *      FE-like near-tip displacement pattern is generated from a known K_I
 *      and the engine's extraction must recover it to 0.5%.
 *
 *   2. ASTM E399 compact tension (CT) specimen geometry factor
 *        K_I = (P / (B sqrt(W))) * f(a/W)
 *      evaluated at a/W = 0.3, 0.5, 0.7; engine value must match the formula
 *      (f evaluated independently here) to 0.1%.
 *
 *   3. J-integral equivalence for linear-elastic plane strain
 *        J = K_I^2 * (1 - nu^2) / E
 *      engine J must match this conversion to 0.1% given K_I.
 *
 *   4. Mode II SIF extraction from the analogous sliding displacement relation
 *      (u_x ahead of the crack tip, theta = 0) to 0.5%.
 *
 *   5. Critical crack / toughness verdict given K_IC.
 *
 * All references are computed by hand from the engineering constants in this
 * file, independent of engine internals.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FractureMechanics } = require('../src/core/cae/fracture_mechanics');

const E = 210e9; // Young modulus, Pa
const NU = 0.3; // Poisson ratio (plane strain)
const TWO_PI = 2 * Math.PI;

function relDelta(measured, reference) {
  return Math.abs(measured - reference) / Math.abs(reference);
}

test('Mode I SIF extraction recovers input K_I from crack-face opening field (plane strain)', (t) => {
  const K_TARGET = 40e6; // Pa*sqrt(m) = 40 MPa*sqrt(m)
  const rSamples = [1e-4, 1.5e-4, 2e-4, 3e-4, 4e-4, 5e-4]; // m behind tip
  const samples = rSamples.map((r) => ({
    r,
    v: ((K_TARGET * (4 * (1 - NU * NU))) / E) * Math.sqrt(r / TWO_PI)
  }));

  const K_engine = FractureMechanics.extractSIFModeI({ E, nu: NU, planeStrain: true, samples });
  const d = relDelta(K_engine, K_TARGET);
  t.diagnostic(
    `Mode I SIF: engine=${K_engine.toExponential(6)} target=${K_TARGET.toExponential(4)} rel=${(d * 100).toExponential(3)}%`
  );
  assert.ok(d < 0.005, `Mode I K_I rel error ${(d * 100).toFixed(6)}% >= 0.5%`);
});

test('ASTM E399 CT geometry factor and K_I match formula at a/W = 0.3, 0.5, 0.7', (t) => {
  const P = 25000; // N
  const B = 0.025; // m
  const W = 0.05; // m
  const alphas = [0.3, 0.5, 0.7];

  for (const alpha of alphas) {
    // Independent evaluation of the ASTM E399 polynomial in this file.
    const poly =
      0.886 +
      4.64 * alpha -
      13.32 * alpha * alpha +
      14.72 * alpha * alpha * alpha -
      5.6 * alpha * alpha * alpha * alpha;
    const fRef = ((2 + alpha) / Math.pow(1 - alpha, 1.5)) * poly;
    const KRef = (P / (B * Math.sqrt(W))) * fRef;

    const fEngine = FractureMechanics.ctGeometryFactor(alpha);
    const KEngine = FractureMechanics.compactTensionSIF({ P, B, W, a: alpha * W });

    const df = relDelta(fEngine, fRef);
    const dK = relDelta(KEngine, KRef);
    t.diagnostic(
      `CT a/W=${alpha}: f eng=${fEngine.toFixed(6)} ref=${fRef.toFixed(6)} rel=${(df * 100).toExponential(3)}% | K eng=${KEngine.toExponential(6)} ref=${KRef.toExponential(6)} rel=${(dK * 100).toExponential(3)}%`
    );
    assert.ok(df < 0.001, `f(a/W) rel error ${(df * 100).toFixed(6)}% >= 0.1% at a/W=${alpha}`);
    assert.ok(dK < 0.001, `CT K_I rel error ${(dK * 100).toFixed(6)}% >= 0.1% at a/W=${alpha}`);
  }
});

test('J-integral equivalence J = K_I^2 (1 - nu^2)/E for plane strain', (t) => {
  const K_I = 50e6; // Pa*sqrt(m)
  const JRef = (K_I * K_I * (1 - NU * NU)) / E; // J/m^2
  const JEngine = FractureMechanics.JintegralFromSIF({ K_I, E, nu: NU, planeStrain: true });

  const d = relDelta(JEngine, JRef);
  t.diagnostic(`J: engine=${JEngine.toExponential(6)} ref=${JRef.toExponential(6)} rel=${(d * 100).toExponential(3)}%`);
  assert.ok(d < 0.001, `J rel error ${(d * 100).toFixed(6)}% >= 0.1%`);
});

test('Mode II SIF extraction recovers input K_II from sliding displacement field', (t) => {
  const K_TARGET = 20e6; // Pa*sqrt(m)
  const G = E / (2 * (1 + NU));
  const rSamples = [1e-4, 2e-4, 2.5e-4, 3.5e-4, 5e-4];
  const samples = rSamples.map((r) => ({
    r,
    ux: ((K_TARGET * (1 - 2 * NU)) / (2 * G)) * Math.sqrt(r / TWO_PI)
  }));

  const K_engine = FractureMechanics.extractSIFModeII({ E, nu: NU, planeStrain: true, samples });
  const d = relDelta(K_engine, K_TARGET);
  t.diagnostic(
    `Mode II K_II: engine=${K_engine.toExponential(6)} target=${K_TARGET.toExponential(4)} rel=${(d * 100).toExponential(3)}%`
  );
  assert.ok(d < 0.005, `Mode II K_II rel error ${(d * 100).toFixed(6)}% >= 0.5%`);
});

test('Critical crack/toughness verdict honors K_IC threshold', () => {
  const K_IC = 50e6;

  const above = FractureMechanics.assessFracture({ K_applied: 60e6, K_IC });
  assert.equal(above.cracked, true);
  assert.equal(above.verdict, 'cracked');
  assert.equal(above.margin, -10e6);

  const below = FractureMechanics.assessFracture({ K_applied: 40e6, K_IC });
  assert.equal(below.cracked, false);
  assert.equal(below.verdict, 'not-cracked');
  assert.equal(below.utilization, 0.8);

  const at = FractureMechanics.assessFracture({ K_applied: K_IC, K_IC });
  assert.equal(at.cracked, true);
});

test('validation guards reject out-of-domain inputs', () => {
  assert.throws(() => FractureMechanics.ctGeometryFactor(0.15), RangeError);
  assert.throws(() => FractureMechanics.ctGeometryFactor(1.1), RangeError);
  assert.throws(() => FractureMechanics.extractSIFModeI({ E, nu: NU, samples: [{ r: 1e-4, v: 1e-6 }] }), TypeError);
  assert.throws(() => FractureMechanics.assessFracture({ K_applied: 1e6, K_IC: 0 }), RangeError);
});
