'use strict';

const { generateValidationReadinessReport } = require('../src/core/vv/validation_readiness_report');

const outputIndex = process.argv.indexOf('--output-dir');
const outputDir = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;

if (typeof outputDir !== 'string' || outputDir.trim() === '') {
  console.error('Usage: npm run report:vv -- --output-dir <directory>');
  process.exitCode = 2;
} else {
  const reportPath = generateValidationReadinessReport(outputDir);
  console.log(`Validation evidence availability report written to ${reportPath}`);
}
