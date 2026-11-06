/**
 * NonlinearContinuumFEA: Large Deformation & Hyperelastic Material Engine
 *
 * Implements ANSYS Mechanical / Abaqus grade nonlinear continuum mechanics:
 *   1. Deformation gradient F = I + du/dX.
 *   2. Right Cauchy-Green deformation tensor C = F^T * F.
 *   3. Green-Lagrange strain tensor E = 0.5 * (C - I).
 *   4. Polar decomposition F = R * U via SVD / Newton iteration.
 *   5. Incompressible & nearly-incompressible Mooney-Rivlin hyperelastic strain energy:
 *      W = C10 * (I1_bar - 3) + C01 * (I2_bar - 3) + 0.5 * K_bulk * (J - 1)^2.
 *   6. Second Piola-Kirchhoff stress S and push-forward to Cauchy true stress sigma = (1/J) * F * S * F^T.
 */

'use strict';

const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

class NonlinearContinuumFEA {
  /**
   * @param {Object} [materialProps]
   */
  constructor(materialProps = {}) {
    // Default Mooney-Rivlin parameters (synthetic elastomer / rubber)
    this.C10 = materialProps.C10 ?? 0.4e6; // Pa
    this.C01 = materialProps.C01 ?? 0.1e6; // Pa
    this.K_bulk = materialProps.K_bulk ?? 1.0e8; // Pa (bulk modulus for near-incompressibility)
  }

  /**
   * Compute deformation gradient F, Green-Lagrange strain E, and volume ratio J
   * @param {Array<Array<number>>} gradU 3x3 displacement gradient matrix du_i / dX_j
   * @returns {{ F: number[][], C: number[][], E: number[][], J: number }}
   */
  computeDeformationTensors(gradU) {
    if (!gradU || gradU.length !== 3 || gradU[0].length !== 3) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Displacement gradient gradU must be a 3x3 matrix.');
    }

    // F = I + gradU
    const F = [
      [1.0 + gradU[0][0], gradU[0][1], gradU[0][2]],
      [gradU[1][0], 1.0 + gradU[1][1], gradU[1][2]],
      [gradU[2][0], gradU[2][1], 1.0 + gradU[2][2]]
    ];

    // Jacobian determinant J = det(F)
    const J =
      F[0][0] * (F[1][1] * F[2][2] - F[1][2] * F[2][1]) -
      F[0][1] * (F[1][0] * F[2][2] - F[1][2] * F[2][0]) +
      F[0][2] * (F[1][0] * F[2][1] - F[1][1] * F[2][0]);

    if (J <= 0) {
      throw new OmniError(
        OmniErrorCode.NUMERICAL_FAILURE,
        `Inverted element: non-positive Jacobian determinant J = ${J}.`
      );
    }

