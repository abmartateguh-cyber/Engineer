'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateVvReport } = require('../scripts/generate_vv_report');

function runVvReportGeneratorTests() {
  let total = 0;
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed++;
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${error.message}`);
    }
  }

  test('V&V report preserves generated-suite provenance and fails on benchmark failures', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnieng-vv-report-'));
    const summary = {
      total: 1,
      passed: 0,
      unavailable: 0,
      failed: 1,
      results: [
        {
          id: 'SPARSE_SPD_GENERATED_SUITE',
          name: 'Generated sparse SPD robustness suite',
          status: 'failed',
          passed: false,
          targetValue: 0,
          calculatedValue: 1,
          units: '1',
          errorPercent: 100,
          tolerancePercent: 0,
          reason: 'Synthetic failure fixture.',
          details: { reference: 'Generated ill-conditioned sparse SPD systems; original NIST data is not used.' }
        }
      ]
    };
    const generated = generateVvReport(outputDir, ({ outputDir: requestedDir }) => {
      assert.strictEqual(requestedDir, outputDir);
      return summary;
    });
    const report = fs.readFileSync(generated.reportPath, 'utf8');
    assert.strictEqual(generated.exitCode, 1);
    assert.match(report, /SPARSE_SPD_GENERATED_SUITE/);
    assert.match(report, /original NIST sparse matrix archive/);
    assert.match(report, /Generated ill-conditioned sparse SPD systems/);
    assert.doesNotMatch(report, /documented construction:  Its results/);
  });

  test('V&V report returns success only when no benchmark cases failed', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnieng-vv-report-pass-'));
    const summary = { total: 1, passed: 1, unavailable: 0, failed: 0, results: [] };
    const generated = generateVvReport(outputDir, () => summary);
    assert.strictEqual(generated.exitCode, 0);
    assert.ok(fs.statSync(generated.reportPath).size > 0);
  });

  console.log(`V&V report generator: ${passed}/${total} passed; ${failed} failed`);
  return { total, passed, failed };
}

if (require.main === module) {
  const stats = runVvReportGeneratorTests();
  if (stats.failed > 0) process.exitCode = 1;
}

module.exports = { runVvReportGeneratorTests };
