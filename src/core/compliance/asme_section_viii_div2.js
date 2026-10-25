/**
 * Experimental through-thickness stress integration and caller-limit screening.
 * This legacy ASME-labeled API does not implement an ASME BPVC assessment.
 */

function inputError(message, code = 'INVALID_INPUT') {
  const error = new Error(message);
  error.code = code;
  return error;
}

class ASMESectionVIIIDiv2Analyzer {
  /**
   * @param {Object} options
   * @param {number} options.allowableStressS - Caller-supplied screening limit (MPa)
   * @param {string} options.allowableStressSource - Caller-declared source of the screening limit
   */
  constructor(options = {}) {
    const allowableStressS = options.allowableStressS;
    const allowableStressSource = options.allowableStressSource;
    if (!Number.isFinite(allowableStressS) || allowableStressS <= 0) {
      throw inputError('A finite positive caller-supplied screening limit is required.');
    }
    if (
      typeof allowableStressSource !== 'string' ||
      allowableStressSource.trim().length === 0 ||
      allowableStressSource.length > 500
    ) {
      throw inputError('A non-empty source label for the caller-supplied screening limit is required.');
    }

    this.S = allowableStressS;
    this.allowableStressSource = allowableStressSource.trim();
  }

  /**
   * Performs Stress Linearization along a Stress Classification Line (SCL)
   * across vessel wall thickness t (from inner surface x = -t/2 to outer surface x = +t/2).
   *
   * Membrane Stress: sigma_m = (1 / t) * int_{-t/2}^{+t/2} sigma(x) dx
   * Bending Stress:  sigma_b = (6 / t^2) * int_{-t/2}^{+t/2} sigma(x) * x dx
   * Peak Stress:     sigma_F = sigma(x) - sigma_m - sigma_b(x)
   *
   * @param {Array<{x: number, stressMpa: number}>} sclPoints - Ordered samples including both wall surfaces
   * @param {number} wallThicknessMm - Total wall thickness t (mm)
   * @param {boolean} isSecondaryThermal - Must explicitly declare whether secondary thermal stress is present
   * @returns {Object} Experimental stress integrals and comparisons with caller-derived limits
   */
  linearizeStressClassificationLine(sclPoints, wallThicknessMm, isSecondaryThermal) {
    const t = wallThicknessMm;
    if (!Number.isFinite(t) || t <= 0) {
      throw inputError('Wall thickness must be finite and positive.');
    }
    if (!Array.isArray(sclPoints) || sclPoints.length < 2 || sclPoints.length > 10000) {
      throw inputError('The stress line must contain between 2 and 10,000 samples.');
    }
    if (typeof isSecondaryThermal !== 'boolean') {
      throw inputError('Explicitly declare whether secondary thermal stress is present.');
    }
    if (isSecondaryThermal) {
      throw inputError(
        'Secondary thermal stress screening is unavailable because this helper cannot derive Q from a single stress-line sample.',
        'UNSUPPORTED'
      );
    }

    const n = sclPoints.length;
    const endpointToleranceMm = t * 1e-10;
    const halfThickness = t / 2;
    for (let i = 0; i < sclPoints.length; i++) {
      const point = sclPoints[i];
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.stressMpa)) {
        throw inputError(`Stress-line sample ${i} must contain finite x and stressMpa values.`);
      }
      if (point.x < -halfThickness - endpointToleranceMm || point.x > halfThickness + endpointToleranceMm) {
        throw inputError(`Stress-line sample ${i} lies outside the supplied wall thickness.`);
      }
      if (i > 0 && point.x <= sclPoints[i - 1].x) {
        throw inputError('Stress-line x coordinates must be strictly increasing.');
      }
    }
    if (
      Math.abs(sclPoints[0].x + halfThickness) > endpointToleranceMm ||
      Math.abs(sclPoints[sclPoints.length - 1].x - halfThickness) > endpointToleranceMm
    ) {
      throw inputError('Stress-line samples must include both supplied wall surfaces.');
    }

    // Numerical integration via trapezoidal rule
    let intSigma = 0.0;
    let intSigmaX = 0.0;

    for (let i = 0; i < n - 1; i++) {
      const p1 = sclPoints[i];
      const p2 = sclPoints[i + 1];
      const dx = p2.x - p1.x;

      const avgSigma = p1.stressMpa / 2.0 + p2.stressMpa / 2.0;
      intSigma += avgSigma * dx;

      const avgSigmaX = (p1.stressMpa * p1.x) / 2.0 + (p2.stressMpa * p2.x) / 2.0;
      intSigmaX += avgSigmaX * dx;
    }

    if (!Number.isFinite(intSigma) || !Number.isFinite(intSigmaX)) {
      throw inputError('Stress-line integration exceeded finite numeric range.', 'NUMERICAL_FAILURE');
    }

    const sigmaMembrane = intSigma / t; // Pm
    const sigmaBending = (6.0 / (t * t)) * intSigmaX; // Pb
    if (!Number.isFinite(sigmaMembrane) || !Number.isFinite(sigmaBending)) {
      throw inputError('Stress linearization exceeded finite numeric range.', 'NUMERICAL_FAILURE');
    }

    // Peak stress F is the maximum local deviation from linearized (Pm + Pb)
    let maxPeak = 0.0;
    for (const p of sclPoints) {
      const linearizedAtX = sigmaMembrane + ((2.0 * p.x) / t) * sigmaBending;
      const deviation = Math.abs(p.stressMpa - linearizedAtX);
      if (!Number.isFinite(linearizedAtX) || !Number.isFinite(deviation)) {
        throw inputError('Stress residual exceeded finite numeric range.', 'NUMERICAL_FAILURE');
      }
      if (deviation > maxPeak) {
        maxPeak = deviation;
      }
    }

    const Pm = Math.abs(sigmaMembrane);
    const Pb = Math.abs(sigmaBending);
    // Q is not inferable from one through-thickness sample. This branch only
    // supports a caller's explicit declaration that no secondary thermal
    // stress is being screened.
    const Q = 0.0;
    const F = maxPeak;

    // Experimental screening multiples of the caller's supplied stress limit.
    // These comparisons do not reproduce a complete code assessment.
    const limit_Pm = this.S;
    const limit_Pm_Pb = 1.5 * this.S;
    const limit_Pm_Pb_Q = 3.0 * this.S;
    if (!Number.isFinite(limit_Pm_Pb) || !Number.isFinite(limit_Pm_Pb_Q)) {
      throw inputError('Derived screening thresholds exceeded finite numeric range.', 'NUMERICAL_FAILURE');
    }

    const withinPm = Pm <= limit_Pm;
    const withinPmPb = Pm + Pb <= limit_Pm_Pb;
    const withinPmPbQ = Pm + Pb + Q <= limit_Pm_Pb_Q;

    const rawMembraneLimitRatio = Pm === 0 ? null : limit_Pm / Pm;
    const rawCombinedLimitRatio = Pm + Pb === 0 ? null : limit_Pm_Pb / (Pm + Pb);
    const membraneLimitRatio = Number.isFinite(rawMembraneLimitRatio) ? rawMembraneLimitRatio : null;
    const combinedLimitRatio = Number.isFinite(rawCombinedLimitRatio) ? rawCombinedLimitRatio : null;

    return {
      dataStatus: 'caller-supplied-unverified',
      status: 'screening-only',
      assessmentStatus: 'no-code-assessment',
      limitBasis: 'caller-supplied-unverified',
      allowableStressSource: this.allowableStressSource,
      secondaryStressBasis: 'caller-declared-absent',
      wallThicknessMm: t,
      membraneStressPm: Pm,
      bendingStressPb: Pb,
      secondaryStressQ: Q,
      peakStressF: F,
      screeningRule: 'experimental-threshold-multipliers-1x-1.5x-3x',
      screeningLimitsMpa: {
        suppliedThreshold: limit_Pm,
        derived1_5xThreshold: limit_Pm_Pb,
        derived3xThreshold: limit_Pm_Pb_Q
      },
      screening: {
        withinSuppliedPmLimit: withinPm,
        withinSuppliedPmPbLimit: withinPmPb,
        withinSuppliedPmPbQLimit: withinPmPbQ,
        withinAllSuppliedLimits: withinPm && withinPmPb && withinPmPbQ
      },
      suppliedLimitRatios: {
        membrane: membraneLimitRatio,
        combined: combinedLimitRatio
      }
    };
  }

  /**
   * Compatibility alias for the experimental stress-line calculation.
   * @param {Array<{x: number, stressMpa: number}>} sclPoints
   * @param {number} wallThicknessMm
   * @param {boolean} isSecondaryThermal
   * @returns {Object}
   */
  evaluateStressClassificationLine(sclPoints, wallThicknessMm, isSecondaryThermal) {
    const res = this.linearizeStressClassificationLine(sclPoints, wallThicknessMm, isSecondaryThermal);
    return res;
  }

  /** Deprecated compatibility method. It never emits an ASME certificate. */
  generateComplianceCertificate(equipmentTag) {
    const tag = typeof equipmentTag === 'string' ? equipmentTag : equipmentTag?.vesselTag || 'unspecified';
    return `# Experimental Stress Screening

Equipment tag: ${tag}

This diagnostic is experimental and is not an ASME BPVC report, Form A-1, code assessment, or professional engineering approval.
`;
  }

  /** Deprecated compatibility method. This API returns an experimental warning, not an assessment. */
  generateFormalCertificationDocument(vesselData = {}) {
    const tag = vesselData.vesselTag || 'unspecified';
    return (
      '# Experimental Stress Screening\n\nEquipment tag: ' +
      tag +
      '\n\nNo released ASME assessment is available. This diagnostic is not code compliance evidence, a Form A-1, or a professional engineering certification.\n'
    );
  }
}

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ASMESectionVIIIDiv2Analyzer };
}
if (typeof window !== 'undefined') {
  window.ASMESectionVIIIDiv2Analyzer = ASMESectionVIIIDiv2Analyzer;
}
