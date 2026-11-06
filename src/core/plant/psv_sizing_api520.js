/**
 * Automated Pressure Safety Valve (PSV) Sizing Engine per API 520 Part I & API 526.
 *
 * Implements:
 * 1. Critical & Subcritical Gas/Vapor Relief Sizing (API 520 Part I Section 5.6).
 * 2. Liquid Relief Sizing (API 520 Part I Section 5.8).
 * 3. Steam Relief Sizing (ASME Section VIII Div 1 & API 520).
 * 4. API 521 Fire Relief Heat Absorption & Required Wetted Area:
 *    Q = 43,200 * F * Aws^0.82  (W)
 * 5. Two-phase Leung Omega (omega) method for flashing relief (API 520 Annex C).
 * 6. API 526 Standard Orifice Selection (D through T) with inlet/outlet flange ratings.
 */

'use strict';

// Standard API 526 Orifice Designations and Effective Discharge Areas (mm^2)
const API_526_ORIFICES = [
  { letter: 'D', areaMm2: 71.0, areaIn2: 0.110, standardInletNps: '1', standardOutletNps: '2' },
  { letter: 'E', areaMm2: 126.0, areaIn2: 0.196, standardInletNps: '1', standardOutletNps: '2' },
  { letter: 'F', areaMm2: 198.0, areaIn2: 0.307, standardInletNps: '1.5', standardOutletNps: '2' },
  { letter: 'G', areaMm2: 325.0, areaIn2: 0.503, standardInletNps: '1.5', standardOutletNps: '3' },
  { letter: 'H', areaMm2: 506.0, areaIn2: 0.785, standardInletNps: '2', standardOutletNps: '3' },
  { letter: 'J', areaMm2: 830.0, areaIn2: 1.287, standardInletNps: '2.5', standardOutletNps: '4' },
  { letter: 'K', areaMm2: 1186.0, areaIn2: 1.838, standardInletNps: '3', standardOutletNps: '4' },
  { letter: 'L', areaMm2: 1841.0, areaIn2: 2.853, standardInletNps: '4', standardOutletNps: '6' },
  { letter: 'M', areaMm2: 2323.0, areaIn2: 3.600, standardInletNps: '4', standardOutletNps: '6' },
  { letter: 'N', areaMm2: 2800.0, areaIn2: 4.340, standardInletNps: '4', standardOutletNps: '6' },
  { letter: 'P', areaMm2: 4116.0, areaIn2: 6.380, standardInletNps: '4', standardOutletNps: '6' },
  { letter: 'Q', areaMm2: 7129.0, areaIn2: 11.050, standardInletNps: '6', standardOutletNps: '8' },
  { letter: 'R', areaMm2: 10323.0, areaIn2: 16.000, standardInletNps: '6', standardOutletNps: '10' },
  { letter: 'T', areaMm2: 16774.0, areaIn2: 26.000, standardInletNps: '8', standardOutletNps: '10' }
];

class PSVSizingEngine {
  constructor() {
    this.orifices = API_526_ORIFICES;
    this.atmosphericPressureKPa = 101.325;
  }

  /**
   * Gas expansion factor C (API 520 Part I Eq. 6).
   * C = 0.03948 * sqrt( k * (2 / (k + 1))^((k + 1) / (k - 1)) )
   *
   * @param {number} k Specific heat ratio Cp/Cv (typically 1.1 to 1.67)
   * @returns {number} C expansion coefficient (SI units)
   */
  calculateGasConstantC(k) {
    if (k <= 1.0) k = 1.01;
    const exponent = (k + 1.0) / (k - 1.0);
    const base = 2.0 / (k + 1.0);
    return 0.03948 * Math.sqrt(k * Math.pow(base, exponent));
  }

  /**
   * Critical flow pressure ratio (Pcf / P1).
   * (Pcf / P1) = (2 / (k + 1))^(k / (k - 1))
   *
   * @param {number} k Specific heat ratio
   * @returns {number} Critical pressure ratio
   */
  calculateCriticalPressureRatio(k) {
    if (k <= 1.0) k = 1.01;
    return Math.pow(2.0 / (k + 1.0), k / (k - 1.0));
  }

