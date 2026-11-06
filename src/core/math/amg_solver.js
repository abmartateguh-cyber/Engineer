'use strict';

/**
 * OmniEng AMG + Krylov subspace solver engine.
 *
 * Deterministic, dependency-free pure-JavaScript sparse linear algebra
 * (Math.* + typed arrays only). Provides:
 *
 *   - SparseCSR: compressed sparse row storage with matvec / transpose-matvec.
 *   - Algebraic Multigrid (AMG) with two coarsening strategies:
 *       * 'rs' — classic Ruge-Stüben coarsening (strong connections by C/F
 *         splitting via a two-pass selection, direct interpolation),
 *       * 'sa' — Smoothed Aggregation (greedy aggregation, tentative
 *         piecewise-constant prolongator damped by one Jacobi smoothing
 *         step with omega = 4/(3*rho(D^-1 A)), rho estimated by a seeded
 *         power iteration).
 *     Both support V-cycles and W-cycles with symmetric Gauss-Seidel
 *     (forward + backward) smoothing and a dense partial-pivoting LU solve
 *     on the coarsest level.
 *   - solveBiCGSTAB: preconditioned BiCGSTAB for non-symmetric systems.
 *   - solveGMRES: restarted GMRES(m) with Givens rotations for non-symmetric
 *     systems.
 *
 * All choices are deterministic: no Math.random anywhere; the only seeded
 * generator is used for the SA spectral-radius power iteration.
 */

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function l2Norm(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s);
}

// ---------------------------------------------------------------------------
// Sparse CSR storage
// ---------------------------------------------------------------------------

class SparseCSR {
  /**
   * @param {number} n dimension (square matrix)
   * @param {Int32Array} rowptr length n+1
   * @param {Int32Array} colind column indices (length nnz)
   * @param {Float64Array} values (length nnz)
   */
  constructor(n, rowptr, colind, values) {
    if (!Number.isInteger(n) || n < 0) throw new RangeError('n must be a non-negative integer.');
    if (rowptr.length !== n + 1) {
      throw new RangeError(`rowptr must have length n+1 (got ${rowptr.length}, expected ${n + 1}).`);
    }
    const nnz = rowptr[n];
    if (colind.length !== nnz || values.length !== nnz) {
      throw new RangeError('colind/values must match nnz.');
    }
    this.n = n;
    this.nnz = nnz;
    this.rowptr = rowptr;
    this.colind = colind;
    this.values = values;
    let maxCol = -1;
    for (let k = 0; k < nnz; k++) {
      if (colind[k] > maxCol) maxCol = colind[k];
    }
    this.cols = maxCol + 1;
    const diag = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let k = rowptr[i]; k < rowptr[i + 1]; k++) {
        if (colind[k] === i) {
          diag[i] = values[k];
          break;
        }
      }
    }
    this.diag = diag;
  }

  /**
   * Build a CSR matrix from an array of rows, each row being an array of
   * [column, value] pairs. @param colCount optional validation of the total
   * column count.
   */
  static fromRows(n, rows, colCount) {
    let nnz = 0;
    for (let i = 0; i < n; i++) nnz += rows[i].length;
    const rowptr = new Int32Array(n + 1);
    const colind = new Int32Array(nnz);
    const values = new Float64Array(nnz);
    let p = 0;
    for (let i = 0; i < n; i++) {
      rowptr[i] = p;
      const row = rows[i];
      for (let k = 0; k < row.length; k++) {
        const c = row[k][0];
        if (colCount !== undefined && (c < 0 || c >= colCount)) {
          throw new RangeError(`column ${c} out of range 0..${colCount - 1}.`);
        }
        colind[p] = c;
        values[p] = row[k][1];
        p++;
      }
    }
    rowptr[n] = nnz;
    const M = new SparseCSR(n, rowptr, colind, values);
    if (colCount !== undefined) M.cols = colCount;
    return M;
  }

  /** A * x -> new Float64Array. */
  matvec(x) {
    const n = this.n;
    const y = new Float64Array(n);
    this.matvecInto(x, y);
    return y;
  }

  /** y = A * x (y must have length n). */
  matvecInto(x, y) {
    const rowptr = this.rowptr;
    const colind = this.colind;
    const values = this.values;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = rowptr[i]; k < rowptr[i + 1]; k++) s += values[k] * x[colind[k]];
      y[i] = s;
    }
    return y;
  }

  /** A^T * x -> new Float64Array. */
  transposeMatvec(x) {
    const n = this.n;
    const y = new Float64Array(n);
    this.transposeMatvecInto(x, y);
    return y;
  }

  /** y = A^T * x. */
  transposeMatvecInto(x, y) {
    const rowptr = this.rowptr;
    const colind = this.colind;
    const values = this.values;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const xi = x[i];
      for (let k = rowptr[i]; k < rowptr[i + 1]; k++) y[colind[k]] += values[k] * xi;
    }
    return y;
  }

  /** Entry (i, j), 0 when absent. Row scan is fine (rows are tiny). */
  get(i, j) {
    const rowptr = this.rowptr;
    const colind = this.colind;
    const values = this.values;
    for (let k = rowptr[i]; k < rowptr[i + 1]; k++) {
      if (colind[k] === j) return values[k];
    }
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Symmetric Gauss-Seidel smoothing (forward + backward sweeps)
// ---------------------------------------------------------------------------

function gsSweep(A, b, x) {
  const n = A.n;
  const rowptr = A.rowptr;
  const colind = A.colind;
  const values = A.values;
  const diag = A.diag;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = rowptr[i]; k < rowptr[i + 1]; k++) {
      const j = colind[k];
      if (j !== i) s += values[k] * x[j];
    }
    x[i] = (b[i] - s) / diag[i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = 0;
    for (let k = rowptr[i]; k < rowptr[i + 1]; k++) {
      const j = colind[k];
      if (j !== i) s += values[k] * x[j];
    }
    x[i] = (b[i] - s) / diag[i];
  }
}

