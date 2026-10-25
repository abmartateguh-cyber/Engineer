'use strict';

/**
 * Compatibility wrapper for the old diagnostic path. The manufactured case
 * is not a NIST reference; the legacy NIST entry point now reports unavailable.
 */
const { runManufacturedSparseSPD } = require('../../../src/core/vv/manufactured_sparse_spd');
const { getUnavailableValidationCase } = require('../../../src/core/vv/validation_readiness');

function runNistSparseRobustness() {
  return getUnavailableValidationCase('NIST_SPARSE_ROBUSTNESS');
}

module.exports = { runManufacturedSparseSPD, runNistSparseRobustness };
