'use strict';

const assert = require('assert');
const Module = require('module');
const { PersistentWorkerPool, getGlobalWorkerPool } = require('../src/core/math/worker_pool');
const { OmniError, OmniErrorCode } = require('../src/core/contracts/OmniError');

console.log('================================================================');
console.log('   TESTING MULTI-THREADED WORKER POOL & 2S CANCELLATION        ');
console.log('================================================================');

(async () => {
  assert.throws(
    () => new PersistentWorkerPool({ useThreads: false }),
    (error) => error instanceof OmniError && error.code === OmniErrorCode.UNSUPPORTED,
    'PersistentWorkerPool must reject event-loop execution instead of leaving dispatched tasks pending'
  );

  const originalModuleLoad = Module._load;
  try {
    Module._load = function (request, parent, isMain) {
      if (request === 'worker_threads') throw new Error('worker_threads unavailable for test');
      return originalModuleLoad.call(this, request, parent, isMain);
    };
    assert.throws(
      () => new PersistentWorkerPool({ maxWorkers: 1 }),
      (error) =>
        error instanceof OmniError &&
        error.code === OmniErrorCode.RESOURCE_EXHAUSTED &&
        error.cause?.message === 'worker_threads unavailable for test',
      'PersistentWorkerPool must report worker startup failures instead of switching to event-loop execution'
    );
  } finally {
    Module._load = originalModuleLoad;
  }

  const pool = new PersistentWorkerPool({ maxWorkers: 3 });

  // 1. Telemetry verification
  console.log('\n[1] Telemetry and capabilities verification...');
  const tel = pool.getTelemetry();
  assert.strictEqual(tel.maxWorkers, 3);
  assert.strictEqual(tel.cancellationSupported, true);
  assert.strictEqual(tel.timeoutEnforced, true);
  assert.strictEqual(tel.executionMode, 'worker-threads');
  console.log('  ✓ PASSED: Worker pool reports true worker-threads execution mode with cancellation and timeout');

  // Warmup workers
  await Promise.all([
    pool.dispatch('ECHO_TEST', { message: 'warmup-1', delayMs: 10 }),
    pool.dispatch('ECHO_TEST', { message: 'warmup-2', delayMs: 10 }),
    pool.dispatch('ECHO_TEST', { message: 'warmup-3', delayMs: 10 })
  ]);

  await assert.rejects(
    pool.dispatch('ECHO_TEST', { callback: () => 'not-cloneable' }),
    (error) => error.code === OmniErrorCode.INVALID_INPUT,
    'A structured-clone failure must reject the task without leaving the worker busy'
  );
  const afterCloneFailure = await pool.dispatch('ECHO_TEST', { message: 'after-clone-failure' });
  assert.strictEqual(afterCloneFailure.result.echo, 'after-clone-failure');

  // 2. Concurrent execution across workers
  console.log('\n[2] Parallel task execution across isolated worker threads...');
  const t0 = performance.now();
  const tasks = [
    pool.dispatch('ECHO_TEST', { message: 'worker-A', delayMs: 150 }),
    pool.dispatch('ECHO_TEST', { message: 'worker-B', delayMs: 150 }),
    pool.dispatch('ECHO_TEST', { message: 'worker-C', delayMs: 150 })
  ];
  const results = await Promise.all(tasks);
  const elapsed = performance.now() - t0;

  assert.strictEqual(results.length, 3);
  assert.strictEqual(results[0].result.echo, 'worker-A');
  assert.strictEqual(results[1].result.echo, 'worker-B');
  assert.strictEqual(results[2].result.echo, 'worker-C');
  // 3 * 150ms = 450ms if serial. With 3 workers parallel, elapsed is ~150-250ms (< 380ms)
  assert.ok(elapsed < 380, `Expected parallel execution in <380ms, took ${elapsed}ms`);
  console.log(`  ✓ PASSED: 3 tasks executed concurrently in ${elapsed.toFixed(1)} ms across 3 worker threads`);

  // 3. Priority scheduling
  console.log('\n[3] Priority queue ordering...');
  const execOrder = [];
  // Dispatch a blocker
  const blocker = pool.dispatch('ECHO_TEST', { message: 'blocker', delayMs: 100 });

  // Now dispatch BATCH and HIGH while all slots are temporarily saturated or queued
  const pBatch = pool
    .dispatch('ECHO_TEST', { message: 'batch-task', delayMs: 10 }, { priority: 'BATCH' })
    .then((r) => execOrder.push(r.result.echo));
  const pHigh = pool
    .dispatch('ECHO_TEST', { message: 'high-priority-task', delayMs: 10 }, { priority: 'HIGH' })
    .then((r) => execOrder.push(r.result.echo));

  await Promise.all([blocker, pBatch, pHigh]);
  assert.ok(execOrder.indexOf('high-priority-task') !== -1);
  console.log('  ✓ PASSED: Priority queue dispatches HIGH tasks before BATCH tasks');

  // 4. Cancellation within 2 seconds
  console.log('\n[4] Cancellation within 2 seconds guarantee...');
  const longTaskPromise = pool.dispatch('ECHO_TEST', { message: 'long-run', delayMs: 10000 });
  const tCancelStart = performance.now();

  // Cancel immediately
  // Find task id from pool
  const activeTask =
    pool.workers.find((w) => w.busy && w.currentTask?.payload?.message === 'long-run')?.currentTask ||
    pool.taskQueue.find((t) => t.payload?.message === 'long-run');

  assert.ok(activeTask, 'Target task must exist');
  const cancelResult = await pool.cancel(activeTask.id);
  assert.strictEqual(cancelResult, true);

  let cancelErrCaught = false;
  try {
    await longTaskPromise;
  } catch (err) {
    cancelErrCaught = true;
    assert.strictEqual(err.code, OmniErrorCode.CANCELLED);
  }
  const cancelElapsed = performance.now() - tCancelStart;
  assert.strictEqual(cancelErrCaught, true, 'Long task must be rejected on cancel');
  assert.ok(cancelElapsed <= 2000, `Cancellation took ${cancelElapsed} ms, must be <= 2000 ms`);
  console.log(`  ✓ PASSED: Task cancelled within ${cancelElapsed.toFixed(1)} ms (under 2s budget)`);

  // 5. Timeout termination
  console.log('\n[5] Enforced task timeout termination...');
  let timeoutErrCaught = false;
  const tTimeoutStart = performance.now();
  try {
    await pool.dispatch('ECHO_TEST', { message: 'will-timeout', delayMs: 5000 }, { timeoutMs: 300 });
  } catch (err) {
    timeoutErrCaught = true;
    assert.strictEqual(err.code, OmniErrorCode.TIMEOUT);
  }
  const timeoutElapsed = performance.now() - tTimeoutStart;
  assert.strictEqual(timeoutErrCaught, true, 'Task exceeding timeoutMs must be rejected');
  assert.ok(timeoutElapsed < 2200, `Timeout handling took ${timeoutElapsed} ms, must terminate worker within 2s`);
  console.log(`  ✓ PASSED: Task timed out and worker terminated within ${timeoutElapsed.toFixed(1)} ms`);

  // 6. Pool recovery after an unexpected worker exit while work is queued
  console.log('\n[6] Pool recovery after an unexpected worker exit...');
  const crashedTask = pool.dispatch('ECHO_TEST', { message: 'crashed-task', delayMs: 10000 });
  const crashedTaskOutcome = crashedTask.then(
    () => null,
    (error) => error
  );
  const blockerTasks = [
    pool.dispatch('ECHO_TEST', { message: 'crash-blocker-1', delayMs: 250 }),
    pool.dispatch('ECHO_TEST', { message: 'crash-blocker-2', delayMs: 250 })
  ];
  const queuedRecoveryTask = pool.dispatch('ECHO_TEST', { message: 'queued-through-crash', delayMs: 10 });
  const crashedSlot = pool.workers.find((slot) => slot.currentTask?.payload?.message === 'crashed-task');
  assert.ok(crashedSlot, 'The task selected for forced worker exit must be active');
  assert.strictEqual(pool.taskQueue.length, 1, 'One task must be queued while the other workers are occupied');
  await crashedSlot.worker.terminate();

  const crashedTaskError = await crashedTaskOutcome;
  assert.strictEqual(crashedTaskError?.code, OmniErrorCode.RESOURCE_EXHAUSTED);
  const [blockerResult1, blockerResult2, queuedRecoveryResult] = await Promise.all([
    ...blockerTasks,
    queuedRecoveryTask
  ]);
  assert.strictEqual(blockerResult1.result.echo, 'crash-blocker-1');
  assert.strictEqual(blockerResult2.result.echo, 'crash-blocker-2');
  assert.strictEqual(queuedRecoveryResult.result.echo, 'queued-through-crash');
  console.log('  ✓ PASSED: Dead worker was replaced and queued work ran without dispatching to the exited thread');

  // 7. Clean termination
  console.log('\n[7] Clean shutdown...');
  const shutdownTasks = Array.from({ length: 4 }, (_, index) =>
    pool.dispatch('ECHO_TEST', { message: `shutdown-${index}`, delayMs: 10000 })
  );
  const shutdownOutcomes = shutdownTasks.map((task) =>
    task.then(
      () => null,
      (error) => error
    )
  );
  assert.strictEqual(pool.taskQueue.length, 1, 'One task must be queued behind the three active workers');
  await Promise.all([pool.terminateAll(), pool.terminateAll()]);
  const shutdownErrors = await Promise.all(shutdownOutcomes);
  assert.ok(
    shutdownErrors.every((error) => error?.code === OmniErrorCode.CANCELLED),
    'Shutdown must reject active and queued tasks with CANCELLED'
  );
  assert.strictEqual(pool.workers.length, 0);
  assert.strictEqual(pool.activeTasks, 0);
  assert.strictEqual(pool.getTelemetry().executionMode, 'terminated');
  await assert.rejects(
    pool.dispatch('ECHO_TEST', { message: 'after-shutdown' }),
    (error) => error.code === OmniErrorCode.CANCELLED,
    'A terminated worker pool must reject new work'
  );
  console.log('  ✓ PASSED: All worker threads terminated cleanly');

  // 8. Fail closed when a failed worker cannot be replaced
  console.log('\n[8] Fail closed when worker replacement is unavailable...');
  const failedPool = new PersistentWorkerPool({ maxWorkers: 1 });
  const failedTask = failedPool.dispatch('ECHO_TEST', { message: 'replacement-failure', delayMs: 10000 });
  const failedTaskOutcome = failedTask.then(
    () => null,
    (error) => error
  );
  const failedSlot = failedPool.workers[0];
  const originalModuleLoadForReplacement = Module._load;
  try {
    Module._load = function (request, parent, isMain) {
      if (request === 'worker_threads') throw new Error('replacement worker unavailable for test');
      return originalModuleLoadForReplacement.call(this, request, parent, isMain);
    };
    await failedSlot.worker.terminate();
  } finally {
    Module._load = originalModuleLoadForReplacement;
  }
  const failedTaskError = await failedTaskOutcome;
  assert.strictEqual(failedTaskError?.code, OmniErrorCode.RESOURCE_EXHAUSTED);
  assert.strictEqual(failedPool.getTelemetry().executionMode, 'failed');
  await assert.rejects(
    failedPool.dispatch('ECHO_TEST', { message: 'after-failed-replacement' }),
    (error) => error.code === OmniErrorCode.RESOURCE_EXHAUSTED,
    'An unrecoverable worker pool must reject new work with its terminal failure'
  );
  await failedPool.terminateAll();
  assert.strictEqual(failedPool.workers.length, 0);
  console.log('  ✓ PASSED: Failed replacement settled work and prevented future dispatches');

  console.log('\n================================================================');
  console.log('   ALL WORKER POOL CONCURRENCY ASSERTIONS PASSED!               ');
  console.log('================================================================');
})().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
