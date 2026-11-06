/**
 * OmniEng System, Security, Compliance & Platform Domain IPC Router
 * Covers OmniAI, HPC, Audit Report, Materials, .omni Archive, AES-256 Vault, ASME VIII, Keymaps, Hardware
 */

'use strict';

const os = require('os');
const crypto = require('crypto');
const { defineHandler } = require('./define_handler');
const { IPCValidator } = require('../../core/security/ipc_validator');
const { OmniVaultAES256, OmniArchive } = require('../../core/storage/omni_archive');
const { activeProjectManager } = require('../../core/storage/project_manager');
const { ASMESectionVIIIDiv2Analyzer } = require('../../core/compliance/asme_section_viii_div2');
const { AuditReportGenerator } = require('../../core/reporting/audit_report');
const { COMMUNITY_SAMPLES } = require('../../samples/community_samples');
const { accelerator } = require('../../core/math/native_accelerator_interface');
const { getComputeHost } = require('../compute_host');
const { listFeatureMaturity } = require('../../core/maturity/feature_maturity');
const { StenographerSupervisor } = require('../stenographer_supervisor');
const { defaultEngineRegistry } = require('../../core/contracts/engine_registry');
const { OmniAIEngine } = require('../../core/ai/omni_ai_engine');
const { NeuralNetwork, trainSurrogate, predictSurrogate, gradientCheck } = require('../../core/ai/neural_net');
const { LinearSolver } = require('../../core/math/linear_algebra');
const { ODESolvers } = require('../../core/math/ode_solvers');
const { WasmSparseMultifrontalSolver } = require('../../core/math/wasm_sparse_multifrontal');
const { JobRequest } = require('../../core/contracts/JobRequest');
const {
  MATERIAL_DATABASE,
  REFERENCE_TEMPERATURE_K,
  interpolateProperty
} = require('../../core/materials/material_database');
const { generateSbomReport } = require('../sbom_service');

const sharedStenographerSupervisor = new StenographerSupervisor({
  engineRegistry: defaultEngineRegistry
});
let electronDialog = null;
try {
  const electron = require('electron');
  if (typeof electron === 'object' && electron !== null) {
    electronDialog = electron.dialog;
  }
} catch {
  electronDialog = null;
}

const MAX_ENCRYPTED_SESSION_BYTES = 16 * 1024 * 1024;
const MAX_ENCRYPTED_SESSION_BASE64_LENGTH = Math.ceil(MAX_ENCRYPTED_SESSION_BYTES / 3) * 4;

function loadOmniArchiveFromBuffer(archiveBytes) {
  if (!Buffer.isBuffer(archiveBytes) && !(archiveBytes instanceof Uint8Array)) {
    return {
      success: false,
      error: { code: 'INVALID_INPUT', message: 'Provide archive bytes as a Buffer or Uint8Array.' }
    };
  }

  try {
    const archive = OmniArchive.loadFromBuffer(Buffer.from(archiveBytes));
    return { success: true, manifest: archive.manifest, sections: archive.listSections() };
  } catch (err) {
    return { success: false, error: { code: 'INVALID_INPUT', message: err.message } };
  }
}

const SYMBOLIC_REMEDIATION_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['currentDesign', 'safetyFactor'],
  properties: {
    safetyFactor: { type: 'number', min: Number.MIN_VALUE },
    currentDesign: {
      type: 'object',
      additionalProperties: false,
      required: [
        'wallThicknessMm',
        'loadN',
        'lengthMm',
        'widthMm',
        'yieldStrengthMPa',
        'youngsModulusGPa',
        'minThicknessMm',
        'maxThicknessMm'
      ],
      properties: {
        wallThicknessMm: { type: 'number', min: Number.MIN_VALUE },
        loadN: { type: 'number', min: Number.MIN_VALUE },
        lengthMm: { type: 'number', min: Number.MIN_VALUE },
        widthMm: { type: 'number', min: Number.MIN_VALUE },
        yieldStrengthMPa: { type: 'number', min: Number.MIN_VALUE },
        youngsModulusGPa: { type: 'number', min: Number.MIN_VALUE },
        minThicknessMm: { type: 'number', min: Number.MIN_VALUE },
        maxThicknessMm: { type: 'number', min: Number.MIN_VALUE }
      }
    }
  }
});

const ASME_STRESS_SCREEN_SCHEMA = Object.freeze({
  type: 'object',
  required: ['sclPoints', 'wallThicknessMm', 'allowableStressS', 'allowableStressSource', 'isSecondaryThermal'],
  additionalProperties: false,
  properties: {
    sclPoints: {
      type: 'array',
      minItems: 2,
      maxItems: 10000,
      items: {
        type: 'object',
        required: ['x', 'stressMpa'],
        additionalProperties: false,
        properties: {
          x: { type: 'number' },
          stressMpa: { type: 'number' }
        }
      }
    },
    wallThicknessMm: { type: 'number', min: Number.MIN_VALUE },
    allowableStressS: { type: 'number', min: Number.MIN_VALUE },
    allowableStressSource: { type: 'string', maxLength: 500 },
    isSecondaryThermal: { type: 'boolean' }
  }
});

function getStructuralRemediationUnavailableResult() {
  return {
    success: false,
    available: false,
    status: 'unavailable',
    validationLevel: 'experimental',
    error: {
      code: 'UNSUPPORTED',
      message:
        'Structural remediation is unavailable pending independent validation and an approval workflow. No design inputs were applied and no recommendation was generated.'
    }
  };
}

const AI_TRAIN_SURROGATE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['dataset'],
  additionalProperties: false,
  properties: {
    dataset: { type: 'object' },
    config: { type: 'object' }
  }
});

const AI_GRADIENT_CHECK_SCHEMA = Object.freeze({
  type: 'object',
  required: ['model', 'x', 'y'],
  additionalProperties: false,
  properties: {
    model: { type: 'object' },
    x: { type: 'array', minItems: 1, maxItems: 64 },
    y: { type: 'array', minItems: 1, maxItems: 64 },
    options: { type: 'object' }
  }
});

const AI_PREDICT_SURROGATE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['model', 'x'],
  additionalProperties: false,
  properties: {
    model: { type: 'object' },
    x: { type: 'array', minItems: 1, maxItems: 5000 }
  }
});

const AI_MODEL_MAX_LAYERS = 8;
const AI_MODEL_MAX_FAN_IN = 2048;
const AI_MODEL_MAX_FAN_OUT = 2048;
const AI_TRAIN_MAX_SAMPLES = 20000;
const AI_TRAIN_MAX_FEATURES = 512;
const AI_TRAIN_MAX_OUTPUTS = 128;
const AI_TRAIN_MAX_HIDDEN_UNITS = 256;
const AI_TRAIN_MAX_HIDDEN_LAYERS = 8;
const AI_TRAIN_MAX_EPOCHS = 5000;
const AI_TRAIN_MAX_BATCH_SIZE = 4096;
const AI_PREDICT_MAX_ROWS = 5000;
const AI_GRADIENT_MAX_SAMPLES = 64;
const AI_GRADIENT_MAX_CHECKS = 2000;
const AI_VALID_ACTIVATIONS = new Set(['linear', 'sigmoid', 'tanh', 'relu', 'softmax']);
const AI_VALID_LOSSES = new Set(['mse', 'crossEntropy']);

function invalidAiInput(message) {
  const err = new Error(message);
  err.code = 'INVALID_INPUT';
  return err;
}

function requireFiniteArray(values, label) {
  if (!Array.isArray(values) || values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw invalidAiInput(`${label} must be an array of finite numbers`);
  }
}

function validateAiModelJson(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw invalidAiInput('model must be a serialized neural network object');
  }
  if (model.format !== 'omnieng-neural-net-v1') {
    throw invalidAiInput('unsupported model format; expected omnieng-neural-net-v1');
  }
  if (!Number.isInteger(model.inputSize) || model.inputSize < 1 || model.inputSize > AI_MODEL_MAX_FAN_IN) {
    throw invalidAiInput(`model inputSize must be an integer from 1 through ${AI_MODEL_MAX_FAN_IN}`);
  }
  if (!Array.isArray(model.layers) || model.layers.length === 0 || model.layers.length > AI_MODEL_MAX_LAYERS) {
    throw invalidAiInput(`model must contain between 1 and ${AI_MODEL_MAX_LAYERS} layers`);
  }
  if (model.loss !== undefined && !AI_VALID_LOSSES.has(model.loss)) {
    throw invalidAiInput(`unsupported model loss "${model.loss}"`);
  }
  for (let i = 0; i < model.layers.length; i++) {
    const layer = model.layers[i];
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
      throw invalidAiInput(`model.layers[${i}] must be an object`);
    }
    if (
      !Number.isInteger(layer.fanIn) ||
      layer.fanIn < 1 ||
      layer.fanIn > AI_MODEL_MAX_FAN_IN ||
      !Number.isInteger(layer.fanOut) ||
      layer.fanOut < 1 ||
      layer.fanOut > AI_MODEL_MAX_FAN_OUT
    ) {
      throw invalidAiInput(`model.layers[${i}] fanIn/fanOut must be integers from 1 through ${AI_MODEL_MAX_FAN_IN}`);
    }
    if (!AI_VALID_ACTIVATIONS.has(layer.activation)) {
      throw invalidAiInput(`model.layers[${i}] has unsupported activation "${layer.activation}"`);
    }
    requireFiniteArray(layer.b, `model.layers[${i}].b`);
    if (layer.b.length !== layer.fanOut) {
      throw invalidAiInput(`model.layers[${i}] bias length does not match fanOut`);
    }
    if (!Array.isArray(layer.W) || layer.W.length !== layer.fanOut) {
      throw invalidAiInput(`model.layers[${i}] W must have ${layer.fanOut} rows`);
    }
    for (let r = 0; r < layer.fanOut; r++) {
      if (!Array.isArray(layer.W[r]) || layer.W[r].length !== layer.fanIn) {
        throw invalidAiInput(`model.layers[${i}] W[${r}] must have ${layer.fanIn} columns`);
      }
      requireFiniteArray(layer.W[r], `model.layers[${i}] W[${r}]`);
    }
  }
  return true;
}

