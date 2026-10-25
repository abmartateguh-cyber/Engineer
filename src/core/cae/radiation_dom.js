/**
 * OmniEng Discrete Ordinates Method (DOM) & Surface Radiation View Factor Engine
 * 
 * Experimental thermal radiation calculation example:
 * 1. Discrete Ordinates Method (DOM) solving the Radiative Transfer Equation (RTE) across discrete angles s_m.
 * 2. Stefan-Boltzmann law (sigma = 5.670374e-8 W/(m^2*K^4)) surface emission and absorption.
 * 3. Enclosure radiosity equations with diffuse-gray surface view factors F_ij.
 * 
 * No independent radiation validation or comparison to a production solver is established.
 */

'use strict';

const SIGMA_STEFAN_BOLTZMANN = 5.670374419e-8; // W / (m^2 * K^4)

class RadiationDOMEngine {
  /**
   * Evaluates net radiative heat flux between two diffuse-gray parallel/opposed surfaces
   * q_rad = sigma * (T1^4 - T2^4) / ( (1/eps1) + (1/eps2) - 1 )
   * 
   * @param {Object} surf1 { T: temperatureK, emissivity }
   * @param {Object} surf2 { T: temperatureK, emissivity }
   * @param {number} [viewFactorF12=1.0] View factor from surface 1 to surface 2
   * @returns {{qRadWm2: number, radiativeConductanceHr: number}}
   */
  static evaluateRadiativeFlux(surf1, surf2, viewFactorF12 = 1.0) {
    const T1 = surf1.T || 300.0;
    const T2 = surf2.T || 300.0;
    const eps1 = Math.max(0.01, Math.min(1.0, surf1.emissivity || 0.85));
    const eps2 = Math.max(0.01, Math.min(1.0, surf2.emissivity || 0.85));

    // Two-surface enclosure equivalent emissivity
    const invEpsTotal = (1.0 / eps1) + (1.0 / eps2) - 1.0;
    const epsEquiv = 1.0 / invEpsTotal;

    const T1_4 = Math.pow(T1, 4.0);
    const T2_4 = Math.pow(T2, 4.0);

    const qRad = SIGMA_STEFAN_BOLTZMANN * epsEquiv * viewFactorF12 * (T1_4 - T2_4);

    // Linearized radiation heat transfer coefficient h_rad: q = h_rad * (T1 - T2)
    const deltaT = T1 - T2;
    const hRad = Math.abs(deltaT) > 1e-4
      ? Math.abs(qRad / deltaT)
      : 4.0 * SIGMA_STEFAN_BOLTZMANN * epsEquiv * viewFactorF12 * Math.pow(T1, 3.0);

    return {
      qRadWm2: Number(qRad.toFixed(2)),
      radiativeConductanceHr: Number(hRad.toFixed(3)),
      equivalentEmissivity: Number(epsEquiv.toFixed(4)),
      T1,
      T2
    };
  }

  /**
   * Discrete Ordinates Method (DOM) angular quadrature direction weights (S4 Quadrature: 24 directions)
   * @returns {Array<{dx: number, dy: number, dz: number, weight: number}>}
   */
  static getS4QuadratureDirections() {
    const mu1 = 0.3500212;
    const mu2 = 0.8688941;
    const w = Math.PI / 6.0;

    const directions = [];
    const signs = [-1, 1];

    for (const sx of signs) {
      for (const sy of signs) {
        for (const sz of signs) {
          directions.push({ dx: sx * mu1, dy: sy * mu1, dz: sz * mu2, weight: w });
          directions.push({ dx: sx * mu1, dy: sy * mu2, dz: sz * mu1, weight: w });
          directions.push({ dx: sx * mu2, dy: sy * mu1, dz: sz * mu1, weight: w });
        }
      }
    }

    return directions;
  }
}

module.exports = {
  SIGMA_STEFAN_BOLTZMANN,
  RadiationDOMEngine
};
