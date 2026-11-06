/**
 * API 617 Part 4 Cryogenic Turboexpander-Recompressor (Compander) Engine.
 *
 * Implements:
 * 1. Radial inflow expansion turbine thermodynamics for cryogenic LNG and NGL recovery.
 * 2. Isentropic enthalpy extraction, shaft power generation, and refrigeration effect.
 * 3. Two-phase expansion tracking: exit vapor quality, droplet mist fraction, and liquid yield.
 * 4. Direct shaft coupling to centrifugal recompressor (Brake/Booster Compressor):
 *    - Power balance: P_recompressor = P_expander * eta_mechanical.
 *    - Recompressor pressure boost and discharge conditions.
 * 5. Joule-Thomson (JT) isenthalpic throttling comparison:
 *    - Temperature drop comparison (isentropic vs isenthalpic).
 *    - Heavy hydrocarbon NGL condensation yield enhancement.
 *    - Power recovery comparison.
 */

'use strict';

const R_UNIVERSAL = 8.314472; // J/(mol*K)

class Turboexpander {
  /**
   * Evaluates cryogenic turboexpander-recompressor (compander) operating point.
   *
   * @param {Object} params
   * @param {number} params.massFlowKgH - Gas mass flow through expander (kg/h)
   * @param {number} params.inletPressureBarg - Expander inlet pressure (barg)
   * @param {number} params.outletPressureBarg - Expander outlet pressure (barg)
   * @param {number} params.inletTempC - Expander suction temperature (°C)
   * @param {number} params.molecularWeight - Gas molecular weight (kg/kmol)
   * @param {number} [params.specificHeatRatioGamma=1.28] - k = Cp/Cv
   * @param {number} [params.expanderEfficiency=0.85] - Expander isentropic efficiency (typically 0.82-0.88)
   * @param {number} [params.recompressorEfficiency=0.78] - Booster compressor polytropic efficiency
   * @param {number} [params.recompressorInletPressureBarg] - Booster suction pressure (defaults to outletPressureBarg)
   * @param {number} [params.recompressorInletTempC=15.0] - Gas temperature entering booster compressor (°C)
   * @param {number} [params.recompressorMassFlowKgH] - Booster mass flow (defaults to expander mass flow)
   * @param {number} [params.dewPointTempC=-55.0] - Gas dew point at expander outlet pressure (°C)
   * @param {number} [params.latentHeatKJkg=380.0] - Latent heat of condensation (kJ/kg)
   * @param {number} [params.mechanicalEfficiency=0.98] - Mechanical coupling efficiency (active magnetic bearing ~0.98)
   * @returns {Object} Complete expander power, refrigeration, liquid yield, and recompressor performance
   */
  static evaluateTurboexpander(params) {
    const {
      massFlowKgH,
      inletPressureBarg,
      outletPressureBarg,
      inletTempC,
      molecularWeight,
      specificHeatRatioGamma = 1.28,
      expanderEfficiency = 0.85,
      recompressorEfficiency = 0.78,
      recompressorInletPressureBarg,
      recompressorInletTempC = 15.0,
      recompressorMassFlowKgH,
      dewPointTempC = -55.0,
      latentHeatKJkg = 380.0,
      mechanicalEfficiency = 0.98
    } = params;

    if (massFlowKgH <= 0) throw new Error('Mass flow must be positive');
    if (molecularWeight <= 0) throw new Error('Molecular weight must be positive');
    if (specificHeatRatioGamma <= 1.0) throw new Error('Specific heat ratio gamma must exceed 1.0');
    if (expanderEfficiency <= 0 || expanderEfficiency > 1.0) throw new Error('Expander efficiency must be between 0 and 1.0');
    if (recompressorEfficiency <= 0 || recompressorEfficiency > 1.0) throw new Error('Recompressor efficiency must be between 0 and 1.0');
    if (recompressorMassFlowKgH !== undefined && recompressorMassFlowKgH <= 0) {
      throw new Error('Recompressor mass flow must be positive when supplied');
    }

    const P1_bar = inletPressureBarg + 1.01325;
    const P2_bar = outletPressureBarg + 1.01325;
    if (P2_bar >= P1_bar) throw new Error('Expander inlet pressure must exceed outlet pressure');

    const k = specificHeatRatioGamma;
    const R_spec = (R_UNIVERSAL * 1000.0) / molecularWeight;
    const Cp = (k * R_spec) / (k - 1.0); // J/(kg*K)
    const Cp_kJ = Cp * 1e-3; // kJ/(kg*K)
    const T1_K = inletTempC + 273.15;
    const expansionRatio = P1_bar / P2_bar;

    // 1. Isentropic Enthalpy Drop: delta_h_s = Cp * T1 * [1 - (P2/P1)^((k-1)/k)]
    const isentropicEnthalpyDropKJkg = Cp_kJ * T1_K * (1.0 - Math.pow(1.0 / expansionRatio, (k - 1.0) / k));
    const actualEnthalpyDropKJkg = isentropicEnthalpyDropKJkg * expanderEfficiency;

    // 2. Shaft Power Generated
    const m_dot_kg_s = massFlowKgH / 3600.0;
    const shaftPowerRecoveredKW = m_dot_kg_s * actualEnthalpyDropKJkg;
    const shaftPowerRecoveredMW = shaftPowerRecoveredKW * 1e-3;

    // 3. Outlet Temperature & Two-Phase Condensation Tracking
    const unconstrainedOutletTempC = inletTempC - (actualEnthalpyDropKJkg / Cp_kJ);

    let outletTempC = unconstrainedOutletTempC;
    let liquidCondensationFraction = 0.0;
    let exitVaporQuality = 1.0;

    if (unconstrainedOutletTempC < dewPointTempC) {
      // Subcooling drives condensation across the phase envelope.
      // Latent heat of condensation released warms the two-phase mixture above unconstrained T.
      // Energy conservation: Cp * (Tin - Tout) + x * Hvap = delta_h_act
      // For hydrocarbon mixture condensation over typical dew-to-bubble range (deltaT_cond ~ 40 K):
      const deltaT_cond = 40.0;
      const subcoolingEnthalpyKJkg = Cp_kJ * (dewPointTempC - unconstrainedOutletTempC);
      const effectiveCpKJkgK = Cp_kJ + (latentHeatKJkg / deltaT_cond);
      const condensationTempDropC = subcoolingEnthalpyKJkg / effectiveCpKJkgK;

      // Liquid fraction: capped at 0.35 max allowable mist carryover for radial turboexpander impellers
      liquidCondensationFraction = Math.min(0.35, Math.max(0.0, condensationTempDropC / deltaT_cond));
      // Energy-balanced mixture outlet temperature conserving First Law
      outletTempC = unconstrainedOutletTempC + (liquidCondensationFraction * latentHeatKJkg) / Cp_kJ;
      exitVaporQuality = 1.0 - liquidCondensationFraction;
    }

    const liquidProductionKgH = massFlowKgH * liquidCondensationFraction;
    const vaporFlowKgH = massFlowKgH - liquidProductionKgH;

    // 4. Mechanically Coupled Recompressor (Brake Booster)
    const companderShaftPowerKW = shaftPowerRecoveredKW * mechanicalEfficiency;
    const compFlowKgH = (recompressorMassFlowKgH !== undefined && recompressorMassFlowKgH > 0)
      ? recompressorMassFlowKgH
      : massFlowKgH;
    const m_dot_comp_kg_s = compFlowKgH / 3600.0;

    const compInletPressBar = recompressorInletPressureBarg !== undefined
      ? recompressorInletPressureBarg + 1.01325
      : P2_bar;
    const compInletTempK = recompressorInletTempC + 273.15;

    // Work available per kg of recompressor gas: W_comp = P_comp / m_dot
    const availableHeadKJkg = (companderShaftPowerKW * recompressorEfficiency) / m_dot_comp_kg_s;
    const availableHeadJkg = availableHeadKJkg * 1e3;

    // Recompressor pressure ratio: H = (k/(k-1)) * R_spec * T_in * [ rc^((k-1)/k) - 1 ]
    const term = (availableHeadJkg * (k - 1.0)) / (k * R_spec * compInletTempK);
    const compPressureRatio = Math.pow(1.0 + term, k / (k - 1.0));
    const compDischargePressBar = compInletPressBar * compPressureRatio;
    const compDischargeTempK = compInletTempK * Math.pow(compPressureRatio, (k - 1.0) / (k * recompressorEfficiency));

    return {
      standard: 'API 617 Part 4 Cryogenic Turboexpander-Recompressor',
      expansionPressureRatio: Math.round(expansionRatio * 100) / 100,
      inletPressureBarg,
      outletPressureBarg,
      inletTempC,
      outletTempC: Math.round(outletTempC * 10) / 10,
      isentropicEnthalpyDropKJkg: Math.round(isentropicEnthalpyDropKJkg * 10) / 10,
      actualEnthalpyDropKJkg: Math.round(actualEnthalpyDropKJkg * 10) / 10,
      shaftPowerRecoveredKW: Math.round(shaftPowerRecoveredKW * 10) / 10,
      shaftPowerRecoveredMW: Math.round(shaftPowerRecoveredMW * 100) / 100,
      isTwoPhaseExpansion: liquidCondensationFraction > 0,
      exitVaporQuality: Math.round(exitVaporQuality * 1000) / 1000,
      liquidCondensationFractionPct: Math.round(liquidCondensationFraction * 1000) / 10,
      liquidProductionKgH: Math.round(liquidProductionKgH),
      vaporFlowKgH: Math.round(vaporFlowKgH),
      recompressor: {
        powerAvailableKW: Math.round(companderShaftPowerKW * 10) / 10,
        inletPressureBarg: Math.round((compInletPressBar - 1.01325) * 100) / 100,
        dischargePressureBarg: Math.round((compDischargePressBar - 1.01325) * 100) / 100,
        pressureBoostRatio: Math.round(compPressureRatio * 100) / 100,
        dischargeTempC: Math.round((compDischargeTempK - 273.15) * 10) / 10,
        massFlowKgH: compFlowKgH
      }
    };
  }

