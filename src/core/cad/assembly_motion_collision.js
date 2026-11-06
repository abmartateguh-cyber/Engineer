/**
 * Assembly motion collision / clearance detection.
 *
 * Provides:
 *   - Exact analytic minimum-distance functions between primitives:
 *     point-triangle, segment-segment, sphere-sphere, sphere-triangle,
 *     triangle-triangle, plus OBB/point and OBB/segment helpers used for
 *     box primitives.
 *   - A rigid-body swept collision detector (continuous collision detection,
 *     CCD) over a motion step, using exact analytic swept-sphere for
 *     sphere-sphere pairs, and conservative advancement for the remaining
 *     convex primitive pairs (sphere, capsule approximating a cylinder,
 *     box, triangle). Returns the first time of contact within [0, 1] and
 *     the minimum clearance over the move.
 *   - Triangle-mesh static collision via an AABB BVH broad-phase plus exact
 *     triangle-triangle narrow-phase, with a swept (sampled + bisected)
 *     animated version for two assembled meshes.
 *
 * All routines are deterministic and free of external dependencies.
 * Numeric tolerances are stated per routine. The swept mesh path is an
 * approximate discrete sweep, not a certified CCD.
 */

'use strict';

const EPS = 1e-12;
const TWO_EPS = 2e-12;

// ---------------------------------------------------------------------------
// Vector helpers (plain [x, y, z] arrays)
// ---------------------------------------------------------------------------

function vecAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
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
  return Math.hypot(a[0], a[1], a[2]);
}

function vecLenSq(a) {
  return vecDot(a, a);
}

function vecNorm(a) {
  const l = vecLen(a);
  if (l < EPS) return [0, 0, 0];
  return [a[0] / l, a[1] / l, a[2] / l];
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Quaternions [w, x, y, z]
// ---------------------------------------------------------------------------

const quat = {
  identity() {
    return [1, 0, 0, 0];
  },

  multiply(a, b) {
    const aw = a[0],
      ax = a[1],
      ay = a[2],
      az = a[3];
    const bw = b[0],
      bx = b[1],
      by = b[2],
      bz = b[3];
    return [
      aw * bw - ax * bx - ay * by - az * bz,
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw
    ];
  },

  conjugate(q) {
    return [q[0], -q[1], -q[2], -q[3]];
  },

  rotateVec(q, v) {
    const qw = q[0],
      qx = q[1],
      qy = q[2],
      qz = q[3];
    const vx = v[0],
      vy = v[1],
      vz = v[2];
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    return [vx + qw * tx + qy * tz - qz * ty, vy + qw * ty + qz * tx - qx * tz, vz + qw * tz + qx * ty - qy * tx];
  },

  dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  },

  slerp(a, b, t) {
    let cos = clamp(quat.dot(a, b), -1, 1);
    let sign = 1;
    if (cos < 0) {
      cos = -cos;
      sign = -1;
    }
    let s0, s1;
    if (cos > 1 - 1e-6) {
      s0 = 1 - t;
      s1 = t * sign;
    } else {
      const th = Math.acos(cos);
      const st = Math.sin(th);
      s0 = Math.sin((1 - t) * th) / st;
      s1 = (sign * Math.sin(t * th)) / st;
    }
    return [s0 * a[0] + s1 * b[0], s0 * a[1] + s1 * b[1], s0 * a[2] + s1 * b[2], s0 * a[3] + s1 * b[3]];
  },

  angleBetween(a, b) {
    const r = quat.multiply(quat.conjugate(a), b);
    return 2 * Math.acos(clamp(Math.abs(r[0]), 0, 1));
  }
};

// ---------------------------------------------------------------------------
// Poses and motions
// ---------------------------------------------------------------------------
// A pose is { position: [x,y,z], quat: [w,x,y,z] }.
// A motion is { start: pose, end: pose }; a null/undefined motion means the
// body is static at the identity pose.

const IDENTITY_POSE = { position: [0, 0, 0], quat: [1, 0, 0, 0] };

function applyPose(p, pose) {
  return vecAdd(pose.position, quat.rotateVec(pose.quat, p));
}

function poseAt(motion, t) {
  if (!motion) return IDENTITY_POSE;
  const sPos = motion.start && motion.start.position ? motion.start.position : [0, 0, 0];
  const ePos = motion.end && motion.end.position ? motion.end.position : sPos;
  const sQ = motion.start && motion.start.quat ? motion.start.quat : quat.identity();
  const eQ = motion.end && motion.end.quat ? motion.end.quat : sQ;
  return {
    position: [lerp(sPos[0], ePos[0], t), lerp(sPos[1], ePos[1], t), lerp(sPos[2], ePos[2], t)],
    quat: quat.slerp(sQ, eQ, t)
  };
}

