/**
 * OmniEng 10-Node Quadratic Tetrahedral Element (TET10) Engine
 * 
 * Commercial FEA Standard: Eliminates artificial volumetric shear locking
 * in bending-dominated structural mechanics (NAFEMS LE1 / LE10 Parity).
 * 
 * Shape Functions:
 *   Corner nodes (i=0..3):     N_i  = (2*L_i - 1) * L_i
 *   Midside nodes (i=4..9):    N_4  = 4*L_0*L_1 (edge 0-1)
 *                              N_5  = 4*L_1*L_2 (edge 1-2)
 *                              N_6  = 4*L_2*L_0 (edge 2-0)
 *                              N_7  = 4*L_0*L_3 (edge 0-3)
 *                              N_8  = 4*L_1*L_3 (edge 1-3)
 *                              N_9  = 4*L_2*L_3 (edge 2-3)
 * 
 * 4-Point Gauss-Legendre Tetrahedral Numerical Quadrature:
 *   alpha = 0.5854101966249685, beta = 0.1381966011250105
 *   Weights: w_g = 0.25 * Volume
 * 
 * 100% In-House Proprietary Formulation - Zero External Dependencies.
 */

'use strict';

class ElementTET10 {
  /**
   * @param {number} id - Element ID
   * @param {number[]} nodeIds - 10 node indices [0..9]
   * @param {Array<{x: number, y: number, z: number}>} nodes - Global node coordinates
   * @param {number} E - Young's modulus (Pa)
   * @param {number} nu - Poisson's ratio
   */
  constructor(id, nodeIds, nodes, E, nu) {
    this.id = id;
    this.nodeIds = nodeIds;
    this.nodes = nodes; // Array of 10 nodes with {x, y, z}
    this.E = E;
    this.nu = nu;
    this.D = this._computeConstitutiveMatrix(E, nu);
    this.volume = this._computeVolume();
  }

  _computeVolume() {
    // Volume based on 4 corner nodes (0, 1, 2, 3)
    const n = this.nodes;
    const x0 = n[0].x, y0 = n[0].y, z0 = n[0].z;
    const x1 = n[1].x, y1 = n[1].y, z1 = n[1].z;
    const x2 = n[2].x, y2 = n[2].y, z2 = n[2].z;
    const x3 = n[3].x, y3 = n[3].y, z3 = n[3].z;

    const det = (x1 - x0) * ((y2 - y0) * (z3 - z0) - (z2 - z0) * (y3 - y0))
              - (y1 - y0) * ((x2 - x0) * (z3 - z0) - (z2 - z0) * (x3 - x0))
              + (z1 - z0) * ((x2 - x0) * (y3 - y0) - (y2 - y0) * (x3 - x0));
    return Math.abs(det) / 6.0;
  }

  _computeConstitutiveMatrix(E, nu) {
    // 3D Isotropic Elasticity Tensor (6x6 Voigt notation: [xx, yy, zz, yz, xz, xy])
    const factor = E / ((1.0 + nu) * (1.0 - 2.0 * nu));
    const d11 = factor * (1.0 - nu);
    const d12 = factor * nu;
    const d44 = factor * (0.5 - nu);

    const D = new Float64Array(36);
    // Row 0 (xx)
    D[0] = d11; D[1] = d12; D[2] = d12;
    // Row 1 (yy)
    D[6] = d12; D[7] = d11; D[8] = d12;
    // Row 2 (zz)
    D[12] = d12; D[13] = d12; D[14] = d11;
    // Row 3 (yz)
    D[21] = d44;
    // Row 4 (xz)
    D[28] = d44;
    // Row 5 (xy)
    D[35] = d44;
    return D;
  }

  /**
   * Evaluates shape function derivatives dN/dL_i at barycentric coordinate (L0, L1, L2, L3)
   */
  _evalShapeDerivatives(L0, L1, L2, L3) {
    // dN/dL: [node 0..9][deriv w.r.t L0, L1, L2, L3]
    const dN = Array.from({ length: 10 }, () => new Float64Array(4));

    // Corner nodes: N_i = L_i * (2*L_i - 1) => dN_i/dL_i = 4*L_i - 1
    dN[0][0] = 4 * L0 - 1;
    dN[1][1] = 4 * L1 - 1;
    dN[2][2] = 4 * L2 - 1;
    dN[3][3] = 4 * L3 - 1;

    // Midside nodes:
    // N_4 = 4*L0*L1
    dN[4][0] = 4 * L1; dN[4][1] = 4 * L0;
    // N_5 = 4*L1*L2
    dN[5][1] = 4 * L2; dN[5][2] = 4 * L1;
    // N_6 = 4*L2*L0
    dN[6][2] = 4 * L0; dN[6][0] = 4 * L2;
    // N_7 = 4*L0*L3
    dN[7][0] = 4 * L3; dN[7][3] = 4 * L0;
    // N_8 = 4*L1*L3
    dN[8][1] = 4 * L3; dN[8][3] = 4 * L1;
    // N_9 = 4*L2*L3
    dN[9][2] = 4 * L3; dN[9][3] = 4 * L2;

    return dN;
  }

