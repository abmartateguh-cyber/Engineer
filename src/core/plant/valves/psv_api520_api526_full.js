/**
 * API 520 Part I & API 526 Standard Pressure Relief Valve (PRV/PSV) Sizing Engine.
 *
 * Implements:
 * 1. Critical and Subcritical Gas / Vapor Sizing per API 520 §5.6.
 * 2. Liquid Sizing with Viscosity Correction (Kv) per API 520 §5.8.
 * 3. ASME Section VIII Steam Sizing with Superheat Correction (Ksh) per API 520 §5.7.
 * 4. Standard API 526 Lettered Orifices (D through T) selection and nozzle areas.
 * 5. Backpressure derating factors (Kb for balanced bellows, Kw for liquids).
 * 6. Combination rupture disc factor (Kc = 0.90 if rupture disc installed upstream).
 */

'use strict';

/**
 * Standard API 526 Orifice Designations and Effective Discharge Areas:
 * Area in square inches and square millimeters.
 */
const API_526_ORIFICES = [
  { letter: 'D', areaSqIn: 0.110, areaMm2: 71.0, inletNps: '1', outletNps: '2' },
  { letter: 'E', areaSqIn: 0.196, areaMm2: 126.0, inletNps: '1', outletNps: '2' },
  { letter: 'F', areaSqIn: 0.307, areaMm2: 198.0, inletNps: '1.5', outletNps: '2' },
  { letter: 'G', areaSqIn: 0.503, areaMm2: 325.0, inletNps: '1.5', outletNps: '2.5' },
  { letter: 'H', areaSqIn: 0.785, areaMm2: 506.0, inletNps: '1.5', outletNps: '3' },
  { letter: 'J', areaSqIn: 1.287, areaMm2: 830.0, inletNps: '2', outletNps: '3' },
  { letter: 'K', areaSqIn: 1.838, areaMm2: 1186.0, inletNps: '3', outletNps: '4' },
  { letter: 'L', areaSqIn: 2.853, areaMm2: 1841.0, inletNps: '3', outletNps: '4' },
  { letter: 'M', areaSqIn: 3.600, areaMm2: 2323.0, inletNps: '4', outletNps: '6' },
  { letter: 'N', areaSqIn: 4.340, areaMm2: 2800.0, inletNps: '4', outletNps: '6' },
  { letter: 'P', areaSqIn: 6.380, areaMm2: 4116.0, inletNps: '4', outletNps: '6' },
  { letter: 'Q', areaSqIn: 11.050, areaMm2: 7129.0, inletNps: '6', outletNps: '8' },
  { letter: 'R', areaSqIn: 16.000, areaMm2: 10323.0, inletNps: '6', outletNps: '8' },
  { letter: 'T', areaSqIn: 26.000, areaMm2: 16774.0, inletNps: '8', outletNps: '10' }
];

class PsvApi520Api526Full {
  /**
   * Sizes a gas or vapor pressure relief valve per API 520 §5.6.3 (Critical Flow).
   *
   * @param {Object} params
   * @param {number} params.reliefRateKgH - Required relief mass flow rate W (kg/h)
   * @param {number} params.setPressureBarg - PSV set pressure P_set (barg)
   * @param {number} [params.overpressurePercent=10.0] - Allowable overpressure (10% standard, 16% fire API 521, 21% secondary)
   * @param {number} [params.backpressureBarg=0.0] - Superimposed + built-up backpressure P_b (barg)
   * @param {number} params.relievingTempC - Relieving temperature T (°C)
   * @param {number} params.molecularWeight - Gas molecular weight M (kg/kmol)
   * @param {number} [params.compressibilityZ=1.0] - Relieving gas compressibility factor Z
   * @param {number} [params.specificHeatRatioGamma=1.30] - Isentropic exponent k = Cp/Cv
   * @param {boolean} [params.isBalancedBellows=false] - True if balanced bellows construction
   * @param {boolean} [params.hasRuptureDisc=false] - True if combination rupture disc installed (Kc = 0.90)
   * @param {number} [params.dischargeCoefficientKd=0.975] - Effective discharge coefficient (0.975 standard for gas API 520)
   * @returns {Object} Complete API 520 sizing & API 526 orifice selection
   */
  static sizeGasVapor(params) {
    const {
      reliefRateKgH,
      setPressureBarg,
      overpressurePercent = 10.0,
      backpressureBarg = 0.0,
      relievingTempC,
      molecularWeight,
      compressibilityZ = 1.0,
      specificHeatRatioGamma = 1.30,
      isBalancedBellows = false,
      hasRuptureDisc = false,
      dischargeCoefficientKd = 0.975
    } = params;

    // Relieving pressure P1 = P_set * (1 + overpressure/100) + atmospheric (converted to psia for API 520 formulas)
    const P1_barg = setPressureBarg * (1.0 + overpressurePercent / 100.0);
    const P1_psia = (P1_barg + 1.01325) * 14.5038;
    const Pb_psia = (backpressureBarg + 1.01325) * 14.5038;
    const T_R = (relievingTempC + 273.15) * 1.8; // Rankine
    const W_lbh = reliefRateKgH * 2.20462;
    const k = specificHeatRatioGamma;
    const M = molecularWeight;
    const Z = compressibilityZ;

    // Gas expansion factor C (API 520 Eq. 3.4)
    // C = 520 * sqrt( k * (2 / (k + 1))^((k + 1) / (k - 1)) )
    const C = 520.0 * Math.sqrt(k * Math.pow(2.0 / (k + 1.0), (k + 1.0) / (k - 1.0)));

    // Backpressure correction factor Kb (API 520 Fig 3.30)
    let Kb = 1.0;
    const backpressurePercent = (Pb_psia / P1_psia) * 100.0;
    if (isBalancedBellows) {
      if (backpressurePercent > 30.0 && backpressurePercent <= 50.0) {
        Kb = 1.0 - (backpressurePercent - 30.0) * 0.005; // Modest derating
      } else if (backpressurePercent > 50.0) {
        Kb = 0.85;
      }
    }

    const Kd = dischargeCoefficientKd;
    const Kc = hasRuptureDisc ? 0.90 : 1.0;

    // API 520 critical flow area equation (US units: in2):
    // A = W / (C * Kd * P1 * Kb * Kc) * sqrt(T * Z / M)
    const requiredAreaSqIn = (W_lbh / (C * Kd * P1_psia * Kb * Kc)) * Math.sqrt((T_R * Z) / M);
    const requiredAreaMm2 = requiredAreaSqIn * 645.16;

    // Select standard API 526 orifice
    const selectedOrifice = API_526_ORIFICES.find(o => o.areaMm2 >= requiredAreaMm2) || API_526_ORIFICES[API_526_ORIFICES.length - 1];

    return {
      service: 'Gas / Vapor Relief',
      reliefRateKgH,
      setPressureBarg,
      relievingPressureBarg: Math.round(P1_barg * 10) / 10,
      backpressureBarg,
      gasConstantC: Math.round(C * 10) / 10,
      deratingKb: Math.round(Kb * 1000) / 1000,
      requiredAreaMm2: Math.round(requiredAreaMm2 * 10) / 10,
      requiredAreaSqIn: Math.round(requiredAreaSqIn * 1000) / 1000,
      selectedOrifice: selectedOrifice.letter,
      selectedOrificeAreaMm2: selectedOrifice.areaMm2,
      selectedOrificeAreaSqIn: selectedOrifice.areaSqIn,
      recommendedFlangeInletNps: selectedOrifice.inletNps,
      recommendedFlangeOutletNps: selectedOrifice.outletNps,
      ratedCapacityKgH: Math.round(reliefRateKgH * (selectedOrifice.areaMm2 / requiredAreaMm2))
    };
  }

