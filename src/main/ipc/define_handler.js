/**
 * OmniEng IPC Handler Registration and Request Validation Helpers
 *
 * Provides centralized IPC endpoint registration and request checks where schemas are defined:
 * Applies route-defined schema checks, payload sanitation/size limits, and trusted-renderer
 * main-frame authorization. This does not establish full contract coverage.
 */

'use strict';

const path = require('path');
const { fileURLToPath } = require('url');

let electronModule = null;
try {
  const candidate = require('electron');
  if (candidate && typeof candidate === 'object') {
    electronModule = candidate;
  }
} catch {
  electronModule = null;
}

const defaultIpcMain = electronModule ? electronModule.ipcMain : null;
let activeIpcMain = defaultIpcMain;

/**
 * Runs synchronous IPC registration with an injected Electron-compatible ipcMain.
 * The registration hub uses this for dependency injection; handlers retain the
 * target that was active when they were registered.
 * @param {Object} ipcMain Electron-compatible IPC registrar
 * @param {Function} register Registration callback
 * @returns {*} Callback result
 */
function withIpcMain(ipcMain, register) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof register !== 'function') {
    throw new TypeError('withIpcMain requires an ipcMain registrar and registration callback.');
  }

  const previousIpcMain = activeIpcMain;
  activeIpcMain = ipcMain;
  try {
    return register();
  } finally {
    activeIpcMain = previousIpcMain;
  }
}

function getElectronApp() {
  if (electronModule && electronModule.app) return electronModule.app;
  try {
    const candidate = require('electron');
    return candidate && typeof candidate === 'object' ? candidate.app : null;
  } catch {
    return null;
  }
}

const { IPCValidator } = require('../../core/security/ipc_validator');
const { getFeatureMaturity } = require('../../core/maturity/feature_maturity');

// Registry of registered channels across all domains
const channelRegistry = new Map();

/**
 * Validates a value against a lightweight, zero-dependency schema descriptor
 * @param {*} val
 * @param {Object} schema
 * @param {string} path
 */
