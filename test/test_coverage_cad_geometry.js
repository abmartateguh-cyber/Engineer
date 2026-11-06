'use strict';

const assert = require('assert');

// 1. Assembly Mates
const { AssemblyComponent, AssemblyMateSolver } = require('../src/core/cad/assembly_mates');
const { Vector3, Quaternion } = require('../src/core/math/linear_algebra');

// 2. B-Rep Topology
const { Edge, Vertex, SolidBody } = require('../src/core/cad/brep_topology');

// 3. CSG Mesh Booleans
const {
  CSGNode,
  CSGSolid,
  toCSGSolid,
  CSGMeshBooleans,
  CSGPolygon,
  CSGVertex
} = require('../src/core/cad/csg_mesh_booleans');

// 4. Edge Blender
const { EdgeBlender } = require('../src/core/cad/edge_blender');

// 5. Feature Operations
const { FeatureOperations } = require('../src/core/cad/feature_operations');

// 6. Feature Tree
const { FeatureTree, ParametricFeature } = require('../src/core/cad/feature_tree');

// 7. GD&T Engine
const { DatumReferenceFrame, GDTEngine, FeatureControlFrame } = require('../src/core/cad/gdt_engine');

// 8. Kernel Adapter
const { KernelAdapter, GeometryKernelAdapter } = require('../src/core/cad/kernel_adapter');

// 9. NURBS Engine
const { NurbsCurve, NurbsSurface, NURBSSurface } = require('../src/core/cad/nurbs_engine');

// 10. Out-of-Core Octree
const { OctreeNode, OutOfCoreAssemblyManager } = require('../src/core/cad/out_of_core_octree');

// 11. STEP Translator
const { StepTranslator } = require('../src/core/cad/step_translator');

// 12. Variable Fillet Gregory
const { VariableFilletGregory, VariableRadiusFilletEngine } = require('../src/core/cad/variable_fillet_gregory');

// 13. Variational Constraint Solver
const { VariationalConstraintSolver } = require('../src/core/cad/variational_constraint_solver');

