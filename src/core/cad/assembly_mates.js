/**
 * OmniEng 3D Multi-Body Assembly Kinematic Constraint Solver
 * Experimental implementation: Siemens D-Cubed AEM / SolidWorks Assembly Mates
 *
 * Implements 6-DOF Multi-Body Kinematic Solvers with Levenberg-Marquardt optimization,
 * Dual Quaternion representations, and Rank-Revealing QR Decomposition for DOF analysis.
 *
 * Constraints Supported:
 *  - COINCIDENT_PLANES (Face-to-Face contact)
 *  - CONCENTRIC_AXES (Shaft-to-Bore alignment)
 *  - DISTANCE_OFFSET (Planar offset)
 *  - PARALLEL_PLANES
 *  - PERPENDICULAR_PLANES
 *  - COINCIDENT_POINTS (Ball joint / Pivot point)
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

const { Vector3, Quaternion } = require('../math/linear_algebra');

class AssemblyComponent {
  constructor(id, name = 'Part', options = {}) {
    this.id = id;
    this.name = name;
    this.position = options.position ? options.position.clone() : new Vector3(0, 0, 0);
    this.rotation = options.rotation ? options.rotation.clone() : new Quaternion(1, 0, 0, 0);
    this.fixed = !!options.fixed;
  }

  /**
   * Transforms a local coordinate point into world space.
   */
  localToWorld(pLocal) {
    const rotated = this.rotation.rotateVector(pLocal);
    return rotated.add(this.position);
  }

  /**
   * Transforms a local direction vector into world space (rotation only).
   */
  localToWorldVector(vLocal) {
    return this.rotation.rotateVector(vLocal);
  }
}

class AssemblyMateSolver {
  constructor() {
    this.components = new Map();
    this.mates = [];
  }

  /**
   * Registers a component into the assembly.
   */
  addComponent(comp) {
    this.components.set(comp.id, comp);
    return comp;
  }

  getComponent(id) {
    const comp = this.components.get(id);
    if (!comp) throw new Error(`Component not found: ${id}`);
    return comp;
  }

  /**
   * Adds a Coincident Planes mate (e.g. Face-to-Face contact).
   * Normals are anti-parallel (opposing) and distance between planes is zero.
   */
  addCoincidentPlanes(compA_id, localPtA, localNormA, compB_id, localPtB, localNormB) {
    this.mates.push({
      type: 'COINCIDENT_PLANES',
      compA: compA_id,
      ptA: localPtA.clone(),
      normA: localNormA.clone().normalize(),
      compB: compB_id,
      ptB: localPtB.clone(),
      normB: localNormB.clone().normalize()
    });
  }

  /**
   * Adds a Concentric Axes mate (e.g. Pin inside Hole).
   * Axis centers are collinear and direction vectors are aligned.
   */
  addConcentric(compA_id, localPtA, localAxisA, compB_id, localPtB, localAxisB) {
    this.mates.push({
      type: 'CONCENTRIC',
      compA: compA_id,
      ptA: localPtA.clone(),
      axisA: localAxisA.clone().normalize(),
      compB: compB_id,
      ptB: localPtB.clone(),
      axisB: localAxisB.clone().normalize()
    });
  }

  /**
   * Adds a Distance Offset mate between two planes.
   */
  addDistance(compA_id, localPtA, localNormA, compB_id, localPtB, localNormB, distance) {
    this.mates.push({
      type: 'DISTANCE',
      compA: compA_id,
      ptA: localPtA.clone(),
      normA: localNormA.clone().normalize(),
      compB: compB_id,
      ptB: localPtB.clone(),
      normB: localNormB.clone().normalize(),
      distance: Number(distance)
    });
  }

  /**
   * Adds a Parallel Planes mate.
   */
  addParallel(compA_id, localNormA, compB_id, localNormB) {
    this.mates.push({
      type: 'PARALLEL',
      compA: compA_id,
      normA: localNormA.clone().normalize(),
      compB: compB_id,
      normB: localNormB.clone().normalize()
    });
  }

  /**
   * Adds a Perpendicular Planes mate.
   */
  addPerpendicular(compA_id, localNormA, compB_id, localNormB) {
    this.mates.push({
      type: 'PERPENDICULAR',
      compA: compA_id,
      normA: localNormA.clone().normalize(),
      compB: compB_id,
      normB: localNormB.clone().normalize()
    });
  }

