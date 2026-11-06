#!/usr/bin/env node
'use strict';

/**
 * OmniEng local CI matrix gate runner.
 *
 * Simulates the 5-runner CI matrix on THIS host (the host cannot boot the
 * actual runner OSes, so every result is labeled SIMULATED-LOCAL-RUN). For
 * each simulated cell the SAME gate commands are executed locally:
 *
 *   1. npm run check:syntax
 *   2. npm run lint
 *   3. npm run typecheck
 *   4. npm run format:check
 *   5. npm run dependency:audit
 *   6. node test/vv/run_vv.js   (exit captured separately; non-gating per spec)
 *   7. node test/test_coverage_remaining_modules.js  (representative check)
 *   8. node test/test_mms_grid_convergence.js        (representative check)
 *
 * `npm test` is intentionally EXCLUDED from the matrix (too heavy); the two
 * representative test files replace it. A JSON summary is written to
 * artifacts_audit/matrix_runs/matrix_summary.json. The process exits 0 only
 * if every cell passes every gate.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AUDIT_DIR = path.join(ROOT, 'artifacts_audit', 'matrix_runs');

const MATRIX = [
  { runner: 'ubuntu-22.04', arch: 'x64', osType: 'Linux' },
  { runner: 'ubuntu-24.04', arch: 'x64', osType: 'Linux' },
  { runner: 'windows-2025', arch: 'x64', osType: 'Windows_NT' },
  { runner: 'macos-15-intel', arch: 'x64', osType: 'Darwin' },
  { runner: 'macos-15-arm64', arch: 'arm64', osType: 'Darwin' }
];

const GATING_STEPS = [
  { id: 'check:syntax', name: 'Syntax Check', command: 'npm', args: ['run', 'check:syntax'] },
  { id: 'lint', name: 'Lint (eslint)', command: 'npm', args: ['run', 'lint'] },
  { id: 'typecheck', name: 'Typecheck (tsc)', command: 'npm', args: ['run', 'typecheck'] },
  { id: 'format:check', name: 'Format Check (prettier)', command: 'npm', args: ['run', 'format:check'] },
  {
    id: 'dependency:audit',
    name: 'Dependency Audit (npm audit)',
    command: 'npm',
    args: ['run', 'dependency:audit']
  },
  {
    id: 'vv',
    name: 'V&V Benchmarks (run_vv.js; exit captured, non-gating)',
    command: 'node',
    args: ['test/vv/run_vv.js'],
    gating: false
  },
  {
    id: 'representative:coverage-remaining',
    name: 'Representative: test_coverage_remaining_modules.js',
    command: 'node',
    args: ['test/test_coverage_remaining_modules.js']
  },
  {
    id: 'representative:mms-grid-convergence',
    name: 'Representative: test_mms_grid_convergence.js',
    command: 'node',
    args: ['test/test_mms_grid_convergence.js']
  }
];

function runStep(command, args) {
  const start = Date.now();
  const res = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  const durationMs = Date.now() - start;
  const status = res.status ?? (res.signal ? 1 : 1);
  return {
    status,
    signal: res.signal || null,
    durationMs,
    stdout: res.stdout || '',
    stderr: res.stderr || ''
  };
}

function executeCell(cell) {
  const cellId = `${cell.runner}-${cell.arch}`;
  console.log('\n------------------------------------------------------------------------');
  console.log(`>>> [SIMULATED-LOCAL-RUN] Matrix Cell: ${cellId}`);
  console.log('------------------------------------------------------------------------');

  const stepResults = [];
  let cellPassed = true;

  for (const step of GATING_STEPS) {
    process.stdout.write(`  - ${step.name} ... `);
    const res = runStep(step.command, step.args);
    const isOk = res.status === 0;
    const label = isOk ? 'PASS' : 'FAIL';
    console.log(`${label} (${res.durationMs}ms, exit ${res.status})`);

    stepResults.push({
      id: step.id,
      name: step.name,
      simulated: true,
      mode: 'SIMULATED-LOCAL-RUN',
      runnerHost: `${process.platform}-${process.arch}`,
      simulatedRunner: cellId,
      command: `${step.command} ${step.args.join(' ')}`,
      exitCode: res.status,
      signal: res.signal,
      durationMs: res.durationMs,
      outcome: label,
      gating: step.gating !== false
    });

    if (!isOk && step.gating !== false) {
      cellPassed = false;
      const tail = (res.stderr || res.stdout || '').split('\n').slice(-25).join('\n');
      console.error(`    [FAIL] ${step.name} failed; output tail:\n${tail}`);
    }
  }

  return { cellId, cellPassed, stepResults };
}

async function runLocalMatrix() {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });

  console.log('========================================================================');
  console.log('   OmniEng Local CI Matrix Verification (5 simulated runner cells)');
  console.log('   Mode: SIMULATED-LOCAL-RUN (host does not boot the runner OSes)');
  console.log('========================================================================');

  const matrixResults = [];
  for (const cell of MATRIX) {
    const { cellId, cellPassed, stepResults } = executeCell(cell);
    matrixResults.push({
      runner: cell.runner,
      arch: cell.arch,
      osType: cell.osType,
      simulated: true,
      mode: 'SIMULATED-LOCAL-RUN',
      host: `${process.platform}-${process.arch} (${process.version})`,
      passed: cellPassed,
      steps: stepResults
    });
  }

  console.log('\n========================================================================');
  console.log('   LOCAL MATRIX SUMMARY LEDGER (SIMULATED-LOCAL-RUN)');
  console.log('========================================================================\n');

  let allGreen = true;
  for (const result of matrixResults) {
    const status = result.passed ? 'GREEN (PASS)' : 'RED (FAIL)';
    if (!result.passed) allGreen = false;
    console.log(`  [${status}] ${result.runner} (${result.arch}) — simulated on ${result.host}`);
    for (const step of result.steps) {
      console.log(`      ${step.outcome.padEnd(4)} ${step.id} (exit ${step.exitCode})`);
    }
  }

  const summary = {
    timestamp: new Date().toISOString(),
    generator: 'scripts/run_local_ci_matrix.js',
    mode: 'SIMULATED-LOCAL-RUN',
    note: 'All cells executed on this host with the same commands; results are local simulations, not hosted CI runs.',
    host: `${process.platform}-${process.arch} (${process.version})`,
    allGreen,
    npmTestExcluded: true,
    representativeTestsInPlaceOfNpmTest: [
      'node test/test_coverage_remaining_modules.js',
      'node test/test_mms_grid_convergence.js'
    ],
    matrixResults
  };

  const summaryPath = path.join(AUDIT_DIR, 'matrix_summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nMatrix summary written to: ${summaryPath}`);
  console.log(`Overall result: ${allGreen ? 'ALL CELLS PASSED' : 'AT LEAST ONE CELL FAILED'}\n`);

  process.exitCode = allGreen ? 0 : 1;
}

if (require.main === module) {
  runLocalMatrix().catch((error) => {
    console.error(`Local matrix runner crashed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { runLocalMatrix };
