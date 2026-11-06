/**
 * Experimental fatigue formula helpers for caller-supplied load histories and
 * material properties. The cycle counter and life estimates have no established
 * ASTM conformity or independent fatigue correlation.
 */

'use strict';

class FatigueLifeAnalyzer {
  /**
   * Rainflow-like cycle counting. ASTM E1049-85 conformity has not been established.
   * @param {Array<number>} signal - Time series of stress or strain values
   * @returns {Array<Object>} Extracted cycles: { range, mean, count: 0.5 or 1.0 }
   */
  static countRainflowCycles(signal) {
    if (!signal || signal.length < 3) return [];

    // 1. Filter signal to retain only local extrema (peaks and valleys)
    const extrema = [signal[0]];
    for (let i = 1; i < signal.length - 1; i++) {
      const d1 = signal[i] - signal[i - 1];
      const d2 = signal[i + 1] - signal[i];
      if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) {
        extrema.push(signal[i]);
      }
    }
    extrema.push(signal[signal.length - 1]);

    // 2. Three-point rainflow-like stack helper
    const stack = [];
    const cycles = [];

    for (const pt of extrema) {
      stack.push(pt);
      while (stack.length >= 3) {
        const s0 = stack[stack.length - 3];
        const s1 = stack[stack.length - 2];
        const s2 = stack[stack.length - 1];

        const rangeY = Math.abs(s1 - s0);
        const rangeX = Math.abs(s2 - s1);

        if (rangeX >= rangeY) {
          const mean = (s0 + s1) / 2.0;
          cycles.push({ range: rangeY, amplitude: rangeY / 2.0, mean, count: 1.0 });
          // Remove s0 and s1, re-insert s2
          stack.splice(stack.length - 3, 2);
        } else {
          break;
        }
      }
    }

    // Residual half-cycles
    while (stack.length >= 2) {
      const s0 = stack.shift();
      const s1 = stack[0];
      const range = Math.abs(s1 - s0);
      cycles.push({ range, amplitude: range / 2.0, mean: (s0 + s1) / 2.0, count: 0.5 });
    }

    return cycles;
  }

  /**
   * Calculates Basquin high-cycle fatigue life N_f with Goodman mean-stress correction
   * @param {number} sigmaAmplitude - Stress amplitude (Pa)
   * @param {number} sigmaMean - Mean stress (Pa)
   * @param {Object} materialProps
   * @param {number} materialProps.fatigueStrengthCoeff - sigma_f' (Pa)
   * @param {number} materialProps.fatigueStrengthExponent - b (e.g. -0.085)
   * @param {number} materialProps.ultimateTensileStrength - sigma_u (Pa, e.g. 600e6)
   * @returns {number} Cycles to failure N_f
   */
  static calculateBasquinCycles(sigmaAmplitude, sigmaMean, materialProps) {
    FatigueLifeAnalyzer.validateMaterialProperties(materialProps);
    if (![sigmaAmplitude, sigmaMean].every(Number.isFinite)) {
      throw new TypeError('Provide finite stress amplitude and mean stress in pascals.');
    }
    const sigmaF = materialProps.fatigueStrengthCoeff;
    const b = materialProps.fatigueStrengthExponent;
    const sigmaU = materialProps.ultimateTensileStrength;

    // Goodman equivalent completely-reversed amplitude: sigma_rev = sigma_a / (1 - sigma_m / sigma_u)
    let sigmaRev = sigmaAmplitude;
    if (sigmaMean > 0 && sigmaMean < sigmaU) {
      sigmaRev = sigmaAmplitude / (1.0 - sigmaMean / sigmaU);
    }

    if (sigmaRev <= 0) return 1e12; // Infinite life

    // sigma_rev = sigma_f' * (2 * N_f)^b  =>  2 * N_f = (sigma_rev / sigma_f')^(1/b)
    const ratio = Math.max(1e-4, sigmaRev / sigmaF);
    const twoNf = Math.pow(ratio, 1.0 / b);
    return Math.max(1.0, twoNf / 2.0);
  }

  static validateMaterialProperties(materialProps) {
    if (
      !materialProps || typeof materialProps !== 'object' ||
      !['fatigueStrengthCoeff', 'fatigueStrengthExponent', 'ultimateTensileStrength'].every((field) =>
        Number.isFinite(materialProps[field])
      ) ||
      materialProps.fatigueStrengthCoeff <= 0 || materialProps.fatigueStrengthExponent >= 0 ||
      materialProps.ultimateTensileStrength <= 0
    ) {
      throw new TypeError('Provide explicit fatigueStrengthCoeff > 0, fatigueStrengthExponent < 0, and ultimateTensileStrength > 0 in pascals.');
    }
  }

  /**
   * Computes Palmgren-Miner cumulative damage for a stress history
   * @param {Array<number>} stressHistory - Load signal (Pa)
   * @param {Object} materialProps
   * @returns {Object} Cumulative damage D and remaining life
   */
  static evaluateCumulativeDamage(stressHistory, materialProps) {
    FatigueLifeAnalyzer.validateMaterialProperties(materialProps);
    const cycles = FatigueLifeAnalyzer.countRainflowCycles(stressHistory);
    let totalDamage = 0.0;

    for (const c of cycles) {
      const Nf = FatigueLifeAnalyzer.calculateBasquinCycles(c.amplitude, c.mean, materialProps);
      const d = c.count / Nf;
      totalDamage += d;
    }

    const isFailed = totalDamage >= 1.0;
    const lifeRepeats = totalDamage > 0 ? 1.0 / totalDamage : Infinity;

    return {
      cycleCount: cycles.length,
      cumulativeDamage: Number(totalDamage.toExponential(4)),
      cumulativeDamageD: totalDamage,
      isFailed,
      lifeInBlocks: Number(lifeRepeats.toFixed(1)),
      safetyFactor: totalDamage > 0 ? Number((1.0 / totalDamage).toFixed(2)) : 999.0
    };
  }

  rainflowCounting(signal) {
    return FatigueLifeAnalyzer.countRainflowCycles(signal);
  }

  calculateMinerDamage(cycles, sigmaFPrime, b, ultimateStrength) {
    FatigueLifeAnalyzer.validateMaterialProperties({
      fatigueStrengthCoeff: sigmaFPrime,
      fatigueStrengthExponent: b,
      ultimateTensileStrength: ultimateStrength
    });
    const matProps = {
      fatigueStrengthCoeff: sigmaFPrime,
      fatigueStrengthExponent: b,
      ultimateTensileStrength: ultimateStrength
    };

    let totalDamage = 0.0;
    for (const c of cycles) {
      const Nf = FatigueLifeAnalyzer.calculateBasquinCycles(c.amplitude, c.mean, matProps);
      totalDamage += (c.count || 1.0) / Nf;
    }

    return {
      cumulativeDamage: totalDamage,
      cumulativeDamageD: totalDamage,
      cycleCount: cycles.length,
      isSafe: totalDamage < 1.0
    };
  }
}

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FatigueLifeAnalyzer };
}
if (typeof window !== 'undefined') {
  window.FatigueLifeAnalyzer = FatigueLifeAnalyzer;
}
