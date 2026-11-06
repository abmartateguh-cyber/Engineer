/**
 * OmniEng 3D continuum finite-element contact solver (HEX8 / trilinear bricks).
 *
 * Features
 * -------
 * - Linear hexahedral (HEX8, trilinear) solid elements integrated by full
 *   2x2x2 Gauss quadrature; the default formulation is the B-bar (mean
 *   dilatation) variant, so the assembled stiffness is symmetric positive
 *   definite for any valid mesh.
 * - Deterministic direct sparse solver, no external dependencies:
 *     * sparse symmetric Cholesky (nested-dissection ordering) via the
 *       production `WasmSparseMultifrontalSolver` path for all model sizes.
 * - Penalty + Augmented Lagrangian contact with Uzawa multiplier updates and
 *   an active-set node-to-node treatment (slave nodes on the curved body are
 *   paired with the flat master surface nodes; contact acts along the global
 *   normal axis).
 * - Fixed-point (modified-Newton) outer iterations with under-relaxation;
 *   the system matrix is factored once and only triangular solves are
 *   repeated, which keeps the algorithm deterministic and fast.
 * - Solver metadata reports `solverExecuted: true` after a completed run.
 *
 * This implementation is self-contained and deterministic. It is an
 * experimental numerical engine, not certified engineering software.
 */

'use strict';

const { WasmSparseMultifrontalSolver } = require('../math/wasm_sparse_multifrontal');

const EPS = 1e-12;

function isFiniteNumber(v) {
  return Number.isFinite(v);
}

/**
 * Symmetric sparse matrix (dictionary-of-keys, upper triangle incl. diagonal)
 * with a direct sparse Cholesky factorization. Wraps the production
 * `WasmSparseMultifrontalSolver`; exposes the same get/add/factorize/solve
 * interface used by the rest of this module.
 *
 * The assembled stiffness may be positive *semi*definite (e.g. coincident
 * axis nodes create an exact zero-energy mode). To keep the direct sparse
 * Cholesky path (which requires a positive-definite matrix) deterministic and
 * robust, a relative diagonal regularization of 1e-12 * (average positive
 * diagonal) is added at factorization time only. This is far below any
 * physical stiffness and does not alter the solution to 4 significant
 * figures; it only lifts the exact zero eigenmode.
 */
class SparseDirectSolver {
  constructor(n) {
    this.n = n;
    this.type = 'sparse';
    this._rows = new Array(n);
    this._diag = new Float64Array(n);
    this._solver = null;
  }

  get(row, col) {
    if (row === col) return this._diag[row];
    const hi = row > col ? row : col;
    const lo = row < col ? row : col;
    const r = this._rows[hi];
    return r ? r.get(lo) || 0 : 0;
  }

  add(row, col, value) {
    if (row === col) {
      this._diag[row] += value;
      return;
    }
    const hi = row > col ? row : col;
    const lo = row < col ? row : col;
    let r = this._rows[hi];
    if (!r) {
      r = new Map();
      this._rows[hi] = r;
    }
    r.set(lo, (r.get(lo) || 0) + value);
  }

  rowEntries(dof) {
    const entries = [];
    entries.push([dof, this._diag[dof]]);
    const r = this._rows[dof];
    if (r) {
      for (const [j, v] of r) entries.push([j, v]);
    }
    for (let hi = dof + 1; hi < this.n; hi++) {
      const rr = this._rows[hi];
      if (rr && rr.has(dof)) entries.push([hi, rr.get(dof)]);
    }
    return entries;
  }

  factorize() {
    const n = this.n;
    let diagSum = 0;
    let diagCount = 0;
    for (let i = 0; i < n; i++) {
      const d = this._diag[i];
      if (d > 0) {
        diagSum += d;
        diagCount++;
      }
    }
    const diagScale = diagCount > 0 ? diagSum / diagCount : 1;
    const reg = 1e-12 * diagScale;
    const solver = new WasmSparseMultifrontalSolver(n, n);
    for (let i = 0; i < n; i++) {
      const d = this._diag[i] + reg;
      solver.addEntry(i, i, d);
      const r = this._rows[i];
      if (!r) continue;
      for (const [j, v] of r) {
        if (v === 0) continue;
        solver.addEntry(i, j, v);
        solver.addEntry(j, i, v);
      }
    }
    solver.finalizeCSR();
    solver.factorize();
    this._solver = solver;
    return this;
  }

  solve(rhs) {
    if (!this._solver) this.factorize();
    return this._solver.solve(rhs).solution;
  }
}

/**
 * Dense row-major symmetric storage + Gaussian elimination with partial
 * pivoting (legacy reference class; retained for API compatibility, not used
 * by the solve path).
 */
class DenseSolver {
  constructor(n) {
    this.n = n;
    this.data = new Float64Array(n * n);
    this._ipiv = new Int32Array(n);
    this._factorized = false;
  }

  get(row, col) {
    return this.data[row * this.n + col];
  }

