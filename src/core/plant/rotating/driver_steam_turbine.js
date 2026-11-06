/**
 * API 612 Special-Purpose Steam Turbine Driver Engine.
 *
 * Implements:
 * 1. API 612 Steam Turbine Configurations:
 *    - Backpressure (Non-Condensing) discharging to process steam headers.
 *    - Surface Condensing operating under vacuum (e.g. 0.05 to 0.12 bara).
 *    - Controlled Extraction Condensing for combined power and process heat.
 * 2. Thermodynamic Path Integration & Steam Rates:
 *    - Isentropic enthalpy drop delta_h_s.
 *    - Theoretical Steam Rate (TSR) in kg/kWh.
 *    - Actual Steam Rate (ASR) in kg/kWh.
 *    - Turbine internal isentropic efficiency and mechanical bearing loss.
 * 3. Willans Line Part-Load Steam Consumption Modeling:
 *    - F(P) = F0 + S * P characteristic curve.
 * 4. Exhaust Steam Quality & API 612 Moisture Erosion Limit Check (y <= 12-14%).
 * 5. Surface Condenser Heat Rejection Duty and Cooling Water Demand.
 */

'use strict';

const path = require('path');
let IAPWS_IF97;
try {
  IAPWS_IF97 = require('../iapws_if97').IAPWS_IF97;
} catch {
  IAPWS_IF97 = null;
}

class DriverSteamTurbine {
  /**
   * Helper to evaluate steam enthalpy and entropy at given P and T.
   *
   * @param {number} pressureBarA - Absolute pressure (bar)
   * @param {number} tempC - Temperature (°C)
   * @returns {Object} Specific enthalpy (kJ/kg) and entropy (kJ/kg*K)
   */
  static getSteamProperties(pressureBarA, tempC) {
    const P_Pa = pressureBarA * 1e5;
    const T_K = tempC + 273.15;

    if (IAPWS_IF97) {
      try {
        const props = IAPWS_IF97.calculateProperties(P_Pa, T_K);
        return {
          enthalpyKJkg: props.specificEnthalpy_J_kg * 1e-3,
          entropyKJkgK: props.specificEntropy_J_kg_K * 1e-3
        };
      } catch {
        // Fall through to empirical formulation if state boundary reached
      }
    }

    // High-accuracy superheated steam Mollier correlation
    // h = 2501.0 + 1.98 * T + 0.045 * P_bar - 0.00012 * P_bar * T
    const h = 2501.0 + 1.95 * tempC + 0.045 * pressureBarA - 0.00012 * pressureBarA * tempC;
    // s = 6.80 + 0.0042 * tempC - 0.46 * ln(P_bar)
    const s = 6.80 + 0.0042 * tempC - 0.46 * Math.log(Math.max(0.01, pressureBarA));

    return { enthalpyKJkg: h, entropyKJkgK: s };
  }

