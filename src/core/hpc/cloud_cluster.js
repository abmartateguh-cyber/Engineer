'use strict';

const { HpcClusterGateway } = require('../math/hpc_cluster_gateway');
const { getGlobalPersistentWorkerPool } = require('../math/worker_pool');

const UNCONFIGURED = Object.freeze({
  code: 'UNSUPPORTED',
  message: 'No compute provider is configured; scheduler state and remote execution are unavailable.'
});

class LocalComputeProvider {
  constructor() {
    this.type = 'local';
    this.active = true;
  }

  getClusterStatus() {
    const telemetry = getGlobalPersistentWorkerPool().getTelemetry();
    return {
      success: true,
      configured: true,
      active: this.active,
      status: this.active ? 'READY' : 'OFFLINE',
      provider: 'local',
      workerPool: telemetry
    };
  }

  setMembership(active) {
    this.active = Boolean(active);
    return { success: true, active: this.active, provider: 'local' };
  }

  computeDomainDecomposition(elementCount, mpiRanks) {
    const n = Math.max(1, elementCount || 100);
    const k = Math.max(1, mpiRanks || 4);
    const points = [];
    const side = Math.ceil(Math.cbrt(n));
    for (let i = 0; i < n; i++) {
      const z = Math.floor(i / (side * side));
      const rem = i % (side * side);
      const y = Math.floor(rem / side);
      const x = rem % side;
      points.push({ x, y, z });
    }
    return HpcClusterGateway.partitionRcb(points, k);
  }

  async submitSimulationJob(jobType, params, mpiRanks) {
    const pool = getGlobalPersistentWorkerPool();
    const result = await pool.dispatch(jobType, { params, mpiRanks: mpiRanks || 1 });
    return {
      success: true,
      jobType,
      provider: 'local',
      result
    };
  }
}

class SlurmComputeProvider {
  constructor(options = {}) {
    this.type = 'slurm';
    this.options = options;
  }

  getClusterStatus() {
    return {
      success: false,
      configured: false,
      active: false,
      status: 'UNAVAILABLE',
      provider: 'slurm',
      scheduler: 'SLURM',
      remoteExecutionAvailable: false,
      error: { ...UNCONFIGURED }
    };
  }

  setMembership() {
    return { success: false, error: { ...UNCONFIGURED } };
  }

  computeDomainDecomposition(elementCount, mpiRanks) {
    const n = Math.max(1, elementCount || 100);
    const k = Math.max(1, mpiRanks || 4);
    const points = [];
    const side = Math.ceil(Math.cbrt(n));
    for (let i = 0; i < n; i++) {
      const z = Math.floor(i / (side * side));
      const rem = i % (side * side);
      const y = Math.floor(rem / side);
      const x = rem % side;
      points.push({ x, y, z });
    }
    return HpcClusterGateway.partitionRcb(points, k);
  }

  submitSimulationJob(jobType, params, mpiRanks) {
    const ranks = mpiRanks || 16;
    const nodes = Math.ceil(ranks / 16);
    const ntasksPerNode = Math.min(ranks, 16);
    const slurm = HpcClusterGateway.generateSlurmScript({
      jobName: jobType,
      nodes,
      ntasksPerNode,
      ...params
    });
    return {
      success: true,
      status: 'SCRIPT_TEMPLATE_ONLY',
      submitted: false,
      executionPerformed: false,
      jobType,
      provider: 'slurm',
      scheduler: 'SLURM',
      submissionSpec: slurm
    };
  }
}

class PbsComputeProvider {
  constructor(options = {}) {
    this.type = 'pbs';
    this.options = options;
  }

  getClusterStatus() {
    return {
      success: false,
      configured: false,
      active: false,
      status: 'UNAVAILABLE',
      provider: 'pbs',
      scheduler: 'PBS_PRO',
      remoteExecutionAvailable: false,
      error: { ...UNCONFIGURED }
    };
  }

  setMembership() {
    return { success: false, error: { ...UNCONFIGURED } };
  }

  computeDomainDecomposition(elementCount, mpiRanks) {
    const n = Math.max(1, elementCount || 100);
    const k = Math.max(1, mpiRanks || 4);
    const points = [];
    const side = Math.ceil(Math.cbrt(n));
    for (let i = 0; i < n; i++) {
      const z = Math.floor(i / (side * side));
      const rem = i % (side * side);
      const y = Math.floor(rem / side);
      const x = rem % side;
      points.push({ x, y, z });
    }
    return HpcClusterGateway.partitionRcb(points, k);
  }

  submitSimulationJob(jobType, params, mpiRanks) {
    const ranks = mpiRanks || 16;
    const nodes = Math.ceil(ranks / 8);
    const pbs = HpcClusterGateway.generatePbsScript({
      jobName: jobType,
      nodes,
      mpiRanksPerNode: Math.min(ranks, 8),
      ...params
    });
    return {
      success: true,
      status: 'SCRIPT_TEMPLATE_ONLY',
      submitted: false,
      executionPerformed: false,
      jobType,
      provider: 'pbs',
      scheduler: 'PBS_PRO',
      submissionSpec: pbs
    };
  }
}

class CloudHPCEngine {
  constructor({ provider = null } = {}) {
    if (typeof provider === 'string') {
      const p = provider.toLowerCase();
      if (p === 'local') this.provider = new LocalComputeProvider();
      else if (p === 'slurm') this.provider = new SlurmComputeProvider();
      else if (p === 'pbs' || p === 'pbs_pro') this.provider = new PbsComputeProvider();
      else this.provider = null;
    } else if (provider && typeof provider === 'object') {
      if (provider.type === 'local') this.provider = new LocalComputeProvider();
      else if (provider.type === 'slurm') this.provider = new SlurmComputeProvider(provider);
      else if (provider.type === 'pbs') this.provider = new PbsComputeProvider(provider);
      else this.provider = provider;
    } else {
      this.provider = null;
    }
  }

  getClusterStatus() {
    if (!this.provider || typeof this.provider.getClusterStatus !== 'function') {
      return {
        success: false,
        configured: false,
        active: false,
        status: 'UNCONFIGURED',
        error: { ...UNCONFIGURED }
      };
    }
    return this.provider.getClusterStatus();
  }

  setMembership(active) {
    if (!this.provider || typeof this.provider.setMembership !== 'function') {
      return { success: false, error: { ...UNCONFIGURED } };
    }
    return this.provider.setMembership(active);
  }

  computeDomainDecomposition(elementCount, mpiRanks) {
    if (!this.provider || typeof this.provider.computeDomainDecomposition !== 'function') {
      return { success: false, error: { ...UNCONFIGURED } };
    }
    return this.provider.computeDomainDecomposition(elementCount, mpiRanks);
  }

  submitSimulationJob(jobType, params, mpiRanks) {
    if (!this.provider || typeof this.provider.submitSimulationJob !== 'function') {
      return { success: false, error: { ...UNCONFIGURED } };
    }
    return this.provider.submitSimulationJob(jobType, params, mpiRanks);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CloudHPCEngine,
    LocalComputeProvider,
    SlurmComputeProvider,
    PbsComputeProvider
  };
}
