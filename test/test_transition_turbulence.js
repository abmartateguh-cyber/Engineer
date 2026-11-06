/**
 * Verification gate for the transition turbulence model
 * (src/core/cae/transition_turbulence.js):
 *  1. Langtry-Menter correlation: Re_theta_t(Tu) values at Tu = 1, 5, 10%
 *     match the formula to 1e-9 and decrease monotonically with Tu.
 *  2. Pressure-gradient parameter lambda_theta = (theta^2/nu) dUe/dx:
 *     favorable gradient (negative lambda) raises Re_theta_c, adverse
 *     lowers it; monotone non-increasing in lambda at fixed Tu.
 *  3. Boundary-layer diagnostics on an analytic Blasius profile: delta_99,
 *     theta, Re_theta within 2% of delta_99/x = 5.0/sqrt(Re_x),
 *     theta/x = 0.664/sqrt(Re_x).
 *  4. Intermittency: gamma = 0 before transition, logistic-like rise to
 *     gamma -> 1 after, gamma in [0, 1] everywhere.
 *  5. Transition onset: flat plate at Tu = 5% predicts transition Re_x in
 *     the experimental/correlation range 3e5..1e6.
 *  6. Determinism: identical results across repeated runs.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const T = require('../src/core/cae/transition_turbulence');

const U_INF = 10.0;
const NU = 1.5e-5;
const RHO = 1.225;

describe('transition_turbulence', () => {
  it('LM correlation Re_theta_t(Tu) matches the formula to 1e-9', () => {
    const reThetaT = (tu) => 163 + Math.exp(6.91 - tu / 0.1);
    for (const tu of [1, 5, 10]) {
      assert.ok(
        Math.abs(T.reThetaT(tu) - reThetaT(tu)) < 1e-9,
        `Re_theta_t(${tu}%) mismatch: ${T.reThetaT(tu)} vs ${reThetaT(tu)}`
      );
    }
    assert.ok(Math.abs(T.reThetaT(1) - (163 + Math.exp(-3.09))) < 1e-9);
    assert.ok(Math.abs(T.reThetaT(5) - 163) < 1e-9);
    assert.ok(Math.abs(T.reThetaT(10) - 163) < 1e-9);
  });

  it('Re_theta_t decreases monotonically as Tu increases', () => {
    const seq = [];
    for (let tu = 1; tu <= 10; tu += 0.5) {
      seq.push(T.reThetaT(tu));
    }
    for (let i = 1; i < seq.length; i++) {
      assert.ok(seq[i] <= seq[i - 1] + 1e-15, `not monotone at index ${i}`);
    }
    assert.ok(T.reThetaT(1) > T.reThetaT(5));
    assert.ok(T.reThetaT(5) >= T.reThetaT(10));
  });

  it('lambda_theta = (theta^2/nu) dUe/dx', () => {
    const lam = T.lambdaTheta(1e-3, 1.5e-5, 10);
    assert.ok(Math.abs(lam - (1e-6 / 1.5e-5) * 10) < 1e-12);
    assert.equal(T.lambdaTheta(1e-3, 1.5e-5, 0), 0);
  });

  it('Re_theta_c increases for favorable gradient, decreases for adverse (monotone)', () => {
    const tu = 5;
    const base = T.reThetaC(T.reThetaT(tu), 0, tu);
    const favorable = T.reThetaC(T.reThetaT(tu), -0.02, tu);
    const adverse = T.reThetaC(T.reThetaT(tu), 0.02, tu);
    assert.ok(favorable > base, 'favorable gradient must delay transition');
    assert.ok(adverse < base, 'adverse gradient must promote transition');
    const lams = [];
    for (let l = -0.06; l <= 0.060001; l += 0.005) {
      lams.push(l);
    }
    const vals = lams.map((l) => T.reThetaC(T.reThetaT(tu), l, tu));
    for (let i = 1; i < vals.length; i++) {
      assert.ok(vals[i] <= vals[i - 1] + 1e-9, `Re_theta_c not monotone at lambda=${lams[i]}`);
    }
  });

  it('Blasius boundary-layer diagnostics match analytic values to 2%', () => {
    const x = 0.5;
    const reX = (U_INF * x) / NU;
    const profile = T.blasiusProfile({ Ue: U_INF, nu: NU, x });
    const diag = T.boundaryLayerDiagnostics(profile.points, U_INF, NU);

    const delta99Analytic = (5.0 / Math.sqrt(reX)) * x;
    const thetaAnalytic = (0.664 / Math.sqrt(reX)) * x;
    const reThetaAnalytic = 0.664 * Math.sqrt(reX);

    const relErr = (got, ref) => Math.abs(got - ref) / ref;
    assert.ok(relErr(diag.delta99, delta99Analytic) < 0.02, `delta99 err ${relErr(diag.delta99, delta99Analytic)}`);
    assert.ok(relErr(diag.theta, thetaAnalytic) < 0.02, `theta err ${relErr(diag.theta, thetaAnalytic)}`);
    assert.ok(relErr(diag.reTheta, reThetaAnalytic) < 0.02, `Re_theta err ${relErr(diag.reTheta, reThetaAnalytic)}`);
    assert.ok(relErr(profile.theta, thetaAnalytic) < 0.02);
    assert.ok(relErr(profile.delta99, delta99Analytic) < 0.02);
    assert.ok(relErr(profile.reTheta, reThetaAnalytic) < 0.02);
    assert.ok(diag.delta99 > diag.theta);
  });

  it('edge tracking reports Tu from profile k', () => {
    const pts = [
      { y: 0, u: 0, k: 1.5 },
      { y: 0.001, u: 5, k: 1.5 },
      { y: 0.002, u: 10, k: 1.5 }
    ];
    const diag = T.boundaryLayerDiagnostics(pts, 10, NU);
    assert.ok(Math.abs(diag.tuPercent - 10) < 1e-9);
  });

  it('intermittency: gamma=0 pre-onset, logistic-like rise, bounded in [0,1]', () => {
    const m = T.flatPlateTransitionMarch({ UInf: U_INF, nu: NU, rho: RHO, tuPercent: 5 });
    const st = m.stations;

    let firstNonzero = -1;
    for (let i = 0; i < st.length; i++) {
      if (st[i].gamma > 0) {
        firstNonzero = i;
        break;
      }
    }
    assert.ok(firstNonzero > 0, 'must start laminar');
    for (let i = 0; i < firstNonzero; i++) {
      assert.equal(st[i].gamma, 0, `gamma must be exactly 0 at station ${i}`);
    }

    let minG = Infinity;
    let maxG = -Infinity;
    let nonDecreasing = true;
    for (let i = 0; i < st.length; i++) {
      minG = Math.min(minG, st[i].gamma);
      maxG = Math.max(maxG, st[i].gamma);
      if (i > 0 && st[i].gamma < st[i - 1].gamma - 1e-15) {
        nonDecreasing = false;
      }
    }
    assert.ok(minG >= 0 && maxG <= 1, `gamma range [${minG}, ${maxG}]`);
    assert.ok(nonDecreasing, 'gamma must be non-decreasing along the plate');
    assert.ok(st[st.length - 1].gamma >= 0.999, 'gamma must reach ~1 downstream');

    let d2sign = 0;
    let flip = false;
    for (let i = 2; i < st.length; i++) {
      const d1a = (st[i - 1].gamma - st[i - 2].gamma) / (st[i - 1].x - st[i - 2].x);
      const d1b = (st[i].gamma - st[i - 1].gamma) / (st[i].x - st[i - 1].x);
      const d2 = (d1b - d1a) / (st[i].x - st[i - 2].x);
      if (d2sign === 0 && d2 !== 0) {
        d2sign = d2 > 0 ? 1 : -1;
      } else if (d2sign === 1 && d2 < -1e-9) {
        flip = true;
        break;
      } else if (d2sign === -1 && d2 > 1e-9) {
        flip = true;
        break;
      }
    }
    assert.ok(flip, 'gamma rise must be logistic-like (convex then concave)');
  });

  it('transition onset on flat plate at Tu=5% lands in Re_x 3e5..1e6', () => {
    const m = T.flatPlateTransitionMarch({ UInf: U_INF, nu: NU, rho: RHO, tuPercent: 5 });
    assert.ok(m.transitionOnset, 'transition onset not found');
    assert.ok(m.transitionMid, 'transition midpoint not found');
    const { transitionOnset, transitionMid } = m;
    assert.ok(
      transitionMid.reX >= 3e5 && transitionMid.reX <= 1e6,
      `transition Re_x=${transitionMid.reX} outside 3e5..1e6`
    );
    assert.ok(transitionOnset.reX < transitionMid.reX);
    assert.ok(transitionMid.gamma >= 0.5);
    console.log(
      `[report] Tu=5%: Re_theta_t=${m.reThetaT.toFixed(3)}, ` +
        `Re_theta_c=${m.reThetaC.toFixed(3)}, ` +
        `onset Re_x=${transitionOnset.reX.toFixed(0)} (gamma=${transitionOnset.gamma.toFixed(4)}), ` +
        `transition Re_x=${transitionMid.reX.toFixed(0)} (gamma=${transitionMid.gamma.toFixed(4)})`
    );
  });

  it('deterministic: identical march results across runs', () => {
    const a = T.flatPlateTransitionMarch({ UInf: U_INF, nu: NU, rho: RHO, tuPercent: 5 });
    const b = T.flatPlateTransitionMarch({ UInf: U_INF, nu: NU, rho: RHO, tuPercent: 5 });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  it('blended eddy viscosity damps mu_t by gamma', () => {
    const muLam = 1.8e-5;
    const muTurb = 0.001;
    assert.equal(T.blendEddyViscosity(muLam, muTurb, 0), muLam);
    assert.equal(T.blendEddyViscosity(muLam, muTurb, 1), muLam + muTurb);
    assert.equal(T.blendEddyViscosity(muLam, muTurb, 0.5), muLam + 0.5 * muTurb);
    assert.ok(T.blendEddyViscosity(muLam, muTurb, -1) >= muLam);
    assert.ok(T.blendEddyViscosity(muLam, muTurb, 2) <= muLam + muTurb);
  });
});
