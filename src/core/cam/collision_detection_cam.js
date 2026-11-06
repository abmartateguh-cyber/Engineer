/**
 * ToolAssemblyCollisionDetection: CAM tool-assembly collision detection engine
 *
 * Models a cutting tool as a vertical assembly of three coaxial cylinders
 * (flute -> shank -> holder, radii increasing) swept along a tool path, and
 * checks clearance against workpiece / fixture triangle meshes (or boxes).
 *
 * Geometry
 * -------
 * Each tool assembly segment is modelled as a sphere-swept segment (capsule):
 * a finite cylinder with hemispherical end caps, defined by an axis segment
 * and a radius. This gives exact closed-form distance queries:
 *
 *   - cylinder-triangle: distance from the axis segment to the triangle,
 *     minus the cylinder radius (positive = clearance, negative = overlap).
 *   - cylinder-cylinder:  distance between the two axis segments, minus the
 *     sum of radii.
 *
 * Segment-triangle distance is computed by minimizing over all feature pairs
 * (segment endpoints vs triangle, segment vs triangle edges, triangle
 * vertices vs segment, and segment/plane intersection inside the triangle),
 * which is exact for convex triangles.
 *
 * Clearance semantics
 * -------------------
 *   clearance = <surface distance> - <threshold>
 * A pose is flagged when the minimum segment clearance drops below a
 * threshold (default 0.1 mm). A negative clearance means physical overlap.
 *
 * Deterministic: no random sampling; all searches use fixed grids and
 * bisection.
 */

'use strict';

const COLLISION_DETECTION_CAM_VERSION = '1.0.0';

const EPSILON = 1e-12;
const DEFAULT_THRESHOLD_MM = 0.1;
const DEFAULT_SAFE_CLEARANCE_MM = 0.5;

// ---------------------------------------------------------------------------
// Vector math
// ---------------------------------------------------------------------------

function vecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vecAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vecScale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function vecDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vecCross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function vecLen(a) {
  return Math.sqrt(vecDot(a, a));
}

