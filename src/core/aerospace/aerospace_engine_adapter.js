'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { NasaRocketPropulsion } = require('./nasa_rocket_propulsion');

/**
 * AerospaceEngineAdapter: Standard EngineAdapter for Liquid Rocket Propulsion, Ascent Trajectory, and Isogrid Tank Buckling
 */
class AerospaceEngineAdapter extends EngineAdapter {
  constructor() {
    super('aerospace', 'aerospace-propulsion-engine-adapter', '2.0.0');
    this.propulsion = new NasaRocketPropulsion();
  }

  describeCapabilities() {
    return {
      domain: 'aerospace',
      name: this.name,
      version: this.version,
      supportedOperations: [
        'calculate_engine_performance',
        'evaluate_combustion',
        'simulate_ascent_trajectory',
        'calculate_staging_deltav',
        'calculate_isogrid_buckling'
      ],
      maturity: ValidationMaturity.CORRELATED,
      native: false
    };
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(new JobEvent({ jobId, type: JobEventType.STARTED, message: `Starting aerospace operation "${jobRequest.operation}"` }));

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      const params = jobRequest.parameters || {};

      switch (jobRequest.operation) {
        case 'calculate_engine_performance': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 40, message: 'Calculating rocket engine chamber and nozzle performance' }));
          const engineParams = {
            ...params,
            ambientPressureBar: params.ambientPressureBar !== undefined ? params.ambientPressureBar : 1.01325
          };
          outputData = this.propulsion.calculateEnginePerformance(engineParams);
          break;
        }

        case 'evaluate_combustion': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 40, message: 'Evaluating propellant combustion temperature and characteristic velocity' }));
          outputData = this.propulsion.evaluateCombustionEquilibrium(
            params.propellantType || 'LOX_LCH4',
            params.chamberPressureBar || 100.0,
            params.ofRatio || 3.4
          );
          break;
        }

        case 'simulate_ascent_trajectory': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 50, message: 'Simulating ascent launch trajectory through 1976 Standard Atmosphere' }));
          outputData = this.propulsion.simulateAscentTrajectory(params);
          break;
        }

        case 'calculate_staging_deltav': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 40, message: 'Evaluating Tsiolkovsky multi-stage delta-V budget' }));
          outputData = this.propulsion.calculateStagingDeltaV(params);
          break;
        }

        case 'calculate_isogrid_buckling': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 40, message: 'Screening triangular isogrid skin and rib instability' }));
          outputData = this.propulsion.calculateIsogridTankBuckling(params);
          break;
        }

        default:
          throw new OmniError(OmniErrorCode.UNSUPPORTED, `Operation "${jobRequest.operation}" not implemented in AerospaceEngineAdapter`);
      }

      onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 100, message: 'Aerospace operation complete' }));

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
  AerospaceEngineAdapter
};
