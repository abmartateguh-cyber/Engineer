/**
 * OmniEng J2 von Mises Non-Linear Plasticity Solver
 * Standard: 3D Radial Return Mapping Algorithm with Isotropic Hardening
 * Industrial Parity: Ansys Mechanical / Abaqus Standard & Explicit material constitutive models.
 */

class J2Plasticity {
  /**
   * Evaluates the non-linear elasto-plastic stress state using radial return mapping.
   * @param {Object} stressState Current stress and internal state:
   *   stress: [sxx, syy, szz, sxy, syz, szx] (MPa)
   *   equivPlasticStrain: cumulative plastic strain (dimensionless)
   *   plasticDissipation: dissipated plastic work (mJ/mm^3)
   * @param {number[]} deltaStrain Strain increment [exx, eyy, ezz, gxy, gyz, gzx]
   * @param {Object} materialProps Material properties:
   *   E: Young's Modulus (MPa)
   *   nu: Poisson's Ratio
   *   yieldStress0: Initial yield strength (MPa)
   *   hardeningModulus: Plastic hardening slope H = d(sigma_y)/d(eps_p) (MPa)
   */
  static integrateStress(stressState, deltaStrain, materialProps) {
    const { E, nu, yieldStress0, hardeningModulus = 0 } = materialProps;

    const G = E / (2.0 * (1.0 + nu)); // Shear modulus
    const K = E / (3.0 * (1.0 - 2.0 * nu)); // Bulk modulus
    const H = hardeningModulus;

    const sPrev = stressState.stress || [0, 0, 0, 0, 0, 0];
    const epPrev = stressState.equivPlasticStrain || 0.0;
    const wpPrev = stressState.plasticDissipation || 0.0;

    // 1. Hydrostatic pressure and deviatoric decomposition of previous stress
    const pPrev = (sPrev[0] + sPrev[1] + sPrev[2]) / 3.0;
    const devPrev = [
      sPrev[0] - pPrev,
      sPrev[1] - pPrev,
      sPrev[2] - pPrev,
      sPrev[3],
      sPrev[4],
      sPrev[5]
    ];

    // 2. Volumetric and deviatoric strain increments
    const deVol = deltaStrain[0] + deltaStrain[1] + deltaStrain[2];
    const deDev = [
      deltaStrain[0] - deVol / 3.0,
      deltaStrain[1] - deVol / 3.0,
      deltaStrain[2] - deVol / 3.0,
      deltaStrain[3] / 2.0, // Tensor shear components (1/2 engineering shear)
      deltaStrain[4] / 2.0,
      deltaStrain[5] / 2.0
    ];

    // 3. Elastic Trial Stress
    const pTrial = pPrev + K * deVol;
    const devTrial = [
      devPrev[0] + 2.0 * G * deDev[0],
      devPrev[1] + 2.0 * G * deDev[1],
      devPrev[2] + 2.0 * G * deDev[2],
      devPrev[3] + 2.0 * G * deDev[3],
      devPrev[4] + 2.0 * G * deDev[4],
      devPrev[5] + 2.0 * G * deDev[5]
    ];

    // Second invariant J2 of trial deviatoric stress
    const J2Trial = 0.5 * (devTrial[0] * devTrial[0] + devTrial[1] * devTrial[1] + devTrial[2] * devTrial[2]) +
                    (devTrial[3] * devTrial[3] + devTrial[4] * devTrial[4] + devTrial[5] * devTrial[5]);
    const vmTrial = Math.sqrt(3.0 * Math.max(0, J2Trial));

    // Current yield strength
    const currentYield = yieldStress0 + H * epPrev;
    const fTrial = vmTrial - currentYield;

    // 4. Elastic / Plastic Branch
    if (fTrial <= 0.0 || vmTrial < 1e-9) {
      // Purely elastic step
      return {
        stress: [
          devTrial[0] + pTrial,
          devTrial[1] + pTrial,
          devTrial[2] + pTrial,
          devTrial[3],
          devTrial[4],
          devTrial[5]
        ],
        vonMisesStress: vmTrial,
        equivPlasticStrain: epPrev,
        deltaPlasticStrain: 0.0,
        plasticDissipation: wpPrev,
        isYielded: false,
        yieldStress: currentYield
      };
    }

    // 5. Plastic Radial Return Mapping
    // Delta gamma = f_trial / (3G + H)
    const deltaGamma = fTrial / (3.0 * G + H);
    const epNext = epPrev + deltaGamma;
    const vmNext = currentYield + H * deltaGamma;

    // Scale deviatoric stress down to yield surface
    const scale = vmNext / vmTrial;
    const devNext = [
      devTrial[0] * scale,
      devTrial[1] * scale,
      devTrial[2] * scale,
      devTrial[3] * scale,
      devTrial[4] * scale,
      devTrial[5] * scale
    ];

    const sNext = [
      devNext[0] + pTrial,
      devNext[1] + pTrial,
      devNext[2] + pTrial,
      devNext[3],
      devNext[4],
      devNext[5]
    ];

    const deltaWp = 0.5 * (currentYield + vmNext) * deltaGamma;

    return {
      stress: sNext,
      vonMisesStress: vmNext,
      equivPlasticStrain: epNext,
      deltaPlasticStrain: deltaGamma,
      plasticDissipation: wpPrev + deltaWp,
      isYielded: true,
      yieldStress: vmNext
    };
  }

