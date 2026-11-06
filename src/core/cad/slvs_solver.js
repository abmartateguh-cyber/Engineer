/**
 * slvs_solver.js
 *
 * Industrial Variational Constraint Solver modeling SolveSpace libslvs.
 * Resolves 2D sketch variational geometry and 3D multi-part assembly constraints
 * using Jacobian-based Levenberg-Marquardt / Newton-Raphson iterative satisfaction.
 */

'use strict';

class SlvsSolver {
  constructor() {
    this.points = new Map(); // id -> [x, y, z]
    this.params = []; // Flat array of variable parameters
    this.paramMap = new Map(); // paramKey -> index in this.params
    this.constraints = [];
  }

  /**
   * Add a geometric point entity to the solver system.
   */
  addPoint(id, x, y, z = 0, isFixed = false) {
    const coords = [Number(x), Number(y), Number(z)];
    this.points.set(id, { coords, isFixed });

    if (!isFixed) {
      const idxX = this.params.length;
      this.params.push(coords[0]);
      this.paramMap.set(`${id}_x`, idxX);

      const idxY = this.params.length;
      this.params.push(coords[1]);
      this.paramMap.set(`${id}_y`, idxY);

      const idxZ = this.params.length;
      this.params.push(coords[2]);
      this.paramMap.set(`${id}_z`, idxZ);
    }
    return id;
  }

