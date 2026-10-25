#!/usr/bin/env node

/**
 * Run the root smoke suite and verify it does not change tracked or untracked
 * non-ignored files in the worktree. Existing user changes are allowed; their
 * file contents must remain identical before and after the suite.
 */

'use strict';

const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEST_TIMEOUT_MS = 3 * 60 * 1000;
const TEST_TERMINATION_GRACE_MS = 5000;
const MIN_NODE_VERSION = [22, 12];

function hasSupportedNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > MIN_NODE_VERSION[0] || (major === MIN_NODE_VERSION[0] && minor >= MIN_NODE_VERSION[1]);
}

function snapshotWorktree() {
  const listing = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const filePaths = listing.toString('utf8').split('\0').filter(Boolean);
  const snapshot = new Map();

  for (const relativePath of filePaths) {
    const absolutePath = path.join(ROOT, relativePath);
    let stat;
    try {
      stat = fs.lstatSync(absolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        snapshot.set(relativePath, 'missing');
        continue;
      }
      throw error;
    }

    const mode = stat.mode & 0o7777;
    if (stat.isSymbolicLink()) {
      snapshot.set(relativePath, `symlink:${mode}:${fs.readlinkSync(absolutePath)}`);
    } else if (stat.isFile()) {
      const digest = crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
      snapshot.set(relativePath, `file:${mode}:${digest}`);
    } else {
      snapshot.set(relativePath, `other:${mode}:${stat.size}`);
    }
  }

  return snapshot;
}

function compareSnapshots(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((relativePath) => before.get(relativePath) !== after.get(relativePath)).sort();
}

function watchChildProcess(child, options = {}) {
  const timeoutMs = options.timeoutMs ?? TEST_TIMEOUT_MS;
  const terminationGraceMs = options.terminationGraceMs ?? TEST_TERMINATION_GRACE_MS;
  const onTimeout = options.onTimeout ?? (() => {});
  const onForceKill = options.onForceKill ?? (() => {});
  let timedOut = false;
  let killTimer;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    onTimeout();
    child.kill('SIGTERM');
    killTimer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      onForceKill();
      child.kill('SIGKILL');
    }, terminationGraceMs);
  }, timeoutMs);

  return {
    get timedOut() {
      return timedOut;
    },
    clear() {
      clearTimeout(timeoutId);
      clearTimeout(killTimer);
    }
  };
}

function run() {
  if (!hasSupportedNodeVersion()) {
    console.error(`[test guard] Node.js >=${MIN_NODE_VERSION.join('.')} is required; found ${process.versions.node}.`);
    process.exitCode = 1;
    return;
  }

  let before;
  try {
    before = snapshotWorktree();
  } catch (error) {
    console.error(`[test guard] Could not snapshot the worktree: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const testProcess = spawn(process.execPath, ['test/run_all_tests.js'], {
    cwd: ROOT,
    stdio: 'inherit'
  });

  let failedToStart = false;
  const watchdog = watchChildProcess(testProcess, {
    timeoutMs: TEST_TIMEOUT_MS,
    terminationGraceMs: TEST_TERMINATION_GRACE_MS,
    onTimeout: () => console.error(`[test guard] Root suite exceeded ${TEST_TIMEOUT_MS} ms; terminating it.`),
    onForceKill: () =>
      console.error(`[test guard] Root suite did not stop after ${TEST_TERMINATION_GRACE_MS} ms; sending SIGKILL.`)
  });

  testProcess.on('error', (error) => {
    failedToStart = true;
    watchdog.clear();
    console.error(`[test guard] Could not start the root suite: ${error.message}`);
    process.exitCode = 1;
  });

  testProcess.on('close', (code) => {
    watchdog.clear();
    if (failedToStart) return;

    let after;
    try {
      after = snapshotWorktree();
    } catch (error) {
      console.error(`[test guard] Could not verify the worktree after the suite: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    const changedPaths = compareSnapshots(before, after);
    if (changedPaths.length > 0) {
      console.error(`[test guard] The root suite changed ${changedPaths.length} worktree path(s):`);
      for (const changedPath of changedPaths.slice(0, 50)) {
        console.error(`  ${changedPath}`);
      }
      if (changedPaths.length > 50) {
        console.error(`  …and ${changedPaths.length - 50} more`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(`[test guard] Worktree unchanged across ${before.size} tracked and untracked paths.`);
    process.exitCode = watchdog.timedOut ? 1 : (code ?? 1);
  });
}

if (require.main === module) run();

module.exports = { watchChildProcess };
