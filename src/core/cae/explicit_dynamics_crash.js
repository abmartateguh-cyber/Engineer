/**
 * ExplicitDynamicsCrash: Central-Difference Explicit Dynamic Integration & Crashworthiness Engine
 *
 * Implements LS-DYNA / ANSYS Explicit STR grade high-speed dynamics:
 *   1. Central Difference time integration: u_(n+1) = u_n + dt * v_(n+1/2).
 *   2. Velocity update: v_(n+1/2) = v_(n-1/2) + dt * a_n.
 *   3. Acceleration: a_n = M^(-1) * (F_ext - F_int).
 *   4. Automatic Courant-Friedrichs-Lewy (CFL) stable time step calculation:
 *      dt_crit = L_char / c_d, where acoustic wave speed c_d = sqrt((E*(1-nu)) / (rho*(1+nu)*(1-2nu))).
 *   5. Element erosion / deletion when equivalent plastic strain reaches failure limit eps_crit.
 */

'use strict';

const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

class ExplicitDynamicsCrash {
  /**
   * @param {Object} props Material & simulation properties
   */
  constructor(props = {}) {
    this.E = props.E ?? 210e9; // Young's modulus (Pa)
    this.nu = props.nu ?? 0.3; // Poisson's ratio
    this.rho = props.rho ?? 7850.0; // Density (kg/m^3)
    this.criticalPlasticStrain = props.criticalPlasticStrain || 0.35; // Failure threshold
    this.safetyFactor = props.safetyFactor || 0.85; // CFL safety factor (<= 0.9)
  }

  /**
   * Calculate dilatational acoustic wave speed c_d (m/s)
   * c_d = sqrt( (E * (1 - nu)) / (rho * (1 + nu) * (1 - 2*nu)) )
   * @returns {number} Wave speed in m/s
   */
  calculateWaveSpeed() {
    const num = this.E * (1.0 - this.nu);
    const denom = this.rho * (1.0 + this.nu) * (1.0 - 2.0 * this.nu);
    if (!Number.isFinite(num) || num <= 0) {
      throw new OmniError(
        OmniErrorCode.NUMERICAL_FAILURE,
        "Young's modulus must be positive and finite to compute a real wave speed."
      );
    }
    if (denom <= 0) {
      throw new OmniError(
        OmniErrorCode.NUMERICAL_FAILURE,
        'Invalid material constants resulting in imaginary wave speed.'
      );
    }
    return Math.sqrt(num / denom);
  }

  /**
   * Calculate stable critical time step dt_crit = safety * (L_min / c_d)
   * @param {number} minElementEdgeLength L_char (m)
   * @returns {number} Critical time step (s)
   */
  calculateStableTimeStep(minElementEdgeLength) {
    if (minElementEdgeLength <= 0) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Element characteristic length must be positive.');
    }
    const cd = this.calculateWaveSpeed();
    return this.safetyFactor * (minElementEdgeLength / cd);
  }

  /**
   * Perform single explicit central difference time integration step
   * @param {Float64Array} u Current displacement vector
   * @param {Float64Array} vHalf Previous mid-step velocity v_(n-1/2)
   * @param {Float64Array} fExt External force vector
   * @param {Float64Array} fInt Internal nodal force vector
   * @param {Float64Array} lumpedMass Diagonal lumped mass vector M
   * @param {number} dt Time step size (s)
   * @returns {{ uNext: Float64Array, vNextHalf: Float64Array, accel: Float64Array }}
   */
  stepCentralDifference(u, vHalf, fExt, fInt, lumpedMass, dt) {
    const n = u.length;
    const accel = new Float64Array(n);
    const vNextHalf = new Float64Array(n);
    const uNext = new Float64Array(n);

    // a_n = (F_ext - F_int) / M
    for (let i = 0; i < n; i++) {
      const m = lumpedMass[i] || 1e-12;
      accel[i] = (fExt[i] - fInt[i]) / m;
      // v_(n+1/2) = v_(n-1/2) + dt * a_n
      vNextHalf[i] = vHalf[i] + dt * accel[i];
      // u_(n+1) = u_n + dt * v_(n+1/2)
      uNext[i] = u[i] + dt * vNextHalf[i];
    }

    return { uNext, vNextHalf, accel };
  }

  /**
   * Check element erosion condition
   * @param {number} equivalentPlasticStrain
   * @returns {boolean} True if element should be deleted/eroded
   */
  isElementEroded(equivalentPlasticStrain) {
    return equivalentPlasticStrain >= this.criticalPlasticStrain;
  }
}

class ExplicitDynamicsCrashSolver extends ExplicitDynamicsCrash {
  static calculateDilatationalWaveSpeed(E, nu, rho) {
    const solver = new ExplicitDynamicsCrashSolver({ E, nu, rho });
    return solver.calculateWaveSpeed();
  }
}

module.exports = { ExplicitDynamicsCrash, ExplicitDynamicsCrashSolver };
