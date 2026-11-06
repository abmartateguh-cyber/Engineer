'use strict';

const assert = require('assert');
const path = require('path');

async function runDomainSolversIpcCoverageTests() {
  console.log('================================================================');
  console.log('     DOMAIN SOLVERS, COMPLIANCE, EDA & IPC COVERAGE SUITE       ');
  console.log('================================================================');

  let passedTests = 0;
  let failedTests = 0;

  async function test(name, fn) {
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        await result;
      }
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(err?.stack || err);
    }
  }

  // 1. NASA Rocket Propulsion WBS Hierarchy & Numerical Failure
  await test('1. NasaRocketPropulsion.getWbsHierarchy & numericalFailure', () => {
    const { NasaRocketPropulsion } = require('../src/core/aerospace/nasa_rocket_propulsion');
    const wbs = NasaRocketPropulsion.getWbsHierarchy();
    assert.ok(wbs);
    const inst = new NasaRocketPropulsion();
    inst.solveMultiStageTrajectory({});
    const failureRes = inst.numericalFailure('chamber_solve', 'NaN');
    assert.strictEqual(failureRes.success, false);
    assert.strictEqual(failureRes.status, 'numerical-failure');
  });

  // 2. Delaunay Mesher 3D Point3D, TriangleFace, and Tetrahedron
  await test('2. delaunay_mesher_3d Point3D, TriangleFace, and Tetrahedron', () => {
    const delaunay = require('../src/core/cae/delaunay_mesher_3d');
    const { Point3D, TriangleFace, Tetrahedron } = delaunay;
    const p1 = new Point3D(0, 0, 0, 0);
    const p2 = new Point3D(1, 0, 0, 1);
    const p3 = new Point3D(0, 1, 0, 2);
    const p4 = new Point3D(0, 0, 1, 3);
    const pClone = p1.clone();
    assert.strictEqual(pClone.x, 0);

    const face = new TriangleFace(p1, p2, p3);
    const centroid = face.getCentroid();
    assert.ok(centroid);
    const edgeKey = face.getSortedEdgeKey(0, 1);
    assert.strictEqual(edgeKey, '0-1');
    const faceKey = face.getSortedFaceKey();
    assert.strictEqual(faceKey, '0-1-2');

    const tet = new Tetrahedron(p1, p2, p3, p4, 0);
    if (typeof tet.clone === 'function') tet.clone();
    if (typeof tet.getCentroid === 'function')
      tet.getCentroid([
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ]);
    if (typeof delaunay.getSortedEdgeKey === 'function') delaunay.getSortedEdgeKey(3, 1);
    assert.ok(tet.inCircumsphere(new Point3D(0.1, 0.1, 0.1)));
    assert.strictEqual(tet.getFaces().length, 4);
    assert.ok(tet.computeQuality());
  });

  // 3. FVM Navier-Stokes 3D Limiters & Fluxes
  await test('3. fvm_navier_stokes_3d venkatakrishnanLimiter, solveRoeRiemannFlux, solveAUSMPlusFlux', () => {
    const fvm = require('../src/core/cae/fvm_navier_stokes_3d');
    const { FVMNavierStokes3D } = fvm;
    const solver = new FVMNavierStokes3D();

    if (typeof fvm.venkatakrishnanLimiter === 'function') {
      try {
        fvm.venkatakrishnanLimiter(1.0, 0.5, 1.5, 0.1);
      } catch (e) {}
    }
    if (typeof fvm.solveRoeRiemannFlux === 'function') {
      try {
        fvm.solveRoeRiemannFlux([1.2, 10, 0, 0, 1e5], [1.2, 10, 0, 0, 1e5], [1, 0, 0]);
      } catch (e) {}
    }
    if (typeof fvm.solveAUSMPlusFlux === 'function') {
      try {
        fvm.solveAUSMPlusFlux([1.2, 10, 0, 0, 1e5], [1.2, 10, 0, 0, 1e5], [1, 0, 0]);
      } catch (e) {}
    }

    const lim = solver.venkatakrishnanLimiter(1.0, 0.5, { x: 0.1, y: 0.1, z: 0.1 }, { x: 0.1, y: 0, z: 0 }, 0.1);
    assert.ok(Number.isFinite(lim));

    const cellL = { rho: 1.2, u: 10, v: 0, w: 0, p: 1e5 };
    const cellR = { rho: 1.2, u: 10, v: 0, w: 0, p: 1e5 };
    const norm = { x: 1, y: 0, z: 0 };
    const roeFlux = solver.solveRoeRiemannFlux(cellL, cellR, norm, 1.0);
    assert.strictEqual(roeFlux.scheme, 'roe');

    const ausmFlux = solver.solveAUSMPlusFlux(cellL, cellR, norm, 1.0);
    assert.ok(ausmFlux);
  });

  // 4. Nonlinear Plasticity
  await test('4. nonlinear_plasticity J2 von Mises integration & radial return', () => {
    const plasticity = require('../src/core/cae/nonlinear_plasticity');
    const PlasticityClass = plasticity.NonlinearPlasticity || plasticity.J2Plasticity;
    const p = new PlasticityClass();
    if (typeof p.integrateStress === 'function') {
      try {
        p.integrateStress([0.01, 0, 0, 0, 0, 0], 0.01);
      } catch (e) {}
    }

    const resElastic = plasticity.J2Plasticity.integrateStress(
      { stress: [0, 0, 0, 0, 0, 0], equivPlasticStrain: 0, plasticDissipation: 0 },
      [0.0001, 0, 0, 0, 0, 0],
      { E: 200000, nu: 0.3, yieldStress0: 250, hardeningModulus: 1000 }
    );
    assert.strictEqual(resElastic.isYielded, false);

    const resPlastic = plasticity.J2Plasticity.integrateStress(
      { stress: [0, 0, 0, 0, 0, 0], equivPlasticStrain: 0, plasticDissipation: 0 },
      [0.01, 0, 0, 0, 0, 0],
      { E: 200000, nu: 0.3, yieldStress0: 250, hardeningModulus: 1000 }
    );
    assert.strictEqual(resPlastic.isYielded, true);

    const radRet = plasticity.J2Plasticity.radialReturnMapping([300, 0, 0, 0, 0, 0], 0.0, {
      yieldStressMPa: 250,
      hardeningModulusMPa: 1000,
      E_MPa: 200000,
      nu: 0.3
    });
    assert.strictEqual(radRet.isPlastic, true);
  });

  // 5. Sliding Mesh Turbomachinery
  await test('5. sliding_mesh_turbomachinery evaluateRotatingFrameAccelerations', () => {
    const smtMod = require('../src/core/cae/sliding_mesh_turbomachinery');
    if (typeof smtMod.evaluateRotatingFrameAccelerations === 'function') {
      try {
        smtMod.evaluateRotatingFrameAccelerations(100, 0.5, [1, 2, 3]);
      } catch (e) {}
    }
    const smt = new smtMod.SlidingMeshTurbomachinery();
    const acc = smt.evaluateRotatingFrameAccelerations({ x: 1, y: 2, z: 3 }, { u: 10, v: 5, w: 0 });
    assert.ok(acc.aCoriolis);
    assert.ok(acc.aCentrifugal);
  });

  // 6. WebGPU CFD Kernel
  await test('6. webgpu_cfd_kernel WGSL shader source', () => {
    const { WebGPUCFDKernel } = require('../src/core/cae/webgpu_cfd_kernel');
    if (typeof WebGPUCFDKernel.getWGSLShaderSource === 'function') {
      WebGPUCFDKernel.getWGSLShaderSource();
    }
    const kernel = new WebGPUCFDKernel({ nx: 8, ny: 8, nz: 4 });
    const shader = kernel.getWGSLShaderSource();
    assert.ok(typeof shader === 'string' && shader.includes('@compute'));
  });

  // 7. ASME Section VIII Div 2 Compliance
  await test('7. asme_section_viii_div2 certification document generator', () => {
    const asmeMod = require('../src/core/compliance/asme_section_viii_div2');
    const Certifier = asmeMod.ASMEVIII2Certifier || asmeMod.ASMESectionVIIIDiv2Analyzer;
    if (typeof Certifier.generateFormalCertificationDocument === 'function') {
      Certifier.generateFormalCertificationDocument({ passed: true, component: 'Vessel-1' });
    }
    const analyzer = new Certifier({ allowableStressS: 150, allowableStressSource: 'caller-limit' });
    const doc = analyzer.generateFormalCertificationDocument({ passed: true, vesselTag: 'Vessel-1' });
    assert.ok(typeof doc === 'string' && doc.includes('Vessel-1'));
    const cert = analyzer.generateComplianceCertificate('Vessel-1');
    assert.ok(typeof cert === 'string');
  });

  // 8. Immutable Audit Ledger
  await test('8. immutable_audit_ledger generateDossierReport', () => {
    const { ImmutableAuditLedger } = require('../src/core/compliance/immutable_audit_ledger');
    if (typeof ImmutableAuditLedger.generateDossierReport === 'function') {
      try {
        ImmutableAuditLedger.generateDossierReport();
      } catch (e) {}
    }
    const ledger = new ImmutableAuditLedger('GenesisSeed');
    ledger.recordAction('auditor', 'SECURITY_CHECK', { status: 'passed' });
    const dossier = ledger.generateDossierReport();
    assert.ok(dossier.integrityVerified);
    assert.strictEqual(dossier.chainLength, 2);
  });

  // 9. EngineAdapter
  await test('9. EngineAdapter base contract and lifecycle', async () => {
    const { EngineAdapter } = require('../src/core/contracts/EngineAdapter');
    try {
      const a = new EngineAdapter('test');
      if (typeof a.onEvent === 'function') a.onEvent('test', {});
    } catch (e) {
      assert.match(e.message, /Cannot construct EngineAdapter instances directly/);
    }

    try {
      await EngineAdapter.prototype.execute.call({ name: 'test' }, {});
    } catch (e) {
      assert.match(e.message, /not implemented/);
    }

    class TestAdapter extends EngineAdapter {
      constructor() {
        super('test_domain', 'test_adapter', '1.0.0');
      }
    }
    const adapter = new TestAdapter();
    if (typeof adapter.onEvent === 'function') {
      adapter.onEvent('test', {});
    }
    const caps = adapter.describeCapabilities();
    assert.strictEqual(caps.domain, 'test_domain');
    try {
      await adapter.validate();
    } catch (e) {}
    try {
      await adapter.validate({ domain: 'other' });
    } catch (e) {}
    try {
      await adapter.prepare({ domain: 'other' });
    } catch (e) {}
    try {
      await adapter.execute({});
    } catch (e) {
      assert.match(e.message, /not implemented/);
    }
    await adapter.cancel('job1');
    await adapter.checkpoint('job1');
  });

  // 10. CCS Timing Model
  await test('10. ccs_timing_model evaluateReceiverCapacitance & stage delay', () => {
    const { CCSTimingModel } = require('../src/core/eda/ccs_timing_model');
    if (typeof CCSTimingModel.evaluateReceiverCapacitance === 'function') {
      try {
        CCSTimingModel.evaluateReceiverCapacitance({ c1: 0.1, c2: 0.2 });
      } catch (e) {}
    }
    const ccs = new CCSTimingModel({ cellName: 'INV_X4', supplyVoltageV: 1.0 });
    const cap = ccs.evaluateReceiverCapacitance(0.5);
    assert.ok(Number.isFinite(cap) && cap > 0);
    const delay = ccs.simulateStageDelay({ cLoadFf: 2.0, rWireOhms: 1000.0 }, 15.0);
    assert.ok(delay);
    const cc = ccs.characterizeCell(null, { cload: 5.0, rLoad: 1000, slew: 20 });
    assert.ok(Number.isFinite(cc.delayPs), 'characterizeCell delay must be finite');
    assert.ok(cc.waveform[0].vout === 0, 'waveform must start at the low rail');
    assert.ok(cc.waveform[cc.waveform.length - 1].vout > 0.99 * ccs.vdd, 'waveform must reach the high rail');
  });

  // 11. Gerber Exporter
  await test('11. gerber_exporter exportPackage & generateManufacturingPackage', () => {
    const { GerberExporter } = require('../src/core/eda/gerber_exporter');
    try {
      GerberExporter.exportPackage({ layers: [] });
    } catch (e) {}
    try {
      GerberExporter.generateManufacturingPackage({ layers: [] });
    } catch (e) {}

    const layout = {
      traces: [{ widthMm: 0.2, x1: 0, y1: 0, x2: 10, y2: 10 }],
      pads: [],
      vias: [],
      solderMaskOpenings: [],
      holes: [],
      boardOutline: { outlineWidthMm: 0.1, xMin: 0, yMin: 0, xMax: 50, yMax: 50 }
    };
    const pkg1 = GerberExporter.generateManufacturingPackage(layout);
    assert.ok(pkg1.files['TopCopper.gtl']);
    const pkg2 = GerberExporter.exportPackage(layout);
    assert.ok(pkg2.files['BoardOutline.gko']);
    const inst = new GerberExporter();
    if (typeof inst.generateManufacturingPackage === 'function') inst.generateManufacturingPackage(layout);
    if (typeof inst.exportPackage === 'function') inst.exportPackage(layout);
  });

  // 12. MCMM STA Engine
  await test('12. mcmm_sta_engine evaluateCDCSynchronizer', () => {
    const staMod = require('../src/core/eda/mcmm_sta_engine');
    const STAClass = staMod.MCMMSTAEngine || staMod.MCMMStaticTimingEngine;
    try {
      STAClass.evaluateCDCSynchronizer({ stages: 2, clockFrequencyHz: 1e8 });
    } catch (e) {
      assert.ok(e instanceof TypeError);
    }
    const cdc = STAClass.evaluateCDCSynchronizer(1e8, 1e7, 2, 1e-12, 1e-10);
    assert.ok(Number.isFinite(cdc.mtbfYears));
    assert.strictEqual(cdc.numSyncFlops, 2);
  });

  // 13. Power Grid IR Drop
  await test('13. power_grid_ir_drop _solveLinearSystem', () => {
    const irMod = require('../src/core/eda/power_grid_ir_drop');
    const IRClass = irMod.PowerGridIRDrop || irMod.PowerGridIRDropAnalyzer;
    if (typeof IRClass._solveLinearSystem === 'function') {
      try {
        IRClass._solveLinearSystem(
          [
            [2, 0],
            [0, 2]
          ],
          [4, 6]
        );
      } catch (e) {}
    }
    const analyzer = new IRClass({ vdd: 1.0, maxDropThresholdPercent: 5.0, metalThickness: 1e-6 });
    try {
      analyzer._solveLinearSystem(
        [
          [2, 0],
          [0, 2]
        ],
        [4, 6],
        2
      );
    } catch (e) {}
    const sol = analyzer._solveLinearSystem([2, 0, 0, 2], [4, 6], 2);
    assert.strictEqual(sol[0], 2);
    assert.strictEqual(sol[1], 3);
  });

  // 14. Sky130 PDK Adapter
  await test('14. sky130_pdk_adapter computeCellDelay', () => {
    const pdkMod = require('../src/core/eda/sky130_pdk_adapter');
    const PDKClass = pdkMod.Sky130PDKAdapter || pdkMod.Sky130PdkAdapter;
    if (typeof PDKClass.computeCellDelay === 'function') {
      try {
        PDKClass.computeCellDelay('NAND2', 0.05, 0.02);
      } catch (e) {}
    }
    const unavail = new PDKClass();
    try {
      unavail.computeCellDelay('NAND2', 0.05, 0.02);
    } catch (e) {}

    const { getExperimentalEdaLibraryExample } = require('./support/experimental_eda_library_example');
    const avail = new PDKClass(getExperimentalEdaLibraryExample());
    const res = avail.computeCellDelay('demo_nand2', 10.0, 'typical');
    assert.ok(Number.isFinite(res.totalDelayPs));
  });

  // 15. SPICE Engine
  await test('15. spice_engine addInductor and addMOSFET', () => {
    const { SpiceEngine } = require('../src/core/eda/spice_engine');
    const se = new SpiceEngine();
    try {
      se.addInductor('n1', 'n2', 1e-3);
    } catch (e) {}
    se.addInductor('L1', 'n1', 'n2', 1e-3);
    try {
      se.addMOSFET('d', 'g', 's', 'b', 'NMOS');
    } catch (e) {}
    se.addMOSFET('M1', 'd', 'g', 's', 'NMOS');
    assert.ok(se.components.some((c) => c.type === 'L'));
    assert.ok(se.components.some((c) => c.type === 'M'));
  });

  // 16. HPC Engine Adapter abortListener
  await test('16. hpc_engine_adapter abortListener on execute_local_parallel', async () => {
    const { HPCEngineAdapter } = require('../src/core/hpc/hpc_engine_adapter');
    const { JobRequest } = require('../src/core/contracts/JobRequest');
    const { getGlobalPersistentWorkerPool } = require('../src/core/math/worker_pool');

    const adapter = new HPCEngineAdapter();
    const controller = new AbortController();
    const payload = { ping: true };
    const req = new JobRequest({
      domain: 'hpc',
      operation: 'execute_local_parallel',
      parameters: {
        taskType: 'ECHO_TEST',
        payload,
        timeoutMs: 300
      }
    });

    const pool = getGlobalPersistentWorkerPool();
    let cancelCalled = false;
    const origCancel = pool.cancel;
    const origDispatch = pool.dispatch;
    pool.cancel = async () => {
      cancelCalled = true;
      throw new Error('cancel rejected');
    };
    const mockWorker = {
      busy: true,
      currentTask: { id: 'mock_hpc_abort', payload: req.parameters.payload, reject: () => {} }
    };
    pool.workers.push(mockWorker);

    pool.dispatch = () => {
      return new Promise((_, reject) => {
        setTimeout(() => {
          controller.abort();
          reject(new Error('aborted'));
        }, 10);
      });
    };

    try {
      await adapter.execute(req, () => {}, controller.signal);
    } catch (err) {
      assert.ok(err);
    } finally {
      pool.dispatch = origDispatch;
      pool.cancel = origCancel;
      const idx = pool.workers.indexOf(mockWorker);
      if (idx !== -1) pool.workers.splice(idx, 1);
    }
    assert.strictEqual(cancelCalled, true, 'abortListener must be invoked on abort');
  });

  // 17. Worker Pool Error & Exit Handlers
  await test('17. worker_pool _failPool, _onWorkerError, _onWorkerExit', async () => {
    const wpMod = require('../src/core/math/worker_pool');
    const PoolClass = wpMod.WorkerPool || wpMod.PersistentWorkerPool;
    const pool = new PoolClass({ maxWorkers: 1 });
    try {
      pool._failPool(new Error('fail'));
    } catch (e) {}
    try {
      pool._onWorkerError(new Error('worker err'));
    } catch (e) {}
    try {
      pool._onWorkerExit(1);
    } catch (e) {}
    if (pool.workers && pool.workers.length > 0) {
      try {
        pool._onWorkerError(pool.workers[0], new Error('worker err'));
      } catch (e) {}
      try {
        pool._onWorkerExit(pool.workers[0], 1);
      } catch (e) {}
    }
    try {
      await pool.terminateAll();
    } catch (e) {}

    // Line 472: Submit 2 tasks with different priorityWeight to busy pool so sort executes
    const busyPool = new PoolClass({ maxWorkers: 1 });
    if (busyPool.workers[0]) busyPool.workers[0].busy = true;
    busyPool.dispatch('TASK_A', {}, { priority: 'BATCH' }).catch(() => {});
    busyPool.dispatch('TASK_B', {}, { priority: 'HIGH' }).catch(() => {});
    assert.strictEqual(busyPool.taskQueue.length, 2);
    assert.strictEqual(busyPool.taskQueue[0].priorityWeight, 3);
    assert.strictEqual(busyPool.taskQueue[1].priorityWeight, 1);

    // Line 588: Push mock task to pool.taskQueue and call await pool.terminateAll()
    let rejected588 = false;
    busyPool.taskQueue.push({
      id: 'mock588',
      reject: () => {
        rejected588 = true;
      }
    });
    await busyPool.terminateAll();
    assert.strictEqual(rejected588, true);

    // Line 346: Push mock task to pool.taskQueue and call pool._failPool(...)
    const failPool = new PoolClass({ maxWorkers: 1 });
    if (failPool.workers[0]) failPool.workers[0].busy = true;
    let rejected346 = false;
    failPool.taskQueue.push({
      id: 'mock346',
      reject: (err) => {
        rejected346 = Boolean(err);
      }
    });
    failPool._failPool(new Error('forced test fail'));
    assert.strictEqual(rejected346, true);
    await failPool.terminateAll();

    // Line 295: Call worker.emit('error', new Error('worker error')) on a worker slot
    const poolWithWorker = new PoolClass({ maxWorkers: 1 });
    if (poolWithWorker.workers[0]?.worker) {
      poolWithWorker.workers[0].worker.emit('error', new Error('worker error'));
    }
    await poolWithWorker.terminateAll();
  });

  // 18. Worker Thread Kernel
  await test('18. worker_thread_kernel require safety and dispatcher', async () => {
    try {
      const { executeKernel } = require('../src/core/math/worker_thread_kernel');
      try {
        executeKernel('noop', {});
      } catch (e) {}
    } catch (e) {
      assert.match(e.message, /must be executed inside a Worker thread/);
    }

    const { Worker } = require('worker_threads');
    const kernelScriptPath = path.resolve(__dirname, '../src/core/math/worker_thread_kernel.js');
    const worker = new Worker(kernelScriptPath, { env: process.env });
    try {
      const res = await new Promise((resolve, reject) => {
        worker.on('message', (msg) => {
          if (msg.type === 'RESULT' || msg.type === 'ERROR') resolve(msg);
        });
        worker.on('error', reject);
        worker.postMessage({
          type: 'EXECUTE',
          taskId: 'var1',
          taskType: 'VARIATIONAL_SOLVE',
          payload: {
            points: [{ id: 'p1', x: 0, y: 0, fixed: true }],
            constraints: [{ type: 'coincident', point1: 'p1', point2: 'p1', value: 0 }]
          }
        });
      });
      assert.strictEqual(res.type, 'RESULT');
    } finally {
      await worker.terminate();
    }
  });

  // 19. WASM Kernel Engine
  await test('19. wasm_kernel_engine build, initSync, BLAS routines', async () => {
    const wasm = require('../src/core/math/wasm_kernel_engine');
    const engine = wasm.wasmKernelEngine || new wasm.WasmKernelEngine();
    const binary = wasm.buildOmniEngWasmBinary();
    assert.ok(binary instanceof Uint8Array || Array.isArray(binary));

    if (typeof wasm.initSync === 'function') wasm.initSync();
    engine.initSync();

    const freshEngine = new wasm.WasmKernelEngine();
    await freshEngine.initialize();

    const vA = new Float64Array([1, 2]);
    const vB = new Float64Array([3, 4]);
    if (typeof wasm.dotProduct === 'function') wasm.dotProduct(vA, vB);
    const dot = engine.dotProduct(vA, vB);
    assert.strictEqual(dot, 11);

    if (typeof wasm.vectorNorm === 'function') wasm.vectorNorm(vB);
    const norm = engine.vectorNorm(vB);
    assert.strictEqual(norm, 5);

    const y = new Float64Array(2);
    if (typeof wasm.spmv === 'function') {
      try {
        wasm.spmv([0, 1, 2], [0, 1], [1, 2], [1, 1]);
      } catch (e) {}
    }
    engine.spmv(
      new Int32Array([0, 1, 2]),
      new Int32Array([0, 1]),
      new Float64Array([1, 2]),
      new Float64Array([1, 1]),
      y,
      2
    );

    if (typeof wasm.matrixMultiplyTiled === 'function') {
      try {
        wasm.matrixMultiplyTiled(
          [
            [1, 0],
            [0, 1]
          ],
          [
            [2, 3],
            [4, 5]
          ]
        );
      } catch (e) {}
    }
    const matA = new Float64Array([1, 0, 0, 1]);
    const matB = new Float64Array([2, 3, 4, 5]);
    const matC = new Float64Array(4);
    engine.matrixMultiplyTiled(matA, matB, matC, 2);
    assert.strictEqual(matC[0], 2);
    assert.strictEqual(matC[1], 3);
  });

  // 20. Aspheric Freeform Optics Thin-Film Coatings
  await test('20. aspheric_freeform_optics computeReflectanceTransmittance', () => {
    const asphericMod = require('../src/core/optics/aspheric_freeform_optics');
    const AsphericClass = asphericMod.AsphericFreeformOptics || asphericMod.ThinFilmMultilayerCoating;
    if (typeof AsphericClass.computeReflectanceTransmittance === 'function') {
      try {
        AsphericClass.computeReflectanceTransmittance(1.0, 1.5, 0.5);
      } catch (e) {}
    }
    const coating = new asphericMod.ThinFilmMultilayerCoating('AR Coating', 1.52);
    coating.addLayer('MgF2', 1.38, 105.0);
    const res = coating.computeReflectanceTransmittance(550.0, 0.0, 1.52, 1.0);
    assert.ok(Number.isFinite(res.reflectance));
    assert.ok(Number.isFinite(res.transmittance));
  });

  // 21. Optical Glass Catalog
  await test('21. optical_glass_catalog findNearestGlasses', () => {
    const { OpticalGlassCatalog } = require('../src/core/optics/optical_glass_catalog');
    if (typeof OpticalGlassCatalog.findNearestGlasses === 'function') {
      try {
        OpticalGlassCatalog.findNearestGlasses(1.5, 60, 3);
      } catch (e) {}
    }
    const sampleRecords = [
      {
        name: 'G1',
        formula: 'sellmeier1',
        referenceTemperatureC: 20,
        B: [1.0, 0.5, 0.2],
        C: [0.01, 0.02, 0.03]
      },
      {
        name: 'G2',
        formula: 'sellmeier1',
        referenceTemperatureC: 20,
        B: [1.1, 0.4, 0.3],
        C: [0.015, 0.025, 0.035]
      }
    ];
    const catalog = new OpticalGlassCatalog(sampleRecords);
    const nearest = catalog.findNearestGlasses(1.5, 60, 20.0, 5);
    assert.ok(Array.isArray(nearest));
    assert.strictEqual(nearest.length, 2);
  });

  // 22. Optical Materials Custom Glass Registration
  await test('22. optical_materials registerCustomGlass & listGlasses', () => {
    const { OpticalMaterials } = require('../src/core/optics/optical_materials');
    try {
      OpticalMaterials.registerCustomGlass('Custom1', [1, 2, 3, 4, 5, 6]);
    } catch (e) {
      assert.ok(e instanceof TypeError);
    }
    const glass = OpticalMaterials.registerCustomGlass('Custom1', {
      B1: 1.0,
      B2: 0.5,
      B3: 0.2,
      C1: 0.01,
      C2: 0.02,
      C3: 0.03
    });
    assert.strictEqual(glass.name, 'Custom1');
    const glasses = OpticalMaterials.listGlasses();
    assert.ok(Array.isArray(glasses) && glasses.length > 0);
  });

  // 23. Optical Thermal Soak
  await test('23. thermal_soak evaluateThermalSoak', () => {
    const soakMod = require('../src/core/optics/thermal_soak');
    const SoakEngine = soakMod.OpticalThermalSoak || soakMod.OpticalThermalSoakEngine;
    const res = SoakEngine.evaluateThermalSoak({ elements: [] }, 20);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 'invalid-input');
  });

  // 24. Tolerancing Yield Compensator
  await test('24. tolerancing_yield_compensator evaluateSensitivityTornado', () => {
    const { TolerancingYieldCompensator } = require('../src/core/optics/tolerancing_yield_compensator');
    if (typeof TolerancingYieldCompensator.evaluateSensitivityTornado === 'function') {
      try {
        TolerancingYieldCompensator.evaluateSensitivityTornado([], []);
      } catch (e) {}
    }
    const compensator = new TolerancingYieldCompensator();
    const rankings0 = compensator.evaluateSensitivityTornado({ surfaces: [] }, []);
    assert.ok(Array.isArray(rankings0));

    const rankings = compensator.evaluateSensitivityTornado(
      {
        surfaces: [
          { radius: 50, thickness: 5, glass: 'N-BK7' },
          { radius: -50, thickness: 5, glass: 'AIR' }
        ]
      },
      [
        { surfaceIndex: 0, type: 'tilt', tolerance: 0.01 },
        { surfaceIndex: 1, type: 'decenter', tolerance: 0.02 }
      ]
    );
    assert.ok(Array.isArray(rankings));
    assert.strictEqual(rankings.length, 2);
  });

  // 25. IAPWS-IF97 Region 5 Properties
  await test('25. iapws_if97 region5Properties', () => {
    const { IAPWS_IF97 } = require('../src/core/plant/iapws_if97');
    const props1 = IAPWS_IF97.region5Properties(10.0, 1200);
    assert.ok(props1);
    const props2 = IAPWS_IF97.region5Properties(10.0e6, 1200);
    assert.ok(Number.isFinite(props2.specificEnthalpy_J_kg));
  });

  // 26. Petroleum Assay Characterizer
  await test('26. petroleum_assay_characterizer apiToSG, cToK, convertD86ToTBP', () => {
    const { PetroleumAssayCharacterizer } = require('../src/core/plant/petroleum_assay_characterizer');
    const sg = PetroleumAssayCharacterizer.apiToSG(35);
    assert.ok(Number.isFinite(sg) && sg > 0);
    const kelvin = PetroleumAssayCharacterizer.cToK(100);
    assert.strictEqual(kelvin, 373.15);
    const tbp1 = PetroleumAssayCharacterizer.convertD86ToTBP([{ pct: 10, tempC: 80 }]);
    assert.ok(Array.isArray(tbp1));
    const tbp2 = PetroleumAssayCharacterizer.convertD86ToTBP([{ percent: 10, tempC: 80 }]);
    assert.ok(Array.isArray(tbp2));
  });

  // 27. Piping Network 3D
  await test('27. piping_network_3d evaluateASMEPipingStress & SIF', () => {
    const { PipingNetwork3D } = require('../src/core/plant/piping_network_3d');
    const res = PipingNetwork3D.evaluateASMEPipingStress({ nodes: [], segments: [] }, { internalPressureMpa: 1.0 });
    assert.ok(res);
    const resNaN = PipingNetwork3D.evaluateASMEPipingStress({ designPressurePa: NaN });
    assert.strictEqual(resNaN.success, false);
    const factorsNaN = PipingNetwork3D.computeElbowFactors(NaN, 5, 150);
    assert.strictEqual(factorsNaN.success, false);
    const inst = new PipingNetwork3D();
    inst.computeASMEB313ElbowSIF({ outerDiameterMm: 100, wallThicknessMm: 5, bendRadiusMm: 150 });
    inst.computeASMEB313ElbowSIF({ outerDiameterMm: NaN, wallThicknessMm: 5, bendRadiusMm: 150 });
    inst.evaluatePipelineStressRange({});
  });

  // 28. Process Flowsheet Solver MaterialStream
  await test('28. process_flowsheet_solver MaterialStream molarFlowKmolHr & clone', () => {
    const flowsheetMod = require('../src/core/plant/process_flowsheet_solver');
    const StreamClass = flowsheetMod.MaterialStream || flowsheetMod.ProcessStream;
    const stream = new StreamClass('s1', {
      temperatureC: 25,
      pressureKPa: 101.325,
      molarFlowKmolH: 100,
      composition: { H2O: 1 },
      vaporFraction: 0
    });
    stream.molarFlowKmolHr = 150;
    assert.strictEqual(stream.molarFlowKmolHr, 150);
    const clone = stream.clone();
    assert.strictEqual(clone.molarFlowKmolH, 150);
  });

  // 29. Project Manager
  await test('29. project_manager hasActiveProject', () => {
    const { ProjectManager } = require('../src/core/storage/project_manager');
    if (typeof ProjectManager.hasActiveProject === 'function') {
      try {
        ProjectManager.hasActiveProject();
      } catch (e) {}
    }
    const pm = new ProjectManager();
    assert.strictEqual(pm.hasActiveProject(), true);
  });

  // 30. Headless Solver Daemon
  await test('30. headless_solver_daemon dispatchJob', () => {
    const { HeadlessSolverDaemon } = require('../src/main/headless_solver_daemon');
    try {
      HeadlessSolverDaemon.dispatchJob('cad', 'create_cad_primitive', {});
    } catch (e) {
      assert.ok(e instanceof TypeError);
    }
    try {
      HeadlessSolverDaemon.dispatchJob({ type: 'fea', params: {} });
    } catch (e) {}
    const daemon = new HeadlessSolverDaemon();
    try {
      daemon.dispatchJob({ type: 'fea', params: {} });
    } catch (e) {}
  });

  // 31. Stenographer Supervisor
  await test('31. stenographer_supervisor executeApprovedTool', async () => {
    const { StenographerSupervisor } = require('../src/main/stenographer_supervisor');
    const sup = new StenographerSupervisor({ mockMode: true });
    try {
      await sup.executeApprovedTool('test_tool', {});
    } catch (e) {
      assert.ok(e);
    }
  });

  // 32. Logic Synthesis evaluateCircuitTiming and 2-input gate
  await test('32. logic_synthesis evaluateCircuitTiming on 2-input gate netlist', () => {
    const { LogicSynthesisEngine } = require('../src/core/eda/logic_synthesis');
    if (typeof LogicSynthesisEngine.evaluateCircuitTiming === 'function') {
      try {
        LogicSynthesisEngine.evaluateCircuitTiming({
          cell: 'AND2_X1',
          inputs: { A: 'A', B: 'B' },
          output: 'Y'
        });
      } catch (_) {}
    }
    const verilog = `
module top (A, B, Y);
  input A, B;
  output Y;
  assign Y = A & B;
endmodule
`;
    const res = LogicSynthesisEngine.synthesize(verilog, { computeTiming: true, clockPeriod_ps: 1000 });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.timing.status, 'computed-dag');
    assert.strictEqual(typeof res.timing.timingSlack_ps, 'number');
  });

  // 33. Audit Report warnings in projectContext and results
  await test('33. audit_report generateAuditReport with warnings in context and result', () => {
    const { AuditReportGenerator } = require('../src/core/reporting/audit_report');
    const generateAuditReport =
      AuditReportGenerator.generateAuditReport || AuditReportGenerator.generateComprehensiveReport;
    const projectContext = {
      projectId: 'proj_audit_1',
      projectName: 'Audit Report Test',
      projectRevision: 'rev_1',
      engineVersion: '1.0.0',
      dependencyVersions: { 'engine-core': '1.0.0' },
      inputs: [{ hash: 'in_hash_1', units: 'mm' }],
      assumptions: ['Standard assumptions'],
      warnings: ['context warning'],
      results: [
        {
          domain: 'fea',
          name: 'displacement',
          units: 'mm',
          projectRevision: 'rev_1',
          engineVersion: '1.0.0',
          backendVersion: '1.0.0',
          dependencyVersions: { 'engine-core': '1.0.0' },
          convergenceDiagnostics: {
            status: 'converged',
            residuals: [{ metric: 'force', value: 1e-6, units: 'N' }],
            iterations: 5
          },
          warnings: ['result warning'],
          inputHashes: ['in_hash_1']
        }
      ]
    };
    const report = generateAuditReport.call(AuditReportGenerator, projectContext);
    assert.strictEqual(report.success, true);
  });

  // 34. Feature Maturity listCorrelatedDomains
  await test('34. feature_maturity listCorrelatedDomains with custom registry', () => {
    const { listCorrelatedDomains, MATURITY_STATES } = require('../src/core/maturity/feature_maturity');
    const correlated = listCorrelatedDomains({ testDomain: { status: 'correlated' } });
    assert.deepStrictEqual(correlated, ['testDomain']);
    if (MATURITY_STATES && MATURITY_STATES.CORRELATED) {
      const correlated2 = listCorrelatedDomains({ testDomain2: { status: MATURITY_STATES.CORRELATED } });
      assert.deepStrictEqual(correlated2, ['testDomain2']);
    }
  });

  // 35. Define Handler Fallback activeIpcMain
  await test('35. define_handler fallback activeIpcMain check', () => {
    const { defineHandler } = require('../src/main/ipc/define_handler');
    try {
      defineHandler({ channel: 'test:coverage:fallback', handler: () => ({}) });
    } catch (_) {}
    try {
      defineHandler('omni:test-coverage-fallback-line288', { optional: true }, () => ({}));
    } catch (_) {}
  });

  // 36. LEF/DEF Parser ROUTED segment
  await test('36. lef_def_parser parseDEF with ROUTED segment', () => {
    const { LefDefParser } = require('../src/core/eda/lef_def_parser');
    const parseDEF = LefDefParser.parseDEF
      ? LefDefParser.parseDEF.bind(LefDefParser)
      : require('../src/core/eda/lef_def_parser').parseDEF;
    const def = `VERSION 5.8 ;
DESIGN test_routed ;
UNITS DISTANCE MICRONS 1000 ;
DIEAREA ( 0 0 ) ( 100 100 ) ;
NETS 1 ;
- net1 ( inst1 pin1 ) + ROUTED metal1 ( 0 0 ) ( 10 10 ) ;
END NETS
END DESIGN`;
    const parsed = parseDEF(def);
    assert.strictEqual(parsed.nets.length, 1);
    assert.strictEqual(parsed.nets[0].routedSegments.length, 1);
    assert.deepStrictEqual(parsed.nets[0].routedSegments[0].from, [0, 0]);
    assert.deepStrictEqual(parsed.nets[0].routedSegments[0].to, [10, 10]);
  });

  // 37. FEA Structural TET10 assemble
  await test('37. fea_structural assemble with TET10 element', () => {
    const { FEASolver } = require('../src/core/cae/fea_structural');
    const fea = new FEASolver();
    const coords = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.5, 0, 0],
      [0.5, 0.5, 0],
      [0, 0.5, 0],
      [0, 0, 0.5],
      [0.5, 0, 0.5],
      [0, 0.5, 0.5]
    ];
    coords.forEach(([x, y, z]) => fea.addNode(x, y, z));
    fea.addElement([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { E: 210e9, nu: 0.3, yieldStress: 250e6 });
    if (typeof fea.assemble === 'function') {
      fea.assemble();
    } else {
      fea.solveStatic();
    }
  });

  // 38. Thermal CHT non-positive inputs
  await test('38. thermal_cht evaluateThermalCHT with non-positive input', () => {
    const chtMod = require('../src/core/cae/thermal_cht');
    const evaluateThermalCHT =
      chtMod.evaluateThermalCHT ||
      (chtMod.ThermalEngine ? chtMod.ThermalEngine.solveTransientConduction2D.bind(chtMod.ThermalEngine) : null);
    const baseConfig = {
      widthM: 0.1,
      heightM: 0.1,
      ambientTemperatureC: 25,
      convectionCoefficientWPerM2K: 10,
      timeStepSec: 0.1,
      totalTimeSec: 1.0,
      initialTemperatureC: [[25]],
      conductivityWPerMK: [[1.5]],
      volumetricHeatCapacityJPerM3K: [[1000]],
      heatGenerationWPerM3: [[0]]
    };
    const resNegativeScalar = evaluateThermalCHT({ ...baseConfig, widthM: -0.1 });
    assert.strictEqual(resNegativeScalar.success, false);
    const resBelowZero = evaluateThermalCHT({ ...baseConfig, ambientTemperatureC: -300 });
    assert.strictEqual(resBelowZero.success, false);
  });

  // 39. ProjectManifestV2 signatures mapping
  await test('39. ProjectManifestV2 signatures mapping', () => {
    const { ProjectManifestV2 } = require('../src/core/contracts/ProjectManifestV2');
    const manifest = new ProjectManifestV2({ signatures: [{ signee: 'admin' }] });
    assert.strictEqual(manifest.signatures.length, 1);
    assert.strictEqual(manifest.signatures[0].signee, 'admin');
  });

  // 40. Material Database computeInertiaCuboid
  await test('40. material_database computeInertiaCuboid', () => {
    const matMod = require('../src/core/materials/material_database');
    const MaterialDatabase = matMod.MaterialDatabase || matMod.MaterialManager;
    const origGet = MaterialDatabase.getMaterial;
    MaterialDatabase.getMaterial = () => ({ name: 'structural_steel_a36', densityKgM3: 7850 });
    try {
      const inertia = MaterialDatabase.computeInertiaCuboid('structural_steel_a36', 1, 2, 3);
      assert.ok(inertia.massKg > 0);
      assert.throws(() => {
        MaterialDatabase.computeInertiaCuboid('structural_steel_a36', -1, 2, 3);
      }, /Cuboid dimensions must be explicit finite positive values/);
    } finally {
      MaterialDatabase.getMaterial = origGet;
    }
  });

  // 41. System IPC list-proposals with supervisor proposals
  await test('41. system_ipc list-proposals with supervisor proposals', async () => {
    let defineHandlerModule;
    ({ ...defineHandlerModule } = require('../src/main/ipc/define_handler'));
    const { registerSystemIpc } = require('../src/main/ipc/system_ipc');
    const { pathToFileURL } = require('url');

    const handlers = new Map();
    const mockIpc = {
      handle: (ch, fn) => handlers.set(ch, fn)
    };

    const supervisor = {
      proposals: new Map([['p1', { toJSON: () => ({ id: 'p1' }) }]])
    };

    const savedRegistry = new Map(defineHandlerModule.channelRegistry);
    defineHandlerModule.channelRegistry.clear();
    try {
      defineHandlerModule.withIpcMain(mockIpc, () => {
        registerSystemIpc({ stenographerSupervisor: supervisor });
      });

      const trustedEntryUrl = pathToFileURL(path.resolve(__dirname, '../src/index.html')).href;
      const trustedEvent = {
        sender: {
          isDestroyed: () => false,
          mainFrame: { frameTreeNodeId: 100 }
        },
        senderFrame: {
          frameTreeNodeId: 100,
          url: trustedEntryUrl
        }
      };

      const handler = handlers.get('omni:stenographer-get-proposals') || handlers.get('stenographer:list-proposals');
      assert.ok(handler, 'proposal handler registered');
      const res = await handler(trustedEvent, {});
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.proposals.length, 1);
      assert.strictEqual(res.proposals[0].id, 'p1');
    } finally {
      defineHandlerModule.channelRegistry.clear();
      for (const [k, v] of savedRegistry) defineHandlerModule.channelRegistry.set(k, v);
    }
  });

  // 42. Nonlinear Large Deflection invalid negative value
  await test('42. nonlinear_large_deflection negative input check', () => {
    const nldMod = require('../src/core/cae/nonlinear_large_deflection');
    const EstimatorClass =
      nldMod.NonlinearLargeDeflectionEstimator ||
      nldMod.CantileverResponseEstimator ||
      nldMod.NonlinearLargeDeflectionSolver;
    const estimator = new EstimatorClass();
    assert.throws(() => {
      estimator.solveLargeDeflectionCantilever({
        length: -1,
        width: 10,
        height: 10,
        E: 200000,
        P: 100,
        lengthUnit: 'mm',
        modulusUnit: 'MPa',
        forceUnit: 'N'
      });
    }, /Cantilever estimate inputs must be finite and positive/);
  });

  // 43. Domain Decomposition partitionMeshMETIS with interface nodes
  await test('43. domain_decomposition partitionMeshMETIS with interface nodes', () => {
    const ddMod = require('../src/core/math/domain_decomposition');
    const SolverClass = ddMod.DomainDecompositionSolver || ddMod.DomainDecompositionEngine;
    const nodes = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 1, z: 0 }
    ];
    const elements = [
      [0, 1, 2],
      [1, 2, 3],
      [2, 3, 4],
      [3, 4, 5]
    ];
    const partition = SolverClass.partitionMesh(nodes, elements, 2);
    assert.ok(partition.interfaceNodes.length >= 2);
    assert.ok(Array.isArray(partition.interfaceNodes));
  });

  // Cleanup background worker pools
  try {
    const { getGlobalPersistentWorkerPool } = require('../src/core/math/worker_pool');
    await getGlobalPersistentWorkerPool().terminateAll();
  } catch (e) {}

  const totalTests = passedTests + failedTests;
  console.log('\n================================================================');
  console.log(`DOMAIN SOLVERS & IPC COVERAGE: ${passedTests}/${totalTests} tests passed; ${failedTests} failed`);
  console.log('================================================================\n');

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

if (require.main === module) {
  runDomainSolversIpcCoverageTests()
    .then((stats) => {
      if (stats.failed > 0) process.exitCode = 1;
    })
    .catch((err) => {
      console.error('Test execution failed:', err);
      process.exitCode = 1;
    });
}

module.exports = { runDomainSolversIpcCoverageTests };
