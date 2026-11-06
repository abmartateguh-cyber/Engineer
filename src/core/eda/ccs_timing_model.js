/**
 * OmniEng Composite Current Source (CCS) Transient Timing Model
 *
 * Genuine transient current-source driver model:
 *  - The driver is described by a 2D current lookup table I(Vin, Vout)
 *    (amperes over an input/output voltage grid), interpolated bilinearly.
 *    No waveform is fabricated from a closed-form Gaussian; only the supplied
 *    table values are used.
 *  - The output node obeys  dVout/dt = (I(driver) - Vout/Rload) / Ctotal,
 *    integrated with the production RK4 ODE solver (src/core/math/ode_solvers.js).
 *  - Delay is measured from the input crossing VDD/2 to the output crossing
 *    VDD/2 on the simulated waveform; output slew is the 10%-90% time.
 *
 * The built-in default table is a clearly labelled illustrative placeholder,
 * not sign-off characterization data. Sign-off characterization requires a
 * user-supplied table passed to characterizeCell().
 */

'use strict';

const { ODESolvers } = require('../math/ode_solvers');

class CCSTimingModel {
  /**
   * @param {Object} cellSpec
   * @param {string} [cellSpec.cellName='INV_X4']
   * @param {number} [cellSpec.supplyVoltageV=1.0] - VDD
   * @param {number} [cellSpec.pinCapacitanceFf=0.8] - intrinsic output pin capacitance
   * @param {number} [cellSpec.peakDriverCurrentMa=8.0] - illustrative default table peak current
   * @param {Object} [cellSpec.driveTable] - I(Vin, Vout) table: {vinGrid, voutGrid, currents}
   * @param {Object} [cellSpec.cvTable] - receiver C-V table: {vGrid, cFfValues}
   */
  constructor(cellSpec = {}) {
    this.cellName = cellSpec.cellName || 'INV_X4';
    this.vdd = cellSpec.supplyVoltageV || 1.0;
    this.pinCapacitanceFf = cellSpec.pinCapacitanceFf !== undefined ? cellSpec.pinCapacitanceFf : 0.8;
    this.defaultPeakCurrentMa = cellSpec.peakDriverCurrentMa !== undefined ? cellSpec.peakDriverCurrentMa : 8.0;
    this.table = cellSpec.driveTable || null;
    this.cvTable = cellSpec.cvTable || null;
  }

  /**
   * Builds the illustrative default drive table. This is a documented,
   * non-Gaussian placeholder (saturating CMOS-like transfer), NOT vendor
   * characterization data. Gate turn-on is a hyperbolic-tangent ramp around
   * 0.3*VDD with a wide soft transition; headroom decay is intentionally
   * shallow so the node can reach the rail against a resistive load.
   * @param {number} vdd
   * @param {number} peakCurrentMa
   * @returns {{vinGrid: number[], voutGrid: number[], currents: number[][]}}
   */
  static _defaultDriveTable(vdd, peakCurrentMa) {
    const n = 33;
    const vinGrid = [];
    const voutGrid = [];
    for (let i = 0; i < n; i++) {
      vinGrid.push((i / (n - 1)) * vdd);
      voutGrid.push((i / (n - 1)) * vdd);
    }
    const vth = 0.3 * vdd;
    const width = 0.08 * vdd;
    const imax = peakCurrentMa * 1e-3;
    const currents = [];
    for (let i = 0; i < n; i++) {
      const vin = vinGrid[i];
      const gate = 0.5 * (1 + Math.tanh((vth - vin) / width));
      const row = [];
      for (let j = 0; j < n; j++) {
        const vout = voutGrid[j];
        const headroom = Math.pow(1 - Math.min(1, vout / vdd), 0.15);
        row.push(imax * gate * headroom);
      }
      currents.push(row);
    }
    return { vinGrid, voutGrid, currents };
  }

