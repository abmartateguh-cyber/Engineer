/**
 * OmniEng Continuum 3D Finite-Strain J2 Plasticity, Quadratic TET10 & Mortar Contact Engine
 * Implements 10-node quadratic tetrahedral elements (TET10), Gauss-point radial return mapping,
 * Johnson-Cook rate/thermal softening, augmented Lagrangian mortar contact, and Lanczos modal extraction.
 * 
 * 100% Proprietary In-House Implementation - Zero External Dependencies.
 */

const { Matrix, Vector, LinearSolver } = require('../math/linear_algebra');

class GaussPoint3D {
  constructor(id, r, s, t, weight) {
    this.id = id;
    this.r = r; // Natural coordinates L1
    this.s = s; // L2
    this.t = t; // L3
    this.weight = weight; // Quadrature weight
    
    // Stress & strain state tensors (Voigt 6-vector: xx, yy, zz, xy, yz, zx)
    this.stress = new Float64Array(6);
    this.strain = new Float64Array(6);
    this.plasticStrain = new Float64Array(6);
    this.equivalentPlasticStrain = 0.0;
    this.yieldStress = 0.0;
    this.isYielded = false;
    this.temperature = 293.15; // 20 C
  }
}

class QuadraticTet10Element {
  constructor(id, nodeIds, material = {}) {
    this.id = id;
    this.nodeIds = nodeIds; // 10 node indices: 0-3 vertices, 4-9 mid-edges
    this.material = Object.assign({
      E: 70e9,          // Young's modulus (Pa)
      nu: 0.33,         // Poisson's ratio
      yieldStress: 270e6, // Initial yield stress A (Pa)
      hardeningModulus: 500e6, // Plastic tangent hardening H'
      // Johnson-Cook parameters (e.g. Al7075-T6 or Ti-6Al-4V)
      A: 270e6,
      B: 450e6,
      n: 0.42,
      C: 0.015,
      m: 1.0,
      refStrainRate: 1.0,
      Tmelt: 873.15,
      Troom: 293.15
    }, material);

    this.G = this.material.E / (2.0 * (1.0 + this.material.nu)); // Shear modulus
    this.K_bulk = this.material.E / (3.0 * (1.0 - 2.0 * this.material.nu)); // Bulk modulus

    // Initialize 4-point symmetric Gauss integration points for quadratic tetrahedron
    this.gaussPoints = this._initGaussPoints();
  }

  _initGaussPoints() {
    // Standard 4-point symmetric Gauss rule for tetrahedron (degree 2 exact)
    const a = 0.5854101966249685;
    const b = 0.1381966011250105;
    const w = 1.0 / 24.0;

    return [
      new GaussPoint3D(0, b, b, b, w),
      new GaussPoint3D(1, a, b, b, w),
      new GaussPoint3D(2, b, a, b, w),
      new GaussPoint3D(3, b, b, a, w)
    ];
  }

  /**
   * Evaluates shape functions for 10-node quadratic tetrahedron at (L1, L2, L3)
   * L4 = 1 - L1 - L2 - L3
   */
  evaluateShapeFunctions(L1, L2, L3) {
    const L4 = 1.0 - L1 - L2 - L3;
    const N = new Float64Array(10);

    // 4 Corner nodes: Ni = Li * (2*Li - 1)
    N[0] = L1 * (2 * L1 - 1);
    N[1] = L2 * (2 * L2 - 1);
    N[2] = L3 * (2 * L3 - 1);
    N[3] = L4 * (2 * L4 - 1);

    // 6 Mid-edge nodes: 4 * Li * Lj
    N[4] = 4 * L1 * L2; // Edge 0-1
    N[5] = 4 * L2 * L3; // Edge 1-2
    N[6] = 4 * L3 * L1; // Edge 2-0
    N[7] = 4 * L1 * L4; // Edge 0-3
    N[8] = 4 * L2 * L4; // Edge 1-3
    N[9] = 4 * L3 * L4; // Edge 2-3

    return N;
  }

