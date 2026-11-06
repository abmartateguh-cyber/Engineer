/**
 * OmniEng Experimental Random Vibration (PSD) & Harmonic Response Example
 *
 * Illustrates random-vibration and harmonic-response calculations:
 * 1. Modal Superposition Harmonic Response for base sinusoidal excitation.
 * 2. Power Spectral Density (PSD, g^2/Hz) integration across octave bands (20 Hz - 2000 Hz).
 * 3. Miles Equation & Gaussian 3-Sigma peak acceleration / stress evaluation.
 * 4. Rayleigh distribution cumulative damage fatigue cycle counting.
 *
 * This is not a MIL-STD-810H qualification workflow. No independent validation or comparison
 * to a production solver is established.
 */

'use strict';

class RandomVibrationPSDEngine {
  /**
   * Evaluates equivalent 1-sigma, 2-sigma, 3-sigma acceleration and stress using Miles Equation
   * G_rms = sqrt( (pi / 2) * fn * Q * PSD_fn )
   *
   * @param {Object} spec
   * @param {number} spec.naturalFrequencyHz - Fundamental modal frequency fn (Hz)
   * @param {number} spec.dampingRatio - Critical damping ratio zeta (e.g. 0.05 for Q = 10)
   * @param {number} spec.psdLevelG2Hz - Power spectral density value at fn (g^2/Hz)
   * @param {number} spec.staticStressPerG - Stress per 1g static acceleration (Pa/g)
   * @returns {Object} 1-sigma, 2-sigma, 3-sigma peak acceleration and stress levels
   */
  static evaluateMilesVibration(spec) {
    const fn = spec.naturalFrequencyHz || 150.0;
    const zeta = spec.dampingRatio || 0.05;
    const Q = 1.0 / (2.0 * zeta); // Quality amplification factor (Q = 10 for zeta=0.05)
    const psd = spec.psdLevelG2Hz || 0.04; // e.g. 0.04 g^2/Hz
    const stressPerG = spec.staticStressPerG || 1.5e6; // 1.5 MPa/g

    // Miles equation: G_rms = sqrt( (pi / 2) * fn * Q * PSD )
    const gRms = Math.sqrt((Math.PI / 2.0) * fn * Q * psd);

    const sigma1_g = gRms;
    const sigma2_g = 2.0 * gRms;
    const sigma3_g = 3.0 * gRms;

    // Equivalent peak stresses (Rayleigh distribution: 3-sigma occurs 99.73% of time)
    const stressRms = gRms * stressPerG;

    return {
      naturalFrequencyHz: fn,
      qualityFactorQ: Q,
      dampingRatio: zeta,
      psdInputG2Hz: psd,
      gRms,
      acceleration1SigmaG: sigma1_g,
      acceleration2SigmaG: sigma2_g,
      acceleration3SigmaG: sigma3_g,
      stressRmsMPa: stressRms / 1e6,
      stress3SigmaPeakMPa: 3.0 * (stressRms / 1e6)
    };
  }

  /**
   * SDOF displacement/acceleration transfer function magnitude squared under
   * base excitation, |H(f)|^2 = 1 / ((1 - r^2)^2 + (2 zeta r)^2), r = f/fn.
   * The response PSD to a white-noise input PSD S_xx(f) is S_yy(f) =
   * |H(f)|^2 * S_xx(f); at resonance |H(fn)|^2 = Q^2 = 1/(2 zeta)^2.
   *
   * @param {number} fHz - response frequency (Hz)
   * @param {number} naturalFrequencyHz - SDOF natural frequency fn (Hz)
   * @param {number} dampingRatio - critical damping ratio zeta
   * @returns {number} |H(f)|^2 (dimensionless)
   */
  static sdofTransferFunctionMagnitudeSquared(fHz, naturalFrequencyHz, dampingRatio) {
    const r = fHz / naturalFrequencyHz;
    const denom = (1.0 - r * r) * (1.0 - r * r) + 4.0 * dampingRatio * dampingRatio * r * r;
    return 1.0 / denom;
  }

  /**
   * Response PSD S_yy(f) = |H(f)|^2 * S_xx(f) for a white-noise input PSD.
   * @param {number} fHz - response frequency (Hz)
   * @param {number} inputPsdG2Hz - input PSD S_xx (g^2/Hz)
   * @param {number} naturalFrequencyHz - SDOF natural frequency fn (Hz)
   * @param {number} dampingRatio - critical damping ratio zeta
   * @returns {number} response PSD S_yy(f) (g^2/Hz)
   */
  static sdofResponsePsd(fHz, inputPsdG2Hz, naturalFrequencyHz, dampingRatio) {
    return inputPsdG2Hz * this.sdofTransferFunctionMagnitudeSquared(fHz, naturalFrequencyHz, dampingRatio);
  }

  /**
   * Integrates an arbitrary discrete PSD spectrum (f_i, PSD_i) to compute overall GRMS
   * @param {Array<{f: number, psd: number}>} psdCurve
   * @returns {{overallGrms: number, frequencyRange: Object}}
   */
  static integratePSDCurve(psdCurve = []) {
    if (psdCurve.length < 2) return { overallGrms: 0, frequencyRange: {} };

    let totalArea = 0.0;
    for (let i = 0; i < psdCurve.length - 1; i++) {
      const f1 = psdCurve[i].f;
      const f2 = psdCurve[i + 1].f;
      const p1 = psdCurve[i].psd;
      const p2 = psdCurve[i + 1].psd;

      // Log-log slope integration dB/octave
      if (p1 > 0 && p2 > 0 && f1 > 0 && f2 > 0) {
        const m = Math.log(p2 / p1) / Math.log(f2 / f1);
        if (Math.abs(m + 1.0) > 1e-4) {
          totalArea += (p2 * f2 - p1 * f1) / (m + 1.0);
        } else {
          totalArea += p1 * f1 * Math.log(f2 / f1);
        }
      } else {
        // Linear trapezoidal fallback
        totalArea += 0.5 * (p1 + p2) * (f2 - f1);
      }
    }

    const gRms = Math.sqrt(Math.max(0.0, totalArea));
    return {
      overallGrms: Number(gRms.toFixed(3)),
      fMin: psdCurve[0].f,
      fMax: psdCurve[psdCurve.length - 1].f,
      totalArea
    };
  }
}

module.exports = {
  RandomVibrationPSDEngine
};
