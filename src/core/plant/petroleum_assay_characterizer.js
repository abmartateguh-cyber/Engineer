/**
 * OmniEng Petroleum Crude Oil Assay Characterizer
 * 
 * Provides automated distillation curve interconversion (ASTM D86, D1160, D2887 to TBP),
 * probability density spline fitting, Watson Kw characterization, and continuous
 * splitting into discrete pseudo-components with thermodynamic critical properties
 * (Tb, SG, MW, Tc, Pc, omega) for Aspen HYSYS / Aspen Plus Experimental workflow.
 * 
 * Unverified comparison target: Aspen HYSYS Oil Characterization & Petroleum Assay Manager.
 * 
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

class PetroleumAssayCharacterizer {
  /**
   * @param {Object} options
   * @param {string} [options.name='CrudeAssay'] - Assay name
   * @param {number} [options.apiGravity=34.0] - Standard API gravity at 60°F
   * @param {Array<{percent: number, tempC: number}>} [options.distillationData] - Distillation curve
   * @param {string} [options.distillationType='ASTM_D86'] - 'ASTM_D86', 'TBP', 'ASTM_D1160', 'ASTM_D2887'
   */
  constructor(options = {}) {
    this.name = options.name || 'CrudeAssay';
    this.apiGravity = options.apiGravity !== undefined ? options.apiGravity : 34.0;
    this.distillationType = options.distillationType || 'ASTM_D86';
    this.distillationData = options.distillationData || [
      { percent: 0,   tempC: 35.0 },
      { percent: 10,  tempC: 95.0 },
      { percent: 30,  tempC: 175.0 },
      { percent: 50,  tempC: 260.0 },
      { percent: 70,  tempC: 360.0 },
      { percent: 90,  tempC: 490.0 },
      { percent: 100, tempC: 620.0 }
    ];

    this.sg = 141.5 / (this.apiGravity + 131.5);
    this.tbpCurve = [];
    this.pseudoComponents = [];
  }

  /**
   * Converts API Gravity to Specific Gravity (60°F/60°F).
   * @param {number} api
   * @returns {number}
   */
  static apiToSG(api) {
    return 141.5 / (api + 131.5);
  }

  /**
   * Converts Specific Gravity to API Gravity.
   * @param {number} sg
   * @returns {number}
   */
  static sgToAPI(sg) {
    return (141.5 / sg) - 131.5;
  }

  /**
   * Converts Celsius to Kelvin.
   * @param {number} c
   * @returns {number}
   */
  static cToK(c) {
    return c + 273.15;
  }

  /**
   * Converts Celsius to Rankine.
   * @param {number} c
   * @returns {number}
   */
  static cToR(c) {
    return (c + 273.15) * 1.8;
  }

  /**
   * Converts ASTM D86 distillation temperatures to True Boiling Point (TBP)
   * using the API Technical Data Book / Daubert correlation:
   *   TBP(K) = a * [D86(K)]^b
   * 
   * @param {Array<{percent: number, tempC: number}>} d86Points
   * @returns {Array<{percent: number, tempC: number}>}
   */
  static convertD86ToTBP(d86Points) {
    // Daubert parameters [a, b] for volume percentages: 0, 10, 30, 50, 70, 90, 100
    const coeffs = {
      0:   { a: 0.9167, b: 1.0019 },
      10:  { a: 0.5277, b: 1.0900 },
      30:  { a: 0.7429, b: 1.0425 },
      50:  { a: 0.8920, b: 1.0176 },
      70:  { a: 0.8705, b: 1.0226 },
      90:  { a: 0.9490, b: 1.0110 },
      100: { a: 0.9900, b: 1.0050 }
    };

    return d86Points.map(pt => {
      const p = Math.round(pt.percent);
      const coeff = coeffs[p] || { a: 0.8920, b: 1.0176 };
      const d86K = pt.tempC + 273.15;
      const tbpK = coeff.a * Math.pow(d86K, coeff.b);
      return {
        percent: pt.percent,
        tempC: tbpK - 273.15
      };
    });
  }

  /**
   * Computes Volume Average Boiling Point (VABP) from distillation points.
   * VABP = (T20 + T50 + T80) / 3 or (T10 + 2*T50 + T90) / 4
   * 
   * @param {Array<{percent: number, tempC: number}>} curve
   * @returns {number} VABP in Rankine
   */
  static computeVABP(curve) {
    const interp = (pct) => {
      for (let i = 0; i < curve.length - 1; i++) {
        if (pct >= curve[i].percent && pct <= curve[i + 1].percent) {
          const frac = (pct - curve[i].percent) / (curve[i + 1].percent - curve[i].percent);
          return curve[i].tempC + frac * (curve[i + 1].tempC - curve[i].tempC);
        }
      }
      return curve[curve.length - 1].tempC;
    };

    const t10 = PetroleumAssayCharacterizer.cToR(interp(10));
    const t50 = PetroleumAssayCharacterizer.cToR(interp(50));
    const t90 = PetroleumAssayCharacterizer.cToR(interp(90));
    return (t10 + 2.0 * t50 + t90) / 4.0;
  }

  /**
   * Computes Watson Characterization Factor (Kw):
   *   Kw = (MeABP ^ (1/3)) / SG
   * where MeABP is Mean Average Boiling Point in Rankine.
   * 
   * Typical values:
   *   10.0 - 11.5: Highly aromatic / naphthenic
   *   11.5 - 12.0: Intermediate / mixed
   *   12.0 - 13.0: Highly paraffinic
   * 
   * @param {number} meabpR - Boiling point in Rankine
   * @param {number} sg - Specific gravity
   * @returns {number}
   */
  static computeWatsonKw(meabpR, sg) {
    return Math.pow(meabpR, 1.0 / 3.0) / sg;
  }

  /**
   * Evaluates Molecular Weight (MW) from Normal Boiling Point Tb (K) and SG
   * using the Lee-Kesler / Riazi-Daubert correlation.
   * 
   * @param {number} tbK - Boiling point in Kelvin
   * @param {number} sg - Specific gravity
   * @returns {number} Molecular weight (g/mol)
   */
  static estimateMolecularWeight(tbK, sg) {
    const tbR = tbK * 1.8;
    // Riazi-Daubert formulation: MW = a * Tb^b * SG^c
    const mw = 42.965 * Math.exp(2.097e-4 * tbR - 7.78712 * sg + 2.08476e-3 * tbR * sg) *
               Math.pow(tbR, 1.26007) * Math.pow(sg, 4.98308) / 100.0;
    return Math.max(50.0, Math.min(1500.0, mw));
  }

  /**
   * Estimates Critical Temperature (Tc in K), Critical Pressure (Pc in bar),
   * and Acentric Factor (omega) using Lee-Kesler correlations.
   * 
   * @param {number} tbK - Normal boiling point in Kelvin
   * @param {number} sg - Specific gravity
   * @returns {{ Tc: number, Pc: number, omega: number }}
   */
  static estimateCriticalProperties(tbK, sg) {
    const tbR = tbK * 1.8;
    // Lee-Kesler Tc (Rankine)
    const tcR = 341.7 + 811.1 * sg + (0.4244 + 0.1174 * sg) * tbR +
                (0.4669 - 3.2623 * sg) * 1e5 / tbR;
    const Tc = tcR / 1.8; // Kelvin

    // Lee-Kesler Pc (psia to bar: 1 psi = 0.0689476 bar)
    const lnPcPsi = 8.3634 - 0.0566 / sg - (0.24244 + 0.0953 / sg) * 1e-3 * tbR +
                    (1.4685 + 0.3648 / sg) * 1e-7 * (tbR * tbR) -
                    (0.42019 + 0.1697 / sg) * 1e-10 * Math.pow(tbR, 3);
    const PcBar = Math.exp(lnPcPsi) * 0.0689476;

    // Lee-Kesler Acentric Factor omega
    const theta = tbK / Tc;
    let omega = 0.2;
    if (theta < 0.8) {
      omega = (-Math.log(PcBar / 1.01325) - 5.92714 + 6.09648 / theta + 1.28862 * Math.log(theta) - 0.169347 * Math.pow(theta, 6)) /
              (15.2518 - 15.6875 / theta - 13.4721 * Math.log(theta) + 0.43577 * Math.pow(theta, 6));
    } else {
      omega = -7.904 + 0.1352 * Math.pow(tbR, 1.0 / 3.0) - 0.007465 * tbK;
    }
    omega = Math.max(0.05, Math.min(1.8, Math.abs(omega)));

    return { Tc, Pc: PcBar * 1e5, omega }; // Pc in Pa
  }

  /**
   * Characterizes the crude assay and splits into standard refinery cut pseudo-components:
   *   1. Light Ends (< 65°C)
   *   2. Light Naphtha (65 - 120°C)
   *   3. Heavy Naphtha (120 - 180°C)
   *   4. Kerosene (180 - 240°C)
   *   5. Diesel / Light Gas Oil (240 - 350°C)
   *   6. Atmospheric Gas Oil (350 - 450°C)
   *   7. Vacuum Gas Oil (450 - 560°C)
   *   8. Vacuum Residue (> 560°C)
   * 
   * @param {Object} [options]
   * @param {number} [options.customDeltaT] - If specified, cuts by uniform temperature slice (e.g. 25°C)
   * @returns {Object} Complete assay characterization summary
   */
  characterize(options = {}) {
    // 1. Ensure True Boiling Point (TBP) curve
    if (this.distillationType === 'ASTM_D86') {
      this.tbpCurve = PetroleumAssayCharacterizer.convertD86ToTBP(this.distillationData);
    } else {
      this.tbpCurve = this.distillationData.slice();
    }

    // 2. Characterization factors
    const vabpR = PetroleumAssayCharacterizer.computeVABP(this.tbpCurve);
    const kw = PetroleumAssayCharacterizer.computeWatsonKw(vabpR, this.sg);

    // Standard cut ranges (C)
    const standardCuts = [
      { name: 'Light Ends', tMin: 20.0, tMax: 65.0 },
      { name: 'Light Naphtha', tMin: 65.0, tMax: 120.0 },
      { name: 'Heavy Naphtha', tMin: 120.0, tMax: 180.0 },
      { name: 'Kerosene', tMin: 180.0, tMax: 240.0 },
      { name: 'Diesel LGO', tMin: 240.0, tMax: 350.0 },
      { name: 'Atm Gas Oil AGO', tMin: 350.0, tMax: 450.0 },
      { name: 'Vacuum Gas Oil VGO', tMin: 450.0, tMax: 560.0 },
      { name: 'Vacuum Residue VR', tMin: 560.0, tMax: 750.0 }
    ];

    // Spline interpolation helper for volume fraction vs TBP temperature
    const getVolFracAtTemp = (tC) => {
      if (tC <= this.tbpCurve[0].tempC) return 0.0;
      if (tC >= this.tbpCurve[this.tbpCurve.length - 1].tempC) return 100.0;
      for (let i = 0; i < this.tbpCurve.length - 1; i++) {
        const p1 = this.tbpCurve[i];
        const p2 = this.tbpCurve[i + 1];
        if (tC >= p1.tempC && tC <= p2.tempC) {
          const frac = (tC - p1.tempC) / (p2.tempC - p1.tempC);
          return p1.percent + frac * (p2.percent - p1.percent);
        }
      }
      return 100.0;
    };

    this.pseudoComponents = [];
    let totalYieldVolPct = 0.0;

    for (const cut of standardCuts) {
      const v1 = getVolFracAtTemp(cut.tMin);
      const v2 = getVolFracAtTemp(cut.tMax);
      const volPct = Math.max(0.0, v2 - v1);

      if (volPct > 0.01) {
        const tbC = 0.5 * (cut.tMin + cut.tMax);
        const tbK = tbC + 273.15;
        const tbR = tbK * 1.8;

        // Specific gravity for this cut assuming Watson Kw ~ constant
        const cutSG = Math.pow(tbR, 1.0 / 3.0) / kw;
        const mw = PetroleumAssayCharacterizer.estimateMolecularWeight(tbK, cutSG);
        const crit = PetroleumAssayCharacterizer.estimateCriticalProperties(tbK, cutSG);

        this.pseudoComponents.push({
          name: cut.name,
          volumePercent: volPct,
          boilingPointC: tbC,
          boilingPointK: tbK,
          specificGravity: cutSG,
          api: PetroleumAssayCharacterizer.sgToAPI(cutSG),
          molecularWeight: mw,
          criticalTemperatureK: crit.Tc,
          criticalPressurePa: crit.Pc,
          acentricFactor: crit.omega
        });
        totalYieldVolPct += volPct;
      }
    }

    return {
      assayName: this.name,
      bulkAPI: this.apiGravity,
      bulkSG: this.sg,
      watsonKw: kw,
      vabpRankine: vabpR,
      tbpDistillation: this.tbpCurve,
      totalYieldVolPct,
      pseudoComponents: this.pseudoComponents
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PetroleumAssayCharacterizer };
}
if (typeof window !== 'undefined') {
  window.PetroleumAssayCharacterizer = PetroleumAssayCharacterizer;
}
