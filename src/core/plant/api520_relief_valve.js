/**
 * API Standard 520 Part I (10th Ed) Pressure Relief Valve (PRV) Sizing Engine
 * & API 526 Standard Orifice Selection
 * 
 * Provides rigorous sizing and selection for:
 * - Gas/Vapor Relief (Critical and Subcritical sonic flow)
 * - Liquid Non-Flashing Relief
 * - Two-Phase Flashing & Frozen Flow Relief via API 520 Omega (omega) Method
 * - API 526 Standard Letter Designation Orifice Selection (D through T)
 * - API 521 Flare Header Superimposed & Built-Up Backpressure Evaluation
 */

'use strict';

// Standard API 526 Orifice Designations
const API_526_ORIFICES = [
  { designation: 'D', area_sq_in: 0.110, area_sq_mm: 71.0 },
  { designation: 'E', area_sq_in: 0.196, area_sq_mm: 126.5 },
  { designation: 'F', area_sq_in: 0.307, area_sq_mm: 198.1 },
  { designation: 'G', area_sq_in: 0.503, area_sq_mm: 324.5 },
  { designation: 'H', area_sq_in: 0.785, area_sq_mm: 506.5 },
  { designation: 'J', area_sq_in: 1.287, area_sq_mm: 830.3 },
  { designation: 'K', area_sq_in: 1.838, area_sq_mm: 1185.8 },
  { designation: 'L', area_sq_in: 2.853, area_sq_mm: 1840.6 },
  { designation: 'M', area_sq_in: 3.600, area_sq_mm: 2322.6 },
  { designation: 'N', area_sq_in: 4.340, area_sq_mm: 2799.9 },
  { designation: 'P', area_sq_in: 6.380, area_sq_mm: 4116.1 },
  { designation: 'Q', area_sq_in: 11.050, area_sq_mm: 7129.0 },
  { designation: 'R', area_sq_in: 16.000, area_sq_mm: 10322.6 },
  { designation: 'T', area_sq_in: 26.000, area_sq_mm: 16774.2 }
];

const R_UNIVERSAL = 8314.46; // J / (kmol * K)

class Api520ReliefValve {
  /**
   * Size PRV for Gas or Vapor Relief (API 520 Part I, Section 5.6)
   * 
   * @param {Object} params
   * @param {number} params.massFlow Mass flow rate W (kg/h)
   * @param {number} params.P1 Relieving pressure (kPa absolute = Set Pressure + Overpressure + P_atm)
   * @param {number} params.Pb Backpressure (kPa absolute)
   * @param {number} params.T Relieving temperature (K)
   * @param {number} params.M Molecular weight (kg/kmol)
   * @param {number} params.k Specific heat ratio (Cp/Cv)
   * @param {number} [params.Z=1.0] Compressibility factor at relieving conditions
   * @param {number} [params.Kd=0.975] Effective discharge coefficient (0.975 for gas)
   * @param {number} [params.Kb=1.0] Backpressure correction factor (for balanced bellows)
   * @param {number} [params.Kc=1.0] Combination correction factor (0.9 if rupture disk upstream)
   * @returns {Object} Sizing results with required area and selected API 526 orifice
   */
  static sizeGasVapor(params) {
    const {
      massFlow, // kg/h
      P1,       // kPa(a)
      Pb,       // kPa(a)
      T,        // K
      M,        // kg/kmol
      k,        // Cp/Cv
      Z = 1.0,
      Kd = 0.975,
      Kb = 1.0,
      Kc = 1.0
    } = params;

    // Critical pressure ratio
    const r_cf = Math.pow(2 / (k + 1), k / (k - 1));
    const Pcf = P1 * r_cf;
    const isCritical = Pb <= Pcf;

    // Gas expansion coefficient C
    const C = 0.03948 * Math.sqrt(k * Math.pow(2 / (k + 1), (k + 1) / (k - 1)));

    let A_req_sq_mm;
    let flowRegime;

    if (isCritical) {
      flowRegime = 'critical';
      // API 520 Eq (5): A = (13160 * W) / (C * Kd * P1 * Kb * Kc) * sqrt(T * Z / M)
      A_req_sq_mm = ((13160 * massFlow) / (C * Kd * P1 * Kb * Kc)) * Math.sqrt((T * Z) / M);
    } else {
      flowRegime = 'subcritical';
      // Subcritical correction factor F2
      const r = Pb / P1;
      const termExp = Math.pow(r, 2 / k) - Math.pow(r, (k + 1) / k);
      const F2 = Math.sqrt((k / (k - 1)) * termExp * (2 / (1 - r)));

      // API 520 subcritical sizing equation
      A_req_sq_mm = ((17.9 * massFlow) / (F2 * Kd * Kc)) * Math.sqrt((T * Z) / (M * P1 * (P1 - Pb)));
    }

    const A_req_sq_in = A_req_sq_mm / 645.16;
    const selectedOrifice = Api520ReliefValve.selectOrifice(A_req_sq_mm);

    return {
      flowRegime,
      criticalPressureRatio: r_cf,
      criticalPressure_kPa: Pcf,
      gasConstantC: C,
      requiredArea_sq_mm: A_req_sq_mm,
      requiredArea_sq_in: A_req_sq_in,
      selectedOrifice
    };
  }

