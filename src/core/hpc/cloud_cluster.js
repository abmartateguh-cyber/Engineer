'use strict';

const UNCONFIGURED = Object.freeze({
  code: 'UNSUPPORTED',
  message: 'No compute provider is configured; scheduler state and remote execution are unavailable.'
});

class CloudHPCEngine {
  constructor({ provider = null } = {}) {
    this.provider = provider;
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
  module.exports = { CloudHPCEngine };
}
