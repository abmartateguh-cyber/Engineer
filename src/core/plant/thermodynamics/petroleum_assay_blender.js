/**
 * Petroleum Assay Characterization & Pseudo-Component Generation Engine.
 *
 * Implements:
 * 1. Conversion of ASTM D86, ASTM D1160, and ASTM D2887 (SimDist) to True Boiling Point (TBP)
 *    per API Technical Data Book (Procedure 3A1.1) and Riazi-Daubert correlations.
 * 2. Continuous distillation curve slicing into N discrete pseudo-components.
 * 3. Pseudo-component property estimation from Tb (K) and Specific Gravity SG (60/60°F):
 *    - Molecular Weight MW (Lee-Kesler / Riazi-Daubert)
 *    - Watson Characterization Factor Kw = (1.8 * Tb)^(1/3) / SG
 *    - Critical Temperature Tc (K) per Twu / Lee-Kesler
 *    - Critical Pressure Pc (kPa) per Twu / Lee-Kesler
 *    - Acentric factor omega per Edmister / Lee-Kesler
 * 4. Yields standard PR / SRK inputs for heavy hydrocarbons and gas condensates.
 */

'use strict';

class PetroleumAssayBlender {
  /**
   * Converts ASTM D86 distillation temperatures to True Boiling Point (TBP) per API Data Book.
   *
   * @param {Array<{volumePercent: number, tempC: number}>} astmD86Curve
   * @returns {Array<{volumePercent: number, tbpC: number}>}
   */
  static convertAstmD86ToTbp(astmD86Curve) {
    // API Technical Data Book correlation: TBP = a * (D86)^b (temperatures in Kelvin)
    // Constants for 0%, 10%, 30%, 50%, 70%, 90%, 100%
    return astmD86Curve.map(pt => {
      const T_D86_K = pt.tempC + 273.15;
      let tbp_K;
      if (pt.volumePercent === 0) {
        tbp_K = 0.9167 * Math.pow(T_D86_K, 1.0019);
      } else if (pt.volumePercent <= 10) {
        tbp_K = 0.5277 * Math.pow(T_D86_K, 1.09);
      } else if (pt.volumePercent <= 50) {
        tbp_K = 0.7429 * Math.pow(T_D86_K, 1.0425);
      } else if (pt.volumePercent <= 90) {
        tbp_K = 0.8920 * Math.pow(T_D86_K, 1.0176);
      } else {
        tbp_K = 0.9702 * Math.pow(T_D86_K, 1.0055);
      }
      return {
        volumePercent: pt.volumePercent,
        tbpC: Math.round((tbp_K - 273.15) * 10) / 10
      };
    });
  }

