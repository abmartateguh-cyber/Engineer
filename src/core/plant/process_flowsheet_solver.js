/**
 * OmniEng Process Flowsheet Solver & Recycle Stream Engine
 * Standard: Directed Cyclic Flowsheet Graph with Wegstein Convergence Acceleration
 * Industrial Parity: Aspen HYSYS / DWSIM process flowsheet simulation.
 */

class ProcessStream {
  constructor(id, nameOrOpts, T_C = 25.0, P_kPa = 101.325, molarFlowKmolH = 100.0, composition = { 'Methane': 0.7, 'Ethane': 0.3 }) {
    this.id = id;
    if (typeof nameOrOpts === 'object' && nameOrOpts !== null) {
      const opts = nameOrOpts;
      this.name = opts.name || id;
      this.T_C = opts.temperatureC !== undefined ? Number(opts.temperatureC) : (opts.T_C !== undefined ? Number(opts.T_C) : 25.0);
      this.P_kPa = opts.pressureBar !== undefined ? Number(opts.pressureBar) * 100.0 : (opts.P_kPa !== undefined ? Number(opts.P_kPa) : 101.325);
      this.molarFlowKmolH = opts.molarFlowKmolHr !== undefined ? Number(opts.molarFlowKmolHr) : (opts.molarFlowKmolH !== undefined ? Number(opts.molarFlowKmolH) : 100.0);
      this.composition = opts.composition ? { ...opts.composition } : { 'Methane': 0.7, 'Ethane': 0.3 };
    } else {
      this.name = nameOrOpts || id;
      this.T_C = Number(T_C);
      this.P_kPa = Number(P_kPa);
      this.molarFlowKmolH = Number(molarFlowKmolH);
      this.composition = { ...composition };
    }
    this.vaporFraction = 1.0;
    this.enthalpyKjKmol = 0.0;
  }

  get molarFlowKmolHr() {
    return this.molarFlowKmolH;
  }
  set molarFlowKmolHr(v) {
    this.molarFlowKmolH = v;
  }

  clone(newId = null) {
    const s = new ProcessStream(newId || `${this.id}_copy`, this.name, this.T_C, this.P_kPa, this.molarFlowKmolH, this.composition);
    s.vaporFraction = this.vaporFraction;
    s.enthalpyKjKmol = this.enthalpyKjKmol;
    return s;
  }
}

class ProcessFlowsheetSolver {
  constructor() {
    this.streams = new Map();
    this.units = [];
    this.recycleTearStreams = [];
  }

  addStream(stream) {
    this.streams.set(stream.id, stream);
    return stream;
  }

  getStream(id) {
    return this.streams.get(id);
  }

  addUnit(type, name, config = {}) {
    const unit = { id: `unit_${this.units.length + 1}`, type, name, config };
    this.units.push(unit);
    return unit;
  }

  _createStreamIfMissing(id, defaultFlow = 0.0) {
    let s = this.getStream(id);
    if (!s) {
      s = new ProcessStream(id, id);
      s.molarFlowKmolH = defaultFlow;
      s._isAutoCreated = true;
      this.addStream(s);
    }
    return s;
  }

  addMixer(id, inletIds, outletId) {
    for (const inId of inletIds) this._createStreamIfMissing(inId, 0.0);
    this._createStreamIfMissing(outletId, 0.0);
    return this.addUnit('MIXER', id, { inletStreamIds: inletIds, outletStreamId: outletId });
  }

  addSplitter(id, inletId, outletId1, outletId2, config = {}) {
    const splitRatio = config.splitRatio !== undefined ? config.splitRatio : 0.5;
    this._createStreamIfMissing(outletId1, 0.0);
    this._createStreamIfMissing(outletId2, 0.0);
    return this.addUnit('SPLITTER', id, {
      inletStreamId: inletId,
      outletStreamIds: [outletId1, outletId2],
      splitFractions: [splitRatio, 1.0 - splitRatio]
    });
  }

  addFlashDrum(id, feedId, vaporId, liquidId, config = {}) {
    this._createStreamIfMissing(vaporId, 0.0);
    this._createStreamIfMissing(liquidId, 0.0);
    const pKPa = config.pressureBar ? config.pressureBar * 100.0 : (config.pressureKPa || 101.325);
    return this.addUnit('FLASH_DRUM', id, {
      feedStreamId: feedId,
      vaporStreamId: vaporId,
      liquidStreamId: liquidId,
      temperatureC: config.temperatureC,
      pressureKPa: pKPa
    });
  }

  markRecycleStream(streamId) {
    if (!this.recycleTearStreams.includes(streamId)) {
      this.recycleTearStreams.push(streamId);
    }
  }

