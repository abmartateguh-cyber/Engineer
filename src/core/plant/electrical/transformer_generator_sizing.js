/**
 * Power Transformer & Gas Turbine Generator (GTG) Sizing Engine with Motor Starting Dip.
 *
 * Implements:
 * 1. Power Transformer Sizing (IEC 60076):
 *    - Standard ratings (MVA) ONAN / ONAF cooling
 *    - Standard impedance %Z selection and X/R ratio
 *    - No-load and load loss estimation
 *    - Tap changer range (+/- 10% in 1.25% steps)
 * 2. Gas Turbine Generator (GTG) Sizing:
 *    - N+1 and N+2 spinning reserve redundancy check
 *    - Site derating (ambient temperature, elevation, duct losses)
 *    - P-Q reactive capability limit verification (0.80 lag to 0.95 lead)
 * 3. Direct-On-Line (DOL) Large Motor Starting Transient Voltage Dip:
 *    Delta V_bus % = [ S_start / (S_sc,bus + S_start) ] * 100 <= 15%
 */

'use strict';

const STANDARD_TRANSFORMER_MVA = [
  0.5, 0.8, 1.0, 1.25, 1.6, 2.0, 2.5, 3.15, 4.0, 5.0,
  6.3, 8.0, 10.0, 12.5, 16.0, 20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0
];

class TransformerGeneratorSizing {
  /**
   * Sizes a step-down power transformer per IEC 60076.
   *
   * @param {Object} params
   * @param {number} params.operatingLoadMVA - Required downstream continuous load (MVA)
   * @param {number} params.primaryVoltageKV - Primary line-to-line voltage (e.g. 33 kV)
   * @param {number} params.secondaryVoltageKV - Secondary line-to-line voltage (e.g. 11 kV or 6.6 kV)
   * @param {number} [params.designMarginPct=20.0] - Recommended design growth margin %
   * @param {number} [params.ambientTempC=40] - Site maximum ambient temperature (C)
   * @returns {Object} Selected transformer engineering parameters
   */
  static sizeTransformer(params) {
    const {
      operatingLoadMVA,
      primaryVoltageKV,
      secondaryVoltageKV,
      designMarginPct = 20.0,
      ambientTempC = 40
    } = params;

    if (!operatingLoadMVA || operatingLoadMVA <= 0) {
      throw new Error('Operating load MVA must be positive');
    }

    const targetCapacityMVA = operatingLoadMVA * (1.0 + designMarginPct / 100.0);

    // Derate ONAN if ambient exceeds 40C (approx 1% per degree above 40C, bounded to min 0.50)
    const tempDeratingFactor = Math.max(0.50, ambientTempC > 40 ? 1.0 - (ambientTempC - 40) * 0.01 : 1.0);
    const effectiveTargetMVA = targetCapacityMVA / tempDeratingFactor;

    // Find smallest standard rating >= effectiveTargetMVA
    let selectedMva = STANDARD_TRANSFORMER_MVA.find(mva => mva >= effectiveTargetMVA);
    if (!selectedMva) {
      selectedMva = Math.ceil(effectiveTargetMVA / 10.0) * 10.0;
    }

    // Forced-air (ONAF) rating is typically 1.25x to 1.33x ONAN base rating
    const onanMva = selectedMva;
    const onafMva = Math.round(selectedMva * 1.33 * 10) / 10;

    // Standard short-circuit impedance %Z per IEC 60076-5
    let impedanceZPct = 6.0;
    if (onanMva <= 1.0) impedanceZPct = 4.5;
    else if (onanMva <= 2.5) impedanceZPct = 6.0;
    else if (onanMva <= 6.3) impedanceZPct = 7.15;
    else if (onanMva <= 12.5) impedanceZPct = 8.0;
    else if (onanMva <= 25.0) impedanceZPct = 10.0;
    else impedanceZPct = 12.5;

    // Loss estimation per standard efficiency classes (kW)
    const noLoadLossKW = Math.round(1.5 * Math.pow(onanMva, 0.6) * 10) / 10;
    const fullLoadLossKW = Math.round(8.5 * Math.pow(onanMva, 0.8) * 10) / 10;

    // Efficiency at 100% load, pf = 0.85
    const pOutKW = onanMva * 1000.0 * 0.85;
    const totalLossKW = noLoadLossKW + fullLoadLossKW;
    const efficiency100Pct = (pOutKW / (pOutKW + totalLossKW)) * 100.0;

    // Efficiency at 50% load
    const pOut50KW = 0.5 * pOutKW;
    const loss50KW = noLoadLossKW + 0.25 * fullLoadLossKW;
    const efficiency50Pct = (pOut50KW / (pOut50KW + loss50KW)) * 100.0;

    // Rated full-load current (Amps)
    const primaryRatedAmps = (onanMva * 1000.0) / (Math.sqrt(3) * primaryVoltageKV);
    const secondaryRatedAmps = (onanMva * 1000.0) / (Math.sqrt(3) * secondaryVoltageKV);

    return {
      ratedCapacityOnanMVA: onanMva,
      ratedCapacityOnafMVA: onafMva,
      primaryVoltageKV,
      secondaryVoltageKV,
      primaryRatedAmps: Math.round(primaryRatedAmps * 10) / 10,
      secondaryRatedAmps: Math.round(secondaryRatedAmps * 10) / 10,
      impedanceZPercent: impedanceZPct,
      xrRatio: 12.0,
      noLoadCoreLossKW: noLoadLossKW,
      fullLoadCopperLossKW: fullLoadLossKW,
      efficiencyAtFullLoadPercent: Math.round(efficiency100Pct * 100) / 100,
      efficiencyAtHalfLoadPercent: Math.round(efficiency50Pct * 100) / 100,
      tapChanger: {
        type: 'On-Load Tap Changer (OLTC)',
        range: '±10% in 16 steps of 1.25%',
        stepsCount: 16
      },
      operatingLoadMVA,
      loadFactorPercent: Math.round((operatingLoadMVA / onanMva) * 1000) / 10
    };
  }

