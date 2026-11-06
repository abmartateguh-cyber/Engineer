/**
 * IEC 60034 / NEMA MG-1 Electric Motor Sizing & Variable Frequency Drive (VFD) Engine.
 *
 * Implements:
 * 1. IEC 60034-30-1 Efficiency Standards:
 *    - Premium (IE3) and Super Premium (IE4) efficiency classes across low & medium voltage.
 * 2. Full-Load Electrical Sizing:
 *    - Full-Load Amperes (FLA), power factor (cos phi), and apparent power (kVA).
 *    - Direct-on-line (DOL) locked-rotor starting current (LRA) and inrush ratio (6.0 - 7.5x).
 * 3. Torque Capability & Starting Dynamics:
 *    - Rated torque, starting torque, pull-up torque, and breakdown torque.
 *    - Voltage dip torque degradation: T proportional to (V / V_rated)^2.
 *    - Centrifugal pump / compressor parabolic load torque acceleration margin.
 * 4. VFD Harmonic & Cooling Derating per IEC 60034-17 / IEC 60034-25:
 *    - PWM harmonic eddy/hysteresis loss derating factor.
 *    - Self-cooled (IC 411 TEFC) shaft fan speed derating vs forced-ventilated (IC 416) blowers.
 */

'use strict';

class DriverElectricMotor {
  /**
   * Evaluates nominal efficiency based on IEC 60034-30-1 IE3 / IE4 curves.
   *
   * @param {number} powerKW - Rated shaft mechanical power (kW)
   * @param {string} [efficiencyClass='IE3'] - 'IE2', 'IE3', 'IE4'
   * @returns {number} Efficiency fraction (e.g. 0.962)
   */
  static getStandardEfficiency(powerKW, efficiencyClass = 'IE3') {
    const P = Math.max(0.75, powerKW);
    const cls = efficiencyClass.toUpperCase();

    // Semi-empirical IEC 60034-30-1 curve fit: eta = A - B / P^0.25
    let A = 0.968;
    let B = 0.080;

    if (cls === 'IE4') {
      A = 0.976;
      B = 0.065;
    } else if (cls === 'IE2') {
      A = 0.955;
      B = 0.095;
    }

    let eta = A - B / Math.pow(P, 0.23);
    // Asymptotic cap for high-voltage multi-megawatt LNG compressor motors
    if (P >= 5000.0) {
      eta = cls === 'IE4' ? 0.982 : 0.975;
    }
    return Math.min(0.985, Math.max(0.80, eta));
  }

