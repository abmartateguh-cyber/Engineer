'use strict';

/**
 * Trimmed NURBS surface kernel validation:
 *
 * 1. Representation: { surface: NURBS, trims: [2D NURBS loops] } with a
 *    cylindrical sector trimmed by a circular hole loop (four exact rational
 *    quadratic 2D NURBS arcs in the parameter domain).
 * 2. Point-on-trimmed-surface classification via winding number: hole
 *    interior -> trimmed out; sector interior -> on surface.
 * 3. Trimming-aware tessellation: only inside-trim triangles, surface
 *    normals, area within 2% of analytic (cylinder sector minus hole).
 * 4. AP214 STEP export of the trimmed surface: the 2D NURBS trim curves are
 *    emitted and parse back via the existing STEP reader.
 */

const assert = require('assert');
const { NurbsSurface } = require('../src/core/cad/nurbs_engine');
const { NurbsCurve2D, TrimLoop2D, TrimmedNurbsSurface } = require('../src/core/cad/nurbs_trimmed_surface');
const { StepTranslator } = require('../src/core/cad/step_translator');

const R = 10;
const H = 20;
const SPAN = Math.PI / 2;
const HOLE_CU = 0.5;
const HOLE_CV = 0.5;
const HOLE_R = 0.2;

const EXPECTED_AREA = SPAN * R * H - Math.PI * (R * SPAN * HOLE_R) * (H * HOLE_R);

function buildTrimmedCylinder() {
  const surface = NurbsSurface.createCylinderPatch(R, H, SPAN);
  const loop = TrimLoop2D.circular(HOLE_CU, HOLE_CV, HOLE_R);
  return new TrimmedNurbsSurface({ surface, trims: [loop] });
}

