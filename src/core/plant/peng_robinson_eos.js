/**
 * Peng-Robinson 1978 Equation of State (PR-78 EOS) & Multicomponent VLE Flash
 * 
 * Provides rigorous thermodynamic phase equilibrium calculations:
 * - Pure component a(T) and b parameters with PR-78 alpha formulation
 * - van der Waals quadratic mixing rules with binary interaction parameters (k_ij)
 * - Analytical cubic equation solver for compressibility factor (Z)
 * - Fugacity coefficients for vapor and liquid phases (ln phi_i)
 * - Isothermal-isobaric (PT) Flash via Rachford-Rice with Newton-Raphson & bounded bisection
 * - NRTL (Non-Random Two-Liquid) activity coefficient model for polar/non-ideal liquid mixtures
 * 
 * Complies with API Technical Data Book & GPSA Engineering Data Book standards.
 */

'use strict';

const R_GAS = 8.314462618; // J / (mol * K)

// Pre-defined database of common hydrocarbons & gases (Tc in K, Pc in Pa, omega acentric factor)
const COMPONENT_DB = {
  methane: { name: 'Methane', formula: 'CH4', Tc: 190.56, Pc: 4599000, omega: 0.0115, Mw: 16.043 },
  ethane: { name: 'Ethane', formula: 'C2H6', Tc: 305.32, Pc: 4872000, omega: 0.0995, Mw: 30.070 },
  propane: { name: 'Propane', formula: 'C3H8', Tc: 369.83, Pc: 4248000, omega: 0.1523, Mw: 44.096 },
  i_butane: { name: 'Isobutane', formula: 'iC4H10', Tc: 407.85, Pc: 3640000, omega: 0.1848, Mw: 58.122 },
  n_butane: { name: 'n-Butane', formula: 'nC4H10', Tc: 425.12, Pc: 3796000, omega: 0.2002, Mw: 58.122 },
  i_pentane: { name: 'Isopentane', formula: 'iC5H12', Tc: 460.35, Pc: 3381000, omega: 0.2280, Mw: 72.150 },
  n_pentane: { name: 'n-Pentane', formula: 'nC5H12', Tc: 469.70, Pc: 3370000, omega: 0.2515, Mw: 72.150 },
  n_hexane: { name: 'n-Hexane', formula: 'C6H14', Tc: 507.60, Pc: 3025000, omega: 0.3013, Mw: 86.177 },
  nitrogen: { name: 'Nitrogen', formula: 'N2', Tc: 126.20, Pc: 3390000, omega: 0.0372, Mw: 28.013 },
  co2: { name: 'Carbon Dioxide', formula: 'CO2', Tc: 304.13, Pc: 7377000, omega: 0.2239, Mw: 44.010 },
  water: { name: 'Water', formula: 'H2O', Tc: 647.10, Pc: 22064000, omega: 0.3443, Mw: 18.015 }
};

class PengRobinsonEOS {
  /**
   * @param {Array<Object>} components Array of { name, Tc, Pc, omega, Mw }
   * @param {Array<Array<number>>} [k_ij] Binary interaction parameters matrix (N x N)
   */
  constructor(components, k_ij = null) {
    this.components = components.map(c => {
      if (typeof c === 'string') {
        const entry = COMPONENT_DB[c.toLowerCase()];
        if (!entry) throw new Error(`Unknown component: ${c}`);
        return { ...entry };
      }
      return { ...c };
    });

    const N = this.components.length;
    this.N = N;

    if (k_ij) {
      this.k_ij = k_ij;
    } else {
      this.k_ij = Array.from({ length: N }, () => new Float64Array(N));
    }
  }

  /**
   * Set binary interaction parameter between component i and j
   */
  setBinaryInteraction(i, j, kij) {
    this.k_ij[i][j] = kij;
    this.k_ij[j][i] = kij;
  }

