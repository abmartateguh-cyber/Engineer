'use strict';

/**
 * OmniEng coupled viscoplasticity + Johnson-Cook damage engine.
 *
 * Assembles the repository's physics kernels into a single 1D (uniaxial)
 * strain-driven integration engine:
 *
 *   1. Johnson-Cook flow stress (johnson_cook_fracture.js):
 *        sigma = [A + B * eps_p^n] * [1 + C * ln(eps_dot/eps0_dot)]
 *                * [1 - (T*)^m],  T* = (T - T_room)/(T_melt - T_room)
 *   2. Johnson-Cook fracture / damage (johnson_cook_fracture.js):
 *        D = sum(delta_eps_p / eps_f),
 *        eps_f = [D1 + D2*exp(D3*eta)] * [1 + D4*ln(eps_dot*)]
 *                * [1 + D5*T*],   eta = stress triaxiality
 *        element is deleted (flag) once D >= 1.
 *   3. Norton-Bailey power-law creep with Arrhenius temperature term
 *      (the repo's norton_bailey_creep.js implements the isothermal t^m
 *      form; the required law here is the full Arrhenius-Norton form):
 *        eps_dot_cr = A_cr * sigma^n_cr * exp(-Q/(R*T))
 *   4. Adiabatic heating (Taylor-Quinney):
 *        dT = beta * sigma * d_eps_p / (rho * c_p),  beta = 0.9,
 *      fed back into the JC thermal-softening term.
 *
 * The mechanical update is the 1D reduction of the J2 radial-return
 * (j2_plasticity.js): elastic trial stress, and if it exceeds the current
 * JC flow stress the plastic increment is found by bisection on the
 * consistency equation sigma(eps_p + x) = flow stress(eps_p + x, eps_dot, T).
 * Units: stresses in MPa, strains dimensionless, time in seconds,
 * temperature in kelvin, density kg/m^3, specific heat J/(kg K).
 */

const { JohnsonCookFracture } = require('./johnson_cook_fracture');
const { NortonBaileyCreepSolver } = require('./norton_bailey_creep');

const GAS_CONSTANT = 8.31446261815324;

const INCONEL_718_LIKE = Object.freeze({
  A: 1013,
  B: 984,
  n: 0.36,
  C: 0.016,
  m: 1.7,
  T_room: 293,
  T_melt: 1570,
  eps0_dot: 1,
  D1: 0.06,
  D2: 3.31,
  D3: -1.5,
  D4: 0.011,
  D5: 0.02,
  E: 210000,
  rho: 8190,
  cp: 435,
  beta: 0.9,
  A_creep: 1e-12,
  n_creep: 5,
  Q_act: 250000,
  R: GAS_CONSTANT,
  creepEnabled: true
});

const JC_FIELDS = ['A', 'B', 'n', 'C', 'm', 'T_room', 'T_melt', 'eps0_dot', 'D1', 'D2', 'D3', 'D4', 'D5'];

function validateMaterial(material) {
  if (!material || typeof material !== 'object') {
    throw new TypeError('Viscoplasticity damage material object is required.');
  }
  if (!JC_FIELDS.every((f) => Number.isFinite(material[f]))) {
    throw new TypeError('Provide all Johnson-Cook flow and fracture constants explicitly.');
  }
  if (
    material.T_room <= 0 ||
    material.T_melt <= material.T_room ||
    material.eps0_dot <= 0 ||
    material.n < 0 ||
    material.m < 0 ||
    material.E <= 0 ||
    !Number.isFinite(material.rho) ||
    material.rho <= 0 ||
    !Number.isFinite(material.cp) ||
    material.cp <= 0
  ) {
    throw new RangeError(
      'Require T_melt > T_room > 0 K, eps0_dot > 0, non-negative exponents, E > 0, rho > 0, cp > 0.'
    );
  }
  if (material.creepEnabled) {
    NortonBaileyCreepSolver.validateParameters({
      stressMPa: 1,
      A: material.A_creep,
      n: material.n_creep,
      totalHours: 1,
      m: -0.5
    });
    if (!Number.isFinite(material.Q_act) || material.Q_act < 0 || !Number.isFinite(material.R) || material.R <= 0) {
      throw new RangeError('Require finite Q_act >= 0 and R > 0 for the Arrhenius creep law.');
    }
  }
  return material;
}

class ViscoplasticityDamageModel {
  constructor(material) {
    this.material = validateMaterial({ ...INCONEL_718_LIKE, ...(material || {}) });
    this.reset();
  }

