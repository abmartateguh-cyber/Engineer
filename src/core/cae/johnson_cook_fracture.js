/**
 * OmniEng Johnson-Cook Dynamic Fracture & High-Strain-Rate Failure Engine
 * Standard: Johnson-Cook Failure Model (1985)
 * Experimental implementation: LS-DYNA MAT_015 / Ansys Explicit AUTODYN dynamic impact failure.
 */

class JohnsonCookFracture {
  /**
   * Pre-configured Johnson-Cook material constants (A, B, n, C, m, D1-D5).
   */
  static JC_MATERIALS = {
    'Aluminum_7075_T6': {
      A: 546.0,      // Quasi-static yield stress (MPa)
      B: 477.0,      // Hardening modulus (MPa)
      n: 0.52,       // Hardening exponent
      C: 0.001,      // Strain rate sensitivity
      m: 1.4,        // Thermal softening exponent
      T_room: 293.15,// K (20°C)
      T_melt: 893.15,// K (620°C)
      eps0_dot: 1.0, // Reference strain rate (1/s)
      D1: 0.096,     // Triaxiality base
      D2: 0.049,     // Triaxiality exponent multiplier
      D3: -3.46,     // Triaxiality decay slope
      D4: 0.016,     // Strain rate sensitivity for fracture
      D5: 1.09       // Thermal coefficient for fracture
    },
    'Al7075-T6': {
      A: 546.0,
      B: 477.0,
      n: 0.52,
      C: 0.001,
      m: 1.4,
      T_room: 293.15,
      T_melt: 893.15,
      eps0_dot: 1.0,
      D1: 0.096,
      D2: 0.049,
      D3: -3.46,
      D4: 0.016,
      D5: 1.09
    },
    'Titanium_Ti6Al4V': {
      A: 862.0,
      B: 331.0,
      n: 0.34,
      C: 0.012,
      m: 0.8,
      T_room: 293.15,
      T_melt: 1923.15,
      eps0_dot: 1.0,
      D1: -0.09,
      D2: 0.25,
      D3: -0.5,
      D4: 0.014,
      D5: 3.87
    },
    'OFHC_Copper': {
      A: 90.0,
      B: 292.0,
      n: 0.31,
      C: 0.025,
      m: 1.09,
      T_room: 293.15,
      T_melt: 1356.15,
      eps0_dot: 1.0,
      D1: 0.54,
      D2: 4.89,
      D3: -3.03,
      D4: 0.014,
      D5: 1.12
    }
  };

  static PARAMETERS = JohnsonCookFracture.JC_MATERIALS;

  static computeFailureStrain(eta, strainRate = 1.0, tempK = 293.15, materialKey = 'Al7075-T6') {
    const p = this.JC_MATERIALS[materialKey] || this.JC_MATERIALS['Al7075-T6'];
    const epsDotStar = Math.max(1.0, strainRate / p.eps0_dot);
    const tStar = Math.max(0.0, Math.min(1.0, (tempK - p.T_room) / (p.T_melt - p.T_room)));
    const triaxTerm = p.D1 + p.D2 * Math.exp(p.D3 * eta);
    const rateTerm = 1.0 + p.D4 * Math.log(epsDotStar);
    const tempTerm = 1.0 + p.D5 * tStar;
    return Math.max(0.001, triaxTerm * rateTerm * tempTerm);
  }

  static computeDamageIncrement(dPlasticStrain, eta, strainRate = 1.0, tempK = 293.15, materialKey = 'Al7075-T6') {
    const epsF = this.computeFailureStrain(eta, strainRate, tempK, materialKey);
    return dPlasticStrain / Math.max(1e-4, epsF);
  }

  static isElementFailed(damage) {
    return damage >= 1.0;
  }

  /**
   * Evaluates the dynamic Johnson-Cook flow stress.
   * sigma = [A + B * eps_p^n] * [1 + C * ln(eps_dot*)] * [1 - (T*)^m]
   */
  static computeFlowStress(materialKey, plasticStrain, strainRate = 1.0, tempK = 293.15) {
    const p = this.JC_MATERIALS[materialKey] || this.JC_MATERIALS['Aluminum_7075_T6'];

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
  static computeFractureStrain(materialKey, stressTensor, strainRate = 1.0, tempK = 293.15) {
    const p = this.JC_MATERIALS[materialKey] || this.JC_MATERIALS['Aluminum_7075_T6'];

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
