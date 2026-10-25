'use strict';

const { REFERENCE_CASES, runMooseBeamReference } = require('./moose_beam_reference');

function runEulerBeamMooseReference() {
  return runMooseBeamReference(REFERENCE_CASES.eulerLimit);
}

module.exports = { runEulerBeamMooseReference };
