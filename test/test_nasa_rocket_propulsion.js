/**
 * Test Suite: NASA Space Launch Vehicle & Rocket Engine Physical Calculation Suite
 * ============================================================================
 * Conforms to:
 *  - NASA SP-125: Design of Liquid Propellant Rocket Engines
 *  - NASA CEA: Chemical Equilibrium with Applications
 *  - NASA SP-8007: Buckling of Thin-Walled Circular Cylinders
 *  - 1976 US Standard Atmosphere
 *  - NASA/SP-2016-6105 Rev 2: NASA Systems Engineering WBS 06.01 - 06.08
 * ============================================================================
 */

const assert = require('assert');
const { NasaRocketPropulsion } = require('../src/core/aerospace/nasa_rocket_propulsion');

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
  console.log('   RUNNING NASA SPACE LAUNCH VEHICLE & PROPULSION SUITE         ');
  console.log('================================================================');

  const aero = new NasaRocketPropulsion();

  // -----------------------------------------------------------------------------
  // [SUITE 1] NASA CEA Chemical Equilibrium Thermochemistry
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 1] NASA CEA Chemical Equilibrium Thermochemistry');

  runTest('LOX/LCH4 (Methalox) equilibrium matches NASA CEA baseline', () => {
    const result = aero.evaluateCombustionEquilibrium('LOX_LCH4', 300.0, 3.6);
    assert(result.chamberTemperatureK > 3500 && result.chamberTemperatureK < 3800, `Tc ${result.chamberTemperatureK} outside expected range`);
    assert(result.gamma >= 1.18 && result.gamma <= 1.25, `Gamma ${result.gamma} outside expected range`);
    assert(result.characteristicVelocityM_s > 1800 && result.characteristicVelocityM_s < 2050, `c* ${result.characteristicVelocityM_s} outside expected range`);
    assert(result.molecularWeightKgKmol > 18.0 && result.molecularWeightKgKmol < 24.0, `MolWeight ${result.molecularWeightKgKmol} outside expected range`);
  });

  runTest('LOX/LH2 (Hydrolox) exhibits high characteristic velocity c* (> 2200 m/s) and low mol weight', () => {
    const result = aero.evaluateCombustionEquilibrium('LOX_LH2', 200.0, 6.0);
    assert(result.characteristicVelocityM_s > 2200, `Hydrolox c* must exceed 2200 m/s, got ${result.characteristicVelocityM_s}`);
    assert(result.molecularWeightKgKmol < 17.0, `Hydrolox molecular weight must be low (< 17 kg/kmol), got ${result.molecularWeightKgKmol}`);
  });

  runTest('Off-design mixture ratio correctly penalizes flame temperature', () => {
    const opt = aero.evaluateCombustionEquilibrium('LOX_LCH4', 300.0, 3.6);
    const offDesign = aero.evaluateCombustionEquilibrium('LOX_LCH4', 300.0, 2.5);
    assert(offDesign.chamberTemperatureK < opt.chamberTemperatureK, 'Off-design O/F should decrease chamber temperature');
  });

  // -----------------------------------------------------------------------------
  // [SUITE 2] Isentropic Gas Dynamics & Nozzle Performance (NASA SP-125)
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 2] Isentropic Gas Dynamics & Nozzle Performance (NASA SP-125)');

  runTest('Area ratio inversion solves supersonic exit Mach number accurately', () => {
    const M_35 = aero.solveNozzleExitMach(35.0, 1.22);
    assert(M_35 > 3.5 && M_35 < 4.8, `Exit Mach ${M_35} for eps=35 should be ~4.0`);
    
    const M_150 = aero.solveNozzleExitMach(150.0, 1.22);
    assert(M_150 > M_35, `Vacuum expansion ratio eps=150 must have higher Mach than eps=35`);
  });

  runTest('Engine performance computes authentic Sea-Level & Vacuum thrust and Isp', () => {
    const perf = aero.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 300.0,
      ofRatio: 3.6,
      throatDiameterM: 0.232,
      expansionRatio: 35.0,
      ambientPressureBar: 1.01325
    });

    assert(perf.thrustSeaLevelKN > 1800.0 && perf.thrustSeaLevelKN < 2600.0, `SL Thrust ${perf.thrustSeaLevelKN} kN should match ~2,200 kN class engine`);
    assert(perf.thrustVacuumKN > perf.thrustSeaLevelKN, `Vacuum thrust must exceed sea-level thrust`);
    assert(perf.IspSeaLevelS > 295.0 && perf.IspSeaLevelS < 335.0, `SL Isp ${perf.IspSeaLevelS} s should be in ~305-325 s range`);
    assert(perf.IspVacuumS > perf.IspSeaLevelS, `Vacuum Isp must exceed Sea-Level Isp`);
    assert(perf.massFlowTotalKgS > 500.0 && perf.massFlowTotalKgS < 900.0, `Total mass flow ${perf.massFlowTotalKgS} kg/s within expected window`);
  });

  // -----------------------------------------------------------------------------
  // [SUITE 3] Bartz Convective Heat Transfer & Narloy-Z Cooling
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 3] Bartz Convective Heat Transfer & Narloy-Z Cooling');

  runTest('Bartz correlation computes extreme throat heat flux (40-90 MW/m^2)', () => {
    const perf = aero.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 300.0,
      throatDiameterM: 0.232,
      expansionRatio: 35.0
    });

    const cooling = aero.calculateBartzRegenerativeCooling(perf, {
      coolantChannelCount: 180,
      wallThicknessMm: 1.0,
      coolantInletTempK: 110.0
    });

    assert(cooling.heatFluxThroatMW_m2 > 35.0 && cooling.heatFluxThroatMW_m2 < 120.0, `Peak throat heat flux ${cooling.heatFluxThroatMW_m2} MW/m^2 in high-Pc rocket regime`);
    assert(cooling.gasSideWallTempK > cooling.coolantSideWallTempK, 'Gas-side wall must be hotter than coolant-side wall');
    assert(cooling.coolantTempRiseK > 20.0 && cooling.coolantTempRiseK < 200.0, `Coolant temperature rise ${cooling.coolantTempRiseK} K within realistic regenerative budget`);
    assert(cooling.coolantPressureDropBar > 10.0 && cooling.coolantPressureDropBar < 80.0, `Coolant pressure drop ${cooling.coolantPressureDropBar} bar realistic`);
  });

  // -----------------------------------------------------------------------------
  // [SUITE 4] Euler Turbomachinery & Power Balance
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 4] Euler Turbomachinery & Power Balance');

  runTest('Turbopump power balance computes multi-megawatt shaft power and non-cavitating NPSH', () => {
    const perf = aero.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 300.0,
      throatDiameterM: 0.232
    });
    const cooling = aero.calculateBartzRegenerativeCooling(perf);
    const turbo = aero.calculateTurbopumpSystem(perf, cooling);

    assert(turbo.totalPumpingPowerMW > 25.0 && turbo.totalPumpingPowerMW < 90.0, `Total pumping power ${turbo.totalPumpingPowerMW} MW within FFSC mega-engine scale`);
    assert(turbo.fuelTurbopumpRPM >= 30000 && turbo.fuelTurbopumpRPM <= 55000, `Fuel turbopump RPM ${turbo.fuelTurbopumpRPM} within high-speed turbomachinery envelope`);
    assert(turbo.fuelImpellerDiameterMm > 150.0 && turbo.fuelImpellerDiameterMm < 350.0, `Impeller diameter ${turbo.fuelImpellerDiameterMm} mm realistic`);
    assert(turbo.cavitationMarginOx >= 1.2, `Cavitation margin ${turbo.cavitationMarginOx} must exceed 1.2 safety threshold`);
    assert.strictEqual(turbo.cavitationStatus, 'SAFE (Non-Cavitating Inducer)');
  });

  // -----------------------------------------------------------------------------
  // [SUITE 5] 1976 US Standard Atmosphere & Max-Q Ascent Trajectory
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 5] 1976 US Standard Atmosphere & Max-Q Ascent Trajectory');

  runTest('1976 US Standard Atmosphere matches sea level, tropopause, and stratosphere baselines', () => {
    const sl = aero.get1976Atmosphere(0.0);
    assert(Math.abs(sl.pressurePa - 101325.0) < 1.0, `Sea level pressure error`);
    assert(Math.abs(sl.temperatureK - 288.15) < 0.1, `Sea level temperature error`);
    assert(Math.abs(sl.densityKgM3 - 1.225) < 0.01, `Sea level density error`);

    const tropo = aero.get1976Atmosphere(11000.0);
    assert(Math.abs(tropo.temperatureK - 216.65) < 0.5, `Tropopause temperature error`);
    assert(tropo.pressurePa < 25000.0 && tropo.pressurePa > 20000.0, `Tropopause pressure error`);

    const strato = aero.get1976Atmosphere(30000.0);
    assert(strato.densityKgM3 < 0.03, `Stratosphere density must be sparse`);
  });

  runTest('Ascent trajectory simulator captures realistic Max-Q peak (30-45 kPa at t ~ 60-80s)', () => {
    const traj = aero.simulateAscentTrajectory({
      liftOffMassKg: 1450000.0,
      stage1EngineCount: 9,
      thrustPerEngineSL_kN: 2200.0,
      rocketDiameterM: 5.2,
      burnTimeS: 160.0
    });

    assert(traj.maxDynamicPressureKPa > 25.0 && traj.maxDynamicPressureKPa < 55.0, `Max-Q ${traj.maxDynamicPressureKPa} kPa outside standard launch envelope (30-45 kPa)`);
    assert(traj.maxQTimeS >= 45 && traj.maxQTimeS <= 95, `Max-Q timestamp ${traj.maxQTimeS} s should be between 45-95s`);
    assert(traj.maxQMach > 0.9 && traj.maxQMach < 2.0, `Max-Q Mach ${traj.maxQMach} should be near transonic/supersonic boundary`);
    assert(traj.cutoffAltitudeKm > 50.0, `Stage 1 cutoff altitude ${traj.cutoffAltitudeKm} km should clear lower atmosphere`);
    assert(traj.trajectorySamples.length > 5, 'Should produce detailed trajectory telemetry samples');
  });

  // -----------------------------------------------------------------------------
  // [SUITE 6] Multi-Stage Tsiolkovsky Delta-V & Staging Dynamics
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 6] Multi-Stage Tsiolkovsky Delta-V & Staging Dynamics');

  runTest('Multi-stage Tsiolkovsky calculation confirms orbital insertion with realistic losses', () => {
    const staging = aero.calculateStagingDeltaV({
      payloadMassKg: 25000.0,
      stage1DryMassKg: 30000.0,
      stage1PropellantMassKg: 920000.0,
      stage1IspVac: 330.0,
      stage2DryMassKg: 8500.0,
      stage2PropellantMassKg: 150000.0,
      stage2IspVac: 380.0
    });

    assert(staging.stage1.idealDeltaV_m_s > 4000, `Stage 1 ideal Delta-V ${staging.stage1.idealDeltaV_m_s} m/s`);
    assert(staging.stage2.idealDeltaV_m_s > 4500, `Stage 2 ideal Delta-V ${staging.stage2.idealDeltaV_m_s} m/s`);
    assert(staging.totalIdealDeltaV_m_s > 9000, `Total ideal Delta-V ${staging.totalIdealDeltaV_m_s} m/s`);
    assert(staging.netDeliveredDeltaV_m_s >= 7800, `Net delivered Delta-V ${staging.netDeliveredDeltaV_m_s} m/s must clear 300km LEO velocity`);
    assert.strictEqual(staging.orbitalInsertionStatus, 'CONFIRMED ORBITAL INSERTION');
    assert(staging.orbitalMarginDeltaV_m_s > 0, 'Orbital margin must be positive');
  });

  // -----------------------------------------------------------------------------
  // [SUITE 7] NASA SP-8007 Triangular Isogrid Buckling
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 7] NASA SP-8007 Triangular Isogrid Buckling');

  runTest('Isogrid cryogenic tank wall thickness & buckling margin satisfy NASA safety factor', () => {
    const buckling = aero.calculateIsogridTankBuckling({
      tankRadiusM: 2.6,
      tankLengthM: 18.0,
      internalPressureBar: 3.5,
      axialCompressiveLoadKN: 6500.0,
      material: 'Al-Li 2195-T8'
    });

    assert(buckling.skinThicknessMm >= 1.5 && buckling.skinThicknessMm <= 4.0, `Skin thickness ${buckling.skinThicknessMm} mm`);
    assert(buckling.equivalentThicknessMm > buckling.skinThicknessMm, 'Equivalent isogrid thickness t_bar must exceed skin thickness');
    assert(buckling.criticalBucklingStressMPa > buckling.actualAxialStressMPa, 'Critical buckling stress must exceed applied axial compressive stress');
    assert(buckling.marginOfSafety > 0.0, `Margin of safety ${buckling.marginOfSafety} must be positive for flight qualification`);
    assert.strictEqual(buckling.structuralIntegrity, 'COMPLIANT (NASA SP-8007 Margin Positive)');
  });

  // -----------------------------------------------------------------------------
  // [SUITE 8] NASA Systems Engineering WBS 06.01 - 06.08 Entity Registry
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 8] NASA Systems Engineering WBS 06.01 - 06.08 Entity Registry');

  runTest('WBS entity registry contains all 8 required NASA system entities with lead centers', () => {
    const entities = aero.getNasaSubsystemEntities();
    assert.strictEqual(entities.length, 8, 'Must have exactly 8 primary WBS flight entities (06.01 - 06.08)');

    const expectedWbs = ['06.01', '06.02', '06.03', '06.04', '06.05', '06.06', '06.07', '06.08'];
    expectedWbs.forEach((id, idx) => {
      assert.strictEqual(entities[idx].wbsId, id, `WBS ID mismatch at index ${idx}`);
      assert(entities[idx].entityName.length > 5, `Missing entityName for WBS ${id}`);
      assert(entities[idx].leadCenter.includes('NASA') || entities[idx].leadCenter.includes('USSF'), `Invalid lead center for WBS ${id}`);
      assert(entities[idx].subsystems.length >= 3, `WBS ${id} must contain at least 3 detailed subsystems`);
      assert(entities[idx].specStandards.length >= 1, `WBS ${id} must reference official standards`);
      assert(entities[idx].criticalTelemetry.length > 5, `WBS ${id} must specify critical telemetry readouts`);
    });
  });

  // -----------------------------------------------------------------------------
  // [SUITE 9] NASA Spaceship Full Interior Specification & Human Systems Integration (NASA-STD-3001)
  // -----------------------------------------------------------------------------
  console.log('\n[SUITE 9] NASA Spaceship Full Interior Specification & Human Systems Integration (NASA-STD-3001)');

  runTest('Spacecraft interior specification complies with NASA-STD-3001 volume and crew envelope', () => {
    const spec = aero.getNasaSpacecraftInteriorSpecification();
    assert(spec, 'Specification must not be null');
    assert(spec.standardsCompliance.some(s => s.includes('NASA-STD-3001')), 'Must comply with NASA-STD-3001');
    assert.strictEqual(spec.crewCapacity.nominal, 4);
    assert(spec.physicalEnvelope.habitableLivingVolumeM3 >= 9.0, 'Habitable living volume must be >= 9.0 m3');
    assert(spec.physicalEnvelope.grossPressurizedVolumeM3 > spec.physicalEnvelope.habitableLivingVolumeM3, 'Pressurized volume must exceed habitable volume');
  });

  runTest('ECLSS air and water closed-loop recycling meets deep space duration benchmarks', () => {
    const spec = aero.getNasaSpacecraftInteriorSpecification();
    const eclss = spec.internalArchitecture.lifeSupportECLSS;
    assert(eclss, 'ECLSS must be defined');
    assert(eclss.atmosphereRevitalizationARS.cabinPco2TargetMmHg <= 2.0, 'pCO2 target must be <= 2.0 mmHg per NASA-STD-3001');
    assert(eclss.waterRecoveryWRM.recoveryEfficiencyPct >= 98.0, 'Water loop recovery must reach >= 98%');
    assert(eclss.atmosphereRevitalizationARS.co2Scrubber.includes('Amine'), 'Must use regenerable amine scrubber');
    assert(eclss.waterRecoveryWRM.urineProcessing.includes('VCD') || eclss.waterRecoveryWRM.urineProcessing.includes('Distillation'), 'Must include vacuum distillation');
  });

  runTest('Habitation systems, radiation storm shelter, and UWMS meet crew hygiene and safety', () => {
    const spec = aero.getNasaSpacecraftInteriorSpecification();
    const hab = spec.internalArchitecture.habitationDeck;
    assert(hab, 'Habitation deck must be defined');
    assert.strictEqual(hab.sleepBerths.count, 4);
    assert(hab.sleepBerths.soundAttenuationDba <= 48.0, 'Sleep berth noise limit must be <= 48 dBA');
    assert(hab.wasteManagementUWMS.model.includes('UWMS'), 'Must specify UWMS');
    assert(hab.radiationStormShelter.attenuationRatioPct >= 75.0, 'SPE proton attenuation must be >= 75%');
    assert(hab.exerciseCountermeasures.attenuationRatio.includes('98%') || hab.exerciseCountermeasures.equipment.includes('ARED'), 'ARED vibration isolation must be specified');
  });

  runTest('Flight deck cockpit couches and glass avionics meet 15g crash and triple redundancy', () => {
    const spec = aero.getNasaSpacecraftInteriorSpecification();
    const deck = spec.internalArchitecture.flightDeck;
    assert.strictEqual(deck.crewCouches.count, 4);
    assert(deck.crewCouches.features.some(f => f.includes('15g')), 'Couches must feature 15g crash impact rating');
    assert.strictEqual(deck.glassCockpitDisplays.count, 3);
    assert.strictEqual(spec.internalArchitecture.avionicsAndGNC.flightControlComputers.architecture, 'Triple Modular Redundancy (TMR) Fault-Tolerant Voting Architecture');
  });

  runTest('Service module propulsion and power budget deliver required deep space delta-V', () => {
    const spec = aero.getNasaSpacecraftInteriorSpecification();
    assert(spec.deltaVBudgetMps.totalMissionDeltaV >= 1400.0, 'Total delta-V must be >= 1400 m/s for translunar/deep space operations');
    assert(spec.powerBudgetWatts.solarArrayGeneration1AU >= 11000.0, 'Solar generation must be >= 11 kW');
    assert.strictEqual(spec.internalArchitecture.serviceModuleAftPropulsion.mainEngine.vacuumThrustKn, 26.7);
    assert(spec.internalArchitecture.forwardDockingAndAirlock.dockingSystem.includes('NDS Block 2'), 'Must specify NDS Block 2 docking');
  });

  runTest('Fire detection, suppression (FDS), and emergency breathing apparatus comply with crew safety', () => {
    const spec = aero.getNasaSpacecraftInteriorSpecification();
    const fds = spec.internalArchitecture.fireDetectionAndSuppression;
    assert(fds, 'FDS must be defined');
    assert(fds.portableExtinguishers.includes('Fine Water Mist'), 'Must feature non-toxic water mist extinguishers');
    assert.strictEqual(fds.emergencyBreathingApparatus.count, 4, 'Must provide 4 EBA masks');
    assert(fds.emergencyBreathingApparatus.oxygenSupplyMinutes >= 15, 'EBA must deliver >= 15 minutes of O2');
  });

  runTest('Entry, descent and landing (EDL), parachutes, and CMUS uprighting are fully specified', () => {
    const spec = aero.getNasaSpacecraftInteriorSpecification();
    const edl = spec.internalArchitecture.entryDescentAndLandingEDL;
    assert(edl, 'EDL must be defined');
    assert(edl.heatShield.material.includes('PICA-X'), 'Must feature PICA-X heat shield');
    assert.strictEqual(edl.marineUprightingCMUS.spheresCount, 5, 'CMUS must feature 5 inflatable spheres');
    assert(edl.marineUprightingCMUS.stabilitySeaState.includes('Sea State 5'), 'CMUS must stabilize in Sea State 5');
    assert(edl.parachuteSystem.mainChutes.includes('35.4m'), 'Must specify 3x 35.4m ringsail parachutes');
  });

  runTest('Circadian lighting, acoustic quieting, and search-and-rescue (SAR) meet mission standards', () => {
    const spec = aero.getNasaSpacecraftInteriorSpecification();
    const arch = spec.internalArchitecture;
    assert(arch.cabinLightingAndCircadian.circadianRegulation.highVigilanceWork.includes('6500 K'), 'High vigilance lighting must be 6500K');
    assert(arch.acousticQuietingAndAttenuation.standardCompliance.includes('NC-40'), 'Sleep berths must meet NC-40');
    assert(arch.searchAndRescueSAR.satelliteBeacon.includes('COSPAS-SARSAT'), 'Must include COSPAS-SARSAT beacon');
    assert.strictEqual(arch.searchAndRescueSAR.marineLifeRafts.includes('4-Person'), true, 'Must include 4-person life rafts');
  });

  runTest('Parametric FeatureTree creates 13-feature spacecraft interior CAD history tree', () => {
    const { FeatureTree } = require('../src/core/cad/feature_tree');
    const tree = FeatureTree.createSpacecraftInteriorTree();
    assert(tree, 'FeatureTree must be instantiated');
    assert.strictEqual(tree.features.length, 13, 'Interior tree must contain 13 primary CAD features');
    assert(tree.features.some(f => f.name.includes('PressureHull')), 'Must include PressureHull');
    assert(tree.features.some(f => f.name.includes('UWMS')), 'Must include UWMS');
    assert(tree.features.some(f => f.name.includes('Cockpit')), 'Must include Cockpit');
    assert(tree.features.some(f => f.name.includes('Shelter')), 'Must include Radiation Shelter');
  });

  console.log('================================================================');
  console.log(`  SUMMARY: ${passedTests} / ${totalTests} NASA PROPULSION TESTS PASSED`);
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
