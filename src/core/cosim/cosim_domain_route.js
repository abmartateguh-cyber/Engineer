/**
 * Cosim domain route: explicit entry point for the real FMI 2.0 package
 * pipeline (`fmu_reader.js`). The legacy facade (`fmi_master_engine.js`)
 * is intentionally left untouched.
 */

'use strict';

const { FmuReader, FmuExecutionHost, FmuError } = require('./fmu_reader');

const MAX_FMU_BYTES = 64 * 1024 * 1024;

function summarizeModel(model) {
  return {
    fmiVersion: model.fmiVersion,
    modelName: model.modelName,
    guid: model.guid,
    generationTool: model.generationTool,
    variableNamingConvention: model.variableNamingConvention,
    numberOfContinuousStates: model.numberOfContinuousStates,
    capabilities: model.capabilities,
    variables: model.variables.map((v) => ({
      name: v.name,
      valueReference: v.valueReference,
      causality: v.causality,
      variability: v.variability,
      initial: v.initial,
      description: v.description,
      type: v.type
    })),
    startValues: Object.fromEntries(model.startValues),
    modelStructure: model.modelStructure
  };
}

function toFmuBuffer(input) {
  let buf;
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    buf = input;
  } else if (typeof input === 'string') {
    if (input.length > Math.ceil(MAX_FMU_BYTES / 3) * 4) {
      throw new FmuError('INVALID_INPUT', `fmu base64 exceeds the ${MAX_FMU_BYTES}-byte limit`);
    }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) {
      throw new FmuError('INVALID_INPUT', 'fmu base64 string is not canonical base64');
    }
    buf = Buffer.from(input, 'base64');
  } else {
    throw new FmuError('INVALID_INPUT', 'fmu must be provided as Buffer, Uint8Array, or base64 string');
  }
  if (buf.length > MAX_FMU_BYTES) {
    throw new FmuError('INVALID_INPUT', `fmu package exceeds the ${MAX_FMU_BYTES}-byte limit`);
  }
  return buf;
}

class CosimDomainRoute {
  constructor() {
    this.name = 'cosim-domain-route';
    this.version = '1.0.0';
    this.reader = new FmuReader();
  }

  describeOperations() {
    return ['read_fmu_package', 'parse_model_description', 'simulate_fmu'];
  }

  async execute(operation, params = {}) {
    switch (operation) {
      case 'read_fmu_package': {
        const zip = this.reader.readZip(toFmuBuffer(params.fmu));
        const model = this.reader.readModelDescription(zip);
        return {
          manifest: [...zip.entries.values()].map((e) => ({
            name: e.name,
            method: e.method,
            compressedSize: e.compressedSize,
            uncompressedSize: e.uncompressedSize,
            crc32: e.crc32
          })),
          entryCount: zip.entryCount,
          model: summarizeModel(model)
        };
      }
      case 'parse_model_description': {
        if (typeof params.xml !== 'string') {
          throw new FmuError('INVALID_INPUT', 'parse_model_description requires an xml string');
        }
        return { model: summarizeModel(this.reader.parseModelDescription(params.xml)) };
      }
      case 'simulate_fmu': {
        const { zip, model } = this.reader.readFmu(toFmuBuffer(params.fmu));
        const host = new FmuExecutionHost(model, {
          solver: params.method || 'rk4',
          derivativeFns: params.derivatives || {}
        });
        if (params.inputs) {
          for (const [name, value] of Object.entries(params.inputs)) host.setInput(name, value);
        }
        const simulation = host.simulate(params.options || {});
        return {
          model: summarizeModel(model),
          manifest: [...zip.entries.keys()],
          simulation
        };
      }
      default:
        throw new FmuError('UNSUPPORTED_OPERATION', `unknown cosim route operation "${operation}"`);
    }
  }
}

module.exports = { CosimDomainRoute };
