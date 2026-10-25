/**
 * OmniEng IPC Security Validator & Input Sanitizer
 * 
 * Implements strict type checking, prototype pollution stripping,
 * path traversal guards, and finite numerical bounds for all Electron IPC channels.
 * Directly mitigates CWE-20, CWE-22, CWE-400, and CWE-1321.
 */

'use strict';

const path = require('path');

class IPCValidator {
  /**
   * Deeply sanitizes an object by recursively stripping __proto__, constructor, and prototype.
   * Prevents Prototype Pollution (CWE-1321).
   * @param {*} input 
   * @returns {*} Clean sanitized copy
   */
  static sanitize(input) {
    if (input === null || typeof input !== 'object') {
      return input;
    }

    // Preserve binary IPC payloads so their declared buffer schema can enforce size limits.
    if (Buffer.isBuffer(input)) {
      return Buffer.from(input);
    }
    if (input instanceof Uint8Array) {
      return new Uint8Array(input);
    }

    if (Array.isArray(input)) {
      return input.map(item => IPCValidator.sanitize(item));
    }

    const clean = {};
    for (const key of Object.keys(input)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue; // Strip pollution vectors
      }
      clean[key] = IPCValidator.sanitize(input[key]);
    }
    return clean;
  }

  /**
   * Validates that all numeric properties in the given object are finite and non-NaN.
   * Prevents numerical solver destabilization (CWE-20).
   * @param {Object} obj 
   * @param {string[]} requiredFields 
   * @throws {Error} If any field is missing or non-finite
   */
  static validateFiniteNumbers(obj, requiredFields = []) {
    if (!obj || typeof obj !== 'object') {
      throw new Error('Invalid input: payload must be a non-null object');
    }

    for (const field of requiredFields) {
      const val = obj[field];
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new Error(`Security Validation Error: Field '${field}' must be a finite number (received: ${val})`);
      }
    }
    return true;
  }

  /**
   * Validates and sanitizes a file export path to prevent Directory Traversal (CWE-22).
   * @param {string} targetPath 
   * @param {string} allowedBaseDir 
   * @returns {string} Safe absolute path
   */
  static sanitizePath(targetPath, allowedBaseDir) {
    if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
      throw new Error('Invalid path: path must be a non-empty string');
    }

    const resolvedBase = path.resolve(allowedBaseDir);
    const resolvedTarget = path.resolve(resolvedBase, targetPath);

    // Verify resolvedTarget starts with resolvedBase
    if (!resolvedTarget.startsWith(resolvedBase)) {
      throw new Error(`Security Violation: Path traversal attempt detected outside workspace (${targetPath})`);
    }

    return resolvedTarget;
  }

  /**
   * Validates buffer payloads to prevent memory exhaustion / denial of service.
   * @param {Buffer|Uint8Array} buf 
   * @param {number} maxBytes 
   */
  static validateBuffer(buf, maxBytes = 100 * 1024 * 1024) {
    if (!buf || !(buf instanceof Buffer || buf instanceof Uint8Array)) {
      throw new Error('Invalid payload: expected Buffer or Uint8Array');
    }
    if (buf.length > maxBytes) {
      throw new Error(`Payload Exceeded Security Limit: ${buf.length} bytes exceeds maximum allowed ${maxBytes} bytes`);
    }
    return true;
  }
}

module.exports = { IPCValidator };
