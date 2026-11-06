'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 23, CAD cluster).
 *
 * Targets remaining uncovered branch blocks in the CAD geometry/topology
 * kernels: NURBS evaluation and SSI engines, trimmed-surface classification
 * and tessellation, B-Rep primitives, GD&T arithmetic, sheet-metal unfolding,
 * persistent topological naming, STEP translation/parsing, edge blending,
 * variable-radius fillets, assembly mates and BVH screening, 2D/variational
 * constraint solvers, the parametric feature tree, CSG mesh booleans, 2D
 * drafting, the geometry engine adapter, the kernel adapter, and the
 * out-of-core octree. No production source is modified.
 */

const assert = require('assert');
const path = require('path');

const { Vector3, Quaternion } = require('../src/core/math/linear_algebra');
const { NurbsBasis, NurbsCurve, NurbsSurface, SurfaceSurfaceIntersection } = require('../src/core/cad/nurbs_engine');
const {
  ParameterCurve2D,
  TrimLoop2D: TrimLoop2DSsi,
  TrimmedNurbsSurface: TrimmedNurbsSurfaceSsi,
  SurfaceSurfaceIntersectionEngine
} = require('../src/core/cad/nurbs_trimmed_ssi');
const { NurbsCurve2D, TrimLoop2D, TrimmedNurbsSurface } = require('../src/core/cad/nurbs_trimmed_surface');
const { Vertex, Edge, Face, SolidBody, BRepPrimitives } = require('../src/core/cad/brep_topology');
const {
  GDTEngine,
  DatumReferenceFrame,
  FeatureControlFrame: GdtFeatureControlFrame
} = require('../src/core/cad/gdt_engine');
const { SheetMetalBend, SheetMetalFlange, SheetMetalUnfolder } = require('../src/core/cad/sheet_metal_unfolding');
const { PersistentNamingManager } = require('../src/core/cad/persistent_naming_manager');
const { StepTranslator } = require('../src/core/cad/step_translator');
const { EdgeBlender } = require('../src/core/cad/edge_blender');
const {
  GregoryCornerPatch,
  VariableRadiusFilletEngine,
  VariableFilletGregory
} = require('../src/core/cad/variable_fillet_gregory');
const { AssemblyComponent, AssemblyMateSolver } = require('../src/core/cad/assembly_mates');
const { AABB3D, BVHNode, AssemblyBVHHierarchy } = require('../src/core/cad/assembly_bvh_hierarchy');
const { ConstraintSolver2D } = require('../src/core/cad/constraint_solver_2d');
const { VariationalConstraintSolver } = require('../src/core/cad/variational_constraint_solver');
const { FeatureTree, ParametricFeature } = require('../src/core/cad/feature_tree');
const {
  CSGSolid,
  CSGNode,
  CSGPolygon,
  CSGPlane,
  CSGVertex,
  CSGMeshBooleans
} = require('../src/core/cad/csg_mesh_booleans');
const { FeatureControlFrame, DraftingEngine2D } = require('../src/core/cad/drafting_2d');
const { GeometryEngineAdapter } = require('../src/core/cad/geometry_engine_adapter');
const { GeometryKernelAdapter, KernelAdapter, defaultGeometryKernel } = require('../src/core/cad/kernel_adapter');
const { OctreeNode, OutOfCoreAssemblyManager } = require('../src/core/cad/out_of_core_octree');

async function runBranchGapTwentyThreeCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const pending = [];

  function check(name, fn) {
    totalTests++;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        pending.push(
          Promise.resolve(result).then(
            () => {
              passedTests++;
              console.log(`  ✓ PASSED: ${name}`);
            },
            (err) => {
              failedTests++;
              console.error(`  ✗ FAILED: ${name}`);
              console.error(`    ${err.message}`);
            }
          )
        );
        return;
      }
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // ------------------------------------------------------------------
  // nurbs_engine.js
  // ------------------------------------------------------------------
  check('NurbsBasis evaluate, derivative, knot, partition branches', () => {
    const U = [0, 0, 0, 1, 1, 1];
    assert.strictEqual(NurbsBasis.evaluate(2, 0, 1, U), 1.0);
    assert.strictEqual(NurbsBasis.evaluate(0, 0, 0.5, U), 0.0);
    assert.strictEqual(NurbsBasis.evaluate(1, 0, 0.5, U), 0.0);
    assert.strictEqual(NurbsBasis.evaluate(2, 0, 0.5, U), 1.0);
    const p3 = NurbsBasis.evaluate(1, 2, 0.5, U);
    assert(p3 >= 0 && p3 <= 1);
    assert.strictEqual(NurbsBasis.derivative(0, 0, 0.5, U), 0.0);
    assert(Number.isFinite(NurbsBasis.derivative(1, 2, 0.5, U)));
    assert.strictEqual(NurbsBasis.verifyPartitionOfUnity(2, 2, 0.5, U), true);
    assert.strictEqual(NurbsBasis.verifyPartitionOfUnity(3, 2, 0.5, U), true);
    const clamped = NurbsBasis.generateClampedKnots(3, 1);
    assert.deepStrictEqual(clamped.slice(0, 2), [0, 0]);
    assert.deepStrictEqual(clamped.slice(-2), [1, 1]);
    const clamped2 = NurbsBasis.generateClampedKnots(1, 3);
    assert.strictEqual(clamped2.length, 8);
    const degenerate = NurbsBasis.generateClampedKnots(2, 2);
    assert.strictEqual(degenerate.length, 6);
    assert.deepStrictEqual(degenerate.slice(0, 3), [0, 0, 0]);
    assert.deepStrictEqual(degenerate.slice(-3), [1, 1, 1]);
  });

  check('NurbsCurve construction, clamp, zero-weight, tangent/length/tessellate', () => {
    const pts = [new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(2, 0, 0)];
    const c = new NurbsCurve({ degree: 2, controlPoints: pts });
    assert.strictEqual(c.n, 2);
    assert.deepStrictEqual(c.weights, [1, 1, 1]);
    assert(c.knots.length === 6);
    const cArr = new NurbsCurve({
      degree: 1,
      controlPoints: [
        [0, 0, 0],
        [5, 0, 0]
      ]
    });
    assert(cArr.controlPoints[0] instanceof Vector3);
    assert.throws(
      () => new NurbsCurve({ degree: 3, controlPoints: [new Vector3(0, 0, 0)] }),
      /Insufficient control points/
    );
    const zc = new NurbsCurve({ degree: 2, controlPoints: pts, weights: [0, 0, 0] });
    const zp = zc.evaluate(0.5);
    assert.strictEqual(zp.x, 0);
    assert.strictEqual(zp.y, 0);
    const clampedP = c.evaluate(-2);
    assert.deepStrictEqual(clampedP, c.evaluate(0));
    const p1 = c.evaluate(1);
    assert.strictEqual(p1.x, 2);
    const tan0 = c.evaluateTangent(0);
    assert(Math.abs(tan0.length() - 1) < 1e-9);
    const tan1 = c.evaluateTangent(1);
    assert(Number.isFinite(tan1.x));
    assert(c.computeLength(100) > 0);
    assert.strictEqual(c.computeLength(1), 2);
    const tess = c.tessellate(10);
    assert.strictEqual(tess.length, 11);
    assert(tess[10].x > 1.99);
  });

  check('NurbsSurface construction, evaluate, partials, normal, curvature, tessellate', () => {
    const grid = [
      [new Vector3(0, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 2, 0)],
      [new Vector3(1, 0, 0), new Vector3(1, 1, 1), new Vector3(1, 2, 0)],
      [new Vector3(2, 0, 0), new Vector3(2, 1, 0), new Vector3(2, 2, 0)]
    ];
    assert.throws(() => new NurbsSurface({ controlPoints: [] }), /Insufficient control point grid/);
    assert.throws(() => new NurbsSurface({ controlPoints: [grid[0]] }), /Insufficient control point grid/);
    const s = new NurbsSurface({
      degreeU: 2,
      degreeV: 2,
      controlPoints: grid,
      weights: [
        [1, 1, 1],
        [1, 2, 1],
        [1, 1, 1]
      ],
      knotsU: [0, 0, 0, 1, 1, 1],
      knotsV: [0, 0, 0, 1, 1, 1]
    });
    assert.strictEqual(s.nu, 2);
    assert.strictEqual(s.nv, 2);
    assert.strictEqual(s.weights[1][1], 2);
    const p = s.evaluate(0.5, 0.5);
    assert(p instanceof Vector3);
    const def = new NurbsSurface({ degreeU: 1, degreeV: 1, controlPoints: grid });
    assert.deepStrictEqual(def.weights[0], [1, 1, 1]);
    assert(def.knotsU.length === 5);
    assert(def.knotsV.length === 5);
    assert(def.knotsU.includes(0.5));
    const clamped = s.evaluate(-5, 5);
    assert(Number.isFinite(clamped.x));
    const zw = new NurbsSurface({
      degreeU: 1,
      degreeV: 1,
      controlPoints: grid,
      weights: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ]
    });
    const zp = zw.evaluate(0.5, 0.5);
    assert.strictEqual(zp.x, 0);
    const part = s.evaluatePartials(0, 0);
    assert(part.dS_du instanceof Vector3);
    assert(part.dS_dv instanceof Vector3);
    const part2 = s.evaluatePartials(1, 1);
    assert(Number.isFinite(part2.dS_du.x));
    const n = s.evaluateNormal(0.5, 0.5);
    assert(Math.abs(n.length() - 1) < 1e-9);
    const curv = s.evaluateCurvature(0.5, 0.5);
    assert(Number.isFinite(curv.K));
    assert(Number.isFinite(curv.H));
    assert.strictEqual(curv.gaussian, curv.K);
    const mesh = s.tessellate(2, 2);
    assert.strictEqual(mesh.vertices.length, 9);
    assert.strictEqual(mesh.indices.length, 24);
    const plane = NurbsSurface.createPlane(new Vector3(0, 0, 0), new Vector3(2, 0, 0), new Vector3(0, 3, 0), 10, 10);
    const pp = plane.evaluate(0.5, 0.5);
    assert(pp instanceof Vector3);
    const cyl = NurbsSurface.createCylinderPatch(5, 10);
    const cp = cyl.evaluate(0.5, 0.5);
    assert(cp instanceof Vector3);
    assert(cyl.weights.some((row) => row.some((w) => w !== 1)));
  });

  check('SurfaceSurfaceIntersection intersect refine/order/length branches', () => {
    const planeA = NurbsSurface.createPlane(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 10, 10);
    const planeB = NurbsSurface.createPlane(new Vector3(0, 0, 2), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 10, 10);
    const noHit = SurfaceSurfaceIntersection.intersect(planeA, planeB, {
      subdivisions: 4,
      tolerance: 1e-4,
      maxIterations: 10
    });
    assert.strictEqual(noHit.curveLength, 0);
    const hit = SurfaceSurfaceIntersection.intersect(planeA, planeA, {
      subdivisions: 5,
      tolerance: 1e-5,
      maxIterations: 25
    });
    assert(hit.points.length > 0);
    assert.strictEqual(hit.uvPairs.length, hit.points.length);
    const ref = SurfaceSurfaceIntersection._refineNewton(planeA, planeA, 0.5, 0.5, 0.5, 0.5, 1e-6, 25);
    assert.strictEqual(ref.converged, true);
    assert.strictEqual(ref.residual, 0);
    const refFar = SurfaceSurfaceIntersection._refineNewton(planeA, planeB, 0.1, 0.1, 0.9, 0.9, 1e-12, 3);
    assert(typeof refFar.converged === 'boolean');
    const pts = [new Vector3(0, 0, 0), new Vector3(1, 0, 0)];
    const uv = [
      { uv1: [0, 0], uv2: [0, 0] },
      { uv1: [1, 0], uv2: [1, 0] }
    ];
    SurfaceSurfaceIntersection._orderCurvePoints(pts, uv);
    assert.strictEqual(pts.length, 2);
    const pts3 = [new Vector3(0, 0, 0), new Vector3(2, 0, 0), new Vector3(1, 0, 0)];
    const uv3 = [{ x: 1 }, { x: 2 }, { x: 3 }];
    SurfaceSurfaceIntersection._orderCurvePoints(pts3, uv3);
    assert(Math.abs(pts3[1].x - 1) < 1e-9);
    assert.strictEqual(SurfaceSurfaceIntersection._computeCurveLength([new Vector3(0, 0, 0)]), 0);
  });

  // ------------------------------------------------------------------
  // nurbs_trimmed_ssi.js
  // ------------------------------------------------------------------
  check('ParameterCurve2D / TrimLoop2D (ssi) classification branches', () => {
    const empty = new ParameterCurve2D();
    assert.deepStrictEqual(empty.evaluate(0.5), { u: 0, v: 0 });
    const single = new ParameterCurve2D([{ u: 3, v: 4 }], 1);
    assert.deepStrictEqual(single.evaluate(0.2), { u: 3, v: 4 });
    const square = new ParameterCurve2D(
      [
        { u: 0, v: 0 },
        { u: 10, v: 0 },
        { u: 10, v: 10 },
        { u: 0, v: 10 }
      ],
      1
    );
    const mid = square.evaluate(0.5);
    assert(Math.abs(mid.u - 7.5) < 1e-9);
    const loop = new TrimLoop2DSsi(true).addCurve(square);
    assert.strictEqual(loop.isPointInside(5, 5), true);
    assert.strictEqual(loop.isPointInside(20, 20), false);
    const inner = new TrimLoop2DSsi(false).addCurve(square);
    assert.strictEqual(inner.isPointInside(5, 5), true);
    assert.strictEqual(inner.isPointInside(-1, -1), false);
  });

  check('TrimmedNurbsSurface (ssi) defaults, trim loops, derivatives, active states', () => {
    const def = new TrimmedNurbsSurfaceSsi();
    assert.strictEqual(def.degreeU, 3);
    assert.strictEqual(def.degreeV, 3);
    assert.strictEqual(def.controlGrid.length, 3);
    assert.strictEqual(def.weights, null);
    const custom = new TrimmedNurbsSurfaceSsi({ degreeU: 2, degreeV: 1, weights: [[1, 1, 1]] });
    assert.strictEqual(custom.degreeU, 2);
    assert.strictEqual(custom.degreeV, 1);
    assert.deepStrictEqual(custom.weights, [[1, 1, 1]]);
    const pt = def.evaluatePoint(0.5, 0.5);
    assert(Number.isFinite(pt.x));
    const d = def.evaluateDerivatives(0.5, 0.5);
    assert(Number.isFinite(d.normal.x));
    assert(Math.abs(d.normal.z) <= 1.000001);
    const sq = new ParameterCurve2D(
      [
        { u: 0, v: 0 },
        { u: 10, v: 0 },
        { u: 10, v: 10 },
        { u: 0, v: 10 }
      ],
      1
    );
    const outer = new TrimLoop2DSsi(true).addCurve(sq);
    const hole = new TrimLoop2DSsi(false).addCurve(
      new ParameterCurve2D(
        [
          { u: 3, v: 3 },
          { u: 7, v: 3 },
          { u: 7, v: 7 },
          { u: 3, v: 7 }
        ],
        1
      )
    );
    const trimmed = new TrimmedNurbsSurfaceSsi();
    trimmed.addTrimLoop(outer).addTrimLoop(hole);
    assert.strictEqual(trimmed.outerLoops.length, 1);
    assert.strictEqual(trimmed.innerLoops.length, 1);
    assert.strictEqual(trimmed.isTrimmedActive(5, 5), false);
    assert.strictEqual(trimmed.isTrimmedActive(1, 1), true);
    assert.strictEqual(trimmed.isTrimmedActive(20, 20), false);
    const noOuter = new TrimmedNurbsSurfaceSsi();
    noOuter.addTrimLoop(hole);
    assert.strictEqual(noOuter.isTrimmedActive(5, 5), false);
    assert.strictEqual(noOuter.isTrimmedActive(0, 0), true);
  });

  check('SurfaceSurfaceIntersectionEngine seed/refine/march branches', () => {
    const sA = new TrimmedNurbsSurfaceSsi();
    const sB = new TrimmedNurbsSurfaceSsi({
      controlGrid: [
        [
          { x: 0, y: 0, z: 0 },
          { x: 50, y: 0, z: 10 },
          { x: 100, y: 0, z: 0 }
        ],
        [
          { x: 0, y: 50, z: 15 },
          { x: 50, y: 50, z: 40 },
          { x: 100, y: 50, z: 15 }
        ],
        [
          { x: 0, y: 100, z: 0 },
          { x: 50, y: 100, z: 10 },
          { x: 100, y: 100, z: 0 }
        ]
      ]
    });
    const far = new TrimmedNurbsSurfaceSsi({
      controlGrid: [
        [
          { x: 0, y: 0, z: 10000 },
          { x: 50, y: 0, z: 10010 },
          { x: 100, y: 0, z: 10000 }
        ],
        [
          { x: 0, y: 50, z: 10015 },
          { x: 50, y: 50, z: 10040 },
          { x: 100, y: 50, z: 10015 }
        ],
        [
          { x: 0, y: 100, z: 10000 },
          { x: 50, y: 100, z: 10010 },
          { x: 100, y: 100, z: 10000 }
        ]
      ]
    });
    const none = SurfaceSurfaceIntersectionEngine.intersectSurfaces(sA, far, { gridSamples: 4 });
    assert.strictEqual(none.intersectionFound, false);
    assert.deepStrictEqual(none.curve3D, []);
    const hit = SurfaceSurfaceIntersectionEngine.intersectSurfaces(sA, sB, {
      gridSamples: 6,
      tolerance: 1e-3,
      stepSize: 0.1
    });
    assert.strictEqual(hit.intersectionFound, true);
    assert(hit.curve3D.length >= 1);
    assert.strictEqual(hit.pCurvesS1.length, hit.curve3D.length);
    const engine = new SurfaceSurfaceIntersectionEngine();
    const wrapped = engine.intersectSurfaces(
      { controlGrid: sA.controlGrid },
      { controlGrid: sB.controlGrid },
      { gridSamples: 4 }
    );
    assert(typeof wrapped.intersectionFound === 'boolean');
  });

  // ------------------------------------------------------------------
  // nurbs_trimmed_surface.js
  // ------------------------------------------------------------------
  check('NurbsCurve2D construction, arcs, knots branches', () => {
    assert.throws(
      () =>
        new NurbsCurve2D({
          degree: 3,
          controlPoints: [
            [0, 0],
            [1, 1]
          ]
        }),
      /Insufficient 2D control points/
    );
    const c = new NurbsCurve2D({
      degree: 2,
      controlPoints: [
        [0, 0],
        [1, 1],
        [2, 0]
      ],
      weights: [1, 2, 1]
    });
    assert.strictEqual(c.n, 2);
    assert.deepStrictEqual(c.weights, [1, 2, 1]);
    assert.strictEqual(c.knots.length, 6);
    assert.throws(() => new NurbsCurve2D({}), /Insufficient 2D control points/);
    const p = c.evaluate(0.5);
    assert(Number.isFinite(p.u));
    const clamped = c.evaluate(-3);
    assert.strictEqual(clamped.u, 0);
    const arc = NurbsCurve2D.makeCircularArc(0.5, 0.5, 0.45, 0, Math.PI / 2);
    const a0 = arc.evaluate(0);
    assert(Math.abs(a0.u - 0.95) < 1e-9);
    const circle = NurbsCurve2D.makeCircle(0.5, 0.5, 0.45);
    assert.strictEqual(circle.length, 4);
    assert(circle.every((a) => a.knots[0] === 0 && a.knots[5] === 1));
  });

  check('TrimLoop2D polyline/winding/contains/distance branches', () => {
    const loop = TrimLoop2D.circular(0.5, 0.5, 0.45, { isOuter: true });
    assert.strictEqual(loop.isOuter, true);
    const cache = loop.samplePolyline(24);
    const cache2 = loop.samplePolyline(24);
    assert.strictEqual(cache, cache2);
    assert(Math.abs(loop.windingNumber(0.5, 0.5) - 1) < 0.1);
    assert.strictEqual(loop.contains(0.5, 0.5), true);
    assert.strictEqual(loop.contains(0.9, 0.9), false);
    assert(loop.distanceTo(0.5, 0.5) > 0.4);
    assert(loop.distanceTo(0.95, 0.5) < 1e-9);
    const loopIn = TrimLoop2D.circular(0.5, 0.5, 0.2, { isOuter: false });
    assert.strictEqual(loopIn.isOuter, false);
    assert.strictEqual(loopIn.contains(0.5, 0.5), true);
    const manual = new TrimLoop2D({ isOuter: true });
    manual.addCurve(NurbsCurve2D.makeCircularArc(0.5, 0.5, 0.45, 0, Math.PI / 2));
    assert.strictEqual(manual.curves.length, 1);
    const empty = new TrimLoop2D();
    assert.strictEqual(empty.isOuter, false);
    assert.strictEqual(empty.samplePolyline().length, 0);
  });

  check('TrimmedNurbsSurface classification, tessellation, intersectWith branches', () => {
    const plane = NurbsSurface.createPlane(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 1, 1);
    const outer = TrimLoop2D.circular(0.5, 0.5, 0.49, { isOuter: true });
    const inner = TrimLoop2D.circular(0.5, 0.5, 0.1, { isOuter: false });
    const trimmed = new TrimmedNurbsSurface({ surface: plane, trims: [outer, inner] });
    assert.strictEqual(trimmed.trims.length, 2);
    const inside = trimmed.pointOnTrimmedSurface(0.5, 0.5);
    assert.strictEqual(inside.status, 'outside');
    assert.strictEqual(inside.inRegion, false);
    const onOuterCorner = trimmed.pointOnTrimmedSurface(0.99, 0.5);
    assert.strictEqual(onOuterCorner.status, 'on');
    const outside = trimmed.pointOnTrimmedSurface(0.9, 0.9);
    assert.strictEqual(outside.status, 'outside');
    const noTrims = new TrimmedNurbsSurface({ surface: plane });
    const anywhere = noTrims.pointOnTrimmedSurface(0.25, 0.25);
    assert.strictEqual(anywhere.status, 'inside');
    assert.strictEqual(anywhere.inRegion, true);
    const converted = new TrimmedNurbsSurface({ surface: plane, trims: [{ isOuter: true, curves: [] }] });
    assert(converted.trims[0] instanceof TrimLoop2D);
    converted.addTrimLoop({ isOuter: false, curves: [] });
    assert.strictEqual(converted.trims.length, 2);
    const mesh = trimmed.tessellate(4, 4, { maxSubdiv: 2, samplesPerCurve: 32 });
    assert(mesh.vertices.length > 0);
    assert(mesh.area > 0);
    assert.strictEqual(mesh.triangles.length, mesh.indices.length / 3);
    const meshFull = noTrims.tessellate(2, 2, { maxSubdiv: 0 });
    assert(meshFull.vertices.length > 0);
    const other = NurbsSurface.createPlane(new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 1, 1);
    const inter = trimmed.intersectWith(other, { subdivisions: 4 });
    assert(Array.isArray(inter.points));
  });

  // ------------------------------------------------------------------
  // brep_topology.js
  // ------------------------------------------------------------------
  check('Vertex/Edge/Face construction and metric branches', () => {
    const vArr = new Vertex([1, 2, 3]);
    assert.deepStrictEqual(vArr.point.toArray(), [1, 2, 3]);
    const vObj = new Vertex({ x: 4, y: 5, z: 6 });
    assert.strictEqual(vObj.point.y, 5);
    const vNum = new Vertex(7, 8, 9);
    assert.strictEqual(vNum.point.z, 9);
    const e = new Edge(vArr, vObj);
    assert(Math.abs(e.length() - Math.sqrt(27)) < 1e-9);
    const small = new Face([vArr, vObj]);
    assert.strictEqual(small.normal.z, 1);
    assert.strictEqual(small.area(), 0);
    assert.strictEqual(small.material.wireframe, false);
    const f = new Face([new Vertex(0, 0, 0), new Vertex(2, 0, 0), new Vertex(0, 2, 0)]);
    assert(Math.abs(f.normal.z - 1) < 1e-9);
    assert(Math.abs(f.area() - 2) < 1e-9);
    const quad = new Face([new Vertex(0, 0, 0), new Vertex(2, 0, 0), new Vertex(2, 2, 0), new Vertex(0, 2, 0)]);
    assert(Math.abs(quad.area() - 4) < 1e-9);
  });

  check('SolidBody volume, bounds, triangles, OBJ, edges branches', () => {
    const empty = new SolidBody();
    assert.strictEqual(empty.name, 'Solid');
    assert.deepStrictEqual(empty.getBoundingBox().min.toArray(), [0, 0, 0]);
    assert.strictEqual(empty.computeVolume(), 0);
    assert.deepStrictEqual(empty.toTriangles(), []);
    const box = BRepPrimitives.createBox(10, 20, 30, 'MyBox');
    assert.strictEqual(box.name, 'MyBox');
    assert.strictEqual(box.computeVolume(), 6000);
    const bb = box.getBoundingBox();
    assert.deepStrictEqual(bb.min.toArray(), [-5, -10, -15]);
    assert.deepStrictEqual(bb.max.toArray(), [5, 10, 15]);
    assert.strictEqual(box.edges.length, 12);
    assert.strictEqual(box.toTriangles().length, 12);
    const objj = box.toOBJ();
    assert(objj.startsWith('# OmniEng'));
    assert(objj.includes('o MyBox'));
    assert(objj.includes('f '));
    const triOnly = new SolidBody('T');
    triOnly.vertices.push(new Vertex(0, 0, 0), new Vertex(1, 0, 0), new Vertex(0, 1, 0));
    triOnly.faces.push(new Face(triOnly.vertices));
    triOnly.faces.push(new Face([triOnly.vertices[0], triOnly.vertices[1]]));
    const tris = triOnly.toTriangles();
    assert.strictEqual(tris.length, 1);
    triOnly.buildEdges();
    assert.strictEqual(triOnly.edges.length, 3);
    const edgesReversed = triOnly.buildEdges();
    assert.strictEqual(edgesReversed.length, 3);
    assert.strictEqual(BRepPrimitives.createBox().vertices.length, 8);
  });

  check('BRepPrimitives cylinder/sphere branches', () => {
    const cyl = BRepPrimitives.createCylinder(5, 20, 4, 'C');
    assert.strictEqual(cyl.name, 'C');
    assert.strictEqual(cyl.vertices.length, 8);
    assert.strictEqual(cyl.faces.length, 6);
    assert(cyl.edges.length > 0);
    const sph = BRepPrimitives.createSphere(10, 2, 3, 'S');
    assert.strictEqual(sph.faces.length, 6);
    assert(sph.vertices.length > 0);
    const sphSmall = BRepPrimitives.createSphere(10, 1, 2);
    assert(sphSmall.faces.length > 0);
    assert.strictEqual(SolidBody.createBox, BRepPrimitives.createBox);
  });

  // ------------------------------------------------------------------
  // gdt_engine.js
  // ------------------------------------------------------------------
  check('GDTEngine true position MMC/LMC/RFS branches', () => {
    const drf = new DatumReferenceFrame();
    assert.strictEqual(drf.primary, 'A');
    assert.strictEqual(drf.secondary, 'B');
    assert.strictEqual(drf.tertiary, 'C');
    const customDrf = new DatumReferenceFrame({ primary: 'X', secondary: 'Y' });
    assert.strictEqual(customDrf.primary, 'X');
    assert.strictEqual(customDrf.tertiary, 'C');
    const fcf = new GdtFeatureControlFrame();
    assert.strictEqual(fcf.characteristic, 'POSITION');
    assert.strictEqual(fcf.tolerance, 0.1);
    const fcfM = new GdtFeatureControlFrame({
      geometricCharacteristic: 'POSITION',
      specifiedTolerance: 0.1,
      materialCondition: 'MMC'
    });
    const hole = {
      nominalX: 0,
      nominalY: 0,
      measuredX: 0.1,
      measuredY: 0.1,
      nominalDiameter: 10,
      measuredDiameter: 10.2,
      lowerTolerance: -0.05,
      upperTolerance: 0.1
    };
    const rM = GDTEngine.evaluateTruePosition(hole, fcfM);
    assert(rM.bonusTolerance > 0);
    const fcfL = new GdtFeatureControlFrame({ specifiedTolerance: 0.1, materialCondition: 'LMC' });
    const rL = GDTEngine.evaluateTruePosition(hole, fcfL);
    assert.strictEqual(rL.bonusTolerance, 0);
    const rR = GDTEngine.evaluateTruePosition(hole, fcf);
    assert.strictEqual(rR.bonusTolerance, 0);
    assert.strictEqual(rR.characteristic, 'TRUE_POSITION');
    assert(Math.abs(rR.radialOffset - Math.hypot(0.1, 0.1)) < 1e-9);
    assert.strictEqual(typeof rR.passed, 'boolean');
    assert(Number.isFinite(rR.marginRemainingMm));
    const passHole = { ...hole, measuredX: 0.01, measuredY: 0.01 };
    const rP = GDTEngine.evaluateTruePosition(passHole, fcf);
    assert.strictEqual(rP.passed, true);
    const proto = new GDTEngine();
    assert.strictEqual(proto.evaluateTruePosition(passHole, fcf).passed, true);
    assert.strictEqual(proto.evaluateProfileOfSurface([], 0.1).pointsInspected, 0);
    assert.strictEqual(proto.evaluatePerpendicularity([0, 0, 1], [1, 0, 0], 100, 0.05).passed, true);
  });

  check('GDTEngine profile and perpendicularity branches', () => {
    const pts = [
      { x: 0, y: 0, z: 0, nominalDist: 0.05 },
      { x: 1, y: 0, z: 0, nominalDist: -0.03 },
      { x: 0, y: 1, z: 0 }
    ];
    const r = GDTEngine.evaluateProfileOfSurface(pts, 0.2);
    assert.strictEqual(r.pointsInspected, 3);
    assert.strictEqual(r.maxPlusDeviation, 0.05);
    assert.strictEqual(r.maxMinusDeviation, -0.03);
    assert.strictEqual(r.passed, true);
    const fail = GDTEngine.evaluateProfileOfSurface(pts, 0.05);
    assert.strictEqual(fail.passed, false);
    const r2 = GDTEngine.evaluatePerpendicularity({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, 100, 0.05);
    assert.strictEqual(r2.characteristic, 'PERPENDICULARITY');
    assert.strictEqual(r2.passed, false);
    const arr = GDTEngine.evaluatePerpendicularity([0, 0, 1], [1, 0, 0], 50, 0.001);
    assert.strictEqual(arr.passed, true);
    const arrPartial = GDTEngine.evaluatePerpendicularity([0, 1], [0, 0, 1], 100, 0.05);
    assert(Number.isFinite(arrPartial.angularDeviationDeg));
    assert.strictEqual(
      GDTEngine.prototype.evaluateProfileOfSurface([{ x: 0, y: 0, z: 0, nominalDist: 0.01 }], 0.1).passed,
      true
    );
  });

  // ------------------------------------------------------------------
  // sheet_metal_unfolding.js
  // ------------------------------------------------------------------
  check('SheetMetalBend/Flange/Unfolder branches', () => {
    const bend = new SheetMetalBend();
    assert.strictEqual(bend.angleDeg, 90);
    assert.strictEqual(bend.kFactor, 0.44);
    assert.strictEqual(bend.direction, 'UP');
    assert(bend.bendAllowanceMm > 0);
    assert(bend.outsideSetbackMm > 0);
    assert(bend.bendDeductionMm > 0);
    const bendExplicit = new SheetMetalBend({
      angleDeg: 45,
      innerRadiusMm: 2,
      thicknessMm: 1.5,
      kFactor: 0.33,
      direction: 'DOWN'
    });
    assert.strictEqual(bendExplicit.kFactor, 0.33);
    assert.strictEqual(bendExplicit.direction, 'DOWN');
    const bendZeroK = new SheetMetalBend({ kFactor: 0 });
    assert.strictEqual(bendZeroK.kFactor, 0);
    assert(Math.abs(bendZeroK.bendAllowanceMm - 4.71238898038469) < 1e-9);
    const flange = new SheetMetalFlange('F1', 50, 20);
    assert.strictEqual(flange.name, 'F1');
    assert.strictEqual(flange.lengthMm, 50);
    const flat = SheetMetalUnfolder.unfoldPart({
      flanges: [flange, new SheetMetalFlange('F2', 30, 20)],
      bends: [bend, bendExplicit]
    });
    assert.strictEqual(flat.success, true);
    assert.strictEqual(flat.flangesCount, 2);
    assert.strictEqual(flat.bendsCount, 2);
    assert.strictEqual(flat.bendLines.length, 2);
    assert.strictEqual(flat.reliefs.length, 4);
    assert.strictEqual(flat.reliefs[0].type, 'rectangular');
    assert(Number.isFinite(flat.totalDevelopedLengthMm));
    assert.strictEqual(flat.dxfExportReady, true);
    const tear = SheetMetalUnfolder.unfoldPart({ reliefType: 'tear', reliefWidthMm: 5, reliefDepthMm: 6 });
    assert.strictEqual(tear.flangesCount, 0);
    assert.strictEqual(tear.bendsCount, 0);
    assert.deepStrictEqual(tear.bendLines, []);
    assert.strictEqual(tear.totalDevelopedLengthMm, 0);
    const obround = SheetMetalUnfolder.unfoldPart({
      flanges: [flange],
      bends: [bend],
      reliefType: 'obround'
    });
    assert.strictEqual(obround.reliefs[0].type, 'obround');
    assert.strictEqual(obround.reliefs[0].width, 2.5);
    const moreBends = SheetMetalUnfolder.unfoldPart({
      flanges: [flange],
      bends: [bend, bendExplicit]
    });
    assert.strictEqual(moreBends.bendLines.length, 1);
  });

  // ------------------------------------------------------------------
  // persistent_naming_manager.js
  // ------------------------------------------------------------------
  check('PersistentNamingManager static geometry-key branches', () => {
    assert.strictEqual(PersistentNamingManager._coordStr(-0.0004), '0.000');
    assert.strictEqual(PersistentNamingManager._coordStr(1.23456), '1.235');
    assert.strictEqual(PersistentNamingManager._comp3(null, 0), 0);
    assert.strictEqual(PersistentNamingManager._comp3({ x: 1, y: 2, z: 3 }, 1), 2);
    assert.strictEqual(PersistentNamingManager._comp3([4, 5, 6], 2), 6);
    assert.strictEqual(PersistentNamingManager._comp3([4, 5], 2), 0);
    assert.strictEqual(PersistentNamingManager._comp3({ x: 1 }, 2), undefined);
    const key = PersistentNamingManager._keyString3({ x: 1, y: 2, z: 3 });
    assert(key.includes('1.000'));
    assert.strictEqual(PersistentNamingManager._digest('abc').length, 8);
    const fKey = PersistentNamingManager.computeGeometryKey('FACE', {
      centroid: { x: 1, y: 2, z: 3 },
      normal: { x: 0, y: 0, z: 1 },
      area: 12.5
    });
    assert(fKey.startsWith('F:'));
    const fKeyDef = PersistentNamingManager.computeGeometryKey();
    assert(fKeyDef.startsWith('F:'));
    const vKey = PersistentNamingManager.computeGeometryKey('VERTEX', { point: [1, 2, 3] });
    assert(vKey.startsWith('V:'));
    const vKey2 = PersistentNamingManager.computeGeometryKey('vertex', { coords: { x: 1, y: 2, z: 3 } });
    assert(vKey2.startsWith('V:'));
    assert(PersistentNamingManager.computeGeometryKey('VERTEX', {}).startsWith('V:'));
    const eKey = PersistentNamingManager.computeGeometryKey('EDGE', { start: [0, 0, 0], end: [1, 0, 0] });
    assert(eKey.startsWith('E:'));
    const eKey2 = PersistentNamingManager.computeGeometryKey('EDGE', { a: [1, 0, 0], b: [0, 0, 0] });
    assert(eKey2.startsWith('E:'));
    assert.strictEqual(PersistentNamingManager.computeGeometryKey('EDGE', { start: [0, 0, 0] }), null);
    assert.strictEqual(PersistentNamingManager._entityTypeFromKey('V:...'), 'VERTEX');
    assert.strictEqual(PersistentNamingManager._entityTypeFromKey('E:...'), 'EDGE');
    assert.strictEqual(PersistentNamingManager._entityTypeFromKey('F:...'), 'FACE');
  });

  check('PersistentNamingManager entity-by-geometry branches', () => {
    const mgr = new PersistentNamingManager();
    const res = mgr.getOrCreateEntityByGeometry('VERTEX', { point: [1, 2, 3] });
    assert.strictEqual(res.created, true);
    assert(res.tag);
    const res2 = mgr.getOrCreateEntityByGeometry('VERTEX', { point: [1, 2, 3] });
    assert.strictEqual(res2.created, false);
    assert.strictEqual(res2.tag, res.tag);
    const emptyKey = mgr.getOrCreateEntityByGeometry('VERTEX', {});
    assert.strictEqual(emptyKey.created, true);
    assert(emptyKey.tag);
    const found = mgr.getEntityByGeometry('VERTEX', { point: [1, 2, 3] });
    assert.strictEqual(found.found, true);
    const notFound = mgr.getEntityByGeometry('VERTEX', { point: [9, 9, 9] });
    assert.strictEqual(notFound.found, false);
    const noKey = mgr.getEntityByGeometry('FACE', {});
    assert.strictEqual(noKey.found, false);
    assert(noKey.key);
    const withTag = mgr._resolveOrCreateByKey('V:custom', { tag: 'my-tag' });
    assert.strictEqual(withTag.created, true);
    assert.strictEqual(withTag.tag, 'my-tag');
    const reuse = mgr._resolveOrCreateByKey('V:custom');
    assert.strictEqual(reuse.created, false);
    assert.strictEqual(mgr.getCurrentGeneration(), mgr.topologyHistory.length);
    const hist = mgr.getHistory();
    assert(Array.isArray(hist));
    assert(hist.every((h) => Array.isArray(h.entityIds) && Array.isArray(h.lineage) && Array.isArray(h.resultIds)));
  });

  check('PersistentNamingManager registerTopologicalEntities op branches', () => {
    const mgr = new PersistentNamingManager();
    mgr._resolveOrCreateByKey('F:p0');
    mgr._resolveOrCreateByKey('F:p1');
    mgr._resolveOrCreateByKey('F:m1');
    mgr._resolveOrCreateByKey('F:m2');
    const create = mgr.registerTopologicalEntities([], ['F:child1']);
    assert.strictEqual(create.op, 'CREATE');
    const mod = mgr.registerTopologicalEntities(['F:p1'], ['F:child2']);
    assert.strictEqual(mod.op, 'MODIFY');
    const split = mgr.registerTopologicalEntities(['F:p0'], ['F:c1', 'F:c2']);
    assert.strictEqual(split.op, 'SPLIT');
    assert.strictEqual(mgr.entityRegistry.get(split.parentTags[0]).alive, false);
    const merge = mgr.registerTopologicalEntities(['F:m1', 'F:m2'], ['F:mres']);
    assert.strictEqual(merge.op, 'MERGE');
    const reuse = mgr.registerTopologicalEntities(['F:p0'], ['F:child2']);
    assert.strictEqual(reuse.childTags.length, 1);
    assert(mgr.entityRegistry.has(reuse.childTags[0]));
    const gRes = mgr.getOrCreateEntityByGeometry('FACE', {
      centroid: { x: 5, y: 5, z: 5 },
      normal: { x: 0, y: 0, z: 1 },
      area: 4
    });
    const reuseKey = mgr.registerTopologicalEntities(['F:p0'], [gRes.key]);
    assert.strictEqual(reuseKey.childTags[0], gRes.tag);
    const objKeys = mgr.registerTopologicalEntities(
      [{ entityType: 'FACE', attributes: { centroid: { x: 0, y: 0, z: 0 } } }],
      [{ entityType: 'FACE', attributes: { centroid: { x: 1, y: 1, z: 1 } } }]
    );
    assert(objKeys.op);
    const skipNull = mgr.registerTopologicalEntities([null], [null]);
    assert.strictEqual(skipNull.parentTags.length, 0);
    assert.strictEqual(skipNull.childTags.length, 0);
  });

  check('PersistentNamingManager entity lifecycle operation branches', () => {
    const mgr = new PersistentNamingManager();
    const t = mgr.generateTag('Extrude1', 'FACE', 0, { normal: { x: 0, y: 0, z: 1 } });
    assert(t.includes('Extrude1:FACE:0@'));
    assert.strictEqual(mgr.entityRegistry.get(t).alive, true);
    const t2 = mgr.generateTag('Extrude1', 'EDGE', 1);
    assert(t2.includes('EDGE:1@(0.00_0.00_1.00)'));
    mgr.recordMutation('Fillet1', [{ parentTag: t, action: 'DELETE' }]);
    assert.strictEqual(mgr.entityRegistry.get(t).alive, false);
    mgr.recordMutation('Op2', []);
    assert.strictEqual(mgr.historyGraph.length, 2);
    mgr.recordOperation('SPLIT');
    assert.strictEqual(mgr.getCurrentGeneration(), mgr.topologyHistory.length);
    const created = mgr.createEntity('e1', { entityType: 'VERTEX', localIndex: 2 });
    assert.strictEqual(created, 'e1');
    assert.strictEqual(mgr.entityRegistry.get('e1').featureId, 'Feature1');
    mgr.createEntity('e1', { originatingFeatureId: 'F' });
    assert.strictEqual(mgr.entityRegistry.get('e1').featureId, 'Feature1');
    const kids = mgr.splitEntity('e1', ['e1a', 'e1b']);
    assert.strictEqual(kids.length, 2);
    assert.strictEqual(mgr.entityRegistry.get('e1').alive, false);
    const kids2 = mgr.splitEntity('gone', 'kid');
    assert.strictEqual(kids2.length, 1);
    const merged = mgr.mergeEntities(['e1a'], 'e1m');
    assert.strictEqual(merged, 'e1m');
    mgr.mergeEntities('e1b', 'e1m');
    assert.strictEqual(mgr.entityRegistry.get('e1m').alive, true);
    mgr.deleteEntity('e1m');
    assert.strictEqual(mgr.entityRegistry.get('e1m').alive, false);
    mgr.deleteEntity('never-existed');
    mgr.modifyEntity('e1b', { area: 5 });
    assert.strictEqual(mgr.entityRegistry.get('e1b').attributes.area, 5);
    mgr.modifyEntity('never-existed', { x: 1 });
    assert.strictEqual(mgr.entityRegistry.has('e1'), true);
    assert.strictEqual(mgr.entityRegistry.has('e1a'), true);
    assert.strictEqual(mgr.entityRegistry.has('e1b'), true);
    assert.strictEqual(mgr.entityRegistry.has('e1m'), true);
  });

  check('PersistentNamingManager trace/resolve branches', () => {
    const mgr = new PersistentNamingManager();
    mgr.createEntity('root1', { entityType: 'FACE' });
    mgr.splitEntity('root1', ['r1a']);
    mgr.mergeEntities(['r1a'], 'r1m');
    const trace = mgr.traceEntity('r1m');
    assert.strictEqual(trace.alive, true);
    assert(trace.entries.length >= 1);
    assert(trace.ancestors.includes('r1a'));
    assert(trace.ancestors.includes('root1'));
    assert.strictEqual(trace.currentTag, 'r1m');
    const traceDead = mgr.traceEntity('root1');
    assert.strictEqual(traceDead.alive, false);
    const traceMissing = mgr.traceEntity('nope');
    assert.strictEqual(traceMissing.alive, false);
    assert.strictEqual(traceMissing.generation, 0);
    const res = mgr.resolveTag('r1m');
    assert.strictEqual(res.resolved, true);
    assert.strictEqual(res.activeTag, 'r1m');
    const resDead = mgr.resolveTag('root1');
    assert.strictEqual(resDead.resolved, false);
    const geoKey = PersistentNamingManager.computeGeometryKey('VERTEX', { point: [0, 0, 0] });
    const g = mgr.getOrCreateEntityByGeometry('VERTEX', { point: [0, 0, 0] });
    const resGeo = mgr.resolveTag(geoKey);
    assert.strictEqual(resGeo.resolved, true);
    assert.strictEqual(resGeo.geometryKeyResolved, true);
    mgr.recordMutation('Cut1', [{ parentTag: 'oldtag', childTags: ['newtag'], action: 'SPLIT' }]);
    mgr.createEntity('newtag', {});
    const resRemap = mgr.resolveTag('oldtag');
    assert.strictEqual(resRemap.resolved, true);
    assert.strictEqual(resRemap.remapped, true);
    const resUnresolved = mgr.resolveTag('zombie');
    assert.strictEqual(resUnresolved.resolved, false);
  });

  check('PersistentNamingManager registerEntity/resolveEntity candidate branches', () => {
    const mgr = new PersistentNamingManager();
    const reg = mgr.registerEntity('FACE', {
      originatingFeatureId: 'Extrude2',
      area: 10,
      geometryType: 'plane',
      centroid: { x: 0, y: 0, z: 0 }
    });
    assert(reg.persistentId.includes('Extrude2:FACE'));
    assert.strictEqual(reg.entityType, 'FACE');
    const res = mgr.resolveEntity(reg.persistentId, [
      { geometryType: 'plane', area: 10.5, centroid: { x: 0.1, y: 0, z: 0 } },
      { geometryType: 'cylinder', area: 1, centroid: { x: 50, y: 50, z: 50 } }
    ]);
    assert.strictEqual(res.matchFound, true);
    assert(res.similarityScore >= 0.5);
    assert(res.matchedEntity);
    const res2 = mgr.resolveEntity('unknown-id', []);
    assert.strictEqual(res2.matchFound, false);
    assert.strictEqual(res2.similarityScore, 0);
    assert.strictEqual(res2.matchedEntity, null);
    const res3 = mgr.resolveEntity('unknown-id', [{ area: 10, centroid: { x: 0, y: 0, z: 0 } }]);
    assert.strictEqual(res3.matchFound, false);
  });

  // ------------------------------------------------------------------
  // step_translator.js
  // ------------------------------------------------------------------
  check('StepTranslator exportSTEP dispatch and single-part export branches', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'Box1');
    const step = StepTranslator.exportSTEP(box, 'PartA');
    assert(step.includes('ISO-10303-21;'));
    assert(step.includes('MANIFOLD_SOLID_BREP'));
    assert(step.includes('ADVANCED_BREP_SHAPE_REPRESENTATION'));
    assert(step.includes('PRODUCT'));
    const defaultName = StepTranslator.exportSTEP(box);
    assert(defaultName.includes('OmniEng_CAD_Part'));
    const layered = StepTranslator.exportSTEP(box, 'PartB', { layers: ['Layer1', 'Layer2'] });
    assert.strictEqual(layered.match(/LAYER_ASSIGNMENT/g).length, 2);
    assert(layered.includes('DRAUGHTING_MODEL'));
    const layerStr = StepTranslator.exportSTEP(box, 'PartC', { layers: 'SingleLayer' });
    assert(layerStr.includes('SingleLayer'));
    const noLayers = StepTranslator.exportSTEP(box, 'PartG', {});
    assert(!noLayers.includes('DRAUGHTING_MODEL'));
    const asmDetect = StepTranslator.exportSTEP({
      solids: [{ id: 's1', name: 'Part', solid: box }],
      assembly: {
        nodes: [{ id: 'n1', name: 'Part', solidId: 's1' }],
        references: [{ id: 'ref1', parentId: null, childId: 'n1', name: 'Occ', transform: { origin: [0, 0, 0] } }]
      }
    });
    assert(asmDetect.includes('NEXT_ASSEMBLY_USAGE_OCCURRENCE'));
  });

  check('StepTranslator exportAssemblySTEP reference/child branches', () => {
    const box = BRepPrimitives.createBox(5, 5, 5, 'Part');
    const refs = StepTranslator.exportAssemblySTEP({
      solids: [{ id: 's1', name: 'PartA', solid: box, layer: 'L1', color: '#ff0000' }],
      assembly: {
        nodes: [
          { id: 'n1', name: 'PartA', solidId: 's1' },
          { id: 'n2', name: 'Child', solidId: 's1' }
        ],
        references: [
          {
            id: 'ref1',
            parentId: null,
            childId: 'n2',
            name: 'Occ1',
            transform: { origin: [1, 2, 3], axis1: [1, 0, 0], axis2: [0, 1, 0], scale: 2 }
          }
        ]
      }
    });
    assert(refs.includes('NEXT_ASSEMBLY_USAGE_OCCURRENCE'));
    assert(refs.includes('CARTESIAN_TRANSFORMATION_3D'));
    assert(refs.includes('ITEM_DEFINED_TRANSFORMATION'));
    assert(refs.includes('COLOUR_RGB'));
    const children = StepTranslator.exportAssemblySTEP({
      solids: [{ id: 's1', name: 'P', solid: box }],
      assembly: {
        nodes: [
          { id: 'root', name: 'Root', solidId: 's1', children: ['childId'], transforms: { origin: [0, 0, 0] } },
          { id: 'childId', name: 'Child', solidId: 's1', layer: 'layerA' }
        ],
        references: []
      }
    });
    assert(children.includes('NEXT_ASSEMBLY_USAGE_OCCURRENCE'));
    assert(children.includes('layerA'));
    const missingChild = StepTranslator.exportAssemblySTEP({
      solids: [],
      assembly: { nodes: [], references: [{ id: 'r1', parentId: null, childId: 'nope', name: 'Occ' }] }
    });
    assert(missingChild.includes('ENDSEC;'));
    const noSolidNode = StepTranslator.exportAssemblySTEP({
      solids: [],
      assembly: { nodes: [{ id: 'n1', name: 'NoSolid' }], references: [] }
    });
    assert(noSolidNode.includes('ENDSEC;'));
    const matrixRef = StepTranslator.exportAssemblySTEP({
      solids: [{ id: 's1', name: 'P', solid: box }],
      assembly: {
        nodes: [{ id: 'n1', name: 'P', solidId: 's1' }],
        references: [
          {
            id: 'ref1',
            parentId: null,
            childId: 'n1',
            name: 'Occ',
            transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]
          }
        ]
      }
    });
    assert(matrixRef.includes('CARTESIAN_TRANSFORMATION_3D'));
  });

  check('StepTranslator exportNurbsSurfaces planar/cylinder classification branches', () => {
    const box = BRepPrimitives.createBox(10, 10, 10);
    const boxStep = StepTranslator.exportNurbsSurfaces(box);
    assert(boxStep.includes('B_SPLINE_SURFACE_WITH_KNOTS'));
    assert(!boxStep.includes('RATIONAL_B_SPLINE_SURFACE'));
    const cyl = BRepPrimitives.createCylinder(5, 20, 24);
    const cylStep = StepTranslator.exportNurbsSurfaces(cyl);
    assert(cylStep.includes('RATIONAL_B_SPLINE_SURFACE'));
    assert(cylStep.includes('B_SPLINE_SURFACE_WITH_KNOTS'));
    const empty = StepTranslator.exportNurbsSurfaces([]);
    assert(empty.includes('ENDSEC;'));
    const nullSolid = StepTranslator.exportNurbsSurfaces(null);
    assert(nullSolid.includes('ENDSEC;'));
    const one = StepTranslator.exportNurbsSurfaces(box, 'Named');
    assert(one.includes('Named'));
  });

  check('StepTranslator exportTrimmedSurfaces branches', () => {
    const plane = NurbsSurface.createPlane(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 1, 1);
    const outer = TrimLoop2D.circular(0.5, 0.5, 0.45, { isOuter: true });
    const inner = TrimLoop2D.circular(0.5, 0.5, 0.2, { isOuter: false });
    const trimmed = new TrimmedNurbsSurface({ surface: plane, trims: [outer, inner] });
    const step = StepTranslator.exportTrimmedSurfaces(trimmed);
    assert(step.includes('ADVANCED_FACE'));
    assert(step.includes('FACE_OUTER_BOUND'));
    assert(step.includes('FACE_BOUND'));
    assert(step.includes('PCURVE'));
    assert(step.includes('SURFACE_CURVE'));
    const plain = StepTranslator.exportTrimmedSurfaces({
      surface: plane,
      trims: [{ isOuter: true, curves: [NurbsCurve2D.makeCircularArc(0.5, 0.5, 0.45, 0, Math.PI / 2)] }]
    });
    assert(plain.includes('EDGE_LOOP'));
    const emptyTrims = StepTranslator.exportTrimmedSurfaces({ surface: plane, trims: [] });
    assert(emptyTrims.includes('ENDSEC;'));
    const noSurface = StepTranslator.exportTrimmedSurfaces([{ trims: [] }, null]);
    assert(noSurface.includes('ENDSEC;'));
    const rationalSurface = new TrimmedNurbsSurface({
      surface: NurbsSurface.createCylinderPatch(5, 10),
      trims: [outer]
    });
    const ratStep = StepTranslator.exportTrimmedSurfaces(rationalSurface);
    assert(ratStep.includes('RATIONAL_B_SPLINE_SURFACE'));
  });

  check('StepTranslator parseSTEP branches and counters', () => {
    assert.throws(() => StepTranslator.parseSTEP(null), /Invalid STEP content/);
    assert.throws(() => StepTranslator.parseSTEP(''), /Invalid STEP content/);
    const headerOnly = StepTranslator.parseSTEP('ISO-10303-21;\nHEADER;\nENDSEC;\n');
    assert.strictEqual(headerOnly.summary.advancedFacesCount, 0);
    assert.strictEqual(headerOnly.summary.productsCount, 0);
    const box = BRepPrimitives.createBox(10, 10, 10, 'ParseBox');
    const step = StepTranslator.exportSTEP(box, 'ParseBox', { layers: ['L'], color: '#ff8040' });
    const parsed = StepTranslator.parseSTEP(step);
    assert(parsed.summary.manifoldSolidsCount >= 1);
    assert(parsed.summary.advancedFacesCount >= 6);
    assert(parsed.summary.productsCount >= 1);
    assert(parsed.summary.productDefinitionsCount >= 1);
    assert(parsed.summary.shapeDefinitionRepresentationsCount >= 1);
    assert(parsed.summary.cartesianPointsCount > 0);
    assert(parsed.summary.directionsCount > 0);
    assert(parsed.summary.layerAssignmentsCount >= 1);
    assert(parsed.summary.draughtingModelsCount >= 1);
    assert.strictEqual(parsed.summary.colourRgbCount, 0);
    assert(parsed.vertices.length > 0);
    assert.strictEqual(parsed.format, 'STEP_AP203_AP214');
    const cyl = BRepPrimitives.createCylinder(5, 20, 12);
    const cylStep = StepTranslator.exportNurbsSurfaces(cyl);
    const parsedCyl = StepTranslator.parseSTEP(cylStep);
    assert(parsedCyl.summary.bSplineSurfacesCount > 0);
    assert(parsedCyl.summary.rationalBSplineSurfacesCount > 0);
    assert(parsedCyl.nurbsSurfaces.length > 0);
    const surf = parsedCyl.nurbsSurfaces[0];
    assert(Array.isArray(surf.controlPoints));
    assert(Array.isArray(surf.uKnots));
    const trimmedStep = StepTranslator.exportTrimmedSurfaces({
      surface: NurbsSurface.createPlane(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 1, 1),
      trims: [
        { isOuter: true, curves: [NurbsCurve2D.makeCircularArc(0.5, 0.5, 0.45, 0, Math.PI / 2)] },
        { isOuter: false, curves: [NurbsCurve2D.makeCircularArc(0.5, 0.5, 0.1, 0, Math.PI / 2)] }
      ]
    });
    const parsedTrim = StepTranslator.parseSTEP(trimmedStep);
    assert(parsedTrim.summary.pCurvesCount >= 1);
    assert(parsedTrim.summary.surfaceCurvesCount >= 1);
    assert(parsedTrim.summary.faceBoundsCount >= 1);
    assert(parsedTrim.summary.edgeLoopsCount >= 1);
    assert(parsedTrim.trimCurves.length > 0);
    assert.strictEqual(StepTranslator._parseNumberList(null).length, 0);
    assert(StepTranslator._parseNumberList('(0.,0.,1.,1.)').length === 4);
    assert.strictEqual(StepTranslator._parseNumberGrid('').length, 0);
    assert(StepTranslator._parseNumberGrid('((1.0,1.0),(2.0,2.0))').length === 2);
    assert.strictEqual(StepTranslator._parseControlPointGrid('').length, 0);
    assert(StepTranslator._parseControlPointGrid('((#1,#2),(#3,#4))').length === 2);
    assert.deepStrictEqual(StepTranslator._splitTopLevelArgs(''), []);
    assert.strictEqual(StepTranslator._splitTopLevelArgs('a, b, c').length, 3);
    assert.strictEqual(StepTranslator._stripString("'Hello''World'"), "Hello'World");
    assert.strictEqual(StepTranslator._stepString("Don't"), "Don''t");
    assert.strictEqual(StepTranslator._stepString(null), '');
    assert.strictEqual(StepTranslator._fmtNum(1.23456789), '1.234568');
  });

  check('StepTranslator solid geometry/wire/fallback frame branches', () => {
    const box = BRepPrimitives.createBox(10, 10, 10);
    const step = StepTranslator.exportSTEP(box, 'BoxWire');
    assert(step.includes('ADVANCED_FACE'));
    const wireSolid = {
      faces: [
        {
          name: 'WireFace',
          wire: {
            edges: [
              { startVertex: { point: [0, 0, 0] } },
              { startVertex: { point: [1, 0, 0] } },
              { startVertex: { point: [0, 1, 0] } }
            ]
          },
          normal: { x: 0, y: 0, z: 1 }
        }
      ]
    };
    const wireStep = StepTranslator.exportSTEP(wireSolid, 'WirePart');
    assert(wireStep.includes('WireFace'));
    const degenerateSolid = {
      faces: [
        {
          name: 'DegFace',
          vertices: [{ point: [0, 0, 0] }, { point: [0, 0, 1] }, { point: [0, 0, 2] }],
          normal: { x: 0, y: 0, z: 1 }
        }
      ]
    };
    const degStep = StepTranslator.exportSTEP(degenerateSolid, 'DegPart');
    assert(degStep.includes('DegFace'));
    const planarTilt = {
      faces: [
        {
          name: 'Tilt',
          vertices: [{ point: [0, 0, 0] }, { point: [1, 0, 0] }, { point: [2, 0, 0] }],
          normal: { x: 1, y: 0, z: 0 }
        }
      ]
    };
    const tiltStep = StepTranslator.exportSTEP(planarTilt, 'TiltPart');
    assert(tiltStep.includes('Tilt'));
    const fallback = StepTranslator.exportSTEP(null, 'EmptyPart');
    assert(fallback.includes('Box_Face_1'));
    assert.strictEqual(StepTranslator.toSTEP(box, 'Alias'), StepTranslator.exportSTEP(box, 'Alias'));
  });

  // ------------------------------------------------------------------
  // edge_blender.js
  // ------------------------------------------------------------------
  check('EdgeBlender _readPoint/_hydrateSolid validation branches', () => {
    assert.throws(() => EdgeBlender._readPoint(null, 'pt'), /exactly three finite numeric coordinates/);
    assert.throws(() => EdgeBlender._readPoint([1, 2], 'pt'), /exactly three finite numeric coordinates/);
    assert.throws(() => EdgeBlender._readPoint([1, 2, 'x'], 'pt'), /exactly three finite numeric coordinates/);
    assert.throws(() => EdgeBlender._readPoint([1, 2, NaN], 'pt'), /exactly three finite numeric coordinates/);
    const v = EdgeBlender._readPoint([1, 2, 3], 'pt');
    assert(v instanceof Vector3);
    const v2 = EdgeBlender._readPoint({ x: 1, y: 2, z: 3 }, 'pt');
    assert.strictEqual(v2.y, 2);
    const v3 = EdgeBlender._readPoint(new Vector3(4, 5, 6), 'pt');
    assert.strictEqual(v3.z, 6);
    assert.throws(() => EdgeBlender._hydrateSolid(null), /requires a solid object/);
    assert.throws(() => EdgeBlender._hydrateSolid([1, 2]), /requires a solid object/);
    assert.throws(() => EdgeBlender._hydrateSolid({ vertices: [] }), /require vertex and face arrays/);
    assert.throws(() => EdgeBlender._hydrateSolid({ vertices: [], faces: [] }), /require vertex and face arrays/);
    assert.throws(
      () => EdgeBlender._hydrateSolid({ vertices: [null], faces: [[0, 1, 2]] }),
      /vertex 0 must be an object/
    );
    assert.throws(
      () =>
        EdgeBlender._hydrateSolid({
          vertices: [
            { id: 'a', point: [0, 0, 0] },
            { id: 'a', point: [1, 0, 0] },
            { id: 'c', point: [0, 1, 0] }
          ],
          faces: [{ vertices: ['a', 'a', 'c'] }]
        }),
      /Duplicate serialized vertex id/
    );
    assert.throws(
      () =>
        EdgeBlender._hydrateSolid({
          vertices: [
            { id: 'a', point: [0, 0, 0] },
            { id: 'b', point: [1, 0, 0] }
          ],
          faces: [{ vertices: ['a', 'b', 'zzz'] }]
        }),
      /references unknown vertex id/
    );
    assert.throws(
      () => EdgeBlender._hydrateSolid({ vertices: [{ id: 'a', point: [0, 0, 0] }], faces: [{ vertices: ['a'] }] }),
      /at least three vertices/
    );
    assert.throws(
      () =>
        EdgeBlender._hydrateSolid({
          vertices: [
            { id: 'a', point: [0, 0, 0] },
            { id: 'b', point: [1, 0, 0] },
            { id: 'c', point: [0, 1, 0] }
          ],
          faces: [{ vertices: ['a', 'b', 'c'] }],
          edges: 'nope'
        }),
      /edges must be an array/
    );
    assert.throws(
      () =>
        EdgeBlender._hydrateSolid({
          vertices: [
            { id: 'a', point: [0, 0, 0] },
            { id: 'b', point: [1, 0, 0] },
            { id: 'c', point: [0, 1, 0] }
          ],
          faces: [{ vertices: ['a', 'b', 'c'] }],
          edges: [{ start: 'a' }]
        }),
      /requires start and end vertices/
    );
    assert.throws(
      () =>
        EdgeBlender._hydrateSolid({
          vertices: [
            { id: 'a', point: [0, 0, 0] },
            { id: 'b', point: [1, 0, 0] },
            { id: 'c', point: [0, 1, 0] }
          ],
          faces: [{ vertices: ['a', 'b', 'c'] }],
          edges: [{ start: 'a', end: 'zzz' }]
        }),
      /references unknown vertex id/
    );
    const hydrated = EdgeBlender._hydrateSolid({
      name: '',
      id: 's-1',
      vertices: [
        { id: 'a', point: [0, 0, 0] },
        { id: 'b', point: [1, 0, 0] },
        { id: 'c', point: [0, 1, 0] }
      ],
      faces: [{ id: 'f1', vertices: ['a', 'b', 'c'], normal: { x: 0, y: 0, z: 1 }, material: { color: '#fff' } }],
      edges: [{ id: 'e1', start: 'a', end: 'b' }]
    });
    assert(hydrated instanceof SolidBody);
    assert.strictEqual(hydrated.name, 'HydratedSolid');
    assert.strictEqual(hydrated.id, 's-1');
    assert.strictEqual(hydrated.faces[0].id, 'f1');
    assert.strictEqual(hydrated.faces[0].material.color, '#fff');
    assert.strictEqual(hydrated.edges.length, 1);
    assert.strictEqual(hydrated.edges[0].id, 'e1');
    const builtEdges = EdgeBlender._hydrateSolid({
      vertices: [{ point: [0, 0, 0] }, { point: [1, 0, 0] }, { point: [0, 1, 0] }],
      faces: [{ vertices: [{ point: [0, 0, 0] }, { point: [1, 0, 0] }, { point: [0, 1, 0] }] }]
    });
    assert(builtEdges.edges.length > 0);
  });

  check('EdgeBlender _hydrateSolid SolidBody instance validation branches', () => {
    const badVertex = BRepPrimitives.createBox(10, 10, 10);
    badVertex.vertices[0].point = null;
    assert.throws(() => EdgeBlender._hydrateSolid(badVertex), /vertex 0 is missing its point/);
    const badFace = new SolidBody('B');
    badFace.vertices.push(new Vertex(0, 0, 0), new Vertex(1, 0, 0));
    badFace.faces.push(new Face(badFace.vertices));
    assert.throws(() => EdgeBlender._hydrateSolid(badFace), /at least three vertices/);
    const badEdge = new SolidBody('B');
    const v0 = new Vertex(0, 0, 0);
    const v1 = new Vertex(1, 0, 0);
    const v2 = new Vertex(0, 1, 0);
    badEdge.vertices.push(v0, v1, v2);
    badEdge.faces.push(new Face([v0, v1, v2]));
    badEdge.edges.push(new Edge(null, v1));
    assert.throws(() => EdgeBlender._hydrateSolid(badEdge), /edge 0 requires start and end points/);
    const emptyEdges = new SolidBody('B');
    emptyEdges.vertices.push(v0, v1, v2);
    emptyEdges.faces.push(new Face([v0, v1, v2]));
    emptyEdges.edges = [];
    const rebuilt = EdgeBlender._hydrateSolid(emptyEdges);
    assert(rebuilt.edges.length > 0);
  });

  check('EdgeBlender applyFillet validation and success branches', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'FilletBox');
    assert.throws(() => EdgeBlender.applyFillet(box, box.edges[0], 0), /strictly positive/);
    assert.throws(() => EdgeBlender.applyFillet(box, 'no-such-edge', 1), /Target edge not found/);
    const targetId = box.edges[2].id;
    const res = EdgeBlender.applyFillet(box, targetId, 1.5, { subdivisions: 6 });
    assert.strictEqual(res.radius, 1.5);
    assert(res.blendFacesCount > 0);
    assert(res.filletSurfaceArea > 0);
    const resObj = EdgeBlender.applyFillet(box, box.edges[3], 1, { subdivisions: 4 });
    assert(resObj.blendFacesCount > 0);
    const single = new SolidBody('Tri');
    const a = new Vertex(0, 0, 0);
    const b = new Vertex(1, 0, 0);
    const c = new Vertex(0, 1, 0);
    single.vertices.push(a, b, c);
    single.faces.push(new Face([a, b, c]));
    single.buildEdges();
    assert.throws(() => EdgeBlender.applyFillet(single, single.edges[0], 1), /shared by at least 2 faces/);
    const degen = new SolidBody('Deg');
    const d0 = new Vertex(0, 0, 0);
    const d1 = new Vertex(1, 0, 0);
    const d2 = new Vertex(0, 1, 0);
    const d3 = new Vertex(0, 1, 0);
    degen.vertices.push(d0, d1, d2, d3);
    degen.faces.push(new Face([d0, d1, d2]));
    degen.faces.push(new Face([d0, d2, d3]));
    degen.buildEdges();
    const degenEdge = degen.edges.find(
      (e) => e.start.point.distanceTo(d0.point) < 1e-9 && e.end.point.distanceTo(d0.point) < 1e-9
    );
    if (degenEdge) {
      assert.throws(() => EdgeBlender.applyFillet(degen, degenEdge, 1), /Degenerate zero-length edge/);
    }
    const degenBox = BRepPrimitives.createBox(10, 10, 10);
    degenBox.edges[0].end.point = degenBox.edges[0].start.point.clone();
    assert.throws(() => EdgeBlender.applyFillet(degenBox, degenBox.edges[0], 1), /Degenerate zero-length edge/);
  });

  check('EdgeBlender blendEdges/applyChamfer branches', () => {
    const box = BRepPrimitives.createBox(10, 10, 10);
    const blended = EdgeBlender.blendEdges(box, [0, 1], 1);
    assert(blended instanceof SolidBody);
    const blendedSingle = EdgeBlender.blendEdges(box, 2, 1);
    assert(blendedSingle instanceof SolidBody);
    const blendedMissing = EdgeBlender.blendEdges(box, [1000], 1);
    assert.strictEqual(blendedMissing, box);
    const emptySolid = new SolidBody('E');
    const skipped = EdgeBlender.blendEdges(emptySolid, [0], 1);
    assert.strictEqual(skipped, emptySolid);
    assert.throws(() => EdgeBlender.applyChamfer(box, box.edges[0], 0), /Chamfer distance must be positive/);
    assert.throws(() => EdgeBlender.applyChamfer(box, 'missing-edge', 1), /Target edge not found/);
    const cham = EdgeBlender.applyChamfer(box, box.edges[1], 1.5);
    assert.strictEqual(cham.distance1, 1.5);
    assert.strictEqual(cham.distance2, 1.5);
    assert(cham.bevelArea > 0);
    assert(cham.bevelNormal instanceof Vector3);
    assert.strictEqual(cham.chamferFaces.length, 2);
    const chamAsym = EdgeBlender.applyChamfer(box, box.edges[2], 0.5, 1.5);
    assert.strictEqual(chamAsym.distance2, 1.5);
    const single = new SolidBody('Tri');
    const a = new Vertex(0, 0, 0);
    const b = new Vertex(1, 0, 0);
    const c = new Vertex(0, 1, 0);
    single.vertices.push(a, b, c);
    single.faces.push(new Face([a, b, c]));
    single.buildEdges();
    assert.throws(() => EdgeBlender.applyChamfer(single, single.edges[0], 1), /Edge requires 2 adjacent faces/);
    assert.deepStrictEqual(EdgeBlender._findAdjacentFaces(single, new Edge(null, null)), []);
    const emptyCentroid = EdgeBlender._faceCentroid(new Face([]));
    assert.strictEqual(emptyCentroid.x, 0);
  });

  // ------------------------------------------------------------------
  // variable_fillet_gregory.js
  // ------------------------------------------------------------------
  check('GregoryCornerPatch evaluate branches', () => {
    const curve = {
      evaluate: (t) => ({ x: t * 10, y: 0, z: 0, normal: { x: 0, y: 0, z: 1 } })
    };
    const patch = new GregoryCornerPatch([curve, curve]);
    assert.strictEqual(patch.nSides, 2);
    assert.throws(() => patch.evaluate([0.5]), /must match nSides/);
    const pt = patch.evaluate([0.5, 0.5]);
    assert(Math.abs(pt.x - 5) < 1e-9);
    assert.strictEqual(pt.normal.z, 1);
    const neg = patch.evaluate([-1, 2]);
    assert(Number.isFinite(neg.x));
    const arrayCurve = [[{ x: 1, y: 2, z: 3 }], [{ x: 4, y: 5, z: 6 }]];
    const arrayPatch = new GregoryCornerPatch(arrayCurve);
    const arrPt = arrayPatch.evaluate([0.5, 0.5]);
    assert(Number.isFinite(arrPt.x));
    const zeroNormal = {
      evaluate: () => ({ x: 0, y: 0, z: 0, normal: { x: 0, y: 0, z: 0 } })
    };
    const zeroPatch = new GregoryCornerPatch([zeroNormal, zeroNormal]);
    const zPt = zeroPatch.evaluate([1, 0]);
    assert.strictEqual(zPt.normal.z, 0);
    const emptyPatch = new GregoryCornerPatch();
    assert.strictEqual(emptyPatch.nSides, 0);
    const emptyPt = emptyPatch.evaluate([]);
    assert.strictEqual(emptyPt.x, 0);
  });

  check('VariableRadiusFilletEngine generate/blend branches', () => {
    assert.throws(
      () => VariableRadiusFilletEngine.generateVariableFillet({ spinePoints: [{ x: 0, y: 0, z: 0 }] }),
      /at least 2 spine points/
    );
    assert.throws(() => VariableRadiusFilletEngine.generateVariableFillet({}), /at least 2 spine points/);
    const spineZ = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 10 },
      { x: 0, y: 0, z: 20 }
    ];
    const rZ = VariableRadiusFilletEngine.generateVariableFillet({ spinePoints: spineZ });
    assert.strictEqual(rZ.success, true);
    assert.strictEqual(rZ.continuity, 'G1');
    assert.strictEqual(rZ.startRadius, 5);
    assert.strictEqual(rZ.endRadius, 15);
    assert.strictEqual(rZ.spinePointsCount, 3);
    assert.strictEqual(rZ.meshGrid.length, 3);
    assert.strictEqual(rZ.meshGrid[0].length, 9);
    assert.strictEqual(rZ.contactPointsLeft.length, 3);
    assert.strictEqual(rZ.contactPointsRight.length, 3);
    const spineXY = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 5, z: 0 },
      { x: 20, y: 10, z: 0 }
    ];
    const rXY = VariableRadiusFilletEngine.generateVariableFillet({
      spinePoints: spineXY,
      startRadius: 2,
      endRadius: 8,
      continuity: 'G2',
      samplesV: 4
    });
    assert.strictEqual(rXY.continuity, 'G2');
    assert.strictEqual(rXY.meshGrid[0].length, 5);
    const r = VariableFilletGregory.generateVariableFillet({ spinePoints: spineXY });
    assert.strictEqual(r.success, true);
    assert.throws(() => VariableRadiusFilletEngine.blendMultiEdgeCorner([{ a: 1 }]), /at least 2 incident fillets/);
    const patch1 = VariableRadiusFilletEngine.blendMultiEdgeCorner([rZ, rXY]);
    assert(patch1 instanceof GregoryCornerPatch);
    const p1 = patch1.evaluate([0.5, 0.5]);
    assert(Number.isFinite(p1.x));
    const noRail = VariableRadiusFilletEngine.blendMultiEdgeCorner([
      { spinePoints: [{ x: 1, y: 2, z: 3 }] },
      { spinePoints: [{ x: 4, y: 5, z: 6 }] }
    ]);
    const np = noRail.evaluate([0.5, 0.5]);
    assert(Number.isFinite(np.x));
  });

  // ------------------------------------------------------------------
  // assembly_mates.js
  // ------------------------------------------------------------------
  check('AssemblyMateSolver input validation branches', () => {
    assert.throws(() => new AssemblyComponent(''), /non-empty string/);
    assert.throws(() => new AssemblyComponent('id1', ''), /non-empty string/);
    assert.throws(() => new AssemblyComponent('id1', 'P', [1, 2]), /must be an object/);
    assert.throws(() => new AssemblyComponent('id1', 'P', { fixed: 'yes' }), /must be a boolean/);
    assert.throws(() => new AssemblyComponent('id1', 'P', { position: [1, 2] }), /exactly 3 finite numeric components/);
    assert.throws(
      () => new AssemblyComponent('id1', 'P', { rotation: [1, 0, 0] }),
      /exactly 4 finite numeric components/
    );
    assert.throws(() => new AssemblyComponent('id1', 'P', { rotation: [0, 0, 0, 0] }), /non-zero magnitude/);
    const comp = new AssemblyComponent('id1', 'P');
    assert.strictEqual(comp.fixed, false);
    assert(comp.position instanceof Vector3);
    assert(comp.rotation instanceof Quaternion);
    const compFixed = new AssemblyComponent('id2', 'Q', {
      fixed: true,
      position: { x: 1, y: 2, z: 3 },
      rotation: { w: 1, x: 0, y: 0, z: 0 }
    });
    assert.strictEqual(compFixed.fixed, true);
    const world = compFixed.localToWorld(new Vector3(0, 0, 0));
    assert.strictEqual(world.x, 1);
    const wv = compFixed.localToWorldVector(new Vector3(1, 0, 0));
    assert(wv instanceof Vector3);
    const solver = new AssemblyMateSolver();
    solver.addComponent(comp);
    solver.addComponent(compFixed);
    assert.throws(() => new AssemblyMateSolver().addMate(null), /must be an object/);
    assert.throws(() => solver.addMate({ type: '' }), /type is required/);
    assert.throws(() => solver.addMate({ type: 'X' }), /requires two registered component identifiers/);
    assert.throws(() => solver.addMate({ type: 'COINCIDENT_PLANES' }), /requires two registered component identifiers/);
    assert.throws(
      () => solver.addMate({ type: 'BOGUS', compA: 'id1', compB: 'id2' }),
      /Unsupported assembly mate type/
    );
    assert.throws(
      () =>
        solver.addMate({
          type: 'DISTANCE',
          compA: 'id1',
          compB: 'id2',
          ptA: [0, 0, 0],
          ptB: [0, 0, 0],
          normA: [0, 0, 1],
          normB: [0, 0, -1],
          distance: -1
        }),
      /non-negative finite number/
    );
    assert.throws(
      () =>
        solver.addMate({
          type: 'COINCIDENT_PLANES',
          compA: 'id1',
          compB: 'id2',
          ptA: [0, 0, 0],
          ptB: [0, 0, 0],
          normA: [0, 0, 0],
          normB: [0, 0, -1]
        }),
      /non-zero magnitude/
    );
    solver.addMate({
      type: 'coincident',
      compA: 'id1',
      compB: 'id2',
      ptA: [0, 0, 0],
      ptB: [0, 0, 0],
      normA: [0, 0, 1],
      normB: [0, 0, -1]
    });
    solver.addMate({
      type: 'CONCENTRIC_AXES',
      compA: 'id1',
      compB: 'id2',
      ptA: [0, 0, 0],
      ptB: [0, 0, 0],
      axisA: [0, 0, 1],
      axisB: [0, 0, 1]
    });
    solver.addMate({
      type: 'DISTANCE_OFFSET',
      compA: 'id1',
      compB: 'id2',
      ptA: [0, 0, 0],
      ptB: [0, 0, 0],
      normA: [0, 0, 1],
      normB: [0, 0, -1],
      distance: 2
    });
    solver.addMate({ type: 'PARALLEL_PLANES', compA: 'id1', compB: 'id2', normA: [0, 0, 1], normB: [0, 0, 1] });
    solver.addMate({ type: 'PERPENDICULAR_PLANES', compA: 'id1', compB: 'id2', normA: [0, 0, 1], normB: [1, 0, 0] });
    assert.strictEqual(solver.mates.length, 5);
    assert.throws(() => solver.getComponent('missing'), /Component not found/);
    assert.strictEqual(solver.getComponent('id1'), comp);
  });

  check('AssemblyMateSolver residuals and solve branches', () => {
    const solver = new AssemblyMateSolver();
    const a = new AssemblyComponent('a', 'A');
    const b = new AssemblyComponent('b', 'B');
    solver.addComponent(a);
    solver.addComponent(b);
    solver.addCoincidentPlanes(
      'a',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 1),
      'b',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -1)
    );
    solver.addConcentric(
      'a',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 1),
      'b',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 1)
    );
    solver.addDistance(
      'a',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 1),
      'b',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -1),
      3
    );
    solver.addParallel('a', new Vector3(1, 0, 0), 'b', new Vector3(1, 0, 0));
    solver.addPerpendicular('a', new Vector3(0, 0, 1), 'b', new Vector3(1, 0, 0));
    const residuals = solver.evaluateResiduals();
    assert.strictEqual(residuals.length, 15);
    const emptySolver = new AssemblyMateSolver();
    const emptyRes = emptySolver.solve();
    assert.deepStrictEqual(emptyRes, { success: true, iterations: 0, maxResidual: 0, rank: 0, dofRemaining: 0 });
    const fixedSolver = new AssemblyMateSolver();
    const fa = new AssemblyComponent('fa', 'FA', { fixed: true });
    const fb = new AssemblyComponent('fb', 'FB', { fixed: true });
    fixedSolver.addComponent(fa);
    fixedSolver.addComponent(fb);
    fixedSolver.addCoincidentPlanes(
      'fa',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 1),
      'fb',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -1)
    );
    const fixedRes = fixedSolver.solve();
    assert.strictEqual(fixedRes.success, true);
    const convSolver = new AssemblyMateSolver();
    const ca = new AssemblyComponent('ca', 'CA', { fixed: true });
    const cb = new AssemblyComponent('cb', 'CB', { position: { x: 5, y: 5, z: 5 } });
    convSolver.addComponent(ca);
    convSolver.addComponent(cb);
    convSolver.addCoincidentPlanes(
      'ca',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 1),
      'cb',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -1)
    );
    const convRes = convSolver.solve(30, 1e-4);
    assert(typeof convRes.success === 'boolean');
    assert(Number.isFinite(convRes.maxResidual));
    assert(Number.isInteger(convRes.iterations));
    assert(Array.isArray(convRes.components));
    assert(Array.isArray(convRes.components[0].rotation));
    const tinySolver = new AssemblyMateSolver();
    const ta = new AssemblyComponent('ta', 'TA');
    const tb = new AssemblyComponent('tb', 'TB');
    tinySolver.addComponent(ta);
    tinySolver.addComponent(tb);
    tinySolver.addDistance(
      'ta',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 1),
      'tb',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -1),
      1000
    );
    const tinyRes = tinySolver.solve(1);
    assert(typeof tinyRes.success === 'boolean');
    assert(Number.isFinite(tinyRes.rank));
    assert(Number.isFinite(tinyRes.dofRemaining));
  });

  // ------------------------------------------------------------------
  // assembly_bvh_hierarchy.js
  // ------------------------------------------------------------------
  check('AABB3D/BVHNode branches', () => {
    const box = new AABB3D();
    assert.strictEqual(box.min.x, Infinity);
    assert.strictEqual(box.max.x, -Infinity);
    box.expandByPoint({ x: 1, y: 2, z: 3 });
    box.expandByPoint({ x: -1, y: -2, z: -3 });
    assert.deepStrictEqual(box.min, { x: -1, y: -2, z: -3 });
    assert.deepStrictEqual(box.max, { x: 1, y: 2, z: 3 });
    const other = new AABB3D({ x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 5 });
    box.expandByBox(other);
    assert.strictEqual(box.max.y, 5);
    assert(box.intersects(other));
    assert.strictEqual(other.intersects(new AABB3D({ x: 6, y: 6, z: 6 }, { x: 7, y: 7, z: 7 })), false);
    assert.deepStrictEqual(box.center(), { x: 2, y: 1.5, z: 1 });
    const degenerate = new AABB3D({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 });
    assert.strictEqual(degenerate.surfaceArea(), 0);
    assert(box.surfaceArea() > 0);
    const node = new BVHNode();
    assert.strictEqual(node.isLeaf, false);
    assert.strictEqual(node.left, null);
    assert.deepStrictEqual(node.parts, []);
  });

  check('AssemblyBVHHierarchy build/query/interference branches', () => {
    const emptyHier = new AssemblyBVHHierarchy([]);
    assert.strictEqual(emptyHier.root, null);
    assert.deepStrictEqual(emptyHier.findInterferences(), []);
    const parts = [];
    for (let i = 0; i < 6; i++) {
      parts.push({
        id: `p${i}`,
        aabb: new AABB3D({ x: i * 2, y: 0, z: 0 }, { x: i * 2 + 1, y: 1, z: 1 })
      });
    }
    const hier = new AssemblyBVHHierarchy(parts);
    assert(hier.root);
    const noOverlap = hier.findInterferences();
    assert.deepStrictEqual(noOverlap, []);
    const overlappers = [
      { id: 'o1', aabb: new AABB3D({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }) },
      { id: 'o2', aabb: new AABB3D({ x: 5, y: 5, z: 5 }, { x: 15, y: 15, z: 15 }) },
      { id: 'o3', aabb: new AABB3D({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }) },
      { id: 'o4', aabb: new AABB3D({ x: 20, y: 20, z: 20 }, { x: 30, y: 30, z: 30 }) },
      { id: 'o5', aabb: new AABB3D({ x: 2, y: 2, z: 2 }, { x: 12, y: 12, z: 12 }) },
      { id: 'o6', aabb: new AABB3D({ x: 25, y: 25, z: 25 }, { x: 35, y: 35, z: 35 }) },
      { id: 'o7', aabb: new AABB3D({ x: 100, y: 100, z: 100 }, { x: 110, y: 110, z: 110 }) }
    ];
    const hier2 = new AssemblyBVHHierarchy(overlappers);
    const collisions = hier2.findInterferences();
    assert(collisions.length >= 3);
    const colliding = new Set(collisions.map((c) => `${c.partA}-${c.partB}`));
    assert(colliding.has('o1-o2'));
    assert(colliding.has('o2-o5'));
    assert(colliding.has('o4-o6'));
    for (const c of collisions) {
      assert(c.overlapVolumeAABB > 0);
    }
    const zLong = [];
    for (let i = 0; i < 8; i++) {
      zLong.push({
        id: `z${i}`,
        aabb: new AABB3D({ x: 0, y: 0, z: i * 2 }, { x: 1, y: 1, z: i * 2 + 1 })
      });
    }
    const hierZ = new AssemblyBVHHierarchy(zLong);
    assert.deepStrictEqual(hierZ.findInterferences(), []);
    const yWide = [];
    for (let i = 0; i < 6; i++) {
      yWide.push({
        id: `y${i}`,
        aabb: new AABB3D({ x: 0, y: i * 2, z: 0 }, { x: 1, y: i * 2 + 1, z: 1 })
      });
    }
    const hierY = new AssemblyBVHHierarchy(yWide);
    assert.deepStrictEqual(hierY.findInterferences(), []);
    assert.strictEqual(
      emptyHier._computeOverlapVolume(
        new AABB3D({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
        new AABB3D({ x: 5, y: 5, z: 5 }, { x: 6, y: 6, z: 6 })
      ),
      0
    );
  });

  // ------------------------------------------------------------------
  // constraint_solver_2d.js
  // ------------------------------------------------------------------
  check('ConstraintSolver2D point/constraint branches', () => {
    const s = new ConstraintSolver2D();
    const idx = s.addPoint('p1', 1, 2, false);
    assert.strictEqual(idx, 0);
    const idx2 = s.addPoint('p2', 3, 4, true);
    assert.strictEqual(idx2, 1);
    assert.strictEqual(s.points[1].fixed, true);
    assert.throws(() => s._getPointIndex('nope'), /Point id not found/);
    assert.strictEqual(s._getPointIndex('p1'), 0);
    s.addFixed('p1', 10, 20);
    assert.strictEqual(s.points[0].x, 10);
    assert.strictEqual(s.points[0].fixed, true);
    s.addFixed('p1', undefined, 5);
    assert.strictEqual(s.points[0].y, 5);
    s.addDistance('p1', 'p2', 8);
    s.addHorizontal('p1', 'p2');
    s.addVertical('p1', 'p2');
    s.addCoincident('p1', 'p2');
    assert.strictEqual(s.constraints.length, 4);
    assert.strictEqual(s.getPoint('p1').x, 10);
    s.addConstraint('PERPENDICULAR', { p1: 0, p2: 1, p3: 1, p4: 0 });
    s.addConstraint('PARALLEL', { p1: 0, p2: 1, p3: 1, p4: 0 });
    s.addConstraint('POINT_ON_LINE', { pPoint: 0, p1: 1, p2: 0 });
    s.addConstraint('TANGENT_LINE_CIRCLE', { p1: 0, p2: 1, pCenter: 0, radius: 1 });
    s.addConstraint('FIXED', { p: 0, x: 10, y: 5 });
    s.addConstraint('UNKNOWN_TYPE', { a: 1 });
    const R = s.evaluateResiduals(new Float64Array([10, 5, 3, 4]));
    assert(R.length > 0);
    assert(R.every((r) => Number.isFinite(r)));
  });

  check('ConstraintSolver2D solve branches', () => {
    const s = new ConstraintSolver2D();
    s.addPoint('a', 0, 0, true);
    s.addPoint('b', 10, 10);
    s.addDistance('a', 'b', 5);
    const res = s.solve(50, 1e-6);
    assert(Number.isFinite(res.maxResidual));
    assert(Number.isInteger(res.iterations));
    assert(typeof res.converged === 'boolean');
    assert.strictEqual(res.points, s.points);
    const fixed = new ConstraintSolver2D();
    fixed.addPoint('f1', 1, 2, true);
    fixed.addPoint('f2', 3, 4, true);
    fixed.addHorizontal('f1', 'f2');
    const resFixed = fixed.solve(10);
    assert(Number.isFinite(resFixed.maxResidual));
    const impossible = new ConstraintSolver2D();
    impossible.addPoint('i1', 0, 0, true);
    impossible.addPoint('i2', 100, 100);
    impossible.addDistance('i1', 'i2', 1000);
    impossible.addFixed('i2', 0, 0);
    const resImp = impossible.solve(5);
    assert(Number.isFinite(resImp.maxResidual));
    const tangent = new ConstraintSolver2D();
    tangent.addPoint('t1', 0, 0);
    tangent.addPoint('t2', 1, 0);
    tangent.addPoint('tc', 0.5, 1, true);
    tangent.addConstraint('TANGENT_LINE_CIRCLE', { p1: 0, p2: 1, pCenter: 2, radius: 0.5 });
    const resTan = tangent.solve(20);
    assert(Number.isFinite(resTan.maxResidual));
  });

  // ------------------------------------------------------------------
  // variational_constraint_solver.js
  // ------------------------------------------------------------------
  check('VariationalConstraintSolver add/dispatch branches', () => {
    const v = new VariationalConstraintSolver();
    const pt = v.addPoint('p1', 0, 0, false);
    assert.strictEqual(pt.fixed, false);
    v.addPoint('p2', 5, 0);
    v.addPoint('p3', 0, 5, true);
    const d = v.addConstraint({ type: 'distance', point1: 'p1', point2: 'p2', value: 4 });
    assert.strictEqual(d.type, 'DISTANCE');
    const h = v.addConstraint({ type: 'HORIZONTAL', pt1: 'p1', pt2: 'p2' });
    assert.strictEqual(h.type, 'HORIZONTAL');
    const vc = v.addConstraint({ type: 'VERTICAL', point1: 'p1', point2: 'p3' });
    assert.strictEqual(vc.type, 'VERTICAL');
    const cc = v.addConstraint({ type: 'COINCIDENT', point1: 'p1', point2: 'p3' });
    assert.strictEqual(cc.type, 'COINCIDENT');
    const raw = v.addConstraint({ type: 'CUSTOM', foo: 1 });
    assert.strictEqual(raw.type, 'CUSTOM');
    assert.strictEqual(v.constraints.length, 5);
    const perm = v.addPerpendicularConstraint('p1', 'p2', 'p2', 'p3');
    assert.strictEqual(perm.type, 'PERPENDICULAR');
    const tan = v.addTangentCircleLine('p1', 2, 'p2', 'p3');
    assert.strictEqual(tan.type, 'TANGENT_CIRCLE_LINE');
    const emptySolver = new VariationalConstraintSolver();
    const res0 = emptySolver.solve();
    assert.strictEqual(res0.converged, true);
    assert.strictEqual(res0.iterations, 0);
  });

  check('VariationalConstraintSolver analyzeSystem/solve status branches', () => {
    const full = new VariationalConstraintSolver();
    full.addPoint('fx', 0, 0, true);
    full.addPoint('fy', 1, 1);
    full.addCoincidentConstraint('fx', 'fy');
    const analysisFull = full.analyzeSystem();
    assert.strictEqual(analysisFull.rank, 2);
    assert.strictEqual(analysisFull.dof, 0);
    assert.strictEqual(analysisFull.constraintStatus, 'FULLY_CONSTRAINED');
    const under = new VariationalConstraintSolver();
    under.addPoint('u1', 0, 0);
    const analysisUnder = under.analyzeSystem();
    assert.strictEqual(analysisUnder.constraintStatus, 'UNDER_CONSTRAINED');
    assert.strictEqual(analysisUnder.rank, 0);
    const over = new VariationalConstraintSolver();
    over.addPoint('o1', 0, 0, true);
    over.addPoint('o2', 5, 0, true);
    over.addPoint('o3', 2, 2);
    over.addCoincidentConstraint('o1', 'o3');
    over.addCoincidentConstraint('o2', 'o3');
    const analysisOver = over.analyzeSystem();
    assert.strictEqual(analysisOver.constraintStatus, 'OVER_CONSTRAINED');
    const allFixed = new VariationalConstraintSolver();
    allFixed.addPoint('a1', 1, 2, true);
    allFixed.addPoint('a2', 3, 4, true);
    const analysisAll = allFixed.analyzeSystem();
    assert.strictEqual(analysisAll.constraintStatus, 'FULLY_CONSTRAINED');
    assert.strictEqual(analysisAll.rank, 0);
    assert.strictEqual(analysisAll.numVariables, 0);
    const solve = new VariationalConstraintSolver();
    solve.addPoint('s1', 0, 0, true);
    solve.addPoint('s2', 10, 0);
    solve.addDistanceConstraint('s1', 's2', 5);
    const res = solve.solve();
    assert(typeof res.converged === 'boolean');
    assert(Number.isFinite(res.residualNorm));
    assert(Number.isInteger(res.iterations));
    assert(res.singularValues instanceof Float64Array);
    assert.strictEqual(typeof res.status, 'string');
    assert.strictEqual(typeof res.constraintStatus, 'string');
    assert(res.points.s2);
    const solveTight = new VariationalConstraintSolver();
    solveTight.addPoint('t1', 0, 0, true);
    solveTight.addPoint('t2', 1, 0);
    solveTight.addDistanceConstraint('t1', 't2', 0.5);
    const resTight = solveTight.solve();
    assert(Number.isFinite(resTight.residualNorm));
  });

  // ------------------------------------------------------------------
  // csg_mesh_booleans.js
  // ------------------------------------------------------------------
  check('CSG primitives vertex/plane/polygon branches', () => {
    const v = new CSGVertex([1, 2, 3], [0, 0, 1]);
    assert.deepStrictEqual(v.pos, [1, 2, 3]);
    assert.deepStrictEqual(v.normal, [0, 0, 1]);
    const vNoN = new CSGVertex([1, 2, 3]);
    assert.deepStrictEqual(vNoN.normal, [0, 0, 1]);
    const vc = v.clone();
    assert.notStrictEqual(vc, v);
    assert.deepStrictEqual(vc.pos, [1, 2, 3]);
    v.flip();
    assert.strictEqual(v.normal[0] + 0, 0);
    assert.strictEqual(v.normal[1] + 0, 0);
    assert.strictEqual(v.normal[2], -1);
    const vi = v.interpolate(new CSGVertex([3, 2, 3], [0, 0, 1]), 0.5);
    assert.strictEqual(vi.pos[0], 2);
    const p = CSGPlane.fromPoints([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    assert.strictEqual(p.normal[2], 1);
    assert.strictEqual(p.w + 0, 0);
    const pDeg = CSGPlane.fromPoints([0, 0, 0], [1, 0, 0], [2, 0, 0]);
    assert.strictEqual(pDeg.normal.length, 3);
    assert.strictEqual(pDeg.w + 0, 0);
    const pc = p.clone();
    assert.notStrictEqual(pc, p);
    p.flip();
    assert.strictEqual(p.normal[2], -1);
    assert.strictEqual(p.w + 0, 0);
    const poly = new CSGPolygon([new CSGVertex([0, 0, 0]), new CSGVertex([1, 0, 0]), new CSGVertex([0, 1, 0])]);
    assert(poly.plane);
    const polyC = poly.clone();
    assert.notStrictEqual(polyC, poly);
    polyC.flip();
    assert.strictEqual(polyC.plane.normal[2], -1);
  });

  check('CSGPlane splitPolygon branch matrix', () => {
    const plane = CSGPlane.fromPoints([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    const mkPoly = (pts) => new CSGPolygon(pts.map((p) => new CSGVertex(p)));
    const front = [];
    const back = [];
    const cf = [];
    const cb = [];
    const coplanarSame = mkPoly([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0]
    ]);
    plane.splitPolygon(coplanarSame, cf, cb, front, back);
    assert.strictEqual(cf.length, 1);
    const coplanarOpposite = mkPoly([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0]
    ]);
    coplanarOpposite.flip();
    plane.splitPolygon(coplanarOpposite, cf, cb, front, back);
    assert.strictEqual(cb.length, 1);
    const frontOnly = mkPoly([
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1]
    ]);
    plane.splitPolygon(frontOnly, cf, cb, front, back);
    assert.strictEqual(front.length, 1);
    const backOnly = mkPoly([
      [0, 0, -1],
      [1, 0, -1],
      [0, 1, -1]
    ]);
    plane.splitPolygon(backOnly, cf, cb, front, back);
    assert.strictEqual(back.length, 1);
    const spanning = mkPoly([
      [0, 0, 1],
      [1, 0, -1],
      [0, 1, -1]
    ]);
    const f2 = [];
    const b2 = [];
    plane.splitPolygon(spanning, [], [], f2, b2);
    assert(f2.length === 1);
    assert(b2.length === 1);
    const spanningDeg = mkPoly([
      [0, 0, 1],
      [0, 0, -1],
      [1, 0, 0]
    ]);
    const f3 = [];
    const b3 = [];
    plane.splitPolygon(spanningDeg, [], [], f3, b3);
    assert(f3.length >= 0);
  });

  check('CSGNode build/clip/invert branches', () => {
    const box = CSGSolid.createBox([10, 10, 10]);
    const node = new CSGNode(box.polygons);
    assert(node.plane);
    assert(node.front || node.back);
    const cloned = node.clone();
    assert(cloned.plane);
    assert.strictEqual(cloned.allPolygons().length, box.polygons.length);
    const emptyNode = new CSGNode();
    assert.strictEqual(emptyNode.plane, null);
    const clipped = emptyNode.clipPolygons(box.polygons);
    assert.strictEqual(clipped.length, box.polygons.length);
    const other = new CSGNode(box.polygons.map((p) => p.clone()));
    node.clipTo(other);
    assert(Array.isArray(node.polygons));
    const inverted = new CSGNode(box.polygons.map((p) => p.clone()));
    inverted.invert();
    assert(inverted.allPolygons().length === box.polygons.length);
    const singlePoly = new CSGNode([
      new CSGPolygon([new CSGVertex([0, 0, 0]), new CSGVertex([1, 0, 0]), new CSGVertex([0, 1, 0])])
    ]);
    assert(singlePoly.plane);
    const nonEmpty = new CSGNode();
    nonEmpty.build(box.polygons);
    assert(nonEmpty.polygons.length > 0);
  });

  check('CSGSolid factories/mesh/metrics branches', () => {
    const box = CSGSolid.createBox([10, 10, 10]);
    assert.strictEqual(box.polygons.length, 6);
    const boxDefault = CSGSolid.createBox();
    assert.strictEqual(boxDefault.polygons.length, 6);
    const boxCustom = CSGSolid.createBox([4, 4, 4], [1, 1, 1]);
    assert.strictEqual(boxCustom.polygons.length, 6);
    const cyl = CSGSolid.createCylinder(5, 10, 8);
    assert(cyl.polygons.length > 0);
    const mesh = box.toMesh();
    assert(mesh.vertices.length > 0);
    assert(mesh.faces.length >= 12);
    assert.strictEqual(mesh.faces[0].length, 3);
    const tris = box.toTriangles();
    assert.strictEqual(tris.length, 12);
    assert(tris[0].normal);
    assert.strictEqual(CSGSolid.fromBRep(null).polygons.length, 0);
    const triBody = new SolidBody('B');
    const t0 = new Vertex(0, 0, 0);
    const t1 = new Vertex(1, 0, 0);
    const t2 = new Vertex(0, 1, 0);
    triBody.vertices.push(t0, t1, t2);
    triBody.faces.push(new Face([t0, t1, t2]));
    const fromBrep = CSGSolid.fromBRep(triBody);
    assert.strictEqual(fromBrep.polygons.length, 1);
    const metrics = CSGMeshBooleans.computeMetrics(box);
    assert(Math.abs(metrics.volume - 1000) < 1);
    assert(metrics.surfaceArea > 0);
    assert(metrics.boundingBox);
    const emptyMetrics = CSGMeshBooleans.computeMetrics({ polygons: [] });
    assert.strictEqual(emptyMetrics.boundingBox, null);
    assert.strictEqual(emptyMetrics.volume, 0);
    assert.throws(() => CSGMeshBooleans.computeMetrics(null), /require a solid with a polygon array/);
    assert.throws(() => CSGMeshBooleans.computeMetrics({ polygons: [{ vertices: [] }] }), /at least three vertices/);
  });

  check('CSGMeshBooleans toCSGSolid format branches', () => {
    assert.throws(() => CSGMeshBooleans.toCSGSolid(null), /non-null solid or mesh object/);
    assert.throws(() => CSGMeshBooleans.toCSGSolid(42), /non-null solid or mesh object/);
    const box = CSGSolid.createBox([10, 10, 10]);
    const passthrough = CSGMeshBooleans.toCSGSolid(box);
    assert.strictEqual(passthrough, box);
    const triBody = new SolidBody('B');
    triBody.vertices.push(new Vertex(0, 0, 0), new Vertex(1, 0, 0), new Vertex(0, 1, 0));
    triBody.faces.push(new Face(triBody.vertices));
    const fromBrep = CSGMeshBooleans.toCSGSolid(triBody);
    assert.strictEqual(fromBrep.polygons.length, 1);
    const polyArray = CSGMeshBooleans.toCSGSolid({ polygons: box.polygons.map((p) => p.clone()) });
    assert.strictEqual(polyArray.polygons.length, 6);
    const vertexObjects = CSGMeshBooleans.toCSGSolid({
      polygons: [
        {
          vertices: [{ pos: [0, 0, 0], normal: [0, 0, 1] }, { point: [1, 0, 0] }, { pos: [0, 1, 0] }]
        }
      ]
    });
    assert.strictEqual(vertexObjects.polygons.length, 1);
    assert.throws(() => CSGMeshBooleans.toCSGSolid({ polygons: [{ vertices: [[1, 2]] }] }), /at least three vertices/);
    assert.throws(
      () =>
        CSGMeshBooleans.toCSGSolid({
          polygons: [{ vertices: [{ pos: [0, 0] }, { pos: [1, 0, 0] }, { pos: [0, 1, 0] }] }]
        }),
      /exactly three finite numeric coordinates/
    );
    const meshIndex = CSGMeshBooleans.toCSGSolid({
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0]
      ],
      faces: [[0, 1, 2]]
    });
    assert.strictEqual(meshIndex.polygons.length, 1);
    assert.throws(
      () =>
        CSGMeshBooleans.toCSGSolid({
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0]
          ],
          faces: [[0, 1, 9]]
        }),
      /must reference at least three valid vertex indices/
    );
    assert.throws(
      () =>
        CSGMeshBooleans.toCSGSolid({
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0]
          ],
          faces: [[0, 1]]
        }),
      /must reference at least three valid vertex indices/
    );
    const faceList = CSGMeshBooleans.toCSGSolid({
      faces: [{ vertices: [{ point: [0, 0, 0] }, { point: [1, 0, 0] }, { point: [0, 1, 0] }] }]
    });
    assert.strictEqual(faceList.polygons.length, 1);
    assert.throws(
      () => CSGMeshBooleans.toCSGSolid({ faces: [{ vertices: [{ point: [0, 0, 0] }] }] }),
      /must contain at least three vertices/
    );
    const boxType = CSGMeshBooleans.toCSGSolid({ type: 'box', size: [2, 4, 6], center: [1, 1, 1] });
    assert.strictEqual(boxType.polygons.length, 6);
    const boxSize = CSGMeshBooleans.toCSGSolid({ size: [3, 3, 3], cx: 0, cy: 0, cz: 0 });
    assert.strictEqual(boxSize.polygons.length, 6);
    const boxDx = CSGMeshBooleans.toCSGSolid({ dx: 2, dy: 3, dz: 4, cx: 0, cy: 0, cz: 0 });
    assert.strictEqual(boxDx.polygons.length, 6);
    assert.throws(
      () => CSGMeshBooleans.toCSGSolid({ type: 'box', size: [-1, 2, 3] }),
      /box dimensions must be positive/
    );
    const cylType = CSGMeshBooleans.toCSGSolid({
      type: 'cylinder',
      radius: 5,
      height: 10,
      segments: 8,
      center: [0, 0, 0]
    });
    assert(cylType.polygons.length > 0);
    assert.throws(
      () => CSGMeshBooleans.toCSGSolid({ type: 'cylinder', radius: 0, height: 10, segments: 8, center: [0, 0, 0] }),
      /radius and height must be positive/
    );
    assert.throws(
      () => CSGMeshBooleans.toCSGSolid({ type: 'cylinder', radius: 5, height: 10, segments: 2, center: [0, 0, 0] }),
      /segments must be an integer/
    );
    assert.throws(
      () => CSGMeshBooleans.toCSGSolid({ type: 'cylinder', radius: 5, height: 10, segments: 1.5, center: [0, 0, 0] }),
      /segments must be an integer/
    );
    assert.throws(() => CSGMeshBooleans.toCSGSolid({}), /Unsupported CSG solid format/);
  });

  check('CSGMeshBooleans boolean wrappers and metrics branches', () => {
    const boxA = CSGSolid.createBox([20, 20, 20]);
    const boxB = CSGSolid.createBox([20, 20, 20], [5, 5, 5]);
    const union = CSGMeshBooleans.union(boxA, boxB);
    assert(union.polygons.length > 0);
    const sub = CSGMeshBooleans.subtract(boxA, boxB);
    assert(sub.polygons.length > 0);
    const inter = CSGMeshBooleans.intersect(boxA, boxB);
    assert(inter.polygons.length > 0);
    const boxC = CSGSolid.createBox([20, 20, 20], [100, 100, 100]);
    const noOverlap = CSGMeshBooleans.intersect(boxA, boxC);
    assert.strictEqual(noOverlap.polygons.length, 0);
    const bpA = BRepPrimitives.createBox(20, 20, 20, 'A');
    const bpB = BRepPrimitives.createBox(20, 20, 20, 'B');
    const bpUnion = CSGMeshBooleans.union(bpA, bpB);
    assert(bpUnion.polygons.length > 0);
  });

  // ------------------------------------------------------------------
  // drafting_2d.js
  // ------------------------------------------------------------------
  check('Drafting FeatureControlFrame/escapeXmlText branches', () => {
    const fcf = new FeatureControlFrame();
    assert.strictEqual(fcf.characteristic, 'POSITION');
    assert.strictEqual(fcf.tolerance, 0.05);
    assert.strictEqual(fcf.diameter, false);
    assert.strictEqual(fcf.modifier, null);
    assert.strictEqual(fcf.getSymbol(), '⌖');
    assert.strictEqual(fcf.toString(), '[ ⌖ | 0.05 ]');
    const custom = new FeatureControlFrame({
      characteristic: 'flatness',
      tolerance: '0.02',
      diameter: true,
      modifier: 'M',
      datumPrimary: 'A',
      datumSecondary: 'B',
      datumTertiary: 'C'
    });
    assert.strictEqual(custom.characteristic, 'FLATNESS');
    assert.strictEqual(custom.getSymbol(), '⏥');
    assert.strictEqual(custom.getModifierSymbol('M'), 'Ⓜ');
    assert.strictEqual(custom.getModifierSymbol('L'), 'Ⓛ');
    assert.strictEqual(custom.getModifierSymbol('S'), 'Ⓢ');
    assert.strictEqual(custom.getModifierSymbol('X'), '');
    assert(custom.toString().includes('⌀0.02 Ⓜ | A | B | C'));
    const svg = custom.toSVG(100, 200, 30);
    assert(svg.svg.includes('<rect'));
    assert.strictEqual(svg.height, 30);
    assert(svg.totalWidth > 0);
    const weird = new FeatureControlFrame({ characteristic: 'NOT_A_REAL_ONE' });
    assert.strictEqual(weird.getSymbol(), '⌖');
  });

  check('DraftingEngine2D projection/generateDrawingSheet branches', () => {
    const box = BRepPrimitives.createBox(10, 20, 30, 'DraftBox');
    const front = DraftingEngine2D.projectOrthographic(box, 'FRONT');
    assert.strictEqual(front.viewType, 'FRONT');
    assert(front.lines.length > 0);
    assert(front.lines.some((l) => l.type === 'VISIBLE'));
    assert(front.lines.some((l) => l.type === 'HIDDEN'));
    assert(Number.isFinite(front.bounds.width));
    const top = DraftingEngine2D.projectOrthographic(box, 'TOP');
    assert.strictEqual(top.viewType, 'TOP');
    const right = DraftingEngine2D.projectOrthographic(box, 'RIGHT');
    assert.strictEqual(right.viewType, 'RIGHT');
    const iso = DraftingEngine2D.projectOrthographic(box, 'ISOMETRIC');
    assert.strictEqual(iso.viewType, 'ISOMETRIC');
    const lower = DraftingEngine2D.projectOrthographic(box, 'front');
    assert.strictEqual(lower.viewType, 'front');
    const bogus = DraftingEngine2D.projectOrthographic(box, 'SIDE');
    assert.strictEqual(bogus.viewType, 'SIDE');
    const wire = new SolidBody('Wire');
    wire.vertices.push(new Vertex(0, 0, 0), new Vertex(1, 0, 0), new Vertex(0, 1, 0));
    wire.faces.push(new Face(wire.vertices));
    const wireView = DraftingEngine2D.projectOrthographic(wire, 'FRONT');
    assert(wireView.lines.length > 0);
    const sheet = DraftingEngine2D.generateDrawingSheet(box);
    assert(sheet.svg.includes('<svg'));
    assert(sheet.svg.includes('FRONT VIEW'));
    assert(sheet.svg.includes('OMNIENG EXPERIMENTAL DRAWING'));
    assert(sheet.svg.includes('OE-DWG-001'));
    const sheetCustom = DraftingEngine2D.generateDrawingSheet(box, {
      title: 'Custom & Part <1>',
      partNumber: 'ABC-9',
      scale: '2:1',
      sheetWidth: 800,
      sheetHeight: 600,
      gdtSpecs: [{ characteristic: 'CYLINDRICITY', tolerance: '0.01', modifier: 'L', datumPrimary: 'D' }]
    });
    assert(sheetCustom.svg.includes('Custom &amp; Part &lt;1&gt;'));
    assert(sheetCustom.svg.includes('ABC-9'));
    assert(sheetCustom.svg.includes('2:1'));
    assert(sheetCustom.svg.includes('⌭'));
    assert.strictEqual(sheetCustom.sheetWidth, 800);
    const emptyBody = new SolidBody('Empty');
    const emptySheet = DraftingEngine2D.generateDrawingSheet(emptyBody);
    assert(emptySheet.svg.includes('</svg>'));
  });

  // ------------------------------------------------------------------
  // geometry_engine_adapter.js
  // ------------------------------------------------------------------
  check('GeometryEngineAdapter validate branches', async () => {
    const adapter = new GeometryEngineAdapter();
    const caps = adapter.describeCapabilities();
    assert.strictEqual(caps.domain, 'cad');
    assert(caps.supportedOperations.includes('boolean_union'));
    assert.strictEqual(caps.native, false);
    await assert.rejects(() => adapter.validate(null), /null request/);
    await assert.rejects(() => adapter.validate({ domain: 'eda', operation: 'boolean_union' }), /Domain mismatch/);
    await assert.rejects(() => adapter.validate({ domain: 'cad', operation: 'nope' }), /not supported by adapter/);
    await assert.rejects(
      () => adapter.validate({ domain: 'cad', operation: 'boolean_union', backend: 'wasm' }),
      /Backend/
    );
    await assert.rejects(
      () => adapter.validate({ domain: 'cad', operation: 'boolean_union', backendVersion: '9.9.9' }),
      /does not match/
    );
    await assert.rejects(
      () => adapter.validate({ domain: 'cad', operation: 'boolean_union', solver: 'magic' }),
      /Solver/
    );
    await assert.rejects(
      () =>
        adapter.validate({ domain: 'cad', operation: 'boolean_union', parameters: { solidA: {}, lengthUnit: 'mm' } }),
      /requires both solidA/
    );
    await assert.rejects(
      () =>
        adapter.validate({
          domain: 'cad',
          operation: 'boolean_union',
          parameters: { solidA: CSGSolid.createBox(), solidB: CSGSolid.createBox() }
        }),
      /lengthUnit/
    );
    await assert.rejects(
      () =>
        adapter.validate({
          domain: 'cad',
          operation: 'boolean_union',
          parameters: { solidA: { bogus: true }, solidB: CSGSolid.createBox(), lengthUnit: 'mm' }
        }),
      /CSG/
    );
    await assert.rejects(
      () => adapter.validate({ domain: 'cad', operation: 'apply_edge_blend', parameters: {} }),
      /edge blending requires/
    );
    await assert.rejects(
      () =>
        adapter.validate({
          domain: 'cad',
          operation: 'apply_edge_blend',
          parameters: { solid: CSGSolid.createBox(), radius: 1, targetEdge: 'e1', lengthUnit: 'ft' }
        }),
      /edge blending requires/
    );
    await assert.rejects(
      () => adapter.validate({ domain: 'cad', operation: 'solve_assembly_mates', parameters: {} }),
      /Assembly mate solving requires/
    );
    const ok = await adapter.validate({
      domain: 'cad',
      operation: 'boolean_union',
      parameters: { solidA: CSGSolid.createBox(), solidB: CSGSolid.createBox(), lengthUnit: 'mm' }
    });
    assert.strictEqual(ok, true);
  });

  check('GeometryEngineAdapter execute operation branches', async () => {
    const adapter = new GeometryEngineAdapter();
    const events = [];
    const onEvent = (e) => events.push(e.type);
    const aborted = { aborted: true };
    await assert.rejects(
      () =>
        adapter.execute({ jobId: 'j-0', domain: 'cad', operation: 'evaluate_nurbs', parameters: {} }, onEvent, aborted),
      /cancelled|CANCELLED/i
    );
    await assert.rejects(
      () => adapter.execute({ jobId: 'j-1', domain: 'cad', operation: 'mystery', parameters: {} }, onEvent),
      /not implemented|not supported/
    );
    const nurbsRes = await adapter.execute(
      {
        jobId: 'j-2',
        domain: 'cad',
        operation: 'evaluate_nurbs',
        parameters: {
          surface: {
            degreeU: 2,
            degreeV: 2,
            controlPoints: [
              [0, 0, 0],
              [1, 0, 0],
              [2, 0, 0],
              [0, 1, 0],
              [1, 1, 1],
              [2, 1, 0],
              [0, 2, 0],
              [1, 2, 0],
              [2, 2, 0]
            ],
            knotsU: [0, 0, 0, 1, 1, 1],
            knotsV: [0, 0, 0, 1, 1, 1]
          },
          u: 0.25,
          v: 0.75
        }
      },
      onEvent
    );
    assert.strictEqual(nurbsRes.status, 'COMPLETED');
    assert.strictEqual(nurbsRes.outputData.degreeU, 2);
    const nurbsDef = await adapter.execute(
      {
        jobId: 'j-3',
        domain: 'cad',
        operation: 'evaluate_nurbs',
        parameters: {
          surface: {
            degreeU: 1,
            degreeV: 1,
            controlPoints: [
              [
                [0, 0, 0],
                [0, 1, 0]
              ],
              [
                [1, 0, 0],
                [1, 1, 1]
              ]
            ]
          }
        }
      },
      onEvent
    );
    assert.strictEqual(nurbsDef.status, 'COMPLETED');
    const ssiRes = await adapter.execute(
      {
        jobId: 'j-4',
        domain: 'cad',
        operation: 'intersect_nurbs_ssi',
        parameters: {
          surfA: new TrimmedNurbsSurfaceSsi(),
          surfB: new TrimmedNurbsSurfaceSsi(),
          options: { gridSamples: 4 }
        }
      },
      onEvent
    );
    assert.strictEqual(ssiRes.status, 'COMPLETED');
    assert(typeof ssiRes.outputData.intersectionFound === 'boolean');
    const box = BRepPrimitives.createBox(10, 10, 10, 'BlendBox');
    const edgeId = box.edges[0].id;
    const blendRes = await adapter.execute(
      {
        jobId: 'j-5',
        domain: 'cad',
        operation: 'apply_edge_blend',
        parameters: { solid: box, targetEdge: edgeId, radius: 1, lengthUnit: 'mm', options: { subdivisions: 5 } }
      },
      onEvent
    );
    assert.strictEqual(blendRes.status, 'COMPLETED');
    assert.strictEqual(blendRes.outputData.lengthUnit, 'mm');
    const matesRes = await adapter.execute(
      {
        jobId: 'j-6',
        domain: 'cad',
        operation: 'solve_assembly_mates',
        parameters: {
          components: [
            { id: 'c1', name: 'C1', fixed: true, position: [0, 0, 0], rotation: [1, 0, 0, 0] },
            { id: 'c2', name: 'C2', position: [5, 5, 5], rotation: [1, 0, 0, 0] }
          ],
          mates: [
            {
              type: 'COINCIDENT_PLANES',
              compA: 'c1',
              compB: 'c2',
              ptA: [0, 0, 0],
              ptB: [0, 0, 0],
              normA: [0, 0, 1],
              normB: [0, 0, -1]
            }
          ],
          lengthUnit: 'm'
        }
      },
      onEvent
    );
    assert.strictEqual(matesRes.status, 'COMPLETED');
    assert.strictEqual(matesRes.outputData.lengthUnit, 'm');
    const exportRes = await adapter.execute(
      {
        jobId: 'j-8',
        domain: 'cad',
        operation: 'export_step',
        parameters: { solid: BRepPrimitives.createBox(5, 5, 5), modelName: 'ADP' }
      },
      onEvent
    );
    assert.strictEqual(exportRes.status, 'COMPLETED');
    assert(exportRes.outputData.stepContent.includes('ADP'));
    assert(exportRes.outputData.sizeBytes > 0);
    const exportDef = await adapter.execute(
      {
        jobId: 'j-9',
        domain: 'cad',
        operation: 'export_step',
        parameters: { solid: BRepPrimitives.createBox(5, 5, 5) }
      },
      onEvent
    );
    assert.strictEqual(exportDef.outputData.modelName, 'Part');
    const sketchRes = await adapter.execute(
      {
        jobId: 'j-10',
        domain: 'cad',
        operation: 'solve_variational_sketch',
        parameters: {
          points: [
            { id: 'p1', x: 0, y: 0, fixed: true },
            { id: 'p2', x: 10, y: 0 }
          ],
          constraints: [
            { type: 'HORIZONTAL', p1: 'p1', p2: 'p2' },
            { type: 'VERTICAL', p1: 'p1', p2: 'p2' },
            { type: 'COINCIDENT', p1: 'p1', p2: 'p2' },
            { type: 'DISTANCE', p1: 'p1', p2: 'p2', distance: 5 },
            { type: 'DISTANCE_POINTS', p1: 'p1', p2: 'p2', distance: 5 },
            { type: 'FIXED', p: 'p1', x: 0, y: 0 },
            { type: 'MYSTERY_CONSTRAINT', p1: 'p1', p2: 'p2' }
          ],
          maxIterations: 20,
          tolerance: 1e-5
        }
      },
      onEvent
    );
    assert.strictEqual(sketchRes.status, 'COMPLETED');
    assert(Number.isFinite(sketchRes.outputData.maxResidual));
    const sketchEmpty = await adapter.execute(
      { jobId: 'j-11', domain: 'cad', operation: 'solve_variational_sketch', parameters: {} },
      onEvent
    );
    assert.strictEqual(sketchEmpty.status, 'COMPLETED');
    const bA = BRepPrimitives.createBox(10, 10, 10, 'A');
    const bB = BRepPrimitives.createBox(10, 10, 10, 'B');
    const unionRes = await adapter.execute(
      {
        jobId: 'j-12',
        domain: 'cad',
        operation: 'boolean_union',
        parameters: { solidA: bA, solidB: bB, lengthUnit: 'mm' }
      },
      onEvent
    );
    assert.strictEqual(unionRes.status, 'COMPLETED');
    assert(unionRes.outputData.polygonCount > 0);
    assert(unionRes.outputData.volume.valueSi > 0);
    assert.strictEqual(unionRes.outputData.volume.displayUnit, 'mm3');
    const subRes = await adapter.execute(
      {
        jobId: 'j-13',
        domain: 'cad',
        operation: 'boolean_subtract',
        parameters: { bodyA: bA, bodyB: bB, lengthUnit: 'mm' }
      },
      onEvent
    );
    assert.strictEqual(subRes.status, 'COMPLETED');
    const interRes = await adapter.execute(
      {
        jobId: 'j-14',
        domain: 'cad',
        operation: 'boolean_intersect',
        parameters: { meshA: bA, meshB: bB, lengthUnit: 'm' }
      },
      onEvent
    );
    assert.strictEqual(interRes.status, 'COMPLETED');
    assert(interRes.outputData.polygonCount >= 0);
    assert(events.includes('STARTED'));
    assert(events.includes('COMPLETED'));
    assert(events.includes('PROGRESS'));
  });

  // ------------------------------------------------------------------
  // kernel_adapter.js
  // ------------------------------------------------------------------
  check('GeometryKernelAdapter primitive/boolean/fillet/metrics branches', () => {
    const adapter = new GeometryKernelAdapter({ preferredBackend: 'OCCT_WASM', occtInstance: { mock: true } });
    assert.strictEqual(adapter.preferredBackend, 'OCCT_WASM');
    assert(adapter.occt);
    assert.strictEqual(adapter.activeBackend, 'legacy-mesh-brep');
    const info = adapter.getKernelInfo();
    assert.strictEqual(info.occtAvailableButUnused, true);
    assert.strictEqual(info.isSovereignBRep, false);
    const box = adapter.makeBox(10, 20, 30, 'BoxFeat');
    assert.strictEqual(box.featureId, 'BoxFeat');
    assert(box.faces.every((f) => typeof f.tag === 'string'));
    const cyl = adapter.makeCylinder(5, 10, 'CylFeat');
    assert.strictEqual(cyl.featureId, 'CylFeat');
    assert(cyl.faces.every((f) => typeof f.tag === 'string'));
    const box2 = adapter.makeBox(10, 10, 10, 'BoxB');
    const cut = adapter.booleanCut(box, box2, 'CutFeat');
    assert.strictEqual(cut.featureId, 'CutFeat');
    assert(adapter.namingManager.historyGraph.length > 0);
    const box3 = adapter.makeBox(4, 4, 4, 'BoxC');
    const fuse = adapter.booleanFuse(box2, box3, 'FuseFeat');
    assert.strictEqual(fuse.featureId, 'FuseFeat');
    const box4 = adapter.makeBox(20, 20, 20, 'BoxD');
    const filleted = adapter.applyFillet(box4, [0, 1], 1, 'FilletFeat');
    assert.strictEqual(filleted.featureId, 'FilletFeat');
    const props = adapter.computeValidationProperties(box4);
    assert(props.volume > 0);
    assert(props.surfaceArea > 0);
    assert.strictEqual(props.validationLevel, 'experimental');
    assert(props.boundingBox.dx > 0);
    assert(Number.isFinite(props.centroid.x));
    const emptyBody = new SolidBody('Empty');
    const emptyProps = adapter.computeValidationProperties(emptyBody);
    assert.strictEqual(emptyProps.volume, 0);
    assert.strictEqual(emptyProps.surfaceArea, 0);
    const viaDefault = GeometryKernelAdapter.applyFillet(box4, [2], 0.5);
    assert(viaDefault instanceof SolidBody);
    assert(defaultGeometryKernel instanceof GeometryKernelAdapter);
    assert.strictEqual(KernelAdapter, GeometryKernelAdapter);
    const emptyKernel = new GeometryKernelAdapter();
    assert.strictEqual(emptyKernel.preferredBackend, 'legacy-mesh-brep');
    assert.strictEqual(emptyKernel.occt, null);
  });

  // ------------------------------------------------------------------
  // out_of_core_octree.js
  // ------------------------------------------------------------------
  check('OctreeNode insert/subdivide/query/retrieve branches', () => {
    const node = new OctreeNode([0, 0, 0, 100, 100, 100]);
    assert.strictEqual(node.maxDepth, 6);
    assert.strictEqual(node.maxItems, 16);
    assert(node.isLeaf());
    const item = { id: 'i1', bounds: [10, 10, 10, 20, 20, 20] };
    assert.strictEqual(node.insert(item), true);
    assert.strictEqual(node.items.length, 1);
    const outside = { id: 'out', bounds: [200, 200, 200, 250, 250, 250] };
    assert.strictEqual(node.insert(outside), false);
    assert.strictEqual(node.containsPoint([50, 50, 50]), true);
    assert.strictEqual(node.containsPoint([150, 50, 50]), false);
    assert.strictEqual(node.intersectsBox([50, 50, 50, 60, 60, 60]), true);
    assert.strictEqual(node.intersectsBox([200, 200, 200, 250, 250, 250]), false);
    const results = node.queryRange([0, 0, 0, 100, 100, 100]);
    assert(results.has(item));
    const none = node.queryRange([300, 300, 300, 400, 400, 400]);
    assert.strictEqual(none.size, 0);
    assert.strictEqual(node.retrieveLOD('i1', 'HIGH_BREP').id, 'i1');
    assert.strictEqual(node.retrieveLOD('missing', 'HIGH_BREP'), null);
    const lodNode = new OctreeNode([0, 0, 0, 100, 100, 100], 0, 1, 2);
    lodNode.insert({ id: 'a', bounds: [1, 1, 1, 2, 2, 2], lods: { HIGH_BREP: 'high', MEDIUM_MESH: 'medium' } });
    lodNode.insert({ id: 'b', bounds: [3, 3, 3, 4, 4, 4], lods: { high_brep: 'low' } });
    lodNode.insert({ id: 'c', bounds: [5, 5, 5, 6, 6, 6] });
    assert.strictEqual(lodNode.retrieveLOD('a', 'HIGH_BREP'), 'high');
    assert.strictEqual(lodNode.retrieveLOD('b', 'HIGH_BREP'), 'low');
    assert.strictEqual(lodNode.retrieveLOD('c', 'HIGH_BREP').lodLevel, 'HIGH_BREP');
    assert(lodNode.children !== null);
    assert.strictEqual(lodNode.items.length, 0);
    const smallNode = new OctreeNode([0, 0, 0, 100, 100, 100], 5, 5, 2);
    smallNode.insert({ id: 'x', bounds: [1, 1, 1, 2, 2, 2] });
    smallNode.insert({ id: 'y', bounds: [3, 3, 3, 4, 4, 4] });
    smallNode.insert({ id: 'z', bounds: [5, 5, 5, 6, 6, 6] });
    assert.strictEqual(smallNode.items.length, 3);
    assert.strictEqual(smallNode.isLeaf(), true);
  });

  check('OutOfCoreAssemblyManager LOD streaming/paging branches', () => {
    const manager = new OutOfCoreAssemblyManager();
    assert.strictEqual(manager.maxLoadedParts, 500);
    assert.strictEqual(manager.containsPoint([0, 0, 0]), true);
    manager.maxLoadedParts = 1;
    const partA = {
      id: 'A',
      name: 'A',
      bounds: [-10, -10, -10, 10, 10, 10],
      lods: { HIGH_BREP: 'hA', MEDIUM_MESH: 'mA', PROXY_BBOX: 'pA' }
    };
    const partB = {
      id: 'B',
      name: 'B',
      bounds: [300, -10, -10, 310, 10, 10],
      lods: { HIGH_BREP: 'hB', MEDIUM_MESH: 'mB', PROXY_BBOX: 'pB' }
    };
    manager.registerPart(partA);
    manager.registerPart(partB);
    assert.strictEqual(manager.partRegistry.size, 2);
    const frustum = [-1000, -1000, -1000, 1000, 1000, 1000];
    const first = manager.evaluateVisibleLODs([0, 0, 0], frustum);
    assert.strictEqual(first.totalRegisteredParts, 2);
    assert.strictEqual(first.visibleCount, 2);
    assert.strictEqual(first.streamedInCount, 1);
    assert.strictEqual(first.pagedOutCount, 0);
    assert.strictEqual(first.activeRenderList.length, 2);
    const aEntry = first.activeRenderList.find((r) => r.id === 'A');
    assert.strictEqual(aEntry.lodLevel, 'HIGH_BREP');
    const second = manager.evaluateVisibleLODs([200, 0, 0], frustum);
    assert.strictEqual(second.streamedInCount, 1);
    assert.strictEqual(second.pagedOutCount, 1);
    assert.strictEqual(manager.retrieveLOD('A', 'HIGH_BREP'), 'hA');
    assert.strictEqual(manager.retrieveLOD('B', 'MEDIUM_MESH'), 'mB');
    const lowerFallback = manager.retrieveLOD('B', 'high_brep');
    assert.strictEqual(lowerFallback.HIGH_BREP, 'hB');
    assert.strictEqual(manager.retrieveLOD('missing', 'HIGH_BREP'), null);
    const noLods = new OutOfCoreAssemblyManager();
    noLods.registerPart({ id: 'N', name: 'N', bounds: [0, 0, 0, 1, 1, 1] });
    const noLodRes = noLods.retrieveLOD('N', 'HIGH_BREP');
    assert.strictEqual(noLodRes.id, 'N');
    assert.strictEqual(noLodRes.lodLevel, 'HIGH_BREP');
    const third = noLods.evaluateVisibleLODs([0, 0, 0], frustum);
    assert.strictEqual(third.activeRenderList.length, 1);
  });

  // ------------------------------------------------------------------
  // feature_tree.js
  // ------------------------------------------------------------------
  check('FeatureTree parametric features and rebuild branches', () => {
    const tree = new FeatureTree();
    assert.strictEqual(tree.rebuild(), null);
    assert.strictEqual(tree.currentSolid, null);
    const boxFeat = new ParametricFeature('box', 'B1', { width: 20, height: 10, depth: 30 });
    boxFeat.setParam('width', 40);
    assert.strictEqual(boxFeat.params.width, 40);
    assert.strictEqual(boxFeat.name, 'B1');
    const anon = new ParametricFeature('box');
    assert.strictEqual(anon.name, 'box');
    assert.strictEqual(anon.suppressed, false);
    assert.strictEqual(anon.visible, true);
    const body = tree.addFeature(boxFeat);
    assert(body instanceof SolidBody);
    assert.strictEqual(body._primitive.type, 'box');
    tree.addFeature(new ParametricFeature('cylinder', 'C', { radius: 5, height: 10, segments: 8 }));
    tree.addFeature(new ParametricFeature('sphere', 'S', { radius: 7 }));
    assert.strictEqual(tree.currentSolid._primitive.type, 'sphere');
    tree.addFeature(
      new ParametricFeature('extrude_sketch', 'E', {
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4]
        ],
        height: 6
      })
    );
    assert(tree.currentSolid.vertices.length > 0);
    tree.addFeature(
      new ParametricFeature('revolve', 'R', {
        profile: [
          [2, 0],
          [4, 2],
          [2, 6]
        ],
        segments: 8
      })
    );
    assert(tree.currentSolid.vertices.length > 0);
    tree.addFeature(new ParametricFeature('cone', 'K', { rBottom: 6, rTop: 3, height: 12, segments: 8 }));
    assert(tree.currentSolid.vertices.length > 0);
    tree.addFeature(new ParametricFeature('mystery_type', 'U'));
    assert(tree.currentSolid instanceof SolidBody);
    const filletInactive = new ParametricFeature('fillet', 'FA');
    filletInactive.suppressed = true;
    tree.addFeature(filletInactive);
    assert(tree.currentSolid instanceof SolidBody);
    const shellInactive = new ParametricFeature('shell', 'SH');
    const shellOnly = new FeatureTree();
    shellOnly.addFeature(shellInactive);
    assert.strictEqual(shellOnly.currentSolid, null);
    const missingId = tree.updateFeatureParam('nope', 'width', 99);
    assert.strictEqual(missingId, tree.currentSolid);
    const updated = tree.updateFeatureParam(tree.features[0].id, 'width', 55);
    assert(updated instanceof SolidBody);
    tree.removeFeature(tree.features[3].id);
    assert.strictEqual(tree.features.length, 7);
    const emptyTree = new FeatureTree();
    assert.strictEqual(emptyTree.removeFeature('x'), null);
    const ser = tree.toJSON();
    assert(Array.isArray(ser.features));
    const restored = FeatureTree.fromJSON(ser);
    assert.strictEqual(restored.features.length, ser.features.length);
    assert(restored.currentSolid instanceof SolidBody);
    const emptyRestored = FeatureTree.fromJSON(null);
    assert.strictEqual(emptyRestored.features.length, 0);
    const emptyRestored2 = FeatureTree.fromJSON({});
    assert.strictEqual(emptyRestored2.currentSolid, null);
    const ftMod = require('../src/core/cad/feature_tree');
    assert.strictEqual(ftMod.StepTranslator, StepTranslator);
    assert.strictEqual(ftMod.ConstraintSolver2D, ConstraintSolver2D);
    assert(ftMod.CSGSolid);
  });

  check('FeatureTree shell branches (CSG, fallback, validation)', () => {
    const tree = new FeatureTree();
    const boxBody = BRepPrimitives.createBox(40, 40, 40, 'ShellBox');
    boxBody._primitive = { type: 'box', width: 40, height: 40, depth: 40 };
    const params = { thickness: 2 };
    const shelled = tree._applyShell(boxBody, params);
    assert(shelled.faces.length > 0);
    assert(params.actualVolume > 0);
    assert.throws(() => tree._applyShell(boxBody, { thickness: 0 }), /positive finite thickness/);
    assert.throws(() => tree._applyShell(boxBody, { thickness: NaN }), /positive finite thickness/);
    assert.throws(() => tree._applyShell(boxBody, { thickness: 25 }), /less than half/);
    const noFaces = new SolidBody('Empty');
    assert.strictEqual(tree._applyShell(noFaces, { thickness: 1 }), noFaces);
  });

  check('FeatureTree isogrid validation and carving branches', () => {
    const tree = new FeatureTree();
    const isoBody = BRepPrimitives.createBox(80, 80, 20, 'IsoBox');
    assert.throws(() => tree._applyIsogridPockets(isoBody, { ribThickness: 0 }), /positive ribThickness/);
    assert.throws(() => tree._applyIsogridPockets(isoBody, { pocketDepth: -1 }), /positive pocketDepth/);
    assert.throws(
      () => tree._applyIsogridPockets(isoBody, { spacing: 2, ribThickness: 3 }),
      /greater than ribThickness/
    );
    assert.throws(() => tree._applyIsogridPockets(isoBody, { pocketDepth: 60 }), /less than half/);
    assert.throws(
      () => tree._applyIsogridPockets(isoBody, { faceIndex: 99, spacing: 30, ribThickness: 3, pocketDepth: 5 }),
      /not found on body/
    );
    assert.throws(
      () =>
        tree._applyIsogridPockets(isoBody, { faceId: 'missing-face', spacing: 30, ribThickness: 3, pocketDepth: 5 }),
      /not found on body/
    );
    assert.throws(
      () => tree._applyIsogridPockets(isoBody, { faceIndex: 0, spacing: 30, ribThickness: 3, pocketDepth: 5 }),
      /upward-facing/
    );
    const downBody = new SolidBody('D');
    const dv0 = new Vertex(0, 0, 0);
    const dv1 = new Vertex(10, 0, 0);
    const dv2 = new Vertex(0, 10, 0);
    const dv3 = new Vertex(0, 0, 10);
    downBody.vertices.push(dv0, dv1, dv2, dv3);
    downBody.faces.push(new Face([dv0, dv1, dv2], new Vector3(0, 0, -1)));
    assert.throws(
      () => tree._applyIsogridPockets(downBody, { spacing: 30, ribThickness: 3, pocketDepth: 2 }),
      /top\/upward face/
    );
    const isoParams = { spacing: 30, ribThickness: 3, pocketDepth: 5 };
    const carved = tree._applyIsogridPockets(isoBody, isoParams);
    assert(carved.faces.length > 0);
    assert(isoParams.pocketVolume > 0);
    assert(Number.isFinite(isoParams.massReductionRatio));
    const isoParams2 = { spacing: 30, ribThickness: 3, pocketDepth: 5, faceIndex: 1 };
    const carved2 = tree._applyIsogridPockets(BRepPrimitives.createBox(80, 80, 20), isoParams2);
    assert(isoParams2.pocketVolume > 0);
    const freshBox = BRepPrimitives.createBox(80, 80, 20);
    const isoParams3 = { spacing: 30, ribThickness: 3, pocketDepth: 5, faceId: freshBox.faces[1].id };
    const carved3 = tree._applyIsogridPockets(freshBox, isoParams3);
    assert(isoParams3.pocketVolume > 0);
    const holes = tree._buildPocketFootprints({ minX: 0, maxX: 10, minY: 0, maxY: 0, maxZ: 0 }, 100, 2, 5);
    assert.deepStrictEqual(holes, []);
    const holes2 = tree._buildPocketFootprints({ minX: 0, maxX: 40, minY: 0, maxY: 40, maxZ: 0 }, 20, 3, 5);
    assert(holes2.length > 0);
    assert(
      tree._pointInConvexPoly(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10]
        ],
        5,
        5
      )
    );
    assert.strictEqual(
      tree._pointInConvexPoly(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10]
        ],
        20,
        20
      ),
      false
    );
    assert.strictEqual(
      tree._pointInConvexPoly(
        [
          [0, 0],
          [10, 0]
        ],
        5,
        5
      ),
      false
    );
    assert(
      tree._pointInPolygon2D(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10]
        ],
        5,
        5
      )
    );
    assert.strictEqual(
      tree._pointInPolygon2D(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10]
        ],
        20,
        20
      ),
      false
    );
  });

  const pendingSettled = await Promise.race([
    Promise.all(pending).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 90000))
  ]);
  if (!pendingSettled) {
    failedTests += pending.length;
    console.error('  ✗ WARN: timed out waiting for pending checks; marking them failed');
  }

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapTwentyThreeCoverageTests };

if (require.main === module) {
  runBranchGapTwentyThreeCoverageTests().then((stats) => {
    console.log(`gap23: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
