/**
 * Verification gate for hyperelastic constitutive models (Battalion 5, Agent 43)
 *
 * Targets: Mooney-Rivlin (2-param), Ogden (N=1..3), Yeoh (3rd order).
 * Physics target: Treloar's classic rubber data (uniaxial, equibiaxial, pure shear).
 *
 * Checks:
 *   1. For every model and deformation mode, nominal stress P11(lambda) equals the
 *      closed-form derivative of the strain energy W(lambda) (validated by central
 *      finite differences of W at constant volume, step 1e-7, relative error < 1e-5).
 *   2. Material stability: bulk modulus positive; shear modulus mu = 2*(C10+C01)
 *      for Mooney-Rivlin at lambda=1 matches the linear-elastic limit
 *      G = E/(2*(1+nu)) with nu = 0.5.
 *   3. Treloar qualitative trends: uniaxial stress rises steeply at high stretch;
 *      Ogden with published Treloar-fit coefficients reproduces the published
 *      uniaxial curve shape (independent literature tabulation is not available
 *      in-repo, so the quantitative gate is self-consistency against an independent
 *      reference evaluation of the identical formula plus curve-shape checks).
 *   4. No NaN / negative energy for lambda in [0.5, 8].
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HyperelasticMaterial, MODES } = require('../src/core/cae/hyperelastic_materials');
const { NonlinearContinuumFEA } = require('../src/core/cae/nonlinear_continuum_fea');

const ALL_MODES = [MODES.UNIAXIAL, MODES.EQUIBIAXIAL, MODES.PURE_SHEAR];

function centralDerivative(f, x, h = 1e-7) {
  return (f(x + h) - f(x - h)) / (2 * h);
}

function relativeError(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
}

function makeModels() {
  const mr = new HyperelasticMaterial('MOONEY_RIVLIN', { C10: 0.3e6, C01: 0.07e6 });
  const yeoh = new HyperelasticMaterial({ model: 'yeoh' }, { C10: 0.3e6, C20: 0.02e6, C30: 0.003e6 });
  const ogden3 = new HyperelasticMaterial(
    { model: 'ogden' },
    {
      mu1: 0.6e6,
      alpha1: 1.3,
      mu2: 0.0012e6,
      alpha2: 5.0,
      mu3: 0.0098e6,
      alpha3: -2.0
    }
  );
  const ogden2 = new HyperelasticMaterial(
    { model: 'ogden' },
    {
      mu1: 0.5e6,
      alpha1: 1.5,
      mu2: 0.2e6,
      alpha2: 3.0
    }
  );
  const ogden1 = new HyperelasticMaterial({ model: 'ogden' }, { mu1: 1.0e6, alpha1: 2.0 });
  return { mr, yeoh, ogden3, ogden2, ogden1 };
}

test('hyperelastic: strain energy is zero at the undeformed state and non-negative under tension', () => {
  const models = makeModels();
  for (const [name, m] of Object.entries(models)) {
    for (const mode of ALL_MODES) {
      const W0 = m.strainEnergy(1.0, mode);
      assert.ok(Math.abs(W0) < 1e-12, `${name} W(1)=${W0}`);
      const W2 = m.strainEnergy(2.0, mode);
      assert.ok(Number.isFinite(W2) && W2 >= 0.0, `${name}/${mode} W(2)=${W2}`);
    }
  }
});

test('hyperelastic: nominal stress matches finite-difference derivative of W (uniaxial, step 1e-7)', () => {
  const models = makeModels();
  const stretches = [1.2, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0];
  for (const [name, m] of Object.entries(models)) {
    for (const lam of stretches) {
      const analytic = m.nominalStress(lam, MODES.UNIAXIAL);
      const fd = centralDerivative((x) => m.strainEnergy(x, MODES.UNIAXIAL), lam);
      const rel = relativeError(analytic, fd);
      assert.ok(rel < 1e-5, `${name} uniaxial lambda=${lam}: P=${analytic} FD=${fd} rel=${rel}`);
    }
  }
});

test('hyperelastic: nominal stress matches finite-difference derivative of W (equibiaxial, step 1e-7)', () => {
  const models = makeModels();
  const stretches = [1.2, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0];
  for (const [name, m] of Object.entries(models)) {
    for (const lam of stretches) {
      const analytic = m.nominalStress(lam, MODES.EQUIBIAXIAL);
      const fd = centralDerivative((x) => m.strainEnergy(x, MODES.EQUIBIAXIAL), lam);
      const rel = relativeError(analytic, fd);
      assert.ok(rel < 1e-5, `${name} equibiaxial lambda=${lam}: P=${analytic} FD=${fd} rel=${rel}`);
    }
  }
});

test('hyperelastic: nominal stress matches finite-difference derivative of W (pure shear, step 1e-7)', () => {
  const models = makeModels();
  const stretches = [1.2, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0];
  for (const [name, m] of Object.entries(models)) {
    for (const lam of stretches) {
      const analytic = m.nominalStress(lam, MODES.PURE_SHEAR);
      const fd = centralDerivative((x) => m.strainEnergy(x, MODES.PURE_SHEAR), lam);
      const rel = relativeError(analytic, fd);
      assert.ok(rel < 1e-5, `${name} pure shear lambda=${lam}: P=${analytic} FD=${fd} rel=${rel}`);
    }
  }
});

test('hyperelastic: Mooney-Rivlin shear modulus mu=2*(C10+C01) matches linear-elastic limit G=E/(2(1+nu)), nu=0.5', () => {
  const C10 = 0.3e6;
  const C01 = 0.07e6;
  const mr = new HyperelasticMaterial('MOONEY_RIVLIN', { C10, C01 });
  const mu0 = mr.shearModulus();
  assert.ok(Math.abs(mu0 - 2 * (C10 + C01)) < 1e-12, `mu0=${mu0}`);
  const nu = 0.5;
  const E = 3 * mu0;
  assert.ok(Math.abs(mu0 - E / (2 * (1 + nu))) < 1e-12 * E, 'G = E/(2(1+nu)) must hold with nu=0.5');
  const h = 1e-4;
  const slope = (mr.evaluateUniaxialStress(1 + h) - mr.evaluateUniaxialStress(1)) / h;
  assert.ok(relativeError(slope, E) < 1e-3, `linear-elastic slope ${slope} must equal E=${E}`);
});

test('hyperelastic: Yeoh and Ogden shear moduli match their closed-form linear limits', () => {
  const yeoh = new HyperelasticMaterial({ model: 'yeoh' }, { C10: 0.3e6, C20: 0.02e6, C30: 0.003e6 });
  assert.ok(relativeError(yeoh.shearModulus(), 2 * 0.3e6) < 1e-12, 'Yeoh mu0 = 2*C10');

  const ogden3 = new HyperelasticMaterial(
    { model: 'ogden' },
    {
      mu1: 0.6e6,
      alpha1: 1.3,
      mu2: 0.0012e6,
      alpha2: 5.0,
      mu3: 0.0098e6,
      alpha3: -2.0
    }
  );
  const expectedMu0 = 0.5 * (0.6e6 * 1.3 + 0.0012e6 * 5.0 + 0.0098e6 * -2.0);
  assert.ok(relativeError(ogden3.shearModulus(), expectedMu0) < 1e-12, 'Ogden mu0 = 0.5*sum(mu_p*alpha_p)');

  const h = 1e-4;
  const slope = (ogden3.evaluateUniaxialStress(1 + h) - ogden3.evaluateUniaxialStress(1)) / h;
  assert.ok(relativeError(slope, 3 * expectedMu0) < 1e-3, `Ogden slope ${slope} must equal 3*mu0`);
});

test('hyperelastic: bulk modulus is positive and volumetric penalty energy is convex and positive', () => {
  const fea = new NonlinearContinuumFEA({ C10: 0.4e6, C01: 0.1e6, K_bulk: 1e8 });
  assert.ok(fea.K_bulk > 0, 'bulk modulus must be positive');

  function FfromJ(J) {
    const c = Math.pow(J, 1 / 3);
    return [
      [c, 0, 0],
      [0, c, 0],
      [0, 0, c]
    ];
  }

  const J1 = 1.0;
  const tensors1 = fea.computeDeformationTensors(FfromJ(J1).map((row, r) => row.map((v, c) => (r === c ? v - 1 : v))));
  const W1 = fea.evaluateMooneyRivlinStress(tensors1.C, tensors1.J).strainEnergyW;
  assert.ok(Math.abs(W1) < 1e-9, `W(J=1)=${W1}`);

  const J = 1.05;
  const tensors = fea.computeDeformationTensors(FfromJ(J).map((row, r) => row.map((v, c) => (r === c ? v - 1 : v))));
  assert.ok(Math.abs(tensors.J - J) < 1e-12, 'J must be exactly 1.05');
  const Wvol = fea.evaluateMooneyRivlinStress(tensors.C, tensors.J).strainEnergyW;
  const expected = 0.5 * fea.K_bulk * (J - 1) * (J - 1);
  assert.ok(relativeError(Wvol, expected) < 1e-9, `volumetric energy ${Wvol} vs ${expected}`);
  assert.ok(Wvol > 0, 'volumetric energy must be positive off-equilibrium');
});

test('hyperelastic: Ogden with published Treloar-fit coefficients reproduces the uniaxial curve (self-consistency + shape)', () => {
  const treloarOgden = new HyperelasticMaterial(
    { model: 'ogden' },
    {
      mu1: 0.618,
      alpha1: 1.3,
      mu2: 0.00118,
      alpha2: 5.0,
      mu3: 0.00981,
      alpha3: -2.0
    }
  );

  function refOgdenUniaxial(lam) {
    const terms = [
      { mu: 0.618, alpha: 1.3 },
      { mu: 0.00118, alpha: 5.0 },
      { mu: 0.00981, alpha: -2.0 }
    ];
    let s = 0;
    for (const { mu, alpha } of terms) {
      s += mu * (Math.pow(lam, alpha - 1) - Math.pow(lam, -0.5 * alpha - 1));
    }
    return s;
  }

  const measured = {};
  for (const lam of [2, 4, 6]) {
    const eng = treloarOgden.nominalStress(lam, MODES.UNIAXIAL);
    const ref = refOgdenUniaxial(lam);
    measured[lam] = eng;
    assert.ok(relativeError(eng, ref) < 1e-9, `lambda=${lam}: engine=${eng} reference=${ref}`);
  }

  for (const lam of [2, 4, 6]) {
    assert.ok(Number.isFinite(measured[lam]) && measured[lam] > 0, `P11(${lam}) must be positive`);
  }

  const P2 = measured[2];
  const P4 = measured[4];
  const P6 = measured[6];
  assert.ok(P6 / P2 > 3.5, `steep upturn: P6/P2=${(P6 / P2).toFixed(3)} must exceed 3.5`);
  assert.ok(P4 / P2 > 1.5, `P4/P2=${(P4 / P2).toFixed(3)} must exceed 1.5`);
  assert.ok(P6 - P4 > 1.5 * (P4 - P2), 'tangent must stiffen strongly at high stretch');

  let prev = 0;
  for (let lam = 1.1; lam <= 8.0001; lam += 0.1) {
    const P = treloarOgden.nominalStress(lam, MODES.UNIAXIAL);
    assert.ok(P > prev, `monotone rise violated at lambda=${lam.toFixed(1)}`);
    prev = P;
  }
});

test('hyperelastic: no NaN and no negative strain energy for lambda in [0.5, 8]', () => {
  const models = makeModels();
  const tOgden = new HyperelasticMaterial(
    { model: 'ogden' },
    {
      mu1: 0.618,
      alpha1: 1.3,
      mu2: 0.00118,
      alpha2: 5.0,
      mu3: 0.00981,
      alpha3: -2.0
    }
  );
  models.treloarOgden = tOgden;
  for (const [name, m] of Object.entries(models)) {
    for (const mode of ALL_MODES) {
      for (let lam = 0.5; lam <= 8.0001; lam += 0.05) {
        const W = m.strainEnergy(lam, mode);
        const P = m.nominalStress(lam, mode);
        assert.ok(Number.isFinite(W), `${name}/${mode} lambda=${lam}: W not finite`);
        assert.ok(Number.isFinite(P), `${name}/${mode} lambda=${lam}: P not finite`);
        assert.ok(W >= -1e-9, `${name}/${mode} lambda=${lam}: negative energy W=${W}`);
      }
    }
  }
});

test('hyperelastic: deterministic outputs do not depend on call order', () => {
  const m = makeModels().ogden3;
  const first = [];
  for (const lam of [1.5, 3.0, 5.0]) first.push(m.nominalStress(lam));
  const second = [];
  for (const lam of [5.0, 3.0, 1.5]) second.unshift(m.nominalStress(lam));
  assert.deepEqual(first, second);
});
