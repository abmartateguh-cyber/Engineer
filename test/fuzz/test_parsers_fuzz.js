/**
 * Deterministic malformed-input smoke checks (not a production fuzzing campaign)
 *
 * Exercises deterministic malformed, truncated, out-of-bounds, and adversarial inputs across:
 *   1. ISO 10303-21 STEP Parser (StepTranslator)
 *   2. GDSII Stream Engine (GdsiiStreamEngine.readGdsii)
 *   3. SEMI P39 OASIS Binary Stream Engine (OasisStreamEngine)
 *   4. OmniArchive (.omni) Container & AES-256 Vault (OmniVaultAES256)
 *   5. Partial SystemVerilog declaration inspector (SystemVerilogSynthesizer)
 *   6. Security IPC Gateway Validator (IPCValidator)
 *
 * Every malformed-input gate asserts, per vector, that the parser either
 * throws a standard Error or returns a documented structured-failure result —
 * a parser that silently succeeds on malformed input fails the gate.
 * The filtered subset for each parser is documented inline in the gate.
 * This smoke suite does not prove full file-standard conformance or that the
 * parsers are free from leaks.
 *
 * Iteration budget (FUZZ_ITERATIONS):
 *   - Integrated smoke default: 50 iterations per iteration-counted gate, so
 *     the Root suite's fuzz section completes in under 3 seconds.
 *   - Override via env: FUZZ_ITERATIONS=5000 (deep campaign) or FUZZ_DEEP=1
 *     (equivalent to 2000). Same seed + same iteration count => identical
 *     replay; every vector is drawn from a fixed-seed PRNG (no Math.random).
 *
 * Gate 4 mode split (documented, not a silent weakening):
 *   - Smoke mode always runs the cheap structural rejection vectors (vault
 *     truncation / bad-magic headers, which throw before PBKDF2 derivation,
 *     plus the OmniArchive container vectors).
 *   - The full AES-256-GCM tamper vectors require real PBKDF2 key derivation
 *     (~100,000 iterations per call), which costs seconds per vector on this
 *     platform; they run only in deep campaigns (FUZZ_DEEP=1 or
 *     FUZZ_ITERATIONS > 500), which the scripts/run_fuzz_campaign.js runner
 *     activates.
 */

'use strict';

const assert = require('assert');
const path = require('path');

const { StepTranslator } = require('../../src/core/cad/step_translator');
const { GdsiiStreamEngine, GdsRecordType, GdsLibrary } = require('../../src/core/eda/gdsii_stream');
const { OasisStreamEngine } = require('../../src/core/eda/oasis_stream_engine');
const { OmniArchive, OmniVaultAES256 } = require('../../src/core/storage/omni_archive');
const { SystemVerilogSynthesizer } = require('../../src/core/eda/system_verilog_synth');
const { IPCValidator } = require('../../src/core/security/ipc_validator');

const FUZZ_ITERATIONS = Number(process.env.FUZZ_ITERATIONS) || (process.env.FUZZ_DEEP ? 2000 : 50);

const DEEP_VAULT_VECTORS = !!process.env.FUZZ_DEEP || FUZZ_ITERATIONS > 500;
const ARCHIVE_ITERATIONS = Math.max(40, Math.min(500, Math.floor(FUZZ_ITERATIONS / 4)));

