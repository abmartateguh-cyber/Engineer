'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { FEASolver } = require('./fea_structural');
const { DropTestSimulator } = require('./drop_test');
const { DelaunayConstrained2D } = require('./delaunay_constrained_2d');

/**
 * FEAEngineAdapter: experimental linear-elastic FEA and drop-test routes.
 */
class FEAEngineAdapter extends EngineAdapter {
  constructor() {
    super('cae', 'fea-structural-adapter', '2.0.0');
  }

  describeCapabilities() {
    return {
      domain: 'cae',
      name: this.name,
      version: this.version,
      supportedOperations: ['linear_elastic_3d', 'drop_test', 'mesh_planar_polygon_2d'],
      supportedSolvers: ['FEASolver', 'DelaunayConstrained2D'],
      maturity: ValidationMaturity.EXPERIMENTAL,
      native: false
    };
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(
      new JobEvent({ jobId, type: JobEventType.STARTED, message: `Starting FEA solve "${jobRequest.operation}"` })
    );

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      let convergenceHistory = [];
      const params = jobRequest.parameters;

      switch (jobRequest.operation) {
        case 'linear_elastic_3d': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 20,
              message: 'Assembling global stiffness matrix K'
            })
          );
          const solver = new FEASolver();

          // Add nodes
          if (Array.isArray(params.nodes)) {
            for (const n of params.nodes) {
              const node = solver.addNode(n.x, n.y, n.z);
              if (n.fixed) {
                solver.fixNode(node.id, Boolean(n.fixed[0]), Boolean(n.fixed[1]), Boolean(n.fixed[2]));
              }
              if (n.force) {
                solver.applyForce(node.id, n.force[0] || 0, n.force[1] || 0, n.force[2] || 0);
              }
            }
          }

          // Add elements
          if (Array.isArray(params.elements)) {
            for (const e of params.elements) {
              solver.addElement(e.nodes || e.nodeIds || e, e.material);
            }
          }

          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 60,
              message: 'Inverting stiffness equation K * u = F'
            })
          );
          outputData = solver.solve();
          const equilibriumResidual = solver.computeRelativeEquilibriumResidual();
          if (Number.isFinite(equilibriumResidual)) {
            convergenceHistory.push({ iteration: 1, residual: equilibriumResidual });
          }
          break;
        }

        case 'mesh_planar_polygon_2d': {
          const boundary = params.polygon;
          const holes = Array.isArray(params.holes) ? params.holes : [];
          if (!Array.isArray(boundary) || boundary.length < 3) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'mesh_planar_polygon_2d requires a polygon with at least 3 vertices',
              { domain: this.domain, operation: jobRequest.operation }
            );
          }
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 25,
              message: 'Running constrained Delaunay triangulation'
            })
          );
          const mesher = new DelaunayConstrained2D(params.options || {});
          const mesh = mesher.triangulatePolygon(boundary, holes, params.options || {});
          outputData = {
            type: mesh.type,
            nodes: mesh.nodes,
            triangles: mesh.triangles,
            constrainedEdges: mesh.constrainedEdges,
            metrics: mesh.metrics
          };
          break;
        }

        case 'drop_test': {
          if (
            !Number.isFinite(params.dropHeightM) ||
            params.dropHeightM <= 0 ||
            !Number.isFinite(params.phoneMassKg) ||
            params.phoneMassKg <= 0 ||
            !['corner', 'edge', 'face'].includes(params.impactAngle)
          ) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'drop_test requires positive dropHeightM and phoneMassKg values and an impactAngle of corner, edge, or face',
              { domain: this.domain, operation: jobRequest.operation }
            );
          }
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 25,
              message: 'Simulating transient handset impact'
            })
          );
          outputData = DropTestSimulator.runSimulation({
            dropHeight: params.dropHeightM,
            phoneMass: params.phoneMassKg,
            impactAngle: params.impactAngle
          });
          break;
        }

        default:
          throw new OmniError(OmniErrorCode.UNSUPPORTED, `Operation "${jobRequest.operation}" not implemented`);
      }

      onEvent(new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 100, message: 'Solve complete' }));

      const durationMs = Date.now() - tStart;
      const result = new JobResult({
        jobId,
        status: JobStatus.SUCCEEDED,
        outputData,
        convergenceHistory,
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
  FEAEngineAdapter
};