function runCadGeometryCoverageTests() {
  console.log('================================================================');
  console.log('   CAD CORE GEOMETRY TEST COVERAGE SUITE                        ');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function runTest(name, fn) {
    try {
      fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      failed++;
      console.error(`  [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  // 1. Assembly Mates
  console.log('\n[1/13] Testing Assembly Mates...');
  runTest('readQuaternion with valid tuple [1, 0, 0, 0]', () => {
    const comp1 = new AssemblyComponent('comp_1', 'Part1', {
      position: [0, 0, 0],
      rotation: [1, 0, 0, 0]
    });
    assert.strictEqual(comp1.id, 'comp_1');
    assert(comp1.rotation instanceof Quaternion);
    assert.strictEqual(comp1.rotation.w, 1);
    assert.strictEqual(comp1.rotation.x, 0);
    assert.strictEqual(comp1.rotation.y, 0);
    assert.strictEqual(comp1.rotation.z, 0);

    // Object format for rotation
    const compObj = new AssemblyComponent('comp_obj', 'PartObj', {
      rotation: { w: 1, x: 0, y: 0, z: 0 }
    });
    assert.strictEqual(compObj.rotation.w, 1);
  });

  runTest('AssemblyMateSolver: addDistance, addParallel, addPerpendicular', () => {
    const solver = new AssemblyMateSolver();
    const c1 = new AssemblyComponent('c1', 'Base', { fixed: true });
    const c2 = new AssemblyComponent('c2', 'Slider', { position: [0, 0, 10] });
    solver.addComponent(c1);
    solver.addComponent(c2);

    // Direct methods
    solver.addDistance(
      'c1',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 1),
      'c2',
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -1),
      10
    );
    solver.addParallel('c1', new Vector3(0, 1, 0), 'c2', new Vector3(0, 1, 0));
    solver.addPerpendicular('c1', new Vector3(1, 0, 0), 'c2', new Vector3(0, 1, 0));

    // Also via addMate dispatch
    solver.addMate({
      type: 'DISTANCE',
      compA: 'c1',
      ptA: [0, 0, 0],
      normA: [0, 0, 1],
      compB: 'c2',
      ptB: [0, 0, 0],
      normB: [0, 0, -1],
      distance: 5
    });
    solver.addMate({
      type: 'PARALLEL',
      compA: 'c1',
      normA: [0, 0, 1],
      compB: 'c2',
      normB: [0, 0, 1]
    });
    solver.addMate({
      type: 'PERPENDICULAR',
      compA: 'c1',
      normA: [1, 0, 0],
      compB: 'c2',
      normB: [0, 1, 0]
    });

    assert.strictEqual(solver.mates.length, 6);
    const residuals = solver.evaluateResiduals();
    assert(Array.isArray(residuals));
    assert(residuals.length > 0);
  });

  // 2. B-Rep Topology
  console.log('\n[2/13] Testing B-Rep Topology...');
  runTest('Edge.length() calculation with Vertex coordinates', () => {
    const e = new Edge(new Vertex([0, 0, 0]), new Vertex([3, 4, 0]));
    assert.strictEqual(e.length(), 5);

    // Also test with standard x,y,z and object args
    const e2 = new Edge(new Vertex(0, 0, 0), new Vertex(3, 4, 0));
    assert.strictEqual(e2.length(), 5);
    const e3 = new Edge(new Vertex({ x: 0, y: 0, z: 0 }), new Vertex({ x: 0, y: 0, z: 12 }));
    assert.strictEqual(e3.length(), 12);
  });

  // 3. CSG Mesh Booleans
  console.log('\n[3/13] Testing CSG Mesh Booleans...');
  runTest('CSGNode clone and toCSGSolid conversion', () => {
    const node = new CSGNode();
    const clone = node.clone();
    assert(clone instanceof CSGNode);

    const solid = toCSGSolid({
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0]
      ],
      faces: [[0, 1, 2]]
    });
    assert(solid instanceof CSGSolid);
    assert.strictEqual(solid.polygons.length, 1);

    // Also call on CSGMeshBooleans
    const solid2 = CSGMeshBooleans.toCSGSolid({
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0]
      ],
      faces: [[0, 1, 2]]
    });
    assert(solid2 instanceof CSGSolid);

    // Line 159: CSGNode clone with polygons
    const polyNode = new CSGNode([
      new CSGPolygon([new CSGVertex([0, 0, 0]), new CSGVertex([10, 0, 0]), new CSGVertex([0, 10, 0])])
    ]);
    const polyClone = polyNode.clone();
    assert(polyClone instanceof CSGNode);
    assert.strictEqual(polyClone.polygons.length, 1);

    // Line 436 & 441: toCSGSolid with input.polygons (both CSGPolygon instance and plain vertex objects)
    const polySolid = toCSGSolid({
      polygons: [
        new CSGPolygon([new CSGVertex([0, 0, 0]), new CSGVertex([10, 0, 0]), new CSGVertex([0, 10, 0])]),
        {
          vertices: [
            [0, 0, 0],
            [10, 0, 0],
            [0, 10, 0]
          ]
        }
      ]
    });
    assert(polySolid instanceof CSGSolid);
    assert.strictEqual(polySolid.polygons.length, 2);

    // Line 467: toCSGSolid with input.faces containing vertices
    const faceVertSolid = toCSGSolid({
      faces: [
        {
          vertices: [
            [0, 0, 0],
            [10, 0, 0],
            [0, 10, 0]
          ]
        }
      ]
    });
    assert(faceVertSolid instanceof CSGSolid);
    assert.strictEqual(faceVertSolid.polygons.length, 1);
  });

  // 4. Edge Blender
  console.log('\n[4/13] Testing Edge Blender...');
  runTest('EdgeBlender edge lookup predicate (e) => e.id === targetEdge', () => {
    const box = SolidBody.createBox(20, 20, 20);
    assert(box.edges && box.edges.length > 0);
    const targetEdgeId = box.edges[0].id;

    // Apply fillet using string edge ID to exercise (e) => e.id === targetEdge
    const resultFillet = EdgeBlender.applyFillet(box, targetEdgeId, 1.0);
    assert(resultFillet && resultFillet.solid);

    // Apply chamfer using string edge ID
    const targetChamferEdgeId = box.edges[1].id;
    const resultChamfer = EdgeBlender.applyChamfer(box, targetChamferEdgeId, 1.0);
    assert(resultChamfer && resultChamfer.solid);

    // Also test unmatched edge id to cover full predicate traversal
    assert.throws(() => {
      EdgeBlender.applyFillet(box, 'nonexistent_edge_id_12345', 1.0);
    }, /Target edge not found/);
  });

  // 5. Feature Operations
  console.log('\n[5/13] Testing Feature Operations...');
  runTest('FeatureOperations.patternLinear', () => {
    const body = SolidBody.createBox(10, 10, 10);
    const instances = FeatureOperations.patternLinear(body, 2, 10, 2, 10);
    assert(Array.isArray(instances));
    assert.strictEqual(instances.length, 4);
    assert.strictEqual(instances[0], body);
  });

  // 6. Feature Tree
  console.log('\n[6/13] Testing Feature Tree...');
  runTest('FeatureTree removeFeature, _extrudePolygon, _applyBevel, toSTEP', () => {
    const tree = new FeatureTree();
    tree.removeFeature('non-existent');

    const extrudedBody = tree._extrudePolygon(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10]
      ],
      20,
      'Extrude1'
    );
    assert(extrudedBody instanceof SolidBody);
    assert.strictEqual(extrudedBody.name, 'Extrude1');

    tree._applyBevel(extrudedBody, 2.0);
    tree.currentSolid = extrudedBody;

    const stepString = tree.toSTEP('TestPart');
    assert(typeof stepString === 'string');
    assert(stepString.includes('ISO-10303-21'));
    assert(stepString.includes('TestPart'));

    // Line 47: tree.removeFeature('f1') where tree.features has matching and non-matching features
    const treeWithFeatures = new FeatureTree();
    treeWithFeatures.features = [
      { id: 'f1', type: 'extrude' },
      { id: 'f2', type: 'bevel' }
    ];
    treeWithFeatures.removeFeature('f1');
    assert.strictEqual(treeWithFeatures.features.length, 1);
    assert.strictEqual(treeWithFeatures.features[0].id, 'f2');
  });

  // 7. GD&T Engine
  console.log('\n[7/13] Testing GD&T Engine...');
  runTest('DatumReferenceFrame and GDTEngine profile & perpendicularity evaluation', () => {
    const drf = new DatumReferenceFrame({ primary: 'A', secondary: 'B', tertiary: 'C' });
    assert.strictEqual(drf.primary, 'A');
    assert.strictEqual(drf.secondary, 'B');
    assert.strictEqual(drf.tertiary, 'C');

    const gdt = new GDTEngine();
    const profileRes = gdt.evaluateProfileOfSurface(
      [
        [0, 0, 0],
        [1, 0, 0]
      ],
      0.1
    );
    assert(profileRes);
    assert.strictEqual(profileRes.characteristic, 'PROFILE_OF_SURFACE');
    assert.strictEqual(profileRes.pointsInspected, 2);

    const perpRes = gdt.evaluatePerpendicularity([0, 0, 1], [0, 1, 0], 100, 0.05);
    assert(perpRes);
    assert.strictEqual(perpRes.characteristic, 'PERPENDICULARITY');
    assert.strictEqual(perpRes.passed, true);

    // Line 162: GDTEngine.prototype.evaluateTruePosition
    const truePosRes = new GDTEngine().evaluateTruePosition([0, 0, 0], [0, 0, 0], 0.1);
    assert(truePosRes);
    assert.strictEqual(truePosRes.characteristic, 'TRUE_POSITION');
  });

  // 8. Kernel Adapter
  console.log('\n[8/13] Testing Kernel Adapter...');
  runTest('KernelAdapter.applyFillet', () => {
    const body = SolidBody.createBox(20, 20, 20);
    const filleted = KernelAdapter.applyFillet(body, [0], 2.0, 'Fillet1');
    assert(filleted);
    assert.strictEqual(filleted.featureId, 'Fillet1');
  });

  // 9. NURBS Engine
  console.log('\n[9/13] Testing NURBS Engine...');
  runTest('NURBS curve.tessellate, surface.tessellate, and createCylinderPatch', () => {
    const curve = new NurbsCurve({
      degree: 2,
      controlPoints: [new Vector3(0, 0, 0), new Vector3(10, 20, 0), new Vector3(20, 0, 0)]
    });
    const curvePoints = curve.tessellate(20);
    assert(Array.isArray(curvePoints));
    assert.strictEqual(curvePoints.length, 21);

    const surface = NurbsSurface.createPlane(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 10, 10);
    const surfMesh = surface.tessellate(10);
    assert(surfMesh && Array.isArray(surfMesh.vertices));
    assert(surfMesh.vertices.length > 0);

    const cylinder = NURBSSurface.createCylinderPatch(10, 20, Math.PI / 2);
    assert(cylinder instanceof NurbsSurface);
    const cylinderMesh = cylinder.tessellate(10);
    assert(cylinderMesh && cylinderMesh.vertices.length > 0);
  });

  // 10. Out-of-Core Octree
  console.log('\n[10/13] Testing Out-of-Core Octree...');
  runTest('octree containsPoint and retrieveLOD', () => {
    const octree = new OctreeNode([-100, -100, -100, 100, 100, 100]);
    assert.strictEqual(octree.containsPoint([0, 0, 0]), true);
    assert.strictEqual(octree.containsPoint([200, 0, 0]), false);

    const manager = new OutOfCoreAssemblyManager([-500, -500, -500, 500, 500, 500]);
    manager.registerPart({
      id: 'mesh-1',
      name: 'TurbineBlade',
      bounds: [-10, -10, -10, 10, 10, 10],
      lods: { HIGH_BREP: { tris: 5000 }, MEDIUM_MESH: { tris: 500 }, PROXY_BBOX: { tris: 12 } }
    });
    assert.strictEqual(manager.containsPoint([0, 0, 0]), true);

    const lodFromManager = manager.retrieveLOD('mesh-1', 'HIGH_BREP');
    assert(lodFromManager);
    assert.strictEqual(lodFromManager.tris, 5000);

    const lodFromOctree = octree.retrieveLOD('mesh-1', 'HIGH_BREP');
    assert(lodFromOctree === null); // Not in node

    // Line 175: OutOfCoreAssemblyManager cache eviction
    if (typeof OutOfCoreAssemblyManager.prototype.updateViewFrustum !== 'function') {
      OutOfCoreAssemblyManager.prototype.updateViewFrustum = function (
        cameraPosition,
        cameraDirection,
        fov,
        aspect,
        near,
        far
      ) {
        const bound = far || 1000;
        return this.evaluateVisibleLODs(cameraPosition, [-bound, -bound, -bound, bound, bound, bound]);
      };
    }
    const evictionManager = new OutOfCoreAssemblyManager([-1000, -1000, -1000, 1000, 1000, 1000]);
    evictionManager.maxLoadedParts = 1;
    evictionManager.registerPart({
      id: 'part1',
      name: 'Part1',
      bounds: [-10, -10, -10, 10, 10, 10],
      lods: {}
    });
    evictionManager.loadedGeometryCache.set('part1', true);
    evictionManager.loadedGeometryCache.set('part2', true);
    const updateRes = evictionManager.evaluateVisibleLODs([0, 0, 50], [-20, -20, -20, 20, 20, 20]);
    assert(updateRes);
    assert.strictEqual(updateRes.activeRenderList.length, 1);
    assert.strictEqual(updateRes.pagedOutCount, 1);
  });

  // 11. STEP Translator
  console.log('\n[11/13] Testing STEP Translator...');
  runTest('StepTranslator.toSTEP(mesh)', () => {
    const mesh = {
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [10, 10, 0],
        [0, 10, 0]
      ],
      faces: [[0, 1, 2, 3]]
    };
    const stepText = StepTranslator.toSTEP(mesh);
    assert(typeof stepText === 'string');
    assert(stepText.includes('ISO-10303-21;'));
    assert(stepText.includes('DATA;'));
    assert(stepText.includes('ENDSEC;'));

    // Also test parseSTEP on generated text
    const parsed = StepTranslator.parseSTEP(stepText);
    assert(parsed && parsed.format);

    // Line 146: face.wire.edges.map(e => e.startVertex)
    const wireStepText = StepTranslator.exportSTEP({
      faces: [
        {
          wire: {
            edges: [{ startVertex: [0, 0, 0] }, { startVertex: [10, 0, 0] }, { startVertex: [0, 10, 0] }]
          }
        }
      ]
    });
    assert(typeof wireStepText === 'string');
    assert(wireStepText.includes('ISO-10303-21;'));

    // Lines 234 & 255: fallback box export corners.map & idx.map
    const fallbackBoxStepText = StepTranslator.exportSTEP({});
    assert(typeof fallbackBoxStepText === 'string');
    assert(fallbackBoxStepText.includes('ISO-10303-21;'));
    assert(fallbackBoxStepText.includes('Box_Face_1'));

    // Line 421: StepTranslator.toSTEP static method
    const boxSolid = SolidBody.createBox(10, 10, 10);
    const boxStepText = StepTranslator.toSTEP(boxSolid, 'MyBox');
    assert(typeof boxStepText === 'string');
    assert(boxStepText.includes('MyBox'));
  });

  // 12. Variable Fillet Gregory
  console.log('\n[12/13] Testing Variable Fillet Gregory...');
  runTest('VariableFilletGregory.blendMultiEdgeCorner', () => {
    const patch = VariableFilletGregory.blendMultiEdgeCorner([
      {
        edgeId: 'e1',
        radius: 2.0,
        contactPointsLeft: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 }
        ]
      },
      {
        edgeId: 'e2',
        radius: 2.0,
        contactPointsLeft: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 }
        ]
      }
    ]);
    assert(patch);
    assert.strictEqual(patch.nSides, 2);

    const pt = patch.evaluate([0.5, 0.5]);
    assert(pt && typeof pt.x === 'number');
    assert(pt.normal && typeof pt.normal.x === 'number');
  });

  // 13. Variational Constraint Solver
  console.log('\n[13/13] Testing Variational Constraint Solver...');
  runTest('solver constraints: coincident, perpendicular, tangent circle line', () => {
    const solver = new VariationalConstraintSolver();
    solver.addPoint('p1', 0, 0, true);
    solver.addPoint('p2', 0.1, 0.1, false);
    solver.addPoint('p3', 10, 0, true);
    solver.addPoint('p4', 10, 10, false);
    solver.addPoint('c1', 5, 5, false);

    const cCoin = solver.addCoincidentConstraint('p1', 'p2');
    assert.strictEqual(cCoin.type, 'COINCIDENT');

    const cPerp = solver.addPerpendicularConstraint('p1', 'p2', 'p3', 'p4');
    assert.strictEqual(cPerp.type, 'PERPENDICULAR');

    const cTan = solver.addTangentCircleLine('c1', 10, 'p1', 'p2');
    assert.strictEqual(cTan.type, 'TANGENT_CIRCLE_LINE');

    const res = solver.solve();
    assert(res);
    assert(typeof res.converged === 'boolean');
  });

  console.log('\n================================================================');
  console.log(`   ALL CAD GEOMETRY TESTS COMPLETED: ${passed} passed, ${failed} failed`);
  console.log('================================================================');

  return { total: passed + failed, passed, failed };
}

if (require.main === module) {
  try {
    const stats = runCadGeometryCoverageTests();
    if (stats.failed > 0) process.exit(1);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runCadGeometryCoverageTests };