function vecNormalize(a) {
  const len = vecLen(a);
  if (len < EPSILON) {
    return [0, 0, 0];
  }
  return vecScale(a, 1 / len);
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Rotate vector v about unit axis q by angle (Rodrigues' formula).
 */
function rotateAboutAxis(v, q, angle) {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const dotQv = vecDot(q, v);
  const cross = vecCross(q, v);
  return [
    v[0] * cosA + cross[0] * sinA + q[0] * dotQv * (1 - cosA),
    v[1] * cosA + cross[1] * sinA + q[1] * dotQv * (1 - cosA),
    v[2] * cosA + cross[2] * sinA + q[2] * dotQv * (1 - cosA)
  ];
}

// ---------------------------------------------------------------------------
// Distance primitives
// ---------------------------------------------------------------------------

/**
 * Distance from point p to segment a-b. Returns { dist, closest }.
 */
function distancePointSegment(p, a, b) {
  const ab = vecSub(b, a);
  const len2 = vecDot(ab, ab);
  let t = 0;
  if (len2 > EPSILON) {
    t = clamp(vecDot(vecSub(p, a), ab) / len2, 0, 1);
  }
  const closest = vecAdd(a, vecScale(ab, t));
  return { dist: vecLen(vecSub(p, closest)), closest: closest };
}

/**
 * Distance between segments p1-p2 and q1-q2 (Ericson, RTCD 5.1.9).
 * Returns { dist, closestA, closestB, s, t }.
 */
function distanceSegmentSegment(p1, p2, q1, q2) {
  const d1 = vecSub(p2, p1);
  const d2 = vecSub(q2, q1);
  const r = vecSub(p1, q1);
  const a = vecDot(d1, d1);
  const e = vecDot(d2, d2);
  const f = vecDot(d2, r);
  let s = 0;
  let t = 0;

  if (a <= EPSILON && e <= EPSILON) {
    s = 0;
    t = 0;
  } else if (a <= EPSILON) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = vecDot(d1, r);
    if (e <= EPSILON) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = vecDot(d1, d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  const closestA = vecAdd(p1, vecScale(d1, s));
  const closestB = vecAdd(q1, vecScale(d2, t));
  return {
    dist: vecLen(vecSub(closestA, closestB)),
    closestA: closestA,
    closestB: closestB,
    s: s,
    t: t
  };
}

/**
 * Distance from point p to triangle a-b-c (Ericson, RTCD 5.1.5).
 * Returns { dist, closest }.
 */
function distancePointTriangle(p, a, b, c) {
  const ab = vecSub(b, a);
  const ac = vecSub(c, a);
  const ap = vecSub(p, a);
  const d1 = vecDot(ab, ap);
  const d2 = vecDot(ac, ap);
  if (d1 <= 0 && d2 <= 0) {
    return { dist: vecLen(ap), closest: a };
  }
  const bp = vecSub(p, b);
  const d3 = vecDot(ab, bp);
  const d4 = vecDot(ac, bp);
  if (d3 >= 0 && d4 <= d3) {
    return { dist: vecLen(bp), closest: b };
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const closest = vecAdd(a, vecScale(ab, v));
    return { dist: vecLen(vecSub(p, closest)), closest: closest };
  }
  const cp = vecSub(p, c);
  const d5 = vecDot(ab, cp);
  const d6 = vecDot(ac, cp);
  if (d6 >= 0 && d5 <= d6) {
    return { dist: vecLen(cp), closest: c };
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const closest = vecAdd(a, vecScale(ac, w));
    return { dist: vecLen(vecSub(p, closest)), closest: closest };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    const closest = vecAdd(b, vecScale(vecSub(c, b), w));
    return { dist: vecLen(vecSub(p, closest)), closest: closest };
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const closest = vecAdd(a, vecAdd(vecScale(ab, v), vecScale(ac, w)));
  return { dist: vecLen(vecSub(p, closest)), closest: closest };
}

/**
 * Distance between segment A-B and triangle a-b-c. Exact for a convex
 * triangle: minimizes over (1) segment endpoints vs triangle, (2) segment
 * vs triangle edges, (3) triangle vertices vs segment, (4) segment/plane
 * intersection inside the triangle.
 * Returns { dist, closestA, closestB, normal } where `normal` is the unit
 * vector pointing from the triangle toward the segment, and closestA/B are
 * the closest points on the segment / triangle.
 */
function distanceSegmentTriangle(A, B, a, b, c) {
  const ab = vecSub(b, a);
  const ac = vecSub(c, a);
  const n = vecNormalize(vecCross(ab, ac));
  const abLen = vecLen(ab);
  const acLen = vecLen(ac);
  const degenerate = abLen < EPSILON || acLen < EPSILON || vecLen(n) < 1e-10;

  let best = null;
  let bestNorm = null;
  let bestClosestA = null;
  let bestClosestB = null;

  function consider(dist, closestA, closestB, normal) {
    if (best === null || dist < best - 1e-12) {
      best = dist;
      bestNorm = normal;
      bestClosestA = closestA;
      bestClosestB = closestB;
    }
  }

  // (3) triangle vertices vs segment (also produces correct interior-plane
  // results for parallel/overlapping configurations via endpoint checks).
  for (const v of [a, b, c]) {
    const r = distancePointSegment(v, A, B);
    consider(r.dist, r.closest, v, vecNormalize(vecSub(r.closest, v)));
  }

  // (2) segment vs triangle edges.
  const edges = [
    [a, b],
    [b, c],
    [c, a]
  ];
  for (const [u, v] of edges) {
    const r = distanceSegmentSegment(A, B, u, v);
    consider(r.dist, r.closestA, r.closestB, vecNormalize(vecSub(r.closestA, r.closestB)));
  }

  // (1) segment endpoints vs triangle (interior projection handling).
  for (const p of [A, B]) {
    const r = distancePointTriangle(p, a, b, c);
    consider(r.dist, p, r.closest, vecNormalize(vecSub(p, r.closest)));
  }

  // (4) segment/plane intersection inside the triangle: the portion of the
  // segment whose projection lies inside the triangle. For each triangle
  // edge (oriented by the face normal) the inside condition is linear in t,
  // so the feasible t-interval is a simple bisection of three half-spaces.
  if (!degenerate) {
    const dir = vecSub(B, A);
    const sA = vecDot(n, A) - vecDot(n, a);
    const sB = vecDot(n, B) - vecDot(n, a);
    let lo = 0;
    let hi = 1;
    let feasible = true;
    for (const [u, v] of edges) {
      const e = vecSub(v, u);
      const fAt = (t) => vecDot(vecCross(e, vecSub(vecAdd(A, vecScale(dir, t)), u)), n);
      const f0 = fAt(0);
      const f1 = fAt(1);
      if (f0 >= -1e-9 && f1 >= -1e-9) {
        continue;
      }
      if (f0 < -1e-9 && f1 < -1e-9) {
        feasible = false;
        break;
      }
      const tCross = f0 / (f0 - f1);
      if (f0 < f1) {
        lo = Math.max(lo, tCross);
      } else {
        hi = Math.min(hi, tCross);
      }
      if (lo > hi) {
        feasible = false;
        break;
      }
    }
    if (feasible) {
      const sAt = (t) => sA + t * (sB - sA);
      let planeDist = Infinity;
      let tPlane = lo;
      const sLo = sAt(lo);
      const sHi = sAt(hi);
      if (sLo * sHi <= 0) {
        planeDist = 0;
        tPlane = Math.abs(sLo) <= Math.abs(sHi) ? lo : hi;
      } else if (Math.abs(sLo) <= Math.abs(sHi)) {
        planeDist = Math.abs(sLo);
        tPlane = lo;
      } else {
        planeDist = Math.abs(sHi);
        tPlane = hi;
      }
      const pointOnPlane = vecAdd(A, vecScale(dir, tPlane));
      const planeNormal = sA + sB >= 0 ? n : vecScale(n, -1);
      consider(planeDist, pointOnPlane, pointOnPlane, planeNormal);
    }
  }

  return {
    dist: best,
    closestA: bestClosestA,
    closestB: bestClosestB,
    normal: bestNorm
  };
}

/**
 * Clearance between a cylinder (axis segment start-end, radius r) and a
 * triangle. Positive = gap, negative = overlap depth.
 */
function distanceCylinderTriangle(start, end, radius, tri) {
  const r = distanceSegmentTriangle(start, end, tri[0], tri[1], tri[2]);
  return r.dist - radius;
}

/**
 * Clearance between two cylinders (axis segments + radii).
 */
function distanceCylinderCylinder(a0, a1, ra, b0, b1, rb) {
  const r = distanceSegmentSegment(a0, a1, b0, b1);
  return r.dist - ra - rb;
}

/**
 * Decompose an axis-aligned box { min:[x0,y0,z0], max:[x1,y1,z1] } into 12
 * outward-facing triangles.
 */
function boxToTriangles(box) {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  return [
    // +x
    [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1]
    ],
    [
      [x1, y0, z0],
      [x1, y1, z1],
      [x1, y0, z1]
    ],
    // -x
    [
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1]
    ],
    [
      [x0, y0, z0],
      [x0, y1, z1],
      [x0, y1, z0]
    ],
    // +y
    [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1]
    ],
    [
      [x0, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1]
    ],
    // -y
    [
      [x0, y0, z0],
      [x0, y0, z1],
      [x1, y0, z1]
    ],
    [
      [x0, y0, z0],
      [x1, y0, z1],
      [x1, y0, z0]
    ],
    // +z
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1]
    ],
    [
      [x0, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1]
    ],
    // -z
    [
      [x0, y0, z0],
      [x1, y1, z0],
      [x1, y0, z0]
    ],
    [
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0]
    ]
  ];
}

