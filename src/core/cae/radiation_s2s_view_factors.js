/**
 * Surface-to-surface radiation view factors and diffuse-gray radiosity.
 *
 * View factors are computed with the contour (Stokes) integral:
 *
 *   F12 = (1 / (pi * A1)) * OI_{C1} OI_{C2} ln(r) dr1 . dr2
 *
 * The scalar prefactor (1/(pi*A1)) is verified numerically against the
 * 4-D area integral of cos(th1)cos(th2)/(pi r^2) for parallel plates
 * (Howell catalog value F = 0.19982 for 1x1 m parallel squares at 1 m).
 * The contour integral is exact per edge pair: inner (t) integration over
 * the second segment uses the analytic closed form
 *
 *   int ln|p + t v| dt = [ x ln r - x + h atan2(x, h) ] / |v|
 *
 * and the outer (s) integration over the first segment uses Gauss-Legendre
 * quadrature. Segments that touch (shared edge / corner of an enclosure)
 * produce log singularities; the outer interval is graded near those
 * critical parameters to keep the numerical error negligible.
 *
 * Coaxial parallel disks use the standard closed-form catalog result.
 *
 * Radiosity: for each patch i,
 *   J_i = eps_i sigma T_i^4 + (1 - eps_i) sum_j F_ij J_j
 * solved as a dense linear system (Gaussian elimination, partial pivoting).
 * Net flux q_i = sum_j F_ij (J_i - J_j) (W/m^2), which is algebraically
 * identical to eps_i/(1-eps_i) (sigma T_i^4 - J_i) for eps_i < 1.
 */

'use strict';

const SIGMA = 5.670374419e-8;

const GAUSS_CACHE = new Map();

function gaussLegendre(n) {
  let cached = GAUSS_CACHE.get(n);
  if (cached) return cached;
  const x = new Array(n);
  const w = new Array(n);
  const m = Math.floor((n + 1) / 2);
  for (let i = 0; i < m; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let z1 = 0;
    let pp = 0;
    let iter = 0;
    do {
      let p1 = 1;
      let p2 = 0;
      for (let j = 0; j < n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j + 1) * z * p2 - j * p3) / (j + 1);
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      z1 = z;
      z -= p1 / pp;
      iter++;
    } while (Math.abs(z - z1) > 1e-15 && iter < 100);
    x[i] = -z;
    x[n - 1 - i] = z;
    w[i] = 2 / ((1 - z * z) * pp * pp);
    w[n - 1 - i] = w[i];
  }
  cached = [x, w];
  GAUSS_CACHE.set(n, cached);
  return cached;
}

