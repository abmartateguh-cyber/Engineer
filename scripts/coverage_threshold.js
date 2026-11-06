'use strict';

/**
 * OmniEng coverage gate thresholds and evaluators.
 *
 * Three independent floors are enforced for every production file under src/:
 *   - Function coverage >= 85%
 *   - Line coverage    >= 85%
 *   - Branch coverage   >= 85% (V8 block-transition proxy, see run_coverage.js)
 *
 * Metric definitions (kept in sync with scripts/run_coverage.js):
 *   - Function: a loaded function is covered when at least one of its V8
 *     ranges has count > 0. Module-level initialization ranges are excluded.
 *   - Line: executable lines are the source lines touched by any V8 range;
 *     a line is covered when at least one of its offsets lies inside a range
 *     with count > 0.
 *   - Branch (proxy): each function's first range is its entry block; every
 *     remaining range is treated as a branch-target block reachable only via
 *     a conditional/loop path. Branch coverage = covered non-entry blocks /
 *     total non-entry blocks. This is a conservative statement-level proxy:
 *     V8 does not expose true edge/branch counts in NODE_V8_COVERAGE output.
 */

const MIN_FUNCTION_COVERAGE_PERCENT = 85;
const MIN_LINE_COVERAGE_PERCENT = 85;
const MIN_BRANCH_COVERAGE_PERCENT = 85;

function validateCounts(covered, total, label) {
  if (!Number.isSafeInteger(covered) || !Number.isSafeInteger(total)) {
    throw new TypeError(`${label} coverage counts must be safe integers.`);
  }
  if (total < 0 || covered < 0 || covered > total) {
    throw new RangeError(`${label} coverage counts are outside their supported range.`);
  }
}

function evaluateGate(covered, total, minimumPercent, label) {
  validateCounts(covered, total, label);
  const actualPercent = total === 0 ? 0 : (covered / total) * 100;
  return {
    minimumPercent,
    actualPercent: Number(actualPercent.toFixed(2)),
    passed: total > 0 && actualPercent >= minimumPercent
  };
}

function evaluateFunctionCoverageGate(coveredFunctions, totalFunctions) {
  return evaluateGate(coveredFunctions, totalFunctions, MIN_FUNCTION_COVERAGE_PERCENT, 'Function');
}

function evaluateLineCoverageGate(coveredLines, totalLines) {
  return evaluateGate(coveredLines, totalLines, MIN_LINE_COVERAGE_PERCENT, 'Line');
}

function evaluateBranchCoverageGate(coveredBranches, totalBranches) {
  return evaluateGate(coveredBranches, totalBranches, MIN_BRANCH_COVERAGE_PERCENT, 'Branch');
}

/**
 * Evaluates all three gates and returns each gate plus an aggregate flag.
 * @param {number} coveredFunctions
 * @param {number} totalFunctions
 * @param {number} coveredLines
 * @param {number} totalLines
 * @param {number} coveredBranches
 * @param {number} totalBranches
 */
function evaluateCoverageGates(
  coveredFunctions,
  totalFunctions,
  coveredLines,
  totalLines,
  coveredBranches,
  totalBranches
) {
  const functionEntry = evaluateFunctionCoverageGate(coveredFunctions, totalFunctions);
  const line = evaluateLineCoverageGate(coveredLines, totalLines);
  const branch = evaluateBranchCoverageGate(coveredBranches, totalBranches);
  return {
    functionEntry,
    line,
    branch,
    allPassed: functionEntry.passed && line.passed && branch.passed
  };
}

module.exports = {
  MIN_FUNCTION_COVERAGE_PERCENT,
  MIN_LINE_COVERAGE_PERCENT,
  MIN_BRANCH_COVERAGE_PERCENT,
  evaluateFunctionCoverageGate,
  evaluateLineCoverageGate,
  evaluateBranchCoverageGate,
  evaluateCoverageGates
};
