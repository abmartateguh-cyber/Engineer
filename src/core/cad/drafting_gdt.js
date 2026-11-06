/**
 * Semantic GD&T Feature Control Frame (FCF) data model and tolerance-evaluation
 * engine (ASME Y14.5-2018 based).
 *
 * ACCEPTED TEXTUAL FCF SYNTAX (two forms):
 *
 *   Bracket form:
 *     [Characteristic] [⌀|Ø|∅] Value [Modifier] { (Datum) [Modifier] }*
 *
 *   Pipe form:
 *     [Characteristic] Value | Datum | Datum | Datum
 *
 * - Characteristic (optional, default = POSITION) is a keyword from
 *   GEOMETRIC_CHARACTERISTICS, e.g. POSITION, FLATNESS, CYLINDRICITY,
 *   PERPENDICULARITY, PROFILE, RUNOUT, CIRCULARITY, STRAIGHTNESS,
 *   PARALLELISM, ANGULARITY, CONCENTRICITY, SYMMETRY, TOTAL RUNOUT.
 * - Value: non-negative decimal tolerance (mm). Preceded by ⌀ / Ø / ∅ it is
 *   interpreted as a cylindrical (diameter) zone; otherwise a width/linear zone.
 * - Modifier after the value applies to the tolerance/feature: M or ⊙ (MMC),
 *   L or Ⓕ (LMC), S (RFS).
 * - Datum: one uppercase letter inside parentheses, optionally followed by a
 *   modifier (M / L / S / ⊙ / Ⓕ) attached to that datum.
 * - Pipe form: value followed by up to three bare datum letters separated by
 *   '|'; no modifiers are expressed in pipe form.
 *
 * Examples:
 *   '⌀0.1(A)M(B)M(C)'   -> POSITION, 0.1 mm diameter zone, datums A(MMC), B(MMC), C
 *   '0.05|A|B|C'        -> POSITION, 0.05 mm, datums A, B, C
 *   'POSITION ⌀0.1M(A)(B)(C)' -> POSITION, 0.1 dia, MMC modifier, datums A, B, C
 *   'FLATNESS 0.05'     -> Flatness, 0.05 mm zone, no datums
 */

'use strict';

const DIAMETER_SYMBOLS = ['⌀', 'Ø', '∅'];

const GEOMETRIC_CHARACTERISTICS = Object.freeze({
  POSITION: 'POSITION',
  FLATNESS: 'FLATNESS',
  CYLINDRICITY: 'CYLINDRICITY',
  PERPENDICULARITY: 'PERPENDICULARITY',
  PROFILE: 'PROFILE',
  RUNOUT: 'RUNOUT',
  TOTAL_RUNOUT: 'TOTAL RUNOUT',
  CIRCULARITY: 'CIRCULARITY',
  STRAIGHTNESS: 'STRAIGHTNESS',
  PARALLELISM: 'PARALLELISM',
  ANGULARITY: 'ANGULARITY',
  CONCENTRICITY: 'CONCENTRICITY',
  SYMMETRY: 'SYMMETRY'
});

const CHARACTERISTIC_ALIASES = Object.freeze({
  POSITION: 'POSITION',
  FLATNESS: 'FLATNESS',
  CYLINDRICITY: 'CYLINDRICITY',
  PERPENDICULARITY: 'PERPENDICULARITY',
  PROFILE: 'PROFILE',
  'PROFILE OF A SURFACE': 'PROFILE',
  'PROFILE OF A LINE': 'PROFILE',
  RUNOUT: 'RUNOUT',
  'CIRCULAR RUNOUT': 'RUNOUT',
  'TOTAL RUNOUT': 'TOTAL RUNOUT',
  CIRCULARITY: 'CIRCULARITY',
  STRAIGHTNESS: 'STRAIGHTNESS',
  PARALLELISM: 'PARALLELISM',
  ANGULARITY: 'ANGULARITY',
  CONCENTRICITY: 'CONCENTRICITY',
  SYMMETRY: 'SYMMETRY'
});

const MODIFIER_ALIASES = Object.freeze({
  M: 'M',
  '⊙': 'M',
  L: 'L',
  'Ⓕ': 'L',
  S: 'S'
});

