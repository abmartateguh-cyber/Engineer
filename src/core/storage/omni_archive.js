/**
 * OmniEng Universal Engineering Archive (.omni) & Command History Journal
 * 
 * Provides single-file container packaging for CAD, CAE, EDA, GNC, and Plant data
 * using native zlib compression, binary magic headers, integrity checksums,
 * and non-linear undo/redo command journaling.
 */

'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAGIC_BYTES = Buffer.from('OMNIENG\x01', 'binary'); // 8-byte magic header
const VAULT_MAGIC_BYTES = Buffer.from('OMNIVAUL', 'utf8'); // 8-byte encrypted vault header
const CURRENT_SCHEMA_VERSION = 1;

// Tier-1 Industrial Security Controls (CWE-400 Decompression Bomb & DoS Defense)
const MAX_UNCOMPRESSED_SECTION_SIZE = 500 * 1024 * 1024; // 500 MB ceiling
const MAX_EXPANSION_RATIO = 50; // 50:1 maximum compression expansion ratio


/**
 * Simple standard 32-bit CRC implementation for archive data integrity
 */
function calculateCRC32(buffer) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

/**
 * OmniArchive: Single-File Container (.omni)
 */
class OmniArchive {
  constructor(metadata = {}) {
    this.manifest = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectName: metadata.projectName || 'Untitled Project',
      engineeringDomain: metadata.engineeringDomain || 'universal',
      author: metadata.author || 'OmniEng Engineer',
      createdAt: metadata.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      unitsSystem: metadata.unitsSystem || 'SI_METRIC',
      description: metadata.description || 'OmniEng Engineering Project'
    };
    this.sections = new Map();
    this.addSection('manifest', this.manifest);
  }

  addSection(name, content) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('Section name must be a non-empty string');
    }
    let buffer;
    if (Buffer.isBuffer(content)) {
      buffer = content;
    } else if (typeof content === 'string') {
      buffer = Buffer.from(content, 'utf8');
    } else if (typeof content === 'object' && content !== null) {
      buffer = Buffer.from(JSON.stringify(content), 'utf8');
    } else {
      throw new Error(`Unsupported content type for section '${name}'`);
    }

    const compressed = zlib.deflateSync(buffer);
    const crc = calculateCRC32(compressed);

    this.sections.set(name, {
      rawLength: buffer.length,
      compressed,
      crc,
      parsedCache: typeof content === 'object' && !Buffer.isBuffer(content) ? content : null
    });
    this.manifest.updatedAt = new Date().toISOString();
  }

  getSection(name, asJson = true) {
    const entry = this.sections.get(name);
    if (!entry) return null;

    if (asJson && entry.parsedCache) {
      return entry.parsedCache;
    }

    // Verify CRC before decompression
    const checkCrc = calculateCRC32(entry.compressed);
    if (checkCrc !== entry.crc) {
      throw new Error(`CRC32 mismatch on section '${name}': data corruption detected!`);
    }

    // Security Gate: Decompression Bomb Guard (CWE-400)
    if (entry.rawLength > MAX_UNCOMPRESSED_SECTION_SIZE) {
      throw new Error(`Security Violation: Section '${name}' uncompressed size (${entry.rawLength} bytes) exceeds maximum ceiling (${MAX_UNCOMPRESSED_SECTION_SIZE} bytes)`);
    }
    const compLen = Math.max(1, entry.compressed.length);
    if (entry.rawLength / compLen > MAX_EXPANSION_RATIO && entry.rawLength > 1024 * 1024) {
      throw new Error(`Security Violation: Decompression bomb detected on section '${name}' (expansion ratio ${(entry.rawLength / compLen).toFixed(1)}:1 exceeds ${MAX_EXPANSION_RATIO}:1)`);
    }

    const decompressed = zlib.inflateSync(entry.compressed, {
      maxOutputLength: Math.min(entry.rawLength + 1024, MAX_UNCOMPRESSED_SECTION_SIZE)
    });
    if (decompressed.length !== entry.rawLength) {
      throw new Error(`Security Error: Decompressed byte length (${decompressed.length}) does not match manifest header (${entry.rawLength})`);
    }

    if (asJson) {
      try {
        const parsed = JSON.parse(decompressed.toString('utf8'));
        entry.parsedCache = parsed;
        return parsed;
      } catch (e) {
        return decompressed.toString('utf8');
      }
    }
    return decompressed;
  }

  hasSection(name) {
    return this.sections.has(name);
  }

  listSections() {
    return Array.from(this.sections.keys());
  }

  /**
   * Serialize entire archive into binary Buffer
   */
  saveToBuffer() {
    // Binary format:
    // [8 bytes MAGIC: OMNIENG\x01]
    // [4 bytes uint32: section count]
    // Repeating section entries:
    //   [2 bytes uint16: name length]
    //   [N bytes utf8: section name]
    //   [4 bytes uint32: raw uncompressed length]
    //   [4 bytes uint32: compressed length]
    //   [4 bytes uint32: crc32]
    //   [M bytes: compressed payload]

    const header = Buffer.alloc(12);
    MAGIC_BYTES.copy(header, 0);
    header.writeUInt32BE(this.sections.size, 8);

    const chunks = [header];

    for (const [name, entry] of this.sections.entries()) {
      const nameBuf = Buffer.from(name, 'utf8');
      const meta = Buffer.alloc(2 + nameBuf.length + 4 + 4 + 4);
      meta.writeUInt16BE(nameBuf.length, 0);
      nameBuf.copy(meta, 2);

      const offset = 2 + nameBuf.length;
      meta.writeUInt32BE(entry.rawLength, offset);
      meta.writeUInt32BE(entry.compressed.length, offset + 4);
      meta.writeUInt32BE(entry.crc, offset + 8);

      chunks.push(meta);
      chunks.push(entry.compressed);
    }

    return Buffer.concat(chunks);
  }

  /**
   * Load and unpack an OmniArchive from a binary Buffer
   */
  static loadFromBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
      throw new Error('Invalid archive: buffer is too small');
    }

    // Verify magic bytes
    if (!buffer.subarray(0, 8).equals(MAGIC_BYTES)) {
      throw new Error("Invalid archive format: missing 'OMNIENG\x01' magic header");
    }

    const sectionCount = buffer.readUInt32BE(8);
    const archive = new OmniArchive();
    archive.sections.clear();

    let offset = 12;

    for (let i = 0; i < sectionCount; i++) {
      if (offset + 2 > buffer.length) throw new Error('Malformed archive: unexpected EOF');
      const nameLen = buffer.readUInt16BE(offset);
      offset += 2;

      const name = buffer.subarray(offset, offset + nameLen).toString('utf8');
      offset += nameLen;

      const rawLength = buffer.readUInt32BE(offset);
      const compLength = buffer.readUInt32BE(offset + 4);
      const crc = buffer.readUInt32BE(offset + 8);
      offset += 12;

      const compressed = buffer.subarray(offset, offset + compLength);
      offset += compLength;

      // Verify CRC
      const checkCrc = calculateCRC32(compressed);
      if (checkCrc !== crc) {
        throw new Error(`Data corruption in archive section '${name}': CRC checksum failure`);
      }

      archive.sections.set(name, {
        rawLength,
        compressed,
        crc,
        parsedCache: null
      });
    }

    // Refresh manifest
    const manifest = archive.getSection('manifest', true);
    if (manifest) {
      archive.manifest = manifest;
    }

    return archive;
  }

  saveToFile(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const buf = this.saveToBuffer();
    fs.writeFileSync(filePath, buf);
    return { filePath, sizeBytes: buf.length, sectionCount: this.sections.size };
  }

  static loadFromFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Archive file not found: ${filePath}`);
    }
    const buf = fs.readFileSync(filePath);
    return OmniArchive.loadFromBuffer(buf);
  }

  /**
   * Encrypts the entire archive using AES-256-GCM with PBKDF2 key derivation.
   * Directly protects confidential CAD IP from disk extraction (CWE-311).
   * @param {string} password 
   * @returns {Buffer} Encrypted binary container
   */
  saveToEncryptedBuffer(password) {
    if (!password || typeof password !== 'string' || password.length < 4) {
      throw new Error('Encryption Error: Password must be at least 4 characters long');
    }
    const plaintext = this.saveToBuffer();
    return OmniVaultAES256.encrypt(plaintext, password);
  }

  /**
   * Decrypts and restores an OmniArchive from an AES-256-GCM encrypted buffer.
   * @param {Buffer} encryptedBuffer 
   * @param {string} password 
   * @returns {OmniArchive}
   */
  static loadFromEncryptedBuffer(encryptedBuffer, password) {
    if (!password || typeof password !== 'string') {
      throw new Error('Decryption Error: Password must be provided');
    }
    const decrypted = OmniVaultAES256.decrypt(encryptedBuffer, password);
    return OmniArchive.loadFromBuffer(decrypted);
  }
}

/**
 * OmniVaultAES256: Industrial Encrypted Engineering Container
 * Implements authenticated symmetric encryption (AES-256-GCM) with random salt,
 * 100,000 PBKDF2 iterations, 96-bit IV, and 128-bit authentication tag.
 */
class OmniVaultAES256 {
  static encrypt(plaintextBuffer, password) {
    const salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: [8B VAULT_MAGIC] [16B salt] [12B iv] [16B tag] [N bytes ciphertext]
    const header = Buffer.alloc(8 + 16 + 12 + 16);
    VAULT_MAGIC_BYTES.copy(header, 0);
    salt.copy(header, 8);
    iv.copy(header, 24);
    tag.copy(header, 36);

    return Buffer.concat([header, ciphertext]);
  }

  static decrypt(encryptedBuffer, password) {
    if (encryptedBuffer.length < 52) {
      throw new Error('Corrupt encrypted vault: payload shorter than cryptographic header');
    }

    const magic = encryptedBuffer.subarray(0, 8);
    if (!magic.equals(VAULT_MAGIC_BYTES)) {
      throw new Error('Invalid vault header: not an OmniEng AES-256 encrypted container');
    }

    const salt = encryptedBuffer.subarray(8, 24);
    const iv = encryptedBuffer.subarray(24, 36);
    const tag = encryptedBuffer.subarray(36, 52);
    const ciphertext = encryptedBuffer.subarray(52);

    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (err) {
      throw new Error('Decryption Failed: Invalid password or corrupted authentication tag (HMAC mismatch)');
    }
  }
}

/**
 * CommandJournal: Non-Linear Command History & Undo/Redo Journaling
 */
class CommandJournal {
  constructor() {
    this.history = [];
    this.currentIndex = -1;
    this.branchCounter = 0;
  }

  execute(actionType, forwardPatch, reversePatch, description = '', author = 'user') {
    this.branchCounter++;
    const entry = {
      id: `rev_${Date.now()}_${this.branchCounter}`,
      parentId: this.currentIndex >= 0 ? this.history[this.currentIndex].id : null,
      timestamp: new Date().toISOString(),
      actionType,
      forwardPatch: JSON.parse(JSON.stringify(forwardPatch)),
      reversePatch: JSON.parse(JSON.stringify(reversePatch)),
      description: description || actionType,
      author
    };

    // If we undo and then execute, truncate future branch (standard non-linear branch point)
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }

    this.history.push(entry);
    this.currentIndex = this.history.length - 1;
    return entry;
  }

  canUndo() {
    return this.currentIndex >= 0;
  }

  canRedo() {
    return this.currentIndex < this.history.length - 1;
  }

  undo() {
    if (!this.canUndo()) return null;
    const currentEntry = this.history[this.currentIndex];
    this.currentIndex--;
    return {
      appliedPatch: currentEntry.reversePatch,
      undoneEntry: currentEntry,
      newIndex: this.currentIndex
    };
  }

  redo() {
    if (!this.canRedo()) return null;
    this.currentIndex++;
    const currentEntry = this.history[this.currentIndex];
    return {
      appliedPatch: currentEntry.forwardPatch,
      redoneEntry: currentEntry,
      newIndex: this.currentIndex
    };
  }

  getHistory() {
    return this.history.map((entry, idx) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      actionType: entry.actionType,
      description: entry.description,
      author: entry.author,
      isCurrent: idx === this.currentIndex
    }));
  }

  export() {
    return {
      history: this.history,
      currentIndex: this.currentIndex,
      branchCounter: this.branchCounter
    };
  }

  import(data) {
    if (!data || !Array.isArray(data.history)) {
      throw new Error('Invalid journal import data format');
    }
    this.history = data.history;
    this.currentIndex = data.currentIndex !== undefined ? data.currentIndex : this.history.length - 1;
    this.branchCounter = data.branchCounter || this.history.length;
  }
}

module.exports = {
  OmniArchive,
  CommandJournal,
  OmniVaultAES256,
  calculateCRC32,
  MAGIC_BYTES,
  VAULT_MAGIC_BYTES,
  MAX_UNCOMPRESSED_SECTION_SIZE,
  MAX_EXPANSION_RATIO
};
