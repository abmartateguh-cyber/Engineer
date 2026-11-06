/**
 * ISO 2314 Industrial & Aeroderivative Gas Turbine Driver Engine.
 *
 * Implements:
 * 1. ISO 2314 Gas Turbine Rating Library:
 *    - Heavy-Duty Industrial: Frame 6FA, Frame 7EA, Frame 9E.
 *    - High-Efficiency Aeroderivative: LM2500+G4, LM6000-PF, Trent 60.
 * 2. Site Condition Ambient Derating:
 *    - Ambient temperature derating (hot-day summer capacity vs cold-day winter boost).
 *    - Altitude and barometric pressure derating per barometric lapse equation.
 *    - Air intake filter pressure drop penalty (~1.5% power per 10 mbar inlet loss).
 *    - Exhaust backpressure loss through HRSG / silencer (~0.5% power per 10 mbar loss).
 * 3. Heat Rate, Thermal Efficiency, and Fuel Gas Consumption (LHV basis).
 * 4. Exhaust Energy Flow and Heat Recovery Steam Generator (HRSG) potential.
 * 5. LNG train helper motor / helper steam turbine sizing for peak summer deficit.
 */

'use strict';

const GAS_TURBINE_CATALOG = {
  FRAME_6FA: {
    model: 'GE Frame 6FA (6F.03)',
    type: 'Heavy-Duty Industrial',
    isoPowerMW: 77.0,
    isoHeatRateKJkWh: 9750.0,
    isoThermalEfficiencyPct: 36.9,
    exhaustFlowKgS: 215.0,
    exhaustTempC: 600.0,
    speedRpm: 5235,
    tempDerateFactorPerC: 0.0075,
    tempHeatRateFactorPerC: 0.0015
  },
  FRAME_7EA: {
    model: 'GE Frame 7EA (7E.03)',
    type: 'Heavy-Duty Industrial (60 Hz direct drive)',
    isoPowerMW: 86.0,
    isoHeatRateKJkWh: 10800.0,
    isoThermalEfficiencyPct: 33.3,
    exhaustFlowKgS: 300.0,
    exhaustTempC: 538.0,
    speedRpm: 3600,
    tempDerateFactorPerC: 0.0072,
    tempHeatRateFactorPerC: 0.0014
  },
  FRAME_9E: {
    model: 'GE Frame 9E (9E.03)',
    type: 'Heavy-Duty Industrial (50 Hz direct drive)',
    isoPowerMW: 132.0,
    isoHeatRateKJkWh: 10650.0,
    isoThermalEfficiencyPct: 33.8,
    exhaustFlowKgS: 420.0,
    exhaustTempC: 543.0,
    speedRpm: 3000,
    tempDerateFactorPerC: 0.0070,
    tempHeatRateFactorPerC: 0.0014
  },
  LM2500_PLUS_G4: {
    model: 'LM2500+G4 DLE',
    type: 'Aeroderivative High Efficiency',
    isoPowerMW: 35.3,
    isoHeatRateKJkWh: 8900.0,
    isoThermalEfficiencyPct: 40.4,
    exhaustFlowKgS: 93.0,
    exhaustTempC: 520.0,
    speedRpm: 3600,
    tempDerateFactorPerC: 0.0065,
    tempHeatRateFactorPerC: 0.0012
  },
  LM6000_PF: {
    model: 'LM6000-PF SPRINT',
    type: 'Aeroderivative High Efficiency',
    isoPowerMW: 44.5,
    isoHeatRateKJkWh: 8550.0,
    isoThermalEfficiencyPct: 42.1,
    exhaustFlowKgS: 133.0,
    exhaustTempC: 455.0,
    speedRpm: 3600,
    tempDerateFactorPerC: 0.0062,
    tempHeatRateFactorPerC: 0.0012
  },
  TRENT_60: {
    model: 'Rolls-Royce / Siemens Trent 60 DLE',
    type: 'Aeroderivative High Efficiency',
    isoPowerMW: 58.0,
    isoHeatRateKJkWh: 8500.0,
    isoThermalEfficiencyPct: 42.4,
    exhaustFlowKgS: 160.0,
    exhaustTempC: 440.0,
    speedRpm: 3000,
    tempDerateFactorPerC: 0.0060,
    tempHeatRateFactorPerC: 0.0011
  }
};

class DriverGasTurbine {
  /**
   * Retrieves available gas turbine models in catalog.
   *
   * @returns {Object} Catalog of industrial and aeroderivative models
   */
  static getGasTurbineModels() {
    return Object.keys(GAS_TURBINE_CATALOG).map(key => ({
      key,
      model: GAS_TURBINE_CATALOG[key].model,
      type: GAS_TURBINE_CATALOG[key].type,
      isoPowerMW: GAS_TURBINE_CATALOG[key].isoPowerMW,
      isoEfficiencyPct: GAS_TURBINE_CATALOG[key].isoThermalEfficiencyPct
    }));
  }

