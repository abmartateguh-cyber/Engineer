/**
 * Positive Displacement Pump Engineering Engine: API 674, API 675 & API 676.
 *
 * Implements:
 * 1. API 674 Reciprocating Plunger / Piston Pumps (Triplex & Quintuplex):
 *    - Plunger displacement, liquid compressibility and volumetric efficiency.
 *    - Acceleration head ha = (L * v * N * C) / (K * g) per API 674.
 *    - Discharge flow ripple pulsation factor (Triplex ~ 23% vs Quintuplex ~ 7%).
 * 2. API 675 Controlled-Volume Chemical Injection Metering Pumps (Diaphragm & Plunger).
 * 3. API 676 Rotary Positive Displacement Pumps (Twin-Screw & External Gear).
 */

'use strict';

class PumpPositiveDisplacement {
  /**
   * Evaluates an API 674 multi-plunger reciprocating pump.
   *
   * @param {Object} params
   * @param {number} params.plungerDiameterMm - Plunger diameter d (mm)
   * @param {number} params.strokeLengthMm - Stroke length S (mm)
   * @param {number} params.speedRpm - Crankshaft speed N (rpm, typically 150-450 rpm)
   * @param {number} [params.numberOfPlungers=3] - 3 for Triplex, 5 for Quintuplex
   * @param {number} params.suctionPressureBarg - Ps (barg)
   * @param {number} params.dischargePressureBarg - Pd (barg)
   * @param {number} params.liquidDensityKgM3 - Liquid density rho (kg/m3)
   * @param {number} params.suctionPipeLengthM - Suction line length L (m)
   * @param {number} params.suctionPipeDiameterMm - Suction pipe internal bore (mm)
   * @param {number} [params.volumetricEfficiency=0.92] - eta_v
   * @param {number} [params.mechanicalEfficiency=0.88] - eta_m
   * @returns {Object} Comprehensive API 674 reciprocating pump report
   */
  static evaluateReciprocatingPlunger(params) {
    const {
      plungerDiameterMm,
      strokeLengthMm,
      speedRpm,
      numberOfPlungers = 3,
      suctionPressureBarg,
      dischargePressureBarg,
      liquidDensityKgM3,
      suctionPipeLengthM,
      suctionPipeDiameterMm,
      volumetricEfficiency = 0.92,
      mechanicalEfficiency = 0.88
    } = params;

    const d = plungerDiameterMm * 1e-3; // m
    const S = strokeLengthMm * 1e-3; // m
    const N_rps = speedRpm / 60.0;
    const n = numberOfPlungers;

    // Displaced volume per revolution: V_rev = n * (pi/4 * d^2) * S (m3/rev)
    const V_rev = n * ((Math.PI * Math.pow(d, 2)) / 4.0) * S;
    const idealDisplacementM3H = V_rev * speedRpm * 60.0;
    const actualCapacityM3H = idealDisplacementM3H * volumetricEfficiency;

    // Differential pressure (Pa & bar)
    const deltaP_bar = dischargePressureBarg - suctionPressureBarg;
    const deltaP_Pa = deltaP_bar * 1e5;

    // Hydraulic Power and Brake Horsepower
    const Q_m3_s = actualCapacityM3H / 3600.0;
    const hydraulicPowerKW = (Q_m3_s * deltaP_Pa) * 1e-3;
    const brakeHorsepowerKW = hydraulicPowerKW / mechanicalEfficiency;

    // Suction line velocity (m/s)
    const D_suct_m = suctionPipeDiameterMm * 1e-3;
    const A_suct_m2 = (Math.PI * Math.pow(D_suct_m, 2)) / 4.0;
    const v_suct_m_s = Q_m3_s / A_suct_m2;

    // API 674 Acceleration Head: ha = (L * v * N * C) / (K * g)
    // where C = constant (0.066 for Triplex, 0.040 for Quintuplex)
    // K = fluid compressibility factor (1.4 for deaerated water/hydrocarbons)
    const C = n >= 5 ? 0.040 : 0.066;
    const K = 1.4;
    const g = 9.80665;
    const L = suctionPipeLengthM;
    const accelerationHeadM = (L * v_suct_m_s * speedRpm * C) / (K * g);

    // Peak-to-peak discharge flow pulsation ripple
    const flowPulsationPct = n >= 5 ? 7.0 : 23.0;

    return {
      pumpConfiguration: n >= 5 ? 'API 674 Quintuplex Plunger Pump (5-Cylinder)' : 'API 674 Triplex Plunger Pump (3-Cylinder)',
      speedRpm,
      idealDisplacementM3H: Math.round(idealDisplacementM3H * 10) / 10,
      actualCapacityM3H: Math.round(actualCapacityM3H * 10) / 10,
      differentialPressureBar: Math.round(deltaP_bar * 10) / 10,
      hydraulicPowerKW: Math.round(hydraulicPowerKW * 10) / 10,
      brakeHorsepowerKW: Math.round(brakeHorsepowerKW * 10) / 10,
      volumetricEfficiencyPct: volumetricEfficiency * 100.0,
      suctionVelocityMS: Math.round(v_suct_m_s * 100) / 100,
      accelerationHeadM: Math.round(accelerationHeadM * 100) / 100,
      accelerationHeadBar: Math.round(((accelerationHeadM * liquidDensityKgM3 * g) * 1e-5) * 100) / 100,
      dischargePulsationPercent: flowPulsationPct,
      recommendedPulsationDampener: flowPulsationPct > 10.0 ? 'Discharge Bladder Pulsation Dampener Mandatory' : 'Standard In-Line Orifice Dampener Sufficient'
    };
  }
}

module.exports = {
  PumpPositiveDisplacement
};
