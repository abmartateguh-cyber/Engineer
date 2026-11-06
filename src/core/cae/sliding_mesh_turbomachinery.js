/**
 * OmniEng Centrifugal Pump / Compressor Stage Model (velocity triangles).
 *
 * Replaces the former "MRF sliding-mesh CFD" claim with a genuine single-stage
 * turbomachinery calculation built from velocity triangles:
 *
 *   1. Kinematics from geometry: u = ω·r, c_m = Q / (2π·r·b), at inlet and
 *      outlet stations. The inlet tangential absolute component follows from
 *      the inlet guide-vane angle α1: c_u1 = c_m1·tan α1.
 *   2. Outlet blade-restrained relative flow: c_u2 = u2 − c_m2 / tan β2.
 *   3. Slip factor σ (documented correlations, selectable):
 *        - Wiesner (1967): σ = 1 − sqrt(cos β2) / Z^0.7
 *          (W. Wiesner, "A Review of Slip Factors for Centrifugal
 *           Impellers", ASME J. Eng. Power, 1967.)
 *        - Stanitz (1952): σ = 1 − 0.63π / Z  (radial-bladed impellers;
 *           J.D. Stanitz, NACA TN 2986, 1952.)
 *      The slip factor reduces the tangential component actually delivered:
 *      c_u2 = (u2 − c_m2/tan β2) · σ.
 *   4. Euler head H_Euler = (u2·c_u2 − u1·c_u1) / g from the actual vector
 *      components.
 *   5. Hydraulic losses (computed, not curve-fitted):
 *        - Passage friction via Darcy-Weisbach on the mean meridional flow
 *          path: ΔH_fric = f · (L/D_h) · w_mean² / (2g), with L the mean
 *          blade-path length (r2 − r1)/cos β_mean and D_h = 2·b_mean.
 *        - Inlet incidence loss proportional to sin² of the angle between the
 *          blade angle β1 and the actual relative flow angle:
 *          ΔH_inc = k_inc · w1² · sin²(β1 − β1_flow) / (2g).
 *   6. Hydraulic efficiency η_hyd = (H_Euler − losses) / H_Euler, and shaft
 *      power P_shaft = ρ·g·Q·H_Euler / η_hyd.
 *
 * No "sliding mesh" CFD is performed; the model is a stage-throughflow
 * calculation valid for preliminary pump/compressor design.
 */

'use strict';

class SlidingMeshTurbomachinery {
  /**
   * @param {Object} options
   * @param {number} [options.rotorRPM=3000] - Angular speed (rpm)
   * @param {number} [options.impellerInletRadiusM=0.035] - Inlet station radius r1 (m)
   * @param {number} [options.impellerOutletRadiusM=0.080] - Outlet station radius r2 (m)
   * @param {number} [options.inletBladeHeightM=0.012] - Inlet blade height b1 (m)
   * @param {number} [options.bladeHeightM=0.012] - Outlet blade height b2 (m)
   * @param {number} [options.bladeInletAngleDeg=30.0] - Inlet blade angle β1
   * @param {number} [options.bladeOutletAngleDeg=25.0] - Outlet blade angle β2
   * @param {number} [options.inletGuideVaneAngleDeg=0.0] - Inlet guide-vane angle α1
   * @param {number} [options.numberOfBlades=6] - Blade count Z (slip correlations)
   * @param {string} [options.slipCorrelation='wiesner'] - 'wiesner' | 'stanitz'
   * @param {number} [options.frictionFactor=0.02] - Darcy-Weisbach friction factor f
   * @param {number} [options.incidenceLossCoefficient=0.5] - Incidence loss coefficient k_inc
   * @param {number} [options.fluidDensity=998.2] - Fluid density (kg/m³)
   */
  constructor(options = {}) {
    this.rpm = options.rotorRPM || 3000;
    this.omega = (this.rpm * 2.0 * Math.PI) / 60.0; // rad/s
    this.r1 = options.impellerInletRadiusM || 0.035;
    this.r2 = options.impellerOutletRadiusM || 0.080;
    this.b1 = options.inletBladeHeightM || 0.012;
    this.b2 = options.bladeHeightM || 0.012;
    this.beta1Rad = ((options.bladeInletAngleDeg ?? 30.0) * Math.PI) / 180.0;
    this.beta2Rad = ((options.bladeOutletAngleDeg || 25.0) * Math.PI) / 180.0;
    this.alpha1Rad = ((options.inletGuideVaneAngleDeg || 0.0) * Math.PI) / 180.0;
    this.numberOfBlades = options.numberOfBlades || 6;
    this.slipCorrelation = options.slipCorrelation || 'wiesner';
    this.frictionFactor = options.frictionFactor ?? 0.02;
    this.incidenceLossCoefficient = options.incidenceLossCoefficient ?? 0.5;
    this.rho = options.fluidDensity || 998.2;
    this.g = 9.80665;
  }

