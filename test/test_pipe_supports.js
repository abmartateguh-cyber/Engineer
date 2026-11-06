'use strict';

/**
 * Regression guard for src/core/plant/pipe_support_selector.js — variable /
 * constant-effort spring hanger selection and pipe support spacing.
 * Deterministic, dependency-free.
 */

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  selectPipeSupport,
  selectVariableSpringHanger,
  selectConstantEffortHanger,
  maximumSupportSpacing,
  VARIABLE_SPRING_HANGER_CATALOG,
  CONSTANT_EFFORT_HANGER_CATALOG
} = require('../src/core/plant/pipe_support_selector');

describe('pipe support selector: variable spring hanger', () => {
  it('selects a size bracketing [8, 9.5] kN with travel >= 12 mm; variation 18.75% not flagged', () => {
    const r = selectVariableSpringHanger(8, 9.5, 12);
    assert.equal(r.type, 'variable');
    assert.equal(r.flagged, false);
    assert.ok(r.hanger.loadMin_kN <= 8, `min ${r.hanger.loadMin_kN} > 8`);
    assert.ok(r.hanger.loadMax_kN >= 9.5, `max ${r.hanger.loadMax_kN} < 9.5`);
    assert.ok(r.hanger.travelCapacity_mm >= 12, `travel ${r.hanger.travelCapacity_mm} < 12`);
    assert.ok(Math.abs(r.loadVariationRatio - 0.1875) < 1e-12, `variation ${r.loadVariationRatio}`);
    assert.equal(r.loadVariationPct, 18.75);
  });

  it('travel filter: for travel = 80 mm only capacities >= 80 qualify (VS-04 @75 excluded)', () => {
    const r = selectVariableSpringHanger(8.4, 8.6, 80);
    assert.equal(r.hanger.size, 'VS-05');
    assert.ok(r.hanger.travelCapacity_mm >= 80);
    assert.ok(r.hanger.loadMin_kN <= 8.4 && r.hanger.loadMax_kN >= 8.6);
  });
});

describe('pipe support selector: variation limit and constant-effort fallback', () => {
  it('30% variation (8 -> 10.4 kN) flags and falls back to constant-effort hanger', () => {
    const r = selectPipeSupport(8, 10.4, 12);
    assert.equal(r.type, 'constant');
    assert.equal(r.fallback, true);
    assert.equal(r.flagged, true);
    assert.equal(r.variableSelection.flagged, true);
    assert.ok(Math.abs(r.loadVariationRatio - 0.3) < 1e-12, `variation ${r.loadVariationRatio}`);
    assert.equal(r.loadVariationPct, 30);
    assert.ok(r.hanger.loadMin_kN <= 8 && r.hanger.loadMax_kN >= 8, 'range must include F_hot');
    assert.ok(r.hanger.travelCapacity_mm >= 12, 'capacity must cover travel');
  });

  it('constant-effort selector returns a size rated for F_hot with travel coverage', () => {
    const r = selectConstantEffortHanger(8, 10.4, 12);
    assert.equal(r.type, 'constant');
    assert.ok(r.hanger.loadMin_kN <= 8 && r.hanger.loadMax_kN >= 8);
    assert.ok(r.hanger.travelCapacity_mm >= 12);
  });
});