function normalizeAiDataset(dataset) {
  if (dataset && typeof dataset === 'object' && !Array.isArray(dataset)) {
    if (!Array.isArray(dataset.inputs) || !Array.isArray(dataset.outputs)) {
      throw invalidAiInput('dataset must provide inputs and outputs arrays');
    }
    if (dataset.inputs.length !== dataset.outputs.length || dataset.inputs.length === 0) {
      throw invalidAiInput('dataset.inputs and dataset.outputs must be non-empty arrays of equal length');
    }
    return { inputs: dataset.inputs, outputs: dataset.outputs };
  }
  if (Array.isArray(dataset)) {
    const inputs = [];
    const outputs = [];
    for (const row of dataset) {
      if (Array.isArray(row) && row.length === 2) {
        inputs.push(row[0]);
        outputs.push(row[1]);
      } else if (row && typeof row === 'object' && Array.isArray(row.x) && Array.isArray(row.y)) {
        inputs.push(row.x);
        outputs.push(row.y);
      } else if (row && typeof row === 'object' && Array.isArray(row.input) && Array.isArray(row.output)) {
        inputs.push(row.input);
        outputs.push(row.output);
      } else {
        throw invalidAiInput('dataset rows must be [input, output] pairs or {x, y}/{input, output} objects');
      }
    }
    if (inputs.length === 0) throw invalidAiInput('dataset must not be empty');
    return { inputs, outputs };
  }
  throw invalidAiInput('dataset must be {inputs, outputs} or an array of [input, output] pairs');
}

function validateAiTrainPayload(payload) {
  const { inputs, outputs } = normalizeAiDataset(payload.dataset);
  const n = inputs.length;
  if (n > AI_TRAIN_MAX_SAMPLES) {
    throw invalidAiInput(`training is limited to ${AI_TRAIN_MAX_SAMPLES} samples`);
  }
  const inputSize = inputs[0].length;
  const outputSize = outputs[0].length;
  if (!Number.isInteger(inputSize) || inputSize < 1 || inputSize > AI_TRAIN_MAX_FEATURES) {
    throw invalidAiInput(`input feature count must be an integer from 1 through ${AI_TRAIN_MAX_FEATURES}`);
  }
  if (!Number.isInteger(outputSize) || outputSize < 1 || outputSize > AI_TRAIN_MAX_OUTPUTS) {
    throw invalidAiInput(`output dimension must be an integer from 1 through ${AI_TRAIN_MAX_OUTPUTS}`);
  }
  for (let s = 0; s < n; s++) {
    requireFiniteArray(inputs[s], `dataset.inputs[${s}]`);
    requireFiniteArray(outputs[s], `dataset.outputs[${s}]`);
    if (inputs[s].length !== inputSize) {
      throw invalidAiInput(`dataset.inputs[${s}] length does not match ${inputSize}`);
    }
    if (outputs[s].length !== outputSize) {
      throw invalidAiInput(`dataset.outputs[${s}] length does not match ${outputSize}`);
    }
  }
  const config = payload.config || {};
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw invalidAiInput('config must be an object');
  }
  if (config.hiddenUnits !== undefined) {
    if (
      !Array.isArray(config.hiddenUnits) ||
      config.hiddenUnits.length === 0 ||
      config.hiddenUnits.length > AI_TRAIN_MAX_HIDDEN_LAYERS
    ) {
      throw invalidAiInput(`hiddenUnits must be an array of 1 to ${AI_TRAIN_MAX_HIDDEN_LAYERS} layer sizes`);
    }
    for (const u of config.hiddenUnits) {
      if (!Number.isInteger(u) || u < 1 || u > AI_TRAIN_MAX_HIDDEN_UNITS) {
        throw invalidAiInput(`each hidden layer must have between 1 and ${AI_TRAIN_MAX_HIDDEN_UNITS} units`);
      }
    }
  }
  if (config.epochs !== undefined) {
    if (!Number.isInteger(config.epochs) || config.epochs < 1 || config.epochs > AI_TRAIN_MAX_EPOCHS) {
      throw invalidAiInput(`epochs must be an integer from 1 through ${AI_TRAIN_MAX_EPOCHS}`);
    }
  }
  if (config.batchSize !== undefined) {
    if (!Number.isInteger(config.batchSize) || config.batchSize < 1 || config.batchSize > AI_TRAIN_MAX_BATCH_SIZE) {
      throw invalidAiInput(`batchSize must be an integer from 1 through ${AI_TRAIN_MAX_BATCH_SIZE}`);
    }
  }
  if (config.learningRate !== undefined) {
    if (
      typeof config.learningRate !== 'number' ||
      !Number.isFinite(config.learningRate) ||
      config.learningRate <= 0 ||
      config.learningRate > 10
    ) {
      throw invalidAiInput('learningRate must be a finite positive number at most 10');
    }
  }
  if (config.momentum !== undefined) {
    if (
      typeof config.momentum !== 'number' ||
      !Number.isFinite(config.momentum) ||
      config.momentum < 0 ||
      config.momentum >= 1
    ) {
      throw invalidAiInput('momentum must be a finite number in [0, 1)');
    }
  }
  if (config.seed !== undefined && !Number.isInteger(config.seed)) {
    throw invalidAiInput('seed must be an integer');
  }
  if (config.activation !== undefined && !AI_VALID_ACTIVATIONS.has(config.activation)) {
    throw invalidAiInput(`unsupported hidden activation "${config.activation}"`);
  }
  if (config.outputActivation !== undefined && !AI_VALID_ACTIVATIONS.has(config.outputActivation)) {
    throw invalidAiInput(`unsupported output activation "${config.outputActivation}"`);
  }
  if (config.loss !== undefined && !AI_VALID_LOSSES.has(config.loss)) {
    throw invalidAiInput(`unsupported loss "${config.loss}"`);
  }
  return true;
}

function validateAiRowVectors(rows, dim, maxRows, label) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > maxRows) {
    throw invalidAiInput(`${label} must be a non-empty array of at most ${maxRows} rows`);
  }
  for (let i = 0; i < rows.length; i++) {
    requireFiniteArray(rows[i], `${label}[${i}]`);
    if (rows[i].length !== dim) {
      throw invalidAiInput(`${label}[${i}] length ${rows[i].length} does not match ${dim}`);
    }
  }
  return true;
}

function validateAiPredictPayload(payload) {
  validateAiModelJson(payload.model);
  const x = payload.x;
  const rows = Array.isArray(x) && Array.isArray(x[0]) ? x : [x];
  validateAiRowVectors(rows, payload.model.inputSize, AI_PREDICT_MAX_ROWS, 'x');
  return true;
}

function validateAiGradientPayload(payload) {
  validateAiModelJson(payload.model);
  const x = payload.x;
  const y = payload.y;
  const rows = Array.isArray(x) && Array.isArray(x[0]) ? x : [x];
  const labels = Array.isArray(y) && Array.isArray(y[0]) ? y : [y];
  if (rows.length !== labels.length) {
    throw invalidAiInput('x and y must have the same number of samples');
  }
  validateAiRowVectors(rows, payload.model.inputSize, AI_GRADIENT_MAX_SAMPLES, 'x');
  const outputSize = payload.model.layers[payload.model.layers.length - 1].fanOut;
  validateAiRowVectors(labels, outputSize, AI_GRADIENT_MAX_SAMPLES, 'y');
  const options = payload.options || {};
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw invalidAiInput('options must be an object');
  }
  if (options.maxChecks !== undefined) {
    if (!Number.isInteger(options.maxChecks) || options.maxChecks < 1 || options.maxChecks > AI_GRADIENT_MAX_CHECKS) {
      throw invalidAiInput(`maxChecks must be an integer from 1 through ${AI_GRADIENT_MAX_CHECKS}`);
    }
  }
  for (const key of ['eps', 'threshold']) {
    if (options[key] !== undefined) {
      if (typeof options[key] !== 'number' || !Number.isFinite(options[key]) || options[key] <= 0) {
        throw invalidAiInput(`${key} must be a finite positive number`);
      }
    }
  }
  if (options.loss !== undefined && !AI_VALID_LOSSES.has(options.loss)) {
    throw invalidAiInput(`unsupported loss "${options.loss}"`);
  }
  return true;
}

