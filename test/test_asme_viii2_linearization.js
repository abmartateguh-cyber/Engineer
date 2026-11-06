'use strict';

const assert = require('node:assert/strict');
const {
  ASMESectionVIIIDiv2Analyzer,
  linearizeStressThroughThickness,
  evaluatePart5Allowables
} = require('../src/core/compliance/asme_section_viii_div2');

const TOLERANCE = 1e-9;

const testResults = { total: 0, passed: 0, failed: 0 };

function check(name, fn) {
  testResults.total += 1;
  try {
    fn();
    testResults.passed += 1;
  } catch (error) {
    testResults.failed += 1;
    console.error(`  ✗ FAILED ${name}: ${error.message}`);
  }
}

function closeTo(actual, expected, label) {
  assert.ok(Number.isFinite(actual), `${label} must be finite, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= TOLERANCE, `${label} expected ${expected}, got ${actual}`);
}

function symmetricGrid() {
  const points = [];
  for (let i = 0; i < 40; i++) {
    const x = -9.75 + i * 0.5;
    points.push({ s: x, σxx: 0, σyy: 0, σzz: 0, τxy: 0, τyz: 0, τzx: 0 });
  }
  return points;
}

function withComponent(points, key, values) {
  return points.map((point, i) => ({ ...point, [key]: values[i] }));
}

function linearField(a, b) {
  return symmetricGrid().map((point) => a + b * point.s);
}

function nonlinearField(a, b, c) {
  return symmetricGrid().map((point) => a + b * point.s + c * point.s * point.s);
}

function runAsmeViii2LinearizationTests() {
  // ------------------------------------------------------------------
  // Known linear field: σ(x) = 50 + 10·x on a 19.5 mm symmetric grid.
  // Hand-derived: membrane = 50, bending = 10·t/2 = 97.5, local = 0.
  // ------------------------------------------------------------------
  check('linear field: σxx membrane/bending/local reconstruction', () => {
    const sigmaXx = linearField(50, 10);
    const field = withComponent(symmetricGrid(), 'σxx', sigmaXx);
    const result = linearizeStressThroughThickness(field, {
      direction: 'radial',
      sectionLines: 'SCL-1'
    });

    assert.strictEqual(result.dataStatus, 'computed');
    assert.strictEqual(result.method, 'least-squares-linear-regression');
    assert.strictEqual(result.direction, 'radial');
    assert.strictEqual(result.sectionLines, 'SCL-1');
    assert.strictEqual(result.sampleCount, 40);
    closeTo(result.thicknessMm, 19.5, 'thickness');
    closeTo(result.components.σxx.membrane, 50, 'σxx membrane');
    closeTo(result.components.σxx.bending, 97.5, 'σxx bending');
    closeTo(result.components.σxx.fitSlope, 10, 'σxx fit slope');
    assert.ok(result.components.σxx.local <= TOLERANCE, 'σxx local must vanish for a linear field');
    closeTo(result.envelope.P_m, 50, 'envelope P_m');
    closeTo(result.envelope.P_b, 97.5, 'envelope P_b');
  });

  // ------------------------------------------------------------------
  // Known nonlinear field: σ(x) = 100 + 20·x + 3·x².
  // Hand-derived on the symmetric 19.5 mm grid (x_i = −9.75 + i·0.5):
  //   mean(x²) = h²·(n²−1)/12 = 0.25·1599/12 = 33.3125
  //   membrane  = 100 + 3·33.3125 = 199.9375
  //   slope     = 20 (x² term orthogonal over the symmetric grid)
  //   bending   = 20·t/2 = 195
  //   local     = max|3·x² − 99.9375| = 3·9.75² − 99.9375 = 185.25
  // ------------------------------------------------------------------
  check('nonlinear field: σxx membrane/bending/local reconstruction', () => {
    const sigmaXx = nonlinearField(100, 20, 3);
    const field = withComponent(symmetricGrid(), 'σxx', sigmaXx);
    const result = linearizeStressThroughThickness(field);

    closeTo(result.components.σxx.membrane, 199.9375, 'σxx membrane');
    closeTo(result.components.σxx.bending, 195, 'σxx bending');
    closeTo(result.components.σxx.bendingSigned, 195, 'σxx signed bending');
    closeTo(result.components.σxx.fitSlope, 20, 'σxx fit slope');
    closeTo(result.components.σxx.local, 185.25, 'σxx local');
  });

  // Per-component handling incl. shear components on a scaled field.
  check('per-component results for all six tensor components', () => {
    const base = nonlinearField(100, 20, 3);
    const field = symmetricGrid().map((point, i) => ({
      s: point.s,
      σxx: base[i],
      σyy: 2 * base[i],
      σzz: base[i] / 2,
      τxy: 0.5 * base[i],
      τyz: -base[i],
      τzx: 0.25 * base[i]
    }));
    const result = linearizeStressThroughThickness(field);

    closeTo(result.components.σxx.membrane, 199.9375, 'σxx membrane');
    closeTo(result.components.σyy.membrane, 399.875, 'σyy membrane');
    closeTo(result.components.σzz.membrane, 99.96875, 'σzz membrane');
    closeTo(result.components.τxy.membrane, 99.96875, 'τxy membrane');
    closeTo(result.components.τyz.membrane, -199.9375, 'τyz membrane');
    closeTo(result.components.τzx.membrane, 49.984375, 'τzx membrane');
    closeTo(result.components.σyy.bending, 390, 'σyy bending');
    closeTo(result.components.τxy.bending, 97.5, 'τxy bending');
    closeTo(result.components.τyz.local, 185.25, 'τyz local');
    closeTo(result.envelope.P_m, 399.875, 'envelope P_m');
    closeTo(result.envelope.P_b, 390, 'envelope P_b');
    closeTo(result.envelope.F_local, 370.5, 'envelope F_local');
  });

  // Least-squares fit must reproduce the input exactly (residual closure):
  // every per-sample residual must be bounded by the reported local magnitude,
  // and the maximum absolute residual must equal it.
  check('residual reconstruction closes the original field', () => {
    const sigmaXx = nonlinearField(100, 20, 3);
    const result = linearizeStressThroughThickness(withComponent(symmetricGrid(), 'σxx', sigmaXx));
    const { membrane, fitSlope, local } = result.components.σxx;
    let maxResidual = 0;
    for (let i = 0; i < sigmaXx.length; i++) {
      const s = -9.75 + i * 0.5;
      const fitted = membrane + fitSlope * s;
      const residual = sigmaXx[i] - fitted;
      maxResidual = Math.max(maxResidual, Math.abs(residual));
      assert.ok(Math.abs(residual) <= local + TOLERANCE, `residual ${i} exceeds local`);
    }
    closeTo(maxResidual, local, 'maximum per-sample residual equals local');
    closeTo(maxResidual, 185.25, 'maximum per-sample residual hand value');
  });

  // ------------------------------------------------------------------
  // evaluatePart5Allowables
  // ------------------------------------------------------------------
  check('allowables: passing case (membrane ≤ S, membrane+bending ≤ 1.5S)', () => {
    const result = evaluatePart5Allowables(50, 97.5, 2, { S: 150, Sy: 250 });
    assert.strictEqual(result.checks.primaryMembrane.acceptable, true);
    assert.strictEqual(result.checks.primaryMembrane.limit, 150);
    assert.strictEqual(result.checks.primaryMembranePlusBending.acceptable, true);
    assert.strictEqual(result.checks.primaryMembranePlusBending.limit, 225);
    assert.strictEqual(result.checks.primaryPlusSecondary.acceptable, true);
    assert.strictEqual(result.checks.primaryPlusSecondary.limit, 450);
    assert.strictEqual(result.overallAcceptable, true);
    assert.strictEqual(result.checks.peakLocal.assessed, false);
    assert.match(result.checks.peakLocal.reason, /fatigue/i);
    assert.strictEqual(result.checks.yieldSanity.assessed, true);
    assert.strictEqual(result.checks.yieldSanity.acceptable, true);
    closeTo(result.utilization.PmOverS, 1 / 3, 'Pm/S utilization');
    closeTo(result.utilization.PmPbOverOnePointFiveS, (50 + 97.5) / 225, 'Pm+Pb utilization');
  });

  check('allowables: failing case (membrane > S)', () => {
    const result = evaluatePart5Allowables(199.9375, 195, 185.25, { S: 150, Sy: 250 });
    assert.strictEqual(result.checks.primaryMembrane.acceptable, false);
    assert.strictEqual(result.checks.primaryMembranePlusBending.acceptable, false);
    assert.strictEqual(result.checks.primaryPlusSecondary.acceptable, true);
    assert.strictEqual(result.overallAcceptable, false);
    assert.strictEqual(result.checks.yieldSanity.acceptable, false);
  });

  check('allowables: boundary equality (membrane == S is acceptable)', () => {
    const result = evaluatePart5Allowables(150, 0, 0, { S: 150 });
    assert.strictEqual(result.checks.primaryMembrane.acceptable, true);
    closeTo(result.utilization.PmOverS, 1, 'Pm/S utilization at boundary');
  });

  check('allowables: secondary Q can fail the 3S check while Pm/Pb pass', () => {
    const withoutQ = evaluatePart5Allowables(100, 50, 0, { S: 150 });
    assert.strictEqual(withoutQ.checks.primaryMembrane.acceptable, true);
    assert.strictEqual(withoutQ.checks.primaryMembranePlusBending.acceptable, true);
    assert.strictEqual(withoutQ.checks.primaryPlusSecondary.acceptable, true);

    const withQ = evaluatePart5Allowables(100, 50, 0, { S: 150, secondaryQ: 350 });
    assert.strictEqual(withQ.checks.primaryMembrane.acceptable, true);
    assert.strictEqual(withQ.checks.primaryMembranePlusBending.acceptable, true);
    assert.strictEqual(withQ.checks.primaryPlusSecondary.acceptable, false);
    assert.strictEqual(withQ.overallAcceptable, false);
    closeTo(withQ.utilization.PmPbQOverThreeS, (100 + 50 + 350) / 450, 'Pm+Pb+Q utilization');
  });

  check('allowables: large local/peak value does not gate overall acceptance', () => {
    const result = evaluatePart5Allowables(50, 50, 1e6, { S: 150 });
    assert.strictEqual(result.overallAcceptable, true);
    assert.strictEqual(result.checks.peakLocal.assessed, false);
    assert.strictEqual(result.input.F, 1e6);
  });

  check('allowables: static method exposed on analyzer class', () => {
    assert.strictEqual(typeof ASMESectionVIIIDiv2Analyzer.evaluatePart5Allowables, 'function');
    const result = ASMESectionVIIIDiv2Analyzer.evaluatePart5Allowables(10, 10, 0, { S: 100 });
    assert.strictEqual(result.overallAcceptable, true);
  });

  // ------------------------------------------------------------------
  // Normalized SCL coordinate: s = 2z/L - 1 in [-1, 1] so that the
  // through-thickness linear field σ(s) = a + b·s decomposes exactly:
  // P_m = a, P_b = |b| (bending amplitude at the wall surface), F = 0.
  // ------------------------------------------------------------------
  function normalizedGrid() {
    const points = [];
    const n = 41;
    for (let i = 0; i < n; i++) {
      const s = -1 + (2 * i) / (n - 1);
      points.push({ s, σxx: 0, σyy: 0, σzz: 0, τxy: 0, τyz: 0, τzx: 0 });
    }
    return points;
  }

  function independentLeastSquares(values, sValues) {
    let sumS = 0;
    let sumSigma = 0;
    for (let i = 0; i < values.length; i++) {
      sumS += sValues[i];
      sumSigma += values[i];
    }
    const sMean = sumS / values.length;
    const sigmaMean = sumSigma / values.length;
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < values.length; i++) {
      const dx = sValues[i] - sMean;
      numerator += dx * (values[i] - sigmaMean);
      denominator += dx * dx;
    }
    const slope = numerator / denominator;
    let maxResidual = 0;
    for (let i = 0; i < values.length; i++) {
      const residual = values[i] - (sigmaMean + slope * (sValues[i] - sMean));
      maxResidual = Math.max(maxResidual, Math.abs(residual));
    }
    return { membrane: sigmaMean, slope, maxResidual };
  }

  check('linear field on normalized s = 2z/L-1: P_m = a, P_b = |b| exactly', () => {
    const pairs = [
      { a: 50, b: 10 },
      { a: -120, b: 40 },
      { a: 75, b: -35 },
      { a: 0, b: -200 }
    ];
    for (const { a, b } of pairs) {
      const sValues = normalizedGrid().map((p) => p.s);
      const values = sValues.map((s) => a + b * s);
      const result = linearizeStressThroughThickness(normalizedGrid().map((p, i) => ({ ...p, σxx: values[i] })));
      closeTo(result.components.σxx.membrane, a, `membrane a=${a}`);
      closeTo(result.components.σxx.bending, Math.abs(b), `bending b=${b}`);
      closeTo(result.components.σxx.bendingSigned, b, `signed bending b=${b}`);
      assert.ok(result.components.σxx.local <= TOLERANCE, `local must vanish for b=${b}`);
      closeTo(result.envelope.P_m, Math.abs(a), `envelope P_m a=${a}`);
      closeTo(result.envelope.P_b, Math.abs(b), `envelope P_b b=${b}`);
      closeTo(result.envelope.F_local, 0, `envelope F_local for b=${b}`);
    }
  });

  check('linear field: sign-reversing shear component decomposes exactly', () => {
    const a = 35;
    const b = -80;
    const sValues = normalizedGrid().map((p) => p.s);
    const values = sValues.map((s) => a + b * s);
    const result = linearizeStressThroughThickness(normalizedGrid().map((p, i) => ({ ...p, τxy: values[i] })));
    closeTo(result.components.τxy.membrane, a, 'τxy membrane');
    closeTo(result.components.τxy.bending, 80, 'τxy bending magnitude');
    closeTo(result.components.τxy.bendingSigned, b, 'τxy signed bending');
    assert.ok(result.components.τxy.local <= TOLERANCE, 'τxy local must vanish');
    closeTo(result.envelope.P_m, a, 'envelope P_m');
    closeTo(result.envelope.P_b, 80, 'envelope P_b');
  });

  // ------------------------------------------------------------------
  // Nonlinear self-balanced disturbance: σ(s) = a + b·s + c·s³ on
  // s ∈ [-1, 1]. The cubic has zero mean (membrane stays exactly a) but
  // is not orthogonal to s, so the bending must match the independent
  // least-squares slope Σs(σ−σ̄)/Σs² = b + c·Σs⁴/Σs², and the peak must
  // equal the worst residual against that fitted line.
  // ------------------------------------------------------------------
  check('nonlinear cubic field: P_m/P_b match independent least-squares regression', () => {
    const a = 60;
    const b = -25;
    const c = 40;
    const sValues = normalizedGrid().map((p) => p.s);
    const values = sValues.map((s) => a + b * s + c * s * s * s);
    const ref = independentLeastSquares(values, sValues);
    const result = linearizeStressThroughThickness(normalizedGrid().map((p, i) => ({ ...p, σzz: values[i] })));
    closeTo(result.components.σzz.membrane, ref.membrane, 'σzz membrane vs regression');
    closeTo(result.components.σzz.membrane, a, 'σzz membrane stays a (cubic has zero mean)');
    closeTo(result.components.σzz.fitSlope, ref.slope, 'σzz slope vs regression');
    closeTo(result.components.σzz.bending, Math.abs(ref.slope), 'σzz bending vs regression');
    closeTo(result.components.σzz.local, ref.maxResidual, 'σzz local vs regression residual');
    closeTo(result.envelope.P_m, Math.abs(ref.membrane), 'envelope P_m');
    closeTo(result.envelope.P_b, Math.abs(ref.slope), 'envelope P_b');
    closeTo(result.envelope.F_local, ref.maxResidual, 'envelope F_local');
  });

  check('verdict report: decomposed values and verdict strings are present and consistent', () => {
    const sValues = normalizedGrid().map((p) => p.s);
    const values = sValues.map((s) => 80 + 30 * s + 5 * s * s * s);
    const lin = linearizeStressThroughThickness(normalizedGrid().map((p, i) => ({ ...p, σyy: values[i] })));
    assert.strictEqual(lin.envelope.P_m, lin.components.σyy.membrane);
    assert.strictEqual(lin.envelope.P_b, lin.components.σyy.bending);
    assert.strictEqual(lin.envelope.F_local, lin.components.σyy.local);
    assert.ok(Number.isFinite(lin.envelope.P_m) && lin.envelope.P_m >= 0);
    assert.ok(Number.isFinite(lin.envelope.P_b) && lin.envelope.P_b >= 0);
    assert.ok(Number.isFinite(lin.envelope.F_local) && lin.envelope.F_local >= 0);

    const verdict = evaluatePart5Allowables(lin.envelope.P_m, lin.envelope.P_b, lin.envelope.F_local, {
      S: 150,
      Sy: 200
    });
    assert.strictEqual(verdict.input.Pm, lin.envelope.P_m);
    assert.strictEqual(verdict.input.Pb, lin.envelope.P_b);
    assert.strictEqual(verdict.input.F, lin.envelope.F_local);
    assert.strictEqual(verdict.checks.primaryMembrane.rule, 'Pm ≤ S');
    assert.strictEqual(verdict.checks.primaryMembranePlusBending.rule, 'Pm + Pb ≤ 1.5·S');
    assert.strictEqual(verdict.checks.primaryPlusSecondary.rule, 'Pm + Pb + Q ≤ 3·S');
    assert.strictEqual(verdict.checks.primaryMembrane.acceptable, lin.envelope.P_m <= verdict.allowables.S);
    assert.strictEqual(
      verdict.checks.primaryMembranePlusBending.acceptable,
      lin.envelope.P_m + lin.envelope.P_b <= verdict.allowables.onePointFiveS
    );
    assert.strictEqual(
      verdict.overallAcceptable,
      verdict.checks.primaryMembrane.acceptable &&
        verdict.checks.primaryMembranePlusBending.acceptable &&
        verdict.checks.primaryPlusSecondary.acceptable
    );
  });

  // ------------------------------------------------------------------
  // Nozzle-shell junction-like coarse profile: hoop tension that peaks at
  // the nozzle (inner surface) and falls off through the shell wall, plus a
  // strong through-thickness bending gradient and a small local notch
  // perturbation at the inner surface. Uses the SCL class API.
  // ------------------------------------------------------------------
  check('nozzle-shell junction-like profile: decomposed P_m/P_b and verdict consistent', () => {
    const t = 25;
    const n = 9;
    const points = [];
    for (let i = 0; i < n; i++) {
      const x = -t / 2 + (t * i) / (n - 1);
      const sNorm = (2 * x) / t;
      let stress = 105 + 90 * sNorm;
      if (i === 0) {
        stress += 28;
      }
      if (i === n - 1) {
        stress -= 12;
      }
      points.push({ x, stressMpa: stress });
    }
    const analyzer = new ASMESectionVIIIDiv2Analyzer({
      allowableStressS: 150,
      allowableStressSource: 'SA-516 Gr.70 test allowables'
    });
    const report = analyzer.linearizeStressClassificationLine(points, t, false);
    assert.strictEqual(report.dataStatus, 'caller-supplied-unverified');
    assert.strictEqual(report.screeningRule, 'experimental-threshold-multipliers-1x-1.5x-3x');
    closeTo(report.wallThicknessMm, t, 'nozzle wall thickness');
    // Hand-derived trapezoidal integration over the 9-point grid
    // (dx = 3.125, endpoint weights 1/2):
    //   base field: ∫σ = 2625 (Pm = 105), ∫σ·x = 9667.96875 (Pb = 92.8125)
    //   notch +28 at inner / −12 at outer adds Δ∫σ = (14−6)·dx = 25
    //     → Pm = (2625+25)/25 = 106
    //   and Δ∫σ·x = (−14·12.5 − 6·12.5)·dx = −781.25
    //     → Pb = (6/625)·(9667.96875 − 781.25) = 85.3125
    //   worst residual vs fitted line σ_m + (2x/t)·σ_b at the inner
    //   surface: |(105−90+28) − (106−85.3125)| = 22.3125.
    closeTo(report.membraneStressPm, 106, 'nozzle membrane stress');
    closeTo(report.bendingStressPb, 85.3125, 'nozzle bending stress');
    closeTo(report.peakStressF, 22.3125, 'nozzle peak stress');
    closeTo(report.screeningLimitsMpa.suppliedThreshold, 150, 'S limit');
    closeTo(report.screeningLimitsMpa.derived1_5xThreshold, 225, '1.5S limit');
    closeTo(report.screeningLimitsMpa.derived3xThreshold, 450, '3S limit');
    assert.strictEqual(
      report.screening.withinSuppliedPmLimit,
      report.membraneStressPm <= report.screeningLimitsMpa.suppliedThreshold
    );
    assert.strictEqual(
      report.screening.withinSuppliedPmPbLimit,
      report.membraneStressPm + report.bendingStressPb <= report.screeningLimitsMpa.derived1_5xThreshold
    );
    assert.strictEqual(
      report.screening.withinSuppliedPmPbQLimit,
      report.membraneStressPm + report.bendingStressPb + report.secondaryStressQ <=
        report.screeningLimitsMpa.derived3xThreshold
    );
    assert.strictEqual(
      report.screening.withinAllSuppliedLimits,
      report.screening.withinSuppliedPmLimit &&
        report.screening.withinSuppliedPmPbLimit &&
        report.screening.withinSuppliedPmPbQLimit
    );
    assert.strictEqual(report.screening.withinAllSuppliedLimits, true);
    closeTo(report.suppliedLimitRatios.membrane, 150 / 106, 'membrane limit ratio');
    closeTo(report.suppliedLimitRatios.combined, 225 / (106 + 85.3125), 'combined limit ratio');
  });

  // ------------------------------------------------------------------
  // Input validation: non-finite values must raise typed errors.
  // ------------------------------------------------------------------
  check('validation: non-array stressField throws TypeError', () => {
    assert.throws(() => linearizeStressThroughThickness(undefined), TypeError);
    assert.throws(() => linearizeStressThroughThickness({ s: 0 }), TypeError);
  });

  check('validation: fewer than 2 samples throws invalid-input error', () => {
    assert.throws(
      () => linearizeStressThroughThickness([{ s: 0, σxx: 1, σyy: 0, σzz: 0, τxy: 0, τyz: 0, τzx: 0 }]),
      (error) => error.code === 'INVALID_INPUT'
    );
  });

  check('validation: non-finite stress components throw TypeError', () => {
    const base = symmetricGrid();
    const badNaN = withComponent(
      base,
      'σxx',
      base.map(() => NaN)
    );
    assert.throws(() => linearizeStressThroughThickness(badNaN), TypeError);
    const badInfinity = withComponent(
      symmetricGrid()
        .slice(0, 2)
        .map((p) => ({ ...p, s: p.s })),
      'τyz',
      [0, Infinity]
    );
    assert.throws(() => linearizeStressThroughThickness(badInfinity), TypeError);
    const badS = symmetricGrid().map((point, i) => ({
      ...point,
      s: i === 0 ? Infinity : point.s
    }));
    assert.throws(() => linearizeStressThroughThickness(badS), TypeError);
  });

  check('validation: non-numeric or non-strictly-increasing s throws', () => {
    const base = symmetricGrid();
    assert.throws(
      () =>
        linearizeStressThroughThickness(
          withComponent(
            base.map((point, i) => ({ ...point, s: i === 0 ? 'a' : point.s })),
            'σxx',
            linearField(50, 10)
          )
        ),
      TypeError
    );
    const nonMonotonic = symmetricGrid().map((point, i) => ({
      ...point,
      s: i === 1 ? point.s - 0.5 : point.s
    }));
    assert.throws(
      () => linearizeStressThroughThickness(withComponent(nonMonotonic, 'σxx', linearField(50, 10))),
      (error) => error.code === 'INVALID_INPUT'
    );
    const duplicate = base.slice(0, 2).map((point) => ({ ...point, s: 0 }));
    assert.throws(
      () => linearizeStressThroughThickness(withComponent(duplicate, 'σxx', [1, 2])),
      (error) => error.code === 'INVALID_INPUT'
    );
  });

  check('validation: malformed direction or sectionLines handling', () => {
    const field = withComponent(symmetricGrid(), 'σxx', linearField(50, 10));
    assert.throws(() => linearizeStressThroughThickness(field, { direction: '' }), TypeError);
    assert.throws(() => linearizeStressThroughThickness(field, { direction: 7 }), TypeError);
    const result = linearizeStressThroughThickness(field, { direction: 'z', sectionLines: ['A', 'B'] });
    assert.strictEqual(result.direction, 'z');
    assert.deepStrictEqual(result.sectionLines, ['A', 'B']);
  });

  check('validation: allowables reject non-finite or non-positive input', () => {
    assert.throws(() => evaluatePart5Allowables(NaN, 0, 0, { S: 150 }), TypeError);
    assert.throws(() => evaluatePart5Allowables(10, Infinity, 0, { S: 150 }), TypeError);
    assert.throws(() => evaluatePart5Allowables(10, 0, 'x', { S: 150 }), TypeError);
    assert.throws(
      () => evaluatePart5Allowables(10, 0, 0, { S: 0 }),
      (error) => error.code === 'INVALID_INPUT'
    );
    assert.throws(
      () => evaluatePart5Allowables(10, 0, 0, { S: 150, Sy: -5 }),
      (error) => error.code === 'INVALID_INPUT'
    );
    assert.throws(
      () => evaluatePart5Allowables(10, 0, 0, { S: 150, secondaryQ: -1 }),
      (error) => error.code === 'INVALID_INPUT'
    );
  });

  return { ...testResults };
}

if (require.main === module) {
  const results = runAsmeViii2LinearizationTests();
  console.log(`ASME VIII-2 Part 5 linearization: ${results.passed}/${results.total} checks passed.`);
  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

module.exports = { runAsmeViii2LinearizationTests };
