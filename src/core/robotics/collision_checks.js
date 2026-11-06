'use strict';

/**
 * Robotic collision checking for OmniEng.
 *
 * Implemented algorithms:
 *   1. Mesh-mesh collision via axis-aligned bounding box (AABB) broad phase
 *      followed by a robust triangle-triangle narrow phase. The narrow phase
 *      is a Möller-style interval test on the intersection line of the two
 *      supporting planes, with an explicit coplanar branch (2D overlap via
 *      segment/point containment) and floating-point tolerant epsilons that
 *      scale with the magnitude of the input coordinates.
 *   2. Swept / sphere-link approximation for the robot-scene API: each link
 *      is modelled as a capsule (sphere-swept segment) between consecutive
 *      joint frames from production forward kinematics; continuous motion
 *      between samples is conservatively bounded by connection capsules
 *      between the endpoints of consecutive poses.
 *   3. checkRobotPath(robot, qStart, qEnd, obstacles, opts): samples joint
 *      space interpolation, computes link poses via the production FK
 *      (SerialManipulatorEngine.forwardKinematics), and returns the first
 *      colliding configuration/contact or null when the path is clear.
 *
 * Degenerate case handling (documented):
 *   - Zero-area (collinear / coincident vertex) triangles are never reported
 *     as intersecting; they are skipped by the narrow phase. The geometry
 *     threshold is ~1e-12 * scale^2 where scale is the largest coordinate
 *     magnitude involved (so the rule holds across unit systems).
 *   - Coplanar triangles are resolved exactly in 2D (edge crossings and
 *     vertex containment). Sharing an edge or a vertex counts as contact.
 *   - Near-coplanar / numerically marginal cases fall back to the coplanar
 *     branch once the intersection-line direction is below a scale-aware
 *     epsilon; interval comparisons use a tiny positive tolerance so exact
 *     touching triangles are not missed.
 */

const { SerialManipulatorEngine } = require('./serial_manipulator_kinematics');

// ============================================================================
// Minimal array-vector helpers ([x, y, z])
// ============================================================================

