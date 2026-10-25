/**
 * Experimental reduced-order cantilever response estimate.
 *
 * This calculation applies a formula-based deflection adjustment. It does not
 * assemble or solve finite-element equations and exposes no residual or
 * convergence result. Inputs use millimetres, megapascals, and newtons.
 */

'use strict';

class CantileverResponseEstimator {
  constructor(options = {}) {
    const sampleCount = options.sampleCount ?? options.numLoadSteps ?? 10;
    if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 1000) {
      throw new Error('sampleCount must be an integer from 2 to 1000.');
    }
    this.sampleCount = sampleCount;
  }

  solveLargeDeflectionCantilever(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new Error('Explicit beam dimensions, material modulus, load, and units are required.');
    }

    const required = ['length', 'width', 'height', 'E', 'P', 'lengthUnit', 'modulusUnit', 'forceUnit'];
    const missing = required.filter(key => params[key] === undefined || params[key] === null);
    if (missing.length > 0) {
      throw new Error(`Explicit length, width, height, E, P, and units are required; missing: ${missing.join(', ')}.`);
    }

    const unexpected = Object.keys(params).filter(key => !required.includes(key));
    if (unexpected.length > 0) {
      throw new Error(`Unexpected cantilever estimate inputs: ${unexpected.join(', ')}.`);
    }

    if (params.lengthUnit !== 'mm' || params.modulusUnit !== 'MPa' || params.forceUnit !== 'N') {
      throw new Error('Cantilever estimate units must be mm, MPa, and N.');
    }

    const { length, width, height, E, P } = params;
    const values = { length, width, height, E, P };
    const invalid = Object.entries(values).filter(([, value]) => !Number.isFinite(value) || value <= 0);
    if (invalid.length > 0) {
      throw new Error(`Cantilever estimate inputs must be finite and positive: ${invalid.map(([key]) => key).join(', ')}.`);
    }

    const secondMomentMm4 = (width * height ** 3) / 12;
    const linearTipDeflectionMm = (P * length ** 3) / (3 * E * secondMomentMm4);
    if (!Number.isFinite(secondMomentMm4) || secondMomentMm4 <= 0 || !Number.isFinite(linearTipDeflectionMm)) {
      throw new Error('Cantilever inputs exceed the finite range of the estimate formula.');
    }
    const loadSamples = [];

    for (let sample = 1; sample <= this.sampleCount; sample++) {
      const loadFraction = sample / this.sampleCount;
      const appliedLoadN = loadFraction * P;
      const linearDeflectionMm = (appliedLoadN * length ** 3) / (3 * E * secondMomentMm4);
      const adjustment = 1 / Math.sqrt(1 + 0.45 * (linearDeflectionMm / length) ** 2);
      const estimateMm = linearDeflectionMm * adjustment;
      const axialShorteningMm = estimateMm ** 2 / (2.5 * length);
      if (![linearDeflectionMm, adjustment, estimateMm, axialShorteningMm].every(Number.isFinite)) {
        throw new Error('Cantilever inputs exceed the finite range of the estimate formula.');
      }

      loadSamples.push({
        loadFraction,
        appliedLoadN: Math.round(appliedLoadN * 100) / 100,
        linearDeflectionMm: Math.round(linearDeflectionMm * 100) / 100,
        estimatedDeflectionMm: Math.round(estimateMm * 100) / 100,
        estimatedAxialShorteningMm: Math.round(axialShorteningMm * 100) / 100
      });
    }

    const finalSample = loadSamples.at(-1);
    const nonlinearTipDeflectionMm = finalSample.estimatedDeflectionMm;
    const formulaAdjustmentPercent =
      Math.round(((linearTipDeflectionMm - nonlinearTipDeflectionMm) / linearTipDeflectionMm) * 1000) / 10;
    const compatibilityLoadSteps = loadSamples.map((sample, index) => ({
      step: index + 1,
      loadFraction: sample.loadFraction,
      appliedLoadN: sample.appliedLoadN,
      tipDeflectionMm: sample.estimatedDeflectionMm,
      axialShorteningMm: sample.estimatedAxialShorteningMm,
      linearDeflectionMm: sample.linearDeflectionMm,
      stiffeningFactor: sample.linearDeflectionMm / sample.estimatedDeflectionMm
    }));

    return {
      validationLevel: 'experimental',
      status: 'ESTIMATE_ONLY',
      model: 'Formula-based reduced-order cantilever response estimate',
      units: { length: 'mm', force: 'N', modulus: 'MPa' },
      inputs: { ...params },
      assumptions: [
        'Straight prismatic cantilever with a rectangular cross-section.',
        'Homogeneous isotropic linear-elastic material represented by one Young’s modulus.',
        'Transverse point load applied at the free end.',
        'Nonlinear response is an unvalidated formula adjustment to the linear beam estimate.'
      ],
      linearTipDeflectionMm: Math.round(linearTipDeflectionMm * 100) / 100,
      formulaAdjustedTipDeflectionMm: nonlinearTipDeflectionMm,
      formulaAdjustmentPercent,
      // Deprecated names retained for existing callers; both describe formula estimates only.
      nonlinearTipDeflectionMm,
      geometricStiffeningPercent: formulaAdjustmentPercent,
      loadSamples,
      // Legacy result shape retained; the former iteration/convergence fields were fabricated.
      loadSteps: compatibilityLoadSteps,
      summary: { status: 'ESTIMATE_ONLY', sampleCount: this.sampleCount, totalSteps: this.sampleCount }
    };
  }
}

module.exports = {
  CantileverResponseEstimator,
  // Compatibility name retained for existing callers; this is not a finite-element solver.
  NonlinearLargeDeflectionSolver: CantileverResponseEstimator
};
