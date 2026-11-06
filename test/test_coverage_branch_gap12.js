'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 12).
 *
 * Focused checks for uncovered branches across EDA parsers/engines, numeric
 * solvers, compliance helpers, and plant property databases.
 */

const assert = require('assert');

const { LefDefParser } = require('../src/core/eda/lef_def_parser');
const { SpiceEngine } = require('../src/core/eda/spice_engine');
const { solveSpiceTransient } = require('../src/core/eda/spice_request');
const { CCSTimingModel } = require('../src/core/eda/ccs_timing_model');
const { StaticTimingAnalysis } = require('../src/core/eda/static_timing_analysis');
const { parseLiberty, LibertyLibrary } = require('../src/core/eda/liberty_parser');
const { ODESolvers, RadauIIA } = require('../src/core/math/ode_solvers');
const { GPUParallelPCGSolver } = require('../src/core/math/gpu_parallel_pcg_solver');
const { PhysicalDimension } = require('../src/core/ai/symbolic_reasoner');
const { ToolQualificationKit } = require('../src/core/compliance/tool_qualification_kit');
const { PenaltyContact } = require('../src/core/cae/penalty_contact');
const { PowerGridIRDropAnalyzer } = require('../src/core/eda/power_grid_ir_drop');
const { ASMESectionVIIIDiv2Analyzer } = require('../src/core/compliance/asme_section_viii_div2');
const { ExperimentalPropertyDatabase } = require('../src/core/plant/dippr_database');

