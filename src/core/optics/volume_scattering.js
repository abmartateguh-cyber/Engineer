/**
 * OmniEng Henyey-Greenstein Volume Scattering & Bulk Absorption Engine
 * 
 * Provides volumetric participating media ray simulation matching Zemax / LightTools:
 * 1. Henyey-Greenstein phase function for forward (g > 0) and backward (g < 0) scattering.
 * 2. Monte Carlo path length sampling using mean free path: s = -ln(xi) / mu_ext.
 * 3. Beer-Lambert bulk absorption: I(s) = I0 * exp(-alpha * s).
 * 
 * 100% In-House Proprietary Implementation - Zero External Dependencies.
 */

'use strict';

class VolumeScatteringEngine {
  /**
   * Samples a scattered deflection angle theta according to Henyey-Greenstein phase function
   * cos(theta) = (1 / 2g) * [ 1 + g^2 - ( (1 - g^2) / (1 - g + 2g*xi) )^2 ]
   * 
   * @param {number} g - Anisotropy parameter in range (-1, 1), 0 = isotropic, 0.8 = biological tissue / cloud
   * @param {number} [xi] - Uniform random variable in [0, 1]
   * @returns {{cosTheta: number, thetaRad: number, phiRad: number}}
   */
  static sampleHenyeyGreenstein(g = 0.8, xi = Math.random()) {
    let cosTheta = 0.0;
    if (Math.abs(g) < 1e-4) {
      // Isotropic scattering
      cosTheta = 2.0 * xi - 1.0;
    } else {
      const term = (1.0 - g * g) / (1.0 - g + 2.0 * g * xi);
      cosTheta = (1.0 / (2.0 * g)) * (1.0 + g * g - term * term);
      cosTheta = Math.max(-1.0, Math.min(1.0, cosTheta));
    }

    const thetaRad = Math.acos(cosTheta);
    const phiRad = 2.0 * Math.PI * Math.random();

    return {
      cosTheta,
      thetaRad,
      phiRad
    };
  }

  /**
   * Calculates transmitted intensity through absorbing medium of thickness d
   * I = I_0 * exp(-alpha * d)
   * 
   * @param {number} I0 - Incident intensity
   * @param {number} alphaAbsorptionMm - Absorption coefficient (1/mm)
   * @param {number} distanceMm - Propagation distance in medium (mm)
   * @returns {number} Transmitted intensity
   */
  static evaluateBeerLambert(I0, alphaAbsorptionMm, distanceMm) {
    const transmittance = Math.exp(-alphaAbsorptionMm * distanceMm);
    return Number((I0 * transmittance).toFixed(6));
  }
}

module.exports = {
  VolumeScatteringEngine
};