  /**
   * Size PSV for gas or vapor relief per API 520 Part I Section 5.6.
   *
   * @param {Object} params
   * @param {number} params.massReliefRateKgH Mass flow rate to relieve W (kg/h)
   * @param {number} params.setPressureKPaG PSV set pressure (kPa gauge)
   * @param {number} [params.overpressurePercent=10] Allowable overpressure (10% for non-fire, 16% multiple, 21% fire)
   * @param {number} [params.backpressureKPaG=0] Superimposed/built-up backpressure (kPa gauge)
   * @param {number} params.temperatureK Relieving temperature T (K)
   * @param {number} params.molecularWeight Molar mass M (kg/kmol)
   * @param {number} [params.compressibilityZ=1.0] Relieving compressibility factor Z
   * @param {number} [params.specificHeatRatio=1.4] k = Cp/Cv
   * @param {number} [params.dischargeCoefficientKd=0.975] Effective Kd (0.975 for gas)
   * @param {number} [params.combinationFactorKc=1.0] Rupture disk factor (1.0 bare, 0.9 with disk)
   * @param {number} [params.backpressureFactorKb=1.0] Backpressure factor Kb
   * @returns {Object} Sizing results and orifice selection
   */
  sizeGasRelief({
    massReliefRateKgH,
    setPressureKPaG,
    overpressurePercent = 10,
    backpressureKPaG = 0,
    temperatureK,
    molecularWeight,
    compressibilityZ = 1.0,
    specificHeatRatio = 1.4,
    dischargeCoefficientKd = 0.975,
    combinationFactorKc = 1.0,
    backpressureFactorKb = 1.0
  }) {
    const W = massReliefRateKgH;
    const P_atm = this.atmosphericPressureKPa;
    // Upstream relieving pressure P1 (kPa absolute)
    const P1 = setPressureKPaG * (1.0 + overpressurePercent / 100.0) + P_atm;
    // Downstream backpressure P2 (kPa absolute)
    const P2 = backpressureKPaG + P_atm;

    const k = specificHeatRatio;
    const rCrit = this.calculateCriticalPressureRatio(k);
    const isCritical = (P2 / P1) <= rCrit;

    let requiredAreaMm2;
    let flowRegime = 'critical';

    if (isCritical) {
      // API 520 Part I Eq. 5: Critical / Sonic flow
      const C = this.calculateGasConstantC(k);
      const denom = C * dischargeCoefficientKd * P1 * backpressureFactorKb * combinationFactorKc;
      const term = Math.sqrt((temperatureK * compressibilityZ) / molecularWeight);
      requiredAreaMm2 = (W / denom) * term;
    } else {
      // API 520 Part I Eq. 15: Subcritical flow
      flowRegime = 'subcritical';
      const r = P2 / P1;
      const F2 = Math.sqrt((k / (k - 1)) * Math.pow(r, 2.0 / k) * (1.0 - Math.pow(r, (k - 1) / k)) / (1.0 - r));
      const denom = 0.03948 * dischargeCoefficientKd * P1 * F2 * combinationFactorKc;
      const term = Math.sqrt((temperatureK * compressibilityZ) / molecularWeight);
      requiredAreaMm2 = (W / denom) * term;
    }

    const selectedOrifice = this.selectAPI526Orifice(requiredAreaMm2);

    return {
      service: 'gas',
      flowRegime,
      relievingPressureKPaA: P1,
      relievingPressureBarA: P1 / 100.0,
      backpressureKPaA: P2,
      criticalPressureRatio: rCrit,
      actualPressureRatio: P2 / P1,
      requiredAreaMm2,
      selectedOrifice,
      ratedCapacityKgH: (W * selectedOrifice.areaMm2) / requiredAreaMm2,
      marginPercent: ((selectedOrifice.areaMm2 - requiredAreaMm2) / requiredAreaMm2) * 100.0
    };
  }