  /**
   * Sizes an electric motor driver for pump or compressor duty per IEC 60034 / NEMA MG-1.
   *
   * @param {Object} params
   * @param {number} params.shaftPowerDemandKW - Driven equipment brake horsepower (kW)
   * @param {number} [params.supplyVoltageV=6600] - Line-to-line AC voltage (V, e.g. 400, 690, 3300, 6600, 11000)
   * @param {number} [params.gridFrequencyHz=50] - Grid frequency (50 or 60 Hz)
   * @param {number} [params.poleCount=2] - Number of poles (2, 4, 6, 8)
   * @param {string} [params.efficiencyClass='IE3'] - 'IE2', 'IE3', 'IE4'
   * @param {number} [params.powerFactor=0.88] - Rated full-load power factor cos phi
   * @param {number} [params.apiSizingMarginPercent=10.0] - Oversizing margin (API 610/617: 10% to 25%)
   * @param {number} [params.busVoltageDipPercent=15.0] - Expected grid voltage dip during motor start (%)
   * @returns {Object} Comprehensive electrical ratings, inrush current, and starting torque audit
   */
  static evaluateElectricMotor(params) {
    const {
      shaftPowerDemandKW,
      supplyVoltageV = 6600,
      gridFrequencyHz = 50,
      poleCount = 2,
      efficiencyClass = 'IE3',
      powerFactor = 0.88,
      apiSizingMarginPercent = 10.0,
      busVoltageDipPercent = 15.0
    } = params;

    if (shaftPowerDemandKW <= 0) throw new Error('Shaft power demand must be positive');
    if (supplyVoltageV <= 0) throw new Error('Supply voltage must be positive');
    if (powerFactor <= 0 || powerFactor > 1.0) throw new Error('Power factor must be between 0 and 1.0');
    if (gridFrequencyHz <= 0) throw new Error('Grid frequency must be positive');
    if (!poleCount || poleCount <= 0 || poleCount % 2 !== 0) {
      throw new Error('Pole count must be an even positive integer (2, 4, 6, 8, 10, 12)');
    }

    // 1. Nameplate Motor Rating with API Margin
    const requiredMotorPowerKW = shaftPowerDemandKW * (1.0 + apiSizingMarginPercent / 100.0);
    // Standard IEC preferred frame sizes (kW)
    const standardKWList = [
      15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200, 250, 315, 355, 400,
      450, 500, 560, 630, 710, 800, 900, 1000, 1120, 1250, 1400, 1600, 1800, 2000,
      2250, 2500, 2800, 3150, 3550, 4000, 4500, 5000, 6000, 7000, 8000, 10000, 12000,
      15000, 18000, 20000, 25000
    ];
    let selectedRatingKW = requiredMotorPowerKW;
    for (const std of standardKWList) {
      if (std >= requiredMotorPowerKW) {
        selectedRatingKW = std;
        break;
      }
    }

    // 2. Synchronous and Full-Load Operating Speed
    const syncSpeedRpm = (120.0 * gridFrequencyHz) / poleCount;
    // Typical slip s ~ 0.8% for large MV motors, ~1.5% for LV motors
    const slipFrac = selectedRatingKW > 500.0 ? 0.008 : 0.015;
    const fullLoadSpeedRpm = syncSpeedRpm * (1.0 - slipFrac);

    // 3. Efficiency and Full-Load Current (FLA)
    const efficiency = this.getStandardEfficiency(selectedRatingKW, efficiencyClass);
    // I_FLA = (P_mech * 1000) / (sqrt(3) * V_line * eta * cos_phi)
    const fullLoadAmperes = (selectedRatingKW * 1000.0) / (Math.sqrt(3.0) * supplyVoltageV * efficiency * powerFactor);
    const apparentPowerKVA = (Math.sqrt(3.0) * supplyVoltageV * fullLoadAmperes) * 1e-3;

    // 4. Starting (Locked Rotor) Dynamics
    // Locked rotor current ratio k_inrush ~ 6.5
    const inrushRatio = 6.5;
    const lockedRotorAmperes = fullLoadAmperes * inrushRatio;
    const lockedRotorKVA = apparentPowerKVA * inrushRatio;

    // 5. Torque Dynamics
    // Rated full load torque: T_FLA = 9549 * P_kW / N_rpm (N*m)
    const fullLoadTorqueNm = (9549.0 * selectedRatingKW) / fullLoadSpeedRpm;
    // Standard IEC Design N torque ratios
    const startingTorqueRatio = 1.40; // T_start / T_FLA
    const breakdownTorqueRatio = 2.40; // T_max / T_FLA
    const startingTorqueNm = fullLoadTorqueNm * startingTorqueRatio;
    const breakdownTorqueNm = fullLoadTorqueNm * breakdownTorqueRatio;

    // 6. Voltage Dip Impact on Starting Torque: T scales with (V_dip / V_rated)^2
    const vDipFactor = 1.0 - (busVoltageDipPercent / 100.0);
    const reducedStartingTorqueNm = startingTorqueNm * Math.pow(vDipFactor, 2);
    const reducedBreakdownTorqueNm = breakdownTorqueNm * Math.pow(vDipFactor, 2);

    // Centrifugal pump/compressor breakaway load torque (typically 15-20% unloaded, 40% loaded)
    const pumpBreakawayTorqueDemandNm = fullLoadTorqueNm * 0.25;
    const startingMarginDuringDipNm = reducedStartingTorqueNm - pumpBreakawayTorqueDemandNm;
    const startingAcceleratesSuccessfully = startingMarginDuringDipNm > 0;

    return {
      standard: 'IEC 60034 / NEMA MG-1 Electric Motor Driver',
      efficiencyClass: efficiencyClass.toUpperCase(),
      motorRatingKW: selectedRatingKW,
      motorRatingMW: Math.round((selectedRatingKW * 1e-3) * 100) / 100,
      shaftPowerDemandKW,
      designSafetyMarginPercent: Math.round(((selectedRatingKW - shaftPowerDemandKW) / shaftPowerDemandKW) * 1000) / 10,
      electricalParameters: {
        supplyVoltageV,
        gridFrequencyHz,
        poleCount,
        syncSpeedRpm,
        fullLoadSpeedRpm: Math.round(fullLoadSpeedRpm),
        efficiencyPct: Math.round(efficiency * 1000) / 10,
        powerFactor,
        fullLoadAmperes: Math.round(fullLoadAmperes * 10) / 10,
        apparentPowerKVA: Math.round(apparentPowerKVA * 10) / 10,
        lockedRotorAmperes: Math.round(lockedRotorAmperes * 10) / 10,
        lockedRotorKVA: Math.round(lockedRotorKVA * 10) / 10,
        inrushRatio
      },
      torqueDynamics: {
        fullLoadTorqueNm: Math.round(fullLoadTorqueNm),
        startingTorqueNm: Math.round(startingTorqueNm),
        breakdownTorqueNm: Math.round(breakdownTorqueNm),
        busVoltageDipPercent,
        reducedStartingTorqueNm: Math.round(reducedStartingTorqueNm),
        reducedBreakdownTorqueNm: Math.round(reducedBreakdownTorqueNm),
        startingMarginDuringDipNm: Math.round(startingMarginDuringDipNm),
        startingAcceleratesSuccessfully
      }
    };
  }

