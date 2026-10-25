/**
 * OmniEng Static Timing Analysis (STA) & Parasitic RC Extraction (PEX) Engine
 * Experimental Elmore-style delay and path screening utilities.
 * This is not signoff STA and is not correlated to a foundry timing library or routed design.
 */

class StaticTimingAnalysis {
  /**
   * Evaluates microstrip wire parasitic RC values and Elmore interconnect delay.
   * @param {Object} wireParams
   *   lengthMm: Length in mm
   *   widthUm: Width in microns (e.g. 2.0 um)
   *   thicknessUm: Copper thickness (e.g. 0.5 um)
   *   dielectricHeightUm: Distance to ground plane (e.g. 1.5 um)
   *   dielectricConstant: Relative permittivity eps_r (e.g. 3.9 for SiO2, 4.3 for FR4)
   *   resistivityOhmM: e.g. 1.68e-8 for Copper
   */
  static extractParasitics(wireParams = {}) {
    const {
      lengthMm = 1.0,
      widthUm = 2.0,
      thicknessUm = 0.5,
      dielectricHeightUm = 1.5,
      dielectricConstant = 3.9,
      resistivityOhmM = 1.68e-8
    } = wireParams;

    const eps0 = 8.8541878e-12; // F/m
    const epsR = dielectricConstant;

    const L_m = lengthMm * 1e-3;
    const w_m = widthUm * 1e-6;
    const t_m = thicknessUm * 1e-6;
    const h_m = dielectricHeightUm * 1e-6;

    // 1. Conductor Resistance: R = rho * L / (w * t)
    const area = w_m * t_m;
    const Rwire = (resistivityOhmM * L_m) / area;

    // 2. Parallel plate capacitance: Cpp = eps0 * epsR * w / h
    const Cpp = (eps0 * epsR * w_m) / h_m;

    // 3. Fringe capacitance (Palmer / Sakurai formula):
    const wh = w_m / h_m;
    const Cfringe = (eps0 * epsR) * (0.77 + 1.06 * Math.pow(wh, 0.25) + 1.06 * Math.pow(t_m / h_m, 0.5));

    const totalC_per_meter = Cpp + 2.0 * Cfringe;
    const Cwire = totalC_per_meter * L_m; // in Farads

    return {
      lengthMm,
      resistanceOhms: Number(Rwire.toFixed(3)),
      capacitancePf: Number((Cwire * 1e12).toFixed(4)),
      resistancePerMm: Number((Rwire / lengthMm).toFixed(3)),
      capacitancePfPerMm: Number(((Cwire * 1e12) / lengthMm).toFixed(4))
    };
  }

  /**
   * Computes the Elmore Delay for an RC driver-interconnect-load stage.
   * tau = R_driver * (C_wire + C_load) + R_wire * (0.5 * C_wire + C_load)
   */
  static computeElmoreDelay(Rdriver, Rwire, Cwire, Cload) {
    const tauSeconds = Rdriver * (Cwire + Cload) + Rwire * (0.5 * Cwire + Cload);
    return Number((tauSeconds * 1e9).toFixed(4)); // Delay in nanoseconds (ns)
  }

