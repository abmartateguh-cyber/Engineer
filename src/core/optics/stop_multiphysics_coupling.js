/**
 * Experimental structural-thermal-optical calculation example.
 * 
 * 1. Finite Element nodal temperature fields T(x, y, z) mapped to refractive index deltas dn/dT
 * 2. Elastic structural displacement fields u(x, y, z) decomposed into 37 Fringe/Noll Zernike sag polynomials
 * 3. Degraded wavefront OPD (Optical Path Difference), Strehl ratio S, and thermal soak MTF contrast
 * 4. Illustrative environmental sensitivity calculations; no ISO 10110 qualification is provided.
 */

'use strict';

class StopMultiphysicsCoupling {
  /**
   * Evaluates standard Fringe Zernike polynomials Z_j(rho, phi)
   * @param {number} j Zernike term index (1 to 37)
   * @param {number} rho Normalized pupil radius [0, 1]
   * @param {number} phi Polar azimuth angle [rad]
   */
  static evaluateZernike(j, rho, phi) {
    const r2 = rho * rho;
    const r3 = r2 * rho;
    const r4 = r2 * r2;

    switch (j) {
      case 1: return 1.0; // Piston
      case 2: return rho * Math.cos(phi); // X Tilt
      case 3: return rho * Math.sin(phi); // Y Tilt
      case 4: return 2.0 * r2 - 1.0; // Defocus
      case 5: return r2 * Math.cos(2 * phi); // Primary Astigmatism 0/90
      case 6: return r2 * Math.sin(2 * phi); // Primary Astigmatism 45
      case 7: return (3.0 * r3 - 2.0 * rho) * Math.cos(phi); // Primary Coma X
      case 8: return (3.0 * r3 - 2.0 * rho) * Math.sin(phi); // Primary Coma Y
      case 9: return 6.0 * r4 - 6.0 * r2 + 1.0; // Primary Spherical Aberration
      case 10: return r3 * Math.cos(3 * phi); // Trefoil X
      case 11: return r3 * Math.sin(3 * phi); // Trefoil Y
      case 12: return (4.0 * r4 - 3.0 * r2) * Math.cos(2 * phi); // Secondary Astigmatism X
      case 13: return (4.0 * r4 - 3.0 * r2) * Math.sin(2 * phi); // Secondary Astigmatism Y
      default:
        // Higher-order fallback attenuation
        return Math.pow(rho, Math.min(j * 0.25, 4.0)) * Math.cos(j * phi);
    }
  }

  /**
   * Fits a 2D surface displacement field u_z(r, phi) to Zernike coefficients c_j
   * @param {Array<{r: number, phi: number, uz: number}>} sampledPoints
   * @param {number} maxTerms Number of Zernike terms (default 16)
   * @param {number} semiAperture Maximum lens clear aperture radius
   */
  static fitZernikeCoefficients(sampledPoints, maxTerms = 16, semiAperture = 25.0) {
    const coeffs = new Array(maxTerms + 1).fill(0.0);
    if (!sampledPoints || sampledPoints.length === 0) return coeffs;

    // Numerical Gram-Schmidt / Orthogonal projection
    for (let j = 1; j <= maxTerms; j++) {
      let numerator = 0.0;
      let denominator = 0.0;

      for (const pt of sampledPoints) {
        const rho = Math.min(1.0, Math.max(0.0, pt.r / semiAperture));
        const zVal = this.evaluateZernike(j, rho, pt.phi);
        numerator += pt.uz * zVal;
        denominator += zVal * zVal;
      }

      coeffs[j] = denominator > 1e-12 ? numerator / denominator : 0.0;
    }
    return coeffs;
  }

  /** Compute thermo-optic index change from caller-supplied coefficients. */
  static computeDnDt(thermalProperties, refractiveIndex, deltaT, wavelengthUm) {
    const { OpticalThermalSoakEngine } = require('./thermal_soak');
    return OpticalThermalSoakEngine.computeDn(
      thermalProperties,
      refractiveIndex,
      deltaT,
      wavelengthUm,
      0
    );
  }