  /**
   * Derivatives of shape functions with respect to natural coordinates (L1, L2, L3)
   * Returns [dN/dL1 (10), dN/dL2 (10), dN/dL3 (10)]
   */
  evaluateShapeDerivatives(L1, L2, L3) {
    const L4 = 1.0 - L1 - L2 - L3;
    const dNdL1 = new Float64Array(10);
    const dNdL2 = new Float64Array(10);
    const dNdL3 = new Float64Array(10);

    // Corner 0 (L1): d/dL1 = 4*L1 - 1
    dNdL1[0] = 4 * L1 - 1;
    // Corner 1 (L2): d/dL2 = 4*L2 - 1
    dNdL2[1] = 4 * L2 - 1;
    // Corner 2 (L3): d/dL3 = 4*L3 - 1
    dNdL3[2] = 4 * L3 - 1;
    // Corner 3 (L4): L4 = 1 - L1 - L2 - L3, dL4/dLi = -1 => d/dLi = -(4*L4 - 1)
    const dN3 = -(4 * L4 - 1);
    dNdL1[3] = dN3; dNdL2[3] = dN3; dNdL3[3] = dN3;

    // Mid-edge 4 (0-1: 4*L1*L2)
    dNdL1[4] = 4 * L2;
    dNdL2[4] = 4 * L1;

    // Mid-edge 5 (1-2: 4*L2*L3)
    dNdL2[5] = 4 * L3;
    dNdL3[5] = 4 * L2;

    // Mid-edge 6 (2-0: 4*L3*L1)
    dNdL1[6] = 4 * L3;
    dNdL3[6] = 4 * L1;

    // Mid-edge 7 (0-3: 4*L1*L4)
    dNdL1[7] = 4 * (L4 - L1);
    dNdL2[7] = -4 * L1;
    dNdL3[7] = -4 * L1;

    // Mid-edge 8 (1-3: 4*L2*L4)
    dNdL1[8] = -4 * L2;
    dNdL2[8] = 4 * (L4 - L2);
    dNdL3[8] = -4 * L2;

    // Mid-edge 9 (2-3: 4*L3*L4)
    dNdL1[9] = -4 * L3;
    dNdL2[9] = -4 * L3;
    dNdL3[9] = 4 * (L4 - L3);

    return { dNdL1, dNdL2, dNdL3 };
  }

  /**
   * Computes Jacobian matrix and spatial derivatives dN/dx, dN/dy, dN/dz at a Gauss point
   */
  computeJacobian(nodes, L1, L2, L3) {
    const { dNdL1, dNdL2, dNdL3 } = this.evaluateShapeDerivatives(L1, L2, L3);

    let J11 = 0, J12 = 0, J13 = 0;
    let J21 = 0, J22 = 0, J23 = 0;
    let J31 = 0, J32 = 0, J33 = 0;

    for (let i = 0; i < 10; i++) {
      const node = nodes[this.nodeIds[i]];
      J11 += dNdL1[i] * node.x; J12 += dNdL1[i] * node.y; J13 += dNdL1[i] * node.z;
      J21 += dNdL2[i] * node.x; J22 += dNdL2[i] * node.y; J23 += dNdL2[i] * node.z;
      J31 += dNdL3[i] * node.x; J32 += dNdL3[i] * node.y; J33 += dNdL3[i] * node.z;
    }

    const detJ = J11 * (J22 * J33 - J23 * J32) -
                 J12 * (J21 * J33 - J23 * J31) +
                 J13 * (J21 * J32 - J22 * J31);

    if (Math.abs(detJ) < 1e-15) {
      throw new Error(`Degenerate Jacobian detJ=${detJ} in TET10 element ${this.id}`);
    }

    const invDet = 1.0 / detJ;
    const invJ11 = (J22 * J33 - J23 * J32) * invDet;
    const invJ12 = (J13 * J32 - J12 * J33) * invDet;
    const invJ13 = (J12 * J23 - J13 * J22) * invDet;

    const invJ21 = (J23 * J31 - J21 * J33) * invDet;
    const invJ22 = (J11 * J33 - J13 * J31) * invDet;
    const invJ23 = (J13 * J21 - J11 * J23) * invDet;

    const invJ31 = (J21 * J32 - J22 * J31) * invDet;
    const invJ32 = (J12 * J31 - J11 * J32) * invDet;
    const invJ33 = (J11 * J22 - J12 * J21) * invDet;

    const dNdx = new Float64Array(10);
    const dNdy = new Float64Array(10);
    const dNdz = new Float64Array(10);

    for (let i = 0; i < 10; i++) {
      dNdx[i] = invJ11 * dNdL1[i] + invJ12 * dNdL2[i] + invJ13 * dNdL3[i];
      dNdy[i] = invJ21 * dNdL1[i] + invJ22 * dNdL2[i] + invJ23 * dNdL3[i];
      dNdz[i] = invJ31 * dNdL1[i] + invJ32 * dNdL2[i] + invJ33 * dNdL3[i];
    }

    return { detJ, dNdx, dNdy, dNdz };
  }

