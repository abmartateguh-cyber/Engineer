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

console.log('================================================================');
console.log('       TESTING OMNIENG SHARED ARCHITECTURAL CONTRACTS           ');
console.log('================================================================');

// 1. OmniError Tests
console.log('\n[1] OmniError Contract Tests...');
{
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
}

// 2. Quantity & Units Arithmetic Tests
console.log('\n[2] Quantity & Units Arithmetic Tests...');
{
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

  // Rejection of non-finite inputs
  assert.throws(() => Quantity.from(NaN, 'm'), /non-finite value/);
  assert.throws(() => Quantity.from(Infinity, 'm'), /non-finite value/);
  assert.throws(() => Quantity.from(10, 'unregistered_unit_xyz'), /Unrecognized unit/);
  console.log('  ✓ PASSED: Quantity handles SI bases, offset conversions, dimensional arithmetic, and uncertainties');
}

// 3. ArtifactRef Tests
console.log('\n[3] ArtifactRef Tests...');
{
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

  const json = ref.toJSON();
  const restored = ArtifactRef.fromJSON(json);
  assert.strictEqual(restored.hash, ref.hash);
  assert.strictEqual(restored.byteLength, ref.byteLength);

  // Reject invalid hash
  assert.throws(() => new ArtifactRef({ hash: 'invalid_short_hash', mimeType: 'text/plain' }), /valid 64-char/);
  console.log('  ✓ PASSED: ArtifactRef creates SHA-256 references, enforces hex hashes and retention policy');
}

// 4. ValidationRecord Tests
console.log('\n[4] ValidationRecord Tests...');
{
  const rec = new ValidationRecord({
    maturity: ValidationMaturity.RELEASED,
    benchmarkSet: 'NAFEMS-LE1-PLANE-STRESS',
    errors: { maxVonMisesErrorPct: 0.12 },
    reviewer: 'Chief Structural Engineer PE #48291',
    signature: 'sig-sha256-verified-evidence-package',
    tolerances: { maxAllowedErrorPct: 1.0 }
  });
  assert.strictEqual(rec.maturity, 'released');
  assert.strictEqual(rec.isReleaseReady(), true);

  const expRec = new ValidationRecord({
    maturity: ValidationMaturity.EXPERIMENTAL,
    benchmarkSet: 'SYNTHETIC-SMOKE'
  });
  assert.strictEqual(expRec.isReleaseReady(), false);
  console.log('  ✓ PASSED: ValidationRecord models maturity levels and release certification criteria');
}

// 5. JobRequest & JobResult Tests
console.log('\n[5] JobRequest & JobResult Tests...');
{
  const dummyHash = 'a'.repeat(64);
  const req = new JobRequest({
    domain: 'cae',
    operation: 'solve_static_linear',
    inputArtifactHashes: [dummyHash],
    projectRevision: 3,
    parameters: { solverType: 'SparseCholesky', maxIterations: 1000 },
    resourceBudget: { maxTimeMs: 15000, maxMemoryMb: 1024, maxThreads: 8 },
    seed: 12345,
    tolerances: { residualNorm: 1e-10 },
    priority: JobPriority.HIGH
  });

  assert.strictEqual(req.domain, 'cae');
  assert.strictEqual(req.operation, 'solve_static_linear');
  assert.strictEqual(req.resourceBudget.maxTimeMs, 15000);
  assert.strictEqual(req.priority, JobPriority.HIGH);
  const hash1 = req.computeContentHash();
  const hash2 = req.computeContentHash();
  assert.strictEqual(hash1, hash2, 'Content hash must be deterministic');
  assert.strictEqual(hash1.length, 64);

  const res = new JobResult({
    jobId: req.jobId,
    status: JobStatus.COMPLETED,
    output: { degreesOfFreedom: 45000, maxDeflection: 0.0034 },
    residualHistory: [
      { iteration: 1, residual: 1.0 },
      { iteration: 2, residual: 1.4e-6 },
      { iteration: 3, residual: 9.8e-12 }
    ],
    timing: { queuedMs: 12, runMs: 450, totalMs: 462 },
    peakMemoryBytes: 48 * 1024 * 1024,
    backendVersions: { engine: '1.0.0', node: process.version },
    inputArtifactHashes: [dummyHash],
    validationMaturity: ValidationMaturity.CORRELATED
  });

  assert.strictEqual(res.isSuccess(), true);
  assert.strictEqual(res.residualHistory.length, 3);
  assert.strictEqual(res.timing.runMs, 450);

  const json = res.toJSON();
  const restoredRes = JobResult.fromJSON(json);
  assert.strictEqual(restoredRes.jobId, req.jobId);
  assert.strictEqual(restoredRes.status, JobStatus.COMPLETED);
  console.log('  ✓ PASSED: JobRequest computes deterministic content hash; JobResult records convergence and timings');
}