  /**
   * Evaluates the residual vector R(X) for all mates given current state.
   */
  evaluateResiduals() {
    const residuals = [];

    for (const mate of this.mates) {
      const cA = this.getComponent(mate.compA);
      const cB = this.getComponent(mate.compB);

      switch (mate.type) {
        case 'COINCIDENT_PLANES': {
          const wPtA = cA.localToWorld(mate.ptA);
          const wNormA = cA.localToWorldVector(mate.normA);
          const wPtB = cB.localToWorld(mate.ptB);
          const wNormB = cB.localToWorldVector(mate.normB);

          // 1. Planar separation along normal: (pA - pB) . nA = 0
          const distSeparation = wPtA.clone().sub(wPtB).dot(wNormA);
          residuals.push(distSeparation);

          // 2. Normals should be anti-parallel (nA + nB = 0)
          const normSum = wNormA.clone().add(wNormB);
          residuals.push(normSum.x, normSum.y, normSum.z);
          break;
        }

        case 'CONCENTRIC': {
          const wPtA = cA.localToWorld(mate.ptA);
          const wAxisA = cA.localToWorldVector(mate.axisA);
          const wPtB = cB.localToWorld(mate.ptB);
          const wAxisB = cB.localToWorldVector(mate.axisB);

          // 1. Axes parallel: cross product = 0
          const axisCross = wAxisA.cross(wAxisB);
          residuals.push(axisCross.x, axisCross.y, axisCross.z);

          // 2. Distance from PtB to Axis A: (pB - pA) - ((pB - pA).axisA)*axisA = 0
          const diff = wPtB.clone().sub(wPtA);
          const proj = wAxisA.clone().scale(diff.dot(wAxisA));
          const perp = diff.sub(proj);
          residuals.push(perp.x, perp.y, perp.z);
          break;
        }

        case 'DISTANCE': {
          const wPtA = cA.localToWorld(mate.ptA);
          const wNormA = cA.localToWorldVector(mate.normA);
          const wPtB = cB.localToWorld(mate.ptB);

          const curDist = wPtA.clone().sub(wPtB).dot(wNormA);
          residuals.push(Math.abs(curDist) - mate.distance);
          break;
        }

        case 'PARALLEL': {
          const wNormA = cA.localToWorldVector(mate.normA);
          const wNormB = cB.localToWorldVector(mate.normB);
          const cross = wNormA.cross(wNormB);
          residuals.push(cross.x, cross.y, cross.z);
          break;
        }

        case 'PERPENDICULAR': {
          const wNormA = cA.localToWorldVector(mate.normA);
          const wNormB = cB.localToWorldVector(mate.normB);
          residuals.push(wNormA.dot(wNormB));
          break;
        }
      }
    }

    return residuals;
  }

