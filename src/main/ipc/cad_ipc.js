/**
 * OmniEng CAD Domain IPC Router & Schema Definitions
 * Covers B-Rep, NURBS SSI, STEP, Sheet Metal, GD&T, Assemblies, Drafting, Healer, BOM, Diff
 */

'use strict';

const { defineHandler, validateSchema } = require('./define_handler');
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
const { CAD_EXTRUDE_PROFILE_SCHEMA, CAD_REVOLVE_PROFILE_SCHEMA, CAD_SHELL_BODY_SCHEMA } = require('./cad_schemas');

const CAD_DIFF_CENTROID_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'z'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' }
  }
});

const CAD_DIFF_REVISION_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['commitId', 'units', 'faces'],
  properties: {
    commitId: { type: 'string', maxLength: 200 },
    units: {
      type: 'object',
      additionalProperties: false,
      required: ['length', 'volume'],
      properties: {
        length: { type: 'string', enum: ['mm'] },
        volume: { type: 'string', enum: ['mm3'] }
      }
    },
    volumeMm3: { type: 'number', min: 0 },
    volume: { type: 'number', min: 0 },
    faces: {
      type: 'array',
      minItems: 1,
      maxItems: 10000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string', maxLength: 200 },
          persistentId: { type: 'string', maxLength: 200 },
          centroidMm: CAD_DIFF_CENTROID_SCHEMA,
          centroid: CAD_DIFF_CENTROID_SCHEMA
        }
      }
    }
  }
});

const CAD_VISUAL_DIFF_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['options'],
  properties: {
    modelA: CAD_DIFF_REVISION_SCHEMA,
    modelB: CAD_DIFF_REVISION_SCHEMA,
    revA: CAD_DIFF_REVISION_SCHEMA,
    revB: CAD_DIFF_REVISION_SCHEMA,
    options: {
      type: 'object',
      additionalProperties: false,
      required: ['toleranceMm', 'modificationThresholdMm'],
      properties: {
        toleranceMm: { type: 'number', min: 0, max: 100 },
        modificationThresholdMm: { type: 'number', min: 0, max: 100 }
      }
    }
  }
});

const ENGINEERING_BOM_ROLLUP_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    rootAssembly: { type: 'object' },
    partNumber: { type: 'string', maxLength: 200 },
    name: { type: 'string', maxLength: 500 },
    quantity: { type: 'number', min: Number.MIN_VALUE },
    unitMassKg: { type: 'number', min: 0 },
    unitCostUsd: { type: 'number', min: 0 },
    items: { type: 'array', maxItems: 10000, items: { type: 'object' } }
  }
});

const CAD_DRAFTING_SHEET_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['partName', 'partNumber', 'width', 'height', 'depth', 'scale', 'units'],
  properties: {
    partName: { type: 'string', maxLength: 200 },
    partNumber: { type: 'string', maxLength: 100 },
    width: { type: 'number', min: Number.MIN_VALUE, max: 1000000 },
    height: { type: 'number', min: Number.MIN_VALUE, max: 1000000 },
    depth: { type: 'number', min: Number.MIN_VALUE, max: 1000000 },
    scale: { type: 'string', maxLength: 20 },
    units: { type: 'string', enum: ['mm'] }
  }
});

const CAD_DIMENSIONS_MM_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['width', 'height', 'depth', 'units'],
  properties: {
    width: { type: 'number', min: Number.MIN_VALUE, max: 1000000 },
    height: { type: 'number', min: Number.MIN_VALUE, max: 1000000 },
    depth: { type: 'number', min: Number.MIN_VALUE, max: 1000000 },
    units: { type: 'string', enum: ['mm'] }
  }
});

const CAD_PRIMITIVE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['type', 'params'],
  properties: {
    type: { type: 'string', enum: ['box', 'cylinder', 'sphere'] },
    params: { type: 'object', required: ['units'], properties: { units: { type: 'string', enum: ['mm'] } } }
  }
});

const CAD_EXPORT_OBJ_SCHEMA = CAD_DIMENSIONS_MM_SCHEMA;

const CAD_EXPORT_STEP_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['width', 'height', 'depth', 'units', 'name'],
  properties: {
    width: CAD_DIMENSIONS_MM_SCHEMA.properties.width,
    height: CAD_DIMENSIONS_MM_SCHEMA.properties.height,
    depth: CAD_DIMENSIONS_MM_SCHEMA.properties.depth,
    units: CAD_DIMENSIONS_MM_SCHEMA.properties.units,
    name: { type: 'string', maxLength: 100 }
  }
});

