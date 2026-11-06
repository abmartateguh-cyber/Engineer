'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 10).
 *
 * Focused checks for uncovered blocks in storage/archive handling, edge
 * blending hydration, and persistent topological naming.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  OmniArchive,
  OmniArchiveV2,
  OmniVaultAES256,
  saveAtomicSync,
  MAGIC_BYTES_V1,
  MAGIC_BYTES_V2,
  MAX_EXPANSION_RATIO
} = require('../src/core/storage/omni_archive');
const { ProjectManifestV2 } = require('../src/core/contracts/ProjectManifestV2');
const { EdgeBlender } = require('../src/core/cad/edge_blender');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');
const { PersistentNamingManager } = require('../src/core/cad/persistent_naming_manager');

async function runBranchGapTenCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const pending = [];

  function check(name, fn) {
    totalTests++;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        pending.push(
          Promise.resolve(result).then(
            () => {
              passedTests++;
              console.log(`  ✓ PASSED: ${name}`);
            },
            (err) => {
              failedTests++;
              console.error(`  ✗ FAILED: ${name}`);
              console.error(`    ${err.message}`);
            }
          )
        );
        return;
      }
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  check('OmniArchive V1 constructor applies metadata fallbacks', () => {
    const archive = new OmniArchive({});
    assert.strictEqual(archive.manifest.projectName, 'Untitled Project');
    assert.strictEqual(archive.manifest.engineeringDomain, 'universal');
    assert.strictEqual(archive.manifest.author, 'OmniEng Engineer');
  });

  check('OmniArchive addSection rejects empty and oversized names', () => {
    const archive = new OmniArchive();
    assert.throws(() => archive.addSection('', 'x'), /non-empty string/);
    assert.throws(() => archive.addSection('a'.repeat(70000), 'x'), /65535 bytes/);
    assert.throws(() => archive.addSection('a', undefined), /Unsupported content type/);
  });

  check('OmniArchive addSection enforces section count ceiling', () => {
    const archive = new OmniArchive();
    for (let index = 0; index < 4095; index++) archive.addSection(`sec${index}`, 'x');
    assert.throws(() => archive.addSection('overflow', 'y'), /exceeds the maximum section count/);
  });

  check('OmniArchive getSection JSON catch returns raw string', () => {
    const archive = new OmniArchive();
    archive.addSection('raw', 'not-json{');
    assert.strictEqual(archive.getSection('raw', true), 'not-json{');
  });

  check('OmniArchive loadFromBuffer rejects non-buffer and bad magic', () => {
    assert.throws(() => OmniArchive.loadFromBuffer(Buffer.alloc(5)), /too small/);
    const bad = Buffer.alloc(16);
    bad.write('BADMAGIC', 0, 'utf8');
    assert.throws(() => OmniArchive.loadFromBuffer(bad), /magic header/);
  });

  check('OmniArchive V2 magic routes to v2 loader', () => {
    const v2Header = Buffer.concat([MAGIC_BYTES_V2, Buffer.from([0, 0, 0, 0])]);
    assert.throws(() => OmniArchive.loadFromBuffer(v2Header), /manifest/);
  });

  check('OmniArchive loadFromBuffer rejects malformed section counts', () => {
    const header = Buffer.alloc(12);
    MAGIC_BYTES_V1.copy(header, 0);
    header.writeUInt32BE(1, 8);
    const tooShort = Buffer.concat([header, Buffer.from([0, 1])]);
    assert.throws(() => OmniArchive.loadFromBuffer(tooShort), /section count exceeds the available data/);
  });

  check('OmniArchive saveToBuffer rejects oversized section names', () => {
    const archive = new OmniArchive();
    archive.sections.clear();
    archive.sections.set('x'.repeat(70000), { rawLength: 1, compressed: Buffer.from([1]), crc: 0 });
    assert.throws(() => archive.saveToBuffer(), /Section name length/);
  });

  check('OmniArchive V2 constructor accepts a ProjectManifestV2 instance', () => {
    const manifest = new ProjectManifestV2({ name: 'M', author: 'A', engineeringDomain: 'cad' });
    const archive = new OmniArchiveV2({ manifest });
    assert.strictEqual(archive.manifest, manifest);
  });

  check('OmniArchiveV2 saveToFile/loadFromFile round-trip and missing file', () => {
    const archive = new OmniArchiveV2({ projectName: 'P', author: 'A' });
    archive.addBlob('payload');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov10-'));
    const filePath = path.join(dir, 'proj.omni');
    const saved = archive.saveToFile(filePath);
    assert(saved.sizeBytes > 0);
    const loaded = OmniArchiveV2.loadFromFile(filePath);
    assert.strictEqual(loaded.blobs.size, 1);
    assert.throws(() => OmniArchiveV2.loadFromFile(path.join(dir, 'missing.omni')), /file not found/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('OmniVaultAES256 decrypt rejects truncated and wrong-magic payloads', () => {
    assert.throws(() => OmniVaultAES256.decrypt(Buffer.alloc(20), 'pw'), /shorter than cryptographic header/);
    const badMagic = Buffer.alloc(64);
    badMagic.write('NOTVAULT', 0, 'utf8');
    assert.throws(() => OmniVaultAES256.decrypt(badMagic, 'pw'), /not an OmniEng AES-256 encrypted container/);
  });

  check('OmniArchive decompression-ratio ceiling constant is exported', () => {
    assert.strictEqual(typeof MAX_EXPANSION_RATIO, 'number');
    assert(MAX_EXPANSION_RATIO > 0);
  });

  check('saveAtomicSync creates missing directories', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov10-'));
    const nested = path.join(dir, 'a', 'b');
    const target = path.join(nested, 'out.bin');
    saveAtomicSync(target, Buffer.from('hello'));
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'hello');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('EdgeBlender hydration rejects malformed solids', () => {
    assert.throws(() => EdgeBlender.applyFillet(null, 'e', 0.1), /solid object/);
    assert.throws(() => EdgeBlender.applyFillet({ vertices: [], faces: [] }, 'e', 0.1), /vertex and face arrays/);
    assert.throws(
      () => EdgeBlender.applyFillet({ vertices: [null], faces: [[0, 1, 2]] }, 'e', 0.1),
      /Serialized vertex 0/
    );
    assert.throws(
      () => EdgeBlender.applyFillet({ vertices: [{ point: { x: 0, y: 0, z: 0 } }], faces: [[0, 1, 2]] }, 'e', 0.1),
      /Serialized face 0/
    );
    assert.throws(
      () =>
        EdgeBlender.applyFillet(
          { vertices: [{ point: { x: 0, y: 0, z: 0 } }], faces: [{ vertices: [0, 1] }] },
          'e',
          0.1
        ),
      /at least three vertices/
    );
    assert.throws(
      () => EdgeBlender.applyFillet({ vertices: [{ point: { x: 0, y: 0, z: 0 } }], faces: [] }, 'e', 0.1),
      /edge-blend solids/
    );
  });

  check('EdgeBlender applyFillet on plain serialized box succeeds', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'B');
    const serialized = {
      name: 'B',
      vertices: box.vertices.map((v) => ({ id: v.id, point: { x: v.point.x, y: v.point.y, z: v.point.z } })),
      faces: box.faces.map((f) => ({
        id: f.id,
        vertices: f.vertices.map((v) => v.id),
        normal: { x: f.normal.x, y: f.normal.y, z: f.normal.z }
      })),
      edges: box.edges.map((e) => ({ id: e.id, start: e.start.id, end: e.end.id }))
    };
    const result = EdgeBlender.applyFillet(serialized, serialized.edges[0].id, 1, { subdivisions: 4 });
    assert(result.blendFacesCount > 0);
    assert(result.filletSurfaceArea > 0);
  });

  check('EdgeBlender applyFillet rejects missing target edge', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'B');
    assert.throws(() => EdgeBlender.applyFillet(box, 'no-such-edge', 1), /Target edge not found/);
    assert.throws(() => EdgeBlender.applyFillet(box, box.edges[0], 0), /strictly positive/);
  });

  check('PersistentNamingManager computeGeometryKey paths', () => {
    const vk = PersistentNamingManager.computeGeometryKey('VERTEX', { point: { x: 1, y: 2, z: 3 } });
    assert(vk.startsWith('V:'));
    const ek = PersistentNamingManager.computeGeometryKey('EDGE', {
      start: { x: 0, y: 0, z: 0 },
      end: { x: 1, y: 1, z: 1 }
    });
    assert(ek.startsWith('E:'));
    const fk = PersistentNamingManager.computeGeometryKey('FACE', {
      centroid: { x: 1, y: 2, z: 3 },
      normal: { x: 0, y: 0, z: 1 },
      area: 4
    });
    assert(fk.startsWith('F:'));
  });

  check('PersistentNamingManager entity type helpers', () => {
    const manager = new PersistentNamingManager();
    const vk = PersistentNamingManager.computeGeometryKey('VERTEX', { point: { x: 1, y: 2, z: 3 } });
    const ek = PersistentNamingManager.computeGeometryKey('EDGE', {
      start: { x: 0, y: 0, z: 0 },
      end: { x: 1, y: 1, z: 1 }
    });
    const fk = PersistentNamingManager.computeGeometryKey('FACE', {});
    assert.strictEqual(PersistentNamingManager._entityTypeFromKey(vk), 'VERTEX');
    assert.strictEqual(PersistentNamingManager._entityTypeFromKey(ek), 'EDGE');
    assert.strictEqual(PersistentNamingManager._entityTypeFromKey(fk), 'FACE');
    assert.strictEqual(
      manager.getOrCreateEntityByGeometry('VERTEX', { point: { x: 123, y: 456, z: 789 } }).created,
      true
    );
    assert.strictEqual(manager.getEntityByGeometry('VERTEX', { point: { x: 123, y: 456, z: 789 } }).found, true);
  });

  check('PersistentNamingManager registerTopologicalEntities CREATE/SPLIT/MERGE', () => {
    const manager = new PersistentNamingManager();
    const faceA = PersistentNamingManager.computeGeometryKey('FACE', { centroid: { x: 0, y: 0, z: 0 } });
    const faceB = PersistentNamingManager.computeGeometryKey('FACE', { centroid: { x: 1, y: 0, z: 0 } });
    const faceC = PersistentNamingManager.computeGeometryKey('FACE', { centroid: { x: 2, y: 0, z: 0 } });
    const created = manager.registerTopologicalEntities([], [faceA, faceB]);
    assert.strictEqual(created.op, 'CREATE');
    assert.strictEqual(created.childTags.length, 2);
    const split = manager.registerTopologicalEntities([faceA], [faceA, faceC]);
    assert.strictEqual(split.op, 'SPLIT');
    const merged = manager.registerTopologicalEntities([faceA, faceB], [faceC]);
    assert.strictEqual(merged.op, 'MERGE');
    manager.getOrCreateEntityByGeometry('FACE', { centroid: { x: 9, y: 0, z: 0 } });
    manager.getOrCreateEntityByGeometry('FACE', { centroid: { x: 3, y: 0, z: 0 } });
    const specKeys = manager.registerTopologicalEntities(
      [{ entityType: 'FACE', attributes: { centroid: { x: 9, y: 0, z: 0 } } }],
      [
        { entityType: 'FACE', attributes: { centroid: { x: 8, y: 0, z: 0 } } },
        { entityType: 'FACE', attributes: { centroid: { x: 7, y: 0, z: 0 } } }
      ]
    );
    assert.strictEqual(specKeys.op, 'SPLIT');
    const specMerge = manager.registerTopologicalEntities(
      [
        { entityType: 'FACE', attributes: { centroid: { x: 9, y: 0, z: 0 } } },
        { entityType: 'FACE', attributes: { centroid: { x: 3, y: 0, z: 0 } } }
      ],
      [{ entityType: 'FACE', attributes: { centroid: { x: 8, y: 0, z: 0 } } }]
    );
    assert.strictEqual(specMerge.op, 'MERGE');
    const withNull = manager.registerTopologicalEntities([null], [faceC]);
    assert.strictEqual(withNull.op, 'CREATE');
  });

  check('PersistentNamingManager recordOperation default entityIds and split/merge array forms', () => {
    const manager = new PersistentNamingManager();
    const rec = manager.recordOperation('TEST', {});
    assert.deepStrictEqual(rec.entityIds, []);
    const parent = manager.getOrCreateEntityByGeometry('FACE', { centroid: { x: 5, y: 0, z: 0 } });
    const child1 = manager.getOrCreateEntityByGeometry('FACE', { centroid: { x: 6, y: 0, z: 0 } });
    const child2 = manager.getOrCreateEntityByGeometry('FACE', { centroid: { x: 7, y: 0, z: 0 } });
    manager.splitEntity(parent.tag, child1.tag);
    manager.splitEntity(parent.tag, [child2.tag]);
    manager.mergeEntities([child1.tag, child2.tag], parent.tag);
    manager.mergeEntities(child1.tag, parent.tag);
    assert.strictEqual(manager.getHistory().length > 0, true);
    assert.strictEqual(manager.getCurrentGeneration() >= 0, true);
  });

  check('PersistentNamingManager traceEntity and resolveTag remap paths', () => {
    const manager = new PersistentNamingManager();
    const parent = manager.getOrCreateEntityByGeometry('FACE', { centroid: { x: 0, y: 0, z: 0 } });
    const child = manager.getOrCreateEntityByGeometry('FACE', { centroid: { x: 1, y: 0, z: 0 } });
    manager.splitEntity(parent.tag, child.tag);
    const traced = manager.traceEntity(parent.tag);
    assert.strictEqual(typeof traced, 'object');
    assert.strictEqual(Array.isArray(traced.entries), true);
    const resolved = manager.resolveTag(child.tag);
    assert.strictEqual(typeof resolved, 'object');
    const reResolved = manager.resolveTag(parent.tag);
    assert.strictEqual(typeof reResolved, 'object');
  });

  check('PersistentNamingManager registerEntity defaults and resolveEntity fallback', () => {
    const manager = new PersistentNamingManager();
    const entity = manager.registerEntity('FACE', { centroid: { x: 2, y: 0, z: 0 } });
    assert.strictEqual(typeof entity.persistentId, 'string');
    const resolved = manager.resolveEntity('missing-id', []);
    assert.strictEqual(resolved.matchFound, false);
    assert.strictEqual(resolved.matchedEntity, null);
  });

  const pendingSettled = await Promise.race([
    Promise.all(pending).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 30000))
  ]);
  if (!pendingSettled) {
    failedTests += pending.length;
    console.error('  ✗ WARN: timed out waiting for pending checks; marking them failed');
  }

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapTenCoverageTests };
