'use strict';

/**
 * Verification gate for the synchronized 2-channel mill-turn program
 * generator (src/core/cam/mill_turn_sync.js).
 *
 * Verifies:
 *  1. A mixed program (5 turning ops on channel 1, 4 ops on channel 2
 *     (2 turning + 2 milling) plus a sub-spindle part handoff) emits two
 *     channel programs with balanced waiting points.
 *  2. Wait pairing: every WAIT on channel 1 maps to a WAIT on channel 2
 *     (counts equal; ordinal positions pair as {M203,M204} or {M207,M207}).
 *  3. Handoff ordering: the emitted sequence contains the 5-step handoff
 *     (M205 -> M206 -> M207 -> M208 -> M209) in the correct order, asserted
 *     by strictly increasing indices on channel 1.
 *  4. Tool-call uniqueness: each turret uses its own tool offset range
 *     (T01xx channel 1, T02xx channel 2) without collision.
 *  5. G-code syntax: every line parses under ISO 6983 block grammar
 *     (N<digits> + words made of letters + numbers).
 *  6. Determinism: repeated generation produces identical output.
 *  7. The verification gate rejects a tampered (unbalanced) program.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  MillTurnSyncGenerator,
  verifySynchronization,
  CH1_MARKER,
  CH2_MARKER,
  WAIT_CH1,
  WAIT_CH2,
  HANDOFF_CODES,
  HANDOFF_SEQUENCE,
  WAIT_CODES,
  SYNC_PAIRS,
  MAIN_ONLY_HANDOFF
} = require('../src/core/cam/mill_turn_sync');

const OPS = [
  { op: 'turn', channel: 1, tool: 1, x: 40, z: 0, feed: 0.25, rpm: 1500 },
  { op: 'turn', channel: 1, tool: 2, x: 38, z: -10, feed: 0.2, rpm: 1600 },
  { op: 'turn', channel: 1, tool: 2, x: 36, z: -20, feed: 0.18, rpm: 1700 },
  { op: 'turn', channel: 1, tool: 3, x: 34, z: -30, feed: 0.15, rpm: 1800 },
  { op: 'turn', channel: 1, tool: 3, x: 32, z: -40, feed: 0.12, rpm: 1900 },
  { op: 'turn', channel: 2, tool: 1, x: 40, z: 0, feed: 0.22, rpm: 1400 },
  { op: 'turn', channel: 2, tool: 1, x: 38, z: -8, feed: 0.2, rpm: 1500 },
  { op: 'mill', channel: 2, tool: 2, x: 10, y: 0, z: -5, width: 6, feed: 120, rpm: 3000 },
  { op: 'mill', channel: 2, tool: 3, x: 14, y: 2, z: -6, width: 4, feed: 100, rpm: 3200 }
];

function waitTokens(lines) {
  const out = [];
  for (const line of lines) {
    for (const token of line.split(/\s+/)) {
      if (WAIT_CODES.includes(token)) out.push(token);
    }
  }
  return out;
}

function toolTokens(lines) {
  const out = [];
  for (const line of lines) {
    for (const token of line.split(/\s+/)) {
      if (/^T\d{4}$/.test(token)) out.push(token);
    }
  }
  return out;
}

const BLOCK_RE = /^N(\d+)\s+(.+)$/;
const WORD_RE = /^[A-Z][+-]?\d+(\.\d+)?$/;
const INTEGER_WORD_RE = /^[MTSF]\d+$/;

function grammarViolations(lines) {
  const violations = [];
  lines.forEach((line, idx) => {
    const m = BLOCK_RE.exec(line);
    if (!m) {
      violations.push(`line ${idx}: not N<digits> <words>: "${line}"`);
      return;
    }
    for (const word of m[2].trim().split(/\s+/)) {
      if (word.length === 0) {
        violations.push(`line ${idx}: empty word in "${line}"`);
      } else if (!INTEGER_WORD_RE.test(word) && !WORD_RE.test(word)) {
        violations.push(`line ${idx}: invalid word "${word}" in "${line}"`);
      }
    }
  });
  return violations;
}

describe('mill-turn synchronized 2-channel generator', () => {
  const gen = new MillTurnSyncGenerator({ programId: 'OP-GATE-40' });
  const result = gen.generate(OPS);

  it('emits both channel programs with balanced waiting points', () => {
    assert.ok(Array.isArray(result.channel1) && result.channel1.length > 0);
    assert.ok(Array.isArray(result.channel2) && result.channel2.length > 0);
    assert.ok(
      result.channel1.some((l) => l.includes(CH1_MARKER)),
      'channel 1 marker O1001 present'
    );
    assert.ok(
      result.channel2.some((l) => l.includes(CH2_MARKER)),
      'channel 2 marker O2001 present'
    );
    assert.equal(result.summary.turnsChannel1, 5);
    assert.equal(result.summary.turnsChannel2, 2);
    assert.equal(result.summary.millsChannel2, 2);
    assert.equal(result.summary.drillsChannel2, 0);

    const waits1 = waitTokens(result.channel1);
    const waits2 = waitTokens(result.channel2);
    assert.ok(waits1.length >= 2, `channel 1 has ${waits1.length} WAIT(s)`);
    assert.ok(waits2.length >= 2, `channel 2 has ${waits2.length} WAIT(s)`);
    assert.equal(waits1.length, waits2.length, 'balanced wait counts');
  });

  it('wait pairing: every WAIT on channel 1 maps to a WAIT on channel 2', () => {
    const waits1 = waitTokens(result.channel1);
    const waits2 = waitTokens(result.channel2);
    assert.equal(waits1.length, waits2.length);
    for (let i = 0; i < waits1.length; i += 1) {
      const pair = `${waits1[i]}|${waits2[i]}`;
      assert.ok(SYNC_PAIRS.has(pair), `ordinal wait pair ${i}: ${pair}`);
    }
    assert.ok(waits1.includes(WAIT_CH1), 'channel 1 rendezvous M203 present');
    assert.ok(waits2.includes(WAIT_CH2), 'channel 2 rendezvous M204 present');
    assert.ok(waits1.includes(HANDOFF_CODES.TRANSFER_WAIT), 'channel 1 transfer wait M207 present');
    assert.ok(waits2.includes(HANDOFF_CODES.TRANSFER_WAIT), 'channel 2 transfer wait M207 present');
  });

  it('handoff ordering: 5-step sequence appears in correct order on channel 1', () => {
    const tokens = result.channel1.join(' ').split(/\s+/);
    const indices = HANDOFF_SEQUENCE.map((code) => tokens.indexOf(code));
    for (const code of HANDOFF_SEQUENCE) {
      assert.notEqual(indices[HANDOFF_SEQUENCE.indexOf(code)], -1, `${code} present`);
    }
    for (let i = 1; i < indices.length; i += 1) {
      assert.ok(
        indices[i] > indices[i - 1],
        `${HANDOFF_SEQUENCE[i - 1]} @ ${indices[i - 1]} precedes ` + `${HANDOFF_SEQUENCE[i]} @ ${indices[i]}`
      );
    }

    const ch2Tokens = result.channel2.join(' ').split(/\s+/);
    for (const code of MAIN_ONLY_HANDOFF) {
      assert.ok(!ch2Tokens.includes(code), `channel 2 must not carry main-only ${code}`);
    }
  });

  it('tool-call uniqueness: T01xx on channel 1, T02xx on channel 2, no collision', () => {
    const t1 = toolTokens(result.channel1);
    const t2 = toolTokens(result.channel2);
    assert.ok(t1.length > 0 && t2.length > 0);
    for (const t of t1) {
      assert.match(t, /^T01\d\d$/, `channel 1 tool ${t} uses T01xx range`);
    }
    for (const t of t2) {
      assert.match(t, /^T02\d\d$/, `channel 2 tool ${t} uses T02xx range`);
    }
    const s1 = new Set(t1);
    const s2 = new Set(t2);
    for (const t of s1) {
      assert.ok(!s2.has(t), `tool offset ${t} not shared across channels`);
    }
  });

  it('G-code syntax: every line parses under ISO 6983 grammar', () => {
    const all = result.channel1.concat(result.channel2);
    const violations = grammarViolations(all);
    assert.deepEqual(violations, [], `grammar violations: ${JSON.stringify(violations)}`);
  });

  it('determinism: repeated generation yields identical programs', () => {
    const second = new MillTurnSyncGenerator({ programId: 'OP-GATE-40' }).generate(OPS);
    assert.deepEqual(second.channel1, result.channel1);
    assert.deepEqual(second.channel2, result.channel2);
    assert.equal(second.program, result.program);
  });

  it('verification gate accepts the generated program', () => {
    const gate = verifySynchronization(result);
    assert.equal(gate.ok, true, `violations: ${JSON.stringify(gate.violations)}`);
    assert.deepEqual(gate.violations, []);
  });

  it('verification gate rejects an unbalanced/tampered program', () => {
    const tampered = {
      channel1: result.channel1.slice(),
      channel2: result.channel2.filter((l) => !l.includes(WAIT_CH2))
    };
    const gate = verifySynchronization(tampered);
    assert.equal(gate.ok, false);
    assert.ok(gate.violations.some((v) => v.includes('wait count imbalance')));
  });

  it('verification gate rejects handoff ordering violations', () => {
    const tokens = result.channel1.join(' ').split(/\s+/);
    const i205 = tokens.indexOf(HANDOFF_CODES.MAIN_CHUCK_CLOSE);
    const i206 = tokens.indexOf(HANDOFF_CODES.SUB_CHUCK_OPEN);
    tokens[i205] = HANDOFF_CODES.SUB_CHUCK_OPEN;
    tokens[i206] = HANDOFF_CODES.MAIN_CHUCK_CLOSE;
    const tampered = {
      channel1: [tokens.join(' ')],
      channel2: result.channel2.slice()
    };
    const gate = verifySynchronization(tampered);
    assert.equal(gate.ok, false);
    assert.ok(gate.violations.some((v) => v.includes('handoff ordering violated')));
  });

  it('rejects malformed operation input', () => {
    assert.throws(() => gen.generate('nope'), TypeError);
    assert.throws(() => gen.generate([{ op: 'bogus', channel: 1, tool: 1 }]), TypeError);
    assert.throws(() => gen.generate([{ op: 'turn', channel: 3, tool: 1 }]), TypeError);
    assert.throws(() => gen.generate([{ op: 'turn', channel: 1, tool: 0 }]), TypeError);
    assert.throws(() => gen.generate([{ op: 'turn', channel: 1, tool: 1, feed: -1 }]), TypeError);
  });
});
