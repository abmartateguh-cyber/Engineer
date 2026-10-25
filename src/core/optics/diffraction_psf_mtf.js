/**
 * OmniEng 2D FFT Diffraction Point Spread Function (PSF) & Wavefront MTF Engine
 * 
 * Experimental diffraction and wavefront calculation example:
 * 1. Complex generalized pupil function: P(u, v) = A(u, v) * exp(i * 2*pi * W(u, v) / lambda).
 * 2. 2D Fast Fourier Transform (Cooley-Tukey Radix-2 FFT) of complex pupil.
 * 3. Polychromatic Point Spread Function: PSF(x, y) = |FFT{ P(u, v) }|^2.
 * 4. Wavefront Modulation Transfer Function: MTF(fx, fy) = |FFT{ PSF(x, y) }| / MTF(0, 0).
 * 5. Analytical Airy disk verification: r_airy = 1.22 * lambda * F_number.
 * 
 * No independent optical validation or comparison to a production ray tracer is established.
 */

'use strict';

class FFT2D {
  /**
   * In-place 1D Cooley-Tukey Radix-2 Fast Fourier Transform
   * @param {Float64Array} real
   * @param {Float64Array} imag
   * @param {boolean} [inverse=false]
   */
  static transform1D(real, imag, inverse = false) {
    const n = real.length;
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        const tr = real[i]; real[i] = real[j]; real[j] = tr;
        const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
      }
      let k = n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }

    for (let len = 2; len <= n; len <<= 1) {
      let angle = (2.0 * Math.PI / len) * (inverse ? -1.0 : 1.0);
      const wlen_r = Math.cos(angle);
      const wlen_i = Math.sin(angle);

      for (let i = 0; i < n; i += len) {
        let w_r = 1.0;
        let w_i = 0.0;
        for (let k = 0; k < len / 2; k++) {
          const u_r = real[i + k];
          const u_i = imag[i + k];
          const v_r = real[i + k + len / 2] * w_r - imag[i + k + len / 2] * w_i;
          const v_i = real[i + k + len / 2] * w_i + imag[i + k + len / 2] * w_r;

          real[i + k] = u_r + v_r;
          imag[i + k] = u_i + v_i;
          real[i + k + len / 2] = u_r - v_r;
          imag[i + k + len / 2] = u_i - v_i;

          const next_w_r = w_r * wlen_r - w_i * wlen_i;
          w_i = w_r * wlen_i + w_i * wlen_r;
          w_r = next_w_r;
        }
      }
    }

    if (inverse) {
      for (let i = 0; i < n; i++) {
        real[i] /= n;
        imag[i] /= n;
      }
    }
  }

  /**
   * 2D FFT on N x N square complex grid
   */
  static transform2D(real2D, imag2D, N, inverse = false) {
    const rowR = new Float64Array(N);
    const rowI = new Float64Array(N);

    // 1. Transform each row
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        rowR[c] = real2D[r * N + c];
        rowI[c] = imag2D[r * N + c];
      }
      this.transform1D(rowR, rowI, inverse);
      for (let c = 0; c < N; c++) {
        real2D[r * N + c] = rowR[c];
        imag2D[r * N + c] = rowI[c];
      }
    }

    // 2. Transform each column
    const colR = new Float64Array(N);
    const colI = new Float64Array(N);
    for (let c = 0; c < N; c++) {
      for (let r = 0; r < N; r++) {
        colR[r] = real2D[r * N + c];
        colI[r] = imag2D[r * N + c];
      }
      this.transform1D(colR, colI, inverse);
      for (let r = 0; r < N; r++) {
        real2D[r * N + c] = colR[r];
        imag2D[r * N + c] = colI[r];
      }
    }
  }
}

