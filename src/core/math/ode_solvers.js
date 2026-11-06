/**
 * Experimental numerical ODE / DAE solvers.
 * Implements explicit and stiff differential equation integration methods.
 */

class ODESolvers {
  /**
   * Runge-Kutta 4th Order (RK4) for state derivative vector dy/dt = f(t, y)
   */
  static solveRK4(f, arg2, arg3, arg4, arg5) {
    let t0, y0, dt, steps;
    if (Array.isArray(arg2)) {
      y0 = arg2;
      t0 = arg3;
      const tEnd = arg4;
      dt = arg5 || 0.01;
      if (!(dt > 0)) {
        throw new RangeError('solveRK4 requires a positive time step dt');
      }
      steps = Math.max(1, Math.round((tEnd - t0) / dt));
    } else {
      t0 = arg2;
      y0 = arg3;
      dt = arg4;
      steps = arg5;
      if (!(dt > 0)) {
        throw new RangeError('solveRK4 requires a positive time step dt');
      }
    }

    const trajectory = [{ t: t0, y: [...y0] }];
    let y = [...y0];
    const n = y0.length;

    for (let step = 0; step < steps; step++) {
      // Index-based time: t = t0 + (step + 1) * dt avoids cumulative FP rounding drift.
      const t = t0 + (step + 1) * dt;
      const tHalf = t0 + (step + 0.5) * dt;

      const k1 = f(tHalf - 0.5 * dt, y);

      const y_k2 = new Array(n);
      for (let i = 0; i < n; i++) y_k2[i] = y[i] + 0.5 * dt * k1[i];
      const k2 = f(tHalf, y_k2);

      const y_k3 = new Array(n);
      for (let i = 0; i < n; i++) y_k3[i] = y[i] + 0.5 * dt * k2[i];
      const k3 = f(tHalf, y_k3);

      const y_k4 = new Array(n);
      for (let i = 0; i < n; i++) y_k4[i] = y[i] + dt * k3[i];
      const k4 = f(t, y_k4);

      for (let i = 0; i < n; i++) {
        y[i] += (dt / 6.0) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      }
      trajectory.push({ t, y: [...y] });
    }

    return trajectory;
  }

  static rk4(f, t0, y0, dt, steps) {
    return ODESolvers.solveRK4(f, t0, y0, dt, steps);
  }