  /**
   * Validates a driver table: strictly increasing finite grids, matching
   * finite current matrix.
   * @param {Object} table
   * @returns {boolean}
   */
  static validateTable(table) {
    if (
      !table ||
      !Array.isArray(table.vinGrid) ||
      !Array.isArray(table.voutGrid) ||
      !Array.isArray(table.currents)
    ) {
      throw new TypeError('driver table must be { vinGrid: number[], voutGrid: number[], currents: number[][] }');
    }
    const ni = table.vinGrid.length;
    const nj = table.voutGrid.length;
    if (ni < 2 || nj < 2) {
      throw new RangeError('driver table grids must have at least 2 points each');
    }
    if (table.currents.length !== ni || table.currents.some((row) => !Array.isArray(row) || row.length !== nj)) {
      throw new RangeError('driver table currents must be an ni x nj matrix');
    }
    for (let i = 1; i < ni; i++) {
      if (!(table.vinGrid[i] > table.vinGrid[i - 1])) {
        throw new RangeError('vinGrid must be strictly increasing');
      }
    }
    for (let j = 1; j < nj; j++) {
      if (!(table.voutGrid[j] > table.voutGrid[j - 1])) {
        throw new RangeError('voutGrid must be strictly increasing');
      }
    }
    for (let i = 0; i < ni; i++) {
      for (let j = 0; j < nj; j++) {
        if (!Number.isFinite(table.currents[i][j])) {
          throw new RangeError('driver table currents must be finite');
        }
      }
    }
    return true;
  }

  /**
   * Bilinear interpolation of I(Vin, Vout) on the supplied table. Values
   * outside the grid are clamped to the grid boundary. Assumes the table has
   * already been validated (callers should validate once via validateTable).
   * @param {Object} table
   * @param {number} vin
   * @param {number} vout
   * @returns {number} current in amperes
   */
  static interpolateCurrent(table, vin, vout) {
    const { vinGrid, voutGrid, currents } = table;
    const x = Math.max(vinGrid[0], Math.min(vinGrid[vinGrid.length - 1], vin));
    const y = Math.max(voutGrid[0], Math.min(voutGrid[voutGrid.length - 1], vout));
    let i1 = 0;
    while (i1 < vinGrid.length - 2 && vinGrid[i1 + 1] <= x) i1++;
    let j1 = 0;
    while (j1 < voutGrid.length - 2 && voutGrid[j1 + 1] <= y) j1++;
    const i2 = i1 + 1;
    const j2 = j1 + 1;
    const x0 = vinGrid[i1];
    const x1 = vinGrid[i2];
    const y0 = voutGrid[j1];
    const y1 = voutGrid[j2];
    const fx = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
    const fy = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
    const i00 = currents[i1][j1];
    const i10 = currents[i2][j1];
    const i01 = currents[i1][j2];
    const i11 = currents[i2][j2];
    return i00 * (1 - fx) * (1 - fy) + i10 * fx * (1 - fy) + i01 * (1 - fx) * fy + i11 * fx * fy;
  }

  /**
   * Receiver input capacitance. If a C-V table was supplied it is linearly
   * interpolated; otherwise a constant physical plate/pin capacitance is
   * returned (no fabricated Gaussian peaking).
   * @param {number} voltage - V in [0, VDD]
   * @returns {number} capacitance in farads
   */
  evaluateReceiverCapacitance(voltage) {
    const cv = this.cvTable;
    if (cv && Array.isArray(cv.vGrid) && Array.isArray(cv.cFfValues)) {
      if (cv.vGrid.length !== cv.cFfValues.length || cv.vGrid.length < 2) {
        throw new RangeError('cvTable must have matching, ascending vGrid/cFfValues arrays of length >= 2');
      }
      for (let i = 1; i < cv.vGrid.length; i++) {
        if (!(cv.vGrid[i] > cv.vGrid[i - 1])) {
          throw new RangeError('cvTable.vGrid must be strictly increasing');
        }
      }
      const x = Math.max(cv.vGrid[0], Math.min(cv.vGrid[cv.vGrid.length - 1], voltage));
      let i1 = 0;
      while (i1 < cv.vGrid.length - 2 && cv.vGrid[i1 + 1] <= x) i1++;
      const i2 = i1 + 1;
      const x0 = cv.vGrid[i1];
      const x1 = cv.vGrid[i2];
      const alpha = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return (cv.cFfValues[i1] + alpha * (cv.cFfValues[i2] - cv.cFfValues[i1])) * 1e-15;
    }
    return this.pinCapacitanceFf * 1e-15;
  }