function gsSweeps(A, b, x, sweeps) {
  for (let s = 0; s < sweeps; s++) gsSweep(A, b, x);
}

// ---------------------------------------------------------------------------
// Strong connection graph
// ---------------------------------------------------------------------------

/**
 * Strong connections S_i = { j != i : |a_ij| >= theta * max_k |a_ik| }.
 * Returns { strong, stInv } where strong[i] is the ascending list of points
 * i strongly influences and stInv[j] is the ascending list of points that
 * strongly influence j.
 */
function strongAdjacency(A, theta) {
  const n = A.n;
  const rowptr = A.rowptr;
  const colind = A.colind;
  const values = A.values;
  const strong = new Array(n);
  const stInv = new Array(n);
  for (let i = 0; i < n; i++) {
    stInv[i] = [];
    let mx = 0;
    for (let k = rowptr[i]; k < rowptr[i + 1]; k++) {
      const j = colind[k];
      if (j !== i) {
        const a = Math.abs(values[k]);
        if (a > mx) mx = a;
      }
    }
    if (mx <= 0) {
      strong[i] = [];
    } else {
      const lst = [];
      for (let k = rowptr[i]; k < rowptr[i + 1]; k++) {
        const j = colind[k];
        if (j !== i && Math.abs(values[k]) >= theta * mx) lst.push(j);
      }
      strong[i] = lst;
    }
  }
  for (let i = 0; i < n; i++) {
    const si = strong[i];
    for (let t = 0; t < si.length; t++) stInv[si[t]].push(i);
  }
  return { strong, stInv };
}

// ---------------------------------------------------------------------------
// Ruge-Stüben C/F splitting
// ---------------------------------------------------------------------------

/**
 * Classic Ruge-Stüben coarsening.
 *
 * Pass 1: repeatedly select the undecided point with the largest number of
 * undecided strong influences (measure), make it a C-point, and mark all of
 * its undecided strong influences as F-points. Measures are maintained
 * incrementally with a bucket queue (lazy removal).
 *
 * Pass 2: every F-point must have at least one strong C-neighbor so direct
 * interpolation is well defined; otherwise promote its strongest F-neighbor
 * to C. Repeated until fixpoint (bounded passes).
 *
 * Returns { state, strong } where state is Int8Array (1 = C, 2 = F).
 */
