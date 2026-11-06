'use strict';

const { REFERENCE_BENCHMARKS_PATH, loadReferenceBenchmarks, BENCHMARK_RUNNERS } = require('./benchmark_runners');
const { ValidationRecord, ValidationMaturity } = require('../contracts/ValidationRecord');
const { Quantity } = require('../contracts/Quantity');
const { getUnavailableValidationCase, getValidationReadiness } = require('./validation_readiness');

const UNAVAILABLE_BENCHMARK_ALIASES = Object.freeze({
  ISO_10110_OPTICS_TOLERANCE: 'ISO_10110_OPTICS'
});

const VV_BENCHMARK_IDS = Object.freeze(Object.keys(BENCHMARK_RUNNERS));

/**
 * Lists experimental diagnostic definitions from the candidate benchmark
 * metadata file. Entries are not release qualification evidence.
 * @returns {Array<Object>}
 */
function listVVBenchmarks() {
  const { data, sha256 } = loadReferenceBenchmarks();
  return VV_BENCHMARK_IDS.map((id) => {
    const spec = data.benchmarks[id];
    return {
      id,
      domain: spec.domain,
      title: spec.title,
      source: spec.source,
      metric: spec.metric,
      units: spec.units,
      targetValue: spec.targetValue,
      relativeTolerance: spec.relativeTolerance,
      referenceSha256: null,
      benchmarkMetadataSha256: sha256,
      referenceHashScope: 'candidate metadata JSON only; not a source-data artifact hash',
      validationLevel: 'experimental',
      releaseApproved: false
    };
  });
}

/**
 * Executes one experimental diagnostic. Named reference cases without a
 * qualified production comparison return unavailable rather than dispatching
 * an analytic substitute under the named-reference ID.
 * @param {string} benchmarkId
 * @returns {Object}
 */
function runVVBenchmark(benchmarkId) {
  const runner = BENCHMARK_RUNNERS[benchmarkId];
  if (typeof runner !== 'function') {
    const readinessId = UNAVAILABLE_BENCHMARK_ALIASES[benchmarkId] || benchmarkId;
    try {
      return {
        ...getUnavailableValidationCase(readinessId),
        validationLevel: 'unavailable',
        releaseApproved: false
      };
    } catch {
      throw new Error(`Unknown V&V benchmark ID: ${benchmarkId}`);
    }
  }
  const { data, sha256 } = loadReferenceBenchmarks();
  const spec = data.benchmarks[benchmarkId];
  if (!spec) {
    throw new Error(`Missing reference benchmark specification for: ${benchmarkId}`);
  }

  const startMs = Date.now();
  const outcome = runner(spec);
  const durationMs = Date.now() - startMs;

  const computedQuantity = Quantity.from(outcome.computedValue, outcome.units);
  const targetQuantity = Quantity.from(outcome.targetValue, outcome.units);
  const validationRecord = new ValidationRecord({
    maturity: ValidationMaturity.EXPERIMENTAL,
    benchmarkSet: outcome.id,
    errors: { relativeError: outcome.relativeError },
    tolerances: { maxRelativeError: outcome.relativeTolerance }
  });

  return {
    ...outcome,
    durationMs,
    referenceDatasetSha256: null,
    benchmarkMetadataSha256: sha256,
    referenceHashScope: 'candidate metadata JSON only; not a source-data artifact hash',
    validationLevel: 'experimental',
    releaseApproved: false,
    quantities: {
      computed: computedQuantity.toJSON(),
      target: targetQuantity.toJSON()
    },
    validationRecord: validationRecord.toJSON()
  };
}

/**
 * Executes all registered V&V benchmarks and returns a structured report and summary.
 * @returns {Object}
 */
function runAllVVBenchmarks() {
  const { sha256 } = loadReferenceBenchmarks();
  const readiness = getValidationReadiness();
  const results = [];
  let passedCount = 0;
  let failedCount = 0;

  for (const id of VV_BENCHMARK_IDS) {
    const res = runVVBenchmark(id);
    results.push(res);
    if (res.passed) {
      passedCount++;
    } else {
      failedCount++;
    }
  }

  const total = results.length;
  const passed = failedCount === 0 && total > 0;
  const maxRelativeError = results.reduce((max, r) => Math.max(max, r.relativeError), 0);

  const summary = {
    passed,
    validationReady: false,
    releaseApproved: false,
    resultScope: 'experimental-diagnostic-only',
    maturity: ValidationMaturity.EXPERIMENTAL,
    total,
    passedCount,
    failedCount,
    unavailableReferenceCount: readiness.unavailable,
    unavailableReferenceIds: readiness.results.map((result) => result.id),
    passRatePercent: total > 0 ? Number(((passedCount / total) * 100).toFixed(2)) : 0,
    maxRelativeError: Number(maxRelativeError.toExponential(4)),
    referenceDatasetSha256: null,
    benchmarkMetadataSha256: sha256,
    referenceHashScope: 'candidate metadata JSON only; not a source-data artifact hash',
    benchmarks: results.map((r) => ({
      id: r.id,
      domain: r.domain,
      passed: r.passed,
      computedValue: Number(r.computedValue.toPrecision(6)),
      targetValue: r.targetValue,
      units: r.units,
      relativeErrorPercent: Number((r.relativeError * 100).toFixed(4)),
      tolerancePercent: Number((r.relativeTolerance * 100).toFixed(2))
    }))
  };

  return {
    passed,
    total,
    passedCount,
    failedCount,
    diagnosticOnly: true,
    validationReady: false,
    releaseApproved: false,
    resultScope: 'experimental-diagnostic-only',
    unavailableReferenceCount: readiness.unavailable,
    unavailableReferenceIds: readiness.results.map((result) => result.id),
    referenceDatasetPath: REFERENCE_BENCHMARKS_PATH,
    referenceDatasetSha256: sha256,
    summary,
    results,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  VV_BENCHMARK_IDS,
  listVVBenchmarks,
  runVVBenchmark,
  runAllVVBenchmarks
};
