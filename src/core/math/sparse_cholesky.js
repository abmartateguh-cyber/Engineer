/**
 * Experimental CSR storage and iterative linear-system helpers. The solver
 * uses Jacobi-preconditioned conjugate gradients or relaxed block Gauss-Seidel;
 * it does not factor a Cholesky matrix or provide out-of-core storage. The
 * ordering helper is a degree sort, not an AMD implementation.
 */

'use strict';

function norm2(values) {
  let sumSq = 0.0;
  for (let i = 0; i < values.length; i++) sumSq += values[i] * values[i];
  return Math.sqrt(sumSq);
}

class SparseMatrixCSR {
  /**
   * @param {number} nRows
   * @param {number} nCols
   */
  constructor(nRows, nCols) {
    this.nRows = nRows;
    this.nCols = nCols;
    this.rowPtr = new Int32Array(nRows + 1);
    this.colInd = [];
    this.values = [];
    this._entries = new Map(); // Temporary builder map: "row,col" -> val
  }

  addEntry(r, c, val) {
    if (r < 0 || r >= this.nRows || c < 0 || c >= this.nCols) return;
    const key = r * this.nCols + c;
    const existing = this._entries.get(key) || 0.0;
    this._entries.set(key, existing + val);
  }

  finalize() {
    // Build CSR sorted structure
    const rowCounts = new Int32Array(this.nRows);
    for (const key of this._entries.keys()) {
      const r = Math.floor(key / this.nCols);
      rowCounts[r]++;
    }

    this.rowPtr[0] = 0;
    for (let r = 0; r < this.nRows; r++) {
      this.rowPtr[r + 1] = this.rowPtr[r] + rowCounts[r];
    }

    const totalNNZ = this.rowPtr[this.nRows];
    this.colInd = new Int32Array(totalNNZ);
    this.values = new Float64Array(totalNNZ);

    const currentPos = new Int32Array(this.rowPtr);
    // Sort entries within each row
    const rowBuckets = Array.from({ length: this.nRows }, () => []);
    for (const [key, val] of this._entries) {
      const r = Math.floor(key / this.nCols);
      const c = key % this.nCols;
      rowBuckets[r].push({ c, val });
    }

    for (let r = 0; r < this.nRows; r++) {
      rowBuckets[r].sort((a, b) => a.c - b.c);
      for (const item of rowBuckets[r]) {
        const pos = currentPos[r]++;
        this.colInd[pos] = item.c;
        this.values[pos] = item.val;
      }
    }
    this._entries.clear();
  }

  multiplyVector(x, y) {
    for (let r = 0; r < this.nRows; r++) {
      let sum = 0.0;
      const start = this.rowPtr[r];
      const end = this.rowPtr[r + 1];
      for (let idx = start; idx < end; idx++) {
        sum += this.values[idx] * x[this.colInd[idx]];
      }
      y[r] = sum;
    }
  }
}

/** Legacy export name; this class solves systems iteratively and does not form a Cholesky factor. */
class SparseCholeskySolver {
  /**
   * Sorts rows by stored row degree as a simple ordering heuristic.
   * @param {SparseMatrixCSR} A - Symmetric positive-definite matrix
   * @returns {Int32Array} Permutation array P
   */
  static computeAMDOrdering(A) {
    const n = A.nRows;
    const perm = new Int32Array(n);
    const degrees = new Int32Array(n);

    for (let i = 0; i < n; i++) {
      degrees[i] = A.rowPtr[i + 1] - A.rowPtr[i];
      perm[i] = i;
    }

    // Sort nodes by degree (minimum degree heuristic)
    perm.sort((a, b) => degrees[a] - degrees[b]);
    return perm;
  }

  /**
   * Solves A * x = b using Jacobi-preconditioned conjugate gradients (no factorization).
   * @param {SparseMatrixCSR} A - Symmetric positive definite CSR matrix
   * @param {Float64Array} b - Right hand side load vector
   * @param {Object} options
   * @returns {{x: Float64Array, converged: boolean, iterations: number, residual: number}}
   */
  static solve(A, b, options = {}) {
    const { maxIterations = 1000, tolerance = 1e-8, preconditioned = true } = options;

    const n = A.nRows;
    const x = new Float64Array(n);
    const r = new Float64Array(b); // r = b - A*x (since x=0, r=b)
    const z = new Float64Array(n);
    const p = new Float64Array(n);
    const Ap = new Float64Array(n);

    // Jacobi / Diagonal Preconditioner M_diag = 1 / A_ii
    const invDiag = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let diagVal = 1.0;
      const start = A.rowPtr[i];
      const end = A.rowPtr[i + 1];
      for (let idx = start; idx < end; idx++) {
        if (A.colInd[idx] === i) {
          diagVal = A.values[idx];
          break;
        }
      }
      invDiag[i] = Math.abs(diagVal) > 1e-12 ? 1.0 / diagVal : 1.0;
    }

