'use strict';

const crypto = require('crypto');
const { OmniError, OmniErrorCode } = require('./OmniError');

const JobPriority = Object.freeze({
  HIGH: 0,
  NORMAL: 1,
  BACKGROUND: 2
});

function assertJsonValue(value, location, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `${location} must not contain non-finite numbers`);
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new OmniError(OmniErrorCode.INVALID_INPUT, `${location} must contain JSON-compatible values only`);
  }
  if (ancestors.has(value)) {
    throw new OmniError(OmniErrorCode.INVALID_INPUT, `${location} must not contain circular references`);
  }
  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) {
    assertJsonValue(child, `${location}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

function cloneJsonRecord(value, location) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new OmniError(OmniErrorCode.INVALID_INPUT, `${location} must be an object`);
  }
  assertJsonValue(value, location);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new OmniError(OmniErrorCode.INVALID_INPUT, `${location} could not be serialized as JSON`, {}, error);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function detachedJsonCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

/**
 * Standard JobRequest specifying an immutable computation request.
 */
class JobRequest {
  /**
   * @param {object} params
   * @param {string} [params.jobId] - Optional job UUID
   * @param {string} params.domain - Engineering domain (e.g. 'cad', 'cae', 'cfd', 'eda', 'optics', 'plant', 'controls')
   * @param {string} params.operation - Engine operation name (e.g. 'mesh', 'solve_static', 'ray_trace')
   * @param {string} [params.solver=''] - Solver/method name (e.g. 'fvm_navier_stokes_3d', 'sparse_cholesky')
   * @param {string} [params.backend='js'] - Requested execution backend; the adapter must explicitly support it
   * @param {string} [params.backendVersion=''] - Optional exact adapter version constraint
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
    createdAt,
    solver = '',
    backend = 'js',
    backendVersion = '',
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
    if (solver !== '' && typeof solver !== 'string') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'JobRequest solver must be a string');
    }
    if (!['js', 'wasm', 'native', 'gpu', 'remote'].includes(backend)) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        `JobRequest backend must be one of js/wasm/native/gpu/remote; got ${backend}`
      );
    }
    if (backendVersion !== '' && typeof backendVersion !== 'string') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'JobRequest backendVersion must be a string');
    }

    this._jobId = jobId && typeof jobId === 'string' ? jobId : crypto.randomUUID();
    this._domain = domain;
    this._operation = operation;
    this._solver = solver;
    this._backend = backend;
    this._backendVersion = backendVersion;
    this._inputArtifactHashes = Object.freeze([...(inputArtifactHashes || [])].map((h) => String(h).toLowerCase()));
    this._projectRevision = Number.isInteger(projectRevision) && projectRevision >= 0 ? projectRevision : 1;
    this._parameters = deepFreeze(cloneJsonRecord(parameters, 'JobRequest parameters'));

    this._resourceBudget = Object.freeze({
      maxTimeMs: Math.max(500, Number(resourceBudget.maxTimeMs) || 30000),
      maxMemoryMb: Math.max(64, Number(resourceBudget.maxMemoryMb) || 2048),
      maxThreads: Math.max(1, Number(resourceBudget.maxThreads) || 4)
    });

    this._seed = Number.isInteger(seed) ? seed : 42;
    this._tolerances = deepFreeze(cloneJsonRecord(tolerances, 'JobRequest tolerances'));
    this._priority = [JobPriority.HIGH, JobPriority.NORMAL, JobPriority.BACKGROUND].includes(priority)
      ? priority
      : JobPriority.NORMAL;
    this._metadata = deepFreeze(cloneJsonRecord(metadata, 'JobRequest metadata'));
    if (createdAt !== undefined) {
      const createdAtMs = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
      if (!Number.isFinite(createdAtMs) || new Date(createdAtMs).toISOString() !== createdAt) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          'JobRequest createdAt must be a canonical UTC ISO date-time string'
        );
      }
    }
    this._createdAt = createdAt ?? new Date().toISOString();
    Object.freeze(this);
  }

  get jobId() {
    return this._jobId;
  }
  get domain() {
    return this._domain;
  }
  get operation() {
    return this._operation;
  }
  get solver() {
    return this._solver;
  }
  get backend() {
    return this._backend;
  }
  get backendVersion() {
    return this._backendVersion;
  }
  get inputArtifactHashes() {
    return this._inputArtifactHashes;
  }
  get projectRevision() {
    return this._projectRevision;
  }
  get parameters() {
    return this._parameters;
  }
  get resourceBudget() {
    return this._resourceBudget;
  }
  get seed() {
    return this._seed;
  }
  get tolerances() {
    return this._tolerances;
  }
  get priority() {
    return this._priority;
  }
  get metadata() {
    return this._metadata;
  }
  get createdAt() {
    return this._createdAt;
  }

  /**
   * Deterministic hash of the execution-relevant request content.
   * @returns {string} SHA-256 hex
   */
  computeContentHash() {
    const canonical = {
      domain: this._domain,
      operation: this._operation,
      solver: this._solver,
      backend: this._backend,
      backendVersion: this._backendVersion,
      inputArtifactHashes: [...this._inputArtifactHashes].sort(),
      projectRevision: this._projectRevision,
      parameters: this._parameters,
      resourceBudget: this._resourceBudget,
      seed: this._seed,
      tolerances: this._tolerances
    };
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(canonicalize(canonical)))
      .digest('hex');
  }

  toJSON() {
    return {
      jobId: this._jobId,
      domain: this._domain,
      operation: this._operation,
      solver: this._solver,
      backend: this._backend,
      backendVersion: this._backendVersion,
      inputArtifactHashes: [...this._inputArtifactHashes],
      projectRevision: this._projectRevision,
      parameters: detachedJsonCopy(this._parameters),
      resourceBudget: detachedJsonCopy(this._resourceBudget),
      seed: this._seed,
      tolerances: detachedJsonCopy(this._tolerances),
      priority: this._priority,
      metadata: detachedJsonCopy(this._metadata),
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
