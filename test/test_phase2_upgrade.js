/**
 * OmniEng Phase 2 Upgrade Verification Suite:
 * CAD Kernel & Geometric Modeling Parity
 *
 * Verifies:
 * 1. NurbsBasis: Cox-de Boor recursion, derivatives, partition of unity
 * 2. NurbsCurve: Rational 3D B-spline evaluation, tangent vectors, arc length
 * 3. NurbsSurface: Bicubic surface evaluation, partials, normals, Gaussian & Mean curvature
 * 4. SurfaceSurfaceIntersection (SSI): Quadtree subdivision & Newton-Raphson 3D intersection
 * 5. EdgeBlender: Rolling-ball fillet and planar chamfer on B-Rep solid edges
 * 6. AssemblyMateSolver: 3D multi-body kinematic constraints (Coincident & Concentric) with LM solver
 * 7. DraftingEngine2D & FeatureControlFrame: Orthographic multi-view HLR and ASME/ISO GD&T frames
 */

const assert = require('assert');
const { Vector3, Quaternion } = require('../src/core/math/linear_algebra');
const { BRepPrimitives, SolidBody, Vertex, Edge, Face } = require('../src/core/cad/brep_topology');
const { NurbsBasis, NurbsCurve, NurbsSurface, SurfaceSurfaceIntersection } = require('../src/core/cad/nurbs_engine');
const { EdgeBlender } = require('../src/core/cad/edge_blender');
const { AssemblyComponent, AssemblyMateSolver } = require('../src/core/cad/assembly_mates');
const { FeatureControlFrame, DraftingEngine2D } = require('../src/core/cad/drafting_2d');