function motionSpeedBound(shape, motion) {
  if (!motion) return 0;
  const sPos = motion.start && motion.start.position ? motion.start.position : [0, 0, 0];
  const ePos = motion.end && motion.end.position ? motion.end.position : sPos;
  const sQ = motion.start && motion.start.quat ? motion.start.quat : quat.identity();
  const eQ = motion.end && motion.end.quat ? motion.end.quat : sQ;
  const lin = vecLen(vecSub(ePos, sPos));
  const rot = quat.angleBetween(sQ, eQ);
  return lin + rot * shapeBoundingRadius(shape);
}

function shapeBoundingRadius(shape) {
  switch (shape.type) {
    case 'sphere':
      return shape.radius;
    case 'capsule':
      return Math.max(vecLen(shape.a), vecLen(shape.b)) + shape.radius;
    case 'box':
      return vecLen(shape.halfExtents);
    case 'triangle':
      return Math.max(vecLen(shape.vertices[0]), vecLen(shape.vertices[1]), vecLen(shape.vertices[2]));
    case 'mesh': {
      let m = 0;
      for (const t of shape.triangles) {
        for (const v of t) m = Math.max(m, vecLen(v));
      }
      return m;
    }
    default:
      throw new Error('assembly_motion_collision: unknown shape type "' + shape.type + '"');
  }
}

// ---------------------------------------------------------------------------
// Exact minimum-distance primitives
// ---------------------------------------------------------------------------

/**
 * Distance from a point to a triangle (Ericson, ClosestPtPointTriangle).
 * Returns { dist, closest }.
 */
function distancePointTriangle(p, a, b, c) {
  const ab = vecSub(b, a);
  const ac = vecSub(c, a);
  const ap = vecSub(p, a);
  const d1 = vecDot(ab, ap);
  const d2 = vecDot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { dist: vecLen(ap), closest: a };

  const bp = vecSub(p, b);
  const d3 = vecDot(ab, bp);
  const d4 = vecDot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { dist: vecLen(bp), closest: b };

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { dist: vecLen(vecSub(p, vecAdd(a, vecScale(ab, v)))), closest: vecAdd(a, vecScale(ab, v)) };
  }

  const cp = vecSub(p, c);
  const d5 = vecDot(ab, cp);
  const d6 = vecDot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { dist: vecLen(cp), closest: c };

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { dist: vecLen(vecSub(p, vecAdd(a, vecScale(ac, w)))), closest: vecAdd(a, vecScale(ac, w)) };
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    const q = vecAdd(b, vecScale(vecSub(c, b), w));
    return { dist: vecLen(vecSub(p, q)), closest: q };
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const q = vecAdd(a, vecAdd(vecScale(ab, v), vecScale(ac, w)));
  return { dist: vecLen(vecSub(p, q)), closest: q };
}

/**
 * Distance from a point to a segment. Returns { dist, closest }.
 */
function distancePointSegment(p, a, b) {
  const ab = vecSub(b, a);
  const t = clamp(vecDot(vecSub(p, a), ab) / vecLenSq(ab), 0, 1);
  if (!Number.isFinite(t)) t = 0;
  const q = vecAdd(a, vecScale(ab, t));
  return { dist: vecLen(vecSub(p, q)), closest: q };
}

/**
 * Distance between two segments (Ericson, ClosestPtSegmentSegment).
 * Returns { dist, closestA, closestB, s, t }.
 */
function distanceSegmentSegment(p1, p2, q1, q2) {
  const d1 = vecSub(p2, p1);
  const d2 = vecSub(q2, q1);
  const r = vecSub(p1, q1);
  const a = vecDot(d1, d1);
  const e = vecDot(d2, d2);
  const f = vecDot(d2, r);
  let s, t;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = vecDot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = vecDot(d1, d2);
      const denom = a * e - b * b;
      if (Math.abs(denom) > EPS) {
        s = clamp((b * f - c * e) / denom, 0, 1);
      } else {
        s = 0;
      }
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
  return { dist: vecLen(vecSub(closestA, closestB)), closestA, closestB, s, t };
}

/**
 * Distance between two spheres (signed: negative when overlapping).
 * Returns { dist, closestA, closestB } on the surfaces.
 */
function distanceSphereSphere(cA, rA, cB, rB) {
  const d = vecSub(cA, cB);
  const len = vecLen(d);
  const n = len < EPS ? [1, 0, 0] : vecScale(d, 1 / len);
  return {
    dist: len - rA - rB,
    closestA: vecAdd(cA, vecScale(n, -rA)),
    closestB: vecAdd(cB, vecScale(n, rB))
  };
}

/**
 * Distance from a sphere to a triangle (signed). Returns { dist, closest }
 * with closest the closest point on the triangle.
 */
function distanceSphereTriangle(c, r, a, b, c2) {
  const pt = distancePointTriangle(c, a, b, c2);
  return { dist: pt.dist - r, closest: pt.closest };
}

/**
 * Distance between two triangles (exact for convex triangles: closest
 * features are vertex-face or edge-edge). Returns { dist, closestA, closestB }.
 */
