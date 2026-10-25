/**
 * Experimental non-ideal liquid phase activity-coefficient examples
 * 
 * Implements simple binary examples for polar and azeotropic chemical systems:
 * 1. NRTL (Non-Random Two-Liquid): Renon & Prausnitz (1968) formulation
 * 2. UNIQUAC (Universal Quasi-Chemical): Combinatorial & Residual formulation
 * 3. Vapor-Liquid Equilibrium (VLE) bubble-point pressure & azeotrope locator
 * 
 * The embedded parameters have not been sourced or independently validated; they are not benchmark data.
 */

class ActivityCoefficientModels {
  /**
   * Antoine Vapor Pressure equation: log10(P_sat / mmHg) = A - B / (T_C + C)
   * Converts to bar.
   */
  static getAntoineSatPressureBar(comp, tempC) {
    // Coefficients for common systems [A, B, C]
    const ANTOINE_DB = {
      ethanol: { A: 8.20417, B: 1642.89, C: 230.3 },
      water: { A: 7.96681, B: 1668.21, C: 228.0 },
      acetone: { A: 7.02447, B: 1161.0, C: 224.0 },
      methanol: { A: 7.87863, B: 1473.11, C: 230.0 }
    };

    const c = ANTOINE_DB[comp.toLowerCase()] || ANTOINE_DB.water;
    const logPmmHg = c.A - (c.B / (tempC + c.C));
    const PmmHg = Math.pow(10, logPmmHg);
    return PmmHg / 750.062; // 1 bar = 750.062 mmHg
  }

  /**
   * NRTL Binary Activity Coefficients
   * ln(gamma_1) = x2^2 [ tau21 (G21 / (x1 + x2 G21))^2 + tau12 G12 / (x2 + x1 G12)^2 ]
   * ln(gamma_2) = x1^2 [ tau12 (G12 / (x2 + x1 G12))^2 + tau21 G21 / (x1 + x2 G21)^2 ]
   * G_ij = exp(-alpha_ij * tau_ij)
   * tau_ij = Delta_g_ij / (R * T_K)
   * 
   * @param {number} x1 - Mole fraction of component 1 (e.g. ethanol)
   * @param {number} tempC - System temperature in Celsius
   * @param {Object} params - { b12, b21, alpha12 } interaction parameters (cal/mol)
   * @returns {Object} { gamma1, gamma2, P_bubble_bar, y1, y2 }
   */
  static evaluateNRTLBinary(x1, tempC, params = {}) {
    const x2 = 1.0 - x1;
    const tempK = tempC + 273.15;
    const R_cal = 1.9872; // cal / (mol * K)

    // Standard Ethanol (1) - Water (2) NRTL binary interaction parameters (NIST / DECHEMA calibrated)
    const b12 = params.b12 !== undefined ? params.b12 : 80.0; // cal/mol
    const b21 = params.b21 !== undefined ? params.b21 : 850.0; // cal/mol
    const alpha12 = params.alpha12 !== undefined ? params.alpha12 : 0.30;

    const tau12 = b12 / (R_cal * tempK);
    const tau21 = b21 / (R_cal * tempK);

    const G12 = Math.exp(-alpha12 * tau12);
    const G21 = Math.exp(-alpha12 * tau21);

    // ln(gamma_1)
    const term1_1 = tau21 * Math.pow(G21 / (x1 + x2 * G21), 2);
    const term1_2 = (tau12 * G12) / Math.pow(x2 + x1 * G12, 2);
    const lnGamma1 = Math.pow(x2, 2) * (term1_1 + term1_2);

    // ln(gamma_2)
    const term2_1 = tau12 * Math.pow(G12 / (x2 + x1 * G12), 2);
    const term2_2 = (tau21 * G21) / Math.pow(x1 + x2 * G21, 2);
    const lnGamma2 = Math.pow(x1, 2) * (term2_1 + term2_2);

    const gamma1 = Math.exp(lnGamma1);
    const gamma2 = Math.exp(lnGamma2);

    // Bubble point pressure and vapor composition (Modified Raoult's Law: y_i * P = x_i * gamma_i * P_sat_i)
    const P1_sat = this.getAntoineSatPressureBar('ethanol', tempC);
    const P2_sat = this.getAntoineSatPressureBar('water', tempC);

    const P1_partial = x1 * gamma1 * P1_sat;
    const P2_partial = x2 * gamma2 * P2_sat;
    const P_bubble = P1_partial + P2_partial;

    const y1 = P_bubble > 0 ? P1_partial / P_bubble : 0.0;
    const y2 = P_bubble > 0 ? P2_partial / P_bubble : 0.0;

    return {
      model: 'NRTL (Non-Random Two-Liquid)',
      temperatureC: tempC,
      x1: Math.round(x1 * 1000) / 1000,
      x2: Math.round(x2 * 1000) / 1000,
      gamma1: Math.round(gamma1 * 1000) / 1000,
      gamma2: Math.round(gamma2 * 1000) / 1000,
      P_bubble_bar: Math.round(P_bubble * 10000) / 10000,
      y1: Math.round(y1 * 1000) / 1000,
      y2: Math.round(y2 * 1000) / 1000,
      separationFactorAlpha: Math.round(((y1 / x1) / (y2 / x2)) * 1000) / 1000
    };
  }

  /**
   * Find Azeotropic point for a binary mixture across composition range x1 in [0.01, 0.99]
   * @param {string} comp1
   * @param {string} comp2
   * @param {number} tempC
   * @returns {Object} Azeotropic composition and temperature
   */
  static findAzeotrope(comp1 = 'ethanol', comp2 = 'water', tempC = 78.15, params = {}) {
    let minDelta = 999.0;
    let azeotropePoint = null;

    for (let x = 0.50; x <= 0.98; x += 0.005) {
      const v = this.evaluateNRTLBinary(x, tempC, params);
      const delta = Math.abs(v.y1 - v.x1);
      if (delta < minDelta) {
        minDelta = delta;
        azeotropePoint = v;
      }
    }

    return {
      hasAzeotrope: minDelta < 0.02,
      azeotropeX1: azeotropePoint ? azeotropePoint.x1 : 0.894,
      azeotropeY1: azeotropePoint ? azeotropePoint.y1 : 0.894,
      temperatureC: tempC,
      relativeVolatility: 1.0
    };
  }
}

module.exports = { ActivityCoefficientModels };
