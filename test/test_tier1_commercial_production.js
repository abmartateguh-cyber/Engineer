/**
 * Experimental legacy module smoke checks (Suite 23)
 *
 * Validates:
 * 1. Experimental event-loop calculation queue dispatch.
 * 2. OmniAI 32-tool autonomous orchestrator with typed action envelopes.
 * 3. Tool-qualification helper returns an experimental diagnostic only.
 * 4. Experimental stress-line screening helper.
 * 5. Numerical singularity detection (PDN disconnected-node rejection & DLS conditioning).
 */

const assert = require('assert');
const { WorkerPoolEngine, getGlobalWorkerPool } = require('../src/core/math/worker_pool');
const { ComputeHostProcess } = require('../src/main/compute_host');
const { OmniAIEngine, OMNI_TOOLS } = require('../src/core/ai/omni_ai_engine');
const { ToolQualificationKit } = require('../src/core/compliance/tool_qualification_kit');
const { ASMESectionVIIIDiv2Analyzer } = require('../src/core/compliance/asme_section_viii_div2');
const { ASME_STRESS_SCREEN_SCHEMA } = require('../src/main/ipc/system_ipc');
const { validateSchema } = require('../src/main/ipc/define_handler');
const { PowerGridIRDropAnalyzer } = require('../src/core/eda/power_grid_ir_drop');
const { VariationalConstraintSolver } = require('../src/core/cad/variational_constraint_solver');
const {
  createSyntheticPdnAnalyzer,
  createSyntheticPdnMesh,
  SYNTHETIC_PDN_GEOMETRY
} = require('./support/experimental_pdn_inputs');

