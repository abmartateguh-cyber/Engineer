'use strict';

/**
 * Verification gate for the PersistentWorkerPool supervisor (watchdog / auto-healing).
 *
 * Covers:
 *  - normal batch execution correctness (50 tasks)
 *  - worker-kill recovery: bounded detection, replacement spawn, re-queue of the
 *    in-flight task, full completion with zero lost work
 *  - promise integrity: every submitted promise settles; zero unhandled rejections
 *  - memory-bounded: pool size returns to the configured maximum after a kill storm
 *  - fail-closed: a poisoned task rejects without taking down the main process
 *  - determinism: identical batches produce identical results
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PersistentWorkerPool } = require('../src/core/math/worker_pool');

const BATCH_SIZE = 50;

const unhandledRejections = [];
process.on('unhandledRejection', (reason) => {
  unhandledRejections.push(reason);
});

function expectedEcho(index) {
  return `sq${(index * index * 7) % 1000}`;
}

function dispatchBatch(pool, count = BATCH_SIZE, delayMs = 10) {
  return Array.from({ length: count }, (_, i) => pool.dispatch('ECHO_TEST', { message: expectedEcho(i), delayMs }));
}

async function waitFor(predicate, timeoutMs, intervalMs = 2) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

function assertPoolQuiescent(pool) {
  assert.strictEqual(pool.workers.length, pool.maxWorkers, 'pool must retain exactly maxWorkers slots');
  for (const slot of pool.workers) {
    assert.ok(slot, 'every slot must be occupied after recovery');
    assert.strictEqual(slot.busy, false, 'no worker may remain busy after the storm');
    assert.strictEqual(slot.currentTask, null);
  }
  assert.strictEqual(pool.activeTasks, 0, 'activeTasks must drain to zero');
  assert.strictEqual(pool.taskQueue.length, 0, 'task queue must drain to zero');
}

test('worker pool supervisor: normal batch of 50 tasks completes with correct results', async (t) => {
  const pool = new PersistentWorkerPool({ maxWorkers: 2 });
  t.after(() => pool.terminateAll());

  const promises = dispatchBatch(pool, BATCH_SIZE, 5);
  const settled = await Promise.allSettled(promises);

  assert.strictEqual(settled.length, BATCH_SIZE);
  for (let i = 0; i < settled.length; i++) {
    assert.strictEqual(settled[i].status, 'fulfilled', `task ${i} must fulfill`);
    assert.strictEqual(settled[i].value.result.echo, expectedEcho(i), `task ${i} result must be correct`);
    assert.strictEqual(settled[i].value.success, true);
  }

  assertPoolQuiescent(pool);
  assert.strictEqual(pool.getTelemetry().completedTasksCount, BATCH_SIZE);
});

test('worker pool supervisor: kill mid-batch is detected, worker replaced, in-flight task re-queued, all work completes', async (t) => {
  const pool = new PersistentWorkerPool({ maxWorkers: 2, requeueOnWorkerDeath: true });
  t.after(() => pool.terminateAll());

  const promises = dispatchBatch(pool, BATCH_SIZE, 25);
  const expected = Array.from({ length: BATCH_SIZE }, (_, i) => expectedEcho(i));

  await waitFor(() => pool.workers[0] && pool.workers[0].busy && pool.workers[0].currentTask, 5000);
  const deadWorker = pool.workers[0].worker;
  const killedTaskId = pool.workers[0].currentTask.id;

  const tKill = performance.now();
  const killed = await pool._killWorker(0);
  assert.strictEqual(killed, true, '_killWorker must terminate the target worker');

  await waitFor(() => pool.workers[0] && pool.workers[0].worker !== deadWorker, 5000);
  const detectMs = performance.now() - tKill;
  assert.ok(detectMs < 5000, `worker death must be detected and replaced within 5s (took ${detectMs.toFixed(1)}ms)`);

  const settled = await Promise.allSettled(promises);
  const fullWaitMs = performance.now() - tKill;

  const statuses = settled.map((s) => s.status);
  assert.ok(
    statuses.every((s) => s === 'fulfilled'),
    `every task must settle fulfilled, got: ${statuses.join(',')}`
  );
  const echoes = settled.map((s) => s.value.result.echo);
  assert.deepEqual(echoes, expected, 'all 50 tasks must complete with correct results (no lost work)');

  assert.ok(
    pool.workers[0].id === 0 && pool.workers[0].worker.threadId !== deadWorker.threadId,
    'replacement worker must occupy the same slot with a fresh thread'
  );
  assertPoolQuiescent(pool);
  assert.strictEqual(pool.getTelemetry().completedTasksCount, BATCH_SIZE);

  process.stdout.write(
    `    [measured] kill->detection ${detectMs.toFixed(1)}ms, kill->full batch ${fullWaitMs.toFixed(1)}ms (in-flight task ${killedTaskId} re-queued)\n`
  );
});

test('worker pool supervisor: kill storm keeps pool size bounded at the configured maximum', async (t) => {
  const pool = new PersistentWorkerPool({ maxWorkers: 2, requeueOnWorkerDeath: true });
  t.after(() => pool.terminateAll());

  let promises = dispatchBatch(pool, BATCH_SIZE, 20);
  await waitFor(() => pool.workers[0] && pool.workers[0].busy, 5000);
  await pool._killWorker(0);
  await Promise.allSettled(promises);

  promises = dispatchBatch(pool, BATCH_SIZE, 20);
  await waitFor(() => pool.workers[1] && pool.workers[1].busy, 5000);
  await pool._killWorker(1);
  const settled = await Promise.allSettled(promises);
  assert.ok(
    settled.every((s) => s.status === 'fulfilled'),
    'storm batch must still fully complete'
  );

  assert.strictEqual(pool.workers.length, pool.maxWorkers, 'pool must not accumulate workers');
  for (const slot of pool.workers) {
    assert.ok(slot && slot.worker, 'replacement slot must hold a live worker');
    assert.strictEqual(slot.busy, false);
  }
  assert.strictEqual(pool.workers.filter(Boolean).length, pool.maxWorkers);
  assertPoolQuiescent(pool);
});

test('worker pool supervisor: poisoned task fails closed without crashing the main process', async (t) => {
  const pool = new PersistentWorkerPool({ maxWorkers: 2 });
  t.after(() => pool.terminateAll());

  await assert.rejects(
    pool.dispatch('NO_SUCH_TASK', {}),
    (error) => error.code === 'UNSUPPORTED',
    'poisoned task must reject with UNSUPPORTED'
  );

  const healthy = await pool.dispatch('ECHO_TEST', { message: 'still-alive', delayMs: 5 });
  assert.strictEqual(healthy.result.echo, 'still-alive');
  assert.strictEqual(pool.getTelemetry().executionMode, 'worker-threads');
  assertPoolQuiescent(pool);
});

test('worker pool supervisor: identical batches produce identical results (determinism)', async (t) => {
  const poolA = new PersistentWorkerPool({ maxWorkers: 2 });
  const poolB = new PersistentWorkerPool({ maxWorkers: 2 });
  t.after(() => Promise.all([poolA.terminateAll(), poolB.terminateAll()]));

  const batchA = dispatchBatch(poolA, 30, 4);
  const batchB = dispatchBatch(poolB, 30, 4);

  const [settledA, settledB] = await Promise.all([Promise.allSettled(batchA), Promise.allSettled(batchB)]);

  assert.ok(settledA.every((s) => s.status === 'fulfilled'));
  assert.ok(settledB.every((s) => s.status === 'fulfilled'));

  const echoesA = settledA.map((s) => s.value.result.echo);
  const echoesB = settledB.map((s) => s.value.result.echo);
  assert.deepEqual(echoesA, echoesB, 'identical batches must yield identical result sequences');
});

test('worker pool supervisor: no unhandled rejections across the whole run', () => {
  assert.deepEqual(unhandledRejections, [], 'every submitted promise must be handled');
});
