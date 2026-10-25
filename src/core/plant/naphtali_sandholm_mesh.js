/**
 * Legacy Plant calculation names retained for compatibility.
 * The former distillation and water-hammer simulations used bundled example
 * assumptions and did not establish convergence or independent validation.
 */

'use strict';

const UNAVAILABLE_MESSAGE =
  'This legacy calculation is unavailable until its physical model, required property data, and independent references are reviewed.';

function unavailableResult() {
  return {
    success: false,
    status: 'unavailable',
    validationLevel: 'experimental',
    error: { code: 'UNSUPPORTED', message: UNAVAILABLE_MESSAGE }
  };
}

class NaphtaliSandholmColumnSolver {
  /** The legacy routine is disabled because it used embedded K-value guesses. */
  static solve() {
    return unavailableResult();
  }
}

class WaterHammerMOC {
  /** The legacy transient simulation is disabled pending model review. */
  static solve() {
    return unavailableResult();
  }

  /** The legacy transient simulation is disabled pending model review. */
  static simulateMOC() {
    return unavailableResult();
  }

  /**
   * Evaluates the illustrative elastic-pipe wave-speed equation from explicit inputs.
   * This standalone estimate is experimental and does not assess piping-code compliance.
   */
  static computeWaveSpeed(spec) {
    const names = ['fluidBulkModulusPa', 'fluidDensityKgM3', 'pipeModulusPa', 'pipeDiameterM', 'wallThicknessM'];
    const missing = names.filter((name) => !Number.isFinite(spec?.[name]));
    if (missing.length) {
      throw new TypeError(`computeWaveSpeed requires explicit finite inputs: ${missing.join(', ')}.`);
    }
    const {
      fluidBulkModulusPa: K,
      fluidDensityKgM3: rho,
      pipeModulusPa: E,
      pipeDiameterM: D,
      wallThicknessM: t
    } = spec;
    if (K <= 0 || rho <= 0 || E <= 0 || D <= 0 || t <= 0 || t >= D / 2) {
      throw new RangeError('Wave-speed inputs are outside the supported positive geometry and property ranges.');
    }

    return Math.sqrt(K / rho) / Math.sqrt(1 + (K / E) * (D / t));
  }

  /** Explicit Joukowsky relation for a specified fluid, wave speed, and velocity change. */
  static computeJoukowskySurge(fluidDensityKgM3, waveSpeedMs, initialVelocityMs) {
    if (
      !Number.isFinite(fluidDensityKgM3) ||
      fluidDensityKgM3 <= 0 ||
      !Number.isFinite(waveSpeedMs) ||
      waveSpeedMs <= 0 ||
      !Number.isFinite(initialVelocityMs)
    ) {
      throw new TypeError('computeJoukowskySurge requires positive density and wave speed and a finite velocity.');
    }
    const pressureSurgePa = fluidDensityKgM3 * waveSpeedMs * initialVelocityMs;
    const headSurgeM = (waveSpeedMs * initialVelocityMs) / 9.80665;
    return { pressureSurgePa, headSurgeM };
  }
}

module.exports = {
  NaphtaliSandholmColumnSolver,
  WaterHammerMOC
};