  /**
   * Slip factor σ from a documented correlation.
   * Wiesner (1967): σ = 1 − sqrt(cos β2) / Z^0.7
   * Stanitz (1952): σ = 1 − 0.63π / Z
   */
  computeSlipFactor() {
    const z = this.numberOfBlades;
    if (!Number.isInteger(z) || z < 1) {
      throw new RangeError('numberOfBlades must be a positive integer for slip correlations.');
    }
    let sigma;
    if (this.slipCorrelation === 'stanitz') {
      sigma = 1.0 - (0.63 * Math.PI) / z;
    } else {
      // Wiesner (default)
      sigma = 1.0 - Math.sqrt(Math.cos(this.beta2Rad)) / Math.pow(z, 0.7);
    }
    return Math.min(1.0, Math.max(1e-6, sigma));
  }

  /**
   * Evaluates Coriolis and Centrifugal accelerations at position r for relative velocity u_r
   * @param {Object} r - { x, y, z }
   * @param {Object} ur - { u, v, w }
   * @returns {Object} Coriolis and Centrifugal force vectors per unit mass
   */
  evaluateRotatingFrameAccelerations(r, ur) {
    const w = this.omega;
    const aCoriolis = {
      x: 2.0 * w * ur.v,
      y: -2.0 * w * ur.u,
      z: 0.0
    };

    const aCentrifugal = {
      x: w * w * r.x,
      y: w * w * r.y,
      z: 0.0
    };

    return { aCoriolis, aCentrifugal };
  }

  /**
   * Computes the full stage operating point at volume flow rate Q from velocity
   * triangles, slip, and computed hydraulic losses.
   * @param {number} flowRateM3PerS - Volume flow rate Q (m³/s)
   * @returns {Object} Full computed stage data
   */
  evaluatePumpOperatingPoint(flowRateM3PerS) {
    const Q = Math.max(1e-6, flowRateM3PerS);

    const u1 = this.omega * this.r1;
    const u2 = this.omega * this.r2;
    const inletArea = 2.0 * Math.PI * this.r1 * this.b1;
    const outletArea = 2.0 * Math.PI * this.r2 * this.b2;
    const cm1 = Q / inletArea;
    const cm2 = Q / outletArea;

    const cu1 = cm1 * Math.tan(this.alpha1Rad);
    const w1u = u1 - cu1;
    const beta1FlowRad = Math.atan2(cm1, w1u);
    const w1 = Math.hypot(w1u, cm1);
    const c1 = Math.hypot(cu1, cm1);

    const cu2Blade = u2 - cm2 / Math.tan(this.beta2Rad);
    const sigma = this.computeSlipFactor();
    const cu2 = cu2Blade * sigma;
    const w2 = Math.hypot(u2 - cu2, cm2);
    const c2 = Math.hypot(cu2, cm2);

    const eulerHeadNoSlipM = (u2 * cu2Blade - u1 * cu1) / this.g;
    const eulerHeadM = (u2 * cu2 - u1 * cu1) / this.g;

    const betaMeanRad = (this.beta1Rad + this.beta2Rad) / 2.0;
    const passageLengthM = (this.r2 - this.r1) / Math.cos(betaMeanRad);
    const bMean = (this.b1 + this.b2) / 2.0;
    const hydraulicDiameterM = 2.0 * bMean;
    const wMean = (w1 + w2) / 2.0;
    const frictionLossM = (this.frictionFactor * passageLengthM / hydraulicDiameterM) * (wMean * wMean) / (2.0 * this.g);

    const incidenceRad = this.beta1Rad - beta1FlowRad;
    const incidenceLossM =
      (this.incidenceLossCoefficient * w1 * w1 * Math.pow(Math.sin(incidenceRad), 2)) / (2.0 * this.g);

    const totalLossM = frictionLossM + incidenceLossM;
    const hydraulicEfficiency = eulerHeadM > 0 ? (eulerHeadM - totalLossM) / eulerHeadM : null;

    const pressureRisePa = this.rho * this.g * eulerHeadM;
    const hydraulicPowerW = this.rho * this.g * Q * eulerHeadM;
    const shaftPowerW =
      hydraulicEfficiency !== null && hydraulicEfficiency > 0
        ? this.rho * this.g * Q * eulerHeadM / hydraulicEfficiency
        : 0;

    return {
      flowRateM3PerS: Q,
      flowRateLPerMin: Number((Q * 60000).toFixed(1)),
      rpm: this.rpm,
      omegaRadPerS: this.omega,
      numberOfBlades: this.numberOfBlades,
      slipCorrelation: this.slipCorrelation,
      slipFactor: sigma,
      r1: this.r1,
      r2: this.r2,
      b1: this.b1,
      b2: this.b2,
      alpha1Rad: this.alpha1Rad,
      beta1Rad: this.beta1Rad,
      beta2Rad: this.beta2Rad,
      u1,
      u2,
      cm1,
      cm2,
      cu1,
      cu2,
      w1,
      w2,
      c1,
      c2,
      beta1FlowRad,
      incidenceAngleRad: incidenceRad,
      eulerHeadNoSlipM,
      eulerHeadM,
      theoreticalHeadM: eulerHeadM,
      frictionLossM,
      incidenceLossM,
      totalHydraulicLossM: totalLossM,
      hydraulicEfficiency,
      hydraulicEfficiencyPercent: hydraulicEfficiency === null ? null : Number((hydraulicEfficiency * 100).toFixed(1)),
      pressureRisePa,
      pressureRiseBar: pressureRisePa * 1e-5,
      hydraulicPowerW,
      hydraulicPowerKw: hydraulicPowerW * 1e-3,
      shaftPowerW,
      shaftPowerKw: shaftPowerW * 1e-3,
      brakePowerKw: shaftPowerW * 1e-3,
      validationLevel: 'velocity-triangle-stage-model'
    };
  }