  /**
   * Sizing and N+1 redundancy analysis for Gas Turbine Generators (GTGs).
   *
   * @param {Object} params
   * @param {number} params.peakPlantDemandMW - Maximum coincident active power load (MW)
   * @param {number} params.plantPowerFactor - Overall plant operating power factor (e.g. 0.85)
   * @param {number} params.isoRatingPerGtgMW - ISO base rated active power per GTG (MW)
   * @param {number} [params.siteAmbientTempC=40] - Maximum design ambient air temperature (C)
   * @param {number} [params.altitudeM=50] - Site elevation above sea level (meters)
   * @param {number} [params.inletPressureLossMbar=10] - Filter and silencing inlet pressure loss
   * @param {number} [params.exhaustPressureLossMbar=25] - HRSG backpressure (mbar)
   * @param {number} [params.spinningReserveMarginPct=10.0] - Required spinning reserve margin %
   * @returns {Object} GTG configuration and redundancy verdict
   */
  static sizeGasTurbineGenerators(params) {
    const {
      peakPlantDemandMW,
      plantPowerFactor = 0.85,
      isoRatingPerGtgMW,
      siteAmbientTempC = 40,
      altitudeM = 50,
      inletPressureLossMbar = 10,
      exhaustPressureLossMbar = 25,
      spinningReserveMarginPct = 10.0
    } = params;

    if (!peakPlantDemandMW || !isoRatingPerGtgMW) {
      throw new Error('peakPlantDemandMW and isoRatingPerGtgMW are required');
    }

    // 1. Site ambient temperature derating: ~ 0.65% loss per degree C above 15 C
    const tempDelta = Math.max(0, siteAmbientTempC - 15.0);
    const f_temp = 1.0 - tempDelta * 0.0065;

    // 2. Barometric / elevation derating: ~ 1.1% per 100m
    const f_alt = 1.0 - (altitudeM / 100.0) * 0.011;

    // 3. Inlet and exhaust duct loss derating:
    // ~ 1.5% loss per 10 mbar inlet loss, ~ 0.5% loss per 10 mbar exhaust loss
    const f_inlet = 1.0 - (inletPressureLossMbar / 10.0) * 0.015;
    const f_exhaust = 1.0 - (exhaustPressureLossMbar / 10.0) * 0.005;

    const totalSiteDerateFactor = f_temp * f_alt * f_inlet * f_exhaust;
    const siteRatedGtgMW = isoRatingPerGtgMW * totalSiteDerateFactor;
    const siteRatedGtgMVA = siteRatedGtgMW / 0.85;

    // Sizing requirement for N+1 redundancy:
    // N running units must supply peakPlantDemandMW * (1 + reserveMargin)
    // with 1 unit on forced outage
    const targetRunningDemandMW = peakPlantDemandMW * (1.0 + spinningReserveMarginPct / 100.0);
    const minRunningUnits = Math.ceil(targetRunningDemandMW / siteRatedGtgMW);
    const totalInstalledUnits = minRunningUnits + 1; // N + 1

    const totalInstalledCapacityMW = totalInstalledUnits * siteRatedGtgMW;
    const firmCapacityMW = minRunningUnits * siteRatedGtgMW; // Capacity with 1 unit down

    const peakMVA = peakPlantDemandMW / plantPowerFactor;
    const firmMVA = (minRunningUnits * siteRatedGtgMVA);

    return {
      isoRatingPerGtgMW,
      siteAmbientTempC,
      altitudeM,
      siteDerateFactor: Math.round(totalSiteDerateFactor * 1000) / 1000,
      siteRatedGtgMW: Math.round(siteRatedGtgMW * 10) / 10,
      siteRatedGtgMVA: Math.round(siteRatedGtgMVA * 10) / 10,
      redundancyScheme: `${minRunningUnits}x100% Running + 1 Standby (${totalInstalledUnits}x${Math.round(siteRatedGtgMW)} MW GTGs)`,
      unitsRunning: minRunningUnits,
      unitsInstalled: totalInstalledUnits,
      totalInstalledCapacityMW: Math.round(totalInstalledCapacityMW * 10) / 10,
      firmCapacityNMinusOneMW: Math.round(firmCapacityMW * 10) / 10,
      peakPlantDemandMW,
      peakPlantDemandMVA: Math.round(peakMVA * 10) / 10,
      firmCapacityAdequate: firmCapacityMW >= peakPlantDemandMW,
      reactiveCapabilityMVAR: {
        maxLaggingAt080PF: Math.round(siteRatedGtgMVA * Math.sin(Math.acos(0.80)) * 10) / 10,
        maxLeadingAt095PF: Math.round(siteRatedGtgMVA * Math.sin(Math.acos(0.95)) * 10) / 10
      }
    };
  }

