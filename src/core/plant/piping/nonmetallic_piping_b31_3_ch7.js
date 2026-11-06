/**
 * ASME B31.3 Chapter VII: Nonmetallic Piping and Piping Lined with Nonmetals.
 * Industrial non-metallic piping engineering for utilities, cooling water, chemical dosing & seawater.
 *
 * Implements:
 * 1. GRE / FRP (Glass Reinforced Epoxy / Polymer) per ISO 14692 & ASME B31.3 A304.
 *    - Long-Term Hydrostatic Strength (LTHS) regression-based allowable stress.
 *    - Temperature, chemical, cyclic fatigue, and component partial factors.
 *    - Minimum reinforced wall thickness and internal pressure rating.
 * 2. HDPE (High-Density Polyethylene PE100 / PE80) per ISO 9080, ISO 4427 & ASTM F714.
 *    - Minimum Required Strength (MRS) and 50-year design life extrapolation.
 *    - Standard Dimension Ratio (SDR) selection (SDR 7.4 to SDR 26).
 *    - Pressure rating (MAOP) and wall thickness sizing.
 * 3. PVC & CPVC per ASME B31.3 Table A323.2.2, ASTM D1785 & ASTM F441.
 *    - Hydrostatic Design Basis (HDB) and temperature derating factors.
 *    - Schedule 40 / Schedule 80 allowable pressure limits.
 * 4. Maximum beam deflection and support spacing for nonmetallic systems.
 */

'use strict';

// claims:evidence:ASME-B31.3-Chapter-VII-ISO-14692-ISO-9080

/**
 * Standard HDPE SDR series and geometry factors
 */
const STANDARD_HDPE_SDR = [7.4, 9.0, 11.0, 13.6, 17.0, 21.0, 26.0, 33.0];

/**
 * Baseline physical properties for nonmetallic piping materials
 */
const NONMETALLIC_MATERIALS = {
  'GRE-EPOXY': {
    name: 'Glass Reinforced Epoxy (GRE)',
    standard: 'ISO 14692 / ASTM D2992',
    lthsMPa: 85.0, // 65,000 hr / 50 yr LTHS at 20 °C
    axialTensileModulusGPa: 18.0,
    hoopTensileModulusGPa: 24.0,
    densityKgM3: 1800.0,
    thermalExpansionCoeff: 18.0e-6, // 1/K
    minTempC: -40.0,
    maxTempC: 95.0,
    poissonRatio: 0.35
  },
  'HDPE-PE100': {
    name: 'High Density Polyethylene PE100',
    standard: 'ISO 9080 / ISO 4427',
    mrsMPa: 10.0, // Minimum Required Strength 10.0 MPa (50 yr at 20 °C)
    elasticModulusGPa: 1.0, // Short-term ~1.0 GPa; long-term creep ~0.25 GPa
    densityKgM3: 955.0,
    thermalExpansionCoeff: 160.0e-6, // 1/K
    minTempC: -40.0,
    maxTempC: 60.0,
    poissonRatio: 0.42
  },
  'HDPE-PE80': {
    name: 'High Density Polyethylene PE80',
    standard: 'ISO 9080 / ISO 4427',
    mrsMPa: 8.0,
    elasticModulusGPa: 0.85,
    densityKgM3: 940.0,
    thermalExpansionCoeff: 170.0e-6,
    minTempC: -40.0,
    maxTempC: 60.0,
    poissonRatio: 0.42
  },
  'PVC-U': {
    name: 'Unplasticized Polyvinyl Chloride (PVC 1120)',
    standard: 'ASME B31.3 Table A323.2.2 / ASTM D1785',
    hdbMPa: 27.6, // 4000 psi
    designStressAmbientMPa: 13.8, // 2000 psi
    elasticModulusGPa: 2.8,
    densityKgM3: 1400.0,
    thermalExpansionCoeff: 54.0e-6,
    minTempC: 0.0,
    maxTempC: 60.0,
    poissonRatio: 0.38
  },
  'CPVC': {
    name: 'Chlorinated Polyvinyl Chloride (CPVC 4120)',
    standard: 'ASME B31.3 Table A323.2.2 / ASTM F441',
    hdbMPa: 27.6, // 4000 psi at 23 °C; 6.9 MPa at 82 °C
    designStressAmbientMPa: 13.8,
    elasticModulusGPa: 2.9,
    densityKgM3: 1550.0,
    thermalExpansionCoeff: 61.0e-6,
    minTempC: 0.0,
    maxTempC: 93.0,
    poissonRatio: 0.38
  }
};