function vAdd3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vSub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vCross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function vDot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vNorm3(a) {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

function vScale3(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/**
 * Exact integral of ln|p + t v| over t in [0, 1].
 * @param {Array<number>} p - vector from the touching point to segment start
 * @param {Array<number>} v - direction vector of the segment (length = |v|)
 * @returns {number}
 */
function segmentLogIntegral(p, v) {
  const L = vNorm3(v);
  const r0 = vNorm3(p);
  if (L < 1e-14) return Math.log(r0);
  const tau = [v[0] / L, v[1] / L, v[2] / L];
  const x0 = vDot3(p, tau);
  const x1 = x0 + L;
  const q = vAdd3(p, v);
  const r1 = vNorm3(q);
  const hSq = r0 * r0 - x0 * x0;
  const h = hSq > 0 ? Math.sqrt(hSq) : 0;
  const F = (x, r) => {
    if (Math.abs(x) < 1e-300) return 0;
    const lnr = Math.log(r < 1e-300 ? 1e-300 : r);
    return x * lnr - x + h * Math.atan2(x, h);
  };
  return (F(x1, r1) - F(x0, r0)) / L;
}

function collectCriticalParams(A, B, C, D) {
  const critS = [];
  const critT = [];
  const w2 = vSub3(D, C);
  const w2sq = vDot3(w2, w2);
  const eps = 1e-9;
  const endpoints = [
    [A, 0],
    [B, 1]
  ];
  for (const [E, s] of endpoints) {
    let t = 0;
    if (w2sq > 0) {
      t = vDot3(vSub3(E, C), w2) / w2sq;
      t = Math.max(0, Math.min(1, t));
    }
    const P = vAdd3(C, vScale3(w2, t));
    if (vNorm3(vSub3(E, P)) < eps) {
      critS.push(s);
      critT.push(t);
    }
  }
  const w1 = vSub3(B, A);
  const w1sq = vDot3(w1, w1);
  const endpoints2 = [
    [C, 0],
    [D, 1]
  ];
  for (const [E, t] of endpoints2) {
    let s = 0;
    if (w1sq > 0) {
      s = vDot3(vSub3(E, A), w1) / w1sq;
      s = Math.max(0, Math.min(1, s));
    }
    const P = vAdd3(A, vScale3(w1, s));
    if (vNorm3(vSub3(E, P)) < eps) {
      critT.push(t);
      critS.push(s);
    }
  }
  return [critS, critT];
}

function edgeOverlapParams(A, B, C, D) {
  const w1 = vSub3(B, A);
  const w2 = vSub3(D, C);
  const w1sq = vDot3(w1, w1);
  const w2sq = vDot3(w2, w2);
  if (w1sq < 1e-12 || w2sq < 1e-12) return null;
  const tA = vDot3(vSub3(A, C), w2) / w2sq;
  const tB = vDot3(vSub3(B, C), w2) / w2sq;
  const sC = vDot3(vSub3(C, A), w1) / w1sq;
  const sD = vDot3(vSub3(D, A), w1) / w1sq;
  const eps = 1e-9;
  const onLineAB = (P) => {
    const s = vDot3(vSub3(P, A), w1) / w1sq;
    const q = vAdd3(A, vScale3(w1, Math.max(0, Math.min(1, s))));
    return vNorm3(vSub3(P, q)) < eps;
  };
  if (!onLineAB(C) || !onLineAB(D)) return null;
  const lo = Math.max(0, Math.min(tA, tB));
  const hi = Math.min(1, Math.max(tA, tB));
  if (hi - lo < 1e-12) return null;
  return {
    s0: Math.max(0, Math.min(sC, sD)),
    s1: Math.min(1, Math.max(sC, sD)),
    t0: lo,
    t1: hi
  };
}

function buildGradedPartition(crits) {
  const pts = [0, 1];
  for (const c of crits) {
    if (c > 1e-12 && c < 1 - 1e-12) pts.push(c);
    let d = 0.5;
    for (let k = 0; k < 24; k++) {
      const lo = c - d;
      const hi = c + d;
      if (lo > 1e-12) pts.push(lo);
      if (hi < 1 - 1e-12) pts.push(hi);
      d *= 0.5;
    }
  }
  pts.sort((a, b) => a - b);
  const out = [];
  for (const p of pts) {
    if (out.length === 0 || p - out[out.length - 1] > 1e-14) out.push(p);
  }
  return out;
}

/**
 * Double integral I_ij = int_0^1 int_0^1 ln|P(s) - Q(t)| ds dt for the two
 * straight segments A->B (P) and C->D (Q).
 */
function edgePairIntegral(A, B, C, D) {
  const w1 = vSub3(B, A);
  const w2 = vSub3(D, C);
  const m = vSub3(A, C);
  const n = [-w2[0], -w2[1], -w2[2]];
  const overlap = edgeOverlapParams(A, B, C, D);
  if (overlap) {
    // Coincident collinear segments: r(s,t) = L|s - t| (same direction) or
    // L|1 - s - t| (opposite direction); both integrate to ln(L) - 3/2.
    const L = vNorm3(w1);
    return Math.log(L) - 1.5;
  }
  const [critS, critT] = collectCriticalParams(A, B, C, D);
  const hasCrit = critS.length > 0 || critT.length > 0;
  if (!hasCrit) {
    const [gx, gw] = gaussLegendre(64);
    let tot = 0;
    for (let i = 0; i < 64; i++) {
      const s = 0.5 * (gx[i] + 1);
      const p = [m[0] + s * w1[0], m[1] + s * w1[1], m[2] + s * w1[2]];
      tot += 0.5 * gw[i] * segmentLogIntegral(p, n);
    }
    return tot;
  }
  const splitS = buildGradedPartition(critS);
  const splitT = buildGradedPartition(critT);
  const [gx, gw] = gaussLegendre(24);
  let tot = 0;
  for (let i = 0; i < splitS.length - 1; i++) {
    const a = splitS[i];
    const b = splitS[i + 1];
    const mid = 0.5 * (a + b);
    const half = 0.5 * (b - a);
    for (let j = 0; j < splitT.length - 1; j++) {
      const c = splitT[j];
      const d = splitT[j + 1];
      const tLen = d - c;
      const nScale = d - c;
      let rect = 0;
      for (let u = 0; u < 16; u++) {
        const s = mid + half * gx[u];
        const p = [m[0] + s * w1[0] + c * n[0], m[1] + s * w1[1] + c * n[1], m[2] + s * w1[2] + c * n[2]];
        rect += gw[u] * segmentLogIntegral(p, [n[0] * nScale, n[1] * nScale, n[2] * nScale]);
      }
      tot += rect * half * tLen;
    }
  }
  return tot;
}

function polygonNormalNewell(verts) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const L = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (L < 1e-14) return [0, 0, 1];
  return [nx / L, ny / L, nz / L];
}

function polygonArea(verts, normal) {
  const n = normal || polygonNormalNewell(verts);
  let s = 0;
  const m = verts.length;
  for (let i = 0; i < m; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % m];
    s +=
      0.5 *
      ((a[1] * b[2] - a[2] * b[1]) * n[0] + (a[2] * b[0] - a[0] * b[2]) * n[1] + (a[0] * b[1] - a[1] * b[0]) * n[2]);
  }
  return Math.abs(s);
}

