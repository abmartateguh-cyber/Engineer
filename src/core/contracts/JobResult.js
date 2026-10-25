'use strict';

const { OmniError, OmniErrorCode } = require('./OmniError');
const { ValidationMaturity } = require('./ValidationRecord');

const JobStatus = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  SUCCEEDED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  TIMED_OUT: 'TIMED_OUT'
});

/**
 * Standard JobResult documenting the output, residual convergence, timing, memory, and validation.
 */
class JobResult {
  /**
   * @param {object} params
   * @param {string} params.jobId
   * @param {string} params.status - One of JobStatus
   * @param {object} [params.output={}] - Direct output data or metrics
   * @param {string[]} [params.resultArtifactHashes=[]] - SHA-256 hashes of generated artifacts
   * @param {object[]} [params.residualHistory=[]] - Array of { iteration, residual, step }
   * @param {string[]} [params.warnings=[]] - Diagnostic warnings emitted during run
   * @param {object} [params.timing={}] - { queuedMs, runMs, totalMs }
   * @param {number} [params.peakMemoryBytes=0] - Peak heap or resident memory
   * @param {object} [params.backendVersions={}] - Versions of solver, runtime, dependencies
   * @param {string[]} [params.inputArtifactHashes=[]] - Hashes of inputs consumed
   * @param {string} [params.validationMaturity=ValidationMaturity.EXPERIMENTAL] - Validation maturity
   * @param {OmniError|object|null} [params.error=null] - Failure error if status is FAILED/TIMED_OUT
   */
  constructor(params = {}) {
    const {
      jobId,
      status = JobStatus.COMPLETED,
      output,
      outputData,
      resultArtifactHashes = [],
      residualHistory,
      convergenceHistory,
      warnings = [],
      timing = {},
      executionDurationMs,
      peakMemoryBytes,
      peakMemoryMb,
      backendVersions = {},
      backendName,
      backendVersion,
      inputArtifactHashes = [],
      validationMaturity = ValidationMaturity.EXPERIMENTAL,
      error = null
    } = params;

    if (!jobId || typeof jobId !== 'string') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'JobResult requires a jobId string');
    }
    if (!Object.values(JobStatus).includes(status)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Invalid JobStatus: "${status}"`);
    }

    const resolvedOutput = output !== undefined ? output : (outputData !== undefined ? outputData : {});
    const resolvedResiduals = residualHistory !== undefined ? residualHistory : (convergenceHistory !== undefined ? convergenceHistory : []);
    const resolvedRunMs = executionDurationMs !== undefined ? Number(executionDurationMs) : Number(timing.runMs || 0);
    const resolvedQueuedMs = Number(timing.queuedMs || 0);
    const resolvedTotalMs = Number(timing.totalMs) || (resolvedQueuedMs + resolvedRunMs);

    let resolvedPeakMem = 0;
    if (Number.isInteger(peakMemoryBytes) && peakMemoryBytes >= 0) {
      resolvedPeakMem = peakMemoryBytes;
    } else if (typeof peakMemoryMb === 'number' && peakMemoryMb >= 0) {
      resolvedPeakMem = Math.round(peakMemoryMb * 1024 * 1024);
    }

    const resolvedBackendVersions = { ...backendVersions };
    if (backendName && backendVersion) {
      resolvedBackendVersions[backendName] = backendVersion;
    }

    this._jobId = jobId;
    this._status = status;
    this._output = Object.freeze(JSON.parse(JSON.stringify(resolvedOutput || {})));
    this._resultArtifactHashes = Object.freeze([...(resultArtifactHashes || [])].map((h) => String(h).toLowerCase()));
    this._residualHistory = Object.freeze([...(resolvedResiduals || [])].map((r) => Object.freeze({ ...r })));
    this._warnings = Object.freeze([...(warnings || [])].map(String));

    this._timing = Object.freeze({
      queuedMs: Math.max(0, resolvedQueuedMs),
      runMs: Math.max(0, resolvedRunMs),
      totalMs: Math.max(0, resolvedTotalMs)
    });

    this._peakMemoryBytes = resolvedPeakMem;
    this._backendVersions = Object.freeze(resolvedBackendVersions);
    this._inputArtifactHashes = Object.freeze([...(inputArtifactHashes || [])].map((h) => String(h).toLowerCase()));
    this._validationMaturity = Object.values(ValidationMaturity).includes(validationMaturity)
      ? validationMaturity
      : ValidationMaturity.EXPERIMENTAL;

    this._error = error ? (error instanceof OmniError ? error.toJSON() : error) : null;
    this._completedAt = new Date().toISOString();
    Object.freeze(this);
  }

  get jobId() { return this._jobId; }
  get status() { return this._status; }
  get output() { return this._output; }
  get outputData() { return this._output; }
  get resultArtifactHashes() { return this._resultArtifactHashes; }
  get residualHistory() { return this._residualHistory; }
  get convergenceHistory() { return this._residualHistory; }
  get warnings() { return this._warnings; }
  get timing() { return this._timing; }
  get peakMemoryBytes() { return this._peakMemoryBytes; }
  get backendVersions() { return this._backendVersions; }
  get inputArtifactHashes() { return this._inputArtifactHashes; }
  get validationMaturity() { return this._validationMaturity; }
  get error() { return this._error; }
  get completedAt() { return this._completedAt; }

  isSuccess() {
    return this._status === JobStatus.COMPLETED;
  }

  toJSON() {
    return {
      jobId: this._jobId,
      status: this._status,
      output: this._output,
      resultArtifactHashes: [...this._resultArtifactHashes],
      residualHistory: [...this._residualHistory],
      warnings: [...this._warnings],
      timing: this._timing,
      peakMemoryBytes: this._peakMemoryBytes,
      backendVersions: this._backendVersions,
      inputArtifactHashes: [...this._inputArtifactHashes],
      validationMaturity: this._validationMaturity,
      error: this._error,
      completedAt: this._completedAt
    };
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Invalid JobResult JSON');
    }
    return new JobResult(json);
  }
}

module.exports = {
  JobResult,
  JobStatus
};
