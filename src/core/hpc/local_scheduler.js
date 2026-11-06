'use strict';

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { EventEmitter } = require('events');
const { buildPoissonSystem } = require('./poisson_system');

const JOB_STATES = Object.freeze({
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
});

const ALLOWED_TRANSITIONS = Object.freeze({
  QUEUED: Object.freeze({ RUNNING: 'start', FAILED: 'fail' }),
  RUNNING: Object.freeze({ COMPLETED: 'complete', FAILED: 'fail' }),
  COMPLETED: Object.freeze({}),
  FAILED: Object.freeze({})
});

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * A real multi-process job scheduler running on the local host.
 *
 * - `LocalCluster` spawns worker processes via child_process.fork from a
 *   worker module (local_worker.js). Workers persist across jobs.
 * - Jobs are submitted to a FIFO queue and go through the state machine
 *   QUEUED -> RUNNING -> COMPLETED | FAILED with every transition recorded.
 * - Task descriptors are serialized JSON shipped to the worker over IPC; the
 *   worker executes production solver code and returns numeric results plus
 *   timing.
 * - Results are verified in the scheduler before a job is marked completed:
 *   a SHA-256 checksum of the returned payload must match, and the residual
 *   is independently recomputed by the scheduler from the returned solution.
 * - Per-job timeout and cancellation are supported; both kill the worker and
 *   land the job in FAILED with a distinct error code.
 */
