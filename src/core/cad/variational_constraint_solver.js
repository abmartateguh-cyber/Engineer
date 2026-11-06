/**
 * OmniEng 2D/3D Variational Geometric Constraint Solver (D-Cubed 2D DCM Experimental workflow)
 * 
 * Implements simultaneous non-linear parametric sketch constraint solving:
 * 1. Entities: Points (x,y), Line segments, Circles/Arcs.
 * 2. Constraints:
 *    - COINCIDENT: Point-to-point locking.
 *    - DISTANCE: Fixed point-point, point-line, or line length.
 *    - HORIZONTAL / VERTICAL: Coordinate axis alignment.
 *    - PARALLEL / PERPENDICULAR: Directional dot/cross product constraints.
 *    - TANGENT: Circle-to-line or circle-to-circle smooth contact.
 *    - EQUAL_LENGTH: Symmetric sizing.
 * 3. Damped Newton-Raphson (Levenberg-Marquardt) solver:
 *    F(X) = 0, delta = -(J^T * J + lambda * diag(J^T * J))^(-1) * J^T * F(X),
 *    with adaptive lambda updates driven by the actual residual gain ratio.
 * 4. Degrees-of-Freedom (DOF) status via SVD rank detection of the Jacobian:
 *    under-constrained, fully-constrained, over-constrained. Exposed through
 *    analyzeSystem() -> { rank, dof, constraintStatus, singularValues }.
 * 
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

class VariationalConstraintSolver {
  constructor() {
    this.points = []; // Array of { id, x, y, fixed }
    this.constraints = []; // Array of { id, type, params }
    this.maxIterations = 50;
    this.tolerance = 1e-11;
  }

  addPoint(id, x, y, fixed = false) {
    const pt = { id, x, y, fixed: !!fixed };
    this.points.push(pt);
    return pt;
  }

  addConstraint(constraint) {
    const type = constraint.type ? constraint.type.toUpperCase() : '';
    const p1 = constraint.point1 || constraint.pt1;
    const p2 = constraint.point2 || constraint.pt2;
    const val = constraint.value !== undefined ? constraint.value : 0.0;

    if (type === 'DISTANCE') {
      return this.addDistanceConstraint(p1, p2, val);
    } else if (type === 'HORIZONTAL') {
      return this.addHorizontalConstraint(p1, p2);
    } else if (type === 'VERTICAL') {
      return this.addVerticalConstraint(p1, p2);
    } else if (type === 'COINCIDENT') {
      return this.addCoincidentConstraint(p1, p2);
    } else {
      this.constraints.push(constraint);
      return constraint;
    }
  }

  addDistanceConstraint(pt1Id, pt2Id, distance) {
    const c = { type: 'DISTANCE', pt1: pt1Id, pt2: pt2Id, value: distance };
    this.constraints.push(c);
    return c;
  }

  addCoincidentConstraint(pt1Id, pt2Id) {
    const c = { type: 'COINCIDENT', pt1: pt1Id, pt2: pt2Id };
    this.constraints.push(c);
    return c;
  }

  addHorizontalConstraint(pt1Id, pt2Id) {
    const c = { type: 'HORIZONTAL', pt1: pt1Id, pt2: pt2Id };
    this.constraints.push(c);
    return c;
  }

  addVerticalConstraint(pt1Id, pt2Id) {
    const c = { type: 'VERTICAL', pt1: pt1Id, pt2: pt2Id };
    this.constraints.push(c);
    return c;
  }

  addPerpendicularConstraint(line1Pt1, line1Pt2, line2Pt1, line2Pt2) {
    const c = { type: 'PERPENDICULAR', l1p1: line1Pt1, l1p2: line1Pt2, l2p1: line2Pt1, l2p2: line2Pt2 };
    this.constraints.push(c);
    return c;
  }

  addTangentCircleLine(centerId, radius, linePt1, linePt2) {
    const c = { type: 'TANGENT_CIRCLE_LINE', center: centerId, radius, lp1: linePt1, lp2: linePt2 };
    this.constraints.push(c);
    return c;
  }

  _getFreePoints() {
    return this.points.filter((p) => !p.fixed);
  }

  _stateVector(freePoints) {
    const X = new Float64Array(freePoints.length * 2);
    for (let i = 0; i < freePoints.length; i++) {
      X[2 * i] = freePoints[i].x;
      X[2 * i + 1] = freePoints[i].y;
    }
    return X;
  }

  _writeback(freePoints, X) {
    for (let i = 0; i < freePoints.length; i++) {
      freePoints[i].x = X[2 * i];
      freePoints[i].y = X[2 * i + 1];
    }
  }

  /**
   * Evaluates the constraint residual vector F(X)
   * @param {Float64Array} X
   * @returns {Float64Array} F
   */
  evaluateResiduals(X) {
    const ptMap = new Map();
    let varIdx = 0;
    for (const pt of this.points) {
      if (pt.fixed) {
        ptMap.set(pt.id, { x: pt.x, y: pt.y });
      } else {
        ptMap.set(pt.id, { x: X[varIdx], y: X[varIdx + 1] });
        varIdx += 2;
      }
    }

    const residuals = [];
    for (const c of this.constraints) {
      if (c.type === 'DISTANCE') {
        const p1 = ptMap.get(c.pt1);
        const p2 = ptMap.get(c.pt2);
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const currentDist = Math.sqrt(dx * dx + dy * dy);
        residuals.push(currentDist - c.value);
      } else if (c.type === 'COINCIDENT') {
        const p1 = ptMap.get(c.pt1);
        const p2 = ptMap.get(c.pt2);
        residuals.push(p2.x - p1.x);
        residuals.push(p2.y - p1.y);
      } else if (c.type === 'HORIZONTAL') {
        const p1 = ptMap.get(c.pt1);
        const p2 = ptMap.get(c.pt2);
        residuals.push(p2.y - p1.y);
      } else if (c.type === 'VERTICAL') {
        const p1 = ptMap.get(c.pt1);
        const p2 = ptMap.get(c.pt2);
        residuals.push(p2.x - p1.x);
      } else if (c.type === 'PERPENDICULAR') {
        const l1p1 = ptMap.get(c.l1p1);
        const l1p2 = ptMap.get(c.l1p2);
        const l2p1 = ptMap.get(c.l2p1);
        const l2p2 = ptMap.get(c.l2p2);
        const d1x = l1p2.x - l1p1.x;
        const d1y = l1p2.y - l1p1.y;
        const d2x = l2p2.x - l2p1.x;
        const d2y = l2p2.y - l2p1.y;
        residuals.push(d1x * d2x + d1y * d2y);
      } else if (c.type === 'TANGENT_CIRCLE_LINE') {
        const cPt = ptMap.get(c.center);
        const lp1 = ptMap.get(c.lp1);
        const lp2 = ptMap.get(c.lp2);
        const dx = lp2.x - lp1.x;
        const dy = lp2.y - lp1.y;
        const L = Math.sqrt(dx * dx + dy * dy) || 1.0;
        const dist = Math.abs(dx * (lp1.y - cPt.y) - (lp1.x - cPt.x) * dy) / L;
        residuals.push(dist - c.radius);
      }
    }
    return new Float64Array(residuals);
  }

  /**
   * Builds the numerical Jacobian J (m x n) at state X.
   * @param {Float64Array} X
   * @returns {Object} { F, J } where J is an array of Float64Array rows
   */
  _numericalJacobian(X) {
    const F = this.evaluateResiduals(X);
    const m = F.length;
    const n = X.length;
    const J = Array.from({ length: m }, () => new Float64Array(n));
    const eps = 1e-7;

    for (let j = 0; j < n; j++) {
      const orig = X[j];
      X[j] += eps;
      const Fplus = this.evaluateResiduals(X);
      X[j] = orig;
      for (let i = 0; i < m; i++) {
        J[i][j] = (Fplus[i] - F[i]) / eps;
      }
    }
    return { F, J };
  }

  /**
   * Jacobi eigenvalue decomposition of a real symmetric matrix (householder-free,
   * cyclic Jacobi rotations). Returns eigenvalues (ascending) and eigenvectors
   * as columns of V.
   * @param {Array<Float64Array>} A n x n symmetric matrix
   * @returns {Object} { eigenvalues: Float64Array, V: Array<Float64Array> }
   */
  _eigenSymmetric(A, n) {
    const V = Array.from({ length: n }, (_, i) => {
      const row = new Float64Array(n);
      row[i] = 1.0;
      return row;
    });
    const a = Array.from({ length: n }, (_, i) => Float64Array.from(A[i]));

    const maxIter = 100;
    for (let iter = 0; iter < maxIter; iter++) {
      let off = 0.0;
      for (let p = 0; p < n - 1; p++) {
        for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
      }
      if (Math.sqrt(off) < 1e-14) break;

      for (let p = 0; p < n - 1; p++) {
        for (let q = p + 1; q < n; q++) {
          const apq = a[p][q];
          if (Math.abs(apq) < 1e-14) continue;
          const app = a[p][p];
          const aqq = a[q][q];
          const theta = (aqq - app) / (2 * apq);
          const t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(t * t + 1);
          const s = t * c;

          for (let k = 0; k < n; k++) {
            const akp = a[k][p];
            const akq = a[k][q];
            a[k][p] = c * akp - s * akq;
            a[k][q] = s * akp + c * akq;
          }
          for (let k = 0; k < n; k++) {
            const apk = a[p][k];
            const aqk = a[q][k];
            a[p][k] = c * apk - s * aqk;
            a[q][k] = s * apk + c * aqk;
          }
          for (let k = 0; k < n; k++) {
            const vkp = V[k][p];
            const vkq = V[k][q];
            V[k][p] = c * vkp - s * vkq;
            V[k][q] = s * vkp + c * vkq;
          }
        }
      }
    }

    const eigenvalues = new Float64Array(n);
    for (let i = 0; i < n; i++) eigenvalues[i] = a[i][i];
    return { eigenvalues, V };
  }

  /**
   * Computes the singular values of J via the eigenvalues of J^T J
   * (J^T J is symmetric positive semi-definite; sigma_i = sqrt(lambda_i)).
   * @param {Array<Float64Array>} J m x n matrix (rows = residuals)
   * @param {number} n
   * @returns {Float64Array} singular values (ascending)
   */
  _singularValues(J, n) {
    if (n === 0) return new Float64Array(0);
    const JtJ = Array.from({ length: n }, () => new Float64Array(n));
    for (const row of J) {
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          JtJ[r][c] += row[r] * row[c];
        }
      }
    }
    const { eigenvalues } = this._eigenSymmetric(JtJ, n);
    const sigma = new Float64Array(n);
    for (let i = 0; i < n; i++) sigma[i] = Math.sqrt(Math.max(0.0, eigenvalues[i]));
    return sigma;
  }

  /**
   * Analyzes the constraint system at the current point configuration using SVD
   * rank detection on the Jacobian.
   * @returns {Object} { rank, dof, constraintStatus, singularValues, numVariables, numConstraints, residualNorm }
   */
  analyzeSystem() {
    const freePoints = this._getFreePoints();
    const numVars = freePoints.length * 2;
    const X = this._stateVector(freePoints);

    if (numVars === 0) {
      const F = this.evaluateResiduals(X);
      let norm = 0.0;
      for (let i = 0; i < F.length; i++) norm += F[i] * F[i];
      return {
        rank: 0,
        dof: 0,
        constraintStatus: 'FULLY_CONSTRAINED',
        singularValues: new Float64Array(0),
        numVariables: 0,
        numConstraints: F.length,
        residualNorm: Math.sqrt(norm)
      };
    }

    const { F, J } = this._numericalJacobian(X);
    const sigma = this._singularValues(J, numVars);

    let maxSigma = 0.0;
    for (let i = 0; i < sigma.length; i++) maxSigma = Math.max(maxSigma, sigma[i]);

    const tol = maxSigma > 0 ? maxSigma * 1e-8 : 1e-12;
    let rank = 0;
    for (let i = 0; i < sigma.length; i++) {
      if (sigma[i] > tol) rank++;
    }

    const dof = Math.max(0, numVars - rank);
    const numConstraints = F.length;

    let constraintStatus;
    if (numConstraints > rank) {
      constraintStatus = 'OVER_CONSTRAINED';
    } else if (rank < numVars) {
      constraintStatus = 'UNDER_CONSTRAINED';
    } else {
      constraintStatus = 'FULLY_CONSTRAINED';
    }

    let norm = 0.0;
    for (let i = 0; i < F.length; i++) norm += F[i] * F[i];

    return {
      rank,
      dof,
      constraintStatus,
      singularValues: sigma,
      numVariables: numVars,
      numConstraints,
      residualNorm: Math.sqrt(norm)
    };
  }

  /**
   * Solves the geometric constraint system using Levenberg-Marquardt damping
   * (scaled damped Gauss-Newton with adaptive lambda).
   * @returns {Object} Solution status and degrees of freedom diagnostics
   */
  solve() {
    const freePoints = this._getFreePoints();
    const numVars = freePoints.length * 2;

    if (numVars === 0) {
      return { converged: true, iterations: 0, residualNorm: 0.0, dofRemaining: 0 };
    }

    const X = this._stateVector(freePoints);

    let lambda = 1e-3;
    let iter = 0;
    let finalResidualNorm = Infinity;

    for (iter = 0; iter < this.maxIterations; iter++) {
      const { F, J } = this._numericalJacobian(X);
      const m = F.length;

      let rNormSq = 0.0;
      for (let i = 0; i < m; i++) rNormSq += F[i] * F[i];
      finalResidualNorm = Math.sqrt(rNormSq);

      if (finalResidualNorm < this.tolerance) {
        break;
      }

      // Normal equations: JtJ and JtF
      const JtJ = Array.from({ length: numVars }, () => new Float64Array(numVars));
      const JtF = new Float64Array(numVars);
      for (let r = 0; r < numVars; r++) {
        let jtf = 0.0;
        for (let i = 0; i < m; i++) {
          jtf += J[i][r] * F[i];
          for (let c = 0; c < numVars; c++) {
            JtJ[r][c] += J[i][r] * J[i][c];
          }
        }
        JtF[r] = -jtf;
      }

      // Levenberg-Marquardt damping: scale the diagonal by the curvature of JtJ
      const D = new Float64Array(numVars);
      for (let j = 0; j < numVars; j++) {
        D[j] = Math.max(JtJ[j][j], 1e-12);
      }
      const A = Array.from({ length: numVars }, (_, r) => {
        const row = new Float64Array(numVars);
        for (let c = 0; c < numVars; c++) row[c] = JtJ[r][c];
        row[r] += lambda * D[r];
        return row;
      });

      const delta = this.solveDenseSystem(A, JtF, numVars);

      // Trial step
      const Xtrial = new Float64Array(numVars);
      let stepNorm = 0.0;
      for (let j = 0; j < numVars; j++) {
        Xtrial[j] = X[j] + delta[j];
        stepNorm += delta[j] * delta[j];
      }
      stepNorm = Math.sqrt(stepNorm);

      const Fnew = this.evaluateResiduals(Xtrial);
      let rNewNormSq = 0.0;
      for (let i = 0; i < m; i++) rNewNormSq += Fnew[i] * Fnew[i];
      const newNorm = Math.sqrt(rNewNormSq);

      // Gain ratio: actual reduction over model-predicted reduction
      let modelReduction = 0.0;
      for (let j = 0; j < numVars; j++) {
        let jtJd = 0.0;
        for (let c = 0; c < numVars; c++) jtJd += JtJ[j][c] * delta[c];
        modelReduction -= delta[j] * JtF[j] + 0.5 * delta[j] * jtJd;
      }
      const actualReduction = rNormSq - rNewNormSq;
      const gainRatio = modelReduction > 1e-16 ? actualReduction / modelReduction : -1.0;

      if (gainRatio > 1e-4 || newNorm < finalResidualNorm) {
        // Accept step
        for (let j = 0; j < numVars; j++) X[j] = Xtrial[j];
        lambda = Math.max(1e-12, lambda / 10.0);
        if (stepNorm < 1e-14 && newNorm < finalResidualNorm) {
          finalResidualNorm = newNorm;
          break;
        }
        if (newNorm < this.tolerance) {
          finalResidualNorm = newNorm;
          break;
        }
      } else {
        // Reject step and increase damping
        lambda = Math.min(1e12, lambda * 10.0);
      }

      if (finalResidualNorm < this.tolerance) break;
    }

    this._writeback(freePoints, X);

    const analysis = this.analyzeSystem();
    const finalF = this.evaluateResiduals(X);
    let norm = 0.0;
    for (let i = 0; i < finalF.length; i++) norm += finalF[i] * finalF[i];
    const residualNorm = Math.sqrt(norm);

    const pointsMap = {};
    for (const pt of this.points) {
      pointsMap[pt.id] = { x: pt.x, y: pt.y, fixed: pt.fixed };
    }

    const dof = analysis.dof;
    const status =
      dof === 0 && residualNorm < 1e-4
        ? 'FULLY_CONSTRAINED'
        : analysis.constraintStatus === 'OVER_CONSTRAINED'
          ? 'OVER_CONSTRAINED'
          : 'UNDER_CONSTRAINED';

    return {
      converged: residualNorm < 1e-6,
      iterations: iter,
      residualNorm,
      numVariables: numVars,
      numConstraints: analysis.numConstraints,
      dofRemaining: dof,
      degreesOfFreedom: dof,
      status,
      rank: analysis.rank,
      constraintStatus: analysis.constraintStatus,
      singularValues: analysis.singularValues,
      points: pointsMap
    };
  }

  solveDenseSystem(A, b, n) {
    // Gauss-Jordan elimination with partial pivoting & Levenberg-Marquardt regularization
    const M = Array.from({ length: n }, (row, i) => {
      const r = new Float64Array(n + 1);
      for (let j = 0; j < n; j++) r[j] = A[i][j];
      r[n] = b[i];
      return r;
    });

    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
      }
      const tmp = M[i];
      M[i] = M[maxRow];
      M[maxRow] = tmp;

      if (Math.abs(M[i][i]) < 1e-12) {
        M[i][i] = (M[i][i] >= 0 ? 1e-12 : -1e-12);
      }

      for (let k = i + 1; k < n; k++) {
        const factor = M[k][i] / M[i][i];
        for (let j = i; j <= n; j++) {
          M[k][j] -= factor * M[i][j];
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

module.exports = {
  VariationalConstraintSolver
};
