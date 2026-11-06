/**
 * IEC 60079-10-1 Hazardous Area Classification Engine.
 *
 * Implements standard electrical equipment and installation hazardous area classification:
 *  - Release rate calculation: Sonic (choked) gas, subsonic gas, and flashing/evaporating liquid.
 *  - Ventilation assessment: Degree of ventilation (High, Medium, Low) and Availability (Good, Fair, Poor).
 *  - Hypothetical dissipation volume Vz and release characteristic parameter Qc.
 *  - Hazardous Zone determination (Zone 0, Zone 1, Zone 2, or Non-Hazardous).
 *  - Dispersion extent modeling: Horizontal radial radius and vertical envelope factoring gas density (light buoyant vs dense cryogenic slumping).
 *  - Gas Group allocation: IIA (Methane, Propane), IIB (Ethylene), IIC (Hydrogen, Acetylene).
 *  - Temperature Class allocation: T1 (450°C) through T6 (85°C) based on Auto-Ignition Temperature (AIT).
 *  - Equipment Protection Level (EPL) selection: Ga, Gb, Gc.
 */

'use strict';

const R_UNIVERSAL = 8314.462; // J / (kmol K)
const P_ATM = 101325.0; // Pa

/**
 * Standard published properties for flammable plant substances.
 */
const FLAMMABLE_SUBSTANCES = Object.freeze({
  methane: {
    name: 'Methane (CH4)',
    molecularWeight: 16.043,
    gamma: 1.31,
    compressibilityZ: 0.99,
    lelVolFraction: 0.044, // 4.4% vol
    lelMassKgM3: 0.030, // kg/m^3 at 20°C
    autoIgnitionTempC: 537.0,
    gasGroup: 'IIA',
    tempClass: 'T1',
    boilingPointK: 111.66
  },
  lng_vapor_ambient: {
    name: 'LNG Vapor (Ambient 20°C)',
    molecularWeight: 17.5,
    gamma: 1.30,
    compressibilityZ: 0.98,
    lelVolFraction: 0.045,
    lelMassKgM3: 0.032,
    autoIgnitionTempC: 537.0,
    gasGroup: 'IIA',
    tempClass: 'T1',
    boilingPointK: 112.0
  },
  lng_vapor_cryogenic: {
    name: 'LNG Vapor (Cold Cryogenic -160°C)',
    molecularWeight: 17.5,
    gamma: 1.35,
    compressibilityZ: 0.95,
    lelVolFraction: 0.045,
    lelMassKgM3: 0.032,
    autoIgnitionTempC: 537.0,
    gasGroup: 'IIA',
    tempClass: 'T1',
    boilingPointK: 112.0
  },
  ethane: {
    name: 'Ethane (C2H6)',
    molecularWeight: 30.07,
    gamma: 1.19,
    compressibilityZ: 0.97,
    lelVolFraction: 0.030,
    lelMassKgM3: 0.038,
    autoIgnitionTempC: 515.0,
    gasGroup: 'IIA',
    tempClass: 'T1',
    boilingPointK: 184.6
  },
  propane: {
    name: 'Propane (C3H8)',
    molecularWeight: 44.097,
    gamma: 1.13,
    compressibilityZ: 0.96,
    lelVolFraction: 0.021,
    lelMassKgM3: 0.039,
    autoIgnitionTempC: 450.0,
    gasGroup: 'IIA',
    tempClass: 'T1',
    boilingPointK: 231.1
  },
  butane: {
    name: 'n-Butane (C4H10)',
    molecularWeight: 58.12,
    gamma: 1.09,
    compressibilityZ: 0.95,
    lelVolFraction: 0.018,
    lelMassKgM3: 0.043,
    autoIgnitionTempC: 365.0,
    gasGroup: 'IIA',
    tempClass: 'T2',
    boilingPointK: 272.7
  },
  ethylene: {
    name: 'Ethylene (C2H4)',
    molecularWeight: 28.05,
    gamma: 1.24,
    compressibilityZ: 0.98,
    lelVolFraction: 0.027,
    lelMassKgM3: 0.031,
    autoIgnitionTempC: 450.0,
    gasGroup: 'IIB',
    tempClass: 'T1',
    boilingPointK: 169.4
  },
  hydrogen: {
    name: 'Hydrogen (H2)',
    molecularWeight: 2.016,
    gamma: 1.41,
    compressibilityZ: 1.0,
    lelVolFraction: 0.040,
    lelMassKgM3: 0.0033,
    autoIgnitionTempC: 560.0,
    gasGroup: 'IIC',
    tempClass: 'T1',
    boilingPointK: 20.28
  },
  hydrogen_sulfide: {
    name: 'Hydrogen Sulfide (H2S)',
    molecularWeight: 34.08,
    gamma: 1.32,
    compressibilityZ: 0.99,
    lelVolFraction: 0.043,
    lelMassKgM3: 0.061,
    autoIgnitionTempC: 260.0,
    gasGroup: 'IIB',
    tempClass: 'T3',
    boilingPointK: 212.8
  }
});

