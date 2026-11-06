/**
 * Test Suite: BRepAdvancedSurfaces (Class-A differential geometry, G0-G2 continuity, Parallel Transport)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BRepAdvancedSurfaces } = require('../src/core/cad/brep_advanced_surfaces');

test('BRepAdvancedSurfaces: Evaluates bicubic patch curvatures and normals accurately', () => {
  const engine = new BRepAdvancedSurfaces();

  // Planar patch: z = 0 for all points
  const flatPatch = [];
  for (let i = 0; i < 4; i++) {
    const row = [];
    for (let j = 0; j < 4; j++) {
      row.push([i / 3.0, j / 3.0, 0.0]);
    }
    flatPatch.push(row);
  }

  const evalCenter = engine.evaluateBicubicPatch(flatPatch, 0.5, 0.5);
  assert.ok(Math.abs(evalCenter.point[0] - 0.5) < 1e-12, 'Center x must be 0.5');
  assert.ok(Math.abs(evalCenter.point[1] - 0.5) < 1e-12, 'Center y must be 0.5');
  assert.ok(Math.abs(evalCenter.point[2] - 0.0) < 1e-12, 'Center z must be 0.0');

  // Normal should be [0, 0, 1]
  assert.ok(Math.abs(evalCenter.normal[0]) < 1e-12, 'Normal x should be 0');
  assert.ok(Math.abs(evalCenter.normal[1]) < 1e-12, 'Normal y should be 0');
  assert.ok(Math.abs(evalCenter.normal[2] - 1.0) < 1e-12, 'Normal z should be 1');

  // Curvatures on flat plane should be 0
  assert.ok(Math.abs(evalCenter.K) < 1e-12, 'Gaussian curvature on flat plane must be 0');
  assert.ok(Math.abs(evalCenter.H) < 1e-12, 'Mean curvature on flat plane must be 0');
});

test('BRepAdvancedSurfaces: Verifies G0, G1, and G2 continuity across smooth boundary', () => {
  const engine = new BRepAdvancedSurfaces();

  // Create two adjacent flat patches: Patch A on [0, 1]x[0, 1], Patch B on [1, 2]x[0, 1]
  const patchA = [];
  const patchB = [];
  for (let i = 0; i < 4; i++) {
    const rowA = [];
    const rowB = [];
    for (let j = 0; j < 4; j++) {
      rowA.push([i / 3.0, j / 3.0, 0.0]);
      rowB.push([1.0 + i / 3.0, j / 3.0, 0.0]);
    }
    patchA.push(rowA);
    patchB.push(rowB);
  }

  const continuity = engine.checkContinuityAlongBoundary(patchA, patchB, 10);
  assert.equal(continuity.isG0, true, 'Boundary must be G0 continuous (max deviation = 0)');
  assert.equal(continuity.isG1, true, 'Boundary must be G1 continuous (collinear normals)');
  assert.equal(continuity.isG2, true, 'Boundary must be G2 continuous (matched curvatures)');
  assert.ok(continuity.g0MaxDeviation < 1e-12, 'G0 deviation must be zero');
  assert.ok(continuity.g1MaxAngleDeg < 1e-12, 'G1 normal angle must be zero');
});

test('BRepAdvancedSurfaces: Computes orthonormal Parallel Transport frames along 3D space curve', () => {
  const engine = new BRepAdvancedSurfaces();
  // 3D helical arc points
  const points = [];
  for (let k = 0; k <= 10; k++) {
    const t = (k / 10) * Math.PI;
    points.push([Math.cos(t), Math.sin(t), t * 0.2]);
  }

  const frames = engine.computeParallelTransportFrames(points);
  assert.equal(frames.length, points.length, 'Every point must have an associated frame');

  for (const f of frames) {
    const { tangent, normal, binormal } = f;
    // Orthonormality check
    const dotTN = tangent[0]*normal[0] + tangent[1]*normal[1] + tangent[2]*normal[2];
    const dotTB = tangent[0]*binormal[0] + tangent[1]*binormal[1] + tangent[2]*binormal[2];
    const dotNB = normal[0]*binormal[0] + normal[1]*binormal[1] + normal[2]*binormal[2];

    assert.ok(Math.abs(dotTN) < 1e-6, 'Tangent and Normal must be orthogonal');
    assert.ok(Math.abs(dotTB) < 1e-6, 'Tangent and Binormal must be orthogonal');
    assert.ok(Math.abs(dotNB) < 1e-6, 'Normal and Binormal must be orthogonal');
  }
});
