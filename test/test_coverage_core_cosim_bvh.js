'use strict';

const assert = require('assert');
const path = require('path');
const { Worker } = require('worker_threads');

const { FmiMasterEngine, FmuSlave, HermiteSignalInterpolator } = require('../src/core/cosim/fmi_master_engine');
const { AssemblyBVHHierarchy, AABB3D, BVHNode } = require('../src/core/cad/assembly_bvh_hierarchy');
const { ElementHEX20 } = require('../src/core/cae/element_hex20');
const { ElementTET10 } = require('../src/core/cae/element_tet10');
const { PrismLayerMesher } = require('../src/core/cae/prism_layer_mesher');
const { WegsteinRecycleSolver } = require('../src/core/plant/wegstein_recycle_solver');
const { Api520ReliefValve, API_526_ORIFICES } = require('../src/core/plant/api520_relief_valve');
const { PinchEnergyTargeter } = require('../src/core/plant/pinch_energy_targeter');
const { NonSequentialTracer, OpticalRay } = require('../src/core/optics/non_sequential_tracer');
const { VolumeScatteringEngine } = require('../src/core/optics/volume_scattering');
const { ZemaxZmxImporter } = require('../src/core/optics/zmx_importer');
const { DomainDecompositionEngine } = require('../src/core/math/domain_decomposition');