  /**
   * Compares Turboexpander (isentropic expansion + power) vs Joule-Thomson valve (isenthalpic throttling).
   *
   * @param {Object} params
   * @param {number} params.massFlowKgH - Gas mass flow (kg/h)
   * @param {number} params.inletPressureBarg - Inlet pressure (barg)
   * @param {number} params.outletPressureBarg - Outlet pressure (barg)
   * @param {number} params.inletTempC - Inlet temperature (°C)
   * @param {number} params.molecularWeight - Gas molecular weight (kg/kmol)
   * @param {number} [params.expanderEfficiency=0.85] - Expander efficiency
   * @param {number} [params.jtCoefficientCDegPerBar=0.45] - Joule-Thomson coefficient mu_JT (°C/bar)
   * @param {number} [params.dewPointTempC=-55.0] - Dew point temperature (°C)
   * @returns {Object} Comparative analysis of cooling, liquid recovery, and energy generation
   */
  static compareWithJtValve(params) {
    const {
      massFlowKgH,
      inletPressureBarg,
      outletPressureBarg,
      inletTempC,
      molecularWeight,
      expanderEfficiency = 0.85,
      jtCoefficientCDegPerBar = 0.45,
      dewPointTempC = -55.0
    } = params;

    const expanderResult = this.evaluateTurboexpander({
      massFlowKgH,
      inletPressureBarg,
      outletPressureBarg,
      inletTempC,
      molecularWeight,
      expanderEfficiency,
      dewPointTempC
    });

    const deltaP_bar = inletPressureBarg - outletPressureBarg;
    const jtTempDropC = jtCoefficientCDegPerBar * deltaP_bar;
    const jtOutletTempC = inletTempC - jtTempDropC;

    // JT liquid recovery estimation
    let jtLiquidYieldPct = 0.0;
    if (jtOutletTempC < dewPointTempC) {
      jtLiquidYieldPct = Math.min(20.0, ((dewPointTempC - jtOutletTempC) / 380.0) * 2.2 * 100.0);
    }
    const jtLiquidProductionKgH = massFlowKgH * (jtLiquidYieldPct / 100.0);

    const expanderTempDropC = inletTempC - expanderResult.outletTempC;
    const temperatureDropAdvantageC = expanderTempDropC - jtTempDropC;
    const liquidYieldMultiplier = jtLiquidProductionKgH > 0
      ? expanderResult.liquidProductionKgH / jtLiquidProductionKgH
      : (expanderResult.liquidProductionKgH > 0 ? 99.9 : 1.0);

    return {
      inletPressureBarg,
      outletPressureBarg,
      pressureDropBar: deltaP_bar,
      inletTempC,
      turboexpander: {
        outletTempC: expanderResult.outletTempC,
        temperatureDropC: Math.round(expanderTempDropC * 10) / 10,
        shaftPowerRecoveredKW: expanderResult.shaftPowerRecoveredKW,
        liquidYieldPercent: expanderResult.liquidCondensationFractionPct,
        liquidProductionKgH: expanderResult.liquidProductionKgH
      },
      jouleThomsonValve: {
        outletTempC: Math.round(jtOutletTempC * 10) / 10,
        temperatureDropC: Math.round(jtTempDropC * 10) / 10,
        shaftPowerRecoveredKW: 0.0,
        liquidYieldPercent: Math.round(jtLiquidYieldPct * 10) / 10,
        liquidProductionKgH: Math.round(jtLiquidProductionKgH)
      },
      turboexpanderAdvantage: {
        additionalCoolingC: Math.round(temperatureDropAdvantageC * 10) / 10,
        additionalLiquidRecoveryKgH: Math.round(expanderResult.liquidProductionKgH - jtLiquidProductionKgH),
        liquidYieldMultiplier: Math.round(liquidYieldMultiplier * 10) / 10,
        powerHarvestedKW: expanderResult.shaftPowerRecoveredKW
      }
    };
  }
}

module.exports = { Turboexpander };
