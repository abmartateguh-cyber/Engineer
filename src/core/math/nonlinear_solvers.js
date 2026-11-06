/**
 * Nonlinear equation solvers (verification gate, Battalion 1 / Agent 08).
 *
 * Deterministic, dependency-free implementations of:
 *   - Newton's method with analytic Jacobian,
 *   - Broyden's quasi-Newton method (secant Jacobian update),
 *   - dogleg trust-region method (globalized Newton),
 *   - Armijo-Goldstein (sufficient decrease) line search,
 *   - binary isothermal flash with non-ideal Wilson activity coefficients.
 */

'use strict';

class NonlinearSolvers {
  /**
   * Dense Gaussian elimination with partial pivoting for n x n systems.
   * Returns solution vector of A x = b or null if A is singular.
   */
  static solveLinear(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      }
      if (Math.abs(M[pivot][col]) < 1e-300) return null;
      if (pivot !== col) {
        const tmp = M[col];
        M[col] = M[pivot];
        M[pivot] = tmp;
      }
      for (let r = col + 1; r < n; r++) {
        const f = M[r][col] / M[col][col];
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let acc = M[r][n];
      for (let c = r + 1; c < n; c++) acc -= M[r][c] * x[c];
      x[r] = acc / M[r][r];
    }
    return x;
  }

  static _norm(v) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    return Math.sqrt(s);
  }

  static _evalArray(F, x) {
    const r = F(x);
    return Array.isArray(r) ? r : [r];
  }

  /**
   * Forward-difference Jacobian (n x n) of F at x.
   */
  static numericalJacobian(F, x) {
    const n = x.length;
    const f0 = NonlinearSolvers._evalArray(F, x);
    const J = [];
    for (let j = 0; j < n; j++) {
      const h = 1e-7 * Math.max(1, Math.abs(x[j]));
      const xp = [...x];
      xp[j] += h;
      const fp = NonlinearSolvers._evalArray(F, xp);
      const col = new Array(n);
      for (let i = 0; i < n; i++) col[i] = (fp[i] - f0[i]) / h;
      J.push(col);
    }
    return J;
  }

  /**
   * Newton's method with analytic Jacobian.
   * F: x -> residual array; J: x -> n x n Jacobian matrix.
   * Returns { x, residual, iterations, converged, steps }.
   */
  static newtonSolve(F, J, x0, opts = {}) {
    const tol = opts.tol !== undefined ? opts.tol : 1e-12;
    const maxIter = opts.maxIter !== undefined ? opts.maxIter : 50;
    let x = [...x0];
    const steps = [];
    let f = NonlinearSolvers._evalArray(F, x);
    let iterations = 0;
    for (; iterations < maxIter; iterations++) {
      const r = NonlinearSolvers._norm(f);
      if (r <= tol) {
        return { x, residual: r, iterations, converged: true, steps };
      }
      const Jf = J(x);
      const step = NonlinearSolvers.solveLinear(
        Jf,
        f.map((v) => -v)
      );
      if (step === null) {
        return { x, residual: r, iterations, converged: false, steps };
      }
      for (let i = 0; i < x.length; i++) x[i] += step[i];
      steps.push(NonlinearSolvers._norm(step));
      f = NonlinearSolvers._evalArray(F, x);
    }
    return {
      x,
      residual: NonlinearSolvers._norm(f),
      iterations,
      converged: false,
      steps
    };
  }

  /**
   * Broyden's "good" quasi-Newton method.
   * No analytic Jacobian required: B0 is initialized by forward differences
   * (or identity) and updated with the secant formula
   *   B_{k+1} = B_k + (y_k - B_k s_k) s_k^T / (s_k^T s_k).
   */
  static broydenSolve(F, x0, opts = {}) {
    const tol = opts.tol !== undefined ? opts.tol : 1e-10;
    const maxIter = opts.maxIter !== undefined ? opts.maxIter : 100;
    const B0 = opts.B0 !== undefined ? opts.B0 : 'fd';
    const n = x0.length;
    let x = [...x0];
    let B =
      B0 === 'identity'
        ? Array.from({ length: n }, (_, i) => {
            const row = new Array(n).fill(0);
            row[i] = 1;
            return row;
          })
        : NonlinearSolvers.numericalJacobian(F, x);
    let f = NonlinearSolvers._evalArray(F, x);
    let iterations = 0;
    for (; iterations < maxIter; iterations++) {
      const r = NonlinearSolvers._norm(f);
      if (r <= tol) {
        return { x, residual: r, iterations, converged: true };
      }
      const s = NonlinearSolvers.solveLinear(
        B,
        f.map((v) => -v)
      );
      if (s === null) {
        return { x, residual: r, iterations, converged: false };
      }
      for (let i = 0; i < n; i++) x[i] += s[i];
      const fNew = NonlinearSolvers._evalArray(F, x);
      const y = fNew.map((v, i) => v - f[i]);
      let ss = 0;
      for (let i = 0; i < n; i++) ss += s[i] * s[i];
      if (ss > 0) {
        const Bs = B.map((row) => {
          let acc = 0;
          for (let j = 0; j < n; j++) acc += row[j] * s[j];
          return acc;
        });
        for (let i = 0; i < n; i++) {
          const w = (y[i] - Bs[i]) / ss;
          for (let j = 0; j < n; j++) B[i][j] += w * s[j];
        }
      }
      f = fNew;
    }
    return {
      x,
      residual: NonlinearSolvers._norm(f),
      iterations,
      converged: false
    };
  }

  /**
   * Dogleg trust-region method (globalized Newton).
   * At each step the Gauss-Newton step is truncated to the trust region along
   * the dogleg path (Cauchy point -> full Newton step), so the algorithm
   * cannot overshoot the way plain Newton does.
   */
  static trustRegionDogleg(F, J, x0, opts = {}) {
    const tol = opts.tol !== undefined ? opts.tol : 1e-10;
    const maxIter = opts.maxIter !== undefined ? opts.maxIter : 200;
    const delta0 = opts.delta0 !== undefined ? opts.delta0 : 1.0;
    const deltaMax = opts.deltaMax !== undefined ? opts.deltaMax : 100.0;
    let x = [...x0];
    let delta = delta0;
    let f = NonlinearSolvers._evalArray(F, x);
    let iterations = 0;
    let maxStepNorm = 0;
    for (; iterations < maxIter; iterations++) {
      const r = NonlinearSolvers._norm(f);
      if (r <= tol) {
        return {
          x,
          residual: r,
          iterations,
          converged: true,
          maxStepNorm,
          delta
        };
      }
      const Jf = J(x);
      const g = new Array(x.length).fill(0);
      for (let i = 0; i < x.length; i++) {
        for (let j = 0; j < x.length; j++) g[i] += Jf[j][i] * f[j];
      }
      let gNormSq = 0;
      for (let i = 0; i < g.length; i++) gNormSq += g[i] * g[i];
      let JgNormSq = 0;
      if (gNormSq > 0) {
        for (let i = 0; i < x.length; i++) {
          let acc = 0;
          for (let j = 0; j < x.length; j++) acc += Jf[i][j] * g[j];
          JgNormSq += acc * acc;
        }
      }
      const sNewt = NonlinearSolvers.solveLinear(
        Jf,
        f.map((v) => -v)
      );
      let sCauchy = new Array(x.length).fill(0);
      if (gNormSq > 0 && JgNormSq > 0) {
        const factor = gNormSq / JgNormSq;
        for (let i = 0; i < g.length; i++) sCauchy[i] = -factor * g[i];
      }
      let s = new Array(x.length).fill(0);
      let stepNorm = 0;
      if (sNewt !== null) {
        let ntNorm = NonlinearSolvers._norm(sNewt);
        if (ntNorm <= delta) {
          s = sNewt;
        } else {
          const cNorm = NonlinearSolvers._norm(sCauchy);
          if (cNorm >= delta) {
            const scale = delta / (cNorm > 0 ? cNorm : 1);
            for (let i = 0; i < s.length; i++) s[i] = sCauchy[i] * scale;
          } else {
            let dNormSq = 0;
            let sDotD = 0;
            for (let i = 0; i < s.length; i++) {
              const d = sNewt[i] - sCauchy[i];
              dNormSq += d * d;
              sDotD += sCauchy[i] * d;
            }
            const cNormSq = cNorm * cNorm;
            let lambda = 1;
            if (dNormSq > 0) {
              const disc = sDotD * sDotD - dNormSq * (cNormSq - delta * delta);
              if (disc >= 0) {
                lambda = (-sDotD + Math.sqrt(disc)) / dNormSq;
                lambda = Math.min(1, Math.max(0, lambda));
              } else {
                lambda = 1;
              }
            }
            for (let i = 0; i < s.length; i++) {
              s[i] = sCauchy[i] + lambda * (sNewt[i] - sCauchy[i]);
            }
          }
        }
        stepNorm = NonlinearSolvers._norm(s);
        maxStepNorm = Math.max(maxStepNorm, stepNorm);
      } else {
        stepNorm = NonlinearSolvers._norm(sCauchy);
        maxStepNorm = Math.max(maxStepNorm, stepNorm);
        s = sCauchy;
      }
      if (stepNorm <= 0) {
        return { x, residual: r, iterations, converged: false, maxStepNorm, delta };
      }
      const xTrial = x.map((v, i) => v + s[i]);
      const fTrial = NonlinearSolvers._evalArray(F, xTrial);
      let pred = 0;
      let actual = 0;
      for (let i = 0; i < f.length; i++) {
        let model = f[i];
        for (let j = 0; j < s.length; j++) model += Jf[i][j] * s[j];
        pred += f[i] * f[i] - model * model;
        actual += f[i] * f[i] - fTrial[i] * fTrial[i];
      }
      const rho = pred > 0 ? actual / pred : actual > 0 ? 1 : -1;
      if (rho > 0) {
        x = xTrial;
        f = fTrial;
      }
      if (rho > 0.75) {
        delta = Math.min(deltaMax, 2 * delta);
      } else if (rho < 0.25) {
        delta = Math.max(delta / 2, 1e-12);
      }
    }
    return {
      x,
      residual: NonlinearSolvers._norm(f),
      iterations,
      converged: false,
      maxStepNorm,
      delta
    };
  }

  /**
   * Armijo-Goldstein line search for scalar phi(alpha) = f(x0 + alpha*d).
   * Returns the largest alpha in [alphaMin, alpha0] satisfying sufficient
   * decrease: phi(alpha) <= phi(0) + c1 * alpha * phi'(0).
   */
  static armijoGoldsteinLineSearch(f, x0, dir, opts = {}) {
    const c1 = opts.c1 !== undefined ? opts.c1 : 1e-4;
    const alpha0 = opts.alpha0 !== undefined ? opts.alpha0 : 1.0;
    const alphaMin = opts.alphaMin !== undefined ? opts.alphaMin : 1e-10;
    const maxIter = opts.maxIter !== undefined ? opts.maxIter : 60;
    let phi0 = f(x0);
    let slope0 = 0;
    const h = 1e-7 * Math.max(1, Math.abs(phi0));
    for (let i = 0; i < x0.length; i++) {
      const xp = [...x0];
      xp[i] += h;
      slope0 += ((f(xp) - phi0) / h) * dir[i];
    }
    let alpha = alpha0;
    let phi = f(x0.map((v, i) => v + alpha * dir[i]));
    let iterations = 0;
    while (phi > phi0 + c1 * alpha * slope0 && alpha > alphaMin && iterations < maxIter) {
      alpha *= 0.5;
      phi = f(x0.map((v, i) => v + alpha * dir[i]));
      iterations++;
    }
    return {
      alpha,
      phi0,
      phi,
      slope0,
      sufficientDecrease: phi <= phi0 + c1 * alpha * slope0,
      iterations
    };
  }

  /**
   * Binary isothermal flash with non-ideal (Wilson) activity coefficients.
   * Unknowns: vapor fraction beta, liquid mole fraction x1.
   * Implicit equations (both must close to ~0 at solution):
   *   F1 = x1 + x2 - 1            (liquid composition closure)
   *   F2 = y1 + y2 - 1            (vapor composition closure)
   * with x_i = z_i / (1 + beta(K_i - 1)), y_i = K_i x_i and
   * K_i = gamma_i * P_sat_i(T) / P, gamma_i from the Wilson model.
   */
  static isothermalFlashWilson(z, T, P, opts = {}) {
    const antoine =
      opts.antoine !== undefined
        ? opts.antoine
        : {
            comp1: { A: 7.11714, B: 1210.595, C: 229.664 },
            comp2: { A: 8.20417, B: 1642.89, C: 230.3 }
          };
    const wilson = opts.wilson !== undefined ? opts.wilson : { lambda12: 0.6, lambda21: 0.8 };
    const Pscale = opts.Pscale !== undefined ? opts.Pscale : 760.0;
    const x0 = opts.x0 !== undefined ? opts.x0 : [0.4, 0.6];
    const tol = opts.tol !== undefined ? opts.tol : 1e-10;
    const maxIter = opts.maxIter !== undefined ? opts.maxIter : 200;

    const psat = (comp) => {
      const TC = T - 273.15;
      return Math.pow(10, comp.A - comp.B / (comp.C + TC)) / Pscale;
    };
    const logGamma = (x1) => {
      const x2 = 1 - x1;
      const L12 = wilson.lambda12;
      const L21 = wilson.lambda21;
      const d1 = x1 + L12 * x2;
      const d2 = x2 + L21 * x1;
      const lg1 = -Math.log(d1) + x2 * (L12 / d1 - L21 / d2);
      const lg2 = -Math.log(d2) - x1 * (L12 / d1 - L21 / d2);
      return [lg1, lg2];
    };

    const F = (vars) => {
      const beta = vars[0];
      const x1 = vars[1];
      const x2 = 1 - x1;
      const [lg1, lg2] = logGamma(x1);
      const K1 = (Math.exp(lg1) * psat(antoine.comp1)) / P;
      const K2 = (Math.exp(lg2) * psat(antoine.comp2)) / P;
      const den1 = 1 + beta * (K1 - 1);
      const den2 = 1 + beta * (K2 - 1);
      const xl1 = z[0] / den1;
      const xl2 = z[1] / den2;
      const y1 = K1 * xl1;
      const y2 = K2 * xl2;
      return [xl1 + xl2 - 1, y1 + y2 - 1];
    };

    const sol = NonlinearSolvers.broydenSolve(F, x0, { tol, maxIter });
    if (!sol.converged) {
      return { ...sol, beta: null, x: null, y: null, K: null, closures: null };
    }
    const beta = sol.x[0];
    const x1 = sol.x[1];
    const x2 = 1 - x1;
    const [lg1, lg2] = logGamma(x1);
    const K1 = (Math.exp(lg1) * psat(antoine.comp1)) / P;
    const K2 = (Math.exp(lg2) * psat(antoine.comp2)) / P;
    const den1 = 1 + beta * (K1 - 1);
    const den2 = 1 + beta * (K2 - 1);
    const xl1 = z[0] / den1;
    const xl2 = z[1] / den2;
    const y1 = K1 * xl1;
    const y2 = K2 * xl2;
    return {
      residual: sol.residual,
      iterations: sol.iterations,
      converged: true,
      beta,
      x: [xl1, xl2],
      y: [y1, y2],
      K: [K1, K2],
      closures: {
        sumX: xl1 + xl2 - 1,
        sumY: y1 + y2 - 1,
        yMinusKx: Math.max(Math.abs(y1 - K1 * xl1), Math.abs(y2 - K2 * xl2))
      }
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NonlinearSolvers };
}
