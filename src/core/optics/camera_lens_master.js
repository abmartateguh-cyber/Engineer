/**
 * Compatibility adapters for experimental optical algorithms using explicit
 * caller-supplied prescriptions. No default lens, material catalog, measured
 * performance, or commercial comparison data is bundled.
 */

'use strict';

const { DampedLeastSquaresOptimizer } = require('./damped_least_squares_optimizer');
const { OpticalEngine } = require('./optical_engine');

class CameraLensMaster {
  static unavailable(operation) {
    return {
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      operation,
      error: 'No independently sourced lens prescription or measured performance data is available.'
    };
  }

  static _runExplicitCalculation(operation, calculate, assumptions) {
    try {
      const result = calculate();
      return {
        ...result,
        success: true,
        status: 'computed',
        validationLevel: 'experimental',
        operation,
        assumptions
      };
    } catch (error) {
      return {
        success: false,
        status: 'invalid-input',
        validationLevel: 'experimental',
        operation,
        error: { code: 'INVALID_INPUT', message: error.message }
      };
    }
  }

  static getPrescription(prescription) {
    if (prescription === undefined) return this.unavailable('prescription');
    return this._runExplicitCalculation(
      'prescription',
      () => ({ prescription: OpticalEngine._requirePrescription(prescription) }),
      ['The prescription and material values are caller supplied and have not been independently reviewed.']
    );
  }
  static traceParaxialSystem(system, options) {
    if (!system || !Array.isArray(system.surfaces) || system.surfaces.length === 0) {
      return this.unavailable('paraxial-trace');
    }

    const initialRefractiveIndexIsValid =
      Number.isFinite(system.initialRefractiveIndex) && system.initialRefractiveIndex > 0;
    const invalidSurfaceIndex = system.surfaces.findIndex((surface, index) => {
      if (!surface || typeof surface !== 'object') return true;
      const hasRadius = Number.isFinite(surface.radius) && surface.radius !== 0;
      const hasCurvature = Number.isFinite(surface.curvature);
      const validThickness =
        index === system.surfaces.length - 1 || (Number.isFinite(surface.thickness) && surface.thickness >= 0);
      return (
        (!hasRadius && !hasCurvature) ||
        !Number.isFinite(surface.refractiveIndex) ||
        surface.refractiveIndex <= 0 ||
        !validThickness
      );
    });

    const rayHeightMm = options?.rayHeightMm;
    const rayAngleRad = options?.rayAngleRad;
    if (
      !initialRefractiveIndexIsValid ||
      invalidSurfaceIndex !== -1 ||
      !Number.isFinite(rayHeightMm) ||
      rayHeightMm <= 0 ||
      !Number.isFinite(rayAngleRad)
    ) {
      return {
        success: false,
        status: 'invalid-input',
        validationLevel: 'experimental',
        error: {
          code: 'INVALID_INPUT',
          message: !initialRefractiveIndexIsValid
            ? 'An explicit positive initialRefractiveIndex is required.'
            : invalidSurfaceIndex !== -1
              ? `Invalid or incomplete paraxial surface at index ${invalidSurfaceIndex}.`
              : 'Explicit positive rayHeightMm and finite rayAngleRad inputs are required.'
        }
      };
    }

    const ray = new DampedLeastSquaresOptimizer().traceMeridionalRay(system, rayHeightMm, rayAngleRad);
    return {
      success: true,
      status: 'computed',
      validationLevel: 'experimental',
      rayHeightMm,
      rayAngleRad,
      ...ray,
      assumptions: [
        'First-order paraxial refraction is used at each supplied surface.',
        'The initial medium index and each post-surface refractive index are caller-supplied.',
        'Independent optical validation is unavailable.'
      ]
    };
  }
  static evaluateChromaticAberration(prescription, options) {
    if (prescription === undefined) return this.unavailable('chromatic-aberration');
    return this._runExplicitCalculation(
      'chromatic-aberration',
      () => {
        const result = OpticalEngine.computeSeidelAberrations(prescription, options);
        return {
          longitudinalChromaticMm: result.seidelSums.CL_LongitudinalChromatic,
          transverseChromaticMm: result.seidelSums.CT_TransverseChromatic,
          seidelSums: result.seidelSums
        };
      },
      [
        'Chromatic terms use the caller supplied Fraunhofer F/C refractive indices.',
        'Units follow the experimental Seidel implementation and millimetre-based prescription inputs.'
      ]
    );
  }
  static evaluateSeidelAberrations(prescription, options) {
    if (prescription === undefined) return this.unavailable('seidel-aberrations');
    return this._runExplicitCalculation(
      'seidel-aberrations',
      () => OpticalEngine.computeSeidelAberrations(prescription, options),
      [
        'Surface geometry and optical properties are caller supplied.',
        'The Seidel calculation is experimental and has no independent optical accuracy evidence.'
      ]
    );
  }
  static evaluateMTFPerformance(prescription, options) {
    if (prescription === undefined) return this.unavailable('mtf');
    return this._runExplicitCalculation('mtf', () => OpticalEngine.traceExactSkewRays(prescription, options), [
      'The ray trace uses caller supplied prescription, wavelength, aperture, field, pupil sampling, sensor plane, and frequency range.',
      'MTF is an experimental geometric spot-size approximation, not an independently verified diffraction calculation.'
    ]);
  }
  static evaluateAutofocusMechatronics() {
    return this.unavailable('autofocus');
  }
  static evaluateOISPerformance() {
    return this.unavailable('ois');
  }
  static evaluateAthermalization() {
    return this.unavailable('athermalization');
  }
  static evaluateAntiReflectiveCoating() {
    return this.unavailable('coating');
  }
  static getDetailedInternalComponents() {
    return this.unavailable('internal-components');
  }
  static getCompetitorComparison() {
    return this.unavailable('competitor-comparison');
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { CameraLensMaster };
if (typeof window !== 'undefined') window.CameraLensMaster = CameraLensMaster;
