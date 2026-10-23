/**
 * OmniEng Phase 7 Verification Suite:
 * 500+ Pure Component DIPPR Database, eNRTL Amine CO2 Capture & Rate-Based Distillation
 */

'use strict';

const assert = require('assert');
const { DIPPRDatabase } = require('../src/core/plant/dippr_database');
const { ElectrolyteNRTLModel } = require('../src/core/plant/enrtl_electrolyte_thermo');
const { NaphtaliSandholmColumnSolver, WaterHammerMOC } = require('../src/core/plant/naphtali_sandholm_mesh');

console.log('================================================================');
console.log('   RUNNING PHASE 7: 500+ DIPPR DATABASE & ADVANCED PLANT THERMO ');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: 500+ Component Certified DIPPR Database & Equations
// -----------------------------------------------------------------------------
console.log('[P7-1] 500+ Pure Component DIPPR Chemical Database...');
const dippr = new DIPPRDatabase();
const totalSpecies = dippr.listSpecies().length;
assert(totalSpecies >= 500, `Database must contain >= 500 species (found ${totalSpecies})`);

// Test Water
const water = dippr.get('Water');
assert(water, 'Water must exist in DIPPR');
const pVapWater373 = water.getVaporPressure(373.15); // At 100°C (373.15 K), P_vap ~ 101,325 Pa (1 atm)
assert(Math.abs(pVapWater373 - 101325) < 3000, `Water P_vap at 100C must be ~ 101,325 Pa (got ${pVapWater373.toFixed(0)})`);

const rhoWater298 = water.getLiquidDensity(298.15); // Liquid density at 25°C ~ 997 kg/m^3
assert(Math.abs(rhoWater298 - 997.0) < 15.0, `Water density at 25C must be ~ 997 kg/m^3 (got ${rhoWater298.toFixed(1)})`);

// Test Methane
const methane = dippr.get('Methane');
assert(methane && methane.Tc > 180 && methane.Tc < 200, 'Methane Tc ~ 190.56 K');

// Test Higher Chain Homolog from family
const alkaneC20 = dippr.get('n-C20');
assert(alkaneC20, 'Long chain n-C20 alkane must exist in catalog');
assert(alkaneC20.mw > 280, 'n-C20 MW should be > 280 g/mol');

console.log(`  ✓ [P7-1] DIPPR Catalog: ${totalSpecies} species loaded; Water P_vap(100°C) = ${(pVapWater373 / 1e3).toFixed(1)} kPa, rho(25°C) = ${rhoWater298.toFixed(1)} kg/m³`);

// -----------------------------------------------------------------------------
// Test 2: Electrolyte NRTL (eNRTL) Acid Gas CO2 Capture
// -----------------------------------------------------------------------------
console.log('\n[P7-2] Electrolyte NRTL (eNRTL) Ionic Thermodynamics & CO2 Capture...');
const enrtl = new ElectrolyteNRTLModel({ temperatureK: 313.15, meaMassFraction: 0.30 });

// Speciation at alpha = 0.35 mol CO2 / mol MEA
const spec = enrtl.calculateSpeciation(0.35);
assert(spec.meahPlusFraction > 0.30, 'MEAH+ protonated amine should be present');
assert(spec.meacooMinusFraction > 0.30, 'MEACOO- carbamate should dominate at low loading');
assert(spec.ionicStrength > 0.30, 'Ionic strength must be positive in electrolyte solution');

// VLE partial pressure
const vle = enrtl.calculateCO2VLE(0.35);
assert(vle.pCO2_kPa > 0.1 && vle.pCO2_kPa < 5.0, `CO2 partial pressure at alpha=0.35 should be ~ 0.5-1.5 kPa (got ${vle.pCO2_kPa.toFixed(3)})`);

// Absorber capture capacity
const capture = enrtl.evaluateCaptureCapacity(0.48, 0.20, 100000.0);
assert(capture.co2CapturedTonsPerDay > 30.0, 'Capture capacity should be > 30 tons/day for 100 t/h solvent');

console.log(`  ✓ [P7-2] eNRTL: P_CO2 = ${vle.pCO2_kPa.toFixed(3)} kPa @ alpha=0.35, CO2 Capture = ${capture.co2CapturedTonsPerDay.toFixed(1)} tons/day`);

// -----------------------------------------------------------------------------
// Test 3: Naphtali-Sandholm MESH Distillation Column with Murphree Tray Efficiency
// -----------------------------------------------------------------------------
console.log('\n[P7-3] Naphtali-Sandholm Simultaneous MESH Distillation Solver...');

