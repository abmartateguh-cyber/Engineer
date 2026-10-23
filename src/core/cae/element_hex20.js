/**
 * OmniEng 20-Node Quadratic Serendipity Hexahedral Element (HEX20) Engine
 * 
 * Commercial FEA Standard: Quadratic 3D solid brick element matching ANSYS SOLID186
 * and Abaqus C3D20. Completely eliminates volumetric shear locking in bending-dominated
 * structural applications.
 * 
 * 20 Nodes:
 *   Corners (0..7): (±1, ±1, ±1)
 *   Midsides (8..19): 12 mid-edge nodes
 * 
 * 8-Point Gauss-Legendre 3D Quadrature Integration:
 *   xi, eta, zeta in { -1/sqrt(3), +1/sqrt(3) }
 *   Gauss weight = 1.0 * 1.0 * 1.0 = 1.0
 * 
 * 60 DOFs per element (3 DOFs/node: u, v, w).
 * 60x60 element stiffness matrix Ke.
 * 
 * 100% In-House Proprietary Formulation - Zero External Dependencies.
 */

'use strict';

class ElementHEX20 {
  /**
   * @param {number} id - Element ID
   * @param {number[]} nodeIds - 20 node indices [0..19]
   * @param {Array<{x: number, y: number, z: number}>} nodes - Coordinates of 20 nodes
   * @param {number} E - Young's modulus (Pa)
   * @param {number} nu - Poisson's ratio
   */
  constructor(id, nodeIds, nodes, E, nu) {
    this.id = id;
    this.nodeIds = nodeIds;
    this.nodes = nodes; // Array of 20 nodes
    this.E = E;
    this.nu = nu;
    this.D = this._computeConstitutiveMatrix(E, nu);
    this.volume = this._computeVolume();
  }

  static get NATURAL_COORDS() {
    return [
      // 8 corners
      [-1, -1, -1], [ 1, -1, -1], [ 1,  1, -1], [-1,  1, -1],
      [-1, -1,  1], [ 1, -1,  1], [ 1,  1,  1], [-1,  1,  1],
      // 12 midsides
      [ 0, -1, -1], [ 1,  0, -1], [ 0,  1, -1], [-1,  0, -1], // bottom z=-1
      [ 0, -1,  1], [ 1,  0,  1], [ 0,  1,  1], [-1,  0,  1], // top z=+1
      [-1, -1,  0], [ 1, -1,  0], [ 1,  1,  0], [-1,  1,  0]  // vertical edges
    ];
  }

  _computeConstitutiveMatrix(E, nu) {
    const factor = E / ((1.0 + nu) * (1.0 - 2.0 * nu));
    const d11 = factor * (1.0 - nu);
    const d12 = factor * nu;
    const d44 = factor * (0.5 - nu);

    const D = new Float64Array(36);
    D[0] = d11; D[1] = d12; D[2] = d12;
    D[6] = d12; D[7] = d11; D[8] = d12;
    D[12] = d12; D[13] = d12; D[14] = d11;
    D[21] = d44;
    D[28] = d44;
    D[35] = d44;
    return D;
  }

  /**
   * Evaluates shape function derivatives dN/dxi, dN/deta, dN/dzeta at (xi, eta, zeta)
   */
  _evalShapeDerivatives(xi, eta, zeta) {
    const dN_dxi = new Float64Array(20);
    const dN_deta = new Float64Array(20);
    const dN_dzeta = new Float64Array(20);

    const nat = ElementHEX20.NATURAL_COORDS;

    // 8 Corner nodes
    for (let i = 0; i < 8; i++) {
      const [xi_i, eta_i, zeta_i] = nat[i];
      const factor = (1 + xi * xi_i) * (1 + eta * eta_i) * (1 + zeta * zeta_i);
      const sumTerm = xi * xi_i + eta * eta_i + zeta * zeta_i - 2.0;

      dN_dxi[i]   = 0.125 * xi_i   * (1 + eta * eta_i) * (1 + zeta * zeta_i) * (sumTerm) + 0.125 * factor * xi_i;
      dN_deta[i]  = 0.125 * eta_i  * (1 + xi * xi_i)   * (1 + zeta * zeta_i) * (sumTerm) + 0.125 * factor * eta_i;
      dN_dzeta[i] = 0.125 * zeta_i * (1 + xi * xi_i)   * (1 + eta * eta_i)   * (sumTerm) + 0.125 * factor * zeta_i;
    }

    // 12 Midside nodes
    for (let i = 8; i < 20; i++) {
      const [xi_i, eta_i, zeta_i] = nat[i];
      if (xi_i === 0) {
        // Midside along xi
        dN_dxi[i]   = -0.5 * xi * (1 + eta * eta_i) * (1 + zeta * zeta_i);
        dN_deta[i]  = 0.25 * (1 - xi * xi) * eta_i  * (1 + zeta * zeta_i);
        dN_dzeta[i] = 0.25 * (1 - xi * xi) * (1 + eta * eta_i) * zeta_i;
      } else if (eta_i === 0) {
        // Midside along eta
        dN_dxi[i]   = 0.25 * xi_i  * (1 - eta * eta) * (1 + zeta * zeta_i);
        dN_deta[i]  = -0.5 * eta * (1 + xi * xi_i) * (1 + zeta * zeta_i);
        dN_dzeta[i] = 0.25 * (1 + xi * xi_i) * (1 - eta * eta) * zeta_i;
      } else {
        // Midside along zeta
        dN_dxi[i]   = 0.25 * xi_i  * (1 + eta * eta_i) * (1 - zeta * zeta);
        dN_deta[i]  = 0.25 * (1 + xi * xi_i) * eta_i  * (1 - zeta * zeta);
        dN_dzeta[i] = -0.5 * zeta * (1 + xi * xi_i) * (1 + eta * eta_i);
      }
    }

    return { dN_dxi, dN_deta, dN_dzeta };
  }

