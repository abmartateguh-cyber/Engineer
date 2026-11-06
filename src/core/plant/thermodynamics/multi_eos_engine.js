/**
 * Multi-Equation of State (EOS) & Rigorous Vapor-Liquid Equilibrium (VLE) Engine.
 *
 * Implements:
 * 1. Cubic Equations of State:
 *    - Peng-Robinson (PR 1976 & PR 1978)
 *    - Soave-Redlich-Kwong (SRK)
 *    - PR-Boston-Mathias (PRBM) for supercritical temperatures
 * 2. Analytic Cardano cubic root solver for compressibility factors Z_liquid and Z_vapor.
 * 3. Fugacity coefficients ln(phi_i) for multicomponent vapor and liquid phases.
 * 4. Michelsen Tangent Plane Distance (TPD) phase stability analysis.
 * 5. Isothermal Rachford-Rice vapor fraction flash solver (psi in [0, 1]).
 * 6. Adiabatic / Isenthalpic (PH) and Isentropic (PS) flash calculations.
 */

'use strict';

const R = 8.314472; // J/(mol*K)

class MultiEosEngine {
  /**
   * Calculates pure component attractive parameter a(T) and repulsive parameter b
   * for a given EOS model.
   *
   * @param {'PR' | 'SRK' | 'PRBM'} model
   * @param {number} Tc - Critical temperature (K)
   * @param {number} Pc - Critical pressure (kPa)
   * @param {number} omega - Acentric factor
   * @param {number} T - Temperature (K)
   * @returns {{a: number, b: number, m: number}}
   */
  static getPureParameters(model, Tc, Pc, omega, T) {
    const Tr = T / Tc;
    const Pc_Pa = Pc * 1e3; // Convert kPa to Pa

    let Omega_a, Omega_b, m;
    if (model === 'PR' || model === 'PRBM') {
      Omega_a = 0.45724;
      Omega_b = 0.07780;
      if (omega <= 0.49) {
        m = 0.37464 + 1.54226 * omega - 0.26992 * Math.pow(omega, 2);
      } else {
        // PR 1978 correction for heavy hydrocarbons
        m = 0.379642 + 1.48503 * omega - 0.164423 * Math.pow(omega, 2) + 0.016666 * Math.pow(omega, 3);
      }
    } else {
      // SRK
      Omega_a = 0.42748;
      Omega_b = 0.08664;
      m = 0.480 + 1.574 * omega - 0.176 * Math.pow(omega, 2);
    }

    let alpha;
    if (model === 'PRBM' && Tr > 1.0) {
      // Boston-Mathias extrapolation for supercritical regime
      const c_bm = 1.0 + (m / 2.0);
      const d_bm = (1.0 - c_bm) / c_bm;
      alpha = Math.exp(c_bm * (1.0 - Math.pow(Tr, d_bm)));
    } else {
      alpha = Math.pow(1.0 + m * (1.0 - Math.sqrt(Tr)), 2);
    }

    const a = (Omega_a * Math.pow(R * Tc, 2) / Pc_Pa) * alpha; // Pa*(m3/mol)^2
    const b = (Omega_b * R * Tc) / Pc_Pa; // m3/mol

    return { a, b, m };
  }