function runPhase2Tests() {
  console.log('\n================================================================');
  console.log('   OmniEng Phase 2 CAD Kernel & Modeling Parity Suite           ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}: ${err.message}`);
      if (err.stack) console.error(err.stack);
      failed++;
    }
  }

  // --- 1. NURBS Basis & Cox-de Boor ---
  console.log('1. NURBS Basis & Cox-de Boor Recursion:');
  test('Knot vector generation and partition of unity sum = 1.0', () => {
    const n = 4; // 5 control points
    const p = 3; // cubic
    const U = NurbsBasis.generateClampedKnots(n, p);
    assert.strictEqual(U.length, n + p + 2, 'Knot count must equal n + p + 2');

    // Verify partition of unity across various u
    const testPoints = [0.0, 0.2, 0.5, 0.75, 1.0];
    for (const u of testPoints) {
      const isValid = NurbsBasis.verifyPartitionOfUnity(n, p, u, U);
      assert.ok(isValid, `Partition of unity failed at u=${u}`);
    }
  });

  test('Basis function derivatives evaluate smoothly', () => {
    const n = 3;
    const p = 2;
    const U = NurbsBasis.generateClampedKnots(n, p);
    const u = 0.5;
    const d0 = NurbsBasis.derivative(1, p, u, U);
    assert.ok(!isNaN(d0) && typeof d0 === 'number');
  });

  // --- 2. NURBS 3D Curve ---
  console.log('\n2. Rational 3D B-Spline Curve:');
  test('NURBS Curve evaluates endpoints and tangent unit vector', () => {
    const cp = [
      new Vector3(0, 0, 0),
      new Vector3(10, 20, 0),
      new Vector3(30, 20, 0),
      new Vector3(40, 0, 0)
    ];
    const curve = new NurbsCurve({ degree: 3, controlPoints: cp });

    const pStart = curve.evaluate(0);
    assert.ok(pStart.distanceTo(cp[0]) < 1e-5, 'Curve must interpolate first control point');

    const pEnd = curve.evaluate(1);
    assert.ok(pEnd.distanceTo(cp[3]) < 1e-5, 'Curve must interpolate last control point');

    const pMid = curve.evaluate(0.5);
    assert.ok(pMid.y > 5, 'Midpoint should be elevated');

    const tan = curve.evaluateTangent(0.5);
    assert.ok(Math.abs(tan.length() - 1.0) < 1e-4, 'Tangent vector must be normalized');

    const len = curve.computeLength(50);
    assert.ok(len > 40 && len < 80, `Arc length reasonable: ${len}`);
  });

  // --- 3. NURBS 3D Surface ---
  console.log('\n3. Rational 3D B-Spline Surface:');
  test('Bicubic NURBS surface evaluates coordinates, partials, normals & curvature', () => {
    const cp = [
      [new Vector3(0, 0, 0), new Vector3(0, 10, 2), new Vector3(0, 20, 0)],
      [new Vector3(10, 0, 3), new Vector3(10, 10, 8), new Vector3(10, 20, 3)],
      [new Vector3(20, 0, 0), new Vector3(20, 10, 2), new Vector3(20, 20, 0)]
    ];
    const surf = new NurbsSurface({ degreeU: 2, degreeV: 2, controlPoints: cp });

    const ptCenter = surf.evaluate(0.5, 0.5);
    assert.ok(ptCenter.z > 2.0, `Center point elevated: ${ptCenter.z}`);

    const norm = surf.evaluateNormal(0.5, 0.5);
    assert.ok(Math.abs(norm.length() - 1.0) < 1e-4, 'Normal vector is unit length');

    const curv = surf.evaluateCurvature(0.5, 0.5);
    assert.ok(typeof curv.gaussian === 'number' && typeof curv.mean === 'number');

    const mesh = surf.tessellate(5, 5);
    assert.strictEqual(mesh.vertices.length, 36, '6x6 grid of vertices for 5x5 quad tessellation');
    assert.strictEqual(mesh.indices.length, 5 * 5 * 6, '50 triangles for 5x5 quads');
  });

  // --- 4. Surface-Surface Intersection (SSI) ---
  console.log('\n4. Surface-Surface Intersection (SSI):');
  test('SSI computes exact 3D intersection curve between two orthogonal surfaces', () => {
    // Surface 1: XY plane at z = 5
    const surf1 = NurbsSurface.createPlane(
      new Vector3(0, 0, 5),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      20,
      20
    );

    // Surface 2: XZ plane at y = 10
    const surf2 = NurbsSurface.createPlane(
      new Vector3(0, 10, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 0, 1),
      20,
      20
    );

    const ssi = SurfaceSurfaceIntersection.intersect(surf1, surf2, {
      subdivisions: 6,
      tolerance: 1e-4
    });

    assert.ok(ssi.points.length > 0, 'SSI must find intersection points');
    // All points on intersection line should satisfy z approx 5 and y approx 10
    for (const pt of ssi.points) {
      assert.ok(Math.abs(pt.z - 5) < 0.2, `Intersection point z must be ~5, got ${pt.z}`);
      assert.ok(Math.abs(pt.y - 10) < 0.2, `Intersection point y must be ~10, got ${pt.y}`);
    }
  });

  // --- 5. Edge Blender: Fillets & Chamfers ---
  console.log('\n5. Edge Blender (Fillets & Chamfers):');
  test('EdgeBlender applies rolling-ball fillet to B-Rep cube edge', () => {
    const cube = BRepPrimitives.createBox(20, 20, 20);
    const edgeToFillet = cube.edges[0];

    const result = EdgeBlender.applyFillet(cube, edgeToFillet, 2.0, { subdivisions: 4 });
    assert.strictEqual(result.radius, 2.0);
    assert.ok(result.blendFacesCount > 0, 'Blend faces must be created');
    assert.ok(result.filletSurfaceArea > 0, 'Fillet surface area must be positive');
  });

  test('EdgeBlender applies planar chamfer to B-Rep cube edge', () => {
    const cube = BRepPrimitives.createBox(30, 30, 30);
    const edgeToChamfer = cube.edges[1];

    const result = EdgeBlender.applyChamfer(cube, edgeToChamfer, 3.0, 3.0);
    assert.strictEqual(result.distance1, 3.0);
    assert.strictEqual(result.distance2, 3.0);
    assert.ok(result.bevelArea > 0, 'Chamfer bevel area must be positive');
    assert.strictEqual(result.chamferFaces.length, 2, 'Chamfer generated 2 bevel faces');
  });

  // --- 6. 3D Assembly Kinematic Mates ---
  console.log('\n6. 3D Assembly Kinematic Constraint Solver:');
  test('AssemblyMateSolver resolves Coincident and Concentric mates', () => {
    const solver = new AssemblyMateSolver();

    // Component 1: Base block (fixed at origin)
    const base = new AssemblyComponent('comp_base', 'BaseBlock', {
      position: new Vector3(0, 0, 0),
      fixed: true
    });

    // Component 2: Shaft pin (free to move, initially displaced)
    const pin = new AssemblyComponent('comp_pin', 'ShaftPin', {
      position: new Vector3(5, 5, 20),
      fixed: false
    });

    solver.addComponent(base);
    solver.addComponent(pin);

    // Mate 1: Concentric along Z-axis (axes collinear)
    solver.addConcentric(
      'comp_base',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 1),
      'comp_pin',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 1)
    );

    // Mate 2: Coincident Planes (Face-to-Face contact at z = 10)
    solver.addCoincidentPlanes(
      'comp_base',
      new Vector3(0, 0, 10),
      new Vector3(0, 0, 1),
      'comp_pin',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -1)
    );

    const solveResult = solver.solve(40, 1e-4);
    assert.ok(solveResult.iterations < 40, `Solver finished in ${solveResult.iterations} iterations`);

    const finalPin = solver.getComponent('comp_pin');
    // Pin should now have x approx 0, y approx 0, and z approx 10
    assert.ok(Math.abs(finalPin.position.x) < 0.05, `Pin X should be ~0, got ${finalPin.position.x}`);
    assert.ok(Math.abs(finalPin.position.y) < 0.05, `Pin Y should be ~0, got ${finalPin.position.y}`);
    assert.ok(Math.abs(finalPin.position.z - 10) < 0.05, `Pin Z should be ~10, got ${finalPin.position.z}`);
  });

  // --- 7. 2D Drafting & GD&T Feature Control Frames ---
  console.log('\n7. 2D Drafting & GD&T Feature Control Frames:');
  test('FeatureControlFrame formats ISO 1101 / ASME Y14.5 specifications', () => {
    const fcf = new FeatureControlFrame({
      characteristic: 'POSITION',
      tolerance: 0.05,
      diameter: true,
      modifier: 'M',
      datumPrimary: 'A',
      datumSecondary: 'B',
      datumTertiary: 'C'
    });

    const str = fcf.toString();
    assert.ok(str.includes('⌖'), 'Must contain position symbol');
    assert.ok(str.includes('⌀0.05'), 'Must contain diameter tolerance');
    assert.ok(str.includes('Ⓜ'), 'Must contain MMC modifier');
    assert.ok(str.includes('A') && str.includes('B') && str.includes('C'), 'Must contain datums');

    const svgObj = fcf.toSVG(10, 10, 24);
    assert.ok(svgObj.svg.includes('<rect'), 'SVG must include compartment boxes');
    assert.ok(svgObj.totalWidth > 100, 'Total width must account for compartments');
  });

  test('DraftingEngine2D generates 4-view orthographic drawing sheet with HLR', () => {
    const box = BRepPrimitives.createBox(40, 25, 15);
    box.name = 'BracketMount';

    const sheet = DraftingEngine2D.generateDrawingSheet(box, {
      title: 'Bracket Mounting Base',
      partNumber: 'OE-BKT-001',
      scale: '1:1',
      gdtSpecs: [
        { characteristic: 'FLATNESS', tolerance: 0.02, datumPrimary: 'A' },
        { characteristic: 'POSITION', tolerance: 0.05, diameter: true, modifier: 'M', datumPrimary: 'A', datumSecondary: 'B' }
      ]
    });

    assert.ok(sheet.svg.includes('<svg'), 'Must produce valid SVG document');
    assert.ok(sheet.svg.includes('TOP VIEW'), 'Must contain Top view quadrant');
    assert.ok(sheet.svg.includes('FRONT VIEW'), 'Must contain Front view quadrant');
    assert.ok(sheet.svg.includes('ISOMETRIC VIEW'), 'Must contain Isometric view quadrant');
    assert.ok(sheet.svg.includes('BracketMount') || sheet.svg.includes('Bracket Mounting Base'), 'Title block must include title');
    assert.ok(sheet.views.front.lines.some(l => l.type === 'VISIBLE'), 'Must classify visible lines');
  });

  console.log('\n================================================================');
  console.log(`Phase 2 Verification Finished: ${passed}/${passed + failed} Passed (${failed} Failed)`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`Phase 2 upgrade verification failed with ${failed} failing tests!`);
  }

  return { total: passed + failed, passed, failed };
}

if (require.main === module) {
  runPhase2Tests();
}

module.exports = { runPhase2Tests };
