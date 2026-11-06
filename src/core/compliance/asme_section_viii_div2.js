/**
 * Experimental through-thickness stress integration, Part 5-style stress
 * linearization, and caller-limit screening.
 *
 * This module implements the numerical mechanics described in ASME BPVC
 * Section VIII Division 2 Part 5 (elastic stress classification): restoring a
 * linear (membrane + bending) distribution from stresses sampled along a line
 * through the wall thickness and isolating the nonlinear (peak/local) residual.
 * It is a development aid. It is not a certified ASME BPVC assessment, a Form
 * A-1, or professional engineering approval.
 */

function inputError(message, code = 'INVALID_INPUT') {
  const error = new Error(message);
  error.code = code;
  return error;
}

const TENSOR_COMPONENT_KEYS = ['σxx', 'σyy', 'σzz', 'τxy', 'τyz', 'τzx'];

function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

/**
 * Part 5 through-thickness stress linearization by least-squares regression.
 *
 * Given stress tensor samples taken along a line through the wall thickness
 * (coordinate `s` is the through-thickness position in mm), the procedure
 * restores, for each tensor component:
 *
 *   σ(s) = σ_m + b·s + σ_F(s)
 *
 * where:
 *   σ_m  = membrane  = mean of the samples (constant term)
 *   b    = least-squares slope of the linear fit
 *   σ_b  = bending   = |b|·t/2, the linear-part amplitude at the wall surface
 *   σ_F  = local     = max over samples of |σ(s) − (σ_m + b·s)|
 *
 * The least-squares estimators (equal weights, N samples) are:
 *
 *   σ_m  = (1/N)·Σ σ_i
 *   b    = Σ (s_i − s̄)(σ_i − σ̄) / Σ (s_i − s̄)²
 *
 * with s̄ = (1/N)·Σ s_i and σ̄ = (1/N)·Σ σ_i. For a strictly linear field this
 * reduces to the closed-form ASME integrals:
 *
 *   σ_m = (1/t)·∫σ ds,   σ_b = (6/t²)·∫σ·s ds = |b|·t/2.
 *
 * @param {Array<{s: number, σxx: number, σyy: number, σzz: number, τxy: number, τyz: number, τzx: number}>} stressField
 *   Ordered nodal stress samples along the through-thickness line. `s` must be
 *   strictly increasing and every tensor value finite.
 * @param {Object} [options]
 * @param {string} [options.direction='through-thickness'] Label for the SCL
 *   direction (informational; does not change the math, which runs along `s`).
 * @param {Array|string|number|null} [options.sectionLines=null] Optional SCL
 *   identifier/label for traceability (informational).
 * @returns {Object} Per-component membrane/bending/local results plus a
 *   conservative scalar envelope for screening.
 */
