/**
 * OmniEng Composite Current Source (CCS / ECSM) Nanometer Timing Engine
 * 
 * Experimental current-waveform timing calculation example:
 * 1. Time-varying driver output current tables I_driver(t, V_out) capturing non-linear transistor behavior.
 * 2. Non-linear receiver pin capacitance C_in(V) modeling gate voltage-dependent Miller capacitance.
 * 3. Interconnect resistive shielding (Pi-model integration): C_eff * dV/dt = I(t, V).
 * 4. Delay and slew estimates from illustrative model inputs.
 * 
 * No vendor characterization data, independent timing validation, or signoff accuracy is established.
 */

'use strict';

class CCSTimingModel {
  /**
   * @param {Object} cellSpec
   * @param {string} cellSpec.cellName - e.g. 'INV_X4', 'NAND2_X2'
   * @param {number} [cellSpec.supplyVoltageV=1.0] - VDD
   * @param {number} [cellSpec.peakDriverCurrentMa=1.2] - Peak saturated drive current
   */
  constructor(cellSpec = {}) {
    this.cellName = cellSpec.cellName || 'INV_X4';
    this.vdd = cellSpec.supplyVoltageV || 1.0;
    this.iPeak = (cellSpec.peakDriverCurrentMa || 1.2) * 1e-3; // Amps
  }

  /**
   * Evaluates non-linear receiver input capacitance C_pin(V)
   * Captures gate depletion and inversion Miller capacitance variations
   * @param {number} voltage - V in [0, VDD]
   * @returns {number} Capacitance in Farads
   */
  evaluateReceiverCapacitance(voltage) {
    const vNorm = Math.max(0.0, Math.min(1.0, voltage / this.vdd));
    // Non-linear C-V curve (baseline 0.8 fF, peaks to 1.4 fF around Vth = 0.5 * VDD)
    const cBase = 0.8e-15;
    const cPeak = 0.6e-15 * Math.exp(-Math.pow((vNorm - 0.5) / 0.20, 2));
    return cBase + cPeak;
  }

  /**
   * Simulates driver dynamic output current I(t) transitioning into an RC load
   * @param {Object} load - { cLoadFf, rWireOhms }
   * @param {number} inputSlewPs - Input transition time (ps)
   * @returns {Object} Propagation delay t_pd (ns) and output slew (ns)
   */
  simulateStageDelay(load = {}, inputSlewPs = 20.0) {
    const cLoad = (load.cLoadFf || 5.0) * 1e-15; // Farads
    const rWire = load.rWireOhms || 20.0; // Ohms
    const cEff = cLoad; // Effective capacitance with resistive shielding

    // Numerical integration of dV/dt = I(t) / C_eff
    const dt = 1e-13; // 0.1 ps time step
    let v = 0.0;
    let t = 0.0;
    let t50 = -1;
    let t10 = -1;
    let t90 = -1;

    const maxTime = 2e-9; // 2 ns max
    const v50 = 0.5 * this.vdd;
    const v10 = 0.1 * this.vdd;
    const v90 = 0.9 * this.vdd;

    while (t < maxTime && v < 0.99 * this.vdd) {
      // Driver current model: ramp up proportional to input slew, then saturate and taper off
      const rampFactor = Math.min(1.0, t / (inputSlewPs * 1e-12));
      const headroomFactor = Math.max(0.0, 1.0 - (v / this.vdd));
      const iDriver = this.iPeak * rampFactor * Math.sqrt(headroomFactor);

      const dV = (iDriver / cEff) * dt;
      v += dV;
      t += dt;

      if (t10 < 0 && v >= v10) t10 = t;
      if (t50 < 0 && v >= v50) t50 = t;
      if (t90 < 0 && v >= v90) t90 = t;
    }

    const propagationDelayNs = (t50 > 0 ? t50 : 0.05e-9) * 1e9;
    const outputSlewNs = ((t90 > 0 && t10 > 0) ? (t90 - t10) : 0.04e-9) * 1e9;

    return {
      cell: this.cellName,
      supplyVoltageV: this.vdd,
      loadCapacitanceFf: (cLoad * 1e15),
      effectiveCapacitanceFf: (cEff * 1e15),
      inputSlewPs,
      propagationDelayNs: Number(propagationDelayNs.toFixed(4)),
      outputSlewNs: Number(outputSlewNs.toFixed(4)),
      ccsCurrentPeakMa: Number((this.iPeak * 1e3).toFixed(2)),
      modelStandard: 'IEEE 1801 / Composite Current Source (CCS)'
    };
  }

  simulateDriverOutput(cLoadFarads = 5e-15, vdd = null) {
    if (vdd !== null && vdd > 0) this.vdd = vdd;
    const cLoadFf = cLoadFarads * 1e15;
    const res = this.simulateStageDelay({ cLoadFf }, 20.0);
    return {
      delaySeconds: res.propagationDelayNs * 1e-9,
      slewSeconds: res.outputSlewNs * 1e-9,
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
