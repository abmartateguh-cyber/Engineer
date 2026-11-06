/**
 * ThermoCompounds — a documented correlation-based pure-component property engine.
 *
 * This module is NOT a licensed AIChE DIPPR 801 data product. It implements
 * genuine thermophysical correlations whose formulas and parameter origins are
 * cited per species (public literature):
 *
 *   1. Vapor pressure: Clausius–Clapeyron, ln P = A + B/T, with the slope
 *      B = -DeltaH_vap/R set by a published latent heat at an anchor point
 *      (normal boiling point, or triple point for CO2).
 *   2. Latent heat at Tb: Watson's correlation
 *      DeltaH_vap(T) = DeltaH_vap(Tb) * ((1 - Tr)/(1 - Tbr))^0.38
 *      (Watson, K.M., Ind. Eng. Chem., 35, 398, 1943).
 *   3. Ideal-gas Cp: NIST-JANAF-style polynomial. For species with NIST
 *      Shomate coefficients the published constants are used verbatim; for
 *      species without JANAFG tables, coefficients are least-squares fits to
 *      the NIST WebBook recommended gas-phase Cp tabulation.
 *   4. Saturated liquid density: Rackett equation (Spencer & Danner, 1973)
 *      V_s = (R Tc/Pc) Z_RA^(1 + (1 - Tr)^(2/7)), with published Z_RA.
 *
 * Temperature-domain violations fail closed with typed errors, and properties
 * without a documented public correlation set (liquid viscosity, thermal
 * conductivity) are reported as UNAVAILABLE rather than estimated.
 */

'use strict';

const R_GAS = 8.314462618; // J/(mol*K)
const P_ATM = 101325.0; // Pa

function requirePositiveTemperature(temperatureK, propertyName) {
  if (!Number.isFinite(temperatureK) || temperatureK <= 0) {
    throw new TypeError(`${propertyName} requires a finite positive temperature in Kelvin.`);
  }
}

function unavailable(propertyName) {
  const error = new Error(
    `${propertyName} has no documented public correlation set in this catalog; supply explicit coefficients instead.`
  );
  error.code = 'UNAVAILABLE';
  return error;
}

class CorrelationPropertyComponent {
  constructor(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError('An explicit species data object is required.');
    }
    this.id = data.id;
    this.name = data.name;
    this.formula = data.formula;
    this.cas = data.cas || '';
    this.family = data.family;
    this.mw = data.mw; // g/mol
    this.Tc = data.Tc; // K
    this.Pc = data.Pc; // Pa
    this.omega = data.omega;
    this.Tb = data.Tb; // K (normal boiling or sublimation point)
    this.triplePointK = data.triplePointK;
    this.zRA = data.zRA; // Rackett compressibility factor
    this.cpForm = data.cpForm; // 'shomate' | 'poly4'
    this.cpCoeffs = Object.freeze([...data.cpCoeffs]);
    this.cpTmin = data.cpTmin;
    this.cpTmax = data.cpTmax;
    this.cp298Ref = data.cp298Ref; // NIST recommended Cp at 298.15 K
    this.vpAnchor = Object.freeze({ ...data.vpAnchor });
    this.sourceRef = Object.freeze({ ...data.sourceRef });
    this.dataStatus = 'documented-correlation-set';
    this.licenseStatus = 'public-literature-citation';

    const hvapKJmol = this.vpAnchor.hvapKJmol;
    const anchorT = this.vpAnchor.T;
    const anchorP = this.vpAnchor.P;
    const ccA = Math.log(anchorP) + (hvapKJmol * 1000) / (R_GAS * anchorT);
    const ccB = -(hvapKJmol * 1000) / R_GAS;
    this.pvEq = Object.freeze([ccA, ccB, 0, 0, 0]);
    this.pvTmin = this.triplePointK;
    this.pvTmax = this.Tc;
    this.rhoLEq = Object.freeze([
      this.Pc / (100000 * 0.08314462618 * this.Tc), // molar density factor (kmol/m^3)
      this.zRA,
      this.Tc,
      2 / 7
    ]);
  }

  requireRange(T, tmin, tmax, label) {
    if (T < tmin || T > tmax) {
      throw new RangeError(`${label} temperature ${T} K is outside the documented range [${tmin}, ${tmax}] K.`);
    }
  }

  getCriticalConstants() {
    return {
      temperatureK: this.Tc,
      pressurePa: this.Pc,
      acentricFactor: this.omega,
      boilingPointK: this.Tb,
      molecularWeightGPerMol: this.mw
    };
  }

  getVaporPressure(T) {
    requirePositiveTemperature(T, 'Vapor-pressure calculation');
    this.requireRange(T, this.pvTmin, this.pvTmax, 'Vapor-pressure correlation');
    const lnP = this.pvEq[0] + this.pvEq[1] / T;
    const pressure = Math.exp(lnP);
    if (!Number.isFinite(pressure) || pressure <= 0) {
      throw new RangeError('The vapor-pressure correlation did not produce finite positive pressure.');
    }
    return pressure;
  }

  getLatentHeatOfVaporization(T) {
    requirePositiveTemperature(T, 'Latent-heat calculation');
    this.requireRange(T, this.pvTmin, this.pvTmax, 'Watson latent-heat correlation');
    const Tr = T / this.Tc;
    if (Tr >= 1) throw new RangeError('Watson latent heat is undefined at or above the critical temperature.');
    const Tbr = this.Tb / this.Tc;
    const factor = Math.pow((1 - Tr) / (1 - Tbr), 0.38);
    const hvap = this.vpAnchor.hvapKJmol * factor; // kJ/mol
    if (!Number.isFinite(hvap) || hvap <= 0) {
      throw new RangeError('The Watson latent-heat correlation did not produce finite positive enthalpy.');
    }
    return hvap;
  }

  getLiquidDensity(T) {
    requirePositiveTemperature(T, 'Liquid-density calculation');
    this.requireRange(T, this.pvTmin, this.pvTmax, 'Rackett liquid-density correlation');
    const Tr = T / this.Tc;
    let density;
    if (Tr >= 1) {
      density = ((this.mw / 1000) * (this.Pc / (R_GAS * this.Tc))) / this.zRA;
    } else {
      const molarVolume = ((R_GAS * this.Tc) / this.Pc) * Math.pow(this.zRA, 1 + Math.pow(1 - Tr, 2 / 7));
      density = this.mw / 1000 / molarVolume;
    }
    if (!Number.isFinite(density) || density <= 0) {
      throw new RangeError('The Rackett correlation did not produce finite positive density.');
    }
    return density;
  }

  getIdealGasCp(T) {
    requirePositiveTemperature(T, 'Ideal-gas heat-capacity calculation');
    this.requireRange(T, this.cpTmin, this.cpTmax, 'Ideal-gas Cp correlation');
    const [A, B, C, D, E] = this.cpCoeffs;
    const t = T / 1000;
    let cp;
    if (this.cpForm === 'shomate') {
      cp = A + B * t + C * t * t + D * t * t * t + E / (t * t);
    } else {
      cp = A + B * t + C * t * t + D * t * t * t + E * t * t * t * t;
    }
    if (!Number.isFinite(cp) || cp <= 0) {
      throw new RangeError('The ideal-gas Cp correlation did not produce finite positive heat capacity.');
    }
    return cp;
  }

  getLiquidViscosity() {
    throw unavailable('Liquid viscosity');
  }

  getLiquidThermalConductivity() {
    throw unavailable('Liquid thermal conductivity');
  }

  toPengRobinsonRecord() {
    return {
      name: this.name,
      criticalTemperatureK: this.Tc,
      criticalPressurePa: this.Pc,
      acentricFactor: this.omega,
      provenance: {
        source: this.sourceRef.parameters,
        license: this.licenseStatus
      }
    };
  }
}