function linearizeStressThroughThickness(stressField, options = {}) {
  const direction = options.direction ?? 'through-thickness';
  if (typeof direction !== 'string' || direction.trim().length === 0) {
    throw new TypeError('options.direction must be a non-empty string.');
  }
  if (!Array.isArray(stressField)) {
    throw new TypeError('stressField must be an array of stress samples.');
  }
  if (stressField.length < 2) {
    throw inputError('At least two stress samples are required for linearization.');
  }
  if (stressField.length > 10000) {
    throw inputError('The stress line must contain at most 10,000 samples.');
  }

  let previousS = null;
  for (let i = 0; i < stressField.length; i++) {
    const sample = stressField[i];
    if (typeof sample !== 'object' || sample === null) {
      throw new TypeError(`Stress sample ${i} must be an object.`);
    }
    requireFiniteNumber(sample.s, `Stress sample ${i} coordinate s`);
    if (previousS !== null && sample.s <= previousS) {
      throw inputError(`Stress sample ${i} coordinate s must be strictly increasing across the line.`);
    }
    previousS = sample.s;
    for (const key of TENSOR_COMPONENT_KEYS) {
      requireFiniteNumber(sample[key], `Stress sample ${i} component ${key}`);
    }
  }

  const n = stressField.length;
  const thicknessMm = stressField[n - 1].s - stressField[0].s;
  if (!(thicknessMm > 0)) {
    throw inputError('The stress line must span a positive thickness.');
  }

  const sMean = (stressField[0].s + stressField[n - 1].s) / 2;

  const components = {};
  for (const key of TENSOR_COMPONENT_KEYS) {
    let sumSigma = 0;
    for (const sample of stressField) sumSigma += sample[key];
    const sigmaMean = sumSigma / n;

    let numerator = 0;
    let denominator = 0;
    for (const sample of stressField) {
      const dx = sample.s - sMean;
      numerator += dx * (sample[key] - sigmaMean);
      denominator += dx * dx;
    }
    const slope = denominator > 0 ? numerator / denominator : 0;
    const membrane = sigmaMean;
    const bendingSigned = (slope * thicknessMm) / 2;
    const bending = Math.abs(bendingSigned);

    let localMax = 0;
    for (const sample of stressField) {
      const fitted = sigmaMean + slope * (sample.s - sMean);
      const residual = sample[key] - fitted;
      const magnitude = Math.abs(residual);
      if (!Number.isFinite(magnitude)) {
        throw inputError('Stress residual exceeded finite numeric range.', 'NUMERICAL_FAILURE');
      }
      if (magnitude > localMax) localMax = magnitude;
    }

    components[key] = {
      membrane,
      bending,
      bendingSigned,
      local: localMax,
      fitSlope: slope,
      fitIntercept: sigmaMean - slope * sMean
    };
  }

  const P_m = Math.max(...TENSOR_COMPONENT_KEYS.map((key) => Math.abs(components[key].membrane)));
  const P_b = Math.max(...TENSOR_COMPONENT_KEYS.map((key) => Math.abs(components[key].bending)));
  const F_local = Math.max(...TENSOR_COMPONENT_KEYS.map((key) => components[key].local));

  return {
    dataStatus: 'computed',
    method: 'least-squares-linear-regression',
    basis: 'ASME BPVC Section VIII Division 2 Part 5 elastic stress classification procedure',
    direction,
    sectionLines: options.sectionLines ?? null,
    thicknessMm,
    sampleCount: n,
    components,
    envelope: { P_m, P_b, F_local }
  };
}

/**
 * Part 5 screening of a membrane/bending/local stress classification against
 * caller-supplied allowables.
 *
 * Classic Part 5 elastic stress-classification thresholds (for the primary and
 * secondary categories) are applied to the scalar envelope magnitudes:
 *
 *   membrane-only        Pm         ≤ S       (general primary membrane)
 *   membrane + bending   Pm + Pb    ≤ 1.5·S  (primary membrane + bending)
 *   primary + secondary  Pm + Pb + Q ≤ 3·S   (when Q is supplied)
 *
 * The local/peak component F is not compared with S: Part 5 requires a fatigue
 * assessment (5.5.3) for peak stress, which is outside this module's scope.
 * `Sy` (yield) is accepted as an informational non-code sanity bound only.
 *
 * @param {number} membrane Scalar Pm magnitude (MPa), e.g. envelope.P_m.
 * @param {number} bending Scalar Pb magnitude (MPa), e.g. envelope.P_b.
 * @param {number} local Scalar local/peak magnitude (MPa), e.g. envelope.F_local.
 * @param {Object} options
 * @param {number} options.S Design stress intensity allowable S (MPa), > 0.
 * @param {number} [options.Sy] Yield strength (MPa), > 0, informational only.
 * @param {number} [options.secondaryQ=0] Secondary stress magnitude Q (MPa), >= 0.
 * @returns {Object} Acceptance flags per threshold with utilization ratios.
 */
