/**
 * OmniEng Norton-Bailey Power-Law Creep Solver
 * 
 * Implements high-temperature secondary & primary creep strain evolution:
 * dot_epsilon_cr = A * sigma^n * t^m
 * 
 * Standards: ASME Section III Subsection NH / API 579-1 / ASME B&PV Section VIII
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
   * @param {number} [params.A=1.0e-18] - Norton creep coefficient (1/hr / MPa^n)
   * @param {number} [params.n=5.0] - Stress exponent (typical 4.0 - 7.0 for austenitic steels)
   * @returns {number} Creep strain rate (strain per hour)
   */
  static evaluateSecondaryCreepRate(params) {
    const sigma = params.stressMPa;
    const A = params.A !== undefined ? params.A : 1.0e-18;
    const n = params.n !== undefined ? params.n : 5.0;

    return A * Math.pow(Math.max(0.0, sigma), n);
  }

  /**
   * Integrates transient primary/secondary creep accumulation over total time.
   * 
   * @param {Object} spec
   * @param {number} spec.stressMPa - Applied stress
   * @param {number} spec.totalHours - Duration (hours)
   * @param {number} [spec.A=1.0e-18] - Norton constant
   * @param {number} [spec.n=5.0] - Stress exponent
   * @param {number} [spec.m=0.0] - Time hardening exponent (-1.0 < m <= 0)
   * @returns {{ totalCreepStrain: number, creepRateAtEnd: number, timeHistory: Array<Object> }}
   */
  static integrateCreepStrain(spec) {
    const sigma = spec.stressMPa;
    const totalHours = spec.totalHours;
    const A = spec.A !== undefined ? spec.A : 1.0e-18;
    const n = spec.n !== undefined ? spec.n : 5.0;
    const m = spec.m !== undefined ? spec.m : 0.0;

    const dt = spec.dtHours || Math.max(1.0, totalHours / 100);
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
  static evaluateRuptureTime(minCreepRatePerHour, C_MG = 0.10, p = 1.0) {
    if (minCreepRatePerHour <= 0) return Infinity;
    return C_MG / Math.pow(minCreepRatePerHour, p);
  }
}

module.exports = {
  NortonBaileyCreepSolver
};
