/**
 * OmniEng Nonlinear Hyperelastic Material Models
 *
 * Implements experimental finite-strain strain-energy calculations:
 * 1. Mooney-Rivlin (2-parameter & 5-parameter):
 *    W = C10 * (I1_bar - 3) + C01 * (I2_bar - 3) + (1/D1) * (J - 1)^2
 * 2. Ogden Model (N = 1..3 terms):
 *    W = sum_p (mu_p / alpha_p) * (lambda1_bar^alpha_p + lambda2_bar^alpha_p + lambda3_bar^alpha_p - 3)
 * 3. Yeoh 3rd-order reduced polynomial model for high-strain carbon-black rubbers.
 * 4. Engineering nominal stress vs stretch evaluation under Uniaxial, Equibiaxial, and Pure Shear states.
 *
 * All evaluations use the incompressible constraint (J = 1):
 *   uniaxial:    lambda1 = lambda, lambda2 = lambda3 = lambda^(-1/2)
 *   equibiaxial: lambda1 = lambda2 = lambda, lambda3 = lambda^(-2)
 *   pure shear:  lambda1 = lambda, lambda2 = 1, lambda3 = lambda^(-1)
 */

'use strict';

const MODES = {
  UNIAXIAL: 'uniaxial',
  EQUIBIAXIAL: 'equibiaxial',
  PURE_SHEAR: 'pureshear'
};

class HyperelasticMaterial {
  /**
   * @param {string|Object} modelTypeOrOptions - 'MOONEY_RIVLIN', 'OGDEN', 'YEOH' or options object
   * @param {Object} [constants]
   */
  constructor(modelTypeOrOptions, constants = {}) {
    if (typeof modelTypeOrOptions === 'object' && modelTypeOrOptions !== null) {
      const opt = modelTypeOrOptions;
      const m = opt.model || opt.modelType || 'MOONEY_RIVLIN';
      this.modelType = m.toUpperCase().includes('MOONEY')
        ? 'MOONEY_RIVLIN'
        : m.toUpperCase().includes('OGDEN')
          ? 'OGDEN'
          : 'YEOH';
      this.constants = Object.assign({}, opt, constants);
    } else {
      this.modelType = (modelTypeOrOptions || 'MOONEY_RIVLIN').toUpperCase();
      this.constants = constants || {};
    }
  }

  _normalizeMode(mode) {
    const m = String(mode || MODES.UNIAXIAL)
      .toLowerCase()
      .replace('_', '');
    if (m === 'equibiaxial') return MODES.EQUIBIAXIAL;
    if (m === 'pureshear' || m === 'pureshear') return MODES.PURE_SHEAR;
    return MODES.UNIAXIAL;
  }

  _principalStretches(mode, lam) {
    const m = this._normalizeMode(mode);
    if (m === MODES.EQUIBIAXIAL) {
      return [lam, lam, 1.0 / (lam * lam)];
    }
    if (m === MODES.PURE_SHEAR) {
      return [lam, 1.0, 1.0 / lam];
    }
    return [lam, 1.0 / Math.sqrt(lam), 1.0 / Math.sqrt(lam)];
  }

  _invariants(l1, l2, l3) {
    const I1 = l1 * l1 + l2 * l2 + l3 * l3;
    const I2 = l1 * l1 * l2 * l2 + l2 * l2 * l3 * l3 + l3 * l3 * l1 * l1;
    return { I1, I2 };
  }

  _collectOgdenTerms() {
    const terms = [];
    for (let i = 1; i <= 3; i++) {
      const mu = this.constants['mu' + i];
      const alpha = this.constants['alpha' + i];
      if (Number.isFinite(mu) && Number.isFinite(alpha)) {
        terms.push({ mu, alpha });
      }
    }
    return terms;
  }

  requireFiniteConstants(names) {
    const missing = names.filter((name) => !Number.isFinite(this.constants[name]));
    if (missing.length) {
      throw new TypeError(`Provide explicit finite hyperelastic constants: ${missing.join(', ')}.`);
    }
    return this.constants;
  }

  /**
   * Strain energy W (Pa) at an incompressible deformation state.
   * @param {number} stretch - lambda > 0
   * @param {string} [mode] - 'uniaxial' | 'equibiaxial' | 'pureshear'
   * @returns {number} W in Pa
   */
  strainEnergy(stretch, mode = MODES.UNIAXIAL) {
    const lam = Number(stretch);
    if (!Number.isFinite(lam) || lam <= 0) {
      throw new TypeError('stretch must be a positive finite number.');
    }
    const [l1, l2, l3] = this._principalStretches(mode, lam);
    const { I1, I2 } = this._invariants(l1, l2, l3);

    if (this.modelType === 'MOONEY_RIVLIN') {
      const { C10, C01 } = this.requireFiniteConstants(['C10', 'C01']);
      return C10 * (I1 - 3.0) + C01 * (I2 - 3.0);
    }

    if (this.modelType === 'YEOH') {
      const { C10, C20, C30 } = this.requireFiniteConstants(['C10', 'C20', 'C30']);
      const dI1 = I1 - 3.0;
      return C10 * dI1 + C20 * dI1 * dI1 + C30 * dI1 * dI1 * dI1;
    }

    if (this.modelType === 'OGDEN') {
      this.requireFiniteConstants(['mu1', 'alpha1']);
      let W = 0.0;
      for (const { mu, alpha } of this._collectOgdenTerms()) {
        W += (mu / alpha) * (Math.pow(l1, alpha) + Math.pow(l2, alpha) + Math.pow(l3, alpha) - 3.0);
      }
      return W;
    }

    return 0.0;
  }

