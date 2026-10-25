/**
 * OmniEng Multi-Corner Multi-Mode (MCMM) Static Timing Analysis & CDC Engine
 *
 * Experimental static timing and clock-domain screening calculations:
 * 1. Multi-Corner Multi-Mode (MCMM) verification across PVT process corners:
 *    - WCS (Worst-Case Slow): 0.90V, 125C, Slow-Slow process (Setup checks).
 *    - BCF (Best-Case Fast): 1.10V, -40C, Fast-Fast process (Hold checks).
 *    - TYP (Typical): 1.00V, 25C, Typical process.
 * 2. Setup Slack = T_period - (T_cq + T_comb + T_setup + T_skew).
 * 3. Hold Slack = (T_cq + T_comb) - (T_hold + T_skew).
 * 4. Clock Domain Crossing (CDC) synchronizer detection and Mean Time Between Failures (MTBF).
 *
 * No source-qualified timing libraries, independent validation, or signoff timing closure is included.
 */

'use strict';

class MCMMTimingCorner {
  /**
   * @param {string} name - 'WCS', 'BCF', 'TYP'
   * @param {number} voltage - Core voltage (V)
   * @param {number} temperatureC - Temperature in Celsius
   * @param {number} processScale - Derating factor for cell delay
   */
  constructor(name, voltage, temperatureC, processScale) {
    this.name = name;
    this.voltage = voltage;
    this.temperatureC = temperatureC;
    this.processScale = processScale; // Caller-supplied multiplier for this experimental screen
  }
}

class MCMMStaticTimingEngine {
  /**
   * Evaluates an experimental timing screen using caller-supplied path assumptions and corners.
   * @param {Object} pathSpec
   * @param {number} pathSpec.clockPeriodNs - Target clock period (e.g. 1.0 ns for 1 GHz)
   * @param {number} pathSpec.logicDelayTypNs - Typical combinational logic path delay (ns)
   * @param {number} pathSpec.clockSkewNs - Caller-supplied clock skew (ns)
   * @param {number} pathSpec.tCqTypNs - Caller-supplied clock-to-Q delay (ns)
   * @param {number} pathSpec.tSetupTypNs - Caller-supplied setup time (ns)
   * @param {number} pathSpec.tHoldTypNs - Caller-supplied hold time (ns)
   * @param {Array<{name: string, voltage: number, temperatureC: number, processScale: number}>} pathSpec.corners
   * @returns {Object} Corner-by-corner experimental timing-screen estimates
   */
  static runMCMMAnalysis(pathSpec) {
    const requiredFields = ['clockPeriodNs', 'logicDelayTypNs', 'clockSkewNs', 'tCqTypNs', 'tSetupTypNs', 'tHoldTypNs'];
    if (!pathSpec || typeof pathSpec !== 'object') {
      throw new TypeError('Timing-screen inputs are required');
    }
    const missingFields = requiredFields.filter((field) => pathSpec[field] === undefined);
    if (missingFields.length > 0) {
      throw new TypeError(`Missing required timing-screen inputs: ${missingFields.join(', ')}`);
    }
    for (const field of requiredFields) {
      if (!Number.isFinite(pathSpec[field]) || pathSpec[field] < 0) {
        throw new TypeError(`Timing-screen input '${field}' must be a finite non-negative number`);
      }
    }
    if (pathSpec.clockPeriodNs === 0) {
      throw new TypeError("Timing-screen input 'clockPeriodNs' must be greater than zero");
    }
    if (!Array.isArray(pathSpec.corners) || pathSpec.corners.length === 0) {
      throw new TypeError('At least one caller-supplied timing corner is required');
    }
    for (const [index, corner] of pathSpec.corners.entries()) {
      if (!corner || typeof corner.name !== 'string' || corner.name.length === 0) {
        throw new TypeError(`Timing corner ${index} requires a non-empty name`);
      }
      for (const field of ['voltage', 'temperatureC', 'processScale']) {
        if (!Number.isFinite(corner[field])) {
          throw new TypeError(`Timing corner ${index} field '${field}' must be finite`);
        }
      }
      if (corner.voltage <= 0 || corner.processScale <= 0) {
        throw new TypeError(`Timing corner ${index} voltage and processScale must be positive`);
      }
    }

    const { clockPeriodNs, logicDelayTypNs, clockSkewNs, tCqTypNs, tSetupTypNs, tHoldTypNs } = pathSpec;

    const corners = pathSpec.corners.map(
      (corner) => new MCMMTimingCorner(corner.name, corner.voltage, corner.temperatureC, corner.processScale)
    );

    const cornerResults = [];
    let worstSetupSlack = Infinity;
    let worstHoldSlack = Infinity;

    for (const c of corners) {
      // Scale delays according to process, voltage, temperature
      const tCq = tCqTypNs * c.processScale;
      const tLogic = logicDelayTypNs * c.processScale;
      const tSetup = tSetupTypNs * c.processScale;
      const tHold = tHoldTypNs * c.processScale;

      // Setup path arrival time: T_arrival = T_cq + T_logic
      const arrivalSetup = tCq + tLogic;
      // Setup required time: T_required = T_period - T_setup - T_skew
      const requiredSetup = clockPeriodNs - tSetup - clockSkewNs;
      const setupSlack = requiredSetup - arrivalSetup;

      // Hold arrival time: T_arrival = T_cq + T_logic
      const arrivalHold = tCq + tLogic;
      // Hold required time: T_required = T_hold + T_skew
      const requiredHold = tHold + clockSkewNs;
      const holdSlack = arrivalHold - requiredHold;

      if (
        ![
          tCq,
          tLogic,
          tSetup,
          tHold,
          arrivalSetup,
          requiredSetup,
          setupSlack,
          arrivalHold,
          requiredHold,
          holdSlack
        ].every(Number.isFinite)
      ) {
        throw new RangeError(`Timing corner '${c.name}' produced a non-finite estimate`);
      }

      if (setupSlack < worstSetupSlack) worstSetupSlack = setupSlack;
      if (holdSlack < worstHoldSlack) worstHoldSlack = holdSlack;

      cornerResults.push({
        corner: c.name,
        voltage: c.voltage,
        temperatureC: c.temperatureC,
        arrivalSetupNs: Number(arrivalSetup.toFixed(4)),
        requiredSetupNs: Number(requiredSetup.toFixed(4)),
        setupSlackNs: Number(setupSlack.toFixed(4)),
        holdSlackNs: Number(holdSlack.toFixed(4)),
        setupMet: setupSlack >= 0,
        holdMet: holdSlack >= 0
      });
    }

    const screeningPassed = worstSetupSlack >= 0 && worstHoldSlack >= 0;
    const clockFrequencyMHz = 1000.0 / clockPeriodNs;
    if (![clockFrequencyMHz, worstSetupSlack, worstHoldSlack].every(Number.isFinite)) {
      throw new RangeError('Timing inputs produced a non-finite screening result');
    }

    return {
      clockPeriodNs,
      clockFrequencyMHz: Number(clockFrequencyMHz.toFixed(1)),
      worstSetupSlackNs: Number(worstSetupSlack.toFixed(4)),
      worstHoldSlackNs: Number(worstHoldSlack.toFixed(4)),
      screeningPassed,
      validationLevel: 'experimental',
      verdict: screeningPassed ? 'EXPERIMENTAL_TIMING_SCREEN_CLEAR' : 'EXPERIMENTAL_TIMING_SCREEN_FLAGS',
      cornerResults
    };
  }

