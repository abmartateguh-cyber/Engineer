/**
 * API 672 / API 617 Part 3 Integrally Geared Centrifugal Compressor Engine.
 *
 * Implements:
 * 1. Multi-pinion integrally geared compressor train mechanics (bull gear + high-speed pinions).
 * 2. Stage-by-stage aerodynamic and thermodynamic path calculation:
 *    - Optimum pinion speed scaling per stage.
 *    - Intercooler heat duty, pressure loss, and condensate knockout.
 * 3. Impeller geometry estimation (tip speed u2, impeller diameter D2, head coefficient).
 * 4. Inlet Guide Vane (IGV) pre-whirl aerodynamics (-20° to +30° turndown).
 * 5. IGV vs Suction Throttle Valve (STV) power savings comparison.
 * 6. Gearbox mesh and high-speed tilting pad bearing mechanical loss evaluation.
 */

'use strict';

const R_UNIVERSAL = 8.314472; // J/(mol*K)

class CompressorIntegrallyGearedApi672 {
  /**
   * Evaluates a multi-stage integrally geared compressor per API 672 / API 617 Part 3.
   *
   * @param {Object} params
   * @param {number} params.massFlowKgH - Gas mass flow rate (kg/h)
   * @param {number} params.suctionPressureBarg - First stage inlet pressure (barg)
   * @param {number} params.targetDischargePressureBarg - Final stage discharge pressure (barg)
   * @param {number} params.suctionTempC - First stage suction temperature (°C)
   * @param {number} params.molecularWeight - Gas molecular weight (kg/kmol)
   * @param {number} [params.specificHeatRatioGamma=1.40] - k = Cp/Cv (1.40 for air/N2, 1.25-1.35 for gas)
   * @param {number} [params.driverSpeedRpm=1500] - Bull gear input speed (e.g., 1500 or 1800 rpm)
   * @param {number} [params.stageCount=3] - Number of centrifugal stages (typically 2 to 6)
   * @param {number} [params.intercoolerApproachTempC=35.0] - Gas exit temp after each intercooler (°C)
   * @param {number} [params.intercoolerDeltaPBar=0.15] - Pressure drop across each intercooler (bar)
   * @param {number} [params.stagePolytropicEfficiency=0.84] - Base polytropic efficiency per stage
   * @param {Array<number>} [params.pinionSpeedsRpm] - Custom pinion speeds per stage (or auto-calculated)
   * @returns {Object} Stage-by-stage thermodynamic, mechanical, and intercooler report
   */
  static evaluateIntegrallyGearedCompressor(params) {
    const {
      massFlowKgH,
      suctionPressureBarg,
      targetDischargePressureBarg,
      suctionTempC,
      molecularWeight,
      specificHeatRatioGamma = 1.40,
      driverSpeedRpm = 1500,
      stageCount = 3,
      intercoolerApproachTempC = 35.0,
      intercoolerDeltaPBar = 0.15,
      stagePolytropicEfficiency = 0.84,
      pinionSpeedsRpm
    } = params;

    if (massFlowKgH <= 0) throw new Error('Mass flow must be positive');
    if (stageCount < 1 || stageCount > 8) throw new Error('Stage count must be between 1 and 8');
    if (molecularWeight <= 0) throw new Error('Molecular weight must be positive');
    if (specificHeatRatioGamma <= 1.0) throw new Error('Specific heat ratio gamma must exceed 1.0');
    if (driverSpeedRpm <= 0) throw new Error('Driver speed must be positive');
    if (stagePolytropicEfficiency <= 0 || stagePolytropicEfficiency > 1.0) {
      throw new Error('Stage polytropic efficiency must be between 0 and 1.0');
    }

    const P_in_bar = suctionPressureBarg + 1.01325;
    const P_out_bar = targetDischargePressureBarg + 1.01325;
    if (P_out_bar <= P_in_bar) throw new Error('Target discharge pressure must exceed suction pressure');

    const k = specificHeatRatioGamma;
    const eta_p = stagePolytropicEfficiency;
    const R_spec = (R_UNIVERSAL * 1000.0) / molecularWeight;
    const Cp = (k * R_spec) / (k - 1.0); // J/(kg*K)
    const m_dot_kg_s = massFlowKgH / 3600.0;
    const polyExponent_m = (k - 1.0) / (k * eta_p);

    // Numerically solve for balanced stage pressure ratio across all stages
    let lowRc = 1.001;
    let highRc = Math.max(2.5, (P_out_bar + (stageCount - 1) * intercoolerDeltaPBar * 2.0) / P_in_bar);
    for (let iter = 0; iter < 30; iter++) {
      const midRc = (lowRc + highRc) / 2.0;
      let pSim = P_in_bar;
      for (let s = 1; s <= stageCount; s++) {
        pSim = pSim * midRc;
        if (s < stageCount) {
          pSim = Math.max(0.01, pSim - intercoolerDeltaPBar);
        }
      }
      if (pSim < P_out_bar) lowRc = midRc;
      else highRc = midRc;
    }
    const balancedStageRatio = (lowRc + highRc) / 2.0;

    // Auto-generate realistic high-speed pinion speeds if not explicitly provided
    // Integrally geared compressors optimize specific speed Ns by running higher RPM on later stages
    // as volumetric flow shrinks!
    const defaultPinionSpeeds = [];
    for (let i = 0; i < stageCount; i++) {
      // Stage 1: e.g. 18,000 rpm -> Stage 4: e.g. 36,000 rpm
      const speedFactor = 1.0 + (i / Math.max(1, stageCount - 1)) * 0.75;
      const speed = Math.round((20000.0 * speedFactor) / 100) * 100;
      defaultPinionSpeeds.push(speed);
    }
    const speeds = pinionSpeedsRpm && pinionSpeedsRpm.length === stageCount
      ? pinionSpeedsRpm
      : defaultPinionSpeeds;

    let currentPinBar = P_in_bar;
    let currentTinC = suctionTempC;
    let totalGasPowerKW = 0.0;
    let totalIntercoolerDutyKW = 0.0;
    const stages = [];

    for (let s = 1; s <= stageCount; s++) {
      const stageIdx = s - 1;
      const N_rpm = speeds[stageIdx];
      const gearRatio = N_rpm / driverSpeedRpm;

      // Stage pressure ratio: final stage ensures exact discharge match
      let stageRatio = balancedStageRatio;
      if (s === stageCount) {
        stageRatio = Math.max(1.001, P_out_bar / currentPinBar);
      }

      const P_stage_out_bar = currentPinBar * stageRatio;
      const T_in_K = currentTinC + 273.15;
      const T_out_K = T_in_K * Math.pow(stageRatio, polyExponent_m);
      const T_out_C = T_out_K - 273.15;

      // Schulz / Polytropic Head: H_poly = R_spec * T_in * (1/m) * [ (P2/P1)^m - 1 ]
      const H_poly_J_kg = R_spec * T_in_K * (1.0 / polyExponent_m) * (Math.pow(stageRatio, polyExponent_m) - 1.0);
      const H_poly_kJ_kg = H_poly_J_kg * 1e-3;

      // Stage Gas Power: P_stage = m_dot * H_poly / eta_p (kW)
      const stageGasPowerKW = (m_dot_kg_s * H_poly_kJ_kg) / eta_p;
      totalGasPowerKW += stageGasPowerKW;

      // Aerodynamic Impeller Sizing (head coefficient mu_0 approx 0.52 for backward-leaning blades)
      const headCoeff = 0.52;
      const u2_m_s = Math.sqrt(H_poly_J_kg / headCoeff); // Impeller tip speed (m/s)
      const D2_m = (60.0 * u2_m_s) / (Math.PI * N_rpm); // Tip diameter (m)
      const D2_mm = D2_m * 1000.0;

      // Suction volumetric flow at stage eye
      const rho_in = (currentPinBar * 1e5) / (R_spec * T_in_K);
      const stageVolFlowM3H = massFlowKgH / rho_in;

      // Intercooler between stages
      let coolerDutyKW = 0.0;
      let nextPinBar = P_stage_out_bar;
      let nextTinC = currentTinC;

      if (s < stageCount) {
        if (T_out_C > intercoolerApproachTempC) {
          coolerDutyKW = (m_dot_kg_s * Cp * (T_out_C - intercoolerApproachTempC)) * 1e-3;
          totalIntercoolerDutyKW += coolerDutyKW;
          nextTinC = intercoolerApproachTempC;
        } else {
          coolerDutyKW = 0.0;
          nextTinC = T_out_C;
        }
        nextPinBar = Math.max(0.01, P_stage_out_bar - intercoolerDeltaPBar);
      }

      stages.push({
        stageNumber: s,
        pinionSpeedRpm: N_rpm,
        gearRatioToBullGear: Math.round(gearRatio * 100) / 100,
        inletPressureBarg: Math.round((currentPinBar - 1.01325) * 100) / 100,
        dischargePressureBarg: Math.round((P_stage_out_bar - 1.01325) * 100) / 100,
        stagePressureRatio: Math.round(stageRatio * 100) / 100,
        inletTempC: Math.round(currentTinC * 10) / 10,
        dischargeTempC: Math.round(T_out_C * 10) / 10,
        polytropicHeadKJkg: Math.round(H_poly_kJ_kg * 10) / 10,
        stageGasPowerKW: Math.round(stageGasPowerKW * 10) / 10,
        inletVolumeFlowM3H: Math.round(stageVolFlowM3H * 10) / 10,
        impellerTipSpeedMS: Math.round(u2_m_s * 10) / 10,
        impellerDiameterMm: Math.round(D2_mm * 10) / 10,
        intercoolerDutyKW: Math.round(coolerDutyKW * 10) / 10
      });

      currentPinBar = nextPinBar;
      currentTinC = nextTinC;
    }

    // Gearbox and Mechanical Losses per API 672:
    // Gear tooth mesh losses (~1.2% per mesh) + high-speed pinion bearings + bull gear bearings + seals
    const gearMeshes = Math.ceil(stageCount / 2.0); // usually 2 impellers per pinion shaft
    const gearMeshLossKW = totalGasPowerKW * 0.012 * gearMeshes;
    const bearingAndSealLossKW = Math.max(25.0, 0.018 * totalGasPowerKW);
    const totalMechanicalLossKW = gearMeshLossKW + bearingAndSealLossKW;
    const totalShaftPowerKW = totalGasPowerKW + totalMechanicalLossKW;

    // Cooling water requirement (assumed deltaT_water = 10°C, Cp_water = 4.184 kJ/kg*K)
    const coolingWaterM3H = (totalIntercoolerDutyKW / (4.184 * 10.0)) * (3600.0 / 1000.0);

    return {
      standard: 'API 672 / API 617 Part 3',
      casingArchitecture: 'Integrally Geared Multi-Pinion Centrifugal',
      stageCount,
      driverSpeedRpm,
      pinionShaftCount: Math.ceil(stageCount / 2),
      overallPressureRatio: Math.round((P_out_bar / P_in_bar) * 100) / 100,
      totalPolytropicGasPowerKW: Math.round(totalGasPowerKW * 10) / 10,
      mechanicalGearLossKW: Math.round(totalMechanicalLossKW * 10) / 10,
      totalShaftPowerKW: Math.round(totalShaftPowerKW * 10) / 10,
      totalShaftPowerMW: Math.round((totalShaftPowerKW * 1e-3) * 100) / 100,
      totalIntercoolerDutyKW: Math.round(totalIntercoolerDutyKW * 10) / 10,
      coolingWaterDemandM3H: Math.round(coolingWaterM3H * 10) / 10,
      stages
    };
  }