  /**
   * Pure component PR-78 parameters: a_i(T) and b_i
   * @param {number} T Temperature in Kelvin
   * @returns {{ a: Float64Array, b: Float64Array }}
   */
  calculatePureParameters(T) {
    const a = new Float64Array(this.N);
    const b = new Float64Array(this.N);

    for (let i = 0; i < this.N; i++) {
      const comp = this.components[i];
      const Tr = T / comp.Tc;
      const omega = comp.omega;

      // PR-78 formulation for m
      let m;
      if (omega <= 0.49) {
        m = 0.37464 + 1.54226 * omega - 0.26992 * omega * omega;
      } else {
        m = 0.379642 + 1.48503 * omega - 0.164423 * omega * omega + 0.016666 * omega * omega * omega;
      }

      const sqrtTr = Math.sqrt(Tr);
      const alpha = Math.pow(1 + m * (1 - sqrtTr), 2);

      a[i] = 0.45724 * (R_GAS * R_GAS * comp.Tc * comp.Tc / comp.Pc) * alpha;
      b[i] = 0.07780 * (R_GAS * comp.Tc / comp.Pc);
    }

    return { a, b };
  }

  /**
   * Mixture parameters using van der Waals mixing rules
   * @param {Float64Array|Array<number>} z Mole fractions
   * @param {Float64Array} a_pure Pure a_i(T)
   * @param {Float64Array} b_pure Pure b_i
   * @returns {{ a_mix: number, b_mix: number, a_matrix: Array<Float64Array> }}
   */
  calculateMixtureParameters(z, a_pure, b_pure) {
    const N = this.N;
    let a_mix = 0;
    let b_mix = 0;
    const a_matrix = Array.from({ length: N }, () => new Float64Array(N));

    for (let i = 0; i < N; i++) {
      b_mix += z[i] * b_pure[i];
      for (let j = 0; j < N; j++) {
        const kij = this.k_ij[i][j];
        const a_ij = Math.sqrt(a_pure[i] * a_pure[j]) * (1 - kij);
        a_matrix[i][j] = a_ij;
        a_mix += z[i] * z[j] * a_ij;
      }
    }

    return { a_mix, b_mix, a_matrix };
  }

  /**
   * Solve cubic equation for compressibility factor Z:
   * Z^3 - (1 - B)*Z^2 + (A - 3*B^2 - 2*B)*Z - (A*B - B^2 - B^3) = 0
   * @param {number} A
   * @param {number} B
   * @param {'vapor'|'liquid'} phase
   * @returns {number} Z factor
   */
  solveCubicZ(A, B, phase = 'vapor') {
    const a2 = -(1 - B);
    const a1 = A - 3 * B * B - 2 * B;
    const a0 = -(A * B - B * B - B * B * B);

    // Cardano's formulation for cubic roots: y^3 + p*y + q = 0
    const p = a1 - (a2 * a2) / 3;
    const q = (2 * a2 * a2 * a2) / 27 - (a2 * a1) / 3 + a0;
    const discriminant = (q * q) / 4 + (p * p * p) / 27;

    const roots = [];

    if (discriminant > 1e-12) {
      // One real root
      const sqrtD = Math.sqrt(discriminant);
      const u = Math.cbrt(-q / 2 + sqrtD);
      const v = Math.cbrt(-q / 2 - sqrtD);
      const Z = u + v - a2 / 3;
      if (Z > B) roots.push(Z);
    } else {
      // Three real roots
      const r = Math.sqrt(-Math.pow(p / 3, 3));
      const phi = Math.acos(Math.max(-1, Math.min(1, -q / (2 * r))));
      for (let k = 0; k < 3; k++) {
        const Z = 2 * Math.cbrt(r) * Math.cos((phi + 2 * Math.PI * k) / 3) - a2 / 3;
        if (Z > B) {
          roots.push(Z);
        }
      }
    }

    if (roots.length === 0) {
      return phase === 'vapor' ? 1.0 : B * 1.05;
    }

    roots.sort((x, y) => x - y);

    if (phase === 'liquid') {
      return roots[0]; // Smallest root > B
    } else {
      return roots[roots.length - 1]; // Largest root
    }
  }