const STENOGRAPHER_QUERY_SCHEMA = Object.freeze({
  type: 'object',
  required: ['prompt'],
  additionalProperties: false,
  properties: {
    prompt: { type: 'string', maxLength: 8192 },
    projectRevision: { type: 'number', integer: true, min: 1 },
    context: { type: 'object' }
  }
});

function processStenographerQuery(supervisor, projectService, payload = {}) {
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : '';
  if (!prompt.trim() || prompt.length > 8192) {
    return {
      success: false,
      error: { code: 'INVALID_INPUT', message: 'A non-empty prompt of at most 8192 characters is required.' }
    };
  }

  const manifest = projectService?.getManifest?.() || null;
  const manifestRevision = manifest?.revision;
  const projectId = typeof manifest?.projectId === 'string' ? manifest.projectId : null;
  const projectRevision = Number.isSafeInteger(manifestRevision) && manifestRevision >= 1 ? manifestRevision : null;
  if (manifest && (!projectRevision || !projectId?.trim())) {
    return {
      success: false,
      error: { code: 'INVALID_INPUT', message: 'The active project identity or revision is unverifiable.' }
    };
  }
  if (payload.projectRevision !== undefined && payload.projectRevision !== projectRevision) {
    return {
      success: false,
      error: { code: 'INVALID_INPUT', message: 'The supplied project revision is stale or unverifiable.' }
    };
  }

  return supervisor.processQuery({ prompt, projectRevision, projectId, context: payload.context });
}

function proposalMatchesActiveProject(proposal, projectService) {
  const manifest = projectService?.getManifest?.();
  return Boolean(
    proposal &&
    typeof proposal.originatingProjectId === 'string' &&
    proposal.originatingProjectId.length > 0 &&
    manifest?.projectId === proposal.originatingProjectId &&
    Number.isSafeInteger(manifest.revision) &&
    manifest.revision === proposal.originatingProjectRevision
  );
}

function processLegacyMacroPrompt(payload = {}) {
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : '';
  if (!prompt.trim() || prompt.length > 8192) {
    return {
      success: false,
      error: { code: 'INVALID_INPUT', message: 'A non-empty prompt of at most 8192 characters is required.' }
    };
  }
  const plan = new OmniAIEngine().processPrompt(prompt, payload.context || {});
  return {
    ...plan,
    success: true,
    status: 'success',
    mode: 'legacy-macro-adapter',
    proposal: null,
    proposals: [],
    requiresApproval: false
  };
}

const SPARSE_SOLVE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['A', 'b'],
  additionalProperties: false,
  properties: {
    A: {},
    b: { type: 'array', minItems: 1, maxItems: 4096, items: { type: 'number' } }
  }
});

const RADAU_IIA_SCHEMA = Object.freeze({
  type: 'object',
  required: ['system', 't0', 'y0', 'tEnd'],
  additionalProperties: false,
  properties: {
    system: { type: 'string', enum: ['decay', 'vanderpol'] },
    t0: { type: 'number' },
    y0: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'number' } },
    tEnd: { type: 'number' },
    rtol: { type: 'number', min: Number.MIN_VALUE, max: 1 },
    atol: { type: 'number', min: Number.MIN_VALUE, max: 1 }
  }
});

function normalizeSparseMatrixInput(A, n) {
  if (Array.isArray(A)) {
    if (A.length !== n) return null;
    const dense = [];
    for (let r = 0; r < n; r++) {
      const row = A[r];
      if (!Array.isArray(row) || row.length !== n || !row.every(Number.isFinite)) return null;
      dense.push(row);
    }
    return dense;
  }
  if (A && typeof A === 'object' && !Array.isArray(A)) {
    const { rows, cols, values } = A;
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows !== n || cols !== n) return null;
    if (
      !Array.isArray(values) ||
      values.length !== n * n ||
      !values.every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      return null;
    }
    const dense = [];
    for (let r = 0; r < n; r++) dense.push(values.slice(r * n, (r + 1) * n));
    return dense;
  }
  return null;
}

function handleGenericSparseSolve(params = {}) {
  const n = params.b.length;
  const A = normalizeSparseMatrixInput(params.A, n);
  if (!A) {
    return {
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message:
          'A must be a square n×n dense array or a {rows, cols, values} row-major object matching the length of b; all entries must be finite numbers.'
      }
    };
  }
  try {
    const result = LinearSolver.solveSparse(A, params.b);
    const solution = Array.from(result.solution);
    if (!solution.every(Number.isFinite)) {
      return { success: false, error: { code: 'NUMERICAL_FAILURE' } };
    }
    return {
      success: true,
      method: result.method,
      residual: Number.isFinite(result.relativeResidual) ? result.relativeResidual : result.residualNorm,
      solution,
      converged: Boolean(result.converged),
      isPositiveDefinite: LinearSolver.isPositiveDefinite(A)
    };
  } catch {
    return { success: false, error: { code: 'NUMERICAL_FAILURE' } };
  }
}

const RADAU_IIA_RHS = Object.freeze({
  decay: (t, y) => [-y[0]],
  vanderpol: (t, y) => [y[1], (1 - y[0] * y[0]) * y[1] - y[0]]
});

function handleRadauIIASolve(params = {}) {
  const rhs = RADAU_IIA_RHS[params.system];
  if (!rhs) {
    return {
      success: false,
      error: { code: 'INVALID_INPUT', message: 'Unknown Radau IIA system; use "decay" or "vanderpol".' }
    };
  }
  if (!Number.isFinite(params.t0) || !Number.isFinite(params.tEnd) || !(params.tEnd > params.t0)) {
    return { success: false, error: { code: 'INVALID_INPUT', message: 'Radau IIA requires finite t0 < tEnd.' } };
  }
  const y0 = params.y0;
  const n = y0.length;
  if ((params.system === 'decay' && n !== 1) || (params.system === 'vanderpol' && n !== 2)) {
    return {
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: `Radau IIA system "${params.system}" requires a y0 state vector of length ${params.system === 'decay' ? 1 : 2}.`
      }
    };
  }
  const opts = {};
  if (params.rtol !== undefined) opts.rtol = params.rtol;
  if (params.atol !== undefined) opts.atol = params.atol;
  try {
    const trajectory = ODESolvers.solveRadauIIA(rhs, params.t0, y0, params.tEnd, opts);
    const out = trajectory.map((p) => ({ t: p.t, y: p.y }));
    if (!out.every((p) => Number.isFinite(p.t) && Array.isArray(p.y) && p.y.every(Number.isFinite))) {
      return { success: false, error: { code: 'NUMERICAL_FAILURE' } };
    }
    return { success: true, trajectory: out };
  } catch {
    return { success: false, error: { code: 'NUMERICAL_FAILURE' } };
  }
}

