// @ts-check
/**
 * Experimental process stream and recycle-loop calculation examples.
 * Output is not validated against a commercial process simulator or an independent reference.
 */

/** @typedef {{name?: string, temperatureC?: number, T_C?: number, pressureBar?: number, pressureKPa?: number, P_kPa?: number, molarFlowKmolH?: number, molarFlowKmolHr?: number, composition?: Record<string, number>, vaporFraction?: number, enthalpyKjKmol?: number}} ProcessStreamOptions */
/** @typedef {{id: string, type: string, name: string, config: Record<string, any>}} FlowsheetUnit */
/** @typedef {{id: string, temperatureC: number, pressureKPa: number, molarFlowKmolH: number, vaporFraction: number, composition: Record<string, number>, enthalpyKjKmol: number | undefined}} StreamSnapshot */
/** @typedef {{streams: StreamSnapshot[], unitOperations: FlowsheetUnit[], maxIterations: number, tolerance: number}} SolverSnapshot */

class ProcessStream {
  /**
   * @param {string} id
   * @param {string | ProcessStreamOptions} nameOrOpts
   * @param {number} [temperatureC]
   * @param {number} [pressureKPa]
   * @param {number} [molarFlowKmolH]
   * @param {Record<string, number>} [composition]
   * @param {number} [vaporFraction]
   */
  constructor(id, nameOrOpts, temperatureC, pressureKPa, molarFlowKmolH, composition, vaporFraction) {
    if (typeof id !== 'string' || id.trim() === '') throw new TypeError('ProcessStream requires a non-empty id.');

    let name = typeof nameOrOpts === 'string' ? nameOrOpts : undefined;
    let temperature = temperatureC;
    let pressure = pressureKPa;
    let flow = molarFlowKmolH;
    let streamComposition = composition;
    let phaseFraction = vaporFraction;
    let enthalpy;
    if (nameOrOpts && typeof nameOrOpts === 'object' && !Array.isArray(nameOrOpts)) {
      const options = nameOrOpts;
      name = options.name;
      temperature = options.temperatureC ?? options.T_C;
      pressure =
        options.pressureBar !== undefined
          ? Number.isFinite(options.pressureBar)
            ? options.pressureBar * 100
            : NaN
          : (options.pressureKPa ?? options.P_kPa);
      flow = options.molarFlowKmolH ?? options.molarFlowKmolHr;
      streamComposition = options.composition;
      phaseFraction = options.vaporFraction;
      enthalpy = options.enthalpyKjKmol;
    }

    const missing = [];
    if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature <= -273.15) {
      missing.push('temperatureC');
    }
    if (typeof pressure !== 'number' || !Number.isFinite(pressure) || pressure <= 0) missing.push('pressureKPa > 0');
    if (typeof flow !== 'number' || !Number.isFinite(flow) || flow < 0) missing.push('molarFlowKmolH >= 0');
    if (
      typeof phaseFraction !== 'number' ||
      !Number.isFinite(phaseFraction) ||
      phaseFraction < 0 ||
      phaseFraction > 1
    ) {
      missing.push('vaporFraction in [0, 1]');
    }
    if (!streamComposition || typeof streamComposition !== 'object' || Array.isArray(streamComposition)) {
      missing.push('composition');
    } else {
      const fractions = Object.values(streamComposition);
      if (
        fractions.length === 0 ||
        !fractions.every((fraction) => Number.isFinite(fraction) && fraction >= 0) ||
        Math.abs(fractions.reduce((sum, fraction) => sum + fraction, 0) - 1) > 1e-6
      ) {
        missing.push('composition fractions that are finite, non-negative, and sum to 1');
      }
    }
    if (enthalpy !== undefined && !Number.isFinite(enthalpy)) missing.push('finite enthalpyKjKmol when supplied');
    if (missing.length > 0) throw new TypeError(`ProcessStream requires explicit valid inputs: ${missing.join(', ')}.`);

    this.id = id;
    this.name = typeof name === 'string' && name.trim() !== '' ? name : id;
    /** @type {number} */
    this.T_C = /** @type {number} */ (temperature);
    /** @type {number} */
    this.P_kPa = /** @type {number} */ (pressure);
    /** @type {number} */
    this.molarFlowKmolH = /** @type {number} */ (flow);
    this.composition = { .../** @type {Record<string, number>} */ (streamComposition) };
    /** @type {number} */
    this.vaporFraction = /** @type {number} */ (phaseFraction);
    if (enthalpy !== undefined) this.enthalpyKjKmol = enthalpy;
  }

  get molarFlowKmolHr() {
    return this.molarFlowKmolH;
  }
  set molarFlowKmolHr(v) {
    this.molarFlowKmolH = v;
  }

  /** @param {string | null} [newId] */
  clone(newId = null) {
    return new ProcessStream(newId ?? `${this.id}_copy`, {
      name: this.name,
      temperatureC: this.T_C,
      pressureKPa: this.P_kPa,
      molarFlowKmolH: this.molarFlowKmolH,
      composition: this.composition,
      vaporFraction: this.vaporFraction,
      enthalpyKjKmol: this.enthalpyKjKmol
    });
  }
}

class ProcessFlowsheetSolver {
  constructor() {
    /** @type {Map<string, ProcessStream>} */
    this.streams = new Map();
    /** @type {FlowsheetUnit[]} */
    this.units = [];
    /** @type {string[]} */
    this.recycleTearStreams = [];
  }

  /** @param {ProcessStream} stream */
  addStream(stream) {
    if (!(stream instanceof ProcessStream))
      throw new TypeError('addStream requires an explicitly initialized ProcessStream.');
    if (this.streams.has(stream.id)) throw new Error(`Duplicate process stream id: ${stream.id}`);
    this.streams.set(stream.id, stream);
    return stream;
  }

  /** @param {string} id @returns {ProcessStream | undefined} */
  getStream(id) {
    return this.streams.get(id);
  }

  /** @param {string} message */
  _invalidSolveInput(message) {
    return {
      success: false,
      converged: false,
      status: 'invalid-input',
      validationLevel: 'experimental',
      error: { code: 'INVALID_INPUT', message }
    };
  }