function distanceTriangleTriangle(tA, tB) {
  const [a0, a1, a2] = tA;
  const [b0, b1, b2] = tB;
  const edgesA = [
    [a0, a1],
    [a1, a2],
    [a2, a0]
  ];
  const edgesB = [
    [b0, b1],
    [b1, b2],
    [b2, b0]
  ];
  let best = Infinity;
  let bestA = null;
  let bestB = null;
  const consider = (d, ca, cb) => {
    if (d < best) {
      best = d;
      bestA = ca;
      bestB = cb;
    }
  };
  for (const [u0, u1] of edgesA) {
    for (const [v0, v1] of edgesB) {
      const r = distanceSegmentSegment(u0, u1, v0, v1);
      consider(r.dist, r.closestA, r.closestB);
    }
  }
  for (const v of [a0, a1, a2]) {
    const r = distancePointTriangle(v, b0, b1, b2);
    consider(r.dist, v, r.closest);
  }
  for (const v of [b0, b1, b2]) {
    const r = distancePointTriangle(v, a0, a1, a2);
    consider(r.dist, r.closest, v);
  }
  return { dist: best, closestA: bestA, closestB: bestB };
}

/**
 * Distance from a point to an oriented box (OBB). Returns
 * { dist, closestLocal, closestWorld }.
 */
function distancePointOBB(p, halfExtents, pose) {
  const local = quat.rotateVec(quat.conjugate(pose.quat), vecSub(p, pose.position));
  const cl = [
    clamp(local[0], -halfExtents[0], halfExtents[0]),
    clamp(local[1], -halfExtents[1], halfExtents[1]),
    clamp(local[2], -halfExtents[2], halfExtents[2])
  ];
  return {
    dist: vecLen(vecSub(local, cl)),
    closestLocal: cl,
    closestWorld: applyPose(cl, pose)
  };
}

/**
 * Distance between a segment and an oriented box (exact: endpoint-face or
 * edge-edge features). Returns { dist, closestA, closestB }.
 */
function distanceSegmentOBB(a, b, halfExtents, pose) {
  const verts = boxVertices(halfExtents);
  const edges = boxEdges(verts);
  let best = Infinity;
  let bestA = null;
  let bestB = null;
  const consider = (d, ca, cb) => {
    if (d < best) {
      best = d;
      bestA = ca;
      bestB = cb;
    }
  };
  const r0 = distancePointOBB(a, halfExtents, pose);
  const r1 = distancePointOBB(b, halfExtents, pose);
  consider(r0.dist, a, r0.closestWorld);
  consider(r1.dist, b, r1.closestWorld);
  for (const [e0, e1] of edges) {
    const w0 = applyPose(e0, pose);
    const w1 = applyPose(e1, pose);
    const r = distanceSegmentSegment(a, b, w0, w1);
    consider(r.dist, r.closestA, r.closestB);
  }
  return { dist: best, closestA: bestA, closestB: bestB };
}

function boxVertices(h) {
  const x = h[0],
    y = h[1],
    z = h[2];
  return [
    [x, y, z],
    [x, y, -z],
    [x, -y, z],
    [x, -y, -z],
    [-x, y, z],
    [-x, y, -z],
    [-x, -y, z],
    [-x, -y, -z]
  ];
}

function boxEdges(verts) {
  return [
    [verts[0], verts[1]],
    [verts[0], verts[2]],
    [verts[0], verts[4]],
    [verts[1], verts[3]],
    [verts[1], verts[5]],
    [verts[2], verts[3]],
    [verts[2], verts[6]],
    [verts[3], verts[7]],
    [verts[4], verts[5]],
    [verts[4], verts[6]],
    [verts[5], verts[7]],
    [verts[6], verts[7]]
  ];
}

/**
 * Distance between two oriented boxes (exact via vertex-face and edge-edge
 * features). Returns { dist, closestA, closestB }.
 */
function distanceBoxBox(shapeA, poseA, shapeB, poseB) {
  const hA = shapeA.halfExtents;
  const hB = shapeB.halfExtents;
  const vertsA = boxVertices(hA);
  const vertsB = boxVertices(hB);
  const edgesA = boxEdges(vertsA);
  const edgesB = boxEdges(vertsB);
  let best = Infinity;
  let bestA = null;
  let bestB = null;
  const consider = (d, ca, cb) => {
    if (d < best) {
      best = d;
      bestA = ca;
      bestB = cb;
    }
  };
  for (const v of vertsA) {
    const w = applyPose(v, poseA);
    const r = distancePointOBB(w, hB, poseB);
    consider(r.dist, w, r.closestWorld);
  }
  for (const v of vertsB) {
    const w = applyPose(v, poseB);
    const r = distancePointOBB(w, hA, poseA);
    consider(r.dist, r.closestWorld, w);
  }
  for (const [pa0, pa1] of edgesA) {
    const wa0 = applyPose(pa0, poseA);
    const wa1 = applyPose(pa1, poseA);
    for (const [pb0, pb1] of edgesB) {
      const wb0 = applyPose(pb0, poseB);
      const wb1 = applyPose(pb1, poseB);
      const r = distanceSegmentSegment(wa0, wa1, wb0, wb1);
      consider(r.dist, r.closestA, r.closestB);
    }
  }
  return { dist: best, closestA: bestA, closestB: bestB };
}

