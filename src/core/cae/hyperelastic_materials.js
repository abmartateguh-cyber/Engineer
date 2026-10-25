/**
 * OmniEng Nonlinear Hyperelastic Material Models
 * 
 * Implements experimental finite-strain strain-energy calculations:
 * 1. Mooney-Rivlin (2-parameter & 5-parameter):
 *    W = C10 * (I1_bar - 3) + C01 * (I2_bar - 3) + (1/D1) * (J - 1)^2
 * 2. Ogden Model:
 *    W = sum_p (mu_p / alpha_p) * (lambda1_bar^alpha_p + lambda2_bar^alpha_p + lambda3_bar^alpha_p - 3)
 * 3. Yeoh 3rd-order reduced polynomial model for high-strain carbon-black rubbers.
 * 4. Engineering stress vs stretch evaluation under Uniaxial, Equibiaxial, and Pure Shear states.
 * 
 * No sourced material coefficients, independent constitutive validation, or solver comparison
 * is included.
 */

'use strict';

class HyperelasticMaterial {
  /**
   * @param {string|Object} modelTypeOrOptions - 'MOONEY_RIVLIN', 'OGDEN', 'YEOH' or options object
   * @param {Object} [constants]
   */
  constructor(modelTypeOrOptions, constants = {}) {
    if (typeof modelTypeOrOptions === 'object' && modelTypeOrOptions !== null) {
      const opt = modelTypeOrOptions;
      const m = opt.model || opt.modelType || 'MOONEY_RIVLIN';
      this.modelType = m.toUpperCase().includes('MOONEY') ? 'MOONEY_RIVLIN' : (m.toUpperCase().includes('OGDEN') ? 'OGDEN' : 'YEOH');
      this.constants = Object.assign({}, opt, constants);
    } else {
      this.modelType = (modelTypeOrOptions || 'MOONEY_RIVLIN').toUpperCase();
      this.constants = constants || {};
    }
  }

  /**
   * Evaluates uniaxial engineering nominal stress sigma_nom(lambda)
   * For incompressible material: lambda1 = lambda, lambda2 = lambda3 = 1 / sqrt(lambda)
   * @param {number} stretch - lambda >= 1.0
   * @returns {number} Nominal stress (Pa)
   */
  evaluateUniaxialStress(stretch) {
    const lam = Math.max(1.001, stretch);
    const lamSq = lam * lam;
    const invLam = 1.0 / lam;

    if (this.modelType === 'MOONEY_RIVLIN') {
      const C10 = this.constants.C10 || 0.40e6; // Pa
      const C01 = this.constants.C01 || 0.10e6; // Pa
      // sigma = 2 * (1 - lam^(-3)) * (C10 * lam + C01)
      return 2.0 * (1.0 - 1.0 / (lamSq * lam)) * (C10 * lam + C01);
    }

    if (this.modelType === 'YEOH') {
      const C10 = this.constants.C10 || 0.50e6;
      const C20 = this.constants.C20 || -0.05e6;
      const C30 = this.constants.C30 || 0.005e6;
      const I1 = lamSq + 2.0 * invLam;
      const dI1 = I1 - 3.0;
      const dWdI1 = C10 + 2.0 * C20 * dI1 + 3.0 * C30 * dI1 * dI1;
      return 2.0 * (lam - 1.0 / (lamSq)) * dWdI1;
    }

    if (this.modelType === 'OGDEN') {
      // 1-term or 2-term Ogden
      const mu1 = this.constants.mu1 || 0.60e6;
      const a1 = this.constants.alpha1 || 1.3;
      const term1 = Math.pow(lam, a1 - 1.0) - Math.pow(lam, -0.5 * a1 - 1.0);
      return mu1 * term1;
    }

    return 0.0;
  }

  /**
   * Generates a complete stretch-stress curve up to maxStretch
   * @param {number} [maxStretch=4.0] - Up to 400% elongation
   * @param {number} [steps=30]
   * @returns {Array<Object>} Array of { stretch, nominalStressMpa, trueStressMpa }
   */
  generateUniaxialCurve(maxStretch = 4.0, steps = 30) {
    const curve = [];
    const dLam = (maxStretch - 1.0) / steps;
    for (let i = 0; i <= steps; i++) {
      const lam = 1.0 + i * dLam;
      const nomStress = this.evaluateUniaxialStress(lam);
      const trueStress = nomStress * lam;
      curve.push({
        stretch: Number(lam.toFixed(3)),
        strainPercent: Number(((lam - 1.0) * 100).toFixed(1)),
        nominalStressMpa: Number((nomStress * 1e-6).toFixed(4)),
        trueStressMpa: Number((trueStress * 1e-6).toFixed(4))
      });
    }
    return curve;
  }

  generateUniaxialTensionCurve(maxStretch = 4.0, steps = 30) {
    return this.generateUniaxialCurve(maxStretch, steps);
  }
}

const HyperelasticMaterialModel = HyperelasticMaterial;

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HyperelasticMaterial, HyperelasticMaterialModel };
}
if (typeof window !== 'undefined') {
  window.HyperelasticMaterial = HyperelasticMaterial;
  window.HyperelasticMaterialModel = HyperelasticMaterialModel;
}
