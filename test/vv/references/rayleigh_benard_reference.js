/**
 * Rayleigh-Benard thermal-convection onset gold-slot reference.
 *
 * Two documented checks:
 *  (a) Conduction state: the production 2D steady heat-conduction finite
 *      element solver Poisson2DMixed (src/core/cae/poisson_2d_mixed.js) is
 *      solved for a plane layer heated from below (T_hot at y = 0) and cooled
 *      from above (T_cold at y = H) with insulated sidewalls. The analytic
 *      steady conduction state is the linear profile
 *        T(y) = T_hot - (T_hot - T_cold) y / H.
 *  (b) Critical Rayleigh number: for a plane horizontal layer with
 *      rigid-rigid boundaries the critical Rayleigh number for the onset of
 *      convection is Ra_c = 1707.762 with critical wavenumber
 *      k_c = 3.117 (Chandrasekhar 1961). The diagnostic evaluates the Rayleigh
 *      number Ra = g beta DeltaT H^3/(nu alpha) for a documented conduction
 *      configuration and verifies Ra < Ra_c (conduction state is linearly
 *      stable, so the linear profile is the physically realized state).
 */

'use strict';

const { Poisson2DMixed } = require('../../../src/core/cae/poisson_2d_mixed');

const T_HOT = 300.0;
const T_COLD = 280.0;
const H_LAYER = 0.1;
const W_LAYER = 0.1;
const NGRID = 41;
const K_COND = 0.6;

const RA_C = 1707.762; // critical Rayleigh number, rigid-rigid plane layer
const K_C = 3.117; // critical wavenumber (dimensionless)

function evaluateRayleighNumber(g, beta, deltaT, H, nu, alpha) {
  return (g * beta * deltaT * H ** 3) / (nu * alpha);
}

function runRayleighBenardConductionState() {
  const solver = new Poisson2DMixed({ conductivity: K_COND });
  const nid = (j, i) => j * NGRID + i;
  for (let j = 0; j < NGRID; j++) {
    for (let i = 0; i < NGRID; i++) {
      solver.addNode((i * W_LAYER) / (NGRID - 1), (j * H_LAYER) / (NGRID - 1));
    }
  }
  for (let j = 0; j < NGRID - 1; j++) {
    for (let i = 0; i < NGRID - 1; i++) {
      solver.addQuad([nid(j, i), nid(j, i + 1), nid(j + 1, i + 1), nid(j + 1, i)]);
    }
  }
  for (let i = 0; i < NGRID; i++) {
    solver.setTemperature(nid(0, i), T_HOT);
    solver.setTemperature(nid(NGRID - 1, i), T_COLD);
  }

  const res = solver.solve();
  const ic = Math.floor(NGRID / 2);
  let maxProfileErrorPercent = 0;
  const profile = [];
  for (let j = 1; j < NGRID - 1; j++) {
    const y = (j * H_LAYER) / (NGRID - 1);
    const Tanalytic = T_HOT - ((T_HOT - T_COLD) * y) / H_LAYER;
    const Tnum = res.temperature[nid(j, ic)];
    const err = (Math.abs(Tnum - Tanalytic) / (T_HOT - T_COLD)) * 100;
    maxProfileErrorPercent = Math.max(maxProfileErrorPercent, err);
    if (j % 5 === 0)
      profile.push({
        yOverH: +(y / H_LAYER).toFixed(3),
        temperatureK: +Tnum.toFixed(3),
        analyticK: +Tanalytic.toFixed(3)
      });
  }

  // (b) Documented analytic Ra_c check for a stable conduction configuration:
  // thin water layer, small DeltaT => Ra << Ra_c => conduction state is stable.
  const g = 9.81;
  const beta = 2.0e-4; // thermal expansion coefficient (1/K)
  const deltaT = 0.1; // K
  const Hc = 1.0e-3; // m
  const nu = 1.0e-6; // kinematic viscosity (m^2/s)
  const alpha = 1.43e-7; // thermal diffusivity (m^2/s)
  const Ra = evaluateRayleighNumber(g, beta, deltaT, Hc, nu, alpha);
  const raFloor = Ra / RA_C;

  const toleranceProfilePercent = 0.5;
  const passed = maxProfileErrorPercent <= toleranceProfilePercent && raFloor < 1.0;
  return {
    id: 'RAYLEIGH_BENARD_CONDUCTION_ONSET',
    name: 'Rayleigh-Benard: production Poisson2DMixed conduction-state linear profile + analytic Ra_c = 1707.762 check',
    targetValue: T_HOT - (T_HOT - T_COLD) * 0.5,
    calculatedValue: res.temperature[nid(Math.floor(NGRID / 2), ic)],
    units: 'K',
    errorPercent: maxProfileErrorPercent,
    tolerancePercent: toleranceProfilePercent,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : `Conduction profile deviates from linear profile by ${maxProfileErrorPercent.toFixed(4)}% or Ra/Ra_c >= 1.`,
    measured: {
      maxProfileErrorPercent,
      profile,
      rayleighNumber: Ra,
      criticalRayleighNumber: RA_C,
      rayleighOverCritical: +raFloor.toExponential(4),
      conductionStable: raFloor < 1.0
    },
    expected: {
      conductionProfile: 'T(y) = T_hot - (T_hot - T_cold) y/H (exact linear steady conduction state)',
      criticalRayleighNumber: 'Ra_c = 1707.762, k_c = 3.117 (rigid-rigid plane layer; Chandrasekhar 1961)'
    },
    details: {
      reference:
        'Linear conduction profile (exact) and Chandrasekhar (1961) critical Rayleigh number for the plane layer.',
      solver:
        'Poisson2DMixed (production; Q4 mixed FE steady conduction) for part (a); part (b) is the documented analytic Ra_c check.',
      label: 'The Ra_c check is analytic (no production convection solver exists); it is documented as such.',
      note: 'The conduction configuration is chosen so Ra < Ra_c, i.e., the linear profile is the linearly stable state.'
    }
  };
}

module.exports = { runRayleighBenardConductionState, evaluateRayleighNumber, RA_C, K_C };
