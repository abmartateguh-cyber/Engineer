/**
 * Classical Laminated Plate Theory (CLPT) arithmetic and lamina failure-index helpers
 *
 * Classical-laminate arithmetic:
 * 1. ABD Matrix Formulation: Extensional (A), Coupling (B), and Bending (D) stiffness matrices.
 * 2. Arbitrary ply layups with fiber orientation angles theta_k and thickness t_k.
 * 3. Layer-by-layer lamina stress/strain calculations: solve the 6x6 ABD system for
 *    midplane strains / curvatures, recover per-ply strain at ply midplanes, transform to
 *    lamina coordinates and apply the reduced stiffness Q to recover ply stresses.
 * 4. Failure criteria:
 *    - Tsai-Wu tensor polynomial failure criterion.
 *    - Hashin failure modes (fiber tension, fiber compression, matrix cracking).
 *    - First-Ply Failure (FPF) load-multiplier analysis (exact quadratic root).
 *
 * Deterministic double-precision arithmetic only; no external runtime dependencies beyond
 * package.json. Failure indices are returned at full precision (no rounding).
 *
 * Scope note: this module implements first-ply failure (initiation). It does NOT implement
 * progressive damage or delamination propagation (no stiffness degradation after a ply
 * fails), so the FPF gate covers initiation only.
 */

'use strict';

class CompositePly {
  /**
   * @param {Object} spec
   * @param {number} spec.thicknessMm - Ply thickness t_k (mm)
   * @param {number} spec.orientationDeg - Fiber orientation angle theta (deg, e.g. 0, 45, -45, 90)
   * @param {number} spec.E1 - Longitudinal modulus in fiber direction (Pa)
   * @param {number} spec.E2 - Transverse modulus perpendicular to fiber (Pa)
   * @param {number} spec.G12 - In-plane shear modulus (Pa)
   * @param {number} spec.nu12 - Major Poisson's ratio
   * @param {Object} spec.strengths - Caller-supplied lamina strengths (Pa)
   */
  constructor(spec) {
    const required = ['thicknessMm', 'orientationDeg', 'E1', 'E2', 'G12', 'nu12'];
    if (!spec || typeof spec !== 'object' || !required.every((field) => Number.isFinite(spec[field]))) {
      throw new TypeError(`Provide explicit finite composite ply inputs: ${required.join(', ')}.`);
    }
    if (spec.thicknessMm <= 0 || spec.E1 <= 0 || spec.E2 <= 0 || spec.G12 <= 0 || spec.nu12 <= -1 || spec.nu12 >= 0.5) {
      throw new RangeError('Composite ply geometry and elastic properties are outside the supported range.');
    }
    this.t = spec.thicknessMm * 1e-3; // convert to m
    this.thetaDeg = spec.orientationDeg;
    this.E1 = spec.E1;
    this.E2 = spec.E2;
    this.G12 = spec.G12;
    this.nu12 = spec.nu12;
    this.nu21 = (this.nu12 * this.E2) / this.E1;

    // Lamina allowable strengths (Pa)
    const str = spec.strengths;
    const strengthFields = ['Xt', 'Xc', 'Yt', 'Yc', 'S'];
    if (
      !str ||
      typeof str !== 'object' ||
      !strengthFields.every((field) => Number.isFinite(str[field]) && str[field] > 0)
    ) {
      throw new TypeError(`Provide explicit positive lamina strengths in pascals: ${strengthFields.join(', ')}.`);
    }
    this.Xt = str.Xt;
    this.Xc = str.Xc;
    this.Yt = str.Yt;
    this.Yc = str.Yc;
    this.S = str.S;

    this.computeReducedStiffness();
  }