function rugeStubenSplitting(A, theta) {
  const { strong, stInv } = strongAdjacency(A, theta);
  const n = A.n;
  const state = new Int8Array(n); // 0 undecided, 1 C, 2 F
  const measure = new Int32Array(n);
  let maxM = 0;
  for (let i = 0; i < n; i++) {
    measure[i] = stInv[i].length;
    if (measure[i] > maxM) maxM = measure[i];
  }
  const buckets = new Array(maxM + 1);
  for (let m = 0; m <= maxM; m++) buckets[m] = [];
  for (let i = 0; i < n; i++) buckets[measure[i]].push(i);

  let top = maxM;
  let active = n;
  while (active > 0) {
    while (top >= 0 && buckets[top].length === 0) top--;
    if (top < 0) break;
    const i = buckets[top].pop();
    if (state[i] !== 0 || measure[i] !== top) continue; // stale bucket entry
    state[i] = 1;
    active--;
    const fMarked = [];
    for (let t = 0; t < stInv[i].length; t++) {
      const j = stInv[i][t];
      if (state[j] === 0) {
        state[j] = 2;
        active--;
        fMarked.push(j);
      }
    }
    // i left the undecided set: drop the measure of every undecided point i
    // strongly influences.
    for (let t = 0; t < strong[i].length; t++) {
      const k = strong[i][t];
      if (state[k] === 0) {
        measure[k]--;
        buckets[measure[k]].push(k);
      }
    }
    // freshly marked F-points also left the undecided set.
    for (let u = 0; u < fMarked.length; u++) {
      const j = fMarked[u];
      for (let t = 0; t < strong[j].length; t++) {
        const k = strong[j][t];
        if (state[k] === 0) {
          measure[k]--;
          buckets[measure[k]].push(k);
        }
      }
    }
  }

  // Second pass: ensure every F-point has a strong C-neighbor.
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (let f = 0; f < n; f++) {
      if (state[f] !== 2) continue;
      let hasC = false;
      const sf = strong[f];
      for (let t = 0; t < sf.length; t++) {
        if (state[sf[t]] === 1) {
          hasC = true;
          break;
        }
      }
      if (hasC) continue;
      let best = -1;
      let bestVal = 0;
      for (let t = 0; t < sf.length; t++) {
        const j = sf[t];
        if (state[j] === 2) {
          const a = Math.abs(A.get(f, j));
          if (a > bestVal) {
            bestVal = a;
            best = j;
          }
        }
      }
      if (best >= 0) {
        state[best] = 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Third pass: F-points with at most one strong C-neighbor but plenty of
  // strong F-neighbors get promoted to C, increasing C density and giving
  // the interpolation operator much better coverage (improves the two-grid
  // convergence factor).
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (let f = 0; f < n; f++) {
      if (state[f] !== 2) continue;
      let c = 0;
      let fCnt = 0;
      const sf = strong[f];
      for (let t = 0; t < sf.length; t++) {
        const j = sf[t];
        if (state[j] === 1) c++;
        else if (state[j] === 2) fCnt++;
      }
      if (c <= 1 && fCnt >= 1) {
        state[f] = 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { state, strong };
}

// ---------------------------------------------------------------------------
// Interpolation operators
// ---------------------------------------------------------------------------

function strongIndexIn(list, j) {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] === j) return true;
    if (list[mid] < j) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/**
 * Direct interpolation: for an F-point f,
 *   P[f, c] = -(a_fc + sum_{d in D_f} a_fd * a_dc / (sum_{m in C_d} a_dm)) / a_ff
 * with C_f = all C-neighbors, D_f = strong F-neighbors. C rows are identity
 * rows.
 */
function buildDirectInterpolation(A, state, strong) {
  const n = A.n;
  const cLocal = new Int32Array(n);
  cLocal.fill(-1);
  let nc = 0;
  for (let i = 0; i < n; i++) {
    if (state[i] === 1) cLocal[i] = nc++;
  }
  const cdSum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const si = strong[i];
    for (let t = 0; t < si.length; t++) {
      const j = si[t];
      if (state[j] === 1) s += A.get(i, j);
    }
    cdSum[i] = s;
  }
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = [];
    if (state[i] === 1) {
      row.push([cLocal[i], 1]);
    } else {
      const diag = A.diag[i];
      if (diag === 0) {
        rows[i] = row;
        continue;
      }
      const si = strong[i];
      const Cf = [];
      const Df = [];
      // Interpolate from every C-neighbor (strong or not) so constants are
      // well represented; the D_f correction term only involves strong F
      // neighbors.
      for (let k = A.rowptr[i]; k < A.rowptr[i + 1]; k++) {
        const j = A.colind[k];
        if (j === i) continue;
        if (state[j] === 1) Cf.push(j);
        else if (state[j] === 2 && strongIndexIn(si, j)) Df.push(j);
      }
      if (Cf.length === 0) {
        // Fallback: interpolate from every C point the row touches.
        for (let k = A.rowptr[i]; k < A.rowptr[i + 1]; k++) {
          const c = A.colind[k];
          if (state[c] === 1) row.push([cLocal[c], -A.values[k] / diag]);
        }
      } else if (Df.length === 0) {
        for (let t = 0; t < Cf.length; t++) {
          const c = Cf[t];
          row.push([cLocal[c], -A.get(i, c) / diag]);
        }
      } else {
        const dDenom = new Float64Array(Df.length);
        for (let t = 0; t < Df.length; t++) {
          dDenom[t] = cdSum[Df[t]] !== 0 ? cdSum[Df[t]] : 1;
        }
        for (let t = 0; t < Cf.length; t++) {
          const c = Cf[t];
          let w = -A.get(i, c) / diag;
          for (let u = 0; u < Df.length; u++) {
            const d = Df[u];
            w -= (A.get(i, d) * A.get(d, c)) / (diag * dDenom[u]);
          }
          if (Math.abs(w) > 1e-15) row.push([cLocal[c], w]);
        }
      }
    }
    row.sort((p, q) => p[0] - q[0]);
    rows[i] = row;
  }
  return SparseCSR.fromRows(n, rows, nc);
}

/**
 * Smoothed Aggregation prolongator: greedy aggregation (root point plus its
 * strong connections), tentative piecewise-constant T, one Jacobi smoothing
 * step P = (I - omega D^-1 A) T with omega = 4/(3 rho(D^-1 A)).
 */
function buildSmoothedAggregation(A, theta) {
  const { strong } = strongAdjacency(A, theta);
  const n = A.n;
  const agg = new Int32Array(n);
  agg.fill(-1);
  let nc = 0;
  for (let i = 0; i < n; i++) {
    if (agg[i] >= 0) continue;
    agg[i] = nc;
    const si = strong[i];
    for (let t = 0; t < si.length; t++) {
      const j = si[t];
      if (agg[j] < 0) agg[j] = nc;
    }
    nc++;
  }
  // Seeded power iteration on D^-1 A for the spectral-radius estimate.
  const rng = mulberry32(20241104);
  const v = new Float64Array(n);
  let nv = 0;
  for (let i = 0; i < n; i++) {
    v[i] = rng() * 2 - 1;
    nv += v[i] * v[i];
  }
  nv = Math.sqrt(nv);
  for (let i = 0; i < n; i++) v[i] /= nv;
  const w = new Float64Array(n);
  let rho = 1;
  for (let it = 0; it < 12; it++) {
    A.matvecInto(v, w);
    for (let i = 0; i < n; i++) w[i] /= A.diag[i] || 1;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += w[i] * v[i];
      den += v[i] * v[i];
    }
    rho = Math.max(Math.abs(num / den), 1e-12);
    let nw = 0;
    for (let i = 0; i < n; i++) nw += w[i] * w[i];
    nw = Math.sqrt(nw) || 1;
    for (let i = 0; i < n; i++) v[i] = w[i] / nw;
  }
  const omega = Math.min(4 / (3 * rho), 1.5);
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Map();
    row.set(agg[i], 1);
    const invd = 1 / (A.diag[i] || 1);
    for (let k = A.rowptr[i]; k < A.rowptr[i + 1]; k++) {
      const c = agg[A.colind[k]];
      if (c >= 0) row.set(c, (row.get(c) || 0) - omega * A.values[k] * invd);
    }
    const out = [];
    row.forEach((value, c) => {
      if (Math.abs(value) > 1e-13) out.push([c, value]);
    });
    out.sort((p, q) => p[0] - q[0]);
    rows[i] = out;
  }
  return SparseCSR.fromRows(n, rows, nc);
}

