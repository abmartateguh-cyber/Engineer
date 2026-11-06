/**
 * Hydraulic Institute (HI 12.1-12.6) Slurry Pump & Progressive Cavity Pump (PCP) Engine.
 *
 * Implements:
 * 1. HI 12.1-12.6 Slurry Pump Head and Efficiency Derating:
 *    - Head ratio (HR) and Efficiency ratio (ER) as functions of solids concentration (Cv, Cw),
 *      solids specific gravity (Ss), and median particle size (d50).
 *    - Slurry mixture density and hydraulic power escalation.
 * 2. Critical Deposition Velocity & Settling Analysis:
 *    - Durand and Wasp equations for limiting deposition velocity VL.
 *    - Minimum flow velocity criteria to prevent pipeline sanding.
 * 3. Progressive Cavity Pump (PCP / Moineau Mechanism) Sizing:
 *    - Rotor-stator geometry: eccentricity (e), rotor diameter (d), and stator pitch (Ps).
 *    - Theoretical swept volume displacement.
 *    - Stage count determination based on differential pressure (typically 6 bar/stage).
 *    - Elastomeric stator thermal and chemical compatibility.
 */

'use strict';

class PumpSlurryProgressiveCavity {
  /**
   * Evaluates slurry centrifugal pump head and efficiency derating per HI 12.1-12.6.
   *
   * @param {Object} params
   * @param {number} params.clearWaterFlowRateM3H - Clean water flow rate Q (m3/h)
   * @param {number} params.clearWaterHeadM - Clean water total dynamic head Hw (m)
   * @param {number} params.clearWaterEfficiency - Clean water pump efficiency (typically 0.70-0.85)
   * @param {number} params.solidsSpecificGravity - Solids specific gravity Ss (e.g. 2.65 sand, 4.2 barite)
   * @param {number} [params.solidsVolumeFractionCv] - Solids volume fraction (0.05 to 0.45)
   * @param {number} [params.solidsWeightFractionCw] - Solids weight fraction (alternative to Cv)
   * @param {number} params.medianParticleDiameterMicrons - Median particle size d50 (microns, e.g. 50-800 µm)
   * @returns {Object} Slurry mixture density, derated head Hm, derated efficiency eta_m, and power
   */
  static evaluateSlurryPumpDerating(params) {
    const {
      clearWaterFlowRateM3H,
      clearWaterHeadM,
      clearWaterEfficiency,
      solidsSpecificGravity,
      solidsVolumeFractionCv,
      solidsWeightFractionCw,
      medianParticleDiameterMicrons
    } = params;

    if (clearWaterFlowRateM3H <= 0) throw new Error('Clean water flow rate must be positive');
    if (clearWaterHeadM <= 0) throw new Error('Clean water head must be positive');
    if (clearWaterEfficiency <= 0 || clearWaterEfficiency > 1.0) {
      throw new Error('Clean water efficiency must be between 0 and 1.0');
    }
    if (solidsSpecificGravity <= 1.0) throw new Error('Solids specific gravity must exceed 1.0');
    const Ss = solidsSpecificGravity;

    // Calculate volume concentration Cv and weight concentration Cw consistently
    let Cv;
    let Cw;
    if (solidsVolumeFractionCv !== undefined) {
      Cv = Math.max(0.01, Math.min(0.55, solidsVolumeFractionCv));
      Cw = (Cv * Ss) / (1.0 + Cv * (Ss - 1.0));
    } else if (solidsWeightFractionCw !== undefined) {
      Cw = Math.max(0.01, Math.min(0.80, solidsWeightFractionCw));
      Cv = Cw / (Ss - Cw * (Ss - 1.0));
    } else {
      throw new Error('Either solidsVolumeFractionCv or solidsWeightFractionCw must be supplied');
    }

    const d50 = Math.max(10.0, medianParticleDiameterMicrons);

    // Slurry mixture specific gravity Sm and mixture density (kg/m3)
    const Sm = 1.0 + Cv * (Ss - 1.0);
    const slurryDensityKgM3 = Sm * 1000.0;

    // Hydraulic Institute (HI 12.1-12.6) Head Ratio (HR) and Efficiency Ratio (ER):
    // HR = Hm / Hw = 1 - B * Cw^0.7 * ln(d50 / d_ref)
    // where B is a function of solids specific gravity: B = 0.00038 * (Ss - 1)
    const B = 0.00036 * (Ss - 1.0);
    const Cw_pct = Cw * 100.0;
    const derateTerm = B * Math.pow(Cw_pct, 0.72) * Math.log(Math.max(15.0, d50));
    const headRatioHR = Math.max(0.55, Math.min(1.0, 1.0 - derateTerm));

    // Efficiency Ratio (ER): In heavy slurries, efficiency drops faster than head due to disc friction
    const efficiencyRatioER = Math.max(0.50, Math.min(1.0, 1.0 - 1.18 * (1.0 - headRatioHR)));

    // Slurry pumping performance
    const slurryHeadM = clearWaterHeadM * headRatioHR;
    const slurryEfficiency = clearWaterEfficiency * efficiencyRatioER;

    // Power calculations
    const g = 9.80665;
    const Q_m3_s = clearWaterFlowRateM3H / 3600.0;
    const cleanWaterPowerKW = (1000.0 * g * Q_m3_s * clearWaterHeadM * 1e-3) / clearWaterEfficiency;
    const slurryShaftPowerKW = (slurryDensityKgM3 * g * Q_m3_s * slurryHeadM * 1e-3) / slurryEfficiency;

    return {
      standard: 'Hydraulic Institute HI 12.1-12.6 Slurry Centrifugal',
      solidsProperties: {
        specificGravity: Ss,
        medianParticleSizeD50Microns: d50,
        volumeConcentrationPercent: Math.round(Cv * 1000) / 10,
        weightConcentrationPercent: Math.round(Cw * 1000) / 10,
        slurrySpecificGravity: Math.round(Sm * 1000) / 1000,
        slurryDensityKgM3: Math.round(slurryDensityKgM3)
      },
      deratingFactors: {
        headRatioHR: Math.round(headRatioHR * 1000) / 1000,
        efficiencyRatioER: Math.round(efficiencyRatioER * 1000) / 1000
      },
      hydraulicPerformance: {
        flowRateM3H: clearWaterFlowRateM3H,
        clearWaterHeadM,
        slurryHeadM: Math.round(slurryHeadM * 10) / 10,
        clearWaterEfficiencyPct: Math.round(clearWaterEfficiency * 1000) / 10,
        slurryEfficiencyPct: Math.round(slurryEfficiency * 1000) / 10,
        clearWaterPowerKW: Math.round(cleanWaterPowerKW * 10) / 10,
        slurryShaftPowerKW: Math.round(slurryShaftPowerKW * 10) / 10,
        powerMultiplierVsWater: Math.round((slurryShaftPowerKW / cleanWaterPowerKW) * 100) / 100
      }
    };
  }