  /**
   * Evaluates Clock Domain Crossing (CDC) synchronizer MTBF
   * MTBF = e^(tau / C2) / (C1 * f_clk * f_data)
   *
   * @param {number} fClkHz - Destination domain clock frequency (Hz)
   * @param {number} fDataHz - Source domain asynchronous transition rate (Hz)
   * @param {number} numFlops - Number of synchronizer flip-flops (typically 2 or 3)
   * @returns {{mtbfYears: number, validationLevel: 'experimental'}}
   */
  static evaluateCDCSynchronizer(fClkHz, fDataHz, numFlops, C1, C2) {
    const inputs = { fClkHz, fDataHz, numFlops, C1, C2 };
    for (const [name, value] of Object.entries(inputs)) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new TypeError(`CDC input '${name}' must be a positive finite number`);
      }
    }
    if (!Number.isInteger(numFlops) || numFlops < 2) {
      throw new TypeError("CDC input 'numFlops' must be an integer of at least 2");
    }
    const period = 1.0 / fClkHz;
    const resolvingTime = (numFlops - 1) * period;

    // MTBF in seconds
    const mtbfSec = Math.exp(resolvingTime / C2) / (C1 * fClkHz * fDataHz);
    const mtbfYears = mtbfSec / (365.25 * 86400);

    return {
      numSyncFlops: numFlops,
      clockFrequencyMHz: fClkHz / 1e6,
      dataRateMHz: fDataHz / 1e6,
      mtbfYears: Number(mtbfYears.toExponential(3)),
      validationLevel: 'experimental'
    };
  }
}

module.exports = {
  MCMMTimingCorner,
  MCMMStaticTimingEngine
};