  /**
   * Evaluates Setup and Hold slack across a digital timing path.
   * @param {Object} pathData Configuration of timing path:
   *   clockPeriodNs: Clock cycle time (e.g. 5.0 ns for 200 MHz)
   *   clockSkewNs: T_capture_clk - T_launch_clk (e.g. 0.05 ns)
   *   tLaunchCqNs: Flip-flop Clock-to-Q delay (e.g. 0.35 ns)
   *   tSetupNs: Capture flip-flop setup time requirement (e.g. 0.15 ns)
   *   tHoldNs: Capture flip-flop hold time requirement (e.g. 0.08 ns)
   *   gateDelaysNs: Array of logic gate delays along the path
   *   wireDelaysNs: Array of interconnect delays along the path
   */
  static evaluatePathTiming(pathData = {}) {
    const {
      name = 'Critical_Path_0',
      clockPeriodNs = 5.0,
      clockSkewNs = 0.0,
      tLaunchCqNs = 0.35,
      tSetupNs = 0.15,
      tHoldNs = 0.08,
      gateDelaysNs = [0.25, 0.30, 0.28, 0.32],
      wireDelaysNs = [0.08, 0.12, 0.10, 0.14]
    } = pathData;

    // Sum combinational logic and wire delays
    const totalGateDelay = gateDelaysNs.reduce((a, b) => a + b, 0);
    const totalWireDelay = wireDelaysNs.reduce((a, b) => a + b, 0);
    const totalCombDelay = totalGateDelay + totalWireDelay;

    // 1. Data Arrival Time: T_arr = T_cq + T_comb
    const arrivalTimeNs = tLaunchCqNs + totalCombDelay;

    // 2. Setup Required Time: T_req_setup = T_clk + T_skew - T_setup
    const reqSetupTimeNs = clockPeriodNs + clockSkewNs - tSetupNs;
    const setupSlackNs = reqSetupTimeNs - arrivalTimeNs;

    // 3. Hold Required Time: T_req_hold = T_skew + T_hold
    const reqHoldTimeNs = clockSkewNs + tHoldNs;
    const holdSlackNs = arrivalTimeNs - reqHoldTimeNs;

    const maxFrequencyMHz = 1000.0 / (arrivalTimeNs + tSetupNs - clockSkewNs);

    return {
      pathName: name,
      clockPeriodNs,
      targetFrequencyMHz: Math.round(1000.0 / clockPeriodNs),
      maxAchievableFrequencyMHz: Math.round(maxFrequencyMHz),
      arrivalTimeNs: Number(arrivalTimeNs.toFixed(3)),
      reqSetupTimeNs: Number(reqSetupTimeNs.toFixed(3)),
      setupSlackNs: Number(setupSlackNs.toFixed(3)),
      holdSlackNs: Number(holdSlackNs.toFixed(3)),
      setupSlackPs: Number((setupSlackNs * 1000).toFixed(1)),
      holdSlackPs: Number((holdSlackNs * 1000).toFixed(1)),
      isSetupMet: setupSlackNs >= 0,
      isHoldMet: holdSlackNs >= 0,
      status: (setupSlackNs >= 0 && holdSlackNs >= 0) ? 'TIMING_MET' : (setupSlackNs < 0 ? 'SETUP_VIOLATION' : 'HOLD_VIOLATION'),
      breakdown: {
        clockToQ_ns: tLaunchCqNs,
        logicDelay_ns: Number(totalGateDelay.toFixed(3)),
        interconnectDelay_ns: Number(totalWireDelay.toFixed(3))
      }
    };
  }

  /**
   * Multi-Corner Multi-Mode (MCMM) Timing Closure with On-Chip Variation (OCV) Derating
   * Evaluates setup across slow/late corners and hold across fast/early corners.
   *
   * @param {Object} pathData Base path configuration
   * @param {Array<Object>} [corners] Array of PVT corner specs
   * @returns {Object} Experimental MCMM-style screening result
   */
  static evaluateMCMM(pathData = {}, customCorners = null) {
    const defaultCorners = [
      { name: 'ss_100C_1v60', pvtFactor: 1.25, ocvLate: 1.08, ocvEarly: 0.95, desc: 'Slow-Slow 100°C 1.60V (Worst Setup)' },
      { name: 'tt_025C_1v80', pvtFactor: 1.00, ocvLate: 1.05, ocvEarly: 0.98, desc: 'Typical-Typical 25°C 1.80V (Nominal)' },
      { name: 'ff_n40C_1v95', pvtFactor: 0.80, ocvLate: 1.02, ocvEarly: 0.90, desc: 'Fast-Fast -40°C 1.95V (Worst Hold)' }
    ];

    const corners = customCorners || defaultCorners;
    const cornerReports = [];
    let worstSetupSlackNs = Infinity;
    let worstHoldSlackNs = Infinity;
    let worstSetupCorner = null;
    let worstHoldCorner = null;

    const baseGateDelays = pathData.gateDelaysNs || [0.25, 0.30, 0.28, 0.32];
    const baseWireDelays = pathData.wireDelaysNs || [0.08, 0.12, 0.10, 0.14];
    const baseTcq = pathData.tLaunchCqNs || 0.35;
    const baseClockPeriod = pathData.clockPeriodNs || 5.0;
    const baseSetup = pathData.tSetupNs || 0.15;
    const baseHold = pathData.tHoldNs || 0.08;

    for (const corner of corners) {
      // 1. Setup analysis: data path is LATE (pvtFactor * ocvLate)
      const lateFactor = corner.pvtFactor * corner.ocvLate;
      const setupGateDelays = baseGateDelays.map(d => d * lateFactor);
      const setupWireDelays = baseWireDelays.map(d => d * lateFactor);
      const setupTcq = baseTcq * lateFactor;

      const setupRes = StaticTimingAnalysis.evaluatePathTiming({
        name: `${pathData.name || 'path'}_${corner.name}_setup`,
        clockPeriodNs: baseClockPeriod,
        clockSkewNs: pathData.clockSkewNs || 0.0,
        tLaunchCqNs: setupTcq,
        tSetupNs: baseSetup * corner.pvtFactor,
        tHoldNs: baseHold * corner.pvtFactor,
        gateDelaysNs: setupGateDelays,
        wireDelaysNs: setupWireDelays
      });

      // 2. Hold analysis: data path is EARLY (pvtFactor * ocvEarly)
      const earlyFactor = corner.pvtFactor * corner.ocvEarly;
      const holdGateDelays = baseGateDelays.map(d => d * earlyFactor);
      const holdWireDelays = baseWireDelays.map(d => d * earlyFactor);
      const holdTcq = baseTcq * earlyFactor;

      const holdRes = StaticTimingAnalysis.evaluatePathTiming({
        name: `${pathData.name || 'path'}_${corner.name}_hold`,
        clockPeriodNs: baseClockPeriod,
        clockSkewNs: pathData.clockSkewNs || 0.0,
        tLaunchCqNs: holdTcq,
        tSetupNs: baseSetup * corner.pvtFactor,
        tHoldNs: baseHold * corner.pvtFactor,
        gateDelaysNs: holdGateDelays,
        wireDelaysNs: holdWireDelays
      });

      if (setupRes.setupSlackNs < worstSetupSlackNs) {
        worstSetupSlackNs = setupRes.setupSlackNs;
        worstSetupCorner = corner.name;
      }

      if (holdRes.holdSlackNs < worstHoldSlackNs) {
        worstHoldSlackNs = holdRes.holdSlackNs;
        worstHoldCorner = corner.name;
      }

      cornerReports.push({
        corner: corner.name,
        description: corner.desc,
        setupSlackNs: setupRes.setupSlackNs,
        setupSlackPs: setupRes.setupSlackPs,
        isSetupMet: setupRes.isSetupMet,
        holdSlackNs: holdRes.holdSlackNs,
        holdSlackPs: holdRes.holdSlackPs,
        isHoldMet: holdRes.isHoldMet,
        maxFrequencyMHz: setupRes.maxAchievableFrequencyMHz
      });
    }

    return {
      validationLevel: 'experimental',
      model: 'illustrative PVT and OCV delay scaling',
      pathName: pathData.name || 'Critical_Path_0',
      cornerCount: corners.length,
      worstNegativeSlackSetupNs: Number(worstSetupSlackNs.toFixed(3)),
      worstNegativeSlackHoldNs: Number(worstHoldSlackNs.toFixed(3)),
      worstNegativeSlackSetupPs: Number((worstSetupSlackNs * 1000).toFixed(1)),
      worstNegativeSlackHoldPs: Number((worstHoldSlackNs * 1000).toFixed(1)),
      worstSetupCorner,
      worstHoldCorner,
      screeningPassed: worstSetupSlackNs >= 0 && worstHoldSlackNs >= 0,
      cornerReports
    };
  }

