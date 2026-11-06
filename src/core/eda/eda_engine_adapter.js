'use strict';

const crypto = require('crypto');
const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { Quantity } = require('../contracts/Quantity');
const { ValidationRecord, ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { SpiceEngine } = require('./spice_engine');
const { StaticTimingAnalysis } = require('./static_timing_analysis');
const { DRCEngine } = require('./drc_engine');
const { LogicSynthesisEngine } = require('./logic_synthesis');
const { PlaceAndRouteEngine } = require('./place_and_route_engine');
const { OasisStreamEngine } = require('./oasis_stream_engine');
const { SpefParasiticExtractor } = require('./parasitic_spef_extractor');
const { SignalIntegrityCrosstalkAnalyzer } = require('./signal_integrity_crosstalk');
const { PowerGridIRDropAnalyzer } = require('./power_grid_ir_drop');

/**
 * EDAEngineAdapter: experimental caller-input circuit, timing, layout, and estimation routes.
 */
class EDAEngineAdapter extends EngineAdapter {
  constructor() {
    super('eda', 'eda-electronics-engine-adapter', '2.0.0');
  }

  describeCapabilities() {
    return {
      domain: 'eda',
      name: this.name,
      version: this.version,
      supportedOperations: [
        'simulate_spice_dc',
        'simulate_spice_transient',
        'static_timing_analysis',
        'extract_wire_parasitics',
        'run_drc',
        'synthesize_logic',
        'place_and_route',
        'serialize_oasis',
        'deserialize_oasis',
        'evaluate_oasis_compression',
        'extract_spef',
        'parse_spef',
        'evaluate_crosstalk',
        'analyze_ir_drop',
        'calculate_electromigration'
      ],
      maturity: ValidationMaturity.EXPERIMENTAL,
      native: false
    };
  }

  /**
   * Register circuit components for a transient simulation. Unlike the DC
   * branch, transient simulation supports the same device set as DC and
   * refuses to silently drop unrecognized device types.
   * @private
   */
  _registerTransientComponents(engine, components) {
    for (const c of components) {
      switch (c.type) {
        case 'R':
          engine.addResistor(c.id, c.n1, c.n2, c.value);
          break;
        case 'C':
          engine.addCapacitor(c.id, c.n1, c.n2, c.value, c.v0 || 0);
          break;
        case 'L':
          engine.addInductor(c.id, c.n1, c.n2, c.value, c.i0 || 0);
          break;
        case 'V':
          engine.addVoltageSource(c.id, c.nPlus, c.nMinus, c.dcValue || 0, c.waveform);
          break;
        case 'I':
          engine.addCurrentSource(c.id, c.nFrom, c.nTo, c.current || 0);
          break;
        case 'D': {
          engine._registerNodes(c.anode, c.cathode);
          engine.components.push({
            type: 'D',
            id: c.id,
            nAnode: String(c.anode),
            nCathode: String(c.cathode),
            Is: Number(c.is !== undefined ? c.is : 1e-14),
            n: Number(c.n !== undefined ? c.n : 1.0)
          });
          break;
        }
        case 'M': {
          engine._registerNodes(c.drain, c.gate, c.source);
          engine.components.push({
            type: 'M',
            id: c.id,
            drain: String(c.drain),
            gate: String(c.gate),
            source: String(c.source),
            mosType: String(c.model || 'NMOS').toUpperCase(),
            Vth: Number(c.vth !== undefined ? c.vth : 0.7),
            Kp: Number(c.kp !== undefined ? c.kp : 1e-3),
            lambda: Number(c.lambda !== undefined ? c.lambda : 0.01),
            // Gate capacitances (defaults documented: 1 pF for a low-power
            // CMOS gate; override with c.Cgs / c.Cgd).
            Cgs: Number(c.Cgs !== undefined ? c.Cgs : 1e-12),
            Cgd: Number(c.Cgd !== undefined ? c.Cgd : 1e-12)
          });
          break;
        }
        default:
          throw new OmniError(
            OmniErrorCode.UNSUPPORTED,
            `Unsupported circuit component type "${c.type}" in transient simulation`
          );
      }
    }
  }

  /**
   * Transient MNA solve with per-time-step Newton iteration for non-linear
   * devices (diode and MOSFET companion models).
   * @private
   */
  _runNonlinearTransient(engine, tStop, dt) {
    const nodeMap = engine._buildNodeIndexMap();
    const numNodes = nodeMap.size;
    const vSources = engine.components.filter((c) => c.type === 'V');
    const inductors = engine.components.filter((c) => c.type === 'L');
    const capacitors = engine.components.filter((c) => c.type === 'C');
    const totalDim = numNodes + vSources.length + inductors.length;

    let V = new Float64Array(totalDim);
    const capVoltages = new Map();
    for (const cap of capacitors) capVoltages.set(cap.id, cap.v0 || 0.0);
    const indCurrents = new Map();
    for (const ind of inductors) indCurrents.set(ind.id, ind.i0 || 0.0);

    const timeSteps = Math.ceil(tStop / dt);
    const timeWaveforms = { time: [], nodes: {} };
    for (const n of engine.nodes) timeWaveforms.nodes[n] = [];

    const getNodeV = (n, sol) => (n === engine.groundNode ? 0.0 : nodeMap.has(n) ? sol[nodeMap.get(n)] : 0.0);
    const Vt = 0.02585;
    const maxNewtonIter = 50;
    const newtonTol = 1e-8;

    const stampConductance = (G, n1, n2, g) => {
      const idx1 = nodeMap.has(n1) ? nodeMap.get(n1) : -1;
      const idx2 = nodeMap.has(n2) ? nodeMap.get(n2) : -1;
      if (idx1 >= 0) G[idx1][idx1] += g;
      if (idx2 >= 0) G[idx2][idx2] += g;
      if (idx1 >= 0 && idx2 >= 0) {
        G[idx1][idx2] -= g;
        G[idx2][idx1] -= g;
      }
    };

    const stampCurrent = (RHS, n1, n2, val) => {
      const idx1 = nodeMap.has(n1) ? nodeMap.get(n1) : -1;
      const idx2 = nodeMap.has(n2) ? nodeMap.get(n2) : -1;
      if (idx1 >= 0) RHS[idx1] -= val;
      if (idx2 >= 0) RHS[idx2] += val;
    };

    for (let step = 0; step <= timeSteps; step++) {
      const t = step * dt;
      let converged = false;
      for (let iter = 0; iter < maxNewtonIter; iter++) {
        const G = [];
        for (let i = 0; i < totalDim; i++) G.push(new Float64Array(totalDim));
        const RHS = new Float64Array(totalDim);

        for (const comp of engine.components) {
          if (comp.type === 'R') {
            stampConductance(G, comp.n1, comp.n2, 1.0 / comp.value);
          } else if (comp.type === 'I') {
            stampCurrent(RHS, comp.nFrom, comp.nTo, comp.value);
          }
        }

        for (const cap of capacitors) {
          const geq = cap.value / dt;
          stampConductance(G, cap.n1, cap.n2, geq);
          stampCurrent(RHS, cap.n2, cap.n1, geq * (capVoltages.get(cap.id) || 0));
        }

        for (let k = 0; k < inductors.length; k++) {
          const ind = inductors[k];
          const row = numNodes + vSources.length + k;
          const idx1 = nodeMap.has(ind.n1) ? nodeMap.get(ind.n1) : -1;
          const idx2 = nodeMap.has(ind.n2) ? nodeMap.get(ind.n2) : -1;
          if (idx1 >= 0) {
            G[row][idx1] = 1.0;
            G[idx1][row] = 1.0;
          }
          if (idx2 >= 0) {
            G[row][idx2] = -1.0;
            G[idx2][row] = -1.0;
          }
          G[row][row] = -(ind.value / dt);
          RHS[row] = -(ind.value / dt) * (indCurrents.get(ind.id) || 0.0);
        }

        for (let k = 0; k < vSources.length; k++) {
          const vs = vSources[k];
          const row = numNodes + k;
          const idxP = nodeMap.has(vs.nPlus) ? nodeMap.get(vs.nPlus) : -1;
          const idxM = nodeMap.has(vs.nMinus) ? nodeMap.get(vs.nMinus) : -1;
          if (idxP >= 0) {
            G[row][idxP] = 1.0;
            G[idxP][row] = 1.0;
          }
          if (idxM >= 0) {
            G[row][idxM] = -1.0;
            G[idxM][row] = -1.0;
          }
          RHS[row] = engine._getVoltageAtTime(vs, t);
        }

        for (const comp of engine.components) {
          if (comp.type === 'D') {
            // Shockley diode companion model:
            //   Id = Is * (exp(Vd/(n*Vt)) - 1)
            //   g  = dId/dVd = Is/(n*Vt) * exp(Vd/(n*Vt))
            //   Ieq = Id - g*Vd
            const Vd = getNodeV(comp.nAnode, V) - getNodeV(comp.nCathode, V);
            const lVd = Math.max(-10.0, Math.min(1.5, Vd));
            const expTerm = Math.exp(lVd / (comp.n * Vt));
            const Id = comp.Is * (expTerm - 1.0);
            const gd = Math.max(1e-12, (comp.Is / (comp.n * Vt)) * expTerm);
            stampConductance(G, comp.nAnode, comp.nCathode, gd);
            stampCurrent(RHS, comp.nAnode, comp.nCathode, Id - gd * lVd);
          } else if (comp.type === 'M') {
            // Level-1 square-law MOSFET companion model (triode/saturation),
            // with gate-source/gate-drain companion capacitances.
            const Vd = getNodeV(comp.drain, V);
            const Vg = getNodeV(comp.gate, V);
            const Vs = getNodeV(comp.source, V);
            const Vgs = Vg - Vs;
            const Vds = Vd - Vs;
            let Ids = 0.0;
            let gm = 1e-12;
            let gds = 1e-12;
            if (Vgs > comp.Vth) {
              const Vov = Vgs - comp.Vth;
              if (Vds < Vov && Vds >= 0) {
                Ids = comp.Kp * (Vov * Vds - 0.5 * Vds * Vds);
                gm = comp.Kp * Vds;
                gds = comp.Kp * (Vov - Vds);
              } else if (Vds >= Vov) {
                Ids = 0.5 * comp.Kp * Vov * Vov * (1.0 + comp.lambda * Vds);
                gm = comp.Kp * Vov * (1.0 + comp.lambda * Vds);
                gds = 0.5 * comp.Kp * Vov * Vov * comp.lambda;
              }
            }
            stampConductance(G, comp.drain, comp.source, gds);
            const idD = nodeMap.has(comp.drain) ? nodeMap.get(comp.drain) : -1;
            const idS = nodeMap.has(comp.source) ? nodeMap.get(comp.source) : -1;
            const idG = nodeMap.has(comp.gate) ? nodeMap.get(comp.gate) : -1;
            if (idD >= 0 && idG >= 0) G[idD][idG] += gm;
            if (idD >= 0 && idS >= 0) G[idD][idS] -= gm;
            if (idS >= 0 && idG >= 0) G[idS][idG] -= gm;
            if (idS >= 0) G[idS][idS] += gm;
            stampCurrent(RHS, comp.drain, comp.source, Ids - gm * Vgs - gds * Vds);

            const cgs = Number(comp.Cgs !== undefined ? comp.Cgs : 1e-12);
            const cgd = Number(comp.Cgd !== undefined ? comp.Cgd : 1e-12);
            if (cgs > 0) {
              const geq = cgs / dt;
              stampConductance(G, comp.gate, comp.source, geq);
              stampCurrent(RHS, comp.source, comp.gate, geq * (capVoltages.get('cgs_' + comp.id) || 0));
            }
            if (cgd > 0) {
              const geq = cgd / dt;
              stampConductance(G, comp.gate, comp.drain, geq);
              stampCurrent(RHS, comp.drain, comp.gate, geq * (capVoltages.get('cgd_' + comp.id) || 0));
            }
          }
        }

        const V_next = engine._solveLinearSystem(G, RHS, totalDim);
        let maxDelta = 0;
        let maxV = 1;
        for (let i = 0; i < totalDim; i++) {
          maxDelta = Math.max(maxDelta, Math.abs(V_next[i] - V[i]));
          maxV = Math.max(maxV, Math.abs(V_next[i]));
        }
        V = V_next;
        if (maxDelta / maxV < newtonTol) {
          converged = true;
          break;
        }
      }
      if (!converged) {
        throw new OmniError(
          OmniErrorCode.NUMERICAL_FAILURE,
          `Transient Newton loop failed to converge at t=${t}s within ${maxNewtonIter} iterations`
        );
      }

      for (const cap of capacitors) {
        capVoltages.set(cap.id, getNodeV(cap.n1, V) - getNodeV(cap.n2, V));
      }
      for (const comp of engine.components) {
        if (comp.type === 'M') {
          capVoltages.set('cgs_' + comp.id, getNodeV(comp.gate, V) - getNodeV(comp.source, V));
          capVoltages.set('cgd_' + comp.id, getNodeV(comp.gate, V) - getNodeV(comp.drain, V));
        }
      }
      for (let k = 0; k < inductors.length; k++) {
        const ind = inductors[k];
        indCurrents.set(ind.id, V[numNodes + vSources.length + k]);
      }

      if (step % Math.max(1, Math.floor(timeSteps / 200)) === 0) {
        timeWaveforms.time.push(Number((t * 1000).toFixed(4)));
        for (const n of engine.nodes) {
          timeWaveforms.nodes[n].push(Number(getNodeV(n, V).toFixed(4)));
        }
      }
    }

    timeWaveforms.waveforms = timeWaveforms.nodes;
    return timeWaveforms;
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(
      new JobEvent({ jobId, type: JobEventType.STARTED, message: `Starting EDA operation "${jobRequest.operation}"` })
    );

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      const params = jobRequest.parameters || {};

      switch (jobRequest.operation) {
        case 'simulate_spice_dc': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 20,
              message: 'Parsing circuit netlist components'
            })
          );
          const engine = new SpiceEngine();

          if (Array.isArray(params.components)) {
            for (const c of params.components) {
              switch (c.type) {
                case 'R':
                  engine.addResistor(c.id, c.n1, c.n2, c.value);
                  break;
                case 'C':
                  engine.addCapacitor(c.id, c.n1, c.n2, c.value, c.v0 || 0);
                  break;
                case 'L':
                  engine.addInductor(c.id, c.n1, c.n2, c.value, c.i0 || 0);
                  break;
                case 'V':
                  engine.addVoltageSource(c.id, c.nPlus, c.nMinus, c.dcValue || 0, c.waveform);
                  break;
                case 'I':
                  engine.addCurrentSource(c.id, c.nFrom, c.nTo, c.current || 0);
                  break;
                case 'D':
                  engine.addDiode(c.id, c.anode, c.cathode, c.is, c.vt, c.n);
                  break;
                case 'M':
                  engine.addMOSFET(c.id, c.drain, c.gate, c.source, c.model || 'NMOS', c.w, c.l, c.kp, c.vth);
                  break;
                default:
                  throw new OmniError(OmniErrorCode.UNSUPPORTED, `Unsupported circuit component type "${c.type}"`);
              }
            }
          }

          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 60,
              message: 'Solving DC operating point via Newton-Raphson MNA'
            })
          );
          outputData = engine.runDCOperatingPoint(params.maxIter || 50, params.tol || 1e-6);
          break;
        }

        case 'simulate_spice_transient': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 20,
              message: 'Configuring transient MNA matrices'
            })
          );
          const engine = new SpiceEngine();

          if (Array.isArray(params.components)) {
            this._registerTransientComponents(engine, params.components);
          }

          const tStop = Number(params.tStop || 0.005);
          const dt = Number(params.dt || 1e-5);

          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: `Running Backward Euler time-marching to t=${tStop}s`
            })
          );
          const hasNonLinear = engine.components.some((c) => c.type === 'D' || c.type === 'M');
          outputData = hasNonLinear ? this._runNonlinearTransient(engine, tStop, dt) : engine.runTransient(tStop, dt);
          break;
        }

        case 'static_timing_analysis': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Tracing setup and hold paths with gate and wire delays'
            })
          );
          outputData = StaticTimingAnalysis.evaluatePathTiming(params);
          break;
        }

        case 'extract_wire_parasitics': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Extracting Palmer/Sakurai fringe and parallel plate capacitance'
            })
          );
          outputData = StaticTimingAnalysis.extractParasitics(params);
          break;
        }

        case 'run_drc': {
          const drcMode = params.mode === 'box' ? 'box' : 'polygon';
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message:
                drcMode === 'box'
                  ? 'Screening 2D rectangular shapes against box DRC rules'
                  : 'Checking all-angle polygon geometries against DRC rules'
            })
          );
          outputData =
            drcMode === 'box'
              ? DRCEngine.runDRC(params.shapes, params.rules)
              : DRCEngine.runPolygonDRC(params.shapes, params.rules);
          break;
        }

        case 'synthesize_logic': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Synthesizing Verilog RTL with topological DAG static timing analysis'
            })
          );
          const src = params.verilogSource || params.verilog || params.source;
          outputData = LogicSynthesisEngine.synthesize(src, {
            computeTiming: true,
            clockPeriod_ps: params.clockPeriod_ps || 1000.0,
            ...params
          });
          break;
        }

        case 'place_and_route': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Executing analytical global placement and multi-layer Manhattan routing'
            })
          );
          const pnr = new PlaceAndRouteEngine({
            coreWidth: params.coreWidth || 200.0,
            coreHeight: params.coreHeight || 200.0,
            stdCellHeight: params.stdCellHeight || 10.0,
            gridPitch: params.gridPitch || 0.2,
            optimizer: params.optimizer,
            seed: params.seed
          });
          outputData = pnr.runPlaceAndRoute(params.circuitData || params);
          break;
        }

        case 'serialize_oasis': {
          const oasis = new OasisStreamEngine(params.options || {});
          outputData = {
            bytes: oasis.serialize(params.layout || params),
            version: oasis.version
          };
          break;
        }

        case 'deserialize_oasis': {
          const oasis = new OasisStreamEngine(params.options || {});
          outputData = oasis.deserialize(params.bytes || params.buffer);
          break;
        }

        case 'evaluate_oasis_compression': {
          const oasis = new OasisStreamEngine(params.options || {});
          outputData = oasis.evaluateCompressionRatio(params.layout || params);
          break;
        }

        case 'extract_spef': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: 'Extracting IEEE 1481 SPEF parasitic resistance and capacitance'
            })
          );
          outputData = SpefParasiticExtractor.extractDesignSPEF(params.pexInput || params);
          break;
        }

        case 'parse_spef': {
          outputData = SpefParasiticExtractor.parseSPEF(params.spefText || params.text || params.spef);
          break;
        }

        case 'evaluate_crosstalk': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: 'Evaluating dynamic charge transfer and peak crosstalk glitch amplitude'
            })
          );
          outputData = SignalIntegrityCrosstalkAnalyzer.evaluateCrosstalkGlitch(params.spec || params);
          break;
        }

        case 'analyze_ir_drop': {
          if (!Number.isFinite(params.vdd) || params.vdd <= 0) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'analyze_ir_drop requires a positive caller-supplied vdd.'
            );
          }
          if (!Number.isFinite(params.maxDropThresholdPercent) || params.maxDropThresholdPercent < 0) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'analyze_ir_drop requires a finite nonnegative caller-supplied maxDropThresholdPercent.'
            );
          }
          if (!Number.isFinite(params.metalThickness) || params.metalThickness <= 0) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'analyze_ir_drop requires a positive caller-supplied metalThickness in meters.'
            );
          }
          if (!Array.isArray(params.padNodeIds) || !Array.isArray(params.currentLoads)) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'analyze_ir_drop requires caller-supplied padNodeIds and currentLoads arrays.'
            );
          }

          const analyzer = new PowerGridIRDropAnalyzer({
            vdd: params.vdd,
            maxDropThresholdPercent: params.maxDropThresholdPercent,
            metalThickness: params.metalThickness
          });
          let mesh = params.mesh;
          if (mesh === undefined) {
            if (
              !Number.isSafeInteger(params.rows) ||
              params.rows < 1 ||
              !Number.isSafeInteger(params.cols) ||
              params.cols < 1
            ) {
              throw new OmniError(
                OmniErrorCode.INVALID_INPUT,
                'analyze_ir_drop requires a caller-supplied mesh or positive integer rows and cols.'
              );
            }
            for (const field of ['pitchX', 'pitchY', 'sheetRho', 'wireWidth']) {
              if (!Number.isFinite(params[field]) || params[field] <= 0) {
                throw new OmniError(
                  OmniErrorCode.INVALID_INPUT,
                  `analyze_ir_drop requires a positive caller-supplied ${field}.`
                );
              }
            }
            mesh = analyzer.createGridMesh(
              params.rows,
              params.cols,
              params.pitchX,
              params.pitchY,
              params.sheetRho,
              params.wireWidth
            );
          }
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: 'Solving PDN mesh linear system with in-house sparse Cholesky solver'
            })
          );
          outputData = analyzer.solveStaticIRDrop(mesh, params.padNodeIds, params.currentLoads);
          break;
        }

        case 'calculate_electromigration': {
          if (!Number.isFinite(params.currentDensity) || params.currentDensity <= 0) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'calculate_electromigration requires a positive caller-supplied currentDensity in A/cm^2.'
            );
          }
          if (!Number.isFinite(params.tempC) || params.tempC <= -273.15) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'calculate_electromigration requires a finite caller-supplied temperature above absolute zero in °C.'
            );
          }
          if (!params.model || typeof params.model !== 'object' || Array.isArray(params.model)) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'calculate_electromigration requires caller-supplied Black-model coefficients and provenance.'
            );
          }
          const analyzer = new PowerGridIRDropAnalyzer({});
          outputData = analyzer.evaluateBlacksEM(params.currentDensity, params.tempC, params.model);
          break;
        }

        default:
          throw new OmniError(
            OmniErrorCode.UNSUPPORTED,
            `Operation "${jobRequest.operation}" not implemented in EDAEngineAdapter`
          );
      }

      onEvent(
        new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 100, message: 'EDA operation complete' })
      );

      const inputHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ operation: jobRequest.operation, parameters: params }))
        .digest('hex');

      const validationRecord = new ValidationRecord({
        maturity: ValidationMaturity.EXPERIMENTAL,
        benchmarkSet: `EDA-${jobRequest.operation.toUpperCase()}-01`,
        errors: {
          drcViolations: Number.isFinite(outputData?.violationCount) ? outputData.violationCount : 0
        },
        tolerances: { maxDrcViolations: 0 }
      });

      if (outputData && typeof outputData === 'object' && !Array.isArray(outputData)) {
        const quantities = {};
        if (Number.isFinite(outputData.maxDropV)) {
          quantities.maxDropVoltage = Quantity.from(outputData.maxDropV, 'V').toJSON();
        }
        if (Number.isFinite(outputData.worstNegativeSlackPs)) {
          quantities.worstNegativeSlack = Quantity.from(outputData.worstNegativeSlackPs * 1e-12, 's').toJSON();
        }
        if (Number.isFinite(outputData.totalWirelength)) {
          quantities.totalWirelength = Quantity.from(outputData.totalWirelength, 'um').toJSON();
        }
        if (Number.isFinite(outputData.mttfHours)) {
          quantities.mttfHours = Quantity.from(outputData.mttfHours, 'h').toJSON();
        }
        outputData.inputSha256 = inputHash;
        outputData.validationRecord = validationRecord.toJSON();
        outputData.quantities = quantities;
      }

      const outputHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(outputData || {}))
        .digest('hex');

      const durationMs = Date.now() - tStart;
      const result = new JobResult({
        jobId,
        status: JobStatus.SUCCEEDED,
        outputData,
        inputArtifactHashes: [inputHash],
        resultArtifactHashes: [outputHash],
        validationMaturity: ValidationMaturity.EXPERIMENTAL,
        backendName: this.name,
        backendVersion: this.version,
        executionDurationMs: durationMs,
        peakMemoryMb: process.memoryUsage().heapUsed / (1024 * 1024)
      });

      onEvent(new JobEvent({ jobId, type: JobEventType.COMPLETED, message: `Completed in ${durationMs}ms` }));
      return result;
    } catch (err) {
      onEvent(new JobEvent({ jobId, type: JobEventType.FAILED, message: err.message }));
      throw err;
    }
  }
}

module.exports = {
  EDAEngineAdapter
};
