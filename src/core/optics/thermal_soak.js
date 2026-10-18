/**
 * OmniEng Optical Thermal Soak & Environmental Analysis Engine
 * Calculates temperature-dependent refractive index shifts (dn/dT), barometric air index,
 * thermo-mechanical glass expansion, and optomechanical housing athermalization.
 * 
 * 100% In-House Proprietary Implementation - Zero External Dependencies.
 */

// Schott Glass Thermal Constants [D0, D1, D2, E0, E1, lambda_tk (um), CTE (1e-6 / K)]
const SCHOTT_THERMAL_GLASS_CATALOG = {
  'N-BK7': {
    D0: 1.86e-6,
    D1: 1.31e-8,
    D2: -1.37e-11,
    E0: 4.34e-7,
    E1: 6.27e-10,
    lambdaTk: 0.170, // um
    cte: 7.1e-6      // 1/K
  },
  'N-SF11': {
    D0: 4.21e-6,
    D1: 1.54e-8,
    D2: -1.82e-11,
    E0: 9.85e-7,
    E1: 1.25e-9,
    lambdaTk: 0.215,
    cte: 8.6e-6
  },
  'N-LAK9': {
    D0: 2.45e-6,
    D1: 1.12e-8,
    D2: -1.15e-11,
    E0: 5.60e-7,
    E1: 7.10e-10,
    lambdaTk: 0.185,
    cte: 6.3e-6
  },
  'FUSED_SILICA': {
    D0: 10.0e-6,
    D1: 1.45e-8,
    D2: -5.0e-12,
    E0: 1.15e-6,
    E1: 1.05e-9,
    lambdaTk: 0.160,
    cte: 0.52e-6
  }
};

// Optomechanical Housing Materials CTE (1/K)
const HOUSING_CTE = {
  'ALUMINUM_6061': 23.1e-6,
  'STAINLESS_304': 16.0e-6,
  'TITANIUM_TI6AL4V': 8.6e-6,
  'INVAR_36': 1.2e-6
};

class OpticalThermalSoakEngine {
  /**
   * Evaluates air refractive index as a function of temperature (°C) and pressure (Pa)
   * via Edlén / Ciddor environmental equation.
   * @param {number} tempC Ambient temperature in degrees Celsius (reference 20°C)
   * @param {number} pressurePa Ambient barometric pressure in Pascals (reference 101325 Pa)
   * @param {number} wavelengthUm Wavelength in micrometers (default 0.55 um)
   * @returns {number} Refractive index of ambient air
   */
  static evaluateAirIndex(tempC = 20.0, pressurePa = 101325.0, wavelengthUm = 0.550) {
    const sigma2 = 1.0 / (wavelengthUm * wavelengthUm);
    // Standard air index at 15°C, 101325 Pa
    const nRefMinus1 = (8342.54 + 2406147.0 / (130.0 - sigma2) + 15998.0 / (38.9 - sigma2)) * 1e-8;
    const pRatio = pressurePa / 101325.0;
    const tFactor = 1.0 + 0.003661 * tempC;
    return 1.0 + (nRefMinus1 * pRatio) / tFactor;
  }

  /**
   * Computes Schott glass refractive index thermal delta dn(T, lambda)
   * @param {string} glassName Name of glass (e.g. 'N-BK7')
   * @param {number} nBase Base refractive index at reference temperature 20°C
   * @param {number} targetTempC Target temperature in Celsius
   * @param {number} wavelengthUm Wavelength in micrometers
   * @param {number} refTempC Reference temperature in Celsius (default 20°C)
   * @returns {number} Thermal index increment dn
   */
  static computeDn(glassName, nBase, targetTempC, wavelengthUm = 0.550, refTempC = 20.0) {
    const glass = SCHOTT_THERMAL_GLASS_CATALOG[glassName] || SCHOTT_THERMAL_GLASS_CATALOG['N-BK7'];
    const deltaT = targetTempC - refTempC;

    const D0 = glass.D0;
    const D1 = glass.D1;
    const D2 = glass.D2;
    const E0 = glass.E0;
    const E1 = glass.E1;
    const ltk2 = glass.lambdaTk * glass.lambdaTk;
    const l2 = wavelengthUm * wavelengthUm;

    const termD = D0 * deltaT + D1 * deltaT * deltaT + D2 * Math.pow(deltaT, 3);
    const termE = (E0 * deltaT + E1 * deltaT * deltaT) / (l2 - ltk2);

    const dnRelative = ((nBase * nBase - 1.0) / (2.0 * nBase)) * (termD + termE);
    return dnRelative;
  }

