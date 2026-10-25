/**
 * Experimental simplified piping stress estimate.
 * This is not an ASME B31.3/B31.1 implementation or a code compliance check.
 */
'use strict';

// Legacy exports remain available, but records stay empty until their sources
// and redistribution rights are reviewed.
const PIPING_MATERIALS = Object.freeze({});
const ASME_PIPE_SCHEDULES = Object.freeze({});

class PipingStressEngine {
  /**
   * Estimate pressure hoop stress and a simplified thermal response.
   * Every physical input is supplied by the caller; no material or pipe
   * schedule records are bundled with this experimental example.
   */
  static evaluateASMEB313(config) {
    const baseFields = [
      'pipeOuterDiameterMm',
      'nominalWallThicknessMm',
      'youngsModulusGPa',
      'thermalExpansionPerK',
      'designPressureBar',
      'operatingTempC',
      'ambientTempC',
      'straightLengthM',
      'hasExpansionLoop',
      'corrosionAllowanceMm'
    ];
    const unavailable = (error, missingInputs = []) => ({
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      error,
      ...(missingInputs.length > 0 ? { missingInputs } : {})
    });
    const invalid = (error) => ({
      success: false,
      status: 'invalid',
      validationLevel: 'experimental',
      error
    });

    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return unavailable('A piping estimate input object is required. No calculation was run.');
    }

    if (typeof config.hasExpansionLoop !== 'boolean') {
      const missingOrInvalid = baseFields.filter(
        (field) =>
          !Object.prototype.hasOwnProperty.call(config, field) || config[field] === null || config[field] === undefined
      );
      if (!missingOrInvalid.includes('hasExpansionLoop')) missingOrInvalid.push('hasExpansionLoop');
      return unavailable(
        `Required inputs missing or invalid: ${missingOrInvalid.join(', ')}. No calculation was run.`,
        missingOrInvalid
      );
    }
    const requiredFields = config.hasExpansionLoop
      ? [...baseFields, 'loopHeightM', 'elbowCenterlineRadiusM']
      : baseFields;
    const missingInputs = requiredFields.filter(
      (field) =>
        !Object.prototype.hasOwnProperty.call(config, field) || config[field] === null || config[field] === undefined
    );
    if (missingInputs.length > 0) {
      return unavailable(
        `Required inputs missing: ${missingInputs.join(', ')}. No calculation was run.`,
        missingInputs
      );
    }

    const numericFields = requiredFields.filter((field) => field !== 'hasExpansionLoop');
    const invalidNumbers = numericFields.filter(
      (field) => typeof config[field] !== 'number' || !Number.isFinite(config[field])
    );
    if (invalidNumbers.length > 0) {
      return invalid(`Inputs must be finite numbers: ${invalidNumbers.join(', ')}.`);
    }

    const {
      pipeOuterDiameterMm,
      nominalWallThicknessMm,
      youngsModulusGPa,
      thermalExpansionPerK,
      designPressureBar,
      operatingTempC,
      ambientTempC,
      straightLengthM,
      hasExpansionLoop,
      loopHeightM,
      elbowCenterlineRadiusM,
      corrosionAllowanceMm
    } = config;

    if (pipeOuterDiameterMm <= 0) return invalid('pipeOuterDiameterMm must be greater than zero.');
    if (nominalWallThicknessMm <= 0 || nominalWallThicknessMm >= pipeOuterDiameterMm / 2) {
      return invalid('nominalWallThicknessMm must be positive and less than half the outer diameter.');
    }
    if (youngsModulusGPa <= 0) return invalid('youngsModulusGPa must be greater than zero.');
    if (thermalExpansionPerK < 0) return invalid('thermalExpansionPerK cannot be negative.');
    if (designPressureBar <= 0) return invalid('designPressureBar must be greater than zero.');
    if (operatingTempC <= -273.15 || ambientTempC <= -273.15) {
      return invalid('Temperatures must be above absolute zero in degrees Celsius.');
    }
    if (straightLengthM <= 0) return invalid('straightLengthM must be greater than zero.');
    if (corrosionAllowanceMm < 0 || corrosionAllowanceMm >= nominalWallThicknessMm) {
      return invalid('corrosionAllowanceMm must be nonnegative and less than nominalWallThicknessMm.');
    }
    if (hasExpansionLoop && (loopHeightM <= 0 || elbowCenterlineRadiusM <= 0)) {
      return invalid('Loop height and elbow centerline radius must be positive.');
    }

    const outerDiameterM = pipeOuterDiameterMm / 1000;
    const netWallThicknessM = (nominalWallThicknessMm - corrosionAllowanceMm) / 1000;
    const pressurePa = designPressureBar * 1e5;
    const deltaT = operatingTempC - ambientTempC;
    const hoopStressMPa = (pressurePa * outerDiameterM) / (2 * netWallThicknessM * 1e6);
    const thermalElongationMm = thermalExpansionPerK * straightLengthM * deltaT * 1000;

    let expansionStressMPa;
    if (hasExpansionLoop) {
      const hFactor =
        (netWallThicknessM * elbowCenterlineRadiusM) / Math.pow((outerDiameterM - netWallThicknessM) / 2, 2);
      const elbowStressMultiplier = hFactor > 0 ? Math.max(1, 0.9 / Math.pow(hFactor, 2 / 3)) : 1;
      expansionStressMPa =
        (elbowStressMultiplier * youngsModulusGPa * 1000 * (thermalElongationMm / 1000) * (outerDiameterM / 2)) /
        loopHeightM ** 2;
    } else {
      expansionStressMPa = youngsModulusGPa * 1000 * thermalExpansionPerK * deltaT;
    }

    return {
      success: true,
      status: 'estimate',
      validationLevel: 'experimental',
      dataStatus: 'user-supplied-unverified-inputs',
      model: 'simplified illustrative piping stress estimate',
      screeningStatus: 'EXPERIMENTAL_SCREENING_ONLY',
      modelAssumptions: [
        'User-supplied material and geometric inputs have not been independently reviewed.',
        'The thin-wall pressure relation and reduced thermal model are illustrative only.',
        'No stress allowable, compliance threshold, or pass/fail decision is calculated.'
      ],
      pipeOuterDiameter_mm: pipeOuterDiameterMm,
      netWallThickness_mm: +(netWallThicknessM * 1000).toFixed(3),
      youngsModulus_GPa: youngsModulusGPa,
      thermalExpansion_perK: thermalExpansionPerK,
      designPressure_bar: designPressureBar,
      operatingTemp_C: operatingTempC,
      ambientTemp_C: ambientTempC,
      thermalElongation_mm: +thermalElongationMm.toFixed(3),
      hoopStress_MPa: +hoopStressMPa.toFixed(3),
      expansionStress_MPa: +expansionStressMPa.toFixed(3)
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PIPING_MATERIALS, ASME_PIPE_SCHEDULES, PipingStressEngine };
}