function runTests() {
  let passed = 0;
  let failed = 0;

  const runTest = (name, fn) => {
    try {
      fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      failed++;
      console.error(`  [FAIL] ${name}:`, err.message);
      console.error(err.stack);
    }
  };

  runTest('representation: NURBS surface + 2D NURBS trim loop (4 rational arcs)', () => {
    const trimmed = buildTrimmedCylinder();
    assert(trimmed.surface instanceof NurbsSurface, 'surface must be a NURBS surface');
    assert.strictEqual(trimmed.trims.length, 1);
    const loop = trimmed.trims[0];
    assert(loop instanceof TrimLoop2D);
    assert.strictEqual(loop.isOuter, false);
    assert.strictEqual(loop.curves.length, 4);
    for (const c of loop.curves) {
      assert(c instanceof NurbsCurve2D);
      assert.strictEqual(c.degree, 2);
      assert.strictEqual(c.controlPoints.length, 3);
      assert.deepStrictEqual(c.knots, [0, 0, 0, 1, 1, 1]);
      assert(Math.abs(c.weights[1] - Math.SQRT1_2) < 1e-9, `arc mid weight ${c.weights[1]}`);
    }
  });

  runTest('classification: hole interior trimmed out, sector interior on surface', () => {
    const trimmed = buildTrimmedCylinder();

    const center = trimmed.pointOnTrimmedSurface(HOLE_CU, HOLE_CV);
    assert.strictEqual(center.status, 'outside');
    assert.strictEqual(center.inRegion, false);
    const theta = HOLE_CU * SPAN;
    assert(Math.abs(center.point.x - R * Math.cos(theta)) < 1e-6);
    assert(Math.abs(center.point.y - R * Math.sin(theta)) < 1e-6);
    assert(Math.abs(center.point.z - H * HOLE_CV) < 1e-6);

    assert.strictEqual(trimmed.pointOnTrimmedSurface(0.55, 0.5).inRegion, false);
    assert.strictEqual(trimmed.pointOnTrimmedSurface(0.5, 0.45).inRegion, false);

    const corner = trimmed.pointOnTrimmedSurface(0.05, 0.95);
    assert.strictEqual(corner.status, 'inside');
    assert.strictEqual(corner.inRegion, true);

    assert.strictEqual(trimmed.pointOnTrimmedSurface(0.95, 0.05).inRegion, true);
    assert.strictEqual(trimmed.pointOnTrimmedSurface(0.95, 0.95).inRegion, true);
    assert.strictEqual(trimmed.pointOnTrimmedSurface(0.75, 0.5).inRegion, true);
    assert.strictEqual(trimmed.pointOnTrimmedSurface(0.25, 0.5).inRegion, true);

    const outward = trimmed.pointOnTrimmedSurface(0.03, 0.5);
    assert.strictEqual(outward.status, 'inside');
    assert(outward.point.x > 8, 'sector sample should sit on the surface');
  });

  runTest('tessellation: only in-region triangles with correct normals and area within 2%', () => {
    const trimmed = buildTrimmedCylinder();
    const mesh = trimmed.tessellate(64, 64, { maxSubdiv: 3 });

    assert(mesh.indices.length % 3 === 0, 'indices must form triangles');
    assert(mesh.indices.length / 3 > 1000, 'must produce a meaningful mesh');
    assert.strictEqual(mesh.triangles.length, mesh.indices.length / 3);

    for (const n of mesh.normals) {
      assert(Math.abs(n.length() - 1) < 1e-6, 'normals must be unit length');
      assert(Math.hypot(n.x, n.y) > 0.99, 'cylinder normal must be radial outward');
    }

    for (const [ai, bi, ci] of mesh.triangles) {
      const u = (mesh.uvs[ai][0] + mesh.uvs[bi][0] + mesh.uvs[ci][0]) / 3;
      const v = (mesh.uvs[ai][1] + mesh.uvs[bi][1] + mesh.uvs[ci][1]) / 3;
      assert.strictEqual(
        trimmed.pointOnTrimmedSurface(u, v).inRegion,
        true,
        'triangle centroid must lie in the trimmed region'
      );
    }

    const relErr = Math.abs(mesh.area - EXPECTED_AREA) / EXPECTED_AREA;
    assert(relErr < 0.02, `mesh area ${mesh.area} vs analytic ${EXPECTED_AREA} (rel err ${relErr})`);
    console.log(
      `    area: mesh=${mesh.area.toFixed(3)}, analytic=${EXPECTED_AREA.toFixed(3)}, relErr=${(relErr * 100).toFixed(3)}%`
    );
  });

  runTest('STEP AP214: trimmed surface export parses back with 2D NURBS trim curves', () => {
    const trimmed = buildTrimmedCylinder();
    const step = StepTranslator.exportTrimmedSurfaces([trimmed], 'TrimmedCyl');
    const parsed = StepTranslator.parseSTEP(step);

    assert(step.includes('PCURVE('), 'STEP body must contain PCURVE trim data');
    assert(step.includes('SURFACE_CURVE('), 'STEP body must contain SURFACE_CURVE');
    assert(step.includes('FACE_BOUND('), 'STEP body must contain FACE_BOUND');

    assert.strictEqual(parsed.summary.rationalBSplineSurfacesCount, 1);
    assert.strictEqual(parsed.summary.bSplineSurfacesCount, 1);
    assert.strictEqual(parsed.summary.rationalBSplineCurvesCount, 4);
    assert.strictEqual(parsed.summary.bSplineCurvesCount, 4);
    assert.strictEqual(parsed.summary.pCurvesCount, 4);
    assert.strictEqual(parsed.summary.surfaceCurvesCount, 4);
    assert.strictEqual(parsed.summary.faceBoundsCount, 1);
    assert.strictEqual(parsed.summary.faceOuterBoundsCount, 0);
    assert.strictEqual(parsed.summary.edgeLoopsCount, 1);
    assert.strictEqual(parsed.summary.advancedFacesCount, 1);

    const surface = parsed.nurbsSurfaces.find((s) => s.type === 'RATIONAL_B_SPLINE_SURFACE');
    assert(surface, 'trimmed surface entity must parse');
    assert.strictEqual(surface.uDegree, 2);
    assert.strictEqual(surface.vDegree, 1);
    assert.strictEqual(surface.controlPoints.length, 3);
    assert.strictEqual(surface.weights.length, 3);
    assert(Math.abs(surface.weights[1][0] - Math.SQRT1_2) < 1e-6);
    for (const ref of surface.controlPointRefs.flat()) {
      assert.strictEqual(parsed.entities[ref].type, 'CARTESIAN_POINT');
    }

    for (const curve of parsed.trimCurves) {
      assert.strictEqual(curve.type, 'RATIONAL_B_SPLINE_CURVE_WITH_KNOTS');
      assert.strictEqual(curve.degree, 2);
      assert.strictEqual(curve.controlPointRefs.length, 3);
      assert.strictEqual(curve.weights.length, 3);
      assert(Math.abs(curve.weights[1] - Math.SQRT1_2) < 1e-6);
      assert.deepStrictEqual(curve.knots, [0, 0, 0, 1, 1, 1]);
      for (const ref of curve.controlPointRefs) {
        const ent = parsed.entities[ref];
        assert.strictEqual(ent.type, 'CARTESIAN_POINT');
        assert.strictEqual(ent.coordinates[2], 0, 'trim curve control points must be 2D (z=0)');
      }
    }

    for (const pc of parsed.pCurves) {
      assert.strictEqual(parsed.entities[pc.surface].type, 'RATIONAL_B_SPLINE_SURFACE');
      assert.strictEqual(parsed.entities[pc.curve].type, 'RATIONAL_B_SPLINE_CURVE_WITH_KNOTS');
    }
  });

  runTest('SSI fallback retained: intersectWith delegates to existing surface-surface intersection', () => {
    const trimmed = buildTrimmedCylinder();
    const plane = NurbsSurface.createPlane(
      new (require('../src/core/math/linear_algebra').Vector3)(0, -20, 0),
      new (require('../src/core/math/linear_algebra').Vector3)(1, 0, 0),
      new (require('../src/core/math/linear_algebra').Vector3)(0, 0, 1),
      60,
      40
    );
    const result = trimmed.intersectWith(plane);
    assert(Array.isArray(result.points));
    assert(Array.isArray(result.uvPairs));
    assert(typeof result.curveLength === 'number');
    for (const pt of result.points) {
      assert(Math.abs(pt.y + 20) < 0.5, 'intersection points must lie on the plane y=-20');
      assert(Math.abs(Math.hypot(pt.x, pt.y) - R) < 0.5, 'intersection points must lie on the cylinder');
    }
  });

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
