'use strict';

// Synthetic-only example values for smoke tests. They are not extracted from
// a layout, PDK, package, library model, or characterized signal-integrity deck.
const SYNTHETIC_CROSSTALK_INPUTS = Object.freeze({
  aggressorSlewRate: 20e9,
  couplingCapacitance: 15e-15,
  victimGroundCapacitance: 35e-15,
  victimDriverResistance: 120,
  vdd: 0.75,
  noiseMarginThresholdV: 0.15,
  pulseWidthTimeConstantFactor: 2.2
});

module.exports = { SYNTHETIC_CROSSTALK_INPUTS };
