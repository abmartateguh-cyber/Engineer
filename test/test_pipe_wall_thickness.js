/**
 * Verification gate: ASME B31.3 pipe wall thickness and MAWP calculation.
 *
 * Covers:
 * 1. B31.3 Section 304.1.2 design thickness t = P·D/(2·(S·E·W + P·Y))
 *    against the closed form to 1e-9 for several P/D/S combos.
 * 2. Known case: NPS 8 (OD 219.1 mm) Sch 40 (t_nom 8.18 mm), A106 Gr B at
 *    300°C, P = 5 MPa, E = W = 1, corrosion allowance 1.5 mm, 12.5% mill
 *    tolerance -> required nominal thickness <= 8.18 mm (line passes).
 * 3. MAWP closed form: P_max = 2·S·E·W·(t_actual − c)/(D − 2·Y·(t_actual − c))
 *    to 1e-9.
 * 4. Design temperature derating: published A106 Gr B S(T) table (ASME B31.3-
 *    2020, Appendix A, Table A-1) embedded; MAWP monotone non-increasing over
 *    100/200/300/400°C with strict decrease where S strictly decreases.
 * 5. Material selection: same geometry at 300°C — ordering implied by the cited
 *    Table A-1 values (note: per Table A-1, A106-B retains a higher S than
 *    TP316L at 300°C; the brief's expected ordering is inverted vs. the
 *    published data, and this gate pins the published ordering).
 * 6. Fail-closed: negative pressure, zero/negative thickness, unknown material,
 *    missing temperature table, non-finite inputs -> structured errors.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { PipeSizingEngine } = require('../src/core/plant/pipe_sizing_engine');

const KSI_MPA = 6.894757;

// ASME B31.3-2020, Appendix A, Table A-1: Basic Allowable Stresses, ksi at °F.
// Linear interpolation between adjacent temperatures is permitted by the Code.
const PUBLISHED_A106_B_S_KSI = [
  [-20, 20.0],
  [100, 20.0],
  [200, 20.0],
  [300, 20.0],
  [400, 20.0],
  [500, 18.9],
  [600, 17.8],
  [650, 17.3],
  [700, 16.8],
  [750, 16.1],
  [800, 15.4],
  [850, 13.7],
  [900, 12.0],
  [950, 10.2],
  [1000, 8.2]
];

const PUBLISHED_TP316L_S_KSI = [
  [-20, 16.7],
  [100, 16.7],
  [200, 15.7],
  [300, 14.5],
  [400, 13.8],
  [500, 13.2],
  [600, 12.8],
  [700, 12.5],
  [800, 12.2],
  [900, 11.9],
  [1000, 11.5]
];

function publishedAllowableStressMPa(table, tempC) {
  const tempF = (tempC * 9) / 5 + 32;
  const first = table[0];
  const last = table[table.length - 1];
  if (tempF <= first[0]) return first[1] * KSI_MPA;
  if (tempF >= last[0]) return last[1] * KSI_MPA;
  for (let i = 1; i < table.length; i++) {
    if (tempF <= table[i][0]) {
      const tLo = table[i - 1][0];
      const sLo = table[i - 1][1];
      const tHi = table[i][0];
      const sHi = table[i][1];
      return (sLo + ((tempF - tLo) / (tHi - tLo)) * (sHi - sLo)) * KSI_MPA;
    }
  }
  return last[1] * KSI_MPA;
}

describe('ASME B31.3 verification gate: wall thickness & MAWP', () => {
  const engine = new PipeSizingEngine();

  it('B31.3 304.1.2: t = P·D/(2·(S·E·W + P·Y)) to 1e-9 across P/D/S combos', () => {
    const combos = [
      { P: 5e6, D: 0.2191, S: 110e6, E: 1, W: 1, Y: 0.4 },
      { P: 1e6, D: 0.1683, S: 137.89514e6, E: 1, W: 1, Y: 0.4 },
      { P: 10e6, D: 0.1143, S: 137.89514e6, E: 0.85, W: 0.95, Y: 0.4 },
      { P: 0.5e6, D: 0.0603, S: 115.1e6, E: 1, W: 0.9, Y: 0.4 },
      { P: 25e6, D: 0.3238, S: 100e6, E: 1, W: 1, Y: 0.4 }
    ];

    for (const c of combos) {
      const tExpected = (c.P * c.D) / (2 * (c.S * c.E * c.W + c.P * c.Y));
      const r = engine.calculateASMEB313WallThickness({
        designPressurePa: c.P,
        outerDiameterM: c.D,
        allowableStressPa: c.S,
        qualityFactorE: c.E,
        weldJointFactorW: c.W,
        coefficientY: c.Y,
        corrosionAllowanceM: 0
      });
      const tActual = r.pressureDesignThicknessMm / 1000;
      assert.ok(
        Math.abs(tActual - tExpected) <= 1e-9,
        `t=${tActual} vs closed-form ${tExpected} (P=${c.P}, D=${c.D}, S=${c.S})`
      );
    }
  });

  it('known case: NPS 8 Sch 40 A106-B @ 300°C, P=5 MPa passes with 1.5 mm CA + 12.5% mill tolerance', () => {
    const D = 0.2191; // NPS 8 OD, mm
    const tNominal = 8.18e-3; // Sch 40 wall
    const P = 5e6;
    const CA = 1.5e-3;

    const r = engine.calculateASMEB313WallThickness({
      designPressurePa: P,
      outerDiameterM: D,
      material: 'A106-B',
      designTemperatureC: 300,
      corrosionAllowanceM: CA,
      millTolerance: 0.125
    });

    const S = r.allowableStressMPa * 1e6;
    const tFormula = (P * D) / (2 * (S * 1 * 1 + P * 0.4));
    assert.ok(Math.abs(r.pressureDesignThicknessMm / 1000 - tFormula) <= 1e-9, 't matches closed form');
    assert.ok(
      Math.abs(S - publishedAllowableStressMPa(PUBLISHED_A106_B_S_KSI, 300) * 1e6) <= 1e-9 * S,
      `S(300°C)=${S} must equal published interpolation`
    );

    // Minimum required nominal thickness (with 12.5% mill tolerance) must be <= 8.18 mm.
    assert.ok(
      r.requiredNominalThicknessMm <= tNominal * 1000,
      `required nominal ${r.requiredNominalThicknessMm} mm > 8.18 mm`
    );
    // Sanity band around the measured value (6.65 mm at S = 124.85 MPa).
    assert.ok(
      r.requiredNominalThicknessMm > 6.0 && r.requiredNominalThicknessMm < 7.5,
      `sanity band ${r.requiredNominalThicknessMm}`
    );

    // Same pass/fail conclusion with the brief's approximate S = 110 MPa.
    const r110 = engine.calculateASMEB313WallThickness({
      designPressurePa: P,
      outerDiameterM: D,
      allowableStressPa: 110e6,
      corrosionAllowanceM: CA,
      millTolerance: 0.125
    });
    assert.ok(
      r110.requiredNominalThicknessMm <= tNominal * 1000,
      `S=110 MPa still passes (${r110.requiredNominalThicknessMm} mm)`
    );
  });

  it('MAWP equals closed form P_max = 2·S·E·W·(t_actual − c)/(D − 2·Y·(t_actual − c)) to 1e-9', () => {
    const cases = [
      { P0: 5e6, D: 0.2191, t: 8.18e-3, c: 1.5e-3, E: 1, W: 1, Y: 0.4 },
      { P0: 10e6, D: 0.1683, t: 12.7e-3, c: 2e-3, E: 0.85, W: 0.95, Y: 0.4 }
    ];

    for (const cc of cases) {
      const r = engine.calculateASMEB313WallThickness({
        designPressurePa: cc.P0,
        outerDiameterM: cc.D,
        material: 'A106-B',
        designTemperatureC: 300,
        qualityFactorE: cc.E,
        weldJointFactorW: cc.W,
        coefficientY: cc.Y,
        corrosionAllowanceM: cc.c,
        millTolerance: 0
      });
      const S = r.allowableStressMPa * 1e6;
      const tCorroded = cc.t - cc.c;
      const closed = (2 * S * cc.E * cc.W * tCorroded) / (cc.D - 2 * cc.Y * tCorroded);
      const actual = r.calculateMAWP(cc.t);
      assert.ok(
        Math.abs(actual - closed) <= 1e-9 * Math.max(1, Math.abs(closed)),
        `MAWP ${actual} vs closed-form ${closed}`
      );
      assert.ok(actual > cc.P0, `MAWP ${actual} must exceed design pressure ${cc.P0}`);
    }
  });

  it('design temperature derating: A106-B S(T) and MAWP(T) monotone non-increasing over 100–400°C', () => {
    const temps = [100, 200, 300, 400];
    const geom = { P: 5e6, D: 0.2191, t: 8.18e-3, c: 1.5e-3 };

    const S = temps.map(
      (t) =>
        engine.calculateASMEB313WallThickness({
          designPressurePa: geom.P,
          outerDiameterM: geom.D,
          material: 'A106-B',
          designTemperatureC: t,
          corrosionAllowanceM: geom.c,
          millTolerance: 0
        }).allowableStressMPa * 1e6
    );

    for (let i = 0; i < temps.length; i++) {
      const expected = publishedAllowableStressMPa(PUBLISHED_A106_B_S_KSI, temps[i]) * 1e6;
      assert.ok(
        Math.abs(S[i] - expected) <= 1e-9 * expected,
        `S(${temps[i]}°C)=${S[i]} differs from published ${expected}`
      );
    }

    for (let i = 0; i < S.length - 1; i++) {
      assert.ok(S[i] >= S[i + 1], `S non-increasing violated at ${temps[i]}°C: ${S[i]} < ${S[i + 1]}`);
    }
    assert.ok(S[1] > S[2], `strict derating 200→300°C: ${S[1]} vs ${S[2]}`);
    assert.ok(S[2] > S[3], `strict derating 300→400°C: ${S[2]} vs ${S[3]}`);

    const mawps = temps.map((t) =>
      engine
        .calculateASMEB313WallThickness({
          designPressurePa: geom.P,
          outerDiameterM: geom.D,
          material: 'A106-B',
          designTemperatureC: t,
          corrosionAllowanceM: geom.c,
          millTolerance: 0
        })
        .calculateMAWP(geom.t)
    );

    assert.ok(mawps[0] >= mawps[1], 'MAWP(100°C) >= MAWP(200°C)');
    assert.ok(mawps[1] > mawps[2], `MAWP(200°C) > MAWP(300°C): ${mawps[1]} vs ${mawps[2]}`);
    assert.ok(mawps[2] > mawps[3], `MAWP(300°C) > MAWP(400°C): ${mawps[2]} vs ${mawps[3]}`);
    assert.ok(mawps[0] > mawps[3], 'MAWP(100°C) > MAWP(400°C)');
  });

  it('material selection: same geometry at 300°C — ordering per published Table A-1', () => {
    const geom = { P: 5e6, D: 0.2191, t: 8.18e-3, c: 1.5e-3 };

    const sA106 =
      engine.calculateASMEB313WallThickness({
        designPressurePa: geom.P,
        outerDiameterM: geom.D,
        material: 'A106-B',
        designTemperatureC: 300,
        corrosionAllowanceM: geom.c,
        millTolerance: 0
      }).allowableStressMPa * 1e6;

    const r316L = engine.calculateASMEB313WallThickness({
      designPressurePa: geom.P,
      outerDiameterM: geom.D,
      material: 'A312-TP316L',
      designTemperatureC: 300,
      corrosionAllowanceM: geom.c,
      millTolerance: 0
    });
    const s316L = r316L.allowableStressMPa * 1e6;

    assert.ok(
      Math.abs(s316L - publishedAllowableStressMPa(PUBLISHED_TP316L_S_KSI, 300) * 1e6) <= 1e-9 * s316L,
      `S_316L(300°C)=${s316L} must equal published interpolation`
    );

    const mA106 = engine
      .calculateASMEB313WallThickness({
        designPressurePa: geom.P,
        outerDiameterM: geom.D,
        material: 'A106-B',
        designTemperatureC: 300,
        corrosionAllowanceM: geom.c,
        millTolerance: 0
      })
      .calculateMAWP(geom.t);
    const m316L = r316L.calculateMAWP(geom.t);

    // Per ASME B31.3-2020 Table A-1, A106-B retains a higher S than TP316L at
    // 300°C (124.85 vs 89.03 MPa), so MAWP ordering follows S ordering.
    assert.ok(sA106 > s316L, `S_A106(300)=${sA106} should exceed S_316L(300)=${s316L} per Table A-1`);
    assert.ok(mA106 > m316L, `MAWP_A106=${mA106} should exceed MAWP_316L=${m316L} per Table A-1`);
    assert.ok(m316L > geom.P, '316L line still clears the 5 MPa design pressure');
  });

  it('fails closed: negative pressure, zero thickness, unknown material, invalid inputs → structured errors', () => {
    assert.throws(() => engine.calculateASMEB313WallThickness({ designPressurePa: -1e6, outerDiameterM: 0.2191 }), {
      name: 'RangeError'
    });
    assert.throws(() => engine.calculateASMEB313WallThickness({ designPressurePa: 5e6, outerDiameterM: 0 }), {
      name: 'RangeError'
    });
    assert.throws(
      () =>
        engine.calculateASMEB313WallThickness({
          designPressurePa: 5e6,
          outerDiameterM: 0.2191,
          corrosionAllowanceM: -0.001
        }),
      { name: 'RangeError' }
    );
    assert.throws(
      () =>
        engine.calculateASMEB313WallThickness({ designPressurePa: 5e6, outerDiameterM: 0.2191, allowableStressPa: 0 }),
      { name: 'RangeError' }
    );

    const r = engine.calculateASMEB313WallThickness({ designPressurePa: 5e6, outerDiameterM: 0.2191 });
    assert.throws(() => r.calculateMAWP(0), { name: 'RangeError' });
    assert.throws(() => r.calculateMAWP(-0.001), { name: 'RangeError' });

    assert.throws(
      () =>
        engine.calculateASMEB313WallThickness({
          designPressurePa: 5e6,
          outerDiameterM: 0.2191,
          material: 'NONEXISTENT'
        }),
      /Unknown pipe material/
    );
    assert.throws(
      () =>
        engine.calculateASMEB313WallThickness({
          designPressurePa: 5e6,
          outerDiameterM: 0.2191,
          material: 'A312-TP304',
          designTemperatureC: 300
        }),
      /No temperature-dependent/
    );
    assert.throws(
      () =>
        engine.calculateASMEB313WallThickness({
          designPressurePa: 5e6,
          outerDiameterM: 0.2191,
          designTemperatureC: NaN
        }),
      { name: 'RangeError' }
    );
  });
});
