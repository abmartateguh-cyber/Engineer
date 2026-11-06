/**
 * Test suite for the documented correlation-based thermophysical property engine
 * (src/core/plant/thermo_compounds.js) and its wiring through dippr_database.js
 * and the plant engine adapter.
 */

'use strict';

const assert = require('assert');
const { CorrelationSpeciesCatalog, DOCUMENTED_CORRELATION_SET } = require('../src/core/plant/thermo_compounds');
const {
  CorrelationSpeciesCatalog: WiredCatalog,
  CorrelationPropertyDatabase,
  THERMO_COMPOUNDS
} = require('../src/core/plant/dippr_database');
const { PlantEngineAdapter } = require('../src/core/plant/plant_engine_adapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');

console.log('================================================================');
console.log('   RUNNING THERMO COMPOUNDS DOCUMENTED CORRELATION ENGINE TESTS');
console.log('================================================================\n');

const catalog = new CorrelationSpeciesCatalog();
const wiredCatalog = new WiredCatalog();

// 1. Species count and honest metadata
console.log('[1] Catalog composition and honest metadata...');
assert(DOCUMENTED_CORRELATION_SET.length >= 20, 'Catalog must contain at least 20 documented species');
assert(catalog.listSpecies().length === DOCUMENTED_CORRELATION_SET.length);
assert.strictEqual(
  wiredCatalog.listSpecies().length,
  DOCUMENTED_CORRELATION_SET.length,
  'Wiring must expose the same species as the catalog'
);
assert.strictEqual(THERMO_COMPOUNDS.length, DOCUMENTED_CORRELATION_SET.length);
assert.strictEqual(typeof CorrelationPropertyDatabase, 'function', 'CorrelationPropertyDatabase alias must exist');
const metadata = catalog.getCatalogMetadata();
assert.strictEqual(metadata.status, 'correlation-based');
assert.strictEqual(metadata.licenseStatus, 'public-literature-citation');
assert(metadata.attribution.toLowerCase().includes('not an aiche dippr 801'), 'Must not claim DIPPR 801');
for (const id of catalog.listSpecies()) {
  const comp = catalog.get(id);
  assert(comp.sourceRef && comp.sourceRef.formula && comp.sourceRef.parameters, `sourceRef missing for ${id}`);
  assert.strictEqual(comp.dataStatus, 'documented-correlation-set');
}

console.log(`  ✓ ${metadata.recordCount} species, correlation-based, public-literature citation\n`);

// 2. Vapor pressure of water at 373.15 K ~ 101325 Pa (within 2%)
console.log('[2] Vapor pressure checks...');
const water = catalog.resolveRequired('Water');
const pWater = water.getVaporPressure(373.15);
assert(
  Math.abs(pWater - 101325) / 101325 < 0.02,
  `Water Psat(373.15 K) must be within 2% of 101325 Pa (got ${pWater.toFixed(1)} Pa)`
);

const methanol = catalog.resolveRequired('Methanol');
const pMethanol = methanol.getVaporPressure(337.8);
assert(
  Math.abs(pMethanol - 101325) / 101325 < 0.02,
  `Methanol Psat(337.8 K) must be within 2% of 101325 Pa (got ${pMethanol.toFixed(1)} Pa)`
);

for (const id of catalog.listSpecies()) {
  const comp = catalog.get(id);
  const anchorPsat = comp.getVaporPressure(comp.vpAnchor.T);
  assert(
    Math.abs(anchorPsat - comp.vpAnchor.P) / comp.vpAnchor.P < 0.005,
    `${id} must reproduce its documented anchor pressure within 0.5% (got ${anchorPsat.toFixed(1)} Pa)`
  );
}
console.log(
  `  ✓ water ${pWater.toFixed(0)} Pa @373.15K, methanol ${pMethanol.toFixed(0)} Pa @337.8K; all 20 anchors reproduced\n`
);

// 3. Critical constants: propane Tc ~ 369.9 K
console.log('[3] Critical constants...');
const propane = catalog.resolveRequired('Propane');
assert(Math.abs(propane.Tc - 369.9) < 0.1, `Propane Tc must be ~369.9 K (got ${propane.Tc})`);
assert(Math.abs(propane.Pc - 4.248e6) < 1e4, 'Propane Pc must be ~4.248 MPa');
console.log(`  ✓ propane Tc=${propane.Tc} K, Pc=${(propane.Pc / 1e5).toFixed(2)} bar\n`);