function v3Sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function v3Add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function v3Scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function v3Dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function v3Cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function v3Norm(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function v3NormSq(a) {
  return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
}

function v3Mid(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function v3Clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// ============================================================================
// Input normalization: triangles, obstacle meshes, AABBs
// ============================================================================

/**
 * Accepts [x,y,z], {x,y,z}, or a Vector3-like object.
 */
function toVec3(v) {
  if (v == null) {
    throw new Error('collision: invalid null vector component');
  }
  if (Array.isArray(v)) {
    if (v.length !== 3) throw new Error(`collision: vector must have 3 components, got ${v.length}`);
    return [Number(v[0]), Number(v[1]), Number(v[2])];
  }
  if (typeof v === 'object') {
    const x = Number(v.x !== undefined ? v.x : v[0]);
    const y = Number(v.y !== undefined ? v.y : v[1]);
    const z = Number(v.z !== undefined ? v.z : v[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error('collision: vector components must be finite numbers');
    }
    return [x, y, z];
  }
  throw new Error('collision: vector must be an array or {x,y,z} object');
}

/**
 * Normalizes one triangle spec.
 * Supports [p0,p1,p2] or {a,b,c} with either array or Vector3 vertices.
 * Returns null for invalid/degenerate-all-zero triangles (caller decides);
 * throws for structurally invalid specs.
 */
function normalizeTriangle(t) {
  let pts;
  if (Array.isArray(t) && t.length === 3) {
    pts = t.map(toVec3);
  } else if (t && typeof t === 'object' && t.a && t.b && t.c) {
    pts = [toVec3(t.a), toVec3(t.b), toVec3(t.c)];
  } else {
    throw new Error('collision: triangle must be [p0,p1,p2] or {a,b,c}');
  }
  for (const p of pts) {
    if (!p.every((v) => Number.isFinite(v))) {
      throw new Error('collision: triangle vertices must be finite');
    }
  }
  if (v3NormSq(v3Sub(pts[1], pts[0])) === 0 && v3NormSq(v3Sub(pts[2], pts[0])) === 0) {
    return null;
  }
  return pts;
}

/**
 * Extracts a normalized triangle list from an obstacle specification:
 *   - { triangles: [...] }
 *   - { mesh: { triangles: [...] } }
 *   - SolidBody (ducks as { toTriangles() } returning {a,b,c,normal})
 *   - { solid: SolidBody }
 */
function extractTriangles(obstacle) {
  if (!obstacle || typeof obstacle !== 'object') {
    throw new Error('collision: obstacle must be an object');
  }
  let src = null;
  if (Array.isArray(obstacle.triangles)) {
    src = obstacle.triangles;
  } else if (obstacle.mesh && Array.isArray(obstacle.mesh.triangles)) {
    src = obstacle.mesh.triangles;
  } else if (typeof obstacle.toTriangles === 'function') {
    src = obstacle.toTriangles();
  } else if (obstacle.solid && typeof obstacle.solid.toTriangles === 'function') {
    src = obstacle.solid.toTriangles();
  }
  if (!Array.isArray(src)) {
    throw new Error('collision: obstacle must expose triangles, mesh.triangles, or a SolidBody');
  }
  const tris = [];
  for (const t of src) {
    const nt = normalizeTriangle(t);
    if (nt) tris.push(nt);
  }
  return tris;
}

function computeTrianglesAABB(tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const tri of tris) {
    for (const p of tri) {
      for (let i = 0; i < 3; i++) {
        if (p[i] < min[i]) min[i] = p[i];
        if (p[i] > max[i]) max[i] = p[i];
      }
    }
  }
  return { min, max };
}

function aabbOverlap(a, b, eps = 1e-9) {
  for (let i = 0; i < 3; i++) {
    if (a.min[i] > b.max[i] + eps || b.min[i] > a.max[i] + eps) return false;
  }
  return true;
}

// ============================================================================
// Triangle-triangle intersection: Möller-style interval test + coplanar 2D
// ============================================================================

function _geomScale(coords) {
  let s = 0;
  for (const v of coords) {
    const a = Math.abs(v);
    if (a > s) s = a;
  }
  return Math.max(1, s);
}

function _orient2D(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * 2D segment intersection returning the parameter t along the first segment,
 * or null when the segments do not meet (including collinear non-overlap).
 */
function _segmentIntersectParam2D(ax, ay, bx, by, cx, cy, dx, dy, eps) {
  const o1 = _orient2D(ax, ay, bx, by, cx, cy);
  const o2 = _orient2D(ax, ay, bx, by, dx, dy);
  const o3 = _orient2D(cx, cy, dx, dy, ax, ay);
  const o4 = _orient2D(cx, cy, dx, dy, bx, by);
  const sepX = (o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps);
  const sepY = (o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps);
  if (sepX && sepY) {
    const dAx = bx - ax;
    const dAy = by - ay;
    const dBx = dx - cx;
    const dBy = dy - cy;
    const denom = dAx * dBy - dAy * dBx;
    if (Math.abs(denom) <= 1e-300) return null;
    return ((cx - ax) * dBy - (cy - ay) * dBx) / denom;
  }
  const colin = Math.abs(o1) <= eps && Math.abs(o2) <= eps && Math.abs(o3) <= eps && Math.abs(o4) <= eps;
  if (colin) {
    const loX = Math.max(Math.min(ax, bx), Math.min(cx, dx));
    const hiX = Math.min(Math.max(ax, bx), Math.max(cx, dx));
    const loY = Math.max(Math.min(ay, by), Math.min(cy, dy));
    const hiY = Math.min(Math.max(ay, by), Math.max(cy, dy));
    if (loX > hiX + eps || loY > hiY + eps) return null;
    const spanX = Math.abs(bx - ax);
    const spanY = Math.abs(by - ay);
    if (spanX >= spanY) {
      const midX = (loX + hiX) / 2;
      return spanX <= eps ? 0 : (midX - ax) / (bx - ax);
    }
    const midY = (loY + hiY) / 2;
    return spanY <= eps ? 0 : (midY - ay) / (by - ay);
  }
  return null;
}

/**
 * Coplanar triangle overlap with a true 3D contact point.
 * Vertex containment uses 3D barycentric tests; edge crossings project to the
 * dominant 2D plane only for the intersection parameter, then interpolate the
 * full 3D edge so the returned point lies inside the overlap region.
 */
function _triOverlap2DPoint(p1, q1, r1, p2, q2, r2, k, eps) {
  const tri1 = [p1, q1, r1];
  const tri2 = [p2, q2, r2];
  for (const v of tri1) {
    if (pointInTriangleBarycentric(v, p2, q2, r2, eps)) return { hit: true, point: v };
  }
  for (const v of tri2) {
    if (pointInTriangleBarycentric(v, p1, q1, r1, eps)) return { hit: true, point: v };
  }
  const pr = (p) => [p[(k + 1) % 3], p[(k + 2) % 3]];
  const edges1 = [
    [p1, q1],
    [q1, r1],
    [r1, p1]
  ];
  const edges2 = [
    [p2, q2],
    [q2, r2],
    [r2, p2]
  ];
  for (const e1 of edges1) {
    for (const e2 of edges2) {
      const a = pr(e1[0]);
      const b = pr(e1[1]);
      const c = pr(e2[0]);
      const d = pr(e2[1]);
      const t = _segmentIntersectParam2D(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1], eps);
      if (t !== null && t >= -eps && t <= 1 + eps) {
        const tc = v3Clamp(t, 0, 1);
        return { hit: true, point: v3Add(e1[0], v3Scale(v3Sub(e1[1], e1[0]), tc)) };
      }
    }
  }
  return { hit: false, point: null };
}

/**
 * Robust triangle-triangle intersection.
 * @returns {{collided:boolean, degenerate?:boolean, coplanar?:boolean, parallel?:boolean, point?:number[], segment?:number[][]}}
 */
function trianglesIntersect(p1, q1, r1, p2, q2, r2, opts = {}) {
  const coords = [...p1, ...q1, ...r1, ...p2, ...q2, ...r2];
  for (const v of coords) {
    if (!Number.isFinite(v)) {
      throw new Error('collision: triangle vertices must be finite numbers');
    }
  }
  const scale = _geomScale(coords);
  const areaEps = 1e-12 * scale * scale;

  const n1 = v3Cross(v3Sub(q1, p1), v3Sub(r1, p1));
  const n2 = v3Cross(v3Sub(q2, p2), v3Sub(r2, p2));
  const area1 = 0.5 * v3Norm(n1);
  const area2 = 0.5 * v3Norm(n2);

  if (area1 <= areaEps || area2 <= areaEps) {
    return { collided: false, degenerate: true, reason: 'zero-area' };
  }

  const planeEps = 1e-12 * scale * scale * scale;
  const d2 = [v3Dot(n2, v3Sub(p1, p2)), v3Dot(n2, v3Sub(q1, p2)), v3Dot(n2, v3Sub(r1, p2))];
  if (
    (d2[0] > planeEps && d2[1] > planeEps && d2[2] > planeEps) ||
    (d2[0] < -planeEps && d2[1] < -planeEps && d2[2] < -planeEps)
  ) {
    return { collided: false };
  }
  const d1 = [v3Dot(n1, v3Sub(p2, p1)), v3Dot(n1, v3Sub(q2, p1)), v3Dot(n1, v3Sub(r2, p1))];
  if (
    (d1[0] > planeEps && d1[1] > planeEps && d1[2] > planeEps) ||
    (d1[0] < -planeEps && d1[1] < -planeEps && d1[2] < -planeEps)
  ) {
    return { collided: false };
  }

  const D = v3Cross(n1, n2);
  const lenD = v3Norm(D);
  const dEps = 1e-12 * scale * scale * scale * scale;

  if (lenD <= dEps) {
    const coplanarEps = planeEps * 8;
    const maxD1 = Math.max(Math.abs(d1[0]), Math.abs(d1[1]), Math.abs(d1[2]));
    const maxD2 = Math.max(Math.abs(d2[0]), Math.abs(d2[1]), Math.abs(d2[2]));
    if (maxD1 > coplanarEps || maxD2 > coplanarEps) {
      return { collided: false, parallel: true };
    }
    const k =
      Math.abs(n1[0]) >= Math.abs(n1[1]) && Math.abs(n1[0]) >= Math.abs(n1[2])
        ? 0
        : Math.abs(n1[1]) >= Math.abs(n1[2])
          ? 1
          : 2;
    const e2d = 1e-12 * scale;
    const ov = _triOverlap2DPoint(p1, q1, r1, p2, q2, r2, k, e2d);
    if (!ov.hit) return { collided: false, coplanar: true };
    return { collided: true, coplanar: true, point: ov.point };
  }

  const Dh = v3Scale(D, 1 / lenD);
  const c1 = v3Dot(n1, p1);
  const c2 = v3Dot(n2, p2);
  const O = v3Scale(v3Add(v3Scale(v3Cross(n2, Dh), c1), v3Scale(v3Cross(Dh, n1), c2)), 1 / lenD);

  const ts1 = [v3Dot(p1, Dh), v3Dot(q1, Dh), v3Dot(r1, Dh)].sort((a, b) => a - b);
  const ts2 = [v3Dot(p2, Dh), v3Dot(q2, Dh), v3Dot(r2, Dh)].sort((a, b) => a - b);
  const lo = Math.max(ts1[0], ts2[0]);
  const hi = Math.min(ts1[2], ts2[2]);
  const tEps = 1e-12 * scale * (1 + lenD);

  if (lo > hi + tEps) {
    return { collided: false };
  }
  const segStart = v3Add(O, v3Scale(Dh, lo));
  const segEnd = v3Add(O, v3Scale(Dh, hi));
  return {
    collided: true,
    segment: [segStart, segEnd],
    point: v3Mid(segStart, segEnd)
  };
}

// ============================================================================
// Point / segment distance to triangle (closest-point primitives)
// ============================================================================

function closestPointOnTriangle(p, a, b, c) {
  const ab = v3Sub(b, a);
  const ac = v3Sub(c, a);
  const ap = v3Sub(p, a);
  const d1 = v3Dot(ab, ap);
  const d2 = v3Dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { point: a, sqDist: v3NormSq(v3Sub(p, a)) };
  const bp = v3Sub(p, b);
  const d3 = v3Dot(ab, bp);
  const d4 = v3Dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { point: b, sqDist: v3NormSq(v3Sub(p, b)) };
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const q = v3Add(a, v3Scale(ab, v));
    return { point: q, sqDist: v3NormSq(v3Sub(p, q)) };
  }
  const cp = v3Sub(p, c);
  const d5 = v3Dot(ab, cp);
  const d6 = v3Dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { point: c, sqDist: v3NormSq(v3Sub(p, c)) };
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const q = v3Add(a, v3Scale(ac, w));
    return { point: q, sqDist: v3NormSq(v3Sub(p, q)) };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    const q = v3Add(b, v3Scale(v3Sub(c, b), w));
    return { point: q, sqDist: v3NormSq(v3Sub(p, q)) };
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const q = v3Add(a, v3Add(v3Scale(ab, v), v3Scale(ac, w)));
  return { point: q, sqDist: v3NormSq(v3Sub(p, q)) };
}

function pointTriangleDistanceSq(p, tri) {
  const r = closestPointOnTriangle(p, tri[0], tri[1], tri[2]);
  return { sqDist: r.sqDist, point: r.point };
}

function pointInTriangleBarycentric(p, a, b, c, eps = 1e-9) {
  const v0 = v3Sub(c, a);
  const v1 = v3Sub(b, a);
  const v2 = v3Sub(p, a);
  const dot00 = v3Dot(v0, v0);
  const dot01 = v3Dot(v0, v1);
  const dot02 = v3Dot(v0, v2);
  const dot11 = v3Dot(v1, v1);
  const dot12 = v3Dot(v1, v2);
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-300) return false;
  const invDenom = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= -eps && v >= -eps && u + v <= 1 + eps;
}

