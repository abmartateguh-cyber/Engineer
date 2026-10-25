/**
 * NASA TMR flat-plate reference-data adapter.
 * The bundled theoretical curve is available, but no compatible production
 * turbulence-model solver is configured to run the case.
 */
'use strict';

const { loadNasaTmrFlatPlateReference } = require('../../../src/core/vv/nasa_tmr_flatplate_reference');

function runNasaTmrFlatPlate() {
  let reference;
  try {
    reference = loadNasaTmrFlatPlateReference();
  } catch (error) {
    return {
      id: 'NASA_TMR_FLAT_PLATE',
      name: '2D zero-pressure-gradient flat-plate case',
      targetValue: null,
      calculatedValue: null,
      units: 'unavailable',
      errorPercent: null,
      tolerancePercent: null,
      passed: false,
      status: 'invalid',
      reason: `Bundled NASA TMR reference data failed integrity checks: ${error.message}`
    };
  }

  return {
    id: 'NASA_TMR_FLAT_PLATE',
    name: '2D zero-pressure-gradient flat-plate solver comparison',
    targetValue: null,
    calculatedValue: null,
    units: 'unavailable',
    errorPercent: null,
    tolerancePercent: null,
    passed: false,
    status: 'unavailable',
    referenceDataStatus: 'bundled-theoretical-correlation',
    referenceDataSource: reference.sourceUrl,
    referenceDataSha256: reference.sha256,
    referencePointCount: reference.points.length,
    reason:
      'The NASA TMR theoretical correlation data is bundled and checksum-verified, but no compatible production RANS turbulence-model solver adapter is configured. No solver comparison was run.'
  };
}

module.exports = { runNasaTmrFlatPlate };