describe('pipe support selector: spacing check', () => {
  it('NPS 6 sch 40 CS with water + insulation: L_max matches independent evaluation to 1e-6', () => {
    const r = maximumSupportSpacing({ nps: '6', schedule: '40' });

    const OD = 168.3;
    const WALL = 7.11;
    const ID = OD - 2 * WALL;
    const S = 120;
    const G = 9.81;

    const z = ((Math.PI / 32) * (Math.pow(OD, 4) - Math.pow(ID, 4))) / OD;
    const pipeArea = (Math.PI / 4) * (OD * OD - ID * ID);
    const fluidArea = (Math.PI / 4) * ID * ID;
    const insArea = (Math.PI / 4) * (Math.pow(OD + 100, 2) - OD * OD);
    const w = (((pipeArea / 1e6) * 7850 + (fluidArea / 1e6) * 1000 + (insArea / 1e6) * 150) * G) / 1000;

    const lExp = Math.sqrt((8 * z * S) / w);
    assert.ok(Math.abs(r.lMax_mm - lExp) / lExp < 1e-6, `L_max ${r.lMax_mm} vs ${lExp}`);
    assert.ok(r.lMax_mm > 0);
  });

  it('larger loads yield smaller spacing (monotonic)', () => {
    const base = maximumSupportSpacing({ nps: '6', schedule: '40', fluidDensity: 1000 });
    const heavyFluid = maximumSupportSpacing({ nps: '6', schedule: '40', fluidDensity: 2000 });
    const heavyInsul = maximumSupportSpacing({ nps: '6', schedule: '40', insulationThickness: 100 });
    assert.ok(heavyFluid.weightPerLength_N_per_mm > base.weightPerLength_N_per_mm);
    assert.ok(heavyInsul.weightPerLength_N_per_mm > base.weightPerLength_N_per_mm);
    assert.ok(heavyFluid.lMax_mm < base.lMax_mm, 'heavier fluid must shorten spacing');
    assert.ok(heavyInsul.lMax_mm < base.lMax_mm, 'heavier insulation must shorten spacing');
  });
});

describe('pipe support selector: catalog integrity', () => {
  it('variable catalog: positive finite loads/travels, monotonic capacities, no NaN', () => {
    assert.equal(VARIABLE_SPRING_HANGER_CATALOG.length, 12);
    for (let i = 0; i < VARIABLE_SPRING_HANGER_CATALOG.length; i++) {
      const h = VARIABLE_SPRING_HANGER_CATALOG[i];
      assert.ok(Number.isFinite(h.loadMin_kN) && h.loadMin_kN > 0, `entry ${i} min`);
      assert.ok(Number.isFinite(h.loadMax_kN) && h.loadMax_kN > 0, `entry ${i} max`);
      assert.ok(Number.isFinite(h.travelCapacity_mm) && h.travelCapacity_mm > 0, `entry ${i} travel`);
      assert.ok(h.loadMin_kN <= h.loadMax_kN, `entry ${i} range`);
      if (i > 0) {
        assert.ok(
          VARIABLE_SPRING_HANGER_CATALOG[i].travelCapacity_mm >=
            VARIABLE_SPRING_HANGER_CATALOG[i - 1].travelCapacity_mm,
          'travel capacity monotonic'
        );
        assert.ok(
          VARIABLE_SPRING_HANGER_CATALOG[i].loadMax_kN >= VARIABLE_SPRING_HANGER_CATALOG[i - 1].loadMax_kN,
          'load max monotonic'
        );
      }
    }
  });

  it('constant catalog: positive finite loads/travels, monotonic capacities, no NaN', () => {
    assert.equal(CONSTANT_EFFORT_HANGER_CATALOG.length, 10);
    for (let i = 0; i < CONSTANT_EFFORT_HANGER_CATALOG.length; i++) {
      const h = CONSTANT_EFFORT_HANGER_CATALOG[i];
      assert.ok(Number.isFinite(h.loadMin_kN) && h.loadMin_kN > 0, `entry ${i} min`);
      assert.ok(Number.isFinite(h.loadMax_kN) && h.loadMax_kN > 0, `entry ${i} max`);
      assert.ok(Number.isFinite(h.travelCapacity_mm) && h.travelCapacity_mm > 0, `entry ${i} travel`);
      assert.ok(h.loadMin_kN <= h.loadMax_kN, `entry ${i} range`);
      if (i > 0) {
        assert.ok(
          CONSTANT_EFFORT_HANGER_CATALOG[i].travelCapacity_mm >=
            CONSTANT_EFFORT_HANGER_CATALOG[i - 1].travelCapacity_mm,
          'travel capacity monotonic'
        );
        assert.ok(
          CONSTANT_EFFORT_HANGER_CATALOG[i].loadMax_kN >= CONSTANT_EFFORT_HANGER_CATALOG[i - 1].loadMax_kN,
          'load max monotonic'
        );
      }
    }
  });
});