  /**
   * Nominal (Piola) stress P11 (Pa) in the active stretch direction.
   * Closed-form derivative dW/d(lambda) for an incompressible state.
   * @param {number} stretch - lambda > 0
   * @param {string} [mode] - 'uniaxial' | 'equibiaxial' | 'pureshear'
   * @returns {number} Nominal stress (Pa)
   */
  nominalStress(stretch, mode = MODES.UNIAXIAL) {
    const lam = Number(stretch);
    if (!Number.isFinite(lam) || lam <= 0) {
      throw new TypeError('stretch must be a positive finite number.');
    }
    const m = this._normalizeMode(mode);

    if (this.modelType === 'MOONEY_RIVLIN') {
      const { C10, C01 } = this.requireFiniteConstants(['C10', 'C01']);
      if (m === MODES.EQUIBIAXIAL) {
        return C10 * (4.0 * lam - 4.0 / Math.pow(lam, 5)) + C01 * (4.0 * Math.pow(lam, 3) - 4.0 / Math.pow(lam, 3));
      }
      if (m === MODES.PURE_SHEAR) {
        return (C10 + C01) * (2.0 * lam - 2.0 / Math.pow(lam, 3));
      }
      return 2.0 * (1.0 - 1.0 / (lam * lam * lam)) * (C10 * lam + C01);
    }

    if (this.modelType === 'YEOH') {
      const { C10, C20, C30 } = this.requireFiniteConstants(['C10', 'C20', 'C30']);
      const [l1, l2, l3] = this._principalStretches(m, lam);
      const { I1 } = this._invariants(l1, l2, l3);
      const dI1 = I1 - 3.0;
      const dWdI1 = C10 + 2.0 * C20 * dI1 + 3.0 * C30 * dI1 * dI1;
      let dI1dLam;
      if (m === MODES.EQUIBIAXIAL) {
        dI1dLam = 4.0 * lam - 4.0 / Math.pow(lam, 5);
      } else if (m === MODES.PURE_SHEAR) {
        dI1dLam = 2.0 * lam - 2.0 / Math.pow(lam, 3);
      } else {
        dI1dLam = 2.0 * lam - 2.0 / (lam * lam);
      }
      return dWdI1 * dI1dLam;
    }

    if (this.modelType === 'OGDEN') {
      this.requireFiniteConstants(['mu1', 'alpha1']);
      let P = 0.0;
      for (const { mu, alpha } of this._collectOgdenTerms()) {
        if (m === MODES.EQUIBIAXIAL) {
          P += mu * (2.0 * Math.pow(lam, alpha - 1.0) - 2.0 * Math.pow(lam, -2.0 * alpha - 1.0));
        } else if (m === MODES.PURE_SHEAR) {
          P += mu * (Math.pow(lam, alpha - 1.0) - Math.pow(lam, -alpha - 1.0));
        } else {
          P += mu * (Math.pow(lam, alpha - 1.0) - Math.pow(lam, -0.5 * alpha - 1.0));
        }
      }
      return P;
    }

    return 0.0;
  }

  /**
   * Evaluates uniaxial engineering nominal stress sigma_nom(lambda)
   * @param {number} stretch - lambda > 0
   * @returns {number} Nominal stress (Pa)
   */
  evaluateUniaxialStress(stretch) {
    return this.nominalStress(stretch, MODES.UNIAXIAL);
  }

  /**
   * Infinitesimal shear modulus mu0 = dW/d(gamma^2)|0 (Pa).
   * Mooney-Rivlin: mu0 = 2*(C10 + C01); Yeoh: 2*C10; Ogden: 0.5*sum(mu_p*alpha_p).
   * @returns {number} shear modulus (Pa)
   */
  shearModulus() {
    if (this.modelType === 'MOONEY_RIVLIN') {
      const { C10, C01 } = this.requireFiniteConstants(['C10', 'C01']);
      return 2.0 * (C10 + C01);
    }
    if (this.modelType === 'YEOH') {
      const { C10 } = this.requireFiniteConstants(['C10', 'C20', 'C30']);
      return 2.0 * C10;
    }
    if (this.modelType === 'OGDEN') {
      this.requireFiniteConstants(['mu1', 'alpha1']);
      let mu0 = 0.0;
      for (const { mu, alpha } of this._collectOgdenTerms()) {
        mu0 += 0.5 * mu * alpha;
      }
      return mu0;
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
  module.exports = { HyperelasticMaterial, HyperelasticMaterialModel, MODES };
}
if (typeof window !== 'undefined') {
  window.HyperelasticMaterial = HyperelasticMaterial;
  window.HyperelasticMaterialModel = HyperelasticMaterialModel;
  window.HYPERELASTIC_MODES = MODES;
}
