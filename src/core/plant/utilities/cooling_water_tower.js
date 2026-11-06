/**
 * Industrial Cooling Water Systems: Mechanical Draft Cooling Tower & Seawater Intake.
 *
 * Implements:
 * 1. Mechanical Draft Cooling Tower Merkel Integral Method:
 *    - Cooling Range = T_hot - T_cold
 *    - Approach = T_cold - T_wetbulb
 *    - Merkel Number (KaV/L) evaluated via 4-point Chebyshev quadrature:
 *      Me = Cp * Range * (1/4) * [ 1/(hs1 - ha1) + 1/(hs2 - ha2) + 1/(hs3 - ha3) + 1/(hs4 - ha4) ]
 *    - Liquid-to-Gas (L/G) mass ratio
 * 2. Water Mass & Chemical Balance:
 *    - Evaporation loss: E = L * Cpw * Range / Lambda_vap
 *    - Drift loss: D = drift_fraction * L (typically 0.005% with high-efficiency drift eliminators)
 *    - Blowdown: B = E / (COC - 1) - D
 *    - Makeup water demand: M = E + B + D
 * 3. Once-Through Seawater Cooling:
 *    - Seawater mass flow for process heat rejection
 *    - Strict environmental thermal discharge verification (Delta T <= 5.0 °C)
 * 4. Sodium Hypochlorite Electrochlorination Marine Biofouling Control:
 *    - Continuous dosing (1.0 to 2.0 ppm equivalent Cl2)
 *    - Periodic shock dosing (5.0 ppm for 30 min)
 *    - DC electrolysis power demand (~4.2 kWh/kg Cl2)
 *    - Hydrogen byproduct evolution and forced-air dilution to < 1.0 vol% (well below 4% LFL).
 */

'use strict';

class CoolingWaterSystems {
  /**
   * Saturated moist air enthalpy (kJ/kg dry air) as a function of temperature (C).
   */
  static getSaturatedAirEnthalpy(tempC) {
    // Magnus-Tetens vapor pressure of water P_sat (kPa)
    const P_sat = 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
    const P_atm = 101.325; // kPa
    // Humidity ratio W_sat (kg water / kg dry air)
    const W_sat = 0.622 * (P_sat / (P_atm - P_sat));
    // Moist air enthalpy: h = 1.006 * T + W * (2501 + 1.86 * T)
    return 1.006 * tempC + W_sat * (2501.0 + 1.86 * tempC);
  }

