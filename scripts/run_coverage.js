'use strict';

const { spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { evaluateFunctionCoverageGate } = require('./coverage_threshold');

const TEST_TIMEOUT_MS = 3 * 60 * 1000;
const outputIndex = process.argv.indexOf('--output-dir');
const outputDirArgument = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;

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
    const functionsByFile = new Map();

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

        let functions = functionsByFile.get(relativePath);
        if (!functions) {
          functions = new Map();
          functionsByFile.set(relativePath, functions);
        }

        for (const fn of script.functions || []) {
          const range = fn.ranges && fn.ranges[0];
          if (!range || (fn.functionName === '' && range.startOffset === 0)) continue;
          const key = `${fn.functionName}\u0000${range.startOffset}\u0000${range.endOffset}`;
          const previousCount = functions.get(key) || 0;
          functions.set(key, Math.max(previousCount, range.count));
        }
      }
    }

    const files = [...functionsByFile.entries()]
      .map(([file, functions]) => {
        const totalFunctions = functions.size;
        const coveredFunctions = [...functions.values()].filter((count) => count > 0).length;
        return {
          file,
          coveredFunctions,
          totalFunctions,
          percent: totalFunctions === 0 ? 0 : Number(((coveredFunctions / totalFunctions) * 100).toFixed(1))
        };
      })
      .sort((left, right) => left.file.localeCompare(right.file));
    const coveredFunctions = files.reduce((sum, file) => sum + file.coveredFunctions, 0);
    const totalFunctions = files.reduce((sum, file) => sum + file.totalFunctions, 0);
    const coverageGate = evaluateFunctionCoverageGate(coveredFunctions, totalFunctions);
    const summary = {
      generatedAt: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      suiteExitCode: suite.status ?? 1,
      metric: 'V8 function-entry coverage; module initialization is excluded',
      scope: 'Loaded JavaScript production files under src/',
      thresholdsConfigured: true,
      thresholds: {
        functionEntryCoverage: coverageGate
      },
      performanceBudgetEvaluated: false,
      performanceBudgetNote:
        'The Poisson timing assertion is disabled under coverage instrumentation; run the isolated benchmark separately.',
      coveredFunctions,
      totalFunctions,
      percent: totalFunctions === 0 ? 0 : Number(((coveredFunctions / totalFunctions) * 100).toFixed(1)),
      files
    };
    const reportPath = path.join(coverageDir, 'function-coverage.json');
    writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(
      `V8 function coverage: ${coveredFunctions}/${totalFunctions} functions ` +
        `(${summary.percent}%) across ${files.length} production files.`
    );
    console.log(
      `Loaded-source function coverage floor: ${coverageGate.minimumPercent}% ` +
        `(${coverageGate.passed ? 'PASS' : 'FAIL'}).`
    );
    console.log(`Coverage report written to ${reportPath}`);
    if (totalFunctions === 0) {
      console.error('No production source functions were present in the coverage data.');
    }
    if (!coverageGate.passed) {
      console.error(
        `Function coverage ${coverageGate.actualPercent}% is below the configured ${coverageGate.minimumPercent}% floor.`
      );
    }
    process.exitCode = suite.status === 0 && coverageGate.passed ? 0 : 1;
  }
}
