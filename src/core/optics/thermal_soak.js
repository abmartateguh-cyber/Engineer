/**
 * OmniEng Optical Thermal Soak & Environmental Analysis Engine
 * Calculates temperature-dependent refractive index shifts (dn/dT), barometric air index,
 * thermo-mechanical glass expansion, and optomechanical housing athermalization.
 * 
 * Experimental implementation; release maturity and provenance are not established.
 */

// Compatibility exports remain empty until a source- and license-reviewed catalog is supplied.
const SCHOTT_THERMAL_GLASS_CATALOG = Object.freeze({});
const HOUSING_CTE = Object.freeze({});

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

  /** Computes thermal index change from an explicitly supplied coefficient record. */
  static computeDn(properties, nBase, targetTempC, wavelengthUm, refTempC) {
    const fields = ['D0PerK', 'D1PerK2', 'D2PerK3', 'E0Um2PerK', 'E1Um2PerK2', 'lambdaTkUm'];
    if (!properties || typeof properties !== 'object' || fields.some((field) => !Number.isFinite(properties[field]))) {
      throw new TypeError('Explicit finite thermal dispersion coefficients are required.');
    }
    if (typeof properties.source !== 'string' || !properties.source.trim()) {
      throw new TypeError('A nonempty source is required for thermal dispersion coefficients.');
    }
    if (![nBase, targetTempC, wavelengthUm, refTempC].every(Number.isFinite)
      || nBase <= 0 || wavelengthUm <= 0 || properties.lambdaTkUm <= 0) {
      throw new TypeError('Thermal index calculation requires finite positive index and wavelength inputs.');
    }
    const deltaT = targetTempC - refTempC;

    const D0 = properties.D0PerK;
    const D1 = properties.D1PerK2;
    const D2 = properties.D2PerK3;
    const E0 = properties.E0Um2PerK;
    const E1 = properties.E1Um2PerK2;
    const ltk2 = properties.lambdaTkUm * properties.lambdaTkUm;
    const l2 = wavelengthUm * wavelengthUm;
    if (Math.abs(l2 - ltk2) < 1e-15) throw new RangeError('Wavelength is singular for the supplied thermal dispersion record.');

    const termD = D0 * deltaT + D1 * deltaT * deltaT + D2 * Math.pow(deltaT, 3);
    const termE = (E0 * deltaT + E1 * deltaT * deltaT) / (l2 - ltk2);

    const dnRelative = ((nBase * nBase - 1.0) / (2.0 * nBase)) * (termD + termE);
    return dnRelative;
  }

  /**
   * Evaluates a thin-lens thermal estimate from caller-supplied material data.
   * No glass or housing catalog is selected by this method.
   */
  static evaluateThermalSoakFromProperties(lensSpec, targetTempC, refTempC, wavelengthUm, pressurePa) {
    const invalidInput = (message) => ({
      success: false,
      status: 'invalid-input',
      error: { code: 'INVALID_INPUT', message }
    });
    const finite = (value) => typeof value === 'number' && Number.isFinite(value);
    const thermalCoefficientNames = [
      'D0PerK', 'D1PerK2', 'D2PerK3', 'E0Um2PerK', 'E1Um2PerK2', 'lambdaTkUm',
      'glassCtePerK'
    ];

    if (!lensSpec || !Array.isArray(lensSpec.elements) || lensSpec.elements.length === 0) {
      return invalidInput('At least one explicitly defined optical element is required.');
    }
    if (!finite(lensSpec.housingCtePerK) || typeof lensSpec.housingCteSource !== 'string'
      || !lensSpec.housingCteSource.trim()) {
      return invalidInput('A finite housing CTE and its nonempty source are required.');
    }
    if (![targetTempC, refTempC].every((value) => finite(value) && value > -273.15)) {
      return invalidInput('Target and reference temperatures must be finite and above absolute zero.');
    }
    if (!finite(wavelengthUm) || wavelengthUm <= 0 || !finite(pressurePa) || pressurePa <= 0) {
      return invalidInput('Wavelength and ambient pressure must be finite and positive.');
    }
    for (const [index, element] of lensSpec.elements.entries()) {
      const properties = element?.thermalProperties;
      if (!element || !properties
        || ![
          element.radius1Mm,
          element.radius2Mm,
          element.thicknessMm,
          element.airGapMm,
          element.refractiveIndexAtReferenceTemperature,
          ...thermalCoefficientNames.map((name) => properties[name])
        ].every(finite)
        || element.radius1Mm === 0
        || element.radius2Mm === 0
        || element.thicknessMm <= 0
        || element.airGapMm < 0
        || element.refractiveIndexAtReferenceTemperature <= 0
        || properties.lambdaTkUm <= 0
        || typeof properties.source !== 'string'
        || !properties.source.trim()) {
        return invalidInput(`Optical element ${index} has invalid geometry, material properties, or provenance.`);
      }
      const wavelengthDelta = wavelengthUm * wavelengthUm - properties.lambdaTkUm * properties.lambdaTkUm;
      if (!Number.isFinite(wavelengthDelta) || Math.abs(wavelengthDelta) < 1e-15) {
        return invalidInput(`Optical element ${index} has a wavelength singularity in its thermal dispersion model.`);
      }
    }

    const deltaT = targetTempC - refTempC;
    let cumulativeHousingDriftMm = 0.0;
    let thermalPowerSumRef = 0.0;
    let thermalPowerSumSoaked = 0.0;
    const elements = [];

    for (let i = 0; i < lensSpec.elements.length; i++) {
      const element = lensSpec.elements[i];
      const properties = element.thermalProperties;
      const { D0PerK, D1PerK2, D2PerK3, E0Um2PerK, E1Um2PerK2, lambdaTkUm, glassCtePerK } = properties;
      const n0 = element.refractiveIndexAtReferenceTemperature;
      const termD = D0PerK * deltaT
        + D1PerK2 * deltaT * deltaT
        + D2PerK3 * deltaT * deltaT * deltaT;
      const wavelengthDelta = wavelengthUm * wavelengthUm - lambdaTkUm * lambdaTkUm;
      const termE = (E0Um2PerK * deltaT + E1Um2PerK2 * deltaT * deltaT) / wavelengthDelta;
      const dn = ((n0 * n0 - 1.0) / (2.0 * n0)) * (termD + termE);

      const radius1SoakedMm = element.radius1Mm * (1.0 + glassCtePerK * deltaT);
      const radius2SoakedMm = element.radius2Mm * (1.0 + glassCtePerK * deltaT);
      const thicknessSoakedMm = element.thicknessMm * (1.0 + glassCtePerK * deltaT);
      const airGapSoakedMm = element.airGapMm * (1.0 + lensSpec.housingCtePerK * deltaT);
      const indexSoaked = n0 + dn;

      if (![radius1SoakedMm, radius2SoakedMm, thicknessSoakedMm, airGapSoakedMm, indexSoaked].every(finite)
        || radius1SoakedMm === 0
        || radius2SoakedMm === 0
        || thicknessSoakedMm <= 0
        || airGapSoakedMm < 0
        || indexSoaked <= 0) {
        return {
          success: false,
          status: 'numerical-failure',
          error: { code: 'NUMERICAL_FAILURE', message: `Thermal expansion produced invalid optical element ${i}.` }
        };
      }

      cumulativeHousingDriftMm += airGapSoakedMm - element.airGapMm;
      cumulativeHousingDriftMm += thicknessSoakedMm - element.thicknessMm;

      const powerRef = (n0 - 1.0)
        * (1.0 / (element.radius1Mm * 1e-3) - 1.0 / (element.radius2Mm * 1e-3));
      const powerSoaked = (indexSoaked - 1.0)
        * (1.0 / (radius1SoakedMm * 1e-3) - 1.0 / (radius2SoakedMm * 1e-3));
      thermalPowerSumRef += powerRef;
      thermalPowerSumSoaked += powerSoaked;

      elements.push({
        elementIndex: i,
        propertiesSource: properties.source,
        original: {
          radius1Mm: element.radius1Mm,
          radius2Mm: element.radius2Mm,
          thicknessMm: element.thicknessMm,
          airGapMm: element.airGapMm,
          refractiveIndex: n0
        },
        soaked: {
          radius1Mm: radius1SoakedMm,
          radius2Mm: radius2SoakedMm,
          thicknessMm: thicknessSoakedMm,
          airGapMm: airGapSoakedMm,
          refractiveIndex: indexSoaked,
          indexChange: dn
        }
      });
    }

    if (!Number.isFinite(thermalPowerSumRef) || Math.abs(thermalPowerSumRef) < 1e-12
      || !Number.isFinite(thermalPowerSumSoaked) || Math.abs(thermalPowerSumSoaked) < 1e-12) {
      return {
        success: false,
        status: 'numerical-failure',
        error: { code: 'NUMERICAL_FAILURE', message: 'The supplied thin-lens powers do not define finite focal lengths.' }
      };
    }

    const nominalFocalLengthMm = 1000.0 / thermalPowerSumRef;
    const soakedFocalLengthMm = 1000.0 / thermalPowerSumSoaked;
    const focalShiftMm = soakedFocalLengthMm - nominalFocalLengthMm;
    const thermalDefocusMm = focalShiftMm - cumulativeHousingDriftMm;

    const result = {
      targetTempC,
      referenceTempC: refTempC,
      deltaTempK: deltaT,
      wavelengthUm,
      ambientPressurePa: pressurePa,
      housingCtePerK: lensSpec.housingCtePerK,
      housingCteSource: lensSpec.housingCteSource,
      ambientAirIndex: this.evaluateAirIndex(targetTempC, pressurePa, wavelengthUm),
      nominalFocalLengthMm,
      soakedFocalLengthMm,
      focalShiftMm,
      focalShiftPerKelvinUm: deltaT === 0 ? 0 : (focalShiftMm * 1000.0) / deltaT,
      thermalDefocusMm,
      elements
    };
    const numericValues = [
      result.deltaTempK,
      result.ambientAirIndex,
      result.nominalFocalLengthMm,
      result.soakedFocalLengthMm,
      result.focalShiftMm,
      result.focalShiftPerKelvinUm,
      result.thermalDefocusMm,
      ...result.elements.flatMap((element) => [
        element.soaked.radius1Mm,
        element.soaked.radius2Mm,
        element.soaked.thicknessMm,
        element.soaked.airGapMm,
        element.soaked.refractiveIndex,
        element.soaked.indexChange
      ])
    ];
    if (!numericValues.every(finite)) {
      return {
        success: false,
        status: 'numerical-failure',
        error: { code: 'NUMERICAL_FAILURE', message: 'Thermal evaluation produced a non-finite result.' }
      };
    }
    return result;
  }

  /**
   * Compatibility alias for the explicit property-based thin-lens estimate.
   * Legacy name-based catalog inputs are no longer accepted.
   */
  static evaluateThermalSoak(lensSpec, targetTempC, refTempC, wavelengthUm, pressurePa) {
    return this.evaluateThermalSoakFromProperties(
      lensSpec,
      targetTempC,
      refTempC,
      wavelengthUm,
      pressurePa
    );
  }
}

module.exports = {
  SCHOTT_THERMAL_GLASS_CATALOG,
  HOUSING_CTE,
  OpticalThermalSoakEngine
};
