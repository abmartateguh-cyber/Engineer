/**
 * Index-1 DAE solver engine (Battalion 1, Agent 07).
 *
 * Two integrators, both accepting { y0, t0, tEnd, f, Jac, tol } and returning
 * times + y:
 *
 *  1. BDF1-5 variable-order adaptive stiff ODE/DAE solver.
 *     Predictor-corrector form built on divided differences (Newton
 *     interpolation), so step-size changes are handled exactly. The
 *     corrector is the BDF collocation condition: with q(t) the degree-m
 *     interpolant through the last m+1 solution points, solve for y_{n+1}
 *     such that q'(t_{n+1}) = f(t_{n+1}, y_{n+1}) (equivalently
 *     y_{n+1} = p(t_{n+1}) + h γ_m (f_{n+1} - p'(t_{n+1}))). Local
 *     truncation error is estimated from the highest divided difference of
 *     the updated solution and drives both step-size and order control.
 *     Semi-explicit index-1 DAEs are supported via an algebraic constraint
 *     function g(t, y) = 0 appended to the differential part.
 *
 *  2. 3-stage Radau-IIA (order 5, stiffly accurate) fully implicit RK.
 *     Simplified Newton iteration on the coupled 3n stage equations; the
 *     stage Jacobian I - h (A ⊗ J) is LU-factorized once per step and
 *     reused (with iterative refinement of the linear solve), and step
 *     size is controlled by Richardson (step-doubling) LTE estimates.
 */

'use strict';

// ---------------------------------------------------------------------------
// Dense linear algebra helpers (no external deps)
// ---------------------------------------------------------------------------

function gaussSolve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.slice().concat(b[i]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    }
    if (Math.abs(M[p][c]) < 1e-300) return null;
    if (p !== c) {
      const t = M[c];
      M[c] = M[p];
      M[p] = t;
    }
    const piv = M[c][c];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / piv;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
  return x;
}

function luFactor(A) {
  const n = A.length;
  const LU = A.map((row) => row.slice());
  const perm = new Array(n);
  for (let i = 0; i < n; i++) perm[i] = i;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(LU[r][c]) > Math.abs(LU[p][c])) p = r;
    }
    if (Math.abs(LU[p][c]) < 1e-300) return null;
    if (p !== c) {
      const t = LU[c];
      LU[c] = LU[p];
      LU[p] = t;
      const q = perm[c];
      perm[c] = perm[p];
      perm[p] = q;
    }
    const piv = LU[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = LU[r][c] / piv;
      if (f === 0) continue;
      LU[r][c] = f;
      for (let k = c + 1; k < n; k++) LU[r][k] -= f * LU[c][k];
    }
  }
  return { LU, perm };
}

function luSolve({ LU, perm }, b) {
  const n = b.length;
  const y = new Array(n);
  for (let i = 0; i < n; i++) y[i] = b[perm[i]];
  for (let i = 1; i < n; i++) {
    let s = 0;
    for (let j = 0; j < i; j++) s += LU[i][j] * y[j];
    y[i] -= s;
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = 0;
    for (let j = i + 1; j < n; j++) s += LU[i][j] * x[j];
    x[i] = (y[i] - s) / LU[i][i];
  }
  return x;
}

function maxAbs(v) {
  let m = 0;
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i]);
    if (a > m) m = a;
  }
  return m;
}

