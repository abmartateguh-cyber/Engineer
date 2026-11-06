'use strict';

const assert = require('assert');
const {
  OmniError,
  OmniErrorCode,
  Quantity,
  Dimensions,
  UnitRegistry,
  dimensionsEqual,
  ArtifactRef,
  RetentionPolicy,
  ValidationRecord,
  ValidationMaturity,
  JobRequest,
  JobPriority,
  JobEvent,
  JobEventType,
  JobResult,
  JobStatus,
  EngineAdapter,
  ToolDefinition,
  ToolApprovalClass,
  ToolProposal,
  ApprovalRecord,
  ApprovalDecision,
  StenographerClient,
  ProjectManifestV2
} = require('../src/core/contracts');

async function runSharedContractsTests() {
  console.log('================================================================');
  console.log('       TESTING OMNIENG SHARED ARCHITECTURAL CONTRACTS           ');
  console.log('================================================================');

  const results = [];
  async function runCase(name, fn) {
    try {
      await fn();
      results.push({ ok: true });
    } catch (err) {
      results.push({ ok: false });
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // 1. OmniError Tests
  console.log('\n[1] OmniError Contract Tests...');
  await runCase('[1] OmniError contract', async () => {
    const err = new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'Matrix singular during factorize', { pivot: 42 });
    assert.strictEqual(err.name, 'OmniError');
    assert.strictEqual(err.code, 'NUMERICAL_FAILURE');
    assert.strictEqual(err.message, 'Matrix singular during factorize');
    assert.strictEqual(err.details.pivot, 42);

    const json = err.toJSON();
    assert.strictEqual(json.code, 'NUMERICAL_FAILURE');
    const restored = OmniError.fromJSON(json);
    assert.strictEqual(restored.code, 'NUMERICAL_FAILURE');
    assert.strictEqual(restored.message, 'Matrix singular during factorize');

    // Must reject invalid codes
    assert.throws(() => new OmniError('INVALID_CODE_XYZ', 'msg'), /Invalid OmniError code/);
    console.log('  ✓ PASSED: OmniError validates codes, serializes to JSON, and restores cleanly');
  });

  // 2. Quantity & Units Arithmetic Tests
  console.log('\n[2] Quantity & Units Arithmetic Tests...');
  await runCase('[2] Quantity & units arithmetic', async () => {
    // Length: 25.4 mm == 1 inch
    const qMm = Quantity.from(25.4, 'mm', 0.01);
    assert.strictEqual(qMm.displayUnit, 'mm');
    assert.strictEqual(dimensionsEqual(qMm.dimension, Dimensions.LENGTH), true);
    assert.ok(Math.abs(qMm.valueSi - 0.0254) < 1e-12);
    const qIn = qMm.to('in');
    assert.ok(Math.abs(qIn - 1.0) < 1e-10, `Expected 1.0 in, got ${qIn}`);

    // Pressure: 1 MPa = 1,000,000 Pa = 10 bar = ~145.0377 psi
    const qPress = Quantity.from(1, 'MPa');
    assert.strictEqual(qPress.valueSi, 1e6);
    assert.ok(Math.abs(qPress.to('bar') - 10) < 1e-9);
    assert.ok(Math.abs(qPress.to('psi') - 145.0377) < 0.01);

    // Temperature conversion with offset: 100 degC = 373.15 K = 212 degF
    const qTemp = Quantity.from(100, 'degC');
    assert.ok(Math.abs(qTemp.valueSi - 373.15) < 1e-9);
    assert.ok(Math.abs(qTemp.to('degF') - 212) < 1e-9);
    assert.ok(Math.abs(qTemp.to('K') - 373.15) < 1e-9);

    // Dimension mismatch rejection
    assert.throws(() => qMm.to('MPa'), /Dimension mismatch/);
    assert.throws(() => qMm.uncertaintyTo('MPa'), /Dimension mismatch/);
    assert.throws(() => qMm.add(qPress), /different dimensions/);

    // Arithmetic with dimension propagation
    const l1 = Quantity.from(2, 'm');
    const l2 = Quantity.from(3, 'm');
    const area = l1.multiply(l2);
    assert.strictEqual(dimensionsEqual(area.dimension, Dimensions.AREA), true);
    assert.strictEqual(area.valueSi, 6);

    const force = Quantity.from(60, 'N');
    const stress = force.divide(area);
    assert.strictEqual(dimensionsEqual(stress.dimension, Dimensions.PRESSURE), true);
    assert.strictEqual(stress.valueSi, 10); // 60 N / 6 m2 = 10 Pa

    // Uncertainty propagation in quadrature: (2 ± 0.1) + (3 ± 0.1) = 5 ± sqrt(0.01 + 0.01)
    const u1 = Quantity.from(2, 'm', 0.1);
    const u2 = Quantity.from(3, 'm', 0.1);
    const sumU = u1.add(u2);
    assert.strictEqual(sumU.valueSi, 5);
    assert.ok(Math.abs(sumU.uncertaintySi - Math.SQRT2 * 0.1) < 1e-12);
    const zeroWithUncertainty = Quantity.from(0, 'm', 0.1);
    assert.ok(Math.abs(zeroWithUncertainty.multiply(Quantity.from(2, 'm')).uncertaintySi - 0.2) < 1e-12);
    assert.ok(Math.abs(zeroWithUncertainty.divide(Quantity.from(2, 's')).uncertaintySi - 0.05) < 1e-12);
    assert.throws(() => Quantity.fromJSON({ ...zeroWithUncertainty.toJSON(), uncertaintySi: NaN }), /uncertainty/i);

    // Rejection of non-finite inputs
    assert.throws(() => Quantity.from(NaN, 'm'), /non-finite value/);
    assert.throws(() => Quantity.from(Infinity, 'm'), /non-finite value/);
    assert.throws(() => Quantity.from(10, 'unregistered_unit_xyz'), /Unrecognized unit/);

    const diff = l2.subtract(l1);
    assert.strictEqual(diff.valueSi, 1);
    const withDisp = qMm.withDisplayUnit('in');
    assert.strictEqual(withDisp.displayUnit, 'in');
    assert.strictEqual(typeof qMm.toString(), 'string');
    console.log('  ✓ PASSED: Quantity handles SI bases, offset conversions, dimensional arithmetic, and uncertainties');
  });

  // 3. ArtifactRef Tests
  console.log('\n[3] ArtifactRef Tests...');
  await runCase('[3] ArtifactRef contract', async () => {
    const testBuf = Buffer.from('SOLID MESH CAD GEOMETRY CONTENT 12345', 'utf8');
    const ref = ArtifactRef.fromContent(testBuf, {
      mimeType: 'application/x-omni-mesh+json',
      retention: RetentionPolicy.AUDIT,
      name: 'bracket_mesh_final.json',
      producingJobId: 'job-987'
    });

    assert.strictEqual(ref.byteLength, testBuf.length);
    assert.strictEqual(ref.mimeType, 'application/x-omni-mesh+json');
    assert.strictEqual(ref.retention, RetentionPolicy.AUDIT);
    assert.strictEqual(ref.producingJobId, 'job-987');
    assert.strictEqual(ref.hash.length, 64);
    assert.strictEqual(ref.name, 'bracket_mesh_final.json');
    assert.strictEqual(ref.schemaVersion, '1.0.0');
    assert.strictEqual(typeof ref.createdAt, 'string');

    const json = ref.toJSON();
    const restored = ArtifactRef.fromJSON(json);
    assert.strictEqual(restored.hash, ref.hash);
    assert.strictEqual(restored.byteLength, ref.byteLength);
    const derived = ArtifactRef.fromContent('derived artifact', {
      mimeType: 'text/plain',
      lineage: [ref.hash],
      metadata: { sourceRevision: 3 }
    });
    assert.deepStrictEqual(ArtifactRef.fromJSON(derived.toJSON()).lineage, [ref.hash]);
    assert.strictEqual(derived.metadata.sourceRevision, 3);
    assert.throws(() => ArtifactRef.fromJSON({ ...derived.toJSON(), retention: 'UNKNOWN' }), /retention policy/);

    // Reject invalid hash
    assert.throws(() => new ArtifactRef({ hash: 'invalid_short_hash', mimeType: 'text/plain' }), /valid 64-char/);
    console.log('  ✓ PASSED: ArtifactRef creates SHA-256 references, enforces hex hashes and retention policy');
  });

  // 4. ValidationRecord Tests
  console.log('\n[4] ValidationRecord Tests...');
  await runCase('[4] ValidationRecord contract', async () => {
    const rec = new ValidationRecord({
      maturity: ValidationMaturity.RELEASED,
      benchmarkSet: 'SYNTHETIC-UNVERIFIED',
      errors: { maxVonMisesErrorPct: 0.12 },
      reviewer: 'unverified-reviewer-string',
      signature: 'unverified-signature-string',
      tolerances: { maxAllowedErrorPct: 1.0 },
      referenceArtifacts: ['ref-1']
    });
    assert.strictEqual(rec.maturity, 'released');
    assert.strictEqual(rec.benchmarkSet, 'SYNTHETIC-UNVERIFIED');
    assert.strictEqual(rec.reviewer, 'unverified-reviewer-string');
    assert.strictEqual(typeof rec.date, 'string');
    assert.strictEqual(rec.signature, 'unverified-signature-string');
    assert.deepStrictEqual(rec.referenceArtifacts, ['ref-1']);
    assert.strictEqual(rec.isReleaseReady(), false);
    const serializedRecord = ValidationRecord.fromJSON(rec.toJSON());
    assert.strictEqual(serializedRecord.errors.maxVonMisesErrorPct, 0.12);
    assert.strictEqual(serializedRecord.tolerances.maxAllowedErrorPct, 1.0);
    assert.strictEqual(serializedRecord.isReleaseReady(), false);

    const expRec = new ValidationRecord({
      maturity: ValidationMaturity.EXPERIMENTAL,
      benchmarkSet: 'SYNTHETIC-SMOKE'
    });
    assert.strictEqual(expRec.isReleaseReady(), false);
    console.log('  ✓ PASSED: ValidationRecord does not treat self-declared review fields as release evidence');
  });

  // 5. JobRequest & JobResult Tests
  console.log('\n[5] JobRequest & JobResult Tests...');
  await runCase('[5] JobRequest & JobResult contract', async () => {
    const dummyHash = 'a'.repeat(64);
    const parameterSource = { solverType: 'SparseCholesky', maxIterations: 1000, options: { pivoting: 'none' } };
    const req = new JobRequest({
      domain: 'cae',
      operation: 'linear_elastic_3d',
      solver: 'FEASolver',
      backend: 'js',
      backendVersion: '2.0.0',
      inputArtifactHashes: [dummyHash],
      projectRevision: 3,
      parameters: parameterSource,
      resourceBudget: { maxTimeMs: 15000, maxMemoryMb: 1024, maxThreads: 8 },
      seed: 12345,
      tolerances: { residualNorm: 1e-10 },
      priority: JobPriority.HIGH
    });
    const hash1 = req.computeContentHash();

    assert.strictEqual(req.domain, 'cae');
    assert.strictEqual(req.operation, 'linear_elastic_3d');
    assert.strictEqual(req.solver, 'FEASolver');
    assert.strictEqual(req.backend, 'js');
    assert.strictEqual(req.backendVersion, '2.0.0');
    assert.strictEqual(req.projectRevision, 3);
    assert.strictEqual(req.seed, 12345);
    assert.deepStrictEqual(req.tolerances, { residualNorm: 1e-10 });
    assert.deepStrictEqual(req.metadata, {});
    assert.strictEqual(typeof req.createdAt, 'string');
    assert.strictEqual(req.resourceBudget.maxTimeMs, 15000);
    assert.strictEqual(req.priority, JobPriority.HIGH);
    const hash2 = req.computeContentHash();
    assert.strictEqual(hash1, hash2, 'Content hash must be deterministic');
    assert.strictEqual(hash1.length, 64);
    parameterSource.options.pivoting = 'complete';
    assert.strictEqual(req.computeContentHash(), hash1, 'The request must snapshot caller-owned nested parameters');
    const serializedMutation = req.toJSON();
    serializedMutation.parameters.options.pivoting = 'serialized mutation';
    serializedMutation.resourceBudget.maxThreads = 1;
    serializedMutation.metadata.injected = true;
    assert.strictEqual(req.computeContentHash(), hash1, 'Mutating serialized data must not change the request hash');
    assert.strictEqual(Object.isFrozen(req.parameters.options), true, 'Nested request parameters must be frozen');
    assert.strictEqual(Object.isFrozen(req.tolerances), true, 'Nested request tolerances must be frozen');

    const reqWithNewRevision = new JobRequest({ ...req.toJSON(), projectRevision: 4 });
    const reqWithNewBudget = new JobRequest({
      ...req.toJSON(),
      resourceBudget: { ...req.resourceBudget, maxTimeMs: 16000 }
    });
    assert.notStrictEqual(reqWithNewRevision.computeContentHash(), hash1);
    assert.notStrictEqual(reqWithNewBudget.computeContentHash(), hash1);
    const reqWithNewSolver = new JobRequest({ ...req.toJSON(), solver: 'FEASolverV2' });
    assert.notStrictEqual(reqWithNewSolver.computeContentHash(), hash1);
    const reqWithNewBackendVersion = new JobRequest({ ...req.toJSON(), backendVersion: '2.0.1' });
    assert.notStrictEqual(reqWithNewBackendVersion.computeContentHash(), hash1);
    const differentKeyOrder = new JobRequest({
      ...req.toJSON(),
      parameters: { options: { pivoting: 'none' }, maxIterations: 1000, solverType: 'SparseCholesky' }
    });
    assert.strictEqual(
      differentKeyOrder.computeContentHash(),
      hash1,
      'Object key insertion order must not change hashes'
    );
    const fixedTimestamp = '2025-06-01T12:34:56.000Z';
    const timestampRoundTrip = JobRequest.fromJSON({ ...req.toJSON(), createdAt: fixedTimestamp });
    assert.strictEqual(timestampRoundTrip.createdAt, fixedTimestamp, 'Serialized creation time must round-trip');
    const fromJsonReq = JobRequest.fromJSON(req.toJSON());
    assert.strictEqual(fromJsonReq.operation, 'linear_elastic_3d');
    assert.strictEqual(fromJsonReq.solver, 'FEASolver');
    assert.strictEqual(fromJsonReq.backend, 'js');
    assert.strictEqual(fromJsonReq.backendVersion, '2.0.0');
    assert.strictEqual(fromJsonReq.createdAt, req.createdAt);
    assert.throws(() => new JobRequest({ ...req.toJSON(), backend: 'quantum' }), /backend/);
    assert.throws(() => new JobRequest({ ...req.toJSON(), solver: 42 }), /solver/);
    assert.throws(() => new JobRequest({ ...req.toJSON(), createdAt: 'not-a-date' }), /createdAt/);
    assert.throws(() => new JobRequest({ ...req.toJSON(), parameters: { invalid: Number.NaN } }), /non-finite numbers/);

    const { FEAEngineAdapter } = require('../src/core/cae/fea_engine_adapter');
    const feaAdapter = new FEAEngineAdapter();
    assert.strictEqual(await feaAdapter.validate(req), true);
    await assert.rejects(
      feaAdapter.validate(new JobRequest({ ...req.toJSON(), backend: 'gpu' })),
      /Backend "gpu" not supported/
    );
    await assert.rejects(
      feaAdapter.validate(new JobRequest({ ...req.toJSON(), backendVersion: '1.0.0' })),
      /does not match/
    );
    await assert.rejects(
      feaAdapter.validate(new JobRequest({ ...req.toJSON(), solver: 'unregistered-solver' })),
      /Solver "unregistered-solver" not supported/
    );
    const { defaultEngineRegistry } = require('../src/core/contracts/engine_registry');
    await assert.rejects(
      defaultEngineRegistry.dispatch(new JobRequest({ ...req.toJSON(), backend: 'gpu' })),
      /Backend "gpu" not supported/
    );

    const res = new JobResult({
      jobId: req.jobId,
      status: JobStatus.COMPLETED,
      output: { degreesOfFreedom: 45000, maxDeflection: 0.0034 },
      residualHistory: [
        { iteration: 1, residual: 1.0 },
        { iteration: 2, residual: 1.4e-6 },
        { iteration: 3, residual: 9.8e-12 }
      ],
      warnings: ['warn-1'],
      timing: { queuedMs: 12, runMs: 450, totalMs: 462 },
      peakMemoryBytes: 48 * 1024 * 1024,
      backendVersions: { engine: '1.0.0', node: process.version },
      inputArtifactHashes: [dummyHash],
      validationMaturity: ValidationMaturity.CORRELATED
    });

    assert.strictEqual(res.isSuccess(), true);
    assert.deepStrictEqual(res.output, { degreesOfFreedom: 45000, maxDeflection: 0.0034 });
    assert.strictEqual(res.residualHistory.length, 3);
    assert.deepStrictEqual(res.convergenceHistory, res.residualHistory);
    assert.deepStrictEqual(res.warnings, ['warn-1']);
    assert.strictEqual(res.peakMemoryBytes, 48 * 1024 * 1024);
    assert.deepStrictEqual(res.backendVersions, { engine: '1.0.0', node: process.version });
    assert.deepStrictEqual(res.inputArtifactHashes, [dummyHash]);
    assert.strictEqual(typeof res.completedAt, 'string');
    assert.strictEqual(res.timing.runMs, 450);

    const json = res.toJSON();
    const restoredRes = JobResult.fromJSON(json);
    assert.strictEqual(restoredRes.jobId, req.jobId);
    assert.strictEqual(restoredRes.status, JobStatus.COMPLETED);
    const failedRes = new JobResult({
      jobId: req.jobId,
      status: JobStatus.FAILED,
      error: new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'Singular matrix')
    });
    assert.strictEqual(failedRes.isSuccess(), false);
    assert.strictEqual(JobResult.fromJSON(failedRes.toJSON()).error.code, OmniErrorCode.NUMERICAL_FAILURE);
    console.log(
      '  ✓ PASSED: JobRequest computes deterministic content hash; JobResult records convergence and timings'
    );
  });

  // 6. JobEvent Streaming Tests
  console.log('\n[6] JobEvent Streaming Tests...');
  await runCase('[6] JobEvent streaming contract', async () => {
    const ev = new JobEvent('job-123', JobEventType.PROGRESS, { percent: 45, currentStep: 'Assembling global matrix' });
    assert.strictEqual(ev.jobId, 'job-123');
    assert.strictEqual(ev.type, JobEventType.PROGRESS);
    assert.strictEqual(ev.data.percent, 45);

    const json = ev.toJSON();
    const restored = JobEvent.fromJSON(json);
    assert.strictEqual(restored.data.percent, 45);
    console.log('  ✓ PASSED: JobEvent records streaming progress, residuals, and steps');
  });

  // 7. EngineAdapter Tests
  console.log('\n[7] EngineAdapter Contract Tests...');
  await runCase('[7] EngineAdapter contract', async () => {
    assert.throws(() => new EngineAdapter('cad', 'test'), /Cannot construct EngineAdapter instances directly/);

    class MockCaeAdapter extends EngineAdapter {
      constructor() {
        super('cae', 'mock-cae-adapter', '1.2.0');
      }
      describeCapabilities() {
        return {
          domain: this.domain,
          name: this.name,
          version: this.version,
          supportedOperations: ['solve_static_linear'],
          maturity: ValidationMaturity.VERIFIED,
          native: false
        };
      }
      async execute(jobRequest) {
        return new JobResult({
          jobId: jobRequest.jobId,
          status: JobStatus.COMPLETED,
          output: { solved: true }
        });
      }
    }

    const adapter = new MockCaeAdapter();
    assert.strictEqual(adapter.domain, 'cae');
    const caps = adapter.describeCapabilities();
    assert.strictEqual(caps.supportedOperations[0], 'solve_static_linear');

    // Test validate with valid and invalid requests
    const validReq = new JobRequest({ domain: 'cae', operation: 'solve_static_linear' });
    const invalidOpReq = new JobRequest({ domain: 'cae', operation: 'unknown_op' });
    const invalidDomainReq = new JobRequest({ domain: 'cad', operation: 'solve_static_linear' });

    assert.strictEqual(await adapter.validate(validReq), true);
    await assert.rejects(() => adapter.validate(invalidOpReq), /Operation "unknown_op" not supported/);
    await assert.rejects(() => adapter.validate(invalidDomainReq), /Domain mismatch/);

    class BaseAdapter extends EngineAdapter {
      constructor() {
        super('base', 'base-adapter', '1.0');
      }
      describeCapabilities() {
        return {
          ...super.describeCapabilities(),
          supportedOperations: ['op']
        };
      }
    }
    const base = new BaseAdapter();
    assert.deepStrictEqual(base.describeCapabilities(), {
      domain: 'base',
      name: 'base-adapter',
      version: '1.0',
      supportedOperations: ['op'],
      maturity: 'experimental',
      native: false
    });
    await base.prepare(new JobRequest({ domain: 'base', operation: 'op' }));
    await assert.rejects(
      () => base.execute(new JobRequest({ domain: 'base', operation: 'op' })),
      /execute\(\) not implemented/
    );
    assert.strictEqual(await base.cancel('job-1'), false);
    assert.strictEqual(await base.checkpoint('job-1'), null);

    const { defaultEngineRegistry } = require('../src/core/contracts/engine_registry');
    assert.strictEqual(defaultEngineRegistry.has('cad'), true);
    assert.strictEqual(defaultEngineRegistry.has('unknown_domain_xyz'), false);
    assert.ok(defaultEngineRegistry.get('cad'));
    assert.ok(Array.isArray(defaultEngineRegistry.listDomains()));
    console.log('  ✓ PASSED: EngineAdapter enforces domain and operation validation');
  });

  // 8. ToolDefinition, ToolProposal & ApprovalRecord Tests
  console.log('\n[8] ToolDefinition, ToolProposal & ApprovalRecord Tests...');
  await runCase('[8] ToolDefinition & approval contract', async () => {
    const queryTool = new ToolDefinition({
      name: 'optics.query_glass_catalog',
      description: 'Synthetic read-only tool contract fixture',
      approvalClass: ToolApprovalClass.READ_ONLY,
      parametersSchema: { type: 'object', required: ['vendor'] },
      modifiesState: false
    });
    assert.strictEqual(queryTool.isReadOnly(), true);

    const filletTool = new ToolDefinition({
      name: 'cad.apply_fillet',
      description: 'Applies rolling-ball fillet to selected B-Rep edge',
      approvalClass: ToolApprovalClass.MUTATION_PREVIEW,
      parametersSchema: { type: 'object', required: ['edgeId', 'radiusMm'] },
      modifiesState: true
    });
    assert.strictEqual(filletTool.isReadOnly(), false);

    const queryProp = new ToolProposal({
      toolName: 'optics.query_glass_catalog',
      args: { vendor: 'Schott', filters: { wavelengthNm: 550 } },
      approvalClass: ToolApprovalClass.READ_ONLY,
      originatingProjectRevision: 5
    });
    assert.strictEqual(queryProp.canAutoRun(), true);
    assert.throws(
      () => new ToolProposal({ toolName: 'optics.query_glass_catalog', approvalClass: ToolApprovalClass.READ_ONLY }),
      /explicit positive project revision/
    );
    assert.throws(() => queryTool.createProposal({ vendor: 'Schott' }), /explicit positive project revision/);
    assert.strictEqual(queryTool.createProposal({ vendor: 'Schott' }, '', [], 5).originatingProjectRevision, 5);
    assert.strictEqual(
      queryTool.createProposal({ vendor: 'Schott' }, '', [], 5, 'optics-project').originatingProjectId,
      'optics-project'
    );
    assert.throws(() => {
      queryProp.args.filters.wavelengthNm = 600;
    }, TypeError);
    assert.strictEqual(queryProp.args.filters.wavelengthNm, 550);

    const filletProp = new ToolProposal({
      toolName: 'cad.apply_fillet',
      args: { edgeId: 'E_12', radiusMm: 2.5 },
      expectedMutations: ['Adds fillet face F_102', 'Updates topology of faces F_10, F_11'],
      approvalClass: ToolApprovalClass.MUTATION_PREVIEW,
      originatingProjectRevision: 5,
      originatingProjectId: 'mechanical-project',
      reasoning: 'Smooth sharp edge per engineering drawing requirements'
    });
    assert.strictEqual(filletProp.canAutoRun(), false);
    assert.deepStrictEqual(filletProp.expectedMutations, [
      'Adds fillet face F_102',
      'Updates topology of faces F_10, F_11'
    ]);
    assert.strictEqual(filletProp.classification, ToolApprovalClass.MUTATION_PREVIEW);
    assert.strictEqual(filletProp.reasoning, 'Smooth sharp edge per engineering drawing requirements');
    assert.deepStrictEqual(filletProp.costEstimate, {});
    assert.strictEqual(typeof filletProp.createdAt, 'string');
    assert.deepStrictEqual(filletTool.parametersSchema, { type: 'object', required: ['edgeId', 'radiusMm'] });
    assert.strictEqual(filletTool.modifiesState, true);
    assert.strictEqual(ToolDefinition.fromJSON(filletTool.toJSON()).name, 'cad.apply_fillet');

    const rejectProp = new ToolProposal({
      toolName: 'cad.apply_fillet',
      originatingProjectRevision: 1
    });
    rejectProp.reject('Manually rejected');
    assert.strictEqual(rejectProp.status, 'REJECTED');

    assert.strictEqual(ToolProposal.fromJSON(filletProp.toJSON()).originatingProjectId, 'mechanical-project');
    assert.throws(
      () => new ToolProposal({ toolName: 'cad.apply_fillet', originatingProjectRevision: 5, originatingProjectId: '' }),
      /project ID must be a non-empty string/
    );

    const approval = new ApprovalRecord({
      proposalId: filletProp.proposalId,
      decision: ApprovalDecision.APPROVED,
      userId: 'lead_mechanical_engineer',
      comment: 'Fillet verified against stress concentration threshold',
      appliedOverrides: { overrideKey: true }
    });
    assert.strictEqual(approval.isApproved(), true);
    assert.strictEqual(approval.userId, 'lead_mechanical_engineer');
    assert.strictEqual(approval.approvedBy, 'lead_mechanical_engineer');
    assert.strictEqual(approval.comment, 'Fillet verified against stress concentration threshold');
    assert.strictEqual(approval.reason, 'Fillet verified against stress concentration threshold');
    assert.deepStrictEqual(approval.appliedOverrides, { overrideKey: true });
    assert.strictEqual(typeof approval.decidedAt, 'string');
    assert.strictEqual(typeof approval.timestamp, 'string');

    const rejectApproval = new ApprovalRecord({
      proposalId: filletProp.proposalId,
      decision: ApprovalDecision.REJECTED,
      userId: 'lead_mechanical_engineer',
      comment: 'Fillet radius too large for mating clearance'
    });
    assert.strictEqual(rejectApproval.isApproved(), false);
    const modifiedApproval = new ApprovalRecord({
      proposalId: filletProp.proposalId,
      decision: ApprovalDecision.MODIFIED,
      userId: 'local-test-identity',
      modifiedArgs: { radiusMm: 1.5 }
    });
    assert.deepStrictEqual(ApprovalRecord.fromJSON(modifiedApproval.toJSON()).modifiedArgs, { radiusMm: 1.5 });
    assert.strictEqual(modifiedApproval.isApproved(), true);
    assert.strictEqual(ToolProposal.fromJSON(filletProp.toJSON()).canAutoRun(), false);
    console.log('  ✓ PASSED: Stenographer tool definitions, proposals, auto-run gating, and approval records work');
  });

  // 9. StenographerClient Abstract Class Test
  console.log('\n[9] StenographerClient Abstract Class Test...');
  await runCase('[9] StenographerClient abstract contract', async () => {
    assert.throws(() => new StenographerClient(), /Cannot construct StenographerClient instances directly/);
    class ConcreteClient extends StenographerClient {}
    const client = new ConcreteClient();
    await assert.rejects(() => client.connect(), /connect\(\) not implemented/);
    await assert.rejects(() => client.disconnect(), /disconnect\(\) not implemented/);
    await assert.rejects(() => client.query('test'), /query\(\) not implemented/);
    await assert.rejects(() => client.submitToolResult('p1', {}), /submitToolResult\(\) not implemented/);
    await assert.rejects(() => client.getStatus(), /getStatus\(\) not implemented/);
    console.log('  ✓ PASSED: StenographerClient enforces subclassing and abstract methods');
  });

  // 10. ProjectManifestV2 Tests
  console.log('\n[10] ProjectManifestV2 Tests...');
  await runCase('[10] ProjectManifestV2 contract', async () => {
    const manifest = new ProjectManifestV2({
      name: 'Centrifugal Pump Impeller Rev 4',
      revision: 4,
      activeUnits: 'SI_MM',
      domainModels: {
        cad: { rootPartId: 'part-impeller-blade-01' },
        cfd: { meshRef: 'a'.repeat(64) }
      },
      revisions: [{ rev: 1, note: 'initial' }],
      snapshots: [{ snap: 's1' }]
    });

    assert.strictEqual(manifest.schemaVersion, '2.0.0');
    assert.strictEqual(manifest.revision, 4);
    assert.strictEqual(manifest.activeUnits, 'SI_MM');
    assert.strictEqual(manifest.name, 'Centrifugal Pump Impeller Rev 4');
    assert.strictEqual(manifest.projectName, 'Centrifugal Pump Impeller Rev 4');
    assert.strictEqual(manifest.author, 'OmniEng_Engineer');
    assert.strictEqual(manifest.engineeringDomain, 'universal');
    assert.strictEqual(typeof manifest.projectId, 'string');
    assert.ok(manifest.domainModels.cad);
    assert.deepStrictEqual(manifest.blobs, {});
    assert.strictEqual(manifest.journalRef, '');
    assert.deepStrictEqual(manifest.results, []);
    assert.deepStrictEqual(manifest.signatures, []);
    assert.strictEqual(typeof manifest.createdAt, 'string');
    assert.strictEqual(typeof manifest.created, 'string');
    assert.strictEqual(typeof manifest.updatedAt, 'string');
    assert.strictEqual(typeof manifest.updated, 'string');

    const bumped = manifest.withIncrementedRevision({ name: 'Centrifugal Pump Impeller Rev 5' });
    assert.strictEqual(bumped.revision, 5);
    assert.strictEqual(bumped.name, 'Centrifugal Pump Impeller Rev 5');

    const json = manifest.toJSON();
    const restored = ProjectManifestV2.fromJSON(json);
    assert.strictEqual(restored.revision, 4);
    assert.strictEqual(restored.schemaVersion, '2.0.0');

    assert.throws(() => new ProjectManifestV2({ schemaVersion: '1.0.0' }), /requires schemaVersion "2.0.0"/);
    assert.throws(() => ProjectManifestV2.fromJSON(null), /Invalid ProjectManifestV2 JSON/);
    console.log('  ✓ PASSED: ProjectManifestV2 enforces schema version 2.0.0, revision bumps, and serializes cleanly');
  });

  const total = results.length;
  const failed = results.filter((r) => !r.ok).length;
  const passed = total - failed;
  console.log('\n================================================================');
  console.log(`   SHARED ARCHITECTURAL CONTRACT SUMMARY: ${passed}/${total} PASSED, ${failed} FAILED`);
  console.log('================================================================');
  return { total, passed, failed };
}

if (require.main === module) {
  runSharedContractsTests()
    .then((stats) => {
      if (stats.failed > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { runSharedContractsTests };
