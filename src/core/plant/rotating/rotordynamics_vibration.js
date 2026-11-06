/**
 * API 684 / API 617 Rotordynamics & ISO 20816 Vibration Severity Engine.
 *
 * Implements:
 * 1. Jeffcott Rotor Lateral Dynamics:
 *    - Shaft elastic bending stiffness and hydrodynamic bearing oil-film stiffness series combination.
 *    - First (Nc1) and second (Nc2) lateral critical speeds.
 *    - Modal damping ratio zeta and Amplification Factor (AF) per API 684.
 * 2. API 617 / API 610 Lateral Separation Margins:
 *    - Over-damped vs resonant screening (AF < 2.5 vs AF >= 2.5).
 *    - Sub-critical and super-critical separation margin calculation (16% to 26%).
 * 3. ISO 20816-3 / ISO 10816 Vibration Severity Zone Evaluation:
 *    - Zone A: Newly commissioned machines.
 *    - Zone B: Unrestricted long-term continuous operation.
 *    - Zone C: Restricted operation / maintenance alarm.
 *    - Zone D: Critical vibration / automatic machine trip.
 * 4. API 670 Non-Contacting Eddy Current Probe Shaft Displacement Limits.
 */

'use strict';

class RotordynamicsVibration {
  /**
   * Evaluates Jeffcott flexible rotor lateral critical speeds and amplification factor per API 684.
   *
   * @param {Object} params
   * @param {number} params.rotorMassKg - Effective lumped rotor mass M (kg)
   * @param {number} params.shaftSpanMm - Bearing center-to-center span L (mm)
   * @param {number} params.shaftDiameterMm - Mean shaft core diameter d (mm)
   * @param {number} [params.shaftModulusGPa=206.0] - Young's modulus E (GPa)
   * @param {number} [params.bearingStiffnessNPerM=1.8e8] - Total hydrodynamic fluid-film bearing stiffness (N/m)
   * @param {number} [params.bearingDampingNsPerM=2.5e5] - Hydrodynamic fluid-film damping C (N*s/m)
   * @param {number} params.operatingSpeedRpm - Continuous operating speed (rpm)
   * @returns {Object} Critical speeds, system stiffness, damping ratio, and amplification factor
   */
  static evaluateJeffcottRotor(params) {
    const {
      rotorMassKg,
      shaftSpanMm,
      shaftDiameterMm,
      shaftModulusGPa = 206.0,
      bearingStiffnessNPerM = 1.8e8,
      bearingDampingNsPerM = 2.5e5,
      operatingSpeedRpm
    } = params;

    if (rotorMassKg <= 0) throw new Error('Rotor mass must be positive');
    if (shaftSpanMm <= 0 || shaftDiameterMm <= 0) throw new Error('Shaft dimensions must be positive');
    if (operatingSpeedRpm <= 0) throw new Error('Operating speed must be positive');
    if (bearingStiffnessNPerM <= 0) throw new Error('Bearing stiffness must be positive');

    const L = shaftSpanMm * 1e-3; // m
    const d = shaftDiameterMm * 1e-3; // m
    const E = shaftModulusGPa * 1e9; // Pa
    const M = rotorMassKg;

    // 1. Shaft Bending Stiffness: k_shaft = 48 * E * I / L^3
    const I = (Math.PI * Math.pow(d, 4)) / 64.0;
    const k_shaft = (48.0 * E * I) / Math.pow(L, 3);

    // 2. Combined System Stiffness (Shaft in series with 2 fluid-film bearings)
    // 1 / K_sys = 1 / k_shaft + 1 / (2 * K_brg)
    const K_brg_total = 2.0 * bearingStiffnessNPerM;
    const K_sys = 1.0 / (1.0 / k_shaft + 1.0 / K_brg_total);

    // 3. First Lateral Undamped Critical Speed: omega_n1 = sqrt(K_sys / M)
    const omega_n1_rad_s = Math.sqrt(K_sys / M);
    const Nc1_rpm = (60.0 * omega_n1_rad_s) / (2.0 * Math.PI);

    // 4. Second Lateral Critical Speed (typically flexible 2nd bending or pivoting mode)
    const Nc2_rpm = Nc1_rpm * 2.75;

    // 5. Modal Damping Ratio & API 684 Amplification Factor
    // C_crit = 2 * sqrt(K_sys * M)
    const C_crit = 2.0 * Math.sqrt(K_sys * M);
    const dampingRatio = Math.min(0.99, bearingDampingNsPerM / C_crit);
    // API 684 Amplification Factor: AF ~ 1 / (2 * zeta)
    const amplificationFactor = dampingRatio > 0 ? 1.0 / (2.0 * dampingRatio) : 25.0;

    return {
      standard: 'API 684 Rotordynamics Analysis',
      rotorMassKg,
      shaftSpanMm,
      shaftDiameterMm,
      stiffness: {
        shaftBendingStiffnessNPerM: Math.round(k_shaft),
        bearingStiffnessNPerM,
        combinedSystemStiffnessNPerM: Math.round(K_sys)
      },
      criticalSpeeds: {
        firstLateralCriticalSpeedRpm: Math.round(Nc1_rpm),
        secondLateralCriticalSpeedRpm: Math.round(Nc2_rpm),
        operatingSpeedRpm,
        speedRatioN1: Math.round((operatingSpeedRpm / Nc1_rpm) * 100) / 100,
        rotorRigidityType: operatingSpeedRpm < Nc1_rpm ? 'Rigid Shaft (Sub-critical)' : 'Flexible Shaft (Super-critical)'
      },
      damping: {
        dampingRatioZeta: Math.round(dampingRatio * 1000) / 1000,
        amplificationFactorAF: Math.round(amplificationFactor * 10) / 10,
        isCriticallyDamped: amplificationFactor < 2.5
      }
    };
  }