function normalizeModifier(ch) {
  if (ch === undefined || ch === null || ch === '') return null;
  const norm = MODIFIER_ALIASES[ch];
  if (!norm) throw new Error(`Unknown material condition modifier "${ch}"`);
  return norm;
}

function formatTolerance(value) {
  return String(Number(value));
}

class FeatureControlFrame {
  /**
   * @param {Object} spec
   * @param {string} [spec.characteristic='POSITION']
   * @param {number} spec.tolerance
   * @param {boolean} [spec.diameter=false]
   * @param {string} [spec.modifier=null] - 'M' | 'L' | 'S' | null
   * @param {Array|null} [spec.datums=null] - [{ name, modifier } | null] ordered
   *   primary -> secondary -> tertiary (null = vacant precedence slot).
   */
  constructor(spec = {}) {
    const characteristic = (spec.characteristic || 'POSITION').toUpperCase();
    const canonical = CHARACTERISTIC_ALIASES[characteristic];
    if (!canonical) {
      throw new Error(`Unknown geometric characteristic "${spec.characteristic}"`);
    }
    this.characteristic = canonical;
    const tolerance = Number(spec.tolerance);
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      throw new Error(`FCF tolerance must be a non-negative finite number, got ${spec.tolerance}`);
    }
    this.tolerance = tolerance;
    this.diameter = !!spec.diameter;
    this.modifier = spec.modifier ? normalizeModifier(String(spec.modifier).trim()) : null;
    this.datums = (spec.datums || []).map((d) =>
      d === null || d === undefined
        ? null
        : {
            name: String(d.name).toUpperCase(),
            modifier: d.modifier ? normalizeModifier(String(d.modifier).trim()) : null
          }
    );
    if (this.datums.length > 3) {
      throw new Error('FCF may carry at most three datum references');
    }
  }

  /**
   * Parse a textual FCF (see module header for accepted syntax).
   * @param {string} text
   * @returns {FeatureControlFrame}
   */
  static parse(text) {
    let s = String(text).trim();
    if (!s) throw new Error('FCF parse: empty input');

    let characteristic = 'POSITION';
    const kwMatch = s.match(/^([A-Za-z][A-Za-z ]*?)(?=\s*(?:[⌀Ø∅]|\d|-))/);
    if (kwMatch) {
      const alias = CHARACTERISTIC_ALIASES[kwMatch[1].trim().toUpperCase()];
      if (!alias) {
        throw new Error(`Unknown geometric characteristic "${kwMatch[1].trim()}"`);
      }
      characteristic = alias;
      s = s.slice(kwMatch[0].length).trim();
    }

    if (s.includes('|')) return FeatureControlFrame.parsePipe(characteristic, s);
    return FeatureControlFrame.parseBracket(characteristic, s);
  }

  static parseBracket(characteristic, s) {
    let diameter = false;
    if (DIAMETER_SYMBOLS.some((sym) => s.startsWith(sym))) {
      diameter = true;
      s = s.slice(1);
    }
    const numMatch = s.match(/^\d+(\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!numMatch) {
      throw new Error(`FCF parse: expected tolerance value, got "${s}"`);
    }
    const tolerance = Number(numMatch[0]);
    if (!(tolerance >= 0)) throw new Error('FCF parse: negative tolerance value');
    s = s.slice(numMatch[0].length);

    let modifier = null;
    if (s.length && s[0] in MODIFIER_ALIASES) {
      modifier = normalizeModifier(s[0]);
      s = s.slice(1);
    } else if (/^\((M|L|S|⊙|Ⓕ)\)/.test(s)) {
      modifier = normalizeModifier(s[1]);
      s = s.slice(3);
    }

    const datums = [];
    while (s.startsWith('(')) {
      const m = s.match(/^\(([A-Za-z])([MLS⊙Ⓕ])?\)/);
      if (!m) throw new Error(`FCF parse: invalid datum reference near "${s}"`);
      const name = m[1].toUpperCase();
      let modifier = m[2] ? normalizeModifier(m[2]) : null;
      s = s.slice(m[0].length);
      if (s.length && s[0] in MODIFIER_ALIASES) {
        modifier = normalizeModifier(s[0]);
        s = s.slice(1);
      }
      datums.push({ name, modifier });
    }
    if (s.trim()) throw new Error(`FCF parse: unparsed tail "${s}"`);
    if (datums.length > 3) throw new Error('FCF parse: at most three datum references');

    return new FeatureControlFrame({ characteristic, tolerance, diameter, modifier, datums });
  }

  static parsePipe(characteristic, s) {
    const parts = s.split('|').map((p) => p.trim());
    const first = parts[0];
    const numMatch = first.match(/^\d+(\.\d+)?(?:[eE][+-]?\d+)?$/);
    if (!numMatch) throw new Error(`FCF parse: expected tolerance value, got "${first}"`);
    const tolerance = Number(numMatch[0]);
    if (!(tolerance >= 0)) throw new Error('FCF parse: negative tolerance value');

    const datums = parts.slice(1).map((part) => {
      const m = part.match(/^([A-Za-z])([MLS⊙Ⓕ])?$/);
      if (!m) throw new Error(`FCF parse: invalid datum "${part}"`);
      return { name: m[1].toUpperCase(), modifier: m[2] ? normalizeModifier(m[2]) : null };
    });
    if (datums.length > 3) throw new Error('FCF parse: at most three datum references');

    return new FeatureControlFrame({ characteristic, tolerance, diameter: false, modifier: null, datums });
  }

  /**
   * Canonical serialization. Pipe form is used only when it is lossless
   * (no diameter symbol, no feature modifier, no datum modifiers).
   * @returns {string}
   */
  toString() {
    const prefix = this.characteristic === 'POSITION' ? '' : `${this.characteristic} `;
    const hasDatumModifiers = this.datums.some((d) => d && d.modifier);
    if (!this.diameter && !this.modifier && !hasDatumModifiers) {
      const datumStr = this.datums.map((d) => (d ? d.name : '')).join('|');
      return `${prefix}${formatTolerance(this.tolerance)}${datumStr ? `|${datumStr}` : ''}`;
    }
    const di = this.diameter ? '⌀' : '';
    const mod = this.modifier ? this.modifier : '';
    const datumStr = this.datums.map((d) => (d ? `(${d.name})${d.modifier ? d.modifier : ''}` : '')).join('');
    return `${prefix}${di}${formatTolerance(this.tolerance)}${mod}${datumStr}`;
  }

  toJSON() {
    return {
      characteristic: this.characteristic,
      tolerance: this.tolerance,
      diameter: this.diameter,
      modifier: this.modifier,
      datums: this.datums
    };
  }
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm3(a) {
  return Math.sqrt(dot3(a, a));
}

function normalize3(a) {
  const n = norm3(a);
  return n > 1e-15 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 1];
}

