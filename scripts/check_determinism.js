'use strict';

/**
 * Determinism gate for generated artifacts.
 *
 * Verifies byte-for-byte reproducibility of the artifacts OmniEng emits:
 *   1. `scripts/generate_capability_matrix.js` is run twice into separate temp
 *      directories and the two `capability_matrix.md` documents must be
 *      byte-identical.
 *   2. The seeded byte generator used by the parser fuzz suite
 *      (`test/fuzz/test_parsers_fuzz.js` — LCG 1664525/1013904223 over the
 *      same fixed seed `0xace12345`) must replay identical byte streams, and a
 *      different seed must produce a different stream.
 *
 * The PRNG below replicates the fuzz suite's generator exactly (the suite
 * exports only `runParserFuzzTests`, not its seeded generator, so the probe is
 * reimplemented here against the same constants).
 *
 * Exit code 0 and the `determinism gate: PASS` banner indicate reproducibility;
 * any mismatch prints the failing probe and exits 1.
 */

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function createPrng(seed = 0x1337c0de) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createDeterministicBuffer(prng, length) {
  const bytes = Buffer.alloc(length);
  for (let index = 0; index < length; index++) {
    bytes[index] = Math.floor(prng() * 256);
  }
  return bytes;
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function runCapabilityMatrixProbe() {
  const firstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnieng-dets-a-'));
  const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnieng-dets-b-'));
  try {
    const firstEnv = { ...process.env, OMNIENG_CAP_MATRIX_OUT: path.join(firstDir, 'capability_matrix.md') };
    const secondEnv = { ...process.env, OMNIENG_CAP_MATRIX_OUT: path.join(secondDir, 'capability_matrix.md') };
    const firstRun = spawnSync(process.execPath, ['scripts/generate_capability_matrix.js'], {
      cwd: ROOT,
      env: firstEnv,
      stdio: 'pipe',
      encoding: 'utf8'
    });
    const secondRun = spawnSync(process.execPath, ['scripts/generate_capability_matrix.js'], {
      cwd: ROOT,
      env: secondEnv,
      stdio: 'pipe',
      encoding: 'utf8'
    });
    if (firstRun.status !== 0 || secondRun.status !== 0) {
      const detail = String(firstRun.stderr || secondRun.stderr || '').trim();
      throw new Error(
        `generator exited ${firstRun.status ?? 'null'} then ${secondRun.status ?? 'null'}${detail ? ` (stderr: ${detail})` : ''}`
      );
    }
    const firstDoc = fs.readFileSync(path.join(firstDir, 'capability_matrix.md'));
    const secondDoc = fs.readFileSync(path.join(secondDir, 'capability_matrix.md'));
    if (!firstDoc.equals(secondDoc)) {
      throw new Error('capability matrix differs between two identical runs');
    }
    return { bytes: firstDoc.length, sha256: sha256Hex(firstDoc) };
  } finally {
    fs.rmSync(firstDir, { recursive: true, force: true });
    fs.rmSync(secondDir, { recursive: true, force: true });
  }
}

function runSeededPrngProbe() {
  const seed = 0xace12345;
  const length = 8192;
  const first = createDeterministicBuffer(createPrng(seed), length);
  const replay = createDeterministicBuffer(createPrng(seed), length);
  const differentSeed = createDeterministicBuffer(createPrng(seed + 1), length);
  if (!first.equals(replay)) {
    throw new Error('seeded PRNG byte stream differs on same-seed replay');
  }
  if (first.equals(differentSeed)) {
    throw new Error('seeded PRNG produced identical output for different seeds');
  }
  return { bytes: first.length, sha256: sha256Hex(first) };
}

const CHECKS = [
  { name: 'capability matrix artifact (byte-for-byte)', run: runCapabilityMatrixProbe },
  { name: 'seeded PRNG byte stream (fuzz-suite seed)', run: runSeededPrngProbe }
];

function main() {
  let failed = false;
  for (const check of CHECKS) {
    try {
      const result = check.run();
      console.log(`  PASS  ${check.name} (${result.bytes} bytes, sha256 ${result.sha256})`);
    } catch (error) {
      failed = true;
      console.error(`  FAIL  ${check.name}: ${error.message}`);
    }
  }
  if (failed) {
    console.error('determinism gate: FAIL');
    process.exitCode = 1;
  } else {
    console.log('determinism gate: PASS');
  }
}

if (require.main === module) main();

module.exports = { createPrng, createDeterministicBuffer, runCapabilityMatrixProbe, runSeededPrngProbe };
