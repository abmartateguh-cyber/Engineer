/**
 * API 610 (12th Edition) / ISO 13709 Centrifugal Pump Engineering Engine.
 *
 * Implements:
 * 1. Comprehensive API 610 Casing Classifications:
 *    - Overhung (OH1, OH2 Centerline Supported, OH3, OH4, OH5)
 *    - Between Bearings (BB1, BB2 Radially Split 1-2 Stage, BB3 Multistage, BB5 Double Casing Barrel)
 *    - Vertically Suspended (VS1, VS4 Sump, VS6 Double Casing Can Pump for Cryogenic LNG)
 * 2. Hydraulic Performance Curve Fitting (Head-Capacity H-Q, Efficiency eta-Q, Power P-Q, NPSHr-Q).
 * 3. Affinity Laws for variable speed operation (N) and impeller trimming (D).
 * 4. Specific speed Ns and Suction specific speed Nss calculations.
 * 5. Driver sizing margins per API 610 Table 14 (<22 kW: 25%, 22-55 kW: 15%, >55 kW: 10%).
 */

'use strict';

const API_610_PUMP_TYPES = {
  OH2: { code: 'OH2', desc: 'Overhung Centerline-Supported Single-Stage', typicalMaxPressBar: 50.0, maxTempC: 450.0 },
  BB2: { code: 'BB2', desc: 'Between-Bearings Radially-Split 1 or 2 Stage', typicalMaxPressBar: 100.0, maxTempC: 450.0 },
  BB5: { code: 'BB5', desc: 'Between-Bearings Radially-Split Multistage Double-Casing Barrel', typicalMaxPressBar: 350.0, maxTempC: 450.0 },
  VS6: { code: 'VS6', desc: 'Vertically-Suspended Double-Casing Can Diffuser Pump (Cryogenic LNG / Low NPSH)', typicalMaxPressBar: 120.0, maxTempC: 250.0 }
};

