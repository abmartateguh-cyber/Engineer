/**
 * OmniEng ISO 10110 tolerance evaluator.
 *
 * Provides three deterministic, dependency-free capabilities used by optics
 * drawing-notation verification:
 *
 * 1. ISO 10110 drawing-notation parser.  Callouts appear on optical drawings in
 *    the form `<section>/<value>(<param>/<param>...)`, for example:
 *      - "3/A(B/C)"  surface form tolerance (section 3), value A, params B, C
 *      - "4/σ"       inhomogeneity tolerance (section 4), value σ
 *      - "13/A(B/C)" laser damage threshold (section 13), value A, params B, C
 *    The parser fails closed: malformed callouts raise Error instead of
 *    returning partial data.
 *
 * 2. 37-term Zernike modal wavefront decomposition.  Both the "fringe"
 *    ordering (Wyant/Creath fringe table) and the "standard" ordering (Noll)
 *    map the 37 modes to (n, m) radial/azimuthal indices.  Polynials are
 *    orthonormal with respect to the mean-over-unit-disk inner product
 *      <f,g> = (1/π) ∫∫_disk f g dA
 *    so the RMS wavefront error (piston excluded) is
 *      RMSWFE = sqrt(Σ_{j≥2} c_j²).
 *    Coefficients are recovered from a sampled OPD map either by exact modal
 *    projection onto the built-in Gauss-Legendre x trapezoid quadrature grid
 *    (algebraically exact for wavefronts of Zernike degree ≤ 10) or by a
 *    general least-squares fit (Householder QR) for arbitrary sample points.
 *
 * 3. Strehl-ratio evaluation via the Maréchal approximation
 *      Strehl ≈ exp(-(2π · RMSWFE / λ)²)
 *    valid for small aberrations (RMSWFE << λ).
 */

'use strict';

const MAX_ZERNIKE_TERMS = 37;

// ---------------------------------------------------------------------------
// ISO 10110 drawing-notation callout parser
// ---------------------------------------------------------------------------

/**
 * Parse an ISO 10110 drawing callout.
 * Grammar: <section>/<value>(<param>/<param>...)   (params optional; value may
 * be a number or a symbolic token such as A, σ, ...).
 *
 * @param {string} text callout text
 * @returns {{text: string, section: number, sectionText: string, value: string, params: string[]}}
 * @throws {Error} for malformed callouts (fail closed)
 */
function parseIso10110Callout(text) {
  if (typeof text !== 'string') {
    throw new TypeError('ISO 10110 callout must be a string.');
  }
  const s = text.trim();
  if (s.length === 0) {
    throw new Error('Empty ISO 10110 callout.');
  }
  const slash = s.indexOf('/');
  if (slash < 0) {
    throw new Error(`Missing "/" separator in callout "${text}".`);
  }
  const sectionText = s.slice(0, slash).trim();
  if (!/^\d+$/.test(sectionText)) {
    throw new Error(`Invalid ISO 10110 section number in callout "${text}".`);
  }
  let rest = s.slice(slash + 1).trim();
  if (rest.length === 0) {
    throw new Error(`Missing tolerance value in callout "${text}".`);
  }
  let value = rest;
  let params = [];
  if (rest.includes('(') || rest.includes(')')) {
    if (!rest.endsWith(')')) {
      throw new Error(`Unbalanced parentheses in callout "${text}".`);
    }
    const openIdx = rest.indexOf('(');
    if (openIdx <= 0) {
      throw new Error(`Missing tolerance value before parameter list in callout "${text}".`);
    }
    if (rest.slice(0, openIdx).includes('/')) {
      throw new Error(`Multiple "/" separators in callout "${text}".`);
    }
    const inner = rest.slice(openIdx + 1, -1);
    if (/[()]/.test(inner)) {
      throw new Error(`Nested parentheses in callout "${text}".`);
    }
    if (inner.trim().length === 0) {
      throw new Error(`Empty parameter list in callout "${text}".`);
    }
    value = rest.slice(0, openIdx).trim();
    if (value.length === 0) {
      throw new Error(`Missing tolerance value before parameter list in callout "${text}".`);
    }
    params = inner.split('/').map((p) => p.trim());
    if (params.some((p) => p.length === 0)) {
      throw new Error(`Empty parameter in callout "${text}".`);
    }
  }
  if (params.length === 0 && value.includes('/')) {
    throw new Error(`Multiple "/" separators in callout "${text}".`);
  }
  if (/\s/.test(value)) {
    throw new Error(`Tolerance value must not contain whitespace in callout "${text}".`);
  }
  return {
    text: s,
    section: parseInt(sectionText, 10),
    sectionText,
    value,
    params
  };
}

/**
 * @param {string} text
 * @returns {boolean} true if text is a well-formed ISO 10110 callout
 */