function runCadPrimitive(params) {
  validateSchema(params, CAD_PRIMITIVE_SCHEMA);
  const requiredByType = {
    box: ['width', 'height', 'depth', 'units'],
    cylinder: ['radius', 'height', 'units'],
    sphere: ['radius', 'units']
  };
  const required = requiredByType[params.type];
  const supplied = Object.keys(params.params);
  if (supplied.length !== required.length || required.some((name) => !Object.hasOwn(params.params, name))) {
    throw new TypeError(`The ${params.type} primitive requires exactly: ${required.join(', ')}.`);
  }
  for (const name of required.filter((key) => key !== 'units')) {
    const value = params.params[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1000000) {
      throw new TypeError(`Primitive ${name} must be a finite millimeter value in (0, 1,000,000].`);
    }
  }

  let body;
  if (params.type === 'cylinder') {
    body = BRepPrimitives.createCylinder(params.params.radius, params.params.height);
  } else if (params.type === 'sphere') {
    body = BRepPrimitives.createSphere(params.params.radius);
  } else {
    body = BRepPrimitives.createBox(params.params.width, params.params.height, params.params.depth);
  }
  return {
    success: true,
    id: body.id,
    name: body.name,
    units: 'mm',
    volumeMm3: body.computeVolume(),
    triangles: body.toTriangles(),
    bbox: body.getBoundingBox()
  };
}

function runCadExportOBJ(params) {
  validateSchema(params, CAD_EXPORT_OBJ_SCHEMA);
  const body = BRepPrimitives.createBox(params.width, params.height, params.depth);
  return body.toOBJ();
}

function runCadExportSTEP(params) {
  validateSchema(params, CAD_EXPORT_STEP_SCHEMA);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(params.name)) {
    throw new TypeError(
      'STEP model name must start with a letter and contain only letters, numbers, underscores, or hyphens.'
    );
  }
  const box = BRepPrimitives.createBox(params.width, params.height, params.depth, params.name);
  return {
    success: true,
    validationLevel: 'experimental',
    units: 'mm',
    stepText: StepTranslator.exportSTEP(box, params.name),
    filename: `${params.name}.step`
  };
}

function runDraftingSheet(params) {
  try {
    validateSchema(params, CAD_DRAFTING_SHEET_SCHEMA);
    if (!params.partName.trim() || !params.partNumber.trim() || !params.scale.trim()) {
      throw new TypeError('Part name, drawing number, and scale must be non-empty strings.');
    }

    const solid = BRepPrimitives.createBox(params.width, params.height, params.depth);
    solid.name = params.partName;
    const sheet = DraftingEngine2D.generateDrawingSheet(solid, {
      title: params.partName,
      partNumber: params.partNumber,
      scale: params.scale
    });
    return {
      success: true,
      validationLevel: 'experimental',
      standardsConformance: 'not-evaluated',
      units: params.units,
      svg: sheet.svg,
      sheetWidth: sheet.sheetWidth,
      sheetHeight: sheet.sheetHeight
    };
  } catch (error) {
    return {
      success: false,
      status: 'invalid-input',
      validationLevel: 'experimental',
      error: { code: 'INVALID_INPUT', message: error.message }
    };
  }
}

function runVisualDiffCAD(params) {
  try {
    validateSchema(params, CAD_VISUAL_DIFF_SCHEMA);
    const hasModelA = params.modelA !== undefined;
    const hasRevisionA = params.revA !== undefined;
    const hasModelB = params.modelB !== undefined;
    const hasRevisionB = params.revB !== undefined;
    if (hasModelA === hasRevisionA || hasModelB === hasRevisionB) {
      throw new TypeError('Supply exactly one of modelA/revA and exactly one of modelB/revB.');
    }

    const engine = new GitCADVisualDiffEngine(params.options);
    const result = engine.compareRevisions(
      hasModelA ? params.modelA : params.revA,
      hasModelB ? params.modelB : params.revB
    );
    return { success: true, ...result };
  } catch (error) {
    const resourceExhausted = error instanceof RangeError && /resource limit/.test(error.message);
    const numericalFailure = error instanceof RangeError && /finite numeric range/.test(error.message);
    const code = resourceExhausted ? 'RESOURCE_EXHAUSTED' : numericalFailure ? 'NUMERICAL_FAILURE' : 'INVALID_INPUT';
    return {
      success: false,
      status: resourceExhausted ? 'resource-exhausted' : numericalFailure ? 'numerical-failure' : 'invalid-input',
      validationLevel: 'experimental',
      error: { code, message: error.message }
    };
  }
}

