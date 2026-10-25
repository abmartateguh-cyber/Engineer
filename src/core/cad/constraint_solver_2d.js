/**
 * OmniEng 2D Variational Geometric Constraint Solver
 * Standard: Non-linear Least-Squares Levenberg-Marquardt Solver
 * Experimental implementation: Siemens D-Cubed 2D DCM / FreeCAD Sketcher solver.
 */

class ConstraintSolver2D {
  constructor() {
    this.points = []; // [{ id, x, y, fixed: boolean }]
    this.constraints = [];
  }

  addPoint(id, x, y, fixed = false) {
    this.points.push({ id, x: Number(x), y: Number(y), fixed: !!fixed });
    return this.points.length - 1;
  }

  _getPointIndex(id) {
    if (typeof id === 'number') return id;
    const idx = this.points.findIndex(p => p.id === id);
    if (idx === -1) throw new Error(`Point id not found: ${id}`);
    return idx;
  }

  addFixed(id, x, y) {
    const idx = this._getPointIndex(id);
    if (x !== undefined) this.points[idx].x = Number(x);
    if (y !== undefined) this.points[idx].y = Number(y);
    this.points[idx].fixed = true;
  }

  addDistance(idA, idB, distance) {
    this.addConstraint('DISTANCE_POINTS', {
      p1: this._getPointIndex(idA),
      p2: this._getPointIndex(idB),
      distance: Number(distance)
    });
  }

  addHorizontal(idA, idB) {
    this.addConstraint('HORIZONTAL', {
      p1: this._getPointIndex(idA),
      p2: this._getPointIndex(idB)
    });
  }

  addVertical(idA, idB) {
    this.addConstraint('VERTICAL', {
      p1: this._getPointIndex(idA),
      p2: this._getPointIndex(idB)
    });
  }

  addCoincident(idA, idB) {
    this.addConstraint('COINCIDENT', {
      p1: this._getPointIndex(idA),
      p2: this._getPointIndex(idB)
    });
  }

  getPoint(id) {
    const idx = this._getPointIndex(id);
    return this.points[idx];
  }

  addConstraint(type, params) {
    this.constraints.push({ type, params });
  }

  /**
   * Evaluates the residual vector R(X) for all active constraints.
   */
  evaluateResiduals(X) {
    const residuals = [];

    // Helper to get coordinates of point index
    const getX = (idx) => X[idx * 2];
    const getY = (idx) => X[idx * 2 + 1];

    for (let c = 0; c < this.constraints.length; c++) {
      const { type, params } = this.constraints[c];

      switch (type) {
        case 'COINCIDENT': {
          const { p1, p2 } = params;
          residuals.push(getX(p1) - getX(p2));
          residuals.push(getY(p1) - getY(p2));
          break;
        }

        case 'DISTANCE_POINTS': {
          const { p1, p2, distance } = params;
          const dx = getX(p1) - getX(p2);
          const dy = getY(p1) - getY(p2);
          const curDist = Math.sqrt(dx * dx + dy * dy);
          residuals.push(curDist - distance);
          break;
        }

        case 'HORIZONTAL': {
          const { p1, p2 } = params;
          residuals.push(getY(p1) - getY(p2));
          break;
        }

        case 'VERTICAL': {
          const { p1, p2 } = params;
          residuals.push(getX(p1) - getX(p2));
          break;
        }

        case 'PERPENDICULAR': {
          // Line p1->p2 perpendicular to line p3->p4: dot product = 0
          const { p1, p2, p3, p4 } = params;
          const dx1 = getX(p2) - getX(p1);
          const dy1 = getY(p2) - getY(p1);
          const dx2 = getX(p4) - getX(p3);
          const dy2 = getY(p4) - getY(p3);
          residuals.push(dx1 * dx2 + dy1 * dy2);
          break;
        }

        case 'PARALLEL': {
          // Cross product = 0
          const { p1, p2, p3, p4 } = params;
          const dx1 = getX(p2) - getX(p1);
          const dy1 = getY(p2) - getY(p1);
          const dx2 = getX(p4) - getX(p3);
          const dy2 = getY(p4) - getY(p3);
          residuals.push(dx1 * dy2 - dy1 * dx2);
          break;
        }

        case 'POINT_ON_LINE': {
          // pPoint on line p1->p2: (x_p - x1)*(y2 - y1) - (y_p - y1)*(x2 - x1) = 0
          const { pPoint, p1, p2 } = params;
          const dx = getX(p2) - getX(p1);
          const dy = getY(p2) - getY(p1);
          const rx = getX(pPoint) - getX(p1);
          const ry = getY(pPoint) - getY(p1);
          residuals.push(rx * dy - ry * dx);
          break;
        }

        case 'TANGENT_LINE_CIRCLE': {
          // Perpendicular distance from circle center to line equals radius R
          const { p1, p2, pCenter, radius } = params;
          const x1 = getX(p1), y1 = getY(p1);
          const x2 = getX(p2), y2 = getY(p2);
          const xc = getX(pCenter), yc = getY(pCenter);

          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy) || 1e-6;
          // Distance: |(x2 - x1)*(y1 - yc) - (x1 - xc)*(y2 - y1)| / len
          const dist = Math.abs(dx * (y1 - yc) - (x1 - xc) * dy) / len;
          residuals.push(dist - radius);
          break;
        }

        case 'FIXED': {
          const { p, x, y } = params;
          residuals.push(getX(p) - x);
          residuals.push(getY(p) - y);
          break;
        }

        default:
          break;
      }
    }

