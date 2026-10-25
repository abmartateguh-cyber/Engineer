/**
 * OmniEng Constrained Model Predictive Control (MPC) Engine
 * Implements linear discrete-time state-space MPC with actuator limits, slew rate limits,
 * and state constraints solved via native Goldfarb-Idnani Dual Active-Set Quadratic Programming.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

/**
 * Native Goldfarb-Idnani Dual Quadratic Programming Solver
 * Solves: min 0.5 * x^T * H * x + c^T * x  subject to  A_ineq * x >= b_ineq
 */
class GoldfarbIdnaniQPSolver {
  /**
   * @param {Array<Array<number>>} H Symmetric positive definite Hessian matrix (n x n)
   * @param {Array<number>} c Linear cost vector (n)
   * @param {Array<Array<number>>} A Inequality constraint matrix (m x n), where A * x >= b
   * @param {Array<number>} b Inequality constraint bounds (m)
   * @param {number} [maxIter=100] Maximum dual active-set iterations
   */
  static solve(H, c, A = [], b = [], maxIter = 150) {
    const n = c.length;
    const m = b.length;

    // Cholesky decomposition of H: H = L * L^T
    const L = this._cholesky(H);
    const Linv = this._invertLowerTriangular(L);
    // Hinv = Linv^T * Linv
    const Hinv = this._matrixMultiply(this._transpose(Linv), Linv);

    // Initial unconstrained minimizer x0 = -H^-1 * c
    let x = this._matrixVectorMultiply(
      Hinv,
      c.map((v) => -v)
    );
    let activeSet = []; // Array of active constraint indices in A
    let lambda = []; // Multipliers for active constraints

    // Tolerance for constraint satisfaction
    const tol = 1e-7;

    for (let iter = 0; iter < maxIter; iter++) {
      // 1. Find the most violated constraint: A_i * x < b_i
      let maxViolation = 0.0;
      let p = -1;

      for (let i = 0; i < m; i++) {
        if (activeSet.includes(i)) continue;
        let val = 0.0;
        for (let j = 0; j < n; j++) val += A[i][j] * x[j];
        const viol = b[i] - val;
        if (viol > maxViolation + tol) {
          maxViolation = viol;
          p = i;
        }
      }

      // If no constraints are violated, current x is the constrained global optimum!
      if (p === -1) {
        let cost = 0.0;
        for (let i = 0; i < n; i++) {
          cost += c[i] * x[i];
          for (let j = 0; j < n; j++) {
            cost += 0.5 * x[i] * H[i][j] * x[j];
          }
        }
        return {
          converged: true,
          iterations: iter,
          x,
          cost,
          activeSetSize: activeSet.length,
          activeConstraints: activeSet.slice()
        };
      }

      // 2. Dual step: attempt to add constraint p to the active set
      let stepSubproblemSuccess = false;
      while (!stepSubproblemSuccess && iter < maxIter) {
        // Build submatrix of active constraints N = [A_active; a_p]
        const currentActive = activeSet.slice();
        const k = currentActive.length;

        // Vector n_p = a_p
        const np = A[p];
        // d = H^-1 * np
        const d = this._matrixVectorMultiply(Hinv, np);

        if (k === 0) {
          // Direct step without prior active constraints
          let denom = 0.0;
          for (let j = 0; j < n; j++) denom += np[j] * d[j];
          if (denom <= 1e-12) denom = 1e-12;

          let val = 0.0;
          for (let j = 0; j < n; j++) val += np[j] * x[j];
          const t = (b[p] - val) / denom;

          for (let j = 0; j < n; j++) x[j] += t * d[j];
          activeSet.push(p);
          lambda.push(t);
          stepSubproblemSuccess = true;
          break;
        }

        // Active constraint normal matrix M = A_active * H^-1 * A_active^T (k x k)
        const M = Array.from({ length: k }, () => new Float64Array(k));
        for (let r = 0; r < k; r++) {
          const ar = A[currentActive[r]];
          const Har = this._matrixVectorMultiply(Hinv, ar);
          for (let cIdx = 0; cIdx < k; cIdx++) {
            let sum = 0.0;
            const ac = A[currentActive[cIdx]];
            for (let j = 0; j < n; j++) sum += ac[j] * Har[j];
            M[r][cIdx] = sum;
          }
        }

        // Vector v = A_active * H^-1 * a_p = A_active * d
        const v = new Float64Array(k);
        for (let r = 0; r < k; r++) {
          let sum = 0.0;
          const ar = A[currentActive[r]];
          for (let j = 0; j < n; j++) sum += ar[j] * d[j];
          v[r] = sum;
        }

        // Solve M * u = v for multiplier direction u
        const u = this._solveLinearSystem(M, v);
        let np_d = 0.0;
        for (let j = 0; j < n; j++) np_d += np[j] * d[j];

        let v_u = 0.0;
        for (let r = 0; r < k; r++) v_u += v[r] * u[r];

        const zDenom = np_d - v_u;
        const z = d.slice();
        for (let r = 0; r < k; r++) {
          const ar = A[currentActive[r]];
          const Har = this._matrixVectorMultiply(Hinv, ar);
          for (let j = 0; j < n; j++) z[j] -= u[r] * Har[j];
        }

        let valP = 0.0;
        for (let j = 0; j < n; j++) valP += np[j] * x[j];
        const stepFull = Math.max(1e-12, zDenom) > 1e-12 ? (b[p] - valP) / zDenom : 0.0;

        // Check if step violates non-negativity of existing active multipliers
        let stepMax = stepFull;
        let dropIdx = -1;

        for (let r = 0; r < k; r++) {
          if (u[r] > 1e-12) {
            const ratio = lambda[r] / u[r];
            if (ratio < stepMax) {
              stepMax = ratio;
              dropIdx = r;
            }
          }
        }

        // Take step
        for (let j = 0; j < n; j++) x[j] += stepMax * z[j];

        for (let r = 0; r < k; r++) {
          lambda[r] -= stepMax * u[r];
        }

        if (dropIdx !== -1) {
          // Drop blocking constraint
          activeSet.splice(dropIdx, 1);
          lambda.splice(dropIdx, 1);
        } else {
          // Add constraint p to active set
          activeSet.push(p);
          lambda.push(stepFull);
          stepSubproblemSuccess = true;
        }
      }
    }

    return { converged: false, x, activeSetSize: activeSet.length };
  }

