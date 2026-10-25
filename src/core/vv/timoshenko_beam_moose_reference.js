'use strict';

const { REFERENCE_CASES, runMooseBeamReference } = require('./moose_beam_reference');

function runTimoshenkoBeamMooseReference() {
  return runMooseBeamReference(REFERENCE_CASES.timoshenko);
}

module.exports = { runTimoshenkoBeamMooseReference };