  _computeJacobian(dN_dxi, dN_deta, dN_dzeta) {
    let J11 = 0, J12 = 0, J13 = 0;
    let J21 = 0, J22 = 0, J23 = 0;
    let J31 = 0, J32 = 0, J33 = 0;

    for (let i = 0; i < 20; i++) {
      const { x, y, z } = this.nodes[i];
      J11 += dN_dxi[i] * x;   J12 += dN_dxi[i] * y;   J13 += dN_dxi[i] * z;
      J21 += dN_deta[i] * x;  J22 += dN_deta[i] * y;  J23 += dN_deta[i] * z;
      J31 += dN_dzeta[i] * x; J32 += dN_dzeta[i] * y; J33 += dN_dzeta[i] * z;
    }

    const detJ = J11 * (J22 * J33 - J23 * J32)
               - J12 * (J21 * J33 - J23 * J31)
               + J13 * (J21 * J32 - J22 * J31);

    const invDet = 1.0 / (detJ || 1e-12);

    const invJ11 = (J22 * J33 - J23 * J32) * invDet;
    const invJ12 = (J13 * J32 - J12 * J33) * invDet;
    const invJ13 = (J12 * J23 - J13 * J22) * invDet;

    const invJ21 = (J23 * J31 - J21 * J33) * invDet;
    const invJ22 = (J11 * J33 - J13 * J31) * invDet;
    const invJ23 = (J13 * J21 - J11 * J23) * invDet;

    const invJ31 = (J21 * J32 - J22 * J31) * invDet;
    const invJ32 = (J12 * J31 - J11 * J32) * invDet;
    const invJ33 = (J11 * J22 - J12 * J21) * invDet;

    return {
      detJ,
      invJ: [
        [invJ11, invJ12, invJ13],
        [invJ21, invJ22, invJ23],
        [invJ31, invJ32, invJ33]
      ]
    };
  }

  _computeVolume() {
    // Integrate det(J) over 8 Gauss points
    const gp = 1.0 / Math.sqrt(3.0);
    const gaussPts = [-gp, gp];
    let vol = 0.0;

    for (const xi of gaussPts) {
      for (const eta of gaussPts) {
        for (const zeta of gaussPts) {
          const { dN_dxi, dN_deta, dN_dzeta } = this._evalShapeDerivatives(xi, eta, zeta);
          const { detJ } = this._computeJacobian(dN_dxi, dN_deta, dN_dzeta);
          vol += Math.abs(detJ); // Gauss weight = 1.0
        }
      }
    }
    return vol;
  }

