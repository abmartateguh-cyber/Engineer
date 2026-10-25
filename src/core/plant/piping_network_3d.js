/**
 * Experimental piping geometry helpers.
 * These calculations are not ASME B31.3/B31.1 code factors or assessments.
 */
'use strict';

const { PipingStressEngine } = require('./piping_stress');

class PipingNetwork3D {
  /** Compatibility alias for the explicitly parameterized estimate. */
  computeASMEB313ElbowSIF(elbowParams) {
    if (!elbowParams || typeof elbowParams !== 'object' || Array.isArray(elbowParams)) {
      return {
        success: false,
        status: 'unavailable',
        validationLevel: 'experimental',
        error: 'Explicit elbow geometry inputs are required. No calculation was run.'
      };
    }

    const result = PipingNetwork3D.computeElbowFactors(
      elbowParams.outerDiameterMm,
      elbowParams.wallThicknessMm,
      elbowParams.bendRadiusMm
    );
    return result.success
      ? { ...result, sifInPlane_ii: result.inPlaneSIF_ii, sifOutOfPlane_io: result.outOfPlaneSIF_io }
      : result;
  }

  /** Compatibility alias; no values are supplied when fields are missing. */
  evaluatePipelineStressRange(params) {
    const result = PipingStressEngine.evaluateASMEB313(params);
    return result.success
      ? { ...result, codeAssessment: 'NOT_PERFORMED', thermalExpansionStressEstimateMPa: result.expansionStress_MPa }
      : result;
  }

  /**
   * Estimate geometric multipliers from explicit outside diameter, wall
   * thickness, and elbow centerline radius. This does not return a code factor.
   */
  static computeElbowFactors(outerDiameterMm, wallThicknessMm, bendRadiusMm) {
    const inputs = { outerDiameterMm, wallThicknessMm, bendRadiusMm };
    const missingInputs = Object.entries(inputs)
      .filter(([, value]) => value === undefined || value === null)
      .map(([name]) => name);
    if (missingInputs.length > 0) {
      return {
        success: false,
        status: 'unavailable',
        validationLevel: 'experimental',
        error: `Required inputs missing: ${missingInputs.join(', ')}. No calculation was run.`,
        missingInputs
      };
    }

    const nonFinite = Object.entries(inputs)
      .filter(([, value]) => typeof value !== 'number' || !Number.isFinite(value))
      .map(([name]) => name);
    if (nonFinite.length > 0) {
      return {
        success: false,
        status: 'invalid',
        validationLevel: 'experimental',
        error: `Inputs must be finite numbers: ${nonFinite.join(', ')}.`
      };
    }
    if (outerDiameterMm <= 0 || wallThicknessMm <= 0 || wallThicknessMm >= outerDiameterMm / 2 || bendRadiusMm <= 0) {
      return {
        success: false,
        status: 'invalid',
        validationLevel: 'experimental',
        error: 'Diameter, wall thickness, and bend radius are outside the supported geometric ranges.'
      };
    }

    const meanRadiusMm = (outerDiameterMm - wallThicknessMm) / 2;
    const h = (wallThicknessMm * bendRadiusMm) / (meanRadiusMm * meanRadiusMm);
    const k = Math.max(1.0, 1.65 / Math.max(0.01, h));
    const inPlaneSIF = Math.max(1.0, 0.9 / Math.pow(Math.max(0.01, h), 2 / 3));
    const outOfPlaneSIF = Math.max(1.0, 0.75 / Math.pow(Math.max(0.01, h), 2 / 3));

    return {
      success: true,
      status: 'estimate',
      validationLevel: 'experimental',
      codeAssessment: 'NOT_PERFORMED',
      outerDiameterMm,
      wallThicknessMm,
      bendRadiusMm,
      flexibilityCharacteristic_h: Number(h.toFixed(4)),
      flexibilityFactor_k: Number(k.toFixed(3)),
      inPlaneSIF_ii: Number(inPlaneSIF.toFixed(3)),
      outOfPlaneSIF_io: Number(outOfPlaneSIF.toFixed(3)),
      note: 'These illustrative geometry multipliers are not ASME code factors.'
    };
  }

  /** @deprecated Use PipingStressEngine with all required inputs. */
  static evaluateASMEPipingStress(pipeData) {
    return PipingStressEngine.evaluateASMEB313(pipeData);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PipingNetwork3D };
}
