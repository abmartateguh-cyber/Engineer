'use strict';

const assert = require('assert');
const { LocalCluster, JOB_STATES } = require('../src/core/hpc/local_scheduler');
const { HPCEngineAdapter } = require('../src/core/hpc/hpc_engine_adapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');

(async () => {
  let passed = 0;
  let failed = 0;
  const check = (cond, message) => {
    if (cond) {
      passed++;
      console.log(`  ✓ ${message}`);
    } else {
      failed++;
      console.error(`  ✗ FAIL: ${message}`);
    }
  };
  const finiteSeries = (arr) => arr.every((v) => Number.isFinite(v));

  console.log('================================================================');
  console.log('   TESTING LOCAL MULTI-PROCESS HPC SCHEDULER (real execution)  ');
  console.log('================================================================\n');

  const cluster = new LocalCluster({ maxWorkers: 4, jobTimeoutMs: 60000 });

  // ------------------------------------------------------------------
  // 1. Five distinct real Poisson solves (N=64/96/128/192/256)
  // ------------------------------------------------------------------
  console.log('[1] Submitting 5 distinct sparse Poisson solve jobs...');
  const sizes = [64, 96, 128, 192, 256];
  const submissions = sizes.map((n) =>
    cluster.submit({ taskType: 'poisson_sparse_cholesky', n }, { timeoutMs: 120000 })
  );
  check(submissions.length === 5, '5 jobs submitted');
  check(
    submissions.every((s) => s.submitted === true && s.status === JOB_STATES.QUEUED),
    'all submissions enter QUEUED state'
  );

  const terminalJobs = await Promise.all(submissions.map((s) => cluster.waitFor(s.jobId)));

  for (let i = 0; i < terminalJobs.length; i++) {
    const job = terminalJobs[i];
    const n = sizes[i];
    const prefix = `N=${n} (${job.jobId})`;
    check(job.status === JOB_STATES.COMPLETED, `${prefix}: job completed`);
    check(
      job.result !== null && job.result.taskType === 'poisson_sparse_cholesky',
      `${prefix}: real numeric result returned`
    );
    check(Number.isInteger(job.result.n) && job.result.n === n, `${prefix}: system dimension preserved`);
    check(finiteSeries(job.result.solution), `${prefix}: solution vector all finite`);
    check(
      Number.isFinite(job.result.relativeResidual) && job.result.relativeResidual < 1e-8,
      `${prefix}: residual ${job.result.relativeResidual.toExponential(3)} < 1e-8`
    );
    check(
      Number.isInteger(job.result.iterations) && job.result.iterations > 0,
      `${prefix}: solver performed ${job.result.iterations} iterations`
    );
    check(Boolean(job.result.converged), `${prefix}: solver reports convergence`);
    check(
      Number.isFinite(job.result.elapsedMs) && job.result.elapsedMs > 0,
      `${prefix}: worker timing captured (${job.result.elapsedMs.toFixed(1)}ms)`
    );
    check(
      typeof job.result.checksum === 'string' && job.result.checksum.length === 64,
      `${prefix}: result checksum present`
    );
    check(
      job.transitions.map((t) => t.to).join(',') === 'QUEUED,RUNNING,COMPLETED',
      `${prefix}: transitions QUEUED->RUNNING->COMPLETED observed`
    );
  }

  const telemetry = cluster.getTelemetry();
  check(telemetry.jobs.byState.COMPLETED === 5, 'telemetry reports 5 completed jobs');
  check(
    telemetry.spawnedWorkers >= 1 && telemetry.spawnedWorkers <= 4,
    `telemetry shows spawned workers (${telemetry.spawnedWorkers})`
  );

  // ------------------------------------------------------------------
  // 2. Failure path: malformed task descriptor
  // ------------------------------------------------------------------
  console.log('\n[2] Malformed task descriptor -> FAILED state...');
  const malformedA = cluster.submit({ taskType: 'poisson_sparse_cholesky', n: -3 }, { timeoutMs: 10000 });
  const failedA = await cluster.waitFor(malformedA.jobId);
  check(failedA.status === JOB_STATES.FAILED, 'malformed n=-3 job lands in FAILED');
  check(
    Boolean(failedA.error && failedA.error.message) && /positive integer/.test(failedA.error.message),
    `failure carries descriptive error: "${failedA.error && failedA.error.message}"`
  );

  const malformedB = cluster.submit({ taskType: 'no_such_task' }, { timeoutMs: 10000 });
  const failedB = await cluster.waitFor(malformedB.jobId);
  check(failedB.status === JOB_STATES.FAILED, 'unknown task type job lands in FAILED');
  check(/Unknown task type/.test(failedB.error.message), `unknown task type error: "${failedB.error.message}"`);

  // ------------------------------------------------------------------
  // 3. Timeout path: task exceeds a small timeout
  // ------------------------------------------------------------------
  console.log('\n[3] Timeout path -> clean FAILED with TIMED_OUT...');
  const tOver = Date.now();
  const spinOver = cluster.submit({ taskType: 'spin_wait', spinMs: 30000 }, { timeoutMs: 200 });
  const timedOut = await cluster.waitFor(spinOver.jobId);
  const timeoutWallMs = Date.now() - tOver;
  check(timedOut.status === JOB_STATES.FAILED, 'over-time job lands in FAILED');
  check(
    timedOut.error && timedOut.error.code === 'TIMED_OUT',
    `timeout error code is TIMED_OUT (got ${timedOut.error && timedOut.error.code})`
  );
  check(timeoutWallMs < 10000, `timeout enforced quickly (${timeoutWallMs}ms wall)`);

  // ------------------------------------------------------------------
  // 4. Cancellation path
  // ------------------------------------------------------------------
  console.log('\n[4] Cancellation path -> clean FAILED with CANCELLED...');
  const spinCancel = cluster.submit({ taskType: 'spin_wait', spinMs: 60000 }, { timeoutMs: 60000 });
  setTimeout(() => cluster.cancel(spinCancel.jobId), 60);
  const cancelled = await cluster.waitFor(spinCancel.jobId);
  check(cancelled.status === JOB_STATES.FAILED, 'cancelled job lands in FAILED');
  check(
    cancelled.error && cancelled.error.code === 'CANCELLED',
    `cancelled error code is CANCELLED (got ${cancelled.error && cancelled.error.code})`
  );

  // ------------------------------------------------------------------
  // 5. Adapter integration: hpc:local-dispatch route
  // ------------------------------------------------------------------
  console.log('\n[5] HPCEngineAdapter route hpc:local-dispatch...');
  const adapter = new HPCEngineAdapter();
  const caps = adapter.describeCapabilities();
  check(caps.supportedOperations.includes('hpc:local-dispatch'), 'adapter advertises hpc:local-dispatch');

  const dispatchReq = new JobRequest({
    domain: 'hpc',
    operation: 'hpc:local-dispatch',
    parameters: {
      descriptor: { taskType: 'poisson_sparse_cholesky', n: 48 },
      timeoutMs: 30000
    }
  });
  const dispatchRes = await adapter.execute(dispatchReq);
  check(dispatchRes.status === JobStatus.SUCCEEDED, 'adapter dispatch returns SUCCEEDED');
  check(dispatchRes.outputData.executionPerformed === true, 'adapter reports executionPerformed=true');
  check(dispatchRes.outputData.status === JOB_STATES.COMPLETED, 'adapter returns COMPLETED status');
  check(
    dispatchRes.outputData.result.relativeResidual < 1e-8,
    `adapter result residual ${dispatchRes.outputData.result.relativeResidual.toExponential(3)} < 1e-8`
  );

  const slurmReq = new JobRequest({
    domain: 'hpc',
    operation: 'generate_slurm_script',
    parameters: { jobName: 'vv_poisson', nodes: 2, ntasksPerNode: 8, walltime: '00:30:00' }
  });
  const slurmRes = await adapter.execute(slurmReq);
  check(slurmRes.outputData.submitted === false, 'Slurm template route returns submitted=false');
  check(slurmRes.outputData.executionPerformed === false, 'Slurm template route returns executionPerformed=false');
  check(
    typeof slurmRes.outputData.label === 'string' && slurmRes.outputData.label.length > 0,
    'Slurm template route has clear label'
  );

  cluster.shutdown();
  console.log(`\n========================================`);
  console.log(`  PASSED: ${passed}    FAILED: ${failed}`);
  console.log(`========================================`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('TEST CRASH:', err);
  process.exit(1);
});
