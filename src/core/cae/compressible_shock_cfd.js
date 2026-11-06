/**
 * CompressibleShockCFD: Density-Based Compressible Navier-Stokes & Shock-Capturing Engine
 *
 * Implements ANSYS Fluent / NASA CFD grade high-speed compressible aerodynamics:
 *   1. Conservative state vector U = [rho, rho*u, rho*v, E_total]^T.
 *   2. Ideal gas equation of state: p = (gamma - 1) * (E_total - 0.5 * rho * (u^2 + v^2)).
 *   3. Acoustic speed of sound: a = sqrt(gamma * p / rho).
 *   4. Roe approximate Riemann solver with Harten entropy fix (sharp shock & contact resolution).
 *   5. Oblique shock wave angle & pressure ratio verification per Rankine-Hugoniot jump relations.
 */

'use strict';

const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

class CompressibleShockCFD {
  /**
   * @param {Object} [props]
   */
  constructor(props = {}) {
    this.gamma = props.gamma || 1.4; // Ratio of specific heats (air)
    this.R_gas = props.R_gas || 287.05; // J / (kg K)
  }

  /**
   * Compute primitive variables [rho, u, v, p, T, a, Mach] from conservative state U
   * @param {[number, number, number, number]} U [rho, rho*u, rho*v, E_total]
   * @returns {{ rho: number, u: number, v: number, p: number, T: number, a: number, Mach: number }}
   */
  conservativeToPrimitive(U) {
    const rho = U[0];
    if (rho <= 0) {
      throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, `Non-positive density rho = ${rho}`);
    }
    const u = U[1] / rho;
    const v = U[2] / rho;
    const E_total = U[3];
    const e_kinetic = 0.5 * (u * u + v * v);
    const e_internal = (E_total / rho) - e_kinetic;

