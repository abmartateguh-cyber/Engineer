'use strict';

const { test } = require('node:test');
const assert = require('assert');
const {
  PROFILE_CATALOG,
  buildProfileCatalog,
  validateProfileCatalog,
  getProfile,
  generateFrame,
  generateSkidFrame,
  generateSkidFrameSkeleton,
  TOL
} = require('../src/core/cad/weldment_engine');

const EPS = 1e-9;

function vecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vecNorm(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function segLength(seg) {
  return vecNorm(vecSub(seg.end, seg.start));
}

test('skid frame: 12 members, profile assigned, length, quantity 1', () => {
  const frame = generateSkidFrame();
  assert.strictEqual(frame.summary.memberCount, 12);
  assert.strictEqual(frame.members.length, 12);
  const skeleton = generateSkidFrameSkeleton();
  for (let i = 0; i < 12; i++) {
    const m = frame.members[i];
    assert.strictEqual(m.quantity, 1);
    assert.ok(typeof m.profile === 'object' && m.profile !== null, `member ${m.id} has profile`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(PROFILE_CATALOG, m.profile.name),
      `member ${m.id} profile ${m.profile.name} in catalog`
    );
    assert.ok(Math.abs(m.trueLengthMm - segLength(skeleton[i])) <= EPS, `member ${m.id} true length matches sketch`);
    assert.ok(Number.isFinite(m.effectiveLengthMm) && m.effectiveLengthMm > 0);
    assert.strictEqual(m.endCuts.length, 2);
  }
  assert.strictEqual(frame.cutLengthTable.rows.length, 12);
  assert.deepStrictEqual(frame.cutLengthTable.columns, [
    'memberId',
    'profile',
    'trueLengthMm',
    'effectiveLengthMm',
    'quantity'
  ]);
});

test('miter: two members at 90 deg -> cut angle 45 deg, plane normal = bisector', () => {
  const segs = [
    { start: [0, 0, 0], end: [1000, 0, 0] },
    { start: [1000, 0, 0], end: [1000, 1000, 0] }
  ];
  const frame = generateFrame(segs);
  assert.strictEqual(frame.summary.memberCount, 2);
  const joint = frame.joints.find((j) => j.point[0] === 1000 && j.point[1] === 0);
  assert.ok(joint, 'joint at corner exists');
  assert.strictEqual(joint.memberEnds.length, 2);
  for (const m of frame.members) {
    const cut = m.endCuts.find((c) => c.jointId === joint.index);
    assert.ok(cut, `member ${m.id} has end cut at joint`);
    assert.strictEqual(cut.type, 'miter');
    assert.ok(Math.abs(cut.cutAngleDeg - 45.0) <= 1e-9, `cut angle = 45 deg (got ${cut.cutAngleDeg})`);
    const n = vecNorm(cut.planeNormal);
    assert.ok(Math.abs(n - 1.0) <= 1e-9, 'plane normal is unit');
    const m2 = m.segmentIndex === 0 ? frame.members[1] : frame.members[0];
    const cut2 = m2.endCuts.find((c) => c.jointId === joint.index);
    const bisector = vecSub(cut2.planeNormal, [0, 0, 0]);
    const dot = bisector[0] * cut.planeNormal[0] + bisector[1] * cut.planeNormal[1] + bisector[2] * cut.planeNormal[2];
    assert.ok(Math.abs(Math.abs(dot) - 1.0) <= 1e-9, 'cut plane normals are parallel (same bisector plane)');
  }
});

test('length accounting: true lengths sum to sketch, effective <= true, miter consumes material', () => {
  const frame = generateSkidFrame();
  const skeleton = generateSkidFrameSkeleton();
  const sketchSum = skeleton.reduce((s, seg) => s + segLength(seg), 0);
  const trueSum = frame.summary.totalTrueLengthMm;
  assert.ok(Math.abs(trueSum - sketchSum) <= EPS, 'sum of true lengths == sum of sketch segment lengths');
  for (const m of frame.members) {
    assert.ok(m.effectiveLengthMm <= m.trueLengthMm + EPS, `effective length <= true for ${m.id}`);
  }
  assert.ok(
    frame.summary.totalEffectiveLengthMm < trueSum - EPS,
    'after miter allowances effective total < true total'
  );
});

test('mass: total frame mass = sum(length x massPerMeter)', () => {
  const frame = generateSkidFrame();
  const expected = frame.members.reduce((s, m) => s + (m.trueLengthMm / 1000.0) * m.profile.massPerMeterKg, 0);
  assert.ok(Math.abs(frame.totalMassKg - expected) <= EPS, `mass match (${frame.totalMassKg} vs ${expected})`);
  assert.ok(frame.totalMassKg > 0);
});

test('weld symbols: 12 fillet-weld symbols, each attached at a joint coordinate, deterministic', () => {
  const frame = generateSkidFrame();
  assert.strictEqual(frame.summary.weldSymbolCount, 12);
  const svg = frame.svg;
  const triangleMatches = svg.match(/class="weld-fillet-triangle"/g);
  const awsMatches = svg.match(/data-aws-designation="FI"/g);
  assert.strictEqual(triangleMatches ? triangleMatches.length : 0, 12, '12 fillet triangle paths');
  assert.strictEqual(awsMatches ? awsMatches.length : 0, 12, '12 AWS designation texts');
  const jointCoords = frame.joints.map((j) => j.point);
  for (const sym of frame.weldSymbols) {
    const onJoint = jointCoords.some((p) => {
      return (
        Math.abs(p[0] - sym.anchor[0]) <= TOL &&
        Math.abs(p[1] - sym.anchor[1]) <= TOL &&
        Math.abs(p[2] - sym.anchor[2]) <= TOL
      );
    });
    assert.ok(onJoint, `symbol ${sym.id} anchored at a joint coordinate`);
    const anchorAttr = svg.match(
      new RegExp(`data-anchor="${sym.anchor[0].toFixed(2)},${sym.anchor[1].toFixed(2)},${sym.anchor[2].toFixed(2)}"`)
    );
    assert.ok(anchorAttr, `symbol ${sym.id} anchor appears in SVG`);
  }
  const frame2 = generateSkidFrame();
  assert.strictEqual(frame2.svg, svg, 'deterministic SVG');
  assert.strictEqual(JSON.stringify(frame2.weldSymbols), JSON.stringify(frame.weldSymbols));
});

test('profile catalog integrity: positive area and mass, no NaN', () => {
  const names = Object.keys(PROFILE_CATALOG);
  assert.ok(names.length >= 5, `catalog has >= 5 profiles (got ${names.length})`);
  for (const name of names) {
    const p = PROFILE_CATALOG[name];
    for (const key of ['areaMm2', 'massPerMeterKg', 'depthMm', 'flangeWidthMm', 'webThicknessMm']) {
      const v = p[key];
      assert.ok(Number.isFinite(v) && v > 0, `${name}.${key} positive finite`);
      assert.ok(!Number.isNaN(v), `${name}.${key} not NaN`);
    }
    assert.ok(typeof p.type === 'string' && p.type.length > 0);
  }
  validateProfileCatalog(PROFILE_CATALOG);
});

test('fail-closed: missing profile, duplicate profile, malformed catalog, unknown option profile', () => {
  assert.throws(() => getProfile('NOPE-123'), /Unknown profile/);
  assert.throws(
    () =>
      buildProfileCatalog([
        { name: 'X', areaMm2: 100, massPerMeterKg: 1, depthMm: 10, flangeWidthMm: 10, webThicknessMm: 2 },
        { name: 'X', areaMm2: 200, massPerMeterKg: 2, depthMm: 10, flangeWidthMm: 10, webThicknessMm: 2 }
      ]),
    /duplicate profile/
  );
  assert.throws(() => validateProfileCatalog({ Bad: { areaMm2: 0, massPerMeterKg: 1 } }), /areaMm2/);
  assert.throws(() => validateProfileCatalog({ Bad: { areaMm2: NaN, massPerMeterKg: 1 } }), /areaMm2/);
  assert.throws(
    () => validateProfileCatalog({ Bad: { areaMm2: 100, massPerMeterKg: Number.POSITIVE_INFINITY } }),
    /massPerMeterKg/
  );
  const segs = [{ start: [0, 0, 0], end: [1000, 0, 0] }];
  assert.throws(() => generateFrame(segs, { profiles: ['NOT-A-PROFILE'] }), /Unknown profile/);
  assert.throws(() => generateFrame([], {}), /at least one segment/);
  assert.throws(() => generateFrame([{ start: [0, 0, 0], end: [0, 0, 0] }], {}), /degenerate/);
});
