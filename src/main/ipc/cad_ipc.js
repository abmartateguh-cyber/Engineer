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
const { SlvsSolver } = require('../../core/cad/slvs_solver');
const { getOpenCascadeKernel, TopoSolid } = require('../../core/cad/opencascade_kernel');
const {
  CAD_EXTRUDE_PROFILE_SCHEMA,
  CAD_REVOLVE_PROFILE_SCHEMA,
  CAD_SHELL_BODY_SCHEMA,
  CAD_SHEET_METAL_SCHEMA
} = require('./cad_schemas');

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

const CAD_SOLVE_SLVS_SCHEMA = Object.freeze({
  type: 'object',
  required: ['constraints'],
  properties: {
    points: {
      optional: true
    },
    constraints: {
      type: 'array',
      minItems: 1
    },
    options: {
      type: 'object',
      optional: true
    }
  }
});

const CAD_OCC_OPERATION_SCHEMA = Object.freeze({
  type: 'object',
  required: ['operation'],
  properties: {
    operation: {
      type: 'string'
    },
    params: {
      type: 'object',
      optional: true
    },
    solidA: {
      optional: true
    },
    solidB: {
      optional: true
    },
    solid: {
      optional: true
    },
    edgeIds: {
      type: 'array',
      optional: true
    },
    radius: {
      type: 'number',
      optional: true
    },
    distance: {
      type: 'number',
      optional: true
    }
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

function runSolveSlvsConstraints(params) {
  validateSchema(params, CAD_SOLVE_SLVS_SCHEMA);
  const solver = new SlvsSolver();

  if (Array.isArray(params.points)) {
    for (const pt of params.points) {
      if (typeof pt === 'object' && pt !== null) {
        solver.addPoint(pt.id, pt.x ?? 0, pt.y ?? 0, pt.z ?? 0, Boolean(pt.isFixed ?? pt.fixed));
      }
    }
  } else if (params.points && typeof params.points === 'object') {
    for (const [id, pt] of Object.entries(params.points)) {
      if (Array.isArray(pt)) {
        solver.addPoint(id, pt[0] ?? 0, pt[1] ?? 0, pt[2] ?? 0, false);
      } else if (typeof pt === 'object' && pt !== null) {
        solver.addPoint(id, pt.x ?? 0, pt.y ?? 0, pt.z ?? 0, Boolean(pt.isFixed ?? pt.fixed));
      }
    }
  }

  const ensurePoint = (id, defX = 0, defY = 0, defZ = 0) => {
    if (id !== undefined && id !== null && !solver.points.has(id)) {
      solver.addPoint(id, defX, defY, defZ, false);
    }
  };

  for (const c of params.constraints) {
    if (!c || typeof c !== 'object') continue;
    const type = String(c.type || '').toLowerCase();

    switch (type) {
      case 'coincident':
      case 'coincident_x':
      case 'coincident_y':
      case 'coincident_z': {
        ensurePoint(c.p1);
        ensurePoint(c.p2);
        solver.addCoincidentConstraint(c.p1, c.p2);
        break;
      }
      case 'distance': {
        ensurePoint(c.p1);
        ensurePoint(c.p2);
        const targetDist = c.value ?? c.distance ?? c.val ?? 0;
        solver.addDistanceConstraint(c.p1, c.p2, targetDist);
        break;
      }
      case 'horizontal': {
        ensurePoint(c.p1);
        ensurePoint(c.p2);
        solver.addHorizontalConstraint(c.p1, c.p2);
        break;
      }
      case 'vertical': {
        ensurePoint(c.p1);
        ensurePoint(c.p2);
        solver.addVerticalConstraint(c.p1, c.p2);
        break;
      }
      case 'concentric': {
        const c1 = c.p1 ?? c.c1;
        const c2 = c.p2 ?? c.c2;
        ensurePoint(c1);
        ensurePoint(c2);
        solver.addConcentricConstraint(c1, c2);
        break;
      }
      case 'perpendicular': {
        const p1 = c.p1 ?? c.line1?.[0];
        const p2 = c.p2 ?? c.line1?.[1];
        const p3 = c.p3 ?? c.line2?.[0];
        const p4 = c.p4 ?? c.line2?.[1] ?? null;
        ensurePoint(p1);
        ensurePoint(p2);
        ensurePoint(p3);
        if (p4) ensurePoint(p4);
        solver.addPerpendicularConstraint(p1, p2, p3, p4);
        break;
      }
      case 'tangent': {
        const p1 = c.p1 ?? c.line?.[0];
        const p2 = c.p2 ?? c.line?.[1];
        const center = c.center ?? c.circle?.center ?? c.p3;
        const radius = c.radius ?? c.circle?.radius ?? c.value ?? 0;
        ensurePoint(p1);
        ensurePoint(p2);
        ensurePoint(center);
        solver.addTangentConstraint(p1, p2, center, radius);
        break;
      }
      case 'angle': {
        const p1 = c.p1 ?? c.line1?.[0];
        const p2 = c.p2 ?? c.line1?.[1];
        const p3 = c.p3 ?? c.line2?.[0];
        const p4 = c.p4 ?? c.line2?.[1] ?? null;
        const angle = c.angle ?? c.angleRad ?? c.value ?? 0;
        ensurePoint(p1);
        ensurePoint(p2);
        ensurePoint(p3);
        if (p4) ensurePoint(p4);
        solver.addAngleConstraint(p1, p2, p3, p4, angle);
        break;
      }
      default:
        throw new Error(`Unsupported constraint type: '${c.type}'`);
    }
  }

  const solution = solver.solve(params.options || {});
  return {
    success: true,
    converged: solution.converged,
    iterations: solution.iterations,
    residualNorm: solution.residualNorm,
    dof: solution.dof,
    effectiveDof: solution.effectiveDof,
    rank: solution.rank,
    parameterCount: solution.parameterCount,
    constraintCount: solution.constraintCount,
    points: solution.points,
    constraintsEvaluated: params.constraints.length,
    status: solution.converged ? 'converged' : 'iteration-limit-reached'
  };
}

const occSolidRegistry = new Map();

function resolveSolid(kernel, descriptor) {
  if (!descriptor) return null;
  if (descriptor instanceof TopoSolid) return descriptor;
  if (typeof descriptor === 'string') {
    if (occSolidRegistry.has(descriptor)) return occSolidRegistry.get(descriptor);
    throw new Error(`Solid ID '${descriptor}' not found in registry.`);
  }
  if (descriptor.id && occSolidRegistry.has(descriptor.id)) {
    return occSolidRegistry.get(descriptor.id);
  }
  const type = String(descriptor.type || descriptor.operation || '').toLowerCase();
  const p = descriptor.params || descriptor;
  if (type === 'box') {
    const dx = p.dx ?? p.width ?? p.x ?? 10;
    const dy = p.dy ?? p.height ?? p.y ?? 10;
    const dz = p.dz ?? p.depth ?? p.z ?? 10;
    return kernel.makeBox(Number(dx), Number(dy), Number(dz));
  }
  if (type === 'cylinder') {
    const radius = p.radius ?? p.r ?? 5;
    const height = p.height ?? p.h ?? 10;
    return kernel.makeCylinder(Number(radius), Number(height));
  }
  if (type === 'sphere') {
    const radius = p.radius ?? p.r ?? 5;
    return kernel.makeSphere(Number(radius));
  }
  if (type === 'cone') {
    const r1 = p.r1 ?? p.radius1 ?? p.radius ?? 5;
    const r2 = p.r2 ?? p.radius2 ?? 0;
    const height = p.height ?? p.h ?? 10;
    return kernel.makeCone(Number(r1), Number(r2), Number(height));
  }
  if (Array.isArray(descriptor.faces)) {
    const s = new TopoSolid(descriptor.faces);
    s.shells = descriptor.shells ?? 1;
    s.genus = descriptor.genus ?? 0;
    s.properties = descriptor.properties || {};
    return s;
  }
  throw new Error(`Cannot resolve solid operand: ${JSON.stringify(descriptor)}`);
}

function runOccBrepOperation(params) {
  validateSchema(params, CAD_OCC_OPERATION_SCHEMA);
  const kernel = getOpenCascadeKernel();
  const op = String(params.operation || '').toLowerCase();
  const p = params.params || {};

  let resultSolid;
  let opName = params.operation;

  switch (op) {
    case 'makebox':
    case 'box': {
      opName = 'makeBox';
      const dx = p.dx ?? p.width ?? p.x ?? params.dx ?? params.width;
      const dy = p.dy ?? p.height ?? p.y ?? params.dy ?? params.height;
      const dz = p.dz ?? p.depth ?? p.z ?? params.dz ?? params.depth;
      if (dx === undefined || dy === undefined || dz === undefined) {
        throw new TypeError('Box operation requires dx, dy, and dz dimensions.');
      }
      resultSolid = kernel.makeBox(Number(dx), Number(dy), Number(dz));
      break;
    }
    case 'makecylinder':
    case 'cylinder': {
      opName = 'makeCylinder';
      const radius = p.radius ?? p.r ?? params.radius;
      const height = p.height ?? p.h ?? params.height;
      if (radius === undefined || height === undefined) {
        throw new TypeError('Cylinder operation requires radius and height.');
      }
      resultSolid = kernel.makeCylinder(Number(radius), Number(height));
      break;
    }
    case 'makesphere':
    case 'sphere': {
      opName = 'makeSphere';
      const radius = p.radius ?? p.r ?? params.radius;
      if (radius === undefined) {
        throw new TypeError('Sphere operation requires radius.');
      }
      resultSolid = kernel.makeSphere(Number(radius));
      break;
    }
    case 'makecone':
    case 'cone': {
      opName = 'makeCone';
      const r1 = p.r1 ?? p.radius1 ?? p.radius ?? params.r1 ?? params.radius;
      const r2 = p.r2 ?? p.radius2 ?? (params.r2 !== undefined ? params.r2 : 0);
      const height = p.height ?? p.h ?? params.height;
      if (r1 === undefined || height === undefined) {
        throw new TypeError('Cone operation requires r1 and height.');
      }
      resultSolid = kernel.makeCone(Number(r1), Number(r2), Number(height));
      break;
    }
    case 'booleancut':
    case 'cut': {
      opName = 'booleanCut';
      const solidA = resolveSolid(kernel, params.solidA ?? params.solid ?? p.solidA);
      const solidB = resolveSolid(kernel, params.solidB ?? p.solidB);
      if (!solidA || !solidB) throw new TypeError('Boolean cut requires both solidA and solidB operands.');
      resultSolid = kernel.booleanCut(solidA, solidB);
      break;
    }
    case 'booleanfuse':
    case 'fuse': {
      opName = 'booleanFuse';
      const solidA = resolveSolid(kernel, params.solidA ?? params.solid ?? p.solidA);
      const solidB = resolveSolid(kernel, params.solidB ?? p.solidB);
      if (!solidA || !solidB) throw new TypeError('Boolean fuse requires both solidA and solidB operands.');
      resultSolid = kernel.booleanFuse(solidA, solidB);
      break;
    }
    case 'booleancommon':
    case 'common': {
      opName = 'booleanCommon';
      const solidA = resolveSolid(kernel, params.solidA ?? params.solid ?? p.solidA);
      const solidB = resolveSolid(kernel, params.solidB ?? p.solidB);
      if (!solidA || !solidB) throw new TypeError('Boolean common requires both solidA and solidB operands.');
      resultSolid = kernel.booleanCommon(solidA, solidB);
      break;
    }
    case 'makefillet':
    case 'fillet': {
      opName = 'makeFillet';
      const solid = resolveSolid(kernel, params.solid ?? params.solidA ?? p.solid);
      const edgeIds = params.edgeIds ?? p.edgeIds ?? solid?.faces[0]?.edges.map((e) => e.id) ?? [];
      const radius = params.radius ?? p.radius ?? 1.0;
      if (!solid) throw new TypeError('Fillet operation requires a solid.');
      resultSolid = kernel.makeFillet(solid, edgeIds, Number(radius));
      break;
    }
    case 'makechamfer':
    case 'chamfer': {
      opName = 'makeChamfer';
      const solid = resolveSolid(kernel, params.solid ?? params.solidA ?? p.solid);
      const edgeIds = params.edgeIds ?? p.edgeIds ?? solid?.faces[0]?.edges.map((e) => e.id) ?? [];
      const distance = params.distance ?? p.distance ?? 1.0;
      if (!solid) throw new TypeError('Chamfer operation requires a solid.');
      resultSolid = kernel.makeChamfer(solid, edgeIds, Number(distance));
      break;
    }
    case 'verifyeulerpoincare':
    case 'checkeulerpoincare': {
      opName = 'verifyEulerPoincare';
      const solid = resolveSolid(kernel, params.solid ?? params.solidA ?? p.solid);
      if (!solid) throw new TypeError('verifyEulerPoincare requires a solid.');
      resultSolid = solid;
      break;
    }
    case 'shapefix': {
      opName = 'shapeFix';
      const solid = resolveSolid(kernel, params.solid ?? params.solidA ?? p.solid);
      if (!solid) throw new TypeError('shapeFix requires a solid.');
      const fixReport = kernel.shapeFix(solid);
      return {
        success: true,
        operation: 'shapeFix',
        ...fixReport
      };
    }
    default:
      throw new Error(`Unsupported OCC B-Rep operation: '${params.operation}'`);
  }

  occSolidRegistry.set(resultSolid.id, resultSolid);

  const ep = resultSolid.verifyEulerPoincare();
  const stats = resultSolid.getTopologyStats();

  return {
    success: true,
    operation: opName,
    solid: {
      id: resultSolid.id,
      type: resultSolid.properties?.type || 'Solid',
      volume: resultSolid.properties?.volume,
      surfaceArea: resultSolid.properties?.surfaceArea,
      facesCount: resultSolid.faces.length,
      edgesCount: stats.E,
      verticesCount: stats.V,
      shells: resultSolid.shells,
      genus: resultSolid.genus,
      properties: resultSolid.properties
    },
    eulerPoincare: {
      valid: ep.valid,
      lhs: ep.lhs,
      rhs: ep.rhs,
      formula: 'V - E + F = 2(S - G)',
      V: ep.V,
      E: ep.E,
      F: ep.F,
      S: ep.S,
      G: ep.G
    },
    topology: stats
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
      if (Array.isArray(params.components) && params.components.length > 0) {
        for (const c of params.components) {
          const pos = c.position
            ? new Vector3(c.position.x || 0, c.position.y || 0, c.position.z || 0)
            : new Vector3(0, 0, 0);
          const comp = new AssemblyComponent(c.id, c.name || c.id, {
            position: pos,
            fixed: !!c.fixed
          });
          solver.addComponent(comp);
        }
        if (Array.isArray(params.constraints)) {
          for (const cn of params.constraints) {
            if (cn.type === 'concentric') {
              solver.addConcentric(
                cn.compId1,
                new Vector3(cn.pt1?.x || 0, cn.pt1?.y || 0, cn.pt1?.z || 0),
                new Vector3(cn.axis1?.x || 0, cn.axis1?.y || 0, cn.axis1?.z || 1),
                cn.compId2,
                new Vector3(cn.pt2?.x || 0, cn.pt2?.y || 0, cn.pt2?.z || 0),
                new Vector3(cn.axis2?.x || 0, cn.axis2?.y || 0, cn.axis2?.z || 1)
              );
            } else if (cn.type === 'coincident_planes') {
              solver.addCoincidentPlanes(
                cn.compId1,
                new Vector3(cn.pt1?.x || 0, cn.pt1?.y || 0, cn.pt1?.z || 0),
                new Vector3(cn.n1?.x || 0, cn.n1?.y || 0, cn.n1?.z || 1),
                cn.compId2,
                new Vector3(cn.pt2?.x || 0, cn.pt2?.y || 0, cn.pt2?.z || 0),
                new Vector3(cn.n2?.x || 0, cn.n2?.y || 0, cn.n2?.z || -1)
              );
            }
          }
        }
      } else {
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
      }
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
    CAD_SHEET_METAL_SCHEMA,
    async (event, params) => {
      const bend = new SheetMetalBend(params.bend);
      const flanges = params.flanges.map((f) => new SheetMetalFlange(f.name, f.lengthMm, f.widthMm));
      const flat = SheetMetalUnfolder.unfoldPart({ flanges, bends: [bend] });
      return {
        success: true,
        lengthUnit: params.lengthUnit,
        flat,
        bendAllowanceMm: bend.bendAllowanceMm,
        bendDeductionMm: bend.bendDeductionMm,
        maturity: 'experimental',
        warning:
          'Illustrative K-factor formula only; no material-specific bend data, standards conformance, springback correction, or manufacturing validation.'
      };
    },
    {
      domain: 'cad',
      description:
        'Compute an experimental two-flange K-factor flat-length example from explicit millimeter inputs; no standard conformance is established'
    }
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
        return {
          success: false,
          error: {
            code: 'UNSUPPORTED',
            message: 'The out-of-core spatial octree LOD engine is not configured on this host.'
          }
        };
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
      required: ['bounds', 'options', 'programNumber'],
      additionalProperties: false,
      properties: {
        bounds: {
          type: 'object',
          required: ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'],
          additionalProperties: false,
          properties: Object.fromEntries(
            ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'].map((key) => [key, { type: 'number' }])
          )
        },
        options: {
          type: 'object',
          required: [
            'toolDiameter',
            'toolType',
            'spindleRpm',
            'feedRateMmMin',
            'plungeRateMmMin',
            'stepoverMm',
            'stepdownMm',
            'safeZ'
          ],
          additionalProperties: false,
          properties: {
            toolDiameter: { type: 'number', min: 0 },
            toolType: { type: 'string', enum: ['flat_endmill', 'ball_nose'] },
            spindleRpm: { type: 'number', min: 0 },
            feedRateMmMin: { type: 'number', min: 0 },
            plungeRateMmMin: { type: 'number', min: 0 },
            stepoverMm: { type: 'number', min: 0 },
            stepdownMm: { type: 'number', min: 0 },
            safeZ: { type: 'number' }
          }
        },
        programNumber: { type: 'string', maxLength: 9 }
      }
    },
    async (event, params) => {
      if (!/^O\d{1,8}$/.test(params.programNumber)) {
        throw new Error('CAM programNumber must be an O-number followed by 1-8 digits.');
      }
      const { JobRequest } = require('../../core/contracts/JobRequest');
      const { defaultEngineRegistry } = require('../../core/contracts/engine_registry');
      const toolpathResult = await defaultEngineRegistry.dispatch(
        new JobRequest({
          domain: 'cam',
          operation: 'plan_roughing_toolpath',
          parameters: { bounds: params.bounds, toolOptions: params.options }
        })
      );
      const toolpathData = toolpathResult.outputData;
      const gcodeResult = await defaultEngineRegistry.dispatch(
        new JobRequest({
          domain: 'cam',
          operation: 'generate_gcode',
          parameters: { toolpaths: toolpathData, toolOptions: params.options, programNumber: params.programNumber }
        })
      );
      const gcodeData = gcodeResult.outputData;
      return {
        success: true,
        validationLevel: 'experimental',
        telemetry: toolpathData.telemetry,
        layers: toolpathData.layers,
        toolpath: toolpathData,
        machiningTimeMin: toolpathData.telemetry?.estimatedTimeMin,
        gcode: gcodeData.gcode,
        gcodePreview: gcodeData.gcode.split('\n').slice(0, 30).join('\n'),
        totalGcodeLines: gcodeData.lineCount
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

  // 24. SolveSpace Variational 2D/3D Constraint Solver
  defineHandler(
    'cad:solve-slvs-constraints',
    CAD_SOLVE_SLVS_SCHEMA,
    async (event, params) => runSolveSlvsConstraints(params),
    {
      domain: 'cad',
      description:
        'Solve 2D/3D geometric variational constraints (coincident, distance, horizontal, vertical, concentric, perpendicular, tangent, angle) using SolveSpace SLVS'
    }
  );

  // 25. OpenCASCADE Technology B-Rep Modeling, Booleans & Invariant Verification
  defineHandler(
    'cad:execute-occ-brep-operation',
    CAD_OCC_OPERATION_SCHEMA,
    async (event, params) => runOccBrepOperation(params),
    {
      domain: 'cad',
      description:
        'Execute OpenCASCADE B-Rep geometric modeling operations (box, cylinder, sphere, cone, cut, fuse, common, fillet, chamfer) and verify Euler-Poincare invariant'
    }
  );
}

module.exports = {
  registerCadIpc,
  CAD_PRIMITIVE_SCHEMA,
  CAD_EXPORT_OBJ_SCHEMA,
  CAD_EXPORT_STEP_SCHEMA,
  CAD_SOLVE_SLVS_SCHEMA,
  CAD_OCC_OPERATION_SCHEMA,
  runCadPrimitive,
  runCadExportOBJ,
  runCadExportSTEP,
  runSolveSlvsConstraints,
  runOccBrepOperation,
  occSolidRegistry,
  runEngineeringBOMRollup,
  CAD_DRAFTING_SHEET_SCHEMA,
  runDraftingSheet,
  runVisualDiffCAD,
  ENGINEERING_BOM_ROLLUP_SCHEMA,
  CAD_VISUAL_DIFF_SCHEMA
};
