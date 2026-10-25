'use strict';

/**
 * Standard job lifecycle event types.
 */
const JobEventType = Object.freeze({
  QUEUED: 'QUEUED',
  STARTED: 'STARTED',
  PROGRESS: 'PROGRESS',
  RESIDUAL: 'RESIDUAL',
  CHECKPOINT: 'CHECKPOINT',
  WARNING: 'WARNING',
  LOG: 'LOG',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});

/**
 * Streaming event emitted during job execution.
 */
class JobEvent {
  /**
   * @param {string} jobId
   * @param {string} type - One of JobEventType
   * @param {object} [data={}] - Event payload (e.g. progress percentage, residual value, warning text)
   */
  constructor(jobId, type, data = {}) {
    if (!jobId || typeof jobId !== 'string') {
      throw new Error('JobEvent requires a jobId string');
    }
    if (!Object.values(JobEventType).includes(type)) {
      throw new Error(`Invalid JobEventType: "${type}"`);
    }

    this.jobId = jobId;
    this.type = type;
    this.data = data && typeof data === 'object' ? Object.freeze({ ...data }) : {};
    this.timestamp = new Date().toISOString();
    Object.freeze(this);
  }

  toJSON() {
    return {
      jobId: this.jobId,
      type: this.type,
      data: this.data,
      timestamp: this.timestamp
    };
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') throw new Error('Invalid JobEvent JSON');
    const ev = new JobEvent(json.jobId, json.type, json.data);
    return ev;
  }
}

module.exports = {
  JobEvent,
  JobEventType
};