  /**
   * Pre-configured high-performance aerospace and consumer materials.
   */
  static MATERIALS = {
    'Al7075-T6': {
      yieldStressMPa: 503.0,
      hardeningModulusMPa: 1200.0,
      E_MPa: 71700.0,
      nu: 0.33
    },
    'Aluminum_7075_T6': {
      yieldStressMPa: 503.0,
      hardeningModulusMPa: 1200.0,
      E_MPa: 71700.0,
      nu: 0.33
    },
    'SS316L': {
      yieldStressMPa: 290.0,
      hardeningModulusMPa: 2100.0,
      E_MPa: 193000.0,
      nu: 0.28
    },
    'Ti-6Al-4V': {
      yieldStressMPa: 880.0,
      hardeningModulusMPa: 1800.0,
      E_MPa: 114000.0,
      nu: 0.34
    }
  };

  /**
   * Direct radial return mapping on a 3D stress vector.
   * @param {number[]} stress [sxx, syy, szz, sxy, syz, szx] in Pa or MPa
   * @param {number} ep Cumulative plastic strain
   * @param {string|Object} material Key or material props
   */
  static radialReturnMapping(stress, ep = 0.0, material = 'Al7075-T6') {
    const mat = (typeof material === 'string') ? (this.MATERIALS[material] || this.MATERIALS['Al7075-T6']) : material;
    const isPa = Math.max(...stress.map(Math.abs)) > 1e5;
    const s = isPa ? stress.map(v => v / 1e6) : [...stress]; // Convert to MPa

    const p = (s[0] + s[1] + s[2]) / 3.0;
    const dev = [s[0] - p, s[1] - p, s[2] - p, s[3], s[4], s[5]];
    const J2 = 0.5 * (dev[0]*dev[0] + dev[1]*dev[1] + dev[2]*dev[2]) + (dev[3]*dev[3] + dev[4]*dev[4] + dev[5]*dev[5]);
    const vmTrial = Math.sqrt(3.0 * Math.max(0, J2));

    const y0 = mat.yieldStressMPa || mat.yieldStress0 || 500.0;
    const H = mat.hardeningModulusMPa !== undefined ? mat.hardeningModulusMPa : (mat.hardeningModulus || 0.0);
    const E = mat.E_MPa || mat.E || 70000.0;
    const nu = mat.nu || 0.33;
    const G = E / (2.0 * (1.0 + nu));

    const currentYield = y0 + H * ep;
    const fTrial = vmTrial - currentYield;

    if (fTrial <= 0.0) {
      return {
        isPlastic: false,
        vonMisesStressMPa: Number(vmTrial.toFixed(2)),
        dPlasticStrain: 0.0,
        plasticStrain: ep,
        stressMPa: s
      };
    }

    const dGamma = fTrial / (3.0 * G + H);
    const vmNext = currentYield + H * dGamma;
    const scale = vmNext / vmTrial;
    const devNext = dev.map(v => v * scale);
    const sNext = [devNext[0] + p, devNext[1] + p, devNext[2] + p, devNext[3], devNext[4], devNext[5]];

    return {
      isPlastic: true,
      vonMisesStressMPa: Number(vmNext.toFixed(2)),
      dPlasticStrain: dGamma,
      plasticStrain: ep + dGamma,
      stressMPa: sNext
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { J2Plasticity };
}