class LocalCluster extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.maxWorkers=4] - max concurrent worker processes
   * @param {number} [options.jobTimeoutMs=120000] - default per-job timeout
   * @param {string} [options.workerModule] - worker module path (for tests)
   */
  constructor(options = {}) {
    super();
    const parallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
    this.maxWorkers = Math.max(1, Number(options.maxWorkers) || Math.min(4, parallelism));
    this.jobTimeoutMs = Math.max(200, Number(options.jobTimeoutMs) || 120000);
    this.workerModule = options.workerModule || path.join(__dirname, 'local_worker.js');

    this._jobs = new Map();
    this._queue = [];
    this._running = new Map();
    this._idle = [];
    this._counter = 0;
    this._spawned = 0;
    this._closed = false;
  }

  _nextJobId() {
    return `local_${Date.now().toString(36)}_${++this._counter}`;
  }

  /**
   * Submits a task descriptor to the local queue.
   * @param {object} taskSpec - serialized task descriptor (must be JSON-safe)
   * @param {object} [options]
   * @param {number} [options.timeoutMs] - per-job timeout override
   * @returns {object} { jobId, status, submitted, executionPerformed }
   */
  submit(taskSpec, options = {}) {
    if (!taskSpec || typeof taskSpec !== 'object' || Array.isArray(taskSpec)) {
      throw new TypeError('LocalCluster.submit requires a task descriptor object');
    }
    let spec;
    try {
      spec = JSON.parse(JSON.stringify(taskSpec));
    } catch (err) {
      throw new TypeError(`Task descriptor must be JSON-serializable: ${err.message}`);
    }

    const jobId = this._nextJobId();
    const job = {
      jobId,
      spec,
      status: JOB_STATES.QUEUED,
      timeoutMs: Number(options.timeoutMs) || this.jobTimeoutMs,
      submittedAt: nowIso(),
      startedAt: null,
      finishedAt: null,
      transitions: [{ from: null, to: JOB_STATES.QUEUED, event: 'submit', at: nowIso() }],
      stdout: '',
      stderr: '',
      result: null,
      error: null,
      workerPid: null
    };
    this._jobs.set(jobId, job);
    this._queue.push(jobId);
    this.emit('status', jobId, JOB_STATES.QUEUED, job);
    process.nextTick(() => this._pump());
    return { jobId, status: job.status, submitted: true, executionPerformed: false };
  }

  /**
   * Resolves when the job reaches a terminal state.
   * @param {string} jobId
   * @param {object} [options]
   * @param {number} [options.timeoutMs] - how long to wait before rejecting
   * @returns {Promise<object>} terminal job record (COMPLETED or FAILED)
   */
  waitFor(jobId, options = {}) {
    const job = this._jobs.get(jobId);
    if (!job) return Promise.reject(new Error(`Unknown job id: ${jobId}`));
    if (job.status === JOB_STATES.COMPLETED || job.status === JOB_STATES.FAILED) {
      return Promise.resolve(this._cloneJob(job));
    }
    return new Promise((resolve, reject) => {
      const timer =
        options.timeoutMs > 0
          ? setTimeout(() => {
              clearInterval(poller);
              reject(new Error(`waitFor timed out waiting for job ${jobId}`));
            }, options.timeoutMs)
          : null;
      const poller = setInterval(() => {
        const current = this._jobs.get(jobId);
        if (current && (current.status === JOB_STATES.COMPLETED || current.status === JOB_STATES.FAILED)) {
          if (timer) clearTimeout(timer);
          clearInterval(poller);
          resolve(this._cloneJob(current));
        }
      }, 20);
    });
  }

  cancel(jobId) {
    const job = this._jobs.get(jobId);
    if (!job) throw new Error(`Unknown job id: ${jobId}`);
    if (job.status !== JOB_STATES.QUEUED && job.status !== JOB_STATES.RUNNING) {
      return false;
    }
    if (job.status === JOB_STATES.QUEUED) {
      const idx = this._queue.indexOf(jobId);
      if (idx >= 0) this._queue.splice(idx, 1);
      this._failJob(job, 'CANCELLED', 'Job cancelled while queued');
    } else {
      const entry = this._running.get(jobId);
      if (entry && entry.worker) {
        this._killWorker(entry.worker, 'CANCELLED');
      }
      this._failJob(job, 'CANCELLED', 'Job cancelled while running');
    }
    return true;
  }

  getJob(jobId) {
    const job = this._jobs.get(jobId);
    if (!job) throw new Error(`Unknown job id: ${jobId}`);
    return this._cloneJob(job);
  }

  listJobs(filter = {}) {
    const status = filter.status ? String(filter.status).toUpperCase() : null;
    const jobs = [];
    for (const job of this._jobs.values()) {
      if (status && job.status !== status) continue;
      jobs.push({ jobId: job.jobId, status: job.status, submittedAt: job.submittedAt });
    }
    return jobs;
  }

  getTelemetry() {
    const byState = { QUEUED: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0 };
    for (const job of this._jobs.values()) {
      if (Object.hasOwn(byState, job.status)) byState[job.status]++;
    }
    return {
      provider: 'local',
      scheduler: 'LOCAL_MULTIPROCESS',
      maxWorkers: this.maxWorkers,
      idleWorkers: this._idle.filter((w) => w.connected).length,
      runningJobs: this._running.size,
      queueDepth: this._queue.length,
      spawnedWorkers: this._spawned,
      jobs: { total: this._jobs.size, byState }
    };
  }

  shutdown() {
    this._closed = true;
    for (const entry of this._running.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.worker) this._killWorker(entry.worker, 'SHUTDOWN');
    }
    this._running.clear();
    for (const worker of this._idle) this._killWorker(worker, 'SHUTDOWN');
    this._idle = [];
  }

  _cloneJob(job) {
    const clone = { ...job, transitions: job.transitions.map((t) => ({ ...t })) };
    if (job.spec) clone.spec = JSON.parse(JSON.stringify(job.spec));
    if (job.result) clone.result = JSON.parse(JSON.stringify(job.result));
    if (job.error) clone.error = { ...job.error };
    return clone;
  }

  _transition(job, target, event) {
    const allowed = ALLOWED_TRANSITIONS[job.status] || {};
    if (!allowed[target]) {
      throw new Error(`Illegal local job transition ${job.status} -> ${target}`);
    }
    const from = job.status;
    job.status = target;
    job.transitions.push({ from, to: target, event, at: nowIso() });
    if (target === JOB_STATES.RUNNING) job.startedAt = nowIso();
    if (target === JOB_STATES.COMPLETED || target === JOB_STATES.FAILED) job.finishedAt = nowIso();
    this.emit('status', job.jobId, target, job);
  }

  _acquireWorker() {
    while (this._idle.length > 0) {
      const worker = this._idle.pop();
      if (worker.connected && worker.exitCode === null && worker.signalCode === null) {
        return worker;
      }
    }
    return this._spawnWorker();
  }

  _spawnWorker() {
    const worker = fork(this.workerModule, [], { silent: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    this._spawned++;
    worker.currentJobId = null;

    worker.stdout.on('data', (chunk) => {
      const jobId = worker.currentJobId;
      if (jobId) {
        const job = this._jobs.get(jobId);
        if (job && job.status === JOB_STATES.RUNNING) job.stdout += chunk.toString('utf8');
      }
    });
    worker.stderr.on('data', (chunk) => {
      const jobId = worker.currentJobId;
      if (jobId) {
        const job = this._jobs.get(jobId);
        if (job && job.status === JOB_STATES.RUNNING) job.stderr += chunk.toString('utf8');
      }
    });

    worker.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'READY') return;
      const entry = this._running.get(msg.id);
      if (!entry || entry.worker !== worker) return;
      if (msg.type === 'RESULT') {
        this._handleWorkerResult(msg.id, worker, msg.result);
      } else if (msg.type === 'ERROR') {
        this._handleWorkerError(msg.id, worker, msg.error);
      }
    });

    worker.on('exit', (code, signal) => {
      const jobId = worker.currentJobId;
      worker.currentJobId = null;
      if (jobId) {
        const entry = this._running.get(jobId);
        if (entry && entry.worker === worker) {
          this._running.delete(jobId);
          if (entry.timer) clearTimeout(entry.timer);
          const job = this._jobs.get(jobId);
          if (job && job.status === JOB_STATES.RUNNING) {
            this._failJob(
              job,
              job.error ? job.error.code : 'INTERNAL',
              `Worker exited unexpectedly (code=${code}, signal=${signal}) before delivering a result`
            );
          }
        }
      }
      const idx = this._idle.indexOf(worker);
      if (idx >= 0) this._idle.splice(idx, 1);
      this._pump();
    });

    return worker;
  }

  _pump() {
    if (this._closed) return;
    while (this._queue.length > 0 && this._running.size < this.maxWorkers) {
      const jobId = this._queue.shift();
      const job = this._jobs.get(jobId);
      if (!job || job.status !== JOB_STATES.QUEUED) continue;
      const worker = this._acquireWorker();
      this._startJob(job, worker);
    }
  }

  _startJob(job, worker) {
    this._transition(job, JOB_STATES.RUNNING, 'start');
    worker.currentJobId = job.jobId;
    job.workerPid = worker.pid;

    const entry = { worker, timer: null };
    entry.timer = setTimeout(() => {
      const current = this._running.get(job.jobId);
      if (current && current.worker === worker) {
        this._running.delete(job.jobId);
        this._killWorker(worker, 'TIMED_OUT');
        this._failJob(job, 'TIMED_OUT', `Job exceeded its ${job.timeoutMs}ms timeout`);
      }
    }, job.timeoutMs);
    entry.timer.unref();

    this._running.set(job.jobId, entry);
    worker.send({ type: 'TASK', id: job.jobId, descriptor: job.spec });
  }

  _killWorker(worker, reason) {
    try {
      worker.kill('SIGKILL');
    } catch (err) {
      // worker already gone
    }
    worker._killReason = reason;
  }

  _handleWorkerResult(jobId, worker, result) {
    const entry = this._running.get(jobId);
    if (!entry || entry.worker !== worker) return;
    this._running.delete(jobId);
    if (entry.timer) clearTimeout(entry.timer);
    const job = this._jobs.get(jobId);
    if (!job || job.status !== JOB_STATES.RUNNING) return;

    const error = this._verifyResult(job, result);
    if (error) {
      this._failJob(job, 'VERIFICATION_FAILED', error);
    } else {
      job.result = result;
      this._transition(job, JOB_STATES.COMPLETED, 'complete');
    }
    this._retireWorker(worker);
  }

  _handleWorkerError(jobId, worker, errorRecord) {
    const entry = this._running.get(jobId);
    if (!entry || entry.worker !== worker) return;
    this._running.delete(jobId);
    if (entry.timer) clearTimeout(entry.timer);
    const job = this._jobs.get(jobId);
    if (job && job.status === JOB_STATES.RUNNING) {
      this._failJob(
        job,
        errorRecord && errorRecord.code ? errorRecord.code : 'INTERNAL',
        errorRecord && errorRecord.message
      );
    }
    this._retireWorker(worker);
  }

  _retireWorker(worker) {
    worker.currentJobId = null;
    if (worker.connected && worker.exitCode === null && worker.signalCode === null) {
      this._idle.push(worker);
    }
    this._pump();
  }

  _failJob(job, code, message) {
    if (job.status === JOB_STATES.FAILED || job.status === JOB_STATES.COMPLETED) return;
    job.error = { code, message: String(message || 'Job failed') };
    this._transition(job, JOB_STATES.FAILED, 'fail');
    this._pump();
  }

  /**
   * Independent scheduler-side verification before a job is marked completed:
   * 1. Checksum of the returned payload must match the worker's claim.
   * 2. Residual is recomputed from the returned solution using the shared
   *    production Poisson system builder and must satisfy the tolerance.
   * 3. All numeric values returned must be finite and consistent.
   */
  _verifyResult(job, result) {
    if (!result || typeof result !== 'object') {
      return 'Worker returned a non-object result';
    }
    const { checksum, ...payload } = result;
    if (typeof checksum !== 'string' || sha256(payload) !== checksum) {
      return 'Result checksum mismatch (IPC payload integrity check failed)';
    }

    const taskType = job.spec.taskType;
    if (taskType === 'poisson_sparse_cholesky') {
      if (!Array.isArray(result.solution) || !Number.isFinite(result.solution.length) || result.solution.length === 0) {
        return 'Result is missing a valid solution vector';
      }
      const n = job.spec.n;
      let A;
      let b;
      try {
        const built = buildPoissonSystem(n, { rhsMode: job.spec.rhsMode });
        A = built.A;
        b = built.b;
      } catch (err) {
        return `Scheduler could not rebuild system for verification: ${err.message}`;
      }
      if (A.nRows !== result.solution.length) {
        return `Solver dimension mismatch: expected ${A.nRows}, got ${result.solution.length}`;
      }

      const x = new Float64Array(result.solution);
      const ax = new Float64Array(A.nRows);
      A.multiplyVector(x, ax);

      let r0Norm = 0;
      let residualSq = 0;
      for (let i = 0; i < b.length; i++) {
        const r = b[i] - ax[i];
        residualSq += r * r;
        r0Norm += b[i] * b[i];
      }
      r0Norm = Math.sqrt(r0Norm);
      if (r0Norm < 1e-12) r0Norm = 1;
      const recomputedResidual = Math.sqrt(residualSq) / r0Norm;

      if (!Number.isFinite(recomputedResidual)) {
        return 'Recomputed residual is non-finite';
      }
      const tolerance = Number.isFinite(job.spec.tolerance) && job.spec.tolerance > 0 ? job.spec.tolerance : 1e-8;
      if (recomputedResidual >= tolerance) {
        return `Recomputed relative residual ${recomputedResidual.toExponential(3)} exceeds tolerance ${tolerance}`;
      }
      if (!Number.isFinite(result.relativeResidual) || Math.abs(result.relativeResidual - recomputedResidual) > 1e-6) {
        return `Solver-reported residual ${result.relativeResidual} is inconsistent with scheduler verification ${recomputedResidual.toExponential(3)}`;
      }
      for (let i = 0; i < result.solution.length; i++) {
        if (!Number.isFinite(result.solution[i])) {
          return `Solution contains a non-finite value at index ${i}`;
        }
      }
      if (!Number.isFinite(result.elapsedMs) || result.elapsedMs < 0) {
        return 'Worker-reported elapsed time is invalid';
      }
    } else if (taskType === 'spin_wait') {
      if (!Number.isFinite(result.spinMs) || !Number.isFinite(result.elapsedMs)) {
        return 'Spin task returned non-finite metrics';
      }
    } else {
      return `Scheduler cannot verify unknown task type "${taskType}"`;
    }
    return null;
  }
}

module.exports = {
  LocalCluster,
  JOB_STATES,
  ALLOWED_TRANSITIONS
};
