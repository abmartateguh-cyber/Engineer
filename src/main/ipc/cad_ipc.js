/**
 * OmniEng CAD Domain IPC Router & Schema Definitions
 * Covers B-Rep, NURBS SSI, STEP, Sheet Metal, GD&T, Assemblies, Drafting, Healer, BOM, Diff
 */

'use strict';

const { defineHandler } = require('./define_handler');
const { BRepPrimitives } = require('../../core/cad/brep_topology');
const { StepTranslator } = require('../../core/cad/step_translator');
const { NurbsCurve, NurbsSurface, SurfaceSurfaceIntersection } = require('../../core/cad/nurbs_engine');
const { EdgeBlender } = require('../../core/cad/edge_blender');
const { AssemblyComponent, AssemblyMateSolver } = require('../../core/cad/assembly_mates');
const { DraftingEngine2D } = require('../../core/cad/drafting_2d');
const { SurfaceSurfaceIntersectionEngine, TrimmedNurbsSurface } = require('../../core/cad/nurbs_trimmed_ssi');
const { SheetMetalBend, SheetMetalFlange, SheetMetalUnfolder } = require('../../core/cad/sheet_metal_unfolding');
const { GDTEngine, FeatureControlFrame } = require('../../core/cad/gdt_engine');
const { VariationalConstraintSolver } = require('../../core/cad/variational_constraint_solver');
const { TopologicalHealingEngine } = require('../../core/cad/topological_healing_engine');
const { GitCADVisualDiffEngine } = require('../../core/pdm/git_cad_visual_diff');
const { EngineeringBOMManager } = require('../../core/pdm/engineering_bom_manager');
const { StandardPartsLibrary } = require('../../core/cad/standard_parts_library');
const { defaultGeometryKernel } = require('../../core/cad/kernel_adapter');
const { Vector3 } = require('../../core/math/linear_algebra');

