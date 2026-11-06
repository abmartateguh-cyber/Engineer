'use strict';

/**
 * OmniEng verification gate for the FFT spatial module
 * (src/core/math/fft_spatial.js).
 *
 * Verifies 1D FFT bin localization and amplitudes for a two-sinusoid input,
 * Parseval's theorem, inverse round-trips (power-of-two and odd lengths),
 * impulse-response flatness, 2D delta/separability behavior, and a generous
 * wall-clock performance bound for N=1024 on this host. All inputs are
 * deterministic (seeded PRNG, no Math.random).
 *
 * Run standalone:  node --test test/test_fft_spatial.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { fft1d, ifft1d, fft2d, ifft2d } = require('../src/core/math/fft_spatial');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function complexNorm(re, im) {
  let sum = 0;
  for (let i = 0; i < re.length; i++) sum += re[i] * re[i] + im[i] * im[i];
  return Math.sqrt(sum);
}

function maxAbsDiff(reA, imA, reB, imB) {
  let max = 0;
  for (let i = 0; i < reA.length; i++) {
    const d = Math.hypot(reA[i] - reB[i], imA[i] - imB[i]);
    if (d > max) max = d;
  }
  return max;
}

test('FFT 1D: two-sinusoid spectrum peaks exactly at bins 7 and 23 with correct amplitudes', () => {
  const N = 1024;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    re[n] = Math.cos((2 * Math.PI * 7 * n) / N) + 0.5 * Math.sin((2 * Math.PI * 23 * n) / N);
  }

  fft1d(re, im);

  const mag = new Float64Array(N);
  for (let k = 0; k < N; k++) mag[k] = Math.hypot(re[k], im[k]);

  const positiveBins = Array.from({ length: N / 2 - 1 }, (_, i) => i + 1);
  const order = positiveBins.sort((a, b) => mag[b] - mag[a]);
  const top1 = order[0];
  const top2 = order[1];
  assert.ok(Math.abs(top1 - 7) <= 1, `expected spectral peak near bin 7, got ${top1}`);
  assert.ok(Math.abs(top2 - 23) <= 1, `expected spectral peak near bin 23, got ${top2}`);

  const amp7 = mag[7];
  const amp23 = mag[23];
  assert.ok(Math.abs(amp7 - N / 2) / (N / 2) < 1e-3, `|X[7]|=${amp7}, expected ~512 within 0.1%`);
  assert.ok(Math.abs(amp23 - N / 4) / (N / 4) < 1e-3, `|X[23]|=${amp23}, expected ~256 within 0.1%`);

  const mirror7 = mag[N - 7];
  const mirror23 = mag[N - 23];
  assert.ok(Math.abs(mirror7 - N / 2) / (N / 2) < 1e-3, `|X[N-7]|=${mirror7} within 0.1%`);
  assert.ok(Math.abs(mirror23 - N / 4) / (N / 4) < 1e-3, `|X[N-23]|=${mirror23} within 0.1%`);
});

test('FFT 1D: Parseval theorem holds to < 1e-10 relative', () => {
  const N = 1024;
  const rng = mulberry32(0x5eed1234);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let timeSum = 0;
  for (let n = 0; n < N; n++) {
    re[n] = rng() * 2 - 1;
    im[n] = rng() * 2 - 1;
    timeSum += re[n] * re[n] + im[n] * im[n];
  }

  fft1d(re, im);

  let freqSum = 0;
  for (let k = 0; k < N; k++) freqSum += re[k] * re[k] + im[k] * im[k];
  const normalizedFreqSum = freqSum / N;

  const rel = Math.abs(timeSum - normalizedFreqSum) / timeSum;
  assert.ok(rel < 1e-10, `Parseval relative error ${rel} >= 1e-10`);
});

test('FFT 1D: inverse round-trip reconstructs input to < 1e-10 relative (power-of-two and odd lengths)', () => {
  for (const N of [1024, 63, 1001, 125]) {
    const rng = mulberry32(0xabcdef01 + N);
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      re[n] = rng() * 2 - 1;
      im[n] = rng() * 2 - 1;
    }
    const re0 = Float64Array.from(re);
    const im0 = Float64Array.from(im);

    fft1d(re, im);
    ifft1d(re, im);

    const norm = complexNorm(re0, im0);
    const err = maxAbsDiff(re, im, re0, im0) / norm;
    assert.ok(err < 1e-10, `N=${N}: round-trip relative error ${err} >= 1e-10`);
  }
});

test('FFT 1D: impulse response gives flat spectrum to 1e-9', () => {
  for (const N of [1024, 63]) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    re[0] = 1;

    fft1d(re, im);

    for (let k = 0; k < N; k++) {
      const mag = Math.hypot(re[k], im[k]);
      assert.ok(Math.abs(mag - 1) < 1e-9, `N=${N}: |X[${k}]|=${mag}, expected 1 within 1e-9`);
    }
  }
});

test('FFT 2D: impulse at (5,7) yields flat unit magnitude spectrum to 1e-9', () => {
  const rows = 32;
  const cols = 32;
  const re = new Float64Array(rows * cols);
  const im = new Float64Array(rows * cols);
  re[5 * cols + 7] = 1;

  fft2d(re, im, rows, cols);

  for (let k = 0; k < re.length; k++) {
    const mag = Math.hypot(re[k], im[k]);
    assert.ok(Math.abs(mag - 1) < 1e-9, `|X[${k}]|=${mag}, expected 1 within 1e-9`);
  }

  ifft2d(re, im, rows, cols);

  let residual = 0;
  for (let i = 0; i < rows * cols; i++) {
    const d = Math.hypot(re[i] - (i === 5 * cols + 7 ? 1 : 0), im[i]);
    if (d > residual) residual = d;
  }
  assert.ok(residual < 1e-10, `2D impulse round-trip residual ${residual} >= 1e-10`);
});

test('FFT 2D: separability — 2D FFT equals 1D FFT along rows then columns to 1e-10', () => {
  const rows = 16;
  const cols = 24;
  const rng = mulberry32(0x2d2d2d);
  const re = new Float64Array(rows * cols);
  const im = new Float64Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    re[i] = rng() * 2 - 1;
    im[i] = rng() * 2 - 1;
  }

  const refRe = Float64Array.from(re);
  const refIm = Float64Array.from(im);
  fft2d(re, im, rows, cols);

  for (let row = 0; row < rows; row++) {
    fft1d(refRe.subarray(row * cols, (row + 1) * cols), refIm.subarray(row * cols, (row + 1) * cols));
  }
  const tmpRe = new Float64Array(rows);
  const tmpIm = new Float64Array(rows);
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      tmpRe[row] = refRe[row * cols + col];
      tmpIm[row] = refIm[row * cols + col];
    }
    fft1d(tmpRe, tmpIm);
    for (let row = 0; row < rows; row++) {
      refRe[row * cols + col] = tmpRe[row];
      refIm[row * cols + col] = tmpIm[row];
    }
  }

  const scale = complexNorm(refRe, refIm);
  const err = maxAbsDiff(re, im, refRe, refIm) / scale;
  assert.ok(err < 1e-10, `2D separability relative error ${err} >= 1e-10`);
});

test('FFT 1D: N=1024 executes in well under 500ms on this host (recorded)', () => {
  const N = 1024;
  const rng = mulberry32(0xfeedface);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    re[n] = rng() * 2 - 1;
    im[n] = rng() * 2 - 1;
  }

  const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

  fft1d(re, im);
  const t0 = nowMs();
  fft1d(re, im);
  const t1 = nowMs();
  const measuredMs = t1 - t0;

  console.log(`  [perf] 1D FFT N=1024: ${measuredMs.toFixed(3)} ms`);
  assert.ok(measuredMs < 500, `1D FFT N=1024 took ${measuredMs.toFixed(2)}ms, exceeded 500ms budget`);
});