  /**
   * Evaluates gas turbine driver performance at specific site conditions.
   *
   * @param {Object} params
   * @param {string} params.modelKey - Key from GAS_TURBINE_CATALOG (e.g., 'FRAME_7EA', 'LM6000_PF')
   * @param {number} [params.ambientTempC=15.0] - Site ambient air temperature (°C)
   * @param {number} [params.siteAltitudeM=0.0] - Site altitude above sea level (m)
   * @param {number} [params.inletLossMbar=10.0] - Inlet duct and filter pressure drop (mbar)
   * @param {number} [params.exhaustLossMbar=25.0] - Exhaust duct / HRSG backpressure (mbar)
   * @param {number} [params.fuelLhvKJkg=48000.0] - Fuel gas Lower Heating Value (kJ/kg, typical pipeline NG ~48,000)
   * @returns {Object} Site available power, heat rate, fuel consumption, and exhaust stream properties
   */
  static evaluateGasTurbineDriver(params) {
    const {
      modelKey,
      ambientTempC = 15.0,
      siteAltitudeM = 0.0,
      inletLossMbar = 10.0,
      exhaustLossMbar = 25.0,
      fuelLhvKJkg = 48000.0
    } = params || {};

    if (fuelLhvKJkg <= 0) throw new Error('Fuel LHV must be positive');
    if (ambientTempC <= -273.15) throw new Error('Ambient temperature must exceed absolute zero (-273.15°C)');

    const key = (modelKey || 'LM6000_PF').toString().toUpperCase();
    const gt = GAS_TURBINE_CATALOG[key] || GAS_TURBINE_CATALOG.LM6000_PF;

    // 1. Altitude Derating via Barometric Formula
    // P_amb = P0 * (1 - 2.25577e-5 * h)^5.25588
    const altitudeFactor = Math.pow(1.0 - 2.25577e-5 * siteAltitudeM, 5.25588);
    const siteBarometricPressBar = 1.01325 * altitudeFactor;

    // 2. Ambient Temperature Derating (ISO reference = 15°C)
    const deltaT_amb = ambientTempC - 15.0;
    // Power factor: drops at deltaT > 0, rises at deltaT < 0 (capped at +14% mechanical shaft limit)
    let tempPowerFactor = 1.0 - gt.tempDerateFactorPerC * deltaT_amb;
    tempPowerFactor = Math.min(1.14, Math.max(0.60, tempPowerFactor));

    // Heat rate factor: increases on hot days
    const tempHeatRateFactor = 1.0 + gt.tempHeatRateFactorPerC * deltaT_amb;

    // 3. Inlet Loss Derating (typically ~1.5% power loss and +0.5% heat rate per 10 mbar)
    const inletPowerFactor = 1.0 - (inletLossMbar / 10.0) * 0.015;
    const inletHeatRateFactor = 1.0 + (inletLossMbar / 10.0) * 0.005;

    // 4. Exhaust Backpressure Loss Derating (typically ~0.5% power loss and +0.5% heat rate per 10 mbar)
    const exhaustPowerFactor = 1.0 - (exhaustLossMbar / 10.0) * 0.005;
    const exhaustHeatRateFactor = 1.0 + (exhaustLossMbar / 10.0) * 0.005;

    // 5. Net Site Available Shaft Power
    const totalSitePowerFactor = altitudeFactor * tempPowerFactor * inletPowerFactor * exhaustPowerFactor;
    const sitePowerMW = gt.isoPowerMW * totalSitePowerFactor;
    const sitePowerKW = sitePowerMW * 1000.0;

    // 6. Net Site Heat Rate and Thermal Efficiency
    const totalHeatRateFactor = tempHeatRateFactor * inletHeatRateFactor * exhaustHeatRateFactor;
    const siteHeatRateKJkWh = gt.isoHeatRateKJkWh * totalHeatRateFactor;
    // Thermal efficiency: eta = 3600 / HeatRate(kJ/kWh)
    const siteThermalEfficiencyPct = (3600.0 / siteHeatRateKJkWh) * 100.0;

    // 7. Fuel Gas Consumption Rate
    // Fuel energy input (kW_th) = Power (kW) * HeatRate (kJ/kWh) / 3600
    const heatInputKWth = (sitePowerKW * siteHeatRateKJkWh) / 3600.0;
    const fuelMassFlowKgS = (heatInputKWth) / fuelLhvKJkg;
    const fuelMassFlowKgH = fuelMassFlowKgS * 3600.0;

    // 8. Exhaust Gas Flow & Temperature (for HRSG Steam Generation)
    // Exhaust flow scales with ambient air density
    const airDensityRatio = altitudeFactor * (288.15 / (ambientTempC + 273.15));
    const siteExhaustFlowKgS = gt.exhaustFlowKgS * airDensityRatio;
    // Exhaust temperature rises slightly on hot days (+1.3°C per °C ambient)
    const siteExhaustTempC = gt.exhaustTempC + 1.3 * deltaT_amb;

    // HRSG Heat Recovery Potential (cooling flue gas down to 120°C stack limit, Cp_flue ~ 1.10 kJ/kg*K)
    const stackMinTempC = 120.0;
    const flueCpKJkgK = 1.10;
    let hrsgHeatDutyMWth = 0.0;
    if (siteExhaustTempC > stackMinTempC) {
      hrsgHeatDutyMWth = (siteExhaustFlowKgS * flueCpKJkgK * (siteExhaustTempC - stackMinTempC)) * 1e-3;
    }
    // High-pressure steam generation estimate (assuming steam enthalpy rise ~ 2600 kJ/kg, boiler eff ~ 88%)
    const estimatedSteamProductionTH = (hrsgHeatDutyMWth * 1000.0 * 0.88 / 2600.0) * 3.6;

    return {
      standard: 'ISO 2314 Gas Turbine Evaluation',
      model: gt.model,
      type: gt.type,
      operatingSpeedRpm: gt.speedRpm,
      siteConditions: {
        ambientTempC,
        siteAltitudeM,
        barometricPressureBar: Math.round(siteBarometricPressBar * 1000) / 1000,
        inletLossMbar,
        exhaustLossMbar
      },
      deratingFactors: {
        ambientTempFactor: Math.round(tempPowerFactor * 1000) / 1000,
        altitudeFactor: Math.round(altitudeFactor * 1000) / 1000,
        inletLossFactor: Math.round(inletPowerFactor * 1000) / 1000,
        exhaustLossFactor: Math.round(exhaustPowerFactor * 1000) / 1000,
        netPowerDerateRatio: Math.round(totalSitePowerFactor * 1000) / 1000
      },
      powerAndEfficiency: {
        isoRatingMW: gt.isoPowerMW,
        siteAvailablePowerMW: Math.round(sitePowerMW * 100) / 100,
        siteAvailablePowerKW: Math.round(sitePowerKW),
        siteHeatRateKJkWh: Math.round(siteHeatRateKJkWh),
        siteThermalEfficiencyPct: Math.round(siteThermalEfficiencyPct * 10) / 10,
        fuelConsumptionKgH: Math.round(fuelMassFlowKgH),
        fuelConsumptionTPD: Math.round((fuelMassFlowKgH * 24.0 / 1000.0) * 10) / 10
      },
      exhaustEnergy: {
        exhaustMassFlowKgS: Math.round(siteExhaustFlowKgS * 10) / 10,
        exhaustTempC: Math.round(siteExhaustTempC * 10) / 10,
        hrsgAvailableHeatMWth: Math.round(hrsgHeatDutyMWth * 10) / 10,
        estimatedSteamProductionTH: Math.round(estimatedSteamProductionTH * 10) / 10
      }
    };
  }

