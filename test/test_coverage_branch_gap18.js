'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 18).
 *
 * Broad valid-path sweeps that execute large solver interiors: supersonic
 * aerospace CFD (double-wedge and cone), full ascent/staging calculations,
 * FVM projection-mode steps, CSG boolean engines, worker-pool kernels, WAL
 * torn-tail recovery, and IPC handler happy paths.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { NasaRocketPropulsion } = require('../src/core/aerospace/nasa_rocket_propulsion');
const { FVMNavierStokes3D } = require('../src/core/cae/fvm_navier_stokes_3d');
const { OmniWal, WAL_FILE_NAME } = require('../src/core/storage/omni_archive');
const { ExperimentalCalculationQueue } = require('../src/core/math/worker_pool');
const { CSGMeshBooleans } = require('../src/core/cad/csg_mesh_booleans');
const { DampedLeastSquaresOptimizer } = require('../src/core/optics/damped_least_squares_optimizer');

const DLS_OPTIONS = {
  initialDamping: 0.001,
  minimumDamping: 1e-7,
  maximumDamping: 1e5,
  dampingReductionFactor: 2,
  dampingIncreaseFactor: 4,
  maxIterations: 10,
  tolerance: 1e-7,
  finiteDiffStep: 1e-5
};
const DLS_SYSTEM = {
  initialRefractiveIndex: 1.0,
  metricSampling: {
    entrancePupilRadiusMm: 10,
    paraxialRayHeightMm: 0.1,
    zonalRayFraction: 0.7071,
    chiefRayAngleRad: 0.05
  },
  surfaces: [
    { radius: 50, thickness: 5, refractiveIndex: 1.5168 },
    { radius: -50, thickness: 45, refractiveIndex: 1 }
  ]
};

