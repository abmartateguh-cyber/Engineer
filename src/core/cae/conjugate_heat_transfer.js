/**
 * Experimental one-step fluid-solid interface heat-flux arithmetic.
 * This helper does not assemble a conjugate heat-transfer solver or enforce
 * interface continuity on a mesh.
 * 
 * No independent CHT validation or comparison to a production solver is established.
 */

'use strict';

class ConjugateHeatTransferEngine {
  /**
   * Computes an interface heat-flux estimate from caller-supplied cell properties
   * @param {Object} fluidCell - Fluid domain cell { T, k, centroid }
   * @param {Object} solidCell - Solid domain cell { T, k, centroid }
   * @param {Object} face - Interface face { area, normal }
   * @returns {{interfaceTemp: number, heatFluxW_m2: number, totalHeatPowerW: number}}
   */
  static evaluateInterfaceHeatFlux(fluidCell, solidCell, face) {
    this.validateCell(fluidCell, 'fluid');
    this.validateCell(solidCell, 'solid');
    if (!face || !Number.isFinite(face.area) || face.area <= 0) {
      throw new TypeError('Provide a positive finite interface face area in square metres.');
    }
    const k_f = fluidCell.k;
    const k_s = solidCell.k;

    // Normal distance from fluid centroid to interface, and solid centroid to interface
    const d_f = fluidCell.wallDistance;
    const d_s = solidCell.wallDistance;

    // Harmonic interface thermal conductance: 1 / U_int = (d_f / k_f) + (d_s / k_s)
    const thermalResistance = (d_f / k_f) + (d_s / k_s);
    const U_interface = 1.0 / thermalResistance;

    // Interface heat flux q = U * (T_solid - T_fluid) (W/m^2)
    const deltaT = solidCell.T - fluidCell.T;
    const qFlux = U_interface * deltaT;

    // Interface temperature: T_int = ( (k_f / d_f) * T_f + (k_s / d_s) * T_s ) / (k_f/d_f + k_s/d_s)
    const h_f = k_f / d_f;
    const h_s = k_s / d_s;
    const T_interface = (h_f * fluidCell.T + h_s * solidCell.T) / (h_f + h_s);

    const totalPower = qFlux * face.area;

    return {
      interfaceTempK: Number(T_interface.toFixed(2)),
      heatFluxWm2: Number(qFlux.toFixed(2)),
      totalHeatPowerW: Number(totalPower.toFixed(4)),
      solidCellTempK: solidCell.T,
      fluidCellTempK: fluidCell.T
    };
  }

  static validateCell(cell, label) {
    const required = ['T', 'k', 'wallDistance'];
    if (!cell || typeof cell !== 'object' || !required.every((field) => Number.isFinite(cell[field]))) {
      throw new TypeError(`Provide explicit ${label} cell temperature, conductivity, and wall distance.`);
    }
    if (cell.T <= 0 || cell.k <= 0 || cell.wallDistance <= 0) {
      throw new RangeError(`${label} cell temperature, conductivity, and wall distance must be positive.`);
    }
    return cell;
  }

  /**
   * Applies one explicit energy update to caller-supplied solid and fluid cells
   * @param {Array<Object>} interfacePairs Array of { fluidCell, solidCell, face }; cells must also include rho, Cp and volume.
   * @param {number} dt Time step in seconds
   */
  static solveCoupledEnergyStep(interfacePairs, dt) {
    if (!Array.isArray(interfacePairs) || !Number.isFinite(dt) || dt <= 0) {
      throw new TypeError('Provide interface pairs and a positive finite time step in seconds.');
    }
    let totalHeatTransfer = 0.0;

    for (const pair of interfacePairs) {
      const res = this.evaluateInterfaceHeatFlux(pair.fluidCell, pair.solidCell, pair.face);
      totalHeatTransfer += Math.abs(res.totalHeatPowerW);

      // Energy balance update: dT/dt = Q / (rho * Cp * V)
      this.validateEnergyCell(pair.fluidCell, 'fluid');
      this.validateEnergyCell(pair.solidCell, 'solid');
      const capF = pair.fluidCell.rho * pair.fluidCell.Cp * pair.fluidCell.volume;
      const capS = pair.solidCell.rho * pair.solidCell.Cp * pair.solidCell.volume;

      pair.fluidCell.T += (res.totalHeatPowerW * dt) / capF;
      pair.solidCell.T -= (res.totalHeatPowerW * dt) / capS;
    }

    return {
      pairsCount: interfacePairs.length,
      totalHeatExchangeWatts: Number(totalHeatTransfer.toFixed(3)),
      stepCompleted: true,
      convergenceAssessed: false
    };
  }

  static validateEnergyCell(cell, label) {
    this.validateCell(cell, label);
    const required = ['rho', 'Cp', 'volume'];
    if (!required.every((field) => Number.isFinite(cell[field]) && cell[field] > 0)) {
      throw new TypeError(`Provide positive ${label} cell density, heat capacity, and volume.`);
    }
  }
}

module.exports = {
  ConjugateHeatTransferEngine
};