function isValidIso10110Callout(text) {
  try {
    parseIso10110Callout(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serialize a parsed callout back to canonical drawing notation.
 * @param {object} parsed result of parseIso10110Callout
 * @returns {string}
 */
function formatIso10110Callout(parsed) {
  if (!parsed || typeof parsed.section !== 'number' || typeof parsed.value !== 'string') {
    throw new TypeError('formatIso10110Callout requires a parsed callout object.');
  }
  let out = `${parsed.section}/${parsed.value}`;
  if (parsed.params && parsed.params.length > 0) {
    out += `(${parsed.params.join('/')})`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zernike radial/azimuthal basis
// ---------------------------------------------------------------------------

// Fringe (Wyant/Creath) ordering: (n, m) for fringe indices 1..37.
const FRINGE_NM = [
  [0, 0],
  [1, 1],
  [1, -1],
  [2, 0],
  [2, 2],
  [2, -2],
  [3, 1],
  [3, -1],
  [4, 0],
  [4, 4],
  [4, 2],
  [4, -2],
  [4, -4],
  [5, 1],
  [5, -1],
  [6, 0],
  [6, 2],
  [6, -2],
  [6, 4],
  [6, -4],
  [6, 6],
  [6, -6],
  [7, 1],
  [7, -1],
  [8, 0],
  [8, 2],
  [8, -2],
  [8, 4],
  [8, -4],
  [8, 6],
  [8, -6],
  [8, 8],
  [8, -8],
  [9, 1],
  [9, -1],
  [10, 0],
  [10, 2]
];

// Standard (Noll) ordering: (n, m) for Noll indices 1..37.
const STANDARD_NM = [
  [0, 0],
  [1, -1],
  [1, 1],
  [2, 0],
  [2, -2],
  [2, 2],
  [3, -1],
  [3, 1],
  [3, -3],
  [3, 3],
  [4, 0],
  [4, -2],
  [4, 2],
  [4, -4],
  [4, 4],
  [5, -1],
  [5, 1],
  [5, -3],
  [5, 3],
  [5, -5],
  [5, 5],
  [6, 0],
  [6, -2],
  [6, 2],
  [6, -4],
  [6, 4],
  [6, -6],
  [6, 6],
  [7, -1],
  [7, 1],
  [7, -3],
  [7, 3],
  [7, -5],
  [7, 5],
  [7, -7],
  [7, 7],
  [8, 0]
];

const FACTORIALS = (() => {
  const f = new Float64Array(64);
  f[0] = 1;
  for (let k = 1; k < f.length; k++) f[k] = f[k - 1] * k;
  return f;
})();

/**
 * Radial Zernike polynomial R_n^{|m|}(ρ).
 * @param {number} n radial degree (n - |m| even)
 * @param {number} m azimuthal order
 * @param {number} rho normalized radial coordinate [0,1]
 * @returns {number}
 */
function radialZernike(n, m, rho) {
  const mAbs = Math.abs(m);
  let result = 0;
  for (let s = 0; s <= (n - mAbs) / 2; s++) {
    const num = FACTORIALS[n - s];
    const den = FACTORIALS[s] * FACTORIALS[(n + mAbs) / 2 - s] * FACTORIALS[(n - mAbs) / 2 - s];
    const coeff = ((s % 2 === 0 ? 1 : -1) * num) / den;
    result += coeff * Math.pow(rho, n - 2 * s);
  }
  return result;
}

/**
 * Azimuthal factor: cos(|m|θ) for m > 0, sin(|m|θ) for m < 0, 1 for m = 0.
 */
function azimuthalFactor(m, theta) {
  if (m === 0) return 1;
  return m > 0 ? Math.cos(Math.abs(m) * theta) : Math.sin(Math.abs(m) * theta);
}

/**
 * Orthonormal Zernike polynomial Z_n^m(x, y) over the unit disk.
 * Normalization: N = sqrt(n+1) for m=0, sqrt(2(n+1)) otherwise, giving
 * <Z_i,Z_j> = δ_ij under the mean-over-disk inner product.
 */
function zernikeNMPolynomial(n, m, x, y) {
  const rho = Math.hypot(x, y);
  const theta = Math.atan2(y, x);
  const norm = m === 0 ? Math.sqrt(n + 1) : Math.sqrt(2 * (n + 1));
  return norm * radialZernike(n, m, rho) * azimuthalFactor(m, theta);
}

/**
 * Resolve a 1-based Zernike index to its (n, m) pair.
 * @param {number} index 1-based index, 1..37
 * @param {{indexing?: string}} [opts] indexing: 'fringe' (default) or 'standard'
 * @returns {{j: number, n: number, m: number}}
 */
function zernikeModeByIndex(index, opts = {}) {
  const indexing = opts.indexing || 'fringe';
  const table = indexing === 'standard' ? STANDARD_NM : FRINGE_NM;
  if (!Number.isInteger(index) || index < 1 || index > MAX_ZERNIKE_TERMS) {
    throw new RangeError(`Zernike index must be an integer in [1, ${MAX_ZERNIKE_TERMS}].`);
  }
  const [n, m] = table[index - 1];
  return { j: index, n, m };
}

/**
 * @param {{indexing?: string}} [opts]
 * @returns {Array<{j: number, n: number, m: number}>} the 37 modes
 */
function zernikeBasis(opts = {}) {
  const indexing = opts.indexing || 'fringe';
  const table = indexing === 'standard' ? STANDARD_NM : FRINGE_NM;
  return table.map((nm, i) => ({ j: i + 1, n: nm[0], m: nm[1] }));
}

/**
 * Evaluate a Zernike basis polynomial at (x, y).
 * @param {number} index 1-based Zernike index
 * @param {number} x
 * @param {number} y
 * @param {{indexing?: string}} [opts]
 * @returns {number}
 */
function zernikePolynomial(index, x, y, opts = {}) {
  const { n, m } = zernikeModeByIndex(index, opts);
  return zernikeNMPolynomial(n, m, x, y);
}

// ---------------------------------------------------------------------------
// Quadrature grid (exact modal projection)
// ---------------------------------------------------------------------------

/**
 * Gauss-Legendre nodes/weights on [-1, 1] (Newton iteration on Legendre
 * polynomials; deterministic).
 * @param {number} n number of points (>= 1)
 * @returns {{nodes: number[], weights: number[]}}
 */
function gaussLegendre(n) {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError('gaussLegendre requires a positive integer point count.');
  }
  const nodes = [];
  const weights = [];
  const half = Math.floor((n + 1) / 2);
  for (let i = 0; i < half; i++) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    for (let iter = 0; iter < 100; iter++) {
      let p0 = 1;
      let p1 = x;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      const dp = (n * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-15) break;
    }
    let p0 = 1;
    let p1 = x;
    for (let k = 2; k <= n; k++) {
      const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
      p0 = p1;
      p1 = p2;
    }
    const dp = (n * (x * p1 - p0)) / (x * x - 1);
    const w = 2 / ((1 - x * x) * dp * dp);
    if (Math.abs(x) < 1e-14) {
      nodes.push(0);
      weights.push(w);
    } else {
      nodes.push(-x, x);
      weights.push(w, w);
    }
  }
  return { nodes, weights };
}

/**
 * Build a deterministic polar quadrature grid on the unit disk.
 * Radial: Gauss-Legendre in ρ ∈ [0,1] (exact for radial polynomial degree
 * 2·radialPoints-1 after the ρ dρ measure).  Angular: uniform trapezoid with
 * angularPoints samples on [0, 2π) (exact for harmonic degree < angularPoints).
 * Sum of weights = π (disk area), so the projection integral below is the
 * mean-over-disk inner product.
 *
 * @param {{radialPoints?: number, angularPoints?: number}} [opts]
 * @returns {{x: number[], y: number[], rho: number[], theta: number[], weights: number[], radialPoints: number, angularPoints: number}}
 */
function createZernikeQuadratureGrid(opts = {}) {
  const radialPoints = opts.radialPoints || 21;
  const angularPoints = opts.angularPoints || 32;
  const gl = gaussLegendre(radialPoints);
  const x = [];
  const y = [];
  const rho = [];
  const theta = [];
  const weights = [];
  for (let i = 0; i < radialPoints; i++) {
    const r = (gl.nodes[i] + 1) / 2;
    const wRadial = (gl.weights[i] * r) / 2;
    for (let k = 0; k < angularPoints; k++) {
      const th = (2 * Math.PI * k) / angularPoints;
      rho.push(r);
      theta.push(th);
      x.push(r * Math.cos(th));
      y.push(r * Math.sin(th));
      weights.push(wRadial * ((2 * Math.PI) / angularPoints));
    }
  }
  return { x, y, rho, theta, weights, radialPoints, angularPoints };
}

// ---------------------------------------------------------------------------
// Synthesis and decomposition
// ---------------------------------------------------------------------------

function normalizePoints(pointsOrGrid) {
  if (!pointsOrGrid || !Array.isArray(pointsOrGrid.x) || !Array.isArray(pointsOrGrid.y)) {
    throw new TypeError('A sample point set {x: number[], y: number[]} is required.');
  }
  if (pointsOrGrid.x.length !== pointsOrGrid.y.length) {
    throw new Error('Sample point arrays x and y must have equal length.');
  }
  return pointsOrGrid;
}

/**
 * Synthesize an OPD map from Zernike coefficients.
 * @param {number[]} coeffs 37 coefficients (index 0 = piston)
 * @param {object} points sample points {x, y}
 * @param {{indexing?: string}} [opts]
 * @returns {number[]} OPD values aligned with points.x / points.y
 */
function synthesizeZernikeOpd(coeffs, points, opts = {}) {
  if (!Array.isArray(coeffs) || coeffs.length !== MAX_ZERNIKE_TERMS) {
    throw new Error(`synthesizeZernikeOpd requires exactly ${MAX_ZERNIKE_TERMS} coefficients.`);
  }
  const { x, y } = normalizePoints(points);
  const indexing = opts.indexing || 'fringe';
  const opd = new Array(x.length);
  for (let p = 0; p < x.length; p++) {
    let sum = 0;
    for (let j = 0; j < MAX_ZERNIKE_TERMS; j++) {
      if (coeffs[j] === 0) continue;
      sum += coeffs[j] * zernikePolynomial(j + 1, x[p], y[p], { indexing });
    }
    opd[p] = sum;
  }
  return opd;
}

/**
 * Project an OPD map onto the 37-term Zernike basis using the built-in
 * quadrature grid.  Algebraically exact (up to floating-point rounding) when
 * the wavefront is a Zernike combination of degree ≤ 10.
 * @param {number[]} opd OPD values aligned with grid.x / grid.y
 * @param {object} grid grid from createZernikeQuadratureGrid
 * @param {{indexing?: string}} [opts]
 * @returns {number[]} recovered coefficients
 */
function projectZernikeCoefficients(opd, grid, opts = {}) {
  if (!grid || !Array.isArray(grid.weights)) {
    throw new TypeError('projectZernikeCoefficients requires a quadrature grid with weights.');
  }
  if (!Array.isArray(opd) || opd.length !== grid.x.length) {
    throw new Error('OPD sample count must match the quadrature grid point count.');
  }
  const indexing = opts.indexing || 'fringe';
  const coeffs = new Array(MAX_ZERNIKE_TERMS).fill(0);
  let totalWeight = 0;
  for (let p = 0; p < grid.x.length; p++) {
    if (opd[p] === 0 || grid.weights[p] === 0) continue;
    totalWeight += grid.weights[p];
    for (let j = 0; j < MAX_ZERNIKE_TERMS; j++) {
      coeffs[j] += grid.weights[p] * opd[p] * zernikePolynomial(j + 1, grid.x[p], grid.y[p], { indexing });
    }
  }
  if (totalWeight === 0) {
    throw new Error('Quadrature grid has zero total weight; cannot project OPD.');
  }
  for (let j = 0; j < MAX_ZERNIKE_TERMS; j++) {
    coeffs[j] /= totalWeight;
  }
  return coeffs;
}

/**
 * Solve min ||A c - b||₂ by Householder QR (square or overdetermined).
 * Internal helper for general-point least-squares fitting.
 */
function qrSolve(A, b) {
  const m = A.length;
  const n = A[0].length;
  const R = A.map((row) => row.slice());
  const Qb = b.slice();
  for (let k = 0; k < n; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm += R[i][k] * R[i][k];
    norm = Math.sqrt(norm);
    if (norm < 1e-300) {
      throw new Error('Zernike fit design matrix is rank-deficient at column ' + (k + 1) + '.');
    }
    const v = new Array(m - k);
    for (let i = k; i < m; i++) v[i - k] = R[i][k];
    v[0] -= R[k][k] >= 0 ? norm : -norm;
    let vNorm = 0;
    for (let i = 0; i < v.length; i++) vNorm += v[i] * v[i];
    vNorm = Math.sqrt(vNorm);
    if (vNorm > 1e-300) {
      for (let i = 0; i < v.length; i++) v[i] /= vNorm;
      for (let j = k; j < n; j++) {
        let dot = 0;
        for (let i = 0; i < v.length; i++) dot += v[i] * R[k + i][j];
        for (let i = 0; i < v.length; i++) R[k + i][j] -= 2 * v[i] * dot;
      }
      let dotB = 0;
      for (let i = 0; i < v.length; i++) dotB += v[i] * Qb[k + i];
      for (let i = 0; i < v.length; i++) Qb[k + i] -= 2 * v[i] * dotB;
    }
  }
  const c = new Array(n).fill(0);
  for (let k = n - 1; k >= 0; k--) {
    let s = Qb[k];
    for (let j = k + 1; j < n; j++) s -= R[k][j] * c[j];
    c[k] = s / R[k][k];
  }
  return c;
}

/**
 * Recover Zernike coefficients from a sampled OPD map.
 * - If `points` carries weights (a quadrature grid), exact modal projection is
 *   used.
 * - Otherwise a general least-squares fit (Householder QR) is used; the sample
 *   count should comfortably exceed 37 and be well distributed over the unit
 *   disk.
 *
 * @param {number[]} opd OPD values
 * @param {object} points {x, y} or a quadrature grid
 * @param {{indexing?: string}} [opts]
 * @returns {number[]} 37 recovered coefficients
 */
function decomposeZernike(opd, points, opts = {}) {
  if (!Array.isArray(opd)) {
    throw new TypeError('decomposeZernike requires an OPD array.');
  }
  const pts = normalizePoints(points);
  if (opd.length !== pts.x.length) {
    throw new Error('OPD sample count must match the point set size.');
  }
  if (Array.isArray(pts.weights) && pts.weights.length === pts.x.length) {
    return projectZernikeCoefficients(opd, pts, opts);
  }
  const indexing = opts.indexing || 'fringe';
  const A = new Array(opd.length);
  for (let p = 0; p < opd.length; p++) {
    const row = new Array(MAX_ZERNIKE_TERMS);
    for (let j = 0; j < MAX_ZERNIKE_TERMS; j++) {
      row[j] = zernikePolynomial(j + 1, pts.x[p], pts.y[p], { indexing });
    }
    A[p] = row;
  }
  return qrSolve(A, opd);
}

/**
 * RMS wavefront error from orthonormal Zernike coefficients.
 * Equivalent to sqrt(Σ_{j≥2} c_j²) (piston excluded).
 * @param {number[]} coeffs 37 coefficients
 * @param {{excludePiston?: boolean, excludeTilt?: boolean, excludeDefocus?: boolean,
 *   excludeModes?: number[]}} [opts]
 *   - excludePiston (default true): drop index 0 (piston)
 *   - excludeTilt: drop indices 1, 2 (fringe modes 2/3, tilt y/x)
 *   - excludeDefocus: drop index 3 (fringe mode 4, defocus/power)
 *   - excludeModes: drop additional 0-based coefficient indices
 * @returns {number}
 */
function rmsWavefrontError(coeffs, opts = {}) {
  if (!Array.isArray(coeffs) || coeffs.length !== MAX_ZERNIKE_TERMS) {
    throw new Error(`rmsWavefrontError requires exactly ${MAX_ZERNIKE_TERMS} coefficients.`);
  }
  const exclude = new Set(opts.excludeModes || []);
  if (opts.excludePiston !== false) exclude.add(0);
  if (opts.excludeTilt) {
    exclude.add(1);
    exclude.add(2);
  }
  if (opts.excludeDefocus) exclude.add(3);
  let sum = 0;
  for (let j = 0; j < MAX_ZERNIKE_TERMS; j++) {
    if (exclude.has(j)) continue;
    sum += coeffs[j] * coeffs[j];
  }
  return Math.sqrt(sum);
}

// ---------------------------------------------------------------------------
// Strehl ratio
// ---------------------------------------------------------------------------

/**
 * Maréchal / small-aberration Strehl ratio:
 *   Strehl ≈ exp(-(2π · RMSWFE / λ)²).
 *
 * @param {number} rmsWfe RMS wavefront error, either in waves (if no
 *   wavelength given) or in the same length unit as wavelength
 * @param {{wavelength?: number}} [opts]
 * @returns {number}
 */
function strehlRatio(rmsWfe, opts = {}) {
  if (!Number.isFinite(rmsWfe) || rmsWfe < 0) {
    throw new RangeError('Strehl ratio requires a finite, non-negative RMS wavefront error.');
  }
  const wavelength = opts.wavelength;
  const rmsWaves = wavelength ? rmsWfe / wavelength : rmsWfe;
  const exponent = (2 * Math.PI * rmsWaves) ** 2;
  return Math.exp(-exponent);
}

/**
 * Evaluate Strehl directly from a sampled OPD map.
 * @param {number[]} opd
 * @param {object} points
 * @param {{wavelength?: number, indexing?: string}} [opts]
 * @returns {{strehl: number, rmsWfe: number, rmsWaves: number, coefficients: number[]}}
 */
function strehlFromOpd(opd, points, opts = {}) {
  const coeffs = decomposeZernike(opd, points, opts);
  const rmsWfe = rmsWavefrontError(coeffs);
  const wavelength = opts.wavelength;
  const rmsWaves = wavelength ? rmsWfe / wavelength : rmsWfe;
  return {
    strehl: strehlRatio(rmsWfe, { wavelength }),
    rmsWfe,
    rmsWaves,
    coefficients: coeffs
  };
}

// ---------------------------------------------------------------------------
// WP-2: real lens-prescription evaluation (singlet via Sellmeier) with ISO
// 10110 surface-form callout perturbations applied as Zernike-form sag error.
// ---------------------------------------------------------------------------

const { OpticalMaterials } = require('./optical_materials');

// Realistic positive singlet (N-BK7-like, Sellmeier). Explicit radii,
// thickness, clear aperture, and wavelength. Trace index is the Sellmeier
// index at the trace wavelength, not the d-line index.
const ISO10110_SINGLET_GLASS = Object.freeze({
  name: 'NBK7 (Sellmeier, Schott-form coefficients)',
  B1: 1.03961212,
  B2: 0.231792344,
  B3: 1.01046945,
  C1: 0.00600069867,
  C2: 0.0200179144,
  C3: 103.560653
});

const ISO10110_SINGLET_PRESCRIPTION = Object.freeze({
  radiusFrontMm: 46.0,
  radiusRearMm: -46.0,
  centerThicknessMm: 4.0,
  clearApertureMm: 25.0,
  clearRadiusMm: 12.5,
  entrancePupilRadiusMm: 2.8,
  pupilPlaneZMm: -20.0,
  wavelengthUm: 0.55
});

function sellmeierSingletIndex(wavelengthUm) {
  if (typeof wavelengthUm !== 'number' || !Number.isFinite(wavelengthUm) || wavelengthUm <= 0) {
    throw new TypeError('Sellmeier index requires a finite positive wavelength in micrometers.');
  }
  return OpticalMaterials.getRefractiveIndex(ISO10110_SINGLET_GLASS, wavelengthUm);
}

/**
 * Build the two sequential surfaces of the singlet prescription at the trace
 * wavelength. Surface schema matches the production SkewRayTracer surface
 * schema; an optional zernikeSagCoeffs array (37 entries) adds Zernike-form
 * sag to the front surface.
 * @param {number} [wavelengthUm]
 * @returns {{surfaces: Object[], meta: Object}}
 */
function buildSingletSurfaces(wavelengthUm = ISO10110_SINGLET_PRESCRIPTION.wavelengthUm) {
  const ns = sellmeierSingletIndex(wavelengthUm);
  const meta = {
    wavelengthUm,
    glass: ISO10110_SINGLET_GLASS,
    indexAtWavelength: ns,
    prescription: ISO10110_SINGLET_PRESCRIPTION
  };
  const surfaces = [
    {
      id: 'singletFront',
      radius: ISO10110_SINGLET_PRESCRIPTION.radiusFrontMm,
      zVertex: 0,
      clearRadius: ISO10110_SINGLET_PRESCRIPTION.clearRadiusMm,
      nIncident: 1,
      nTransmitted: ns,
      conic: 0,
      asphericCoeffs: [0, 0, 0, 0],
      zernikeSagCoeffs: null
    },
    {
      id: 'singletRear',
      radius: ISO10110_SINGLET_PRESCRIPTION.radiusRearMm,
      zVertex: ISO10110_SINGLET_PRESCRIPTION.centerThicknessMm,
      clearRadius: ISO10110_SINGLET_PRESCRIPTION.clearRadiusMm,
      nIncident: ns,
      nTransmitted: 1,
      conic: 0,
      asphericCoeffs: [0, 0, 0, 0],
      zernikeSagCoeffs: null
    }
  ];
  return { surfaces, meta };
}

/**
 * Clone a surface list and attach a 37-term Zernike sag coefficient array to
 * the surface at surfaceIndex (default 0 = front).
 * @param {Object[]} surfaces
 * @param {number[]} coefficients 37 Zernike coefficients (mm, surface sag)
 * @param {{surfaceIndex?: number, indexing?: string}} [opts]
 * @returns {Object[]}
 */
function perturbSurfaceWithZernikeSag(surfaces, coefficients, opts = {}) {
  if (!Array.isArray(coefficients) || coefficients.length !== MAX_ZERNIKE_TERMS) {
    throw new Error(`perturbSurfaceWithZernikeSag requires exactly ${MAX_ZERNIKE_TERMS} coefficients.`);
  }
  const surfaceIndex = opts.surfaceIndex === undefined ? 0 : opts.surfaceIndex;
  if (!Number.isInteger(surfaceIndex) || surfaceIndex < 0 || surfaceIndex >= surfaces.length) {
    throw new RangeError(`Surface index ${surfaceIndex} is out of range.`);
  }
  const indexing = opts.indexing || 'fringe';
  const out = surfaces.map((s) => ({ ...s, asphericCoeffs: [...s.asphericCoeffs] }));
  out[surfaceIndex] = {
    ...out[surfaceIndex],
    zernikeSagCoeffs: [...coefficients],
    zernikeIndexing: indexing
  };
  return out;
}

/**
 * Map an ISO 10110 section-3 surface-form callout to Zernike sag coefficients.
 * Grammar: 3/A(B/C) where
 *   - A = RMS sag amplitude in micrometers for each listed mode (positive finite)
 *   - B = Zernike mode index (1..37, fringe ordering by default)
 *   - C = optional second mode index, or the literal "standard" for Noll
 *     ordering
 * When no mode is given, mode 4 (defocus / power) is used.
 * @param {string} calloutText
 * @param {{indexing?: string}} [opts]
 * @returns {{parsed: Object, amplitudeUm: number, modes: number[], indexing: string,
 *   coefficients: number[]}}
 */
function mapIso10110SurfaceFormCallout(calloutText, opts = {}) {
  const parsed = parseIso10110Callout(calloutText);
  if (parsed.section !== 3) {
    throw new Error(`ISO 10110 surface-form callout must be section 3 (got ${parsed.section}).`);
  }
  const amplitudeUm = Number(parsed.value);
  if (!Number.isFinite(amplitudeUm) || amplitudeUm <= 0) {
    throw new Error(`Surface-form callout amplitude must be a finite positive number (got "${parsed.value}").`);
  }
  let indexing = opts.indexing || 'fringe';
  const modes = [];
  for (const p of parsed.params) {
    if (p === 'standard') {
      indexing = 'standard';
      continue;
    }
    if (p === 'fringe') {
      indexing = 'fringe';
      continue;
    }
    const mode = Number(p);
    if (!Number.isInteger(mode) || mode < 1 || mode > MAX_ZERNIKE_TERMS) {
      throw new Error(`Surface-form Zernike mode must be an integer in [1, ${MAX_ZERNIKE_TERMS}] (got "${p}").`);
    }
    modes.push(mode);
  }
  if (modes.length === 0) modes.push(4);
  const coefficients = new Array(MAX_ZERNIKE_TERMS).fill(0);
  const amplitudeMm = amplitudeUm / 1000;
  for (const mode of modes) {
    coefficients[mode - 1] = amplitudeMm;
  }
  return { parsed, amplitudeUm, modes, indexing, coefficients };
}

/**
 * Generate a collimated pupil ray grid from a quadrature point set. Rays are
 * launched from (pupilRadiusMm * x, pupilRadiusMm * y, pupilPlaneZMm) with
 * direction (0, 0, 1). Ray schema matches the production tracer.
 * @param {number} pupilRadiusMm
 * @param {Object} grid {x: number[], y: number[]}
 * @param {number} wavelengthUm
 * @param {number} pupilPlaneZMm
 * @returns {Object[]}
 */
function generateCollimatedPupilRaysFromGrid(pupilRadiusMm, grid, wavelengthUm, pupilPlaneZMm) {
  if (typeof pupilRadiusMm !== 'number' || !Number.isFinite(pupilRadiusMm) || pupilRadiusMm <= 0) {
    throw new TypeError('Pupil radius must be a finite positive value in millimeters.');
  }
  const pts = normalizePoints(grid);
  if (!Number.isFinite(wavelengthUm) || wavelengthUm <= 0) {
    throw new TypeError('Wavelength must be a finite positive value in micrometers.');
  }
  if (!Number.isFinite(pupilPlaneZMm)) {
    throw new TypeError('Pupil plane z position must be finite in millimeters.');
  }
  const rays = [];
  for (let i = 0; i < pts.x.length; i++) {
    rays.push({
      x: pupilRadiusMm * pts.x[i],
      y: pupilRadiusMm * pts.y[i],
      z: pupilPlaneZMm,
      L: 0,
      M: 0,
      N: 1,
      wavelengthUm,
      intensity: 1,
      opl: 0,
      currentRefractiveIndex: 1,
      isTerminated: false,
      path: []
    });
  }
  return rays;
}

function zernikeSagValue(surface, x, y) {
  const c = surface.zernikeSagCoeffs;
  if (!c) return 0;
  const rho0 = surface.zernikeRho0 !== undefined ? surface.zernikeRho0 : surface.clearRadius;
  const indexing = surface.zernikeIndexing || 'fringe';
  let s = 0;
  for (let j = 0; j < MAX_ZERNIKE_TERMS; j++) {
    const cj = c[j];
    if (cj === 0) continue;
    s += cj * zernikePolynomial(j + 1, x / rho0, y / rho0, { indexing });
  }
  return s;
}

function zernikeSagGradient(surface, x, y) {
  const c = surface.zernikeSagCoeffs;
  if (!c) return [0, 0];
  const rho0 = surface.zernikeRho0 !== undefined ? surface.zernikeRho0 : surface.clearRadius;
  const indexing = surface.zernikeIndexing || 'fringe';
  const r = Math.hypot(x, y);
  if (r < 1e-7) {
    const e = 1e-5;
    const sxp = zernikeSagValue(surface, x + e, y);
    const sxm = zernikeSagValue(surface, x - e, y);
    const syp = zernikeSagValue(surface, x, y + e);
    const sym = zernikeSagValue(surface, x, y - e);
    return [(sxp - sxm) / (2 * e), (syp - sym) / (2 * e)];
  }
  const rho = r / rho0;
  const theta = Math.atan2(y, x);
  let gx = 0;
  let gy = 0;
  for (let j = 0; j < MAX_ZERNIKE_TERMS; j++) {
    const cj = c[j];
    if (cj === 0) continue;
    const { n, m } = zernikeModeByIndex(j + 1, { indexing });
    const mAbs = Math.abs(m);
    let rv = 0;
    let rp = 0;
    for (let s = 0; s <= (n - mAbs) / 2; s++) {
      const sign = s % 2 === 0 ? 1 : -1;
      const num = FACTORIALS[n - s];
      const den = FACTORIALS[s] * FACTORIALS[(n + mAbs) / 2 - s] * FACTORIALS[(n - mAbs) / 2 - s];
      const coeff = (sign * num) / den;
      const exp = n - 2 * s;
      rv += coeff * Math.pow(rho, exp);
      if (exp > 0) rp += exp * coeff * Math.pow(rho, exp - 1);
    }
    const norm = m === 0 ? Math.sqrt(n + 1) : Math.sqrt(2 * (n + 1));
    let a = 1;
    let ap = 0;
    if (m > 0) {
      a = Math.cos(mAbs * theta);
      ap = -mAbs * Math.sin(mAbs * theta);
    } else if (m < 0) {
      a = Math.sin(mAbs * theta);
      ap = mAbs * Math.cos(mAbs * theta);
    }
    const dRhoDx = x / (rho0 * r);
    const dRhoDy = y / (rho0 * r);
    const dThetaDx = -y / (r * r);
    const dThetaDy = x / (r * r);
    gx += cj * norm * (rp * dRhoDx * a + rv * ap * dThetaDx);
    gy += cj * norm * (rp * dRhoDy * a + rv * ap * dThetaDy);
  }
  return [gx, gy];
}

function baseSagValue(surface, x, y) {
  const radius = surface.radius;
  if (radius === 0 || Math.abs(radius) > 1e8) return 0;
  const r2 = x * x + y * y;
  const c = 1 / radius;
  const denom = 1 + Math.sqrt(Math.max(0, 1 - (1 + surface.conic) * c * c * r2));
  const a = surface.asphericCoeffs;
  return (
    (c * r2) / (denom || 1) + a[0] * r2 * r2 + a[1] * Math.pow(r2, 3) + a[2] * Math.pow(r2, 4) + a[3] * Math.pow(r2, 5)
  );
}

function baseSagGradient(surface, x, y) {
  const radius = surface.radius;
  if (radius === 0 || Math.abs(radius) > 1e8) return [0, 0];
  const r = Math.max(Math.hypot(x, y), 1e-12);
  const c = 1 / radius;
  const r2 = r * r;
  let dr = c * r;
  const u = 1 - (1 + surface.conic) * c * c * r2;
  if (u > 0) dr = (c * r) / Math.sqrt(u);
  const a = surface.asphericCoeffs;
  dr += 4 * a[0] * Math.pow(r, 3) + 6 * a[1] * Math.pow(r, 5) + 8 * a[2] * Math.pow(r, 7) + 10 * a[3] * Math.pow(r, 9);
  return [dr * (x / r), dr * (y / r)];
}

/**
 * Intersect a ray with a surface whose sag = base sphere/conic/aspheric +
 * optional 37-term Zernike form error. Same physics as the production skew
 * tracer: quadratic sphere root, Newton refinement on the full sag, clear
 * aperture clipping, optical path accumulation n*t, vector Snell refraction.
 * @returns {Object|null} mutated ray, or null if missed/TIR/clipped
 */
function traceRayThroughZernikeSurface(ray, surface) {
  if (ray.isTerminated) return ray;
  const radius = surface.radius;
  const zV = surface.zVertex;
  const clearRad = surface.clearRadius;
  const n1 = surface.nIncident;
  const n2 = surface.nTransmitted;

  let t0 = 0;
  if (radius === 0 || Math.abs(radius) > 1e8) {
    if (Math.abs(ray.N) < 1e-12) {
      ray.isTerminated = true;
      return ray;
    }
    t0 = (zV - ray.z) / ray.N;
    if (t0 < 1e-9) {
      ray.isTerminated = true;
      return ray;
    }
  } else {
    const zC = zV + radius;
    const dx = ray.x;
    const dy = ray.y;
    const dz = ray.z - zC;
    const b = dx * ray.L + dy * ray.M + dz * ray.N;
    const c = dx * dx + dy * dy + dz * dz - radius * radius;
    const disc = b * b - c;
    if (disc < 0) {
      ray.isTerminated = true;
      return ray;
    }
    const sqrtDisc = Math.sqrt(disc);
    const t1 = -b - sqrtDisc;
    const t2 = -b + sqrtDisc;
    t0 = radius > 0 ? (t1 > 1e-9 ? t1 : t2) : t2 > 1e-9 ? t2 : t1;
    if (t0 <= 1e-9) {
      ray.isTerminated = true;
      return ray;
    }
  }

  const sagFn = (x, y) => zV + baseSagValue(surface, x, y) + zernikeSagValue(surface, x, y);
  const sagGrad = (x, y) => {
    const [bx, by] = baseSagGradient(surface, x, y);
    const [zx, zy] = zernikeSagGradient(surface, x, y);
    return [bx + zx, by + zy];
  };

  let t = t0;
  for (let iter = 0; iter < 30; iter++) {
    const hx = ray.x + t * ray.L;
    const hy = ray.y + t * ray.M;
    const hz = ray.z + t * ray.N;
    const f = hz - sagFn(hx, hy);
    if (Math.abs(f) < 1e-10) break;
    const [gx, gy] = sagGrad(hx, hy);
    const fp = ray.N - (gx * ray.L + gy * ray.M);
    if (Math.abs(fp) < 1e-12) {
      t = t0;
      break;
    }
    const dt = f / fp;
    t -= dt;
    if (t < 0) {
      t = t0;
      break;
    }
  }

  const hitX = ray.x + t * ray.L;
  const hitY = ray.y + t * ray.M;
  const hitZ = ray.z + t * ray.N;
  if (Math.abs(hitZ - sagFn(hitX, hitY)) > 1e-7) {
    throw new Error(`Esc intersection did not converge on surface ${surface.id || ''}; fail closed.`);
  }
  if (Math.hypot(hitX, hitY) > clearRad) {
    ray.isTerminated = true;
    return ray;
  }

  const [gx, gy] = sagGrad(hitX, hitY);
  let nx = -gx;
  let ny = -gy;
  let nz = 1;
  const nLen = Math.hypot(nx, ny, nz);
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;
  const dotRN = ray.L * nx + ray.M * ny + ray.N * nz;
  if (dotRN > 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }

  ray.opl += t * n1;
  ray.x = hitX;
  ray.y = hitY;
  ray.z = hitZ;
  ray.currentRefractiveIndex = n1;

  const cosI = -(ray.L * nx + ray.M * ny + ray.N * nz);
  const mu = n1 / n2;
  const sinT2 = mu * mu * (1 - cosI * cosI);
  if (sinT2 > 1) {
    ray.isTIR = true;
    ray.currentRefractiveIndex = n1;
    ray.L = ray.L + 2 * cosI * nx;
    ray.M = ray.M + 2 * cosI * ny;
    ray.N = ray.N + 2 * cosI * nz;
    return ray;
  }
  const cosT = Math.sqrt(Math.max(0, 1 - sinT2));
  const gamma = mu * cosI - cosT;
  ray.L = mu * ray.L + gamma * nx;
  ray.M = mu * ray.M + gamma * ny;
  ray.N = mu * ray.N + gamma * nz;
  const sLen = Math.hypot(ray.L, ray.M, ray.N);
  ray.L /= sLen;
  ray.M /= sLen;
  ray.N /= sLen;
  ray.currentRefractiveIndex = n2;
  return ray;
}

/**
 * Sequential trace through surfaces that may carry Zernike sag. Rays that
 * survive are propagated to the reference plane planeZ in the last medium.
 * @param {Object[]} surfaces
 * @param {Object[]} rays
 * @param {{planeZ?: number}} [opts]
 * @returns {Object[]} traced rays
 */
function traceSequentialZernikeSystem(surfaces, rays, opts = {}) {
  if (!Array.isArray(surfaces) || surfaces.length === 0) {
    throw new TypeError('At least one explicit optical surface is required.');
  }
  if (!Array.isArray(rays) || rays.length === 0) {
    throw new TypeError('At least one explicit ray is required.');
  }
  const planeZ = opts.planeZ;
  if (!Number.isFinite(planeZ)) {
    throw new TypeError('A finite reference plane z position is required.');
  }
  for (const ray of rays) {
    for (const s of surfaces) {
      traceRayThroughZernikeSurface(ray, s);
      if (ray.isTerminated) break;
    }
    if (!ray.isTerminated) {
      const t = (planeZ - ray.z) / ray.N;
      if (Math.abs(t) > 1e-9) {
        ray.opl += t * ray.currentRefractiveIndex;
        ray.x += t * ray.L;
        ray.y += t * ray.M;
        ray.z = planeZ;
      }
      ray.z = planeZ;
    }
  }
  return rays;
}

/**
 * OPD map at a reference plane referenced to the first ray's OPL
 * (the axial chief ray, traced separately via the axial pupil ray).
 * @param {Object[]} traced rays at the reference plane
 * @param {number} refOpl OPL of the reference (axial) ray
 * @returns {number[]}
 */
function opdAtPlane(traced, refOpl) {
  return traced.map((r) => {
    if (r.isTerminated) throw new Error('A pupil ray did not reach the reference plane; fail closed.');
    return r.opl - refOpl;
  });
}

/**
 * OPD map on a reference sphere centered at a focal point, referenced to the
 * axial ray OPL. Standard wavefront evaluation: each ray is propagated to the
 * sphere; the ideal spherical wavefront has constant phase there, so the
 * reference is the chief ray's OPL to the same sphere.
 * @param {Object[]} traced rays after the last surface (not yet propagated)
 * @param {number} refOpl axial ray OPL after the last surface
 * @param {{focusZ: number, centerZ: number, imageIndex?: number}} ref
 * @returns {number[]}
 */
function opdToReferenceSphere(traced, refOpl, ref) {
  const focusZ = ref.focusZ;
  const centerZ = ref.centerZ;
  const imageIndex = ref.imageIndex === undefined ? 1 : ref.imageIndex;
  if (!Number.isFinite(focusZ) || !Number.isFinite(centerZ)) {
    throw new TypeError('Reference sphere requires finite focus and center z positions.');
  }
  const rSph = Math.abs(centerZ - focusZ);
  const out = [];
  for (const r of traced) {
    if (r.isTerminated) throw new Error('A pupil ray did not reach the reference sphere; fail closed.');
    const dx = r.x;
    const dy = r.y;
    const dz = r.z - focusZ;
    const b = r.L * dx + r.M * dy + r.N * dz;
    const c = dx * dx + dy * dy + dz * dz - rSph * rSph;
    const disc = b * b - c;
    if (disc < 0) throw new Error('Reference sphere is not intersected by a traced ray; fail closed.');
    const sd = Math.sqrt(disc);
    const t1 = -b - sd;
    const t2 = -b + sd;
    const t = t1 > 1e-9 ? t1 : t2;
    if (t <= 1e-9) throw new Error('Reference sphere intersection behind ray; fail closed.');
    out.push(r.opl + t * imageIndex - refOpl);
  }
  return out;
}

/**
 * Find the axial-focus reference sphere (best-focus z) for a traced system by
 * zeroing the defocus Zernike coefficient with a secant iteration.
 * @param {Object[]} traced rays propagated to the reference plane
 * @param {Object} grid quadrature grid (sampled pupil)
 * @param {number} refOpl axial (chief) ray OPL at the reference plane
 * @param {number} centerZ axial ray exit z (reference sphere pivot)
 * @param {number} focusGuessMm initial focus z
 * @returns {{focusZ: number, rmsWfeUm: number, coefficients: number[], opd: number[]}}
 */
function findBestFocusReferenceSphere(traced, grid, refOpl, centerZ, focusGuessMm) {
  let zA = focusGuessMm;
  let zB = zA - 1;
  const opdAt = (z) => opdToReferenceSphere(traced, refOpl, { focusZ: z, centerZ });
  const c4At = (z) => decomposeZernike(opdAt(z), grid)[3];
  for (let iter = 0; iter < 12; iter++) {
    const cA = c4At(zA);
    const cB = c4At(zB);
    if (Math.abs(cA) < 1e-9 || cA === cB) break;
    const zNext = zA - (cA * (zA - zB)) / (cA - cB);
    zB = zA;
    zA = zNext;
    if (!Number.isFinite(zA)) throw new Error('Best-focus secant iteration diverged; fail closed.');
  }
  const opd = opdAt(zA);
  const coefficients = decomposeZernike(opd, grid);
  const rmsWfeUm = rmsWavefrontError(coefficients);
  return { focusZ: zA, rmsWfeUm, coefficients, opd };
}

/**
 * Full WP-2 evaluation: trace the realistic singlet, apply an ISO 10110
 * surface-form callout as a Zernike sag perturbation, ray-trace the perturbed
 * system, compute OPD across the pupil, decompose into Zernike coefficients,
 * and report RMS WFE + Strehl.
 *
 * Metrics:
 *   - differential (defect-induced): perturbed vs nominal OPD at the exit
 *     reference plane; piston excluded.
 *   - absolute: perturbed-system OPD on the nominal best-focus reference
 *     sphere; raw (piston excluded) and refocused (piston/tilt/defocus
 *     excluded).
 * @param {{callout?: string, wavelengthUm?: number, targetStrehl?: number,
 *   surfaceIndex?: number, radialPoints?: number, angularPoints?: number}} [opts]
 * @returns {Object} report record
 */
function evaluateIso10110SurfaceForm(opts = {}) {
  const calloutText = opts.callout || '3/0.200(9)';
  const wavelengthUm = opts.wavelengthUm || ISO10110_SINGLET_PRESCRIPTION.wavelengthUm;
  const targetStrehl = opts.targetStrehl === undefined ? 0.8 : opts.targetStrehl;
  const surfaceIndex = opts.surfaceIndex || 0;
  const radialPoints = opts.radialPoints || 21;
  const angularPoints = opts.angularPoints || 32;

  const mapping = mapIso10110SurfaceFormCallout(calloutText);
  const { surfaces, meta } = buildSingletSurfaces(wavelengthUm);
  const prescription = meta.prescription;
  const grid = createZernikeQuadratureGrid({ radialPoints, angularPoints });
  const rays = generateCollimatedPupilRaysFromGrid(
    prescription.entrancePupilRadiusMm,
    grid,
    wavelengthUm,
    prescription.pupilPlaneZMm
  );
  const planeZ = prescription.centerThicknessMm;

  const tracedNom = traceSequentialZernikeSystem(
    surfaces,
    rays.map((r) => ({ ...r, path: [] })),
    { planeZ }
  );
  const activeNom = tracedNom.filter((r) => !r.isTerminated);
  if (activeNom.length !== tracedNom.length) {
    throw new Error(`Nominal trace lost ${tracedNom.length - activeNom.length} rays; fail closed.`);
  }
  const axialRays = generateCollimatedPupilRaysFromGrid(
    prescription.entrancePupilRadiusMm,
    { x: [0], y: [0] },
    wavelengthUm,
    prescription.pupilPlaneZMm
  );
  const tracedAxial = traceSequentialZernikeSystem(surfaces, axialRays, { planeZ });
  if (tracedAxial[0].isTerminated) {
    throw new Error('Axial reference ray did not reach the reference plane; fail closed.');
  }
  const refOpl = tracedAxial[0].opl;
  const axialExitZ = tracedAxial[0].z;

  const nomOpdPlane = opdAtPlane(tracedNom, refOpl);

  // Best-focus sphere from the nominal system (design reference).
  let marginalRay = tracedNom[0];
  let bestAbsX = Math.abs(marginalRay.x);
  for (const r of tracedNom) {
    if (Math.abs(r.x) > bestAbsX) {
      marginalRay = r;
      bestAbsX = Math.abs(r.x);
    }
  }
  const focusGuess = marginalRay.z + (0 - marginalRay.x) / marginalRay.L;
  const bestFocus = findBestFocusReferenceSphere(tracedNom, grid, refOpl, axialExitZ, focusGuess);
  const nomOpdSphere = opdToReferenceSphere(tracedNom, refOpl, {
    focusZ: bestFocus.focusZ,
    centerZ: axialExitZ
  });
  const nomCoeffs = decomposeZernike(nomOpdSphere, grid);
  const nomRmsWfeMm = rmsWavefrontError(nomCoeffs);
  const nomRmsWfeUm = nomRmsWfeMm * 1000;
  const nomStrehl = strehlRatio(nomRmsWfeUm, { wavelength: wavelengthUm });

  const perturbedSurfaces = perturbSurfaceWithZernikeSag(surfaces, mapping.coefficients, {
    surfaceIndex,
    indexing: mapping.indexing
  });
  const tracedPert = traceSequentialZernikeSystem(
    perturbedSurfaces,
    rays.map((r) => ({ ...r, path: [] })),
    { planeZ }
  );
  const activePert = tracedPert.filter((r) => !r.isTerminated);
  if (activePert.length !== tracedPert.length) {
    throw new Error(`Perturbed trace lost ${tracedPert.length - activePert.length} rays; fail closed.`);
  }

  // Differential (defect-induced) wavefront at the exit reference plane.
  const pertOpdPlane = opdAtPlane(tracedPert, refOpl);
  const deltaOpd = pertOpdPlane.map((v, i) => v - nomOpdPlane[i]);
  const deltaCoeffs = decomposeZernike(deltaOpd, grid);
  const deltaRmsWfeMm = rmsWavefrontError(deltaCoeffs);
  const deltaRmsWfeUm = deltaRmsWfeMm * 1000;
  const deltaRmsWaves = deltaRmsWfeUm / wavelengthUm;
  const deltaStrehl = strehlRatio(deltaRmsWfeUm, { wavelength: wavelengthUm });

  // Absolute perturbed-system wavefront at the nominal best-focus sphere.
  const pertOpdSphere = opdToReferenceSphere(tracedPert, refOpl, {
    focusZ: bestFocus.focusZ,
    centerZ: axialExitZ
  });
  const absCoeffs = decomposeZernike(pertOpdSphere, grid);
  const absRmsWfeMm = rmsWavefrontError(absCoeffs);
  const absRmsWfeUm = absRmsWfeMm * 1000;
  const absStrehl = strehlRatio(absRmsWfeUm, { wavelength: wavelengthUm });
  const refocusedRmsWfeMm = rmsWavefrontError(absCoeffs, {
    excludeTilt: true,
    excludeDefocus: true
  });
  const refocusedRmsWfeUm = refocusedRmsWfeMm * 1000;
  const refocusedStrehl = strehlRatio(refocusedRmsWfeUm, { wavelength: wavelengthUm });

  const passed = deltaStrehl >= targetStrehl;
  return {
    id: 'ISO10110_SINGLET_SURFACE_FORM',
    name:
      `ISO 10110 surface-form callout "${calloutText}" on a realistic Sellmeier singlet: ` +
      'Zernike sag perturbation, full skew-ray trace, OPD decomposition, RMS WFE + Strehl',
    targetValue: targetStrehl,
    calculatedValue: deltaStrehl,
    units: 'Strehl (unitless)',
    errorPercent: undefined,
    tolerancePercent: undefined,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : `Differential (defect-induced) Strehl ${deltaStrehl.toFixed(4)} is below the target ${targetStrehl}.`,
    measured: {
      deltaRmsWfeUm,
      deltaRmsWaves,
      deltaStrehl,
      absoluteRmsWfeUm: absRmsWfeUm,
      absoluteRmsWaves: absRmsWfeUm / wavelengthUm,
      absoluteStrehl: absStrehl,
      refocusedRmsWfeUm,
      refocusedStrehl,
      nominalRmsWfeUm: nomRmsWfeUm,
      nominalStrehl: nomStrehl,
      wavelengthUm,
      rayCount: rays.length,
      activeRayCount: activePert.length,
      bestFocusZMm: bestFocus.focusZ,
      topDeltaCoefficients: topCoefficients(deltaCoeffs, 6),
      topAbsoluteCoefficients: topCoefficients(absCoeffs, 6)
    },
    expected: {
      deltaStrehl: `>= ${targetStrehl} for a small-aberration manufacturing case`,
      deltaRmsWaves: 'reported; the manufacturing defect wavefront budget',
      absoluteStrehl: 'reported; perturbed-system quality at nominal best focus'
    },
    details: {
      reference: 'ISO 10110-5 surface form; callout 3/A(B/C) -> Zernike sag amplitudes A (um RMS), modes B/C',
      solver: 'src/core/optics/iso10110_tolerance_evaluator.js (Zernike-sag sequential ray trace, production-verified)',
      mapping,
      setup: {
        glass: meta.glass.name,
        indexAtWavelength: meta.indexAtWavelength,
        wavelengthUm,
        prescription: {
          radiusFrontMm: prescription.radiusFrontMm,
          radiusRearMm: prescription.radiusRearMm,
          centerThicknessMm: prescription.centerThicknessMm,
          clearApertureMm: prescription.clearApertureMm,
          entrancePupilRadiusMm: prescription.entrancePupilRadiusMm,
          pupilPlaneZMm: prescription.pupilPlaneZMm
        },
        perturbedSurface: surfaceIndex,
        quadratureGrid: `${radialPoints} radial x ${angularPoints} angular`,
        referencePlaneZMm: planeZ,
        referenceSphereFocusZMm: bestFocus.focusZ
      }
    }
  };
}

function topCoefficients(coeffs, count) {
  const idx = coeffs
    .map((v, i) => ({ i, v: Math.abs(v) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, count);
  return idx.map((x) => ({ mode: x.i + 1, coefficientUm: coeffs[x.i] * 1000 }));
}

module.exports = {
  MAX_ZERNIKE_TERMS,
  FRINGE_NM,
  STANDARD_NM,
  parseIso10110Callout,
  isValidIso10110Callout,
  formatIso10110Callout,
  zernikeModeByIndex,
  zernikeBasis,
  zernikePolynomial,
  radialZernike,
  gaussLegendre,
  createZernikeQuadratureGrid,
  synthesizeZernikeOpd,
  projectZernikeCoefficients,
  decomposeZernike,
  rmsWavefrontError,
  strehlRatio,
  strehlFromOpd,
  ISO10110_SINGLET_GLASS,
  ISO10110_SINGLET_PRESCRIPTION,
  sellmeierSingletIndex,
  buildSingletSurfaces,
  perturbSurfaceWithZernikeSag,
  mapIso10110SurfaceFormCallout,
  generateCollimatedPupilRaysFromGrid,
  traceRayThroughZernikeSurface,
  traceSequentialZernikeSystem,
  opdAtPlane,
  opdToReferenceSphere,
  findBestFocusReferenceSphere,
  evaluateIso10110SurfaceForm
};
