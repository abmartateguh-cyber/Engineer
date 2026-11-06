'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 15).
 *
 * Targets remaining uncovered non-entry blocks in robotics kinematics,
 * aerospace propulsion, sparse/ODE math solvers, plant flowsheet solving,
 * VOF multiphase advection, and skew ray tracing.
 */

const assert = require('assert');

const { SerialManipulatorEngine, PUMA_560_DH, UR5E_DH } = require('../src/core/robotics/serial_manipulator_kinematics');
const { NasaRocketPropulsion, solveNozzleExitMach } = require('../src/core/aerospace/nasa_rocket_propulsion');
const { GPUParallelPCGSolver } = require('../src/core/math/gpu_parallel_pcg_solver');
const { ODESolvers, RadauIIA } = require('../src/core/math/ode_solvers');
const { VOFMultiphaseSolver } = require('../src/core/cae/vof_multiphase_solver');
const { ProcessStream, ProcessFlowsheetSolver } = require('../src/core/plant/process_flowsheet_solver');
const { SkewRayTracer } = require('../src/core/optics/skew_ray_tracer');
const { getExperimentalThermoProperties } = require('./support/experimental_property_examples');

const VOF_FLUIDS = { surfaceTensionNPerM: 0.07, rho1: 1000, rho2: 1.2, mu1: 1e-3, mu2: 1.8e-5 };

