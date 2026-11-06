'use strict';

const os = require('os');

const { PersistentWorkerPool } = require('../src/core/math/worker_pool');
const { OmniArchiveV2 } = require('../src/core/storage/omni_archive');
const { trainSurrogate, predictSurrogate } = require('../src/core/ai/neural_net');
const { LocalCluster } = require('../src/core/hpc/local_scheduler');

const DEFAULT_CYCLES = 50000;
const DEFAULT_DURATION_MS = 8 * 60 * 60 * 1000;
const QUICK_CYCLES = 200;
const HEARTBEAT_INTERVAL = 1000;
const HEAP_GROWTH_LIMIT_MB = 5;
const RSS_LIMIT_MB = 400;
const SCHEDULER_JOB_TIMEOUT_MS = 15000;
const POOL_JOB_TIMEOUT_MS = 15000;

function parseArgs(argv) {
  const args = { cycles: null, durationMs: null, quick: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quick') {
      args.quick = true;
    } else if (arg === '--cycles') {
      args.cycles = Number(argv[++i]);
    } else if (arg.startsWith('--cycles=')) {
      args.cycles = Number(arg.slice('--cycles='.length));
    } else if (arg === '--durationMs') {
      args.durationMs = Number(argv[++i]);
    } else if (arg.startsWith('--durationMs=')) {
      args.durationMs = Number(arg.slice('--durationMs='.length));
    }
  }
  if (args.quick) {
    args.cycles = Number.isInteger(args.cycles) && args.cycles > 0 ? args.cycles : QUICK_CYCLES;
    args.durationMs = 0;
  } else {
    args.cycles = Number.isInteger(args.cycles) && args.cycles > 0 ? args.cycles : DEFAULT_CYCLES;
    args.durationMs = Number.isFinite(args.durationMs) && args.durationMs >= 0 ? args.durationMs : DEFAULT_DURATION_MS;
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function memorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rssMb: usage.rss / 1024 / 1024,
    heapUsedMb: usage.heapUsed / 1024 / 1024,
    externalMb: usage.external / 1024 / 1024
  };
}

function forceGc() {
  if (typeof globalThis.gc === 'function') globalThis.gc();
}

function buildSparsePoissonSystem(n) {
  const rowPtr = new Int32Array(n + 1);
  const colInd = [];
  const values = [];
  let nnz = 0;
  for (let i = 0; i < n; i++) {
    rowPtr[i] = nnz;
    if (i > 0) {
      colInd.push(i - 1);
      values.push(-1);
      nnz++;
    }
    colInd.push(i);
    values.push(4);
    nnz++;
    if (i < n - 1) {
      colInd.push(i + 1);
      values.push(-1);
      nnz++;
    }
  }
  rowPtr[n] = nnz;
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) b[i] = 1 + (i % 3) * 0.25;
  return {
    n,
    rowPtr,
    colInd: new Int32Array(colInd),
    values: new Float64Array(values),
    diag: new Float64Array(n).map((_, i) => 4),
    b
  };
}

async function poolSpmv(pool, system, x) {
  const y = new Float64Array(system.n);
  const result = await pool.dispatch(
    'WASM_SIMD_BLAS',
    {
      operation: 'spmv',
      rowPtr: system.rowPtr,
      colInd: system.colInd,
      values: system.values,
      x,
      y,
      nRows: system.n
    },
    { priority: 'BATCH', timeoutMs: POOL_JOB_TIMEOUT_MS }
  );
  if (!result || result.success !== true || !result.result || !result.result.y) {
    throw new Error('worker-pool spmv dispatch failed');
  }
  return result.result.y;
}

function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function vectorNorm(a) {
  return Math.sqrt(dotProduct(a, a));
}

async function runWorkerPoolSparseSolve(pool, state, cycle) {
  try {
    const system = buildSparsePoissonSystem(32 + (cycle % 3) * 8);
    const n = system.n;
    const x = new Float64Array(n);
    const r = new Float64Array(system.b);
    const z = new Float64Array(n);
    const p = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      z[i] = r[i] / system.diag[i];
      p[i] = z[i];
    }
    let rz = dotProduct(r, z);
    const bNorm = vectorNorm(system.b);
    const maxIterations = Math.min(n, 40);
    let converged = false;
    for (let iter = 0; iter < maxIterations; iter++) {
      const q = await poolSpmv(pool, system, p);
      const pAp = dotProduct(p, q);
      if (!Number.isFinite(pAp) || pAp <= 0) break;
      const alpha = rz / pAp;
      for (let i = 0; i < n; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * q[i];
      }
      const residualNorm = vectorNorm(r);
      if (residualNorm <= 1e-9 * bNorm) {
        converged = true;
        break;
      }
      for (let i = 0; i < n; i++) z[i] = r[i] / system.diag[i];
      const rzNext = dotProduct(r, z);
      const beta = rzNext / rz;
      rz = rzNext;
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    }
    const ax = await poolSpmv(pool, system, x);
    let residualNorm = 0;
    for (let i = 0; i < n; i++) residualNorm += (ax[i] - system.b[i]) * (ax[i] - system.b[i]);
    residualNorm = Math.sqrt(residualNorm);
    const relativeResidual = residualNorm / bNorm;
    if (!converged && relativeResidual > 1e-4) {
      throw new Error(`sparse solve did not converge: relRes=${relativeResidual.toExponential(2)}`);
    }
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(x[i])) throw new Error('sparse solve produced a non-finite value');
    }
    return { n, iterations: maxIterations, relativeResidual };
  } catch (error) {
    state.failures.poolSolves++;
    return false;
  }
}