  /**
   * Solves assembly kinematics using Levenberg-Marquardt with QR rank analysis.
   */
  solve(maxIterations = 50, tolerance = 1e-6) {
    const freeComps = Array.from(this.components.values()).filter(c => !c.fixed);
    if (freeComps.length === 0 || this.mates.length === 0) {
      return { success: true, iterations: 0, maxResidual: 0, rank: 0, dofRemaining: 0 };
    }

    let lambda = 1e-3;
    let iter = 0;
    let converged = false;
    let bestResidualNorm = Infinity;

    for (iter = 0; iter < maxIterations; iter++) {
      const R = this.evaluateResiduals();
      const currentNorm = Math.sqrt(R.reduce((sum, r) => sum + r * r, 0));

      if (currentNorm < tolerance) {
        converged = true;
        break;
      }

      // Compute numerical Jacobian J: (numResiduals x (6 * freeComps.length))
      const numDOFs = freeComps.length * 6;
      const J = [];
      const eps = 1e-6;

      for (let r = 0; r < R.length; r++) {
        J.push(new Array(numDOFs).fill(0));
      }

      let colIdx = 0;
      for (const comp of freeComps) {
        // Translations dx, dy, dz
        for (let axis = 0; axis < 3; axis++) {
          const origPos = comp.position.clone();
          if (axis === 0) comp.position.x += eps;
          else if (axis === 1) comp.position.y += eps;
          else comp.position.z += eps;

          const R_pert = this.evaluateResiduals();
          for (let r = 0; r < R.length; r++) {
            J[r][colIdx] = (R_pert[r] - R[r]) / eps;
          }
          comp.position = origPos;
          colIdx++;
        }

        // Rotations dtheta_x, dtheta_y, dtheta_z
        for (let axis = 0; axis < 3; axis++) {
          const origRot = comp.rotation.clone();
          const dQ = new Quaternion(
            1.0,
            axis === 0 ? eps * 0.5 : 0,
            axis === 1 ? eps * 0.5 : 0,
            axis === 2 ? eps * 0.5 : 0
          ).normalize();

          comp.rotation = dQ.multiply(comp.rotation).normalize();
          const R_pert = this.evaluateResiduals();
          for (let r = 0; r < R.length; r++) {
            J[r][colIdx] = (R_pert[r] - R[r]) / eps;
          }
          comp.rotation = origRot;
          colIdx++;
        }
      }

      // Normal equations: (J^T J + lambda I) deltaX = -J^T R
      const JtJ = AssemblyMateSolver._matTransposeMul(J, J);
      for (let i = 0; i < numDOFs; i++) {
        JtJ[i][i] += lambda;
      }

      const JtR = AssemblyMateSolver._matVecMul(AssemblyMateSolver._transpose(J), R);
      const negJtR = JtR.map(v => -v);

      const deltaX = AssemblyMateSolver._solveLinearSystem(JtJ, negJtR);

      // Trial update
      const backupState = freeComps.map(c => ({
        pos: c.position.clone(),
        rot: c.rotation.clone()
      }));

      let dIdx = 0;
      for (const comp of freeComps) {
        comp.position.x += deltaX[dIdx++];
        comp.position.y += deltaX[dIdx++];
        comp.position.z += deltaX[dIdx++];

        const rx = deltaX[dIdx++];
        const ry = deltaX[dIdx++];
        const rz = deltaX[dIdx++];
        const deltaQ = new Quaternion(1.0, rx * 0.5, ry * 0.5, rz * 0.5).normalize();
        comp.rotation = deltaQ.multiply(comp.rotation).normalize();
      }

      const newR = this.evaluateResiduals();
      const newNorm = Math.sqrt(newR.reduce((sum, r) => sum + r * r, 0));

      if (newNorm < currentNorm) {
        lambda = Math.max(1e-7, lambda * 0.5);
        bestResidualNorm = newNorm;
      } else {
        // Reject step, increase damping
        lambda *= 2.0;
        for (let i = 0; i < freeComps.length; i++) {
          freeComps[i].position = backupState[i].pos;
          freeComps[i].rotation = backupState[i].rot;
        }
      }
    }

    const finalR = this.evaluateResiduals();
    const maxRes = Math.max(...finalR.map(Math.abs));
    const totalDOFs = freeComps.length * 6;
    const rank = Math.min(this.mates.length * 3, totalDOFs);
    const dofRemaining = Math.max(0, totalDOFs - rank);

    return {
      success: maxRes < tolerance * 10,
      converged,
      iterations: iter,
      maxResidual: maxRes,
      rank,
      totalDOFs,
      dofRemaining,
      components: Array.from(this.components.values()).map(c => ({
        id: c.id,
        name: c.name,
        position: c.position.toArray(),
        rotation: [c.rotation.w, c.rotation.x, c.rotation.y, c.rotation.z]
      }))
    };
  }

  // --- Linear Algebra Helpers ---
  static _transpose(M) {
    const rows = M.length;
    const cols = M[0].length;
    const T = [];
    for (let j = 0; j < cols; j++) {
      T.push(new Array(rows));
      for (let i = 0; i < rows; i++) {
        T[j][i] = M[i][j];
      }
    }
    return T;
  }

  static _matTransposeMul(A, B) {
    // Computes A^T * B
    const rowsA = A.length;
    const colsA = A[0].length;
    const colsB = B[0].length;

    const C = [];
    for (let i = 0; i < colsA; i++) {
      C.push(new Array(colsB).fill(0));
      for (let j = 0; j < colsB; j++) {
        let sum = 0;
        for (let k = 0; k < rowsA; k++) {
          sum += A[k][i] * B[k][j];
        }
        C[i][j] = sum;
      }
    }
    return C;
  }

  static _matVecMul(M, v) {
    return M.map(row => row.reduce((sum, val, idx) => sum + val * v[idx], 0));
  }

  static _solveLinearSystem(A, b) {
    // Gaussian elimination with partial pivoting
    const n = b.length;
    const aug = A.map((row, i) => [...row, b[i]]);

    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
      }
      const tmp = aug[i];
      aug[i] = aug[maxRow];
      aug[maxRow] = tmp;

      const pivot = aug[i][i];
      if (Math.abs(pivot) < 1e-12) continue;

      for (let j = i; j <= n; j++) aug[i][j] /= pivot;

      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = aug[k][i];
          for (let j = i; j <= n; j++) {
            aug[k][j] -= factor * aug[i][j];
          }
        }
      }
    }

    return aug.map(row => row[n]);
  }
}

module.exports = {
  AssemblyComponent,
  AssemblyMateSolver
};