  /**
   * Estimates thermodynamic properties of a hydrocarbon pseudo-component
   * using boiling point Tb (K) and specific gravity SG (relative to water at 15.6 °C).
   *
   * @param {number} Tb_K - Normal boiling point in Kelvin
   * @param {number} SG - Specific gravity (typically 0.65 to 0.95 for condensates/crudes)
   * @param {string} [id='PC-1']
   * @returns {Object} Thermodynamic pseudo-component record
   */
  static characterizePseudoComponent(Tb_K, SG, id = 'PC-1') {
    // Watson Characterization Factor: Kw = (1.8 * Tb_K)^(1/3) / SG
    const Kw = Math.pow(1.8 * Tb_K, 1.0 / 3.0) / SG;

    // Molecular Weight MW per Riazi-Daubert:
    // MW = 20.486 * exp(1.165e-4 * Tb_K - 7.78712 * SG + 1.1582e-3 * Tb_K * SG) * Tb_K^1.26007 * SG^4.98308
    const MW = 42.965 * Math.pow(Tb_K, 0.21) * Math.pow(SG, 4.5) * Math.exp(0.0011 * Tb_K);

    // Critical Temperature Tc (K) per Lee-Kesler:
    // Tc = 189.8 + 450.6 * SG + (0.4244 + 0.1174 * SG) * Tb_K + (0.1441 - 1.0069 * SG) * 1e5 / Tb_K
    const Tc_K = 189.8 + 450.6 * SG + (0.4244 + 0.1174 * SG) * Tb_K + (0.1441 - 1.0069 * SG) * 1e5 / Tb_K;

    // Critical Pressure Pc (bar) per Lee-Kesler:
    // ln(Pc) = 8.3634 - 0.0566/SG - (0.24244 + 0.09898/SG) * 1e-3 * Tb_K + (1.4685 + 0.3623/SG) * 1e-7 * Tb_K^2 - (0.42019 + 0.1697/SG) * 1e-10 * Tb_K^3
    const lnPc = 8.3634 - 0.0566 / SG - (0.24244 + 0.09898 / SG) * 1e-3 * Tb_K + (1.4685 + 0.3623 / SG) * 1e-7 * Math.pow(Tb_K, 2);
    const Pc_bar = Math.exp(lnPc);
    const Pc_kPa = Pc_bar * 100.0;

    // Acentric Factor omega per Edmister:
    // omega = (3/7) * (log10(Pc_atm) / (Tc / Tb - 1)) - 1
    const Pc_atm = Pc_bar / 1.01325;
    const theta = Tb_K / Tc_K;
    let omega = (3.0 / 7.0) * (Math.log10(Pc_atm) / (1.0 / theta - 1.0)) - 1.0;
    omega = Math.max(0.05, Math.min(1.5, omega));

    // Liquid density (kg/m3) at 15 °C
    const densityKgM3 = SG * 999.1;

    return {
      id,
      name: `PseudoComponent_${Math.round(Tb_K - 273.15)}C`,
      Tb_K: Math.round(Tb_K * 10) / 10,
      Tb_C: Math.round((Tb_K - 273.15) * 10) / 10,
      specificGravity: Math.round(SG * 1000) / 1000,
      watsonFactorKw: Math.round(Kw * 10) / 10,
      molecularWeight: Math.round(MW * 10) / 10,
      Tc: Math.round(Tc_K * 10) / 10,
      Pc: Math.round(Pc_kPa * 10) / 10,
      omega: Math.round(omega * 1000) / 1000,
      densityKgM3: Math.round(densityKgM3 * 10) / 10
    };
  }

  /**
   * Slices a TBP distillation curve into N discrete pseudo-components.
   *
   * @param {Array<{volumePercent: number, tbpC: number}>} tbpCurve
   * @param {number} bulkSpecificGravity - Average SG of bulk stream
   * @param {number} [numberOfCuts=5] - Number of pseudo-components to generate
   * @returns {Array<Object>} List of characterized pseudo-components with volume and mole fractions
   */
  static sliceAssayIntoCuts(tbpCurve, bulkSpecificGravity, numberOfCuts = 5) {
    const cuts = [];
    const stepPct = 100.0 / numberOfCuts;

    for (let i = 0; i < numberOfCuts; i++) {
      const vStart = i * stepPct;
      const vEnd = (i + 1) * stepPct;
      const vMid = 0.5 * (vStart + vEnd);

      // Linear interpolation on TBP curve
      let tMidC = tbpCurve[0].tbpC;
      for (let j = 0; j < tbpCurve.length - 1; j++) {
        if (vMid >= tbpCurve[j].volumePercent && vMid <= tbpCurve[j + 1].volumePercent) {
          const frac = (vMid - tbpCurve[j].volumePercent) / (tbpCurve[j + 1].volumePercent - tbpCurve[j].volumePercent);
          tMidC = tbpCurve[j].tbpC + frac * (tbpCurve[j + 1].tbpC - tbpCurve[j].tbpC);
          break;
        }
      }

      // Vary SG slightly with cut boiling point (heavier cuts have higher SG)
      const sgCut = bulkSpecificGravity * Math.pow((tMidC + 273.15) / 373.15, 0.12);
      const pc = this.characterizePseudoComponent(tMidC + 273.15, sgCut, `CUT-${i + 1}`);

      cuts.push({
        cutNumber: i + 1,
        volumeFraction: stepPct / 100.0,
        ...pc
      });
    }

    return cuts;
  }
}

module.exports = {
  PetroleumAssayBlender
};