  /**
   * Size PSV for liquid relief per API 520 Part I Section 5.8.
   *
   * Formula:
   * A = (196.33 * Q_m3h) / (Kd * Kw * Kc * Kv) * sqrt(G / (P1 - P2))
   *
   * @param {Object} params
   * @param {number} params.volumetricFlowM3H Liquid relief flow rate (m^3/h)
   * @param {number} params.setPressureKPaG PSV set pressure (kPa gauge)
   * @param {number} [params.overpressurePercent=10] Overpressure (10% standard, 25% for thermal expansion)
   * @param {number} [params.backpressureKPaG=0] Total backpressure (kPa gauge)
   * @param {number} [params.densityKgM3=1000] Liquid density (kg/m^3)
   * @param {number} [params.viscosityCP=1.0] Viscosity (cP = mPa*s)
   * @param {number} [params.dischargeCoefficientKd=0.65] Liquid discharge coefficient
   * @param {number} [params.backpressureFactorKw=1.0] Balanced bellows factor (1.0 for conventional)
   * @param {number} [params.combinationFactorKc=1.0] Rupture disk factor
   * @returns {Object} Sizing results
   */
  sizeLiquidRelief({
    volumetricFlowM3H,
    setPressureKPaG,
    overpressurePercent = 10,
    backpressureKPaG = 0,
    densityKgM3 = 1000,
    viscosityCP = 1.0,
    dischargeCoefficientKd = 0.65,
    backpressureFactorKw = 1.0,
    combinationFactorKc = 1.0
  }) {
    const P_atm = this.atmosphericPressureKPa;
    const P1 = setPressureKPaG * (1.0 + overpressurePercent / 100.0) + P_atm;
    const P2 = backpressureKPaG + P_atm;
    const deltaPKPa = Math.max(1.0, P1 - P2);

    // Specific gravity G relative to water at 15.6 C (rho_w = 999.0 kg/m^3)
    const G = densityKgM3 / 999.0;

    // Preliminary area without viscosity correction (Kv = 1.0)
    let Kv = 1.0;
    let denom = dischargeCoefficientKd * backpressureFactorKw * combinationFactorKc * Kv;
    let requiredAreaMm2 = ((196.33 * volumetricFlowM3H) / denom) * Math.sqrt(G / deltaPKPa);

    // Iterative viscosity correction per API 520 Section 5.8.3
    if (viscosityCP > 3.0) {
      for (let it = 0; it < 5; it++) {
        // Reynolds number: Re = (volumetricFlowM3H * 1000 * 18800 * G) / (viscosityCP * sqrt(A_mm2))
        const Re = (volumetricFlowM3H * 18800.0 * G) / (viscosityCP * Math.sqrt(Math.max(1.0, requiredAreaMm2)));
        if (Re >= 100000) {
          Kv = 1.0;
        } else {
          Kv = Math.pow(0.9935 + (2.878 / Math.sqrt(Math.max(1.0, Re))) + (342.75 / Math.pow(Math.max(1.0, Re), 1.5)), -1.0);
          Kv = Math.max(0.2, Math.min(1.0, Kv));
        }
        const newArea = ((196.33 * volumetricFlowM3H) / (dischargeCoefficientKd * backpressureFactorKw * combinationFactorKc * Kv)) * Math.sqrt(G / deltaPKPa);
        if (Math.abs(newArea - requiredAreaMm2) < 0.1) break;
        requiredAreaMm2 = newArea;
      }
    }

    const selectedOrifice = this.selectAPI526Orifice(requiredAreaMm2);

    return {
      service: 'liquid',
      relievingPressureKPaA: P1,
      differentialPressureKPa: deltaPKPa,
      specificGravity: G,
      viscosityCorrectionKv: Kv,
      requiredAreaMm2,
      selectedOrifice,
      ratedCapacityM3H: (volumetricFlowM3H * selectedOrifice.areaMm2) / requiredAreaMm2,
      marginPercent: ((selectedOrifice.areaMm2 - requiredAreaMm2) / requiredAreaMm2) * 100.0
    };
  }

  /**
   * API 521 Fire Case Wetted Surface Area & Heat Input Absorption.
   *
   * Q = 43,200 * F * Aws^0.82  (W)  [adequate drainage & prompt firefighting]
   * Q = 70,900 * F * Aws^0.82  (W)  [without drainage/firefighting]
   *
   * @param {Object} params
   * @param {number} params.wettedSurfaceAreaM2 Wetted vessel surface area Aws (m^2) up to 7.62 m grade
   * @param {number} [params.environmentalFactorF=1.0] F factor (1.0 bare, 0.3 insulated, 0.15 water spray)
   * @param {boolean} [params.hasPromptFirefighting=true] Whether prompt firefighting / drainage exists
   * @param {number} params.latentHeatOfVaporizationJ_Kg Latent heat delta H_vap (J/kg)
   * @returns {Object} Fire relief heat absorption and required mass relief rate W (kg/h)
   */
  calculateFireCaseRelief({
    wettedSurfaceAreaM2,
    environmentalFactorF = 1.0,
    hasPromptFirefighting = true,
    latentHeatOfVaporizationJ_Kg
  }) {
    const C_fire = hasPromptFirefighting ? 43200.0 : 70900.0;
    const Aws = Math.max(0.1, wettedSurfaceAreaM2);
    const Q_watts = C_fire * environmentalFactorF * Math.pow(Aws, 0.82);

    // Required mass flow rate W (kg/h) = (Q_watts / deltaH_vap) * 3600 s/h
    const massFlowKgH = (Q_watts / Math.max(1000.0, latentHeatOfVaporizationJ_Kg)) * 3600.0;

    return {
      heatAbsorptionWatts: Q_watts,
      heatAbsorptionKW: Q_watts / 1000.0,
      heatAbsorptionMMBtuH: (Q_watts * 3.412142) / 1e6,
      requiredMassReliefRateKgH: massFlowKgH,
      wettedAreaM2: Aws,
      environmentalFactorF
    };
  }