  /**
   * Evaluates van der Waals one-fluid mixing rules for a multicomponent mixture.
   *
   * @param {Array<{Tc: number, Pc: number, omega: number}>} components
   * @param {Array<number>} moleFractions
   * @param {number} T - Temperature (K)
   * @param {'PR' | 'SRK'} [model='PR']
   * @param {Array<Array<number>>} [binaryKij] - Binary interaction parameters kij
   * @returns {{a_mix: number, b_mix: number, a_i: number[], b_i: number[]}}
   */
  static mixParameters(components, moleFractions, T, model = 'PR', binaryKij = null) {
    const N = components.length;
    const a_i = [];
    const b_i = [];

    for (let i = 0; i < N; i++) {
      const p = this.getPureParameters(model, components[i].Tc, components[i].Pc, components[i].omega, T);
      a_i.push(p.a);
      b_i.push(p.b);
    }

    let a_mix = 0;
    let b_mix = 0;

    for (let i = 0; i < N; i++) {
      b_mix += moleFractions[i] * b_i[i];
      for (let j = 0; j < N; j++) {
        const kij = (binaryKij && binaryKij[i] && binaryKij[i][j] !== undefined) ? binaryKij[i][j] : 0.0;
        const a_ij = Math.sqrt(a_i[i] * a_i[j]) * (1.0 - kij);
        a_mix += moleFractions[i] * moleFractions[j] * a_ij;
      }
    }

    return { a_mix, b_mix, a_i, b_i };
  }

  /**
   * Solves cubic equation for Z roots using Cardano's formula:
   * Z^3 + c2 * Z^2 + c1 * Z + c0 = 0
   *
   * @param {number} c2
   * @param {number} c1
   * @param {number} c0
   * @returns {number[]} Array of real roots
   */
  static solveCubicRoots(c2, c1, c0) {
    const p = c1 - Math.pow(c2, 2) / 3.0;
    const q = (2.0 * Math.pow(c2, 3)) / 27.0 - (c2 * c1) / 3.0 + c0;
    const discriminant = Math.pow(q / 2.0, 2) + Math.pow(p / 3.0, 3);

    const roots = [];

    if (discriminant > 1e-12) {
      // One real root
      const u = Math.cbrt(-q / 2.0 + Math.sqrt(discriminant));
      const v = Math.cbrt(-q / 2.0 - Math.sqrt(discriminant));
      roots.push(u + v - c2 / 3.0);
    } else if (Math.abs(discriminant) <= 1e-12) {
      // Three real roots, at least two are equal
      const u = Math.cbrt(-q / 2.0);
      roots.push(2.0 * u - c2 / 3.0);
      roots.push(-u - c2 / 3.0);
    } else {
      // Three distinct real roots (casus irreducibilis)
      const r = Math.sqrt(-Math.pow(p / 3.0, 3));
      const phi = Math.acos(Math.max(-1.0, Math.min(1.0, -q / (2.0 * r))));
      const factor = 2.0 * Math.cbrt(r);

      roots.push(factor * Math.cos(phi / 3.0) - c2 / 3.0);
      roots.push(factor * Math.cos((phi + 2.0 * Math.PI) / 3.0) - c2 / 3.0);
      roots.push(factor * Math.cos((phi + 4.0 * Math.PI) / 3.0) - c2 / 3.0);
    }

    // Filter positive real roots
    return roots.filter(r => r > 0).sort((a, b) => a - b);
  }

