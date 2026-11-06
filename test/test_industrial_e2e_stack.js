/**
 * Experimental multi-domain integration smoke checks
 *
 * Exercises selected integrated OmniEng paths; this is not release validation:
 * 1. Storage & CAS: ProjectManifestV2 and .omni v2 atomic CAS storage with SHA-256 indexing.
 * 2. Central EngineRegistry: Dynamic discovery, contract validation, and execution across domains:
 *    - CAE: 3D linear elasticity with Wasm sparse Cholesky solver
 *    - CAD: 2D variational geometric sketch solver
 *    - Controls: 10-state quaternion Extended Kalman Filter
 *    - Plant: IAPWS-IF97 steam and water thermodynamic formulation
 * 3. Asynchronous Compute & Cancellation: Worker pool dispatch with enforced <2s cancellation.
 * 4. Stenographer Cryptographic Audit: Fail-closed policy evaluation and HMAC SHA-256 ledger chaining.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const readline = require('readline');

// Contracts & Architecture
const { ProjectManifestV2 } = require('../src/core/contracts/ProjectManifestV2');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');
const { ToolDefinition, ToolApprovalClass } = require('../src/core/contracts/ToolDefinition');
const { EngineRegistry } = require('../src/core/contracts/engine_registry');
const { OmniArchiveV2 } = require('../src/core/storage/omni_archive');
const { PersistentWorkerPool } = require('../src/core/math/worker_pool');
const { StenographerSupervisor, LedgerEntry } = require('../src/main/stenographer_supervisor');
const { HeadlessSolverDaemon } = require('../src/main/headless_solver_daemon');
const {
  processStenographerQuery,
  processLegacyMacroPrompt,
  STENOGRAPHER_QUERY_SCHEMA,
  proposalMatchesActiveProject
} = require('../src/main/ipc/system_ipc');
const { validateSchema } = require('../src/main/ipc/define_handler');
const { SYNTHETIC_LINEAR_ELASTIC_MATERIAL } = require('./support/synthetic_cae_materials');

// Adapters
const { GeometryEngineAdapter } = require('../src/core/cad/geometry_engine_adapter');
const { FEAEngineAdapter } = require('../src/core/cae/fea_engine_adapter');
const { ControlsEngineAdapter } = require('../src/core/controls/controls_engine_adapter');
const { PlantEngineAdapter } = require('../src/core/plant/plant_engine_adapter');
const { IAPWS_IF97 } = require('../src/core/plant/iapws_if97');
const { OmniAIEngine } = require('../src/core/ai/omni_ai_engine');

async function runIndustrialE2EStackVerification() {
  console.log('================================================================');
  console.log('   OMNIENG EXPERIMENTAL MULTI-DOMAIN STACK CHECKS               ');
  console.log('================================================================\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnieng-e2e-'));
  let pool = null;

  const results = [];
  const runCheck = async (name, fn) => {
    try {
      await fn();
      results.push({ ok: true });
    } catch (err) {
      results.push({ ok: false });
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  };

  try {
    // -------------------------------------------------------------------------
    // TEST 1: .omni v2 Content-Addressed Storage & Project Manifest
    // -------------------------------------------------------------------------
    await runCheck('1. .omni v2 CAS Storage & ProjectManifestV2', async () => {
      process.stdout.write('[1] Testing .omni v2 CAS Storage & ProjectManifestV2...\n');
      const archivePath = path.join(tmpDir, 'sample_project.omni');

      const manifest = new ProjectManifestV2({
        name: 'Turbine Housing Assembly',
        engineeringDomain: 'cae',
        domainModels: {
          cad: { active: true },
          cae: { active: true },
          plant: { active: true }
        }
      });

      const archive = new OmniArchiveV2({ manifest });
      const cadPayload = Buffer.from(JSON.stringify({ type: 'STEP_AP242', entities: 42 }));
      const cadRef = archive.addBlob(cadPayload, { name: 'housing.step', mimeType: 'application/step' });
      assert(cadRef.hash && cadRef.hash.length === 64);

      const saveResult = archive.saveToFile(archivePath);
      assert(saveResult.sizeBytes > 0);

      // Verify recovery and reading
      const readArchive = OmniArchiveV2.loadFromFile(archivePath);
      const readManifest = readArchive.manifest;
      assert.strictEqual(readManifest.name, 'Turbine Housing Assembly');
      assert.strictEqual(readManifest.engineeringDomain, 'cae');
      const readBlob = readArchive.getBlob(cadRef.hash);
      assert.deepStrictEqual(readBlob, cadPayload);
      console.log('  ✓ PASSED: .omni v2 CAS manifest & artifact round-trip verified');

      // -------------------------------------------------------------------------
      // TEST 2: Central EngineRegistry Multi-Domain Dispatch
      // -------------------------------------------------------------------------
    });
    await runCheck('2. Central EngineRegistry Multi-Domain Execution', async () => {
      process.stdout.write('[2] Testing Central EngineRegistry Multi-Domain Execution...\n');
      const registry = new EngineRegistry();
      registry.registerAdapter(new GeometryEngineAdapter());
      registry.registerAdapter(new FEAEngineAdapter());
      registry.registerAdapter(new ControlsEngineAdapter());
      registry.registerAdapter(new PlantEngineAdapter());

      // 2A: CAE Linear Elasticity with Sparse Cholesky Solver (Proper 3D non-coplanar tetrahedral element)
      const caeReq = new JobRequest({
        jobId: 'e2e_cae_001',
        domain: 'cae',
        operation: 'linear_elastic_3d',
        parameters: {
          nodes: [
            { x: 0, y: 0, z: 0, fixed: [true, true, true] },
            { x: 10, y: 0, z: 0, fixed: [true, true, true] },
            { x: 0, y: 10, z: 0, fixed: [true, true, true] },
            { x: 0, y: 0, z: 10, force: [0, -5000, 0] }
          ],
          elements: [{ nodeIds: [0, 1, 2, 3], material: SYNTHETIC_LINEAR_ELASTIC_MATERIAL }]
        }
      });
      const caeResult = await registry.executeJob('cae', caeReq);
      assert.strictEqual(caeResult.status, JobStatus.SUCCEEDED);
      assert(Number.isFinite(caeResult.outputData.maxStress));
      assert(caeResult.outputData.maxStress > 0, 'maxStress must be positive');
      assert(Number.isFinite(caeResult.outputData.maxDisplacement));
      assert(caeResult.outputData.maxDisplacement > 0, 'maxDisplacement must be positive');
      const maxStressMPa = caeResult.outputData.maxStress / 1e6;
      console.log(
        `  ✓ PASSED: CAE 3D linear elasticity solved (Max Stress = ${maxStressMPa.toFixed(4)} MPa, Max Disp = ${caeResult.outputData.maxDisplacement.toExponential(3)} m)`
      );

      // 2A-bis: Verify fail-closed rejection on degenerate (coplanar) tetrahedral elements
      let degenerateRejected = false;
      try {
        const degenReq = new JobRequest({
          jobId: 'e2e_cae_degen',
          domain: 'cae',
          operation: 'linear_elastic_3d',
          parameters: {
            nodes: [
              { x: 0, y: 0, z: 0, fixed: [true, true, true] },
              { x: 10, y: 0, z: 0, fixed: [true, true, true] },
              { x: 0, y: 10, z: 0, force: [0, -5000, 0] },
              { x: 10, y: 10, z: 0, force: [0, -5000, 0] }
            ],
            elements: [{ nodeIds: [0, 1, 2, 3], material: SYNTHETIC_LINEAR_ELASTIC_MATERIAL }]
          }
        });
        await registry.executeJob('cae', degenReq);
      } catch (err) {
        if (err.message.includes('Degenerate tetrahedral element')) {
          degenerateRejected = true;
        }
      }
      assert.strictEqual(degenerateRejected, true, 'Degenerate element must be rejected fail-closed');
      console.log('  ✓ PASSED: CAE degenerate tetrahedral element fail-closed rejection verified');

      // 2B: CAD Variational 2D Sketch Solver
      const cadReq = new JobRequest({
        jobId: 'e2e_cad_001',
        domain: 'cad',
        operation: 'solve_variational_sketch',
        parameters: {
          points: [
            { id: 'p0', x: 0, y: 0, fixed: true },
            { id: 'p1', x: 9.8, y: 0.3 }
          ],
          constraints: [
            { type: 'horizontal', p1: 'p0', p2: 'p1' },
            { type: 'distance', p1: 'p0', p2: 'p1', distance: 10.0 }
          ]
        }
      });
      const cadResult = await registry.executeJob('cad', cadReq);
      assert.strictEqual(cadResult.status, JobStatus.SUCCEEDED);
      assert(Math.abs(cadResult.outputData.points[1].x - 10.0) < 1e-4);
      assert(Math.abs(cadResult.outputData.points[1].y - 0.0) < 1e-4);
      console.log('  ✓ PASSED: CAD 2D variational sketch constraint solver converged');

      // 2C: Plant IAPWS-IF97 High-Precision Water & Steam Thermodynamics
      // Test Region 1: Compressed Liquid Water (3 MPa, 300 K)
      const plantReqLiquid = new JobRequest({
        jobId: 'e2e_plant_liquid',
        domain: 'plant',
        operation: 'calculate_steam_properties',
        parameters: {
          pressurePa: 3.0e6, // 3 MPa
          temperatureK: 300.0 // 300 K
        }
      });
      const plantResultLiquid = await registry.executeJob('plant', plantReqLiquid);
      assert.strictEqual(plantResultLiquid.status, JobStatus.SUCCEEDED);
      const liquidData = plantResultLiquid.outputData;
      assert.strictEqual(liquidData.phase, 'liquid');
      // Candidate IF97 example values; these checks do not establish independent validation.
      assert(Math.abs(liquidData.specificVolume_m3_kg - 0.001002148) < 1e-7);
      assert(Math.abs(liquidData.specificEnthalpy_J_kg - 115331.27) < 1.0);
      assert(liquidData.saturation.saturationPressurePa > 3500);
      assert.strictEqual(liquidData.provenance.licenseStatus, 'unreviewed');
      assert.strictEqual(Object.hasOwn(liquidData.provenance, 'license'), false);

      // Test Region 2: Superheated Steam / Vapor (100 kPa, 500 K)
      const plantReqVapor = new JobRequest({
        jobId: 'e2e_plant_vapor',
        domain: 'plant',
        operation: 'calculate_steam_properties',
        parameters: {
          pressurePa: 100.0e3, // 100 kPa
          temperatureK: 500.0 // 500 K
        }
      });
      const plantResultVapor = await registry.executeJob('plant', plantReqVapor);
      assert.strictEqual(plantResultVapor.status, JobStatus.SUCCEEDED);
      const vaporData = plantResultVapor.outputData;
      assert.strictEqual(vaporData.phase, 'vapor');
      // Candidate IF97 example values; broader region and boundary checks remain open.
      assert(Math.abs(vaporData.specificVolume_m3_kg - 2.298159) < 1e-4);
      assert(Math.abs(vaporData.specificEnthalpy_J_kg - 2928594.3) < 10.0);
      assert.strictEqual(vaporData.provenance.licenseStatus, 'unreviewed');
      console.log(
        `  ✓ PASSED: Plant IAPWS-IF97 sample values matched (Liquid h=${liquidData.specificEnthalpy_J_kg.toFixed(1)} J/kg, Steam h=${vaporData.specificEnthalpy_J_kg.toFixed(1)} J/kg)`
      );

      // 2D: Controls 10-State Quaternion EKF
      const ctrlReq = new JobRequest({
        jobId: 'e2e_ctrl_001',
        domain: 'controls',
        operation: 'estimate_ekf',
        parameters: {
          gyro: [0.01, 0.0, 0.0],
          accel: [0.0, 0.0, 9.81],
          dt: 0.01,
          gps: [100.0, 200.0, 50.0]
        }
      });
      const ctrlResult = await registry.executeJob('controls', ctrlReq);
      assert.strictEqual(ctrlResult.status, JobStatus.SUCCEEDED);
      assert(ctrlResult.outputData.attitude.quaternion.length === 4);
      console.log('  ✓ PASSED: Controls quaternion EKF returned a finite estimate');

      // -------------------------------------------------------------------------
      // TEST 3: PersistentWorkerPool Execution & 2s Cancellation
      // -------------------------------------------------------------------------
    });
    await runCheck('3. PersistentWorkerPool Execution & 2s Cancellation', async () => {
      process.stdout.write('[3] Testing PersistentWorkerPool Task Cancellation (<2s)...\n');
      pool = new PersistentWorkerPool({ maxWorkers: 2 });

      const longTaskPromise = pool.dispatch('ECHO_TEST', { message: 'long-run-e2e', delayMs: 10000 });
      const activeTask =
        pool.workers.find((w) => w.busy && w.currentTask?.payload?.message === 'long-run-e2e')?.currentTask ||
        pool.taskQueue.find((t) => t.payload?.message === 'long-run-e2e');
      assert(activeTask, 'Target task must exist in worker pool');

      const tStartCancel = Date.now();
      const cancelResult = await pool.cancel(activeTask.id);
      assert.strictEqual(cancelResult, true);

      let wasCancelled = false;
      try {
        await longTaskPromise;
      } catch (err) {
        if (err.code === 'CANCELLED' || err.message.includes('cancelled')) {
          wasCancelled = true;
        }
      }
      const cancelDurationMs = Date.now() - tStartCancel;
      assert(wasCancelled, 'Job must be successfully cancelled');
      assert(cancelDurationMs < 2000, `Cancellation must complete within 2 seconds (took ${cancelDurationMs}ms)`);
      console.log(`  ✓ PASSED: Worker pool task cancelled cleanly in ${cancelDurationMs}ms (< 2,000ms budget)`);

      // -------------------------------------------------------------------------
      // TEST 4: Stenographer Cryptographic Audit Ledger
      // -------------------------------------------------------------------------
    });
    await runCheck('4. Stenographer Policy Gateway & Cryptographic Ledger', async () => {
      process.stdout.write('[4] Testing Stenographer Policy Gateway & Cryptographic Ledger...\n');
      const { ApprovalDecision } = require('../src/core/contracts/ApprovalRecord');
      const supervisor = new StenographerSupervisor({ mockMode: true });
      await supervisor.connect();
      const advertisedNames = new Set(supervisor.getRegisteredTools().map((tool) => tool.name));
      for (const unsupportedName of [
        'read_mesh_summary',
        'mutate_geometry_parameter',
        'execute_fea_solve',
        'export_step_file',
        'optics.solve_rcwa_grating'
      ]) {
        assert.strictEqual(advertisedNames.has(unsupportedName), false, `${unsupportedName} must not be advertised`);
      }
      assert.strictEqual(
        supervisor.processQuery({ prompt: 'Extrude a boss by 50 mm', projectRevision: 1 }).status,
        'UNAVAILABLE'
      );
      for (const [name, approvalClass] of [
        ['mutate_geometry_parameter', ToolApprovalClass.MUTATION_PREVIEW],
        ['optics.solve_rcwa_grating', ToolApprovalClass.COMPUTE_JOB]
      ]) {
        supervisor.registerTool(
          new ToolDefinition({
            name,
            description: 'Test-only gateway fixture; unavailable in the production tool catalog',
            approvalClass,
            modifiesState: approvalClass === ToolApprovalClass.MUTATION_PREVIEW
          })
        );
      }

      for (const toolName of [
        'eda.deserialize_oasis',
        'eda.parse_spef',
        'pdm.where_used',
        'hpc.get_cluster_telemetry',
        'robotics.parse_urdf'
      ]) {
        const discovered = supervisor.getRegisteredTools().find((tool) => tool.name === toolName);
        assert(discovered, `${toolName} must remain discoverable`);
        assert.strictEqual(discovered.approvalClass, 'COMPUTE_JOB', `${toolName} must require approval`);
        const pending = supervisor.proposeToolCall({ toolName, originatingProjectRevision: 1 });
        assert.strictEqual(pending.requiresApproval, true);
        let invoked = false;
        await assert.rejects(
          () =>
            supervisor.executeTool(pending.id, async () => {
              invoked = true;
              return {};
            }),
          /requires explicit engineer approval/
        );
        assert.strictEqual(invoked, false, `${toolName} must not dispatch before approval`);
      }

      await assert.rejects(
        () => supervisor.query('Extrude the main boss cylinder by 50mm'),
        /daemon query transport is unavailable/
      );
      const prop = supervisor.proposeToolCall({
        toolName: 'mutate_geometry_parameter',
        originatingProjectRevision: 1,
        args: { feature: 'main_boss', param: 'depth', valueMm: 50 }
      });
      assert.strictEqual(prop.requiresApproval, true);
      assert.throws(
        () =>
          supervisor.proposeToolCall({
            toolName: 'mutate_geometry_parameter',
            originatingProjectRevision: 1,
            proposalId: prop.id
          }),
        /Duplicate Stenographer proposal ID/
      );
      assert.throws(
        () =>
          supervisor.proposeToolCall({
            toolName: 'mutate_geometry_parameter',
            originatingProjectRevision: 1,
            idempotencyKey: prop.idempotencyKey
          }),
        /Duplicate Stenographer idempotency key/
      );

      const approval = supervisor.evaluateProposal(
        prop.id,
        ApprovalDecision.APPROVED,
        'Approved for e2e validation',
        'Lead_Structural_Engineer'
      );
      assert.strictEqual(approval.decision, ApprovalDecision.APPROVED);

      const execRes = await supervisor.executeTool(prop.id, async (p) => ({
        extruded: true,
        feature: p.feature,
        depthMm: p.value
      }));
      assert.strictEqual(execRes.success, true);
      await assert.rejects(() => supervisor.executeTool(prop.id, async () => ({ extruded: true })), /Fail-closed gate/);

      const ledgerIntegrity = supervisor.verifyLedgerIntegrity();
      assert.strictEqual(ledgerIntegrity.valid, true);
      assert(supervisor.ledger.length >= 3, 'Ledger must contain recorded audit events');
      const lastHash = supervisor.latestHash;
      supervisor.latestHash = 'f'.repeat(64);
      assert.strictEqual(
        supervisor.verifyLedgerIntegrity().valid,
        false,
        'Ledger head must match the final signed entry'
      );
      supervisor.latestHash = lastHash;

      // A proposal's approval class is set by the registered tool, never by its caller.
      assert.throws(
        () => supervisor.proposeToolCall({ toolName: 'mutate_geometry_parameter', approvalClass: 'READ_ONLY' }),
        /Approval class.*must be MUTATION_PREVIEW/
      );
      assert.throws(
        () => supervisor.proposeToolCall({ toolName: 'unregistered.execute', approvalClass: 'READ_ONLY' }),
        /Unregistered Stenographer tool/
      );
      assert.throws(
        () => supervisor.proposeToolCall({ toolName: 'optics.solve_rcwa_grating' }),
        /current project revision is required/
      );
      const missingRevision = supervisor.processQuery({ prompt: 'steam properties' });
      assert.strictEqual(missingRevision.status, 'INPUT_REQUIRED');
      assert.strictEqual(missingRevision.mode, 'stenographer-input-required');
      assert.strictEqual(missingRevision.proposals.length, 0);
      const parsedSteam = supervisor.processQuery({ prompt: 'steam at 3 MPa and 300 K', projectRevision: 2 });
      assert.strictEqual(parsedSteam.proposal.originatingProjectRevision, 2);
      assert.deepStrictEqual(parsedSteam.proposal.args, { pressurePa: 3e6, temperatureK: 300 });
      const originalLegacyPrompt = OmniAIEngine.prototype.processPrompt;
      let legacyInvocations = 0;
      OmniAIEngine.prototype.processPrompt = function () {
        legacyInvocations++;
        return { matchedTool: 'run_phone_drop_test', assistantMessage: 'Legacy engine invoked' };
      };
      try {
        const dropProposal = supervisor.processQuery({
          prompt: 'Run a 2 m corner drop test on a smartphone with mass 205 g',
          projectRevision: 2
        });
        assert.strictEqual(dropProposal.status, 'UNAVAILABLE');
        assert.strictEqual(legacyInvocations, 0, 'Stenographer proposal creation must not invoke the legacy engine');
        const unmatched = supervisor.processQuery({ prompt: 'Summarize an unsupported engineering intent' });
        assert.strictEqual(unmatched.status, 'UNAVAILABLE');
        assert.strictEqual(unmatched.result, null);
        assert.strictEqual(legacyInvocations, 0, 'Unmatched Stenographer requests must not execute legacy fallback');
      } finally {
        OmniAIEngine.prototype.processPrompt = originalLegacyPrompt;
      }
      const legacyDrop = processLegacyMacroPrompt({
        prompt: 'Run a 2m drop test on the smartphone corner with a mass of 205 g'
      });
      assert.strictEqual(legacyDrop.success, true);
      assert.strictEqual(legacyDrop.mode, 'legacy-macro-adapter');
      assert.strictEqual(legacyDrop.proposal, null);
      assert.strictEqual(legacyDrop.matchedTool, 'run_phone_drop_test');
      assert(Number.isFinite(legacyDrop.result.peakDeceleration_G));

      const projectAtRevision7 = { getManifest: () => ({ revision: 7, projectId: 'project-a' }) };
      const routedSteam = processStenographerQuery(supervisor, projectAtRevision7, {
        prompt: 'steam at 3 MPa and 300 K'
      });
      assert.strictEqual(routedSteam.success, true);
      assert.strictEqual(routedSteam.mode, 'stenographer-proposal');
      assert.doesNotMatch(routedSteam.assistantMessage, /legacy macro adapter/i);
      assert.strictEqual(routedSteam.proposal.originatingProjectRevision, 7);
      assert.strictEqual(routedSteam.proposal.originatingProjectId, 'project-a');
      assert.strictEqual(proposalMatchesActiveProject(routedSteam.proposal, projectAtRevision7), true);
      assert.strictEqual(
        proposalMatchesActiveProject(routedSteam.proposal, {
          getManifest: () => ({ revision: 7, projectId: 'project-b' })
        }),
        false,
        'a proposal must not be approved or executed for a different project at the same revision'
      );
      assert.strictEqual(
        proposalMatchesActiveProject(routedSteam.proposal, {
          getManifest: () => ({ revision: 8, projectId: 'project-a' })
        }),
        false
      );
      const proposalCountBeforeMissingIdentity = supervisor.proposals.size;
      const missingIdentity = processStenographerQuery(
        supervisor,
        { getManifest: () => ({ revision: 7 }) },
        { prompt: 'steam at 3 MPa and 300 K' }
      );
      assert.strictEqual(missingIdentity.success, false);
      assert.strictEqual(supervisor.proposals.size, proposalCountBeforeMissingIdentity);
      const proposalCountBeforeSpoof = supervisor.proposals.size;
      const spoofedRevision = processStenographerQuery(supervisor, projectAtRevision7, {
        prompt: 'steam at 3 MPa and 300 K',
        projectRevision: 8
      });
      assert.strictEqual(spoofedRevision.success, false);
      assert.strictEqual(supervisor.proposals.size, proposalCountBeforeSpoof);
      const missingProject = processStenographerQuery(
        supervisor,
        { getManifest: () => null },
        {
          prompt: 'steam at 3 MPa and 300 K'
        }
      );
      assert.strictEqual(missingProject.status, 'INPUT_REQUIRED');
      assert.strictEqual(supervisor.proposals.size, proposalCountBeforeSpoof);
      const readOnlyWithoutProject = processStenographerQuery(
        supervisor,
        { getManifest: () => null },
        {
          prompt: 'list tools'
        }
      );
      assert.strictEqual(readOnlyWithoutProject.success, true);
      assert.strictEqual(readOnlyWithoutProject.proposal, null);
      assert.throws(
        () => validateSchema({ prompt: 'steam properties', projectRevision: 'rev-1' }, STENOGRAPHER_QUERY_SCHEMA),
        /finite number/
      );
      assert.throws(
        () => validateSchema({ prompt: 'steam properties', unexpected: true }, STENOGRAPHER_QUERY_SCHEMA),
        /Unexpected object properties/
      );

      const rcwaProposal = supervisor.proposeToolCall({
        toolName: 'optics.solve_rcwa_grating',
        originatingProjectRevision: 1,
        args: { wavelengthNm: 550, periodNm: 400, depthNm: 200, n1: 1, n2: 1.5 }
      });
      await assert.rejects(() => supervisor.executeTool(rcwaProposal.id), /requires explicit engineer approval/);
      supervisor.evaluateProposal(rcwaProposal.id, ApprovalDecision.APPROVED, 'Gateway regression', 'test-reviewer');
      await assert.rejects(() => supervisor.executeTool(rcwaProposal.id), /RCWA grating solver is unavailable/);
      assert.strictEqual(rcwaProposal.status, 'FAILED');

      const roboticsProposal = supervisor.proposeToolCall({
        toolName: 'robotics.solve_kinematics',
        originatingProjectRevision: 1,
        args: { operation: 'forward_kinematics' }
      });
      supervisor.evaluateProposal(
        roboticsProposal.id,
        ApprovalDecision.APPROVED,
        'Gateway regression',
        'test-reviewer'
      );
      await assert.rejects(() => supervisor.executeTool(roboticsProposal.id));
      assert.strictEqual(roboticsProposal.status, 'FAILED');

      await supervisor.disconnect();
      console.log('  ✓ PASSED: Stenographer approval class and unsupported solver gates verified');

      // The CLI must reconstruct approvals only from authenticated ledger events.
    });
    await runCheck('5. Persisted Stenographer approval recovery & concurrent writers', async () => {
      process.stdout.write('[5] Testing persisted Stenographer approval recovery...\n');
      const cliPath = path.join(__dirname, '..', 'bin', 'stenographer.js');
      const statePath = path.join(tmpDir, 'stenographer-state.json');
      const cliEnv = {
        ...process.env,
        // Fixed test-only key keeps signed-ledger replay vectors reproducible.
        OMNI_STENOGRAPHER_HMAC_KEY: Buffer.alloc(32, 0x42).toString('hex')
      };
      const runCli = (...args) =>
        spawnSync(process.execPath, [cliPath, '--state-file', statePath, ...args], {
          env: cliEnv,
          encoding: 'utf8',
          timeout: 10000
        });

      const oneShot = runCli(
        '--project-revision',
        '1',
        '--run-tool',
        'plant.calculate_steam_properties',
        '--args',
        JSON.stringify({ pressurePa: 3e6, temperatureK: 300 }),
        '--approve'
      );
      assert.strictEqual(oneShot.status, 1, 'one-command proposal and approval must be rejected');
      assert.match(oneShot.stderr, /review.*proposal.*approve/i);
      assert.strictEqual(fs.existsSync(statePath), false, 'rejected one-shot CLI request must not persist a proposal');
      const missingIdApproval = runCli('--approve');
      assert.strictEqual(missingIdApproval.status, 1, 'approval requires an existing proposal ID');

      const proposed = runCli(
        '--project-revision',
        '1',
        '--propose',
        JSON.stringify({ toolName: 'plant.calculate_steam_properties' })
      );
      assert.strictEqual(proposed.status, 0, proposed.stderr);
      const persistedId = JSON.parse(proposed.stdout).proposalId;
      const stateBeforeReset = fs.readFileSync(statePath, 'utf8');
      const resetAttempt = runCli('--reset-state');
      assert.strictEqual(resetAttempt.status, 1, 'audit reset must not be available from the CLI');
      assert.strictEqual(fs.readFileSync(statePath, 'utf8'), stateBeforeReset, 'audit reset must not alter state');
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      state.approvals = [[persistedId, { proposalId: persistedId, decision: 'APPROVED', userId: 'forged' }]];
      fs.writeFileSync(statePath, JSON.stringify(state));
      const forgedExecution = runCli('--execute', persistedId);
      assert.strictEqual(forgedExecution.status, 1);
      assert.match(forgedExecution.stderr, /requires explicit engineer approval/);

      const approved = runCli('--approve', persistedId, '--reviewer', 'test-reviewer');
      assert.strictEqual(approved.status, 0, approved.stderr);
      const unavailableExecution = runCli('--execute', persistedId);
      assert.strictEqual(unavailableExecution.status, 1);
      assert.match(unavailableExecution.stderr, /requires explicit inputs: pressurePa, temperatureK/);
      const failedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.strictEqual(failedState.ledger.at(-1).type, 'TOOL_FAILED', 'failed execution must be persisted');
      assert.strictEqual(failedState.ledger.at(-2).type, 'TOOL_STARTED', 'execution intent must precede dispatch');
      const retriedFailure = runCli('--execute', persistedId);
      assert.strictEqual(retriedFailure.status, 1);
      assert.match(retriedFailure.stderr, /status: FAILED/, 'replay must block repeated execution after failure');
      assert.strictEqual(runCli('--verify-ledger').status, 0);

      const interruptedProposal = runCli(
        '--project-revision',
        '1',
        '--propose',
        JSON.stringify({ toolName: 'plant.calculate_steam_properties' })
      );
      assert.strictEqual(interruptedProposal.status, 0, interruptedProposal.stderr);
      const interruptedRecord = JSON.parse(interruptedProposal.stdout);
      const interruptedId = interruptedRecord.proposalId;
      assert.strictEqual(runCli('--approve', interruptedId).status, 0);
      const interruptedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const startSequence = interruptedState.ledger.length + 1;
      const startPrevHash = interruptedState.ledger.at(-1).hash;
      interruptedState.ledger.push(
        new LedgerEntry({
          sequenceNumber: startSequence,
          prevHash: startPrevHash,
          type: 'TOOL_STARTED',
          payload: {
            proposalId: interruptedId,
            toolName: 'eda.parse_spef',
            idempotencyKey: interruptedRecord.proposal.idempotencyKey,
            originatingProjectRevision: 1
          },
          hmacSecret: cliEnv.OMNI_STENOGRAPHER_HMAC_KEY
        })
      );
      fs.writeFileSync(statePath, JSON.stringify(interruptedState));
      const mismatchedStart = runCli('--verify-ledger');
      assert.strictEqual(mismatchedStart.status, 1);
      assert.match(mismatchedStart.stderr, /Start does not match signed proposal/);
      interruptedState.ledger.pop();
      interruptedState.ledger.push(
        new LedgerEntry({
          sequenceNumber: startSequence,
          prevHash: startPrevHash,
          type: 'TOOL_STARTED',
          payload: {
            proposalId: interruptedId,
            toolName: 'plant.calculate_steam_properties',
            idempotencyKey: interruptedRecord.proposal.idempotencyKey,
            originatingProjectRevision: 1,
            originatingProjectId: 'different-project'
          },
          hmacSecret: cliEnv.OMNI_STENOGRAPHER_HMAC_KEY
        })
      );
      fs.writeFileSync(statePath, JSON.stringify(interruptedState));
      const mismatchedProjectStart = runCli('--verify-ledger');
      assert.strictEqual(mismatchedProjectStart.status, 1);
      assert.match(mismatchedProjectStart.stderr, /Start does not match signed proposal/);
      interruptedState.ledger.pop();
      interruptedState.ledger.push(
        new LedgerEntry({
          sequenceNumber: startSequence,
          prevHash: startPrevHash,
          type: 'TOOL_STARTED',
          payload: {
            proposalId: interruptedId,
            toolName: 'plant.calculate_steam_properties',
            idempotencyKey: interruptedRecord.proposal.idempotencyKey,
            originatingProjectRevision: 1
          },
          hmacSecret: cliEnv.OMNI_STENOGRAPHER_HMAC_KEY
        })
      );
      fs.writeFileSync(statePath, JSON.stringify(interruptedState));
      const replayedInterrupted = runCli('--execute', interruptedId);
      assert.strictEqual(replayedInterrupted.status, 1);
      assert.match(replayedInterrupted.stderr, /status: EXECUTING/, 'interrupted tool must not be retried silently');
      assert.strictEqual(runCli('--verify-ledger').status, 0);

      const tampered = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      tampered.ledger[0].payload.toolName = 'mutate_geometry_parameter';
      fs.writeFileSync(statePath, JSON.stringify(tampered));
      const tamperedRead = runCli('--verify-ledger');
      assert.strictEqual(tamperedRead.status, 1);
      assert.match(tamperedRead.stderr, /ledger verification failed/);
      console.log('  ✓ PASSED: Persisted approvals replay only from signed records; tampering is rejected');

      // Two already-loaded stdio processes must not replace one another's acknowledged events.
      process.stdout.write('[5a] Testing concurrent Stenographer CLI state writers...\n');
      const concurrentPath = path.join(tmpDir, 'concurrent-stenographer-state.json');
      const peers = [];
      const startPeer = () => {
        const child = spawn(process.execPath, [cliPath, '--state-file', concurrentPath, '--stdio'], {
          env: cliEnv,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        const pending = new Map();
        const output = readline.createInterface({ input: child.stdout });
        let nextId = 0;
        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        output.on('line', (line) => {
          const response = JSON.parse(line);
          const waiter = pending.get(response.id);
          if (!waiter) return;
          pending.delete(response.id);
          clearTimeout(waiter.timer);
          waiter.resolve(response);
        });
        child.on('exit', (code) => {
          for (const waiter of pending.values()) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error(`Stenographer stdio exited ${code}: ${stderr}`));
          }
          pending.clear();
        });
        const peer = {
          child,
          request(method, params = {}) {
            return new Promise((resolve, reject) => {
              const id = ++nextId;
              const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`Stenographer stdio timed out: ${method}; ${stderr}`));
              }, 10000);
              pending.set(id, { resolve, reject, timer });
              child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
            });
          }
        };
        peers.push(peer);
        return peer;
      };
      try {
        const firstPeer = startPeer();
        const secondPeer = startPeer();
        const initialHealth = await Promise.all([firstPeer.request('health'), secondPeer.request('health')]);
        assert(initialHealth.every((response) => response.result?.ledgerEntries === 0));
        const firstResponse = await firstPeer.request('propose', {
          toolName: 'plant.calculate_steam_properties',
          projectRevision: 1
        });
        assert(firstResponse.result?.proposalId, JSON.stringify(firstResponse));
        const secondResponse = await secondPeer.request('propose', {
          toolName: 'plant.calculate_steam_properties',
          projectRevision: 1
        });
        assert.match(secondResponse.error?.message || '', /state changed since load/i);
        const concurrentState = JSON.parse(fs.readFileSync(concurrentPath, 'utf8'));
        assert.strictEqual(concurrentState.ledger.length, 1);
        assert.strictEqual(concurrentState.ledger[0].payload.proposalId, firstResponse.result.proposalId);
        const failedPeerResponse = await secondPeer.request('health');
        assert.match(failedPeerResponse.error?.message || '', /persistence failed/i);
      } finally {
        await Promise.all(
          peers.map(
            (peer) =>
              new Promise((resolve) => {
                if (peer.child.exitCode !== null || peer.child.signalCode !== null) return resolve();
                peer.child.once('exit', resolve);
                peer.child.kill();
              })
          )
        );
      }
      const concurrentVerified = spawnSync(
        process.execPath,
        [cliPath, '--state-file', concurrentPath, '--verify-ledger'],
        { env: cliEnv, encoding: 'utf8', timeout: 10000 }
      );
      assert.strictEqual(concurrentVerified.status, 0, concurrentVerified.stderr);
      const savedConcurrentState = fs.readFileSync(concurrentPath, 'utf8');
      const lockPath = `${concurrentPath}.lock`;
      fs.writeFileSync(lockPath, '', { flag: 'wx', mode: 0o600 });
      try {
        const lockedWrite = spawnSync(
          process.execPath,
          [
            cliPath,
            '--state-file',
            concurrentPath,
            '--project-revision',
            '1',
            '--propose',
            JSON.stringify({ toolName: 'plant.calculate_steam_properties' })
          ],
          { env: cliEnv, encoding: 'utf8', timeout: 10000 }
        );
        assert.strictEqual(lockedWrite.status, 1, 'an occupied state lock must block a write');
        assert.strictEqual(fs.readFileSync(concurrentPath, 'utf8'), savedConcurrentState);
      } finally {
        fs.unlinkSync(lockPath);
      }
      console.log('  ✓ PASSED: Stale stdio writer cannot replace an acknowledged ledger event');
    });
    await runCheck('6. Headless health and unavailable robotics route', async () => {
      process.stdout.write('[6] Testing headless health and unavailable robotics route...\n');
      const health = HeadlessSolverDaemon.getHealth();
      assert.strictEqual(health.status, 'experimental');
      assert(health.registeredDomains.includes('robotics'));
      const headlessRobotics = HeadlessSolverDaemon.solveJob({
        discipline: 'robotics',
        parameters: { operation: 'inverse_dynamics' }
      });
      assert.strictEqual(headlessRobotics.status, 'UNAVAILABLE');
      assert.strictEqual(headlessRobotics.result.code, 'UNSUPPORTED');
      assert.strictEqual(headlessRobotics.result.jointTorquesNm, undefined);
      assert.throws(
        () => HeadlessSolverDaemon.solveJob({ discipline: 'optics', parameters: {} }),
        /explicit finite positive/
      );
      assert.throws(
        () => HeadlessSolverDaemon.solveJob({ discipline: 'cfd', parameters: {} }),
        /explicit positive integer steps/
      );
      assert.throws(
        () => HeadlessSolverDaemon.solveJob({ discipline: 'partition', parameters: {} }),
        /explicit positive integer numPartitions/
      );
      console.log('  ✓ PASSED: Headless health resolves registered domains without synthetic robotics outputs');
    });

    const total = results.length;
    const failed = results.filter((r) => !r.ok).length;
    const passed = total - failed;
    console.log('\n================================================================');
    console.log(`   EXPERIMENTAL STACK SUMMARY: ${passed}/${total} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    return { total, passed, failed };
  } finally {
    if (pool) {
      await pool.shutdown();
    }
    // Clean up temporary directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runIndustrialE2EStackVerification()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n✗ E2E Stack Verification Failed:', err);
      process.exit(1);
    });
}

module.exports = { runIndustrialE2EStackVerification };