function segmentSegmentDistanceSq(p1, p2, q1, q2) {
  const d1 = v3Sub(p2, p1);
  const d2 = v3Sub(q2, q1);
  const r = v3Sub(p1, q1);
  const a = v3Dot(d1, d1);
  const e = v3Dot(d2, d2);
  const f = v3Dot(d2, r);
  const tiny = 1e-300;
  let s = 0;
  let t = 0;
  if (a <= tiny && e <= tiny) {
    return { sqDist: v3NormSq(r), point: p1, point2: q1 };
  }
  if (a <= tiny) {
    s = 0;
    t = v3Clamp(f / e, 0, 1);
  } else {
    const c = v3Dot(d1, r);
    if (e <= tiny) {
      t = 0;
      s = v3Clamp(-c / a, 0, 1);
    } else {
      const b = v3Dot(d1, d2);
      const denom = a * e - b * b;
      s = Math.abs(denom) > tiny ? v3Clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = v3Clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = v3Clamp((b - c) / a, 0, 1);
      }
    }
  }
  const c1 = v3Add(p1, v3Scale(d1, s));
  const c2 = v3Add(q1, v3Scale(d2, t));
  return { sqDist: v3NormSq(v3Sub(c1, c2)), point: c1, point2: c2 };
}

/**
 * Distance between segment [P,Q] and triangle tri.
 * Exact convex distance: interior intersection (0) or min over the three edges
 * plus both segment endpoints. Returns a contact point on the triangle.
 */
