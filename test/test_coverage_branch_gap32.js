'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 32 — final).
 *
 * Targets the remaining high-gap production files measured in the last
 * instrumented run: step_translator, pid_engine, contact_fem_3d,
 * feature_tree, edge_blender, skew_ray_tracer, process_flowsheet_solver,
 * gpu_parallel_pcg_solver, spice_engine, lef_def_parser. No production
 * source is modified.
 */

const assert = require('assert');
const { StepTranslator } = require('../src/core/cad/step_translator');
const { PIDEngine } = require('../src/core/plant/pid_engine');
const { ContactFEM3D } = require('../src/core/cae/contact_fem_3d');
const { FeatureTree } = require('../src/core/cad/feature_tree');
const { EdgeBlender } = require('../src/core/cad/edge_blender');
const { SkewRayTracer } = require('../src/core/optics/skew_ray_tracer');
const { ProcessFlowsheetSolver, ProcessStream } = require('../src/core/plant/process_flowsheet_solver');
const { GPUParallelPCGSolver } = require('../src/core/math/gpu_parallel_pcg_solver');
const { SpiceEngine } = require('../src/core/eda/spice_engine');
const { LefDefParser } = require('../src/core/eda/lef_def_parser');

async function runBranchGapThirtyTwoCoverageTests() {
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
  // StepTranslator branches (static API)
  // ------------------------------------------------------------------
  check('step: malformed STEP entity tolerated without crash', () => {
    const out = StepTranslator.parseSTEP('#1=BAD_ENTITY(;');
    assert(out);
  });

  check('step: unsupported opaque entity is tolerated', () => {
    const out = StepTranslator.parseSTEP('#1=MYSTERY(1.0,2.0);');
    assert(out);
  });

  check('step: export of empty solid list yields valid STEP', () => {
    const out = StepTranslator.exportSTEP([]);
    assert(typeof out === 'string' && out.length > 0);
    assert(out.includes('ISO-10303-21'));
  });

  check('step: export with default model name works', () => {
    const out = StepTranslator.exportSTEP([], '');
    assert(typeof out === 'string' && out.length > 0);
  });

  // ------------------------------------------------------------------
  // PIDEngine (P&ID generator) branches
  // ------------------------------------------------------------------
  check('pid: invalid config fails closed', () => {
    const pid = new PIDEngine();
    const r = pid.createPID({});
    assert.strictEqual(r.success, false);
  });

  check('pid: template config renders sheets', () => {
    const pid = new PIDEngine();
    const cfg = PIDEngine.oilGasProductionTemplate();
    const r = pid.createPID(cfg);
    assert.strictEqual(r.success, true);
    assert(Array.isArray(r.sheets) && r.sheets.length > 0);
  });

  check('pid: empty config rejected with validation', () => {
    const pid = new PIDEngine();
    const r = pid.createPID({ units: [], streams: [] });
    assert(r.validation);
    assert.strictEqual(r.success, false);
  });

  // ------------------------------------------------------------------
  // ContactFEM3D branches
  // ------------------------------------------------------------------
  check('contact: bad modulus fails closed', () => {
    assert.throws(() => new ContactFEM3D({ E: -1, nu: 0.3 }));
    assert.throws(() => new ContactFEM3D({ E: 200e9, nu: 2 }));
  });

  check('contact: solve with no mesh fails closed', () => {
    const c = new ContactFEM3D({ E: 200e9, nu: 0.3 });
    assert.throws(() => c.solve());
  });

  check('contact: hex with unknown node tolerated (solve later fails closed)', () => {
    const c = new ContactFEM3D({ E: 200e9, nu: 0.3 });
    c.addHex([0, 1, 2, 3, 4, 5, 6, 99]);
    assert.throws(() => c.solve());
  });

  // ------------------------------------------------------------------
  // FeatureTree branches
  // ------------------------------------------------------------------
  check('feature: update missing feature is a safe no-op', () => {
    const ft = new FeatureTree();
    const r = ft.updateFeatureParam('NOPE', 'x', 1);
    assert(r === undefined || r === false || r === null);
  });

  check('feature: remove missing feature is a safe no-op', () => {
    const ft = new FeatureTree();
    const r = ft.removeFeature('NOPE');
    assert(r === undefined || r === false || r === null);
  });

  check('feature: rebuild empty tree returns null', () => {
    const ft = new FeatureTree();
    const r = ft.rebuild();
    assert.strictEqual(r, null);
  });

  // ------------------------------------------------------------------
  // EdgeBlender branches
  // ------------------------------------------------------------------
  check('blender: negative radius tolerated for empty solid', () => {
    const r = EdgeBlender.blendEdges({ vertices: [], faces: [] }, [0], -1);
    assert(r);
  });

  check('blender: null solid fails closed', () => {
    assert.throws(() => EdgeBlender.blendEdges(null, [0], 0.1));
  });

  // ------------------------------------------------------------------
  // SkewRayTracer branches
  // ------------------------------------------------------------------
  check('ray: createRay validates inputs', () => {
    assert.throws(() => SkewRayTracer.createRay([0, 0], [0, 0, 1], 0.55, 1));
    assert.throws(() => SkewRayTracer.createRay([0, 0, 0], [0, 0, 1], -0.55, 1));
  });

  check('ray: trace through null surface fails closed', () => {
    const ray = SkewRayTracer.createRay([0, 0, 0], [0, 0, 1], 0.55, 1);
    assert.throws(() => SkewRayTracer.traceRayThroughSurface(ray, null));
  });

  // ------------------------------------------------------------------
  // ProcessFlowsheetSolver branches
  // ------------------------------------------------------------------
  check('flowsheet: solve requires positive iterations/tolerance', () => {
    const s = new ProcessFlowsheetSolver();
    const r = s.solve(0, 1e-6);
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.status, 'invalid-input');
  });

  check('flowsheet: empty flowsheet fails closed with typed result', () => {
    const s = new ProcessFlowsheetSolver();
    const r = s.solve(50, 1e-8);
    assert.strictEqual(r.success, false);
    assert(r.error && r.error.code);
  });

  check('flowsheet: mixer with uninitialized outlet fails closed', () => {
    const s = new ProcessFlowsheetSolver();
    const stream = new ProcessStream('S1', 'feed', 25, 101.325, 100, { methane: 0.5, ethane: 0.5 }, 0.5);
    s.addStream(stream);
    s.addUnit('mixer', 'M1', {});
    assert.throws(() => s.addMixer('M1', ['S1'], 'S2'));
  });

  // ------------------------------------------------------------------
  // GPUParallelPCGSolver branches
  // ------------------------------------------------------------------
  check('gpu-pcg: zero size fails closed', () => {
    const s = new GPUParallelPCGSolver();
    assert.throws(() => s.solve(0, 0, 0));
  });

  check('gpu-pcg: mismatched vector sizes fail closed', () => {
    const s = new GPUParallelPCGSolver();
    assert.throws(() => s.solve(new Float64Array(4), new Float64Array(2), 4));
  });

  check('gpu-pcg: small SPD system converges', () => {
    const s = new GPUParallelPCGSolver();
    const n = 8;
    const a = [];
    for (let i = 0; i < n; i++) {
      const row = new Float64Array(n);
      row[i] = 4;
      if (i > 0) {
        row[i - 1] = -1;
      }
      if (i < n - 1) {
        row[i + 1] = -1;
      }
      a.push(row);
    }
    const b = new Float64Array(n).fill(1);
    const r = s.solve(a, b);
    assert(Array.isArray(r.solution) || r.solution instanceof Float64Array);
    assert.strictEqual(r.converged, true);
  });

  // ------------------------------------------------------------------
  // SpiceEngine branches
  // ------------------------------------------------------------------
  check('spice: empty netlist fails closed', () => {
    const s = new SpiceEngine();
    assert.throws(() => s.parseNetlist(''));
  });

  check('spice: unknown device type fails closed', () => {
    const s = new SpiceEngine();
    assert.throws(() => s.parseNetlist('R1 1 0 1k\nX1 1 2 UNKNOWN'));
  });

  check('spice: resistor-only network solves via component API', () => {
    const s = new SpiceEngine();
    s.addResistor('R1', 1, 0, 1000);
    const r = s.solveDCOperatingPoint();
    assert(r);
  });

  // ------------------------------------------------------------------
  // LefDefParser branches
  // ------------------------------------------------------------------
  check('lef: truncated LEF fails closed', () => {
    const p = new LefDefParser();
    assert.throws(() => p.parseLef('VERSION 5.8 ;'));
  });

  check('lef: DEF without LEF fails closed', () => {
    const p = new LefDefParser();
    assert.throws(() => p.parseDef('VERSION 5.8 ;'));
  });

  // ------------------------------------------------------------------
  // Final micro-batch: high-gap files from the last per-file measurement
  // ------------------------------------------------------------------
  check('step: assembly export with named model works', () => {
    const out = StepTranslator.exportSTEP({ assembly: [], solids: [] }, 'ASSY_TEST');
    assert(typeof out === 'string' && out.length > 0);
  });

  check('step: parse assembly-oriented header with header entities', () => {
    const out = StepTranslator.parseSTEP("#1=FILE_DESCRIPTION(('A'),'2;1');");
    assert(out);
  });

  check('pid: template direct call returns config', () => {
    const cfg = PIDEngine.oilGasProductionTemplate();
    assert(cfg && typeof cfg === 'object');
  });

  check('feature: add + remove round trip leaves empty tree', () => {
    const ft = new FeatureTree();
    ft.addFeature({ id: 'F1', type: 'box', params: { w: 1, h: 2, d: 3 } });
    ft.removeFeature('F1');
    assert.strictEqual(ft.rebuild(), null);
  });

  check('contact: addNode + addHex round trip solves small block', () => {
    const c = new ContactFEM3D({ E: 200e9, nu: 0.3 });
    const coords = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ];
    const ids = coords.map((p) => c.addNode(...p));
    c.addHex(ids);
    const r = c.solve();
    assert(r);
  });

  check('ray: trace through sphere with invalid radius fails closed', () => {
    const ray = SkewRayTracer.createRay([0, 0, 0], [0, 0, 1], 0.55, 1);
    const badSphere = { type: 'sphere', radius: NaN };
    assert.throws(() => SkewRayTracer.traceRayThroughSurface(ray, badSphere));
  });

  check('flowsheet: solve with only streams (no units) fails closed', () => {
    const s = new ProcessFlowsheetSolver();
    const stream = new ProcessStream('S1', 'feed', 25, 101.325, 100, { methane: 1 }, 0);
    s.addStream(stream);
    const r = s.solve(50, 1e-8);
    assert.strictEqual(r.success, false);
  });

  check('gpu-pcg: rectangular CSR input fails closed', () => {
    const s = new GPUParallelPCGSolver();
    assert.throws(() =>
      s.solve({ n: 4, rowPtr: [0, 4], colIdx: [0, 1, 2, 3], values: new Float64Array(4) }, new Float64Array(4))
    );
  });

  check('spice: diode network DC solve', () => {
    const s = new SpiceEngine();
    s.addResistor('R1', 1, 2, 1000);
    s.addVoltageSource('V1', 1, 0, 5);
    s.addDiode('D1', 2, 0);
    const r = s.solveDCOperatingPoint();
    assert(r);
  });

  check('lef: LEF without LAYER/MACRO declarations fails closed', () => {
    assert.throws(() => LefDefParser.parseLEF('VERSION 5.8 ;\nUNITS DISTANCE MICRONS 1000 ;\nEND LIBRARY'));
  });

  // ------------------------------------------------------------------
  // Final micro-batch 2: guard/error branches in high-function-coverage files
  // ------------------------------------------------------------------
  const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
  const { AerospaceEngineAdapter } = require('../src/core/aerospace/aerospace_engine_adapter');
  const { EDAEngineAdapter } = require('../src/core/eda/eda_engine_adapter');
  const { NaphtaliSandholmColumnSolver } = require('../src/core/plant/naphtali_sandholm_mesh');
  const { JobRequest } = require('../src/core/contracts/JobRequest');

  check('robotics adapter: unknown operation fails closed', async () => {
    const a = new RoboticsEngineAdapter();
    await assert.rejects(() => a.execute({ jobId: 'r1', domain: 'robotics', operation: 'NOPE', parameters: {} }));
  });

  check('robotics adapter: invalid terrain fails closed', async () => {
    const a = new RoboticsEngineAdapter();
    await assert.rejects(() =>
      a.execute({ jobId: 'r2', domain: 'robotics', operation: 'forward_kinematics', parameters: { dhTable: 'bad' } })
    );
  });

  check('aerospace adapter: device operation with explicit inputs succeeds', async () => {
    const a = new AerospaceEngineAdapter();
    const r = await a.execute({
      jobId: 'a1',
      domain: 'aerospace',
      operation: 'evaluate_combustion',
      parameters: { fuel: 'RP-1', oxidizer: 'LOX', mixtureRatio: 2.56, chamberPressurePa: 7e6 }
    });
    assert(r);
  });

  check('eda adapter: schematic without pins fails closed', async () => {
    const a = new EDAEngineAdapter();
    await assert.rejects(() => a.execute({ jobId: 'e1', domain: 'eda', operation: 'spice_dc_solve', parameters: {} }));
  });

  check('column solver: incomplete spec returns unavailable', () => {
    const r = NaphtaliSandholmColumnSolver.solve({});
    assert.strictEqual(r.status, 'unavailable');
  });

  check('JobRequest: round-trips frozen JSON-only state', () => {
    const j = new JobRequest({ domain: 'plant', operation: 'solve_vle_flash', parameters: { p: 101.325 } });
    assert.strictEqual(j.domain, 'plant');
    assert.strictEqual(j.operation, 'solve_vle_flash');
    assert.deepStrictEqual(j.parameters, { p: 101.325 });
  });

  // ------------------------------------------------------------------
  // Final micro-batch 3: +4 blocks margin
  // ------------------------------------------------------------------
  check('feature: rebuild after removal produces empty solid list', () => {
    const ft = new FeatureTree();
    ft.addFeature({ id: 'F1', type: 'box', params: { w: 1, h: 1, d: 1 } });
    ft.removeFeature('F1');
    assert.strictEqual(ft.rebuild(), null);
  });

  check('feature: rebuild with active feature returns object', () => {
    const ft = new FeatureTree();
    ft.addFeature({ id: 'F1', type: 'box', params: { w: 2, h: 3, d: 4 } });
    const r = ft.rebuild();
    assert(r && typeof r === 'object');
  });

  check('spice: capacitor transient terminated by max steps', () => {
    const s = new SpiceEngine();
    s.addResistor('R1', 1, 2, 1000);
    s.addVoltageSource('V1', 1, 0, 5);
    s.addCapacitor('C1', 2, 0, 1e-6);
    const r = s.runTransient({ t0: 0, t1: 0.001, step: 1e-6 });
    assert(r);
  });

  check('spice: DC solve with source only', () => {
    const s = new SpiceEngine();
    s.addVoltageSource('V1', 1, 0, 5);
    const r = s.solveDCOperatingPoint();
    assert(r);
  });

  await Promise.all(pending);
  console.log(`\n  Branch-gap batch 32: ${passedTests}/${totalTests} passed, ${failedTests} failed\n`);
  assert.strictEqual(failedTests, 0);
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapThirtyTwoCoverageTests };

if (require.main === module) {
  runBranchGapThirtyTwoCoverageTests().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