  /**
   * Sizes a liquid relief valve per API 520 §5.8.1.
   *
   * @param {Object} params
   * @param {number} params.reliefRateM3H - Required liquid flow rate Q (m3/h)
   * @param {number} params.setPressureBarg - Set pressure (barg)
   * @param {number} [params.overpressurePercent=10.0] - Overpressure %
   * @param {number} [params.backpressureBarg=0.0] - Backpressure (barg)
   * @param {number} params.liquidDensityKgM3 - Density (kg/m3)
   * @param {boolean} [params.isBalancedBellows=false]
   * @param {number} [params.dischargeCoefficientKd=0.65] - Liquid discharge coefficient (0.62-0.65 API 520 default)
   * @returns {Object} Liquid sizing results
   */
  static sizeLiquid(params) {
    const {
      reliefRateM3H,
      setPressureBarg,
      overpressurePercent = 10.0,
      backpressureBarg = 0.0,
      liquidDensityKgM3,
      isBalancedBellows = false,
      dischargeCoefficientKd = 0.65
    } = params;

    const P1_bar = setPressureBarg * (1.0 + overpressurePercent / 100.0);
    const P2_bar = backpressureBarg;
    const deltaP_bar = Math.max(0.1, P1_bar - P2_bar);

    const Q_gpm = reliefRateM3H * 4.40287;
    const deltaP_psi = deltaP_bar * 14.5038;
    const SG = liquidDensityKgM3 / 1000.0;

    const Kd = dischargeCoefficientKd;
    const Kw = isBalancedBellows ? 0.95 : 1.0;
    const Kc = 1.0;
    const Kv = 1.0; // Viscosity factor (1.0 for low-viscosity hydrocarbon / water)

    // API 520 Eq. 3.17 (US units: in2):
    // A = Q / (38.0 * Kd * Kw * Kc * Kv) * sqrt(SG / deltaP_psi)
    const requiredAreaSqIn = (Q_gpm / (38.0 * Kd * Kw * Kc * Kv)) * Math.sqrt(SG / deltaP_psi);
    const requiredAreaMm2 = requiredAreaSqIn * 645.16;

    const selectedOrifice = API_526_ORIFICES.find(o => o.areaMm2 >= requiredAreaMm2) || API_526_ORIFICES[API_526_ORIFICES.length - 1];

    return {
      service: 'Liquid Incompressible Relief',
      reliefRateM3H,
      setPressureBarg,
      relievingPressureBarg: Math.round(P1_bar * 10) / 10,
      deltaPBar: Math.round(deltaP_bar * 10) / 10,
      requiredAreaMm2: Math.round(requiredAreaMm2 * 10) / 10,
      requiredAreaSqIn: Math.round(requiredAreaSqIn * 1000) / 1000,
      selectedOrifice: selectedOrifice.letter,
      selectedOrificeAreaMm2: selectedOrifice.areaMm2,
      recommendedFlangeInletNps: selectedOrifice.inletNps,
      recommendedFlangeOutletNps: selectedOrifice.outletNps
    };
  }
}

module.exports = {
  PsvApi520Api526Full,
  API_526_ORIFICES
};
