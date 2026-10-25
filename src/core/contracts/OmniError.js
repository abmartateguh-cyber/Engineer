'use strict';

/**
 * Standard OmniEng Error codes defined by the Industrial-Readiness architecture.
 */
const OmniErrorCode = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  UNSUPPORTED: 'UNSUPPORTED',
  NUMERICAL_FAILURE: 'NUMERICAL_FAILURE',
  CANCELLED: 'CANCELLED',
  TIMEOUT: 'TIMEOUT',
  RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
  INTERNAL: 'INTERNAL'
});

/**
 * Standard structured error across all OmniEng engines, adapters, and IPC boundaries.
 */
class OmniError extends Error {
  /**
   * @param {string} code - One of OmniErrorCode
   * @param {string} message - Human-readable message
   * @param {object} [details={}] - Structured diagnostic context
   * @param {Error} [cause] - Underlying cause if any
   */
  constructor(code, message, details = {}, cause = undefined) {
    super(message);
    this.name = 'OmniError';
    if (!Object.values(OmniErrorCode).includes(code)) {
      throw new Error(`Invalid OmniError code: "${code}". Allowed: ${Object.values(OmniErrorCode).join(', ')}`);
    }
    this.code = code;
    this.details = details && typeof details === 'object' ? Object.freeze({ ...details }) : {};
    this.timestamp = new Date().toISOString();
    if (cause) {
      this.cause = cause;
    }
  }

  /**
   * Serializes error for IPC / JSON logging.
   * @returns {object}
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }

  /**
   * Deserializes a plain object to OmniError.
   * @param {object} json
   * @returns {OmniError}
   */
  static fromJSON(json) {
    if (!json || typeof json !== 'object') {
      return new OmniError(OmniErrorCode.INTERNAL, 'Malformed error object');
    }
    const err = new OmniError(json.code || OmniErrorCode.INTERNAL, json.message || 'Unknown error', json.details);
    if (json.timestamp) err.timestamp = json.timestamp;
    if (json.stack) err.stack = json.stack;
    return err;
  }
}

module.exports = {
  OmniError,
  OmniErrorCode
};