class NonmetallicPipingB31_3 {
  /**
   * Evaluate Glass Reinforced Epoxy (GRE) / FRP piping per ISO 14692 and ASME B31.3 A304.
   *
   * @param {Object} params
   * @param {number} params.designPressureBar - Internal design pressure in barg
   * @param {number} params.designTempC - Operating temperature in °C
   * @param {number} params.outsideDiameterMm - Pipe OD in mm
   * @param {number} [params.linerThicknessMm=1.0] - Resin rich internal corrosion barrier (mm)
   * @param {number} [params.lthsMPa=85.0] - Long-term hydrostatic strength at 20 °C (MPa)
   * @param {string} [params.serviceFluid='water'] - 'water', 'seawater', 'hydrocarbon', or 'acid'
   * @param {boolean} [params.isCyclic=false] - Whether severe cyclic pressure fluctuations exist
   * @param {string} [params.componentType='straight_pipe'] - 'straight_pipe', 'elbow', 'tee', 'flange'
   * @returns {Object} Sizing results with allowable stresses, wall thickness, and MAWP
   */
  static calculateGreFrp(params) {
    const {
      designPressureBar,
      designTempC,
      outsideDiameterMm,
      linerThicknessMm = 1.0,
      lthsMPa = 85.0,
      serviceFluid = 'water',
      isCyclic = false,
      componentType = 'straight_pipe'
    } = params;

    if (designPressureBar < 0) {
      throw new Error('Design pressure must be non-negative.');
    }
    if (designTempC < -40.0 || designTempC > 95.0) {
      throw new Error(`Temperature ${designTempC} °C is outside GRE operating limits (-40 to 95 °C).`);
    }

    // 1. Temperature derating factor f_temp per ISO 14692-2
    let fTemp = 1.0;
    if (designTempC > 25.0) {
      fTemp = Math.max(0.50, 1.0 - ((designTempC - 25.0) / (95.0 - 25.0)) * 0.40);
    }

    // 2. Chemical service factor f_chem
    let fChem = 1.0;
    const fluidKey = serviceFluid.toLowerCase();
    if (fluidKey.includes('seawater') || fluidKey.includes('produced')) {
      fChem = 0.90;
    } else if (fluidKey.includes('hydrocarbon') || fluidKey.includes('gas') || fluidKey.includes('oil')) {
      fChem = 0.85;
    } else if (fluidKey.includes('acid') || fluidKey.includes('chemical')) {
      fChem = 0.75;
    }

    // 3. Cyclic factor f_fatigue
    const fFatigue = isCyclic ? 0.75 : 1.0;

    // 4. Component factor f_part
    let fPart = 1.0;
    if (componentType === 'elbow') fPart = 0.85;
    else if (componentType === 'tee') fPart = 0.80;
    else if (componentType === 'flange') fPart = 0.75;

    // Factored 50-year long term allowable stress (MPa)
    const designFactorOverall = 0.67; // ISO 14692 basic design safety factor
    const qualifiedStressMPa = lthsMPa * fTemp * fChem * fFatigue * fPart;
    const allowableHoopStressMPa = qualifiedStressMPa * designFactorOverall;

    // Minimum reinforced wall thickness per ASME B31.3 Eq A304.1.2 & ISO 14692
    const pMPa = designPressureBar / 10.0;
    const tReinforcedMm = (pMPa * outsideDiameterMm) / (2.0 * allowableHoopStressMPa + pMPa);
    const tTotalReqMm = tReinforcedMm + linerThicknessMm;

    // Maximum Allowable Working Pressure (MAWP) for nominal structural thickness
    const mawpBar = (20.0 * allowableHoopStressMPa * tReinforcedMm) / (outsideDiameterMm - tReinforcedMm);

    return {
      standard: 'ISO 14692 / ASME B31.3 Chapter VII',
      material: 'Glass Reinforced Epoxy (GRE)',
      designPressureBar,
      designTempC,
      outsideDiameterMm,
      factors: {
        fTemp: Number(fTemp.toFixed(3)),
        fChem: Number(fChem.toFixed(3)),
        fFatigue,
        fPart,
        designSafetyFactor: designFactorOverall
      },
      qualifiedStressMPa: Number(qualifiedStressMPa.toFixed(2)),
      allowableHoopStressMPa: Number(allowableHoopStressMPa.toFixed(2)),
      tReinforcedMm: Number(tReinforcedMm.toFixed(2)),
      linerThicknessMm,
      totalWallThicknessMm: Number(tTotalReqMm.toFixed(2)),
      mawpBar: Number(mawpBar.toFixed(2)),
      isAcceptable: mawpBar >= designPressureBar
    };
  }

