/**
 * OmniEng CAE Domain IPC Router & Schema Definitions
 * Covers FEA, CFD, Drop Test, Continuum Plasticity, Shell MITC4, Timoshenko Beam, Solvers
 */

'use strict';

const { defineHandler } = require('./define_handler');
const { DropTestSimulator } = require('../../core/cae/drop_test');
const { CFDSolver2D } = require('../../core/cae/cfd_navier_stokes');
const { ThermalEngine } = require('../../core/cae/thermal_cht');
const { TransientDropAnimator } = require('../../core/cae/transient_drop_animator');
const { Point3D, DelaunayMesher3D } = require('../../core/cae/delaunay_mesher_3d');
const { QuadraticTet10Element } = require('../../core/cae/continuum_plasticity_3d');
const { FVMNavierStokes3D } = require('../../core/cae/fvm_navier_stokes_3d');
const { SparseMatrixCSR, SparseCholeskySolver } = require('../../core/math/sparse_cholesky');
const { ShellMITC4Element } = require('../../core/cae/shell_mitc4');
const { TimoshenkoBeam3D } = require('../../core/cae/beam_timoshenko_3d');
const { SimpleNavierStokesSolver } = require('../../core/cae/simple_navier_stokes');
const { MaterialManager } = require('../../core/materials/material_database');
const { WasmSparseMultifrontalSolver } = require('../../core/math/wasm_sparse_multifrontal');
const { GPUParallelPCGSolver } = require('../../core/math/gpu_parallel_pcg_solver');
const { WebGPUCFDKernel } = require('../../core/cae/webgpu_cfd_kernel');
const { CONTACT_MECHANICS_SCHEMA, NONLINEAR_CANTILEVER_ESTIMATE_SCHEMA } = require('./cae_schemas');

function getCompositeAnalysisUnavailableResult() {
  return {
    success: false,
    status: 'unavailable',
    validationLevel: 'experimental',
    error: {
      code: 'UNSUPPORTED',
      message:
        'Composite analysis is unavailable pending reviewed material allowables, laminate inputs, and independent validation.'
    }
  };
}