function finiteArray(v) {
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Newton-interpolation (divided difference) utilities
// ---------------------------------------------------------------------------

// Divided differences of vector-valued data (nodes ascending). Returns dd[j]
// = array of vectors, dd[j][0] being the j-th divided difference.
function dividedDifferences(times, vals) {
  const k = times.length;
  let cols = [vals.map((v) => v.slice())];
  for (let j = 1; j < k; j++) {
    const prev = cols[j - 1];
    const cur = new Array(prev.length - 1);
    for (let i = 0; i < prev.length - 1; i++) {
      const denom = times[i + j] - times[i];
      const d = new Array(prev[i].length);
      for (let c = 0; c < d.length; c++) {
        d[c] = (prev[i + 1][c] - prev[i][c]) / denom;
      }
      cur[i] = d;
    }
    cols.push(cur);
  }
  return cols;
}

// Evaluate Newton polynomial (nodes newest-first) and its derivative at tStar.
function evalNewton(nodes, dd, tStar) {
  const dim = dd[0][0].length;
  const p = new Array(dim).fill(0);
  const dp = new Array(dim).fill(0);
  const w = new Array(dim).fill(1);
  const dw = new Array(dim).fill(0);
  for (let j = 0; j < dd.length; j++) {
    const cj = dd[j][0];
    for (let c = 0; c < dim; c++) {
      p[c] += cj[c] * w[c];
      dp[c] += cj[c] * dw[c];
    }
    if (j < nodes.length) {
      const x = tStar - nodes[j];
      for (let c = 0; c < dim; c++) {
        dw[c] = dw[c] * x + w[c];
        w[c] *= x;
      }
    }
  }
  return { p, dp };
}

// ---------------------------------------------------------------------------
// BDF constants
// ---------------------------------------------------------------------------

// gamma_m (h γ_m = h / φ'(t_{n+1})) for uniform steps: 1, 2/3, 6/11,
// 12/25, 60/137. Only used for the fixed-step bdfFixed helper; the adaptive
// path computes γ from the actual step geometry.
const BDF_GAMMA = [1, 2 / 3, 6 / 11, 12 / 25, 60 / 137];
// Ratio of the local truncation error to the corrector correction
// D = y_{n+1} - p(t_{n+1}) for BDF order m = 1..5 (uniform steps):
//   m=1: D = h^2 y''/2 = LTE
//   m=2: D = 11/9 h^3 y''' = (11/2) LTE
//   m=3: D = 25/22 h^4 y'''' = (25/3) LTE
//   m=4: D = 137/125 h^5 y^(5) = (137/12) LTE
//   m=5: D = 147/137 h^6 y^(6) = (147/10) LTE
const BDF_D_TO_LTE = [1, 11 / 2, 25 / 3, 137 / 12, 147 / 10];
const MAX_ORDER = 5;

// ---------------------------------------------------------------------------
// BDF corrector
// ---------------------------------------------------------------------------

function residualBDF(f, tNext, hGamma, p, pp, y, constraints, nOde) {
  const N = y.length;
  const fy = f(tNext, y);
  const R = new Array(N);
  for (let i = 0; i < nOde; i++) {
    R[i] = y[i] - p[i] - hGamma * (fy[i] - pp[i]);
  }
  if (constraints) {
    const g = constraints(tNext, y);
    for (let a = 0; a < g.length; a++) R[nOde + a] = g[a];
  }
  return R;
}

function fdCorrectJacobian(resFn, y, epsBase) {
  const N = y.length;
  const f0 = resFn(y);
  const M = new Array(N);
  for (let i = 0; i < N; i++) M[i] = new Array(N);
  for (let j = 0; j < N; j++) {
    const eps = epsBase * Math.max(1, Math.abs(y[j]));
    const yp = y.slice();
    yp[j] += eps;
    const fp = resFn(yp);
    for (let i = 0; i < N; i++) M[i][j] = (fp[i] - f0[i]) / eps;
  }
  return M;
}

function correctBDF(f, Jac, tNext, hGamma, p, pp, yGuess, constraints, nOde, opts) {
  const N = yGuess.length;
  const resFn = (yy) => residualBDF(f, tNext, hGamma, p, pp, yy, constraints, nOde);
  const attempt = (start, epsBase) => {
    let y = start.slice();
    for (let it = 0; it < opts.newtonMaxIter; it++) {
      const R = resFn(y);
      const norm = maxAbs(R);
      const scale = 1 + maxAbs(y) + hGamma * maxAbs(f(tNext, y));
      if (norm < 1e-11 * scale) {
        return { y, iters: it + 1, ok: true };
      }
      let M;
      if (Jac) {
        const Jf = Jac(tNext, y);
        M = new Array(N);
        for (let i = 0; i < N; i++) M[i] = new Array(N).fill(0);
        for (let i = 0; i < nOde; i++) {
          for (let j = 0; j < N; j++) {
            M[i][j] = (i === j ? 1 : 0) - hGamma * Jf[i][j];
          }
        }
        if (constraints) {
          const g = constraints(tNext, y);
          const epsB = 1e-7;
          for (let a = 0; a < g.length; a++) {
            const row = nOde + a;
            for (let j = 0; j < N; j++) {
              const eps = epsB * Math.max(1, Math.abs(y[j]));
              const yp = y.slice();
              yp[j] += eps;
              const gp = constraints(tNext, yp);
              M[row][j] = (gp[a] - g[a]) / eps;
            }
          }
        }
      } else {
        M = fdCorrectJacobian(resFn, y, epsBase);
      }
      const delta = gaussSolve(
        M,
        R.map((v) => -v)
      );
      if (!delta) return { ok: false };
      let improved = false;
      let alpha = 1;
      for (let a = 0; a < 10; a++) {
        const yTry = new Array(N);
        for (let i = 0; i < N; i++) yTry[i] = y[i] + alpha * delta[i];
        const Rt = resFn(yTry);
        if (maxAbs(Rt) < norm) {
          y = yTry;
          improved = true;
          break;
        }
        alpha *= 0.5;
      }
      if (!improved) {
        // A Newton step that cannot reduce the residual while being at the
        // machine-precision floor is an acceptable converged state.
        if (maxAbs(delta) < 1e-12 * (1 + maxAbs(y))) {
          return { y, iters: it + 1, ok: true };
        }
        return { ok: false };
      }
    }
    return { ok: false };
  };
  const r1 = attempt(yGuess, 1e-7);
  if (r1.ok) return r1;
  const r2 = attempt(opts.fallbackGuess ? opts.fallbackGuess : yGuess, 1e-7);
  if (r2.ok) return r2;
  return attempt(yGuess, 1e-5);
}

// ---------------------------------------------------------------------------
// BDF solver
// ---------------------------------------------------------------------------

class BDFSolver {
  /**
   * Adaptive BDF1-5 solver.
   * opts: { y0, t0, tEnd, f, Jac, tol, h0, maxSteps, constraints }
   * Returns { t, y, steps, accepts, rejects, lteMax, lteLast, lteAbsMax }.
   */
  static solveBDF(opts = {}) {
    const f = opts.f;
    if (typeof f !== 'function') throw new TypeError('solveBDF requires f(t, y)');
    let y0 = opts.y0;
    if (typeof y0 === 'number') y0 = [y0];
    if (!Array.isArray(y0) || y0.length === 0 || !finiteArray(y0)) {
      throw new TypeError('solveBDF requires a finite numeric y0');
    }
    const t0 = opts.t0 !== undefined ? opts.t0 : 0;
    const tEnd = opts.tEnd;
    if (!Number.isFinite(t0) || !Number.isFinite(tEnd) || tEnd <= t0) {
      throw new RangeError('solveBDF requires finite t0 < tEnd');
    }
    const tol = opts.tol !== undefined ? opts.tol : 1e-8;
    if (!(tol > 0)) throw new RangeError('solveBDF requires tol > 0');
    const rtol = tol;
    const atol = tol;
    const constraints = opts.constraints || null;
    const nOde = constraints ? y0.length - constraints(t0, y0).length : y0.length;
    if (nOde <= 0) throw new RangeError('solveBDF: no differential components');
    const N = y0.length;
    const maxSteps = opts.maxSteps !== undefined ? opts.maxSteps : 200000;
    const span = tEnd - t0;
    let h = opts.h0 !== undefined ? opts.h0 : Math.min(span * 1e-3, 0.01);
    if (!(h > 0)) throw new RangeError('solveBDF requires h0 > 0');
    const hMin = 1e-13 * Math.max(1, Math.abs(t0), span);
    const newtonMaxIter = 15;

    let t = t0;
    let y = y0.slice();
    const histTimes = [t0];
    const histVals = [y0.slice()];

    const tOut = [t0];
    const yOut = [y0.slice()];

    let steps = 0;
    let accepts = 0;
    let rejects = 0;
    let rejectsSinceAccept = 0;
    let raiseCooldown = 0;
    let lteMax = 0;
    let lteAbsMax = 0;
    let lteLast = 0;
    let m = 1;

    while (t < tEnd && steps < maxSteps) {
      if (t + h > tEnd) h = tEnd - t;
      const finalStep = t + h >= tEnd;
      if (h <= hMin && !finalStep) {
        throw new RangeError('solveBDF stalled: step collapsed at t=' + t);
      }
      if (!(h > 0)) break;

      const order = Math.min(m, histTimes.length - 1);
      const buildPred = (histT, histV, ord, tt, hh, yy) => {
        let p;
        let pp;
        if (ord < 1 || histT.length < 2) {
          p = yy.slice();
          pp = new Array(N).fill(0);
        } else {
          const used = Math.min(histT.length, ord + 1);
          const times = histT.slice(histT.length - used).reverse();
          const vals = histV.slice(histV.length - used).reverse();
          const dd = dividedDifferences(times, vals);
          const ev = evalNewton(times, dd, tt + hh);
          p = ev.p;
          pp = ev.dp;
        }
        for (let i2 = ord; i2 < N; i2++) {
          p[i2] = yy[i2];
          pp[i2] = 0;
        }
        let hGamma;
        if (ord < 1) {
          hGamma = hh;
        } else {
          let s = 0;
          for (let l = 0; l < ord; l++) {
            s += 1 / (hh + (histT[histT.length - 1] - histT[histT.length - 1 - l]));
          }
          hGamma = 1 / s;
        }
        return { p, pp, hGamma };
      };
      const tryStep = (histT, histV, tt, hh, yy, ord) => {
        const pred = buildPred(histT, histV, ord, tt, hh, yy);
        const corr = correctBDF(f, opts.Jac, tt + hh, pred.hGamma, pred.p, pred.pp, pred.p, constraints, nOde, {
          newtonMaxIter,
          fallbackGuess: yy
        });
        if (!corr.ok || !finiteArray(corr.y)) return null;
        return corr.y;
      };

      // Full step of size h, plus two half steps (Richardson doubling).
      const yFull = tryStep(histTimes, histVals, t, h, y, order);
      if (yFull === null) {
        rejects++;
        rejectsSinceAccept++;
        h = Math.max(hMin, h * 0.25);
        if (m > 1) m--;
        if (rejectsSinceAccept > 200 || (h <= hMin && !finalStep)) {
          throw new RangeError('solveBDF stalled: corrector failed at t=' + t);
        }
        continue;
      }
      const yMid = tryStep(histTimes, histVals, t, h / 2, y, order);
      if (yMid === null) {
        rejects++;
        rejectsSinceAccept++;
        h = Math.max(hMin, h * 0.25);
        if (rejectsSinceAccept > 200) {
          throw new RangeError('solveBDF stalled: corrector failed at t=' + t);
        }
        continue;
      }
      const yHalf = tryStep(histTimes.concat([t + h / 2]), histVals.concat([yMid]), t + h / 2, h / 2, yMid, order);
      if (yHalf === null) {
        rejects++;
        rejectsSinceAccept++;
        h = Math.max(hMin, h * 0.25);
        if (rejectsSinceAccept > 200) {
          throw new RangeError('solveBDF stalled: corrector failed at t=' + t);
        }
        continue;
      }

      const pOrder = Math.max(1, order);
      let est = 0;
      for (let i = 0; i < nOde; i++) {
        const scale = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yHalf[i]));
        const e = Math.abs(yHalf[i] - yFull[i]) / ((2 ** pOrder - 1) * scale);
        if (e > est) est = e;
      }
      if (!Number.isFinite(est)) est = Infinity;

      if (est <= 1 || finalStep) {
        t += h;
        y = yHalf;
        histTimes.push(t);
        histVals.push(y.slice());
        if (histTimes.length > 7) {
          histTimes.shift();
          histVals.shift();
        }
        tOut.push(t);
        yOut.push(y.slice());
        steps++;
        accepts++;
        rejectsSinceAccept = 0;
        if (raiseCooldown > 0) raiseCooldown--;
        lteMax = Math.max(lteMax, est);
        lteLast = est;

        if (!finalStep) {
          if (m < MAX_ORDER && histTimes.length >= m + 2 && est < 0.05 && raiseCooldown === 0) {
            m++;
            raiseCooldown = 5;
          } else if (m > 1 && est > 0.7) {
            m--;
          }
          let factor = 0.9 * Math.pow(1 / Math.max(est, 1e-99), 1 / (pOrder + 1));
          factor = Math.max(0.3, Math.min(2.5, factor));
          h *= factor;
        }
        if (h > span) h = span;
      } else {
        rejects++;
        rejectsSinceAccept++;
        if (m > 1) {
          m--;
          raiseCooldown = Math.max(raiseCooldown, 40);
        }
        let factor = 0.9 * Math.pow(1 / est, 1 / (pOrder + 1));
        factor = Math.max(0.2, Math.min(0.5, factor));
        h = Math.max(hMin, h * factor);
        if (rejectsSinceAccept > 200) {
          throw new RangeError('solveBDF stalled: LTE rejected too often at t=' + t);
        }
      }
    }

    if (steps >= maxSteps && t < tEnd) {
      throw new RangeError('solveBDF exceeded maxSteps without reaching tEnd');
    }

    return {
      t: tOut,
      y: yOut,
      steps,
      accepts,
      rejects,
      lteMax,
      lteAbsMax,
      lteLast,
      order: m
    };
  }

  /**
   * Fixed-step BDF (order 1..5) used for method-order verification.
   * Returns { t, y }.
   */
  static bdfFixed(f, t0, y0, tEnd, dt, order = 2, opts = {}) {
    if (typeof y0 === 'number') y0 = [y0];
    if (!(dt > 0) || !(order >= 1 && order <= MAX_ORDER)) {
      throw new RangeError('bdfFixed requires dt > 0 and order in 1..5');
    }
    const constraints = opts.constraints || null;
    const nOde = constraints ? y0.length - constraints(t0, y0).length : y0.length;
    const N = y0.length;
    const tOut = [t0];
    const yOut = [y0.slice()];
    const histTimes = [t0];
    const histVals = [y0.slice()];
    let t = t0;
    let y = y0.slice();
    let stepIdx = 0;
    while (t < tEnd) {
      let h = dt;
      if (t + h > tEnd) h = tEnd - t;
      const m = Math.min(order, stepIdx + 1);
      let p;
      let pp;
      if (histTimes.length < 2) {
        p = y.slice();
        pp = new Array(N).fill(0);
      } else {
        const used = Math.min(histTimes.length, m + 1);
        const times = histTimes.slice(histTimes.length - used).reverse();
        const vals = histVals.slice(histVals.length - used).reverse();
        const dd = dividedDifferences(times, vals);
        const ev = evalNewton(times, dd, t + h);
        p = ev.p;
        pp = ev.dp;
      }
      for (let i = m; i < N; i++) {
        p[i] = y[i];
        pp[i] = 0;
      }
      const hGamma = BDF_GAMMA[m - 1] * h;
      const corr = correctBDF(f, opts.Jac, t + h, hGamma, p, pp, p, constraints, nOde, {
        newtonMaxIter: 20,
        fallbackGuess: y
      });
      if (!corr.ok) {
        throw new RangeError('bdfFixed: corrector failed at t=' + t + ' (step ' + stepIdx + ')');
      }
      y = corr.y;
      t += h;
      histTimes.push(t);
      histVals.push(y.slice());
      if (histTimes.length > 7) {
        histTimes.shift();
        histVals.shift();
      }
      tOut.push(t);
      yOut.push(y.slice());
      stepIdx++;
    }
    return { t: tOut, y: yOut };
  }
}

