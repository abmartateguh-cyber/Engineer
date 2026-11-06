'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 14).
 *
 * Targets remaining uncovered blocks in archive/WAL handling, STEP assembly
 * export, and EDA adapter execution paths.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  OmniArchive,
  OmniArchiveV2,
  OmniWal,
  calculateCRC32,
  MAGIC_BYTES_V1,
  WAL_FILE_NAME
} = require('../src/core/storage/omni_archive');
const { StepTranslator } = require('../src/core/cad/step_translator');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');
const { EDAEngineAdapter } = require('../src/core/eda/eda_engine_adapter');

async function runBranchGapFourteenCoverageTests() {
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

  check('OmniArchive encrypted vault password guards', () => {
    const archive = new OmniArchive({ projectName: 'P' });
    assert.throws(() => archive.saveToEncryptedBuffer('abc'), /at least 4 characters/);
    const enc = archive.saveToEncryptedBuffer('a-valid-password');
    assert(enc.length > 52);
    assert.throws(() => OmniArchive.loadFromEncryptedBuffer(enc), /Password must be provided/);
  });

  check('OmniArchive getSection rejects decompression bombs', () => {
    const archive = new OmniArchive();
    archive.sections.clear();
    const compressed = Buffer.from('x');
    archive.sections.set('bomb', { rawLength: 2 * 1024 * 1024, compressed, crc: calculateCRC32(compressed) });
    assert.throws(() => archive.getSection('bomb'), /Decompression bomb/);
  });

  check('OmniArchive loadFromBuffer rejects malformed compressed payloads', () => {
    const build = (rawLength, compLength, payload) => {
      const header = Buffer.alloc(12);
      MAGIC_BYTES_V1.copy(header, 0);
      header.writeUInt32BE(1, 8);
      const nameBuf = Buffer.from('m', 'utf8');
      const meta = Buffer.alloc(2 + nameBuf.length + 12);
      meta.writeUInt16BE(nameBuf.length, 0);
      nameBuf.copy(meta, 2);
      meta.writeUInt32BE(rawLength, 2 + nameBuf.length);
      meta.writeUInt32BE(compLength, 6 + nameBuf.length);
      meta.writeUInt32BE(calculateCRC32(payload), 10 + nameBuf.length);
      return Buffer.concat([header, meta, payload]);
    };
    assert.throws(() => OmniArchive.loadFromBuffer(build(2 * 1024 * 1024, 1, Buffer.from('x'))), /Decompression bomb/);
    assert.throws(() => OmniArchive.loadFromBuffer(build(100, 0, Buffer.alloc(0))), /empty compressed payload/);
  });

  check('OmniWal lifecycle operations', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov14-'));
    const archivePath = path.join(dir, 'proj.omni');
    const wal = new OmniWal({ path: path.join(dir, WAL_FILE_NAME), archivePath });
    wal.open();
    const entry = wal.appendEntry('addBlob', { hash: 'abc', bytes: 4 });
    assert(entry.seq > 0);
    assert.strictEqual(typeof entry.digest, 'string');
    wal.flush();
    wal.commit();
    assert(wal.stats().committed >= entry.seq);
    const stats = wal.rebase();
    assert.strictEqual(stats.committed, 0);
    wal.close();
    assert.throws(() => wal.appendEntry('op', {}), /WAL is not open/);
    assert.throws(() => wal.open().appendEntry('', {}), /non-empty string/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('OmniArchiveV2 WAL enable/append/log path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov14-'));
    const archivePath = path.join(dir, 'proj.omni');
    const archive = new OmniArchiveV2({ projectName: 'P' });
    archive.saveToFile(archivePath);
    archive.enableWal({ archivePath });
    archive.logWalOp('addBlob', { hash: 'x' });
    archive.appendWalEntry('echo', {});
    assert(archive.getWalStats() !== null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('StepTranslator assembly export reference and transform branches', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'BoxA');
    const box2 = BRepPrimitives.createBox(5, 5, 5, 'BoxB');
    const data = {
      solids: [
        { id: 's1', name: 'PartA', solid: box, layer: 'Base', color: { r: 1, g: 0, b: 0 } },
        { id: 's2', name: 'PartB', solid: box2 }
      ],
      assembly: {
        nodes: [
          { id: 'n1', solidId: 's1' },
          { id: 'n2', solidId: 's2', name: 'Child B' }
        ],
        references: [
          { id: 'r1', childId: 'n1', parentId: null, name: 'RootPart' },
          {
            id: 'r2',
            childId: 'n2',
            parentId: 'n1',
            name: 'Occ',
            refId: 'REF-2',
            transform: [
              [1, 0, 0, 5],
              [0, 1, 0, 0],
              [0, 0, 1, 0],
              [0, 0, 0, 1]
            ]
          }
        ]
      }
    };
    const step = StepTranslator.exportAssemblySTEP(data, 'Assy');
    assert(step.includes('NEXT_ASSEMBLY_USAGE_OCCURRENCE'));
    assert(step.includes('CARTESIAN_TRANSFORMATION_3D'));
    assert(step.includes('COLOUR_RGB'));
  });

  check('StepTranslator assembly export children-based edges', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'BoxA');
    const data = {
      solids: [{ id: 's1', solid: box }],
      assembly: {
        nodes: [{ id: 'root', solidId: 's1', name: 'Root' }]
      }
    };
    const step = StepTranslator.exportAssemblySTEP(data, 'Assy2');
    assert(step.includes('PRODUCT('));
  });

  check('StepTranslator NURBS export for box and cylinder solids', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'BoxA');
    const plane = StepTranslator.exportNurbsSurfaces(box, 'BoxNurbs');
    assert(plane.includes('B_SPLINE_SURFACE_WITH_KNOTS'));
    const cyl = BRepPrimitives.createCylinder(5, 20, 32, 'Cyl');
    const rational = StepTranslator.exportNurbsSurfaces(cyl, 'CylNurbs');
    assert(rational.includes('RATIONAL_B_SPLINE_SURFACE'));
  });

  check('StepTranslator exportNurbsSurfaces skips invalid solids', () => {
    const out = StepTranslator.exportNurbsSurfaces([null, { faces: [] }], 'Empty');
    assert.strictEqual(typeof out, 'string');
  });

  check('EDAEngineAdapter execute DC, timing, parasitics, DRC, synthesis', async () => {
    const adapter = new EDAEngineAdapter();
    const dc = await adapter.execute({
      jobId: 'eda-dc-1',
      domain: 'eda',
      operation: 'simulate_spice_dc',
      parameters: {
        components: [
          { type: 'V', id: 'V1', nPlus: 'in', nMinus: '0', dcValue: 1.5 },
          { type: 'R', id: 'R1', n1: 'in', n2: 'out', value: 100 },
          { type: 'D', id: 'D1', anode: 'out', cathode: '0', is: 1e-14, n: 1 }
        ]
      }
    });
    assert.strictEqual(dc.status, 'COMPLETED');
    assert.strictEqual(dc.outputData.converged, true);

    const timing = await adapter.execute({
      jobId: 'eda-t-1',
      domain: 'eda',
      operation: 'static_timing_analysis',
      parameters: { gateDelaysNs: [0.2, 0.3], wireDelaysNs: [0.05, 0.1] }
    });
    assert.strictEqual(timing.status, 'COMPLETED');

    const para = await adapter.execute({
      jobId: 'eda-p-1',
      domain: 'eda',
      operation: 'extract_wire_parasitics',
      parameters: {
        lengthUm: 1000,
        widthUm: 100,
        thicknessUm: 50,
        spacingUm: 100,
        dielectricHeightUm: 200,
        dielectricPermittivity: 3.9,
        resistivityOhmM: 1.68e-8
      }
    });
    assert.strictEqual(para.status, 'COMPLETED');
    assert(para.outputData.resistanceOhms > 0);

    const drc = await adapter.execute({
      jobId: 'eda-d-1',
      domain: 'eda',
      operation: 'run_drc',
      parameters: {
        shapes: [{ id: 'R1', layer: 'M1', x: 0, y: 0, w: 10, h: 10 }],
        rules: { minWidth: 1, minSpacing: 1, minArea: 1 }
      }
    });
    assert.strictEqual(drc.status, 'COMPLETED');
    assert.strictEqual(drc.outputData.clean, true);

    const synth = await adapter.execute({
      jobId: 'eda-s-1',
      domain: 'eda',
      operation: 'synthesize_logic',
      parameters: { verilogSource: 'module m(input a, b, output y); assign y = a & b; endmodule' }
    });
    assert.strictEqual(synth.status, 'COMPLETED');
    assert.strictEqual(synth.outputData.success, false);
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

module.exports = { runBranchGapFourteenCoverageTests };
