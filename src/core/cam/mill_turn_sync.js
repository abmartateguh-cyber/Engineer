'use strict';

/**
 * OmniEng synchronized 2-channel mill-turn machine program generator.
 *
 * Models a twin-spindle lathe with live tooling:
 *   - channel 1: main spindle + turret (live tool positions, T01xx offsets)
 *   - channel 2: sub-spindle + turret (live tool positions, T02xx offsets)
 *
 * Emits two ISO 6983 channel programs that are synchronized via documented
 * wait / sync conventions:
 *
 *   Channel markers
 *     O1001  main channel program header (channel 1)
 *     O2001  sub channel program header (channel 2)
 *
 *   Wait / rendezvous codes
 *     M203   WAIT on channel 1 (main): pauses until channel 2 reaches its
 *            matching M204 rendezvous.
 *     M204   WAIT on channel 2 (sub): mirrors M203 (same logical step index).
 *     M207   TRANSFER wait: part handoff hard rendezvous, emitted on both
 *            channels (self-pairing wait).
 *
 *   Sub-spindle part handoff protocol (inline, ordered):
 *     M205   main chuck CLOSE (clamps part)
 *     M206   sub chuck OPEN (prepares to receive)
 *     M207   transfer (wait code - hard rendezvous)
 *     M208   main chuck OPEN (releases part)
 *     M209   main turret retract (main steps back; sub continues)
 *
 *   The handoff protocol is emitted on channel 1 in the exact order above;
 *   channel 2 receives M206/M207 (sub-side actions) so both sides take part
 *   in the coordinated transfer.
 *
 * Verification gate: `verifySynchronization` checks
 *   1. wait pairing: every WAIT on channel 1 has a counterpart on channel 2
 *      (counts equal; ordinal wait positions pair as {M203,M204} or
 *      {M207,M207});
 *   2. handoff ordering: M205 -> M206 -> M207 -> M208 -> M209 indices are
 *      strictly increasing on channel 1;
 *   3. tool-call uniqueness: channel 1 only uses T01xx offsets, channel 2
 *      only T02xx; the offset sets are disjoint;
 *   4. ISO 6983 block grammar on every emitted line
 *      (`N<digits> <words>`, word = `[A-Z][+-]?<number>` or M/T/S/F
 *      integer). No comments, no empty words.
 *
 * Dependency-free and deterministic: no randomness, no unordered object
 * iteration, input operation order is preserved.
 */

const CH1_MARKER = 'O1001';
const CH2_MARKER = 'O2001';
const WAIT_CH1 = 'M203';
const WAIT_CH2 = 'M204';

const HANDOFF_CODES = Object.freeze({
  MAIN_CHUCK_CLOSE: 'M205',
  SUB_CHUCK_OPEN: 'M206',
  TRANSFER_WAIT: 'M207',
  MAIN_CHUCK_OPEN: 'M208',
  MAIN_RETRACT: 'M209'
});

const HANDOFF_SEQUENCE = Object.freeze([
  HANDOFF_CODES.MAIN_CHUCK_CLOSE,
  HANDOFF_CODES.SUB_CHUCK_OPEN,
  HANDOFF_CODES.TRANSFER_WAIT,
  HANDOFF_CODES.MAIN_CHUCK_OPEN,
  HANDOFF_CODES.MAIN_RETRACT
]);

const WAIT_CODES = Object.freeze([WAIT_CH1, WAIT_CH2, HANDOFF_CODES.TRANSFER_WAIT]);

const MAIN_ONLY_HANDOFF = Object.freeze([HANDOFF_SEQUENCE[0], HANDOFF_SEQUENCE[3], HANDOFF_SEQUENCE[4]]);

const SYNC_PAIRS = Object.freeze(
  new Set([
    `${WAIT_CH1}|${WAIT_CH2}`,
    `${WAIT_CH2}|${WAIT_CH1}`,
    `${HANDOFF_CODES.TRANSFER_WAIT}|${HANDOFF_CODES.TRANSFER_WAIT}`
  ])
);