function runTimoshenkoBeam(params = {}) {
  const sectionFields = ['E', 'nu', 'A', 'Iy', 'Iz', 'J', 'ky', 'kz'];
  const validCoords =
    Array.isArray(params.coords) &&
    params.coords.length === 2 &&
    params.coords.every(
      (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
    );
  const validSection =
    params.section &&
    typeof params.section === 'object' &&
    !Array.isArray(params.section) &&
    sectionFields.every((field) => Number.isFinite(params.section[field])) &&
    params.section.E > 0 &&
    params.section.nu > -1 &&
    params.section.nu < 0.5 &&
    ['A', 'Iy', 'Iz', 'J', 'ky', 'kz'].every((field) => params.section[field] > 0);
  const beamLength = validCoords
    ? Math.hypot(
        params.coords[1].x - params.coords[0].x,
        params.coords[1].y - params.coords[0].y,
        params.coords[1].z - params.coords[0].z
      )
    : 0;
  if (!validCoords || beamLength < 1e-6 || !validSection || !Number.isFinite(params.K) || params.K <= 0) {
    return {
      success: false,
      validationLevel: 'experimental',
      error: {
        code: 'INVALID_INPUT',
        message:
          'Provide two distinct beam-node coordinates in metres, E in Pa, nu, A in m², Iy/Iz/J in m⁴, positive ky/kz shear factors, and a positive effective-length factor K.'
      }
    };
  }

  const beam = new TimoshenkoBeam3D(1, [0, 1], params.coords, params.section);
  const stiffness = beam.computeLocalStiffnessMatrix();
  const buckling = beam.calculateEulerBucklingLoad(params.K);
  return {
    success: true,
    validationLevel: 'experimental',
    stiffnessSize: stiffness.length,
    buckling
  };
}

function runShellMITC4(params = {}) {
  const validCoords =
    Array.isArray(params.coords) &&
    params.coords.length === 4 &&
    params.coords.every(
      (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
    );
  const properties = params.properties;
  const validProperties =
    properties && ['thickness', 'E', 'nu', 'density'].every((field) => Number.isFinite(properties[field]));
  if (!validCoords || !validProperties || properties.thickness <= 0 || properties.E <= 0) {
    return {
      success: false,
      validationLevel: 'experimental',
      error: {
        code: 'INVALID_INPUT',
        message:
          'Provide four shell-node coordinates in metres and explicit thickness (m), E (Pa), nu, and density (kg/m³).'
      }
    };
  }

  const shell = new ShellMITC4Element(1, [0, 1, 2, 3], params.coords, properties);
  const stiffness = shell.computeStiffnessMatrix();
  return { success: true, validationLevel: 'experimental', matrixSize: stiffness.length, sampleEntry: stiffness[0] };
}

function runContinuumPlasticity(params = {}) {
  const materialFields = [
    'E',
    'nu',
    'yieldStress',
    'hardeningModulus',
    'A',
    'B',
    'n',
    'C',
    'm',
    'refStrainRate',
    'Tmelt',
    'Troom'
  ];
  const validMaterial =
    params.material &&
    typeof params.material === 'object' &&
    materialFields.every((field) => Number.isFinite(params.material[field]));
  const validIncrement =
    Array.isArray(params.strainIncrement) &&
    params.strainIncrement.length === 6 &&
    params.strainIncrement.every(Number.isFinite);
  if (
    !validMaterial ||
    !validIncrement ||
    !Number.isFinite(params.strainRate) ||
    params.strainRate <= 0 ||
    !Number.isFinite(params.temperature) ||
    params.temperature <= 0
  ) {
    return {
      success: false,
      validationLevel: 'experimental',
      error: {
        code: 'INVALID_INPUT',
        message:
          'Provide all material constants, six strain-increment components, positive strain rate, and temperature in kelvin.'
      }
    };
  }

  const tet = new QuadraticTet10Element(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], params.material);
  const gaussPoint = tet.gaussPoints[0];
  const result = tet.radialReturnMapping(
    gaussPoint,
    new Float64Array(params.strainIncrement),
    params.strainRate,
    params.temperature
  );
  return {
    success: true,
    validationLevel: 'experimental',
    result,
    gaussPoint: { vonMises: result.vonMises, isPlastic: result.isPlastic, ep: gaussPoint.equivalentPlasticStrain }
  };
}

function runTransonicRiemann(params = {}) {
  const { TransonicRiemannSolver } = require('../../core/cae/transonic_riemann_solver');
  if (params.method === 'shocktube') {
    if (
      !Number.isInteger(params.nCells) ||
      params.nCells < 2 ||
      !Number.isFinite(params.tEnd) ||
      params.tEnd <= 0 ||
      !Number.isFinite(params.cfl) ||
      params.cfl <= 0
    ) {
      return {
        success: false,
        validationLevel: 'experimental',
        error: {
          code: 'INVALID_INPUT',
          message: 'Provide nCells, positive end time in seconds, and positive CFL for the shock-tube example.'
        }
      };
    }
    return {
      success: true,
      validationLevel: 'experimental',
      ...TransonicRiemannSolver.runShockTube1D(params.nCells, params.tEnd, params.cfl)
    };
  }

  const stateFields = ['rho', 'u', 'v', 'w', 'p'];
  const validState = (state) => state && stateFields.every((field) => Number.isFinite(state[field]));
  const validNormal = params.normal && ['x', 'y', 'z'].every((field) => Number.isFinite(params.normal[field]));
  if (
    !['roe', 'ausm'].includes(params.method) ||
    !validState(params.leftState) ||
    !validState(params.rightState) ||
    !validNormal
  ) {
    return {
      success: false,
      validationLevel: 'experimental',
      error: {
        code: 'INVALID_INPUT',
        message: 'Provide method roe or ausm, complete left/right flow states, and a face normal.'
      }
    };
  }
  const flux =
    params.method === 'ausm'
      ? TransonicRiemannSolver.solveAUSMPlusFlux(params.leftState, params.rightState, params.normal)
      : TransonicRiemannSolver.solveRoeFlux(params.leftState, params.rightState, params.normal);
  return { success: true, validationLevel: 'experimental', method: params.method, flux };
}

function invalidCaeInput(message) {
  return { success: false, validationLevel: 'experimental', error: { code: 'INVALID_INPUT', message } };
}

function runCfd2D(params = {}) {
  const valid =
    Number.isInteger(params.nx) &&
    params.nx >= 4 &&
    Number.isInteger(params.ny) &&
    params.ny >= 4 &&
    Number.isFinite(params.aoaDeg) &&
    Number.isFinite(params.velocity) &&
    params.velocity > 0 &&
    Number.isFinite(params.chordRatio) &&
    params.chordRatio > 0 &&
    Number.isFinite(params.thicknessRatio) &&
    params.thicknessRatio > 0 &&
    Number.isInteger(params.iterations) &&
    params.iterations > 0;
  if (!valid) {
    return invalidCaeInput(
      'Provide nx/ny, angle of attack, positive velocity, obstacle chord/thickness ratios, and iteration count.'
    );
  }
  const cfd = new CFDSolver2D(params.nx, params.ny);
  cfd.setAirfoilObstacle(params.chordRatio, params.thicknessRatio, params.aoaDeg);
  return { success: true, validationLevel: 'experimental', result: cfd.solve(params.velocity, params.iterations) };
}

function runDelaunayMesh3D(params = {}) {
  const validVertices =
    Array.isArray(params.vertices) &&
    params.vertices.length >= 4 &&
    params.vertices.every((v) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z));
  const validFaces =
    Array.isArray(params.faces) &&
    params.faces.length > 0 &&
    params.faces.every(
      (face) =>
        Array.isArray(face) &&
        face.length === 3 &&
        face.every((index) => Number.isInteger(index) && index >= 0 && index < params.vertices.length)
    );
  if (
    !validVertices ||
    !validFaces ||
    !Number.isFinite(params.targetEdgeLength) ||
    params.targetEdgeLength <= 0 ||
    typeof params.quadratic !== 'boolean'
  ) {
    return invalidCaeInput(
      'Provide at least four finite vertices, valid triangle indices, a positive target edge length in metres, and an explicit quadratic-element choice.'
    );
  }
  const mesher = new DelaunayMesher3D({ targetEdgeLength: params.targetEdgeLength });
  const vertices = params.vertices.map((v, i) => new Point3D(v.x, v.y, v.z, i));
  const mesh = mesher.meshClosedSurface(vertices, params.faces, { quadratic: params.quadratic });
  return { success: true, validationLevel: 'experimental', mesh };
}