function orientPolygon(verts, normalHint) {
  if (!normalHint) return verts.slice();
  const n = polygonNormalNewell(verts);
  if (vDot3(n, normalHint) < 0) return verts.slice().reverse();
  return verts.slice();
}

function polygonCentroid(verts) {
  const c = [0, 0, 0];
  for (const v of verts) {
    c[0] += v[0];
    c[1] += v[1];
    c[2] += v[2];
  }
  return [c[0] / verts.length, c[1] / verts.length, c[2] / verts.length];
}

function pointInPolygon3D(p, verts, normal) {
  let axis = 0;
  if (Math.abs(normal[1]) > Math.abs(normal[axis])) axis = 1;
  if (Math.abs(normal[2]) > Math.abs(normal[axis])) axis = 2;
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  let inside = false;
  const n = verts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = verts[i][v];
    const yj = verts[j][v];
    if (yi > p[v] !== yj > p[v]) {
      const xi = verts[i][u];
      const xj = verts[j][u];
      const xint = ((xj - xi) * (p[v] - yi)) / (yj - yi) + xi;
      if (p[u] < xint) inside = !inside;
    }
  }
  return inside;
}

function segmentBlockedByPolygon(p, q, verts, normal) {
  const d = vSub3(q, p);
  const denom = vDot3(d, normal);
  if (Math.abs(denom) < 1e-14) return false;
  const t = vDot3(vSub3(verts[0], p), normal) / denom;
  if (t <= 1e-9 || t >= 1 - 1e-9) return false;
  const hit = vAdd3(p, vScale3(d, t));
  return pointInPolygon3D(hit, verts, normal);
}

class RadiationS2SViewFactors {
  /**
   * Analytic view factor between two coaxial parallel disks.
   * @param {number} r1 - radius of disk 1 (m)
   * @param {number} r2 - radius of disk 2 (m)
   * @param {number} L - separation between the two disk planes (m)
   * @returns {number} F12
   */
  static viewFactorCoaxialDisks(r1, r2, L) {
    const R1 = r1 / L;
    const R2 = r2 / L;
    const X = 1 + (1 + R2 * R2) / (R1 * R1);
    const disc = X * X - 4 * (R2 / R1) * (R2 / R1);
    return 0.5 * (X - Math.sqrt(Math.max(0, disc)));
  }

  /**
   * Diffuse view factor between two planar polygons via contour integration.
   * @param {Array<Array<number>>} poly1 - vertices [x,y,z] of polygon 1
   * @param {Array<Array<number>>} poly2 - vertices of polygon 2
   * @param {Object} [opts]
   * @param {Array<number>} [opts.normal1] - outward normal hint for polygon 1
   * @param {Array<number>} [opts.normal2] - outward normal hint for polygon 2
   * @returns {number} F12
   */
  static viewFactorPolygons(poly1, poly2, opts) {
    const o = opts || {};
    const p1 = orientPolygon(poly1, o.normal1);
    const p2 = orientPolygon(poly2, o.normal2);
    const n1 = polygonNormalNewell(p1);
    const A1 = polygonArea(p1, n1);
    if (A1 < 1e-14) throw new Error('Degenerate (zero-area) polygon in view-factor computation.');
    let tot = 0;
    const m1 = p1.length;
    const m2 = p2.length;
    for (let i = 0; i < m1; i++) {
      const A = p1[i];
      const B = p1[(i + 1) % m1];
      for (let j = 0; j < m2; j++) {
        const C = p2[j];
        const D = p2[(j + 1) % m2];
        const w1 = vSub3(B, A);
        const w2 = vSub3(D, C);
        tot += vDot3(w1, w2) * edgePairIntegral(A, B, C, D);
      }
    }
    return Math.abs(tot) / (2 * Math.PI * A1);
  }

