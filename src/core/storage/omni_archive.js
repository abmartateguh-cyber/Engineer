/**
 * OmniEng Universal Engineering Archive (.omni) & Command History Journal
 *
 * Implements:
 * - v1 Legacy single-file container (MAGIC: OMNIENG\x01)
 * - v2 Content-addressed atomic archive (MAGIC: OMNIENG\x02)
 * - Atomic saves with fsync and safe rename
 * - Crash recovery journal & automatic recovery
 * - v1 to v2 migration
 * - Non-linear undo/redo CommandHistoryJournal
 * - AES-256-GCM encrypted vault
 */

'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');
const { ProjectManifestV2 } = require('../contracts/ProjectManifestV2');
const { ArtifactRef, RetentionPolicy } = require('../contracts/ArtifactRef');

const MAGIC_BYTES_V1 = Buffer.from('OMNIENG\x01', 'binary'); // 8-byte magic header v1
const MAGIC_BYTES_V2 = Buffer.from('OMNIENG\x02', 'binary'); // 8-byte magic header v2
const MAGIC_BYTES = MAGIC_BYTES_V1; // Compatibility default
const VAULT_MAGIC_BYTES = Buffer.from('OMNIVAUL', 'utf8'); // 8-byte encrypted vault header
const CURRENT_SCHEMA_VERSION_V1 = 1;
const CURRENT_SCHEMA_VERSION_V2 = '2.0.0';

// Resource limits
const MAX_ARCHIVE_SECTION_COUNT = 4096;
const MAX_ARCHIVE_SIZE_BYTES = 512 * 1024 * 1024; // 512 MiB
const MAX_UNCOMPRESSED_SECTION_SIZE = 500 * 1024 * 1024; // 500 MB
const MAX_EXPANSION_RATIO = 50;