function runEngineeringBOMRollup(params) {
  try {
    validateSchema(params, ENGINEERING_BOM_ROLLUP_SCHEMA);
    const hasRootAssembly = params.rootAssembly !== undefined;
    const legacyFields = ['partNumber', 'name', 'quantity', 'unitMassKg', 'unitCostUsd', 'items'];
    const hasLegacyFields = legacyFields.some((field) => params[field] !== undefined);
    if (hasRootAssembly === hasLegacyFields) {
      throw new TypeError('Supply either rootAssembly or the explicit legacy root fields with items.');
    }
    let rootAssembly = params.rootAssembly;
    if (hasLegacyFields) {
      if (legacyFields.some((field) => params[field] === undefined)) {
        throw new TypeError(
          'Legacy eBOM requests require explicit partNumber, name, quantity, unitMassKg, unitCostUsd, and items.'
        );
      }
      rootAssembly = {
        partNumber: params.partNumber,
        name: params.name,
        quantity: params.quantity,
        unitMassKg: params.unitMassKg,
        unitCostUsd: params.unitCostUsd,
        children: params.items
      };
    }
    const bom = new EngineeringBOMManager();
    bom.setRootAssembly(rootAssembly);
    const rolledUp = bom.computeRollUp();
    const requestedTotals = {
      rootAssemblyQuantity: bom.rootAssembly.quantity,
      totalPartCount: rolledUp.totalPartCount * bom.rootAssembly.quantity,
      rolledUpMassKg: rolledUp.rolledUpMassKg * bom.rootAssembly.quantity,
      rolledUpCostUsd: rolledUp.rolledUpCostUsd * bom.rootAssembly.quantity
    };
    if (
      ![
        requestedTotals.rootAssemblyQuantity,
        requestedTotals.totalPartCount,
        requestedTotals.rolledUpMassKg,
        requestedTotals.rolledUpCostUsd
      ].every(Number.isFinite)
    ) {
      throw new RangeError('eBOM requested totals exceeded the finite numeric range.');
    }
    const indented = bom.generateIndentedBOM();
    const flattened = bom.generateFlattenedBOM();
    const csv = bom.exportToCSV();
    return {
      success: true,
      validationLevel: 'experimental',
      inputs: rootAssembly,
      rolledUp,
      requestedTotals,
      indented,
      flattened,
      csv,
      warnings: [
        'Mass, cost, material, and supplier values are caller-supplied and have not been independently reviewed.'
      ]
    };
  } catch (error) {
    const numericalFailure = error instanceof RangeError && /finite numeric range/.test(error.message);
    return {
      success: false,
      status: numericalFailure ? 'numerical-failure' : 'invalid-input',
      validationLevel: 'experimental',
      error: { code: numericalFailure ? 'NUMERICAL_FAILURE' : 'INVALID_INPUT', message: error.message }
    };
  }
}

