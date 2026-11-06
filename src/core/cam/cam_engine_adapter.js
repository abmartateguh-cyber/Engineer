'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { CNCToolpathEngine } = require('./cnc_toolpath_engine');
const { FiveAxisCAMEngine } = require('./five_axis_cam_engine');

/**
 * CAMEngineAdapter: Experimental 3-axis roughing and illustrative G-code operations.
 */
class CAMEngineAdapter extends EngineAdapter {
  constructor() {
    super('cam', 'cam-cnc-engine-adapter', '2.0.0');
    this.fiveAxisEngine = new FiveAxisCAMEngine();
  }

  describeCapabilities() {
    return {
      domain: 'cam',
      name: this.name,
      version: this.version,
      supportedOperations: [
        'plan_roughing_toolpath',
        'plan_3axis_toolpath',
        'generate_gcode',
        'plan_5axis_toolpath',
        'plan_trochoidal_toolpath',
        'calculate_constant_scallop'
      ],
      maturity: ValidationMaturity.EXPERIMENTAL,
      native: false
    };
  }

  async validate(jobRequest) {
    await super.validate(jobRequest);
    const params = jobRequest.parameters;
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'CAM operations require an explicit parameter object');
    }
    new CNCToolpathEngine(params.toolOptions);

    const validateBoundary = (boundary) => {
      if (
        !Array.isArray(boundary) ||
        boundary.length < 3 ||
        boundary.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
      ) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          'Contour CAM operations require a closed 2D boundary polygon (>= 3 finite vertices)'
        );
      }
    };
    const validateBounds = (bounds) => {
      const required = ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'];
      if (
        !bounds ||
        typeof bounds !== 'object' ||
        Array.isArray(bounds) ||
        required.some((key) => !Number.isFinite(bounds[key])) ||
        bounds.minX >= bounds.maxX ||
        bounds.minY >= bounds.maxY ||
        bounds.minZ >= bounds.maxZ
      ) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          'Contour CAM operations require six explicit finite stock bounds with positive extents'
        );
      }
    };
    const validateOptionalNonNegative = (value, name) => {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, `${name} must be finite and non-negative`);
      }
    };

    if (jobRequest.operation === 'plan_roughing_toolpath') {
      if (params.legacyMode === false) {
        validateBoundary(params.boundary);
      }
      validateBounds(params.bounds);
    } else if (jobRequest.operation === 'plan_3axis_toolpath') {
      validateBoundary(params.boundary);
      validateBounds(params.bounds);
      validateOptionalNonNegative(params.finishAllowanceMm, 'finishAllowanceMm');
    } else if (jobRequest.operation === 'generate_gcode') {
      if (!params.toolpaths || !Array.isArray(params.toolpaths.layers)) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, 'generate_gcode requires caller-supplied toolpath layers');
      }
      if (typeof params.programNumber !== 'string' || !/^O\d{1,8}$/.test(params.programNumber)) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          'generate_gcode requires an explicit O-number program identifier'
        );
      }
    } else if (jobRequest.operation === 'plan_5axis_toolpath') {
      if (!Array.isArray(params.toolpathPoints)) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, 'plan_5axis_toolpath requires toolpathPoints array');
      }
    } else if (jobRequest.operation === 'plan_trochoidal_toolpath') {
      if (!Array.isArray(params.startPoint) || !Array.isArray(params.endPoint)) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, 'plan_trochoidal_toolpath requires startPoint and endPoint arrays');
      }
    } else if (jobRequest.operation === 'calculate_constant_scallop') {
      if (!Number.isFinite(params.toolRadiusMm) || !Number.isFinite(params.scallopHeightMm)) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, 'calculate_constant_scallop requires finite toolRadiusMm and scallopHeightMm');
      }
    }
    return true;
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(
      new JobEvent({ jobId, type: JobEventType.STARTED, message: `Starting CAM operation "${jobRequest.operation}"` })
    );

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      const params = jobRequest.parameters;
      const engine = new CNCToolpathEngine(params.toolOptions);

      switch (jobRequest.operation) {
        case 'plan_roughing_toolpath': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message:
                params.legacyMode === false
                  ? 'Generating contour-parallel 3-axis roughing passes'
                  : 'Generating multi-layer constant-Z (legacy raster) roughing passes'
            })
          );
          outputData =
            params.legacyMode === false
              ? engine.plan3AxisToolpath({
                  boundary: params.boundary,
                  bounds: params.bounds,
                  finishAllowanceMm: params.finishAllowanceMm,
                  retractPlane: params.retractPlane,
                  cornerRadiusMm: params.cornerRadiusMm
                })
              : engine.planRoughingToolpath(params.bounds);
          break;
        }

        case 'plan_3axis_toolpath': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Generating contour-parallel 3-axis roughing + finish passes'
            })
          );
          outputData = engine.plan3AxisToolpath({
            boundary: params.boundary,
            bounds: params.bounds,
            finishAllowanceMm: params.finishAllowanceMm,
            retractPlane: params.retractPlane,
            cornerRadiusMm: params.cornerRadiusMm
          });
          break;
        }

        case 'generate_gcode': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Planning toolpaths for G-Code post-processing'
            })
          );
          const toolpaths = params.toolpaths;

          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 75,
              message: 'Post-processing toolpath coordinates to ISO/Fanuc G-Code'
            })
          );
          const gcode = engine.generateGCode(toolpaths, params.programNumber);

          outputData = {
            gcode,
            lineCount: gcode.split('\n').length,
            telemetry: toolpaths.telemetry || null
          };
          break;
        }

        case 'plan_5axis_toolpath': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: 'Generating 5-Axis RTCP kinematics and G43.4 code'
            })
          );
          const gcode = this.fiveAxisEngine.postProcessToGCode(params.toolpathPoints, params.options || {});
          outputData = {
            gcode,
            pointCount: params.toolpathPoints.length,
            rtcpActive: true
          };
          break;
        }

        case 'plan_trochoidal_toolpath': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: 'Generating high-speed trochoidal circular loops'
            })
          );
          const cutterD = params.cutterDiameterMm || params.toolOptions?.toolDiameter || 10.0;
          const engagement = this.fiveAxisEngine.calculateTrochoidalEngagement({
            cutterDiameterMm: cutterD,
            radialDepthMm: params.radialDepthMm || cutterD * 0.15,
            nominalFeedPerToothMm: params.nominalFeedPerToothMm || 0.08,
            teethCount: params.teethCount || 4,
            spindleRpm: params.spindleRpm || params.toolOptions?.spindleRpm || 8000
          });
          const moves = this.fiveAxisEngine.generateTrochoidalPath({
            startPoint: params.startPoint,
            endPoint: params.endPoint,
            slotWidthMm: params.slotWidthMm || cutterD * 1.5,
            cutterDiameterMm: cutterD,
            stepoverMm: params.stepoverMm || 1.5
          });
          outputData = {
            engagement,
            moves,
            moveCount: moves.length,
            loopCount: Math.round(moves.length / 5)
          };
          break;
        }

        case 'calculate_constant_scallop': {
          outputData = this.fiveAxisEngine.calculateConstantScallopStepover({
            toolRadiusMm: params.toolRadiusMm,
            scallopHeightMm: params.scallopHeightMm,
            normalCurvature: params.normalCurvature || 0.0
          });
          break;
        }

        default:
          throw new OmniError(
            OmniErrorCode.UNSUPPORTED,
            `Operation "${jobRequest.operation}" not implemented in CAMEngineAdapter`
          );
      }

      onEvent(
        new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 100, message: 'CAM operation complete' })
      );

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