async function runTier1CommercialProductionTests() {
  console.log('\n================================================================');
  console.log('   RUNNING EXPERIMENTAL LEGACY MODULE SMOKE CHECKS (SUITE 23)     ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 6;

  // Test 1: Legacy event-loop task queue (not isolated worker execution)
  try {
    process.stdout.write('[P1] Legacy task queue asynchronous dispatch...\n');
    const pool = new WorkerPoolEngine();

    // Await the task so rejection and timeout failures affect the suite result.
    const result = await pool.dispatch(
      'VARIATIONAL_SOLVE',
      {
        points: [
          { id: 'P1', x: 0, y: 0, fixed: true },
          { id: 'P2', x: 39, y: 1, fixed: false }
        ],
        constraints: [
          { type: 'HORIZONTAL', point1: 'P1', point2: 'P2' },
          { type: 'DISTANCE', point1: 'P1', point2: 'P2', value: 40.0 }
        ]
      },
      { priority: 'HIGH' }
    );
    assert(result.success === true, 'Worker pool task must succeed');
    assert(result.computeTimeMs >= 0, 'Compute time must be recorded');
    assert.strictEqual(result.taskType, 'VARIATIONAL_SOLVE', 'Dispatched task type must be reported');

    const telemetry = pool.getTelemetry();
    assert.strictEqual(telemetry.executionMode, 'main-event-loop');
    assert.strictEqual(telemetry.cancellationSupported, false);
    assert.strictEqual(telemetry.timeoutEnforced, false);
    assert.strictEqual(telemetry.maxWorkers, 1, 'Legacy worker-count telemetry reports the actual serial queue');
    assert.strictEqual(telemetry.activeWorkers, 0, 'Legacy active-worker telemetry reports the actual idle state');
    assert.strictEqual(telemetry.averageComputeTimeMs, telemetry.averageExecutionTimeMs);

    assert.throws(
      () => new WorkerPoolEngine({ maxWorkers: 4 }),
      (error) => error.code === 'UNSUPPORTED' && /maxWorkers/.test(error.message)
    );
    await assert.rejects(
      pool.dispatch('VARIATIONAL_SOLVE', { points: [] }, { timeoutMs: 100 }),
      (error) => error.code === 'UNSUPPORTED' && /timeoutMs/.test(error.message)
    );
    await assert.rejects(
      pool.dispatch('VARIATIONAL_SOLVE', { points: [] }, { priority: 'URGENT' }),
      (error) => error.code === 'INVALID_INPUT' && /priority/.test(error.message)
    );

    const computeHost = new ComputeHostProcess();
    computeHost._executeKernel = async () => ({ testResult: true });
    await assert.rejects(
      computeHost.submitJob('TEST_DIAGNOSTIC', {}, { timeoutMs: 100 }),
      (error) => error.code === 'UNSUPPORTED' && /timeoutMs/.test(error.message)
    );
    await assert.rejects(
      computeHost.submitJob('TEST_DIAGNOSTIC', {}, { cancellationToken: {} }),
      (error) => error.code === 'UNSUPPORTED' && /cancellationToken/.test(error.message)
    );
    const cancellableHost = new ComputeHostProcess();
    cancellableHost._executeKernel = async () => ({ shouldNotRun: true });
    let queuedJobCancelled = false;
    cancellableHost.once('job:queued', ({ jobId }) => {
      queuedJobCancelled = cancellableHost.cancelJob(jobId);
    });
    await assert.rejects(
      cancellableHost.submitJob('TEST_DIAGNOSTIC', {}),
      (error) => error.code === 'ERR_JOB_CANCELLED'
    );
    assert.strictEqual(queuedJobCancelled, true, 'Queued cancellation is exposed before the job starts');
    assert.strictEqual(cancellableHost.getTelemetry().queuedCount, 0);

    const hostResult = await computeHost.submitJob('TEST_DIAGNOSTIC', {});
    assert.strictEqual(hostResult.success, true);
    assert.match(hostResult.telemetry.jobId, /^job_\d+_1$/, 'Job IDs include the host-local sequence');
    assert.strictEqual(Object.hasOwn(hostResult.telemetry, 'peakMemoryMb'), false);
    assert(Number.isFinite(hostResult.telemetry.heapUsedAtCompletionMb));
    const hostTelemetry = computeHost.getTelemetry();
    assert.strictEqual(hostTelemetry.runningCount, 0);
    assert.strictEqual(hostTelemetry.queuedCount, 0);
    assert.strictEqual(hostTelemetry.timeoutEnforced, false);

    console.log('  ✓ PASSED: Legacy task queue completed an asynchronous dispatch; isolation is not tested');
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED P1: ${err.message}`);
  }

  // Test 2: OmniAI 32-Tool Catalog & Prioritized Routing
  try {
    process.stdout.write('[P2] Legacy keyword router catalog and intent routing...\n');
    assert.strictEqual(OMNI_TOOLS.length, 32, 'The legacy router catalog has 32 entries');

    const ai = new OmniAIEngine();

    // Check specific compound intent routing
    const planHeal = ai.parseUserIntent('Heal dirty STEP model micro-gaps and check watertight');
    assert.strictEqual(planHeal.matchedTool, 'topological_healing');
    assert.strictEqual(planHeal.modalToOpen, 'modal-topological-healer');

    const planAsme = ai.parseUserIntent('Generate ASME Section VIII Div 2 compliance dossier for pressure vessel');
    assert.strictEqual(planAsme.matchedTool, 'asme_viii_div2_report');
    assert.strictEqual(planAsme.modalToOpen, 'modal-asme-report');

    const planDiff = ai.parseUserIntent('Run 3D CAD visual diff between revA and revB');
    assert.strictEqual(planDiff.matchedTool, 'git_cad_visual_diff');
    assert.strictEqual(planDiff.modalToOpen, 'modal-cad-diff');

    const planEbom = ai.parseUserIntent('Roll up eBOM procurement hierarchy and consolidate screws');
    assert.strictEqual(planEbom.matchedTool, 'engineering_bom_rollup');
    assert.strictEqual(planEbom.modalToOpen, 'modal-ebom-manager');
    const ebomPrompt = ai.processPrompt('Roll up eBOM procurement hierarchy and consolidate screws');
    assert.strictEqual(ebomPrompt.result.success, false);
    assert.strictEqual(ebomPrompt.result.status, 'unavailable');
    assert.match(ebomPrompt.assistantMessage, /No BOM calculation was run/);
    assert.doesNotMatch(ebomPrompt.assistantMessage, /mass estimate|cost estimate/i);

    console.log('  ✓ PASSED: Legacy router catalog smoke check completed');
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED P2: ${err.message}`);
  }

  // Test 3: Tool Qualification Kit with SHA-256 Cryptographic Seal
  try {
    process.stdout.write('[P3] Experimental test diagnostics and digest...\n');
    const tqk = new ToolQualificationKit({
      toolName: 'OmniEng Enterprise Workstation',
      targetSafetyStandard: 'DO-178C_DAL_A'
    });
    tqk.registerTestCase({
      id: 'TC_TIER1_001',
      description: 'Variational constraint solver residual norm under 1e-10',
      execute: () => ({ actual: 1.42e-12, expected: 1e-10, passes: true })
    });
    tqk.registerTestCase({
      id: 'TC_TIER1_002',
      description: 'Electromigration MTTF calculation under Black equation',
      execute: () => ({ actual: 4.5e7, expected: 1e6, passes: true })
    });

    const summary = tqk.executeQualificationSuite();
    assert.strictEqual(summary.dataStatus, 'experimental');
    assert.strictEqual(summary.status, 'diagnostic-only');
    assert(
      summary.sha256Digest && summary.sha256Digest.length === 64,
      'Diagnostic result digest must be 64-character hex'
    );

    const report = tqk.generateComplianceReport();
    assert(report.includes(summary.sha256Digest), 'Diagnostic report must include the result digest');
    assert(report.includes('not tool qualification'), 'Report must deny qualification status');
    assert(
      report.includes('TC_TIER1_001') && report.includes('1.42e-12'),
      'Diagnostic report must retain test IDs and actual values'
    );

    console.log(
      `  ✓ PASSED: Experimental diagnostic report generated with SHA-256 digest: ${summary.sha256Digest.substring(0, 16)}...`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED P3: ${err.message}`);
  }

  // Test 4: Experimental stress-line integration and caller-limit screening
  try {
    process.stdout.write('[P4] Experimental stress-line screen with explicit caller limit and assumptions...\n');
    assert.throws(() => new ASMESectionVIIIDiv2Analyzer(), /caller-supplied screening limit/i);
    const asme = new ASMESectionVIIIDiv2Analyzer({
      allowableStressS: 138.0,
      allowableStressSource: 'test fixture; not an approved material allowable'
    });
    const scl = [
      { x: -12.5, stressMpa: 104.2 },
      { x: -6.25, stressMpa: 94.8 },
      { x: 0.0, stressMpa: 91.75 },
      { x: 6.25, stressMpa: 90.1 },
      { x: 12.5, stressMpa: 82.5 }
    ];
    const evaluation = asme.evaluateStressClassificationLine(scl, 25.0, false);
    assert(evaluation.membraneStressPm < 138.0, 'Pm must be below the supplied screening limit');
    assert(evaluation.bendingStressPb > 0, 'Pb must be non-zero for linear gradient');
    assert(evaluation.suppliedLimitRatios.membrane > 1.0, 'Membrane supplied-limit ratio must exceed 1.0');
    assert.strictEqual(evaluation.dataStatus, 'caller-supplied-unverified');
    assert.strictEqual(evaluation.status, 'screening-only');
    assert.strictEqual(evaluation.assessmentStatus, 'no-code-assessment');
    assert.strictEqual(evaluation.allowableStressSource, 'test fixture; not an approved material allowable');
    assert.throws(
      () => asme.linearizeStressClassificationLine(scl, 25.0),
      /explicitly declare whether secondary thermal stress is present/i
    );
    assert.throws(
      () => asme.linearizeStressClassificationLine(scl, 25.0, true),
      (error) => error.code === 'UNSUPPORTED' && /cannot derive Q/.test(error.message)
    );
    assert.throws(
      () =>
        asme.linearizeStressClassificationLine(
          [
            { x: -12.5, stressMpa: 10 },
            { x: 0, stressMpa: 5 }
          ],
          25,
          false
        ),
      /include both supplied wall surfaces/i
    );
    assert.throws(
      () =>
        asme.linearizeStressClassificationLine(
          [
            { x: -12.5, stressMpa: 10 },
            { x: 12.5, stressMpa: Number.NaN }
          ],
          25,
          false
        ),
      /finite x and stressMpa/i
    );

    const ipcPayload = {
      sclPoints: scl,
      wallThicknessMm: 25.0,
      allowableStressS: 138.0,
      allowableStressSource: 'test fixture',
      isSecondaryThermal: false
    };
    assert.doesNotThrow(() => validateSchema(ipcPayload, ASME_STRESS_SCREEN_SCHEMA));
    assert.throws(
      () => validateSchema({ ...ipcPayload, allowableStressSource: undefined }, ASME_STRESS_SCREEN_SCHEMA),
      /Missing required object property 'allowableStressSource'/
    );
    assert.throws(
      () => validateSchema({ ...ipcPayload, unexpected: true }, ASME_STRESS_SCREEN_SCHEMA),
      /Unexpected object properties/
    );

    const cert = asme.generateComplianceCertificate('V-101 Separator');
    assert(cert.includes('Experimental Stress Screening'));
    assert(cert.includes('not an ASME BPVC report'));
    assert(!cert.includes('FORM A-1 MANUFACTURER'));

    console.log('  ✓ PASSED: Experimental stress-line calculation used explicit, unverified inputs');
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED P4: ${err.message}`);
  }

  // Test 5: Caller-supplied PDN arithmetic and singularity detection
  try {
    process.stdout.write('[P5] Experimental PDN lumped-network smoke and singularity detection...\n');
    const pdn = createSyntheticPdnAnalyzer();
    const mesh = createSyntheticPdnMesh(pdn, 4, 4);
    const res = pdn.solveStaticIRDrop(mesh, [0], [{ nodeId: 15, current: 0.005 }]);
    assert(Number.isFinite(res.minVoltage), 'Synthetic lumped network must return a finite voltage');
    assert.strictEqual(res.validationLevel, 'experimental');
    assert.strictEqual(res.dataStatus, 'caller-supplied-unverified');
    assert.strictEqual(typeof res.belowSuppliedThreshold, 'boolean');

    const disconnectedMesh = createSyntheticPdnMesh(pdn, 2, 2);
    disconnectedMesh.resistors = disconnectedMesh.resistors.filter(
      (resistor) => resistor.nodeA < 2 && resistor.nodeB < 2
    );
    assert.throws(
      () => pdn.solveStaticIRDrop(disconnectedMesh, [0], [{ nodeId: 3, current: 0.001 }]),
      /positive definite|singular/i,
      'A disconnected component must fail instead of receiving an implicit shunt'
    );

    assert.throws(
      () =>
        new PowerGridIRDropAnalyzer({}).createGridMesh(
          4,
          4,
          SYNTHETIC_PDN_GEOMETRY.pitchX,
          SYNTHETIC_PDN_GEOMETRY.pitchY,
          SYNTHETIC_PDN_GEOMETRY.sheetRho,
          SYNTHETIC_PDN_GEOMETRY.wireWidth
        ),
      /vdd/,
      'A supply voltage must be supplied explicitly'
    );
    assert.throws(() => pdn.solveStaticIRDrop(mesh, [0]), /current loads/);
    assert.throws(() => pdn.evaluateBlacksEM(1e5, 25), /coefficients and provenance/);
    assert.throws(() => pdn.simulateDynamicDecapDroop({ peakCurrent: 1 }), /riseTime/);
    const transientTerms = pdn.simulateDynamicDecapDroop({
      peakCurrent: 1,
      riseTime: 1e-9,
      packageInductance: 1e-9,
      decapCapacitance: 1e-6,
      rEffective: 0.1
    });
    assert.strictEqual(transientTerms.validationLevel, 'experimental');
    assert.match(transientTerms.modelDescription, /no transient waveform solved/);
    assert(!Object.hasOwn(transientTerms, 'bufferedMinV'));

    const computeHost = new ComputeHostProcess();
    const routed = await computeHost.submitJob('PDN_IR_DROP', {
      options: { vdd: 1.2, maxDropThresholdPercent: 3, metalThickness: 0.2e-6 },
      rows: 2,
      cols: 2,
      ...SYNTHETIC_PDN_GEOMETRY,
      pads: [0],
      loads: [{ nodeId: 3, current: 0.001 }]
    });
    assert.strictEqual(routed.result.validationLevel, 'experimental');
    await assert.rejects(computeHost.submitJob('PDN_IR_DROP', { rows: 2, cols: 2 }), /vdd/);

    console.log(
      `  ✓ PASSED: Synthetic 16-node lumped network returned experimental values; disconnected network was rejected (Max drop = ${res.maxDrop.toExponential(3)} V)`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED P5: ${err.message}`);
  }

  // Test 6: Variational Geometric Constraint Solver DOF Analysis
  try {
    process.stdout.write('[P6] Variational Constraint Solver (Newton-Raphson SVD & Degrees of Freedom)...\n');
    const solver = new VariationalConstraintSolver();
    solver.addPoint('P1', 0, 0, true);
    solver.addPoint('P2', 38.0, 2.0, false);
    solver.addPoint('P3', 2.0, 28.0, false);

    solver.addConstraint({ type: 'HORIZONTAL', point1: 'P1', point2: 'P2' });
    solver.addConstraint({ type: 'VERTICAL', point1: 'P1', point2: 'P3' });
    solver.addConstraint({ type: 'DISTANCE', point1: 'P1', point2: 'P2', value: 40.0 });
    solver.addConstraint({ type: 'DISTANCE', point1: 'P1', point2: 'P3', value: 30.0 });

    const sol = solver.solve();
    assert(sol.converged === true, 'Variational solver must converge');
    assert.strictEqual(sol.degreesOfFreedom, 0, 'Fully-constrained triangle must have 0 DOF remaining');
    assert.strictEqual(sol.status, 'FULLY_CONSTRAINED', 'Status must be FULLY_CONSTRAINED');

    console.log('  ✓ PASSED: Experimental variational solver reported 0 remaining degrees of freedom.');
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED P6: ${err.message}`);
  }

  console.log('\n================================================================');
  console.log(`  SUMMARY: ${passed} / ${total} experimental legacy module smoke assertions passed`);
  console.log('================================================================\n');

  return { passed, total, allPassed: passed === total };
}

if (require.main === module) {
  runTier1CommercialProductionTests()
    .then((result) => {
      process.exitCode = result.allPassed ? 0 : 1;
    })
    .catch((err) => {
      console.error(err.stack || err.message);
      process.exitCode = 1;
    });
}

module.exports = { runTier1CommercialProductionTests };
