'use strict';

const { OmniError, OmniErrorCode } = require('./OmniError');
const { JobResult, JobStatus } = require('./JobResult');
const { ValidationMaturity } = require('./ValidationRecord');

/**
 * Standard abstract base class for all domain engines and compute adapters in OmniEng.
 */
class EngineAdapter {
  /**
   * @param {string} domain - Domain name (e.g. 'cad', 'cae', 'cfd', 'eda', 'optics', 'plant', 'controls')
   * @param {string} name - Engine identifier (e.g. 'occt-geometry', 'petsc-solver', 'legacy-js-fea')
   * @param {string} version - Semantic version
   */
  constructor(domain, name, version = '1.0.0') {
    if (new.target === EngineAdapter) {
      throw new TypeError('Cannot construct EngineAdapter instances directly; must subclass');
    }
    this.domain = domain;
    this.name = name;
    this.version = version;
  }

  /**
   * Returns human- and machine-readable capability manifest.
   * @returns {object} { domain, name, version, supportedOperations: string[], maturity: string, native: boolean }
   */
  describeCapabilities() {
    return {
      domain: this.domain,
      name: this.name,
      version: this.version,
      supportedOperations: [],
      maturity: ValidationMaturity.EXPERIMENTAL,
      native: false
    };
  }

  /**
   * Validates a JobRequest before queuing.
   * Throws OmniError(INVALID_INPUT) or OmniError(UNSUPPORTED) on violation.
   * @param {import('./JobRequest').JobRequest} jobRequest
   * @returns {Promise<boolean>}
   */
  async validate(jobRequest) {
    if (!jobRequest) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'EngineAdapter.validate received null request');
    }
    const caps = this.describeCapabilities();
    if (jobRequest.domain !== this.domain) {
      throw new OmniError(
        OmniErrorCode.UNSUPPORTED,
        `Domain mismatch: adapter handles "${this.domain}", received "${jobRequest.domain}"`
      );
    }
    if (!caps.supportedOperations.includes(jobRequest.operation)) {
      throw new OmniError(
        OmniErrorCode.UNSUPPORTED,
        `Operation "${jobRequest.operation}" not supported by adapter "${this.name}". Available: ${caps.supportedOperations.join(', ')}`
      );
    }
    return true;
  }

  /**
   * Prepares execution environment, allocates working buffers, or stages artifacts.
   * @param {import('./JobRequest').JobRequest} jobRequest
   * @returns {Promise<object>} Context to pass to execute
   */
  async prepare(jobRequest) {
    await this.validate(jobRequest);
    return {};
  }

  /**
   * Executes the job request with progress callback and cancellation signal.
   * @param {import('./JobRequest').JobRequest} jobRequest
   * @param {function(import('./JobEvent').JobEvent): void} [onEvent]
   * @param {AbortSignal} [signal]
   * @returns {Promise<JobResult>}
   */
  async execute(jobRequest, onEvent = () => {}, signal = null) {
    throw new OmniError(OmniErrorCode.UNSUPPORTED, `${this.name}.execute() not implemented`);
  }

  /**
   * Cancels a running job.
   * @param {string} jobId
   * @returns {Promise<boolean>}
   */
  async cancel(jobId) {
    return false;
  }

  /**
   * Captures intermediate checkpoint state for crash recovery or restart.
   * @param {string} jobId
   * @returns {Promise<object|null>}
   */
  async checkpoint(jobId) {
    return null;
  }
}

module.exports = {
  EngineAdapter
};