  static _cholesky(A) {
    const n = A.length;
    const L = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0.0;
        for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
        if (i === j) {
          const val = A[i][i] - sum;
          L[i][j] = Math.sqrt(Math.max(val, 1e-9));
        } else {
          L[i][j] = (A[i][j] - sum) / L[j][j];
        }
      }
    }
    return L;
  }

  static _invertLowerTriangular(L) {
    const n = L.length;
    const inv = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      inv[i][i] = 1.0 / L[i][i];
      for (let j = 0; j < i; j++) {
        let sum = 0.0;
        for (let k = j; k < i; k++) sum += L[i][k] * inv[k][j];
        inv[i][j] = -sum / L[i][i];
      }
    }
    return inv;
  }

  static _transpose(M) {
    const r = M.length;
    const c = M[0].length;
    const T = Array.from({ length: c }, () => new Float64Array(r));
    for (let i = 0; i < r; i++) {
      for (let j = 0; j < c; j++) T[j][i] = M[i][j];
    }
    return T;
  }

  static _matrixMultiply(A, B) {
    const rA = A.length;
    const cA = A[0].length;
    const cB = B[0].length;
    const C = Array.from({ length: rA }, () => new Float64Array(cB));
    for (let i = 0; i < rA; i++) {
      for (let k = 0; k < cA; k++) {
        const aik = A[i][k];
        for (let j = 0; j < cB; j++) {
          C[i][j] += aik * B[k][j];
        }
      }
    }
    return C;
  }

  static _matrixVectorMultiply(A, x) {
    const r = A.length;
    const c = A[0].length;
    const y = new Float64Array(r);
    for (let i = 0; i < r; i++) {
      let sum = 0.0;
      for (let j = 0; j < c; j++) sum += A[i][j] * x[j];
      y[i] = sum;
    }
    return y;
  }

  static _solveLinearSystem(A, b) {
    const n = b.length;
    const aug = Array.from({ length: n }, (row, i) => {
      const r = new Float64Array(n + 1);
      for (let j = 0; j < n; j++) r[j] = A[i][j];
      r[n] = b[i];
      return r;
    });

    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
      }
      const tmp = aug[i];
      aug[i] = aug[maxRow];
      aug[maxRow] = tmp;

      const pivot = aug[i][i] || 1e-12;
      for (let j = i; j <= n; j++) aug[i][j] /= pivot;

      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = aug[k][i];
          for (let j = i; j <= n; j++) aug[k][j] -= factor * aug[i][j];
        }
      }
    }

    const sol = new Float64Array(n);
    for (let i = 0; i < n; i++) sol[i] = aug[i][n];
    return sol;
  }
}

