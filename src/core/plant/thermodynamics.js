/**
 * Experimental process thermodynamics examples.
 * The Wilson/Rachford-Rice calculation accepts explicit caller property records.
 * The product has no bundled component-property database or validated flash model.
 */
'use strict';

const PURE_COMPONENTS = Object.freeze({});

function validateComponentPropertyRecord(componentName, record) {
  if (typeof componentName !== 'string' || componentName.trim() === '') {
    throw new TypeError('A non-empty component name is required.');
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new RangeError(`Explicit property data is required for component '${componentName}'.`);
  }

  const requiredPositive = ['criticalTemperatureK', 'criticalPressurePa', 'molecularWeightKgPerMol'];
  const missing = requiredPositive.filter((field) => !Number.isFinite(record[field]) || record[field] <= 0);
  if (!Number.isFinite(record.acentricFactor)) missing.push('acentricFactor');
  const provenance = record.provenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    missing.push('provenance');
  } else {
    if (typeof provenance.source !== 'string' || provenance.source.trim() === '') missing.push('provenance.source');
    if (typeof provenance.license !== 'string' || provenance.license.trim() === '') {
      missing.push('provenance.license');
    }
  }
  if (missing.length > 0) {
    throw new TypeError(`Component '${componentName}' property record is missing valid fields: ${missing.join(', ')}.`);
  }

  return {
    criticalTemperatureK: record.criticalTemperatureK,
    criticalPressurePa: record.criticalPressurePa,
    acentricFactor: record.acentricFactor,
    molecularWeightKgPerMol: record.molecularWeightKgPerMol,
    provenance: {
      source: provenance.source.trim(),
      license: provenance.license.trim()
    }
  };
}

class ThermodynamicsEngine {
  /**
   * Peng-Robinson Equation of State parameters for a pure component.
   */
  static getPurePRParams(compName, T_Kelvin, componentPropertyRecord) {
    if (!Number.isFinite(T_Kelvin) || T_Kelvin <= 0) throw new TypeError('Temperature in kelvin must be positive.');
    const R = 8.314462618; // J / (mol * K)
    const comp = validateComponentPropertyRecord(compName, componentPropertyRecord);
    const Pc_Pa = comp.criticalPressurePa;

    const Tr = T_Kelvin / comp.criticalTemperatureK;
    const kappa = 0.37464 + 1.54226 * comp.acentricFactor - 0.26992 * comp.acentricFactor * comp.acentricFactor;
    const alpha = Math.pow(1 + kappa * (1 - Math.sqrt(Tr)), 2);

    const a = 0.45724 * ((R * R * comp.criticalTemperatureK * comp.criticalTemperatureK) / Pc_Pa) * alpha;
    const b = 0.0778 * ((R * comp.criticalTemperatureK) / Pc_Pa);

    if (![a, b].every((value) => Number.isFinite(value) && value > 0)) {
      throw new RangeError(`Component '${compName}' produced invalid Peng-Robinson parameter estimates.`);
    }
    return {
      a,
      b,
      componentName: compName,
      componentProperties: comp,
      validationLevel: 'experimental',
      dataStatus: 'caller-supplied-unverified-data'
    };
  }