function segmentTriangleDistanceSq(P, Q, tri) {
  const a = tri[0],
    b = tri[1],
    c = tri[2];
  const n = v3Cross(v3Sub(b, a), v3Sub(c, a));
  const dP = v3Dot(n, v3Sub(P, a));
  const dQ = v3Dot(n, v3Sub(Q, a));
  if (dP * dQ <= 0) {
    const denom = dP - dQ;
    if (Math.abs(denom) > 1e-300) {
      const s = dP / denom;
      if (s >= 0 && s <= 1) {
        const X = v3Add(P, v3Scale(v3Sub(Q, P), s));
        if (pointInTriangleBarycentric(X, a, b, c)) {
          return { sqDist: 0, point: X };
        }
      }
    }
  }
  let best = { sqDist: Infinity, point: a };
  const edges = [
    [a, b],
    [b, c],
    [c, a]
  ];
  for (const edge of edges) {
    const r = segmentSegmentDistanceSq(P, Q, edge[0], edge[1]);
    if (r.sqDist < best.sqDist) {
      best = { sqDist: r.sqDist, point: r.point2 };
    }
  }
  const cP = closestPointOnTriangle(P, a, b, c);
  if (cP.sqDist < best.sqDist) best = { sqDist: cP.sqDist, point: cP.point };
  const cQ = closestPointOnTriangle(Q, a, b, c);
  if (cQ.sqDist < best.sqDist) best = { sqDist: cQ.sqDist, point: cQ.point };
  return best;
}

