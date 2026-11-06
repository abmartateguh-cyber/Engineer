/**
 * Verification gate for assembly motion / clearance collision detection
 * (src/core/cad/assembly_motion_collision.js).
 *
 * Deterministic; no external dependencies. Runs under node:test.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/core/cad/assembly_motion_collision');

function assertClose(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ${expected} +/- ${tol}, got ${actual}`);
}

// ---------------------------------------------------------------------------
// Point-triangle distance
// ---------------------------------------------------------------------------

test('point-triangle distance: point above centroid of z=0 triangle -> 1', () => {
  const tri = [
    [-1, -1, 0],
    [2, -1, 0],
    [-1, 2, 0]
  ];
  const r = M.distancePointTriangle([0, 0, 1], tri[0], tri[1], tri[2]);
  assertClose(r.dist, 1, 1e-12, 'distance to plane');
  assertClose(r.closest[0], 0, 1e-12);
  assertClose(r.closest[1], 0, 1e-12);
  assertClose(r.closest[2], 0, 1e-12);
});

test('point-triangle distance: projection inside vs outside edge/vertex cases', () => {
  const tri = [
    [0, 0, 0],
    [4, 0, 0],
    [0, 4, 0]
  ];
  // Projection inside triangle -> distance to the plane (z=0) = 2.
  const inside = M.distancePointTriangle([1, 1, 2], tri[0], tri[1], tri[2]);
  assertClose(inside.dist, 2, 1e-12, 'inside projection');
  // Projection outside across an edge; closest feature is the edge
  // (0,0,0)-(4,0,0): distance sqrt(1^2 + 0^2 + 5^2) = sqrt(26).
  const edgeCase = M.distancePointTriangle([-1, 0, 5], tri[0], tri[1], tri[2]);
  assertClose(edgeCase.dist, Math.sqrt(26), 1e-12, 'outside near edge');
  // Projection outside across a vertex; closest feature is vertex (0,0,0):
  // distance sqrt(1 + 1 + 9) = sqrt(11).
  const vertexCase = M.distancePointTriangle([-1, -1, 3], tri[0], tri[1], tri[2]);
  assertClose(vertexCase.dist, Math.sqrt(11), 1e-12, 'outside near vertex');
});

// ---------------------------------------------------------------------------
// Segment-segment distance
// ---------------------------------------------------------------------------

test('segment-segment distance: skew segments match analytic closest approach', () => {
  // s1: (0,0,0) -> (1,0,0); s2: (0,1,1) -> (0,1,2)
  const r = M.distanceSegmentSegment([0, 0, 0], [1, 0, 0], [0, 1, 1], [0, 1, 2]);
  assertClose(r.dist, Math.sqrt(2), 1e-12, 'skew distance');
  const analytic = M.vecLen(M.vecSub(r.closestA, r.closestB));
  assertClose(analytic, Math.sqrt(2), 1e-12, 'closest-point pair reproduces distance');
  assertClose(r.closestA[0], 0, 1e-12);
  assertClose(r.closestA[1], 0, 1e-12);
  assertClose(r.closestA[2], 0, 1e-12);
  assertClose(r.closestB[0], 0, 1e-12);
  assertClose(r.closestB[1], 1, 1e-12);
  assertClose(r.closestB[2], 1, 1e-12);
});

test('segment-segment distance: parallel and intersecting cases', () => {
  // Parallel segments one unit apart.
  const parallel = M.distanceSegmentSegment([0, 0, 0], [3, 0, 0], [1, 1, 0], [2, 1, 0]);
  assertClose(parallel.dist, 1, 1e-12, 'parallel case');
  assertClose(parallel.closestB[1], 1, 1e-12);
  // Intersecting segments -> zero distance.
  const crossing = M.distanceSegmentSegment([0, 0, 0], [1, 0, 0], [0.5, -1, 0], [0.5, 1, 0]);
  assertClose(crossing.dist, 0, 1e-12, 'intersecting case');
});

// ---------------------------------------------------------------------------
// CCD sphere-sphere
// ---------------------------------------------------------------------------

test('CCD sphere-sphere: first-contact time satisfies the exact kinematic equation', () => {
  const A = { type: 'sphere', radius: 0.5 };
  const B = { type: 'sphere', radius: 0.5 };
  const motionA = { start: { position: [0, 0, 0] }, end: { position: [4, 0, 0] } };
  const motionB = { start: { position: [3, 0, 0] }, end: { position: [3, 0, 0] } };
  const res = M.sweptCollide(A, motionA, B, motionB);
  assert.ok(res.hit, 'expected a contact to be reported');
  const tc = res.timeOfContact;
  const separation = (t) => Math.hypot(-3 + 4 * t, 0, 0) - 1;
  assertClose(tc, 0.5, 1e-9, 'first-contact time');
  assertClose(separation(tc), 0, 1e-9, 'separation at t_c');
  assert.ok(separation(tc + 1e-6) < 0, 'separation must be negative after contact');
  assert.ok(separation(tc - 1e-6) > 0, 'separation must be positive before contact');
});

test('CCD sphere-sphere: no contact when spheres move apart', () => {
  const A = { type: 'sphere', radius: 0.5 };
  const B = { type: 'sphere', radius: 0.5 };
  const motionA = { start: { position: [0, 0, 0] }, end: { position: [4, 0, 0] } };
  const motionB = { start: { position: [3, 0, 0] }, end: { position: [8, 0, 0] } };
  const res = M.sweptCollide(A, motionA, B, motionB);
  assert.ok(!res.hit, 'spheres moving apart must not collide');
  assert.equal(res.timeOfContact, null);
  assertClose(res.clearance, 2, 1e-9, 'minimum clearance over the move');
});

// ---------------------------------------------------------------------------
// CCD sphere-triangle
// ---------------------------------------------------------------------------

test('CCD sphere-triangle: contact exactly r from plane, no tunneling', () => {
  const s = { type: 'sphere', radius: 0.5 };
  const tri = {
    type: 'triangle',
    vertices: [
      [-2, -2, 0],
      [4, -2, 0],
      [-2, 4, 0]
    ]
  };
  const motion = { start: { position: [0, 0, 5] }, end: { position: [0, 0, -1] } };
  const res = M.sweptCollide(s, motion, tri, null);
  assert.ok(res.hit, 'expected sphere-triangle contact');
  const tc = res.timeOfContact;
  assert.ok(tc > 0 && tc < 1, 'contact must occur strictly inside the step');
  const z = 5 - 6 * tc;
  assertClose(Math.abs(z) - 0.5, 0, 1e-9, 'center at t_c is exactly r from the plane');
  // No tunneling: just before contact the sphere center is above the plane
  // at a distance greater than r.
  const zPre = 5 - 6 * (tc - 1e-6);
  assert.ok(zPre > 0.5, 'sphere must still be above the plane before contact');
});

// ---------------------------------------------------------------------------
// Clearance
// ---------------------------------------------------------------------------

test('clearance: slow pass with 3 mm minimum gap reports clearance 3 mm', () => {
  const A = { type: 'sphere', radius: 1 };
  const B = { type: 'sphere', radius: 1 };
  const motion = { start: { position: [-5, 5, 0] }, end: { position: [5, 5, 0] } };
  const res = M.sweptCollide(A, motion, B, null);
  assert.ok(!res.hit, 'no contact expected');
  assertClose(res.clearance, 3, 1e-9, 'clearance over the move');
});

test('clearance: wrist-like sphere passing within 0.25 mm of a fixture', () => {
  const A = { type: 'sphere', radius: 0.5 };
  const F = { type: 'sphere', radius: 0.5 };
  const passY = (y) => ({ start: { position: [-2, y, 0] }, end: { position: [2, y, 0] } });

  // Gap 0.2 mm < 0.25 mm -> interference reported (clearance below 0.25).
  const res = M.sweptCollide(A, passY(1.2), F, null);
  assert.ok(!res.hit, '0.2 mm gap is still above the contact tolerance');
  assert.ok(res.clearance < 0.25, 'clearance must be below 0.25 mm');
  assertClose(res.clearance, 0.2, 1e-6, 'reported gap near 0.2 mm');

  // Grazing pass: gap exactly 0.25 mm -> contact at exactly 0.25.
  const res2 = M.sweptCollide(A, passY(1.25), F, null);
  assertClose(res2.clearance, 0.25, 1e-9, 'clearance exactly 0.25 mm');
});

// ---------------------------------------------------------------------------
// Mesh BVH distance validation
// ---------------------------------------------------------------------------

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomMesh(count, seed, z0, z1) {
  const rnd = lcg(seed);
  const triangles = [];
  for (let i = 0; i < count; i++) {
    const p = () => [rnd() * 10, rnd() * 10, z0 + rnd() * (z1 - z0)];
    triangles.push([p(), p(), p()]);
  }
  return { triangles };
}

function bruteForceMinDistance(meshA, meshB) {
  let best = Infinity;
  for (const ta of meshA.triangles) {
    for (const tb of meshB.triangles) {
      const d = M.distanceTriangleTriangle(ta, tb).dist;
      if (d < best) best = d;
    }
  }
  return { dist: best };
}

test('mesh BVH minimum distance equals brute-force minimum over all pairs', () => {
  const meshA = randomMesh(100, 0xabc123, 0, 1);
  const meshB = randomMesh(100, 0xdef456, 6, 7);
  const bvh = new M.MeshBVH(meshA);
  const viaBvh = M.meshMinDistance(bvh, meshB);
  const viaBruteForce = bruteForceMinDistance(meshA, meshB);
  assert.ok(viaBvh.dist > 0, 'meshes must be separated');
  assertClose(viaBvh.dist, viaBruteForce.dist, 1e-9, 'BVH min distance vs brute force');
  // Sanity: separation of the two slabs must be at least 5.
  assert.ok(viaBvh.dist >= 5 - 1e-9, 'slab separation floor');
});

test('mesh static collision: BVH broad-phase + triangle narrow-phase', () => {
  const meshA = randomMesh(50, 11, 0, 1);
  const meshB = randomMesh(50, 22, 6, 7);
  assert.ok(!M.meshesCollide(meshA, meshB), 'separated meshes must not collide');
  const meshC = {
    triangles: [
      [
        [0, 0, 0],
        [3, 0, 0],
        [0, 3, 0]
      ]
    ]
  };
  const meshD = {
    triangles: [
      [
        [0.5, 0.5, 0],
        [3.5, 0.5, 0],
        [0.5, 3.5, 0]
      ]
    ]
  };
  assert.ok(M.meshesCollide(meshC, meshD), 'overlapping triangles must intersect');
  const pairs = M.broadPhaseCandidatePairs(meshC, meshD);
  assert.ok(pairs.length >= 1, 'broad phase must report at least one candidate pair');
});

test('swept mesh-mesh: separated animated meshes report no collision', () => {
  const meshA = randomMesh(50, 33, 0, 1);
  const meshB = randomMesh(50, 44, 6, 7);
  const motionA = { start: { position: [0, 0, 0] }, end: { position: [1, 0, 0] } };
  const motionB = { start: { position: [0, 0, 0] }, end: { position: [-1, 0, 0] } };
  const res = M.sweptMeshesCollide(meshA, motionA, meshB, motionB);
  assert.ok(!res.collides, 'separated swept meshes must not collide');
  assert.equal(res.timeOfContact, null);
});
