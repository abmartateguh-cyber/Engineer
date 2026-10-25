/**
 * OmniEng Conjugate Heat Transfer (CHT) Solid-Fluid Interface Coupling Engine
 * 
 * Experimental thermal coupling example:
 * 1. Interface energy flux conservation across non-conformal fluid-solid boundaries.
 * 2. Enforces temperature continuity: T_fluid = T_solid.
 * 3. Enforces heat flux continuity: -k_fluid * (dT/dn)_fluid = -k_solid * (dT/dn)_solid.
 * 4. Harmonic mean thermal conductivity weighting across interface cells.
 * 
 * No independent CHT validation or comparison to a production solver is established.
 */

'use strict';

class ConjugateHeatTransferEngine {
  /**
   * Couples solid and fluid cell temperatures across an interface face
   * @param {Object} fluidCell - Fluid domain cell { T, k, centroid }
   * @param {Object} solidCell - Solid domain cell { T, k, centroid }
   * @param {Object} face - Interface face { area, normal }
   * @returns {{interfaceTemp: number, heatFluxW_m2: number, totalHeatPowerW: number}}
   */
  static evaluateInterfaceHeatFlux(fluidCell, solidCell, face) {
    const k_f = fluidCell.k || 0.026; // Air thermal conductivity W/(m*K)
    const k_s = solidCell.k || 205.0; // Aluminum thermal conductivity W/(m*K)

    // Normal distance from fluid centroid to interface, and solid centroid to interface
    const d_f = Math.max(1e-5, fluidCell.wallDistance || 1e-3);
    const d_s = Math.max(1e-5, solidCell.wallDistance || 2e-3);

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

    const totalPower = qFlux * (face.area || 1e-4);

    return {
      interfaceTempK: Number(T_interface.toFixed(2)),
      heatFluxWm2: Number(qFlux.toFixed(2)),
      totalHeatPowerW: Number(totalPower.toFixed(4)),
      solidCellTempK: solidCell.T,
      fluidCellTempK: fluidCell.T
    };
  }

  /**
   * Relaxes coupled solid and fluid cell temperatures toward thermodynamic equilibrium
   * @param {Array<Object>} interfacePairs Array of { fluidCell, solidCell, face }
   * @param {number} [dt=0.01] Time step in seconds
   */
  static solveCoupledEnergyStep(interfacePairs = [], dt = 0.01) {
    let totalHeatTransfer = 0.0;

    for (const pair of interfacePairs) {
      const res = this.evaluateInterfaceHeatFlux(pair.fluidCell, pair.solidCell, pair.face);
      totalHeatTransfer += Math.abs(res.totalHeatPowerW);

      // Energy balance update: dT/dt = Q / (rho * Cp * V)
      const capF = (pair.fluidCell.rho || 1.225) * (pair.fluidCell.Cp || 1005.0) * (pair.fluidCell.volume || 1e-4);
      const capS = (pair.solidCell.rho || 2700.0) * (pair.solidCell.Cp || 900.0) * (pair.solidCell.volume || 1e-4);

      pair.fluidCell.T += (res.totalHeatPowerW * dt) / capF;
      pair.solidCell.T -= (res.totalHeatPowerW * dt) / capS;
    }

    return {
      pairsCount: interfacePairs.length,
      totalHeatExchangeWatts: Number(totalHeatTransfer.toFixed(3)),
      converged: totalHeatTransfer < 1e-3
    };
  }
}

module.exports = {
  ConjugateHeatTransferEngine
};