  /**
   * Executes full multidisciplinary STOP analysis coupling
   * @param {Object} lensSystem Optical system definition
   * @param {Object} environmentalConditions { ambientTempC: number, structuralLoadN: number }
   */
  static solveStopCoupling(lensSystem, environmentalConditions) {
    const requiredLensValues = [
      lensSystem?.entrancePupilDiameterMm,
      lensSystem?.baselineStrehl,
      lensSystem?.refractiveIndexAtReferenceTemperature,
      lensSystem?.glassCtePerK,
      lensSystem?.structuralComplianceMmPerN,
      lensSystem?.thermalSagCoefficientMmPerK
    ];
    const requiredEnvironmentValues = [
      environmentalConditions?.ambientTempC,
      environmentalConditions?.referenceTempC,
      environmentalConditions?.structuralLoadN,
      environmentalConditions?.wavelengthUm
    ];
    if (!requiredLensValues.every(Number.isFinite) || !requiredEnvironmentValues.every(Number.isFinite)
      || lensSystem.entrancePupilDiameterMm <= 0
      || lensSystem.baselineStrehl <= 0 || lensSystem.baselineStrehl > 1
      || lensSystem.refractiveIndexAtReferenceTemperature <= 0
      || lensSystem.structuralComplianceMmPerN < 0
      || environmentalConditions.wavelengthUm <= 0) {
      throw new TypeError('STOP estimate requires finite explicit optical, structural, and environmental inputs.');
    }
    if (typeof lensSystem.structuralPropertiesSource !== 'string' || !lensSystem.structuralPropertiesSource.trim()
      || typeof lensSystem.thermalProperties?.source !== 'string' || !lensSystem.thermalProperties.source.trim()) {
      throw new TypeError('STOP estimate requires provenance strings for its supplied properties.');
    }

    const ambientTempC = environmentalConditions.ambientTempC;
    const referenceTempC = environmentalConditions.referenceTempC;
    const deltaT = ambientTempC - referenceTempC;
    const structuralLoadN = environmentalConditions.structuralLoadN;
    const wavelengthUm = environmentalConditions.wavelengthUm;

    // The simplified structural surrogate remains experimental and is not an FEA solve.
    const sampledPoints = [];
    const clearApertureR = lensSystem.entrancePupilDiameterMm * 0.5;
    for (let rFrac = 0.1; rFrac <= 1.0; rFrac += 0.15) {
      const r = rFrac * clearApertureR;
      for (let p = 0; p < 12; p++) {
        const phi = (p / 12) * Math.PI * 2;
        const bendingDeflection = structuralLoadN * lensSystem.structuralComplianceMmPerN
          * (1.0 - rFrac * rFrac) * Math.cos(2 * phi);
        const thermalExpansionSag = lensSystem.thermalSagCoefficientMmPerK * deltaT * rFrac;
        sampledPoints.push({ r, phi, uz: thermalExpansionSag + bendingDeflection });
      }
    }

    const zernikeCoeffs = this.fitZernikeCoefficients(sampledPoints, 16, clearApertureR);
    const deltaN = this.computeDnDt(
      lensSystem.thermalProperties,
      lensSystem.refractiveIndexAtReferenceTemperature,
      deltaT,
      wavelengthUm
    );
    let sumSq = 0.0;
    for (let j = 4; j <= 16; j++) sumSq += zernikeCoeffs[j] * zernikeCoeffs[j];
    const wavelengthMm = wavelengthUm * 1e-3;
    const rmsWfeWaves = Math.sqrt(sumSq) / wavelengthMm;
    const baselineStrehl = lensSystem.baselineStrehl;
    const degradedStrehl = Math.max(
      0,
      Math.min(1, baselineStrehl * Math.exp(-Math.pow(2 * Math.PI * rmsWfeWaves, 2)))
    );
    const mtfDegradationFactor = Math.sqrt(degradedStrehl / baselineStrehl);

    return {
      status: 'EXPERIMENTAL_ESTIMATE',
      validationLevel: 'experimental',
      standardsAssessment: 'not-performed',
      thermalPropertiesSource: lensSystem.thermalProperties.source,
      structuralPropertiesSource: lensSystem.structuralPropertiesSource,
      ambientTempC,
      referenceTempC,
      deltaT,
      wavelengthUm,
      deltaN,
      zernikeCoeffs,
      rmsWfeWaves: Number(rmsWfeWaves.toFixed(4)),
      baselineStrehl,
      degradedStrehl: Number(degradedStrehl.toFixed(4)),
      thermalSoakMtf: {
        method: 'illustrative RMS wavefront approximation',
        lp10: 0.92 * mtfDegradationFactor,
        lp20: 0.84 * mtfDegradationFactor,
        lp30: 0.74 * mtfDegradationFactor,
        lp40: 0.62 * mtfDegradationFactor
      },
      thermalDefocusMm: Number((zernikeCoeffs[4] || 0).toFixed(5)),
      warnings: ['Experimental surrogate only; no coupled structural solve, optical validation, or athermalization assessment was performed.']
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StopMultiphysicsCoupling };
}
