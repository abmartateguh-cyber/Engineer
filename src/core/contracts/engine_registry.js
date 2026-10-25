'use strict';

const { OmniError, OmniErrorCode } = require('./OmniError');
const { GeometryEngineAdapter } = require('../cad/geometry_engine_adapter');
const { FEAEngineAdapter } = require('../cae/fea_engine_adapter');
const { CFDEngineAdapter } = require('../cae/cfd_engine_adapter');
const { ControlsEngineAdapter } = require('../controls/controls_engine_adapter');
const { EDAEngineAdapter } = require('../eda/eda_engine_adapter');
const { OpticsEngineAdapter } = require('../optics/optics_engine_adapter');
const { PlantEngineAdapter } = require('../plant/plant_engine_adapter');
const { CAMEngineAdapter } = require('../cam/cam_engine_adapter');
const { AerospaceEngineAdapter } = require('../aerospace/aerospace_engine_adapter');

/**
 * EngineRegistry: Unified central registry of all industrial domain EngineAdapters
 */
class EngineRegistry {
  constructor() {
    this._adapters = new Map();
    this.register(new GeometryEngineAdapter());
    this.register(new FEAEngineAdapter());
    this.register(new CFDEngineAdapter());
    this.register(new ControlsEngineAdapter());
    this.register(new EDAEngineAdapter());
    this.register(new OpticsEngineAdapter());
    this.register(new PlantEngineAdapter());
    this.register(new CAMEngineAdapter());
    this.register(new AerospaceEngineAdapter());
  }

  register(adapter) {
    if (!adapter || typeof adapter.domain !== 'string') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Invalid adapter registration');
    }
    this._adapters.set(adapter.domain.toLowerCase(), adapter);
  }

  getAdapter(domain) {
    if (!domain || typeof domain !== 'string') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Domain string is required');
    }
    const adapter = this._adapters.get(domain.toLowerCase());
    if (!adapter) {
      throw new OmniError(OmniErrorCode.UNSUPPORTED, `No EngineAdapter registered for domain: "${domain}"`);
    }
    return adapter;
  }

  hasAdapter(domain) {
    if (!domain || typeof domain !== 'string') return false;
    return this._adapters.has(domain.toLowerCase());
  }

  listRegisteredDomains() {
    return Array.from(this._adapters.keys());
  }

  describeAllCapabilities() {
    const caps = {};
    for (const [domain, adapter] of this._adapters.entries()) {
      caps[domain] = adapter.describeCapabilities();
    }
    return caps;
  }

  async dispatch(jobRequest, onEvent = () => {}, signal = null) {
    if (!jobRequest || !jobRequest.domain) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'dispatch requires a JobRequest with a valid domain');
    }
    const adapter = this.getAdapter(jobRequest.domain);
    return adapter.execute(jobRequest, onEvent, signal);
  }
}

const defaultEngineRegistry = new EngineRegistry();

module.exports = {
  EngineRegistry,
  defaultEngineRegistry
};
