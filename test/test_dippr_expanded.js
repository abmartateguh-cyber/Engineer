/**
 * test_dippr_expanded.js
 * Verification of the DIPPR Expanded Chemical Catalog and Equations 101-107.
 */

const assert = require('assert');
const { getDipprCatalog } = require('../src/core/plant/dippr_expanded_catalog');

console.log('[TEST] Running DIPPR Expanded Catalog Verification...');

const catalog = getDipprCatalog();

// 1. Verify species registry
assert.ok(catalog.count >= 60, `Expected at least 60 species, got ${catalog.count}`);
console.log(`  ✓ PASS: Catalog loaded with ${catalog.count} petrochemical species`);

// 2. Water verification at 373.15 K (100 °C)
const water = catalog.getSpecies('water');
assert.ok(water, 'Water species record missing');

// Vapor pressure of water at 373.15 K should be ~101325 Pa (1 atm)
const pvapWater = catalog.evalVaporPressure('water', 373.15);
assert.ok(Math.abs(pvapWater - 101325) / 101325 < 0.05, `Water Pvap at 373.15K expected ~101.3 kPa, got ${(pvapWater/1000).toFixed(2)} kPa`);
console.log(`  ✓ PASS: Water vapor pressure at 373.15 K = ${(pvapWater / 1000).toFixed(2)} kPa (DIPPR EQ 101)`);

// Liquid density of water at 298.15 K (25 °C) should be ~997 kg/m^3
const rhoWater = catalog.evalLiquidDensity('water', 298.15);
assert.ok(Math.abs(rhoWater - 997) < 50, `Water density at 298.15K expected ~997 kg/m^3, got ${rhoWater.toFixed(1)} kg/m^3`);
console.log(`  ✓ PASS: Water liquid density at 298.15 K = ${rhoWater.toFixed(1)} kg/m^3 (DIPPR EQ 105 / Rackett)`);

// Ideal gas Cp of water at 300 K should be ~33-35 J/(mol K)
const cpWater = catalog.evalIdealGasCp('water', 300);
assert.ok(cpWater > 30 && cpWater < 40, `Water Cp0 expected ~33-35 J/(mol K), got ${cpWater.toFixed(2)}`);
console.log(`  ✓ PASS: Water ideal gas Cp at 300 K = ${cpWater.toFixed(2)} J/(mol K) (DIPPR EQ 107)`);

// Liquid viscosity of water at 293.15 K (20 °C) should be ~0.001 Pa s (1 cP)
const muWater = catalog.evalLiquidViscosity('water', 293.15);
assert.ok(muWater > 0.0005 && muWater < 0.002, `Water viscosity expected ~0.001 Pa s, got ${muWater.toExponential(3)}`);
console.log(`  ✓ PASS: Water liquid viscosity at 293.15 K = ${muWater.toExponential(3)} Pa s (DIPPR EQ 102)`);

// Heat of vaporization of water at 373.15 K should be ~40.6 kJ/mol (40660 J/mol)
const dhvapWater = catalog.evalHeatOfVaporization('water', 373.15);
assert.ok(dhvapWater > 35000 && dhvapWater < 45000, `Water Delta Hvap expected ~40.6 kJ/mol, got ${(dhvapWater/1000).toFixed(2)} kJ/mol`);
console.log(`  ✓ PASS: Water heat of vaporization at 373.15 K = ${(dhvapWater / 1000).toFixed(2)} kJ/mol (DIPPR EQ 106)`);

// 3. Hydrocarbon check: Methane and Benzene
const methane = catalog.getSpecies('methane');
assert.ok(methane);
assert.strictEqual(methane.formula, 'CH4');

const benzene = catalog.getSpecies('benzene');
assert.ok(benzene);
const pvapBenzene = catalog.evalVaporPressure('benzene', 353.25); // normal boiling point ~80.1 °C
assert.ok(Math.abs(pvapBenzene - 101325) / 101325 < 0.08, `Benzene Pvap at Tb expected ~101.3 kPa, got ${(pvapBenzene/1000).toFixed(2)} kPa`);
console.log(`  ✓ PASS: Benzene vapor pressure at normal boiling point (353.25 K) = ${(pvapBenzene / 1000).toFixed(2)} kPa`);

// 4. Search capability check
const results = catalog.search('ethanol');
assert.ok(results.length >= 1, 'Ethanol search failed');
console.log(`  ✓ PASS: Search functionality verified (${results.length} matches for 'ethanol')`);

console.log('[TEST] DIPPR Expanded Chemical Catalog: ALL CHECKS PASSED CLEANLY.\n');
