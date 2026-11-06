'use strict';

const { OmniError, OmniErrorCode } = require('./OmniError');

/**
 * Standard 7-dimensional SI exponent indices:
 * [0] Mass (M) - kg
 * [1] Length (L) - m
 * [2] Time (T) - s
 * [3] Electric Current (I) - A
 * [4] Thermodynamic Temperature (Theta) - K
 * [5] Amount of Substance (N) - mol
 * [6] Luminous Intensity (J) - cd
 */
const Dimensions = Object.freeze({
  DIMENSIONLESS: Object.freeze([0, 0, 0, 0, 0, 0, 0]),
  MASS: Object.freeze([1, 0, 0, 0, 0, 0, 0]),
  LENGTH: Object.freeze([0, 1, 0, 0, 0, 0, 0]),
  TIME: Object.freeze([0, 0, 1, 0, 0, 0, 0]),
  CURRENT: Object.freeze([0, 0, 0, 1, 0, 0, 0]),
  TEMPERATURE: Object.freeze([0, 0, 0, 0, 1, 0, 0]),
  AMOUNT: Object.freeze([0, 0, 0, 0, 0, 1, 0]),
  LUMINOUS_INTENSITY: Object.freeze([0, 0, 0, 0, 0, 0, 1]),

  // Common derived dimensions
  AREA: Object.freeze([0, 2, 0, 0, 0, 0, 0]),
  VOLUME: Object.freeze([0, 3, 0, 0, 0, 0, 0]),
  VELOCITY: Object.freeze([0, 1, -1, 0, 0, 0, 0]),
  ACCELERATION: Object.freeze([0, 1, -2, 0, 0, 0, 0]),
  FORCE: Object.freeze([1, 1, -2, 0, 0, 0, 0]),
  PRESSURE: Object.freeze([1, -1, -2, 0, 0, 0, 0]), // Stress / Pressure (Pa)
  ENERGY: Object.freeze([1, 2, -2, 0, 0, 0, 0]), // Energy / Work (J)
  POWER: Object.freeze([1, 2, -3, 0, 0, 0, 0]), // Power (W)
  DENSITY: Object.freeze([1, -3, 0, 0, 0, 0, 0]),
  DYNAMIC_VISCOSITY: Object.freeze([1, -1, -1, 0, 0, 0, 0]), // Pa.s
  KINEMATIC_VISCOSITY: Object.freeze([0, 2, -1, 0, 0, 0, 0]), // m2/s
  FREQUENCY: Object.freeze([0, 0, -1, 0, 0, 0, 0]), // Hz
  VOLTAGE: Object.freeze([1, 2, -3, -1, 0, 0, 0]), // V
  RESISTANCE: Object.freeze([1, 2, -3, -2, 0, 0, 0]), // Ohm
  CAPACITANCE: Object.freeze([-1, -2, 4, 2, 0, 0, 0]), // F
  INDUCTANCE: Object.freeze([1, 2, -2, -2, 0, 0, 0]), // H
  MAGNETIC_FLUX_DENSITY: Object.freeze([1, 0, -2, -1, 0, 0, 0]) // T
});

/**
 * Known unit conversion factors to SI base units.
 * scale: multiplier to get SI base value
 * offset: added to value before scale (or subtracted after inverse)
 */