  _autoDetectRecycleStreams() {
    const producedByUnit = new Map();
    for (let u = 0; u < this.units.length; u++) {
      const unit = this.units[u];
      const outIds = [];
      if (unit.type === 'MIXER') outIds.push(unit.config.outletStreamId);
      if (unit.type === 'SPLITTER') outIds.push(...unit.config.outletStreamIds);
      if (unit.type === 'FLASH_DRUM') outIds.push(unit.config.vaporStreamId, unit.config.liquidStreamId);
      if (unit.type === 'COMPRESSOR' || unit.type === 'HEATER') outIds.push(unit.config.outletStreamId);
      for (const id of outIds) if (id) producedByUnit.set(id, u);
    }

    for (let u = 0; u < this.units.length; u++) {
      const unit = this.units[u];
      const inIds = [];
      if (unit.type === 'MIXER') inIds.push(...unit.config.inletStreamIds);
      if (unit.type === 'SPLITTER' || unit.type === 'COMPRESSOR' || unit.type === 'HEATER') inIds.push(unit.config.inletStreamId);
      if (unit.type === 'FLASH_DRUM') inIds.push(unit.config.feedStreamId);

      for (const id of inIds) {
        if (producedByUnit.has(id) && producedByUnit.get(id) >= u) {
          this.markRecycleStream(id);
          const s = this.getStream(id);
          if (s && s._isAutoCreated) {
            s.molarFlowKmolH = 0.0;
          }
        }
      }
    }
  }

  solveWithWegstein(maxIterations = 50, tolerance = 1e-4) {
    return this.solve(maxIterations, tolerance);
  }

  /**
   * Solves the complete flowsheet mass and energy balance with recycle loops.
   * @param {number} maxIterations Maximum Wegstein loops (default 25)
   * @param {number} tolerance Convergence threshold for stream flow and temperature
   */
  solve(maxIterations = 25, tolerance = 1e-4) {
    let converged = false;
    let iteration = 0;

    if (this.recycleTearStreams.length === 0) {
      this._autoDetectRecycleStreams();
    }

    // Track historical states of recycle streams for Wegstein acceleration
    const history = new Map();
    for (const tearId of this.recycleTearStreams) {
      const s = this.getStream(tearId);
      if (s) {
        history.set(tearId, {
          prevX: s.molarFlowKmolH,
          prevG: s.molarFlowKmolH,
          prevT: s.T_C
        });
      }
    }

    while (iteration < maxIterations) {
      let maxError = 0.0;

      // Execute each unit operation sequentially along the flowsheet
      for (const unit of this.units) {
        this._executeUnit(unit);
      }

      // Check convergence on all recycle tear streams
      for (const tearId of this.recycleTearStreams) {
        const s = this.getStream(tearId);
        if (!s) continue;

        const hist = history.get(tearId);
        const currG = s.molarFlowKmolH; // Output from unit operations
        const currX = hist.prevX;      // Input to iteration

        const flowError = Math.abs(currG - currX) / Math.max(1.0, currX);
        const tempError = Math.abs(s.T_C - hist.prevT) / Math.max(1.0, Math.abs(hist.prevT));
        const totalErr = Math.max(flowError, tempError);

        if (totalErr > maxError) maxError = totalErr;

        // Wegstein Acceleration:
        // s = (g_curr - g_prev) / (x_curr - x_prev)
        // q = s / (s - 1)
        // x_next = (1 - q) * g_curr + q * x_curr
        let nextX = currG;
        const dx = currX - hist.prevX;
        const dg = currG - hist.prevG;

        if (Math.abs(dx) > 1e-6 && iteration > 1) {
          const slope = dg / dx;
          if (slope < 0.99) {
            let q = slope / (slope - 1.0);
            q = Math.max(-5.0, Math.min(0.0, q)); // Clamp acceleration factor
            nextX = (1.0 - q) * currG + q * currX;
          }
        }

        // Apply updated flow back to tear stream
        s.molarFlowKmolH = Math.max(0.0, nextX);

        // Update history
        hist.prevX = nextX;
        hist.prevG = currG;
        hist.prevT = s.T_C;
      }

      iteration++;

      if (maxError < tolerance || this.recycleTearStreams.length === 0) {
        converged = true;
        break;
      }
    }

    return {
      converged,
      iterations: iteration,
      streamCount: this.streams.size,
      unitCount: this.units.length,
      streams: Array.from(this.streams.values()).map(s => ({
        id: s.id,
        name: s.name,
        temperatureC: Number(s.T_C.toFixed(2)),
        pressureKPa: Number(s.P_kPa.toFixed(2)),
        molarFlowKmolH: Number(s.molarFlowKmolH.toFixed(2)),
        vaporFraction: Number(s.vaporFraction.toFixed(3)),
        composition: s.composition
      }))
    };
  }

