'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { FVMNavierStokes3D } = require('./fvm_navier_stokes_3d');

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

      const steps = params.steps || 15;
      const inletVel = params.inletVelocity !== undefined ? params.inletVelocity : 15.0;
      const convergenceHistory = [];

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
