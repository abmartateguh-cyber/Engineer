'use strict';

/**
 * Deterministic MC/DC coverage gate for src/core/compliance/mcdc_test_harness.js
 *
 * Verifies unique-cause MC/DC vector generation for simple decisions, a
 * negated decision, the PSV relief-valve safety decision, duplicated-condition
 * honesty, and determinism.
 */

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { analyzeMcDc, extractDecisionFromFunctionBody, summarize } = require('../src/core/compliance/mcdc_test_harness');

function assertUniqueCausePair(pair) {
  const from = pair.from.inputs;
  const to = pair.to.inputs;
  let differing = 0;
  for (let i = 0; i < from.length; i++) {
    if (from[i] !== to[i]) differing++;
  }
  assert.equal(differing, 1, `pair must differ in exactly one condition: ${pair.fromLabel} / ${pair.toLabel}`);
  assert.notEqual(pair.from.decision, pair.to.decision, 'decision outcome must flip');
}

describe('MC/DC test harness (unique-cause)', () => {
  it('A && B achieves 100% MC/DC with 3 vectors and the canonical pairs', () => {
    const r = analyzeMcDc('A && B');
    assert.equal(r.mcdc.coveragePercent, 100);
    assert.equal(r.mcdc.coveredConditions, 2);
    assert.equal(r.mcdc.totalConditions, 2);
    assert.equal(r.mcdc.vectorCount, 3);

    const [a, b] = r.mcdc.conditionCoverage;
    assert.equal(a.name, 'A');
    assert.equal(a.pair.fromLabel, '(F,T)->F');
    assert.equal(a.pair.toLabel, '(T,T)->T');
    assert.equal(b.name, 'B');
    assert.equal(b.pair.fromLabel, '(T,F)->F');
    assert.equal(b.pair.toLabel, '(T,T)->T');
    assertUniqueCausePair(a.pair);
    assertUniqueCausePair(b.pair);
  });

  it('A || B achieves 100% MC/DC with 3 vectors', () => {
    const r = analyzeMcDc('A || B');
    assert.equal(r.mcdc.coveragePercent, 100);
    assert.equal(r.mcdc.coveredConditions, 2);
    assert.equal(r.mcdc.totalConditions, 2);
    assert.equal(r.mcdc.vectorCount, 3);
    for (const c of r.mcdc.conditionCoverage) {
      assert.equal(c.covered, true);
      assertUniqueCausePair(c.pair);
    }
  });

  it('A && (B || C) achieves 100% with unique-cause pairs for all 3 conditions', () => {
    const r = analyzeMcDc('A && (B || C)');
    assert.equal(r.mcdc.coveragePercent, 100);
    assert.equal(r.mcdc.coveredConditions, 3);
    assert.equal(r.mcdc.totalConditions, 3);
    assert.equal(r.mcdc.vectorCount, 4);
    assert.deepEqual(r.variables, ['A', 'B', 'C']);
    const names = r.mcdc.conditionCoverage.map((c) => c.name);
    assert.deepEqual(names, ['A', 'B', 'C']);
    for (const c of r.mcdc.conditionCoverage) {
      assert.equal(c.covered, true);
      assertUniqueCausePair(c.pair);
    }
  });

  it('!A && (B || !C) achieves 100% MC/DC', () => {
    const r = analyzeMcDc('!A && (B || !C)');
    assert.equal(r.mcdc.coveragePercent, 100);
    assert.equal(r.mcdc.coveredConditions, 3);
    assert.equal(r.mcdc.totalConditions, 3);
    for (const c of r.mcdc.conditionCoverage) {
      assert.equal(c.covered, true);
      assertUniqueCausePair(c.pair);
    }
  });

  it('PSV relief-valve decision achieves 100% MC/DC with 5 vectors', () => {
    const body = 'open = (P > Pset) && (manualOverride || (T < Tmax && flowOK))';
    const extracted = extractDecisionFromFunctionBody(body);
    assert.equal(extracted.name, 'open');

    const r = analyzeMcDc(extracted.expression);
    assert.equal(r.mcdc.coveragePercent, 100);
    assert.equal(r.mcdc.coveredConditions, 4);
    assert.equal(r.mcdc.totalConditions, 4);
    assert.equal(r.mcdc.vectorCount, 5);
    assert.deepEqual(r.variables, ['P > Pset', 'manualOverride', 'T < Tmax', 'flowOK']);
    for (const c of r.mcdc.conditionCoverage) {
      assert.equal(c.covered, true);
      assertUniqueCausePair(c.pair);
    }

    const viaBody = analyzeMcDc(
      'function psvOpen() { return open = (P > Pset) && (manualOverride || (T < Tmax && flowOK)); }'
    );
    assert.equal(viaBody.mcdc.vectorCount, 5);
    assert.equal(viaBody.mcdc.coveragePercent, 100);
  });

  it('duplicated condition A && A is reported honestly as unreachable', () => {
    const r = analyzeMcDc('A && A');
    assert.ok(r.mcdc.coveragePercent <= 100);
    assert.equal(r.mcdc.totalConditions, 2);
    assert.equal(r.mcdc.coveredConditions, 0);
    assert.equal(r.mcdc.vectorCount, 0);
    for (const c of r.mcdc.conditionCoverage) {
      assert.equal(c.covered, false);
      assert.equal(c.unreachable, true);
      assert.equal(c.pair, null);
    }
  });

  it('is deterministic across repeated runs', () => {
    const expressions = [
      'A && B',
      'A || B',
      'A && (B || C)',
      '!A && (B || !C)',
      'open = (P > Pset) && (manualOverride || (T < Tmax && flowOK))',
      'A && A'
    ];
    for (const expr of expressions) {
      const first = analyzeMcDc(expr);
      const second = analyzeMcDc(expr);
      const third = analyzeMcDc(expr);
      assert.deepEqual(second, first);
      assert.deepEqual(third, first);
    }
    const psv = analyzeMcDc('open = (P > Pset) && (manualOverride || (T < Tmax && flowOK))');
    assert.equal(psv.mcdc.vectorCount, 5);
    assert.equal(summarize(psv), '100% (4/4), 5 vectors');
  });
});
