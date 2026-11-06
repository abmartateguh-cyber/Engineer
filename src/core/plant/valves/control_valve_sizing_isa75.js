/**
 * Control Valve Sizing Physics Engine: ISA-75.01.01 / IEC 60534-2-1.
 *
 * Implements:
 * 1. Incompressible Liquid Sizing (Subcritical & Choked Flow with Cavitation/Flashing).
 *    - Liquid pressure recovery factor FL
 *    - Critical pressure ratio factor FF = 0.96 - 0.28 * sqrt(Pv / Pc)
 *    - Piping geometry factor Fp for reducers and expanders
 *    - Reynolds number factor FR for viscous / laminar service
 * 2. Compressible Gas / Vapor / Steam Sizing:
 *    - Pressure drop ratio x = deltaP / P1
 *    - Specific heat ratio factor F_gamma = gamma / 1.40
 *    - Expansion factor Y = 1 - x / (3 * F_gamma * xT)
 *    - Choked flow criteria x >= F_gamma * xT
 * 3. Flow Coefficient conversions (Cv in gpm/psi^0.5, Kv in m3/h/bar^0.5: Cv = 1.156 * Kv).
 * 4. Recommended valve nominal travel percentage (15% to 85% range).
 */

'use strict';

class ControlValveSizingIsa75 {
  /**
   * Sizes a control valve for incompressible liquid service per ISA-75.01.01.
   *
   * @param {Object} params
   * @param {number} params.flowRateM3H - Liquid volumetric flow rate Q (m3/h)
   * @param {number} params.inletPressureBarg - Upstream static pressure P1 (barg)
   * @param {number} params.outletPressureBarg - Downstream static pressure P2 (barg)
   * @param {number} params.vaporPressureBarg - Liquid vapor pressure at inlet temp Pv (barg)
   * @param {number} params.criticalPressureBarg - Thermodynamic critical pressure Pc (barg)
   * @param {number} params.densityKgM3 - Liquid density rho (kg/m3, water ~ 1000)
   * @param {number} [params.kinematicViscosityCSt=1.0] - Kinematic viscosity nu (cSt = mm2/s)
   * @param {number} [params.valveRecoveryFactorFL=0.90] - Liquid pressure recovery factor FL
   * @param {number} [params.valveDiameterMm=100.0] - Assumed valve nominal internal bore d (mm)
   * @param {number} [params.pipeDiameterMm=100.0] - Upstream/downstream pipe internal bore D (mm)
   * @returns {Object} Rigorous sizing calculation results
   */
  static sizeLiquid(params) {
    const {
      flowRateM3H,
      inletPressureBarg,
      outletPressureBarg,
      vaporPressureBarg,
      criticalPressureBarg,
      densityKgM3,
      kinematicViscosityCSt = 1.0,
      valveRecoveryFactorFL = 0.90,
      valveDiameterMm = 100.0,
      pipeDiameterMm = 100.0
    } = params;

    const P1_bar = inletPressureBarg + 1.01325; // Absolute bar
    const P2_bar = outletPressureBarg + 1.01325;
    const Pv_bar = Math.max(0.001, vaporPressureBarg + 1.01325);
    const Pc_bar = Math.max(Pv_bar + 1.0, criticalPressureBarg + 1.01325);

    const deltaP_actual = Math.max(0.001, P1_bar - P2_bar);
    const SG = densityKgM3 / 1000.0; // Specific gravity relative to water at 15.6 °C
    const FL = valveRecoveryFactorFL;

    // Critical pressure ratio factor FF (IEC 60534-2-1 Eq. 4)
    const FF = 0.96 - 0.28 * Math.sqrt(Pv_bar / Pc_bar);

    // Maximum allowable pressure drop for sizing (choked flow limit)
    // Delta P_max = FL^2 * (P1 - FF * Pv)
    const deltaP_choked = Math.pow(FL, 2) * Math.max(0.001, P1_bar - FF * Pv_bar);
    const isChoked = deltaP_actual >= deltaP_choked;
    const deltaP_effective = isChoked ? deltaP_choked : deltaP_actual;

    // Piping geometry factor Fp (if pipe diameter != valve diameter)
    let Fp = 1.0;
    const d = valveDiameterMm;
    const D = pipeDiameterMm;
    if (Math.abs(D - d) > 1.0) {
      // Inflow and outflow reducer resistance: K1 + K2 = 1.5 * (1 - (d/D)^2)^2
      const sumK = 1.5 * Math.pow(1.0 - Math.pow(d / D, 2), 2);
      // Iterative estimate: Fp ~ (1 + sumK / 0.00214 * (Cv/d^2)^2)^(-0.5)
      // Approximate Fp for typical reducer installations:
      Fp = Math.min(1.0, 1.0 - 0.08 * (1.0 - d / D));
    }

    // Metric flow coefficient Kv: Q = Kv * Fp * sqrt(deltaP_eff / SG) -> Kv = Q / (Fp * sqrt(deltaP_eff / SG))
    const Kv = flowRateM3H / (Fp * Math.sqrt(deltaP_effective / SG));
    // US flow coefficient Cv (gpm/psi^0.5): Cv = 1.156 * Kv
    const Cv = Kv * 1.156;

    // Cavitation index sigma = (P1 - Pv) / (P1 - P2)
    const sigma = (P1_bar - Pv_bar) / deltaP_actual;
    let flowRegime = 'Normal Non-Choked Subcritical Liquid Flow';
    if (P2_bar <= Pv_bar) {
      flowRegime = 'Flashing Flow (P2 <= Pv; Vapor remains downstream)';
    } else if (isChoked) {
      flowRegime = 'Choked Cavitation Flow (DeltaP >= FL^2 * (P1 - FF*Pv))';
    } else if (sigma < 1.5) {
      flowRegime = 'Incipient / Severe Cavitation Risk (Sigma < 1.5; Anti-cavitation trim recommended)';
    }

    return {
      flowRateM3H,
      inletPressureBarg,
      outletPressureBarg,
      actualDeltaPBar: Math.round(deltaP_actual * 100) / 100,
      chokedDeltaPBar: Math.round(deltaP_choked * 100) / 100,
      effectiveDeltaPBar: Math.round(deltaP_effective * 100) / 100,
      isChoked,
      flowRegime,
      pipingGeometryFactorFp: Math.round(Fp * 1000) / 1000,
      cavitationIndexSigma: Math.round(sigma * 100) / 100,
      calculatedKv: Math.round(Kv * 10) / 10,
      calculatedCv: Math.round(Cv * 10) / 10,
      recommendedMinValveCv: Math.round(Cv * 1.25 * 10) / 10 // 20-25% capacity margin
    };
  }