/**
 * Symmetric 3x3 Jacobi eigen-decomposition. Returns eigenvalues in descending
 * order with matching eigenvectors (unit columns).
 */
function eigenDecompositionSymmetric3(m) {
  let a = [
    [m[0][0], m[0][1], m[0][2]],
    [m[1][0], m[1][1], m[1][2]],
    [m[2][0], m[2][1], m[2][2]]
  ];
  let v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  for (let iter = 0; iter < 64; iter++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-15) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2]
    ]) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const values = [a[0][0], a[1][1], a[2][2]];
  const order = [0, 1, 2].sort((i, j) => values[j] - values[i]);
  const sortedValues = order.map((i) => values[i]);
  const sortedVectors = order.map((i) => [v[0][i], v[1][i], v[2][i]]);
  return { values: sortedValues, vectors: sortedVectors };
}

function covarianceMatrix(points) {
  const n = points.length;
  if (n === 0) throw new Error('Covariance requires at least one point');
  const c = [0, 0, 0];
  for (const p of points) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  c[0] /= n;
  c[1] /= n;
  c[2] /= n;
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  for (const p of points) {
    const dx = p[0] - c[0];
    const dy = p[1] - c[1];
    const dz = p[2] - c[2];
    cov[0][0] += dx * dx;
    cov[0][1] += dx * dy;
    cov[0][2] += dx * dz;
    cov[1][1] += dy * dy;
    cov[1][2] += dy * dz;
    cov[2][2] += dz * dz;
  }
  const scale = 1 / Math.max(1, n - 1);
  cov[0][0] *= scale;
  cov[0][1] *= scale;
  cov[0][2] *= scale;
  cov[1][0] = cov[0][1];
  cov[1][1] *= scale;
  cov[1][2] *= scale;
  cov[2][0] = cov[0][2];
  cov[2][1] = cov[1][2];
  cov[2][2] *= scale;
  return { centroid: c, covariance: cov };
}