  computeReducedStiffness() {
    const denom = 1.0 - this.nu12 * this.nu21;
    this.Q11 = this.E1 / denom;
    this.Q12 = (this.nu12 * this.E2) / denom;
    this.Q22 = this.E2 / denom;
    this.Q66 = this.G12;

    // Transform Q to Q_bar for angle theta
    const rad = (this.thetaDeg * Math.PI) / 180.0;
    const m = Math.cos(rad);
    const n = Math.sin(rad);
    const m2 = m * m,
      n2 = n * n;
    const m4 = m2 * m2,
      n4 = n2 * n2;
    const m2n2 = m2 * n2;

    this.Qbar11 = this.Q11 * m4 + 2 * (this.Q12 + 2 * this.Q66) * m2n2 + this.Q22 * n4;
    this.Qbar12 = (this.Q11 + this.Q22 - 4 * this.Q66) * m2n2 + this.Q12 * (m4 + n4);
    this.Qbar22 = this.Q11 * n4 + 2 * (this.Q12 + 2 * this.Q66) * m2n2 + this.Q22 * m4;
    this.Qbar16 = (this.Q11 - this.Q12 - 2 * this.Q66) * m * m2 * n - (this.Q22 - this.Q12 - 2 * this.Q66) * m * n * n2;
    this.Qbar26 = (this.Q11 - this.Q12 - 2 * this.Q66) * m * n * n2 - (this.Q22 - this.Q12 - 2 * this.Q66) * m * m2 * n;
    this.Qbar66 = (this.Q11 + this.Q22 - 2 * this.Q12 - 2 * this.Q66) * m2n2 + this.Q66 * (m4 + n4);
  }
}

/**
 * Deterministic 6x6 linear solve (Gauss-Jordan with partial pivoting).
 * @param {number[][]} K - 6x6 matrix
 * @param {number[]} b - length-6 right-hand side
 * @returns {number[]} solution vector
 */
function solveLinear6(K, b) {
  const n = 6;
  const M = [];
  for (let i = 0; i < n; i++) {
    M.push(K[i].slice());
    M[i].push(b[i]);
  }
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (!(best > 0)) {
      throw new Error('ABD stiffness matrix is singular; cannot invert.');
    }
    if (pivot !== col) {
      const tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;
    }
    const diag = M[col][col];
    for (let c = col; c <= n; c++) {
      M[col][c] /= diag;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }
  const x = [];
  for (let i = 0; i < n; i++) {
    x.push(M[i][n]);
  }
  return x;
}

class CompositeLaminateCLPT {
  /**
   * @param {CompositePly[]} plies - Array of plies from bottom (z = -h/2) to top (z = +h/2)
   */
  constructor(plies) {
    if (!Array.isArray(plies) || plies.length === 0 || plies.some((ply) => !(ply instanceof CompositePly))) {
      throw new TypeError('Provide a non-empty array of explicitly configured CompositePly instances.');
    }
    this.plies = plies;
    this.totalThickness = plies.reduce((sum, p) => sum + p.t, 0);

    // 3x3 ABD matrices
    this.A = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    this.B = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    this.D = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];

