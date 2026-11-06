'use strict';

const assert = require('node:assert/strict');
const { REFERENCE_CASES } = require('../src/core/vv/moose_beam_reference');
const { runEulerBeamMooseReference } = require('../src/core/vv/euler_beam_moose_reference');
const { runTimoshenkoBeamMooseReference } = require('../src/core/vv/timoshenko_beam_moose_reference');
const { listVVBenchmarks, runVVBenchmark, runAllVVBenchmarks } = require('../src/core/vv/vv_registry');
const { runNafemsFV32 } = require('./vv/nafems/test_nafems_fv32');
const { runNafemsT1 } = require('./vv/nafems/test_nafems_t1');

function runVvStatusContractTests() {
  const eulerLimit = runEulerBeamMooseReference();
  assert.strictEqual(eulerLimit.id, 'MOOSE_EULER_CANTILEVER_10_ELEMENT');
  assert.strictEqual(eulerLimit.status, 'passed', eulerLimit.reason);
  assert.strictEqual(eulerLimit.metadata.solverExecuted, true);
  assert.strictEqual(eulerLimit.metadata.solver, 'TimoshenkoBeam3D plus WasmSparseMultifrontalSolver');
  assert.strictEqual(eulerLimit.metadata.referenceArtifactSha256, REFERENCE_CASES.eulerLimit.sha256);
  assert.strictEqual(eulerLimit.targetValue, 0.05766);
  assert(eulerLimit.errorPercent <= eulerLimit.tolerancePercent);
  assert(
    eulerLimit.metadata.independentlyComputedRelativeResidual <=
      eulerLimit.metadata.maximumIndependentlyComputedRelativeResidual,
    'Euler-limit beam solve must satisfy its independent residual threshold'
  );

  const timoshenko = runTimoshenkoBeamMooseReference();
  assert.strictEqual(timoshenko.status, 'passed', timoshenko.reason);
  assert.strictEqual(timoshenko.metadata.solverExecuted, true);
  assert.strictEqual(timoshenko.metadata.referenceArtifactSha256, REFERENCE_CASES.timoshenko.sha256);

  const nafemsFV32 = runNafemsFV32();
  assert.strictEqual(nafemsFV32.id, 'NAFEMS_FV32');
  assert.strictEqual(nafemsFV32.passed, true, nafemsFV32.reason);
  assert.strictEqual(nafemsFV32.status, 'passed');

  const conductionDiagnostic = runNafemsT1();
  assert.strictEqual(conductionDiagnostic.id, 'NAFEMS_T1');
  assert.strictEqual(conductionDiagnostic.passed, true, conductionDiagnostic.reason);
  assert.strictEqual(conductionDiagnostic.status, 'passed');

  const registeredIds = new Set(listVVBenchmarks().map((benchmark) => benchmark.id));
  for (const id of ['NAFEMS_LE1', 'NAFEMS_LE10', 'NAFEMS_LE11', 'NAFEMS_FV32', 'NAFEMS_T1']) {
    assert.strictEqual(registeredIds.has(id), false, `${id} must remain a named-reference readiness case`);
  }
  assert.strictEqual(registeredIds.has('NASA_TMR_FLAT_PLATE'), false);
  assert.strictEqual(registeredIds.has('NASA_TMR_CORRELATION_DIAGNOSTIC'), true);
  assert.strictEqual(registeredIds.has('HERTZ_CONTACT_3D'), false);
  assert.strictEqual(registeredIds.has('HERTZ_AXISYMMETRIC_CONTACT_DIAGNOSTIC'), true);
  assert.strictEqual(registeredIds.has('NIST_SPARSE_ROBUSTNESS'), false);
  assert.strictEqual(registeredIds.has('HANOVER_BEAM_DYNAMIC_RESPONSE'), false);
  assert.strictEqual(registeredIds.has('ISO_10110_OPTICS_TOLERANCE'), false);
  const correlationMetadata = listVVBenchmarks().find(
    (benchmark) => benchmark.id === 'NASA_TMR_CORRELATION_DIAGNOSTIC'
  );
  assert.strictEqual(correlationMetadata.referenceSha256, null);
  assert.match(correlationMetadata.referenceHashScope, /metadata JSON only/);
  for (const id of [
    'NAFEMS_LE1',
    'NAFEMS_LE10',
    'NAFEMS_LE11',
    'NAFEMS_FV32',
    'NAFEMS_T1',
    'NASA_TMR_FLAT_PLATE',
    'HERTZ_CONTACT_3D',
    'NIST_SPARSE_ROBUSTNESS',
    'HANOVER_BEAM_DYNAMIC_RESPONSE',
    'ISO_10110_OPTICS_TOLERANCE'
  ]) {
    const result = runVVBenchmark(id);
    assert.strictEqual(result.status, 'unavailable', `${id} must not execute a substitute under the reference ID`);
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.releaseApproved, false);
    assert.ok(result.reason.length > 0);
  }

  const correlationDiagnostic = runVVBenchmark('NASA_TMR_CORRELATION_DIAGNOSTIC');
  assert.strictEqual(correlationDiagnostic.id, 'NASA_TMR_CORRELATION_DIAGNOSTIC');
  assert.strictEqual(correlationDiagnostic.passed, true, correlationDiagnostic.reason);
  assert.strictEqual(correlationDiagnostic.diagnostics.solverExecuted, false);
  assert.strictEqual(correlationDiagnostic.validationRecord.maturity, 'experimental');
  assert.strictEqual(correlationDiagnostic.referenceDatasetSha256, null);

  const coreRegistryRun = runAllVVBenchmarks();
  assert.strictEqual(coreRegistryRun.total, 5);
  assert.strictEqual(coreRegistryRun.failedCount, 0);
  assert.strictEqual(coreRegistryRun.diagnosticOnly, true);
  assert.strictEqual(coreRegistryRun.validationReady, false);
  assert.strictEqual(coreRegistryRun.releaseApproved, false);
  assert.strictEqual(coreRegistryRun.unavailableReferenceCount, 10);
  assert.strictEqual(
    coreRegistryRun.results.some((result) => result.id === 'NASA_TMR_FLAT_PLATE'),
    false
  );

  return { total: 1, passed: 1, failed: 0 };
}

if (require.main === module) {
  try {
    runVvStatusContractTests();
    console.log('V&V status contract passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = { runVvStatusContractTests };