// 4. Rackett liquid density: hexane at 298.15 K ~ 655 kg/m3 (within 3%)
console.log('[4] Rackett saturated liquid density...');
const hexane = catalog.resolveRequired('n-Hexane');
const rhoHexane = hexane.getLiquidDensity(298.15);
assert(
  Math.abs(rhoHexane - 655) / 655 < 0.03,
  `n-Hexane Rackett density at 298.15 K must be within 3% of 655 kg/m3 (got ${rhoHexane.toFixed(1)})`
);
const rhoWater = water.getLiquidDensity(298.15);
assert(
  rhoWater > 900 && rhoWater < 1150,
  `Water density at 298.15 K should be ~997 kg/m3 (got ${rhoWater.toFixed(1)})`
);
console.log(`  ✓ hexane ${rhoHexane.toFixed(1)} kg/m3 @298.15K (ref 655); water ${rhoWater.toFixed(1)} kg/m3\n`);

// 5. Ideal-gas Cp at 298.15 K versus NIST reference for every species
console.log('[5] Ideal-gas Cp validation at 298.15 K...');
for (const id of catalog.listSpecies()) {
  const comp = catalog.get(id);
  const cp = comp.getIdealGasCp(298.15);
  const relErr = Math.abs(cp - comp.cp298Ref) / comp.cp298Ref;
  assert(
    relErr < 0.01,
    `${id} Cp(298.15 K) must be within 1% of NIST reference (got ${cp.toFixed(2)}, ref ${comp.cp298Ref})`
  );
}
console.log('  ✓ all 20 species Cp(298.15 K) within 1% of NIST reference\n');

// 6. Watson latent heat at normal boiling point
console.log('[6] Watson latent heat...');
const hvapWater = water.getLatentHeatOfVaporization(373.15);
assert(
  Math.abs(hvapWater - 40.66) < 0.41,
  `Water DeltaHvap(373.15 K) must be ~40.66 kJ/mol (got ${hvapWater.toFixed(2)})`
);
const hvapHexane = hexane.getLatentHeatOfVaporization(341.88);
assert(Math.abs(hvapHexane - 28.85) < 0.3, `Hexane DeltaHvap(Tb) must be ~28.85 kJ/mol (got ${hvapHexane.toFixed(2)})`);
console.log(`  ✓ water ${hvapWater.toFixed(2)} kJ/mol; hexane ${hvapHexane.toFixed(2)} kJ/mol\n`);

// 7. Fail-closed behavior
console.log('[7] Fail-closed behavior...');
assert.strictEqual(catalog.get('Unobtainium'), null, 'Unknown species lookup must return null');
assert.throws(
  () => catalog.resolveRequired('Unobtainium'),
  (error) => error.code === 'UNAVAILABLE'
);
assert.throws(
  () => catalog.resolveRequired(''),
  (error) => error.code === 'UNAVAILABLE'
);
assert.throws(() => water.getVaporPressure(700), RangeError, 'Above-critical vapor pressure must throw RangeError');
assert.throws(() => water.getVaporPressure(-5), TypeError, 'Non-positive temperature must throw TypeError');
assert.throws(
  () => water.getLiquidViscosity(298.15),
  (error) => error.code === 'UNAVAILABLE'
);
assert.throws(
  () => water.getLiquidThermalConductivity(298.15),
  (error) => error.code === 'UNAVAILABLE'
);
console.log('  ✓ unknown species, out-of-range, and undocumented properties fail closed\n');

// 8. Engine smoke through the plant engine adapter
console.log('[8] Plant adapter smoke test...');
const adapter = new PlantEngineAdapter();
const flashRequest = new JobRequest({
  domain: 'plant',
  operation: 'solve_vle_flash',
  parameters: {
    components: [water, propane, catalog.resolveRequired('Ethane')].map((c) => c.toPengRobinsonRecord()),
    k_ij: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ],
    feedComposition: [0.3, 0.4, 0.3],
    temperatureK: 240.0,
    pressurePa: 3.5e6,
    maxIter: 60,
    tol: 1e-6
  }
});
(async () => {
  const result = await adapter.execute(flashRequest);
  assert.strictEqual(result.status, JobStatus.SUCCEEDED);
  assert.strictEqual(result.outputData.converged, true);
  const sources = result.outputData.componentProvenance.map((p) => p.provenance.source);
  assert(
    sources.every((s) => typeof s === 'string' && s.includes('NIST')),
    'Provenance sources must be cited'
  );
  console.log('  ✓ solve_vle_flash succeeded through PlantEngineAdapter with documented-correlation records');
  console.log('\n================================================================');
  console.log('   ALL THERMO COMPOUNDS TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