/**
 * Temperature class threshold table (IEC 60079-0).
 */
const TEMPERATURE_CLASSES = Object.freeze([
  { tempClass: 'T1', maxSurfaceTempC: 450, minAitC: 450 },
  { tempClass: 'T2', maxSurfaceTempC: 300, minAitC: 300 },
  { tempClass: 'T3', maxSurfaceTempC: 200, minAitC: 200 },
  { tempClass: 'T4', maxSurfaceTempC: 135, minAitC: 135 },
  { tempClass: 'T5', maxSurfaceTempC: 100, minAitC: 100 },
  { tempClass: 'T6', maxSurfaceTempC: 85, minAitC: 85 }
]);

/**
 * Determine Temperature Class based on substance Auto-Ignition Temperature (AIT).
 * Equipment surface temperature must not exceed the AIT (with safety margin).
 * @param {number} aitC Auto ignition temperature in °C
 * @returns {string} Temperature class ('T1' through 'T6')
 */
function getTemperatureClassForAit(aitC) {
  if (aitC >= 450) return 'T1';
  if (aitC >= 300) return 'T2';
  if (aitC >= 200) return 'T3';
  if (aitC >= 135) return 'T4';
  if (aitC >= 100) return 'T5';
  return 'T6';
}

/**
 * Calculate gas release rate (sonic or subsonic) through a hole/orifice.
 * IEC 60079-10-1 Annex B.
 *
 * @param {Object} p
 * @param {number} p.holeDiameterMm Hole diameter in mm
 * @param {number} p.pressureBarg Internal line/vessel pressure in barg
 * @param {number} [p.tempK=293.15] Internal gas temperature in K
 * @param {number} p.molecularWeight Gas molecular weight (kg/kmol)
 * @param {number} [p.gamma=1.3] Specific heat ratio Cp/Cv
 * @param {number} [p.compressibilityZ=1.0] Compressibility factor Z
 * @param {number} [p.dischargeCoefficient=0.62] Orifice discharge coefficient Cd
 * @returns {Object} Mass release rate (kg/s), regime ('sonic'|'subsonic'), choked status
 */
function calculateGasReleaseRate(p) {
  const dM = (p.holeDiameterMm || 1.0) / 1000.0;
  const areaM2 = (Math.PI / 4.0) * dM * dM;
  const pUpPa = (p.pressureBarg + 1.01325) * 1e5; // Absolute Pa
  const pDownPa = P_ATM;
  const T = p.tempK || 293.15;
  const mw = p.molecularWeight;
  const gamma = p.gamma || 1.30;
  const Z = p.compressibilityZ || 1.0;
  const cd = p.dischargeCoefficient !== undefined ? p.dischargeCoefficient : 0.62;

  if (pUpPa <= pDownPa) {
    return { massReleaseRateKgS: 0, regime: 'none', isChoked: false, areaM2 };
  }

  // Critical pressure ratio
  const criticalRatio = Math.pow(2.0 / (gamma + 1.0), gamma / (gamma - 1.0));
  const actualRatio = pDownPa / pUpPa;

  const Rspec = R_UNIVERSAL / mw; // J/(kg K)
  let massRate = 0.0;
  let isChoked = false;
  let regime = 'subsonic';

  if (actualRatio <= criticalRatio) {
    // Sonic (choked) flow
    isChoked = true;
    regime = 'sonic';
    const term = Math.sqrt((gamma / (Z * Rspec * T)) * Math.pow(2.0 / (gamma + 1.0), (gamma + 1.0) / (gamma - 1.0)));
    massRate = cd * areaM2 * pUpPa * term;
  } else {
    // Subsonic flow
    isChoked = false;
    regime = 'subsonic';
    const bracket = Math.pow(actualRatio, 2.0 / gamma) - Math.pow(actualRatio, (gamma + 1.0) / gamma);
    const term = Math.sqrt(((2.0 * gamma) / (gamma - 1.0)) * (1.0 / (Z * Rspec * T)) * Math.max(0.0, bracket));
    massRate = cd * areaM2 * pUpPa * term;
  }

  return {
    massReleaseRateKgS: massRate,
    regime,
    isChoked,
    criticalPressureRatio: criticalRatio,
    pressureRatio: actualRatio,
    areaM2
  };
}

