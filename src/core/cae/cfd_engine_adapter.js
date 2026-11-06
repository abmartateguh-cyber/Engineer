'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { FVMNavierStokes3D } = require('./fvm_navier_stokes_3d');
const { SimpleNavierStokesSolver } = require('./simple_navier_stokes');

/**
 * CFDEngineAdapter: Standard EngineAdapter for 3D Polyhedral FVM Navier-Stokes CFD
 */
class CFDEngineAdapter extends EngineAdapter {
  constructor() {
    super('cfd', 'fvm-cfd-adapter', '2.0.0');
  }

  describeCapabilities() {
    return {
      domain: 'cfd',
      name: this.name,
      version: this.version,
      supportedOperations: ['fvm_navier_stokes_3d', 'incompressible_flow'],
      maturity: ValidationMaturity.EXPERIMENTAL,
      native: false
    };
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(
      new JobEvent({ jobId, type: JobEventType.STARTED, message: `Starting CFD solve "${jobRequest.operation}"` })
    );

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      const params = jobRequest.parameters || {};
      const steps = params.steps || 15;
      const inletVel = params.inletVelocity !== undefined ? params.inletVelocity : 15.0;
      const convergenceHistory = [];

      if (jobRequest.operation === 'incompressible_flow') {
        // Segregated SIMPLE solution with Rhie-Chow face momentum coupling.
        const mesh = new FVMNavierStokes3D(params.options || {});
        onEvent(
          new JobEvent({
            jobId,
            type: JobEventType.PROGRESS,
            progressPercent: 20,
            message: 'Discretizing 3D pressure-correction domain'
          })
        );
        mesh.createBoxDomain(
          params.nx || 10,
          params.ny || 10,
          params.nz || 8,
          params.lx || 1.0,
          params.ly || 0.8,
          params.lz || 0.6
        );

        // Convert owner/neighbor connectivity to the SIMPLE solver's left/right convention.
        const faces = mesh.faces.map((face) => ({
          leftCell: face.ownerId,
          rightCell: face.neighborId >= 0 ? face.neighborId : -1,
          boundaryType: face.boundaryType || null,
          area: face.area,
          normal: face.normal,
          inletVelocity: face.boundaryType === 'inlet' ? inletVel : undefined,
          bcPressure: face.bcPressure
        }));

        const solver = new SimpleNavierStokesSolver({ cells: mesh.cells, faces }, params.options || {});
        const maxIterations = params.maxIterations || 200;
        const convergenceTolerance = Number.isFinite(params.convergenceTolerance) ? params.convergenceTolerance : 1e-4;

        for (let iter = 0; iter < maxIterations; iter++) {
          if (signal?.aborted) {
            throw new OmniError(OmniErrorCode.CANCELLED, 'Incompressible CFD solve cancelled during iteration');
          }
          const metrics = solver.stepSIMPLE(mesh.cells, faces);
          convergenceHistory.push(metrics);
          const percent = Math.min(95, Math.round(40 + ((iter + 1) / maxIterations) * 55));
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.RESIDUAL,
              progressPercent: percent,
              residuals: {
                maxMassResidual: metrics.maxMassResidual,
                maxMomentumResidual: metrics.maxMomentumResidual
              },
              message: `SIMPLE iteration ${metrics.iteration}/${maxIterations}: mass residual = ${metrics.maxMassResidual}`
            })
          );
          if (metrics.isConverged || metrics.maxMassResidual < convergenceTolerance) {
            break;
          }
        }

        onEvent(
          new JobEvent({
            jobId,
            type: JobEventType.PROGRESS,
            progressPercent: 100,
            message: 'Incompressible CFD solve completed'
          })
        );

        const durationMs = Date.now() - tStart;
        const last = convergenceHistory[convergenceHistory.length - 1] || {};
        const result = new JobResult({
          jobId,
          status: JobStatus.SUCCEEDED,
          outputData: {
            scheme: 'SIMPLE-RhieChow',
            modelAssumptions: [
              'experimental segregated pressure-correction solver',
              'Rhie-Chow face momentum interpolation on interior faces',
              'boundary flux treatment limited to inlet faces; outlet/wall/symmetry faces are not yet flux-coupled'
            ],
            iterations: convergenceHistory.length,
            cellCount: mesh.cells.length,
            faceCount: mesh.faces.length,
            inletVelocity: inletVel,
            converged: Boolean(last.isConverged),
            finalMassResidual: last.maxMassResidual,
            finalMomentumResidual: last.maxMomentumResidual,
            convergenceHistory
          },
          convergenceHistory,
          backendName: this.name,
          backendVersion: this.version,
          executionDurationMs: durationMs,
          peakMemoryMb: process.memoryUsage().heapUsed / (1024 * 1024)
        });

        onEvent(new JobEvent({ jobId, type: JobEventType.COMPLETED, message: `Completed in ${durationMs}ms` }));
        return result;
      }

      const fvm = new FVMNavierStokes3D(params.options || {});

      onEvent(
        new JobEvent({
          jobId,
          type: JobEventType.PROGRESS,
          progressPercent: 20,
          message: 'Discretizing 3D polyhedral domain'
        })
      );
      fvm.createBoxDomain(
        params.nx || 10,
        params.ny || 10,
        params.nz || 8,
        params.lx || 1.0,
        params.ly || 0.8,
        params.lz || 0.6
      );

      onEvent(
        new JobEvent({
          jobId,
          type: JobEventType.PROGRESS,
          progressPercent: 40,
          message: 'Solving Navier-Stokes flux balances'
        })
      );

      // Solve in increments to emit residual and progress events
      const chunk = Math.max(1, Math.floor(steps / 3));
      for (let s = 0; s < steps; s += chunk) {
        if (signal?.aborted) {
          throw new OmniError(OmniErrorCode.CANCELLED, 'CFD solve cancelled during iteration');
        }
        const currentSteps = Math.min(chunk, steps - s);
        const metrics = fvm.step(inletVel, currentSteps);
        const percent = Math.min(95, Math.round(40 + ((s + currentSteps) / steps) * 55));

        onEvent(
          new JobEvent({
            jobId,
            type: JobEventType.RESIDUAL,
            progressPercent: percent,
            residuals: { maxVelocity: metrics.maxVelocity, maxTurbulentViscosity: metrics.maxTurbulentViscosity },
            message: `Step ${fvm.stepCount}/${steps}: maxVel = ${metrics.maxVelocity.toFixed(2)} m/s`
          })
        );

        convergenceHistory.push({
          step: fvm.stepCount,
          maxVelocity: metrics.maxVelocity,
          maxTurbulentViscosity: metrics.maxTurbulentViscosity
        });
      }

      onEvent(
        new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 100, message: 'CFD solve completed' })
      );

      const durationMs = Date.now() - tStart;
      const result = new JobResult({
        jobId,
        status: JobStatus.SUCCEEDED,
        outputData: {
          stepCount: fvm.stepCount,
          cellCount: fvm.cells.length,
          faceCount: fvm.faces.length,
          inletVelocity: inletVel,
          convergenceHistory
        },
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
  CFDEngineAdapter
};