/**
 * Constrained Model Predictive Controller (State-Space Formulation)
 */
class ModelPredictiveController {
  /**
   * @param {Object} options
   * @param {Array<Array<number>>} options.A Discrete state transition matrix (nx x nx)
   * @param {Array<Array<number>>} options.B Discrete input matrix (nx x nu)
   * @param {Array<Array<number>>} options.C Discrete output matrix (ny x nx)
   * @param {number} [options.predictionHorizon=10] Prediction steps Np
   * @param {number} [options.controlHorizon=3] Control steps Nc
   * @param {Array<number>} [options.Q] Output error weights (ny)
   * @param {Array<number>} [options.R] Control input weights (nu)
   * @param {Array<number>} [options.Rdelta] Control slew rate weights (nu)
   * @param {Array<number>} [options.uMin] Actuator lower limits (nu)
   * @param {Array<number>} [options.uMax] Actuator upper limits (nu)
   * @param {Array<number>} [options.deltaUMax] Actuator slew rate limits (nu)
   */
  constructor(options) {
    const required = [
      'A',
      'B',
      'C',
      'predictionHorizon',
      'controlHorizon',
      'Q',
      'R',
      'Rdelta',
      'uMin',
      'uMax',
      'deltaUMax',
      'initialControl'
    ];
    const missing = required.filter((name) => options?.[name] === undefined || options[name] === null);
    if (missing.length)
      throw new TypeError(`ModelPredictiveController requires explicit inputs: ${missing.join(', ')}.`);
    const matrixIsFinite = (matrix) =>
      Array.isArray(matrix) &&
      matrix.length > 0 &&
      matrix.every(
        (row) => Array.isArray(row) && row.length > 0 && row.length === matrix[0].length && row.every(Number.isFinite)
      );
    if (!matrixIsFinite(options.A) || !matrixIsFinite(options.B) || !matrixIsFinite(options.C)) {
      throw new TypeError('ModelPredictiveController requires finite rectangular A, B, and C matrices.');
    }
    this.A = options.A;
    this.B = options.B;
    this.C = options.C;
    this.nx = this.A.length;
    this.nu = this.B[0].length;
    this.ny = this.C.length;
    if (
      this.A.some((row) => row.length !== this.nx) ||
      this.B.length !== this.nx ||
      this.C.some((row) => row.length !== this.nx)
    ) {
      throw new TypeError('ModelPredictiveController matrix dimensions must satisfy A:n×n, B:n×nu, and C:ny×n.');
    }
    this.Np = options.predictionHorizon;
    this.Nc = options.controlHorizon;
    if (
      !Number.isInteger(this.Np) ||
      this.Np < 1 ||
      !Number.isInteger(this.Nc) ||
      this.Nc < 1 ||
      this.Nc > this.Np ||
      this.Np * this.Nc * this.nu > 5000
    ) {
      throw new RangeError('MPC horizons are invalid or exceed the 5,000 decision-variable work limit.');
    }
    const vectors = ['Q', 'R', 'Rdelta', 'uMin', 'uMax', 'deltaUMax', 'initialControl'];
    for (const name of vectors) {
      const expectedLength = name === 'Q' ? this.ny : this.nu;
      if (
        !Array.isArray(options[name]) ||
        options[name].length !== expectedLength ||
        !options[name].every(Number.isFinite)
      ) {
        throw new TypeError(`ModelPredictiveController.${name} must contain ${expectedLength} finite values.`);
      }
    }
    if (
      options.Q.some((value) => value < 0) ||
      options.R.some((value) => value <= 0) ||
      options.Rdelta.some((value) => value < 0) ||
      options.deltaUMax.some((value) => value <= 0) ||
      options.uMin.some((value, index) => value > options.uMax[index])
    ) {
      throw new RangeError('MPC weights and actuator bounds are outside the supported ranges.');
    }
    this.Q = options.Q;
    this.R = options.R;
    this.Rdelta = options.Rdelta;
    this.uMin = options.uMin;
    this.uMax = options.uMax;
    this.deltaUMax = options.deltaUMax;
    this.lastU = new Float64Array(options.initialControl);
    if (this.lastU.some((value, index) => value < this.uMin[index] || value > this.uMax[index])) {
      throw new RangeError('initialControl must lie within the supplied actuator bounds.');
    }
    this._precomputePredictionMatrices();
  }

