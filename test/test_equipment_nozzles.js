/**
 * test/test_equipment_nozzles.js
 * Verification gate for the 3D equipment nozzle orientation / flange-rating
 * alignment checker (src/core/plant/equipment_nozzle_manager.js).
 *
 * Deterministic: fixed inputs, no randomness, no time dependence.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  EquipmentNozzleManager,
  FLANGE_CLASSES,
  RATING_TEMPERATURES_F,
  FLANGE_RATING_PSIG,
  DEFAULT_TOLERANCES
} = require('../src/core/plant/equipment_nozzle_manager');

const TOL = 1e-9;

function makeEquipment(overrides) {
  return {
    tag: 'P-101',
    nozzles: [
      {
        tag: 'N1',
        x: 1000,
        y: 2000,
        z: 5000,
        azimuth: 90,
        flangeClass: 300,
        flangeType: 'WN-RF',
        sizeNPS: 6,
        orientation: 'horizontal',
        connectedLine: 'LINE-101'
      }
    ],
    ...overrides
  };
}

function makeLine(overrides) {
  return {
    lineTag: 'LINE-101',
    startX: 1000,
    startY: 2000,
    startZ: 5000,
    endX: 900,
    endY: 2000,
    endZ: 5500,
    flangeClass: 300,
    sizeNPS: 6,
    designPressure: 400,
    designTemperature: 300,
    ...overrides
  };
}

function lineAtBearing(nozzle, bearingDeg, connRadius = 30, runLength = 300) {
  const radians = (bearingDeg * Math.PI) / 180;
  const cx = nozzle.x + connRadius * Math.sin(radians);
  const cy = nozzle.y + connRadius * Math.cos(radians);
  return {
    startX: cx,
    startY: cy,
    startZ: nozzle.z,
    endX: cx - runLength * Math.sin(radians),
    endY: cy - runLength * Math.cos(radians),
    endZ: nozzle.z
  };
}

test('correct connection passes all checks with no flags', () => {
  const equipment = makeEquipment();
  const line = makeLine();
  const result = EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line });

  assert.strictEqual(result.pass, true);
  assert.deepStrictEqual(result.flags, []);
  assert.strictEqual(result.equipmentTag, 'P-101');
  assert.strictEqual(result.nozzleTag, 'N1');
  assert.strictEqual(result.lineTag, 'LINE-101');
  assert.strictEqual(result.connectionEnd, 'start');

  for (const [name, check] of Object.entries(result.checks)) {
    assert.strictEqual(check.pass, true, `${name} must pass`);
  }
});

test('elevation mismatch beyond tolerance is flagged', () => {
  const equipment = makeEquipment();
  const line = makeLine({ startZ: 5000 + 30 });
  const result = EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line });

  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.checks.elevation.pass, false);
  assert.strictEqual(result.checks.elevation.deltaMm, -30);
  assert.strictEqual(result.checks.elevation.toleranceMm, DEFAULT_TOLERANCES.elevationMm);
  assert.ok(result.flags.some((flag) => flag.startsWith('elevation mismatch:')));
});

test('elevation within tolerance passes', () => {
  const equipment = makeEquipment();
  const line = makeLine({ startZ: 5000 + 25 });
  const result = EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line });

  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.checks.elevation.pass, true);
});

test('coordinate mismatch beyond horizontal tolerance is flagged', () => {
  const equipment = makeEquipment();
  const line = makeLine({ startX: 1000 + 60 });
  const result = EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line });

  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.checks.coordinate.pass, false);
  assert.strictEqual(result.checks.coordinate.distanceMm, 60);
  assert.strictEqual(result.checks.coordinate.toleranceMm, DEFAULT_TOLERANCES.horizontalMm);
  assert.ok(result.flags.some((flag) => flag.startsWith('coordinate mismatch:')));
});

test('flange class mismatch is flagged with the exact reason', () => {
  const equipment = makeEquipment();
  const line = makeLine({ flangeClass: 150 });
  const result = EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line });

  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.checks.flangeRating.pass, false);
  assert.strictEqual(result.checks.flangeRating.lineClass, 150);
  assert.strictEqual(result.checks.flangeRating.nozzleClass, 300);
  assert.ok(result.flags.includes('flange rating mismatch: line Class 150 vs nozzle Class 300'));
});

test('NPS mismatch is flagged', () => {
  const equipment = makeEquipment();
  const line = makeLine({ sizeNPS: 8 });
  const result = EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line });

  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.checks.size.pass, false);
  assert.strictEqual(result.checks.size.lineNPS, 8);
  assert.strictEqual(result.checks.size.nozzleNPS, 6);
  assert.ok(result.flags.some((flag) => flag.startsWith('size mismatch:')));
});

test('azimuth deviation beyond 10° is flagged (horizontal nozzle)', () => {
  const equipment = makeEquipment();
  const line = makeLine(lineAtBearing(equipment.nozzles[0], 120));
  const result = EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line });

  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.checks.azimuth.pass, false);
  assert.strictEqual(result.checks.azimuth.nozzleAzimuthDeg, 90);
  assert.strictEqual(result.checks.azimuth.expectedApproachAzimuthDeg, 90);
  assert.ok(result.checks.azimuth.deltaDeg > 10);
  assert.ok(result.flags.some((flag) => flag.startsWith('azimuth deviation:')));
});

test('azimuth within tolerance passes (horizontal nozzle)', () => {
  const equipment = makeEquipment();
  const line = makeLine(lineAtBearing(equipment.nozzles[0], 95));
  const result = EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line });

  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.checks.azimuth.pass, true);
  assert.ok(result.checks.azimuth.deltaDeg <= 10);
});

test('vertical nozzle uses the complement azimuth', () => {
  const equipment = makeEquipment({
    nozzles: [
      {
        tag: 'N1',
        x: 1000,
        y: 2000,
        z: 5000,
        azimuth: 90,
        flangeClass: 300,
        flangeType: 'WN-RF',
        sizeNPS: 6,
        orientation: 'vertical',
        connectedLine: 'LINE-101'
      }
    ]
  });
  const complementLine = makeLine(lineAtBearing(equipment.nozzles[0], 270));
  const complementResult = EquipmentNozzleManager.evaluateConnection({
    equipment,
    nozzleTag: 'N1',
    line: complementLine
  });

  assert.strictEqual(complementResult.pass, true);
  assert.strictEqual(complementResult.checks.azimuth.expectedApproachAzimuthDeg, 270);
  assert.strictEqual(complementResult.checks.azimuth.pass, true);

  const sameDirLine = makeLine(lineAtBearing(equipment.nozzles[0], 90));
  const sameDirResult = EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line: sameDirLine });

  assert.strictEqual(sameDirResult.pass, false);
  assert.strictEqual(sameDirResult.checks.azimuth.pass, false);
  assert.ok(sameDirResult.checks.azimuth.deltaDeg > 10);
});

test('design pressure above flange rating at design temperature is flagged', () => {
  const equipment = makeEquipment();
  const line = makeLine({ designPressure: 700, designTemperature: 300 });
  const result = EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line });

  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.checks.designPressure.pass, false);
  assert.strictEqual(result.checks.designPressure.designPressurePsig, 700);
  assert.strictEqual(result.checks.designPressure.ratingPsig, 675);
  assert.strictEqual(result.checks.designPressure.designTemperatureF, 300);
  assert.ok(
    result.flags.some((flag) => flag.startsWith('design pressure 700 psig exceeds Class 300 rating 675 psig at 300°F'))
  );
});

test('design pressure below flange rating at design temperature passes', () => {
  const equipment = makeEquipment();
  const line = makeLine({ designPressure: 674, designTemperature: 300 });
  const result = EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line });

  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.checks.designPressure.pass, true);
  assert.strictEqual(result.checks.designPressure.ratingPsig, 675);
});

test('flange rating interpolates linearly between tabulated temperatures', () => {
  const class300 = FLANGE_RATING_PSIG[300];
  assert.strictEqual(EquipmentNozzleManager.flangeRatingPsi(300, 100), class300[0]);
  assert.strictEqual(EquipmentNozzleManager.flangeRatingPsi(300, 300), class300[1]);
  assert.strictEqual(EquipmentNozzleManager.flangeRatingPsi(300, 500), class300[2]);
  assert.strictEqual(EquipmentNozzleManager.flangeRatingPsi(300, 750), class300[3]);
  assert.ok(Math.abs(EquipmentNozzleManager.flangeRatingPsi(300, 200) - (class300[0] + class300[1]) / 2) < TOL);
  assert.strictEqual(EquipmentNozzleManager.flangeRatingPsi(300, 50), class300[0]);
  assert.strictEqual(EquipmentNozzleManager.flangeRatingPsi(300, 1000), class300[3]);
});

test('rating table integrity: ratings monotonic non-increasing with temperature and increasing with class', () => {
  for (const classKey of FLANGE_CLASSES) {
    const ratings = FLANGE_RATING_PSIG[classKey];
    assert.ok(ratings, `missing rating row for Class ${classKey}`);
    assert.strictEqual(ratings.length, RATING_TEMPERATURES_F.length);
    for (let i = 0; i < ratings.length; i += 1) {
      assert.ok(
        Number.isFinite(ratings[i]),
        `Class ${classKey} rating at ${RATING_TEMPERATURES_F[i]}°F must be finite`
      );
      assert.ok(ratings[i] > 0, `Class ${classKey} rating at ${RATING_TEMPERATURES_F[i]}°F must be positive`);
      if (i > 0) {
        assert.ok(
          ratings[i] <= ratings[i - 1],
          `Class ${classKey} ratings must be monotonic non-increasing with temperature`
        );
      }
    }
  }

  for (let t = 0; t < RATING_TEMPERATURES_F.length; t += 1) {
    for (let c = 1; c < FLANGE_CLASSES.length; c += 1) {
      const lower = FLANGE_RATING_PSIG[FLANGE_CLASSES[c - 1]][t];
      const higher = FLANGE_RATING_PSIG[FLANGE_CLASSES[c]][t];
      assert.ok(higher > lower, `ratings must strictly increase with class at ${RATING_TEMPERATURES_F[t]}°F`);
    }
  }
});

test('fail-closed: malformed equipment records throw', () => {
  assert.throws(() => EquipmentNozzleManager.validateEquipment(null), /must be an object/);
  assert.throws(() => EquipmentNozzleManager.validateEquipment({}), /non-empty tag/);
  assert.throws(() => EquipmentNozzleManager.validateEquipment({ tag: 'X', nozzles: [] }), /at least one nozzle/);

  const badNozzle = makeEquipment({
    nozzles: [{ ...makeEquipment().nozzles[0], flangeClass: 999 }]
  });
  assert.throws(() => EquipmentNozzleManager.validateEquipment(badNozzle), /flangeClass/);

  const nonFiniteNozzle = makeEquipment({
    nozzles: [{ ...makeEquipment().nozzles[0], x: 'abc' }]
  });
  assert.throws(() => EquipmentNozzleManager.validateEquipment(nonFiniteNozzle), /x must be a finite number/);

  const badOrientation = makeEquipment({
    nozzles: [{ ...makeEquipment().nozzles[0], orientation: 'diagonal' }]
  });
  assert.throws(() => EquipmentNozzleManager.validateEquipment(badOrientation), /orientation/);
});

test('fail-closed: malformed connected-piping records throw', () => {
  assert.throws(() => EquipmentNozzleManager.validateConnectedPiping(null), /must be an object/);
  assert.throws(() => EquipmentNozzleManager.validateConnectedPiping({}), /non-empty lineTag/);
  assert.throws(() => EquipmentNozzleManager.validateConnectedPiping(makeLine({ flangeClass: 1200 })), /flangeClass/);
  assert.throws(
    () => EquipmentNozzleManager.validateConnectedPiping(makeLine({ startX: NaN })),
    /startX must be a finite number/
  );
  assert.throws(() => EquipmentNozzleManager.validateConnectedPiping(makeLine({ sizeNPS: 0 })), /sizeNPS/);
  assert.throws(
    () => EquipmentNozzleManager.validateConnectedPiping(makeLine({ designPressure: -5 })),
    /designPressure/
  );
  assert.throws(() => EquipmentNozzleManager.validateConnectedPiping(makeLine({ connectEnd: 'middle' })), /connectEnd/);
});

test('fail-closed: evaluateConnection rejects mismatched pairing and unknown nozzles', () => {
  const equipment = makeEquipment();
  const line = makeLine({ connectedNozzleTag: 'N9' });
  assert.throws(
    () => EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line }),
    /connectedNozzleTag/
  );

  const unpairedLine = makeLine({ lineTag: 'LINE-999' });
  assert.throws(
    () => EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line: unpairedLine }),
    /connectedLine/
  );

  assert.throws(
    () => EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'NOPE', line: makeLine() }),
    /has no nozzle/
  );
});

test('fail-closed: a line with no horizontal extent cannot claim an azimuth pass', () => {
  const equipment = makeEquipment();
  const degenerate = makeLine({ startX: 1000, startY: 2000, endX: 1000, endY: 2000 });
  const result = EquipmentNozzleManager.evaluateConnection({ equipment, nozzleTag: 'N1', line: degenerate });

  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.checks.azimuth.pass, false);
  assert.strictEqual(result.checks.azimuth.actualApproachAzimuthDeg, null);
  assert.ok(result.flags.some((flag) => flag.startsWith('undefined approach azimuth:')));
});

test('custom tolerances override the defaults', () => {
  const equipment = makeEquipment();
  const line = makeLine({ startZ: 5000 + 30 });
  const strict = EquipmentNozzleManager.evaluateConnection({
    equipment,
    nozzleTag: 'N1',
    line,
    tolerances: { elevationMm: 40 }
  });
  assert.strictEqual(strict.pass, true);
  assert.strictEqual(strict.tolerances.elevationMm, 40);
  assert.strictEqual(strict.tolerances.horizontalMm, DEFAULT_TOLERANCES.horizontalMm);
});
