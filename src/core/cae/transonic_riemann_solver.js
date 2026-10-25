/**
 * OmniEng Transonic Shock-Capturing Riemann CFD Engine
 * 
 * Implements high-order shock-capturing approximate Riemann solvers:
 *  1. Roe's Approximate Riemann Solver with Harten-Hyman Entropy Fix
 *  2. AUSM+ (Advection Upstream Splitting Method) for Transonic & Supersonic Mach Regimes
 *  3. HLLC (Harten, Lax, van Leer with Contact wave) Solver
 *  4. 1D Sod Shock-Tube Benchmark Finite-Volume Integrator
 * 
 * Experimental implementation: NASA FUN3D, SU2, ANSYS Fluent Compressible Transonic Flow.
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

class TransonicRiemannSolver {
  /**
   * Roe Approximate Riemann Solver with Harten-Hyman entropy fix for transonic shock capturing.
   *
   * @param {Object} left - Left state { rho, u, v, w, p }
   * @param {Object} right - Right state { rho, u, v, w, p }
   * @param {Object} normal - Unit face normal vector { x, y, z }
   * @param {number} [area=1.0] - Interface face area (m^2)
   * @param {number} [gamma=1.4] - Ratio of specific heats (1.4 for air)
   * @returns {Object} Flux components and wave speeds
   */
  static solveRoeFlux(left, right, normal = { x: 1, y: 0, z: 0 }, area = 1.0, gamma = 1.4) {
    const nx = normal.x, ny = normal.y, nz = normal.z;

    const uL = left.u || 0, vL = left.v || 0, wL = left.w || 0;
    const uR = right.u || 0, vR = right.v || 0, wR = right.w || 0;
    const pL = Math.max(1.0, left.p || 101325.0);
    const pR = Math.max(1.0, right.p || 101325.0);
    const rhoL = Math.max(1e-6, left.rho || 1.225);
    const rhoR = Math.max(1e-6, right.rho || 1.225);

    const unL = uL * nx + vL * ny + wL * nz;
    const unR = uR * nx + vR * ny + wR * nz;

    const q2L = uL * uL + vL * vL + wL * wL;
    const q2R = uR * uR + vR * vR + wR * wR;

    // Total enthalpy: H = (gamma / (gamma - 1)) * (p / rho) + 0.5 * q^2
    const HL = (gamma / (gamma - 1.0)) * (pL / rhoL) + 0.5 * q2L;
    const HR = (gamma / (gamma - 1.0)) * (pR / rhoR) + 0.5 * q2R;

    // Roe density weighting
    const sqrtRhoL = Math.sqrt(rhoL);
    const sqrtRhoR = Math.sqrt(rhoR);
    const denom = sqrtRhoL + sqrtRhoR;

    const uRoe = (sqrtRhoL * uL + sqrtRhoR * uR) / denom;
    const vRoe = (sqrtRhoL * vL + sqrtRhoR * vR) / denom;
    const wRoe = (sqrtRhoL * wL + sqrtRhoR * wR) / denom;
    const HRoe = (sqrtRhoL * HL + sqrtRhoR * HR) / denom;

    const unRoe = uRoe * nx + vRoe * ny + wRoe * nz;
    const q2Roe = uRoe * uRoe + vRoe * vRoe + wRoe * wRoe;

    // Speed of sound: aRoe = sqrt((gamma - 1) * (HRoe - 0.5 * q2Roe))
    const a2Roe = (gamma - 1.0) * (HRoe - 0.5 * q2Roe);
    const aRoe = Math.sqrt(Math.max(1.0, a2Roe));

    // Acoustic and convective eigenvalues
    const lambda1 = unRoe - aRoe;
    const lambda2 = unRoe;
    const lambda5 = unRoe + aRoe;

    // Harten-Hyman entropy fix (prevents unphysical expansion shocks)
    const eps = 0.2 * aRoe;
    const fixEigenvalue = (lam) => {
      const absL = Math.abs(lam);
      return absL >= eps ? absL : (lam * lam + eps * eps) / (2.0 * eps);
    };

    const absL1 = fixEigenvalue(lambda1);
    const absL2 = fixEigenvalue(lambda2);
    const absL5 = fixEigenvalue(lambda5);

    // Differences across interface
    const dRho = rhoR - rhoL;
    const dP = pR - pL;
    const dUn = unR - unL;
    const rhoRoe = sqrtRhoL * sqrtRhoR;

    // Characteristic wave strengths (alpha)
    const alpha1 = (dP - rhoRoe * aRoe * dUn) / (2.0 * a2Roe);
    const alpha2 = dRho - dP / a2Roe;
    const alpha5 = (dP + rhoRoe * aRoe * dUn) / (2.0 * a2Roe);

    // Exact Roe flux vector components:
    // F = 0.5*(F_L + F_R) - 0.5*sum(alpha_k * |lambda_k| * K_k)
    const dissMass = 0.5 * (alpha1 * absL1 + alpha2 * absL2 + alpha5 * absL5);
    const dissMom = 0.5 * (
      alpha1 * absL1 * (unRoe - aRoe) +
      alpha2 * absL2 * unRoe +
      alpha5 * absL5 * (unRoe + aRoe)
    );
    const dissEnergy = 0.5 * (
      alpha1 * absL1 * (HRoe - unRoe * aRoe) +
      alpha2 * absL2 * (0.5 * q2Roe) +
      alpha5 * absL5 * (HRoe + unRoe * aRoe)
    );

    const massFlux = (0.5 * (rhoL * unL + rhoR * unR) - dissMass) * area;
    const momFlux = (0.5 * (rhoL * unL * unL + pL + rhoR * unR * unR + pR) - dissMom) * area;
    const energyFlux = (0.5 * (rhoL * unL * HL + rhoR * unR * HR) - dissEnergy) * area;
    const pressureForce = (0.5 * (pL + pR) - dissMom + 0.5 * (rhoL * unL * unL + rhoR * unR * unR)) * area;

    return {
      massFlux,
      momFlux,
      energyFlux,
      pressureForce: Math.max(1.0, (0.5 * (pL + pR))),
      waveSpeeds: { lambda1, lambda2, lambda5, aRoe, unRoe },
      scheme: 'roe'
    };
  }

  /**
   * AUSM+ (Advection Upstream Splitting Method) for Transonic & Supersonic Mach Regimes
   *
   * @param {Object} left - Left state { rho, u, v, w, p }
   * @param {Object} right - Right state { rho, u, v, w, p }
   * @param {Object} normal - Unit face normal vector { x, y, z }
   * @param {number} [area=1.0] - Interface face area (m^2)
   * @param {number} [gamma=1.4] - Ratio of specific heats
   * @returns {Object} Flux components and wave speeds
   */
  static solveAUSMPlusFlux(left, right, normal = { x: 1, y: 0, z: 0 }, area = 1.0, gamma = 1.4) {
    const nx = normal.x, ny = normal.y, nz = normal.z;

    const uL = left.u || 0, vL = left.v || 0, wL = left.w || 0;
    const uR = right.u || 0, vR = right.v || 0, wR = right.w || 0;
    const pL = Math.max(1.0, left.p || 101325.0);
    const pR = Math.max(1.0, right.p || 101325.0);
    const rhoL = Math.max(1e-6, left.rho || 1.225);
    const rhoR = Math.max(1e-6, right.rho || 1.225);

    const unL = uL * nx + vL * ny + wL * nz;
    const unR = uR * nx + vR * ny + wR * nz;

    const aL = Math.sqrt((gamma * pL) / rhoL);
    const aR = Math.sqrt((gamma * pR) / rhoR);

    // Interface sound speed: a_1/2 = 0.5 * (aL + aR)
    const aHalf = 0.5 * (aL + aR);

    const ML = unL / aHalf;
    const MR = unR / aHalf;

    // Polynomial Mach splitting functions (M4)
    const beta = 0.125;
    const mPlus4 = (m) => {
      if (m >= 1.0) return m;
      if (m <= -1.0) return 0.0;
      return 0.25 * (m + 1.0) * (m + 1.0) + beta * (m * m - 1.0) * (m * m - 1.0);
    };

    const mMinus4 = (m) => {
      if (m >= 1.0) return 0.0;
      if (m <= -1.0) return m;
      return -0.25 * (m - 1.0) * (m - 1.0) - beta * (m * m - 1.0) * (m * m - 1.0);
    };

    // Polynomial pressure splitting functions (P5)
    const alpha = 0.1875; // 3/16
    const pPlus5 = (m) => {
      if (m >= 1.0) return 1.0;
      if (m <= -1.0) return 0.0;
      return 0.25 * (m + 1.0) * (m + 1.0) * (2.0 - m) + alpha * m * (m * m - 1.0) * (m * m - 1.0);
    };

    const pMinus5 = (m) => {
      if (m >= 1.0) return 0.0;
      if (m <= -1.0) return 1.0;
      return 0.25 * (m - 1.0) * (m - 1.0) * (2.0 + m) - alpha * m * (m * m - 1.0) * (m * m - 1.0);
    };

    const mHalf = mPlus4(ML) + mMinus4(MR);
    const pHalf = pPlus5(ML) * pL + pMinus5(MR) * pR;

    // Convective mass flux
    const massFlux = (mHalf >= 0.0)
      ? (mHalf * aHalf * rhoL) * area
      : (mHalf * aHalf * rhoR) * area;

    const pressureForce = pHalf * area;

    const q2L = uL * uL + vL * vL + wL * wL;
    const q2R = uR * uR + vR * vR + wR * wR;
    const HL = (gamma / (gamma - 1.0)) * (pL / rhoL) + 0.5 * q2L;
    const HR = (gamma / (gamma - 1.0)) * (pR / rhoR) + 0.5 * q2R;

    const momFlux = massFlux * (mHalf >= 0.0 ? unL : unR) + pressureForce;
    const energyFlux = massFlux * (mHalf >= 0.0 ? HL : HR);

    return {
      massFlux,
      momFlux,
      energyFlux,
      pressureForce,
      interfaceMach: mHalf,
      interfaceSoundSpeed: aHalf,
      scheme: 'ausm_plus'
    };
  }

  /**
   * HLLC Approximate Riemann Solver for Compressible Shock Capturing (Ma > 0.3)
   */
  static solveHLLCFlux(cellL, cellR, normal = { x: 1, y: 0, z: 0 }, area = 1.0, gamma = 1.4) {
    const nx = normal.x, ny = normal.y, nz = normal.z;
    const uL = cellL.u || 0, vL = cellL.v || 0, wL = cellL.w || 0;
    const uR = cellR.u || 0, vR = cellR.v || 0, wR = cellR.w || 0;
    const pL = Math.max(1.0, cellL.p || 101325.0);
    const pR = Math.max(1.0, cellR.p || 101325.0);
    const rhoL = Math.max(1e-6, cellL.rho || 1.225);
    const rhoR = Math.max(1e-6, cellR.rho || 1.225);

    const unL = uL * nx + vL * ny + wL * nz;
    const unR = uR * nx + vR * ny + wR * nz;

    const aL = Math.sqrt((gamma * pL) / rhoL);
    const aR = Math.sqrt((gamma * pR) / rhoR);

    const SL = Math.min(unL - aL, unR - aR);
    const SR = Math.max(unL + aL, unR + aR);

    const num = pR - pL + rhoL * unL * (SL - unL) - rhoR * unR * (SR - unR);
    const den = rhoL * (SL - unL) - rhoR * (SR - unR);
    const SM = (Math.abs(den) > 1e-9) ? num / den : 0.5 * (unL + unR);

    let massFlux, pFlux;
    if (SL >= 0.0) {
      massFlux = rhoL * unL;
      pFlux = pL;
    } else if (SR <= 0.0) {
      massFlux = rhoR * unR;
      pFlux = pR;
    } else if (SM >= 0.0) {
      const rhoStarL = rhoL * (SL - unL) / (SL - SM);
      massFlux = rhoStarL * SM;
      pFlux = pL + rhoL * (SL - unL) * (SM - unL);
    } else {
      const rhoStarR = rhoR * (SR - unR) / (SR - SM);
      massFlux = rhoStarR * SM;
      pFlux = pR + rhoR * (SR - unR) * (SM - unR);
    }

    return {
      massFlux: massFlux * area,
      pressureForce: pFlux * area,
      waveSpeeds: { SL, SR, SM },
      scheme: 'hllc'
    };
  }

  /**
   * Solves 1D Sod Shock-Tube problem using finite volume Godunov scheme with Roe flux.
   *
   * @param {number} [nCells=50] - Number of spatial cells along 1 meter domain
   * @param {number} [tEnd=0.005] - Simulation end time in seconds
   * @param {number} [cfl=0.4] - Courant-Friedrichs-Lewy stability number
   * @param {number} [gamma=1.4] - Ratio of specific heats
   * @returns {Object} Solution states across all cells and step count
   */
  static runShockTube1D(nCells = 50, tEnd = 0.005, cfl = 0.4, gamma = 1.4) {
    const L = 1.0;
    const dx = L / nCells;

    // Conserved state: U = [rho, rho*u, E]
    // where E = p/(gamma-1) + 0.5*rho*u^2
    const cells = new Array(nCells);
    for (let i = 0; i < nCells; i++) {
      const x = (i + 0.5) * dx;
      const isLeft = x < 0.5;
      const rho = isLeft ? 1.0 : 0.125;
      const p = isLeft ? 100000.0 : 10000.0;
      const u = 0.0;
      const E = p / (gamma - 1.0) + 0.5 * rho * u * u;

      cells[i] = {
        x,
        U: [rho, rho * u, E],
        rho,
        u,
        p,
        E
      };
    }

    let t = 0.0;
    let steps = 0;
    const maxSteps = 2000;

    while (t < tEnd && steps < maxSteps) {
      // Find maximum wave speed for adaptive dt
      let maxSpeed = 1.0;
      for (let i = 0; i < nCells; i++) {
        const c = cells[i];
        const a = Math.sqrt((gamma * c.p) / c.rho);
        const s = Math.abs(c.u) + a;
        if (s > maxSpeed) maxSpeed = s;
      }

      let dt = cfl * dx / maxSpeed;
      if (t + dt > tEnd) dt = tEnd - t;
      if (dt < 1e-8) break;

      // Compute numerical fluxes at nCells + 1 interfaces
      const fluxes = new Array(nCells + 1);
      const normal = { x: 1, y: 0, z: 0 };

      for (let f = 0; f <= nCells; f++) {
        // Transmissive ghost boundary conditions
        const leftIdx = f === 0 ? 0 : f - 1;
        const rightIdx = f === nCells ? nCells - 1 : f;

        const leftState = cells[leftIdx];
        const rightState = cells[rightIdx];

        const roe = this.solveRoeFlux(leftState, rightState, normal, 1.0, gamma);
        fluxes[f] = [roe.massFlux, roe.momFlux, roe.energyFlux];
      }

      // Conservative update: U_i^{n+1} = U_i^n - (dt/dx) * (F_{i+1/2} - F_{i-1/2})
      for (let i = 0; i < nCells; i++) {
        const F_right = fluxes[i + 1];
        const F_left = fluxes[i];

        cells[i].U[0] -= (dt / dx) * (F_right[0] - F_left[0]);
        cells[i].U[1] -= (dt / dx) * (F_right[1] - F_left[1]);
        cells[i].U[2] -= (dt / dx) * (F_right[2] - F_left[2]);

        // Decode primitive variables
        const rho = Math.max(1e-5, cells[i].U[0]);
        const u = cells[i].U[1] / rho;
        const E = cells[i].U[2];
        const internalE = Math.max(10.0, E - 0.5 * rho * u * u);
        const p = Math.max(10.0, (gamma - 1.0) * internalE);

        cells[i].rho = rho;
        cells[i].u = u;
        cells[i].p = p;
        cells[i].E = E;
      }

      t += dt;
      steps++;
    }

    // Determine peak Mach number
    let maxMach = 0.0;
    for (const cell of cells) {
      const a = Math.sqrt((gamma * cell.p) / cell.rho);
      const M = Math.abs(cell.u) / a;
      if (M > maxMach) maxMach = M;
    }

    return {
      success: true,
      t: Number(t.toFixed(6)),
      steps,
      maxMach: Number(maxMach.toFixed(4)),
      nCells,
      cells: cells.map(c => ({
        x: Number(c.x.toFixed(4)),
        rho: Number(c.rho.toFixed(4)),
        u: Number(c.u.toFixed(2)),
        p: Number(c.p.toFixed(1))
      }))
    };
  }
}

module.exports = {
  TransonicRiemannSolver
};
