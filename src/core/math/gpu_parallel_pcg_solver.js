/**
 * Experimental serial CPU Preconditioned Conjugate Gradient solver.
 * This compatibility-named implementation uses JavaScript Float64Array loops;
 * it does not dispatch WebGPU or native sparse-library kernels.
 */

'use strict';

class GPUParallelPCGSolver {
  /**
   * @param {Object} options
   * @param {number} [options.maxIterations=1000] Algorithm iteration limit
   * @param {number} [options.tolerance=1e-8] Algorithm relative-residual target
   */
  constructor(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('PCG solver options must be an object.');
    }
    const unsupported = Object.keys(options).filter((key) => !['maxIterations', 'tolerance'].includes(key));
    if (unsupported.length > 0) {
      const error = new Error(`PCG solver does not support the '${unsupported[0]}' option.`);
      error.code = 'UNSUPPORTED';
      throw error;
    }
    this.maxIterations = options.maxIterations ?? 1000;
    this.tolerance = options.tolerance ?? 1e-8;
    if (!Number.isInteger(this.maxIterations) || this.maxIterations < 1) {
      throw new RangeError('maxIterations must be a positive integer.');
    }
    if (!Number.isFinite(this.tolerance) || this.tolerance <= 0 || this.tolerance >= 1) {
      throw new RangeError('tolerance must be finite and between zero and one.');
    }
  }

  /**
   * Solves a caller-supplied dense matrix or CSR system using serial CPU PCG.
   * The matrix is expected to be symmetric positive definite.
   */
  solve(matrixOrCsr, b, x0 = null) {
    let csr = matrixOrCsr;
    const firstRow = Array.isArray(matrixOrCsr) ? matrixOrCsr[0] : null;
    const firstRowIsVector =
      Array.isArray(firstRow) || (ArrayBuffer.isView(firstRow) && typeof firstRow.length === 'number');

    if (Array.isArray(matrixOrCsr) && firstRowIsVector) {
      const n = matrixOrCsr.length;
      if (n < 1) throw new TypeError('Dense PCG matrix must contain at least one row.');
      const rowPtr = new Int32Array(n + 1);
      const colIdx = [];
      const values = [];
      for (let i = 0; i < n; i++) {
        const row = matrixOrCsr[i];
        if (!(Array.isArray(row) || (ArrayBuffer.isView(row) && typeof row.length === 'number')) || row.length !== n) {
          throw new TypeError('Dense PCG matrix must be square.');
        }
        for (let j = 0; j < n; j++) {
          const value = row[j];
          if (!Number.isFinite(value)) throw new TypeError('Dense PCG matrix values must be finite.');
          if (value !== 0) {
            colIdx.push(j);
            values.push(value);
          }
        }
        rowPtr[i + 1] = values.length;
      }
      csr = { n, rowPtr, colIdx, values };
    }

    const n = csr?.n;
    const isArrayLike = (value) =>
      Array.isArray(value) || (ArrayBuffer.isView(value) && typeof value.length === 'number');
    if (
      !Number.isInteger(n) ||
      n < 1 ||
      !isArrayLike(csr.rowPtr) ||
      !isArrayLike(csr.colIdx) ||
      !isArrayLike(csr.values)
    ) {
      throw new TypeError('PCG requires a square dense matrix or CSR data with n, rowPtr, colIdx, and values.');
    }
    const rowPtr = Array.from(csr.rowPtr);
    const colIdx = Array.from(csr.colIdx);
    const val = Array.from(csr.values);
    if (rowPtr.length !== n + 1 || rowPtr[0] !== 0 || rowPtr[n] !== val.length || colIdx.length !== val.length) {
      throw new TypeError('CSR row pointers, columns, and values must have consistent lengths.');
    }
    for (let row = 0; row < n; row++) {
      if (
        !Number.isInteger(rowPtr[row]) ||
        !Number.isInteger(rowPtr[row + 1]) ||
        rowPtr[row] < 0 ||
        rowPtr[row] > rowPtr[row + 1] ||
        rowPtr[row + 1] > val.length
      ) {
        throw new TypeError('CSR row pointers must be integer offsets in nondecreasing order.');
      }
    }
    for (let entry = 0; entry < val.length; entry++) {
      if (!Number.isInteger(colIdx[entry]) || colIdx[entry] < 0 || colIdx[entry] >= n) {
        throw new TypeError('CSR column indices must refer to valid matrix columns.');
      }
      if (!Number.isFinite(val[entry])) throw new TypeError('CSR matrix values must be finite.');
    }
    if (!isArrayLike(b) || b.length !== n || !Array.from(b).every(Number.isFinite)) {
      throw new TypeError('PCG right-hand side must contain one finite number per matrix row.');
    }
    if (x0 !== null && (!isArrayLike(x0) || x0.length !== n || !Array.from(x0).every(Number.isFinite))) {
      throw new TypeError('PCG initial guess must contain one finite number per matrix row.');
    }

    const tStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const x = new Float64Array(n);
    if (x0 !== null) for (let i = 0; i < n; i++) x[i] = x0[i];

    // A missing or non-positive diagonal is invalid for Jacobi-preconditioned PCG.
    const invDiag = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let diagonal = 0;
      let foundDiagonal = false;
      for (let entry = rowPtr[i]; entry < rowPtr[i + 1]; entry++) {
        if (colIdx[entry] === i) {
          diagonal += val[entry];
          foundDiagonal = true;
        }
      }
      if (!foundDiagonal || !Number.isFinite(diagonal) || diagonal <= 0) {
        throw new TypeError(`PCG matrix row ${i} requires a finite positive diagonal.`);
      }
      invDiag[i] = 1 / diagonal;
      if (!Number.isFinite(invDiag[i])) throw new RangeError(`PCG Jacobi inverse overflows at row ${i}.`);
    }

    const r = new Float64Array(n);
    const z = new Float64Array(n);
    const p = new Float64Array(n);
    const Ap = new Float64Array(n);
    let bNorm = 0;
    for (let i = 0; i < n; i++) {
      bNorm = Math.hypot(bNorm, b[i]);
      let Ax = 0;
      for (let entry = rowPtr[i]; entry < rowPtr[i + 1]; entry++) Ax += val[entry] * x[colIdx[entry]];
      r[i] = b[i] - Ax;
      z[i] = invDiag[i] * r[i];
      p[i] = z[i];
    }
    if (!Number.isFinite(bNorm)) throw new RangeError('PCG right-hand-side norm is outside the finite numeric range.');

    const residualScale = bNorm === 0 ? 1 : bNorm;
    let rzOld = 0;
    let finalResidualNorm = 0;
    let initialResidualNorm = 0;
    for (let i = 0; i < n; i++) {
      rzOld += r[i] * z[i];
      finalResidualNorm = Math.hypot(finalResidualNorm, r[i]);
      initialResidualNorm = Math.hypot(initialResidualNorm, r[i]);
    }
    if (!Number.isFinite(rzOld) || rzOld < 0 || !Number.isFinite(finalResidualNorm)) {
      throw new RangeError('PCG initial residual is invalid; the matrix may not be positive definite.');
    }

    let iterations = 0;
    let converged = finalResidualNorm / residualScale <= this.tolerance;
    let terminationReason = converged ? 'tolerance-reached' : 'maximum-iterations';
    for (let iter = 0; iter < this.maxIterations && !converged; iter++) {
      let pAp = 0;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let entry = rowPtr[i]; entry < rowPtr[i + 1]; entry++) sum += val[entry] * p[colIdx[entry]];
        Ap[i] = sum;
        pAp += p[i] * sum;
      }
      if (!Number.isFinite(pAp) || pAp <= 0) {
        terminationReason = 'non-positive-curvature';
        break;
      }

      const alpha = rzOld / pAp;
      if (!Number.isFinite(alpha)) {
        terminationReason = 'non-finite-step';
        break;
      }
      let rzNew = 0;
      finalResidualNorm = 0;
      for (let i = 0; i < n; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
        z[i] = invDiag[i] * r[i];
        rzNew += r[i] * z[i];
        finalResidualNorm = Math.hypot(finalResidualNorm, r[i]);
      }
      iterations++;
      if (!Number.isFinite(rzNew) || rzNew < 0 || !Number.isFinite(finalResidualNorm)) {
        terminationReason = 'non-finite-residual';
        break;
      }
      if (finalResidualNorm / residualScale <= this.tolerance) {
        converged = true;
        terminationReason = 'tolerance-reached';
        break;
      }
      if (!Number.isFinite(rzOld) || rzOld <= 0) {
        terminationReason = 'invalid-preconditioned-residual';
        break;
      }
      const beta = rzNew / rzOld;
      if (!Number.isFinite(beta)) {
        terminationReason = 'non-finite-direction-update';
        break;
      }
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
      rzOld = rzNew;
    }

    const recursiveResidualNorm = finalResidualNorm;
    let verifiedResidualNorm = 0;
    for (let i = 0; i < n; i++) {
      let Ax = 0;
      for (let entry = rowPtr[i]; entry < rowPtr[i + 1]; entry++) Ax += val[entry] * x[colIdx[entry]];
      verifiedResidualNorm = Math.hypot(verifiedResidualNorm, b[i] - Ax);
    }
    if (!Number.isFinite(verifiedResidualNorm)) {
      throw new RangeError('PCG final residual is outside the finite numeric range.');
    }
    const relativeResidual = verifiedResidualNorm / residualScale;
    converged = relativeResidual <= this.tolerance;
    if (converged) terminationReason = 'tolerance-reached';
    else if (terminationReason === 'tolerance-reached') terminationReason = 'residual-recheck-failed';
    const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tStart;
    const estimatedThroughputGFlops =
      elapsedMs > 0 ? Number(((iterations * val.length * 2e-9) / (elapsedMs / 1000)).toFixed(4)) : null;
    return {
      solution: x,
      iterations,
      converged,
      initialResidual: initialResidualNorm,
      initialResidualNorm,
      rightHandSideNorm: bNorm,
      recursiveResidualNorm,
      finalResidualNorm: verifiedResidualNorm,
      residualNorm: verifiedResidualNorm,
      relativeResidual,
      maxIterations: this.maxIterations,
      tolerance: this.tolerance,
      terminationReason,
      validationLevel: 'experimental',
      hardwareAcceleration: 'CPU (serial JavaScript Float64Array CSR SpMV)',
      gpuSpeedupVerified: false,
      elapsedMs,
      estimatedThroughputGFlops,
      throughputGFlops: estimatedThroughputGFlops
    };
  }
}

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GPUParallelPCGSolver };
}
if (typeof window !== 'undefined') {
  window.GPUParallelPCGSolver = GPUParallelPCGSolver;
}
