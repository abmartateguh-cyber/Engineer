'use strict';

/**
 * Real cryptographic record signing and verification for OmniEng engineering records.
 *
 * Uses only node:crypto:
 *   - ECDSA P-384 (default) or RSA-4096, both hashed with SHA-384 (FIPS 186-4
 *     curve P-384 group; RSA-4096 for interop with conservative PKI policies).
 *   - Detached signatures over a canonical JSON encoding (recursively sorted
 *     keys, fixed float formatting) so a record hashes identically regardless
 *     of object key insertion order.
 *
 * Hardware PKCS#11 (see pkcs11_smartcard.js) remains unavailable and fails
 * closed with CKR_FUNCTION_NOT_SUPPORTED. This module provides a local SOFTWARE
 * signing authority labelled "development/software keystore" for development
 * ledger integrity. It is NOT an HSM replacement: the private key lives in
 * process memory only and is not protected outside the process.
 */

const crypto = require('crypto');

const DEFAULT_HASH_ALGORITHM = 'sha384';
const SIGNATURE_ALGORITHMS = {
  ECDSA_P384: 'ECDSA-P384-SHA384',
  RSA4096: 'RSA4096-SHA384'
};
const DEFAULT_SIGNATURE_ALGORITHM = SIGNATURE_ALGORITHMS.ECDSA_P384;
const GENESIS_HASH = '0'.repeat(96);

function hashBytes(bytes) {
  return crypto.createHash(DEFAULT_HASH_ALGORITHM).update(bytes).digest('hex');
}

function escapeJsonString(str) {
  return JSON.stringify(str);
}

function formatNumber(n) {
  if (!Number.isFinite(n)) {
    throw new TypeError(`Cannot canonicalize non-finite number: ${n}`);
  }
  if (Object.is(n, -0)) {
    return '0';
  }
  return n.toString();
}

function writeCanonical(value, out, inArray) {
  if (value === null) {
    out.push('null');
    return;
  }
  switch (typeof value) {
    case 'string':
      out.push(escapeJsonString(value));
      return;
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'number':
      out.push(formatNumber(value));
      return;
    case 'bigint':
      throw new TypeError('Cannot canonicalize BigInt values');
    case 'undefined':
      if (inArray) {
        out.push('null');
        return;
      }
      throw new TypeError('Cannot canonicalize undefined object value');
    case 'object': {
      if (value instanceof Date) {
        out.push(escapeJsonString(value.toISOString()));
        return;
      }
      if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        out.push(escapeJsonString(Buffer.from(value).toString('base64')));
        return;
      }
      if (Array.isArray(value)) {
        out.push('[');
        for (let i = 0; i < value.length; i++) {
          if (i > 0) out.push(',');
          writeCanonical(value[i], out, true);
        }
        out.push(']');
        return;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        const name = proto.constructor ? proto.constructor.name : 'unknown';
        throw new TypeError(`Cannot canonicalize non-plain object of type ${name}`);
      }
      const keys = Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort();
      out.push('{');
      for (let i = 0; i < keys.length; i++) {
        if (i > 0) out.push(',');
        out.push(escapeJsonString(keys[i]), ':');
        writeCanonical(value[keys[i]], out, false);
      }
      out.push('}');
      return;
    }
    default:
      throw new TypeError(`Unsupported canonicalizable type: ${typeof value}`);
  }
}

function canonicalize(value) {
  const out = [];
  writeCanonical(value, out, false);
  return out.join('');
}

function generateKeyPair({ algorithm = DEFAULT_SIGNATURE_ALGORITHM } = {}) {
  const alg = String(algorithm).toUpperCase();
  let keyPair;
  let signatureAlg;
  if (alg.includes('ECDSA')) {
    keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-384' });
    signatureAlg = SIGNATURE_ALGORITHMS.ECDSA_P384;
  } else if (alg.includes('RSA')) {
    keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 4096 });
    signatureAlg = SIGNATURE_ALGORITHMS.RSA4096;
  } else {
    throw new Error(`Unsupported signing algorithm: ${algorithm}`);
  }
  return {
    privateKeyPem: keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }),
    signatureAlg
  };
}

function signRecord(record, privateKeyPem, { algorithm = DEFAULT_SIGNATURE_ALGORITHM } = {}) {
  if (!privateKeyPem || typeof privateKeyPem !== 'string') {
    throw new Error('signRecord requires a private key PEM');
  }
  const canonicalBytes = Buffer.from(canonicalize(record), 'utf8');
  const signer = crypto.createSign(DEFAULT_HASH_ALGORITHM);
  signer.update(canonicalBytes);
  signer.end();
  return {
    signature: signer.sign(privateKeyPem, 'base64'),
    signatureAlg: algorithm,
    signedPayloadHash: hashBytes(canonicalBytes),
    signedAt: new Date().toISOString()
  };
}

function verifyRecord(record, signature, publicKeyPem) {
  try {
    if (!publicKeyPem || typeof publicKeyPem !== 'string') {
      throw new Error('verifyRecord requires a public key PEM');
    }
    const canonicalBytes = Buffer.from(canonicalize(record), 'utf8');
    const verifier = crypto.createVerify(DEFAULT_HASH_ALGORITHM);
    verifier.update(canonicalBytes);
    verifier.end();
    const valid = verifier.verify(publicKeyPem, Buffer.from(String(signature), 'base64'));
    return {
      valid,
      reason: valid ? null : 'Detached signature verification failed over canonical record bytes',
      signedPayloadHash: hashBytes(canonicalBytes)
    };
  } catch (err) {
    return { valid: false, reason: `Verification error: ${err.message}`, signedPayloadHash: null };
  }
}

