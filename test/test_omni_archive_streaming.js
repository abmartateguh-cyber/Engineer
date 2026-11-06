'use strict';

/**
 * OmniEng v3 streaming archive (.omni) — real out-of-core read/write proof.
 *
 * - Small-entry parity: streaming reader returns byte-identical results vs the
 *   legacy in-memory API (same archive instance exported both ways).
 * - Large write: a synthetic 256 MiB entry (deterministic zeros) written in
 *   1 MiB chunks without materializing the payload in memory. The full
 *   512 MiB case is supported and runs on faster hardware (set
 *   OMNI_STREAMING_LARGE_MB=512); this low-spec machine executes the
 *   256 MiB pass in ~1 minute, so 256 MiB is the default here.
 * - Bounded-memory read: stream the entry back, verifying per-chunk sha256 +
 *   whole-entry sha256, with peak RSS delta recorded.
 * - Corruption detection: a flipped byte in the payload byte range fails the
 *   streamed integrity check while a separate entry is still readable.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { OmniArchiveV2, OmniArchiveV3, DEFAULT_CHUNK_SIZE } = require('../src/core/storage/omni_archive');
const { JobResult, JobStatus } = require('../src/core/contracts/JobResult');

const CHUNK = DEFAULT_CHUNK_SIZE;
const LARGE_MB = Number(process.env.OMNI_STREAMING_LARGE_MB || 256);
const LARGE_BYTES = LARGE_MB * 1024 * 1024;
const RSS_BUDGET_BYTES = 200 * 1024 * 1024; // < 200 MiB peak RSS increase
const MIB = 1024 * 1024;

function seededBuffer(length) {
  let state = 0x9e3779b9;
  const buf = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    buf[i] = (state >>> 24) & 0xff;
  }
  return buf;
}

async function testSmallEntryParity(tempDir) {
  console.log('\n[1] Small-entry parity: streaming reader vs legacy in-memory API');
  const archivePath = path.join(tempDir, 'parity-legacy.omni');
  const streamPath = path.join(tempDir, 'parity-streamed.omni');

  const a = new OmniArchiveV2({ projectName: 'Streaming Parity', author: 'tester' });
  a.addBlob('hello streamed world', { mimeType: 'text/plain', name: 'greeting.txt' });
  a.addBlob(seededBuffer(2 * MIB + 333), { mimeType: 'application/octet-stream', name: 'mesh.bin' });
  a.journal.execute('CAD_ADD_HOLE', { x: 1, y: 2, d: 3 }, { x: 1, y: 2, d: 3 }, 'add hole', 'tester');
  a.recordResult(
    new JobResult({ jobId: 'j1', status: JobStatus.COMPLETED, output: { ok: true }, timing: { runMs: 1 } })
  );

  a.saveToFile(archivePath);
  const oldLoaded = OmniArchiveV2.loadFromFile(archivePath);

  await a.saveToFileStreaming(streamPath);
  const reloaded = OmniArchiveV2.loadFromFileStreaming(streamPath);

  assert.deepStrictEqual(oldLoaded.listBlobs().sort(), reloaded.listBlobs().sort());
  for (const h of oldLoaded.listBlobs()) {
    const oldBuf = oldLoaded.getBlob(h);
    const newBuf = reloaded.getBlob(h);
    assert.ok(oldBuf.equals(newBuf), `blob ${h} must be byte-identical`);
    const directBuf = OmniArchiveV3.readEntryBufferSync(streamPath, `blobs/${h}`);
    assert.ok(directBuf.equals(newBuf), `readEntryBufferSync('${h}') must match streaming load`);
  }
  assert.strictEqual(reloaded.manifest.name, oldLoaded.manifest.name);
  assert.strictEqual(reloaded.manifest.schemaVersion, oldLoaded.manifest.schemaVersion);
  assert.strictEqual(reloaded.manifest.revision, oldLoaded.manifest.revision);
  assert.deepStrictEqual(reloaded.manifest.blobs, oldLoaded.manifest.blobs);
  assert.deepStrictEqual(reloaded.results, oldLoaded.results);
  assert.strictEqual(reloaded.journal.history.length, oldLoaded.journal.history.length);
  for (let i = 0; i < reloaded.journal.history.length; i++) {
    const x = reloaded.journal.history[i];
    const y = oldLoaded.journal.history[i];
    assert.strictEqual(x.actionType, y.actionType);
    assert.deepStrictEqual(x.forwardPatch, y.forwardPatch);
    assert.deepStrictEqual(x.reversePatch, y.reversePatch);
    assert.strictEqual(x.description, y.description);
    assert.strictEqual(x.author, y.author);
  }
  console.log('  ✓ PASSED: byte-identical blobs, manifest, journal, results vs legacy API');
}

async function testLargeStreamingWrite(tempDir) {
  console.log(`\n[2] Streaming write: ${LARGE_MB} MiB synthetic entry in 1 MiB chunks`);
  const largePath = path.join(tempDir, 'large.omni');
  const expectedHash = crypto.createHash('sha256');

  async function* zeroChunks(totalBytes, chunkSize) {
    const shared = Buffer.alloc(chunkSize);
    let remaining = totalBytes;
    while (remaining > 0) {
      shared.fill(0);
      const take = Math.min(chunkSize, remaining);
      const piece = take === chunkSize ? shared : shared.subarray(0, take);
      expectedHash.update(piece);
      yield piece;
      remaining -= take;
    }
  }

  const ws = fs.createWriteStream(largePath);
  const t0 = Date.now();
  const res = await OmniArchiveV3.writeChunks(
    ws,
    [
      { name: 'payload.bin', stream: zeroChunks(LARGE_BYTES, CHUNK) },
      { name: 'memo.txt', stream: Buffer.from('streaming works', 'utf8') }
    ],
    { chunkSize: CHUNK }
  );
  await new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.end(resolve);
  });
  const writeMs = Date.now() - t0;
  const stat = fs.statSync(largePath);

  const payload = res.entries.find((e) => e.name === 'payload.bin');
  const memo = res.entries.find((e) => e.name === 'memo.txt');
  assert.ok(payload && memo, 'index must contain both entries');
  assert.strictEqual(payload.rawLength, LARGE_BYTES);
  assert.strictEqual(payload.chunkCount, LARGE_BYTES / CHUNK);
  assert.strictEqual(payload.entrySha256, expectedHash.digest('hex'), 'whole-entry sha256 computed during write');
  assert.strictEqual(memo.rawLength, 15);

  const idx = OmniArchiveV3.readIndex(largePath);
  assert.strictEqual(idx.entries.length, 2);
  assert.strictEqual(idx.entries[0].entryOffset, 28);
  assert.strictEqual(idx.trailerOffset, 28 + idx.entries[0].entryLength + idx.entries[1].entryLength);
  assert.strictEqual(res.fileSize, stat.size);
  console.log(
    `  ✓ PASSED: ${(stat.size / MIB).toFixed(2)} MiB on disk, ${payload.chunkCount} chunks, write ${writeMs}ms`
  );
  return { largePath, payload, memo };
}

async function testBoundedMemoryRead({ largePath, payload, memo }) {
  console.log('\n[3] Streaming read: bounded memory + integrity verification');
  const rssStart = process.memoryUsage().rss;
  let peakDelta = 0;
  let bytes = 0;
  const readHash = crypto.createHash('sha256');
  const t0 = Date.now();

  const stream = OmniArchiveV3.readEntryStream(largePath, 'payload.bin');
  await new Promise((resolve, reject) => {
    stream.on('data', (c) => {
      bytes += c.length;
      readHash.update(c);
      const delta = process.memoryUsage().rss - rssStart;
      if (delta > peakDelta) peakDelta = delta;
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const readMs = Date.now() - t0;

  assert.strictEqual(bytes, LARGE_BYTES, 'streamed byte count equals written byte count');
  assert.strictEqual(readHash.digest('hex'), payload.entrySha256, 'whole-entry sha256 verified at end of stream');
  assert.ok(peakDelta < RSS_BUDGET_BYTES, `peak RSS delta ${(peakDelta / MIB).toFixed(1)} MiB must be < 200 MiB`);
  console.log(
    `  ✓ PASSED: ${(bytes / MIB).toFixed(0)} MiB read, ${payload.chunkCount} chunk sha256s + whole-entry sha256 verified, ` +
      `read ${readMs}ms, peak RSS delta ${(peakDelta / MIB).toFixed(1)} MiB`
  );

  const memoBuf = await new Promise((resolve, reject) => {
    const s = OmniArchiveV3.readEntryStream(largePath, 'memo.txt');
    const parts = [];
    s.on('data', (c) => parts.push(c));
    s.on('end', () => resolve(Buffer.concat(parts)));
    s.on('error', reject);
  });
  assert.strictEqual(memoBuf.toString('utf8'), 'streaming works');
  assert.strictEqual(OmniArchiveV3.readEntryBufferSync(largePath, 'memo.txt').toString('utf8'), 'streaming works');
  assert.strictEqual(OmniArchiveV3.readEntryBufferSync(largePath, 'payload.bin').length, LARGE_BYTES);
}

function testCorruptionDetected({ largePath, payload }) {
  console.log('\n[4] Corruption detection: flipped byte fails streamed integrity');
  const corruptAt = payload.entryOffset + 4 + Buffer.byteLength(payload.name, 'utf8') + 20;
  const fd = fs.openSync(largePath, 'r+');
  const original = Buffer.alloc(1);
  fs.readSync(fd, original, 0, 1, corruptAt);
  fs.writeSync(fd, Buffer.from([original[0] ^ 0xff]), 0, 1, corruptAt);
  fs.closeSync(fd);

  return new Promise((resolve, reject) => {
    const stream = OmniArchiveV3.readEntryStream(largePath, 'payload.bin');
    let errored = false;
    stream.on('data', () => {});
    stream.on('error', (err) => {
      errored = true;
      assert.match(String(err.message), /integrity|inflate/i, 'corruption must surface as an integrity error');
      resolve();
    });
    stream.on('end', () => {
      if (!errored) reject(new Error('corrupted stream unexpectedly verified cleanly'));
    });
  }).then(() => {
    const memoBuf = OmniArchiveV3.readEntryBufferSync(largePath, 'memo.txt');
    assert.strictEqual(
      memoBuf.toString('utf8'),
      'streaming works',
      'independent entry still readable after corruption'
    );
    console.log('  ✓ PASSED: corrupted byte rejected; unaffected entry byte range still readable');
  });
}

async function main() {
  console.log('================================================================');
  console.log('  OMNIENG V3 STREAMING ARCHIVE — OUT-OF-CORE READ/WRITE PROOF');
  console.log('================================================================');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-streaming-test-'));
  try {
    await testSmallEntryParity(tempDir);
    const large = await testLargeStreamingWrite(tempDir);
    await testBoundedMemoryRead(large);
    await testCorruptionDetected(large);
    console.log('\n================================================================');
    console.log('  ALL STREAMING ARCHIVE ASSERTIONS PASSED');
    console.log('================================================================');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error('FAILED:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
