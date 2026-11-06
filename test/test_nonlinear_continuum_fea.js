/**
 * Test Suite: NonlinearContinuumFEA & ExplicitDynamicsCrash (Large Strain & Crashworthiness)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NonlinearContinuumFEA } = require('../src/core/cae/nonlinear_continuum_fea');
const { ExplicitDynamicsCrash } = require('../src/core/cae/explicit_dynamics_crash');

test('NonlinearContinuumFEA: Computes exact Green-Lagrange strain under uniaxial extension', () => {
  const fea = new NonlinearContinuumFEA();

  // Uniaxial stretch lambda = 1.2 along X-axis
  // gradU = [ [0.2, 0, 0], [0, 0, 0], [0, 0, 0] ]
  const gradU = [
    [0.2, 0.0, 0.0],
    [0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0]
  ];

  const tensors = fea.computeDeformationTensors(gradU);
  assert.equal(tensors.F[0][0], 1.2, 'F11 must equal lambda = 1.2');
  assert.equal(tensors.J, 1.2, 'J must equal 1.2');

  // Exact Green-Lagrange strain E11 = 0.5 * (lambda^2 - 1) = 0.5 * (1.44 - 1) = 0.22
  assert.ok(Math.abs(tensors.E[0][0] - 0.22) < 1e-12, 'E11 must equal 0.22');
  assert.equal(tensors.E[1][1], 0.0, 'E22 must be 0');
});

test('NonlinearContinuumFEA: Evaluates Mooney-Rivlin hyperelastic strain energy and stress', () => {
  const fea = new NonlinearContinuumFEA({ C10: 0.5e6, C01: 0.1e6, K_bulk: 1e7 });

  // Pure shear / isochoric stretch
  const gradU = [
    [0.1, 0.0, 0.0],
    [0.0, -0.0909090909, 0.0],
    [0.0, 0.0, 0.0]
  ];

  const { C, F, J } = fea.computeDeformationTensors(gradU);
  const { S, strainEnergyW } = fea.evaluateMooneyRivlinStress(C, J);

  assert.ok(strainEnergyW > 0.0, 'Strain energy must be positive for non-zero strain');
  const sigma = fea.pushForwardToCauchy(F, S, J);
  assert.ok(sigma[0][0] > 0.0, 'Tensile Cauchy stress in X must be positive');
});

test('ExplicitDynamicsCrash: Evaluates acoustic wave speed and Courant CFL time step', () => {
  // Steel: E = 210 GPa, nu = 0.3, rho = 7850 kg/m^3
  const crash = new ExplicitDynamicsCrash({ E: 210e9, nu: 0.3, rho: 7850.0 });

  const cd = crash.calculateWaveSpeed();
  // Analytical speed of sound in steel ~ 5900 m/s
  assert.ok(cd > 5500 && cd < 6200, `Wave speed ${cd.toFixed(1)} m/s must be ~ 5900 m/s`);

  // For element length L_char = 1.0 mm (0.001 m):
  // dt_crit = 0.85 * (0.001 / 5900) ~ 1.44e-7 s (144 nanoseconds)
  const dt = crash.calculateStableTimeStep(0.001);
  assert.ok(dt > 1e-7 && dt < 2e-7, `CFL time step ${dt.toExponential(3)} s must be ~ 140 ns`);
});

test('ExplicitDynamicsCrash: Integrates central difference step and detects erosion', () => {
  const crash = new ExplicitDynamicsCrash({ criticalPlasticStrain: 0.25 });

  const u = new Float64Array([0.0]);
  const vHalf = new Float64Array([10.0]); // 10 m/s initial velocity
  const fExt = new Float64Array([100.0]);
  const fInt = new Float64Array([0.0]);
  const m = new Float64Array([2.0]); // mass = 2 kg
  const dt = 1e-4; // 0.1 ms

  const step = crash.stepCentralDifference(u, vHalf, fExt, fInt, m, dt);
  assert.equal(step.accel[0], 50.0, 'Acceleration must be F/m = 100/2 = 50 m/s^2');
  assert.equal(step.vNextHalf[0], 10.0 + 50.0 * 1e-4, 'vNextHalf must update with a*dt');
  assert.ok(step.uNext[0] > 0.0, 'uNext must advance in direction of velocity');

  // Element failure check
  assert.equal(crash.isElementEroded(0.15), false, 'Plastic strain 0.15 < 0.25 must not erode');
  assert.equal(crash.isElementEroded(0.30), true, 'Plastic strain 0.30 >= 0.25 must erode');
});
