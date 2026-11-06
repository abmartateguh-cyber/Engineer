/**
 * Verification gate for the CAM tool-assembly collision detection engine
 * (src/core/cam/collision_detection_cam.js).
 *
 * Deterministic; dependency-free. Runs under node:test.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/core/cam/collision_detection_cam');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// Tool: 25 mm flute (r=5), 20 mm shank (r=10), 15 mm holder (r=16).
const assembly = new M.ToolAssembly({
  flute: { radius: 5, length: 25 },
  shank: { radius: 10, length: 20 },
  holder: { radius: 16, length: 15 }
});

const AXIS_DOWN = [0, 0, -1];

// Deep-pocket scenario: a slot bounded by two workpiece walls (z <= 26) and
// a fixture clamp fixed to the workpiece near the top (z in [20,35]).
// The holder (r=16) clips the clamp face at x = 15.9 by exactly 0.1 mm when
// the tip plunges to z = -15; flute (r=5) and shank (r=10) stay clear.
const DEEP_POCKET_WALLS = [
  { min: [-21, -40, 0], max: [-17, 40, 26] },
  { min: [17, -40, 0], max: [21, 40, 26] }
];
const CLAMP_FACE_X = 15.9;
const DEEP_POCKET_CLAMP = [{ min: [CLAMP_FACE_X, -15, 26], max: [28, 15, 32] }];
const DEEP_POCKET_OBSTACLES = [...DEEP_POCKET_WALLS, ...DEEP_POCKET_CLAMP];

const DEEP_POCKET_PATH = [
  { centerline: [0, 0, 40], axis: AXIS_DOWN },
  { centerline: [0, 0, 30], axis: AXIS_DOWN },
  { centerline: [0, 0, 20], axis: AXIS_DOWN },
  { centerline: [0, 0, 10], axis: AXIS_DOWN },
  { centerline: [0, 0, 0], axis: AXIS_DOWN },
  { centerline: [0, 0, -8], axis: AXIS_DOWN },
  { centerline: [0, 0, -15], axis: AXIS_DOWN }
];

const POCKET_BOTTOM_POSE = DEEP_POCKET_PATH[DEEP_POCKET_PATH.length - 1];
const POCKET_BOTTOM_INDEX = DEEP_POCKET_PATH.length - 1;

function clampBoxAtFaceX(faceX) {
  return [{ min: [faceX, -15, 26], max: [28, 15, 32] }];
}

// ---------------------------------------------------------------------------
// Analytic primitive checks
// ---------------------------------------------------------------------------

test('cylinder-triangle clearance matches analytic plane distance to 1e-9', () => {
  // Triangle lies in the plane y = 3; cylinder axis runs along z at y = 0
  // with the axis segment fully covering the triangle's z extent, so the
  // distance is exactly the axis-to-plane distance (3) minus radius (2).
  const tri = [
    [-1, 3, -1],
    [1, 3, -1],
    [0, 3, 1]
  ];
  const clearance = M.distanceCylinderTriangle([0, 0, 0], [0, 0, 10], 2, tri);
  assert.ok(Math.abs(clearance - 1) <= 1e-9, `expected 1, got ${clearance}`);
});

test('cylinder-cylinder clearance matches analytic axis distance', () => {
  // Parallel axes 5 mm apart: clearance = 5 - 2 - 1 = 2.
  const parallel = M.distanceCylinderCylinder([0, 0, 0], [0, 0, 10], 2, [5, 0, 0], [5, 0, 10], 1);
  assert.ok(Math.abs(parallel - 2) <= 1e-12, `parallel expected 2, got ${parallel}`);

  // Skew axes: closest approach between (0,0,5) and (0,3,5) is 3.
  const skew = M.distanceCylinderCylinder([0, 0, 0], [0, 0, 10], 1, [0, 3, 5], [5, 3, 5], 1);
  assert.ok(Math.abs(skew - 1) <= 1e-12, `skew expected 1, got ${skew}`);

  // Overlapping coaxial cylinders: segment distance 0 -> clearance -3.
  const overlap = M.distanceCylinderCylinder([0, 0, 0], [0, 0, 10], 2, [0, 0, 5], [0, 0, 15], 1);
  assert.ok(Math.abs(overlap - -3) <= 1e-12, `overlap expected -3, got ${overlap}`);
});

test('box decomposition yields 12 well-formed triangles', () => {
  const tris = M.boxToTriangles({ min: [0, 0, 0], max: [10, 10, 10] });
  assert.strictEqual(tris.length, 12);
  for (const tri of tris) {
    assert.strictEqual(tri.length, 3);
    for (const p of tri) {
      assert.strictEqual(p.length, 3);
      assert.ok(p.every((v) => Number.isFinite(v)));
    }
  }
});

// ---------------------------------------------------------------------------
// Deep-pocket holder collision
// ---------------------------------------------------------------------------

test('deep pocket: holder collision flagged at correct index; flute/shank free', () => {
  const res = M.analyzeToolpath(assembly, DEEP_POCKET_PATH, DEEP_POCKET_OBSTACLES, {
    threshold: 0.1
  });

  // Exactly one collision, at the pocket-bottom pose, on the holder.
  assert.strictEqual(res.collisions.length, 1);
  assert.strictEqual(res.collisions[0].index, POCKET_BOTTOM_INDEX);
  assert.strictEqual(res.collisions[0].segment, 'holder');
  assert.ok(Math.abs(res.collisions[0].clearance - -0.1) < 1e-6, `clearance ${res.collisions[0].clearance}`);

  // The flagged pose carries the holder collision; the other poses are clean.
  assert.strictEqual(res.poses.length, DEEP_POCKET_PATH.length);
  for (const pose of res.poses) {
    if (pose.index === POCKET_BOTTOM_INDEX) {
      assert.strictEqual(pose.collisions.length, 1);
      assert.strictEqual(pose.collisions[0].segment, 'holder');
      assert.ok(Math.abs(pose.minClearance - -0.1) < 1e-6);
    } else {
      assert.strictEqual(pose.collisions.length, 0);
      assert.ok(pose.minClearance >= 0.5, `pose ${pose.index} clearance ${pose.minClearance}`);
    }
  }

  // Flute and shank never collide on this path.
  assert.ok(res.collisions.every((c) => c.segment === 'holder'));
  assert.ok(res.perSegmentMin.flute > 1, `flute min ${res.perSegmentMin.flute}`);
  assert.ok(res.perSegmentMin.shank > 1, `shank min ${res.perSegmentMin.shank}`);
  assert.ok(Math.abs(res.perSegmentMin.holder - -0.1) < 1e-6, `holder min ${res.perSegmentMin.holder}`);
});

// ---------------------------------------------------------------------------
// Clearance threshold boundary
// ---------------------------------------------------------------------------

test('clearance threshold: exactly 0.1 mm gap not flagged; 0.09 mm flagged', () => {
  const posePath = [POCKET_BOTTOM_POSE];

  // Gap exactly 0.1 mm (clamp face at 16.1): not below threshold.
  const atThreshold = M.analyzeToolpath(assembly, posePath, [...DEEP_POCKET_WALLS, ...clampBoxAtFaceX(16.1)], {
    threshold: 0.1
  });
  assert.strictEqual(atThreshold.collisions.length, 0);
  assert.ok(
    Math.abs(atThreshold.poses[0].clearances.holder - 0.1) <= 1e-9,
    `holder ${atThreshold.poses[0].clearances.holder}`
  );

  // Gap 0.09 mm (clamp face at 16.09): flagged.
  const belowThreshold = M.analyzeToolpath(assembly, posePath, [...DEEP_POCKET_WALLS, ...clampBoxAtFaceX(16.09)], {
    threshold: 0.1
  });
  assert.strictEqual(belowThreshold.collisions.length, 1);
  assert.strictEqual(belowThreshold.collisions[0].segment, 'holder');
  assert.ok(
    Math.abs(belowThreshold.collisions[0].clearance - 0.09) <= 1e-9,
    `clearance ${belowThreshold.collisions[0].clearance}`
  );
});

// ---------------------------------------------------------------------------
// Tilt resolution
// ---------------------------------------------------------------------------

test('tilt resolution restores clearance >= d_safe at the tilted pose', () => {
  const tilt = M.resolveCollisionFreeTilt(assembly, DEEP_POCKET_PATH, POCKET_BOTTOM_INDEX, DEEP_POCKET_OBSTACLES, {
    dSafe: 0.5
  });

  assert.ok(tilt.feasible, 'expected a feasible tilt');
  assert.ok(
    Math.abs(tilt.angleDeg) > 0.2 && Math.abs(tilt.angleDeg) < 5,
    `angle ${tilt.angleDeg} deg out of sane range`
  );
  assert.ok(Math.abs(M.vecLen(tilt.pose.axis) - 1) < 1e-9, 'tilted axis must be unit length');
  assert.strictEqual(tilt.segment, 'holder');

  // Re-run the full distance check at the tilted pose: every segment must
  // now have clearance >= 0.5 mm.
  const verify = M.analyzeToolpath(assembly, [tilt.pose], DEEP_POCKET_OBSTACLES, {
    threshold: 0.1
  });
  assert.strictEqual(verify.collisions.length, 0);
  assert.ok(verify.poses[0].minClearance >= 0.5 - 1e-9, `tilted min clearance ${verify.poses[0].minClearance} < 0.5`);
  assert.ok(verify.poses[0].clearances.holder >= 0.5 - 1e-9, `holder ${verify.poses[0].clearances.holder}`);
});

// ---------------------------------------------------------------------------
// No false positives
// ---------------------------------------------------------------------------

test('no false positives: clean path reports zero collisions', () => {
  // Move the walls out to +/-20 and the clamp out to x=30 so every segment
  // keeps > 1 mm clearance at every pose.
  const cleanObstacles = [
    { min: [-20, -40, 0], max: [-18, 40, 26] },
    { min: [18, -40, 0], max: [20, 40, 26] },
    { min: [30, -15, 20], max: [45, 15, 35] }
  ];
  const res = M.analyzeToolpath(assembly, DEEP_POCKET_PATH, cleanObstacles, {
    threshold: 0.1
  });
  assert.strictEqual(res.collisions.length, 0);
  assert.ok(res.minClearance > 1, `min clearance ${res.minClearance} should be > 1`);
  for (const pose of res.poses) {
    assert.strictEqual(pose.collisions.length, 0);
  }
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('determinism: identical inputs produce identical outputs', () => {
  const opts = { threshold: 0.1 };
  const a = JSON.stringify(M.analyzeToolpath(assembly, DEEP_POCKET_PATH, DEEP_POCKET_OBSTACLES, opts));
  const b = JSON.stringify(M.analyzeToolpath(assembly, DEEP_POCKET_PATH, DEEP_POCKET_OBSTACLES, opts));
  assert.strictEqual(a, b);

  const t1 = M.resolveCollisionFreeTilt(assembly, DEEP_POCKET_PATH, POCKET_BOTTOM_INDEX, DEEP_POCKET_OBSTACLES, {
    dSafe: 0.5
  });
  const t2 = M.resolveCollisionFreeTilt(assembly, DEEP_POCKET_PATH, POCKET_BOTTOM_INDEX, DEEP_POCKET_OBSTACLES, {
    dSafe: 0.5
  });
  assert.deepEqual(t1, t2);
  assert.ok(Number.isFinite(t1.angleRad));
});

// ---------------------------------------------------------------------------
// Swept volume
// ---------------------------------------------------------------------------

test('swept volume between poses samples intermediate assembly positions', () => {
  const poseA = { centerline: [0, 0, -8], axis: AXIS_DOWN };
  const poseB = { centerline: [0, 0, -15], axis: AXIS_DOWN };
  const swept = M.sweptSegmentsBetweenPoses(assembly, poseA, poseB, 3);
  assert.strictEqual(swept.length, 3);
  for (const sample of swept) {
    assert.ok(sample.t > 0 && sample.t < 1);
    const holder = sample.segments.holder;
    assert.deepEqual(holder.start, [0, 0, 37 - 7 * sample.t]);
    assert.deepEqual(holder.end, [0, 0, 52 - 7 * sample.t]);
  }
});
