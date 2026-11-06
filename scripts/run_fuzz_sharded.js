'use strict';

/**
 * OmniEng sharded deterministic parser fuzz campaign runner (Agent-48).
 *
 * Spawns `--workers` (default 4) child node processes concurrently, one per
 * shard of the deterministic parser fuzz payload space (see
 * test/fuzz/test_parsers_fuzz.js#runFuzzShard). Every worker receives its
 * shard index, the total shard count, and the shared campaign seed; each
 * shard therefore replays an identical, independent job for a given seed.
 *
 * Fails closed: if any worker crashes, fails a gate, fails to report a JSON
 * result, or exceeds the per-worker timeout (15s by default), the campaign
 * exits 1. Per-shard summaries and total wall-clock time are printed on
 * completion.
 *
 * Deep mode: the harness auto-enables the full AES-256-GCM vault tamper
 * vectors whenever FUZZ_ITERATIONS > 500 (or FUZZ_DEEP=1). Those PBKDF2
 * derivations are extremely expensive (~3s each) and do not parallelize
 * across worker processes on this host, so deep workers cannot each finish
 * within the 15s per-worker timeout. Deep mode is therefore opt-in (--deep):
 * without it the runner rejects --iterations values above 500 (the harness's
 * deep threshold) so a campaign can never silently exceed the timeout.
 * Smoke-level vectors (including the vault structural rejection and OmniArchive
 * container vectors) parallelize cleanly.
 *
 * Usage:
 *   node scripts/run_fuzz_sharded.js [--workers N] [--seed N] [--iterations N] [--deep]
 */

const { spawn } = require('child_process');
const path = require('path');

const DEFAULT_WORKERS = 4;
const DEFAULT_ITERATIONS = 500;
const DEFAULT_SEED = 0xace12345;
const WORKER_TIMEOUT_MS = 15000;
const HARNESS_DEEP_ITERATION_THRESHOLD = 500;

const HARNESS = path.join(__dirname, '..', 'test', 'fuzz', 'test_parsers_fuzz.js');

function printUsage() {
  console.log('Usage: node scripts/run_fuzz_sharded.js [--workers N] [--seed N] [--iterations N]');
  console.log('  --workers N      Number of parallel shard workers (default 4)');
  console.log('  --seed N         Shared deterministic campaign seed (default 0xace12345)');
  console.log(`  --iterations N   Fuzz iterations per gate in each worker (default ${DEFAULT_ITERATIONS};`);
  console.log(`                   values above ${HARNESS_DEEP_ITERATION_THRESHOLD} require --deep)`);
  console.log('  --deep           Allow iterations above the harness deep threshold and enable');
  console.log('                   full AES-256-GCM vault tamper vectors (CAUTION: PBKDF2');
  console.log('                   derivation does not parallelize; workers will likely exceed');
  console.log('                   the 15s timeout and fail closed)');
  console.log('  --help, -h       Show this help');
}

function readPositiveInt(argv, index, label) {
  const value = Number(argv[index]);
  if (!Number.isSafeInteger(value) || value < 1) {
    console.error(`ERROR: ${label} requires a positive safe integer, got "${argv[index]}".`);
    printUsage();
    process.exit(2);
  }
  return value;
}

function readSeed(argv, index) {
  const value = Number(argv[index]);
  if (!Number.isFinite(value)) {
    console.error(`ERROR: --seed requires a numeric value, got "${argv[index]}".`);
    printUsage();
    process.exit(2);
  }
  return value;
}

function parseArgs(argv) {
  const opts = {
    workers: DEFAULT_WORKERS,
    seed: DEFAULT_SEED,
    iterations: Number(process.env.FUZZ_ITERATIONS) || DEFAULT_ITERATIONS,
    deep: !!process.env.FUZZ_DEEP
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      case '--workers':
        opts.workers = readPositiveInt(argv, ++i, '--workers');
        break;
      case '--seed':
        opts.seed = readSeed(argv, ++i);
        break;
      case '--iterations':
        opts.iterations = readPositiveInt(argv, ++i, '--iterations');
        break;
      case '--deep':
        opts.deep = true;
        break;
      default:
        console.error(`ERROR: unknown argument "${arg}".`);
        printUsage();
        process.exit(2);
    }
  }
  if (!opts.deep && opts.iterations > HARNESS_DEEP_ITERATION_THRESHOLD) {
    console.error(
      `ERROR: --iterations ${opts.iterations} would auto-enable the harness's deep vault vectors ` +
        `(threshold ${HARNESS_DEEP_ITERATION_THRESHOLD}), whose PBKDF2 derivations do not parallelize ` +
        `and exceed the per-worker timeout. Pass --deep to allow it (expect timeout failures).`
    );
    process.exit(2);
  }
  return opts;
}

