/**
 * OmniEng Universal Engineering Archive (.omni) & Command History Journal
 *
 * Implements:
 * - v1 Legacy single-file container (MAGIC: OMNIENG\x01)
 *  - v2 Content-addressed atomic archive (MAGIC: OMNIENG\x02)
 *  - v3 write-ahead log (WAL) journal.wal: [seq, op, payloadDigest, crc32]
 *    with fsync-batched commit markers and replay-on-open recovery
 *  - Atomic saves with fsync and safe rename
 *  - Crash recovery journal & automatic recovery
 *  - v1 to v2 migration
 *  - Non-linear undo/redo CommandHistoryJournal
 *  - AES-256-GCM encrypted vault
 *  - v3 streaming container (MAGIC: OMNIENG\x03): chunked, out-of-core
 *    read/write with per-chunk sha256, trailer index, and byte-range entry
 *    streams (memory bounded regardless of archive size)
 *  */

'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');
const { ProjectManifestV2 } = require('../contracts/ProjectManifestV2');
const { ArtifactRef, RetentionPolicy } = require('../contracts/ArtifactRef');
const { JobResult } = require('../contracts/JobResult');

const MAGIC_BYTES_V1 = Buffer.from('OMNIENG\x01', 'binary'); // 8-byte magic header v1
const MAGIC_BYTES_V2 = Buffer.from('OMNIENG\x02', 'binary'); // 8-byte magic header v2
const MAGIC_BYTES = MAGIC_BYTES_V1; // Compatibility default
const VAULT_MAGIC_BYTES = Buffer.from('OMNIVAUL', 'utf8'); // 8-byte encrypted vault header
const CURRENT_SCHEMA_VERSION_V1 = 1;
const CURRENT_SCHEMA_VERSION_V2 = '2.0.0';

// v3 streaming container constants (MAGIC: OMNIENG\x03). Layout:
//   [8B magic "OMNIENG\x03"]
//   [4B u32 version=1]
//   [4B u32 flags]             bit0 = per-chunk deflate compression
//   [4B u32 chunkSize]
//   [8B u64 reserved]
//   per entry:
//     [4B u32 nameLen][name UTF-8]
//     chunk frames: [8B u64 storedLen][stored bytes][32B sha256(stored)]
//   trailer:
//     [4B u32 entryCount]
//     per entry: [4B u32 nameLen][name][8B u64 entryOffset][8B u64 entryLength]
//                [8B u64 rawLength][8B u64 chunkCount][32B entrySha256(raw)]
//     [8B u64 trailerOffset][8B "OMNITR\x00\x00"]
const MAGIC_BYTES_V3 = Buffer.from('OMNIENG\x03', 'binary');
const TRAILER_MAGIC = Buffer.from('OMNITR\x00\x00', 'binary');
const STREAMING_FORMAT_VERSION = 1;
const STREAMING_FLAG_COMPRESSED = 0x1;
const DEFAULT_CHUNK_SIZE = 1024 * 1024; // 1 MiB
const MIN_CHUNK_SIZE = 64 * 1024;
const MAX_CHUNK_SIZE = 64 * 1024 * 1024;

// Resource limits
const MAX_ARCHIVE_SECTION_COUNT = 4096;
const MAX_ARCHIVE_SIZE_BYTES = 512 * 1024 * 1024; // 512 MiB
const MAX_UNCOMPRESSED_SECTION_SIZE = 500 * 1024 * 1024; // 500 MB
const MAX_EXPANSION_RATIO = 50;

// v3 write-ahead log (WAL) constants. The WAL file lives beside the archive as
// "journal.wal". Each record is a JSON array on its own line:
//   [seq, op, payloadDigest, crc32]
// where `op` is a stringified operation descriptor ({"op":..., "payload":...}),
// `payloadDigest` is the SHA-256 of that descriptor (node:crypto), and crc32 is
// a genuine CRC-32 over the canonical [seq, op, payloadDigest] serialization.
// A COMMIT marker is [seq, "COMMIT", null, crc32] where seq is the sequence of
// the last data entry it makes durable. On replay, only entries up to the last
// valid COMMIT marker are applied; any valid-but-uncommitted tail and any torn
// partial append are discarded.
const WAL_MAGIC = 'OMNIWAL';
const WAL_VERSION = 3;
const WAL_FORMAT = 0;
const WAL_FILE_NAME = 'journal.wal';

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
 * OmniWal: v3 write-ahead log beside an .omni archive.
 *
 * File layout (append-only):
 *   ["OMNIWAL",3,0,"/abs/path/archive.omni"]
 *   [1,"{\"op\":\"add_blob\",\"payload\":{...}}","<sha256>",<crc32>]
 *   [1,"COMMIT",null,<crc32>]
 *   ...
 *
 * Entries are batched in memory and persisted on flush()/commit(). commit()
 * writes the pending entries, then a COMMIT marker, then fsyncs the file
 * (fsync-batched durability). On open, any uncommitted tail or torn partial
 * append is compacted away so the file always starts from a clean committed
 * prefix.
 */
class OmniWal {
  constructor({ path: walPath, archivePath }) {
    this.path = walPath;
    this.archivePath = path.resolve(archivePath);
    this.fd = null;
    this._offset = 0; // explicit byte offset for append writes
    this.seq = 1; // next data sequence number to assign
    this.committed = 0; // highest data sequence made durable by a COMMIT marker
    this.pending = 0; // entries batched in memory but not yet committed
    this.recovered = false; // true if open() discarded a torn/tail remnant
    this._lines = [];
  }