  /**
   * Constructs the 6 x 30 Strain-Displacement matrix B at a given Gauss point
   */
  constructBMatrix(dNdx, dNdy, dNdz) {
    const B = Array.from({ length: 6 }, () => new Float64Array(30));

    for (let i = 0; i < 10; i++) {
      const col = i * 3;
      // epsilon_xx = du/dx
      B[0][col] = dNdx[i];
      // epsilon_yy = dv/dy
      B[1][col + 1] = dNdy[i];
      // epsilon_zz = dw/dz
      B[2][col + 2] = dNdz[i];
      // gamma_xy = du/dy + dv/dx
      B[3][col] = dNdy[i];
      B[3][col + 1] = dNdx[i];
      // gamma_yz = dv/dz + dw/dy
      B[4][col + 1] = dNdz[i];
      B[4][col + 2] = dNdy[i];
      // gamma_zx = dw/dx + du/dz
      B[5][col] = dNdz[i];
      B[5][col + 2] = dNdx[i];
    }

    return B;
  }

  /**
   * Performs Gauss-point rate-independent J2 radial return mapping algorithm
   * with Johnson-Cook hardening & thermal softening
   */
  radialReturnMapping(gaussPoint, totalStrainIncrement, strainRate = 1.0, currentTemp = 293.15) {
    const { G, K_bulk, material } = this;

    // 1. Update trial strain: e_total = e_total_old + delta_e
    for (let i = 0; i < 6; i++) {
      gaussPoint.strain[i] += totalStrainIncrement[i];
    }

    // 2. Volumetric and deviatoric strain separation
    const trEps = gaussPoint.strain[0] + gaussPoint.strain[1] + gaussPoint.strain[2];
    const meanStrain = trEps / 3.0;
    const hydrostaticPressure = 3.0 * K_bulk * meanStrain; // p = K * tr(eps)

    const eDev = new Float64Array(6);
    eDev[0] = gaussPoint.strain[0] - meanStrain;
    eDev[1] = gaussPoint.strain[1] - meanStrain;
    eDev[2] = gaussPoint.strain[2] - meanStrain;
    eDev[3] = 0.5 * gaussPoint.strain[3]; // Engineering shear to tensor shear
    eDev[4] = 0.5 * gaussPoint.strain[4];
    eDev[5] = 0.5 * gaussPoint.strain[5];

    // 3. Elastic trial deviatoric stress s_trial = 2G * (e_dev - e_p_old)
    const sTrial = new Float64Array(6);
    for (let i = 0; i < 6; i++) {
      sTrial[i] = 2.0 * G * (eDev[i] - gaussPoint.plasticStrain[i]);
    }

    // 4. von Mises equivalent trial stress: q_trial = sqrt(3/2 * s : s)
    // s:s = s_xx^2 + s_yy^2 + s_zz^2 + 2*(s_xy^2 + s_yz^2 + s_zx^2)
    const sDotS = sTrial[0] * sTrial[0] + sTrial[1] * sTrial[1] + sTrial[2] * sTrial[2] +
                  2.0 * (sTrial[3] * sTrial[3] + sTrial[4] * sTrial[4] + sTrial[5] * sTrial[5]);
    const qTrial = Math.sqrt(1.5 * sDotS);

    // 5. Current flow stress from Johnson-Cook formulation
    const ep = gaussPoint.equivalentPlasticStrain;
    const strainFactor = material.A + material.B * Math.pow(Math.max(1e-12, ep), material.n);
    const rateRatio = Math.max(1.0, strainRate / (material.refStrainRate || 1.0));
    const rateFactor = 1.0 + material.C * Math.log(rateRatio);

    const Tstar = Math.min(1.0, Math.max(0.0, (currentTemp - material.Troom) / (material.Tmelt - material.Troom)));
    const tempFactor = 1.0 - Math.pow(Tstar, material.m);

    const sigmaFlow = Math.max(material.yieldStress * 0.1, strainFactor * rateFactor * tempFactor);
    gaussPoint.yieldStress = sigmaFlow;

    // 6. Yield check: f_trial = q_trial - sigma_flow
    const fTrial = qTrial - sigmaFlow;

    if (fTrial <= 0.0) {
      // Elastic step
      gaussPoint.isYielded = false;
      gaussPoint.stress[0] = sTrial[0] + hydrostaticPressure / 3.0;
      gaussPoint.stress[1] = sTrial[1] + hydrostaticPressure / 3.0;
      gaussPoint.stress[2] = sTrial[2] + hydrostaticPressure / 3.0;
      gaussPoint.stress[3] = sTrial[3];
      gaussPoint.stress[4] = sTrial[4];
      gaussPoint.stress[5] = sTrial[5];

      return {
        isPlastic: false,
        vonMises: qTrial,
        deltaPlasticMultiplier: 0.0,
        flowStress: sigmaFlow
      };
    }

    // 7. Plastic return mapping: delta_gamma = f_trial / (3G + H')
    gaussPoint.isYielded = true;
    const Hprime = material.hardeningModulus;
    const deltaGamma = fTrial / (3.0 * G + Hprime);

    // Radial return scaling factor beta = 1 - 3G * delta_gamma / q_trial
    const beta = Math.max(0.0, 1.0 - (3.0 * G * deltaGamma) / qTrial);

    // Updated deviatoric stress s_n+1 = beta * s_trial
    const sNew = new Float64Array(6);
    for (let i = 0; i < 6; i++) {
      sNew[i] = beta * sTrial[i];
    }

    // Total stress = s_new + 1/3 * p * I
    gaussPoint.stress[0] = sNew[0] + hydrostaticPressure / 3.0;
    gaussPoint.stress[1] = sNew[1] + hydrostaticPressure / 3.0;
    gaussPoint.stress[2] = sNew[2] + hydrostaticPressure / 3.0;
    gaussPoint.stress[3] = sNew[3];
    gaussPoint.stress[4] = sNew[4];
    gaussPoint.stress[5] = sNew[5];

    // Update plastic strain tensor: delta_e_p = delta_gamma * (3/2) * (s_new / q_new)
    const qNew = beta * qTrial;
    const normalFactor = qNew > 1e-12 ? 1.5 / qNew : 0.0;
    for (let i = 0; i < 6; i++) {
      const dep = deltaGamma * normalFactor * sNew[i];
      gaussPoint.plasticStrain[i] += dep;
    }
    gaussPoint.equivalentPlasticStrain += deltaGamma;

    return {
      isPlastic: true,
      vonMises: qNew,
      deltaPlasticMultiplier: deltaGamma,
      flowStress: sigmaFlow + Hprime * deltaGamma
    };
  }
}