function registerSystemIpc(deps = {}) {
  const hpcEngine = deps.hpcEngine;
  const designWizards = deps.designWizards || {};
  const auditLedger = deps.auditLedger;
  const keymapManager = deps.keymapManager;
  const validationService = deps.validationService;
  const hsmProvider = deps.hsmProvider;
  const projectService = deps.projectService || activeProjectManager;
  const supervisor = deps.stenographerSupervisor || sharedStenographerSupervisor;

  if (projectService && typeof projectService.getManifest !== 'function') {
    projectService.getManifest = () => projectService.archive?.manifest || null;
  }
  if (projectService && typeof projectService.listBlobs !== 'function') {
    projectService.listBlobs = () => projectService.archive?.listBlobs?.() || [];
  }

  defineHandler(
    'omni:get-feature-maturity',
    {
      optional: true
    },
    async () => ({ success: true, domains: listFeatureMaturity() }),
    {
      domain: 'system',
      description: 'Get the registered release maturity for each engineering domain'
    }
  );

  // 1. Explicit legacy OmniAI macro route; never presented as a Stenographer daemon response.
  defineHandler(
    'omni:ai-process-prompt',
    STENOGRAPHER_QUERY_SCHEMA,
    async (event, payload = {}) => {
      return processLegacyMacroPrompt(payload);
    },
    {
      domain: 'system',
      description: 'Run the explicitly labeled experimental OmniAI keyword macro on caller-supplied inputs'
    }
  );

  // 1a. Genuine neural network surrogate training (mini-batch SGD with momentum)
  defineHandler(
    'omni:ai-train-surrogate',
    AI_TRAIN_SURROGATE_SCHEMA,
    async (event, payload = {}) => {
      try {
        validateAiTrainPayload(payload);
        const result = trainSurrogate(payload.dataset, payload.config || {});
        return {
          success: true,
          validationLevel: 'experimental',
          mode: 'neural-network-mlp',
          model: result.model.toJSON(),
          lossHistory: result.lossHistory,
          converged: result.converged,
          initialLoss: result.initialLoss,
          finalLoss: result.finalLoss,
          trainingSamples: result.trainingSamples
        };
      } catch (err) {
        return {
          success: false,
          validationLevel: 'experimental',
          error: { code: err.code || 'INVALID_INPUT', message: err.message }
        };
      }
    },
    {
      domain: 'system',
      description:
        'Train a genuine seeded MLP surrogate on caller-supplied tabular data; real backpropagation, not a keyword macro'
    }
  );

  // 1b. Deterministic inference on a trained surrogate model
  defineHandler(
    'omni:ai-predict-surrogate',
    AI_PREDICT_SURROGATE_SCHEMA,
    async (event, payload = {}) => {
      try {
        validateAiPredictPayload(payload);
        const model = NeuralNetwork.fromJSON(payload.model);
        const predictions = predictSurrogate(model, payload.x);
        return { success: true, validationLevel: 'experimental', mode: 'neural-network-mlp', predictions };
      } catch (err) {
        return {
          success: false,
          validationLevel: 'experimental',
          error: { code: 'INVALID_INPUT', message: err.message }
        };
      }
    },
    {
      domain: 'system',
      description: 'Run deterministic neural network inference given a serialized surrogate model and input vector(s)'
    }
  );

  // 1c. Numeric gradient check diagnostics for the neural network module
  defineHandler(
    'omni:ai-gradient-check',
    AI_GRADIENT_CHECK_SCHEMA,
    async (event, payload = {}) => {
      try {
        validateAiGradientPayload(payload);
        const model = NeuralNetwork.fromJSON(payload.model);
        const result = gradientCheck(model, payload.x, payload.y, payload.options || {});
        return {
          success: true,
          validationLevel: 'experimental',
          mode: 'neural-network-mlp',
          passed: result.passed,
          maxAbsDiff: result.maxAbsDiff,
          threshold: result.threshold,
          checks: result.checks
        };
      } catch (err) {
        return {
          success: false,
          validationLevel: 'experimental',
          error: { code: 'INVALID_INPUT', message: err.message }
        };
      }
    },
    {
      domain: 'system',
      description: 'Compare analytic MLP gradients against central finite differences for a serialized model'
    }
  );

  // 2. Community Samples Catalog
  defineHandler(
    'omni:get-community-samples',
    {
      optional: true
    },
    async () => {
      return COMMUNITY_SAMPLES;
    },
    {
      domain: 'system',
      description: 'Retrieve bundled synthetic example templates; independent engineering validation is unavailable'
    }
  );

  // 3. Cloud HPC Cluster Status
  defineHandler(
    'omni:get-cluster-status',
    {
      optional: true
    },
    async () => {
      if (hpcEngine) return hpcEngine.getClusterStatus();
      return { success: false, configured: false, nodes: 0, status: 'UNCONFIGURED' };
    },
    { domain: 'system', description: 'Read status from a configured compute provider' }
  );

  // 4. Set Membership Tier
  defineHandler(
    'omni:set-membership',
    {
      optional: true
    },
    async (event, active) => {
      if (hpcEngine) return hpcEngine.setMembership(active);
      return { success: false, error: { code: 'UNSUPPORTED', message: 'No compute provider is configured.' } };
    },
    { domain: 'system', description: 'Configure membership for an injected compute provider' }
  );

  // 5. Submit HPC Simulation Job
  defineHandler(
    'omni:submit-hpc-job',
    {
      type: 'object',
      optional: true
    },
    async (event, { jobType, params, ranks } = {}) => {
      if (
        typeof jobType !== 'string' ||
        !jobType.trim() ||
        !params ||
        typeof params !== 'object' ||
        Array.isArray(params) ||
        !Number.isInteger(ranks) ||
        ranks < 1
      ) {
        return {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'A job type, parameter object, and positive integer rank count are required.'
          }
        };
      }
      if (hpcEngine) return hpcEngine.submitSimulationJob(jobType, params, ranks);
      return {
        success: false,
        error: { code: 'UNSUPPORTED', message: 'No local or remote compute provider is configured.' }
      };
    },
    { domain: 'system', description: 'Submit a job to an injected compute provider' }
  );

  // 6. Comprehensive Audit Report Generator
  defineHandler(
    'omni:generate-audit-report',
    {
      type: 'object',
      optional: true
    },
    async (event, context = {}) => {
      return AuditReportGenerator.generateComprehensiveReport(context);
    },
    { domain: 'system', description: 'Generate an experimental report from supplied project evidence' }
  );

  // 7. Materials Database Query
  defineHandler(
    'omni:get-materials-list',
    {
      optional: true
    },
    async () => {
      return {
        success: false,
        available: false,
        status: 'UNAVAILABLE',
        materials: [],
        reason:
          'No material property records have completed independent source, redistribution-rights, and applicability review.'
      };
    },
    {
      domain: 'system',
      description: 'Return material-data availability; no product material catalog is currently available'
    }
  );

  // 7a. Read-only documented-typical materials catalog lookup (viewer data).
  defineHandler(
    'omni:materials-catalog-query',
    {
      type: 'object',
      optional: true,
      additionalProperties: false,
      properties: {
        search: { type: 'string', maxLength: 100 },
        temperatureK: { type: 'number', min: 1, max: 2000 }
      }
    },
    async (event, params = {}) => {
      const search = typeof params.search === 'string' ? params.search.trim().toLowerCase() : '';
      const temperatureK = Number.isFinite(params.temperatureK) ? params.temperatureK : REFERENCE_TEMPERATURE_K;
      const cards = [];
      for (const card of Object.values(MATERIAL_DATABASE)) {
        if (search && ![card.id, card.name, card.class].some((text) => String(text).toLowerCase().includes(search))) {
          continue;
        }
        const source = card.source || {};
        cards.push({
          id: card.id,
          name: card.name,
          class: card.class,
          validationStatus: card.validationStatus,
          units: card.units,
          source: {
            reference: source.reference || '',
            url: source.url || '',
            retrievedAt: source.retrievedAt || ''
          },
          rhoKgM3: card.rho,
          nu: card.nu,
          E293Pa: interpolateProperty(card, 'E', REFERENCE_TEMPERATURE_K),
          Sy293Pa: interpolateProperty(card, 'Sy', REFERENCE_TEMPERATURE_K),
          temperatureK,
          EAtTemperatureKPa: interpolateProperty(card, 'E', temperatureK)
        });
      }
      return {
        success: true,
        validationLevel: 'experimental',
        available: true,
        status: 'OK',
        count: cards.length,
        referenceTemperatureK: REFERENCE_TEMPERATURE_K,
        cards
      };
    },
    {
      domain: 'system',
      description:
        'Return read-only documented-typical material cards (E/nu/rho/Sy at 293 K and interpolated E) from the bundled provenance-reviewed catalog'
    }
  );

  // 8. Package .omni Compressed Archive
  defineHandler(
    'omni:package-omni-archive',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const archive = new OmniArchive({
        projectName: params.projectName || 'OmniEng_Project',
        engineeringDomain: params.engineeringDomain || 'universal'
      });
      if (params.sections) {
        for (const [secName, secData] of Object.entries(params.sections)) {
          archive.addSection(secName, secData);
        }
      }
      const buf = archive.saveToBuffer();
      return {
        success: true,
        sizeBytes: buf.length,
        sectionCount: archive.listSections().length,
        sections: archive.listSections(),
        filename: `${params.projectName || 'project'}.omni`
      };
    },
    {
      domain: 'system',
      description:
        'Package supplied session sections in a .omni container; completeness and round-trip validity are not established'
    }
  );

  // 9. Load .omni Compressed Archive
  defineHandler(
    'omni:load-omni-archive',
    {
      type: 'buffer',
      optional: true,
      maxBytes: 100 * 1024 * 1024
    },
    async (event, archiveBytes) => loadOmniArchiveFromBuffer(archiveBytes),
    { domain: 'system', description: 'Parse supplied bounded .omni bytes and verify archive integrity' }
  );

  // 9a. New Project
  defineHandler(
    'omni:new-project',
    {
      type: 'object',
      optional: true,
      properties: {
        projectName: { type: 'string', maxLength: 200, optional: true },
        engineeringDomain: { type: 'string', maxLength: 100, optional: true },
        author: { type: 'string', maxLength: 100, optional: true }
      }
    },
    async (event, params = {}) => {
      const summary = activeProjectManager.initializeNewProject(params || {});
      return { success: true, project: summary };
    },
    { domain: 'system', description: 'Initialize a new OmniEng engineering project session' }
  );

  // 9b. Save Project (.omni v2 atomic save with fsync and backup)
  defineHandler(
    'omni:save-project',
    {
      type: 'object',
      optional: true,
      properties: {
        filePath: { type: 'string', maxLength: 1000, optional: true },
        projectName: { type: 'string', maxLength: 200, optional: true }
      }
    },
    async (event, params = {}) => {
      let targetPath = params?.filePath;
      if (!targetPath && electronDialog && typeof electronDialog.showSaveDialog === 'function') {
        const res = await electronDialog.showSaveDialog({
          title: 'Save OmniEng Project',
          defaultPath: `${activeProjectManager.archive?.manifest?.projectName || 'Project'}.omni`,
          filters: [
            { name: 'OmniEng Project (.omni)', extensions: ['omni'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });
        if (res.canceled || !res.filePath) {
          return { success: false, cancelled: true };
        }
        targetPath = res.filePath;
      }
      if (!targetPath) {
        targetPath = activeProjectManager.currentFilePath;
      }
      if (!targetPath) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'No target file path provided or selected' }
        };
      }
      try {
        const saveRes = activeProjectManager.saveProject(targetPath);
        return { success: true, ...saveRes };
      } catch (err) {
        return { success: false, error: { code: 'IO_ERROR', message: err.message } };
      }
    },
    { domain: 'system', description: 'Save current project atomically to .omni v2 container with fsync and backup' }
  );

  // 9c. Open Project (.omni container load from file path or buffer)
  defineHandler(
    'omni:open-project',
    {
      type: 'object',
      optional: true,
      properties: {
        filePath: { type: 'string', maxLength: 1000, optional: true }
      }
    },
    async (event, params = {}) => {
      let source = params?.filePath;
      if (!source && electronDialog && typeof electronDialog.showOpenDialog === 'function') {
        const res = await electronDialog.showOpenDialog({
          title: 'Open OmniEng Project',
          filters: [
            { name: 'OmniEng Project (.omni)', extensions: ['omni'] },
            { name: 'All Files', extensions: ['*'] }
          ],
          properties: ['openFile']
        });
        if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
          return { success: false, cancelled: true };
        }
        source = res.filePaths[0];
      }
      if (!source) {
        return { success: false, error: { code: 'INVALID_INPUT', message: 'No file path provided or selected' } };
      }
      try {
        const summary = activeProjectManager.openProject(source);
        return { success: true, project: summary };
      } catch (err) {
        return { success: false, error: { code: 'INVALID_INPUT', message: err.message } };
      }
    },
    { domain: 'system', description: 'Open and deserialize an existing .omni project container' }
  );

  // 9d. Undo Command
  defineHandler(
    'omni:undo',
    {
      type: 'object',
      optional: true
    },
    async () => {
      const res = activeProjectManager.undo();
      if (!res) {
        return { success: false, canUndo: false, canRedo: activeProjectManager.archive?.journal.canRedo() || false };
      }
      return { success: true, ...res };
    },
    { domain: 'system', description: 'Undo the last executed command from the project journal' }
  );

  // 9e. Redo Command
  defineHandler(
    'omni:redo',
    {
      type: 'object',
      optional: true
    },
    async () => {
      const res = activeProjectManager.redo();
      if (!res) {
        return { success: false, canRedo: false, canUndo: activeProjectManager.archive?.journal.canUndo() || false };
      }
      return { success: true, ...res };
    },
    { domain: 'system', description: 'Redo the previously undone command from the project journal' }
  );

  // 9f. Get Project History
  defineHandler(
    'omni:get-project-history',
    {
      type: 'object',
      optional: true
    },
    async () => {
      return {
        success: true,
        history: activeProjectManager.getHistory(),
        canUndo: activeProjectManager.archive?.journal.canUndo() || false,
        canRedo: activeProjectManager.archive?.journal.canRedo() || false
      };
    },
    { domain: 'system', description: 'Retrieve non-linear revision history and branching tree' }
  );

  // 9g. Record Project Command
  defineHandler(
    'omni:record-project-command',
    {
      type: 'object',
      required: ['actionType', 'forwardPatch', 'reversePatch'],
      properties: {
        actionType: { type: 'string', maxLength: 100 },
        forwardPatch: { type: 'object' },
        reversePatch: { type: 'object' },
        description: { type: 'string', maxLength: 500, optional: true },
        author: { type: 'string', maxLength: 100, optional: true }
      }
    },
    async (event, params) => {
      try {
        const entry = activeProjectManager.recordCommand(
          params.actionType,
          params.forwardPatch,
          params.reversePatch,
          params.description,
          params.author
        );
        return { success: true, entry, summary: activeProjectManager.getSummary() };
      } catch (err) {
        return { success: false, error: { code: 'INTERNAL', message: err.message } };
      }
    },
    { domain: 'system', description: 'Record a state mutation command into the persistent project journal' }
  );

  // 9h. Get Project Summary
  defineHandler(
    'omni:get-project-summary',
    {
      type: 'object',
      optional: true
    },
    async () => {
      return { success: true, project: activeProjectManager.getSummary() };
    },
    { domain: 'system', description: 'Get manifest summary, blob counts, and revision metadata of active project' }
  );

  // 10. Run Guided Design Wizard
  defineHandler(
    'omni:run-design-wizard',
    {
      type: 'object',
      optional: true,
      required: ['wizardType'],
      properties: {
        wizardType: { type: 'string', maxLength: 100 },
        inputs: { type: 'object' }
      }
    },
    async (event, { wizardType, inputs = {} } = {}) => {
      if (wizardType === 'drone') {
        return {
          success: false,
          status: 'unavailable',
          validationLevel: 'experimental',
          error: {
            code: 'UNSUPPORTED',
            message:
              'Drone sizing is unavailable until its assumed thrust and battery models have independent references and review.'
          }
        };
      }
      const wizard = designWizards[wizardType];
      if (!wizard) {
        return { success: false, error: `Unknown wizard type: ${wizardType}` };
      }
      try {
        const result = wizard.runWizard(inputs);
        return { success: true, result };
      } catch (error) {
        if (['drop_test', 'camera_lens', 'pcb'].includes(wizardType) && error instanceof TypeError) {
          return {
            success: false,
            status: 'INVALID_INPUT',
            error: { code: 'INVALID_INPUT', message: error.message }
          };
        }
        throw error;
      }
    },
    {
      domain: 'system',
      description:
        'Run an experimental guided workflow; required engineering inputs must be supplied and drone sizing is unavailable pending independent review'
    }
  );

  // 11. Legacy structural remediation compatibility route
  defineHandler(
    'omni:self-heal-design',
    SYMBOLIC_REMEDIATION_SCHEMA,
    async () => {
      return getStructuralRemediationUnavailableResult();
    },
    {
      domain: 'system',
      description:
        'Unavailable: structural remediation has no independent validation or approval workflow; no design edits are proposed'
    }
  );

  // 12. Legacy ASME-labeled experimental stress-line screen
  defineHandler(
    'omni:evaluate-asme-viii-div2',
    ASME_STRESS_SCREEN_SCHEMA,
    async (event, params) => {
      if (typeof params.allowableStressSource !== 'string' || !params.allowableStressSource.trim()) {
        return {
          success: false,
          validationLevel: 'experimental',
          error: { code: 'INVALID_INPUT', message: 'A source label for the supplied screening limit is required.' }
        };
      }
      try {
        const analyzer = new ASMESectionVIIIDiv2Analyzer({
          allowableStressS: params.allowableStressS,
          allowableStressSource: params.allowableStressSource
        });
        const res = analyzer.linearizeStressClassificationLine(
          params.sclPoints,
          params.wallThicknessMm,
          params.isSecondaryThermal
        );
        return { success: true, validationLevel: 'experimental', ...res };
      } catch (error) {
        return {
          success: false,
          validationLevel: 'experimental',
          error: { code: error.code || 'INVALID_INPUT', message: error.message }
        };
      }
    },
    {
      domain: 'system',
      description:
        'Calculate experimental through-thickness stress integrals against a caller-supplied limit; this is not a code assessment'
    }
  );

  // 13. Security Input Validation & Sanitization
  defineHandler(
    'omni:security-validate-input',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const sanitized = IPCValidator.sanitize(params.payload || {});
      if (params.finiteFields && Array.isArray(params.finiteFields)) {
        IPCValidator.validateFiniteNumbers(sanitized, params.finiteFields);
      }
      return { success: true, sanitized };
    },
    { domain: 'system', description: 'Strip prototype pollution vectors and enforce finite numerical bounds' }
  );

  // 14. Password-encrypted session snapshot export (AES-256-GCM)
  defineHandler(
    'omni:vault-encrypt-project',
    {
      type: 'object',
      optional: true,
      additionalProperties: false,
      properties: {
        password: { type: 'string', maxLength: 1024 },
        payload: { type: 'object' }
      }
    },
    async (event, params = {}) => {
      const { password, payload } = params;
      if (typeof password !== 'string' || password.length < 12 || payload === undefined) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'A payload and password of at least 12 characters are required.' }
        };
      }
      const buf = Buffer.from(JSON.stringify(payload), 'utf8');
      if (buf.length + 52 > MAX_ENCRYPTED_SESSION_BYTES) {
        return {
          success: false,
          error: { code: 'RESOURCE_EXHAUSTED', message: 'Encrypted session snapshots are limited to 16 MiB.' }
        };
      }
      const encrypted = OmniVaultAES256.encrypt(buf, password);
      return {
        success: true,
        encryptedBytes: encrypted.length,
        encryptedBase64: encrypted.toString('base64'),
        isEncrypted: true
      };
    },
    { domain: 'system', description: 'Encrypt project data using AES-256-GCM authenticated encryption' }
  );

  // 15. Password-encrypted session snapshot import (AES-256-GCM)
  defineHandler(
    'omni:vault-decrypt-project',
    {
      type: 'object',
      optional: true,
      additionalProperties: false,
      properties: {
        password: { type: 'string', maxLength: 1024 },
        encryptedBytes: { type: 'buffer', maxBytes: MAX_ENCRYPTED_SESSION_BYTES },
        encryptedBase64: { type: 'string', maxLength: MAX_ENCRYPTED_SESSION_BASE64_LENGTH }
      }
    },
    async (event, params = {}) => {
      const { password, encryptedBytes, encryptedBase64 } = params;
      if (typeof password !== 'string' || password.length === 0) {
        return { success: false, error: { code: 'INVALID_INPUT', message: 'A password is required.' } };
      }
      const hasBase64Payload = encryptedBase64 !== undefined;
      const hasBinaryPayload = encryptedBytes !== undefined;
      if (hasBase64Payload === hasBinaryPayload) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Provide exactly one encrypted payload.' }
        };
      }
      let buf;
      if (hasBase64Payload) {
        if (encryptedBase64.length === 0) {
          return {
            success: false,
            error: { code: 'INVALID_INPUT', message: 'The encrypted payload cannot be empty.' }
          };
        }
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encryptedBase64)) {
          return {
            success: false,
            error: { code: 'INVALID_INPUT', message: 'The encrypted payload is not valid base64.' }
          };
        }
        buf = Buffer.from(encryptedBase64, 'base64');
        if (buf.toString('base64') !== encryptedBase64) {
          return {
            success: false,
            error: { code: 'INVALID_INPUT', message: 'The encrypted payload is not canonical base64.' }
          };
        }
      } else if (encryptedBytes !== undefined) {
        buf = Buffer.from(encryptedBytes);
      } else {
        return { success: false, error: { code: 'INVALID_INPUT', message: 'An encrypted payload is required.' } };
      }
      if (buf.length > MAX_ENCRYPTED_SESSION_BYTES) {
        return {
          success: false,
          error: { code: 'RESOURCE_EXHAUSTED', message: 'Encrypted session snapshots are limited to 16 MiB.' }
        };
      }
      const decrypted = OmniVaultAES256.decrypt(buf, password);
      const parsed = JSON.parse(decrypted.toString('utf8'));
      return { success: true, payload: parsed };
    },
    { domain: 'system', description: 'Decrypt and authenticate ciphertext using AES-256-GCM' }
  );

  // 16. Immutable Audit Ledger Record Action
  defineHandler(
    'omni:audit-record-action',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      if (!auditLedger) {
        return {
          success: false,
          recorded: false,
          error: {
            code: 'UNSUPPORTED',
            message: 'No immutable audit ledger is configured; the action was not recorded.'
          }
        };
      }
      const { author = 'USER', actionType = 'PARAMETRIC_EDIT', details = {} } = params;
      const entry = auditLedger.recordAction(author, actionType, details);
      const integrity = auditLedger.verifyChainIntegrity();
      return { success: true, entry, chainIntegrity: integrity };
    },
    { domain: 'system', description: 'Append an entry to the configured local audit ledger' }
  );

  // 17. CAD keymap profiles
  defineHandler(
    'omni:get-keymap-profiles',
    {
      optional: true
    },
    async (event, params = {}) => {
      if (!keymapManager) {
        return { success: true, profiles: [], activeProfile: 'OMNIENG_DEFAULT' };
      }
      return { success: true, profiles: keymapManager.getProfilesList(), activeProfile: keymapManager.currentProfile };
    },
    { domain: 'system', description: 'Query workstation shortcut layouts (CATIA, NX, SolidWorks, Blender)' }
  );

  // 18. Hardware Acceleration Diagnostics
  defineHandler(
    'omni:get-accelerator-info',
    {
      optional: true
    },
    async () => {
      return { success: true, ...accelerator.getBackendInfo() };
    },
    {
      domain: 'system',
      description: 'Query experimental accelerator backend metadata; no performance multiplier is validated'
    }
  );

  // 19. System & OS Diagnostics
  defineHandler(
    'omni:get-system-info',
    {
      optional: true
    },
    async () => {
      return {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        memoryGB: Math.round(os.totalmem() / 1024 ** 3),
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        tier: 'Local Workstation'
      };
    },
    { domain: 'system', description: 'Query host platform architecture, CPU core topology, and memory' }
  );

  // 20. Queue an experimental process-local compute task
  defineHandler(
    'omni:submit-compute-job',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const { taskType, payload, options = {} } = params;
      if (
        typeof taskType !== 'string' ||
        !taskType.trim() ||
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload)
      ) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'A task type and task payload object are required.' }
        };
      }
      try {
        const host = getComputeHost();
        const result = await host.submitJob(taskType, payload, options);
        return { success: true, result };
      } catch (err) {
        return {
          success: false,
          error: { code: err.code || 'INTERNAL', message: err.message || 'Compute job submission failed.' }
        };
      }
    },
    {
      domain: 'system',
      description: 'Queue an experimental calculation on the main JavaScript event loop; work is not isolated'
    }
  );

  // 21. Cancel a queued process-local compute task
  defineHandler(
    'omni:cancel-compute-job',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const { jobId } = params;
      const host = getComputeHost();
      const cancelled = host.cancelJob(jobId);
      if (cancelled) {
        return { success: true, cancelled: true };
      }
      const active = host.activeJobs?.get(jobId);
      if (active && active.status === 'RUNNING') {
        return {
          success: true,
          cancelled: false,
          message: `Job ${jobId} is running and cannot be interrupted by the process-local queue.`
        };
      }
      return {
        success: true,
        cancelled: false,
        message: `No queued compute job was found with id ${jobId}.`
      };
    },
    { domain: 'system', description: 'Cancel a queued calculation; running synchronous work cannot be interrupted' }
  );

  // 22. Get Compute Host Telemetry
  defineHandler(
    'omni:get-compute-telemetry',
    {
      optional: true
    },
    async () => {
      const host = getComputeHost();
      return { success: true, telemetry: host.getTelemetry() };
    },
    { domain: 'system', description: 'Query process-local queue counts and memory; this is not worker-pool telemetry' }
  );

  // 23. Run experimental V&V diagnostics when a released service is configured
  defineHandler(
    'omni:run-vv-benchmarks',
    {
      optional: true
    },
    async () => {
      if (!validationService || typeof validationService.runBenchmarks !== 'function') {
        return {
          success: false,
          error: { code: 'UNSUPPORTED', message: 'No released validation benchmark service is configured.' },
          validationLevel: 'experimental'
        };
      }
      return validationService.runBenchmarks({ suite: 'core' });
    },
    {
      domain: 'system',
      description:
        'Run core benchmarks only when a released validation service is configured; otherwise returns UNSUPPORTED'
    }
  );

  // 24. Software key signing provider endpoint (ECDSA P-256); not PKCS#11 hardware
  defineHandler(
    'omni:pkcs11-sign-payload',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      if (!hsmProvider || typeof hsmProvider.sign !== 'function') {
        return {
          success: false,
          error: { code: 'UNSUPPORTED', message: 'No software signing provider is configured.' },
          validationLevel: 'experimental'
        };
      }
      if (typeof params.payload !== 'string' || params.payload.length === 0) {
        return { success: false, error: { code: 'INVALID_INPUT', message: 'A payload is required.' } };
      }
      return hsmProvider.sign(params);
    },
    {
      domain: 'system',
      description: 'Sign an engineering record with the in-process software key (ECDSA P-256; not PKCS#11 hardware)'
    }
  );

  // 25. Software key signature verification (ECDSA P-256); not PKCS#11 hardware
  defineHandler(
    'omni:pkcs11-verify-signature',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      if (!hsmProvider || typeof hsmProvider.verify !== 'function') {
        return {
          success: false,
          error: { code: 'UNSUPPORTED', message: 'No software signing provider is configured.' },
          validationLevel: 'experimental'
        };
      }
      if (typeof params.payload !== 'string' || typeof params.signatureHex !== 'string') {
        return { success: false, error: { code: 'INVALID_INPUT', message: 'Payload and signature are required.' } };
      }
      return hsmProvider.verify(params);
    },
    {
      domain: 'system',
      description: 'Verify a signature against the in-process software key (ECDSA P-256; not PKCS#11 hardware)'
    }
  );

  // 26. Disabled caller-supplied identity policy example
  defineHandler(
    'omni:iam-evaluate-access',
    {
      type: 'object',
      optional: true
    },
    async () => ({
      success: false,
      validationLevel: 'experimental',
      error: { code: 'UNSUPPORTED', message: 'No authenticated identity and authorization provider is configured.' }
    }),
    {
      domain: 'system',
      description: 'Authorization decisions require an authenticated provider and are currently unavailable'
    }
  );

  // 27. Regulatory CycloneDX & SPDX SBOM Generation
  defineHandler(
    'omni:generate-sbom',
    {
      type: 'object',
      optional: true,
      additionalProperties: false,
      properties: {
        writeFiles: { type: 'boolean' }
      }
    },
    async (event, params = {}) => {
      try {
        const report = await generateSbomReport({ writeFiles: params.writeFiles === true });
        return { success: true, validationLevel: 'experimental', ...report };
      } catch (error) {
        return {
          success: false,
          error: { code: 'SBOM_GENERATION_FAILED', message: error.message }
        };
      }
    },
    {
      domain: 'system',
      description:
        'Regenerate CycloneDX and SPDX SBOMs from package-lock.json and return the manifest digest and component/package counts'
    }
  );

  // 28. Parallel Mesh Domain Decomposition
  defineHandler(
    'omni:mesh-domain-decomposition',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const points = Array.isArray(params.points) ? params.points : null;
      const nodes = !points && Array.isArray(params.nodes) ? params.nodes : null;
      if (
        (!points && (!nodes || nodes.length === 0)) ||
        !Number.isInteger(params.numPartitions) ||
        params.numPartitions < 1
      ) {
        return {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Mesh nodes or points and a positive partition count are required.'
          }
        };
      }
      try {
        const jobResult = await defaultEngineRegistry.dispatch(
          new JobRequest({
            domain: 'hpc',
            operation: 'partition_rcb',
            parameters: { points: points || nodes, numPartitions: params.numPartitions }
          })
        );
        return { success: true, ...(jobResult.outputData || {}) };
      } catch (error) {
        return {
          success: false,
          error: { code: error.code || 'INTERNAL', message: error.message }
        };
      }
    },
    { domain: 'system', description: 'Partition 3D mesh into balanced subdomains via Recursive Coordinate Bisection' }
  );

  // 29. Run the extended diagnostic suite when a released service is configured
  defineHandler(
    'omni:run-100-gold-benchmarks',
    {
      optional: true
    },
    async () => {
      if (!validationService || typeof validationService.runBenchmarks !== 'function') {
        return {
          success: false,
          error: { code: 'UNSUPPORTED', message: 'No released validation benchmark service is configured.' },
          validationLevel: 'experimental'
        };
      }
      return validationService.runBenchmarks({ suite: 'extended' });
    },
    {
      domain: 'system',
      description:
        'Run extended benchmarks only when a released validation service is configured; otherwise returns UNSUPPORTED'
    }
  );

  // 30. Stenographer Query
  defineHandler(
    'omni:stenographer-query',
    STENOGRAPHER_QUERY_SCHEMA,
    async (event, payload = {}) => {
      return processStenographerQuery(supervisor, projectService, payload);
    },
    { domain: 'system', description: 'Submit natural-language engineering query to StenographerSupervisor' }
  );

  // 31. Stenographer Get Tools
  defineHandler(
    'omni:stenographer-get-tools',
    {
      optional: true
    },
    async () => {
      const tools = supervisor.getRegisteredTools();
      return { success: true, tools, count: tools.length };
    },
    { domain: 'system', description: 'Retrieve all registered Stenographer tool definitions' }
  );

  // 32. Stenographer Get Proposals
  defineHandler(
    'omni:stenographer-get-proposals',
    {
      optional: true
    },
    async () => {
      const proposals = Array.from(supervisor.proposals.values()).map((p) =>
        typeof p.toJSON === 'function' ? p.toJSON() : p
      );
      return { success: true, proposals, count: proposals.length };
    },
    { domain: 'system', description: 'Retrieve all Stenographer tool proposals and their approval statuses' }
  );

  // 33. Stenographer Evaluate Proposal
  defineHandler(
    'omni:stenographer-evaluate-proposal',
    {
      type: 'object',
      optional: true
    },
    async (event, payload = {}) => {
      try {
        const proposalId = payload?.proposalId || payload?.id;
        const proposal = supervisor.getProposal(proposalId);
        if (!proposalMatchesActiveProject(proposal, projectService)) {
          return {
            success: false,
            error: {
              code: 'INVALID_INPUT',
              message: 'Proposal is missing or its project identity or revision is stale.'
            }
          };
        }
        const record = supervisor.evaluateProposal({
          ...payload,
          decidedBy: `local-os-user-unverified:${os.userInfo().username}`
        });
        return {
          success: true,
          approval: record.toJSON(),
          proposal: proposal ? proposal.toJSON() : null
        };
      } catch (err) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: err.message }
        };
      }
    },
    { domain: 'system', description: 'Approve or reject a pending Stenographer ToolProposal' }
  );

  // 34. Stenographer Execute Approved Tool
  defineHandler(
    'omni:stenographer-execute-tool',
    {
      type: 'object',
      optional: true
    },
    async (event, payload = {}) => {
      try {
        const proposalId = typeof payload === 'string' ? payload : payload?.proposalId || payload?.id;
        const proposal = supervisor.getProposal(proposalId);
        if (!proposalMatchesActiveProject(proposal, projectService)) {
          return {
            success: false,
            error: {
              code: 'INVALID_INPUT',
              message: 'Proposal is missing or its project identity or revision is stale.'
            }
          };
        }
        const execution = await supervisor.executeApprovedTool(proposalId);
        return {
          success: true,
          ...execution
        };
      } catch (err) {
        return {
          success: false,
          error: { code: 'EXECUTION_ERROR', message: err.message }
        };
      }
    },
    { domain: 'system', description: 'Execute a previously approved Stenographer ToolProposal' }
  );

  // 35. Stenographer Verify Ledger
  defineHandler(
    'omni:stenographer-verify-ledger',
    {
      optional: true
    },
    async () => {
      const integrity = supervisor.verifyLedgerIntegrity();
      const daemonStatus = await supervisor.getStatus();
      return {
        success: integrity.valid,
        ...integrity,
        daemonConnected: daemonStatus.alive,
        ledgerKeyPersistence: daemonStatus.ledgerKeyPersistence,
        entries: supervisor.getAuditLedger()
      };
    },
    { domain: 'system', description: 'Verify keyed HMAC-SHA256 hash chain integrity of the Stenographer audit ledger' }
  );

  // 36. Add Content-Addressed Storage (CAS) Blob to Active Project
  defineHandler(
    'omni:add-blob',
    {
      type: 'object',
      optional: true
    },
    async (event, payload = {}) => {
      try {
        if (!projectService) {
          return { success: false, error: { code: 'UNAVAILABLE', message: 'Project service is unavailable' } };
        }
        const rawData =
          typeof payload === 'string' || Buffer.isBuffer(payload) || payload instanceof Uint8Array
            ? payload
            : (payload.content ?? payload.data ?? '');
        const mimeType =
          typeof payload === 'object' && payload !== null && payload.mimeType
            ? payload.mimeType
            : 'application/octet-stream';
        const dataBuffer =
          typeof rawData === 'string' && payload?.encoding === 'base64'
            ? Buffer.from(rawData, 'base64')
            : Buffer.isBuffer(rawData)
              ? rawData
              : typeof rawData === 'string'
                ? Buffer.from(rawData, 'utf8')
                : Buffer.from(rawData || []);
        const hash = projectService.addBlob(dataBuffer, mimeType);
        return {
          success: true,
          hash,
          mimeType,
          byteLength: dataBuffer.length
        };
      } catch (err) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: err.message }
        };
      }
    },
    { domain: 'system', description: 'Store binary/text artifact in project SHA-256 content-addressed storage' }
  );

  // 37. Get Content-Addressed Storage (CAS) Blob from Active Project
  defineHandler(
    'omni:get-blob',
    {
      type: 'object',
      optional: true
    },
    async (event, payload = {}) => {
      try {
        const hash = typeof payload === 'string' ? payload : payload?.hash || '';
        if (!hash || typeof hash !== 'string') {
          return { success: false, error: { code: 'INVALID_INPUT', message: 'A valid SHA-256 blob hash is required' } };
        }
        const buf = projectService.getBlob(hash);
        if (!buf) {
          return { success: false, error: { code: 'NOT_FOUND', message: `Blob not found for hash ${hash}` } };
        }
        const entry = projectService.archive?.blobs?.get(hash);
        return {
          success: true,
          hash,
          mimeType: entry?.mimeType || 'application/octet-stream',
          byteLength: buf.length,
          content: buf.toString('utf8'),
          base64: buf.toString('base64')
        };
      } catch (err) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: err.message }
        };
      }
    },
    { domain: 'system', description: 'Retrieve artifact from project SHA-256 content-addressed storage by hash' }
  );

  // 38. List Content-Addressed Storage (CAS) Blobs in Active Project
  defineHandler(
    'omni:list-blobs',
    {
      optional: true
    },
    async () => {
      const blobs =
        typeof projectService.listBlobs === 'function'
          ? projectService.listBlobs()
          : projectService.archive?.listBlobs?.() || [];
      return {
        success: true,
        blobs,
        count: blobs.length
      };
    },
    { domain: 'system', description: 'List all SHA-256 content-addressed blobs in the active project container' }
  );

  // 39. Generic sparse linear system solve with SPD diagnostic
  defineHandler(
    'omni:solve-generic-sparse',
    SPARSE_SOLVE_SCHEMA,
    async (event, params = {}) => handleGenericSparseSolve(params),
    {
      domain: 'system',
      description:
        'Solve A·x = b for a caller-supplied square matrix (dense array or {rows, cols, values}) with an SPD diagnostic; not signoff-validated'
    }
  );

  // 40. Radau IIA (order-5) stiff integrator on canonical standard systems
  defineHandler('omni:solve-radau-iia', RADAU_IIA_SCHEMA, async (event, params = {}) => handleRadauIIASolve(params), {
    domain: 'system',
    description:
      'Run the genuine 3-stage Radau IIA integrator on the canonical decay or van der Pol system; arbitrary user functions cannot cross IPC'
  });

  // 41. Local PersistentWorkerPool task dispatch via the HPC engine adapter
  defineHandler(
    'omni:hpc-execute-local-parallel',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new Error('hpc-execute-local-parallel requires an object payload.');
      }
      try {
        const jobResult = await defaultEngineRegistry.dispatch(
          new JobRequest({ domain: 'hpc', operation: 'execute_local_parallel', parameters: params })
        );
        return {
          success: true,
          jobId: jobResult.jobId,
          status: jobResult.status,
          outputData: jobResult.outputData,
          ...(jobResult.outputData || {})
        };
      } catch (error) {
        return {
          success: false,
          error: { code: error.code || 'INTERNAL', message: error.message }
        };
      }
    },
    {
      domain: 'system',
      description: 'Dispatch a caller-supplied task to the local PersistentWorkerPool via the HPC engine adapter'
    }
  );

  // 41b. Local multi-process sparse solve dispatch (hpc:local-dispatch engine route).
  defineHandler(
    'omni:hpc-local-dispatch',
    {
      type: 'object',
      required: ['n'],
      additionalProperties: false,
      properties: {
        n: { type: 'number', integer: true, min: 8, max: 512 },
        timeoutMs: { type: 'number', integer: true, min: 500, max: 120000 }
      }
    },
    async (event, params = {}) => {
      const descriptor = { taskType: 'poisson_sparse_cholesky', n: params.n };
      const dispatchParameters = { descriptor };
      if (Number.isInteger(params.timeoutMs)) dispatchParameters.timeoutMs = params.timeoutMs;
      try {
        const jobResult = await defaultEngineRegistry.dispatch(
          new JobRequest({
            domain: 'hpc',
            operation: 'hpc:local-dispatch',
            parameters: dispatchParameters
          })
        );
        const outputData = jobResult.outputData || {};
        return {
          success: jobResult.status !== 'FAILED' && outputData.status !== 'FAILED',
          validationLevel: 'experimental',
          jobId: jobResult.jobId,
          status: outputData.status || jobResult.status,
          provider: outputData.provider || 'local',
          scheduler: outputData.scheduler || 'LOCAL_MULTIPROCESS',
          taskType: descriptor.taskType,
          transitions: outputData.transitions || [],
          result: outputData.result || null,
          error: outputData.error || null,
          executionDurationMs:
            typeof outputData.executionDurationMs === 'number' ? outputData.executionDurationMs : null
        };
      } catch (error) {
        return {
          success: false,
          validationLevel: 'experimental',
          error: { code: error.code || 'INTERNAL', message: error.message }
        };
      }
    },
    {
      domain: 'system',
      description:
        'Dispatch a sparse Poisson solve to the local multi-process scheduler via hpc:local-dispatch and report the verified transitions, residual, and checksum'
    }
  );

  // 42. Caller-assumption storage-use estimate via the HPC engine adapter
  defineHandler(
    'omni:hpc-plan-out-of-core',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new Error('hpc-plan-out-of-core requires an object payload.');
      }
      if (
        !Number.isSafeInteger(params.dofCount) ||
        params.dofCount <= 0 ||
        !Number.isFinite(params.availableRamBytes) ||
        params.availableRamBytes <= 0 ||
        !Number.isFinite(params.assumptions?.matrixNonzerosPerDof) ||
        params.assumptions.matrixNonzerosPerDof <= 0 ||
        !Number.isFinite(params.assumptions?.factorEntriesPerDof) ||
        params.assumptions.factorEntriesPerDof <= 0
      ) {
        return {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message:
              'hpc-plan-out-of-core requires dofCount, availableRamBytes, and caller-supplied matrix/factor entries per DOF.'
          }
        };
      }
      try {
        const jobResult = await defaultEngineRegistry.dispatch(
          new JobRequest({ domain: 'hpc', operation: 'plan_out_of_core', parameters: params })
        );
        return {
          success: true,
          jobId: jobResult.jobId,
          status: jobResult.status,
          outputData: jobResult.outputData,
          ...(jobResult.outputData || {})
        };
      } catch (error) {
        return {
          success: false,
          error: { code: error.code || 'INTERNAL', message: error.message }
        };
      }
    },
    {
      domain: 'system',
      description: 'Estimate storage use from caller-supplied out-of-core assumptions via the HPC engine adapter'
    }
  );

  // 43. Sparse ordering helpers (nested-dissection / minimum-degree leaf ordering)
  defineHandler(
    'omni:solve-sparse-ordering',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const N = Number.isInteger(params.N) && params.N >= 2 && params.N <= 2000 ? params.N : 40;
      const solver = new WasmSparseMultifrontalSolver(N, N);
      for (let i = 0; i < N; i++) {
        solver.addEntry(i, i, 2.0);
        if (i > 0) solver.addEntry(i, i - 1, -1.0);
        if (i < N - 1) solver.addEntry(i, i + 1, -1.0);
      }
      const factorization = solver.factorize();
      return {
        success: true,
        validationLevel: 'experimental',
        N,
        orderingMethod: factorization.orderingMethod,
        solverMethod: factorization.solverMethod,
        nnzL: factorization.nnzL,
        fillInRatio: factorization.fillInRatio,
        factorizationTimeMs: factorization.factorizationMs
      };
    },
    {
      domain: 'system',
      description: 'Factor a caller-sized SPD matrix and report the nested-dissection/minimum-degree leaf ordering used'
    }
  );

  // 44. Preconditioned conjugate gradient & dense Gaussian elimination helpers
  defineHandler(
    'omni:solve-pcg-dense',
    {
      type: 'object',
      required: ['method', 'A', 'b'],
      additionalProperties: false,
      properties: {
        method: { type: 'string', enum: ['pcg', 'gaussian'] },
        A: { type: 'array', minItems: 1, maxItems: 512, items: { type: 'array', items: { type: 'number' } } },
        b: { type: 'array', minItems: 1, maxItems: 512, items: { type: 'number' } }
      }
    },
    async (event, params) => {
      const n = params.b.length;
      if (params.A.length !== n || params.A.some((row) => !Array.isArray(row) || row.length !== n)) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'A must be a square n×n dense array matching the length of b.' }
        };
      }
      const A = params.A.map((row) => row.map(Number));
      const b = params.b.map(Number);
      if (!A.every((row) => row.every(Number.isFinite)) || !b.every(Number.isFinite)) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'A and b must contain only finite numbers.' }
        };
      }
      try {
        const result =
          params.method === 'gaussian' ? LinearSolver.solveGaussian(A, b) : LinearSolver.solveConjugateGradient(A, b);
        const solution = Array.from(result.solution || result.x || []);
        if (!solution.every(Number.isFinite)) {
          return { success: false, error: { code: 'NUMERICAL_FAILURE' } };
        }
        return {
          success: true,
          validationLevel: 'experimental',
          method: params.method,
          solution,
          residual: Number.isFinite(result.relativeResidual) ? result.relativeResidual : undefined,
          converged: result.converged !== false
        };
      } catch {
        return { success: false, error: { code: 'NUMERICAL_FAILURE' } };
      }
    },
    {
      domain: 'system',
      description:
        'Solve a caller-supplied dense linear system with PCG or Gaussian elimination; experimental, not signoff'
    }
  );

  // 45. Engineering lifecycle-rule validation via the PDM engine adapter
  defineHandler(
    'omni:validate-lifecycle',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new Error('validate-lifecycle requires an object payload.');
      }
      if (!params.rootAssembly && !params.rootItem && !params.bom && !params.item) {
        return {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'validate-lifecycle requires an assembly or item to validate.'
          }
        };
      }
      try {
        const jobResult = await defaultEngineRegistry.dispatch(
          new JobRequest({ domain: 'pdm', operation: 'validate_lifecycle', parameters: params })
        );
        return {
          success: true,
          jobId: jobResult.jobId,
          status: jobResult.status,
          outputData: jobResult.outputData,
          ...(jobResult.outputData || {})
        };
      } catch (error) {
        return {
          success: false,
          error: { code: error.code || 'INTERNAL', message: error.message }
        };
      }
    },
    {
      domain: 'system',
      description:
        'Validate caller-supplied engineering lifecycle rules via the PDM engine adapter; not a persisted revision state machine'
    }
  );

  // 46. SHA-256 hashing of a supplied artifact
  defineHandler(
    'omni:hash-artifact-sha256',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const content = typeof params === 'string' ? params : params?.content;
      const buffer =
        typeof content === 'string'
          ? Buffer.from(content, 'utf8')
          : Buffer.isBuffer(content) || content instanceof Uint8Array
            ? Buffer.from(content)
            : null;
      if (!buffer || buffer.length === 0) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'A non-empty artifact string or buffer is required.' }
        };
      }
      return {
        success: true,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        byteLength: buffer.length
      };
    },
    {
      domain: 'system',
      description: 'Compute the SHA-256 digest of a supplied artifact; content-addressed storage is not implied'
    }
  );

  // 47. Diagnostic domain-maturity report generation
  defineHandler(
    'omni:generate-maturity-report',
    {
      type: 'object',
      optional: true
    },
    async () => {
      const { AuditReportGenerator } = require('../../core/reporting/audit_report');
      const report = AuditReportGenerator.generateComprehensiveReport({
        inputs: [],
        results: [],
        metadata: { generatedBy: 'omni:generate-maturity-report' }
      });
      return { success: true, validationLevel: 'experimental', report };
    },
    {
      domain: 'system',
      description: 'Generate an experimental diagnostic maturity report from registered domain maturity records'
    }
  );
}

module.exports = {
  registerSystemIpc,
  processStenographerQuery,
  proposalMatchesActiveProject,
  processLegacyMacroPrompt,
  STENOGRAPHER_QUERY_SCHEMA,
  loadOmniArchiveFromBuffer,
  getStructuralRemediationUnavailableResult,
  ASME_STRESS_SCREEN_SCHEMA,
  activeProjectManager,
  sharedStenographerSupervisor,
  SPARSE_SOLVE_SCHEMA,
  RADAU_IIA_SCHEMA,
  normalizeSparseMatrixInput,
  handleGenericSparseSolve,
  handleRadauIIASolve
};
