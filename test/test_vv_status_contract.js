'use strict';

const assert = require('node:assert/strict');
const { REFERENCE_CASES } = require('../src/core/vv/moose_beam_reference');
const { runEulerBeamMooseReference } = require('../src/core/vv/euler_beam_moose_reference');
const { runTimoshenkoBeamMooseReference } = require('../src/core/vv/timoshenko_beam_moose_reference');

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