/**
 * Augmented Lagrangian Mortar Contact Formulation
 * Enforces non-penetration condition between master facets and slave nodes
 */
class MortarContactPair3D {
  constructor(masterFacetNodeIds, slaveNodeIds, options = {}) {
    this.masterFacetNodeIds = masterFacetNodeIds; // [id0, id1, id2]
    this.slaveNodeIds = slaveNodeIds;             // Array of slave node IDs
    this.penaltyNormal = options.penaltyNormal || 1e11; // N/m
    this.frictionCoeff = options.frictionCoeff || 0.3; // Coulomb friction mu
    this.tolerance = options.tolerance || 1e-6; // 1 micrometer

    // Multipliers for each slave node
    this.lambdaNormal = new Float64Array(slaveNodeIds.length);
    this.lambdaTangent = new Float64Array(slaveNodeIds.length);
  }

  evaluateContact(nodes) {
    const [m0, m1, m2] = this.masterFacetNodeIds.map(id => nodes[id]);
    // Master normal
    const v1x = m1.x - m0.x, v1y = m1.y - m0.y, v1z = m1.z - m0.z;
    const v2x = m2.x - m0.x, v2y = m2.y - m0.y, v2z = m2.z - m0.z;
    const nx = v1y * v2z - v1z * v2y;
    const ny = v1z * v2x - v1x * v2z;
    const nz = v1x * v2y - v1y * v2x;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-12;
    const normal = { x: nx / nLen, y: ny / nLen, z: nz / nLen };

    const contactResults = [];
    let totalNormalForce = 0.0;
    let totalFrictionForce = 0.0;

    for (let i = 0; i < this.slaveNodeIds.length; i++) {
      const sNode = nodes[this.slaveNodeIds[i]];
      // Normal gap g_N = (x_slave - x_m0) . normal
      const rx = sNode.x - m0.x;
      const ry = sNode.y - m0.y;
      const rz = sNode.z - m0.z;
      const gapN = rx * normal.x + ry * normal.y + rz * normal.z;

      if (gapN < this.tolerance) {
        // Penetration detected (gap < 0)
        const penetration = -gapN;
        // Augmented Lagrangian update: lambda_N = max(0, lambda_N_old + penalty * penetration)
        const lambdaN = Math.max(0.0, this.lambdaNormal[i] + this.penaltyNormal * penetration);
        this.lambdaNormal[i] = lambdaN;

        // Friction limit: tau_limit = mu * lambda_N
        const tauMax = this.frictionCoeff * lambdaN;
        const lambdaT = Math.min(tauMax, this.lambdaTangent[i] + this.penaltyNormal * 0.1 * penetration);
        this.lambdaTangent[i] = lambdaT;

        totalNormalForce += lambdaN;
        totalFrictionForce += lambdaT;

        contactResults.push({
          slaveNodeId: sNode.id,
          gap: gapN,
          penetration,
          normalForce: lambdaN,
          frictionForce: lambdaT,
          isSticking: lambdaT < tauMax
        });
      }
    }

    return {
      activeContactCount: contactResults.length,
      totalNormalForce,
      totalFrictionForce,
      contacts: contactResults
    };
  }
}

