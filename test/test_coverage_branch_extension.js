'use strict';

/**
 * OmniEng branch-proxy coverage extension tests.
 *
 * This standalone suite is intentionally NOT wired into test/run_all_tests.js
 * (the orchestrator performs integration). It exercises REAL production paths —
 * conditional branches, error/fallback paths, and boundary behavior — that the
 * existing suite leaves unexercised, with the goal of raising the V8
 * block-transition branch proxy (non-entry function ranges with count > 0).
 *
 * Every check calls an actual production module and asserts a real outcome:
 * finite numeric results, correct error codes, or boundary behavior. No check
 * is a call-for-coverage stub: each asserts on observable behavior.
 */

const assert = require('assert');

const { PIDEngine } = require('../src/core/plant/pid_engine');
const { NasaRocketPropulsion } = require('../src/core/aerospace/nasa_rocket_propulsion');
const {
  SerialManipulatorEngine,
  PUMA_560_DH,
  UR5E_DH,
  KUKA_IIWA_7DOF_DH
} = require('../src/core/robotics/serial_manipulator_kinematics');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { AerospaceEngineAdapter } = require('../src/core/aerospace/aerospace_engine_adapter');
const { EdgeBlender } = require('../src/core/cad/edge_blender');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');
const { StepTranslator } = require('../src/core/cad/step_translator');
const { PersistentNamingManager } = require('../src/core/cad/persistent_naming_manager');
const {
  OmniArchive,
  OmniArchiveV2,
  OmniVaultAES256,
  OmniWal,
  CommandJournal,
  saveAtomicSync,
  calculateCRC32
} = require('../src/core/storage/omni_archive');
const { StenographerSupervisor } = require('../src/main/stenographer_supervisor');
const { ToolDefinition, ToolApprovalClass } = require('../src/core/contracts/ToolDefinition');
const {
  handleGenericSparseSolve,
  handleRadauIIASolve,
  normalizeSparseMatrixInput,
  proposalMatchesActiveProject,
  loadOmniArchiveFromBuffer
} = require('../src/main/ipc/system_ipc');
const {
  handleGdsiiExportRequest,
  handleLefParseRequest,
  handleDefParseRequest,
  handleDefSerializeRequest,
  handleGerberExportRequest,
  handleDrcRequest,
  handleVerilogSynthesisRequest
} = require('../src/main/ipc/eda_ipc');
const { SkewRayTracer } = require('../src/core/optics/skew_ray_tracer');
const { GPUParallelPCGSolver } = require('../src/core/math/gpu_parallel_pcg_solver');
const { DampedLeastSquaresOptimizer } = require('../src/core/optics/damped_least_squares_optimizer');
const { ExperimentalCalculationQueue, PersistentWorkerPool } = require('../src/core/math/worker_pool');
const { LefDefParser } = require('../src/core/eda/lef_def_parser');
const { StaticTimingAnalysis } = require('../src/core/eda/static_timing_analysis');
const { ProcessStream, ProcessFlowsheetSolver } = require('../src/core/plant/process_flowsheet_solver');
const { getExperimentalThermoProperties } = require('./support/experimental_property_examples');
const { PDMEngineAdapter } = require('../src/core/pdm/pdm_engine_adapter');
const { EDAEngineAdapter } = require('../src/core/eda/eda_engine_adapter');
const { ODESolvers, RadauIIA } = require('../src/core/math/ode_solvers');
const { FVMNavierStokes3D } = require('../src/core/cae/fvm_navier_stokes_3d');
const { OmniError, OmniErrorCode } = require('../src/core/contracts/OmniError');

const LEF_OK = [
  'VERSION 5.8 ;',
  'LAYER metal1 ;',
  'LAYER metal2 ;',
  'MACRO INV',
  ' CLASS CORE ;',
  ' ORIGIN 0 0 ;',
  ' SIZE 10 BY 20 ;',
  ' PIN A',
  '  DIRECTION INPUT ;',
  '  PORT',
  '   LAYER metal1 ;',
  '   RECT 0 0 2 3 ;',
  '  END',
  ' END A',
  ' OBS',
  '  LAYER metal2 ;',
  '  RECT 1 1 5 5 ;',
  ' END',
  'END INV'
].join('\n');

const DEF_OK = [
  'VERSION 5.8 ;',
  'DIVIDERCHAR "/" ;',
  'BUSBITCHARS "[]" ;',
  'DESIGN top ;',
  'UNITS DISTANCE MICRONS 1000 ;',
  'DIEAREA ( 0 0 ) ( 1000 1000 ) ;',
  'COMPONENTS 1 ;',
  ' - u1 INV + PLACED ( 0 0 ) N ;',
  'END COMPONENTS',
  'PINS 2 ;',
  ' - A + NET n1 + DIRECTION INPUT + LAYER metal1 ( 0 0 ) ( 1 1 ) ;',
  ' - Y + NET n1 + DIRECTION OUTPUT + LAYER metal1 ( 0 0 ) ( 1 1 ) ;',
  'END PINS',
  'NETS 1 ;',
  ' - n1 ( A ) ( Y ) ;',
  'END NETS',
  'END DESIGN'
].join('\n');

const DLS_OPTIONS = {
  initialDamping: 1e-3,
  minimumDamping: 1e-8,
  maximumDamping: 1e3,
  dampingReductionFactor: 2,
  dampingIncreaseFactor: 2,
  maxIterations: 40,
  tolerance: 1e-10,
  finiteDiffStep: 1e-6
};

const DLS_SYSTEM = {
  surfaces: [
    { refractiveIndex: 1, thickness: 5, curvature: 0 },
    { refractiveIndex: 1.5, thickness: 0, curvature: 0.02 },
    { refractiveIndex: 1, thickness: 0, curvature: 0 }
  ],
  initialRefractiveIndex: 1,
  metricSampling: {
    entrancePupilRadiusMm: 5,
    paraxialRayHeightMm: 2,
    zonalRayFraction: 0.7,
    chiefRayAngleRad: 0.02
  }
};