// ---------------------------------------------------------------------------
// Shape-pair distance dispatch
// ---------------------------------------------------------------------------

function shapeWorldParts(shape, pose) {
  switch (shape.type) {
    case 'sphere':
      return { center: pose.position, radius: shape.radius };
    case 'capsule':
      return { a: applyPose(shape.a, pose), b: applyPose(shape.b, pose), radius: shape.radius };
    case 'box':
      return { halfExtents: shape.halfExtents, pose };
    case 'triangle':
      return {
        vertices: [
          applyPose(shape.vertices[0], pose),
          applyPose(shape.vertices[1], pose),
          applyPose(shape.vertices[2], pose)
        ]
      };
    default:
      throw new Error('assembly_motion_collision: unsupported shape "' + shape.type + '" in distance dispatch');
  }
}

/**
 * Minimum signed surface-to-surface distance between two convex primitives
 * (sphere, capsule, box, triangle) at given poses. Returns
 * { dist, closestA, closestB }.
 */
function shapeDistance(shapeA, poseA, shapeB, poseB) {
  const key = [shapeA.type, shapeB.type].sort().join(':');
  switch (key) {
    case 'box:box': {
      return distanceBoxBox(shapeA, poseA, shapeB, poseB);
    }
    case 'box:capsule': {
      const c = shapeWorldParts(shapeA, poseA);
      const s = shapeWorldParts(shapeB, poseB);
      const r = distanceSegmentOBB(s.a, s.b, c.halfExtents, c.pose);
      return { dist: r.dist - s.radius, closestA: r.closestA, closestB: r.closestB };
    }
    case 'box:sphere': {
      const c = shapeWorldParts(shapeA, poseA);
      const s = shapeWorldParts(shapeB, poseB);
      const r = distancePointOBB(s.center, c.halfExtents, c.pose);
      return { dist: r.dist - s.radius, closestA: r.closestWorld, closestB: s.center };
    }
    case 'box:triangle': {
      const c = shapeWorldParts(shapeA, poseA);
      const t = shapeWorldParts(shapeB, poseB).vertices;
      const verts = boxVertices(c.halfExtents);
      const edges = boxEdges(verts);
      let best = Infinity;
      let bestA = null;
      let bestB = null;
      const consider = (d, ca, cb) => {
        if (d < best) {
          best = d;
          bestA = ca;
          bestB = cb;
        }
      };
      for (const v of verts) {
        const w = applyPose(v, c.pose);
        const r = distancePointTriangle(w, t[0], t[1], t[2]);
        consider(r.dist, w, r.closest);
      }
      for (const [e0, e1] of edges) {
        const w0 = applyPose(e0, c.pose);
        const w1 = applyPose(e1, c.pose);
        for (const [f0, f1] of [
          [t[0], t[1]],
          [t[1], t[2]],
          [t[2], t[0]]
        ]) {
          const r = distanceSegmentSegment(w0, w1, f0, f1);
          consider(r.dist, r.closestA, r.closestB);
        }
      }
      return { dist: best, closestA: bestA, closestB: bestB };
    }
    case 'capsule:capsule': {
      const a = shapeWorldParts(shapeA, poseA);
      const b = shapeWorldParts(shapeB, poseB);
      const r = distanceSegmentSegment(a.a, a.b, b.a, b.b);
      return { dist: r.dist - a.radius - b.radius, closestA: r.closestA, closestB: r.closestB };
    }
    case 'capsule:sphere': {
      const a = shapeWorldParts(shapeA, poseA);
      const s = shapeWorldParts(shapeB, poseB);
      const r = distancePointSegment(s.center, a.a, a.b);
      return { dist: r.dist - a.radius - s.radius, closestA: r.closest, closestB: s.center };
    }
    case 'capsule:triangle': {
      const a = shapeWorldParts(shapeA, poseA);
      const t = shapeWorldParts(shapeB, poseB).vertices;
      let best = Infinity;
      let bestA = null;
      let bestB = null;
      const consider = (d, ca, cb) => {
        if (d < best) {
          best = d;
          bestA = ca;
          bestB = cb;
        }
      };
      for (const v of [a.a, a.b]) {
        const r = distancePointTriangle(v, t[0], t[1], t[2]);
        consider(r.dist, v, r.closest);
      }
      for (const [f0, f1] of [
        [t[0], t[1]],
        [t[1], t[2]],
        [t[2], t[0]]
      ]) {
        const r = distanceSegmentSegment(a.a, a.b, f0, f1);
        consider(r.dist, r.closestA, r.closestB);
      }
      return { dist: best - a.radius, closestA: bestA, closestB: bestB };
    }
    case 'sphere:sphere': {
      const a = shapeWorldParts(shapeA, poseA);
      const b = shapeWorldParts(shapeB, poseB);
      return distanceSphereSphere(a.center, a.radius, b.center, b.radius);
    }
    case 'sphere:triangle': {
      const a = shapeWorldParts(shapeA, poseA);
      const t = shapeWorldParts(shapeB, poseB).vertices;
      const r = distanceSphereTriangle(a.center, a.radius, t[0], t[1], t[2]);
      return { dist: r.dist, closestA: r.closest, closestB: r.closest };
    }
    case 'triangle:triangle': {
      const a = shapeWorldParts(shapeA, poseA).vertices;
      const b = shapeWorldParts(shapeB, poseB).vertices;
      return distanceTriangleTriangle(a, b);
    }
    default:
      throw new Error('assembly_motion_collision: unsupported pair "' + key + '"');
  }
}

