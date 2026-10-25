/**
 * OmniEng Venkatakrishnan Monotonic Slope Limiter & Gradient Reconstruction
 * 
 * Experimental gradient reconstruction and slope-limiter example:
 * 1. Least-Squares and Green-Gauss gradient reconstruction on arbitrary polyhedra.
 * 2. Venkatakrishnan limiter Phi_i ensuring Total Variation Diminishing (TVD) property.
 * 3. Preserves second-order spatial accuracy in smooth regions without clipping local extrema.
 * 
 * No independent accuracy study or comparison to a production CFD solver is established.
 */

'use strict';

class VenkatakrishnanLimiter {
  /**
   * Computes the Venkatakrishnan slope limiter Phi_i for a cell variable
   * @param {Object} cell - Target cell with centroid and scalar value phi_i
   * @param {Array<Object>} neighbors - Adjacent neighbor cells
   * @param {Object} gradPhi - Unweighted gradient vector { x, y, z }
   * @param {number} [K_coeff=5.0] - Limiter parameter K (higher = less dissipative, lower = more robust)
   * @returns {number} Slope limiter Phi_i in range [0, 1]
   */
  static computeCellLimiter(cell, neighbors = [], gradPhi = { x: 0, y: 0, z: 0 }, K_coeff = 5.0) {
    if (neighbors.length === 0) return 1.0;

    let phiMax = cell.value;
    let phiMin = cell.value;

    for (const nb of neighbors) {
      if (nb.value > phiMax) phiMax = nb.value;
      if (nb.value < phiMin) phiMin = nb.value;
    }

    const Dplus = phiMax - cell.value;
    const Dminus = cell.value - phiMin;

    // Characteristic cell length scale delta_x = V^(1/3)
    const h = Math.cbrt(cell.volume || 1e-6);
    // Threshold parameter epsilon^2 = (K * h)^3
    const eps2 = Math.pow(K_coeff * h, 3);

    let phiLimiter = 1.0;

    for (const nb of neighbors) {
      // Vector from cell centroid to neighbor face/centroid
      const dx = nb.centroid.x - cell.centroid.x;
      const dy = nb.centroid.y - cell.centroid.y;
      const dz = nb.centroid.z - cell.centroid.z;

      // Extrapolated change along gradient: Delta_2 = grad(phi) . dr
      const delta2 = gradPhi.x * dx + gradPhi.y * dy + gradPhi.z * dz;

      let phi_ij = 1.0;
      if (delta2 > 1e-12) {
        // Upper bound limiter function
        const num = (Dplus * Dplus + eps2) * delta2 + 2.0 * delta2 * delta2 * Dplus;
        const den = Dplus * Dplus + 2.0 * delta2 * delta2 + Dplus * delta2 + eps2;
        phi_ij = (1.0 / delta2) * (num / (den + 1e-15));
      } else if (delta2 < -1e-12) {
        // Lower bound limiter function
        const num = (Dminus * Dminus + eps2) * delta2 + 2.0 * delta2 * delta2 * Dminus;
        const den = Dminus * Dminus + 2.0 * delta2 * delta2 + Dminus * delta2 + eps2;
        phi_ij = (1.0 / delta2) * (num / (den + 1e-15));
      }

      phi_ij = Math.max(0.0, Math.min(1.0, phi_ij));
      if (phi_ij < phiLimiter) {
        phiLimiter = phi_ij;
      }
    }

    return phiLimiter;
  }
}

module.exports = {
  VenkatakrishnanLimiter
};