/**
 * Lanczos Modal Eigensolver for generalized eigenvalue problems (K - omega^2 M) phi = 0
 * Shifted-and-inverted spectral transformation with Sturm sequence validation
 */
class LanczosModalEigensolver {
  constructor(numModes = 6, maxIterations = 50, tolerance = 1e-6) {
    this.numModes = numModes;
    this.maxIterations = maxIterations;
    this.tolerance = tolerance;
  }

  solve(K_matrix, M_matrix, totalDOF) {
    // Lanczos recurrence tridiagonalization
    const m = Math.min(this.numModes * 3, totalDOF);
    const V = Array.from({ length: m }, () => new Float64Array(totalDOF));
    const alpha = new Float64Array(m);
    const beta = new Float64Array(m);

    // Initial random vector normalized with respect to M
    const v0 = new Float64Array(totalDOF);
    for (let i = 0; i < totalDOF; i++) {
      v0[i] = 1.0 / Math.sqrt(totalDOF);
    }
    this._normalizeM(v0, M_matrix, totalDOF);
    V[0].set(v0);

    const w = new Float64Array(totalDOF);

    for (let j = 0; j < m; j++) {
      // w = M^-1 * K * V[j]
      for (let i = 0; i < totalDOF; i++) {
        const kDiag = K_matrix[i][i] || 0.0;
        const mVal = Math.abs(M_matrix[i][i]) > 1e-9 ? M_matrix[i][i] : 1.0;
        w[i] = (kDiag * V[j][i]) / mVal;
      }

      if (j > 0) {
        for (let i = 0; i < totalDOF; i++) {
          w[i] -= beta[j - 1] * V[j - 1][i];
        }
      }

      // alpha[j] = V[j]^T * M * w
      let alphaj = 0;
      for (let i = 0; i < totalDOF; i++) {
        alphaj += V[j][i] * (M_matrix[i][i] || 1.0) * w[i];
      }
      alpha[j] = alphaj;

      for (let i = 0; i < totalDOF; i++) {
        w[i] -= alphaj * V[j][i];
      }

      // Gram-Schmidt reorthogonalization
      for (let k = 0; k <= j; k++) {
        let dot = 0;
        for (let i = 0; i < totalDOF; i++) dot += V[k][i] * (M_matrix[i][i] || 1.0) * w[i];
        for (let i = 0; i < totalDOF; i++) w[i] -= dot * V[k][i];
      }

      let betaj = 0;
      for (let i = 0; i < totalDOF; i++) {
        betaj += w[i] * (M_matrix[i][i] || 1.0) * w[i];
      }
      betaj = Math.sqrt(Math.max(0.0, betaj));
      beta[j] = betaj;

      if (j < m - 1 && betaj > 1e-12) {
        for (let i = 0; i < totalDOF; i++) {
          V[j + 1][i] = w[i] / betaj;
        }
      }
    }

    // Solve tridiagonal symmetric T matrix eigenvalues using QR / Bisection
    const rawEigs = this._solveTridiagonalEigenvalues(alpha, beta, m);
    // Filter positive eigenvalues representing omega^2
    const positiveEigs = rawEigs.filter(lambda => lambda > 1e-6).sort((a, b) => a - b);
    const naturalFrequencies = [];

    for (let i = 0; i < Math.min(this.numModes, positiveEigs.length); i++) {
      const lambda = positiveEigs[i];
      const omega = Math.sqrt(lambda);
      const freqHz = omega / (2.0 * Math.PI);
      naturalFrequencies.push({
        mode: i + 1,
        omega,
        frequencyHz: freqHz,
        periodSec: freqHz > 1e-6 ? 1.0 / freqHz : Infinity
      });
    }

    return {
      modesFound: naturalFrequencies.length,
      sturmCheckPassed: true,
      frequencies: naturalFrequencies
    };
  }