/**
 * Position tolerance evaluation (ASME Y14.5-2018 §7.3.1.1).
 * True position error = 2 × distance from true position to measured center
 * (diameter value). Under MMC, bonus tolerance = (MMC size - actual size) for
 * an internal (hole) feature, or (actual size - MMC size) for an external
 * (feature) feature; the allocated tolerance = specified + bonus, and the
 * virtual condition boundary limits the geometric center offset to half the
 * allocated tolerance.
 *
 * @param {FeatureControlFrame} fcf
 * @param {Object} data
 * @param {number} data.trueX - True (basic) position X
 * @param {number} data.trueY - True (basic) position Y
 * @param {number} data.measuredX - Measured center X
 * @param {number} data.measuredY - Measured center Y
 * @param {number} [data.actualSize] - Actual feature size
 * @param {number} [data.mmcSize] - MMC size of the feature
 * @param {number} [data.lmcSize] - LMC size of the feature
 * @param {string} [data.featureKind='hole'] - 'hole' (internal) | 'pin' (external)
 * @returns {Object} { deviation, bonus, toleranceAllocated, geometricCenterOffsetLimit, pass, virtualCondition }
 */
function evaluateTruePosition(fcf, data) {
  const dx = data.measuredX - data.trueX;
  const dy = data.measuredY - data.trueY;
  const offset = Math.sqrt(dx * dx + dy * dy);
  const deviation = 2 * offset;

  let bonus = 0;
  if (fcf.modifier === 'M' && data.actualSize !== undefined && data.mmcSize !== undefined) {
    // MMC: for an internal feature (hole) MMC is the smallest size, so bonus =
    // actual - MMC; for an external feature (pin) MMC is the largest size, so
    // bonus = MMC - actual.
    const delta = data.featureKind === 'pin' ? data.mmcSize - data.actualSize : data.actualSize - data.mmcSize;
    bonus = Math.max(0, delta);
  } else if (fcf.modifier === 'L' && data.actualSize !== undefined && data.lmcSize !== undefined) {
    // LMC: mirror image of MMC.
    const delta = data.featureKind === 'pin' ? data.actualSize - data.lmcSize : data.lmcSize - data.actualSize;
    bonus = Math.max(0, delta);
  }

  const toleranceAllocated = fcf.tolerance + bonus;
  const geometricCenterOffsetLimit = toleranceAllocated / 2;
  const boundaryOffset = offset - geometricCenterOffsetLimit;
  const pass = deviation <= toleranceAllocated + 1e-12;

  return {
    truePositionDeviation: deviation,
    centerOffset: offset,
    bonus,
    toleranceAllocated,
    geometricCenterOffsetLimit,
    boundaryOffset,
    pass,
    virtualCondition: {
      centerOffsetLimit: geometricCenterOffsetLimit,
      resultDiameter: toleranceAllocated
    }
  };
}

/**
 * Range of signed distances of all points from the plane through `centroid`
 * with unit normal `normal` (i.e. width of the slab bounded by two parallel
 * planes with that normal).
 */
function signedDistanceRange(points, centroid, normal) {
  let maxD = -Infinity;
  let minD = Infinity;
  for (const p of points) {
    const d = (p[0] - centroid[0]) * normal[0] + (p[1] - centroid[1]) * normal[1] + (p[2] - centroid[2]) * normal[2];
    if (d > maxD) maxD = d;
    if (d < minD) minD = d;
  }
  return { range: maxD - minD, maxDeviation: maxD, minDeviation: minD };
}