// ---------------------------------------------------------------------------
// Tool assembly model
// ---------------------------------------------------------------------------

const SEGMENT_NAMES = ['flute', 'shank', 'holder'];

class ToolAssembly {
  /**
   * @param {Object} opts - { flute:{radius,length}, shank:{radius,length},
   *   holder:{radius,length} } with flute.radius < shank.radius <
   *   holder.radius and positive lengths.
   */
  constructor(opts) {
    if (!opts || !opts.flute || !opts.shank || !opts.holder) {
      throw new TypeError('ToolAssembly requires flute/shank/holder definitions');
    }
    this.flute = {
      radius: Number(opts.flute.radius),
      length: Number(opts.flute.length)
    };
    this.shank = {
      radius: Number(opts.shank.radius),
      length: Number(opts.shank.length)
    };
    this.holder = {
      radius: Number(opts.holder.radius),
      length: Number(opts.holder.length)
    };
    if (!(this.flute.radius > 0 && this.shank.radius > 0 && this.holder.radius > 0)) {
      throw new RangeError('ToolAssembly radii must be positive');
    }
    if (!(this.flute.length > 0 && this.shank.length > 0 && this.holder.length > 0)) {
      throw new RangeError('ToolAssembly lengths must be positive');
    }
    if (!(this.flute.radius < this.shank.radius && this.shank.radius < this.holder.radius)) {
      throw new RangeError('ToolAssembly radii must satisfy flute < shank < holder');
    }
    this.totalLength = this.flute.length + this.shank.length + this.holder.length;
  }