  /**
   * Evaluates API 612 steam turbine driver performance and steam consumption.
   *
   * @param {Object} params
   * @param {number} params.inletPressureBarg - Throttle steam pressure (barg)
   * @param {number} params.inletTempC - Throttle steam temperature (°C)
   * @param {number} [params.exhaustPressureBarg] - Backpressure at exhaust flange (barg, for backpressure turbine)
   * @param {number} [params.exhaustPressureBara] - Vacuum pressure at exhaust flange (bara, for condensing turbine)
   * @param {number} params.shaftPowerKW - Mechanical power delivered to driven machine (kW)
   * @param {number} [params.internalEfficiency=0.78] - Turbine isentropic / internal efficiency (0.70-0.85)
   * @param {number} [params.mechanicalEfficiency=0.98] - Mechanical bearing & windage efficiency
   * @param {string} [params.turbineType='BACKPRESSURE'] - 'BACKPRESSURE', 'CONDENSING', 'EXTRACTION_CONDENSING'
   * @param {number} [params.extractionPressureBarg] - Extraction header pressure (barg, if extraction)
   * @param {number} [params.extractionFlowKgH=0.0] - Extraction steam flow rate (kg/h)
   * @returns {Object} Comprehensive steam rates, steam flow rate, exhaust quality, and condenser duty
   */
  static evaluateSteamTurbine(params) {
    const {
      inletPressureBarg,
      inletTempC,
      exhaustPressureBarg,
      exhaustPressureBara,
      shaftPowerKW,
      internalEfficiency = 0.78,
      mechanicalEfficiency = 0.98,
      turbineType = 'BACKPRESSURE',
      extractionPressureBarg,
      extractionFlowKgH = 0.0
    } = params;

    if (shaftPowerKW <= 0) throw new Error('Shaft power must be positive');
    if (internalEfficiency <= 0 || internalEfficiency > 1.0) {
      throw new Error('Internal efficiency must be between 0 and 1.0');
    }
    if (mechanicalEfficiency <= 0 || mechanicalEfficiency > 1.0) {
      throw new Error('Mechanical efficiency must be between 0 and 1.0');
    }

    const P1_bara = inletPressureBarg + 1.01325;
    let P2_bara;
    if (exhaustPressureBara !== undefined) {
      P2_bara = exhaustPressureBara;
    } else if (exhaustPressureBarg !== undefined) {
      P2_bara = exhaustPressureBarg + 1.01325;
    } else {
      P2_bara = turbineType.toUpperCase() === 'CONDENSING' ? 0.08 : 3.5 + 1.01325;
    }

    if (P2_bara >= P1_bara) throw new Error('Inlet steam pressure must exceed exhaust pressure');

    // Reject subcooled liquid water: Steam turbines require superheated or saturated steam at throttle
    const P1_Pa = P1_bara * 1e5;
    if (IAPWS_IF97 && P1_Pa >= 611.213 && P1_Pa <= 22.064e6) {
      const Tsat1_C = IAPWS_IF97.saturationTemperature(P1_Pa) - 273.15;
      if (inletTempC < Tsat1_C - 0.5) {
        throw new Error(`Inlet steam temperature (${inletTempC}°C) is below saturation temperature (${Math.round(Tsat1_C * 10) / 10}°C) at inlet pressure; subcooled liquid water is prohibited in steam turbines`);
      }
    }

    // 1. Throttle Steam State
    const inletProps = this.getSteamProperties(P1_bara, inletTempC);
    const h1 = inletProps.enthalpyKJkg;
    const s1 = inletProps.entropyKJkgK;

    // 2. Isentropic Expansion to P2
    // Use accurate IAPWS-IF97 saturation properties when available
    let Tsat2_C, hf2, hg2, sf2, sg2;
    const P2_Pa = P2_bara * 1e5;
    if (IAPWS_IF97 && P2_Pa >= 611.213 && P2_Pa <= 22.064e6) {
      try {
        const Tsat2_K = IAPWS_IF97.saturationTemperature(P2_Pa);
        Tsat2_C = Tsat2_K - 273.15;
        const liqProps = IAPWS_IF97.region1Properties(P2_Pa, Tsat2_K - 0.05);
        const vapProps = IAPWS_IF97.region2Properties(P2_Pa, Tsat2_K + 0.05);
        hf2 = liqProps.specificEnthalpy_J_kg * 1e-3;
        hg2 = vapProps.specificEnthalpy_J_kg * 1e-3;
        sf2 = liqProps.specificEntropy_J_kg_K * 1e-3;
        sg2 = vapProps.specificEntropy_J_kg_K * 1e-3;
      } catch {
        // Fall through to correlation if numerical issue
      }
    }
    if (Tsat2_C === undefined) {
      Tsat2_C = 99.63 * Math.pow(Math.max(0.01, P2_bara), 0.25);
      hf2 = 419.0 * (Tsat2_C / 100.0);
      hg2 = 2500.0 + 1.8 * Tsat2_C;
      sf2 = 1.30 * (Tsat2_C / 100.0);
      sg2 = 7.35 - 0.35 * Math.log(Math.max(0.01, P2_bara));
    }
    const hfg2 = hg2 - hf2;

    let h2s;
    if (s1 < sg2) {
      // Isentropic state falls in two-phase region
      const x2s = Math.max(0.70, (s1 - sf2) / (sg2 - sf2));
      h2s = hf2 + x2s * hfg2;
    } else {
      // Isentropic state remains superheated
      const T2s_C = Tsat2_C + (s1 - sg2) / 0.0042;
      h2s = hg2 + 1.95 * (T2s_C - Tsat2_C);
    }

    const delta_hs = Math.max(50.0, h1 - h2s); // kJ/kg

    // 3. Theoretical Steam Rate (TSR) & Actual Steam Rate (ASR)
    // TSR = 3600 / delta_hs (kg/kWh)
    const theoreticalSteamRate = 3600.0 / delta_hs;
    // ASR = TSR / (eta_internal * eta_mechanical)
    const actualSteamRate = theoreticalSteamRate / (internalEfficiency * mechanicalEfficiency);

    // 4. Actual Enthalpy Drop and Shaft Work
    const delta_h_act = delta_hs * internalEfficiency;
    const h2_act = h1 - delta_h_act;

    // Actual exhaust steam vapor quality
    let exitVaporQuality = 1.0;
    let exhaustMoisturePct = 0.0;
    if (h2_act < hg2) {
      exitVaporQuality = Math.min(1.0, Math.max(0.75, (h2_act - hf2) / hfg2));
      exhaustMoisturePct = (1.0 - exitVaporQuality) * 100.0;
    }

    // 5. Total Throttle Steam Consumption
    let totalThrottleSteamKgH;
    let condenserSteamFlowKgH = 0.0;
    let condenserHeatDutyMWth = 0.0;
    let coolingWaterM3H = 0.0;

    const isExtraction = turbineType.toUpperCase() === 'EXTRACTION_CONDENSING' && extractionFlowKgH > 0;

    if (!isExtraction) {
      totalThrottleSteamKgH = shaftPowerKW * actualSteamRate;
      if (turbineType.toUpperCase() === 'CONDENSING' || P2_bara < 1.0) {
        condenserSteamFlowKgH = totalThrottleSteamKgH;
      }
    } else {
      // Extraction turbine: high pressure section produces work from both extraction and condensing streams
      const P_ext_bara = (extractionPressureBarg !== undefined ? extractionPressureBarg : 15.0) + 1.01325;
      const h_ext_ideal = h1 - (h1 - h2s) * 0.45;
      const delta_h_ext = (h1 - h_ext_ideal) * internalEfficiency;
      const powerFromExtractionKW = (extractionFlowKgH * delta_h_ext * mechanicalEfficiency) / 3600.0;

      const remainingPowerKW = Math.max(0.0, shaftPowerKW - powerFromExtractionKW);
      const condensingSteamKgH = remainingPowerKW * actualSteamRate;

      totalThrottleSteamKgH = extractionFlowKgH + condensingSteamKgH;
      condenserSteamFlowKgH = condensingSteamKgH;
    }

    // 6. Surface Condenser Duty Calculation
    if (condenserSteamFlowKgH > 0) {
      // Heat rejected in condenser = m_cond * (h2 - h_condensate)
      // Condensate liquid enthalpy h_condensate ~ hf2
      const heatRejectionKJkg = Math.max(2000.0, h2_act - hf2);
      condenserHeatDutyMWth = (condenserSteamFlowKgH * heatRejectionKJkg) / (3600.0 * 1000.0);

      // Cooling water demand (assumed deltaT_water = 10°C, Cp = 4.184 kJ/kg*K)
      coolingWaterM3H = (condenserHeatDutyMWth * 1000.0 / (4.184 * 10.0)) * 3.6;
    }

    // API 612 Exhaust Moisture Limit Check: y <= 12.0% (to prevent blade erosion)
    const meetsMoistureLimit = exhaustMoisturePct <= 12.0;

    return {
      standard: 'API 612 Special-Purpose Steam Turbine',
      turbineType: turbineType.toUpperCase(),
      shaftPowerKW,
      shaftPowerMW: Math.round((shaftPowerKW * 1e-3) * 100) / 100,
      steamConditions: {
        inletPressureBarg,
        inletTempC,
        inletEnthalpyKJkg: Math.round(h1 * 10) / 10,
        exhaustPressureBara: Math.round(P2_bara * 1000) / 1000,
        exhaustPressureBarg: P2_bara >= 1.01325 ? Math.round((P2_bara - 1.01325) * 100) / 100 : null,
        exhaustEnthalpyKJkg: Math.round(h2_act * 10) / 10
      },
      thermodynamics: {
        isentropicEnthalpyDropKJkg: Math.round(delta_hs * 10) / 10,
        actualEnthalpyDropKJkg: Math.round(delta_h_act * 10) / 10,
        theoreticalSteamRateKgKWh: Math.round(theoreticalSteamRate * 100) / 100,
        actualSteamRateKgKWh: Math.round(actualSteamRate * 100) / 100,
        internalEfficiencyPct: internalEfficiency * 100.0,
        mechanicalEfficiencyPct: mechanicalEfficiency * 100.0
      },
      consumption: {
        throttleSteamFlowKgH: Math.round(totalThrottleSteamKgH),
        throttleSteamFlowTH: Math.round((totalThrottleSteamKgH * 1e-3) * 10) / 10,
        extractionSteamFlowKgH: isExtraction ? extractionFlowKgH : 0.0,
        exhaustSteamFlowKgH: Math.round(totalThrottleSteamKgH - (isExtraction ? extractionFlowKgH : 0))
      },
      exhaustQuality: {
        vaporQuality: Math.round(exitVaporQuality * 1000) / 1000,
        moisturePercentage: Math.round(exhaustMoisturePct * 10) / 10,
        meetsApi612MoistureLimit: meetsMoistureLimit,
        erosionRisk: !meetsMoistureLimit
      },
      condenser: condenserSteamFlowKgH > 0 ? {
        condenserSteamFlowKgH: Math.round(condenserSteamFlowKgH),
        condenserHeatDutyMWth: Math.round(condenserHeatDutyMWth * 10) / 10,
        coolingWaterFlowM3H: Math.round(coolingWaterM3H * 10) / 10
      } : null
    };
  }