async function runBranchCoverageExtensionTests() {
  console.log('================================================================');
  console.log('   BRANCH-PROXY COVERAGE EXTENSION TESTS                    ');
  console.log('================================================================');

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
              console.error(`  ✗ FAIL: ${name}`);
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
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // ------------------------------------------------------------------
  // PID drafting engine: schedule vectorization and configuration paths.
  // ------------------------------------------------------------------
  check('PIDEngine createPID returns a vectorizable schedule contract', () => {
    const pid = new PIDEngine();
    const cfg = pid.createPID({
      project: { name: 'Probe P&ID' },
      areas: [{ id: 'A1', name: 'Area 1', equipment: [] }]
    });
    assert.strictEqual(cfg.success, true);
    assert(Array.isArray(cfg.sheets) && cfg.sheets.length > 0);
    assert(typeof cfg.schedule === 'object' && cfg.schedule !== null);
    const csv = pid.vectorizeSchedule(cfg);
    assert(typeof csv.equipmentCsv === 'string' && csv.equipmentCsv.includes('tag,type'));
    assert(typeof csv.linesCsv === 'string' && csv.linesCsv.includes('lineNumber'));
    assert(typeof csv.instrumentsCsv === 'string' && csv.instrumentsCsv.includes('loopId'));
    assert(typeof csv.valvesCsv === 'string' && csv.valvesCsv.includes('actuator'));
    assert(typeof csv.loopsCsv === 'string' && csv.loopsCsv.includes('sensorTag'));
  });

  check('PIDEngine oilGasProductionTemplate mirrors static template', () => {
    const pid = new PIDEngine();
    assert.deepStrictEqual(pid.oilGasProductionTemplate(), PIDEngine.oilGasProductionTemplate());
  });

  // ------------------------------------------------------------------
  // NASA rocket propulsion: combustion propellant branches, nozzle
  // inversion edge cases, engine performance, cooling, staging, isogrid,
  // ascent, CFD and orbital transfer paths.
  // ------------------------------------------------------------------
  check('Nasa combustion LOX_LCH4 / METHALOX correlation path', () => {
    const nasa = new NasaRocketPropulsion();
    const r = nasa.evaluateCombustionEquilibrium('LOX_LCH4', 100, 3.6);
    assert.strictEqual(r.success, true);
    assert(r.chamberTemperatureK > 3000 && r.chamberTemperatureK < 4500);
    assert(r.gamma > 1 && r.gamma < 1.5);
    assert(r.characteristicVelocityM_s > 1000);
    const r2 = nasa.evaluateCombustionEquilibrium('METHALOX', 150, 4);
    assert.strictEqual(r2.success, true);
  });

  check('Nasa combustion LOX_LH2 / HYDROLOX correlation path', () => {
    const nasa = new NasaRocketPropulsion();
    const r = nasa.evaluateCombustionEquilibrium('LOX_LH2', 100, 6);
    assert.strictEqual(r.success, true);
    assert(r.molecularWeightKgKmol < 15);
    const r2 = nasa.evaluateCombustionEquilibrium('HYDROLOX', 200, 5);
    assert.strictEqual(r2.success, true);
  });

  check('Nasa combustion LOX_RP1 / KEROLOX correlation path', () => {
    const nasa = new NasaRocketPropulsion();
    const r = nasa.evaluateCombustionEquilibrium('LOX_RP1', 100, 2.6);
    assert.strictEqual(r.success, true);
    assert(r.chamberTemperatureK > 3000);
    const r2 = nasa.evaluateCombustionEquilibrium('KEROLOX', 80, 3);
    assert.strictEqual(r2.success, true);
  });

  check('Nasa combustion rejects unsupported propellant with invalid-input result', () => {
    const nasa = new NasaRocketPropulsion();
    const r = nasa.evaluateCombustionEquilibrium('CO2', 100, 3);
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error.code, 'INVALID_INPUT');
    assert.match(r.error.message, /supported propellantType/);
  });

  check('Nasa combustion missing inputs return invalid-input result', () => {
    const nasa = new NasaRocketPropulsion();
    const r1 = nasa.evaluateCombustionEquilibrium('', 100, 3);
    assert.strictEqual(r1.success, false);
    assert.match(r1.error.message, /propellantType/);
    const r2 = nasa.evaluateCombustionEquilibrium('LOX_LCH4', 0, 3);
    assert.strictEqual(r2.success, false);
    assert.match(r2.error.message, /chamberPressureBar/);
    const r3 = nasa.evaluateCombustionEquilibrium('LOX_LCH4', 100, -1);
    assert.strictEqual(r3.success, false);
    assert.match(r3.error.message, /ofRatio/);
  });

  check('Nasa nozzle Mach inversion returns Mach 1 at unit expansion ratio', () => {
    const nasa = new NasaRocketPropulsion();
    assert.strictEqual(nasa.solveNozzleExitMach(1.0, 1.2), 1.0);
  });

  check('Nasa nozzle inversion throws for invalid expansionRatio or gamma', () => {
    const nasa = new NasaRocketPropulsion();
    assert.throws(() => nasa.solveNozzleExitMach(0.5, 1.2), RangeError);
    assert.throws(() => nasa.solveNozzleExitMach(10, 1.0), RangeError);
    assert.throws(() => nasa.solveNozzleExitMach(NaN, 1.2), RangeError);
  });

  check('Nasa engine performance end-to-end computes finite thrust and Isp', () => {
    const nasa = new NasaRocketPropulsion();
    const r = nasa.calculateEnginePerformance({
      propellantType: 'LOX_LH2',
      chamberPressureBar: 100,
      ofRatio: 6,
      throatDiameterM: 0.1,
      expansionRatio: 10,
      ambientPressureBar: 1
    });
    assert.strictEqual(r.success, true);
    assert(r.exitMach > 1 && r.exitMach < 10);
    assert(r.thrustSeaLevelN > 0 && Number.isFinite(r.thrustSeaLevelN));
    assert(r.IspSeaLevelS > 100 && r.IspSeaLevelS < 1000);
    assert(r.massFlowTotalKgS > 0);
    assert(r.exitTemperatureK > 0);
  });

  check('Nasa engine performance validates parameter object and missing inputs', () => {
    const nasa = new NasaRocketPropulsion();
    const r1 = nasa.calculateEnginePerformance(null);
    assert.strictEqual(r1.success, false);
    assert.match(r1.error.message, /parameter object/);
    const r2 = nasa.calculateEnginePerformance({ propellantType: 'LOX_LCH4' });
    assert.strictEqual(r2.success, false);
    assert(r2.error.message.includes('chamberPressureBar'));
    assert(r2.error.message.includes('throatDiameterM'));
    const r3 = nasa.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.6,
      throatDiameterM: 0.1,
      expansionRatio: 0.5,
      ambientPressureBar: 1
    });
    assert.strictEqual(r3.success, false);
    assert.match(r3.error.message, /expansionRatio >= 1/);
  });

  check('Nasa engine performance propagates combustion failure result', () => {
    const nasa = new NasaRocketPropulsion();
    const r = nasa.calculateEnginePerformance({
      propellantType: 'NONSENSE',
      chamberPressureBar: 100,
      ofRatio: 3.6,
      throatDiameterM: 0.1,
      expansionRatio: 10,
      ambientPressureBar: 1
    });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error.code, 'INVALID_INPUT');
  });

  check('Nasa Bartz regenerative cooling full-input computation', () => {
    const nasa = new NasaRocketPropulsion();
    const perf = nasa.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.6,
      throatDiameterM: 0.1,
      expansionRatio: 10,
      ambientPressureBar: 1
    });
    const coolant = {
      gasViscosityPaS: 8e-5,
      gasSpecificHeatJKgK: 2100,
      gasPrandtl: 0.7,
      bartzCorrectionFactor: 1.0,
      recoveryFactor: 0.9,
      throatRadiusOfCurvatureM: 0.05,
      channelWidthM: 0.001,
      channelHeightM: 0.002,
      wallThicknessM: 0.001,
      coolantInletTempK: 300,
      coolantMassFlowKgS: 5,
      coolantDensityKgM3: 1000,
      coolantViscosityPaS: 3e-4,
      coolantSpecificHeatJKgK: 4200,
      coolantPrandtl: 5,
      coolantThermalConductivityWmK: 0.6,
      linerThermalConductivityWmK: 50,
      effectiveHeatTransferAreaM2: 0.1,
      coolantChannelLengthM: 0.5,
      coolantChannelCount: 40,
      inputSourceDescription: 'probe fixture'
    };
    const r = nasa.calculateBartzRegenerativeCooling(perf, coolant);
    assert.strictEqual(r.success, true);
    assert(Number.isFinite(r.heatFluxThroatMW_m2) && r.heatFluxThroatMW_m2 > 0);
    assert(Number.isFinite(r.coolantOutletTempK));
    assert(Number.isFinite(r.coolantTempRiseK) && r.coolantTempRiseK > 0);
    assert(r.coolantOutletTempK > coolant.coolantInletTempK);
  });

  check('Nasa Bartz cooling rejects non-success engine result', () => {
    const nasa = new NasaRocketPropulsion();
    const r = nasa.calculateBartzRegenerativeCooling({ success: false }, {});
    assert.strictEqual(r.success, false);
    assert.match(r.error.message, /successful engine performance result/);
  });

  check('Nasa Bartz cooling rejects missing coolant properties', () => {
    const nasa = new NasaRocketPropulsion();
    const perf = nasa.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.6,
      throatDiameterM: 0.1,
      expansionRatio: 10,
      ambientPressureBar: 1
    });
    const r = nasa.calculateBartzRegenerativeCooling(perf, null);
    assert.strictEqual(r.success, false);
    assert.match(r.error.message, /coolant properties object/);
  });

  check('Nasa Bartz cooling rejects individual missing positive inputs', () => {
    const nasa = new NasaRocketPropulsion();
    const perf = nasa.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.6,
      throatDiameterM: 0.1,
      expansionRatio: 10,
      ambientPressureBar: 1
    });
    const coolant = {
      gasViscosityPaS: 8e-5,
      gasSpecificHeatJKgK: 2100,
      gasPrandtl: 0.7,
      bartzCorrectionFactor: 1.0,
      recoveryFactor: 0.9,
      throatRadiusOfCurvatureM: 0.05,
      channelWidthM: 0.001,
      channelHeightM: 0.002,
      wallThicknessM: 0.001,
      coolantInletTempK: 300,
      coolantMassFlowKgS: 5,
      coolantDensityKgM3: 1000,
      coolantViscosityPaS: 3e-4,
      coolantSpecificHeatJKgK: 4200,
      coolantPrandtl: 5,
      coolantThermalConductivityWmK: 0.6,
      linerThermalConductivityWmK: 50,
      effectiveHeatTransferAreaM2: 0.1,
      coolantChannelLengthM: 0.5,
      coolantChannelCount: 40,
      inputSourceDescription: 'probe fixture'
    };
    const r = nasa.calculateBartzRegenerativeCooling(perf, { ...coolant, channelHeightM: 0 });
    assert.strictEqual(r.success, false);
    assert(r.error.message.includes('channelHeightM'));
    const r2 = nasa.calculateBartzRegenerativeCooling(perf, { ...coolant, coolantChannelCount: 2.5 });
    assert.strictEqual(r2.success, false);
    assert(r2.error.message.includes('coolantChannelCount'));
  });

  check('Nasa staging delta-V matches closed-form rocket equation', () => {
    const nasa = new NasaRocketPropulsion();
    const mission = {
      payloadMassKg: 100,
      stage1DryMassKg: 1500,
      stage1PropellantMassKg: 8000,
      stage1IspVac: 300,
      stage2DryMassKg: 400,
      stage2PropellantMassKg: 2500,
      stage2IspVac: 340,
      gravityLossesM_s: 500,
      aerodynamicLossesM_s: 200,
      steeringLossesM_s: 150,
      requiredDeltaV_m_s: 9000,
      inputSourceDescription: 'probe fixture'
    };
    const r = nasa.calculateStagingDeltaV(mission);
    assert.strictEqual(r.success, true);
    const dv2 = 340 * 9.80665 * Math.log((400 + 2500 + 100) / (400 + 100));
    const dv1 = 300 * 9.80665 * Math.log((1500 + 8000 + 400 + 2500 + 100) / (1500 + 400 + 2500 + 100));
    assert(Math.abs(r.stage2.idealDeltaV_m_s - dv2) / dv2 < 1e-3);
    assert(Math.abs(r.stage1.idealDeltaV_m_s - dv1) / dv1 < 1e-3);
    assert(Math.abs(r.totalIdealDeltaV_m_s - (dv1 + dv2)) / (dv1 + dv2) < 1e-3);
    assert(r.netDeliveredDeltaV_m_s < r.totalIdealDeltaV_m_s);
  });

  check('Nasa staging returns invalid-input for missing and non-object inputs', () => {
    const nasa = new NasaRocketPropulsion();
    const r1 = nasa.calculateStagingDeltaV({ payloadMassKg: 100 });
    assert.strictEqual(r1.success, false);
    assert(r1.error.message.includes('stage1DryMassKg'));
    const r2 = nasa.calculateStagingDeltaV([]);
    assert.strictEqual(r2.success, false);
  });

  check('Nasa isogrid buckling estimate computes finite critical load', () => {
    const nasa = new NasaRocketPropulsion();
    const r = nasa.calculateIsogridTankBuckling({
      tankRadiusM: 1,
      tankLengthM: 3,
      internalPressureBar: 4,
      axialCompressiveLoadKN: 5000,
      skinThicknessMm: 2.5,
      ribHeightMm: 15,
      ribWidthMm: 3,
      elasticModulusPa: 70e9,
      poissonRatio: 0.33,
      yieldStrengthPa: 300e6,
      safetyFactor: 1.5,
      minimumSkinThicknessMm: 1.5,
      bucklingKnockdownFactor: 0.8,
      material: 'Al 7075-T6',
      pressureStabilizationCoefficient: 0.5,
      internalPressureAxialLoadReliefFactor: 0.7,
      inputSourceDescription: 'probe fixture'
    });
    assert.strictEqual(r.success, true);
    assert(Number.isFinite(r.criticalBucklingStressMPa) && r.criticalBucklingStressMPa > 0);
    assert(Number.isFinite(r.marginOfSafety) && r.marginOfSafety > 0);
  });

  check('Nasa isogrid rejects missing fields, poisson >= 0.5, knockdown > 1', () => {
    const nasa = new NasaRocketPropulsion();
    const base = {
      tankRadiusM: 1,
      tankLengthM: 3,
      internalPressureBar: 4,
      axialCompressiveLoadKN: 5000,
      skinThicknessMm: 2.5,
      ribHeightMm: 15,
      ribWidthMm: 3,
      elasticModulusPa: 70e9,
      poissonRatio: 0.33,
      yieldStrengthPa: 300e6,
      safetyFactor: 1.5,
      minimumSkinThicknessMm: 1.5,
      bucklingKnockdownFactor: 0.8,
      material: 'Al 7075-T6',
      pressureStabilizationCoefficient: 0.5,
      internalPressureAxialLoadReliefFactor: 0.7,
      inputSourceDescription: 'probe fixture'
    };
    const r1 = nasa.calculateIsogridTankBuckling({ ...base, tankRadiusM: undefined });
    assert.strictEqual(r1.success, false);
    assert(r1.error.message.includes('tankRadiusM'));
    const r2 = nasa.calculateIsogridTankBuckling({ ...base, poissonRatio: 0.6 });
    assert.strictEqual(r2.success, false);
    assert.match(r2.error.message, /poissonRatio/);
    const r3 = nasa.calculateIsogridTankBuckling({ ...base, bucklingKnockdownFactor: 1.2 });
    assert.strictEqual(r3.success, false);
    assert.match(r3.error.message, /bucklingKnockdownFactor/);
    const r4 = nasa.calculateIsogridTankBuckling({ ...base, internalPressureAxialLoadReliefFactor: 2 });
    assert.strictEqual(r4.success, false);
  });

  check('Nasa ascent trajectory integrates finite altitude and velocity', () => {
    const nasa = new NasaRocketPropulsion();
    const r = nasa.simulateAscentTrajectory({
      liftOffMassKg: 50000,
      stage1PropellantMassKg: 25000,
      stage1EngineCount: 2,
      thrustPerEngineSL_kN: 500,
      Isp_sl: 300,
      Isp_vac: 330,
      rocketDiameterM: 2.5,
      burnTimeS: 60,
      timeStepS: 1,
      inputSourceDescription: 'probe fixture',
      dragCoefficientByMach: [
        { machNumber: 0, dragCoefficient: 0.3 },
        { machNumber: 6, dragCoefficient: 0.4 }
      ],
      pitchAngleByAltitude: [
        { altitudeM: 0, pitchAngleDeg: 90 },
        { altitudeM: 100000, pitchAngleDeg: 60 }
      ]
    });
    assert.strictEqual(r.success, true);
    assert(Number.isFinite(r.maxQAltitudeKm) && r.maxQAltitudeKm > 0);
    assert(Number.isFinite(r.cutoffVelocityM_s) && r.cutoffVelocityM_s > 0);
    assert(Number.isFinite(r.cutoffAltitudeKm) && r.cutoffAltitudeKm > 0);
    assert(Array.isArray(r.trajectorySamples) && r.trajectorySamples.length > 1);
  });

  check('Nasa ascent rejects missing schedule data and non-integer engine count', () => {
    const nasa = new NasaRocketPropulsion();
    const base = {
      liftOffMassKg: 50000,
      stage1PropellantMassKg: 25000,
      stage1EngineCount: 2,
      thrustPerEngineSL_kN: 500,
      Isp_sl: 300,
      Isp_vac: 330,
      rocketDiameterM: 2.5,
      burnTimeS: 60,
      timeStepS: 1,
      inputSourceDescription: 'probe fixture'
    };
    const r1 = nasa.simulateAscentTrajectory({
      ...base,
      dragCoefficientByMach: [{ machNumber: 0, dragCoefficient: 3 }]
    });
    assert.strictEqual(r1.success, false);
    const r2 = nasa.simulateAscentTrajectory({ ...base, stage1EngineCount: 1.5 });
    assert.strictEqual(r2.success, false);
    assert.match(r2.error.message, /integer stage1EngineCount/);
  });

  check('Nasa double-wedge CFD shock-expansion returns finite forces', () => {
    const nasa = new NasaRocketPropulsion();
    const r = nasa.runAerospaceCFD({
      geometry: 'double-wedge',
      machNumber: 3,
      wedgeHalfAngleDeg: 10,
      chordM: 2,
      altitudeM: 10000,
      angleOfAttackDeg: 2
    });
    assert.strictEqual(r.success, true);
    assert(Number.isFinite(r.liftPerSpanN) && Number.isFinite(r.dragPerSpanN));
    assert(Number.isFinite(r.cL) && Number.isFinite(r.cD));
  });

  check('Nasa conical CFD shock-expansion returns finite forces', () => {
    const nasa = new NasaRocketPropulsion();
    const r = nasa.runAerospaceCFD({
      geometry: 'cone',
      machNumber: 2.5,
      coneAngleDeg: 15,
      lengthM: 1.5,
      altitudeM: 5000
    });
    assert.strictEqual(r.success, true);
    assert(Number.isFinite(r.dragN) && r.dragN > 0);
  });

  check('Nasa CFD rejects missing Mach, wedge angle, and chord', () => {
    const nasa = new NasaRocketPropulsion();
    const r1 = nasa.runAerospaceCFD({ geometry: 'double-wedge', wedgeHalfAngleDeg: 10, chordM: 2 });
    assert.strictEqual(r1.success, false);
    assert.match(r1.error.message, /machNumber/);
    const r2 = nasa.runAerospaceCFD({ geometry: 'double-wedge', machNumber: 2, chordM: 2 });
    assert.strictEqual(r2.success, false);
    const r3 = nasa.runAerospaceCFD({ geometry: 'double-wedge', machNumber: 2, wedgeHalfAngleDeg: 10 });
    assert.strictEqual(r3.success, false);
    const r4 = nasa.runAerospaceCFD({ geometry: 'cone', machNumber: 2, chordM: 1 });
    assert.strictEqual(r4.success, false);
    assert.match(r4.error.message, /coneAngleDeg/);
  });

  check('Nasa Hohmann and bi-elliptic orbital transfer produce finite delta-v', () => {
    const nasa = new NasaRocketPropulsion();
    const r1 = nasa.calculateOrbitalTransfer({ r1Meters: 6.8e6, r2Meters: 4.2e7 });
    assert.strictEqual(r1.success, true);
    assert(Number.isFinite(r1.deltaVTotal) && r1.deltaVTotal > 0);
    const r2 = nasa.calculateOrbitalTransfer({
      r1Meters: 6.8e6,
      r2Meters: 4.2e7,
      intermediateRadiusM: 8e7,
      biElliptic: true
    });
    assert.strictEqual(r2.success, true);
    assert(Number.isFinite(r2.deltaVTotal));
  });

  check('Nasa orbital transfer rejects missing radii', () => {
    const nasa = new NasaRocketPropulsion();
    const r = nasa.calculateOrbitalTransfer({ r1Meters: 6.8e6 });
    assert.strictEqual(r.success, false);
    assert(r.error.message.includes('r2Meters'));
  });

  check('Nasa nozzle compilation returns finite contour data', () => {
    const nasa = new NasaRocketPropulsion();
    const r = nasa.compileRocketNozzle({
      chamberPressureBar: 100,
      throatDiameterM: 0.1,
      expansionRatio: 10,
      gamma: 1.2
    });
    assert.strictEqual(r.success, true);
    assert(Number.isFinite(r.exitMach) && r.exitMach > 1);
    assert(Array.isArray(r.contourMeters) && r.contourMeters.length > 0);
  });

  check('Nasa WBS hierarchy is an array tree', () => {
    const wbs = NasaRocketPropulsion.getWbsHierarchy();
    assert(Array.isArray(wbs));
  });

  // ------------------------------------------------------------------
  // Serial manipulator kinematics: preset resolution, DH conventions,
  // PoE forward kinematics, Jacobian, inverse kinematics, inverse
  // dynamics, mass matrix, quintic planning and URDF parsing.
  // ------------------------------------------------------------------
  check('SerialManipulatorEngine resolves built-in preset tables', () => {
    assert(PUMA_560_DH.length >= 6);
    assert(UR5E_DH.length >= 6);
    assert(KUKA_IIWA_7DOF_DH.length === 7);
    assert.strictEqual(SerialManipulatorEngine.resolveKinematicChain('PUMA_560'), PUMA_560_DH);
    assert.strictEqual(SerialManipulatorEngine.resolveKinematicChain('ur5e'), UR5E_DH);
    assert.strictEqual(SerialManipulatorEngine.resolveKinematicChain('KUKA_IIWA_7DOF'), KUKA_IIWA_7DOF_DH);
  });

  check('SerialManipulatorEngine rejects unknown presets and empty tables', () => {
    assert.throws(() => SerialManipulatorEngine.resolveKinematicChain('BOGUS'), /Unknown manipulator preset/);
    assert.throws(() => SerialManipulatorEngine.resolveKinematicChain([]), /cannot be empty/);
    assert.throws(() => SerialManipulatorEngine.resolveKinematicChain({}), /Invalid kinematic chain/);
  });

  check('SerialManipulatorEngine resolves object-form dhTable and PoE specs', () => {
    const dhSpec = { dhTable: PUMA_560_DH };
    assert.strictEqual(SerialManipulatorEngine.resolveKinematicChain(dhSpec), PUMA_560_DH);
    const jointsSpec = { joints: [{ a: 1, alpha: 0, d: 0, theta: 0 }] };
    const resolvedJoints = SerialManipulatorEngine.resolveKinematicChain(jointsSpec);
    assert(Array.isArray(resolvedJoints.joints));
    const poeSpec = { screwAxes: [[0, 0, 1, 0, 0, 0]] };
    const resolvedPoe = SerialManipulatorEngine.resolveKinematicChain(poeSpec);
    assert(Array.isArray(resolvedPoe.screwAxes));
  });

  check('SerialManipulatorEngine computeDHTransform standard convention matrix', () => {
    const T = SerialManipulatorEngine.computeDHTransform({ a: 1, alpha: 0, d: 0.5, theta: 0.3 }, 0.2);
    for (const row of T) {
      assert(row.length === 4 && row.every(Number.isFinite));
    }
    assert.deepStrictEqual(T[3], [0, 0, 0, 1]);
    assert(Math.abs(T[0][0] - Math.cos(0.5)) < 1e-12);
  });

  check('SerialManipulatorEngine computeDHTransform modified convention matrix', () => {
    const T = SerialManipulatorEngine.computeDHTransform(
      { a: 1, alpha: 0.4, d: 0, theta: 0.2, convention: 'modified' },
      0.1
    );
    for (const row of T) {
      assert(row.length === 4 && row.every(Number.isFinite));
    }
    assert.deepStrictEqual(T[3], [0, 0, 0, 1]);
    assert(Math.abs(T[0][1] + Math.sin(0.3)) < 1e-12);
  });

  check('SerialManipulatorEngine prismatic DH joint moves along d', () => {
    const dh = [{ type: 'prismatic', a: 0, alpha: 0, d: 0, theta: 0 }];
    const T0 = SerialManipulatorEngine.forwardKinematics(dh, [0]);
    const T1 = SerialManipulatorEngine.forwardKinematics(dh, [2]);
    const p0 = T0.endEffectorTransform;
    const p1 = T1.endEffectorTransform;
    assert(Math.abs(p1[2][3] - p0[2][3] - 2) < 1e-9);
  });

  check('SerialManipulatorEngine forward kinematics on PUMA preset is finite and normalized', () => {
    const r = SerialManipulatorEngine.forwardKinematics('PUMA_560', [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const T = r.endEffectorTransform;
    for (const row of T) {
      assert(row.length === 4 && row.every(Number.isFinite));
    }
    assert.deepStrictEqual(T[3], [0, 0, 0, 1]);
  });

  check('SerialManipulatorEngine PoE forward kinematics returns finite transform', () => {
    const axes = [
      [0, 0, 1, 0, 0, 0],
      [0, 1, 0, 0, 0, 0]
    ];
    const M = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
    const r = SerialManipulatorEngine.forwardKinematicsPoE(axes, M, [0.2, 0.3]);
    const T = r.endEffectorTransform;
    for (const row of T) assert(row.every(Number.isFinite));
    assert.deepStrictEqual(T[3], [0, 0, 0, 1]);
  });

  check('SerialManipulatorEngine PoE validates angle count and empty axes', () => {
    const M = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
    assert.throws(() => SerialManipulatorEngine.forwardKinematicsPoE([], M, []), /screwAxes/);
    assert.throws(
      () => SerialManipulatorEngine.forwardKinematicsPoE([[0, 0, 1, 0, 0, 0]], M, [0.1, 0.2]),
      /joint angles/
    );
  });

  check('SerialManipulatorEngine geometric Jacobian is 6xn and finite', () => {
    const J = SerialManipulatorEngine.computeGeometricJacobian('PUMA_560', [0, 0, 0, 0, 0, 0]).jacobian;
    assert.strictEqual(J.length, 6);
    for (const row of J) {
      assert.strictEqual(row.length, 6);
      assert(row.every(Number.isFinite));
    }
  });

  check('SerialManipulatorEngine inverse kinematics converges to target pose', () => {
    const target = [0.3, 0.2, 0.5];
    const r = SerialManipulatorEngine.inverseKinematics({
      dhTable: 'PUMA_560',
      targetPosition: target,
      targetOrientation: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ]
    });
    assert.strictEqual(r.converged, true);
    assert.strictEqual(r.jointAngles.length, 6);
    const fk = SerialManipulatorEngine.forwardKinematics('PUMA_560', r.jointAngles);
    const p = fk.endEffectorTransform;
    const err = Math.hypot(p[0][3] - target[0], p[1][3] - target[1], p[2][3] - target[2]);
    assert(err < 1e-3);
  });

  check('SerialManipulatorEngine quintic trajectory hits endpoint at final time', () => {
    const r = SerialManipulatorEngine.planQuinticTrajectory({
      qStart: [0, 0, 0, 0, 0, 0],
      qEnd: [1, 1, 1, 0, 0, 0],
      duration: 2,
      dt: 0.1
    });
    assert(Array.isArray(r.trajectory) && r.trajectory.length === 21);
    const last = r.trajectory[r.trajectory.length - 1];
    assert.strictEqual(last.t, 2);
    for (let j = 0; j < 3; j++) {
      assert(Math.abs(last.q[j] - 1) < 1e-9);
    }
  });

  check('SerialManipulatorEngine quintic rejects missing or non-positive duration', () => {
    assert.throws(
      () => SerialManipulatorEngine.planQuinticTrajectory({ qStart: [0], qEnd: [1], duration: 0 }),
      /positive finite duration/
    );
    assert.throws(
      () => SerialManipulatorEngine.planQuinticTrajectory({ qStart: [0], qEnd: [1], duration: 2, dt: 5 }),
      /positive finite dt/
    );
  });

  check('SerialManipulatorEngine mass matrix is symmetric positive finite', () => {
    const inertias = [0, 1, 2, 3, 4, 5].map((i) => ({
      mass: 1,
      centerOfMass: [0, 0, 0],
      inertia: [
        [0.01, 0, 0],
        [0, 0.01, 0],
        [0, 0, 0.01]
      ]
    }));
    const M = SerialManipulatorEngine.computeMassMatrix('PUMA_560', inertias, [0, 0, 0, 0, 0, 0]);
    assert.strictEqual(M.length, 6);
    for (let i = 0; i < 6; i++) {
      assert.strictEqual(M[i].length, 6);
      for (let j = 0; j < 6; j++) {
        assert(Number.isFinite(M[i][j]));
        assert(Math.abs(M[i][j] - M[j][i]) < 1e-12);
      }
    }
  });

  check('SerialManipulatorEngine URDF parser rejects empty joint chains', () => {
    assert.throws(() => SerialManipulatorEngine.parseURDF('<robot name="x"></robot>'), /at least one <joint>/);
  });

  // ------------------------------------------------------------------
  // Robotics engine adapter: validation branches for every operation and
  // a successful end-to-end execution.
  // ------------------------------------------------------------------
  async function rejects(fn) {
    try {
      await fn();
      return 'resolve';
    } catch (_) {
      return 'reject';
    }
  }

  check('RoboticsEngineAdapter validate rejects null and non-object requests', async () => {
    const adapter = new RoboticsEngineAdapter();
    assert.strictEqual(await rejects(() => adapter.validate(null)), 'reject');
    assert.strictEqual(await rejects(() => adapter.validate('x')), 'reject');
  });

  check('RoboticsEngineAdapter validate rejects missing or unsupported operation', async () => {
    const adapter = new RoboticsEngineAdapter();
    assert.strictEqual(await rejects(() => adapter.validate({ domain: 'robotics', parameters: {} })), 'reject');
    assert.strictEqual(await rejects(() => adapter.validate({ domain: 'robotics', operation: 'fly' })), 'reject');
  });

  check('RoboticsEngineAdapter validate rejects bad FK joint-vector length', async () => {
    const adapter = new RoboticsEngineAdapter();
    assert.strictEqual(
      await rejects(() =>
        adapter.validate({
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { preset: 'PUMA_560', q: [0, 1] }
        })
      ),
      'reject'
    );
    assert.strictEqual(
      await rejects(() =>
        adapter.validate({
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { preset: 'PUMA_560', q: [0, 0, 0, 0, 0, 0, 1] }
        })
      ),
      'reject'
    );
  });

  check('RoboticsEngineAdapter validate rejects IK without target', async () => {
    const adapter = new RoboticsEngineAdapter();
    assert.strictEqual(
      await rejects(() =>
        adapter.validate({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: { preset: 'PUMA_560' }
        })
      ),
      'reject'
    );
    assert.strictEqual(
      await rejects(() =>
        adapter.validate({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: { preset: 'PUMA_560', targetPosition: [0.3, 0.2, 0.5] }
        })
      ),
      'resolve'
    );
  });

  check('RoboticsEngineAdapter validate rejects non-array URDF payloads', async () => {
    const adapter = new RoboticsEngineAdapter();
    assert.strictEqual(
      await rejects(() =>
        adapter.validate({
          domain: 'robotics',
          operation: 'parse_urdf',
          parameters: { urdf: '<robot name="r"></robot>' }
        })
      ),
      'reject'
    );
  });

  check('RoboticsEngineAdapter validate accepts a valid FK request', async () => {
    const adapter = new RoboticsEngineAdapter();
    const ok = await adapter.validate({
      domain: 'robotics',
      operation: 'forward_kinematics',
      parameters: { preset: 'PUMA_560', q: [0, 0, 0, 0, 0, 0] }
    });
    assert.strictEqual(ok, true);
  });

  check('RoboticsEngineAdapter execute solves forward kinematics end-to-end', async () => {
    const adapter = new RoboticsEngineAdapter();
    const out = await adapter.execute(
      {
        jobId: 'rob-fk-1',
        domain: 'robotics',
        operation: 'forward_kinematics',
        parameters: { preset: 'PUMA_560', q: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] }
      },
      () => {},
      null
    );
    assert.strictEqual(out.status, 'COMPLETED');
    assert(Number.isFinite(out.outputData.position.x.valueSi));
  });

  // ------------------------------------------------------------------
  // Aerospace engine adapter: validation branches per operation.
  // ------------------------------------------------------------------
  check('AerospaceEngineAdapter validate accepts valid engine-performance request', async () => {
    const adapter = new AerospaceEngineAdapter();
    const ok = await adapter.validate({
      domain: 'aerospace',
      operation: 'calculate_engine_performance',
      parameters: {
        propellantType: 'LOX_LH2',
        chamberPressureBar: 100,
        ofRatio: 6,
        throatDiameterM: 0.1,
        expansionRatio: 10,
        ambientPressureBar: 1
      }
    });
    assert.strictEqual(ok, true);
  });

  check('AerospaceEngineAdapter validate rejects incomplete regenerative-cooling inputs', async () => {
    const adapter = new AerospaceEngineAdapter();
    await assert.rejects(
      adapter.validate({ domain: 'aerospace', operation: 'regenerative_cooling', parameters: {} }),
      OmniError
    );
  });

  check('AerospaceEngineAdapter validate rejects orbital transfer without radii', async () => {
    const adapter = new AerospaceEngineAdapter();
    await assert.rejects(
      adapter.validate({ domain: 'aerospace', operation: 'calculate_orbital_transfer', parameters: {} }),
      OmniError
    );
  });

  check('AerospaceEngineAdapter validate rejects CFD without Mach number', async () => {
    const adapter = new AerospaceEngineAdapter();
    await assert.rejects(
      adapter.validate({ domain: 'aerospace', operation: 'run_aerospace_cfd', parameters: {} }),
      OmniError
    );
  });

  check('AerospaceEngineAdapter execute runs engine performance to completion', async () => {
    const adapter = new AerospaceEngineAdapter();
    const out = await adapter.execute(
      {
        jobId: 'aero-1',
        domain: 'aerospace',
        operation: 'calculate_engine_performance',
        parameters: {
          propellantType: 'LOX_LCH4',
          chamberPressureBar: 100,
          ofRatio: 3.6,
          throatDiameterM: 0.1,
          expansionRatio: 10,
          ambientPressureBar: 1
        }
      },
      () => {},
      null
    );
    assert.strictEqual(out.status, 'COMPLETED');
    assert.strictEqual(out.outputData.success, true);
    assert(Number.isFinite(out.outputData.thrustSeaLevelKN));
  });

  // ------------------------------------------------------------------
  // Edge blender: hydration validation, fillet success, and degenerate
  // edge/radius errors.
  // ------------------------------------------------------------------
  check('EdgeBlender applyFillet produces two triangles per subdivision station', () => {
    const box = BRepPrimitives.createBox(1, 1, 1);
    const edge = box.edges[0];
    const res = EdgeBlender.applyFillet(box, edge, 0.05);
    assert.strictEqual(res.blendFacesCount, 16);
    assert(res.filletSurfaceArea > 0 && Number.isFinite(res.filletSurfaceArea));
    assert(box.faces.length > 6);
  });

  check('EdgeBlender applyFillet accepts edge id strings', () => {
    const box = BRepPrimitives.createBox(1, 1, 1);
    const res = EdgeBlender.applyFillet(box, box.edges[3].id, 0.05);
    assert.strictEqual(res.blendFacesCount, 16);
  });

  check('EdgeBlender applyChamfer creates extra faces', () => {
    const box = BRepPrimitives.createBox(1, 1, 1);
    const before = box.faces.length;
    const res = EdgeBlender.applyChamfer(box, box.edges[1], 0.05);
    assert(res && res.solid);
    assert(box.faces.length > before);
  });

  check('EdgeBlender rejects non-positive fillet radius', () => {
    const box = BRepPrimitives.createBox(1, 1, 1);
    assert.throws(() => EdgeBlender.applyFillet(box, box.edges[0], 0), /strictly positive/);
    assert.throws(() => EdgeBlender.applyFillet(box, box.edges[0], -1), /strictly positive/);
  });

  check('EdgeBlender rejects missing edges and unknown edge ids', () => {
    assert.throws(() => EdgeBlender.applyFillet({ vertices: [], faces: [], edges: [] }, 'e1', 1), TypeError);
    const box = BRepPrimitives.createBox(1, 1, 1);
    assert.throws(() => EdgeBlender.applyFillet(box, 'nope', 0.1), /Target edge not found/);
  });

  check('EdgeBlender rejects degenerate zero-length edges', () => {
    const box = BRepPrimitives.createBox(1, 1, 1);
    const edge = box.edges[0];
    edge.end.point.x = edge.start.point.x;
    edge.end.point.y = edge.start.point.y;
    edge.end.point.z = edge.start.point.z;
    assert.throws(() => EdgeBlender.applyFillet(box, edge, 0.1), /zero-length edge/);
  });

  check('EdgeBlender hydration rejects malformed vertex and duplicate-id inputs', () => {
    assert.throws(
      () =>
        EdgeBlender.applyFillet(
          {
            vertices: [{ id: 'v0' }, { id: 'v1' }],
            faces: [],
            edges: [{ id: 'e0', start: { id: 'v0' }, end: { id: 'v1' } }]
          },
          'e0',
          0.1
        ),
      TypeError
    );
    assert.throws(
      () =>
        EdgeBlender.applyFillet(
          {
            vertices: [
              { id: 'v0', point: [0, 0, 0] },
              { id: 'v0', point: [1, 0, 0] }
            ],
            faces: [{ id: 'f0', vertices: ['v0'] }],
            edges: []
          },
          'e0',
          0.1
        ),
      /Duplicate serialized vertex id/
    );
  });

  // ------------------------------------------------------------------
  // STEP translator: single-part, assembly, and NURBS export paths.
  // ------------------------------------------------------------------
  check('StepTranslator exportSTEP emits AP214 header for a solid list', () => {
    const solid = {
      name: 'Part1',
      vertices: [
        { id: 'v0', point: [0, 0, 0] },
        { id: 'v1', point: [1, 0, 0] },
        { id: 'v2', point: [1, 1, 0] }
      ],
      faces: [{ id: 'f0', vertices: ['v0', 'v1', 'v2'] }]
    };
    const step = StepTranslator.exportSTEP({ solids: [solid] });
    assert(step.startsWith('ISO-10303-21;'));
    assert(step.includes('FILE_SCHEMA'));
    assert(step.includes('OmniEng_CAD_Part'));
  });

  check('StepTranslator exportSTEP face/vertex branch emits assembly header', () => {
    const step = StepTranslator.exportSTEP({ vertices: [], faces: [], solids: [] });
    assert(step.startsWith('ISO-10303-21;'));
  });

  check('StepTranslator exportAssemblySTEP emits assembly header with node tree', () => {
    const data = {
      assembly: {
        nodes: [{ id: 'n1', name: 'Sub', children: [{ id: 'n2', name: 'Leaf', solidId: 's1' }] }],
        references: [{ parentId: 'n1', childId: 'n2' }]
      },
      solids: [
        {
          id: 's1',
          name: 'PartA',
          vertices: [
            { id: 'v0', point: [0, 0, 0] },
            { id: 'v1', point: [1, 0, 0] },
            { id: 'v2', point: [1, 1, 0] }
          ],
          faces: [{ id: 'f0', vertices: ['v0', 'v1', 'v2'] }]
        }
      ]
    };
    const step = StepTranslator.exportAssemblySTEP(data);
    assert(step.startsWith('ISO-10303-21;'));
    assert(step.includes('OmniEng_Assembly'));
  });

  check('StepTranslator exportAssemblySTEP tolerates references without childId', () => {
    const data = {
      assembly: {
        nodes: [{ id: 'n1', name: 'Root' }],
        references: [{ parentId: 'n1' }]
      },
      solids: []
    };
    const step = StepTranslator.exportAssemblySTEP(data);
    assert(step.startsWith('ISO-10303-21;'));
  });

  // ------------------------------------------------------------------
  // Persistent naming manager: geometry-key branches and entity lifecycle.
  // ------------------------------------------------------------------
  check('PersistentNamingManager geometry keys are deterministic and type-sensitive', () => {
    const k1 = PersistentNamingManager.computeGeometryKey('VERTEX', { point: [1, 2, 3] });
    const k2 = PersistentNamingManager.computeGeometryKey('VERTEX', { point: [1, 2, 3] });
    assert.strictEqual(k1, k2);
    assert.notStrictEqual(k1, PersistentNamingManager.computeGeometryKey('VERTEX', { point: [1, 2, 4] }));
    assert.notStrictEqual(k1, PersistentNamingManager.computeGeometryKey('FACE', { point: [1, 2, 3] }));
  });

  check('PersistentNamingManager edge and face keys normalize attribute forms', () => {
    const e1 = PersistentNamingManager.computeGeometryKey('EDGE', { start: [0, 0, 0], end: [1, 0, 0] });
    const e2 = PersistentNamingManager.computeGeometryKey('EDGE', { a: [0, 0, 0], b: [1, 0, 0] });
    assert.strictEqual(e1, e2);
    const f = PersistentNamingManager.computeGeometryKey('FACE', {
      centroid: [0, 0, 0],
      normal: [0, 0, 1],
      area: 2
    });
    assert(typeof f === 'string' && f.length > 0);
  });

  check('PersistentNamingManager vertex key without point falls back to origin form', () => {
    const empty = PersistentNamingManager.computeGeometryKey('VERTEX', {});
    assert(typeof empty === 'string' && empty.length > 0);
    assert.strictEqual(empty, PersistentNamingManager.computeGeometryKey('VERTEX', { point: null }));
  });

  check('PersistentNamingManager getOrCreateEntityByGeometry is idempotent', () => {
    const mgr = new PersistentNamingManager();
    const first = mgr.getOrCreateEntityByGeometry('VERTEX', { point: [5, 5, 5] });
    const second = mgr.getOrCreateEntityByGeometry('VERTEX', { point: [5, 5, 5] });
    assert.strictEqual(first.created, true);
    assert.strictEqual(second.created, false);
    assert.strictEqual(first.tag, second.tag);
    const missing = mgr.getEntityByGeometry('VERTEX', { point: [9, 9, 9] });
    assert.strictEqual(missing.found, false);
    assert.strictEqual(missing.tag, null);
  });

  check('PersistentNamingManager traceEntity records creation history', () => {
    const mgr = new PersistentNamingManager();
    const tag = mgr.createEntity('FACE', {});
    const trace = mgr.traceEntity(tag);
    assert.strictEqual(trace.id, tag);
    assert.strictEqual(trace.currentTag, tag);
    assert(trace.generation >= 1);
  });

  // ------------------------------------------------------------------
  // OmniArchive v1 sections, v2 blobs, WAL, journal, vault, atomic saves.
  // ------------------------------------------------------------------
  check('OmniArchive v1 addSection/getSection round-trips object and raw data', () => {
    const arch = new OmniArchive({ projectName: 'Probe' });
    arch.addSection('results', { a: 1 });
    arch.addSection('raw', Buffer.from('bytes'));
    assert.deepStrictEqual(arch.getSection('results'), { a: 1 });
    assert.strictEqual(arch.getSection('raw', false).toString(), 'bytes');
    assert.strictEqual(arch.getSection('missing'), null);
    assert.strictEqual(arch.getSection('manifest').projectName, 'Probe');
  });

  check('OmniArchive v1 rejects empty and over-long section names', () => {
    const arch = new OmniArchive({});
    assert.throws(() => arch.addSection('   ', 'x'), /non-empty string/);
    assert.throws(() => arch.addSection('x'.repeat(70000), 'x'), /65535 bytes/);
  });

  check('OmniArchive v1 rejects unsupported section content types', () => {
    const arch = new OmniArchive({});
    assert.throws(() => arch.addSection('n', 42), /Unsupported content type/);
  });

  check('OmniArchive v1 getSection detects CRC corruption', () => {
    const arch = new OmniArchive({});
    arch.addSection('payload', { k: 'v' });
    const entry = arch.sections.get('payload');
    entry.crc = entry.crc ^ 0xff;
    assert.throws(() => arch.getSection('payload', false), /CRC32 mismatch/);
  });

  check('OmniArchive v1 getSection detects decompressed-length mismatch', () => {
    const arch = new OmniArchive({});
    arch.addSection('payload', { k: 'v' });
    arch.sections.get('payload').rawLength += 5;
    assert.throws(() => arch.getSection('payload', false), /does not match manifest header/);
  });

  check('OmniArchive v2 content-addressed blobs round-trip JSON', () => {
    const arch = new OmniArchiveV2({ projectName: 'V2Probe' });
    const ref = arch.addBlob({ a: 5 }, { mimeType: 'application/json' });
    assert(ref.hash.length === 64);
    assert.deepStrictEqual(arch.getBlob(ref.hash, true), { a: 5 });
    assert.strictEqual(arch.getBlob('0'.repeat(64)), null);
  });

  check('OmniWal open-append-commit lifecycle writes and reports stats', () => {
    const fs = require('fs');
    const archivePath = `/tmp/omni_wal_probe_${process.pid}.omni`;
    const walPath = `/tmp/omni_wal_probe_${process.pid}.wal`;
    try {
      fs.rmSync(walPath, { force: true });
      fs.rmSync(archivePath, { force: true });
      const wal = new OmniWal({ path: walPath, archivePath });
      wal.open();
      wal.appendEntry('write', { section: 'x' });
      wal.commit();
      wal.flush();
      const stats = wal.stats();
      assert(stats.pending === 0);
      assert(stats.committed >= 1);
      wal.close();
    } finally {
      fs.rmSync(walPath, { force: true });
      fs.rmSync(archivePath, { force: true });
    }
  });

  check('CommandJournal undo/redo boundaries preserve order', () => {
    const journal = new CommandJournal();
    assert.strictEqual(journal.undo(), null);
    assert.strictEqual(journal.redo(), null);
    journal.execute('add', { op: 'add' }, { op: 'remove' }, 'add block', 'author');
    assert.strictEqual(journal.canUndo(), true);
    const undone = journal.undo();
    assert.deepStrictEqual(undone.appliedPatch, { op: 'remove' });
    assert.strictEqual(journal.canRedo(), true);
    const redone = journal.redo();
    assert.deepStrictEqual(redone.appliedPatch, { op: 'add' });
    assert.strictEqual(journal.getHistory().length, 1);
  });

  check('CommandJournal execute truncates future branch after undo', () => {
    const journal = new CommandJournal();
    journal.execute('a', { x: 1 }, { x: 0 });
    journal.execute('b', { y: 2 }, { y: 0 });
    journal.undo();
    journal.execute('c', { z: 3 }, { z: 0 });
    const history = journal.getHistory();
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[1].actionType, 'c');
    assert.strictEqual(journal.canRedo(), false);
  });

  check('OmniVaultAES256 encrypt/decrypt round-trips plaintext', () => {
    const enc = OmniVaultAES256.encrypt(Buffer.from('payload'), 'passphrase');
    assert(enc.some((b) => b !== 0));
    assert.strictEqual(OmniVaultAES256.decrypt(enc, 'passphrase').toString(), 'payload');
  });

  check('saveAtomicSync writes through temp file and creates backup only when requested', () => {
    const fs = require('fs');
    const target = `/tmp/omni_atomic_probe_${process.pid}.bin`;
    try {
      fs.writeFileSync(target, 'old');
      saveAtomicSync(target, Buffer.from('new'));
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'new');
      assert.strictEqual(fs.readFileSync(`${target}.bak`, 'utf8'), 'old');
      saveAtomicSync(target, Buffer.from('newer'), false);
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'newer');
    } finally {
      fs.rmSync(target, { force: true });
      fs.rmSync(`${target}.bak`, { force: true });
    }
  });

  check('calculateCRC32 matches the standard CRC-32 check value', () => {
    assert.strictEqual(calculateCRC32(Buffer.from('123456789')), 0xcbf43926);
  });

  // ------------------------------------------------------------------
  // Stenographer supervisor: constructor guards, tool registration,
  // proposals with project revision, registry binding, queries, ledger.
  // ------------------------------------------------------------------
  check('StenographerSupervisor rejects short persistent ledger secrets', () => {
    assert.throws(
      () => new StenographerSupervisor({ ledgerKeyIsPersistent: true, hmacSecret: 'short' }),
      (err) => err instanceof OmniError && err.code === OmniErrorCode.INVALID_INPUT
    );
  });

  check('StenographerSupervisor registerTool requires ToolDefinition instances', () => {
    const s = new StenographerSupervisor({});
    assert.throws(() => s.registerTool({}), /ToolDefinition instance/);
    const td = new ToolDefinition({ name: 'probe.tool', description: 'd', approvalClass: ToolApprovalClass.READ_ONLY });
    s.registerTool(td);
    assert(s.getRegisteredTools().some((t) => (t.name || t) === 'probe.tool'));
  });

  check('StenographerSupervisor rejects read-only tools that modify state', () => {
    const s = new StenographerSupervisor({});
    const td = new ToolDefinition({
      name: 'probe.tool.unsafe',
      description: 'd',
      approvalClass: ToolApprovalClass.READ_ONLY,
      modifiesState: true
    });
    assert.throws(() => s.registerTool(td), /read-only/);
  });

  check('StenographerSupervisor proposeToolCall requires current project revision', () => {
    const s = new StenographerSupervisor({});
    const tool = s.getRegisteredTools().find((t) => t.name && t.name.startsWith('robotics'));
    assert(tool, 'expected at least one robotics tool');
    assert.throws(() => s.proposeToolCall({ toolName: tool.name, arguments: {} }), /project revision/);
    const proposal = s.proposeToolCall({
      toolName: tool.name,
      arguments: { operation: 'forward_kinematics', parameters: { dhTable: 'PUMA_560', q: [0, 0, 0, 0, 0, 0] } },
      originatingProjectId: 'proj-1',
      originatingProjectRevision: 2
    });
    assert.strictEqual(proposal.toolName, tool.name);
    assert.strictEqual(proposal.originatingProjectRevision, 2);
  });

  check('StenographerSupervisor reject unknown tool proposals', () => {
    const s = new StenographerSupervisor({});
    assert.throws(
      () => s.proposeToolCall({ toolName: 'nope.tool', arguments: {}, originatingProjectRevision: 1 }),
      /Unregistered Stenographer tool/
    );
  });

  check('StenographerSupervisor bindEngineRegistry registers default tools', () => {
    const s = new StenographerSupervisor({});
    s.bindEngineRegistry();
    assert(s.getRegisteredTools().length > 0);
  });

  check('StenographerSupervisor processQuery returns a non-null result plan', () => {
    const s = new StenographerSupervisor({});
    const r = s.processQuery({ prompt: 'list tools' });
    assert(r !== null && typeof r === 'object');
  });

  check('StenographerSupervisor ledger integrity verification succeeds on clean ledger', () => {
    const s = new StenographerSupervisor({});
    const v = s.verifyLedgerIntegrity();
    assert(v !== null && typeof v === 'object');
    assert.strictEqual(v.valid, true);
  });

  // ------------------------------------------------------------------
  // System IPC: sparse solve, Radau IIA, proposal matching, archive load.
  // ------------------------------------------------------------------
  check('system_ipc normalizeSparseMatrixInput accepts dense and rejects ragged matrices', () => {
    assert.deepStrictEqual(
      normalizeSparseMatrixInput(
        [
          [4, 1],
          [1, 3]
        ],
        2
      ),
      [
        [4, 1],
        [1, 3]
      ]
    );
    assert.strictEqual(normalizeSparseMatrixInput([[4, 1]], 2), null);
    assert.strictEqual(
      normalizeSparseMatrixInput(
        [
          [4, NaN],
          [1, 3]
        ],
        2
      ),
      null
    );
  });

  check('system_ipc handleGenericSparseSolve returns a verified solution', () => {
    const r = handleGenericSparseSolve({
      A: [
        [4, 1, 0],
        [1, 3, 1],
        [0, 1, 2]
      ],
      b: [1, 2, 3]
    });
    assert.strictEqual(r.success, true);
    assert(r.converged, true);
    const x = r.solution;
    const A = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2]
    ];
    const b = [1, 2, 3];
    for (let i = 0; i < 3; i++) {
      const resid = A[i][0] * x[0] + A[i][1] * x[1] + A[i][2] * x[2] - b[i];
      assert(Math.abs(resid) < 1e-9);
    }
  });

  check('system_ipc handleGenericSparseSolve rejects non-square matrices', () => {
    const r = handleGenericSparseSolve({
      A: [
        [4, 1],
        [1, 3],
        [0, 1]
      ],
      b: [1, 2, 3]
    });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error.code, 'INVALID_INPUT');
  });

  check('system_ipc handleGenericSparseSolve rejects non-finite entries', () => {
    const r = handleGenericSparseSolve({
      A: [
        [4, Infinity],
        [1, 3]
      ],
      b: [1, 2]
    });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error.code, 'INVALID_INPUT');
  });

  check('system_ipc handleRadauIIASolve decay trajectory decreases monotonically', () => {
    const r = handleRadauIIASolve({ system: 'decay', t0: 0, tEnd: 1, y0: [1] });
    assert.strictEqual(r.success, true);
    const traj = r.trajectory;
    assert(traj[0].y[0] === 1);
    assert(traj[traj.length - 1].y[0] < 0.5);
    for (let i = 1; i < traj.length; i++) {
      assert(traj[i].y[0] < traj[i - 1].y[0]);
      assert(Number.isFinite(traj[i].t));
    }
  });

  check('system_ipc handleRadauIIASolve rejects unknown systems and bad states', () => {
    const r1 = handleRadauIIASolve({ system: 'nope', t0: 0, tEnd: 1, y0: [1] });
    assert.strictEqual(r1.error.code, 'INVALID_INPUT');
    const r2 = handleRadauIIASolve({ system: 'decay', t0: 0, tEnd: 1, y0: [1, 2] });
    assert.strictEqual(r2.error.code, 'INVALID_INPUT');
    const r3 = handleRadauIIASolve({ system: 'decay', t0: 1, tEnd: 0, y0: [1] });
    assert.strictEqual(r3.error.code, 'INVALID_INPUT');
  });

  check('system_ipc proposalMatchesActiveProject matches revision and project id', () => {
    const projectService = {
      getManifest: () => ({ projectId: 'p1', revision: 3 })
    };
    assert.strictEqual(
      proposalMatchesActiveProject({ originatingProjectId: 'p1', originatingProjectRevision: 3 }, projectService),
      true
    );
    assert.strictEqual(
      proposalMatchesActiveProject({ originatingProjectId: 'p2', originatingProjectRevision: 3 }, projectService),
      false
    );
    assert.strictEqual(
      proposalMatchesActiveProject({ originatingProjectId: 'p1', originatingProjectRevision: 2 }, projectService),
      false
    );
    assert.strictEqual(proposalMatchesActiveProject(null, projectService), false);
  });

  check('system_ipc loadOmniArchiveFromBuffer rejects undersized buffers', () => {
    const r = loadOmniArchiveFromBuffer(Buffer.from('tiny'), {});
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error.code, 'INVALID_INPUT');
  });

  // ------------------------------------------------------------------
  // EDA IPC handlers: GDSII, LEF/DEF, Gerber, DRC, synthesis branches.
  // ------------------------------------------------------------------
  check('eda_ipc handleGdsiiExportRequest rejects missing geometry inputs', () => {
    const r = handleGdsiiExportRequest({});
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error.code, 'INVALID_INPUT');
    const r2 = handleGdsiiExportRequest({
      libName: 'lib',
      topCell: 'top',
      userUnits: 1e-6,
      dbUnits: 1e-9,
      polygons: []
    });
    assert.strictEqual(r2.success, false);
  });

  check('eda_ipc handleGdsiiExportRequest serializes explicit layout records', () => {
    const r = handleGdsiiExportRequest({
      libName: 'probe_lib',
      topCell: 'TOP',
      userUnits: 1e-6,
      dbUnits: 1e-9,
      polygons: [
        {
          layer: 0,
          datatype: 0,
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
            { x: 1000, y: 1000 },
            { x: 0, y: 1000 }
          ]
        }
      ]
    });
    assert.strictEqual(r.success, true);
    assert(typeof r.base64 === 'string' && r.base64.length > 0);
  });

  check('eda_ipc handleLefParseRequest parses valid and rejects invalid LEF', () => {
    const ok = handleLefParseRequest({ content: LEF_OK });
    assert.strictEqual(ok.success, true);
    assert.strictEqual(ok.version, '5.8');
    assert.strictEqual(ok.macroCount, 1);
    assert.deepStrictEqual(ok.macros, ['INV']);
    const bad = handleLefParseRequest({ content: 'VERSION nope ;' });
    assert.strictEqual(bad.success, false);
    assert.strictEqual(bad.error.code, 'INVALID_INPUT');
  });

  check('eda_ipc handleDefParseRequest parses valid DEF', () => {
    const ok = handleDefParseRequest({ content: DEF_OK });
    assert.strictEqual(ok.success, true);
    assert.strictEqual(ok.name, 'top');
    assert.strictEqual(ok.componentCount, 1);
    assert.strictEqual(ok.netCount, 1);
  });

  check('eda_ipc handleDefSerializeRequest rejects non-record params', () => {
    const r = handleDefSerializeRequest(null);
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error.code, 'INVALID_INPUT');
  });

  check('eda_ipc handleGerberExportRequest rejects missing PCB layout', () => {
    const r = handleGerberExportRequest({});
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error.code, 'INVALID_INPUT');
  });

  check('eda_ipc handleDrcRequest rejects missing record', () => {
    const r = handleDrcRequest({});
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error.code, 'INVALID_INPUT');
  });

  check('eda_ipc handleVerilogSynthesisRequest reports unsupported status', () => {
    const r = handleVerilogSynthesisRequest({ source: 'module m; endmodule', topModule: 'm' });
    assert.strictEqual(r.success, false);
    assert(['unavailable', 'invalid-input'].includes(r.status));
    assert(['UNSUPPORTED', 'INVALID_INPUT'].includes(r.error.code));
  });

  // ------------------------------------------------------------------
  // Skew ray tracer: ray creation validation, surface tracing, full
  // system propagation, pupil grids, spot diagrams and MTF.
  // ------------------------------------------------------------------
  check('SkewRayTracer createRay validates position, direction, wavelength, intensity', () => {
    const ray = SkewRayTracer.createRay([0, 0, 0], [0, 0, 1], 0.5876, 1);
    assert.strictEqual(ray.N, 1);
    assert.strictEqual(ray.wavelengthUm, 0.5876);
    assert.throws(() => SkewRayTracer.createRay([0, 0], [0, 0, 1], 0.5876, 1), TypeError);
    assert.throws(() => SkewRayTracer.createRay([0, 0, 0], [0, 0, 0], 0.5876, 1), TypeError);
    assert.throws(() => SkewRayTracer.createRay([0, 0, 0], [0, 0, 1], 0, 1), TypeError);
    assert.throws(() => SkewRayTracer.createRay([0, 0, 0], [0, 0, 1], 0.5876, -1), TypeError);
  });

  check('SkewRayTracer traceRayThroughSurface validates required surface fields', () => {
    const ray = SkewRayTracer.createRay([0, 0, -5], [0, 0, 1], 0.5876, 1);
    assert.throws(() => SkewRayTracer.traceRayThroughSurface(ray, null), TypeError);
    assert.throws(() => SkewRayTracer.traceRayThroughSurface(null, {}), TypeError);
    assert.throws(
      () =>
        SkewRayTracer.traceRayThroughSurface(ray, {
          radius: 50,
          zVertex: 10,
          conic: 0,
          asphericCoeffs: [0, 0, 0, 0],
          nIncident: 1,
          nTransmitted: 1.5
        }),
      TypeError
    );
    assert.throws(
      () =>
        SkewRayTracer.traceRayThroughSurface(ray, {
          radius: 50,
          zVertex: 10,
          conic: 0,
          asphericCoeffs: [0, 0, 0],
          nIncident: 1,
          nTransmitted: 1.5,
          clearRadius: 10
        }),
      TypeError
    );
  });

  check('SkewRayTracer plane surface refracts a ray', () => {
    const ray = SkewRayTracer.createRay([0, 0, -5], [0, 0, 1], 0.5876, 1);
    const surf = {
      radius: 0,
      zVertex: 0,
      conic: 0,
      asphericCoeffs: [0, 0, 0, 0],
      nIncident: 1,
      nTransmitted: 1.5,
      clearRadius: 25
    };
    const out = SkewRayTracer.traceRayThroughSurface(ray, surf);
    assert.strictEqual(out.isTerminated, false);
    assert.strictEqual(out.z, 0);
    assert.strictEqual(out.currentRefractiveIndex, 1.5);
  });

  check('SkewRayTracer terminated rays short-circuit before surface math', () => {
    const ray = SkewRayTracer.createRay([0, 0, -5], [0, 0, 1], 0.5876, 1);
    ray.isTerminated = true;
    const out = SkewRayTracer.traceRayThroughSurface(ray, {});
    assert.strictEqual(out, ray);
    assert.strictEqual(out.isTerminated, true);
  });

  check('SkewRayTracer traceOpticalSystem propagates rays to sensor plane', () => {
    const surfaces = [
      {
        radius: 50,
        zVertex: 0,
        conic: 0,
        asphericCoeffs: [0, 0, 0, 0],
        nIncident: 1,
        nTransmitted: 1.5,
        clearRadius: 25
      },
      {
        radius: -50,
        zVertex: 10,
        conic: 0,
        asphericCoeffs: [0, 0, 0, 0],
        nIncident: 1.5,
        nTransmitted: 1,
        clearRadius: 25
      }
    ];
    const rays = [
      {
        x: 0,
        y: 0,
        z: -5,
        L: 0,
        M: 0,
        N: 1,
        wavelengthUm: 0.5876,
        intensity: 1,
        opl: 0,
        currentRefractiveIndex: 1,
        path: [[0, 0, -5]]
      }
    ];
    const out = SkewRayTracer.traceOpticalSystem(surfaces, rays, 20);
    assert(out[0].z === 20);
    assert(out[0].path.length >= 3);
    assert(Number.isFinite(out[0].x));
  });

  check('SkewRayTracer traceOpticalSystem rejects malformed rays', () => {
    const surfaces = [
      { radius: 0, zVertex: 0, conic: 0, asphericCoeffs: [0, 0, 0, 0], nIncident: 1, nTransmitted: 1, clearRadius: 25 }
    ];
    assert.throws(() => SkewRayTracer.traceOpticalSystem([], [], 1), TypeError);
    assert.throws(() => SkewRayTracer.traceOpticalSystem(surfaces, [], 1), TypeError);
    assert.throws(
      () =>
        SkewRayTracer.traceOpticalSystem(
          surfaces,
          [{ x: 0, y: 0, z: 0, L: 0, M: 0.5, N: 0.5, wavelengthUm: 0.5, intensity: 1, opl: 0, path: [[0, 0, 0]] }],
          1
        ),
      TypeError
    );
  });

  check('SkewRayTracer generatePupilRayGrid emits normalized finite rays', () => {
    const grid = SkewRayTracer.generatePupilRayGrid(12, 3, 8, 5, 0.5876, 0);
    assert(grid.length > 0);
    for (const ray of grid) {
      assert(Math.abs(Math.hypot(ray.L, ray.M, ray.N) - 1) < 1e-9);
      assert(ray.wavelengthUm === 0.5876);
    }
  });

  check('SkewRayTracer computeSpotDiagram computes finite rms spot radius', () => {
    const traced = [
      { isTerminated: false, path: [[0.1, -0.2, 20]] },
      { isTerminated: false, path: [[-0.05, 0.05, 20]] },
      { isTerminated: false, path: [[0.02, 0.01, 20]] },
      { isTerminated: true, path: [] }
    ];
    const r = SkewRayTracer.computeSpotDiagram(traced);
    assert.strictEqual(r.count, 3);
    assert(Number.isFinite(r.rmsSpotRadiusMm) && r.rmsSpotRadiusMm > 0);
    assert(Number.isFinite(r.centroidX) && Number.isFinite(r.centroidY));
  });

  check('SkewRayTracer computeMTFCurve returns monotonic decreasing MTF', () => {
    const r = SkewRayTracer.computeMTFCurve(0.02, 8, 100, 587.6);
    assert(Number.isFinite(r.cutoffFreqLpMm) && r.cutoffFreqLpMm > 0);
    assert(r.frequencies.length > 2);
    for (let i = 1; i < r.tangentialMTF.length; i++) {
      assert(r.tangentialMTF[i] <= r.tangentialMTF[i - 1] + 1e-9);
      assert(r.sagittalMTF[i] <= r.sagittalMTF[i - 1] + 1e-9);
    }
  });

  // ------------------------------------------------------------------
  // GPU parallel PCG solver: dense and CSR solves plus validation.
  // ------------------------------------------------------------------
  check('GPUParallelPCGSolver solves dense SPD systems', () => {
    const solver = new GPUParallelPCGSolver({ maxIterations: 500, tolerance: 1e-8 });
    const A = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2]
    ];
    const b = [1, 2, 3];
    const r = solver.solve(A, b);
    assert.strictEqual(r.converged, true);
    for (let i = 0; i < 3; i++) {
      const resid = A[i][0] * r.solution[0] + A[i][1] * r.solution[1] + A[i][2] * r.solution[2] - b[i];
      assert(Math.abs(resid) < 1e-6);
    }
  });

  check('GPUParallelPCGSolver solves CSR-format systems', () => {
    const solver = new GPUParallelPCGSolver({ maxIterations: 500, tolerance: 1e-8 });
    const csr = { n: 2, rowPtr: [0, 2, 4], colIdx: [0, 1, 0, 1], values: [4, 1, 1, 3] };
    const b = [1, 2];
    const r = solver.solve(csr, b);
    assert.strictEqual(r.converged, true);
    assert(Math.abs(4 * r.solution[0] + r.solution[1] - 1) < 1e-6);
    assert(Math.abs(r.solution[0] + 3 * r.solution[1] - 2) < 1e-6);
  });

  check('GPUParallelPCGSolver accepts an initial guess vector', () => {
    const solver = new GPUParallelPCGSolver({ maxIterations: 500, tolerance: 1e-8 });
    const r = solver.solve(
      [
        [4, 1],
        [1, 3]
      ],
      [1, 2],
      [0.1, 0.1]
    );
    assert.strictEqual(r.converged, true);
  });

  check('GPUParallelPCGSolver validates matrix shapes and finiteness', () => {
    const solver = new GPUParallelPCGSolver({});
    assert.throws(() => solver.solve([], [1]), TypeError);
    assert.throws(() => solver.solve([[1, 2]], [1, 2]), TypeError);
    assert.throws(
      () =>
        solver.solve(
          [
            [1, NaN],
            [0, 1]
          ],
          [1, 1]
        ),
      TypeError
    );
    assert.throws(() => solver.solve({ n: 3, rowPtr: [0, 1], colIdx: [0], values: [1] }, [1, 2, 3]), TypeError);
  });

  // ------------------------------------------------------------------
  // Damped least-squares optimizer: option validation and a real run.
  // ------------------------------------------------------------------
  check('DampedLeastSquaresOptimizer requires explicit damping options', () => {
    const nomissing = new DampedLeastSquaresOptimizer({});
    let threw = false;
    try {
      const r = nomissing.optimize(
        DLS_SYSTEM,
        [{ surfaceIndex: 1, param: 'curvature', value: 0.02, min: -0.5, max: 0.5 }],
        [{ type: 'MARGINAL_RAY_HEIGHT', weight: 1, targetMm: 0 }]
      );
      if (r && r.success === false) threw = true;
    } catch (err) {
      threw = true;
    }
    assert.strictEqual(threw, true);
    const vars = [{ surfaceIndex: 1, param: 'curvature', value: 0.02, min: -0.5, max: 0.5 }];
    const operands = [{ type: 'MARGINAL_RAY_HEIGHT', weight: 1, targetMm: 0 }];
    assert.throws(
      () =>
        new DampedLeastSquaresOptimizer({ ...DLS_OPTIONS, minimumDamping: 10, maximumDamping: 1 }).optimize(
          DLS_SYSTEM,
          vars,
          operands
        ),
      /damping bounds/
    );
    assert.throws(
      () =>
        new DampedLeastSquaresOptimizer({ ...DLS_OPTIONS, initialDamping: 1e-9 }).optimize(DLS_SYSTEM, vars, operands),
      /initialDamping must lie/
    );
    assert.throws(
      () =>
        new DampedLeastSquaresOptimizer({ ...DLS_OPTIONS, dampingReductionFactor: 1 }).optimize(
          DLS_SYSTEM,
          vars,
          operands
        ),
      /dampingReductionFactor/
    );
    assert.throws(
      () => new DampedLeastSquaresOptimizer({ ...DLS_OPTIONS, maxIterations: 0 }).optimize(DLS_SYSTEM, vars, operands),
      /maxIterations/
    );
  });

  check('DampedLeastSquaresOptimizer optimize returns a finite merit result', () => {
    const opt = new DampedLeastSquaresOptimizer(DLS_OPTIONS);
    const vars = [{ surfaceIndex: 1, param: 'curvature', value: 0.02, min: -0.5, max: 0.5 }];
    const operands = [
      { type: 'MARGINAL_RAY_HEIGHT', weight: 1, targetMm: 0 },
      { type: 'PARAXIAL_FOCAL_LENGTH', weight: 1, targetMm: 20 }
    ];
    const r = opt.optimize(DLS_SYSTEM, vars, operands);
    assert(r && typeof r === 'object');
    assert(Number.isFinite(r.finalMerit ?? r.merit ?? r.objective));
  });

  check('DampedLeastSquaresOptimizer rejects malformed merit operands', () => {
    const opt = new DampedLeastSquaresOptimizer(DLS_OPTIONS);
    assert.throws(() => opt.optimize(DLS_SYSTEM, [], []), /at least one explicit optical merit operand/);
    assert.throws(() => opt.optimize(DLS_SYSTEM, [], [{ type: 'BOGUS', weight: 1, targetMm: 1 }]), /unsupported type/);
    assert.throws(
      () => opt.optimize(DLS_SYSTEM, [], [{ type: 'MARGINAL_RAY_HEIGHT', weight: 0, targetMm: 1 }]),
      /positive residual scale/
    );
  });

  // ------------------------------------------------------------------
  // Worker pool: legacy queue validation, kernel dispatch, cancellation.
  // ------------------------------------------------------------------
  check('Worker pool legacy queue validates options strictly', async () => {
    assert.throws(() => new ExperimentalCalculationQueue(null), TypeError);
    assert.throws(
      () => new ExperimentalCalculationQueue({ maxWorkers: 2 }),
      (err) => err.code === 'UNSUPPORTED'
    );
    assert.throws(
      () => new ExperimentalCalculationQueue({ bogus: true }),
      (err) => err.code === 'UNSUPPORTED'
    );
    const q = new ExperimentalCalculationQueue({ maxWorkers: 1 });
    await assert.rejects(q.dispatch('', {}), /task type is required/);
    await assert.rejects(q.dispatch('ECHO_TEST', null), /payload object is required/);
    await assert.rejects(q.dispatch('ECHO_TEST', {}, { priority: 'LOW' }), (err) => err.code === 'INVALID_INPUT');
  });

  check('Worker pool legacy queue executes ECHO and WASM SIMD kernels', async () => {
    const q = new ExperimentalCalculationQueue();
    const echo = await q.dispatch('ECHO_TEST', { message: 'hi' });
    assert.strictEqual(echo.result.echo, 'hi');
    assert(Number.isFinite(echo.computeTimeMs));
    const dot = await q.dispatch('WASM_SIMD_BLAS', { operation: 'dotProduct', a: [1, 2, 3], b: [4, 5, 6] });
    assert.strictEqual(dot.result.dotProduct, 32);
    const daxpy = await q.dispatch('WASM_SIMD_BLAS', { operation: 'daxpy', x: [1, 1, 1], y: [0, 0, 0], alpha: 2 });
    assert.deepStrictEqual(daxpy.result.y, [2, 2, 2]);
    const spmv = await q.dispatch('WASM_SIMD_BLAS', {
      operation: 'spmv',
      rowPtr: [0, 2, 4],
      colInd: [0, 1, 0, 1],
      values: [2, 0, 0, 3],
      x: [1, 2],
      y: [0, 0],
      nRows: 2
    });
    assert.deepStrictEqual(spmv.result.y, [2, 6]);
    const norm = await q.dispatch('WASM_SIMD_BLAS', { operation: 'norm', vec: [3, 4] });
    assert.strictEqual(norm.result.norm, 5);
  });

  check('Worker pool legacy queue rejects unsupported task types', async () => {
    const q = new ExperimentalCalculationQueue();
    await assert.rejects(q.dispatch('NOT_A_KERNEL', {}), (err) => err.code === 'UNSUPPORTED');
  });

  check('Worker pool legacy queue rejects invalid shared-buffer requests', () => {
    const q = new ExperimentalCalculationQueue();
    assert.throws(() => q.allocateSharedBuffer(-1), TypeError);
    assert.throws(() => q.allocateSharedBuffer(1.5), TypeError);
  });

  check('PersistentWorkerPool caps worker counts and enforces node-only mode', () => {
    assert.throws(
      () => new PersistentWorkerPool({ maxWorkers: 999 }),
      (err) => err.code === OmniErrorCode.RESOURCE_EXHAUSTED
    );
    assert.throws(
      () => new PersistentWorkerPool({ useThreads: false }),
      (err) => err.code === OmniErrorCode.UNSUPPORTED
    );
  });

  // ------------------------------------------------------------------
  // LEF/DEF parser: full valid files plus structural error branches.
  // ------------------------------------------------------------------
  check('LefDefParser parseLEF parses a complete macro', () => {
    const lib = LefDefParser.parseLEF(LEF_OK);
    assert.strictEqual(lib.version, '5.8');
    assert.ok(lib.layers.metal1);
    assert.strictEqual(lib.macros.INV.class, 'CORE');
    assert.deepStrictEqual(lib.macros.INV.size, { width: 10, height: 20 });
    assert.strictEqual(lib.macros.INV.pins.A.direction, 'INPUT');
    assert(lib.macros.INV.obstructions.length >= 1);
  });

  check('LefDefParser parseLEF rejects invalid declarations', () => {
    assert.throws(() => LefDefParser.parseLEF('VERSION abc ;'), /Invalid LEF VERSION/);
    assert.throws(() => LefDefParser.parseLEF('VERSION 5.8 ;\nLAYER m1 ;\nLAYER m1 ;'), /duplicate LEF layer/);
    assert.throws(() => LefDefParser.parseLEF('VERSION 5.8 ;\nMACRO A\n MACRO B\nEND B\nEND A'), /nested/);
    assert.throws(() => LefDefParser.parseLEF('VERSION 5.8 ;\nMACRO A\nEND A'), /MACRO 'A'/);
    assert.throws(
      () => LefDefParser.parseLEF('VERSION 5.8 ;\nMACRO A\n CLASS CORE ;\n SIZE 10 20 ;\nEND A'),
      /Invalid LEF SIZE/
    );
    assert.throws(
      () =>
        LefDefParser.parseLEF(
          'VERSION 5.8 ;\nMACRO A\n CLASS CORE ;\n PIN X\n DIRECTION INPUT ;\n END X\n PIN X\n DIRECTION OUTPUT ;\n END X\nEND A'
        ),
      /duplicate LEF PIN/
    );
    assert.throws(
      () =>
        LefDefParser.parseLEF('VERSION 5.8 ;\nMACRO A\n CLASS CORE ;\n PIN X\n DIRECTION SIDEWAYS ;\n END X\nEND A'),
      /Invalid LEF DIRECTION/
    );
    assert.throws(() => LefDefParser.parseLEF('VERSION 5.8 ;\nMACRO A\n CLASS CORE ;\nEND A\nMACRO B'), /MACRO 'A'/);
  });

  check('LefDefParser parseDEF parses components and nets', () => {
    const design = LefDefParser.parseDEF(DEF_OK);
    assert.strictEqual(design.name, 'top');
    assert.strictEqual(design.unitsDistanceMicrons, 1000);
    assert.strictEqual(design.components.length, 1);
    assert.strictEqual(design.components[0].macro, 'INV');
    assert.strictEqual(design.nets.length, 1);
    assert.strictEqual(design.nets[0].name, 'n1');
  });

  check('LefDefParser serializeDEF round-trips design structure', () => {
    const design = LefDefParser.parseDEF(DEF_OK);
    const text = LefDefParser.serializeDEF(design);
    assert(text.includes('DESIGN top'));
    assert(text.includes('INV'));
    assert(text.includes('n1'));
  });

  check('LefDefParser parseDEF rejects malformed component declarations', () => {
    assert.throws(
      () =>
        LefDefParser.parseDEF('VERSION 5.8 ;\nDESIGN top ;\nCOMPONENTS 1 ;\n - u1 INV ;\nEND COMPONENTS\nEND DESIGN'),
      /Invalid DEF component declaration/
    );
  });

  // ------------------------------------------------------------------
  // Static timing analysis: path statuses, MCMM corners, DAG analysis.
  // ------------------------------------------------------------------
  check('StaticTimingAnalysis evaluatePathTiming classifies slack statuses', () => {
    assert.strictEqual(StaticTimingAnalysis.evaluatePathTiming({}).status, 'TIMING_MET');
    assert.strictEqual(
      StaticTimingAnalysis.evaluatePathTiming({ gateDelaysNs: [5], wireDelaysNs: [1] }).status,
      'SETUP_VIOLATION'
    );
    assert.strictEqual(StaticTimingAnalysis.evaluatePathTiming({ tHoldNs: 10 }).status, 'HOLD_VIOLATION');
  });

  check('StaticTimingAnalysis evaluateMCMM produces per-corner setup/hold findings', () => {
    const r = StaticTimingAnalysis.evaluateMCMM({ name: 'path1', setupSlackNs: 0.5, holdSlackNs: 0.2 }, [
      { name: 'ff', scalingFactor: 1.2 },
      { name: 'ss', scalingFactor: 0.8 }
    ]);
    assert.strictEqual(r.cornerCount, 2);
    assert(r.cornerReports.length === 2);
    for (const report of r.cornerReports) {
      assert(report.corner);
      assert('setupSlackNs' in report && 'holdSlackNs' in report);
    }
  });

  check('StaticTimingAnalysis analyzeTiming reports finite path timings on a DAG', () => {
    const r = StaticTimingAnalysis.analyzeTiming({
      nodes: [
        { id: 'clk', type: 'input' },
        { id: 'g1', type: 'gate' },
        { id: 'out', type: 'output' }
      ],
      edges: [
        { from: 'clk', to: 'g1' },
        { from: 'g1', to: 'out' }
      ]
    });
    assert(Array.isArray(r.corners) && r.corners.length >= 1);
    assert(Number.isFinite(r.worstSetupSlackOverall));
    assert(Number.isFinite(r.worstHoldSlackOverall));
  });

  check('StaticTimingAnalysis analyzeTiming detects cycles and invalid graphs', () => {
    assert.throws(
      () =>
        StaticTimingAnalysis.analyzeTiming({
          nodes: [{ id: 'a' }, { id: 'b' }],
          edges: [
            { from: 'a', to: 'b' },
            { from: 'b', to: 'a' }
          ]
        }),
      /cycle/
    );
    assert.throws(() => StaticTimingAnalysis.analyzeTiming(null), TypeError);
    assert.throws(() => StaticTimingAnalysis.analyzeTiming({ nodes: [] }), /at least one node/);
    assert.throws(() => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a', type: 'pin' }] }), /unsupported type/);
  });

  check('StaticTimingAnalysis Elmore delay is finite and monotone in wire length', () => {
    const d1 = StaticTimingAnalysis.computeElmoreDelay(50, 100, 1e-12, 1e-13);
    const d2 = StaticTimingAnalysis.computeElmoreDelay(50, 200, 1e-12, 1e-13);
    assert(Number.isFinite(d1) && d1 > 0);
    assert(d2 > d1);
  });

  // ------------------------------------------------------------------
  // Process flowsheet solver: stream validation, solve errors, a real
  // unit-operation solve.
  // ------------------------------------------------------------------
  check('ProcessFlowsheetSolver ProcessStream validates ids and compositions', () => {
    assert.throws(() => new ProcessStream('', 'feed'), /non-empty id/);
    assert.throws(() => new ProcessStream('s1', 'feed', 25, 101.325, 100, { A: 0.5 }), /composition/);
    assert.throws(() => new ProcessStream('s2', 'feed', 25, 101.325, 100, { A: 0.6, B: 0.6 }), /composition/);
  });

  check('ProcessFlowsheetSolver rejects invalid solve arguments', () => {
    const solver = new ProcessFlowsheetSolver();
    const r = solver.solve(0, 1e-6);
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.status, 'invalid-input');
  });

  check('ProcessFlowsheetSolver rejects solving without units', () => {
    const solver = new ProcessFlowsheetSolver();
    solver.addStream(new ProcessStream('feed', 'Feed', 25, 101.325, 100, { A: 0.5, B: 0.5 }, 0.5));
    const r = solver.solve(50, 1e-6);
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error.code, 'INVALID_INPUT');
  });

  check('ProcessFlowsheetSolver rejects duplicate stream ids', () => {
    const solver = new ProcessFlowsheetSolver();
    const s = new ProcessStream('feed', 'Feed', 25, 101.325, 100, { A: 0.5, B: 0.5 }, 0.5);
    solver.addStream(s);
    assert.throws(() => solver.addStream(s.clone('feed')), /Duplicate process stream id/);
  });

  check('ProcessFlowsheetSolver solve converges a mixer-flash flowsheet', () => {
    const solver = new ProcessFlowsheetSolver();
    const componentProperties = getExperimentalThermoProperties(['Methane', 'Ethane', 'Propane']);
    const streamSpecs = [
      ['feed', 100.0, 0.5],
      ['mixed', 100.0, 0.5],
      ['vap', 0.0, 1.0],
      ['liq', 0.0, 0.0]
    ];
    for (const [id, flow, vaporFraction] of streamSpecs) {
      solver.addStream(
        new ProcessStream(id, {
          temperatureC: 25.0,
          pressureBar: 20.0,
          molarFlowKmolH: flow,
          composition: { Methane: 0.7, Ethane: 0.2, Propane: 0.1 },
          vaporFraction
        })
      );
    }
    solver.addMixer('M1', ['feed'], 'mixed');
    solver.addFlashDrum('F1', 'mixed', 'vap', 'liq', {
      temperatureC: -20.0,
      pressureBar: 18.0,
      componentProperties
    });
    const r = solver.solveWithWegstein(50, 1e-4);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.converged, true);
    const liq = solver.getStream('liq');
    const vap = solver.getStream('vap');
    assert(liq && vap);
    assert(Number.isFinite(liq.molarFlowKmolH));
    assert(Math.abs(liq.molarFlowKmolH + vap.molarFlowKmolH - 100) < 0.5);
  });

  // ------------------------------------------------------------------
  // PDM adapter: where_used and lifecycle validation branches.
  // ------------------------------------------------------------------
  check('PDMEngineAdapter validate rejects missing parameter objects', async () => {
    const adapter = new PDMEngineAdapter();
    await assert.rejects(adapter.validate({ operation: 'where_used' }), OmniError);
    await assert.rejects(adapter.validate({ operation: 'where_used', parameters: {} }), OmniError);
  });

  check('PDMEngineAdapter validate requires target partNumber for where_used', async () => {
    const adapter = new PDMEngineAdapter();
    await assert.rejects(
      adapter.validate({
        operation: 'where_used',
        parameters: { rootAssembly: { id: 'r' }, partNumber: '' }
      }),
      OmniError
    );
  });

  check('PDMEngineAdapter execute finds where-used usages', async () => {
    const adapter = new PDMEngineAdapter();
    const out = await adapter.execute(
      {
        jobId: 'pdm-1',
        domain: 'pdm',
        operation: 'where_used',
        parameters: {
          rootAssembly: {
            id: 'r',
            partNumber: 'R-001',
            name: 'Root',
            children: [
              {
                id: 'c1',
                partNumber: 'P-100',
                name: 'Child1',
                children: []
              }
            ]
          },
          partNumber: 'P-100'
        }
      },
      () => {},
      null
    );
    assert.strictEqual(out.status, 'COMPLETED');
    assert.strictEqual(out.outputData.partNumber, 'P-100');
    assert.strictEqual(out.outputData.totalOccurrences, 1);
    assert.strictEqual(out.outputData.usages[0].parentPartNumber, 'R-001');
  });

  check('PDMEngineAdapter execute warns on obsolete lifecycle states', async () => {
    const adapter = new PDMEngineAdapter();
    const out = await adapter.execute(
      {
        jobId: 'pdm-2',
        domain: 'pdm',
        operation: 'validate_lifecycle',
        parameters: {
          item: { id: 'i1', partNumber: 'P-200', name: 'Old', state: 'OBSOLETE' }
        }
      },
      () => {},
      null
    );
    assert.strictEqual(out.status, 'COMPLETED');
    assert(out.outputData.warnings.some((w) => typeof w === 'string' && w.includes('OBSOLETE')));
  });

  // ------------------------------------------------------------------
  // EDA engine adapter: transient simulation, cancellation, unsupported
  // components.
  // ------------------------------------------------------------------
  const TRANSIENT_JOB = {
    jobId: 'eda-1',
    domain: 'eda',
    operation: 'simulate_spice_transient',
    parameters: {
      analysis: { type: 'transient', stopTimeS: 0.002, stepS: 1e-4 },
      components: [
        { id: 'V1', type: 'V', nPlus: 'a', nMinus: '0', dcValue: 5 },
        { id: 'R1', type: 'R', n1: 'a', n2: 'b', value: 1000 },
        { id: 'C1', type: 'C', n1: 'b', n2: '0', value: 1e-6 }
      ]
    }
  };

  check('EDAEngineAdapter execute runs a transient circuit to completion', async () => {
    const adapter = new EDAEngineAdapter();
    const out = await adapter.execute(TRANSIENT_JOB, () => {}, null);
    assert.strictEqual(out.status, 'COMPLETED');
    assert(Array.isArray(out.outputData.time) && out.outputData.time.length > 1);
    assert(out.outputData.nodes && typeof out.outputData.nodes === 'object');
    assert(Object.keys(out.outputData.nodes).length > 0);
  });

  check('EDAEngineAdapter execute honours cancellation signals', async () => {
    const adapter = new EDAEngineAdapter();
    await assert.rejects(
      adapter.execute(TRANSIENT_JOB, () => {}, { aborted: true }),
      (err) => err instanceof OmniError && err.code === OmniErrorCode.CANCELLED
    );
  });

  check('EDAEngineAdapter execute rejects unsupported component types', async () => {
    const adapter = new EDAEngineAdapter();
    const job = {
      jobId: 'eda-2',
      domain: 'eda',
      operation: 'simulate_spice_transient',
      parameters: {
        analysis: { type: 'transient', stopTimeS: 0.001, stepS: 1e-4 },
        components: [{ id: 'X1', type: 'X', n1: 'a', n2: '0' }]
      }
    };
    await assert.rejects(adapter.execute(job), (err) => err.code === OmniErrorCode.UNSUPPORTED);
  });

  // ------------------------------------------------------------------
  // ODE solvers: RK4/RK45 validation and Radau IIA behavior.
  // ------------------------------------------------------------------
  check('ODESolvers solveRK4 rejects non-positive steps and integrates decay', () => {
    assert.throws(() => ODESolvers.solveRK4((t, y) => y, 0, [1], -0.01, 10), RangeError);
    const traj = ODESolvers.solveRK4((t, y) => [-y[0]], [1], 0, 1, 0.01);
    const last = traj[traj.length - 1];
    assert(Number.isFinite(last.y[0]));
    assert(Math.abs(last.y[0] - Math.exp(-1)) < 1e-3);
  });

  check('ODESolvers solveRK45 integrates with adaptive step', () => {
    const traj1 = ODESolvers.solveRK45((t, y) => [-y[0]], [1], 0, 1);
    const last1 = traj1[traj1.length - 1];
    assert(Number.isFinite(last1.y[0]));
    assert(Math.abs(last1.y[0] - Math.exp(-1)) < 1e-3);
    const traj2 = ODESolvers.solveRK45((t, y) => [-y[0]], [1], 0, 1, 1e-6, 0.05);
    const last2 = traj2[traj2.length - 1];
    assert(Number.isFinite(last2.y[0]));
    assert(Math.abs(last2.y[0] - Math.exp(-1)) < 1e-3);
  });

  check('RadauIIA integrates decay to exp(-1)', () => {
    const solver = new RadauIIA({});
    const traj = solver.solve((t, y) => [-y[0]], 0, [1], 1);
    const last = traj[traj.length - 1];
    assert(Math.abs(last.y[0] - Math.exp(-1)) < 1e-3);
  });

  check('RadauIIA rejects invalid time spans and initial states', () => {
    const solver = new RadauIIA({});
    const decay = (t, y) => [-y[0]];
    assert.throws(() => solver.solve(decay, 1, [1], 0), /requires finite t0 <= tEnd/);
    assert.throws(() => solver.solve(decay, 0, 'x', 1), /finite scalar or numeric-array initial state/);
  });

  // ------------------------------------------------------------------
  // FVM Navier-Stokes: option branches reached through a real step.
  // ------------------------------------------------------------------
  check('FVMNavierStokes3D runs a box step with custom turbulence options', () => {
    const fvm = new FVMNavierStokes3D({
      turbulenceIntensity: 0.06,
      turbulentViscosityRatio: 8,
      kInlet: 0.5,
      omegaInlet: 20,
      wallDragRampLength: 0.1,
      projectionRelaxation: 0.85,
      projectionIters: 60,
      wallLawConstant: 9.6,
      wakeParameterPi: 0.55,
      outflowSpongeLength: 0.1,
      outflowSpongeStrength: 250
    });
    assert.strictEqual(fvm.getKInlet(), 0.5);
    assert.strictEqual(fvm.getOmegaInlet(), 20);
    fvm.createBoxDomain(6, 6, 4, 1.0, 1.0, 0.5, 1.5);
    const r = fvm.step(20, 3, 'roe');
    assert(Number.isFinite(r.maxVelocity) && r.maxVelocity > 0);
    assert.strictEqual(r.stepCount, 3);
  });

  check('FVMNavierStokes3D runs an acoustic-CFL step with MRF source', () => {
    const fvm = new FVMNavierStokes3D({
      cflBasis: 'acoustic',
      omegaMRF: { x: 0, y: 0, z: 50 }
    });
    fvm.createBoxDomain(5, 5, 4, 0.8, 0.8, 0.5);
    const cell = fvm.cells[0];
    cell.u = 10;
    const mrf = fvm.computeMRFSource(cell);
    assert(Number.isFinite(mrf.fy));
    const r = fvm.step(15, 2, 'ausm_plus');
    assert(Number.isFinite(r.maxVelocity) && r.maxVelocity > 0);
    assert.strictEqual(r.stepCount, 2);
  });

  await Promise.all(pending);

  console.log('\n================================================================');
  console.log(`   BRANCH EXTENSION RESULTS: ${passedTests}/${totalTests} passed; ${failedTests} failed`);
  console.log('================================================================');
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchCoverageExtensionTests };

if (require.main === module) {
  runBranchCoverageExtensionTests().then((stats) => {
    if (stats.failed > 0) process.exitCode = 1;
  });
}