function runFvmCfd3D(params = {}) {
  const dimensions = ['nx', 'ny', 'nz'];
  const lengths = ['lx', 'ly', 'lz'];
  const validOmega = params.omegaMRF && ['x', 'y', 'z'].every((axis) => Number.isFinite(params.omegaMRF[axis]));
  if (
    !dimensions.every((field) => Number.isInteger(params[field]) && params[field] >= 2) ||
    !lengths.every((field) => Number.isFinite(params[field]) && params[field] > 0) ||
    !Number.isFinite(params.inletVelocity) ||
    params.inletVelocity <= 0 ||
    !Number.isInteger(params.steps) ||
    params.steps < 1 ||
    !validOmega
  ) {
    return invalidCaeInput(
      'Provide grid dimensions, box lengths in metres, inlet velocity in m/s, step count, and all MRF angular-velocity components.'
    );
  }
  const fvm = new FVMNavierStokes3D({ omegaMRF: params.omegaMRF });
  const domain = fvm.createBoxDomain(params.nx, params.ny, params.nz, params.lx, params.ly, params.lz);
  const result = fvm.step(params.inletVelocity, params.steps);
  return { success: true, validationLevel: 'experimental', domain, result };
}

function runSimpleCfdStep(params = {}) {
  if (
    !Array.isArray(params.cells) ||
    params.cells.length < 2 ||
    !Array.isArray(params.faces) ||
    params.faces.length < 1
  ) {
    return invalidCaeInput('Provide explicit finite-volume cells and faces; no sample flow field is inserted.');
  }
  const solver = new SimpleNavierStokesSolver();
  return { success: true, validationLevel: 'experimental', result: solver.stepSIMPLE(params.cells, params.faces) };
}

