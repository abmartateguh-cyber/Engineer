/**
 * Verification tests for the 5-axis constant-scallop contour finish generator.
 *
 * Verifies:
 * 1. Scallop control: measured scallop height between adjacent passes on the
 *    spherical dome (R_dome = 50, tool R = 3, target h = 0.002) is
 *    <= 0.002 + 10%.
 * 2. Curvature adaptation: stepover on the convex dome is smaller than the
 *    flat-surface stepover and the ratio matches sqrt(1 + kappa_n R) to 1e-3.
 * 3. No gouging: min signed distance from every tool center to the surface
 *    >= -1e-6.
 * 4. Coverage: u and v ranges fully covered (pole to equator, full sweep).
 * 5. Tool axis continuity: successive tool axes differ <= 3 deg.
 * 6. Determinism.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  TWO_PI,
  HALF_PI,
  invertBallEndScallopStepover,
  constantScallopStepover,
  SphericalDomeSurface,
  angleBetweenAxes,
  generateFiveAxisConstantScallopContouring,
  measureActualScallopHeight
} = require('../src/core/cam/five_axis_contouring');

const DOME_RADIUS_MM = 50.0;
const TOOL_RADIUS_MM = 3.0;
const TARGET_SCALLOP_MM = 0.002;

describe('FiveAxisContouring: constant scallop on spherical dome', () => {
  it('inverts scallop relation and applies curvature adaptation with correct factor', () => {
    const exactFlat = invertBallEndScallopStepover({
      toolRadiusMm: TOOL_RADIUS_MM,
      scallopHeightMm: TARGET_SCALLOP_MM
    });
    const approxFlat = Math.sqrt(8.0 * TOOL_RADIUS_MM * TARGET_SCALLOP_MM);
    assert.ok(Math.abs(exactFlat - approxFlat) < 1e-4, `inverse stepover ${exactFlat}`);

    const kappa = 1.0 / DOME_RADIUS_MM;
    const curved = constantScallopStepover({
      toolRadiusMm: TOOL_RADIUS_MM,
      scallopHeightMm: TARGET_SCALLOP_MM,
      normalCurvature: kappa
    });
    const flat = constantScallopStepover({
      toolRadiusMm: TOOL_RADIUS_MM,
      scallopHeightMm: TARGET_SCALLOP_MM,
      normalCurvature: 0.0
    });

    assert.ok(curved.stepoverMm < flat.stepoverMm, 'curved stepover must be smaller than flat');
    const ratio = flat.stepoverMm / curved.stepoverMm;
    const expectedRatio = Math.sqrt(1.0 + kappa * TOOL_RADIUS_MM);
    assert.ok(Math.abs(ratio - expectedRatio) < 1e-3, `stepover ratio ${ratio} expected ${expectedRatio}`);
  });

  it('generates deterministic passes covering the full dome without gouging', () => {
    const options = {
      domeRadiusMm: DOME_RADIUS_MM,
      toolRadiusMm: TOOL_RADIUS_MM,
      scallopHeightMm: TARGET_SCALLOP_MM
    };

    const run1 = generateFiveAxisConstantScallopContouring(options);
    const run2 = generateFiveAxisConstantScallopContouring(options);
    assert.deepEqual(run1, run2, 'must be deterministic');

    const surface = new SphericalDomeSurface({ radiusMm: DOME_RADIUS_MM });

    assert.ok(Math.abs(run1.passes[0].vArc - 0.0) < 1e-12, 'first pass must be at pole (v = 0)');
    const last = run1.passes[run1.passes.length - 1];
    assert.ok(Math.abs(last.vArc - HALF_PI) < 1e-12, 'last pass must be at equator (v = pi/2)');

    for (const pass of run1.passes) {
      assert.ok(pass.points.length > 10, `pass ${pass.index} must have points`);
      assert.ok(Math.abs(pass.points[0].u - 0.0) < 1e-12, 'u sweep must start at 0');
      assert.ok(Math.abs(pass.points[pass.points.length - 1].u - TWO_PI) < 1e-12, 'u sweep must reach 2pi');
      for (const p of pass.points) {
        assert.ok(p.u >= -1e-12 && p.u <= TWO_PI + 1e-12, 'u in range');
        assert.ok(p.v >= -1e-12 && p.v <= HALF_PI + 1e-12, 'v in range');
        assert.ok(Math.abs(p.clearance - surface.signedDistance(p.center)) < 1e-9, 'clearance consistent');
      }
    }
  });

  it('has no gouging: min signed distance from tool center to surface >= -1e-6', () => {
    const result = generateFiveAxisConstantScallopContouring({
      domeRadiusMm: DOME_RADIUS_MM,
      toolRadiusMm: TOOL_RADIUS_MM,
      scallopHeightMm: TARGET_SCALLOP_MM
    });

    const surface = new SphericalDomeSurface({ radiusMm: DOME_RADIUS_MM });
    let minClearance = Infinity;
    for (const pass of result.passes) {
      for (const p of pass.points) {
        const clearance = surface.signedDistance(p.center);
        if (clearance < minClearance) {
          minClearance = clearance;
        }
      }
    }

    assert.ok(minClearance >= -1e-6, `min signed distance ${minClearance} < -1e-6`);
    assert.ok(result.minClearance >= -1e-6, `generator min clearance ${result.minClearance}`);
    console.log(`gouge check: min clearance = ${minClearance.toFixed(6)} mm`);
  });

  it('keeps successive tool axes within 3 degrees', () => {
    const result = generateFiveAxisConstantScallopContouring({
      domeRadiusMm: DOME_RADIUS_MM,
      toolRadiusMm: TOOL_RADIUS_MM,
      scallopHeightMm: TARGET_SCALLOP_MM
    });

    let maxDeltaDeg = 0.0;
    let prevAxis = null;
    for (const pass of result.passes) {
      for (const p of pass.points) {
        if (prevAxis !== null) {
          const deg = (angleBetweenAxes(prevAxis, p.axis) * 180.0) / Math.PI;
          if (deg > maxDeltaDeg) {
            maxDeltaDeg = deg;
          }
        }
        prevAxis = p.axis;
      }
    }

    assert.ok(maxDeltaDeg <= 3.0, `max tool axis change ${maxDeltaDeg} deg > 3 deg`);
    assert.ok(result.maxAxisDeltaDeg <= 3.0, 'generator-reported axis continuity must hold');
  });

  it('keeps measured scallop height between adjacent passes <= target + 10%', () => {
    const result = generateFiveAxisConstantScallopContouring({
      domeRadiusMm: DOME_RADIUS_MM,
      toolRadiusMm: TOOL_RADIUS_MM,
      scallopHeightMm: TARGET_SCALLOP_MM
    });

    const measured = measureActualScallopHeight({
      passes: result.passes,
      domeRadiusMm: DOME_RADIUS_MM,
      toolRadiusMm: TOOL_RADIUS_MM
    });

    const limit = TARGET_SCALLOP_MM * 1.1;
    console.log(`scallop: measured max = ${measured.toFixed(6)} mm, limit = ${limit.toFixed(6)} mm`);
    assert.ok(measured <= limit, `measured scallop ${measured} mm > limit ${limit} mm`);
  });

  it('supports lead/tilt tool orientation without gouging and keeps continuity', () => {
    const result = generateFiveAxisConstantScallopContouring({
      domeRadiusMm: DOME_RADIUS_MM,
      toolRadiusMm: TOOL_RADIUS_MM,
      scallopHeightMm: TARGET_SCALLOP_MM,
      leadAngleDeg: 5.0,
      tiltAngleDeg: 3.0
    });

    assert.ok(result.minClearance >= -1e-6, 'lead/tilt must not gouge');
    assert.ok(result.maxAxisDeltaDeg <= 3.0, 'lead/tilt must preserve tool axis continuity');
  });
});