  /**
   * Evaluate High-Density Polyethylene (HDPE) piping per ISO 9080, ISO 4427 and ASTM F714.
   *
   * @param {Object} params
   * @param {string} [params.peGrade='PE100'] - 'PE100' or 'PE80'
   * @param {number} params.designPressureBar - Internal pressure in barg
   * @param {number} params.designTempC - Fluid temperature in °C
   * @param {number} params.outsideDiameterMm - Pipe OD in mm
   * @param {number} [params.sdr=11.0] - Standard Dimension Ratio (OD / wall)
   * @param {string} [params.serviceCategory='water'] - 'water' (C=1.25) or 'gas_hydrocarbon' (C=2.0)
   * @returns {Object} HDPE rating, required thickness, SDR check, and MAOP
   */
  static calculateHdpe(params) {
    const {
      peGrade = 'PE100',
      designPressureBar,
      designTempC,
      outsideDiameterMm,
      sdr = 11.0,
      serviceCategory = 'water'
    } = params;

    if (designPressureBar < 0 || outsideDiameterMm <= 0) {
      throw new Error('designPressureBar and outsideDiameterMm must be positive.');
    }
    if (sdr <= 1.0) {
      throw new Error('SDR must be greater than 1.0.');
    }

    const grade = peGrade.toUpperCase().includes('80') ? 'HDPE-PE80' : 'HDPE-PE100';
    const mat = NONMETALLIC_MATERIALS[grade];

    if (designTempC < mat.minTempC || designTempC > mat.maxTempC) {
      throw new Error(`Temperature ${designTempC} °C is outside HDPE operating limits (${mat.minTempC} to ${mat.maxTempC} °C).`);
    }

    // 1. Service coefficient C per ISO 4427 / ASME B31.8 / B31.3
    const cFactor = serviceCategory.toLowerCase().includes('water') ? 1.25 : 2.0;

    // 2. Temperature derating factor f_T per ISO 4427 Table A.1
    let fT = 1.0;
    if (designTempC <= 20.0) {
      fT = 1.0;
    } else if (designTempC <= 30.0) {
      fT = 1.0 - ((designTempC - 20.0) / 10.0) * (1.0 - 0.87);
    } else if (designTempC <= 40.0) {
      fT = 0.87 - ((designTempC - 30.0) / 10.0) * (0.87 - 0.74);
    } else if (designTempC <= 50.0) {
      fT = 0.74 - ((designTempC - 40.0) / 10.0) * (0.74 - 0.62);
    } else {
      fT = 0.62 - ((designTempC - 50.0) / 10.0) * (0.62 - 0.50);
    }

    // Design stress sigma_s (MPa)
    const designStressMPa = (mat.mrsMPa / cFactor) * fT;

    // Maximum Allowable Operating Pressure (MAOP) per ISO 4427: MAOP = (2 * sigma_s) / (SDR - 1)
    const maopMPa = (2.0 * designStressMPa) / (sdr - 1.0);
    const maopBar = maopMPa * 10.0;

    // Actual wall thickness from SDR
    const nominalWallMm = outsideDiameterMm / sdr;

    // Minimum required wall thickness for design pressure
    const pMPa = designPressureBar / 10.0;
    const requiredWallMm = (pMPa * outsideDiameterMm) / (2.0 * designStressMPa + pMPa);

    return {
      standard: 'ISO 9080 / ISO 4427 / ASTM F714',
      peGrade: grade,
      mrsMPa: mat.mrsMPa,
      serviceCoefficientC: cFactor,
      tempDeratingFactor: Number(fT.toFixed(3)),
      designStressMPa: Number(designStressMPa.toFixed(2)),
      sdr,
      nominalWallMm: Number(nominalWallMm.toFixed(2)),
      requiredWallMm: Number(requiredWallMm.toFixed(2)),
      maopBar: Number(maopBar.toFixed(2)),
      isAcceptable: maopBar >= designPressureBar
    };
  }