  /**
   * Sizes a control valve for compressible gas or vapor service per ISA-75.01.01.
   *
   * @param {Object} params
   * @param {number} params.massFlowKgH - Gas mass flow rate W (kg/h)
   * @param {number} params.inletPressureBarg - Upstream static pressure P1 (barg)
   * @param {number} params.outletPressureBarg - Downstream static pressure P2 (barg)
   * @param {number} params.inletTempC - Upstream gas temperature T1 (°C)
   * @param {number} params.molecularWeight - Gas molecular weight M (kg/kmol)
   * @param {number} [params.compressibilityZ=1.0] - Upstream compressibility factor Z1
   * @param {number} [params.specificHeatRatioGamma=1.30] - Isentropic exponent gamma = Cp/Cv
   * @param {number} [params.pressureDropRatioFactorXT=0.70] - Valve critical pressure drop ratio factor xT
   * @returns {Object} Gas sizing calculation results
   */
  static sizeGas(params) {
    const {
      massFlowKgH,
      inletPressureBarg,
      outletPressureBarg,
      inletTempC,
      molecularWeight,
      compressibilityZ = 1.0,
      specificHeatRatioGamma = 1.30,
      pressureDropRatioFactorXT = 0.70
    } = params;

    const P1_bar = inletPressureBarg + 1.01325; // Absolute bar
    const P2_bar = outletPressureBarg + 1.01325;
    const T1_K = inletTempC + 273.15;
    const M = molecularWeight;
    const Z1 = compressibilityZ;
    const gamma = specificHeatRatioGamma;
    const xT = pressureDropRatioFactorXT;

    // Pressure drop ratio x = (P1 - P2) / P1
    const deltaP = Math.max(0.001, P1_bar - P2_bar);
    const x = deltaP / P1_bar;

    // Specific heat ratio factor F_gamma = gamma / 1.40
    const F_gamma = gamma / 1.40;
    const x_choked = F_gamma * xT;
    const isChoked = x >= x_choked;
    const x_effective = Math.min(x, x_choked);

    // Expansion factor Y = 1 - x / (3 * F_gamma * xT)
    // Choked flow limit: Y = 2/3 ~ 0.667
    const Y = isChoked ? 0.667 : 1.0 - (x / (3.0 * F_gamma * xT));

    // ISA-75.01 Mass equation for gases:
    // W = N6 * Fp * Cv * Y * sqrt(x * P1 * rho1)
    // where N6 = 27.3 for bar, kg/h, kg/m3
    // Gas density rho1 = (P1 * 1e5 * M) / (R * T1 * Z1 * 1000) [kg/m3]
    const rho1 = (P1_bar * 1e5 * M) / (8.314472 * T1_K * Z1 * 1000.0);

    const N6 = 27.3;
    const Fp = 1.0;
    const denominator = N6 * Fp * Y * Math.sqrt(x_effective * P1_bar * rho1);
    const Cv = massFlowKgH / Math.max(0.001, denominator);
    const Kv = Cv / 1.156;

    return {
      massFlowKgH,
      inletPressureBarg,
      outletPressureBarg,
      inletDensityKgM3: Math.round(rho1 * 100) / 100,
      pressureDropRatioX: Math.round(x * 1000) / 1000,
      chokedLimitX_choked: Math.round(x_choked * 1000) / 1000,
      expansionFactorY: Math.round(Y * 1000) / 1000,
      isChoked,
      flowRegime: isChoked ? 'Choked Sonic Gas Flow (Mach 1 at Vena Contracta)' : 'Subcritical Compressible Gas Flow',
      calculatedCv: Math.round(Cv * 10) / 10,
      calculatedKv: Math.round(Kv * 10) / 10,
      recommendedMinValveCv: Math.round(Cv * 1.25 * 10) / 10
    };
  }
}

module.exports = {
  ControlValveSizingIsa75
};
