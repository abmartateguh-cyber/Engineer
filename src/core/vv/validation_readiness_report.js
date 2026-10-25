/**
 * Creates a report of validation evidence availability without executing tests.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getValidationReadiness } = require('./validation_readiness');

function renderValidationReadinessReport(readiness = getValidationReadiness()) {
  const rows = readiness.results.map(
    (result) =>
      `| ${result.id} | ${result.name} | ${result.status} | ${result.referenceDataStatus || 'unavailable'} | ${result.solverAdapterStatus || 'unavailable'} | ${result.reason} |`
  );
  const environment = `${os.platform()} ${os.arch()} | Node ${process.version} | CPUs: ${os.cpus()?.length || 'unknown'}`;

  return `# OmniEng Validation Evidence Availability

**Status:** ${readiness.status.toUpperCase()} — no validation was executed<br>
**Generated:** ${new Date().toISOString()}<br>
**Environment:** ${environment}

## Scope

This report records whether independent reference cases and qualified production solver adapters are configured. It does not execute a solver, compare numerical results, or establish verification, validation, standards compliance, certification, or release maturity.

${readiness.available} of ${readiness.total} registered independent reference cases are configured. Unavailable cases are not passes.

| Case | Description | Availability | Reference data | Production solver adapter | Reason |
|---|---|---|---|---|---|
${rows.join('\n')}
`;
}

function generateValidationReadinessReport(outputDir, readiness = getValidationReadiness()) {
  if (typeof outputDir !== 'string' || outputDir.trim() === '') {
    throw new TypeError('An explicit output directory is required to generate a validation readiness report.');
  }

  const reportDir = path.resolve(outputDir);
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'vv-validation-readiness.md');
  fs.writeFileSync(reportPath, renderValidationReadinessReport(readiness), 'utf8');
  return reportPath;
}

module.exports = { renderValidationReadinessReport, generateValidationReadinessReport };