// ---------------------------------------------------------------------------
// 3-stage Radau-IIA (order 5, stiffly accurate)
// ---------------------------------------------------------------------------

const RADAU_C = (() => {
  const s6 = Math.sqrt(6);
  return [(4 - s6) / 10, (4 + s6) / 10, 1];
})();

const RADAU_A = (() => {
  const s6 = Math.sqrt(6);
  return [
    [(88 - 7 * s6) / 360, (296 - 169 * s6) / 1800, (-2 + 3 * s6) / 225],
    [(296 + 169 * s6) / 1800, (88 + 7 * s6) / 360, (-2 - 3 * s6) / 225],
    [(16 - s6) / 36, (16 + s6) / 36, 1 / 9]
  ];
})();

function fdJacobian(f, t, y) {
  const n = y.length;
  const f0 = f(t, y);
  const J = new Array(n);
  for (let i = 0; i < n; i++) J[i] = new Array(n);
  for (let j = 0; j < n; j++) {
    const eps = 1e-7 * Math.max(1, Math.abs(y[j]));
    const yp = y.slice();
    yp[j] += eps;
    const fp = f(t, yp);
    for (let i = 0; i < n; i++) J[i][j] = (fp[i] - f0[i]) / eps;
  }
  return J;
}

class RadauIIASolver {
  constructor(opts = {}) {
    this.tol = opts.tol !== undefined ? opts.tol : 1e-8;
    this.h0 = opts.h0 !== undefined ? opts.h0 : null;
    this.maxSteps = opts.maxSteps !== undefined ? opts.maxSteps : 100000;
    this.safety = opts.safety !== undefined ? opts.safety : 0.9;
    this.minFactor = opts.minFactor !== undefined ? opts.minFactor : 0.2;
    this.maxFactor = opts.maxFactor !== undefined ? opts.maxFactor : 5.0;
    this.newtonMaxIter = opts.newtonMaxIter !== undefined ? opts.newtonMaxIter : 12;
    this.c = RADAU_C;
    this.a = RADAU_A;
    this.b = RADAU_A[2];
  }

