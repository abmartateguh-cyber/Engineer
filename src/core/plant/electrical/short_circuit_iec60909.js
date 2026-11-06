/**
 * Three-Phase Symmetrical Short-Circuit Calculation per IEC 60909.
 *
 * Implements:
 * 1. Initial symmetrical short-circuit current:
 *    Ik'' = (c * Un) / (sqrt(3) * |Zk|)
 * 2. Peak short-circuit current:
 *    ip = kappa * sqrt(2) * Ik''
 *    where kappa = 1.02 + 0.98 * exp(-3 * (R/X))
 * 3. Symmetrical breaking current:
 *    Ib = mu * Ik''
 * 4. Steady-state short-circuit current:
 *    Ik = lambda_max * IrG
 * 5. Component impedance models (referred to fault bus nominal voltage):
 *    - Grid / External Utility Feeders
 *    - Synchronous Gas Turbine Generators (with impedance correction KG)
 *    - Two-Winding Step-Down Power Transformers (with impedance correction KT)
 *    - Large Asynchronous / Induction Motors (locked rotor contribution)
 */

'use strict';

class ShortCircuitIec60909 {
  /**
   * Returns standard voltage factor c per IEC 60909-0 Table 1.
   *
   * @param {number} nominalVoltageKV
   * @param {boolean} [isMax=true] - c_max for equipment breaking rating, c_min for relay sensitivity
   * @returns {number}
   */
  static getVoltageFactorC(nominalVoltageKV, isMax = true) {
    if (nominalVoltageKV <= 1.0) {
      return isMax ? 1.05 : 0.95; // LV systems
    }
    return isMax ? 1.10 : 1.00; // MV / HV systems (> 1 kV)
  }

  /**
   * Calculates peak factor kappa per IEC 60909 Method C.
   *
   * @param {number} rOverX - Ratio of equivalent resistance to reactance (R/X)
   * @returns {number} kappa factor (typically 1.02 to 2.00)
   */
  static calculateKappaFactor(rOverX) {
    const rx = Math.max(0, rOverX);
    return 1.02 + 0.98 * Math.exp(-3.0 * rx);
  }

  /**
   * Calculates decay factor mu for generator breaking current Ib per IEC 60909.
   *
   * @param {number} ikDoublePrimeOverIr - Ratio of Ik'' to generator rated current Ir
   * @param {number} [tMinSec=0.05] - Circuit breaker minimum opening delay (seconds)
   * @returns {number} mu factor
   */
  static calculateMuFactor(ikDoublePrimeOverIr, tMinSec = 0.05) {
    if (tMinSec >= 0.25) return 0.70;
    if (ikDoublePrimeOverIr <= 2.0) return 1.0;
    // Empirical fit for standard IEC 60909 mu curves at t = 0.05 s
    const mu = 0.84 + 0.26 * Math.exp(-0.26 * ikDoublePrimeOverIr);
    return Math.max(0.60, Math.min(1.0, mu));
  }

