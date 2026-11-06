'use strict';

const { test } = require('node:test');
const assert = require('assert');
const {
  SheetMetalEngine,
  SheetMetalBend,
  kFactorFromRatio,
  DIN6935_K_FACTORS,
  outlineIsSimple
} = require('../src/core/cad/sheet_metal_engine');

const TOL_K = 0.01;
const TOL_MM = 0.01;

function degToRad(deg) {
  return (deg * Math.PI) / 180.0;
}

function analyticBendAllowance(angleDeg, R, T, k) {
  return degToRad(angleDeg) * (R + k * T);
}

function analyticBendDeduction(angleDeg, R, T, k) {
  return 2.0 * (R + T) * Math.tan(degToRad(angleDeg) / 2.0) - analyticBendAllowance(angleDeg, R, T, k);
}

function makePart() {
  const T = 2.0;
  const R = 2.0;
  const W = 30.0;
  return {
    thicknessMm: T,
    flanges: [
      { name: 'F1', lengthMm: 40.0, widthMm: W },
      { name: 'F2', lengthMm: 20.0, widthMm: W },
      { name: 'F3', lengthMm: 40.0, widthMm: W },
      { name: 'F4', lengthMm: 20.0, widthMm: W },
      { name: 'F5', lengthMm: 40.0, widthMm: W }
    ],
    bends: [
      { angleDeg: 90.0, innerRadiusMm: R, direction: 'UP' },
      { angleDeg: 90.0, innerRadiusMm: R, direction: 'DOWN' },
      { angleDeg: 90.0, innerRadiusMm: R, direction: 'UP' },
      { angleDeg: 90.0, innerRadiusMm: R, direction: 'DOWN' }
    ]
  };
}

test('DIN 6935 k-factor table anchors', () => {
  const expected = { 0.5: 0.38, 1.0: 0.33, 2.0: 0.3 };
  for (const [rOverT, kExpected] of Object.entries(expected)) {
    const k = kFactorFromRatio(Number(rOverT));
    assert.ok(Math.abs(k - kExpected) <= TOL_K, `k(R/t=${rOverT}) = ${k}, expected ${kExpected} (±0.01)`);
  }
});

test('K-factor neutral axis: 90° bend, L = (R + k*T)*theta per DIN 6935', () => {
  const theta = degToRad(90.0);
  const T = 2.0;
  for (const [rOverT, kExpected] of DIN6935_K_FACTORS.map((e) => [e.rOverT, e.k])) {
    const R = rOverT * T;
    const bend = new SheetMetalBend({ angleDeg: 90.0, innerRadiusMm: R, thicknessMm: T });
    assert.ok(Math.abs(bend.kFactor - kExpected) <= TOL_K, `k(${rOverT}) = ${bend.kFactor}, expected ${kExpected}`);
    const analyticLength = theta * (R + kExpected * T);
    assert.ok(
      Math.abs(bend.bendAllowanceMm - analyticLength) <= TOL_MM,
      `neutral length R/t=${rOverT}: engine ${bend.bendAllowanceMm}, analytic ${analyticLength}`
    );
    assert.ok(Math.abs(bend.bendAngleRad - theta) <= 1e-12);
  }
});

test('Bend allowance vs bend deduction identity on 2-bend channel bracket', () => {
  const T = 2.0;
  const R = 2.0;
  const part = {
    thicknessMm: T,
    flanges: [
      { name: 'F1', lengthMm: 30.0, widthMm: 25.0 },
      { name: 'F2', lengthMm: 50.0, widthMm: 25.0 },
      { name: 'F3', lengthMm: 30.0, widthMm: 25.0 }
    ],
    bends: [
      { angleDeg: 90.0, innerRadiusMm: R, direction: 'UP' },
      { angleDeg: 90.0, innerRadiusMm: R, direction: 'UP' }
    ]
  };
  const flat = SheetMetalEngine.unfoldPart(part);
  assert.strictEqual(flat.success, true);
  assert.strictEqual(flat.flangesCount, 3);
  assert.strictEqual(flat.bendsCount, 2);

  const flangeSum = part.flanges.reduce((s, f) => s + f.lengthMm, 0);
  let baSum = 0;
  let bdSum = 0;
  for (const bl of flat.bendLines) {
    const k = bl.kFactor;
    const baExp = analyticBendAllowance(bl.angleDeg, R, T, k);
    const bdExp = analyticBendDeduction(bl.angleDeg, R, T, k);
    assert.ok(
      Math.abs(bl.bendAllowanceMm - baExp) <= TOL_MM,
      `BA bend ${bl.bendIndex}: ${bl.bendAllowanceMm} vs ${baExp}`
    );
    assert.ok(
      Math.abs(bl.bendDeductionMm - bdExp) <= TOL_MM,
      `BD bend ${bl.bendIndex}: ${bl.bendDeductionMm} vs ${bdExp}`
    );
    assert.ok(Math.abs(bl.bendDeductionMm - (2.0 * bl.outsideSetbackMm - bl.bendAllowanceMm)) <= 1e-9);
    baSum += bl.bendAllowanceMm;
    bdSum += bl.bendDeductionMm;
  }

  assert.ok(
    Math.abs(flat.totalDevelopedLengthMm - (flangeSum + baSum)) <= TOL_MM,
    `L_flat ${flat.totalDevelopedLengthMm} vs Σflange ${flangeSum} + ΣBA ${baSum}`
  );
  assert.ok(baSum > bdSum, 'BA must exceed BD for 90° bends with R/t=1');
});