  static derivePath(archivePath) {
    return path.join(path.dirname(archivePath), WAL_FILE_NAME);
  }

  static encodeLine(seq, opText, digest) {
    return JSON.stringify([
      seq,
      opText,
      digest,
      calculateCRC32(Buffer.from(JSON.stringify([seq, opText, digest]), 'utf8'))
    ]);
  }

  static encodeHeader(archivePath) {
    return JSON.stringify([WAL_MAGIC, WAL_VERSION, WAL_FORMAT, path.resolve(archivePath)]);
  }

  open() {
    const dir = path.dirname(this.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.path)) {
      this.fd = fs.openSync(this.path, 'a');
      this._offset = 0;
      this._writeHeader();
      return this;
    }
    const parsed = parseWalFile(this.path, this.archivePath);
    if (!parsed.applicable) {
      throw new OmniError(
        OmniErrorCode.UNSUPPORTED,
        `WAL file ${this.path} exists but is not a matching v3 journal for archive ${this.archivePath}`
      );
    }
    if (parsed.torn || parsed.maxValidSeq > parsed.lastCommit) {
      this._rewriteClean(parsed);
    } else {
      this.fd = fs.openSync(this.path, 'a');
      this._offset = fs.fstatSync(this.fd).size;
    }
    this.seq = parsed.maxValidSeq + 1;
    this.committed = parsed.lastCommit;
    this.recovered = parsed.torn;
    this.pending = 0;
    this._lines = [];
    return this;
  }

  _writeHeader() {
    const header = OmniWal.encodeHeader(this.archivePath) + '\n';
    fs.writeSync(this.fd, header, 0, header.length, this._offset);
    this._offset += header.length;
    fs.fsyncSync(this.fd);
  }

  _rewriteClean(parsed) {
    this.close();
    const kept = parsed.records.filter((r) => r.seq <= parsed.lastCommit);
    const content = OmniWal.encodeHeader(this.archivePath) + '\n' + kept.map((r) => r.raw).join('\n') + '\n';
    const tmp = `${this.path}.compact.tmp.${process.pid}.${crypto.randomUUID()}`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, content, 0, content.length, 0);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.path);
    this.fd = fs.openSync(this.path, 'a');
    this._offset = fs.fstatSync(this.fd).size;
  }

  appendEntry(op, payload) {
    if (this.fd === null) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'WAL is not open; call enableWal() first');
    }
    if (typeof op !== 'string' || !op.trim()) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'WAL op must be a non-empty string');
    }
    const opText = JSON.stringify({ op, payload: payload === undefined ? null : payload });
    const digest = crypto.createHash('sha256').update(opText, 'utf8').digest('hex');
    const seq = this.seq++;
    const line = OmniWal.encodeLine(seq, opText, digest);
    this._lines.push(line);
    this.pending++;
    return { seq, op, digest, pending: this.pending };
  }

  flush() {
    if (this._lines.length === 0) return this.stats();
    const buf = Buffer.concat(this._lines.map((l) => Buffer.from(l + '\n', 'utf8')));
    fs.writeSync(this.fd, buf, 0, buf.length, this._offset);
    this._offset += buf.length;
    this._lines = [];
    return this.stats();
  }

  commit() {
    if (this.pending === 0) return this.stats();
    const buf = Buffer.concat(this._lines.map((l) => Buffer.from(l + '\n', 'utf8')));
    const commitSeq = this.seq - 1;
    const commitLine = OmniWal.encodeLine(commitSeq, 'COMMIT', null) + '\n';
    const commitBuf = Buffer.from(commitLine, 'utf8');
    fs.writeSync(this.fd, buf, 0, buf.length, this._offset);
    this._offset += buf.length;
    fs.writeSync(this.fd, commitBuf, 0, commitBuf.length, this._offset);
    this._offset += commitBuf.length;
    fs.fsyncSync(this.fd);
    this.committed = commitSeq;
    this.pending = 0;
    this._lines = [];
    return this.stats();
  }

  rebase() {
    this.close();
    const dir = path.dirname(this.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = OmniWal.encodeHeader(this.archivePath) + '\n';
    const tmp = `${this.path}.rebase.tmp.${process.pid}.${crypto.randomUUID()}`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, content, 0, content.length, 0);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.path);
    this.fd = fs.openSync(this.path, 'a');
    this._offset = fs.fstatSync(this.fd).size;
    this.seq = 1;
    this.committed = 0;
    this.pending = 0;
    this.recovered = false;
    this._lines = [];
    return this.stats();
  }

  close() {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch (_) {}
      this.fd = null;
    }
  }

  stats() {
    return {
      path: this.path,
      seq: this.seq,
      committed: this.committed,
      recovered: this.recovered,
      pending: this.pending
    };
  }
}

/**
 * Parses a WAL file into valid records. Returns:
 * {
 *   applicable, torn, maxValidSeq, lastCommit,
 *   records: [{seq, op, digest, raw}],   // valid complete lines, in order
 * }
 * Any parse failure, CRC mismatch, or out-of-order sequence stops the scan at
 * that line; everything from that point onward is treated as a torn tail.
 */
