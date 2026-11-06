'use strict';

/**
 * Gate tests for scripts/check_claims_language.js (Industrial Readiness
 * Specification v1 — Tolerance & claims policy).
 *
 * 1. Runs the checker against the repository root and asserts exit 0
 *    ("claims-language gate: PASS").
 * 2. Builds small synthetic probes under the shared temporary directory
 *    (/var/folders/q7/ssjpm6kd45qft6jcftg5s99m0000gn/T/opencode/) to prove
 *    the detector fires on a positive unguarded claim and does not fire on
 *    negated claims.
 */

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CHECKER_SCRIPT = path.join(REPO_ROOT, 'scripts', 'check_claims_language.js');
const PROBE_BASE = '/var/folders/q7/ssjpm6kd45qft6jcftg5s99m0000gn/T/opencode';

function runChecker(args) {
  return spawnSync(process.execPath, [CHECKER_SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 120000
  });
}

function writeProbeRoot() {
  const root = fs.mkdtempSync(path.join(PROBE_BASE, 'claims-gate-probe-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  return root;
}

function runClaimsLanguageGateTests() {
  const results = { total: 0, passed: 0, failed: 0 };
  const record = (ok, message) => {
    results.total += 1;
    if (ok) {
      results.passed += 1;
    } else {
      results.failed += 1;
      process.stderr.write(`FAIL: ${message}\n`);
    }
    return ok;
  };

  const repoRun = runChecker([]);
  record(
    repoRun.status === 0 && repoRun.stdout.includes('claims-language gate: PASS'),
    `repo claims gate must exit 0 (status=${repoRun.status}, stdout=${JSON.stringify(repoRun.stdout.slice(0, 200))}, stderr=${JSON.stringify(repoRun.stderr.slice(0, 200))})`
  );

  const positiveRoot = writeProbeRoot();
  fs.writeFileSync(
    path.join(positiveRoot, 'src', 'positive_claim.js'),
    "'use strict';\nmodule.exports = { claim: 'This module is certified and production-ready for deployment.' };\n"
  );
  fs.writeFileSync(path.join(positiveRoot, 'main.js'), '// release-approved capability surface\n');
  const positiveRun = runChecker([positiveRoot]);
  record(positiveRun.status !== 0, `positive probe must fail the gate (status=${positiveRun.status})`);
  record(
    /positive_claim\.js:\d+:certified/.test(positiveRun.stdout) &&
      /positive_claim\.js:\d+:production-ready/.test(positiveRun.stdout),
    `positive probe output must list file:line:match (stdout=${JSON.stringify(positiveRun.stdout)})`
  );

  const negatedRoot = writeProbeRoot();
  fs.writeFileSync(
    path.join(negatedRoot, 'src', 'negated_claim.js'),
    "'use strict';\nmodule.exports = {\n  claim: 'This module is NOT YET CERTIFIED; it is not validated, not release-approved, and unqualified.'\n};\n"
  );
  fs.writeFileSync(
    path.join(negatedRoot, 'src', 'unavailable_claim.js'),
    "'use strict';\nmodule.exports = { claim: 'A qualified production adapter is unavailable; absent evidence means no certified result.' };\n"
  );
  fs.writeFileSync(
    path.join(negatedRoot, 'docs', 'negated_notes.md'),
    '# Notes\n\nThe tool is not certified, not validated, and not release-approved. No conforms to claim, no compliant with claim, and no production-ready statement is made.\n'
  );
  const negatedRun = runChecker([negatedRoot]);
  record(
    negatedRun.status === 0 && negatedRun.stdout.includes('claims-language gate: PASS'),
    `negated probe must pass the gate (status=${negatedRun.status}, stdout=${JSON.stringify(negatedRun.stdout)}, stderr=${JSON.stringify(negatedRun.stderr)})`
  );

  return results;
}

if (require.main === module) {
  const results = runClaimsLanguageGateTests();
  process.stdout.write(
    `Claims-language gate tests: ${results.passed}/${results.total} passed, ${results.failed} failed\n`
  );
  if (results.failed > 0) process.exitCode = 1;
}

module.exports = { runClaimsLanguageGateTests };