  /**
   * Adaptive Dormand-Prince RK45 integration.
   */
  static solveRK45(f, arg2, arg3, arg4, arg5 = 1e-6, arg6 = 0.01) {
    let t0, y0, tEnd, tol, hInitial;
    if (Array.isArray(arg2)) {
      y0 = arg2;
      t0 = arg3;
      tEnd = arg4;
      tol = typeof arg5 === 'number' ? arg5 : 1e-6;
      hInitial = typeof arg6 === 'number' ? arg6 : 0.01;
    } else {
      t0 = arg2;
      y0 = arg3;
      tEnd = arg4;
      tol = arg5;
      hInitial = arg6;
    }

    const trajectory = [{ t: t0, y: [...y0] }];
    let t = t0;
    let y = [...y0];
    let h = hInitial;
    const n = y0.length;

    // Butcher tableau coefficients for Dormand-Prince
    const c2 = 1 / 5,
      a21 = 1 / 5;
    const c3 = 3 / 10,
      a31 = 3 / 40,
      a32 = 9 / 40;
    const c4 = 4 / 5,
      a41 = 44 / 45,
      a42 = -56 / 15,
      a43 = 32 / 9;
    const c5 = 8 / 9,
      a51 = 19372 / 6561,
      a52 = -25360 / 2187,
      a53 = 64448 / 6561,
      a54 = -212 / 729;
    const a61 = 9017 / 3168,
      a62 = -355 / 33,
      a63 = 46732 / 5247,
      a64 = 49 / 176,
      a65 = -5103 / 18656;
    const a71 = 35 / 384,
      a73 = 500 / 1113,
      a74 = 125 / 192,
      a75 = -2187 / 6784,
      a76 = 11 / 84;

    // 4th order comparison weights
    const b1 = 5179 / 57600,
      b3 = 7571 / 16695,
      b4 = 393 / 640,
      b5 = -92097 / 339200,
      b6 = 187 / 2100,
      b7 = 1 / 40;

    let iterations = 0;
    const maxIterations = 50000;

    while (t < tEnd && iterations < maxIterations) {
      iterations++;
      if (t + h > tEnd) h = tEnd - t;

      const k1 = f(t, y);

      const y2 = y.map((val, i) => val + h * a21 * k1[i]);
      const k2 = f(t + c2 * h, y2);

      const y3 = y.map((val, i) => val + h * (a31 * k1[i] + a32 * k2[i]));
      const k3 = f(t + c3 * h, y3);

      const y4 = y.map((val, i) => val + h * (a41 * k1[i] + a42 * k2[i] + a43 * k3[i]));
      const k4 = f(t + c4 * h, y4);

      const y5 = y.map((val, i) => val + h * (a51 * k1[i] + a52 * k2[i] + a53 * k3[i] + a54 * k4[i]));
      const k5 = f(t + c5 * h, y5);

      const y6 = y.map((val, i) => val + h * (a61 * k1[i] + a62 * k2[i] + a63 * k3[i] + a64 * k4[i] + a65 * k5[i]));
      const k6 = f(t + h, y6);

      // 5th order solution
      const y_next = y.map((val, i) => val + h * (a71 * k1[i] + a73 * k3[i] + a74 * k4[i] + a75 * k5[i] + a76 * k6[i]));
      const k7 = f(t + h, y_next);

      // Error estimate between 5th and 4th order
      let maxError = 0;
      for (let i = 0; i < n; i++) {
        const y4_val = y[i] + h * (b1 * k1[i] + b3 * k3[i] + b4 * k4[i] + b5 * k5[i] + b6 * k6[i] + b7 * k7[i]);
        const err = Math.abs(y_next[i] - y4_val);
        const scale = tol * (1 + Math.max(Math.abs(y[i]), Math.abs(y_next[i])));
        maxError = Math.max(maxError, err / scale);
      }

      if (maxError <= 1.0 || h <= 1e-12) {
        // Accept step
        t += h;
        y = y_next;
        trajectory.push({ t, y: [...y] });
      }

      // Compute optimal next step size
      const factor = maxError === 0 ? 2.0 : Math.min(2.0, Math.max(0.1, 0.9 * Math.pow(1.0 / maxError, 0.2)));
      h *= factor;
      if (h < 1e-12) h = 1e-12;
      if (h > (tEnd - t0) / 10) h = (tEnd - t0) / 10;
    }

    return trajectory;
  }

  /**
   * Stiff ODE Backward Euler / BDF1 Integrator with Newton-Raphson
   */
  static bdf1Stiff(f, jacobian, t0, y0, dt, steps) {
    const trajectory = [{ t: t0, y: [...y0] }];
    let y = [...y0];
    const n = y0.length;

    for (let s = 0; s < steps; s++) {
      const tNext = t0 + (s + 1) * dt;
      // Solve: g(yNext) = yNext - y - dt * f(tNext, yNext) = 0
      let yNext = [...y]; // initial guess
      let converged = false;

      for (let iter = 0; iter < 20; iter++) {
        const fy = f(tNext, yNext);
        const residual = yNext.map((yn, i) => yn - y[i] - dt * fy[i]);

        let resNorm = 0;
        for (let i = 0; i < n; i++) resNorm += residual[i] * residual[i];
        if (Math.sqrt(resNorm) < 1e-9) {
          converged = true;
          break;
        }

        // Jacobian of g: J_g = I - dt * J_f
        const Jf = jacobian(tNext, yNext);
        const Jg = [];
        for (let r = 0; r < n; r++) {
          Jg[r] = [];
          for (let c = 0; c < n; c++) {
            const identity = r === c ? 1 : 0;
            Jg[r][c] = identity - dt * Jf[r][c];
          }
        }

        // Solve Jg * dy = -residual
        // Using simple Gaussian solve
        const minusRes = residual.map((r) => -r);
        const { LinearSolver } = require('./linear_algebra');
        const dy = LinearSolver.solveGaussian(Jg, minusRes);

        for (let i = 0; i < n; i++) {
          yNext[i] += dy[i];
        }
      }

      if (!converged) {
        const fy = f(tNext, yNext);
        const residual = yNext.map((yn, i) => yn - y[i] - dt * fy[i]);
        let resNorm = 0;
        for (let i = 0; i < n; i++) resNorm += residual[i] * residual[i];
        const resNormSqrt = Math.sqrt(resNorm);
        if (!Number.isFinite(resNormSqrt) || resNormSqrt > 1e-6) {
          throw new Error(
            `bdf1Stiff Newton iteration failed to converge at step ${s + 1} (residual ${resNormSqrt.toExponential(3)})`
          );
        }
      }

      y = yNext;
      trajectory.push({ t: tNext, y: [...y] });
    }

    return trajectory;
  }