function runSparseCholesky(params = {}) {
  const validTriplets =
    Array.isArray(params.triplets) &&
    params.triplets.length > 0 &&
    params.triplets.every((entry) => Array.isArray(entry) && entry.length === 3 && entry.every(Number.isFinite));
  if (
    !Number.isInteger(params.N) ||
    params.N < 1 ||
    !validTriplets ||
    !Array.isArray(params.b) ||
    params.b.length !== params.N ||
    !params.b.every(Number.isFinite)
  ) {
    return invalidCaeInput(
      'Provide matrix size N, finite [row, column, value] triplets, and a right-hand side of length N.'
    );
  }
  if (params.triplets.some(([row, column]) => row < 0 || row >= params.N || column < 0 || column >= params.N)) {
    return invalidCaeInput('Sparse matrix row and column indices must be within [0, N).');
  }
  const matrix = new SparseMatrixCSR(params.N, params.N);
  for (const [row, column, value] of params.triplets) matrix.addEntry(row, column, value);
  matrix.finalize();
  const solution = SparseCholeskySolver.solve(
    matrix,
    Float64Array.from(params.b),
    params.options || { tolerance: 1e-8 }
  );
  return { success: true, validationLevel: 'experimental', solution };
}

function runWasmSparse(params = {}) {
  const validTriplets =
    Array.isArray(params.triplets) &&
    params.triplets.length > 0 &&
    params.triplets.every((entry) => Array.isArray(entry) && entry.length === 3 && entry.every(Number.isFinite));
  if (
    !Number.isInteger(params.N) ||
    params.N < 1 ||
    !validTriplets ||
    !Array.isArray(params.b) ||
    params.b.length !== params.N ||
    !params.b.every(Number.isFinite)
  ) {
    return invalidCaeInput(
      'Provide matrix size N, finite [row, column, value] triplets, and a right-hand side of length N.'
    );
  }
  if (params.triplets.some(([row, column]) => row < 0 || row >= params.N || column < 0 || column >= params.N)) {
    return invalidCaeInput('Sparse matrix row and column indices must be within [0, N).');
  }
  const solver = new WasmSparseMultifrontalSolver(params.N, params.N);
  solver.leafSize = Number.isInteger(params.leafSize) && params.leafSize > 0 ? params.leafSize : 24;
  for (const [row, column, value] of params.triplets) solver.addEntry(row, column, value);
  const startedAt = (typeof performance !== 'undefined' ? performance : Date).now();
  const factorization = solver.factorize();
  const solution = solver.solve(Float64Array.from(params.b));
  const totalTimeMs = (typeof performance !== 'undefined' ? performance : Date).now() - startedAt;
  let solutionNormSquared = 0;
  for (const value of solution.solution) solutionNormSquared += value * value;
  return {
    success: true,
    validationLevel: 'experimental',
    N: params.N,
    solverMethod: factorization.solverMethod,
    nnzL: factorization.nnzL,
    fillRatio: factorization.fillInRatio,
    factorizationTimeMs: factorization.factorizationMs,
    orderingMethod: factorization.orderingMethod,
    totalTimeMs,
    solutionNorm: Math.sqrt(solutionNormSquared),
    relativeResidual: solution.relativeResidual,
    sampleSolution: Array.from(solution.solution.slice(0, 5))
  };
}

function runGpuPcg(params = {}) {
  const csr = params.csr;
  const validCsr = Boolean(
    csr && Number.isInteger(csr.N) && csr.N > 0 && (Array.isArray(csr.rowPtr) || ArrayBuffer.isView(csr.rowPtr))
  );
  if (!validCsr || !Array.isArray(params.b) || params.b.length !== csr.N || !params.b.every(Number.isFinite)) {
    return invalidCaeInput(
      'Provide an explicit CSR matrix with N and row pointers plus a finite right-hand side of length N.'
    );
  }
  const rowPtr = Array.from(csr.rowPtr);
  const colIndices = Array.from(csr.colIndices || []);
  const values = Array.from(csr.values || []);
  if (
    rowPtr.length !== csr.N + 1 ||
    colIndices.length === 0 ||
    colIndices.length !== values.length ||
    rowPtr.at(-1) !== values.length
  ) {
    return invalidCaeInput('CSR row pointers, column indices, and values must have consistent lengths.');
  }
  const solver = new GPUParallelPCGSolver({
    maxIterations: Number.isInteger(params.maxIter) && params.maxIter > 0 ? params.maxIter : 500,
    tolerance: Number.isFinite(params.tol) && params.tol > 0 ? params.tol : 1e-6
  });
  const result = solver.solve(csr, Float64Array.from(params.b));
  const solution = result.solution || result.x || new Float64Array(0);
  return {
    success: result.converged,
    validationLevel: 'experimental',
    ...result,
    sampleSolution: Array.from(solution.slice(0, 5))
  };
}

