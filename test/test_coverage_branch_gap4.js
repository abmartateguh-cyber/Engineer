'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 4).
 *
 * Robotics / manipulator / adapter branches plus optics helpers. All checks
 * execute real production code paths and assert observable behavior.
 */

const assert = require('assert');

const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const {
  SerialManipulatorEngine,
  PUMA_560_DH,
  UR5E_DH,
  rpyToRot3,
  quaternionToRot3
} = require('../src/core/robotics/serial_manipulator_kinematics');
const { DampedLeastSquaresOptimizer } = require('../src/core/optics/damped_least_squares_optimizer');
const { SkewRayTracer } = require('../src/core/optics/skew_ray_tracer');
const { OpticsEngineAdapter } = require('../src/core/optics/optics_engine_adapter');
const { OmniError } = require('../src/core/contracts/OmniError');

async function runBranchGapFourCoverageTests() {
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

  const rejects = async (fn) => {
    try {
      await fn();
    } catch (err) {
      return err;
    }
    return null;
  };

  // ---------------------------------------------------------------
  // Robotics engine adapter validation branches
  // ---------------------------------------------------------------
  check('RoboticsEngineAdapter validation branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    assert((await rejects(() => adapter.validate(null))) instanceof OmniError);
    assert(
      (await rejects(() => adapter.validate({ domain: 'plant', operation: 'x', parameters: {} }))) instanceof OmniError
    );
    assert((await rejects(() => adapter.validate({ domain: 'robotics', parameters: {} }))) instanceof OmniError);
    assert(
      (await rejects(() => adapter.validate({ domain: 'robotics', operation: 'fly', parameters: {} }))) instanceof
        OmniError
    );
    assert(
      (await rejects(() =>
        adapter.validate({
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { preset: 'PUMA_560', q: [0, 0] }
        })
      )) instanceof OmniError
    );
    assert(
      (await rejects(() =>
        adapter.validate({
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { preset: 'PUMA_560', q: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], qd: [0, 0] }
        })
      )) instanceof OmniError
    );
    assert(
      (await rejects(() =>
        adapter.validate({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: { preset: 'PUMA_560', targetPose: { position: [0.2, 0.2, 0.2] }, q0: [0, 0] }
        })
      )) instanceof OmniError
    );
    assert(
      (await rejects(() =>
        adapter.validate({ domain: 'robotics', operation: 'inverse_kinematics', parameters: { preset: 'PUMA_560' } })
      )) instanceof OmniError
    );
    assert(
      (await rejects(() =>
        adapter.validate({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: { preset: 'PUMA_560', targetPose: { position: [0.2, NaN, 0.2] } }
        })
      )) instanceof OmniError
    );
    assert(
      (await rejects(() =>
        adapter.validate({ domain: 'robotics', operation: 'inverse_dynamics', parameters: { preset: 'PUMA_560' } })
      )) instanceof OmniError
    );
    assert(
      (await rejects(() =>
        adapter.validate({
          domain: 'robotics',
          operation: 'trajectory_plan',
          parameters: { q0: [0, 0], qf: [1, 1], duration: 0 }
        })
      )) instanceof OmniError
    );
    assert(
      (await rejects(() =>
        adapter.validate({ domain: 'robotics', operation: 'parse_urdf', parameters: { urdf: '' } })
      )) instanceof OmniError
    );
    assert(
      (await rejects(() =>
        adapter.validate({ domain: 'robotics', operation: 'parse_urdf', parameters: { urdf: '<robot>' } })
      )) instanceof OmniError
    );
  });

  check('RoboticsEngineAdapter URDF and PoE execute branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    const urdf =
      '<robot name="r1"><link name="base"/><link name="l1"/><joint name="j1" type="revolute"><parent link="base"/><child link="l1"/><origin xyz="0 0 0.2" rpy="0 0 0"/><axis xyz="0 0 1"/></joint></robot>';
    const out = await adapter.execute(
      { jobId: 'u1', domain: 'robotics', operation: 'forward_kinematics', parameters: { urdf, q: [0.3] } },
      () => {},
      null
    );
    assert.strictEqual(out.status, 'COMPLETED');

    const poe = await adapter.execute(
      {
        jobId: 'p1',
        domain: 'robotics',
        operation: 'forward_kinematics',
        parameters: {
          screwAxes: [
            [0, 0, 1, 0, 0, 0],
            [0, 0, 1, 0, 0, 0]
          ],
          homeTransform: [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0.4],
            [0, 0, 0, 1]
          ],
          q: [0.2, 0.3]
        }
      },
      () => {},
      null
    );
    assert.strictEqual(poe.status, 'COMPLETED');
  });

  check('RoboticsEngineAdapter inverse kinematics execute branch', async () => {
    const adapter = new RoboticsEngineAdapter();
    const out = await adapter.execute(
      {
        jobId: 'ik1',
        domain: 'robotics',
        operation: 'inverse_kinematics',
        parameters: {
          preset: 'PUMA_560',
          targetPose: {
            position: [0.4, 0.1, 0.3],
            rotation: [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1]
            ]
          },
          q0: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
        }
      },
      () => {},
      null
    );
    assert.strictEqual(out.status, 'COMPLETED');
  });

  check('RoboticsEngineAdapter trajectory execute branch', async () => {
    const adapter = new RoboticsEngineAdapter();
    const out = await adapter.execute(
      {
        jobId: 'tr1',
        domain: 'robotics',
        operation: 'trajectory_plan',
        parameters: {
          preset: 'PUMA_560',
          q0: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
          qf: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
          duration: 1.0,
          v0: [0, 0, 0, 0, 0, 0],
          vf: [0, 0, 0, 0, 0, 0]
        }
      },
      () => {},
      null
    );
    assert.strictEqual(out.status, 'COMPLETED');
  });

  check('RoboticsEngineAdapter parse_urdf execute branch', async () => {
    const adapter = new RoboticsEngineAdapter();
    const out = await adapter.execute(
      {
        jobId: 'pu1',
        domain: 'robotics',
        operation: 'parse_urdf',
        parameters: {
          urdf: '<robot name="r1"><link name="base"/><link name="l1"/><joint name="j1" type="revolute"><parent link="base"/><child link="l1"/><origin xyz="0 0 0.2" rpy="0 0 0"/><axis xyz="0 0 1"/></joint></robot>'
        }
      },
      () => {},
      null
    );
    assert.strictEqual(out.status, 'COMPLETED');
  });

  // ---------------------------------------------------------------
  // Serial manipulator helpers
  // ---------------------------------------------------------------
  check('SerialManipulatorEngine rotation helper branches', () => {
    const R = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
    const matrixEqual = (a, b) => a.every((row, i) => row.every((v, j) => Math.abs(v - b[i][j]) < 1e-12));
    assert(matrixEqual(rpyToRot3(0, 0, 0), R));
    const q = quaternionToRot3([1, 0, 0, 0]);
    assert(matrixEqual(q, R));
    const rpy = rpyToRot3(0.2, -0.1, 0.3);
    assert(rpy.every((row) => row.every(Number.isFinite)));
  });

  check('SerialManipulatorEngine inverse kinematics branches', () => {
    const identity = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
    const ik = SerialManipulatorEngine.inverseKinematics(
      PUMA_560_DH,
      { position: [0.4, 0.1, 0.3], rotation: identity },
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      { maxIterations: 50 }
    );
    assert(ik && typeof ik === 'object');
    assert.throws(
      () => SerialManipulatorEngine.inverseKinematics(null, { position: [0, 0, 0] }, [0]),
      /kinematic chain/
    );
    assert.throws(
      () => SerialManipulatorEngine.inverseKinematics(PUMA_560_DH, { position: [0.1, 0.2] }, [0, 0, 0, 0, 0, 0]),
      /3-element/
    );
    assert.throws(
      () =>
        SerialManipulatorEngine.inverseKinematics(PUMA_560_DH, { position: [0.1, 0.2, Infinity] }, [0, 0, 0, 0, 0, 0]),
      /3-element/
    );
    const ikMatrix = SerialManipulatorEngine.inverseKinematics(
      PUMA_560_DH,
      [
        [1, 0, 0, 0.4],
        [0, 1, 0, 0.1],
        [0, 0, 1, 0.3],
        [0, 0, 0, 1]
      ],
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      { maxIterations: 50 }
    );
    assert(ikMatrix && typeof ikMatrix === 'object');
  });

  check('SerialManipulatorEngine inverse dynamics and mass matrix branches', () => {
    const links = [
      { mass: 4, com: [0, 0, 0.05], inertia: { ixx: 0.1, iyy: 0.1, izz: 0.05, ixy: 0, ixz: 0, iyz: 0 } },
      { mass: 3, com: [0, 0, 0.04], inertia: { ixx: 0.08, iyy: 0.08, izz: 0.04, ixy: 0, ixz: 0, iyz: 0 } },
      { mass: 2, com: [0, 0, 0.03], inertia: { ixx: 0.05, iyy: 0.05, izz: 0.02, ixy: 0, ixz: 0, iyz: 0 } },
      { mass: 1, com: [0, 0, 0.02], inertia: { ixx: 0.02, iyy: 0.02, izz: 0.01, ixy: 0, ixz: 0, iyz: 0 } },
      { mass: 0.8, com: [0, 0, 0.015], inertia: { ixx: 0.01, iyy: 0.01, izz: 0.005, ixy: 0, ixz: 0, iyz: 0 } },
      { mass: 0.5, com: [0, 0, 0.01], inertia: { ixx: 0.005, iyy: 0.005, izz: 0.002, ixy: 0, ixz: 0, iyz: 0 } }
    ];
    const q = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    const qd = [0, 0, 0, 0, 0, 0];
    const qdd = [0, 0, 0, 0, 0, 0];
    const gravity = [0, 0, -9.81];
    const id = SerialManipulatorEngine.inverseDynamics(PUMA_560_DH, q, qd, qdd, links, gravity, [0, 0, 0, 0, 0, 0]);
    assert(id && Array.isArray(id.torques));
    assert.strictEqual(id.torques.length, 6);
    const M = SerialManipulatorEngine.computeMassMatrix(PUMA_560_DH, links, q);
    assert(M && M.length === 6 && M[0].length === 6);
    assert.throws(
      () => SerialManipulatorEngine.inverseDynamics(null, q, qd, qdd, links, gravity, [0, 0, 0, 0, 0, 0]),
      /kinematic chain/
    );
    assert.throws(
      () => SerialManipulatorEngine.inverseDynamics(PUMA_560_DH, q, qd, qdd, links, gravity, [0, 0, 0, 0, 0]),
      /six-component/
    );
    assert.throws(
      () => SerialManipulatorEngine.inverseDynamics(PUMA_560_DH, [0], qd, qdd, links, gravity, [0, 0, 0, 0, 0, 0]),
      /joint positions q of length 6/
    );
    assert.throws(
      () => SerialManipulatorEngine.inverseDynamics(PUMA_560_DH, q, [0], qdd, links, gravity, [0, 0, 0, 0, 0, 0]),
      /joint velocities qd of length 6/
    );
    assert.throws(
      () => SerialManipulatorEngine.inverseDynamics(PUMA_560_DH, q, qd, [0], links, gravity, [0, 0, 0, 0, 0, 0]),
      /joint accelerations/
    );
    assert.throws(
      () => SerialManipulatorEngine.inverseDynamics(PUMA_560_DH, q, qd, qdd, links, [0, 0], [0, 0, 0, 0, 0, 0]),
      /gravity/
    );
    assert.throws(
      () =>
        SerialManipulatorEngine.inverseDynamics(
          PUMA_560_DH,
          q,
          qd,
          qdd,
          links.slice(0, 3),
          gravity,
          [0, 0, 0, 0, 0, 0]
        ),
      /linkInertias/
    );
    assert.throws(
      () =>
        SerialManipulatorEngine.inverseDynamics(
          PUMA_560_DH,
          q,
          qd,
          qdd,
          links.map((l) => ({ ...l, mass: -1 })),
          gravity,
          [0, 0, 0, 0, 0, 0]
        ),
      /mass/
    );
  });

  check('SerialManipulatorEngine URDF prismatic and fixed branches', () => {
    const urdf =
      '<robot name="r2"><link name="base"/><link name="s1"/><link name="s2"/><joint name="j1" type="prismatic"><parent link="base"/><child link="s1"/><origin xyz="0 0 0" rpy="0 0 0"/><axis xyz="0 0 1"/></joint><joint name="j2" type="fixed"><parent link="s1"/><child link="s2"/><origin xyz="0.1 0 0" rpy="0 0 0"/></joint></robot>';
    const parsed = SerialManipulatorEngine.parseURDF(urdf);
    assert(parsed && typeof parsed === 'object');
    const fk = SerialManipulatorEngine.forwardKinematics(parsed.dhTable, [0.2]);
    assert(fk && typeof fk === 'object');
  });

  // ---------------------------------------------------------------
  // Damped least squares optimizer validation branches
  // ---------------------------------------------------------------
  check('DampedLeastSquaresOptimizer validation and error branches', () => {
    const system = {
      surfaces: [
        { radius: 100, thickness: 5, refractiveIndex: 1.0 },
        { radius: -80, thickness: 50, refractiveIndex: 1.5 },
        { radius: -300, thickness: 0, refractiveIndex: 1.0 }
      ],
      initialRefractiveIndex: 1.0,
      metricSampling: { entrancePupilRadiusMm: 5, paraxialRayHeightMm: 5, zonalRayFraction: 0.7, chiefRayAngleRad: 0 }
    };
    const curvatureSystem = {
      surfaces: [
        { curvature: 0.01, thickness: 5, refractiveIndex: 1.0 },
        { curvature: -0.0125, thickness: 50, refractiveIndex: 1.5 },
        { curvature: 0, thickness: 0, refractiveIndex: 1.0 }
      ],
      initialRefractiveIndex: 1.0,
      metricSampling: { entrancePupilRadiusMm: 5, paraxialRayHeightMm: 5, zonalRayFraction: 0.7, chiefRayAngleRad: 0 }
    };
    const fullOpts = {
      initialDamping: 1,
      minimumDamping: 0.1,
      maximumDamping: 10,
      dampingReductionFactor: 2,
      dampingIncreaseFactor: 2,
      maxIterations: 8,
      tolerance: 1e-6,
      finiteDiffStep: 0.1
    };
    assert.throws(() => new DampedLeastSquaresOptimizer(null), /options/);
    assert.throws(() => new DampedLeastSquaresOptimizer([]), /options/);

    const optimizer = new DampedLeastSquaresOptimizer(fullOpts);
    const vars = [{ surfaceIndex: 0, param: 'radius', min: 90, max: 110, value: 100 }];
    const ops = [{ type: 'PARAXIAL_FOCAL_LENGTH', targetMm: 50, weight: 1 }];
    assert.throws(
      () => new DampedLeastSquaresOptimizer({ ...fullOpts, dampingIncreaseFactor: 1 }).optimize(system, vars, ops),
      /dampingIncreaseFactor/
    );
    assert.throws(
      () => new DampedLeastSquaresOptimizer({ ...fullOpts, dampingReductionFactor: 1 }).optimize(system, vars, ops),
      /dampingReductionFactor/
    );
    assert.throws(
      () => new DampedLeastSquaresOptimizer({ ...fullOpts, minimumDamping: 20 }).optimize(system, vars, ops),
      /damping bounds/
    );
    assert.throws(
      () => new DampedLeastSquaresOptimizer({ ...fullOpts, initialDamping: 100 }).optimize(system, vars, ops),
      /initialDamping/
    );
    assert.throws(
      () => new DampedLeastSquaresOptimizer({ ...fullOpts, tolerance: -1 }).optimize(system, vars, ops),
      /tolerance/
    );
    assert.throws(
      () => new DampedLeastSquaresOptimizer({ ...fullOpts, finiteDiffStep: 2 }).optimize(system, vars, ops),
      /finiteDiffStep/
    );
    assert.throws(
      () => new DampedLeastSquaresOptimizer({ ...fullOpts, maxIterations: 0 }).optimize(system, vars, ops),
      /maxIterations/
    );
    assert.throws(
      () => new DampedLeastSquaresOptimizer({ ...fullOpts, maxIterations: NaN }).optimize(system, vars, ops),
      /maxIterations/
    );
    assert.throws(() => optimizer.evaluateSystemMetrics(null), /two surfaces/);
    assert.throws(() => optimizer.evaluateSystemMetrics({ surfaces: [] }), /two surfaces/);
    assert.throws(
      () => optimizer.evaluateSystemMetrics({ surfaces: [{}, {}, {}], initialRefractiveIndex: 0 }),
      /initialRefractiveIndex/
    );
    assert.throws(
      () =>
        optimizer.evaluateSystemMetrics({
          surfaces: [
            { curvature: 0, thickness: 0, refractiveIndex: 0 },
            { curvature: 0, thickness: 0, refractiveIndex: 0 }
          ],
          initialRefractiveIndex: 1
        }),
      /refractiveIndex/
    );
    assert.throws(
      () =>
        optimizer.evaluateSystemMetrics({
          surfaces: [
            { curvature: 0, thickness: 0, refractiveIndex: 1 },
            { curvature: 0, thickness: 0, refractiveIndex: 1 }
          ],
          initialRefractiveIndex: 1
        }),
      /metricSampling/
    );
    assert.throws(
      () =>
        optimizer.evaluateSystemMetrics({
          ...system,
          metricSampling: { ...system.metricSampling, entrancePupilRadiusMm: 0 }
        }),
      /entrancePupilRadiusMm/
    );
    assert.throws(
      () =>
        optimizer.evaluateSystemMetrics({
          ...system,
          metricSampling: { ...system.metricSampling, paraxialRayHeightMm: 0 }
        }),
      /paraxialRayHeightMm/
    );
    assert.throws(
      () =>
        optimizer.evaluateSystemMetrics({
          ...system,
          metricSampling: { ...system.metricSampling, zonalRayFraction: 2 }
        }),
      /zonalRayFraction/
    );
    assert.throws(
      () =>
        optimizer.evaluateSystemMetrics({
          ...system,
          metricSampling: { ...system.metricSampling, chiefRayAngleRad: NaN }
        }),
      /chiefRayAngleRad/
    );
    assert.throws(() => optimizer.traceMeridionalRay(system, NaN, 0), /rayHeightMm/);
    assert.throws(() => optimizer.traceMeridionalRay(system, 5, NaN), /rayHeightMm/);
    assert.throws(() => optimizer.evaluateMeritFunction(system, null), /merit operand/);
    assert.throws(() => optimizer.evaluateMeritFunction(system, [null]), /must be an object/);
    assert.throws(() => optimizer.evaluateMeritFunction(system, [{ targetMm: 50 }]), /unsupported type/);
    assert.throws(
      () => optimizer.evaluateMeritFunction(system, [{ type: 'PARAXIAL_FOCAL_LENGTH', targetMm: 50, weight: 0 }]),
      /weight/
    );
    assert.throws(
      () => optimizer.evaluateMeritFunction(system, [{ type: 'PARAXIAL_FOCAL_LENGTH', targetMm: NaN, weight: 1 }]),
      /targetMm/
    );
    const curvatureOk = optimizer.evaluateSystemMetrics(curvatureSystem);
    assert(typeof curvatureOk === 'object');

    const missingOpt = new DampedLeastSquaresOptimizer({});
    assert.throws(() => missingOpt.optimize(system, [], []), /initialDamping/);
    assert.throws(() => optimizer.optimize(null, [], []), /two surfaces/);
    assert.throws(() => optimizer.optimize(system, [], ops), /bounded optimization variable/);
    assert.throws(
      () => optimizer.optimize(system, [{ surfaceIndex: 3, param: 'radius', min: 90, max: 110, value: 100 }], ops),
      /outside the system/
    );
    const badVar = [{ surfaceIndex: 0, param: 'bogus', min: 90, max: 110, value: 100 }];
    assert.throws(() => optimizer.optimize(system, badVar, ops), /param/);
    assert.throws(
      () => optimizer.optimize(system, [{ surfaceIndex: 0, param: 'radius', min: 110, max: 90, value: 100 }], ops),
      /min/
    );
    assert.throws(
      () =>
        optimizer.optimize(
          system,
          [
            { surfaceIndex: 0, param: 'radius', min: 90, max: 110, value: 100 },
            { surfaceIndex: 0, param: 'radius', min: 90, max: 110, value: 100 }
          ],
          ops
        ),
      /more than once/
    );
    assert.throws(
      () => optimizer.optimize(system, [{ surfaceIndex: 0, param: 'thickness', min: -1, max: 10, value: 5 }], ops),
      /thickness/
    );
    assert.throws(
      () => optimizer.optimize(system, [{ surfaceIndex: 0, param: 'radius', min: 0, max: 110, value: 100 }], ops),
      /cross zero/
    );
  });

  // ---------------------------------------------------------------
  // Skew ray tracer validation branches
  // ---------------------------------------------------------------
  check('SkewRayTracer trace branches', () => {
    const surface = {
      radius: 100,
      zVertex: 0,
      conic: 0,
      clearRadius: 10,
      nIncident: 1,
      nTransmitted: 1.5,
      asphericCoeffs: [0, 0, 0, 0]
    };
    const ray = SkewRayTracer.createRay([0, 0, -20], [0, 0, 1], 0.5, 1);
    const out = SkewRayTracer.traceRayThroughSurface(ray, surface, 0);
    assert(out && typeof out === 'object');
    assert.throws(() => SkewRayTracer.traceRayThroughSurface(ray, { ...surface, radius: NaN }, 0), /radius/);
    assert.throws(() => SkewRayTracer.traceRayThroughSurface(ray, { ...surface, zVertex: NaN }, 0), /zVertex/);
    assert.throws(() => SkewRayTracer.traceRayThroughSurface(ray, { ...surface, conic: NaN }, 0), /conic/);
    assert.throws(
      () => SkewRayTracer.traceRayThroughSurface(ray, { ...surface, nIncident: 0 }, 0),
      /incident and transmitted/
    );
    const miss = SkewRayTracer.createRay([0, 0, -20], [0.5, 0.5, 1], 0.5, 1);
    const missed = SkewRayTracer.traceRayThroughSurface(miss, { ...surface, clearRadius: 1 }, 0);
    assert.strictEqual(missed.isTerminated, true);
    const tir = SkewRayTracer.createRay([0, 0, -20], [0.866, 0, 0.5], 0.5, 1.5);
    const tirOut = SkewRayTracer.traceRayThroughSurface(
      tir,
      { ...surface, radius: 0, zVertex: -15, nIncident: 1.5, nTransmitted: 1 },
      0
    );
    assert.strictEqual(tirOut.isTIR, true);
  });

  check('SkewRayTracer traceOpticalSystem and MTF branches', () => {
    const surfaces = [
      {
        radius: 100,
        zVertex: 0,
        conic: 0,
        clearRadius: 10,
        nIncident: 1,
        nTransmitted: 1.5,
        asphericCoeffs: [0, 0, 0, 0]
      },
      {
        radius: -80,
        zVertex: 5,
        conic: 0,
        clearRadius: 10,
        nIncident: 1.5,
        nTransmitted: 1,
        asphericCoeffs: [0, 0, 0, 0]
      }
    ];
    const rays = [SkewRayTracer.createRay([0, 0, -20], [0, 0, 1], 0.5, 1)];
    const traced = SkewRayTracer.traceOpticalSystem(surfaces, rays, 50);
    assert(traced && Array.isArray(traced));
    const mtf = SkewRayTracer.computeMTFCurve(0.01, 4, 100, 587.6);
    assert(mtf && Array.isArray(mtf.frequencies));
    assert(mtf.mtf50TangentialLpMm === 0 || Number.isFinite(mtf.mtf50TangentialLpMm));
    assert.throws(() => SkewRayTracer.computeMTFCurve(-1, 4, 100, 587.6), /RMS spot radius/);
    assert.throws(() => SkewRayTracer.computeMTFCurve(0.01, 0, 100, 587.6), /F-number/);
    assert.throws(() => SkewRayTracer.computeMTFCurve(0.01, 4, 0, 587.6), /Maximum spatial frequency/);
    assert.throws(() => SkewRayTracer.computeMTFCurve(0.01, 4, 100, 0), /Wavelength/);
  });

  // ---------------------------------------------------------------
  // Optics adapter remaining validation branches
  // ---------------------------------------------------------------
  check('OpticsEngineAdapter validation branches', async () => {
    const adapter = new OpticsEngineAdapter();
    assert((await rejects(() => adapter.validate(null))) !== null);
    assert((await rejects(() => adapter.validate({ domain: 'plant', operation: 'x', parameters: {} }))) !== null);
    assert((await rejects(() => adapter.validate({ domain: 'optics', operation: 'nope', parameters: {} }))) !== null);
    const validPupil = await adapter.validate({
      domain: 'optics',
      operation: 'generate_pupil_rays',
      parameters: {
        surfaces: [
          {
            radius: 100,
            zVertex: 0,
            clearRadius: 10,
            nIncident: 1,
            nTransmitted: 1.5,
            conic: 0,
            asphericCoeffs: [0, 0, 0, 0]
          }
        ],
        pupilRadiusMm: 5,
        numRings: 2,
        raysPerRing: 6,
        fieldAngleDeg: 0,
        wavelengthUm: 0.58756
      }
    });
    assert.strictEqual(validPupil, true);
  });

  await Promise.all(pending);

  console.log('\n================================================================');
  console.log(`   BRANCH-GAP-4 RESULTS: ${passedTests}/${totalTests} passed; ${failedTests} failed`);
  console.log('================================================================');
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapFourCoverageTests };

if (require.main === module) {
  runBranchGapFourCoverageTests().then((stats) => {
    if (stats.failed > 0) process.exitCode = 1;
  });
}
