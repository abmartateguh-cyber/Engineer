/** Experimental smoke checks for legacy aerospace calculation examples.
 * These checks exercise code paths and simple invariants; they are not independent
 * reference comparisons, standards assessments, or flight-design validation.
 */

const assert = require('assert');
const { NasaRocketPropulsion } = require('../src/core/aerospace/nasa_rocket_propulsion');

function getCoolingSmokeInputs(perf) {
  return {
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
    inputSourceDescription:
      'Unvalidated smoke-test inputs; assumes engine fuel flow is coolant flow; not physical-property reference data'
  };
}

function getTurbopumpSmokeInputs() {
  return {
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
    inputSourceDescription: 'Unvalidated smoke-test inputs; not pump-map or cavitation reference data'
  };
}

function runNasaRocketPropulsionTests() {
  let passedTests = 0;
  let totalTests = 0;

  function runTest(name, fn) {
    totalTests++;
    try {
      fn();
      console.log(`  ✓ PASSED: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  console.log('================================================================');
  console.log('   EXPERIMENTAL LEGACY AEROSPACE SMOKE CHECKS ONLY              ');
  console.log('   NO INDEPENDENT REFERENCE OR STANDARDS VALIDATION              ');
  console.log('================================================================');

  const aero = new NasaRocketPropulsion();

  // -----------------------------------------------------------------------------
  // [SUITE 1] Experimental propellant calculation smoke checks
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 1] Experimental propellant calculation smoke checks');

  runTest('LOX/LCH4 example returns finite experimental properties', () => {
    const result = aero.evaluateCombustionEquilibrium('LOX_LCH4', 300.0, 3.6);
    assert.strictEqual(result.success, true);
    assert(
      [result.chamberTemperatureK, result.gamma, result.characteristicVelocityM_s, result.molecularWeightKgKmol].every(
        Number.isFinite
      )
    );
    assert(
      result.chamberTemperatureK > 0 &&
        result.gamma > 1 &&
        result.characteristicVelocityM_s > 0 &&
        result.molecularWeightKgKmol > 0
    );
  });

  runTest('LOX/LH2 example returns finite experimental properties', () => {
    const result = aero.evaluateCombustionEquilibrium('LOX_LH2', 200.0, 6.0);
    assert.strictEqual(result.success, true);
    assert(Number.isFinite(result.characteristicVelocityM_s) && result.characteristicVelocityM_s > 0);
    assert(Number.isFinite(result.molecularWeightKgKmol) && result.molecularWeightKgKmol > 0);
  });

  runTest('Off-design mixture ratio correctly penalizes flame temperature', () => {
    const opt = aero.evaluateCombustionEquilibrium('LOX_LCH4', 300.0, 3.6);
    const offDesign = aero.evaluateCombustionEquilibrium('LOX_LCH4', 300.0, 2.5);
    assert(
      offDesign.chamberTemperatureK < opt.chamberTemperatureK,
      'Off-design O/F should decrease chamber temperature'
    );
  });

  // -----------------------------------------------------------------------------
  // [SUITE 2] Isentropic nozzle calculation smoke checks
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 2] Isentropic nozzle calculation smoke checks');

  runTest('Area ratio inversion returns monotonic supersonic roots', () => {
    const M_35 = aero.solveNozzleExitMach(35.0, 1.22);
    assert(M_35 > 3.5 && M_35 < 4.8, `Exit Mach ${M_35} for eps=35 should be ~4.0`);

    const M_150 = aero.solveNozzleExitMach(150.0, 1.22);
    assert(M_150 > M_35, `Vacuum expansion ratio eps=150 must have higher Mach than eps=35`);
  });

  runTest('Engine performance returns finite sea-level and vacuum estimates', () => {
    const perf = aero.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 300.0,
      ofRatio: 3.6,
      throatDiameterM: 0.232,
      expansionRatio: 35.0,
      ambientPressureBar: 1.01325
    });

    assert(Number.isFinite(perf.thrustSeaLevelKN) && perf.thrustSeaLevelKN > 0);
    assert(perf.thrustVacuumKN > perf.thrustSeaLevelKN, `Vacuum thrust must exceed sea-level thrust`);
    assert(Number.isFinite(perf.IspSeaLevelS) && perf.IspSeaLevelS > 0);
    assert(perf.IspVacuumS > perf.IspSeaLevelS, `Vacuum Isp must exceed Sea-Level Isp`);
    assert(Number.isFinite(perf.massFlowTotalKgS) && perf.massFlowTotalKgS > 0);
  });

  // -----------------------------------------------------------------------------
  // [SUITE 3] Bartz Convective Heat Transfer & Narloy-Z Cooling
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 3] Bartz Convective Heat Transfer & Narloy-Z Cooling');

  runTest('Bartz example returns finite heat transfer quantities', () => {
    const perf = aero.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 300.0,
      ofRatio: 3.6,
      throatDiameterM: 0.232,
      expansionRatio: 35.0,
      ambientPressureBar: 1.01325
    });

    const cooling = aero.calculateBartzRegenerativeCooling(perf, getCoolingSmokeInputs(perf));

    assert.strictEqual(cooling.success, true);
    assert.strictEqual(cooling.validationLevel, 'experimental');
    assert(Number.isFinite(cooling.heatFluxThroatMW_m2) && cooling.heatFluxThroatMW_m2 > 0);
    assert(
      cooling.gasSideWallTempK > cooling.coolantSideWallTempK,
      'Gas-side wall must be hotter than coolant-side wall'
    );
    assert(Number.isFinite(cooling.coolantTempRiseK) && cooling.coolantTempRiseK > 0);
    assert(Number.isFinite(cooling.coolantPressureDropPa) && cooling.coolantPressureDropPa > 0);
    assert.strictEqual(cooling.inputs.inputSourceDescription, getCoolingSmokeInputs(perf).inputSourceDescription);
  });

  // -----------------------------------------------------------------------------
  // [SUITE 4] Euler Turbomachinery & Power Balance
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 4] Euler Turbomachinery & Power Balance');

  runTest('Turbopump example returns explicit-input estimates without a cavitation verdict', () => {
    const perf = aero.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 300.0,
      ofRatio: 3.6,
      throatDiameterM: 0.232,
      expansionRatio: 35.0,
      ambientPressureBar: 1.01325
    });
    const cooling = aero.calculateBartzRegenerativeCooling(perf, getCoolingSmokeInputs(perf));
    const turbo = aero.calculateTurbopumpSystem(perf, cooling, getTurbopumpSmokeInputs());

    assert.strictEqual(turbo.success, true);
    assert.strictEqual(turbo.validationLevel, 'experimental');
    assert(Number.isFinite(turbo.totalPumpingPowerMW) && turbo.totalPumpingPowerMW > 0);
    assert(Number.isFinite(turbo.fuelTurbopumpRPM) && turbo.fuelTurbopumpRPM > 0);
    assert(Number.isFinite(turbo.fuelImpellerDiameterMm) && turbo.fuelImpellerDiameterMm > 0);
    assert(Number.isFinite(turbo.cavitationMarginOx));
    assert.strictEqual(turbo.cavitationStatus, 'NOT ASSESSED');
  });

  runTest('Cooling and turbopump estimates reject omitted engineering inputs', () => {
    const perf = aero.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 300.0,
      ofRatio: 3.6,
      throatDiameterM: 0.232,
      expansionRatio: 35.0,
      ambientPressureBar: 1.01325
    });
    const missingCooling = aero.calculateBartzRegenerativeCooling(perf);
    assert.strictEqual(missingCooling.success, false);
    assert.strictEqual(missingCooling.error.code, 'INVALID_INPUT');
    assert(missingCooling.error.message.includes('coolant properties object'));

    const cooling = aero.calculateBartzRegenerativeCooling(perf, getCoolingSmokeInputs(perf));
    const missingPumpInputs = aero.calculateTurbopumpSystem(perf, cooling);
    assert.strictEqual(missingPumpInputs.success, false);
    assert.strictEqual(missingPumpInputs.error.code, 'INVALID_INPUT');
    assert(missingPumpInputs.error.message.includes('turbopump properties object'));
  });

  runTest('Legacy cooling and turbopump entry points delegate to explicit-input calculations', () => {
    const engineParameters = {
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 300.0,
      ofRatio: 3.6,
      throatDiameterM: 0.232,
      expansionRatio: 35.0,
      ambientPressureBar: 1.01325
    };
    const performance = aero.calculateEnginePerformance(engineParameters);
    const coolantProps = getCoolingSmokeInputs(performance);
    const pumpProps = getTurbopumpSmokeInputs();

    const cooling = aero.solveBartzHeatTransfer(engineParameters, coolantProps);
    assert.strictEqual(cooling.success, true);
    assert.strictEqual(cooling.qThroat_MW_m2, cooling.heatFluxThroatMW_m2);

    const turbopump = aero.solveTurbopumpPowerBalance(engineParameters, coolantProps, pumpProps);
    assert.strictEqual(turbopump.success, true);
    assert.strictEqual(turbopump.fuelPumpPowerMW, turbopump.fuelPumpPowerW / 1e6);
    assert.strictEqual(turbopump.oxPumpPowerMW, turbopump.oxidizerPumpPowerW / 1e6);
    assert.strictEqual(turbopump.turbopumpPowerMw, turbopump.totalPumpingPowerMW);

    const missingInputs = aero.solveBartzHeatTransfer();
    assert.strictEqual(missingInputs.success, false);
    assert.strictEqual(missingInputs.error.code, 'INVALID_INPUT');
  });

  // -----------------------------------------------------------------------------
  // [SUITE 5] 1976 US Standard Atmosphere & Max-Q Ascent Trajectory
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 5] 1976 US Standard Atmosphere & Max-Q Ascent Trajectory');

  runTest('1976 US Standard Atmosphere matches sea level, tropopause, and stratosphere baselines', () => {
    const sl = aero.get1976Atmosphere(0.0);
    assert.strictEqual(sl.success, true);
    assert(Math.abs(sl.pressurePa - 101325.0) < 1.0, `Sea level pressure error`);
    assert(Math.abs(sl.temperatureK - 288.15) < 0.1, `Sea level temperature error`);
    assert(Math.abs(sl.densityKgM3 - 1.225) < 0.01, `Sea level density error`);

    const tropo = aero.get1976Atmosphere(11000.0);
    assert(Math.abs(tropo.temperatureK - 216.65) < 0.5, `Tropopause temperature error`);
    assert(tropo.pressurePa < 25000.0 && tropo.pressurePa > 20000.0, `Tropopause pressure error`);

    const strato = aero.get1976Atmosphere(30000.0);
    assert(strato.densityKgM3 < 0.03, `Stratosphere density must be sparse`);
    assert.strictEqual(aero.get1976Atmosphere(-1).success, false);
    assert.strictEqual(aero.get1976Atmosphere(86001).success, false);
  });

  runTest('Ascent example returns finite trajectory diagnostics for explicit inputs', () => {
    const traj = aero.simulateAscentTrajectory({
      liftOffMassKg: 1450000.0,
      stage1PropellantMassKg: 1100000.0,
      stage1EngineCount: 9,
      thrustPerEngineSL_kN: 2200.0,
      Isp_sl: 305.0,
      Isp_vac: 330.0,
      rocketDiameterM: 5.2,
      burnTimeS: 140.0,
      timeStepS: 1.0,
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
    assert(
      [
        traj.maxDynamicPressureKPa,
        traj.maxQTimeS,
        traj.maxQAltitudeKm,
        traj.maxQVelocityM_s,
        traj.maxQMach,
        traj.cutoffAltitudeKm,
        traj.cutoffVelocityM_s
      ].every(Number.isFinite)
    );
    assert(traj.maxDynamicPressureKPa >= 0 && traj.trajectorySamples.length > 0);
    assert.strictEqual(traj.validationLevel, 'experimental');
    assert.strictEqual(traj.inputs.burnTimeS, 140.0);
  });

  // -----------------------------------------------------------------------------
  // [SUITE 6] Experimental idealized staging smoke check
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 6] Experimental idealized staging smoke check');

  runTest('Multi-stage calculation returns an experimental screening estimate', () => {
    const staging = aero.calculateStagingDeltaV({
      payloadMassKg: 25000.0,
      stage1DryMassKg: 30000.0,
      stage1PropellantMassKg: 920000.0,
      stage1IspVac: 330.0,
      stage2DryMassKg: 8500.0,
      stage2PropellantMassKg: 150000.0,
      stage2IspVac: 380.0,
      gravityLossesM_s: 1350.0,
      aerodynamicLossesM_s: 160.0,
      steeringLossesM_s: 210.0,
      requiredDeltaV_m_s: 7800.0,
      inputSourceDescription: 'Unvalidated smoke-test values; not launch vehicle or trajectory data'
    });

    assert(staging.stage1.idealDeltaV_m_s > 0);
    assert(staging.stage2.idealDeltaV_m_s > 0);
    assert(
      Math.abs(staging.totalIdealDeltaV_m_s - staging.stage1.idealDeltaV_m_s - staging.stage2.idealDeltaV_m_s) <= 1
    );
    assert(Number.isFinite(staging.netDeliveredDeltaV_m_s), 'Estimated net Delta-V should be finite');
    assert.strictEqual(staging.validationLevel, 'experimental');
    assert.strictEqual(staging.screeningStatus, 'EXPERIMENTAL_SCREENING_ONLY');
  });

  // -----------------------------------------------------------------------------
  // [SUITE 7] Experimental structural screening calculation
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 7] Experimental structural screening calculation');

  runTest('Isogrid legacy estimate is labeled experimental and not assessed', () => {
    const buckling = aero.calculateIsogridTankBuckling({
      tankRadiusM: 2.6,
      tankLengthM: 18.0,
      internalPressureBar: 3.5,
      axialCompressiveLoadKN: 6500.0,
      skinThicknessMm: 2.4,
      ribHeightMm: 16.0,
      ribWidthMm: 1.8,
      material: 'caller-described aluminum-lithium alloy',
      elasticModulusPa: 76.0e9,
      poissonRatio: 0.33,
      yieldStrengthPa: 550.0e6,
      safetyFactor: 1.4,
      minimumSkinThicknessMm: 1.8,
      bucklingKnockdownFactor: 0.65,
      pressureStabilizationCoefficient: 0.19,
      internalPressureAxialLoadReliefFactor: 0.75,
      inputSourceDescription: 'Unvalidated smoke-test material/model inputs; not allowables or an approved design basis'
    });

    assert.strictEqual(buckling.success, true);
    assert.strictEqual(buckling.validationLevel, 'experimental');
    assert.strictEqual(buckling.status, 'estimate-only');
    assert(Number.isFinite(buckling.skinThicknessMm) && buckling.skinThicknessMm > 0);
    assert(
      buckling.equivalentThicknessMm > buckling.skinThicknessMm,
      'Equivalent isogrid thickness t_bar must exceed skin thickness'
    );
    assert(
      buckling.criticalBucklingStressMPa > buckling.actualAxialStressMPa,
      'Critical buckling stress must exceed applied axial compressive stress'
    );
    assert(
      Number.isFinite(buckling.marginOfSafety),
      'The experimental estimate should expose its computed screening margin'
    );
    assert.strictEqual(buckling.structuralIntegrity, 'NOT ASSESSED');
  });

  // -----------------------------------------------------------------------------
  // [SUITE 8] Unsupported aerospace catalogs and required-input behavior
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 8] Aerospace source availability and required-input behavior');

  runTest('Unsourced subsystem registry remains empty', () => {
    assert.deepStrictEqual(aero.getNasaSubsystemEntities(), []);
  });

  runTest('Unsourced spacecraft specification fails closed', () => {
    const spec = aero.getNasaSpacecraftInteriorSpecification();
    assert.strictEqual(spec.success, false);
    assert.strictEqual(spec.validationLevel, 'experimental');
    assert.strictEqual(spec.error.code, 'UNSUPPORTED');
  });

  runTest('Staging estimate rejects missing engineering inputs instead of defaulting', () => {
    const result = aero.calculateStagingDeltaV({});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'INVALID_INPUT');
    assert(result.error.message.includes('payloadMassKg'));
  });

  runTest('Staging estimate remains an experimental screen without insertion confirmation', () => {
    const result = aero.calculateStagingDeltaV({
      payloadMassKg: 25000.0,
      stage1DryMassKg: 30000.0,
      stage1PropellantMassKg: 920000.0,
      stage1IspVac: 330.0,
      stage2DryMassKg: 8500.0,
      stage2PropellantMassKg: 150000.0,
      stage2IspVac: 380.0,
      gravityLossesM_s: 1350.0,
      aerodynamicLossesM_s: 160.0,
      steeringLossesM_s: 210.0,
      requiredDeltaV_m_s: 7800.0,
      inputSourceDescription: 'Unvalidated smoke-test values; not launch vehicle or trajectory data'
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.validationLevel, 'experimental');
    assert.strictEqual(result.screeningStatus, 'EXPERIMENTAL_SCREENING_ONLY');
    assert.strictEqual(result.orbitalInsertionStatus, undefined);
  });

  runTest('Combustion and engine calculations reject missing inputs', () => {
    assert.strictEqual(aero.evaluateCombustionEquilibrium().error.code, 'INVALID_INPUT');
    assert.strictEqual(aero.evaluateCombustionEquilibrium('not-a-propellant', 300, 3.6).error.code, 'INVALID_INPUT');
    assert.strictEqual(aero.calculateEnginePerformance({}).error.code, 'INVALID_INPUT');
    assert.strictEqual(aero.simulateAscentTrajectory({}).error.code, 'INVALID_INPUT');
  });

  runTest('Legacy calculation entry points remain available as explicit-input adapters', () => {
    const configured = new NasaRocketPropulsion({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 300.0,
      ofRatio: 3.6,
      throatDiameterM: 0.232
    });
    const thermo = configured.solveEquilibriumComposition(3.6, 300.0e5);
    const nozzle = configured.solveNozzleExpansion(35.0, 101325.0);
    assert.strictEqual(thermo.success, true);
    assert.strictEqual(nozzle.success, true);
    assert(Number.isFinite(nozzle.thrust_vac_kN));
    assert.strictEqual(aero.solveEquilibriumComposition().error.code, 'INVALID_INPUT');
    assert.strictEqual(aero.solveMultiStageTrajectory({}).error.code, 'INVALID_INPUT');
    assert.strictEqual(aero.solveIsogridBuckling({}).error.code, 'INVALID_INPUT');
  });

  runTest('Buckling estimate rejects missing design variables instead of defaulting', () => {
    const result = aero.calculateIsogridTankBuckling({});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'INVALID_INPUT');
    assert(result.error.message.includes('tankRadiusM'));
  });

  console.log('================================================================');
  console.log(`  SUMMARY: ${passedTests} / ${totalTests} experimental aerospace smoke checks passed`);
  console.log('================================================================');

  return { total: totalTests, passed: passedTests };
}

module.exports = { runNasaRocketPropulsionTests };

if (require.main === module) {
  const res = runNasaRocketPropulsionTests();
  if (res.passed !== res.total) {
    process.exit(1);
  }
}