function buildNeuralDataset() {
  const count = 12;
  const inputs = [];
  const outputs = [];
  for (let i = 0; i < count; i++) {
    const x = [i % 3, (i * 7) % 5, (i * 11) % 7, i % 2];
    inputs.push(x);
    outputs.push([Math.sin(x[0]) * 0.5, x[1] / 5]);
  }
  return { inputs, outputs };
}

function buildArchiveEntry(cycle) {
  return {
    id: 'omnieng-soak-entry',
    slot: cycle % 64,
    stamp: cycle,
    seed: 42
  };
}

class SoakState {
  constructor() {
    this.failures = { poolSolves: 0, archiveOps: 0, neuralCycles: 0, schedulerJobs: 0, runCycles: 0 };
    this.unhandledRejections = 0;
    this.uncaughtExceptions = 0;
    this.maxRssMb = 0;
    this.baselineHeapMb = null;
    this.baselineRssMb = null;
  }

  totalFailures() {
    return (
      this.failures.poolSolves +
      this.failures.archiveOps +
      this.failures.neuralCycles +
      this.failures.schedulerJobs +
      this.failures.runCycles
    );
  }
}

async function runStorageArchiveRoundtrip(archive, state, cycle) {
  try {
    const entry = buildArchiveEntry(cycle);
    const ref = archive.addBlob(entry, { name: `soak/${entry.slot}`, mimeType: 'application/json' });
    if (!ref || !ref.hash) {
      state.failures.archiveOps++;
      return false;
    }
    const readBack = archive.getBlob(ref.hash, true);
    if (!readBack || readBack.slot !== entry.slot || readBack.stamp !== entry.stamp) {
      state.failures.archiveOps++;
      return false;
    }
    if ((cycle + 1) % HEARTBEAT_INTERVAL === 0) {
      const serialized = archive.saveToBuffer();
      const reloaded = OmniArchiveV2.loadFromBuffer(serialized);
      if (!reloaded || reloaded.blobs.size < 1 || reloaded.manifest.name !== 'OmniEng-Soak') {
        state.failures.archiveOps++;
        return false;
      }
    }
    return true;
  } catch (error) {
    state.failures.archiveOps++;
    return false;
  }
}

function runNeuralTrainPredict(state, cycle) {
  try {
    const dataset = buildNeuralDataset();
    const { model, converged } = trainSurrogate(dataset, {
      hiddenUnits: [8],
      activation: 'tanh',
      loss: 'mse',
      epochs: 25,
      batchSize: 6,
      learningRate: 0.05,
      seed: 7 + (cycle % 17)
    });
    const prediction = predictSurrogate(model, dataset.inputs[0]);
    if (!converged || !Array.isArray(prediction) || prediction.length !== 2) {
      state.failures.neuralCycles++;
      return false;
    }
    for (const value of prediction) {
      if (!Number.isFinite(value)) {
        state.failures.neuralCycles++;
        return false;
      }
    }
    return true;
  } catch (error) {
    state.failures.neuralCycles++;
    return false;
  }
}

async function runSchedulerDispatch(cluster, state, cycle) {
  try {
    const submission = cluster.submit({
      taskType: 'poisson_sparse_cholesky',
      n: 16 + (cycle % 5) * 8,
      rhsMode: 'single-mode',
      tolerance: 1e-8,
      maxIterations: 2000
    });
    const job = await cluster.waitFor(submission.jobId, { timeoutMs: SCHEDULER_JOB_TIMEOUT_MS });
    if (!job || job.status !== 'COMPLETED' || !job.result || job.result.converged !== true) {
      state.failures.schedulerJobs++;
      return false;
    }
    return true;
  } catch (error) {
    state.failures.schedulerJobs++;
    return false;
  }
}