function runWebGpuPressurePoisson(params = {}) {
  if (
    !Number.isInteger(params.nx) ||
    params.nx < 2 ||
    !Number.isInteger(params.ny) ||
    params.ny < 2 ||
    !Number.isInteger(params.maxIter) ||
    params.maxIter < 1 ||
    !Array.isArray(params.b) ||
    params.b.length !== params.nx * params.ny ||
    !params.b.every(Number.isFinite)
  ) {
    return invalidCaeInput(
      'Provide grid dimensions, iteration count, and a finite pressure-Poisson right-hand side matching nx × ny.'
    );
  }
  const kernel = new WebGPUCFDKernel({ nx: params.nx, ny: params.ny, maxIterations: params.maxIter });
  const result = kernel.solvePressurePoisson(new Float32Array(params.nx * params.ny), Float32Array.from(params.b));
  return { success: result.converged, validationLevel: 'experimental', ...result };
}

function runHybridPrismTetMesh(params = {}) {
  const surfaceMesh = params.surfaceMesh;
  const validVertices =
    surfaceMesh &&
    Array.isArray(surfaceMesh.vertices) &&
    surfaceMesh.vertices.length >= 4 &&
    surfaceMesh.vertices.every((point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite));
  const validTriangles =
    surfaceMesh &&
    Array.isArray(surfaceMesh.triangles) &&
    surfaceMesh.triangles.length >= 4 &&
    surfaceMesh.triangles.every(
      (triangle) =>
        Array.isArray(triangle) &&
        triangle.length === 3 &&
        triangle.every((index) => Number.isInteger(index) && index >= 0 && index < surfaceMesh.vertices.length)
    );
  const prismOptions = params.prismOptions;
  const tetOptions = params.tetOptions;
  const validPrismOptions =
    prismOptions &&
    Number.isFinite(prismOptions.firstLayerHeight) &&
    prismOptions.firstLayerHeight > 0 &&
    Number.isFinite(prismOptions.growthRatio) &&
    prismOptions.growthRatio > 1 &&
    Number.isInteger(prismOptions.layerCount) &&
    prismOptions.layerCount > 0 &&
    Number.isFinite(prismOptions.maxCornerAngleRad) &&
    prismOptions.maxCornerAngleRad > 0 &&
    prismOptions.maxCornerAngleRad <= Math.PI;
  const validTetOptions =
    tetOptions &&
    Number.isFinite(tetOptions.targetEdgeLength) &&
    tetOptions.targetEdgeLength > 0 &&
    typeof tetOptions.quadratic === 'boolean';

  if (!validVertices || !validTriangles || !validPrismOptions || !validTetOptions) {
    return invalidCaeInput(
      'Provide finite surface vertices in metres, triangle indices, prism first-layer height, growth ratio, layer count and corner angle, plus tetrahedron edge length and quadratic-order choice.'
    );
  }

  const mesher = new DelaunayMesher3D({ targetEdgeLength: tetOptions.targetEdgeLength });
  const hybridMesh = mesher.generateHybridPrismTetMesh(surfaceMesh, prismOptions, tetOptions);
  return { success: true, validationLevel: 'experimental', hybridMesh };
}

