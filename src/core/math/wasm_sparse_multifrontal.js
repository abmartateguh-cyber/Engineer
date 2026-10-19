/**
 * OmniEng Sparse Direct Solver (Sparse Cholesky, Nested-Dissection Ordering)
 *
 * True sparse symmetric-positive-definite direct solver:
 *   1. CSR storage of the input matrix (full symmetric pattern expected).
 *   2. Fill-reducing ordering: recursive nested dissection with BFS level-set
 *      separators, exact minimum-degree on small leaf subgraphs.
 *   3. Elimination tree + exact symbolic column counts (no dense allocation anywhere).
 *   4. Up-looking sparse Cholesky  P*A*P^T = L*L^T  stored in CSC with O(nnz(L)) memory.
 *   5. Sparse forward / backward substitution.
 *
 * Memory is O(nnz(L)); a 100,000-unknown 2D Poisson system uses a few million
 * doubles instead of the 80 GB a dense n x n frontal matrix would need.
 *
 * Note: this is a pure-JavaScript implementation (no WebAssembly binary is shipped).
 * The class name is retained for API compatibility with earlier OmniEng modules.
 *
 * 100% In-House Implementation - Zero External Dependencies.
 */

'use strict';

class WasmSparseMultifrontalSolver {
  /**
   * @param {number} numRows
   * @param {number} numCols
   */
  constructor(numRows, numCols) {
    this.n = numRows || 0;
    this.m = numCols || 0;
    // Growable triplet buffers (duplicates are summed in finalizeCSR)
    this._cap = 1024;
    this._cnt = 0;
    this._ti = new Int32Array(this._cap);
    this._tj = new Int32Array(this._cap);
    this._tv = new Float64Array(this._cap);
    this.rowPtr = null;
    this.colIdx = null;
    this.values = null;
    this.permutation = null; // perm[k] = original index eliminated k-th
    this.invPermutation = null;
    this.factorized = false;
    this.nnz = 0;
  }

  addEntry(i, j, val) {
    if (i < 0 || i >= this.n || j < 0 || j >= this.m) return;
    if (this._cnt === this._cap) {
      const cap = this._cap * 2;
      const ni = new Int32Array(cap); ni.set(this._ti);
      const nj = new Int32Array(cap); nj.set(this._tj);
      const nv = new Float64Array(cap); nv.set(this._tv);
      this._ti = ni; this._tj = nj; this._tv = nv; this._cap = cap;
    }
    const c = this._cnt++;
    this._ti[c] = i;
    this._tj[c] = j;
    this._tv[c] = val;
  }

  /**
   * Builds the CSR representation from accumulated triplets
   * (rows bucketed by counting sort, columns sorted per row, duplicates summed).
   */
  finalizeCSR() {
    const n = this.n;
    const cnt = this._cnt;
    const ti = this._ti, tj = this._tj, tv = this._tv;
    const counts = new Int32Array(n + 1);
    for (let c = 0; c < cnt; c++) counts[ti[c] + 1]++;
    for (let i = 0; i < n; i++) counts[i + 1] += counts[i];
    const bc = new Int32Array(cnt);
    const bv = new Float64Array(cnt);
    const fill = counts.slice(0, n);
    for (let c = 0; c < cnt; c++) {
      const p = fill[ti[c]]++;
      bc[p] = tj[c];
      bv[p] = tv[c];
    }
    // Sort each row by column and merge duplicates into compacted output
    const rowPtr = new Int32Array(n + 1);
    const colIdx = new Int32Array(cnt);
    const values = new Float64Array(cnt);
    let out = 0;
    for (let i = 0; i < n; i++) {
      const s = counts[i];
      const e = counts[i + 1];
      const len = e - s;
      if (len > 24) {
        const idx = new Array(len);
        for (let k = 0; k < len; k++) idx[k] = s + k;
        idx.sort((a, b) => bc[a] - bc[b]);
        const tc = new Int32Array(len);
        const tvv = new Float64Array(len);
        for (let k = 0; k < len; k++) { tc[k] = bc[idx[k]]; tvv[k] = bv[idx[k]]; }
        for (let k = 0; k < len; k++) { bc[s + k] = tc[k]; bv[s + k] = tvv[k]; }
      } else {
        for (let a = s + 1; a < e; a++) {
          const cj = bc[a], cv = bv[a];
          let b = a - 1;
          while (b >= s && bc[b] > cj) { bc[b + 1] = bc[b]; bv[b + 1] = bv[b]; b--; }
          bc[b + 1] = cj; bv[b + 1] = cv;
        }
      }
      rowPtr[i] = out;
      for (let p = s; p < e; p++) {
        if (out > rowPtr[i] && colIdx[out - 1] === bc[p]) {
          values[out - 1] += bv[p];
        } else {
          colIdx[out] = bc[p];
          values[out] = bv[p];
          out++;
        }
      }
    }
    rowPtr[n] = out;
    this.rowPtr = rowPtr;
    this.colIdx = colIdx.slice(0, out);
    this.values = values.slice(0, out);
    this.nnz = out;
    this.factorized = false;
    this.permutation = null;
  }

