/**
 * Experimental plant-property calculations and a legacy component example set.
 *
 * Provides:
 * 1. Temperature-dependent DIPPR correlation equations:
 *    - Extended Antoine (DIPPR 101): Vapor pressure P_vap(T)
 *    - Rackett (DIPPR 105): Liquid density rho_L(T)
 *    - Hyperbolic Ideal Gas Heat Capacity (DIPPR 107): Cp0(T)
 *    - Exponential Liquid Viscosity (DIPPR 102): mu_L(T)
 *    - Polynomial Liquid Thermal Conductivity (DIPPR 100): k_L(T)
 * 2. Caller-supplied property records; no component catalog is bundled.
 * 3. Experimental 3-Phase Vapor-Liquid-Liquid Equilibrium (VLLE) Flash calculation.
 *
 * This file does not contain or represent an AIChE DIPPR 801 data product.
 */

'use strict';

function requirePositiveTemperature(temperatureK, propertyName) {
  if (!Number.isFinite(temperatureK) || temperatureK <= 0) {
    throw new TypeError(`${propertyName} requires a finite positive temperature in Kelvin.`);
  }
}

function requireCorrelationCoefficients(record, field, length) {
  const values = record[field];
  if (values === undefined) {
    const error = new Error(`${field} is unavailable; supply explicit coefficients for this property.`);
    error.code = 'UNAVAILABLE';
    throw error;
  }
  if (!Array.isArray(values) || values.length !== length || !values.every(Number.isFinite)) {
    const error = new TypeError(`${field} must contain exactly ${length} finite coefficients.`);
    error.code = 'INVALID_INPUT';
    throw error;
  }
  return values;
}

/**
 * Property record used by the experimental calculations below.
 */
class ExperimentalPropertyComponent {
  constructor(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError('An explicit property record object is required.');
    }
    this.id = data.id;
    this.name = data.name;
    this.formula = data.formula;
    this.cas = data.cas || '';
    this.family = data.family;
    this.mw = data.mw; // Molecular weight (g/mol)
    this.Tc = data.Tc; // Critical temperature (K)
    this.Pc = data.Pc; // Critical pressure (Pa)
    this.omega = data.omega; // Acentric factor
    this.Tb = data.Tb; // Normal boiling point (K)
    this.Hf298 = data.Hf298; // Standard enthalpy of formation (kJ/mol), when supplied
    this.dataStatus = data.dataStatus || 'experimental-estimated';
    this.source = data.source || null;
    this.licenseStatus = data.licenseStatus || 'unverified';

    // DIPPR 101: ln(P_vap [Pa]) = A + B/T + C*ln(T) + D*T^E
    this.pvEq = Array.isArray(data.pvEq) ? Object.freeze([...data.pvEq]) : undefined;
    this.pvTmin = data.pvTmin;
    this.pvTmax = data.pvTmax;

    // DIPPR 105: rho_L [kmol/m^3] = A / (B^(1 + (1 - T/C)^D))
    this.rhoLEq = Array.isArray(data.rhoLEq) ? Object.freeze([...data.rhoLEq]) : undefined;

    // DIPPR 107: Cp0 [J/(mol*K)] = A + B*( (C/T)/sinh(C/T) )^2 + D*( (E/T)/cosh(E/T) )^2
    this.cpEq = Array.isArray(data.cpEq) ? Object.freeze([...data.cpEq]) : undefined;

    // DIPPR 102: ln(mu_L [Pa*s]) = A + B/T + C*ln(T) + D*T^E
    this.muEq = Array.isArray(data.muEq) ? Object.freeze([...data.muEq]) : undefined;

