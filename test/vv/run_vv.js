/**
 * Experimental validation-readiness diagnostics used by the test suite.
 * These checks are not released validation evidence.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { runNafemsLE1 } = require('./nafems/test_nafems_le1');
const { runNafemsLE10 } = require('./nafems/test_nafems_le10');
const { runNafemsLE11 } = require('./nafems/test_nafems_le11');
const { runNafemsFV32 } = require('./nafems/test_nafems_fv32');
const { runNafemsT1 } = require('./nafems/test_nafems_t1');
const { runNasaTmrFlatPlate } = require('./nasa_tmr/test_nasa_tmr_flat_plate');
const { runManufacturedSparseSPD } = require('../../src/core/vv/manufactured_sparse_spd');
const { runEulerBeamMooseReference } = require('../../src/core/vv/euler_beam_moose_reference');
const { runPoissonManufacturedSolution } = require('../../src/core/vv/poisson_manufactured_solution');
const { runTimoshenkoBeamMooseReference } = require('../../src/core/vv/timoshenko_beam_moose_reference');
const { getUnavailableValidationCase } = require('../../src/core/vv/validation_readiness');
const { runIso10110OpticsTolerance } = require('./optics/test_iso10110_tolerance');
const { runHertzAnalyticalReference } = require('../../src/core/vv/hertz_analytical');

function summarizeValidationResults(results) {
  if (!Array.isArray(results)) throw new TypeError('Validation results must be an array.');

  const summary = { total: results.length, passed: 0, unavailable: 0, failed: 0 };
  for (const result of results) {
    if (result?.status === 'unavailable') {
      summary.unavailable += 1;
    } else if (result?.status === 'invalid' || result?.status === 'failed' || result?.passed !== true) {
      summary.failed += 1;
    } else {
      summary.passed += 1;
    }
  }
  return summary;
}

function getValidationOutcome(result) {
  if (result?.status === 'unavailable') return 'UNAVAILABLE';
  if (result?.status === 'invalid' || result?.status === 'failed' || result?.passed !== true) return 'FAIL';
  return 'PASS';
}

function runVVVerificationBenchmarks(options = {}) {
  console.log('\n====================================================');
  console.log('   OmniEng Experimental Validation Readiness        ');
  console.log('   Results are not released validation evidence     ');
  console.log('====================================================\n');

  const results = [
    runNafemsLE1(),
    runNafemsLE10(),
    runNafemsFV32(),
    runNafemsT1(),
    runNasaTmrFlatPlate(),
    runManufacturedSparseSPD(),
    runPoissonManufacturedSolution(),
    runTimoshenkoBeamMooseReference(),
    runEulerBeamMooseReference(),
    runHertzAnalyticalReference(),
    getUnavailableValidationCase('HERTZ_CONTACT_3D'),
    getUnavailableValidationCase('NIST_SPARSE_ROBUSTNESS'),
    getUnavailableValidationCase('HANOVER_BEAM_DYNAMIC_RESPONSE')
  ];

  results.push(runNafemsLE11());
  results.push(runIso10110OpticsTolerance());

  const summary = summarizeValidationResults(results);
  for (const result of results) {
    const state = getValidationOutcome(result);
    const reason = result.reason ? ` — ${result.reason}` : '';
    console.log(`  ${state} ${result.id}: ${result.name}${reason}`);
  }
  console.log(
    `\n  Summary: ${summary.passed} passed, ${summary.unavailable} unavailable, ${summary.failed} failed (${summary.total} listed)\n`
  );

  if (options.outputDir !== undefined) {
    generateVerificationReport(results, summary, options.outputDir);
  }

  return { ...summary, results, validationLevel: 'experimental' };
}

function generateVerificationReport(results, stats, outputDir) {
  if (typeof outputDir !== 'string' || outputDir.trim() === '') {
    throw new TypeError('An explicit output directory is required to generate a V&V diagnostic report.');
  }

  const reportDir = path.resolve(outputDir);
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'vv-diagnostic-report.md');
  const date = new Date().toISOString();
  const environment = `${os.platform()} ${os.arch()} | Node ${process.version} | CPUs: ${os.cpus()?.length || 'unknown'}`;

  const rows = results.map((result) => {
    const tolerance = String(result.tolerancePercent ?? 'not declared');
    const assertion = getValidationOutcome(result);
    const reason = result.reason ? ` (${result.reason})` : '';
    return `| ${result.id} | ${result.name} | ${result.targetValue ?? 'unavailable'} | ${result.calculatedValue ?? 'unavailable'} | ${result.units} | ${result.errorPercent ?? 'unavailable'} | ${tolerance} | ${assertion}${reason} |`;
  });

  const report = `# OmniEng Experimental Benchmark Diagnostic Report

**Status:** EXPERIMENTAL — NOT VALIDATION EVIDENCE<br>
**Generated:** ${date}<br>
**Environment:** ${environment}

## Scope

This report records assertions made by the current diagnostic test code. The benchmark implementations, reference provenance, engine execution, convergence, and tolerances have not been independently qualified. Passing assertions do not establish solver accuracy, standards compliance, certification, or release maturity.

| Listed checks | Passed | Unavailable | Failed |
|---:|---:|---:|---:|
| ${stats.total} | ${stats.passed} | ${stats.unavailable} | ${stats.failed} |

## Diagnostic results

| ID | Check name | Current target | Current value | Units | Reported error value | Declared tolerance value | Outcome |
|---|---|---:|---:|---|---:|---:|---|
${rows.join('\n')}

This file is a test diagnostic, not a verification dossier, sign-off record, certification, or compliance statement.
`;

  fs.writeFileSync(reportPath, report, 'utf8');
  return reportPath;
}

module.exports = { runVVVerificationBenchmarks, generateVerificationReport, summarizeValidationResults };

if (require.main === module) {
  const outputIndex = process.argv.indexOf('--output-dir');
  if (outputIndex >= 0 && !process.argv[outputIndex + 1]) {
    throw new Error('--output-dir requires a directory path.');
  }
  const outputDir = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  const summary = runVVVerificationBenchmarks(outputDir === undefined ? {} : { outputDir });
  if (summary.failed > 0) process.exitCode = 1;
}
