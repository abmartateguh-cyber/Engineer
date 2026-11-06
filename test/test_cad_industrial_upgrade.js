'use strict';

/**
 * Standalone industrial upgrade tests for the CAD core (Phase 1 specialist):
 *
 * 1. STEP assembly / product structure export (ISO 10303-21):
 *    - entity presence (PRODUCT, PRODUCT_DEFINITION, NEXT_ASSEMBLY_USAGE_OCCURRENCE,
 *      ITEM_DEFINED_TRANSFORMATION, SHAPE_REPRESENTATION records with
 *      CARTESIAN_TRANSFORMATION_3D, DRAUGHTING_MODEL, LAYER_ASSIGNMENT)
 *    - round-trip parse with structural referential integrity checks
 * 2. Persistent naming Euler-operator-style topological history log:
 *    - create -> split -> merge -> modify history, generation counter, lineage tracing
 * 3. Variational constraint solver:
 *    - SVD rank classification of over-constrained systems
 *    - Levenberg-Marquardt convergence on line-tangent-to-circle system verified
 *      against analytic geometry (distance from center to line == radius within 1e-6)
 */

const assert = require('assert');
const { StepTranslator } = require('../src/core/cad/step_translator');
const { PersistentNamingManager } = require('../src/core/cad/persistent_naming_manager');
const { VariationalConstraintSolver } = require('../src/core/cad/variational_constraint_solver');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');

