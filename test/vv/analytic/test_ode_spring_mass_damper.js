/**
 * Spring-mass-damper transient against damped-harmonic closed form.
 *
 * The production RK4 ODE integrator (ode_solvers.js) integrates a damped
 * harmonic oscillator from rest; the solution is compared with the
 * closed-form underdamped response at several checkpoints. This verifies the
 * production integrator against an independent analytic transient.
 */

'use strict';

const { ODESolvers } = require('../../../src/core/math/ode_solvers');

const MASS = 1;
const STIFFNESS = 100;
const ZETA = 0.1;
const DT = 0.002;
const T_END = 2;
const TOLERANCE = 1e-4;

function runOdeSpringMassDamper() {
  const w0 = Math.sqrt(STIFFNESS / MASS);
  const wd = w0 * Math.sqrt(1 - ZETA * ZETA);
  const xExact = (t) => Math.exp(-ZETA * w0 * t) * (Math.cos(wd * t) + ((ZETA * w0) / wd) * Math.sin(wd * t));
  const rhs = (t, y) => [y[1], -(STIFFNESS / MASS) * y[0] - 2 * ZETA * w0 * y[1]];

  const trajectory = ODESolvers.solveRK4(rhs, [1, 0], 0, T_END, DT);

  const checkpoints = [0.25, 0.5, 1.0, 1.5, 2.0];
  const errors = [];
  for (const t of checkpoints) {
    const point = trajectory.find((p) => Math.abs(p.t - t) < 1e-9);
    if (!point)
      return {
        id: 'ODE_SPRING_MASS_DAMPER_TRANSIENT',
        name: 'Spring-mass-damper transient vs damped-harmonic closed form (production RK4)',
        targetValue: TOLERANCE,
        calculatedValue: Infinity,
        units: 'max relative position error',
        errorPercent: null,
        tolerancePercent: TOLERANCE * 100,
        passed: false,
        status: 'invalid',
        reason: 'Checkpoint missing from RK4 trajectory.',
        measured: {},
        expected: { closedForm: 'x(t)=exp(-zeta w0 t)(cos(wd t)+zeta w0/wd sin(wd t))' },
        details: { note: 'Invalid diagnostic: trajectory did not contain the requested times.' }
      };
    const rel = Math.abs(point.y[0] - xExact(t)) / Math.max(1.0, Math.abs(xExact(t)));
    errors.push({ t, rel });
  }

  const maxRelErr = Math.max(...errors.map((e) => e.rel));
  const passed = Number.isFinite(maxRelErr) && maxRelErr <= TOLERANCE;

  return {
    id: 'ODE_SPRING_MASS_DAMPER_TRANSIENT',
    name: 'Spring-mass-damper transient vs damped-harmonic closed form (production RK4)',
    targetValue: TOLERANCE,
    calculatedValue: maxRelErr,
    units: 'max relative position error',
    errorPercent: maxRelErr * 100,
    tolerancePercent: TOLERANCE * 100,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed ? undefined : 'RK4 transient deviates from the closed-form response beyond the declared tolerance.',
    measured: {
      maxRelativeError: maxRelErr,
      checkpointErrors: errors,
      steps: trajectory.length,
      solver: 'ODESolvers.solveRK4 (production)'
    },
    expected: {
      closedForm: 'x(t)=exp(-zeta w0 t)(cos(wd t)+zeta w0/wd sin(wd t))',
      parameters: { massKg: MASS, stiffnessNPerM: STIFFNESS, dampingRatio: ZETA, dt: DT, tEnd: T_END }
    },
    details: {
      reference: 'Closed-form underdamped oscillator response (independent analytic).',
      solver: 'ode_solvers.js (production) RK4 integrator.',
      note: 'Verifies integrator accuracy against an analytic transient; not certification.'
    }
  };
}

module.exports = { runOdeSpringMassDamper };
