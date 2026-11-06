/**
 * Flowsheet Tear-Stream Recycle Convergence Accelerator
 * 
 * Implements iterative methods for solving cyclic recycle loops in process flowsheets:
 * - Direct Successive Substitution: x_{k+1} = g(x_k)
 * - Bounded Wegstein Method: s = (g_k - g_{k-1}) / (x_k - x_{k-1}), q = s / (s - 1), clamped to [q_min, q_max]
 * - Multi-variable Broyden Quasi-Newton Method: Inverted Jacobian rank-1 update
 * 
 * Provides configurable stopping checks, Wegstein bounds, and residual history.
 */

'use strict';

class WegsteinRecycleSolver {
  /**
   * @param {Object} [config]
   * @param {'wegstein'|'successive'|'broyden'} [config.method='wegstein']
   * @param {number} [config.maxIter=100]
   * @param {number} [config.relTol=1e-6]
   * @param {number} [config.absTol=1e-8]
   * @param {number} [config.qMin=-5.0] Minimum Wegstein parameter (dampening)
   * @param {number} [config.qMax=0.0] Maximum Wegstein parameter (acceleration)
   */
  constructor(config = {}) {
    this.method = config.method || 'wegstein';
    this.maxIter = config.maxIter || 100;
    this.relTol = config.relTol || 1e-6;
    this.absTol = config.absTol || 1e-8;
    this.qMin = config.qMin !== undefined ? config.qMin : -5.0;
    this.qMax = config.qMax !== undefined ? config.qMax : 0.0;
  }

  /**
   * Solve recycle tear stream convergence
   * @param {Float64Array|Array<number>} x0 Initial guess of tear stream variables
   * @param {Function} evalFlowsheet Function mapping x -> g(x) (returns new tear stream values)
   * @returns {{ x: Float64Array, iterations: number, converged: boolean, residual: number, history: Array<number> }}
   */
  solve(x0, evalFlowsheet) {
    const N = x0.length;
    let x_prev = new Float64Array(x0);
    let g_prev = new Float64Array(evalFlowsheet(x_prev));

    // Initial check
    let res = this._norm(x_prev, g_prev);
    const history = [res];

    if (res < this.absTol) {
      return {
        x: x_prev,
        iterations: 0,
        converged: true,
        residual: res,
        history
      };
    }

    if (this.method === 'successive') {
      return this._solveSuccessive(x_prev, g_prev, evalFlowsheet, history);
    } else if (this.method === 'broyden') {
      return this._solveBroyden(x_prev, g_prev, evalFlowsheet, history);
    } else {
      return this._solveWegstein(x_prev, g_prev, evalFlowsheet, history);
    }
  }

  /**
   * Successive substitution
   */
  _solveSuccessive(x_curr, g_curr, evalFlowsheet, history) {
    let converged = false;
    let iter = 0;
    let res = 0;

    for (iter = 1; iter <= this.maxIter; iter++) {
      x_curr = new Float64Array(g_curr);
      g_curr = new Float64Array(evalFlowsheet(x_curr));

      res = this._norm(x_curr, g_curr);
      history.push(res);

      if (res < this.absTol || this._relativeNorm(x_curr, g_curr) < this.relTol) {
        converged = true;
        break;
      }
    }

    return {
      x: g_curr,
      iterations: iter,
      converged,
      residual: res,
      history
    };
  }