function registerCadIpc(deps = {}) {
  const outOfCoreOctree = deps.outOfCoreOctree;

  // 1. Primitive Creation
  defineHandler('omni:create-cad-primitive', {
    type: 'object',
    properties: {
      type: { type: 'string' },
      params: { type: 'object', optional: true }
    }
  }, async (event, { type, params = {} }) => {
    let body;
    if (type === 'cylinder') {
      body = BRepPrimitives.createCylinder(params.radius || 15, params.height || 40);
    } else if (type === 'sphere') {
      body = BRepPrimitives.createSphere(params.radius || 20);
    } else {
      body = BRepPrimitives.createBox(params.width || 60, params.height || 40, params.depth || 80);
    }
    return {
      id: body.id,
      name: body.name,
      volume: body.computeVolume(),
      triangles: body.toTriangles(),
      bbox: body.getBoundingBox()
    };
  }, { domain: 'cad', description: 'Create CAD B-Rep primitive' });

  // 2. Export CAD OBJ
  defineHandler('omni:export-cad-obj', {
    type: 'object',
    optional: true
  }, async (event, bodyData = {}) => {
    const body = BRepPrimitives.createBox(bodyData.width || 50, bodyData.height || 30, bodyData.depth || 80);
    return body.toOBJ();
  }, { domain: 'cad', description: 'Export B-Rep to Wavefront OBJ' });

  // 3. Export STEP AP242
  defineHandler('omni:export-step', {
    type: 'object',
    optional: true
  }, async (event, bodyData = {}) => {
    const width = bodyData.width || 40;
    const height = bodyData.height || 60;
    const depth = bodyData.depth || 20;
    const name = bodyData.name || 'OmniEng_Component';
    const box = BRepPrimitives.createBox(width, height, depth, name);
    const stepText = StepTranslator.exportSTEP(box);
    return { success: true, stepText, filename: `${name}.step` };
  }, { domain: 'cad', description: 'Export B-Rep solid to ISO 10303 STEP' });

  // 4. Evaluate NURBS
  defineHandler('omni:evaluate-nurbs', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { degree = 3, controlPoints = [], u = 0.5 } = params;
    const curve = new NurbsCurve({ degree, controlPoints });
    const point = curve.evaluate(u);
    const tangent = curve.evaluateTangent(u);
    const length = curve.computeLength(40);
    return { success: true, point: point.toArray(), tangent: tangent.toArray(), length };
  }, { domain: 'cad', description: 'Evaluate NURBS curve point, tangent, and arc length' });

  // 5. Intersect Basic NURBS SSI
  defineHandler('omni:intersect-basic-nurbs-ssi', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const surf1 = NurbsSurface.createPlane(
      new Vector3(0, 0, params.z1 || 5),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      params.width1 || 20,
      params.height1 || 20
    );
    const surf2 = NurbsSurface.createPlane(
      new Vector3(0, params.y2 || 10, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 0, 1),
      params.width2 || 20,
      params.height2 || 20
    );
    const ssi = SurfaceSurfaceIntersection.intersect(surf1, surf2, {
      subdivisions: params.subdivisions || 8,
      tolerance: params.tolerance || 1e-4
    });
    return {
      success: true,
      pointCount: ssi.points.length,
      points: ssi.points.map(p => p.toArray()),
      curveLength: ssi.curveLength
    };
  }, { domain: 'cad', description: 'Intersect analytical NURBS surfaces' });

  // 6. Apply Edge Blend (Fillet / Chamfer)
  defineHandler('omni:apply-edge-blend', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { type = 'fillet', width = 20, height = 20, depth = 20, radius = 2.0, distance = 2.0 } = params;
    const solid = BRepPrimitives.createBox(width, height, depth);
    const targetEdge = solid.edges[0];
    if (type === 'chamfer') {
      const res = EdgeBlender.applyChamfer(solid, targetEdge, distance);
      return { success: true, type: 'chamfer', bevelArea: res.bevelArea, solidVolume: solid.computeVolume() };
    } else {
      const res = EdgeBlender.applyFillet(solid, targetEdge, radius);
      return { success: true, type: 'fillet', blendFacesCount: res.blendFacesCount, filletSurfaceArea: res.filletSurfaceArea };
    }
  }, { domain: 'cad', description: 'Apply rolling-ball fillet or chamfer to solid' });

  // 7. Solve Assembly Mates
  defineHandler('omni:solve-assembly-mates', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const solver = new AssemblyMateSolver();
    const base = new AssemblyComponent('comp_base', 'BasePlate', { fixed: true });
    const part = new AssemblyComponent('comp_part', 'MountedPart', {
      position: new Vector3(params.initX || 5, params.initY || 5, params.initZ || 20),
      fixed: false
    });
    solver.addComponent(base);
    solver.addComponent(part);
    solver.addConcentric('comp_base', new Vector3(0, 0, 0), new Vector3(0, 0, 1), 'comp_part', new Vector3(0, 0, 0), new Vector3(0, 0, 1));
    solver.addCoincidentPlanes('comp_base', new Vector3(0, 0, params.targetZ || 10), new Vector3(0, 0, 1), 'comp_part', new Vector3(0, 0, 0), new Vector3(0, 0, -1));
    const result = solver.solve(params.maxIter || 40, 1e-4);
    return { success: true, result };
  }, { domain: 'cad', description: 'Solve 6-DOF assembly geometric mate constraints' });

  // 8. Generate 2D Drafting Sheet
  defineHandler('omni:generate-drafting-sheet', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const solid = BRepPrimitives.createBox(params.width || 40, params.height || 25, params.depth || 15);
    solid.name = params.partName || 'BracketMount';
    const sheet = DraftingEngine2D.generateDrawingSheet(solid, {
      title: params.partName || 'Bracket Mounting Base',
      partNumber: params.partNumber || 'OE-BKT-001',
      gdtSpecs: [
        { characteristic: 'FLATNESS', tolerance: 0.02, datumPrimary: 'A' },
        { characteristic: 'POSITION', tolerance: 0.05, diameter: true, modifier: 'M', datumPrimary: 'A', datumSecondary: 'B' }
      ]
    });
    return { success: true, svg: sheet.svg, sheetWidth: sheet.sheetWidth, sheetHeight: sheet.sheetHeight };
  }, { domain: 'cad', description: 'Generate orthographic 2D drafting drawing with GD&T' });

  // 9. Intersect Trimmed NURBS SSI
  defineHandler('omni:intersect-nurbs-ssi', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const surf1 = new TrimmedNurbsSurface(params.surf1 || {});
    const surf2 = new TrimmedNurbsSurface(params.surf2 || {});
    const res = SurfaceSurfaceIntersectionEngine.intersectSurfaces(surf1, surf2, params.options || { tolerance: 0.05 });
    return { success: true, result: res };
  }, { domain: 'cad', description: 'High-precision trimmed NURBS surface-surface intersection' });

  // 10. Sheet Metal Unfolding
  defineHandler('omni:unfold-sheet-metal', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const bend = new SheetMetalBend(params.bend || { angleDeg: 90.0, innerRadiusMm: 2.0, thicknessMm: 2.0, kFactor: 0.44 });
    const flanges = (params.flanges || [{ name: 'F1', lengthMm: 50, widthMm: 50 }, { name: 'F2', lengthMm: 50, widthMm: 50 }])
      .map(f => new SheetMetalFlange(f.name, f.lengthMm, f.widthMm));
    const flat = SheetMetalUnfolder.unfoldPart({ flanges, bends: [bend] });
    return { success: true, flat, bendAllowanceMm: bend.bendAllowanceMm, bendDeductionMm: bend.bendDeductionMm };
  }, { domain: 'cad', description: 'Compute DIN 6935 K-factor developed blank flat sheet' });

  // 11. GD&T Evaluation
  defineHandler('omni:evaluate-gdt', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const fcf = new FeatureControlFrame(params.fcf || { specifiedTolerance: 0.20, materialCondition: 'MMC' });
    const res = GDTEngine.evaluateTruePosition(params.hole || {
      nominalX: 50.0, nominalY: 30.0, measuredX: 50.08, measuredY: 29.95,
      nominalDiameter: 10.0, measuredDiameter: 10.25, lowerTolerance: -0.30, upperTolerance: 0.30
    }, fcf);
    return { success: true, result: res };
  }, { domain: 'cad', description: 'Evaluate ASME Y14.5 MMC true position and bonus tolerance' });

  // 12. Variational Sketch Constraint Solver
  defineHandler('omni:solve-variational-sketch', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const solver = new VariationalConstraintSolver();
    if (params.points) {
      for (const p of params.points) {
        solver.addPoint(p.id, p.x, p.y, p.fixed);
      }
    }
    if (params.constraints) {
      for (const c of params.constraints) {
        solver.addConstraint(c);
      }
    }
    const res = solver.solve();
    return { success: res.converged, ...res };
  }, { domain: 'cad', description: 'Newton-Raphson SVD variational geometric 2D constraint solver' });

  // 13. Auto-Heal CAD Geometry
  defineHandler('omni:heal-cad-geometry', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const healer = new TopologicalHealingEngine(params.options || { tolerance: 0.05 });
    const res = healer.healSolid(params.dirtyModel || { vertices: [], faces: [] }, params.options);
    return { success: res.healed, ...res };
  }, { domain: 'cad', description: 'Stitch micro-gaps and collapse slivers in B-Rep models' });

  // 14. 3D CAD Visual Diff
  defineHandler('omni:visual-diff-cad', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const engine = new GitCADVisualDiffEngine(params.options || {});
    const res = engine.compareRevisions(params.modelA || params.revA || {}, params.modelB || params.revB || {});
    return { success: true, ...res };
  }, { domain: 'cad', description: 'Git-style 3D CAD B-Rep revision diffing' });

  // 15. Engineering BOM Roll-Up
  defineHandler('omni:rollup-ebom', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const bom = new EngineeringBOMManager();
    const root = params.rootAssembly || {
      partNumber: params.partNumber || 'ASM-01',
      name: params.name || 'Main Assembly',
      children: params.items || []
    };
    bom.setRootAssembly(root);
    const rolledUp = bom.computeRollUp();
    const indented = bom.generateIndentedBOM();
    const flattened = bom.generateFlattenedBOM();
    const csv = bom.exportToCSV();
    return { success: true, rolledUp, indented, flattened, csv };
  }, { domain: 'cad', description: 'Hierarchical eBOM aggregation and single-level hardware rollup' });

  // 16. Standard Fasteners Library
  defineHandler('omni:get-standard-fastener', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { type = 'bolt', nominalDiaMm = 8, lengthMm = 40, propertyClass = '8.8' } = params;
    if (type === 'bolt') {
      return { success: true, ...StandardPartsLibrary.generateHexBolt(nominalDiaMm, lengthMm, propertyClass) };
    } else if (type === 'nut') {
      return { success: true, ...StandardPartsLibrary.generateHexNut(nominalDiaMm, propertyClass) };
    } else if (type === 'bearing') {
      return { success: true, ...StandardPartsLibrary.generateBallBearing(params.designation || '6204') };
    } else if (type === 'hole_callout') {
      return { success: true, ...StandardPartsLibrary.generateHoleCallout(nominalDiaMm, lengthMm, true) };
    }
    return { success: false, error: `Unknown fastener type: ${type}` };
  }, { domain: 'cad', description: 'Query ISO 4014 bolts, ISO 4032 nuts, and SKF ball bearings' });

  // 17. Out-of-Core Spatial Octree LOD
  defineHandler('omni:get-out-of-core-lod', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    if (!outOfCoreOctree) {
      return { success: true, visibleCount: 0, items: [] };
    }
    const { cameraPosition = [0, 0, 100], frustumBounds = [-200, -200, -200, 200, 200, 200] } = params;
    const res = outOfCoreOctree.evaluateVisibleLODs(cameraPosition, frustumBounds);
    return { success: true, ...res };
  }, { domain: 'cad', description: 'Evaluate visible LOD levels from spatial octree' });

  // 18. NIST Recommended Practice Validation Properties (AP242 / CAx-IF)
  defineHandler('omni:compute-cad-validation-properties', {
    type: 'object',
    properties: {
      dx: { type: 'number', optional: true },
      dy: { type: 'number', optional: true },
      dz: { type: 'number', optional: true },
      shapeType: { type: 'string', optional: true }
    },
    optional: true
  }, async (event, params = {}) => {
    const dx = params.dx || 50;
    const dy = params.dy || 30;
    const dz = params.dz || 80;
    let body;
    if (params.shapeType === 'cylinder') {
      body = defaultGeometryKernel.makeCylinder(params.radius || 15, dz, 'CylComponent');
    } else {
      body = defaultGeometryKernel.makeBox(dx, dy, dz, 'BoxComponent');
    }
    const props = defaultGeometryKernel.computeValidationProperties(body);
    return { success: true, properties: props, bodyName: body.name };
  }, { domain: 'cad', description: 'Compute NIST AP242 / CAx-IF geometric validation properties (volume, area, centroid)' });
  defineHandler('omni:cad-extrude-profile', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { FeatureOperations } = require('../../core/cad/feature_operations');
    const profile = params.profile || [
      { x: -30, y: -20 },
      { x: 30, y: -20 },
      { x: 30, y: 20 },
      { x: -30, y: 20 }
    ];
    const depth = params.depth || 40.0;
    const body = FeatureOperations.extrude(profile, depth, params);
    return {
      success: true,
      id: body.id,
      name: body.name,
      volume: body.computeVolume(),
      bbox: body.getBoundingBox(),
      triangles: body.toTriangles(),
      faceCount: body.faces.length
    };
  }, { domain: 'cad', description: 'Extrude 2D parametric profile into 3D B-Rep solid body' });

  // 20. Parametric CAD 3D Rotational Revolution
  defineHandler('omni:cad-revolve-profile', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { FeatureOperations } = require('../../core/cad/feature_operations');
    const profile = params.profile || [
      { x: 10, y: 0 },
      { x: 25, y: 10 },
      { x: 20, y: 35 },
      { x: 10, y: 50 }
    ];
    const angle = params.angleDeg || 360;
    const axis = params.axis || 'Y';
    const body = FeatureOperations.revolve(profile, angle, axis, params.segments || 24);
    return {
      success: true,
      id: body.id,
      name: body.name,
      faceCount: body.faces.length,
      triangles: body.toTriangles()
    };
  }, { domain: 'cad', description: 'Revolve 2D parametric profile around spatial axis' });

  // 21. Parametric CAD Thin-Wall Shell
  defineHandler('omni:cad-shell-body', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { FeatureOperations } = require('../../core/cad/feature_operations');
    const baseBox = BRepPrimitives.createBox(params.width || 60, params.height || 40, params.depth || 80);
    const shelled = FeatureOperations.shell(baseBox, params.wallThickness || 2.0, params.openFaceIndex !== undefined ? params.openFaceIndex : 1);
    return {
      success: true,
      id: shelled.id,
      name: shelled.name,
      faceCount: shelled.faces.length,
      wallThickness: params.wallThickness || 2.0,
      triangles: shelled.toTriangles()
    };
  }, { domain: 'cad', description: 'Shell 3D solid body into uniform thin-wall hollow structure' });

  // 22. CAM 3-Axis CNC Toolpath Generation & G-Code Post-Processor
  defineHandler('omni:cam-generate-toolpath', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { CNCToolpathEngine } = require('../../core/cam/cnc_toolpath_engine');
    const cam = new CNCToolpathEngine(params.options || {});
    const bounds = params.bounds || { minX: -50, maxX: 50, minY: -30, maxY: 30, minZ: 0, maxZ: 25 };
    const toolpathData = cam.planRoughingToolpath(bounds);
    const gcode = cam.generateGCode(toolpathData, params.programNumber || 'O1001');
    return {
      success: true,
      telemetry: toolpathData.telemetry,
      layers: toolpathData.layers,
      toolpath: toolpathData,
      machiningTimeMin: toolpathData.telemetry?.estimatedTimeMin,
      gcode,
      gcodePreview: gcode.split('\n').slice(0, 30).join('\n'),
      totalGcodeLines: gcode.split('\n').length
    };
  }, { domain: 'cad', description: 'Generate 3-axis CNC planar roughing toolpath and ISO G-code' });

  // 23. NASA Space Rocket, Spaceship Interior & Engine Parametric CAD Feature History Tree
  defineHandler('omni:get-rocket-feature-tree', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { FeatureTree } = require('../../core/cad/feature_tree');
    const isInterior = params.article === 'interior' || params.article === 'spacecraft_interior' || params.article === 'spaceship_interior';
    const isEngine = params.article === 'engine' || params.article === 'engine_macro' || params.article === 'macro_engine';
    const tree = isInterior
      ? (FeatureTree.createSpacecraftInteriorTree ? FeatureTree.createSpacecraftInteriorTree() : FeatureTree.createRocketAssemblyTree())
      : (isEngine ? FeatureTree.createStagedCombustionEngineTree() : FeatureTree.createRocketAssemblyTree());
    return {
      success: true,
      article: isInterior ? 'spacecraft_interior' : (isEngine ? 'engine_macro' : 'full_stack'),
      features: tree.toJSON().features,
      featureCount: tree.features.length,
      currentSolidStats: tree.currentSolid ? {
        vertexCount: tree.currentSolid.vertices.length,
        faceCount: tree.currentSolid.faces.length
      } : null
    };
  }, { domain: 'cad', description: 'Retrieve NASA launch vehicle, spaceship interior, or staged-combustion engine parametric B-Rep feature tree' });
}

module.exports = { registerCadIpc };