    // DIPPR 100: k_L [W/(m*K)] = A + B*T + C*T^2
    this.kLEq = Array.isArray(data.kLEq) ? Object.freeze([...data.kLEq]) : undefined;
  }

  /**
   * Vapor pressure at T (Kelvin) in Pascals.
   */
  getVaporPressure(T) {
    requirePositiveTemperature(T, 'Vapor-pressure calculation');
    const [A, B, C, D, E] = requireCorrelationCoefficients(this, 'pvEq', 5);
    if (
      !Number.isFinite(this.pvTmin) ||
      !Number.isFinite(this.pvTmax) ||
      this.pvTmin <= 0 ||
      this.pvTmax < this.pvTmin
    ) {
      throw new RangeError('A finite positive pvTmin and pvTmax correlation range must be supplied.');
    }
    if (T < this.pvTmin || T > this.pvTmax) {
      throw new RangeError(
        `Temperature ${T} K is outside the supplied correlation range [${this.pvTmin}, ${this.pvTmax}] K.`
      );
    }
    const lnP = A + B / T + C * Math.log(T) + D * Math.pow(T, E);
    const pressure = Math.exp(lnP);
    if (!Number.isFinite(pressure) || pressure <= 0) {
      throw new RangeError('The supplied vapor-pressure coefficients do not produce finite positive pressure.');
    }
    return pressure;
  }

  /**
   * Liquid mass density at T (Kelvin) in kg/m^3.
   */
  getLiquidDensity(T) {
    requirePositiveTemperature(T, 'Liquid-density calculation');
    const [A, B, C, D] = requireCorrelationCoefficients(this, 'rhoLEq', 4);
    if (!Number.isFinite(this.mw) || this.mw <= 0 || A <= 0 || B <= 0 || C <= 0) {
      throw new RangeError('The supplied density coefficients and molecular weight must be finite and positive.');
    }
    const Tr = T / C;
    if (Tr >= 1.0) {
      const density = (A / B) * this.mw; // Experimental near-critical approximation.
      if (!Number.isFinite(density) || density <= 0)
        throw new RangeError('Density estimate is not finite and positive.');
      return density;
    }
    const denom = Math.pow(B, 1.0 + Math.pow(1.0 - Tr, D));
    const molarDensityKmolM3 = A / denom;
    const density = molarDensityKmolM3 * this.mw; // kg/m^3
    if (!Number.isFinite(density) || density <= 0) throw new RangeError('Density estimate is not finite and positive.');
    return density;
  }

  /**
   * Ideal gas molar heat capacity at T (Kelvin) in J/(mol*K).
   */
  getIdealGasCp(T) {
    requirePositiveTemperature(T, 'Ideal-gas heat-capacity calculation');
    const [A, B, C, D, E] = requireCorrelationCoefficients(this, 'cpEq', 5);
    let term1 = 0;
    if (C > 0) {
      const u1 = C / T;
      const sinhU1 = Math.sinh(u1);
      if (Math.abs(sinhU1) > 1e-12) {
        term1 = B * Math.pow(u1 / sinhU1, 2);
      }
    }
    let term2 = 0;
    if (E > 0) {
      const u2 = E / T;
      const coshU2 = Math.cosh(u2);
      if (Math.abs(coshU2) > 1e-12) {
        term2 = D * Math.pow(u2 / coshU2, 2);
      }
    }
    const heatCapacity = A + term1 + term2;
    if (!Number.isFinite(heatCapacity) || heatCapacity <= 0) {
      throw new RangeError('The supplied heat-capacity coefficients do not produce finite positive heat capacity.');
    }
    return heatCapacity;
  }

  /**
   * Liquid dynamic viscosity at T (Kelvin) in Pa*s.
   */
  getLiquidViscosity(T) {
    requirePositiveTemperature(T, 'Liquid-viscosity calculation');
    const [A, B, C, D, E] = requireCorrelationCoefficients(this, 'muEq', 5);
    const lnMu = A + B / T + C * Math.log(T) + D * Math.pow(T, E);
    const viscosity = Math.exp(lnMu);
    if (!Number.isFinite(viscosity) || viscosity <= 0) {
      throw new RangeError('The supplied viscosity coefficients do not produce finite positive viscosity.');
    }
    return viscosity;
  }

  /**
   * Liquid thermal conductivity at T (Kelvin) in W/(m*K).
   */
  getLiquidThermalConductivity(T) {
    requirePositiveTemperature(T, 'Liquid-thermal-conductivity calculation');
    const [A, B, C] = requireCorrelationCoefficients(this, 'kLEq', 3);
    const conductivity = A + B * T + C * T * T;
    if (!Number.isFinite(conductivity) || conductivity <= 0) {
      throw new RangeError('The supplied conductivity coefficients do not produce finite positive conductivity.');
    }
    return conductivity;
  }
}

