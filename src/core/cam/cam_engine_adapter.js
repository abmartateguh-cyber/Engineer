'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { CNCToolpathEngine } = require('./cnc_toolpath_engine');

/**
 * CAMEngineAdapter: Standard EngineAdapter for 3-Axis CNC Machining, Pocketing, and G-Code Post-Processing
 */
class CAMEngineAdapter extends EngineAdapter {
  constructor() {
    super('cam', 'cam-cnc-engine-adapter', '2.0.0');
  }

  describeCapabilities() {
    return {
      domain: 'cam',
      name: this.name,
      version: this.version,
      supportedOperations: [
        'plan_roughing_toolpath',
        'generate_gcode'
      ],
      maturity: ValidationMaturity.CORRELATED,
      native: false
    };
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(new JobEvent({ jobId, type: JobEventType.STARTED, message: `Starting CAM operation "${jobRequest.operation}"` }));

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      const params = jobRequest.parameters || {};
      const engine = new CNCToolpathEngine(params.toolOptions || {});

      switch (jobRequest.operation) {
        case 'plan_roughing_toolpath': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 30, message: 'Generating multi-layer constant-Z roughing passes' }));
          const bounds = params.bounds || { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: 0, maxZ: 20 };
          outputData = engine.planRoughingToolpath(bounds);
          break;
        }

        case 'generate_gcode': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 40, message: 'Planning toolpaths for G-Code post-processing' }));
          const bounds = params.bounds || { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: 0, maxZ: 20 };
          const toolpaths = params.toolpaths || engine.planRoughingToolpath(bounds);

          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 75, message: 'Post-processing toolpath coordinates to ISO/Fanuc G-Code' }));
          const gcode = engine.generateGCode(toolpaths, params.programNumber || 'O1001');

          outputData = {
            gcode,
            lineCount: gcode.split('\n').length,
            telemetry: toolpaths.telemetry || null
          };
          break;
        }

        default:
          throw new OmniError(OmniErrorCode.UNSUPPORTED, `Operation "${jobRequest.operation}" not implemented in CAMEngineAdapter`);
      }

      onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 100, message: 'CAM operation complete' }));

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
  CAMEngineAdapter
};