function runShard({ index, workers, seed, iterations, deep }) {
  return new Promise((resolve) => {
    const childEnv = Object.assign({}, process.env, {
      FUZZ_ITERATIONS: String(iterations)
    });
    if (deep) {
      childEnv.FUZZ_DEEP = '1';
    }
    const child = spawn(
      process.execPath,
      [HARNESS, '--shard', String(index), '--shards', String(workers), '--seed', String(seed), '--json', '--quiet'],
      { env: childEnv }
    );

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, WORKER_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ index, ok: false, timedOut, reason: `spawn error: ${err.message}`, stdout, stderr });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        resolve({ index, ok: false, timedOut: true, reason: `timeout after ${WORKER_TIMEOUT_MS}ms`, stdout, stderr });
        return;
      }
      let stats = null;
      const lastLine = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('{'))
        .pop();
      if (lastLine) {
        try {
          stats = JSON.parse(lastLine);
        } catch (err) {
          stats = null;
        }
      }
      let reason = null;
      if (code !== 0) {
        reason = `exit code ${code}${signal ? ` (signal ${signal})` : ''}`;
      } else if (!stats) {
        reason = 'no JSON result on stdout';
      } else if (stats.failed !== 0) {
        reason = `failed gates: ${stats.failed}/${stats.total}`;
      }
      resolve({ index, ok: reason === null, timedOut, reason, stats, stdout, stderr });
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  const t0 = Date.now();

  console.log('================================================================');
  console.log('   OmniEng Sharded Parser Fuzz Campaign (Agent-48)');
  console.log(`   workers: ${opts.workers} | seed: 0x${opts.seed.toString(16)} | iterations/gate: ${opts.iterations}`);
  console.log(
    `   deep vault vectors: ${opts.deep ? 'enabled' : 'disabled (smoke)'} | per-worker timeout: ${WORKER_TIMEOUT_MS}ms`
  );
  console.log('================================================================\n');

  const results = await Promise.all(
    Array.from({ length: opts.workers }, (_, index) =>
      runShard({ index, workers: opts.workers, seed: opts.seed, iterations: opts.iterations, deep: opts.deep })
    )
  );

  const elapsedMs = Date.now() - t0;

  console.log('----------------------------------------------------------------');
  console.log('  PER-SHARD SUMMARY');
  for (const result of results) {
    const status = result.ok ? 'PASS' : result.timedOut ? 'TIMEOUT' : 'FAIL';
    if (result.stats) {
      console.log(
        `    shard ${result.index}: ${status}  gates=${result.stats.passed}/${result.stats.total}` +
          `  seed=0x${result.stats.seed.toString(16)}  probe=[${result.stats.probe.join(',')}]`
      );
    } else {
      console.log(`    shard ${result.index}: ${status}  reason=${result.reason}`);
    }
  }
  console.log('----------------------------------------------------------------');
  console.log(`  TOTAL WALL TIME: ${elapsedMs} ms (${(elapsedMs / 1000).toFixed(2)}s)`);

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error(`\nCAMPAIGN FAILED: ${failed.length} of ${opts.workers} shards failed.`);
    for (const result of failed) {
      if (result.stderr.trim()) {
        console.error(`  --- shard ${result.index} stderr ---`);
        console.error(result.stderr.trim());
        console.error('  ---');
      }
    }
    process.exit(1);
  }

  console.log(`\nCAMPAIGN PASSED: all ${opts.workers} shards clean in ${elapsedMs} ms.`);
}

if (require.main === module) {
  main();
}

module.exports = { main, DEFAULT_WORKERS, DEFAULT_ITERATIONS, DEFAULT_SEED, WORKER_TIMEOUT_MS };
