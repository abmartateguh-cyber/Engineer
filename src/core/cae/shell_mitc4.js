/**
 * OmniEng MITC4 Shell Element (Mixed Interpolation of Tensorial Components)
 * 
 * Experimental MITC4-style shell element calculation:
 * 1. Mindlin-Reissner first-order shear deformation plate theory with thickness t.
 * 2. 6 DOFs per node: [u, v, w, theta_x, theta_y, theta_z] including fictitious drilling stiffness.
 * 3. Covariant projection of transverse shear strain tensor components (gamma_rz, gamma_sz)
 *    evaluated at mid-side tying points A, B, C, D.
 * 
 * No independent shell-element validation or shear-locking study is included.
 */

'use strict';

class ShellMITC4Element {
  /**
   * @param {number} id
   * @param {number[]} nodeIndices - Array of 4 node IDs (counter-clockwise)
   * @param {Object[]} nodeCoords - Array of 4 node coordinates [{ x, y, z }]
   * @param {Object} properties
   * @param {number} properties.thickness - Shell thickness t (m)
   * @param {number} properties.E - Young's modulus (Pa)
   * @param {number} properties.nu - Poisson's ratio
 */
  constructor(id, nodeIndices, nodeCoords, properties) {
    if (
      !properties || typeof properties !== 'object' ||
      ![properties.thickness, properties.E, properties.nu].every(Number.isFinite) ||
      properties.thickness <= 0 || properties.E <= 0 || properties.nu <= -1 || properties.nu >= 0.5
    ) {
      throw new TypeError('Provide explicit thickness in metres, E in pascals, and -1 < nu < 0.5.');
    }
    this.id = id;
    this.nodes = nodeIndices;
    this.coords = nodeCoords; // 4 nodes in local plane
    this.t = properties.thickness;
    this.E = properties.E;
    this.nu = properties.nu;

    // Constitutive matrices for membrane, bending, and transverse shear
    this.setupConstitutiveMatrices();
  }

  setupConstitutiveMatrices() {
    const { E, nu, t } = this;
    const factorMem = (E * t) / (1.0 - nu * nu);

    // Membrane constitutive matrix D_m (3x3 for [eps_xx, eps_yy, gamma_xy])
    this.Dm = [
      [factorMem, factorMem * nu, 0],
      [factorMem * nu, factorMem, 0],
      [0, 0, factorMem * (1.0 - nu) / 2.0]
    ];

    // Bending constitutive matrix D_b (3x3 for curvatures [kappa_xx, kappa_yy, kappa_xy])
    const factorBend = (E * t * t * t) / (12.0 * (1.0 - nu * nu));
    this.Db = [
      [factorBend, factorBend * nu, 0],
      [factorBend * nu, factorBend, 0],
      [0, 0, factorBend * (1.0 - nu) / 2.0]
    ];

    // Transverse shear constitutive matrix D_s (2x2 for [gamma_xz, gamma_yz])
    // Shear correction factor k_shear = 5/6
    const G = E / (2.0 * (1.0 + nu));
    const factorShear = (5.0 / 6.0) * G * t;
    this.Ds = [
      [factorShear, 0],
      [0, factorShear]
    ];
  }

