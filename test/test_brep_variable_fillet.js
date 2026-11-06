/**
 * Test Suite: BRepVariableFillet (Rolling-Ball, Weight w1, Variable Radius, Setback Corner)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BRepVariableFillet } = require('../src/core/cad/brep_variable_fillet');

test('BRepVariableFillet: Evaluates 90-degree orthogonal rolling-ball section exactly', () => {
  const filleting = new BRepVariableFillet();
  const pEdge = [0.0, 0.0, 10.0];
  const n1 = [1.0, 0.0, 0.0]; // Face 1 normal
  const n2 = [0.0, 1.0, 0.0]; // Face 2 normal
  const R = 5.0;

  const res = filleting.evaluateFilletSection(pEdge, n1, n2, R);

  // Dihedral angle = pi / 2
  assert.ok(Math.abs(res.phiRad - Math.PI / 2) < 1e-12, 'Angle must be pi/2');

  // Arc weight w1 = cos(pi / 4) = 1 / sqrt(2) = 0.70710678...
  const expectedW1 = Math.cos(Math.PI / 4);
  assert.ok(Math.abs(res.weightW1 - expectedW1) < 1e-12, 'Weight w1 must equal cos(phi/2)');

  // Contact points: pEdge + R*n2 for Face 1 contact and pEdge + R*n1 for Face 2 contact
  assert.ok(Math.abs(res.contactPoint1[0] - 0.0) < 1e-12);
  assert.ok(Math.abs(res.contactPoint1[1] - 5.0) < 1e-12);
  assert.ok(Math.abs(res.contactPoint2[0] - 5.0) < 1e-12);
  assert.ok(Math.abs(res.contactPoint2[1] - 0.0) < 1e-12);
});

test('BRepVariableFillet: Samples variable-radius blend from 2mm to 8mm along straight edge', () => {
  const filleting = new BRepVariableFillet();
  const pStart = [0, 0, 0];
  const pEnd = [0, 0, 100];
  const n1 = [1, 0, 0];
  const n2 = [0, 1, 0];

  const sections = filleting.sampleVariableFillet(pStart, pEnd, n1, n2, 2.0, 8.0, 10);
  assert.equal(sections.length, 11, 'Must have 11 sampled stations');
  assert.equal(sections[0].radius, 2.0, 'Start radius must be 2.0');
  assert.equal(sections[10].radius, 8.0, 'End radius must be 8.0');
  assert.equal(sections[5].radius, 5.0, 'Midpoint radius must be 5.0');
});

test('BRepVariableFillet: Calculates 3-edge setback corner vertices', () => {
  const filleting = new BRepVariableFillet();
  const corner = [0.0, 0.0, 0.0];
  const edgeDirs = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0]
  ];
  const setback = 10.0;

  const pts = filleting.computeSetbackCorner(corner, setback, edgeDirs);
  assert.equal(pts.length, 3, 'Must return 3 setback vertices');
  assert.deepEqual(pts[0], [10, 0, 0]);
  assert.deepEqual(pts[1], [0, 10, 0]);
  assert.deepEqual(pts[2], [0, 0, 10]);
});

test('BRepVariableFillet: Rejects degenerate parallel / opposite face normals', () => {
  const filleting = new BRepVariableFillet();
  const pEdge = [0, 0, 0];
  // Opposite normals (phi = pi)
  assert.throws(() => filleting.evaluateFilletSection(pEdge, [1, 0, 0], [-1, 0, 0], 5), /approaches pi/);
});
