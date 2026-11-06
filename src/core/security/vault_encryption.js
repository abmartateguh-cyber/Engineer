/**
 * Envelope-encrypted project vault with key rotation (AES-256-GCM).
 *
 * Design (experimental, node:crypto only):
 *   - The master key is derived with PBKDF2 (SHA-256) from a passphrase and a
 *     random salt. Every envelope carries its own salt so it can be unwrapped
 *     independently of the vault instance that produced it.
 *   - A random data key (32 bytes) encrypts project payloads with AES-256-GCM
 *     (12-byte IV, 16-byte authentication tag). The data key itself is wrapped
 *     under the master key with AES-256-GCM and stored in `wrappedKey`, so the
 *     envelope is self-contained.
 *   - `rotate()` derives a fresh data key and re-seals the supplied entries.
 *     Old data keys are retained in memory for a bounded number of rotations so
 *     legacy (not-yet-re-sealed) entries keep authenticating. Because every
 *     envelope embeds its wrapped data key, legacy entries remain openable even
 *     after a retained key is trimmed.
 *   - Tamper guarantees come from GCM: any modification of ciphertext, tag, or
 *     IV (or of the wrapped key / salt) fails authentication on open().
 *
 * Not a hardened keystore: the passphrase and data keys live in process memory;
 * no key storage, pinning, or HSM backing is provided.
 */

'use strict';

const crypto = require('crypto');

const ENVELOPE_VERSION = 'v1';
const DEFAULT_PBKDF2_ITERATIONS = 150000;
const MASTER_KEY_BYTES = 32;
const DATA_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SALT_BYTES = 16;
const RETAINED_KEY_LIMIT = 8;
const PBKDF2_DIGEST = 'sha256';

function requireBuffer(value, name) {
  if (!Buffer.isBuffer(value)) {
    throw new TypeError(`${name} must be a Buffer`);
  }
}

function deriveMasterKey(passphrase, salt, iterations) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new TypeError('passphrase must be a non-empty string');
  }
  requireBuffer(salt, 'salt');
  if (salt.length !== SALT_BYTES) {
    throw new TypeError(`salt must be exactly ${SALT_BYTES} bytes`);
  }
  return crypto.pbkdf2Sync(passphrase, salt, iterations, MASTER_KEY_BYTES, PBKDF2_DIGEST);
}

function aesGcmEncrypt(key, plaintext) {
  requireBuffer(key, 'key');
  requireBuffer(plaintext, 'plaintext');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function aesGcmDecrypt(key, iv, tag, ciphertext) {
  requireBuffer(key, 'key');
  requireBuffer(iv, 'iv');
  requireBuffer(tag, 'tag');
  requireBuffer(ciphertext, 'ciphertext');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function wrapDataKey(masterKey, dataKey) {
  const wrapped = aesGcmEncrypt(masterKey, dataKey);
  return { iv: wrapped.iv, tag: wrapped.tag, data: wrapped.ciphertext };
}

function unwrapDataKey(masterKey, wrappedKey) {
  requireBuffer(wrappedKey.data, 'wrappedKey.data');
  return aesGcmDecrypt(masterKey, wrappedKey.iv, wrappedKey.tag, wrappedKey.data);
}

function assertEnvelopeShape(envelope) {
  if (envelope === null || typeof envelope !== 'object') {
    throw new TypeError('envelope must be an object');
  }
  if (envelope.version !== ENVELOPE_VERSION) {
    throw new Error(`unsupported envelope version: ${envelope.version}`);
  }
  requireBuffer(envelope.salt, 'envelope.salt');
  requireBuffer(envelope.iv, 'envelope.iv');
  requireBuffer(envelope.tag, 'envelope.tag');
  requireBuffer(envelope.ciphertext, 'envelope.ciphertext');
  if (envelope.wrappedKey === null || typeof envelope.wrappedKey !== 'object') {
    throw new TypeError('envelope.wrappedKey must be an object');
  }
}

class ProjectVault {
  /**
   * @param {Object} options
   * @param {string} options.passphrase - Export/import passphrase (in memory only)
   * @param {number} [options.pbkdf2Iterations=150000] - PBKDF2 cost
   * @param {Buffer} [options.salt] - Fixed salt (tests); random when omitted
   */
  constructor({ passphrase, pbkdf2Iterations = DEFAULT_PBKDF2_ITERATIONS, salt } = {}) {
    this.passphrase = passphrase;
    this.pbkdf2Iterations = pbkdf2Iterations;
    this.salt = salt || crypto.randomBytes(SALT_BYTES);
    this.masterKey = deriveMasterKey(this.passphrase, this.salt, this.pbkdf2Iterations);
    this.currentDataKey = crypto.randomBytes(DATA_KEY_BYTES);
    this.currentKeyId = 1;
    this.nextKeyId = 2;
    this.retainedKeys = new Map();
  }

  seal(payload) {
    requireBuffer(payload, 'payload');
    const { iv, tag, ciphertext } = aesGcmEncrypt(this.currentDataKey, payload);
    return {
      version: ENVELOPE_VERSION,
      keyId: this.currentKeyId,
      salt: this.salt,
      iv,
      tag,
      ciphertext,
      wrappedKey: wrapDataKey(this.masterKey, this.currentDataKey)
    };
  }

  open(envelope) {
    assertEnvelopeShape(envelope);
    const dataKey = this.resolveDataKey(envelope);
    return aesGcmDecrypt(dataKey, envelope.iv, envelope.tag, envelope.ciphertext);
  }

  resolveDataKey(envelope) {
    if (envelope.keyId === this.currentKeyId) {
      return this.currentDataKey;
    }
    const retained = this.retainedKeys.get(envelope.keyId);
    if (retained) {
      return retained;
    }
    return unwrapDataKey(this.masterKey, envelope.wrappedKey);
  }

  /**
   * Derives a new data key and re-seals the given entries under it. The old
   * data key is retained in memory (bounded) for legacy entries; entries not
   * passed here remain openable via their embedded wrapped key.
   *
   * @param {Array<Object>} entries - envelopes to re-seal with the new key
   * @returns {Array<Object>} re-sealed envelopes (same order as `entries`)
   */
  rotate(entries) {
    if (!Array.isArray(entries)) {
      throw new TypeError('entries must be an array of envelopes');
    }
    this.retainedKeys.set(this.currentKeyId, this.currentDataKey);
    while (this.retainedKeys.size > RETAINED_KEY_LIMIT) {
      const oldest = this.retainedKeys.keys().next().value;
      this.retainedKeys.delete(oldest);
    }
    this.currentDataKey = crypto.randomBytes(DATA_KEY_BYTES);
    const rotatedKeyId = this.nextKeyId;
    this.nextKeyId += 1;
    this.currentKeyId = rotatedKeyId;
    return entries.map((envelope) => {
      const payload = this.open(envelope);
      return this.seal(payload);
    });
  }

  currentKeyIdValue() {
    return this.currentKeyId;
  }
}

module.exports = {
  ProjectVault,
  ENVELOPE_VERSION,
  DEFAULT_PBKDF2_ITERATIONS
};