  /**
   * Evaluates API 617 / API 610 lateral separation margin requirements.
   *
   * @param {Object} params
   * @param {number} params.criticalSpeedRpm - Critical speed Nc (rpm)
   * @param {number} params.operatingSpeedRpm - Operating speed N (rpm)
   * @param {number} params.amplificationFactor - Amplification factor AF
   * @returns {Object} Separation margin requirement and clearance status
   */
  static evaluateSeparationMargin(params) {
    const {
      criticalSpeedRpm,
      operatingSpeedRpm,
      amplificationFactor
    } = params;

    if (criticalSpeedRpm <= 0 || operatingSpeedRpm <= 0) {
      throw new Error('Critical speed and operating speed must be positive');
    }
    if (amplificationFactor < 0) {
      throw new Error('Amplification factor cannot be negative');
    }

    const Nc = criticalSpeedRpm;
    const N = operatingSpeedRpm;
    const AF = amplificationFactor;

    // Per API 617 / API 610:
    // If AF < 2.5, response is critically damped; no separation margin is required.
    if (AF < 2.5) {
      return {
        amplificationFactor: AF,
        isWellDamped: true,
        separationMarginRequiredPercent: 0.0,
        meetsSeparationMargin: true,
        notes: 'Amplification Factor AF < 2.5; resonance is well-damped, no separation margin required per API 617.'
      };
    }

    // If AF >= 2.5, compute required margin per API formula:
    // SM = 16 + (AF - 2.5) / 5.5 * 10 (%) with a maximum cap of 26%
    const calculatedSM = 16.0 + ((AF - 2.5) / 5.5) * 10.0;
    const requiredSM_pct = Math.min(26.0, Math.max(16.0, calculatedSM));

    let meetsMargin = false;
    let actualMarginPct = 0.0;
    let allowableOperatingRange = {};

    if (N < Nc) {
      // Sub-critical operation: N must be below Nc by at least SM%
      // N <= Nc * (1 - SM/100)
      const maxAllowableSpeedRpm = Nc * (1.0 - requiredSM_pct / 100.0);
      actualMarginPct = ((Nc - N) / Nc) * 100.0;
      meetsMargin = N <= maxAllowableSpeedRpm;
      allowableOperatingRange = {
        mode: 'Sub-critical',
        maxContinuousSpeedRpm: Math.round(maxAllowableSpeedRpm)
      };
    } else {
      // Super-critical operation: N must be above Nc by at least SM%
      // N >= Nc * (1 + SM/100)
      const minAllowableSpeedRpm = Nc * (1.0 + requiredSM_pct / 100.0);
      actualMarginPct = ((N - Nc) / Nc) * 100.0;
      meetsMargin = N >= minAllowableSpeedRpm;
      allowableOperatingRange = {
        mode: 'Super-critical',
        minContinuousSpeedRpm: Math.round(minAllowableSpeedRpm)
      };
    }

    return {
      amplificationFactor: AF,
      isWellDamped: false,
      requiredSeparationMarginPercent: Math.round(requiredSM_pct * 10) / 10,
      actualSeparationMarginPercent: Math.round(actualMarginPct * 10) / 10,
      meetsSeparationMargin: meetsMargin,
      allowableOperatingRange,
      clearanceStatus: meetsMargin ? 'Acceptable separation margin maintained' : 'Operating speed in critical exclusion band'
    };
  }