  constructor(opts = {}) {
    this.clockPeriodPs = opts.clockPeriodPs || 5000.0;
  }

  analyzePath(pathData = {}) {
    let wireDelayPs = 0;
    if (pathData.interconnectTrace) {
      const trace = pathData.interconnectTrace;
      const pex = StaticTimingAnalysis.extractParasitics({
        lengthMm: (trace.lengthUm || 1000) / 1000,
        widthUm: trace.widthUm || 1.0,
        thicknessUm: trace.thicknessUm || 0.5,
        dielectricHeightUm: trace.substrateHeightUm || 1.0,
        dielectricConstant: trace.er || 3.9
      });
      // Elmore delay tau = Rwire * 0.5 * Cwire + Rwire * Cload
      const delayNs = StaticTimingAnalysis.computeElmoreDelay(100.0, pex.resistanceOhms, pex.capacitancePf * 1e-12, 0.01e-12);
      wireDelayPs = delayNs * 1000.0;
    }

    const clockPeriodNs = (this.clockPeriodPs || pathData.clockPeriodPs || 5000.0) / 1000.0;
    const tLaunchCqNs = (pathData.tCqPs || 350.0) / 1000.0;
    const tSetupNs = (pathData.tSetupPs || 150.0) / 1000.0;
    const tHoldNs = (pathData.tHoldPs || 80.0) / 1000.0;
    const gateDelayNs = (pathData.logicGateDelayPs || 1000.0) / 1000.0;
    const wireDelayNs = wireDelayPs / 1000.0;

    const res = StaticTimingAnalysis.evaluatePathTiming({
      clockPeriodNs,
      tLaunchCqNs,
      tSetupNs,
      tHoldNs,
      gateDelaysNs: [gateDelayNs],
      wireDelaysNs: [wireDelayNs]
    });

    res.interconnectDelayPs = Number(wireDelayPs.toFixed(2));
    res.setupSlackPs = Number((res.setupSlackNs * 1000.0).toFixed(1));
    res.holdSlackPs = Number((res.holdSlackNs * 1000.0).toFixed(1));
    return res;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StaticTimingAnalysis };
}