  _ensureDefaultTable() {
    if (!this.table) {
      this.table = CCSTimingModel._defaultDriveTable(this.vdd, this.defaultPeakCurrentMa);
    }
    return this.table;
  }

  /**
   * Finds the first crossing of `level` in a trajectory by linear
   * interpolation between bracketing samples.
   * @param {Array<{t: number, y: number[]}>} trajectory - t in seconds
   * @param {number} level
   * @returns {{t: number, v: number}|null}
   */
  static _crossing(trajectory, level) {
    for (let i = 1; i < trajectory.length; i++) {
      const a = trajectory[i - 1].y[0];
      const b = trajectory[i].y[0];
      if ((a < level && b >= level) || (a > level && b <= level)) {
        if (b === a) return { t: trajectory[i].t, v: b };
        const alpha = (level - a) / (b - a);
        return { t: trajectory[i - 1].t + alpha * (trajectory[i].t - trajectory[i - 1].t), v: level };
      }
    }
    return null;
  }

  /**
   * Integrates the output-node ODE  dVout/dt = (I(Vin(t), Vout) - Vout/Rload) / Ctotal
   * with RK4 over [0, maxTime].
   * @param {Object} table
   * @param {Object} opts - {cloadFf, rLoadOhms, inputSlewPs, direction, maxTimeSeconds}
   * @returns {{trajectory: Array<{t: number, y: number[]}>, cTotalFf: number, dt: number}}
   */
  _integrate(table, opts) {
    const vdd = this.vdd;
    const slewSeconds = opts.inputSlewPs * 1e-12;
    const cTotalFf = opts.cloadFf;
    const cTotal = cTotalFf * 1e-15;
    const rLoad = opts.rLoadOhms > 0 ? opts.rLoadOhms : Infinity;
    const direction = opts.direction === 'fall' ? 'fall' : 'rise';
    const maxTime = opts.maxTimeSeconds > 0 ? opts.maxTimeSeconds : 5e-9;

    const vinAt = (t) => {
      const ramp = vdd * Math.min(1, Math.max(0, t / slewSeconds));
      return direction === 'fall' ? ramp : vdd - ramp;
    };

    const deriv = (t, y) => {
      const vout = y[0];
      const iDriver = CCSTimingModel.interpolateCurrent(table, vinAt(t), vout);
      const iResistor = Number.isFinite(rLoad) ? vout / rLoad : 0;
      return [(iDriver - iResistor) / cTotal];
    };

    const rcTimeConstant = Number.isFinite(rLoad) ? rLoad * cTotal : Infinity;
    const dt = Math.max(
      1e-15,
      Math.min(1e-13, slewSeconds / 500, Number.isFinite(rcTimeConstant) ? rcTimeConstant / 50 : Infinity)
    );

    const trajectory = ODESolvers.solveRK4(deriv, [0], 0, maxTime, dt);
    return { trajectory, cTotalFf, dt };
  }