// ---------------------------------------------------------------------------
// Galerkin coarse-grid operator: A_c = P^T A P
// ---------------------------------------------------------------------------

function galerkinProduct(A, P) {
  const n = A.n;
  const nc = P.cols;
  // Step 1: AP = A * P as sparse rows.
  const apRows = new Array(n);
  const stamp = new Int32Array(nc);
  stamp.fill(-1);
  let serial = 0;
  for (let i = 0; i < n; i++) {
    serial++;
    const cols = [];
    const tmp = [];
    for (let k = A.rowptr[i]; k < A.rowptr[i + 1]; k++) {
      const j = A.colind[k];
      const av = A.values[k];
      for (let t = P.rowptr[j]; t < P.rowptr[j + 1]; t++) {
        const c = P.colind[t];
        const pv = P.values[t];
        if (stamp[c] !== serial) {
          stamp[c] = serial;
          tmp[c] = av * pv;
          cols.push(c);
        } else {
          tmp[c] += av * pv;
        }
      }
    }
    const row = new Array(cols.length);
    for (let q = 0; q < cols.length; q++) {
      const c = cols[q];
      row[q] = [c, tmp[c]];
    }
    row.sort((p, q) => p[0] - q[0]);
    apRows[i] = row;
  }
  // Step 2: A_c = P^T * AP.
  const acRaw = new Array(nc);
  for (let c = 0; c < nc; c++) acRaw[c] = [];
  for (let i = 0; i < n; i++) {
    const arow = apRows[i];
    if (arow.length === 0) continue;
    for (let t = P.rowptr[i]; t < P.rowptr[i + 1]; t++) {
      const c = P.colind[t];
      const pv = P.values[t];
      const dest = acRaw[c];
      for (let s = 0; s < arow.length; s++) {
        dest.push([arow[s][0], pv * arow[s][1]]);
      }
    }
  }
  const rows = new Array(nc);
  for (let c = 0; c < nc; c++) {
    const raw = acRaw[c];
    if (raw.length === 0) {
      rows[c] = [];
      continue;
    }
    raw.sort((p, q) => p[0] - q[0]);
    const out = [];
    let last = raw[0][0];
    let acc = raw[0][1];
    for (let k = 1; k < raw.length; k++) {
      const d = raw[k][0];
      const v = raw[k][1];
      if (d === last) {
        acc += v;
      } else {
        out.push([last, acc]);
        last = d;
        acc = v;
      }
    }
    out.push([last, acc]);
    rows[c] = out;
  }
  return SparseCSR.fromRows(nc, rows);
}