test('Flat pattern of 4-bend box side: perimeter analytic + simple polygon', () => {
  const part = makePart();
  const flat = SheetMetalEngine.unfoldPart(part);
  assert.strictEqual(flat.success, true);
  assert.strictEqual(flat.bendsCount, 4);
  assert.strictEqual(flat.reliefType, 'none');

  const flangeSum = part.flanges.reduce((s, f) => s + f.lengthMm, 0);
  const baSum = flat.bendLines.reduce((s, b) => s + b.bendAllowanceMm, 0);
  const analyticPerimeter = 2.0 * (flangeSum + baSum + flat.widthMm);
  assert.ok(
    Math.abs(flat.perimeterMm - analyticPerimeter) <= TOL_MM,
    `perimeter ${flat.perimeterMm} vs analytic ${analyticPerimeter}`
  );
  assert.ok(Math.abs(flat.perimeterMm - flat.perimeterAnalyticMm) <= TOL_MM);

  assert.ok(flat.outline.length >= 4);
  assert.ok(flat.outlineSignedAreaMm2 > 0, `signed area must be positive (CCW), got ${flat.outlineSignedAreaMm2}`);
  assert.ok(flat.outlineIsSimple, 'outline must not self-overlap');
  assert.ok(outlineIsSimple(flat.outline));

  for (const p of flat.outline) {
    assert.ok(p.x >= -1e-9 && p.x <= flat.totalDevelopedLengthMm + 1e-9, `vertex x ${p.x} out of strip range`);
    assert.ok(p.y >= -1e-9 && p.y <= flat.widthMm + 1e-9, `vertex y ${p.y} out of width range`);
  }
});

test('Corner relief: tear/rectangular/round notches exist and stay out of bend zone', () => {
  const part = makePart();
  const baseline = SheetMetalEngine.unfoldPart({ ...part, reliefType: 'none' });
  for (const reliefType of ['tear', 'rectangular', 'round']) {
    const flat = SheetMetalEngine.unfoldPart({ ...part, reliefType, reliefWidthMm: 2.5, reliefDepthMm: 3.0 });
    assert.ok(
      flat.outline.length > baseline.outline.length,
      `${reliefType}: outline should gain vertices (${baseline.outline.length} -> ${flat.outline.length})`
    );
    assert.strictEqual(flat.reliefs.length, 2 * flat.bendsCount);
    assert.ok(flat.outlineIsSimple, `${reliefType} outline must stay simple`);

    for (const relief of flat.reliefs) {
      assert.strictEqual(relief.type, reliefType);
      const band = relief.band;
      let minX = Infinity;
      let maxX = -Infinity;
      let maxAbsY = 0;
      for (const p of relief.polygon) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        const y = relief.side === 'top' ? flat.widthMm - p.y : p.y;
        maxAbsY = Math.max(maxAbsY, y);
      }
      assert.ok(minX >= band.startX - 1e-9, `relief x-min ${minX} outside band start ${band.startX}`);
      assert.ok(maxX <= band.endX + 1e-9, `relief x-max ${maxX} outside band end ${band.endX}`);
      assert.ok(maxAbsY <= relief.depthMm + 1e-9, `relief depth ${maxAbsY} exceeds margin ${relief.depthMm}`);
      assert.ok(relief.widthMm > 0 && relief.depthMm > 0);
    }
  }
});

test('DXF export: HEADER/ENTITIES/$ACADVER, LINE count matches flat pattern', () => {
  const part = makePart();
  const flat = SheetMetalEngine.unfoldPart(part);
  const dxf = SheetMetalEngine.dxfExport(flat, { layer: '0' });

  assert.ok(dxf.includes('HEADER'));
  assert.ok(dxf.includes('ENTITIES'));
  assert.ok(dxf.includes('$ACADVER'));
  assert.ok(dxf.includes('AC1015'));
  assert.ok(dxf.includes('LWPOLYLINE'));
  assert.ok(dxf.trimEnd().endsWith('EOF'));

  const lines = dxf.split('\n');
  let lineEntities = 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === 'LINE' && lines[i - 1].trim() === '0') {
      lineEntities++;
    }
  }
  assert.strictEqual(lineEntities, flat.edges.length);
  assert.strictEqual(flat.edges.length, flat.outline.length);

  let polylineVertices = 0;
  let inPolyline = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'LWPOLYLINE') {
      inPolyline = true;
    } else if (inPolyline && lines[i].trim() === '90') {
      polylineVertices = Number(lines[i + 1].trim());
      break;
    }
  }
  assert.strictEqual(polylineVertices, flat.outline.length);
});