// ---------------------------------------------------------------------------
// Swept collision (CCD)
// ---------------------------------------------------------------------------

function sweptResult(hit, timeOfContact, clearance, tAtMin, contactDistance) {
  return { hit, timeOfContact, clearance, tAtMin, contactDistance };
}

/**
 * Exact swept sphere-sphere: solves the quadratic contact equation
 * |Δp0 + t·Δv| = r1 + r2 for the earliest t in (0, 1], and computes the
 * exact minimum separation over the move.
 */
function sweptSphereSphere(shapeA, motionA, shapeB, motionB, tolerance) {
  const c10 = poseAt(motionA, 0).position;
  const c11 = poseAt(motionA, 1).position;
  const c20 = poseAt(motionB, 0).position;
  const c21 = poseAt(motionB, 1).position;
  const v1 = vecSub(c11, c10);
  const v2 = vecSub(c21, c20);
  const dv = vecSub(v1, v2);
  const dp0 = vecSub(c10, c20);
  const a = vecDot(dv, dv);
  const b = 2 * vecDot(dp0, dv);
  const c = vecDot(dp0, dp0);
  const R = shapeA.radius + shapeB.radius;

  const separation = (t) => Math.sqrt(Math.max(0, a * t * t + b * t + c)) - R;

  const s0 = separation(0);
  if (s0 <= tolerance) {
    return sweptResult(true, 0, Math.min(s0, 0), 0, s0);
  }

  let s1 = separation(1);

  let tHit = null;
  if (a > EPS) {
    const disc = b * b - 4 * a * (c - R * R);
    if (disc >= 0) {
      const sq = Math.sqrt(Math.max(0, disc));
      const t1 = (-b - sq) / (2 * a);
      const t2 = (-b + sq) / (2 * a);
      for (const t of [t1, t2]) {
        if (t > 0 && t <= 1 + tolerance && (tHit === null || t < tHit)) {
          tHit = t;
        }
      }
    }
  } else if (Math.abs(b) > EPS) {
    const t = -(c - R * R) / b;
    if (t > 0 && t <= 1 + tolerance) tHit = t;
  }

  let clearance;
  let tAtMin;
  if (a > EPS) {
    const tv = -b / (2 * a);
    if (tv > 0 && tv < 1) {
      const sv = separation(tv);
      if (sv <= s0 && sv <= s1) {
        clearance = sv;
        tAtMin = tv;
      } else if (s0 <= s1) {
        clearance = s0;
        tAtMin = 0;
      } else {
        clearance = s1;
        tAtMin = 1;
      }
    } else if (s0 <= s1) {
      clearance = s0;
      tAtMin = 0;
    } else {
      clearance = s1;
      tAtMin = 1;
    }
  } else {
    clearance = Math.min(s0, s1);
    tAtMin = s0 <= s1 ? 0 : 1;
  }

  if (tHit !== null) {
    return sweptResult(true, tHit, clearance, tAtMin, separation(tHit));
  }
  return sweptResult(false, null, clearance, tAtMin, null);
}

/**
 * Conservative advancement for general convex primitive pairs.
 *
 * At each iteration the current minimum separation d(t) is computed; the
 * time is advanced by α·d / v_max where v_max is a global upper bound on the
 * relative speed of the two bodies. Because the step can never cover more
 * than α·d of the gap, the method never tunnels through a surface and
 * converges monotonically; it stops at the first t where d ≤ tolerance.
 */