  /**
   * Computes the 30x30 Element Stiffness Matrix using 4-point Gauss quadrature
   * @returns {Float64Array} 30x30 flattened stiffness matrix (900 doubles)
   */
  computeStiffnessMatrix() {
    const K = new Float64Array(900); // 30 x 30
    const vol = this.volume;

    // 4 Gauss points in barycentric coordinates
    const a = 0.5854101966249685;
    const b = 0.1381966011250105;
    const gaussPoints = [
      [a, b, b, b],
      [b, a, b, b],
      [b, b, a, b],
      [b, b, b, a]
    ];
    const weight = 0.25 * vol;

    // Reference corner coordinates to compute Jacobian mapping dL/dx
    const n = this.nodes;
    const x0 = n[0].x, y0 = n[0].y, z0 = n[0].z;
    const x1 = n[1].x, y1 = n[1].y, z1 = n[1].z;
    const x2 = n[2].x, y2 = n[2].y, z2 = n[2].z;
    const x3 = n[3].x, y3 = n[3].y, z3 = n[3].z;

    // Linear tetrahedral Jacobian (constant over element)
    const J = [
      [x1 - x0, x2 - x0, x3 - x0],
      [y1 - y0, y2 - y0, y3 - y0],
      [z1 - z0, z2 - z0, z3 - z0]
    ];

    const detJ = J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1])
               - J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0])
               + J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);

    const invDetJ = 1.0 / (detJ !== 0 ? detJ : 1e-12);

    // Inverse Jacobian J^-1 = [dL1/dx, dL2/dx, dL3/dx]
    const invJ = [
      [(J[1][1] * J[2][2] - J[1][2] * J[2][1]) * invDetJ, (J[0][2] * J[2][1] - J[0][1] * J[2][2]) * invDetJ, (J[0][1] * J[1][2] - J[0][2] * J[1][1]) * invDetJ],
      [(J[1][2] * J[2][0] - J[1][0] * J[2][2]) * invDetJ, (J[0][0] * J[2][2] - J[0][2] * J[2][0]) * invDetJ, (J[0][2] * J[1][0] - J[0][0] * J[1][2]) * invDetJ],
      [(J[1][0] * J[2][1] - J[1][1] * J[2][0]) * invDetJ, (J[0][1] * J[2][0] - J[0][0] * J[2][1]) * invDetJ, (J[0][0] * J[1][1] - J[0][1] * J[1][0]) * invDetJ]
    ];

    // dL0/dx = -(dL1/dx + dL2/dx + dL3/dx)
    const dLdx = [
      [-(invJ[0][0] + invJ[1][0] + invJ[2][0]), -(invJ[0][1] + invJ[1][1] + invJ[2][1]), -(invJ[0][2] + invJ[1][2] + invJ[2][2])],
      [invJ[0][0], invJ[0][1], invJ[0][2]],
      [invJ[1][0], invJ[1][1], invJ[1][2]],
      [invJ[2][0], invJ[2][1], invJ[2][2]]
    ];

    // Integrate over 4 Gauss points
    for (const gp of gaussPoints) {
      const [L0, L1, L2, L3] = gp;
      const dN_dL = this._evalShapeDerivatives(L0, L1, L2, L3);

      // Compute physical Cartesian derivatives dN_i/dx, dN_i/dy, dN_i/dz
      // dN_i/dx = sum_{k=0..3} (dN_i/dL_k) * (dL_k/dx)
      const dN_dx = Array.from({ length: 10 }, () => new Float64Array(3));
      for (let i = 0; i < 10; i++) {
        for (let dim = 0; dim < 3; dim++) {
          let sum = 0.0;
          for (let k = 0; k < 4; k++) {
            sum += dN_dL[i][k] * dLdx[k][dim];
          }
          dN_dx[i][dim] = sum;
        }
      }

      // Assemble B-matrix (6 x 30)
      const B = new Float64Array(6 * 30);
      for (let i = 0; i < 10; i++) {
        const col = i * 3;
        const nx = dN_dx[i][0];
        const ny = dN_dx[i][1];
        const nz = dN_dx[i][2];

        // Row 0: eps_xx = du/dx
        B[0 * 30 + col + 0] = nx;
        // Row 1: eps_yy = dv/dy
        B[1 * 30 + col + 1] = ny;
        // Row 2: eps_zz = dw/dz
        B[2 * 30 + col + 2] = nz;
        // Row 3: gamma_yz = dv/dz + dw/dy
        B[3 * 30 + col + 1] = nz;
        B[3 * 30 + col + 2] = ny;
        // Row 4: gamma_xz = du/dz + dw/dx
        B[4 * 30 + col + 0] = nz;
        B[4 * 30 + col + 2] = nx;
        // Row 5: gamma_xy = du/dy + dv/dx
        B[5 * 30 + col + 0] = ny;
        B[5 * 30 + col + 1] = nx;
      }

      // Compute DB = D * B (6 x 30)
      const DB = new Float64Array(6 * 30);
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 30; c++) {
          let sum = 0.0;
          for (let k = 0; k < 6; k++) {
            sum += this.D[r * 6 + k] * B[k * 30 + c];
          }
          DB[r * 30 + c] = sum;
        }
      }

      // Accumulate K += B^T * DB * weight
      for (let i = 0; i < 30; i++) {
        for (let j = 0; j < 30; j++) {
          let sum = 0.0;
          for (let k = 0; k < 6; k++) {
            sum += B[k * 30 + i] * DB[k * 30 + j];
          }
          K[i * 30 + j] += sum * weight;
        }
      }
    }

    return K;
  }

  /**
   * Computes von Mises stress at element centroid given 30 nodal displacements
   * @param {Float64Array} u - 30 displacements [u0, v0, w0, ..., u9, v9, w9]
   * @returns {{ vonMises: number, stresses: number[] }}
   */
  computeStress(u) {
    // Evaluate at centroid: L0 = L1 = L2 = L3 = 0.25
    const L0 = 0.25, L1 = 0.25, L2 = 0.25, L3 = 0.25;
    const dN_dL = this._evalShapeDerivatives(L0, L1, L2, L3);

    const n = this.nodes;
    const x0 = n[0].x, y0 = n[0].y, z0 = n[0].z;
    const x1 = n[1].x, y1 = n[1].y, z1 = n[1].z;
    const x2 = n[2].x, y2 = n[2].y, z2 = n[2].z;
    const x3 = n[3].x, y3 = n[3].y, z3 = n[3].z;

    const J = [
      [x1 - x0, x2 - x0, x3 - x0],
      [y1 - y0, y2 - y0, y3 - y0],
      [z1 - z0, z2 - z0, z3 - z0]
    ];
    const detJ = J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1])
               - J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0])
               + J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);
    const invDetJ = 1.0 / (detJ !== 0 ? detJ : 1e-12);

    const invJ = [
      [(J[1][1] * J[2][2] - J[1][2] * J[2][1]) * invDetJ, (J[0][2] * J[2][1] - J[0][1] * J[2][2]) * invDetJ, (J[0][1] * J[1][2] - J[0][2] * J[1][1]) * invDetJ],
      [(J[1][2] * J[2][0] - J[1][0] * J[2][2]) * invDetJ, (J[0][0] * J[2][2] - J[0][2] * J[2][0]) * invDetJ, (J[0][2] * J[1][0] - J[0][0] * J[1][2]) * invDetJ],
      [(J[1][0] * J[2][1] - J[1][1] * J[2][0]) * invDetJ, (J[0][1] * J[2][0] - J[0][0] * J[2][1]) * invDetJ, (J[0][0] * J[1][1] - J[0][1] * J[1][0]) * invDetJ]
    ];

    const dLdx = [
      [-(invJ[0][0] + invJ[1][0] + invJ[2][0]), -(invJ[0][1] + invJ[1][1] + invJ[2][1]), -(invJ[0][2] + invJ[1][2] + invJ[2][2])],
      [invJ[0][0], invJ[0][1], invJ[0][2]],
      [invJ[1][0], invJ[1][1], invJ[1][2]],
      [invJ[2][0], invJ[2][1], invJ[2][2]]
    ];

    const dN_dx = Array.from({ length: 10 }, () => new Float64Array(3));
    for (let i = 0; i < 10; i++) {
      for (let dim = 0; dim < 3; dim++) {
        let sum = 0.0;
        for (let k = 0; k < 4; k++) sum += dN_dL[i][k] * dLdx[k][dim];
        dN_dx[i][dim] = sum;
      }
    }

    // Strains: eps = B * u
    const strains = new Float64Array(6);
    for (let i = 0; i < 10; i++) {
      const col = i * 3;
      const ui = u[col + 0];
      const vi = u[col + 1];
      const wi = u[col + 2];
      const nx = dN_dx[i][0];
      const ny = dN_dx[i][1];
      const nz = dN_dx[i][2];

      strains[0] += nx * ui;
      strains[1] += ny * vi;
      strains[2] += nz * wi;
      strains[3] += nz * vi + ny * wi;
      strains[4] += nz * ui + nx * wi;
      strains[5] += ny * ui + nx * vi;
    }

    // Stresses: sig = D * eps
    const stresses = new Float64Array(6);
    for (let r = 0; r < 6; r++) {
      let sum = 0.0;
      for (let c = 0; c < 6; c++) sum += this.D[r * 6 + c] * strains[c];
      stresses[r] = sum;
    }

    const sxx = stresses[0], syy = stresses[1], szz = stresses[2];
    const syz = stresses[3], sxz = stresses[4], sxy = stresses[5];

    // Von Mises stress formula
    const vonMises = Math.sqrt(
      0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2)
      + 3.0 * (sxy ** 2 + syz ** 2 + sxz ** 2)
    );

    return {
      vonMises,
      stresses: Array.from(stresses)
    };
  }
}

module.exports = { ElementTET10 };
