/**
 * OmniEng CAE Domain IPC Router & Schema Definitions
 * Covers FEA, CFD, Drop Test, Continuum Plasticity, Shell MITC4, Timoshenko Beam, Solvers
 */

'use strict';

const { defineHandler } = require('./define_handler');
const { DropTestSimulator } = require('../../core/cae/drop_test');
const { CFDSolver2D } = require('../../core/cae/cfd_navier_stokes');
const { ThermalEngine } = require('../../core/cae/thermal_cht');
const { MaterialManager } = require('../../core/materials/material_database');
const { TransientDropAnimator } = require('../../core/cae/transient_drop_animator');
const { Point3D, DelaunayMesher3D } = require('../../core/cae/delaunay_mesher_3d');
const { QuadraticTet10Element } = require('../../core/cae/continuum_plasticity_3d');
const { FVMNavierStokes3D } = require('../../core/cae/fvm_navier_stokes_3d');
const { SparseMatrixCSR, SparseCholeskySolver } = require('../../core/math/sparse_cholesky');
const { ShellMITC4Element } = require('../../core/cae/shell_mitc4');
const { TimoshenkoBeam3D } = require('../../core/cae/beam_timoshenko_3d');
const { CompositePly, CompositeLaminateCLPT } = require('../../core/cae/composite_clpt');
const { SimpleNavierStokesSolver } = require('../../core/cae/simple_navier_stokes');
const { WasmSparseMultifrontalSolver } = require('../../core/math/wasm_sparse_multifrontal');
const { GPUParallelPCGSolver } = require('../../core/math/gpu_parallel_pcg_solver');
const { WebGPUCFDKernel } = require('../../core/cae/webgpu_cfd_kernel');