  /**
   * Calculates critical deposition velocity to prevent pipeline settling and sanding.
   *
   * @param {Object} params
   * @param {number} params.pipeInternalDiameterMm - Pipe internal diameter (mm)
   * @param {number} params.solidsSpecificGravity - Ss
   * @param {number} params.volumeConcentrationCv - Cv (0.05 to 0.40)
   * @param {number} params.medianParticleDiameterMicrons - d50 (µm)
   * @returns {Object} Critical deposition velocity and minimum operating transport velocity
   */
  static evaluateCriticalDepositionVelocity(params) {
    const {
      pipeInternalDiameterMm,
      solidsSpecificGravity,
      volumeConcentrationCv,
      medianParticleDiameterMicrons
    } = params;

    if (pipeInternalDiameterMm <= 0) throw new Error('Pipe internal diameter must be positive');
    if (solidsSpecificGravity <= 1.0) throw new Error('Solids specific gravity must exceed 1.0');

    const D = pipeInternalDiameterMm * 1e-3; // m
    const g = 9.80665;
    const Ss = solidsSpecificGravity;
    const Cv = volumeConcentrationCv;
    const d50_mm = medianParticleDiameterMicrons * 1e-3;

    // Durand-Condolios FL factor parameterization
    // FL varies from 1.0 to 1.35 depending on particle size and volume fraction
    const FL = Math.min(1.35, 0.95 + 0.15 * Math.log10(Math.max(0.05, d50_mm)) + 0.5 * Cv);

    // Durand critical deposition velocity: VL = FL * sqrt(2 * g * D * (Ss - 1))
    const criticalVelocityMS = FL * Math.sqrt(2.0 * g * D * (Ss - 1.0));

    // API / HI recommended minimum operating slurry velocity: 25% margin over deposition
    const minOperatingVelocityMS = criticalVelocityMS * 1.25;

    // Pipe flow rate at minimum velocity (m3/h)
    const pipeAreaM2 = (Math.PI * Math.pow(D, 2)) / 4.0;
    const minTransportFlowM3H = minOperatingVelocityMS * pipeAreaM2 * 3600.0;

    return {
      pipeDiameterMm: pipeInternalDiameterMm,
      durandFactorFL: Math.round(FL * 100) / 100,
      criticalDepositionVelocityMS: Math.round(criticalVelocityMS * 100) / 100,
      recommendedMinOperatingVelocityMS: Math.round(minOperatingVelocityMS * 100) / 100,
      minTransportFlowM3H: Math.round(minTransportFlowM3H * 10) / 10,
      guideline: 'Maintain slurry pipeline velocity strictly above recommended minimum to prevent bed formation.'
    };
  }