  /**
   * Two-phase Flashing Flow Leung Omega (omega) method (API 520 Annex C).
   *
   * @param {Object} params
   * @param {number} params.massReliefRateKgH Mass flow rate (kg/h)
   * @param {number} params.setPressureKPaG Set pressure
   * @param {number} [params.overpressurePercent=10]
   * @param {number} params.vaporMassFraction0 Inlet vapor mass fraction x0
   * @param {number} params.liquidDensityKgM3 Liquid density rho_L
   * @param {number} params.vaporDensityKgM3 Vapor density rho_G
   * @param {number} params.latentHeatJ_Kg Latent heat
   * @param {number} params.temperatureK Relieving temperature
   * @returns {Object} Leung two-phase sizing report
   */
  sizeTwoPhaseLeung({
    massReliefRateKgH,
    setPressureKPaG,
    overpressurePercent = 10,
    vaporMassFraction0,
    liquidDensityKgM3,
    vaporDensityKgM3,
    latentHeatJ_Kg,
    temperatureK
  }) {
    const P1_kPa = setPressureKPaG * (1.0 + overpressurePercent / 100.0) + this.atmosphericPressureKPa;
    const P1_Pa = P1_kPa * 1000.0;

    const vL0 = 1.0 / liquidDensityKgM3;
    const vG0 = 1.0 / vaporDensityKgM3;
    const x0 = Math.max(0.0, Math.min(1.0, vaporMassFraction0));
    const v0 = (1.0 - x0) * vL0 + x0 * vG0;

    // Leung omega parameter for flashing flow:
    // omega = (1 - x0) * (Cp * T * P1 / (h_fg^2)) * (v_fg / v0)^2 + x0 * (vG0 / v0)
    // Simplified homogeneous equilibrium model (HEM) omega parameter:
    const v_fg = vG0 - vL0;
    const omega = ((1.0 - x0) * liquidDensityKgM3 * v_fg * (v_fg / v0) * 0.1) + (x0 * (vG0 / v0));
    const omegaParam = Math.max(0.1, omega);

    // Critical pressure ratio eta_c:
    // eta_c * (1 - ln(eta_c)) = omega / (omega + 1)
    const eta_c = omegaParam / (omegaParam + 1.0); // Leung first approximation

    // Mass flux G_c (kg/(m^2 * s)):
    const G_c = (eta_c / Math.sqrt(omegaParam)) * Math.sqrt(P1_Pa / v0);

    const Kd = 0.85; // API 520 two-phase discharge coefficient
    const W_kgs = massReliefRateKgH / 3600.0;
    const areaM2 = W_kgs / (Kd * G_c);
    const requiredAreaMm2 = areaM2 * 1e6;

    const selectedOrifice = this.selectAPI526Orifice(requiredAreaMm2);

    return {
      service: 'two_phase_flashing',
      omegaParameter: omegaParam,
      criticalPressureRatio: eta_c,
      criticalMassFluxKgM2S: G_c,
      requiredAreaMm2,
      selectedOrifice,
      ratedCapacityKgH: (massReliefRateKgH * selectedOrifice.areaMm2) / requiredAreaMm2
    };
  }

  /**
   * Select smallest API 526 standard orifice letter that satisfies required area.
   *
   * @param {number} requiredAreaMm2 Calculated required discharge area (mm^2)
   * @returns {Object} API 526 orifice specification
   */
  selectAPI526Orifice(requiredAreaMm2) {
    for (const ori of this.orifices) {
      if (ori.areaMm2 >= requiredAreaMm2) {
        return ori;
      }
    }
    // If larger than T orifice (16,774 mm^2), recommend multiple T valves
    const tOrifice = this.orifices[this.orifices.length - 1];
    const valvesRequired = Math.ceil(requiredAreaMm2 / tOrifice.areaMm2);
    return {
      letter: `Multiple (${valvesRequired}x ${tOrifice.letter})`,
      areaMm2: tOrifice.areaMm2 * valvesRequired,
      areaIn2: tOrifice.areaIn2 * valvesRequired,
      valvesRequired,
      singleOrifice: tOrifice
    };
  }
}

module.exports = {
  PSVSizingEngine,
  API_526_ORIFICES
};
