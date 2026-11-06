/**
 * Verification gate for the Random Vibration PSD engine
 * (src/core/cae/random_vibration_psd.js). Battalion 5, Agent 47.
 *
 * Checks:
 *  1. SDOF transfer function: under white-noise base excitation the response
 *     PSD is S_yy(f) = |H(f)|^2 * S_xx(f) with
 *     H(f) = 1 / (1 - (f/fn)^2 + 2 i zeta f/fn). The engine's |H(f)|^2
 *     matches this closed form to 1e-9 across f/fn in [0.1, 3].
 *  2. Miles equation: 1-sigma RMS response = sqrt(pi/2 * fn * Q * PSD0)
 *     with Q = 1/(2 zeta), verified to 0.1% for several (fn, zeta, PSD0)
 *     triples, and equal to the square root of the white-noise response PSD
 *     integral.
 *  3. 1/2/3-sigma levels: engine reports exact 1:2:3 RMS ratios and the
 *     standard Gaussian probability contents 68.3% / 95.4% / 99.7%
 *     (exact: 68.2689% / 95.44997% / 99.73002%).
 *  4. MIL-STD-810H-style shaped input: two segments (flat + dB/octave slope)
 *     integrate to total variance matching independent dense trapezoidal
 *     integration to 0.1%.
 *  5. Stress response: linear scaling stress_RMS = stressPerG * accel_RMS,
 *     verified exactly.
 *
 * Run standalone:  node --test test/test_random_vibration.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { RandomVibrationPSDEngine } = require('../src/core/cae/random_vibration_psd');

function erfc(x) {
  const z = Math.abs(x);
  const t = 1.0 / (1.0 + 0.5 * z);
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? ans : 2.0 - ans;
}

function gaussCdf(x) {
  return 0.5 * erfc(-x / Math.SQRT2);
}

function sdofH2Reference(r, zeta) {
  const denom = (1.0 - r * r) * (1.0 - r * r) + 4.0 * zeta * zeta * r * r;
  return 1.0 / denom;
}

test('SDOF transfer function |H(f)|^2 matches closed form to 1e-9 across f/fn in [0.1, 3]', () => {
  const fn = 100.0;
  for (const zeta of [0.005, 0.01, 0.05, 0.1, 0.2]) {
    const q = 1.0 / (2.0 * zeta);
    for (let r = 0.1; r <= 3.0 + 1e-12; r += 0.02) {
      const h2Ref = sdofH2Reference(r, zeta);
      const h2Eng = RandomVibrationPSDEngine.sdofTransferFunctionMagnitudeSquared(r * fn, fn, zeta);
      assert.ok(Math.abs(h2Eng - h2Ref) < 1e-9, `zeta=${zeta} r=${r}: engine ${h2Eng} vs reference ${h2Ref}`);
    }
    assert.ok(Math.abs(RandomVibrationPSDEngine.sdofTransferFunctionMagnitudeSquared(0, fn, zeta) - 1.0) < 1e-9);
    assert.ok(Math.abs(RandomVibrationPSDEngine.sdofTransferFunctionMagnitudeSquared(fn, fn, zeta) - q * q) < 1e-9);
    assert.ok(
      Math.abs(
        RandomVibrationPSDEngine.sdofTransferFunctionMagnitudeSquared(10 * fn, fn, zeta) - sdofH2Reference(10, zeta)
      ) < 1e-9
    );
  }
});

test('white-noise response PSD S_yy(f) = |H(f)|^2 * S_xx(f)', () => {
  const fn = 120.0;
  const zeta = 0.03;
  const psd0 = 0.02;
  for (let r = 0.1; r <= 3.0 + 1e-12; r += 0.07) {
    const f = r * fn;
    const sYy = RandomVibrationPSDEngine.sdofResponsePsd(f, psd0, fn, zeta);
    assert.ok(
      Math.abs(sYy - sdofH2Reference(r, zeta) * psd0) < 1e-9,
      `r=${r}: engine ${sYy} vs reference ${sdofH2Reference(r, zeta) * psd0}`
    );
  }
});

test('Miles equation: 1-sigma RMS matches sqrt(pi/2 * fn * Q * PSD0) to 0.1%', () => {
  const triples = [
    [100, 0.05, 0.04],
    [60, 0.02, 0.1],
    [250, 0.01, 0.02],
    [400, 0.08, 0.01],
    [800, 0.005, 0.001],
    [40, 0.2, 0.2],
    [1000, 0.02, 0.005]
  ];
  for (const [fn, zeta, psd0] of triples) {
    const q = 1.0 / (2.0 * zeta);
    const gRef = Math.sqrt((Math.PI / 2.0) * fn * q * psd0);
    const res = RandomVibrationPSDEngine.evaluateMilesVibration({
      naturalFrequencyHz: fn,
      dampingRatio: zeta,
      psdLevelG2Hz: psd0,
      staticStressPerG: 1e6
    });
    assert.strictEqual(res.qualityFactorQ, q);
    assert.strictEqual(res.dampingRatio, zeta);
    assert.ok(Number.isFinite(res.gRms) && res.gRms > 0);
    const delta = Math.abs(res.gRms - gRef) / gRef;
    assert.ok(
      delta < 1e-3,
      `fn=${fn} zeta=${zeta} psd=${psd0}: engine ${res.gRms} vs reference ${gRef}, delta=${delta}`
    );
  }
});

test('Miles 1-sigma equals sqrt of integrated white-noise response PSD variance', () => {
  const fn = 150.0;
  const zeta = 0.04;
  const psd0 = 0.05;
  const q = 1.0 / (2.0 * zeta);
  const gMiles = Math.sqrt((Math.PI / 2.0) * fn * q * psd0);
  const rMin = 0.002;
  const rMax = 12.0;
  const n = 60000;
  const dr = (rMax - rMin) / n;
  let area = 0.0;
  for (let i = 0; i < n; i++) {
    const r0 = rMin + i * dr;
    const r1 = rMin + (i + 1) * dr;
    const h0 = RandomVibrationPSDEngine.sdofTransferFunctionMagnitudeSquared(r0 * fn, fn, zeta);
    const h1 = RandomVibrationPSDEngine.sdofTransferFunctionMagnitudeSquared(r1 * fn, fn, zeta);
    area += 0.5 * (h0 + h1) * (r1 - r0) * fn;
  }
  const gInt = Math.sqrt(psd0 * area);
  assert.ok(Math.abs(gInt - gMiles) / gMiles < 1e-3, `integrated ${gInt} vs Miles ${gMiles}`);
  const res = RandomVibrationPSDEngine.evaluateMilesVibration({
    naturalFrequencyHz: fn,
    dampingRatio: zeta,
    psdLevelG2Hz: psd0
  });
  assert.ok(Math.abs(res.gRms - gMiles) / gMiles < 1e-3, `engine ${res.gRms} vs Miles ${gMiles}`);
});

test('1/2/3-sigma: exact 1:2:3 RMS ratios and standard Gaussian probability levels', () => {
  const res = RandomVibrationPSDEngine.evaluateMilesVibration({
    naturalFrequencyHz: 200,
    dampingRatio: 0.05,
    psdLevelG2Hz: 0.04,
    staticStressPerG: 1.5e6
  });
  assert.strictEqual(res.gRms, res.acceleration1SigmaG);
  assert.strictEqual(res.acceleration2SigmaG, 2 * res.acceleration1SigmaG);
  assert.strictEqual(res.acceleration3SigmaG, 3 * res.acceleration1SigmaG);
  assert.strictEqual(res.stress3SigmaPeakMPa, 3 * res.stressRmsMPa);

  const p1 = 100.0 * (gaussCdf(1) - gaussCdf(-1));
  const p2 = 100.0 * (gaussCdf(2) - gaussCdf(-2));
  const p3 = 100.0 * (gaussCdf(3) - gaussCdf(-3));
  assert.ok(Math.abs(p1 - 68.26894921370858) < 1e-4, `P(1 sigma)=${p1}`);
  assert.ok(Math.abs(p2 - 95.44997361036416) < 1e-4, `P(2 sigma)=${p2}`);
  assert.ok(Math.abs(p3 - 99.73002039367438) < 1e-4, `P(3 sigma)=${p3}`);
  assert.ok(Math.abs(p1 - 68.3) < 0.05 && Math.abs(p2 - 95.4) < 0.05 && Math.abs(p3 - 99.7) < 0.05);
});

test('MIL-STD-810H-style two-segment PSD (flat + dB/octave slope) integrates to total variance to 0.1%', () => {
  const fFlat0 = 20.0;
  const fFlat1 = 200.0;
  const fSlope1 = 2000.0;
  const pFlat = 0.04;
  const pSlope1 = pFlat * Math.pow(fSlope1 / fFlat1, 2);
  const curve = [
    { f: fFlat0, psd: pFlat },
    { f: fFlat1, psd: pFlat },
    { f: fSlope1, psd: pSlope1 }
  ];
  const eng = RandomVibrationPSDEngine.integratePSDCurve(curve);
  const refAreaAnalytic = pFlat * (fFlat1 - fFlat0) + (pSlope1 * fSlope1 - pFlat * fFlat1) / 3.0;
  assert.ok(Math.abs(eng.totalArea - refAreaAnalytic) / refAreaAnalytic < 1e-9);
  const n = 4000;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = fFlat0 + ((fSlope1 - fFlat0) * i) / n;
    const psd = f <= fFlat1 ? pFlat : pFlat * Math.pow(f / fFlat1, 2);
    pts.push({ f, psd });
  }
  let refArea = 0.0;
  for (let i = 0; i < n; i++) {
    refArea += 0.5 * (pts[i].psd + pts[i + 1].psd) * (pts[i + 1].f - pts[i].f);
  }
  assert.ok(Math.abs(eng.totalArea - refArea) / refArea < 1e-3, `engine ${eng.totalArea} vs trapezoidal ${refArea}`);
  const gRef = Math.sqrt(refArea);
  assert.ok(Math.abs(eng.overallGrms - gRef) / gRef < 1e-3, `engine ${eng.overallGrms} vs ${gRef}`);

  const flat = RandomVibrationPSDEngine.integratePSDCurve([
    { f: 20, psd: 0.04 },
    { f: 2000, psd: 0.04 }
  ]);
  assert.ok(Math.abs(flat.totalArea - 0.04 * 1980) < 1e-9);

  const minus = RandomVibrationPSDEngine.integratePSDCurve([
    { f: 10, psd: 0.1 },
    { f: 100, psd: 0.1 },
    { f: 1000, psd: 0.01 }
  ]);
  const refMinus = 0.1 * 90 + 0.1 * 100 * Math.log(10);
  assert.ok(Math.abs(minus.totalArea - refMinus) / refMinus < 1e-6);
});

test('stress response scales exactly: stress_RMS = stressPerG * accel_RMS', () => {
  const cases = [
    [150, 0.05, 0.04, 1.5e6],
    [300, 0.02, 0.01, 2.2e6],
    [80, 0.1, 0.08, 0.6e6],
    [500, 0.01, 0.003, 3.8e6]
  ];
  for (const [fn, zeta, psd0, stressPerG] of cases) {
    const res = RandomVibrationPSDEngine.evaluateMilesVibration({
      naturalFrequencyHz: fn,
      dampingRatio: zeta,
      psdLevelG2Hz: psd0,
      staticStressPerG: stressPerG
    });
    assert.strictEqual(res.stressRmsMPa, (res.gRms * stressPerG) / 1e6);
    assert.strictEqual(res.stressRmsMPa, (res.acceleration1SigmaG * stressPerG) / 1e6);
    assert.strictEqual(res.stress3SigmaPeakMPa, 3 * res.stressRmsMPa);
  }
});

test('defaults match documented values', () => {
  const res = RandomVibrationPSDEngine.evaluateMilesVibration({});
  assert.strictEqual(res.naturalFrequencyHz, 150);
  assert.strictEqual(res.dampingRatio, 0.05);
  assert.strictEqual(res.qualityFactorQ, 10);
  assert.strictEqual(res.psdInputG2Hz, 0.04);
  const gRef = Math.sqrt((Math.PI / 2.0) * 150 * 10 * 0.04);
  assert.ok(Math.abs(res.gRms - gRef) < 1e-9);
});