  /**
   * Add a distance constraint between two points: dist(p1, p2) == targetDistance
   */
  addDistanceConstraint(pt1Id, pt2Id, targetDistance) {
    this.constraints.push({
      type: 'DISTANCE',
      p1: pt1Id,
      p2: pt2Id,
      val: Number(targetDistance),
      eval: (pts) => {
        const p1 = pts.get(pt1Id).coords;
        const p2 = pts.get(pt2Id).coords;
        const dx = p1[0] - p2[0];
        const dy = p1[1] - p2[1];
        const dz = p1[2] - p2[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return dist - targetDistance;
      }
    });
  }

  /**
   * Add a coincident constraint between two points: p1 == p2
   */
  addCoincidentConstraint(pt1Id, pt2Id) {
    this.constraints.push({
      type: 'COINCIDENT_X',
      p1: pt1Id,
      p2: pt2Id,
      eval: (pts) => pts.get(pt1Id).coords[0] - pts.get(pt2Id).coords[0]
    });
    this.constraints.push({
      type: 'COINCIDENT_Y',
      p1: pt1Id,
      p2: pt2Id,
      eval: (pts) => pts.get(pt1Id).coords[1] - pts.get(pt2Id).coords[1]
    });
    this.constraints.push({
      type: 'COINCIDENT_Z',
      p1: pt1Id,
      p2: pt2Id,
      eval: (pts) => pts.get(pt1Id).coords[2] - pts.get(pt2Id).coords[2]
    });
  }

  /**
   * Add a horizontal alignment constraint between two points: p1.y == p2.y
   */
  addHorizontalConstraint(pt1Id, pt2Id) {
    this.constraints.push({
      type: 'HORIZONTAL',
      p1: pt1Id,
      p2: pt2Id,
      eval: (pts) => pts.get(pt1Id).coords[1] - pts.get(pt2Id).coords[1]
    });
  }

  /**
   * Add a vertical alignment constraint between two points: p1.x == p2.x
   */
  addVerticalConstraint(pt1Id, pt2Id) {
    this.constraints.push({
      type: 'VERTICAL',
      p1: pt1Id,
      p2: pt2Id,
      eval: (pts) => pts.get(pt1Id).coords[0] - pts.get(pt2Id).coords[0]
    });
  }

  /**
   * Add a concentric constraint between two points (circle centers): p1 == p2
   */
  addConcentricConstraint(pt1Id, pt2Id) {
    this.constraints.push({
      type: 'CONCENTRIC_X',
      p1: pt1Id,
      p2: pt2Id,
      eval: (pts) => pts.get(pt1Id).coords[0] - pts.get(pt2Id).coords[0]
    });
    this.constraints.push({
      type: 'CONCENTRIC_Y',
      p1: pt1Id,
      p2: pt2Id,
      eval: (pts) => pts.get(pt1Id).coords[1] - pts.get(pt2Id).coords[1]
    });
    this.constraints.push({
      type: 'CONCENTRIC_Z',
      p1: pt1Id,
      p2: pt2Id,
      eval: (pts) => pts.get(pt1Id).coords[2] - pts.get(pt2Id).coords[2]
    });
  }

  /**
   * Add a perpendicular constraint between two segments: (p1->p2) . (p3->p4) == 0
   */
  addPerpendicularConstraint(pt1Id, pt2Id, pt3Id, pt4Id = null) {
    const pStart2 = pt4Id ? pt3Id : pt2Id;
    const pEnd2 = pt4Id || pt3Id;
    this.constraints.push({
      type: 'PERPENDICULAR',
      p1: pt1Id,
      p2: pt2Id,
      p3: pStart2,
      p4: pEnd2,
      eval: (pts) => {
        const p1 = pts.get(pt1Id).coords;
        const p2 = pts.get(pt2Id).coords;
        const p3 = pts.get(pStart2).coords;
        const p4 = pts.get(pEnd2).coords;
        const v1x = p2[0] - p1[0];
        const v1y = p2[1] - p1[1];
        const v1z = p2[2] - p1[2];
        const v2x = p4[0] - p3[0];
        const v2y = p4[1] - p3[1];
        const v2z = p4[2] - p3[2];
        return v1x * v2x + v1y * v2y + v1z * v2z;
      }
    });
  }

  /**
   * Add a tangent constraint between a line (p1->p2) and a circle with center and radius
   */
  addTangentConstraint(pt1Id, pt2Id, centerPtId, radius) {
    const r = Number(radius);
    this.constraints.push({
      type: 'TANGENT',
      p1: pt1Id,
      p2: pt2Id,
      center: centerPtId,
      radius: r,
      eval: (pts) => {
        const p1 = pts.get(pt1Id).coords;
        const p2 = pts.get(pt2Id).coords;
        const c = pts.get(centerPtId).coords;
        const ux = p2[0] - p1[0];
        const uy = p2[1] - p1[1];
        const uz = p2[2] - p1[2];
        const wx = c[0] - p1[0];
        const wy = c[1] - p1[1];
        const wz = c[2] - p1[2];
        const cx = uy * wz - uz * wy;
        const cy = uz * wx - ux * wz;
        const cz = ux * wy - uy * wx;
        const crossNorm = Math.sqrt(cx * cx + cy * cy + cz * cz);
        const uNorm = Math.sqrt(ux * ux + uy * uy + uz * uz);
        const dist = crossNorm / Math.max(1e-12, uNorm);
        return dist - r;
      }
    });
  }

  /**
   * Add an angle constraint between two segments: angle((p1->p2), (p3->p4)) == targetAngleRad
   */
  addAngleConstraint(pt1Id, pt2Id, pt3Id, pt4Id = null, angleRad = 0) {
    let p3 = pt3Id;
    let p4 = pt4Id;
    let target = angleRad;
    if (typeof pt4Id === 'number' && (angleRad === 0 || angleRad === null || angleRad === undefined)) {
      target = pt4Id;
      p4 = pt3Id;
      p3 = pt2Id;
    } else if (pt4Id === null || pt4Id === undefined) {
      p4 = pt3Id;
      p3 = pt2Id;
    }
    const targetAngle = Number(target);
    this.constraints.push({
      type: 'ANGLE',
      p1: pt1Id,
      p2: pt2Id,
      p3,
      p4,
      angle: targetAngle,
      eval: (pts) => {
        const p1 = pts.get(pt1Id).coords;
        const p2 = pts.get(pt2Id).coords;
        const pt3Coord = pts.get(p3).coords;
        const pt4Coord = pts.get(p4).coords;
        const v1x = p2[0] - p1[0];
        const v1y = p2[1] - p1[1];
        const v1z = p2[2] - p1[2];
        const v2x = pt4Coord[0] - pt3Coord[0];
        const v2y = pt4Coord[1] - pt3Coord[1];
        const v2z = pt4Coord[2] - pt3Coord[2];
        const dot = v1x * v2x + v1y * v2y + v1z * v2z;
        const l1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z);
        const l2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z);
        const cosCurrent = dot / Math.max(1e-12, l1 * l2);
        return cosCurrent - Math.cos(targetAngle);
      }
    });
  }

  /**
   * Synchronize internal parameters into point coordinates
   */
  _syncPoints(paramVec) {
    for (const [id, pt] of this.points.entries()) {
      if (!pt.isFixed) {
        const ix = this.paramMap.get(`${id}_x`);
        const iy = this.paramMap.get(`${id}_y`);
        const iz = this.paramMap.get(`${id}_z`);
        if (ix !== undefined) pt.coords[0] = paramVec[ix];
        if (iy !== undefined) pt.coords[1] = paramVec[iy];
        if (iz !== undefined) pt.coords[2] = paramVec[iz];
      }
    }
  }

  /**
   * Solves the nonlinear variational constraint system via Levenberg-Marquardt.
   */
  solve({ maxIterations = 50, tolerance = 1e-7 } = {}) {
    const N = this.params.length;
    const M = this.constraints.length;

    if (N === 0 || M === 0) {
      return {
        converged: true,
        iterations: 0,
        residualNorm: 0,
        dof: N - M,
        effectiveDof: N,
        rank: 0,
        parameterCount: N,
        constraintCount: M,
        points: Object.fromEntries(
          Array.from(this.points.entries()).map(([k, v]) => [k, [...v.coords]])
        )
      };
    }

    let x = [...this.params];
    let lambda = 1e-3;
    let lastJ = null;

    for (let iter = 0; iter < maxIterations; iter++) {
      this._syncPoints(x);

      // Compute residual vector r(x)
      const r = new Float64Array(M);
      let normSq = 0;
      for (let i = 0; i < M; i++) {
        r[i] = this.constraints[i].eval(this.points);
        normSq += r[i] * r[i];
      }
      const resNorm = Math.sqrt(normSq);

      if (resNorm < tolerance) {
        let J_eval = lastJ;
        if (!J_eval) {
          const eps = 1e-8;
          J_eval = [];
          for (let i = 0; i < M; i++) J_eval[i] = new Float64Array(N);
          for (let j = 0; j < N; j++) {
            const xPerturbed = [...x];
            xPerturbed[j] += eps;
            this._syncPoints(xPerturbed);
            for (let i = 0; i < M; i++) {
              const rPerturbed = this.constraints[i].eval(this.points);
              J_eval[i][j] = (rPerturbed - r[i]) / eps;
            }
          }
          this._syncPoints(x);
        }
        const rank = this._computeRank(J_eval, M, N);
        return {
          converged: true,
          iterations: iter,
          residualNorm: resNorm,
          dof: Math.max(0, N - M),
          effectiveDof: Math.max(0, N - rank),
          rank,
          parameterCount: N,
          constraintCount: M,
          points: Object.fromEntries(
            Array.from(this.points.entries()).map(([k, v]) => [k, [...v.coords]])
          )
        };
      }

      // Compute numerical Jacobian J (M x N)
      const eps = 1e-8;
      const J = [];
      for (let i = 0; i < M; i++) {
        J[i] = new Float64Array(N);
      }

      for (let j = 0; j < N; j++) {
        const xPerturbed = [...x];
        xPerturbed[j] += eps;
        this._syncPoints(xPerturbed);

        for (let i = 0; i < M; i++) {
          const rPerturbed = this.constraints[i].eval(this.points);
          J[i][j] = (rPerturbed - r[i]) / eps;
        }
      }
      this._syncPoints(x);
      lastJ = J;

      // Compute Normal Equations: (J^T J + lambda I) delta_x = -J^T r
      const JtJ = [];
      const JtR = new Float64Array(N);

      for (let j = 0; j < N; j++) {
        JtJ[j] = new Float64Array(N);
        for (let k = 0; k < N; k++) {
          let sum = 0;
          for (let i = 0; i < M; i++) {
            sum += J[i][j] * J[i][k];
          }
          JtJ[j][k] = sum;
        }
        JtJ[j][j] += lambda;

        let sumR = 0;
        for (let i = 0; i < M; i++) {
          sumR += J[i][j] * r[i];
        }
        JtR[j] = -sumR;
      }

      // Solve small linear system via Gauss-Jordan elimination
      const deltaX = this._solveLinearSystem(JtJ, JtR);
      if (!deltaX) {
        lambda *= 10;
        continue;
      }

      // Candidate step update
      const xCandidate = [];
      for (let j = 0; j < N; j++) {
        xCandidate[j] = x[j] + deltaX[j];
      }

      this._syncPoints(xCandidate);
      let candidateNormSq = 0;
      for (let i = 0; i < M; i++) {
        const rc = this.constraints[i].eval(this.points);
        candidateNormSq += rc * rc;
      }

      if (candidateNormSq < normSq) {
        x = xCandidate;
        lambda = Math.max(1e-7, lambda / 5.0);
      } else {
        lambda *= 5.0;
      }
    }

    this._syncPoints(x);
    let finalNorm = 0;
    for (let i = 0; i < M; i++) {
      const rf = this.constraints[i].eval(this.points);
      finalNorm += rf * rf;
    }

    const rank = lastJ ? this._computeRank(lastJ, M, N) : 0;
    return {
      converged: Math.sqrt(finalNorm) < tolerance,
      iterations: maxIterations,
      residualNorm: Math.sqrt(finalNorm),
      dof: Math.max(0, N - M),
      effectiveDof: Math.max(0, N - rank),
      rank,
      parameterCount: N,
      constraintCount: M,
      points: Object.fromEntries(
        Array.from(this.points.entries()).map(([k, v]) => [k, [...v.coords]])
      )
    };
  }

  _computeRank(J, M, N, tol = 1e-7) {
    if (!J || M === 0 || N === 0) return 0;
    const mat = [];
    for (let i = 0; i < M; i++) {
      mat[i] = new Float64Array(J[i]);
    }
    let rank = 0;
    let lead = 0;
    for (let r = 0; r < M && lead < N; r++) {
      let i = r;
      while (i < M && Math.abs(mat[i][lead]) < tol) {
        i++;
      }
      if (i === M) {
        lead++;
        r--;
        continue;
      }
      const tmp = mat[r];
      mat[r] = mat[i];
      mat[i] = tmp;
      const pivot = mat[r][lead];
      for (let j = 0; j < N; j++) mat[r][j] /= pivot;
      for (let k = 0; k < M; k++) {
        if (k !== r) {
          const factor = mat[k][lead];
          for (let j = 0; j < N; j++) mat[k][j] -= factor * mat[r][j];
        }
      }
      lead++;
      rank++;
    }
    return rank;
  }

  _solveLinearSystem(A, b) {
    const n = b.length;
    const M = [];
    for (let i = 0; i < n; i++) {
      M[i] = new Float64Array(n + 1);
      for (let j = 0; j < n; j++) M[i][j] = A[i][j];
      M[i][n] = b[i];
    }

    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
      }
      const tmp = M[i];
      M[i] = M[maxRow];
      M[maxRow] = tmp;

      if (Math.abs(M[i][i]) < 1e-12) return null;

      const pivot = M[i][i];
      for (let j = i; j <= n; j++) M[i][j] /= pivot;

      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = M[k][i];
          for (let j = i; j <= n; j++) {
            M[k][j] -= factor * M[i][j];
          }
        }
      }
    }

    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = M[i][n];
    return x;
  }
}

module.exports = {
  SlvsSolver
};
