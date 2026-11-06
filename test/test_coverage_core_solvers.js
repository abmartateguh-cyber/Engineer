'use strict';

const assert = require('assert');
const path = require('path');
const { Worker, isMainThread } = require('worker_threads');

// 1. Optics
const { Complex, JonesVector, PolarizationRayTracer } = require('../src/core/optics/polarization_ray_tracer');

// 2. Worker Pool & Concurrency
const {
  PersistentWorkerPool,
  ExperimentalCalculationQueue,
  WorkerPoolEngine,
  getGlobalWorkerPool,
  getGlobalPersistentWorkerPool
} = require('../src/core/math/worker_pool');
const { OmniError, OmniErrorCode } = require('../src/core/contracts/OmniError');

// 3. CAD NURBS SSI & CSG Booleans
const {
  ParameterCurve2D,
  TrimLoop2D,
  TrimmedNurbsSurface,
  SurfaceSurfaceIntersectionEngine
} = require('../src/core/cad/nurbs_trimmed_ssi');
const { CSGSolid, CSGNode, CSGPolygon, CSGPlane, CSGVertex } = require('../src/core/cad/csg_mesh_booleans');

// 4. Dynamic Simulink & Physical Networks
const { SFunctionPluginHost } = require('../src/core/dynamic_simulink/s_function_plugin_host');
const { StateSpaceEngine } = require('../src/core/dynamic_simulink/state_space_engine');
const { SimscapeDomainLibrary } = require('../src/core/dynamic_simulink/simscape_domain_library');

// 5. EDA Synthesis, Layout & Liberty
const {
  AIGNode,
  AndInverterGraph,
  SystemVerilogSynthesizer,
  SystemVerilogElaborator,
  TechnologyMapper,
  LIBERTY_LIBRARY,
  SKY130_STANDARD_CELLS
} = require('../src/core/eda/system_verilog_synth');
const {
  GdsDataType,
  GdsRecordType,
  GdsPolygon,
  GdsPath,
  GdsStructure,
  GdsLibrary,
  GdsiiStreamEngine,
  floatToGdsReal,
  gdsRealToFloat
} = require('../src/core/eda/gdsii_stream');
const { NLDMTable2D, LibertyCellPin, LibertyCellModel } = require('../src/core/eda/liberty_nldm_parser');

// 6. Plant Thermodynamics & Piping
const {
  ExperimentalPropertyComponent,
  ExperimentalPropertyDatabase,
  DIPPRComponent,
  DIPPRDatabase
} = require('../src/core/plant/dippr_database');
const { EXPERIMENTAL_PROPERTY_EXAMPLES } = require('./support/experimental_property_examples');
const { PengRobinsonEOS, R_GAS } = require('../src/core/plant/peng_robinson_eos');
const { PipingNetwork3D } = require('../src/core/plant/piping_network_3d');

// 7. Compliance Qualification & Audit Reporting
const { ToolQualificationKit } = require('../src/core/compliance/tool_qualification_kit');
const { AuditReportGenerator } = require('../src/core/reporting/audit_report');

// 8. Math Kernels
const { WasmKernelEngine, wasmKernelEngine, buildOmniEngWasmBinary } = require('../src/core/math/wasm_kernel_engine');
const { WasmSparseMultifrontalSolver } = require('../src/core/math/wasm_sparse_multifrontal');
const { SparseMatrixCSR, SparseCholeskySolver } = require('../src/core/math/sparse_cholesky');
const { NativeAcceleratorInterface, accelerator } = require('../src/core/math/native_accelerator_interface');

// 9. CAE & Dynamics
const {
  GaussPoint3D,
  QuadraticTet10Element,
  MortarContactPair3D,
  LanczosModalEigensolver
} = require('../src/core/cae/continuum_plasticity_3d');
const { JohnsonCookFracture } = require('../src/core/cae/johnson_cook_fracture');
const {
  SYNTHETIC_CONTINUUM_MATERIAL,
  SYNTHETIC_JOHNSON_COOK_MATERIAL,
  SYNTHETIC_COMPOSITE_PLY,
  SYNTHETIC_VOF_FLUID_PROPERTIES
} = require('./support/synthetic_cae_materials');
const { PenaltyContact } = require('../src/core/cae/penalty_contact');
const { TransonicRiemannSolver } = require('../src/core/cae/transonic_riemann_solver');
const { VOFMultiphaseSolver } = require('../src/core/cae/vof_multiphase_solver');
const {
  CantileverResponseEstimator,
  NonlinearLargeDeflectionSolver
} = require('../src/core/cae/nonlinear_large_deflection');
const { CompositePly, CompositeLaminateCLPT } = require('../src/core/cae/composite_clpt');
const { FatigueLifeAnalyzer } = require('../src/core/cae/fatigue_life_analyzer');