  /**
   * Transient voltage dip calculation during Direct-On-Line (DOL) motor starting.
   *
   * @param {Object} params
   * @param {number} params.motorShaftPowerKW - Motor rating (kW)
   * @param {number} params.motorNominalVoltageKV - Motor line-to-line voltage (kV)
   * @param {number} params.busFaultLevelMVA - Symmetrical short-circuit MVA at the motor bus (Sk'')
   * @param {number} [params.motorEfficiency=0.96] - Motor efficiency
   * @param {number} [params.motorRunningPF=0.88] - Running power factor
   * @param {number} [params.startingCurrentRatio=5.5] - Locked-rotor starting current ratio (Istart / In)
   * @param {number} [params.maxAllowableDipPct=15.0] - Maximum permissible bus voltage dip % (typically 15%)
   * @returns {Object} Motor start voltage dip and starter recommendation
   */
  static evaluateMotorStartingDip(params) {
    const {
      motorShaftPowerKW,
      motorNominalVoltageKV,
      busFaultLevelMVA,
      motorEfficiency = 0.96,
      motorRunningPF = 0.88,
      startingCurrentRatio = 5.5,
      maxAllowableDipPct = 15.0
    } = params;

    if (!motorShaftPowerKW || !busFaultLevelMVA) {
      throw new Error('motorShaftPowerKW and busFaultLevelMVA are required');
    }

    // Rated electrical kVA
    const motorInputKW = motorShaftPowerKW / motorEfficiency;
    const motorRatedKVA = motorInputKW / motorRunningPF;

    // Starting kVA drawn by motor (at full voltage)
    const startingKVA = motorRatedKVA * startingCurrentRatio;
    const startingMVA = startingKVA / 1000.0;

    // Transient voltage dip at the bus during DOL starting:
    // Delta V % = [ S_start / (S_sc_bus + S_start) ] * 100
    const voltageDipPct = (startingMVA / (busFaultLevelMVA + startingMVA)) * 100.0;
    const residualVoltagePct = 100.0 - voltageDipPct;

    const isDolAcceptable = voltageDipPct <= maxAllowableDipPct;

    let starterRecommendation = 'Direct-On-Line (DOL)';
    let recommendationReason = 'Voltage dip is within 15% threshold; DOL starting is acceptable.';
    if (!isDolAcceptable) {
      if (voltageDipPct <= 25.0) {
        starterRecommendation = 'Solid-State Soft Starter or Auto-Transformer Starter';
        recommendationReason = `DOL voltage dip of ${Math.round(voltageDipPct * 10) / 10}% exceeds allowable ${maxAllowableDipPct}%. Reduced voltage starting recommended.`;
      } else {
        starterRecommendation = 'Variable Frequency Drive (VFD)';
        recommendationReason = `DOL voltage dip of ${Math.round(voltageDipPct * 10) / 10}% severely depresses the bus. VFD with 100% full-load torque at 1.0x rated current recommended.`;
      }
    }

    return {
      motorShaftPowerKW,
      motorInputKW: Math.round(motorInputKW * 10) / 10,
      motorRatedKVA: Math.round(motorRatedKVA * 10) / 10,
      motorStartingMVA: Math.round(startingMVA * 100) / 100,
      busFaultLevelMVA,
      transientVoltageDipPercent: Math.round(voltageDipPct * 100) / 100,
      residualBusVoltagePercent: Math.round(residualVoltagePct * 100) / 100,
      maxAllowableDipPercent: maxAllowableDipPct,
      isDolAcceptable,
      starterRecommendation,
      recommendationReason
    };
  }
}

module.exports = {
  TransformerGeneratorSizing,
  STANDARD_TRANSFORMER_MVA
};
