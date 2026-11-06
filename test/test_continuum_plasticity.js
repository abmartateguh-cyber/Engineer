/**
 * Verification gate for 3D continuum J2 plasticity (src/core/cae/j2_plasticity.js):
 *  1. uniaxial tensile loading: elastic slope E, yield onset at sigmaY0,
 *     post-yield slope E*H/(E+H) for linear isotropic hardening;
 *  2. Voce isotropic hardening matching the implicit closed-form uniaxial solution;
 *  3. Chaboche kinematic hardening with M=2 backstresses in a closed strain cycle:
 *     backstress direction reversal and Bauschinger effect;
 *  4. consistent algorithmic tangent vs central finite differences (h = 1e-7);
 *  5. hydrostatic/volumetric loading produces no plastic volumetric strain.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { J2PlasticityModel } = require('../src/core/cae/j2_plasticity');

const E = 210000.0;
const NU = 0.3;

function uniaxialStep(material, state, dEps11) {
  // Free-lateral uniaxial step: choose lateral engineering strain dEps22 = dEps33
  // so that post-update sigma22 = sigma33 = 0.
  let lo = -0.01;
  let hi = 0.01;
  const lateralStress = d => J2PlasticityModel.integrate(material, state, [dEps11, d, d, 0, 0, 0]).stress[1];
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (lateralStress(mid) > 0) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  const dLateral = 0.5 * (lo + hi);
  return J2PlasticityModel.integrate(material, state, [dEps11, dLateral, dLateral, 0, 0, 0]);
}

function runUniaxial(material, steps, dEps11) {
  let state = J2PlasticityModel.makeState(material);
  const points = [];
  let firstPlastic = null;
  for (let i = 0; i < steps; i++) {
    const r = uniaxialStep(material, state, dEps11);
    state = r.state;
    if (r.isPlastic && firstPlastic === null) {
      firstPlastic = { eps11: state.strain[0], sigma11: r.stress[0] };
    }
    points.push({ eps11: state.strain[0], sigma11: r.stress[0], isPlastic: r.isPlastic });
  }
  return { state, points, firstPlastic };
}

describe('Continuum J2 plasticity verification gate', () => {
  const linMaterial = { E, nu: NU, yieldStress: 250, hardeningModulus: 1000, kinematic: [] };

  it('uniaxial tension: elastic slope E, yield onset at sigmaY0, post-yield slope E*H/(E+H)', () => {
    const steps = 200;
    const dEps11 = 2e-4;
    const { points, firstPlastic } = runUniaxial(linMaterial, steps, dEps11);

    const epsYieldTheory = linMaterial.yieldStress / E;
    assert.ok(firstPlastic !== null, 'plastic flow must onset during the test');
    assert.ok(
      Math.abs(firstPlastic.sigma11 - linMaterial.yieldStress) < 0.5,
      `yield onset stress ${firstPlastic.sigma11} should be ~250`
    );
    assert.ok(
      firstPlastic.eps11 >= epsYieldTheory - dEps11 && firstPlastic.eps11 <= epsYieldTheory + dEps11,
      `yield onset strain ${firstPlastic.eps11} should be ~${epsYieldTheory}`
    );

    const preYield = points.filter(p => !p.isPlastic);
    for (const p of preYield.slice(0, 20)) {
      const elastic = E * p.eps11;
      assert.ok(Math.abs(p.sigma11 - elastic) / elastic < 1e-9, 'elastic loading must follow E*eps11');
    }

    const plastic = points.filter(p => p.isPlastic);
    const i0 = Math.floor(plastic.length / 2);
    const i1 = plastic.length - 1;
    const slope = (plastic[i1].sigma11 - plastic[i0].sigma11) / (plastic[i1].eps11 - plastic[i0].eps11);
    const slopeTheory = (E * linMaterial.hardeningModulus) / (E + linMaterial.hardeningModulus);
    const relErr = Math.abs(slope - slopeTheory) / slopeTheory;
    assert.ok(relErr < 1e-6, `post-yield slope ${slope} should be ${slopeTheory} (relErr ${relErr})`);
    console.log(`  uniaxial: yield onset sigma=${firstPlastic.sigma11.toFixed(4)} MPa at eps=${firstPlastic.eps11.toFixed(6)}; ` +
      `post-yield slope=${slope.toFixed(4)} MPa (theory ${slopeTheory.toFixed(4)}), relErr=${relErr.toExponential(2)}`);
  });

  it('Voce isotropic hardening matches implicit closed-form uniaxial solution', () => {
    const sy0 = 150;
    const Rinf = 300;
    const b = 20;
    const voceMaterial = { E, nu: NU, yieldStress: sy0, voce: { Rinf, b }, kinematic: [] };
    const steps = 500;
    const dEps11 = 2e-4;
    const { state, points } = runUniaxial(voceMaterial, steps, dEps11);

    let maxRelDev = 0;
    for (const p of points) {
      let refSigma;
      if (p.eps11 <= sy0 / E) {
        refSigma = E * p.eps11;
      } else {
        // implicit: eps11 = sigma/E + pbar, sigma = sy0 + Rinf*(1-exp(-b*pbar))
        let lo = 0;
        let hi = 0.5;
        const g = q => (sy0 + Rinf * (1 - Math.exp(-b * q))) / E + q - p.eps11;
        for (let k = 0; k < 80; k++) {
          const mid = 0.5 * (lo + hi);
          if (g(mid) > 0) hi = mid; else lo = mid;
        }
        const pbar = 0.5 * (lo + hi);
        refSigma = sy0 + Rinf * (1 - Math.exp(-b * pbar));
      }
      const dev = Math.abs(p.sigma11 - refSigma) / Math.max(1, Math.abs(refSigma));
      if (dev > maxRelDev) maxRelDev = dev;
    }
    assert.ok(maxRelDev < 1e-6, `Voce max relative deviation vs closed form: ${maxRelDev}`);
    const plast = points.filter(p => p.isPlastic);
    const i0 = Math.floor(plast.length / 2);
    const i1 = plast.length - 1;
    const slopeEarly = (plast[25].sigma11 - plast[5].sigma11) / (plast[25].eps11 - plast[5].eps11);
    const slopeLate = (plast[i1].sigma11 - plast[i0].sigma11) / (plast[i1].eps11 - plast[i0].eps11);
    assert.ok(slopeEarly > 3 * slopeLate, `Voce hardening must saturate: early slope ${slopeEarly} >> late ${slopeLate}`);
    assert.ok(plast[i1].sigma11 > sy0 + Rinf * 0.85, 'Voce stress should be within 15% of sy0+Rinf=450');
    console.log(`  voce: max rel deviation vs closed form = ${maxRelDev.toExponential(2)}; ` +
      `hardening slope early=${slopeEarly.toFixed(1)} MPa, late=${slopeLate.toFixed(2)} MPa (saturation); ` +
      `end sigma=${plast[i1].sigma11.toFixed(3)} MPa (asymptote 450)`);
  });

  it('Chaboche M=2: closed strain cycle, backstress reversal, Bauschinger effect', () => {
    const chabMaterial = {
      E,
      nu: NU,
      yieldStress: 200,
      hardeningModulus: 500,
      kinematic: [
        { C: 15000, gamma: 300 },
        { C: 8000, gamma: 60 }
      ]
    };
    let state = J2PlasticityModel.makeState(chabMaterial);
    let r;

    for (let i = 0; i < 60; i++) {
      r = uniaxialStep(chabMaterial, state, 3e-4);
      state = r.state;
    }
    const fwdAlpha1 = state.backstresses[0][0];
    const fwdAlpha2 = state.backstresses[1][0];
    assert.ok(fwdAlpha1 > 0 && fwdAlpha2 > 0, `forward backstresses must be positive: ${fwdAlpha1}, ${fwdAlpha2}`);

    let reverseYieldStress = null;
    for (let i = 0; i < 200; i++) {
      r = uniaxialStep(chabMaterial, state, -3e-4);
      state = r.state;
      if (r.isPlastic && reverseYieldStress === null) {
        reverseYieldStress = r.stress[0];
      }
    }
    const revAlpha1 = state.backstresses[0][0];
    const revAlpha2 = state.backstresses[1][0];
    assert.ok(revAlpha1 < 0 && revAlpha2 < 0, `reverse backstresses must be negative: ${revAlpha1}, ${revAlpha2}`);
    assert.ok(reverseYieldStress !== null, 'reverse loading must re-activate plasticity');
    assert.ok(
      Math.abs(reverseYieldStress) < chabMaterial.yieldStress,
      `Bauschinger: reverse yield |${Math.abs(reverseYieldStress).toFixed(2)}| < ${chabMaterial.yieldStress}`
    );

    for (let i = 0; i < 200; i++) {
      r = uniaxialStep(chabMaterial, state, 3e-4);
      state = r.state;
    }
    const reloadAlpha1 = state.backstresses[0][0];
    const reloadAlpha2 = state.backstresses[1][0];
    assert.ok(reloadAlpha1 > 0 && reloadAlpha2 > 0, 'reload backstresses must be positive again');

    console.log(`  chaboche: fwd alpha1=${fwdAlpha1.toFixed(2)}, alpha2=${fwdAlpha2.toFixed(2)}; ` +
      `rev alpha1=${revAlpha1.toFixed(2)}, alpha2=${revAlpha2.toFixed(2)}; ` +
      `reverse yield sigma=${reverseYieldStress.toFixed(2)} MPa (|.|<200 => Bauschinger)`);
  });

  it('consistent algorithmic tangent vs central finite differences (h=1e-7)', () => {
    const h = 1e-7;
    const check = (material, dEps, label) => {
      let state = J2PlasticityModel.makeState(material);
      let r = J2PlasticityModel.integrate(material, state, dEps);
      state = r.state;
      assert.ok(r.isPlastic, `${label}: tangent check must start from a plastic step`);
      const T = J2PlasticityModel.algorithmicTangent(material, state, dEps);
      let maxRelErr = 0;
      for (let j = 0; j < 6; j++) {
        const plus = dEps.slice();
        const minus = dEps.slice();
        plus[j] += h;
        minus[j] -= h;
        const sp = J2PlasticityModel.integrate(material, state, plus).stress;
        const sm = J2PlasticityModel.integrate(material, state, minus).stress;
        for (let i = 0; i < 6; i++) {
          const fd = (sp[i] - sm[i]) / (2 * h);
          const rel = Math.abs(fd - T[i][j]) / Math.max(1, Math.abs(T[i][j]));
          if (rel > maxRelErr) maxRelErr = rel;
        }
      }
      assert.ok(maxRelErr < 1e-6, `${label}: max tangent relative error ${maxRelErr} must be < 1e-6`);
      console.log(`  tangent[${label}]: max relative error vs central FD (h=${h}) = ${maxRelErr.toExponential(2)}`);
      return maxRelErr;
    };

    check(linMaterial, [0.004, -0.0016, -0.0016, 0.0004, -0.0002, 0.0003], 'linear iso');
    check(
      { E, nu: NU, yieldStress: 200, hardeningModulus: 500, kinematic: [{ C: 15000, gamma: 300 }, { C: 8000, gamma: 60 }] },
      [0.003, -0.0012, -0.0012, 0.0003, -0.0002, 0.0002],
      'chaboche M=2'
    );
  });

  it('hydrostatic loading produces no plastic volumetric strain', () => {
    const K = E / (3 * (1 - 2 * NU));
    const delta = 1e-3;
    let state = J2PlasticityModel.makeState(linMaterial);
    let r;
    for (let i = 0; i < 5; i++) {
      r = J2PlasticityModel.integrate(linMaterial, state, [delta, delta, delta, 0, 0, 0]);
      state = r.state;
      assert.equal(r.isPlastic, false, 'pure volumetric strain must stay elastic');
      assert.ok(r.vonMises < 1e-9, `von Mises must vanish under hydrostatic loading: ${r.vonMises}`);
      for (let j = 0; j < 6; j++) {
        assert.ok(Math.abs(state.plasticStrain[j]) < 1e-12, `plastic strain must stay zero: ${state.plasticStrain[j]}`);
      }
    }
    const tr = 15 * delta;
    const trStrain = state.strain[0] + state.strain[1] + state.strain[2];
    assert.ok(Math.abs(trStrain - tr) < 1e-12, `accumulated volumetric strain ${trStrain} ~ ${tr}`);
    for (let j = 0; j < 3; j++) {
      assert.ok(Math.abs(r.stress[j] - K * tr) < 1e-6 * K * tr, `hydrostatic stress diagonal ${r.stress[j]} ~ ${K * tr}`);
    }

    r = uniaxialStep(linMaterial, state, 0.01);
    state = r.state;
    assert.equal(r.isPlastic, true, 'uniaxial step must yield after hydrostatic preload');
    const prevMean = (r.stress[0] + r.stress[1] + r.stress[2]) / 3;
    const prevDev = [
      r.stress[0] - prevMean,
      r.stress[1] - prevMean,
      r.stress[2] - prevMean,
      r.stress[3],
      r.stress[4],
      r.stress[5]
    ];
    const plastPrev = state.plasticStrain.slice();

    r = J2PlasticityModel.integrate(linMaterial, state, [delta, delta, delta, 0, 0, 0]);
    state = r.state;
    assert.equal(r.isPlastic, false, 'additional hydrostatic strain after plastic loading must stay elastic');
    for (let j = 0; j < 6; j++) {
      assert.ok(Math.abs(state.plasticStrain[j] - plastPrev[j]) < 1e-12, 'plastic strain unchanged under hydrostatic increment');
    }
    const newMean = (r.stress[0] + r.stress[1] + r.stress[2]) / 3;
    assert.ok(Math.abs(newMean - prevMean - K * 3 * delta) < 1e-6 * K * 3 * delta, 'pressure increases by 3K*delta');
    for (let j = 0; j < 3; j++) {
      assert.ok(Math.abs((r.stress[j] - newMean) - prevDev[j]) < 1e-6, `deviatoric stress unchanged: ${prevDev[j]}`);
    }
    console.log('  hydrostatic: no plastic volumetric strain; deviatoric stress invariant under volumetric increments');
  });
});