function runCadIndustrialUpgradeTests() {
  console.log('================================================================');
  console.log('   CAD INDUSTRIAL UPGRADE (B-Rep/CAD SOVEREIGNTY) SUITE       ');
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
      console.error(err.stack);
    }
  }

  // ---------------------------------------------------------------
  // 1. STEP assembly export: entity presence + round-trip parse
  // ---------------------------------------------------------------
  console.log('\n[1/3] STEP assembly / product structure export...');

  runTest('exportSTEP emits header sections (FILE_DESCRIPTION/FILE_NAME/FILE_SCHEMA)', () => {
    const data = buildAssemblyData();
    const step = StepTranslator.exportSTEP(data, 'PinAssembly');
    assert(typeof step === 'string');
    assert(step.includes('ISO-10303-21;'));
    assert(step.includes('HEADER;'));
    assert(step.includes('ENDSEC;'));
    assert(step.includes('END-ISO-10303-21;'));
    assert(step.includes('FILE_DESCRIPTION('));
    assert(step.includes(`FILE_NAME('PinAssembly.step'`));
    assert(step.includes('FILE_SCHEMA('));
    assert(step.includes('AUTOMOTIVE_DESIGN'));
    assert(step.includes('DATA;'));
  });

  runTest('assembly export emits product structure entities (PRODUCT/PRODUCT_DEFINITION/...)', () => {
    const step = StepTranslator.exportSTEP(buildAssemblyData(), 'PinAssembly');
    // Root assembly + 3 parts = 4 products; each part gets a product definition shape
    assert.strictEqual(countEntities(step, 'PRODUCT'), 4);
    assert.strictEqual(countEntities(step, 'PRODUCT_DEFINITION'), 4);
    assert.strictEqual(countEntities(step, 'PRODUCT_DEFINITION_FORMATION'), 4);
    assert.strictEqual(countEntities(step, 'PRODUCT_DEFINITION_SHAPE'), 4);
    assert.strictEqual(countEntities(step, 'SHAPE_DEFINITION_REPRESENTATION'), 3);
    assert.strictEqual(countEntities(step, 'ADVANCED_BREP_SHAPE_REPRESENTATION'), 3);
    assert.strictEqual(countEntities(step, 'MANIFOLD_SOLID_BREP'), 3);
  });

  runTest('assembly export emits NEXT_ASSEMBLY_USAGE_OCCURRENCE with ISO attribute order', () => {
    const step = StepTranslator.exportSTEP(buildAssemblyData(), 'PinAssembly');
    const occ = step.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g);
    assert(occ && occ.length === 2, `expected 2 occurrences, got ${occ ? occ.length : 0}`);
    // Structure: (relating_def, related_def, 'reference_designator', 'name', 'description')
    const lines = step.split('\n').filter((l) => l.includes('NEXT_ASSEMBLY_USAGE_OCCURRENCE'));
    for (const line of lines) {
      const body = line.slice(line.indexOf('=') + 1);
      const firstRef = body.match(/^NEXT_ASSEMBLY_USAGE_OCCURRENCE\(#\d+, #\d+/);
      assert(firstRef, `occurrence must lead with product definition refs: ${line}`);
      const quoted = body.match(/'([^']*)'/g) || [];
      assert.strictEqual(quoted.length, 3, `occurrence must carry reference_designator/name/description: ${line}`);
    }
  });

  runTest('assembly export emits ITEM_DEFINED_TRANSFORMATION with CARTESIAN_TRANSFORMATION_3D', () => {
    const step = StepTranslator.exportSTEP(buildAssemblyData(), 'PinAssembly');
    assert.strictEqual(countEntities(step, 'ITEM_DEFINED_TRANSFORMATION'), 2);
    assert.strictEqual(countEntities(step, 'CARTESIAN_TRANSFORMATION_3D'), 2);
    assert.strictEqual(countEntities(step, 'AXIS2_PLACEMENT_3D') >= 2, true);
  });

  runTest('assembly export emits layer/color metadata (DRAUGHTING_MODEL + LAYER_ASSIGNMENT + COLOUR_RGB)', () => {
    const step = StepTranslator.exportSTEP(buildAssemblyData(), 'PinAssembly');
    assert.strictEqual(countEntities(step, 'DRAUGHTING_MODEL'), 3);
    assert.strictEqual(countEntities(step, 'LAYER_ASSIGNMENT'), 3);
    assert.strictEqual(countEntities(step, 'COLOUR_RGB'), 2);
    const layerLines = step.split('\n').filter((l) => l.includes('LAYER_ASSIGNMENT'));
    assert(layerLines.some((l) => l.includes('"') === false && l.includes('Base')));
    assert(layerLines.some((l) => l.includes('Fasteners')));
  });

  runTest('round-trip parse: entity counts match emitted structure', () => {
    const data = buildAssemblyData();
    const step = StepTranslator.exportSTEP(data, 'PinAssembly');
    const parsed = StepTranslator.parseSTEP(step);

    assert.strictEqual(parsed.format, 'STEP_AP203_AP214');
    assert(parsed.totalEntities > 900, `expected > 900 entities, got ${parsed.totalEntities}`);
    assert.strictEqual(parsed.summary.manifoldSolidsCount, 3);
    assert.strictEqual(parsed.summary.productsCount, 4);
    assert.strictEqual(parsed.summary.productDefinitionsCount, 4);
    assert.strictEqual(parsed.summary.productDefinitionShapesCount, 4);
    assert.strictEqual(parsed.summary.shapeDefinitionRepresentationsCount, 3);
    assert.strictEqual(parsed.summary.nextAssemblyUsageOccurrencesCount, 2);
    assert.strictEqual(parsed.summary.itemDefinedTransformationsCount, 2);
    assert.strictEqual(parsed.summary.cartesianTransformationsCount, 2);
    assert.strictEqual(parsed.summary.shapeRepresentationsCount, 3);
    assert.strictEqual(parsed.summary.draughtingModelsCount, 3);
    assert.strictEqual(parsed.summary.layerAssignmentsCount, 3);
    assert.strictEqual(parsed.summary.colourRgbCount, 2);
  });

  runTest('round-trip parse: occurrence references resolve to real product definitions', () => {
    const data = buildAssemblyData();
    const step = StepTranslator.exportSTEP(data, 'PinAssembly');
    const parsed = StepTranslator.parseSTEP(step);

    assert.strictEqual(parsed.assembly.occurrences.length, 2);
    const occNames = new Set();
    for (const occ of parsed.assembly.occurrences) {
      assert(parsed.entities[occ.relatingProductDefinition], `relating def ${occ.relatingProductDefinition} missing`);
      assert(parsed.entities[occ.relatedProductDefinition], `related def ${occ.relatedProductDefinition} missing`);
      assert.strictEqual(parsed.entities[occ.relatingProductDefinition].type, 'PRODUCT_DEFINITION');
      assert.strictEqual(parsed.entities[occ.relatedProductDefinition].type, 'PRODUCT_DEFINITION');
      occNames.add(occ.name);
    }
    assert.deepStrictEqual([...occNames].sort(), ['Cap', 'Pin']);
    // Occurrences are emitted in reference order: pin first, cap second
    assert.strictEqual(parsed.assembly.occurrences[0].name, 'Pin');
    assert.strictEqual(parsed.assembly.occurrences[0].referenceDesignator, 'r_pin');
    assert.strictEqual(parsed.assembly.occurrences[0].description, '');
    assert.strictEqual(parsed.assembly.occurrences[1].name, 'Cap');
    assert.strictEqual(parsed.assembly.occurrences[1].referenceDesignator, 'r_cap');
  });

  runTest('round-trip parse: transformations reference a CARTESIAN_TRANSFORMATION_3D and a solid item', () => {
    const data = buildAssemblyData();
    const step = StepTranslator.exportSTEP(data, 'PinAssembly');
    const parsed = StepTranslator.parseSTEP(step);

    assert.strictEqual(parsed.assembly.transformations.length, 2);
    for (const tf of parsed.assembly.transformations) {
      assert(parsed.entities[tf.transformationOperator], `operator ${tf.transformationOperator} missing`);
      assert.strictEqual(parsed.entities[tf.transformationOperator].type, 'CARTESIAN_TRANSFORMATION_3D');
      assert(parsed.entities[tf.item], `item ${tf.item} missing`);
      assert.strictEqual(parsed.entities[tf.item].type, 'MANIFOLD_SOLID_BREP');
    }
  });

  runTest('round-trip parse: layer assignments reference real items; DRAUGHTING_MODEL present', () => {
    const data = buildAssemblyData();
    const step = StepTranslator.exportSTEP(data, 'PinAssembly');
    const parsed = StepTranslator.parseSTEP(step);

    assert.strictEqual(parsed.assembly.layers.length, 3);
    for (const layer of parsed.assembly.layers) {
      assert(layer.items.length >= 1, `layer ${layer.name} has no items`);
      for (const item of layer.items) {
        assert(parsed.entities[item], `layer item ${item} missing`);
      }
    }
    assert(parsed.assembly.nodes.some((n) => n.type === 'DRAUGHTING_MODEL') === false); // DM not a node record
    assert.strictEqual(parsed.summary.draughtingModelsCount, 3);
  });

  runTest('legacy single-part export still works after assembly support', () => {
    const box = BRepPrimitives.createBox(40, 60, 20, 'EngineBlock');
    const step = StepTranslator.exportSTEP(box);
    assert(step.includes('MANIFOLD_SOLID_BREP'));
    assert(step.includes('ADVANCED_FACE'));
    const parsed = StepTranslator.parseSTEP(step);
    assert(parsed.totalEntities > 50);
    assert(parsed.vertices.length >= 8);
    assert.strictEqual(parsed.summary.nextAssemblyUsageOccurrencesCount, 0);
  });

  // ---------------------------------------------------------------
  // 1b. NURBS analytic surface export (B_SPLINE_SURFACE_WITH_KNOTS)
  // ---------------------------------------------------------------
  console.log('\n[1b] NURBS analytic surface export (B_SPLINE_SURFACE_WITH_KNOTS)...');

  runTest('exportNurbsSurfaces(plane): plane faces emit degree 1x1 B_SPLINE surfaces', () => {
    const box = BRepPrimitives.createBox(40, 60, 20, 'EngineBlock');
    const step = StepTranslator.exportNurbsSurfaces(box, 'BoxNurbs');
    const parsed = StepTranslator.parseSTEP(step);

    assert.strictEqual(parsed.summary.bSplineSurfacesCount, 6);
    assert.strictEqual(parsed.summary.rationalBSplineSurfacesCount, 0);

    const planes = parsed.nurbsSurfaces.filter((s) => s.type === 'B_SPLINE_SURFACE_WITH_KNOTS');
    assert.strictEqual(planes.length, 6);
    for (const p of planes) {
      assert.strictEqual(p.uDegree, 1);
      assert.strictEqual(p.vDegree, 1);
      assert.strictEqual(p.surfaceForm, '.PLANAR.');
      assert.deepStrictEqual(p.uKnots, [0, 0, 1, 1]);
      assert.deepStrictEqual(p.vKnots, [0, 0, 1, 1]);
      assert.strictEqual(p.controlPoints.length, 2);
      assert(p.controlPoints.every((row) => row.length === 2 && row.every((c) => Array.isArray(c))));
      for (const ref of p.controlPointRefs.flat()) {
        assert(parsed.entities[ref], `broken control point reference ${ref}`);
        assert.strictEqual(parsed.entities[ref].type, 'CARTESIAN_POINT');
      }
    }
  });

  runTest('exportNurbsSurfaces(cylinder): exact rational patches round-trip and reference integrity', () => {
    const cyl = BRepPrimitives.createCylinder(5, 20, 24, 'Cyl');
    const step = StepTranslator.exportNurbsSurfaces(cyl, 'CylNurbs');
    const parsed = StepTranslator.parseSTEP(step);

    assert.strictEqual(parsed.summary.rationalBSplineSurfacesCount, 4);
    const patches = parsed.nurbsSurfaces.filter((s) => s.type === 'RATIONAL_B_SPLINE_SURFACE');
    assert.strictEqual(patches.length, 4);

    const w = Math.SQRT1_2; // cos(45 deg)
    for (const p of patches) {
      assert.strictEqual(p.uDegree, 2);
      assert.strictEqual(p.vDegree, 1);
      assert.strictEqual(p.surfaceForm, '.CYLINDRICAL.');
      assert.deepStrictEqual(p.uKnots, [0, 0, 0, 1, 1, 1]);
      assert.deepStrictEqual(p.vKnots, [0, 0, 1, 1]);
      assert(p.knotSpec.includes('QUASI_UNIFORM'), `unexpected knot spec ${p.knotSpec}`);
      assert.strictEqual(p.weights.length, 3);
      assert.deepStrictEqual(p.weights[0], [1, 1]);
      assert(Math.abs(p.weights[1][0] - w) < 1e-5, `weight ${p.weights[1][0]} != ${w}`);
      assert(Math.abs(p.weights[1][1] - w) < 1e-5, `weight ${p.weights[1][1]} != ${w}`);
      assert.deepStrictEqual(p.weights[2], [1, 1]);
      for (const ref of p.controlPointRefs.flat()) {
        assert(parsed.entities[ref], `broken control point reference ${ref}`);
        assert.strictEqual(parsed.entities[ref].type, 'CARTESIAN_POINT');
      }
    }

    // The union of reconstructed control points must match the analytical 90-degree
    // arc control grid (corner points at radius R*sqrt(2)).
    const expected = [];
    for (let q = 0; q < 4; q++) {
      const a0 = (q * Math.PI) / 2;
      for (const a of [a0, a0 + Math.PI / 4, a0 + Math.PI / 2]) {
        const rad = a === a0 + Math.PI / 4 ? 5 * Math.SQRT2 : 5;
        for (const z of [-10, 10]) {
          expected.push([rad * Math.cos(a), rad * Math.sin(a), z]);
        }
      }
    }
    const allPts = [];
    for (const p of patches) {
      for (const row of p.controlPoints) {
        for (const c of row) if (c) allPts.push(c);
      }
    }
    for (const target of expected) {
      const found = allPts.some(
        (c) => Math.hypot(c[0] - target[0], c[1] - target[1], c[2] - target[2]) < 1e-4
      );
      assert(found, `missing control point ${target}`);
    }
  });

  // ---------------------------------------------------------------
  // 2. Persistent naming: Euler-operator-style topological history
  // ---------------------------------------------------------------
  console.log('\n[2/3] Persistent naming topological history log...');

  runTest('recordOperation appends history entries with generation counter and lineage', () => {
    const pnm = new PersistentNamingManager();
    assert.strictEqual(pnm.getCurrentGeneration(), 0);
    assert.deepStrictEqual(pnm.getHistory(), []);

    pnm.createEntity('f0', { entityType: 'FACE' });
    assert.strictEqual(pnm.getCurrentGeneration(), 1);
    const h = pnm.getHistory();
    assert.strictEqual(h.length, 1);
    assert.strictEqual(h[0].op, 'CREATE');
    assert.strictEqual(h[0].generation, 1);
    assert.deepStrictEqual(h[0].entityIds, ['f0']);
    assert.deepStrictEqual(h[0].resultIds, ['f0']);

    pnm.splitEntity('f0', ['f1', 'f2']);
    assert.strictEqual(pnm.getCurrentGeneration(), 2);
    const h2 = pnm.getHistory();
    assert.strictEqual(h2[1].op, 'SPLIT');
    assert.strictEqual(h2[1].generation, 2);
    assert.deepStrictEqual(h2[1].lineage, ['f0']);
    assert.deepStrictEqual(h2[1].resultIds, ['f1', 'f2']);
  });

  runTest('create -> split -> merge -> modify lineage is traceable', () => {
    const pnm = new PersistentNamingManager();
    pnm.createEntity('f0', { entityType: 'FACE' });
    pnm.splitEntity('f0', ['f1', 'f2']);
    pnm.mergeEntities(['f1', 'f2'], 'f3');
    pnm.modifyEntity('f3', { area: 5.0 });

    assert.strictEqual(pnm.getCurrentGeneration(), 4);
    assert.strictEqual(pnm.getHistory().length, 4);

    const trace0 = pnm.traceEntity('f0');
    assert.strictEqual(trace0.alive, false);
    assert.strictEqual(trace0.generation, 2);
    assert.deepStrictEqual(trace0.ancestors, []);
    assert.strictEqual(trace0.entries.length, 2);

    const trace1 = pnm.traceEntity('f1');
    assert.strictEqual(trace1.alive, false);
    assert.deepStrictEqual(trace1.ancestors, ['f0']);

    const trace3 = pnm.traceEntity('f3');
    assert.strictEqual(trace3.alive, true);
    assert.strictEqual(trace3.currentTag, 'f3');
    // f3's ancestry includes f1/f2 and transitively f0
    assert(trace3.ancestors.includes('f0'), `f3 ancestors should include f0, got ${JSON.stringify(trace3.ancestors)}`);
    assert(trace3.ancestors.includes('f1'));
    assert(trace3.ancestors.includes('f2'));
    assert.strictEqual(trace3.entries.length, 2); // merge + modify
  });

  runTest('deleteEntity marks dead and records DELETE entry', () => {
    const pnm = new PersistentNamingManager();
    pnm.createEntity('g0', { entityType: 'EDGE' });
    pnm.deleteEntity('g0');
    assert.strictEqual(pnm.getCurrentGeneration(), 2);
    assert.strictEqual(pnm.traceEntity('g0').alive, false);
    assert.strictEqual(pnm.getHistory()[1].op, 'DELETE');
    // Legacy API remains intact
    assert.strictEqual(pnm.resolveTag('g0').resolved, false);
  });

  runTest('legacy recordMutation / generateTag / resolveTag still work', () => {
    const pnm = new PersistentNamingManager();
    const tag = pnm.generateTag('Extrude1', 'FACE', 0, { normal: { x: 0, y: 0, z: 1 } });
    assert(typeof tag === 'string');
    pnm.recordMutation('Cut1', [{ parentTag: tag, action: 'MODIFY' }]);
    pnm.recordMutation('Delete1', [{ parentTag: tag, action: 'DELETE' }]);
    assert.strictEqual(pnm.resolveTag(tag).resolved, false);
    // registerEntity + resolveEntity path
    const face = pnm.registerEntity('FACE', {
      originatingFeatureId: 'Extrude1',
      geometryType: 'CYLINDRICAL',
      centroid: { x: 0, y: 0, z: 25 },
      area: 785.4
    });
    const resolved = pnm.resolveEntity(face.persistentId, [
      { geometryType: 'CYLINDRICAL', centroid: { x: 0, y: 0, z: 30 }, area: 785.4 }
    ]);
    assert.strictEqual(resolved.matchFound, true);
    assert(resolved.similarityScore >= 0.85);
  });

  // ---------------------------------------------------------------
  // 2b. Topology-aware persistent naming (geometry-key identity)
  // ---------------------------------------------------------------
  console.log('\n[2b] Topology-aware persistent naming (geometry-key identity)...');

  runTest('geometry-key equality reuses the same tag across re-evaluation', () => {
    const pnm = new PersistentNamingManager();
    const attrs = { centroid: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 }, area: 200 };
    const first = pnm.getOrCreateEntityByGeometry('FACE', attrs);
    const second = pnm.getOrCreateEntityByGeometry('FACE', attrs);

    assert(first.tag, 'geometry-key registration must produce a tag');
    assert.strictEqual(first.tag, second.tag);
    assert.strictEqual(first.created, true);
    assert.strictEqual(second.created, false);
    assert.strictEqual(pnm.resolveTag(first.tag).resolved, true);

    const key = PersistentNamingManager.computeGeometryKey('FACE', attrs);
    const byKey = pnm.resolveTag(key);
    assert.strictEqual(byKey.resolved, true, `geometry key ${key} must resolve`);
    assert.strictEqual(byKey.activeTag, first.tag);
  });

  runTest('splitting one face yields two distinct child tags sharing one parent lineage', () => {
    const pnm = new PersistentNamingManager();
    const parentAttrs = { centroid: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, area: 100 };
    const parentKey = PersistentNamingManager.computeGeometryKey('FACE', parentAttrs);
    const child1Key = PersistentNamingManager.computeGeometryKey('FACE', {
      centroid: { x: -25, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
      area: 50
    });
    const child2Key = PersistentNamingManager.computeGeometryKey('FACE', {
      centroid: { x: 25, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
      area: 50
    });
    const parent = pnm.getOrCreateEntityByGeometry('FACE', parentAttrs);

    const res = pnm.registerTopologicalEntities([parentKey], [child1Key, child2Key]);
    assert.strictEqual(res.op, 'SPLIT');
    assert.strictEqual(res.childTags.length, 2);
    assert.notStrictEqual(res.childTags[0], res.childTags[1]);
    assert.deepStrictEqual(res.parentTags, [parent.tag]);

    assert.strictEqual(pnm.traceEntity(parent.tag).alive, false);
    for (const childTag of res.childTags) {
      const trace = pnm.traceEntity(childTag);
      assert.strictEqual(trace.alive, true, `child ${childTag} should be alive`);
      assert(trace.ancestors.includes(parent.tag), `child ${childTag} lineage must include ${parent.tag}`);
    }

    const splitEntry = pnm.getHistory().find((e) => e.op === 'SPLIT');
    assert(splitEntry, 'SPLIT entry must exist in history');
    assert.deepStrictEqual(splitEntry.lineage, [parent.tag]);
    assert.deepStrictEqual(splitEntry.resultIds, res.childTags);
  });

  runTest('merging two faces yields one id whose lineage includes both parents', () => {
    const pnm = new PersistentNamingManager();
    const k1 = PersistentNamingManager.computeGeometryKey('FACE', {
      centroid: { x: -20, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
      area: 40
    });
    const k2 = PersistentNamingManager.computeGeometryKey('FACE', {
      centroid: { x: 20, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
      area: 40
    });
    const km = PersistentNamingManager.computeGeometryKey('FACE', {
      centroid: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
      area: 80
    });

    const a = pnm.getOrCreateEntityByGeometry('FACE', {
      centroid: { x: -20, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
      area: 40
    });
    const b = pnm.getOrCreateEntityByGeometry('FACE', {
      centroid: { x: 20, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
      area: 40
    });

    const res = pnm.registerTopologicalEntities([k1, k2], [km]);
    assert.strictEqual(res.op, 'MERGE');
    assert.strictEqual(res.parentTags.length, 2);
    assert.strictEqual(res.childTags.length, 1);

    const mergedTag = res.childTags[0];
    const trace = pnm.traceEntity(mergedTag);
    assert.strictEqual(trace.alive, true);
    assert(trace.ancestors.includes(a.tag), 'merged lineage must include first parent');
    assert(trace.ancestors.includes(b.tag), 'merged lineage must include second parent');

    const mergeEntry = pnm.getHistory().find((e) => e.op === 'MERGE');
    assert(mergeEntry, 'MERGE entry must exist in history');
    assert.deepStrictEqual([...mergeEntry.lineage].sort(), [a.tag, b.tag].sort());
    assert.deepStrictEqual(mergeEntry.resultIds, [mergedTag]);
  });

  // ---------------------------------------------------------------
  // 3. Variational solver: SVD rank analysis + tangency convergence
  // ---------------------------------------------------------------
  console.log('\n[3/3] Variational constraint solver upgrades...');

  runTest('analyzeSystem classifies a fully-constrained system via SVD rank', () => {
    const solver = new VariationalConstraintSolver();
    solver.addPoint('P1', 0, 0, true);
    solver.addPoint('P2', 38, 2, false);
    solver.addPoint('P3', 2, 28, false);
    solver.addConstraint({ type: 'HORIZONTAL', point1: 'P1', point2: 'P2' });
    solver.addConstraint({ type: 'VERTICAL', point1: 'P1', point2: 'P3' });
    solver.addConstraint({ type: 'DISTANCE', point1: 'P1', point2: 'P2', value: 40 });
    solver.addConstraint({ type: 'DISTANCE', point1: 'P1', point2: 'P3', value: 30 });

    const analysis = solver.analyzeSystem();
    assert.strictEqual(analysis.rank, 4, `expected rank 4, got ${analysis.rank}`);
    assert.strictEqual(analysis.dof, 0);
    assert.strictEqual(analysis.constraintStatus, 'FULLY_CONSTRAINED');
    assert.strictEqual(analysis.singularValues.length, 4);

    const res = solver.solve();
    assert.strictEqual(res.converged, true);
    assert(res.residualNorm < 1e-10);
    assert.strictEqual(res.degreesOfFreedom, 0);
    assert.strictEqual(res.status, 'FULLY_CONSTRAINED');
    assert.strictEqual(res.rank, 4);
  });

  runTest('analyzeSystem detects over-constrained status via rank deficiency', () => {
    const solver = new VariationalConstraintSolver();
    solver.addPoint('A', 0, 0, true);
    solver.addPoint('B', 5, 1, false);
    solver.addDistanceConstraint('A', 'B', 10);
    solver.addDistanceConstraint('A', 'B', 12); // conflicting

    const analysis = solver.analyzeSystem();
    assert.strictEqual(analysis.rank, 1, `expected rank 1, got ${analysis.rank}`);
    assert.strictEqual(analysis.dof, 1);
    assert.strictEqual(analysis.constraintStatus, 'OVER_CONSTRAINED');

    const res = solver.solve();
    assert.strictEqual(res.status, 'OVER_CONSTRAINED');
    assert.strictEqual(res.converged, false);
    assert(res.residualNorm > 1e-3); // conflict is unresolved
  });

  runTest('analyzeSystem detects under-constrained status', () => {
    const solver = new VariationalConstraintSolver();
    solver.addPoint('A', 0, 0, true);
    solver.addPoint('B', 10, 5, false);
    solver.addConstraint({ type: 'HORIZONTAL', point1: 'A', point2: 'B' });

    const analysis = solver.analyzeSystem();
    assert.strictEqual(analysis.constraintStatus, 'UNDER_CONSTRAINED');
    assert.strictEqual(analysis.dof, 1); // 2 vars - rank 1
    const res = solver.solve();
    assert.strictEqual(res.status, 'UNDER_CONSTRAINED');
  });

  runTest('tangency solve: line tangent to circle converges; distance(center,line) == radius within 1e-6', () => {
    // Line through A(0,0), B(10,0) (fixed, i.e. y=0). Circle of radius 3 centered
    // at free point C constrained to be tangent to the line and 5 from A.
    const solver = new VariationalConstraintSolver();
    solver.addPoint('A', 0, 0, true);
    solver.addPoint('B', 10, 0, true);
    solver.addPoint('C', 1, 2, false);
    solver.addTangentCircleLine('C', 3, 'A', 'B');
    solver.addDistanceConstraint('A', 'C', 5);

    const res = solver.solve();
    assert.strictEqual(res.converged, true, `solver did not converge: ${JSON.stringify(res)}`);
    assert(res.residualNorm < 1e-6, `residual ${res.residualNorm}`);

    const C = res.points.C;
    // Line y=0: distance from C to the line is |C.y|
    const distCenterToLine = Math.abs(C.y);
    assert(Math.abs(distCenterToLine - 3.0) < 1e-6, `center-line distance ${distCenterToLine} != radius 3`);
    // Analytic geometry: C.x^2 + C.y^2 = 25 with C.y = 3 -> C.x = 4
    assert(Math.abs(C.x - 4.0) < 1e-6, `C.x = ${C.x}, expected 4`);
    assert(Math.abs(C.y - 3.0) < 1e-6, `C.y = ${C.y}, expected 3`);
    assert.strictEqual(res.status, 'FULLY_CONSTRAINED');
    assert.strictEqual(res.rank, 2);
    assert.strictEqual(res.degreesOfFreedom, 0);
  });

  runTest('concentric constraint system converges via LM damping', () => {
    // Fixed center O(0,0); free point B is forced concentric with O (coincident),
    // and free point C is held at distance 4 from B and horizontally aligned.
    // Analytic solution: B = (0,0), C = (4,0).
    const solver = new VariationalConstraintSolver();
    solver.addPoint('O', 0, 0, true);
    solver.addPoint('B', 2, 1, false);
    solver.addPoint('C', -1, 3, false);
    solver.addCoincidentConstraint('O', 'B');
    solver.addDistanceConstraint('B', 'C', 4);
    solver.addConstraint({ type: 'HORIZONTAL', point1: 'B', point2: 'C' });

    const res = solver.solve();
    assert.strictEqual(res.converged, true, `concentric solve failed: ${JSON.stringify(res)}`);
    assert.strictEqual(res.status, 'FULLY_CONSTRAINED');
    assert.strictEqual(res.degreesOfFreedom, 0);
    assert(Math.abs(res.points.B.x) < 1e-6 && Math.abs(res.points.B.y) < 1e-6);
    // Symmetric geometry: C = (±4, 0) are both valid analytic solutions
    assert(Math.abs(Math.abs(res.points.C.x) - 4) < 1e-6 && Math.abs(res.points.C.y) < 1e-6);
  });

  console.log('\n================================================================');
  console.log(`   CAD INDUSTRIAL UPGRADE SUITE COMPLETED: ${passed} passed, ${failed} failed`);
  console.log('================================================================');

  return { total: passed + failed, passed, failed };
}

function buildAssemblyData() {
  const plate = BRepPrimitives.createBox(100, 80, 10, 'BasePlate');
  const pin = BRepPrimitives.createCylinder(5, 20, 16, 'Pin');
  const cap = BRepPrimitives.createBox(20, 20, 8, 'Cap');

  return {
    solids: [
      { id: 's_plate', name: 'BasePlate', solid: plate, layer: 'Base', color: '#cccccc' },
      { id: 's_pin', name: 'Pin', solid: pin, layer: 'Fasteners', color: '#ff8800' },
      { id: 's_cap', name: 'Cap', solid: cap, layer: 'Fasteners' }
    ],
    assembly: {
      nodes: [
        { id: 'n_plate', name: 'BasePlate', solidId: 's_plate' },
        { id: 'n_pin', name: 'Pin', solidId: 's_pin' },
        { id: 'n_cap', name: 'Cap', solidId: 's_cap' }
      ],
      references: [
        {
          id: 'r_pin',
          parentId: 'n_plate',
          childId: 'n_pin',
          name: 'Pin',
          transform: { origin: [0, 0, 5], axis1: [1, 0, 0], axis2: [0, 1, 0], scale: 1 }
        },
        {
          id: 'r_cap',
          parentId: 'n_pin',
          childId: 'n_cap',
          name: 'Cap',
          transform: { origin: [0, 0, 25], axis1: [1, 0, 0], axis2: [0, 1, 0], scale: 1 }
        }
      ]
    }
  };
}

function countEntities(stepText, type) {
  const re = new RegExp(`=${type}\\s*\\(`, 'g');
  const matches = stepText.match(re);
  return matches ? matches.length : 0;
}

if (require.main === module) {
  const stats = runCadIndustrialUpgradeTests();
  if (stats.failed > 0) process.exit(1);
}

module.exports = { runCadIndustrialUpgradeTests };