// ============================================================================
// Mesh-mesh collision API
// ============================================================================

function _normalizeMesh(mesh) {
  let tris = [];
  if (Array.isArray(mesh)) {
    tris = mesh;
  } else if (mesh && typeof mesh === 'object' && Array.isArray(mesh.triangles)) {
    tris = mesh.triangles;
  } else if (mesh && typeof mesh.toTriangles === 'function') {
    tris = mesh.toTriangles();
  } else if (mesh && mesh.solid && typeof mesh.solid.toTriangles === 'function') {
    tris = mesh.solid.toTriangles();
  } else {
    throw new Error('collision: mesh must be a triangle array, {triangles}, or a SolidBody');
  }
  const out = [];
  for (const t of tris) {
    const nt = normalizeTriangle(t);
    if (nt) out.push(nt);
  }
  return out;
}

/**
 * Mesh-mesh collision: AABB broad phase + triangle-triangle narrow phase.
 * @param {*} meshA
 * @param {*} meshB
 * @param {{returnDetails?:boolean}} opts
 */
function meshCollision(meshA, meshB, opts = {}) {
  const trisA = _normalizeMesh(meshA);
  const trisB = _normalizeMesh(meshB);
  if (trisA.length === 0 || trisB.length === 0) {
    const r = { collided: false, reason: 'empty-mesh' };
    return opts.returnDetails ? r : r.collided;
  }
  const bbA = computeTrianglesAABB(trisA);
  const bbB = computeTrianglesAABB(trisB);
  if (!aabbOverlap(bbA, bbB)) {
    const r = { collided: false, phase: 'broadphase' };
    return opts.returnDetails ? r : r.collided;
  }
  const bbListA = trisA.map((t) => computeTrianglesAABB([t]));
  const bbListB = trisB.map((t) => computeTrianglesAABB([t]));
  for (let i = 0; i < trisA.length; i++) {
    for (let j = 0; j < trisB.length; j++) {
      if (!aabbOverlap(bbListA[i], bbListB[j])) continue;
      const hit = trianglesIntersect(trisA[i][0], trisA[i][1], trisA[i][2], trisB[j][0], trisB[j][1], trisB[j][2]);
      if (hit.collided) {
        const r = {
          collided: true,
          phase: 'narrowphase',
          triangleA: i,
          triangleB: j,
          point: hit.point,
          segment: hit.segment,
          coplanar: !!hit.coplanar
        };
        return opts.returnDetails ? r : r.collided;
      }
    }
  }
  const r = { collided: false, phase: 'narrowphase' };
  return opts.returnDetails ? r : r.collided;
}