  /**
   * Radau IIA (3-stage, order 5) fully implicit Runge-Kutta stiff solver with
   * adaptive step-size control (PI controller).
   *
   * @param {Function} f - RHS dy/dt = f(t, y); y may be an array or a number
   * @param {number} t0 - start time
   * @param {number|Array<number>} y0 - initial state
   * @param {number} tEnd - final time
   * @param {Object} [opts] - { rtol, atol, h0, safety, maxSteps }
   * @returns {Array<{t: number, y: Array<number>, step: number, h: number}>}
   */
  static solveRadauIIA(f, t0, y0, tEnd, opts = {}) {
    return new RadauIIA(opts).solve(f, t0, y0, tEnd);
  }
}

/**
 * Radau IIA, 3-stage, order 5 fully implicit Runge-Kutta method
 * (collocation at the three Radau points, stiffly accurate).
 *
 * Tableau (standard Radau IIA, see Hairer & Wanner, "Solving Ordinary
 * Differential Equations II", Table IV.5.2):
 *
 *   c = [ (4 - sqrt(6))/10, (4 + sqrt(6))/10, 1 ]
 *
 *   A = | (88 - 7√6)/360  (296 - 169√6)/1800  (-2 + 3√6)/225   |
 *       | (296 + 169√6)/1800 (88 + 7√6)/360   (-2 - 3√6)/225   |
 *       | (16 - √6)/36       (16 + √6)/36      1/9              |
 *
 *   b = A row 3 (stiffly accurate), c-values above.
 *
 * The stage equations are solved with simplified Newton iterations using a
 * numerical Jacobian of f (finite differences). Error estimation uses step
 * doubling (Richardson): local error ~ (y_half - y_full) / (2^5 - 1).
 * Step size selection uses a PI controller.
 */
class RadauIIA {
  static get ORDER() {
    return 5;
  }

  static get C() {
    const s6 = Math.sqrt(6);
    return [(4 - s6) / 10, (4 + s6) / 10, 1.0];
  }

  static get A() {
    const s6 = Math.sqrt(6);
    return [
      [(88 - 7 * s6) / 360, (296 - 169 * s6) / 1800, (-2 + 3 * s6) / 225],
      [(296 + 169 * s6) / 1800, (88 + 7 * s6) / 360, (-2 - 3 * s6) / 225],
      [(16 - s6) / 36, (16 + s6) / 36, 1 / 9]
    ];
  }

  constructor(opts = {}) {
    this.rtol = opts.rtol !== undefined ? opts.rtol : 1e-6;
    this.atol = opts.atol !== undefined ? opts.atol : 1e-9;
    this.h0 = opts.h0 !== undefined ? opts.h0 : 1e-3;
    this.safety = opts.safety !== undefined ? opts.safety : 0.9;
    this.minFactor = opts.minFactor !== undefined ? opts.minFactor : 0.2;
    this.maxFactor = opts.maxFactor !== undefined ? opts.maxFactor : 5.0;
    this.maxSteps = opts.maxSteps !== undefined ? opts.maxSteps : 100000;
    this.newtonMaxIter = opts.newtonMaxIter !== undefined ? opts.newtonMaxIter : 15;
    this.newtonTol = opts.newtonTol !== undefined ? opts.newtonTol : 1e-9;
    const p = RadauIIA.ORDER;
    this.kI = 0.7 / (p + 1);
    this.kP = 0.3 / (p + 1);
    this.c = RadauIIA.C;
    this.a = RadauIIA.A;
    this.b = this.a[2];
  }

