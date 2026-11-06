/**
 * Test Suite: FastenerCatalog (ISO metric threads, ISO 4762 SHCS, ISO 273
 * clearance holes, ISO 4762 counterbores, ANSI B18.2 UNC/UNF, engagement rules).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getMetricThread,
  getShcs,
  getAnsiInchThread,
  clearanceHole,
  tapDrillHole,
  counterboreHole,
  countersinkHole,
  minimumEngagementMm,
  geometricMinimumEngagementMm,
  checkThreadEngagement,
  verifyCatalogIntegrity
} = require('../src/core/cad/fastener_catalog');

test('M10x1.5 coarse thread: ISO basic profile values', () => {
  const thread = getMetricThread('M10');
  assert.equal(thread.designation, 'M10');
  assert.equal(thread.pitchMm, 1.5);
  assert.equal(thread.nominalDiameterMm, 10);
  assert.equal(thread.tapDrillMm, 8.5);
  assert.ok(
    Math.abs(thread.minorDiameterMm - 8.376) < 0.001,
    `tapped-hole minor diameter D1 = d - 1.0825*P = 8.376 mm, got ${thread.minorDiameterMm}`
  );
  assert.ok(
    Math.abs(thread.pitchDiameterMm - 9.026) < 0.001,
    `pitch diameter d2 = d - 0.6495*P, got ${thread.pitchDiameterMm}`
  );
  assert.ok(
    Math.abs(thread.externalMinorDiameterMm - (10 - 1.226869 * 1.5)) < 1e-9,
    'external (screw) minor d3 = d - 1.226869*P'
  );
});

test('ISO 4762 M10x1.5 SHCS: head 16, k 10, socket 8', () => {
  const shcs = getShcs('M10');
  assert.equal(shcs.headDiameterMm, 16);
  assert.equal(shcs.headHeightMm, 10);
  assert.equal(shcs.socketSizeMm, 8);
});

test('Counterbore for M10 SHCS: Ø17 x depth 11 (ISO 4762 table)', () => {
  const counterbore = counterboreHole('M10');
  assert.equal(counterbore.diameterMm, 17);
  assert.equal(counterbore.depthMm, 11);
  const shcs = getShcs('M10');
  const medium = clearanceHole('M10', 'medium');
  assert.equal(counterbore.diameterMm, shcs.headDiameterMm + (medium.diameterMm - 10));
  assert.ok(counterbore.depthMm >= shcs.headHeightMm + 0.5 * 1.5);
});

test('ISO 273 clearance holes: M10 fine/medium/coarse', () => {
  assert.equal(clearanceHole('M10', 'fine').diameterMm, 10.5);
  assert.equal(clearanceHole('M10', 'medium').diameterMm, 11);
  assert.equal(clearanceHole('M10', 'coarse').diameterMm, 12);
  assert.equal(clearanceHole('M10').diameterMm, 11);
});

test('Tap drill hole for M10: 8.5 mm', () => {
  const hole = tapDrillHole('M10');
  assert.equal(hole.diameterMm, 8.5);
  assert.ok(Math.abs(hole.minorDiameterMm - 8.376) < 0.001);
});

test('Countersink for M10 SHCS: 90° included angle', () => {
  const sink = countersinkHole('M10');
  assert.equal(sink.includedAngleDeg, 90);
  assert.equal(sink.diameterMm, 17);
  assert.equal(sink.coneDepthMm, 8.5);
});

test('Thread engagement rules: steel 1.0d, aluminum 1.5d, cast iron 2.0d', () => {
  assert.equal(minimumEngagementMm('M10', 'steel').engagementMm, 10);
  assert.equal(minimumEngagementMm('M10', 'aluminum').engagementMm, 15);
  assert.equal(minimumEngagementMm('M10', 'castIron').engagementMm, 20);
  assert.equal(checkThreadEngagement('M10', 10, 'steel').ok, true);
  assert.equal(checkThreadEngagement('M10', 9.9, 'steel').ok, false);
  assert.equal(checkThreadEngagement('M10', 15, 'aluminum').ok, true);
  assert.equal(checkThreadEngagement('M10', 14, 'aluminum').ok, false);
});

test('Geometric minimum engagement (2At/(pi*d*0.5)) is documented and < rule', () => {
  const geometric = geometricMinimumEngagementMm('M10');
  const expectedAt = (Math.PI / 4) * (10 - 0.9382 * 1.5) ** 2;
  assert.ok(Math.abs(geometric.tensileStressAreaMm2 - expectedAt) < 1e-9);
  const expectedLe = (2 * expectedAt) / (Math.PI * 10 * 0.5);
  assert.ok(Math.abs(geometric.leMinMm - expectedLe) < 1e-9);
  assert.ok(geometric.leMinMm < 10);
});

test('ANSI B18.2 1/4-20 UNC: major Ø6.35 mm, tap drill #7/0.201 in', () => {
  const thread = getAnsiInchThread('1/4-20 UNC');
  assert.equal(thread.nominalDiameterInch, 0.25);
  assert.equal(thread.majorDiameterMm, 6.35);
  assert.equal(thread.threadsPerInch, 20);
  assert.equal(thread.tapDrill.number, '#7');
  assert.equal(thread.tapDrill.inch, 0.201);
  assert.ok(Math.abs(thread.tapDrill.mm - 5.1054) < 1e-9);
  assert.ok(Math.abs(thread.tapDrill.mm - 5.1) < 0.01);
});

test('ANSI B18.2 3/8-16 and 1/2-13 UNC basics', () => {
  const threeEighths = getAnsiInchThread('3/8-16 UNC');
  assert.equal(threeEighths.majorDiameterMm, 9.525);
  assert.equal(threeEighths.threadsPerInch, 16);
  assert.equal(threeEighths.tapDrill.number, 'U');
  const half = getAnsiInchThread('1/2-13 UNC');
  assert.equal(half.majorDiameterMm, 12.7);
  assert.equal(half.threadsPerInch, 13);
  assert.equal(half.tapDrill.number, '27/64');
  assert.ok(Math.abs(half.tapDrill.mm - 10.715625) < 1e-9);
});

test('Full catalog is finite and monotonic (no NaN, head grows with d)', () => {
  const report = verifyCatalogIntegrity();
  assert.equal(report.ok, true, report.reason);
  for (const size of ['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M16', 'M20', 'M24']) {
    const thread = getMetricThread(size);
    const shcs = getShcs(size);
    assert.ok(Number.isFinite(thread.pitchMm));
    assert.ok(Number.isFinite(thread.nominalDiameterMm));
    assert.ok(Number.isFinite(thread.tapDrillMm));
    assert.ok(Number.isFinite(thread.minorDiameterMm));
    assert.ok(Number.isFinite(shcs.headDiameterMm));
    assert.ok(Number.isFinite(shcs.headHeightMm));
    assert.ok(Number.isFinite(shcs.socketSizeMm));
    assert.ok(thread.minorDiameterMm < thread.pitchDiameterMm);
    assert.ok(thread.pitchDiameterMm < thread.nominalDiameterMm);
    assert.ok(shcs.headDiameterMm > thread.nominalDiameterMm);
  }
  const sizes = ['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M16', 'M20', 'M24'];
  const headDiameters = sizes.map((size) => getShcs(size).headDiameterMm);
  const tapDrills = sizes.map((size) => getMetricThread(size).tapDrillMm);
  const pitches = sizes.map((size) => getMetricThread(size).pitchMm);
  for (let i = 1; i < sizes.length; i += 1) {
    assert.ok(headDiameters[i] > headDiameters[i - 1], 'head diameter must grow with size');
    assert.ok(tapDrills[i] > tapDrills[i - 1], 'tap drill must grow with size');
    assert.ok(pitches[i] > pitches[i - 1], 'pitch must grow with size');
  }
});
