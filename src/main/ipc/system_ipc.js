/**
 * OmniEng System, Security, Compliance & Platform Domain IPC Router
 * Covers OmniAI, HPC, Audit Report, Materials, .omni Archive, AES-256 Vault, ASME VIII, Keymaps, Hardware
 */

'use strict';

const os = require('os');
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

function registerSystemIpc(deps = {}) {
  const hpcEngine = deps.hpcEngine;
  const designWizards = deps.designWizards || {};
  const auditLedger = deps.auditLedger;
  const keymapManager = deps.keymapManager;
  const validationService = deps.validationService;
  const hsmProvider = deps.hsmProvider;

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

  // 1. OmniAI Assistant Processing
  defineHandler(
    'omni:ai-process-prompt',
    {
      type: 'object',
      optional: true
    },
    async () => ({
      success: false,
      validationLevel: 'experimental',
      error: { code: 'UNSUPPORTED', message: 'The legacy keyword router is not exposed for engineering conclusions.' }
    }),
    { domain: 'system', description: 'The legacy keyword router is not an engineering analysis service' }
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
        return { success: false, error: { code: 'INVALID_INPUT', message: 'No target file path provided or selected' } };
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
        return { success: true, recorded: false };
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

  // 20. Submit High-Performance Compute Host Job
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
      const host = getComputeHost();
      const result = await host.submitJob(taskType, payload, options);
      return { success: true, result };
    },
    {
      domain: 'system',
      description: 'Queue an experimental calculation on the main JavaScript event loop; work is not isolated'
    }
  );

  // 21. Cancel High-Performance Compute Host Job
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
      return { success: true, cancelled };
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

  // 24. Hardware signing provider endpoint; no FIPS status is claimed
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
          error: { code: 'UNSUPPORTED', message: 'No hardware signing provider is configured.' },
          validationLevel: 'experimental'
        };
      }
      if (typeof params.payload !== 'string' || params.payload.length === 0) {
        return { success: false, error: { code: 'INVALID_INPUT', message: 'A payload is required.' } };
      }
      return hsmProvider.sign(params);
    },
    { domain: 'system', description: 'Sign an engineering record with a configured hardware provider' }
  );

  // 25. PKCS#11 Signature Verification
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
          error: { code: 'UNSUPPORTED', message: 'No hardware signing provider is configured.' },
          validationLevel: 'experimental'
        };
      }
      if (typeof params.payload !== 'string' || typeof params.signatureHex !== 'string') {
        return { success: false, error: { code: 'INVALID_INPUT', message: 'Payload and signature are required.' } };
      }
      return hsmProvider.verify(params);
    },
    { domain: 'system', description: 'Verify a signature with a configured hardware provider' }
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
      optional: true
    },
    async () => ({
      success: false,
      error: {
        code: 'UNSUPPORTED',
        message: 'Runtime SBOM generation is unavailable. Use the reviewed build artifact in docs/sbom/.'
      }
    }),
    { domain: 'system', description: 'Runtime SBOM generation is unavailable' }
  );

  // 28. Parallel Mesh Domain Decomposition
  defineHandler(
    'omni:mesh-domain-decomposition',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const { DomainDecompositionEngine } = require('../../core/math/domain_decomposition');
      if (
        !Array.isArray(params.nodes) ||
        params.nodes.length === 0 ||
        !Array.isArray(params.elements) ||
        params.elements.length === 0 ||
        !Number.isInteger(params.numPartitions) ||
        params.numPartitions < 1
      ) {
        return {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Mesh nodes, elements, and a positive partition count are required.'
          }
        };
      }
      const { nodes, elements, numPartitions } = params;
      const partition = DomainDecompositionEngine.partitionMesh(nodes, elements, numPartitions);
      return { success: true, ...partition };
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
}

module.exports = {
  registerSystemIpc,
  loadOmniArchiveFromBuffer,
  getStructuralRemediationUnavailableResult,
  ASME_STRESS_SCREEN_SCHEMA,
  activeProjectManager
};
