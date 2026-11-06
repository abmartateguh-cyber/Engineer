'use strict';

const assert = require('assert');
const { SerialManipulatorEngine } = require('../src/core/robotics/serial_manipulator_kinematics');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');

const PLANAR_TWO_LINK = [
  { a: 1, alpha: 0, d: 0 },
  { a: 1, alpha: 0, d: 0 }
];

function near(actual, expected, tolerance, label) {
  assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} differs from ${expected}`);
}

async function runRoboticsContractTests() {
  let passed = 0;
  const adapter = new RoboticsEngineAdapter();

  const fk = SerialManipulatorEngine.forwardKinematics(PLANAR_TWO_LINK, [0, Math.PI / 2]);
  near(fk.position[0], 1, 1e-12, 'planar x');
  near(fk.position[1], 1, 1e-12, 'planar y');
  near(fk.jacobian[0][0], -1, 1e-12, 'Jacobian dx/dq1');
  near(fk.jacobian[0][1], -1, 1e-12, 'Jacobian dx/dq2');
  near(fk.jacobian[1][0], 1, 1e-12, 'Jacobian dy/dq1');
  near(fk.jacobian[1][1], 0, 1e-12, 'Jacobian dy/dq2');

  const noVelocity = await adapter.execute({
    jobId: 'robotics-fk-no-speed',
    domain: 'robotics',
    operation: 'forward_kinematics',
    parameters: { dhTable: PLANAR_TWO_LINK, q: [0, Math.PI / 2] }
  });
  assert.strictEqual(noVelocity.outputData.endEffectorLinearSpeed, null);
  assert.strictEqual(noVelocity.outputData.endEffectorAngularSpeed, null);
  assert.strictEqual(noVelocity.outputData.conditionNumber, null);
  assert.strictEqual(noVelocity.validationMaturity, 'experimental');
  assert.strictEqual(noVelocity.outputData.validation.reviewer, '');
  assert.deepStrictEqual(noVelocity.resultArtifactHashes, []);

  const withVelocity = await adapter.execute({
    jobId: 'robotics-fk-with-speed',
    domain: 'robotics',
    operation: 'forward_kinematics',
    parameters: { dhTable: PLANAR_TWO_LINK, q: [0, Math.PI / 2], qd: [1, 0] }
  });
  near(withVelocity.outputData.endEffectorLinearSpeed.valueSi, Math.SQRT2, 1e-12, 'tip speed');
  near(withVelocity.outputData.endEffectorAngularSpeed.valueSi, 1, 1e-12, 'angular speed');
  passed++;

  const reference = SerialManipulatorEngine.forwardKinematics(PLANAR_TWO_LINK, [0.4, 0.7]);
  const ik = await adapter.execute({
    jobId: 'robotics-ik',
    domain: 'robotics',
    operation: 'inverse_kinematics',
    parameters: {
      dhTable: PLANAR_TWO_LINK,
      targetPose: { position: reference.position },
      q0: [0.5, 0.6],
      maxIterations: 100,
      positionTolerance: 1e-8
    }
  });
  assert.strictEqual(ik.outputData.converged, true);
  near(ik.outputData.achievedPose.position[0], reference.position[0], 1e-7, 'IK x');
  near(ik.outputData.achievedPose.position[1], reference.position[1], 1e-7, 'IK y');
  await assert.rejects(
    () =>
      adapter.execute({
        jobId: 'robotics-unreachable',
        domain: 'robotics',
        operation: 'inverse_kinematics',
        parameters: { dhTable: PLANAR_TWO_LINK, targetPose: { position: [3, 0, 0] }, q0: [0, 0], maxIterations: 5 }
      }),
    /failed to converge/
  );
  passed++;

  const traj = SerialManipulatorEngine.planQuinticTrajectory({
    qStart: [0, 0],
    qEnd: [1, -1],
    duration: 2,
    dt: 0.1,
    vStart: [0, 0],
    vEnd: [0, 0],
    aStart: [0, 0],
    aEnd: [0, 0]
  });
  assert.deepStrictEqual(traj.positions[0], [0, 0]);
  near(traj.positions.at(-1)[0], 1, 1e-12, 'trajectory endpoint q1');
  near(traj.positions.at(-1)[1], -1, 1e-12, 'trajectory endpoint q2');
  near(traj.velocities.at(-1)[0], 0, 1e-12, 'trajectory endpoint velocity');
  near(traj.accelerations.at(-1)[0], 0, 1e-12, 'trajectory endpoint acceleration');
  passed++;

  const xml =
    '<robot name="demo"><link name="base"/><link name="arm"/>' +
    '<joint name="j1" type="revolute"><parent link="base"/><child link="arm"/>' +
    '<origin xyz="1 0 0" rpy="0 0 0"/><axis xyz="0 0 1"/></joint></robot>';
  const parsed = await adapter.execute({
    jobId: 'robotics-urdf',
    domain: 'robotics',
    operation: 'parse_urdf',
    parameters: { urdfXml: xml }
  });
  assert.strictEqual(parsed.outputData.totalMass, null);
  assert.strictEqual(parsed.outputData.jointLimits[0].effort, null);
  assert.strictEqual(parsed.outputData.linkInertias[0], null);
  assert.throws(
    () =>
      SerialManipulatorEngine.parseURDF(
        xml.replace('<link name="arm"/>', '<link name="arm"><inertial><mass value="1"/></inertial></link>')
      ),
    /incomplete inertial properties/
  );
  assert.throws(
    () =>
      adapter.validate({
        domain: 'robotics',
        operation: 'inverse_dynamics',
        parameters: { urdfXml: xml, q: [0], qd: [0], qdd: [0], gravity: [0, 0, 0], externalWrench: [0, 0, 0, 0, 0, 0] }
      }),
    /mass/
  );
  passed++;

  const oneLink = [{ a: 0, alpha: 0, d: 0 }];
  const inertia = [{ mass: 1, com: [0, 0, 0], inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 } }];
  const zeroLoad = {
    dhTable: oneLink,
    q: [0],
    qd: [0],
    qdd: [0],
    linkDynamics: inertia,
    gravity: [0, 0, 0],
    externalWrench: [0, 0, 0, 0, 0, 0]
  };
  assert.throws(
    () =>
      adapter.validate({
        domain: 'robotics',
        operation: 'inverse_dynamics',
        parameters: { ...zeroLoad, gravity: undefined }
      }),
    /gravity/
  );
  assert.throws(
    () =>
      adapter.validate({
        domain: 'robotics',
        operation: 'inverse_dynamics',
        parameters: { ...zeroLoad, externalWrench: undefined }
      }),
    /externalWrench/
  );
  const dynamics = await adapter.execute({
    jobId: 'robotics-zero-load',
    domain: 'robotics',
    operation: 'inverse_dynamics',
    parameters: zeroLoad
  });
  near(dynamics.outputData.torqueValues[0], 0, 1e-12, 'zero-load torque');
  passed++;

  console.log(`  ✓ Robotics experimental contracts: ${passed}/${passed} checks passed`);
  return { total: passed, passed };
}

if (require.main === module) {
  runRoboticsContractTests().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runRoboticsContractTests };
