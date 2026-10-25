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
   * @param {string|object} jobIdOrParams - jobId string or parameters object
   * @param {string} [type] - One of JobEventType
   * @param {object} [data={}] - Event payload (e.g. progress percentage, residual value, warning text)
   */
  constructor(jobIdOrParams, type, data = {}) {
    let jobId, eventType, eventData;
    if (typeof jobIdOrParams === 'object' && jobIdOrParams !== null && !type) {
      jobId = jobIdOrParams.jobId;
      eventType = jobIdOrParams.type;
      const { jobId: _j, type: _t, ...rest } = jobIdOrParams;
      eventData = rest;
    } else {
      jobId = jobIdOrParams;
      eventType = type;
      eventData = data;
    }

    if (!jobId || typeof jobId !== 'string') {
      throw new Error('JobEvent requires a jobId string');
    }
    if (!Object.values(JobEventType).includes(eventType)) {
      throw new Error(`Invalid JobEventType: "${eventType}"`);
    }

    this.jobId = jobId;
    this.type = eventType;
    this.data = eventData && typeof eventData === 'object' ? Object.freeze({ ...eventData }) : {};
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