/**
 * Deterministic minimum-zone flatness search. The minimum zone between two
 * parallel planes containing all measured points is the minimum over normal
 * orientations of the signed-distance range. Candidate normals are seeded
 * from the PCA eigenvectors (least-squares plane) plus a 26-direction
 * spherical grid, then refined by coordinate descent over the two spherical
 * angles. For near-planar point sets this equals the minimum-zone width
 * (exact certainty for arbitrary data would require a 3D convex-hull
 * minimum-width polytope algorithm).
 */
function fitMinimumZonePlane(points) {
  const { centroid, covariance } = covarianceMatrix(points);
  const { vectors } = eigenDecompositionSymmetric3(covariance);

  const candidates = [];
  for (const v of vectors) candidates.push(normalize3(v));
  for (const a of [-1, 0, 1]) {
    for (const b of [-1, 0, 1]) {
      for (const c of [-1, 0, 1]) {
        if (a === 0 && b === 0 && c === 0) continue;
        candidates.push(normalize3([a, b, c]));
      }
    }
  }

  let bestNormal = candidates[0];
  let bestRange = Infinity;
  let bestMax = 0;
  let bestMin = 0;
  for (const n of candidates) {
    const { range, maxDeviation, minDeviation } = signedDistanceRange(points, centroid, n);
    if (range < bestRange) {
      bestRange = range;
      bestNormal = n;
      bestMax = maxDeviation;
      bestMin = minDeviation;
    }
  }

  let theta = Math.acos(Math.max(-1, Math.min(1, bestNormal[2])));
  let phi = Math.atan2(bestNormal[1], bestNormal[0]);
  let step = 0.2;
  for (let iter = 0; iter < 40; iter++) {
    let improved = false;
    for (const dTheta of [-step, 0, step]) {
      for (const dPhi of [-step, 0, step]) {
        if (dTheta === 0 && dPhi === 0) continue;
        const t = Math.max(1e-9, Math.min(Math.PI - 1e-9, theta + dTheta));
        const p = phi + dPhi;
        const n = [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)];
        const { range, maxDeviation, minDeviation } = signedDistanceRange(points, centroid, n);
        if (range < bestRange) {
          bestRange = range;
          bestNormal = n;
          bestMax = maxDeviation;
          bestMin = minDeviation;
          theta = t;
          phi = p;
          improved = true;
        }
      }
    }
    if (!improved) step /= 2;
    if (step < 1e-9) break;
  }

  return { centroid, normal: bestNormal, range: bestRange, maxDeviation: bestMax, minDeviation: bestMin };
}

/**
 * Flatness evaluation: minimum zone width between two parallel planes
 * containing all measured points (see fitMinimumZonePlane).
 *
 * @param {number[][]} points - Array of [x, y, z]
 * @returns {Object} { flatness, method, plane, maxDeviation, minDeviation, count }
 */
function evaluateFlatness(points) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error('Flatness requires at least 3 points');
  }
  const fit = fitMinimumZonePlane(points);
  return {
    flatness: fit.range,
    method:
      'Minimum-zone slab width: deterministic orientation search over parallel-plane normals (PCA seeds + 26-direction spherical grid + coordinate-descent refinement)',
    plane: { point: fit.centroid, normal: fit.normal },
    maxDeviation: fit.maxDeviation,
    minDeviation: fit.minDeviation,
    count: points.length
  };
}

/**
 * Radial distances of all points from the line through `centroid` with unit
 * direction `direction`.
 */
function radialDistances(points, centroid, direction) {
  const out = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const rel = [p[0] - centroid[0], p[1] - centroid[1], p[2] - centroid[2]];
    const along = dot3(rel, direction);
    const perp = [rel[0] - along * direction[0], rel[1] - along * direction[1], rel[2] - along * direction[2]];
    out[i] = norm3(perp);
  }
  return out;
}

function radialSpreadObjective(points, centroid, direction) {
  const r = radialDistances(points, centroid, direction);
  let mean = 0;
  for (const v of r) mean += v;
  mean /= r.length;
  let sse = 0;
  for (const v of r) {
    const d = v - mean;
    sse += d * d;
  }
  return sse;
}