/**
 * Standard 32-bit CRC implementation for archive data integrity
 */
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function calculateCRC32(buffer) {
  let crc = 0 ^ -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Performs atomic file write: temp file -> fsync -> rename with optional backup.
 * @param {string} filePath
 * @param {Buffer} buffer
 * @param {boolean} [createBackup=true]
 */
function saveAtomicSync(filePath, buffer, createBackup = true) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${filePath}.tmp.${process.pid}.${crypto.randomUUID()}`;
  const fd = fs.openSync(tempPath, 'w');
  try {
    fs.writeSync(fd, buffer, 0, buffer.length, 0);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  // Backup existing file if requested
  if (createBackup && fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    } catch (_) {}
  }

  fs.renameSync(tempPath, filePath);
}

/**
 * OmniArchive (v1) Single-File Container
 */
class OmniArchive {
  constructor(metadata = {}) {
    this.manifest = {
      schemaVersion: CURRENT_SCHEMA_VERSION_V1,
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
    const nameBytes = Buffer.byteLength(name, 'utf8');
    if (nameBytes > 0xffff) {
      throw new Error('Section name exceeds the archive format limit of 65535 bytes');
    }
    if (!this.sections.has(name) && this.sections.size >= MAX_ARCHIVE_SECTION_COUNT) {
      throw new Error(`Archive exceeds the maximum section count of ${MAX_ARCHIVE_SECTION_COUNT}`);
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
    if (buffer.length > MAX_UNCOMPRESSED_SECTION_SIZE) {
      throw new Error(`Section '${name}' exceeds maximum uncompressed size ${MAX_UNCOMPRESSED_SECTION_SIZE}`);
    }
    let aggregateRawLength = buffer.length;
    let currentArchiveBytes = 12;
    for (const [sectionName, entry] of this.sections.entries()) {
      if (sectionName === name) continue;
      aggregateRawLength += entry.rawLength;
      currentArchiveBytes += Buffer.byteLength(sectionName, 'utf8') + 14 + entry.compressed.length;
    }
    if (aggregateRawLength > MAX_ARCHIVE_SIZE_BYTES) {
      throw new Error(`Archive exceeds the maximum aggregate uncompressed size of ${MAX_ARCHIVE_SIZE_BYTES}`);
    }

    const compressed = zlib.deflateSync(buffer);
    if (currentArchiveBytes + Buffer.byteLength(name, 'utf8') + 14 + compressed.length > MAX_ARCHIVE_SIZE_BYTES) {
      throw new Error(`Archive exceeds the maximum serialized size of ${MAX_ARCHIVE_SIZE_BYTES}`);
    }
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

    const checkCrc = calculateCRC32(entry.compressed);
    if (checkCrc !== entry.crc) {
      throw new Error(`CRC32 mismatch on section '${name}': data corruption detected!`);
    }

    if (entry.rawLength > MAX_UNCOMPRESSED_SECTION_SIZE) {
      throw new Error(
        `Security Violation: Section '${name}' uncompressed size (${entry.rawLength} bytes) exceeds maximum ceiling (${MAX_UNCOMPRESSED_SECTION_SIZE} bytes)`
      );
    }
    const compLen = Math.max(1, entry.compressed.length);
    if (entry.rawLength / compLen > MAX_EXPANSION_RATIO && entry.rawLength > 1024 * 1024) {
      throw new Error(
        `Security Violation: Decompression bomb detected on section '${name}' (expansion ratio ${(entry.rawLength / compLen).toFixed(1)}:1 exceeds ${MAX_EXPANSION_RATIO}:1)`
      );
    }

    const decompressed = zlib.inflateSync(entry.compressed, {
      maxOutputLength: Math.min(entry.rawLength + 1024, MAX_UNCOMPRESSED_SECTION_SIZE)
    });
    if (decompressed.length !== entry.rawLength) {
      throw new Error(
        `Security Error: Decompressed byte length (${decompressed.length}) does not match manifest header (${entry.rawLength})`
      );
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

  saveToBuffer() {
    if (this.sections.size > MAX_ARCHIVE_SECTION_COUNT) {
      throw new Error(`Archive exceeds the maximum section count of ${MAX_ARCHIVE_SECTION_COUNT}`);
    }

    const header = Buffer.alloc(12);
    MAGIC_BYTES_V1.copy(header, 0);
    header.writeUInt32BE(this.sections.size, 8);

    const chunks = [header];
    let serializedSize = header.length;
    let aggregateRawLength = 0;

    for (const [name, entry] of this.sections.entries()) {
      const nameBuf = Buffer.from(name, 'utf8');
      if (nameBuf.length === 0 || nameBuf.length > 0xffff) {
        throw new Error('Section name length is outside the archive format limits');
      }
      const meta = Buffer.alloc(2 + nameBuf.length + 4 + 4 + 4);
      meta.writeUInt16BE(nameBuf.length, 0);
      nameBuf.copy(meta, 2);

      const offset = 2 + nameBuf.length;
      meta.writeUInt32BE(entry.rawLength, offset);
      meta.writeUInt32BE(entry.compressed.length, offset + 4);
      meta.writeUInt32BE(entry.crc, offset + 8);

      aggregateRawLength += entry.rawLength;
      serializedSize += meta.length + entry.compressed.length;
      if (aggregateRawLength > MAX_ARCHIVE_SIZE_BYTES) {
        throw new Error(`Archive exceeds the maximum aggregate uncompressed size of ${MAX_ARCHIVE_SIZE_BYTES}`);
      }
      if (serializedSize > MAX_ARCHIVE_SIZE_BYTES) {
        throw new Error(`Archive exceeds the maximum serialized size of ${MAX_ARCHIVE_SIZE_BYTES}`);
      }
      chunks.push(meta);
      chunks.push(entry.compressed);
    }

    return Buffer.concat(chunks);
  }

  static loadFromBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
      throw new Error('Invalid archive: buffer is too small');
    }
    if (buffer.length > MAX_ARCHIVE_SIZE_BYTES) {
      throw new Error(`Archive exceeds the maximum serialized size of ${MAX_ARCHIVE_SIZE_BYTES}`);
    }

    // Check v2 magic header
    if (buffer.subarray(0, 8).equals(MAGIC_BYTES_V2)) {
      return OmniArchiveV2.loadFromBuffer(buffer);
    }

    // Verify v1 magic header
    if (!buffer.subarray(0, 8).equals(MAGIC_BYTES_V1)) {
      throw new Error("Invalid archive format: missing 'OMNIENG\x01' or 'OMNIENG\x02' magic header");
    }

    const sectionCount = buffer.readUInt32BE(8);
    if (sectionCount > MAX_ARCHIVE_SECTION_COUNT) {
      throw new Error(`Malformed archive: section count exceeds maximum ${MAX_ARCHIVE_SECTION_COUNT}`);
    }
    if (sectionCount > Math.floor((buffer.length - 12) / 14)) {
      throw new Error('Malformed archive: section count exceeds the available data');
    }

    const archive = new OmniArchive();
    archive.sections.clear();

    let offset = 12;
    let aggregateRawLength = 0;

    for (let i = 0; i < sectionCount; i++) {
      if (offset + 2 > buffer.length) throw new Error('Malformed archive: unexpected EOF in section header');
      const nameLen = buffer.readUInt16BE(offset);
      offset += 2;

      if (nameLen === 0) throw new Error('Malformed archive: section name must not be empty');
      if (offset + nameLen > buffer.length) throw new Error('Malformed archive: unexpected EOF in section name');
      const nameBytes = buffer.subarray(offset, offset + nameLen);
      const name = nameBytes.toString('utf8');
      if (name.trim().length === 0 || !Buffer.from(name, 'utf8').equals(nameBytes)) {
        throw new Error('Malformed archive: section name is empty or invalid UTF-8');
      }
      if (archive.sections.has(name)) {
        throw new Error(`Malformed archive: duplicate section '${name}'`);
      }
      offset += nameLen;

      if (offset + 12 > buffer.length) throw new Error('Malformed archive: unexpected EOF in section metadata');
      const rawLength = buffer.readUInt32BE(offset);
      const compLength = buffer.readUInt32BE(offset + 4);
      const crc = buffer.readUInt32BE(offset + 8);
      offset += 12;

      aggregateRawLength += rawLength;
      if (aggregateRawLength > MAX_ARCHIVE_SIZE_BYTES) {
        throw new Error(`Archive exceeds the maximum aggregate uncompressed size of ${MAX_ARCHIVE_SIZE_BYTES}`);
      }
      if (rawLength > MAX_UNCOMPRESSED_SECTION_SIZE) {
        throw new Error(
          `Security Violation: Section '${name}' uncompressed size (${rawLength} bytes) exceeds maximum ${MAX_UNCOMPRESSED_SECTION_SIZE}`
        );
      }
      if (compLength === 0) throw new Error(`Malformed archive: section '${name}' has an empty compressed payload`);
      if (rawLength > 1024 * 1024 && rawLength / compLength > MAX_EXPANSION_RATIO) {
        throw new Error(`Security Violation: Decompression bomb detected on section '${name}'`);
      }
      if (offset + compLength > buffer.length) throw new Error('Malformed archive: unexpected EOF in section payload');
      const compressed = buffer.subarray(offset, offset + compLength);
      offset += compLength;

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

    if (offset !== buffer.length) {
      throw new Error('Malformed archive: unexpected trailing bytes');
    }

    const manifest = archive.getSection('manifest', true) || archive.getSection('manifest.json', true);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('Malformed archive: required project manifest is missing or invalid');
    }
    if (manifest.schemaVersion !== CURRENT_SCHEMA_VERSION_V1 && manifest.schemaVersion !== CURRENT_SCHEMA_VERSION_V2) {
      throw new Error(`Unsupported archive schema version: ${manifest.schemaVersion}`);
    }
    archive.manifest = manifest;

    return archive;
  }

  saveToFile(filePath) {
    const buf = this.saveToBuffer();
    saveAtomicSync(filePath, buf, true);
    return { filePath, sizeBytes: buf.length, sectionCount: this.sections.size };
  }

  static loadFromFile(filePath) {
    let fileDescriptor;
    try {
      fileDescriptor = fs.openSync(filePath, 'r');
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Archive file not found: ${filePath}`);
      throw error;
    }

    try {
      const initialStat = fs.fstatSync(fileDescriptor);
      if (!initialStat.isFile()) throw new Error('Archive path must identify a regular file');
      if (initialStat.size > MAX_ARCHIVE_SIZE_BYTES) {
        throw new Error(`Archive exceeds the maximum serialized size of ${MAX_ARCHIVE_SIZE_BYTES}`);
      }

      const buffer = Buffer.allocUnsafe(initialStat.size);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const readCount = fs.readSync(fileDescriptor, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (readCount === 0) throw new Error('Archive file changed while it was being read');
        bytesRead += readCount;
      }

      const finalStat = fs.fstatSync(fileDescriptor);
      if (finalStat.size !== initialStat.size) throw new Error('Archive file changed while it was being read');
      return OmniArchive.loadFromBuffer(buffer);
    } finally {
      fs.closeSync(fileDescriptor);
    }
  }

  saveToEncryptedBuffer(password) {
    if (!password || typeof password !== 'string' || password.length < 4) {
      throw new Error('Encryption Error: Password must be at least 4 characters long');
    }
    const plaintext = this.saveToBuffer();
    return OmniVaultAES256.encrypt(plaintext, password);
  }

  static loadFromEncryptedBuffer(encryptedBuffer, password) {
    if (!password || typeof password !== 'string') {
      throw new Error('Decryption Error: Password must be provided');
    }
    const decrypted = OmniVaultAES256.decrypt(encryptedBuffer, password);
    return OmniArchive.loadFromBuffer(decrypted);
  }
}

