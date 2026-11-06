/**
 * OmniEng HPC Cluster Gateway — legacy compatibility facade.
 *
 * This is the historical public entry point (src/core/math) used by
 * production callers (hpc_engine_adapter.js, headless_solver_daemon.js,
 * cloud_cluster.js). It now delegates every operation to the single unified
 * implementation in src/core/hpc/hpc_cluster_gateway.js so that production
 * consumes exactly one state machine and one set of genuine script
 * generators. The public class name (HpcClusterGateway), its static helpers
 * (generateSlurmScript, generatePbsScript, partitionRcb,
 * planOutOfCoreFrontal, VERSION) and the instance API
 * (submitJob, submitSimulationJob, markRunning, markCompleted, failJob,
 * getJob, listJobs, getTelemetry, getClusterStatus, setMembership) are
 * preserved verbatim.
 */

'use strict';

const {
  HpcClusterGateway: UnifiedHpcClusterGateway,
  JOB_STATES,
  ALLOWED_TRANSITIONS
} = require('../hpc/hpc_cluster_gateway');

class HpcClusterGateway {
  static get VERSION() {
    return UnifiedHpcClusterGateway.VERSION;
  }

  static get JobState() {
    return UnifiedHpcClusterGateway.JobState;
  }

  /**
   * Delegates to the unified Slurm script generator. The legacy field name
   * solverExecutable is translated to the unified executable field.
   */
  static generateSlurmScript(options = {}) {
    const spec =
      options && typeof options === 'object' && !Array.isArray(options) ? { ...options } : options;
    if (spec && spec.solverExecutable !== undefined && spec.executable === undefined) {
      spec.executable = spec.solverExecutable;
    }
    if (spec) delete spec.solverExecutable;
    return UnifiedHpcClusterGateway.generateSlurmScript(spec);
  }

  static generatePbsScript(options = {}) {
    return UnifiedHpcClusterGateway.generatePbsScript(options);
  }

  static partitionRcb(points = [], numPartitions = 4) {
    return UnifiedHpcClusterGateway.partitionRcb(points, numPartitions);
  }

  static planOutOfCoreFrontal(dofCount, availableRamBytes, assumptions) {
    return UnifiedHpcClusterGateway.planOutOfCoreFrontal(dofCount, availableRamBytes, assumptions);
  }

  constructor(options = {}) {
    this._delegate = new UnifiedHpcClusterGateway(options);
  }

  get provider() {
    return this._delegate.provider;
  }

  get active() {
    return this._delegate.active;
  }

  set active(value) {
    this._delegate.active = value;
  }

  get jobs() {
    return this._delegate.jobs;
  }

  get _jobCounter() {
    return this._delegate._jobCounter;
  }

  submitJob(jobSpec) {
    return this._delegate.submitJob(jobSpec);
  }

  submitSimulationJob(jobType, params, ranks) {
    return this._delegate.submitSimulationJob(jobType, params, ranks);
  }

  markRunning(jobId) {
    return this._delegate.markRunning(jobId);
  }

  markCompleted(jobId) {
    return this._delegate.markCompleted(jobId);
  }

  failJob(jobId, error) {
    return this._delegate.failJob(jobId, error);
  }

  getJob(jobId) {
    return this._delegate.getJob(jobId);
  }

  listJobs(filter) {
    return this._delegate.listJobs(filter);
  }

  getTelemetry() {
    return this._delegate.getTelemetry();
  }

  getClusterStatus() {
    return this._delegate.getClusterStatus();
  }

  setMembership(active) {
    return this._delegate.setMembership(active);
  }
}

module.exports = {
  HpcClusterGateway,
  JOB_STATES,
  ALLOWED_TRANSITIONS
};