  calculateMRFAcceleration(uRel, omegaVec, rVec) {
    const u = Array.isArray(uRel) ? { u: uRel[0], v: uRel[1], w: uRel[2] } : uRel;
    const r = Array.isArray(rVec) ? { x: rVec[0], y: rVec[1], z: rVec[2] } : rVec;
    const w = Array.isArray(omegaVec) ? omegaVec[2] : (typeof omegaVec === 'number' ? omegaVec : this.omega);

    const ax = 2.0 * w * (u.v || 0.0) + w * w * (r.x || 0.0);
    const ay = -2.0 * w * (u.u || 0.0) + w * w * (r.y || 0.0);
    const az = 0.0;
    const mag = Math.sqrt(ax * ax + ay * ay + az * az);

    return { x: ax, y: ay, z: az, magnitude: mag };
  }

  /**
   * Characteristic curve summary for a user-supplied outlet geometry. The
   * shutoff head is the Euler head at Q→0; the BEP flow is found by scanning
   * the computed hydraulic efficiency (no curve fit).
   */
  evaluateCentrifugalPumpCurve(r2, b2, beta2Deg, rpm) {
    const savedR2 = this.r2;
    const savedB2 = this.b2;
    const savedBeta = this.beta2Rad;
    const savedRpm = this.rpm;
    const savedOmega = this.omega;

    if (r2 !== undefined) this.r2 = r2;
    if (b2 !== undefined) this.b2 = b2;
    if (beta2Deg !== undefined) this.beta2Rad = (beta2Deg * Math.PI) / 180.0;
    if (rpm !== undefined) {
      this.rpm = rpm;
      this.omega = (rpm * 2.0 * Math.PI) / 60.0;
    }

    const sigma = this.computeSlipFactor();
    const shutoffHead = (this.omega * this.r2 * this.omega * this.r2 * sigma) / this.g;

    const zeroHeadQ = this.omega * this.r2 * Math.tan(this.beta2Rad) * 2.0 * Math.PI * this.r2 * this.b2;
    const scanMaxQ = Math.max(zeroHeadQ, 1e-3);
    const steps = 200;
    let bestQ = 1e-4;
    let bestEfficiency = -1;
    let bestOp = null;
    for (let i = 1; i <= steps; i++) {
      const q = 1e-4 + (scanMaxQ - 1e-4) * (i / steps);
      const op = this.evaluatePumpOperatingPoint(q);
      if (op.hydraulicEfficiency !== null && op.hydraulicEfficiency > bestEfficiency) {
        bestEfficiency = op.hydraulicEfficiency;
        bestQ = q;
        bestOp = op;
      }
    }

    // Restore
    this.r2 = savedR2;
    this.b2 = savedB2;
    this.beta2Rad = savedBeta;
    this.rpm = savedRpm;
    this.omega = savedOmega;

    return {
      shutoffHeadM: shutoffHead,
      bepQ: bestQ,
      bepFlowM3H: bestQ * 3600.0,
      bepHeadM: bestOp ? bestOp.theoreticalHeadM : 0,
      hydraulicPowerKw: bestOp ? bestOp.hydraulicPowerKw : 0,
      shaftPowerKw: bestOp ? bestOp.shaftPowerKw : 0,
      efficiencyPercent: bestOp ? bestOp.hydraulicEfficiencyPercent : null,
      slipFactor: sigma,
      stageModel: 'velocity-triangle-stage-model'
    };
  }
}

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SlidingMeshTurbomachinery };
}
if (typeof window !== 'undefined') {
  window.SlidingMeshTurbomachinery = SlidingMeshTurbomachinery;
}