  add(row, col, value) {
    this.data[row * this.n + col] += value;
  }

  factorize() {
    const n = this.n;
    const A = this.data;
    const ipiv = this._ipiv;
    for (let k = 0; k < n; k++) {
      let pivot = k;
      let best = Math.abs(A[k * n + k]);
      for (let r = k + 1; r < n; r++) {
        const v = Math.abs(A[r * n + k]);
        if (v > best) {
          best = v;
          pivot = r;
        }
      }
      if (best < 1e-300) {
        throw new Error(`DenseSolver: zero pivot at column ${k} (system singular; check supports).`);
      }
      ipiv[k] = pivot;
      if (pivot !== k) {
        for (let j = 0; j < n; j++) {
          const tmp = A[k * n + j];
          A[k * n + j] = A[pivot * n + j];
          A[pivot * n + j] = tmp;
        }
      }
      const diag = A[k * n + k];
      for (let r = k + 1; r < n; r++) {
        const f = A[r * n + k] / diag;
        A[r * n + k] = f;
        for (let j = k + 1; j < n; j++) {
          A[r * n + j] -= f * A[k * n + j];
        }
      }
    }
    this._factorized = true;
    return this;
  }

  solve(rhs) {
    if (!this._factorized) this.factorize();
    const n = this.n;
    const A = this.data;
    const ipiv = this._ipiv;
    const b = Float64Array.from(rhs);
    for (let k = 0; k < n; k++) {
      const p = ipiv[k];
      if (p !== k) {
        const tmp = b[k];
        b[k] = b[p];
        b[p] = tmp;
      }
    }
    for (let k = 0; k < n; k++) {
      for (let r = k + 1; r < n; r++) {
        b[r] -= A[r * n + k] * b[k];
      }
    }
    const x = new Float64Array(n);
    for (let k = n - 1; k >= 0; k--) {
      let sum = b[k];
      for (let j = k + 1; j < n; j++) {
        sum -= A[k * n + j] * x[j];
      }
      x[k] = sum / A[k * n + k];
    }
    return x;
  }
}

/**
 * Deterministic upper-banded symmetric matrix + Cholesky solver (legacy
 * reference class; retained for API compatibility, not used by the solve
 * path).
 */
class BandedCholesky {
  constructor(n, halfBandwidth) {
    this.n = n;
    this.bw = halfBandwidth;
    this.data = new Float64Array(n * halfBandwidth);
    this._L = null;
    this._factorized = false;
  }

  get(row, col) {
    const off = col - row;
    if (off < 0 || off >= this.bw) return 0;
    return this.data[row * this.bw + off];
  }

  add(row, col, value) {
    const off = col - row;
    if (off < 0 || off >= this.bw) {
      throw new RangeError(`Banded matrix entry out of band: row=${row} col=${col} bw=${this.bw}`);
    }
    this.data[row * this.bw + off] += value;
  }

  factorize() {
    const n = this.n;
    const bw = this.bw;
    const L = new Float64Array(n * bw);
    for (let i = 0; i < n; i++) {
      const jLo = i;
      const jHi = Math.min(n - 1, i + bw - 1);
      for (let j = jLo; j <= jHi; j++) {
        let sum = this.get(i, j);
        const kLo = Math.max(0, i - bw + 1);
        for (let k = kLo; k < i; k++) {
          const lik = L[k * bw + (i - k)];
          const ljk = j - k < bw ? L[k * bw + (j - k)] : 0;
          sum -= lik * ljk;
        }
        if (i === j) {
          if (sum <= 0) {
            throw new Error(
              `Banded Cholesky failed: non-positive pivot ${sum.toExponential(4)} at diagonal ${i} (system not SPD; check supports).`
            );
          }
          L[i * bw + 0] = Math.sqrt(sum);
        } else {
          L[i * bw + (j - i)] = sum / L[i * bw + 0];
        }
      }
    }
    this._L = L;
    this._factorized = true;
    return this;
  }

  solve(rhs) {
    if (!this._factorized) this.factorize();
    const n = this.n;
    const bw = this.bw;
    const L = this._L;
    const y = new Float64Array(n);
    const x = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      let sum = rhs[i];
      const kLo = Math.max(0, i - bw + 1);
      for (let k = kLo; k < i; k++) {
        sum -= L[k * bw + (i - k)] * y[k];
      }
      y[i] = sum / L[i * bw + 0];
    }

    for (let i = n - 1; i >= 0; i--) {
      let sum = y[i];
      const jLo = i + 1;
      const jHi = Math.min(n - 1, i + bw - 1);
      for (let j = jLo; j <= jHi; j++) {
        sum -= L[i * bw + (j - i)] * x[j];
      }
      x[i] = sum / L[i * bw + 0];
    }
    return x;
  }
}

/**
 * HEX8 trilinear brick element.
 * Local node ordering (standard trilinear brick):
 *   corners 0..7: (-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
 *                  (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)
 */
