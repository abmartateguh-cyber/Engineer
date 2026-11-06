'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');
const { Quantity } = require('../contracts/Quantity');

const { NurbsSurface } = require('./nurbs_engine');
const { SurfaceSurfaceIntersectionEngine } = require('./nurbs_trimmed_ssi');
const { EdgeBlender } = require('./edge_blender');
const { AssemblyMateSolver, AssemblyComponent } = require('./assembly_mates');
const { StepTranslator } = require('./step_translator');
const { ConstraintSolver2D } = require('./constraint_solver_2d');
const { CSGMeshBooleans } = require('./csg_mesh_booleans');

/**
 * GeometryEngineAdapter: experimental caller-input geometry operations.
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
        'solve_variational_sketch',
        'export_step',
        'boolean_union',
        'boolean_subtract',
        'boolean_intersect'
      ],
      maturity: ValidationMaturity.EXPERIMENTAL,
      native: false
    };
  }

  async validate(jobRequest) {
    await super.validate(jobRequest);
    const params = jobRequest.parameters || {};
    if (
      jobRequest.operation === 'boolean_union' ||
      jobRequest.operation === 'boolean_subtract' ||
      jobRequest.operation === 'boolean_intersect'
    ) {
      const solidA = params.solidA || params.bodyA || params.meshA || params.a;
      const solidB = params.solidB || params.bodyB || params.meshB || params.b;
      if (!solidA || !solidB) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `CAD operation "${jobRequest.operation}" requires both solidA (or bodyA) and solidB (or bodyB)`
        );
      }
      if (params.lengthUnit !== 'm' && params.lengthUnit !== 'mm') {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, 'CAD boolean operations require lengthUnit "m" or "mm".');
      }
      try {
        CSGMeshBooleans.toCSGSolid(solidA);
        CSGMeshBooleans.toCSGSolid(solidB);
      } catch (error) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, error.message);
      }
    }
    if (jobRequest.operation === 'apply_edge_blend') {
      if (
        !params.solid ||
        !Number.isFinite(params.radius) ||
        params.radius <= 0 ||
        (!(typeof params.targetEdge === 'string' && params.targetEdge.length > 0) &&
          !(params.targetEdge && typeof params.targetEdge === 'object' && typeof params.targetEdge.id === 'string')) ||
        (params.lengthUnit !== 'm' && params.lengthUnit !== 'mm')
      ) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          'CAD edge blending requires a solid, target edge, positive finite radius, and lengthUnit "m" or "mm".'
        );
      }
    }
    if (jobRequest.operation === 'solve_assembly_mates') {
      if (
        !Array.isArray(params.components) ||
        params.components.length === 0 ||
        !Array.isArray(params.mates) ||
        params.mates.length === 0 ||
        (params.lengthUnit !== 'm' && params.lengthUnit !== 'mm')
      ) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          'Assembly mate solving requires components, mates, and lengthUnit "m" or "mm".'
        );
      }
    }
    return true;
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(
      new JobEvent({ jobId, type: JobEventType.STARTED, message: `Starting CAD operation "${jobRequest.operation}"` })
    );

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      const params = jobRequest.parameters || {};

      switch (jobRequest.operation) {
        case 'evaluate_nurbs': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Evaluating surface point and normal'
            })
          );
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
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Tracing surface-surface intersection'
            })
          );
          const ssiEngine = new SurfaceSurfaceIntersectionEngine();
          outputData = ssiEngine.intersectSurfaces(params.surfA, params.surfB, params.options || {});
          break;
        }

        case 'apply_edge_blend': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Generating rolling-ball fillet'
            })
          );
          outputData = EdgeBlender.applyFillet(params.solid, params.targetEdge, params.radius, params.options || {});
          outputData.lengthUnit = params.lengthUnit;
          break;
        }

        case 'solve_assembly_mates': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: 'Relaxing kinematic mate constraints'
            })
          );
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
          outputData = { ...solver.solve(), lengthUnit: params.lengthUnit };
          break;
        }

        case 'export_step': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 60,
              message: 'Translating B-Rep to AP214 STEP format'
            })
          );
          const stepContent = StepTranslator.exportSTEP(
            params.solid || params.body || params,
            params.modelName || 'Part'
          );
          outputData = {
            stepContent,
            sizeBytes: Buffer.byteLength(stepContent, 'utf8'),
            modelName: params.modelName || 'Part'
          };
          break;
        }

        case 'solve_variational_sketch': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Solving 2D geometric constraints via Levenberg-Marquardt'
            })
          );
          const solver = new ConstraintSolver2D();
          if (Array.isArray(params.points)) {
            for (const p of params.points) {
              solver.addPoint(p.id, p.x, p.y, p.fixed);
            }
          }
          if (Array.isArray(params.constraints)) {
            for (const c of params.constraints) {
              const cp = { ...(c.params || {}), ...c };
              const type = (c.type || '').toUpperCase();
              switch (type) {
                case 'HORIZONTAL':
                  solver.addHorizontal(cp.p1, cp.p2);
                  break;
                case 'VERTICAL':
                  solver.addVertical(cp.p1, cp.p2);
                  break;
                case 'COINCIDENT':
                  solver.addCoincident(cp.p1, cp.p2);
                  break;
                case 'DISTANCE':
                case 'DISTANCE_POINTS':
                  solver.addDistance(cp.p1, cp.p2, cp.distance);
                  break;
                case 'FIXED':
                  solver.addFixed(cp.p || cp.p1 || cp.id, cp.x, cp.y);
                  break;
                default:
                  solver.addConstraint(c.type, cp);
                  break;
              }
            }
          }
          const maxIter = params.maxIterations || 50;
          const tol = params.tolerance || 1e-6;
          outputData = solver.solve(maxIter, tol);
          break;
        }

        case 'boolean_union':
        case 'boolean_subtract':
        case 'boolean_intersect': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 45,
              message: `Executing CSG ${jobRequest.operation}`
            })
          );
          const solidA = params.solidA || params.bodyA || params.meshA || params.a;
          const solidB = params.solidB || params.bodyB || params.meshB || params.b;

          let resultSolid;
          if (jobRequest.operation === 'boolean_union') {
            resultSolid = CSGMeshBooleans.union(solidA, solidB);
          } else if (jobRequest.operation === 'boolean_subtract') {
            resultSolid = CSGMeshBooleans.subtract(solidA, solidB);
          } else {
            resultSolid = CSGMeshBooleans.intersect(solidA, solidB);
          }

          const metrics = CSGMeshBooleans.computeMetrics(resultSolid);
          const mesh = resultSolid.toMesh();
          const lengthUnit = params.lengthUnit;
          const volumeUnit = lengthUnit === 'mm' ? 'mm3' : 'm3';
          const areaUnit = lengthUnit === 'mm' ? 'mm2' : 'm2';

          const volumeQty = Quantity.from(metrics.volume, volumeUnit);
          const surfaceAreaQty = Quantity.from(metrics.surfaceArea, areaUnit);

          outputData = {
            operation: jobRequest.operation,
            volume: volumeQty,
            surfaceArea: surfaceAreaQty,
            volumeValue: metrics.volume,
            surfaceAreaValue: metrics.surfaceArea,
            polygonCount: resultSolid.polygons.length,
            vertexCount: mesh.vertices.length,
            faceCount: mesh.faces.length,
            boundingBox: metrics.boundingBox,
            mesh
          };
          break;
        }

        default:
          throw new OmniError(OmniErrorCode.UNSUPPORTED, `Operation "${jobRequest.operation}" not implemented`);
      }

      onEvent(
        new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 100, message: 'Operation complete' })
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
  GeometryEngineAdapter,
  CSGMeshBooleans
};