  /**
   * Evaluates Inlet Guide Vane (IGV) pre-whirl aerodynamic turndown (-20° to +30°).
   *
   * @param {Object} params
   * @param {number} params.ratedMassFlowKgH - Design mass flow at 0° IGV (kg/h)
   * @param {number} params.ratedShaftPowerKW - Design shaft power at 0° IGV (kW)
   * @param {number} params.igvAngleDegrees - Vane angle in degrees (-20° = open/overboost, +30° = closed/turndown)
   * @returns {Object} IGV performance, modulation factor, and energy comparison vs suction throttle
   */
  static evaluateIgvTurndown(params) {
    const {
      ratedMassFlowKgH,
      ratedShaftPowerKW,
      igvAngleDegrees
    } = params;

    if (ratedMassFlowKgH <= 0 || ratedShaftPowerKW <= 0) {
      throw new Error('Rated mass flow and shaft power must be positive');
    }

    // Constrain IGV angle within standard operational range (-20° to +30°)
    const angle = Math.max(-20.0, Math.min(30.0, igvAngleDegrees));

    // Aerodynamic pre-whirl Euler relation:
    // Positive angle introduces co-rotational swirl -> reduces Euler work with high isentropic efficiency
    // Negative angle introduces counter-rotational swirl -> increases head and flow capacity
    // Empirical slope: ~1.1% flow modulation per degree
    const flowModulationRatio = 1.0 - 0.011 * angle;
    const actualFlowKgH = ratedMassFlowKgH * flowModulationRatio;

    // Power modulation with IGV: aerodynamic work decreases smoothly without severe throttling loss
    // Part-load efficiency factor
    const igvPowerRatio = Math.pow(flowModulationRatio, 0.88);
    const igvPowerKW = ratedShaftPowerKW * igvPowerRatio;

    // Comparison: Suction Throttle Valve (STV)
    // Throttling valve creates pressure drop, forcing compressor to maintain higher internal compression ratio
    // STV power drops much more slowly: P_stv ~ 0.35 + 0.65 * flowRatio
    const stvPowerRatio = 0.35 + 0.65 * flowModulationRatio;
    const stvPowerKW = ratedShaftPowerKW * stvPowerRatio;

    const powerSavedWithIgvKW = Math.max(0.0, stvPowerKW - igvPowerKW);
    const savingsPercentVsThrottle = stvPowerKW > 0 ? (powerSavedWithIgvKW / stvPowerKW) * 100.0 : 0.0;

    return {
      igvAngleDegrees: angle,
      flowModulationPercent: Math.round(flowModulationRatio * 1000) / 10,
      actualMassFlowKgH: Math.round(actualFlowKgH),
      igvShaftPowerKW: Math.round(igvPowerKW * 10) / 10,
      suctionThrottlePowerKW: Math.round(stvPowerKW * 10) / 10,
      powerSavedKW: Math.round(powerSavedWithIgvKW * 10) / 10,
      savingsPercentVsThrottle: Math.round(savingsPercentVsThrottle * 10) / 10,
      operationMode: angle < 0 ? 'Overboost (Counter-swirl)' : (angle === 0 ? 'Rated Neutral' : 'Turndown (Co-swirl)')
    };
  }
}

module.exports = { CompressorIntegrallyGearedApi672 };
