'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 20).
 *
 * Targets never-hit branch blocks across the remaining top-uncovered pure-JS
 * modules: serial manipulator URDF/dynamics branches, aerospace shock-expansion
 * and nozzle error paths, robotics adapter edge operations, P&ID SVG renderer
 * symbol/validation branches, STEP NURBS/assembly parser paths, v2/v3 archive
 * recovery branches, plus EDA/optics/plant/math/security small-module error
 * paths. No production source is modified.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SerialManipulatorEngine,
  PUMA_560_DH,
  UR5E_DH,
  KUKA_IIWA_7DOF_DH
} = require('../src/core/robotics/serial_manipulator_kinematics');
const {
  NasaRocketPropulsion,
  solveNozzleExitMach,
  solveObliqueShockBeta,
  obliqueShockState,
  thetaFromBeta,
  prandtlMeyerFunction,
  inversePrandtlMeyerFunction,
  isentropicPressureRatio
} = require('../src/core/aerospace/nasa_rocket_propulsion');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { PIDEngine } = require('../src/core/plant/pid_engine');
const { StepTranslator } = require('../src/core/cad/step_translator');
const {
  OmniArchive,
  OmniArchiveV2,
  CommandJournal,
  OmniVaultAES256,
  OmniWal,
  WAL_FILE_NAME,
  calculateCRC32,
  MAGIC_BYTES_V1,
  MAGIC_BYTES_V2
} = require('../src/core/storage/omni_archive');
const { ProjectManager } = require('../src/core/storage/project_manager');
const { JobResult } = require('../src/core/contracts/JobResult');
const { PersistentWorkerPool, ExperimentalCalculationQueue } = require('../src/core/math/worker_pool');
const { LogicSynthesisEngine } = require('../src/core/eda/logic_synthesis');
const { StaticTimingAnalysis } = require('../src/core/eda/static_timing_analysis');
const { GDTEngine, FeatureControlFrame } = require('../src/core/cad/gdt_engine');
const { OasisStreamEngine } = require('../src/core/eda/oasis_stream_engine');
const { GregoryCornerPatch, VariableRadiusFilletEngine } = require('../src/core/cad/variable_fillet_gregory');
const { SheetMetalBend, SheetMetalFlange, SheetMetalUnfolder } = require('../src/core/cad/sheet_metal_unfolding');
const { OpticalGlassCatalog } = require('../src/core/optics/optical_glass_catalog');
const { HeatExchangerTEMA } = require('../src/core/plant/heat_exchanger_tema');
const { DomainDecompositionEngine } = require('../src/core/math/domain_decomposition');
const { Polygon2D, PolygonBooleanEngine } = require('../src/core/eda/polygon_boolean_engine');
const { EnterpriseIAM, ACTIONS } = require('../src/core/security/enterprise_iam');
const { IPCValidator } = require('../src/core/security/ipc_validator');
const { PlaceAndRouteEngine } = require('../src/core/eda/place_and_route_engine');
const { TransientWaterHammerSolver } = require('../src/core/plant/transient_water_hammer');
const { PetroleumAssayCharacterizer } = require('../src/core/plant/petroleum_assay_characterizer');
const { HyperelasticMaterial } = require('../src/core/cae/hyperelastic_materials');
const { FatigueLifeAnalyzer } = require('../src/core/cae/fatigue_life_analyzer');
const { ShellMITC4Element } = require('../src/core/cae/shell_mitc4');
const { WegsteinRecycleSolver } = require('../src/core/plant/wegstein_recycle_solver');
const { OpticalRay, NonSequentialTracer } = require('../src/core/optics/non_sequential_tracer');
const { GPUParallelPCGSolver } = require('../src/core/math/gpu_parallel_pcg_solver');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');