const OP_TYPES = Object.freeze(['turn', 'drill', 'mill']);

const BLOCK_RE = /^N(\d+)\s+(.+)$/;
const WORD_RE = /^[A-Z][+-]?\d+(\.\d+)?$/;
const INTEGER_WORD_RE = /^[MTSF]\d+$/;
const TOOL_RE = /^T(\d{2})(\d{2})$/;

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new TypeError(`non-finite numeric word: ${value}`);
  }
  return String(Math.round(n * 1000) / 1000);
}

function toolWord(channel, slot, options) {
  const prefix = channel === 1 ? '01' : '02';
  return `T${prefix}${String(slot).padStart(2, '0')}`;
}

function sequenceLine(n) {
  return `N${n}`;
}

class MillTurnSyncGenerator {
  /**
   * @param {Object} [options]
   * @param {string} [options.programId='OP1000'] unused program identifier
   * @param {number} [options.sequenceStart=1] first N number (>= 1)
   * @param {number} [options.sequenceIncrement=10] N step (1..10)
   * @param {boolean} [options.handoff=true] emit sub-spindle part handoff
   * @param {boolean} [options.syncWait=true] emit M203/M204 pre-handoff
   *   rendezvous wait pair
   */
  constructor(options = {}) {
    const opts = options || {};
    this.programId = opts.programId || 'OP1000';
    this.sequenceStart = opts.sequenceStart === undefined ? 1 : Number(opts.sequenceStart);
    this.sequenceIncrement = opts.sequenceIncrement === undefined ? 10 : Number(opts.sequenceIncrement);
    this.handoff = opts.handoff === undefined ? true : !!opts.handoff;
    this.syncWait = opts.syncWait === undefined ? true : !!opts.syncWait;
    if (this.sequenceStart < 1) throw new TypeError('sequenceStart must be >= 1');
    if (this.sequenceIncrement < 1 || this.sequenceIncrement > 10) {
      throw new TypeError('sequenceIncrement must be in 1..10');
    }
  }

  /**
   * @param {Array<Object>} operations ops in execution order; each op:
   *   { op: 'turn'|'drill'|'mill', channel: 1|2, tool: 1..9,
   *     x, z, y, diameter, length, depth, r, q, feed, rpm, ... }
   * @returns {{ channel1: string[], channel2: string[], program: string,
   *             summary: Object }}
   */
  generate(operations) {
    if (!Array.isArray(operations)) throw new TypeError('operations must be an array');
    const ch1Ops = [];
    const ch2Ops = [];
    for (const op of operations) {
      this._validateOp(op);
      if (op.channel === 1) ch1Ops.push(op);
      else ch2Ops.push(op);
    }
    const channel1 = this._emitChannel(1, ch1Ops);
    const channel2 = this._emitChannel(2, ch2Ops);
    const lines = channel1.concat([], channel2);
    return {
      channel1,
      channel2,
      program: lines.join('\n'),
      summary: {
        programId: this.programId,
        handoff: this.handoff,
        syncWait: this.syncWait,
        opsChannel1: ch1Ops.length,
        opsChannel2: ch2Ops.length,
        turnsChannel1: ch1Ops.filter((o) => o.op === 'turn').length,
        turnsChannel2: ch2Ops.filter((o) => o.op === 'turn').length,
        millsChannel2: ch2Ops.filter((o) => o.op === 'mill').length,
        drillsChannel2: ch2Ops.filter((o) => o.op === 'drill').length,
        waitChannel1: channel1.filter((l) => WAIT_CODES.some((w) => l.includes(w))).length,
        waitChannel2: channel2.filter((l) => WAIT_CODES.some((w) => l.includes(w))).length
      }
    };
  }