  reset() {
    this.totalStrain = 0.0;
    this.plasticStrain = 0.0;
    this.creepStrain = 0.0;
    this.stressMPa = 0.0;
    this.temperature = this.material.T_room;
    this.damage = 0.0;
    this.deleted = false;
    this.elapsedTime = 0.0;
    this.plasticWorkDensityJPerM3 = 0.0;
  }

  flowStress(plasticStrain, strainRate, tempK) {
    return JohnsonCookFracture.computeFlowStress(this.material, plasticStrain, strainRate, tempK);
  }

  fractureStrain(triaxiality, strainRate, tempK) {
    return JohnsonCookFracture.computeFailureStrain(triaxiality, strainRate, tempK, this.material);
  }

  creepRate(stressMPa, tempK) {
    const m = this.material;
    if (!m.creepEnabled) return 0.0;
    return m.A_creep * Math.pow(Math.max(0.0, stressMPa), m.n_creep) * Math.exp(-m.Q_act / (m.R * tempK));
  }

  predictCreepIncrement(dt) {
    return this.creepRate(this.stressMPa, this.temperature) * Math.max(0.0, dt);
  }

  /**
   * Advances the state by one strain-driven increment.
   * @param {number} deltaTotalStrain total strain increment (dimensionless)
   * @param {number} dt time increment (seconds)
   * @param {Object} [opts]
   * @param {number} [opts.strainRate] strain rate used in the JC rate term (default: eps0_dot)
   * @param {number} [opts.triaxiality] stress triaxiality eta for eps_f (default: 1/3, uniaxial tension)
   */
  step(deltaTotalStrain, dt, opts) {
    const m = this.material;
    if (this.deleted) {
      return this.getStatus();
    }
    const strainRate = opts && opts.strainRate !== undefined ? opts.strainRate : m.eps0_dot;
    const eta = opts && opts.triaxiality !== undefined ? opts.triaxiality : 1.0 / 3.0;
    const temperatureBefore = this.temperature;

    let creepIncrement = 0.0;
    if (Number.isFinite(dt) && dt > 0) {
      creepIncrement = this.predictCreepIncrement(dt);
      this.creepStrain += creepIncrement;
    }
    this.totalStrain += deltaTotalStrain;
    this.elapsedTime += Math.max(0.0, dt);

    const elasticStrain = this.totalStrain - this.plasticStrain - this.creepStrain;
    const trialStress = m.E * elasticStrain;
    const yieldAtCurrent = this.flowStress(this.plasticStrain, strainRate, this.temperature);

    let plasticIncrement = 0.0;
    if (trialStress > yieldAtCurrent * (1.0 + 1e-12)) {
      const f = (x) => trialStress - m.E * x - this.flowStress(this.plasticStrain + x, strainRate, this.temperature);
      const hiMax = Math.max(0.0, elasticStrain);
      let lo = 0.0;
      let hi = hiMax;
      if (f(hi) > 0.0) {
        plasticIncrement = hi;
      } else {
        for (let k = 0; k < 60; k++) {
          const mid = 0.5 * (lo + hi);
          if (f(mid) > 0.0) {
            lo = mid;
          } else {
            hi = mid;
          }
        }
        plasticIncrement = 0.5 * (lo + hi);
      }
      const convergedStress = trialStress - m.E * plasticIncrement;
      const workDensity = convergedStress * 1e6 * plasticIncrement;
      this.plasticWorkDensityJPerM3 += workDensity;
      this.temperature += (m.beta * workDensity) / (m.rho * m.cp);
      this.plasticStrain += plasticIncrement;
      this.stressMPa = convergedStress;
      const epsF = this.fractureStrain(eta, strainRate, this.temperature);
      this.damage += plasticIncrement / Math.max(1e-4, epsF);
      if (this.damage >= 1.0) {
        this.deleted = true;
      }
    } else {
      this.stressMPa = trialStress;
    }

    return this.getStatus({
      plasticIncrement,
      creepIncrement,
      temperatureIncrement: this.temperature - temperatureBefore
    });
  }

  getStatus(extra) {
    const status = {
      totalStrain: this.totalStrain,
      plasticStrain: this.plasticStrain,
      creepStrain: this.creepStrain,
      elasticStrain: this.totalStrain - this.plasticStrain - this.creepStrain,
      stressMPa: this.stressMPa,
      temperature: this.temperature,
      damage: this.damage,
      deleted: this.deleted,
      elapsedTime: this.elapsedTime,
      plasticWorkDensityJPerM3: this.plasticWorkDensityJPerM3
    };
    return Object.assign(status, extra);
  }
}

module.exports = {
  ViscoplasticityDamageModel,
  INCONEL_718_LIKE,
  GAS_CONSTANT,
  JC_FIELDS
};