    this.computeABDMatrices();
  }

  computeABDMatrices() {
    const h = this.totalThickness;
    let zk_minus_1 = -h / 2.0;

    for (const ply of this.plies) {
      const zk = zk_minus_1 + ply.t;

      const dz = zk - zk_minus_1;
      const dz2 = (zk * zk - zk_minus_1 * zk_minus_1) / 2.0;
      const dz3 = (zk * zk * zk - zk_minus_1 * zk_minus_1 * zk_minus_1) / 3.0;

      const Q = [
        [ply.Qbar11, ply.Qbar12, ply.Qbar16],
        [ply.Qbar12, ply.Qbar22, ply.Qbar26],
        [ply.Qbar16, ply.Qbar26, ply.Qbar66]
      ];

      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          this.A[r][c] += Q[r][c] * dz;
          this.B[r][c] += Q[r][c] * dz2;
          this.D[r][c] += Q[r][c] * dz3;
        }
      }

      zk_minus_1 = zk;
    }
  }

  /**
   * Assemble the 6x6 ABD system matrix [[A, B], [B, D]].
   * @returns {number[][]}
   */
  buildABDSystem() {
    const K = [];
    for (let i = 0; i < 6; i++) {
      K.push(new Array(6).fill(0));
    }
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        K[r][c] = this.A[r][c];
        K[r][c + 3] = this.B[r][c];
        K[r + 3][c] = this.B[r][c];
        K[r + 3][c + 3] = this.D[r][c];
      }
    }
    return K;
  }

  /**
   * Solve the CLPT constitutive relation for midplane strains and curvatures:
   *   [[A, B], [B, D]] * {eps0, kappa} = {N, M}
   * @param {Object} resultants - {Nx, Ny, Nxy, Mx, My, Mxy} (resultants in N/m and N)
   * @returns {{strain: number[], curvature: number[]}} strain/curvature length-3 vectors
   */
  solveABD(resultants) {
    const keys = ['Nx', 'Ny', 'Nxy', 'Mx', 'My', 'Mxy'];
    const rhs = keys.map((key) => {
      const v = resultants[key];
      return Number.isFinite(v) ? v : 0;
    });
    const sol = solveLinear6(this.buildABDSystem(), rhs);
    return {
      strain: sol.slice(0, 3),
      curvature: sol.slice(3, 6)
    };
  }

  /**
   * Recover per-ply strains and stresses from midplane strains and curvatures.
   * @param {number[]} strain - [eps0x, eps0y, gamma0xy]
   * @param {number[]} curvature - [kappax, kappay, kappa_xy]
   * @returns {Object[]} per-ply results (bottom to top), each with global and lamina quantities
   */
  recoverPlyStresses(strain, curvature) {
    const zMid = [];
    {
      let zk_minus_1 = -this.totalThickness / 2.0;
      for (const ply of this.plies) {
        const zk = zk_minus_1 + ply.t;
        zMid.push((zk_minus_1 + zk) / 2.0);
        zk_minus_1 = zk;
      }
    }

    const results = [];
    for (let i = 0; i < this.plies.length; i++) {
      const ply = this.plies[i];
      const z = zMid[i];
      const ex = strain[0] + z * curvature[0];
      const ey = strain[1] + z * curvature[1];
      const gxy = strain[2] + z * curvature[2];

      const rad = (ply.thetaDeg * Math.PI) / 180.0;
      const m = Math.cos(rad);
      const n = Math.sin(rad);
      const m2 = m * m,
        n2 = n * n;
      const mn = m * n;

      const e1 = m2 * ex + n2 * ey + mn * gxy;
      const e2 = n2 * ex + m2 * ey - mn * gxy;
      const g12 = -2 * mn * ex + 2 * mn * ey + (m2 - n2) * gxy;

      const s1 = ply.Q11 * e1 + ply.Q12 * e2;
      const s2 = ply.Q12 * e1 + ply.Q22 * e2;
      const t12 = ply.Q66 * g12;

      const sx = ply.Qbar11 * ex + ply.Qbar12 * ey + ply.Qbar16 * gxy;
      const sy = ply.Qbar12 * ex + ply.Qbar22 * ey + ply.Qbar26 * gxy;
      const txy = ply.Qbar16 * ex + ply.Qbar26 * ey + ply.Qbar66 * gxy;

      results.push({
        plyIndex: i,
        orientationDeg: ply.thetaDeg,
        zMid: z,
        epsilonGlobal: [ex, ey, gxy],
        epsilonLocal: [e1, e2, g12],
        sigmaGlobal: { sigmaX: sx, sigmaY: sy, tauXY: txy },
        sigmaLocal: { sigma1: s1, sigma2: s2, tau12: t12 }
      });
    }
    return results;
  }

  /**
   * Quadratic coefficients of the Tsai-Wu failure index in a load multiplier lambda:
   * FI(lambda*s) = A*lambda^2 + B*lambda.
   * @returns {{A: number, B: number}}
   */
  static _tsaiWuQuadratic(ply, s1, s2, t12) {
    const F1 = 1.0 / ply.Xt - 1.0 / ply.Xc;
    const F11 = 1.0 / (ply.Xt * ply.Xc);
    const F2 = 1.0 / ply.Yt - 1.0 / ply.Yc;
    const F22 = 1.0 / (ply.Yt * ply.Yc);
    const F66 = 1.0 / (ply.S * ply.S);
    const F12 = -0.5 * Math.sqrt(F11 * F22);
    const A = F11 * s1 * s1 + F22 * s2 * s2 + F66 * t12 * t12 + 2.0 * F12 * s1 * s2;
    const B = F1 * s1 + F2 * s2;
    return { A, B };
  }

  /**
   * Quadratic coefficients of the Hashin failure indices in a load multiplier lambda,
   * including the mode branch (sign of s1 / s2 is invariant under positive scaling).
   * @returns {{fiber: {A: number, B: number, mode: string}, matrix: {A: number, B: number, mode: string}}}
   */
  static _hashinQuadratic(ply, s1, s2, t12) {
    const fiberTension = s1 >= 0;
    const matrixTension = s2 >= 0;

    const fiberA = (s1 * (fiberTension ? 1.0 / ply.Xt : 1.0 / ply.Xc)) ** 2 + (t12 / ply.S) ** 2;
    const fiberB = 0;

    const matrixA = (s2 / (matrixTension ? ply.Yt : 2.0 * ply.S)) ** 2 + (t12 / ply.S) ** 2;
    const matrixB = matrixTension ? 0 : ((ply.Yc / (2.0 * ply.S)) ** 2 - 1.0) * (s2 / ply.Yc);

    return {
      fiber: { A: fiberA, B: fiberB, mode: fiberTension ? 'hashin-fiber-tension' : 'hashin-fiber-compression' },
      matrix: { A: matrixA, B: matrixB, mode: matrixTension ? 'hashin-matrix-tension' : 'hashin-matrix-compression' }
    };
  }

  /**
   * Positive load multiplier lambda at which a quadratic FI(lambda) = A*lambda^2 + B*lambda
   * reaches 1.0. Returns Infinity when FI is never positive under positive scaling.
   */
  static _positiveRootQuadratic(A, B) {
    if (A > 0) {
      const disc = B * B + 4.0 * A;
      return (-B + Math.sqrt(disc)) / (2.0 * A);
    }
    if (B > 0) {
      return 1.0 / B;
    }
    return Infinity;
  }

  /**
   * First-ply failure analysis: find the smallest positive load multiplier lambda such that
   * the selected failure criterion reaches FI = 1.0 in at least one ply.
   * @param {Object} resultants - {Nx, Ny, Nxy, Mx, My, Mxy} at unit load (lambda = 1)
   * @param {Object} [options]
   * @param {string} [options.criterion] - 'tsai-wu' (default) or 'hashin'
   * @returns {Object} FPF report
   */
  firstPlyFailure(resultants, options) {
    const criterion = (options && options.criterion) || 'tsai-wu';
    if (criterion !== 'tsai-wu' && criterion !== 'hashin') {
      throw new TypeError(`Unsupported failure criterion: ${criterion}. Use 'tsai-wu' or 'hashin'.`);
    }

    const membrane = this.solveABD(resultants);
    const recovered = this.recoverPlyStresses(membrane.strain, membrane.curvature);

    const perPly = [];
    let best = null;

    for (let i = 0; i < this.plies.length; i++) {
      const ply = this.plies[i];
      const s = recovered[i].sigmaLocal;
      const candidates = [];
      if (criterion === 'tsai-wu') {
        const q = CompositeLaminateCLPT._tsaiWuQuadratic(ply, s.sigma1, s.sigma2, s.tau12);
        candidates.push({ mode: 'tsai-wu', A: q.A, B: q.B });
      } else {
        const h = CompositeLaminateCLPT._hashinQuadratic(ply, s.sigma1, s.sigma2, s.tau12);
        candidates.push({ mode: h.fiber.mode, A: h.fiber.A, B: h.fiber.B });
        candidates.push({ mode: h.matrix.mode, A: h.matrix.A, B: h.matrix.B });
      }

      let plyBest = null;
      for (const cand of candidates) {
        const lambda = CompositeLaminateCLPT._positiveRootQuadratic(cand.A, cand.B);
        if (!Number.isFinite(lambda) || lambda <= 0) continue;
        if (!plyBest || lambda < plyBest.lambda) {
          plyBest = { mode: cand.mode, A: cand.A, B: cand.B, lambda };
        }
      }

      perPly.push({
        plyIndex: i,
        orientationDeg: ply.thetaDeg,
        mode: plyBest ? plyBest.mode : null,
        multiplier: plyBest ? plyBest.lambda : Infinity,
        quadraticA: plyBest ? plyBest.A : null,
        quadraticB: plyBest ? plyBest.B : null
      });

      if (plyBest && (!best || plyBest.lambda < best.lambda)) {
        best = { plyIndex: i, mode: plyBest.mode, A: plyBest.A, B: plyBest.B, lambda: plyBest.lambda };
      }
    }

    let failureIndexAtMultiplier = null;
    if (best && Number.isFinite(best.lambda)) {
      const scaled = {};
      for (const key of ['Nx', 'Ny', 'Nxy', 'Mx', 'My', 'Mxy']) {
        scaled[key] = (Number.isFinite(resultants[key]) ? resultants[key] : 0) * best.lambda;
      }
      const mem = this.solveABD(scaled);
      const rec = this.recoverPlyStresses(mem.strain, mem.curvature)[best.plyIndex];
      const s = rec.sigmaLocal;
      if (criterion === 'tsai-wu') {
        failureIndexAtMultiplier = CompositeLaminateCLPT.evaluateTsaiWu(
          this.plies[best.plyIndex],
          s.sigma1,
          s.sigma2,
          s.tau12
        ).failureIndex;
      } else {
        const h = CompositeLaminateCLPT.evaluateHashin(this.plies[best.plyIndex], s.sigma1, s.sigma2, s.tau12);
        failureIndexAtMultiplier = best.mode.includes('fiber') ? h.fiberFailureIndex : h.matrixFailureIndex;
      }
    }

    return {
      criterion,
      loadMultiplier: best ? best.lambda : Infinity,
      criticalPlyIndex: best ? best.plyIndex : -1,
      criticalMode: best ? best.mode : null,
      failureIndexAtMultiplier,
      perPly
    };
  }

  /**
   * Evaluates Tsai-Wu failure index for a single ply under principal lamina stresses (sigma1, sigma2, tau12)
   * Tsai-Wu failure occurs when FI >= 1.0
   * @param {CompositePly} ply
   * @param {number} s1 - Longitudinal stress (Pa)
   * @param {number} s2 - Transverse stress (Pa)
   * @param {number} t12 - In-plane shear stress (Pa)
   * @returns {{failureIndex: number, isSafe: boolean}}
   */
  static evaluateTsaiWu(ply, s1, s2, t12) {
    const q = CompositeLaminateCLPT._tsaiWuQuadratic(ply, s1, s2, t12);
    const FI = q.A + q.B;

    return {
      failureIndex: FI,
      isSafe: FI < 1.0,
      reserveFactor: FI > 0 ? 1.0 / Math.sqrt(FI) : Infinity
    };
  }

  /**
   * Evaluates Hashin failure criteria: fiber tension/compression, matrix tension/compression
   * @param {CompositePly} ply
   * @param {number} s1
   * @param {number} s2
   * @param {number} t12
   * @returns {Object} Mode-specific failure indices
   */
  static evaluateHashin(ply, s1, s2, t12) {
    const h = CompositeLaminateCLPT._hashinQuadratic(ply, s1, s2, t12);
    const fiberIndex = h.fiber.A + h.fiber.B;
    const matrixIndex = h.matrix.A + h.matrix.B;

    return {
      fiberFailureIndex: fiberIndex,
      matrixFailureIndex: matrixIndex,
      isFiberSafe: fiberIndex < 1.0,
      isMatrixSafe: matrixIndex < 1.0
    };
  }
}

module.exports = {
  CompositePly,
  CompositeLaminateCLPT
};