  /**
   * Sizes a progressive cavity pump (PCP / Moineau mechanism).
   *
   * @param {Object} params
   * @param {number} params.rotorDiameterMm - Rotor major diameter d (mm)
   * @param {number} params.eccentricityMm - Rotor eccentricity e (mm)
   * @param {number} params.statorPitchMm - Stator pitch Ps (mm)
   * @param {number} params.speedRpm - Operating speed (rpm, typically 100-500 rpm)
   * @param {number} params.differentialPressureBar - Required discharge pressure boost (bar)
   * @param {number} [params.dynamicViscosityCP=100.0] - Fluid viscosity (cP)
   * @param {string} [params.elastomerType='NBR'] - 'NBR', 'HNBR', 'EPDM', 'FKM_VITON'
   * @returns {Object} Displacement, stage count, cavity volume, volumetric efficiency, and driver sizing
   */
  static evaluateProgressiveCavityPump(params) {
    const {
      rotorDiameterMm,
      eccentricityMm,
      statorPitchMm,
      speedRpm,
      differentialPressureBar,
      dynamicViscosityCP = 100.0,
      elastomerType = 'NBR'
    } = params;

    if (rotorDiameterMm <= 0 || eccentricityMm <= 0 || statorPitchMm <= 0) {
      throw new Error('Rotor diameter, eccentricity, and stator pitch must be positive');
    }
    if (speedRpm <= 0) throw new Error('Operating speed must be positive');
    if (differentialPressureBar <= 0) throw new Error('Differential pressure must be positive');
    if (dynamicViscosityCP <= 0) throw new Error('Viscosity must be positive');

    const d = rotorDiameterMm * 1e-3; // m
    const e = eccentricityMm * 1e-3; // m
    const Ps = statorPitchMm * 1e-3; // m

    // Theoretical swept displacement per revolution for 1:2 internal lobe geometry:
    // V_rev = 4 * e * d * Ps (m3/rev)
    const sweptDisplacementM3Rev = 4.0 * e * d * Ps;
    const sweptDisplacementLitersRev = sweptDisplacementM3Rev * 1000.0;

    // Theoretical capacity at speed N (m3/h)
    const theoreticalCapacityM3H = sweptDisplacementM3Rev * speedRpm * 60.0;

    // Pressure capability per stage (typically 6.0 bar per stator pitch stage)
    const maxBarPerStage = 6.0;
    const requiredStages = Math.max(1, Math.ceil(differentialPressureBar / maxBarPerStage));
    const actualPressurePerStageBar = differentialPressureBar / requiredStages;

    // Volumetric efficiency: increases with viscosity and drops with pressure per stage
    const slipFactor = (actualPressurePerStageBar / 6.0) * (15.0 / Math.pow(Math.max(1.0, dynamicViscosityCP), 0.35));
    const volumetricEfficiency = Math.max(0.60, Math.min(0.96, 0.94 - 0.01 * slipFactor));
    const actualCapacityM3H = theoreticalCapacityM3H * volumetricEfficiency;

    // Hydraulic and Mechanical Power
    const Q_actual_m3_s = actualCapacityM3H / 3600.0;
    const hydraulicPowerKW = (Q_actual_m3_s * differentialPressureBar * 1e5) * 1e-3;
    // Elastomer interference friction and viscous drag
    const frictionLossKW = (0.8 + 0.15 * requiredStages) * (speedRpm / 300.0);
    const totalShaftPowerKW = hydraulicPowerKW + frictionLossKW;

    // Stator elastomer operational guidelines
    const elastomerLimits = {
      NBR: { maxTempC: 100.0, oilResistance: 'Good', acidResistance: 'Fair' },
      HNBR: { maxTempC: 135.0, oilResistance: 'Excellent', acidResistance: 'Good' },
      EPDM: { maxTempC: 140.0, oilResistance: 'Poor (Swells in oil)', acidResistance: 'Excellent' },
      FKM_VITON: { maxTempC: 180.0, oilResistance: 'Excellent', acidResistance: 'Superior' }
    };
    const selectedElastomer = elastomerLimits[elastomerType.toUpperCase()] || elastomerLimits.NBR;

    return {
      mechanism: 'Progressive Cavity Pump (Moineau Principle)',
      geometry: {
        rotorDiameterMm,
        eccentricityMm,
        statorPitchMm,
        displacementLitersPerRev: Math.round(sweptDisplacementLitersRev * 1000) / 1000
      },
      stageStaging: {
        totalDifferentialPressureBar: differentialPressureBar,
        requiredStatorStages: requiredStages,
        pressurePerStageBar: Math.round(actualPressurePerStageBar * 100) / 100,
        maxAllowableBarPerStage: maxBarPerStage
      },
      performance: {
        operatingSpeedRpm: speedRpm,
        theoreticalFlowM3H: Math.round(theoreticalCapacityM3H * 100) / 100,
        volumetricEfficiencyPct: Math.round(volumetricEfficiency * 1000) / 10,
        actualDeliveredFlowM3H: Math.round(actualCapacityM3H * 100) / 100,
        hydraulicPowerKW: Math.round(hydraulicPowerKW * 10) / 10,
        statorFrictionLossKW: Math.round(frictionLossKW * 10) / 10,
        shaftPowerKW: Math.round(totalShaftPowerKW * 10) / 10
      },
      elastomerStator: {
        material: elastomerType.toUpperCase(),
        maxOperatingTempC: selectedElastomer.maxTempC,
        oilResistance: selectedElastomer.oilResistance,
        chemicalSuitability: selectedElastomer.acidResistance
      }
    };
  }
}

module.exports = { PumpSlurryProgressiveCavity };