/**
 * Legacy example records. Values have not been independently verified or provenance reviewed.
 */
const EXPERIMENTAL_SPECIES_DATA = Object.freeze([]);

class ExperimentalPropertyDatabase {
  constructor(records = []) {
    this.catalog = new Map();
    this.aliasMap = new Map();
    this._initializeCatalog(records);
  }

  _initializeCatalog(records) {
    if (!Array.isArray(records)) {
      throw new TypeError('Property records must be supplied as an array.');
    }
    for (const data of records) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new TypeError('Each property record must be an object.');
      }
      const comp = new ExperimentalPropertyComponent(data);
      if (![comp.id, comp.name, comp.formula].every((value) => typeof value === 'string' && value.trim() !== '')) {
        throw new TypeError('Each property record requires explicit id, name, and formula strings.');
      }
      if (this.catalog.has(comp.id)) throw new TypeError(`Duplicate property record id '${comp.id}'.`);
      this.catalog.set(comp.id, comp);
      this.aliasMap.set(comp.id.toLowerCase(), comp.id);
      this.aliasMap.set(comp.name.toLowerCase(), comp.id);
      this.aliasMap.set(comp.formula.toLowerCase(), comp.id);
      if (comp.cas) this.aliasMap.set(comp.cas, comp.id);
    }
  }

  /**
   * Looks up a component by name, ID, formula, or CAS number.
   * @param {string} query
   * @returns {ExperimentalPropertyComponent|null}
   */
  get(query) {
    if (!query) return null;
    const q = query.trim().toLowerCase();
    const id = this.aliasMap.get(q) || this.aliasMap.get(query.trim());
    if (id && this.catalog.has(id)) {
      return this.catalog.get(id);
    }
    return null;
  }

  /**
   * Returns list of all loaded species IDs.
   */
  listSpecies() {
    return Array.from(this.catalog.keys());
  }

  getCatalogMetadata() {
    return {
      status: 'experimental',
      recordCount: this.catalog.size,
      source: null,
      licenseStatus: 'unverified',
      attribution: 'Caller-supplied unverified records; no bundled or official AIChE DIPPR 801 data is provided.'
    };
  }

  /**
   * Experimental 3-Phase Vapor-Liquid-Liquid Equilibrium (VLLE) calculation.
   * Solves for Vapor fraction beta_V, and Second Liquid (Organic) fraction beta_L2.
   * Phase 1 (L1) is Aqueous-rich, Phase 2 (L2) is Organic-rich, Vapor (V) is gas.
   *
   * @param {Object} spec
   * @param {string[]} spec.components - Component names
   * @param {number[]} spec.feedFractions - Feed mole fractions z_i (sum = 1)
   * @param {number} spec.temperatureK - Temperature in Kelvin
   * @param {number} spec.pressurePa - Pressure in Pascals
   * @returns {Object} 3-Phase flash equilibrium result
   */
  solveVLLEFlash(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new TypeError('VLLE calculation requires an explicit input object.');
    }
    const compNames = spec.components;
    const z = spec.feedFractions;
    const T = spec.temperatureK;
    const P = spec.pressurePa;
    if (
      !Array.isArray(compNames) ||
      compNames.length < 2 ||
      !compNames.every((name) => typeof name === 'string' && name.trim())
    ) {
      throw new TypeError('VLLE components must contain at least two nonempty component names.');
    }
    if (
      !Array.isArray(z) ||
      z.length !== compNames.length ||
      !z.every((fraction) => Number.isFinite(fraction) && fraction >= 0) ||
      Math.abs(z.reduce((sum, fraction) => sum + fraction, 0) - 1) > 1e-6
    ) {
      throw new TypeError('feedFractions must be finite, nonnegative, and sum to 1.');
    }
    requirePositiveTemperature(T, 'VLLE calculation');
    if (!Number.isFinite(P) || P <= 0) throw new TypeError('VLLE calculation requires a finite positive pressurePa.');
    const C = compNames.length;

    const comps = compNames.map((name) => {
      const c = this.get(name);
      if (!c) {
        const error = new Error(`Unknown experimental property component: ${name}`);
        error.code = 'UNAVAILABLE';
        throw error;
      }
      if (typeof c.family !== 'string' || !c.family.trim()) {
        throw new TypeError(
          `Component '${name}' requires an explicit family classification for the experimental VLLE model.`
        );
      }
      return c;
    });

    // Compute vapor pressures P_vap,i
    const Pvap = comps.map((c) => c.getVaporPressure(T));

    // K-values relative to aqueous Liquid 1:
    // For water, K_V ~ Pvap / P. For organics in aqueous, activity coeff gamma_i,aq >> 1
    // K_i,V = y_i / x_i,L1 ~ gamma_i,L1 * Pvap,i / P
    // K_i,L2 = x_i,L2 / x_i,L1 ~ gamma_i,L1 / gamma_i,L2
    const KV = new Float64Array(C);
    const KL2 = new Float64Array(C);

    for (let i = 0; i < C; i++) {
      const isWater = comps[i].family === 'Aqueous';
      const isOrganic = !isWater;

      if (isWater) {
        // Water partitions strongly into L1 (aqueous)
        const gamma_w_L1 = 1.0;
        const gamma_w_L2 = 80.0; // Water poorly soluble in oil
        KV[i] = (gamma_w_L1 * Pvap[i]) / P;
        KL2[i] = gamma_w_L1 / gamma_w_L2; // ~ 0.0125
      } else {
        // Hydrocarbon / aromatic partitions strongly into L2 (organic)
        const gamma_org_L1 = 500.0; // Hydrocarbon poorly soluble in water
        const gamma_org_L2 = 1.0;
        KV[i] = (gamma_org_L1 * Pvap[i]) / P;
        KL2[i] = gamma_org_L1 / gamma_org_L2; // ~ 500
      }
    }

    // Solve 2D Rachford-Rice for (beta_V, beta_L2):
    // F1(beta_V, beta_L2) = sum( z_i * (KV_i - 1) / D_i ) = 0
    // F2(beta_V, beta_L2) = sum( z_i * (KL2_i - 1) / D_i ) = 0
    // where D_i = 1 + beta_V * (KV_i - 1) + beta_L2 * (KL2_i - 1)
    let beta_V = 0.1;
    let beta_L2 = 0.4;
    const maxIter = 40;
    const tol = 1e-7;

    let converged = false;
    for (let iter = 0; iter < maxIter; iter++) {
      let F1 = 0.0;
      let F2 = 0.0;
      let dF1_dbetaV = 0.0;
      let dF1_dbetaL2 = 0.0;
      let dF2_dbetaV = 0.0;
      let dF2_dbetaL2 = 0.0;

      for (let i = 0; i < C; i++) {
        const d_i = 1.0 + beta_V * (KV[i] - 1.0) + beta_L2 * (KL2[i] - 1.0);
        if (Math.abs(d_i) < 1e-12) continue;
        const term1 = (z[i] * (KV[i] - 1.0)) / d_i;
        const term2 = (z[i] * (KL2[i] - 1.0)) / d_i;

        F1 += term1;
        F2 += term2;

        const d_i2 = d_i * d_i;
        dF1_dbetaV -= (z[i] * (KV[i] - 1.0) * (KV[i] - 1.0)) / d_i2;
        dF1_dbetaL2 -= (z[i] * (KV[i] - 1.0) * (KL2[i] - 1.0)) / d_i2;
        dF2_dbetaV -= (z[i] * (KL2[i] - 1.0) * (KV[i] - 1.0)) / d_i2;
        dF2_dbetaL2 -= (z[i] * (KL2[i] - 1.0) * (KL2[i] - 1.0)) / d_i2;
      }

      const resNorm = Math.hypot(F1, F2);
      if (resNorm < tol) {
        converged = true;
        break;
      }

      // 2x2 Jacobian inversion: J = [dF1/dV, dF1/dL2; dF2/dV, dF2/dL2]
      const detJ = dF1_dbetaV * dF2_dbetaL2 - dF1_dbetaL2 * dF2_dbetaV;
      if (Math.abs(detJ) < 1e-15) break;

      const delta_beta_V = -(dF2_dbetaL2 * F1 - dF1_dbetaL2 * F2) / detJ;
      const delta_beta_L2 = -(-dF2_dbetaV * F1 + dF1_dbetaV * F2) / detJ;

      // Line search / damping to stay inside [0, 1]
      let alpha = 1.0;
      let nextV = beta_V + alpha * delta_beta_V;
      let nextL2 = beta_L2 + alpha * delta_beta_L2;
      while (alpha > 0.05 && (nextV < 0 || nextL2 < 0 || nextV + nextL2 > 1.0)) {
        alpha *= 0.5;
        nextV = beta_V + alpha * delta_beta_V;
        nextL2 = beta_L2 + alpha * delta_beta_L2;
      }

      beta_V = Math.max(0.0, Math.min(1.0, nextV));
      beta_L2 = Math.max(0.0, Math.min(1.0 - beta_V, nextL2));
    }

    // Subcooled Liquid-Liquid Equilibrium (LLE) resolution if no vapor phase forms
    if (!converged && beta_V < 0.05) {
      beta_V = 0.0;
      let beta = 0.5;
      for (let it = 0; it < 30; it++) {
        let f = 0.0,
          df = 0.0;
        for (let i = 0; i < C; i++) {
          const d = 1.0 + beta * (KL2[i] - 1.0);
          f += (z[i] * (KL2[i] - 1.0)) / d;
          df -= (z[i] * (KL2[i] - 1.0) * (KL2[i] - 1.0)) / (d * d);
        }
        if (Math.abs(f) < 1e-7) {
          converged = true;
          break;
        }
        if (Math.abs(df) > 1e-12) {
          beta = Math.max(0.001, Math.min(0.999, beta - f / df));
        }
      }
      beta_L2 = beta;
    }

    const beta_L1 = Math.max(0.0, 1.0 - beta_V - beta_L2);

    // Compute mole fractions in all three phases
    const x_L1 = new Float64Array(C);
    const x_L2 = new Float64Array(C);
    const y_V = new Float64Array(C);

    for (let i = 0; i < C; i++) {
      const d_i = Math.max(1e-8, 1.0 + beta_V * (KV[i] - 1.0) + beta_L2 * (KL2[i] - 1.0));
      x_L1[i] = z[i] / d_i;
      x_L2[i] = (z[i] * KL2[i]) / d_i;
      y_V[i] = (z[i] * KV[i]) / d_i;
    }

    // Normalize mole fractions to ensure sum = 1
    const sumL1 = x_L1.reduce((a, b) => a + b, 0);
    const sumL2 = x_L2.reduce((a, b) => a + b, 0);
    const sumV = y_V.reduce((a, b) => a + b, 0);
    for (let i = 0; i < C; i++) {
      if (sumL1 > 0) x_L1[i] /= sumL1;
      if (sumL2 > 0) x_L2[i] /= sumL2;
      if (sumV > 0) y_V[i] /= sumV;
    }

    return {
      dataStatus: 'experimental',
      converged,
      temperatureK: T,
      pressurePa: P,
      phaseFractions: {
        aqueousLiquidL1: beta_L1,
        organicLiquidL2: beta_L2,
        vaporV: beta_V
      },
      compositions: {
        aqueousLiquidL1: Array.from(x_L1),
        organicLiquidL2: Array.from(x_L2),
        vaporV: Array.from(y_V)
      },
      componentNames: compNames
    };
  }
}

module.exports = {
  ExperimentalPropertyComponent,
  ExperimentalPropertyDatabase,
  EXPERIMENTAL_SPECIES_DATA,
  // Deprecated import aliases retained for existing integrations. These names
  // do not indicate that the included values came from AIChE DIPPR 801.
  DIPPRComponent: ExperimentalPropertyComponent,
  DIPPRDatabase: ExperimentalPropertyDatabase,
  DIPPR_SPECIES_DATA: EXPERIMENTAL_SPECIES_DATA
};
