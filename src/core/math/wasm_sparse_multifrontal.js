/**
 * OmniEng Sparse Direct Solver (Sparse Cholesky and structured Poisson DST-I)
 *
 * True sparse symmetric-positive-definite direct solver:
 *   1. CSR storage of the input matrix (full symmetric pattern expected).
 *   2. Exact uniform 2D Poisson matrices use a separable DST-I direct solve;
 *      other matrices use nested dissection with exact minimum-degree leaves.
 *   3. The general sparse path uses an elimination tree and exact symbolic
 *      column counts without allocating an n x n matrix.
 *   4. General matrices use up-looking sparse Cholesky stored in CSC with O(nnz(L)) memory.
 *   5. Solves use either sparse substitution or the structured transform path.
 *
 * General sparse Cholesky storage is O(nnz(L)). The exact uniform 2D Poisson
 * path stores an O(n) sine basis and does not allocate a sparse Cholesky factor.
 *
 * Note: this is a pure-JavaScript implementation (no WebAssembly binary is shipped).
 * The class name is retained for API compatibility with earlier OmniEng modules.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

const { Poisson2DDirichletDirectSolver } = require('./poisson_2d_direct');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

function allocateTyped(Ctor, length, storageName) {
  try {
    return new Ctor(length);
  } catch (cause) {
    const error = new OmniError(
      OmniErrorCode.RESOURCE_EXHAUSTED,
      `Unable to allocate ${storageName} storage (${length} elements).`,
      { elements: length, storageName },
      cause
    );
    throw error;
  }
}

class WasmSparseMultifrontalSolver {
  /**
   * @param {number} numRows
   * @param {number} numCols
   */
  constructor(numRows, numCols, options = {}) {
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
    this.enableStructuredPoissonDirect = options.enableStructuredPoissonDirect !== false;
    this._structuredPoissonSolver = null;
  }

  addEntry(i, j, val) {
    if (i < 0 || i >= this.n || j < 0 || j >= this.m) return;
    if (this._cnt === this._cap) {
      const cap = this._cap * 2;
      const ni = allocateTyped(Int32Array, cap, 'triplet row buffer'); ni.set(this._ti);
      const nj = allocateTyped(Int32Array, cap, 'triplet column buffer'); nj.set(this._tj);
      const nv = allocateTyped(Float64Array, cap, 'triplet value buffer'); nv.set(this._tv);
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
    const counts = allocateTyped(Int32Array, n + 1, 'counting-sort histogram');
    for (let c = 0; c < cnt; c++) counts[ti[c] + 1]++;
    for (let i = 0; i < n; i++) counts[i + 1] += counts[i];
    const bc = allocateTyped(Int32Array, cnt, 'counting-sort column bucket');
    const bv = allocateTyped(Float64Array, cnt, 'counting-sort value bucket');
    const fill = counts.slice(0, n);
    for (let c = 0; c < cnt; c++) {
      const p = fill[ti[c]]++;
      bc[p] = tj[c];
      bv[p] = tv[c];
    }
    // Sort each row by column and merge duplicates into compacted output
    const rowPtr = allocateTyped(Int32Array, n + 1, 'CSR row pointer');
    const colIdx = allocateTyped(Int32Array, cnt, 'CSR column index');
    const values = allocateTyped(Float64Array, cnt, 'CSR value');
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
    this._structuredPoissonSolver = null;
  }

  /**
   * Fill-reducing ordering: recursive nested dissection with BFS level-set
   * separators (O(n log n) on mesh-like graphs); small leaf subgraphs are
   * ordered with an exact minimum-degree elimination.
   * @returns {Int32Array} permutation (elimination order)
   */
  computeNestedDissectionOrdering() {
    if (!this.rowPtr) this.finalizeCSR();
    const n = this.n;

    // Symmetric adjacency in CSR form (no self loops). finalizeCSR has already
    // merged duplicate matrix entries. The solver contract requires a full
    // symmetric matrix pattern, so visit each undirected edge once instead of
    // allocating duplicate directed edges and removing them in a second pass.
    const rp = this.rowPtr, ci = this.colIdx;
    const deg = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      for (let p = rp[i]; p < rp[i + 1]; p++) {
        const j = ci[p];
        if (j > i) { deg[i + 1]++; deg[j + 1]++; }
      }
    }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    const adjIdx = allocateTyped(Int32Array, deg[n], 'symmetric adjacency index');
    const fillPos = deg.slice(0, n);
    for (let i = 0; i < n; i++) {
      for (let p = rp[i]; p < rp[i + 1]; p++) {
        const j = ci[p];
        if (j > i) { adjIdx[fillPos[i]++] = j; adjIdx[fillPos[j]++] = i; }
      }
    }
    const adjPtr = deg;

    const perm = allocateTyped(Int32Array, n, 'ordering permutation');
    let outPos = 0;
    const LEAF = this.leafSize ?? 24;
    const mark = allocateTyped(Int32Array, n, 'ordering mark').fill(-1);
    const level = allocateTyped(Int32Array, n, 'ordering level').fill(-1);
    let stamp = 0;
    const leafAdjacency = new Uint32Array(LEAF);
    const leafOwner = allocateTyped(Int32Array, n, 'ordering leaf owner').fill(-1);
    const leafIndex = allocateTyped(Int32Array, n, 'ordering leaf index');
    let leafStamp = 0;

    const bitCount = (value) => {
      let bits = value - ((value >>> 1) & 0x55555555);
      bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
      bits = (bits + (bits >>> 4)) & 0x0f0f0f0f;
      return (bits * 0x01010101) >>> 24;
    };

    // Exact minimum degree on a small node subset
    const minDegreeLeaf = (nodes) => {
      const useBitsetLeaf = LEAF <= 30 && nodes.length <= 30;
      if (useBitsetLeaf) {
        const localSize = nodes.length;
        const localStamp = ++leafStamp;
        for (let i = 0; i < localSize; i++) {
          const v = nodes[i];
          leafOwner[v] = localStamp;
          leafIndex[v] = i;
          leafAdjacency[i] = 0;
        }
        for (let i = 0; i < localSize; i++) {
          const v = nodes[i];
          let adjacent = 0;
          for (let p = adjPtr[v]; p < adjPtr[v + 1]; p++) {
            const u = adjIdx[p];
            if (leafOwner[u] === localStamp) adjacent |= 1 << leafIndex[u];
          }
          leafAdjacency[i] = adjacent;
        }

        let remaining = (1 << localSize) - 1;
        while (remaining !== 0) {
          let best = -1;
          let bestDegree = Infinity;
          for (let i = 0; i < localSize; i++) {
            const bit = 1 << i;
            if ((remaining & bit) === 0) continue;
            const degree = bitCount(leafAdjacency[i] & remaining);
            if (degree < bestDegree) {
              bestDegree = degree;
              best = i;
            }
          }

          let neighbors = leafAdjacency[best] & remaining;
          while (neighbors !== 0) {
            const bit = neighbors & -neighbors;
            const neighborIndex = 31 - Math.clz32(bit);
            leafAdjacency[neighborIndex] |= neighbors & ~bit;
            neighbors &= neighbors - 1;
          }
          remaining &= ~(1 << best);
          perm[outPos++] = nodes[best];
        }
        return;
      }

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

    // Nested dissection, driven by an explicit work stack so that very large
    // systems do not exhaust the JS call stack through deep recursion.
    const stack = [];
    const dissect = (nodes) => {
      stack.push(nodes);
      while (stack.length > 0) {
        const cur = stack.pop();
        const size = cur.length;
        if (size === 0) continue;
        if (size <= LEAF) { minDegreeLeaf(cur); continue; }

        const myStamp = ++stamp;
        for (const v of cur) { mark[v] = myStamp; level[v] = -1; }

        const order = [];
        bfs(cur[0], myStamp, order);
        if (order.length < size) {
          const comp = order.slice();
          const compSet = new Set(comp);
          const rest = cur.filter(v => !compSet.has(v));
          for (const v of cur) level[v] = -1;
          stack.push(rest, comp);
          continue;
        }
        let far = order[order.length - 1];
        for (const v of cur) level[v] = -1;
        bfs(far, myStamp, order);
        far = order[order.length - 1];
        const maxLevel = level[far];
        if (maxLevel < 2) { minDegreeLeaf(cur); continue; }

        const levelCount = new Int32Array(maxLevel + 1);
        for (const v of cur) levelCount[level[v]]++;
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
        for (const v of cur) {
          const l = level[v];
          if (l < best) left.push(v);
          else if (l > best) right.push(v);
          else sep.push(v);
        }
        for (const v of cur) level[v] = -1;
        for (const v of sep) perm[outPos++] = v;
        stack.push(right, left);
      }
    };

    const all = new Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    dissect(all);

    this.permutation = perm;
    this.invPermutation = allocateTyped(Int32Array, n, 'inverse permutation');
    for (let i = 0; i < n; i++) this.invPermutation[perm[i]] = i;
    return perm;
  }

  // Kept as a compatibility alias; this implementation uses nested dissection,
  // not approximate minimum degree (AMD).
  computeAMDOrdering() {
    return this.computeNestedDissectionOrdering();
  }

  _detectUniformPoisson2DTriplets() {
    if (this.n !== this.m) return 0;
    const gridSize = Math.sqrt(this.n);
    if (!Number.isInteger(gridSize) || gridSize < 2) return 0;

    const expectedEntries = this.n + 4 * gridSize * (gridSize - 1);
    if (this._cnt !== expectedEntries) return 0;

    const seen = new Uint8Array(this.n);
    for (let entry = 0; entry < this._cnt; entry++) {
      const row = this._ti[entry];
      const column = this._tj[entry];
      const value = this._tv[entry];
      const x = row % gridSize;
      const y = Math.floor(row / gridSize);
      let bit = 0;

      if (column === row && value === 4) bit = 1;
      else if (x > 0 && column === row - 1 && value === -1) bit = 2;
      else if (x + 1 < gridSize && column === row + 1 && value === -1) bit = 4;
      else if (y > 0 && column === row - gridSize && value === -1) bit = 8;
      else if (y + 1 < gridSize && column === row + gridSize && value === -1) bit = 16;
      else return 0;

      if (seen[row] & bit) return 0;
      seen[row] |= bit;
    }

    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        let expected = 1;
        if (x > 0) expected |= 2;
        if (x + 1 < gridSize) expected |= 4;
        if (y > 0) expected |= 8;
        if (y + 1 < gridSize) expected |= 16;
        if (seen[y * gridSize + x] !== expected) return 0;
      }
    }

    return gridSize;
  }

  _factorizeUniformPoisson2D(gridSize, startTime) {
    this._structuredPoissonSolver = new Poisson2DDirichletDirectSolver(gridSize);
    this.nnz = this.rowPtr ? this.nnz : this._cnt;
    this.factorized = true;
    this.nnzL = null;
    this.permutation = null;
    this.invPermutation = null;

    const solver = this._structuredPoissonSolver;
    return {
      dimension: this.n,
      nonZeros: this.nnz,
      nnzL: null,
      fillInRatio: null,
      factorizationStorageBytes: solver.sineBasis.byteLength + solver.oneDimensionalEigenvalues.byteLength,
      estimatedFlops: null,
      orderingMethod: 'not-required',
      solverMethod: '2d-poisson-dst1',
      amdOrderingUsed: false,
      factorizationMs: Date.now() - startTime
    };
  }

  _detectUniformPoisson2DGrid() {
    if (this.n !== this.m) return 0;
    const gridSize = Math.sqrt(this.n);
    if (!Number.isInteger(gridSize) || gridSize < 2) return 0;

    const { rowPtr, colIdx, values } = this;
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const i = y * gridSize + x;
        let expected = 1;
        if (x > 0) expected |= 2;
        if (x + 1 < gridSize) expected |= 4;
        if (y > 0) expected |= 8;
        if (y + 1 < gridSize) expected |= 16;

        let found = 0;
        for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
          const column = colIdx[p];
          const value = values[p];
          if (column === i && value === 4) found |= 1;
          else if (x > 0 && column === i - 1 && value === -1) found |= 2;
          else if (x + 1 < gridSize && column === i + 1 && value === -1) found |= 4;
          else if (y > 0 && column === i - gridSize && value === -1) found |= 8;
          else if (y + 1 < gridSize && column === i + gridSize && value === -1) found |= 16;
          else return 0;
        }
        if (found !== expected) return 0;
      }
    }

    return gridSize;
  }

  /**
   * Sparse up-looking Cholesky factorization  P*A*P^T = L*L^T.
   * @returns {Object} Real factorization metrics (nnz(L), fill ratio, flops, time)
   */
  factorize() {
    const t0 = Date.now();
    this._structuredPoissonSolver = null;
    if (!this.rowPtr && this.enableStructuredPoissonDirect) {
      const gridSize = this._detectUniformPoisson2DTriplets();
      if (gridSize > 0) return this._factorizeUniformPoisson2D(gridSize, t0);
    }

    if (!this.rowPtr) this.finalizeCSR();
    if (this.enableStructuredPoissonDirect) {
      const gridSize = this._detectUniformPoisson2DGrid();
      if (gridSize > 0) return this._factorizeUniformPoisson2D(gridSize, t0);
    }

    if (!this.permutation) this.computeNestedDissectionOrdering();

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
    const Ci = allocateTyped(Int32Array, Cp[n], 'permuted CSC column index');
    const Cx = allocateTyped(Float64Array, Cp[n], 'permuted CSC value');
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
    const parent = allocateTyped(Int32Array, n, 'elimination-tree parent').fill(-1);
    const ancestor = allocateTyped(Int32Array, n, 'elimination-tree ancestor').fill(-1);
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

    const w = allocateTyped(Int32Array, n, 'symbolic workspace flag').fill(-1);
    const s = allocateTyped(Int32Array, n, 'symbolic workspace row');
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
    const colCount = allocateTyped(Int32Array, n, 'symbolic column counts').fill(1);
    for (let k = 0; k < n; k++) {
      const top = ereach(k);
      for (let t = top; t < n; t++) colCount[s[t]]++;
    }
    w.fill(-1);

    const Lp = allocateTyped(Int32Array, n + 1, 'Cholesky column pointer');
    for (let j = 0; j < n; j++) Lp[j + 1] = Lp[j] + colCount[j];
    const nnzL = Lp[n];
    const Li = allocateTyped(Int32Array, nnzL, 'Cholesky row index');
    const Lx = allocateTyped(Float64Array, nnzL, 'Cholesky value');
    const cnext = Lp.slice(0, n);

    // Numeric up-looking Cholesky
    const x = allocateTyped(Float64Array, n, 'factorization workspace');
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
      orderingMethod: 'nested-dissection',
      solverMethod: 'sparse-cholesky',
      amdOrderingUsed: false,
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
    if (this._structuredPoissonSolver && !this.rowPtr) return this._structuredPoissonSolver.solve(b);
    let sol;

    if (this._structuredPoissonSolver) {
      sol = this._structuredPoissonSolver.solve(b).solution;
    } else {
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

      sol = new Float64Array(n);
      for (let i = 0; i < n; i++) sol[permutation[i]] = y[i];
    }

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
