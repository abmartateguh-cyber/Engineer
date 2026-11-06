/**
 * OmniEng Johnson-Cook Dynamic Fracture & High-Strain-Rate Failure Engine
 * Experimental Johnson-Cook-style calculations using caller-supplied constants.
 * No material database or validated vendor implementation is provided.
 */

class JohnsonCookFracture {
  static validateMaterial(material) {
    const fields = ['A', 'B', 'n', 'C', 'm', 'T_room', 'T_melt', 'eps0_dot', 'D1', 'D2', 'D3', 'D4', 'D5'];
    if (!material || typeof material !== 'object' || !fields.every((field) => Number.isFinite(material[field]))) {
      throw new TypeError('Provide all Johnson-Cook flow and fracture constants explicitly.');
    }
    if (material.T_room <= 0 || material.T_melt <= material.T_room || material.eps0_dot <= 0 || material.n < 0 || material.m < 0) {
      throw new RangeError('Require T_melt > T_room > 0 K, eps0_dot > 0, and non-negative hardening and thermal exponents.');
    }
    return material;
  }

  static computeFailureStrain(eta, strainRate, tempK, material) {
    const p = this.validateMaterial(material);
    if (![eta, strainRate, tempK].every(Number.isFinite) || strainRate <= 0 || tempK <= 0) {
      throw new TypeError('Provide finite triaxiality, positive strain rate, and temperature in kelvin.');
    }
    const epsDotStar = Math.max(1.0, strainRate / p.eps0_dot);
    const tStar = Math.max(0.0, Math.min(1.0, (tempK - p.T_room) / (p.T_melt - p.T_room)));
    const triaxTerm = p.D1 + p.D2 * Math.exp(p.D3 * eta);
    const rateTerm = 1.0 + p.D4 * Math.log(epsDotStar);
    const tempTerm = 1.0 + p.D5 * tStar;
    return Math.max(0.001, triaxTerm * rateTerm * tempTerm);
  }

  static computeDamageIncrement(dPlasticStrain, eta, strainRate, tempK, material) {
    if (!Number.isFinite(dPlasticStrain) || dPlasticStrain < 0) {
      throw new TypeError('Provide a finite non-negative plastic strain increment.');
    }
    const epsF = this.computeFailureStrain(eta, strainRate, tempK, material);
    return dPlasticStrain / Math.max(1e-4, epsF);
  }

  static isElementFailed(damage) {
    return damage >= 1.0;
  }

  /**
   * Evaluates the dynamic Johnson-Cook flow stress.
   * sigma = [A + B * eps_p^n] * [1 + C * ln(eps_dot*)] * [1 - (T*)^m]
   */
  static computeFlowStress(material, plasticStrain, strainRate, tempK) {
    const p = this.validateMaterial(material);
    if (![plasticStrain, strainRate, tempK].every(Number.isFinite) || plasticStrain < 0 || strainRate <= 0 || tempK <= 0) {
      throw new TypeError('Provide non-negative plastic strain, positive strain rate, and temperature in kelvin.');
    }

    const epsP = Math.max(0, plasticStrain);
    const epsDotStar = Math.max(1.0, strainRate / p.eps0_dot);

    // Homologous temperature T*
    let tStar = (tempK - p.T_room) / (p.T_melt - p.T_room);
    tStar = Math.max(0.0, Math.min(1.0, tStar));

    const strainTerm = p.A + p.B * Math.pow(epsP, p.n);
    const rateTerm = 1.0 + p.C * Math.log(epsDotStar);
    const tempTerm = 1.0 - Math.pow(tStar, p.m);

    return Math.max(0.0, strainTerm * rateTerm * tempTerm);
  }

  /**
   * Evaluates the equivalent plastic strain to fracture (eps_f).
   * eps_f = [D1 + D2 * exp(D3 * eta)] * [1 + D4 * ln(eps_dot*)] * [1 + D5 * T*]
   * where eta = sigma_m / sigma_vm is the stress triaxiality ratio.
   */
  static computeFractureStrain(material, stressTensor, strainRate, tempK) {
    const p = this.validateMaterial(material);
    if (
      !Array.isArray(stressTensor) || stressTensor.length !== 6 || !stressTensor.every(Number.isFinite) ||
      !Number.isFinite(strainRate) || strainRate <= 0 || !Number.isFinite(tempK) || tempK <= 0
    ) {
      throw new TypeError('Provide six stress components in MPa, positive strain rate, and temperature in kelvin.');
    }

    // Mean hydrostatic stress: sigma_m = (sxx + syy + szz) / 3
    const sigmaM = (stressTensor[0] + stressTensor[1] + stressTensor[2]) / 3.0;

    // von Mises stress
    const sxx = stressTensor[0] - sigmaM;
    const syy = stressTensor[1] - sigmaM;
    const szz = stressTensor[2] - sigmaM;
    const sxy = stressTensor[3];
    const syz = stressTensor[4];
    const szx = stressTensor[5];

    const J2 = 0.5 * (sxx * sxx + syy * syy + szz * szz) + (sxy * sxy + syz * syz + szx * szx);
    const sigmaVM = Math.sqrt(3.0 * Math.max(0, J2));

    // Stress triaxiality eta = sigma_m / sigma_vm
    let eta = 0.0;
    if (sigmaVM > 1e-6) {
      eta = sigmaM / sigmaVM;
    }
    // Clamp triaxiality to physical range [-2.0, 3.0]
    eta = Math.max(-2.0, Math.min(3.0, eta));

    const epsDotStar = Math.max(1.0, strainRate / p.eps0_dot);
    let tStar = (tempK - p.T_room) / (p.T_melt - p.T_room);
    tStar = Math.max(0.0, Math.min(1.0, tStar));

    const triaxTerm = p.D1 + p.D2 * Math.exp(p.D3 * eta);
    const rateTerm = 1.0 + p.D4 * Math.log(epsDotStar);
    const tempTerm = 1.0 + p.D5 * tStar;

    // 0.5% lower-bound safeguard on fracture strain: prevents zero/negative
    // predicted failure strain (and damage blow-up) under extreme triaxial
    // compression states. Numerical floor, not a material property.
    const epsF = Math.max(0.005, triaxTerm * rateTerm * tempTerm);
    return {
      fractureStrain: Number(epsF.toFixed(5)),
      triaxiality: Number(eta.toFixed(3)),
      meanStressMPa: Number(sigmaM.toFixed(1)),
      vonMisesMPa: Number(sigmaVM.toFixed(1))
    };
  }

  /**
   * Updates cumulative damage variable D = sum(Delta_eps_p / eps_f).
   * @param {number} currentDamage Cumulative damage (0.0 to 1.0+)
   * @param {number} deltaPlasticStrain Incremental plastic strain step
   * @param {number} fractureStrain Current failure strain threshold
   */
  static updateDamage(currentDamage, deltaPlasticStrain, fractureStrain) {
    const deltaD = deltaPlasticStrain / Math.max(1e-4, fractureStrain);
    const newDamage = currentDamage + deltaD;
    const isFractured = newDamage >= 1.0;

    return {
      damage: Number(newDamage.toFixed(5)),
      deltaDamage: Number(deltaD.toFixed(5)),
      isFractured,
      intactFraction: Number(Math.max(0, 1.0 - newDamage).toFixed(4))
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { JohnsonCookFracture };
}