function evaluatePart5Allowables(membrane, bending, local, options = {}) {
  requireFiniteNumber(membrane, 'membrane');
  requireFiniteNumber(bending, 'bending');
  requireFiniteNumber(local, 'local');
  const S = requireFiniteNumber(options.S, 'S');
  if (S <= 0) {
    throw inputError('Allowable S must be positive.');
  }
  const Sy = options.Sy === undefined ? null : requireFiniteNumber(options.Sy, 'Sy');
  if (Sy !== null && Sy <= 0) {
    throw inputError('Allowable Sy must be positive.');
  }
  const Q = options.secondaryQ === undefined ? 0 : requireFiniteNumber(options.secondaryQ, 'secondaryQ');
  if (Q < 0) {
    throw inputError('Secondary stress Q must be non-negative.');
  }

  const limitOnePointFiveS = 1.5 * S;
  const limitThreeS = 3 * S;

  const pm = Math.abs(membrane);
  const pb = Math.abs(bending);
  const q = Math.abs(Q);
  const f = Math.abs(local);

  const primaryMembrane = pm <= S;
  const primaryMembranePlusBending = pm + pb <= limitOnePointFiveS;
  const primaryPlusSecondary = pm + pb + q <= limitThreeS;
  const overallAcceptable = primaryMembrane && primaryMembranePlusBending && primaryPlusSecondary;

  const yieldSanity = Sy === null ? null : pm + pb + q <= Sy;

  return {
    basis: 'ASME BPVC Section VIII Division 2 Part 5 elastic stress classification screening',
    input: { Pm: pm, Pb: pb, F: f, Q: q },
    allowables: { S, onePointFiveS: limitOnePointFiveS, threeS: limitThreeS, yieldSy: Sy },
    checks: {
      primaryMembrane: { acceptable: primaryMembrane, limit: S, rule: 'Pm ≤ S' },
      primaryMembranePlusBending: {
        acceptable: primaryMembranePlusBending,
        limit: limitOnePointFiveS,
        rule: 'Pm + Pb ≤ 1.5·S'
      },
      primaryPlusSecondary: {
        acceptable: primaryPlusSecondary,
        limit: limitThreeS,
        rule: 'Pm + Pb + Q ≤ 3·S'
      },
      peakLocal: {
        assessed: false,
        reason:
          'Peak/local stress F is compared against fatigue allowables (Part 5 section 5.5.3), not against S; fatigue assessment is out of scope for this module.'
      },
      yieldSanity: {
        assessed: yieldSanity !== null,
        acceptable: yieldSanity,
        rule: 'Informational only (Pm + Pb + Q ≤ Sy); not a Part 5 allowable.'
      }
    },
    overallAcceptable,
    utilization: {
      PmOverS: S > 0 ? pm / S : null,
      PmPbOverOnePointFiveS: limitOnePointFiveS > 0 ? (pm + pb) / limitOnePointFiveS : null,
      PmPbQOverThreeS: limitThreeS > 0 ? (pm + pb + q) / limitThreeS : null
    }
  };
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

  /**
   * Part 5 through-thickness stress linearization (least-squares).
   * See the standalone `linearizeStressThroughThickness` function.
   */
  static linearizeStressThroughThickness(stressField, options) {
    return linearizeStressThroughThickness(stressField, options);
  }

  /**
   * Part 5 membrane/bending/local screening against caller-supplied allowables.
   * See the standalone `evaluatePart5Allowables` function.
   */
  static evaluatePart5Allowables(membrane, bending, local, options) {
    return evaluatePart5Allowables(membrane, bending, local, options);
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
  module.exports = {
    ASMESectionVIIIDiv2Analyzer,
    linearizeStressThroughThickness,
    evaluatePart5Allowables
  };
}
if (typeof window !== 'undefined') {
  window.ASMESectionVIIIDiv2Analyzer = ASMESectionVIIIDiv2Analyzer;
  window.linearizeStressThroughThickness = linearizeStressThroughThickness;
  window.evaluatePart5Allowables = evaluatePart5Allowables;
}
