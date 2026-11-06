'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 6).
 *
 * EDA parsers/exporters, CAD CSG/naming, compliance toolkit, adapters,
 * OmniAI intent routing, and contact FEM validation branches.
 */

const assert = require('assert');

const { parseLiberty } = require('../src/core/eda/liberty_parser');
const { GerberExporter } = require('../src/core/eda/gerber_exporter');
const { SpiceEngine } = require('../src/core/eda/spice_engine');
const { CSGMeshBooleans, CSGSolid } = require('../src/core/cad/csg_mesh_booleans');
const { PersistentNamingManager } = require('../src/core/cad/persistent_naming_manager');
const { ToolQualificationKit } = require('../src/core/compliance/tool_qualification_kit');
const { PDMEngineAdapter } = require('../src/core/pdm/pdm_engine_adapter');
const { EDAEngineAdapter } = require('../src/core/eda/eda_engine_adapter');
const { OmniAIEngine } = require('../src/core/ai/omni_ai_engine');
const { ContactFEM3D } = require('../src/core/cae/contact_fem_3d');
const { AerospaceEngineAdapter } = require('../src/core/aerospace/aerospace_engine_adapter');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');

async function runBranchGapSixCoverageTests() {
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

  // ---------------------------------------------------------------
  // Liberty parser error branches
  // ---------------------------------------------------------------
  check('parseLiberty error branches', () => {
    const LIB = 'library (demo_lib) {\n';
    assert.throws(() => parseLiberty(null), /string/);
    assert.throws(() => parseLiberty('/* unterminated'), /Unterminated block comment/);
    assert.throws(() => parseLiberty(LIB + '@'), /Illegal character/);
    assert.throws(() => parseLiberty(LIB + 'cell (c) {'), /Unexpected end|Unterminated cell/);
    assert.throws(
      () => parseLiberty(LIB + 'cell (c) {\npin (p) {\ndirection : bogus;\n}\n}'),
      /Unsupported pin direction/
    );
    assert.throws(
      () => parseLiberty(LIB + 'cell (c) {\npin (p) {\ndirection : input;\n}'),
      /Unterminated (pin|cell) block/
    );
    assert.throws(
      () => parseLiberty(LIB + 'cell (c) {\npin (p) {\ndirection : input;\n}\npin (p) {\ndirection : input;\n}\n}'),
      /Duplicate pin/
    );
  });

  // ---------------------------------------------------------------
  // Gerber exporter branches
  // ---------------------------------------------------------------
  check('GerberExporter error and success branches', () => {
    const g = GerberExporter;
    assert.throws(() => g.formatCoord(NaN), /Gerber coordinates/);
    assert.throws(() => g.formatCoord(2000), /Gerber coordinates/);
    assert.strictEqual(g.formatCoord(1.5), '00150000');
    assert.throws(() => g.getGerberHeader(' '), /non-empty Gerber layer/);
    assert.throws(() => g.requireLayoutRecord(null), /PCB layout/);
    assert.throws(() => g.requireArray({}, 'traces'), /traces/);
    assert.throws(() => g.requireArray({ traces: new Array(10001) }, 'traces'), /10,000/);
    assert.throws(() => g.normalizeAperture(null, 'a'), /must be an object/);
    assert.throws(() => g.normalizeAperture({ shape: 'TRIANGLE' }, 'a'), /CIRCLE or RECT/);
    assert.strictEqual(g.normalizeAperture({ shape: 'CIRCLE', diameterMm: 1 }, 'a').kind, 'C');
    assert.throws(() => g.exportTopCopper({ traces: [], pads: [], vias: [] }), /At least one/);
    assert.throws(() => g.exportTopCopper({ traces: [null], pads: [], vias: [] }), /Each trace/);
    assert.throws(() => g.exportTopCopper({ traces: [{ x1: 0, y1: 0, x2: 1, y2: 1 }], pads: [], vias: [] }), /width/);
    assert.throws(() => g.exportNCDrill({ holes: [null] }), /Each drill hole/);
    assert.throws(() => g.exportNCDrill({ holes: [{ x: 0, y: 0, diameterMm: 0 }] }), /Each drill/);
    assert.throws(
      () =>
        g.exportBoardOutline({
          boardOutline: {
            points: [
              [0, 0],
              [1, 0]
            ],
            outlineWidthMm: 1
          }
        }),
      /at least three/
    );
    assert.throws(() => g.exportBoardOutline({}), /boardOutline object/);
    const layout = {
      traces: [{ x1: 0, y1: 0, x2: 10, y2: 0, widthMm: 0.2 }],
      pads: [{ x: 5, y: 5, widthMm: 2, heightMm: 2, shape: 'RECT' }],
      vias: [{ x: 1, y: 1, outerDiameterMm: 0.8, drillDiameterMm: 0.4 }],
      solderMaskOpenings: [],
      holes: [{ x: 2, y: 2, diameterMm: 1 }],
      boardOutline: {
        outlineWidthMm: 0.2,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 }
        ]
      }
    };
    const pkg = g.generateManufacturingPackage(layout);
    assert(pkg && typeof pkg === 'object');
    assert(pkg.topCopper && typeof pkg.topCopper === 'string');
    assert(pkg.boardOutline_GKO && typeof pkg.boardOutline_GKO === 'string');
  });

  // ---------------------------------------------------------------
  // Spice engine branches
  // ---------------------------------------------------------------
  check('SpiceEngine DC and transient branches', () => {
    const engine = new SpiceEngine();
    engine.addVoltageSource('v1', 'n1', '0', 5, { type: 'STEP', v1: 0, v2: 5, delay: 0 });
    engine.addResistor('r1', 'n1', 'n2', 100);
    engine.addResistor('r2', 'n2', '0', 100);
    const dc = engine.solveDCOperatingPoint();
    assert(dc && typeof dc === 'object');
    const tr = engine.runTransient(0.002, 0.0001);
    assert(tr && typeof tr === 'object');
  });

  // ---------------------------------------------------------------
  // CSG mesh booleans branches
  // ---------------------------------------------------------------
  check('CSGMeshBooleans branches', () => {
    const a = CSGMeshBooleans.toCSGSolid({ size: [1, 1, 1], center: [0, 0, 0] });
    const b = CSGMeshBooleans.toCSGSolid({ dx: 1, dy: 1, dz: 1, center: [0, 0, 0] });
    assert(a instanceof CSGSolid);
    assert(b instanceof CSGSolid);
    const u = a.union(b);
    assert(u && u.polygons.length > 0);
    const i = a.intersect(b);
    assert(i && i.polygons.length > 0);
    const bShift = CSGMeshBooleans.toCSGSolid({ size: [1, 1, 1], center: [0.5, 0, 0] });
    const s = a.subtract(bShift);
    assert(s && typeof s === 'object');
    assert.throws(() => CSGMeshBooleans.toCSGSolid(null), /non-null/);
    assert.throws(() => CSGMeshBooleans.toCSGSolid({ faces: [[0, 1]] }), /Unsupported CSG solid format/);
    assert.throws(
      () => CSGMeshBooleans.toCSGSolid({ vertices: [{ x: 0, y: 0, z: 0 }], faces: [[0, 1, 99]] }),
      /at least three valid vertex indices/
    );
    const brep = BRepPrimitives.createBox(1, 1, 1);
    const fromBrep = CSGMeshBooleans.toCSGSolid(brep);
    assert(fromBrep && fromBrep.polygons.length > 0);
  });

  // ---------------------------------------------------------------
  // Persistent naming manager branches
  // ---------------------------------------------------------------
  check('PersistentNamingManager branches', () => {
    const pnm = new PersistentNamingManager();
    const key = PersistentNamingManager.computeGeometryKey('FACE', { x: 0, y: 0, z: 0 });
    assert(typeof key === 'string');
    const rec = pnm.getOrCreateEntityByGeometry(key);
    assert.strictEqual(rec.created, true);
    const found = pnm.getEntityByGeometry(key);
    assert.strictEqual(found.found, true);
    const op = pnm.recordOperation('EXTRUDE', { entityIds: [rec.tag] });
    assert(op && typeof op === 'object');
    const id = pnm.splitEntity(rec.tag, ['a', 'b']);
    assert(Array.isArray(id));
    const traced = pnm.traceEntity(rec.tag);
    assert(traced && typeof traced === 'object');
  });

  // ---------------------------------------------------------------
  // Tool qualification kit branches
  // ---------------------------------------------------------------
  check('ToolQualificationKit branches', () => {
    const kit = new ToolQualificationKit({ targetSafetyStandard: 'DO-178C' });
    const summary = kit.executeQualificationSuite({
      testCases: [
        { id: 't1', description: 'test one', status: 'PASS' },
        { id: 't2', status: 'FAIL' }
      ],
      coverage: { functions: { covered: 10, total: 12 } },
      defectTracking: { opened: 2, closed: 1 },
      configMgmt: { baselines: 3, changes: 4, reviewed: 2 }
    });
    assert(summary && typeof summary === 'object');
    const report = kit.generateExperimentalDiagnosticReport();
    assert(typeof report === 'string' && report.length > 0);
    const kit2 = new ToolQualificationKit({});
    const summary2 = kit2.executeQualificationSuite({ testCases: [] });
    assert.strictEqual(summary2.passRatePercent, 0);
    const lvl = kit2._resolveLevel('DO-330');
    assert.strictEqual(typeof lvl, 'string');
  });

  // ---------------------------------------------------------------
  // PDM adapter branches
  // ---------------------------------------------------------------
  check('PDMEngineAdapter validation and execute branches', async () => {
    const adapter = new PDMEngineAdapter();
    const rejects = async (fn) => {
      try {
        await fn();
      } catch (err) {
        return err;
      }
      return null;
    };
    assert((await rejects(() => adapter.validate(null))) !== null);
    assert(
      (await rejects(() => adapter.validate({ domain: 'pdm', operation: 'compute_bom_rollup', parameters: {} }))) !==
        null
    );
    assert((await rejects(() => adapter.validate({ domain: 'pdm', operation: 'nope', parameters: {} }))) !== null);
    const ok = await adapter.validate({
      domain: 'pdm',
      operation: 'compute_bom_rollup',
      parameters: {
        rootAssembly: {
          partNumber: 'ROOT',
          name: 'Root',
          quantity: 1,
          unitMassKg: 1,
          unitCostUsd: 10,
          children: [{ partNumber: 'P1', name: 'Part1', quantity: 2, unitMassKg: 0.5, unitCostUsd: 2 }]
        }
      }
    });
    assert.strictEqual(ok, true);
    const out = await adapter.execute(
      {
        jobId: 'p1',
        domain: 'pdm',
        operation: 'compute_bom_rollup',
        parameters: {
          rootAssembly: {
            partNumber: 'ROOT',
            name: 'Root',
            quantity: 1,
            unitMassKg: 1,
            unitCostUsd: 10,
            children: [{ partNumber: 'P1', name: 'Part1', quantity: 2, unitMassKg: 0.5, unitCostUsd: 2 }]
          }
        }
      },
      () => {}
    );
    assert.strictEqual(out.status, 'COMPLETED');
  });

  // ---------------------------------------------------------------
  // EDA adapter branches
  // ---------------------------------------------------------------
  check('EDAEngineAdapter execute branches', async () => {
    const adapter = new EDAEngineAdapter();
    const spice = await adapter.execute(
      {
        jobId: 'e1',
        domain: 'eda',
        operation: 'simulate_spice_transient',
        parameters: {
          tStop: 0.002,
          dt: 0.0001,
          components: [
            {
              type: 'V',
              id: 'v1',
              nPlus: 'n1',
              nMinus: '0',
              dcValue: 5,
              waveform: { type: 'STEP', v1: 0, v2: 5, delay: 0 }
            },
            { type: 'R', id: 'r1', n1: 'n1', n2: 'n2', value: 1000 },
            { type: 'C', id: 'c1', n1: 'n2', n2: '0', value: 1e-6 },
            { type: 'L', id: 'l1', n1: 'n2', n2: 'n3', value: 1e-3 },
            { type: 'I', id: 'i1', nFrom: 'n3', nTo: '0', current: 0.001 },
            { type: 'D', id: 'd1', anode: 'n1', cathode: 'n2', is: 1e-14 },
            { type: 'M', id: 'm1', drain: 'n3', gate: 'n1', source: '0', model: 'NMOS', w: 1e-6, l: 0.18e-6 }
          ]
        }
      },
      () => {}
    );
    assert.strictEqual(spice.status, 'COMPLETED');
    const verilog = await adapter.execute(
      {
        jobId: 'e2',
        domain: 'eda',
        operation: 'synthesize_logic',
        parameters: { verilogSource: 'module m; endmodule', topModule: 'm' }
      },
      () => {}
    );
    assert.strictEqual(verilog.status, 'COMPLETED');
    const pnr = await adapter.execute(
      { jobId: 'e3', domain: 'eda', operation: 'place_and_route', parameters: { circuitData: { netlist: [] } } },
      () => {}
    );
    assert.strictEqual(pnr.status, 'COMPLETED');
    const spef = await adapter.execute(
      {
        jobId: 'e4',
        domain: 'eda',
        operation: 'parse_spef',
        parameters: {
          spefText:
            '*SPEF "1.0" "*DESIGN" "top" "*DATE" "2024" "*VENDOR" "x" "*PROGRAM" "y" "*VERSION" "0" "*DESIGN_FLOW" "x" "*DIVIDER" "/" "*DELIMITER" ":" "*BUS_DELIMITER" "[]" "D_NET n1 10" "CAP 1 n1:1 1" "RES 1 n1:1 n1:2 1" "END" '
        }
      },
      () => {}
    );
    assert.strictEqual(spef.status, 'COMPLETED');
  });

  // ---------------------------------------------------------------
  // OmniAI engine intent routing branches
  // ---------------------------------------------------------------
  check('OmniAIEngine processPrompt branches', () => {
    const ai = new OmniAIEngine();
    const drc = ai.processPrompt('run DRC on the layout');
    assert(drc && typeof drc === 'object');
    const optics = ai.processPrompt('optimize the optical system with DLS');
    assert(optics && typeof optics === 'object');
    const piping = ai.processPrompt('estimate piping hoop stress without expansion loop');
    assert(piping && typeof piping === 'object');
    const view = ai.processPrompt('show ray tracing with half cutaway');
    assert(view && typeof view === 'object');
    const bom = ai.processPrompt('consolidate the eBOM cost rollup');
    assert(bom && typeof bom === 'object');
    const intent = ai.parseUserIntent('run DRC on the layout');
    assert(intent && typeof intent === 'object');
    const drop = ai.processPrompt('phone drop test at 1.5 m with mass 200 g');
    assert(drop && typeof drop === 'object');
  });

  // ---------------------------------------------------------------
  // Contact FEM validation branches
  // ---------------------------------------------------------------
  check('ContactFEM3D validation branches', () => {
    assert.throws(() => new ContactFEM3D({ E: 0, nu: 0.3 }), /E/);
    assert.throws(() => new ContactFEM3D({ E: 200e9, nu: 1 }), /nu/);
    const contact = new ContactFEM3D({ E: 200e9, nu: 0.3 });
    assert.throws(() => contact.addHex([0, 1, 2]), /8/);
    const ids = [];
    for (let i = 0; i < 8; i++) ids.push(contact.addNode(0.1 * i, 0, 0));
    contact.addHex(ids);
    assert.strictEqual(contact.nodes.length, 8);
  });

  // ---------------------------------------------------------------
  // Aerospace adapter branches
  // ---------------------------------------------------------------
  check('AerospaceEngineAdapter validation and execute branches', async () => {
    const adapter = new AerospaceEngineAdapter();
    const rejects = async (fn) => {
      try {
        await fn();
      } catch (err) {
        return err;
      }
      return null;
    };
    assert((await rejects(() => adapter.validate(null))) !== null);
    assert(
      (await rejects(() => adapter.validate({ domain: 'aerospace', operation: 'nope', parameters: {} }))) !== null
    );
    const ok = await adapter.validate({
      domain: 'aerospace',
      operation: 'calculate_engine_performance',
      parameters: {
        chamberPressureBar: 100,
        ofRatio: 3.6,
        expansionRatio: 16,
        ambientPressureBar: 1,
        propellantType: 'LOX_LCH4',
        throatDiameterM: 0.1
      }
    });
    assert.strictEqual(ok, true);
    const out = await adapter.execute(
      {
        jobId: 'a1',
        domain: 'aerospace',
        operation: 'calculate_engine_performance',
        parameters: {
          chamberPressureBar: 100,
          ofRatio: 3.6,
          expansionRatio: 16,
          ambientPressureBar: 1,
          propellantType: 'LOX_LCH4',
          throatDiameterM: 0.1
        }
      },
      () => {}
    );
    assert.strictEqual(out.status, 'COMPLETED');
    const orbital = await adapter.execute(
      {
        jobId: 'a2',
        domain: 'aerospace',
        operation: 'calculate_orbital_transfer',
        parameters: { r1Meters: 7000e3, r2Meters: 35786e3 }
      },
      () => {}
    );
    assert.strictEqual(orbital.status, 'COMPLETED');
  });

  await Promise.all(pending);

  console.log('\n================================================================');
  console.log(`   BRANCH-GAP-6 RESULTS: ${passedTests}/${totalTests} passed; ${failedTests} failed`);
  console.log('================================================================');
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapSixCoverageTests };

if (require.main === module) {
  runBranchGapSixCoverageTests().then((stats) => {
    if (stats.failed > 0) process.exitCode = 1;
  });
}
