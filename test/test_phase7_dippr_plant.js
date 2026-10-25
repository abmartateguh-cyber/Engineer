/**
 * OmniEng Phase 7 experimental plant calculation suite.
 */

'use strict';

const assert = require('assert');
const { ExperimentalPropertyDatabase, EXPERIMENTAL_SPECIES_DATA } = require('../src/core/plant/dippr_database');
const { EXPERIMENTAL_PROPERTY_EXAMPLES } = require('./support/experimental_property_examples');
const { ElectrolyteNRTLModel } = require('../src/core/plant/enrtl_electrolyte_thermo');
const { NaphtaliSandholmColumnSolver, WaterHammerMOC } = require('../src/core/plant/naphtali_sandholm_mesh');

console.log('================================================================');
console.log('   RUNNING PHASE 7: EXPERIMENTAL PLANT CALCULATION EXAMPLES ');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Legacy property examples are clearly marked and remain experimental.
// -----------------------------------------------------------------------------
console.log('[P7-1] Test-only unverified property examples...');
const emptyProductionProperties = new ExperimentalPropertyDatabase();
assert.strictEqual(
  emptyProductionProperties.listSpecies().length,
  0,
  'Production property database starts without bundled records'
);
assert.strictEqual(EXPERIMENTAL_SPECIES_DATA.length, 0, 'Legacy production data export remains present but empty');
assert.throws(() => new ExperimentalPropertyDatabase({}), /array/);
const properties = new ExperimentalPropertyDatabase(EXPERIMENTAL_PROPERTY_EXAMPLES);
const totalSpecies = properties.listSpecies().length;
const catalogMetadata = properties.getCatalogMetadata();
assert.strictEqual(totalSpecies, 21, `Expected only the 21 test-only examples (found ${totalSpecies})`);
assert.strictEqual(catalogMetadata.status, 'experimental');
assert.strictEqual(catalogMetadata.source, null);
assert.strictEqual(catalogMetadata.licenseStatus, 'unverified');
assert(properties.listSpecies().every((id) => properties.get(id).dataStatus === 'experimental-estimated'));
assert.strictEqual(properties.get('n-C20'), null, 'Generated homolog entries must not be exposed');
const water = properties.get('Water');
assert.throws(
  () => water.getLiquidViscosity(298.15),
  (error) => error.code === 'UNAVAILABLE'
);
assert.throws(
  () => water.getLiquidThermalConductivity(298.15),
  (error) => error.code === 'UNAVAILABLE'
);
assert.throws(() => water.getVaporPressure(700), /outside the supplied correlation range/i);
assert.throws(
  () =>
    properties.solveVLLEFlash({
      components: ['Water', 'n-Hexane'],
      feedFractions: [0.8, 0.8],
      temperatureK: 340.0,
      pressurePa: 1.01325e5
    }),
  /feedFractions must be finite, nonnegative, and sum to 1/i
);

// Test Water
assert(water, 'Water must exist in the experimental example set');
const pVapWater373 = water.getVaporPressure(373.15); // At 100°C (373.15 K), P_vap ~ 101,325 Pa (1 atm)
assert(
  Math.abs(pVapWater373 - 101325) < 3000,
  `Water P_vap at 100C must be ~ 101,325 Pa (got ${pVapWater373.toFixed(0)})`
);

const rhoWater298 = water.getLiquidDensity(298.15); // Liquid density at 25°C ~ 997 kg/m^3
assert(
  Math.abs(rhoWater298 - 997.0) < 15.0,
  `Water density at 25C must be ~ 997 kg/m^3 (got ${rhoWater298.toFixed(1)})`
);

// Test Methane
const methane = properties.get('Methane');
assert(methane && methane.Tc > 180 && methane.Tc < 200, 'Methane Tc ~ 190.56 K');

// Test Higher Chain Homolog from family
console.log(
  `  ✓ [P7-1] ${totalSpecies} unverified examples marked experimental; Water example P_vap(100°C) = ${(pVapWater373 / 1e3).toFixed(1)} kPa, rho(25°C) = ${rhoWater298.toFixed(1)} kg/m³`
);

// -----------------------------------------------------------------------------
// Test 2: Electrolyte NRTL (eNRTL) Acid Gas CO2 Capture
// -----------------------------------------------------------------------------
console.log('\n[P7-2] Electrolyte NRTL (eNRTL) Ionic Thermodynamics & CO2 Capture...');
const enrtl = new ElectrolyteNRTLModel({ temperatureK: 313.15, meaMassFraction: 0.3 });

// Speciation at alpha = 0.35 mol CO2 / mol MEA
const spec = enrtl.calculateSpeciation(0.35);
assert(spec.meahPlusFraction > 0.3, 'MEAH+ protonated amine should be present');
assert(spec.meacooMinusFraction > 0.3, 'MEACOO- carbamate should dominate at low loading');
assert(spec.ionicStrength > 0.3, 'Ionic strength must be positive in electrolyte solution');

// VLE partial pressure
const vle = enrtl.calculateCO2VLE(0.35);
assert(
  vle.pCO2_kPa > 0.1 && vle.pCO2_kPa < 5.0,
  `CO2 partial pressure at alpha=0.35 should be ~ 0.5-1.5 kPa (got ${vle.pCO2_kPa.toFixed(3)})`
);

// Absorber capture capacity
const capture = enrtl.evaluateCaptureCapacity(0.48, 0.2, 100000.0);
assert(capture.co2CapturedTonsPerDay > 30.0, 'Capture capacity should be > 30 tons/day for 100 t/h solvent');

console.log(
  `  ✓ [P7-2] eNRTL: P_CO2 = ${vle.pCO2_kPa.toFixed(3)} kPa @ alpha=0.35, CO2 Capture = ${capture.co2CapturedTonsPerDay.toFixed(1)} tons/day`
);

// -----------------------------------------------------------------------------
// Test 3: Legacy distillation route fails closed
// -----------------------------------------------------------------------------
console.log('\n[P7-3] Legacy distillation model availability...');
const columnResult = NaphtaliSandholmColumnSolver.solve({ stages: 15 });
assert.strictEqual(columnResult.status, 'unavailable');
assert.strictEqual(columnResult.error.code, 'UNSUPPORTED');

// -----------------------------------------------------------------------------
// Test 4: Experimental Method of Characteristics (MOC) Water Hammer Example
// -----------------------------------------------------------------------------
console.log('\n[P7-4] Legacy dynamic water-hammer model availability...');
const hammerResult = WaterHammerMOC.solve({});
assert.strictEqual(hammerResult.status, 'unavailable');
assert.strictEqual(hammerResult.error.code, 'UNSUPPORTED');

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

console.log('  ✓ [P7-5] All 5 Phase 7 Plant IPC Channels Registered');

console.log('\n================================================================');
console.log('   ALL 5 PHASE 7 TESTS PASSED SUCCESSFULLY!                    ');
console.log('================================================================\n');