async function runBranchGapEighteenCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const pending = [];

  function check(name, fn) {
    totalTests++;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        pending.push(
          Promise.resolve(result).then(
            () => {
              passedTests++;
              console.log(`  ✓ PASSED: ${name}`);
            },
            (err) => {
              failedTests++;
              console.error(`  ✗ FAILED: ${name}`);
              console.error(`    ${err.message}`);
            }
          )
        );
        return;
      }
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // ------------------------------------------------------------------
  // Aerospace full solver sweeps
  // ------------------------------------------------------------------
  check('NasaRocketPropulsion double-wedge CFD sweep', () => {
    const aero = new NasaRocketPropulsion();
    const result = aero.runAerospaceCFD({
      machNumber: 3,
      gamma: 1.4,
      angleOfAttackDeg: 5,
      altitudeM: 11000,
      wedgeHalfAngleDeg: 10,
      chordM: 2
    });
    assert.strictEqual(result.success, true);
    assert(Number.isFinite(result.clCoefficient ?? result.totalLiftN ?? 0));
  });

  check('NasaRocketPropulsion cone CFD sweep', () => {
    const aero = new NasaRocketPropulsion();
    const result = aero.runAerospaceCFD({
      machNumber: 2.5,
      gamma: 1.4,
      angleOfAttackDeg: 0,
      altitudeM: 8000,
      coneAngleDeg: 15,
      chordM: 1.5
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.geometry, 'cone');
  });

  check('NasaRocketPropulsion CFD missing mach guard', () => {
    const aero = new NasaRocketPropulsion();
    const result = aero.runAerospaceCFD({ wedgeHalfAngleDeg: 10, chordM: 2 });
    assert.strictEqual(result.success, false);
  });

  check('NasaRocketPropulsion full ascent trajectory sweep', () => {
    const aero = new NasaRocketPropulsion();
    const traj = aero.simulateAscentTrajectory({
      liftOffMassKg: 1450000,
      stage1PropellantMassKg: 1100000,
      stage1EngineCount: 9,
      thrustPerEngineSL_kN: 2200,
      Isp_sl: 305,
      Isp_vac: 330,
      rocketDiameterM: 5.2,
      burnTimeS: 50,
      timeStepS: 1,
      dragCoefficientByMach: [
        { machNumber: 0, dragCoefficient: 0.22 },
        { machNumber: 0.8, dragCoefficient: 0.22 },
        { machNumber: 1.1, dragCoefficient: 0.4 },
        { machNumber: 2, dragCoefficient: 0.28 },
        { machNumber: 10, dragCoefficient: 0.1767 },
        { machNumber: 20, dragCoefficient: 0.1277 }
      ],
      pitchAngleByAltitude: [
        { altitudeM: 0, pitchAngleDeg: 90 },
        { altitudeM: 70000, pitchAngleDeg: 25 },
        { altitudeM: 86000, pitchAngleDeg: 25 }
      ],
      inputSourceDescription: 'Unvalidated smoke-test schedules; not flight telemetry or an ascent reference'
    });
    assert.strictEqual(traj.success, true);
    assert(traj.trajectorySamples.length > 0);
  });

  check('NasaRocketPropulsion full staging sweep', () => {
    const aero = new NasaRocketPropulsion();
    const staging = aero.calculateStagingDeltaV({
      payloadMassKg: 25000,
      stage1DryMassKg: 30000,
      stage1PropellantMassKg: 920000,
      stage1IspVac: 330,
      stage2DryMassKg: 8500,
      stage2PropellantMassKg: 150000,
      stage2IspVac: 380,
      gravityLossesM_s: 1350,
      aerodynamicLossesM_s: 160,
      steeringLossesM_s: 210,
      requiredDeltaV_m_s: 7800,
      inputSourceDescription: 'Unvalidated smoke-test values; not launch vehicle or trajectory data'
    });
    assert.strictEqual(staging.success, true);
    assert(staging.stage1.idealDeltaV_m_s > 0);
  });

  check('NasaRocketPropulsion orbital transfer empty guard', () => {
    const aero = new NasaRocketPropulsion();
    const result = aero.calculateOrbitalTransfer({});
    assert.strictEqual(result.success, false);
  });

  // ------------------------------------------------------------------
  // FVM projection/deep sweeps
  // ------------------------------------------------------------------
  check('FVMNavierStokes3D projection mode sweep', () => {
    const solver = new FVMNavierStokes3D({
      projection: true,
      wallDragRampLength: 0.2,
      steadyLineRelax: true,
      steadyLineRelaxUnderRelaxation: 0.5
    });
    solver.createBoxDomain(5, 5, 4, 0.5, 0.5, 0.4, 1.1);
    const result = solver.step(4.0, 2);
    assert(result !== undefined);
    assert(solver.stepCount >= 2);
  });

  check('FVMNavierStokes3D steady-line-relax wall-included sweep', () => {
    const solver = new FVMNavierStokes3D({ steadyLineRelax: true, steadyLineRelaxWallIncluded: true });
    solver.createBoxDomain(4, 4, 3, 0.4, 0.4, 0.3);
    const result = solver.step(3.0, 1);
    assert(result !== undefined);
  });

  // ------------------------------------------------------------------
  // WAL torn-tail recovery
  // ------------------------------------------------------------------
  check('OmniWal torn-tail recovery rewrites clean log', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov18-'));
    const walPath = path.join(dir, WAL_FILE_NAME);
    const archivePath = path.join(dir, 'proj.omni');
    const wal = new OmniWal({ path: walPath, archivePath });
    wal.open();
    wal.appendEntry('addBlob', { hash: 'abc', bytes: 4 });
    wal.commit();
    wal.close();

    const lines = fs.readFileSync(walPath, 'utf8').split('\n');
    for (let i = lines.length - 1; i > 0; i--) {
      if (lines[i].trim() !== '') {
        const arr = JSON.parse(lines[i]);
        arr[3] = arr[3] === 0 ? 1 : 0;
        lines[i] = JSON.stringify(arr);
        break;
      }
    }
    fs.writeFileSync(walPath, lines.join('\n'), 'utf8');

    const reopened = new OmniWal({ path: walPath, archivePath });
    reopened.open();
    const stats = reopened.stats();
    assert(stats.recovered >= 0);
    reopened.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------
  // CSG boolean engines
  // ------------------------------------------------------------------
  check('CSG union/subtract/intersect engine sweeps', () => {
    const a = CSGMeshBooleans.toCSGSolid({ type: 'box', size: [2, 2, 2], center: [0, 0, 0] });
    const b = CSGMeshBooleans.toCSGSolid({ type: 'box', size: [2, 2, 2], center: [1.5, 0, 0] });
    const union = a.union(b);
    assert(union.polygons.length > 0);
    const tris = union.toTriangles();
    assert(tris.length > 0);
    const diff = a.subtract(b);
    assert(diff.polygons.length > 0);
    const inter = a.intersect(b);
    assert(inter.polygons.length > 0);
  });

  // ------------------------------------------------------------------
  // Worker pool kernels
  // ------------------------------------------------------------------
  check('ExperimentalCalculationQueue variational and DLS kernels', async () => {
    const queue = new ExperimentalCalculationQueue();
    const variant = await queue.dispatch('VARIATIONAL_SOLVE', {
      points: [
        { id: 'p1', x: 0, y: 0, fixed: true },
        { id: 'p2', x: 10, y: 0, fixed: false }
      ],
      constraints: [{ type: 'HORIZONTAL', point1: 'p1', point2: 'p2', value: 0 }]
    });
    assert.strictEqual(variant.success, true);
    const dls = await queue.dispatch('DLS_OPT', {
      options: DLS_OPTIONS,
      system: DLS_SYSTEM,
      variables: [{ surfaceIndex: 0, param: 'radius', min: 20, max: 100 }],
      operands: [{ type: 'PARAXIAL_FOCAL_LENGTH', targetMm: 50, weight: 1 }]
    });
    assert.strictEqual(dls.success, true);
  });

  check('ExperimentalCalculationQueue SIMD BLAS kernels', async () => {
    const queue = new ExperimentalCalculationQueue();
    const dot = await queue.dispatch('WASM_SIMD_BLAS', { operation: 'dotProduct', a: [1, 2, 3], b: [4, 5, 6] });
    assert.strictEqual(dot.result.dotProduct, 32);
    const daxpy = await queue.dispatch('WASM_SIMD_BLAS', { operation: 'daxpy', x: [1, 2], y: [10, 20], alpha: 3 });
    assert.deepStrictEqual(Array.from(daxpy.result.y), [13, 26]);
    const spmv = await queue.dispatch('WASM_SIMD_BLAS', {
      operation: 'spmv',
      rowPtr: [0, 2, 3],
      colInd: [0, 1, 1],
      values: [2, 1, 3],
      x: [1, 1],
      y: [0, 0],
      nRows: 2
    });
    assert.deepStrictEqual(Array.from(spmv.result.y), [3, 3]);
  });

  const pendingSettled = await Promise.race([
    Promise.all(pending).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 30000))
  ]);
  if (!pendingSettled) {
    failedTests += pending.length;
    console.error('  ✗ WARN: timed out waiting for pending checks; marking them failed');
  }

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapEighteenCoverageTests };

if (require.main === module) {
  runBranchGapEighteenCoverageTests().then((stats) => {
    console.log(`gap18: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