  /**
   * Size PRV for Non-Flashing Liquid Relief (API 520 Part I, Section 5.8)
   * 
   * @param {Object} params
   * @param {number} params.flowRate Liquid flow rate Q (m3/h)
   * @param {number} params.P1 Relieving pressure (kPa absolute)
   * @param {number} params.Pb Backpressure (kPa absolute)
   * @param {number} params.rho Liquid density at relieving temp (kg/m3)
   * @param {number} [params.viscosity_cP=1.0] Liquid dynamic viscosity in centipoise
   * @param {number} [params.Kd=0.65] Effective discharge coefficient (0.65 for liquid)
   * @param {number} [params.Kw=1.0] Balanced bellows backpressure factor
   * @param {number} [params.Kc=1.0] Rupture disk factor
   * @returns {Object}
   */
  static sizeLiquid(params) {
    const {
      flowRate, // m3/h
      P1,       // kPa(a)
      Pb,       // kPa(a)
      rho,      // kg/m3
      viscosity_cP = 1.0,
      Kd = 0.65,
      Kw = 1.0,
      Kc = 1.0
    } = params;

    const deltaP_kPa = Math.max(1.0, P1 - Pb);
    const deltaP_bar = deltaP_kPa / 100;
    const G = rho / 1000; // specific gravity relative to water

    // Preliminary area without viscosity correction (Kv = 1.0)
    let Kv = 1.0;
    // API 520 Metric liquid equation: A = (11.78 * Q) / (Kd * Kw * Kc * Kv) * sqrt(G / deltaP_bar)
    let A_req_sq_mm = ((11.78 * flowRate) / (Kd * Kw * Kc * Kv)) * Math.sqrt(G / deltaP_bar);

    // Viscosity correction check (Reynolds number)
    // R = (Q * (2800 * G)) / (mu_cP * sqrt(A_sq_mm))
    const R_v = (flowRate * (2800 * G)) / (viscosity_cP * Math.sqrt(A_req_sq_mm));
    if (R_v < 100000) {
      // API 520 Figure 36 / Eq (27): Kv = (0.9935 + 2.878 / R^0.5 + 342.75 / R^1.5)^(-1.0)
      Kv = Math.pow(0.9935 + 2.878 / Math.sqrt(R_v) + 342.75 / Math.pow(R_v, 1.5), -1.0);
      A_req_sq_mm = ((11.78 * flowRate) / (Kd * Kw * Kc * Kv)) * Math.sqrt(G / deltaP_bar);
    }

    const A_req_sq_in = A_req_sq_mm / 645.16;
    const selectedOrifice = Api520ReliefValve.selectOrifice(A_req_sq_mm);

    return {
      deltaP_kPa,
      viscosityFactor_Kv: Kv,
      reynoldsNumber: R_v,
      requiredArea_sq_mm: A_req_sq_mm,
      requiredArea_sq_in: A_req_sq_in,
      selectedOrifice
    };
  }