const UnitRegistry = {
  // Dimensionless
  '': { dim: Dimensions.DIMENSIONLESS, scale: 1, offset: 0 },
  1: { dim: Dimensions.DIMENSIONLESS, scale: 1, offset: 0 },
  '%': { dim: Dimensions.DIMENSIONLESS, scale: 0.01, offset: 0 },
  ppm: { dim: Dimensions.DIMENSIONLESS, scale: 1e-6, offset: 0 },
  rad: { dim: Dimensions.DIMENSIONLESS, scale: 1, offset: 0 },
  deg: { dim: Dimensions.DIMENSIONLESS, scale: Math.PI / 180, offset: 0 },
  arcmin: { dim: Dimensions.DIMENSIONLESS, scale: Math.PI / 10800, offset: 0 },
  arcsec: { dim: Dimensions.DIMENSIONLESS, scale: Math.PI / 648000, offset: 0 },
  rev: { dim: Dimensions.DIMENSIONLESS, scale: 2 * Math.PI, offset: 0 },

  // Length [m]
  m: { dim: Dimensions.LENGTH, scale: 1, offset: 0 },
  mm: { dim: Dimensions.LENGTH, scale: 1e-3, offset: 0 },
  cm: { dim: Dimensions.LENGTH, scale: 1e-2, offset: 0 },
  km: { dim: Dimensions.LENGTH, scale: 1e3, offset: 0 },
  um: { dim: Dimensions.LENGTH, scale: 1e-6, offset: 0 },
  nm: { dim: Dimensions.LENGTH, scale: 1e-9, offset: 0 },
  in: { dim: Dimensions.LENGTH, scale: 0.0254, offset: 0 },
  ft: { dim: Dimensions.LENGTH, scale: 0.3048, offset: 0 },
  yd: { dim: Dimensions.LENGTH, scale: 0.9144, offset: 0 },
  mi: { dim: Dimensions.LENGTH, scale: 1609.344, offset: 0 },
  mil: { dim: Dimensions.LENGTH, scale: 2.54e-5, offset: 0 },

  // Area [m2]
  m2: { dim: Dimensions.AREA, scale: 1, offset: 0 },
  mm2: { dim: Dimensions.AREA, scale: 1e-6, offset: 0 },
  cm2: { dim: Dimensions.AREA, scale: 1e-4, offset: 0 },
  in2: { dim: Dimensions.AREA, scale: 0.00064516, offset: 0 },
  ft2: { dim: Dimensions.AREA, scale: 0.09290304, offset: 0 },

  // Volume [m3]
  m3: { dim: Dimensions.VOLUME, scale: 1, offset: 0 },
  mm3: { dim: Dimensions.VOLUME, scale: 1e-9, offset: 0 },
  cm3: { dim: Dimensions.VOLUME, scale: 1e-6, offset: 0 },
  L: { dim: Dimensions.VOLUME, scale: 1e-3, offset: 0 },
  mL: { dim: Dimensions.VOLUME, scale: 1e-6, offset: 0 },
  in3: { dim: Dimensions.VOLUME, scale: 1.6387064e-5, offset: 0 },
  ft3: { dim: Dimensions.VOLUME, scale: 0.028316846592, offset: 0 },
  gal: { dim: Dimensions.VOLUME, scale: 0.003785411784, offset: 0 },

  // Mass [kg]
  kg: { dim: Dimensions.MASS, scale: 1, offset: 0 },
  g: { dim: Dimensions.MASS, scale: 1e-3, offset: 0 },
  mg: { dim: Dimensions.MASS, scale: 1e-6, offset: 0 },
  tonne: { dim: Dimensions.MASS, scale: 1e3, offset: 0 },
  lb: { dim: Dimensions.MASS, scale: 0.45359237, offset: 0 },
  oz: { dim: Dimensions.MASS, scale: 0.028349523125, offset: 0 },
  slug: { dim: Dimensions.MASS, scale: 14.5939029, offset: 0 },

  // Time [s]
  s: { dim: Dimensions.TIME, scale: 1, offset: 0 },
  ms: { dim: Dimensions.TIME, scale: 1e-3, offset: 0 },
  us: { dim: Dimensions.TIME, scale: 1e-6, offset: 0 },
  ns: { dim: Dimensions.TIME, scale: 1e-9, offset: 0 },
  min: { dim: Dimensions.TIME, scale: 60, offset: 0 },
  h: { dim: Dimensions.TIME, scale: 3600, offset: 0 },
  day: { dim: Dimensions.TIME, scale: 86400, offset: 0 },

  // Frequency [Hz = 1/s]
  Hz: { dim: Dimensions.FREQUENCY, scale: 1, offset: 0 },
  kHz: { dim: Dimensions.FREQUENCY, scale: 1e3, offset: 0 },
  MHz: { dim: Dimensions.FREQUENCY, scale: 1e6, offset: 0 },
  GHz: { dim: Dimensions.FREQUENCY, scale: 1e9, offset: 0 },
  rpm: { dim: Dimensions.FREQUENCY, scale: 1 / 60, offset: 0 },

  // Force [N]
  N: { dim: Dimensions.FORCE, scale: 1, offset: 0 },
  kN: { dim: Dimensions.FORCE, scale: 1e3, offset: 0 },
  mN: { dim: Dimensions.FORCE, scale: 1e-3, offset: 0 },
  lbf: { dim: Dimensions.FORCE, scale: 4.4482216152605, offset: 0 },
  dyne: { dim: Dimensions.FORCE, scale: 1e-5, offset: 0 },

  // Pressure & Stress [Pa]
  Pa: { dim: Dimensions.PRESSURE, scale: 1, offset: 0 },
  kPa: { dim: Dimensions.PRESSURE, scale: 1e3, offset: 0 },
  MPa: { dim: Dimensions.PRESSURE, scale: 1e6, offset: 0 },
  GPa: { dim: Dimensions.PRESSURE, scale: 1e9, offset: 0 },
  bar: { dim: Dimensions.PRESSURE, scale: 1e5, offset: 0 },
  mbar: { dim: Dimensions.PRESSURE, scale: 100, offset: 0 },
  psi: { dim: Dimensions.PRESSURE, scale: 6894.757293168, offset: 0 },
  ksi: { dim: Dimensions.PRESSURE, scale: 6894757.293168, offset: 0 },
  atm: { dim: Dimensions.PRESSURE, scale: 101325, offset: 0 },
  torr: { dim: Dimensions.PRESSURE, scale: 133.322368421, offset: 0 },

  // Energy & Work [J]
  J: { dim: Dimensions.ENERGY, scale: 1, offset: 0 },
  kJ: { dim: Dimensions.ENERGY, scale: 1e3, offset: 0 },
  MJ: { dim: Dimensions.ENERGY, scale: 1e6, offset: 0 },
  cal: { dim: Dimensions.ENERGY, scale: 4.184, offset: 0 },
  kcal: { dim: Dimensions.ENERGY, scale: 4184, offset: 0 },
  BTU: { dim: Dimensions.ENERGY, scale: 1055.05585, offset: 0 },
  kWh: { dim: Dimensions.ENERGY, scale: 3.6e6, offset: 0 },
  eV: { dim: Dimensions.ENERGY, scale: 1.602176634e-19, offset: 0 },

  // Power [W]
  W: { dim: Dimensions.POWER, scale: 1, offset: 0 },
  kW: { dim: Dimensions.POWER, scale: 1e3, offset: 0 },
  MW: { dim: Dimensions.POWER, scale: 1e6, offset: 0 },
  hp: { dim: Dimensions.POWER, scale: 745.69987158227, offset: 0 },

  // Temperature [K]
  K: { dim: Dimensions.TEMPERATURE, scale: 1, offset: 0 },
  degC: { dim: Dimensions.TEMPERATURE, scale: 1, offset: 273.15 },
  degF: { dim: Dimensions.TEMPERATURE, scale: 5 / 9, offset: 459.67 },
  degR: { dim: Dimensions.TEMPERATURE, scale: 5 / 9, offset: 0 },

  // Velocity [m/s]
  'm/s': { dim: Dimensions.VELOCITY, scale: 1, offset: 0 },
  'km/h': { dim: Dimensions.VELOCITY, scale: 1 / 3.6, offset: 0 },
  'ft/s': { dim: Dimensions.VELOCITY, scale: 0.3048, offset: 0 },
  mph: { dim: Dimensions.VELOCITY, scale: 0.44704, offset: 0 },
  knot: { dim: Dimensions.VELOCITY, scale: 0.514444444444, offset: 0 },

  // Acceleration [m/s2]
  'm/s2': { dim: Dimensions.ACCELERATION, scale: 1, offset: 0 },
  'ft/s2': { dim: Dimensions.ACCELERATION, scale: 0.3048, offset: 0 },
  g0: { dim: Dimensions.ACCELERATION, scale: 9.80665, offset: 0 },

  // Density [kg/m3]
  'kg/m3': { dim: Dimensions.DENSITY, scale: 1, offset: 0 },
  'g/cm3': { dim: Dimensions.DENSITY, scale: 1000, offset: 0 },
  'lb/ft3': { dim: Dimensions.DENSITY, scale: 16.018463, offset: 0 },

  // Viscosity
  'Pa.s': { dim: Dimensions.DYNAMIC_VISCOSITY, scale: 1, offset: 0 },
  cP: { dim: Dimensions.DYNAMIC_VISCOSITY, scale: 1e-3, offset: 0 },
  'm2/s': { dim: Dimensions.KINEMATIC_VISCOSITY, scale: 1, offset: 0 },
  cSt: { dim: Dimensions.KINEMATIC_VISCOSITY, scale: 1e-6, offset: 0 },

  // Electrical
  A: { dim: Dimensions.CURRENT, scale: 1, offset: 0 },
  mA: { dim: Dimensions.CURRENT, scale: 1e-3, offset: 0 },
  uA: { dim: Dimensions.CURRENT, scale: 1e-6, offset: 0 },
  V: { dim: Dimensions.VOLTAGE, scale: 1, offset: 0 },
  mV: { dim: Dimensions.VOLTAGE, scale: 1e-3, offset: 0 },
  kV: { dim: Dimensions.VOLTAGE, scale: 1e3, offset: 0 },
  Ohm: { dim: Dimensions.RESISTANCE, scale: 1, offset: 0 },
  kOhm: { dim: Dimensions.RESISTANCE, scale: 1e3, offset: 0 },
  MOhm: { dim: Dimensions.RESISTANCE, scale: 1e6, offset: 0 },
  F: { dim: Dimensions.CAPACITANCE, scale: 1, offset: 0 },
  uF: { dim: Dimensions.CAPACITANCE, scale: 1e-6, offset: 0 },
  nF: { dim: Dimensions.CAPACITANCE, scale: 1e-9, offset: 0 },
  pF: { dim: Dimensions.CAPACITANCE, scale: 1e-12, offset: 0 },
  H: { dim: Dimensions.INDUCTANCE, scale: 1, offset: 0 },
  mH: { dim: Dimensions.INDUCTANCE, scale: 1e-3, offset: 0 },
  uH: { dim: Dimensions.INDUCTANCE, scale: 1e-6, offset: 0 },
  T: { dim: Dimensions.MAGNETIC_FLUX_DENSITY, scale: 1, offset: 0 }
};