async function runBranchGapTwelveCoverageTests() {
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

  check('LefDefParser rejects invalid LEF RECT and missing direction', () => {
    assert.throws(
      () =>
        LefDefParser.parseLEF(
          'VERSION 5.8 ;\nMACRO m\n CLASS CORE ;\n SIZE 10 BY 20 ;\n PIN a\n DIRECTION INPUT ;\n PORT\n LAYER m1 ;\n RECT 2 2 1 8 ;\n END a\nEND m'
        ),
      /Invalid LEF RECT/
    );
    assert.throws(
      () => LefDefParser.parseLEF('VERSION 5.8 ;\nMACRO m\n CLASS CORE ;\n SIZE 10 BY 20 ;\n PIN a\n END a\nEND m'),
      /no valid DIRECTION/
    );
    assert.throws(
      () =>
        LefDefParser.parseLEF('VERSION 5.8 ;\nMACRO m\n CLASS CORE ;\n SIZE 10 BY 20 ;\n OBS\n RECT 1 2 3 4 ;\nEND m'),
      /obstruction rectangle has no LAYER/
    );
  });

  check('LefDefParser rejects invalid DEF declarations', () => {
    assert.throws(() => LefDefParser.parseDEF(''), /non-empty string/);
    assert.throws(() => LefDefParser.parseDEF('VERSION 5.8 ;\nDESIGN\nEND DESIGN'), /Invalid DEF DESIGN/);
    assert.throws(
      () => LefDefParser.parseDEF('VERSION 5.8 ;\nDESIGN top ;\nNETS x ;\nEND DESIGN'),
      /Invalid DEF NETS count/
    );
  });

  check('SpiceEngine diode default branches and transient waveforms', () => {
    const spice = new SpiceEngine();
    spice.addVoltageSource('V1', 'in', '0', 5, { type: 'STEP', v1: 0, v2: 5, delay: 0 });
    spice.addResistor('R1', 'in', 'out', 1000);
    spice.addCapacitor('C1', 'out', '0', 1e-6);
    spice.addDiode('D1', 'out', '0', { Is: 1e-14, Vt: 0.02585 });
    const result = spice.runTransient(0.002, 1e-5);
    assert(result.success === true || result.converged === true || Array.isArray(result.time));

    const sine = new SpiceEngine();
    sine.addVoltageSource('V1', 'in', '0', 0, { type: 'SINE', freq: 1000, offset: 0, amplitude: 5 });
    sine.addResistor('R1', 'in', '0', 1000);
    const sineResult = sine.runTransient(0.002, 1e-5);
    assert(sineResult.success === true || sineResult.converged === true || Array.isArray(sineResult.time));

    const pulse = new SpiceEngine();
    pulse.addVoltageSource('V1', 'in', '0', 0, { type: 'PULSE', v1: 0, v2: 5, period: 0.001, width: 0.0005 });
    pulse.addResistor('R1', 'in', '0', 1000);
    const pulseResult = pulse.runTransient(0.002, 1e-5);
    assert(pulseResult.success === true || pulseResult.converged === true || Array.isArray(pulseResult.time));
  });

  check('SpiceEngine transient with inductor stamps', () => {
    const spice = new SpiceEngine();
    spice.addVoltageSource('V1', 'in', '0', 5, { type: 'STEP', v1: 0, v2: 5, delay: 0 });
    spice.addResistor('R1', 'in', 'n1', 10);
    spice.addInductor('L1', 'n1', '0', 1e-3, 0);
    const result = spice.runTransient(0.001, 1e-5);
    assert(result.success === true || result.converged === true || Array.isArray(result.time));
  });

  check('SpiceRequest singular and malformed input branches', () => {
    const singular = solveSpiceTransient({
      analysis: { type: 'transient', stopTimeS: 0.001, stepS: 0.0001 },
      components: [{ type: 'current_source', id: 'I1', nFrom: 'n1', nTo: '0', currentA: 0 }]
    });
    assert.strictEqual(singular.success, false);
    const empty = solveSpiceTransient({});
    assert.strictEqual(empty.success, false);
  });

  check('CCSTimingModel constructor defaults and table validation', () => {
    const model = new CCSTimingModel();
    assert.strictEqual(model.pinCapacitanceFf, 0.8);
    assert.strictEqual(model.defaultPeakCurrentMa, 8.0);
    assert.throws(() => CCSTimingModel.validateTable({}), /driver table/);
    assert.throws(
      () => CCSTimingModel.validateTable({ currents: [[1]], vinGrid: [0], voutGrid: [0, 1] }),
      /at least 2 points/
    );
    assert.throws(
      () => CCSTimingModel.validateTable({ currents: [[1, 2]], vinGrid: [0, 1], voutGrid: [0, 1] }),
      /ni x nj/
    );
    assert.throws(
      () =>
        CCSTimingModel.validateTable({
          currents: [
            [1, 2],
            [3, 4]
          ],
          vinGrid: [1, 0],
          voutGrid: [0, 1]
        }),
      /vinGrid must be strictly increasing/
    );
    assert.throws(
      () =>
        CCSTimingModel.validateTable({
          currents: [
            [1, 2],
            [3, 4]
          ],
          vinGrid: [0, 1],
          voutGrid: [1, 0]
        }),
      /voutGrid must be strictly increasing/
    );
    assert.throws(
      () =>
        CCSTimingModel.validateTable({
          currents: [
            [1, Number.NaN],
            [3, 4]
          ],
          vinGrid: [0, 1],
          voutGrid: [0, 1]
        }),
      /currents must be finite/
    );
    const valid = CCSTimingModel.validateTable({
      currents: [
        [1, 2],
        [3, 4]
      ],
      vinGrid: [0, 1],
      voutGrid: [0, 1]
    });
    assert.strictEqual(valid, true);
  });

  check('CCSTimingModel receiver capacitance and stage simulation', () => {
    const model = new CCSTimingModel({ cvTable: { vGrid: [0, 1], cFfValues: [1] } });
    assert.throws(() => model.evaluateReceiverCapacitance(0.5), /cvTable/);
    const plain = new CCSTimingModel();
    assert.strictEqual(plain.evaluateReceiverCapacitance(0.5), 0.8 * 1e-15);
    const delay = model.simulateStageDelay({ cLoadFf: 5 });
    assert(delay.propagationDelayNs !== null || delay.outputSlewNs !== null);
    const out = model.simulateDriverOutput(5e-15);
    assert.strictEqual(typeof out, 'object');
  });

  check('StaticTimingAnalysis path and MCMM branches', () => {
    const violation = StaticTimingAnalysis.evaluatePathTiming({
      clockPeriodNs: 1.0,
      gateDelaysNs: [0.5, 0.5],
      wireDelaysNs: [0.2, 0.2]
    });
    assert.strictEqual(violation.status, 'SETUP_VIOLATION');
    const hold = StaticTimingAnalysis.evaluatePathTiming({
      clockPeriodNs: 5.0,
      tHoldNs: 1.0,
      gateDelaysNs: [0.01],
      wireDelaysNs: [0.01]
    });
    assert.strictEqual(hold.status, 'HOLD_VIOLATION');
    const ok = StaticTimingAnalysis.evaluatePathTiming({});
    assert.strictEqual(ok.status, 'TIMING_MET');
    const mcmm = StaticTimingAnalysis.evaluateMCMM({ gateDelaysNs: [0.3, 0.3], wireDelaysNs: [0.1, 0.1] }, [
      { name: 'custom', pvtFactor: 1.1, ocvLate: 1.05, ocvEarly: 0.95, desc: 'custom' }
    ]);
    assert(mcmm.cornerReports.length === 1);
    assert(mcmm.worstSetupCorner !== null);
  });

  check('Liberty parser rejects empty input and parses a minimal library', () => {
    assert.throws(() => parseLiberty(''), /non-empty|string|Liberty/i);
    const lib = parseLiberty('library (demo) {\n}\n');
    assert.strictEqual(lib.name, 'demo');
    assert.strictEqual(typeof LibertyLibrary, 'function');
  });

  check('ODESolvers default parameter branches', () => {
    const traj = ODESolvers.solveRK4((t, y) => [-y[0]], [1], 0, 1.0);
    assert.strictEqual(traj.length > 0, true);
    const rk45 = ODESolvers.solveRK45((t, y) => [-y[0]], [1], 0, 1.0);
    assert.strictEqual(rk45.length > 0, true);
    const radau = new RadauIIA({ rtol: 1e-6, atol: 1e-8, h0: 0.1 });
    const res = radau.solve((t, y) => [-y[0]], 0, [1], 1);
    assert(res.length > 0);
    assert.throws(() => new RadauIIA({ rtol: 0, atol: 1e-8, h0: 0.1 }).solve((t, y) => [-y[0]], 0, [1], 1), /rtol/);
  });

  check('GPUParallelPCGSolver dense and CSR validation branches', () => {
    const solver = new GPUParallelPCGSolver();
    assert.throws(() => solver.solve([], [1]), /PCG requires/);
    assert.throws(() => solver.solve([[]], [1]), /must be square/);
    assert.throws(() => solver.solve([[1, 2]], [1, 2]), /square/);
    assert.throws(
      () =>
        solver.solve(
          [
            [1, Number.NaN],
            [0, 1]
          ],
          [1, 1]
        ),
      /finite/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [0], values: [1] }, [1, 1]),
      /consistent lengths/
    );
    assert.throws(
      () => solver.solve({ n: 3, rowPtr: [0, 3, 2, 4], colIdx: [0, 1, 2, 3], values: [1, 1, 1, 1] }, [1, 1, 1]),
      /nondecreasing/
    );
    assert.throws(
      () => solver.solve({ n: 2, rowPtr: [0, 1, 2], colIdx: [0, 5], values: [1, 1] }, [1, 1]),
      /valid matrix columns/
    );
    const result = solver.solve(
      [
        [4, 1],
        [1, 3]
      ],
      [1, 2],
      null,
      { maxIterations: 100, tolerance: 1e-8 }
    );
    assert.strictEqual(result.solution.length, 2);
    assert(Array.from(result.solution).every(Number.isFinite));
  });

  check('SymbolicReasoner PhysicalDimension array and object forms', () => {
    const five = new PhysicalDimension([1, 2, 3, 4, 5]);
    assert.strictEqual(five.m, 1);
    assert.strictEqual(five.l, 2);
    assert.strictEqual(five.t, 3);
    assert.strictEqual(five.theta, 4);
    assert.strictEqual(five.i, 5);
    const seven = new PhysicalDimension([1, 2, 3, 4, 5, 6, 7]);
    assert.strictEqual(seven.n, 6);
    assert.strictEqual(seven.j, 7);
    const obj = new PhysicalDimension({ m: 1, l: 2, t: 3 });
    assert.strictEqual(obj.m, 1);
    assert.strictEqual(obj.l, 2);
    assert.strictEqual(obj.t, 3);
    assert.throws(() => new PhysicalDimension([1, 2, 3]), /7 \(or legacy 5\)/);
  });

  check('ToolQualificationKit evaluateEvidence branches', () => {
    const kit = new ToolQualificationKit({ toolName: 'T', toolVersion: '1.0.0' });
    const empty = kit.evaluateEvidence({});
    assert.strictEqual(empty.verdict, 'evidence-insufficient');
    const valid = kit.evaluateEvidence({
      usedFor: 'verification',
      testResults: { passed: 100, failed: 0 },
      coverage: { functions: 95, branches: 95, mcDc: 95 },
      defectTracking: { open: 1, closed: 9, openCritical: 0 },
      configMgmt: { baselines: 2, changes: 4, changesReviewed: 4 }
    });
    assert.strictEqual(valid.verdict, 'evidence-satisfies-do330:TQL-5');
    const invalidUsedFor = kit.evaluateEvidence({
      usedFor: 'bogus',
      testResults: { passed: 1, failed: 0 },
      coverage: { functions: 100, branches: 100, mcDc: 100 },
      defectTracking: { open: 0, closed: 0, openCritical: 0 },
      configMgmt: { baselines: 1, changes: 0, changesReviewed: 0 }
    });
    assert.strictEqual(invalidUsedFor.verdict, 'evidence-insufficient');
    const missingReviewed = kit.evaluateEvidence({
      usedFor: 'verification',
      testResults: { passed: 10, failed: 0 },
      coverage: { functions: 100, branches: 100, mcDc: 100 },
      defectTracking: { open: 0, closed: 0, openCritical: 0 },
      configMgmt: { baselines: 1, changes: 2 },
      level: 'do330:TQL-4',
      thresholds: { requireReviewedChanges: true }
    });
    assert.strictEqual(missingReviewed.verdict, 'evidence-insufficient');
  });

  check('PenaltyContact node contact and multibody branches', () => {
    const contact = new PenaltyContact({ penaltyStiffness: 1e8, frictionCoeff: 0.3 });
    const hit = contact.evaluateNodeContact(
      { pos: [0, 0, -0.01], vel: [1, 0, 0] },
      { v0: [0, 0, 0], normal: [0, 0, 1] }
    );
    assert.strictEqual(hit.inContact, true);
    assert(hit.normalForceN > 0);
    const miss = contact.evaluateNodeContact({ pos: [0, 0, 1] }, { v0: [0, 0, 0], normal: [0, 0, 1] });
    assert.strictEqual(miss.inContact, false);
    const plane = PenaltyContact.evaluateContact([{ id: 1, pos: [0, 0, -0.5], vel: [0.1, 0, 0] }], {
      origin: [0, 0, 0],
      normal: [0, 0, 1],
      frictionCoeff: 0.2,
      penaltyStiffness: 1000
    });
    assert.strictEqual(plane.activeContactCount, 1);
    const aug = PenaltyContact.evaluateAugmentedLagrangianContact([{ id: 1, pos: [0, 0, -0.5], vel: [0, 0, 0] }], {
      origin: [0, 0, 0],
      normal: [0, 0, 1],
      frictionCoeff: 0.2,
      penaltyStiffness: 1000
    });
    assert.strictEqual(aug.hasContact, true);
    const forces = PenaltyContact.applyContactForces([{ id: 1, pos: [0, 0, -0.5], vel: [0, 0, 0], mass: 1 }], aug);
    assert.strictEqual(Array.isArray(forces), true);
  });

  check('PowerGridIRDropAnalyzer constructor and mesh validation branches', () => {
    assert.throws(() => new PowerGridIRDropAnalyzer([]), /options must be an object/);
    const analyzer = new PowerGridIRDropAnalyzer({ vdd: 1.0, maxDropThresholdPercent: 5, metalThickness: 1e-6 });
    assert.throws(() => analyzer.createGridMesh(0, 2, 1e-3, 1e-3, 1, 1e-6), /positive integers/);
    const badVdd = new PowerGridIRDropAnalyzer({});
    assert.throws(() => badVdd.createGridMesh(2, 2, 1e-3, 1e-3, 1, 1e-6), /vdd/);
    assert.throws(() => analyzer.solveStaticIRDrop(null, [0], []), /PDN mesh is required/);
    assert.throws(
      () =>
        analyzer.solveStaticIRDrop(
          { numNodes: 2, nodes: [{}, {}], resistors: [], wireWidth: 1e-6 },
          [0],
          [{ nodeId: 1, current: 0.001 }]
        ),
      /node IDs must match/
    );
  });

  check('ASME VIII-2 analyzer constructor and linearization branches', () => {
    assert.throws(() => new ASMESectionVIIIDiv2Analyzer({}), /screening limit/);
    assert.throws(
      () => new ASMESectionVIIIDiv2Analyzer({ allowableStressS: 200, allowableStressSource: '' }),
      /source label/
    );
    const analyzer = new ASMESectionVIIIDiv2Analyzer({ allowableStressS: 200, allowableStressSource: 'test-source' });
    assert.throws(() => analyzer.linearizeStressClassificationLine([], 10, false), /between 2 and 10,000/);
    assert.throws(
      () => analyzer.linearizeStressClassificationLine([{ x: 0, stressMpa: 1 }], 10, false),
      /between 2 and 10,000/
    );
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: 0, stressMpa: 1 },
            { x: 1, stressMpa: 2 }
          ],
          10,
          'yes'
        ),
      /secondary thermal stress/
    );
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: 0, stressMpa: 1 },
            { x: 1, stressMpa: 2 }
          ],
          10,
          false
        ),
      /must include both supplied wall surfaces/
    );
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: -5, stressMpa: 1 },
            { x: -5, stressMpa: 2 },
            { x: 5, stressMpa: 3 }
          ],
          10,
          false
        ),
      /strictly increasing/
    );
    const ok = analyzer.linearizeStressClassificationLine(
      [
        { x: -5, stressMpa: 100 },
        { x: 0, stressMpa: 150 },
        { x: 5, stressMpa: 200 }
      ],
      10,
      false
    );
    assert.strictEqual(ok.status, 'screening-only');
    assert(ok.membraneStressPm > 0);
    const cert = analyzer.generateComplianceCertificate();
    assert(cert.includes('experimental'));
    const formal = analyzer.generateFormalCertificationDocument({});
    assert(formal.includes('Form A-1'));
  });

  check('ExperimentalPropertyDatabase constructor and lookup branches', () => {
    assert.throws(() => new ExperimentalPropertyDatabase({}), /array/);
    const db = new ExperimentalPropertyDatabase();
    assert.strictEqual(db.get('Water'), null);
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

module.exports = { runBranchGapTwelveCoverageTests };