    // Right Cauchy-Green tensor C = F^T * F
    const C = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let sum = 0.0;
        for (let k = 0; k < 3; k++) {
          sum += F[k][i] * F[k][j];
        }
        C[i][j] = sum;
      }
    }

    // Green-Lagrange strain E = 0.5 * (C - I)
    const E = [
      [0.5 * (C[0][0] - 1.0), 0.5 * C[0][1], 0.5 * C[0][2]],
      [0.5 * C[1][0], 0.5 * (C[1][1] - 1.0), 0.5 * C[1][2]],
      [0.5 * C[2][0], 0.5 * C[2][1], 0.5 * (C[2][2] - 1.0)]
    ];

    return { F, C, E, J };
  }

  /**
   * Evaluate Mooney-Rivlin hyperelastic strain energy and 2nd Piola-Kirchhoff stress S
   * @param {Array<Array<number>>} C Right Cauchy-Green tensor 3x3
   * @param {number} J Volume ratio det(F)
   * @returns {{ S: number[][], strainEnergyW: number }}
   */
  evaluateMooneyRivlinStress(C, J) {
    const J23 = Math.pow(J, -2.0 / 3.0);
    const J43 = J23 * J23;

    // Modified invariants
    const I1 = C[0][0] + C[1][1] + C[2][2];
    const I1_bar = J23 * I1;

    // I2 = 0.5 * (I1^2 - tr(C^2))
    let trC2 = 0.0;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        trC2 += C[i][j] * C[j][i];
      }
    }
    const I2 = 0.5 * (I1 * I1 - trC2);
    const I2_bar = J43 * I2;

    // Strain energy W
    const W_iso = this.C10 * (I1_bar - 3.0) + this.C01 * (I2_bar - 3.0);
    const W_vol = 0.5 * this.K_bulk * (J - 1.0) * (J - 1.0);
    const strainEnergyW = W_iso + W_vol;

    // Inverse of C: C_inv
    const detC = J * J;
    const invC = [
      [
        (C[1][1] * C[2][2] - C[1][2] * C[2][1]) / detC,
        (C[0][2] * C[2][1] - C[0][1] * C[2][2]) / detC,
        (C[0][1] * C[1][2] - C[0][2] * C[1][1]) / detC
      ],
      [
        (C[1][2] * C[2][0] - C[1][0] * C[2][2]) / detC,
        (C[0][0] * C[2][2] - C[0][2] * C[2][0]) / detC,
        (C[0][2] * C[1][0] - C[0][0] * C[1][2]) / detC
      ],
      [
        (C[1][0] * C[2][1] - C[1][1] * C[2][0]) / detC,
        (C[0][1] * C[2][0] - C[0][0] * C[2][1]) / detC,
        (C[0][0] * C[1][1] - C[0][1] * C[1][0]) / detC
      ]
    ];

    // 2nd Piola-Kirchhoff stress S = 2 * dW/dC
    // S_iso = 2 * J^(-2/3) * ( (C10 + I1_bar * C01)*I - C01*J^(-2/3)*C - (1/3)*(C10*I1_bar + 2*C01*I2_bar)*invC )
    const p_vol = this.K_bulk * (J - 1.0); // Hydrostatic pressure
    const S = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];

    const term1 = 2.0 * J23 * (this.C10 + I1_bar * this.C01);
    const term2 = 2.0 * J43 * this.C01;
    const term3 = (2.0 / 3.0) * (this.C10 * I1_bar + 2.0 * this.C01 * I2_bar) - p_vol * J;

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const delta_ij = i === j ? 1.0 : 0.0;
        S[i][j] = term1 * delta_ij - term2 * C[i][j] - term3 * invC[i][j];
      }
    }

    return { S, strainEnergyW };
  }

  /**
   * Push forward 2nd Piola-Kirchhoff stress S to Cauchy true stress sigma = (1/J) * F * S * F^T
   * @param {number[][]} F
   * @param {number[][]} S
   * @param {number} J
   * @returns {number[][]} Cauchy stress tensor 3x3 (Pa)
   */
  pushForwardToCauchy(F, S, J) {
    const FS = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let sum = 0.0;
        for (let k = 0; k < 3; k++) sum += F[i][k] * S[k][j];
        FS[i][j] = sum;
      }
    }

    const sigma = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    const invJ = 1.0 / J;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let sum = 0.0;
        for (let k = 0; k < 3; k++) sum += FS[i][k] * F[j][k];
        sigma[i][j] = sum * invJ;
      }
    }
    return sigma;
  }

  /**
   * Polar decomposition F = R * U where R is orthogonal (rotation) and U is
   * symmetric positive-definite (right stretch). Computed via the spectral
   * decomposition of C = F^T F using the cyclic Jacobi method on the symmetric
   * 3x3 matrix: U = Q * diag(sqrt(lambda)) * Q^T, R = F * U^-1.
   * @param {number[][]} F 3x3 deformation gradient
   * @returns {{ R: number[][], U: number[][], V: number[][], sigma: number[] }}
   */
  polarDecompose(F) {
    const C = mat3TransposeTimes(F, F);
    const { Q, lambda } = jacobiEigenDecomposition(C);

    const sqrtL = new Array(3);
    const invSqrtL = new Array(3);
    for (let i = 0; i < 3; i++) {
      sqrtL[i] = lambda[i] > 0 ? Math.sqrt(lambda[i]) : 0;
      invSqrtL[i] = lambda[i] > 1e-30 ? 1 / Math.sqrt(lambda[i]) : 0;
    }

    const U = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    const Uinv = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let u = 0;
        let ui = 0;
        for (let k = 0; k < 3; k++) {
          u += Q[i][k] * sqrtL[k] * Q[j][k];
          ui += Q[i][k] * invSqrtL[k] * Q[j][k];
        }
        U[i][j] = u;
        Uinv[i][j] = ui;
      }
    }

    const R = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let r = 0;
        for (let k = 0; k < 3; k++) r += F[i][k] * Uinv[k][j];
        R[i][j] = r;
      }
    }

    return { R, U, V: Q, sigma: sqrtL };
  }
}