  /**
   * Bounded Wegstein acceleration
   */
  _solveWegstein(x0, g0, evalFlowsheet, history) {
    const N = x0.length;
    let x_k_minus_1 = new Float64Array(x0);
    let g_k_minus_1 = new Float64Array(g0);

    // Step 1: Execute one successive substitution to obtain two points
    let x_k = new Float64Array(g_k_minus_1);
    let g_k = new Float64Array(evalFlowsheet(x_k));

    let res = this._norm(x_k, g_k);
    history.push(res);

    if (res < this.absTol) {
      return { x: g_k, iterations: 1, converged: true, residual: res, history };
    }

    let converged = false;
    let iter = 1;

    for (iter = 2; iter <= this.maxIter; iter++) {
      const x_next = new Float64Array(N);

      for (let i = 0; i < N; i++) {
        const dx = x_k[i] - x_k_minus_1[i];
        const dg = g_k[i] - g_k_minus_1[i];

        let q = 0.0;
        if (Math.abs(dx) > 1e-14) {
          const s = dg / dx;
          if (Math.abs(s - 1.0) > 1e-6) {
            q = s / (s - 1.0);
          } else {
            q = this.qMin;
          }
        }

        // Clamp q to bounded range
        q = Math.max(this.qMin, Math.min(this.qMax, q));

        // Wegstein equation: x_{k+1} = q * x_{k-1} + (1 - q) * g_k
        x_next[i] = q * x_k_minus_1[i] + (1 - q) * g_k[i];
      }

      // Shift history
      x_k_minus_1 = x_k;
      g_k_minus_1 = g_k;
      x_k = x_next;
      g_k = new Float64Array(evalFlowsheet(x_k));

      res = this._norm(x_k, g_k);
      history.push(res);

      if (res < this.absTol || this._relativeNorm(x_k, g_k) < this.relTol) {
        converged = true;
        break;
      }
    }

    return {
      x: g_k,
      iterations: iter,
      converged,
      residual: res,
      history
    };
  }

  /**
   * Multi-variable Broyden Quasi-Newton method
   */
  _solveBroyden(x0, g0, evalFlowsheet, history) {
    const N = x0.length;
    let x = new Float64Array(x0);
    let g = new Float64Array(g0);

    // Initial inverse Jacobian H_0 = -I (since f(x) = x - g(x))
    let H = Array.from({ length: N }, (_, i) => {
      const row = new Float64Array(N);
      row[i] = -1.0;
      return row;
    });

    let f = new Float64Array(N);
    for (let i = 0; i < N; i++) f[i] = x[i] - g[i];

    let converged = false;
    let iter = 0;
    let res = this._norm(x, g);

    for (iter = 1; iter <= this.maxIter; iter++) {
      // Step delta_x = - H * f
      const delta_x = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        let sum = 0;
        for (let j = 0; j < N; j++) {
          sum += H[i][j] * f[j];
        }
        delta_x[i] = -sum;
      }

      const x_new = new Float64Array(N);
      for (let i = 0; i < N; i++) x_new[i] = x[i] + delta_x[i];

      const g_new = new Float64Array(evalFlowsheet(x_new));
      const f_new = new Float64Array(N);
      for (let i = 0; i < N; i++) f_new[i] = x_new[i] - g_new[i];

      res = this._norm(x_new, g_new);
      history.push(res);

      if (res < this.absTol || this._relativeNorm(x_new, g_new) < this.relTol) {
        x = x_new;
        converged = true;
        break;
      }

      // Broyden rank-1 inverse Jacobian update
      // delta_f = f_new - f
      const delta_f = new Float64Array(N);
      for (let i = 0; i < N; i++) delta_f[i] = f_new[i] - f[i];

      // H * delta_f
      const H_df = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          H_df[i] += H[i][j] * delta_f[j];
        }
      }

      // delta_x^T * H
      const dx_T_H = new Float64Array(N);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          dx_T_H[j] += delta_x[i] * H[i][j];
        }
      }

      // denom = delta_x^T * H * delta_f
      let denom = 0;
      for (let i = 0; i < N; i++) denom += dx_T_H[i] * delta_f[i];

      if (Math.abs(denom) > 1e-12) {
        for (let i = 0; i < N; i++) {
          const num_i = delta_x[i] - H_df[i];
          for (let j = 0; j < N; j++) {
            H[i][j] += (num_i * dx_T_H[j]) / denom;
          }
        }
      }

      x = x_new;
      f = f_new;
      g = g_new;
    }

    return {
      x,
      iterations: iter,
      converged,
      residual: res,
      history
    };
  }

  _norm(x, g) {
    let maxDiff = 0;
    for (let i = 0; i < x.length; i++) {
      const diff = Math.abs(x[i] - g[i]);
      if (diff > maxDiff) maxDiff = diff;
    }
    return maxDiff;
  }

  _relativeNorm(x, g) {
    let maxRel = 0;
    for (let i = 0; i < x.length; i++) {
      const scale = Math.max(1e-4, Math.abs(x[i]));
      const rel = Math.abs(x[i] - g[i]) / scale;
      if (rel > maxRel) maxRel = rel;
    }
    return maxRel;
  }
}

module.exports = {
  WegsteinRecycleSolver
};