  /**
   * Evaluates mechanical draft wet cooling tower performance and water balance.
   *
   * @param {Object} params
   * @param {number} params.waterFlowM3H - Circulating cooling water flow (m3/h)
   * @param {number} params.hotWaterTempC - Return water inlet temperature Tin (C)
   * @param {number} params.coldWaterTempC - Supply water outlet temperature Tout (C)
   * @param {number} params.wetBulbTempC - Ambient air wet-bulb temperature Twb (C)
   * @param {number} [params.cyclesOfConcentration=4.0] - Target COC (typically 3.0 to 5.0)
   * @param {number} [params.liquidToGasRatio=1.2] - Design L/G mass ratio
   * @param {number} [params.driftLossPercent=0.005] - Drift loss % of circulation
   * @returns {Object} Merkel rating, thermal duty, water balance, and fan power
   */
  static evaluateCoolingTower(params) {
    const {
      waterFlowM3H,
      hotWaterTempC,
      coldWaterTempC,
      wetBulbTempC,
      cyclesOfConcentration = 4.0,
      liquidToGasRatio = 1.2,
      driftLossPercent = 0.005
    } = params;

    if (hotWaterTempC <= coldWaterTempC) {
      throw new Error('hotWaterTempC must be greater than coldWaterTempC');
    }
    if (coldWaterTempC <= wetBulbTempC) {
      throw new Error('coldWaterTempC must be strictly greater than wetBulbTempC');
    }

    const range = hotWaterTempC - coldWaterTempC;
    const approach = coldWaterTempC - wetBulbTempC;

    // Thermal duty Q (MW)
    // Q = m_dot * Cp * Range
    const rho_w = 995.0; // kg/m3
    const Cp_w = 4.184; // kJ/(kg*K)
    const mDotKgS = (waterFlowM3H * rho_w) / 3600.0;
    const dutyMW = (mDotKgS * Cp_w * range) * 1e-3;

    // 1. Merkel integral (KaV/L) via 4-point Chebyshev quadrature
    // Air inlet enthalpy at Twb
    const h_a_in = this.getSaturatedAirEnthalpy(wetBulbTempC);
    // Air outlet enthalpy: h_a_out = h_a_in + (L/G) * Cp_w * Range
    const h_a_out = h_a_in + liquidToGasRatio * Cp_w * range;

    const chebyshevWeights = [0.1, 0.4, 0.6, 0.9];
    let sumInverseDeltaH = 0;

    for (const w of chebyshevWeights) {
      const T = coldWaterTempC + w * range;
      const h_s = this.getSaturatedAirEnthalpy(T);
      const h_a = h_a_in + w * (h_a_out - h_a_in);
      const deltaH = Math.max(0.5, h_s - h_a);
      sumInverseDeltaH += 1.0 / deltaH;
    }

    const merkelNumber = (Cp_w * range / 4.0) * sumInverseDeltaH;

    // 2. Water mass balance
    // Latent heat of vaporization Lambda_vap ~ 2420 kJ/kg at 35C
    const lambdaVap = 2420.0;
    // Evaporation rate E (m3/h)
    const evapLossM3H = (waterFlowM3H * Cp_w * range) / lambdaVap;
    // Drift loss D (m3/h)
    const driftLossM3H = waterFlowM3H * (driftLossPercent / 100.0);
    // Blowdown B = E / (COC - 1) - D
    const coc = Math.max(1.1, cyclesOfConcentration);
    const blowdownM3H = Math.max(0, (evapLossM3H / (coc - 1.0)) - driftLossM3H);
    // Total makeup water M = E + B + D
    const makeupM3H = evapLossM3H + blowdownM3H + driftLossM3H;

    // 3. Electrical fan & pump power estimation
    // Air mass flow required (kg/s) = (m_dot_water) / (L/G)
    const airMassFlowKgS = mDotKgS / liquidToGasRatio;
    // Fan shaft power approx 0.024 kW per m3/h
    const fanPowerKW = waterFlowM3H * 0.024;
    // Pumping head typically ~ 10 m
    const pumpPowerKW = (mDotKgS * 9.81 * 10.0 * 1e-3) / 0.82;

    return {
      circulatingWaterFlowM3H: waterFlowM3H,
      hotWaterInletTempC: hotWaterTempC,
      coldWaterOutletTempC: coldWaterTempC,
      ambientWetBulbTempC: wetBulbTempC,
      rangeC: Math.round(range * 10) / 10,
      approachC: Math.round(approach * 10) / 10,
      heatDutyMW: Math.round(dutyMW * 100) / 100,
      merkelNumber: Math.round(merkelNumber * 1000) / 1000,
      liquidToGasRatio,
      airFlowKgS: Math.round(airMassFlowKgS * 10) / 10,
      waterBalance: {
        evaporationLossM3H: Math.round(evapLossM3H * 10) / 10,
        driftLossM3H: Math.round(driftLossM3H * 100) / 100,
        blowdownM3H: Math.round(blowdownM3H * 10) / 10,
        makeupWaterRequiredM3H: Math.round(makeupM3H * 10) / 10,
        cyclesOfConcentration: coc
      },
      powerConsumption: {
        totalFanPowerKW: Math.round(fanPowerKW * 10) / 10,
        circulatingPumpPowerKW: Math.round(pumpPowerKW * 10) / 10
      }
    };
  }

