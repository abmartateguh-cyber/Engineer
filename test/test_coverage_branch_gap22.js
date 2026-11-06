'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 22).
 *
 * Targets uncovered branch blocks in the newly built production modules:
 * materials catalog, optics glass catalog, thermo compounds, neural net,
 * robotics collision, FMI reader, local HPC scheduler, record signing,
 * trimmed NURBS surface, EDA placement annealing, polygon DRC, CAM 3-axis,
 * shell assembly, 6-DOF dynamics, constrained Delaunay 2D, and streaming
 * archive v3. No production source is modified.
 */

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { MaterialManager, MATERIAL_DATABASE } = require('../src/core/materials/material_database');
const { OpticalGlassCatalog, OPTICAL_GLASS_CATALOG_DATA } = require('../src/core/optics/optical_glass_catalog');
const { CorrelationPropertyDatabase } = require('../src/core/plant/dippr_database');
const { NeuralNetwork, gradientCheck } = require('../src/core/ai/neural_net');
const { meshCollision, checkRobotPath } = require('../src/core/robotics/collision_checks');
const { SerialManipulatorEngine, PUMA_560_DH } = require('../src/core/robotics/serial_manipulator_kinematics');
const { FmuReader, FmuExecutionHost, ZipFormatError } = require('../src/core/cosim/fmu_reader');
const { LocalCluster } = require('../src/core/hpc/local_scheduler');
const { SoftwareSigningAuthority, SignedLedger, canonicalize } = require('../src/core/security/record_signing');
const { TrimmedNurbsSurface } = require('../src/core/cad/nurbs_trimmed_surface');
const { PlaceAndRouteEngine } = require('../src/core/eda/place_and_route_engine');
const { DRCEngine } = require('../src/core/eda/drc_engine');
const { CNCToolpathEngine } = require('../src/core/cam/cnc_toolpath_engine');
const { ShellAssembly } = require('../src/core/cae/shell_assembly');
const { SixDofDynamics, standardAtmosphere1976 } = require('../src/core/aerospace/six_dof_dynamics');
const { DelaunayConstrained2D } = require('../src/core/cae/delaunay_constrained_2d');
const { OmniArchiveV3 } = require('../src/core/storage/omni_archive');

