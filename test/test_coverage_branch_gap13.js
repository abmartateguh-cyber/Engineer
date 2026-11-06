'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 13).
 *
 * Targets remaining uncovered blocks in the highest-gap pure-logic files:
 * manipulator kinematics extras, rocketry extras, P&ID symbol paths, and
 * robotics adapter execute branches.
 */

const assert = require('assert');

const { SerialManipulatorEngine, PUMA_560_DH } = require('../src/core/robotics/serial_manipulator_kinematics');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { NasaRocketPropulsion } = require('../src/core/aerospace/nasa_rocket_propulsion');
const { PIDEngine } = require('../src/core/plant/pid_engine');

async function runBranchGapThirteenCoverageTests() {
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

  const rejects = async (fn, regex) => {
    try {
      await fn();
    } catch (err) {
      assert.match(String(err.message || err), regex);
      return;
    }
    throw new Error(`expected rejection matching ${regex}, but no error was thrown`);
  };

  check('SerialManipulatorEngine string preset FK and modified-DH option string', () => {
    const fk = SerialManipulatorEngine.forwardKinematics('PUMA_560', [0, 0, 0, 0, 0, 0]);
    assert(fk && fk.position.length === 3);
    const mdh = SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 'modified_dh');
    assert(mdh && mdh.convention === 'modified_dh');
  });

  check('SerialManipulatorEngine spec-object fields and PoE options', () => {
    const viaQ = SerialManipulatorEngine.forwardKinematics({ dhTable: PUMA_560_DH, q: [0, 0, 0, 0, 0, 0] });
    assert(viaQ && viaQ.position.length === 3);
    const poeSpec = SerialManipulatorEngine.forwardKinematics(
      {
        screwAxes: [[0, 0, 1, 0, 0, 0]],
        q: [0.4],
        convention: 'poe'
      },
      [0.1]
    );
    assert(poeSpec && poeSpec.convention === 'poe');
  });

  check('SerialManipulatorEngine PoE identity-home and angle-mismatch branches', () => {
    const fk = SerialManipulatorEngine.forwardKinematicsPoE([[0, 0, 1, 0, 0, 0]], undefined, [0.5]);
    assert(fk && fk.position.length === 3);
    assert.throws(
      () => SerialManipulatorEngine.forwardKinematicsPoE([[0, 0, 1, 0, 0, 0]], undefined, [0.1, 0.2]),
      /joint angles/
    );
  });

  check('SerialManipulatorEngine chain object with dhTable key', () => {
    const fk = SerialManipulatorEngine.forwardKinematics({ dhTable: PUMA_560_DH }, [0, 0, 0, 0, 0, 0]);
    assert(fk && fk.position.length === 3);
  });

  check('SerialManipulatorEngine inverseKinematics target orientation forms', () => {
    const base = { dhTable: PUMA_560_DH, targetPosition: [0.3, 0.2, 0.5], maxIterations: 10, positionTolerance: 1e-2 };
    const forms = [
      { targetOrientation: [1, 0, 0, 0] },
      { targetOrientation: [0.1, 0.2, 0.3] },
      {
        targetOrientation: {
          rotationMatrix: [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1]
          ]
        }
      },
      {
        targetOrientation: {
          rotation: [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1]
          ]
        }
      },
      { targetOrientation: { quaternion: [1, 0, 0, 0] } },
      { targetOrientation: { eulerZYX: [0.1, 0.2, 0.3] } },
      { targetOrientation: { rpy: [0.1, 0.2, 0.3] } },
      { targetOrientation: { rpy: { roll: 0.1, pitch: 0.2, yaw: 0.3 } } }
    ];
    for (const extra of forms) {
      const result = SerialManipulatorEngine.inverseKinematics({ ...base, ...extra });
      assert(Array.isArray(result.q), `orientation form failed: ${JSON.stringify(extra)}`);
      assert.strictEqual(result.q.length, 6);
    }
  });

  check('SerialManipulatorEngine computeMassMatrix and inverseDynamics success', () => {
    const inertias = PUMA_560_DH.map(() => ({
      mass: 1,
      com: [0, 0, 0],
      inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01, ixy: 0, ixz: 0, iyz: 0 }
    }));
    const massMatrix = SerialManipulatorEngine.computeMassMatrix(PUMA_560_DH, inertias, [0, 0, 0, 0, 0, 0]);
    assert(massMatrix && massMatrix.length === 6);
    const torques = SerialManipulatorEngine.inverseDynamics({
      dhTable: PUMA_560_DH,
      q: [0, 0, 0, 0, 0, 0],
      qd: [0, 0, 0, 0, 0, 0],
      qdd: [0, 0, 0, 0, 0, 0],
      linkInertias: inertias,
      gravity: [0, 0, -9.81],
      externalWrench: [0, 0, 0, 0, 0, 0]
    });
    assert(Array.isArray(torques.torques) && torques.torques.length === 6);
  });

  check('SerialManipulatorEngine inverseDynamics rejects missing wrench and links', () => {
    assert.throws(
      () =>
        SerialManipulatorEngine.inverseDynamics({
          dhTable: PUMA_560_DH,
          q: [0, 0, 0, 0, 0, 0],
          qd: [0, 0, 0, 0, 0, 0],
          qdd: [0, 0, 0, 0, 0, 0],
          linkInertias: PUMA_560_DH.map(() => ({
            mass: 1,
            com: [0, 0, 0],
            inertia: { ixx: 1, iyy: 1, izz: 1, ixy: 0, ixz: 0, iyz: 0 }
          })),
          gravity: [0, 0, -9.81]
        }),
      /externalWrench/
    );
  });

  check('SerialManipulatorEngine planQuinticTrajectory branches', () => {
    const traj = SerialManipulatorEngine.planQuinticTrajectory({
      qStart: [0, 0],
      qEnd: [1, 1],
      duration: 2,
      dt: 0.4,
      v0: [0, 0],
      vf: [0, 0],
      a0: [0, 0],
      af: [0, 0]
    });
    assert(traj.positions.length >= 5);
    assert.throws(() => SerialManipulatorEngine.planQuinticTrajectory({}), /qStart/);
    assert.throws(
      () => SerialManipulatorEngine.planQuinticTrajectory({ qStart: [0], qEnd: [1], duration: -1 }),
      /positive finite duration/
    );
    assert.throws(
      () => SerialManipulatorEngine.planQuinticTrajectory({ qStart: [0], qEnd: [1], duration: 1, dt: 10 }),
      /dt <= duration/
    );
  });

  check('SerialManipulatorEngine parseURDF round trip and invalid content', () => {
    const xml =
      '<?xml version="1.0"?><robot name="r"><link name="base"/><joint name="j1" type="revolute">' +
      '<parent link="base"/><child link="l1"/><origin xyz="0 0 0.1" rpy="0 0 0"/><axis xyz="0 0 1"/></joint>' +
      '<link name="l1"/></robot>';
    const parsed = SerialManipulatorEngine.parseURDF(xml);
    assert(parsed && Array.isArray(parsed.dhTable));
    assert.throws(() => SerialManipulatorEngine.parseURDF('not a robot at all'), /robot|parse/i);
  });

  check('NasaRocketPropulsion staging delta-V branches', () => {
    const r = new NasaRocketPropulsion();
    assert.strictEqual(r.calculateStagingDeltaV({}).success, false);
    const missing = r.calculateStagingDeltaV({ stage1DryMassKg: 100000 });
    assert.strictEqual(missing.success, false);
    const res = r.calculateStagingDeltaV({
      stage1DryMassKg: 100000,
      stage1PropellantMassKg: 300000,
      stage1IspVac: 330,
      stage2DryMassKg: 20000,
      stage2PropellantMassKg: 80000,
      stage2IspVac: 350,
      payloadMassKg: 10000,
      gravityLossesM_s: 1200,
      aerodynamicLossesM_s: 300,
      steeringLossesM_s: 200,
      requiredDeltaV_m_s: 9000,
      inputSourceDescription: 'test fixture'
    });
    assert.strictEqual(res.success, true);
    assert(res.netDeliveredDeltaV_m_s > 0);
  });

  check('NasaRocketPropulsion isogrid buckling branches', () => {
    const r = new NasaRocketPropulsion();
    assert.strictEqual(r.calculateIsogridTankBuckling({}).success, false);
    const base = {
      tankLengthM: 10,
      tankRadiusM: 2,
      internalPressureBar: 3,
      axialCompressiveLoadKN: 5000,
      skinThicknessMm: 3,
      ribHeightMm: 30,
      ribWidthMm: 2,
      ribSpacingMm: 200,
      elasticModulusPa: 70e9,
      poissonRatio: 0.33,
      yieldStrengthPa: 200e6,
      safetyFactor: 1.5,
      minimumSkinThicknessMm: 2,
      bucklingKnockdownFactor: 0.9,
      material: 'Al 6061-T6',
      pressureStabilizationCoefficient: 0.5,
      internalPressureAxialLoadReliefFactor: 0.5,
      inputSourceDescription: 'test fixture'
    };
    assert.strictEqual(r.calculateIsogridTankBuckling({ ...base, poissonRatio: 0.6 }).success, false);
    assert.strictEqual(r.calculateIsogridTankBuckling({ ...base, bucklingKnockdownFactor: 1.2 }).success, false);
    assert.strictEqual(
      r.calculateIsogridTankBuckling({ ...base, internalPressureAxialLoadReliefFactor: 1.5 }).success,
      false
    );
    assert.strictEqual(r.calculateIsogridTankBuckling({ ...base, axialCompressiveLoadKN: -1 }).success, false);
    const res = r.calculateIsogridTankBuckling(base);
    assert.strictEqual(res.success, true);
  });

  check('NasaRocketPropulsion nozzle compile branches', () => {
    const r = new NasaRocketPropulsion();
    assert.strictEqual(r.compileRocketNozzle({}).success, false);
    const res = r.compileRocketNozzle({
      chamberPressurePa: 100e5,
      chamberTempK: 3400,
      specificGasConstantJ_KgK: 360,
      gamma: 1.2,
      expansionRatio: 10,
      throatRadiusM: 0.1,
      ambientPressurePa: 101325,
      massFlowKgS: 300
    });
    assert.strictEqual(res.success, true);
    assert(res.exitMach > 1);
  });

  check('NasaRocketPropulsion aerospace CFD wedge and cone branches', () => {
    const r = new NasaRocketPropulsion();
    assert.strictEqual(r.runAerospaceCFD({}).success, false);
    const wedge = r.runAerospaceCFD({
      machNumber: 3,
      wedgeHalfAngleDeg: 10,
      chordM: 1,
      referenceAreaM2: 1,
      spanM: 1,
      altitudeM: 10000
    });
    assert.strictEqual(wedge.success, true);
    const cone = r.runAerospaceCFD({
      machNumber: 3,
      coneAngleDeg: 15,
      lengthM: 1,
      baseDiameterM: 0.5,
      referenceAreaM2: 1,
      altitudeM: 10000
    });
    assert.strictEqual(cone.success, true);
  });

  check('NasaRocketPropulsion orbital transfer branches', () => {
    const r = new NasaRocketPropulsion();
    assert.strictEqual(r.calculateOrbitalTransfer({}).success, false);
    assert.strictEqual(r.calculateOrbitalTransfer({ r1Meters: 7e6, r2Meters: 6e6 }).success, false);
    assert.strictEqual(
      r.calculateOrbitalTransfer({ r1Meters: 7e6, r2Meters: 2e7, biElliptic: true, intermediateRadiusM: 1e7 }).success,
      false
    );
    const hohmann = r.calculateOrbitalTransfer({ r1Meters: 7e6, r2Meters: 2e7 });
    assert.strictEqual(hohmann.success, true);
    const bi = r.calculateOrbitalTransfer({ r1Meters: 7e6, r2Meters: 2e7, biElliptic: true, intermediateRadiusM: 4e7 });
    assert.strictEqual(bi.success, true);
  });

  check('NasaRocketPropulsion 1976 atmosphere branches', () => {
    const r = new NasaRocketPropulsion();
    assert.strictEqual(r.get1976Atmosphere(-1).success, false);
    assert.strictEqual(r.get1976Atmosphere(100000).success, false);
    const surf = r.get1976Atmosphere(0);
    assert.strictEqual(surf.success, true);
    assert.strictEqual(surf.pressurePa > 100000, true);
    const tropopause = r.get1976Atmosphere(12000);
    assert.strictEqual(tropopause.success, true);
    assert.strictEqual(tropopause.pressurePa < 30000, true);
    const strat = r.get1976Atmosphere(25000);
    assert.strictEqual(strat.success, true);
  });

  check('PIDEngine custom template renders rare symbol types', () => {
    const cfg = {
      project: { name: 'P', number: '1', revision: '0', date: '2025-01-01' },
      areas: [
        {
          id: 'A1',
          name: 'Area 1',
          equipment: [
            { id: 'V-101', tag: 'V-101', type: 'vertical_separator', x: 100, y: 100 },
            { id: 'T-101', tag: 'T-101', type: 'storage_tank', x: 300, y: 100 },
            { id: 'P-101', tag: 'P-101', type: 'pig_receiver', x: 500, y: 100 },
            { id: 'C-101', tag: 'C-101', type: 'stabilizer_column', x: 700, y: 100 },
            { id: 'B-101', tag: 'B-101', type: 'battery_limit', x: 900, y: 100 }
          ]
        }
      ],
      lines: [
        {
          lineNumber: 'L-1000-10-CS-150',
          sizeIn: 4,
          material: 'CS',
          class: '150',
          from: { tag: 'V-101', nozzle: null },
          to: { tag: 'T-101', nozzle: null }
        }
      ],
      instruments: [],
      valves: [
        { tag: 'XV-101', type: 'globe', actuator: 'motor', lineNumber: 'L-1000-10-CS-150', sizeIn: 4 },
        { tag: 'XV-102', type: 'butterfly', actuator: 'hydraulic', lineNumber: 'L-1000-10-CS-150', sizeIn: 4 },
        { tag: 'XV-103', type: 'check', actuator: 'spring', lineNumber: 'L-1000-10-CS-150', sizeIn: 4 },
        { tag: 'XV-104', type: 'xv', actuator: 'solenoid', lineNumber: 'L-1000-10-CS-150', sizeIn: 4 }
      ],
      controlLoops: []
    };
    const result = new PIDEngine().createPID(cfg);
    assert.strictEqual(result.success, true);
    assert(result.sheets[0].svg.includes('V-101'));
  });

  check('PIDEngine validateConfig error branches', () => {
    const engine = new PIDEngine();
    const template = PIDEngine.oilGasProductionTemplate();
    const noEquipment = structuredClone(template);
    noEquipment.areas[0].equipment = 'not-an-array';
    assert.strictEqual(engine.createPID(noEquipment).success, false);

    const noTag = structuredClone(template);
    noTag.areas[0].equipment[0].tag = null;
    assert.strictEqual(engine.createPID(noTag).success, false);

    const nonFinite = structuredClone(template);
    nonFinite.areas[0].equipment[0].x = Number.NaN;
    assert.strictEqual(engine.createPID(nonFinite).success, false);

    const negativeY = structuredClone(template);
    negativeY.areas[0].equipment[0].y = -5;
    assert.strictEqual(engine.createPID(negativeY).success, false);

    const badNozzle = structuredClone(template);
    badNozzle.areas[0].equipment[0].inletNozzles = ['ghost-nozzle'];
    assert.strictEqual(engine.createPID(badNozzle).success, false);

    const lineNoNumber = structuredClone(template);
    delete lineNoNumber.lines[0].lineNumber;
    assert.strictEqual(engine.createPID(lineNoNumber).success, false);
  });

  check('RoboticsEngineAdapter execute FK with velocity twist', async () => {
    const adapter = new RoboticsEngineAdapter();
    const result = await adapter.execute({
      jobId: 'rob-fk-v-1',
      domain: 'robotics',
      operation: 'forward_kinematics',
      parameters: { preset: 'PUMA_560', q: [0, 0, 0, 0, 0, 0], qd: [1, 0, 0, 0, 0, 0] }
    });
    assert.strictEqual(result.status, 'COMPLETED');
    assert(Number.isFinite(result.outputData.endEffectorLinearSpeed.valueSi));
  });

  check('RoboticsEngineAdapter execute inverse kinematics success', async () => {
    const adapter = new RoboticsEngineAdapter();
    const result = await adapter.execute({
      jobId: 'rob-ik-1',
      domain: 'robotics',
      operation: 'inverse_kinematics',
      parameters: {
        preset: 'PUMA_560',
        targetPosition: [0.3, 0.2, 0.5],
        maxIterations: 50,
        positionTolerance: 1e-4
      }
    });
    assert.strictEqual(result.status, 'COMPLETED');
    assert.strictEqual(result.outputData.qValues.length, 6);
  });

  check('RoboticsEngineAdapter execute trajectory plan success', async () => {
    const adapter = new RoboticsEngineAdapter();
    const result = await adapter.execute({
      jobId: 'rob-traj-1',
      domain: 'robotics',
      operation: 'trajectory_plan',
      parameters: { q0: [0, 0, 0, 0, 0, 0], qf: [1, 1, 1, 1, 1, 1], duration: 2, dt: 0.2 }
    });
    assert.strictEqual(result.status, 'COMPLETED');
    assert(result.outputData.waypoints.length > 5);
  });

  check('RoboticsEngineAdapter execute parse URDF success and empty-joint failure', async () => {
    const adapter = new RoboticsEngineAdapter();
    const result = await adapter.execute({
      jobId: 'rob-urdf-1',
      domain: 'robotics',
      operation: 'parse_urdf',
      parameters: {
        urdf: {
          links: [{ name: 'base' }, { name: 'l1' }],
          joints: [
            {
              name: 'j1',
              type: 'revolute',
              parent: 'base',
              child: 'l1',
              origin: { xyz: [0, 0, 0.1], rpy: [0, 0, 0] },
              axis: [0, 0, 1]
            }
          ]
        }
      }
    });
    assert.strictEqual(result.status, 'COMPLETED');
    await rejects(
      () =>
        adapter.execute({
          jobId: 'rob-urdf-2',
          domain: 'robotics',
          operation: 'parse_urdf',
          parameters: { urdf: { links: [{ name: 'a' }], joints: [] } }
        }),
      /no actuated joints|no valid <link>|parse error/i
    );
  });

  check('RoboticsEngineAdapter execute inputs-style job request', async () => {
    const adapter = new RoboticsEngineAdapter();
    const result = await adapter.execute({
      jobId: 'rob-inputs-1',
      domain: 'robotics',
      operation: 'forward_kinematics',
      inputs: { dhTable: PUMA_560_DH, q: [0, 0, 0, 0, 0, 0] }
    });
    assert.strictEqual(result.status, 'COMPLETED');
    assert.strictEqual(result.outputData.positionVector.length, 3);
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

module.exports = { runBranchGapThirteenCoverageTests };
