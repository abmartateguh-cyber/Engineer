/**
 * Experimental test-suite diagnostics.
 *
 * This module does not perform tool qualification, standards assessment, or SBOM
 * generation. Its legacy method names are retained for API compatibility only.
 */
'use strict';

class ToolQualificationKit {
  constructor(options = {}) {
    this.toolName = options.toolName || 'Experimental Engineering Tool';
    this.toolVersion = options.toolVersion || 'unreleased';
    this.targetSafetyStandard = options.targetSafetyStandard || null;
    this.testCases = [];
    this.testResults = [];
    this.lastSummary = null;
  }

  static evaluateDO330TQL() {
    return {
      dataStatus: 'experimental',
      supported: false,
      error: 'DO-330 tool qualification assessment is not implemented.'
    };
  }

  static evaluateISO26262TCL() {
    return {
      dataStatus: 'experimental',
      supported: false,
      error: 'ISO 26262 tool confidence assessment is not implemented.'
    };
  }

  registerTestCase(testCase) {
    if (!testCase || typeof testCase.execute !== 'function') {
      throw new TypeError('A diagnostic test case with an execute function is required.');
    }
    this.testCases.push(testCase);
  }

  executeQualificationSuite() {
    this.testResults = [];
    let passedCount = 0;

    for (const testCase of this.testCases) {
      const startedAt = Date.now();
      let result;
      try {
        result = testCase.execute();
      } catch (error) {
        result = { actual: error.message, expected: 'no exception', passes: false };
      }
      const entry = {
        id: String(testCase.id || this.testResults.length + 1),
        description: String(testCase.description || 'Diagnostic test'),
        passes: result?.passes === true,
        actual: result?.actual,
        expected: result?.expected,
        durationMs: Date.now() - startedAt
      };
      if (entry.passes) passedCount += 1;
      this.testResults.push(entry);
    }

    const totalTests = this.testResults.length;
    const digestInput = this.testResults.map(({ id, description, passes, actual, expected }) => ({
      id,
      description,
      passes,
      actual: String(actual),
      expected: String(expected)
    }));
    this.lastSummary = {
      dataStatus: 'experimental',
      status: 'diagnostic-only',
      toolName: this.toolName,
      toolVersion: this.toolVersion,
      requestedStandardLabel: this.targetSafetyStandard,
      totalTests,
      passedCount,
      failedCount: totalTests - passedCount,
      passRatePercent: totalTests ? (passedCount / totalTests) * 100 : 0,
      sha256Digest: ToolQualificationKit.computeSha256(JSON.stringify(digestInput)),
      results: this.testResults
    };
    return this.lastSummary;
  }

  static computeSha256(text) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  generateExperimentalDiagnosticReport() {
    const summary = this.lastSummary || this.executeQualificationSuite();
    const escapeCell = (value) =>
      String(value ?? '—')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replace(/\r?\n/g, ' ')
        .replaceAll('|', '\\|');
    const lines = [
      '# Experimental Test Diagnostic Summary',
      '',
      'This output is not tool qualification, certification, safety evidence, or standards compliance evidence.',
      '',
      '- Status: experimental diagnostic only',
      '- Tool: ' + escapeCell(summary.toolName),
      '- Version: ' + escapeCell(summary.toolVersion),
      '- Tests: ' +
        summary.passedCount +
        ' passed, ' +
        summary.failedCount +
        ' failed, ' +
        summary.totalTests +
        ' total',
      '- SHA-256 digest of diagnostic results: ' + summary.sha256Digest,
      '',
      '| ID | Description | Result | Actual | Expected |',
      '| --- | --- | --- | --- | --- |',
      ...summary.results.map(
        (result) =>
          '| ' +
          [result.id, result.description, result.passes ? 'PASS' : 'FAIL', result.actual, result.expected]
            .map(escapeCell)
            .join(' | ') +
          ' |'
      )
    ];
    return lines.join('\n') + '\n';
  }

  // Legacy compatibility name; the output is an experimental diagnostic only.
  generateComplianceReport() {
    return this.generateExperimentalDiagnosticReport();
  }

  generateCycloneDX_SBOM() {
    throw new Error('Runtime SBOM generation is unavailable; use the build SBOM artifact.');
  }

  generateSPDX_SBOM() {
    throw new Error('Runtime SBOM generation is unavailable; use the build SBOM artifact.');
  }
}

module.exports = { ToolQualificationKit };
