/**
 * OmniEng Experimental Liberty (.lib) Parser & NLDM Table Interpolation Example
 * 
 * Parses and interpolates selected Liberty timing data:
 * 1. Liberty (.lib) cell library representation (pin capacitances, leakage power, 2D lookups).
 * 2. Non-Linear Delay Model (NLDM) bi-cubic/bilinear table interpolation:
 *    Delay = f(input_transition_slew, output_load_capacitance).
 * 3. Output transition slew interpolation for downstream stage propagation.
 * 
 * Parser completeness, library coverage, and timing accuracy have not been independently assessed.
 */

'use strict';

class NLDMTable2D {
  /**
   * @param {Object} spec
   * @param {number[]} spec.index1 - Input transition slew values (ns) e.g. [0.01, 0.05, 0.1, 0.2]
   * @param {number[]} spec.index2 - Output load capacitance values (pF) e.g. [0.001, 0.005, 0.02, 0.05]
   * @param {number[][]} spec.values - 2D table of delays or slews (ns)
   */
  constructor(spec = {}) {
    this.index1 = spec.index1 || [0.01, 0.05, 0.1, 0.2];
    this.index2 = spec.index2 || [0.001, 0.005, 0.02, 0.05];
    this.values = spec.values || [
      [0.020, 0.035, 0.080, 0.150],
      [0.030, 0.045, 0.090, 0.160],
      [0.050, 0.065, 0.110, 0.180],
      [0.080, 0.095, 0.140, 0.210]
    ];
  }

  /**
   * Bilinear / Bi-cubic interpolation lookup
   * @param {number} slewIn - Input transition slew (ns)
   * @param {number} capLoad - Output load capacitance (pF)
   * @returns {number} Interpolated delay or output slew (ns)
   */
  lookup(slewIn, capLoad) {
    const x = this.index1;
    const y = this.index2;
    const V = this.values;

    // Find interval [x_i, x_i+1]
    let i = 0;
    while (i < x.length - 2 && slewIn > x[i + 1]) i++;
    let j = 0;
    while (j < y.length - 2 && capLoad > y[j + 1]) j++;

    const x0 = x[i], x1 = x[i + 1];
    const y0 = y[j], y1 = y[j + 1];

    const u = Math.max(0.0, Math.min(1.0, (slewIn - x0) / (x1 - x0 || 1e-6)));
    const v = Math.max(0.0, Math.min(1.0, (capLoad - y0) / (y1 - y0 || 1e-6)));

    // Bilinear interpolation
    const v00 = V[i][j];
    const v10 = V[i + 1][j];
    const v01 = V[i][j + 1];
    const v11 = V[i + 1][j + 1];

    const val = (1 - u) * (1 - v) * v00 +
                u * (1 - v) * v10 +
                (1 - u) * v * v01 +
                u * v * v11;

    return Number(val.toFixed(6));
  }
}

class LibertyCellPin {
  constructor(name, direction = 'input', capacitancePf = 0.002) {
    this.name = name;
    this.direction = direction;
    this.capacitancePf = capacitancePf;
  }
}

class LibertyCellModel {
  constructor(cellName, areaUm2 = 1.8) {
    this.name = cellName;
    this.areaUm2 = areaUm2;
    this.pins = new Map();
    this.cellRiseTable = new NLDMTable2D();
    this.cellFallTable = new NLDMTable2D();
    this.riseTransitionTable = new NLDMTable2D();
    this.fallTransitionTable = new NLDMTable2D();
  }

  addPin(pin) {
    this.pins.set(pin.name, pin);
    return this;
  }

  calculateCellDelay(slewIn, capLoad, isRise = true) {
    const table = isRise ? this.cellRiseTable : this.cellFallTable;
    const transTable = isRise ? this.riseTransitionTable : this.fallTransitionTable;

    const delay = table.lookup(slewIn, capLoad);
    const outputSlew = transTable.lookup(slewIn, capLoad);

    return {
      cellName: this.name,
      delayNs: delay,
      outputSlewNs: outputSlew,
      loadCapPf: capLoad
    };
  }
}

module.exports = {
  NLDMTable2D,
  LibertyCellPin,
  LibertyCellModel
};