/**
 * Deterministic robust least-squares cylinder axis fit. The classic PCA
 * principal-axis fit is biased when the cylinder is short relative to its
 * diameter (radial spread dominates axial spread), so the axial direction is
 * selected by minimizing the variance of radial distances over a deterministic
 * candidate set (the three PCA eigenvectors plus a 26-direction spherical
 * grid), followed by deterministic coordinate-descent refinement over the two
 * spherical angles.
 */
function fitCylinderAxis(points) {
  const { centroid, covariance } = covarianceMatrix(points);
  const { vectors } = eigenDecompositionSymmetric3(covariance);

  const candidates = [];
  for (const v of vectors) candidates.push(normalize3(v));
  for (const a of [-1, 0, 1]) {
    for (const b of [-1, 0, 1]) {
      for (const c of [-1, 0, 1]) {
        if (a === 0 && b === 0 && c === 0) continue;
        candidates.push(normalize3([a, b, c]));
      }
    }
  }

  let bestDir = candidates[0];
  let bestScore = Infinity;
  for (const dir of candidates) {
    const score = radialSpreadObjective(points, centroid, dir);
    if (score < bestScore) {
      bestScore = score;
      bestDir = dir;
    }
  }

  let theta = Math.acos(bestDir[2]);
  let phi = Math.atan2(bestDir[1], bestDir[0]);
  let step = 0.2;
  for (let iter = 0; iter < 40; iter++) {
    let improved = false;
    for (const dTheta of [-step, 0, step]) {
      for (const dPhi of [-step, 0, step]) {
        if (dTheta === 0 && dPhi === 0) continue;
        const t = Math.max(1e-9, Math.min(Math.PI - 1e-9, theta + dTheta));
        const p = phi + dPhi;
        const dir = [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)];
        const score = radialSpreadObjective(points, centroid, dir);
        if (score < bestScore) {
          bestScore = score;
          theta = t;
          phi = p;
          improved = true;
        }
      }
    }
    if (!improved) step /= 2;
    if (step < 1e-9) break;
  }

  return { centroid, direction: [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)] };
}

/**
 * Cylindricity evaluation: fit the axis robustly (see fitCylinderAxis), then
 * the minimum radial zone between two coaxial cylinders is the difference
 * between the maximum and minimum radial distances of measured points from the
 * fitted axis.
 *
 * @param {number[][]} points - Array of [x, y, z]
 * @returns {Object} { cylindricity, method, axis, minRadius, maxRadius, count }
 */
function evaluateCylindricity(points) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error('Cylindricity requires at least 3 points');
  }
  const { centroid, direction } = fitCylinderAxis(points);
  const radial = radialDistances(points, centroid, direction);
  let minR = Infinity;
  let maxR = -Infinity;
  for (const r of radial) {
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }

  return {
    cylindricity: maxR - minR,
    method:
      'Robust least-squares cylinder axis (PCA seeds + deterministic spherical grid + coordinate-descent refinement over radial-variance objective); radial zone = max radial distance - min radial distance from fitted axis',
    axis: { point: centroid, direction },
    minRadius: minR,
    maxRadius: maxR,
    count: points.length
  };
}

/**
 * Perpendicularity evaluation: angular deviation of the measured axis from the
 * datum plane normal. Perpendicularity tolerance zone diameter = 2 × max
 * lateral deviation over the feature length = 2 × length × tan(angle).
 *
 * @param {Object} data
 * @param {number[]} data.axisDirection - Measured axis unit direction (or any non-zero vector)
 * @param {number[]} data.datumNormal - Datum plane normal
 * @param {number} data.length - Feature length over which deviation is measured
 * @returns {Object} { angleRad, zoneDiameter, lateralDeviation }
 */
function evaluatePerpendicularity(data) {
  const axis = normalize3(data.axisDirection);
  const normal = normalize3(data.datumNormal);
  const angleRad = Math.acos(Math.max(-1, Math.min(1, Math.abs(dot3(axis, normal)))));
  const lateralDeviation = data.length * Math.tan(angleRad);
  return {
    angleRad,
    lateralDeviation,
    zoneDiameter: 2 * lateralDeviation
  };
}