function registerCaeIpc() {
  // 1. Drop Test Simulation
  defineHandler('omni:solve-drop-test', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    return DropTestSimulator.runSimulation(params);
  }, { domain: 'cae', description: 'Run consumer electronics drop test explicit solver' });

  // 2. Thermal CHT
  defineHandler('omni:solve-thermal', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    return ThermalEngine.simulateSmartphoneThermal(params);
  }, { domain: 'cae', description: 'Solve conjugated heat transfer thermal dissipation' });

  // 3. 2D CFD Airfoil
  defineHandler('omni:solve-cfd', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { nx = 40, ny = 30, aoaDeg = 4.0, velocity = 15.0 } = params;
    const cfd = new CFDSolver2D(nx, ny);
    cfd.setAirfoilObstacle(0.4, 0.12, aoaDeg);
    return cfd.solve(velocity, 120);
  }, { domain: 'cae', description: '2D Navier-Stokes CFD airflow around NACA airfoil' });

  // 4. Compute Inertia
  defineHandler('omni:compute-inertia', {
    type: 'object',
    optional: true
  }, async (event, { matKey = 'ALUMINUM_6061', widthM = 0.1, heightM = 0.05, depthM = 0.02 } = {}) => {
    return MaterialManager.computeInertiaCuboid(matKey, widthM, heightM, depthM);
  }, { domain: 'cae', description: 'Compute mass, volume, and 3x3 inertia tensor' });

  // 5. Transient Drop Animation History
  defineHandler('omni:solve-transient-drop', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    return TransientDropAnimator.solveTransientHistory(params);
  }, { domain: 'cae', description: 'Solve multi-frame nonlinear transient impact history' });

  // 6. 3D Delaunay TET10 Mesher
  defineHandler('omni:mesh-delaunay-3d', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const mesher = new DelaunayMesher3D({ targetEdgeLength: params.targetEdgeLength || 0.1 });
    const vertices = (params.vertices || []).map((v, i) => new Point3D(v.x, v.y, v.z, i));
    const faces = params.faces || [];
    const mesh = mesher.meshClosedSurface(vertices, faces, { quadratic: params.quadratic === true });
    return { success: true, mesh };
  }, { domain: 'cae', description: 'Generate volumetric TET4 / TET10 tetrahedral mesh' });

  // 7. Continuum Plasticity 3D
  defineHandler('omni:solve-continuum-plasticity-3d', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const tet = new QuadraticTet10Element(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], params.material || {});
    const gp = tet.gaussPoints[0];
    const strainInc = new Float64Array(params.strainIncrement || [0.01, -0.003, -0.003, 0, 0, 0]);
    const result = tet.radialReturnMapping(gp, strainInc, params.strainRate || 1.0, params.temperature || 293.15);
    return { success: true, result, gaussPoint: { vonMises: result.vonMises, isPlastic: result.isPlastic, ep: gp.equivalentPlasticStrain } };
  }, { domain: 'cae', description: 'Solve J2 plasticity radial return mapping on quadratic TET10' });

  // 8. 3D Polyhedral FVM CFD
  defineHandler('omni:solve-fvm-cfd-3d', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const fvm = new FVMNavierStokes3D({ omegaMRF: params.omegaMRF || { x: 0, y: 0, z: 0 } });
    const domain = fvm.createBoxDomain(params.nx || 6, params.ny || 6, params.nz || 4, params.lx || 1.0, params.ly || 0.8, params.lz || 0.6);
    const result = fvm.step(params.inletVelocity || 15.0, params.steps || 5);
    return { success: true, domain, result };
  }, { domain: 'cae', description: 'Solve 3D finite volume Navier-Stokes with MRF Coriolis' });

  // 9. Sparse Cholesky Direct Solver
  defineHandler('omni:solve-sparse-cholesky', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const N = params.N || 50;
    const A = new SparseMatrixCSR(N, N);
    for (let i = 0; i < N; i++) {
      A.addEntry(i, i, 4.0);
      if (i > 0) A.addEntry(i, i - 1, -1.0);
      if (i < N - 1) A.addEntry(i, i + 1, -1.0);
    }
    A.finalize();
    const b = new Float64Array(N).fill(1.0);
    const sol = SparseCholeskySolver.solve(A, b, params.options || { tolerance: 1e-8 });
    return { success: true, solution: sol };
  }, { domain: 'cae', description: 'Direct sparse Cholesky factorization with AMD ordering' });

  // 10. Shell MITC4 Element
  defineHandler('omni:compute-shell-mitc4', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const nodes = [0, 1, 2, 3];
    const coords = params.coords || [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
    const shell = new ShellMITC4Element(1, nodes, coords, params.properties || { thickness: 0.001, E: 210e9, nu: 0.3 });
    const Ke = shell.computeStiffnessMatrix();
    return { success: true, matrixSize: Ke.length, sampleEntry: Ke[0] };
  }, { domain: 'cae', description: 'Compute 24x24 shear-locking-free MITC4 shell stiffness matrix' });

  // 11. Timoshenko 3D Beam Element
  defineHandler('omni:compute-beam-timoshenko', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const beam = new TimoshenkoBeam3D(1, [0, 1], params.coords || [{ x: 0, y: 0, z: 0 }, { x: 2.0, y: 0, z: 0 }], params.section || {
      E: 200e9, nu: 0.3, A: 0.005, Iy: 8.33e-6, Iz: 8.33e-6, J: 1.4e-5
    });
    const Ke = beam.computeLocalStiffnessMatrix();
    const buckling = beam.calculateEulerBucklingLoad(params.K || 2.0);
    return { success: true, stiffnessSize: Ke.length, buckling };
  }, { domain: 'cae', description: 'Compute 12x12 3D Timoshenko frame stiffness and Euler buckling' });

  // 12. Classical Lamination Theory (CLPT) & Tsai-Wu
  defineHandler('omni:evaluate-composite-clpt', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const ply0 = new CompositePly({ orientationDeg: 0, thicknessMm: 0.125, E1: 142e9, E2: 10.3e9, nu12: 0.27, G12: 7.2e9 });
    const ply90 = new CompositePly({ orientationDeg: 90, thicknessMm: 0.125, E1: 142e9, E2: 10.3e9, nu12: 0.27, G12: 7.2e9 });
    const laminate = new CompositeLaminateCLPT([ply0, ply90, ply90, ply0]);
    const tw = CompositeLaminateCLPT.evaluateTsaiWu(ply0, 400e6, 30e6, 40e6);
    return { success: true, A: laminate.A, B: laminate.B, D: laminate.D, tsaiWu: tw };
  }, { domain: 'cae', description: 'Compute ABD stiffness matrices and Tsai-Wu failure index' });

  // 13. SIMPLE Navier-Stokes CFD Step
  defineHandler('omni:step-simple-cfd', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const solver = new SimpleNavierStokesSolver();
    const cells = params.cells || [
      { u: 0, v: 0, w: 0, p: 101325, centroid: { x: 0, y: 0, z: 0 }, volume: 1e-3, gradP: { x: 0, y: 0, z: 0 } },
      { u: 0, v: 0, w: 0, p: 101325, centroid: { x: 0.1, y: 0, z: 0 }, volume: 1e-3, gradP: { x: 0, y: 0, z: 0 } }
    ];
    const faces = params.faces || [
      { leftCell: 0, rightCell: 1, area: 0.01, normal: { x: 1, y: 0, z: 0 } },
      { leftCell: 0, rightCell: -1, boundaryType: 'inlet', inletVelocity: 2.0, area: 0.01, normal: { x: -1, y: 0, z: 0 } }
    ];
    const res = solver.stepSIMPLE(cells, faces);
    return { success: true, result: res };
  }, { domain: 'cae', description: 'Execute segregated SIMPLE iteration with Rhie-Chow' });

  // 14. Sparse Multifrontal Solver
  defineHandler('omni:solve-wasm-sparse-multifrontal', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { N = 100, triplets, b, leafCutoff = 32 } = params;
    const solver = new WasmSparseMultifrontalSolver(N, { leafCutoff });
    if (triplets && triplets.length > 0) {
      for (const t of triplets) {
        solver.addEntry(t[0], t[1], t[2]);
      }
    } else {
      for (let i = 0; i < N; i++) {
        solver.addEntry(i, i, 2.0);
        if (i + 1 < N) {
          solver.addEntry(i, i + 1, -1.0);
          solver.addEntry(i + 1, i, -1.0);
        }
      }
    }
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const fact = solver.factorize();
    const rhs = b ? new Float64Array(b) : new Float64Array(N).fill(1.0);
    const solveRes = solver.solve(rhs);
    const x = solveRes.solution;
    const totalTimeMs = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    let norm = 0;
    for (let i = 0; i < x.length; i++) norm += x[i] * x[i];
    return {
      success: true,
      N,
      nnzL: fact.nnzL,
      fillRatio: fact.fillRatio,
      factorizationTimeMs: fact.factorizationTimeMs,
      totalTimeMs,
      solutionNorm: Math.sqrt(norm),
      relativeResidual: solveRes.relativeResidual,
      sampleSolution: Array.from(x.slice(0, 5))
    };
  }, { domain: 'cae', description: 'Multifrontal supernodal direct sparse elimination tree' });

  // 15. GPU Parallel PCG Solver
  defineHandler('omni:solve-gpu-parallel-pcg', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { N = 100, maxIter = 500, tol = 1e-6 } = params;
    const solver = new GPUParallelPCGSolver({ maxIterations: maxIter, tolerance: tol });
    let csr = params.csr;
    let b = params.b ? new Float64Array(params.b) : null;
    if (!csr) {
      const rowPtr = new Int32Array(N + 1);
      const colIndices = [];
      const values = [];
      for (let i = 0; i < N; i++) {
        rowPtr[i] = colIndices.length;
        if (i > 0) { colIndices.push(i - 1); values.push(-1.0); }
        colIndices.push(i); values.push(2.0);
        if (i < N - 1) { colIndices.push(i + 1); values.push(-1.0); }
      }
      rowPtr[N] = colIndices.length;
      csr = {
        N,
        nnz: values.length,
        rowPtr,
        colIndices: new Int32Array(colIndices),
        values: new Float64Array(values)
      };
      b = new Float64Array(N).fill(1.0);
    }
    const res = solver.solve(csr, b);
    const sol = res.solution || res.x || new Float64Array(0);
    return { success: res.converged, ...res, sampleSolution: Array.from(sol.slice(0, 5)) };
  }, { domain: 'cae', description: 'Parallel Preconditioned Conjugate Gradient with Jacobi preconditioner' });

  // 16. WebGPU CFD Pressure Poisson Kernel
  defineHandler('omni:solve-webgpu-cfd-poisson', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { nx = 32, ny = 32, maxIter = 100 } = params;
    const kernel = new WebGPUCFDKernel({ nx, ny, maxIterations: maxIter });
    const b = params.b ? new Float32Array(params.b) : new Float32Array(nx * ny).fill(1.0);
    const p = new Float32Array(nx * ny);
    const res = kernel.solvePressurePoisson(p, b);
    return { success: res.converged, ...res };
  }, { domain: 'cae', description: 'Solve pressure Poisson equation on high-capacity grid' });

  // 17. 3D Nonlinear Contact Mechanics (Augmented Lagrangian & Hertz Parity)
  defineHandler('omni:solve-contact-mechanics-3d', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { ContactMechanics3D } = require('../../core/cae/contact_mechanics_3d');
    const contact = new ContactMechanics3D(params.options || {});
    const res = contact.solveSphereOnFlatContact({
      radius1: params.radius || 10.0e-3,
      load: params.load || 1000.0,
      E1: params.E1 || 210.0e9,
      nu1: params.nu1 !== undefined ? params.nu1 : 0.3,
      E2: params.E2 || 210.0e9,
      nu2: params.nu2 !== undefined ? params.nu2 : 0.3
    });
    return { success: res.converged, ...res, maxPressureMpa: parseFloat(res.numerical.maxPressureMpa.toFixed(1)) };
  }, { domain: 'cae', description: 'Solve 3D multi-body contact with augmented Lagrangian Hertz verification' });
}

module.exports = { registerCaeIpc };
