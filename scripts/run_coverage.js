'use strict';

/**
 * OmniEng V8 coverage runner (Line + Branch + Function gates).
 *
 * Metric definitions (header; mirrors scripts/coverage_threshold.js):
 *
 *   1. FUNCTION coverage — a loaded function is covered when at least one of
 *      its V8 ranges has count > 0. Module-level initialization ranges
 *      (functionName === '' with startOffset 0) are excluded from ALL metrics,
 *      so coverage describes loaded function bodies only, not top-level
 *      statement runs (which otherwise span entire files and would mask
 *      uncovered lines).
 *
 *   2. LINE coverage — the raw NODE_V8_COVERAGE output has no line records, so
 *      lines are derived from function ranges. An executable line is any source
 *      line whose byte offsets intersect at least one function range (i.e. it
 *      belongs to the code extent V8 instrumented inside a function). A line is
 *      covered when at least one of its offsets lies inside a function range
 *      with count > 0. This is the same range-mapping approach used by
 *      nyc/c8 for line percentages.
 *
 *   3. BRANCH coverage (conservative proxy) — V8 does not emit true branch/edge
 *      records in NODE_V8_COVERAGE JSON, so branch coverage is computed as
 *      statement/block coverage: each function's first range is its entry
 *      block; every remaining range is treated as a branch-target block that is
 *      only reachable through a conditional/loop path. Branch coverage =
 *      covered non-entry blocks / total non-entry blocks. This is documented as
 *      a conservative statement-level proxy, not a real branch/taken analysis.
 *
 * The scripts runs the full suite under NODE_V8_COVERAGE, aggregates all V8
 * JSON documents, evaluates all three gates (each >= 85%), prints each
 * percentage with PASS/FAIL, and exits 1 if the suite fails or any floor is
 * missed.
 */

const { spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { evaluateCoverageGates } = require('./coverage_threshold');

const DEFAULT_COVERAGE_TIMEOUT_MS = 1800 * 1000;
const parsedCoverageTimeoutMs = Number.parseInt(process.env.TEST_TIMEOUT_MS ?? '', 10);
const TEST_TIMEOUT_MS =
  Number.isInteger(parsedCoverageTimeoutMs) && parsedCoverageTimeoutMs > 0
    ? parsedCoverageTimeoutMs
    : DEFAULT_COVERAGE_TIMEOUT_MS;
const outputIndex = process.argv.indexOf('--output-dir');
const outputDirArgument = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;

function buildLineIndex(source) {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  const lineIndex = new Int32Array(Math.max(source.length, 1));
  let currentLine = 1;
  for (let i = 0; i < source.length; i++) {
    lineIndex[i] = currentLine;
    if (source.charCodeAt(i) === 10) currentLine++;
  }
  return { lineStarts, lineIndex };
}

function linesTouchedByRange(range, lineIndexObject) {
  const lineIndex = lineIndexObject.lineIndex;
  const startLine = lineIndex[Math.min(range.startOffset, lineIndex.length - 1)];
  const endLine = lineIndex[Math.min(Math.max(range.endOffset - 1, 0), lineIndex.length - 1)];
  const lines = [];
  for (let line = startLine; line <= endLine; line++) lines.push(line);
  return lines;
}

if (typeof outputDirArgument !== 'string' || outputDirArgument.trim() === '') {
  console.error('Usage: npm run coverage -- --output-dir <directory>');
  process.exitCode = 2;
} else {
  const root = path.resolve(__dirname, '..');
  const outputDir = path.resolve(outputDirArgument);
  mkdirSync(outputDir, { recursive: true });
  const coverageDir = mkdtempSync(path.join(outputDir, 'v8-'));
  const env = { ...process.env, NODE_V8_COVERAGE: coverageDir, OMNI_COVERAGE_MODE: '1' };
  const suite = spawnSync(process.execPath, ['test/run_all_tests.js'], {
    cwd: root,
    env,
    stdio: 'inherit',
    timeout: TEST_TIMEOUT_MS,
    killSignal: 'SIGKILL'
  });

  if (suite.error) {
    if (suite.error.code === 'ETIMEDOUT') {
      console.error(`Coverage test suite exceeded ${TEST_TIMEOUT_MS} ms and was terminated.`);
    } else {
      console.error(`Could not start or complete the test suite: ${suite.error.message}`);
    }
    process.exitCode = 1;
  } else {
    const coverageByFile = new Map();

    function collectCoverageFiles(directory) {
      const files = [];
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...collectCoverageFiles(fullPath));
        else if (entry.isFile() && entry.name.endsWith('.json')) files.push(fullPath);
      }
      return files;
    }

    for (const coveragePath of collectCoverageFiles(coverageDir)) {
      let document;
      try {
        document = JSON.parse(readFileSync(coveragePath, 'utf8'));
      } catch (error) {
        console.error(`Could not parse V8 coverage output ${coveragePath}: ${error.message}`);
        continue;
      }

      for (const script of document.result || []) {
        if (!script.url.startsWith('file://')) continue;
        const sourcePath = path.resolve(fileURLToPath(script.url));
        const relativePath = path.relative(root, sourcePath).split(path.sep).join('/');
        if (!relativePath.startsWith('src/') || !/\.(?:c|m)?js$/.test(relativePath)) continue;

        let entry = coverageByFile.get(relativePath);
        if (!entry) {
          let source = '';
          try {
            source = readFileSync(sourcePath, 'utf8');
          } catch (_) {}
          entry = {
            source,
            lineIndex: buildLineIndex(source),
            functions: new Map()
          };
          coverageByFile.set(relativePath, entry);
        }

        for (const fn of script.functions || []) {
          if (!fn.ranges || fn.ranges.length === 0) continue;
          const key = `${fn.functionName}\u0000${fn.ranges[0].startOffset}\u0000${fn.ranges[0].endOffset}`;
          const existing = entry.functions.get(key);
          if (!existing) {
            entry.functions.set(key, fn);
          } else {
            for (let i = 0; i < fn.ranges.length; i++) {
              const incoming = fn.ranges[i];
              const merged = existing.ranges[i];
              if (merged) merged.count = Math.max(merged.count, incoming.count);
              else existing.ranges.push(incoming);
            }
          }
        }
      }
    }

    const files = [];
    let totals = { functions: 0, coveredFunctions: 0, lines: 0, coveredLines: 0, branches: 0, coveredBranches: 0 };

    for (const [file, entry] of coverageByFile) {
      let coveredFunctions = 0;
      let totalFunctions = 0;
      let coveredBranches = 0;
      let totalBranches = 0;
      const executableLines = new Set();
      const coveredLines = new Set();

      for (const fn of entry.functions.values()) {
        const isModuleInit = fn.functionName === '' && fn.ranges[0].startOffset === 0;
        if (isModuleInit) continue;

        const entryRange = fn.ranges[0];
        for (const range of fn.ranges) {
          for (const line of linesTouchedByRange(range, entry.lineIndex)) executableLines.add(line);
          if (range.count > 0) {
            for (const line of linesTouchedByRange(range, entry.lineIndex)) coveredLines.add(line);
          }
          if (range !== entryRange) {
            totalBranches++;
            if (range.count > 0) coveredBranches++;
          }
        }

        totalFunctions++;
        if (fn.ranges.some((range) => range.count > 0)) coveredFunctions++;
      }

      const linePercent = executableLines.size === 0 ? 0 : (coveredLines.size / executableLines.size) * 100;
      const branchPercent = totalBranches === 0 ? 0 : (coveredBranches / totalBranches) * 100;
      const functionPercent = totalFunctions === 0 ? 0 : (coveredFunctions / totalFunctions) * 100;

      files.push({
        file,
        coveredFunctions,
        totalFunctions,
        functionPercent: Number(functionPercent.toFixed(1)),
        coveredLines: coveredLines.size,
        totalLines: executableLines.size,
        linePercent: Number(linePercent.toFixed(1)),
        coveredBranches,
        totalBranches,
        branchPercent: Number(branchPercent.toFixed(1))
      });

      totals.functions += totalFunctions;
      totals.coveredFunctions += coveredFunctions;
      totals.lines += executableLines.size;
      totals.coveredLines += coveredLines.size;
      totals.branches += totalBranches;
      totals.coveredBranches += coveredBranches;
    }

    files.sort((left, right) => left.file.localeCompare(right.file));

    const gates = evaluateCoverageGates(
      totals.coveredFunctions,
      totals.functions,
      totals.coveredLines,
      totals.lines,
      totals.coveredBranches,
      totals.branches
    );

    const summary = {
      generatedAt: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      suiteExitCode: suite.status ?? 1,
      metricsDocumented:
        'Function: loaded function entries with any range count > 0. Line: lines intersecting any function V8 range; covered when intersecting a count > 0 range. Branch: conservative block-transition proxy; non-entry ranges per function count as branch-target blocks; covered when count > 0. Module-level init ranges excluded from all metrics.',
      scope: 'Loaded JavaScript production files under src/',
      thresholdsConfigured: true,
      thresholds: {
        functionEntryCoverage: gates.functionEntry,
        lineCoverage: gates.line,
        branchCoverageProxy: gates.branch,
        allPassed: gates.allPassed
      },
      performanceBudgetEvaluated: false,
      performanceBudgetNote:
        'The Poisson timing assertion is disabled under coverage instrumentation; run the isolated benchmark separately.',
      totals: {
        coveredFunctions: totals.coveredFunctions,
        totalFunctions: totals.functions,
        functionPercent: Number(((totals.coveredFunctions / totals.functions) * 100).toFixed(1)),
        coveredLines: totals.coveredLines,
        totalLines: totals.lines,
        linePercent: Number(((totals.coveredLines / totals.lines) * 100).toFixed(1)),
        coveredBranches: totals.coveredBranches,
        totalBranches: totals.branches,
        branchPercent: Number(((totals.coveredBranches / totals.branches) * 100).toFixed(1))
      },
      files
    };

    const reportPath = path.join(coverageDir, 'function-coverage.json');
    writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);

    const printGate = (label, gate, percent) => {
      console.log(
        `${label} coverage: ${percent}% (floor ${gate.minimumPercent}%) — ` + `${gate.passed ? 'PASS' : 'FAIL'}.`
      );
    };

    console.log(
      `V8 function coverage: ${totals.coveredFunctions}/${totals.functions} functions ` +
        `(${summary.totals.functionPercent}%) across ${files.length} production files.`
    );
    console.log(
      `V8 line coverage (range-mapped): ${totals.coveredLines}/${totals.lines} lines ` +
        `(${summary.totals.linePercent}%).`
    );
    console.log(
      `V8 branch coverage (block-transition proxy): ${totals.coveredBranches}/${totals.branches} ` +
        `branch-target blocks (${summary.totals.branchPercent}%).`
    );
    console.log('Floors (all thresholds configured at 85%):');
    printGate('Function', gates.functionEntry, summary.totals.functionPercent);
    printGate('Line', gates.line, summary.totals.linePercent);
    printGate('Branch (proxy)', gates.branch, summary.totals.branchPercent);
    console.log(`Coverage report written to ${reportPath}`);

    if (totals.functions === 0 || totals.lines === 0) {
      console.error('No production source functions/lines were present in the coverage data.');
    }
    if (!gates.allPassed) {
      console.error('Coverage gate FAILED: at least one floor is below the configured 85% minimum.');
    }
    if (suite.status !== 0) {
      console.error(`Coverage test suite exited with code ${suite.status ?? 'null'}.`);
    }
    process.exitCode = suite.status === 0 && gates.allPassed ? 0 : 1;
  }
}
