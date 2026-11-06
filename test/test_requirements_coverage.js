'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MATRIX_PATH = path.join(__dirname, '..', 'docs', 'industrialization', 'requirements_traceability.md');
const CHECK_SCRIPT = path.join(__dirname, '..', 'scripts', 'check_requirements_coverage.js');

function runRequirementsCoverageTests() {
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

  test('traceability matrix exists and contains at least 30 REQ IDs', () => {
    assert(fs.existsSync(MATRIX_PATH), `missing ${MATRIX_PATH}`);
    const markdown = fs.readFileSync(MATRIX_PATH, 'utf8');
    const ids = markdown.match(/REQ-\d{3}/g) || [];
    assert(ids.length >= 30, `expected >= 30 REQ IDs, found ${ids.length}`);
  });

  test('traceability checker script exits 0 and prints the PASS banner', () => {
    const child = spawnSync(process.execPath, [CHECK_SCRIPT], {
      encoding: 'utf8',
      timeout: 30000
    });
    if (child.error) throw child.error;
    assert.strictEqual(
      child.status,
      0,
      `checker exit ${child.status}; stdout:\n${child.stdout}\nstderr:\n${child.stderr}`
    );
    assert.match(child.stdout, /requirements traceability gate: PASS/);
  });

  test('every IMPLEMENTED row artifact resolves to an existing repository file', () => {
    const markdown = fs.readFileSync(MATRIX_PATH, 'utf8');
    const lines = markdown.split('\n');
    const headerIndex = lines.findIndex(
      (line) =>
        line.trim().startsWith('|') &&
        line
          .split('|')
          .map((cell) => cell.trim())
          .includes('Artifact')
    );
    assert(headerIndex !== -1, 'matrix must contain an Artifact column header');
    const headerCells = lines[headerIndex].split('|').map((cell) => cell.trim());
    const artifactColumn = headerCells.findIndex((cell) => cell === 'Artifact');
    assert(artifactColumn !== -1, 'matrix must contain an Artifact column');
    const root = path.resolve(__dirname, '..');

    for (let index = headerIndex + 1; index < lines.length; index++) {
      const line = lines[index];
      if (!line.trim().startsWith('|')) continue;
      if (!/REQ-\d{3}/.test(line)) continue;
      const cells = line.split('|').map((cell) => cell.trim());
      const status = (cells[cells.length - 2] || '').toUpperCase();
      if (status !== 'IMPLEMENTED') continue;
      const artifactMatches = (cells[artifactColumn] || '').match(/`([^`]+)`/g) || [];
      assert(artifactMatches.length > 0, `IMPLEMENTED row ${line.slice(0, 20)}... must declare at least one artifact`);
      for (const artifact of artifactMatches) {
        const artifactPath = artifact.slice(1, -1);
        assert(fs.existsSync(path.resolve(root, artifactPath)), `missing artifact ${artifactPath}`);
      }
    }
  });

  console.log(`Requirements traceability coverage: ${passed}/${total} passed; ${failed} failed`);
  return { total, passed, failed };
}

if (require.main === module) {
  const stats = runRequirementsCoverageTests();
  if (stats.failed > 0) process.exitCode = 1;
}

module.exports = { runRequirementsCoverageTests };
