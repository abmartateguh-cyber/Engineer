'use strict';

// Synthetic-only inputs for formula and routing smoke checks. These values do
// not describe a process, package, foundry stack, or qualified EM model.
const SYNTHETIC_PDN_GEOMETRY = Object.freeze({
  pitchX: 10e-6,
  pitchY: 10e-6,
  sheetRho: 0.05,
  wireWidth: 1e-6
});

const SYNTHETIC_PDN_OPTIONS = Object.freeze({
  vdd: 1.2,
  maxDropThresholdPercent: 3,
  metalThickness: 0.2e-6
});

const SYNTHETIC_BLACKS_MODEL = Object.freeze({
  preExponentialCoefficient: 4,
  activationEnergyEV: 1,
  currentDensityExponent: 1,
  boltzmannEVPerK: 1,
  provenance: 'synthetic test-only coefficients; no measured or physical basis'
});

function createSyntheticPdnAnalyzer(overrideOptions = {}) {
  const { PowerGridIRDropAnalyzer } = require('../../src/core/eda/power_grid_ir_drop');
  return new PowerGridIRDropAnalyzer({ ...SYNTHETIC_PDN_OPTIONS, ...overrideOptions });
}

function createSyntheticPdnMesh(analyzer, rows, cols) {
  const { pitchX, pitchY, sheetRho, wireWidth } = SYNTHETIC_PDN_GEOMETRY;
  return analyzer.createGridMesh(rows, cols, pitchX, pitchY, sheetRho, wireWidth);
}

module.exports = {
  SYNTHETIC_PDN_GEOMETRY,
  SYNTHETIC_PDN_OPTIONS,
  SYNTHETIC_BLACKS_MODEL,
  createSyntheticPdnAnalyzer,
  createSyntheticPdnMesh
};