  /**
   * Once-through seawater cooling system evaluation with electrochlorination dosing.
   *
   * @param {Object} params
   * @param {number} params.heatDutyMW - Total heat duty to reject to seawater (MW)
   * @param {number} params.seawaterInletTempC - Seawater intake temperature (C)
   * @param {number} [params.maxAllowableDeltaTC=5.0] - Maximum permissible seawater temperature rise (C)
   * @param {number} [params.continuousChlorineDosePpm=1.5] - Continuous sodium hypochlorite dose (ppm as Cl2)
   * @param {number} [params.shockChlorineDosePpm=5.0] - Shock dose (ppm) for 30 minutes every 8h
   * @returns {Object} Seawater flow, thermal discharge check, and electrochlorination specs
   */
  static evaluateSeawaterCooling(params) {
    const {
      heatDutyMW,
      seawaterInletTempC,
      maxAllowableDeltaTC = 5.0,
      continuousChlorineDosePpm = 1.5,
      shockChlorineDosePpm = 5.0
    } = params;

    if (!heatDutyMW || heatDutyMW <= 0) {
      throw new Error('heatDutyMW must be positive');
    }

    // Seawater density ~ 1025 kg/m3, Cp ~ 3.99 kJ/(kg*K)
    const rho_sw = 1025.0;
    const Cp_sw = 3.99;
    const deltaT_C = params.targetDeltaTC !== undefined
      ? params.targetDeltaTC
      : (params.deltaTC !== undefined ? params.deltaTC : maxAllowableDeltaTC);

    // Required seawater mass flow: m_dot = Q / (Cp * DeltaT) (kg/s)
    const mDotSwKgS = (heatDutyMW * 1e3) / (Cp_sw * deltaT_C);
    const flowSwM3H = (mDotSwKgS * 3600.0) / rho_sw;
    const dischargeTempC = seawaterInletTempC + deltaT_C;

    // Electrochlorination Sizing:
    // Continuous chlorine generation rate: kg Cl2/h = (flow_m3_h * ppm) / 1000
    const continuousCl2KgH = (flowSwM3H * continuousChlorineDosePpm) / 1000.0;
    const shockCl2KgH = (flowSwM3H * shockChlorineDosePpm) / 1000.0;

    // DC Power consumption ~ 4.2 kWh / kg Cl2 generated
    const electrochlorinationContinuousPowerKW = continuousCl2KgH * 4.2;
    const electrochlorinationPeakPowerKW = shockCl2KgH * 4.2;

    // Hydrogen byproduct generation: ~ 0.35 Nm3 H2 per kg Cl2
    const h2EvolutionRateNm3H = continuousCl2KgH * 0.35;
    // Dilution air required to maintain H2 < 1.0 vol% in degasser: Air = (H2 / 0.01) - H2
    const dilutionAirRequiredNm3H = h2EvolutionRateNm3H * 99.0;

    return {
      heatDutyMW,
      seawaterInletTempC,
      seawaterDischargeTempC: Math.round(dischargeTempC * 10) / 10,
      seawaterDeltaTC: deltaT_C,
      isThermalDischargeAcceptable: deltaT_C <= maxAllowableDeltaTC,
      seawaterFlowRateM3H: Math.round(flowSwM3H * 10) / 10,
      seawaterFlowRateKgS: Math.round(mDotSwKgS * 10) / 10,
      electrochlorination: {
        continuousDosePpm: continuousChlorineDosePpm,
        continuousCl2DemandKgH: Math.round(continuousCl2KgH * 100) / 100,
        continuousDcPowerKW: Math.round(electrochlorinationContinuousPowerKW * 10) / 10,
        shockDosePpm: shockChlorineDosePpm,
        shockCl2DemandKgH: Math.round(shockCl2KgH * 100) / 100,
        shockPeakDcPowerKW: Math.round(electrochlorinationPeakPowerKW * 10) / 10,
        hydrogenEvolutionRateNm3H: Math.round(h2EvolutionRateNm3H * 100) / 100,
        minimumDilutionAirFlowNm3H: Math.round(dilutionAirRequiredNm3H * 10) / 10,
        safetyNote: 'Dilution blower sized to maintain H2 concentration below 1.0 vol% in degasser vent (safe from 4% LFL).'
      }
    };
  }
}

module.exports = {
  CoolingWaterSystems
};