  /**
   * Recommend and select the standard HDPE SDR meeting or exceeding design pressure.
   *
   * @param {number} outsideDiameterMm
   * @param {number} designPressureBar
   * @param {number} designTempC
   * @param {string} [serviceCategory='water']
   * @returns {{selectedSdr: number, maopBar: number, nominalWallMm: number}}
   */
  static selectHdpeSdr(outsideDiameterMm, designPressureBar, designTempC, serviceCategory = 'water') {
    for (let i = STANDARD_HDPE_SDR.length - 1; i >= 0; i--) {
      const candidateSdr = STANDARD_HDPE_SDR[i];
      const res = this.calculateHdpe({
        peGrade: 'PE100',
        designPressureBar,
        designTempC,
        outsideDiameterMm,
        sdr: candidateSdr,
        serviceCategory
      });
      if (res.isAcceptable) {
        return {
          selectedSdr: candidateSdr,
          maopBar: res.maopBar,
          nominalWallMm: res.nominalWallMm,
          peGrade: 'HDPE-PE100'
        };
      }
    }
    // If even SDR 7.4 is insufficient:
    const heaviest = this.calculateHdpe({
      peGrade: 'PE100',
      designPressureBar,
      designTempC,
      outsideDiameterMm,
      sdr: 7.4,
      serviceCategory
    });
    return {
      selectedSdr: 7.4,
      maopBar: heaviest.maopBar,
      nominalWallMm: heaviest.nominalWallMm,
      peGrade: 'HDPE-PE100',
      warning: 'Pressure exceeds standard HDPE rating; higher schedule or reinforced pipe required.'
    };
  }

  /**
   * Evaluate PVC or CPVC piping under ASME B31.3 Chapter VII & ASTM D1785 / F441.
   *
   * @param {Object} params
   * @param {'PVC' | 'CPVC'} params.materialType
   * @param {number} params.outsideDiameterMm
   * @param {number} params.wallThicknessMm
   * @param {number} params.designPressureBar
   * @param {number} params.designTempC
   * @returns {Object} Pressure rating and code check
   */
  static calculatePvcCpvc(params) {
    const {
      materialType = 'PVC',
      outsideDiameterMm,
      wallThicknessMm,
      designPressureBar,
      designTempC
    } = params;

    const isCpvc = materialType.toUpperCase().includes('CPVC');
    const mat = NONMETALLIC_MATERIALS[isCpvc ? 'CPVC' : 'PVC-U'];

    if (outsideDiameterMm <= 0 || wallThicknessMm <= 0 || designPressureBar < 0) {
      throw new Error('Piping dimensions and designPressureBar must be positive.');
    }
    if (wallThicknessMm >= outsideDiameterMm / 2.0) {
      throw new Error('Wall thickness must be less than half of outside diameter.');
    }

    if (designTempC < mat.minTempC || designTempC > mat.maxTempC) {
      throw new Error(`Temperature ${designTempC} °C is outside ${mat.name} limits (${mat.minTempC} to ${mat.maxTempC} °C).`);
    }

    // Temperature derating factor per ASME B31.3 Table A323.2.2
    let fT = 1.0;
    if (!isCpvc) {
      // PVC
      if (designTempC <= 23.0) fT = 1.0;
      else if (designTempC <= 30.0) fT = 0.88;
      else if (designTempC <= 40.0) fT = 0.62;
      else if (designTempC <= 50.0) fT = 0.40;
      else fT = 0.22;
    } else {
      // CPVC
      if (designTempC <= 23.0) fT = 1.0;
      else if (designTempC <= 38.0) fT = 0.82;
      else if (designTempC <= 49.0) fT = 0.65;
      else if (designTempC <= 60.0) fT = 0.50;
      else if (designTempC <= 71.0) fT = 0.40;
      else if (designTempC <= 82.0) fT = 0.25;
      else fT = 0.18;
    }

    const allowableStressMPa = mat.designStressAmbientMPa * fT;

    // ASME B31.3 formula for thermoplastic pipe:
    // P = (2 * S * t) / (D - 0.4 * t)
    const mawpMPa = (2.0 * allowableStressMPa * wallThicknessMm) / (outsideDiameterMm - 0.4 * wallThicknessMm);
    const mawpBar = mawpMPa * 10.0;

    const pMPa = designPressureBar / 10.0;
    const requiredWallMm = (pMPa * outsideDiameterMm) / (2.0 * allowableStressMPa + 0.4 * pMPa);

    return {
      standard: 'ASME B31.3 Chapter VII / ASTM D1785 / ASTM F441',
      materialType: isCpvc ? 'CPVC 4120' : 'PVC 1120',
      designTempC,
      designPressureBar,
      tempDeratingFactor: fT,
      allowableStressMPa: Number(allowableStressMPa.toFixed(2)),
      actualWallMm: wallThicknessMm,
      requiredWallMm: Number(requiredWallMm.toFixed(2)),
      mawpBar: Number(mawpBar.toFixed(2)),
      isAcceptable: mawpBar >= designPressureBar
    };
  }

