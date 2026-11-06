'use strict';

/**
 * Verification gate for the CNC post-processor engine
 * (src/core/cam/post_processor.js).
 *
 * Verifies:
 *  1. ISO 6983 grammar conformance: every emitted line matches
 *     `N<digits> <words>`, each word is `[A-Z][+-]?<number>` (or M/T/S/F
 *     integer, or a pure-alpha controller keyword like TRAORI); no empty
 *     words, no stray characters. Full generated program: 0 violations.
 *  2. Sequence numbers strictly increasing by 1..10.
 *  3. G00/G01/G02/G03 presence from a path fixture (line segments + arcs);
 *     arc blocks emit I/J or R per dialect.
 *  4. Modal suppression: identical consecutive G-codes are not repeated.
 *  5. Dialect keyword presence: Fanuc G43.4, Siemens TRAORI, Heidenhain M128.
 *  6. Round-trip: parsed F/S/T words match the input program exactly.
 *  7. Determinism.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PostProcessor, DIALECTS } = require('../src/core/cam/post_processor');

const TOOL_NUMBER = 7;
const SPINDLE_RPM = 12000;
const FEED_RATE = 1500;

const FIXTURE = [
  { type: 'rapid', x: 0, y: 0, z: 10 },
  { type: 'rapid', x: 10, y: 10, z: 2 },
  { type: 'linear', x: 20, y: 10, z: 2, feed: FEED_RATE },
  { type: 'linear', x: 30, y: 10, z: 2 },
  { type: 'arc', x: 40, y: 15, z: 2, i: 5, j: 0, dir: 'ccw', feed: FEED_RATE },
  { type: 'arc', x: 45, y: 20, z: 2, i: 0, j: 5, dir: 'cw' },
  { type: 'cycle', code: 'G81', x: 50, y: 15, z: -5, r: 2, feed: FEED_RATE }
];

const WORD_RE = /^[A-Z][+-]?\d+(\.\d+)?$/;
const ALPHA_WORD_RE = /^[A-Z]+$/;
const INTEGER_WORD_RE = /^[MTSF]\d+$/;

function grammarViolations(lines) {
  const violations = [];
  lines.forEach((line, idx) => {
    const m = /^N(\d+)\s+(.+)$/.exec(line);
    if (!m) {
      violations.push(`line ${idx}: not N<digits> <words>: "${line}"`);
      return;
    }
    const words = m[2].trim().split(/\s+/);
    for (const word of words) {
      if (word.length === 0) {
        violations.push(`line ${idx}: empty word in "${line}"`);
      } else if (ALPHA_WORD_RE.test(word)) {
        // pure-alpha controller keyword (TRAORI) is allowed
      } else if (INTEGER_WORD_RE.test(word)) {
        // M/T/S/F must be followed by an integer
      } else if (!WORD_RE.test(word)) {
        violations.push(`line ${idx}: invalid word "${word}" in "${line}"`);
      }
    }
  });
  return violations;
}

function parseN(lines) {
  return lines.map((line) => Number(/^N(\d+)/.exec(line)[1]));
}

function countWord(lines, word) {
  let count = 0;
  for (const line of lines) {
    const tokens = line.split(/\s+/);
    for (const token of tokens) {
      if (token === word) count += 1;
    }
  }
  return count;
}

function roundTrip(lines) {
  const fs = [];
  const ss = [];
  const ts = [];
  for (const line of lines) {
    for (const token of line.split(/\s+/)) {
      if (/^F\d+$/.test(token)) fs.push(Number(token.slice(1)));
      else if (/^S\d+$/.test(token)) ss.push(Number(token.slice(1)));
      else if (/^T\d+$/.test(token)) ts.push(Number(token.slice(1)));
    }
  }
  return { fs, ss, ts };
}

function axisDecimals(lines) {
  const bad = [];
  for (const line of lines) {
    for (const token of line.split(/\s+/)) {
      const m = /^([XYZ])([+-]?\d+\.\d+)$/.exec(token);
      if (m) {
        const decimals = m[2].split('.')[1].length;
        if (decimals < 3) {
          bad.push(`${token} in ${line}`);
        }
      }
    }
  }
  return bad;
}

function makeProcessor(dialect, extra) {
  return new PostProcessor(
    Object.assign(
      {
        dialect,
        toolNumber: TOOL_NUMBER,
        spindleRpm: SPINDLE_RPM,
        feedRateMmMin: FEED_RATE
      },
      extra || {}
    )
  );
}

describe('PostProcessor: generic ISO 6983 engine', () => {
  it('rejects invalid dialect and invalid options', () => {
    assert.throws(() => new PostProcessor({ dialect: 'bogus' }), TypeError);
    assert.throws(() => new PostProcessor({ dialect: DIALECTS.FANUC, toolNumber: 0 }), TypeError);
    assert.throws(() => new PostProcessor({ dialect: DIALECTS.FANUC, sequenceIncrement: 0 }), TypeError);
    assert.throws(() => new PostProcessor({ dialect: DIALECTS.FANUC, sequenceIncrement: 11 }), TypeError);
    assert.throws(() => new PostProcessor({ dialect: DIALECTS.FANUC, arcStyle: 'X' }), TypeError);
    assert.throws(
      () => new PostProcessor({ dialect: DIALECTS.HEIDENHAIN, heidenhainRtcp: 'FUNCTION TCPM' }),
      TypeError
    );
  });

  for (const dialect of Object.values(DIALECTS)) {
    it(`[${dialect}] full program passes ISO 6983 grammar (0 violations)`, () => {
      const lines = makeProcessor(dialect).postProcess(FIXTURE);
      assert.deepEqual(grammarViolations(lines), [], 'grammar violations must be zero');
    });

    it(`[${dialect}] sequence numbers strictly increasing by 1..10`, () => {
      const ns = parseN(makeProcessor(dialect).postProcess(FIXTURE));
      for (let i = 1; i < ns.length; i += 1) {
        const step = ns[i] - ns[i - 1];
        assert.ok(step >= 1 && step <= 10, `step ${step} out of 1..10`);
      }
      assert.ok(ns[0] >= 1);
      assert.deepEqual([...new Set(ns)].length, ns.length, 'sequence numbers must be unique');
    });

    it(`[${dialect}] G00/G01/G02/G03 and G81 present as expected; no modal duplication`, () => {
      const lines = makeProcessor(dialect).postProcess(FIXTURE);
      assert.equal(countWord(lines, 'G00'), 1, 'rapids suppressed to a single G00');
      assert.equal(countWord(lines, 'G01'), 1, 'consecutive G01 suppression');
      assert.equal(countWord(lines, 'G02'), 1, 'cw arc emits one G02');
      assert.equal(countWord(lines, 'G03'), 1, 'ccw arc emits one G03');
      assert.equal(countWord(lines, 'G81'), 1, 'canned cycle emits one G81');
    });

    it(`[${dialect}] X/Y/Z have at least 3 decimals; F/S/T round-trip exact`, () => {
      const lines = makeProcessor(dialect).postProcess(FIXTURE);
      assert.deepEqual(axisDecimals(lines), [], 'all X/Y/Z words need >= 3 decimals');
      const { fs, ss, ts } = roundTrip(lines);
      assert.ok(fs.length >= 1, 'feedrate word present');
      assert.ok(ss.length >= 1, 'spindle word present');
      assert.ok(ts.length >= 1, 'tool word present');
      for (const f of fs) assert.equal(f, FEED_RATE);
      for (const s of ss) assert.equal(s, SPINDLE_RPM);
      for (const t of ts) assert.equal(t, TOOL_NUMBER);
    });

    it(`[${dialect}] deterministic: identical input -> identical output`, () => {
      const a = makeProcessor(dialect).generate(FIXTURE);
      const b = makeProcessor(dialect).generate(FIXTURE);
      assert.equal(a, b);
    });
  }

  it('arc blocks emit I/J for Fanuc and Siemens; R for Heidenhain', () => {
    const fanuc = makeProcessor(DIALECTS.FANUC).postProcess(FIXTURE);
    const siemens = makeProcessor(DIALECTS.SIEMENS).postProcess(FIXTURE);
    const heidenhain = makeProcessor(DIALECTS.HEIDENHAIN).postProcess(FIXTURE);

    assert.ok(
      fanuc.some((l) => l.includes('I5.000') && l.includes('J0.000')),
      'fanuc arc IJ'
    );
    assert.ok(
      siemens.some((l) => l.includes('I5.000') && l.includes('J0.000')),
      'siemens arc IJ'
    );
    assert.ok(
      heidenhain.some((l) => /\bR5\b/.test(l)),
      'heidenhain arc R (radius from I/J)'
    );
  });

  it('dialect keyword presence: G43.4 / TRAORI / M128', () => {
    const fanuc = makeProcessor(DIALECTS.FANUC).postProcess(FIXTURE);
    const siemens = makeProcessor(DIALECTS.SIEMENS).postProcess(FIXTURE);
    const heidenhain = makeProcessor(DIALECTS.HEIDENHAIN).postProcess(FIXTURE);

    assert.ok(
      fanuc.some((l) => l.includes('G43.4') && l.includes(`H${TOOL_NUMBER}`)),
      'Fanuc G43.4'
    );
    assert.ok(
      siemens.some((l) => l.includes('TRAORI')),
      'Siemens TRAORI'
    );
    assert.ok(
      heidenhain.some((l) => l.includes('M128')),
      'Heidenhain M128'
    );
  });

  it('custom sequence step (1) is honored and still strictly increasing', () => {
    const lines = makeProcessor(DIALECTS.FANUC, { sequenceIncrement: 1 }).postProcess(FIXTURE);
    const ns = parseN(lines);
    for (let i = 1; i < ns.length; i += 1) {
      assert.equal(ns[i] - ns[i - 1], 1);
    }
    assert.equal(ns[0], 1);
  });

  it('rejects malformed toolpath items', () => {
    assert.throws(() => makeProcessor(DIALECTS.FANUC).postProcess('nope'), TypeError);
    assert.throws(() => makeProcessor(DIALECTS.FANUC).postProcess([{ type: 'bogus' }]), TypeError);
    assert.throws(() => makeProcessor(DIALECTS.FANUC).postProcess([{ type: 'mcode', code: 'G01' }]), TypeError);
    assert.throws(() => makeProcessor(DIALECTS.FANUC).postProcess([{ type: 'toolchange', tool: 0 }]), TypeError);
  });
});