/**
 * Product C = A^T * B for 3x3 matrices (C[i][j] = sum_k A[k][i] * B[k][j]).
 */
function mat3TransposeTimes(A, B) {
  const C = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += A[k][i] * B[k][j];
      C[i][j] = sum;
    }
  }
  return C;
}

/**
 * Cyclic Jacobi eigendecomposition of a symmetric 3x3 matrix A.
 * Returns Q (orthonormal eigenvectors as columns) and eigenvalues lambda.
 */
function jacobiEigenDecomposition(A) {
  const a = A.map((row) => row.slice());
  const Q = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];

  for (let sweep = 0; sweep < 100; sweep++) {
    let p = 0;
    let q = 1;
    let maxOff = Math.abs(a[0][1]);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const v = Math.abs(a[i][j]);
        if (v > maxOff) {
          maxOff = v;
          p = i;
          q = j;
        }
      }
    }
    if (maxOff < 1e-15) break;
    if (Math.abs(a[p][q]) < 1e-300) break;

    const tau = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = c * t;

    const old = a.map((row) => row.slice());
    for (let k = 0; k < 3; k++) {
      const okp = old[k][p];
      const okq = old[k][q];
      a[k][p] = c * okp - s * okq;
      a[k][q] = s * okp + c * okq;
    }
    a[p][p] = c * c * old[p][p] - 2 * s * c * old[p][q] + s * s * old[q][q];
    a[q][q] = s * s * old[p][p] + 2 * s * c * old[p][q] + c * c * old[q][q];
    a[p][q] = 0;
    a[q][p] = 0;

    for (let k = 0; k < 3; k++) {
      const vkp = Q[k][p];
      const vkq = Q[k][q];
      Q[k][p] = c * vkp - s * vkq;
      Q[k][q] = s * vkp + c * vkq;
    }
  }

  return { Q, lambda: [a[0][0], a[1][1], a[2][2]] };
}

/**
 * Dense linear solve A x = b via Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A, b) {
  const n = b.length;
  const M = new Float64Array(n * n);
  M.set(A);
  const x = Array.from(b);

  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r * n + col]) > Math.abs(M[piv * n + col])) piv = r;
    }
    if (piv !== col) {
      for (let c = col; c < n; c++) {
        const tmp = M[col * n + c];
        M[col * n + c] = M[piv * n + c];
        M[piv * n + c] = tmp;
      }
      const tx = x[col];
      x[col] = x[piv];
      x[piv] = tx;
    }
    const d = M[col * n + col];
    if (Math.abs(d) < 1e-300) {
      throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'Singular tangent stiffness in beam solve.');
    }
    for (let r = col + 1; r < n; r++) {
      const f = M[r * n + col] / d;
      if (f === 0) continue;
      for (let c = col + 1; c < n; c++) M[r * n + c] -= f * M[col * n + c];
      x[r] -= f * x[col];
    }
  }

  const sol = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let c = r + 1; c < n; c++) s -= M[r * n + c] * sol[c];
    sol[r] = s / M[r * n + r];
  }
  return sol;
}

/**
 * NonlinearPlanarBeamSolver: geometrically nonlinear planar Euler-Bernoulli beam
 * using a corotational formulation. Each element's local frame follows the
 * deformed chord (length l, angle phi); local deformational variables are the
 * axial stretch e = l - L0 and the end rotations relative to the chord,
 * alpha_a = theta_a - phi, alpha_b = theta_b - phi. Local internal forces come
 * from the small-strain Bernoulli stiffness rotated back to the global frame,
 * with transverse shear forces statically determined by end-moment equilibrium.
 *
 * For an end moment M the elastica is a circular arc with curvature
 * kappa = M/(EI); the formulation reproduces the constant-curvature state for
 * each element (M = EI * (theta_b - theta_a) / L0), so the discrete solution
 * matches the elastica to within axial stretch effects.
 *
 * The cantilever is solved with load stepping (proportional end moment) and
 * Newton-Raphson iteration; the tangent stiffness is evaluated by central
 * finite differences of the residual. Deterministic: no randomness.
 */