    // Add penalty for fixed points
    for (let i = 0; i < this.points.length; i++) {
      if (this.points[i].fixed) {
        residuals.push(getX(i) - this.points[i].x);
        residuals.push(getY(i) - this.points[i].y);
      }
    }

    return residuals;
  }

  /**
   * Solves the 2D geometric constraints using Levenberg-Marquardt method.
   * @param {number} maxIterations Max iterations (default 50)
   * @param {number} tolerance Residual norm tolerance (default 1e-6)
   */
  solve(maxIterations = 50, tolerance = 1e-6) {
    const N = this.points.length;
    let X = new Float64Array(N * 2);

    for (let i = 0; i < N; i++) {
      X[i * 2] = this.points[i].x;
      X[i * 2 + 1] = this.points[i].y;
    }

    let lambda = 1e-3;
    let iter = 0;
    let converged = false;

    while (iter < maxIterations) {
      const R = this.evaluateResiduals(X);
      const M = R.length;

      // Check current norm
      let sumSq = 0;
      let maxRes = 0;
      for (let m = 0; m < M; m++) {
        const val = Math.abs(R[m]);
        sumSq += val * val;
        if (val > maxRes) maxRes = val;
      }

      if (maxRes < tolerance) {
        converged = true;
        break;
      }

      // Compute numerical Jacobian J (M x 2N)
      const J = [];
      const eps = 1e-7;

      for (let m = 0; m < M; m++) {
        J.push(new Float64Array(2 * N));
      }

      for (let j = 0; j < 2 * N; j++) {
        const pIdx = Math.floor(j / 2);
        if (this.points[pIdx].fixed) continue;

        X[j] += eps;
        const R_perturbed = this.evaluateResiduals(X);
        X[j] -= eps;

        for (let m = 0; m < M; m++) {
          J[m][j] = (R_perturbed[m] - R[m]) / eps;
        }
      }

      // Form normal equations: (J^T * J + lambda * I) * deltaX = -J^T * R
      const dim = 2 * N;
      const H = []; // J^T * J
      for (let i = 0; i < dim; i++) {
        H.push(new Float64Array(dim));
      }
      const g = new Float64Array(dim); // -J^T * R

      for (let i = 0; i < dim; i++) {
        for (let j = 0; j < dim; j++) {
          let sum = 0;
          for (let m = 0; m < M; m++) {
            sum += J[m][i] * J[m][j];
          }
          H[i][j] = sum;
        }
        let gSum = 0;
        for (let m = 0; m < M; m++) {
          gSum += J[m][i] * R[m];
        }
        g[i] = -gSum;
      }

      // Add damping lambda to diagonal
      for (let i = 0; i < dim; i++) {
        const pIdx = Math.floor(i / 2);
        if (this.points[pIdx].fixed) {
          H[i][i] += 1e9; // Hard pin
        } else {
          H[i][i] += lambda;
        }
      }

      // Solve linear system H * deltaX = g via Gaussian elimination
      const deltaX = this._gaussianSolve(H, g, dim);

      // Trial step
      const X_trial = new Float64Array(dim);
      for (let i = 0; i < dim; i++) {
        X_trial[i] = X[i] + deltaX[i];
      }

      const R_trial = this.evaluateResiduals(X_trial);
      let trialSumSq = 0;
      for (let m = 0; m < M; m++) {
        trialSumSq += R_trial[m] * R_trial[m];
      }

      if (trialSumSq < sumSq) {
        // Successful step
        X = X_trial;
        lambda = Math.max(1e-7, lambda * 0.3);
      } else {
        // Step rejected, increase damping
        lambda = Math.min(1e5, lambda * 4.0);
      }

      iter++;
    }

    // Write back updated coordinates
    for (let i = 0; i < N; i++) {
      this.points[i].x = Number(X[i * 2].toFixed(6));
      this.points[i].y = Number(X[i * 2 + 1].toFixed(6));
    }

    const finalR = this.evaluateResiduals(X);
    let finalMaxRes = 0;
    for (let m = 0; m < finalR.length; m++) {
      if (Math.abs(finalR[m]) > finalMaxRes) finalMaxRes = Math.abs(finalR[m]);
    }

    return {
      converged,
      iterations: iter,
      maxResidual: Number(finalMaxRes.toExponential(4)),
      residualNorm: Number(finalMaxRes.toExponential(4)),
      points: this.points
    };
  }

  _gaussianSolve(A, b, n) {
    const M = [];
    for (let i = 0; i < n; i++) {
      M.push(new Float64Array(n + 1));
      for (let j = 0; j < n; j++) {
        M[i][j] = A[i][j];
      }
      M[i][n] = b[i];
    }

    for (let i = 0; i < n; i++) {
      // Partial pivoting
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) {
          maxRow = k;
        }
      }
      const tmp = M[i];
      M[i] = M[maxRow];
      M[maxRow] = tmp;

      if (Math.abs(M[i][i]) < 1e-12) continue;

      for (let k = i + 1; k < n; k++) {
        const c = M[k][i] / M[i][i];
        for (let j = i; j <= n; j++) {
          M[k][j] -= c * M[i][j];
        }
      }
    }

    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let sum = M[i][n];
      for (let j = i + 1; j < n; j++) {
        sum -= M[i][j] * x[j];
      }
      x[i] = Math.abs(M[i][i]) > 1e-12 ? sum / M[i][i] : 0.0;
    }

    return x;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ConstraintSolver2D };
}