/**
 * OmniArchiveV2: Production content-addressed engineering archive (.omni v2)
 *
 * Implements:
 * - Versioned manifest (schemaVersion: '2.0.0')
 * - Content-addressed blobs (SHA-256)
 * - Atomic saves with temp file, fsync, and atomic rename
 * - Crash recovery journal
 * - Full v1 -> v2 migration
 */
class OmniArchiveV2 {
  /**
   * @param {object} [metadata={}]
   * @param {ProjectManifestV2} [metadata.manifest]
   */
  constructor(metadata = {}) {
    if (metadata.manifest instanceof ProjectManifestV2) {
      this.manifest = metadata.manifest;
    } else {
      this.manifest = new ProjectManifestV2({
        name: metadata.projectName || 'Untitled Project',
        activeUnits: metadata.activeUnits || 'SI_MM'
      });
    }

    this.blobs = new Map(); // [sha256] -> Buffer
    this.journal = new CommandJournal();
    this.results = []; // JobResult summaries
    this.signatures = [];
  }

  /**
   * Adds content-addressed blob to archive.
   * @param {Buffer|string|object} content
   * @param {object} [options={}]
   * @returns {ArtifactRef}
   */
  addBlob(content, options = {}) {
    let buf;
    if (Buffer.isBuffer(content)) buf = content;
    else if (typeof content === 'string') buf = Buffer.from(content, 'utf8');
    else buf = Buffer.from(JSON.stringify(content), 'utf8');

    const artifactRef = ArtifactRef.fromContent(buf, {
      mimeType: options.mimeType || 'application/octet-stream',
      name: options.name || '',
      retention: options.retention || RetentionPolicy.PERSISTENT
    });

    this.blobs.set(artifactRef.hash, buf);

    // Update manifest blobs table
    const updatedBlobs = { ...this.manifest.blobs, [artifactRef.hash]: artifactRef.toJSON() };
    this.manifest = this.manifest.withIncrementedRevision({ blobs: updatedBlobs });
    return artifactRef;
  }