function validateSchema(val, schema, path = 'payload') {
  if (!schema) return true;

  // Optional handling
  if (val === undefined || val === null) {
    if (schema.optional) return true;
    if (schema.required === false) return true;
    throw new Error(`IPC Schema Validation Error: Missing required field at '${path}'`);
  }

  // Type validation
  if (schema.type) {
    if (schema.type === 'array') {
      if (!Array.isArray(val)) {
        throw new Error(`IPC Schema Validation Error: Expected array at '${path}', got ${typeof val}`);
      }
      if (schema.minItems !== undefined && val.length < schema.minItems) {
        throw new Error(
          `IPC Schema Validation Error: Array at '${path}' has length ${val.length} < minItems ${schema.minItems}`
        );
      }
      if (schema.maxItems !== undefined && val.length > schema.maxItems) {
        throw new Error(
          `IPC Schema Validation Error: Array at '${path}' has length ${val.length} > maxItems ${schema.maxItems}`
        );
      }
      if (schema.items) {
        val.forEach((item, idx) => validateSchema(item, schema.items, `${path}[${idx}]`));
      }
    } else if (schema.type === 'buffer') {
      if (!Buffer.isBuffer(val) && !(val instanceof Uint8Array)) {
        throw new Error(`IPC Schema Validation Error: Expected Buffer/Uint8Array at '${path}'`);
      }
      IPCValidator.validateBuffer(val, schema.maxBytes || 100 * 1024 * 1024);
    } else if (schema.type === 'number') {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new Error(`IPC Schema Validation Error: Field at '${path}' must be a finite number (got ${val})`);
      }
      if (schema.integer && !Number.isInteger(val)) {
        throw new Error(`IPC Schema Validation Error: Number at '${path}' must be an integer`);
      }
      if (schema.min !== undefined && val < schema.min) {
        throw new Error(`IPC Schema Validation Error: Number at '${path}' (${val}) < min (${schema.min})`);
      }
      if (schema.max !== undefined && val > schema.max) {
        throw new Error(`IPC Schema Validation Error: Number at '${path}' (${val}) > max (${schema.max})`);
      }
    } else if (schema.type === 'string') {
      if (typeof val !== 'string') {
        throw new Error(`IPC Schema Validation Error: Expected string at '${path}', got ${typeof val}`);
      }
      if (schema.maxLength !== undefined && val.length > schema.maxLength) {
        throw new Error(`IPC Schema Validation Error: String at '${path}' exceeds maxLength ${schema.maxLength}`);
      }
      if (schema.enum && !schema.enum.includes(val)) {
        throw new Error(`IPC Schema Validation Error: String at '${path}' must be one of ${schema.enum.join(', ')}`);
      }
    } else if (schema.type === 'boolean') {
      if (typeof val !== 'boolean') {
        throw new Error(`IPC Schema Validation Error: Expected boolean at '${path}', got ${typeof val}`);
      }
    } else if (schema.type === 'object') {
      if (typeof val !== 'object' || Array.isArray(val)) {
        throw new Error(`IPC Schema Validation Error: Expected object at '${path}', got ${typeof val}`);
      }

      // Check required fields
      if (Array.isArray(schema.required)) {
        for (const reqField of schema.required) {
          if (val[reqField] === undefined || val[reqField] === null) {
            throw new Error(`IPC Schema Validation Error: Missing required object property '${reqField}' in '${path}'`);
          }
        }
      }

      // Check finite number fields
      if (Array.isArray(schema.finiteNumbers)) {
        IPCValidator.validateFiniteNumbers(val, schema.finiteNumbers);
      }

      // Validate properties
      if (schema.properties) {
        if (schema.additionalProperties === false) {
          const unexpected = Object.keys(val).filter((property) => !Object.hasOwn(schema.properties, property));
          if (unexpected.length > 0) {
            throw new Error(
              `IPC Schema Validation Error: Unexpected object properties at '${path}': ${unexpected.join(', ')}`
            );
          }
        }
        for (const [propKey, propSchema] of Object.entries(schema.properties)) {
          if (val[propKey] !== undefined) {
            validateSchema(val[propKey], propSchema, `${path}.${propKey}`);
          }
        }
      }
    }
  }

  return true;
}

/**
 * Only the main frame for the local application entry point may call privileged IPC.
 * @param {Object} event Electron invoke event
 * @param {string} trustedEntryPath Absolute path to src/index.html
 * @returns {boolean}
 */
function isTrustedIpcSender(event, trustedEntryPath) {
  const sender = event?.sender;
  const senderFrame = event?.senderFrame;
  if (!sender || !senderFrame || typeof sender.isDestroyed !== 'function') return false;

  try {
    const mainFrame = sender.mainFrame;
    if (
      sender.isDestroyed() ||
      !mainFrame ||
      !Number.isInteger(senderFrame.frameTreeNodeId) ||
      senderFrame.frameTreeNodeId !== mainFrame.frameTreeNodeId
    ) {
      return false;
    }

    const frameUrl = new URL(senderFrame.url);
    if (frameUrl.protocol !== 'file:' || frameUrl.host !== '' || frameUrl.search !== '') return false;

    const framePath = path.resolve(fileURLToPath(frameUrl));
    const expectedPath = path.resolve(trustedEntryPath);
    return path.relative(expectedPath, framePath) === '';
  } catch {
    return false;
  }
}

/**
 * Builds the guarded handler registered with ipcMain and exposes the same path for focused tests.
 * @param {string} channel IPC channel name
 * @param {Object} schema Validation schema descriptor
 * @param {Function} handler Implementation function
 * @param {Function} [getTrustedEntryPath] Provider for the trusted renderer entry point
 * @returns {Function}
 */