function conservativeAdvancement(shapeA, motionA, shapeB, motionB, options) {
  const opts = Object.assign(
    { tolerance: 1e-9, conservativeFactor: 0.85, maxIterations: 500, minSamples: 65 },
    options
  );
  const vA = motionSpeedBound(shapeA, motionA);
  const vB = motionSpeedBound(shapeB, motionB);
  const vMax = vA + vB;

  const distAt = (t) => shapeDistance(shapeA, poseAt(motionA, t), shapeB, poseAt(motionB, t)).dist;

  let t = 0;
  let d = distAt(0);
  let best = { dist: d, t: 0 };

  const isHit = (dist) => dist <= opts.tolerance;

  if (isHit(d)) {
    return sweptResult(true, 0, Math.min(d, 0), 0, d);
  }

  if (vMax <= 0) {
    return sweptResult(false, null, d, 0, null);
  }

  for (let i = 0; i < opts.maxIterations; i++) {
    const step = (opts.conservativeFactor * d) / vMax;
    if (t + step >= 1) {
      t = 1;
      break;
    }
    t += step;
    d = distAt(t);
    if (d < best.dist) best = { dist: d, t };
    if (isHit(d)) {
      return sweptResult(true, t, Math.min(d, 0), best.t, d);
    }
  }

  d = distAt(1);
  if (d < best.dist) best = { dist: d, t: 1 };
  if (isHit(d)) {
    return sweptResult(true, 1, Math.min(d, 0), best.t, d);
  }

  const clearance = estimateMinClearance(shapeA, motionA, shapeB, motionB, best, opts);
  return sweptResult(false, null, clearance.dist, clearance.t, null);
}

/**
 * Minimum clearance over the move via dense deterministic sampling plus a
 * golden-section refinement around the best sample (assumes local unimodality).
 */
function estimateMinClearance(shapeA, motionA, shapeB, motionB, best, opts) {
  const n = Math.max(8, opts.minSamples);
  let bestDist = best.dist;
  let bestT = best.t;
  const f = (t) => shapeDistance(shapeA, poseAt(motionA, t), shapeB, poseAt(motionB, t)).dist;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const d = f(t);
    if (d < bestDist) {
      bestDist = d;
      bestT = t;
    }
  }
  const lo = Math.max(0, bestT - 1 / n);
  const hi = Math.min(1, bestT + 1 / n);
  const gr = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - gr * (hi - lo);
  let x2 = lo + gr * (hi - lo);
  let f1 = f(x1);
  let f2 = f(x2);
  for (let i = 0; i < 60; i++) {
    if (f1 < f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - gr * (hi - lo);
      f1 = f(x1);
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + gr * (hi - lo);
      f2 = f(x2);
    }
  }
  const tf = f1 < f2 ? x1 : x2;
  const df = f(tf);
  return df < bestDist ? { dist: df, t: tf } : { dist: bestDist, t: bestT };
}

/**
 * Swept collision detection between two convex primitives over a motion step.
 *
 * Bodies: sphere, capsule (cylinder approximation), box, triangle. Each is
 * { type, ... } with geometry in local coordinates; motions are
 * { start: pose, end: pose } (null = static at identity).
 *
 * Returns { hit, timeOfContact, clearance, tAtMin, contactDistance }:
 *   - hit: true if the shapes contact (distance ≤ tolerance) within [0, 1]
 *   - timeOfContact: first contact time (in [0, 1]) or null
 *   - clearance: minimum signed surface-to-surface distance over the move
 *     (negative in the overlapping regime)
 *   - tAtMin: time at which the minimum clearance occurs
 */
function sweptCollide(shapeA, motionA, shapeB, motionB, options) {
  const opts = Object.assign({ tolerance: 1e-9 }, options);
  if (shapeA.type === 'sphere' && shapeB.type === 'sphere') {
    return sweptSphereSphere(shapeA, motionA, shapeB, motionB, opts.tolerance);
  }
  return conservativeAdvancement(shapeA, motionA, shapeB, motionB, opts);
}

// ---------------------------------------------------------------------------
// Mesh BVH
// ---------------------------------------------------------------------------

function boxFromTriangles(triangles, indices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const i of indices) {
    for (const v of triangles[i]) {
      for (let k = 0; k < 3; k++) {
        if (v[k] < min[k]) min[k] = v[k];
        if (v[k] > max[k]) max[k] = v[k];
      }
    }
  }
  return { min, max };
}

function boxOverlap(a, b) {
  return (
    a.min[0] <= b.max[0] &&
    b.min[0] <= a.max[0] &&
    a.min[1] <= b.max[1] &&
    b.min[1] <= a.max[1] &&
    a.min[2] <= b.max[2] &&
    b.min[2] <= a.max[2]
  );
}

function boxDistance(a, b) {
  const dx = Math.max(0, Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0]));
  const dy = Math.max(0, Math.max(a.min[1] - b.max[1], b.min[1] - a.max[1]));
  const dz = Math.max(0, Math.max(a.min[2] - b.max[2], b.min[2] - a.max[2]));
  return Math.hypot(dx, dy, dz);
}

class MeshBVH {
  constructor(mesh) {
    this.triangles = mesh.triangles;
    this.root = this.buildNode(
      this.triangles,
      Array.from({ length: this.triangles.length }, (_, i) => i)
    );
  }

