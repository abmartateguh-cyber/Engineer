/**
 * Per-suite timing harness for `node test/run_all_tests.js`.
 *
 * Streams the full-suite output, attributes wall time to the last-seen
 * suite header, and prints a section-timing summary plus total wall time.
 * This does not modify the test registry.
 *
 * Usage: node scripts/measure_suite_times.js
 */

const { spawn } = require('child_process');
const path = require('path');

const RUNNER = path.join(__dirname, '..', 'test', 'run_all_tests.js');
const USE_PTY = process.env.TIME_PTY !== '0';

const HEADER_PATTERNS = [
  /^ELECTRON UI SMOKE STATIC CONTRACT/,
  /^RUNNING \d+ EXPERIMENTAL LEGACY SMOKE CHECKS/,
  /^RUNNING EXPERIMENTAL LEGACY MODULE SMOKE CHECKS \(SUITE 23\)/,
  /^RUNNING EXPERIMENTAL SECURITY AND CAD HELPER CHECKS/,
  /^RUNNING DETERMINISTIC PARSER SMOKE CHECKS/,
  /^RUNNING EXPERIMENTAL ENGINE SMOKE CHECKS \(SUITE \d+\)/,
  /^RUNNING EXPERIMENTAL UI INTEGRATION SMOKE CHECKS/,
  /^RUNNING EXPERIMENTAL MULTI-PHYSICS MODULE CHECKS/,
  /^EXPERIMENTAL LEGACY AEROSPACE SMOKE CHECKS ONLY/,
  /^PHASE 0 KERNELS:/,
  /^CAD INDUSTRIAL UPGRADE \(B-Rep/,
  /^DOMAIN INDUSTRIAL UPGRADE VERIFICATION/,
  /^STORAGE \(\.omni v3 WAL\)/,
  /^OMNIENG EXPERIMENTAL MULTI-DOMAIN STACK CHECKS/,
  /^OmniEng Experimental Validation Readiness/,
  /^TESTING OMNIENG SHARED ARCHITECTURAL CONTRACTS/,
  /^TESTING UNIFIED CENTRAL ENGINE REGISTRY/,
  /^TESTING CORE COSIM/,
  /^TESTING ROBOTICS, SYMBOLIC AI/,
  /^TESTING CORE SOLVERS/,
  /^TESTING MAIN PROCESS IPC ROUTERS/,
  /^RUNNING COMPREHENSIVE ENGINE ADAPTERS COVERAGE/,
  /^RUNNING COMPLETE UI VIEWS/,
  /^TESTING SIMULINK/,
  /^CAD CORE GEOMETRY TEST COVERAGE SUITE/,
  /^DOMAIN SOLVERS, COMPLIANCE/
];

function matchHeader(line) {
  const trimmed = line.trim();
  for (const re of HEADER_PATTERNS) {
    if (re.test(trimmed)) return trimmed.replace(/\s+/g, ' ');
  }
  return null;
}

function main() {
  const start = process.hrtime.bigint();
  const child = USE_PTY
    ? spawn('script', ['-q', '/dev/null', process.execPath, RUNNER], { stdio: ['ignore', 'pipe', 'inherit'] })
    : spawn(process.execPath, [RUNNER], { stdio: ['ignore', 'pipe', 'inherit'] });

  const sections = [];
  let current = { name: '(startup / pre-suite)', elapsedMs: 0, lines: 0 };
  sections.push(current);
  let lastTime = start;

  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    let nl;
    while ((nl = stdout.indexOf('\n')) >= 0) {
      const line = stdout.slice(0, nl);
      stdout = stdout.slice(nl + 1);
      const now = process.hrtime.bigint();
      const deltaMs = Number(now - lastTime) / 1e6;
      lastTime = now;
      current.elapsedMs += deltaMs;
      current.lines += 1;
      const header = matchHeader(line);
      if (header) {
        current = { name: header, elapsedMs: 0, lines: 0 };
        sections.push(current);
      }
    }
  });

  child.on('close', (code) => {
    const now = process.hrtime.bigint();
    current.elapsedMs += Number(now - lastTime) / 1e6;
    const totalMs = Number(now - start) / 1e6;

    console.log('\n===== PER-SUITE WALL-TIME BREAKDOWN =====');
    const ranked = [...sections].sort((a, b) => b.elapsedMs - a.elapsedMs);
    for (const s of ranked) {
      console.log(`${s.elapsedMs.toFixed(0).padStart(8)} ms  ${s.name}`);
    }
    console.log('===========================================');
    console.log(`TOTAL WALL TIME: ${(totalMs / 1000).toFixed(2)} s (${totalMs.toFixed(0)} ms)`);
    console.log(`exit code: ${code}`);
    process.exit(code ?? 0);
  });
}

main();