// ============================================================================
// Link primitive (sphere / capsule) vs obstacle mesh
// ============================================================================

function sphereAABB(sph) {
  const r = sph.radius;
  return {
    min: [sph.center[0] - r, sph.center[1] - r, sph.center[2] - r],
    max: [sph.center[0] + r, sph.center[1] + r, sph.center[2] + r]
  };
}

function capsuleAABB(cap) {
  const r = cap.radius;
  return {
    min: [
      Math.min(cap.start[0], cap.end[0]) - r,
      Math.min(cap.start[1], cap.end[1]) - r,
      Math.min(cap.start[2], cap.end[2]) - r
    ],
    max: [
      Math.max(cap.start[0], cap.end[0]) + r,
      Math.max(cap.start[1], cap.end[1]) + r,
      Math.max(cap.start[2], cap.end[2]) + r
    ]
  };
}

function testPrimitiveVsObstacles(pr, obsList) {
  const prBB = pr.type === 'sphere' ? sphereAABB(pr) : capsuleAABB(pr);
  for (const obs of obsList) {
    if (!aabbOverlap(prBB, obs.aabb)) continue;
    const tris = obs.triangles;
    for (let i = 0; i < tris.length; i++) {
      let probe = null;
      if (pr.type === 'sphere') {
        const r = pointTriangleDistanceSq(pr.center, tris[i]);
        if (r.sqDist <= pr.radius * pr.radius) probe = r.point;
      } else if (pr.type === 'capsule') {
        const r = segmentTriangleDistanceSq(pr.start, pr.end, tris[i]);
        if (r.sqDist <= pr.radius * pr.radius) probe = r.point;
      } else {
        throw new Error(`collision: unsupported link primitive type "${pr.type}"`);
      }
      if (probe) {
        return { hit: true, obstacleIndex: obs.index, triIndex: i, point: probe };
      }
    }
  }
  return { hit: false };
}