  /**
   * Segment axis offsets measured from the tool tip along the spindle axis.
   * Returns { flute:[off0,off1], shank:[...], holder:[...] }.
   */
  segmentOffsets() {
    const o = this.flute.length;
    const s = o + this.shank.length;
    return {
      flute: [0, o],
      shank: [o, s],
      holder: [s, this.totalLength]
    };
  }

  /**
   * Compute the axis segment + radius for an assembly element at a pose.
   * Pose: { centerline:[x,y,z], axis:[i,j,k] } where `axis` points along the
   * spindle toward the cut (segments extend opposite the axis, from the tip).
   */
  segmentAtPose(pose, name) {
    const axis = vecNormalize(pose.axis);
    if (vecLen(axis) < 1e-9) {
      throw new RangeError('Tool pose axis must be non-zero');
    }
    const dir = vecScale(axis, -1);
    const offsets = this.segmentOffsets()[name];
    const start = vecAdd(pose.centerline, vecScale(dir, offsets[0]));
    const end = vecAdd(pose.centerline, vecScale(dir, offsets[1]));
    return {
      start: start,
      end: end,
      radius: this[name].radius
    };
  }

  segmentsAtPose(pose) {
    const out = {};
    for (const name of SEGMENT_NAMES) {
      out[name] = this.segmentAtPose(pose, name);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Obstacle normalization
// ---------------------------------------------------------------------------

function normalizeObstacles(obstacles) {
  const triangles = [];
  for (const item of obstacles || []) {
    if (item && Array.isArray(item.min) && Array.isArray(item.max)) {
      triangles.push(...boxToTriangles(item));
    } else if (Array.isArray(item) && item.length === 3) {
      triangles.push(item);
    } else if (item && Array.isArray(item.triangles)) {
      triangles.push(...item.triangles);
    } else {
      throw new TypeError('Obstacle must be a triangle, an array of triangles, or a box {min,max}');
    }
  }
  return triangles;
}

// ---------------------------------------------------------------------------
// Path analysis
// ---------------------------------------------------------------------------

/**
 * Minimum clearance (over all assembly segments) at one pose against the
 * obstacle mesh. Returns { minClearance, perSegment: {flute,shank,holder},
 * worstSegment }.
 */
function minClearanceAtPose(assembly, pose, triangles) {
  const segments = assembly.segmentsAtPose(pose);
  const perSegment = {};
  let minClearance = Infinity;
  let worstSegment = null;
  for (const name of SEGMENT_NAMES) {
    const seg = segments[name];
    let clearance = Infinity;
    for (const tri of triangles) {
      const c = distanceCylinderTriangle(seg.start, seg.end, seg.radius, tri);
      if (c < clearance) {
        clearance = c;
      }
    }
    perSegment[name] = clearance;
    if (clearance < minClearance) {
      minClearance = clearance;
      worstSegment = name;
    }
  }
  return { minClearance: minClearance, perSegment: perSegment, worstSegment: worstSegment };
}

/**
 * Analyze a tool path (list of poses with centerline + axis) against obstacle
 * meshes. Flags interference when a segment clearance drops below `threshold`
 * (default 0.1 mm).
 *
 * @param {ToolAssembly} assembly
 * @param {Array<Object>} path - poses { centerline:[x,y,z], axis:[i,j,k] }
 * @param {Array} obstacles - triangles / boxes (see normalizeObstacles)
 * @param {Object} [opts] - { threshold, sweepSamples }
 * @returns {Object} { poses, collisions, minClearance, perSegmentMin, threshold }
 */
function analyzeToolpath(assembly, path, obstacles, opts = {}) {
  const threshold = opts.threshold !== undefined ? opts.threshold : DEFAULT_THRESHOLD_MM;
  const sweepSamples = opts.sweepSamples !== undefined ? opts.sweepSamples : 0;
  const triangles = normalizeObstacles(obstacles);

  const poses = [];
  const collisions = [];
  let globalMin = Infinity;
  const perSegmentMin = { flute: Infinity, shank: Infinity, holder: Infinity };

  if (Array.isArray(path) && path.length > 0) {
    // Build the evaluation pose sequence including optional swept-volume
    // interpolation between consecutive poses (union of sampled assemblies).
    const evalPoses = [];
    for (let i = 0; i < path.length; i++) {
      if (i > 0 && sweepSamples > 0) {
        const prev = path[i - 1];
        const cur = path[i];
        for (let k = 1; k <= sweepSamples; k++) {
          const t = k / (sweepSamples + 1);
          evalPoses.push({
            index: i,
            centerline: [
              prev.centerline[0] + t * (cur.centerline[0] - prev.centerline[0]),
              prev.centerline[1] + t * (cur.centerline[1] - prev.centerline[1]),
              prev.centerline[2] + t * (cur.centerline[2] - prev.centerline[2])
            ],
            axis: vecNormalize(vecAdd(vecScale(prev.axis, 1 - t), vecScale(cur.axis, t)))
          });
        }
      }
      evalPoses.push({ index: i, centerline: path[i].centerline, axis: path[i].axis });
    }

    for (const pose of evalPoses) {
      const r = minClearanceAtPose(assembly, pose, triangles);
      if (r.minClearance < globalMin) {
        globalMin = r.minClearance;
      }
      for (const name of SEGMENT_NAMES) {
        if (r.perSegment[name] < perSegmentMin[name]) {
          perSegmentMin[name] = r.perSegment[name];
        }
      }
      const poseCollisions = [];
      for (const name of SEGMENT_NAMES) {
        if (r.perSegment[name] < threshold) {
          poseCollisions.push({ segment: name, clearance: r.perSegment[name] });
          collisions.push({ index: pose.index, segment: name, clearance: r.perSegment[name] });
        }
      }
      poses.push({
        index: pose.index,
        clearances: r.perSegment,
        minClearance: r.minClearance,
        worstSegment: r.worstSegment,
        collisions: poseCollisions
      });
    }
  }

  collisions.sort((x, y) => {
    if (x.index !== y.index) {
      return x.index - y.index;
    }
    return SEGMENT_NAMES.indexOf(x.segment) - SEGMENT_NAMES.indexOf(y.segment);
  });

  return {
    poses: poses,
    collisions: collisions,
    minClearance: globalMin,
    perSegmentMin: perSegmentMin,
    threshold: threshold
  };
}

/**
 * Swept assembly volume between two poses: returns sampled assembly segment
 * definitions at `steps` intermediate parameter values (exclusive of the
 * endpoints).
 */
function sweptSegmentsBetweenPoses(assembly, poseA, poseB, steps = 4) {
  const out = [];
  for (let k = 1; k <= steps; k++) {
    const t = k / (steps + 1);
    const pose = {
      centerline: [
        poseA.centerline[0] + t * (poseB.centerline[0] - poseA.centerline[0]),
        poseA.centerline[1] + t * (poseB.centerline[1] - poseA.centerline[1]),
        poseA.centerline[2] + t * (poseB.centerline[2] - poseA.centerline[2])
      ],
      axis: vecNormalize(vecAdd(vecScale(poseA.axis, 1 - t), vecScale(poseB.axis, t)))
    };
    out.push({ t: t, segments: assembly.segmentsAtPose(pose) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Collision-free tilt resolution
// ---------------------------------------------------------------------------

function worstCollisionInfo(assembly, pose, triangles) {
  const segments = assembly.segmentsAtPose(pose);
  let worst = null;
  let worstName = null;
  for (const name of SEGMENT_NAMES) {
    const seg = segments[name];
    for (const tri of triangles) {
      const r = distanceSegmentTriangle(seg.start, seg.end, tri[0], tri[1], tri[2]);
      const clearance = r.dist - seg.radius;
      if (worst === null || clearance < worst.clearance) {
        worst = {
          clearance: clearance,
          segment: name,
          normal: r.normal || [1, 0, 0]
        };
        worstName = name;
      }
    }
  }
  return { segment: worstName, clearance: worst ? worst.clearance : Infinity, normal: worst ? worst.normal : null };
}

/**
 * Search for the minimum viable tilt that restores clearance >= dSafe at a
 * colliding pose. The tool pivots about its tip; the axis is rotated in the
 * plane spanned by the tool axis and the collision normal.
 *
 * Search: coarse angular grid in both tilt directions (default 0.5 deg
 * steps up to 45 deg), then bisection from the last failing angle to the
 * first passing angle to recover the minimum viable tilt.
 *
 * @returns {Object} { feasible, angleRad, angleDeg, clearance, pose, segment,
 *   dSafe } — pose.centerline is unchanged, pose.axis is the tilted axis.
 */
function resolveCollisionFreeTilt(assembly, path, collisionIndex, obstacles, opts = {}) {
  const dSafe = opts.dSafe !== undefined ? opts.dSafe : DEFAULT_SAFE_CLEARANCE_MM;
  const maxAngleRad = opts.maxAngleRad !== undefined ? opts.maxAngleRad : Math.PI / 4;
  const gridStepRad = opts.gridStepRad !== undefined ? opts.gridStepRad : Math.PI / 360;
  const refineIterations = opts.refineIterations !== undefined ? opts.refineIterations : 28;
  const triangles = normalizeObstacles(obstacles);

  const pose = path[collisionIndex];
  if (!pose) {
    throw new RangeError(`No pose at collision index ${collisionIndex}`);
  }
  const tip = pose.centerline;
  const axis = vecNormalize(pose.axis);
  if (vecLen(axis) < 1e-9) {
    throw new RangeError('Tool pose axis must be non-zero');
  }

  const info = worstCollisionInfo(assembly, pose, triangles);
  if (info.clearance >= dSafe) {
    return {
      feasible: true,
      angleRad: 0,
      angleDeg: 0,
      clearance: info.clearance,
      pose: { centerline: tip, axis: axis },
      segment: info.segment,
      dSafe: dSafe
    };
  }

  let q = vecNormalize(vecCross(axis, info.normal));
  if (vecLen(q) < 1e-9) {
    q = vecNormalize(vecCross(axis, [0, 0, 1]));
  }
  if (vecLen(q) < 1e-9) {
    q = vecNormalize(vecCross(axis, [1, 0, 0]));
  }

  const evaluate = (angle) => {
    const tiltedAxis = vecNormalize(rotateAboutAxis(axis, q, angle));
    const tiltedPose = { centerline: tip, axis: tiltedAxis };
    return minClearanceAtPose(assembly, tiltedPose, triangles).minClearance;
  };

  const maxSteps = Math.max(1, Math.ceil(maxAngleRad / gridStepRad));
  const candidates = [];

  for (const sign of [1, -1]) {
    let prevAngle = 0;
    let prevClearance = evaluate(0);
    for (let k = 1; k <= maxSteps; k++) {
      const angle = sign * k * gridStepRad;
      const clearance = evaluate(angle);
      if (clearance >= dSafe) {
        // Bisection between the last failing angle and this passing angle.
        let lo = prevAngle;
        let hi = angle;
        let loClearance = prevClearance;
        for (let it = 0; it < refineIterations; it++) {
          const mid = 0.5 * (lo + hi);
          const midClearance = evaluate(mid);
          if (midClearance >= dSafe) {
            hi = mid;
          } else {
            lo = mid;
            loClearance = midClearance;
          }
        }
        const finalClearance = evaluate(hi);
        candidates.push({
          angleRad: hi,
          clearance: finalClearance,
          loClearance: loClearance
        });
        break;
      }
      prevAngle = angle;
      prevClearance = clearance;
    }
  }

  if (candidates.length === 0) {
    return {
      feasible: false,
      angleRad: null,
      angleDeg: null,
      clearance: info.clearance,
      pose: { centerline: tip, axis: axis },
      segment: info.segment,
      dSafe: dSafe
    };
  }

  candidates.sort((x, y) => Math.abs(x.angleRad) - Math.abs(y.angleRad));
  const best = candidates[0];
  const tiltedAxis = vecNormalize(rotateAboutAxis(axis, q, best.angleRad));
  return {
    feasible: true,
    angleRad: best.angleRad,
    angleDeg: (best.angleRad * 180) / Math.PI,
    clearance: best.clearance,
    pose: { centerline: tip, axis: tiltedAxis },
    segment: info.segment,
    dSafe: dSafe
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  VERSION: COLLISION_DETECTION_CAM_VERSION,
  ToolAssembly: ToolAssembly,
  SEGMENT_NAMES: SEGMENT_NAMES,
  EPSILON: EPSILON,
  vecSub: vecSub,
  vecAdd: vecAdd,
  vecScale: vecScale,
  vecDot: vecDot,
  vecCross: vecCross,
  vecLen: vecLen,
  vecNormalize: vecNormalize,
  rotateAboutAxis: rotateAboutAxis,
  distancePointSegment: distancePointSegment,
  distanceSegmentSegment: distanceSegmentSegment,
  distancePointTriangle: distancePointTriangle,
  distanceSegmentTriangle: distanceSegmentTriangle,
  distanceCylinderTriangle: distanceCylinderTriangle,
  distanceCylinderCylinder: distanceCylinderCylinder,
  boxToTriangles: boxToTriangles,
  minClearanceAtPose: minClearanceAtPose,
  analyzeToolpath: analyzeToolpath,
  sweptSegmentsBetweenPoses: sweptSegmentsBetweenPoses,
  resolveCollisionFreeTilt: resolveCollisionFreeTilt
};