  buildNode(triangles, indices) {
    const box = boxFromTriangles(triangles, indices);
    if (indices.length <= 4) {
      return { box, left: null, right: null, indices };
    }
    const ext = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
    let axis = 0;
    if (ext[1] > ext[axis]) axis = 1;
    if (ext[2] > ext[axis]) axis = 2;
    const mid = 0.5 * (box.min[axis] + box.max[axis]);
    const leftIndices = [];
    const rightIndices = [];
    for (const i of indices) {
      const c = (triangles[i][0][axis] + triangles[i][1][axis] + triangles[i][2][axis]) / 3;
      if (c <= mid) leftIndices.push(i);
      else rightIndices.push(i);
    }
    if (leftIndices.length === 0 || rightIndices.length === 0) {
      const half = Math.floor(indices.length / 2);
      const sorted = indices.slice().sort((p, q) => {
        const cp = (triangles[p][0][axis] + triangles[p][1][axis] + triangles[p][2][axis]) / 3;
        const cq = (triangles[q][0][axis] + triangles[q][1][axis] + triangles[q][2][axis]) / 3;
        return cp - cq;
      });
      return {
        box,
        left: this.buildNode(triangles, sorted.slice(0, half)),
        right: this.buildNode(triangles, sorted.slice(half)),
        indices: null
      };
    }
    return {
      box,
      left: this.buildNode(triangles, leftIndices),
      right: this.buildNode(triangles, rightIndices),
      indices: null
    };
  }
}

function asMesh(x) {
  return x instanceof MeshBVH ? x : new MeshBVH(x);
}

/**
 * Minimum distance between two triangle meshes using BVH pruning. Exhaustive
 * leaf-leaf pairs are evaluated with the exact triangle-triangle distance.
 * Returns { dist, closestA, closestB }.
 */
function meshMinDistance(meshA, meshB) {
  const a = asMesh(meshA);
  const b = asMesh(meshB);
  let best = Infinity;
  let bestA = null;
  let bestB = null;
  const visit = (nodeA, nodeB) => {
    if (nodeA === null || nodeB === null) return;
    if (boxDistance(nodeA.box, nodeB.box) >= best) return;
    if (nodeA.indices !== null && nodeB.indices !== null) {
      for (const ia of nodeA.indices) {
        for (const ib of nodeB.indices) {
          const r = distanceTriangleTriangle(a.triangles[ia], b.triangles[ib]);
          if (r.dist < best) {
            best = r.dist;
            bestA = r.closestA;
            bestB = r.closestB;
          }
        }
      }
      return;
    }
    if (nodeA.indices !== null) {
      visit(nodeA, nodeB.left);
      visit(nodeA, nodeB.right);
    } else if (nodeB.indices !== null) {
      visit(nodeA.left, nodeB);
      visit(nodeA.right, nodeB);
    } else {
      visit(nodeA.left, nodeB.left);
      visit(nodeA.left, nodeB.right);
      visit(nodeA.right, nodeB.left);
      visit(nodeA.right, nodeB.right);
    }
  };
  visit(a.root, b.root);
  return { dist: best, closestA: bestA, closestB: bestB };
}

/**
 * Broad phase: candidate triangle index pairs whose AABBs overlap, found by
 * simultaneous BVH traversal. Returns an array of [iA, iB].
 */
function broadPhaseCandidatePairs(meshA, meshB) {
  const a = asMesh(meshA);
  const b = asMesh(meshB);
  const pairs = [];
  const visit = (nodeA, nodeB) => {
    if (nodeA === null || nodeB === null) return;
    if (!boxOverlap(nodeA.box, nodeB.box)) return;
    if (nodeA.indices !== null && nodeB.indices !== null) {
      for (const ia of nodeA.indices) {
        for (const ib of nodeB.indices) {
          pairs.push([ia, ib]);
        }
      }
      return;
    }
    if (nodeA.indices !== null) {
      visit(nodeA, nodeB.left);
      visit(nodeA, nodeB.right);
    } else if (nodeB.indices !== null) {
      visit(nodeA.left, nodeB);
      visit(nodeA.right, nodeB);
    } else {
      visit(nodeA.left, nodeB.left);
      visit(nodeA.left, nodeB.right);
      visit(nodeA.right, nodeB.left);
      visit(nodeA.right, nodeB.right);
    }
  };
  visit(a.root, b.root);
  return pairs;
}