  /** @param {SolverSnapshot} snapshot */
  _restoreInputSnapshot(snapshot) {
    for (const state of snapshot.streams) {
      const stream = this.getStream(state.id);
      if (!stream) continue;
      stream.T_C = state.temperatureC;
      stream.P_kPa = state.pressureKPa;
      stream.molarFlowKmolH = state.molarFlowKmolH;
      stream.vaporFraction = state.vaporFraction;
      stream.composition = { ...state.composition };
      if (state.enthalpyKjKmol === undefined) delete stream.enthalpyKjKmol;
      else stream.enthalpyKjKmol = state.enthalpyKjKmol;
    }
  }

  _assertComputedStreamStates() {
    /** @param {string} streamId @param {string} field */
    const fail = (streamId, field) => {
      const error = /** @type {RangeError & {code?: string}} */ (
        new RangeError(`Calculated stream ${streamId} has an invalid ${field}.`)
      );
      error.code = 'NUMERICAL_FAILURE';
      throw error;
    };

    for (const stream of this.streams.values()) {
      if (!Number.isFinite(stream.T_C) || stream.T_C <= -273.15) fail(stream.id, 'temperature');
      if (!Number.isFinite(stream.P_kPa) || stream.P_kPa <= 0) fail(stream.id, 'pressure');
      if (!Number.isFinite(stream.molarFlowKmolH) || stream.molarFlowKmolH < 0) fail(stream.id, 'molar flow');
      if (!Number.isFinite(stream.vaporFraction) || stream.vaporFraction < 0 || stream.vaporFraction > 1) {
        fail(stream.id, 'vapor fraction');
      }

      const fractions = Object.values(stream.composition || {});
      const fractionSum = fractions.reduce((sum, fraction) => sum + fraction, 0);
      if (
        fractions.length === 0 ||
        fractions.some((fraction) => !Number.isFinite(fraction) || fraction < 0) ||
        !Number.isFinite(fractionSum) ||
        Math.abs(fractionSum - 1) > 1e-6
      ) {
        fail(stream.id, 'composition');
      }
    }
  }

  /** @param {string} type @param {string} name @param {Record<string, any>} [config] @returns {FlowsheetUnit} */
  addUnit(type, name, config = {}) {
    const unit = { id: `unit_${this.units.length + 1}`, type, name, config };
    this.units.push(unit);
    return unit;
  }

  /** @param {string[]} ids @param {string} operation */
  _requireStreamIds(ids, operation) {
    const missing = ids.filter((id) => typeof id !== 'string' || !this.getStream(id));
    if (missing.length > 0)
      throw new Error(`${operation} requires explicitly initialized streams: ${missing.join(', ')}`);
  }

  /** @param {string} id @param {string[]} inletIds @param {string} outletId */
  addMixer(id, inletIds, outletId) {
    if (typeof id !== 'string' || id.trim() === '' || !Array.isArray(inletIds) || inletIds.length === 0) {
      throw new TypeError('Mixer requires an id and at least one explicit inlet stream id.');
    }
    this._requireStreamIds([...inletIds, outletId], `Mixer ${id}`);
    return this.addUnit('MIXER', id, { inletStreamIds: inletIds, outletStreamId: outletId });
  }

  /** @param {string} id @param {string} inletId @param {string} outletId1 @param {string} outletId2 @param {{splitRatio: number}} config */
  addSplitter(id, inletId, outletId1, outletId2, config) {
    if (
      !config ||
      typeof config !== 'object' ||
      Array.isArray(config) ||
      !Number.isFinite(config.splitRatio) ||
      config.splitRatio < 0 ||
      config.splitRatio > 1
    ) {
      throw new TypeError('Splitter requires an explicit splitRatio in [0, 1].');
    }
    this._requireStreamIds([inletId, outletId1, outletId2], `Splitter ${id}`);
    const splitRatio = config.splitRatio;
    return this.addUnit('SPLITTER', id, {
      inletStreamId: inletId,
      outletStreamIds: [outletId1, outletId2],
      splitFractions: [splitRatio, 1.0 - splitRatio]
    });
  }

