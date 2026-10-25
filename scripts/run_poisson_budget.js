'use strict';

const assert = require('assert');
const { measureStructuredPoissonBudget } = require('../src/core/vv/poisson_performance');

const result = measureStructuredPoissonBudget();
console.log(JSON.stringify(result, null, 2));

assert.strictEqual(result.unknowns, 99856);
assert.strictEqual(result.solverMethod, '2d-poisson-dst1');
assert.strictEqual(result.nnzL, null);
assert(result.relativeResidual < 1e-8, 'Solver-reported relative residual must be below 1e-8.');
assert(result.independentResidualRms < 1e-8, 'Independently recomputed residual must be below 1e-8.');
assert(
  result.factorizationStorageBytes < result.unknowns * 9,
  'DST basis storage must remain linear in the unknown count.'
);
assert(
  result.withinPerformanceBudget,
  `Solve took ${result.elapsedMs.toFixed(0)} ms; budget is ${result.performanceBudgetMs} ms.`
);