  _precomputePredictionMatrices() {
    const Np = this.Np;
    const Nc = this.Nc;
    const nx = this.nx;
    const nu = this.nu;
    const ny = this.ny;

    // 1. Compute state powers A^k
    const Apowers = [this._eye(nx)];
    for (let i = 1; i <= Np; i++) {
      Apowers.push(GoldfarbIdnaniQPSolver._matrixMultiply(Apowers[i - 1], this.A));
    }

    // 2. Build Phi (Np*ny x nx): [C*A; C*A^2; ...; C*A^Np]
    this.Phi = Array.from({ length: Np * ny }, () => new Float64Array(nx));
    for (let p = 0; p < Np; p++) {
      const CA = GoldfarbIdnaniQPSolver._matrixMultiply(this.C, Apowers[p + 1]);
      for (let r = 0; r < ny; r++) {
        for (let c = 0; c < nx; c++) {
          this.Phi[p * ny + r][c] = CA[r][c];
        }
      }
    }

    // 3. Build Gamma (Np*ny x Nc*nu)
    this.Gamma = Array.from({ length: Np * ny }, () => new Float64Array(Nc * nu));
    for (let p = 0; p < Np; p++) {
      for (let c = 0; c < Nc; c++) {
        if (c <= p) {
          const power = p - c;
          const CApowB = GoldfarbIdnaniQPSolver._matrixMultiply(
            GoldfarbIdnaniQPSolver._matrixMultiply(this.C, Apowers[power]),
            this.B
          );
          for (let r = 0; r < ny; r++) {
            for (let col = 0; col < nu; col++) {
              this.Gamma[p * ny + r][c * nu + col] = CApowB[r][col];
            }
          }
        }
      }
    }

    // 4. Construct Hessian matrix H_qp = Gamma^T * Q_bar * Gamma + R_bar + D^T * Rdelta_bar * D
    const nVar = Nc * nu;
    const H = Array.from({ length: nVar }, () => new Float64Array(nVar));

    // Q_bar contribution
    for (let i = 0; i < nVar; i++) {
      for (let j = 0; j < nVar; j++) {
        let sum = 0.0;
        for (let p = 0; p < Np * ny; p++) {
          const qVal = this.Q[p % ny];
          sum += this.Gamma[p][i] * qVal * this.Gamma[p][j];
        }
        H[i][j] = sum;
      }
    }

    // R_bar contribution (Control weight)
    for (let c = 0; c < Nc; c++) {
      for (let u = 0; u < nu; u++) {
        const idx = c * nu + u;
        H[idx][idx] += this.R[u] + this.Rdelta[u];
        // Slew rate off-diagonal penalty
        if (c > 0) {
          const prevIdx = (c - 1) * nu + u;
          H[idx][prevIdx] -= this.Rdelta[u];
          H[prevIdx][idx] -= this.Rdelta[u];
          H[prevIdx][prevIdx] += this.Rdelta[u];
        }
      }
    }

    this.H = H;
  }