async function runCoreSolversCoverageTests() {
  console.log('================================================================');
  console.log('   TESTING CORE SOLVERS, PHYSICS KERNELS & COMPLIANCE ENGINES   ');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function runSubtest(name, fn) {
    try {
      fn();
      passed++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(err);
    }
  }

  async function runSubtestAsync(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(err);
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Optics: Polarization Ray Tracer, Stokes & Jones Calculus
  // ---------------------------------------------------------------------------
  console.log('\n[1] Optics: Polarization Ray Tracer, Stokes & Jones Calculus...');

  runSubtest('Complex arithmetic methods & error validation', () => {
    assert.throws(() => new Complex('1', 2), TypeError);
    assert.throws(() => new Complex(1, NaN), TypeError);

    const c1 = new Complex(3, 4);
    assert.strictEqual(c1.magnitude(), 5);
    assert.strictEqual(c1.phase(), Math.atan2(4, 3));

    const c2 = new Complex(1, -2);
    const cAdd = c1.add(c2);
    assert.strictEqual(cAdd.re, 4);
    assert.strictEqual(cAdd.im, 2);

    const cMul = c1.mul(c2);
    // (3 + 4i)(1 - 2i) = 3 - 6i + 4i - 8i^2 = 11 - 2i
    assert.strictEqual(cMul.re, 11);
    assert.strictEqual(cMul.im, -2);

    const cScaled = c1.scale(2.5);
    assert.strictEqual(cScaled.re, 7.5);
    assert.strictEqual(cScaled.im, 10);

    const cConj = c1.conj();
    assert.strictEqual(cConj.re, 3);
    assert.strictEqual(cConj.im, -4);
  });

  runSubtest('JonesVector standard states, Stokes transformations & intensity', () => {
    assert.throws(() => new JonesVector('bad', 0), TypeError);
    assert.throws(() => new JonesVector(0, Infinity), TypeError);

    const jH = JonesVector.LinearHorizontal();
    assert.strictEqual(jH.intensity(), 1.0);
    const sH = jH.toStokes();
    assert.strictEqual(sH.S0, 1.0);
    assert.strictEqual(sH.S1, 1.0);
    assert.strictEqual(sH.S2, 0.0);
    assert.strictEqual(sH.S3, 0.0);
    assert.strictEqual(sH.DOP, 1.0);
    assert.strictEqual(sH.DOLP, 1.0);
    assert.strictEqual(sH.DOCP, 0.0);

    const jV = JonesVector.LinearVertical();
    const sV = jV.toStokes();
    assert.strictEqual(sV.S0, 1.0);
    assert.strictEqual(sV.S1, -1.0);
    assert.strictEqual(sV.S2, 0.0);
    assert.strictEqual(sV.S3, 0.0);
    assert.strictEqual(sV.DOLP, 1.0);

    const jDiag = JonesVector.LinearDiagonal45();
    const sDiag = jDiag.toStokes();
    assert.strictEqual(sDiag.S0, 1.0);
    assert.strictEqual(sDiag.S1, 0.0);
    assert.strictEqual(sDiag.S2, 1.0);
    assert.strictEqual(sDiag.S3, 0.0);
    assert.strictEqual(sDiag.DOLP, 1.0);

    const jR = JonesVector.RightCircular();
    const sR = jR.toStokes();
    assert.strictEqual(sR.S0, 1.0);
    assert.strictEqual(sR.S1, 0.0);
    assert.strictEqual(sR.S2, 0.0);
    assert.strictEqual(sR.S3, 1.0);
    assert.strictEqual(sR.DOCP, 1.0);

    const jL = JonesVector.LeftCircular();
    const sL = jL.toStokes();
    assert.strictEqual(sL.S0, 1.0);
    assert.strictEqual(sL.S1, 0.0);
    assert.strictEqual(sL.S2, 0.0);
    assert.strictEqual(sL.S3, -1.0);
    assert.strictEqual(sL.DOCP, 1.0);

    // Vanishing field branch (S0 <= 1e-12)
    const jZero = new JonesVector(0, 0);
    const sZero = jZero.toStokes();
    assert.strictEqual(sZero.S0, 0);
    assert.strictEqual(sZero.DOP, 0);
    assert.strictEqual(sZero.DOLP, 0);
    assert.strictEqual(sZero.DOCP, 0);

    // Jones matrix transformation (Half-Wave Plate at 45 deg: rotates H to V)
    const hwp45 = [
      [new Complex(0, 0), new Complex(1, 0)],
      [new Complex(1, 0), new Complex(0, 0)]
    ];
    const jRotated = jH.applyMatrix(hwp45);
    const sRot = jRotated.toStokes();
    assert.strictEqual(sRot.S1, -1.0);
  });

  runSubtest('Fresnel reflection/transmission & Birefringent ray splitting edge cases', () => {
    // Fresnel error branches
    assert.throws(() => PolarizationRayTracer.evaluateFresnel(-1, 1.5, 0.1), TypeError);
    assert.throws(() => PolarizationRayTracer.evaluateFresnel(1.0, 1.5, -0.1), TypeError);
    assert.throws(() => PolarizationRayTracer.evaluateFresnel(1.0, 1.5, Math.PI / 2), TypeError);

    // Normal incidence
    const normal = PolarizationRayTracer.evaluateFresnel(1.0, 1.5, 0.0);
    assert.strictEqual(normal.isTIR, false);
    assert.strictEqual(normal.thetaT, 0);
    assert(Math.abs(normal.Rs - 0.04) < 1e-3);
    assert(Math.abs(normal.Ts - 0.96) < 1e-3);

    // TIR
    const tir = PolarizationRayTracer.evaluateFresnel(1.5, 1.0, Math.PI / 3);
    assert.strictEqual(tir.isTIR, true);
    assert.strictEqual(tir.Rs, 1.0);
    assert.strictEqual(tir.Ts, 0.0);
    assert(Number.isFinite(tir.phaseShiftS));
    assert(Number.isFinite(tir.phaseShiftP));

    // Birefringent splitting error branches
    assert.throws(() => PolarizationRayTracer.splitBirefringentRay(null, [0, 0, 1], [0, 0, 1]), TypeError);
    assert.throws(
      () => PolarizationRayTracer.splitBirefringentRay({ no: 1.5, ne: 1.6, opticAxis: [0, 0] }, [0, 0, 1], [0, 0, 1]),
      TypeError
    );

    // Birefringent ray splitting with Quartz (positive uniaxial: no < ne)
    const quartzProps = {
      no: 1.544,
      ne: 1.553,
      opticAxis: [0, 1, 1]
    };
    const split = PolarizationRayTracer.splitBirefringentRay(quartzProps, [0, 0, 1], [0, 0, 1]);
    assert(split.birefringenceDeltaN > 0);
    assert(Number.isFinite(split.walkOffAngleDeg));
    assert(Number.isFinite(split.separationAngleDeg));
    assert.strictEqual(split.ordinaryRay.direction.length, 3);
    assert.strictEqual(split.extraordinaryRay.direction.length, 3);

    // Axis parallel to wavevector (walk-off angle = 0)
    const parallelProps = {
      no: 1.658,
      ne: 1.486,
      opticAxis: [0, 0, 1]
    };
    const splitParallel = PolarizationRayTracer.splitBirefringentRay(parallelProps, [0, 0, 1], [0, 0, 1]);
    assert.strictEqual(splitParallel.walkOffAngleDeg, 0.0);
  });

  // ---------------------------------------------------------------------------
  // 2. Math Worker Pool & Calculation Queue
  // ---------------------------------------------------------------------------
  console.log('\n[2] Math: Worker Pool & Calculation Queue...');

  await runSubtestAsync('ExperimentalCalculationQueue priorities, kernels & buffer', async () => {
    assert.throws(() => new ExperimentalCalculationQueue({ invalidOption: true }), Error);
    assert.throws(() => new ExperimentalCalculationQueue({ maxWorkers: 2 }), Error);

    const queue = new ExperimentalCalculationQueue();
    assert.throws(() => queue.allocateSharedBuffer(-10), TypeError);
    const buf = queue.allocateSharedBuffer(128);
    assert.strictEqual(buf.byteLength, 128);

    const tel = queue.getTelemetry();
    assert.strictEqual(tel.executionMode, 'main-event-loop');
    assert.strictEqual(tel.cancellationSupported, false);

    // Dispatch error validations
    await assert.rejects(queue.dispatch('', {}), TypeError);
    await assert.rejects(queue.dispatch('ECHO_TEST', null), TypeError);
    await assert.rejects(queue.dispatch('ECHO_TEST', {}, { priority: 'SUPER_HIGH' }), TypeError);

    // Priority execution
    const results = [];
    const p1 = queue
      .dispatch('ECHO_TEST', { message: 'norm' }, { priority: 'NORMAL' })
      .then((r) => results.push(r.result.echo));
    const p2 = queue
      .dispatch('ECHO_TEST', { message: 'high' }, { priority: 'HIGH' })
      .then((r) => results.push(r.result.echo));
    const p3 = queue
      .dispatch('ECHO_TEST', { message: 'batch' }, { priority: 'BATCH' })
      .then((r) => results.push(r.result.echo));
    await Promise.all([p1, p2, p3]);
    assert.strictEqual(results.length, 3);

    // Kernel execution paths
    const daxpyRes = await queue.dispatch('WASM_SIMD_BLAS', {
      operation: 'daxpy',
      x: new Float64Array([1, 2, 3]),
      y: new Float64Array([4, 5, 6]),
      alpha: 2.0
    });
    assert.deepStrictEqual(Array.from(daxpyRes.result.y), [6, 9, 12]);

    const dotRes = await queue.dispatch('WASM_SIMD_BLAS', {
      operation: 'dotProduct',
      a: new Float64Array([1, 2, 3]),
      b: new Float64Array([4, 5, 6])
    });
    assert.strictEqual(dotRes.result.dotProduct, 32);

    const normRes = await queue.dispatch('WASM_SIMD_BLAS', {
      operation: 'norm',
      vec: new Float64Array([3, 4])
    });
    assert.strictEqual(normRes.result.norm, 5);

    const spmvRes = await queue.dispatch('WASM_SIMD_BLAS', {
      operation: 'spmv',
      rowPtr: new Int32Array([0, 1, 2]),
      colInd: new Int32Array([0, 1]),
      values: new Float64Array([5, 10]),
      x: new Float64Array([2, 3]),
      y: new Float64Array(2),
      nRows: 2
    });
    assert.deepStrictEqual(Array.from(spmvRes.result.y), [10, 30]);

    // Unsupported task error
    await assert.rejects(queue.dispatch('UNKNOWN_KERNEL', {}), /Unsupported experimental task/);
  });

  await runSubtestAsync('PersistentWorkerPool cancellation, timeout & termination', async () => {
    const pPool = new PersistentWorkerPool({ maxWorkers: 2 });
    let globalPool = null;
    try {
      const sBuf = pPool.allocateSharedBuffer(256);
      assert.strictEqual(sBuf.byteLength, 256);

      // Warmup workers
      await Promise.all([
        pPool.dispatch('ECHO_TEST', { message: 'warmup-1', delayMs: 10 }),
        pPool.dispatch('ECHO_TEST', { message: 'warmup-2', delayMs: 10 })
      ]);

      // Active task execution
      const echoRes = await pPool.dispatch('ECHO_TEST', { message: 'p-worker' });
      assert.strictEqual(echoRes.result.echo, 'p-worker');

      // Cancel non-existent taskId
      const cancelMiss = await pPool.cancel('non-existent-id');
      assert.strictEqual(cancelMiss, false);

      // Cancel queued task
      // Saturate 2 workers with delayed tasks
      const tBlock1 = pPool.dispatch('ECHO_TEST', { message: 'b1', delayMs: 300 });
      const tBlock2 = pPool.dispatch('ECHO_TEST', { message: 'b2', delayMs: 300 });
      // This task will be queued
      let queuedTaskId = null;
      const queuedPromise = pPool.dispatch('ECHO_TEST', { message: 'queued' });
      queuedTaskId = pPool.taskQueue[0]?.id;
      assert(queuedTaskId !== undefined);

      const cancelQueueRes = await pPool.cancel(queuedTaskId);
      assert.strictEqual(cancelQueueRes, true);
      await assert.rejects(queuedPromise, (err) => err.code === OmniErrorCode.CANCELLED);
      await Promise.all([tBlock1, tBlock2]);

      // Timeout escalation test (timeoutMs: 200, delayMs: 600)
      await assert.rejects(
        pPool.dispatch('ECHO_TEST', { message: 'timeout-task', delayMs: 600 }, { timeoutMs: 200 }),
        (err) => err.code === OmniErrorCode.TIMEOUT
      );

      // Global pools
      const g1 = getGlobalWorkerPool();
      const g2 = getGlobalWorkerPool();
      assert.strictEqual(g1, g2);

      globalPool = getGlobalPersistentWorkerPool({ maxWorkers: 1 });
      const gp2 = getGlobalPersistentWorkerPool();
      assert.strictEqual(globalPool, gp2);
      await globalPool.terminateAll();

      // Pool termination
      await pPool.terminateAll();
      assert.strictEqual(pPool.executionMode, 'terminated');
      await assert.rejects(pPool.dispatch('ECHO_TEST', {}), (err) => err.code === OmniErrorCode.CANCELLED);
    } finally {
      await pPool.terminateAll();
      if (globalPool) await globalPool.terminateAll();
    }
  });

  // ---------------------------------------------------------------------------
  // 3. CAD NURBS SSI & CSG Booleans
  // ---------------------------------------------------------------------------
  console.log('\n[3] CAD: NURBS SSI & CSG Booleans...');

  runSubtest('ParameterCurve2D, TrimLoop2D & TrimmedNurbsSurface evaluation', () => {
    // ParameterCurve2D
    const emptyCurve = new ParameterCurve2D([]);
    assert.deepStrictEqual(emptyCurve.evaluate(0.5), { u: 0, v: 0 });

    const singleCurve = new ParameterCurve2D([{ u: 0.2, v: 0.8 }]);
    assert.deepStrictEqual(singleCurve.evaluate(0.5), { u: 0.2, v: 0.8 });

    const bezier2D = new ParameterCurve2D([
      { u: 0, v: 0 },
      { u: 0, v: 1 },
      { u: 1, v: 1 },
      { u: 1, v: 0 }
    ]);
    const ptMid = bezier2D.evaluate(0.5);
    assert(ptMid.u > 0.3 && ptMid.u < 0.7);
    assert(ptMid.v > 0.6 && ptMid.v < 0.9);

    // TrimLoop2D
    const outerLoop = new TrimLoop2D(true);
    // Square loop [0,0]->[1,0]->[1,1]->[0,1]->[0,0]
    outerLoop.addCurve(
      new ParameterCurve2D([
        { u: 0, v: 0 },
        { u: 1, v: 0 }
      ])
    );
    outerLoop.addCurve(
      new ParameterCurve2D([
        { u: 1, v: 0 },
        { u: 1, v: 1 }
      ])
    );
    outerLoop.addCurve(
      new ParameterCurve2D([
        { u: 1, v: 1 },
        { u: 0, v: 1 }
      ])
    );
    outerLoop.addCurve(
      new ParameterCurve2D([
        { u: 0, v: 1 },
        { u: 0, v: 0 }
      ])
    );

    assert.strictEqual(outerLoop.isPointInside(0.5, 0.5), true);
    assert.strictEqual(outerLoop.isPointInside(1.5, 0.5), false);

    // Inner hole loop in center [0.4, 0.4] to [0.6, 0.6]
    const holeLoop = new TrimLoop2D(false);
    holeLoop.addCurve(
      new ParameterCurve2D([
        { u: 0.4, v: 0.4 },
        { u: 0.6, v: 0.4 }
      ])
    );
    holeLoop.addCurve(
      new ParameterCurve2D([
        { u: 0.6, v: 0.4 },
        { u: 0.6, v: 0.6 }
      ])
    );
    holeLoop.addCurve(
      new ParameterCurve2D([
        { u: 0.6, v: 0.6 },
        { u: 0.4, v: 0.6 }
      ])
    );
    holeLoop.addCurve(
      new ParameterCurve2D([
        { u: 0.4, v: 0.6 },
        { u: 0.4, v: 0.4 }
      ])
    );

    const surf = new TrimmedNurbsSurface();
    surf.addTrimLoop(outerLoop);
    surf.addTrimLoop(holeLoop);

    assert.strictEqual(surf.isTrimmedActive(0.2, 0.2), true); // in outer, outside hole
    assert.strictEqual(surf.isTrimmedActive(0.5, 0.5), false); // inside hole
    assert.strictEqual(surf.isTrimmedActive(1.2, 0.5), false); // outside outer

    const pEval = surf.evaluatePoint(0.5, 0.5);
    assert(Number.isFinite(pEval.x) && Number.isFinite(pEval.y) && Number.isFinite(pEval.z));

    const deriv = surf.evaluateDerivatives(0.5, 0.5);
    assert(Number.isFinite(deriv.normal.x));
    assert(Number.isFinite(deriv.normal.y));
    assert(Number.isFinite(deriv.normal.z));
    assert(Math.abs(Math.hypot(deriv.normal.x, deriv.normal.y, deriv.normal.z) - 1.0) < 1e-4);
  });

  runSubtest('SurfaceSurfaceIntersectionEngine marching and candidates', () => {
    // S1: Horizontal flat surface at z = 10
    const s1 = new TrimmedNurbsSurface({
      controlGrid: [
        [
          { x: 0, y: 0, z: 10 },
          { x: 50, y: 0, z: 10 },
          { x: 100, y: 0, z: 10 }
        ],
        [
          { x: 0, y: 50, z: 10 },
          { x: 50, y: 50, z: 10 },
          { x: 100, y: 50, z: 10 }
        ],
        [
          { x: 0, y: 100, z: 10 },
          { x: 50, y: 100, z: 10 },
          { x: 100, y: 100, z: 10 }
        ]
      ]
    });

    // S2: Slanted intersecting surface from z = 0 to z = 20
    const s2 = new TrimmedNurbsSurface({
      controlGrid: [
        [
          { x: 0, y: 0, z: 0 },
          { x: 50, y: 0, z: 0 },
          { x: 100, y: 0, z: 0 }
        ],
        [
          { x: 0, y: 50, z: 10 },
          { x: 50, y: 50, z: 10 },
          { x: 100, y: 50, z: 10 }
        ],
        [
          { x: 0, y: 100, z: 20 },
          { x: 50, y: 100, z: 20 },
          { x: 100, y: 100, z: 20 }
        ]
      ]
    });

    const ssiRes = SurfaceSurfaceIntersectionEngine.intersectSurfaces(s1, s2, {
      tolerance: 1e-3,
      gridSamples: 8
    });
    assert.strictEqual(ssiRes.intersectionFound, true);
    assert(ssiRes.pointsCount >= 1);
    assert(ssiRes.curve3D.length > 0);
    assert(Math.abs(ssiRes.curve3D[0].z - 10.0) < 0.5);

    // Non-intersecting surface far away
    const sFar = new TrimmedNurbsSurface({
      controlGrid: [
        [
          { x: 0, y: 0, z: 500 },
          { x: 50, y: 0, z: 500 },
          { x: 100, y: 0, z: 500 }
        ],
        [
          { x: 0, y: 50, z: 500 },
          { x: 50, y: 50, z: 500 },
          { x: 100, y: 50, z: 500 }
        ],
        [
          { x: 0, y: 100, z: 500 },
          { x: 50, y: 100, z: 500 },
          { x: 100, y: 100, z: 500 }
        ]
      ]
    });
    const noInter = SurfaceSurfaceIntersectionEngine.intersectSurfaces(s1, sFar, { gridSamples: 5 });
    assert.strictEqual(noInter.intersectionFound, false);
  });

  runSubtest('CSGSolid Booleans (Union, Subtract, Intersect, Mesh generation)', () => {
    // Vertex and Plane
    const v1 = new CSGVertex([0, 0, 0]);
    const v2 = v1.clone();
    assert.deepStrictEqual(v1.pos, v2.pos);
    v2.flip();
    assert.strictEqual(v2.normal[2], -1);

    const vInter = v1.interpolate(new CSGVertex([10, 20, 30]), 0.5);
    assert.deepStrictEqual(vInter.pos, [5, 10, 15]);

    const plane = CSGPlane.fromPoints([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    assert.strictEqual(plane.w, 0);
    const planeClone = plane.clone();
    planeClone.flip();
    assert.strictEqual(planeClone.normal[2], -1);

    // Create solids
    const box1 = CSGSolid.createBox([20, 20, 20], [0, 0, 0]);
    const box2 = CSGSolid.createBox([20, 20, 20], [10, 0, 0]);
    const cyl = CSGSolid.createCylinder(5, 30, 8, [0, 0, 0]);

    // Union
    const unionSolid = box1.union(box2);
    assert(unionSolid.polygons.length > 0);

    // Subtract
    const subSolid = box1.subtract(cyl);
    assert(subSolid.polygons.length > 0);

    // Intersect
    const interSolid = box1.intersect(box2);
    assert(interSolid.polygons.length > 0);

    // Mesh & Triangles conversion
    const mesh = subSolid.toMesh();
    assert(mesh.vertices.length > 0);
    assert(mesh.faces.length > 0);

    const tris = subSolid.toTriangles();
    assert(tris.length > 0);
    assert(tris[0].a && tris[0].b && tris[0].c && tris[0].normal);

    // fromBRep
    const solidFromBRepNull = CSGSolid.fromBRep(null);
    assert.strictEqual(solidFromBRepNull.polygons.length, 0);

    const mockBRep = {
      toTriangles: () => [
        { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 }, c: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } }
      ]
    };
    const solidFromBRep = CSGSolid.fromBRep(mockBRep);
    assert.strictEqual(solidFromBRep.polygons.length, 1);
  });

  // ---------------------------------------------------------------------------
  // 4. Dynamic Simulink & Physical Networks
  // ---------------------------------------------------------------------------
  console.log('\n[4] Dynamic Simulink & Physical Networks...');

  await runSubtestAsync('SFunctionPluginHost lifecycle & RK4 integration', async () => {
    const host = new SFunctionPluginHost({ name: 'IntegratorSFunction', parameters: { gain: 2.0 } });
    assert.throws(() => host.registerDefinition(null), Error);

    host.registerDefinition({
      mdlInitializeSizes: (ss, params) => {
        ss.numContStates = 1;
        ss.numDiscStates = 1;
        ss.numInputs = 1;
        ss.numOutputs = 2;
      },
      mdlInitializeSampleTimes: (ss) => {
        ss.sampleTime = 0.0;
      },
      mdlStart: (ss, ctx) => {
        ctx.continuousStates[0] = 5.0;
        ctx.discreteStates[0] = 1.0;
      },
      mdlOutputs: (ss, t, ctx) => {
        ctx.outputs[0] = ctx.continuousStates[0] * ctx.parameters.gain;
        ctx.outputs[1] = ctx.discreteStates[0];
      },
      mdlDerivatives: (ss, t, ctx) => {
        // dx/dt = -0.5 * x + u
        ctx.derivatives[0] = -0.5 * ctx.continuousStates[0] + ctx.inputs[0];
      },
      mdlUpdate: (ss, t, ctx) => {
        ctx.discreteStates[0] += 1.0;
      },
      mdlTerminate: (ss) => {
        ss.userData = 'terminated';
      }
    });

    host.initialize();
    assert.strictEqual(host.continuousStates[0], 5.0);
    assert.strictEqual(host.discreteStates[0], 1.0);

    host.setInputs([10.0]);
    assert.strictEqual(host.inputs[0], 10.0);

    const out0 = host.evaluateOutputs(0.0);
    assert.strictEqual(out0[0], 10.0); // 5 * 2
    assert.strictEqual(out0[1], 1.0);

    const dxdt0 = host.evaluateDerivatives(0.0);
    assert.strictEqual(dxdt0[0], -0.5 * 5.0 + 10.0); // 7.5

    // Step RK4 forward
    host.stepContinuousRK4(0.0, 0.1);
    assert(host.continuousStates[0] > 5.0);

    // Update discrete
    host.updateDiscreteStates(0.1);
    assert.strictEqual(host.discreteStates[0], 2.0);

    host.terminate();
    assert.strictEqual(host.simStruct.userData, 'terminated');
    assert.strictEqual(host.isInitialized, false);

    // Wasm loader coverage with valid minimal WebAssembly module
    const wasmMinimal = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const wasmHost = new SFunctionPluginHost();
    await wasmHost.loadWasm(wasmMinimal);
    assert(wasmHost.wasmInstance !== null);
  });

  runSubtest('StateSpaceEngine continuous simulation & non-linear blocks', () => {
    // 2nd order mass-spring-damper: H(s) = 1 / (s^2 + 2*s + 5)
    const ss = StateSpaceEngine.fromTransferFunction([1], [1, 2, 5]);
    assert.strictEqual(ss.n, 2);
    assert.strictEqual(ss.m, 1);
    assert.strictEqual(ss.p, 1);

    // Step single RK4
    const y0 = ss.stepRK4([1.0], 0.01);
    assert.strictEqual(y0.length, 1);

    // Simulate continuous response with constant input and function input
    const simResConst = ss.simulateContinuous([1.0], [0.0, 0.0], 0.5, 0.05);
    assert.strictEqual(simResConst.time.length > 5, true);
    assert.strictEqual(simResConst.y.length, simResConst.time.length);

    const simResFn = ss.simulateContinuous((t) => Math.sin(t), [0.0, 0.0], 0.2, 0.05);
    assert.strictEqual(simResFn.time.length > 2, true);

    // Saturation
    assert.strictEqual(StateSpaceEngine.saturation(2.5, -1.0, 1.0), 1.0);
    assert.strictEqual(StateSpaceEngine.saturation(-3.0, -1.0, 1.0), -1.0);
    assert.strictEqual(StateSpaceEngine.saturation(0.5, -1.0, 1.0), 0.5);

    // Dead zone
    assert.strictEqual(StateSpaceEngine.deadZone(0.05, -0.1, 0.1), 0.0);
    assert(Math.abs(StateSpaceEngine.deadZone(0.2, -0.1, 0.1) - 0.1) < 1e-12);
    assert(Math.abs(StateSpaceEngine.deadZone(-0.3, -0.1, 0.1) - -0.2) < 1e-12);

    // Rate limiter
    assert.strictEqual(StateSpaceEngine.rateLimiter(5.0, 0.0, 0.0), 5.0);
    assert.strictEqual(StateSpaceEngine.rateLimiter(10.0, 0.0, 0.1, 20.0, -20.0), 2.0); // max rate 20 => rise 2.0
    assert.strictEqual(StateSpaceEngine.rateLimiter(-10.0, 0.0, 0.1, 20.0, -20.0), -2.0);

    // 1D Lookup Table
    const tx = [0, 10, 20];
    const ty = [100, 200, 400];
    assert.strictEqual(StateSpaceEngine.lookupTable1D(-5, tx, ty), 100);
    assert.strictEqual(StateSpaceEngine.lookupTable1D(25, tx, ty), 400);
    assert.strictEqual(StateSpaceEngine.lookupTable1D(5, tx, ty), 150);
  });

  runSubtest('SimscapeDomainLibrary multi-domain physics & EHA actuator loop', () => {
    // Hydraulic Orifice
    const qFwd = SimscapeDomainLibrary.evaluateHydraulicOrifice({ Cd: 0.62, area: 1e-4 }, 1e6);
    const qRev = SimscapeDomainLibrary.evaluateHydraulicOrifice({ Cd: 0.62, area: 1e-4 }, -1e6);
    assert(qFwd > 0);
    assert(qRev < 0);
    assert.strictEqual(qFwd, -qRev);

    // Hydraulic Cylinder
    const cylRes = SimscapeDomainLibrary.evaluateHydraulicCylinder(
      { pistonAreaA: 5e-3, pistonAreaB: 3e-3, mass: 20.0, damping: 100.0 },
      10e6,
      2e6,
      0.5,
      5000.0
    );
    assert(Number.isFinite(cylRes.acceleration));
    assert(Number.isFinite(cylRes.fHydro));
    assert(cylRes.flowPortA > 0);
    assert(cylRes.flowPortB < 0);

    // Gearbox
    const gb = SimscapeDomainLibrary.evaluateRotationalGearbox(5.0, 0.95, 100.0, 50.0);
    assert.strictEqual(gb.outputSpeed, 10.0);
    assert.strictEqual(gb.outputTorque, -475.0);
    assert.strictEqual(gb.inputPower, 5000.0);

    // Torsional Shaft
    const tauShaft = SimscapeDomainLibrary.evaluateTorsionalShaft(1000.0, 10.0, 0.05, 2.0);
    assert.strictEqual(tauShaft, 1000 * 0.05 + 10 * 2.0);

    // Thermal Convection
    const heatFlux = SimscapeDomainLibrary.evaluateThermalConvection(25.0, 2.0, 350.0, 300.0);
    assert.strictEqual(heatFlux, 25 * 2 * 50);

    // Electro-Hydraulic closed-loop simulation
    const lib = new SimscapeDomainLibrary();
    const ehaRes = lib.simulateElectroHydraulicLoop({
      supplyPressure: 21e6,
      returnPressure: 0.2e6,
      duration: 0.05,
      dt: 0.001,
      targetPosition: 0.05
    });
    assert.strictEqual(typeof ehaRes.finalPosition, 'number');
    assert(ehaRes.history.length > 0);
  });

  // ---------------------------------------------------------------------------
  // 5. EDA Synthesis, Layout & Liberty
  // ---------------------------------------------------------------------------
  console.log('\n[5] EDA: Synthesis, Layout & Liberty...');

  runSubtest('AndInverterGraph & SystemVerilogSynthesizer declarations inspection', () => {
    const aig = new AndInverterGraph();
    const piA = aig.addPrimaryInput('a');
    const piB = aig.addPrimaryInput('b');

    // addAnd constant folding & idempotency
    const and0 = aig.addAnd(aig.const0, false, piA, false);
    assert.strictEqual(and0.type, 'CONST');

    const andIdem = aig.addAnd(piA, false, piA, false);
    assert.strictEqual(andIdem.node.id, piA.id);

    const andComp = aig.addAnd(piA, false, piA, true);
    assert.strictEqual(andComp.type, 'CONST');

    const andGeneral = aig.addAnd(piA, false, piB, false);
    assert(andGeneral.node !== undefined);

    const orRes = aig.addOr(piA, false, piB, false);
    assert(orRes.node !== undefined);

    const xorRes = aig.addXor(piA, false, piB, false);
    assert(xorRes.node !== undefined);

    aig.setPrimaryOutput('y', xorRes.node, xorRes.inv);
    assert.strictEqual(aig.outputs.has('y'), true);

    // SystemVerilogSynthesizer
    const synth = new SystemVerilogSynthesizer();
    assert.throws(() => synth.synthesize(123), TypeError);
    assert.throws(() => synth.synthesize('assign a = b; end'), TypeError);

    const svCode = `
      // Test ALU accumulator module
      module alu_top;
        parameter DATA_WIDTH = 32;
        input logic clk;
        input logic rst_n;
        input logic [DATA_WIDTH-1:0] a, b;
        output logic [DATA_WIDTH-1:0] sum;
        always_ff @(posedge clk) begin
          sum <= a + b;
        end
      endmodule
    `;
    const report = synth.synthesize(svCode);
    assert.strictEqual(report.moduleName, 'alu_top');
    assert.strictEqual(report.parameters.DATA_WIDTH, 32);
    assert(report.ports.inputs.includes('clk'));
    assert(report.ports.outputs.includes('sum'));
    assert.strictEqual(report.sequentialSyntaxDetected, true);

    // Helpers
    const elabRes = SystemVerilogElaborator.elaborate(svCode);
    assert.strictEqual(elabRes.moduleName, 'alu_top');
    const mapRes = TechnologyMapper.mapToLiberty();
    assert.strictEqual(mapRes.status, 'unavailable');
    assert.strictEqual(LIBERTY_LIBRARY.available, false);
  });

  runSubtest('GDSII binary stream serialization, deserialization & excess-64 float', () => {
    // floatToGdsReal and gdsRealToFloat
    assert.strictEqual(gdsRealToFloat(floatToGdsReal(0.0)), 0.0);
    const posVal = 1234.5678;
    const bufPos = floatToGdsReal(posVal);
    const decodedPos = gdsRealToFloat(bufPos);
    assert(Math.abs(decodedPos - posVal) < 1e-4);

    const negVal = -0.0098765;
    const bufNeg = floatToGdsReal(negVal);
    const decodedNeg = gdsRealToFloat(bufNeg);
    assert(Math.abs(decodedNeg - negVal) < 1e-6);

    // Construct GDSII Library
    const lib = new GdsLibrary('CHIP_TOP', 0.001, 1e-9);
    const str = lib.createStructure('CELL_INVERTER');
    assert.strictEqual(lib.getStructure('CELL_INVERTER'), str);

    // Add Boundary Polygon
    str.addPolygon(1, 0, [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 2000 },
      { x: 0, y: 2000 }
    ]);

    // Add Path
    str.addPath(2, 0, 100, [
      { x: 500, y: 0 },
      { x: 500, y: 1500 }
    ]);

    // Serialize
    const binary = GdsiiStreamEngine.writeGdsii(lib);
    assert(binary.length > 50);

    // Deserialize
    const readLib = GdsiiStreamEngine.readGdsii(binary);
    assert.strictEqual(readLib.name, 'CHIP_TOP');
    const readStr = readLib.structures.get('CELL_INVERTER');
    assert(readStr !== undefined);
    assert.strictEqual(readStr.elements.length, 2);

    const poly = readStr.elements.find((el) => el instanceof GdsPolygon);
    assert(poly !== undefined);
    assert.strictEqual(poly.layer, 1);
    assert.strictEqual(poly.points.length, 5); // closed loop

    const pathEl = readStr.elements.find((el) => el instanceof GdsPath);
    assert(pathEl !== undefined);
    assert.strictEqual(pathEl.layer, 2);
    assert.strictEqual(pathEl.width, 100);

    // Corrupted GDSII handling
    const corrupt = Buffer.from([0x00, 0x02, 0x00, 0x00]); // length < 4
    assert.throws(() => GdsiiStreamEngine.readGdsii(corrupt), /Corrupted GDSII record/);
  });

  runSubtest('Liberty NLDM Table 2D Interpolation & Timing Cell Models', () => {
    const table = new NLDMTable2D({
      index1: [0.01, 0.05, 0.1],
      index2: [0.001, 0.01, 0.05],
      values: [
        [0.02, 0.04, 0.08],
        [0.03, 0.06, 0.12],
        [0.05, 0.1, 0.2]
      ]
    });

    // Exact grid point
    assert.strictEqual(table.lookup(0.01, 0.001), 0.02);
    // Interpolated point
    const interp = table.lookup(0.03, 0.0055);
    assert(interp > 0.02 && interp < 0.12);

    const pinA = new LibertyCellPin('A', 'input', 0.003);
    const pinY = new LibertyCellPin('Y', 'output', 0.0);
    const cell = new LibertyCellModel('INV_X1', 1.5);
    cell.addPin(pinA);
    cell.addPin(pinY);

    const delayRise = cell.calculateCellDelay(0.04, 0.02, true);
    assert.strictEqual(delayRise.cellName, 'INV_X1');
    assert(delayRise.delayNs > 0);
    assert(delayRise.outputSlewNs > 0);

    const delayFall = cell.calculateCellDelay(0.04, 0.02, false);
    assert(delayFall.delayNs > 0);
  });

  // ---------------------------------------------------------------------------
  // 6. Plant Thermodynamics & Piping
  // ---------------------------------------------------------------------------
  console.log('\n[6] Plant Thermodynamics & Piping...');

  runSubtest('ExperimentalPropertyComponent correlations & 3-Phase VLLE Flash', () => {
    const waterData = {
      id: 'Water',
      name: 'Water',
      formula: 'H2O',
      family: 'Aqueous',
      mw: 18.015,
      Tc: 647.1,
      Pc: 22.064e6,
      omega: 0.344,
      pvEq: [73.649, -7258.2, -7.3037, 4.1653e-6, 2],
      pvTmin: 273.16,
      pvTmax: 647.09,
      rhoLEq: [5.459, 0.30542, 647.13, 0.081],
      cpEq: [276370, -2090.1, 8.125, -0.014116, 9.3701e-6],
      muEq: [-52.843, 3703.6, 5.866, -5.879e-27, 10],
      kLEq: [-0.432, 0.0057, -8.1e-6]
    };

    const octaneData = {
      id: 'n-Octane',
      name: 'n-Octane',
      formula: 'C8H18',
      family: 'Alkane',
      mw: 114.23,
      Tc: 568.7,
      Pc: 2.49e6,
      omega: 0.4,
      pvEq: [85.0, -7000.0, -9.0, 1e-5, 2],
      pvTmin: 216.0,
      pvTmax: 568.7,
      rhoLEq: [0.65, 0.26, 568.7, 0.28],
      cpEq: [150.0, 400.0, 1500.0, 200.0, 700.0],
      muEq: [-15.0, 1500.0, 1.0, 0, 1],
      kLEq: [0.15, -0.0002, 0]
    };

    const waterComp = new ExperimentalPropertyComponent(waterData);
    assert.throws(() => waterComp.getVaporPressure(-10), TypeError);
    assert.throws(() => waterComp.getVaporPressure(100), RangeError); // outside [pvTmin, pvTmax]

    const pVapWater = waterComp.getVaporPressure(373.15);
    // At 100 C, vapor pressure is ~ 101325 Pa
    assert(Math.abs(pVapWater - 101325) < 5000);

    const rhoWater = waterComp.getLiquidDensity(298.15);
    assert(Math.abs(rhoWater - 997.0) < 50);

    const cpWater = waterComp.getIdealGasCp(350.0);
    assert(cpWater > 0);

    const muWater = waterComp.getLiquidViscosity(298.15);
    assert(muWater > 0 && muWater < 0.01);

    const kWater = waterComp.getLiquidThermalConductivity(298.15);
    assert(kWater > 0);

    // Database & VLLE Flash
    const db = new ExperimentalPropertyDatabase([waterData, octaneData]);
    assert.strictEqual(db.listSpecies().length, 2);
    assert.strictEqual(db.get('Water').formula, 'H2O');
    assert.strictEqual(db.get('non-existent'), null);

    const meta = db.getCatalogMetadata();
    assert.strictEqual(meta.status, 'experimental');

    // 3-Phase VLLE Flash: Water + Octane mixture at 350 K, 101325 Pa
    const vlleRes = db.solveVLLEFlash({
      components: ['Water', 'n-Octane'],
      feedFractions: [0.5, 0.5],
      temperatureK: 350.0,
      pressurePa: 101325.0
    });
    assert(vlleRes.phaseFractions.aqueousLiquidL1 !== undefined);
    assert(vlleRes.phaseFractions.organicLiquidL2 !== undefined);
    assert(vlleRes.phaseFractions.vaporV !== undefined);
    assert.strictEqual(vlleRes.componentNames.length, 2);

    // Error handling on invalid flash input
    assert.throws(() => db.solveVLLEFlash(null), TypeError);
    assert.throws(
      () => db.solveVLLEFlash({ components: ['Water'], feedFractions: [1.0], temperatureK: 300, pressurePa: 1e5 }),
      TypeError
    );
  });

  runSubtest('PengRobinsonEOS pure/mixture parameters, cubic solver & NRTL', () => {
    const components = [
      {
        name: 'Methane',
        criticalTemperatureK: 190.56,
        criticalPressurePa: 4.599e6,
        acentricFactor: 0.011,
        provenance: { source: 'NIST', license: 'public' }
      },
      {
        name: 'Ethane',
        criticalTemperatureK: 305.32,
        criticalPressurePa: 4.872e6,
        acentricFactor: 0.099,
        provenance: { source: 'NIST', license: 'public' }
      }
    ];
    const k_ij = [
      [0, 0.01],
      [0.01, 0]
    ];

    const eos = new PengRobinsonEOS(components, k_ij);
    eos.setBinaryInteraction(0, 1, 0.015);
    assert.strictEqual(eos.k_ij[0][1], 0.015);
    assert.strictEqual(eos.k_ij[1][0], 0.015);

    const pure = eos.calculatePureParameters(250.0);
    assert.strictEqual(pure.a.length, 2);
    assert.strictEqual(pure.b.length, 2);
    assert(pure.a[0] > 0 && pure.b[0] > 0);

    const mix = eos.calculateMixtureParameters([0.6, 0.4], pure.a, pure.b);
    assert(mix.a_mix > 0);
    assert(mix.b_mix > 0);

    // solveCubicZ
    const zVapor = eos.solveCubicZ(0.1, 0.01, 'vapor');
    const zLiquid = eos.solveCubicZ(0.1, 0.01, 'liquid');
    assert(zVapor >= zLiquid);
    assert(zLiquid > 0.01);

    // Fugacity coefficients
    const fug = eos.calculateFugacityCoefficients([0.5, 0.5], 250.0, 2e6, 'vapor');
    assert.strictEqual(fug.phi.length, 2);
    assert(fug.phi[0] > 0);

    // Two-phase flashPT
    const flashRes = eos.flashPT([0.5, 0.5], 220.0, 2.5e6, { maxIter: 50, tol: 1e-6 });
    assert(flashRes.x.length === 2);
    assert(flashRes.y.length === 2);
    assert(flashRes.K.length === 2);
    assert(Number.isFinite(flashRes.beta));

    // NRTL activity coefficient model
    const deltaG = [
      [0, 5000.0],
      [3000.0, 0]
    ];
    const alpha = [
      [0, 0.3],
      [0.3, 0]
    ];
    const gamma = PengRobinsonEOS.calculateNRTL([0.4, 0.6], 320.0, deltaG, alpha);
    assert.strictEqual(gamma.length, 2);
    assert(gamma[0] > 0 && gamma[1] > 0);
  });

  runSubtest('PipingNetwork3D elbow factors & stress evaluation', () => {
    // Valid elbow factors
    const elbowValid = PipingNetwork3D.computeElbowFactors(219.1, 8.18, 304.8); // 8" Sch 40 90 LR elbow
    assert.strictEqual(elbowValid.success, true);
    assert(elbowValid.flexibilityFactor_k > 1.0);
    assert(elbowValid.inPlaneSIF_ii > 1.0);
    assert(elbowValid.outOfPlaneSIF_io > 1.0);

    // computeASMEB313ElbowSIF wrapper
    const sifRes = new PipingNetwork3D().computeASMEB313ElbowSIF({
      outerDiameterMm: 219.1,
      wallThicknessMm: 8.18,
      bendRadiusMm: 304.8
    });
    assert.strictEqual(sifRes.success, true);
    assert.strictEqual(sifRes.sifInPlane_ii, elbowValid.inPlaneSIF_ii);

    // Missing inputs
    const missElbow = PipingNetwork3D.computeElbowFactors(219.1, null, 304.8);
    assert.strictEqual(missElbow.success, false);
    assert.strictEqual(missElbow.status, 'unavailable');

    // Invalid geometric ranges
    const badGeom = PipingNetwork3D.computeElbowFactors(100, 60, 200); // thickness > D/2
    assert.strictEqual(badGeom.success, false);
    assert.strictEqual(badGeom.status, 'invalid');

    // Stress range evaluation
    const p3d = new PipingNetwork3D();
    const stressValid = p3d.evaluatePipelineStressRange({
      pipeOuterDiameterMm: 219.1,
      nominalWallThicknessMm: 8.18,
      youngsModulusGPa: 200,
      thermalExpansionPerK: 1.2e-5,
      designPressureBar: 20,
      operatingTempC: 150,
      ambientTempC: 20,
      straightLengthM: 10,
      hasExpansionLoop: false,
      corrosionAllowanceMm: 1.0
    });
    assert.strictEqual(stressValid.success, true);
    assert.strictEqual(stressValid.codeAssessment, 'NOT_PERFORMED');
    assert.strictEqual(typeof stressValid.thermalExpansionStressEstimateMPa, 'number');

    const stressFail = p3d.evaluatePipelineStressRange({});
    assert.strictEqual(stressFail.success, false);
  });

  // ---------------------------------------------------------------------------
  // 7. Compliance Qualification & Audit Reporting
  // ---------------------------------------------------------------------------
  console.log('\n[7] Compliance Qualification & Audit Reporting...');

  runSubtest('ToolQualificationKit test suite execution & reports', () => {
    const kit = new ToolQualificationKit({
      toolName: 'OmniEng Core Solver Kernel',
      toolVersion: '2.5.0-verified',
      targetSafetyStandard: 'ISO-26262-ASIL-D'
    });

    assert.strictEqual(ToolQualificationKit.evaluateDO330TQL().supported, false);
    assert.strictEqual(ToolQualificationKit.evaluateISO26262TCL().supported, false);

    assert.throws(() => kit.registerTestCase(null), TypeError);
    assert.throws(() => kit.registerTestCase({}), TypeError);

    kit.registerTestCase({
      id: 'TC-01',
      description: 'Matrix inverse stability test',
      execute: () => ({ actual: '0.0001', expected: '0.0001', passes: true })
    });
    kit.registerTestCase({
      id: 'TC-02',
      description: 'Degenerate stiffness exception check',
      execute: () => {
        throw new Error('Singular matrix');
      }
    });
    kit.registerTestCase({
      id: 'TC-03',
      description: 'Eigenvalue threshold test',
      execute: () => ({ actual: '12.5', expected: '10.0', passes: false })
    });

    const summary = kit.executeQualificationSuite();
    assert.strictEqual(summary.totalTests, 3);
    assert.strictEqual(summary.passedCount, 1);
    assert.strictEqual(summary.failedCount, 2);
    assert(summary.sha256Digest.length === 64);

    const report = kit.generateExperimentalDiagnosticReport();
    assert(report.includes('# Experimental Test Diagnostic Summary'));
    assert(report.includes('TC-01'));
    assert(report.includes('TC-02'));

    assert.strictEqual(kit.generateComplianceReport(), report);
    assert.throws(() => kit.generateCycloneDX_SBOM(), Error);
    assert.throws(() => kit.generateSPDX_SBOM(), Error);

    // Evidence-based evaluation invariant: missing evidence fails closed.
    const missingEvidence = kit.evaluateEvidence({});
    assert.strictEqual(missingEvidence.certificationClaimed, false);
    assert.strictEqual(missingEvidence.incomplete, true);
    assert.strictEqual(missingEvidence.verdict, 'evidence-insufficient');
    assert.ok(
      missingEvidence.reasoning.some((l) => /missing evidence/.test(l)),
      'reasoning must list missing evidence'
    );

    // Full evidence: verdict text contains the computed pass rate; no certification claim.
    const fullEvidence = kit.evaluateEvidence({
      level: 'do330:TQL-5',
      testResults: { passed: 190, failed: 0 },
      coverage: { functions: 95, branches: 92, mcDc: 90 },
      defectTracking: { open: 0, closed: 3 },
      configMgmt: { baselines: 5, changes: 12 },
      toolVersion: '2.5.0',
      usedFor: 'verification'
    });
    assert.strictEqual(fullEvidence.certificationClaimed, false);
    assert.match(fullEvidence.verdict, /evidence-satisfies-/);
    assert.strictEqual(fullEvidence.metrics.passRatePercent, 100, 'computed pass rate must be 100');
    assert.ok(
      fullEvidence.reasoning.some((l) => l.includes('100.0%')),
      'reasoning must contain the computed pass rate'
    );
    const verdictBlob = JSON.stringify([missingEvidence, fullEvidence]);
    assert.doesNotMatch(verdictBlob, /certified|approved/i, 'no verdict may claim certification or approval');

    // Failing criteria must yield evidence-insufficient with computed reasoning.
    const failingEvidence = kit.evaluateEvidence({
      level: 'do330:TQL-5',
      testResults: { passed: 180, failed: 20 },
      coverage: { functions: 95, branches: 92, mcDc: 90 },
      defectTracking: { open: 0, closed: 3 },
      configMgmt: { baselines: 5, changes: 12 },
      usedFor: 'codegen'
    });
    assert.strictEqual(failingEvidence.verdict, 'evidence-insufficient');
    assert.ok(
      failingEvidence.reasoning.some((l) => l.includes('90.0%')),
      'failing reasoning must contain the computed pass rate'
    );
  });

  runSubtest('AuditReportGenerator validation & comprehensive evidence rendering', () => {
    // Null / non-object check
    const nullReport = AuditReportGenerator.generateComprehensiveReport(null);
    assert.strictEqual(nullReport.success, false);
    assert.strictEqual(nullReport.error.code, 'INVALID_INPUT');

    // Missing project evidence
    const missReport = AuditReportGenerator.generateComprehensiveReport({});
    assert.strictEqual(missReport.success, false);
    assert.strictEqual(missReport.error.code, 'INVALID_INPUT');

    // Valid project context
    const validContext = {
      projectId: 'PRJ-CFD-001',
      projectName: 'Transonic Wing Benchmark',
      projectRevision: 'rev-3',
      engineVersion: '2.5.0',
      dependencyVersions: { v8: '12.0', node: '22.22.3' },
      inputs: [{ hash: 'sha256-abc1234', units: 'm/s' }],
      results: [
        {
          domain: 'cae',
          name: 'Peak Shock Wave Mach Number',
          units: 'dimensionless',
          projectRevision: 'rev-3',
          engineVersion: '2.5.0',
          backendVersion: 'native-v2',
          dependencyVersions: { blas: '3.9' },
          convergenceDiagnostics: {
            status: 'converged',
            residuals: [{ metric: 'L2-norm', value: 1e-7, units: 'dimensionless' }]
          },
          warnings: [],
          inputHashes: ['sha256-abc1234']
        }
      ],
      assumptions: ['Ideal gas law', 'Inviscid compressible Euler equations'],
      warnings: []
    };

    const auditRes = AuditReportGenerator.generateComprehensiveReport(validContext);
    assert.strictEqual(auditRes.success, true);
    assert(auditRes.report.generatedAt !== undefined);
    assert(auditRes.htmlReport.includes('Engineering evidence report'));
    assert(auditRes.htmlReport.includes('PRJ-CFD-001'));
  });

  // ---------------------------------------------------------------------------
  // 8. Math Kernels
  // ---------------------------------------------------------------------------
  console.log('\n[8] Math Kernels & Accelerators...');

  runSubtest('worker_thread_kernel throws when required on main thread', () => {
    assert.throws(() => require('../src/core/math/worker_thread_kernel'), /must be executed inside a Worker thread/);
  });

  await runSubtestAsync('worker_thread_kernel isolated execution via Worker message port', async () => {
    const workerScript = path.join(__dirname, '../src/core/math/worker_thread_kernel.js');
    const worker = new Worker(workerScript);

    try {
      const sendMsg = (msg) =>
        new Promise((resolve) => {
          const onMsg = (res) => {
            worker.off('message', onMsg);
            resolve(res);
          };
          worker.on('message', onMsg);
          worker.postMessage(msg);
        });

      // PING / PONG
      const pong = await sendMsg({ type: 'PING' });
      assert.strictEqual(pong.type, 'PONG');

      // EXECUTE ECHO_TEST
      const echoRes = await sendMsg({
        type: 'EXECUTE',
        taskId: 'w1',
        taskType: 'ECHO_TEST',
        payload: { message: 'hello from worker kernel' }
      });
      assert.strictEqual(echoRes.type, 'RESULT');
      assert.strictEqual(echoRes.result.echo, 'hello from worker kernel');

      // EXECUTE WASM_SIMD_BLAS
      const blasRes = await sendMsg({
        type: 'EXECUTE',
        taskId: 'w2',
        taskType: 'WASM_SIMD_BLAS',
        payload: {
          operation: 'dotProduct',
          a: new Float64Array([1, 2, 3, 4]),
          b: new Float64Array([2, 3, 4, 5])
        }
      });
      assert.strictEqual(blasRes.type, 'RESULT');
      assert.strictEqual(blasRes.result.dotProduct, 40);

      // Unsupported task error handling
      const errRes = await sendMsg({
        type: 'EXECUTE',
        taskId: 'w3',
        taskType: 'UNKNOWN_KERNEL_TYPE',
        payload: {}
      });
      assert.strictEqual(errRes.type, 'ERROR');
      assert.strictEqual(errRes.error.code, 'UNSUPPORTED');

      // CANCEL during execution
      const cancelPromise = sendMsg({
        type: 'EXECUTE',
        taskId: 'w4',
        taskType: 'ECHO_TEST',
        payload: { delayMs: 60 }
      });
      worker.postMessage({ type: 'CANCEL', taskId: 'w4' });
      const cancelRes = await cancelPromise;
      assert.strictEqual(cancelRes.type, 'CANCELLED');
    } finally {
      await worker.terminate();
    }
  });

  runSubtest('WasmKernelEngine SIMD128, DAXPY, GEMM & SPMV', () => {
    const engine = new WasmKernelEngine();
    engine.initSync();
    assert.strictEqual(engine.isReady, true);

    const a = new Float64Array([1, 2, 3, 4]);
    const b = new Float64Array([5, 6, 7, 8]);
    const dot = engine.dotProduct(a, b);
    assert.strictEqual(dot, 70); // 5 + 12 + 21 + 32

    const dotSIMD = engine.dotProductSIMD128(a, b);
    assert.strictEqual(dotSIMD, 70);

    const x = new Float64Array([1, 2, 3]);
    const y = new Float64Array([10, 20, 30]);
    engine.daxpy(x, y, 3.0);
    assert.deepStrictEqual(Array.from(y), [13, 26, 39]);

    const ySimd = new Float64Array([10, 20, 30, 40]);
    const xSimd = new Float64Array([1, 2, 3, 4]);
    engine.daxpySIMD128(xSimd, ySimd, 2.0);
    assert.deepStrictEqual(Array.from(ySimd), [12, 24, 36, 48]);

    const norm = engine.vectorNorm(new Float64Array([3, 4]));
    assert.strictEqual(norm, 5);

    const normSimd = engine.vectorNormSIMD128(new Float64Array([3, 4]));
    assert.strictEqual(normSimd, 5);

    // SPMV
    const rowPtr = new Int32Array([0, 2, 3]);
    const colInd = new Int32Array([0, 1, 1]);
    const values = new Float64Array([2, 3, 4]);
    const inVec = new Float64Array([10, 20]);
    const outVec = new Float64Array(2);
    engine.spmv(rowPtr, colInd, values, inVec, outVec, 2);
    assert.deepStrictEqual(Array.from(outVec), [80, 80]);

    // Matrix multiply tiled
    const A_mat = new Float64Array([1, 2, 3, 4]);
    const B_mat = new Float64Array([5, 6, 7, 8]);
    const C_mat = new Float64Array(4);
    engine.matrixMultiplyTiled(A_mat, B_mat, C_mat, 2, 2);
    // [1 2; 3 4] * [5 6; 7 8] = [19 22; 43 50]
    assert.deepStrictEqual(Array.from(C_mat), [19, 22, 43, 50]);

    const bin = buildOmniEngWasmBinary();
    assert(bin.length > 0);
  });

  runSubtest('WasmSparseMultifrontalSolver nested dissection & structured Poisson 2D', () => {
    // 1. General SPD Matrix (3x3 Laplacian with diagonal dominance)
    const solver = new WasmSparseMultifrontalSolver(3, 3);
    solver.addEntry(0, 0, 4);
    solver.addEntry(0, 1, -1);
    solver.addEntry(0, 2, 0);
    solver.addEntry(1, 0, -1);
    solver.addEntry(1, 1, 4);
    solver.addEntry(1, 2, -1);
    solver.addEntry(2, 0, 0);
    solver.addEntry(2, 1, -1);
    solver.addEntry(2, 2, 4);
    solver.finalizeCSR();

    const perm = solver.computeNestedDissectionOrdering();
    assert.strictEqual(perm.length, 3);
    assert.strictEqual(solver.computeAMDOrdering().length, 3);

    const factMetrics = solver.factorize();
    assert.strictEqual(factMetrics.dimension, 3);
    assert(factMetrics.nnzL >= 3);

    const b = [3, 2, 3];
    const solRes = solver.solve(b);
    assert(solRes.converged);
    assert(Math.abs(solRes.solution[0] - 1.0) < 1e-4);
    assert(Math.abs(solRes.solution[1] - 1.0) < 1e-4);
    assert(Math.abs(solRes.solution[2] - 1.0) < 1e-4);

    const rhs = solver.solveRhs(b);
    assert(Math.abs(rhs[0] - 1.0) < 1e-4);

    // denseToCSR & solveCholesky
    const denseMat = [
      [5, 1],
      [1, 5]
    ];
    const csrFromDense = solver.denseToCSR(denseMat);
    const solDense = solver.solveCholesky(csrFromDense, [6, 6]);
    assert(Math.abs(solDense[0] - 1.0) < 1e-4);

    // 2. Structured Poisson 2D (3x3 grid => 9x9 matrix)
    const poissonSolver = new WasmSparseMultifrontalSolver(9, 9, { enableStructuredPoissonDirect: true });
    const N = 3;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        poissonSolver.addEntry(i, i, 4);
        if (x > 0) poissonSolver.addEntry(i, i - 1, -1);
        if (x + 1 < N) poissonSolver.addEntry(i, i + 1, -1);
        if (y > 0) poissonSolver.addEntry(i, i - N, -1);
        if (y + 1 < N) poissonSolver.addEntry(i, i + N, -1);
      }
    }
    const pFact = poissonSolver.factorize();
    assert.strictEqual(pFact.solverMethod, '2d-poisson-dst1');
    const pSol = poissonSolver.solve(new Float64Array(9).fill(1.0));
    assert(pSol.solution.length === 9);
    assert(pSol.solution[4] > 0); // center node
  });

  runSubtest('Sparse iterative helpers: degree-sort ordering and in-memory block Gauss-Seidel', () => {
    const csr = new SparseMatrixCSR(4, 4);
    csr.addEntry(0, 0, 10);
    csr.addEntry(0, 1, 1);
    csr.addEntry(1, 0, 1);
    csr.addEntry(1, 1, 10);
    csr.addEntry(1, 2, 2);
    csr.addEntry(2, 1, 2);
    csr.addEntry(2, 2, 10);
    csr.addEntry(2, 3, 1);
    csr.addEntry(3, 2, 1);
    csr.addEntry(3, 3, 10);
    csr.finalize();

    const degreeOrder = SparseCholeskySolver.computeAMDOrdering(csr);
    assert.strictEqual(degreeOrder.length, 4);

    const b = new Float64Array([11, 13, 13, 11]);
    const solCG = SparseCholeskySolver.solve(csr, b, { maxIterations: 100, tolerance: 1e-7 });
    assert.strictEqual(solCG.converged, true);
    assert(Math.abs(solCG.x[0] - 1.0) < 1e-4);

    // Block-ordered in-memory Gauss-Seidel
    const solBlock = SparseCholeskySolver.solveBlockTiledOutOfCore(csr, b, { blockSize: 2, maxIterations: 150 });
    assert.strictEqual(solBlock.converged, true);
    assert(Math.abs(solBlock.x[0] - 1.0) < 1e-2);
  });

  runSubtest('NativeAcceleratorInterface GEMM, SPMV, DOT, AXPY', () => {
    const acc = new NativeAcceleratorInterface();
    const info = acc.getBackendInfo();
    assert(info.activeTier !== undefined);
    assert.strictEqual(info.hardwareAccelerationFactor, null);
    assert.strictEqual(info.isMeasuredBenchmark, false);

    // GEMM (2x2)
    const A = new Float64Array([1, 2, 3, 4]);
    const B = new Float64Array([2, 0, 1, 2]);
    const C = new Float64Array(4);
    // [1 2; 3 4] * [2 0; 1 2] = [4 4; 10 8]
    acc.gemm(2, 2, 2, 1.0, A, B, 0.0, C);
    assert.deepStrictEqual(Array.from(C), [4, 4, 10, 8]);

    // Test with beta != 0
    acc.gemm(2, 2, 2, 1.0, A, B, 2.0, C);
    // 2 * [4 4; 10 8] + [4 4; 10 8] = [12 12; 30 24]
    assert.deepStrictEqual(Array.from(C), [12, 12, 30, 24]);

    // DOT
    const dotVal = acc.dot(new Float64Array([1, 2, 3, 4, 5]), new Float64Array([2, 2, 2, 2, 2]));
    assert.strictEqual(dotVal, 30);

    // AXPY
    const yVec = new Float64Array([1, 2, 3, 4, 5]);
    acc.axpy(2.0, new Float64Array([1, 1, 1, 1, 1]), yVec);
    assert.deepStrictEqual(Array.from(yVec), [3, 4, 5, 6, 7]);

    // SPMV
    const csr = {
      rows: 2,
      cols: 2,
      rowPtr: new Int32Array([0, 1, 2]),
      colInd: new Int32Array([0, 1]),
      values: new Float64Array([5.0, 10.0])
    };
    const ySpmv = acc.spmv(csr, new Float64Array([2.0, 3.0]));
    assert.deepStrictEqual(Array.from(ySpmv), [10.0, 30.0]);
  });

  // ---------------------------------------------------------------------------
  // 9. CAE & Dynamics
  // ---------------------------------------------------------------------------
  console.log('\n[9] CAE & Dynamics...');

  runSubtest('QuadraticTet10Element, MortarContactPair3D & Lanczos modal solver', () => {
    const tet = new QuadraticTet10Element(1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], SYNTHETIC_CONTINUUM_MATERIAL);
    assert.strictEqual(tet.gaussPoints.length, 4);

    // Shape functions at centroid L1=L2=L3=L4=0.25
    const N = tet.evaluateShapeFunctions(0.25, 0.25, 0.25);
    const sumN = N.reduce((a, b) => a + b, 0);
    assert(Math.abs(sumN - 1.0) < 1e-12);

    // Shape derivatives
    const dN = tet.evaluateShapeDerivatives(0.25, 0.25, 0.25);
    assert.strictEqual(dN.dNdL1.length, 10);
    assert.strictEqual(dN.dNdL2.length, 10);
    assert.strictEqual(dN.dNdL3.length, 10);

    // Jacobian on unit tetrahedron
    const nodes = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0.5, z: 0 },
      { x: 0, y: 0.5, z: 0.5 },
      { x: 0.5, y: 0, z: 0.5 },
      { x: 0.5, y: 0, z: 0 },
      { x: 0, y: 0.5, z: 0 },
      { x: 0, y: 0, z: 0.5 }
    ];
    const jac = tet.computeJacobian(nodes, 0.25, 0.25, 0.25);
    assert(jac.detJ > 0);

    const B = tet.constructBMatrix(jac.dNdx, jac.dNdy, jac.dNdz);
    assert.strictEqual(B.length, 6);
    assert.strictEqual(B[0].length, 30);

    // Radial return mapping: elastic step
    const gp = tet.gaussPoints[0];
    const resElastic = tet.radialReturnMapping(gp, new Float64Array([1e-5, 0, 0, 0, 0, 0]), 1, 300);
    assert.strictEqual(resElastic.isPlastic, false);

    // Radial return mapping: large plastic strain step
    const resPlastic = tet.radialReturnMapping(gp, new Float64Array([0.05, 0, 0, 0, 0, 0]), 1, 300);
    assert.strictEqual(resPlastic.isPlastic, true);
    assert(gp.isYielded);
    assert(gp.equivalentPlasticStrain > 0);

    // MortarContactPair3D
    const mortar = new MortarContactPair3D([0, 1, 2], [3], { penaltyNormal: 1e8, frictionCoeff: 0.3 });
    const cNodes = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 1, y: 0, z: 0 },
      { id: 2, x: 0, y: 1, z: 0 },
      { id: 3, x: 0.2, y: 0.2, z: -0.01 } // penetrating slave node
    ];
    const contactRes = mortar.evaluateContact(cNodes);
    assert.strictEqual(contactRes.activeContactCount, 1);
    assert(contactRes.totalNormalForce > 0);

    // Lanczos modal eigensolver
    const modalSolver = new LanczosModalEigensolver(2);
    const K = [
      [2000, 0],
      [0, 5000]
    ];
    const M = [
      [2, 0],
      [0, 5]
    ];
    const modalRes = modalSolver.solve(K, M, 2);
    assert(modalRes.modesFound >= 1);
    assert.strictEqual(modalRes.sturmCheckPassed, true);
  });

  runSubtest('JohnsonCookFracture with caller-supplied synthetic constants', () => {
    const material = SYNTHETIC_JOHNSON_COOK_MATERIAL;

    const epsF = JohnsonCookFracture.computeFailureStrain(0.333, 10.0, 350.0, material);
    assert(epsF > 0);

    const dDamage = JohnsonCookFracture.computeDamageIncrement(0.01, 0.333, 10.0, 350.0, material);
    assert(dDamage > 0);

    assert.strictEqual(JohnsonCookFracture.isElementFailed(0.8), false);
    assert.strictEqual(JohnsonCookFracture.isElementFailed(1.05), true);

    const flowStress = JohnsonCookFracture.computeFlowStress(material, 0.1, 100.0, 400.0);
    assert(flowStress > 0);

    // Tensile stress tensor [sxx, syy, szz, sxy, syz, szx]
    const stressTensor = [600.0, 0, 0, 0, 0, 0];
    const fracRes = JohnsonCookFracture.computeFractureStrain(material, stressTensor, 1, 300);
    assert(fracRes.fractureStrain > 0);
    assert(fracRes.vonMisesMPa > 0);

    const upd = JohnsonCookFracture.updateDamage(0.9, 0.05, 0.1);
    assert(upd.damage > 0.9);
    assert.strictEqual(upd.isFractured, true);
  });

  runSubtest('PenaltyContact node-to-facet & augmented Lagrangian contact', () => {
    const pc = new PenaltyContact({ penaltyStiffness: 1e7, frictionCoeff: 0.3 });
    const facet = { v0: [0, 0, 0], normal: [0, 0, 1] };
    const slavePen = { pos: [0, 0, -0.005], vel: [1.0, 0, 0] };
    const resPen = pc.evaluateNodeContact(slavePen, facet);
    assert.strictEqual(resPen.inContact, true);
    assert(resPen.normalForceN > 0);
    assert(resPen.frictionForceN > 0);

    const slaveNoPen = { pos: [0, 0, 0.05], vel: [0, 0, 0] };
    const resNoPen = pc.evaluateNodeContact(slaveNoPen, facet);
    assert.strictEqual(resNoPen.inContact, false);

    // Static evaluateContact and applyContactForces
    const surface = { origin: [0, 0, 0], normal: [0, 0, 1], penaltyStiffness: 1000.0, frictionCoeff: 0.3 };
    const sNodes = [
      { id: 'n1', pos: [0, 0, -0.5], vel: [10, 0, 0], mass: 2.0 },
      { id: 'n2', pos: [0, 0, 1.0], vel: [0, 0, 0], mass: 2.0 }
    ];
    const cEval = PenaltyContact.evaluateContact(sNodes, surface);
    assert.strictEqual(cEval.hasContact, true);
    assert.strictEqual(cEval.activeContactCount, 1);

    PenaltyContact.applyContactForces(sNodes, cEval);
    assert(sNodes[0].accel !== undefined);
    assert(sNodes[0].accel[2] > 0); // Repelling upward acceleration

    // Augmented Lagrangian
    const augRes = PenaltyContact.evaluateAugmentedLagrangianContact(sNodes, surface, 5);
    assert.strictEqual(augRes.hasContact, true);
    assert.strictEqual(augRes.converged, true);
  });

  runSubtest('TransonicRiemannSolver Roe, AUSM+, HLLC fluxes & 1D Sod shock-tube', () => {
    const left = { rho: 1.0, u: 0.0, v: 0.0, w: 0.0, p: 100000.0 };
    const right = { rho: 0.125, u: 0.0, v: 0.0, w: 0.0, p: 10000.0 };
    const normal = { x: 1, y: 0, z: 0 };

    // Roe flux
    const roe = TransonicRiemannSolver.solveRoeFlux(left, right, normal);
    assert.strictEqual(roe.scheme, 'roe');
    assert(Number.isFinite(roe.massFlux));
    assert(Number.isFinite(roe.momFlux));
    assert(Number.isFinite(roe.energyFlux));

    // AUSM+ flux
    const ausm = TransonicRiemannSolver.solveAUSMPlusFlux(left, right, normal);
    assert.strictEqual(ausm.scheme, 'ausm_plus');
    assert(Number.isFinite(ausm.massFlux));
    assert(Number.isFinite(ausm.pressureForce));

    // HLLC flux
    const hllc = TransonicRiemannSolver.solveHLLCFlux(left, right, normal);
    assert.strictEqual(hllc.scheme, 'hllc');
    assert(Number.isFinite(hllc.massFlux));

    // 1D Sod Shock-Tube simulation
    const sod = TransonicRiemannSolver.runShockTube1D(30, 0.001, 0.4);
    assert.strictEqual(sod.success, true);
    assert(sod.steps > 0);
    assert(sod.maxMach > 0);
    assert.strictEqual(sod.cells.length, 30);
  });

  runSubtest('Two-phase helpers require caller-supplied properties and run real VOF advection', () => {
    assert.throws(() => new VOFMultiphaseSolver(), /explicit two-phase properties/);
    const vof = new VOFMultiphaseSolver(SYNTHETIC_VOF_FLUID_PROPERTIES);
    const mix0 = vof.getMixtureProperties(0.0);
    assert.strictEqual(mix0.density, SYNTHETIC_VOF_FLUID_PROPERTIES.rho2);

    const mix1 = vof.getMixtureProperties(1.0);
    assert.strictEqual(mix1.density, SYNTHETIC_VOF_FLUID_PROPERTIES.rho1);

    const mixHalf = vof.getMixtureProperties(0.5);
    assert.strictEqual(
      mixHalf.density,
      (SYNTHETIC_VOF_FLUID_PROPERTIES.rho1 + SYNTHETIC_VOF_FLUID_PROPERTIES.rho2) / 2
    );

    // Curvature on 4x4 grid
    const alphaGrid = new Float64Array(16);
    alphaGrid.fill(0);
    alphaGrid[5] = 1.0;
    alphaGrid[6] = 1.0; // center fluid blob
    alphaGrid[9] = 1.0;
    alphaGrid[10] = 1.0;
    const curv = vof.computeInterfaceCurvature(alphaGrid, 4, 4, 0.1);
    assert.strictEqual(curv.kappa.length, 16);
    assert.strictEqual(curv.gradX.length, 16);
    assert.strictEqual(curv.gradY.length, 16);

    // Dam break simulation (real VOF advection with measured front)
    const damRes = vof.simulateDamBreak({ columnWidth: 0.2, columnHeight: 0.4, timeSec: 0.08 });
    assert.strictEqual(damRes.success, true);
    assert.strictEqual(damRes.status, 'VOF_ADVECTION_SOLVED');
    assert(
      damRes.surgeFrontPositionM > damRes.initialColumnWidthM,
      'Measured surge front must advance past the initial column'
    );
    assert(damRes.surgeFrontPositionM < damRes.grid.lengthM, 'Measured surge front must remain inside the domain');
    assert(damRes.waveFrontVelocityMPerS > 0, 'Measured front velocity must be positive');
    assert.strictEqual(Object.hasOwn(damRes, 'massConservationErrorPercent'), true);
    assert(
      damRes.massConservationErrorPercent >= 0 && damRes.massConservationErrorPercent < 0.1,
      'Measured VOF mass error must be small'
    );
    assert(Array.isArray(damRes.trace) && damRes.trace.length > 0, 'Raw measured front trace must be present');
  });

  runSubtest('CantileverResponseEstimator / NonlinearLargeDeflectionSolver', () => {
    assert.throws(() => new CantileverResponseEstimator({ sampleCount: 1 }), /sampleCount must be an integer/);
    assert.throws(() => new CantileverResponseEstimator({ sampleCount: 1001 }), /sampleCount must be an integer/);

    const solver = new CantileverResponseEstimator({ sampleCount: 5 });
    assert.throws(() => solver.solveLargeDeflectionCantilever(null), /Explicit beam dimensions/);
    assert.throws(() => solver.solveLargeDeflectionCantilever({ length: 1000 }), /Explicit length, width/);
    assert.throws(
      () =>
        solver.solveLargeDeflectionCantilever({
          length: 1000,
          width: 20,
          height: 10,
          E: 200000,
          P: 500,
          lengthUnit: 'm',
          modulusUnit: 'MPa',
          forceUnit: 'N'
        }),
      /Cantilever estimate units must be mm, MPa, and N/
    );

    const res = solver.solveLargeDeflectionCantilever({
      length: 1000,
      width: 25,
      height: 10,
      E: 200000,
      P: 500,
      lengthUnit: 'mm',
      modulusUnit: 'MPa',
      forceUnit: 'N'
    });
    assert.strictEqual(res.status, 'ESTIMATE_ONLY');
    assert(res.linearTipDeflectionMm > 0);
    assert(res.formulaAdjustedTipDeflectionMm > 0);
    assert(res.formulaAdjustedTipDeflectionMm < res.linearTipDeflectionMm); // geometric stiffening
    assert.strictEqual(res.loadSamples.length, 5);
  });

  runSubtest('CompositeLaminateCLPT ABD matrix formulation, Tsai-Wu & Hashin criteria', () => {
    assert.throws(
      () => new CompositePly({ thicknessMm: 0.125, orientationDeg: 0 }),
      /explicit finite composite ply inputs/
    );
    const ply0 = new CompositePly(SYNTHETIC_COMPOSITE_PLY);
    const ply45 = new CompositePly({ ...SYNTHETIC_COMPOSITE_PLY, orientationDeg: 45 });
    const ply90 = new CompositePly({ ...SYNTHETIC_COMPOSITE_PLY, orientationDeg: 90 });

    assert(ply0.Q11 > ply0.Q22);
    assert(ply0.Qbar11 > ply90.Qbar11);

    // Symmetric quasi-isotropic laminate [0 / 45 / -45 / 90]s
    const plyMinus45 = new CompositePly({ ...SYNTHETIC_COMPOSITE_PLY, orientationDeg: -45 });
    const laminate = new CompositeLaminateCLPT([ply0, ply45, plyMinus45, ply90, ply90, plyMinus45, ply45, ply0]);
    assert.strictEqual(laminate.A.length, 3);
    assert.strictEqual(laminate.B.length, 3);
    assert.strictEqual(laminate.D.length, 3);
    // Symmetric laminate has B ~ 0
    assert(Math.abs(laminate.B[0][0]) < 1e-6);

    // Tsai-Wu
    const twSafe = CompositeLaminateCLPT.evaluateTsaiWu(ply0, 500e6, 20e6, 10e6);
    assert.strictEqual(twSafe.isSafe, true);
    assert(twSafe.failureIndex < 1.0);

    const twFail = CompositeLaminateCLPT.evaluateTsaiWu(ply0, 2500e6, 100e6, 100e6);
    assert.strictEqual(twFail.isSafe, false);
    assert(twFail.failureIndex > 1.0);

    // Hashin
    const hashinTensile = CompositeLaminateCLPT.evaluateHashin(ply0, 600e6, 30e6, 20e6);
    assert.strictEqual(hashinTensile.isFiberSafe, true);
    assert.strictEqual(hashinTensile.isMatrixSafe, true);

    const hashinComp = CompositeLaminateCLPT.evaluateHashin(ply0, -1500e6, -250e6, 20e6);
    assert.strictEqual(hashinComp.isFiberSafe, false); // compression failure
  });

  runSubtest('FatigueLifeAnalyzer Rainflow cycle counting, Basquin & Miner damage', () => {
    const analyzer = new FatigueLifeAnalyzer();
    assert.throws(() => FatigueLifeAnalyzer.calculateBasquinCycles(1, 0), /explicit fatigueStrengthCoeff/);
    assert.deepStrictEqual(FatigueLifeAnalyzer.countRainflowCycles([1, 2]), []);

    // Random load history
    const signal = [0, 100, -80, 150, -120, 200, -50, 0];
    const cycles = FatigueLifeAnalyzer.countRainflowCycles(signal);
    assert(cycles.length > 0);
    assert(cycles[0].range > 0);
    assert(cycles[0].amplitude > 0);

    const matProps = {
      fatigueStrengthCoeff: 950e6,
      fatigueStrengthExponent: -0.09,
      ultimateTensileStrength: 600e6
    };
    const Nf = FatigueLifeAnalyzer.calculateBasquinCycles(200e6, 50e6, matProps);
    assert(Nf > 1000);

    // Infinite life when amplitude/stress is compressive/zero
    const NfInf = FatigueLifeAnalyzer.calculateBasquinCycles(0, 0, matProps);
    assert.strictEqual(NfInf, 1e12);

    const cumDamage = FatigueLifeAnalyzer.evaluateCumulativeDamage(
      signal.map((v) => v * 1e6),
      matProps
    );
    assert(cumDamage.cycleCount > 0);
    assert(Number.isFinite(cumDamage.cumulativeDamageD));

    // Instance wrapper methods
    const instCycles = analyzer.rainflowCounting(signal);
    assert.strictEqual(instCycles.length, cycles.length);

    const miner = analyzer.calculateMinerDamage(
      cycles,
      matProps.fatigueStrengthCoeff,
      matProps.fatigueStrengthExponent,
      matProps.ultimateTensileStrength
    );
    assert(Number.isFinite(miner.cumulativeDamage));
    assert.strictEqual(miner.isSafe, true);
  });

  console.log('\n================================================================');
  console.log(`   ALL CORE SOLVERS TESTS COMPLETED: ${passed} passed, ${failed} failed`);
  console.log('================================================================');

  return { total: passed + failed, passed, failed };
}

if (require.main === module) {
  runCoreSolversCoverageTests()
    .then((stats) => {
      if (stats.failed > 0) process.exit(1);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { runCoreSolversCoverageTests };
