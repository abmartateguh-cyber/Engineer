/**
 * Hydraulic Transients, Acoustic Wave Celerity & Joukowsky Water Hammer Engine.
 *
 * Implements:
 * 1. Acoustic wave propagation speed (celerity c) in fluid-filled elastic pipes:
 *    c = sqrt( (K / rho) / (1 + (K / E) * (Di / e) * c1) )
 *    with pipe anchoring constraint factors c1 (rigid anchors, expansion joints, thin-walled).
 * 2. Critical pipe transit time tc = 2 * L / c.
 * 3. Instantaneous rapid closure Joukowsky pressure surge:
 *    Delta P = rho * c * Delta v
 * 4. Gradual linear closure pressure surge (Allievi equation for tc > 2L/c).
 * 5. Pipe overpressure verification against ASME B31.3 §302.2.4 occasional variation allowance
 *    (33% overpressure allowable for transients occurring <= 10 hours/year).
 * 6. Dynamic acoustic line packing and surge tank / air vessel sizing.
 */

'use strict';

class HydraulicTransientsJoukowsky {
  /**
   * Calculates fluid acoustic wave celerity in an elastic pipe.
   *
   * @param {Object} params
   * @param {number} params.fluidDensityKgM3 - Liquid density rho (kg/m3)
   * @param {number} params.fluidBulkModulusGPa - Liquid isothermal/isentropic bulk modulus K (GPa, water ~ 2.15, LNG ~ 1.5, diesel ~ 1.6)
   * @param {number} params.pipeElasticModulusGPa - Pipe Young's modulus E (GPa, CS ~ 205, SS ~ 193)
   * @param {number} params.pipeInsideDiameterMm - Di (mm)
   * @param {number} params.pipeWallThicknessMm - e (mm)
   * @param {string} [params.pipeSupportCondition='anchored_both_ends'] - 'anchored_both_ends', 'anchored_upstream', 'expansion_joints'
   * @param {number} [params.pipePoissonRatio=0.3] - Poisson ratio nu (typically 0.3 for steel)
   * @returns {number} Acoustic wave celerity c (m/s)
   */
  static calculateWaveCelerity(params) {
    const {
      fluidDensityKgM3,
      fluidBulkModulusGPa,
      pipeElasticModulusGPa,
      pipeInsideDiameterMm,
      pipeWallThicknessMm,
      pipeSupportCondition = 'anchored_both_ends',
      pipePoissonRatio = 0.3
    } = params;

    const rho = fluidDensityKgM3;
    const K = fluidBulkModulusGPa * 1e9; // Pa
    const E = pipeElasticModulusGPa * 1e9; // Pa
    const Di = pipeInsideDiameterMm * 1e-3; // m
    const e = pipeWallThicknessMm * 1e-3; // m
    const nu = pipePoissonRatio;

    // Pipe restraint coefficient c1 (Korteweg-Wylie)
    let c1 = 1.0;
    if (pipeSupportCondition === 'anchored_both_ends') {
      c1 = 1.0 - Math.pow(nu, 2);
    } else if (pipeSupportCondition === 'anchored_upstream') {
      c1 = 1.25 - nu;
    } else if (pipeSupportCondition === 'expansion_joints') {
      c1 = 1.0;
    }

    const elasticityFactor = 1.0 + (K / E) * (Di / e) * c1;
    const c = Math.sqrt(K / (rho * elasticityFactor));
    return Math.round(c * 10) / 10;
  }