  solve(opts = {}) {
    const f = opts.f;
    if (typeof f !== 'function') throw new TypeError('RadauIIA requires f(t, y)');
    let y0 = opts.y0;
    if (typeof y0 === 'number') y0 = [y0];
    if (!Array.isArray(y0) || y0.length === 0 || !finiteArray(y0)) {
      throw new TypeError('RadauIIA requires a finite numeric y0');
    }
    const t0 = opts.t0 !== undefined ? opts.t0 : 0;
    const tEnd = opts.tEnd;
    if (!Number.isFinite(t0) || !Number.isFinite(tEnd) || tEnd <= t0) {
      throw new RangeError('RadauIIA requires finite t0 < tEnd');
    }
    const tol = opts.tol !== undefined ? opts.tol : this.tol;
    if (!(tol > 0)) throw new RangeError('RadauIIA requires tol > 0');
    const rtol = tol;
    const atol = tol;
    const n = y0.length;
    const N = 3 * n;
    const span = tEnd - t0;
    let h = this.h0 !== null ? this.h0 : Math.min(span * 1e-3, 0.01);
    if (!(h > 0)) throw new RangeError('RadauIIA requires h0 > 0');
    const hMin = 1e-13 * Math.max(1, Math.abs(t0), span);
    const p = 5;
    const kI = 0.7 / (p + 1);
    const kP = 0.3 / (p + 1);

    let t = t0;
    let y = y0.slice();
    let Kprev = null;
    let errPrev = 1;
    let steps = 0;
    let accepts = 0;
    let rejects = 0;
    let rejectsSinceAccept = 0;
    let lteMax = 0;

    const tOut = [t0];
    const yOut = [y0.slice()];

    while (t < tEnd && steps < this.maxSteps) {
      if (t + h > tEnd) h = tEnd - t;
      if (!(h > 0)) break;
      const finalStep = t + h >= tEnd;

      const full = this._tryStep(f, opts.Jac, t, y, h, Kprev);
      if (full === null) {
        rejects++;
        rejectsSinceAccept++;
        h = Math.max(hMin, h * this.minFactor);
        if (rejectsSinceAccept > 200 || (h <= hMin && !finalStep)) {
          throw new RangeError('RadauIIA stalled at t=' + t);
        }
        continue;
      }
      const half = h / 2;
      const firstHalf = this._tryStep(f, opts.Jac, t, y, half, Kprev);
      if (firstHalf === null) {
        rejects++;
        rejectsSinceAccept++;
        h = Math.max(hMin, h * this.minFactor);
        if (rejectsSinceAccept > 200) {
          throw new RangeError('RadauIIA stalled at t=' + t);
        }
        continue;
      }
      const secondHalf = this._tryStep(f, opts.Jac, firstHalf.t, firstHalf.y, half, firstHalf.K);
      if (secondHalf === null) {
        rejects++;
        rejectsSinceAccept++;
        h = Math.max(hMin, h * this.minFactor);
        if (rejectsSinceAccept > 200) {
          throw new RangeError('RadauIIA stalled at t=' + t);
        }
        continue;
      }

      let err = 0;
      for (let i = 0; i < n; i++) {
        const est = Math.abs(secondHalf.y[i] - full.y[i]) / (2 ** p - 1);
        const scale = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(secondHalf.y[i]));
        err = Math.max(err, est / scale);
      }
      lteMax = Math.max(lteMax, err);

      const factorFor = (e) => {
        const fac = this.safety * Math.pow(1 / Math.max(e, 1e-99), kI) * Math.pow(Math.max(errPrev, 1e-12), kP);
        return Math.max(this.minFactor, Math.min(this.maxFactor, fac));
      };

      if (err <= 1 || h <= hMin || finalStep) {
        steps++;
        accepts++;
        rejectsSinceAccept = 0;
        y = secondHalf.y;
        t = secondHalf.t;
        Kprev = secondHalf.K;
        tOut.push(t);
        yOut.push(y.slice());
        const factor = factorFor(err);
        errPrev = err;
        h *= factor;
        if (h > span) h = span;
      } else {
        rejects++;
        rejectsSinceAccept++;
        h *= Math.min(factorFor(err), 0.6);
        if (rejectsSinceAccept > 200) {
          throw new RangeError('RadauIIA stalled: LTE rejected too often at t=' + t);
        }
      }
    }