  /**
   * Calculate fugacity coefficients ln(phi_i) for each component
   * @param {Float64Array|Array<number>} z Mole fractions
   * @param {number} T Temperature (K)
   * @param {number} P Pressure (Pa)
   * @param {'vapor'|'liquid'} phase
   * @returns {{ phi: Float64Array, lnPhi: Float64Array, Z: number }}
   */
  calculateFugacityCoefficients(z, T, P, phase = 'vapor') {
    const { a: a_pure, b: b_pure } = this.calculatePureParameters(T);
    const { a_mix, b_mix, a_matrix } = this.calculateMixtureParameters(z, a_pure, b_pure);

    const A = (a_mix * P) / (R_GAS * R_GAS * T * T);
    const B = (b_mix * P) / (R_GAS * T);

    const Z = this.solveCubicZ(A, B, phase);

    const sqrt2 = Math.SQRT2;
    const lnPhi = new Float64Array(this.N);
    const phi = new Float64Array(this.N);

    const termZ_B = Math.log(Math.max(1e-15, Z - B));
    const termSqrt = Math.log(
      Math.max(1e-15, (Z + (1 + sqrt2) * B) / (Z + (1 - sqrt2) * B))
    );

    for (let i = 0; i < this.N; i++) {
      let sumZa = 0;
      for (let j = 0; j < this.N; j++) {
        sumZa += z[j] * a_matrix[i][j];
      }

      const b_ratio = b_pure[i] / b_mix;
      const termA = (A / (2 * sqrt2 * B)) * ( (2 * sumZa) / a_mix - b_ratio );

      const ln_phi_i = b_ratio * (Z - 1) - termZ_B - termA * termSqrt;
      lnPhi[i] = ln_phi_i;
      phi[i] = Math.exp(ln_phi_i);
    }

    return { phi, lnPhi, Z };
  }

  /**
   * Two-phase PT (Isothermal-Isobaric) Flash via Rachford-Rice
   * Solves f(beta) = sum( z_i * (K_i - 1) / (1 + beta * (K_i - 1)) ) = 0
   * 
   * @param {Array<number>} z Overall feed mole fractions
   * @param {number} T Temperature in Kelvin
   * @param {number} P Pressure in Pascals
   * @param {Object} [options]
   * @returns {{ beta: number, x: Float64Array, y: Float64Array, K: Float64Array, Z_L: number, Z_V: number, converged: boolean }}
   */
  flashPT(z, T, P, options = {}) {
    const maxIter = options.maxIter || 100;
    const tol = options.tol || 1e-8;

    // Initial Wilson correlation estimate for K-values:
    // K_i = (Pc_i / P) * exp(5.373 * (1 + omega_i) * (1 - Tc_i / T))
    const K = new Float64Array(this.N);
    for (let i = 0; i < this.N; i++) {
      const comp = this.components[i];
      K[i] = (comp.Pc / P) * Math.exp(5.373 * (1 + comp.omega) * (1 - comp.Tc / T));
      if (K[i] <= 0 || isNaN(K[i])) K[i] = 1.0;
    }

    let beta = 0.5; // Vapor fraction
    let converged = false;
    let Z_L = 0;
    let Z_V = 0;

    const x = new Float64Array(this.N);
    const y = new Float64Array(this.N);

    // Outer successive substitution loop for K-values
    for (let iter = 0; iter < maxIter; iter++) {
      // 1. Solve Rachford-Rice for beta using Newton-Raphson with bounded bisection
      let beta_min = 0;
      let beta_max = 1;

      // Find boundaries where denominator is strictly positive
      for (let i = 0; i < this.N; i++) {
        if (K[i] > 1) {
          const b = 1 / (1 - K[i]);
          if (b < beta_min) beta_min = b;
        } else if (K[i] < 1) {
          const b = 1 / (1 - K[i]);
          if (b > beta_max) beta_max = b;
        }
      }
      beta_min = Math.max(0, beta_min);
      beta_max = Math.min(1, beta_max);

      // Check single phase subcooled liquid
      let f_0 = 0;
      for (let i = 0; i < this.N; i++) f_0 += z[i] * (K[i] - 1);
      if (f_0 <= 0) {
        beta = 0.0;
        for (let i = 0; i < this.N; i++) {
          x[i] = z[i];
          y[i] = z[i] * K[i];
        }
        converged = true;
        break;
      }

      // Check single phase superheated vapor
      let f_1 = 0;
      for (let i = 0; i < this.N; i++) f_1 += (z[i] * (K[i] - 1)) / K[i];
      if (f_1 >= 0) {
        beta = 1.0;
        for (let i = 0; i < this.N; i++) {
          y[i] = z[i];
          x[i] = z[i] / K[i];
        }
        converged = true;
        break;
      }

      // Newton-Raphson inner solver for beta
      for (let rr = 0; rr < 50; rr++) {
        let f = 0;
        let df = 0;
        for (let i = 0; i < this.N; i++) {
          const denom = 1 + beta * (K[i] - 1);
          f += (z[i] * (K[i] - 1)) / denom;
          df -= (z[i] * Math.pow(K[i] - 1, 2)) / (denom * denom);
        }

        if (Math.abs(f) < 1e-11) break;

        let delta = f / df;
        let newBeta = beta - delta;
        if (newBeta <= 0 || newBeta >= 1) {
          newBeta = 0.5 * (beta_min + beta_max);
        }
        beta = newBeta;
      }

      // 2. Compute phase compositions
      let sumX = 0;
      let sumY = 0;
      for (let i = 0; i < this.N; i++) {
        x[i] = z[i] / (1 + beta * (K[i] - 1));
        y[i] = K[i] * x[i];
        sumX += x[i];
        sumY += y[i];
      }
      // Normalize compositions
      for (let i = 0; i < this.N; i++) {
        x[i] /= sumX;
        y[i] /= sumY;
      }

      // 3. Calculate fugacity coefficients
      const liq = this.calculateFugacityCoefficients(x, T, P, 'liquid');
      const vap = this.calculateFugacityCoefficients(y, T, P, 'vapor');
      Z_L = liq.Z;
      Z_V = vap.Z;

      // 4. Update K-values: K_new = K_old * (phi_L / phi_V)
      let maxError = 0;
      for (let i = 0; i < this.N; i++) {
        const K_new = liq.phi[i] / vap.phi[i];
        const err = Math.abs(K_new - K[i]) / K[i];
        if (err > maxError) maxError = err;
        K[i] = 0.5 * K[i] + 0.5 * K_new; // Damped successive substitution
      }

      if (maxError < tol) {
        converged = true;
        break;
      }
    }

    return {
      beta,
      x,
      y,
      K,
      Z_L,
      Z_V,
      converged
    };
  }

