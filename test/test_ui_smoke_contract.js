'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * STATIC contract for the Electron UI smoke handler.
 *
 * This suite does NOT boot Electron; it is an honest static contract that
 * verifies:
 *   1. main.js parses as valid JavaScript (node --check equivalent).
 *   2. preload.js parses as valid JavaScript (node --check equivalent).
 *   3. main.js still contains a bounded --test-ui handler (source-text gate).
 *
 * The SVG gate is deliberately conservative: it only proves the handler
 * exists and is bounded by the --capture-rocket handler; it does not claim
 * that the handler was executed or that it passed a runtime smoke test.
 */
function runUiSmokeContractTests() {
  console.log('================================================================');
  console.log('   ELECTRON UI SMOKE STATIC CONTRACT (no Electron runtime)        ');
  console.log('================================================================');

  const failures = [];

  function requireParseable(relativePath) {
    const file = path.join(__dirname, '..', relativePath);
    const child = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 30000 });
    if (child.error) throw child.error;
    if (child.status !== 0) {
      throw new Error(`node --check failed for ${relativePath}:\n${child.stderr}`);
    }
  }

  try {
    requireParseable('main.js');
  } catch (err) {
    failures.push(err.message);
  }

  try {
    requireParseable('preload.js');
  } catch (err) {
    failures.push(err.message);
  }

  try {
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    const start = mainSource.indexOf("if (process.argv.includes('--test-ui')) {");
    const end = mainSource.indexOf("if (process.argv.includes('--capture-rocket')) {", start);
    assert(start >= 0 && end > start, 'Expected a bounded --test-ui handler in main.js');
  } catch (err) {
    failures.push(err.message);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.log('Electron UI smoke static contract FAILED.');
    return { total: 1, passed: 0, failed: 1 };
  }

  console.log('  ✓ main.js/preload.js parse; bounded --test-ui handler present');
  console.log('Electron UI smoke static contract checks passed.');
  return { total: 1, passed: 1, failed: 0 };
}

if (require.main === module) {
  const stats = runUiSmokeContractTests();
  if (stats.failed > 0) process.exitCode = 1;
}

module.exports = { runUiSmokeContractTests };