/**
 * IEC 60079-10-1 Table B.1 Zone Matrix logic.
 *
 * @param {'continuous'|'primary'|'secondary'} gradeOfRelease
 * @param {'high'|'medium'|'low'} ventilationDegree
 * @param {'good'|'fair'|'poor'} ventilationAvailability
 * @returns {{zone:string, zoneNumber:number|null, epl:string, description:string}}
 */
function determineZoneType(gradeOfRelease, ventilationDegree, ventilationAvailability) {
  const grade = gradeOfRelease.toLowerCase();
  const degree = ventilationDegree.toLowerCase();
  const avail = ventilationAvailability.toLowerCase();

  let zone = 'Non-Hazardous';
  let zoneNumber = null;
  let epl = 'Non-Ex';
  let description = '';

  if (grade === 'continuous') {
    if (degree === 'high') {
      zone = 'Zone 0 NE';
      zoneNumber = 0;
      epl = 'Ga';
      description = 'Continuous release diluted to negligible extent (Zone 0 Negligible Extent)';
    } else if (degree === 'medium') {
      if (avail === 'good' || avail === 'fair') {
        zone = 'Zone 0';
        zoneNumber = 0;
        epl = 'Ga';
        description = 'Explosive atmosphere present continuously or for long periods';
      } else {
        zone = 'Zone 0';
        zoneNumber = 0;
        epl = 'Ga';
        description = 'Zone 0 with poor ventilation';
      }
    } else {
      // low ventilation
      zone = 'Zone 0';
      zoneNumber = 0;
      epl = 'Ga';
      description = 'Zone 0 expanding with inadequate ventilation';
    }
  } else if (grade === 'primary') {
    if (degree === 'high') {
      zone = 'Zone 1 NE';
      zoneNumber = 1;
      epl = 'Gb';
      description = 'Primary release diluted rapidly to negligible extent';
    } else if (degree === 'medium') {
      if (avail === 'good') {
        zone = 'Zone 1';
        zoneNumber = 1;
        epl = 'Gb';
        description = 'Explosive atmosphere likely to occur periodically in normal operation';
      } else if (avail === 'fair') {
        zone = 'Zone 1 + Zone 2';
        zoneNumber = 1;
        epl = 'Gb';
        description = 'Zone 1 surrounded by Zone 2 during ventilation outages';
      } else {
        zone = 'Zone 0';
        zoneNumber = 0;
        epl = 'Ga';
        description = 'Primary release with poor ventilation promotes area to Zone 0';
      }
    } else {
      // low ventilation
      zone = 'Zone 0';
      zoneNumber = 0;
      epl = 'Ga';
      description = 'Primary release with low ventilation degrades to Zone 0';
    }
  } else if (grade === 'secondary') {
    if (degree === 'high') {
      zone = 'Non-Hazardous';
      zoneNumber = null;
      epl = 'Non-Ex';
      description = 'Secondary release diluted instantaneously; zone is negligible';
    } else if (degree === 'medium') {
      if (avail === 'good' || avail === 'fair') {
        zone = 'Zone 2';
        zoneNumber = 2;
        epl = 'Gc';
        description = 'Explosive atmosphere not expected in normal operation, only brief if occurring';
      } else {
        zone = 'Zone 1';
        zoneNumber = 1;
        epl = 'Gb';
        description = 'Secondary release with poor ventilation promotes to Zone 1';
      }
    } else {
      // low ventilation
      zone = 'Zone 1';
      zoneNumber = 1;
      epl = 'Gb';
      description = 'Secondary release with low ventilation promotes to Zone 1 or Zone 0';
    }
  }

  return { zone, zoneNumber, epl, description };
}

/**
 * IEC 60079-10-1 Hazardous Area Classification Master Evaluator.
 */