  _executeUnit(unit) {
    const { type, config } = unit;

    switch (type) {
      case 'MIXER': {
        // Combines inletStreams -> outletStream
        const inlets = config.inletStreamIds.map(id => this.getStream(id)).filter(Boolean);
        const outlet = this.getStream(config.outletStreamId);
        if (!outlet || inlets.length === 0) return;

        let totalFlow = 0.0;
        let weightedT = 0.0;
        let minP = inlets[0].P_kPa;
        const compSums = {};

        for (const s of inlets) {
          totalFlow += s.molarFlowKmolH;
          weightedT += s.T_C * s.molarFlowKmolH;
          if (s.P_kPa < minP) minP = s.P_kPa;

          for (const [comp, frac] of Object.entries(s.composition)) {
            compSums[comp] = (compSums[comp] || 0.0) + frac * s.molarFlowKmolH;
          }
        }

        outlet.molarFlowKmolH = totalFlow;
        outlet.T_C = totalFlow > 0 ? weightedT / totalFlow : 25.0;
        outlet.P_kPa = minP;

        if (totalFlow > 0) {
          for (const comp of Object.keys(compSums)) {
            outlet.composition[comp] = Number((compSums[comp] / totalFlow).toFixed(4));
          }
        }
        break;
      }

      case 'SPLITTER': {
        // Splits inletStream -> outletStreams based on splitFractions
        const inlet = this.getStream(config.inletStreamId);
        if (!inlet) return;

        const splits = config.splitFractions || [0.5, 0.5];
        for (let i = 0; i < config.outletStreamIds.length; i++) {
          const out = this.getStream(config.outletStreamIds[i]);
          if (out) {
            out.molarFlowKmolH = inlet.molarFlowKmolH * (splits[i] || 0.5);
            out.T_C = inlet.T_C;
            out.P_kPa = inlet.P_kPa;
            out.composition = { ...inlet.composition };
            out.vaporFraction = inlet.vaporFraction;
          }
        }
        break;
      }

      case 'FLASH_DRUM': {
        // Separates feed -> vaporOutlet + liquidOutlet
        const feed = this.getStream(config.feedStreamId);
        const vOut = this.getStream(config.vaporStreamId);
        const lOut = this.getStream(config.liquidStreamId);
        if (!feed || !vOut || !lOut) return;

        const flashP = config.pressureKPa || feed.P_kPa;
        const flashT = config.temperatureC || feed.T_C;

        const { ThermodynamicsEngine } = require('./thermodynamics');
        const pBar = flashP / 100.0; // kPa to bar
        const flash = ThermodynamicsEngine.flashVLE(feed.composition, flashT, pBar);

        const vFrac = Math.max(0.0, Math.min(1.0, flash.vaporFraction));
        feed.vaporFraction = vFrac;

        vOut.molarFlowKmolH = feed.molarFlowKmolH * vFrac;
        vOut.T_C = flashT;
        vOut.P_kPa = flashP;
        vOut.vaporFraction = 1.0;
        vOut.composition = { ...flash.vaporComposition };

        lOut.molarFlowKmolH = feed.molarFlowKmolH * (1.0 - vFrac);
        lOut.T_C = flashT;
        lOut.P_kPa = flashP;
        lOut.vaporFraction = 0.0;
        lOut.composition = { ...flash.liquidComposition };
        break;
      }

      case 'COMPRESSOR': {
        const inlet = this.getStream(config.inletStreamId);
        const outlet = this.getStream(config.outletStreamId);
        if (!inlet || !outlet) return;

        const pRatio = Math.max(1.0, config.dischargePressureKPa / inlet.P_kPa);
        const gamma = config.heatCapacityRatio || 1.30;
        const eta = config.polytropicEfficiency || 0.78;

        const TinK = inlet.T_C + 273.15;
        const exp = (gamma - 1.0) / (gamma * eta);
        const ToutK = TinK * Math.pow(pRatio, exp);

        outlet.molarFlowKmolH = inlet.molarFlowKmolH;
        outlet.P_kPa = config.dischargePressureKPa;
        outlet.T_C = Number((ToutK - 273.15).toFixed(2));
        outlet.composition = { ...inlet.composition };
        outlet.vaporFraction = 1.0;
        break;
      }

      case 'VALVE': {
        const inlet = this.getStream(config.inletStreamId);
        const outlet = this.getStream(config.outletStreamId);
        if (!inlet || !outlet) return;

        // Isenthalpic Joule-Thomson expansion (dT = mu_JT * dP)
        const dP = config.outletPressureKPa - inlet.P_kPa;
        const muJT = config.jouleThomsonCoeff || 0.035; // °C / kPa

        outlet.molarFlowKmolH = inlet.molarFlowKmolH;
        outlet.P_kPa = config.outletPressureKPa;
        outlet.T_C = Number((inlet.T_C + muJT * dP).toFixed(2));
        outlet.composition = { ...inlet.composition };
        outlet.vaporFraction = inlet.vaporFraction;
        break;
      }

      default:
        break;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ProcessStream, ProcessFlowsheetSolver };
}
