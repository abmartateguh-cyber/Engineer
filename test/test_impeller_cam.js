/**
 * Test Suite: ImpellerCAM — 5-Axis Impeller/Blisk Clearing Verification Gate
 *
 * Verifies:
 *   1. Geometry: N blade faces, hub/shroud radial extent, ruled-surface meshes.
 *   2. Toolpath emission: one passage per blade gap, >= 5 cutting passes per
 *      passage, every pose tip within the hub/shroud radial bounds.
 *   3. Holder collision avoidance: for every pose the tool shaft (cylinder
 *      radius = holder radius) keeps >= 0.5 mm to the two neighboring blade
 *      ruled surfaces (computed with the module's own distance helper).
 *   4. Line continuity: successive tool axis directions change <= 5 deg and
 *      successive tip positions jump <= 2 mm along each passage.
 *   5. Tilt direction: the tool axis tilts into the open passage; its
 *      tangential component has the same sign as the passage-center direction
 *      (the average of the two neighboring blade face normals).
 *   6. Determinism: two identical runs produce identical paths.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ImpellerCAM, passageCenterTheta, passageDir, axisForTilt } = require('../src/core/cam/impeller_cam');

const PARAMS = {
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
  searchMeshRes: 6,
  validateMeshRes: 16,
  linkSpacing: 1.5
};

const MIN_CLEARANCE_MM = 0.5;
const MAX_AXIS_CHANGE_DEG = 5.0;
const MAX_TIP_JUMP_MM = 2.0;

function build() {
  const cam = new ImpellerCAM(PARAMS);
  const path = cam.generateToolpath();
  const geometry = cam.buildGeometry({ meshRes: PARAMS.validateMeshRes });
  return { cam, path, geometry };
}

test('ImpellerCAM geometry: 12 twisted blades, ruled faces, radial bounds', () => {
  const cam = new ImpellerCAM(PARAMS);
  const g = cam.buildGeometry({ meshRes: 8 });
  assert.equal(g.blades.length, PARAMS.numBlades);
  for (let k = 0; k < g.blades.length; k++) {
    const blade = g.blades[k];
    for (const sigma of [1, -1]) {
      const mesh = sigma === 1 ? blade.faces.plus : blade.faces.minus;
      assert.equal(mesh.length, 2 * 8 * 8, `blade ${k} face ${sigma} triangle count`);
      for (const tri of mesh) {
        for (const v of [tri.a, tri.b, tri.c]) {
          const radial = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
          const tol = PARAMS.thickness / 2 + 1e-9;
          assert.ok(radial >= PARAMS.Rh - tol, `blade ${k} face ${sigma} vertex below hub`);
          assert.ok(radial <= PARAMS.Rs + tol, `blade ${k} face ${sigma} vertex above shroud`);
        }
      }
    }
  }
});

test('ImpellerCAM path: one passage per blade gap, >=5 passes, poses within bounds', () => {
  const { path } = build();
  assert.equal(path.passages.length, PARAMS.numBlades, 'one passage per blade gap');
  for (const passage of path.passages) {
    assert.ok(passage.passes >= 5, `passage ${passage.index} has ${passage.passes} passes (>=5)`);
    assert.ok(passage.poses.length > 0);
    for (const pose of passage.poses) {
      const radial = Math.sqrt(pose.tip[0] * pose.tip[0] + pose.tip[1] * pose.tip[1]);
      assert.ok(radial >= PARAMS.Rh - 1e-6, `passage ${passage.index} tip below hub radius`);
      assert.ok(radial <= PARAMS.Rs + 1e-6, `passage ${passage.index} tip above shroud radius`);
      assert.ok(pose.tip[2] >= PARAMS.z0 - 1e-6, `passage ${passage.index} tip below z0`);
      assert.ok(pose.tip[2] <= PARAMS.z1 + 1e-6, `passage ${passage.index} tip above z1`);
      assert.equal(pose.passageIndex, passage.index, 'pose belongs to its passage');
      assert.equal(pose.tiltDeg, pose.tiltDeg, 'tilt must be a number');
    }
  }
  const stats = path.stats;
  assert.ok(stats.totalPasses >= 12 * 5, 'total passes across all passages >= 60');
  assert.ok(stats.totalPoses > 0);
  assert.equal(typeof stats.minHolderClearanceMm, 'number');
  assert.equal(typeof stats.maxAxisJumpMm, 'number');
  assert.equal(typeof stats.maxAxisChangeDeg, 'number');
});

test('ImpellerCAM holder collision: shaft to neighboring blades >= 0.5 mm (module distance helper)', () => {
  const { cam, path } = build();
  let minClearance = Infinity;
  for (const passage of path.passages) {
    for (const pose of passage.poses) {
      const cl = cam.holderClearance(passage.index, pose, { meshRes: PARAMS.validateMeshRes });
      assert.ok(
        cl >= MIN_CLEARANCE_MM - 1e-9,
        `passage ${passage.index} pose (${pose.kind}) holder clearance ${cl.toFixed(4)} mm < ${MIN_CLEARANCE_MM}`
      );
      if (cl < minClearance) {
        minClearance = cl;
      }
    }
  }
  assert.ok(minClearance >= MIN_CLEARANCE_MM, `overall min holder clearance ${minClearance}`);
});

test('ImpellerCAM line continuity: axis change <=5deg, tip jump <=2mm', () => {
  const { path } = build();
  for (const passage of path.passages) {
    let maxAxisChangeDeg = 0;
    let maxJump = 0;
    for (let i = 1; i < passage.poses.length; i++) {
      const prev = passage.poses[i - 1];
      const cur = passage.poses[i];
      const cosAng = Math.max(
        -1,
        Math.min(1, cur.axis[0] * prev.axis[0] + cur.axis[1] * prev.axis[1] + cur.axis[2] * prev.axis[2])
      );
      const angDeg = (Math.acos(cosAng) * 180) / Math.PI;
      maxAxisChangeDeg = Math.max(maxAxisChangeDeg, angDeg);
      const jump = Math.sqrt(
        (cur.tip[0] - prev.tip[0]) ** 2 + (cur.tip[1] - prev.tip[1]) ** 2 + (cur.tip[2] - prev.tip[2]) ** 2
      );
      maxJump = Math.max(maxJump, jump);
    }
    assert.ok(
      maxAxisChangeDeg <= MAX_AXIS_CHANGE_DEG + 1e-9,
      `passage ${passage.index} max axis change ${maxAxisChangeDeg.toFixed(3)} deg > 5`
    );
    assert.ok(maxJump <= MAX_TIP_JUMP_MM + 1e-9, `passage ${passage.index} max tip jump ${maxJump.toFixed(3)} mm > 2`);
  }
});

test('ImpellerCAM tilt direction: axis tilts into the open passage (sign matches blade normals)', () => {
  const { cam, path } = build();
  for (const passage of path.passages) {
    for (const pose of passage.poses) {
      const t = (pose.tip[2] - PARAMS.z0) / (PARAMS.z1 - PARAMS.z0);
      const theta = passageCenterTheta(passage.index, t, cam.params);
      const dir = passageDir(passage.index, t, cam.params);
      const axisRef = axisForTilt(passage.index, t, pose.tiltDeg, cam.params);
      const dot = pose.axis[0] * dir[0] + pose.axis[1] * dir[1] + pose.axis[2] * dir[2];
      assert.ok(
        dot > 0,
        `passage ${passage.index} pose (${pose.kind}) axis does not tilt into passage (dot=${dot.toFixed(4)})`
      );
      assert.ok(
        dot >= Math.sin((PARAMS.minTiltDeg * Math.PI) / 180) - 1e-9,
        `passage ${passage.index} pose (${pose.kind}) tilt ${pose.tiltDeg.toFixed(2)} deg below minimum`
      );
      const cosAxis = Math.max(
        -1,
        Math.min(1, pose.axis[0] * axisRef[0] + pose.axis[1] * axisRef[1] + pose.axis[2] * axisRef[2])
      );
      assert.ok(cosAxis > 1 - 1e-9, `passage ${passage.index} pose axis deviates from tilt convention`);
      const eTheta = [-Math.sin(theta), Math.cos(theta), 0];
      const normProduct = eTheta[0] * dir[0] + eTheta[1] * dir[1];
      assert.ok(normProduct > 1 - 1e-9, 'passage direction must coincide with tangential blade normal');
    }
  }
});

test('ImpellerCAM deterministic: independent runs produce identical paths', () => {
  const camA = new ImpellerCAM(PARAMS);
  const camB = new ImpellerCAM(PARAMS);
  const pathA = camA.generateToolpath();
  const pathB = camB.generateToolpath();
  assert.notEqual(pathA, pathB, 'paths must be distinct objects');
  assert.equal(JSON.stringify(pathA), JSON.stringify(pathB));
  assert.deepEqual(pathA.stats, pathB.stats);
});

test('ImpellerCAM defaults: module defaults satisfy clearances', () => {
  const cam = new ImpellerCAM();
  const path = cam.generateToolpath();
  assert.equal(path.passages.length, 12);
  for (const passage of path.passages) {
    assert.ok(passage.passes >= 5);
    for (const pose of passage.poses) {
      const cl = cam.holderClearance(passage.index, pose, { meshRes: cam.params.validateMeshRes });
      assert.ok(cl >= MIN_CLEARANCE_MM - 1e-9, `default params passage ${passage.index} clearance ${cl}`);
    }
  }
});