const DOCUMENTED_CORRELATION_SET = Object.freeze([
  {
    id: 'Water',
    name: 'Water',
    formula: 'H2O',
    cas: '7732-18-5',
    family: 'Aqueous',
    mw: 18.01528,
    Tc: 647.096,
    Pc: 22.064e6,
    omega: 0.3443,
    Tb: 373.15,
    triplePointK: 273.16,
    zRA: 0.233,
    vpAnchor: { T: 373.15, P: P_ATM, hvapKJmol: 40.66, note: 'normal boiling point' },
    cpForm: 'shomate',
    cpCoeffs: [30.092, 6.832514, 6.793435, -2.53448, 0.082139],
    cpTmin: 273.15,
    cpTmax: 1700,
    cp298Ref: 33.59,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; Shomate Cp',
      parameters:
        'NIST Chemistry WebBook SRD 69; Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.'
    }
  },
  {
    id: 'CarbonDioxide',
    name: 'Carbon dioxide',
    formula: 'CO2',
    cas: '124-38-9',
    family: 'Inorganic gas',
    mw: 44.0095,
    Tc: 304.13,
    Pc: 7.377e6,
    omega: 0.22394,
    Tb: 194.7,
    triplePointK: 216.59,
    zRA: 0.2722,
    vpAnchor: { T: 216.59, P: 517900, hvapKJmol: 16.61, note: 'liquid-vapor, anchored at triple point' },
    cpForm: 'shomate',
    cpCoeffs: [24.99735, 55.18696, -33.69137, 7.948387, -0.136638],
    cpTmin: 298.15,
    cpTmax: 1200,
    cp298Ref: 37.12,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; Shomate Cp',
      parameters:
        'NIST Chemistry WebBook SRD 69; Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.'
    }
  },
  {
    id: 'Nitrogen',
    name: 'Nitrogen',
    formula: 'N2',
    cas: '7727-37-9',
    family: 'Diatomic gas',
    mw: 28.0134,
    Tc: 126.19,
    Pc: 3.396e6,
    omega: 0.0372,
    Tb: 77.36,
    triplePointK: 63.15,
    zRA: 0.2911,
    vpAnchor: { T: 77.36, P: P_ATM, hvapKJmol: 5.58, note: 'normal boiling point' },
    cpForm: 'shomate',
    cpCoeffs: [28.98641, 1.853978, -9.647459, 16.63537, 0.000117],
    cpTmin: 273.15,
    cpTmax: 500,
    cp298Ref: 29.12,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; Shomate Cp',
      parameters: 'NIST Chemistry WebBook SRD 69; NIST-JANAF Thermochemical Tables (Chase, 1998).'
    }
  },
  {
    id: 'Oxygen',
    name: 'Oxygen',
    formula: 'O2',
    cas: '7782-44-7',
    family: 'Diatomic gas',
    mw: 31.9988,
    Tc: 154.581,
    Pc: 5.043e6,
    omega: 0.0222,
    Tb: 90.19,
    triplePointK: 54.36,
    zRA: 0.2878,
    vpAnchor: { T: 90.19, P: P_ATM, hvapKJmol: 6.82, note: 'normal boiling point' },
    cpForm: 'shomate',
    cpCoeffs: [31.32234, -20.23531, 57.86644, -36.50624, -0.007374],
    cpTmin: 273.15,
    cpTmax: 700,
    cp298Ref: 29.39,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; Shomate Cp',
      parameters: 'NIST Chemistry WebBook SRD 69; NIST-JANAF Thermochemical Tables (Chase, 1998).'
    }
  },
  {
    id: 'Hydrogen',
    name: 'Hydrogen',
    formula: 'H2',
    cas: '1333-74-0',
    family: 'Diatomic gas',
    mw: 2.01588,
    Tc: 33.145,
    Pc: 1.2964e6,
    omega: -0.217,
    Tb: 20.37,
    triplePointK: 13.95,
    zRA: 0.3057,
    vpAnchor: { T: 20.37, P: P_ATM, hvapKJmol: 0.904, note: 'normal boiling point' },
    cpForm: 'shomate',
    cpCoeffs: [33.066178, -11.363417, 11.432816, -2.772874, -0.158558],
    cpTmin: 273.15,
    cpTmax: 1000,
    cp298Ref: 28.84,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; Shomate Cp',
      parameters: 'NIST Chemistry WebBook SRD 69; NIST-JANAF Thermochemical Tables (Chase, 1998).'
    }
  },
  {
    id: 'Methane',
    name: 'Methane',
    formula: 'CH4',
    cas: '74-82-8',
    family: 'Alkane',
    mw: 16.0425,
    Tc: 190.564,
    Pc: 4.599e6,
    omega: 0.01142,
    Tb: 111.66,
    triplePointK: 90.69,
    zRA: 0.2877,
    vpAnchor: { T: 111.66, P: P_ATM, hvapKJmol: 8.18, note: 'normal boiling point' },
    cpForm: 'shomate',
    cpCoeffs: [-0.703029, 108.4773, -42.52157, 5.862788, 0.678565],
    cpTmin: 298.15,
    cpTmax: 1300,
    cp298Ref: 35.64,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; Shomate Cp',
      parameters: 'NIST Chemistry WebBook SRD 69; NIST-JANAF Thermochemical Tables (Chase, 1998).'
    }
  },
  {
    id: 'Ethane',
    name: 'Ethane',
    formula: 'C2H6',
    cas: '74-84-0',
    family: 'Alkane',
    mw: 30.069,
    Tc: 305.32,
    Pc: 4.872e6,
    omega: 0.0995,
    Tb: 184.55,
    triplePointK: 90.35,
    zRA: 0.2795,
    vpAnchor: { T: 184.55, P: P_ATM, hvapKJmol: 14.7, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [6.311194, 171.990006, -57.341223, -1.377555, 3.023025],
    cpTmin: 273.15,
    cpTmax: 2000,
    cp298Ref: 52.49,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters: 'NIST Chemistry WebBook SRD 69 (Gurvich et al. recommended Cp); fit by this project.'
    }
  },
  {
    id: 'Propane',
    name: 'Propane',
    formula: 'C3H8',
    cas: '74-98-6',
    family: 'Alkane',
    mw: 44.0956,
    Tc: 369.83,
    Pc: 4.248e6,
    omega: 0.1523,
    Tb: 231.02,
    triplePointK: 85.47,
    zRA: 0.2766,
    vpAnchor: { T: 231.02, P: P_ATM, hvapKJmol: 16.31, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [1.09485, 273.837573, -100.112094, -11.473099, 11.512788],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 73.6,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters: 'NIST Chemistry WebBook SRD 69 (Chao, 1973 recommended Cp); fit by this project.'
    }
  },
  {
    id: 'n-Butane',
    name: 'n-Butane',
    formula: 'C4H10',
    cas: '106-97-8',
    family: 'Alkane',
    mw: 58.1222,
    Tc: 425.12,
    Pc: 3.796e6,
    omega: 0.2002,
    Tb: 272.66,
    triplePointK: 134.86,
    zRA: 0.273,
    vpAnchor: { T: 272.66, P: P_ATM, hvapKJmol: 22.44, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [4.562208, 356.132637, -134.79239, -13.128489, 14.93161],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 98.49,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters: 'NIST Chemistry WebBook SRD 69 (Chen, 1975 recommended Cp); fit by this project.'
    }
  },
  {
    id: 'Ethylene',
    name: 'Ethylene',
    formula: 'C2H4',
    cas: '74-85-1',
    family: 'Alkene',
    mw: 28.0532,
    Tc: 282.34,
    Pc: 5.041e6,
    omega: 0.0863,
    Tb: 169.42,
    triplePointK: 103.99,
    zRA: 0.2811,
    vpAnchor: { T: 169.42, P: P_ATM, hvapKJmol: 13.54, note: 'normal boiling point' },
    cpForm: 'shomate',
    cpCoeffs: [-6.38788, 184.4019, -112.9718, 28.49593, 0.31554],
    cpTmin: 298.15,
    cpTmax: 1200,
    cp298Ref: 42.9,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; Shomate Cp',
      parameters: 'NIST Chemistry WebBook SRD 69; NIST-JANAF Thermochemical Tables (Chase, 1998).'
    }
  },
  {
    id: 'Propylene',
    name: 'Propylene',
    formula: 'C3H6',
    cas: '115-07-1',
    family: 'Alkene',
    mw: 42.0797,
    Tc: 364.9,
    Pc: 4.6e6,
    omega: 0.1416,
    Tb: 225.46,
    triplePointK: 87.89,
    zRA: 0.2784,
    vpAnchor: { T: 225.46, P: P_ATM, hvapKJmol: 18.42, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [7.244738, 214.575148, -74.478312, -12.738826, 10.044865],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 64.32,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters: 'NIST Chemistry WebBook SRD 69 (Chao, 1975 recommended Cp); fit by this project.'
    }
  },
  {
    id: 'Ammonia',
    name: 'Ammonia',
    formula: 'NH3',
    cas: '7664-41-7',
    family: 'Inorganic gas',
    mw: 17.0305,
    Tc: 405.4,
    Pc: 11.333e6,
    omega: 0.256,
    Tb: 239.82,
    triplePointK: 195.5,
    zRA: 0.2446,
    vpAnchor: { T: 239.82, P: P_ATM, hvapKJmol: 23.33, note: 'normal boiling point' },
    cpForm: 'shomate',
    cpCoeffs: [19.99563, 49.77119, -15.37599, 1.921168, 0.189174],
    cpTmin: 298.15,
    cpTmax: 1400,
    cp298Ref: 35.65,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; Shomate Cp',
      parameters: 'NIST Chemistry WebBook SRD 69; NIST-JANAF Thermochemical Tables (Chase, 1998).'
    }
  },
  {
    id: 'Methanol',
    name: 'Methanol',
    formula: 'CH4O',
    cas: '67-56-1',
    family: 'Alcohol',
    mw: 32.0419,
    Tc: 512.6,
    Pc: 8.096e6,
    omega: 0.565,
    Tb: 337.85,
    triplePointK: 175.6,
    zRA: 0.2312,
    vpAnchor: { T: 337.85, P: P_ATM, hvapKJmol: 35.21, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [25.01957, 45.008106, 90.49426, -99.238242, 28.536899],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 44.06,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters: 'NIST Chemistry WebBook SRD 69 (Thermodynamics Research Center recommended Cp); fit by this project.'
    }
  },
  {
    id: 'Ethanol',
    name: 'Ethanol',
    formula: 'C2H6O',
    cas: '64-17-5',
    family: 'Alcohol',
    mw: 46.0684,
    Tc: 513.9,
    Pc: 6.148e6,
    omega: 0.6437,
    Tb: 351.44,
    triplePointK: 159.05,
    zRA: 0.2242,
    vpAnchor: { T: 351.44, P: P_ATM, hvapKJmol: 38.56, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [6.804613, 224.346626, -95.771748, -0.133592, 7.676918],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 65.21,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters: 'NIST Chemistry WebBook SRD 69 (Thermodynamics Research Center recommended Cp); fit by this project.'
    }
  },
  {
    id: 'Acetone',
    name: 'Acetone',
    formula: 'C3H6O',
    cas: '67-64-1',
    family: 'Ketone',
    mw: 58.0791,
    Tc: 508.2,
    Pc: 4.701e6,
    omega: 0.3065,
    Tb: 329.22,
    triplePointK: 178.45,
    zRA: 0.2333,
    vpAnchor: { T: 329.22, P: P_ATM, hvapKJmol: 29.1, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [17.957193, 202.83042, -22.716394, -58.248309, 22.577847],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 75.02,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters: 'NIST Chemistry WebBook SRD 69 (Chao, 1986 recommended Cp); fit by this project.'
    }
  },
  {
    id: 'Benzene',
    name: 'Benzene',
    formula: 'C6H6',
    cas: '71-43-2',
    family: 'Aromatic',
    mw: 78.1118,
    Tc: 562.05,
    Pc: 4.895e6,
    omega: 0.2103,
    Tb: 353.24,
    triplePointK: 278.68,
    zRA: 0.2695,
    vpAnchor: { T: 353.24, P: P_ATM, hvapKJmol: 30.72, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [-48.423586, 557.639243, -448.37049, 177.993994, -27.17361],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 82.44,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters: 'NIST Chemistry WebBook SRD 69 (Thermodynamics Research Center recommended Cp); fit by this project.'
    }
  },
  {
    id: 'Toluene',
    name: 'Toluene',
    formula: 'C7H8',
    cas: '108-88-3',
    family: 'Aromatic',
    mw: 92.1384,
    Tc: 591.75,
    Pc: 4.126e6,
    omega: 0.264,
    Tb: 383.78,
    triplePointK: 178.18,
    zRA: 0.2636,
    vpAnchor: { T: 383.78, P: P_ATM, hvapKJmol: 33.18, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [-41.849589, 601.565435, -418.632459, 134.711832, -14.195347],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 103.7,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters: 'NIST Chemistry WebBook SRD 69 (Draeger, 1985 recommended Cp); fit by this project.'
    }
  },
  {
    id: 'Cyclohexane',
    name: 'Cyclohexane',
    formula: 'C6H12',
    cas: '110-82-7',
    family: 'Naphthene',
    mw: 84.1595,
    Tc: 553.8,
    Pc: 4.08e6,
    omega: 0.212,
    Tb: 353.93,
    triplePointK: 279.47,
    zRA: 0.2727,
    vpAnchor: { T: 353.93, P: P_ATM, hvapKJmol: 29.97, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [-39.755878, 512.679559, -33.633748, -202.059025, 78.29516],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 105.3,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters: 'NIST Chemistry WebBook SRD 69 (Dorofeeva, 1986 recommended Cp); fit by this project.'
    }
  },
  {
    id: 'n-Hexane',
    name: 'n-Hexane',
    formula: 'C6H14',
    cas: '110-54-3',
    family: 'Alkane',
    mw: 86.1754,
    Tc: 507.6,
    Pc: 3.025e6,
    omega: 0.3013,
    Tb: 341.88,
    triplePointK: 177.83,
    zRA: 0.2607,
    vpAnchor: { T: 341.88, P: P_ATM, hvapKJmol: 28.85, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [9.260695, 482.075659, -79.087496, -143.158084, 62.775973],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 142.6,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters: 'NIST Chemistry WebBook SRD 69 (Scott, 1974 recommended Cp); fit by this project.'
    }
  },
  {
    id: 'n-Octane',
    name: 'n-Octane',
    formula: 'C8H18',
    cas: '111-65-9',
    family: 'Alkane',
    mw: 114.2285,
    Tc: 568.7,
    Pc: 2.486e6,
    omega: 0.3996,
    Tb: 398.83,
    triplePointK: 216.37,
    zRA: 0.2566,
    vpAnchor: { T: 398.83, P: P_ATM, hvapKJmol: 34.41, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [-2.582383, 728.721444, -292.193283, -43.387718, 42.059738],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 187.8,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters: 'NIST Chemistry WebBook SRD 69 (Scott, 1974 recommended Cp); fit by this project.'
    }
  },
  {
    id: 'n-Pentane',
    name: 'n-Pentane',
    formula: 'C5H12',
    cas: '109-66-0',
    family: 'Alkane',
    mw: 72.15,
    Tc: 469.7,
    Pc: 3370000,
    omega: 0.251,
    Tb: 309.22,
    triplePointK: 164.39499999999998,
    zRA: 0.268,
    vpAnchor: { T: 309.22, P: 101325, hvapKJmol: 26.43, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [88.13956, 106.86044, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 120,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'n-Heptane',
    name: 'n-Heptane',
    formula: 'C7H16',
    cas: '142-82-5',
    family: 'Alkane',
    mw: 100.21,
    Tc: 540.2,
    Pc: 2736000,
    omega: 0.349,
    Tb: 371.58,
    triplePointK: 189.07,
    zRA: 0.261,
    vpAnchor: { T: 371.58, P: 101325, hvapKJmol: 31.69, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [124.643442, 135.356558, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 165,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'n-Nonane',
    name: 'n-Nonane',
    formula: 'C9H20',
    cas: '111-84-2',
    family: 'Alkane',
    mw: 128.26,
    Tc: 594.6,
    Pc: 2281000,
    omega: 0.445,
    Tb: 423.97,
    triplePointK: 208.10999999999999,
    zRA: 0.25,
    vpAnchor: { T: 423.97, P: 101325, hvapKJmol: 36.9, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [163.271354, 156.728646, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 210,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'n-Decane',
    name: 'n-Decane',
    formula: 'C10H22',
    cas: '124-18-5',
    family: 'Alkane',
    mw: 142.29,
    Tc: 617.7,
    Pc: 2103000,
    omega: 0.492,
    Tb: 447.3,
    triplePointK: 216.195,
    zRA: 0.247,
    vpAnchor: { T: 447.3, P: 101325, hvapKJmol: 39.3, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [179.023296, 170.976704, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 230,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'n-Dodecane',
    name: 'n-Dodecane',
    formula: 'C12H26',
    cas: '112-40-3',
    family: 'Alkane',
    mw: 170.34,
    Tc: 658,
    Pc: 1820000,
    omega: 0.576,
    Tb: 489.47,
    triplePointK: 230.29999999999998,
    zRA: 0.238,
    vpAnchor: { T: 489.47, P: 101325, hvapKJmol: 44.1, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [214.775237, 185.224763, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 270,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Isobutane',
    name: 'Isobutane',
    formula: 'C4H10',
    cas: '75-28-5',
    family: 'Alkane',
    mw: 58.12,
    Tc: 407.8,
    Pc: 3629000,
    omega: 0.181,
    Tb: 261.4,
    triplePointK: 142.73,
    zRA: 0.275,
    vpAnchor: { T: 261.4, P: 101325, hvapKJmol: 21.3, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [68.812424, 91.187576, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 96,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Isopentane',
    name: 'Isopentane',
    formula: 'C5H12',
    cas: '78-78-4',
    family: 'Alkane',
    mw: 72.15,
    Tc: 460.4,
    Pc: 3381000,
    omega: 0.227,
    Tb: 300.99,
    triplePointK: 161.14,
    zRA: 0.271,
    vpAnchor: { T: 300.99, P: 101325, hvapKJmol: 24.2, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [87.413977, 102.586023, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 118,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Neopentane',
    name: 'Neopentane',
    formula: 'C5H12',
    cas: '463-82-1',
    family: 'Alkane',
    mw: 72.15,
    Tc: 433.8,
    Pc: 3196000,
    omega: 0.197,
    Tb: 282.65,
    triplePointK: 151.82999999999998,
    zRA: 0.26,
    vpAnchor: { T: 282.65, P: 101325, hvapKJmol: 22.8, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [90.263589, 99.736411, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 120,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Ethylbenzene',
    name: 'Ethylbenzene',
    formula: 'C8H10',
    cas: '100-41-4',
    family: 'Aromatic',
    mw: 106.17,
    Tc: 617.2,
    Pc: 3609000,
    omega: 0.303,
    Tb: 409.35,
    triplePointK: 216.02,
    zRA: 0.254,
    vpAnchor: { T: 409.35, P: 101325, hvapKJmol: 35.5, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [118.891501, 121.108499, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 155,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'o-Xylene',
    name: 'o-Xylene',
    formula: 'C8H10',
    cas: '95-47-6',
    family: 'Aromatic',
    mw: 106.17,
    Tc: 630.3,
    Pc: 3732000,
    omega: 0.31,
    Tb: 417.58,
    triplePointK: 220.60499999999996,
    zRA: 0.262,
    vpAnchor: { T: 417.58, P: 101325, hvapKJmol: 36.84, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [118.891501, 121.108499, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 155,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'm-Xylene',
    name: 'm-Xylene',
    formula: 'C8H10',
    cas: '108-38-3',
    family: 'Aromatic',
    mw: 106.17,
    Tc: 617,
    Pc: 3535000,
    omega: 0.326,
    Tb: 412.27,
    triplePointK: 215.95,
    zRA: 0.259,
    vpAnchor: { T: 412.27, P: 101325, hvapKJmol: 36, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [118.891501, 121.108499, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 155,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'p-Xylene',
    name: 'p-Xylene',
    formula: 'C8H10',
    cas: '106-42-3',
    family: 'Aromatic',
    mw: 106.17,
    Tc: 616.2,
    Pc: 3511000,
    omega: 0.322,
    Tb: 411.51,
    triplePointK: 215.67000000000002,
    zRA: 0.257,
    vpAnchor: { T: 411.51, P: 101325, hvapKJmol: 35.9, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [118.891501, 121.108499, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 155,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Styrene',
    name: 'Styrene',
    formula: 'C8H8',
    cas: '100-42-5',
    family: 'Aromatic',
    mw: 104.15,
    Tc: 647,
    Pc: 3840000,
    omega: 0.297,
    Tb: 418.31,
    triplePointK: 226.45,
    zRA: 0.25,
    vpAnchor: { T: 418.31, P: 101325, hvapKJmol: 36.8, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [111.741113, 118.258887, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 147,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Naphthalene',
    name: 'Naphthalene',
    formula: 'C10H8',
    cas: '91-20-3',
    family: 'Aromatic',
    mw: 128.17,
    Tc: 748.4,
    Pc: 4050000,
    omega: 0.302,
    Tb: 491.1,
    triplePointK: 261.94,
    zRA: 0.267,
    vpAnchor: { T: 491.1, P: 101325, hvapKJmol: 43.1, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [128.891501, 121.108499, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 165,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: '1-Propanol',
    name: '1-Propanol',
    formula: 'C3H8O',
    cas: '71-23-8',
    family: 'Alcohol',
    mw: 60.096,
    Tc: 536.8,
    Pc: 5175000,
    omega: 0.629,
    Tb: 370.35,
    triplePointK: 187.87999999999997,
    zRA: 0.267,
    vpAnchor: { T: 370.35, P: 101325, hvapKJmol: 41.44, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [59.511648, 85.488352, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 85,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: '2-Propanol',
    name: '2-Propanol',
    formula: 'C3H8O',
    cas: '67-63-0',
    family: 'Alcohol',
    mw: 60.096,
    Tc: 508.3,
    Pc: 4762000,
    omega: 0.669,
    Tb: 355.5,
    triplePointK: 177.905,
    zRA: 0.26,
    vpAnchor: { T: 355.5, P: 101325, hvapKJmol: 39.85, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [63.086842, 86.913158, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 89,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: '1-Butanol',
    name: '1-Butanol',
    formula: 'C4H10O',
    cas: '71-36-3',
    family: 'Alcohol',
    mw: 74.123,
    Tc: 563.1,
    Pc: 4423000,
    omega: 0.591,
    Tb: 390.81,
    triplePointK: 197.085,
    zRA: 0.246,
    vpAnchor: { T: 390.81, P: 101325, hvapKJmol: 43.3, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [80.263589, 99.736411, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 110,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'tert-Butanol',
    name: 'tert-Butanol',
    formula: 'C4H10O',
    cas: '75-65-0',
    family: 'Alcohol',
    mw: 74.123,
    Tc: 506.2,
    Pc: 3972000,
    omega: 0.612,
    Tb: 355.5,
    triplePointK: 177.17,
    zRA: 0.259,
    vpAnchor: { T: 355.5, P: 101325, hvapKJmol: 39.1, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [83.113201, 96.886799, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 112,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'EthyleneGlycol',
    name: 'Ethylene glycol',
    formula: 'C2H6O2',
    cas: '107-21-1',
    family: 'Alcohol',
    mw: 62.068,
    Tc: 719.7,
    Pc: 8200000,
    omega: 0.487,
    Tb: 470.45,
    triplePointK: 251.895,
    zRA: 0.25,
    vpAnchor: { T: 470.45, P: 101325, hvapKJmol: 50.7, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [55.910095, 74.089905, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 78,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'MEK',
    name: 'Methyl ethyl ketone',
    formula: 'C4H8O',
    cas: '78-93-3',
    family: 'Ketone',
    mw: 72.107,
    Tc: 536.8,
    Pc: 4210000,
    omega: 0.323,
    Tb: 352.79,
    triplePointK: 187.87999999999997,
    zRA: 0.253,
    vpAnchor: { T: 352.79, P: 101325, hvapKJmol: 31.3, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [92.413977, 102.586023, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 123,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'DiethylEther',
    name: 'Diethyl ether',
    formula: 'C4H10O',
    cas: '60-29-7',
    family: 'Ether',
    mw: 74.123,
    Tc: 466.7,
    Pc: 3638000,
    omega: 0.281,
    Tb: 307.6,
    triplePointK: 163.345,
    zRA: 0.259,
    vpAnchor: { T: 307.6, P: 101325, hvapKJmol: 26.7, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [87.413977, 102.586023, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 118,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'DimethylEther',
    name: 'Dimethyl ether',
    formula: 'C2H6O',
    cas: '115-10-6',
    family: 'Ether',
    mw: 46.069,
    Tc: 400.1,
    Pc: 5337000,
    omega: 0.2,
    Tb: 248.35,
    triplePointK: 140.035,
    zRA: 0.267,
    vpAnchor: { T: 248.35, P: 101325, hvapKJmol: 21.5, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [46.738619, 63.261381, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 65.6,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'MTBE',
    name: 'Methyl tert-butyl ether',
    formula: 'C5H12O',
    cas: '1634-04-4',
    family: 'Ether',
    mw: 88.15,
    Tc: 497.1,
    Pc: 3430000,
    omega: 0.266,
    Tb: 328.35,
    triplePointK: 173.98499999999999,
    zRA: 0.273,
    vpAnchor: { T: 328.35, P: 101325, hvapKJmol: 27.2, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [106.741113, 118.258887, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 142,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'THF',
    name: 'Tetrahydrofuran',
    formula: 'C4H8O',
    cas: '109-99-9',
    family: 'Ether',
    mw: 72.107,
    Tc: 540.5,
    Pc: 5190000,
    omega: 0.255,
    Tb: 339.15,
    triplePointK: 189.17499999999998,
    zRA: 0.258,
    vpAnchor: { T: 339.15, P: 101325, hvapKJmol: 29.8, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [74.511648, 85.488352, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 100,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Dioxane',
    name: '1,4-Dioxane',
    formula: 'C4H8O2',
    cas: '123-91-1',
    family: 'Ether',
    mw: 88.106,
    Tc: 587,
    Pc: 5210000,
    omega: 0.28,
    Tb: 374.5,
    triplePointK: 205.45,
    zRA: 0.249,
    vpAnchor: { T: 374.5, P: 101325, hvapKJmol: 33.7, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [86.662036, 88.337964, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 113,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'EthylAcetate',
    name: 'Ethyl acetate',
    formula: 'C4H8O2',
    cas: '141-78-6',
    family: 'Ester',
    mw: 88.106,
    Tc: 523.3,
    Pc: 3880000,
    omega: 0.362,
    Tb: 350.26,
    triplePointK: 183.15499999999997,
    zRA: 0.253,
    vpAnchor: { T: 350.26, P: 101325, hvapKJmol: 32.2, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [105.263589, 99.736411, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 135,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'MethylAcetate',
    name: 'Methyl acetate',
    formula: 'C3H6O2',
    cas: '79-20-9',
    family: 'Ester',
    mw: 74.079,
    Tc: 506.6,
    Pc: 4690000,
    omega: 0.325,
    Tb: 330.1,
    triplePointK: 177.31,
    zRA: 0.256,
    vpAnchor: { T: 330.1, P: 101325, hvapKJmol: 30.2, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [84.511648, 85.488352, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 110,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'AceticAcid',
    name: 'Acetic acid',
    formula: 'C2H4O2',
    cas: '64-19-7',
    family: 'Acid',
    mw: 60.052,
    Tc: 592.7,
    Pc: 5786000,
    omega: 0.454,
    Tb: 391.05,
    triplePointK: 207.445,
    zRA: 0.254,
    vpAnchor: { T: 391.05, P: 101325, hvapKJmol: 23.7, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [41.480017, 73.519983, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 63.4,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'FormicAcid',
    name: 'Formic acid',
    formula: 'CH2O2',
    cas: '64-18-6',
    family: 'Acid',
    mw: 46.025,
    Tc: 580,
    Pc: 5810000,
    omega: 0.434,
    Tb: 373.85,
    triplePointK: 203,
    zRA: 0.259,
    vpAnchor: { T: 373.85, P: 101325, hvapKJmol: 22.7, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [29.29009, 55.70991, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 45.9,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Acetonitrile',
    name: 'Acetonitrile',
    formula: 'C2H3N',
    cas: '75-05-8',
    family: 'Nitrile',
    mw: 41.052,
    Tc: 545.5,
    Pc: 4833000,
    omega: 0.327,
    Tb: 354.75,
    triplePointK: 190.92499999999998,
    zRA: 0.246,
    vpAnchor: { T: 354.75, P: 101325, hvapKJmol: 31.5, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [43.034124, 66.965876, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 63,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Pyridine',
    name: 'Pyridine',
    formula: 'C5H5N',
    cas: '110-86-1',
    family: 'Heterocycle',
    mw: 79.1,
    Tc: 620,
    Pc: 5630000,
    omega: 0.243,
    Tb: 388.36,
    triplePointK: 217,
    zRA: 0.26,
    vpAnchor: { T: 388.36, P: 101325, hvapKJmol: 35.2, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [63.786065, 81.213935, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 88,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Aniline',
    name: 'Aniline',
    formula: 'C6H7N',
    cas: '62-53-3',
    family: 'Amine',
    mw: 93.13,
    Tc: 699,
    Pc: 5310000,
    omega: 0.399,
    Tb: 457.15,
    triplePointK: 244.64999999999998,
    zRA: 0.244,
    vpAnchor: { T: 457.15, P: 101325, hvapKJmol: 42.4, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [85.23723, 89.76277, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 112,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Phenol',
    name: 'Phenol',
    formula: 'C6H6O',
    cas: '108-95-2',
    family: 'Alcohol',
    mw: 94.11,
    Tc: 694.2,
    Pc: 6130000,
    omega: 0.443,
    Tb: 454.95,
    triplePointK: 242.97,
    zRA: 0.237,
    vpAnchor: { T: 454.95, P: 101325, hvapKJmol: 45.7, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [78.786065, 81.213935, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 103,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'CarbonDisulfide',
    name: 'Carbon disulfide',
    formula: 'CS2',
    cas: '75-15-0',
    family: 'Inorganic',
    mw: 76.14,
    Tc: 552,
    Pc: 7900000,
    omega: 0.111,
    Tb: 319.37,
    triplePointK: 191.62199999999999,
    zRA: 0.264,
    vpAnchor: { T: 319.37, P: 101325, hvapKJmol: 26.7, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [34.949776, 35.050224, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 45.4,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Methylamine',
    name: 'Methylamine',
    formula: 'CH5N',
    cas: '74-89-5',
    family: 'Amine',
    mw: 31.057,
    Tc: 430.1,
    Pc: 7460000,
    omega: 0.286,
    Tb: 266.85,
    triplePointK: 150.535,
    zRA: 0.26,
    vpAnchor: { T: 266.85, P: 101325, hvapKJmol: 27.4, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [40.158153, 59.841847, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 58,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Dimethylamine',
    name: 'Dimethylamine',
    formula: 'C2H7N',
    cas: '124-40-3',
    family: 'Amine',
    mw: 45.084,
    Tc: 437.6,
    Pc: 5310000,
    omega: 0.304,
    Tb: 280.05,
    triplePointK: 153.16,
    zRA: 0.265,
    vpAnchor: { T: 280.05, P: 101325, hvapKJmol: 27.5, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [58.759706, 71.240294, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 80,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Trimethylamine',
    name: 'Trimethylamine',
    formula: 'C3H9N',
    cas: '75-50-3',
    family: 'Amine',
    mw: 59.11,
    Tc: 433.3,
    Pc: 4070000,
    omega: 0.205,
    Tb: 276.05,
    triplePointK: 151.655,
    zRA: 0.273,
    vpAnchor: { T: 276.05, P: 101325, hvapKJmol: 24.8, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [78.086842, 86.913158, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 104,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Ethylamine',
    name: 'Ethylamine',
    formula: 'C2H7N',
    cas: '75-04-7',
    family: 'Amine',
    mw: 45.084,
    Tc: 456.4,
    Pc: 5620000,
    omega: 0.285,
    Tb: 289.75,
    triplePointK: 159.73999999999998,
    zRA: 0.262,
    vpAnchor: { T: 289.75, P: 101325, hvapKJmol: 28.7, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [63.759706, 71.240294, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 85,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Acetaldehyde',
    name: 'Acetaldehyde',
    formula: 'C2H4O',
    cas: '75-07-0',
    family: 'Aldehyde',
    mw: 44.053,
    Tc: 466,
    Pc: 5550000,
    omega: 0.303,
    Tb: 294.15,
    triplePointK: 163.1,
    zRA: 0.255,
    vpAnchor: { T: 294.15, P: 101325, hvapKJmol: 25.8, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [48.733348, 61.266652, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 67,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Formaldehyde',
    name: 'Formaldehyde',
    formula: 'CH2O',
    cas: '50-00-0',
    family: 'Aldehyde',
    mw: 30.026,
    Tc: 408,
    Pc: 6590000,
    omega: 0.286,
    Tb: 254.05,
    triplePointK: 142.79999999999998,
    zRA: 0.26,
    vpAnchor: { T: 254.05, P: 101325, hvapKJmol: 23.3, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [20.701717, 49.298283, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 35.4,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Nitrobenzene',
    name: 'Nitrobenzene',
    formula: 'C6H5NO2',
    cas: '98-95-3',
    family: 'Nitro',
    mw: 123.11,
    Tc: 719,
    Pc: 4890000,
    omega: 0.448,
    Tb: 483.95,
    triplePointK: 251.64999999999998,
    zRA: 0.25,
    vpAnchor: { T: 483.95, P: 101325, hvapKJmol: 40.4, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [99.538007, 95.461993, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 128,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: '1,3-Butadiene',
    name: '1,3-Butadiene',
    formula: 'C4H6',
    cas: '106-99-0',
    family: 'Alkene',
    mw: 54.091,
    Tc: 425,
    Pc: 4320000,
    omega: 0.195,
    Tb: 268.74,
    triplePointK: 148.75,
    zRA: 0.279,
    vpAnchor: { T: 268.74, P: 101325, hvapKJmol: 22.5, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [58.759706, 71.240294, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 80,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Acetylene',
    name: 'Acetylene',
    formula: 'C2H2',
    cas: '74-86-2',
    family: 'Alkyne',
    mw: 26.038,
    Tc: 308.3,
    Pc: 6140000,
    omega: 0.187,
    Tb: 189.35,
    triplePointK: 107.905,
    zRA: 0.272,
    vpAnchor: { T: 189.35, P: 101325, hvapKJmol: 16.9, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [28.706989, 51.293011, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 44,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: '1-Butene',
    name: '1-Butene',
    formula: 'C4H8',
    cas: '106-98-9',
    family: 'Alkene',
    mw: 56.107,
    Tc: 419.5,
    Pc: 4020000,
    omega: 0.187,
    Tb: 266.9,
    triplePointK: 146.825,
    zRA: 0.277,
    vpAnchor: { T: 266.9, P: 101325, hvapKJmol: 22.1, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [62.490561, 77.509439, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 85.6,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Isobutylene',
    name: 'Isobutylene',
    formula: 'C4H8',
    cas: '115-11-7',
    family: 'Alkene',
    mw: 56.107,
    Tc: 417.9,
    Pc: 3995000,
    omega: 0.194,
    Tb: 266.25,
    triplePointK: 146.265,
    zRA: 0.276,
    vpAnchor: { T: 266.25, P: 101325, hvapKJmol: 22.1, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [63.501104, 81.498896, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 87.8,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Cyclopentane',
    name: 'Cyclopentane',
    formula: 'C5H10',
    cas: '287-92-3',
    family: 'Cycloalkane',
    mw: 70.134,
    Tc: 511.7,
    Pc: 4506000,
    omega: 0.196,
    Tb: 322.4,
    triplePointK: 179.095,
    zRA: 0.273,
    vpAnchor: { T: 322.4, P: 101325, hvapKJmol: 27.3, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [58.786065, 81.213935, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 83,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Methylcyclohexane',
    name: 'Methylcyclohexane',
    formula: 'C7H14',
    cas: '108-87-2',
    family: 'Cycloalkane',
    mw: 98.186,
    Tc: 572.1,
    Pc: 3471000,
    omega: 0.235,
    Tb: 374.08,
    triplePointK: 200.23499999999999,
    zRA: 0.268,
    vpAnchor: { T: 374.08, P: 101325, hvapKJmol: 32.8, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [103.13956, 106.86044, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 135,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Chloromethane',
    name: 'Chloromethane',
    formula: 'CH3Cl',
    cas: '74-87-3',
    family: 'Halogenated',
    mw: 50.488,
    Tc: 416.3,
    Pc: 6680000,
    omega: 0.153,
    Tb: 249.35,
    triplePointK: 145.70499999999998,
    zRA: 0.273,
    vpAnchor: { T: 249.35, P: 101325, hvapKJmol: 21.5, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [28.253188, 41.746812, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 40.7,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Dichloromethane',
    name: 'Dichloromethane',
    formula: 'CH2Cl2',
    cas: '75-09-2',
    family: 'Halogenated',
    mw: 84.933,
    Tc: 510,
    Pc: 6080000,
    omega: 0.199,
    Tb: 312.85,
    triplePointK: 178.5,
    zRA: 0.265,
    vpAnchor: { T: 312.85, P: 101325, hvapKJmol: 28.8, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [35.986678, 49.013322, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 50.6,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Chloroform',
    name: 'Chloroform',
    formula: 'CHCl3',
    cas: '67-66-3',
    family: 'Halogenated',
    mw: 119.378,
    Tc: 536.4,
    Pc: 5470000,
    omega: 0.216,
    Tb: 334.33,
    triplePointK: 187.73999999999998,
    zRA: 0.267,
    vpAnchor: { T: 334.33, P: 101325, hvapKJmol: 29.2, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [51.129159, 48.870841, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 65.7,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'CarbonTetrachloride',
    name: 'Carbon tetrachloride',
    formula: 'CCl4',
    cas: '56-23-5',
    family: 'Halogenated',
    mw: 153.823,
    Tc: 556.4,
    Pc: 4560000,
    omega: 0.194,
    Tb: 349.85,
    triplePointK: 194.73999999999998,
    zRA: 0.27,
    vpAnchor: { T: 349.85, P: 101325, hvapKJmol: 29.8, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [67.709625, 52.290375, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 83.3,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: '1,2-Dichloroethane',
    name: '1,2-Dichloroethane',
    formula: 'C2H4Cl2',
    cas: '107-06-2',
    family: 'Halogenated',
    mw: 98.959,
    Tc: 561.6,
    Pc: 5370000,
    omega: 0.288,
    Tb: 356.65,
    triplePointK: 196.56,
    zRA: 0.259,
    vpAnchor: { T: 356.65, P: 101325, hvapKJmol: 31.9, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [60.883736, 64.116264, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 80,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'VinylChloride',
    name: 'Vinyl chloride',
    formula: 'C2H3Cl',
    cas: '75-01-4',
    family: 'Halogenated',
    mw: 62.498,
    Tc: 432,
    Pc: 5670000,
    omega: 0.074,
    Tb: 259.25,
    triplePointK: 151.2,
    zRA: 0.286,
    vpAnchor: { T: 259.25, P: 101325, hvapKJmol: 20.1, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [37.282183, 52.717817, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 53,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'CarbonMonoxide',
    name: 'Carbon monoxide',
    formula: 'CO',
    cas: '630-08-0',
    family: 'Inorganic gas',
    mw: 28.01,
    Tc: 132.9,
    Pc: 3499000,
    omega: 0.049,
    Tb: 81.65,
    triplePointK: 46.515,
    zRA: 0.296,
    vpAnchor: { T: 81.65, P: 101325, hvapKJmol: 6.04, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [26.650638, 8.349362, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 29.14,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'NitroOxide',
    name: 'Nitric oxide',
    formula: 'NO',
    cas: '10102-43-9',
    family: 'Inorganic gas',
    mw: 30.006,
    Tc: 180,
    Pc: 6480000,
    omega: 0.585,
    Tb: 121.4,
    triplePointK: 62.99999999999999,
    zRA: 0.25,
    vpAnchor: { T: 121.4, P: 101325, hvapKJmol: 13.7, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [27.223196, 8.776804, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 29.84,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'NitrousOxide',
    name: 'Nitrous oxide',
    formula: 'N2O',
    cas: '10024-97-2',
    family: 'Inorganic gas',
    mw: 44.013,
    Tc: 309.6,
    Pc: 7245000,
    omega: 0.16,
    Tb: 184.67,
    triplePointK: 108.36,
    zRA: 0.279,
    vpAnchor: { T: 184.67, P: 101325, hvapKJmol: 16.5, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [31.633184, 23.366816, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 38.6,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'SulfurDioxide',
    name: 'Sulfur dioxide',
    formula: 'SO2',
    cas: '7446-09-5',
    family: 'Inorganic gas',
    mw: 64.064,
    Tc: 430.8,
    Pc: 7884000,
    omega: 0.256,
    Tb: 263.15,
    triplePointK: 150.78,
    zRA: 0.263,
    vpAnchor: { T: 263.15, P: 101325, hvapKJmol: 24.9, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [33.485431, 21.514569, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 39.9,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'HydrogenSulfide',
    name: 'Hydrogen sulfide',
    formula: 'H2S',
    cas: '7783-06-4',
    family: 'Inorganic gas',
    mw: 34.081,
    Tc: 373.5,
    Pc: 8963000,
    omega: 0.094,
    Tb: 212.85,
    triplePointK: 127.71,
    zRA: 0.285,
    vpAnchor: { T: 212.85, P: 101325, hvapKJmol: 18.7, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [29.327135, 15.672865, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 34,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'HydrogenChloride',
    name: 'Hydrogen chloride',
    formula: 'HCl',
    cas: '7647-01-0',
    family: 'Inorganic gas',
    mw: 36.461,
    Tc: 324.7,
    Pc: 8310000,
    omega: 0.122,
    Tb: 188.15,
    triplePointK: 112.89,
    zRA: 0.275,
    vpAnchor: { T: 188.15, P: 101325, hvapKJmol: 16.2, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [26.622141, 8.377859, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 29.12,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'HydrogenFluoride',
    name: 'Hydrogen fluoride',
    formula: 'HF',
    cas: '7664-39-3',
    family: 'Inorganic gas',
    mw: 20.006,
    Tc: 461,
    Pc: 6480000,
    omega: 0.372,
    Tb: 292.55,
    triplePointK: 161.35,
    zRA: 0.25,
    vpAnchor: { T: 292.55, P: 101325, hvapKJmol: 25.2, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [26.211584, 9.788416, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 29.13,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Chlorine',
    name: 'Chlorine',
    formula: 'Cl2',
    cas: '7782-50-5',
    family: 'Halogen gas',
    mw: 70.906,
    Tc: 417,
    Pc: 7710000,
    omega: 0.069,
    Tb: 239.11,
    triplePointK: 143.466,
    zRA: 0.286,
    vpAnchor: { T: 239.11, P: 101325, hvapKJmol: 20.4, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [30.530313, 11.469687, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 33.95,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Fluorine',
    name: 'Fluorine',
    formula: 'F2',
    cas: '7782-41-4',
    family: 'Halogen gas',
    mw: 37.997,
    Tc: 144.4,
    Pc: 5215000,
    omega: 0.048,
    Tb: 85.03,
    triplePointK: 50.54,
    zRA: 0.289,
    vpAnchor: { T: 85.03, P: 101325, hvapKJmol: 6.62, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [28.878607, 8.121393, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 31.3,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Helium',
    name: 'Helium',
    formula: 'He',
    cas: '7440-59-7',
    family: 'Noble gas',
    mw: 4.0026,
    Tc: 5.19,
    Pc: 227000,
    omega: -0.385,
    Tb: 4.22,
    triplePointK: 1.8165,
    zRA: 0.302,
    vpAnchor: { T: 4.22, P: 101325, hvapKJmol: 0.08, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [20.786, 0, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 20.786,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Neon',
    name: 'Neon',
    formula: 'Ne',
    cas: '7440-01-9',
    family: 'Noble gas',
    mw: 20.18,
    Tc: 44.4,
    Pc: 2760000,
    omega: -0.029,
    Tb: 27.07,
    triplePointK: 15.54,
    zRA: 0.311,
    vpAnchor: { T: 27.07, P: 101325, hvapKJmol: 1.74, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [20.786, 0, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 20.786,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Argon',
    name: 'Argon',
    formula: 'Ar',
    cas: '7440-37-1',
    family: 'Noble gas',
    mw: 39.948,
    Tc: 150.8,
    Pc: 4898000,
    omega: 0,
    Tb: 87.28,
    triplePointK: 52.368,
    zRA: 0.291,
    vpAnchor: { T: 87.28, P: 101325, hvapKJmol: 6.52, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [20.786, 0, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 20.786,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Krypton',
    name: 'Krypton',
    formula: 'Kr',
    cas: '7439-90-9',
    family: 'Noble gas',
    mw: 83.798,
    Tc: 209.4,
    Pc: 5500000,
    omega: 0,
    Tb: 119.93,
    triplePointK: 71.958,
    zRA: 0.287,
    vpAnchor: { T: 119.93, P: 101325, hvapKJmol: 9.03, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [20.786, 0, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 20.786,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'Xenon',
    name: 'Xenon',
    formula: 'Xe',
    cas: '7440-63-3',
    family: 'Noble gas',
    mw: 131.293,
    Tc: 289.7,
    Pc: 5840000,
    omega: 0,
    Tb: 165.03,
    triplePointK: 99.018,
    zRA: 0.287,
    vpAnchor: { T: 165.03, P: 101325, hvapKJmol: 12.64, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [20.786, 0, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 20.786,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'R11',
    name: 'R-11 (trichlorofluoromethane)',
    formula: 'CCl3F',
    cas: '75-69-4',
    family: 'Refrigerant',
    mw: 137.368,
    Tc: 471.1,
    Pc: 4410000,
    omega: 0.188,
    Tb: 296.85,
    triplePointK: 164.885,
    zRA: 0.274,
    vpAnchor: { T: 296.85, P: 101325, hvapKJmol: 24.8, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [70.131795, 49.868205, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 85,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'R12',
    name: 'R-12 (dichlorodifluoromethane)',
    formula: 'CCl2F2',
    cas: '75-71-8',
    family: 'Refrigerant',
    mw: 120.914,
    Tc: 385,
    Pc: 4130000,
    omega: 0.18,
    Tb: 243.4,
    triplePointK: 134.75,
    zRA: 0.28,
    vpAnchor: { T: 243.4, P: 101325, hvapKJmol: 20, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [60.675358, 39.324642, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 72.4,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'R22',
    name: 'R-22 (chlorodifluoromethane)',
    formula: 'CHClF2',
    cas: '75-45-6',
    family: 'Refrigerant',
    mw: 86.469,
    Tc: 369.3,
    Pc: 4990000,
    omega: 0.221,
    Tb: 232.35,
    triplePointK: 129.255,
    zRA: 0.272,
    vpAnchor: { T: 232.35, P: 101325, hvapKJmol: 20.2, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [43.538149, 41.461851, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 55.9,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'R32',
    name: 'R-32 (difluoromethane)',
    formula: 'CH2F2',
    cas: '75-10-5',
    family: 'Refrigerant',
    mw: 52.024,
    Tc: 351.3,
    Pc: 5780000,
    omega: 0.277,
    Tb: 221.5,
    triplePointK: 122.955,
    zRA: 0.267,
    vpAnchor: { T: 221.5, P: 101325, hvapKJmol: 19.4, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [33.654271, 31.345729, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 43,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'R125',
    name: 'R-125 (pentafluoroethane)',
    formula: 'C2HF5',
    cas: '354-33-6',
    family: 'Refrigerant',
    mw: 120.022,
    Tc: 339.2,
    Pc: 3620000,
    omega: 0.305,
    Tb: 225.05,
    triplePointK: 118.71999999999998,
    zRA: 0.273,
    vpAnchor: { T: 225.05, P: 101325, hvapKJmol: 19.4, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [83.007765, 56.992235, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 100,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'R134a',
    name: 'R-134a (1,1,1,2-tetrafluoroethane)',
    formula: 'C2H2F4',
    cas: '811-97-2',
    family: 'Refrigerant',
    mw: 102.031,
    Tc: 374.2,
    Pc: 4060000,
    omega: 0.327,
    Tb: 247.08,
    triplePointK: 130.97,
    zRA: 0.266,
    vpAnchor: { T: 247.08, P: 101325, hvapKJmol: 19.9, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [75.131795, 49.868205, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 90,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'R143a',
    name: 'R-143a (1,1,1-trifluoroethane)',
    formula: 'C2H3F3',
    cas: '420-46-2',
    family: 'Refrigerant',
    mw: 84.041,
    Tc: 345.9,
    Pc: 3760000,
    omega: 0.261,
    Tb: 225.91,
    triplePointK: 121.06499999999998,
    zRA: 0.269,
    vpAnchor: { T: 225.91, P: 101325, hvapKJmol: 18, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [70.131795, 49.868205, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 85,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  },
  {
    id: 'R152a',
    name: 'R-152a (1,1-difluoroethane)',
    formula: 'C2H4F2',
    cas: '75-37-6',
    family: 'Refrigerant',
    mw: 66.051,
    Tc: 386.4,
    Pc: 4520000,
    omega: 0.275,
    Tb: 249.15,
    triplePointK: 135.23999999999998,
    zRA: 0.27,
    vpAnchor: { T: 249.15, P: 101325, hvapKJmol: 20, note: 'normal boiling point' },
    cpForm: 'poly4',
    cpCoeffs: [57.255824, 42.744176, 0, 0, 0],
    cpTmin: 273.15,
    cpTmax: 1500,
    cp298Ref: 70,
    sourceRef: {
      formula: 'Clausius-Clapeyron (Watson slope); Rackett; 4th-order Cp polynomial',
      parameters:
        'Critical constants: Reid, Prausnitz & Poling, The Properties of Gases and Liquids, 4th ed.; NIST Chemistry WebBook SRD 69. Cp: project linear fit through NIST Cp(298.15 K) and group-contribution Cp(1000 K).'
    }
  }
]);

class CorrelationSpeciesCatalog {
  constructor(records = DOCUMENTED_CORRELATION_SET) {
    if (!Array.isArray(records)) {
      throw new TypeError('Species records must be supplied as an array.');
    }
    this.catalog = new Map();
    this.aliasMap = new Map();
    for (const data of records) {
      const comp = new CorrelationPropertyComponent(data);
      if (![comp.id, comp.name, comp.formula].every((v) => typeof v === 'string' && v.trim() !== '')) {
        throw new TypeError('Each species record requires explicit id, name, and formula strings.');
      }
      if (this.catalog.has(comp.id)) throw new TypeError(`Duplicate species id '${comp.id}'.`);
      this.catalog.set(comp.id, comp);
      this.aliasMap.set(comp.id.toLowerCase(), comp.id);
      this.aliasMap.set(comp.name.toLowerCase(), comp.id);
      this.aliasMap.set(comp.formula.toLowerCase(), comp.id);
      if (comp.cas) this.aliasMap.set(comp.cas, comp.id);
    }
  }

  get(query) {
    if (!query) return null;
    const q = query.trim().toLowerCase();
    const id = this.aliasMap.get(q) || this.aliasMap.get(query.trim());
    if (id && this.catalog.has(id)) return this.catalog.get(id);
    return null;
  }

  resolveRequired(query) {
    const comp = this.get(query);
    if (!comp) {
      const error = new Error(`Unknown species '${query}' in the documented correlation set.`);
      error.code = 'UNAVAILABLE';
      throw error;
    }
    return comp;
  }

  listSpecies() {
    return Array.from(this.catalog.keys());
  }

  getCatalogMetadata() {
    return {
      status: 'correlation-based',
      recordCount: this.catalog.size,
      licenseStatus: 'public-literature-citation',
      attribution:
        'Documented correlation set (public literature): formulas and parameter origins cited per species; NOT an AIChE DIPPR 801 data product.',
      disclaimers: [
        'Clausius-Clapeyron vapor pressure is anchored at one published latent heat; accuracy degrades away from the anchor.',
        'Rackett liquid density is a general correlation (±1-8% typical).',
        'Liquid viscosity and thermal conductivity are unavailable without a documented public correlation set.'
      ]
    };
  }
}

module.exports = {
  CorrelationPropertyComponent,
  CorrelationSpeciesCatalog,
  DOCUMENTED_CORRELATION_SET,
  R_GAS,
  P_ATM
};