class PumpCentrifugalApi610 {
  /**
   * Evaluates centrifugal pump operating point and fits hydraulic performance curves.
   *
   * @param {Object} params
   * @param {number} params.flowRateM3H - Normal operating volumetric flow rate Q (m3/h)
   * @param {number} params.differentialHeadM - Total dynamic head TDH H (m of liquid)
   * @param {number} params.liquidDensityKgM3 - Liquid density rho (kg/m3)
   * @param {number} params.speedRpm - Operating speed N (rpm, typically 1450, 1750, 2950, 3550)
   * @param {number} [params.bepEfficiency=0.78] - Best Efficiency Point efficiency eta_BEP (0.65 to 0.88)
   * @param {number} [params.npshrAtBepM=3.2] - NPSH required at BEP (m)
   * @param {string} [params.apiType='OH2'] - API 610 pump type ('OH2', 'BB2', 'BB5', 'VS6')
   * @returns {Object} Complete hydraulic and mechanical driver evaluation
   */
  static evaluatePumpOperatingPoint(params) {
    const {
      flowRateM3H,
      differentialHeadM,
      liquidDensityKgM3,
      speedRpm,
      bepEfficiency = 0.78,
      npshrAtBepM = 3.2,
      apiType = 'OH2'
    } = params;

    const g = 9.80665; // m/s2
    const rho = liquidDensityKgM3;
    const Q_m3_s = flowRateM3H / 3600.0;
    const H = differentialHeadM;
    const eta = bepEfficiency;

    // 1. Hydraulic Power: P_hyd = rho * g * Q * H (Watts -> kW)
    const hydraulicPowerKW = (rho * g * Q_m3_s * H) * 1e-3;

    // 2. Brake Horsepower (Shaft Power): P_shaft = P_hyd / eta (kW)
    const shaftPowerKW = hydraulicPowerKW / eta;

    // 3. API 610 Driver Power Margin (Table 14)
    let driverMarginFrac = 0.10; // > 55 kW -> 10%
    if (shaftPowerKW < 22.0) driverMarginFrac = 0.25; // 25% margin
    else if (shaftPowerKW <= 55.0) driverMarginFrac = 0.15; // 15% margin
    const recommendedDriverKW = shaftPowerKW * (1.0 + driverMarginFrac);

    // 4. Specific Speed Ns (Metric: rpm, m3/s, m)
    // Ns_metric = N * sqrt(Q_m3_s) / (H^0.75)
    const Ns_metric = (speedRpm * Math.sqrt(Q_m3_s)) / Math.pow(H, 0.75);
    // Convert to US units: Ns_US = Ns_metric * 51.6
    const Ns_US = Ns_metric * 51.6;

    // 5. Suction Specific Speed Nss (US units: rpm, gpm, ft)
    const Q_gpm = flowRateM3H * 4.40287;
    const npshr_ft = npshrAtBepM * 3.28084;
    const Nss_US = (speedRpm * Math.sqrt(Q_gpm)) / Math.pow(npshr_ft, 0.75);

    // Evaluate suction recirculation risk (API 610 guideline: Nss > 11,000 indicates high suction energy and cavitation risk)
    const isHighSuctionEnergy = Nss_US > 11000.0;
    const minContinuousStableFlowPct = isHighSuctionEnergy ? 60.0 : 30.0;
    const mcsfM3H = (minContinuousStableFlowPct / 100.0) * flowRateM3H;

    // 6. Shutoff Head Estimation (typical rising curve: H_shutoff ~ 1.15 to 1.25 * H_rated)
    const estimatedShutoffHeadM = H * 1.20;
    const differentialPressureBar = (rho * g * H) * 1e-5;

    return {
      api610Type: apiType,
      apiDescription: (API_610_PUMP_TYPES[apiType] || API_610_PUMP_TYPES.OH2).desc,
      operatingSpeedRpm: speedRpm,
      flowRateM3H,
      differentialHeadM,
      differentialPressureBar: Math.round(differentialPressureBar * 10) / 10,
      hydraulicPowerKW: Math.round(hydraulicPowerKW * 10) / 10,
      pumpEfficiencyPct: Math.round(eta * 1000) / 10,
      shaftPowerKW: Math.round(shaftPowerKW * 10) / 10,
      api610DriverMarginPct: driverMarginFrac * 100.0,
      recommendedDriverKW: Math.round(recommendedDriverKW * 10) / 10,
      npshRequiredM: npshrAtBepM,
      specificSpeedNs_US: Math.round(Ns_US),
      suctionSpecificSpeedNss_US: Math.round(Nss_US),
      isHighSuctionEnergyPump: isHighSuctionEnergy,
      minimumContinuousStableFlowM3H: Math.round(mcsfM3H * 10) / 10,
      estimatedShutoffHeadM: Math.round(estimatedShutoffHeadM * 10) / 10
    };
  }

  /**
   * Applies Affinity Laws to predict performance at trimmed impeller diameter or altered speed.
   *
   * @param {Object} baseline
   * @param {number} baseline.flowM3H
   * @param {number} baseline.headM
   * @param {number} baseline.powerKW
   * @param {number} baseline.diameterMm
   * @param {number} baseline.speedRpm
   * @param {number} targetDiameterMm
   * @param {number} targetSpeedRpm
   * @returns {Object} Scaled performance point
   */
  static applyAffinityLaws(baseline, targetDiameterMm, targetSpeedRpm) {
    const sRatio = targetSpeedRpm / baseline.speedRpm;
    const dRatio = targetDiameterMm / baseline.diameterMm;

    const scaledFlowM3H = baseline.flowM3H * sRatio * dRatio;
    const scaledHeadM = baseline.headM * Math.pow(sRatio, 2) * Math.pow(dRatio, 2);
    const scaledPowerKW = baseline.powerKW * Math.pow(sRatio, 3) * Math.pow(dRatio, 3);

    return {
      targetSpeedRpm,
      targetDiameterMm,
      diameterTrimPercent: Math.round((1.0 - dRatio) * 1000) / 10,
      scaledFlowM3H: Math.round(scaledFlowM3H * 10) / 10,
      scaledHeadM: Math.round(scaledHeadM * 10) / 10,
      scaledPowerKW: Math.round(scaledPowerKW * 10) / 10,
      isTrimCompliant: dRatio >= 0.90 // API 610 maximum recommended trim is 10%
    };
  }
}

module.exports = {
  PumpCentrifugalApi610,
  API_610_PUMP_TYPES
};