// ============================================================================
// Robot-scene path check
// ============================================================================

function transformPoint(F, p) {
  return [
    F[0][0] * p[0] + F[0][1] * p[1] + F[0][2] * p[2] + F[0][3],
    F[1][0] * p[0] + F[1][1] * p[1] + F[1][2] * p[2] + F[1][3],
    F[2][0] * p[0] + F[2][1] * p[1] + F[2][2] * p[2] + F[2][3]
  ];
}

/**
 * Builds world-space link primitives for one FK result.
 * Default: capsule between consecutive joint frames with radius linkRadius.
 * Explicit: opts.linkGeometry[j-1] primitives expressed in link j frame
 * (joint frame j), transformed into world.
 */
function buildLinkPrimitives(fk, n, opts, linkRadius) {
  const prims = [];
  const frames = fk.jointFrames;
  for (let j = 1; j <= n; j++) {
    if (opts.linkGeometry && Array.isArray(opts.linkGeometry[j - 1])) {
      const F = frames[j];
      for (const g of opts.linkGeometry[j - 1]) {
        if (g.type === 'sphere') {
          prims.push({ type: 'sphere', center: transformPoint(F, toVec3(g.center)), radius: Number(g.radius) });
        } else if (g.type === 'capsule') {
          prims.push({
            type: 'capsule',
            start: transformPoint(F, toVec3(g.start)),
            end: transformPoint(F, toVec3(g.end)),
            radius: Number(g.radius)
          });
        } else {
          throw new Error(`collision: unsupported linkGeometry primitive "${g.type}" (sphere/capsule only)`);
        }
      }
    } else {
      const a = transformPoint(frames[j - 1], [0, 0, 0]);
      const b = transformPoint(frames[j], [0, 0, 0]);
      prims.push({ type: 'capsule', start: a, end: b, radius: linkRadius });
    }
  }
  return prims;
}

function linkEndpoint(fk, j, which) {
  const frames = fk.jointFrames;
  const T = which === 0 ? frames[j - 1] : frames[j];
  return [T[0][3], T[1][3], T[2][3]];
}

/**
 * Checks a joint-space interpolation path for collision.
 *
 * @param {*} robot DH table array, preset string, or {dhTable} spec (production FK input)
 * @param {number[]} qStart
 * @param {number[]} qEnd
 * @param {Array} obstacles obstacle specs ({triangles} | {mesh} | SolidBody)
 * @param {object} opts
 *   step: max joint-space arc per sample segment (default 0.05 rad)
 *   numSamples: optional override of sample count (>= 2)
 *   linkRadius: default capsule radius (default 0.04 m)
 *   linkGeometry: optional per-link primitive arrays (sphere/capsule in link frame)
 *   swept: enable conservative swept connection capsules (default true)
 * @returns {object|null} first { config, t, sampleIndex, mode, linkIndex,
 *   obstacleIndex, point } or null when the path is clear.
 */