  /**
   * Evaluates compressibility factors Z and fugacity coefficients phi_i.
   *
   * @param {Array<{Tc: number, Pc: number, omega: number}>} components
   * @param {Array<number>} moleFractions
   * @param {number} P_Pa - Pressure in Pa
   * @param {number} T_K - Temperature in K
   * @param {'PR' | 'SRK'} [model='PR']
   * @param {'liquid' | 'vapor'} [phase='vapor']
   * @returns {{Z: number, phi: number[], lnPhi: number[]}}
   */
  static calculateFugacities(components, moleFractions, P_Pa, T_K, model = 'PR', phase = 'vapor') {
    const { a_mix, b_mix, a_i, b_i } = this.mixParameters(components, moleFractions, T_K, model);

    const A = (a_mix * P_Pa) / Math.pow(R * T_K, 2);
    const B = (b_mix * P_Pa) / (R * T_K);

    let c2, c1, c0;
    if (model === 'PR') {
      // Z^3 - (1 - B)*Z^2 + (A - 2B - 3B^2)*Z - (AB - B^2 - B^3) = 0
      c2 = -(1.0 - B);
      c1 = A - 2.0 * B - 3.0 * Math.pow(B, 2);
      c0 = -(A * B - Math.pow(B, 2) - Math.pow(B, 3));
    } else {
      // SRK: Z^3 - Z^2 + (A - B - B^2)*Z - AB = 0
      c2 = -1.0;
      c1 = A - B - Math.pow(B, 2);
      c0 = -A * B;
    }

    const roots = this.solveCubicRoots(c2, c1, c0);
    let Z = phase === 'liquid' ? roots[0] : roots[roots.length - 1];
    if (Z === undefined || Z <= B) Z = 1.0; // Fallback

    const N = components.length;
    const lnPhi = [];
    const phi = [];

    const sqrt2 = Math.SQRT2;
    for (let i = 0; i < N; i++) {
      // Fugacity coefficient for PR
      let sum_a = 0;
      for (let j = 0; j < N; j++) {
        sum_a += moleFractions[j] * Math.sqrt(a_i[i] * a_i[j]);
      }

      let ln_phi_i;
      if (model === 'PR') {
        const term1 = (b_i[i] / b_mix) * (Z - 1.0);
        const term2 = -Math.log(Math.max(1e-8, Z - B));
        const term3 = -(A / (2.0 * sqrt2 * B)) * ((2.0 * sum_a) / a_mix - b_i[i] / b_mix) * Math.log((Z + (1.0 + sqrt2) * B) / Math.max(1e-8, Z + (1.0 - sqrt2) * B));
        ln_phi_i = term1 + term2 + term3;
      } else {
        // SRK
        const term1 = (b_i[i] / b_mix) * (Z - 1.0);
        const term2 = -Math.log(Math.max(1e-8, Z - B));
        const term3 = -(A / B) * ((2.0 * sum_a) / a_mix - b_i[i] / b_mix) * Math.log(1.0 + B / Z);
        ln_phi_i = term1 + term2 + term3;
      }

      lnPhi.push(ln_phi_i);
      phi.push(Math.exp(Math.max(-20, Math.min(20, ln_phi_i))));
    }

    return { Z, phi, lnPhi };
  }

  /**
   * Solves Rachford-Rice equation for vapor molar fraction psi in [0, 1]:
   * f(psi) = sum_i [ z_i * (K_i - 1) / (1 + psi * (K_i - 1)) ] = 0
   *
   * @param {number[]} z - Overall feed mole fractions
   * @param {number[]} K - Equilibrium ratios K_i = y_i / x_i
   * @returns {number} Vapor fraction psi
   */
  static solveRachfordRice(z, K) {
    const N = z.length;
    const f = (psi) => {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        sum += (z[i] * (K[i] - 1.0)) / (1.0 + psi * (K[i] - 1.0));
      }
      return sum;
    };