  solve(f, t0, y0, tEnd) {
    if (!Number.isFinite(t0) || !Number.isFinite(tEnd) || tEnd < t0) {
      throw new RangeError('solveRadauIIA requires finite t0 <= tEnd');
    }
    if (!(this.rtol > 0) || !(this.atol > 0)) {
      throw new RangeError('solveRadauIIA requires positive rtol and atol');
    }
    if (!(this.h0 > 0)) {
      throw new RangeError('solveRadauIIA requires a positive initial step h0');
    }
    let n;
    let y0Arr;
    if (typeof y0 === 'number') {
      n = 1;
      y0Arr = [y0];
    } else if (Array.isArray(y0) && y0.length > 0 && y0.every(Number.isFinite)) {
      n = y0.length;
      y0Arr = [...y0];
    } else {
      throw new TypeError('solveRadauIIA requires a finite scalar or numeric-array initial state y0');
    }

    const trajectory = [{ t: t0, y: [...y0Arr], step: 0, h: 0 }];
    this._lastStages = null;
    let t = t0;
    let y = y0Arr;
    let h = Math.min(this.h0, tEnd - t0);
    let errPrev = 1.0;
    let steps = 0;

    while (t < tEnd && steps < this.maxSteps) {
      if (t + h > tEnd) h = tEnd - t;
      if (!(h > 0)) break;

      const half = h / 2;
      const full = this._tryStep(f, t, y, h);
      const firstHalf = this._tryStep(f, t, y, half);
      if (full === null || firstHalf === null) {
        h *= this.minFactor;
        if (h < 1e-14 * Math.max(1, Math.abs(t))) {
          throw new RangeError('solveRadauIIA stalled: step size has collapsed at t=' + t);
        }
        continue;
      }
      const secondHalf = this._tryStep(f, firstHalf.t, firstHalf.y, half);
      if (secondHalf === null) {
        h *= this.minFactor;
        continue;
      }

      const yHalf = secondHalf.y;
      const yFull = full.y;
      let err = 0;
      for (let i = 0; i < n; i++) {
        const est = Math.abs(yHalf[i] - yFull[i]) / (Math.pow(2, RadauIIA.ORDER) - 1);
        const scale = this.atol + this.rtol * Math.max(Math.abs(y[i]), Math.abs(yHalf[i]));
        err = Math.max(err, est / scale);
      }

      if (err <= 1 || h <= 1e-14 * Math.max(1, Math.abs(t))) {
        steps++;
        y = yHalf;
        t = secondHalf.t;
        trajectory.push({ t, y: [...y], step: steps, h });
        if (err === 0) err = 1e-99;
        const factor = this.safety * Math.pow(1 / err, this.kI) * Math.pow(errPrev, this.kP);
        const clamped = Math.max(this.minFactor, Math.min(this.maxFactor, factor));
        errPrev = err;
        h *= clamped;
        if (tEnd - t < h) h = tEnd - t;
      } else {
        const factor = this.safety * Math.pow(1 / err, this.kI) * Math.pow(errPrev, this.kP);
        const clamped = Math.max(this.minFactor, Math.min(this.maxFactor, factor));
        h *= clamped;
        errPrev = Math.max(err, 1e-12);
        if (h < 1e-14 * Math.max(1, Math.abs(t))) {
          throw new RangeError('solveRadauIIA stalled: step size collapsed at t=' + t);
        }
      }
    }

    if (steps >= this.maxSteps && t < tEnd) {
      throw new RangeError('solveRadauIIA exceeded maxSteps (' + this.maxSteps + ') without reaching tEnd');
    }

    return trajectory;
  }

  _tryStep(f, t, y, h) {
    const n = y.length;
    const jf = this._numericJacobian(f, t, y);
    if (jf === null) return null;
    const stages = this._solveStages(f, t, y, h, jf);
    if (stages === null) return null;
    const a3 = this.a[2];
    const yNext = new Array(n);
    for (let i = 0; i < n; i++) {
      yNext[i] = y[i] + h * (a3[0] * stages[i] + a3[1] * stages[n + i] + a3[2] * stages[2 * n + i]);
    }
    if (!yNext.every(Number.isFinite)) return null;
    return { t: t + h, y: yNext, stages };
  }