  /**
   * Evaluates full thermo-mechanical soak of an optical system across temperature range
   * @param {Object} lensSpec
   * @param {Array<Object>} lensSpec.elements Array of { radius1, radius2, thicknessMm, glass, airGapMm }
   * @param {string} [lensSpec.housingMaterial='ALUMINUM_6061']
   * @param {number} targetTempC
   * @param {number} [refTempC=20.0]
   * @param {number} [wavelengthUm=0.550]
   */
  static evaluateThermalSoak(lensSpec, targetTempC = 60.0, refTempC = 20.0, wavelengthUm = 0.550) {
    const deltaT = targetTempC - refTempC;
    const housingCte = HOUSING_CTE[lensSpec.housingMaterial || 'ALUMINUM_6061'] || HOUSING_CTE['ALUMINUM_6061'];
    const elements = lensSpec.elements || [];

    const soakedElements = [];
    let cumulativeHousingDriftMm = 0.0;
    let thermalPowerSumRef = 0.0;
    let thermalPowerSumSoaked = 0.0;

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const glass = SCHOTT_THERMAL_GLASS_CATALOG[el.glass] || SCHOTT_THERMAL_GLASS_CATALOG['N-BK7'];
      const glassCte = glass.cte;

      // 1. Thermal expansion of glass radii and thickness
      const r1_0 = el.radius1;
      const r2_0 = el.radius2;
      const t_0 = el.thicknessMm;
      const gap_0 = el.airGapMm || 0.0;

      const r1_soaked = r1_0 * (1.0 + glassCte * deltaT);
      const r2_soaked = r2_0 * (1.0 + glassCte * deltaT);
      const t_soaked = t_0 * (1.0 + glassCte * deltaT);

      // 2. Thermal index shift dn
      const n0 = el.refractiveIndex || 1.5168;
      const dn = this.computeDn(el.glass || 'N-BK7', n0, targetTempC, wavelengthUm, refTempC);
      const n_soaked = n0 + dn;

      // 3. Housing thermal expansion of air gap
      const gap_soaked = gap_0 * (1.0 + housingCte * deltaT);
      cumulativeHousingDriftMm += (gap_soaked - gap_0) + (t_soaked - t_0);

      // Optical thin-lens power estimate phi = (n - 1) * (1/R1 - 1/R2)
      const phi0 = (n0 - 1.0) * (1.0 / (r1_0 * 1e-3) - 1.0 / (r2_0 * 1e-3));
      const phiSoaked = (n_soaked - 1.0) * (1.0 / (r1_soaked * 1e-3) - 1.0 / (r2_soaked * 1e-3));
      thermalPowerSumRef += phi0;
      thermalPowerSumSoaked += phiSoaked;

      soakedElements.push({
        elementIndex: i,
        glass: el.glass,
        original: { r1: r1_0, r2: r2_0, thicknessMm: t_0, airGapMm: gap_0, index: n0 },
        soaked: {
          r1: Math.round(r1_soaked * 10000) / 10000,
          r2: Math.round(r2_soaked * 10000) / 10000,
          thicknessMm: Math.round(t_soaked * 10000) / 10000,
          airGapMm: Math.round(gap_soaked * 10000) / 10000,
          refractiveIndex: Math.round(n_soaked * 1000000) / 1000000,
          dn: Math.round(dn * 1e7) / 1e7
        }
      });
    }

    // Thermal focal length shift df/dT
    const f0Mm = thermalPowerSumRef !== 0 ? (1.0 / thermalPowerSumRef) * 1000.0 : 50.0;
    const fSoakedMm = thermalPowerSumSoaked !== 0 ? (1.0 / thermalPowerSumSoaked) * 1000.0 : 50.0;
    const dfMm = fSoakedMm - f0Mm;
    const df_dT_um_per_K = deltaT !== 0 ? (dfMm * 1000.0) / deltaT : 0.0;

    // Thermal defocus distance relative to mechanical sensor plane
    const thermalDefocusMm = dfMm - cumulativeHousingDriftMm;

    return {
      targetTempC,
      refTempC,
      deltaTC: deltaT,
      housingMaterial: lensSpec.housingMaterial || 'ALUMINUM_6061',
      housingCte,
      ambientAirIndex: this.evaluateAirIndex(targetTempC),
      nominalFocalLengthMm: Math.round(f0Mm * 100) / 100,
      soakedFocalLengthMm: Math.round(fSoakedMm * 100) / 100,
      focalShiftMm: Math.round(dfMm * 10000) / 10000,
      df_dT_um_per_K: Math.round(df_dT_um_per_K * 100) / 100,
      thermalDefocusMm: Math.round(thermalDefocusMm * 10000) / 10000,
      athermalized: Math.abs(thermalDefocusMm) < 0.020, // Within 20 um depth of focus
      elements: soakedElements
    };
  }
}

module.exports = {
  SCHOTT_THERMAL_GLASS_CATALOG,
  HOUSING_CTE,
  OpticalThermalSoakEngine
};