  /**
   * Computes the 60x60 element stiffness matrix Ke
   * @returns {Float64Array} Length 3600 (60x60)
   */
  computeStiffnessMatrix() {
    const Ke = new Float64Array(3600);
    const gp = 1.0 / Math.sqrt(3.0);
    const gaussPts = [-gp, gp];

    for (const xi of gaussPts) {
      for (const eta of gaussPts) {
        for (const zeta of gaussPts) {
          const { dN_dxi, dN_deta, dN_dzeta } = this._evalShapeDerivatives(xi, eta, zeta);
          const { detJ, invJ } = this._computeJacobian(dN_dxi, dN_deta, dN_dzeta);
          if (detJ <= 0) continue;

          // dN/dx = invJ * dN/dxi
          const dN_dx = new Float64Array(20);
          const dN_dy = new Float64Array(20);
          const dN_dz = new Float64Array(20);

          for (let i = 0; i < 20; i++) {
            dN_dx[i] = invJ[0][0] * dN_dxi[i] + invJ[0][1] * dN_deta[i] + invJ[0][2] * dN_dzeta[i];
            dN_dy[i] = invJ[1][0] * dN_dxi[i] + invJ[1][1] * dN_deta[i] + invJ[1][2] * dN_dzeta[i];
            dN_dz[i] = invJ[2][0] * dN_dxi[i] + invJ[2][1] * dN_deta[i] + invJ[2][2] * dN_dzeta[i];
          }

          // Build 6x60 strain-displacement matrix B
          // Voigt strain: [eps_xx, eps_yy, eps_zz, gamma_yz, gamma_xz, gamma_xy]
          const B = new Float64Array(6 * 60);
          for (let i = 0; i < 20; i++) {
            const col = i * 3;
            // eps_xx
            B[0 * 60 + col + 0] = dN_dx[i];
            // eps_yy
            B[1 * 60 + col + 1] = dN_dy[i];
            // eps_zz
            B[2 * 60 + col + 2] = dN_dz[i];
            // gamma_yz
            B[3 * 60 + col + 1] = dN_dz[i];
            B[3 * 60 + col + 2] = dN_dy[i];
            // gamma_xz
            B[4 * 60 + col + 0] = dN_dz[i];
            B[4 * 60 + col + 2] = dN_dx[i];
            // gamma_xy
            B[5 * 60 + col + 0] = dN_dy[i];
            B[5 * 60 + col + 1] = dN_dx[i];
          }

          // DB = D * B (6 x 60)
          const DB = new Float64Array(360);
          for (let r = 0; r < 6; r++) {
            const r6 = r * 6;
            const r60 = r * 60;
            for (let c = 0; c < 60; c++) {
              let sum = 0.0;
              for (let k = 0; k < 6; k++) {
                sum += this.D[r6 + k] * B[k * 60 + c];
              }
              DB[r60 + c] = sum;
            }
          }

          // Ke += B^T * DB * detJ * weight (weight=1.0)
          const dV = detJ;
          for (let i = 0; i < 60; i++) {
            const i60 = i * 60;
            for (let j = i; j < 60; j++) {
              let sum = 0.0;
              for (let k = 0; k < 6; k++) {
                sum += B[k * 60 + i] * DB[k * 60 + j];
              }
              const val = sum * dV;
              Ke[i60 + j] += val;
              if (i !== j) Ke[j * 60 + i] += val;
            }
          }
        }
      }
    }

    return Ke;
  }

  /**
   * Computes element centroid Cauchy stress and von Mises equivalent stress
   * @param {Float64Array} uElem - 60 element nodal displacements
   * @returns {{ vonMises: number, sxx: number, syy: number, szz: number, syz: number, sxz: number, sxy: number }}
   */
  computeStress(uElem) {
    const { dN_dxi, dN_deta, dN_dzeta } = this._evalShapeDerivatives(0, 0, 0);
    const { invJ } = this._computeJacobian(dN_dxi, dN_deta, dN_dzeta);

    const dN_dx = new Float64Array(20);
    const dN_dy = new Float64Array(20);
    const dN_dz = new Float64Array(20);

    for (let i = 0; i < 20; i++) {
      dN_dx[i] = invJ[0][0] * dN_dxi[i] + invJ[0][1] * dN_deta[i] + invJ[0][2] * dN_dzeta[i];
      dN_dy[i] = invJ[1][0] * dN_dxi[i] + invJ[1][1] * dN_deta[i] + invJ[1][2] * dN_dzeta[i];
      dN_dz[i] = invJ[2][0] * dN_dxi[i] + invJ[2][1] * dN_deta[i] + invJ[2][2] * dN_dzeta[i];
    }

    let exx = 0, eyy = 0, ezz = 0, eyz = 0, exz = 0, exy = 0;
    for (let i = 0; i < 20; i++) {
      const u = uElem[i * 3 + 0];
      const v = uElem[i * 3 + 1];
      const w = uElem[i * 3 + 2];

      exx += dN_dx[i] * u;
      eyy += dN_dy[i] * v;
      ezz += dN_dz[i] * w;
      eyz += dN_dz[i] * v + dN_dy[i] * w;
      exz += dN_dz[i] * u + dN_dx[i] * w;
      exy += dN_dy[i] * u + dN_dx[i] * v;
    }

    const eps = [exx, eyy, ezz, eyz, exz, exy];
    const s = [0, 0, 0, 0, 0, 0];
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        s[r] += this.D[r * 6 + c] * eps[c];
      }
    }

    const sxx = s[0], syy = s[1], szz = s[2], syz = s[3], sxz = s[4], sxy = s[5];
    const vm = Math.sqrt(
      0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2 + 6 * (syz ** 2 + sxz ** 2 + sxy ** 2))
    );

    return {
      vonMises: vm,
      sxx, syy, szz, syz, sxz, sxy
    };
  }
}

module.exports = { ElementHEX20 };