// ---------------------------------------------------------------------------
// Dense LU solve (coarsest level), partial pivoting
// ---------------------------------------------------------------------------

function denseSolve(A, b) {
  const n = A.n;
  const M = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let k = A.rowptr[i]; k < A.rowptr[i + 1]; k++) {
      M[i * n + A.colind[k]] = A.values[k];
    }
  }
  const y = Float64Array.from(b);
  for (let k = 0; k < n; k++) {
    let p = k;
    let pv = Math.abs(M[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const a = Math.abs(M[i * n + k]);
      if (a > pv) {
        pv = a;
        p = i;
      }
    }
    if (p !== k) {
      for (let j = k; j < n; j++) {
        const t = M[k * n + j];
        M[k * n + j] = M[p * n + j];
        M[p * n + j] = t;
      }
      const t = y[k];
      y[k] = y[p];
      y[p] = t;
    }
    const pivot = M[k * n + k];
    if (pivot === 0) continue;
    for (let i = k + 1; i < n; i++) {
      const f = M[i * n + k] / pivot;
      M[i * n + k] = f;
      for (let j = k + 1; j < n; j++) M[i * n + j] -= f * M[k * n + j];
      y[i] -= f * y[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let j = i + 1; j < n; j++) s -= M[i * n + j] * x[j];
    x[i] = M[i * n + i] !== 0 ? s / M[i * n + i] : s;
  }
  return x;
}

// ---------------------------------------------------------------------------
// AMG solver
// ---------------------------------------------------------------------------

class AMGSolver {
  /**
   * @param {SparseCSR} A
   * @param {object} opts { type: 'rs'|'sa', theta, thetaAgg, coarseSize,
   *   maxLevels, cycle: 'V'|'W', nuPre, nuPost }
   */
  constructor(A, opts) {
    const o = Object.assign(
      {
        type: 'sa',
        theta: 0.25,
        thetaAgg: 0.05,
        coarseSize: 32,
        maxLevels: 16,
        cycle: 'V',
        nuPre: 1,
        nuPost: 1
      },
      opts || {}
    );
    this.opts = o;
    this.A = A;
    this.levels = []; // { A, P }
    let cur = A;
    let guard = 0;
    while (cur.n > o.coarseSize && guard < o.maxLevels) {
      guard++;
      let P;
      if (o.type === 'sa') {
        P = buildSmoothedAggregation(cur, o.thetaAgg);
      } else {
        const { state, strong } = rugeStubenSplitting(cur, o.theta);
        P = buildDirectInterpolation(cur, state, strong);
      }
      if (P.nc >= cur.n || P.nc === 0) break;
      const Ac = galerkinProduct(cur, P);
      this.levels.push({ A: cur, P });
      cur = Ac;
    }
    this.coarseA = cur;
    // Preallocated per-level workspaces reused across cycles (recursion is
    // strictly nested, so one set per level suffices even for W-cycles).
    this._ws = [];
    for (let lvl = 0; lvl < this.levels.length; lvl++) {
      const { A, P } = this.levels[lvl];
      this._ws.push({
        r: new Float64Array(A.n),
        rc: new Float64Array(P.cols),
        ec: new Float64Array(P.cols)
      });
    }
  }

  /** One cycle (V or W) with x initialized to x0 (default zeros). */
  apply(b, x0) {
    const n = this.A.n;
    const x = x0 ? Float64Array.from(x0) : new Float64Array(n);
    this._cycle(0, b, x);
    return x;
  }

  _cycle(lvl, b, x) {
    const L = this.levels.length;
    if (lvl === L) {
      x.set(denseSolve(this.coarseA, b));
      return;
    }
    const { A, P } = this.levels[lvl];
    const n = A.n;
    const o = this.opts;
    gsSweeps(A, b, x, o.nuPre);
    const ws = this._ws[lvl];
    const r = ws.r;
    A.matvecInto(x, r);
    for (let i = 0; i < n; i++) r[i] = b[i] - r[i];
    const rc = ws.rc;
    rc.fill(0);
    P.transposeMatvecInto(r, rc);
    const ec = ws.ec;
    ec.fill(0);
    this._cycle(lvl + 1, rc, ec);
    if (o.cycle === 'W') this._cycle(lvl + 1, rc, ec);
    P.matvecInto(ec, r);
    for (let i = 0; i < n; i++) x[i] += r[i];
    gsSweeps(A, b, x, o.nuPost);
  }
}

// ---------------------------------------------------------------------------
// BiCGSTAB
// ---------------------------------------------------------------------------

/**
 * Preconditioned BiCGSTAB. opts: { maxIt, tol, precon, x0 }.
 * precon is an object with apply(b) -> solution of M y = b.
 * Returns { solution, iterations, converged, relativeResidual, matvecs }.
 */
function solveBiCGSTAB(A, b, opts) {
  const o = Object.assign({ maxIt: 2000, tol: 1e-10 }, opts || {});
  const n = A.n;
  const x = o.x0 ? Float64Array.from(o.x0) : new Float64Array(n);
  const precon = o.precon || null;
  const r = new Float64Array(n);
  A.matvecInto(x, r);
  for (let i = 0; i < n; i++) r[i] = b[i] - r[i];
  const bNorm = l2Norm(b) || 1;
  let rel = l2Norm(r) / bNorm;
  if (rel < o.tol) {
    return { solution: x, iterations: 0, converged: true, relativeResidual: rel, matvecs: 1 };
  }
  const rhat = Float64Array.from(r);
  const p = new Float64Array(n);
  const v = new Float64Array(n);
  const s = new Float64Array(n);
  const t = new Float64Array(n);
  const ph = new Float64Array(n);
  const sh = new Float64Array(n);
  let rho = 1;
  let rhoPrev = 1;
  let alpha = 1;
  let omega = 1;
  let matvecs = 1;
  let iterations = 0;
  for (let it = 1; it <= o.maxIt; it++) {
    iterations = it;
    let rhoNew = 0;
    for (let i = 0; i < n; i++) rhoNew += rhat[i] * r[i];
    if (rhoNew === 0) break;
    const beta = (rhoNew / rhoPrev) * (alpha / omega);
    for (let i = 0; i < n; i++) {
      p[i] = r[i] + beta * (p[i] - omega * v[i]);
    }
    if (precon) {
      ph.set(precon.apply(p));
    } else {
      ph.set(p);
    }
    A.matvecInto(ph, v);
    matvecs++;
    let denom = 0;
    for (let i = 0; i < n; i++) denom += rhat[i] * v[i];
    if (denom === 0) break;
    alpha = rhoNew / denom;
    for (let i = 0; i < n; i++) s[i] = r[i] - alpha * v[i];
    let sNorm = l2Norm(s);
    if (sNorm / bNorm < o.tol) {
      for (let i = 0; i < n; i++) x[i] += alpha * ph[i];
      A.matvecInto(x, r);
      matvecs++;
      rel = l2Norm(r) / bNorm;
      for (let i = 0; i < n; i++) r[i] = b[i] - r[i];
      rel = l2Norm(r) / bNorm;
      if (rel < o.tol) break;
    }
    if (precon) {
      sh.set(precon.apply(s));
    } else {
      sh.set(s);
    }
    A.matvecInto(sh, t);
    matvecs++;
    let tdot = 0;
    for (let i = 0; i < n; i++) tdot += t[i] * t[i];
    if (tdot === 0) break;
    let ts = 0;
    for (let i = 0; i < n; i++) ts += t[i] * s[i];
    omega = ts / tdot;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * ph[i] + omega * sh[i];
      r[i] = s[i] - omega * t[i];
    }
    rel = l2Norm(r) / bNorm;
    if (rel < o.tol) break;
    rhoPrev = rhoNew;
    if (omega === 0) break;
  }
  if (rel > o.tol) {
    A.matvecInto(x, r);
    matvecs++;
    for (let i = 0; i < n; i++) r[i] = b[i] - r[i];
    rel = l2Norm(r) / bNorm;
  }
  return {
    solution: x,
    iterations,
    converged: rel < o.tol,
    relativeResidual: rel,
    matvecs
  };
}