function parseWalFile(walPath, expectedArchivePath) {
  const result = {
    applicable: false,
    torn: false,
    maxValidSeq: 0,
    lastCommit: 0,
    records: []
  };
  let raw;
  try {
    raw = fs.readFileSync(walPath, 'utf8');
  } catch {
    return result;
  }
  const lines = raw.split('\n');
  if (lines.length === 0 || lines[0].trim() === '') return result;
  let header;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    return result;
  }
  if (
    !Array.isArray(header) ||
    header.length !== 4 ||
    header[0] !== WAL_MAGIC ||
    header[1] !== WAL_VERSION ||
    header[2] !== WAL_FORMAT ||
    path.resolve(String(header[3])) !== path.resolve(expectedArchivePath)
  ) {
    return result;
  }
  result.applicable = true;
  let prevSeq = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    let arr;
    try {
      arr = JSON.parse(line);
    } catch {
      result.torn = true;
      break;
    }
    if (!Array.isArray(arr) || arr.length !== 4 || typeof arr[3] !== 'number') {
      result.torn = true;
      break;
    }
    const [seq, op, digest, crc] = arr;
    const expectedCrc = calculateCRC32(Buffer.from(JSON.stringify([seq, op, digest]), 'utf8'));
    if (expectedCrc !== crc) {
      result.torn = true;
      break;
    }
    const isCommit = op === 'COMMIT';
    // Data entries must continue the strictly increasing sequence; a COMMIT
    // marker reuses the seq of the last data entry it makes durable.
    if (!Number.isInteger(seq) || seq < 1 || seq !== (isCommit ? prevSeq : prevSeq + 1)) {
      result.torn = true;
      break;
    }
    prevSeq = seq;
    result.maxValidSeq = seq;
    if (isCommit) {
      if (digest !== null) {
        result.torn = true;
        break;
      }
      result.lastCommit = seq;
    } else if (typeof op === 'string' && /^[a-f0-9]{64}$/.test(digest)) {
      result.records.push({ seq, op, digest, raw: line });
    } else {
      result.torn = true;
      break;
    }
  }
  return result;
}

/**
 * Applies a single committed WAL operation to an archive during replay.
 * The descriptor digest is re-verified against the stored payloadDigest.
 */