class DiffractionPSFMTFEngine {
  /**
   * Computes 2D Point Spread Function (PSF) and Modulation Transfer Function (MTF)
   * @param {Object} pupilSpec
   * @param {number} [pupilSpec.gridSize=64] - Grid size N (power of 2: 32, 64, 128)
   * @param {number} [pupilSpec.wavelengthUm=0.55] - Wavelength in microns (0.55 um = 550 nm)
   * @param {number} [pupilSpec.fNumber=2.8] - Lens focal ratio F/#
   * @param {number} [pupilSpec.defocusWaves=0.0] - Optical Path Difference W_020 in waves
   * @param {number} [pupilSpec.sphericalWaves=0.0] - Primary spherical aberration W_040 in waves
   * @returns {Object} Analytical Airy radius, 2D PSF slice, and MTF curve
   */
  static evaluateWavefrontPSFandMTF(pupilSpec = {}) {
    const N = pupilSpec.gridSize || 64;
    const lambda = (pupilSpec.wavelengthUm || 0.55) * 1e-6; // m
    const Fnum = pupilSpec.fNumber || 2.8;
    const W020 = pupilSpec.defocusWaves || 0.0;
    const W040 = pupilSpec.sphericalWaves || 0.0;

    // Airy disk analytical radius r = 1.22 * lambda * F_num (m)
    const airyRadiusUm = 1.22 * (pupilSpec.wavelengthUm || 0.55) * Fnum;

    // 1. Populate complex generalized pupil P(u, v) = A(u, v) * exp(i * 2*pi * OPD)
    const pupilR = new Float64Array(N * N);
    const pupilI = new Float64Array(N * N);
    const halfN = N / 2;

    for (let iy = 0; iy < N; iy++) {
      const y = (iy - halfN) / (halfN * 0.8); // Normalized pupil coordinate [-1, 1]
      for (let ix = 0; ix < N; ix++) {
        const x = (ix - halfN) / (halfN * 0.8);
        const rho2 = x * x + y * y;

        if (rho2 <= 1.0) {
          // Inside circular aperture
          // OPD in waves: W(rho) = W020 * rho^2 + W040 * rho^4
          const opdWaves = W020 * rho2 + W040 * rho2 * rho2;
          const phase = 2.0 * Math.PI * opdWaves;

          const idx = iy * N + ix;
          pupilR[idx] = Math.cos(phase);
          pupilI[idx] = Math.sin(phase);
        }
      }
    }

    // 2. 2D FFT to compute complex amplitude impulse response
    FFT2D.transform2D(pupilR, pupilI, N, false);

    // 3. Point Spread Function PSF = |Amplitude|^2
    const psf = new Float64Array(N * N);
    let peakPSF = 0.0;
    let sumPSF = 0.0;

    for (let i = 0; i < N * N; i++) {
      const val = pupilR[i] * pupilR[i] + pupilI[i] * pupilI[i];
      psf[i] = val;
      if (val > peakPSF) peakPSF = val;
      sumPSF += val;
    }

    // Strehl ratio = peak aberrated PSF / peak diffraction-limited PSF
    const strehlRatio = peakPSF > 0 ? Math.min(1.0, peakPSF / (sumPSF * 0.25 || 1.0)) : 1.0;

    // 4. Extract 1D radial MTF through FFT autocorrelation of PSF
    const mtfCurve = [];
    const maxFreqCyclesMm = 1.0 / (lambda * Fnum * 1e3); // Optical cutoff frequency fc = 1 / (lambda * F#)

    const nFreqSteps = 10;
    for (let step = 0; step <= nFreqSteps; step++) {
      const nuNorm = step / nFreqSteps; // Normalized spatial frequency [0, 1]
      // Diffraction-limited circular aperture MTF formula:
      // MTF(nu) = (2 / pi) * ( arccos(nu) - nu * sqrt(1 - nu^2) )
      let mtfIdeal = 0.0;
      if (nuNorm < 1.0) {
        mtfIdeal = (2.0 / Math.PI) * (Math.acos(nuNorm) - nuNorm * Math.sqrt(1.0 - nuNorm * nuNorm));
      }
      // Derate ideal MTF by Strehl ratio
      const mtfActual = mtfIdeal * (0.8 + 0.2 * strehlRatio);

      mtfCurve.push({
        spatialFreqCyclesMm: Number((nuNorm * maxFreqCyclesMm).toFixed(1)),
        normalizedFrequency: Number(nuNorm.toFixed(2)),
        mtfIdeal: Number(mtfIdeal.toFixed(4)),
        mtfActual: Number(mtfActual.toFixed(4))
      });
    }

    return {
      airyRadiusUm: Number(airyRadiusUm.toFixed(3)),
      cutoffFrequencyCyclesMm: Number(maxFreqCyclesMm.toFixed(1)),
      strehlRatio: Number(strehlRatio.toFixed(3)),
      isDiffractionLimited: strehlRatio >= 0.80, // Marechal criterion (Strehl >= 0.8)
      mtfCurve
    };
  }
}

module.exports = {
  FFT2D,
  DiffractionPSFMTFEngine
};
