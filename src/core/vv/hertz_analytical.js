/**
 * Analytical verification adapter for the closed-form Hertz contact outputs.
 * This checks formula arithmetic only; it does not verify a discrete contact
 * solver or validate a material/contact model against physical measurements.
 */
'use strict';

const { ContactMechanics3D } = require('../cae/contact_mechanics_3d');

const CASE_INPUT = Object.freeze({
  radius1: 0.02,
  load: 1000,
  E1: 2.1e11,
  nu1: 0.3,
  E2: 2.1e11,
  nu2: 0.3
});

function independentlyEvaluateHertz(params) {
  const compliance = (1 - params.nu1 ** 2) / params.E1 + (1 - params.nu2 ** 2) / params.E2;
  const effectiveModulus = 1 / compliance;
  // radius2 is infinite for the flat half-space case, so R* = radius1.
  const effectiveRadius = params.radius1;
  const contactRadius = Math.cbrt((3 * params.load * effectiveRadius) / (4 * effectiveModulus));

  return {
    contactRadiusMeters: contactRadius,
    maxPressurePa: (3 * params.load) / (2 * Math.PI * contactRadius ** 2),
    indentationDepthMeters: contactRadius ** 2 / effectiveRadius
  };
}

function runHertzAnalyticalReference() {
  const engine = new ContactMechanics3D();
  const actual = engine.computeAnalyticalHertz(CASE_INPUT);
  const reference = independentlyEvaluateHertz(CASE_INPUT);
  const checks = [
    ['contactRadiusMeters', actual.contactRadiusMeters, reference.contactRadiusMeters],
    ['maxPressurePa', actual.maxPressurePa, reference.maxPressurePa],
    ['indentationDepthMeters', actual.indentationDepthMeters, reference.indentationDepthMeters]
  ];
  const relativeErrors = Object.fromEntries(
    checks.map(([name, value, expected]) => [name, Math.abs(value - expected) / Math.abs(expected)])
  );
  const maxRelativeError = Math.max(...Object.values(relativeErrors));
  const tolerance = 1e-12;
  const passed =
    checks.every(([, value, expected]) => Number.isFinite(value) && Number.isFinite(expected)) &&
    maxRelativeError <= tolerance;

  return {
    id: 'HERTZ_ANALYTICAL_FORMULA',
    name: 'Hertz closed-form outputs compared with an independent equation evaluation',
    targetValue: tolerance,
    calculatedValue: maxRelativeError,
    units: 'maximum relative error',
    errorPercent: maxRelativeError * 100,
    tolerancePercent: null,
    passed,
    reason: passed ? undefined : 'Closed-form Hertz outputs exceeded the declared formula tolerance.',
    metadata: {
      solverExecuted: false,
      scope: 'analytical formula arithmetic only',
      relativeErrors,
      referenceValues: reference
    }
  };
}

module.exports = { runHertzAnalyticalReference };
