/**
 * Evidence-based tool qualification evaluator.
 *
 * This module evaluates user-supplied factual evidence against a documented,
 * conservative numeric criteria table and returns a verdict that describes the
 * supplied evidence only. It never returns a certification claim: every result
 * carries `certificationClaimed: false` and a verdict of
 * 'evidence-insufficient' or 'evidence-satisfies-{level}'. Missing evidence
 * fails closed (`incomplete: true`).
 *
 * The numeric criteria table is a configurable evaluation policy, not a
 * normative restatement of DO-330 / ISO 26262. Higher TQL levels require
 * strictly more evidence (coverage, MC/DC, defect, and configuration
 * management thresholds).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_POLICY = {
  'do330:TQL-1': {
    minPassRatePercent: 100,
    minCoveragePercent: 100,
    minMcDcPercent: 100,
    maxOpenCriticalDefects: 0,
    maxOpenDefects: 0,
    requireConfigBaselines: true,
    requireReviewedChanges: true
  },
  'do330:TQL-2': {
    minPassRatePercent: 100,
    minCoveragePercent: 100,
    minMcDcPercent: 100,
    maxOpenCriticalDefects: 0,
    maxOpenDefects: null,
    requireConfigBaselines: true,
    requireReviewedChanges: false
  },
  'do330:TQL-3': {
    minPassRatePercent: 100,
    minCoveragePercent: 98,
    minMcDcPercent: 98,
    maxOpenCriticalDefects: 0,
    maxOpenDefects: null,
    requireConfigBaselines: true,
    requireReviewedChanges: false
  },
  'do330:TQL-4': {
    minPassRatePercent: 100,
    minCoveragePercent: 95,
    minMcDcPercent: 95,
    maxOpenCriticalDefects: 0,
    maxOpenDefects: null,
    requireConfigBaselines: true,
    requireReviewedChanges: false
  },
  'do330:TQL-5': {
    minPassRatePercent: 100,
    minCoveragePercent: 90,
    minMcDcPercent: 90,
    maxOpenCriticalDefects: 0,
    maxOpenDefects: null,
    requireConfigBaselines: true,
    requireReviewedChanges: false
  },
  'iso26262:TCL1-ASIL-D': {
    minPassRatePercent: 100,
    minCoveragePercent: 100,
    minMcDcPercent: 100,
    maxOpenCriticalDefects: 0,
    maxOpenDefects: null,
    requireConfigBaselines: true,
    requireReviewedChanges: false
  }
};

const USED_FOR_VALUES = new Set(['codegen', 'verification', 'test']);

let _goldEvidenceCache = null;

class ToolQualificationKit {
  constructor(options = {}) {
    this.toolName = options.toolName || 'Experimental Engineering Tool';
    this.toolVersion = options.toolVersion || 'unreleased';
    this.targetSafetyStandard = options.targetSafetyStandard || null;
    this.policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
    this.testCases = [];
    this.testResults = [];
    this.lastSummary = null;
  }

  static evaluateDO330TQL() {
    return {
      dataStatus: 'experimental',
      supported: false,
      certificationClaimed: false,
      error: 'DO-330 TQL assessment requires user-supplied evidence; pass evidence to evaluateEvidence().'
    };
  }

  static evaluateISO26262TCL() {
    return {
      dataStatus: 'experimental',
      supported: false,
      certificationClaimed: false,
      error:
        'ISO 26262 tool confidence assessment requires user-supplied evidence; pass evidence to evaluateEvidence().'
    };
  }

  static DEFAULT_GOLD_FUNCTIONS() {
    return [
      {
        id: 'MMS_GRID_CONVERGENCE',
        module: 'test/test_mms_grid_convergence.js',
        runner: 'runMmsGridConvergenceTests',
        description: 'Manufactured-solution grid-convergence gate for the FVM solver (REQ-007/REQ-011).',
        snapshot: (result) => ({ total: result.total, passed: result.passed, failed: result.failed })
      },
      {
        id: 'COVERAGE_REMAINING_MODULES',
        module: 'test/test_coverage_remaining_modules.js',
        runner: 'runRemainingModulesCoverageTests',
        description: 'Loaded-source coverage checks for previously unreferenced production modules (REQ-010).',
        snapshot: (result) => ({ total: result.total, passed: result.passed, failed: result.failed })
      },
      {
        id: 'LIBERTY_PARSER',
        module: 'test/test_liberty_parser.js',
        runner: 'runLibertyParserTests',
        description: 'EDA Liberty (.lib) parser acceptance and malformed-input rejection checks.',
        snapshot: (result) => ({
          suite: result.suite,
          total: result.total,
          passed: result.passed,
          failed: result.failed,
          passedAll: result.passedAll
        })
      },
      {
        id: 'HERTZ_3D_CONTACT_FEA',
        module: 'test/test_hertz_3d_contact_fea.js',
        runner: 'runHertz3DContactFEA',
        description: 'Hertz analytic versus 3D contact FEA comparison (sphere-on-flat wedge sector).',
        snapshot: (result) => ({
          total: result.total,
          passed: result.passed,
          failed: result.failed,
          status: result.status,
          solverExecuted: result.solverExecuted
        })
      },
      {
        id: 'HANOVER_BEAM_DYNAMICS',
        module: 'test/test_hanover_beam_dynamics.js',
        runner: 'runHanoverBeamDynamics',
        description: 'Hannover beam dynamic response companion check against published laboratory modes.',
        snapshot: (result) => ({ id: result.id, name: result.name, passed: result.passed, status: result.status })
      }
    ];
  }

  /**
   * Loads and runs representative gold functions from the repository and
   * normalizes their results into per-evidence check counts. This is
   * diagnostic evidence gathering only; it never certifies the tool.
   * @param {Array} [goldFunctions] descriptor list (see DEFAULT_GOLD_FUNCTIONS)
   * @returns {Object} { evidences, passedChecks, failedChecks, totalChecks }
   */
  static collectGoldFunctionEvidence(goldFunctions = ToolQualificationKit.DEFAULT_GOLD_FUNCTIONS()) {
    if (goldFunctions === ToolQualificationKit.DEFAULT_GOLD_FUNCTIONS() && _goldEvidenceCache) {
      return _goldEvidenceCache;
    }
    const root = path.resolve(__dirname, '..', '..', '..');
    const evidences = [];
    for (const gold of goldFunctions) {
      const startedAt = Date.now();
      let result = null;
      let error = null;
      try {
        const loaded = require(path.join(root, gold.module));
        if (!loaded || typeof loaded[gold.runner] !== 'function') {
          throw new TypeError(`runner ${gold.runner} is not exported by ${gold.module}`);
        }
        result = loaded[gold.runner]();
      } catch (caught) {
        error = caught;
      }
      let passedChecks = 0;
      let failedChecks = 0;
      let totalChecks = 0;
      let status = 'error';
      let summary = null;
      if (error) {
        failedChecks = 1;
        totalChecks = 1;
      } else if (result && typeof result === 'object') {
        const passedNumber = Number.isFinite(result.passed) ? result.passed : null;
        const failedNumber = Number.isFinite(result.failed) ? result.failed : null;
        if (passedNumber !== null && failedNumber !== null) {
          passedChecks = passedNumber;
          failedChecks = failedNumber;
          totalChecks = passedNumber + failedNumber;
        } else if (typeof result.passed === 'boolean') {
          passedChecks = result.passed ? 1 : 0;
          failedChecks = result.passed ? 0 : 1;
          totalChecks = 1;
        } else {
          failedChecks = 1;
          totalChecks = 1;
          error = new Error('runner returned an unrecognized result shape');
        }
        status = totalChecks > 0 && failedChecks === 0 ? 'passed' : 'failed';
        try {
          summary = gold.snapshot ? gold.snapshot(result) : null;
        } catch (snapshotError) {
          summary = null;
        }
      } else {
        error = new Error('runner returned no result');
      }
      evidences.push({
        id: gold.id,
        description: gold.description,
        module: gold.module,
        runner: gold.runner,
        status,
        passedChecks,
        failedChecks,
        totalChecks,
        durationMs: Date.now() - startedAt,
        error: error ? String(error.message || error) : undefined,
        summary
      });
    }
    const passedChecks = evidences.reduce((acc, entry) => acc + entry.passedChecks, 0);
    const failedChecks = evidences.reduce((acc, entry) => acc + entry.failedChecks, 0);
    const totalChecks = evidences.reduce((acc, entry) => acc + entry.totalChecks, 0);
    const collected = { evidences, passedChecks, failedChecks, totalChecks };
    if (goldFunctions === ToolQualificationKit.DEFAULT_GOLD_FUNCTIONS()) {
      _goldEvidenceCache = collected;
    }
    return collected;
  }

  /**
   * Automated DO-330 evidence executor: runs representative gold functions and
   * gathers the results into a JSON-scale evidence report. It never returns a
   * qualification or certification claim.
   * @returns {Object} evidence report
   */
  static runDO330Qualification() {
    const evidence = ToolQualificationKit.collectGoldFunctionEvidence();
    return {
      standard: 'RTCA DO-330 / EUROCAE ED-215',
      requestedLevel: 'TQL-5 (provisional target; not granted)',
      certificationClaimed: false,
      qualified: false,
      supported: false,
      dataStatus: 'experimental',
      generatedAt: new Date().toISOString(),
      health: 'Automated evidence-gathering only; not a qualification assessment.',
      summary: {
        totalChecks: evidence.totalChecks,
        passedChecks: evidence.passedChecks,
        failedChecks: evidence.failedChecks
      },
      evidences: evidence.evidences
    };
  }

  /**
   * Automated ISO 26262 evidence executor: runs representative gold functions
   * and gathers results into a JSON-scale evidence report. It never returns a
   * qualification or certification claim.
   * @returns {Object} evidence report
   */
  static runISO26262Qualification() {
    const evidence = ToolQualificationKit.collectGoldFunctionEvidence();
    return {
      standard: 'ISO 26262:2018 Part 8 Section 11',
      requestedLevel: 'TCL1 / ASIL-D (provisional target; not granted)',
      certificationClaimed: false,
      qualified: false,
      supported: false,
      dataStatus: 'experimental',
      generatedAt: new Date().toISOString(),
      health: 'Automated evidence-gathering only; not confidence-measure evaluation under ISO 26262-8 §11.',
      summary: {
        totalChecks: evidence.totalChecks,
        passedChecks: evidence.passedChecks,
        failedChecks: evidence.failedChecks
      },
      evidences: evidence.evidences
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

  _toNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  _coveragePercent(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'object') {
      const total = this._toNumber(value.total);
      const covered = this._toNumber(value.covered);
      if (total !== null && total > 0 && covered !== null) {
        return (covered / total) * 100;
      }
    }
    return null;
  }

  /**
   * Derives all numerical outcome summaries from the supplied evidence.
   * Anything missing is recorded; the returned `complete` flag is false when
   * any required input is absent or non-numeric (fail-closed).
   * @param {Object} evidence
   * @returns {Object}
   */
  _deriveMetrics(evidence) {
    const missing = [];
    const metrics = {
      passRatePercent: null,
      totalTests: null,
      passedTests: null,
      failedTests: null,
      coverage: { functions: null, branches: null, mcDc: null, overall: null },
      openCriticalDefects: null,
      totalDefects: null,
      configBaselines: null,
      configChanges: null,
      reviewedChangesPercent: null
    };

    const testResults = evidence.testResults;
    if (!testResults || typeof testResults !== 'object') {
      missing.push('testResults');
    } else {
      const passed = this._toNumber(testResults.passed);
      const failed = this._toNumber(testResults.failed);
      if (passed === null || failed === null) {
        missing.push('testResults.passed/failed');
      } else {
        const total = passed + failed;
        if (total <= 0) {
          missing.push('testResults (zero tests recorded)');
        } else {
          metrics.passedTests = passed;
          metrics.failedTests = failed;
          metrics.totalTests = total;
          metrics.passRatePercent = (passed / total) * 100;
        }
      }
    }

    const coverage = evidence.coverage;
    if (!coverage || typeof coverage !== 'object') {
      missing.push('coverage');
    } else {
      metrics.coverage.functions = this._coveragePercent(coverage.functions);
      metrics.coverage.branches = this._coveragePercent(coverage.branches);
      metrics.coverage.mcDc = this._coveragePercent(coverage.mcDc);
      const available = [metrics.coverage.functions, metrics.coverage.branches, metrics.coverage.mcDc].filter(
        (v) => v !== null
      );
      if (available.length === 0) {
        missing.push('coverage (functions/branches/mcDc)');
      } else {
        metrics.coverage.overall = Math.min(...available);
      }
    }

    const defects = evidence.defectTracking;
    if (!defects || typeof defects !== 'object') {
      missing.push('defectTracking');
    } else {
      const opened = this._toNumber(defects.open);
      const closed = this._toNumber(defects.closed);
      const openCritical = this._toNumber(defects.openCritical);
      if (opened === null || closed === null) {
        missing.push('defectTracking.open/closed');
      } else {
        metrics.totalDefects = opened + closed;
        metrics.openCriticalDefects = openCritical !== null ? openCritical : opened;
      }
    }

    const config = evidence.configMgmt;
    if (!config || typeof config !== 'object') {
      missing.push('configMgmt');
    } else {
      metrics.configBaselines = this._toNumber(config.baselines);
      metrics.configChanges = this._toNumber(config.changes);
      if (metrics.configBaselines === null || metrics.configChanges === null) {
        missing.push('configMgmt.baselines/changes');
      } else {
        const reviewed = this._toNumber(config.changesReviewed);
        if (reviewed !== null && metrics.configChanges > 0) {
          metrics.reviewedChangesPercent = Math.min(100, (reviewed / metrics.configChanges) * 100);
        }
      }
    }

    return { metrics, missing, complete: missing.length === 0 };
  }

  _resolveLevel(evidence) {
    const explicit = evidence.level;
    if (typeof explicit === 'string' && explicit.trim()) {
      return explicit.trim();
    }
    const standard = String(this.targetSafetyStandard || '');
    if (/iso\s*26262/i.test(standard) || /asil/i.test(standard)) {
      return 'iso26262:TCL1-ASIL-D';
    }
    if (/do\s*-?\s*330/i.test(standard)) {
      return 'do330:TQL-5';
    }
    return 'do330:TQL-5';
  }

  _policyFor(level, evidence) {
    const merged = { ...(this.policy[level] || this.policy['do330:TQL-5']), ...(evidence.thresholds || {}) };
    return {
      minPassRatePercent: this._toNumber(merged.minPassRatePercent) ?? 100,
      minCoveragePercent: this._toNumber(merged.minCoveragePercent) ?? 90,
      minMcDcPercent: this._toNumber(merged.minMcDcPercent) ?? 90,
      maxOpenCriticalDefects: this._toNumber(merged.maxOpenCriticalDefects) ?? 0,
      requireConfigBaselines: merged.requireConfigBaselines !== false,
      requireReviewedChanges: merged.requireReviewedChanges === true
    };
  }

  /**
   * Evaluates supplied evidence against the documented criteria table.
   * @param {Object} evidence - {testResults, coverage, defectTracking, configMgmt, toolVersion, usedFor, level, thresholds}
   * @returns {Object} verdict object (never a certification claim)
   */
  evaluateEvidence(evidence = {}) {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
      evidence = {};
    }
    const { metrics, missing, complete } = this._deriveMetrics(evidence);
    const level = this._resolveLevel(evidence);
    const policy = this._policyFor(level, evidence);

    const usedFor = evidence.usedFor || 'unspecified';
    const usedForValid = USED_FOR_VALUES.has(usedFor);
    let incomplete = !complete || !usedForValid;

    const criteria = [];
    const reasoning = [];

    if (!complete) {
      reasoning.push(`missing evidence: ${missing.join(', ')}`);
    }
    if (!usedForValid) {
      reasoning.push(
        `invalid usedFor: ${String(evidence.usedFor)} (expected one of ${[...USED_FOR_VALUES].join('/')})`
      );
    }

    if (metrics.passRatePercent !== null) {
      const required = policy.minPassRatePercent;
      const pass = metrics.passRatePercent >= required;
      criteria.push({ criterion: 'test pass rate', required, actual: metrics.passRatePercent, pass });
      reasoning.push(
        `test pass rate ${metrics.passRatePercent.toFixed(1)}% (required ${required}%) ${pass ? 'PASS' : 'FAIL'}`
      );
    }
    if (metrics.coverage.overall !== null) {
      const required = policy.minCoveragePercent;
      const pass = metrics.coverage.overall >= required;
      criteria.push({ criterion: 'overall coverage', required, actual: metrics.coverage.overall, pass });
      reasoning.push(
        `overall coverage ${metrics.coverage.overall.toFixed(1)}% (required ${required}%) ${pass ? 'PASS' : 'FAIL'}`
      );
    }
    if (metrics.coverage.mcDc !== null) {
      const required = policy.minMcDcPercent;
      const pass = metrics.coverage.mcDc >= required;
      criteria.push({ criterion: 'MC/DC coverage', required, actual: metrics.coverage.mcDc, pass });
      reasoning.push(
        `MC/DC coverage ${metrics.coverage.mcDc.toFixed(1)}% (required ${required}%) ${pass ? 'PASS' : 'FAIL'}`
      );
    }
    if (metrics.openCriticalDefects !== null) {
      const required = policy.maxOpenCriticalDefects;
      const pass = metrics.openCriticalDefects <= required;
      criteria.push({ criterion: 'open critical defects', required, actual: metrics.openCriticalDefects, pass });
      reasoning.push(
        `open critical defects ${metrics.openCriticalDefects} (required <= ${required}) ${pass ? 'PASS' : 'FAIL'}`
      );
    }
    if (metrics.configBaselines !== null) {
      const required = policy.requireConfigBaselines ? 1 : 0;
      const pass = metrics.configBaselines >= required;
      criteria.push({ criterion: 'configuration baselines', required, actual: metrics.configBaselines, pass });
      reasoning.push(
        `configuration baselines ${metrics.configBaselines} (required >= ${required}) ${pass ? 'PASS' : 'FAIL'}`
      );
    }
    if (policy.requireReviewedChanges) {
      if (metrics.reviewedChangesPercent === null) {
        reasoning.push('missing evidence: configMgmt.changesReviewed (required for this level)');
        criteria.push({ criterion: 'reviewed changes', required: 100, actual: null, pass: false });
        incomplete = true;
      } else {
        const pass = metrics.reviewedChangesPercent >= 100;
        criteria.push({ criterion: 'reviewed changes', required: 100, actual: metrics.reviewedChangesPercent, pass });
        reasoning.push(
          `reviewed changes ${metrics.reviewedChangesPercent.toFixed(1)}% (required 100%) ${pass ? 'PASS' : 'FAIL'}`
        );
      }
    }

    const allCriteriaPass = criteria.length > 0 && criteria.every((c) => c.pass);
    const satisfied = !incomplete && allCriteriaPass;
    const verdict = satisfied ? `evidence-satisfies-${level}` : 'evidence-insufficient';

    if (satisfied) {
      reasoning.push(`all ${criteria.length} evaluation criteria satisfied for ${level}`);
    } else if (criteria.length > 0) {
      const failed = criteria.filter((c) => !c.pass);
      if (failed.length > 0) {
        reasoning.push(`failed criteria: ${failed.map((c) => c.criterion).join(', ')}`);
      }
    }

    return {
      certificationClaimed: false,
      verdict,
      incomplete,
      level,
      usedFor: usedForValid ? usedFor : 'unspecified',
      toolName: this.toolName,
      toolVersion: evidence.toolVersion || this.toolVersion,
      criteria,
      reasoning,
      metrics: {
        passRatePercent: metrics.passRatePercent,
        totalTests: metrics.totalTests,
        passedTests: metrics.passedTests,
        failedTests: metrics.failedTests,
        coverage: metrics.coverage,
        openCriticalDefects: metrics.openCriticalDefects,
        totalDefects: metrics.totalDefects,
        configBaselines: metrics.configBaselines,
        configChanges: metrics.configChanges
      },
      evaluatedAt: new Date().toISOString()
    };
  }
}

module.exports = { ToolQualificationKit };
