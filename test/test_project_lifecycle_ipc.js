'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { activeProjectManager } = require('../src/core/storage/project_manager');
const { OmniArchiveV2 } = require('../src/core/storage/omni_archive');

console.log('================================================================');
console.log('       TESTING PROJECT LIFECYCLE IPC & ACTIVE SESSION MANAGER   ');
console.log('================================================================\n');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-project-test-'));
const projectPath = path.join(testDir, 'test_cad_project.omni');

try {
  // 1. Initialize New Project
  console.log('[1] Initializing new project session...');
  const newSummary = activeProjectManager.initializeNewProject({
    projectName: 'Turbine_Housing_V2',
    engineeringDomain: 'cad',
    author: 'Lead_FEA_Engineer'
  });

  assert.strictEqual(newSummary.projectName, 'Turbine_Housing_V2');
  assert.strictEqual(newSummary.engineeringDomain, 'cad');
  assert.strictEqual(newSummary.author, 'Lead_FEA_Engineer');
  assert.strictEqual(newSummary.revision, 1);
  assert.strictEqual(newSummary.schemaVersion, '2.0.0');
  assert.strictEqual(newSummary.canUndo, false);
  assert.strictEqual(newSummary.canRedo, false);
  assert.strictEqual(newSummary.historyCount, 0);
  console.log('  ✓ PASSED: New project initialized with clean manifest and journal\n');

  // 2. Record State Mutation Commands
  console.log('[2] Recording state mutation commands...');
  const cmd1 = activeProjectManager.recordCommand(
    'PARAMETRIC_EXTRUDE',
    { featureId: 'ext_01', depthMm: 50.0, taperDeg: 0.0 },
    { featureId: 'ext_01', delete: true },
    'Extrude main cylinder boss',
    'Lead_FEA_Engineer'
  );
  assert.strictEqual(cmd1.actionType, 'PARAMETRIC_EXTRUDE');
  assert.strictEqual(activeProjectManager.archive.manifest.revision, 2);

  const cmd2 = activeProjectManager.recordCommand(
    'ADD_HOLE_PATTERN',
    { patternId: 'pat_01', holeCount: 8, diameterMm: 12.5 },
    { patternId: 'pat_01', delete: true },
    'Add M12 bolt circle pattern',
    'Lead_FEA_Engineer'
  );
  assert.strictEqual(cmd2.actionType, 'ADD_HOLE_PATTERN');
  assert.strictEqual(activeProjectManager.archive.manifest.revision, 3);
  assert.strictEqual(activeProjectManager.archive.journal.canUndo(), true);
  assert.strictEqual(activeProjectManager.archive.journal.canRedo(), false);
  console.log('  ✓ PASSED: Commands recorded and revision incremented to 3\n');

  // 3. Undo and Redo Execution
  console.log('[3] Testing Undo and Redo operations...');
  const undo1 = activeProjectManager.undo();
  assert.strictEqual(undo1.appliedPatch.delete, true);
  assert.strictEqual(undo1.undoneEntry.actionType, 'ADD_HOLE_PATTERN');
  assert.strictEqual(undo1.canUndo, true);
  assert.strictEqual(undo1.canRedo, true);

  const undo2 = activeProjectManager.undo();
  assert.strictEqual(undo2.undoneEntry.actionType, 'PARAMETRIC_EXTRUDE');
  assert.strictEqual(undo2.canUndo, false);
  assert.strictEqual(undo2.canRedo, true);

  const redo1 = activeProjectManager.redo();
  assert.strictEqual(redo1.redoneEntry.actionType, 'PARAMETRIC_EXTRUDE');
  assert.strictEqual(redo1.canUndo, true);

  const redo2 = activeProjectManager.redo();
  assert.strictEqual(redo2.redoneEntry.actionType, 'ADD_HOLE_PATTERN');
  assert.strictEqual(redo2.canUndo, true);
  assert.strictEqual(redo2.canRedo, false);
  console.log('  ✓ PASSED: Undo and Redo accurately traverse history stack\n');

  // 4. Attach Content-Addressed Binary Blob
  console.log('[4] Attaching geometry blob to project...');
  const stepContent = 'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'OmniEng Turbine\'),\'2;1\');\nENDSEC;\nEND-ISO-10303-21;\n';
  const blobRef = activeProjectManager.addBlob(Buffer.from(stepContent, 'utf8'), 'application/step');
  assert(blobRef.hash, 'Blob reference must contain SHA-256 hash');
  console.log(`  ✓ PASSED: Blob stored with SHA-256: ${blobRef.hash.slice(0, 16)}...\n`);

  // 5. Atomic Save with fsync and Backup
  console.log('[5] Saving project atomically to disk...');
  const saveResult = activeProjectManager.saveProject(projectPath);
  assert.strictEqual(saveResult.success, true);
  assert.strictEqual(saveResult.filePath, path.resolve(projectPath));
  assert(fs.existsSync(projectPath), 'Project file must exist on disk');

  // Perform another mutation and save to verify .bak creation
  activeProjectManager.recordCommand('EDGE_FILLET', { radiusMm: 3.0 }, { radiusMm: 0.0 }, 'Fillet outer rim');
  activeProjectManager.saveProject();
  assert(fs.existsSync(`${projectPath}.bak`), 'Backup file .bak must exist after second save');
  console.log('  ✓ PASSED: Project saved atomically; .bak backup created\n');

  // 6. Open Project and Verify Complete Deserialization
  console.log('[6] Opening saved project from disk in a new session...');
  const freshManager = new (require('../src/core/storage/project_manager').ProjectManager)();
  const loadedSummary = freshManager.openProject(projectPath);

  assert.strictEqual(loadedSummary.projectName, 'Turbine_Housing_V2');
  assert.strictEqual(loadedSummary.engineeringDomain, 'cad');
  assert.strictEqual(loadedSummary.schemaVersion, '2.0.0');
  assert.strictEqual(loadedSummary.blobCount, 1);
  assert.strictEqual(loadedSummary.historyCount, 3);
  assert.strictEqual(loadedSummary.canUndo, true);

  // Verify blob retrieval
  const retrievedBlob = freshManager.getBlob(blobRef.hash);
  assert.strictEqual(retrievedBlob.toString('utf8'), stepContent);

  // Verify command history retrieval
  const history = freshManager.getHistory();
  assert.strictEqual(history.length, 3);
  assert.strictEqual(history[0].actionType, 'PARAMETRIC_EXTRUDE');
  assert.strictEqual(history[1].actionType, 'ADD_HOLE_PATTERN');
  assert.strictEqual(history[2].actionType, 'EDGE_FILLET');
  console.log('  ✓ PASSED: Opened project cleanly restored all blobs, manifests, and command history\n');

  console.log('================================================================');
  console.log('   ALL PROJECT LIFECYCLE IPC & STORAGE TESTS PASSED!            ');
  console.log('================================================================\n');
} finally {
  fs.rmSync(testDir, { recursive: true, force: true });
}