  _validateOp(op) {
    if (!op || typeof op !== 'object') throw new TypeError('operation must be an object');
    if (!OP_TYPES.includes(op.op)) throw new TypeError(`op must be one of ${OP_TYPES.join(', ')}`);
    if (op.channel !== 1 && op.channel !== 2) throw new TypeError('channel must be 1 or 2');
    const tool = Number(op.tool);
    if (!Number.isInteger(tool) || tool < 1 || tool > 99) throw new TypeError('tool must be an integer in 1..99');
  }

  _emitChannel(channel, ops) {
    const lines = [];
    const step = this.sequenceIncrement;
    let n = this.sequenceStart;

    const push = (words) => {
      lines.push(`${sequenceLine(n)} ${words}`);
      n += step;
    };

    push(channel === 1 ? CH1_MARKER : CH2_MARKER);
    push('G18 G90 G21 G95');

    let activeTool = null;
    let spindleOn = false;

    for (const op of ops) {
      const word = toolWord(channel, op.tool);
      if (word !== activeTool) {
        push(word);
        activeTool = word;
      }
      if (!spindleOn) {
        const rpm = Number(op.rpm) || 1200;
        push(`G97 S${formatNumber(rpm)} M03`);
        spindleOn = true;
      }
      this._emitOp(lines, push, channel, op);
    }

    if (this.syncWait) {
      push(channel === 1 ? WAIT_CH1 : WAIT_CH2);
    }

    if (this.handoff) {
      if (channel === 1) {
        push(HANDOFF_CODES.MAIN_CHUCK_CLOSE);
        push(HANDOFF_CODES.SUB_CHUCK_OPEN);
        push(HANDOFF_CODES.TRANSFER_WAIT);
        push(HANDOFF_CODES.MAIN_CHUCK_OPEN);
        push(HANDOFF_CODES.MAIN_RETRACT);
      } else {
        push(HANDOFF_CODES.SUB_CHUCK_OPEN);
        push(HANDOFF_CODES.TRANSFER_WAIT);
      }
    }

    push('M05 M09 M30');
    return lines;
  }

  _emitOp(lines, push, channel, op) {
    const feed = Number(op.feed);
    if (!Number.isFinite(feed) || feed <= 0) throw new TypeError('feed must be a positive number');
    if (op.op === 'turn') {
      const x = Number(op.x);
      const z = Number(op.z);
      push(`G00 X${formatNumber(x + 2)} Z${formatNumber(z + 5)}`);
      push(`G01 X${formatNumber(x)} Z${formatNumber(z)} F${formatNumber(feed)}`);
      return;
    }
    if (op.op === 'drill') {
      const x = Number(op.x);
      const z = Number(op.z);
      const r = Number(op.r) || 3;
      const q = Number(op.q) || 2;
      push(`G00 X${formatNumber(x)} Z${formatNumber(r)}`);
      push(
        `G83 X${formatNumber(x)} Z${formatNumber(z)} R${formatNumber(r)} Q${formatNumber(q)} F${formatNumber(feed)}`
      );
      push('G80');
      return;
    }
    if (op.op === 'mill') {
      const x = Number(op.x);
      const y = Number(op.y);
      const z = Number(op.z);
      const width = Number(op.width) || 5;
      const r = Number(op.r) || 3;
      push(`G00 X${formatNumber(x)} Y${formatNumber(y)}`);
      push(`G01 Z${formatNumber(z)} F${formatNumber(feed)}`);
      push(`G01 X${formatNumber(x + width)} Y${formatNumber(y + width)} F${formatNumber(feed)}`);
      push(`G00 Z${formatNumber(r)}`);
      return;
    }
    throw new TypeError(`unsupported op: ${op.op}`);
  }
}

function grammarViolations(lines) {
  const violations = [];
  lines.forEach((line, idx) => {
    const m = BLOCK_RE.exec(line);
    if (!m) {
      violations.push(`line ${idx}: not N<digits> <words>: "${line}"`);
      return;
    }
    const words = m[2].trim().split(/\s+/);
    for (const word of words) {
      if (word.length === 0) {
        violations.push(`line ${idx}: empty word in "${line}"`);
      } else if (INTEGER_WORD_RE.test(word)) {
        // M/T/S/F must be followed by an integer
      } else if (!WORD_RE.test(word)) {
        violations.push(`line ${idx}: invalid word "${word}" in "${line}"`);
      }
    }
  });
  return violations;
}

function extractWaits(lines) {
  const waits = [];
  for (const line of lines) {
    for (const token of line.split(/\s+/)) {
      if (WAIT_CODES.includes(token)) waits.push(token);
    }
  }
  return waits;
}

/**
 * Verification gate for a generated 2-channel synchronized program.
 *
 * @param {{ channel1: string[], channel2: string[] }} program
 * @returns {{ ok: boolean, violations: string[] }}
 */
function verifySynchronization(program) {
  if (!program || !Array.isArray(program.channel1) || !Array.isArray(program.channel2)) {
    throw new TypeError('program must expose channel1/channel2 line arrays');
  }
  const violations = [];

  violations.push(...grammarViolations(program.channel1).map((v) => `channel1 ${v}`));
  violations.push(...grammarViolations(program.channel2).map((v) => `channel2 ${v}`));

  const waits1 = extractWaits(program.channel1);
  const waits2 = extractWaits(program.channel2);

  if (waits1.length !== waits2.length) {
    violations.push(`wait count imbalance: channel1 has ${waits1.length} WAIT(s), channel2 has ${waits2.length}`);
  }
  const pairCount = Math.min(waits1.length, waits2.length);
  for (let i = 0; i < pairCount; i += 1) {
    const pair = `${waits1[i]}|${waits2[i]}`;
    if (!SYNC_PAIRS.has(pair)) {
      violations.push(`ordinal wait pair ${i} mismatched: "${waits1[i]}" vs "${waits2[i]}"`);
    }
  }

  const ch1Flat = program.channel1.join(' ');
  for (let i = 0; i < HANDOFF_SEQUENCE.length; i += 1) {
    const code = HANDOFF_SEQUENCE[i];
    if (!ch1Flat.split(/\s+/).includes(code)) {
      violations.push(`handoff step ${code} missing from channel 1`);
    }
  }
  const handoffIndices = HANDOFF_SEQUENCE.map((code) => {
    const tokens = program.channel1.join(' ').split(/\s+/);
    return tokens.indexOf(code);
  });

  const ch2Tokens = program.channel2.join(' ').split(/\s+/);
  for (const code of MAIN_ONLY_HANDOFF) {
    if (ch2Tokens.includes(code)) {
      violations.push(`main-only handoff code ${code} must not appear on channel 2`);
    }
  }
  for (let i = 1; i < handoffIndices.length; i += 1) {
    if (handoffIndices[i] <= handoffIndices[i - 1]) {
      violations.push(
        `handoff ordering violated: ${HANDOFF_SEQUENCE[i - 1]} (${handoffIndices[i - 1]}) ` +
          `must precede ${HANDOFF_SEQUENCE[i]} (${handoffIndices[i]})`
      );
    }
  }

  const toolsPerChannel = { 1: [], 2: [] };
  for (const channel of [1, 2]) {
    const lines = channel === 1 ? program.channel1 : program.channel2;
    for (const line of lines) {
      for (const token of line.split(/\s+/)) {
        const m = TOOL_RE.exec(token);
        if (!m) continue;
        const turret = m[1];
        const slot = m[2];
        const expected = channel === 1 ? '01' : '02';
        if (turret !== expected) {
          violations.push(`channel ${channel} uses turret offset ${turret}xx (expected ${expected}xx)`);
        }
        toolsPerChannel[channel].push(`${turret}${slot}`);
      }
    }
  }
  const set1 = new Set(toolsPerChannel[1]);
  const set2 = new Set(toolsPerChannel[2]);
  for (const tool of set1) {
    if (set2.has(tool)) {
      violations.push(`tool offset ${tool} used on both channels`);
    }
  }

  return { ok: violations.length === 0, violations };
}

module.exports = {
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
};