class SoftwareSigningAuthority {
  constructor(options = {}) {
    const keyPair = generateKeyPair({ algorithm: options.algorithm });
    this.privateKeyPem = keyPair.privateKeyPem;
    this.publicKeyPem = keyPair.publicKeyPem;
    this.signatureAlg = keyPair.signatureAlg;
    this.label = options.label || 'development/software keystore';
    this.storeType = 'software';
    this.hardwareBacked = false;
    this.validationLevel = 'local-development-signing';
    this.status = 'available';
  }

  signRecord(record) {
    return signRecord(record, this.privateKeyPem, { algorithm: this.signatureAlg });
  }

  verifyRecord(record, signature, publicKeyPem = this.publicKeyPem) {
    return verifyRecord(record, signature, publicKeyPem);
  }

  describe() {
    return {
      label: this.label,
      status: this.status,
      storeType: this.storeType,
      hardwareBacked: this.hardwareBacked,
      validationLevel: this.validationLevel,
      signatureAlg: this.signatureAlg,
      publicKeyPem: this.publicKeyPem,
      note:
        'Local software signing authority backed by node:crypto (ECDSA P-384 / RSA-4096 with SHA-384). ' +
        'Not an HSM; the private key lives in process memory only.'
    };
  }
}

class SignedLedger {
  constructor(authority) {
    if (!authority || typeof authority.signRecord !== 'function' || typeof authority.verifyRecord !== 'function') {
      throw new Error('SignedLedger requires a signing authority implementing signRecord/verifyRecord');
    }
    this.authority = authority;
    this.entries = [];
    this.latestChainHash = GENESIS_HASH;
  }

  _signerLabel() {
    return this.authority.label || 'development/software keystore';
  }

  _chainHash(sequenceNumber, prevHash, signedPayloadHash, signature, signatureAlg, signedAt, signerLabel) {
    const material = canonicalize({
      sequenceNumber,
      prevHash,
      signedPayloadHash,
      signature,
      signatureAlg,
      signedAt,
      signerLabel
    });
    return hashBytes(Buffer.from(material, 'utf8'));
  }

  _makeEntry(record, signatureParts, sequenceNumber, prevHash) {
    const signerLabel = this._signerLabel();
    return {
      sequenceNumber,
      prevHash,
      record,
      signedPayloadHash: signatureParts.signedPayloadHash,
      signature: signatureParts.signature,
      signatureAlg: signatureParts.signatureAlg,
      signedAt: signatureParts.signedAt,
      signerLabel,
      publicKeyPem: this.authority.publicKeyPem,
      chainHash: this._chainHash(
        sequenceNumber,
        prevHash,
        signatureParts.signedPayloadHash,
        signatureParts.signature,
        signatureParts.signatureAlg,
        signatureParts.signedAt,
        signerLabel
      )
    };
  }

  append(record) {
    const signatureParts = this.authority.signRecord(record);
    const entry = this._makeEntry(record, signatureParts, this.entries.length + 1, this.latestChainHash);
    this.entries.push(entry);
    this.latestChainHash = entry.chainHash;
    return entry;
  }

  getEntries() {
    return [...this.entries];
  }

  _failure(index, error) {
    return { valid: false, entriesCount: index, firstFailureIndex: index, error };
  }

  verifyChain({ entries = this.entries, publicKeyPem = this.authority.publicKeyPem } = {}) {
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry || typeof entry !== 'object') {
        return this._failure(i, `Entry ${i + 1} is not an object`);
      }
      if (entry.sequenceNumber !== i + 1) {
        return this._failure(
          i,
          `Invalid sequence number at entry ${i + 1}: expected ${i + 1}, got ${entry.sequenceNumber}`
        );
      }
      if (entry.prevHash !== prevHash) {
        return this._failure(
          i,
          `Broken hash-chain link at entry ${i + 1}: prevHash ${entry.prevHash} does not match previous chain digest ${prevHash}`
        );
      }
      const expectedPayloadHash = hashBytes(Buffer.from(canonicalize(entry.record), 'utf8'));
      if (expectedPayloadHash !== entry.signedPayloadHash) {
        return this._failure(
          i,
          `signedPayloadHash mismatch at entry ${i + 1}: recorded ${entry.signedPayloadHash}, recomputed ${expectedPayloadHash}`
        );
      }
      const verification = this.authority.verifyRecord(
        entry.record,
        entry.signature,
        publicKeyPem || entry.publicKeyPem
      );
      if (!verification.valid) {
        return this._failure(i, `Detached signature invalid at entry ${i + 1}: ${verification.reason}`);
      }
      const expectedChainHash = this._chainHash(
        entry.sequenceNumber,
        entry.prevHash,
        entry.signedPayloadHash,
        entry.signature,
        entry.signatureAlg,
        entry.signedAt,
        entry.signerLabel
      );
      if (expectedChainHash !== entry.chainHash) {
        return this._failure(
          i,
          `chainHash mismatch at entry ${i + 1}: recorded ${entry.chainHash}, recomputed ${expectedChainHash}`
        );
      }
      prevHash = entry.chainHash;
    }
    return {
      valid: true,
      entriesCount: entries.length,
      latestChainHash: prevHash,
      algorithm: this.authority.signatureAlg
    };
  }
}

module.exports = {
  canonicalize,
  generateKeyPair,
  signRecord,
  verifyRecord,
  SoftwareSigningAuthority,
  SignedLedger,
  SIGNATURE_ALGORITHMS,
  DEFAULT_HASH_ALGORITHM,
  GENESIS_HASH
};
