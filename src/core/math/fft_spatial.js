'use strict';

/**
 * OmniEng FFT spatial utilities.
 *
 * Deterministic, dependency-free Cooley-Tukey fast Fourier transforms in
 * pure JavaScript (Math.* + typed arrays only). Power-of-two lengths use an
 * iterative radix-2 path; all other lengths use an in-place mixed-radix
 * decomposition (smallest prime factor first, with an in-place block
 * transpose at each merge). Forward and inverse transforms are provided for
 * 1D and separable 2D data.
 *
 * Conventions:
 *   - Forward: X[k] = sum_{n=0}^{N-1} x[n] * exp(-2*pi*i*n*k/N), unnormalized.
 *   - Inverse: x[n] = (1/N) * sum_{k=0}^{N-1} X[k] * exp(+2*pi*i*n*k/N).
 *   - Parseval: sum|x[n]|^2 == (1/N) * sum|X[k]|^2.
 *   - All transforms operate in place on the supplied real/imag arrays and
 *     return them. Float64Array is recommended; any index-addressable
 *     numeric arrays with equal lengths are accepted.
 */

const TWO_PI = 2 * Math.PI;

function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function smallestPrimeFactor(n) {
  for (let p = 2; p * p <= n; p++) {
    if (n % p === 0) return p;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Iterative radix-2 (power-of-two lengths): bit-reversal permutation followed
// by log2(N) decimation-in-time butterfly stages with incremental twiddles.
// ---------------------------------------------------------------------------
function fftRadix2InPlace(re, im) {
  const n = re.length;

  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = TWO_PI / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = -Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const uRe = re[b] * wRe - im[b] * wIm;
        const uIm = re[b] * wIm + im[b] * wRe;
        re[b] = re[a] - uRe;
        im[b] = im[a] - uIm;
        re[a] += uRe;
        im[a] += uIm;
        const nwRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nwRe;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mixed-radix (arbitrary lengths). Recursive Cooley-Tukey DIT: for N = r*m
// with r the smallest prime factor, compute r-point DFTs on strided groups,
// apply twiddle factors, recurse on the m subproblems, then transpose the
// r-by-m block in place so results land in natural frequency order.
// ---------------------------------------------------------------------------
let scratchRe = new Float64Array(0);
let scratchIm = new Float64Array(0);

function transposeBlock(re, im, off, stride, r, m) {
  const n = r * m;
  const visited = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (visited[s]) continue;
    let cur = s;
    let valRe = re[off + cur * stride];
    let valIm = im[off + cur * stride];
    do {
      visited[cur] = 1;
      const k1 = (cur / m) | 0;
      const i0 = cur % m;
      const nxt = k1 + i0 * r;
      const saveRe = re[off + nxt * stride];
      const saveIm = im[off + nxt * stride];
      re[off + nxt * stride] = valRe;
      im[off + nxt * stride] = valIm;
      valRe = saveRe;
      valIm = saveIm;
      cur = nxt;
    } while (cur !== s);
  }
}

function fftMixedRadixInPlace(re, im, off, stride, n) {
  if (n <= 1) return;
  const r = smallestPrimeFactor(n);
  const m = n / r;
  if (scratchRe.length < r) {
    scratchRe = new Float64Array(r);
    scratchIm = new Float64Array(r);
  }

  for (let i0 = 0; i0 < m; i0++) {
    const base = off + i0 * stride;
    for (let i1 = 0; i1 < r; i1++) {
      scratchRe[i1] = re[base + i1 * m * stride];
      scratchIm[i1] = im[base + i1 * m * stride];
    }
    for (let k1 = 0; k1 < r; k1++) {
      let sumRe = 0;
      let sumIm = 0;
      for (let i1 = 0; i1 < r; i1++) {
        const ang = (TWO_PI * i1 * k1) / r;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        sumRe += scratchRe[i1] * c + scratchIm[i1] * s;
        sumIm += -scratchRe[i1] * s + scratchIm[i1] * c;
      }
      re[base + k1 * m * stride] = sumRe;
      im[base + k1 * m * stride] = sumIm;
    }
  }

  for (let k1 = 0; k1 < r; k1++) {
    for (let i0 = 0; i0 < m; i0++) {
      const ang = (TWO_PI * i0 * k1) / n;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const pos = off + (k1 * m + i0) * stride;
      const reV = re[pos];
      const imV = im[pos];
      re[pos] = reV * c + imV * s;
      im[pos] = -reV * s + imV * c;
    }
  }

  for (let k1 = 0; k1 < r; k1++) {
    fftMixedRadixInPlace(re, im, off + k1 * m * stride, stride, m);
  }

  transposeBlock(re, im, off, stride, r, m);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * In-place 1D forward FFT. Returns the same (re, im) arrays.
 */
function fft1d(re, im) {
  if (re.length !== im.length) {
    throw new TypeError('fft1d: real and imaginary arrays must have equal lengths');
  }
  const n = re.length;
  if (n < 2) return [re, im];
  if (isPowerOfTwo(n)) {
    fftRadix2InPlace(re, im);
  } else {
    fftMixedRadixInPlace(re, im, 0, 1, n);
  }
  return [re, im];
}

/**
 * In-place 1D inverse FFT. Returns the same (re, im) arrays.
 */
function ifft1d(re, im) {
  const n = re.length;
  if (n < 2) return [re, im];
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft1d(re, im);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
  return [re, im];
}

let columnRe = new Float64Array(0);
let columnIm = new Float64Array(0);

/**
 * In-place separable 2D forward FFT of an rows-by-cols signal stored in
 * row-major order (index = row * cols + col). Returns (re, im).
 */
function fft2d(re, im, rows, cols) {
  const size = rows * cols;
  if (re.length !== size || im.length !== size) {
    throw new TypeError('fft2d: real/imag arrays must have length rows * cols');
  }
  if (size < 2) return [re, im];
  const maxDim = Math.max(rows, cols);
  if (columnRe.length < maxDim) {
    columnRe = new Float64Array(maxDim);
    columnIm = new Float64Array(maxDim);
  }
  for (let row = 0; row < rows; row++) {
    fft1d(re.subarray(row * cols, (row + 1) * cols), im.subarray(row * cols, (row + 1) * cols));
  }
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      columnRe[row] = re[row * cols + col];
      columnIm[row] = im[row * cols + col];
    }
    fft1d(columnRe.subarray(0, rows), columnIm.subarray(0, rows));
    for (let row = 0; row < rows; row++) {
      re[row * cols + col] = columnRe[row];
      im[row * cols + col] = columnIm[row];
    }
  }
  return [re, im];
}

/**
 * In-place separable 2D inverse FFT. Returns (re, im).
 */
function ifft2d(re, im, rows, cols) {
  const size = rows * cols;
  if (size < 2) return [re, im];
  for (let i = 0; i < size; i++) im[i] = -im[i];
  fft2d(re, im, rows, cols);
  for (let i = 0; i < size; i++) {
    re[i] /= size;
    im[i] = -im[i] / size;
  }
  return [re, im];
}

module.exports = {
  fft1d,
  ifft1d,
  fft2d,
  ifft2d,
  isPowerOfTwo,
  nextPowerOfTwo,
  smallestPrimeFactor
};
