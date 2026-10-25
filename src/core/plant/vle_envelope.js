/**
 * Experimental Wilson/Rachford-Rice phase-envelope estimate.
 * Distillation tray data is unavailable until a sourced assay and independently reviewed
 * column model are configured.
 */

const { ThermodynamicsEngine } = require('./thermodynamics');

class VLEPhaseEnvelopeEngine {
  /**
   * Generates a range-limited P-T estimate using Wilson K-values and Rachford-Rice.
   * This is not a Peng-Robinson fugacity calculation or an independently validated result.
   */
  static generatePTEnvelope(composition, pMinBar, pMaxBar, points, componentProperties) {
    if (
      !composition ||
      typeof composition !== 'object' ||
      Array.isArray(composition) ||
      Object.keys(composition).length === 0
    ) {
      throw new TypeError('An explicit non-empty component composition is required.');
    }
    if (!Number.isFinite(pMinBar) || !Number.isFinite(pMaxBar) || pMinBar <= 0 || pMaxBar <= pMinBar) {
      throw new RangeError('Explicit pressure bounds must be finite, positive, and increasing in bar.');
    }
    if (!Number.isInteger(points) || points < 2 || points > 1000) {
      throw new RangeError('An explicit point count from 2 through 1000 is required.');
    }
    if (!componentProperties || typeof componentProperties !== 'object' || Array.isArray(componentProperties)) {
      throw new TypeError('Explicit component property records with source and license provenance are required.');
    }

    const envelope = [];
    const logPMin = Math.log10(pMinBar);
    const logPMax = Math.log10(pMaxBar);
    const step = (logPMax - logPMin) / (points - 1);

    for (let i = 0; i < points; i++) {
      const pBar = Math.pow(10, logPMin + i * step);
      const tBubble = this._findSaturationTemp(composition, pBar, 0.001, componentProperties);
      const tDew = this._findSaturationTemp(composition, pBar, 0.999, componentProperties);

      envelope.push({
        pressureBar: Number(pBar.toFixed(2)),
        bubblePointTempC: Number(tBubble.toFixed(1)),
        dewPointTempC: Number(tDew.toFixed(1)),
        twoPhaseWidthC: Number((tDew - tBubble).toFixed(1))
      });
    }

    return {
      status: 'experimental-estimate',
      validationLevel: 'experimental',
      dataStatus: 'caller-supplied-unverified-data',
      model: 'Wilson K-value estimates with bisection on Rachford-Rice; not a Peng-Robinson fugacity EOS',
      warnings: [
        'No independent phase-equilibrium reference is configured.',
        'Critical-point properties are not calculated.',
        'The bounded temperature search does not report a bracket or convergence diagnostic.'
      ],
      composition: { ...composition },
      componentProperties,
      sampledPressureMaxBar: Math.max(...envelope.map((point) => point.pressureBar)),
      sampledDewPointMaxC: Math.max(...envelope.map((point) => point.dewPointTempC)),
      points: envelope
    };
  }

  /** Legacy API retained while fabricated tray profiles are withdrawn. */
  static generateColumnTrayProfile() {
    return {
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message:
          'Column profiles are unavailable until a sourced crude assay, reviewed column model, and independent reference are configured.'
      }
    };
  }

  static _findSaturationTemp(composition, pBar, targetBeta, componentProperties) {
    let tLow = -40.0;
    let tHigh = 160.0;
    for (let iter = 0; iter < 15; iter++) {
      const tMid = (tLow + tHigh) / 2;
      const flash = ThermodynamicsEngine.flashVLE(composition, tMid, pBar, componentProperties);
      if (flash.vaporFraction > targetBeta) {
        tHigh = tMid;
      } else {
        tLow = tMid;
      }
    }
    return (tLow + tHigh) / 2;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VLEPhaseEnvelopeEngine };
}