  /**
   * Evaluates vibration severity per ISO 20816-3 and API 670 eddy-current probe criteria.
   *
   * @param {Object} params
   * @param {number} params.velocityRmsMmS - Measured casing vibration velocity (mm/s RMS)
   * @param {number} [params.shaftDisplacementPeakToPeakMicrons] - Relative shaft vibration (µm p-p)
   * @param {number} [params.operatingSpeedRpm=3000] - Machine speed (rpm)
   * @param {string} [params.machineGroup='GROUP_1'] - 'GROUP_1' (>300 kW) or 'GROUP_2' (15-300 kW)
   * @param {string} [params.supportRigidity='RIGID'] - 'RIGID' or 'FLEXIBLE'
   * @param {boolean} [params.strictCap25Microns=false] - If true, cap displacement at 25.4 µm (1 mil); default 50.8 µm (2 mils)
   * @returns {Object} Severity zone (A, B, C, D), alarm/trip state, and API 670 assessment
   */
  static evaluateVibrationSeverity(params) {
    const {
      velocityRmsMmS,
      shaftDisplacementPeakToPeakMicrons,
      operatingSpeedRpm = 3000,
      machineGroup = 'GROUP_1',
      supportRigidity = 'RIGID',
      strictCap25Microns = false
    } = params;

    if (velocityRmsMmS < 0) throw new Error('Vibration velocity cannot be negative');
    if (shaftDisplacementPeakToPeakMicrons !== undefined && shaftDisplacementPeakToPeakMicrons < 0) {
      throw new Error('Shaft displacement cannot be negative');
    }

    const v = velocityRmsMmS;
    const isLarge = machineGroup.toUpperCase() === 'GROUP_1';
    const isFlexible = supportRigidity.toUpperCase() === 'FLEXIBLE';

    // ISO 20816-3 vibration limits (mm/s RMS)
    // Thresholds: [Zone A/B, Zone B/C (Alarm), Zone C/D (Trip)]
    let limitAB;
    let limitBC;
    let limitCD;

    if (isLarge) {
      if (isFlexible) {
        limitAB = 2.8;
        limitBC = 5.3;
        limitCD = 8.5;
      } else {
        limitAB = 2.3;
        limitBC = 4.5;
        limitCD = 7.1;
      }
    } else {
      if (isFlexible) {
        limitAB = 1.8;
        limitBC = 3.5;
        limitCD = 5.6;
      } else {
        limitAB = 1.4;
        limitBC = 2.8;
        limitCD = 4.5;
      }
    }

    let zone;
    let status;
    if (v <= limitAB) {
      zone = 'A';
      status = 'New commissioning condition (Normal)';
    } else if (v <= limitBC) {
      zone = 'B';
      status = 'Unrestricted long-term continuous operation';
    } else if (v <= limitCD) {
      zone = 'C';
      status = 'Restricted operation (Alarm - corrective action recommended)';
    } else {
      zone = 'D';
      status = 'Severe vibration (Automatic machine trip mandatory)';
    }

    // API 670 Shaft Displacement Check
    // A_max = 25.4 * sqrt(12000 / N) microns peak-to-peak, capped at 50.8 µm (2 mils) or 25.4 µm (strict)
    let shaftAudit = null;
    if (shaftDisplacementPeakToPeakMicrons !== undefined) {
      const maxCapMicrons = strictCap25Microns ? 25.4 : 50.8;
      const apiAllowableDisplacementMicrons = Math.min(maxCapMicrons, 25.4 * Math.sqrt(12000.0 / Math.max(600.0, operatingSpeedRpm)));
      const tripLimitMicrons = apiAllowableDisplacementMicrons * 1.5;
      shaftAudit = {
        measuredPeakToPeakMicrons: shaftDisplacementPeakToPeakMicrons,
        api670AllowableMicrons: Math.round(apiAllowableDisplacementMicrons * 10) / 10,
        api670TripLimitMicrons: Math.round(tripLimitMicrons * 10) / 10,
        meetsApi670Displacement: shaftDisplacementPeakToPeakMicrons <= apiAllowableDisplacementMicrons,
        tripRequired: shaftDisplacementPeakToPeakMicrons > tripLimitMicrons
      };
    }

    return {
      standard: 'ISO 20816-3 Vibration Severity',
      machineGroup: isLarge ? 'Group 1 (>300 kW Turbomachinery)' : 'Group 2 (15-300 kW Medium Machinery)',
      supportRigidity: isFlexible ? 'Flexible Support' : 'Rigid Foundation',
      measuredVelocityRmsMmS: v,
      severityZone: zone,
      zoneThresholdsMmS: {
        zoneA_B_boundary: limitAB,
        zoneB_C_alarmBoundary: limitBC,
        zoneC_D_tripBoundary: limitCD
      },
      operationalState: status,
      isAlarmActive: zone === 'C' || zone === 'D',
      isTripActive: zone === 'D' || Boolean(shaftAudit && shaftAudit.tripRequired),
      shaftDisplacementEvaluation: shaftAudit
    };
  }
}

module.exports = { RotordynamicsVibration };
