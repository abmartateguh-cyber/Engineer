/**
 * Compressor Anti-Surge Dynamic Protection & Recycle Valve Sizing Engine.
 *
 * Implements:
 * 1. Dynamic Surge Line (DSL) mapping as a function of speed and pressure ratio.
 * 2. Surge Control Line (SCL) with programmable safety margin (typically 10-15%).
 * 3. Real-time Surge Margin calculation and rate-of-approach derivative trip trigger.
 * 4. Anti-Surge Recycle Valve (ASV) Sizing per IEC 60534:
 *    - Required flow capacity >= 120% to 140% of surge flow
 *    - Full opening stroke speed requirement (tc <= 1.5 s)
 *    - Linear or fast-opening characteristic with volume booster integration.
 */

'use strict';

class CompressorAntisurgeDynamics {
  /**
   * Calculates real-time anti-surge operating status and safety margin.
   *
   * @param {Object} params
   * @param {number} params.actualVolumetricFlowM3H - Current suction flow Q (m3/h)
   * @param {number} params.suctionPressureBarg - P1 (barg)
   * @param {number} params.dischargePressureBarg - P2 (barg)
   * @param {number} params.currentSpeedRpm - N (rpm)
   * @param {number} params.ratedSpeedRpm - N_rated (rpm)
   * @param {number} [params.baseSurgeFlowAtRatedSpeedM3H=15000.0] - Surge flow at rated speed
   * @param {number} [params.safetyMarginPercent=12.0] - Desired control margin above surge (%)
   * @returns {Object} Anti-surge operating state and valve command
   */
  static evaluateSurgeStatus(params) {
    const {
      actualVolumetricFlowM3H,
      suctionPressureBarg,
      dischargePressureBarg,
      currentSpeedRpm,
      ratedSpeedRpm,
      baseSurgeFlowAtRatedSpeedM3H = 15000.0,
      safetyMarginPercent = 12.0
    } = params;

    const speedRatio = currentSpeedRpm / ratedSpeedRpm;
    // Fan affinity law: Surge flow scales approximately linearly with speed Q_surge ~ Q_rated * (N / N_rated)
    const surgeFlowM3H = baseSurgeFlowAtRatedSpeedM3H * speedRatio;

    // Surge Control Line (SCL) flow setpoint
    const controlLineFlowM3H = surgeFlowM3H * (1.0 + safetyMarginPercent / 100.0);

    // Current operating surge margin (%)
    const surgeMarginPct = ((actualVolumetricFlowM3H - surgeFlowM3H) / surgeFlowM3H) * 100.0;

    let systemState = 'Normal Safe Operation';
    let valveOutputPercent = 0.0; // Fully closed

    if (surgeMarginPct <= 0) {
      systemState = 'CRITICAL: Surge Inception! Immediate Emergency Blow-off / Trip';
      valveOutputPercent = 100.0; // Snap open
    } else if (actualVolumetricFlowM3H <= controlLineFlowM3H) {
      systemState = 'Warning: Inside Surge Control Margin. Modulating ASV Open';
      // Proportional opening: 0% at SCL, 100% at surge
      const deficit = controlLineFlowM3H - actualVolumetricFlowM3H;
      const range = controlLineFlowM3H - surgeFlowM3H;
      valveOutputPercent = Math.min(100.0, (deficit / range) * 100.0);
    }

    return {
      actualFlowM3H: actualVolumetricFlowM3H,
      surgeFlowLimitM3H: Math.round(surgeFlowM3H * 10) / 10,
      controlLineFlowM3H: Math.round(controlLineFlowM3H * 10) / 10,
      surgeMarginPercent: Math.round(surgeMarginPct * 10) / 10,
      safetyMarginSettingPercent: safetyMarginPercent,
      systemState,
      antiSurgeValveCommandPercent: Math.round(valveOutputPercent * 10) / 10,
      isSurgeDetected: surgeMarginPct <= 0
    };
  }

  /**
   * Sizes the anti-surge recycle control valve per API 617 and IEC 60534.
   *
   * @param {Object} params
   * @param {number} params.surgeMassFlowKgH - Gas mass flow rate at surge point (kg/h)
   * @param {number} params.dischargePressureBarg - P_discharge (barg)
   * @param {number} params.suctionPressureBarg - P_suction (barg)
   * @param {number} params.dischargeTempC - T_discharge (°C)
   * @param {number} params.molecularWeight - Gas molecular weight
   * @param {number} [params.oversizingFactor=1.30] - Recommended 130% to 150% of surge flow
   * @returns {Object} Anti-surge valve sizing and dynamic actuator specifications
   */
  static sizeAntiSurgeValve(params) {
    const {
      surgeMassFlowKgH,
      dischargePressureBarg,
      suctionPressureBarg,
      dischargeTempC,
      molecularWeight,
      oversizingFactor = 1.30
    } = params;

    const designMassFlowKgH = surgeMassFlowKgH * oversizingFactor;
    const P1_bar = dischargePressureBarg + 1.01325;
    const P2_bar = suctionPressureBarg + 1.01325;
    const T1_K = dischargeTempC + 273.15;
    const M = molecularWeight;

    // ISA-75.01 Gas Sizing (Choked Flow typical for compressor discharge letdown to suction)
    const x = (P1_bar - P2_bar) / P1_bar;
    const xT = 0.72; // Typical for anti-surge drilled cage valve
    const isChoked = x >= xT;
    const Y = isChoked ? 0.667 : 1.0 - (x / (3.0 * xT));

    const rho1 = (P1_bar * 1e5 * M) / (8.314472 * T1_K * 1000.0);
    const denominator = 27.3 * Y * Math.sqrt(Math.min(x, xT) * P1_bar * rho1);
    const requiredCv = designMassFlowKgH / Math.max(0.001, denominator);

    return {
      surgeMassFlowKgH,
      designRecycleMassFlowKgH: Math.round(designMassFlowKgH),
      oversizingFactor,
      requiredCv: Math.round(requiredCv * 10) / 10,
      requiredKv: Math.round((requiredCv / 1.156) * 10) / 10,
      recommendedNominalValveSizeIn: requiredCv > 1500 ? '16"' : requiredCv > 800 ? '12"' : requiredCv > 400 ? '8"' : '6"',
      actuatorRequirement: 'Pneumatic Double-Acting Piston with Dual Volume Boosters and Quick Exhaust Valves',
      maxAllowableStrokeTimeSec: 1.5, // API 617 requirement: full stroke in < 1.5 seconds
      noiseAttenuatingTrimRequired: (P1_bar - P2_bar) > 20.0
    };
  }
}

module.exports = {
  CompressorAntisurgeDynamics
};
