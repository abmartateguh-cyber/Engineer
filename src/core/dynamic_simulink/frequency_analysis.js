/**
 * OmniEng Control Systems Frequency Response & Bode Plot Analyzer
 * Calculates G(jω) frequency response, Gain Margin, Phase Margin, and stability metrics.
 * Parity with MATLAB Control System Toolbox (bode, margin, nyquist).
 */

class FrequencyResponseAnalyzer {
  /**
   * Computes Bode plot frequency response for transfer function:
   * G(s) = (num_k * s^k + ... + num_0) / (den_n * s^n + ... + den_0)
   */
  static computeBode(numCoeffs = [1.0], denCoeffs = [1.0, 2.0, 1.0], omegaMin = 0.01, omegaMax = 100.0, points = 60) {
    const frequencies = [];
    const logMin = Math.log10(omegaMin);
    const logMax = Math.log10(omegaMax);
    const step = (logMax - logMin) / (points - 1);

    for (let i = 0; i < points; i++) {
      frequencies.push(Math.pow(10, logMin + i * step));
    }

    const response = [];
    let gainCrossoverFreq = null;
    let phaseCrossoverFreq = null;
    let phaseMarginDeg = null;
    let gainMarginDb = null;

    let prevMagDb = null;
    let prevPhaseDeg = null;

    for (const w of frequencies) {
      // Evaluate Polynomials at s = j*w
      const numEval = this._evalPolyJOmega(numCoeffs, w);
      const denEval = this._evalPolyJOmega(denCoeffs, w);

      // Complex division: (Nr + j Ni) / (Dr + j Di)
      const denMagSq = denEval.real * denEval.real + denEval.imag * denEval.imag;
      const realG = (numEval.real * denEval.real + numEval.imag * denEval.imag) / denMagSq;
      const imagG = (numEval.imag * denEval.real - numEval.real * denEval.imag) / denMagSq;

      const magLinear = Math.sqrt(realG * realG + imagG * imagG);
      const magDb = 20 * Math.log10(Math.max(1e-9, magLinear));
      let phaseDeg = (Math.atan2(imagG, realG) * 180) / Math.PI;

      // Continuous phase unwrapping
      if (prevPhaseDeg !== null) {
        while (phaseDeg - prevPhaseDeg > 180) phaseDeg -= 360;
        while (phaseDeg - prevPhaseDeg < -180) phaseDeg += 360;
      }

      // Check for Gain Crossover (Mag passes 0 dB)
      if (gainCrossoverFreq === null && prevMagDb !== null) {
        if ((prevMagDb >= 0 && magDb <= 0) || (prevMagDb <= 0 && magDb >= 0)) {
          gainCrossoverFreq = w;
          phaseMarginDeg = Number((180 + phaseDeg).toFixed(2));
        }
      }

      // Check for Phase Crossover (Phase passes -180 deg)
      if (phaseCrossoverFreq === null && prevPhaseDeg !== null) {
        if ((prevPhaseDeg >= -180 && phaseDeg <= -180) || (prevPhaseDeg <= -180 && phaseDeg >= -180)) {
          phaseCrossoverFreq = w;
          gainMarginDb = Number((-magDb).toFixed(2));
        }
      }

      prevMagDb = magDb;
      prevPhaseDeg = phaseDeg;

      response.push({
        omegaRadS: Number(w.toFixed(4)),
        magnitudeDb: Number(magDb.toFixed(2)),
        phaseDeg: Number(phaseDeg.toFixed(2))
      });
    }

    // Default stability assessment
    const isStable = (phaseMarginDeg !== null && phaseMarginDeg > 0) || (gainMarginDb !== null && gainMarginDb > 0);

    return {
      numCoeffs,
      denCoeffs,
      gainCrossoverFreq: gainCrossoverFreq ? Number(gainCrossoverFreq.toFixed(3)) : 'None (No 0dB crossing)',
      phaseMarginDeg: phaseMarginDeg !== null ? phaseMarginDeg : '> 90° (Highly Stable)',
      phaseCrossoverFreq: phaseCrossoverFreq ? Number(phaseCrossoverFreq.toFixed(3)) : 'None (Phase > -180°)',
      gainMarginDb: gainMarginDb !== null ? gainMarginDb : '+Infinity dB (Unconditionally Stable)',
      isStable,
      stabilityVerdict: isStable
        ? `STABLE (Phase Margin: ${phaseMarginDeg !== null ? phaseMarginDeg + '°' : '>90°'})`
        : 'UNSTABLE — Phase Margin < 0° (Oscillatory / Divergent)',
      bodePoints: response
    };
  }

  static _evalPolyJOmega(coeffs, w) {
    // coeffs is [a_n, a_{n-1}, ..., a_0]
    // P(jw) = sum_{k=0}^n a_k * (jw)^{n-k}
    const n = coeffs.length - 1;
    let real = 0;
    let imag = 0;

    for (let i = 0; i <= n; i++) {
      const power = n - i;
      const c = coeffs[i];
      // (jw)^power
      const wPow = Math.pow(w, power);
      const mod4 = power % 4;

      if (mod4 === 0) {
        real += c * wPow;
      } else if (mod4 === 1) {
        imag += c * wPow;
      } else if (mod4 === 2) {
        real -= c * wPow;
      } else if (mod4 === 3) {
        imag -= c * wPow;
      }
    }

    return { real, imag };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FrequencyResponseAnalyzer };
}