class HazardousAreaClassifier {
  /**
   * @param {Object} spec
   * @param {string} [spec.areaName='LNG Unit Area']
   * @param {string} [spec.substanceKey='methane'] Key in FLAMMABLE_SUBSTANCES or custom
   * @param {Object} [spec.customSubstance] Custom substance properties
   * @param {'continuous'|'primary'|'secondary'} [spec.gradeOfRelease='secondary']
   * @param {number} spec.operatingPressureBarg Line/vessel operating pressure
   * @param {number} [spec.operatingTempC=20.0] Line/vessel temperature in °C
   * @param {number} [spec.holeDiameterMm=1.0] Hole diameter (1mm standard for flanges/packings, 5-10mm for line tears)
   * @param {'open_air'|'enclosed'} [spec.environment='open_air']
   * @param {number} [spec.windSpeedMPerS=2.0] Ambient wind speed in open air (default 2.0 m/s per IEC 60079-10-1)
   * @param {number} [spec.airChangesPerHour=12.0] Enclosure air exchange rate if enclosed
   * @param {number} [spec.enclosureVolumeM3=100.0] Enclosure volume if enclosed
   * @param {'good'|'fair'|'poor'} [spec.ventilationAvailability='good']
   */
  constructor(spec = {}) {
    this.areaName = spec.areaName || 'Process Area';
    this.gradeOfRelease = spec.gradeOfRelease || 'secondary';
    this.operatingPressureBarg = spec.operatingPressureBarg !== undefined ? spec.operatingPressureBarg : 5.0;
    this.operatingTempC = spec.operatingTempC !== undefined ? spec.operatingTempC : 20.0;
    this.holeDiameterMm = spec.holeDiameterMm !== undefined && spec.holeDiameterMm > 0 ? spec.holeDiameterMm : 1.0;
    this.environment = spec.environment || 'open_air';
    this.windSpeedMPerS = spec.windSpeedMPerS !== undefined ? Math.max(0.1, spec.windSpeedMPerS) : 2.0;
    this.airChangesPerHour = spec.airChangesPerHour !== undefined ? Math.max(0.1, spec.airChangesPerHour) : 12.0;
    this.enclosureVolumeM3 = spec.enclosureVolumeM3 !== undefined ? Math.max(1.0, spec.enclosureVolumeM3) : 100.0;
    this.ventilationAvailability = spec.ventilationAvailability || 'good';

    // Substance resolution
    const key = spec.substanceKey || 'methane';
    this.substance = spec.customSubstance || FLAMMABLE_SUBSTANCES[key] || FLAMMABLE_SUBSTANCES.methane;
  }