  _solveStages(f, t, y, h, jf) {
    const n = y.length;
    const N = 3 * n;
    const c = this.c;
    const a = this.a;

    const stages = new Array(N);
    if (this._lastStages && this._lastStages.length === N) {
      for (let i = 0; i < N; i++) stages[i] = this._lastStages[i];
    } else {
      const f0 = this._evalF(f, t, y);
      if (f0 === null) return null;
      for (let s = 0; s < 3; s++) {
        for (let i = 0; i < n; i++) stages[s * n + i] = f0[i];
      }
    }

    let currentJf = jf;
    let lastNorm = Infinity;
    let refreshCount = 0;

    for (let iter = 0; iter < this.newtonMaxIter; iter++) {
      const residual = new Array(N);
      let norm = 0;
      for (let s = 0; s < 3; s++) {
        const args = new Array(n);
        for (let i = 0; i < n; i++) {
          let sum = y[i];
          for (let j = 0; j < 3; j++) sum += h * a[s][j] * stages[j * n + i];
          args[i] = sum;
        }
        const fs = this._evalF(f, t + c[s] * h, args);
        if (fs === null) return null;
        for (let i = 0; i < n; i++) {
          const r = stages[s * n + i] - fs[i];
          residual[s * n + i] = r;
          const abs = Math.abs(r);
          if (abs > norm) norm = abs;
        }
      }

      if (norm <= this.newtonTol * Math.max(1, h)) {
        this._lastStages = [...stages];
        return stages;
      }

      if (norm >= lastNorm && refreshCount < 2) {
        const fresh = this._numericJacobian(f, t, y);
        if (fresh !== null) currentJf = fresh;
        refreshCount++;
      }
      lastNorm = norm;

      const M = [];
      for (let r = 0; r < N; r++) {
        const row = new Array(N).fill(0);
        const s1 = Math.floor(r / n);
        const i1 = r % n;
        row[r] = 1;
        for (let s2 = 0; s2 < 3; s2++) {
          const coeff = h * a[s1][s2];
          if (coeff !== 0) {
            for (let i2 = 0; i2 < n; i2++) {
              row[s2 * n + i2] -= coeff * currentJf[i1][i2];
            }
          }
        }
        M[r] = row;
      }

      const { LinearSolver } = require('./linear_algebra');
      let delta;
      try {
        delta = LinearSolver.solveGaussian(M, residual.map((r) => -r));
      } catch (err) {
        if (refreshCount < 2) {
          const fresh = this._numericJacobian(f, t, y);
          if (fresh !== null) {
            currentJf = fresh;
            refreshCount++;
            continue;
          }
        }
        return null;
      }

      const deltaNorm = Math.max(...delta.map(Math.abs));
      const stagesNorm = Math.max(...stages.map(Math.abs), 1);
      const cap = 20 * stagesNorm;
      const relax = deltaNorm > cap ? cap / deltaNorm : 1;

      for (let r = 0; r < N; r++) {
        stages[r] += relax * delta[r];
        if (!Number.isFinite(stages[r])) return null;
      }
    }

    const stagesNorm = Math.max(...stages.map(Math.abs), 1);
    if (lastNorm <= 1e-7 * stagesNorm) {
      this._lastStages = [...stages];
      return stages;
    }
    return null;
  }

  _evalF(f, t, y) {
    let res;
    try {
      res = f(t, y);
    } catch (err) {
      return null;
    }
    if (typeof res === 'number') {
      return Number.isFinite(res) ? [res] : null;
    }
    if (Array.isArray(res) && res.every(Number.isFinite)) {
      return [...res];
    }
    return null;
  }

  _numericJacobian(f, t, y) {
    const n = y.length;
    const f0 = this._evalF(f, t, y);
    if (f0 === null) return null;
    const J = [];
    for (let j = 0; j < n; j++) {
      const eps = 1e-7 * Math.max(1, Math.abs(y[j]));
      const yp = [...y];
      yp[j] += eps;
      const fp = this._evalF(f, t, yp);
      if (fp === null) return null;
      const col = new Array(n);
      for (let i = 0; i < n; i++) col[i] = (fp[i] - f0[i]) / eps;
      J[j] = col;
    }
    return J;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ODESolvers, RadauIIA };
}
