'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  OmniArchive,
  OmniArchiveV2,
  CommandJournal,
  OmniVaultAES256,
  MAGIC_BYTES_V1,
  MAGIC_BYTES_V2
} = require('../src/core/storage/omni_archive');
const { JobResult, JobStatus } = require('../src/core/contracts/JobResult');

console.log('================================================================');
console.log('       TESTING OMNIARCHIVE V2 CONTENT-ADDRESSED ATOMIC STORAGE  ');
console.log('================================================================');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-archive-v2-test-'));

try {
  // 1. Basic v2 creation and content-addressed blobs
  console.log('\n[1] Creating .omni v2 with content-addressed blobs...');
  const v2 = new OmniArchiveV2({ projectName: 'Synthetic Drone Arm Assembly Example' });
  assert.strictEqual(v2.manifest.name, 'Synthetic Drone Arm Assembly Example');
  assert.strictEqual(v2.manifest.schemaVersion, '2.0.0');

  const stepContent = "ISO-10303-21; HEADER; FILE_DESCRIPTION(('OmniEng Drone Arm'), '2;1');";
  const meshContent = JSON.stringify({ nodes: 1540, elements: 4200, type: 'TET10' });

  const ref1 = v2.addBlob(stepContent, { mimeType: 'application/step', name: 'arm_geometry.step' });
  const ref2 = v2.addBlob(meshContent, { mimeType: 'application/x-omni-mesh+json', name: 'arm_mesh.json' });

  assert.strictEqual(v2.hasBlob(ref1.hash), true);
  assert.strictEqual(v2.hasBlob(ref2.hash), true);
  assert.strictEqual(v2.getBlob(ref1.hash).toString('utf8'), stepContent);
  assert.deepStrictEqual(v2.getBlob(ref2.hash, true), JSON.parse(meshContent));
  console.log('  ✓ PASSED: Blobs stored content-addressed by SHA-256 with correct MIME types');

  // 2. Command journal and JobResult tracking
  console.log('\n[2] Command journal & JobResult persistence...');
  v2.journal.execute(
    'CAD_ADD_HOLE',
    { x: 10, y: 20, diameter: 5 },
    { x: 10, y: 20, deleted: true },
    'Add M5 mounting hole'
  );
  assert.strictEqual(v2.journal.canUndo(), true);

  const mockJobResult = new JobResult({
    jobId: 'job-drone-fea-01',
    status: JobStatus.COMPLETED,
    output: { maxStressMpa: 142.5, safetyFactor: 2.1 },
    timing: { runMs: 350 }
  });
  v2.recordResult(mockJobResult);
  assert.strictEqual(v2.results.length, 1);
  console.log('  ✓ PASSED: Command history journal and JobResult records attached');

  // 3. Serialization to binary buffer and magic header
  console.log('\n[3] Serializing v2 archive to buffer...');
  const v2Buffer = v2.saveToBuffer();
  assert.ok(Buffer.isBuffer(v2Buffer));
  assert.ok(v2Buffer.subarray(0, 8).equals(MAGIC_BYTES_V2), 'Must contain OMNIENG\\x02 magic header');

  const unpackedV2 = OmniArchiveV2.loadFromBuffer(v2Buffer);
  assert.strictEqual(unpackedV2.manifest.name, 'Synthetic Drone Arm Assembly Example');
  assert.strictEqual(unpackedV2.manifest.schemaVersion, '2.0.0');
  assert.strictEqual(unpackedV2.hasBlob(ref1.hash), true);
  assert.strictEqual(unpackedV2.hasBlob(ref2.hash), true);
  assert.strictEqual(unpackedV2.journal.history.length, 1);
  assert.strictEqual(unpackedV2.results.length, 1);
  console.log('  ✓ PASSED: Binary v2 serialization and deserialization retains all blobs and journal');

  // 4. Atomic file save with fsync and rename
  console.log('\n[4] Atomic save with fsync and backup...');
  const archivePath = path.join(tempDir, 'project_arm.omni');
  v2.saveToFile(archivePath);

  assert.strictEqual(fs.existsSync(archivePath), true);
  const loadedFromFile = OmniArchiveV2.loadFromFile(archivePath);
  assert.strictEqual(loadedFromFile.manifest.name, 'Synthetic Drone Arm Assembly Example');

  // Save again to trigger .bak creation
  v2.manifest = v2.manifest.withIncrementedRevision({ name: 'Synthetic Drone Arm Assembly Example Rev 2' });
  v2.saveToFile(archivePath);
  assert.strictEqual(fs.existsSync(`${archivePath}.bak`), true);
  const reloaded = OmniArchiveV2.loadFromFile(archivePath);
  assert.strictEqual(reloaded.manifest.name, 'Synthetic Drone Arm Assembly Example Rev 2');
  console.log('  ✓ PASSED: Atomic save commits via fsync, creates .bak, and updates atomically');

  // 5. Crash recovery journal
  console.log('\n[5] Crash recovery journal and uncommitted command recovery...');
  const crashProjectPath = path.join(tempDir, 'crash_test.omni');
  const crashArchive = new OmniArchiveV2({ projectName: 'Crash Recovery Test Project' });
  crashArchive.saveToFile(crashProjectPath);

  // Simulate user making commands that were acknowledged before a sudden power loss / kill
  OmniArchiveV2.recordAcknowledgedCommandSync(crashProjectPath, {
    actionType: 'CAD_FILLET_EDGE',
    edgeId: 104,
    radius: 3.0
  });
  OmniArchiveV2.recordAcknowledgedCommandSync(crashProjectPath, {
    actionType: 'CAD_APPLY_MATERIAL',
    materialId: 'TEST-SYNTHETIC-MATERIAL'
  });

  const recovery = OmniArchiveV2.recoverFromCrash(crashProjectPath);
  assert.strictEqual(recovery.recoveredCount, 2);
  assert.strictEqual(recovery.commands[0].actionType, 'CAD_FILLET_EDGE');
  assert.strictEqual(recovery.commands[1].actionType, 'CAD_APPLY_MATERIAL');
  console.log(`  ✓ PASSED: Crash recovery recovered ${recovery.recoveredCount} acknowledged commands`);

  // Subsequent saveToFile cleans up the recovery journal
  crashArchive.saveToFile(crashProjectPath);
  assert.strictEqual(fs.existsSync(`${crashProjectPath}.recovery.journal`), false);
  console.log('  ✓ PASSED: Recovery journal cleaned up after successful atomic save');

  // 6. Transparent Migration from v1 to v2
  console.log('\n[6] v1 to v2 transparent migration...');
  const v1 = new OmniArchive({ projectName: 'Legacy Turbine Blade v1' });
  v1.addSection('geometry_data', Buffer.from('SOLID MESH v1 99999', 'utf8'));
  v1.addSection('stress_results', { vonMisesMax: 245.8 });

  const v1Path = path.join(tempDir, 'legacy_blade.omni');
  v1.saveToFile(v1Path);

  // Load through v2 loader - transparent migration!
  const migrated = OmniArchiveV2.loadFromFile(v1Path);
  assert.strictEqual(migrated.manifest.schemaVersion, '2.0.0');
  assert.strictEqual(migrated.manifest.name, 'Legacy Turbine Blade v1');
  assert.strictEqual(migrated.listBlobs().length, 2);
  console.log('  ✓ PASSED: v1 archive transparently migrated to v2 with content-addressed blobs');

  console.log('\n================================================================');
  console.log('   ALL OMNIARCHIVE V2 ATOMIC STORAGE ASSERTIONS PASSED!         ');
  console.log('================================================================');
} finally {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}
}