function checkRobotPath(robot, qStart, qEnd, obstacles, opts = {}) {
  const chain = SerialManipulatorEngine.resolveKinematicChain(robot);
  const dhRows = Array.isArray(chain) ? chain : chain.dhTable;
  const n = dhRows.length;
  if (!Array.isArray(qStart) || qStart.length !== n || qStart.some((v) => !Number.isFinite(v))) {
    throw new Error(`collision: qStart must be an array of ${n} finite joint values`);
  }
  if (!Array.isArray(qEnd) || qEnd.length !== n || qEnd.some((v) => !Number.isFinite(v))) {
    throw new Error(`collision: qEnd must be an array of ${n} finite joint values`);
  }
  if (!Array.isArray(obstacles) || obstacles.length === 0) {
    throw new Error('collision: obstacles must be a non-empty array');
  }

  const step = opts.step !== undefined ? Number(opts.step) : 0.05;
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error('collision: opts.step must be a positive finite number');
  }
  const linkRadius = opts.linkRadius !== undefined ? Number(opts.linkRadius) : 0.04;
  if (!Number.isFinite(linkRadius) || linkRadius < 0) {
    throw new Error('collision: opts.linkRadius must be a finite non-negative number');
  }
  const swept = opts.swept !== false;

  const obsList = obstacles.map((o, i) => {
    const triangles = extractTriangles(o);
    return { index: i, triangles, aabb: computeTrianglesAABB(triangles) };
  });
  if (obsList.some((o) => o.triangles.length === 0)) {
    return null;
  }

  let maxDelta = 0;
  for (let j = 0; j < n; j++) {
    maxDelta = Math.max(maxDelta, Math.abs(qEnd[j] - qStart[j]));
  }
  let numSegments;
  if (opts.numSamples !== undefined) {
    const count = Math.floor(Number(opts.numSamples));
    if (!Number.isFinite(count) || count < 2) {
      throw new Error('collision: opts.numSamples must be an integer >= 2');
    }
    numSegments = count - 1;
  } else {
    numSegments = Math.max(1, Math.ceil(maxDelta / step));
  }

  const fks = [];
  for (let k = 0; k <= numSegments; k++) {
    const s = numSegments === 0 ? 0 : k / numSegments;
    const q = qStart.map((v, j) => v + (qEnd[j] - v) * s);
    const fk = SerialManipulatorEngine.forwardKinematics(dhRows, q);
    fks.push({ q, fk });
  }

  const checkPrimitive = (pr, k, mode, j) => {
    const res = testPrimitiveVsObstacles(pr, obsList);
    if (!res.hit) return null;
    return {
      collided: true,
      config: fks[k].q.slice(),
      t: numSegments === 0 ? 0 : k / numSegments,
      sampleIndex: k,
      mode,
      linkIndex: j,
      obstacleIndex: res.obstacleIndex,
      point: res.point
    };
  };

  for (let k = 0; k <= numSegments; k++) {
    const prims = buildLinkPrimitives(fks[k].fk, n, opts, linkRadius);
    for (let j = 0; j < n; j++) {
      const hit = checkPrimitive(prims[j], k, 'static', j + 1);
      if (hit) return hit;
    }
  }

  if (swept && numSegments > 0) {
    for (let k = 0; k < numSegments; k++) {
      const fka = fks[k].fk;
      const fkb = fks[k + 1].fk;
      for (let j = 1; j <= n; j++) {
        const a0 = linkEndpoint(fka, j, 0);
        const a1 = linkEndpoint(fka, j, 1);
        const b0 = linkEndpoint(fkb, j, 0);
        const b1 = linkEndpoint(fkb, j, 1);
        const connections = [
          [a0, b0],
          [a1, b1],
          [a0, b1],
          [a1, b0]
        ];
        for (const [p, qq] of connections) {
          const pr = { type: 'capsule', start: p, end: qq, radius: linkRadius };
          const hit = checkPrimitive(pr, k, 'swept', j);
          if (hit) return hit;
        }
      }
    }
  }

  return null;
}

// ============================================================================

module.exports = {
  toVec3,
  normalizeTriangle,
  extractTriangles,
  computeTrianglesAABB,
  aabbOverlap,
  trianglesIntersect,
  closestPointOnTriangle,
  pointTriangleDistanceSq,
  segmentTriangleDistanceSq,
  meshCollision,
  buildLinkPrimitives,
  testPrimitiveVsObstacles,
  checkRobotPath
};
