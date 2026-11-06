/**
 * test_periodic_table_118.js
 * Verification of the complete 118-element periodic table engine.
 */

const assert = require('assert');
const { getPeriodicTable } = require('../src/core/materials/periodic_table_engine');

console.log('[TEST] Running 118-Element Periodic Table Verification...');

const pt = getPeriodicTable();

// 1. Element Count check
const all = pt.getAllElements();
assert.strictEqual(all.length, 118, `Expected exactly 118 elements, got ${all.length}`);
console.log(`  ✓ PASS: Total elements registered: ${all.length}/118`);

// 2. Specific key elements check
const H = pt.getElementByZ(1);
assert.strictEqual(H.symbol, 'H');
assert.strictEqual(H.name, 'Hydrogen');
assert.strictEqual(H.atomic_weight_u, 1.008);

const Fe = pt.getElementBySymbol('Fe');
assert.strictEqual(Fe.atomic_number, 26);
assert.strictEqual(Fe.name, 'Iron');
assert.strictEqual(Fe.density_kg_m3, 7874);

const U = pt.getElementBySymbol('U');
assert.strictEqual(U.atomic_number, 92);
assert.strictEqual(U.name, 'Uranium');
assert.strictEqual(U.category, 'actinide');

const Og = pt.getElementByZ(118);
assert.strictEqual(Og.symbol, 'Og');
assert.strictEqual(Og.name, 'Oganesson');
assert.strictEqual(Og.group, 18);
assert.strictEqual(Og.period, 7);
console.log('  ✓ PASS: Key element properties (H, Fe, U, Og) verified');

// 3. Groups, Periods, Blocks check
const nobleGases = pt.getElementsInGroup(18);
assert.strictEqual(nobleGases.length, 7, 'Expected 7 noble gases (He, Ne, Ar, Kr, Xe, Rn, Og)');

const period1 = pt.getElementsInPeriod(1);
assert.strictEqual(period1.length, 2, 'Period 1 must have exactly 2 elements (H, He)');

const dBlock = pt.getElementsInBlock('d');
assert.ok(dBlock.length >= 30, 'd-block transition metals count verified');
console.log('  ✓ PASS: Group 18, Period 1, and d-block queries verified');

// 4. Physical / Thermodynamic property computation
const copperAlpha = pt.getThermalDiffusivity('Cu');
assert.ok(copperAlpha > 1e-4 && copperAlpha < 2e-4, `Copper thermal diffusivity expected ~1.16e-4 m^2/s, got ${copperAlpha}`);
console.log(`  ✓ PASS: Copper thermal diffusivity alpha = ${copperAlpha.toExponential(4)} m^2/s verified`);

// 5. Search capability
const titaniumResults = pt.search('Titanium');
assert.ok(titaniumResults.some(e => e.symbol === 'Ti'));
console.log('  ✓ PASS: Search functionality verified');

console.log('[TEST] 118-Element Periodic Table: ALL CHECKS PASSED CLEANLY.\n');