  /**
   * Sizes a helper driver (electric motor or steam turbine) to cover summer ambient power deficit.
   *
   * @param {Object} params
   * @param {string} params.modelKey - Gas turbine model
   * @param {number} params.compressorShaftPowerDemandMW - Required power of driven compressor train (MW)
   * @param {number} [params.summerDesignAmbientTempC=42.0] - Maximum design summer ambient temperature (°C)
   * @param {number} [params.siteAltitudeM=0.0] - Site altitude (m)
   * @param {number} [params.designMarginPercent=10.0] - Safety margin on helper driver (%)
   * @returns {Object} Sized helper driver power rating and operating strategy
   */
  static sizeHelperDriver(params) {
    const {
      modelKey,
      compressorShaftPowerDemandMW,
      summerDesignAmbientTempC = 42.0,
      siteAltitudeM = 0.0,
      designMarginPercent = 10.0
    } = params || {};

    if (!compressorShaftPowerDemandMW || compressorShaftPowerDemandMW <= 0) {
      throw new Error('Compressor shaft power demand must be positive');
    }

    const gtSummer = this.evaluateGasTurbineDriver({
      modelKey,
      ambientTempC: summerDesignAmbientTempC,
      siteAltitudeM
    });

    const gtSummerPowerMW = gtSummer.powerAndEfficiency.siteAvailablePowerMW;
    const powerDeficitMW = compressorShaftPowerDemandMW - gtSummerPowerMW;

    let helperRequired = false;
    let helperRatingMW = 0.0;

    if (powerDeficitMW > 0) {
      helperRequired = true;
      helperRatingMW = powerDeficitMW * (1.0 + designMarginPercent / 100.0);
    }

    return {
      compressorShaftPowerDemandMW,
      summerDesignAmbientTempC,
      gasTurbineSummerAvailableMW: gtSummerPowerMW,
      powerDeficitMW: Math.round(Math.max(0.0, powerDeficitMW) * 100) / 100,
      helperDriverRequired: helperRequired,
      recommendedHelperRatingMW: Math.round(helperRatingMW * 100) / 100,
      recommendation: helperRequired
        ? `Install ${Math.round(helperRatingMW * 10) / 10} MW helper electric motor / steam turbine to maintain full plant production during summer peak.`
        : 'Gas turbine site rating covers compressor demand across all ambient design temperatures without helper.'
    };
  }
}

module.exports = { DriverGasTurbine, GAS_TURBINE_CATALOG };