  /**
   * Multi-Component Isothermal Flash Solver (Vapor-Liquid Equilibrium VLE)
   * Solves Rachford-Rice equation using Newton-Raphson iteration
   * @param {Object} feedMoleFractions Component mole fractions
   * @param {number} T_C Temperature in Celsius
   * @param {number} P_bar Pressure in bar
   * @param {Object} componentProperties Explicit unit-tagged property records keyed by component name
   */
  static flashVLE(feedMoleFractions, T_C, P_bar, componentProperties) {
    if (!feedMoleFractions || typeof feedMoleFractions !== 'object' || Array.isArray(feedMoleFractions)) {
      throw new TypeError('A feed composition object is required.');
    }
    const components = Object.keys(feedMoleFractions);
    if (components.length === 0) {
      throw new RangeError('A non-empty feed with component names is required.');
    }
    if (!Number.isFinite(T_C) || !Number.isFinite(P_bar) || P_bar <= 0) {
      throw new TypeError('Temperature in Celsius and positive pressure in bar are required.');
    }
    if (T_C + 273.15 <= 0) throw new RangeError('Temperature must be above absolute zero.');
    if (!componentProperties || typeof componentProperties !== 'object' || Array.isArray(componentProperties)) {
      throw new TypeError('Explicit component property records with source and license provenance are required.');
    }
    const properties = Object.fromEntries(
      components.map((name) => {
        if (!Object.hasOwn(componentProperties, name)) {
          throw new RangeError(`Explicit property data is required for component '${name}'.`);
        }
        return [name, validateComponentPropertyRecord(name, componentProperties[name])];
      })
    );
    const z = components.map((name) => feedMoleFractions[name]);
    if (z.some((value) => !Number.isFinite(value) || value < 0) || Math.abs(z.reduce((a, b) => a + b, 0) - 1) > 1e-6) {
      throw new RangeError('Feed mole fractions must be finite, non-negative, and sum to one.');
    }
    const T_K = T_C + 273.15;
    const N = components.length;

    const pressurePa = P_bar * 1e5;
    if (!Number.isFinite(pressurePa) || pressurePa <= 0)
      throw new RangeError('Pressure is outside the supported numeric range.');

    // Estimate initial K-values using Wilson's correlation and explicit caller data.
    const K = components.map((name) => {
      const p = properties[name];
      return (
        (p.criticalPressurePa / pressurePa) *
        Math.exp(5.37 * (1 + p.acentricFactor) * (1 - p.criticalTemperatureK / T_K))
      );
    });
    if (K.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new RangeError('Wilson K-value estimate is outside the supported numerical range.');
    }

    // Solve Rachford-Rice over its physical interval, with explicit single-phase checks.
    const rachfordRice = (beta) =>
      components.reduce((sum, _name, i) => {
        const kiMinusOne = K[i] - 1;
        return sum + (z[i] * kiMinusOne) / (1 + beta * kiMinusOne);
      }, 0);
    const fAtLiquid = rachfordRice(0);
    const fAtVapor = rachfordRice(1);
    let psi = 0;
    let iterations = 0;
    let residual = 0;
    let converged = true;
    let phase;
    if (fAtLiquid <= 0) {
      psi = 0;
      residual = Math.abs(fAtLiquid);
      phase = 'Liquid-only estimate';
    } else if (fAtVapor >= 0) {
      psi = 1;
      residual = Math.abs(fAtVapor);
      phase = 'Vapor-only estimate';
    } else {
      let low = 0;
      let high = 1;
      const tolerance = 1e-10;
      for (let iter = 0; iter < 100; iter++) {
        iterations = iter + 1;
        psi = (low + high) / 2;
        const value = rachfordRice(psi);
        residual = Math.abs(value);
        if (residual <= tolerance) break;
        if (value > 0) low = psi;
        else high = psi;
      }
      converged = residual <= tolerance;
      phase = 'Two-phase estimate';
    }

    // Calculate phase compositions without display rounding so downstream balances retain precision.
    const x = {};
    const y = {};
    for (let i = 0; i < N; i++) {
      const name = components[i];
      if (psi === 0) {
        x[name] = z[i];
        y[name] = (z[i] * K[i]) / (1 + fAtLiquid);
      } else if (psi === 1) {
        y[name] = z[i];
        x[name] = z[i] / K[i] / (1 - fAtVapor);
      } else {
        const denom = 1 + psi * (K[i] - 1);
        x[name] = z[i] / denom;
        y[name] = (z[i] * K[i]) / denom;
      }
    }

    return {
      success: converged,
      status: converged ? 'completed' : 'numerical-failure',
      validationLevel: 'experimental',
      dataStatus: 'caller-supplied-unverified-data',
      model: 'Wilson K-value estimate with bracketed Rachford-Rice phase calculation',
      assumptions: [
        'Critical properties and acentric factors were supplied by the caller and have not been independently reviewed.',
        'Wilson K-values are a screening correlation and are not a fugacity-based equation-of-state flash.',
        'No independent phase-equilibrium reference or validation is configured.'
      ],
      inputs: {
        feedMoleFractions: { ...feedMoleFractions },
        temperatureC: T_C,
        pressureBar: P_bar,
        componentProperties: properties
      },
      converged,
      iterations,
      residual,
      temperature_C: T_C,
      pressure_bar: P_bar,
      vaporFraction_psi: psi,
      vaporFraction: psi,
      liquidFraction: 1.0 - psi,
      phaseState: phase,
      liquidComposition: x,
      vaporComposition: y,
      equilibriumKValues: Object.fromEntries(components.map((name, i) => [name, +K[i].toFixed(3)]))
    };
  }

  /**
   * Multi-Stage Atmospheric Crude Distillation Column Simulation
   */
  static simulateDistillationColumn() {
    return {
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      error: 'No sourced assay, column model, or independent fractionation reference is available.'
    };
  }
}

const { ProcessStream, ProcessFlowsheetSolver } = require('./process_flowsheet_solver');
const { HeatExchangerTEMA } = require('./heat_exchanger_tema');
const { PipingNetwork3D } = require('./piping_network_3d');

ThermodynamicsEngine.Flowsheet = ProcessFlowsheetSolver;
ThermodynamicsEngine.ProcessStream = ProcessStream;
ThermodynamicsEngine.TEMA = HeatExchangerTEMA;
ThermodynamicsEngine.PipingNetwork = PipingNetwork3D;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PURE_COMPONENTS,
    ThermodynamicsEngine,
    ProcessStream,
    ProcessFlowsheetSolver,
    HeatExchangerTEMA,
    PipingNetwork3D
  };
}