  /**
   * Retrieves blob content by SHA-256 hash.
   * @param {string} hash
   * @param {boolean} [asJson=false]
   * @returns {Buffer|object|string|null}
   */
  getBlob(hash, asJson = false) {
    const norm = String(hash).toLowerCase();
    const buf = this.blobs.get(norm);
    if (!buf) return null;
    if (asJson) {
      try {
        return JSON.parse(buf.toString('utf8'));
      } catch (_) {
        return buf.toString('utf8');
      }
    }
    return buf;
  }

  hasBlob(hash) {
    return this.blobs.has(String(hash).toLowerCase());
  }

  listBlobs() {
    return Array.from(this.blobs.keys());
  }

  /**
   * Records a JobResult in the project record.
   * @param {import('../contracts/JobResult').JobResult} jobResult
   */
  recordResult(jobResult) {
    this.results.push(jobResult.toJSON());
    this.manifest = this.manifest.withIncrementedRevision({ results: this.results });
  }

  /**
   * Serializes v2 archive into binary Buffer.
   * Format:
   * [8B MAGIC: OMNIENG\x02]
   * [4B uint32: total section count]
   * Section 0: 'manifest.json'
   * Section 1: 'journal.json'
   * Section 2: 'results.json'
   * Section 3..N: 'blobs/<sha256>'
   * @returns {Buffer}
   */
  saveToBuffer() {
    const archive = new OmniArchive({ projectName: this.manifest.name });
    archive.sections.clear();

    // 1. Manifest
    archive.addSection('manifest.json', this.manifest.toJSON());

    // 2. Journal
    archive.addSection('journal.json', this.journal.export());

    // 3. Results
    archive.addSection('results.json', this.results);

    // 4. Blobs
    for (const [hash, buf] of this.blobs.entries()) {
      archive.addSection(`blobs/${hash}`, buf);
    }

    // Generate v1 container then replace magic bytes with v2
    const v1Buf = archive.saveToBuffer();
    const v2Buf = Buffer.from(v1Buf);
    MAGIC_BYTES_V2.copy(v2Buf, 0);
    return v2Buf;
  }

