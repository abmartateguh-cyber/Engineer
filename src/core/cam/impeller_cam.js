/**
 * ImpellerCAM: 5-axis open impeller / blisk passage-clearing toolpath generator.
 *
 * Geometry (parametric open impeller)
 * ----------------------------------
 * The impeller is coaxial with Z.  Blades (N of them) span radially from the
 * hub cylinder (radius Rh) to the shroud cylinder (radius Rs) and axially from
 * z0 (outlet) to z1 (inlet).  Each blade is a twisted ruled surface between a
 * hub curve and a shroud curve; the mid-camber surface of blade k is
 *
 *   M_k(s,t) = r(s)*e_r(theta_k(t)) + z(t)*e_z
 *   r(s) = Rh + s*(Rs - Rh)          z(t) = z0 + t*(z1 - z0)
 *   theta_k(t) = 2*pi*k/N + twistB*(t - 0.5)
 *
 * The blade has constant thickness; the two faces (pressure/suction) are the
 * mid-surface offset circumferentially by +/- thickness/2:
 *
 *   F_k^+(s,t) = M_k(s,t) + (thickness/2)*e_theta(theta_k(t))
 *   F_k^-(s,t) = M_k(s,t) - (thickness/2)*e_theta(theta_k(t))
 *
 * Passage k is the corridor between blade k (its + face) and blade k+1 (its
 * - face).  Because of the axial twist, the passage centerline is a helix
 * leaning toward the open passage; a vertical tool shaft would scrape the
 * near blade surface away from the outlet.
 *
 * Multi-axis clearing
 * -------------------
 * For every passage, cutting passes are generated as zig-zag sweeps of a
 * ball-end tool along the passage (the tip follows the local passage
 * centerline offset by a radial band and an angular fraction of the gap).
 * Each pass connects to the next by short link motions inside the passage, so
 * the emitted per-passage toolpath is one continuous curve.
 *
 * Collision-avoidance tilt
 * ------------------------
 * For each pass the minimum constant tilt angle delta is found (binary
 * refinement after a coarse scan) such that the tool shaft -- a cylinder of
 * radius = holder radius swept along the axis segment from the ball center up
 * to the holder -- keeps at least `requiredClearance` mm to the two
 * neighboring blade ruled surfaces.  The axis is tilted from +Z toward the
 * local passage-center direction e_theta(theta_k(t)) (the open passage), so
 * `dot(axis, passageDir) = sin(delta) > 0` for every pose.
 *
 * Deterministic: no random numbers, fixed grids, fixed iteration counts.
 */

'use strict';

const IMPELLER_CAM_VERSION = '1.0.0';

const EPS = 1e-12;

const DEFAULT_PARAMS = {
  Rh: 30.0,
  Rs: 70.0,
  numBlades: 12,
  thickness: 4.0,
  z0: 0.0,
  z1: 80.0,
  twistDeg: 60.0,
  toolRadius: 4.0,
  holderRadius: 6.0,
  shaftLength: 60.0,
  requiredClearance: 0.5,
  safetyMargin: 0.2,
  minTiltDeg: 5.0,
  maxTiltDeg: 45.0,
  nRadial: 4,
  nAngular: 2,
  radialFractions: [0.5, 0.65, 0.8, 0.95],
  angularFractions: [0.4, 0.6],
  nSamples: 60,
  searchStride: 8,
  searchMeshRes: 6,
  validateMeshRes: 16,
  linkSpacing: 1.5
};

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function defaultRadialFractions(params) {
  const fracs = [];
  for (let p = 0; p < params.nRadial; p++) {
    fracs.push(0.5 + (0.45 * p) / Math.max(params.nRadial - 1, 1));
  }
  return fracs;
}

// ---------------------------------------------------------------------------
// Distance kernel (scalar math, precomputed triangle data)
// ---------------------------------------------------------------------------