  /** @param {string} id @param {string} feedId @param {string} vaporId @param {string} liquidId @param {Record<string, any>} config */
  addFlashDrum(id, feedId, vaporId, liquidId, config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError('Flash drum requires explicit temperature and pressure configuration.');
    }
    const pKPa = config.pressureBar !== undefined ? config.pressureBar * 100 : config.pressureKPa;
    if (
      !Number.isFinite(pKPa) ||
      pKPa <= 0 ||
      !Number.isFinite(config.temperatureC) ||
      config.temperatureC <= -273.15
    ) {
      throw new TypeError('Flash drum requires pressure > 0 kPa and temperature > -273.15 °C.');
    }
    let compProps = config.componentProperties;
    if (!compProps && (config.useDippr || config.flashModel === 'peng-robinson' || config.usePR)) {
      compProps = {};
    } else if (
      !compProps ||
      typeof compProps !== 'object' ||
      Array.isArray(compProps)
    ) {
      throw new TypeError(
        'Flash drum requires explicit component property records with source and license provenance.'
      );
    }
    this._requireStreamIds([feedId, vaporId, liquidId], `Flash drum ${id}`);
    return this.addUnit('FLASH_DRUM', id, {
      feedStreamId: feedId,
      vaporStreamId: vaporId,
      liquidStreamId: liquidId,
      temperatureC: config.temperatureC,
      pressureKPa: pKPa,
      componentProperties: config.componentProperties,
      useDippr: config.useDippr,
      flashModel: config.flashModel,
      usePR: config.usePR
    });
  }

  /**
   * Alias for addFlashDrum with automatic DIPPR property resolution
   */
  addFlashSeparator(id, feedId, vaporId, liquidId, config = {}) {
    return this.addFlashDrum(id, feedId, vaporId, liquidId, {
      ...config,
      useDippr: config.useDippr !== false
    });
  }

  /**
   * @param {string} id
   * @param {string} inletId
   * @param {string} outletId
   * @param {{outletTemperatureC?: number, targetTemperatureC?: number, dutyKW?: number, dutyKJperH?: number, pressureDropKPa?: number}} config
   */
  addHeatExchanger(id, inletId, outletId, config = {}) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new TypeError('Heat exchanger requires a non-empty id.');
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError('Heat exchanger requires a configuration object.');
    }
    this._requireStreamIds([inletId, outletId], `Heat exchanger ${id}`);
    return this.addUnit('HEAT_EXCHANGER', id, {
      inletStreamId: inletId,
      outletStreamId: outletId,
      outletTemperatureC: config.outletTemperatureC ?? config.targetTemperatureC,
      dutyKW: config.dutyKW,
      dutyKJperH: config.dutyKJperH,
      pressureDropKPa: config.pressureDropKPa || 0.0
    });
  }

  /** Alias for addHeatExchanger */
  addHeater(id, inletId, outletId, config = {}) {
    return this.addHeatExchanger(id, inletId, outletId, config);
  }

  /** Alias for addHeatExchanger */
  addCooler(id, inletId, outletId, config = {}) {
    return this.addHeatExchanger(id, inletId, outletId, config);
  }

  /**
   * @param {string} id
   * @param {string} feedId
   * @param {string} distillateId
   * @param {string} bottomsId
   * @param {{stageCount?: number, feedStage?: number, refluxRatio?: number, distillateRate?: number, pressureKPa?: number, kValueModel?: string, model?: string, tolerance?: number, maxIterations?: number}} config
   */
  addDistillationColumn(id, feedId, distillateId, bottomsId, config = {}) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new TypeError('Distillation column requires a non-empty id.');
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError('Distillation column requires a configuration object.');
    }
    this._requireStreamIds([feedId, distillateId, bottomsId], `Distillation column ${id}`);
    return this.addUnit('DISTILLATION_COLUMN', id, {
      feedStreamId: feedId,
      distillateStreamId: distillateId,
      bottomsStreamId: bottomsId,
      stageCount: config.stageCount || 10,
      feedStage: config.feedStage || Math.floor((config.stageCount || 10) / 2),
      refluxRatio: config.refluxRatio || 2.0,
      distillateRate: config.distillateRate || 0.5,
      pressureKPa: config.pressureKPa,
      kValueModel: config.kValueModel || 'dippr',
      model: config.model || 'rigorous',
      tolerance: config.tolerance || 1e-5,
      maxIterations: config.maxIterations || 100
    });
  }

  /**
   * @param {string} id
   * @param {string} inletId
   * @param {string} outletId
   * @param {{dischargePressureKPa: number, pumpEfficiency?: number, liquidDensityKgM3?: number, heatCapacityKJperKgK?: number}} config
   */
  addPump(id, inletId, outletId, config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError('Pump requires explicit discharge pressure and configuration.');
    }
    this._requireStreamIds([inletId, outletId], `Pump ${id}`);
    return this.addUnit('PUMP', id, {
      inletStreamId: inletId,
      outletStreamId: outletId,
      dischargePressureKPa: config.dischargePressureKPa,
      pumpEfficiency: config.pumpEfficiency,
      liquidDensityKgM3: config.liquidDensityKgM3,
      heatCapacityKJperKgK: config.heatCapacityKJperKgK
    });
  }

  /** @param {string} streamId */
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
      if (unit.type === 'DISTILLATION_COLUMN') outIds.push(unit.config.distillateStreamId, unit.config.bottomsStreamId);
      if (
        unit.type === 'COMPRESSOR' ||
        unit.type === 'HEATER' ||
        unit.type === 'HEAT_EXCHANGER' ||
        unit.type === 'COOLER' ||
        unit.type === 'PUMP' ||
        unit.type === 'VALVE'
      )
        outIds.push(unit.config.outletStreamId);
      for (const id of outIds) if (id) producedByUnit.set(id, u);
    }

    for (let u = 0; u < this.units.length; u++) {
      const unit = this.units[u];
      const inIds = [];
      if (unit.type === 'MIXER') inIds.push(...unit.config.inletStreamIds);
      if (
        unit.type === 'SPLITTER' ||
        unit.type === 'COMPRESSOR' ||
        unit.type === 'HEATER' ||
        unit.type === 'HEAT_EXCHANGER' ||
        unit.type === 'COOLER' ||
        unit.type === 'PUMP' ||
        unit.type === 'VALVE'
      )
        inIds.push(unit.config.inletStreamId);
      if (unit.type === 'FLASH_DRUM') inIds.push(unit.config.feedStreamId);
      if (unit.type === 'DISTILLATION_COLUMN') inIds.push(unit.config.feedStreamId);

      for (const id of inIds) {
        if (producedByUnit.has(id) && producedByUnit.get(id) >= u) {
          this.markRecycleStream(id);
        }
      }
    }
  }

  /** @param {number} maxIterations @param {number} tolerance */
  solveWithWegstein(maxIterations, tolerance) {
    return this.solve(maxIterations, tolerance);
  }

  /**
   * Solves the complete flowsheet mass and energy balance with recycle loops.
   * @param {number} maxIterations Maximum Wegstein loops
   * @param {number} tolerance Convergence threshold for stream flow and temperature
   */
  /** @param {number} maxIterations @param {number} tolerance */
  solve(maxIterations, tolerance) {
    if (!Number.isInteger(maxIterations) || maxIterations <= 0 || !Number.isFinite(tolerance) || tolerance <= 0) {
      return {
        success: false,
        converged: false,
        status: 'invalid-input',
        validationLevel: 'experimental',
        error: {
          code: 'INVALID_INPUT',
          message: 'Flowsheet solve requires explicit positive maxIterations and tolerance.'
        }
      };
    }
    if (this.streams.size === 0 || this.units.length === 0) {
      return this._invalidSolveInput('Flowsheet solve requires explicitly initialized streams and unit operations.');
    }

    const inputSnapshot = {
      streams: Array.from(this.streams.values(), (stream) => ({
        id: stream.id,
        name: stream.name,
        temperatureC: stream.T_C,
        pressureKPa: stream.P_kPa,
        molarFlowKmolH: stream.molarFlowKmolH,
        vaporFraction: stream.vaporFraction,
        composition: { ...stream.composition },
        enthalpyKjKmol: stream.enthalpyKjKmol
      })),
      unitOperations: this.units.map((unit) => ({ ...unit, config: { ...unit.config } })),
      maxIterations,
      tolerance
    };
    let converged = false;
    let iteration = 0;

    if (this.recycleTearStreams.length === 0) {
      this._autoDetectRecycleStreams();
    }

    // Track historical states of recycle streams for Wegstein acceleration
    /** @type {Map<string, {prevX: number | null, prevG: number | null, prevT: number}>} */
    const history = new Map();
    for (const tearId of this.recycleTearStreams) {
      const s = this.getStream(tearId);
      if (!s) return this._invalidSolveInput(`Recycle stream ${tearId} is not initialized.`);
      history.set(tearId, { prevX: null, prevG: null, prevT: s.T_C });
    }

    while (iteration < maxIterations) {
      let maxError = 0.0;
      /** @type {Map<string, number>} */
      const iterationInputs = new Map();
      for (const tearId of this.recycleTearStreams) {
        const stream = this.getStream(tearId);
        if (!stream) return this._invalidSolveInput(`Recycle stream ${tearId} is not initialized.`);
        iterationInputs.set(tearId, stream.molarFlowKmolH);
      }

      // Execute each unit operation sequentially along the flowsheet
      for (const unit of this.units) {
        try {
          this._executeUnit(unit);
          this._assertComputedStreamStates();
        } catch (error) {
          this._restoreInputSnapshot(inputSnapshot);
          const errorCode =
            error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
              ? error.code
              : undefined;
          return {
            success: false,
            converged: false,
            status: errorCode === 'NUMERICAL_FAILURE' ? 'numerical-failure' : 'invalid-input',
            validationLevel: 'experimental',
            inputs: inputSnapshot,
            iterations: iteration,
            error: {
              code: errorCode || 'INVALID_INPUT',
              message: error instanceof Error ? error.message : String(error)
            }
          };
        }
      }

      // Check convergence on all recycle tear streams
      for (const tearId of this.recycleTearStreams) {
        const s = this.getStream(tearId);
        if (!s) continue;

        const hist = history.get(tearId);
        if (!hist) return this._invalidSolveInput(`Recycle history for stream ${tearId} is unavailable.`);
        const currG = s.molarFlowKmolH; // Output from unit operations
        const currX = iterationInputs.get(tearId); // Input to iteration
        if (currX === undefined) return this._invalidSolveInput(`Recycle input for stream ${tearId} is unavailable.`);

        const flowError = Math.abs(currG - currX) / Math.max(Math.abs(currX), Math.abs(currG), 1e-12);
        const tempError = Math.abs(s.T_C - hist.prevT) / Math.max(Math.abs(hist.prevT + 273.15), 1e-12);
        const totalErr = Math.max(flowError, tempError);

        if (totalErr > maxError) maxError = totalErr;

        // Wegstein Acceleration:
        // s = (g_curr - g_prev) / (x_curr - x_prev)
        // q = s / (s - 1)
        // x_next = (1 - q) * g_curr + q * x_curr
        let nextX = currG;
        const dx = hist.prevX === null ? 0 : currX - hist.prevX;
        const dg = hist.prevG === null ? 0 : currG - hist.prevG;

        if (dx !== 0 && hist.prevG !== null) {
          const slope = dg / dx;
          if (Number.isFinite(slope) && slope < 0.99 && slope !== 1) {
            let q = slope / (slope - 1.0);
            q = Math.max(-5.0, Math.min(0.0, q)); // Clamp acceleration factor
            nextX = (1.0 - q) * currG + q * currX;
          }
        }

        if (!Number.isFinite(nextX) || nextX < 0) {
          this._restoreInputSnapshot(inputSnapshot);
          return {
            success: false,
            converged: false,
            status: 'numerical-failure',
            validationLevel: 'experimental',
            inputs: inputSnapshot,
            iterations: iteration,
            error: {
              code: 'NUMERICAL_FAILURE',
              message: `Recycle update for stream ${tearId} produced an invalid molar flow.`
            }
          };
        }
        s.molarFlowKmolH = nextX;

        // Update history
        hist.prevX = currX;
        hist.prevG = currG;
        hist.prevT = s.T_C;
      }

      iteration++;

      if (maxError < tolerance || this.recycleTearStreams.length === 0) {
        converged = true;
        break;
      }
    }

    const balances = this.calculateBalances();
    return {
      success: converged,
      status: converged ? 'computed' : 'non-converged',
      validationLevel: 'experimental',
      converged,
      inputs: inputSnapshot,
      assumptions: [
        'Mixer temperature is molar-flow weighted and pressure is the minimum inlet pressure',
        'Flash drum uses the experimental thermodynamics estimate supplied by ThermodynamicsEngine',
        'Wegstein acceleration factor is limited to [-5, 0]; this is a numerical stabilization bound',
        'No independent process-simulator comparison or plant-design assessment is included'
      ],
      iterations: iteration,
      streamCount: this.streams.size,
      unitCount: this.units.length,
      balances,
      overallMassBalanceClosure: balances.massBalance.relError,
      overallEnergyBalanceClosure: balances.energyBalance.relError,
      streams: Array.from(this.streams.values()).map((s) => ({
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

  /** @param {FlowsheetUnit} unit */
  _executeUnit(unit) {
    const { type, config } = unit;

    switch (type) {
      case 'MIXER': {
        // Combines inletStreams -> outletStream
        const inlets = /** @type {string[]} */ (config.inletStreamIds).map((id) => this.getStream(id));
        const outlet = this.getStream(config.outletStreamId);
        if (!outlet || inlets.length === 0 || inlets.some((stream) => !stream)) {
          throw new TypeError(`Mixer ${unit.name} requires explicitly initialized inlet and outlet streams.`);
        }
        const validInlets = /** @type {ProcessStream[]} */ (inlets);

        let totalFlow = 0.0;
        let weightedT = 0.0;
        let weightedH = 0.0;
        let hasEnthalpy = true;
        let minP = validInlets[0].P_kPa;
        /** @type {Record<string, number>} */
        const compSums = {};

        for (const s of validInlets) {
          totalFlow += s.molarFlowKmolH;
          weightedT += s.T_C * s.molarFlowKmolH;
          if (s.enthalpyKjKmol !== undefined) {
            weightedH += s.enthalpyKjKmol * s.molarFlowKmolH;
          } else {
            hasEnthalpy = false;
          }
          if (s.P_kPa < minP) minP = s.P_kPa;

          for (const [comp, frac] of Object.entries(s.composition)) {
            compSums[comp] = (compSums[comp] || 0.0) + frac * s.molarFlowKmolH;
          }
        }

        if (totalFlow <= 0)
          throw new RangeError(`Mixer ${unit.name} has no positive molar flow; outlet state is undefined.`);
        outlet.molarFlowKmolH = totalFlow;
        outlet.T_C = weightedT / totalFlow;
        outlet.P_kPa = minP;

        outlet.composition = {};
        if (totalFlow > 0) {
          for (const comp of Object.keys(compSums)) {
            outlet.composition[comp] = compSums[comp] / totalFlow;
          }
        }
        if (hasEnthalpy && totalFlow > 0) {
          outlet.enthalpyKjKmol = weightedH / totalFlow;
        }
        break;
      }

      case 'SPLITTER': {
        // Splits inletStream -> outletStreams based on splitFractions
        const inlet = this.getStream(config.inletStreamId);
        if (!inlet) throw new TypeError(`Splitter ${unit.name} requires an initialized inlet stream.`);

        const splits = config.splitFractions;
        if (!Array.isArray(splits) || splits.length !== config.outletStreamIds.length) {
          throw new TypeError(`Splitter ${unit.name} requires an explicit split fraction for every outlet.`);
        }
        for (let i = 0; i < config.outletStreamIds.length; i++) {
          const out = this.getStream(config.outletStreamIds[i]);
          if (!out) throw new TypeError(`Splitter ${unit.name} references an uninitialized outlet stream.`);
          if (!Number.isFinite(splits[i]) || splits[i] < 0 || splits[i] > 1) {
            throw new TypeError(`Splitter ${unit.name} has an invalid split fraction.`);
          }
          {
            out.molarFlowKmolH = inlet.molarFlowKmolH * splits[i];
            out.T_C = inlet.T_C;
            out.P_kPa = inlet.P_kPa;
            out.composition = { ...inlet.composition };
            out.vaporFraction = inlet.vaporFraction;
            if (inlet.enthalpyKjKmol !== undefined) {
              out.enthalpyKjKmol = inlet.enthalpyKjKmol;
            }
          }
        }
        break;
      }

      case 'FLASH_DRUM': {
        // Separates feed -> vaporOutlet + liquidOutlet
        const feed = this.getStream(config.feedStreamId);
        const vOut = this.getStream(config.vaporStreamId);
        const lOut = this.getStream(config.liquidStreamId);
        if (!feed || !vOut || !lOut) throw new TypeError(`Flash drum ${unit.name} requires initialized streams.`);

        const flashP = config.pressureKPa;
        const flashT = config.temperatureC;

        if (config.flashModel === 'peng-robinson' || config.usePR === true) {
          const { PengRobinsonEOS } = require('./peng_robinson_eos');
          const comps = Object.keys(feed.composition);
          const eos = PengRobinsonEOS.fromDippr(comps);
          const zArr = comps.map((c) => feed.composition[c]);
          const flash = eos.flashPT(zArr, flashT + 273.15, flashP * 1000, { maxIter: 100, tol: 1e-8 });

          const vFrac = flash.beta;
          feed.vaporFraction = vFrac;

          vOut.molarFlowKmolH = feed.molarFlowKmolH * vFrac;
          vOut.T_C = flashT;
          vOut.P_kPa = flashP;
          vOut.vaporFraction = 1.0;
          const sumY = flash.y.reduce((acc, v) => acc + v, 0) || 1.0;
          const sumX = flash.x.reduce((acc, v) => acc + v, 0) || 1.0;
          vOut.composition = {};
          comps.forEach((c, idx) => { vOut.composition[c] = flash.y[idx] / sumY; });

          lOut.molarFlowKmolH = feed.molarFlowKmolH * (1.0 - vFrac);
          lOut.T_C = flashT;
          lOut.P_kPa = flashP;
          lOut.vaporFraction = 0.0;
          lOut.composition = {};
          comps.forEach((c, idx) => { lOut.composition[c] = flash.x[idx] / sumX; });

          const dippr = ProcessFlowsheetSolver.getDipprCatalogSafe();
          if (dippr) {
            try {
              const hV = ProcessFlowsheetSolver.evalStreamEnthalpyDippr(vOut, dippr);
              const hL = ProcessFlowsheetSolver.evalStreamEnthalpyDippr(lOut, dippr);
              vOut.enthalpyKjKmol = hV;
              lOut.enthalpyKjKmol = hL;
              const outTotalH = vOut.molarFlowKmolH * hV + lOut.molarFlowKmolH * hL;
              if (feed.enthalpyKjKmol === undefined) {
                feed.enthalpyKjKmol = feed.molarFlowKmolH > 0 ? outTotalH / feed.molarFlowKmolH : 0;
                unit.dutyKJperH = 0;
              } else {
                unit.dutyKJperH = outTotalH - feed.molarFlowKmolH * feed.enthalpyKjKmol;
              }
              unit.dutyKW = (unit.dutyKJperH || 0) / 3600.0;
            } catch {}
          } else {
            try {
              const hV = eos.calculateMixtureEnthalpy(flash.y, flashT + 273.15, flashP * 1000, 'vapor');
              const hL = eos.calculateMixtureEnthalpy(flash.x, flashT + 273.15, flashP * 1000, 'liquid');
              vOut.enthalpyKjKmol = hV;
              lOut.enthalpyKjKmol = hL;
              feed.enthalpyKjKmol = vFrac * hV + (1.0 - vFrac) * hL;
            } catch {}
          }
          break;
        }

        let compProps = config.componentProperties;
        if (!compProps && config.useDippr) {
          compProps = ProcessFlowsheetSolver.resolveDipprProperties(Object.keys(feed.composition));
        }

        const { ThermodynamicsEngine } = require('./thermodynamics');
        const pBar = flashP / 100.0; // kPa to bar
        const flash = ThermodynamicsEngine.flashVLE(feed.composition, flashT, pBar, compProps);

        const vFrac = flash.vaporFraction;
        if (!Number.isFinite(vFrac) || vFrac < 0 || vFrac > 1) {
          const error = /** @type {Error & {code?: string}} */ (
            new Error('Flash estimate returned a vapor fraction outside [0, 1].')
          );
          error.code = 'NUMERICAL_FAILURE';
          throw error;
        }
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

        const dippr = ProcessFlowsheetSolver.getDipprCatalogSafe();
        if (dippr) {
          try {
            const TinK = flashT + 273.15;
            const hV = Object.entries(vOut.composition).reduce((acc, [c, frac]) => {
              return acc + frac * dippr.evalIdealGasEnthalpy(c, TinK, 298.15);
            }, 0);
            const hL = Object.entries(lOut.composition).reduce((acc, [c, frac]) => {
              const deltaH = dippr.evalHeatOfVaporization(c, TinK);
              return acc + frac * (dippr.evalIdealGasEnthalpy(c, TinK, 298.15) - deltaH);
            }, 0);
            vOut.enthalpyKjKmol = hV;
            lOut.enthalpyKjKmol = hL;
            feed.enthalpyKjKmol = vFrac * hV + (1.0 - vFrac) * hL;
          } catch {}
        }
        break;
      }

      case 'COMPRESSOR': {
        const inlet = this.getStream(config.inletStreamId);
        const outlet = this.getStream(config.outletStreamId);
        if (!inlet || !outlet)
          throw new TypeError(`Compressor ${unit.name} requires initialized inlet and outlet streams.`);
        if (
          !Number.isFinite(config.dischargePressureKPa) ||
          config.dischargePressureKPa < inlet.P_kPa ||
          !Number.isFinite(config.heatCapacityRatio) ||
          config.heatCapacityRatio <= 1 ||
          !Number.isFinite(config.polytropicEfficiency) ||
          config.polytropicEfficiency <= 0 ||
          config.polytropicEfficiency > 1
        ) {
          throw new TypeError(
            `Compressor ${unit.name} requires valid discharge pressure, heat-capacity ratio, and efficiency.`
          );
        }
        const pRatio = config.dischargePressureKPa / inlet.P_kPa;
        const gamma = config.heatCapacityRatio;
        const eta = config.polytropicEfficiency;

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
        if (!inlet || !outlet) throw new TypeError(`Valve ${unit.name} requires initialized inlet and outlet streams.`);

        // Isenthalpic Joule-Thomson expansion (dT = mu_JT * dP)
        const dP = config.outletPressureKPa - inlet.P_kPa;
        if (
          !Number.isFinite(config.outletPressureKPa) ||
          config.outletPressureKPa <= 0 ||
          config.outletPressureKPa > inlet.P_kPa ||
          !Number.isFinite(config.jouleThomsonCoeff)
        ) {
          throw new TypeError(`Valve ${unit.name} requires explicit outlet pressure and Joule-Thomson coefficient.`);
        }
        const muJT = config.jouleThomsonCoeff; // °C / kPa

        outlet.molarFlowKmolH = inlet.molarFlowKmolH;
        outlet.P_kPa = config.outletPressureKPa;
        outlet.T_C = Number((inlet.T_C + muJT * dP).toFixed(2));
        outlet.composition = { ...inlet.composition };
        outlet.vaporFraction = inlet.vaporFraction;
        break;
      }

      case 'PUMP': {
        const inlet = this.getStream(config.inletStreamId);
        const outlet = this.getStream(config.outletStreamId);
        if (!inlet || !outlet) {
          throw new TypeError(`Pump ${unit.name} requires initialized inlet and outlet streams.`);
        }
        const eta = Number.isFinite(config.pumpEfficiency) ? config.pumpEfficiency : 0.75;
        if (
          !Number.isFinite(config.dischargePressureKPa) ||
          config.dischargePressureKPa < inlet.P_kPa ||
          eta <= 0 ||
          eta > 1
        ) {
          throw new TypeError(
            `Pump ${unit.name} requires valid discharge pressure >= inlet pressure and efficiency in (0, 1].`
          );
        }
        const rho =
          Number.isFinite(config.liquidDensityKgM3) && config.liquidDensityKgM3 > 0 ? config.liquidDensityKgM3 : 1000;
        const cp =
          Number.isFinite(config.heatCapacityKJperKgK) && config.heatCapacityKJperKgK > 0
            ? config.heatCapacityKJperKgK
            : 2.5;

        const deltaPKPa = config.dischargePressureKPa - inlet.P_kPa;
        const dTK = (deltaPKPa * (1.0 - eta)) / (rho * cp * eta);

        outlet.molarFlowKmolH = inlet.molarFlowKmolH;
        outlet.P_kPa = config.dischargePressureKPa;
        outlet.T_C = Number((inlet.T_C + dTK).toFixed(2));
        outlet.composition = { ...inlet.composition };
        outlet.vaporFraction = 0.0;
        break;
      }

      case 'HEAT_EXCHANGER':
      case 'HEATER':
      case 'COOLER': {
        const inlet = this.getStream(config.inletStreamId);
        const outlet = this.getStream(config.outletStreamId);
        if (!inlet || !outlet) {
          throw new TypeError(`Heat exchanger ${unit.name} requires initialized inlet and outlet streams.`);
        }
        const pDrop = Number.isFinite(config.pressureDropKPa) ? config.pressureDropKPa : 0.0;
        outlet.molarFlowKmolH = inlet.molarFlowKmolH;
        outlet.P_kPa = Math.max(1e-3, inlet.P_kPa - pDrop);
        outlet.composition = { ...inlet.composition };
        outlet.vaporFraction = inlet.vaporFraction;

        let outT = inlet.T_C;
        const dippr = ProcessFlowsheetSolver.getDipprCatalogSafe();
        const targetT = config.outletTemperatureC ?? config.targetTemperatureC ?? config.temperatureC;
        if (Number.isFinite(targetT)) {
          outT = targetT;
        } else if (Number.isFinite(config.dutyKW) || Number.isFinite(config.dutyKJperH)) {
          const dutyKJperH = Number.isFinite(config.dutyKJperH) ? config.dutyKJperH : (config.dutyKW * 3600);
          let cpMix = 50.0;
          if (dippr) {
            try {
              cpMix = Object.entries(inlet.composition).reduce((acc, [c, frac]) => {
                return acc + frac * dippr.evalIdealGasCp(c, inlet.T_C + 273.15);
              }, 0);
            } catch {
              cpMix = 50.0;
            }
          }
          const deltaT = inlet.molarFlowKmolH > 0 ? dutyKJperH / (inlet.molarFlowKmolH * cpMix) : 0;
          outT = inlet.T_C + deltaT;
        }
        outlet.T_C = outT;

        if (dippr) {
          try {
            const Hin = ProcessFlowsheetSolver.evalStreamEnthalpyDippr(inlet, dippr);
            const Hout = ProcessFlowsheetSolver.evalStreamEnthalpyDippr(outlet, dippr);
            inlet.enthalpyKjKmol = Hin;
            outlet.enthalpyKjKmol = Hout;
            unit.dutyKJperH = inlet.molarFlowKmolH * (Hout - Hin);
            unit.dutyKW = unit.dutyKJperH / 3600.0;
          } catch {}
        }
        break;
      }

      case 'DISTILLATION_COLUMN': {
        const feed = this.getStream(config.feedStreamId);
        const dist = this.getStream(config.distillateStreamId);
        const bot = this.getStream(config.bottomsStreamId);
        if (!feed || !dist || !bot) {
          throw new TypeError(`Distillation column ${unit.name} requires initialized streams.`);
        }
        const { NaphtaliSandholmColumnSolver } = require('./naphtali_sandholm_mesh');
        const colPressure = config.pressureKPa ? config.pressureKPa * 1000 : feed.P_kPa * 1000;
        const comps = Object.keys(feed.composition);

        let dRate = config.distillateRate;
        if (Number.isFinite(dRate) && dRate >= 1.0 && feed.molarFlowKmolH > 0) {
          dRate = dRate / feed.molarFlowKmolH;
        }
        if (!Number.isFinite(dRate) || dRate <= 0 || dRate >= 1.0) {
          dRate = 0.4;
        }

        const colRes = NaphtaliSandholmColumnSolver.solve({
          components: comps,
          feedComposition: feed.composition,
          stageCount: config.stageCount || 12,
          feedStage: config.feedStage || Math.floor((config.stageCount || 12) / 2),
          refluxRatio: config.refluxRatio || 2.0,
          distillateRate: dRate,
          pressurePa: colPressure,
          feedTemperatureK: config.feedTemperatureK ?? (Number.isFinite(feed.T_C) ? feed.T_C + 273.15 : undefined),
          feedVaporFraction: Number.isFinite(feed.vaporFraction) ? feed.vaporFraction : 0.0,
          kValueModel: config.kValueModel || 'dippr',
          model: config.model || 'rigorous',
          tolerance: config.tolerance || 1e-5,
          maxIterations: config.maxIterations || 100
        });

        if (!colRes.success) {
          const err = new Error(`Distillation column ${unit.name} failed to converge: ${colRes.error?.message || ''}`);
          err.code = 'NUMERICAL_FAILURE';
          throw err;
        }

        const D_frac = colRes.products.distillate.flowKmolPerMolFeed;
        const B_frac = colRes.products.bottoms.flowKmolPerMolFeed;
        dist.molarFlowKmolH = feed.molarFlowKmolH * D_frac;
        dist.composition = { ...colRes.products.distillate.composition };
        dist.T_C = colRes.profiles.condenser.temperatureK - 273.15;
        dist.P_kPa = colPressure / 1000.0;
        dist.vaporFraction = 0.0;

        bot.molarFlowKmolH = feed.molarFlowKmolH * B_frac;
        bot.composition = { ...colRes.products.bottoms.composition };
        bot.T_C = colRes.profiles.reboiler.temperatureK - 273.15;
        bot.P_kPa = colPressure / 1000.0;
        bot.vaporFraction = 0.0;

        unit.condenserDutyKW = (colRes.profiles.condenser.dutyKJPerMolFeed * 1000.0 * feed.molarFlowKmolH) / 3600.0;
        unit.reboilerDutyKW = (colRes.profiles.reboiler.dutyKJPerMolFeed * 1000.0 * feed.molarFlowKmolH) / 3600.0;
        unit.dutyKJperH = (unit.reboilerDutyKW - unit.condenserDutyKW) * 3600.0;

        const dippr = ProcessFlowsheetSolver.getDipprCatalogSafe();
        if (dippr) {
          try {
            if (feed.enthalpyKjKmol === undefined) {
              const TfK = colRes.input?.feedTemperatureK || (feed.T_C + 273.15);
              feed.T_C = TfK - 273.15;
              feed.enthalpyKjKmol = ProcessFlowsheetSolver.evalStreamEnthalpyDippr(feed, dippr);
            }
            dist.enthalpyKjKmol = ProcessFlowsheetSolver.evalStreamEnthalpyDippr(dist, dippr);
            bot.enthalpyKjKmol = ProcessFlowsheetSolver.evalStreamEnthalpyDippr(bot, dippr);
          } catch {}
        }
        break;
      }

      default:
        throw new TypeError(`Unsupported flowsheet unit operation: ${type}`);
    }
  }

  /**
   * Calculates overall flowsheet mass and energy balance conservation metrics.
   * Identifies boundary inlet streams (not produced by any unit) and boundary outlet streams (not consumed by any unit).
   * Verifies total and per-component mass conservation and total energy (enthalpy + unit duties) conservation.
   * @returns {{
   *   massBalance: { totalInflowKmolH: number, totalOutflowKmolH: number, absErrorKmolH: number, relError: number, perComponentRelError: Record<string, number> },
   *   energyBalance: { totalInflowEnergyKJH: number, totalOutflowEnergyKJH: number, totalDutyAddedKJperH: number, totalDutyRemovedKJperH: number, totalEnergyInKJH: number, totalEnergyOutKJH: number, absErrorKJH: number, relError: number },
   *   boundaryInletStreams: string[],
   *   boundaryOutletStreams: string[],
   *   isConserved: boolean
   * }}
   */
  calculateBalances() {
    const allInlets = new Set();
    const allOutlets = new Set();
    let totalDutyAddedKJperH = 0;
    let totalDutyRemovedKJperH = 0;

    for (const unit of this.units) {
      const { type, config } = unit;
      switch (type) {
        case 'MIXER':
          (config.inletStreamIds || []).forEach((id) => allInlets.add(id));
          if (config.outletStreamId) allOutlets.add(config.outletStreamId);
          break;
        case 'SPLITTER':
          if (config.inletStreamId) allInlets.add(config.inletStreamId);
          (config.outletStreamIds || []).forEach((id) => allOutlets.add(id));
          break;
        case 'FLASH_DRUM':
          if (config.feedStreamId) allInlets.add(config.feedStreamId);
          if (config.vaporStreamId) allOutlets.add(config.vaporStreamId);
          if (config.liquidStreamId) allOutlets.add(config.liquidStreamId);
          if (unit.dutyKJperH) {
            if (unit.dutyKJperH > 0) totalDutyAddedKJperH += unit.dutyKJperH;
            else totalDutyRemovedKJperH += Math.abs(unit.dutyKJperH);
          }
          break;
        case 'HEAT_EXCHANGER':
        case 'HEATER':
        case 'COOLER':
          if (config.inletStreamId) allInlets.add(config.inletStreamId);
          if (config.outletStreamId) allOutlets.add(config.outletStreamId);
          if (unit.dutyKJperH) {
            if (unit.dutyKJperH > 0) totalDutyAddedKJperH += unit.dutyKJperH;
            else totalDutyRemovedKJperH += Math.abs(unit.dutyKJperH);
          }
          break;
        case 'COMPRESSOR':
        case 'VALVE':
        case 'PUMP':
          if (config.inletStreamId) allInlets.add(config.inletStreamId);
          if (config.outletStreamId) allOutlets.add(config.outletStreamId);
          break;
        case 'DISTILLATION_COLUMN':
          if (config.feedStreamId) allInlets.add(config.feedStreamId);
          if (config.distillateStreamId) allOutlets.add(config.distillateStreamId);
          if (config.bottomsStreamId) allOutlets.add(config.bottomsStreamId);
          if (unit.reboilerDutyKW) totalDutyAddedKJperH += unit.reboilerDutyKW * 3600.0;
          if (unit.condenserDutyKW) totalDutyRemovedKJperH += unit.condenserDutyKW * 3600.0;
          break;
      }
    }

    const boundaryInletStreams = [];
    const boundaryOutletStreams = [];

    for (const [id, stream] of this.streams.entries()) {
      const isInput = allInlets.has(id);
      const isOutput = allOutlets.has(id);
      if (isInput && !isOutput) {
        boundaryInletStreams.push(stream);
      } else if (isOutput && !isInput) {
        boundaryOutletStreams.push(stream);
      }
    }

    let totalInflowKmolH = 0;
    let totalOutflowKmolH = 0;
    const compIn = {};
    const compOut = {};
    let totalInEnthalpyKJH = 0;
    let totalOutEnthalpyKJH = 0;

    const dippr = ProcessFlowsheetSolver.getDipprCatalogSafe();
    for (const s of boundaryInletStreams) {
      totalInflowKmolH += s.molarFlowKmolH;
      for (const [c, frac] of Object.entries(s.composition)) {
        compIn[c] = (compIn[c] || 0) + s.molarFlowKmolH * frac;
      }
      if (s.enthalpyKjKmol === undefined && dippr) {
        s.enthalpyKjKmol = ProcessFlowsheetSolver.evalStreamEnthalpyDippr(s, dippr);
      }
      if (s.enthalpyKjKmol !== undefined) {
        totalInEnthalpyKJH += s.molarFlowKmolH * s.enthalpyKjKmol;
      }
    }

    for (const s of boundaryOutletStreams) {
      totalOutflowKmolH += s.molarFlowKmolH;
      for (const [c, frac] of Object.entries(s.composition)) {
        compOut[c] = (compOut[c] || 0) + s.molarFlowKmolH * frac;
      }
      if (s.enthalpyKjKmol === undefined && dippr) {
        s.enthalpyKjKmol = ProcessFlowsheetSolver.evalStreamEnthalpyDippr(s, dippr);
      }
      if (s.enthalpyKjKmol !== undefined) {
        totalOutEnthalpyKJH += s.molarFlowKmolH * s.enthalpyKjKmol;
      }
    }

    const massAbsErrorKmolH = Math.abs(totalInflowKmolH - totalOutflowKmolH);
    const massRelError = totalInflowKmolH > 0 ? massAbsErrorKmolH / totalInflowKmolH : 0;

    const perComponentRelError = {};
    for (const c of Object.keys({ ...compIn, ...compOut })) {
      const cin = compIn[c] || 0;
      const cout = compOut[c] || 0;
      perComponentRelError[c] = cin > 0 ? Math.abs(cin - cout) / cin : Math.abs(cin - cout);
    }

    const totalEnergyInKJH = totalInEnthalpyKJH + totalDutyAddedKJperH;
    const totalEnergyOutKJH = totalOutEnthalpyKJH + totalDutyRemovedKJperH;
    const energyAbsErrorKJH = Math.abs(totalEnergyInKJH - totalEnergyOutKJH);
    const energyRelError = totalEnergyInKJH !== 0 ? energyAbsErrorKJH / Math.abs(totalEnergyInKJH) : 0;

    return {
      massBalance: {
        totalInflowKmolH,
        totalOutflowKmolH,
        absErrorKmolH: massAbsErrorKmolH,
        relError: massRelError,
        perComponentRelError
      },
      energyBalance: {
        totalInflowEnergyKJH: totalInEnthalpyKJH,
        totalOutflowEnergyKJH: totalOutEnthalpyKJH,
        totalDutyAddedKJperH,
        totalDutyRemovedKJperH,
        totalEnergyInKJH,
        totalEnergyOutKJH,
        absErrorKJH: energyAbsErrorKJH,
        relError: energyRelError
      },
      boundaryInletStreams: boundaryInletStreams.map((s) => s.id),
      boundaryOutletStreams: boundaryOutletStreams.map((s) => s.id),
      isConserved: massRelError < 1e-4 && energyRelError < 1e-4
    };
  }

  /**
   * Evaluates the stream enthalpy in kJ/kmol (= J/mol) using DIPPR pure-component correlations.
   * Basis: ideal gas enthalpy at T_C relative to 298.15 K, minus latent heat of vaporization for liquid fraction.
   * @param {ProcessStream} stream
   * @param {object} [dipprCatalog]
   * @returns {number}
   */
  static evalStreamEnthalpyDippr(stream, dipprCatalog = null) {
    const dippr = dipprCatalog || ProcessFlowsheetSolver.getDipprCatalogSafe();
    if (!dippr || !stream || !stream.composition) return 0.0;
    const TK = (stream.T_C !== undefined ? stream.T_C : 25) + 273.15;
    const vf = Number.isFinite(stream.vaporFraction) ? stream.vaporFraction : 0.0;
    let hTotal = 0.0;
    for (const [c, frac] of Object.entries(stream.composition)) {
      if (!frac) continue;
      const hig = dippr.evalIdealGasEnthalpy(c, TK, 298.15);
      const hvap = dippr.evalHeatOfVaporization(c, TK);
      const hPhase = hig - (1.0 - vf) * hvap;
      hTotal += frac * hPhase;
    }
    return hTotal;
  }

  static getDipprCatalogSafe() {
    try {
      const { getDipprCatalog } = require('./dippr_expanded_catalog');
      return getDipprCatalog();
    } catch {
      return null;
    }
  }

  static resolveDipprProperties(componentNames) {
    const dippr = ProcessFlowsheetSolver.getDipprCatalogSafe();
    if (!dippr) throw new Error('DIPPRExpandedCatalog is not available.');
    const result = {};
    for (const name of componentNames) {
      result[name] = dippr.resolveProperties(name);
    }
    return result;
  }

  /** Experimental capability placeholder: no sourced cryogenic process model is available. */
  static solveCryogenicLoadingCycle() {
    return {
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      error: 'No sourced cryogenic property set, verified process model, or independent reference is available.'
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ProcessStream, ProcessFlowsheetSolver };
}
