'use strict';

/**
 * OmniEng deep parser fuzz campaign runner.
 *
 * Loads the same deterministic parser fuzz harness used by the integrated
 * smoke (test/fuzz/test_parsers_fuzz.js) and drives it with a configurable
 * large iteration count. The harness calls the production parser functions
 * with seeded byte buffers from a fixed-seed PRNG (no Math.random), so a
 * campaign is fully replayable: same seed + same iteration count produce
 * identical results.
 *
 * Mode wiring:
 *   - FUZZ_ITERATIONS is set from --iterations (default 20000).
 *   - FUZZ_DEEP=1 is always set, so the campaign also runs the full
 *     AES-256-GCM vault tamper vectors (skipped in the fast smoke).
 *
 * Reporting: the fixed seed used by the harness, the iteration count, wall-
 * clock elapsed time, and a per-gate pass/fail summary are recorded. Exit
 * code is non-zero if any gate fails or if the harness crashes.
 *
 * Usage:
 *   node scripts/run_fuzz_campaign.js [--iterations N]
 */

const DEFAULT_ITERATIONS = 20000;
const HARNESS_SEED = 0xace12345;

function printUsage() {
  console.log('Usage: node scripts/run_fuzz_campaign.js [--iterations N]');
  console.log('  --iterations N   Number of fuzz iterations per gate (default 20000)');
}

function parseIterations(argv) {
  let iterations = Number(process.env.FUZZ_ITERATIONS) || DEFAULT_ITERATIONS;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--iterations') {
      const next = argv[i + 1];
      if (next === undefined) {
        console.error('ERROR: --iterations requires a numeric argument.');
        printUsage();
        process.exit(2);
      }
      const parsed = Number(next);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        console.error(`ERROR: --iterations must be a positive safe integer, got "${next}".`);
        process.exit(2);
      }
      iterations = parsed;
      i++;
      continue;
    }
    console.error(`ERROR: unknown argument "${arg}".`);
    printUsage();
    process.exit(2);
  }
  return iterations;
}

const iterations = parseIterations(process.argv);

process.env.FUZZ_ITERATIONS = String(iterations);
process.env.FUZZ_DEEP = '1';

const { runParserFuzzTests } = require('../test/fuzz/test_parsers_fuzz');

function main() {
  console.log('========================================================================');
  console.log('   OmniEng Deep Parser Fuzz Campaign');
  console.log(`   Seed: 0x${HARNESS_SEED.toString(16)} | Iterations per gate: ${iterations}`);
  console.log('========================================================================\n');

  const t0 = Date.now();
  let stats;
  try {
    stats = runParserFuzzTests();
  } catch (error) {
    console.error(`\nCAMPAIGN CRASHED: ${error.stack || error.message}`);
    process.exit(1);
  }
  const elapsedMs = Date.now() - t0;

  console.log('------------------------------------------------------------------------');
  console.log('  CAMPAIGN REPORT');
  console.log(`    seed:        0x${HARNESS_SEED.toString(16)}`);
  console.log(`    iterations:  ${iterations}`);
  console.log(`    elapsedMs:   ${elapsedMs}`);
  console.log(`    gates:       ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
  console.log('------------------------------------------------------------------------');

  if (stats.failed > 0) {
    console.error(`\nCAMPAIGN GATE FAILURE: ${stats.failed} of ${stats.total} fuzz gates failed.`);
    process.exit(1);
  }

  console.log(`\nCAMPAIGN PASSED: all ${stats.total} fuzz gates clean in ${elapsedMs} ms.`);
}

if (require.main === module) {
  main();
}

module.exports = { main, DEFAULT_ITERATIONS, HARNESS_SEED };
