/**
 * Verification gate for the semantic GD&T Feature Control Frame model and
 * tolerance-evaluation engine (src/core/cad/drafting_gdt.js).
 * Deterministic: all measurement data is generated from fixed closed-form
 * patterns (no randomness).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FeatureControlFrame,
  evaluateTruePosition,
  evaluateFlatness,
  evaluateCylindricity,
  evaluatePerpendicularity,
  evaluateProfile,
  validateFeatureControlFrame
} = require('../src/core/cad/drafting_gdt');

function closeTo(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: expected ${expected} within ${tol}, got ${actual}`);
}

test('FCF parse round-trip: ⌀0.1(A)M(B)M(C)', () => {
  const fcf = FeatureControlFrame.parse('⌀0.1(A)M(B)M(C)');
  assert.equal(fcf.characteristic, 'POSITION');
  assert.equal(fcf.tolerance, 0.1);
  assert.equal(fcf.diameter, true);
  assert.equal(fcf.modifier, null);
  assert.deepEqual(fcf.datums, [
    { name: 'A', modifier: 'M' },
    { name: 'B', modifier: 'M' },
    { name: 'C', modifier: null }
  ]);
  assert.equal(fcf.toString(), '⌀0.1(A)M(B)M(C)');
  assert.deepEqual(fcf.toJSON(), {
    characteristic: 'POSITION',
    tolerance: 0.1,
    diameter: true,
    modifier: null,
    datums: [
      { name: 'A', modifier: 'M' },
      { name: 'B', modifier: 'M' },
      { name: 'C', modifier: null }
    ]
  });
});

test('FCF parse round-trip: 0.05|A|B|C', () => {
  const fcf = FeatureControlFrame.parse('0.05|A|B|C');
  assert.equal(fcf.characteristic, 'POSITION');
  assert.equal(fcf.tolerance, 0.05);
  assert.equal(fcf.diameter, false);
  assert.equal(fcf.modifier, null);
  assert.deepEqual(fcf.datums, [
    { name: 'A', modifier: null },
    { name: 'B', modifier: null },
    { name: 'C', modifier: null }
  ]);
  assert.equal(fcf.toString(), '0.05|A|B|C');
});

test('FCF parse: feature-level MMC modifier and unicode symbols', () => {
  const fcf = FeatureControlFrame.parse('POSITION ⌀0.1M(A)(B)(C)');
  assert.equal(fcf.characteristic, 'POSITION');
  assert.equal(fcf.tolerance, 0.1);
  assert.equal(fcf.diameter, true);
  assert.equal(fcf.modifier, 'M');
  assert.deepEqual(fcf.datums, [
    { name: 'A', modifier: null },
    { name: 'B', modifier: null },
    { name: 'C', modifier: null }
  ]);
  // Canonical serialization omits the default POSITION characteristic prefix.
  assert.equal(fcf.toString(), '⌀0.1M(A)(B)(C)');

  const unicode = FeatureControlFrame.parse('⌀0.1(A)⊙(B)Ⓕ(C)');
  assert.equal(unicode.datums[0].modifier, 'M');
  assert.equal(unicode.datums[1].modifier, 'L');
});

test('True position: 2×√(0.03²+0.04²) = 0.10; pass/fail exactly at boundary', () => {
  const fcf = FeatureControlFrame.parse('⌀0.1(A)(B)(C)');

  const dx = 0.03;
  const dy = 0.04;
  const expectedTruePosition = 2 * Math.sqrt(dx * dx + dy * dy);
  closeTo(expectedTruePosition, 0.1, 1e-9, 'true position diameter');

  const result = evaluateTruePosition(fcf, {
    trueX: 10,
    trueY: 10,
    measuredX: 10.03,
    measuredY: 10.04
  });
  closeTo(result.truePositionDeviation, 0.1, 1e-9, 'measured true position');
  closeTo(result.centerOffset, 0.05, 1e-12, 'center offset');
  assert.equal(result.bonus, 0);
  assert.equal(result.toleranceAllocated, 0.1);
  assert.equal(result.pass, true);

  const over = evaluateTruePosition(fcf, {
    trueX: 10,
    trueY: 10,
    measuredX: 10.031,
    measuredY: 10.041
  });
  assert.ok(over.truePositionDeviation > 0.1, `over-limit deviation ${over.truePositionDeviation}`);
  assert.equal(over.pass, false);
});

test('MMC bonus: hole Ø10±0.1, MMC 9.9, actual 10.08 -> bonus 0.18, allocated 0.28, virtual condition boundary 0.14', () => {
  const fcf = FeatureControlFrame.parse('POSITION ⌀0.1M(A)(B)(C)');
  assert.equal(fcf.modifier, 'M');

  const mmcSize = 9.9;
  const actualSize = 10.08;
  const expectedBonus = actualSize - mmcSize;
  closeTo(expectedBonus, 0.18, 1e-12, 'MMC bonus');

  const result = evaluateTruePosition(fcf, {
    trueX: 10,
    trueY: 10,
    measuredX: 10,
    measuredY: 10,
    actualSize,
    mmcSize,
    featureKind: 'hole'
  });
  closeTo(result.bonus, 0.18, 1e-12, 'engine bonus');
  closeTo(result.toleranceAllocated, 0.28, 1e-12, 'allocated tolerance');
  closeTo(result.geometricCenterOffsetLimit, (0.1 + 0.18) / 2, 1e-12, 'virtual condition center offset limit');
  closeTo(result.virtualCondition.centerOffsetLimit, 0.14, 1e-12, 'virtual condition boundary');

  const inside = evaluateTruePosition(fcf, {
    trueX: 10,
    trueY: 10,
    measuredX: 10.13,
    measuredY: 10,
    actualSize,
    mmcSize,
    featureKind: 'hole'
  });
  closeTo(inside.centerOffset, 0.13, 1e-12, 'inside boundary offset');
  assert.ok(inside.centerOffset <= inside.geometricCenterOffsetLimit + 1e-12);
  assert.equal(inside.pass, true);

  const outside = evaluateTruePosition(fcf, {
    trueX: 10,
    trueY: 10,
    measuredX: 10.15,
    measuredY: 10,
    actualSize,
    mmcSize,
    featureKind: 'hole'
  });
  assert.ok(outside.centerOffset > outside.geometricCenterOffsetLimit);
  assert.equal(outside.pass, false);
});

test('Flatness: sinusoidal ripple amplitude 0.02 -> min-zone ≈ 0.04 (peak-to-peak)', () => {
  // Cosine-phase ripple: z = A·cos(2πx). Unlike a sine phase (which correlates
  // with x and lets the minimum-zone bounding planes tilt, compressing the zone
  // below peak-to-peak to ~0.027), cos(2πx) has zero covariance with x over
  // this symmetric grid, so the optimal bounding planes stay horizontal and
  // the min-zone width equals the ripple peak-to-peak 2A = 0.04.
  const amplitude = 0.02;
  const points = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i / (n - 1);
      const y = j / (n - 1);
      const z = amplitude * Math.cos(2 * Math.PI * x);
      points.push([x, y, z]);
    }
  }
  const result = evaluateFlatness(points);
  closeTo(result.flatness, 0.04, 0.004, `flatness (10% of 0.04) — method: ${result.method}`);
  assert.equal(result.count, n * n);
  console.log(`  flatness measured = ${result.flatness} (expected ≈ 0.040 ± 0.004)`);
});

test('Perpendicularity: 0.001 rad tilt over 50 mm -> zone = 2×50×tan(0.001) ≈ 0.1000', () => {
  const tiltRad = 0.001;
  const length = 50;
  const axis = [Math.sin(tiltRad), 0, Math.cos(tiltRad)];
  const datumNormal = [0, 0, 1];

  const result = evaluatePerpendicularity({ axisDirection: axis, datumNormal, length });
  closeTo(result.angleRad, tiltRad, 1e-12, 'axis angle from datum normal');
  const expectedZone = 2 * length * Math.tan(tiltRad);
  closeTo(result.zoneDiameter, expectedZone, 1e-12, 'zone vs closed form');
  closeTo(result.zoneDiameter, 0.1, 1e-6, 'perpendicularity zone ≈ 0.1000');
  console.log(`  perpendicularity zone measured = ${result.zoneDiameter} (expected ≈ 0.100000333)`);
});

test('Profile: sphere points offset radially +0.01 -> zone = 0.02', () => {
  const radius = 10;
  const offset = 0.01;
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [Math.SQRT1_2, Math.SQRT1_2, 0],
    [0, Math.SQRT1_2, -Math.SQRT1_2]
  ];
  const entries = dirs.map((d) => ({
    nominal: [d[0] * radius, d[1] * radius, d[2] * radius],
    measured: [d[0] * (radius + offset), d[1] * (radius + offset), d[2] * (radius + offset)]
  }));

  const result = evaluateProfile(entries);
  closeTo(result.profileZone, 0.02, 1e-12, 'profile zone');
  closeTo(result.maxDeviation, 0.01, 1e-12, 'max deviation');
  console.log(`  profile zone measured = ${result.profileZone} (expected 0.02)`);
});

test('Cylindricity: radius 10 with radial variation ±0.005 -> zone ≈ 0.010', () => {
  const radius = 10;
  const variation = 0.005;
  const points = [];
  const nTheta = 24;
  const nZ = 5;
  for (let i = 0; i < nTheta; i++) {
    const theta = (i * 2 * Math.PI) / nTheta;
    const r = radius + variation * Math.sin(3 * theta);
    for (let k = 0; k < nZ; k++) {
      const z = k * 2;
      points.push([r * Math.cos(theta), r * Math.sin(theta), z]);
    }
  }
  const result = evaluateCylindricity(points);
  closeTo(result.cylindricity, 0.01, 0.001, `cylindricity (10% of 0.010) — method: ${result.method}`);
  console.log(`  cylindricity measured = ${result.cylindricity} (expected ≈ 0.010 ± 0.001)`);
});

test('Invalid FCF rejected: unknown characteristic, negative value', () => {
  assert.throws(() => FeatureControlFrame.parse('SQUARENESS 0.1'), /Unknown geometric characteristic/);
  assert.throws(() => FeatureControlFrame.parse('⌀-0.1(A)'), /expected tolerance value|negative/);
  assert.throws(() => FeatureControlFrame.parse('0.1|A|B|C|D'), /at most three/);
  assert.throws(() => FeatureControlFrame.parse('0.1|'), /invalid datum|tolerance value/);
});

test('ASME Y14.5-2018 verification: MMC on non-size feature warned; datum precedence gap warned; valid size-position clean', () => {
  const surfaceFcf = FeatureControlFrame.parse('POSITION ⌀0.1M(A)');
  const surfaceValidation = validateFeatureControlFrame(surfaceFcf, { featureType: 'surface' });
  assert.equal(surfaceValidation.valid, false);
  assert.ok(
    surfaceValidation.warnings.some((w) => w.includes('only applicable to size features')),
    `warnings: ${surfaceValidation.warnings}`
  );

  const gapFcf = new FeatureControlFrame({
    characteristic: 'POSITION',
    tolerance: 0.1,
    datums: [null, { name: 'B', modifier: null }]
  });
  const gapValidation = validateFeatureControlFrame(gapFcf, { featureType: 'size' });
  assert.equal(gapValidation.valid, false);
  assert.ok(gapValidation.warnings.some((w) => w.includes('precedence gap')));

  const sizeFcf = FeatureControlFrame.parse('POSITION ⌀0.1M(A)(B)(C)');
  const sizeValidation = validateFeatureControlFrame(sizeFcf, { featureType: 'size' });
  assert.equal(sizeValidation.valid, true);
  assert.deepEqual(sizeValidation.warnings, []);
});
