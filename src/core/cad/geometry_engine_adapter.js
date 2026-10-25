'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { NurbsSurface } = require('./nurbs_engine');
const { SurfaceSurfaceIntersectionEngine } = require('./nurbs_trimmed_ssi');
const { EdgeBlender } = require('./edge_blender');
const { AssemblyMateSolver, AssemblyComponent } = require('./assembly_mates');
const { StepTranslator } = require('./step_translator');

/**
 * GeometryEngineAdapter: Standard EngineAdapter for Exact CAD Modeling Kernel
 */
class GeometryEngineAdapter extends EngineAdapter {
  constructor() {
    super('cad', 'geometry-kernel-adapter', '2.0.0');
  }

  describeCapabilities() {
    return {
      domain: 'cad',
      name: this.name,
      version: this.version,
      supportedOperations: [
        'evaluate_nurbs',
        'intersect_nurbs_ssi',
        'apply_edge_blend',
        'solve_assembly_mates',
        'export_step'
      ],
      maturity: ValidationMaturity.CORRELATED,
      native: false
    };
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(new JobEvent({ jobId, type: JobEventType.STARTED, message: `Starting CAD operation "${jobRequest.operation}"` }));

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      const params = jobRequest.parameters || {};

      switch (jobRequest.operation) {
        case 'evaluate_nurbs': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 40, message: 'Evaluating surface point and normal' }));
          const surfParams = params.surface || params;
          const surface = new NurbsSurface(surfParams);
          const u = params.u !== undefined ? params.u : 0.5;
          const v = params.v !== undefined ? params.v : 0.5;
          const point = surface.evaluate(u, v);
          outputData = {
            point: { x: point.x, y: point.y, z: point.z },
            u,
            v,
            degreeU: surface.degreeU,
            degreeV: surface.degreeV
          };
          break;
        }

        case 'intersect_nurbs_ssi': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 30, message: 'Tracing surface-surface intersection' }));
          const ssiEngine = new SurfaceSurfaceIntersectionEngine();
          outputData = ssiEngine.intersectSurfaces(params.surfA, params.surfB, params.options || {});
          break;
        }

        case 'apply_edge_blend': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 40, message: 'Generating rolling-ball fillet' }));
          outputData = EdgeBlender.applyFillet(params.solid, params.targetEdge, params.radius || 5.0, params.options || {});
          break;
        }

        case 'solve_assembly_mates': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 50, message: 'Relaxing kinematic mate constraints' }));
          const solver = new AssemblyMateSolver();
          if (Array.isArray(params.components)) {
            for (const c of params.components) {
              solver.addComponent(new AssemblyComponent(c.id, c.name, c));
            }
          }
          if (Array.isArray(params.mates)) {
            for (const m of params.mates) {
              solver.addMate(m);
            }
          }
          outputData = solver.solve();
          break;
        }

        case 'export_step': {
          onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 60, message: 'Translating B-Rep to AP214 STEP format' }));
          const stepContent = StepTranslator.exportSTEP(params.solid || params.body || params, params.modelName || 'Part');
          outputData = {
            stepContent,
            sizeBytes: Buffer.byteLength(stepContent, 'utf8'),
            modelName: params.modelName || 'Part'
          };
          break;
        }

        default:
          throw new OmniError(OmniErrorCode.UNSUPPORTED, `Operation "${jobRequest.operation}" not implemented`);
      }

      onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 100, message: 'Operation complete' }));

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
  GeometryEngineAdapter
};