class NonlinearPlanarBeamSolver {
  /**
   * @param {Object} [options]
   * @param {number} [options.EI=1.0] Bending rigidity (N*m^2)
   * @param {number} [options.EA=1e8] Axial rigidity (N)
   * @param {number} [options.loadSteps=8] Number of proportional load steps
   * @param {number} [options.tolerance=1e-8] Absolute residual tolerance (scaled)
   * @param {number} [options.maxIterations=60] Newton iterations per step
   */
  constructor(options = {}) {
    this.EI = options.EI ?? 1.0;
    this.EA = options.EA ?? 1e8;
    this.loadSteps = options.loadSteps ?? 8;
    this.tolerance = options.tolerance ?? 1e-8;
    this.maxIterations = options.maxIterations ?? 60;
  }

  /**
   * Solve a cantilever (root fixed at X=0, along +x) under an end moment M at
   * the free tip. Positive M bends counterclockwise (upward, +y).
   * @param {Object} params
   * @param {number} params.length Beam length (m)
   * @param {number} params.moment Applied end moment (N*m)
   * @param {number} [params.numElements=64] Number of beam elements
   * @returns {Object} Tip geometry, elastica reference, energies, convergence history
   */
  solveEndMomentCantilever(params) {
    if (!params || !Number.isFinite(params.length) || params.length <= 0) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'length must be a positive finite number.');
    }
    if (!Number.isFinite(params.moment)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'moment must be finite.');
    }
    const n = params.numElements ?? 64;
    if (!Number.isInteger(n) || n < 1 || n > 10000) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'numElements must be an integer from 1 to 10000.');
    }

    const L = params.length;
    const M = params.moment;
    const numNodes = n + 1;
    const dofs = 3 * numNodes;
    const X = [];
    for (let i = 0; i < numNodes; i++) X.push([(i * L) / n, 0]);

    const freeDofs = [];
    for (let d = 3; d < dofs; d++) freeDofs.push(d);
    const m = freeDofs.length;

    const q = new Float64Array(dofs);
    const scale = Math.max(1.0, Math.abs(M));

    const residualHistory = [];
    const tipRotations = [0];
    let converged = true;

    for (let step = 1; step <= this.loadSteps; step++) {
      const lambda = step / this.loadSteps;
      let resNorm = Infinity;
      let iter = 0;
      const stepResiduals = [];
      while (iter < this.maxIterations) {
        const r = this.computeResidual(q, X, lambda, M, n);
        resNorm = 0;
        for (let i = 0; i < m; i++) {
          const a = Math.abs(r[freeDofs[i]]);
          if (a > resNorm) resNorm = a;
        }
        stepResiduals.push(resNorm);
        if (resNorm <= this.tolerance * scale) break;

        const K = this.computeTangentStiffness(q, X, lambda, M, n, freeDofs, m);
        const b = new Float64Array(m);
        for (let i = 0; i < m; i++) b[i] = -r[freeDofs[i]];
        const delta = solveLinearSystem(K, b);
        for (let i = 0; i < m; i++) q[freeDofs[i]] += delta[i];
        iter++;
      }
      residualHistory.push({
        step,
        iterations: iter + 1,
        residuals: stepResiduals,
        finalResidual: resNorm
      });
      if (!(resNorm <= this.tolerance * scale)) converged = false;
      tipRotations.push(q[3 * n + 2]);
    }

    const tipX = L + q[3 * n];
    const tipY = q[3 * n + 1];
    const tipRotation = q[3 * n + 2];

    const internalStrainEnergy = this.computeInternalEnergy(q, X, n);
    let externalWork = 0;
    for (let step = 1; step <= this.loadSteps; step++) {
      const lamPrev = (step - 1) / this.loadSteps;
      const lamCur = step / this.loadSteps;
      externalWork += 0.5 * (lamPrev + lamCur) * M * (tipRotations[step] - tipRotations[step - 1]);
    }

    const kappa = M / this.EI;
    const kL = kappa * L;
    const elasticaTipX = kL > 0 ? Math.sin(kL) / kappa : L;
    const elasticaTipY = kL > 0 ? (1 - Math.cos(kL)) / kappa : 0;

    return {
      tipX,
      tipY,
      tipRotation,
      elasticaTipX,
      elasticaTipY,
      internalStrainEnergy,
      externalWork,
      relativeEnergyError: externalWork > 0 ? Math.abs(internalStrainEnergy - externalWork) / externalWork : NaN,
      converged,
      residualHistory,
      numElements: n,
      length: L,
      moment: M
    };
  }

  /**
   * Internal force vector of one element in global coordinates:
   * [fax, fay, ma, fbx, fby, mb].
   */
  elementForce(Xa, Xb, qa, qb) {
    const xa = Xa[0] + qa[0];
    const ya = Xa[1] + qa[1];
    const xb = Xb[0] + qb[0];
    const yb = Xb[1] + qb[1];
    const dx = xb - xa;
    const dy = yb - ya;
    const l = Math.hypot(dx, dy);
    const L0 = Math.hypot(Xb[0] - Xa[0], Xb[1] - Xa[1]);
    const phi = Math.atan2(dy, dx);
    const e = l - L0;
    const ta = qa[2] - phi;
    const tb = qb[2] - phi;

    const N = (this.EA / L0) * e;
    const Ma = ((4 * this.EI) / L0) * ta + ((2 * this.EI) / L0) * tb;
    const Mb = ((2 * this.EI) / L0) * ta + ((4 * this.EI) / L0) * tb;
    const Qa = (Ma + Mb) / l;

    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const fax = c * N - s * Qa;
    const fay = s * N + c * Qa;
    const fbx = -c * N + s * Qa;
    const fby = -s * N - c * Qa;
    return [fax, fay, Ma, fbx, fby, Mb];
  }

  /**
   * Global residual r = f_internal(q) - f_external(lambda*M).
   */
  computeResidual(q, X, lambda, M, n) {
    const r = new Float64Array(q.length);
    for (let e = 0; e < n; e++) {
      const a = e;
      const b = e + 1;
      const f = this.elementForce(X[a], X[b], q.subarray(3 * a, 3 * a + 3), q.subarray(3 * b, 3 * b + 3));
      r[3 * a] += f[0];
      r[3 * a + 1] += f[1];
      r[3 * a + 2] += f[2];
      r[3 * b] += f[3];
      r[3 * b + 1] += f[4];
      r[3 * b + 2] += f[5];
    }
    r[3 * n + 2] -= lambda * M;
    return r;
  }

  /**
   * Analytic tangent stiffness of the corotational element (6x6, row-major,
   * global DOF order [u_a, v_a, theta_a, u_b, v_b, theta_b]).
   */
  elementTangent(Xa, Xb, qa, qb) {
    const xa = Xa[0] + qa[0];
    const ya = Xa[1] + qa[1];
    const xb = Xb[0] + qb[0];
    const yb = Xb[1] + qb[1];
    const dx = xb - xa;
    const dy = yb - ya;
    const l = Math.hypot(dx, dy);
    const L0 = Math.hypot(Xb[0] - Xa[0], Xb[1] - Xa[1]);
    const phi = Math.atan2(dy, dx);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const e = l - L0;
    const ta = qa[2] - phi;
    const tb = qb[2] - phi;

    const kA = this.EA / L0;
    const kB = this.EI / L0;
    const N = kA * e;
    const Ma = kB * (4 * ta + 2 * tb);
    const Mb = kB * (2 * ta + 4 * tb);
    const Qa = (Ma + Mb) / l;

    const Kt = new Float64Array(36);
    const l2 = l * l;
    const l3 = l2 * l;

    const dofDx = [-1, 0, 0, 1, 0, 0];
    const dofDy = [0, -1, 0, 0, 1, 0];

    for (let j = 0; j < 6; j++) {
      const ddx = dofDx[j];
      const ddy = dofDy[j];
      const dl = (dx / l) * ddx + (dy / l) * ddy;
      const dc = ((dy * dy) / l3) * ddx - ((dx * dy) / l3) * ddy;
      const ds = -((dx * dy) / l3) * ddx + ((dx * dx) / l3) * ddy;
      const dphi = -(dy / l2) * ddx + (dx / l2) * ddy;
      const dN = kA * dl;
      const dMa = -6 * kB * dphi;
      const dMb = -6 * kB * dphi;
      const dQa = (dMa + dMb) / l - ((Ma + Mb) * dl) / l2;

      Kt[0 * 6 + j] = dc * N + c * dN - ds * Qa - s * dQa;
      Kt[1 * 6 + j] = ds * N + s * dN + dc * Qa + c * dQa;
      Kt[2 * 6 + j] = dMa;
      Kt[3 * 6 + j] = -dc * N - c * dN + ds * Qa + s * dQa;
      Kt[4 * 6 + j] = -ds * N - s * dN - dc * Qa - c * dQa;
      Kt[5 * 6 + j] = dMb;
    }

    const qRot = (6 * kB) / l;
    Kt[0 * 6 + 2] += -s * qRot;
    Kt[1 * 6 + 2] += c * qRot;
    Kt[2 * 6 + 2] += 4 * kB;
    Kt[3 * 6 + 2] += s * qRot;
    Kt[4 * 6 + 2] += -c * qRot;
    Kt[5 * 6 + 2] += 2 * kB;

    Kt[0 * 6 + 5] += -s * qRot;
    Kt[1 * 6 + 5] += c * qRot;
    Kt[2 * 6 + 5] += 2 * kB;
    Kt[3 * 6 + 5] += s * qRot;
    Kt[4 * 6 + 5] += -c * qRot;
    Kt[5 * 6 + 5] += 4 * kB;

    return Kt;
  }

  /**
   * Assembled tangent stiffness restricted to the free DOF block.
   */
  computeTangentStiffness(q, X, lambda, M, n, freeDofs, m) {
    const dofs = q.length;
    const Kg = new Float64Array(dofs * dofs);
    for (let e = 0; e < n; e++) {
      const base = 3 * e;
      const Kt = this.elementTangent(X[e], X[e + 1], q.subarray(base, base + 3), q.subarray(base + 3, base + 6));
      for (let i = 0; i < 6; i++) {
        const gi = base + i;
        for (let j = 0; j < 6; j++) {
          Kg[gi * dofs + base + j] += Kt[i * 6 + j];
        }
      }
    }
    const K = new Float64Array(m * m);
    for (let i = 0; i < m; i++) {
      const gi = freeDofs[i];
      for (let j = 0; j < m; j++) {
        K[i * m + j] = Kg[gi * dofs + freeDofs[j]];
      }
    }
    return K;
  }

  /**
   * Total internal strain energy: sum over elements of the small-strain
   * Bernoulli energy in the corotational frame (axial + bending).
   */
  computeInternalEnergy(q, X, n) {
    let U = 0;
    for (let e = 0; e < n; e++) {
      const a = e;
      const b = e + 1;
      U += this.elementEnergy(X[a], X[b], q.subarray(3 * a, 3 * a + 3), q.subarray(3 * b, 3 * b + 3));
    }
    return U;
  }

  elementEnergy(Xa, Xb, qa, qb) {
    const xa = Xa[0] + qa[0];
    const ya = Xa[1] + qa[1];
    const xb = Xb[0] + qb[0];
    const yb = Xb[1] + qb[1];
    const dx = xb - xa;
    const dy = yb - ya;
    const l = Math.hypot(dx, dy);
    const L0 = Math.hypot(Xb[0] - Xa[0], Xb[1] - Xa[1]);
    const phi = Math.atan2(dy, dx);
    const e = l - L0;
    const ta = qa[2] - phi;
    const tb = qb[2] - phi;
    const c = this.EI / L0;
    return 0.5 * (this.EA / L0) * e * e + 2 * c * ta * ta + 2 * c * tb * tb + 2 * c * ta * tb;
  }
}

module.exports = { NonlinearContinuumFEA, NonlinearPlanarBeamSolver };
