/**
 * Production-side availability record for independent validation cases.
 * This module reports missing evidence; it does not run solvers or tests.
 */
'use strict';

const { REFERENCE_SHA256, REFERENCE_SOURCE_URL } = require('./nasa_tmr_flatplate_reference');

const VALIDATION_CASES = Object.freeze([
  { id: 'NAFEMS_LE1', name: 'Elliptic membrane stress reference case' },
  { id: 'NAFEMS_LE10', name: 'Thick plate bending reference case' },
  { id: 'NAFEMS_LE11', name: 'Thick cylinder stress reference case' },
  { id: 'NAFEMS_FV32', name: 'Cantilever plate frequency reference case' },
  { id: 'NAFEMS_T1', name: 'Membrane with hot-spot thermo-elastic reference case' },
  { id: 'HERTZ_CONTACT_3D', name: 'Discrete sphere-on-flat contact pressure case' },
  {
    id: 'NASA_TMR_FLAT_PLATE',
    name: 'Zero-pressure-gradient flat plate solver comparison',
    referenceDataStatus: 'bundled-theoretical-correlation',
    referenceDataSource: REFERENCE_SOURCE_URL,
    referenceDataSha256: REFERENCE_SHA256,
    solverAdapterStatus: 'unavailable',
    reason:
      'The NASA TMR theoretical correlation data is bundled, but no compatible production RANS turbulence-model solver adapter is configured. No solver comparison was run.'
  },
  {
    id: 'HANOVER_BEAM_DYNAMIC_RESPONSE',
    name: 'Laboratory cantilever-beam dynamic response measurements',
    referenceDataStatus: 'external-experimental-measurements',
    referenceDataSource:
      'https://data.uni-hannover.de/de/dataset/a-benchmark-structure-for-virtual-sensing-on-tower-structures',
    referenceDataDoi: '10.25835/lyav246d',
    referenceDataAttribution: 'Jonathan Thurn, Clemens Jonscher, and Raimund Rolfes (2025)',
    referenceDataLicense: 'CC-BY-3.0',
    referenceDataLicenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    referenceDataArtifacts: Object.freeze([
      Object.freeze({
        fileName: 'ReadMe.pdf',
        byteLength: 49575522,
        sha256: '181e6bbec901ccd0cdc7c9c674fa131d3b7a35671603d7f8a475b268ba542615'
      }),
      Object.freeze({
        fileName: 'Data_strain_estimation_laboratory_beam.mat',
        byteLength: 15090174,
        sha256: '793ec8ae54cd36972880f1893bf5987684439f63119011583844e46f5e0da93f'
      }),
      Object.freeze({
        fileName: 'Beam_model.inp',
        byteLength: 124337,
        sha256: 'b3d413af19f32512936931f1573b9cae3210ef1675f3d4f08723334ca047141d'
      })
    ]),
    solverAdapterStatus: 'unavailable',
    reason:
      'The README, measurement data, and Abaqus input file were downloaded and SHA-256 pinned for provenance, but remain unbundled. No solver comparison was run, and no production adapter assembles a comparable beam mass model for dynamic response.'
  },
  { id: 'NIST_SPARSE_ROBUSTNESS', name: 'Sparse matrix numerical reference case' },
  { id: 'ISO_10110_OPTICS', name: 'Optical tolerance reference case' }
]);

const UNAVAILABLE_REASON =
  'Required independent reference data or a qualified production solver adapter is not configured.';

function getValidationReadiness() {
  const results = VALIDATION_CASES.map((testCase) => ({
    ...testCase,
    status: 'unavailable',
    reason: testCase.reason || UNAVAILABLE_REASON
  }));

  return {
    status: 'unavailable',
    validationLevel: 'unavailable',
    total: results.length,
    available: 0,
    unavailable: results.length,
    results
  };
}

function getUnavailableValidationCase(id) {
  const testCase = VALIDATION_CASES.find((candidate) => candidate.id === id);
  if (!testCase) throw new RangeError(`Unknown validation case: ${id}`);

  return {
    ...testCase,
    targetValue: null,
    calculatedValue: null,
    units: 'unavailable',
    errorPercent: null,
    tolerancePercent: null,
    passed: false,
    status: 'unavailable',
    reason: testCase.reason || UNAVAILABLE_REASON
  };
}

module.exports = { getValidationReadiness, getUnavailableValidationCase };
