/**
 * Experimental single-aggressor lumped crosstalk estimate using explicit inputs.
 * No coupled-wire extraction, multi-aggressor superposition, cell noise curve,
 * independent validation, or signoff analysis is included.
 */

'use strict';

class SignalIntegrityCrosstalkAnalyzer {
  /**
   * Evaluates a single-aggressor lumped crosstalk estimate.
   * @param {Object} spec
   * @param {number} [spec.pulseWidthTimeConstantFactor] Optional caller-supplied pulse-width approximation factor
   * @returns {Object} Experimental peak estimate and comparison with the supplied threshold
   */
  static evaluateCrosstalkGlitch(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new TypeError('Caller-supplied crosstalk inputs are required.');
    }
    const V_agg = spec.aggressorVoltageSwingV ?? spec.vdd;
    requirePositive(V_agg, 'aggressorVoltageSwingV');
    if (spec.vdd !== undefined) requirePositive(spec.vdd, 'vdd');

    let tr;
    if (spec.aggressorTransitionTimeSeconds !== undefined) {
      tr = spec.aggressorTransitionTimeSeconds;
    } else if (spec.aggressorTransitionTimePs !== undefined) {
      tr = spec.aggressorTransitionTimePs * 1e-12;
    } else {
      const slewRate = spec.aggressorSlewRateVPerSecond ?? spec.aggressorSlewRate;
      requirePositive(slewRate, 'aggressorSlewRateVPerSecond');
      tr = V_agg / slewRate;
    }
    requirePositive(tr, 'aggressor transition time');

    const Cc = spec.couplingCapacitanceFf !== undefined ? spec.couplingCapacitanceFf * 1e-15 : spec.couplingCapacitance;
    const Cv =
      spec.victimGroundCapacitanceFf !== undefined
        ? spec.victimGroundCapacitanceFf * 1e-15
        : spec.victimGroundCapacitance;
    requireNonNegative(Cc, 'couplingCapacitance');
    requirePositive(Cv, 'victimGroundCapacitance');

    const Rd = spec.victimDriverResistanceOhms ?? spec.victimDriverResistance;
    requirePositive(Rd, 'victimDriverResistanceOhms');
    const Vth = spec.noiseMarginThresholdV;
    requireNonNegative(Vth, 'noiseMarginThresholdV');

    const C_total = Cc + Cv;
    const tau = Rd * C_total; // Victim net discharge time constant
    requirePositive(tau, 'victim net time constant');

    // Peak coupling amplitude
    const capRatio = Cc / C_total;
    // Dynamic charge transfer factor based on aggressor slew vs victim discharge
    const transitionRatio = tr / tau;
    const slewResponseFactor = transitionRatio === 0 ? 1 : -Math.expm1(-transitionRatio) / transitionRatio;
    const peakGlitchV = V_agg * capRatio * Math.min(1.0, slewResponseFactor);
    if (!Number.isFinite(peakGlitchV)) throw new RangeError('Crosstalk estimate is outside the finite numeric range.');

    let pulseWidthEstimateSeconds = null;
    let pulseWidthEstimatePs = null;
    if (spec.pulseWidthTimeConstantFactor !== undefined) {
      requirePositive(spec.pulseWidthTimeConstantFactor, 'pulseWidthTimeConstantFactor');
      pulseWidthEstimateSeconds = Math.max(tr, spec.pulseWidthTimeConstantFactor * tau);
      requireFinite(pulseWidthEstimateSeconds, 'pulse width estimate');
      pulseWidthEstimatePs = Number((pulseWidthEstimateSeconds * 1e12).toFixed(1));
      requireFinite(pulseWidthEstimatePs, 'pulse width estimate in picoseconds');
    }

    const belowSuppliedThreshold = peakGlitchV <= Vth;
    const timeConstantPs = tau * 1e12;
    requireFinite(timeConstantPs, 'victim net time constant in picoseconds');

    return {
      peakGlitchVoltageV: Number(peakGlitchV.toFixed(4)),
      vPeakVolts: peakGlitchV,
      peakGlitchPercentageOfSwing: Number(((peakGlitchV / V_agg) * 100).toFixed(1)),
      noiseMarginThresholdV: Vth,
      pulseWidthEstimatePs,
      pulseWidthEstimateSeconds,
      // Legacy FWHM fields remain but are unavailable without a waveform model.
      pulseWidthFwhmPs: null,
      fwhmSeconds: null,
      pulseWidthSemantics:
        pulseWidthEstimateSeconds === null
          ? 'unavailable; no transient waveform model'
          : 'caller-supplied factor estimate; not a waveform-derived FWHM',
      // Legacy name retained; this percentage is relative to the supplied aggressor swing.
      peakGlitchPercentageVDD: spec.vdd === undefined ? null : Number(((peakGlitchV / spec.vdd) * 100).toFixed(1)),
      victimNetTimeConstantPs: Number(timeConstantPs.toFixed(2)),
      capacitiveCouplingRatio: Number(capRatio.toFixed(3)),
      belowSuppliedNoiseThreshold: belowSuppliedThreshold,
      thresholdComparison: belowSuppliedThreshold ? 'below-supplied-threshold' : 'above-supplied-threshold',
      dataStatus: 'caller-supplied-unverified',
      validationLevel: 'experimental'
    };
  }

  calculateGlitchAmplitude(params) {
    return SignalIntegrityCrosstalkAnalyzer.evaluateCrosstalkGlitch(params);
  }
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number.`);
}

function requirePositive(value, label) {
  requireFinite(value, label);
  if (value <= 0) throw new RangeError(`${label} must be greater than zero.`);
}

function requireNonNegative(value, label) {
  requireFinite(value, label);
  if (value < 0) throw new RangeError(`${label} must not be negative.`);
}

const SignalIntegrityCrosstalk = SignalIntegrityCrosstalkAnalyzer;

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SignalIntegrityCrosstalkAnalyzer, SignalIntegrityCrosstalk };
}
if (typeof window !== 'undefined') {
  window.SignalIntegrityCrosstalkAnalyzer = SignalIntegrityCrosstalkAnalyzer;
  window.SignalIntegrityCrosstalk = SignalIntegrityCrosstalk;
}
