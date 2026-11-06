/**
 * Unit and Verification Tests for FiveAxisCAMEngine.
 *
 * Verifies:
 * 1. Constant Scallop Stepover formula:
 *    s = sqrt((8*R*h)/(1 + kappa*R))
 *    - Convex surface (kappa > 0): stepover is smaller than flat (s < s_flat).
 *    - Concave surface (kappa < 0): stepover is larger than flat (s > s_flat).
 * 2. Trochoidal milling engagement angle:
 *    theta_eng = arccos(1 - 2*ae/D)
 *    - For full slotting (ae = D): theta_eng = 180 deg (pi rad).
 *    - For 10% radial engagement (ae = 0.1*D): theta_eng = arccos(0.8) ~ 36.87 deg.
 * 3. Trochoidal continuous loop toolpath generation.
 * 4. 5-Axis RTCP Inverse Kinematics (Table-Table AC trunnion).
 * 5. ISO 6983 G-code generation with G43.4 RTCP activation.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { FiveAxisCAMEngine } = require('../src/core/cam/five_axis_cam_engine');

describe('FiveAxisCAMEngine: Constant Scallop, Trochoidal & 5-Axis RTCP', () => {
  const engine = new FiveAxisCAMEngine();

  it('calculates 3D constant scallop stepover with signed curvature correction', () => {
    const R = 5.0; // 10 mm ball end mill (R = 5 mm)
    const h = 0.005; // 5 micron scallop height

    // 1. Flat surface (kappa = 0)
    // s_flat = sqrt(8 * 5 * 0.005) = sqrt(0.2) = 0.4472 mm
    const flat = engine.calculateConstantScallopStepover({ toolRadiusMm: R, scallopHeightMm: h, normalCurvature: 0 });
    assert.ok(Math.abs(flat.stepoverMm - 0.4472) < 0.001, `Flat stepover ${flat.stepoverMm} expected 0.4472 mm`);

    // 2. Convex surface (kappa = +0.05 1/mm, radius = 20 mm)
    // denom = 1 + 0.05 * 5 = 1.25 -> s = sqrt(0.2 / 1.25) = sqrt(0.16) = 0.4000 mm
    const convex = engine.calculateConstantScallopStepover({ toolRadiusMm: R, scallopHeightMm: h, normalCurvature: 0.05 });
    assert.ok(Math.abs(convex.stepoverMm - 0.4000) < 0.001, `Convex stepover ${convex.stepoverMm} expected 0.4000 mm`);
    assert.ok(convex.stepoverMm < flat.stepoverMm, 'Convex stepover must be smaller than flat');

    // 3. Concave surface (kappa = -0.05 1/mm)
    // denom = 1 - 0.05 * 5 = 0.75 -> s = sqrt(0.2 / 0.75) = 0.5164 mm
    const concave = engine.calculateConstantScallopStepover({ toolRadiusMm: R, scallopHeightMm: h, normalCurvature: -0.05 });
    assert.ok(Math.abs(concave.stepoverMm - 0.5164) < 0.001, `Concave stepover ${concave.stepoverMm} expected 0.5164 mm`);
    assert.ok(concave.stepoverMm > flat.stepoverMm, 'Concave stepover must be larger than flat');
  });

  it('calculates exact trochoidal radial engagement angle and chip thinning', () => {
    const D = 12.0;

    // Full slotting (ae = D = 12 mm): theta_eng = arccos(1 - 2) = arccos(-1) = 180 deg
    const fullSlot = engine.calculateTrochoidalEngagement({ cutterDiameterMm: D, radialDepthMm: 12.0 });
    assert.ok(Math.abs(fullSlot.engagementAngleDeg - 180.0) < 0.01, `Engagement angle ${fullSlot.engagementAngleDeg} expected 180 deg`);
    assert.equal(fullSlot.chipThinningFactor, 1.0);

    // 10% radial engagement (ae = 1.2 mm): 1 - 2*(1.2/12) = 0.8 -> arccos(0.8) ~ 36.87 deg
    const troch = engine.calculateTrochoidalEngagement({
      cutterDiameterMm: D,
      radialDepthMm: 1.2,
      nominalFeedPerToothMm: 0.05,
      teethCount: 4,
      spindleRpm: 10000
    });
    assert.ok(Math.abs(troch.engagementAngleDeg - 36.87) < 0.05, `Engagement angle ${troch.engagementAngleDeg} expected 36.87 deg`);
    assert.ok(troch.chipThinningFactor > 2.0, `Chip thinning factor ${troch.chipThinningFactor} must exceed 2.0`);
    assert.ok(troch.actualFeedPerToothMm > troch.nominalFeedPerToothMm, 'Feed per tooth must be boosted');
  });

  it('generates 2D/3D trochoidal loop path', () => {
    const path = engine.generateTrochoidalPath({
      startPoint: [0, 0, -5],
      endPoint: [100, 0, -5],
      slotWidthMm: 20.0,
      cutterDiameterMm: 12.0,
      stepoverMm: 2.0
    });

    assert.ok(path.length > 50, `Must generate rich trochoidal loops (count: ${path.length})`);
    assert.equal(path[0].x, 0);
    assert.equal(path[path.length - 1].x, 100);
  });

  it('computes 5-axis Table-Table AC kinematics and generates RTCP G-code', () => {
    const ik = engine.inverseKinematicsTableTableAC([50, 60, 20], [0, Math.SQRT1_2, Math.SQRT1_2]);
    // Vector tilted 45 deg in Y -> A = 45 deg, C = 90 deg
    assert.ok(Math.abs(ik.aDeg - 45.0) < 0.1, `A = ${ik.aDeg} expected 45 deg`);
    assert.ok(Math.abs(ik.cDeg - 90.0) < 0.1, `C = ${ik.cDeg} expected 90 deg`);

    const pts = [
      { x: 0, y: 0, z: 10, i: 0, j: 0, k: 1 },
      { x: 20, y: 30, z: 5, i: 0, j: Math.SQRT1_2, k: Math.SQRT1_2, feed: 1200 }
    ];

    const gcode = engine.postProcessToGCode(pts);
    assert.ok(gcode.includes('G43.4'), 'Must activate RTCP with G43.4');
    assert.ok(gcode.includes('G49'), 'Must cancel RTCP with G49');
    assert.ok(gcode.includes('A45.000'), 'Must contain 45 deg A-axis move');
    assert.ok(gcode.includes('C90.000'), 'Must contain 90 deg C-axis move');
  });
});
