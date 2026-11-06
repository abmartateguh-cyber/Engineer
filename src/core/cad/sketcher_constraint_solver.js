/**
 * Variational 2D sketcher constraint solver.
 *
 * Solves systems of 2D geometric constraints (coincident, collinear,
 * parallel, perpendicular, tangent, concentric, symmetric, distance and
 * angle dimensions) over free point coordinates using a damped
 * Gauss-Newton (Levenberg-Marquardt) iteration with a numerically
 * evaluated Jacobian.
 *
 * Rank analysis is performed with modified Gram-Schmidt QR of the
 * Jacobian (with reorthogonalization). Singular values below a relative
 * threshold are treated as null directions, giving the local
 * over-constrained / under-constrained report:
 *   - overconstrained   = number of dependent residual equations (M - rank, M > rank)
 *   - underconstrained   = number of free coordinate directions with no constraint sensitivity (m - rank)
 *
 * No external runtime dependencies. CommonJS, strict mode.
 */

'use strict';

const DEFAULT_TOLERANCE = 1e-11;
const DEFAULT_MAX_ITERATIONS = 200;
const SINGULAR_VALUE_RATIO = 1e-10;
const FD_H = 1e-6;

class SketcherConstraintSolver {
  constructor() {
    this.points = []; // [{ id, x, y, fixed }]
    this.lines = []; // [{ id, p0, p1 }] point indices
    this.circles = []; // [{ id, center, radius }] center point index
    this.constraints = []; // [{ type, params }]
  }

  addPoint(id, x, y, fixed) {
    this.points.push({ id, x: Number(x), y: Number(y), fixed: !!fixed });
    return this.points.length - 1;
  }

