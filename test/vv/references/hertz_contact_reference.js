/**
 * Standalone sphere-on-flat Hertz formula diagnostic. It is not the named
 * HERTZ_CONTACT_3D discrete contact reference case.
 *
 * Production path: ContactMechanics3D.solveSphereOnFlatContact
 * (src/core/cae/contact_mechanics_3d.js). Note: that production module is a
 * closed-form Hertz estimate with midpoint quadrature of the analytic pressure
 * profile (it reports solverExecuted=false); no discrete contact solver is
 * bundled in this engine. The runner therefore verifies the production
 * computation against independently coded Hertz theory (published closed form)
 * plus the equilibrium property that the integrated pressure profile must
 * reproduce the imposed load.
 *
 * Reference (published canonical result, Hertz 1882):
 *   a = (3 F R* / (4 E*))^(1/3)
 *   p0 = 3 F / (2 pi a^2)
 *   1/E* = (1-nu1^2)/E1 + (1-nu2^2)/E2
 * The runner reports HERTZ_CONTACT_CLOSED_FORM_ANALYTIC. The named
 * HERTZ_CONTACT_3D reference remains unavailable in the production readiness
 * registry and is not satisfied by this analytic formula comparison.
 */
'use strict';

const { ContactMechanics3D } = require('../../../src/core/cae/contact_mechanics_3d');

function independentlyEvaluateHertz(params) {
  const invEStar = (1 - params.nu1 * params.nu1) / params.E1 + (1 - params.nu2 * params.nu2) / params.E2;
  const EStar = 1 / invEStar;
  const RStar = params.radius1;
  const contactRadius = Math.cbrt((3 * params.load * RStar) / (4 * EStar));
  const maxPressure = (3 * params.load) / (2 * Math.PI * contactRadius * contactRadius);
  return { EStar, RStar, contactRadius, maxPressure };
}

const CASES = [
  { radius1: 0.02, load: 1000, E1: 2.1e11, nu1: 0.3, E2: 2.1e11, nu2: 0.3 },
  { radius1: 0.05, load: 500, E1: 200e9, nu1: 0.28, E2: 70e9, nu2: 0.33 },
  { radius1: 0.01, load: 2500, E1: 210e9, nu1: 0.3, E2: 210e9, nu2: 0.3 }
];

function runHertzContact3D() {
  const engine = new ContactMechanics3D();
  const checks = [];
  let maxErrorPercent = 0;
  for (const params of CASES) {
    const production = engine.solveSphereOnFlatContact(params);
    const reference = independentlyEvaluateHertz(params);
    const aErr =
      Math.abs(production.analytical.contactRadiusMeters - reference.contactRadius) / reference.contactRadius;
    const pErr = Math.abs(production.analytical.maxPressurePa - reference.maxPressure) / reference.maxPressure;
    const forceErr = Math.abs(production.profileQuadrature.totalForceNewtons - params.load) / params.load;
    maxErrorPercent = Math.max(maxErrorPercent, aErr * 100, pErr * 100);
    checks.push({
      params,
      contactRadiusM: production.analytical.contactRadiusMeters,
      referenceContactRadiusM: reference.contactRadius,
      maxPressurePa: production.analytical.maxPressurePa,
      referenceMaxPressurePa: reference.maxPressure,
      integratedForceN: production.profileQuadrature.totalForceNewtons,
      contactRadiusErrorPercent: aErr * 100,
      maxPressureErrorPercent: pErr * 100,
      integratedForceErrorPercent: forceErr * 100
    });
  }

  const tolerancePercentP0 = 4;
  const tolerancePercentA = 3;
  const passed =
    checks.every((c) => c.maxPressureErrorPercent <= tolerancePercentP0) &&
    checks.every((c) => c.contactRadiusErrorPercent <= tolerancePercentA) &&
    checks.every((c) => c.integratedForceErrorPercent <= 1);

  return {
    id: 'HERTZ_CONTACT_CLOSED_FORM_ANALYTIC',
    name: 'Sphere-on-flat Hertz closed-form contact pressure and equilibrium reference (no discrete contact solver executed)',
    targetValue: null,
    calculatedValue: maxErrorPercent,
    units: '%',
    errorPercent: maxErrorPercent,
    tolerancePercentP0,
    tolerancePercentA,
    tolerancePercent: { p0: tolerancePercentP0, contactRadius: tolerancePercentA },
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed ? undefined : 'Hertz contact outputs deviated from the independently coded closed form.',
    measured: checks,
    expected: {
      formulas: ['a = (3 F R*/(4 E*))^(1/3)', 'p0 = 3F/(2 pi a^2)', 'integrated pressure profile = applied load F']
    },
    details: {
      reference: 'Hertz (1882) closed-form sphere-on-flat contact solution, coded independently in this module.',
      solver:
        'ContactMechanics3D.solveSphereOnFlatContact (production; closed-form + midpoint quadrature, solverExecuted=false)',
      note: 'No discrete contact solver exists in the production engine; this runner validates the production contact module and its equilibrium consistency.',
      solverExecuted: false
    }
  };
}

module.exports = { runHertzContact3D, independentlyEvaluateHertz };