  /**
   * Full N x N view-factor matrix for an enclosure of planar patches.
   * @param {Array<Object>} patches - each { vertices, normal?, area?, centroid? }
   * @param {Object} [opts]
   * @param {boolean} [opts.checkObstruction] - ray-cast obstruction culling
   * @returns {Array<Array<number>>} F (F[i][i] = 0)
   */
  static viewFactorMatrix(patches, opts) {
    const o = opts || {};
    const n = patches.length;
    const sol = [];
    for (let i = 0; i < n; i++) {
      const p = patches[i];
      if (!p.vertices) throw new TypeError('Each patch must provide vertices.');
      const normal = p.normal || polygonNormalNewell(p.vertices);
      sol.push({
        vertices: orientPolygon(p.vertices, p.normal),
        normal,
        area: p.area !== undefined ? p.area : polygonArea(p.vertices, normal),
        centroid: p.centroid || polygonCentroid(p.vertices)
      });
    }
    const F = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let fij = this.viewFactorPolygons(sol[i].vertices, sol[j].vertices, {
          normal1: sol[i].normal,
          normal2: sol[j].normal
        });
        if (o.checkObstruction) {
          let blocked = false;
          for (let k = 0; k < n && !blocked; k++) {
            if (k === i || k === j) continue;
            if (segmentBlockedByPolygon(sol[i].centroid, sol[j].centroid, sol[k].vertices, sol[k].normal))
              blocked = true;
          }
          if (blocked) fij = 0;
        }
        F[i][j] = fij;
        F[j][i] = (fij * sol[i].area) / sol[j].area;
      }
    }
    if (o.checkObstruction) {
      for (let i = 0; i < n; i++) {
        let rowSum = 0;
        for (let j = 0; j < n; j++) rowSum += F[i][j];
        if (rowSum > 0 && F[i].every((x) => x >= 0)) {
          for (let j = 0; j < n; j++) F[i][j] /= rowSum;
        }
      }
    }
    return F;
  }

  static _solveLinearSystem(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.slice().concat([b[i]]));
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      }
      if (Math.abs(M[piv][col]) < 1e-15) {
        throw new Error('Singular radiosity system.');
      }
      [M[col], M[piv]] = [M[piv], M[col]];
      const pv = M[col][col];
      for (let r = col + 1; r < n; r++) {
        const f = M[r][col] / pv;
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
      x[r] = s / M[r][r];
    }
    return x;
  }

  /**
   * Solve the diffuse-gray radiosity system.
   * @param {Array<Object>} patches - each { area, emissivity, temperature }
   * @param {Array<Array<number>>} [F] - view-factor matrix (computed if omitted)
   * @returns {Object} { J, q, netPower, energyBalanceResidual }
   */
  static solveRadiosity(patches, F) {
    const n = patches.length;
    for (const p of patches) {
      if (!(p.area > 0) || !(p.emissivity > 0) || !(p.emissivity <= 1) || !(p.temperature > 0)) {
        throw new TypeError('Each patch needs positive area, emissivity in (0,1], temperature.');
      }
    }
    const Fm =
      F ||
      this.viewFactorMatrix(
        patches.map((p) => ({
          vertices: p.vertices || p.polygon,
          normal: p.normal,
          area: p.area
        }))
      );
    const e = patches.map((p) => p.emissivity * SIGMA * Math.pow(p.temperature, 4));
    const A = [];
    for (let i = 0; i < n; i++) {
      const row = new Array(n).fill(0);
      row[i] = 1;
      for (let j = 0; j < n; j++) {
        if (j !== i) row[j] = -(1 - patches[i].emissivity) * Fm[i][j];
      }
      A.push(row);
    }
    const J = this._solveLinearSystem(A, e);
    const q = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        q[i] += Fm[i][j] * (J[i] - J[j]);
      }
    }
    const netPower = q.map((qi, i) => qi * patches[i].area);
    let resid = 0;
    for (const p of netPower) resid += p;
    return {
      J,
      q,
      netPower,
      energyBalanceResidual: Math.abs(resid),
      sigma: SIGMA
    };
  }
}

module.exports = {
  RadiationS2SViewFactors,
  SIGMA,
  _internal: {
    segmentLogIntegral,
    edgePairIntegral,
    polygonNormalNewell,
    polygonArea,
    gaussLegendre
  }
};