async function runCosimBvhCoverageTests() {
  console.log('================================================================');
  console.log('   TESTING CORE COSIM, BVH, CAE ELEMENTS, PLANT & OPTICS       ');
  console.log('================================================================');

  let passedTests = 0;
  let failedTests = 0;
  let currentSection = 'suite setup';

  try {
    currentSection = '[1/7] FMI Master Engine & Slaves';
    // 1. FMI Master Engine & Slaves
    console.log('\n[1] FMI Master Engine & Slaves...');
    {
      const slaveA = new FmuSlave({
        instanceName: 'SlaveA',
        guid: 'guid-a',
        variables: [
          { name: 'u', vr: 1, causality: 'input', initial: 1.0 },
          { name: 'y', vr: 2, causality: 'output', initial: 2.0 }
        ],
        hasDirectFeedthrough: true
      });

      const slaveB = new FmuSlave({
        instanceName: 'SlaveB',
        guid: 'guid-b',
        variables: [
          { name: 'u', vr: 1, causality: 'input', initial: 0.5 },
          { name: 'y', vr: 2, causality: 'output', initial: 1.5 }
        ],
        hasDirectFeedthrough: true
      });

      // Test FMI 2.0 and FMI 3.0 API methods
      assert.deepStrictEqual(slaveA.getReal([1, 2]), [1.0, 2.0]);
      assert.deepStrictEqual(slaveA.fmi3GetFloat64([1, 2]), [1.0, 2.0]);
      slaveA.setReal([1], [3.0]);
      assert.strictEqual(slaveA.getReal([1])[0], 3.0);
      slaveA.fmi3SetFloat64([1], [4.0]);
      assert.strictEqual(slaveA.getReal([1])[0], 4.0);

      // Save and restore state
      const state = slaveA.getFMUState();
      const state3 = slaveA.fmi3GetFMUState();
      assert.strictEqual(typeof state, 'object');
      slaveA.setReal([1], [10.0]);
      slaveA.setFMUState(state);
      assert.strictEqual(slaveA.getReal([1])[0], 4.0);
      slaveA.setReal([1], [20.0]);
      slaveA.fmi3SetFMUState(state3);
      assert.strictEqual(slaveA.getReal([1])[0], 4.0);

      // doStep and fmi3DoStep
      assert.strictEqual(slaveA.doStep(0, 0.01), true);
      assert.strictEqual(slaveA.fmi3DoStep(0.01, 0.01, false), true);

      // Hermite Interpolator
      const valInterpolated = HermiteSignalInterpolator.interpolate(0.5, 0.0, 1.0, 0.0, 1.0, 1.0, 1.0);
      assert(Number.isFinite(valInterpolated));
      const valSameDt = HermiteSignalInterpolator.interpolate(0.0, 0.0, 0.0, 5.0, 5.0, 0, 0);
      assert.strictEqual(valSameDt, 5.0);

      // Engine simulation - Gauss-Seidel without loop
      const masterGS = new FmiMasterEngine({
        startTime: 0,
        stopTime: 0.05,
        defaultStepSize: 0.01,
        scheme: 'gauss_seidel',
        adaptiveStep: true
      });
      masterGS.addSlave(slaveA);
      masterGS.addSlave(slaveB);
      masterGS.addConnection(slaveA, 2, slaveB, 1);
      assert.strictEqual(masterGS.hasAlgebraicLoop(), false);
      const resGS = masterGS.simulate();
      assert.strictEqual(resGS.converged, true);
      assert(resGS.totalSteps > 0);

      // Engine simulation - Jacobi with algebraic loop
      const slaveC = new FmuSlave({ instanceName: 'SlaveC', variables: [{ vr: 1, initial: 1 }] });
      const slaveD = new FmuSlave({ instanceName: 'SlaveD', variables: [{ vr: 1, initial: 1 }] });
      const masterJacobi = new FmiMasterEngine({
        startTime: 0,
        stopTime: 0.02,
        defaultStepSize: 0.01,
        scheme: 'jacobi'
      });
      masterJacobi.addSlave(slaveC);
      masterJacobi.addSlave(slaveD);
      masterJacobi.addConnection(slaveC, 1, slaveD, 1);
      masterJacobi.addConnection(slaveD, 1, slaveC, 1);
      assert.strictEqual(masterJacobi.hasAlgebraicLoop(), true);
      const resJacobi = masterJacobi.simulate();
      assert.strictEqual(resJacobi.converged, true);

      // Test rejection/rollback path
      class RejectingSlave extends FmuSlave {
        doStep(t, h) {
          if (t > 0.005) return false;
          return super.doStep(t, h);
        }
      }
      const rejectingSlave = new RejectingSlave({ instanceName: 'Rej', variables: [{ vr: 1, initial: 0 }] });
      const masterRej = new FmiMasterEngine({
        startTime: 0,
        stopTime: 0.05,
        defaultStepSize: 0.01,
        minStepSize: 0.001
      });
      masterRej.addSlave(rejectingSlave);
      const resRej = masterRej.simulate();
      assert.strictEqual(resRej.converged, false);
      assert(resRej.rejectedSteps > 0);
      passedTests++;
      console.log('  ✓ PASSED: FMI Master Engine and Slaves covered');
    }

    // 2. Assembly BVH Hierarchy
    currentSection = '[2/7] Assembly BVH Hierarchy';
    console.log('\n[2] Assembly BVH Hierarchy...');
    {
      const box = new AABB3D();
      box.expandByPoint({ x: 0, y: 0, z: 0 });
      box.expandByPoint({ x: 10, y: 20, z: 30 });
      assert.strictEqual(box.surfaceArea(), 2 * (200 + 600 + 300));
      assert.deepStrictEqual(box.center(), { x: 5, y: 10, z: 15 });

      const box2 = new AABB3D({ x: 5, y: 5, z: 5 }, { x: 15, y: 25, z: 35 });
      assert.strictEqual(box.intersects(box2), true);
      box.expandByBox(box2);
      assert.strictEqual(box.max.x, 15);

      // Build hierarchy with > 8 parts across 3D axes
      const parts = [];
      for (let i = 0; i < 10; i++) {
        const aabb = new AABB3D({ x: i * 2, y: i * 2, z: i * 2 }, { x: i * 2 + 5, y: i * 2 + 5, z: i * 2 + 5 });
        parts.push({ id: `part_${String(i).padStart(2, '0')}`, aabb });
      }
      const bvh = new AssemblyBVHHierarchy(parts);
      assert(bvh.root !== null);
      const collisions = bvh.findInterferences();
      assert(Array.isArray(collisions));
      assert(collisions.length > 0);
      assert(collisions[0].overlapVolumeAABB > 0);

      const emptyBvh = new AssemblyBVHHierarchy([]);
      assert.deepStrictEqual(emptyBvh.findInterferences(), []);
      passedTests++;
      console.log('  ✓ PASSED: Assembly BVH Hierarchy covered');
    }

    // 3. CAE Quadratic Elements: HEX20 & TET10
    currentSection = '[3/7] CAE Elements HEX20 & TET10';
    console.log('\n[3] CAE Elements: HEX20 & TET10...');
    {
      // HEX20: 20 nodes of a 2x2x2 cube from -1 to 1
      const hexCoords = ElementHEX20.NATURAL_COORDS;
      assert.strictEqual(hexCoords.length, 20);
      const hexNodes = hexCoords.map(([x, y, z]) => ({ x, y, z }));
      const hexElement = new ElementHEX20(
        1,
        Array.from({ length: 20 }, (_, i) => i),
        hexNodes,
        210e9,
        0.3
      );
      assert(hexElement.volume > 0);
      const KeHex = hexElement.computeStiffnessMatrix();
      assert.strictEqual(KeHex.length, 3600);
      const uHex = new Float64Array(60);
      uHex[0] = 0.001; // small displacement on corner 0
      const stressHex = hexElement.computeStress(uHex);
      assert(Number.isFinite(stressHex.vonMises));

      // TET10: 10 nodes of a quadratic tetrahedron
      const tetNodes = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
        // midsides: 0-1, 1-2, 2-0, 0-3, 1-3, 2-3
        { x: 0.5, y: 0, z: 0 },
        { x: 0.5, y: 0.5, z: 0 },
        { x: 0, y: 0.5, z: 0 },
        { x: 0, y: 0, z: 0.5 },
        { x: 0.5, y: 0, z: 0.5 },
        { x: 0, y: 0.5, z: 0.5 }
      ];
      const tetElement = new ElementTET10(
        1,
        Array.from({ length: 10 }, (_, i) => i),
        tetNodes,
        210e9,
        0.3
      );
      assert(tetElement.volume > 0);
      const KeTet = tetElement.computeStiffnessMatrix();
      assert.strictEqual(KeTet.length, 900);
      const uTet = new Float64Array(30);
      uTet[0] = 0.001;
      const stressTet = tetElement.computeStress(uTet);
      assert(Number.isFinite(stressTet.vonMises));
      passedTests++;
      console.log('  ✓ PASSED: HEX20 & TET10 elements covered');
    }

    // 4. Prism Layer Mesher
    currentSection = '[4/7] Prism Layer Mesher';
    console.log('\n[4] Prism Layer Mesher...');
    {
      const yPlusResult = PrismLayerMesher.calculateFirstLayerHeight({
        velocity: 50.0,
        density: 1.225,
        viscosity: 1.8e-5,
        refLength: 1.0,
        targetYPlus: 1.0
      });
      assert(yPlusResult.firstLayerHeightM > 0);
      assert(yPlusResult.reynoldsNumber > 0);

      // Surface mesh: 2 triangles forming a square quad
      const surfaceMesh = {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
          [0, 1, 0]
        ],
        triangles: [
          [0, 1, 2],
          [0, 2, 3]
        ]
      };
      const prismMesh = PrismLayerMesher.generatePrismLayers(surfaceMesh, {
        firstLayerHeight: 0.01,
        growthRatio: 1.2,
        layerCount: 2
      });
      assert.strictEqual(prismMesh.layerCount, 2);
      assert(prismMesh.prisms.length > 0);
      assert(prismMesh.minElementVolume > 0);
      passedTests++;
      console.log('  ✓ PASSED: Prism Layer Mesher covered');
    }

    // 5. Plant Solvers: Wegstein, API 520 PRV, Pinch Targeter
    currentSection = '[5/7] Plant Solvers';
    console.log('\n[5] Plant Solvers: Wegstein, API 520 PRV, Pinch Targeter...');
    {
      // WegsteinRecycleSolver: test wegstein, successive, and broyden
      const fFlowsheet = (x) => [0.1 * x[0] + 0.9, 0.2 * x[1] + 1.6]; // fixed point: x0=1.0, x1=2.0

      const solverWegstein = new WegsteinRecycleSolver({ method: 'wegstein', maxIter: 50 });
      const resWeg = solverWegstein.solve([0, 0], fFlowsheet);
      assert.strictEqual(resWeg.converged, true);
      assert(Math.abs(resWeg.x[0] - 1.0) < 1e-4);

      const solverSucc = new WegsteinRecycleSolver({ method: 'successive', maxIter: 50 });
      const resSucc = solverSucc.solve([0, 0], fFlowsheet);
      assert.strictEqual(resSucc.converged, true);

      const solverBroy = new WegsteinRecycleSolver({ method: 'broyden', maxIter: 50 });
      const resBroy = solverBroy.solve([0, 0], fFlowsheet);
      assert.strictEqual(resBroy.converged, true);

      // Already converged initial guess
      const resImmediate = solverWegstein.solve([1.0, 2.0], fFlowsheet);
      assert.strictEqual(resImmediate.iterations, 0);

      // API 520 Relief Valve
      const gasSizing = Api520ReliefValve.sizeGasVapor({
        massFlow: 5000,
        P1: 1000,
        Pb: 101.3,
        T: 350,
        M: 28.97,
        k: 1.4
      });
      assert(gasSizing.requiredArea_sq_mm > 0);
      assert.ok(gasSizing.selectedOrifice);

      const liquidSizing = Api520ReliefValve.sizeLiquid({
        flowRate: 20,
        P1: 800,
        Pb: 101.3,
        rho: 1000,
        viscosity_cP: 5.0
      });
      assert(liquidSizing.requiredArea_sq_mm > 0);
      assert.ok(liquidSizing.selectedOrifice);

      const twoPhaseSizing = Api520ReliefValve.sizeTwoPhaseOmega({
        massFlow: 4000,
        P1: 1200,
        rho_0: 450,
        rho_9: 200
      });
      assert(twoPhaseSizing.requiredArea_sq_mm > 0);
      assert.ok(twoPhaseSizing.selectedOrifice);

      // Large required area requiring multiple valves
      const multiValve = Api520ReliefValve.selectOrifice(100000);
      assert(multiValve.designation.includes('Multiple'));

      // Pinch Targeter
      const streams = [
        { type: 'hot', Tin: 200, Tout: 80, mCp: 5.0 },
        { type: 'cold', Tin: 50, Tout: 150, mCp: 4.0 }
      ];
      const pinchRes = PinchEnergyTargeter.calculateTargets(streams, 10.0);
      assert(pinchRes.QHminKW >= 0);
      assert(pinchRes.QCminKW >= 0);
      assert(pinchRes.pinchTemperatureHotC > 0);
      passedTests++;
      console.log('  ✓ PASSED: Wegstein, API 520 PRV, Pinch Targeter covered');
    }

    // 6. Optics: NonSequentialTracer, VolumeScattering, ZemaxZmxImporter
    currentSection = '[6/7] Optics Modules';
    console.log('\n[6] Optics Modules...');
    {
      // OpticalRay & NonSequentialTracer
      const ray = new OpticalRay({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 1 }, 1.0, 550.0);
      const splitter = {
        isDetector: false,
        nIncident: 1.0,
        nRefractive: 1.5,
        intersectRay: (r) => {
          if (r.origin.z < 0 && r.dir.z > 0) {
            return { hit: true, distance: -r.origin.z, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: -1 } };
          }
          return null;
        }
      };
      const detector = {
        isDetector: true,
        intersectRay: (r) => {
          if (r.origin.z >= 0 && r.dir.z > 0) {
            return {
              hit: true,
              distance: 10 - r.origin.z,
              point: { x: 0, y: 0, z: 10 },
              normal: { x: 0, y: 0, z: -1 }
            };
          }
          return null;
        }
      };
      const traceRes = NonSequentialTracer.traceBeam(ray, [splitter, detector]);
      assert.strictEqual(traceRes.totalRaysTraced, 3);
      assert.strictEqual(traceRes.detectorHits.length, 1);

      // VolumeScatteringEngine
      const scattIso = VolumeScatteringEngine.sampleHenyeyGreenstein(0.0);
      assert(Number.isFinite(scattIso.cosTheta));
      const scattAniso = VolumeScatteringEngine.sampleHenyeyGreenstein(0.8);
      assert(Number.isFinite(scattAniso.cosTheta));
      const transmitted = VolumeScatteringEngine.evaluateBeerLambert(100.0, 0.05, 10.0);
      assert(transmitted < 100.0 && transmitted > 0);

      // ZemaxZmxImporter
      const sampleZmx = `
! Sample Zemax OpticStudio file
VERS 200115
NAME Singlet Lens
WAVM 1 0.5875618
PWAV 1
SURF 0
  TYPE STANDARD
SURF 1
  TYPE STANDARD
  CURV 0.02
  DISZ 5.0
  GLAS N-BK7
  DIAM 12.5
SURF 2
  TYPE STANDARD
  CURV -0.01
  DISZ 45.0
  GLAS AIR
  DIAM 12.5
SURF 3
  TYPE STANDARD
`;
      const parsedSys = ZemaxZmxImporter.parse(sampleZmx);
      assert.strictEqual(parsedSys.name, 'Singlet Lens');
      assert.strictEqual(parsedSys.surfaces.length, 4);

      const paraxialMissing = ZemaxZmxImporter.evaluateParaxialMetrics(parsedSys);
      assert.strictEqual(paraxialMissing.status, 'unavailable');

      const paraxialValid = ZemaxZmxImporter.evaluateParaxialMetrics(parsedSys, {
        materialIndices: { 'N-BK7': 1.5168 }
      });
      assert.strictEqual(paraxialValid.status, 'experimental');
      assert(paraxialValid.estimatedEflMm > 0);
      passedTests++;
      console.log('  ✓ PASSED: NonSequentialTracer, VolumeScattering, ZemaxZmxImporter covered');
    }

    // 7. Math: Domain Decomposition & Worker Thread Kernel
    currentSection = '[7/7] Domain Decomposition & Worker Thread Kernel';
    console.log('\n[7] Domain Decomposition & Worker Thread Kernel...');
    {
      // DomainDecompositionEngine
      const nodes = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 }
      ];
      const elements = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4]
      ];
      const partitionSingle = DomainDecompositionEngine.partitionMesh(nodes, elements, 1);
      assert.strictEqual(partitionSingle.subdomains.length, 1);

      const partition2 = DomainDecompositionEngine.partitionMesh(nodes, elements, 2);
      assert.strictEqual(partition2.subdomains.length, 2);
      const schur = DomainDecompositionEngine.evaluateSchurDimensions(partition2, 3);
      assert(schur.schurDimension >= 0);

      // Worker Thread Kernel: main thread throw check
      assert.throws(() => require('../src/core/math/worker_thread_kernel'), /must be executed inside a Worker thread/);

      // Worker Thread Kernel: spawn real worker with NODE_V8_COVERAGE inherited
      const kernelScriptPath = path.resolve(__dirname, '../src/core/math/worker_thread_kernel.js');
      const worker = new Worker(kernelScriptPath, { env: process.env });

      try {
        const sendWorkerMessage = (msg) =>
          new Promise((resolve) => {
            const handler = (response) => {
              worker.off('message', handler);
              resolve(response);
            };
            worker.on('message', handler);
            worker.postMessage(msg);
          });

        // PING
        const pong = await sendWorkerMessage({ type: 'PING' });
        assert.strictEqual(pong.type, 'PONG');

        // ECHO_TEST
        const echoRes = await sendWorkerMessage({
          type: 'EXECUTE',
          taskId: 't1',
          taskType: 'ECHO_TEST',
          payload: { message: 'hello-worker' }
        });
        assert.strictEqual(echoRes.type, 'RESULT');
        assert.strictEqual(echoRes.result.echo, 'hello-worker');

        // WASM_SIMD_BLAS - dotProduct
        const dotRes = await sendWorkerMessage({
          type: 'EXECUTE',
          taskId: 't2',
          taskType: 'WASM_SIMD_BLAS',
          payload: {
            operation: 'dotProduct',
            a: [1, 2, 3],
            b: [4, 5, 6]
          }
        });
        assert.strictEqual(dotRes.type, 'RESULT');

        // WASM_SIMD_BLAS - daxpy
        const daxpyRes = await sendWorkerMessage({
          type: 'EXECUTE',
          taskId: 't3',
          taskType: 'WASM_SIMD_BLAS',
          payload: {
            operation: 'daxpy',
            x: [1, 2],
            y: [3, 4],
            alpha: 2
          }
        });
        assert.strictEqual(daxpyRes.type, 'RESULT');

        // WASM_SIMD_BLAS - spmv
        const spmvRes = await sendWorkerMessage({
          type: 'EXECUTE',
          taskId: 't4',
          taskType: 'WASM_SIMD_BLAS',
          payload: {
            operation: 'spmv',
            rowPtr: [0, 1],
            colInd: [0],
            values: [2.0],
            x: [3.0],
            y: [0.0],
            nRows: 1
          }
        });
        assert.strictEqual(spmvRes.type, 'RESULT');

        // WASM_SIMD_BLAS - norm
        const normRes = await sendWorkerMessage({
          type: 'EXECUTE',
          taskId: 't5',
          taskType: 'WASM_SIMD_BLAS',
          payload: {
            operation: 'norm',
            vec: [3, 4]
          }
        });
        assert.strictEqual(normRes.type, 'RESULT');

        // Unsupported task error
        const errRes = await sendWorkerMessage({
          type: 'EXECUTE',
          taskId: 't6',
          taskType: 'UNKNOWN_TASK',
          payload: {}
        });
        assert.strictEqual(errRes.type, 'ERROR');

        // CANCEL
        worker.postMessage({ type: 'CANCEL', taskId: 'dummy' });

        passedTests++;
        console.log('  ✓ PASSED: Domain Decomposition and Worker Thread Kernel covered');
      } finally {
        await worker.terminate();
      }
    }
  } catch (error) {
    failedTests++;
    console.error(`  ✗ FAILED: ${currentSection}`);
    console.error(error?.stack || error);
  }

  const totalTests = passedTests + failedTests;
  console.log('\n================================================================');
  console.log(`   COSIM/BVH COVERAGE: ${passedTests}/${totalTests} sections passed; ${failedTests} failed`);
  console.log('================================================================');
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

if (require.main === module) {
  runCosimBvhCoverageTests()
    .then((stats) => {
      if (stats.failed > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error('Test suite setup failed:', error?.stack || error);
      process.exitCode = 1;
    });
}

module.exports = { runCosimBvhCoverageTests };