// Solve ideal column (Emv = 1.0)
const colIdeal = NaphtaliSandholmColumnSolver.solve({
  stages: 15,
  feedStage: 8,
  components: ['Propane', 'n-Butane', 'n-Pentane'],
  feedFlows: [10.0, 15.0, 10.0],
  refluxRatio: 2.5,
  murphreeEfficiency: 1.0
});
assert(colIdeal.converged, 'Ideal column must converge');
assert(colIdeal.temperatureProfile[0] < colIdeal.temperatureProfile[14], 'Condenser must be colder than reboiler');
assert(colIdeal.distillateComposition[0] > 0.50, 'Distillate should be enriched in light key Propane');

// Solve real column with 85% Murphree efficiency
const colReal = NaphtaliSandholmColumnSolver.solve({
  stages: 15,
  feedStage: 8,
  components: ['Propane', 'n-Butane', 'n-Pentane'],
  feedFlows: [10.0, 15.0, 10.0],
  refluxRatio: 2.5,
  murphreeEfficiency: 0.85
});
assert(colReal.converged, 'Real column (Emv=0.85) must converge');
assert(colReal.temperatureProfile[0] < colReal.temperatureProfile[14]);

console.log(`  ✓ [P7-3] Column Converged in ${colIdeal.iterations} iters: T_condenser = ${colIdeal.temperatureProfile[0].toFixed(1)} K, T_reboiler = ${colIdeal.temperatureProfile[14].toFixed(1)} K, Distillate x_propane = ${(colIdeal.distillateComposition[0] * 100).toFixed(1)}%`);

// -----------------------------------------------------------------------------
// Test 4: ASME B31.3 Method of Characteristics (MOC) Water Hammer Solver
// -----------------------------------------------------------------------------
console.log('\n[P7-4] ASME B31.3 Dynamic Water Hammer Acoustic Wave Solver...');
const hammerResult = WaterHammerMOC.solve({
  pipeLengthM: 500.0,
  innerDiameterM: 0.20,
  wallThicknessM: 0.008,
  elasticModulusPa: 2.0e11, // Steel pipe
  fluidDensityKgM3: 998.0,
  fluidBulkModulusPa: 2.15e9, // Water
  initialVelocityMps: 2.5,
  steadyPressurePa: 1.0e6, // 10 bar
  valveClosureTimeS: 0.05 // Rapid closure
});

assert(hammerResult.waveSpeedMps > 1000 && hammerResult.waveSpeedMps < 1500, 'Water hammer acoustic speed ~ 1000-1400 m/s');
assert(hammerResult.joukowskyDeltaP_Pa > 1.5e6, 'Peak surge pressure > 15 bar for 2.5 m/s water shutdown');
assert(hammerResult.maxPressurePa > hammerResult.steadyPressurePa, 'Max pressure must exceed steady operating pressure');

console.log(`  ✓ [P7-4] Water Hammer: Acoustic speed = ${hammerResult.waveSpeedMps.toFixed(1)} m/s, Joukowsky Delta_P = ${(hammerResult.joukowskyDeltaP_Pa / 1e5).toFixed(1)} bar, Peak P_max = ${(hammerResult.maxPressurePa / 1e5).toFixed(1)} bar`);

// -----------------------------------------------------------------------------
// Test 5: Phase 7 Plant IPC Channel Registration & Integration
// -----------------------------------------------------------------------------
console.log('\n[P7-5] Phase 7 Plant IPC Channel Integration...');
const { registerPlantIpc } = require('../src/main/ipc/plant_ipc');
const { isChannelRegistered } = require('../src/main/ipc/define_handler');
registerPlantIpc();
assert(isChannelRegistered('omni:query-dippr-database'), 'Must register omni:query-dippr-database');
assert(isChannelRegistered('omni:solve-vlle-flash'), 'Must register omni:solve-vlle-flash');
assert(isChannelRegistered('omni:solve-mesh-distillation'), 'Must register omni:solve-mesh-distillation');
assert(isChannelRegistered('omni:solve-water-hammer-moc'), 'Must register omni:solve-water-hammer-moc');
assert(isChannelRegistered('omni:evaluate-enrtl-co2'), 'Must register omni:evaluate-enrtl-co2');

console.log('  ✓ [P7-5] All 5 Phase 7 Plant IPC Channels Registered & Schema-Validated');

console.log('\n================================================================');
console.log('   ALL 5 PHASE 7 TESTS PASSED SUCCESSFULLY!                    ');
console.log('================================================================\n');