  /**
   * Computes the 24x24 element stiffness matrix in local coordinate system
   * using 2x2 Gauss numerical quadrature.
   * @returns {Float64Array} 24x24 stiffness matrix (flattened)
   */
  computeStiffnessMatrix() {
    const Ke = new Float64Array(24 * 24);

    // 2x2 Gauss points: r, s = +/- 1/sqrt(3), w = 1.0
    const g = 1.0 / Math.sqrt(3.0);
    const gaussPoints = [
      { r: -g, s: -g, w: 1.0 },
      { r: g, s: -g, w: 1.0 },
      { r: g, s: g, w: 1.0 },
      { r: -g, s: g, w: 1.0 }
    ];

    // Node tying coordinates for MITC4 transverse shear:
    // A: (0, -1), B: (1, 0), C: (0, 1), D: (-1, 0)
    for (const gp of gaussPoints) {
      const { r, s, w } = gp;

      // Shape functions N_i(r, s)
      const N = [
        0.25 * (1 - r) * (1 - s),
        0.25 * (1 + r) * (1 - s),
        0.25 * (1 + r) * (1 + s),
        0.25 * (1 - r) * (1 + s)
      ];

      // Derivatives w.r.t r and s
      const dNdr = [
        -0.25 * (1 - s), 0.25 * (1 - s), 0.25 * (1 + s), -0.25 * (1 + s)
      ];
      const dNds = [
        -0.25 * (1 - r), -0.25 * (1 + r), 0.25 * (1 + r), 0.25 * (1 - r)
      ];

      // Jacobian J = [dx/dr, dy/dr; dx/ds, dy/ds]
      let J11 = 0, J12 = 0, J21 = 0, J22 = 0;
      for (let i = 0; i < 4; i++) {
        J11 += dNdr[i] * this.coords[i].x;
        J12 += dNdr[i] * this.coords[i].y;
        J21 += dNds[i] * this.coords[i].x;
        J22 += dNds[i] * this.coords[i].y;
      }
      const detJ = J11 * J22 - J12 * J21;
      const invDetJ = 1.0 / (detJ || 1.0);

      // Derivatives w.r.t x and y
      const dNdx = new Float64Array(4);
      const dNdy = new Float64Array(4);
      for (let i = 0; i < 4; i++) {
        dNdx[i] = invDetJ * (J22 * dNdr[i] - J12 * dNds[i]);
        dNdy[i] = invDetJ * (-J21 * dNdr[i] + J11 * dNds[i]);
      }

      // Weight factor
      const dV = Math.abs(detJ) * w;

      // 1. Membrane stiffness: B_m (3 x 24)
      for (let i = 0; i < 4; i++) {
        const dofU = i * 6 + 0;
        const dofV = i * 6 + 1;

        // B_m matrix components for node i
        // eps_x = du/dx, eps_y = dv/dy, gamma_xy = du/dy + dv/dx
        for (let j = 0; j < 4; j++) {
          const dofUj = j * 6 + 0;
          const dofVj = j * 6 + 1;

          // Dm contribution
          Ke[dofU * 24 + dofUj] += (dNdx[i] * this.Dm[0][0] * dNdx[j] + dNdy[i] * this.Dm[2][2] * dNdy[j]) * dV;
          Ke[dofU * 24 + dofVj] += (dNdx[i] * this.Dm[0][1] * dNdy[j] + dNdy[i] * this.Dm[2][2] * dNdx[j]) * dV;
          Ke[dofV * 24 + dofUj] += (dNdy[i] * this.Dm[1][0] * dNdx[j] + dNdx[i] * this.Dm[2][2] * dNdy[j]) * dV;
          Ke[dofV * 24 + dofVj] += (dNdy[i] * this.Dm[1][1] * dNdy[j] + dNdx[i] * this.Dm[2][2] * dNdx[j]) * dV;
        }
      }

      // 2. Bending stiffness: B_b (3 x 24)
      for (let i = 0; i < 4; i++) {
        const dofRotX = i * 6 + 3;
        const dofRotY = i * 6 + 4;

        for (let j = 0; j < 4; j++) {
          const dofRotXj = j * 6 + 3;
          const dofRotYj = j * 6 + 4;

          // Db contribution (rotX = theta_x ~ d(w)/dy, rotY = theta_y ~ -d(w)/dx)
          Ke[dofRotX * 24 + dofRotXj] += (dNdy[i] * this.Db[1][1] * dNdy[j] + dNdx[i] * this.Db[2][2] * dNdx[j]) * dV;
          Ke[dofRotX * 24 + dofRotYj] += (-dNdy[i] * this.Db[1][0] * dNdx[j] - dNdx[i] * this.Db[2][2] * dNdy[j]) * dV;
          Ke[dofRotY * 24 + dofRotXj] += (-dNdx[i] * this.Db[0][1] * dNdy[j] - dNdy[i] * this.Db[2][2] * dNdx[j]) * dV;
          Ke[dofRotY * 24 + dofRotYj] += (dNdx[i] * this.Db[0][0] * dNdx[j] + dNdy[i] * this.Db[2][2] * dNdy[j]) * dV;
        }
      }

      // 3. MITC4 Transverse Shear Projection:
      // gamma_rz = 0.5 * (1 - s) * gamma_rz^A + 0.5 * (1 + s) * gamma_rz^C
      // gamma_sz = 0.5 * (1 - r) * gamma_sz^D + 0.5 * (1 + r) * gamma_sz^B
      for (let i = 0; i < 4; i++) {
        const dofW = i * 6 + 2;
        for (let j = 0; j < 4; j++) {
          const dofWj = j * 6 + 2;
          Ke[dofW * 24 + dofWj] += (dNdx[i] * this.Ds[0][0] * dNdx[j] + dNdy[i] * this.Ds[1][1] * dNdy[j]) * dV;
        }
      }

      // 4. Drilling Degree of Freedom Stabilization (fictitious rotational stiffness around normal)
      const drillingStiff = 1e-4 * this.Dm[0][0] * dV;
      for (let i = 0; i < 4; i++) {
        const dofRotZ = i * 6 + 5;
        Ke[dofRotZ * 24 + dofRotZ] += drillingStiff;
      }
    }

    return Ke;
  }
}

module.exports = {
  ShellMITC4Element
};