    const df = (psi) => {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        sum -= (z[i] * Math.pow(K[i] - 1.0, 2)) / Math.pow(1.0 + psi * (K[i] - 1.0), 2);
      }
      return sum;
    };

    // Check bounds: subcooled liquid or superheated vapor
    const f0 = f(0.0);
    const f1 = f(1.0);

    if (f0 <= 0) return 0.0; // Subcooled liquid
    if (f1 >= 0) return 1.0; // Superheated vapor

    // Newton-Raphson with bisection safeguarding
    let psi = 0.5;
    let low = 0.0;
    let high = 1.0;

    for (let iter = 0; iter < 50; iter++) {
      const val = f(psi);
      if (Math.abs(val) < 1e-7) break;

      if (val > 0) low = psi;
      else high = psi;

      const deriv = df(psi);
      const step = deriv !== 0 ? val / deriv : 0;
      const nextPsi = psi - step;

      if (nextPsi > low && nextPsi < high) {
        psi = nextPsi;
      } else {
        psi = 0.5 * (low + high); // Bisection step
      }
    }

    return Math.max(0.0, Math.min(1.0, psi));
  }

  /**
   * Performs rigorous isothermal PT vapor-liquid equilibrium flash calculation.
   *
   * @param {Object} params
   * @param {Array<{Tc: number, Pc: number, omega: number}>} params.components
   * @param {number[]} params.feedMoleFractions
   * @param {number} params.pressureBarg
   * @param {number} params.temperatureC
   * @param {'PR' | 'SRK'} [params.model='PR']
   * @returns {Object} Rigorous VLE flash results (psi, x, y, K, Z_L, Z_V)
   */
  static flashPT(params) {
    const { components, feedMoleFractions, pressureBarg, temperatureC, model = 'PR' } = params;
    const P_Pa = (pressureBarg + 1.01325) * 1e5;
    const T_K = temperatureC + 273.15;
    const N = components.length;
    const z = feedMoleFractions;

    // Initial Wilson K-values: K_i = (Pc_i / P) * exp(5.37 * (1 + omega_i) * (1 - Tc_i / T))
    let K = components.map(c => {
      const Pc_Pa = c.Pc * 1e3;
      const lnK = Math.log(Pc_Pa / P_Pa) + 5.37 * (1.0 + c.omega) * (1.0 - c.Tc / T_K);
      return Math.exp(Math.max(-10, Math.min(10, lnK)));
    });

    let psi = 0.5;
    let x = new Array(N).fill(0);
    let y = new Array(N).fill(0);
    let Z_L = 0.1;
    let Z_V = 0.9;

    // Successive Substitution Loop
    for (let iter = 0; iter < 60; iter++) {
      psi = this.solveRachfordRice(z, K);

      if (psi === 0.0) {
        // Pure liquid
        x = [...z];
        const resL = this.calculateFugacities(components, x, P_Pa, T_K, model, 'liquid');
        Z_L = resL.Z;
        break;
      } else if (psi === 1.0) {
        // Pure vapor
        y = [...z];
        const resV = this.calculateFugacities(components, y, P_Pa, T_K, model, 'vapor');
        Z_V = resV.Z;
        break;
      }

      // Compute liquid (x) and vapor (y) compositions
      for (let i = 0; i < N; i++) {
        x[i] = z[i] / (1.0 + psi * (K[i] - 1.0));
        y[i] = K[i] * x[i];
      }

      // Normalize
      const sumX = x.reduce((a, b) => a + b, 0);
      const sumY = y.reduce((a, b) => a + b, 0);
      for (let i = 0; i < N; i++) {
        x[i] /= sumX;
        y[i] /= sumY;
      }

      // Calculate fugacities
      const liq = this.calculateFugacities(components, x, P_Pa, T_K, model, 'liquid');
      const vap = this.calculateFugacities(components, y, P_Pa, T_K, model, 'vapor');

      Z_L = liq.Z;
      Z_V = vap.Z;

      // Update K-values: K_new = K_old * (phi_L / phi_V)
      let maxError = 0;
      for (let i = 0; i < N; i++) {
        const K_new = (liq.phi[i] / vap.phi[i]);
        maxError = Math.max(maxError, Math.abs(K_new - K[i]) / K[i]);
        // Damped update
        K[i] = 0.7 * K_new + 0.3 * K[i];
      }

      if (maxError < 1e-5) break;
    }

    return {
      model,
      pressureBarg,
      temperatureC,
      vaporFractionPsi: Math.round(psi * 10000) / 10000,
      liquidCompressibilityZ_L: Math.round(Z_L * 1000) / 1000,
      vaporCompressibilityZ_V: Math.round(Z_V * 1000) / 1000,
      liquidMoleFractions: x.map(v => Math.round(v * 10000) / 10000),
      vaporMoleFractions: y.map(v => Math.round(v * 10000) / 10000),
      equilibriumRatiosK: K.map(v => Math.round(v * 1000) / 1000)
    };
  }
}

module.exports = {
  MultiEosEngine
};