// ---------------------------------------------------------------------------
// Restarted GMRES(m) with Givens rotations
// ---------------------------------------------------------------------------

/**
 * opts: { restart, maxIt (total Arnoldi steps), tol, precon, x0 }.
 * Returns { solution, iterations (Arnoldi steps), restarts, converged,
 * relativeResidual, matvecs }.
 */
function solveGMRES(A, b, opts) {
  const o = Object.assign({ restart: 30, maxIt: 1000, tol: 1e-10 }, opts || {});
  const n = A.n;
  const m = o.restart;
  const x = o.x0 ? Float64Array.from(o.x0) : new Float64Array(n);
  const precon = o.precon || null;
  const bNorm = l2Norm(b) || 1;
  const V = new Float64Array(n * (m + 1));
  const H = new Float64Array((m + 1) * m);
  const g = new Float64Array(m + 1);
  const cs = new Float64Array(m);
  const sn = new Float64Array(m);
  const y = new Float64Array(m);
  const r = new Float64Array(n);
  const w = new Float64Array(n);
  let matvecs = 0;
  let iterations = 0;
  let restarts = 0;
  let rel = Infinity;

  while (iterations < o.maxIt) {
    A.matvecInto(x, r);
    matvecs++;
    for (let i = 0; i < n; i++) r[i] = b[i] - r[i];
    rel = l2Norm(r) / bNorm;
    if (rel < o.tol) break;
    const beta = l2Norm(r);
    const v0 = V.subarray(0, n);
    for (let i = 0; i < n; i++) v0[i] = r[i] / beta;
    g.fill(0);
    g[0] = beta;
    let k = -1;
    for (let j = 0; j < m; j++) {
      k = j;
      const vj = V.subarray(j * n, (j + 1) * n);
      let z = vj;
      if (precon) {
        z = new Float64Array(n);
        z.set(precon.apply(vj));
      }
      A.matvecInto(z, w);
      matvecs++;
      for (let i = 0; i <= j; i++) {
        const vi = V.subarray(i * n, (i + 1) * n);
        let d = 0;
        for (let q = 0; q < n; q++) d += vi[q] * w[q];
        H[i * m + j] = d;
        for (let q = 0; q < n; q++) w[q] -= d * vi[q];
      }
      let hnext = l2Norm(w);
      H[(j + 1) * m + j] = hnext;
      if (hnext > 1e-300) {
        const vj1 = V.subarray((j + 1) * n, (j + 2) * n);
        for (let q = 0; q < n; q++) vj1[q] = w[q] / hnext;
      }
      // Apply previous Givens rotations to the new column.
      for (let i = 0; i < j; i++) {
        const tmp = cs[i] * H[i * m + j] + sn[i] * H[(i + 1) * m + j];
        H[(i + 1) * m + j] = -sn[i] * H[i * m + j] + cs[i] * H[(i + 1) * m + j];
        H[i * m + j] = tmp;
      }
      // Compute the current rotation.
      const a = H[j * m + j];
      const c = H[(j + 1) * m + j];
      const denom = Math.hypot(a, c);
      if (denom === 0) {
        cs[j] = 1;
        sn[j] = 0;
        H[(j + 1) * m + j] = 0;
      } else {
        cs[j] = a / denom;
        sn[j] = c / denom;
        H[j * m + j] = denom;
        H[(j + 1) * m + j] = 0;
      }
      const gtmp = cs[j] * g[j];
      g[j + 1] = -sn[j] * g[j];
      g[j] = gtmp;
      const resEst = Math.abs(g[j + 1]) / bNorm;
      if (resEst <= o.tol) break;
    }
    // Solve the small upper-triangular system.
    for (let i = k; i >= 0; i--) {
      let s = g[i];
      for (let j = i + 1; j <= k; j++) s -= H[i * m + j] * y[j];
      y[i] = H[i * m + i] !== 0 ? s / H[i * m + i] : s;
    }
    for (let j = 0; j <= k; j++) {
      const vj = V.subarray(j * n, (j + 1) * n);
      const yj = y[j];
      for (let q = 0; q < n; q++) x[q] += yj * vj[q];
    }
    iterations += k + 1;
    if (rel < o.tol) break;
    restarts++;
  }
  if (rel > o.tol) {
    A.matvecInto(x, r);
    matvecs++;
    for (let i = 0; i < n; i++) r[i] = b[i] - r[i];
    rel = l2Norm(r) / bNorm;
  }
  return {
    solution: x,
    iterations,
    restarts,
    converged: rel < o.tol,
    relativeResidual: rel,
    matvecs
  };
}

module.exports = {
  SparseCSR,
  AMGSolver,
  solveBiCGSTAB,
  solveGMRES,
  l2Norm,
  rugeStubenSplitting,
  strongAdjacency,
  buildDirectInterpolation,
  buildSmoothedAggregation,
  galerkinProduct
};
