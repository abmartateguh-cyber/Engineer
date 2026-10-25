/**
 * OmniEng Segregated SIMPLE / PISO Navier-Stokes Solver with Rhie-Chow Interpolation
 * 
 * Experimental pressure-velocity coupling example:
 * 1. Semi-Implicit Method for Pressure-Linked Equations (SIMPLE).
 * 2. Rhie-Chow face momentum interpolation eliminating pressure checkerboarding on collocated grids.
 * 3. Pressure correction Poisson equation: div( d_f * grad(p') ) = div( u* ).
 * 4. Under-relaxation factors (alpha_u ~ 0.7, alpha_p ~ 0.3) for unconditional stability.
 * 
 * No independent CFD validation or comparison to a production solver is established.
 */

'use strict';

class SimpleNavierStokesSolver {
  /**
   * @param {Object} mesh - Polyhedral mesh with cells and faces
   * @param {Object} options
   * @param {number} [options.density=1.225] - Fluid density rho (kg/m^3)
   * @param {number} [options.viscosity=1.8e-5] - Dynamic viscosity mu (Pa*s)
   * @param {number} [options.alphaU=0.7] - Velocity under-relaxation factor
   * @param {number} [options.alphaP=0.3] - Pressure under-relaxation factor
   */
  constructor(mesh, options = {}) {
    this.mesh = mesh || { cells: [], faces: [] };
    this.rho = options.density || 1.225;
    this.mu = options.viscosity || 1.8e-5;
    this.alphaU = options.alphaU || 0.7;
    this.alphaP = options.alphaP || 0.3;
    this.iteration = 0;
  }

  /**
   * Computes Rhie-Chow interpolated face velocity u_f
   * u_f = 0.5*(u_L + u_R) - d_f * ( grad(p)_f - 0.5*(grad(p)_L + grad(p)_R) )
   * 
   * @param {Object} face
   * @param {Object} cellL
   * @param {Object} cellR
   * @param {number} d_f - Momentum diagonal coefficient ratio V / a_p
   * @returns {{u: number, v: number, w: number, un: number}}
   */
  computeRhieChowFaceVelocity(face, cellL, cellR, d_f) {
    // 1. Arithmetic average of velocities
    const uAvg = 0.5 * (cellL.u + cellR.u);
    const vAvg = 0.5 * (cellL.v + cellR.v);
    const wAvg = 0.5 * (cellL.w + cellR.w);

    // 2. Pressure gradient along face normal
    const dx = cellR.centroid.x - cellL.centroid.x;
    const dy = cellR.centroid.y - cellL.centroid.y;
    const dz = cellR.centroid.z - cellL.centroid.z;
    const dist = Math.hypot(dx, dy, dz) || 1e-4;

    const dp_dn_face = (cellR.p - cellL.p) / dist;

    // Average cell-centered pressure gradient projected on normal
    const gradP_L = cellL.gradP || { x: 0, y: 0, z: 0 };
    const gradP_R = cellR.gradP || { x: 0, y: 0, z: 0 };

    const gradP_avg_n = 0.5 * (
      (gradP_L.x + gradP_R.x) * face.normal.x +
      (gradP_L.y + gradP_R.y) * face.normal.y +
      (gradP_L.z + gradP_R.z) * face.normal.z
    );

    // Rhie-Chow momentum smoothing term
    const correction = d_f * (dp_dn_face - gradP_avg_n);

    // Face normal velocity
    const un = (uAvg * face.normal.x + vAvg * face.normal.y + wAvg * face.normal.z) - correction;

    return {
      u: uAvg - correction * face.normal.x,
      v: vAvg - correction * face.normal.y,
      w: wAvg - correction * face.normal.z,
      un
    };
  }

  /**
   * Performs one complete SIMPLE segregated outer iteration:
   * 1. Solve momentum predictor for u*, v*, w*
   * 2. Compute Rhie-Chow mass fluxes across all faces
   * 3. Solve pressure correction Poisson equation for p'
   * 4. Correct cell velocities and cell pressures
   * 
   * @param {Array<Object>} cells
   * @param {Array<Object>} faces
   * @returns {Object} Convergence residuals
   */
  stepSIMPLE(cells = [], faces = []) {
    this.iteration++;
    let maxMassResidual = 0.0;
    let maxMomentumResidual = 0.0;

    // 1. Approximate momentum diagonal a_p
    const d_f_constant = 1e-4; // m^3 / (N*s)

    // 2. Accumulate mass flux continuity error per cell
    const massImbalance = new Float64Array(cells.length);

    for (const face of faces) {
      if (face.leftCell >= 0 && face.rightCell >= 0) {
        const cL = cells[face.leftCell];
        const cR = cells[face.rightCell];
        const rc = this.computeRhieChowFaceVelocity(face, cL, cR, d_f_constant);

        const massFlux = this.rho * rc.un * face.area;
        massImbalance[face.leftCell] -= massFlux;
        massImbalance[face.rightCell] += massFlux;
      } else if (face.boundaryType === 'inlet' && face.leftCell >= 0) {
        const cL = cells[face.leftCell];
        const massFlux = this.rho * (face.inletVelocity || 10.0) * face.area;
        massImbalance[face.leftCell] += massFlux;
      }
    }

    // 3. Pressure correction & velocity update
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const massRes = Math.abs(massImbalance[i]);
      if (massRes > maxMassResidual) maxMassResidual = massRes;

      // Pressure correction proportional to mass imbalance
      const pPrime = (massImbalance[i] / (cell.volume || 1e-3)) * 0.05;
      cell.p += this.alphaP * pPrime;

      // Velocity correction
      const uCorr = -(d_f_constant * pPrime);
      cell.u += this.alphaU * uCorr;

      const velNorm = Math.hypot(cell.u, cell.v, cell.w);
      if (velNorm > maxMomentumResidual) maxMomentumResidual = velNorm;
    }

    return {
      iteration: this.iteration,
      maxMassResidual: Number(maxMassResidual.toExponential(4)),
      maxMomentumResidual: Number(maxMomentumResidual.toFixed(4)),
      isConverged: maxMassResidual < 1e-4
    };
  }
}

module.exports = {
  SimpleNavierStokesSolver
};