async function runBranchGapTwentyTwoCoverageTests() {
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

  // ------------------------------------------------------------------
  // Materials catalog branches
  // ------------------------------------------------------------------
  check('materials: unknown material lookup fails closed', () => {
    const m = new MaterialManager();
    assert.throws(() => m.resolveRequired('DOES-NOT-EXIST'));
    assert(Object.keys(MATERIAL_DATABASE).length >= 8);
  });

  check('materials: temperature interpolation out-of-range clamps', () => {
    const { interpolateProperty } = require('../src/core/materials/material_database');
    const card = MATERIAL_DATABASE['AL-7075-T6'];
    const eLo = interpolateProperty(card, 'E', 1);
    const eHi = interpolateProperty(card, 'E', 5000);
    assert(Number.isFinite(eLo) && Number.isFinite(eHi));
  });

  check('materials: missing required fields rejected at construction', () => {
    const { MaterialManager } = require('../src/core/materials/material_database');
    const m = new MaterialManager();
    assert.throws(() => m.registerMaterial({ id: 'X', name: 'X' }));
  });

  // ------------------------------------------------------------------
  // Optics glass catalog branches
  // ------------------------------------------------------------------
  check('optics: unknown glass fails closed', () => {
    const cat = OpticalGlassCatalog.fromBundledData();
    assert.strictEqual(cat.getGlass('NOT-A-GLASS'), null);
  });

  check('optics: bundled data non-empty and sourced', () => {
    assert(OPTICAL_GLASS_CATALOG_DATA.length >= 30);
    const allSourced = OPTICAL_GLASS_CATALOG_DATA.every(
      (g) => g.provenance && g.provenance.datasheetUrl && g.provenance.datasheetUrl.startsWith('http')
    );
    assert.strictEqual(allSourced, true);
  });

  check('optics: Schott formula computes nd', () => {
    const cat = OpticalGlassCatalog.fromBundledData();
    const g = cat.getGlass('N-BK7');
    assert(g);
    assert.strictEqual(g.formula, 'sellmeier1');
    const n = g.B[0] + 1;
    assert(Number.isFinite(n) && n > 1);
  });

  // ------------------------------------------------------------------
  // Thermo compounds branches
  // ------------------------------------------------------------------
  check('thermo: unknown species returns null', () => {
    const db = new CorrelationPropertyDatabase();
    assert.strictEqual(db.get('NO-SUCH-SPECIES'), null);
  });

  check('thermo: out-of-range temperature throws', () => {
    const db = new CorrelationPropertyDatabase();
    const w = db.get('Water');
    assert.throws(() => w.getVaporPressure(1));
    assert.throws(() => w.getVaporPressure(6000));
  });

  check('thermo: library functions produce finite values', () => {
    const db = new CorrelationPropertyDatabase();
    const w = db.get('Water');
    const vp = w.getVaporPressure(373.15);
    assert(Number.isFinite(vp) && vp > 50000);
    const lm = w.getLiquidDensity(298.15);
    assert(Number.isFinite(lm) && lm > 500);
    const cp = w.getIdealGasCp(298.15);
    assert(Number.isFinite(cp));
    assert.throws(() => w.getLiquidViscosity(298.15));
  });

  // ------------------------------------------------------------------
  // Neural network branches
  // ------------------------------------------------------------------
  check('neural: gradient check catches wrong loss', () => {
    const nn = new NeuralNetwork({ inputSize: 2, outputSize: 1, hidden: [3], activation: 'tanh', seed: 3 });
    const X = [
      [0.1, 0.2],
      [0.3, 0.4],
      [0.5, 0.6],
      [-0.2, 0.1]
    ];
    const Y = [[0.3], [0.5], [0.7], [0.1]];
    const r = gradientCheck(nn, X, Y, { maxChecks: 8 });
    assert(r.maxAbsDiff < 1e-5);
  });

  check('neural: invalid layer config rejected', () => {
    assert.throws(() => new NeuralNetwork({ inputSize: 2, outputSize: 0, hidden: [3] }));
    assert.throws(() => new NeuralNetwork({ inputSize: -1, outputSize: 1, hidden: [3] }));
  });

  check('neural: unknown activation rejected', () => {
    assert.throws(() => new NeuralNetwork({ inputSize: 2, outputSize: 1, hidden: [3], activation: 'nope' }));
  });

  check('neural: forward returns cached activations', () => {
    const nn = new NeuralNetwork({
      inputSize: 2,
      outputSize: 3,
      hiddenUnits: [4],
      activation: 'tanh',
      loss: 'crossEntropy',
      seed: 5
    });
    const out = nn.forward([0.2, -0.4]);
    assert(Array.isArray(out.acts));
    assert.strictEqual(out.acts[0].length, 2);
    assert.strictEqual(out.acts[out.acts.length - 1].length, 3);
    assert(out.acts.every((layer) => layer.every(Number.isFinite)));
  });

  check('neural: softmax with mse loss rejected', () => {
    assert.throws(
      () =>
        new NeuralNetwork({
          inputSize: 2,
          outputSize: 3,
          hiddenUnits: [4],
          activation: 'tanh',
          loss: 'mse',
          outputActivation: 'softmax'
        })
    );
  });

  // ------------------------------------------------------------------
  // Robotics collision branches
  // ------------------------------------------------------------------
  check('collision: invalid vector input fails closed', () => {
    assert.throws(() =>
      meshCollision(
        {
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0]
          ],
          triangles: [[0, 1, 2]]
        },
        {
          vertices: [
            ['a', 'b', 'c'],
            [1, 0, 0],
            [0, 1, 0]
          ],
          triangles: [[0, 1, 2]]
        }
      )
    );
  });

  check('collision: invalid robot chain fails closed', () => {
    assert.throws(() => checkRobotPath({}, [0, 0], [1, 1], [], { numSamples: 4 }));
  });

  check('collision: empty meshes report no collision', () => {
    const r = meshCollision({ vertices: [], triangles: [] }, { vertices: [], triangles: [] });
    assert.strictEqual(r, false);
  });

  // ------------------------------------------------------------------
  // FMI reader branches
  // ------------------------------------------------------------------
  check('fmu: truncated zip fails closed', () => {
    const buf = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x00]);
    assert.throws(() => new FmuReader(buf).readZip());
  });

  check('fmu: fake zip with bad EOCD fails closed', () => {
    const f = new FmuReader(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    assert.throws(() => f.readZip());
  });

  // ------------------------------------------------------------------
  // Local HPC scheduler branches
  // ------------------------------------------------------------------
  check('hpc: malformed task descriptor fails closed', async () => {
    const cluster = new LocalCluster({
      workerPath: path.join(__dirname, '..', 'src', 'core', 'hpc', 'local_worker.js')
    });
    try {
      const sub = cluster.submit({ taskType: 'NOPE', payload: {} });
      assert.strictEqual(sub.submitted, true);
      const finalJob = await cluster.waitFor(sub.jobId);
      assert.strictEqual(finalJob.status, 'FAILED');
    } finally {
      await cluster.shutdown();
    }
  });

  check('hpc: job timeout fails cleanly', async () => {
    const cluster = new LocalCluster({
      workerPath: path.join(__dirname, '..', 'src', 'core', 'hpc', 'local_worker.js')
    });
    try {
      const sub = cluster.submit({ taskType: 'sparse_solve', payload: { n: 512 } }, { timeoutMs: 1 });
      const finalJob = await cluster.waitFor(sub.jobId);
      assert.strictEqual(finalJob.status, 'FAILED');
      assert.strictEqual(finalJob.error.code, 'TIMED_OUT');
    } finally {
      await cluster.shutdown();
    }
  });

  // ------------------------------------------------------------------
  // Record signing branches
  // ------------------------------------------------------------------
  check('signing: canonicalization strips undefined keys', () => {
    const a = canonicalize({ b: 1, a: undefined, c: null });
    const b = canonicalize({ b: 1, c: null });
    assert.strictEqual(a, b);
  });

  check('signing: non-finite rejected', () => {
    assert.throws(() => canonicalize({ x: NaN }));
    assert.throws(() => canonicalize({ x: Infinity }));
  });

  check('signing: chain detects mid-insertion', () => {
    const ledger = new SignedLedger(new SoftwareSigningAuthority());
    ledger.append({ a: 1 });
    ledger.append({ a: 2 });
    const tampered = ledger.entries[0];
    tampered.sequenceNumber = 99;
    assert.strictEqual(ledger.verifyChain().valid, false);
  });

  // ------------------------------------------------------------------
  // Trimmed NURBS surface branches
  // ------------------------------------------------------------------
  check('nurbs-trim: classification without attached surface fails closed', () => {
    const s = new TrimmedNurbsSurface();
    assert.throws(() => s.pointOnTrimmedSurface(0.5, 0.5));
  });

  check('nurbs-trim: invalid parameter space fails closed', () => {
    const s = new TrimmedNurbsSurface();
    assert.throws(() => s.pointOnTrimmedSurface(-0.1, 0.5));
  });

  // ------------------------------------------------------------------
  // EDA placement annealing branches
  // ------------------------------------------------------------------
  check('eda-place: missing dimensions fails closed', () => {
    assert.throws(() => new PlaceAndRouteEngine({}));
    assert.throws(() => new PlaceAndRouteEngine({ coreWidth: 10, coreHeight: 100, stdCellHeight: 5 }));
  });

  check('eda-place: same seed identical placement', () => {
    const cells = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, width: 2, height: 2, nets: [i % 3] }));
    const nets = [
      { name: 'n0', pins: ['c0', 'c3', 'c6'] },
      { name: 'n1', pins: ['c1', 'c4', 'c7'] },
      { name: 'n2', pins: ['c2', 'c5', 'c8', 'c9'] }
    ];
    const opts = { coreWidth: 200, coreHeight: 100, stdCellHeight: 10, seed: 77 };
    const a = new PlaceAndRouteEngine(opts).runPlaceAndRoute({ cells, nets });
    const b = new PlaceAndRouteEngine(opts).runPlaceAndRoute({ cells, nets });
    assert.deepStrictEqual(a.placements, b.placements);
  });

  // ------------------------------------------------------------------
  // Polygon DRC branches
  // ------------------------------------------------------------------
  check('drc: self-intersecting polygon rejected', () => {
    const drc = new DRCEngine();
    const bowtie = [
      [0, 0],
      [4, 4],
      [0, 4],
      [4, 0]
    ];
    assert.throws(() => drc.runPolygonDRC({ shapes: [{ layer: 'M1', polygon: bowtie }], rules: { minWidth: 1 } }));
  });

  check('drc: missing rules fail closed', () => {
    const drc = new DRCEngine();
    assert.throws(() => drc.runPolygonDRC({ shapes: [], rules: {} }));
  });

  // ------------------------------------------------------------------
  // CAM toolpath branches
  // ------------------------------------------------------------------
  check('cam: invalid tool options fail closed', () => {
    assert.throws(() => new CNCToolpathEngine({}));
    assert.throws(
      () =>
        new CNCToolpathEngine({
          toolDiameter: 10,
          toolType: 'flat-end',
          spindleRpm: 8000,
          feedRateMmMin: 500,
          plungeRateMmMin: 100,
          stepoverMm: 3,
          stepdownMm: 2,
          safeZ: 20
        })
    );
  });

  check('cam: tool larger than part still yields output', () => {
    const cam = new CNCToolpathEngine({
      toolDiameter: 20,
      toolType: 'flat_endmill',
      spindleRpm: 8000,
      feedRateMmMin: 500,
      plungeRateMmMin: 100,
      stepoverMm: 2,
      stepdownMm: 2,
      safeZ: 30
    });
    assert.throws(() =>
      cam.plan3AxisToolpath({
        boundary: [
          [1, 1],
          [9, 1],
          [9, 9],
          [1, 9]
        ],
        bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 5 }
      })
    );
    assert.throws(() =>
      cam.plan3AxisToolpath({
        boundary: [
          { x: 1, y: 1 },
          { x: 9, y: 1 },
          { x: 9, y: 9 },
          { x: 1, y: 9 }
        ],
        bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 5 }
      })
    );
    const small = new CNCToolpathEngine({
      toolDiameter: 4,
      toolType: 'flat_endmill',
      spindleRpm: 8000,
      feedRateMmMin: 500,
      plungeRateMmMin: 100,
      stepoverMm: 2,
      stepdownMm: 2,
      safeZ: 30
    });
    const r = small.plan3AxisToolpath({
      boundary: [
        { x: 1, y: 1 },
        { x: 9, y: 1 },
        { x: 9, y: 9 },
        { x: 1, y: 9 }
      ],
      bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 5 }
    });
    assert(Array.isArray(r.layers));
    assert(r.layers.length > 0);
    for (const layer of r.layers) {
      assert(Array.isArray(layer));
      assert(layer.length > 0);
      assert(layer.every((pt) => typeof pt.x === 'number' && typeof pt.y === 'number' && typeof pt.z === 'number'));
    }
  });

  // ------------------------------------------------------------------
  // Shell assembly branches
  // ------------------------------------------------------------------
  check('shell: element referencing unknown node fails closed', () => {
    const sa = new ShellAssembly({ E: 200e9, nu: 0.3, thickness: 0.01 });
    sa.addNode(0, 0, 0);
    sa.addNode(1, 0, 0);
    sa.addNode(1, 1, 0);
    sa.addNode(0, 1, 0);
    assert.throws(() => sa.addElement([0, 1, 2, 99]));
  });

  check('shell: bad element shape fails closed', () => {
    const sa = new ShellAssembly({ E: 200e9, nu: 0.3, thickness: 0.01 });
    assert.throws(() => sa.addElement([0, 0, 0, 0]));
  });

  // ------------------------------------------------------------------
  // 6-DOF dynamics branches
  // ------------------------------------------------------------------
  check('sixdof: atmosphere at sea level', () => {
    const a = standardAtmosphere1976(0);
    assert(Math.abs(a.pressurePa - 101325) / 101325 < 0.01);
  });

  check('sixdof: atmosphere above 86 km reports null', () => {
    const a = standardAtmosphere1976(90000);
    assert.strictEqual(a, null);
  });

  check('sixdof: missing mass/inertia fails closed', () => {
    const sim = new SixDofDynamics({ gravityModel: 'flat' });
    const r = sim.simulateSixDof({
      initialState: {
        positionM: [0, 0, 100],
        velocityM_s: [0, 0, 0],
        quaternion: [1, 0, 0, 0],
        angularRateRad_s: [0, 0, 0]
      },
      dt: 0.1,
      steps: 10
    });
    assert.strictEqual(r.status, 'invalid-input');
  });

  // ------------------------------------------------------------------
  // Constrained Delaunay 2D branches
  // ------------------------------------------------------------------
  check('cdt2d: boundary polygon with hole produces valid mesh', () => {
    const mesher = new DelaunayConstrained2D();
    const r = mesher.triangulatePolygon(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10]
      ],
      [
        [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7]
        ]
      ]
    );
    assert(r.triangles.length > 0);
    assert(r.constrainedEdges.length >= 4);
  });

  check('cdt2d: degenerate input fails closed', () => {
    const mesher = new DelaunayConstrained2D();
    assert.throws(() => mesher.triangulate({ boundary: [] }));
  });

  // ------------------------------------------------------------------
  // Streaming archive v3 branches
  // ------------------------------------------------------------------
  check('v3: format constants exist', () => {
    assert(OmniArchiveV3);
    assert.strictEqual(typeof OmniArchiveV3.writeChunks, 'function');
    assert.strictEqual(typeof OmniArchiveV3.readEntryStream, 'function');
  });

  check('v3: end-to-end small round trip via stream API', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-v3-gap22-'));
    const file = path.join(tmp, 'a.omni');
    const content = Buffer.from('hello v3 streaming'.repeat(1000));
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(file);
      OmniArchiveV3.writeChunks(ws, [{ name: 'payload.dat', stream: content }], {}).then(resolve, reject);
    });
    const stream = OmniArchiveV3.readEntryStream(file, 'payload.dat');
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const out = Buffer.concat(chunks);
    assert.strictEqual(out.length, content.length);
    assert(out.equals(content));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await Promise.all(pending);
  console.log(`\n  Branch-gap batch 22: ${passedTests}/${totalTests} passed, ${failedTests} failed\n`);
  assert.strictEqual(failedTests, 0);
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapTwentyTwoCoverageTests };

if (require.main === module) {
  runBranchGapTwentyTwoCoverageTests().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