  /**
   * Characterizes a cell transient response from a genuine I(Vin, Vout)
   * lookup table using real integration.
   * @param {Object|null} table - I(Vin, Vout) table; null uses the illustrative default
   * @param {Object} opts
   * @param {number} [opts.cin] - intrinsic/node capacitance added to cload (fF)
   * @param {number} [opts.cload=5] - output load capacitance (fF)
   * @param {number} [opts.rLoad=1000] - output load resistance (ohms)
   * @param {number} [opts.slew=20] - input transition time (ps)
   * @param {string} [opts.direction='rise'] - 'rise' (input falls VDD->0) or 'fall'
   * @param {number} [opts.maxTimeSeconds] - integration horizon override
   * @returns {{delayPs: number|null, outputSlewPs: number|null, waveform: Array<{t: number, vout: number}>, cTotalFf: number, rLoadOhms: number, inputSlewPs: number, direction: string, tableSource: string, integrator: string}}
   */
  characterizeCell(table = null, opts = {}) {
    const tbl = table || this._ensureDefaultTable();
    CCSTimingModel.validateTable(tbl);
    const vdd = this.vdd;
    const cinFf = opts.cin !== undefined ? opts.cin : this.pinCapacitanceFf;
    const cloadFf = opts.cload !== undefined ? opts.cload : 5.0;
    const rLoadOhms = opts.rLoad !== undefined ? opts.rLoad : 1000;
    const inputSlewPs = opts.slew !== undefined ? opts.slew : 20.0;
    const direction = opts.direction === 'fall' ? 'fall' : 'rise';

    const { trajectory } = this._integrate(tbl, {
      cloadFf: cloadFf + cinFf,
      rLoadOhms,
      inputSlewPs,
      direction,
      maxTimeSeconds: opts.maxTimeSeconds
    });

    const tInputMid = inputSlewPs * 1e-12 / 2;
    const t50 = CCSTimingModel._crossing(trajectory, 0.5 * vdd);
    const t10 = CCSTimingModel._crossing(trajectory, 0.1 * vdd);
    const t90 = CCSTimingModel._crossing(trajectory, 0.9 * vdd);

    const delayPs = t50 === null ? null : (t50.t - tInputMid) * 1e12;
    const outputSlewPs =
      t10 !== null && t90 !== null ? Math.abs(t90.t - t10.t) * 1e12 : null;

    return {
      delayPs,
      outputSlewPs,
      waveform: trajectory.map((pt) => ({ t: pt.t * 1e12, vout: pt.y[0] })),
      cTotalFf: cloadFf + cinFf,
      rLoadOhms,
      inputSlewPs,
      direction,
      tableSource: table ? 'provided' : 'built-in-illustrative',
      integrator: 'RK4'
    };
  }

  /**
   * Legacy-compatible stage delay simulation. Uses the illustrative default
   * table unless a drive table was supplied to the constructor.
   * @param {Object} load - {cLoadFf, rWireOhms (load resistance)}
   * @param {number} inputSlewPs
   * @returns {Object}
   */
  simulateStageDelay(load = {}, inputSlewPs = 20.0) {
    const cLoadFf = load.cLoadFf || 5.0;
    const rWireOhms = load.rWireOhms !== undefined ? load.rWireOhms : 1000;
    const res = this.characterizeCell(null, {
      cload: cLoadFf,
      rLoad: rWireOhms,
      slew: inputSlewPs
    });
    return {
      cell: this.cellName,
      supplyVoltageV: this.vdd,
      loadCapacitanceFf: cLoadFf,
      effectiveCapacitanceFf: res.cTotalFf,
      inputSlewPs,
      propagationDelayNs: res.delayPs === null ? null : res.delayPs / 1000,
      outputSlewNs: res.outputSlewPs === null ? null : res.outputSlewPs / 1000,
      ccsCurrentPeakMa: Number(this.defaultPeakCurrentMa.toFixed(2)),
      modelStandard: 'Composite Current Source (CCS) transient table-driven'
    };
  }

  simulateDriverOutput(cLoadFarads = 5e-15, vdd = null) {
    if (vdd !== null && vdd > 0) this.vdd = vdd;
    const res = this.simulateStageDelay({ cLoadFf: cLoadFarads * 1e15 }, 20.0);
    return {
      delaySeconds: res.propagationDelayNs === null ? null : res.propagationDelayNs * 1e-9,
      slewSeconds: res.outputSlewNs === null ? null : res.outputSlewNs * 1e-9,
      delayNs: res.propagationDelayNs,
      slewNs: res.outputSlewNs,
      cell: res.cell
    };
  }
}

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CCSTimingModel };
}
if (typeof window !== 'undefined') {
  window.CCSTimingModel = CCSTimingModel;
}