async function runCycle(pool, cluster, archive, state, cycle) {
  const results = await Promise.all([
    runWorkerPoolSparseSolve(pool, state, cycle),
    runStorageArchiveRoundtrip(archive, state, cycle),
    Promise.resolve(runNeuralTrainPredict(state, cycle)),
    runSchedulerDispatch(cluster, state, cycle)
  ]);
  return results.every(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof globalThis.gc !== 'function') {
    console.error('SOAK GATE FAILED: run with node --expose-gc so per-cycle garbage collection is available.');
    process.exitCode = 1;
    return;
  }

  const state = new SoakState();
  process.on('unhandledRejection', () => {
    state.unhandledRejections++;
  });
  process.on('uncaughtException', () => {
    state.uncaughtExceptions++;
  });

  const parallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const pool = new PersistentWorkerPool({
    maxWorkers: Math.min(2, parallelism),
    defaultTimeoutMs: POOL_JOB_TIMEOUT_MS
  });
  const cluster = new LocalCluster({ maxWorkers: Math.min(2, parallelism), jobTimeoutMs: SCHEDULER_JOB_TIMEOUT_MS });
  const archive = new OmniArchiveV2({ projectName: 'OmniEng-Soak' });

  const budgetPerCycleMs = args.durationMs > 0 ? args.durationMs / args.cycles : 0;
  const startedAt = Date.now();

  console.log('========================================================================');
  console.log('   OmniEng Continuous Load Soak Verification (8h / memory-leak gates)');
  console.log(
    `   cycles=${args.cycles} targetDurationMs=${args.durationMs} budgetPerCycleMs=${budgetPerCycleMs.toFixed(2)}`
  );
  console.log('========================================================================\n');

  try {
    for (let cycle = 0; cycle < args.cycles; cycle++) {
      const cycleStartedAt = Date.now();
      const cycleOk = await runCycle(pool, cluster, archive, state, cycle);
      if (!cycleOk) state.failures.runCycles++;

      if (budgetPerCycleMs > 0) {
        const remainingMs = budgetPerCycleMs - (Date.now() - cycleStartedAt);
        if (remainingMs > 0) await sleep(remainingMs);
      }
      forceGc();

      if (cycle === 0) {
        const baseline = memorySnapshot();
        state.baselineHeapMb = baseline.heapUsedMb;
        state.baselineRssMb = baseline.rssMb;
        state.maxRssMb = baseline.rssMb;
        console.log(
          `Baseline (after cycle 0 GC): heapUsed=${baseline.heapUsedMb.toFixed(2)} MB rss=${baseline.rssMb.toFixed(2)} MB`
        );
      }

      if ((cycle + 1) % HEARTBEAT_INTERVAL === 0 || cycle === args.cycles - 1) {
        const heartbeat = memorySnapshot();
        if (heartbeat.rssMb > state.maxRssMb) state.maxRssMb = heartbeat.rssMb;
        const elapsedMin = (Date.now() - startedAt) / 60000;
        console.log(
          `[soak:heartbeat] cycles=${cycle + 1}/${args.cycles} elapsed=${elapsedMin.toFixed(1)}min ` +
            `heapUsed=${heartbeat.heapUsedMb.toFixed(2)} MB rss=${heartbeat.rssMb.toFixed(2)} MB ` +
            `failures=${state.totalFailures()} unhandled=${state.unhandledRejections}`
        );
      }
    }
  } finally {
    await pool.terminateAll();
    cluster.shutdown();
    await sleep(150);
  }

  forceGc();
  const finalMemory = memorySnapshot();
  if (finalMemory.rssMb > state.maxRssMb) state.maxRssMb = finalMemory.rssMb;
  const heapGrowthMb = finalMemory.heapUsedMb - state.baselineHeapMb;
  const elapsedMs = Date.now() - startedAt;

  const gates = {
    heapGrowthMb,
    heapGrowthPass: heapGrowthMb < HEAP_GROWTH_LIMIT_MB,
    finalRssMb: finalMemory.rssMb,
    maxRssMb: state.maxRssMb,
    rssPass: state.maxRssMb < RSS_LIMIT_MB,
    unhandledPass: state.unhandledRejections === 0 && state.uncaughtExceptions === 0,
    failuresPass: state.totalFailures() === 0
  };
  const allPass = gates.heapGrowthPass && gates.rssPass && gates.unhandledPass && gates.failuresPass;

  console.log('\nSOAK SUMMARY');
  console.log(
    `  mode=${args.quick ? 'quick' : 'full'} cycles=${args.cycles} elapsed=${(elapsedMs / 1000).toFixed(1)}s`
  );
  console.log(
    `  heap used: baseline=${state.baselineHeapMb.toFixed(2)} MB final=${finalMemory.heapUsedMb.toFixed(2)} MB growth=${heapGrowthMb.toFixed(2)} MB (limit ${HEAP_GROWTH_LIMIT_MB} MB) ${gates.heapGrowthPass ? 'PASS' : 'FAIL'}`
  );
  console.log(
    `  RSS: peak=${state.maxRssMb.toFixed(2)} MB final=${finalMemory.rssMb.toFixed(2)} MB (limit ${RSS_LIMIT_MB} MB) ${gates.rssPass ? 'PASS' : 'FAIL'}`
  );
  console.log(
    `  unhandled rejections=${state.unhandledRejections} uncaught exceptions=${state.uncaughtExceptions} ${gates.unhandledPass ? 'PASS' : 'FAIL'}`
  );
  console.log(
    `  job failures: pool=${state.failures.poolSolves} archive=${state.failures.archiveOps} neural=${state.failures.neuralCycles} scheduler=${state.failures.schedulerJobs} cycle=${state.failures.runCycles} ${gates.failuresPass ? 'PASS' : 'FAIL'}`
  );

  if (!allPass) {
    console.error('\nSOAK GATE FAILED');
    process.exitCode = 1;
  } else {
    console.log('\nSOAK GATE PASSED');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`SOAK GATE FAILED: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