    // z = M^-1 * r
    for (let i = 0; i < n; i++) {
      z[i] = preconditioned ? invDiag[i] * r[i] : r[i];
      p[i] = z[i];
    }

    let rzOld = 0.0;
    for (let i = 0; i < n; i++) rzOld += r[i] * z[i];

    let r0Norm = norm2(b);
    if (r0Norm < 1e-12) r0Norm = 1.0;

    let converged = false;
    let iter = 0;

    for (iter = 0; iter < maxIterations; iter++) {
      A.multiplyVector(p, Ap);

      let pAp = 0.0;
      for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
      if (Math.abs(pAp) < 1e-20) break;

      const alpha = rzOld / pAp;

      for (let i = 0; i < n; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
      }

      const resNorm = norm2(r);
      if (resNorm / r0Norm < tolerance) {
        converged = true;
        break;
      }

      for (let i = 0; i < n; i++) {
        z[i] = preconditioned ? invDiag[i] * r[i] : r[i];
      }

      let rzNew = 0.0;
      for (let i = 0; i < n; i++) rzNew += r[i] * z[i];

      const beta = rzNew / (rzOld + 1e-30);
      for (let i = 0; i < n; i++) {
        p[i] = z[i] + beta * p[i];
      }

      rzOld = rzNew;
    }

    return {
      x,
      converged,
      iterations: iter,
      residualNorm: norm2(r)
    };
  }

  /**
   * Applies relaxed block-ordered Gauss-Seidel iterations to the in-memory system.
   * This routine does not stream data to disk or form sub-block factorizations.
   * @param {SparseMatrixCSR} A - Global sparse matrix
   * @param {Float64Array} b - Right hand side vector
   * @param {Object} [options] - blockSize, maxIterations, tolerance
   * @returns {{ x: Float64Array, converged: boolean, iterations: number, residualNorm: number }}
   */
  static solveBlockTiledOutOfCore(A, b, options = {}) {
    const n = A.nRows;
    const blockSize = options.blockSize || Math.min(256, Math.max(32, Math.floor(n / 4)));
    const maxIterations = options.maxIterations || 100;
    const tolerance = options.tolerance || 1e-6;

    const numBlocks = Math.ceil(n / blockSize);
    const x = new Float64Array(n);
    const r = new Float64Array(n);
    const Ax = new Float64Array(n);

    // Initial residual: r = b - A * x (with x = 0, r = b)
    r.set(b);
    let r0Norm = norm2(b);
    if (r0Norm < 1e-12) r0Norm = 1.0;

    let converged = false;
    let iter = 0;

    for (iter = 0; iter < maxIterations; iter++) {
      // Iterate through each block partition
      for (let blk = 0; blk < numBlocks; blk++) {
        const startRow = blk * blockSize;
        const endRow = Math.min(startRow + blockSize, n);
        const curBlockSize = endRow - startRow;

        // Solve sub-block diagonal system locally
        for (let i = startRow; i < endRow; i++) {
          // Compute row dot product excluding diagonal
          let offDiagSum = 0.0;
          let diagVal = 1.0;
          const rStart = A.rowPtr[i];
          const rEnd = A.rowPtr[i + 1];

          for (let idx = rStart; idx < rEnd; idx++) {
            const col = A.colInd[idx];
            const val = A.values[idx];
            if (col === i) {
              diagVal = val;
            } else {
              offDiagSum += val * x[col];
            }
          }

          if (Math.abs(diagVal) > 1e-20) {
            // Over-relaxation Gauss-Seidel update for block
            const xNew = (b[i] - offDiagSum) / diagVal;
            x[i] = 0.5 * x[i] + 0.5 * xNew;
          }
        }
      }

      // Compute global residual: r = b - A*x
      A.multiplyVector(x, Ax);
      let resSq = 0.0;
      for (let i = 0; i < n; i++) {
        r[i] = b[i] - Ax[i];
        resSq += r[i] * r[i];
      }
      const resNorm = Math.sqrt(resSq);

      if (resNorm / r0Norm < tolerance) {
        converged = true;
        break;
      }
    }

    return {
      x,
      converged,
      iterations: iter,
      residualNorm: norm2(r)
    };
  }
}

module.exports = {
  SparseMatrixCSR,
  SparseCholeskySolver
};