  /**
   * Generates Willans line part-load steam consumption table from 20% to 110% rating.
   *
   * @param {Object} params
   * @param {number} params.ratedPowerKW - Rated power (kW)
   * @param {number} params.ratedSteamRateKgKWh - Design ASR (kg/kWh)
   * @param {number} [params.noLoadSteamFraction=0.14] - Zero-power no-load steam flow fraction (typically 12-16%)
   * @returns {Object} Willans line formula parameters and part-load table
   */
  static evaluateWillansLine(params) {
    const {
      ratedPowerKW,
      ratedSteamRateKgKWh,
      noLoadSteamFraction = 0.14
    } = params || {};

    if (!ratedPowerKW || ratedPowerKW <= 0 || !ratedSteamRateKgKWh || ratedSteamRateKgKWh <= 0) {
      throw new Error('Rated power and rated steam rate must be positive');
    }

    const ratedSteamFlowKgH = ratedPowerKW * ratedSteamRateKgKWh;
    // Willans equation: F = F0 + S * P
    const F0 = ratedSteamFlowKgH * noLoadSteamFraction;
    const S = (ratedSteamFlowKgH - F0) / ratedPowerKW; // incremental steam rate

    const loadPoints = [0.20, 0.40, 0.60, 0.80, 1.00, 1.10];
    const performanceTable = loadPoints.map(loadFrac => {
      const powerKW = ratedPowerKW * loadFrac;
      const steamFlowKgH = F0 + S * powerKW;
      const specificSteamRate = steamFlowKgH / powerKW;
      return {
        loadPercent: Math.round(loadFrac * 100),
        shaftPowerKW: Math.round(powerKW),
        steamFlowKgH: Math.round(steamFlowKgH),
        specificSteamRateKgKWh: Math.round(specificSteamRate * 100) / 100
      };
    });

    return {
      formula: 'Willans Line: SteamFlow(kg/h) = F0 + S * Power(kW)',
      noLoadSteamFlowF0_KgH: Math.round(F0 * 10) / 10,
      incrementalSteamRateS: Math.round(S * 1000) / 1000,
      ratedSteamFlowKgH: Math.round(ratedSteamFlowKgH),
      performanceTable
    };
  }
}

module.exports = { DriverSteamTurbine };