  /**
   * Unpacks v2 archive from Buffer.
   * @param {Buffer} buffer
   * @returns {OmniArchiveV2}
   */
  static loadFromBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Invalid archive: buffer is too small');
    }
    if (!buffer.subarray(0, 8).equals(MAGIC_BYTES_V2)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, "Missing 'OMNIENG\x02' magic header for v2 archive");
    }

    // Convert magic to v1 temporarily to unpack sections using safe unpacker
    const tempBuf = Buffer.from(buffer);
    MAGIC_BYTES_V1.copy(tempBuf, 0);

    const underlying = OmniArchive.loadFromBuffer(tempBuf);
    const manifestJson = underlying.getSection('manifest.json', true);
    if (!manifestJson || manifestJson.schemaVersion !== CURRENT_SCHEMA_VERSION_V2) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Invalid v2 archive: missing schemaVersion 2.0.0 manifest');
    }

    const v2 = new OmniArchiveV2({ manifest: ProjectManifestV2.fromJSON(manifestJson) });

    // Journal
    if (underlying.hasSection('journal.json')) {
      const journalData = underlying.getSection('journal.json', true);
      v2.journal.import(journalData);
    }

    // Results
    if (underlying.hasSection('results.json')) {
      v2.results = underlying.getSection('results.json', true) || [];
    }

    // Blobs
    for (const name of underlying.listSections()) {
      if (name.startsWith('blobs/')) {
        const hash = name.slice(6);
        const blobBuf = underlying.getSection(name, false);
        v2.blobs.set(hash, blobBuf);
      }
    }

    return v2;
  }

  /**
   * Saves archive atomically with fsync and rename.
   * @param {string} filePath
   * @returns {{ filePath: string, sizeBytes: number, blobCount: number }}
   */
  saveToFile(filePath) {
    const buf = this.saveToBuffer();
    saveAtomicSync(filePath, buf, true);

    // Clean up recovery journal upon acknowledged atomic save
    const recoveryPath = `${filePath}.recovery.journal`;
    if (fs.existsSync(recoveryPath)) {
      try {
        fs.unlinkSync(recoveryPath);
      } catch (_) {}
    }

    return { filePath, sizeBytes: buf.length, blobCount: this.blobs.size };
  }

  /**
   * Loads v2 archive from file.
   * @param {string} filePath
   * @returns {OmniArchiveV2}
   */
  static loadFromFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Archive file not found: ${filePath}`);
    }
    const buf = fs.readFileSync(filePath);
    if (buf.subarray(0, 8).equals(MAGIC_BYTES_V1)) {
      // Automatic transparent migration from v1
      const v1 = OmniArchive.loadFromBuffer(buf);
      return OmniArchiveV2.fromV1(v1);
    }
    return OmniArchiveV2.loadFromBuffer(buf);
  }

  /**
   * Appends an acknowledged command to the disk recovery journal before mutation.
   * Allows atomic recovery after unexpected power loss or process kill.
   * @param {string} projectFilePath
   * @param {object} commandEntry
   */
  static recordAcknowledgedCommandSync(projectFilePath, commandEntry) {
    const recoveryPath = `${projectFilePath}.recovery.journal`;
    const line = JSON.stringify({ ...commandEntry, loggedAt: new Date().toISOString() }) + '\n';
    fs.appendFileSync(recoveryPath, line, 'utf8');
  }

  /**
   * Inspects and recovers uncommitted commands from recovery journal after crash.
   * @param {string} projectFilePath
   * @returns {{ recoveredCount: number, commands: object[] }}
   */
  static recoverFromCrash(projectFilePath) {
    const recoveryPath = `${projectFilePath}.recovery.journal`;
    if (!fs.existsSync(recoveryPath)) {
      return { recoveredCount: 0, commands: [] };
    }

    const raw = fs.readFileSync(recoveryPath, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const commands = [];
    for (const l of lines) {
      try {
        commands.push(JSON.parse(l));
      } catch (_) {}
    }
    return { recoveredCount: commands.length, commands };
  }

  /**
   * Migrates a v1 OmniArchive instance to v2 format.
   * @param {OmniArchive} v1Archive
   * @returns {OmniArchiveV2}
   */
  static fromV1(v1Archive) {
    if (!(v1Archive instanceof OmniArchive)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'fromV1 requires an OmniArchive instance');
    }

    const v1Manifest = v1Archive.getSection('manifest', true) || {};
    const v2Manifest = new ProjectManifestV2({
      name: v1Manifest.projectName || 'Migrated v1 Project',
      activeUnits: v1Manifest.unitsSystem === 'US_CUSTOMARY' ? 'US_CUSTOMARY' : 'SI_MM'
    });

    const v2 = new OmniArchiveV2({ manifest: v2Manifest });

    for (const secName of v1Archive.listSections()) {
      if (secName === 'manifest') continue;
      const content = v1Archive.getSection(secName, false);
      v2.addBlob(content, { name: secName, mimeType: 'application/octet-stream' });
    }

    return v2;
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

/**
 * Password-derived AES-256-GCM encryption helper.
 */
class OmniVaultAES256 {
  static encrypt(plaintextBuffer, password) {
    const salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
    const tag = cipher.getAuthTag();

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

module.exports = {
  OmniArchive,
  OmniArchiveV2,
  CommandJournal,
  OmniVaultAES256,
  calculateCRC32,
  saveAtomicSync,
  MAGIC_BYTES,
  MAGIC_BYTES_V1,
  MAGIC_BYTES_V2,
  VAULT_MAGIC_BYTES,
  MAX_UNCOMPRESSED_SECTION_SIZE,
  MAX_ARCHIVE_SIZE_BYTES,
  MAX_EXPANSION_RATIO
};
