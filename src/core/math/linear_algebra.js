/**
 * OmniEng Core Mathematics: Linear Algebra, Vector, Matrix, Quaternion & Linear Solvers
 * Provides JavaScript floating-point operations for CAD, CAE, and GNC.
 */

const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = Number(x);
    this.y = Number(y);
    this.z = Number(z);
  }

  clone() {
    return new Vector3(this.x, this.y, this.z);
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v) {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    return new Vector3(x, y, z);
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length() {
    return Math.sqrt(this.lengthSq());
  }

  normalize() {
    const len = this.length();
    if (len > 1e-12) {
      this.x /= len;
      this.y /= len;
      this.z /= len;
    }
    return this;
  }

  distanceTo(v) {
    return Math.sqrt(
      (this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2
    );
  }

  toArray() {
    return [this.x, this.y, this.z];
  }

  static fromArray(arr) {
    return new Vector3(arr[0] || 0, arr[1] || 0, arr[2] || 0);
  }
}

class Quaternion {
  constructor(w = 1, x = 0, y = 0, z = 0) {
    this.w = Number(w);
    this.x = Number(x);
    this.y = Number(y);
    this.z = Number(z);
  }

  clone() {
    return new Quaternion(this.w, this.x, this.y, this.z);
  }

  set(w, x, y, z) {
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  setFromAxisAngle(axis, angle) {
    const halfAngle = angle * 0.5;
    const s = Math.sin(halfAngle);
    const norm = axis.clone().normalize();
    this.w = Math.cos(halfAngle);
    this.x = norm.x * s;
    this.y = norm.y * s;
    this.z = norm.z * s;
    return this.normalize();
  }

  multiply(q) {
    const w = this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z;
    const x = this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y;
    const y = this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x;
    const z = this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w;
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  normalize() {
    const len = Math.sqrt(
      this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z
    );
    if (len > 1e-12) {
      this.w /= len;
      this.x /= len;
      this.y /= len;
      this.z /= len;
    }
    return this;
  }

  rotateVector(v) {
    // q * (0, v) * q_conjugate
    const qx = this.x, qy = this.y, qz = this.z, qw = this.w;
    const vx = v.x, vy = v.y, vz = v.z;

    const ix = qw * vx + qy * vz - qz * vy;
    const iy = qw * vy + qz * vx - qx * vz;
    const iz = qw * vz + qx * vy - qy * vx;
    const iw = -qx * vx - qy * vy - qz * vz;

    const x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    const y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    const z = iz * qw + iw * -qz + ix * -qy - iy * -qx;

    return new Vector3(x, y, z);
  }

  static fromEuler(roll, pitch, yaw) {
    // roll (x), pitch (y), yaw (z) in radians
    const cr = Math.cos(roll * 0.5);
    const sr = Math.sin(roll * 0.5);
    const cp = Math.cos(pitch * 0.5);
    const sp = Math.sin(pitch * 0.5);
    const cy = Math.cos(yaw * 0.5);
    const sy = Math.sin(yaw * 0.5);

    const w = cr * cp * cy + sr * sp * sy;
    const x = sr * cp * cy - cr * sp * sy;
    const y = cr * sp * cy + sr * cp * sy;
    const z = cr * cp * sy - sr * sp * cy;

    return new Quaternion(w, x, y, z).normalize();
  }

  toEuler() {
    // roll (x), pitch (y), yaw (z)
    const sinr_cosp = 2 * (this.w * this.x + this.y * this.z);
    const cosr_cosp = 1 - 2 * (this.x * this.x + this.y * this.y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);

    const sinp = 2 * (this.w * this.y - this.z * this.x);
    let pitch;
    if (Math.abs(sinp) >= 1) {
      pitch = Math.sign(sinp) * (Math.PI / 2);
    } else {
      pitch = Math.asin(sinp);
    }

    const siny_cosp = 2 * (this.w * this.z + this.x * this.y);
    const cosy_cosp = 1 - 2 * (this.y * this.y + this.z * this.z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);

    return { roll, pitch, yaw };
  }

  toEulerAngles() {
    return this.toEuler();
  }
}

/**
 * Dense & Linear System Matrix Solver
 */
class LinearSolver {
  /**
   * Solve Ax = b via Gaussian Elimination with Partial Pivoting
   * @param {Array<Array<number>>} A square matrix [n x n]
   * @param {Array<number>} b RHS vector [n]
   * @returns {Array<number>} solution vector x
   */
  static solveGaussian(A, b) {
    const n = A.length;
    // Deep clone augmented matrix
    const M = [];
    for (let i = 0; i < n; i++) {
      M[i] = [...A[i], b[i]];
    }

    // Forward elimination
    for (let p = 0; p < n; p++) {
      // Find pivot row
      let maxRow = p;
      for (let r = p + 1; r < n; r++) {
        if (Math.abs(M[r][p]) > Math.abs(M[maxRow][p])) {
          maxRow = r;
        }
      }
      if (maxRow !== p) {
        const temp = M[p];
        M[p] = M[maxRow];
        M[maxRow] = temp;
      }

      if (Math.abs(M[p][p]) < 1e-14) {
        throw new Error(`Matrix is singular or near-singular at pivot ${p}`);
      }

      for (let r = p + 1; r < n; r++) {
        const factor = M[r][p] / M[p][p];
        for (let c = p; c <= n; c++) {
          M[r][c] -= factor * M[p][c];
        }
      }
    }

    // Back substitution
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let sum = M[r][n];
      for (let c = r + 1; c < n; c++) {
        sum -= M[r][c] * x[c];
      }
      x[r] = sum / M[r][r];
    }

    return x;
  }

  /**
   * Solve positive-definite symmetric system Ax = b using Conjugate Gradient
   */
  static solveConjugateGradient(A, b, arg3 = 1000, arg4 = 1e-8, arg5 = 1e-8) {
    const n = b.length;
    let x;
    let maxIter;
    let tol;

    if (Array.isArray(arg3)) {
      x = [...arg3];
      maxIter = typeof arg4 === 'number' ? arg4 : 1000;
      tol = typeof arg5 === 'number' ? arg5 : 1e-8;
    } else {
      x = new Array(n).fill(0);
      maxIter = typeof arg3 === 'number' ? arg3 : 1000;
      tol = typeof arg4 === 'number' ? arg4 : 1e-8;
    }
    
    // r = b - A*x
    const Ax = LinearSolver.matVecMul(A, x);
    let r = b.map((val, i) => val - Ax[i]);
    let p = [...r];
    let rsold = LinearSolver.dot(r, r);

    if (Math.sqrt(rsold) < tol) return x;

    for (let iter = 0; iter < maxIter; iter++) {
      const Ap = LinearSolver.matVecMul(A, p);
      const pAp = LinearSolver.dot(p, Ap);
      if (Math.abs(pAp) < 1e-15) break;

      const alpha = rsold / pAp;
      for (let i = 0; i < n; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
      }

      const rsnew = LinearSolver.dot(r, r);
      if (Math.sqrt(rsnew) < tol) break;

      const beta = rsnew / rsold;
      for (let i = 0; i < n; i++) {
        p[i] = r[i] + beta * p[i];
      }
      rsold = rsnew;
    }

    return x;
  }

  static matVecMul(A, x) {
    const n = A.length;
    const y = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const row = A[i];
      for (let j = 0; j < row.length; j++) {
        sum += row[j] * x[j];
      }
      y[i] = sum;
    }
    return y;
  }

  static dot(u, v) {
    let s = 0;
    for (let i = 0; i < u.length; i++) s += u[i] * v[i];
    return s;
  }

  static _toSparseSolver(A) {
    const { WasmSparseMultifrontalSolver } = require('./wasm_sparse_multifrontal');
    const { SparseMatrixCSR } = require('./sparse_cholesky');

    if (A instanceof WasmSparseMultifrontalSolver) return A;

    if (A instanceof SparseMatrixCSR) {
      const solver = new WasmSparseMultifrontalSolver(A.nRows, A.nCols);
      for (let r = 0; r < A.nRows; r++) {
        for (let p = A.rowPtr[r]; p < A.rowPtr[r + 1]; p++) {
          solver.addEntry(r, A.colInd[p], A.values[p]);
        }
      }
      solver.finalizeCSR();
      return solver;
    }

    if (A && Number.isInteger(A.nRows) && A.rowPtr && A.colInd && A.values) {
      const solver = new WasmSparseMultifrontalSolver(A.nRows, A.nRows);
      for (let r = 0; r < A.nRows; r++) {
        for (let p = A.rowPtr[r]; p < A.rowPtr[r + 1]; p++) {
          solver.addEntry(r, A.colInd[p], A.values[p]);
        }
      }
      solver.finalizeCSR();
      return solver;
    }

    if (Array.isArray(A) && A.length > 0 && Array.isArray(A[0])) {
      const n = A.length;
      const solver = new WasmSparseMultifrontalSolver(n, n);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (Math.abs(A[r][c]) > 1e-15) solver.addEntry(r, c, A[r][c]);
        }
      }
      solver.finalizeCSR();
      return solver;
    }

    if (A instanceof Float64Array) {
      const n = Math.round(Math.sqrt(A.length));
      if (n * n !== A.length) {
        throw new TypeError('Flat Float64Array input must be square.');
      }
      const solver = new WasmSparseMultifrontalSolver(n, n);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const value = A[r * n + c];
          if (Math.abs(value) > 1e-15) solver.addEntry(r, c, value);
        }
      }
      solver.finalizeCSR();
      return solver;
    }

    throw new TypeError(
      'solveSparse expects a WasmSparseMultifrontalSolver, SparseMatrixCSR, CSR-like object, dense array-of-arrays, or flat Float64Array.'
    );
  }

  static _toDense(solver, n) {
    const dense = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let r = 0; r < n; r++) {
      for (let p = solver.rowPtr[r]; p < solver.rowPtr[r + 1]; p++) {
        dense[solver.colIdx[p]][r] = solver.values[p];
      }
    }
    return dense;
  }

  static _denseResidual(dense, solution, rhs) {
    const n = dense.length;
    let resSq = 0;
    let rhsSq = 0;
    for (let i = 0; i < n; i++) {
      let ax = 0;
      const row = dense[i];
      for (let j = 0; j < n; j++) ax += row[j] * solution[j];
      const residual = rhs[i] - ax;
      resSq += residual * residual;
      rhsSq += rhs[i] * rhs[i];
    }
    const residualNorm = Math.sqrt(resSq);
    const relativeResidual = residualNorm / (Math.sqrt(rhsSq) || 1);
    return { residualNorm, relativeResidual };
  }

  static solveSparse(A, b, options = {}) {
    const rhs = b instanceof Float64Array ? b : Float64Array.from(b);
    let solver;
    try {
      solver = LinearSolver._toSparseSolver(A);
    } catch (cause) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        'solveSparse received an unsupported matrix type.',
        {},
        cause
      );
    }

    try {
      const factorization = solver.factorize();
      const result = solver.solve(rhs);
      return {
        solution: result.solution,
        method: factorization.solverMethod,
        residualNorm: result.residualNorm,
        relativeResidual: result.relativeResidual,
        converged: result.converged,
        factorization
      };
    } catch (choleskyError) {
      let dense;
      try {
        dense = LinearSolver._toDense(solver, solver.n);
      } catch (cause) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          'Could not materialize a dense matrix from the sparse input.',
          {},
          cause
        );
      }
      let solutionArray;
      try {
        solutionArray = LinearSolver.solveGaussian(dense, Array.from(rhs));
      } catch (luError) {
        throw new OmniError(
          OmniErrorCode.NUMERICAL_FAILURE,
          `Sparse Cholesky failed and dense LU fallback also failed: ${choleskyError.message}; ${luError.message}`,
          { choleskyMessage: choleskyError.message, luMessage: luError.message },
          luError
        );
      }
      const solution = Float64Array.from(solutionArray);
      const { residualNorm, relativeResidual } = LinearSolver._denseResidual(dense, solution, rhs);
      return {
        solution,
        method: 'dense-lu',
        residualNorm,
        relativeResidual,
        converged: relativeResidual < 1e-8,
        factorization: { solverMethod: 'dense-lu', sparseCholeskyFailed: choleskyError.message }
      };
    }
  }

  static isPositiveDefinite(A) {
    let solver;
    try {
      solver = LinearSolver._toSparseSolver(A);
    } catch (err) {
      return {
        positiveDefinite: false,
        reason: err.message,
        symmetric: false,
        diagonallyDominant: false,
        strictlyDiagonallyDominant: false,
        factorizationOutcome: 'failed',
        n: null
      };
    }

    const n = solver.n;
    let maxAbs = 0;
    let weaklyDominant = true;
    let strictlyDominant = true;
    for (let r = 0; r < n; r++) {
      let diagonal = 0;
      let offDiagonalSum = 0;
      for (let p = solver.rowPtr[r]; p < solver.rowPtr[r + 1]; p++) {
        const c = solver.colIdx[p];
        const value = solver.values[p];
        if (c === r) diagonal = Math.abs(value);
        else offDiagonalSum += Math.abs(value);
        const absValue = Math.abs(value);
        if (absValue > maxAbs) maxAbs = absValue;
      }
      if (diagonal < offDiagonalSum - 1e-12 * Math.max(1, offDiagonalSum)) weaklyDominant = false;
      if (diagonal <= offDiagonalSum) strictlyDominant = false;
    }

    let maxSymDiff = 0;
    for (let r = 0; r < n; r++) {
      for (let p = solver.rowPtr[r]; p < solver.rowPtr[r + 1]; p++) {
        const c = solver.colIdx[p];
        const value = solver.values[p];
        let mirror = 0;
        for (let q = solver.rowPtr[c]; q < solver.rowPtr[c + 1]; q++) {
          if (solver.colIdx[q] === r) {
            mirror = solver.values[q];
            break;
          }
        }
        const diff = Math.abs(value - mirror);
        if (diff > maxSymDiff) maxSymDiff = diff;
      }
    }
    const symmetric = maxAbs > 0 ? maxSymDiff <= 1e-9 * maxAbs : true;

    let factorizationOutcome = 'failed';
    let factorized = false;
    try {
      solver.factorize();
      factorizationOutcome = 'spd';
      factorized = true;
    } catch (err) {
      factorizationOutcome = 'non-spd-pivot';
    }

    return {
      positiveDefinite: symmetric && factorized,
      symmetric,
      diagonallyDominant: weaklyDominant,
      strictlyDiagonallyDominant: strictlyDominant,
      factorizationOutcome,
      maxSymmetricDifference: maxSymDiff,
      maxAbsoluteEntry: maxAbs,
      n
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Vector3, Quaternion, LinearSolver };
}