  _eye(n) {
    const I = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) I[i][i] = 1.0;
    return I;
  }

  /**
   * Computes the next optimal control action u_k given current state x0 and reference output yRef
   * @param {Array<number>} x0 Current state vector
   * @param {Array<number>|number} yRef Reference setpoint vector or scalar
   */
  computeControlAction(x0, yRef) {
    if (!Array.isArray(x0) || x0.length !== this.nx || !x0.every(Number.isFinite)) {
      throw new TypeError(`computeControlAction requires an ${this.nx}-value finite state vector.`);
    }
    const yRefVec = Array.isArray(yRef) ? yRef : [yRef];
    if (yRefVec.length !== this.ny || !yRefVec.every(Number.isFinite)) {
      throw new TypeError(`computeControlAction requires a ${this.ny}-value finite output reference.`);
    }
    const nVar = this.Nc * this.nu;
    const Np = this.Np;
    const ny = this.ny;

    // Compute free response Y_free = Phi * x0
    const Y_free = GoldfarbIdnaniQPSolver._matrixVectorMultiply(this.Phi, x0);

    // Tracking error E = Y_free - Y_ref
    const E = new Float64Array(Np * ny);
    for (let p = 0; p < Np * ny; p++) {
      E[p] = Y_free[p] - yRefVec[p % ny];
    }

    // Linear cost gradient c_qp = Gamma^T * Q_bar * E - [Rdelta * u_last; 0; ...]
    const c = new Float64Array(nVar);
    for (let i = 0; i < nVar; i++) {
      let sum = 0.0;
      for (let p = 0; p < Np * ny; p++) {
        sum += this.Gamma[p][i] * this.Q[p % ny] * E[p];
      }
      c[i] = sum;
    }
    for (let u = 0; u < this.nu; u++) {
      c[u] -= this.Rdelta[u] * this.lastU[u];
    }

    // Constraints A_ineq * U >= b_ineq
    // 1. u_k >= u_min  =>  +I * U >= U_min
    // 2. u_k <= u_max  =>  -I * U >= -U_max
    // 3. u_k - u_{k-1} <= delta_max => -(u_k - u_{k-1}) >= -delta_max
    // 4. u_k - u_{k-1} >= -delta_max => +(u_k - u_{k-1}) >= -delta_max
    const A_ineq = [];
    const b_ineq = [];

    // Box bounds uMin <= U <= uMax
    for (let i = 0; i < nVar; i++) {
      const uIdx = i % this.nu;
      // Lower bound
      const rowLow = new Float64Array(nVar);
      rowLow[i] = 1.0;
      A_ineq.push(Array.from(rowLow));
      b_ineq.push(this.uMin[uIdx]);

      // Upper bound
      const rowHigh = new Float64Array(nVar);
      rowHigh[i] = -1.0;
      A_ineq.push(Array.from(rowHigh));
      b_ineq.push(-this.uMax[uIdx]);
    }

    // Slew rate limits
    for (let cStep = 0; cStep < this.Nc; cStep++) {
      for (let u = 0; u < this.nu; u++) {
        const currIdx = cStep * this.nu + u;
        const maxRate = this.deltaUMax[u];

        // Slew rate upper: u_curr - u_prev <= deltaUMax
        const rowSlewUp = new Float64Array(nVar);
        rowSlewUp[currIdx] = -1.0;
        let boundUp = -maxRate;
        if (cStep > 0) {
          rowSlewUp[currIdx - this.nu] = 1.0;
        } else {
          boundUp -= this.lastU[u];
        }
        A_ineq.push(Array.from(rowSlewUp));
        b_ineq.push(boundUp);

        // Slew rate lower: u_curr - u_prev >= -deltaUMax
        const rowSlewLow = new Float64Array(nVar);
        rowSlewLow[currIdx] = 1.0;
        let boundLow = -maxRate;
        if (cStep > 0) {
          rowSlewLow[currIdx - this.nu] = -1.0;
        } else {
          boundLow += this.lastU[u];
        }
        A_ineq.push(Array.from(rowSlewLow));
        b_ineq.push(boundLow);
      }
    }

    // Solve via Goldfarb-Idnani QP
    const qpRes = GoldfarbIdnaniQPSolver.solve(this.H, Array.from(c), A_ineq, b_ineq);
    const uOpt = qpRes.x ? Array.from(qpRes.x.slice(0, this.nu)) : [0.0];

    // Store for next slew calculation
    for (let u = 0; u < this.nu; u++) {
      this.lastU[u] = uOpt[u];
    }

    return {
      validationLevel: 'experimental',
      u: uOpt,
      optimalSequence: qpRes.x ? Array.from(qpRes.x) : [],
      qpConverged: qpRes.converged,
      cost: qpRes.cost
    };
  }
}

module.exports = {
  GoldfarbIdnaniQPSolver,
  ModelPredictiveController
};