function runHex20Analysis(params = {}) {
  const validCoordinates =
    Array.isArray(params.coords) &&
    params.coords.length === 20 &&
    params.coords.every(
      (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
    );
  const validMaterial =
    params.material &&
    Number.isFinite(params.material.E) &&
    params.material.E > 0 &&
    Number.isFinite(params.material.nu) &&
    params.material.nu > -1 &&
    params.material.nu < 0.5;
  const validSupports =
    Array.isArray(params.fixedNodes) &&
    params.fixedNodes.length > 0 &&
    params.fixedNodes.every((index) => Number.isInteger(index) && index >= 0 && index < 20);
  const validLoad =
    Number.isInteger(params.loadNode) &&
    params.loadNode >= 0 &&
    params.loadNode < 20 &&
    params.force &&
    ['x', 'y', 'z'].every((axis) => Number.isFinite(params.force[axis]));

  if (!validCoordinates || !validMaterial || !validSupports || !validLoad) {
    return invalidCaeInput(
      'Provide 20 HEX20 node coordinates in metres, Young’s modulus in pascals, Poisson ratio, fixed node indices, a load node index, and all three force components in newtons.'
    );
  }

  const { FEASolver } = require('../../core/cae/fea_structural');
  const solver = new FEASolver();
  params.coords.forEach((point) => solver.addNode(point.x, point.y, point.z));
  solver.addElement(
    Array.from({ length: 20 }, (_, index) => index),
    params.material
  );
  params.fixedNodes.forEach((index) => solver.fixNode(index, true, true, true));
  solver.applyForce(params.loadNode, params.force.x, params.force.y, params.force.z);
  const result = solver.solveStatic();
  return { success: true, validationLevel: 'experimental', elementType: 'HEX20', result };
}

function getPenaltyContactUnavailableResult() {
  return {
    success: false,
    status: 'unavailable',
    validationLevel: 'experimental',
    error: {
      code: 'UNSUPPORTED',
      message:
        'Penalty contact is unavailable pending a corrected, reviewed contact implementation and explicit unit conventions.'
    }
  };
}

function registerCaeIpc() {
  // 1. Drop Test Simulation
  defineHandler(
    'omni:solve-drop-test',
    {
      type: 'object',
      required: ['dropHeight', 'phoneMass', 'impactAngle'],
      properties: {
        dropHeight: { type: 'number', min: Number.MIN_VALUE },
        phoneMass: { type: 'number', min: Number.MIN_VALUE },
        impactAngle: { type: 'string' }
      }
    },
    async (event, params) => {
      return DropTestSimulator.runSimulation(params);
    },
    { domain: 'cae', description: 'Return an experimental handset impact estimate under bundled assumptions' }
  );

  // 2. Thermal CHT
  defineHandler(
    'omni:solve-thermal',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      return ThermalEngine.simulateSmartphoneThermal(params);
    },
    {
      domain: 'cae',
      description: 'Handset thermal output is unavailable pending reviewed properties, boundary data, and validation'
    }
  );

  // 3. 2D CFD Airfoil
  defineHandler(
    'omni:solve-cfd',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runCfd2D(params),
    {
      domain: 'cae',
      description:
        'Experimental 2D airflow example around a fixed-profile obstacle; grid, profile, and flow inputs are explicit'
    }
  );

  // 4. Compute Inertia
  defineHandler(
    'omni:compute-inertia',
    {
      type: 'object',
      required: ['matKey', 'widthM', 'heightM', 'depthM'],
      properties: {
        matKey: { type: 'string', maxLength: 100 },
        widthM: { type: 'number', min: Number.MIN_VALUE },
        heightM: { type: 'number', min: Number.MIN_VALUE },
        depthM: { type: 'number', min: Number.MIN_VALUE }
      }
    },
    async () => ({
      success: false,
      available: false,
      status: 'UNAVAILABLE',
      reason: 'Material property data has no independently reviewed source and applicability records.'
    }),
    {
      domain: 'cae',
      description: 'Unavailable until material property sources and applicability are independently reviewed'
    }
  );

  // Caller-provided density supports a transparent analytical cuboid estimate
  // without relying on an unreviewed material catalog.
  defineHandler(
    'omni:compute-cuboid-mass-properties',
    {
      type: 'object',
      required: ['widthM', 'heightM', 'depthM', 'densityKgM3', 'densitySource'],
      additionalProperties: false,
      properties: {
        widthM: { type: 'number', min: Number.MIN_VALUE },
        heightM: { type: 'number', min: Number.MIN_VALUE },
        depthM: { type: 'number', min: Number.MIN_VALUE },
        densityKgM3: { type: 'number', min: Number.MIN_VALUE },
        densitySource: { type: 'string', maxLength: 1000 }
      }
    },
    async (event, params) => MaterialManager.computeCuboidMassProperties(params),
    {
      domain: 'cae',
      description: 'Experimental analytical cuboid mass properties from explicit dimensions and caller-supplied density'
    }
  );

  // 5. Transient Drop Animation History
  defineHandler(
    'omni:solve-transient-drop',
    {
      type: 'object',
      required: ['dropHeightM', 'phoneMassKg', 'impactAngle', 'totalDurationMs', 'stepCount'],
      properties: {
        dropHeightM: { type: 'number', min: Number.MIN_VALUE },
        phoneMassKg: { type: 'number', min: Number.MIN_VALUE },
        impactAngle: { type: 'string' },
        totalDurationMs: { type: 'number', min: Number.MIN_VALUE },
        stepCount: { type: 'number', integer: true, min: 1, max: 10000 }
      }
    },
    async (event, params) => {
      return TransientDropAnimator.solveTransientHistory(params);
    },
    {
      domain: 'cae',
      description:
        'Generate an experimental impact animation history from explicit duration and frame count under bundled contact assumptions'
    }
  );

  // 6. 3D Delaunay TET10 Mesher
  defineHandler(
    'omni:mesh-delaunay-3d',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runDelaunayMesh3D(params),
    {
      domain: 'cae',
      description: 'Generate an experimental TET4/TET10 mesh from explicit surface geometry and target edge length'
    }
  );

  // 7. Continuum Plasticity 3D
  defineHandler(
    'omni:solve-continuum-plasticity-3d',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runContinuumPlasticity(params),
    {
      domain: 'cae',
      description:
        'Run an experimental single-material-point plasticity update from explicit material and strain inputs'
    }
  );

  // 8. 3D Polyhedral FVM CFD
  defineHandler(
    'omni:solve-fvm-cfd-3d',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runFvmCfd3D(params),
    {
      domain: 'cae',
      description: 'Run an experimental box-flow step from explicit grid, geometry, flow, and rotating-frame inputs'
    }
  );

  // 9. Sparse Cholesky Direct Solver
  defineHandler(
    'omni:solve-sparse-cholesky',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runSparseCholesky(params),
    {
      domain: 'cae',
      description: 'Run an experimental sparse Cholesky solve from explicit matrix triplets and right-hand side'
    }
  );

  // 10. Shell MITC4 Element
  defineHandler(
    'omni:compute-shell-mitc4',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runShellMITC4(params),
    {
      domain: 'cae',
      description: 'Run an experimental shell-element matrix example from explicit SI node coordinates and properties'
    }
  );

  // 11. Timoshenko 3D Beam Element
  defineHandler(
    'omni:compute-beam-timoshenko',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runTimoshenkoBeam(params),
    {
      domain: 'cae',
      description:
        'Run an experimental beam screen from explicit SI coordinates, section properties, and effective-length factor'
    }
  );

  // 12. Unavailable composite-analysis compatibility endpoint
  defineHandler(
    'omni:evaluate-composite-clpt',
    {
      type: 'object',
      optional: true
    },
    async () => getCompositeAnalysisUnavailableResult(),
    {
      domain: 'cae',
      description:
        'Unavailable pending reviewed composite material data, explicit laminate inputs, and independent validation'
    }
  );

  // 13. SIMPLE Navier-Stokes CFD Step
  defineHandler(
    'omni:step-simple-cfd',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runSimpleCfdStep(params),
    {
      domain: 'cae',
      description: 'Run an experimental SIMPLE step from explicit finite-volume cells and faces'
    }
  );

  // 14. Sparse Multifrontal Solver
  defineHandler(
    'omni:solve-wasm-sparse-multifrontal',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runWasmSparse(params),
    {
      domain: 'cae',
      description: 'Run an experimental sparse solve from explicit matrix triplets and right-hand side'
    }
  );

  // 15. GPU Parallel PCG Solver
  defineHandler(
    'omni:solve-gpu-parallel-pcg',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runGpuPcg(params),
    {
      domain: 'cae',
      description:
        'Run an experimental PCG solve from an explicit CSR matrix and right-hand side; GPU acceleration is not established'
    }
  );

  // 16. WebGPU CFD Pressure Poisson Kernel
  defineHandler(
    'omni:solve-webgpu-cfd-poisson',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runWebGpuPressurePoisson(params),
    {
      domain: 'cae',
      description:
        'Run an experimental discrete pressure-Poisson example from an explicit right-hand side; no CFD solve or GPU speedup is established'
    }
  );

  // 17. 3D Nonlinear Contact Mechanics (Augmented Lagrangian & Hertz Experimental workflow)
  defineHandler(
    'omni:solve-contact-mechanics-3d',
    CONTACT_MECHANICS_SCHEMA,
    async (event, params) => {
      const { ContactMechanics3D } = require('../../core/cae/contact_mechanics_3d');
      const contact = new ContactMechanics3D(params.options || {});
      const res = contact.solveSphereOnFlatContact({
        radius1: params.radius,
        load: params.load,
        E1: params.E1,
        nu1: params.nu1,
        E2: params.E2,
        nu2: params.nu2
      });
      return {
        success: false,
        ...res,
        maxPressureMpa: Number(res.profileQuadrature.maxPressureMpa.toFixed(1))
      };
    },
    {
      domain: 'cae',
      description: 'Return an experimental Hertz pressure-profile estimate; no discrete contact solve is configured'
    }
  );

  // 18. Experimental reduced-order cantilever estimate (not FEA)
  defineHandler(
    'omni:cae-nonlinear-large-deflection',
    NONLINEAR_CANTILEVER_ESTIMATE_SCHEMA,
    async (event, params) => {
      const { CantileverResponseEstimator } = require('../../core/cae/nonlinear_large_deflection');
      const solver = new CantileverResponseEstimator();
      const res = solver.solveLargeDeflectionCantilever(params);
      return { success: true, ...res };
    },
    {
      domain: 'cae',
      description:
        'Return an experimental formula-based cantilever estimate; no finite-element solve or independent accuracy is established'
    }
  );

  // 19. Hybrid Boundary Layer Prism + Interior Delaunay TET10 Meshing (Phase 3)
  defineHandler(
    'omni:mesh-hybrid-prism-tet',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runHybridPrismTetMesh(params),
    {
      domain: 'cae',
      description:
        'Generate an experimental hybrid mesh from explicit geometry and mesh controls; no boundary-layer accuracy is established'
    }
  );

  // 20. Transonic Shock-Capturing Riemann CFD (Phase 3)
  defineHandler(
    'omni:solve-transonic-riemann',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runTransonicRiemann(params),
    {
      domain: 'cae',
      description: 'Run an experimental Roe or AUSM+ flux example from explicit flow states and face normal'
    }
  );

  // 21. Quadratic Serendipity Hexahedral (HEX20) FEA Static Analysis (Phase 2)
  defineHandler(
    'omni:solve-fea-hex20',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => runHex20Analysis(params),
    {
      domain: 'cae',
      description:
        'Run an experimental HEX20 example from explicit SI geometry, material, support, and load inputs; no independent accuracy is established'
    }
  );

  // 22. Penalty & Augmented Lagrangian Contact Mechanics (Phase 2)
  defineHandler(
    'omni:solve-penalty-contact',
    {
      type: 'object',
      optional: true
    },
    async () => getPenaltyContactUnavailableResult(),
    {
      domain: 'cae',
      description:
        'Penalty contact is unavailable pending a corrected, reviewed contact implementation and explicit unit conventions'
    }
  );
}

module.exports = {
  registerCaeIpc,
  getCompositeAnalysisUnavailableResult,
  getPenaltyContactUnavailableResult,
  runTimoshenkoBeam,
  runShellMITC4,
  runContinuumPlasticity,
  runTransonicRiemann,
  runCfd2D,
  runDelaunayMesh3D,
  runFvmCfd3D,
  runSimpleCfdStep,
  runSparseCholesky,
  runWasmSparse,
  runGpuPcg,
  runWebGpuPressurePoisson,
  runHybridPrismTetMesh,
  runHex20Analysis
};