  /**
   * Fill-reducing ordering: recursive nested dissection with BFS level-set
   * separators (O(n log n) on mesh-like graphs); small leaf subgraphs are
   * ordered with an exact minimum-degree elimination.
   * @returns {Int32Array} permutation (elimination order)
   */
  computeAMDOrdering() {
    if (!this.rowPtr) this.finalizeCSR();
    const n = this.n;

    // Symmetric, de-duplicated adjacency in CSR form (no self loops)
    const rp = this.rowPtr, ci = this.colIdx;
    const deg = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      for (let p = rp[i]; p < rp[i + 1]; p++) {
        const j = ci[p];
        if (j !== i) { deg[i + 1]++; deg[j + 1]++; }
      }
    }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    const tmpIdx = new Int32Array(deg[n]);
    const fillPos = deg.slice(0, n);
    for (let i = 0; i < n; i++) {
      for (let p = rp[i]; p < rp[i + 1]; p++) {
        const j = ci[p];
        if (j !== i) { tmpIdx[fillPos[i]++] = j; tmpIdx[fillPos[j]++] = i; }
      }
    }
    const adjPtr = new Int32Array(n + 1);
    const adjBuf = new Int32Array(tmpIdx.length);
    let adjLen = 0;
    const seen = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      adjPtr[i] = adjLen;
      for (let p = deg[i]; p < deg[i + 1]; p++) {
        const j = tmpIdx[p];
        if (seen[j] !== i) { seen[j] = i; adjBuf[adjLen++] = j; }
      }
    }
    adjPtr[n] = adjLen;
    const adjIdx = adjBuf.slice(0, adjLen);

    const perm = new Int32Array(n);
    let outPos = 0;
    const LEAF = this.leafSize || 120;
    const mark = new Int32Array(n).fill(-1);
    const level = new Int32Array(n).fill(-1);
    let stamp = 0;

    // Exact minimum degree on a small node subset
    const minDegreeLeaf = (nodes) => {
      const local = new Map();
      for (const v of nodes) local.set(v, new Set());
      for (const v of nodes) {
        for (let p = adjPtr[v]; p < adjPtr[v + 1]; p++) {
          const u = adjIdx[p];
          if (local.has(u)) local.get(v).add(u);
        }
      }
      const remaining = new Set(nodes);
      while (remaining.size > 0) {
        let best = -1;
        let bestDeg = Infinity;
        for (const v of remaining) {
          const d = local.get(v).size;
          if (d < bestDeg) { bestDeg = d; best = v; }
        }
        const nb = Array.from(local.get(best));
        for (const u of nb) local.get(u).delete(best);
        for (let a = 0; a < nb.length; a++) {
          for (let b = a + 1; b < nb.length; b++) {
            local.get(nb[a]).add(nb[b]);
            local.get(nb[b]).add(nb[a]);
          }
        }
        remaining.delete(best);
        perm[outPos++] = best;
      }
    };

    // BFS inside the current subgraph (nodes stamped mark===myStamp)
    const bfs = (start, myStamp, order) => {
      order.length = 0;
      order.push(start);
      level[start] = 0;
      let head = 0;
      while (head < order.length) {
        const v = order[head++];
        for (let p = adjPtr[v]; p < adjPtr[v + 1]; p++) {
          const u = adjIdx[p];
          if (mark[u] === myStamp && level[u] === -1) {
            level[u] = level[v] + 1;
            order.push(u);
          }
        }
      }
    };

    const dissect = (nodes) => {
      const size = nodes.length;
      if (size === 0) return;
      if (size <= LEAF) { minDegreeLeaf(nodes); return; }

      const myStamp = ++stamp;
      for (const v of nodes) { mark[v] = myStamp; level[v] = -1; }

      const order = [];
      bfs(nodes[0], myStamp, order);
      if (order.length < size) {
        // disconnected subgraph: split off the first component and recurse independently
        const comp = order.slice();
        const compSet = new Set(comp);
        const rest = nodes.filter(v => !compSet.has(v));
        for (const v of nodes) level[v] = -1;
        dissect(comp);
        dissect(rest);
        return;
      }
      // second sweep from the farthest node approximates a pseudo-peripheral start
      let far = order[order.length - 1];
      for (const v of nodes) level[v] = -1;
      bfs(far, myStamp, order);
      far = order[order.length - 1];
      const maxLevel = level[far];
      if (maxLevel < 2) { minDegreeLeaf(nodes); return; }

      const levelCount = new Int32Array(maxLevel + 1);
      for (const v of nodes) levelCount[level[v]]++;
      // separator level: smallest level whose midpoint lies within 35%..65% of total mass
      let cum = 0;
      let best = -1;
      let bestSize = Infinity;
      for (let l = 0; l <= maxLevel; l++) {
        const before = cum;
        cum += levelCount[l];
        const frac = (before + levelCount[l] / 2) / size;
        if (frac >= 0.35 && frac <= 0.65 && l > 0 && l < maxLevel && levelCount[l] < bestSize) {
          bestSize = levelCount[l];
          best = l;
        }
      }
      if (best === -1) best = Math.max(1, Math.min(maxLevel - 1, Math.floor(maxLevel / 2)));

      const left = [];
      const right = [];
      const sep = [];
      for (const v of nodes) {
        const l = level[v];
        if (l < best) left.push(v);
        else if (l > best) right.push(v);
        else sep.push(v);
      }
      for (const v of nodes) level[v] = -1;
      dissect(left);
      dissect(right);
      for (const v of sep) perm[outPos++] = v;
    };

    const all = new Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    dissect(all);

    this.permutation = perm;
    this.invPermutation = new Int32Array(n);
    for (let i = 0; i < n; i++) this.invPermutation[perm[i]] = i;
    return perm;
  }

  /**
   * Sparse up-looking Cholesky factorization  P*A*P^T = L*L^T.
   * @returns {Object} Real factorization metrics (nnz(L), fill ratio, flops, time)
   */
  factorize() {
    const t0 = Date.now();
    if (!this.rowPtr) this.finalizeCSR();
    if (!this.permutation) this.computeAMDOrdering();

    const n = this.n;
    const inv = this.invPermutation;

    // Permuted upper-triangular CSC pattern C = triu(P A P^T)
    const cCount = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const pi = inv[i];
      for (let p = this.rowPtr[i]; p < this.rowPtr[i + 1]; p++) {
        const pj = inv[this.colIdx[p]];
        if (pi <= pj) cCount[pj + 1]++;
      }
    }
    for (let j = 0; j < n; j++) cCount[j + 1] += cCount[j];
    const Cp = cCount;
    const Ci = new Int32Array(Cp[n]);
    const Cx = new Float64Array(Cp[n]);
    const cFill = Cp.slice(0, n);
    for (let i = 0; i < n; i++) {
      const pi = inv[i];
      for (let p = this.rowPtr[i]; p < this.rowPtr[i + 1]; p++) {
        const pj = inv[this.colIdx[p]];
        if (pi <= pj) {
          const q = cFill[pj]++;
          Ci[q] = pi;
          Cx[q] = this.values[p];
        }
      }
    }

    // Elimination tree
    const parent = new Int32Array(n).fill(-1);
    const ancestor = new Int32Array(n).fill(-1);
    for (let k = 0; k < n; k++) {
      for (let p = Cp[k]; p < Cp[k + 1]; p++) {
        let i = Ci[p];
        while (i !== -1 && i < k) {
          const next = ancestor[i];
          ancestor[i] = k;
          if (next === -1) parent[i] = k;
          i = next;
        }
      }
    }

    const w = new Int32Array(n).fill(-1);
    const s = new Int32Array(n);
    // nonzero pattern of row k of L is written to s[top..n-1]
    const ereach = (k) => {
      let top = n;
      w[k] = k;
      for (let p = Cp[k]; p < Cp[k + 1]; p++) {
        let i = Ci[p];
        if (i > k) continue;
        let len = 0;
        while (w[i] !== k) {
          s[len++] = i;
          w[i] = k;
          i = parent[i];
        }
        while (len > 0) s[--top] = s[--len];
      }
      return top;
    };

    // Symbolic: exact column counts of L (including diagonal)
    const colCount = new Int32Array(n).fill(1);
    for (let k = 0; k < n; k++) {
      const top = ereach(k);
      for (let t = top; t < n; t++) colCount[s[t]]++;
    }
    w.fill(-1);

    const Lp = new Int32Array(n + 1);
    for (let j = 0; j < n; j++) Lp[j + 1] = Lp[j] + colCount[j];
    const nnzL = Lp[n];
    const Li = new Int32Array(nnzL);
    const Lx = new Float64Array(nnzL);
    const cnext = Lp.slice(0, n);

    // Numeric up-looking Cholesky
    const x = new Float64Array(n);
    let flops = 0;
    for (let k = 0; k < n; k++) {
      const top = ereach(k);
      x[k] = 0.0;
      for (let p = Cp[k]; p < Cp[k + 1]; p++) {
        if (Ci[p] <= k) x[Ci[p]] = Cx[p];
      }
      let d = x[k];
      x[k] = 0.0;
      for (let t = top; t < n; t++) {
        const i = s[t];
        const lki = x[i] / Lx[Lp[i]];
        x[i] = 0.0;
        for (let p = Lp[i] + 1; p < cnext[i]; p++) {
          x[Li[p]] -= Lx[p] * lki;
        }
        flops += 2 * (cnext[i] - Lp[i]);
        d -= lki * lki;
        const q = cnext[i]++;
        Li[q] = k;
        Lx[q] = lki;
      }
      if (!(d > 0.0)) {
        throw new Error(`Matrix is not symmetric positive definite (non-positive pivot at step ${k})`);
      }
      const q = cnext[k]++;
      Li[q] = k;
      Lx[q] = Math.sqrt(d);
    }

    this.Lp = Lp;
    this.Li = Li;
    this.Lx = Lx;
    this.nnzL = nnzL;
    this.factorized = true;

    const nnzUpper = Cp[n];
    return {
      dimension: n,
      nonZeros: this.nnz,
      nnzL,
      fillInRatio: nnzUpper > 0 ? nnzL / nnzUpper : 1.0,
      estimatedFlops: flops,
      amdOrderingUsed: true,
      factorizationMs: Date.now() - t0
    };
  }

  /**
   * Solves A * x = b via sparse forward and backward substitution.
   * @param {Float64Array|Array<number>} b
   * @returns {Object} Solution vector and residual metrics
   */
  solve(b) {
    if (!this.factorized) this.factorize();
    const n = this.n;
    const { Lp, Li, Lx, permutation } = this;

    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = b[permutation[i]];

    // Forward: L z = y (column-oriented)
    for (let j = 0; j < n; j++) {
      y[j] /= Lx[Lp[j]];
      const yj = y[j];
      for (let p = Lp[j] + 1; p < Lp[j + 1]; p++) {
        y[Li[p]] -= Lx[p] * yj;
      }
    }
    // Backward: L^T x = z
    for (let j = n - 1; j >= 0; j--) {
      let sum = y[j];
      for (let p = Lp[j] + 1; p < Lp[j + 1]; p++) {
        sum -= Lx[p] * y[Li[p]];
      }
      y[j] = sum / Lx[Lp[j]];
    }

    const sol = new Float64Array(n);
    for (let i = 0; i < n; i++) sol[permutation[i]] = y[i];

    let resSq = 0.0;
    let bSq = 0.0;
    for (let i = 0; i < n; i++) {
      let Ax = 0.0;
      for (let p = this.rowPtr[i]; p < this.rowPtr[i + 1]; p++) {
        Ax += this.values[p] * sol[this.colIdx[p]];
      }
      const r = b[i] - Ax;
      resSq += r * r;
      bSq += b[i] * b[i];
    }
    const resNorm = Math.sqrt(resSq);
    const relRes = resNorm / (Math.sqrt(bSq) || 1.0);

    return {
      solution: sol,
      residualNorm: resNorm,
      relativeResidual: relRes,
      converged: relRes < 1e-8
    };
  }

  /**
   * Alias for solve(b).solution
   */
  solveRhs(b) {
    return this.solve(b).solution;
  }

  denseToCSR(denseMatrix) {
    const n = denseMatrix.length;
    const m = denseMatrix[0].length;
    const solver = new WasmSparseMultifrontalSolver(n, m);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        if (Math.abs(denseMatrix[i][j]) > 1e-15) {
          solver.addEntry(i, j, denseMatrix[i][j]);
        }
      }
    }
    solver.finalizeCSR();
    return solver;
  }

  solveCholesky(csrOrSolver, b) {
    const solver = csrOrSolver instanceof WasmSparseMultifrontalSolver ? csrOrSolver : this;
    const res = solver.solve(b);
    return res.solution;
  }
}

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WasmSparseMultifrontalSolver };
}
if (typeof window !== 'undefined') {
  window.WasmSparseMultifrontalSolver = WasmSparseMultifrontalSolver;
}