function distancePointToSegmentScalar(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const t = clamp(
    ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / Math.max(abx * abx + aby * aby + abz * abz, EPS),
    0,
    1
  );
  const ex = ax + abx * t - px;
  const ey = ay + aby * t - py;
  const ez = az + abz * t - pz;
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}

function distanceSegmentToSegmentScalar(a, b, c, d) {
  const d1x = b[0] - a[0];
  const d1y = b[1] - a[1];
  const d1z = b[2] - a[2];
  const d2x = d[0] - c[0];
  const d2y = d[1] - c[1];
  const d2z = d[2] - c[2];
  const rx = a[0] - c[0];
  const ry = a[1] - c[1];
  const rz = a[2] - c[2];
  const aa = d1x * d1x + d1y * d1y + d1z * d1z;
  const ee = d2x * d2x + d2y * d2y + d2z * d2z;
  const ff = d2x * rx + d2y * ry + d2z * rz;
  let s;
  let t;
  if (aa <= EPS && ee <= EPS) {
    s = 0;
    t = 0;
  } else if (aa <= EPS) {
    s = 0;
    t = clamp(ff / ee, 0, 1);
  } else {
    const cc = d1x * rx + d1y * ry + d1z * rz;
    if (ee <= EPS) {
      t = 0;
      s = clamp(-cc / aa, 0, 1);
    } else {
      const bb = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = aa * ee - bb * bb;
      s = denom > EPS ? clamp((bb * ff - cc * ee) / denom, 0, 1) : 0;
      t = (bb * s + ff) / ee;
      if (t < 0) {
        t = 0;
        s = clamp(-cc / aa, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((bb - cc) / aa, 0, 1);
      }
    }
  }
  const c1x = a[0] + d1x * s;
  const c1y = a[1] + d1y * s;
  const c1z = a[2] + d1z * s;
  const c2x = c[0] + d2x * t;
  const c2y = c[1] + d2y * t;
  const c2z = c[2] + d2z * t;
  const ex = c2x - c1x;
  const ey = c2y - c1y;
  const ez = c2z - c1z;
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}

/**
 * Precompute a triangle record: vertices, plane (n,d), and barycentric
 * helper data for the closest-point-on-triangle routine.
 */
function makeTriangle(p0, p1, p2) {
  const ux = p2[0] - p0[0];
  const uy = p2[1] - p0[1];
  const uz = p2[2] - p0[2];
  const vx = p1[0] - p0[0];
  const vy = p1[1] - p0[1];
  const vz = p1[2] - p0[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nl > EPS) {
    nx /= nl;
    ny /= nl;
    nz /= nl;
  }
  const duu = ux * ux + uy * uy + uz * uz;
  const duv = ux * vx + uy * vy + uz * vz;
  const dvv = vx * vx + vy * vy + vz * vz;
  const denom = duu * dvv - duv * duv;
  return {
    a: p0,
    b: p1,
    c: p2,
    ux: ux,
    uy: uy,
    uz: uz,
    vx: vx,
    vy: vy,
    vz: vz,
    nx: nx,
    ny: ny,
    nz: nz,
    d: nx * p0[0] + ny * p0[1] + nz * p0[2],
    duu: duu,
    duv: duv,
    dvv: dvv,
    denom: denom > EPS ? denom : 1
  };
}

function pointInTriangleScalar(px, py, pz, tri) {
  const wx = px - tri.a[0];
  const wy = py - tri.a[1];
  const wz = pz - tri.a[2];
  const wu = wx * tri.ux + wy * tri.uy + wz * tri.uz;
  const wv = wx * tri.vx + wy * tri.vy + wz * tri.vz;
  const inv = 1 / tri.denom;
  const v = (tri.duv * wv - tri.dvv * wu) * inv;
  const w = (tri.duv * wu - tri.duu * wv) * inv;
  return v >= -1e-9 && w >= -1e-9 && v + w <= 1 + 1e-9;
}

function distancePointToTriangleScalar(px, py, pz, tri) {
  const abx = tri.b[0] - tri.a[0];
  const aby = tri.b[1] - tri.a[1];
  const abz = tri.b[2] - tri.a[2];
  const acx = tri.c[0] - tri.a[0];
  const acy = tri.c[1] - tri.a[1];
  const acz = tri.c[2] - tri.a[2];
  const apx = px - tri.a[0];
  const apy = py - tri.a[1];
  const apz = pz - tri.a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    return Math.sqrt(apx * apx + apy * apy + apz * apz);
  }
  const bpx = px - tri.b[0];
  const bpy = py - tri.b[1];
  const bpz = pz - tri.b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    return Math.sqrt(bpx * bpx + bpy * bpy + bpz * bpz);
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3 + EPS);
    const ex = tri.a[0] + abx * v - px;
    const ey = tri.a[1] + aby * v - py;
    const ez = tri.a[2] + abz * v - pz;
    return Math.sqrt(ex * ex + ey * ey + ez * ez);
  }
  const cpx = px - tri.c[0];
  const cpy = py - tri.c[1];
  const cpz = pz - tri.c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    return Math.sqrt(cpx * cpx + cpy * cpy + cpz * cpz);
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6 + EPS);
    const ex = tri.a[0] + acx * w - px;
    const ey = tri.a[1] + acy * w - py;
    const ez = tri.a[2] + acz * w - pz;
    return Math.sqrt(ex * ex + ey * ey + ez * ez);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6 + EPS);
    const ex = tri.b[0] + (tri.c[0] - tri.b[0]) * w - px;
    const ey = tri.b[1] + (tri.c[1] - tri.b[1]) * w - py;
    const ez = tri.b[2] + (tri.c[2] - tri.b[2]) * w - pz;
    return Math.sqrt(ex * ex + ey * ey + ez * ez);
  }
  const inv = 1 / (va + vb + vc);
  const v = vb * inv;
  const w = vc * inv;
  const qx = tri.a[0] + abx * v + acx * w;
  const qy = tri.a[1] + aby * v + acy * w;
  const qz = tri.a[2] + abz * v + acz * w;
  const ex = qx - px;
  const ey = qy - py;
  const ez = qz - pz;
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}