// 6. JobEvent Streaming Tests
console.log('\n[6] JobEvent Streaming Tests...');
{
  const ev = new JobEvent('job-123', JobEventType.PROGRESS, { percent: 45, currentStep: 'Assembling global matrix' });
  assert.strictEqual(ev.jobId, 'job-123');
  assert.strictEqual(ev.type, JobEventType.PROGRESS);
  assert.strictEqual(ev.data.percent, 45);

  const json = ev.toJSON();
  const restored = JobEvent.fromJSON(json);
  assert.strictEqual(restored.data.percent, 45);
  console.log('  ✓ PASSED: JobEvent records streaming progress, residuals, and steps');
}

// 7. EngineAdapter Tests
console.log('\n[7] EngineAdapter Contract Tests...');
{
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

  (async () => {
    assert.strictEqual(await adapter.validate(validReq), true);
    await assert.rejects(() => adapter.validate(invalidOpReq), /Operation "unknown_op" not supported/);
    await assert.rejects(() => adapter.validate(invalidDomainReq), /Domain mismatch/);
  })();
  console.log('  ✓ PASSED: EngineAdapter enforces domain and operation validation');
}

// 8. ToolDefinition, ToolProposal & ApprovalRecord Tests
console.log('\n[8] ToolDefinition, ToolProposal & ApprovalRecord Tests...');
{
  const queryTool = new ToolDefinition({
    name: 'optics.query_glass_catalog',
    description: 'Queries verified refractive index tables for glass families',
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
    args: { vendor: 'Schott' },
    approvalClass: ToolApprovalClass.READ_ONLY,
    originatingProjectRevision: 5
  });
  assert.strictEqual(queryProp.canAutoRun(), true);

  const filletProp = new ToolProposal({
    toolName: 'cad.apply_fillet',
    args: { edgeId: 'E_12', radiusMm: 2.5 },
    expectedMutations: ['Adds fillet face F_102', 'Updates topology of faces F_10, F_11'],
    approvalClass: ToolApprovalClass.MUTATION_PREVIEW,
    originatingProjectRevision: 5,
    reasoning: 'Smooth sharp edge per engineering drawing requirements'
  });
  assert.strictEqual(filletProp.canAutoRun(), false);

  const approval = new ApprovalRecord({
    proposalId: filletProp.proposalId,
    decision: ApprovalDecision.APPROVED,
    userId: 'lead_mechanical_engineer',
    comment: 'Fillet verified against stress concentration threshold'
  });
  assert.strictEqual(approval.isApproved(), true);

  const rejectApproval = new ApprovalRecord({
    proposalId: filletProp.proposalId,
    decision: ApprovalDecision.REJECTED,
    userId: 'lead_mechanical_engineer',
    comment: 'Fillet radius too large for mating clearance'
  });
  assert.strictEqual(rejectApproval.isApproved(), false);
  console.log('  ✓ PASSED: Stenographer tool definitions, proposals, auto-run gating, and approval records work');
}

// 9. StenographerClient Abstract Class Test
console.log('\n[9] StenographerClient Abstract Class Test...');
{
  assert.throws(() => new StenographerClient(), /Cannot construct StenographerClient instances directly/);
  console.log('  ✓ PASSED: StenographerClient enforces subclassing');
}

// 10. ProjectManifestV2 Tests
console.log('\n[10] ProjectManifestV2 Tests...');
{
  const manifest = new ProjectManifestV2({
    name: 'Centrifugal Pump Impeller Rev 4',
    revision: 4,
    activeUnits: 'SI_MM',
    domainModels: {
      cad: { rootPartId: 'part-impeller-blade-01' },
      cfd: { meshRef: 'a'.repeat(64) }
    }
  });

  assert.strictEqual(manifest.schemaVersion, '2.0.0');
  assert.strictEqual(manifest.revision, 4);
  assert.strictEqual(manifest.activeUnits, 'SI_MM');
  assert.strictEqual(manifest.name, 'Centrifugal Pump Impeller Rev 4');

  const bumped = manifest.withIncrementedRevision({ name: 'Centrifugal Pump Impeller Rev 5' });
  assert.strictEqual(bumped.revision, 5);
  assert.strictEqual(bumped.name, 'Centrifugal Pump Impeller Rev 5');

  const json = manifest.toJSON();
  const restored = ProjectManifestV2.fromJSON(json);
  assert.strictEqual(restored.revision, 4);
  assert.strictEqual(restored.schemaVersion, '2.0.0');

  assert.throws(() => new ProjectManifestV2({ schemaVersion: '1.0.0' }), /requires schemaVersion "2.0.0"/);
  console.log('  ✓ PASSED: ProjectManifestV2 enforces schema version 2.0.0, revision bumps, and serializes cleanly');
}

console.log('\n================================================================');
console.log('   ALL SHARED ARCHITECTURAL CONTRACT ASSERTIONS PASSED!         ');
console.log('================================================================');