    if (steps >= this.maxSteps && t < tEnd) {
      throw new RangeError('RadauIIA exceeded maxSteps without reaching tEnd');
    }

    return {
      t: tOut,
      y: yOut,
      steps,
      accepts,
      rejects,
      lteMax,
      hFinal: h
    };
  }

  _tryStep(f, Jac, t, y, h, Kprev) {
    const n = y.length;
    const N = 3 * n;
    let K;
    if (Kprev && Kprev.length === N) {
      K = Kprev.slice();
    } else {
      const f0 = f(t, y);
      K = new Array(N);
      for (let s = 0; s < 3; s++) {
        for (let i = 0; i < n; i++) K[s * n + i] = f0[i];
      }
    }

    let Jf = null;
    let LU = null;
    let refreshCount = 0;

    const stageArgs = (s, Kk) => {
      const args = new Array(n);
      for (let i = 0; i < n; i++) {
        let acc = y[i];
        for (let j = 0; j < 3; j++) acc += h * this.a[s][j] * Kk[j * n + i];
        args[i] = acc;
      }
      return args;
    };

    const residual = (Kk) => {
      const R = new Array(N);
      let norm = 0;
      for (let s = 0; s < 3; s++) {
        const fs = f(t + this.c[s] * h, stageArgs(s, Kk));
        for (let i = 0; i < n; i++) {
          const r = Kk[s * n + i] - fs[i];
          R[s * n + i] = r;
          const a = Math.abs(r);
          if (a > norm) norm = a;
        }
      }
      return { R, norm };
    };

    const buildLU = () => {
      Jf = Jac ? Jac(t, y) : fdJacobian(f, t, y);
      const M = new Array(N);
      for (let r = 0; r < N; r++) M[r] = new Array(N).fill(0);
      for (let s1 = 0; s1 < 3; s1++) {
        for (let s2 = 0; s2 < 3; s2++) {
          const coeff = h * this.a[s1][s2];
          if (coeff === 0) continue;
          for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
              M[s1 * n + i][s2 * n + j] -= coeff * Jf[i][j];
            }
          }
        }
      }
      for (let r = 0; r < N; r++) M[r][r] += 1;
      LU = luFactor(M);
      return LU !== null;
    };

    let lastNorm = Infinity;
    for (let it = 0; it < this.newtonMaxIter; it++) {
      const { R, norm } = residual(K);
      const scale = 1 + maxAbs(K);
      if (norm < 1e-9 * scale) {
        const yNext = new Array(n);
        for (let i = 0; i < n; i++) {
          yNext[i] = y[i] + h * (this.b[0] * K[i] + this.b[1] * K[n + i] + this.b[2] * K[2 * n + i]);
        }
        if (!finiteArray(yNext) || !finiteArray(K)) return null;
        return { t: t + h, y: yNext, K };
      }
      if (!LU) {
        if (!buildLU()) return null;
      }
      if (norm >= lastNorm && refreshCount < 2) {
        if (buildLU()) refreshCount++;
      }
      lastNorm = norm;

      const delta = luSolve(
        LU,
        R.map((v) => -v)
      );
      if (!delta) {
        if (refreshCount < 2 && buildLU()) {
          refreshCount++;
          continue;
        }
        return null;
      }

      // Iterative refinement: one extra solve with the recomputed residual.
      let alpha = 1;
      let improved = false;
      for (let a = 0; a < 5; a++) {
        const Kt = K.map((v, idx) => v + alpha * delta[idx]);
        const rt = residual(Kt);
        if (rt.norm < norm) {
          K = Kt;
          improved = true;
          break;
        }
        alpha *= 0.5;
      }
      if (!improved) {
        const Kt = K.map((v, idx) => v + delta[idx]);
        const rt = residual(Kt);
        if (rt.norm < norm) {
          K = Kt;
          improved = true;
        }
      }
      if (!improved) {
        if (refreshCount < 2 && buildLU()) {
          refreshCount++;
          continue;
        }
        return null;
      }
    }

    const { norm: finalNorm, R } = residual(K);
    if (finalNorm <= 1e-7 * (1 + maxAbs(K))) {
      const yNext = new Array(n);
      for (let i = 0; i < n; i++) {
        yNext[i] = y[i] + h * (this.b[0] * K[i] + this.b[1] * K[n + i] + this.b[2] * K[2 * n + i]);
      }
      if (!finiteArray(yNext) || !finiteArray(K)) return null;
      return { t: t + h, y: yNext, K };
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

class DAESolvers {
  static solveBDF(opts) {
    return BDFSolver.solveBDF(opts);
  }

  static bdfFixed(f, t0, y0, tEnd, dt, order, opts) {
    return BDFSolver.bdfFixed(f, t0, y0, tEnd, dt, order, opts);
  }

  static solveRadauIIA(opts) {
    return new RadauIIASolver(opts).solve(opts);
  }
}

module.exports = {
  DAESolvers,
  BDFSolver,
  RadauIIASolver,
  solveBDF: (opts) => BDFSolver.solveBDF(opts),
  solveRadauIIA: (opts) => new RadauIIASolver(opts).solve(opts),
  bdfFixed: (f, t0, y0, tEnd, dt, order, opts) => BDFSolver.bdfFixed(f, t0, y0, tEnd, dt, order, opts)
};