function distanceSegmentToTriangleScalar(seg0, seg1, tri) {
  const ax = seg0[0];
  const ay = seg0[1];
  const az = seg0[2];
  const bx = seg1[0];
  const by = seg1[1];
  const bz = seg1[2];
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const denom = tri.nx * abx + tri.ny * aby + tri.nz * abz;
  if (Math.abs(denom) > EPS) {
    const t = (tri.d - (tri.nx * ax + tri.ny * ay + tri.nz * az)) / denom;
    if (t >= 0 && t <= 1) {
      const hx = ax + abx * t;
      const hy = ay + aby * t;
      const hz = az + abz * t;
      if (pointInTriangleScalar(hx, hy, hz, tri)) {
        return 0;
      }
    }
  }
  let m = distanceSegmentToSegmentScalar(seg0, seg1, tri.a, tri.b);
  let dd = distanceSegmentToSegmentScalar(seg0, seg1, tri.b, tri.c);
  if (dd < m) {
    m = dd;
  }
  dd = distanceSegmentToSegmentScalar(seg0, seg1, tri.c, tri.a);
  if (dd < m) {
    m = dd;
  }
  dd = distancePointToTriangleScalar(ax, ay, az, tri);
  if (dd < m) {
    m = dd;
  }
  dd = distancePointToTriangleScalar(bx, by, bz, tri);
  if (dd < m) {
    m = dd;
  }
  dd = distancePointToSegmentScalar(tri.a[0], tri.a[1], tri.a[2], ax, ay, az, bx, by, bz);
  if (dd < m) {
    m = dd;
  }
  dd = distancePointToSegmentScalar(tri.b[0], tri.b[1], tri.b[2], ax, ay, az, bx, by, bz);
  if (dd < m) {
    m = dd;
  }
  dd = distancePointToSegmentScalar(tri.c[0], tri.c[1], tri.c[2], ax, ay, az, bx, by, bz);
  if (dd < m) {
    m = dd;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Impeller geometry
// ---------------------------------------------------------------------------

function bladeTheta(k, t, params) {
  return (2 * Math.PI * k) / params.numBlades + params.twistB * (t - 0.5);
}

function bladeMidPoint(k, s, t, params) {
  const theta = bladeTheta(k, t, params);
  const r = params.Rh + s * (params.Rs - params.Rh);
  const z = params.z0 + t * (params.z1 - params.z0);
  return [r * Math.cos(theta), r * Math.sin(theta), z];
}

function bladeFacePoint(k, sigma, s, t, params) {
  const theta = bladeTheta(k, t, params);
  const r = params.Rh + s * (params.Rs - params.Rh);
  const z = params.z0 + t * (params.z1 - params.z0);
  const off = (sigma * params.thickness) / 2;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  return [r * ct - off * st, r * st + off * ct, z];
}

function buildFaceMeshCached(k, sigma, params, res) {
  const tris = [];
  for (let i = 0; i < res; i++) {
    for (let j = 0; j < res; j++) {
      const s0 = i / res;
      const s1 = (i + 1) / res;
      const t0 = j / res;
      const t1 = (j + 1) / res;
      const p00 = bladeFacePoint(k, sigma, s0, t0, params);
      const p10 = bladeFacePoint(k, sigma, s1, t0, params);
      const p01 = bladeFacePoint(k, sigma, s0, t1, params);
      const p11 = bladeFacePoint(k, sigma, s1, t1, params);
      tris.push(makeTriangle(p00, p10, p01), makeTriangle(p10, p11, p01));
    }
  }
  return tris;
}

function passageCenterTheta(k, t, params) {
  return (2 * Math.PI * (k + 0.5)) / params.numBlades + params.twistB * (t - 0.5);
}

function passageDir(k, t, params) {
  const theta = passageCenterTheta(k, t, params);
  return [-Math.sin(theta), Math.cos(theta), 0];
}

function axisForTilt(k, t, deltaDeg, params) {
  const c = passageDir(k, t, params);
  const delta = (deltaDeg * Math.PI) / 180;
  const sd = Math.sin(delta);
  return [sd * c[0], sd * c[1], Math.cos(delta)];
}

function shaftSegmentForPose(pose, params) {
  const ax = pose.axis[0];
  const ay = pose.axis[1];
  const az = pose.axis[2];
  const topLen = params.toolRadius + params.shaftLength;
  return [
    [pose.tip[0] + params.toolRadius * ax, pose.tip[1] + params.toolRadius * ay, pose.tip[2] + params.toolRadius * az],
    [pose.tip[0] + topLen * ax, pose.tip[1] + topLen * ay, pose.tip[2] + topLen * az]
  ];
}

function holderClearanceToBlades(passageIndex, pose, params, res, meshCache) {
  const kNext = (passageIndex + 1) % params.numBlades;
  const key0 = passageIndex * 2 + 1;
  const key1 = kNext * 2 + 0;
  const cacheKey = res + ':' + key0 + ',' + key1;
  let faces = meshCache.get(cacheKey);
  if (!faces) {
    faces = [buildFaceMeshCached(passageIndex, 1, params, res), buildFaceMeshCached(kNext, -1, params, res)];
    meshCache.set(cacheKey, faces);
  }
  const seg = shaftSegmentForPose(pose, params);
  let minDist = Infinity;
  for (let f = 0; f < 2; f++) {
    const tris = faces[f];
    for (let i = 0; i < tris.length; i++) {
      const dd = distanceSegmentToTriangleScalar(seg[0], seg[1], tris[i]);
      if (dd < minDist) {
        minDist = dd;
      }
    }
  }
  return minDist - params.holderRadius;
}

function passTip(k, passDef, t, params) {
  const deltaTheta = (2 * Math.PI) / params.numBlades;
  const halfGap = (deltaTheta - params.thickness / passDef.r) / 2;
  const theta = passageCenterTheta(k, t, params) + (passDef.f - 0.5) * 2 * halfGap;
  const z = params.z0 + t * (params.z1 - params.z0);
  return [passDef.r * Math.cos(theta), passDef.r * Math.sin(theta), z];
}

function samplePassPoses(k, passDef, params) {
  const n = params.nSamples;
  const poses = [];
  const up = passDef.parity % 2 === 0;
  for (let j = 0; j <= n; j++) {
    const frac = j / n;
    const t = up ? frac : 1 - frac;
    poses.push({
      tip: passTip(k, passDef, t, params),
      t: t
    });
  }
  return poses;
}

function requiredTiltForPass(k, passDef, params, meshCache) {
  const target = params.requiredClearance + params.safetyMargin;
  const samples = samplePassPoses(k, passDef, params);
  const stride = params.searchStride;
  const poseRefs = [];
  for (let i = 0; i < samples.length; i += stride) {
    poseRefs.push(samples[i]);
  }
  const clearance = (deltaDeg) => {
    let mn = Infinity;
    for (let i = 0; i < poseRefs.length; i++) {
      const s = poseRefs[i];
      const pose = {
        tip: s.tip,
        axis: axisForTilt(k, s.t, deltaDeg, params)
      };
      const cl = holderClearanceToBlades(k, pose, params, params.searchMeshRes, meshCache);
      if (cl < mn) {
        mn = cl;
      }
    }
    return mn;
  };
  const step = 2;
  let best = null;
  for (let d = 0; d <= params.maxTiltDeg + 1e-9; d += step) {
    if (clearance(d) >= target) {
      best = d;
      break;
    }
  }
  if (best === null) {
    return params.maxTiltDeg;
  }
  let lo = Math.max(0, best - step);
  let hi = best;
  let bestHi = hi;
  for (let it = 0; it < 12; it++) {
    const mid = (lo + hi) / 2;
    if (clearance(mid) >= target) {
      hi = mid;
      bestHi = mid;
    } else {
      lo = mid;
    }
  }
  return Math.max(bestHi, params.minTiltDeg);
}

// ---------------------------------------------------------------------------
// Toolpath generation
// ---------------------------------------------------------------------------

class ImpellerCAM {
  constructor(options) {
    this.params = Object.assign({}, DEFAULT_PARAMS, options || {});
    this.params.twistB = (this.params.twistDeg * Math.PI) / 180;
    this._meshCache = new Map();
    this._generated = null;
  }

  buildGeometry(opts) {
    const res = opts && opts.meshRes !== undefined ? opts.meshRes : this.params.validateMeshRes;
    const params = this.params;
    const blades = [];
    for (let k = 0; k < params.numBlades; k++) {
      blades.push({
        index: k,
        faces: {
          plus: buildFaceMeshCached(k, 1, params, res),
          minus: buildFaceMeshCached(k, -1, params, res)
        }
      });
    }
    return {
      params: params,
      blades: blades
    };
  }

  generateToolpath(opts) {
    const key = JSON.stringify(opts || null);
    if (this._generated && this._generated.key === key) {
      return this._generated.path;
    }
    const params = Object.assign({}, this.params, opts || {});
    params.twistB = this.params.twistB;
    const cache = this._meshCache;
    const passages = [];
    for (let k = 0; k < params.numBlades; k++) {
      passages.push(this._buildPassage(k, params, cache));
    }
    const stats = this._computeStats(passages);
    const path = {
      passages: passages,
      stats: stats,
      version: IMPELLER_CAM_VERSION
    };
    this._generated = { key: key, path: path };
    return path;
  }

  _buildPassage(k, params, cache) {
    const passDefs = [];
    const radialFractions = params.radialFractions || defaultRadialFractions(params);
    const angularFractions = params.angularFractions || [0.35, 0.65];
    for (let p = 0; p < params.nRadial; p++) {
      for (let q = 0; q < params.nAngular; q++) {
        const idx = p * params.nAngular + q;
        passDefs.push({
          p: p,
          q: q,
          parity: idx,
          r: params.Rh + (params.Rs - params.Rh) * radialFractions[p],
          f: angularFractions[q],
          tiltDeg: null
        });
      }
    }
    for (let i = 0; i < passDefs.length; i++) {
      passDefs[i].tiltDeg = requiredTiltForPass(k, passDefs[i], params, cache);
    }
    let poses = this._buildSequence(k, passDefs, params);
    let consensus = this._validateSequence(k, poses, params, cache);
    let rounds = 0;
    while (!consensus.ok && rounds < 5) {
      for (const idx of consensus.failPasses) {
        passDefs[idx].tiltDeg = Math.min(passDefs[idx].tiltDeg + 2, params.maxTiltDeg);
      }
      poses = this._buildSequence(k, passDefs, params);
      consensus = this._validateSequence(k, poses, params, cache);
      rounds++;
    }
    return {
      index: k,
      passes: passDefs.length,
      tiltMinDeg: Math.min.apply(
        null,
        passDefs.map((dd) => dd.tiltDeg)
      ),
      tiltMaxDeg: Math.max.apply(
        null,
        passDefs.map((dd) => dd.tiltDeg)
      ),
      poses: poses,
      stats: {
        passes: passDefs.length,
        tiltMinDeg: Math.min.apply(
          null,
          passDefs.map((dd) => dd.tiltDeg)
        ),
        tiltMaxDeg: Math.max.apply(
          null,
          passDefs.map((dd) => dd.tiltDeg)
        ),
        minHolderClearanceMm: consensus.minClearance,
        maxAxisJumpMm: consensus.maxJump,
        maxAxisChangeDeg: consensus.maxAxisChangeDeg
      }
    };
  }

  _buildSequence(k, passDefs, params) {
    const poses = [];
    for (let i = 0; i < passDefs.length; i++) {
      const def = passDefs[i];
      const samples = samplePassPoses(k, def, params);
      for (let j = 0; j < samples.length; j++) {
        const s = samples[j];
        poses.push({
          tip: s.tip,
          axis: axisForTilt(k, s.t, def.tiltDeg, params),
          passageIndex: k,
          passIndex: i,
          kind: 'cut',
          t: s.t,
          tiltDeg: def.tiltDeg
        });
      }
      if (i < passDefs.length - 1) {
        this._appendLink(k, poses, def, passDefs[i + 1], params);
      }
    }
    return poses;
  }

  _appendLink(k, poses, fromDef, toDef, params) {
    const from = poses[poses.length - 1];
    const toSamples = samplePassPoses(k, toDef, params);
    const to = {
      tip: toSamples[0].tip,
      t: toSamples[0].t
    };
    const dx = to.tip[0] - from.tip[0];
    const dy = to.tip[1] - from.tip[1];
    const dz = to.tip[2] - from.tip[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.max(1, Math.ceil(dist / params.linkSpacing));
    const deltaFrom = from.tiltDeg;
    const deltaTo = toDef.tiltDeg;
    for (let s = 1; s <= steps; s++) {
      const lambda = s / steps;
      const t = from.t + lambda * (to.t - from.t);
      const delta = deltaFrom + lambda * (deltaTo - deltaFrom);
      poses.push({
        tip: [from.tip[0] + dx * lambda, from.tip[1] + dy * lambda, from.tip[2] + dz * lambda],
        axis: axisForTilt(k, t, delta, params),
        passageIndex: k,
        passIndex: -1,
        kind: 'link',
        t: t,
        tiltDeg: delta
      });
    }
  }

  _validateSequence(k, poses, params, cache) {
    let minClearance = Infinity;
    let maxJump = 0;
    let maxAxisChangeDeg = 0;
    const failPasses = new Set();
    let prev = null;
    for (let i = 0; i < poses.length; i++) {
      const pose = poses[i];
      const cl = holderClearanceToBlades(k, pose, params, params.validateMeshRes, cache);
      if (cl < minClearance) {
        minClearance = cl;
      }
      if (cl < params.requiredClearance) {
        if (pose.passIndex >= 0) {
          failPasses.add(pose.passIndex);
        } else {
          for (let b = i - 1; b >= 0; b--) {
            if (poses[b].passIndex >= 0) {
              failPasses.add(poses[b].passIndex);
              break;
            }
          }
          for (let f = i + 1; f < poses.length; f++) {
            if (poses[f].passIndex >= 0) {
              failPasses.add(poses[f].passIndex);
              break;
            }
          }
        }
      }
      if (prev) {
        const dx = pose.tip[0] - prev.tip[0];
        const dy = pose.tip[1] - prev.tip[1];
        const dz = pose.tip[2] - prev.tip[2];
        const jump = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (jump > maxJump) {
          maxJump = jump;
        }
        let cosAng = pose.axis[0] * prev.axis[0] + pose.axis[1] * prev.axis[1] + pose.axis[2] * prev.axis[2];
        cosAng = clamp(cosAng, -1, 1);
        const angDeg = (Math.acos(cosAng) * 180) / Math.PI;
        if (angDeg > maxAxisChangeDeg) {
          maxAxisChangeDeg = angDeg;
        }
      }
      prev = pose;
    }
    return {
      ok: failPasses.size === 0,
      failPasses: Array.from(failPasses),
      minClearance: minClearance,
      maxJump: maxJump,
      maxAxisChangeDeg: maxAxisChangeDeg
    };
  }

  _computeStats(passages) {
    let minClearance = Infinity;
    let maxJump = 0;
    let maxAxisChangeDeg = 0;
    let totalPoses = 0;
    let totalPasses = 0;
    for (let k = 0; k < passages.length; k++) {
      const p = passages[k];
      const s = p.stats;
      totalPoses += p.poses.length;
      totalPasses += p.passes;
      if (s.minHolderClearanceMm < minClearance) {
        minClearance = s.minHolderClearanceMm;
      }
      if (s.maxAxisJumpMm > maxJump) {
        maxJump = s.maxAxisJumpMm;
      }
      if (s.maxAxisChangeDeg > maxAxisChangeDeg) {
        maxAxisChangeDeg = s.maxAxisChangeDeg;
      }
    }
    return {
      totalPoses: totalPoses,
      totalPasses: totalPasses,
      minHolderClearanceMm: minClearance,
      maxAxisJumpMm: maxJump,
      maxAxisChangeDeg: maxAxisChangeDeg
    };
  }

  shaftSegmentForPose(pose) {
    return shaftSegmentForPose(pose, this.params);
  }

  holderClearance(passageIndex, pose, opts) {
    const res = opts && opts.meshRes !== undefined ? opts.meshRes : this.params.validateMeshRes;
    return holderClearanceToBlades(passageIndex, pose, this.params, res, this._meshCache);
  }
}

module.exports = {
  ImpellerCAM,
  DEFAULT_PARAMS,
  IMPELLER_CAM_VERSION,
  bladeTheta,
  bladeMidPoint,
  bladeFacePoint,
  buildFaceMeshCached,
  passageCenterTheta,
  passageDir,
  axisForTilt,
  shaftSegmentForPose,
  holderClearanceToBlades,
  distanceSegmentToTriangleScalar
};