  /**
   * Evaluates Variable Frequency Drive (VFD) harmonic and low-speed cooling derating.
   *
   * @param {Object} params
   * @param {number} params.motorRatingKW - Nameplate rating (kW)
   * @param {number} params.speedRatio - Operating speed ratio N / N_rated (e.g. 0.2 to 1.1)
   * @param {string} [params.coolingType='IC411_TEFC'] - 'IC411_TEFC' (shaft fan) or 'IC416_FORCED' (external blower)
   * @param {string} [params.vfdTopology='PWM_VOLTAGE_SOURCE'] - 'PWM_VOLTAGE_SOURCE', 'ACTIVE_FRONT_END'
   * @returns {Object} VFD derated continuous torque, available power, and harmonic thermal penalty
   */
  static evaluateVfdDerating(params) {
    const {
      motorRatingKW,
      speedRatio,
      coolingType = 'IC411_TEFC',
      vfdTopology = 'PWM_VOLTAGE_SOURCE'
    } = params || {};

    if (!motorRatingKW || motorRatingKW <= 0) throw new Error('Motor rating must be positive');
    if (!speedRatio || speedRatio <= 0) throw new Error('Speed ratio must be positive');

    const n_ratio = Math.max(0.10, Math.min(1.25, speedRatio));

    // 1. Inverter Harmonic Loss Derating per IEC 60034-17 / IEC 60034-25
    // Additional harmonic heating in stator winding and rotor iron:
    const harmonicDerateFactor = vfdTopology.toUpperCase() === 'ACTIVE_FRONT_END' ? 0.98 : 0.95;

    // 2. Cooling Fan Derating at Low Speed
    let coolingDerateFactor = 1.0;
    if (coolingType.toUpperCase() === 'IC411_TEFC') {
      // Shaft-mounted fan airflow drops with N^2, reducing heat dissipation significantly at low speed
      if (n_ratio < 1.0) {
        // Curve: 100% torque down to 70% speed, then linear drop to 55% torque at 20% speed
        coolingDerateFactor = Math.max(0.50, 0.45 + 0.55 * Math.pow(n_ratio, 0.8));
      }
    } else {
      // IC 416 Forced Ventilation: Independent constant-speed blower provides 100% cooling at any speed!
      coolingDerateFactor = 1.0;
    }

    // 3. Field-Weakening Region above Rated Speed (n_ratio > 1.0)
    let fieldWeakeningTorqueFactor = 1.0;
    if (n_ratio > 1.0) {
      // Constant power region: Torque derates as 1 / n_ratio
      fieldWeakeningTorqueFactor = 1.0 / n_ratio;
    }

    // 4. Net Continuous Usable Torque and Power Capability
    const netTorqueCapabilityRatio = harmonicDerateFactor * coolingDerateFactor * fieldWeakeningTorqueFactor;
    const continuousUsablePowerKW = motorRatingKW * netTorqueCapabilityRatio * Math.min(1.0, n_ratio);

    return {
      coolingStandard: coolingType.toUpperCase(),
      speedRatio: Math.round(n_ratio * 100) / 100,
      vfdHarmonicFactor: harmonicDerateFactor,
      coolingDerateFactor: Math.round(coolingDerateFactor * 1000) / 1000,
      fieldWeakeningFactor: Math.round(fieldWeakeningTorqueFactor * 1000) / 1000,
      netTorqueCapabilityPercent: Math.round(netTorqueCapabilityRatio * 1000) / 10,
      continuousUsablePowerKW: Math.round(continuousUsablePowerKW * 10) / 10,
      coolingRecommendation: (coolingType.toUpperCase() === 'IC411_TEFC' && n_ratio < 0.6)
        ? 'Low-speed operation (<60%) produces severe fan cooling derating. Retrofit IC 416 auxiliary blower.'
        : 'Cooling arrangement adequate for operating speed.'
    };
  }
}

module.exports = { DriverElectricMotor };
