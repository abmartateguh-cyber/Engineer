'use strict';

const MIN_FUNCTION_COVERAGE_PERCENT = 75;

function evaluateFunctionCoverageGate(coveredFunctions, totalFunctions) {
  if (!Number.isSafeInteger(coveredFunctions) || !Number.isSafeInteger(totalFunctions)) {
    throw new TypeError('Function coverage counts must be safe integers.');
  }
  if (totalFunctions < 0 || coveredFunctions < 0 || coveredFunctions > totalFunctions) {
    throw new RangeError('Function coverage counts are outside their supported range.');
  }

  const actualPercent = totalFunctions === 0 ? 0 : (coveredFunctions / totalFunctions) * 100;
  return {
    minimumPercent: MIN_FUNCTION_COVERAGE_PERCENT,
    actualPercent: Number(actualPercent.toFixed(2)),
    passed: totalFunctions > 0 && actualPercent >= MIN_FUNCTION_COVERAGE_PERCENT
  };
}

module.exports = { MIN_FUNCTION_COVERAGE_PERCENT, evaluateFunctionCoverageGate };
