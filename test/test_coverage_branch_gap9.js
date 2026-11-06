'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 9).
 *
 * Narrow, high-confidence checks for uncovered blocks in the two largest
 * pure-logic gap files: the serial manipulator kinematics engine and the
 * NASA rocket propulsion engine. Each check drives explicit error paths,
 * fallback defaults, and rarely-exercised numeric branches.
 */

const assert = require('assert');

const {
  SerialManipulatorEngine,
  quaternionToRot3,
  PUMA_560_DH
} = require('../src/core/robotics/serial_manipulator_kinematics');
const { NasaRocketPropulsion } = require('../src/core/aerospace/nasa_rocket_propulsion');

async function runBranchGapNineCoverageTests() {
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

  check('SerialManipulatorEngine orientation error covers off-diagonal quaternion branches', () => {
    const I = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
    const rotX180 = [
      [1, 0, 0],
      [0, -1, 0],
      [0, 0, -1]
    ];
    const rotY180 = [
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, -1]
    ];
    const rotZ180 = [
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, 1]
    ];
    const e1 = SerialManipulatorEngine.computeOrientationError(rotX180, I);
    const e2 = SerialManipulatorEngine.computeOrientationError(rotY180, I);
    const e3 = SerialManipulatorEngine.computeOrientationError(rotZ180, I);
    assert.deepStrictEqual(e1.length, 3);
    assert.deepStrictEqual(e2.length, 3);
    assert.deepStrictEqual(e3.length, 3);
    assert.strictEqual(Math.hypot(...e1) > 0, true);
    assert.strictEqual(Math.hypot(...e2) > 0, true);
    assert.strictEqual(Math.hypot(...e3) > 0, true);
  });

  check('SerialManipulatorEngine quaternionToRot3 accepts zero norm without NaN', () => {
    const r = quaternionToRot3([0, 0, 0, 0]);
    for (const row of r) {
      for (const value of row) {
        assert.strictEqual(Number.isFinite(value), true);
      }
    }
  });

  check('SerialManipulatorEngine PoE screw with zero angular part uses translation branch', () => {
    const fk = SerialManipulatorEngine.forwardKinematicsPoE(
      [
        [0, 0, 0, 1, 0, 0],
        [0, 0, 0, 0, 1, 0]
      ],
      [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1]
      ],
      [0.25, 0.5]
    );
    assert.strictEqual(fk.position[0].toFixed(3), '0.250');
    assert.strictEqual(fk.position[1].toFixed(3), '0.500');
  });

  check('SerialManipulatorEngine PoE gimbal-lock rotation exercises Euler branch', () => {
    const fk = SerialManipulatorEngine.forwardKinematicsPoE(
      [[0, 1, 0, 0, 0, 0]],
      [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1]
      ],
      [Math.PI / 2]
    );
    assert.strictEqual(Math.abs(fk.eulerZYX[1] - Math.PI / 2) < 1e-6, true);
  });

  check('SerialManipulatorEngine forwardKinematics spec-object with jointAngles and PoE', () => {
    const fk = SerialManipulatorEngine.forwardKinematics(
      {
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
        jointAngles: [0.2, 0.3]
      },
      [0.1, 0.1]
    );
    assert(fk && typeof fk.position === 'object');
  });

  check('SerialManipulatorEngine forwardKinematics spec-object with q key', () => {
    const fk = SerialManipulatorEngine.forwardKinematics(
      {
        dhTable: PUMA_560_DH,
        q: [0, 0, 0, 0, 0, 0]
      },
      [0.1, 0.1, 0.1, 0.1, 0.1, 0.1]
    );
    assert(fk && fk.position.length === 3);
  });

  check('SerialManipulatorEngine forwardKinematics chain object with screwAxes only', () => {
    const fk = SerialManipulatorEngine.forwardKinematics(
      {
        screwAxes: [
          [0, 0, 1, 0, 0, 0],
          [1, 0, 0, 0, 0, 0]
        ],
        homeTransform: [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0.2],
          [0, 0, 0, 1]
        ]
      },
      [0.3, 0.4]
    );
    assert(fk && fk.convention === 'poe');
  });

  check('SerialManipulatorEngine unknown preset string throws', () => {
    assert.throws(() => SerialManipulatorEngine.resolveKinematicChain('NOT_A_ROBOT'), /Unknown manipulator preset/);
  });

  check('SerialManipulatorEngine empty dhTable array throws', () => {
    assert.throws(() => SerialManipulatorEngine.resolveKinematicChain([]), /DH table array cannot be empty/);
    assert.throws(() => SerialManipulatorEngine.forwardKinematics([], [1]), /cannot be empty/);
  });

  check('SerialManipulatorEngine invalid chain object throws', () => {
    assert.throws(() => SerialManipulatorEngine.resolveKinematicChain({}), /Invalid kinematic chain/);
  });

  check('SerialManipulatorEngine q length mismatch throws', () => {
    assert.throws(() => SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, [0.1]), /joint angles/);
  });

  check('SerialManipulatorEngine non-finite joint angle throws', () => {
    assert.throws(
      () => SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, [0, 0, 0, 0, 0, Number.NaN]),
      /finite joint angles/
    );
  });

  check('SerialManipulatorEngine computeDHTransform prismatic and fixed rows', () => {
    const prismatic = SerialManipulatorEngine.computeDHTransform(
      { a: 0, alpha: -Math.PI / 2, d: 0.1, type: 'prismatic' },
      0.05,
      'standard'
    );
    assert(prismatic && prismatic.length === 4);
    const fixed = SerialManipulatorEngine.computeDHTransform(
      { a: 0, alpha: 0, d: 0.2, type: 'fixed' },
      0.3,
      'standard'
    );
    assert(fixed && fixed.length === 4);
  });

  check('SerialManipulatorEngine computeDHTransform thetaOffset fallback and craig conventions', () => {
    const offset = SerialManipulatorEngine.computeDHTransform({ a: 1, alpha: 0, d: 0, thetaOffset: 0.5 }, 0);
    assert(offset && offset.length === 4);
    const craig = SerialManipulatorEngine.computeDHTransform({ a: 1, alpha: 0, d: 0, convention: 'craig' }, 0.25);
    assert(craig && craig.length === 4);
  });

  check('SerialManipulatorEngine forwardKinematics URDF-origin rows', () => {
    const rows = [
      {
        type: 'revolute',
        urdfOrigin: { xyz: [0, 0, 0.1], rpy: [0, 0, 0] },
        urdfAxis: [0, 0, 1]
      },
      {
        type: 'prismatic',
        urdfOrigin: { xyz: [0.1, 0, 0], rpy: [0, 0, 0] },
        urdfAxis: [1, 0, 0]
      },
      {
        type: 'fixed',
        urdfOrigin: { xyz: [0, 0.2, 0], rpy: [0, 0, 0] },
        urdfAxis: [0, 1, 0]
      }
    ];
    const fk = SerialManipulatorEngine.forwardKinematics(rows, [0.5, 0.1, 0]);
    assert(fk && fk.position.length === 3);
  });

  check('SerialManipulatorEngine inverseKinematics positional-call form', () => {
    const result = SerialManipulatorEngine.inverseKinematics(
      PUMA_560_DH,
      [
        [1, 0, 0, 0.3],
        [0, 1, 0, 0.2],
        [0, 0, 1, 0.5],
        [0, 0, 0, 1]
      ],
      [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      { maxIterations: 20, positionTolerance: 1e-4 }
    );
    assert(Array.isArray(result.q) && result.q.length === 6);
  });

  check('SerialManipulatorEngine inverseKinematics rejects missing target position', () => {
    assert.throws(() => SerialManipulatorEngine.inverseKinematics({ dhTable: PUMA_560_DH }), /targetPosition/);
  });

  check('NasaRocketPropulsion constructor default params and legacy aliases', () => {
    const r = new NasaRocketPropulsion({ chamberPressurePa: 100e5, mixtureRatio: 3.5 });
    assert.strictEqual(r.defaultParams.chamberPressureBar, 100);
    assert.strictEqual(r.defaultParams.ofRatio, 3.5);
    const r2 = new NasaRocketPropulsion();
    assert.strictEqual(r2.defaultParams.ofRatio, undefined);
  });

  check('NasaRocketPropulsion evaluates combustion equilibrium for each propellant', () => {
    const r = new NasaRocketPropulsion();
    for (const propellant of ['LOX_LCH4', 'METHALOX', 'LOX_LH2', 'HYDROLOX', 'LOX_RP1', 'KEROLOX']) {
      const res = r.evaluateCombustionEquilibrium(propellant, 100, 3.0);
      assert.strictEqual(res.success, true, `${propellant} failed`);
      assert(res.chamberTemperatureK > 0);
    }
    const invalid = r.evaluateCombustionEquilibrium('RP1', 100, 3.0);
    assert.strictEqual(invalid.success, false);
  });

  check('NasaRocketPropulsion combustion rejects invalid inputs', () => {
    const r = new NasaRocketPropulsion();
    assert.strictEqual(r.evaluateCombustionEquilibrium('', 100, 3).success, false);
    assert.strictEqual(r.evaluateCombustionEquilibrium('LOX_LCH4', 0, 3).success, false);
    assert.strictEqual(r.evaluateCombustionEquilibrium('LOX_LCH4', 100, -1).success, false);
  });

  check('NasaRocketPropulsion nozzle Mach inversion errors', () => {
    const r = new NasaRocketPropulsion();
    assert.throws(() => r.solveNozzleExitMach(0.5, 1.2), /expansionRatio >= 1/);
    assert.throws(() => r.solveNozzleExitMach(2, 1), /gamma > 1/);
    assert.strictEqual(r.solveNozzleExitMach(1.0, 1.2), 1.0);
    assert.throws(() => r.solveNozzleExitMach(1e300, 1.2), /outside the supported numerical range/);
  });

  check('NasaRocketPropulsion engine performance requires explicit inputs', () => {
    const r = new NasaRocketPropulsion();
    assert.strictEqual(r.calculateEnginePerformance().success, false);
    const missing = r.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.4
    });
    assert.strictEqual(missing.success, false);
    const lowAmbient = r.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.4,
      throatDiameterM: 0.1,
      expansionRatio: 10,
      ambientPressureBar: -1
    });
    assert.strictEqual(lowAmbient.success, false);
  });

  check('NasaRocketPropulsion engine performance success path', () => {
    const r = new NasaRocketPropulsion();
    const res = r.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.4,
      throatDiameterM: 0.1,
      expansionRatio: 10,
      ambientPressureBar: 1.01325
    });
    assert.strictEqual(res.success, true);
    assert(res.thrustSeaLevelN > 0);
    assert(res.thrustVacuumN > res.thrustSeaLevelN);
  });

  check('NasaRocketPropulsion regenerative cooling rejects missing inputs', () => {
    const r = new NasaRocketPropulsion();
    const enginePerf = r.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.4,
      throatDiameterM: 0.1,
      expansionRatio: 10,
      ambientPressureBar: 1.01325
    });
    assert.strictEqual(r.calculateBartzRegenerativeCooling(null, null).success, false);
    assert.strictEqual(r.calculateBartzRegenerativeCooling(enginePerf, {}).success, false);
  });

  check('NasaRocketPropulsion regenerative cooling rejects correction factors and laminar flow', () => {
    const r = new NasaRocketPropulsion();
    const enginePerf = r.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.4,
      throatDiameterM: 0.1,
      expansionRatio: 10,
      ambientPressureBar: 1.01325
    });
    const baseCoolant = {
      gasViscosityPaS: 8e-5,
      gasSpecificHeatJKgK: 1800,
      gasPrandtl: 0.9,
      bartzCorrectionFactor: 0.9,
      recoveryFactor: 0.9,
      throatRadiusOfCurvatureM: 0.2,
      coolantChannelCount: 20,
      channelWidthM: 0.002,
      channelHeightM: 0.002,
      wallThicknessM: 0.001,
      coolantInletTempK: 300,
      coolantMassFlowKgS: 10,
      coolantDensityKgM3: 800,
      coolantViscosityPaS: 1e-4,
      coolantSpecificHeatJKgK: 4200,
      coolantPrandtl: 6,
      coolantThermalConductivityWmK: 0.5,
      linerThermalConductivityWmK: 20,
      effectiveHeatTransferAreaM2: 0.2,
      coolantChannelLengthM: 0.5,
      inputSourceDescription: 'test fixture'
    };
    const badFactor = r.calculateBartzRegenerativeCooling(enginePerf, { ...baseCoolant, bartzCorrectionFactor: 2 });
    assert.strictEqual(badFactor.success, false);
    const laminar = r.calculateBartzRegenerativeCooling(enginePerf, {
      ...baseCoolant,
      coolantMassFlowKgS: 0.001
    });
    assert.strictEqual(laminar.success, false);
  });

  check('NasaRocketPropulsion regenerative cooling success path', () => {
    const r = new NasaRocketPropulsion();
    const enginePerf = r.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.4,
      throatDiameterM: 0.1,
      expansionRatio: 10,
      ambientPressureBar: 1.01325
    });
    const result = r.calculateBartzRegenerativeCooling(enginePerf, {
      gasViscosityPaS: 8e-5,
      gasSpecificHeatJKgK: 1800,
      gasPrandtl: 0.9,
      bartzCorrectionFactor: 0.9,
      recoveryFactor: 0.9,
      throatRadiusOfCurvatureM: 0.2,
      coolantChannelCount: 20,
      channelWidthM: 0.002,
      channelHeightM: 0.002,
      wallThicknessM: 0.001,
      coolantInletTempK: 300,
      coolantMassFlowKgS: 10,
      coolantDensityKgM3: 800,
      coolantViscosityPaS: 1e-4,
      coolantSpecificHeatJKgK: 4200,
      coolantPrandtl: 6,
      coolantThermalConductivityWmK: 0.5,
      linerThermalConductivityWmK: 20,
      effectiveHeatTransferAreaM2: 0.2,
      coolantChannelLengthM: 0.5,
      inputSourceDescription: 'test fixture'
    });
    assert.strictEqual(result.success, true);
    assert(result.coolantPressureDropPa > 0);
  });

  check('NasaRocketPropulsion turbopump rejects missing and invalid inputs', () => {
    const r = new NasaRocketPropulsion();
    assert.strictEqual(r.calculateTurbopumpSystem(null, null, null).success, false);
    const enginePerf = r.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.4,
      throatDiameterM: 0.1,
      expansionRatio: 10,
      ambientPressureBar: 1.01325
    });
    const cooling = r.calculateBartzRegenerativeCooling(enginePerf, {
      gasViscosityPaS: 8e-5,
      gasSpecificHeatJKgK: 1800,
      gasPrandtl: 0.9,
      bartzCorrectionFactor: 0.9,
      recoveryFactor: 0.9,
      throatRadiusOfCurvatureM: 0.2,
      coolantChannelCount: 20,
      channelWidthM: 0.002,
      channelHeightM: 0.002,
      wallThicknessM: 0.001,
      coolantInletTempK: 300,
      coolantMassFlowKgS: 10,
      coolantDensityKgM3: 800,
      coolantViscosityPaS: 1e-4,
      coolantSpecificHeatJKgK: 4200,
      coolantPrandtl: 6,
      coolantThermalConductivityWmK: 0.5,
      linerThermalConductivityWmK: 20,
      effectiveHeatTransferAreaM2: 0.2,
      coolantChannelLengthM: 0.5,
      inputSourceDescription: 'test fixture'
    });
    const basePump = {
      fuelDensityKgM3: 800,
      oxidizerDensityKgM3: 1140,
      fuelPumpEfficiency: 0.7,
      oxidizerPumpEfficiency: 0.7,
      injectorPressureDropPa: 2e6,
      oxidizerAdditionalPressureDropPa: 1e6,
      fuelPumpSpeedRPM: 30000,
      oxidizerPumpSpeedRPM: 30000,
      fuelImpellerTipSpeedM_s: 400,
      oxidizerImpellerTipSpeedM_s: 400,
      turbineEfficiency: 0.6,
      oxidizerTankPressurePa: 5e6,
      oxidizerVaporPressurePa: 1e5,
      oxidizerNpshRequiredM: 5,
      inputSourceDescription: 'test fixture'
    };
    assert.strictEqual(
      r.calculateTurbopumpSystem(enginePerf, cooling, { ...basePump, fuelPumpEfficiency: 1.2 }).success,
      false
    );
    assert.strictEqual(
      r.calculateTurbopumpSystem(enginePerf, cooling, { ...basePump, turbineEfficiency: 1.2 }).success,
      false
    );
    assert.strictEqual(
      r.calculateTurbopumpSystem(enginePerf, cooling, { ...basePump, oxidizerTankPressurePa: 1e4 }).success,
      false
    );
    assert.strictEqual(r.calculateTurbopumpSystem({ success: true, thermo: {} }, cooling, basePump).success, false);
  });

  check('NasaRocketPropulsion turbopump success path', () => {
    const r = new NasaRocketPropulsion();
    const enginePerf = r.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.4,
      throatDiameterM: 0.1,
      expansionRatio: 10,
      ambientPressureBar: 1.01325
    });
    const cooling = r.calculateBartzRegenerativeCooling(enginePerf, {
      gasViscosityPaS: 8e-5,
      gasSpecificHeatJKgK: 1800,
      gasPrandtl: 0.9,
      bartzCorrectionFactor: 0.9,
      recoveryFactor: 0.9,
      throatRadiusOfCurvatureM: 0.2,
      coolantChannelCount: 20,
      channelWidthM: 0.002,
      channelHeightM: 0.002,
      wallThicknessM: 0.001,
      coolantInletTempK: 300,
      coolantMassFlowKgS: 10,
      coolantDensityKgM3: 800,
      coolantViscosityPaS: 1e-4,
      coolantSpecificHeatJKgK: 4200,
      coolantPrandtl: 6,
      coolantThermalConductivityWmK: 0.5,
      linerThermalConductivityWmK: 20,
      effectiveHeatTransferAreaM2: 0.2,
      coolantChannelLengthM: 0.5,
      inputSourceDescription: 'test fixture'
    });
    const result = r.calculateTurbopumpSystem(enginePerf, cooling, {
      fuelDensityKgM3: 800,
      oxidizerDensityKgM3: 1140,
      fuelPumpEfficiency: 0.7,
      oxidizerPumpEfficiency: 0.7,
      injectorPressureDropPa: 2e6,
      oxidizerAdditionalPressureDropPa: 1e6,
      fuelPumpSpeedRPM: 30000,
      oxidizerPumpSpeedRPM: 30000,
      fuelImpellerTipSpeedM_s: 400,
      oxidizerImpellerTipSpeedM_s: 400,
      turbineEfficiency: 0.6,
      oxidizerTankPressurePa: 5e6,
      oxidizerVaporPressurePa: 1e5,
      oxidizerNpshRequiredM: 5,
      inputSourceDescription: 'test fixture'
    });
    assert.strictEqual(result.success, true);
    assert(result.turbopumpPowerMw > 0);
  });

  check('NasaRocketPropulsion ascent rejects invalid vehicle inputs', () => {
    const r = new NasaRocketPropulsion();
    assert.strictEqual(r.simulateAscentTrajectory().success, false);
    const base = {
      liftOffMassKg: 500000,
      stage1PropellantMassKg: 400000,
      stage1EngineCount: 9,
      thrustPerEngineSL_kN: 2200,
      Isp_sl: 285,
      Isp_vac: 330,
      rocketDiameterM: 9,
      burnTimeS: 5,
      timeStepS: 1,
      inputSourceDescription: 'test fixture',
      dragCoefficientByMach: [
        { machNumber: 0, dragCoefficient: 0.5 },
        { machNumber: 10, dragCoefficient: 0.5 }
      ],
      pitchAngleByAltitude: [
        { altitudeM: 0, pitchAngleDeg: 90 },
        { altitudeM: 100000, pitchAngleDeg: 90 }
      ]
    };
    assert.strictEqual(r.simulateAscentTrajectory({ ...base, liftOffMassKg: 100 }).success, false);
    assert.strictEqual(r.simulateAscentTrajectory({ ...base, Isp_vac: 200 }).success, false);
    assert.strictEqual(r.simulateAscentTrajectory({ ...base, stage1PropellantMassKg: 100 }).success, false);
    assert.strictEqual(
      r.simulateAscentTrajectory({ ...base, dragCoefficientByMach: [{ machNumber: 0, dragCoefficient: 0.4 }] }).success,
      false
    );
    assert.strictEqual(
      r.simulateAscentTrajectory({ ...base, dragCoefficientByMach: [{ machNumber: 5, dragCoefficient: 0.4 }] }).success,
      false
    );
    assert.strictEqual(
      r.simulateAscentTrajectory({ ...base, pitchAngleByAltitude: [{ altitudeM: 5, pitchAngleDeg: 45 }] }).success,
      false
    );
  });

  check('NasaRocketPropulsion ascent success path', () => {
    const r = new NasaRocketPropulsion();
    const result = r.simulateAscentTrajectory({
      liftOffMassKg: 500000,
      stage1PropellantMassKg: 400000,
      stage1EngineCount: 9,
      thrustPerEngineSL_kN: 2200,
      Isp_sl: 285,
      Isp_vac: 330,
      rocketDiameterM: 9,
      burnTimeS: 5,
      timeStepS: 1,
      inputSourceDescription: 'test fixture',
      dragCoefficientByMach: [
        { machNumber: 0, dragCoefficient: 0.5 },
        { machNumber: 10, dragCoefficient: 0.5 }
      ],
      pitchAngleByAltitude: [
        { altitudeM: 0, pitchAngleDeg: 90 },
        { altitudeM: 100000, pitchAngleDeg: 90 }
      ]
    });
    assert.strictEqual(result.success, true);
    assert(result.cutoffVelocityM_s > 0);
    assert(result.maxDynamicPressureKPa >= 0);
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

module.exports = { runBranchGapNineCoverageTests };
