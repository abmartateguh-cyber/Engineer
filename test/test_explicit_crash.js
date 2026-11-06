/**
 * Verification gate for the explicit central-difference crash dynamics engine
 * (src/core/cae/explicit_dynamics_crash.js). Battalion 5, Agent 45.
 *
 * Checks:
 *   1. Dilatational acoustic wave speed c_d = sqrt(E(1-nu)/(rho(1+nu)(1-2nu)))
 *      against the closed-form expression (relative error < 1e-9) and against
 *      the nominal steel value 5856.36 m/s at E=200 GPa, nu=0.3, rho=7850.
 *      Non-physical inputs (E<=0, nu>=0.5, rho<=0) must throw.
 *   2. Stable time step dt = safety * L_min / c_d exactly (rel. 1e-9) for
 *      several (L, safety) pairs; L<=0 must throw.
 *   3. Central-difference integration on an SDOF spring-mass (m=1, k=100,
 *      no damping) under a sine force, compared with the analytic undamped
 *      solution over 50 steps at dt=0.005 (max relative error < 1e-3,
 *      covering both phase and amplitude).
 *   4. Free-vibration total energy (staggered leapfrog invariant) conserved
 *      to < 1% over 100 steps.
 *   5. Element erosion threshold: isElementEroded true exactly at/above
 *      criticalPlasticStrain, false below; constructor default 0.35 works.
 *   6. Taylor-bar-style 1D element column driven at constant end velocity:
 *      strains stay non-negative, total strain equals boundary velocity * time
 *      (kinematic identity, monotonic in time), and double velocity doubles
 *      the strain response.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExplicitDynamicsCrash, ExplicitDynamicsCrashSolver } = require('../src/core/cae/explicit_dynamics_crash');

const E = 200e9;
const NU = 0.3;
const RHO = 7850;
const NOMINAL_CD = 5856.36;

const analyticWaveSpeed = () => Math.sqrt((E * (1 - NU)) / (RHO * (1 + NU) * (1 - 2 * NU)));

const relError = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

test('wave speed: closed form, nominal steel value, and non-physical input guards', () => {
  const analytic = analyticWaveSpeed();
  const crash = new ExplicitDynamicsCrash({ E, nu: NU, rho: RHO });
  const cd = crash.calculateWaveSpeed();

  assert.ok(Number.isFinite(cd));
  assert.ok(relError(cd, analytic) <= 1e-9, `wave speed ${cd} vs analytic ${analytic}`);
  assert.ok(relError(cd, NOMINAL_CD) <= 1e-4, `wave speed ${cd} should be ~ ${NOMINAL_CD} m/s`);
  assert.ok(Math.abs(ExplicitDynamicsCrashSolver.calculateDilatationalWaveSpeed(E, NU, RHO) - cd) <= 1e-9);

  const throwsOmni = (fn) => assert.throws(fn);
  throwsOmni(() => new ExplicitDynamicsCrash({ E: -1, nu: NU, rho: RHO }).calculateWaveSpeed());
  throwsOmni(() => new ExplicitDynamicsCrash({ E: 0, nu: NU, rho: RHO }).calculateWaveSpeed());
  throwsOmni(() => new ExplicitDynamicsCrash({ E, nu: 0.5, rho: RHO }).calculateWaveSpeed());
  throwsOmni(() => new ExplicitDynamicsCrash({ E, nu: 0.7, rho: RHO }).calculateWaveSpeed());
  throwsOmni(() => new ExplicitDynamicsCrash({ E, nu: NU, rho: 0 }).calculateWaveSpeed());
  throwsOmni(() => new ExplicitDynamicsCrash({ E, nu: NU, rho: -7850 }).calculateWaveSpeed());
});

test('stable time step: dt = safety * L_min / c_d exact, L<=0 throws', () => {
  const cd = analyticWaveSpeed();
  const cases = [
    { L: 0.001, safety: 0.85 },
    { L: 0.0025, safety: 0.9 },
    { L: 0.005, safety: 0.5 },
    { L: 1e-6, safety: 1.0 },
    { L: 0.03, safety: 0.3 }
  ];
  for (const { L, safety } of cases) {
    const crash = new ExplicitDynamicsCrash({ E, nu: NU, rho: RHO, safetyFactor: safety });
    const dt = crash.calculateStableTimeStep(L);
    assert.ok(relError(dt, (safety * L) / cd) <= 1e-9, `dt ${dt} for L=${L}, safety=${safety}`);
  }
  const crash = new ExplicitDynamicsCrash({ E, nu: NU, rho: RHO });
  assert.throws(() => crash.calculateStableTimeStep(0));
  assert.throws(() => crash.calculateStableTimeStep(-0.001));
});

test('SDOF spring-mass: central difference matches analytic sine-forced solution', () => {
  const m = 1;
  const k = 100;
  const omegaN = Math.sqrt(k / m);
  const F0 = 10;
  const omegaF = 5;
  const dt = 0.005;
  const steps = 50;
  const A = F0 / (m * (omegaN * omegaN - omegaF * omegaF));

  const analytic = (t) => A * (Math.sin(omegaF * t) - (omegaF / omegaN) * Math.sin(omegaN * t));

  const crash = new ExplicitDynamicsCrash({ E, nu: NU, rho: RHO });
  const u = new Float64Array([0]);
  const vHalf = new Float64Array([0]);
  const fExt = new Float64Array(1);
  const fInt = new Float64Array(1);
  const mass = new Float64Array([m]);

  let maxAbsErr = 0;
  let maxNum = 0;
  let maxAna = 0;
  for (let n = 0; n < steps; n++) {
    const t = n * dt;
    fExt[0] = F0 * Math.sin(omegaF * t);
    fInt[0] = k * u[0];
    const r = crash.stepCentralDifference(u, vHalf, fExt, fInt, mass, dt);
    u.set(r.uNext);
    vHalf.set(r.vNextHalf);
    const tNext = (n + 1) * dt;
    const x = analytic(tNext);
    maxAbsErr = Math.max(maxAbsErr, Math.abs(u[0] - x));
    maxNum = Math.max(maxNum, Math.abs(u[0]));
    maxAna = Math.max(maxAna, Math.abs(x));
  }
  // Relative to the response amplitude (phase + amplitude fold into the history error);
  // raw per-step relative error is ill-defined near zero crossings of the sine force.
  const maxRelErr = maxAbsErr / maxAna;
  const maxAmpErr = relError(maxNum, maxAna);

  assert.ok(maxRelErr < 1e-3, `max relative displacement error ${maxRelErr} must be < 1e-3`);
  assert.ok(maxAmpErr < 1e-3, `amplitude error ${maxAmpErr} must be < 1e-3`);
});

test('energy: free vibration conserves staggered total energy to < 1% over 100 steps', () => {
  const m = 1;
  const k = 100;
  const dt = 0.005;
  const steps = 100;
  const crash = new ExplicitDynamicsCrash({ E, nu: NU, rho: RHO });

  const u = new Float64Array([1]);
  const vHalf = new Float64Array([(dt / 2) * (k / m)]); // v(-1/2) = v(0) - dt/2*a(0) = +0.25
  const fExt = new Float64Array(1);
  const fInt = new Float64Array(1);
  const mass = new Float64Array([m]);

  const energy = (uPrev, uNext, vNextHalf) => 0.5 * m * vNextHalf * vNextHalf + 0.5 * k * uPrev * uNext;

  fExt[0] = 0;
  fInt[0] = k * u[0];
  let r = crash.stepCentralDifference(u, vHalf, fExt, fInt, mass, dt);
  const e0 = energy(u[0], r.uNext[0], r.vNextHalf[0]);
  u.set(r.uNext);
  vHalf.set(r.vNextHalf);

  let maxDev = 0;
  for (let n = 1; n < steps; n++) {
    const uPrev = u[0];
    fExt[0] = 0;
    fInt[0] = k * u[0];
    r = crash.stepCentralDifference(u, vHalf, fExt, fInt, mass, dt);
    const e = energy(uPrev, r.uNext[0], r.vNextHalf[0]);
    if ((n + 1) % 10 === 0) {
      maxDev = Math.max(maxDev, relError(e, e0));
    }
    u.set(r.uNext);
    vHalf.set(r.vNextHalf);
  }

  assert.ok(maxDev < 0.01, `max relative energy drift ${maxDev} must be < 1%`);
});

test('element erosion: threshold inclusive at criticalPlasticStrain, default 0.35', () => {
  const dflt = new ExplicitDynamicsCrash();
  assert.strictEqual(dflt.criticalPlasticStrain, 0.35);
  assert.strictEqual(dflt.isElementEroded(0.349999), false);
  assert.strictEqual(dflt.isElementEroded(0.35), true);
  assert.strictEqual(dflt.isElementEroded(0.350001), true);

  const custom = new ExplicitDynamicsCrash({ criticalPlasticStrain: 0.02 });
  assert.strictEqual(custom.isElementEroded(0.019999), false);
  assert.strictEqual(custom.isElementEroded(0.02), true);
  assert.strictEqual(custom.isElementEroded(0.5), true);
});

test('Taylor-bar style: 1D element column under constant end velocity', () => {
  const crash = new ExplicitDynamicsCrash({ E, nu: NU, rho: RHO, safetyFactor: 0.5 });
  const cd = crash.calculateWaveSpeed();
  const dx = 1e-4;
  const N = 200;
  const L = N * dx;
  const dt = crash.calculateStableTimeStep(dx);
  const tEnd = 0.7 * (L / cd);
  const steps = Math.floor(tEnd / dt);
  const k = E / dx;
  const mass = new Float64Array(N).fill(RHO * dx);
  const fExt = new Float64Array(N);
  const fInt = new Float64Array(N);

  const run = (v0) => {
    const u = new Float64Array(N);
    const vHalf = new Float64Array(N);
    const strains = [];
    const sums = [];
    for (let s = 0; s <= steps; s++) {
      const t = s * dt;
      const es = new Float64Array(N);
      let sum = 0;
      for (let e = 0; e < N; e++) {
        const uR = e === N - 1 ? v0 * t : u[e + 1];
        const uL = e === 0 ? u[0] : u[e];
        es[e] = (uR - uL) / dx;
        sum += es[e];
      }
      strains.push(es);
      sums.push(sum);
      if (s === steps) break;
      for (let i = 0; i < N; i++) {
        const fl = i > 0 ? k * (u[i] - u[i - 1]) : 0;
        const fr = i < N - 1 ? k * (u[i] - u[i + 1]) : k * (u[i] - v0 * t);
        fInt[i] = fl + fr;
      }
      const r = crash.stepCentralDifference(u, vHalf, fExt, fInt, mass, dt);
      u.set(r.uNext);
      vHalf.set(r.vNextHalf);
    }
    return { strains, sums };
  };

  const v0 = 10;
  const r = run(v0);
  const r2 = run(2 * v0);
  const tFinal = steps * dt;

  for (let s = 0; s <= steps; s++) {
    for (let e = 0; e < N; e++) {
      assert.ok(r.strains[s][e] >= -1e-12, `negative strain elem ${e} at step ${s}`);
    }
  }

  const meanStrain = r.sums[steps] / N;
  const expectedMean = (v0 * tFinal) / L;
  assert.ok(relError(meanStrain, expectedMean) <= 1e-6, `mean strain ${meanStrain} vs v0*t/L ${expectedMean}`);

  const meanStrain2 = r2.sums[steps] / N;
  assert.ok(relError(meanStrain2, 2 * expectedMean) <= 1e-6, 'doubling end velocity must double strain');

  for (let s = 1; s <= steps; s++) {
    assert.ok(r.sums[s] >= r.sums[s - 1] - 1e-9, `total strain decreased at step ${s}`);
  }

  const mid = Math.floor(steps / 2);
  const nearMean = r.strains[mid].slice(N - 5).reduce((a, b) => a + b, 0) / 5;
  const farMean = r.strains[mid].slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  assert.ok(nearMean > 10 * farMean, `front ordering violated: near=${nearMean}, far=${farMean}`);

  const swept = r.strains[steps].filter((x) => x > 1e-9).length;
  assert.ok(swept / N >= 0.5, `wave must sweep at least half the column (swept ${swept}/${N})`);
});
