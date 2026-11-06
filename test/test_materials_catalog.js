/**
 * Materials catalog contract tests (deterministic, CommonJS).
 *
 * Verifies:
 *  1. The catalog is populated (>= 8 cards) and every card carries explicit
 *     provenance (source URL + retrievedAt), SI units, finite numeric
 *     properties, and validationStatus 'documented-typical'.
 *  2. Temperature-dependent property interpolation is monotonic over the
 *     documented ladders (E/Sy/Su non-increasing, alpha non-decreasing).
 *  3. A production consumer (FEASolver) resolves materialId 'AL-7075-T6'
 *     from the catalog and solves a small elasticity case with finite results.
 *  4. The explicit-property fallback still works unchanged.
 */

'use strict';

const assert = require('assert');

const {
  MATERIAL_DATABASE,
  MaterialManager,
  interpolateProperty,
  REFERENCE_TEMPERATURE_K
} = require('../src/core/materials/material_database');
const { FEASolver } = require('../src/core/cae/fea_structural');

function assertFinitePositive(value, label) {
  assert(Number.isFinite(value) && value > 0, `${label} must be a finite positive number, got ${value}`);
}

function runMaterialCatalogTests() {
  console.log('\n================================================================');
  console.log('   MATERIALS CATALOG CONTRACT TESTS ');
  console.log('================================================================\n');

  const ids = Object.keys(MATERIAL_DATABASE);
  assert(ids.length >= 8, `catalog must hold at least 8 cards, got ${ids.length}`);
  assert.strictEqual(
    ids.length,
    MaterialManager.listAllMaterials().length,
    'listAllMaterials must mirror catalog keys'
  );
  assert.deepStrictEqual(
    [...ids].sort(),
    [...MaterialManager.listAllMaterials()].sort(),
    'listAllMaterials must return exactly the catalog ids'
  );

  for (const id of ids) {
    const card = MATERIAL_DATABASE[id];
    assert(card, `card ${id} must exist`);
    assert.strictEqual(card.id, id, 'card.id must equal its key');
    assert(typeof card.name === 'string' && card.name.length > 0, `${id}: name must be a nonempty string`);
    assert(typeof card.class === 'string' && card.class.length > 0, `${id}: class must be a nonempty string`);
    assert(card.source && typeof card.source === 'object', `${id}: source object required`);
    assert(
      typeof card.source.reference === 'string' && card.source.reference.length > 0,
      `${id}: source.reference required`
    );
    assert(/^https?:\/\//.test(card.source.url), `${id}: source.url must be http(s)`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(card.source.retrievedAt), `${id}: source.retrievedAt must be YYYY-MM-DD`);
    assert.strictEqual(
      card.validationStatus,
      'documented-typical',
      `${id}: validationStatus must be 'documented-typical'`
    );
    assert(
      card.units && typeof card.units === 'object' && Object.keys(card.units).length > 0,
      `${id}: SI units profile required`
    );

    assertFinitePositive(card.rho, `${id}: rho`);
    assert.strictEqual(card.rho, card.densityKgM3, `${id}: rho must equal densityKgM3`);
    assert(Number.isFinite(card.nu) && card.nu > -1 && card.nu < 0.5, `${id}: nu must lie in (-1, 0.5)`);
    assertFinitePositive(card.yieldStrengthMPa, `${id}: yieldStrengthMPa`);
    assertFinitePositive(card.thermalConductivityW_mK, `${id}: thermalConductivityW_mK`);

    const ladder = card.temperatureLadderK;
    for (const prop of ['E', 'alpha', 'Sy', 'Su']) {
      assert(Array.isArray(card[prop]), `${id}: ${prop} must be an array`);
      assert.strictEqual(card[prop].length, ladder.length, `${id}: ${prop} length must match temperatureLadderK`);
      assert(ladder.length >= 2, `${id}: temperature ladder must have >= 2 points`);
      assert(card[prop].every(Number.isFinite), `${id}: ${prop} values must be finite`);
      assert(ladder.every(Number.isFinite), `${id}: ladder temperatures must be finite`);
      assert(
        card[prop].every((v) => v >= 0),
        `${id}: ${prop} values must be non-negative`
      );
      if (prop !== 'alpha') {
        assert(
          card[prop].every((v) => v > 0),
          `${id}: ${prop} values must be positive`
        );
      }
    }
    for (let i = 1; i < ladder.length; i++) {
      assert(ladder[i] > ladder[i - 1], `${id}: ladder temperatures must be strictly increasing`);
    }
  }

  console.log(
    `  ✓ ${ids.length} cards present; every card has provenance URL, SI units, finite numeric props, documented-typical status`
  );

  for (const id of ids) {
    const card = MATERIAL_DATABASE[id];
    const lo = card.temperatureLadderK[0];
    const hi = card.temperatureLadderK[card.temperatureLadderK.length - 1];
    const samples = 24;
    let prevE = Infinity;
    let prevSy = Infinity;
    let prevSu = Infinity;
    let prevAlpha = -Infinity;
    for (let i = 0; i <= samples; i++) {
      const T = lo + ((hi - lo) * i) / samples;
      const E = interpolateProperty(card, 'E', T);
      const Sy = interpolateProperty(card, 'Sy', T);
      const Su = interpolateProperty(card, 'Su', T);
      const alpha = interpolateProperty(card, 'alpha', T);
      assertFinitePositive(E, `${id}: interpolated E at ${T} K`);
      assertFinitePositive(Sy, `${id}: interpolated Sy at ${T} K`);
      assertFinitePositive(Su, `${id}: interpolated Su at ${T} K`);
      assert(alpha > 0, `${id}: interpolated alpha at ${T} K must be positive`);
      const tol = 1e-9;
      assert(E <= prevE + tol * Math.max(1, Math.abs(prevE)), `${id}: E must be non-increasing in T (${T} K)`);
      assert(Sy <= prevSy + tol * Math.max(1, Math.abs(prevSy)), `${id}: Sy must be non-increasing in T (${T} K)`);
      assert(Su <= prevSu + tol * Math.max(1, Math.abs(prevSu)), `${id}: Su must be non-increasing in T (${T} K)`);
      assert(
        alpha >= prevAlpha - tol * Math.max(1, Math.abs(prevAlpha)),
        `${id}: alpha must be non-decreasing in T (${T} K)`
      );
      prevE = E;
      prevSy = Sy;
      prevSu = Su;
      prevAlpha = alpha;
    }
    assert.strictEqual(
      interpolateProperty(card, 'E', lo),
      card.E[0],
      `${id}: interpolation must clamp at ladder floor`
    );
    assert.strictEqual(
      interpolateProperty(card, 'E', hi),
      card.E[card.E.length - 1],
      `${id}: interpolation must clamp at ladder ceiling`
    );
  }
  console.log(
    `  ✓ temperature interpolation monotonic across all ${ids.length} cards (E/Sy/Su non-increasing, alpha non-decreasing)`
  );

  const al = MaterialManager.getMaterial('AL-7075-T6');
  assert(al, 'AL-7075-T6 must resolve via MaterialManager.getMaterial');
  assert(al.E[0] > 0, 'AL-7075-T6 E ladder must be present');

  const solver = new FEASolver();
  const n0 = solver.addNode(0, 0, 0);
  const n1 = solver.addNode(0.1, 0, 0);
  const n2 = solver.addNode(0, 0.1, 0);
  const n3 = solver.addNode(0, 0, 0.1);
  solver.addElement([n0.id, n1.id, n2.id, n3.id], 'AL-7075-T6');
  solver.fixNode(n0.id, true, true, true);
  solver.fixNode(n1.id, true, true, true);
  solver.fixNode(n2.id, true, true, true);
  solver.applyForce(n3.id, 0, 0, 1000);

  const results = solver.solveStatic();
  assert(results !== null && typeof results === 'object', 'solveStatic must return a result object');
  assert.strictEqual(results.dofCount, 12);
  assert(results.elements.length === 1, 'exactly one element expected');
  assert(results.elements[0].vonMisesStress > 0, 'von Mises stress must be positive');
  assertFinitePositive(results.maxDisplacement, 'maxDisplacement');
  assertFinitePositive(results.maxStress, 'maxStress');
  assert.strictEqual(solver.elements[0].material.materialId, 'AL-7075-T6');
  assert.strictEqual(solver.elements[0].material.name, al.name);
  assert(Math.abs(solver.elements[0].material.E - 71.7e9) < 1e3, 'catalog E must be resolved to ~71.7 GPa');
  assert(Math.abs(solver.elements[0].material.nu - al.nu) < 1e-12, 'catalog nu must be resolved');
  assert(Math.abs(solver.elements[0].material.yieldStress - 503e6) < 1e3, 'catalog Sy must be resolved to ~503 MPa');
  console.log(
    '  ✓ FEASolver materialId AL-7075-T6: catalog lookup + small TET4 elasticity solve produced finite results'
  );

  const fallbackSolver = new FEASolver();
  const f0 = fallbackSolver.addNode(0, 0, 0);
  const f1 = fallbackSolver.addNode(0.1, 0, 0);
  const f2 = fallbackSolver.addNode(0, 0.1, 0);
  const f3 = fallbackSolver.addNode(0, 0, 0.1);
  fallbackSolver.addElement([f0.id, f1.id, f2.id, f3.id], { E: 200e9, nu: 0.3, yieldStress: 250e6 });
  fallbackSolver.fixNode(f0.id, true, true, true);
  fallbackSolver.fixNode(f1.id, true, true, true);
  fallbackSolver.fixNode(f2.id, true, true, true);
  fallbackSolver.applyForce(f3.id, 0, 0, 1000);
  const fallbackResults = fallbackSolver.solveStatic();
  assertFinitePositive(fallbackResults.maxDisplacement, 'fallback maxDisplacement');
  assertFinitePositive(fallbackResults.maxStress, 'fallback maxStress');
  assert.strictEqual(fallbackSolver.elements[0].material.E, 200e9);
  assert.strictEqual(fallbackSolver.elements[0].material.yieldStress, 250e6);
  console.log('  ✓ explicit-property fallback still solves without catalog lookup');

  const hybridSolver = new FEASolver();
  const h0 = hybridSolver.addNode(0, 0, 0);
  const h1 = hybridSolver.addNode(0.1, 0, 0);
  const h2 = hybridSolver.addNode(0, 0.1, 0);
  const h3 = hybridSolver.addNode(0, 0, 0.1);
  hybridSolver.addElement([h0.id, h1.id, h2.id, h3.id], { materialId: 'SS-304L', E: 210e9 });
  hybridSolver.fixNode(h0.id, true, true, true);
  hybridSolver.fixNode(h1.id, true, true, true);
  hybridSolver.fixNode(h2.id, true, true, true);
  hybridSolver.applyForce(h3.id, 0, 0, 1000);
  const hybridResults = hybridSolver.solveStatic();
  assertFinitePositive(hybridResults.maxDisplacement, 'hybrid maxDisplacement');
  assert.strictEqual(hybridSolver.elements[0].material.E, 210e9, 'explicit E must override catalog E');
  assert.strictEqual(hybridSolver.elements[0].material.materialId, 'SS-304L');
  assert(Number.isFinite(hybridSolver.elements[0].material.nu), 'catalog nu must fill in when not overridden');
  console.log('  ✓ hybrid materialId + explicit-property override works');

  assert.strictEqual(MaterialManager.getMaterial('unknown-material'), null);
  assert.strictEqual(MaterialManager.getMaterial('toString'), null);
  assert.strictEqual(MaterialManager.getMaterial(null), null);
  assert(Object.isFrozen(MATERIAL_DATABASE), 'MATERIAL_DATABASE must remain frozen');
  console.log('  ✓ unknown keys resolve to null; catalog frozen');

  assert.throws(() => interpolateProperty({ temperatureLadderK: [293], E: [1e9] }, 'E', 300), TypeError);
  console.log('  ✓ malformed ladder input throws TypeError');

  console.log('\n================================================================');
  console.log('   ALL MATERIALS CATALOG CONTRACT ASSERTIONS PASSED');
  console.log('================================================================\n');
  return { passed: true, cardCount: ids.length };
}

if (require.main === module) {
  runMaterialCatalogTests();
}

module.exports = { runMaterialCatalogTests };