    const p = (this.gamma - 1.0) * rho * e_internal;
    if (p <= 0) {
      throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, `Non-positive pressure p = ${p}`);
    }

    const T = p / (rho * this.R_gas);
    const a = Math.sqrt((this.gamma * p) / rho);
    const vel = Math.hypot(u, v);
    const Mach = vel / a;

    return { rho, u, v, p, T, a, Mach };
  }

  /**
   * Evaluate Roe Numerical Flux across a cell interface with normal n = [nx, ny]
   * @param {[number, number, number, number]} UL Left conservative state
   * @param {[number, number, number, number]} UR Right conservative state
   * @param {[number, number]} normal Unit normal vector [nx, ny] pointing from L to R
   * @returns {[number, number, number, number]} Interface flux vector F_roe
   */
  computeRoeFlux(UL, UR, normal = [1.0, 0.0]) {
    const nx = normal[0];
    const ny = normal[1];

    const primL = this.conservativeToPrimitive(UL);
    const primR = this.conservativeToPrimitive(UR);

    const unL = primL.u * nx + primL.v * ny;
    const unR = primR.u * nx + primR.v * ny;

    const HL = (UL[3] + primL.p) / primL.rho;
    const HR = (UR[3] + primR.p) / primR.rho;

    // Standard physical flux on Left: F(UL)
    const FL = [
      primL.rho * unL,
      primL.rho * primL.u * unL + primL.p * nx,
      primL.rho * primL.v * unL + primL.p * ny,
      (UL[3] + primL.p) * unL
    ];

    // Standard physical flux on Right: F(UR)
    const FR = [
      primR.rho * unR,
      primR.rho * primR.u * unR + primR.p * nx,
      primR.rho * primR.v * unR + primR.p * ny,
      (UR[3] + primR.p) * unR
    ];

    // Roe-averaged quantities
    const sL = Math.sqrt(primL.rho);
    const sR = Math.sqrt(primR.rho);
    const sLR = sL + sR;

    const uRoe = (sL * primL.u + sR * primR.u) / sLR;
    const vRoe = (sL * primL.v + sR * primR.v) / sLR;
    const hRoe = (sL * HL + sR * HR) / sLR;
    const q2Roe = uRoe * uRoe + vRoe * vRoe;

    const aRoe2 = (this.gamma - 1.0) * (hRoe - 0.5 * q2Roe);
    const aRoe = Math.sqrt(Math.max(1e-6, aRoe2));
    const unRoe = uRoe * nx + vRoe * ny;

    // Differences delta U = UR - UL
    const dU = [UR[0] - UL[0], UR[1] - UL[1], UR[2] - UL[2], UR[3] - UL[3]];
    const dUn = unR - unL;
    const dp = primR.p - primL.p;
    const drho = primR.rho - primL.rho;

    // Wave strengths alpha
    const alpha2 = (dp - primL.rho * aRoe * dUn) / (2.0 * aRoe2);
    const alpha3 = drho - dp / aRoe2;
    const alpha4 = (dp + primL.rho * aRoe * dUn) / (2.0 * aRoe2);

    // Eigenvalues lambda with Harten-Hyman entropy fix (prevents unphysical expansion shocks)
    const epsEntropy = 0.1 * aRoe;
    const entropyFix = (lam) => {
      const absLam = Math.abs(lam);
      return absLam >= epsEntropy ? absLam : (lam * lam + epsEntropy * epsEntropy) / (2.0 * epsEntropy);
    };
    const lambda1 = entropyFix(unRoe - aRoe);
    const lambda2 = entropyFix(unRoe);
    const lambda3 = entropyFix(unRoe + aRoe);

    // Roe flux: F_roe = 0.5 * (F_L + F_R) - 0.5 * sum(lambda_k * alpha_k * K_k)
    const F_roe = [
      0.5 * (FL[0] + FR[0]) - 0.5 * (lambda1 * alpha2 + lambda2 * alpha3 + lambda3 * alpha4),
      0.5 * (FL[1] + FR[1]) - 0.5 * (lambda1 * alpha2 * (uRoe - aRoe * nx) + lambda2 * alpha3 * uRoe + lambda3 * alpha4 * (uRoe + aRoe * nx)),
      0.5 * (FL[2] + FR[2]) - 0.5 * (lambda1 * alpha2 * (vRoe - aRoe * ny) + lambda2 * alpha3 * vRoe + lambda3 * alpha4 * (vRoe + aRoe * ny)),
      0.5 * (FL[3] + FR[3]) - 0.5 * (lambda1 * alpha2 * (hRoe - aRoe * unRoe) + lambda2 * alpha3 * (0.5 * q2Roe) + lambda3 * alpha4 * (hRoe + aRoe * unRoe))
    ];

    return F_roe;
  }

  /**
   * Calculate exact Oblique Shock wave angle beta from freestream Mach M1 and deflection angle theta
   * Using the theta-beta-M relation: tan(theta) = 2*cot(beta) * (M1^2 * sin^2(beta) - 1) / (M1^2 * (gamma + cos(2*beta)) + 2)
   * @param {number} M1 Freestream Mach number > 1
   * @param {number} thetaDeg Deflection angle in degrees
   * @returns {{ betaDeg: number, pRatio: number, M2: number }}
   */
  solveObliqueShock(M1, thetaDeg) {
    if (M1 <= 1.0) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Freestream Mach number must be supersonic (M1 > 1.0).');
    }
    const theta = (thetaDeg * Math.PI) / 180.0;
    const g = this.gamma;

    // Bisection search for weak shock angle beta in [asin(1/M1), pi/2]
    let betaMin = Math.asin(1.0 / M1);
    let betaMax = Math.PI / 2.0;

    const fBeta = (beta) => {
      const sinB = Math.sin(beta);
      const cosB = Math.cos(beta);
      const num = 2.0 * (cosB / sinB) * (M1 * M1 * sinB * sinB - 1.0);
      const denom = M1 * M1 * (g + Math.cos(2.0 * beta)) + 2.0;
      return Math.tan(theta) - num / denom;
    };

    let beta = (betaMin + betaMax) * 0.5;
    for (let iter = 0; iter < 50; iter++) {
      beta = (betaMin + betaMax) * 0.5;
      const res = fBeta(beta);
      if (Math.abs(res) < 1e-10) break;
      if (res > 0) {
        betaMin = beta;
      } else {
        betaMax = beta;
      }
    }

    const Mn1 = M1 * Math.sin(beta);
    // Rankine-Hugoniot pressure ratio: p2 / p1 = 1 + (2*gamma / (gamma+1)) * (Mn1^2 - 1)
    const pRatio = 1.0 + ((2.0 * g) / (g + 1.0)) * (Mn1 * Mn1 - 1.0);

    // Downstream normal Mach Mn2
    const Mn2_sq = (Mn1 * Mn1 + (2.0 / (g - 1.0))) / (((2.0 * g) / (g - 1.0)) * Mn1 * Mn1 - 1.0);
    const M2 = Math.sqrt(Math.max(0.01, Mn2_sq)) / Math.sin(beta - theta);

    return {
      betaDeg: (beta * 180.0) / Math.PI,
      pRatio,
      M2
    };
  }
}

module.exports = { CompressibleShockCFD };