function defaultTrustedEntryPath() {
  const electronApp = getElectronApp();
  if (electronApp && typeof electronApp.getAppPath === 'function') {
    return path.join(electronApp.getAppPath(), 'src', 'index.html');
  }
  return path.join(path.resolve(__dirname, '../../..'), 'src', 'index.html');
}

/**
 * Builds the guarded handler registered with ipcMain and exposes the same path for focused tests.
 * @param {string} channel IPC channel name
 * @param {Object} schema Validation schema descriptor
 * @param {Function} handler Implementation function
 * @param {Function} [getTrustedEntryPath] Provider for the trusted renderer entry point
 * @returns {Function}
 */
function createIpcHandler(channel, schema, handler, getTrustedEntryPath = defaultTrustedEntryPath) {
  return async (event, rawPayload) => {
    try {
      if (!isTrustedIpcSender(event, getTrustedEntryPath())) {
        throw new Error(`Security Violation: IPC channel '${channel}' rejected an untrusted sender frame`);
      }

      // 1. Prototype Pollution Stripping (CWE-1321)
      const sanitized = IPCValidator.sanitize(rawPayload);

      // 2. Schema Validation (CWE-20, CWE-400)
      validateSchema(sanitized, schema, channel);

      // 3. Execute Handler
      return await handler(event, sanitized);
    } catch (err) {
      console.error(`[OmniEng IPC] Handler error on channel '${channel}':`, err.message);
      throw err;
    }
  };
}

/**
 * Defines and registers an Electron IPC handler with route-defined checks and sanitation helpers.
 *
 * @param {string} channel IPC channel name (e.g., 'omni:solve-drop-test')
 * @param {Object} schema Validation schema descriptor
 * @param {Function} handler Implementation function (event, cleanParams) => Promise<any>
 * @param {Object} [options] Metadata options (domain, description)
 */
function defineHandler(channel, schema, handler, options = {}) {
  if (
    typeof channel !== 'string' ||
    (!channel.startsWith('omni:') &&
      !channel.startsWith('cad:') &&
      !channel.startsWith('plant:') &&
      !channel.startsWith('hpc:'))
  ) {
    throw new Error(
      `Security Violation: All OmniEng IPC channels must start with 'omni:', 'cad:', 'plant:', or 'hpc:' (got '${channel}')`
    );
  }
  if (!schema || typeof schema !== 'object') {
    throw new Error(`Security Violation: Channel '${channel}' must provide a validation schema`);
  }
  if (typeof handler !== 'function') {
    throw new Error(`Invalid Handler: Channel '${channel}' must provide a callable handler function`);
  }
  if (channelRegistry.has(channel)) {
    throw new Error(`Duplicate IPC Handler: Channel '${channel}' is already registered`);
  }

  // Record registration metadata
  const metadata = {
    channel,
    domain: options.domain || 'system',
    description: options.description || '',
    maturity: getFeatureMaturity(options.domain || 'system'),
    registeredAt: new Date().toISOString(),
    schema
  };
  channelRegistry.set(channel, metadata);

  // Wrap with security filter and register with Electron ipcMain
  const targetIpc =
    activeIpcMain ||
    (function () {
      try {
        const candidate = require('electron');
        return candidate && typeof candidate === 'object' ? candidate.ipcMain : null;
      } catch {
        return null;
      }
    })();

  if (targetIpc && typeof targetIpc.handle === 'function') {
    targetIpc.handle(channel, createIpcHandler(channel, schema, handler));
  }

  return metadata;
}

/**
 * Returns all registered IPC channel definitions for auditing
 * @returns {Array<Object>}
 */
function getRegisteredChannels() {
  return Array.from(channelRegistry.values());
}

/**
 * Validates whether a specific channel is registered
 * @param {string} channel
 * @returns {boolean}
 */
function isChannelRegistered(channel) {
  return channelRegistry.has(channel);
}

module.exports = {
  defineHandler,
  validateSchema,
  isTrustedIpcSender,
  createIpcHandler,
  getRegisteredChannels,
  isChannelRegistered,
  channelRegistry,
  withIpcMain
};
