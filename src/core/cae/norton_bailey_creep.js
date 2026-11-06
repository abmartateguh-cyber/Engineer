/**
 * OmniEng Norton-Bailey Power-Law Creep Solver
 *
 * Implements high-temperature secondary & primary creep strain evolution:
 * dot_epsilon_cr = A * sigma^n * t^m
 *
 * No code-specific material data, standards conformance, or independent creep
 * validation is included.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

class NortonBaileyCreepSolver {
  /**
   * Computes steady-state secondary creep strain rate:
   * dot_epsilon = A * sigma^n
   *
   * @param {Object} params
   * @param {number} params.stressMPa - Equivalent von Mises stress (MPa)
   * @param {number} params.A - Caller-supplied Norton coefficient (1/hr / MPa^n)
   * @param {number} params.n - Caller-supplied stress exponent
   * @returns {number} Creep strain rate (strain per hour)
   */
  static evaluateSecondaryCreepRate(params) {
    const { stressMPa: sigma, A, n } = params || {};
    this.validateParameters({ stressMPa: sigma, A, n });

    return A * Math.pow(Math.max(0.0, sigma), n);
  }

  /**
   * Integrates transient primary/secondary creep accumulation over total time.
   *
   * @param {Object} spec
   * @param {number} spec.stressMPa - Applied stress
   * @param {number} spec.totalHours - Duration (hours)
   * @param {number} spec.A - Caller-supplied Norton constant
   * @param {number} spec.n - Caller-supplied stress exponent
   * @param {number} spec.m - Caller-supplied time exponent (-1.0 < m <= 0)
   * @returns {{ totalCreepStrain: number, creepRateAtEnd: number, timeHistory: Array<Object> }}
  */
  static integrateCreepStrain(spec) {
    const { stressMPa: sigma, totalHours } = spec || {};
    const { A, n, m } = spec || {};
    if (!Number.isFinite(m)) throw new TypeError('Provide the time exponent m explicitly.');
    this.validateParameters({ stressMPa: sigma, totalHours, A, n, m });

    const dt = spec.dtHours !== undefined ? spec.dtHours : Math.max(1.0, totalHours / 100);
    if (!Number.isFinite(dt) || dt <= 0) throw new TypeError('dtHours must be positive and finite.');
    let t = 0.0;
    let strain = 0.0;
    const timeHistory = [];

    while (t < totalHours - 1e-6) {
      const stepDt = Math.min(dt, totalHours - t);
      // dot_eps = A * sigma^n * (t + dt/2)^m
      const tMid = Math.max(1e-3, t + 0.5 * stepDt);
      const rate = A * Math.pow(sigma, n) * Math.pow(tMid, m);
      strain += rate * stepDt;
      t += stepDt;

      if (timeHistory.length < 50) {
        timeHistory.push({ timeHours: t, creepStrain: strain, ratePerHour: rate });
      }
    }

    return {
      totalCreepStrain: strain,
      creepRateAtEnd: A * Math.pow(sigma, n) * Math.pow(Math.max(1.0, t), m),
      timeHistory
    };
  }

  /**
   * Evaluates Monkman-Grant Creep Rupture Time:
   * t_r = C_MG / (dot_epsilon_min)^p
   */
  static evaluateRuptureTime(minCreepRatePerHour, C_MG, p) {
    if (!Number.isFinite(minCreepRatePerHour) || minCreepRatePerHour < 0 || !Number.isFinite(C_MG) || C_MG <= 0 || !Number.isFinite(p) || p <= 0) {
      throw new TypeError('Provide non-negative creep rate and explicit positive Monkman-Grant constants C_MG and p.');
    }
    if (minCreepRatePerHour <= 0) return Infinity;
    return C_MG / Math.pow(minCreepRatePerHour, p);
  }

  static validateParameters({ stressMPa, A, n, totalHours, m }) {
    if (
      !Number.isFinite(stressMPa) || stressMPa < 0 || !Number.isFinite(A) || A < 0 ||
      !Number.isFinite(n) || n < 0 ||
      (totalHours !== undefined && (!Number.isFinite(totalHours) || totalHours <= 0)) ||
      (m !== undefined && (!Number.isFinite(m) || m <= -1 || m > 0))
    ) {
      throw new TypeError('Provide explicit finite stress, A >= 0, n >= 0, positive duration, and -1 < m <= 0 when integrating creep.');
    }
  }
}

module.exports = {
  NortonBaileyCreepSolver
};
