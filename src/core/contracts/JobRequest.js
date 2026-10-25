'use strict';

const crypto = require('crypto');
const { OmniError, OmniErrorCode } = require('./OmniError');

const JobPriority = Object.freeze({
  HIGH: 0,
  NORMAL: 1,
  BACKGROUND: 2
});

/**
 * Standard JobRequest specifying an immutable computation request.
 */
class JobRequest {
  /**
   * @param {object} params
   * @param {string} [params.jobId] - Optional job UUID
   * @param {string} params.domain - Engineering domain (e.g. 'cad', 'cae', 'cfd', 'eda', 'optics', 'plant', 'controls')
   * @param {string} params.operation - Engine operation name (e.g. 'mesh', 'solve_static', 'ray_trace')
   * @param {string[]} [params.inputArtifactHashes=[]] - SHA-256 hashes of input artifacts
   * @param {number} [params.projectRevision=1] - Project revision number
   * @param {object} [params.parameters={}] - Operation-specific input parameters
   * @param {object} [params.resourceBudget] - Resource bounds
   * @param {number} [params.resourceBudget.maxTimeMs=30000] - Hard execution timeout
   * @param {number} [params.resourceBudget.maxMemoryMb=2048] - Memory ceiling
   * @param {number} [params.resourceBudget.maxThreads=4] - Max concurrent threads
   * @param {number} [params.seed=42] - Deterministic PRNG seed
   * @param {object} [params.tolerances={}] - Requested convergence / error tolerances
   * @param {number} [params.priority=JobPriority.NORMAL] - Priority
   * @param {object} [params.metadata={}] - Originating user / Stenographer intent
   */
  constructor({
    jobId,
    domain,
    operation,
    inputArtifactHashes = [],
    projectRevision = 1,
    parameters = {},
    resourceBudget = {},
    seed = 42,
    tolerances = {},
    priority = JobPriority.NORMAL,
    metadata = {}
  }) {
    if (!domain || typeof domain !== 'string') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'JobRequest requires a valid domain string');
    }
    if (!operation || typeof operation !== 'string') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'JobRequest requires a valid operation string');
    }

    this._jobId = jobId && typeof jobId === 'string' ? jobId : crypto.randomUUID();
    this._domain = domain;
    this._operation = operation;
    this._inputArtifactHashes = Object.freeze(
      [...(inputArtifactHashes || [])].map((h) => String(h).toLowerCase())
    );
    this._projectRevision = Number.isInteger(projectRevision) && projectRevision >= 0 ? projectRevision : 1;
    this._parameters = Object.freeze(JSON.parse(JSON.stringify(parameters || {})));

    this._resourceBudget = Object.freeze({
      maxTimeMs: Math.max(500, Number(resourceBudget.maxTimeMs) || 30000),
      maxMemoryMb: Math.max(64, Number(resourceBudget.maxMemoryMb) || 2048),
      maxThreads: Math.max(1, Number(resourceBudget.maxThreads) || 4)
    });

    this._seed = Number.isInteger(seed) ? seed : 42;
    this._tolerances = Object.freeze({ ...tolerances });
    this._priority = [JobPriority.HIGH, JobPriority.NORMAL, JobPriority.BACKGROUND].includes(priority)
      ? priority
      : JobPriority.NORMAL;
    this._metadata = Object.freeze({ ...metadata });
    this._createdAt = new Date().toISOString();
    Object.freeze(this);
  }

  get jobId() { return this._jobId; }
  get domain() { return this._domain; }
  get operation() { return this._operation; }
  get inputArtifactHashes() { return this._inputArtifactHashes; }
  get projectRevision() { return this._projectRevision; }
  get parameters() { return this._parameters; }
  get resourceBudget() { return this._resourceBudget; }
  get seed() { return this._seed; }
  get tolerances() { return this._tolerances; }
  get priority() { return this._priority; }
  get metadata() { return this._metadata; }
  get createdAt() { return this._createdAt; }

  /**
   * Deterministic hash of the request content (inputs, operation, parameters, seed, tolerances).
   * @returns {string} SHA-256 hex
   */
  computeContentHash() {
    const canonical = {
      domain: this._domain,
      operation: this._operation,
      inputArtifactHashes: [...this._inputArtifactHashes].sort(),
      parameters: this._parameters,
      seed: this._seed,
      tolerances: this._tolerances
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  toJSON() {
    return {
      jobId: this._jobId,
      domain: this._domain,
      operation: this._operation,
      inputArtifactHashes: [...this._inputArtifactHashes],
      projectRevision: this._projectRevision,
      parameters: this._parameters,
      resourceBudget: this._resourceBudget,
      seed: this._seed,
      tolerances: this._tolerances,
      priority: this._priority,
      metadata: this._metadata,
      createdAt: this._createdAt
    };
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Invalid JobRequest JSON');
    }
    return new JobRequest(json);
  }
}

module.exports = {
  JobRequest,
  JobPriority
};