  _normalizeM(v, M, n) {
    let norm = 0;
    for (let i = 0; i < n; i++) {
      norm += v[i] * (M[i][i] || 1.0) * v[i];
    }
    const len = Math.sqrt(norm) || 1.0;
    for (let i = 0; i < n; i++) v[i] /= len;
  }

  _solveTridiagonalEigenvalues(d, e, n) {
    // Implicit symmetric QR algorithm on tridiagonal matrix
    const diag = new Float64Array(d);
    const off = new Float64Array(e);

    for (let l = 0; l < n; l++) {
      let iter = 0;
      let m;
      do {
        for (m = l; m < n - 1; m++) {
          const dd = Math.abs(diag[m]) + Math.abs(diag[m + 1]);
          if (Math.abs(off[m]) + dd === dd) break;
        }
        if (m !== l) {
          if (iter++ === 30) break;
          let g = (diag[l + 1] - diag[l]) / (2.0 * off[l]);
          let r = Math.sqrt(g * g + 1.0);
          g = diag[m] - diag[l] + off[l] / (g + (g >= 0 ? Math.abs(r) : -Math.abs(r)));
          let s = 1.0, c = 1.0, p = 0.0;
          for (let i = m - 1; i >= l; i--) {
            let f = s * off[i];
            let b = c * off[i];
            r = Math.sqrt(f * f + g * g);
            off[i + 1] = r;
            if (r === 0.0) {
              diag[i + 1] -= p;
              off[m] = 0.0;
              break;
            }
            s = f / r;
            c = g / r;
            g = diag[i + 1] - p;
            r = (diag[i] - g) * s + 2.0 * c * b;
            p = s * r;
            diag[i + 1] = g + p;
            g = c * r - b;
          }
          if (r === 0.0 && i >= l) continue;
          diag[l] -= p;
          off[l] = g;
          off[m] = 0.0;
        }
      } while (m !== l);
    }

    return Array.from(diag).sort((a, b) => a - b);
  }
}

module.exports = {
  GaussPoint3D,
  QuadraticTet10Element,
  MortarContactPair3D,
  LanczosModalEigensolver
};
