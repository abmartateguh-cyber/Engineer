'use strict';

const crypto = require('crypto');
const { SparseCholeskySolver } = require('../math/sparse_cholesky');
const { buildPoissonSystem } = require('./poisson_system');

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validatePoissonDescriptor(descriptor) {
  const n = descriptor && descriptor.n;
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new TypeError(`Descriptor "n" must be a positive integer, received ${JSON.stringify(n)}`);
  }
  const tolerance = descriptor.tolerance;
  if (tolerance !== undefined && (!Number.isFinite(tolerance) || tolerance <= 0)) {
    throw new TypeError(
      `Descriptor "tolerance" must be a positive finite number, received ${JSON.stringify(tolerance)}`
    );
  }
  const maxIterations = descriptor.maxIterations;
  if (maxIterations !== undefined && (!Number.isSafeInteger(maxIterations) || maxIterations < 1)) {
    throw new TypeError(
      `Descriptor "maxIterations" must be a positive integer, received ${JSON.stringify(maxIterations)}`
    );
  }
}

function solvePoisson(descriptor) {
  validatePoissonDescriptor(descriptor);
  const n = descriptor.n;
  const tolerance = descriptor.tolerance === undefined ? 1e-8 : descriptor.tolerance;
  const maxIterations = descriptor.maxIterations === undefined ? 4000 : descriptor.maxIterations;

  const tStart = Date.now();
  const { A, b } = buildPoissonSystem(n, { rhsMode: descriptor.rhsMode });
  const outcome = SparseCholeskySolver.solve(A, b, {
    maxIterations,
    tolerance,
    preconditioned: descriptor.preconditioned !== false
  });

  let r0Norm = 0;
  for (let i = 0; i < b.length; i++) r0Norm += b[i] * b[i];
  r0Norm = Math.sqrt(r0Norm);
  if (r0Norm < 1e-12) r0Norm = 1;

  const solution = Array.from(outcome.x);
  const relativeResidual = outcome.residualNorm / r0Norm;

  return {
    taskType: 'poisson_sparse_cholesky',
    n,
    solution,
    iterations: outcome.iterations,
    converged: Boolean(outcome.converged),
    residualNorm: outcome.residualNorm,
    relativeResidual,
    r0Norm,
    elapsedMs: Date.now() - tStart
  };
}

function spinWait(descriptor) {
  const spinMs = descriptor && descriptor.spinMs;
  if (!Number.isFinite(spinMs) || spinMs < 0) {
    throw new TypeError(`Descriptor "spinMs" must be a non-negative finite number, received ${JSON.stringify(spinMs)}`);
  }
  const deadline = Date.now() + spinMs;
  let spins = 0;
  while (Date.now() < deadline) spins++;
  return { taskType: 'spin_wait', spinMs, spins, elapsedMs: Date.now() - deadline + spinMs };
}

function runTask(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new TypeError('Task descriptor must be an object');
  }
  switch (descriptor.taskType) {
    case 'poisson_sparse_cholesky':
      return solvePoisson(descriptor);
    case 'spin_wait':
      return spinWait(descriptor);
    default:
      throw new Error(`Unknown task type "${descriptor.taskType}"`);
  }
}

process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object' || msg.type !== 'TASK') return;
  const id = msg.id;
  try {
    const result = runTask(msg.descriptor);
    result.checksum = sha256(result);
    process.send({ type: 'RESULT', id, result });
  } catch (err) {
    process.send({
      type: 'ERROR',
      id,
      error: {
        code: err.code || 'INTERNAL',
        message: String((err && err.message) || err)
      },
      stack: err && err.stack ? String(err.stack) : null
    });
  }
});

process.send({ type: 'READY', pid: process.pid });
