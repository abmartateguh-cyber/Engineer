'use strict';

/**
 * Proof tests for the real optical glass catalog (src/core/optics/data/).
 * The catalog must be non-empty, populated from published manufacturer
 * datasheets, produce published refractive indices / Abbe numbers, fail
 * closed for unknown glasses, and be usable end-to-end through the
 * OpticsEngineAdapter (lookup + thin-lens ray trace).
 */

const assert = require('assert');
const { OpticalGlassCatalog, OPTICAL_GLASS_CATALOG_DATA } = require('../src/core/optics/optical_glass_catalog');
const { OpticsEngineAdapter } = require('../src/core/optics/optics_engine_adapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');

const D_LINE_UM = 0.5875618;
const N_BK7_PUBLISHED_ND = 1.5168;
const N_BK7_PUBLISHED_VD = 64.17;

let passed = 0;
const failed = [];
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    failed.push({ name, error });
    console.error(`  FAIL - ${name}: ${error.message}`);
  }
}

async function main() {
  console.log('================================================================');
  console.log('      TESTING REAL OPTICAL GLASS CATALOG (no mocks)');
  console.log('================================================================');

  check('catalog data is non-empty (30-50 standard glasses)', () => {
    assert.ok(Array.isArray(OPTICAL_GLASS_CATALOG_DATA), 'data module must export an array');
    assert.ok(
      OPTICAL_GLASS_CATALOG_DATA.length >= 30,
      `expected >=30 records, got ${OPTICAL_GLASS_CATALOG_DATA.length}`
    );
    assert.ok(
      OPTICAL_GLASS_CATALOG_DATA.length <= 50,
      `expected <=50 records, got ${OPTICAL_GLASS_CATALOG_DATA.length}`
    );
  });

  check('every record carries datasheet provenance and publishable Sellmeier data', () => {
    for (const record of OPTICAL_GLASS_CATALOG_DATA) {
      assert.strictEqual(record.formula, 'sellmeier1');
      assert.strictEqual(record.validationStatus, 'datasheet-published');
      assert.strictEqual(record.dataStatus, 'datasheet-published');
      assert.ok(Array.isArray(record.B) && record.B.length === 3 && record.B.every(Number.isFinite));
      assert.ok(Array.isArray(record.C) && record.C.length === 3 && record.C.every(Number.isFinite));
      assert.ok(record.provenance && typeof record.provenance.manufacturer === 'string');
      assert.ok(record.provenance.datasheetUrl && typeof record.provenance.datasheetUrl === 'string');
      assert.ok(record.provenance.retrievedAt && typeof record.provenance.retrievedAt === 'string');
    }
  });

  const catalog = OpticalGlassCatalog.fromBundledData();

  check('catalog loads bundled data (non-empty)', () => {
    assert.strictEqual(catalog.catalogSize, OPTICAL_GLASS_CATALOG_DATA.length);
    assert.ok(catalog.catalogSize >= 30);
  });

  check('N-BK7 lookup returns a finite Sellmeier record', () => {
    const glass = catalog.getGlass('N-BK7');
    assert.ok(glass, 'N-BK7 must be present');
    assert.ok(glass.B.every(Number.isFinite) && glass.C.every(Number.isFinite));
    assert.ok(glass.B.every((b) => b > 0));
  });

  check('N-BK7 n_d matches the published 1.5168 within 1e-4', () => {
    const nd = catalog.calculateIndex('N-BK7', D_LINE_UM, 20);
    assert.ok(Math.abs(nd - N_BK7_PUBLISHED_ND) < 1e-4, `n_d=${nd}, expected ~${N_BK7_PUBLISHED_ND}`);
  });

  check('N-BK7 Abbe Vd matches the published 64.17 within 1%', () => {
    const props = catalog.getOpticalProperties('N-BK7', 20);
    const relativeError = Math.abs(props.Abbe_Vd - N_BK7_PUBLISHED_VD) / N_BK7_PUBLISHED_VD;
    assert.ok(relativeError < 0.01, `Vd=${props.Abbe_Vd.toFixed(3)}, expected ~${N_BK7_PUBLISHED_VD}`);
  });

  check('unknown glass fails closed at the catalog level', () => {
    assert.strictEqual(catalog.getGlass('NOT-A-REAL-GLASS'), null);
    assert.throws(() => catalog.calculateIndex('NOT-A-REAL-GLASS', D_LINE_UM, 20), /not available/);
    assert.throws(() => catalog.getOpticalProperties('NOT-A-REAL-GLASS', 20), /not available/);
  });

  const adapter = new OpticsEngineAdapter();
  check('adapter catalog is populated with real glasses', () => {
    assert.ok(adapter.catalog.catalogSize >= 30);
    assert.ok(adapter.catalog.getGlass('N-BK7'));
  });

  const indexReq = new JobRequest({
    domain: 'optics',
    operation: 'calculate_refractive_index',
    parameters: { glass: 'N-BK7', wavelengthUm: D_LINE_UM, temperatureC: 20 }
  });
  const indexRes = await adapter.execute(indexReq);
  check('adapter looks up N-BK7 from the catalog', () => {
    assert.strictEqual(indexRes.status, JobStatus.SUCCEEDED);
    const nd = indexRes.outputData.refractiveIndex;
    assert.ok(Math.abs(nd - N_BK7_PUBLISHED_ND) < 1e-4, `n_d=${nd}, expected ~${N_BK7_PUBLISHED_ND}`);
    const vd = indexRes.outputData.properties.Abbe_Vd;
    assert.ok(Math.abs(vd - N_BK7_PUBLISHED_VD) / N_BK7_PUBLISHED_VD < 0.01, `Vd=${vd.toFixed(3)}`);
    assert.strictEqual(indexRes.outputData.properties.dataStatus, 'datasheet-published');
  });

  check('adapter rejects unknown glass with UNSUPPORTED', async () => {
    const unknownReq = new JobRequest({
      domain: 'optics',
      operation: 'calculate_refractive_index',
      parameters: { glass: 'NOT-A-REAL-GLASS', wavelengthUm: D_LINE_UM, temperatureC: 20 }
    });
    await assert.rejects(adapter.execute(unknownReq), (error) => error.code === 'UNSUPPORTED');
  });

  const nBK7 = adapter.catalog.calculateIndex('N-BK7', D_LINE_UM, 20);
  const traceReq = new JobRequest({
    domain: 'optics',
    operation: 'trace_skew_rays',
    parameters: {
      surfaces: [
        {
          radius: 50.0,
          zVertex: 10.0,
          clearRadius: 20.0,
          nIncident: 1.0,
          nTransmitted: nBK7,
          conic: 0,
          asphericCoeffs: [0, 0, 0, 0]
        },
        {
          radius: -50.0,
          zVertex: 15.0,
          clearRadius: 20.0,
          nIncident: nBK7,
          nTransmitted: 1.0,
          conic: 0,
          asphericCoeffs: [0, 0, 0, 0]
        }
      ],
      pupilRadiusMm: 8.0,
      pupilPlaneZMm: -10.0,
      numRings: 3,
      raysPerRing: 6,
      fieldAngleDeg: 0.0,
      wavelengthUm: D_LINE_UM,
      sensorZ: 105.0
    }
  });
  const traceRes = await adapter.execute(traceReq);
  check('adapter traces a thin lens using catalog glass (N-BK7)', () => {
    assert.strictEqual(traceRes.status, JobStatus.SUCCEEDED);
    assert.ok(traceRes.outputData.totalRays > 10);
    assert.ok(traceRes.outputData.activeRays > 0, 'expected active rays to reach the sensor');
    assert.strictEqual(traceRes.outputData.spotDiagram.length, traceRes.outputData.activeRays);
    for (const point of traceRes.outputData.spotDiagram) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
    }
  });

  console.log(
    `\nPASSED ${passed}/${passed + failed.length} checks (${OPTICAL_GLASS_CATALOG_DATA.length} glasses in catalog)`
  );
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Test harness failed:', error);
  process.exitCode = 1;
});