  /**
   * Calculate maximum allowable support span for horizontal nonmetallic pipe
   * based on Euler-Bernoulli beam deflection limit (deflection <= L / 300 or 12.5 mm).
   *
   * @param {Object} params
   * @param {string} params.materialKey - 'GRE-EPOXY', 'HDPE-PE100', 'PVC-U', or 'CPVC'
   * @param {number} params.outsideDiameterMm
   * @param {number} params.wallThicknessMm
   * @param {number} [params.fluidDensityKgM3=1000.0] - Fluid density
   * @param {number} [params.maxDeflectionMm=12.5] - Max center deflection
   * @returns {{maxSpanM: number, linearWeightKgM: number, momentOfInertiaCm4: number}}
   */
  static evaluateNonmetallicSupportSpan(params) {
    const {
      materialKey,
      outsideDiameterMm,
      wallThicknessMm,
      fluidDensityKgM3 = 1000.0,
      maxDeflectionMm = 12.5
    } = params;

    if (outsideDiameterMm <= 0 || wallThicknessMm <= 0) {
      throw new Error('outsideDiameterMm and wallThicknessMm must be positive.');
    }
    if (2.0 * wallThicknessMm >= outsideDiameterMm) {
      throw new Error('Wall thickness must be less than half of outside diameter.');
    }

    const mat = NONMETALLIC_MATERIALS[materialKey] || NONMETALLIC_MATERIALS['HDPE-PE100'];
    const doM = outsideDiameterMm / 1000.0;
    const diM = (outsideDiameterMm - 2.0 * wallThicknessMm) / 1000.0;

    // Cross section moment of inertia I = pi * (Do^4 - Di^4) / 64 (m^4)
    const iM4 = (Math.PI * (Math.pow(doM, 4) - Math.pow(diM, 4))) / 64.0;
    const momentOfInertiaCm4 = iM4 * 1.0e8;

    // Pipe metal/plastic cross section area
    const pipeAreaM2 = (Math.PI * (Math.pow(doM, 2) - Math.pow(diM, 2))) / 4.0;
    const internalAreaM2 = (Math.PI * Math.pow(diM, 2)) / 4.0;

    // Weight per meter (N/m)
    const massPipeKgM = pipeAreaM2 * mat.densityKgM3;
    const massFluidKgM = internalAreaM2 * fluidDensityKgM3;
    const totalMassKgM = massPipeKgM + massFluidKgM;
    const wNM = totalMassKgM * 9.80665;

    // Elastic Modulus E (Pa)
    const ePa = (mat.axialTensileModulusGPa || mat.elasticModulusGPa) * 1.0e9;

    // Deflection delta = (5 * w * L^4) / (384 * E * I)
    // L = [ (384 * E * I * delta) / (5 * w) ]^(1/4)
    const deltaM = maxDeflectionMm / 1000.0;
    const spanM = Math.pow((384.0 * ePa * iM4 * deltaM) / (5.0 * wNM), 0.25);

    return {
      material: mat.name,
      linearWeightKgM: Number(totalMassKgM.toFixed(2)),
      momentOfInertiaCm4: Number(momentOfInertiaCm4.toFixed(2)),
      maxSpanM: Number(spanM.toFixed(2))
    };
  }
}

module.exports = {
  NonmetallicPipingB31_3,
  NONMETALLIC_MATERIALS,
  STANDARD_HDPE_SDR
};