  _getPointIndex(id) {
    if (typeof id === 'number') return id;
    const idx = this.points.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`Sketcher: point id not found: ${id}`);
    return idx;
  }

  addLine(id, p0, p1) {
    this.lines.push({
      id,
      p0: this._getPointIndex(p0),
      p1: this._getPointIndex(p1)
    });
    return this.lines.length - 1;
  }

  addCircle(id, center, radius) {
    this.circles.push({
      id,
      center: this._getPointIndex(center),
      radius: Number(radius)
    });
    return this.circles.length - 1;
  }

  getPoint(id) {
    return this.points[this._getPointIndex(id)];
  }

  _line(id) {
    if (typeof id === 'number') return this.lines[id];
    const idx = this.lines.findIndex((l) => l.id === id);
    if (idx === -1) throw new Error(`Sketcher: line id not found: ${id}`);
    return this.lines[idx];
  }

  _circle(id) {
    if (typeof id === 'number') return this.circles[id];
    const idx = this.circles.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`Sketcher: circle id not found: ${id}`);
    return this.circles[idx];
  }

  addCoincident(a, b) {
    this.constraints.push({
      type: 'COINCIDENT',
      a: this._getPointIndex(a),
      b: this._getPointIndex(b)
    });
  }

  addCollinear(l0, l1) {
    this.constraints.push({
      type: 'COLLINEAR',
      l0: this._line(l0),
      l1: this._line(l1)
    });
  }

  addParallel(l0, l1) {
    this.constraints.push({
      type: 'PARALLEL',
      l0: this._line(l0),
      l1: this._line(l1)
    });
  }

  addPerpendicular(l0, l1) {
    this.constraints.push({
      type: 'PERPENDICULAR',
      l0: this._line(l0),
      l1: this._line(l1)
    });
  }

  addHorizontal(line) {
    this.constraints.push({ type: 'HORIZONTAL', line: this._line(line) });
  }

  addVertical(line) {
    this.constraints.push({ type: 'VERTICAL', line: this._line(line) });
  }

  addDistancePoints(a, b, distance) {
    this.constraints.push({
      type: 'DISTANCE_POINTS',
      a: this._getPointIndex(a),
      b: this._getPointIndex(b),
      distance: Number(distance)
    });
  }

  addAngleLines(l0, l1, angleRad) {
    this.constraints.push({
      type: 'ANGLE_LINES',
      l0: this._line(l0),
      l1: this._line(l1),
      angle: Number(angleRad)
    });
  }

  addTangentLineCircle(line, circle) {
    this.constraints.push({
      type: 'TANGENT_LINE_CIRCLE',
      line: this._line(line),
      circle: this._circle(circle)
    });
  }

  addConcentric(c0, c1) {
    this.constraints.push({
      type: 'CONCENTRIC',
      c0: this._circle(c0),
      c1: this._circle(c1)
    });
  }

  addSymmetricPoints(a, b, axisLine) {
    this.constraints.push({
      type: 'SYMMETRIC_POINTS',
      a: this._getPointIndex(a),
      b: this._getPointIndex(b),
      axis: this._line(axisLine)
    });
  }

  /**
   * Evaluate the residual vector R(X) for all constraints.
   * X is a Float64Array of length 2*N holding point coordinates.
   */
  evaluateResiduals(X) {
    const residuals = [];
    const x = (i) => X[i * 2];
    const y = (i) => X[i * 2 + 1];
    const dx = (l) => x(l.p1) - x(l.p0);
    const dy = (l) => y(l.p1) - y(l.p0);

    for (let c = 0; c < this.constraints.length; c++) {
      const con = this.constraints[c];
      switch (con.type) {
        case 'COINCIDENT': {
          residuals.push(x(con.a) - x(con.b));
          residuals.push(y(con.a) - y(con.b));
          break;
        }
        case 'COLLINEAR':
        case 'PARALLEL': {
          const d0x = dx(con.l0);
          const d0y = dy(con.l0);
          const d1x = dx(con.l1);
          const d1y = dy(con.l1);
          residuals.push(d0x * d1y - d0y * d1x);
          break;
        }
        case 'PERPENDICULAR': {
          const d0x = dx(con.l0);
          const d0y = dy(con.l0);
          const d1x = dx(con.l1);
          const d1y = dy(con.l1);
          residuals.push(d0x * d1x + d0y * d1y);
          break;
        }
        case 'HORIZONTAL': {
          residuals.push(y(con.line.p1) - y(con.line.p0));
          break;
        }
        case 'VERTICAL': {
          residuals.push(x(con.line.p1) - x(con.line.p0));
          break;
        }
        case 'DISTANCE_POINTS': {
          const ax = x(con.a);
          const ay = y(con.a);
          const bx = x(con.b);
          const by = y(con.b);
          const ddx = ax - bx;
          const ddy = ay - by;
          residuals.push(Math.sqrt(ddx * ddx + ddy * ddy) - con.distance);
          break;
        }
        case 'ANGLE_LINES': {
          const d0x = dx(con.l0);
          const d0y = dy(con.l0);
          const d1x = dx(con.l1);
          const d1y = dy(con.l1);
          const c = Math.cos(con.angle);
          const s = Math.sin(con.angle);
          const cross = d0x * d1y - d0y * d1x;
          const dot = d0x * d1x + d0y * d1y;
          residuals.push(cross * c - dot * s);
          break;
        }
        case 'TANGENT_LINE_CIRCLE': {
          const line = con.line;
          const circle = con.circle;
          const ax = x(line.p0);
          const ay = y(line.p0);
          const ddx = dx(line);
          const ddy = dy(line);
          const cx = x(circle.center);
          const cy = y(circle.center);
          const rx = cx - ax;
          const ry = cy - ay;
          const cross = ddx * ry - ddy * rx;
          const len2 = ddx * ddx + ddy * ddy;
          const safeLen2 = len2 > 1e-24 ? len2 : 1e-24;
          residuals.push((cross * cross) / safeLen2 - circle.radius * circle.radius);
          break;
        }
        case 'CONCENTRIC': {
          residuals.push(x(con.c0.center) - x(con.c1.center));
          residuals.push(y(con.c0.center) - y(con.c1.center));
          break;
        }
        case 'SYMMETRIC_POINTS': {
          const axis = con.axis;
          const ax = x(axis.p0);
          const ay = y(axis.p0);
          const adx = dx(axis);
          const ady = dy(axis);
          const sumx = x(con.a) + x(con.b);
          const sumy = y(con.a) + y(con.b);
          const mid2x = sumx - 2 * ax;
          const mid2y = sumy - 2 * ay;
          residuals.push(mid2x * ady - mid2y * adx);
          const difx = x(con.b) - x(con.a);
          const dify = y(con.b) - y(con.a);
          residuals.push(difx * adx + dify * ady);
          break;
        }
        default:
          break;
      }
    }

    return residuals;
  }

  /**
   * Rank analysis via modified Gram-Schmidt QR of the M x m Jacobian.
   * Returns { rank, singularValues, } with singularValues in decreasing order.
   */
  _rankAnalysis(J, M, m) {
    const Q = [];
    for (let i = 0; i < M; i++) Q.push(new Float64Array(m));
    const R = [];
    for (let i = 0; i < m; i++) R.push(new Float64Array(m));

    const norms = [];

    for (let j = 0; j < m; j++) {
      for (let i = 0; i < M; i++) Q[i][j] = J[i][j];

      for (let k = 0; k < 2; k++) {
        for (let p = 0; p < j; p++) {
          let dot = 0;
          for (let i = 0; i < M; i++) dot += Q[i][j] * Q[i][p];
          R[p][j] += dot;
          for (let i = 0; i < M; i++) Q[i][j] -= dot * Q[i][p];
        }
      }

      let norm = 0;
      for (let i = 0; i < M; i++) norm += Q[i][j] * Q[i][j];
      norm = Math.sqrt(norm);
      norms.push(norm);

      if (norm > 1e-300) {
        for (let i = 0; i < M; i++) Q[i][j] /= norm;
      }
    }

    let maxNorm = 0;
    for (let j = 0; j < m; j++) if (norms[j] > maxNorm) maxNorm = norms[j];

    let rank = 0;
    for (let j = 0; j < m; j++) {
      if (norms[j] > SINGULAR_VALUE_RATIO * maxNorm) rank++;
    }

    const singularValues = norms.slice().sort((a, b) => b - a);
    return { rank, singularValues };
  }

  _solveNormalEquations(H, g, n) {
    const A = [];
    for (let i = 0; i < n; i++) {
      A.push(new Float64Array(n + 1));
      for (let j = 0; j < n; j++) A[i][j] = H[i][j];
      A[i][n] = g[i];
    }

    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
      }
      const tmp = A[i];
      A[i] = A[maxRow];
      A[maxRow] = tmp;

      const pivot = A[i][i];
      if (Math.abs(pivot) < 1e-14) continue;

      for (let k = i + 1; k < n; k++) {
        const c = A[k][i] / pivot;
        if (c === 0) continue;
        for (let j = i; j <= n; j++) A[k][j] -= c * A[i][j];
      }
    }

    const delta = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      const pivot = A[i][i];
      if (Math.abs(pivot) < 1e-14) {
        delta[i] = 0;
        continue;
      }
      let sum = A[i][n];
      for (let j = i + 1; j < n; j++) sum -= A[i][j] * delta[j];
      delta[i] = sum / pivot;
    }
    return delta;
  }

  /**
   * Solve the constraint system.
   * @param {object} [options] { tolerance, maxIterations }
   * @returns {object} { converged, iterations, maxResidual, residualNorm,
   *   overconstrained, underconstrained, rank, freeVariables, points }
   */
  solve(options) {
    const opts = options || {};
    const tolerance = opts.tolerance !== undefined ? opts.tolerance : DEFAULT_TOLERANCE;
    const maxIter = opts.maxIterations || DEFAULT_MAX_ITERATIONS;

    const N = this.points.length;
    const X0 = new Float64Array(2 * N);
    for (let i = 0; i < N; i++) {
      X0[i * 2] = this.points[i].x;
      X0[i * 2 + 1] = this.points[i].y;
    }

    const freeIdx = [];
    for (let i = 0; i < N; i++) {
      if (!this.points[i].fixed) {
        freeIdx.push(i * 2);
        freeIdx.push(i * 2 + 1);
      }
    }
    const m = freeIdx.length;

    let X = X0.slice();

    let converged = false;
    let iter = 0;
    let lamb = 1e-4;
    let lastMaxRes = Infinity;
    let lastNorm = Infinity;
    let rank = 0;
    let subconstrained = 0;
    let overconstrained = 0;

    if (m === 0) {
      const R = this.evaluateResiduals(X);
      let maxRes = 0;
      let norm = 0;
      for (let i = 0; i < R.length; i++) {
        const v = Math.abs(R[i]);
        if (v > maxRes) maxRes = v;
        norm += R[i] * R[i];
      }
      norm = Math.sqrt(norm);
      converged = maxRes < tolerance;
      for (let i = 0; i < N; i++) {
        this.points[i].x = X[i * 2];
        this.points[i].y = X[i * 2 + 1];
      }
      return {
        converged,
        iterations: 0,
        maxResidual: maxRes,
        residualNorm: norm,
        overconstrained: 0,
        underconstrained: 0,
        rank: 0,
        freeVariables: 0,
        points: this.points
      };
    }

    let v = new Float64Array(m);
    for (let j = 0; j < m; j++) v[j] = X[freeIdx[j]];

    const evalR = (XV) => this.evaluateResiduals(XV);
    const makeX = (VV) => {
      const XV = X.slice();
      for (let j = 0; j < m; j++) XV[freeIdx[j]] = VV[j];
      return XV;
    };

    while (iter < maxIter) {
      X = makeX(v);
      const R = evalR(X);
      const M = R.length;

      let maxRes = 0;
      let norm = 0;
      for (let i = 0; i < M; i++) {
        const val = Math.abs(R[i]);
        if (val > maxRes) maxRes = val;
        norm += R[i] * R[i];
      }
      norm = Math.sqrt(norm);
      lastMaxRes = maxRes;
      lastNorm = norm;

      if (maxRes < tolerance) {
        converged = true;
        break;
      }

      const J = [];
      for (let i = 0; i < M; i++) J.push(new Float64Array(m));

      for (let j = 0; j < m; j++) {
        const k = freeIdx[j];
        const h = FD_H;
        const orig = X[k];
        X[k] = orig + h;
        const Rp = evalR(X);
        X[k] = orig - h;
        const Rm = evalR(X);
        X[k] = orig;
        for (let i = 0; i < M; i++) {
          J[i][j] = (Rp[i] - Rm[i]) / (2 * h);
        }
      }

      const analysis = this._rankAnalysis(J, M, m);
      rank = analysis.rank;
      overconstrained = M > rank ? M - rank : 0;
      subconstrained = m - rank;

      const H = [];
      for (let i = 0; i < m; i++) H.push(new Float64Array(m));
      const g = new Float64Array(m);

      for (let i = 0; i < m; i++) {
        for (let j = 0; j < m; j++) {
          let sum = 0;
          for (let r = 0; r < M; r++) sum += J[r][i] * J[r][j];
          H[i][j] = sum;
        }
        let gsum = 0;
        for (let r = 0; r < M; r++) gsum += J[r][i] * R[r];
        g[i] = -gsum;
        H[i][i] += lamb;
      }

      const delta = this._solveNormalEquations(H, g, m);

      const vTrial = new Float64Array(m);
      for (let j = 0; j < m; j++) vTrial[j] = v[j] + delta[j];

      const XTrial = makeX(vTrial);
      const RTrial = evalR(XTrial);
      let trialNorm = 0;
      for (let i = 0; i < RTrial.length; i++) trialNorm += RTrial[i] * RTrial[i];
      trialNorm = Math.sqrt(trialNorm);

      if (trialNorm < norm) {
        v = vTrial;
        lamb = Math.max(1e-12, lamb * 0.4);
      } else {
        lamb = Math.min(1e12, lamb * 5);
      }

      iter++;
    }

    X = makeX(v);
    const R = evalR(X);
    let maxRes = 0;
    let norm = 0;
    for (let i = 0; i < R.length; i++) {
      const val = Math.abs(R[i]);
      if (val > maxRes) maxRes = val;
      norm += R[i] * R[i];
    }
    norm = Math.sqrt(norm);
    lastMaxRes = maxRes;
    lastNorm = norm;
    if (maxRes < tolerance) converged = true;

    for (let i = 0; i < N; i++) {
      this.points[i].x = X[i * 2];
      this.points[i].y = X[i * 2 + 1];
    }

    return {
      converged,
      iterations: iter,
      maxResidual: lastMaxRes,
      residualNorm: lastNorm,
      overconstrained,
      underconstrained: subconstrained,
      rank,
      freeVariables: m,
      points: this.points
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SketcherConstraintSolver };
}
