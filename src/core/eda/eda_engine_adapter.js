'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { SpiceEngine } = require('./spice_engine');
const { StaticTimingAnalysis } = require('./static_timing_analysis');
const { DRCEngine } = require('./drc_engine');

/**
 * EDAEngineAdapter: Standard EngineAdapter for SPICE Simulation, Static Timing Analysis, and Physical DRC Screening
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
        'run_drc'
      ],
      maturity: ValidationMaturity.CORRELATED,
      native: false
    };
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(new JobEvent({ jobId, type: JobEventType.STARTED, message: `Starting EDA operation "${jobRequest.operation}"` }));

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      const params = jobRequest.parameters || {};

      switch (jobRequest.operation) {
        case 'simulate_spice_dc': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 20, message: 'Parsing circuit netlist components' }));
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

          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 60, message: 'Solving DC operating point via Newton-Raphson MNA' }));
          outputData = engine.runDCOperatingPoint(params.maxIter || 50, params.tol || 1e-6);
          break;
        }

        case 'simulate_spice_transient': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 20, message: 'Configuring transient MNA matrices' }));
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
                default:
                  break;
              }
            }
          }

          const tStop = Number(params.tStop || 0.005);
          const dt = Number(params.dt || 1e-5);

          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 50, message: `Running Backward Euler time-marching to t=${tStop}s` }));
          outputData = engine.runTransient(tStop, dt);
          break;
        }

        case 'static_timing_analysis': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 40, message: 'Tracing setup and hold paths with gate and wire delays' }));
          outputData = StaticTimingAnalysis.evaluatePathTiming(params);
          break;
        }

        case 'extract_wire_parasitics': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 40, message: 'Extracting Palmer/Sakurai fringe and parallel plate capacitance' }));
          outputData = StaticTimingAnalysis.extractParasitics(params);
          break;
        }

        case 'run_drc': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 50, message: 'Screening 2D rectangular shapes against DRC rules' }));
          outputData = DRCEngine.runDRC(params.shapes, params.rules);
          break;
        }

        default:
          throw new OmniError(OmniErrorCode.UNSUPPORTED, `Operation "${jobRequest.operation}" not implemented in EDAEngineAdapter`);
      }

      onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 100, message: 'EDA operation complete' }));

      const durationMs = Date.now() - tStart;
      const result = new JobResult({
        jobId,
        status: JobStatus.SUCCEEDED,
        outputData,
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