  /**
   * NRTL (Non-Random Two-Liquid) Activity Coefficient Model
   * For highly non-ideal polar mixtures (e.g. Ethanol-Water, Acetone-Water)
   * 
   * ln gamma_i = [sum_j(x_j * tau_ji * G_ji) / sum_k(x_k * G_ki)] +
   *              sum_j [ (x_j * G_ij / sum_k(x_k * G_kj)) * (tau_ij - sum_m(x_m * tau_mj * G_mj) / sum_k(x_k * G_kj)) ]
   * 
   * @param {Float64Array|Array<number>} x Liquid mole fractions
   * @param {number} T Temperature in Kelvin
   * @param {Array<Array<number>>} delta_g Binary energy parameter matrix (J/mol)
   * @param {Array<Array<number>>} alpha Non-randomness parameter matrix (~0.2 - 0.47)
   * @returns {Float64Array} Activity coefficients gamma_i
   */
  static calculateNRTL(x, T, delta_g, alpha) {
    const N = x.length;
    const tau = Array.from({ length: N }, () => new Float64Array(N));
    const G = Array.from({ length: N }, () => new Float64Array(N));

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        tau[i][j] = delta_g[i][j] / (R_GAS * T);
        G[i][j] = Math.exp(-alpha[i][j] * tau[i][j]);
      }
    }

    const gamma = new Float64Array(N);

    for (let i = 0; i < N; i++) {
      let sum1_num = 0;
      let sum1_den = 0;
      for (let j = 0; j < N; j++) {
        sum1_num += x[j] * tau[j][i] * G[j][i];
        sum1_den += x[j] * G[j][i];
      }
      let term1 = sum1_num / sum1_den;

      let term2 = 0;
      for (let j = 0; j < N; j++) {
        let sum_k_Gkj = 0;
        let sum_m_tauG = 0;
        for (let k = 0; k < N; k++) {
          sum_k_Gkj += x[k] * G[k][j];
          sum_m_tauG += x[k] * tau[k][j] * G[k][j];
        }
        term2 += (x[j] * G[i][j] / sum_k_Gkj) * (tau[i][j] - sum_m_tauG / sum_k_Gkj);
      }

      const ln_gamma_i = term1 + term2;
      gamma[i] = Math.exp(ln_gamma_i);
    }

    return gamma;
  }
}

module.exports = {
  PengRobinsonEOS,
  COMPONENT_DB,
  R_GAS
};