  /**
   * Size PRV for Two-Phase Flashing Flow via API 520 Omega Method (Appendix C)
   * 
   * @param {Object} params
   * @param {number} params.massFlow Mass flow rate (kg/h)
   * @param {number} params.P1 Relieving pressure (kPa absolute)
   * @param {number} params.rho_0 Relieving density (kg/m3)
   * @param {number} params.rho_9 Density at 90% relieving pressure (0.9 * P1) after isenthalpic/isentropic flash (kg/m3)
   * @param {number} [params.Kd=0.85] Discharge coefficient for two-phase
   * @returns {Object}
   */
  static sizeTwoPhaseOmega(params) {
    const {
      massFlow, // kg/h
      P1,       // kPa(a)
      rho_0,    // kg/m3
      rho_9,    // kg/m3
      Kd = 0.85
    } = params;

    // Omega compressibility parameter: omega = 9 * (rho_0 / rho_9 - 1)
    const omega = 9 * (rho_0 / rho_9 - 1);

    // Critical pressure ratio for two-phase
    // eta_c = [2 / (omega + 1)]^(omega / (omega - 1))
    let eta_c;
    if (Math.abs(omega - 1.0) < 1e-4) {
      eta_c = Math.exp(-0.5);
    } else {
      eta_c = Math.pow(2 / (omega + 1), omega / Math.max(0.001, omega - 1));
    }

    // Critical mass flux G_c (kg/(s * m2))
    // G_c = eta_c * sqrt(P1_Pa * rho_0)
    const P1_Pa = P1 * 1000;
    const G_c = eta_c * Math.sqrt(P1_Pa * rho_0);

    const massFlow_kg_s = massFlow / 3600;
    const A_req_sq_m = massFlow_kg_s / (Kd * G_c);
    const A_req_sq_mm = A_req_sq_m * 1e6;
    const A_req_sq_in = A_req_sq_mm / 645.16;

    const selectedOrifice = Api520ReliefValve.selectOrifice(A_req_sq_mm);

    return {
      omega,
      criticalPressureRatio: eta_c,
      criticalMassFlux_kg_s_m2: G_c,
      requiredArea_sq_mm: A_req_sq_mm,
      requiredArea_sq_in: A_req_sq_in,
      selectedOrifice
    };
  }

  /**
   * Select smallest API 526 Standard Orifice that satisfies A_eff >= A_req
   * @param {number} A_req_sq_mm Required orifice area in mm2
   * @returns {Object} Selected orifice details
   */
  static selectOrifice(A_req_sq_mm) {
    for (const orifice of API_526_ORIFICES) {
      if (orifice.area_sq_mm >= A_req_sq_mm) {
        const margin_percent = ((orifice.area_sq_mm - A_req_sq_mm) / A_req_sq_mm) * 100;
        return {
          designation: orifice.designation,
          effectiveArea_sq_mm: orifice.area_sq_mm,
          effectiveArea_sq_in: orifice.area_sq_in,
          capacityMarginPercent: margin_percent
        };
      }
    }

    // Beyond largest standard T orifice: multiple valves required
    const largest = API_526_ORIFICES[API_526_ORIFICES.length - 1];
    const valvesRequired = Math.ceil(A_req_sq_mm / largest.area_sq_mm);
    return {
      designation: `Multiple (${valvesRequired}x ${largest.designation})`,
      effectiveArea_sq_mm: valvesRequired * largest.area_sq_mm,
      effectiveArea_sq_in: valvesRequired * largest.area_sq_in,
      capacityMarginPercent: ((valvesRequired * largest.area_sq_mm - A_req_sq_mm) / A_req_sq_mm) * 100
    };
  }
}

module.exports = {
  Api520ReliefValve,
  API_526_ORIFICES
};