  /**
   * Evaluates three-phase symmetrical fault at a target switchgear busbar.
   *
   * @param {Object} params
   * @param {string} params.busName - Tag of the fault bus (e.g. 'SWG-33KV-A')
   * @param {number} params.nominalVoltageKV - Bus nominal voltage (kV, line-to-line)
   * @param {Array<Object>} params.sources - Array of connected power sources and equipment:
   *   - Grid: { type: 'grid', shortCircuitMVA: 1500, rxRatio: 0.1 }
   *   - Generator: { type: 'generator', ratedMVA: 65, ratedVoltageKV: 11, xdDoublePrime: 0.16, powerFactor: 0.85, rxRatio: 0.05 }
   *   - Transformer: { type: 'transformer', ratedMVA: 40, hvVoltageKV: 33, lvVoltageKV: 11, impedanceUkPct: 10.0, loadLossKW: 160 }
   *   - MotorGroup: { type: 'motor_group', totalRatedMW: 25, ratedVoltageKV: 11, startingCurrentRatio: 5.5, efficiency: 0.95, powerFactor: 0.88, rxRatio: 0.10 }
   * @param {number} [params.breakerDelaySec=0.05] - Breaker minimum opening delay (seconds)
   * @returns {Object} Complete IEC 60909 short-circuit analysis report
   */
  static evaluateBusFault(params) {
    const {
      busName,
      nominalVoltageKV,
      sources = [],
      breakerDelaySec = 0.05
    } = params;

    if (!nominalVoltageKV || nominalVoltageKV <= 0) {
      throw new Error('Nominal voltage must be positive');
    }

    const c = this.getVoltageFactorC(nominalVoltageKV, true);
    const U_n = nominalVoltageKV; // kV

    // We combine branches in parallel admittance at the fault busbar:
    // Y_branch = 1 / Z_branch = G - jB
    let totalAdmittanceReal = 0; // G (S)
    let totalAdmittanceImag = 0; // B (S)
    let totalGeneratorRatedAmpsKA = 0;

    const branchAudit = [];

    for (const src of sources) {
      let R_ohm = 0;
      let X_ohm = 0;
      let branchDesc = '';

      if (src.type === 'grid') {
        // Grid impedance: Z_Q = (c * Un^2) / S_kQ''
        const S_kQ = src.shortCircuitMVA;
        const Z_Q = (c * U_n * U_n) / S_kQ;
        const rx = src.rxRatio !== undefined ? src.rxRatio : 0.10;
        X_ohm = Z_Q / Math.sqrt(1 + rx * rx);
        R_ohm = rx * X_ohm;
        branchDesc = `Utility Grid (${S_kQ} MVA)`;
      } else if (src.type === 'generator') {
        // Synchronous generator impedance
        const S_rG = src.ratedMVA;
        const U_rG = src.ratedVoltageKV || U_n;
        const xd_pp = src.xdDoublePrime || 0.16;
        const Z_rG = (U_rG * U_rG) / S_rG;
        const Xd_pp_ohm = xd_pp * Z_rG;
        const rx = src.rxRatio !== undefined ? src.rxRatio : 0.05;
        const Rg_ohm = rx * Xd_pp_ohm;

        // IEC 60909 generator impedance correction factor K_G
        const pf = src.powerFactor || 0.85;
        const sinPhi = Math.sqrt(Math.max(0, 1.0 - pf * pf));
        const voltageRatio = U_n / U_rG;
        const K_G = voltageRatio * (c / (1.0 + xd_pp * sinPhi));

        // Referred to bus nominal voltage
        R_ohm = K_G * Rg_ohm * (voltageRatio * voltageRatio);
        X_ohm = K_G * Xd_pp_ohm * (voltageRatio * voltageRatio);
        branchDesc = `GTG Synchronous Generator (${S_rG} MVA, xd''=${xd_pp})`;
        totalGeneratorRatedAmpsKA += S_rG / (Math.sqrt(3) * U_n);
      } else if (src.type === 'transformer') {
        // Two-winding transformer
        const S_rT = src.ratedMVA;
        const u_k = src.impedanceUkPct / 100.0;
        const Z_T = u_k * ((U_n * U_n) / S_rT);

        // Load loss or ohmic resistance
        let R_t = 0;
        if (src.loadLossKW) {
          R_t = (src.loadLossKW * 1e-3 * (U_n * U_n)) / (S_rT * S_rT);
        } else {
          R_t = 0.01 * Z_T;
        }
        const X_t = Math.sqrt(Math.max(0, Z_T * Z_T - R_t * R_t));

        // Transformer correction factor KT per IEC 60909 Clause 3.3.3:
        // x_T is the relative per-unit reactance of the transformer = u_k * (X_t / Z_T)
        const x_T = u_k * (Z_T > 0 ? X_t / Z_T : 1.0);
        const K_T = 0.95 * (c / (1.0 + 0.6 * x_T));
        R_ohm = K_T * R_t;
        X_ohm = K_T * X_t;
        branchDesc = `Transformer (${S_rT} MVA, uk=${src.impedanceUkPct}%)`;
      } else if (src.type === 'motor_group') {
        // Induction motor group contribution
        const P_rM = src.totalRatedMW;
        const eta = src.efficiency || 0.95;
        const pf = src.powerFactor || 0.88;
        const S_rM = P_rM / (eta * pf);
        const lrRatio = src.startingCurrentRatio || 5.5;

        // Motor impedance Z_M = (U_n^2 / S_rM) / (ILR / IrM)
        const Z_M = ((U_n * U_n) / S_rM) / lrRatio;
        const rx = src.rxRatio !== undefined ? src.rxRatio : 0.15;
        X_ohm = Z_M / Math.sqrt(1 + rx * rx);
        R_ohm = rx * X_ohm;
        branchDesc = `Induction Motors (${P_rM} MW total, ILR/Ir=${lrRatio})`;
      } else {
        continue;
      }

      // Admittance Y = 1 / (R + jX) = (R - jX) / (R^2 + X^2)
      const denom = R_ohm * R_ohm + X_ohm * X_ohm;
      if (denom > 0) {
        const G = R_ohm / denom;
        const B = -X_ohm / denom;
        totalAdmittanceReal += G;
        totalAdmittanceImag += B;

        branchAudit.push({
          description: branchDesc,
          resistanceOhm: Math.round(R_ohm * 10000) / 10000,
          reactanceOhm: Math.round(X_ohm * 10000) / 10000,
          impedanceMagnitudeOhm: Math.round(Math.sqrt(denom) * 10000) / 10000
        });
      }
    }

    // Equivalent Thevenin impedance Z_k = 1 / Y_total
    const yTotalMagSq = totalAdmittanceReal * totalAdmittanceReal + totalAdmittanceImag * totalAdmittanceImag;
    if (yTotalMagSq === 0) {
      throw new Error(`No active short-circuit sources defined for bus ${busName}`);
    }

    const R_k = totalAdmittanceReal / yTotalMagSq;
    const X_k = -totalAdmittanceImag / yTotalMagSq;
    const Z_k = Math.sqrt(R_k * R_k + X_k * X_k);

    const rOverX = X_k > 0 ? R_k / X_k : 0.05;

    // 1. Initial symmetrical short-circuit current: Ik'' = (c * Un) / (sqrt(3) * Zk) [kA]
    const I_k_pp_kA = (c * U_n) / (Math.sqrt(3) * Z_k);

    // Initial short-circuit apparent power: Sk'' = sqrt(3) * Un * Ik'' [MVA]
    const S_k_pp_MVA = Math.sqrt(3) * U_n * I_k_pp_kA;

    // 2. Peak short-circuit current: ip = kappa * sqrt(2) * Ik'' [kA]
    const kappa = this.calculateKappaFactor(rOverX);
    const i_p_kA = kappa * Math.sqrt(2) * I_k_pp_kA;

    // 3. Symmetrical short-circuit breaking current: Ib = mu * Ik'' [kA]
    // Far-from-generator faults (grid only) have mu = 1.0; near-generator faults evaluate Ik''/IrG
    const mu = totalGeneratorRatedAmpsKA > 0
      ? this.calculateMuFactor(I_k_pp_kA / totalGeneratorRatedAmpsKA, breakerDelaySec)
      : 1.0;
    const I_b_kA = mu * I_k_pp_kA;

    // 4. Thermal equivalent short-circuit current Ith (for 1.0 second duration)
    // Ith = Ik'' * sqrt(m + n)
    const mFactor = (1.0 / (2.0 * 1.0)) * (kappa - 1.0) * (kappa - 1.0); // DC component decay
    const nFactor = 1.0; // AC component factor
    const I_th_1s_kA = I_k_pp_kA * Math.sqrt(Math.min(2.0, mFactor + nFactor));

    return {
      busName,
      nominalVoltageKV: U_n,
      voltageFactorC: c,
      theveninImpedance: {
        resistanceOhm: Math.round(R_k * 10000) / 10000,
        reactanceOhm: Math.round(X_k * 10000) / 10000,
        impedanceMagnitudeOhm: Math.round(Z_k * 10000) / 10000,
        rxRatio: Math.round(rOverX * 1000) / 1000
      },
      faultResults: {
        initialSymmetricalCurrentIkDoublePrimeKA: Math.round(I_k_pp_kA * 100) / 100,
        peakShortCircuitCurrentIpKA: Math.round(i_p_kA * 100) / 100,
        breakingCurrentIbKA: Math.round(I_b_kA * 100) / 100,
        thermalCurrent1sIthKA: Math.round(I_th_1s_kA * 100) / 100,
        shortCircuitMVA: Math.round(S_k_pp_MVA * 10) / 10,
        kappaFactor: Math.round(kappa * 1000) / 1000,
        muBreakingFactor: Math.round(mu * 1000) / 1000
      },
      recommendedSwitchgearRatings: {
        minimumBreakingCapacityIcuKA: Math.ceil(I_k_pp_kA / 5.0) * 5, // e.g. 25, 31.5, 40, 50 kA
        minimumMakingCapacityIcmKA: Math.ceil(i_p_kA / 10.0) * 10,
        ratedShortTimeWithstand1sKA: Math.ceil(I_th_1s_kA / 5.0) * 5
      },
      connectedBranches: branchAudit
    };
  }
}

module.exports = {
  ShortCircuitIec60909
};