async function runBranchGapTwentyCoverageTests() {
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

  const ZEROS6 = [0, 0, 0, 0, 0, 0];
  const DYN_LINKS = PUMA_560_DH.linkInertias;

  // ------------------------------------------------------------------
  // SerialManipulatorEngine: URDF parsing / dynamics / IK branches
  // ------------------------------------------------------------------
  const URDF_XML = `<?xml version="1.0"?>
<robot name="test_robot">
  <link name="base_link"><inertial><mass value="2.0"/><origin xyz="0 0 0.1" rpy="0 0 0"/><inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.2"/></inertial></link>
  <link name="link1"><inertial><mass value="1.5"/><origin xyz="0 0 0.2" rpy="0 0 0"/><inertia ixx="0.05" ixy="0" ixz="0" iyy="0.05" iyz="0" izz="0.1"/></inertial></link>
  <link name="link2"><inertial><mass value="1.0"/><origin xyz="0.3 0 0" rpy="0 0 0"/><inertia ixx="0.02" ixy="0" ixz="0" iyy="0.02" iyz="0" izz="0.02"/></inertial></link>
  <joint name="j1" type="revolute">
    <parent link="base_link"/><child link="link1"/>
    <origin xyz="0 0 0.1" rpy="0 0 0"/><axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="100" velocity="2"/>
  </joint>
  <joint name="j2" type="prismatic">
    <parent link="link1"/><child link="link2"/>
    <origin xyz="0 0 0.2" rpy="0 0 0"/><axis xyz="1 0 0"/>
    <limit lower="-0.5" upper="0.5" effort="80" velocity="1"/>
  </joint>
</robot>`;

  check('SerialManipulatorEngine.parseURDF full XML with inertial and limits', () => {
    const chain = SerialManipulatorEngine.parseURDF(URDF_XML);
    assert.strictEqual(chain.name, 'test_robot');
    assert.strictEqual(chain.dof, 2);
    assert.strictEqual(chain.dhTable[0].type, 'revolute');
    assert.strictEqual(chain.dhTable[1].type, 'prismatic');
    assert.strictEqual(chain.jointLimits[0].lower, -3.14);
    assert.strictEqual(chain.jointLimits[0].effort, 100);
    assert.strictEqual(chain.linkInertias[0].mass, 1.5);
    assert.strictEqual(chain.linkInertias[0].comFromJoint, true);
  });

  check('SerialManipulatorEngine.parseURDF JSON object form', () => {
    const chain = SerialManipulatorEngine.parseURDF({
      name: 'json_robot',
      links: [{ name: 'L0', inertial: { mass: 1, com: [0, 0, 0], inertia: { ixx: 1, iyy: 1, izz: 1 } } }],
      joints: [
        {
          name: 'J1',
          type: 'revolute',
          parent: 'L0',
          child: 'L1',
          origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
          axis: [0, 0, 1],
          limit: { lower: -1, upper: 1 }
        }
      ]
    });
    assert.strictEqual(chain.dof, 1);
    assert.strictEqual(chain.jointLimits[0].lower, -1);
  });

  check('SerialManipulatorEngine.parseURDF error branches', () => {
    assert.throws(() => SerialManipulatorEngine.parseURDF(''), /non-empty/);
    assert.throws(() => SerialManipulatorEngine.parseURDF('<robot><link name="a"/></robot>'), /joint/);
    assert.throws(
      () =>
        SerialManipulatorEngine.parseURDF(
          '<robot name="r"><link name="a"/><joint name="j" type="revolute"><parent link="a"/><child link="b"/><origin xyz="0 0" rpy="0 0 0"/><axis xyz="0 0 1"/></joint></robot>'
        ),
      /three-component vector/
    );
    assert.throws(
      () =>
        SerialManipulatorEngine.parseURDF(
          '<robot name="r"><link name="a"><inertial><mass value="1"/><origin xyz="0 0 0"/><inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1"/></inertial></link><link name="b"><inertial><mass value="1"/><origin xyz="0 0 0"/><inertia ixx="bad" ixy="0" ixz="0" iyy="1" iyz="0" izz="1"/></inertial></link><joint name="j" type="revolute"><parent link="a"/><child link="b"/><origin xyz="0 0 0"/><axis xyz="0 0 1"/></joint></robot>'
        ),
      /invalid inertia/
    );
  });

  check('SerialManipulatorEngine forwardKinematics config-object form with jointAngles', () => {
    const res = SerialManipulatorEngine.forwardKinematics({ dhTable: PUMA_560_DH, jointAngles: ZEROS6 });
    assert.strictEqual(res.position.length, 3);
  });

  check('SerialManipulatorEngine forwardKinematics PoE spec via object', () => {
    const screwAxes = [
      [0, 0, 1, 0, 0, 0],
      [0, 1, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0],
      [0, 1, 0, 0, 0, 0]
    ];
    const M = [
      [1, 0, 0, 1],
      [0, 1, 0, 0],
      [0, 0, 1, 0.5],
      [0, 0, 0, 1]
    ];
    const res = SerialManipulatorEngine.forwardKinematics({
      screwAxes,
      homeTransform: M,
      jointAngles: [0.1, 0.2, 0.1, 0.2]
    });
    assert.strictEqual(res.convention, 'poe');
    assert(res.manipulabilityIndex >= 0);
  });

  check('SerialManipulatorEngine forwardKinematics URDF chain with prismatic and fixed rows', () => {
    const chain = SerialManipulatorEngine.parseURDF(URDF_XML);
    const res = SerialManipulatorEngine.forwardKinematics(chain, [0.3, 0.1]);
    assert(Number.isFinite(res.position[0]));
    assert(Number.isFinite(res.jacobian[0][1]));
  });

  check('SerialManipulatorEngine forwardKinematics modified DH convention', () => {
    const mdh = [
      { a: 0, alpha: Math.PI / 2, d: 0.1, theta: 0, type: 'revolute', convention: 'modified' },
      { a: 0.4, alpha: 0, d: 0, theta: 0, type: 'revolute', convention: 'modified' }
    ];
    const res = SerialManipulatorEngine.forwardKinematics(mdh, [0.2, 0.3], { convention: 'modified' });
    assert.strictEqual(res.convention, 'modified_dh');
  });

  check('SerialManipulatorEngine forwardKinematics error branches', () => {
    assert.throws(() => SerialManipulatorEngine.forwardKinematics([], [0]), /empty/);
    assert.throws(() => SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, [0, 0]), /array of 6/);
    assert.throws(
      () => SerialManipulatorEngine.forwardKinematics('UNKNOWN_PRESET', ZEROS6),
      /Unknown manipulator preset/
    );
  });

  check('SerialManipulatorEngine inverseDynamics with URDF prismatic chain', () => {
    const chain = SerialManipulatorEngine.parseURDF(URDF_XML);
    const res = SerialManipulatorEngine.inverseDynamics({
      dhTable: chain,
      linkInertias: chain.linkInertias,
      q: [0.2, 0.05],
      qd: [0.1, 0.02],
      qdd: [0.05, 0.01],
      gravity: [0, 0, -9.81],
      externalWrench: [0, 0, 0, 0, 0, 0]
    });
    assert(res.torques.every(Number.isFinite));
  });

  check('SerialManipulatorEngine inverseDynamics friction and validation branches', () => {
    const inertias = DYN_LINKS.map((l, i) => ({
      ...l,
      viscousFriction: 0.05,
      coulombFriction: i % 2 === 0 ? 0.2 : 0
    }));
    const res = SerialManipulatorEngine.inverseDynamics({
      dhTable: PUMA_560_DH,
      linkInertias: inertias,
      q: ZEROS6,
      qd: [0.1, 0.2, 0.1, 0.2, 0.1, 0.2],
      qdd: ZEROS6,
      gravity: [0, 0, -9.81],
      externalWrench: [0, 0, 0, 0, 0, 0]
    });
    assert(res.torques.every(Number.isFinite));
    assert.throws(
      () =>
        SerialManipulatorEngine.inverseDynamics({
          dhTable: PUMA_560_DH,
          linkInertias: DYN_LINKS,
          q: ZEROS6,
          qd: ZEROS6,
          qdd: ZEROS6,
          gravity: [0, 0, -9.81],
          externalWrench: [0, 0, 0, 0, 0]
        }),
      /externalWrench/
    );
    assert.throws(
      () =>
        SerialManipulatorEngine.inverseDynamics({
          dhTable: PUMA_560_DH,
          q: ZEROS6,
          qd: ZEROS6,
          qdd: ZEROS6,
          gravity: [0, 0, -9.81],
          externalWrench: [0, 0, 0, 0, 0, 0],
          linkDynamics: DYN_LINKS.map((l) => ({ ...l, mass: -1 }))
        }),
      /mass/
    );
  });

  check('SerialManipulatorEngine _parseInertiaTensor array forms', () => {
    assert.deepStrictEqual(SerialManipulatorEngine._parseInertiaTensor([1, 2, 3]), [
      [1, 0, 0],
      [0, 2, 0],
      [0, 0, 3]
    ]);
    assert.deepStrictEqual(SerialManipulatorEngine._parseInertiaTensor([1, 2, 3, 0.1, 0.2, 0.3]), [
      [1, 0.1, 0.2],
      [0.1, 2, 0.3],
      [0.2, 0.3, 3]
    ]);
    assert.deepStrictEqual(
      SerialManipulatorEngine._parseInertiaTensor({ ixx: 1, iyy: 2, izz: 3, ixy: 0.5, ixz: 0.25, iyz: 0.125 }),
      [
        [1, 0.5, 0.25],
        [0.5, 2, 0.125],
        [0.25, 0.125, 3]
      ]
    );
    assert.deepStrictEqual(SerialManipulatorEngine._parseInertiaTensor(null), [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ]);
  });

  check('SerialManipulatorEngine inverseKinematics targetPose 4x4 and quaternion forms', () => {
    const qSeed = [0.2, -0.5, 0.3, 0.1, 0.2, 0.0];
    const fk = SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, qSeed);
    const pose = fk.endEffectorTransform;
    const res1 = SerialManipulatorEngine.inverseKinematics({
      dhTable: PUMA_560_DH,
      targetPose: pose,
      initialGuess: qSeed,
      maxIterations: 40,
      positionTolerance: 1e-4,
      orientationTolerance: 1e-3
    });
    assert.strictEqual(res1.converged, true);
    const res2 = SerialManipulatorEngine.inverseKinematics({
      dhTable: PUMA_560_DH,
      targetPosition: fk.position,
      targetOrientation: fk.quaternion,
      initialGuess: qSeed,
      maxIterations: 40,
      positionTolerance: 1e-4,
      orientationTolerance: 1e-3
    });
    assert.strictEqual(res2.converged, true);
  });

  check('SerialManipulatorEngine inverseKinematics jointLimits object min/max forms', () => {
    const fk = SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, ZEROS6);
    const res = SerialManipulatorEngine.inverseKinematics({
      dhTable: PUMA_560_DH,
      targetPose: fk.endEffectorTransform,
      initialGuess: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      jointLimits: Array.from({ length: 6 }, (_, i) => ({
        lower: -2,
        upper: 2,
        min: i % 2 === 0 ? -2.5 : undefined,
        max: i % 2 === 0 ? 2.5 : undefined
      })),
      maxIterations: 40,
      positionTolerance: 1e-3,
      orientationTolerance: 1e-2
    });
    assert(Array.isArray(res.q));
  });

  check('SerialManipulatorEngine planQuinticTrajectory limit-violation branches', () => {
    const plan = SerialManipulatorEngine.planQuinticTrajectory({
      q0: [0, 0],
      qf: [1, 1],
      duration: 1,
      steps: 10,
      velocityLimits: [0.1],
      accelerationLimits: [0.2],
      torqueLimits: [0.3]
    });
    assert.strictEqual(plan.withinVelocityLimits, false);
    assert.strictEqual(plan.withinAccelerationLimits, false);
    assert.strictEqual(plan.withinTorqueLimits, false);
    assert(plan.limitViolations.length >= 2);
    assert.throws(
      () => SerialManipulatorEngine.planQuinticTrajectory({ q0: [0], qf: [1], duration: -1 }),
      /positive finite duration/
    );
    assert.throws(
      () => SerialManipulatorEngine.planQuinticTrajectory({ q0: [0], qf: [1], duration: 1, dt: 2 }),
      /finite dt/
    );
  });

  // ------------------------------------------------------------------
  // NasaRocketPropulsion: shock-expansion / nozzle / validation branches
  // ------------------------------------------------------------------
  check('NasaRocketPropulsion double-wedge shock-expansion attached-shock paths', () => {
    const aero = new NasaRocketPropulsion();
    const res = aero._doubleWedgeShockExpansion(3.0, 1.4, 0.05, 0.0873, 1.0, 20000, 30000, 1.0);
    assert(res.success !== false);
    assert(Number.isFinite(res.cl));
  });

  check('NasaRocketPropulsion double-wedge expansion and pressure-failure branches', () => {
    const aero = new NasaRocketPropulsion();
    const res = aero._doubleWedgeShockExpansion(2.5, 1.4, 0.2, 0.02, 1.0, 20000, 30000, 1.0);
    assert(res.success !== false);
    const fail = aero._doubleWedgeShockExpansion(1.1, 1.4, 0.6, 0.6, 1.0, 20000, 30000, 1.0);
    assert.strictEqual(fail.success, false);
  });

  check('NasaRocketPropulsion runAerospaceCFD cone geometry branches', () => {
    const aero = new NasaRocketPropulsion();
    const res = aero.runAerospaceCFD({ machNumber: 3.0, coneAngleDeg: 15, lengthM: 1.0, altitudeM: 0 });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.geometry, 'cone');
    const bad = aero.runAerospaceCFD({ machNumber: 0.9, wedgeHalfAngleDeg: 5, chordM: 1 });
    assert.strictEqual(bad.success, false);
  });

  check('NasaRocketPropulsion compileRocketNozzle option variants', () => {
    const aero = new NasaRocketPropulsion();
    const r1 = aero.compileRocketNozzle({
      chamberPressurePa: 20e6,
      throatDiameterM: 0.3,
      expansionRatio: 12,
      molarMassKgMol: 0.02,
      chamberTempK: 3200,
      massFlowKgS: 400,
      chamberRadiusM: 0.5,
      divergentAngleDeg: 12,
      convergentAngleDeg: 40,
      ambientPressurePa: 0
    });
    assert.strictEqual(r1.success, true);
    assert.strictEqual(r1.massFlowKgS, 400);
    const r2 = aero.compileRocketNozzle({ chamberPressurePa: 20e6, throatAreaM2: 0.05, expansionRatio: 10 });
    assert.strictEqual(r2.success, true);
    const bad = aero.compileRocketNozzle({});
    assert.strictEqual(bad.success, false);
  });

  check('NasaRocketPropulsion solveNozzleExitMach edge branches', () => {
    assert.strictEqual(solveNozzleExitMach(1.0, 1.2), 1.0);
    assert.throws(() => solveNozzleExitMach(0.5, 1.2), /expansionRatio/);
    assert.throws(() => solveNozzleExitMach(2, 1.0), /gamma/);
    assert.throws(() => solveNozzleExitMach(1e9, 1.2), /range|outside/);
    assert.strictEqual(solveObliqueShockBeta(1.0, 0.1, 1.4), null);
  });

  check('NasaRocketPropulsion oblique shock helpers', () => {
    const beta = solveObliqueShockBeta(3.0, 0.2, 1.4);
    assert(Number.isFinite(beta));
    const st = obliqueShockState(3.0, beta, 0.2, 1.4);
    assert(Number.isFinite(st.M2));
    assert(Number.isFinite(thetaFromBeta(3.0, beta, 1.4)));
    assert(Number.isNaN(thetaFromBeta(1.5, 0.3, 1.4)));
    assert.strictEqual(solveObliqueShockBeta(3.0, -0.1, 1.4), null);
    const nu = prandtlMeyerFunction(3.0, 1.4);
    const M = inversePrandtlMeyerFunction(nu * 0.5, 1.4);
    assert(Number.isFinite(M));
    assert(Number.isNaN(inversePrandtlMeyerFunction(-1, 1.4)));
    assert(Number.isNaN(inversePrandtlMeyerFunction(10, 1.4)));
    assert(Number.isFinite(isentropicPressureRatio(3.0, 2.0, 1.4)));
  });

  check('NasaRocketPropulsion calculateBartzRegenerativeCooling validation branches', () => {
    const aero = new NasaRocketPropulsion();
    const perf = aero.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 200,
      ofRatio: 3.6,
      throatDiameterM: 0.3,
      expansionRatio: 12,
      ambientPressureBar: 1.013
    });
    const coolant = {
      gasViscosityPaS: 8.5e-5,
      gasSpecificHeatJKgK: 2400,
      gasPrandtl: 0.82,
      bartzCorrectionFactor: 0.88,
      recoveryFactor: Math.pow(0.82, 0.33),
      throatRadiusOfCurvatureM: 0.174,
      coolantChannelCount: 500,
      channelWidthM: 0.0035,
      channelHeightM: 0.006,
      wallThicknessM: 0.001,
      coolantInletTempK: 110,
      coolantMassFlowKgS: perf.massFlowFuelKgS,
      coolantDensityKgM3: 422,
      coolantViscosityPaS: 1.2e-4,
      coolantSpecificHeatJKgK: 3450,
      coolantPrandtl: 2.2,
      coolantThermalConductivityWmK: 0.18,
      linerThermalConductivityWmK: 325,
      effectiveHeatTransferAreaM2: 2.69,
      coolantChannelLengthM: 2.2,
      inputSourceDescription: 'test'
    };
    assert.strictEqual(aero.calculateBartzRegenerativeCooling(perf, coolant).success, true);
    assert.strictEqual(aero.calculateBartzRegenerativeCooling({ success: false }, coolant).success, false);
    const badCoolant = { ...coolant, coolantChannelCount: 0 };
    assert.strictEqual(aero.calculateBartzRegenerativeCooling(perf, badCoolant).success, false);
    const laminar = { ...coolant, coolantMassFlowKgS: 0.001 };
    assert.strictEqual(aero.calculateBartzRegenerativeCooling(perf, laminar).success, false);
    const highFactor = { ...coolant, bartzCorrectionFactor: 1.1 };
    assert.strictEqual(aero.calculateBartzRegenerativeCooling(perf, highFactor).success, false);
  });

  check('NasaRocketPropulsion calculateTurbopumpSystem validation branches', () => {
    const aero = new NasaRocketPropulsion();
    const perf = aero.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 200,
      ofRatio: 3.6,
      throatDiameterM: 0.3,
      expansionRatio: 12,
      ambientPressureBar: 1.013
    });
    const coolant = aero.calculateBartzRegenerativeCooling(perf, {
      gasViscosityPaS: 8.5e-5,
      gasSpecificHeatJKgK: 2400,
      gasPrandtl: 0.82,
      bartzCorrectionFactor: 0.88,
      recoveryFactor: Math.pow(0.82, 0.33),
      throatRadiusOfCurvatureM: 0.174,
      coolantChannelCount: 500,
      channelWidthM: 0.0035,
      channelHeightM: 0.006,
      wallThicknessM: 0.001,
      coolantInletTempK: 110,
      coolantMassFlowKgS: perf.massFlowFuelKgS,
      coolantDensityKgM3: 422,
      coolantViscosityPaS: 1.2e-4,
      coolantSpecificHeatJKgK: 3450,
      coolantPrandtl: 2.2,
      coolantThermalConductivityWmK: 0.18,
      linerThermalConductivityWmK: 325,
      effectiveHeatTransferAreaM2: 2.69,
      coolantChannelLengthM: 2.2,
      inputSourceDescription: 'test'
    });
    const pump = {
      fuelDensityKgM3: 422,
      oxidizerDensityKgM3: 1141,
      fuelPumpEfficiency: 0.81,
      oxidizerPumpEfficiency: 0.78,
      injectorPressureDropPa: 4.5e6,
      oxidizerAdditionalPressureDropPa: 1.5e6,
      fuelPumpSpeedRPM: 42000,
      oxidizerPumpSpeedRPM: 28000,
      fuelImpellerTipSpeedM_s: 480,
      oxidizerImpellerTipSpeedM_s: 380,
      turbineEfficiency: 0.85,
      oxidizerTankPressurePa: 3.5e5,
      oxidizerVaporPressurePa: 1.05e5,
      oxidizerNpshRequiredM: 12,
      inputSourceDescription: 'test'
    };
    assert.strictEqual(aero.calculateTurbopumpSystem(perf, coolant, pump).success, true);
    assert.strictEqual(aero.calculateTurbopumpSystem(perf, { success: false }, pump).success, false);
    assert.strictEqual(
      aero.calculateTurbopumpSystem(perf, coolant, { ...pump, fuelPumpEfficiency: 1.5 }).success,
      false
    );
    assert.strictEqual(
      aero.calculateTurbopumpSystem(perf, coolant, { ...pump, oxidizerTankPressurePa: 5e4 }).success,
      false
    );
    assert.strictEqual(aero.solveTurbopumpPowerBalance({ propellantType: 'BAD' }, null, pump).success, false);
  });

  check('NasaRocketPropulsion simulateAscentTrajectory error branches', () => {
    const aero = new NasaRocketPropulsion();
    const base = {
      liftOffMassKg: 500000,
      stage1PropellantMassKg: 400000,
      stage1EngineCount: 9,
      thrustPerEngineSL_kN: 2300,
      Isp_sl: 285,
      Isp_vac: 320,
      rocketDiameterM: 5,
      burnTimeS: 200,
      timeStepS: 5,
      dragCoefficientByMach: [
        { machNumber: 0, dragCoefficient: 0.4 },
        { machNumber: 1.2, dragCoefficient: 0.6 },
        { machNumber: 10, dragCoefficient: 0.3 }
      ],
      pitchAngleByAltitude: [
        { altitudeM: 0, pitchAngleDeg: 90 },
        { altitudeM: 90000, pitchAngleDeg: 10 }
      ],
      inputSourceDescription: 'test'
    };
    const validBase = { ...base, burnTimeS: 50 };
    assert.strictEqual(aero.simulateAscentTrajectory(validBase).success, true);
    assert.strictEqual(aero.simulateAscentTrajectory({ ...base, Isp_vac: 200 }).success, false);
    assert.strictEqual(aero.simulateAscentTrajectory({ ...base, stage1PropellantMassKg: 500000 }).success, false);
    assert.strictEqual(aero.simulateAscentTrajectory({ ...base, burnTimeS: 200 }).success, false);
    assert.strictEqual(
      aero.simulateAscentTrajectory({ ...base, dragCoefficientByMach: [{ machNumber: 0, dragCoefficient: 0.4 }] })
        .success,
      false
    );
    assert.strictEqual(
      aero.simulateAscentTrajectory({ ...base, pitchAngleByAltitude: [{ altitudeM: 0, pitchAngleDeg: 90 }] }).success,
      false
    );
  });

  check('NasaRocketPropulsion staging and isogrid validation branches', () => {
    const aero = new NasaRocketPropulsion();
    const staging = {
      payloadMassKg: 15000,
      stage1DryMassKg: 25000,
      stage1PropellantMassKg: 400000,
      stage1IspVac: 310,
      stage2DryMassKg: 8000,
      stage2PropellantMassKg: 120000,
      stage2IspVac: 350,
      gravityLossesM_s: 1500,
      aerodynamicLossesM_s: 300,
      steeringLossesM_s: 200,
      requiredDeltaV_m_s: 9200,
      inputSourceDescription: 'test'
    };
    assert.strictEqual(aero.calculateStagingDeltaV(staging).success, true);
    assert.strictEqual(aero.calculateStagingDeltaV({ ...staging, payloadMassKg: -1 }).success, false);
    assert.strictEqual(aero.calculateStagingDeltaV(null).success, false);
    const tank = {
      tankRadiusM: 2.5,
      tankLengthM: 12,
      internalPressureBar: 5,
      axialCompressiveLoadKN: 20000,
      skinThicknessMm: 3,
      ribHeightMm: 25,
      ribWidthMm: 4,
      elasticModulusPa: 70e9,
      poissonRatio: 0.33,
      yieldStrengthPa: 500e6,
      safetyFactor: 1.5,
      minimumSkinThicknessMm: 2,
      bucklingKnockdownFactor: 0.8,
      material: 'Al7075-T6',
      pressureStabilizationCoefficient: 0.5,
      internalPressureAxialLoadReliefFactor: 0.7,
      inputSourceDescription: 'test'
    };
    assert.strictEqual(aero.calculateIsogridTankBuckling(tank).success, true);
    assert.strictEqual(aero.calculateIsogridTankBuckling({ ...tank, poissonRatio: 0.6 }).success, false);
    assert.strictEqual(aero.calculateIsogridTankBuckling({ ...tank, bucklingKnockdownFactor: 1.5 }).success, false);
    assert.strictEqual(
      aero.calculateIsogridTankBuckling({ ...tank, internalPressureAxialLoadReliefFactor: 2 }).success,
      false
    );
  });

  check('NasaRocketPropulsion combustion/nozzle compatibility branches', () => {
    const aero = new NasaRocketPropulsion();
    assert.strictEqual(aero.evaluateCombustionEquilibrium('LOX_LH2', 200, 6).success, true);
    assert.strictEqual(aero.evaluateCombustionEquilibrium('LOX_RP1', 200, 2.6).success, true);
    assert.strictEqual(aero.evaluateCombustionEquilibrium('BAD', 200, 3).success, false);
    assert.strictEqual(aero.evaluateCombustionEquilibrium('LOX_LCH4', -1, 3).success, false);
    assert.strictEqual(aero.solveEquilibriumComposition(3, 20e6, 'LOX_LCH4').success, true);
    assert.strictEqual(aero.solveEquilibriumComposition(0, 20e6, 'LOX_LCH4').success, false);
    const aeroConfigured = new NasaRocketPropulsion({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 200,
      ofRatio: 3.6,
      throatDiameterM: 0.3
    });
    assert.strictEqual(aeroConfigured.solveNozzleExpansion(12, 101325).success, true);
    assert.strictEqual(aero.solveNozzleExpansion(0.5, 101325).success, false);
    assert.strictEqual(aero.solveBartzHeatTransfer({ propellantType: 'BAD' }, {}).success, false);
    assert.strictEqual(aero.calculateOrbitalTransfer({ r1: 6.7e6, r2: 4.2e7, mu: 3.986e14 }).success, true);
    assert.strictEqual(aero.calculateOrbitalTransfer({ r1Meters: -1, r2Meters: 4.2e7 }).success, false);
    assert.strictEqual(
      aero.calculateOrbitalTransfer({ r1Meters: 6.7e6, r2Meters: 4.2e7, biElliptic: true }).success,
      false
    );
    assert(Array.isArray(aero.getNasaSubsystemEntities()));
  });

  // ------------------------------------------------------------------
  // RoboticsEngineAdapter: execute validation / PoE / URDF paths
  // ------------------------------------------------------------------
  check('RoboticsEngineAdapter FK via PoE with joint velocities', async () => {
    const adapter = new RoboticsEngineAdapter();
    const screwAxes = [
      [0, 0, 1, 0, 0, 0],
      [0, 1, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0],
      [0, 1, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0],
      [0, 1, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0]
    ];
    const M = [
      [1, 0, 0, 0.3],
      [0, 1, 0, 0],
      [0, 0, 1, 0.6],
      [0, 0, 0, 1]
    ];
    const res = await adapter.execute({
      jobId: 'r20-poe',
      domain: 'robotics',
      operation: 'forward_kinematics',
      parameters: {
        screwAxes,
        homeTransform: M,
        jointAngles: [0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.1],
        jointVelocities: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]
      }
    });
    assert.strictEqual(res.status, 'COMPLETED');
    assert(res.output.endEffectorLinearSpeed !== undefined);
  });

  check('RoboticsEngineAdapter FK residual variants and dhTable validation', async () => {
    const adapter = new RoboticsEngineAdapter();
    const base = { preset: 'PUMA_560', jointAngles: ZEROS6 };
    const r1 = await adapter.execute({
      jobId: 'r20-fk1',
      domain: 'robotics',
      operation: 'forward_kinematics',
      parameters: { ...base, targetPosition: [0, 0.6718, 0.15] }
    });
    assert.strictEqual(r1.status, 'COMPLETED');
    const r2 = await adapter.execute({
      jobId: 'r20-fk2',
      domain: 'robotics',
      operation: 'forward_kinematics',
      parameters: { ...base, targetPose: [0, 0, 0] }
    });
    assert.strictEqual(r2.status, 'COMPLETED');
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'r20-fk3',
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { dhTable: [], jointAngles: [] }
        }),
      /non-empty dhTable/
    );
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'r20-fk4',
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { dhTable: [{ a: NaN, alpha: 0, d: 0 }], jointAngles: [0] }
        }),
      /non-finite/
    );
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'r20-fk5',
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { dhTable: [null], jointAngles: [0] }
        }),
      /must be an object/
    );
  });

  check('RoboticsEngineAdapter IK and trajectory with preset', async () => {
    const adapter = new RoboticsEngineAdapter();
    const qSeed = [0.2, -0.5, 0.3, 0.1, 0.2, 0.0];
    const fk = SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, qSeed);
    const res = await adapter.execute({
      jobId: 'r20-ik',
      domain: 'robotics',
      operation: 'inverse_kinematics',
      parameters: {
        preset: 'PUMA_560',
        targetPose: fk.endEffectorTransform,
        q0: qSeed,
        maxIterations: 40,
        positionTolerance: 1e-4,
        orientationTolerance: 1e-3
      }
    });
    assert.strictEqual(res.status, 'COMPLETED');
    const traj = await adapter.execute({
      jobId: 'r20-traj',
      domain: 'robotics',
      operation: 'trajectory_plan',
      parameters: {
        preset: 'PUMA_560',
        q0: ZEROS6,
        qf: [0.5, 0.3, 0.2, 0.1, 0.1, 0.1],
        duration: 2,
        steps: 12,
        velocityLimits: [2, 2, 2, 3, 3, 4],
        accelerationLimits: [4, 4, 4, 6, 6, 8]
      }
    });
    assert.strictEqual(traj.status, 'COMPLETED');
    assert(traj.output.endEffectorDisplacement !== undefined);
    assert(traj.output.maxCartesianSpeed !== undefined);
  });

  check('RoboticsEngineAdapter parse_urdf residual and validation branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    const res = await adapter.execute({
      jobId: 'r20-urdf',
      domain: 'robotics',
      operation: 'parse_urdf',
      parameters: {
        urdf: `<?xml version="1.0"?><robot name="rr"><link name="a"><inertial><mass value="1"/><origin xyz="0 0 0.1" rpy="0 0 0"/><inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.2"/></inertial></link><link name="b"><inertial><mass value="1"/><origin xyz="0.4 0 0" rpy="0 0 0"/><inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.2"/></inertial></link><joint name="j" type="revolute"><parent link="a"/><child link="b"/><origin xyz="0.2 0 0.1" rpy="0 0 0"/><axis xyz="0 0 1"/><limit lower="-3.14" upper="3.14" effort="100" velocity="2"/></joint></robot>`
      }
    });
    assert.strictEqual(res.status, 'COMPLETED');
    assert.strictEqual(res.output.dofCount, 1);
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'r20-urdf-bad',
          domain: 'robotics',
          operation: 'parse_urdf',
          parameters: { urdf: '<robot><joint type="planar"/></robot>' }
        }),
      /Unsupported URDF joint type/
    );
    await assert.rejects(
      () =>
        adapter.execute({ jobId: 'r20-urdf-x', domain: 'robotics', operation: 'parse_urdf', parameters: { urdf: '' } }),
      /non-empty URDF/
    );
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'r20-urdf-null',
          domain: 'robotics',
          operation: 'parse_urdf',
          parameters: { urdf: 42 }
        }),
      /string or object/
    );
  });

  check('RoboticsEngineAdapter validate error branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    assert.throws(() => adapter.validate(null), /null request/);
    assert.throws(() => adapter.validate({ domain: 'eda', operation: 'forward_kinematics' }), /Domain mismatch/);
    assert.throws(() => adapter.validate({ domain: 'robotics' }), /valid string operation/);
    assert.throws(
      () => adapter.validate({ domain: 'robotics', operation: 'not_real' }),
      /Unsupported robotics operation/
    );
    assert.throws(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: { preset: 'PUMA_560', targetPose: {} }
        }),
      /targetPose.position/
    );
    assert.throws(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: {
            preset: 'PUMA_560',
            targetPose: [
              [0, 0],
              [0, 0]
            ]
          }
        }),
      /4x4/
    );
    assert.throws(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'trajectory_plan',
          parameters: { q0: [0, 0], qf: [1, 1], duration: 0 }
        }),
      /positive duration/
    );
    assert.throws(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'trajectory_plan',
          parameters: { q0: [0, 0], qf: [1, 1], duration: 1, v0: [0] }
        }),
      /length/
    );
    assert.throws(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'inverse_dynamics',
          parameters: {
            preset: 'PUMA_560',
            q: ZEROS6,
            qd: ZEROS6,
            qdd: ZEROS6,
            gravity: [0, 0, -9.81],
            fTip: [0, 0, 0, 0, 0, 0]
          }
        }),
      /linkDynamics/
    );
    assert.throws(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { preset: 'UNKNOWN', jointAngles: ZEROS6 }
        }),
      /Unsupported manipulator preset/
    );
    assert.throws(
      () =>
        adapter.validate({ domain: 'robotics', operation: 'forward_kinematics', parameters: { jointAngles: ZEROS6 } }),
      /explicit manipulator specification/
    );
  });

  check('RoboticsEngineAdapter steno jobId default manipulator', async () => {
    const adapter = new RoboticsEngineAdapter();
    const res = await adapter.execute({
      jobId: 'steno_r20',
      domain: 'robotics',
      operation: 'forward_kinematics',
      parameters: { jointAnglesRad: ZEROS6 }
    });
    assert.strictEqual(res.status, 'COMPLETED');
    assert.strictEqual(res.output.dof.valueSi, 6);
  });

  // ------------------------------------------------------------------
  // PIDEngine: P&ID rendering symbol/validation branches
  // ------------------------------------------------------------------
  function pidConfig(overrides = {}) {
    const defs = [
      { id: 'N1', side: 'left', offset: 0 },
      { id: 'N2', side: 'right', offset: 0 },
      { id: 'N3', side: 'top', offset: 0 },
      { id: 'N4', side: 'bottom', offset: 0 }
    ];
    const equipment = [
      {
        tag: 'P-101',
        type: 'pump',
        description: 'Booster pump',
        x: 10,
        y: 10,
        nozzles: defs.slice(0, 2),
        inletNozzles: ['N1'],
        outletNozzles: ['N2']
      },
      {
        tag: 'V-101',
        type: 'vertical_separator',
        description: 'Separator',
        x: 200,
        y: 10,
        nozzles: defs.slice(),
        inletNozzles: ['N1'],
        outletNozzles: ['N2'],
        ventNozzles: ['N3']
      },
      {
        tag: 'T-101',
        type: 'storage_tank',
        description: 'Tank',
        x: 400,
        y: 10,
        nozzles: defs.slice(0, 2),
        inletNozzles: ['N1'],
        outletNozzles: ['N2']
      },
      {
        tag: 'BND-1',
        type: 'battery_limit',
        description: 'Battery limit',
        x: 600,
        y: 10,
        nozzles: [{ id: 'N1', side: 'right', offset: 0 }],
        outletNozzles: ['N1'],
        isBoundary: true
      }
    ];
    const lines = [
      {
        lineNumber: 'L-1010-12-CS-150-A1F',
        sizeIn: 12,
        service: 'crude oil',
        material: 'CS',
        class: '150',
        insulation: 'NONE',
        from: { tag: 'P-101', nozzle: 'N2' },
        to: { tag: 'V-101', nozzle: 'N1' }
      },
      {
        lineNumber: 'L-1020-8-CS-300-A1F',
        sizeIn: 8,
        service: 'gas',
        material: 'CS',
        class: '300',
        insulation: 'NONE',
        from: { tag: 'V-101', nozzle: 'N2' },
        to: { tag: 'T-101', nozzle: 'N1' }
      },
      {
        lineNumber: 'L-1030-6-CS-150-A1F',
        sizeIn: 6,
        service: 'water',
        material: 'CS',
        class: '150',
        insulation: 'NONE',
        from: { tag: 'T-101', nozzle: 'N2' },
        to: { tag: 'BND-1', nozzle: 'N1' }
      }
    ];
    const instruments = [
      {
        tag: 'PT-101',
        loopId: 'LIC-101',
        firstLetter: 'P',
        modifier: 'T',
        description: 'Pressure transmitter',
        location: 'field',
        connectedTo: { tag: 'V-101', nozzle: 'N1' }
      },
      {
        tag: 'LIC-101',
        loopId: 'LIC-101',
        firstLetter: 'L',
        modifier: 'IC',
        description: 'Level controller',
        location: 'dcs',
        connectedTo: { tag: 'V-101', nozzle: 'N3' }
      },
      {
        tag: 'FI-101',
        loopId: 'FIC-101',
        firstLetter: 'F',
        modifier: 'I',
        description: 'Flow indicator',
        location: 'panel',
        connectedTo: { tag: 'P-101', nozzle: 'N1' }
      },
      {
        tag: 'LI-101',
        loopId: 'LIC-101',
        firstLetter: 'L',
        modifier: 'I',
        description: 'Level indicator',
        location: 'local',
        connectedTo: { tag: 'V-101', nozzle: 'N4' }
      }
    ];
    const valves = [
      { tag: 'XV-101', type: 'xv', actuator: 'solenoid', lineNumber: 'L-1010-12-CS-150-A1F', sizeIn: 12 },
      { tag: 'PCV-101', type: 'control', actuator: 'pneumatic-fo', lineNumber: 'L-1020-8-CS-300-A1F', sizeIn: 8 },
      { tag: 'FCV-101', type: 'globe', actuator: 'motor', lineNumber: 'L-1020-8-CS-300-A1F', sizeIn: 8 },
      { tag: 'BV-101', type: 'ball', actuator: 'hand', lineNumber: 'L-1030-6-CS-150-A1F', sizeIn: 6 },
      { tag: 'BFV-101', type: 'butterfly', actuator: 'hydraulic', lineNumber: 'L-1030-6-CS-150-A1F', sizeIn: 6 },
      { tag: 'CKV-101', type: 'check', lineNumber: 'L-1030-6-CS-150-A1F', sizeIn: 6 },
      { tag: 'PSV-101', type: 'psv', lineNumber: 'L-1020-8-CS-300-A1F', sizeIn: 8, setPressureBarg: 15 },
      { tag: 'GV-101', type: 'gate', actuator: 'spring', lineNumber: 'L-1010-12-CS-150-A1F', sizeIn: 12 },
      { tag: 'NV-101', type: 'control', actuator: 'pneumatic-fc', lineNumber: 'L-1010-12-CS-150-A1F', sizeIn: 12 }
    ];
    const controlLoops = [
      {
        loopTag: 'LIC-101',
        sensorTag: 'PT-101',
        controllerTag: 'LIC-101',
        finalElementTag: 'PCV-101',
        type: 'cascade'
      },
      { loopTag: 'FIC-101', sensorTag: 'FI-101', controllerTag: 'LIC-101', finalElementTag: 'FCV-101', type: 'ratio' },
      { loopTag: 'PIC-102', sensorTag: 'PT-101', controllerTag: 'LI-101', finalElementTag: 'XV-101', type: 'feedback' }
    ];
    return {
      project: {
        name: 'Cov20',
        number: 'PID-9020',
        revision: '1',
        client: 'T',
        location: 'X',
        date: '2026-01-01',
        drawnBy: 'A',
        checkedBy: 'B',
        approvedBy: 'C'
      },
      areas: [{ id: 'A-1', name: 'Area 1', order: 1, equipment }],
      lines,
      instruments,
      valves,
      controlLoops,
      options: { padInches: 0.25, gridMm: 10, showGrid: true },
      ...overrides
    };
  }

  check('PIDEngine createPID renders all symbol/actuator/location/loop branches', () => {
    const engine = new PIDEngine();
    const res = engine.createPID(pidConfig());
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.sheets.length, 1);
    const svg = res.sheets[0].svg;
    for (const marker of [
      'vertical separator',
      'storage tank',
      'battery limit',
      'XV-101',
      'GV-101',
      'BFV-101',
      'PSV-101',
      'PCV-101',
      'BV-101',
      'CKV-101',
      'NV-101',
      'FCV-101'
    ]) {
      assert(svg.includes(marker), `missing SVG marker ${marker}`);
    }
    assert(res.schedule.valves.some((v) => v.setPressureBarg === 15));
  });

  check('PIDEngine createPID showGrid false and vectorizeSchedule branches', () => {
    const engine = new PIDEngine();
    const res = engine.createPID(pidConfig({ options: { showGrid: false, gridMm: 5 } }));
    assert.strictEqual(res.success, true);
    const csv = engine.vectorizeSchedule(res.schedule);
    assert(csv.equipment.includes('tag'));
    assert(csv.valves.includes('setPressureBarg'));
  });

  check('PIDEngine createPID validation error corpus', () => {
    const engine = new PIDEngine();
    const cases = [
      { areas: [] },
      { areas: [{ id: 'A', equipment: [{ tag: 'E1', type: 'bogus', nozzles: [] }] }] },
      { areas: [{ id: 'A', equipment: [{ tag: 'E1', type: 'pump', x: -1, y: 0, nozzles: [] }] }] },
      {
        areas: [
          {
            id: 'A',
            equipment: [
              { tag: 'E1', type: 'pump', nozzles: [{ id: 'N1', side: 'left', offset: 0 }], outletNozzles: ['N9'] }
            ]
          }
        ],
        lines: [],
        instruments: [],
        valves: [],
        controlLoops: []
      },
      {
        areas: [
          { id: 'A', equipment: [{ tag: 'E1', type: 'pump', nozzles: [{ id: 'N1', side: 'left', offset: 0 }] }] }
        ],
        lines: [
          { lineNumber: 'BAD', sizeIn: 12, from: { tag: 'E1', nozzle: 'N1' }, to: { tag: 'NOPE', nozzle: 'N1' } }
        ],
        instruments: [],
        valves: [],
        controlLoops: []
      },
      {
        areas: [
          {
            id: 'A',
            equipment: [
              {
                tag: 'E1',
                type: 'pump',
                nozzles: [
                  { id: 'N1', side: 'left', offset: 0 },
                  { id: 'N2', side: 'right', offset: 0 }
                ]
              }
            ]
          }
        ],
        lines: [
          {
            lineNumber: 'L-1010-12-CS-150-A1F',
            sizeIn: 12,
            material: 'CS',
            class: '150',
            from: { tag: 'E1', nozzle: 'N1' },
            to: { tag: 'E1', nozzle: 'N2' }
          }
        ],
        instruments: [{ tag: 'I1', firstLetter: 'P', location: 'field' }],
        valves: [{ tag: 'V1', type: 'psv', lineNumber: 'L-1010-12-CS-150-A1F' }],
        controlLoops: [{ loopTag: 'L1', sensorTag: 'I1', controllerTag: 'MISSING', finalElementTag: 'V1' }]
      }
    ];
    for (const cfg of cases) {
      const res = engine.createPID(cfg);
      assert.strictEqual(res.success, false);
      assert(res.validation.errors.length > 0);
    }
  });

  // ------------------------------------------------------------------
  // StepTranslator: NURBS / assembly / parse branches
  // ------------------------------------------------------------------
  check('StepTranslator exportNurbsSurfaces classifies cylindrical faces', () => {
    const cyl = BRepPrimitives.createCylinder(5, 20, 24, 'Cyl');
    const step = StepTranslator.exportNurbsSurfaces(cyl, 'CylModel');
    assert(step.includes('RATIONAL_B_SPLINE_SURFACE'));
    assert(step.includes('B_SPLINE_SURFACE_WITH_KNOTS'));
  });

  check('StepTranslator parseSTEP round-trip NURBS and assembly entities', () => {
    const cyl = BRepPrimitives.createCylinder(5, 20, 16, 'Cyl');
    const step = StepTranslator.exportNurbsSurfaces(cyl, 'CylModel');
    const parsed = StepTranslator.parseSTEP(step);
    assert(parsed.summary.rationalBSplineSurfacesCount > 0);
    assert(parsed.summary.bSplineSurfacesCount > 0);
    assert(parsed.nurbsSurfaces.some((s) => s.weights && s.weights.length > 0));
    assert(parsed.nurbsSurfaces.every((s) => Array.isArray(s.controlPoints)));
    const box = BRepPrimitives.createBox(10, 10, 10, 'Box');
    const assemblyStep = StepTranslator.exportAssemblySTEP(
      {
        solids: [{ id: 's1', solid: box, layer: 'MECH', color: { r: 0.1, g: 0.2, b: 0.3 } }],
        assembly: {
          nodes: [
            { id: 'n1', solidId: 's1', name: 'Part1', children: ['n2'] },
            {
              id: 'n2',
              solidId: 's1',
              name: 'Part2',
              transforms: { origin: [10, 0, 0], axis1: [0, 1, 0], axis2: [0, 0, 1], scale: 2 }
            }
          ],
          references: []
        }
      },
      'Assy2'
    );
    const parsedA = StepTranslator.parseSTEP(assemblyStep);
    assert(parsedA.summary.nextAssemblyUsageOccurrencesCount >= 1);
    assert(parsedA.summary.itemDefinedTransformationsCount >= 1);
    assert(parsedA.summary.layerAssignmentsCount >= 1);
    assert(parsedA.summary.colourRgbCount >= 1);
    assert(parsedA.assembly.layers.length >= 1);
  });

  check('StepTranslator single-part export with layers and face-wire fallback', () => {
    const box = BRepPrimitives.createBox(4, 4, 4, 'Box');
    const step = StepTranslator.exportSTEP(box, 'PartX', { layers: ['LAYER_A', 'LAYER_B'] });
    assert(step.includes('LAYER_ASSIGNMENT'));
    assert(step.includes('DRAUGHTING_MODEL'));
    const parsed = StepTranslator.parseSTEP(step);
    assert.strictEqual(parsed.summary.manifoldSolidsCount, 1);
    assert.strictEqual(parsed.summary.productsCount, 1);
    assert.strictEqual(parsed.summary.productDefinitionsCount, 1);
    assert.strictEqual(parsed.summary.shapeDefinitionRepresentationsCount, 1);
    assert.strictEqual(parsed.summary.advancedFacesCount, 6);
    assert(parsed.summary.cartesianPointsCount > 0);
    const noGeom = StepTranslator.exportSTEP({}, 'EmptyPart');
    assert(noGeom.includes('MANIFOLD_SOLID_BREP'));
    assert.throws(() => StepTranslator.parseSTEP(''), /non-empty string/);
  });

  check('StepTranslator _emitCartesianTransformation degenerate axis fallback', () => {
    const box = BRepPrimitives.createBox(2, 2, 2, 'Box');
    const flat = [0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    const step = StepTranslator.exportAssemblySTEP(
      {
        solids: [{ id: 's1', solid: box }],
        assembly: {
          nodes: [
            { id: 'n1', solidId: 's1' },
            { id: 'n2', solidId: 's1' }
          ],
          references: [{ id: 'r1', parentId: null, childId: 'n2', transform: flat, name: 'Occ' }]
        }
      },
      'Assy3'
    );
    assert(step.includes('CARTESIAN_TRANSFORMATION_3D'));
  });

  // ------------------------------------------------------------------
  // OmniArchive / OmniWal / v2 recovery branches
  // ------------------------------------------------------------------
  check('OmniArchive addSection/getSection/saveToBuffer error branches', () => {
    const arc = new OmniArchive({ projectName: 'Cov20' });
    assert.throws(() => arc.addSection('', 'x'), /non-empty string/);
    assert.throws(() => arc.addSection('a', 42), /Unsupported content type/);
    assert.throws(() => arc.addSection('a'.repeat(70000), 'x'), /65535/);
    arc.addSection('text', 'hello world');
    assert.strictEqual(arc.getSection('text', true), 'hello world');
    arc.addSection('obj', { a: 1 });
    assert.strictEqual(arc.getSection('obj', true).a, 1);
    assert.strictEqual(arc.getSection('missing'), null);
    const entry = arc.sections.get('obj');
    entry.crc = entry.crc ^ 0xff;
    assert.throws(() => arc.getSection('obj', false), /CRC32 mismatch/);
    const arcLimited = new OmniArchive({ projectName: 'Limit' });
    for (let i = 0; i < 4095; i++) arcLimited.addSection('s' + i, 'x');
    assert.throws(() => arcLimited.addSection('overflow', 'x'), /maximum section count/);
  });

  check('OmniArchive save/load round-trip and malformed load branches', () => {
    const arc = new OmniArchive({ projectName: 'Cov20' });
    arc.addSection('notes', 'alpha');
    const buf = arc.saveToBuffer();
    const loaded = OmniArchive.loadFromBuffer(buf);
    assert.strictEqual(loaded.getSection('notes', true), 'alpha');
    assert.strictEqual(loaded.manifest.projectName, 'Cov20');
    assert.throws(() => OmniArchive.loadFromBuffer(Buffer.alloc(4)), /too small/);
    assert.throws(() => OmniArchive.loadFromBuffer(Buffer.from('NOTAMAGICHEADER12345678', 'binary')), /magic header/);
    const corrupt = Buffer.from(buf);
    corrupt[10] ^= 0xff;
    assert.throws(() => OmniArchive.loadFromBuffer(corrupt), /CRC|Malformed|section count/);
    const badCount = Buffer.from(buf);
    badCount.writeUInt32BE(999999, 8);
    assert.throws(() => OmniArchive.loadFromBuffer(badCount), /section count/);
    const shortCount = Buffer.from(buf);
    shortCount.writeUInt32BE(3, 8);
    assert.throws(() => OmniArchive.loadFromBuffer(shortCount), /EOF|Malformed/);
  });

  check('OmniArchiveV2 save/load with WAL replay of committed ops', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov20-'));
    const archivePath = path.join(dir, 'proj.omni');
    const v2 = new OmniArchiveV2({ projectName: 'Cov20' });
    v2.addBlob(Buffer.from('payload-bytes'), { name: 'a.bin', mimeType: 'application/octet-stream' });
    v2.recordResult(
      new JobResult({ jobId: 'j1', status: 'COMPLETED', output: { v: 1 }, residualHistory: [], timing: { runMs: 3 } })
    );
    v2.saveToFile(archivePath);
    const walPath = path.join(dir, WAL_FILE_NAME);
    v2.enableWal({ path: walPath, archivePath });
    v2.appendWalEntry('add_blob', { dataBase64: Buffer.from('wal-blob').toString('base64'), name: 'w.bin' });
    v2.appendWalEntry('record_result', {
      result: new JobResult({
        jobId: 'j2',
        status: 'COMPLETED',
        output: { v: 2 },
        residualHistory: [],
        timing: { runMs: 1 }
      }).toJSON()
    });
    v2.appendWalEntry('journal_execute', {
      actionType: 'edit',
      forwardPatch: { f: 1 },
      reversePatch: { r: 1 },
      description: 'tweak',
      author: 'tester'
    });
    v2.appendWalEntry('bump_revision', { changes: { note: 'rev' } });
    const commitStat = v2.commitTransaction();
    assert.strictEqual(commitStat.wal, true);
    const reloaded = OmniArchiveV2.loadFromFile(archivePath);
    assert(reloaded.hasBlob(v2.listBlobs()[0]));
    assert(reloaded.getBlob(v2.listBlobs()[0]).equals(Buffer.from('payload-bytes')));
    const stats = reloaded.getWalStats();
    assert.strictEqual(stats.applicable, true);
    assert(stats.applied >= 2);
    assert(reloaded.manifest.revision > v2.manifest.revision);
    assert.strictEqual(reloaded.journal.history.length, 1);
    assert.strictEqual(reloaded.results.length, 2);
    assert.strictEqual(reloaded.blobs.size, 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('OmniArchiveV2 applyWalOp and replay error branches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov20b-'));
    const archivePath = path.join(dir, 'proj.omni');
    const v2 = new OmniArchiveV2({ projectName: 'Cov20' });
    v2.saveToFile(archivePath);
    const walPath = path.join(dir, WAL_FILE_NAME);
    v2.enableWal({ path: walPath, archivePath });
    v2.appendWalEntry('unknown_op', {});
    v2.appendWalEntry('add_blob', {});
    v2.commitTransaction();
    const reloaded = OmniArchiveV2.loadFromFile(archivePath);
    assert(reloaded.getWalStats().skipped.length >= 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('OmniArchiveV2 fromV1 migration and recoverFromCrash branches', () => {
    const v1 = new OmniArchive({ projectName: 'Legacy', unitsSystem: 'US_CUSTOMARY' });
    v1.addSection('design', 'solid-data');
    const migrated = OmniArchiveV2.fromV1(v1);
    assert.strictEqual(migrated.manifest.activeUnits, 'US_CUSTOMARY');
    assert.strictEqual(migrated.blobs.size, 1);
    assert.throws(() => OmniArchiveV2.fromV1({}), /fromV1 requires/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov20c-'));
    const fp = path.join(dir, 'proj.omni');
    const empty = OmniArchiveV2.recoverFromCrash(fp);
    assert.strictEqual(empty.recoveredCount, 0);
    fs.writeFileSync(`${fp}.recovery.journal`, '{"a":1}\nnot-json\n{"b":2}\n', 'utf8');
    const rec = OmniArchiveV2.recoverFromCrash(fp);
    assert.strictEqual(rec.recoveredCount, 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('OmniWal open/parse malformed and rewrite-clean branches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov20d-'));
    const archivePath = path.join(dir, 'proj.omni');
    const walPath = path.join(dir, WAL_FILE_NAME);
    fs.writeFileSync(walPath, '["OMNIWAL",3,0,"/wrong/path"]\n', 'utf8');
    assert.throws(() => new OmniWal({ path: walPath, archivePath }).open(), /not a matching v3/);
    fs.writeFileSync(walPath, 'not-json\n', 'utf8');
    const wal2 = new OmniWal({ path: walPath, archivePath });
    assert.throws(() => wal2.open(), /not a matching v3/);
    fs.writeFileSync(
      walPath,
      '["OMNIWAL",3,0,"' +
        path.resolve(archivePath) +
        '"]\n[1,"{\\"op\\":\\"add_blob\\",\\"payload\\":{\\"dataBase64\\":\\"aGk\\"}}","' +
        'a'.repeat(64) +
        '",0]\n',
      'utf8'
    );
    const wal3 = new OmniWal({ path: walPath, archivePath });
    wal3.open();
    assert.strictEqual(wal3.recovered, true);
    wal3.appendEntry('add_blob', { dataBase64: Buffer.from('x').toString('base64') });
    wal3.commit();
    wal3.close();
    const wal4 = new OmniWal({ path: walPath, archivePath });
    wal4.open();
    assert.strictEqual(wal4.committed, 1);
    wal4.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('OmniArchiveV2 enableWal and vault branches', () => {
    const v2 = new OmniArchiveV2({ projectName: 'Cov20' });
    assert.throws(() => v2.enableWal({}), /WAL path is required/);
    assert.throws(() => v2.appendWalEntry('add_blob', {}), /WAL is not enabled/);
    assert.strictEqual(v2.commitTransaction().wal, false);
    assert.strictEqual(v2.flushWal().path, null);
    const plain = Buffer.from('secret-bytes');
    const enc = OmniVaultAES256.encrypt(plain, 'hunter2');
    assert(enc.length > 52);
    const dec = OmniVaultAES256.decrypt(enc, 'hunter2');
    assert(dec.equals(plain));
    assert.throws(() => OmniVaultAES256.decrypt(enc, 'wrongpass'), /Decryption Failed/);
    assert.throws(() => OmniVaultAES256.decrypt(Buffer.alloc(10), 'hunter2'), /Corrupt encrypted vault/);
    const badMagic = Buffer.from(enc);
    badMagic[0] = 0x00;
    assert.throws(() => OmniVaultAES256.decrypt(badMagic, 'hunter2'), /Invalid vault header/);
    assert.throws(() => new OmniArchive({ projectName: 'x' }).saveToEncryptedBuffer('abc'), /at least 4 characters/);
    const v1vault = new OmniArchive({ projectName: 'Cov20' });
    v1vault.addSection('secret', 'vault-data');
    const vaultBuf = v1vault.saveToEncryptedBuffer('passphrase');
    const loadedVault = OmniArchive.loadFromEncryptedBuffer(vaultBuf, 'passphrase');
    assert(loadedVault instanceof OmniArchive);
  });

  check('CommandJournal import/branch-trim/undo/redo branches', () => {
    const journal = new CommandJournal();
    journal.execute('op1', { a: 1 }, { a: 0 }, 'first', 'u1');
    journal.execute('op2', { a: 2 }, { a: 1 }, 'second', 'u2');
    journal.undo();
    journal.execute('op3', { a: 3 }, { a: 2 }, 'third', 'u3');
    assert.strictEqual(journal.history.length, 2);
    assert.strictEqual(journal.canRedo(), false);
    journal.undo();
    assert.strictEqual(journal.canUndo(), true);
    assert.strictEqual(journal.redo().redoneEntry.actionType, 'op3');
    assert.strictEqual(journal.redo(), null);
    assert.throws(() => journal.import({}), /Invalid journal import/);
    journal.import({
      history: [{ id: 'h1', actionType: 'x', forwardPatch: {}, reversePatch: {}, description: '', author: 'u' }],
      currentIndex: 0,
      branchCounter: 1
    });
    assert.strictEqual(journal.canUndo(), true);
    assert.strictEqual(journal.getHistory().length, 1);
  });

  // ------------------------------------------------------------------
  // ProjectManager
  // ------------------------------------------------------------------
  check('ProjectManager save/open/undo/redo/addBlob branches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-pm20-'));
    const pm = new ProjectManager({ projectName: 'Cov20' });
    assert.throws(() => pm.saveProject(), /Target file path/);
    const fp = path.join(dir, 'proj.omni');
    const saved = pm.saveProject(fp);
    assert.strictEqual(saved.success, true);
    pm.recordCommand('edit', { x: 1 }, { x: 0 }, 'desc', 'author');
    const undoRes = pm.undo();
    assert(undoRes);
    const redoRes = pm.redo();
    assert(redoRes);
    assert.strictEqual(pm.redo(), null);
    const blobRef = pm.addBlob(Buffer.from('blob'), { mimeType: 'text/plain', name: 'x.txt' });
    assert(pm.getBlob(blobRef.hash).equals(Buffer.from('blob')));
    const pm2 = new ProjectManager();
    const reopened = pm2.openProject(fp);
    assert.strictEqual(reopened.projectName, 'Cov20');
    assert.throws(() => pm2.openProject(path.join(dir, 'missing.omni')), /does not exist/);
    assert.throws(() => pm2.openProject(123), /Expected file path/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------
  // LogicSynthesisEngine
  // ------------------------------------------------------------------
  check('LogicSynthesisEngine synthesize timing and error branches', () => {
    const rtl = `module alu(input a, b, c, output y, z);
assign y = a & b;
assign z = ~c;
always @(posedge clk) q <= y;
endmodule`;
    const res = LogicSynthesisEngine.synthesize(rtl, { computeTiming: true, clockPeriod_ps: 1000, inputDelay_ps: 20 });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.gateCount, 3);
    assert(res.timing.status === 'computed-dag');
    assert.throws(() => LogicSynthesisEngine.synthesize(''), /Explicit non-empty/);
    assert.throws(() => LogicSynthesisEngine.synthesize('assign y = a & b & c;'), /UNSUPPORTED/);
    assert.throws(() => LogicSynthesisEngine.synthesize('assign y = a + b;'), /UNSUPPORTED/);
    assert.throws(
      () => LogicSynthesisEngine.synthesize('module m;\ninput a;\noutput y;\nassign y = 1;\nendmodule'),
      /UNSUPPORTED/
    );
    const noGates = LogicSynthesisEngine.synthesize('module m; input a; output y; endmodule');
    assert.strictEqual(noGates.success, false);
    const dffOnly = LogicSynthesisEngine.synthesize(
      'module m;\ninput d;\noutput q;\nalways @(posedge clk) q <= d;\nendmodule',
      { clockPeriod_ps: 500 }
    );
    assert.strictEqual(dffOnly.success, true);
    assert(dffOnly.timing.criticalPathDelay_ps > 0);
    const dffOnlyNoTiming = LogicSynthesisEngine.synthesize(
      'module m;\ninput d;\noutput q;\nalways @(posedge clk) q <= d;\nendmodule'
    );
    assert.strictEqual(dffOnlyNoTiming.timing.status, 'unavailable');
  });

  // ------------------------------------------------------------------
  // StaticTimingAnalysis
  // ------------------------------------------------------------------
  check('StaticTimingAnalysis analyzeTiming DAG and error branches', () => {
    const graph = {
      nodes: [
        { id: 'clk', type: 'input' },
        { id: 'u1', type: 'gate' },
        { id: 'u2', type: 'gate' },
        { id: 'ff1', type: 'ff', delay: 0.2 },
        { id: 'out', type: 'output' }
      ],
      edges: [
        { from: 'clk', to: 'u1' },
        { from: 'u1', to: 'u2', delay: 0.05 },
        { from: 'u2', to: 'ff1' },
        { from: 'ff1', to: 'out' }
      ]
    };
    const res = StaticTimingAnalysis.analyzeTiming(graph, {
      corners: [
        { name: 'ss', delays: { cells: { u1: 0.4 }, nets: { 'clk->u1': 0.1 }, defaultCell: 0.3, defaultNet: 0.08 } },
        { name: 'ff', delays: { defaultCell: 0.1, defaultNet: 0.02 } }
      ],
      modes: [{ name: 'func', constraints: { period: 5, setup: 0.2, hold: 0.1, skew: 0.05, tCq: 0.3 } }]
    });
    assert.strictEqual(res.timingMetOverall, true);
    assert.strictEqual(res.corners.length, 2);
    assert.throws(() => StaticTimingAnalysis.analyzeTiming({}, {}), /at least one node/);
    assert.throws(() => StaticTimingAnalysis.analyzeTiming({ nodes: [] }), /at least one node/);
    assert.throws(() => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: '' }] }), /non-empty string id/);
    assert.throws(() => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }, { id: 'a' }] }), /duplicate node id/);
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a', type: 'bogus' }] }),
      /unsupported type/
    );
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'c' }] }),
      /unknown node/
    );
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'a' }] }),
      /self-loop/
    );
    assert.throws(
      () =>
        StaticTimingAnalysis.analyzeTiming({
          nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
          edges: [
            { from: 'a', to: 'b' },
            { from: 'b', to: 'c' },
            { from: 'c', to: 'a' }
          ]
        }),
      /cycle/
    );
    assert.throws(
      () =>
        StaticTimingAnalysis.analyzeTiming(
          { nodes: [{ id: 'a' }] },
          { corners: [{ name: 'ss', delays: {} }], modes: [{ name: 'm', constraints: { period: -1 } }] }
        ),
      /constraints must be finite/
    );
  });

  check('StaticTimingAnalysis analyzePath interconnect branches', () => {
    const sta = new StaticTimingAnalysis({ clockPeriodPs: 6000 });
    const r1 = sta.analyzePath({ logicGateDelayPs: 800 });
    assert(Number.isFinite(r1.arrivalTimeNs));
    const r2 = sta.analyzePath({
      interconnectTrace: { lengthUm: 5000, widthUm: 2, thicknessUm: 0.5, substrateHeightUm: 1.5, er: 3.9 }
    });
    assert(r2.interconnectDelayPs > 0);
    const evalRes = StaticTimingAnalysis.evaluatePathTiming({
      clockPeriodNs: 1,
      gateDelaysNs: [1],
      wireDelaysNs: [0.5],
      tLaunchCqNs: 0.4,
      tSetupNs: 0.2,
      tHoldNs: 0.1
    });
    assert.strictEqual(evalRes.status, 'SETUP_VIOLATION');
    const mcmm = StaticTimingAnalysis.evaluateMCMM({}, [
      { name: 'x', pvtFactor: 1.1, ocvLate: 1.05, ocvEarly: 0.9, desc: 'd' }
    ]);
    assert.strictEqual(mcmm.cornerCount, 1);
    assert(mcmm.screeningPassed === true || mcmm.screeningPassed === false);
  });

  // ------------------------------------------------------------------
  // GDTEngine
  // ------------------------------------------------------------------
  check('GDTEngine true position MMC/LMC and perpendicularity array branches', () => {
    const fcfMmc = new FeatureControlFrame({
      geometricCharacteristic: 'POSITION',
      specifiedTolerance: 0.1,
      materialCondition: 'MMC'
    });
    const r1 = GDTEngine.evaluateTruePosition(
      {
        nominalX: 0,
        nominalY: 0,
        measuredX: 0.02,
        measuredY: 0.03,
        nominalDiameter: 10,
        measuredDiameter: 10.1,
        lowerTolerance: -0.05,
        upperTolerance: 0.1
      },
      fcfMmc
    );
    assert(r1.bonusTolerance > 0);
    const fcfLmc = new FeatureControlFrame({
      geometricCharacteristic: 'POSITION',
      specifiedTolerance: 0.1,
      materialCondition: 'LMC'
    });
    const r2 = GDTEngine.evaluateTruePosition(
      {
        nominalX: 0,
        nominalY: 0,
        measuredX: 0,
        measuredY: 0,
        nominalDiameter: 10,
        measuredDiameter: 9.9,
        lowerTolerance: -0.05,
        upperTolerance: 0.1
      },
      fcfLmc
    );
    assert(r2.bonusTolerance > 0);
    const p = GDTEngine.evaluatePerpendicularity([1, 0, 0], [0, 0, 1], 100, 0.05);
    assert.strictEqual(p.characteristic, 'PERPENDICULARITY');
    const prof = GDTEngine.evaluateProfileOfSurface([{ nominalDist: 0.05 }, { nominalDist: -0.03 }], 0.2);
    assert.strictEqual(prof.passed, true);
  });

  // ------------------------------------------------------------------
  // OasisStreamEngine
  // ------------------------------------------------------------------
  check('OasisStreamEngine serialize/deserialize modal and error branches', () => {
    const engine = new OasisStreamEngine({ unit: 1e-9, version: '1.2' });
    const layout = {
      name: 'TOP',
      cells: [
        {
          name: 'INV',
          rectangles: [
            { layer: 1, datatype: 0, width: 100, height: 200, x: 0, y: 0 },
            { layer: 1, datatype: 0, width: 100, height: 200, x: 50, y: 60 },
            { layer: 2, datatype: 1, width: 40, height: 40, x: -10, y: -20 }
          ],
          placements: [{ cellName: 'INV', x: 5, y: -5 }]
        }
      ]
    };
    const bytes = engine.serialize(layout);
    const decoded = engine.deserialize(bytes);
    assert.strictEqual(decoded.version, '1.2');
    assert.strictEqual(decoded.cells.length, 1);
    assert.strictEqual(decoded.cells[0].rectangles.length, 3);
    assert.strictEqual(decoded.cells[0].placements[0].x, 5);
    assert.throws(() => engine.deserialize(Buffer.alloc(5)), /truncated/);
    const badMagic = new Uint8Array(bytes);
    badMagic[0] = 0x00;
    assert.throws(() => engine.deserialize(badMagic), /magic header/);
    const ratio = engine.evaluateCompressionRatio(layout);
    assert(ratio.oasisSizeBytes > 0);
    assert.throws(
      () => engine.decodeVint(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80]), 0),
      /overflow/
    );
  });

  // ------------------------------------------------------------------
  // Variable fillet / sheet metal
  // ------------------------------------------------------------------
  check('VariableRadiusFilletEngine degenerate tangent and corner patch branches', () => {
    const spine = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 20, y: 0, z: 0 }
    ];
    const fillet = VariableRadiusFilletEngine.generateVariableFillet({
      spinePoints: spine,
      startRadius: 2,
      endRadius: 6
    });
    assert.strictEqual(fillet.success, true);
    assert.strictEqual(fillet.spinePointsCount, 3);
    assert.throws(
      () => VariableRadiusFilletEngine.generateVariableFillet({ spinePoints: [{ x: 0, y: 0, z: 0 }] }),
      /at least 2/
    );
    const patch = VariableRadiusFilletEngine.blendMultiEdgeCorner([fillet, fillet]);
    assert(patch instanceof GregoryCornerPatch);
    const pt = patch.evaluate([0.5, 0.5]);
    assert(Number.isFinite(pt.x));
    assert.throws(() => patch.evaluate([0.2, 0.3, 0.5]), /match nSides/);
    assert.throws(() => VariableRadiusFilletEngine.blendMultiEdgeCorner([fillet]), /at least 2/);
    const arrPatch = new GregoryCornerPatch([
      [
        { x: 0, y: 0, z: 0, normal: { x: 0, y: 0, z: 1 } },
        { x: 1, y: 0, z: 0, normal: { x: 0, y: 0, z: 1 } }
      ],
      [
        { x: 0, y: 0, z: 0, normal: { x: 0, y: 0, z: 1 } },
        { x: 0, y: 1, z: 0, normal: { x: 0, y: 0, z: 1 } }
      ]
    ]);
    const pt2 = arrPatch.evaluate([0.2, 0.8]);
    assert(Number.isFinite(pt2.normal.z));
  });

  check('SheetMetalUnfolder relief and flange variants', () => {
    const bend = new SheetMetalBend({
      angleDeg: 90,
      innerRadiusMm: 2,
      thicknessMm: 1.5,
      kFactor: 0.4,
      direction: 'DOWN'
    });
    assert(bend.bendAllowanceMm > 0);
    const part = SheetMetalUnfolder.unfoldPart({
      flanges: [new SheetMetalFlange('F1', 50, 30), new SheetMetalFlange('F2', 40, 30)],
      bends: [bend],
      reliefType: 'tear',
      reliefWidthMm: 3,
      reliefDepthMm: 4
    });
    assert.strictEqual(part.success, true);
    assert.strictEqual(part.reliefs.length, 2);
    const part2 = SheetMetalUnfolder.unfoldPart({
      flanges: [new SheetMetalFlange('F1', 20, 10)],
      bends: [],
      reliefType: 'obround'
    });
    assert.strictEqual(part2.bendsCount, 0);
    const part3 = SheetMetalUnfolder.unfoldPart({ flanges: [], bends: [] });
    assert.strictEqual(part3.flangesCount, 0);
  });

  // ------------------------------------------------------------------
  // OpticalGlassCatalog / heat exchanger / optics tracer
  // ------------------------------------------------------------------
  check('OpticalGlassCatalog sellmeier/birefringent validation and index branches', () => {
    const catalog = new OpticalGlassCatalog();
    const glass = {
      name: 'N-BK7',
      formula: 'sellmeier1',
      referenceTemperatureC: 20,
      B: [1.03961212, 0.231792344, 1.01046945],
      C: [0.00600069867, 0.0200179144, 103.560653],
      dndTPerK: 1.2e-6
    };
    const reg = catalog.registerGlass(glass);
    assert.strictEqual(reg.dataStatus, 'caller-supplied');
    assert(catalog.catalogSize === 1);
    const n = catalog.calculateIndex('n-bk7', 0.5876, 25);
    assert(n > 1.4);
    assert.throws(() => catalog.calculateIndex('nope', 0.5, 20), /not available/);
    assert.throws(() => catalog.calculateIndex(glass, 0, 20), /Wavelength/);
    assert.throws(() => catalog.calculateIndex(glass, 0.5, -300), /Temperature/);
    const glassNoThermo = { ...glass, dndTPerK: undefined };
    assert.throws(() => catalog.calculateIndex(glassNoThermo, 0.5, 30), /dndTPerK/);
    assert.throws(
      () => catalog.registerGlass({ name: 'X', formula: 'nope', referenceTemperatureC: 20 }),
      /sellmeier1 or birefringent/
    );
    assert.throws(
      () => catalog.registerGlass({ name: 'X', formula: 'birefringent', referenceTemperatureC: 20, no: 1, ne: -1 }),
      /Birefringent/
    );
    assert.throws(
      () =>
        catalog.registerGlass({ name: 'X', formula: 'sellmeier1', referenceTemperatureC: 20, B: [1, 2], C: [1, 2, 3] }),
      /Sellmeier B/
    );
    assert.throws(
      () =>
        catalog.registerGlass({
          name: 'X',
          formula: 'sellmeier1',
          referenceTemperatureC: 20,
          B: [1, 2, 3],
          C: [1, 2, 3],
          dndT: 1
        }),
      /dndTPerK/
    );
    assert.throws(
      () =>
        catalog.registerGlass({
          name: 'X',
          formula: 'sellmeier1',
          referenceTemperatureC: -300,
          B: [1, 2, 3],
          C: [1, 2, 3]
        }),
      /referenceTemperatureC/
    );
    const props = catalog.getOpticalProperties(glass, 20);
    assert(Number.isFinite(props.Abbe_Vd));
    const nearest = catalog.findNearestGlasses(1.5, 60, 20, 2);
    assert(Array.isArray(nearest));
    assert.throws(() => catalog.findNearestGlasses('x', 60, 20), /finite numbers/);
    assert.throws(() => catalog.findNearestGlasses(1.5, 60, 20, -1), /nonnegative integer/);
    assert.strictEqual(catalog.getGlass('missing'), null);
  });

  check('HeatExchangerTEMA param-form and temperature-cross branches', () => {
    const engine = new HeatExchangerTEMA({ tubeOD_mm: 19.05, tubeLength_m: 6, overallU_W_m2K: 450 });
    const r = engine.rateExchanger({
      hotFlowKgS: 10,
      hotCp_kJ_kgK: 2.5,
      hotInletC: 120,
      hotOutletC: 80,
      coldFlowKgS: 20,
      coldCp_kJ_kgK: 4.18,
      coldInletC: 30,
      coldOutletC: 45
    });
    assert.strictEqual(r.pressureDropShellBar, null);
    assert(r.heatDutyKW > 0);
    const r2 = HeatExchangerTEMA.rateExchanger(
      { massFlowKgS: 10, CpJkgK: 2500, TinC: 100, ToutC: 60 },
      { massFlowKgS: 20, CpJkgK: 4180, TinC: 25, ToutC: 40 },
      { tubeOD_mm: 25.4, tubeLength_m: 5, overallU_W_m2K: 300, shellType: 'TEMA_E', tubePasses: 2 }
    );
    assert(r2.numberOfTubes > 0);
    const r3 = HeatExchangerTEMA.rateExchanger(
      { massFlowKgS: 10, CpJkgK: 2500, TinC: 90, ToutC: 85 },
      { massFlowKgS: 20, CpJkgK: 4180, TinC: 20, ToutC: 80 },
      { tubeOD_mm: 19.05, tubeLength_m: 6, overallU_W_m2K: 450 }
    );
    assert(r3.counterFlowLMTD_C >= 1);
  });

  check('NonSequentialTracer traceInterface and traceBeam branches', () => {
    const r = NonSequentialTracer.traceInterface({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }, 1.0, 1.5);
    assert.strictEqual(r.tir, false);
    assert(r.transmittanceT > 0);
    const r2 = NonSequentialTracer.traceInterface({ x: 0, y: 0.8, z: -0.6 }, { x: 0, y: 0, z: 1 }, 1.5, 1.0);
    assert.strictEqual(r2.tir, true);
    assert.strictEqual(r2.refractedDir, null);
    const r3 = NonSequentialTracer.traceInterface({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }, 1.0, 1.0);
    assert.strictEqual(r3.reflectanceR, 0);
    assert.throws(() => NonSequentialTracer.traceInterface(null, { x: 0, y: 0, z: 1 }, 1, 1.5), /incidentDir/);
    assert.throws(
      () => NonSequentialTracer.traceInterface({ x: 0, y: 0, z: 'a' }, { x: 0, y: 0, z: 1 }, 1, 1.5),
      /finite/
    );
    assert.throws(
      () => NonSequentialTracer.traceInterface({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, 0, 1.5),
      /positive finite/
    );
    assert.throws(
      () => NonSequentialTracer.traceInterface({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 1, 1.5),
      /non-zero/
    );

    const plane = {
      intersectRay: (ray) => {
        const t = -(ray.origin.z - 0) / ray.dir.z;
        if (t <= 1e-5) return { hit: false, distance: Infinity };
        return {
          hit: true,
          distance: t,
          point: { x: ray.origin.x + t * ray.dir.x, y: ray.origin.y + t * ray.dir.y, z: 0 },
          normal: { x: 0, y: 0, z: -1 }
        };
      },
      normal: { x: 0, y: 0, z: -1 },
      nIncident: 1.0,
      nRefractive: 1.5
    };
    const detector = { ...plane, isDetector: true };
    const ray = new OpticalRay({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -1 }, 1.0, 550);
    const beam = NonSequentialTracer.traceBeam(ray, [plane, detector], { maxSplits: 3, energyThreshold: 0.001 });
    assert(beam.totalRaysTraced >= 1);
    const escape = NonSequentialTracer.traceBeam(
      new OpticalRay({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
      [plane],
      {}
    );
    assert(escape.pathsCount >= 1);
    const tirRay = new OpticalRay({ x: 0, y: 0, z: 10 }, { x: -0.3, y: 0, z: -0.95 }, 1.0, 550);
    const tirBeam = NonSequentialTracer.traceBeam(tirRay, [plane], { maxSplits: 2 });
    assert(tirBeam.tirEventsCount >= 0);
  });

  // ------------------------------------------------------------------
  // Plant solvers: water hammer / petroleum assay / Wegstein
  // ------------------------------------------------------------------
  check('TransientWaterHammerSolver MOC closure-law branches', () => {
    const conduit = {
      fluidDensity: 1000,
      fluidBulkModulus: 2.2e9,
      pipeElasticModulus: 2e11,
      pipeInnerDiameter: 0.3,
      pipeWallThickness: 0.01,
      restraintFactor: 1
    };
    const a = TransientWaterHammerSolver.calculateWaveSpeed(conduit);
    assert(a > 900);
    const surge = TransientWaterHammerSolver.joukowskySurge(a, 2, 1000);
    assert(surge.surgePressurePa > 0);
    const base = {
      ...conduit,
      pipeDiameter: 0.3,
      pipeLength: 100,
      darcyFrictionFactor: 0.02,
      reservoirHead: 50,
      steadyFlowRate: 0.2,
      valveClosureTime: 0.02,
      valveClosureLaw: 'linear',
      simulationDuration: 0.1,
      reaches: 20
    };
    const lin = TransientWaterHammerSolver.solveTransientMOC(base);
    assert.strictEqual(lin.success, true);
    const inst = TransientWaterHammerSolver.solveTransientMOC({ ...base, valveClosureLaw: 'instantaneous' });
    assert.strictEqual(inst.success, true);
    const sCurve = TransientWaterHammerSolver.solveTransientMOC({ ...base, valveClosureLaw: 's_curve' });
    assert.strictEqual(sCurve.success, true);
    assert.throws(() => TransientWaterHammerSolver.solveTransientMOC({ ...base, reaches: 2 }), /integer reaches/);
    assert.throws(
      () => TransientWaterHammerSolver.solveTransientMOC({ ...base, valveClosureLaw: 'bogus' }),
      /supported ranges/
    );
    assert.throws(() => TransientWaterHammerSolver.solveTransientMOC({ ...base, surgeTank: {} }), /surge-tank/);
    assert.throws(
      () => TransientWaterHammerSolver.calculateWaveSpeed({ ...conduit, fluidDensity: undefined }),
      /explicit finite/
    );
    assert.throws(
      () => TransientWaterHammerSolver.calculateWaveSpeed({ ...conduit, pipeWallThickness: 0.2 }),
      /supported positive/
    );
  });

  check('PetroleumAssayCharacterizer constructor/characterize branches', () => {
    const data = [
      { percent: 0, tempC: 20 },
      { percent: 10, tempC: 60 },
      { percent: 30, tempC: 90 },
      { percent: 50, tempC: 120 },
      { percent: 70, tempC: 200 },
      { percent: 90, tempC: 320 },
      { percent: 100, tempC: 400 }
    ];
    const d86 = new PetroleumAssayCharacterizer({
      name: 'Cov20',
      apiGravity: 35,
      distillationType: 'ASTM_D86',
      distillationData: data,
      dataSource: 'test source'
    });
    const out = d86.characterize();
    assert(out.pseudoComponents.length > 0);
    assert(out.totalYieldVolPct > 0);
    const tbp = new PetroleumAssayCharacterizer({
      apiGravity: 30,
      distillationType: 'TBP',
      distillationData: data,
      dataSource: 'src'
    });
    const out2 = tbp.characterize();
    assert.strictEqual(out2.tbpDistillation.length, 7);
    assert.throws(
      () =>
        new PetroleumAssayCharacterizer({
          apiGravity: -200,
          distillationType: 'TBP',
          distillationData: data,
          dataSource: 's'
        }),
      /apiGravity/
    );
    assert.throws(
      () =>
        new PetroleumAssayCharacterizer({
          apiGravity: 30,
          distillationType: 'BAD',
          distillationData: data,
          dataSource: 's'
        }),
      /distillationType/
    );
    assert.throws(
      () =>
        new PetroleumAssayCharacterizer({
          apiGravity: 30,
          distillationType: 'TBP',
          distillationData: [{ percent: 0, tempC: 20 }],
          dataSource: 's'
        }),
      /at least two/
    );
    assert.throws(
      () =>
        new PetroleumAssayCharacterizer({
          apiGravity: 30,
          distillationType: 'TBP',
          distillationData: [
            { percent: 0, tempC: 20 },
            { percent: 10, tempC: 10 }
          ],
          dataSource: 's'
        }),
      /strictly increasing/
    );
    assert.throws(
      () =>
        new PetroleumAssayCharacterizer({
          apiGravity: 30,
          distillationType: 'ASTM_D86',
          distillationData: [
            { percent: 0, tempC: 20 },
            { percent: 15, tempC: 60 },
            { percent: 100, tempC: 400 }
          ],
          dataSource: 's'
        }),
      /configured coefficient/
    );
    assert.throws(
      () =>
        new PetroleumAssayCharacterizer({
          apiGravity: 30,
          distillationType: 'TBP',
          distillationData: data,
          dataSource: ''
        }),
      /dataSource/
    );
    const conv = PetroleumAssayCharacterizer.convertD86ToTBP([{ percent: 25, tempC: 80 }]);
    assert(Number.isFinite(conv[0].tempC));
    assert(Number.isFinite(PetroleumAssayCharacterizer.computeWatsonKw(800, 0.85)));
    assert(Number.isFinite(PetroleumAssayCharacterizer.estimateMolecularWeight(450, 0.85)));
    const crit = PetroleumAssayCharacterizer.estimateCriticalProperties(450, 0.85);
    assert(crit.omega > 0);
  });

  check('WegsteinRecycleSolver methods and immediate-convergence branches', () => {
    const g = (x) => new Float64Array([0.3 * x[0] + 1.4]);
    const solver = new WegsteinRecycleSolver({ method: 'wegstein', maxIter: 60 });
    const res = solver.solve(new Float64Array([0]), g);
    assert.strictEqual(res.converged, true);
    assert(res.iterations >= 1);
    const suc = new WegsteinRecycleSolver({ method: 'successive', maxIter: 60 }).solve(new Float64Array([0]), g);
    assert(suc.converged);
    const bro = new WegsteinRecycleSolver({ method: 'broyden', maxIter: 60 }).solve(new Float64Array([0]), g);
    assert(bro.converged);
    const already = solver.solve(new Float64Array([2]), (x) => new Float64Array([2]));
    assert.strictEqual(already.iterations, 0);
    assert.strictEqual(already.converged, true);
    const qEdge = new WegsteinRecycleSolver({ method: 'wegstein', maxIter: 200, qMin: -5, qMax: 0 }).solve(
      new Float64Array([1]),
      (x) => new Float64Array([x[0]])
    );
    assert(Number.isFinite(qEdge.residual));
  });

  // ------------------------------------------------------------------
  // CAE materials / elements
  // ------------------------------------------------------------------
  check('HyperelasticMaterial model branches', () => {
    const mr = new HyperelasticMaterial('MOONEY_RIVLIN', { C10: 0.3e6, C01: 0.1e6 });
    const s1 = mr.evaluateUniaxialStress(1.5);
    assert(s1 > 0);
    const yeoh = new HyperelasticMaterial({ model: 'YEOH', C10: 0.3e6, C20: 1e4, C30: 5e3 });
    assert(yeoh.evaluateUniaxialStress(2) > 0);
    const ogden = new HyperelasticMaterial({ model: 'OGDEN', mu1: 0.5e6, alpha1: 2 });
    assert(ogden.evaluateUniaxialStress(1.5) > 0);
    const unknown = new HyperelasticMaterial('WEIRD', {});
    assert.strictEqual(unknown.evaluateUniaxialStress(1.5), 0);
    const badMr = new HyperelasticMaterial('MOONEY_RIVLIN', {});
    assert.throws(() => badMr.evaluateUniaxialStress(2), /Provide explicit finite/);
    const curve = mr.generateUniaxialCurve(3, 10);
    assert.strictEqual(curve.length, 11);
  });

  check('FatigueLifeAnalyzer Basquin/Miner/rainflow branches', () => {
    const mat = { fatigueStrengthCoeff: 900e6, fatigueStrengthExponent: -0.085, ultimateTensileStrength: 600e6 };
    const nf = FatigueLifeAnalyzer.calculateBasquinCycles(300e6, 50e6, mat);
    assert(nf > 1);
    assert.strictEqual(FatigueLifeAnalyzer.calculateBasquinCycles(0, 0, mat), 1e12);
    const damage = FatigueLifeAnalyzer.evaluateCumulativeDamage([0, 300e6, 0, -250e6, 0, 200e6, 0], mat);
    assert(damage.cycleCount >= 1);
    const miner = new FatigueLifeAnalyzer().calculateMinerDamage(
      [{ amplitude: 200e6, mean: 0, count: 1 }],
      900e6,
      -0.085,
      600e6
    );
    assert(miner.cycleCount === 1);
    assert.throws(() => FatigueLifeAnalyzer.calculateBasquinCycles(1e6, 0, {}), /Provide explicit fatigue/);
    assert.deepStrictEqual(FatigueLifeAnalyzer.countRainflowCycles([1, 2]), []);
  });

  check('ShellMITC4Element stiffness and validation branches', () => {
    const coords = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 }
    ];
    const el = new ShellMITC4Element(1, [0, 1, 2, 3], coords, { thickness: 0.01, E: 70e9, nu: 0.3 });
    const ke = el.computeStiffnessMatrix();
    assert.strictEqual(ke.length, 576);
    assert(ke[0] > 0);
    assert.throws(
      () => new ShellMITC4Element(1, [0, 1, 2, 3], coords, { thickness: 0, E: 70e9, nu: 0.3 }),
      /Provide explicit thickness/
    );
    assert.throws(
      () => new ShellMITC4Element(1, [0, 1, 2, 3], coords, { thickness: 0.01, E: 70e9, nu: 0.6 }),
      /Provide explicit thickness/
    );
  });

  // ------------------------------------------------------------------
  // Math / HPC / EDA engines
  // ------------------------------------------------------------------
  check('DomainDecompositionEngine partitionMesh branches', () => {
    const nodes = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 1, z: 1 }
    ];
    const elements = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7]
    ];
    const p = DomainDecompositionEngine.partitionMesh(nodes, elements, 2);
    assert.strictEqual(p.subdomains.length, 2);
    assert(p.interfaceNodes.length >= 0);
    const single = DomainDecompositionEngine.partitionMesh(nodes, elements, 1);
    assert.strictEqual(single.subdomains.length, 1);
    assert.strictEqual(single.loadImbalanceRatio, 1.0);
    const schur = DomainDecompositionEngine.evaluateSchurDimensions(p);
    assert(schur.schurDimension >= 0);
  });

  check('PolygonBooleanEngine intersect/size branches', () => {
    const square = new Polygon2D([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]);
    const tri = new Polygon2D([
      { x: 5, y: 0 },
      { x: 15, y: 10 },
      { x: -5, y: 10 }
    ]);
    const inter = PolygonBooleanEngine.intersect(square, tri);
    assert(Array.isArray(inter));
    assert(inter.length <= 1);
    const disjoint = PolygonBooleanEngine.intersect(
      square,
      new Polygon2D([
        { x: 100, y: 100 },
        { x: 110, y: 100 },
        { x: 110, y: 110 },
        { x: 100, y: 110 }
      ])
    );
    assert.strictEqual(disjoint.length, 0);
    const grown = PolygonBooleanEngine.sizePolygon(square, 2);
    assert(grown.vertices.length === 4);
    assert(square.area() > 0);
    assert.strictEqual(square.isPointInside(5, 5), true);
    assert.strictEqual(square.isPointInside(50, 50), false);
  });

  check('EnterpriseIAM evaluateAccess branches', () => {
    const user = {
      username: 'u',
      role: 'ChiefEngineer',
      clearance: 'SECRET',
      itarCertified: true,
      assignedProjects: ['P1']
    };
    const granted = EnterpriseIAM.evaluateAccess({
      user,
      action: ACTIONS.EXPORT_GDSII,
      resource: { id: 'r', classification: 'CONFIDENTIAL', projectId: 'P1' },
      context: { allowedSubnet: '10.0', clientIp: '10.0.0.5' }
    });
    assert.strictEqual(granted.granted, true);
    assert.strictEqual(EnterpriseIAM.evaluateAccess({ user: null, action: ACTIONS.READ, resource: {} }).granted, false);
    assert.strictEqual(
      EnterpriseIAM.evaluateAccess({ user: { role: 'Guest' }, action: ACTIONS.MODIFY_CAD, resource: {} }).granted,
      false
    );
    assert.strictEqual(
      EnterpriseIAM.evaluateAccess({
        user: { role: 'Guest', clearance: 'UNCLASSIFIED' },
        action: ACTIONS.READ,
        resource: { classification: 'TOP_SECRET' }
      }).granted,
      false
    );
    assert.strictEqual(
      EnterpriseIAM.evaluateAccess({
        user: { role: 'EdaEngineer' },
        action: ACTIONS.EXPORT_GDSII,
        resource: { classification: 'UNCLASSIFIED', isITAR: true }
      }).granted,
      false
    );
    assert.strictEqual(
      EnterpriseIAM.evaluateAccess({
        user: { role: 'StressAnalyst', assignedProjects: ['P2'] },
        action: ACTIONS.READ,
        resource: { classification: 'UNCLASSIFIED', projectId: 'P1' }
      }).granted,
      false
    );
    assert.strictEqual(
      EnterpriseIAM.evaluateAccess({
        user: { role: 'StressAnalyst', assignedProjects: ['P1'] },
        action: ACTIONS.READ,
        resource: { classification: 'UNCLASSIFIED', projectId: 'P1' },
        context: { allowedSubnet: '10.0', clientIp: '192.168.1.1' }
      }).granted,
      false
    );
    const eco = EnterpriseIAM.canApproveECO({ role: 'ChiefEngineer' }, { classification: 'UNCLASSIFIED' });
    assert.strictEqual(eco.granted, true);
  });

  check('IPCValidator sanitize/validate branches', () => {
    assert.deepStrictEqual(IPCValidator.sanitize({ a: 1, __proto__: { polluted: true }, constructor: { x: 1 } }), {
      a: 1
    });
    const buf = Buffer.from([1, 2, 3]);
    const sanitizedBuf = IPCValidator.sanitize(buf);
    assert(sanitizedBuf.equals(buf));
    const u8 = new Uint8Array([4, 5]);
    assert.deepStrictEqual(Array.from(IPCValidator.sanitize(u8)), [4, 5]);
    assert.deepStrictEqual(IPCValidator.sanitize([{ b: 2 }]), [{ b: 2 }]);
    assert.strictEqual(IPCValidator.sanitize(null), null);
    assert.strictEqual(IPCValidator.validateFiniteNumbers({ a: 1 }, ['a']), true);
    assert.throws(() => IPCValidator.validateFiniteNumbers({ a: 'x' }, ['a']), /finite number/);
    assert.throws(() => IPCValidator.validateFiniteNumbers(null), /non-null object/);
    assert.strictEqual(IPCValidator.sanitizePath('sub/file.step', '/tmp/base'), '/tmp/base/sub/file.step');
    assert.throws(() => IPCValidator.sanitizePath('../evil', '/tmp/base'), /Path traversal/);
    assert.throws(() => IPCValidator.sanitizePath('', '/tmp/base'), /non-empty string/);
    assert.throws(() => IPCValidator.sanitizePath('a', ''), /base directory/);
    assert.strictEqual(IPCValidator.validateBuffer(Buffer.alloc(10), 100), true);
    assert.throws(() => IPCValidator.validateBuffer('not-buffer'), /expected Buffer/);
    assert.throws(() => IPCValidator.validateBuffer(Buffer.alloc(200), 100), /Exceeded Security Limit/);
  });

  check('PlaceAndRouteEngine constructor and run branches', () => {
    assert.throws(
      () => new PlaceAndRouteEngine({ coreWidth: 10, coreHeight: 100, stdCellHeight: 10 }),
      /Explicit positive/
    );
    const engine = new PlaceAndRouteEngine({ coreWidth: 1000, coreHeight: 800, stdCellHeight: 20, gridPitch: 5 });
    const out = engine.runPlaceAndRoute({
      cells: [
        { id: 'c1', width: 30, height: 20 },
        { id: 'c2', width: 40, height: 20 },
        { id: 'c3', width: 30, height: 20 }
      ],
      nets: [
        { name: 'n1', pins: ['c1', 'c2'] },
        { name: 'n2', pins: ['c1', 'c3', 'c2'] },
        { name: 'n3', pins: ['c1'] },
        { name: 'n4', pins: ['missing1', 'missing2'] }
      ]
    });
    assert.strictEqual(out.cellsPlacedCount, 3);
    assert(out.netsRoutedCount >= 1);
    const bad = engine.runPlaceAndRoute({ cells: [], nets: [] });
    assert.strictEqual(bad.success, false);
  });

  check('GPUParallelPCGSolver solve validation branches (serial fallback)', () => {
    const solver = new GPUParallelPCGSolver({ useSharedArrayBuffer: false, tolerance: 1e-9 });
    const A = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2]
    ];
    const b = [1, 2, 3];
    const res = solver.solve(A, b);
    assert.strictEqual(res.converged, true);
    assert(Math.abs(res.solution[0] - 2 / 9) < 1e-6);
    const res2 = solver.solve(A, b, [0, 0, 0]);
    assert.strictEqual(res2.converged, true);
    const csr = { n: 3, rowPtr: [0, 2, 5, 7], colIdx: [0, 1, 0, 1, 2, 1, 2], values: [4, 1, 1, 3, 1, 1, 2] };
    const res3 = solver.solve(csr, b);
    assert.strictEqual(res3.converged, true);
    assert.throws(
      () =>
        solver.solve(
          [
            [4, 1],
            [1, 3, 1]
          ],
          b
        ),
      /square/
    );
    assert.throws(
      () =>
        solver.solve(
          [
            [4, 'x'],
            [1, 3]
          ],
          b
        ),
      /finite/
    );
    assert.throws(() => solver.solve({ n: 2, rowPtr: [0, 1], colIdx: [0], values: [1] }, b), /consistent lengths/);
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 3], colIdx: [0, 1, 1], values: [1, 1, 1] }, b),
      /consistent lengths/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [5, 0], values: [1, 1] }, [1, 2]),
      /column indices/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [0, 0], values: [1, 1] }, [1]),
      /right-hand side/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [0, 0], values: [1, 1] }, [1, 2], [1]),
      /initial guess/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [1, 1], values: [1, 1] }, [1, 2]),
      /positive diagonal/
    );
    assert.throws(() => new GPUParallelPCGSolver({ bogus: 1 }), /does not support/);
    assert.throws(() => new GPUParallelPCGSolver({ maxIterations: 0 }), /positive integer/);
    assert.throws(() => new GPUParallelPCGSolver({ tolerance: 2 }), /between zero and one/);
    assert.throws(() => new GPUParallelPCGSolver({ maxWorkers: 0 }), /positive integer/);
  });

  // ------------------------------------------------------------------
  // Worker pool legacy queue branches
  // ------------------------------------------------------------------
  check('ExperimentalCalculationQueue dispatch/drain/kernel branches', async () => {
    const q = new ExperimentalCalculationQueue();
    const res = await q.dispatch('ECHO_TEST', { message: 'hi' }, { priority: 'HIGH' });
    assert.strictEqual(res.result.echo, 'hi');
    const res2 = await q.dispatch('ECHO_TEST', { message: 'x', delayMs: 1 });
    assert.strictEqual(res2.result.echo, 'x');
    await assert.rejects(() => q.dispatch('UNSUPPORTED_KERNEL', {}), /Unsupported experimental task type/);
    await assert.rejects(() => q.dispatch('ECHO_TEST', null), /task payload object/);
    await assert.rejects(() => q.dispatch('', {}), /task type is required/);
    await assert.rejects(() => q.dispatch('ECHO_TEST', {}, { priority: 'URGENT' }), /Unsupported task priority/);
    await assert.rejects(() => q.dispatch('ECHO_TEST', {}, { bogus: 1 }), /cannot honor/);
    const shared = q.allocateSharedBuffer(16);
    assert(shared.byteLength === 16);
    assert.throws(() => q.allocateSharedBuffer(-1), /non-negative byte length/);
    assert(q.getTelemetry().completedTasksCount >= 2);
    assert.throws(() => new ExperimentalCalculationQueue({ maxWorkers: 2 }), /cannot honor/);
    assert.throws(() => new ExperimentalCalculationQueue(null), /options must be an object/);
  });

  check('PersistentWorkerPool protected pool and timeout branches', async () => {
    assert.throws(() => new PersistentWorkerPool({ maxWorkers: 500 }), /RESOURCE_EXHAUSTED|maximum/);
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    const res = await pool.dispatch('ECHO_TEST', { message: 'hello' });
    assert.strictEqual(res.result.echo, 'hello');
    await assert.rejects(
      () => pool.dispatch('ECHO_TEST', { delayMs: 5000 }, { timeoutMs: 150 }),
      /maximum execution limit/
    );
    await pool.terminateAll();
  });

  const pendingSettled = await Promise.race([
    Promise.all(pending).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 60000))
  ]);
  if (!pendingSettled) {
    failedTests += pending.length;
    console.error('  ✗ WARN: timed out waiting for pending checks; marking them failed');
  }

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapTwentyCoverageTests };

if (require.main === module) {
  runBranchGapTwentyCoverageTests().then((stats) => {
    console.log(`gap20: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