function registerCadIpc(deps = {}) {
  const outOfCoreOctree = deps.outOfCoreOctree;

  // 1. Primitive Creation
  defineHandler('omni:create-cad-primitive', CAD_PRIMITIVE_SCHEMA, async (event, params) => runCadPrimitive(params), {
    domain: 'cad',
    description: 'Create CAD B-Rep primitive'
  });

  // 2. Export CAD OBJ
  defineHandler('omni:export-cad-obj', CAD_EXPORT_OBJ_SCHEMA, async (event, params) => runCadExportOBJ(params), {
    domain: 'cad',
    description: 'Export B-Rep to Wavefront OBJ'
  });

  // 3. Export STEP AP242
  defineHandler('omni:export-step', CAD_EXPORT_STEP_SCHEMA, async (event, params) => runCadExportSTEP(params), {
    domain: 'cad',
    description: 'Generate STEP-format geometry text; schema conformance and interoperability are not verified'
  });

  // 4. Evaluate NURBS
  defineHandler(
    'omni:evaluate-nurbs',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const { degree = 3, controlPoints = [], u = 0.5 } = params;
      const curve = new NurbsCurve({ degree, controlPoints });
      const point = curve.evaluate(u);
      const tangent = curve.evaluateTangent(u);
      const length = curve.computeLength(40);
      return { success: true, point: point.toArray(), tangent: tangent.toArray(), length };
    },
    { domain: 'cad', description: 'Evaluate NURBS curve point, tangent, and arc length' }
  );

  // 5. Intersect Basic NURBS SSI
  defineHandler(
    'omni:intersect-basic-nurbs-ssi',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
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
        points: ssi.points.map((p) => p.toArray()),
        curveLength: ssi.curveLength
      };
    },
    { domain: 'cad', description: 'Intersect analytical NURBS surfaces' }
  );

  // 6. Apply Edge Blend (Fillet / Chamfer)
  defineHandler(
    'omni:apply-edge-blend',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const { type = 'fillet', width = 20, height = 20, depth = 20, radius = 2.0, distance = 2.0 } = params;
      const solid = BRepPrimitives.createBox(width, height, depth);
      const targetEdge = solid.edges[0];
      if (type === 'chamfer') {
        const res = EdgeBlender.applyChamfer(solid, targetEdge, distance);
        return { success: true, type: 'chamfer', bevelArea: res.bevelArea, solidVolume: solid.computeVolume() };
      } else {
        const res = EdgeBlender.applyFillet(solid, targetEdge, radius);
        return {
          success: true,
          type: 'fillet',
          blendFacesCount: res.blendFacesCount,
          filletSurfaceArea: res.filletSurfaceArea
        };
      }
    },
    { domain: 'cad', description: 'Apply rolling-ball fillet or chamfer to solid' }
  );

  // 7. Solve Assembly Mates
  defineHandler(
    'omni:solve-assembly-mates',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const solver = new AssemblyMateSolver();
      const base = new AssemblyComponent('comp_base', 'BasePlate', { fixed: true });
      const part = new AssemblyComponent('comp_part', 'MountedPart', {
        position: new Vector3(params.initX || 5, params.initY || 5, params.initZ || 20),
        fixed: false
      });
      solver.addComponent(base);
      solver.addComponent(part);
      solver.addConcentric(
        'comp_base',
        new Vector3(0, 0, 0),
        new Vector3(0, 0, 1),
        'comp_part',
        new Vector3(0, 0, 0),
        new Vector3(0, 0, 1)
      );
      solver.addCoincidentPlanes(
        'comp_base',
        new Vector3(0, 0, params.targetZ || 10),
        new Vector3(0, 0, 1),
        'comp_part',
        new Vector3(0, 0, 0),
        new Vector3(0, 0, -1)
      );
      const result = solver.solve(params.maxIter || 40, 1e-4);
      return { success: true, result };
    },
    { domain: 'cad', description: 'Solve 6-DOF assembly geometric mate constraints' }
  );

  // 8. Generate 2D Drafting Sheet
  defineHandler(
    'omni:generate-drafting-sheet',
    CAD_DRAFTING_SHEET_SCHEMA,
    async (event, params) => runDraftingSheet(params),
    {
      domain: 'cad',
      description:
        'Generate an experimental box drawing from explicit millimeter dimensions and drawing labels; no GD&T is supplied or standards conformance assessed'
    }
  );

  // 9. Intersect Trimmed NURBS SSI
  defineHandler(
    'omni:intersect-nurbs-ssi',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const surf1 = new TrimmedNurbsSurface(params.surf1 || {});
      const surf2 = new TrimmedNurbsSurface(params.surf2 || {});
      const res = SurfaceSurfaceIntersectionEngine.intersectSurfaces(
        surf1,
        surf2,
        params.options || { tolerance: 0.05 }
      );
      return { success: true, result: res };
    },
    {
      domain: 'cad',
      description: 'Run an experimental trimmed-surface intersection example; accuracy is not independently verified'
    }
  );

  // 10. Sheet Metal Unfolding
  defineHandler(
    'omni:unfold-sheet-metal',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const bend = new SheetMetalBend(
        params.bend || { angleDeg: 90.0, innerRadiusMm: 2.0, thicknessMm: 2.0, kFactor: 0.44 }
      );
      const flanges = (
        params.flanges || [
          { name: 'F1', lengthMm: 50, widthMm: 50 },
          { name: 'F2', lengthMm: 50, widthMm: 50 }
        ]
      ).map((f) => new SheetMetalFlange(f.name, f.lengthMm, f.widthMm));
      const flat = SheetMetalUnfolder.unfoldPart({ flanges, bends: [bend] });
      return { success: true, flat, bendAllowanceMm: bend.bendAllowanceMm, bendDeductionMm: bend.bendDeductionMm };
    },
    { domain: 'cad', description: 'Compute DIN 6935 K-factor developed blank flat sheet' }
  );

  // 11. GD&T Evaluation
  defineHandler(
    'omni:evaluate-gdt',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const fcf = new FeatureControlFrame(params.fcf || { specifiedTolerance: 0.2, materialCondition: 'MMC' });
      const res = GDTEngine.evaluateTruePosition(
        params.hole || {
          nominalX: 50.0,
          nominalY: 30.0,
          measuredX: 50.08,
          measuredY: 29.95,
          nominalDiameter: 10.0,
          measuredDiameter: 10.25,
          lowerTolerance: -0.3,
          upperTolerance: 0.3
        },
        fcf
      );
      return { success: true, validationLevel: 'experimental', result: res };
    },
    {
      domain: 'cad',
      description: 'Calculate an experimental sample tolerance result; standards conformance is not established'
    }
  );

  // 12. Variational Sketch Constraint Solver
  defineHandler(
    'omni:solve-variational-sketch',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
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
    },
    { domain: 'cad', description: 'Newton-Raphson SVD variational geometric 2D constraint solver' }
  );

  // 13. Auto-Heal CAD Geometry
  defineHandler(
    'omni:heal-cad-geometry',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const healer = new TopologicalHealingEngine(params.options || { tolerance: 0.05 });
      const res = healer.healSolid(params.dirtyModel || { vertices: [], faces: [] }, params.options);
      return { success: res.healed, ...res };
    },
    {
      domain: 'cad',
      description: 'Run experimental topology cleanup; solid validity and watertightness are not established'
    }
  );

  // 14. 3D CAD Visual Diff
  defineHandler('omni:visual-diff-cad', CAD_VISUAL_DIFF_SCHEMA, async (event, params) => runVisualDiffCAD(params), {
    domain: 'cad',
    description: 'Compare supplied geometry with a centroid heuristic; no structural assessment is performed'
  });

  // 15. Engineering BOM Roll-Up
  defineHandler(
    'omni:rollup-ebom',
    ENGINEERING_BOM_ROLLUP_SCHEMA,
    async (event, params) => runEngineeringBOMRollup(params),
    {
      domain: 'cad',
      description: 'Experimental hierarchy roll-up from explicit caller-supplied part, quantity, mass, and cost data'
    }
  );

  // 16. Standard Fasteners Library
  defineHandler(
    'omni:get-standard-fastener',
    {
      type: 'object',
      optional: true
    },
    async () => {
      return StandardPartsLibrary.getAvailability();
    },
    {
      domain: 'cad',
      description:
        'Unavailable pending review of standard-part sources, revisions, applicability, and redistribution rights'
    }
  );

  // 17. Out-of-Core Spatial Octree LOD
  defineHandler(
    'omni:get-out-of-core-lod',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      if (!outOfCoreOctree) {
        return { success: true, visibleCount: 0, items: [] };
      }
      const { cameraPosition = [0, 0, 100], frustumBounds = [-200, -200, -200, 200, 200, 200] } = params;
      const res = outOfCoreOctree.evaluateVisibleLODs(cameraPosition, frustumBounds);
      return { success: true, ...res };
    },
    { domain: 'cad', description: 'Evaluate visible LOD levels from spatial octree' }
  );

  // 18. Experimental primitive geometry metrics (not AP242 / CAx-IF validation)
  defineHandler(
    'omni:compute-cad-validation-properties',
    {
      type: 'object',
      properties: {
        dx: { type: 'number', optional: true },
        dy: { type: 'number', optional: true },
        dz: { type: 'number', optional: true },
        shapeType: { type: 'string', optional: true }
      },
      optional: true
    },
    async (event, params = {}) => {
      const dimensions = [params.dx, params.dy, params.dz];
      if (!dimensions.every((value) => Number.isFinite(value) && value > 0)) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Positive dx, dy, and dz dimensions in millimetres are required.' }
        };
      }
      if (params.shapeType && !['box', 'cylinder'].includes(params.shapeType)) {
        return { success: false, error: { code: 'INVALID_INPUT', message: 'shapeType must be box or cylinder.' } };
      }
      if (params.shapeType === 'cylinder' && (!Number.isFinite(params.radius) || params.radius <= 0)) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'A positive cylinder radius in millimetres is required.' }
        };
      }
      const [dx, dy, dz] = dimensions;
      let body;
      if (params.shapeType === 'cylinder') {
        body = defaultGeometryKernel.makeCylinder(params.radius, dz, 'ExperimentalCylinder');
      } else {
        body = defaultGeometryKernel.makeBox(dx, dy, dz, 'ExperimentalBox');
      }
      const props = defaultGeometryKernel.computeValidationProperties(body);
      return { success: true, validationLevel: 'experimental', properties: props, bodyName: body.name };
    },
    { domain: 'cad', description: 'Compute experimental metrics for a user-specified box or cylinder primitive' }
  );
  defineHandler(
    'omni:cad-extrude-profile',
    CAD_EXTRUDE_PROFILE_SCHEMA,
    async (event, params) => {
      const { FeatureOperations } = require('../../core/cad/feature_operations');
      const body = FeatureOperations.extrude(params.profile, params.depth, { draftAngleDeg: params.draftAngleDeg });
      return {
        success: true,
        id: body.id,
        name: body.name,
        volume: body.computeVolume(),
        units: { length: 'mm', volume: 'mm^3' },
        bbox: body.getBoundingBox(),
        triangles: body.toTriangles(),
        faceCount: body.faces.length
      };
    },
    {
      domain: 'cad',
      description: 'Run an experimental extrusion from an explicit profile, millimetre units, depth, and draft angle'
    }
  );

  // 20. Parametric CAD 3D Rotational Revolution
  defineHandler(
    'omni:cad-revolve-profile',
    CAD_REVOLVE_PROFILE_SCHEMA,
    async (event, params) => {
      const { FeatureOperations } = require('../../core/cad/feature_operations');
      const body = FeatureOperations.revolve(params.profile, params.angleDeg, params.axis, params.segments);
      return {
        success: true,
        id: body.id,
        name: body.name,
        faceCount: body.faces.length,
        units: { length: 'mm' },
        triangles: body.toTriangles()
      };
    },
    {
      domain: 'cad',
      description: 'Generate an experimental revolved geometry example; topology validity is not assessed'
    }
  );

  // 21. Parametric CAD Thin-Wall Shell
  defineHandler(
    'omni:cad-shell-body',
    CAD_SHELL_BODY_SCHEMA,
    async (event, params) => {
      const { FeatureOperations } = require('../../core/cad/feature_operations');
      const baseBox = BRepPrimitives.createBox(params.width, params.height, params.depth);
      const shelled = FeatureOperations.shell(baseBox, params.wallThickness, params.openFaceIndex);
      const body = shelled.solid;
      return {
        success: true,
        id: body.id,
        name: body.name,
        faceCount: body.faces.length,
        wallThickness: params.wallThickness,
        units: { length: 'mm' },
        triangles: body.toTriangles()
      };
    },
    {
      domain: 'cad',
      description: 'Generate an experimental shell example; wall uniformity and topology validity are not assessed'
    }
  );

  // 22. CAM 3-Axis CNC Toolpath Generation & G-Code Post-Processor
  defineHandler(
    'omni:cam-generate-toolpath',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
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
    },
    {
      domain: 'cad',
      description:
        'Generate illustrative toolpath and G-code text; no machine-specific postprocessor or NC validation is provided'
    }
  );

  // 23. Legacy aerospace feature-history API retained as an unavailable compatibility route.
  defineHandler(
    'omni:get-rocket-feature-tree',
    {
      type: 'object',
      optional: true
    },
    async () => ({
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message:
          'Aerospace feature history is unavailable. No source-verified or caller-supplied vehicle definition is loaded.'
      }
    }),
    {
      domain: 'cad',
      description: 'Aerospace feature history is unavailable pending source-reviewed or caller-supplied model data'
    }
  );
}

module.exports = {
  registerCadIpc,
  CAD_PRIMITIVE_SCHEMA,
  CAD_EXPORT_OBJ_SCHEMA,
  CAD_EXPORT_STEP_SCHEMA,
  runCadPrimitive,
  runCadExportOBJ,
  runCadExportSTEP,
  runEngineeringBOMRollup,
  CAD_DRAFTING_SHEET_SCHEMA,
  runDraftingSheet,
  runVisualDiffCAD,
  ENGINEERING_BOM_ROLLUP_SCHEMA,
  CAD_VISUAL_DIFF_SCHEMA
};