  /**
   * Calculates transient pressure surge due to sudden or gradual valve closure.
   *
   * @param {Object} params
   * @param {number} params.pipeLengthM - Total pipe length L from reservoir/pump to valve (m)
   * @param {number} params.initialVelocityMS - Fluid steady velocity v0 (m/s)
   * @param {number} params.finalVelocityMS - Fluid velocity after valve action (m/s, 0 for full shutoff)
   * @param {number} params.valveClosureTimeS - Valve stroke duration tc (s)
   * @param {number} params.steadyOperatingPressureBarg - Initial pressure P0 at valve (barg)
   * @param {number} params.fluidDensityKgM3 - rho (kg/m3)
   * @param {number} params.fluidBulkModulusGPa - K (GPa)
   * @param {number} params.pipeElasticModulusGPa - E (GPa)
   * @param {number} params.pipeInsideDiameterMm - Di (mm)
   * @param {number} params.pipeWallThicknessMm - e (mm)
   * @param {number} [params.pipeMawpBarg=100.0] - Maximum allowable working pressure of pipe
   * @returns {Object} Comprehensive transient analysis report
   */
  static analyzeWaterHammer(params) {
    const {
      pipeLengthM,
      initialVelocityMS,
      finalVelocityMS = 0.0,
      valveClosureTimeS,
      steadyOperatingPressureBarg,
      fluidDensityKgM3,
      fluidBulkModulusGPa,
      pipeElasticModulusGPa,
      pipeInsideDiameterMm,
      pipeWallThicknessMm,
      pipeMawpBarg = 100.0
    } = params;

    const c = this.calculateWaveCelerity({
      fluidDensityKgM3,
      fluidBulkModulusGPa,
      pipeElasticModulusGPa,
      pipeInsideDiameterMm,
      pipeWallThicknessMm
    });

    const L = pipeLengthM;
    const deltaV = Math.abs(initialVelocityMS - finalVelocityMS);
    const tc = valveClosureTimeS;

    // Critical pipeline round-trip transit time
    const tCrit = (2 * L) / c;

    // Joukowsky instantaneous surge Delta P (Pa)
    const rho = fluidDensityKgM3;
    const deltaP_joukowsky_Pa = rho * c * deltaV;
    const deltaP_joukowsky_bar = deltaP_joukowsky_Pa / 1e5;

    let deltaP_actual_bar = deltaP_joukowsky_bar;
    let closureType = 'Rapid Closure (tc <= 2L/c)';

    if (tc > tCrit && tc > 0) {
      closureType = 'Slow / Gradual Closure (tc > 2L/c)';
      // Allievi equation reduction for slow linear closure
      deltaP_actual_bar = deltaP_joukowsky_bar * (tCrit / tc);
    }

    const peakPressureBarg = steadyOperatingPressureBarg + deltaP_actual_bar;
    // ASME B31.3 §302.2.4 allows 33% overpressure for occasional transients
    const occasionalAllowableBarg = pipeMawpBarg * 1.33;
    const isWithinOccasionalLimit = peakPressureBarg <= occasionalAllowableBarg;

    // Minimum surge mitigation volume required if overpressured
    let requiredAirVesselVolumeM3 = 0;
    if (peakPressureBarg > occasionalAllowableBarg) {
      const excessPressurePa = (peakPressureBarg - occasionalAllowableBarg) * 1e5;
      const kineticEnergyJoules = 0.5 * rho * (Math.PI * Math.pow(pipeInsideDiameterMm * 1e-3, 2) / 4) * L * Math.pow(deltaV, 2);
      requiredAirVesselVolumeM3 = Math.round((kineticEnergyJoules / excessPressurePa) * 100) / 100;
    }

    return {
      waveCelerityMS: c,
      criticalTimeSec: Math.round(tCrit * 1000) / 1000,
      valveClosureTimeSec: tc,
      closureClassification: closureType,
      joukowskySurgeBar: Math.round(deltaP_joukowsky_bar * 10) / 10,
      actualSurgeBar: Math.round(deltaP_actual_bar * 10) / 10,
      steadyOperatingPressureBarg,
      peakTransientPressureBarg: Math.round(peakPressureBarg * 10) / 10,
      pipeMawpBarg,
      occasionalAllowableBarg: Math.round(occasionalAllowableBarg * 10) / 10,
      isCompliant: isWithinOccasionalLimit,
      recommendedMitigation: isWithinOccasionalLimit
        ? 'Transient pressure is safely within ASME B31.3 §302.2.4 occasional limits.'
        : `Overpressure exceeds 133% MAWP. Recommended: Install surge dampener air vessel (V >= ${requiredAirVesselVolumeM3} m3) or increase valve closure stroke time to > ${Math.ceil(tCrit * (deltaP_joukowsky_bar / (occasionalAllowableBarg - steadyOperatingPressureBarg)))} s.`
    };
  }
}

module.exports = {
  HydraulicTransientsJoukowsky
};