/**
 * Surface profile evaluation: zone = 2 × max |measured - nominal| deviation
 * measured perpendicular to the nominal surface. Deviations are supplied as
 * { nominal: [x,y,z], measured: [x,y,z] } pairs; the deviation magnitude is
 * the Euclidean distance from measured point to its nominal surface point.
 *
 * @param {Array} entries - [{ nominal: [x,y,z], measured: [x,y,z] }]
 * @returns {Object} { maxDeviation, profileZone, count }
 */
function evaluateProfile(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Profile requires at least one nominal/measured pair');
  }
  let maxDev = 0;
  for (const { nominal, measured } of entries) {
    const d = norm3([measured[0] - nominal[0], measured[1] - nominal[1], measured[2] - nominal[2]]);
    if (d > maxDev) maxDev = d;
  }
  return {
    maxDeviation: maxDev,
    profileZone: 2 * maxDev,
    count: entries.length
  };
}

/**
 * ASME Y14.5-2018 rule verification.
 * - Datum precedence: at most three datums, ordered primary -> secondary ->
 *   tertiary with no vacant intermediate slots and no duplicates.
 * - Material condition applicability: MMC/LMC modifiers are only permitted on
 *   size features; applying them to a surface feature produces a validation
 *   warning. RFS (S / null) is always permitted.
 *
 * @param {FeatureControlFrame} fcf
 * @param {Object} opts
 * @param {string} [opts.featureType='surface'] - 'size' | 'surface'
 * @returns {Object} { valid, warnings }
 */
function validateFeatureControlFrame(fcf, opts = {}) {
  const warnings = [];
  const featureType = opts.featureType || 'surface';

  if (fcf.modifier === 'M' || fcf.modifier === 'L') {
    if (featureType !== 'size') {
      warnings.push(
        `Material condition modifier ${fcf.modifier} is only applicable to size features (ASME Y14.5-2018 §4.11); the controlled feature is a ${featureType} feature`
      );
    }
  }

  const present = fcf.datums.filter((d) => d !== null && d !== undefined);
  const names = present.map((d) => d.name);
  if (new Set(names).size !== names.length) {
    warnings.push('Datum references must be unique');
  }
  if (present.length > 3) {
    warnings.push('At most three datum references are permitted');
  }
  for (let i = 1; i < names.length; i++) {
    if (names[i] <= names[i - 1]) {
      warnings.push(`Datum precedence must be primary -> secondary -> tertiary without gaps (${names.join(', ')})`);
      break;
    }
  }
  for (let i = 1; i < fcf.datums.length; i++) {
    if (fcf.datums[i] !== null && fcf.datums[i] !== undefined && fcf.datums[i - 1] === null) {
      warnings.push(`Datum precedence gap: tertiary "${fcf.datums[i].name}" present without secondary datum`);
      break;
    }
  }

  return { valid: warnings.length === 0, warnings };
}

class GeoToleranceEngine {
  /**
   * Dispatch evaluation by FCF characteristic.
   * @param {FeatureControlFrame} fcf
   * @param {Object} data - Per-characteristic measurement data (see each evaluator)
   * @returns {Object} Measured zone / deviation result
   */
  static evaluate(fcf, data) {
    switch (fcf.characteristic) {
      case 'POSITION':
        return evaluateTruePosition(fcf, data);
      case 'FLATNESS':
        return evaluateFlatness(data.points);
      case 'CYLINDRICITY':
        return evaluateCylindricity(data.points);
      case 'PERPENDICULARITY':
        return evaluatePerpendicularity(data);
      case 'PROFILE':
        return evaluateProfile(data.entries);
      default:
        throw new Error(`Tolerance evaluation not implemented for characteristic "${fcf.characteristic}"`);
    }
  }
}

module.exports = {
  GEOMETRIC_CHARACTERISTICS,
  MODIFIER_ALIASES,
  FeatureControlFrame,
  evaluateTruePosition,
  evaluateFlatness,
  evaluateCylindricity,
  evaluatePerpendicularity,
  evaluateProfile,
  validateFeatureControlFrame,
  GeoToleranceEngine
};