/**
 * Checks equality between two 7-element dimension arrays.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {boolean}
 */
function dimensionsEqual(a, b) {
  if (!a || !b || a.length !== 7 || b.length !== 7) return false;
  for (let i = 0; i < 7; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Immutable Quantity representing a physical value, display unit, dimensions, and uncertainty.
 */
class Quantity {
  /**
   * @param {number} valueSi - Value in SI base units
   * @param {string} displayUnit - Preferred display unit
   * @param {number[]} dimension - 7-element SI dimension array
   * @param {number} [uncertaintySi=0] - Absolute uncertainty in SI base units
   */
  constructor(valueSi, displayUnit, dimension, uncertaintySi = 0) {
    if (typeof valueSi !== 'number' || !Number.isFinite(valueSi)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Quantity value must be a finite number: ${valueSi}`);
    }
    if (typeof uncertaintySi !== 'number' || !Number.isFinite(uncertaintySi) || uncertaintySi < 0) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        `Quantity uncertainty must be a non-negative finite number: ${uncertaintySi}`
      );
    }
    if (!Array.isArray(dimension) || dimension.length !== 7) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        'Quantity dimension must be a 7-element array [M, L, T, I, Theta, N, J]'
      );
    }

    this._valueSi = valueSi;
    this._displayUnit = String(displayUnit || '');
    this._dimension = Object.freeze([...dimension]);
    this._uncertaintySi = uncertaintySi;
    Object.freeze(this);
  }

  get valueSi() {
    return this._valueSi;
  }

  get displayUnit() {
    return this._displayUnit;
  }

  get dimension() {
    return this._dimension;
  }

  get uncertaintySi() {
    return this._uncertaintySi;
  }

  /**
   * Constructs a Quantity from a value in a specified unit.
   * @param {number} value
   * @param {string} unit
   * @param {number} [uncertainty=0] - Uncertainty in specified unit
   * @returns {Quantity}
   */
  static from(value, unit, uncertainty = 0) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Cannot create Quantity from non-finite value: ${value}`);
    }
    const def = UnitRegistry[unit];
    if (!def) {
      throw new OmniError(OmniErrorCode.UNSUPPORTED, `Unrecognized unit: "${unit}"`);
    }
    const valueSi = (value + def.offset) * def.scale;
    const uncSi = uncertainty * def.scale;
    return new Quantity(valueSi, unit, def.dim, uncSi);
  }

  /**
   * Returns value converted to target unit.
   * @param {string} targetUnit
   * @returns {number}
   */
  to(targetUnit) {
    const def = UnitRegistry[targetUnit];
    if (!def) {
      throw new OmniError(OmniErrorCode.UNSUPPORTED, `Target unit "${targetUnit}" is not registered`);
    }
    if (!dimensionsEqual(this._dimension, def.dim)) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        `Dimension mismatch: cannot convert ${this._displayUnit} [${this._dimension.join(',')}] to ${targetUnit} [${def.dim.join(',')}]`
      );
    }
    return this._valueSi / def.scale - def.offset;
  }

  /**
   * Converts uncertainty to target unit.
   * @param {string} targetUnit
   * @returns {number}
   */
  uncertaintyTo(targetUnit) {
    const def = UnitRegistry[targetUnit];
    if (!def) throw new OmniError(OmniErrorCode.UNSUPPORTED, `Target unit "${targetUnit}" is not registered`);
    if (!dimensionsEqual(this._dimension, def.dim)) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        `Dimension mismatch: cannot convert uncertainty to ${targetUnit}`
      );
    }
    return this._uncertaintySi / def.scale;
  }

  /**
   * Returns new Quantity with display unit changed to targetUnit.
   * @param {string} targetUnit
   * @returns {Quantity}
   */
  withDisplayUnit(targetUnit) {
    // Validate unit dimension
    this.to(targetUnit);
    return new Quantity(this._valueSi, targetUnit, this._dimension, this._uncertaintySi);
  }

  /**
   * Add another quantity of same dimension.
   * @param {Quantity} other
   * @returns {Quantity}
   */
  add(other) {
    if (!(other instanceof Quantity)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Cannot add non-Quantity');
    }
    if (!dimensionsEqual(this._dimension, other.dimension)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Cannot add quantities with different dimensions');
    }
    const sumVal = this._valueSi + other.valueSi;
    const sumUnc = Math.hypot(this._uncertaintySi, other.uncertaintySi);
    return new Quantity(sumVal, this._displayUnit, this._dimension, sumUnc);
  }

  /**
   * Subtract another quantity of same dimension.
   * @param {Quantity} other
   * @returns {Quantity}
   */
  subtract(other) {
    if (!(other instanceof Quantity)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Cannot subtract non-Quantity');
    }
    if (!dimensionsEqual(this._dimension, other.dimension)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Cannot subtract quantities with different dimensions');
    }
    const diffVal = this._valueSi - other.valueSi;
    const diffUnc = Math.hypot(this._uncertaintySi, other.uncertaintySi);
    return new Quantity(diffVal, this._displayUnit, this._dimension, diffUnc);
  }

  /**
   * Multiply by a scalar or another Quantity.
   * @param {Quantity|number} factor
   * @returns {Quantity}
   */
  multiply(factor) {
    if (typeof factor === 'number') {
      if (!Number.isFinite(factor)) throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Multiplier must be finite');
      return new Quantity(
        this._valueSi * factor,
        this._displayUnit,
        this._dimension,
        this._uncertaintySi * Math.abs(factor)
      );
    }
    if (factor instanceof Quantity) {
      const newVal = this._valueSi * factor.valueSi;
      const newDim = this._dimension.map((d, i) => d + factor.dimension[i]);
      const newUnc = Math.hypot(factor.valueSi * this._uncertaintySi, this._valueSi * factor.uncertaintySi);
      return new Quantity(newVal, '', newDim, newUnc);
    }
    throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Multiplication requires Quantity or finite number');
  }

  /**
   * Divide by a scalar or another Quantity.
   * @param {Quantity|number} divisor
   * @returns {Quantity}
   */
  divide(divisor) {
    if (typeof divisor === 'number') {
      if (!Number.isFinite(divisor) || divisor === 0) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Divisor must be a non-zero finite number');
      }
      return new Quantity(
        this._valueSi / divisor,
        this._displayUnit,
        this._dimension,
        this._uncertaintySi / Math.abs(divisor)
      );
    }
    if (divisor instanceof Quantity) {
      if (divisor.valueSi === 0) {
        throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'Division by zero Quantity');
      }
      const newVal = this._valueSi / divisor.valueSi;
      const newDim = this._dimension.map((d, i) => d - divisor.dimension[i]);
      const newUnc = Math.hypot(
        this._uncertaintySi / divisor.valueSi,
        (this._valueSi * divisor.uncertaintySi) / (divisor.valueSi * divisor.valueSi)
      );
      return new Quantity(newVal, '', newDim, newUnc);
    }
    throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Division requires Quantity or finite number');
  }

  /**
   * String representation in display unit.
   * @returns {string}
   */
  toString() {
    let displayVal;
    let displayUnc;
    if (this._displayUnit && UnitRegistry[this._displayUnit]) {
      displayVal = this.to(this._displayUnit);
      displayUnc = this.uncertaintyTo(this._displayUnit);
    } else {
      displayVal = this._valueSi;
      displayUnc = this._uncertaintySi;
    }
    const unitPart = this._displayUnit ? ` ${this._displayUnit}` : '';
    if (displayUnc > 0) {
      return `${displayVal.toPrecision(7)} ± ${displayUnc.toPrecision(2)}${unitPart}`;
    }
    return `${displayVal.toPrecision(7)}${unitPart}`;
  }

  toJSON() {
    return {
      valueSi: this._valueSi,
      displayUnit: this._displayUnit,
      dimension: [...this._dimension],
      uncertaintySi: this._uncertaintySi
    };
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Invalid Quantity JSON');
    }
    return new Quantity(
      json.valueSi,
      json.displayUnit,
      json.dimension,
      json.uncertaintySi === undefined ? 0 : json.uncertaintySi
    );
  }
}

module.exports = {
  Quantity,
  Dimensions,
  UnitRegistry,
  dimensionsEqual
};