function applyWalOp(archive, opText, digest) {
  let desc;
  try {
    desc = JSON.parse(opText);
  } catch {
    throw new Error('WAL op descriptor is not valid JSON');
  }
  if (!desc || typeof desc !== 'object' || typeof desc.op !== 'string') {
    throw new Error('Malformed WAL op descriptor');
  }
  const actualDigest = crypto.createHash('sha256').update(opText, 'utf8').digest('hex');
  if (actualDigest !== digest) {
    throw new Error('WAL payload digest mismatch');
  }
  const payload = desc.payload === null || desc.payload === undefined ? {} : desc.payload;
  switch (desc.op) {
    case 'add_blob': {
      if (typeof payload.dataBase64 !== 'string') {
        throw new Error('add_blob WAL op requires payload.dataBase64');
      }
      archive.addBlob(Buffer.from(payload.dataBase64, 'base64'), {
        mimeType: payload.mimeType || 'application/octet-stream',
        name: payload.name || '',
        retention: payload.retention
      });
      break;
    }
    case 'record_result': {
      archive.recordResult(JobResult.fromJSON(payload.result));
      break;
    }
    case 'journal_execute': {
      archive.journal.execute(
        payload.actionType,
        payload.forwardPatch || {},
        payload.reversePatch || {},
        payload.description || '',
        payload.author || 'user'
      );
      break;
    }
    case 'bump_revision': {
      archive.bumpRevision(payload.changes || {});
      break;
    }
    default:
      throw new Error(`Unknown WAL op "${desc.op}"`);
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
        name: metadata.projectName || metadata.name || 'Untitled Project',
        author: metadata.author || 'OmniEng_Engineer',
        engineeringDomain: metadata.engineeringDomain || 'universal',
        activeUnits: metadata.activeUnits || 'SI_MM'
      });
    }

    this.blobs = new Map(); // [sha256] -> Buffer
    this.journal = new CommandJournal();
    this.results = []; // JobResult summaries
    this.signatures = [];
    this._wal = null; // OmniWal instance when WAL enabled
    this._walArchivePath = null; // archive path used to derive/verify the WAL
    this._walState = { path: null, seq: 0, committed: 0, recovered: false, pending: 0 };
  }

  /**
   * Increments archive manifest revision.
   * @param {object} [changes]
   * @returns {number} New revision
   */
  bumpRevision(changes = {}) {
    this.manifest = this.manifest.withIncrementedRevision(changes);
    return this.manifest.revision;
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
    this._walArchivePath = path.resolve(filePath);

    // The atomic snapshot now contains every committed WAL operation; rebase
    // the WAL so it starts fresh from the snapshot (uncommitted tail dropped).
    if (this._wal) {
      try {
        this._wal.rebase();
      } catch (_) {}
    }

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
   * Alias for saveToFile.
   * @param {string} filePath
   * @returns {{ filePath: string, sizeBytes: number, blobCount: number }}
   */
  saveAtomicSync(filePath) {
    return this.saveToFile(filePath);
  }

  /**
   * Saves the archive as a v3 streaming container (chunked, out-of-core).
   * Manifest/journal/results are written as small entries; blobs are streamed
   * as chunked entries. Integrity is verified per chunk and per whole entry on
   * read. The legacy buffer-based saveToFile() remains available.
   * @param {string} filePath
   * @param {object} [options] - Passed through to OmniArchiveV3.writeChunks
   * @returns {Promise<{filePath: string, sizeBytes: number, blobCount: number, streamed: boolean}>}
   */
  async saveToFileStreaming(filePath, options = {}) {
    const entries = [
      { name: 'manifest.json', stream: Buffer.from(JSON.stringify(this.manifest.toJSON()), 'utf8') },
      { name: 'journal.json', stream: Buffer.from(JSON.stringify(this.journal.export()), 'utf8') },
      { name: 'results.json', stream: Buffer.from(JSON.stringify(this.results), 'utf8') }
    ];
    for (const [hash, buf] of this.blobs.entries()) {
      entries.push({ name: `blobs/${hash}`, stream: buf });
    }
    const ws = fs.createWriteStream(filePath);
    try {
      const res = await OmniArchiveV3.writeChunks(ws, entries, options);
      await new Promise((resolve, reject) => {
        ws.on('error', reject);
        ws.end(resolve);
      });
      return { filePath, sizeBytes: res.fileSize, blobCount: this.blobs.size, streamed: true };
    } catch (err) {
      ws.destroy();
      throw err;
    }
  }

  /**
   * Loads a v3 streaming archive into a fully in-memory OmniArchiveV2 using
   * the integrity-checked streaming entry reader (suited to small archives).
   * @param {string} filePath
   * @returns {OmniArchiveV2}
   */
  static loadFromFileStreaming(filePath) {
    return OmniArchiveV3.loadArchiveSync(filePath);
  }

  /**
   * Loads v2 archive from file. When a "journal.wal" write-ahead log exists
   * beside the archive, committed WAL operations are replayed on top of the
   * on-disk snapshot and any uncommitted/torn tail is discarded. Recovery
   * details are available via archive.getWalStats().
   * @param {string} filePath
   * @param {object} [options={}]
   * @param {string} [options.walPath] - Override WAL file location
   * @returns {OmniArchiveV2}
   */
  static loadFromFile(filePath, options = {}) {
    if (!fs.existsSync(filePath)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Archive file not found: ${filePath}`);
    }
    const probe = Buffer.alloc(8);
    const probeFd = fs.openSync(filePath, 'r');
    try {
      const n = fs.readSync(probeFd, probe, 0, 8, 0);
      if (n === 8 && probe.equals(MAGIC_BYTES_V3)) {
        return OmniArchiveV3.loadArchiveSync(filePath);
      }
    } finally {
      fs.closeSync(probeFd);
    }
    const buf = fs.readFileSync(filePath);
    let archive;
    if (buf.subarray(0, 8).equals(MAGIC_BYTES_V1)) {
      // Automatic transparent migration from v1
      const v1 = OmniArchive.loadFromBuffer(buf);
      archive = OmniArchiveV2.fromV1(v1);
    } else {
      archive = OmniArchiveV2.loadFromBuffer(buf);
    }
    archive._walArchivePath = path.resolve(filePath);
    archive._walState = OmniArchiveV2.replayWal(filePath, archive, options);
    return archive;
  }

  /**
   * Replays a WAL file onto a loaded archive: applies committed ops after the
   * last snapshot, discards the uncommitted tail, and reports recovery stats.
   * @param {string} filePath
   * @param {OmniArchiveV2} archive
   * @param {object} [options={}]
   * @returns {object} { path, seq, committed, recovered, pending, applicable, applied, discarded, skipped }
   */
  static replayWal(filePath, archive, options = {}) {
    const walPath = options.walPath || OmniWal.derivePath(filePath);
    const base = { path: walPath, seq: 1, committed: 0, recovered: false, pending: 0, applicable: false };
    if (!fs.existsSync(walPath)) return base;

    const parsed = parseWalFile(walPath, filePath);
    if (!parsed.applicable) return base;

    const applied = [];
    const skipped = [];
    for (const record of parsed.records) {
      if (record.seq > parsed.lastCommit) continue; // uncommitted tail
      try {
        applyWalOp(archive, record.op, record.digest);
        applied.push(record.seq);
      } catch (err) {
        skipped.push({ seq: record.seq, error: err.message });
      }
    }
    const discarded = parsed.records.filter((r) => r.seq > parsed.lastCommit).length;
    const recovered = parsed.torn || applied.length > 0 || discarded > 0;

    return {
      path: walPath,
      seq: parsed.maxValidSeq + 1,
      committed: parsed.lastCommit,
      recovered,
      pending: 0,
      applicable: true,
      applied: applied.length,
      discarded,
      skipped,
      torn: parsed.torn
    };
  }

  /**
   * Enables the v3 WAL for this archive. Creates (or reopens) the append-only
   * "journal.wal" beside the archive file and compact-repairs any uncommitted
   * tail left by a previous crash.
   * @param {object} [options={}]
   * @param {string} [options.path] - WAL path (defaults to journal.wal beside the archive)
   * @param {string} [options.archivePath] - Archive identity used in the WAL header
   * @returns {object} getWalStats() snapshot
   */
  enableWal(options = {}) {
    const archivePath = options.archivePath || this._walArchivePath;
    let walPath = options.path;
    if (!walPath) {
      if (!archivePath) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          'WAL path is required until the archive has been saved to a file (call saveToFile first or pass options.path)'
        );
      }
      walPath = OmniWal.derivePath(archivePath);
    }
    if (this._wal) {
      if (path.resolve(this._wal.path) === path.resolve(walPath)) {
        return this.getWalStats();
      }
      this.disableWal();
    }
    this._wal = new OmniWal({ path: walPath, archivePath: archivePath || walPath });
    this._wal.open();
    this._walState = this._wal.stats();
    return this._walState;
  }

  /**
   * Batches an operation entry into the WAL (not yet durable). Use
   * commitTransaction() to persist the batch with a COMMIT marker + fsync.
   * @param {string} op - Operation name (add_blob, record_result, journal_execute, bump_revision)
   * @param {*} payload - Serializable operation payload
   * @returns {object} { seq, op, digest, pending }
   */
  appendWalEntry(op, payload) {
    if (!this._wal) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'WAL is not enabled; call enableWal() first');
    }
    const entry = this._wal.appendEntry(op, payload);
    this._walState = this._wal.stats();
    return entry;
  }

  /**
   * Alias for appendWalEntry.
   */
  logWalOp(op, payload) {
    return this.appendWalEntry(op, payload);
  }

  /**
   * Writes batched WAL entries to disk without a COMMIT marker (no fsync).
   * commitTransaction() is the durability point.
   * @returns {object} getWalStats() snapshot
   */
  flushWal() {
    if (!this._wal) return this.getWalStats();
    this._walState = this._wal.flush();
    return this._walState;
  }

  /**
   * Commits the batched WAL transaction: writes pending entries, then a COMMIT
   * marker carrying the last entry sequence, then fsyncs the WAL file.
   * @returns {object} getWalStats() snapshot
   */
  commitTransaction() {
    if (!this._wal) {
      return { path: null, seq: 0, committed: 0, recovered: false, pending: 0, wal: false };
    }
    this._walState = this._wal.commit();
    return { ...this._walState, wal: true };
  }

  /**
   * Closes and detaches the WAL.
   * @returns {object} getWalStats() snapshot
   */
  disableWal() {
    if (this._wal) {
      this._wal.close();
      this._wal = null;
    }
    this._walState = { path: null, seq: 0, committed: 0, recovered: false, pending: 0 };
    return this._walState;
  }

  /**
   * WAL statistics: { path, seq, committed, recovered, pending }.
   * After a load that replayed a WAL, "recovered" reflects whether committed
   * ops were applied or a torn/uncommitted tail was discarded.
   * @returns {object}
   */
  getWalStats() {
    if (this._wal) {
      return this._wal.stats();
    }
    return this._walState || { path: null, seq: 0, committed: 0, recovered: false, pending: 0 };
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
 * Reads `len` bytes from `fd` at `fileOffset` into `buf` starting at `bufPos`.
 * Guarantees a full read or throws.
 */
function readFullSync(fd, buf, bufPos, len, fileOffset) {
  let bytesRead = 0;
  while (bytesRead < len) {
    const n = fs.readSync(fd, buf, bufPos + bytesRead, len - bytesRead, fileOffset + bytesRead);
    if (n === 0) throw new Error('Archive file changed while it was being read');
    bytesRead += n;
  }
}

function writeUInt64BE(buf, value, offset) {
  buf.writeBigUInt64BE(BigInt(value), offset);
}

function readUInt64BE(buf, offset) {
  return Number(buf.readBigUInt64BE(offset));
}

/**
 * OmniArchiveV3: out-of-core streaming .omni container.
 *
 * Writes entries as chunked frames (per-chunk sha256 over stored bytes) with
 * a trailer index (entry byte ranges + whole-entry raw sha256). Reads random
 * access entries via fs.createReadStream(start/end), so memory usage is
 * bounded by chunk size regardless of archive size. The legacy in-memory
 * APIs remain available for small archives via loadArchiveSync().
 */
class OmniArchiveV3 {
  /**
   * Streams a set of entries into a writable file stream.
   * @param {import('stream').Writable} writable - Destination (e.g. fs.createWriteStream)
   * @param {Array<{name: string, stream: (Readable|Buffer|Array<Buffer>)}>} entries
   * @param {object} [options]
   * @param {number} [options.chunkSize=1048576]
   * @param {boolean} [options.compression=true] - Per-chunk deflate
   * @param {number} [options.compressionLevel] - zlib level (default Z_BEST_SPEED)
   * @returns {Promise<{entries: object[], trailerOffset: number, fileSize: number}>}
   */
  static async writeChunks(writable, entries, options = {}) {
    if (!writable || typeof writable.write !== 'function') {
      throw new Error('writeChunks requires a writable stream');
    }
    const chunkSize = Math.min(MAX_CHUNK_SIZE, Math.max(MIN_CHUNK_SIZE, options.chunkSize || DEFAULT_CHUNK_SIZE));
    const compressed = options.compression !== false;
    const compressionLevel =
      options.compressionLevel === undefined ? zlib.constants.Z_BEST_SPEED : options.compressionLevel;

    const header = Buffer.alloc(28);
    MAGIC_BYTES_V3.copy(header, 0);
    header.writeUInt32BE(STREAMING_FORMAT_VERSION, 8);
    header.writeUInt32BE(compressed ? STREAMING_FLAG_COMPRESSED : 0, 12);
    header.writeUInt32BE(chunkSize, 16);
    writeUInt64BE(header, 0, 20);

    const writeAll = (buf) =>
      new Promise((resolve, reject) => {
        writable.write(buf, (err) => (err ? reject(err) : resolve()));
      });

    const emitFrame = async (rawBuf, meta) => {
      const stored = compressed ? zlib.deflateSync(rawBuf, { level: compressionLevel }) : rawBuf;
      const digest = crypto.createHash('sha256').update(stored).digest();
      const lenBuf = Buffer.alloc(8);
      writeUInt64BE(lenBuf, stored.length, 0);
      await writeAll(Buffer.concat([lenBuf, stored, digest]));
      meta.pos += 8 + stored.length + 32;
      meta.rawLength += rawBuf.length;
      meta.chunkCount++;
      meta.entryHash.update(rawBuf);
    };

    await writeAll(header);
    const index = [];
    let pos = header.length;

    for (const entry of entries) {
      const name = String(entry.name);
      const nameBuf = Buffer.from(name, 'utf8');
      if (nameBuf.length === 0) throw new Error('Streaming archive entry name must not be empty');
      if (nameBuf.length > 0xffffffff) throw new Error('Streaming archive entry name exceeds 4 GiB');
      if (index.some((e) => e.name === name)) throw new Error(`Duplicate streaming archive entry '${name}'`);

      const entryStart = pos;
      const head = Buffer.alloc(4 + nameBuf.length);
      head.writeUInt32BE(nameBuf.length, 0);
      nameBuf.copy(head, 4);
      await writeAll(head);
      pos += head.length;

      let src = entry.stream;
      if (Buffer.isBuffer(src)) src = [src];
      else if (src == null) src = [];

      const meta = { pos, rawLength: 0, chunkCount: 0, entryHash: crypto.createHash('sha256') };
      let parts = [];
      let partTotal = 0;

      for await (let chunk of src) {
        if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
        let off = 0;
        while (off < chunk.length) {
          const need = chunkSize - partTotal;
          const take = Math.min(need, chunk.length - off);
          parts.push(chunk.subarray(off, off + take));
          partTotal += take;
          off += take;
          if (partTotal === chunkSize) {
            const rawBuf = Buffer.concat(parts);
            parts = [];
            partTotal = 0;
            await emitFrame(rawBuf, meta);
          }
        }
      }
      if (partTotal > 0) {
        await emitFrame(Buffer.concat(parts), meta);
      }

      index.push({
        name,
        entryOffset: entryStart,
        entryLength: meta.pos - entryStart,
        rawLength: meta.rawLength,
        chunkCount: meta.chunkCount,
        entrySha256: meta.entryHash.digest('hex')
      });
      pos = meta.pos;
    }

    const trailer = OmniArchiveV3._buildTrailer(index, pos);
    await writeAll(trailer);
    return { entries: index, trailerOffset: pos, fileSize: pos + trailer.length };
  }

  static _buildTrailer(index, trailerOffset) {
    const records = [];
    let size = 4;
    for (const e of index) {
      const nameBuf = Buffer.from(e.name, 'utf8');
      size += 4 + nameBuf.length + 8 + 8 + 8 + 8 + 32;
      records.push({ nameBuf, e });
    }
    const buf = Buffer.alloc(size + 16);
    let off = 0;
    buf.writeUInt32BE(index.length, off);
    off += 4;
    for (const { nameBuf, e } of records) {
      buf.writeUInt32BE(nameBuf.length, off);
      off += 4;
      nameBuf.copy(buf, off);
      off += nameBuf.length;
      writeUInt64BE(buf, e.entryOffset, off);
      off += 8;
      writeUInt64BE(buf, e.entryLength, off);
      off += 8;
      writeUInt64BE(buf, e.rawLength, off);
      off += 8;
      writeUInt64BE(buf, e.chunkCount, off);
      off += 8;
      Buffer.from(e.entrySha256, 'hex').copy(buf, off);
      off += 32;
    }
    writeUInt64BE(buf, trailerOffset, off);
    off += 8;
    TRAILER_MAGIC.copy(buf, off);
    return buf;
  }

  /**
   * Reads the trailer index of a streaming archive (sync).
   * @returns {{headerSize: number, trailerOffset: number, entries: object[]}}
   */
  static readIndex(archivePath) {
    const fd = fs.openSync(archivePath, 'r');
    try {
      const st = fs.fstatSync(fd);
      if (st.size < 40) throw new Error('Malformed streaming archive: file too small');

      const probe = Buffer.alloc(28);
      readFullSync(fd, probe, 0, 28, 0);
      if (!probe.subarray(0, 8).equals(MAGIC_BYTES_V3)) {
        throw new Error('Not a v3 streaming archive: missing OMNIENG\\x03 magic');
      }

      const tail = Buffer.alloc(16);
      readFullSync(fd, tail, 0, 16, st.size - 16);
      const trailerOffset = readUInt64BE(tail, 0);
      if (!tail.subarray(8, 16).equals(TRAILER_MAGIC)) {
        throw new Error('Malformed streaming archive: missing trailer magic');
      }
      if (trailerOffset < 28 || trailerOffset >= st.size - 16) {
        throw new Error('Malformed streaming archive: invalid trailer offset');
      }

      const trailerLen = st.size - trailerOffset - 16;
      const trailer = Buffer.alloc(trailerLen);
      readFullSync(fd, trailer, 0, trailerLen, trailerOffset);

      let off = 0;
      const entryCount = trailer.readUInt32BE(off);
      off += 4;
      const entries = [];
      for (let i = 0; i < entryCount; i++) {
        if (off + 4 > trailer.length) throw new Error('Malformed streaming archive: truncated trailer');
        const nameLen = trailer.readUInt32BE(off);
        off += 4;
        if (nameLen === 0 || off + nameLen > trailer.length) {
          throw new Error('Malformed streaming archive: bad entry name');
        }
        const name = trailer.subarray(off, off + nameLen).toString('utf8');
        off += nameLen;
        if (off + 32 > trailer.length) throw new Error('Malformed streaming archive: truncated entry record');
        const entryOffset = readUInt64BE(trailer, off);
        off += 8;
        const entryLength = readUInt64BE(trailer, off);
        off += 8;
        const rawLength = readUInt64BE(trailer, off);
        off += 8;
        const chunkCount = readUInt64BE(trailer, off);
        off += 8;
        const entrySha256 = trailer.subarray(off, off + 32).toString('hex');
        off += 32;
        entries.push({ name, entryOffset, entryLength, rawLength, chunkCount, entrySha256 });
      }
      if (off !== trailer.length) throw new Error('Malformed streaming archive: trailing garbage in trailer');
      return { headerSize: 28, trailerOffset, entries };
    } finally {
      fs.closeSync(fd);
    }
  }

  static _readHeaderFlags(archivePath) {
    const fd = fs.openSync(archivePath, 'r');
    try {
      const probe = Buffer.alloc(28);
      readFullSync(fd, probe, 0, 28, 0);
      if (!probe.subarray(0, 8).equals(MAGIC_BYTES_V3)) {
        throw new Error('Not a v3 streaming archive: missing OMNIENG\\x03 magic');
      }
      if (probe.readUInt32BE(8) !== STREAMING_FORMAT_VERSION) {
        throw new Error('Unsupported streaming archive format version');
      }
      return probe.readUInt32BE(12);
    } finally {
      fs.closeSync(fd);
    }
  }

  static _entryDataRange(entry) {
    const nameLen = Buffer.byteLength(entry.name, 'utf8');
    const dataStart = entry.entryOffset + 4 + nameLen;
    const dataEnd = entry.entryOffset + entry.entryLength;
    return { dataStart, dataEnd };
  }

  /**
   * Returns a Node Readable stream containing the raw (decompressed) bytes of
   * one entry. Reads only the entry's byte range; per-chunk sha256 and the
   * whole-entry sha256 are verified as data flows. Integrity failures destroy
   * the stream with an Error.
   * @param {string} archivePath
   * @param {string} entryName
   * @param {object} [options]
   * @param {number} [options.highWaterMark]
   * @returns {import('stream').Readable}
   */
  static readEntryStream(archivePath, entryName, options = {}) {
    const fail = (message) => {
      const err = new Error(message);
      const rs = new Readable({ read() {} });
      process.nextTick(() => rs.destroy(err));
      return rs;
    };

    let idx;
    try {
      idx = OmniArchiveV3.readIndex(archivePath);
    } catch (err) {
      return fail(err.message);
    }
    const entry = idx.entries.find((e) => e.name === entryName);
    if (!entry) return fail(`Streaming archive entry not found: ${entryName}`);

    const { dataStart, dataEnd } = OmniArchiveV3._entryDataRange(entry);
    if (dataEnd <= dataStart) {
      if (entry.chunkCount !== 0 || entry.rawLength !== 0) {
        return fail(`Malformed streaming archive: empty byte range for entry '${entryName}'`);
      }
      return Readable.from([]);
    }

    const flags = OmniArchiveV3._readHeaderFlags(archivePath);
    const src = fs.createReadStream(archivePath, {
      start: dataStart,
      end: dataEnd - 1,
      highWaterMark: options.highWaterMark || 256 * 1024
    });
    const verify = new ChunkVerifyTransform({
      compression: Boolean(flags & STREAMING_FLAG_COMPRESSED),
      expectedChunks: entry.chunkCount,
      expectedRaw: entry.rawLength,
      expectedSha: entry.entrySha256
    });
    src.on('error', (err) => verify.destroy(err));
    verify.on('error', () => src.destroy());
    src.pipe(verify);
    return verify;
  }

  /**
   * Synchronously reads one entry into a Buffer using the same chunked,
   * integrity-checked byte-range path (bounded by chunk size, not archive size).
   * @param {string} archivePath
   * @param {string} entryName
   * @returns {Buffer}
   */
  static readEntryBufferSync(archivePath, entryName) {
    const idx = OmniArchiveV3.readIndex(archivePath);
    const entry = idx.entries.find((e) => e.name === entryName);
    if (!entry) throw new Error(`Streaming archive entry not found: ${entryName}`);

    const { dataStart, dataEnd } = OmniArchiveV3._entryDataRange(entry);
    const flags = OmniArchiveV3._readHeaderFlags(archivePath);
    const compressed = Boolean(flags & STREAMING_FLAG_COMPRESSED);

    const fd = fs.openSync(archivePath, 'r');
    try {
      const out = [];
      let stage = Buffer.alloc(0);
      let seenChunks = 0;
      let seenRaw = 0;
      const hash = crypto.createHash('sha256');
      let pos = dataStart;
      const readSize = 1024 * 1024;
      while (pos < dataEnd) {
        const want = Math.min(readSize, dataEnd - pos);
        const buf = Buffer.allocUnsafe(want);
        readFullSync(fd, buf, 0, want, pos);
        pos += want;
        stage = stage.length === 0 ? buf : Buffer.concat([stage, buf]);
        for (;;) {
          if (stage.length < 8) break;
          const storedLen = Number(stage.readBigUInt64BE(0));
          const frameLen = 8 + storedLen + 32;
          if (stage.length < frameLen) break;
          const stored = stage.subarray(8, 8 + storedLen);
          const storedHash = stage.subarray(8 + storedLen, frameLen);
          if (!crypto.createHash('sha256').update(stored).digest().equals(storedHash)) {
            throw new Error(`Integrity failure on chunk ${seenChunks + 1}: sha256 mismatch`);
          }
          let raw;
          try {
            raw = compressed ? zlib.inflateSync(stored) : stored;
          } catch {
            throw new Error(`Integrity failure on chunk ${seenChunks + 1}: inflate failed`);
          }
          seenChunks++;
          seenRaw += raw.length;
          hash.update(raw);
          out.push(raw);
          stage = stage.subarray(frameLen);
        }
      }
      if (stage.length !== 0) throw new Error('Integrity failure: truncated chunk frame');
      if (seenChunks !== entry.chunkCount) {
        throw new Error(`Integrity failure: chunk count ${seenChunks} != expected ${entry.chunkCount}`);
      }
      if (seenRaw !== entry.rawLength) {
        throw new Error(`Integrity failure: byte count ${seenRaw} != expected ${entry.rawLength}`);
      }
      const digest = hash.digest('hex');
      if (digest !== entry.entrySha256) throw new Error('Integrity failure: whole-entry sha256 mismatch');
      return Buffer.concat(out);
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Loads a small streaming archive fully into memory (legacy-compatible
   * OmniArchiveV2) using the same integrity-checked entry reads.
   * @param {string} filePath
   * @returns {OmniArchiveV2}
   */
  static loadArchiveSync(filePath) {
    const idx = OmniArchiveV3.readIndex(filePath);
    const readEntry = (name) => OmniArchiveV3.readEntryBufferSync(filePath, name).toString('utf8');

    const manifestJson = JSON.parse(readEntry('manifest.json'));
    if (!manifestJson || manifestJson.schemaVersion !== CURRENT_SCHEMA_VERSION_V2) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        'Invalid streaming v2 archive: missing schemaVersion 2.0.0 manifest'
      );
    }
    const v2 = new OmniArchiveV2({ manifest: ProjectManifestV2.fromJSON(manifestJson) });

    if (idx.entries.some((e) => e.name === 'journal.json')) {
      v2.journal.import(JSON.parse(readEntry('journal.json')));
    }
    if (idx.entries.some((e) => e.name === 'results.json')) {
      v2.results = JSON.parse(readEntry('results.json')) || [];
    }
    for (const e of idx.entries) {
      if (e.name.startsWith('blobs/')) {
        const hash = e.name.slice(6);
        v2.blobs.set(hash, OmniArchiveV3.readEntryBufferSync(filePath, e.name));
      }
    }
    return v2;
  }
}

/**
 * Transform that parses chunk frames from an entry byte range, verifies each
 * chunk's sha256 (stored bytes), inflates, and verifies the whole-entry
 * sha256 / byte count on completion.
 */
class ChunkVerifyTransform extends Transform {
  constructor({ compression, expectedChunks, expectedRaw, expectedSha }) {
    super({ highWaterMark: 1024 * 1024 });
    this._compression = compression;
    this._expectedChunks = expectedChunks;
    this._expectedRaw = expectedRaw;
    this._expectedSha = expectedSha;
    this._stage = Buffer.alloc(0);
    this._seenChunks = 0;
    this._seenRaw = 0;
    this._hash = crypto.createHash('sha256');
  }

  _transform(chunk, enc, cb) {
    try {
      this._stage = this._stage.length === 0 ? chunk : Buffer.concat([this._stage, chunk]);
      for (;;) {
        if (this._stage.length < 8) break;
        const storedLen = Number(this._stage.readBigUInt64BE(0));
        const frameLen = 8 + storedLen + 32;
        if (this._stage.length < frameLen) break;
        const stored = this._stage.subarray(8, 8 + storedLen);
        const storedHash = this._stage.subarray(8 + storedLen, frameLen);
        if (!crypto.createHash('sha256').update(stored).digest().equals(storedHash)) {
          throw new Error(`Integrity failure on chunk ${this._seenChunks + 1}: sha256 mismatch`);
        }
        let raw;
        try {
          raw = this._compression ? zlib.inflateSync(stored) : stored;
        } catch {
          throw new Error(`Integrity failure on chunk ${this._seenChunks + 1}: inflate failed`);
        }
        this._seenChunks++;
        this._seenRaw += raw.length;
        this._hash.update(raw);
        this.push(raw);
        this._stage = this._stage.subarray(frameLen);
      }
      cb();
    } catch (err) {
      cb(err);
    }
  }

  _flush(cb) {
    try {
      if (this._stage.length !== 0) throw new Error('Integrity failure: truncated chunk frame');
      if (this._seenChunks !== this._expectedChunks) {
        throw new Error(`Integrity failure: chunk count ${this._seenChunks} != expected ${this._expectedChunks}`);
      }
      if (this._seenRaw !== this._expectedRaw) {
        throw new Error(`Integrity failure: byte count ${this._seenRaw} != expected ${this._expectedRaw}`);
      }
      if (this._hash.digest('hex') !== this._expectedSha) {
        throw new Error('Integrity failure: whole-entry sha256 mismatch');
      }
      cb();
    } catch (err) {
      cb(err);
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
  OmniArchiveV3,
  CommandJournal,
  OmniVaultAES256,
  OmniWal,
  WAL_MAGIC,
  WAL_VERSION,
  WAL_FILE_NAME,
  calculateCRC32,
  saveAtomicSync,
  MAGIC_BYTES,
  MAGIC_BYTES_V1,
  MAGIC_BYTES_V2,
  MAGIC_BYTES_V3,
  VAULT_MAGIC_BYTES,
  MAX_UNCOMPRESSED_SECTION_SIZE,
  MAX_ARCHIVE_SIZE_BYTES,
  MAX_EXPANSION_RATIO,
  DEFAULT_CHUNK_SIZE
};