async function runBranchGapFifteenCoverageTests() {
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
  // Serial manipulator kinematics
  // ------------------------------------------------------------------
  check('SerialManipulatorEngine PoE angle-count validation', () => {
    assert.throws(
      () =>
        SerialManipulatorEngine.forwardKinematicsPoE(
          [[0, 0, 1, 0, 0, 0]],
          [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1]
          ],
          [0.1, 0.2]
        ),
      /requires 1 joint angles/
    );
  });

  check('SerialManipulatorEngine PoE dispatch via object with q', () => {
    const screw = [0, 0, 1, 0, 0, 0];
    const M = [
      [1, 0, 0, 0.5],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
    const fk = SerialManipulatorEngine.forwardKinematics({ screwAxes: [screw], homeTransform: M, q: [0.4] });
    assert.strictEqual(fk.convention, 'poe');
    assert(Math.abs(fk.position[0] - 0.5 * Math.cos(0.4)) < 1e-9);
    assert(Math.abs(fk.position[1] - 0.5 * Math.sin(0.4)) < 1e-9);
  });

  check('SerialManipulatorEngine PoE dispatch via string convention', () => {
    const screw = [0, 0, 1, 0.1, 0, 0];
    const M = [
      [1, 0, 0, 0.2],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
    const fk = SerialManipulatorEngine.forwardKinematics({ screwAxes: [screw], homeTransform: M }, [0.2], 'poe');
    assert.strictEqual(fk.convention, 'poe');
    assert(fk.position.every(Number.isFinite));
  });

  check('SerialManipulatorEngine PoE uses identity home transform default', () => {
    const screw = [0, 0, 1, 0, 0, 0];
    const fk = SerialManipulatorEngine.forwardKinematicsPoE([screw], undefined, [0]);
    assert.deepStrictEqual(fk.position, [0, 0, 0]);
  });

  check('SerialManipulatorEngine forwardKinematics object with jointAngles', () => {
    const fk = SerialManipulatorEngine.forwardKinematics({ dhTable: PUMA_560_DH, jointAngles: [0, 0, 0, 0, 0, 0] });
    assert.strictEqual(fk.convention, 'standard_dh');
    assert.strictEqual(fk.jacobian[0].length, 6);
  });

  check('SerialManipulatorEngine forwardKinematics rejects empty dhTable', () => {
    assert.throws(
      () => SerialManipulatorEngine.forwardKinematics([], []),
      /DH table array cannot be empty|requires a non-empty dhTable/
    );
  });

  check('SerialManipulatorEngine forwardKinematics rejects angle-count mismatch', () => {
    assert.throws(
      () => SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, [0, 0, 0]),
      /requires an array of 6 finite joint angles/
    );
  });

  check('SerialManipulatorEngine forwardKinematics URDF revolute/prismatic/fixed rows', () => {
    const chain = [
      { urdfOrigin: { xyz: [0, 0, 0], rpy: [0, 0, 0] }, urdfAxis: [0, 0, 1], type: 'revolute' },
      { urdfOrigin: { xyz: [0.2, 0, 0], rpy: [0, Math.PI / 2, 0] }, urdfAxis: [0, 1, 0], type: 'prismatic' },
      { urdfAxis: [1, 0, 0], type: 'fixed' }
    ];
    const fk = SerialManipulatorEngine.forwardKinematics(chain, [0.3, 0.1, 0]);
    assert(Number.isFinite(fk.position[0]));
    assert.strictEqual(fk.jacobian[3][1], 0);
    assert.strictEqual(fk.jacobian[3][2], 0);
  });

  check('SerialManipulatorEngine forwardKinematics modified-DH row convention', () => {
    const row = { joint: 1, a: 1, alpha: 0.5, d: 0.2, theta: 0.1, offset: 0.3, convention: 'mdh' };
    const fk = SerialManipulatorEngine.forwardKinematics([row], [0.4]);
    assert(Math.abs(fk.position[0] - 1) < 1e-9);
    assert(Math.abs(fk.position[1] + 0.2 * Math.sin(0.5)) < 1e-9);
    assert(Math.abs(fk.position[2] - 0.2 * Math.cos(0.5)) < 1e-9);
  });

  check('SerialManipulatorEngine forwardKinematics thetaOffset and default convention', () => {
    const row = { joint: 1, a: 0.5, alpha: 0, d: 0, thetaOffset: 0.2 };
    const fk = SerialManipulatorEngine.forwardKinematics([row], [0.1]);
    assert(Math.abs(fk.position[0] - 0.5 * Math.cos(0.3)) < 1e-9);
    assert.strictEqual(fk.convention, 'standard_dh');
  });

  check('SerialManipulatorEngine computeGeometricJacobian string preset', () => {
    const j = SerialManipulatorEngine.computeGeometricJacobian('PUMA_560', [0, 0, 0, 0, 0, 0]);
    assert.strictEqual(j.jacobian.length, 6);
    assert(Number.isFinite(j.manipulabilityIndex));
  });

  check('SerialManipulatorEngine inverseKinematics legacy positional signature', () => {
    const zeros = [0, 0, 0, 0, 0, 0];
    const home = SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, zeros);
    const ik = SerialManipulatorEngine.inverseKinematics(PUMA_560_DH, home.endEffectorPose, zeros, { damping: 0 });
    assert(Array.isArray(ik.jointAngles) || Array.isArray(ik.q));
  });

  check('SerialManipulatorEngine inverseKinematics position-only target', () => {
    const zeros = [0, 0, 0, 0, 0, 0];
    const home = SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, zeros);
    const ik = SerialManipulatorEngine.inverseKinematics({
      dhTable: PUMA_560_DH,
      targetPosition: home.position,
      initialGuess: zeros
    });
    assert(Number.isFinite(ik.finalResidualNorm ?? ik.residualNorm ?? ik.errorNorm ?? 0));
  });

  check('SerialManipulatorEngine inverseKinematics rejects invalid targetOrientation', () => {
    assert.throws(
      () =>
        SerialManipulatorEngine.inverseKinematics({
          dhTable: PUMA_560_DH,
          targetPosition: [0.3, 0, 0.5],
          targetOrientation: 'bad'
        }),
      /Invalid targetOrientation/
    );
  });

  check('SerialManipulatorEngine inverseKinematics rpy-object orientation', () => {
    const ik = SerialManipulatorEngine.inverseKinematics({
      dhTable: PUMA_560_DH,
      targetPosition: [0.3, 0.1, 0.5],
      targetOrientation: { rpy: { roll: 0.1, pitch: 0.2, yaw: 0.3 } },
      maxIterations: 30
    });
    assert(Array.isArray(ik.jointAngles) || Array.isArray(ik.q));
  });

  check('SerialManipulatorEngine computeOrientationError zero-error branch', () => {
    const err = SerialManipulatorEngine.computeOrientationError(
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ],
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ]
    );
    assert.deepStrictEqual(err, [0, 0, 0]);
  });

  check('SerialManipulatorEngine inverseKinematics with damping zero fallback', () => {
    const zeros = [0, 0, 0, 0, 0, 0];
    const home = SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, zeros);
    const ik = SerialManipulatorEngine.inverseKinematics(PUMA_560_DH, home.endEffectorPose, zeros, { damping: 0 });
    assert(Array.isArray(ik.jointAngles) || Array.isArray(ik.q));
    assert(Number.isFinite(ik.finalResidualNorm ?? ik.residualNorm ?? 1));
  });

  check('SerialManipulatorEngine UR5E preset table properties', () => {
    assert.strictEqual(UR5E_DH.dof, 6);
    assert.strictEqual(UR5E_DH.dhTable.length, 6);
    assert.strictEqual(typeof UR5E_DH.name, 'string');
  });

  // ------------------------------------------------------------------
  // NASA rocket propulsion
  // ------------------------------------------------------------------
  check('NasaRocketPropulsion combustion missing-input branches', () => {
    const aero = new NasaRocketPropulsion();
    assert.strictEqual(aero.evaluateCombustionEquilibrium().error.code, 'INVALID_INPUT');
    assert.strictEqual(aero.evaluateCombustionEquilibrium('', 300, 3.6).error.code, 'INVALID_INPUT');
    assert.strictEqual(aero.evaluateCombustionEquilibrium('LOX_LCH4', -1, 3.6).error.code, 'INVALID_INPUT');
    assert.strictEqual(aero.evaluateCombustionEquilibrium('LOX_LCH4', 300, 0).error.code, 'INVALID_INPUT');
    assert.match(
      aero.evaluateCombustionEquilibrium('NOT_A_PROPELLANT', 300, 3.6).error.message,
      /supported propellantType/
    );
  });

  check('NasaRocketPropulsion solveNozzleExitMach unit-area short-circuit', () => {
    const aero = new NasaRocketPropulsion();
    assert.strictEqual(aero.solveNozzleExitMach(1.0, 1.22), 1.0);
  });

  check('NasaRocketPropulsion standalone Mach inversion out-of-range', () => {
    assert.throws(() => solveNozzleExitMach(1e9, 1.22), /outside the supported/);
  });

  check('NasaRocketPropulsion engine performance invalid inputs', () => {
    const aero = new NasaRocketPropulsion();
    const invalid = aero.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 300,
      ofRatio: 3.6,
      throatDiameterM: -1,
      expansionRatio: 35,
      ambientPressureBar: 1.01325
    });
    assert.strictEqual(invalid.success, false);
    assert.match(invalid.error.message, /throatDiameterM/);
  });

  check('NasaRocketPropulsion cooling missing-input branches', () => {
    const aero = new NasaRocketPropulsion();
    const perf = aero.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 300,
      ofRatio: 3.6,
      throatDiameterM: 0.1,
      expansionRatio: 35,
      ambientPressureBar: 1.01325
    });
    const missing = aero.calculateBartzRegenerativeCooling(perf);
    assert.strictEqual(missing.success, false);
    assert(missing.error.code === 'INVALID_INPUT');
  });

  check('NasaRocketPropulsion turbopump missing-input branches', () => {
    const aero = new NasaRocketPropulsion();
    const perf = aero.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 300,
      ofRatio: 3.6,
      throatDiameterM: 0.1,
      expansionRatio: 35,
      ambientPressureBar: 1.01325
    });
    const missing = aero.calculateTurbopumpSystem(perf, {});
    assert.strictEqual(missing.success, false);
    const badEfficiency = aero.calculateTurbopumpSystem(
      perf,
      {},
      {
        fuelDensityKgM3: 422,
        oxidizerDensityKgM3: 1141,
        fuelPumpEfficiency: 0.81,
        oxidizerPumpEfficiency: 2.0
      }
    );
    assert.strictEqual(badEfficiency.success, false);
  });

  check('NasaRocketPropulsion ascent atmosphere-range error', () => {
    const aero = new NasaRocketPropulsion();
    const traj = aero.simulateAscentTrajectory({
      liftOffMassKg: 1450000,
      stage1PropellantMassKg: 1100000,
      stage1EngineCount: 9,
      thrustPerEngineSL_kN: 2200,
      Isp_sl: 305,
      Isp_vac: 330,
      rocketDiameterM: 5.2,
      burnTimeS: 140,
      timeStepS: 1,
      dragCoefficientByMach: [
        { machNumber: 0, dragCoefficient: 0.22 },
        { machNumber: 20, dragCoefficient: 0.1277 }
      ],
      pitchAngleByAltitude: [
        { altitudeM: 0, pitchAngleDeg: 90 },
        { altitudeM: 86000, pitchAngleDeg: 25 }
      ]
    });
    assert.strictEqual(traj.success, false);
  });

  check('NasaRocketPropulsion ascent drag-schedule range error', () => {
    const aero = new NasaRocketPropulsion();
    const traj = aero.simulateAscentTrajectory({
      liftOffMassKg: 1450000,
      stage1PropellantMassKg: 1100000,
      stage1EngineCount: 9,
      thrustPerEngineSL_kN: 2200,
      Isp_sl: 305,
      Isp_vac: 330,
      rocketDiameterM: 5.2,
      burnTimeS: 140,
      timeStepS: 1,
      dragCoefficientByMach: [{ machNumber: 0, dragCoefficient: 0.22 }],
      pitchAngleByAltitude: [
        { altitudeM: 0, pitchAngleDeg: 90 },
        { altitudeM: 86000, pitchAngleDeg: 25 }
      ],
      inputSourceDescription: 'Unvalidated smoke-test schedules; not flight telemetry or an ascent reference'
    });
    assert.strictEqual(traj.success, false);
    assert.match(traj.error.message, /dragCoefficientByMach/);
  });

  check('NasaRocketPropulsion isogrid invalid input', () => {
    const aero = new NasaRocketPropulsion();
    const result = aero.calculateIsogridTankBuckling({});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'INVALID_INPUT');
  });

  check('NasaRocketPropulsion nozzle compile missing-input branch', () => {
    const aero = new NasaRocketPropulsion();
    const result = aero.compileRocketNozzle({});
    assert.strictEqual(result.success, false);
    assert.match(result.error.message, /chamberPressurePa/);
  });

  check('NasaRocketPropulsion nozzle compile catches Mach inversion failure', () => {
    const aero = new NasaRocketPropulsion();
    const result = aero.compileRocketNozzle({
      chamberPressurePa: 1e7,
      expansionRatio: 1e9,
      throatRadiusM: 0.05,
      gamma: 1.01,
      chamberTempK: 3000
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'NUMERICAL_FAILURE');
  });

  check('NasaRocketPropulsion aerospace CFD altitude failure', () => {
    const aero = new NasaRocketPropulsion();
    const result = aero.runAerospaceCFD({ altitudeM: 1e9 });
    assert.strictEqual(result.success, false);
  });

  check('NasaRocketPropulsion staging empty input', () => {
    const aero = new NasaRocketPropulsion();
    const result = aero.calculateStagingDeltaV({});
    assert.strictEqual(result.success, false);
  });

  check('NasaRocketPropulsion subsystem registry and spacecraft spec fail closed', () => {
    const aero = new NasaRocketPropulsion();
    assert.deepStrictEqual(aero.getNasaSubsystemEntities(), []);
    const spec = aero.getNasaSpacecraftInteriorSpecification();
    assert.strictEqual(spec.success, false);
    assert.strictEqual(spec.error.code, 'UNSUPPORTED');
  });

  check('NasaRocketPropulsion schedule validation helpers', () => {
    const aero = new NasaRocketPropulsion();
    assert.strictEqual(
      aero._validateLinearSchedule(
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 }
        ],
        's',
        'x',
        'y',
        0,
        100
      ),
      's starting at x=0'
    );
    assert.match(
      aero._validateLinearSchedule(
        [
          { x: 0, y: -1 },
          { x: 1, y: 2 }
        ],
        's',
        'x',
        'y',
        0,
        100
      ),
      /finite, increasing x values/
    );
    assert.strictEqual(
      aero._interpolateLinearSchedule(
        [
          { x: 0, y: 1 },
          { x: 10, y: 2 }
        ],
        'x',
        'y',
        -1
      ),
      null
    );
    assert.strictEqual(
      aero._interpolateLinearSchedule(
        [
          { x: 0, y: 1 },
          { x: 10, y: 2 }
        ],
        'x',
        'y',
        99
      ),
      null
    );
    assert.strictEqual(
      aero._interpolateLinearSchedule(
        [
          { x: 0, y: 1 },
          { x: 10, y: 2 }
        ],
        'x',
        'y',
        5
      ),
      1.5
    );
  });

  // ------------------------------------------------------------------
  // GPU parallel PCG
  // ------------------------------------------------------------------
  check('GPUParallelPCGSolver dense solve and residual', () => {
    const solver = new GPUParallelPCGSolver({ maxWorkers: 1, useSharedArrayBuffer: false });
    const A = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2]
    ];
    const b = [5, 5, 3];
    const r = solver.solve(A, b);
    assert.strictEqual(r.converged, true);
    assert(Math.abs(r.solution[0] - 1) < 1e-6);
    assert(Math.abs(r.solution[1] - 1) < 1e-6);
    assert(Math.abs(r.solution[2] - 1) < 1e-6);
  });

  check('GPUParallelPCGSolver CSR typed-array input and x0', () => {
    const solver = new GPUParallelPCGSolver({ maxWorkers: 1, tolerance: 1e-8 });
    const n = 3;
    const rowPtr = new Int32Array([0, 2, 4, 6]);
    const colIdx = new Int32Array([0, 1, 0, 1, 1, 2]);
    const values = new Float64Array([4, 1, 1, 3, 1, 2]);
    const r = solver.solve({ n, rowPtr, colIdx, values }, [5, 5, 3], [0, 0, 0]);
    assert(r.solution[0] > 0.5 && r.solution[0] < 1.5);
    assert(r.solution[1] > 0.5 && r.solution[1] < 1.5);
    assert(r.solution[2] > 0.5 && r.solution[2] < 1.5);
    assert(r.terminationReason === 'tolerance-reached' || r.terminationReason === 'maximum-iterations');
  });

  check('GPUParallelPCGSolver zero right-hand side', () => {
    const solver = new GPUParallelPCGSolver({ maxWorkers: 1 });
    const r = solver.solve(
      [
        [4, 1],
        [1, 3]
      ],
      [0, 0]
    );
    assert.strictEqual(r.converged, true);
    assert(Math.abs(r.solution[0]) < 1e-12);
  });

  check('GPUParallelPCGSolver options validation', () => {
    assert.throws(() => new GPUParallelPCGSolver({ bogus: true }), /does not support/);
    assert.throws(() => new GPUParallelPCGSolver({ maxIterations: 0 }), /positive integer/);
    assert.throws(() => new GPUParallelPCGSolver({ tolerance: 2 }), /between zero and one/);
  });

  check('GPUParallelPCGSolver dense matrix validation', () => {
    const solver = new GPUParallelPCGSolver({ maxWorkers: 1 });
    assert.throws(() => solver.solve([], [1]), /square dense matrix or CSR data/);
    assert.throws(() => solver.solve([[1, 2]], [1, 2]), /must be square/);
    assert.throws(
      () =>
        solver.solve(
          [
            [1, Number.NaN],
            [0, 1]
          ],
          [1, 1]
        ),
      /finite/
    );
  });

  check('GPUParallelPCGSolver CSR consistency validation', () => {
    const solver = new GPUParallelPCGSolver({ maxWorkers: 1 });
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1], colIdx: [0, 0], values: [1, 1] }, [1, 1]),
      /consistent lengths/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [0, 5], values: [1, 1] }, [1, 1]),
      /valid matrix columns/
    );
  });

  check('GPUParallelPCGSolver missing positive diagonal error', () => {
    const solver = new GPUParallelPCGSolver({ maxWorkers: 1 });
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [1, 0], values: [1, 1] }, [1, 1]),
      /finite positive diagonal/
    );
  });

  check('GPUParallelPCGSolver non-positive curvature termination', () => {
    const solver = new GPUParallelPCGSolver({ maxWorkers: 1, maxIterations: 5, tolerance: 1e-14 });
    const r = solver.solve(
      [
        [2, 5],
        [5, 2]
      ],
      [1, 0]
    );
    assert.strictEqual(r.terminationReason, 'non-positive-curvature');
  });

  check('GPUParallelPCGSolver rhs and initial-guess validation', () => {
    const solver = new GPUParallelPCGSolver({ maxWorkers: 1 });
    assert.throws(
      () =>
        solver.solve(
          [
            [2, 0],
            [0, 2]
          ],
          [1]
        ),
      /one finite number per matrix row/
    );
    assert.throws(
      () =>
        solver.solve(
          [
            [2, 0],
            [0, 2]
          ],
          [1, 1],
          [0]
        ),
      /one finite number per matrix row/
    );
  });

  // ------------------------------------------------------------------
  // ODE solvers
  // ------------------------------------------------------------------
  check('ODESolvers solveRK45 explicit tolerance and initial step', () => {
    const f = (t, y) => [-2 * y[0]];
    const traj = ODESolvers.solveRK45(f, [1], 0, 1, 0.1, 1e-8, 0.01);
    assert(Math.abs(traj.at(-1).y[0] - Math.exp(-2)) < 1e-5);
  });

  check('RadauIIA solve decay with custom options', () => {
    const solver = new RadauIIA({
      rtol: 1e-8,
      atol: 1e-10,
      h0: 0.05,
      safety: 0.85,
      minFactor: 0.15,
      maxFactor: 4.0,
      newtonMaxIter: 10
    });
    const traj = solver.solve((t, y) => [-y[0]], 0, [1], 1);
    assert(Math.abs(traj.at(-1).y[0] - Math.exp(-1)) < 1e-5);
  });

  check('RadauIIA rejects non-positive h0', () => {
    const solver = new RadauIIA({ h0: 0 });
    assert.throws(() => solver.solve((t, y) => [-y[0]], 0, [1], 1), /positive initial step/);
  });

  check('RadauIIA rejects invalid bounds and tolerances', () => {
    const solver = new RadauIIA({ rtol: -1 });
    assert.throws(() => solver.solve((t, y) => [-y[0]], 0, [1], 1), /positive rtol and atol/);
    const solver2 = new RadauIIA();
    assert.throws(() => solver2.solve((t, y) => [-y[0]], 1, [1], 0), /t0 <= tEnd/);
  });

  check('RadauIIA stiff decay advances several steps', () => {
    const solver = new RadauIIA({ h0: 1e-3, rtol: 1e-8, atol: 1e-10 });
    const traj = solver.solve((t, y) => [-50 * y[0]], 0, [1], 0.2);
    assert(traj.length > 2);
    assert(Math.abs(traj.at(-1).y[0] - Math.exp(-10)) < 1e-4);
  });

  check('ODESolvers solveRK45 handles zero-length integration', () => {
    const f = (t, y) => [-y[0]];
    const traj = ODESolvers.solveRK45(f, [1], 0, 0, 0.1);
    assert.strictEqual(traj[0].t, 0);
  });

  // ------------------------------------------------------------------
  // VOF multiphase
  // ------------------------------------------------------------------
  check('VOFMultiphaseSolver advect clipping and boundary sweeps', () => {
    const vof = new VOFMultiphaseSolver(VOF_FLUIDS);
    const nx = 6;
    const ny = 6;
    const C = new Float64Array(nx * ny);
    for (let i = 2; i < 5; i++) for (let j = 2; j < 5; j++) C[j * nx + i] = 1.0;
    const u = new Float64Array(nx * ny).fill(0.3);
    const v = new Float64Array(nx * ny).fill(-0.2);
    const res = vof.advect(C, u, v, 0.01, { nx, ny, dx: 0.1, dy: 0.1 });
    assert(Number.isFinite(res.massErrorRel));
    assert(res.clipsApplied >= 0);
    let total = 0;
    for (let k = 0; k < C.length; k++) total += C[k];
    assert(total > 0);
  });

  check('VOFMultiphaseSolver advect zero-velocity sweep', () => {
    const vof = new VOFMultiphaseSolver(VOF_FLUIDS);
    const nx = 4;
    const ny = 4;
    const C = new Float64Array(nx * ny).fill(0.5);
    const u = new Float64Array(nx * ny);
    const v = new Float64Array(nx * ny);
    const res = vof.advect(C, u, v, 0.01, { nx, ny, dx: 0.1, dy: 0.1 });
    assert.strictEqual(res.clipsApplied, 0);
  });

  check('VOFMultiphaseSolver dam-break small grid with fit', () => {
    const vof = new VOFMultiphaseSolver(VOF_FLUIDS);
    const sim = vof.simulateDamBreak({
      columnWidth: 0.146,
      columnHeight: 0.292,
      timeSec: 0.05,
      gridX: 32,
      maxSteps: 200
    });
    assert(sim.trace.length > 0);
    assert(Number.isFinite(sim.massConservationErrorPercent));
    assert(Number.isFinite(sim.wavefrontPositionX));
  });

  check('VOFMultiphaseSolver dam-break negative-time guard', () => {
    const vof = new VOFMultiphaseSolver(VOF_FLUIDS);
    assert.throws(
      () => vof.simulateDamBreak({ columnWidth: 1, columnHeight: 1, timeSec: -0.1 }),
      /non-negative evaluation time/
    );
  });

  check('VOFMultiphaseSolver mixture and curvature helpers', () => {
    const vof = new VOFMultiphaseSolver(VOF_FLUIDS);
    const mix = vof.getMixtureProperties(0.5);
    assert(mix.density > 0);
    assert(mix.viscosity > 0);
    const grid = new Float64Array(25).fill(0.5);
    const curve = vof.computeInterfaceCurvature(grid, 5, 5, 0.1);
    assert(Number.isFinite(curve.kappa[0]));
    const stepped = new Float64Array(25);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) stepped[j * 5 + i] = i < 3 ? 1 : 0;
    const interfaces = vof.reconstructInterfaces(stepped, { nx: 5, ny: 5, dx: 0.1, dy: 0.1 });
    assert(Number.isFinite(interfaces.normalsX[0]));
    assert(Number.isFinite(interfaces.intercepts[0]));
  });

  // ------------------------------------------------------------------
  // Process flowsheet solver
  // ------------------------------------------------------------------
  check('ProcessStream positional and bar-based options', () => {
    const s = new ProcessStream('S1', 'Feed', 25, 500, 100, { A: 0.6, B: 0.4 }, 0.5);
    assert.strictEqual(s.name, 'Feed');
    assert.strictEqual(s.enthalpyKjKmol, undefined);
    const withBar = new ProcessStream('S2', {
      name: 'Bar',
      temperatureC: 30,
      pressureBar: 5,
      molarFlowKmolH: 10,
      composition: { A: 1 },
      vaporFraction: 0
    });
    assert.strictEqual(withBar.P_kPa, 500);
    const withEnthalpy = new ProcessStream('S3', {
      temperatureC: 30,
      pressureKPa: 500,
      molarFlowKmolH: 10,
      composition: { A: 1 },
      vaporFraction: 0,
      enthalpyKjKmol: 12.5
    });
    assert.strictEqual(withEnthalpy.enthalpyKjKmol, 12.5);
  });

  check('ProcessStream rejects non-finite enthalpy', () => {
    assert.throws(
      () =>
        new ProcessStream('S1', {
          temperatureC: 25,
          pressureKPa: 100,
          molarFlowKmolH: 1,
          composition: { A: 1 },
          vaporFraction: 0,
          enthalpyKjKmol: Number.NaN
        }),
      /finite enthalpyKjKmol/
    );
  });

  check('ProcessFlowsheetSolver simple no-recycle solve', () => {
    const f = new ProcessFlowsheetSolver();
    f.addStream(
      new ProcessStream('S1', {
        temperatureC: 25,
        pressureKPa: 500,
        molarFlowKmolH: 100,
        composition: { A: 1 },
        vaporFraction: 0
      })
    );
    f.addStream(
      new ProcessStream('S2', {
        temperatureC: 25,
        pressureKPa: 500,
        molarFlowKmolH: 100,
        composition: { A: 1 },
        vaporFraction: 0
      })
    );
    f.addMixer('MIX', ['S1'], 'S2');
    const sol = f.solve(20, 1e-6);
    assert.strictEqual(sol.success, true);
    assert.strictEqual(sol.status, 'computed');
  });

  check('ProcessFlowsheetSolver splitter split-fraction mismatch', () => {
    const f = new ProcessFlowsheetSolver();
    f.addStream(
      new ProcessStream('IN', {
        temperatureC: 25,
        pressureKPa: 500,
        molarFlowKmolH: 100,
        composition: { A: 1 },
        vaporFraction: 0
      })
    );
    f.addStream(
      new ProcessStream('OUT1', {
        temperatureC: 25,
        pressureKPa: 500,
        molarFlowKmolH: 70,
        composition: { A: 1 },
        vaporFraction: 0
      })
    );
    f.addStream(
      new ProcessStream('OUT2', {
        temperatureC: 25,
        pressureKPa: 500,
        molarFlowKmolH: 30,
        composition: { A: 1 },
        vaporFraction: 0
      })
    );
    f.addSplitter('SP', 'IN', 'OUT1', 'OUT2', { splitRatio: 0.5 });
    const sol = f.solve(10, 1e-6);
    assert.strictEqual(sol.success, true);
    assert.strictEqual(f.getStream('OUT1').molarFlowKmolH, 50);
  });

  check('ProcessFlowsheetSolver solve invalid parameters', () => {
    const f = new ProcessFlowsheetSolver();
    const r = f.solve(0, 1e-4);
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.status, 'invalid-input');
  });

  check('ProcessFlowsheetSolver uninitialized recycle stream error', () => {
    const f = new ProcessFlowsheetSolver();
    f.addStream(
      new ProcessStream('S1', {
        temperatureC: 25,
        pressureKPa: 500,
        molarFlowKmolH: 100,
        composition: { A: 1 },
        vaporFraction: 0
      })
    );
    f.markRecycleStream('MISSING');
    const r = f.solve(10, 1e-4);
    assert.strictEqual(r.success, false);
  });

  check('ProcessFlowsheetSolver flash drum with pressureBar config', () => {
    const f = new ProcessFlowsheetSolver();
    const componentProperties = getExperimentalThermoProperties(['Methane', 'Propane', 'nPentane']);
    f.addStream(
      new ProcessStream('FEED', {
        temperatureC: 90,
        pressureKPa: 400,
        molarFlowKmolH: 100,
        composition: { Methane: 0.2, Propane: 0.5, nPentane: 0.3 },
        vaporFraction: 0
      })
    );
    f.addStream(
      new ProcessStream('VAP', {
        temperatureC: 90,
        pressureKPa: 400,
        molarFlowKmolH: 40,
        composition: { Methane: 0.4, Propane: 0.4, nPentane: 0.2 },
        vaporFraction: 1
      })
    );
    f.addStream(
      new ProcessStream('LIQ', {
        temperatureC: 90,
        pressureKPa: 400,
        molarFlowKmolH: 60,
        composition: { Methane: 0.1, Propane: 0.5, nPentane: 0.4 },
        vaporFraction: 0
      })
    );
    f.addFlashDrum('FLASH', 'FEED', 'VAP', 'LIQ', { pressureBar: 4, temperatureC: 90, componentProperties });
    const sol = f.solve(20, 1e-6);
    assert.strictEqual(sol.success, true);
  });

  check('ProcessFlowsheetSolver mixer zero-flow error', () => {
    const f = new ProcessFlowsheetSolver();
    f.addStream(
      new ProcessStream('S1', {
        temperatureC: 25,
        pressureKPa: 500,
        molarFlowKmolH: 0,
        composition: { A: 1 },
        vaporFraction: 0
      })
    );
    f.addStream(
      new ProcessStream('S2', {
        temperatureC: 25,
        pressureKPa: 500,
        molarFlowKmolH: 0,
        composition: { A: 1 },
        vaporFraction: 0
      })
    );
    f.addStream(
      new ProcessStream('OUT', {
        temperatureC: 25,
        pressureKPa: 500,
        molarFlowKmolH: 0,
        composition: { A: 1 },
        vaporFraction: 0
      })
    );
    f.addMixer('MIX', ['S1', 'S2'], 'OUT');
    const sol = f.solve(5, 1e-6);
    assert.strictEqual(sol.success, false);
  });

  // ------------------------------------------------------------------
  // Skew ray tracer
  // ------------------------------------------------------------------
  check('SkewRayTracer createRay validation', () => {
    assert.throws(() => SkewRayTracer.createRay([0, 0], [0, 0, 1], 0.55, 1), /three finite millimeter coordinates/);
    assert.throws(() => SkewRayTracer.createRay([0, 0, 0], [0, 0], 0.55, 1), /three finite components/);
    assert.throws(() => SkewRayTracer.createRay([0, 0, 0], [0, 0, 1], 0, 1), /finite positive value in micrometers/);
    assert.throws(() => SkewRayTracer.createRay([0, 0, 0], [0, 0, 1], 0.55, -1), /nonnegative value/);
    assert.throws(() => SkewRayTracer.createRay([0, 0, 0], [0, 0, 0], 0.55, 1), /nonzero magnitude/);
  });

  check('SkewRayTracer flat surface behind-ray termination', () => {
    const ray = SkewRayTracer.createRay([0, 0, 0], [0, 0, 1], 0.55, 1);
    const out = SkewRayTracer.traceRayThroughSurface(ray, {
      radius: 0,
      zVertex: -10,
      conic: 0,
      asphericCoeffs: [0, 0, 0, 0],
      nIncident: 1,
      nTransmitted: 1.5,
      clearRadius: 10
    });
    assert.strictEqual(out.isTerminated, true);
  });

  check('SkewRayTracer sphere miss termination and aspheric path', () => {
    const ray = SkewRayTracer.createRay([0, 30, 0], [0, 0, 1], 0.55, 1);
    const surface = {
      radius: 50,
      zVertex: 0,
      conic: 0,
      asphericCoeffs: [1e-6, 0, 0, 0],
      nIncident: 1,
      nTransmitted: 1.5,
      clearRadius: 20
    };
    const out = SkewRayTracer.traceRayThroughSurface(ray, surface);
    assert.strictEqual(out.isTerminated, true);
    const aspheric = SkewRayTracer.createRay([0, 0, -40], [0, 0, 1], 0.55, 1);
    const hit = SkewRayTracer.traceRayThroughSurface(aspheric, surface);
    assert.strictEqual(hit.isTerminated, false);
    assert(hit.path.length > 1);
  });

  check('SkewRayTracer total internal reflection', () => {
    const ray = SkewRayTracer.createRay([0, 0, -10], [0.8, 0, 0.6], 0.55, 1);
    const surface = {
      radius: 0,
      zVertex: 0,
      conic: 0,
      asphericCoeffs: [0, 0, 0, 0],
      nIncident: 1.5,
      nTransmitted: 1.0,
      clearRadius: 50
    };
    const out = SkewRayTracer.traceRayThroughSurface(ray, surface);
    assert.strictEqual(out.isTIR, true);
  });

  check('SkewRayTracer pupil grid validation', () => {
    assert.throws(
      () => SkewRayTracer.generatePupilRayGrid(10, 0, 8, 0, 0.55, -10),
      /Pupil ring count must be an explicit integer from 1 through 20/
    );
    assert.throws(
      () => SkewRayTracer.generatePupilRayGrid(10, 3, 0, 0, 0.55, -10),
      /Rays per ring must be an explicit integer from 1 through 64/
    );
    assert.throws(
      () => SkewRayTracer.generatePupilRayGrid(10, 3, 8, 90, 0.55, -10),
      /Field angle must be an explicit finite value from -89 through 89 degrees/
    );
    assert.throws(
      () => SkewRayTracer.generatePupilRayGrid(10, 3, 8, 0, 0, -10),
      /Wavelength must be a finite positive value in micrometers/
    );
  });

  check('SkewRayTracer computeSpotDiagram empty result', () => {
    const terminated = SkewRayTracer.createRay([0, 0, 0], [0, 0, 1], 0.55, 1);
    terminated.isTerminated = true;
    const spot = SkewRayTracer.computeSpotDiagram([terminated]);
    assert.strictEqual(spot.count, 0);
  });

  check('SkewRayTracer computeMTFCurve cutoff branch', () => {
    const mtf = SkewRayTracer.computeMTFCurve(0.01, 1.4, 120, 587.5618);
    assert(mtf.cutoffFreqLpMm > 1000);
    assert.strictEqual(mtf.frequencies.length, 31);
    const high = SkewRayTracer.computeMTFCurve(0.05, 20, 120, 587.5618);
    assert(high.tangentialMTF.some((v) => v === 0));
  });

  check('SkewRayTracer traceRay with point/direction arrays', () => {
    const surfaces = [
      {
        radius: 40,
        zVertex: 0,
        conic: 0,
        asphericCoeffs: [0, 0, 0, 0],
        nIncident: 1,
        nTransmitted: 1.5,
        clearRadius: 20
      },
      {
        radius: 0,
        zVertex: 10,
        conic: 0,
        asphericCoeffs: [0, 0, 0, 0],
        nIncident: 1.5,
        nTransmitted: 1,
        clearRadius: 20
      }
    ];
    const segments = SkewRayTracer.traceRay(surfaces, {
      origin: [0, 0, -30],
      dir: [0, 0, 1],
      wavelengthUm: 0.55,
      intensity: 1
    });
    assert(segments.length > 2);
    assert.strictEqual(segments[0].p.z, -30);
  });

  check('SkewRayTracer traceRay surface radius and zVertex validation', () => {
    const rayInput = { origin: [0, 0, -10], dir: [0, 0, 1], wavelengthUm: 0.55, intensity: 1 };
    assert.throws(
      () =>
        SkewRayTracer.traceRay(
          [{ zVertex: 0, conic: 0, asphericCoeffs: [0, 0, 0, 0], nIncident: 1, nTransmitted: 1.5, clearRadius: 5 }],
          rayInput
        ),
      /needs a finite explicit radius/
    );
    assert.throws(
      () =>
        SkewRayTracer.traceRay(
          [{ radius: 10, conic: 0, asphericCoeffs: [0, 0, 0, 0], nIncident: 1, nTransmitted: 1.5, clearRadius: 5 }],
          rayInput
        ),
      /zVertex must be finite/
    );
  });

  check('SkewRayTracer traceOpticalSystem sensor and index validation', () => {
    const ray = SkewRayTracer.createRay([0, 0, -20], [0, 0, 1], 0.55, 1);
    const surfaces = [
      {
        radius: 0,
        zVertex: 0,
        conic: 0,
        asphericCoeffs: [0, 0, 0, 0],
        nIncident: 1,
        nTransmitted: 1.5,
        clearRadius: 10
      }
    ];
    const out = SkewRayTracer.traceOpticalSystem(surfaces, [ray], 0);
    assert.strictEqual(out[0].isTerminated, true);
    assert.throws(
      () => SkewRayTracer.traceOpticalSystem([], [SkewRayTracer.createRay([0, 0, -20], [0, 0, 1], 0.55, 1)], 30),
      /At least one explicit optical surface/
    );
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

module.exports = { runBranchGapFifteenCoverageTests };

if (require.main === module) {
  runBranchGapFifteenCoverageTests().then((stats) => {
    console.log(`gap15: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