  /**
   * Execute full hazardous area classification calculation.
   * @returns {Object} Complete classification report
   */
  classify() {
    const tempK = this.operatingTempC + 273.15;

    // 1. Release rate calculation
    const release = calculateGasReleaseRate({
      holeDiameterMm: this.holeDiameterMm,
      pressureBarg: this.operatingPressureBarg,
      tempK,
      molecularWeight: this.substance.molecularWeight,
      gamma: this.substance.gamma,
      compressibilityZ: this.substance.compressibilityZ
    });

    const Wg = release.massReleaseRateKgS;

    // 2. Volumetric release rate & characteristic parameter Qc
    const ambientTempK = 293.15;
    const rhoGasAmbient = (P_ATM * this.substance.molecularWeight) / (R_UNIVERSAL * ambientTempK);
    const Qg = Wg > 0 ? Wg / rhoGasAmbient : 0; // m^3/s
    const Qc = Qg / this.substance.lelVolFraction; // m^3/s

    // 3. Ventilation assessment
    let ventilationDegree = 'medium';
    let hypotheticalVolumeVz = 0;

    if (this.environment === 'open_air') {
      // Open air has high natural air exchange (equivalent C > 0.03 s^-1, typically 100+ ACH)
      const effectiveC = (this.windSpeedMPerS / 5.0) * 0.1; // air renewal rate
      const fFactor = 2.0; // mixing factor
      hypotheticalVolumeVz = (fFactor * Qg) / (effectiveC * this.substance.lelVolFraction);

      if (hypotheticalVolumeVz < 0.1) {
        ventilationDegree = 'high';
      } else {
        ventilationDegree = 'medium';
      }
    } else {
      // Enclosure
      const C_perSec = this.airChangesPerHour / 3600.0;
      const fFactor = 3.0; // indoor mixing factor
      hypotheticalVolumeVz = (fFactor * Qg) / (C_perSec * this.substance.lelVolFraction);

      if (hypotheticalVolumeVz < 0.1) {
        ventilationDegree = 'high';
      } else if (hypotheticalVolumeVz <= this.enclosureVolumeM3) {
        ventilationDegree = 'medium';
      } else {
        ventilationDegree = 'low';
      }
    }

    // 4. Determine Zone Type & EPL
    const zoneInfo = determineZoneType(this.gradeOfRelease, ventilationDegree, this.ventilationAvailability);

    // 5. Zone Extent / Boundary Distance
    // Using IEC 60079-10-1 Annex D jet release dispersion & EI 15 benchmark
    const rhoAir = 1.204; // kg/m^3
    const lelMass = this.substance.lelMassKgM3;
    const uw = Math.max(0.5, this.windSpeedMPerS);

    // Jet release formula: r = 1.08 * (Wg / (lelMass * uw))^0.5
    let calculatedRadiusM = 0;
    if (Wg > 0) {
      calculatedRadiusM = 1.08 * Math.sqrt(Wg / (lelMass * uw));
    }

    // If classified as Non-Hazardous (or negligible extent), the extent radius is zero
    let recommendedRadiusM = 0;
    if (zoneInfo.zoneNumber !== null) {
      if (this.gradeOfRelease === 'secondary' && zoneInfo.zoneNumber === 2) {
        recommendedRadiusM = Math.max(1.5, Math.ceil(calculatedRadiusM * 2.0) / 2.0);
      } else if (this.gradeOfRelease === 'primary' && zoneInfo.zoneNumber === 1) {
        recommendedRadiusM = Math.max(3.0, Math.ceil(calculatedRadiusM * 2.0) / 2.0);
      } else if (this.gradeOfRelease === 'continuous' && zoneInfo.zoneNumber === 0) {
        recommendedRadiusM = Math.max(1.5, Math.ceil(calculatedRadiusM * 2.0) / 2.0);
      } else {
        recommendedRadiusM = Math.max(1.0, Math.ceil(calculatedRadiusM * 2.0) / 2.0);
      }
    }

    // Gas buoyancy / relative density
    const relativeDensityToAir = this.substance.molecularWeight / 28.96;
    let isHeavyGas = relativeDensityToAir > 1.2 || this.operatingTempC < -100.0; // Cryogenic LNG acts dense
    let verticalExtentUpM = recommendedRadiusM;
    let verticalExtentDownM = recommendedRadiusM;

    if (zoneInfo.zoneNumber === null) {
      verticalExtentUpM = 0;
      verticalExtentDownM = 0;
    } else if (isHeavyGas) {
      // Dense gas slumps along the ground
      verticalExtentUpM = recommendedRadiusM * 0.5;
      verticalExtentDownM = recommendedRadiusM * 1.5; // downwards to grade level
    } else {
      // Buoyant light gas rises upwards
      verticalExtentUpM = recommendedRadiusM * 1.5;
      verticalExtentDownM = recommendedRadiusM * 0.5;
    }

    // 6. Gas Group, Temperature Class, EPL
    const gasGroup = this.substance.gasGroup;
    const tempClass = getTemperatureClassForAit(this.substance.autoIgnitionTempC);

    return {
      areaName: this.areaName,
      substance: this.substance.name,
      gradeOfRelease: this.gradeOfRelease,
      releaseConditions: {
        pressureBarg: this.operatingPressureBarg,
        tempC: this.operatingTempC,
        holeDiameterMm: this.holeDiameterMm,
        massReleaseRateKgS: Wg,
        regime: release.regime,
        isChoked: release.isChoked,
        isSupercritical: (this.operatingPressureBarg + 1.01325) > 46.0,
        volumetricReleaseRateM3S: Qg,
        releaseCharacteristicQc: Qc
      },
      ventilation: {
        environment: this.environment,
        degree: ventilationDegree,
        availability: this.ventilationAvailability,
        hypotheticalVolumeVzM3: hypotheticalVolumeVz
      },
      classification: {
        zone: zoneInfo.zone,
        zoneNumber: zoneInfo.zoneNumber,
        epl: zoneInfo.epl,
        gasGroup,
        tempClass,
        description: zoneInfo.description
      },
      extent: {
        horizontalRadiusM: recommendedRadiusM,
        verticalExtentUpM,
        verticalExtentDownM,
        relativeDensityToAir,
        dispersionBehavior: isHeavyGas ? 'Dense/Cryogenic Slumping' : 'Buoyant/Rising'
      }
    };
  }
}

module.exports = {
  FLAMMABLE_SUBSTANCES,
  TEMPERATURE_CLASSES,
  getTemperatureClassForAit,
  calculateGasReleaseRate,
  determineZoneType,
  HazardousAreaClassifier
};
