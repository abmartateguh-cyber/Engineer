'use strict';

const crypto = require('crypto');
const { OmniError, OmniErrorCode } = require('./OmniError');

/**
 * Retention policies for engineering artifacts.
 */
const RetentionPolicy = Object.freeze({
  TRANSIENT: 'TRANSIENT',     // Can be pruned after session
  INTERMEDIATE: 'INTERMEDIATE', // Retained until job completion or explicit cleanup
  CHECKPOINT: 'CHECKPOINT',   // Checkpoint for restart
  PERSISTENT: 'PERSISTENT',   // Project-level permanent artifact
  AUDIT: 'AUDIT'             // Immutable compliance/audit evidence
});

/**
 * Immutable reference to a content-addressed engineering artifact.
 */
class ArtifactRef {
  /**
   * @param {object} params
   * @param {string} params.hash - SHA-256 content hash
   * @param {string} params.mimeType - MIME type or custom schema identifier (e.g. application/x-omni-mesh+json)
   * @param {string} [params.schemaVersion='1.0.0'] - Schema version
   * @param {string} [params.producingJobId=null] - Job that created this artifact
   * @param {string[]} [params.lineage=[]] - Array of parent artifact hashes
   * @param {string} [params.retention=RetentionPolicy.PERSISTENT] - Retention policy
   * @param {number} [params.byteLength=0] - Size in bytes
   * @param {string} [params.name=''] - Human-readable label or filename
   * @param {object} [params.metadata={}] - Arbitrary metadata
   */
  constructor({
    hash,
    mimeType,
    schemaVersion = '1.0.0',
    producingJobId = null,
    lineage = [],
    retention = RetentionPolicy.PERSISTENT,
    byteLength = 0,
    name = '',
    metadata = {}
  }) {
    if (!hash || typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `ArtifactRef requires a valid 64-char hex SHA-256 hash: "${hash}"`);
    }
    if (!mimeType || typeof mimeType !== 'string') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'ArtifactRef requires a non-empty mimeType string');
    }
    if (!Object.values(RetentionPolicy).includes(retention)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Invalid retention policy: "${retention}"`);
    }

    this._hash = hash.toLowerCase();
    this._mimeType = mimeType;
    this._schemaVersion = String(schemaVersion);
    this._producingJobId = producingJobId ? String(producingJobId) : null;
    this._lineage = Object.freeze([...(lineage || [])].map((h) => String(h).toLowerCase()));
    this._retention = retention;
    this._byteLength = Number.isInteger(byteLength) && byteLength >= 0 ? byteLength : 0;
    this._name = String(name || '');
    this._metadata = Object.freeze({ ...metadata });
    this._createdAt = new Date().toISOString();
    Object.freeze(this);
  }

  get hash() { return this._hash; }
  get mimeType() { return this._mimeType; }
  get schemaVersion() { return this._schemaVersion; }
  get producingJobId() { return this._producingJobId; }
  get lineage() { return this._lineage; }
  get retention() { return this._retention; }
  get byteLength() { return this._byteLength; }
  get name() { return this._name; }
  get metadata() { return this._metadata; }
  get createdAt() { return this._createdAt; }

  /**
   * Helper to compute SHA-256 from Buffer or string and create ArtifactRef.
   * @param {Buffer|string} content
   * @param {object} options
   * @returns {ArtifactRef}
   */
  static fromContent(content, options = {}) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    return new ArtifactRef({
      ...options,
      hash,
      byteLength: buf.length
    });
  }

  toJSON() {
    return {
      hash: this._hash,
      mimeType: this._mimeType,
      schemaVersion: this._schemaVersion,
      producingJobId: this._producingJobId,
      lineage: [...this._lineage],
      retention: this._retention,
      byteLength: this._byteLength,
      name: this._name,
      metadata: this._metadata,
      createdAt: this._createdAt
    };
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Invalid ArtifactRef JSON');
    }
    return new ArtifactRef(json);
  }
}

module.exports = {
  ArtifactRef,
  RetentionPolicy
};