function projectTriangle(axis, tri) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of tri) {
    const d = vecDot(axis, v);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

function triangleNormal(tri) {
  return vecCross(vecSub(tri[1], tri[0]), vecSub(tri[2], tri[0]));
}

/**
 * Exact triangle-triangle intersection (interval overlap on the 11 SAT axes:
 * the two face normals and the nine edge-cross products).
 */
function trianglesIntersect(tA, tB) {
  const boxA = boxFromTriangles([tA], [0]);
  const boxB = boxFromTriangles([tB], [0]);
  if (!boxOverlap(boxA, boxB)) return false;

  const nA = triangleNormal(tA);
  const nB = triangleNormal(tB);
  const axes = [nA, nB];
  for (let i = 0; i < 3; i++) {
    const ea = vecSub(tA[(i + 1) % 3], tA[i]);
    for (let j = 0; j < 3; j++) {
      const eb = vecSub(tB[(j + 1) % 3], tB[j]);
      axes.push(vecCross(ea, eb));
    }
  }
  for (const ax of axes) {
    const l = vecLen(ax);
    if (l < EPS) continue;
    const u = vecScale(ax, 1 / l);
    const pa = projectTriangle(u, tA);
    const pb = projectTriangle(u, tB);
    if (pa[1] < pb[0] - EPS || pb[1] < pa[0] - EPS) return false;
  }
  return true;
}

/**
 * Static collision between two assembled meshes: BVH broad-phase + exact
 * triangle-triangle narrow-phase.
 */
function meshesCollide(meshA, meshB) {
  const a = asMesh(meshA);
  const b = asMesh(meshB);
  for (const [ia, ib] of broadPhaseCandidatePairs(a, b)) {
    if (trianglesIntersect(a.triangles[ia], b.triangles[ib])) return true;
  }
  return false;
}

function poseTriangles(mesh, pose) {
  return { triangles: mesh.triangles.map((t) => t.map((v) => applyPose(v, pose))) };
}

function sweptMeshBox(mesh, motion) {
  const b0 = boxFromTriangles(
    mesh.triangles,
    mesh.triangles.map((_, i) => i)
  );
  const p0 = poseAt(motion, 0);
  const p1 = poseAt(motion, 1);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const corners = [
    [b0.min[0], b0.min[1], b0.min[2]],
    [b0.min[0], b0.min[1], b0.max[2]],
    [b0.min[0], b0.max[1], b0.min[2]],
    [b0.min[0], b0.max[1], b0.max[2]],
    [b0.max[0], b0.min[1], b0.min[2]],
    [b0.max[0], b0.min[1], b0.max[2]],
    [b0.max[0], b0.max[1], b0.min[2]],
    [b0.max[0], b0.max[1], b0.max[2]]
  ];
  for (const pose of [p0, p1]) {
    for (const c of corners) {
      const w = applyPose(c, pose);
      for (let k = 0; k < 3; k++) {
        if (w[k] < min[k]) min[k] = w[k];
        if (w[k] > max[k]) max[k] = w[k];
      }
    }
  }
  return { min, max };
}

/**
 * Swept mesh-mesh collision.
 *
 * NOTE: this is an approximate discrete sweep (sampled narrow-phase with
 * bisection refinement), not a certified CCD for triangle soups. It is
 * conservative only up to the sampling resolution. The static mesh
 * collision path (meshesCollide) is exact.
 */
function sweptMeshesCollide(meshA, motionA, meshB, motionB, options) {
  const opts = Object.assign({ samples: 8, refine: 32 }, options);
  const boxA = sweptMeshBox(meshA, motionA);
  const boxB = sweptMeshBox(meshB, motionB);
  if (!boxOverlap(boxA, boxB)) {
    return { collides: false, timeOfContact: null };
  }
  const collideAt = (t) => {
    const pA = poseAt(motionA, t);
    const pB = poseAt(motionB, t);
    return meshesCollide(poseTriangles(meshA, pA), poseTriangles(meshB, pB));
  };
  if (collideAt(0)) {
    return { collides: true, timeOfContact: 0 };
  }
  let tPrev = 0;
  for (let k = 1; k <= opts.samples; k++) {
    const t = k / opts.samples;
    if (collideAt(t)) {
      let lo = tPrev;
      let hi = t;
      for (let i = 0; i < opts.refine; i++) {
        const mid = 0.5 * (lo + hi);
        if (collideAt(mid)) hi = mid;
        else lo = mid;
      }
      return { collides: true, timeOfContact: hi };
    }
    tPrev = t;
  }
  return { collides: false, timeOfContact: null };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  EPS,
  vecAdd,
  vecSub,
  vecScale,
  vecDot,
  vecCross,
  vecLen,
  vecNorm,
  clamp,
  quat,
  applyPose,
  poseAt,
  distancePointTriangle,
  distancePointSegment,
  distanceSegmentSegment,
  distanceSphereSphere,
  distanceSphereTriangle,
  distanceTriangleTriangle,
  distancePointOBB,
  distanceSegmentOBB,
  distanceBoxBox,
  shapeDistance,
  shapeBoundingRadius,
  sweptCollide,
  sweptSphereSphere,
  MeshBVH,
  meshMinDistance,
  broadPhaseCandidatePairs,
  trianglesIntersect,
  meshesCollide,
  sweptMeshesCollide
};
