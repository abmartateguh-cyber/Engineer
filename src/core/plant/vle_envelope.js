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
  static generatePTEnvelope(composition, pMinBar, pMaxBar, points, componentProperties, tMinC, tMaxC) {
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
    if (!Number.isFinite(tMinC) || !Number.isFinite(tMaxC) || tMinC <= -273.15 || tMaxC <= tMinC) {
      throw new RangeError(
        'Explicit temperature bounds must be finite, above absolute zero, and increasing in Celsius.'
      );
    }

    const envelope = [];
    const logPMin = Math.log10(pMinBar);
    const logPMax = Math.log10(pMaxBar);
    const step = (logPMax - logPMin) / (points - 1);

    for (let i = 0; i < points; i++) {
      const pBar = Math.pow(10, logPMin + i * step);
      const bubble = this._findSaturationTemp(composition, pBar, 0.001, componentProperties, tMinC, tMaxC);
      const dew = this._findSaturationTemp(composition, pBar, 0.999, componentProperties, tMinC, tMaxC);
      const hasOrderedSaturationPoints =
        Number.isFinite(bubble.temperatureC) &&
        Number.isFinite(dew.temperatureC) &&
        bubble.temperatureC <= dew.temperatureC;

      envelope.push({
        pressureBar: Number(pBar.toFixed(2)),
        status: hasOrderedSaturationPoints ? 'experimental-estimate' : 'unavailable',
        bubblePointStatus: bubble.status,
        bubblePointIterations: bubble.iterations,
        bubblePointResidual: bubble.residual,
        bubblePointTemperatureBracketC: bubble.temperatureBracketC,
        bubblePointTempC: Number.isFinite(bubble.temperatureC) ? Number(bubble.temperatureC.toFixed(1)) : null,
        dewPointStatus: dew.status,
        dewPointIterations: dew.iterations,
        dewPointResidual: dew.residual,
        dewPointTemperatureBracketC: dew.temperatureBracketC,
        dewPointTempC: Number.isFinite(dew.temperatureC) ? Number(dew.temperatureC.toFixed(1)) : null,
        twoPhaseWidthC: hasOrderedSaturationPoints ? Number((dew.temperatureC - bubble.temperatureC).toFixed(1)) : null
      });
    }

    const availableDewPoints = envelope.map((point) => point.dewPointTempC).filter(Number.isFinite);

    return {
      status: 'experimental-estimate',
      validationLevel: 'experimental',
      dataStatus: 'caller-supplied-unverified-data',
      model: 'Wilson K-value estimates with bracketed bisection on Rachford-Rice; not a Peng-Robinson fugacity EOS',
      warnings: [
        'No independent phase-equilibrium reference is configured.',
        'Critical-point properties are not calculated.',
        'Temperature bounds are caller-supplied; targets outside their bracket are reported unavailable.'
      ],
      composition: { ...composition },
      componentProperties,
      temperatureBoundsC: { minimum: tMinC, maximum: tMaxC },
      sampledPressureMaxBar: Math.max(...envelope.map((point) => point.pressureBar)),
      sampledDewPointMaxC: availableDewPoints.length > 0 ? Math.max(...availableDewPoints) : null,
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

  static _findSaturationTemp(composition, pBar, targetBeta, componentProperties, tMinC, tMaxC) {
    const lowVaporFraction = ThermodynamicsEngine.flashVLE(composition, tMinC, pBar, componentProperties).vaporFraction;
    const highVaporFraction = ThermodynamicsEngine.flashVLE(
      composition,
      tMaxC,
      pBar,
      componentProperties
    ).vaporFraction;
    const lowResidual = lowVaporFraction - targetBeta;
    const highResidual = highVaporFraction - targetBeta;
    if (lowResidual === 0) {
      return {
        temperatureC: tMinC,
        status: 'converged',
        iterations: 0,
        residual: lowResidual,
        temperatureBracketC: [tMinC, tMinC]
      };
    }
    if (highResidual === 0) {
      return {
        temperatureC: tMaxC,
        status: 'converged',
        iterations: 0,
        residual: highResidual,
        temperatureBracketC: [tMaxC, tMaxC]
      };
    }
    if (Math.sign(lowResidual) === Math.sign(highResidual)) {
      return {
        temperatureC: null,
        status: 'unbracketed',
        iterations: 0,
        residual: null,
        temperatureBracketC: null
      };
    }

    let tLow = tMinC;
    let tHigh = tMaxC;
    let residual = null;
    const maxIterations = 60;
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const tMid = (tLow + tHigh) / 2;
      const flash = ThermodynamicsEngine.flashVLE(composition, tMid, pBar, componentProperties);
      residual = flash.vaporFraction - targetBeta;
      if (Math.abs(residual) <= 1e-8) {
        return {
          temperatureC: tMid,
          status: 'converged',
          iterations: iteration,
          residual,
          temperatureBracketC: [tLow, tHigh]
        };
      }
      if (Math.sign(residual) === Math.sign(lowResidual)) {
        tHigh = tMid;
      } else {
        tLow = tMid;
      }
    }
    return {
      temperatureC: null,
      status: 'not-converged',
      iterations: maxIterations,
      residual,
      temperatureBracketC: [tLow, tHigh]
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VLEPhaseEnvelopeEngine };
}