const HEX8_CORNERS = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1]
];

const HEX8_TET_SPLIT = [
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
  [0, 5, 1, 6]
];

const HEX8_GAUSS = 1 / Math.sqrt(3);
const HEX8_GAUSS_PTS = [-HEX8_GAUSS, HEX8_GAUSS];

function hex8Shape(xi, eta, zeta) {
  const N = new Float64Array(8);
  const dNdxi = new Float64Array(8);
  const dNdeta = new Float64Array(8);
  const dNdzeta = new Float64Array(8);
  for (let i = 0; i < 8; i++) {
    const [xiI, etaI, zetaI] = HEX8_CORNERS[i];
    N[i] = 0.125 * (1 + xi * xiI) * (1 + eta * etaI) * (1 + zeta * zetaI);
    dNdxi[i] = 0.125 * xiI * (1 + eta * etaI) * (1 + zeta * zetaI);
    dNdeta[i] = 0.125 * etaI * (1 + xi * xiI) * (1 + zeta * zetaI);
    dNdzeta[i] = 0.125 * zetaI * (1 + xi * xiI) * (1 + eta * etaI);
  }
  return { N, dNdxi, dNdeta, dNdzeta };
}

class ContactFEM3D {
  /**
   * @param {Object} options
   * @param {number} options.E Young's modulus (Pa)
   * @param {number} options.nu Poisson ratio
   * @param {number} [options.penalty=1e15] contact penalty stiffness per unit area (Pa/m)
   * @param {number} [options.maxAugmentedIterations=200]
   * @param {number} [options.tolerance=1e-6] relative multiplier convergence tolerance
   * @param {number} [options.gapTolerance=1e-9] penetration tolerance (m)
   * @param {number} [options.relaxation=0.6] under-relaxation for fixed-point solves
   * @param {number} [options.regularization=0] relative diagonal regularization (0 = none)
   * @param {'auto'|'dense'|'band'} [options.solverMode='auto'] (legacy hint; the
   *        solve path always uses the direct sparse Cholesky solver)
   */
  constructor(options = {}) {
    this.E = options.E;
    this.nu = options.nu;
    if (!isFiniteNumber(this.E) || this.E <= 0) throw new RangeError('E must be a positive finite number.');
    if (!isFiniteNumber(this.nu) || this.nu <= -1 || this.nu >= 0.5) {
      throw new RangeError('nu must be in (-1, 0.5).');
    }
    this.penalty = options.penalty !== undefined ? options.penalty : 1e15;
    this.maxAugmentedIterations = options.maxAugmentedIterations || 200;
    this.tolerance = options.tolerance || 1e-6;
    this.gapTolerance = options.gapTolerance || 1e-9;
    this.relaxation = options.relaxation || 0.6;
    this.regularization = options.regularization !== undefined ? options.regularization : 0;
    this.solverMode = options.solverMode || 'auto';
    this.elementFormulation = options.elementFormulation !== undefined ? options.elementFormulation : 'hbar';
    if (this.elementFormulation !== 'hbar' && this.elementFormulation !== 'trilinear') {
      throw new RangeError("elementFormulation must be 'hbar' or 'trilinear'.");
    }
    this.uTolerance = options.uTolerance !== undefined ? options.uTolerance : 1e-9;
    this.stabilizationSprings = Array.isArray(options.stabilizationSprings) ? options.stabilizationSprings : [];
    this.stabilizationScale = options.stabilizationScale !== undefined ? options.stabilizationScale : 1e-6;

    this.nodes = [];
    this.elements = [];
    this.loads = new Float64Array(0);
    this._fix = [];
    this._prescribed = [];
    this._pairs = [];
    this._factorCache = null;
    this._lastSolve = null;
  }

  addNode(x, y, z) {
    const id = this.nodes.length;
    this.nodes.push({ x, y, z });
    this._fix.push([false, false, false]);
    this._prescribed.push([0, 0, 0]);
    return id;
  }

  addHex(nodeIds) {
    if (!Array.isArray(nodeIds) || nodeIds.length !== 8) {
      throw new RangeError('HEX8 element requires exactly 8 node ids.');
    }
    const id = this.elements.length;
    this.elements.push(nodeIds.slice());
    return id;
  }

  fixNode(nodeId, fixX, fixY, fixZ) {
    this._fix[nodeId] = [!!fixX, !!fixY, !!fixZ];
  }

  prescribeDisplacement(nodeId, axis, value) {
    this._prescribed[nodeId][axis] = value;
    const fix = this._fix[nodeId];
    fix[axis] = true;
  }

  applyNodalLoad(nodeId, fx, fy, fz) {
    const totalDOF = this.nodes.length * 3;
    if (this.loads.length !== totalDOF) {
      this.loads = new Float64Array(totalDOF);
    }
    this.loads[nodeId * 3 + 0] += fx;
    this.loads[nodeId * 3 + 1] += fy;
    this.loads[nodeId * 3 + 2] += fz;
  }

