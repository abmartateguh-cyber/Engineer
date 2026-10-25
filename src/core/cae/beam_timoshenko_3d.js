/**
 * OmniEng 3D Timoshenko Beam Element with Shear Deformation & Buckling Analysis
 *
 * Experimental 3D beam-element and column-calculation example:
 * 1. Timoshenko first-order shear deformation theory: Phi_y, Phi_z shear flexibility parameters.
 * 2. 6 DOFs per node (12 DOFs per element): axial, biaxial bending, shear, torsion.
 * 3. Exact geometric stiffness matrix K_sigma for linear buckling eigenvalue analysis (Euler critical load).
 *
 * No independent structural validation or comparison to a production solver is established.
 */

'use strict';

class TimoshenkoBeam3D {
  /**
   * @param {number} id
   * @param {number[]} nodeIndices - [node1, node2]
   * @param {Object[]} nodeCoords - [{ x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z2 }]
   * @param {Object} section
   * @param {number} section.E - Young's modulus (Pa)
   * @param {number} section.nu - Poisson's ratio
   * @param {number} section.A - Cross-sectional area (m^2)
   * @param {number} section.Iy - Second moment of area around y-axis (m^4)
   * @param {number} section.Iz - Second moment of area around z-axis (m^4)
   * @param {number} section.J - Torsional constant (m^4)
   * @param {number} section.ky - Shear correction factor for y
   * @param {number} section.kz - Shear correction factor for z
   */
  constructor(id, nodeIndices, nodeCoords, section) {
    if (
      !Array.isArray(nodeIndices) ||
      nodeIndices.length !== 2 ||
      !nodeIndices.every(Number.isSafeInteger) ||
      !Array.isArray(nodeCoords) ||
      nodeCoords.length !== 2 ||
      !nodeCoords.every(
        (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
      )
    ) {
      throw new TypeError('Beam input requires two node indices and two finite 3D coordinates.');
    }

    const requiredSectionFields = ['E', 'nu', 'A', 'Iy', 'Iz', 'J', 'ky', 'kz'];
    if (
      !section ||
      typeof section !== 'object' ||
      requiredSectionFields.some((field) => !Number.isFinite(section[field]))
    ) {
      throw new TypeError(`Beam section requires finite explicit values for ${requiredSectionFields.join(', ')}.`);
    }
    if (
      section.E <= 0 ||
      section.nu <= -1 ||
      section.nu >= 0.5 ||
      section.A <= 0 ||
      section.Iy <= 0 ||
      section.Iz <= 0 ||
      section.J <= 0 ||
      section.ky <= 0 ||
      section.kz <= 0
    ) {
      throw new RangeError('Beam material and section properties must be physically admissible and positive.');
    }

    this.id = id;
    this.nodes = nodeIndices;
    this.p1 = nodeCoords[0];
    this.p2 = nodeCoords[1];

    this.E = section.E;
    this.nu = section.nu;
    this.G = this.E / (2.0 * (1.0 + this.nu));
    this.A = section.A;
    this.Iy = section.Iy;
    this.Iz = section.Iz;
    this.J = section.J;
    this.ky = section.ky;
    this.kz = section.kz;

    this.L = Math.hypot(this.p2.x - this.p1.x, this.p2.y - this.p1.y, this.p2.z - this.p1.z);
    if (this.L < 1e-6) throw new Error('Beam element length must be non-zero');
  }

  /**
   * Computes 12x12 local elastic stiffness matrix Ke
   * @returns {Float64Array}
   */
  computeLocalStiffnessMatrix() {
    const { E, G, A, Iy, Iz, J, L, ky, kz } = this;
    const Ke = new Float64Array(12 * 12);

    // Timoshenko shear flexibility parameters:
    // Phi_y = 12 * E * Iz / (ky * G * A * L^2)
    // Phi_z = 12 * E * Iy / (kz * G * A * L^2)
    const phiY = (12.0 * E * Iz) / (ky * G * A * L * L);
    const phiZ = (12.0 * E * Iy) / (kz * G * A * L * L);

    const cY = 1.0 + phiY;
    const cZ = 1.0 + phiZ;

    // Axial terms
    const kAxial = (E * A) / L;
    Ke[0 * 12 + 0] = kAxial;
    Ke[0 * 12 + 6] = -kAxial;
    Ke[6 * 12 + 0] = -kAxial;
    Ke[6 * 12 + 6] = kAxial;

    // Torsion terms
    const kTorsion = (G * J) / L;
    Ke[3 * 12 + 3] = kTorsion;
    Ke[3 * 12 + 9] = -kTorsion;
    Ke[9 * 12 + 3] = -kTorsion;
    Ke[9 * 12 + 9] = kTorsion;

    // Bending in XY plane (driven by Iz and phiY)
    const k1y = (12.0 * E * Iz) / (cY * L * L * L);
    const k2y = (6.0 * E * Iz) / (cY * L * L);
    const k3y = ((4.0 + phiY) * E * Iz) / (cY * L);
    const k4y = ((2.0 - phiY) * E * Iz) / (cY * L);

    Ke[1 * 12 + 1] = k1y;
    Ke[1 * 12 + 5] = k2y;
    Ke[1 * 12 + 7] = -k1y;
    Ke[1 * 12 + 11] = k2y;
    Ke[5 * 12 + 1] = k2y;
    Ke[5 * 12 + 5] = k3y;
    Ke[5 * 12 + 7] = -k2y;
    Ke[5 * 12 + 11] = k4y;
    Ke[7 * 12 + 1] = -k1y;
    Ke[7 * 12 + 5] = -k2y;
    Ke[7 * 12 + 7] = k1y;
    Ke[7 * 12 + 11] = -k2y;
    Ke[11 * 12 + 1] = k2y;
    Ke[11 * 12 + 5] = k4y;
    Ke[11 * 12 + 7] = -k2y;
    Ke[11 * 12 + 11] = k3y;

    // Bending in XZ plane (driven by Iy and phiZ)
    const k1z = (12.0 * E * Iy) / (cZ * L * L * L);
    const k2z = (6.0 * E * Iy) / (cZ * L * L);
    const k3z = ((4.0 + phiZ) * E * Iy) / (cZ * L);
    const k4z = ((2.0 - phiZ) * E * Iy) / (cZ * L);

    Ke[2 * 12 + 2] = k1z;
    Ke[2 * 12 + 4] = -k2z;
    Ke[2 * 12 + 8] = -k1z;
    Ke[2 * 12 + 10] = -k2z;
    Ke[4 * 12 + 2] = -k2z;
    Ke[4 * 12 + 4] = k3z;
    Ke[4 * 12 + 8] = k2z;
    Ke[4 * 12 + 10] = k4z;
    Ke[8 * 12 + 2] = -k1z;
    Ke[8 * 12 + 4] = k2z;
    Ke[8 * 12 + 8] = k1z;
    Ke[8 * 12 + 10] = k2z;
    Ke[10 * 12 + 2] = -k2z;
    Ke[10 * 12 + 4] = k4z;
    Ke[10 * 12 + 8] = k2z;
    Ke[10 * 12 + 10] = k3z;

    return Ke;
  }

  /**
   * Computes 12x12 geometric stiffness matrix K_sigma under axial load P (tensile > 0, compressive < 0)
   * @param {number} P - Axial force (N)
   * @returns {Float64Array}
   */
  computeGeometricStiffnessMatrix(P) {
    if (!Number.isFinite(P)) {
      throw new TypeError('An explicit finite axial load P in newtons is required.');
    }
    const { L } = this;
    const Kg = new Float64Array(12 * 12);
    const factor = P / (30.0 * L);

    // Lateral displacements v and w geometric stiffness
    Kg[1 * 12 + 1] = 36 * factor;
    Kg[1 * 12 + 5] = 3 * L * factor;
    Kg[1 * 12 + 7] = -36 * factor;
    Kg[1 * 12 + 11] = 3 * L * factor;
    Kg[5 * 12 + 1] = 3 * L * factor;
    Kg[5 * 12 + 5] = 4 * L * L * factor;
    Kg[5 * 12 + 7] = -3 * L * factor;
    Kg[5 * 12 + 11] = -L * L * factor;
    Kg[7 * 12 + 1] = -36 * factor;
    Kg[7 * 12 + 5] = -3 * L * factor;
    Kg[7 * 12 + 7] = 36 * factor;
    Kg[7 * 12 + 11] = -3 * L * factor;
    Kg[11 * 12 + 1] = 3 * L * factor;
    Kg[11 * 12 + 5] = -L * L * factor;
    Kg[11 * 12 + 7] = -3 * L * factor;
    Kg[11 * 12 + 11] = 4 * L * L * factor;

    // Transverse z geometric stiffness
    Kg[2 * 12 + 2] = 36 * factor;
    Kg[2 * 12 + 4] = -3 * L * factor;
    Kg[2 * 12 + 8] = -36 * factor;
    Kg[2 * 12 + 10] = -3 * L * factor;
    Kg[4 * 12 + 2] = -3 * L * factor;
    Kg[4 * 12 + 4] = 4 * L * L * factor;
    Kg[4 * 12 + 8] = 3 * L * factor;
    Kg[4 * 12 + 10] = -L * L * factor;
    Kg[8 * 12 + 2] = -36 * factor;
    Kg[8 * 12 + 4] = 3 * L * factor;
    Kg[8 * 12 + 8] = 36 * factor;
    Kg[8 * 12 + 10] = 3 * L * factor;
    Kg[10 * 12 + 2] = -3 * L * factor;
    Kg[10 * 12 + 4] = -L * L * factor;
    Kg[10 * 12 + 8] = 3 * L * factor;
    Kg[10 * 12 + 10] = 4 * L * L * factor;

    return Kg;
  }

  /**
   * Calculates analytical Euler critical buckling load P_cr = (pi^2 * E * I) / (K * L)^2
   * @param {number} effectiveLengthFactorK - 1.0 pinned-pinned, 0.5 fixed-fixed, 0.7 fixed-pinned, 2.0 cantilever
   * @returns {{PcrY: number, PcrZ: number, criticalPcr: number}}
   */
  calculateEulerBucklingLoad(effectiveLengthFactorK) {
    if (!Number.isFinite(effectiveLengthFactorK) || effectiveLengthFactorK <= 0) {
      throw new TypeError('An explicit positive finite effective-length factor K is required.');
    }
    const Leff = effectiveLengthFactorK * this.L;
    const PcrY = (Math.PI * Math.PI * this.E * this.Iy) / (Leff * Leff);
    const PcrZ = (Math.PI * Math.PI * this.E * this.Iz) / (Leff * Leff);
    return {
      PcrY,
      PcrZ,
      criticalPcr: Math.min(PcrY, PcrZ)
    };
  }
}

module.exports = {
  TimoshenkoBeam3D
};