// Pseudo-random deterministic generator for repeatable fuzz campaigns
function createPrng(seed = 0x1337c0de) {
  let s = seed;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function createDeterministicBuffer(prng, length) {
  if (typeof prng !== 'function') throw new TypeError('A seeded PRNG is required.');
  if (!Number.isSafeInteger(length) || length < 0)
    throw new RangeError('Buffer length must be a non-negative safe integer.');

  const bytes = Buffer.alloc(length);
  for (let index = 0; index < length; index++) {
    bytes[index] = Math.floor(prng() * 256);
  }
  return bytes;
}

/**
 * Asserts that a parser invocation either throws a standard Error or returns a
 * structured failure result — it must never silently succeed on malformed input.
 *
 * @param {Function} fn        Parser invocation closure.
 * @param {string}   label     Human-readable parser label for failure messages.
 * @param {Function} [isStructuredFailure] Predicate recognizing an acceptable
 *   non-throwing failure result (e.g., an incomplete/empty parse with no
 *   fabricated records). Defaults to rejecting any non-throwing outcome.
 */
function throwsOrRejects(fn, label, isStructuredFailure) {
  let outcome;
  try {
    outcome = fn();
  } catch (err) {
    assert(err instanceof Error, `${label} threw a non-standard Error: ${String(err)}`);
    return;
  }
  const structuredFailure = isStructuredFailure ? isStructuredFailure(outcome) : false;
  assert(
    structuredFailure,
    `${label} silently succeeded on malformed input (no exception and no structured failure result)`
  );
}

function runParserFuzzTests(options) {
  const opts = options || {};
  const shard = Number.isSafeInteger(opts.shard) ? opts.shard : 0;
  const shards = Number.isSafeInteger(opts.shards) && opts.shards >= 1 ? opts.shards : 1;
  const baseSeed = Number.isFinite(opts.seed) ? opts.seed : 0xace12345;
  const quiet = !!opts.quiet;

  // Every shard gets its own deterministic PRNG stream derived from the shared
  // campaign seed, so a (seed, shard) pair replays identically. With a single
  // shard, the stream is exactly the legacy fixed seed (byte-for-byte replay).
  const prngSeed = ((baseSeed >>> 0) ^ (shards > 1 ? (shard * 0x9e3779b9) >>> 0 : 0)) >>> 0;
  const prng = createPrng(prngSeed);

  // Deterministic partition: iteration i of every gate belongs to shard
  // (i % shards). Each shard therefore runs an independent, disjoint job.
  const belongsToShard = (i) => shards <= 1 || i % shards === shard;

  if (!quiet) {
    console.log('\n================================================================');
    console.log('   RUNNING DETERMINISTIC PARSER SMOKE CHECKS                    ');
    console.log(`   Shard ${shard}/${shards} | seed 0x${baseSeed.toString(16)}`);
    console.log('================================================================\n');
  }

  let passed = 0;
  let total = 0;

  function runFuzzGate(name, fn) {
    total++;
    try {
      fn();
      passed++;
      if (!quiet) console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  runFuzzGate('[FUZZ-0] seeded byte generation is reproducible', () => {
    const seed = 0x5eed1234;
    const first = createDeterministicBuffer(createPrng(seed), 256);
    const replay = createDeterministicBuffer(createPrng(seed), 256);
    const differentSeed = createDeterministicBuffer(createPrng(seed + 1), 256);
    assert.deepStrictEqual(first, replay);
    assert.notDeepStrictEqual(first, differentSeed);
  });

  // ----------------------------------------------------------------
  // Gate 1: ISO 10303-21 STEP Parser Fuzzing (2,000 mutations)
  //
  // Documented malformed-input vectors:
  //   0. Truncation of a valid STEP stream at a random offset.
  //   1. Character replacement / bit-flip corruption of the valid stream.
  //   2. Unclosed entity records (never terminated by an ENDSEC section).
  //   3. Entities with out-of-range IDs and non-finite coordinate literals.
  //   4. Pure random ASCII garbage.
  //
  // StepTranslator.parseSTEP is a lenient extractor with no failure channel,
  // so the structured-failure contract here is grounded extraction:
  //   - any thrown value must be a standard Error;
  //   - a returned result must expose the documented extractor shape, keep
  //     summary counters as non-negative integers, contain only entity ids
  //     that actually exist in the input, and must NOT fabricate entities
  //     when no complete DATA...ENDSEC section is present.
  // ----------------------------------------------------------------
  runFuzzGate(`[FUZZ-1] STEP CAD Parser (${FUZZ_ITERATIONS} Malformed & Truncated Streams)...`, () => {
    const baseValidStep = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Test Model'), '2;1');
FILE_NAME('test.step', '2026-10-19', ('Tester'), ('OmniEng'), '', '', '');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1=CARTESIAN_POINT('P1', (10.0, 20.0, 30.0));
#2=DIRECTION('D1', (0.0, 0.0, 1.0));
#3=MANIFOLD_SOLID_BREP('Solid1', #1);
ENDSEC;
END-ISO-10303-21;`;

    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      if (!belongsToShard(i)) continue;
      let candidate;
      const strategy = i % 5;
      if (strategy === 0) {
        // Truncate at random index
        const cut = Math.floor(prng() * baseValidStep.length);
        candidate = baseValidStep.slice(0, cut);
      } else if (strategy === 1) {
        // Bit flip / character replacement
        const chars = baseValidStep.split('');
        const mutations = Math.floor(prng() * 15) + 1;
        for (let m = 0; m < mutations; m++) {
          const idx = Math.floor(prng() * chars.length);
          chars[idx] = String.fromCharCode(Math.floor(prng() * 128));
        }
        candidate = chars.join('');
      } else if (strategy === 2) {
        // Massive unclosed entities
        candidate = 'ISO-10303-21; DATA;\n' + '#1=CARTESIAN_POINT(' + '('.repeat(i % 50) + '1.0, 2.0, 3.0';
      } else if (strategy === 3) {
        // Non-string or extreme length
        candidate = 'DATA;\n' + "#999999999999999=CARTESIAN_POINT('', (NaN, Infinity, -0.0));\nENDSEC;";
      } else {
        // Pure random ASCII garbage
        const len = Math.floor(prng() * 256) + 1;
        candidate = Buffer.from(Array.from({ length: len }, () => Math.floor(prng() * 256))).toString('ascii');
      }

      throwsOrRejects(
        () => StepTranslator.parseSTEP(candidate),
        'StepTranslator.parseSTEP',
        (res) => {
          if (!res || typeof res !== 'object' || !res.entities || !res.summary) return false;
          const summaryValues = Object.values(res.summary);
          if (!summaryValues.every((value) => Number.isInteger(value) && value >= 0)) return false;
          const inputEntityIds = new Set([...candidate.matchAll(/#\s*(\d+)\s*=/g)].map((m) => m[1]));
          for (const id of Object.keys(res.entities)) {
            if (!inputEntityIds.has(id.replace(/^#/, ''))) return false;
          }
          // A stream without a complete DATA...ENDSEC section must yield no entities.
          if (!/ENDSEC\s*;/i.test(candidate) && Object.keys(res.entities).length > 0) return false;
          return true;
        }
      );
    }
  });

  // ----------------------------------------------------------------
  // Gate 2: GDSII Stream Binary Fuzzing (2,000 corrupt records)
  //
  // Documented malformed-input vectors:
  //   0. Seeded pseudo-random binary buffers of 0..127 bytes.
  //   1. GDSII headers declaring invalid record lengths (0, 1, 2, 3, huge).
  //   2. Valid header followed by a truncated record payload.
  //   3. Unknown record types interleaved with ENDLIB.
  //
  // GdsiiStreamEngine.readGdsii is the real deserializer (the legacy
  // `deserialize` alias does not exist). Structured-failure contract: either
  // throw a standard Error or return a GdsLibrary that parsed zero structures —
  // a library that fabricates structures from malformed input fails the gate.
  // ----------------------------------------------------------------
  runFuzzGate(`[FUZZ-2] GDSII Stream Engine (${FUZZ_ITERATIONS} Binary Corruption Vectors)...`, () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      if (!belongsToShard(i)) continue;
      let buf;
      const strategy = i % 4;
      if (strategy === 0) {
        // Seeded pseudo-random binary buffer 0 to 128 bytes
        const len = Math.floor(prng() * 128);
        buf = createDeterministicBuffer(prng, len);
      } else if (strategy === 1) {
        // GDSII header with invalid declared record lengths (huge, negative, 0)
        buf = Buffer.alloc(32);
        const badLen = [0, 1, 2, 3, 0xffff, 0x7fff][i % 6];
        buf.writeUInt16BE(badLen, 0);
        buf.writeUInt16BE(GdsRecordType.HEADER, 2);
      } else if (strategy === 2) {
        // Valid header followed by truncated record payload
        buf = Buffer.from([
          0x00,
          0x06,
          0x00,
          0x02,
          0x02,
          0x58, // HEADER
          0x00,
          0x1c,
          0x01,
          0x02, // BGNLIB declared 28 bytes, but only 4 provided
          0x00,
          0x00
        ]);
      } else {
        // Endless loop attempt with unknown record types
        buf = Buffer.alloc(64);
        buf.writeUInt16BE(4, 0);
        buf.writeUInt16BE(0xffee, 2); // Unknown record
        buf.writeUInt16BE(4, 4);
        buf.writeUInt16BE(GdsRecordType.ENDLIB, 6);
      }

      throwsOrRejects(
        () => GdsiiStreamEngine.readGdsii(buf),
        'GdsiiStreamEngine.readGdsii',
        (lib) => lib instanceof GdsLibrary && lib.structures.size === 0
      );
    }
  });

  // ----------------------------------------------------------------
  // Gate 3: SEMI P39 OASIS Stream Fuzzing (2,000 malformed inputs)
  //
  // Documented malformed-input vectors:
  //   0. Seeded pseudo-random buffers smaller than the 13-byte magic header.
  //   1. Valid magic header followed by a vint overflow stream (15 continuation bytes).
  //   2. Valid magic header followed by an unknown/corrupt record type.
  //   3. Valid magic header followed by a RECTANGLE record before any CELL record.
  //
  // OasisStreamEngine.deserialize must throw a standard Error on each of these;
  // silently returning a layout (e.g., fabricating a cell from truncated
  // payload bytes) fails the gate.
  // ----------------------------------------------------------------
  runFuzzGate(`[FUZZ-3] SEMI P39 OASIS Stream (${FUZZ_ITERATIONS} Vint & Modal State Vectors)...`, () => {
    const engine = new OasisStreamEngine();
    const validMagic = [0x25, 0x53, 0x45, 0x4d, 0x49, 0x2d, 0x4f, 0x41, 0x53, 0x49, 0x53, 0x0d, 0x0a];

    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      if (!belongsToShard(i)) continue;
      let buf;
      const strategy = i % 4;
      if (strategy === 0) {
        // Seeded pseudo-random buffer smaller than magic header
        const len = Math.floor(prng() * 11);
        buf = createDeterministicBuffer(prng, len);
      } else if (strategy === 1) {
        // Valid magic header followed by vint overflow (continuous 0x80+ bytes)
        const overflowVint = Array(15).fill(0xff);
        buf = Buffer.from([...validMagic, 1, ...overflowVint]);
      } else if (strategy === 2) {
        // Valid magic header followed by corrupt record type
        buf = Buffer.from([...validMagic, 0x7e, 0x01, 0x02]);
      } else {
        // Valid magic header followed by a RECTANGLE record before any CELL record
        buf = Buffer.from([...validMagic, 20, 0x01]);
      }

      throwsOrRejects(() => engine.deserialize(buf), 'OasisStreamEngine.deserialize');
    }
  });

  // ----------------------------------------------------------------
  // Gate 4: OmniArchive & AES-256 Vault Fuzzing
  //
  // Mode split (documented in the file header):
  //   - Always: vault structural rejection vectors (truncation < 52 bytes and
  //     bad-magic headers) that throw BEFORE PBKDF2 key derivation, plus the
  //     OmniArchive container vectors (count scales with the iteration budget).
  //   - Deep campaigns only (FUZZ_DEEP=1 or FUZZ_ITERATIONS > 500): the full
  //     AES-256-GCM tamper vectors, which require real PBKDF2 key derivation
  //     (~100,000 iterations per call) and cost seconds per vector.
  // ----------------------------------------------------------------
  runFuzzGate(
    `[FUZZ-4] OmniArchive & AES-256-GCM Vault (Corrupt Payloads & Tags)${DEEP_VAULT_VECTORS ? ' [deep]' : ' [smoke]'}...`,
    () => {
      // 1. Vault structural rejection: corrupt containers must be rejected
      //    before any cryptographic key derivation work is performed.
      for (let i = 0; i < FUZZ_ITERATIONS; i++) {
        if (!belongsToShard(i)) continue;
        let corruptEncrypted;
        if (i % 2 === 0) {
          // Truncated container (< 52-byte cryptographic header)
          corruptEncrypted = createDeterministicBuffer(prng, i % 52);
        } else {
          // Full-size container with a non-vault magic prefix
          corruptEncrypted = createDeterministicBuffer(prng, 52 + (i % 128));
          corruptEncrypted.fill(0x00, 0, 8);
        }

        assert.throws(() => {
          OmniVaultAES256.decrypt(corruptEncrypted, 'StrongPassword2026!');
        }, /(Corrupt|Invalid)/i);
      }

      // 2. Full AES-256-GCM tamper vectors (deep campaigns only): each vector
      //    exercises the production PBKDF2 + GCM failure path. SKIPPED in the
      //    integrated smoke because one key derivation costs seconds.
      if (DEEP_VAULT_VECTORS) {
        const samplePayload = Buffer.from(JSON.stringify({ component: 'Turbine', rpm: 12000 }), 'utf8');
        const validEncrypted = OmniVaultAES256.encrypt(samplePayload, 'StrongPassword2026!');

        for (let i = 0; i < 20; i++) {
          if (!belongsToShard(i)) continue;
          let corruptEncrypted;
          const strategy = i % 5;
          if (strategy === 0) {
            const len = Math.floor(prng() * 50);
            corruptEncrypted = validEncrypted.subarray(0, len);
          } else if (strategy === 1) {
            corruptEncrypted = Buffer.from(validEncrypted);
            const tagOffset = corruptEncrypted.length - 1 - (i % 16);
            corruptEncrypted[tagOffset] ^= 0x55;
          } else if (strategy === 2) {
            corruptEncrypted = Buffer.from(validEncrypted);
            corruptEncrypted[0] = 0x00;
          } else if (strategy === 3) {
            corruptEncrypted = Buffer.from(validEncrypted);
            const bodyOffset = 52 + (i % Math.max(1, corruptEncrypted.length - 52));
            corruptEncrypted[bodyOffset] ^= 0xaa;
          } else {
            corruptEncrypted = createDeterministicBuffer(prng, 64);
          }

          assert.throws(() => {
            OmniVaultAES256.decrypt(corruptEncrypted, 'StrongPassword2026!');
          }, /(Decryption Failed|Corrupt|Invalid|unsupported)/i);
        }
      }

      // 3. OmniArchive Container Decompression & CRC Fuzzing (${ARCHIVE_ITERATIONS} iterations)
      const baseArchive = new OmniArchive({ projectName: 'FuzzArchive' });
      baseArchive.addSection('geometry', { mesh: 'TET10_Mesh', nodes: 500 });
      const validArchiveBuf = baseArchive.saveToBuffer();

      for (let i = 0; i < ARCHIVE_ITERATIONS; i++) {
        if (!belongsToShard(i)) continue;
        let corruptArchive;
        const strat = i % 4;
        if (strat === 0) {
          // Truncated buffer
          const len = Math.floor(prng() * Math.max(1, validArchiveBuf.length - 1));
          corruptArchive = validArchiveBuf.subarray(0, len);
        } else if (strat === 1) {
          // Corrupt magic header
          corruptArchive = Buffer.from(validArchiveBuf);
          corruptArchive[0] ^= 0x55;
        } else if (strat === 2) {
          // Corrupt payload byte to trigger CRC checksum failure
          corruptArchive = Buffer.from(validArchiveBuf);
          corruptArchive[corruptArchive.length - 1] ^= 0xff;
        } else {
          // Seeded pseudo-random bytes
          corruptArchive = createDeterministicBuffer(prng, Math.floor(prng() * 40) + 1);
        }

        assert.throws(() => {
          OmniArchive.loadFromBuffer(corruptArchive);
        }, /(Invalid|Malformed|corruption|magic header|too small|Decompression bomb|Security Violation)/i);
      }
    }
  );

  // ----------------------------------------------------------------
  // Gate 5: Partial SystemVerilog declaration inspector fuzzing (2,000 malformed inputs)
  //
  // Documented malformed-input vectors:
  //   0. Fragments with a module declaration but missing endmodule/opening statements.
  //   1. Random syntax inserted into the `clk` port declaration.
  //   2. Extreme module identifier lengths (up to 1,000 chars).
  //   3. Empty or whitespace-only source (must throw: no module declaration).
  //
  // SystemVerilogSynthesizer is a partial inspector, so the structured-failure
  // contract is: either throw a standard Error, or return the documented
  // partial-analysis object that (a) names the module actually declared in the
  // source and (b) reports analysis/technology mapping as unavailable — the
  // inspector must never fabricate a "ready" synthesis verdict from malformed
  // source.
  // ----------------------------------------------------------------
  runFuzzGate(`[FUZZ-5] SystemVerilog declaration inspector (${FUZZ_ITERATIONS} corrupted inputs)...`, () => {
    const synth = new SystemVerilogSynthesizer();
    const fragments = [
      'module test (input clk, output reg q);',
      'always_ff @(posedge clk) q <= ~q;',
      'assign out = a & b | (c ^ d);',
      'parameter WIDTH = 32;',
      'endmodule'
    ];

    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      if (!belongsToShard(i)) continue;
      let code;
      const strategy = i % 4;
      if (strategy === 0) {
        // Missing endmodule or opening
        code = fragments.slice(0, 1 + (i % (fragments.length - 1))).join('\n');
      } else if (strategy === 1) {
        // Random syntax insertion
        code = fragments.join('\n').replace('clk', 'clk @@ $$ && ' + String(i));
      } else if (strategy === 2) {
        // Extreme identifier length
        code = `module ${'A'.repeat((i % 1000) + 1)} (input clk); endmodule`;
      } else {
        // Empty or whitespace only
        code = ' '.repeat(i % 50);
      }

      throwsOrRejects(
        () => synth.synthesize(code),
        'SystemVerilogSynthesizer.synthesize',
        (res) => {
          if (!res || typeof res !== 'object') return false;
          if (typeof res.moduleName !== 'string' || res.moduleName.length === 0) return false;
          if (res.analysisStatus !== 'experimental-partial') return false;
          if (!res.technologyMapping || res.technologyMapping.status !== 'unavailable') return false;
          return true;
        }
      );
    }
  });

  // ----------------------------------------------------------------
  // Gate 6: Security IPC Gateway Validator Fuzzing (2,000 attack payloads)
  // ----------------------------------------------------------------
  runFuzzGate(`[FUZZ-6] Security IPC Validator (${FUZZ_ITERATIONS} Prototype Pollution & Path Vectors)...`, () => {
    assert.throws(() => IPCValidator.sanitizePath('model.step', ''), /allowed path root is required/);

    const traversalCases = [
      { targetPath: '../../etc/passwd', outside: true },
      { targetPath: '..\\..\\windows\\system32', outside: path.sep === '\\' },
      { targetPath: '/root/secret', outside: true },
      { targetPath: 'subdir/../../../escape', outside: true },
      { targetPath: '../project-evil/escape.step', outside: true },
      { targetPath: 'valid/path/file.step', outside: false },
      { targetPath: '....//....//etc', outside: false },
      { targetPath: '%2e%2e%2f', outside: false }
    ];
    const baseDir = '/workspace/project';
    const keys = ['__proto__', 'constructor', 'prototype', '__defineGetter__', 'validKey'];
    const numValues = [NaN, Infinity, -Infinity, 42, -3.14159, '100', null, undefined];

    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      if (!belongsToShard(i)) continue;
      // 1. Prototype Pollution Vectors
      const pollutedObj = {};
      pollutedObj[keys[i % keys.length]] = {
        hacked: true,
        evilVal: 1234,
        nested: { [keys[(i + 1) % keys.length]]: 'exploit' }
      };

      const sanitized = IPCValidator.sanitize(pollutedObj);
      assert.strictEqual(Object.prototype.hacked, undefined, 'Object.prototype must never be polluted');
      assert.strictEqual(sanitized.__proto__, Object.prototype);

      // 2. Path Traversal Traps
      const { targetPath, outside } = traversalCases[i % traversalCases.length];

      if (outside) {
        assert.throws(() => {
          IPCValidator.sanitizePath(targetPath, baseDir);
        }, /Path traversal attempt/);
      } else {
        const safe = IPCValidator.sanitizePath(targetPath, baseDir);
        assert.strictEqual(safe, path.resolve(baseDir, targetPath));
      }

      // 3. Finite Number Traps
      const numObj = { val: numValues[i % numValues.length] };
      if (typeof numObj.val === 'number' && Number.isFinite(numObj.val)) {
        assert.strictEqual(IPCValidator.validateFiniteNumbers(numObj, ['val']), true);
      } else {
        assert.throws(() => {
          IPCValidator.validateFiniteNumbers(numObj, ['val']);
        }, /must be a finite number/);
      }
    }
  });

  if (!quiet) {
    console.log('\n================================================================');
    console.log(`  SUMMARY: ${passed} / ${total} DETERMINISTIC MALFORMED-INPUT SMOKE GATES PASSED`);
    console.log('================================================================\n');
  }

  return { total, passed, failed: total - passed, shard, shards, seed: baseSeed, prngSeed };
}

/**
 * Runs the deterministic parser fuzz harness for a single shard of the
 * campaign payload space. The payload space of every gate is partitioned by
 * iteration index: iteration i belongs to shard (i % shards). Each shard
 * draws its byte vectors from its own deterministic PRNG stream derived from
 * the shared campaign seed, so a (seed, shard) pair replays identically.
 *
 * @param {Object} options
 * @param {number} [options.shard=0]  Shard index (0-based).
 * @param {number} [options.shards=1] Total number of shards.
 * @param {number} [options.seed=0xace12345] Shared deterministic campaign seed.
 * @returns {{passed: number, failed: number, total: number, probe: number[]}}
 */
function runFuzzShard({ shard = 0, shards = 1, seed = 0xace12345 } = {}) {
  const prngSeed = ((seed >>> 0) ^ (shards > 1 ? (shard * 0x9e3779b9) >>> 0 : 0)) >>> 0;
  const probePrng = createPrng(prngSeed);
  const probe = [probePrng(), probePrng(), probePrng()].map((v) => Math.floor(v * 4294967296));
  const stats = runParserFuzzTests({ shard, shards, seed, quiet: true });
  return Object.assign({ probe }, stats);
}

function readShardInt(argv, index, label) {
  const value = Number(argv[index]);
  if (!Number.isSafeInteger(value) || value < 0) {
    console.error(`ERROR: ${label} requires a non-negative safe integer, got "${argv[index]}".`);
    process.exit(2);
  }
  return value;
}

function readShardSeed(argv, index) {
  const value = Number(argv[index]);
  if (!Number.isFinite(value)) {
    console.error(`ERROR: --seed requires a numeric value, got "${argv[index]}".`);
    process.exit(2);
  }
  return value;
}

function parseShardArgv(argv) {
  const out = { shard: null, shards: null, seed: null, quiet: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        console.log(
          'Usage: node test/fuzz/test_parsers_fuzz.js [--shard N] [--shards N] [--seed N] [--quiet] [--json]'
        );
        process.exit(0);
        break;
      case '--shard':
        out.shard = readShardInt(argv, ++i, '--shard');
        break;
      case '--shards':
        out.shards = readShardInt(argv, ++i, '--shards');
        break;
      case '--seed':
        out.seed = readShardSeed(argv, ++i);
        break;
      case '--quiet':
        out.quiet = true;
        break;
      case '--json':
        out.json = true;
        break;
      default:
        console.error(`ERROR: unknown argument "${arg}".`);
        process.exit(2);
    }
  }
  return out;
}

if (require.main === module) {
  const args = parseShardArgv(process.argv);
  let stats;
  if (args.shard !== null || args.shards !== null || args.seed !== null) {
    stats = runFuzzShard({
      shard: args.shard !== null ? args.shard : 0,
      shards: args.shards !== null ? args.shards : 1,
      seed: args.seed !== null ? args.seed : 0xace12345
    });
  } else {
    stats = runParserFuzzTests({ quiet: args.quiet });
  }
  if (args.json) {
    console.log(
      JSON.stringify({
        passed: stats.passed,
        failed: stats.failed,
        total: stats.total,
        seed: stats.seed,
        shard: stats.shard,
        shards: stats.shards,
        probe: stats.probe
      })
    );
  }
  if (stats.failed > 0) {
    process.exit(1);
  }
}

module.exports = { runParserFuzzTests, runFuzzShard };
