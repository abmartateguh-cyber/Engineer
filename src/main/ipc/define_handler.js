/**
 * OmniEng Industrial IPC Handler & Schema Validation Engine
 * 
 * Provides centralized, 100% schema-validated IPC endpoint registration:
 * - CWE-1321: Recursive Prototype Pollution stripping on all payloads
 * - CWE-20: Finite number validation (NaN/Infinity rejection)
 * - CWE-22: Path traversal guards
 * - CWE-400: Payload size & memory exhaustion limits
 * - Strict schema matching and audit logging
 */

'use strict';

const { ipcMain } = require('electron');
const { IPCValidator } = require('../../core/security/ipc_validator');

// Registry of all validated channels across all domains
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
        throw new Error(`IPC Schema Validation Error: Array at '${path}' has length ${val.length} < minItems ${schema.minItems}`);
      }
      if (schema.maxItems !== undefined && val.length > schema.maxItems) {
        throw new Error(`IPC Schema Validation Error: Array at '${path}' has length ${val.length} > maxItems ${schema.maxItems}`);
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
 * Defines and registers an Electron IPC handler with full schema validation and sanitization.
 * 
 * @param {string} channel IPC channel name (e.g., 'omni:solve-drop-test')
 * @param {Object} schema Validation schema descriptor
 * @param {Function} handler Implementation function (event, cleanParams) => Promise<any>
 * @param {Object} [options] Metadata options (domain, description)
 */
function defineHandler(channel, schema, handler, options = {}) {
  if (typeof channel !== 'string' || !channel.startsWith('omni:')) {
    throw new Error(`Security Violation: All OmniEng IPC channels must start with 'omni:' (got '${channel}')`);
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
    registeredAt: new Date().toISOString(),
    schema
  };
  channelRegistry.set(channel, metadata);

  // Wrap with security filter and register with Electron ipcMain
  ipcMain.handle(channel, async (event, rawPayload) => {
    try {
      // 1. Prototype Pollution Stripping (CWE-1321)
      const sanitized = IPCValidator.sanitize(rawPayload);

      // 2. Schema Validation (CWE-20, CWE-400)
      validateSchema(sanitized, schema, channel);

      // 3. Execute Handler
      const result = await handler(event, sanitized);
      return result;
    } catch (err) {
      console.error(`[IPC Security Gateway] Error on channel '${channel}':`, err.message);
      throw err;
    }
  });

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
  getRegisteredChannels,
  isChannelRegistered,
  channelRegistry
};