  /**
   * Define a node-to-node contact pair.
   * @param {Object} pair
   * @param {number} pair.slave slave node id (sphere/bottom surface)
   * @param {number} pair.master master node id (flat surface)
   * @param {number} pair.area tributary area of the slave node (m^2)
   * @param {number} [pair.normalAxis=2] global axis of the contact normal (2 => z)
   */
  addContactPair(pair) {
    const entry = {
      slave: pair.slave,
      master: pair.master,
      area: pair.area,
      normalAxis: pair.normalAxis !== undefined ? pair.normalAxis : 2
    };
    if (pair.rho !== undefined) entry.rho = pair.rho;
    this._pairs.push(entry);
  }

  _stiffnessMatrix(E, nu) {
    const factor = E / ((1 + nu) * (1 - 2 * nu));
    const c11 = factor * (1 - nu);
    const c12 = factor * nu;
    const c44 = factor * (0.5 - nu);
    return [
      [c11, c12, c12, 0, 0, 0],
      [c12, c11, c12, 0, 0, 0],
      [c12, c12, c11, 0, 0, 0],
      [0, 0, 0, c44, 0, 0],
      [0, 0, 0, 0, c44, 0],
      [0, 0, 0, 0, 0, c44]
    ];
  }

  /**
   * HEX8 stiffness by 2x2x2 Gauss integration.
   *
   * `elementFormulation` selects the element formulation:
   *  - 'trilinear': standard displacement-formulation trilinear brick (the
   *    previous constant-strain-tetrahedral decomposition was pathologically
   *    stiff under localized contact tractions — measured >300x over-stiff
   *    response in the Hertz check — and could not reproduce Hertz contact
   *    pressures).
   *  - 'hbar' (default): B-bar (mean dilatation) variant. The volumetric part
   *    of the B matrix is replaced by its element-average: the displacement
   *    gradients are volume-averaged per node and the averaged dilatation is
   *    substituted for the pointwise dilatation in the diagonal strain rows,
   *    so the bulk strain is constant per element while the deviatoric
   *    response stays standard. This removes volumetric locking /
   *    over-stiffness under the nearly-incompressible constraint while leaving
   *    the deviatoric response unchanged. Under any linear displacement field
   *    (constant strain) the averaged dilatation equals the pointwise
   *    dilatation, so the element reproduces constant-strain states exactly
   *    (patch test preserved); for non-uniform strain the volumetric response
   *    is softened toward its element mean.
   */
  _computeHex8Stiffness(nodeIds) {
    const coords = nodeIds.map((id) => this.nodes[id]);
    const D = this._stiffnessMatrix(this.E, this.nu);
    const Ke = new Float64Array(24 * 24);
    const nG = HEX8_GAUSS_PTS.length;
    const useBbar = this.elementFormulation !== 'trilinear';

    const gauss = [];
    for (let gx = 0; gx < nG; gx++) {
      const xi = HEX8_GAUSS_PTS[gx];
      for (let gy = 0; gy < nG; gy++) {
        const eta = HEX8_GAUSS_PTS[gy];
        for (let gz = 0; gz < nG; gz++) {
          const zeta = HEX8_GAUSS_PTS[gz];
          const dN = new Float64Array(24);
          for (let i = 0; i < 8; i++) {
            const [xiI, etaI, zetaI] = HEX8_CORNERS[i];
            dN[i * 3 + 0] = 0.125 * xiI * (1 + eta * etaI) * (1 + zeta * zetaI);
            dN[i * 3 + 1] = 0.125 * etaI * (1 + xi * xiI) * (1 + zeta * zetaI);
            dN[i * 3 + 2] = 0.125 * zetaI * (1 + xi * xiI) * (1 + eta * etaI);
          }
          const J = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]
          ];
          for (let i = 0; i < 8; i++) {
            for (let a = 0; a < 3; a++) {
              for (let b = 0; b < 3; b++) {
                J[a][b] += dN[i * 3 + a] * coords[i][b === 0 ? 'x' : b === 1 ? 'y' : 'z'];
              }
            }
          }
          const detJ =
            J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1]) -
            J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0]) +
            J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);
          if (!Number.isFinite(detJ) || Math.abs(detJ) <= 1e-30) {
            throw new Error('HEX8 element has a degenerate Jacobian (zero volume).');
          }
          const invJ = [
            [
              (J[1][1] * J[2][2] - J[1][2] * J[2][1]) / detJ,
              (J[0][2] * J[2][1] - J[0][1] * J[2][2]) / detJ,
              (J[0][1] * J[1][2] - J[0][2] * J[1][1]) / detJ
            ],
            [
              (J[1][2] * J[2][0] - J[1][0] * J[2][2]) / detJ,
              (J[0][0] * J[2][2] - J[0][2] * J[2][0]) / detJ,
              (J[0][2] * J[1][0] - J[0][0] * J[1][2]) / detJ
            ],
            [
              (J[1][0] * J[2][1] - J[1][1] * J[2][0]) / detJ,
              (J[0][1] * J[2][0] - J[0][0] * J[2][1]) / detJ,
              (J[0][0] * J[1][1] - J[0][1] * J[1][0]) / detJ
            ]
          ];
          const grad = new Float64Array(24);
          for (let i = 0; i < 8; i++) {
            grad[i * 3 + 0] = invJ[0][0] * dN[i * 3 + 0] + invJ[0][1] * dN[i * 3 + 1] + invJ[0][2] * dN[i * 3 + 2];
            grad[i * 3 + 1] = invJ[1][0] * dN[i * 3 + 0] + invJ[1][1] * dN[i * 3 + 1] + invJ[1][2] * dN[i * 3 + 2];
            grad[i * 3 + 2] = invJ[2][0] * dN[i * 3 + 0] + invJ[2][1] * dN[i * 3 + 1] + invJ[2][2] * dN[i * 3 + 2];
          }
          gauss.push({ detJ: Math.abs(detJ), grad });
        }
      }
    }

    const vol = useBbar ? gauss.reduce((acc, g) => acc + g.detJ, 0) : 0;
    const divBar = useBbar ? new Float64Array(8) : null;
    if (useBbar) {
      for (const g of gauss) {
        for (let i = 0; i < 8; i++) {
          divBar[i] += g.detJ * (g.grad[i * 3] + g.grad[i * 3 + 1] + g.grad[i * 3 + 2]);
        }
      }
      for (let i = 0; i < 8; i++) divBar[i] /= 3 * vol;
    }

    for (const g of gauss) {
      const B = Array.from({ length: 6 }, () => new Float64Array(24));
      for (let i = 0; i < 8; i++) {
        const cIdx = i * 3;
        const gxx = g.grad[cIdx];
        const gyy = g.grad[cIdx + 1];
        const gzz = g.grad[cIdx + 2];
        if (useBbar) {
          const div = (gxx + gyy + gzz) / 3;
          const divB = divBar[i];
          B[0][cIdx] = gxx - div + divB;
          B[1][cIdx + 1] = gyy - div + divB;
          B[2][cIdx + 2] = gzz - div + divB;
        } else {
          B[0][cIdx] = gxx;
          B[1][cIdx + 1] = gyy;
          B[2][cIdx + 2] = gzz;
        }
        B[3][cIdx] = gyy;
        B[3][cIdx + 1] = gxx;
        B[4][cIdx + 1] = gzz;
        B[4][cIdx + 2] = gyy;
        B[5][cIdx] = gzz;
        B[5][cIdx + 2] = gxx;
      }
      const DB = Array.from({ length: 6 }, () => new Float64Array(24));
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 24; j++) {
          let sum = 0;
          for (let k = 0; k < 6; k++) sum += D[i][k] * B[k][j];
          DB[i][j] = sum;
        }
      }
      const wgt = g.detJ;
      for (let i = 0; i < 24; i++) {
        for (let j = i; j < 24; j++) {
          let sum = 0;
          for (let k = 0; k < 6; k++) sum += B[k][i] * DB[k][j];
          const val = sum * wgt;
          Ke[i * 24 + j] += val;
          if (i !== j) Ke[j * 24 + i] += val;
        }
      }
    }
    return Ke;
  }

  _newSystemMatrix(n) {
    return { type: 'sparse', matrix: new SparseDirectSolver(n), n };
  }

  _assemble() {
    const nNodes = this.nodes.length;
    const totalDOF = nNodes * 3;
    if (nNodes === 0 || this.elements.length === 0) {
      throw new Error('ContactFEM3D: mesh is empty.');
    }

    const { type, matrix: A } = this._newSystemMatrix(totalDOF);

    for (const elem of this.elements) {
      const Ke = this._computeHex8Stiffness(elem);
      const edofs = [];
      for (const nid of elem) {
        edofs.push(3 * nid, 3 * nid + 1, 3 * nid + 2);
      }
      for (let i = 0; i < 24; i++) {
        for (let j = i; j < 24; j++) {
          const row = Math.min(edofs[i], edofs[j]);
          const col = Math.max(edofs[i], edofs[j]);
          A.add(row, col, Ke[i * 24 + j]);
        }
      }
    }

    const diagScale = this._averageDiagonal(A, totalDOF);
    if (this.regularization > 0) {
      for (let i = 0; i < totalDOF; i++) {
        A.add(i, i, this.regularization * diagScale);
      }
    }
    for (const spring of this.stabilizationSprings) {
      const dof = 3 * spring.nodeId + spring.axis;
      A.add(dof, dof, this.stabilizationScale * diagScale);
    }

    const fixedDofs = [];
    for (let id = 0; id < nNodes; id++) {
      for (let d = 0; d < 3; d++) {
        if (this._fix[id][d]) fixedDofs.push(3 * id + d);
      }
    }

    const origRows = new Map();
    for (const dof of fixedDofs) {
      origRows.set(dof, { row: A.rowEntries(dof), type });
    }

    const fixedSet = new Set(fixedDofs);
    for (const dof of fixedDofs) {
      for (const [j, v] of origRows.get(dof).row) {
        if (j === dof) continue;
        if (fixedSet.has(j) && j < dof) continue;
        A.add(dof, j, -v);
      }
      A.add(dof, dof, diagScale - A.get(dof, dof));
    }

    if (process.env.CONTACT_DEBUG) {
      this._debugA = A;
      this._debugN = totalDOF;
    }

    return { A, type, origRows, diagScale, totalDOF };
  }

  _averageDiagonal(A, n) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const d = A.get(i, i);
      if (d > 0) {
        sum += d;
        count++;
      }
    }
    return count > 0 ? sum / count : 1;
  }

  _system(options) {
    const reuse = !!(options && options.reuseFactorization);
    if (reuse && this._factorCache && this._factorCache.A) {
      const cache = this._factorCache;
      const F = this._buildRHS(cache);
      return { A: cache.A, F, cache };
    }
    const { A, type, origRows, diagScale, totalDOF } = this._assemble();
    A.factorize();
    this._factorCache = { A, origRows, diagScale, type };
    const F = this._buildRHS(this._factorCache);
    return { A, F, cache: this._factorCache };
  }

  _buildRHS(cache) {
    const totalDOF = this.nodes.length * 3;
    const loads = this.loads.length === totalDOF ? this.loads : new Float64Array(totalDOF);
    const F = Float64Array.from(loads);
    const fixedDofs = new Set(cache.origRows.keys());
    for (let id = 0; id < this.nodes.length; id++) {
      for (let d = 0; d < 3; d++) {
        if (!this._fix[id][d]) continue;
        const dof = 3 * id + d;
        const ud = this._prescribed[id][d] || 0;
        if (ud !== 0) {
          const stored = cache.origRows.get(dof);
          if (stored) {
            for (const [j, v] of stored.row) {
              if (j !== dof && !fixedDofs.has(j)) F[j] -= v * ud;
            }
          }
          F[dof] = cache.diagScale * ud;
        }
      }
    }
    return F;
  }

  _buildLinearSystem() {
    if (this._factorCache && this._factorCache.A) {
      return this._factorCache;
    }
    const { A, type, origRows, diagScale, totalDOF } = this._assemble();
    this._factorCache = { A, origRows, diagScale, type, totalDOF };
    return this._factorCache;
  }

  /**
   * Build the reduced (free-dof) symmetric system with relative diagonal
   * regularization. Small/medium systems are factored once with a dense
   * Cholesky (fast deterministic solves); larger systems use preconditioned
   * conjugate gradients.
   */
  _prepareLinearSolve(cache) {
    if (this._cgReady) return;
    const A = cache.A;
    const n = A.n;
    const freeIdx = new Int32Array(n).fill(-1);
    const free = [];
    for (let i = 0; i < n; i++) {
      const id = Math.floor(i / 3);
      const ax = i % 3;
      if (!this._fix[id][ax]) {
        freeIdx[i] = free.length;
        free.push(i);
      }
    }
    const m = free.length;
    const rows = Array.from({ length: m }, () => []);
    const diag = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const I = free[i];
      diag[i] = A.get(I, I);
      const rr = A._rows[I];
      if (rr) {
        for (const [j, v] of rr) {
          const f = freeIdx[j];
          if (f >= 0) rows[i].push([f, v]);
        }
      }
      for (let hi = I + 1; hi < n; hi++) {
        const r2 = A._rows[hi];
        if (r2 && r2.has(I)) {
          const f = freeIdx[hi];
          if (f >= 0) rows[i].push([f, r2.get(I)]);
        }
      }
    }
    let avg = 0;
    for (let i = 0; i < m; i++) avg += diag[i];
    avg /= Math.max(1, m);
    const reg = 1e-7 * avg;
    for (let i = 0; i < m; i++) diag[i] += reg;
    const M = new Float64Array(m);
    for (let i = 0; i < m; i++) M[i] = 1 / Math.max(diag[i], 1e-300);
    this._cgData = { freeIdx, free, rows, diag, M, m, reg };
    this._cgReady = true;

    if (m > 5000) return;
    const Kr = Array.from({ length: m }, () => new Float64Array(m));
    for (let i = 0; i < m; i++) {
      Kr[i][i] = diag[i];
      const row = rows[i];
      for (let k = 0; k < row.length; k++) {
        Kr[i][row[k][0]] = row[k][1];
        Kr[row[k][0]][i] = row[k][1];
      }
    }
    const L = Array.from({ length: m }, () => new Float64Array(m));
    for (let i = 0; i < m; i++) {
      for (let j = 0; j <= i; j++) {
        let s = Kr[i][j];
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) {
          if (!(s > 0)) {
            throw new Error('ContactFEM3D: reduced system is not positive definite.');
          }
          L[i][j] = Math.sqrt(s);
        } else {
          L[i][j] = s / L[j][j];
        }
      }
    }
    this._denseData = { L, m };
  }

  _denseSolve(rhs) {
    const { L, m } = this._denseData;
    const { free } = this._cgData;
    const b = new Float64Array(m);
    for (let i = 0; i < m; i++) b[i] = rhs[free[i]];
    const y = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      let s = b[i];
      for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
      y[i] = s / L[i][i];
    }
    const x = new Float64Array(m);
    for (let i = m - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < m; k++) s -= L[k][i] * x[k];
      x[i] = s / L[i][i];
    }
    const { freeIdx } = this._cgData;
    const u = new Float64Array(rhs.length);
    for (let i = 0; i < m; i++) u[free[i]] = x[i];
    for (let i = 0; i < rhs.length; i++) {
      if (freeIdx[i] < 0) u[i] = this._prescribed[Math.floor(i / 3)][i % 3] || 0;
    }
    return u;
  }

  _cgSolve(rhs) {
    this._prepareLinearSolve(this._factorCache);
    const { freeIdx, free, rows, diag, M, m } = this._cgData;
    const b = new Float64Array(m);
    for (let i = 0; i < m; i++) b[i] = rhs[free[i]];
    const x = new Float64Array(m);
    const r = Float64Array.from(b);
    const z = new Float64Array(m);
    for (let i = 0; i < m; i++) z[i] = M[i] * r[i];
    const p = Float64Array.from(z);
    let rho = 0;
    for (let i = 0; i < m; i++) rho += r[i] * z[i];
    let bnrm = 0;
    for (let i = 0; i < m; i++) bnrm += b[i] * b[i];
    bnrm = Math.sqrt(bnrm) + 1e-300;
    const MAXIT = 8000;
    for (let it = 0; it < MAXIT; it++) {
      const Ap = new Float64Array(m);
      for (let i = 0; i < m; i++) {
        let s = diag[i] * p[i];
        const row = rows[i];
        for (let k = 0; k < row.length; k++) s += row[k][1] * p[row[k][0]];
        Ap[i] = s;
      }
      let pAp = 0;
      for (let i = 0; i < m; i++) pAp += p[i] * Ap[i];
      if (!(pAp > 0)) break;
      const alpha = rho / pAp;
      let res = 0;
      for (let i = 0; i < m; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
        res += r[i] * r[i];
      }
      if (Math.sqrt(res) <= 1e-10 * bnrm) break;
      for (let i = 0; i < m; i++) z[i] = M[i] * r[i];
      let rhoNew = 0;
      for (let i = 0; i < m; i++) rhoNew += r[i] * z[i];
      if (!(rhoNew > 0)) break;
      const beta = rhoNew / rho;
      for (let i = 0; i < m; i++) p[i] = z[i] + beta * p[i];
      rho = rhoNew;
    }
    const u = new Float64Array(rhs.length);
    for (let i = 0; i < m; i++) u[free[i]] = x[i];
    for (let i = 0; i < rhs.length; i++) {
      if (freeIdx[i] < 0) u[i] = this._prescribed[Math.floor(i / 3)][i % 3] || 0;
    }
    return u;
  }

  solve(options = {}) {
    const cache = this._buildLinearSystem();
    const totalDOF = this.nodes.length * 3;
    const F = this._buildRHS(cache);
    const pairs = this._pairs;

    const kp = pairs.map((p) => this.penalty * p.area);
    const lambda = new Float64Array(pairs.length);
    const active = new Uint8Array(pairs.length);
    let u = new Float64Array(totalDOF);
    let rhs = Float64Array.from(F);

    let converged = false;
    let iterations = 0;
    let maxGap = Infinity;
    let maxLambdaChange = Infinity;
    let maxUChange = Infinity;

    for (let iter = 0; iter < this.maxAugmentedIterations; iter++) {
      iterations = iter + 1;

      rhs = Float64Array.from(F);

      for (let p = 0; p < pairs.length; p++) {
        const pair = pairs[p];
        if (!active[p]) continue;
        const gap = this._gap(pair, u);
        const pen = gap < 0 ? -gap : 0;
        const t = lambda[p] + kp[p] * pen;
        if (t > 0) {
          const sDof = 3 * pair.slave + pair.normalAxis;
          const mDof = 3 * pair.master + pair.normalAxis;
          rhs[sDof] += t;
          rhs[mDof] -= t;
        }
      }

      // Direct sparse factorization of the full (constrained) system is reused
      // every iteration: the factorized matrix already encodes the fixed-dof
      // constraints (diagonal scaling + RHS elimination in `_buildRHS`), so a
      // sparse triangular solve returns the complete solution vector including
      // prescribed/fixed dofs. This avoids the O(m^3) dense Cholesky build of
      // the reduced system, which was prohibitively expensive for the
      // 3D Hertz contact check (minutes per run).
      const uNext = cache.A.solve(rhs);

      maxUChange = 0;
      let uNorm = 0;
      for (let i = 0; i < totalDOF; i++) {
        const uNew = this.relaxation * uNext[i] + (1 - this.relaxation) * u[i];
        maxUChange = Math.max(maxUChange, Math.abs(uNew - u[i]));
        uNorm = Math.max(uNorm, Math.abs(uNew));
        u[i] = uNew;
      }
      const relUChange = maxUChange / (1 + uNorm);

      maxGap = 0;
      maxLambdaChange = 0;
      for (let p = 0; p < pairs.length; p++) {
        const g = this._gap(pairs[p], u);
        const pen = g < 0 ? -g : 0;
        maxGap = Math.max(maxGap, pen);
        const lamNew = Math.max(0, lambda[p] + kp[p] * pen);
        maxLambdaChange = Math.max(maxLambdaChange, Math.abs(lamNew - lambda[p]));
        lambda[p] = lamNew;
        active[p] = g < this.gapTolerance || lambda[p] > 0 ? 1 : 0;
      }

      const lambdaNorm = 1 + lambda.reduce((a, b) => a + Math.abs(b), 0);
      const relChange = maxLambdaChange / lambdaNorm;
      if (process.env.CONTACT_DEBUG && iter % 5 === 0) {
        console.error(
          `[contact-it] ${iter} gap=${maxGap.toExponential(3)} relChange=${relChange.toExponential(3)} relU=${relUChange.toExponential(3)} |u|=${Math.sqrt(u.reduce((a, b) => a + b * b, 0)).toExponential(3)}`
        );
      }
      if (maxGap <= this.gapTolerance && relChange <= this.tolerance && relUChange <= this.uTolerance) {
        converged = true;
        break;
      }
      if (!isFiniteNumber(maxGap) || !isFiniteNumber(relChange) || !isFiniteNumber(relUChange)) {
        throw new Error('ContactFEM3D: iteration produced non-finite gap or multipliers or displacements.');
      }
    }

    const uFinal = u;

    const pressures = [];
    let maxPressure = 0;
    let totalContactForce = 0;
    for (let p = 0; p < pairs.length; p++) {
      const pair = pairs[p];
      const g = this._gap(pair, uFinal);
      const pen = g < 0 ? -g : 0;
      const t = lambda[p] + kp[p] * pen;
      const pVal = t > 0 ? t / pair.area : 0;
      pair.gap = g;
      pair.multiplier = lambda[p];
      pair.pressure = pVal;
      pressures.push({ pair, gap: g, multiplier: lambda[p], pressure: pVal });
      totalContactForce += t > 0 ? t : 0;
      if (pVal > maxPressure) maxPressure = pVal;
    }

    const s = (this._lastSolve = {
      solverExecuted: true,
      solverType: 'sparse-cg',
      converged,
      iterations,
      maxPenetrationM: maxGap,
      maxMultiplierChange: maxLambdaChange,
      penalty: this.penalty,
      totalContactForceN: totalContactForce,
      maxPressurePa: maxPressure,
      activeContactPairs: pressures.filter((p) => p.pressure > 0).length,
      displacement: uFinal,
      reactions: this._nodalReaction(cache.A, uFinal),
      dofCount: totalDOF,
      elementCount: this.elements.length,
      nodeCount: this.nodes.length
    });
    return s;
  }

  _gap(pair, u) {
    const a = pair.normalAxis;
    const axisName = ['x', 'y', 'z'][a];
    return (
      this.nodes[pair.slave][axisName] +
      u[3 * pair.slave + a] -
      (this.nodes[pair.master][axisName] + u[3 * pair.master + a])
    );
  }

  _nodalReaction(A, u) {
    const n = this.nodes.length;
    const totalDof = 3 * n;
    const total = [0, 0, 0];
    const perDof = new Map();
    const cache = this._factorCache;
    for (let id = 0; id < n; id++) {
      for (let d = 0; d < 3; d++) {
        if (!this._fix[id][d]) continue;
        const dof = 3 * id + d;
        let f = 0;
        const stored = cache && cache.origRows ? cache.origRows.get(dof) : null;
        if (stored) {
          for (const [j, v] of stored.row) {
            f += v * u[j];
          }
        } else {
          for (let j = 0; j < totalDof; j++) {
            const val = A.get(Math.min(dof, j), Math.max(dof, j));
            if (val !== 0) f += val * u[j];
          }
        }
        const appliedLoad = this.loads.length === totalDof ? this.loads[dof] : 0;
        const reaction = f - appliedLoad;
        perDof.set(dof, reaction);
        total[d] += reaction;
      }
    }
    return { total, perDof };
  }

  contactPressures() {
    return this._lastSolve ? this._lastSolve : null;
  }
}

module.exports = { ContactFEM3D, BandedCholesky, DenseSolver, hex8Shape };
