#!/usr/bin/env node
'use strict';

/**
 * OmniEng tool qualification evidence runner.
 *
 * Executes the automated evidence executors in
 * src/core/compliance/tool_qualification_kit.js
 * (runDO330Qualification / runISO26262Qualification), which load and run
 * representative gold functions from the repository, and writes a per-standard
 * evidence report to artifacts_audit/tvr_report.json.
 *
 * Exit contract:
 *   - exit 0 as long as the report is written (even when individual evidence
 *     checks fail — failing checks are recorded in the report, not fatal);
 *   - exit 1 only on an internal error (kit missing, loader crash, write
 *     failure).
 */

const fs = require('fs');
const path = require('path');

const KIT_PATH = path.resolve(__dirname, '..', 'src', 'core', 'compliance', 'tool_qualification_kit.js');
const REPORT_PATH = path.resolve(__dirname, '..', 'artifacts_audit', 'tvr_report.json');

function standardSummary(evaluation) {
  const summary = evaluation.summary || { totalChecks: 0, passedChecks: 0, failedChecks: 0 };
  return {
    standard: evaluation.standard,
    requestedLevel: evaluation.requestedLevel,
    evidenceStatus: summary.failedChecks > 0 ? 'checks-failed' : 'all-checks-pass',
    totalChecks: summary.totalChecks,
    passedChecks: summary.passedChecks,
    failedChecks: summary.failedChecks,
    certificationClaimed: evaluation.certificationClaimed === true,
    qualified: evaluation.qualified === true,
    health: evaluation.health,
    evidences: evaluation.evidences || []
  };
}

function main() {
  const generatedAt = new Date().toISOString();
  const host = `${process.platform}-${process.arch} (${process.version})`;
  try {
    let kitModule;
    try {
      kitModule = require(KIT_PATH);
    } catch (loadError) {
      console.error(`[qualification] failed to load qualification kit: ${loadError.message}`);
      process.exitCode = 1;
      return;
    }
    const { ToolQualificationKit } = kitModule;
    if (!ToolQualificationKit) {
      console.error('[qualification] kit does not export ToolQualificationKit; cannot run qualification.');
      process.exitCode = 1;
      return;
    }
    for (const method of ['runDO330Qualification', 'runISO26262Qualification']) {
      if (typeof ToolQualificationKit[method] !== 'function') {
        console.error(`[qualification] kit does not expose ${method}; cannot run qualification.`);
        process.exitCode = 1;
        return;
      }
    }

    const do330 = ToolQualificationKit.runDO330Qualification();
    const iso26262 = ToolQualificationKit.runISO26262Qualification();

    const report = {
      reportId: 'OMN-IND-CERT-TVR-001',
      generatedAt,
      host,
      certificationClaimed: false,
      note: 'Automated evidence-gathering report. Not a certification or qualification claim; see the certification dossiers.',
      standards: {
        do330TQL: standardSummary(do330),
        iso26262TCL: standardSummary(iso26262)
      }
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`[qualification] wrote ${REPORT_PATH}`);
    console.log(
      `[qualification] DO-330 TQL: ${do330.summary.passedChecks}/${do330.summary.totalChecks} checks passed; ` +
        `ISO 26262 TCL: ${iso26262.summary.passedChecks}/${iso26262.summary.totalChecks} checks passed`
    );
    process.exitCode = 0;
  } catch (error) {
    console.error(`[qualification] runner crashed: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { main, standardSummary };
