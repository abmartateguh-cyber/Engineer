'use strict';

/**
 * OmniEng 3D small-strain J2 (von Mises) elastoplasticity with:
 *   - radial-return (backward-Euler closest-point projection) stress update,
 *   - Voce and/or linear isotropic hardening,
 *   - Chaboche kinematic hardening with M >= 1 backstresses,
 *   - algorithmic consistent tangent modulus dSigma/dEps.
 *
 * Conventions: strain and stress Voigt order is [xx, yy, zz, xy, yz, zx].
 * Strains are passed in engineering shear form (gamma_xy = 2*e_xy) by the
 * public API; internally all shear components are stored as tensor shear.
 * Plastic strain is deviatoric (traceless) by construction, so J2 flow
 * produces no volumetric plastic strain.
 */

const METRIC = [1, 1, 1, 2, 2, 2];

function dot(u, v) {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2] +
    2.0 * (u[3] * v[3] + u[4] * v[4] + u[5] * v[5]);
}

function norm(u) {
  return Math.sqrt(dot(u, u));
}

function deviatoric(e) {
  const m = (e[0] + e[1] + e[2]) / 3.0;
  return [e[0] - m, e[1] - m, e[2] - m, e[3], e[4], e[5]];
}

function validateMaterial(material) {
  if (!material || typeof material !== 'object') {
    throw new TypeError('J2 plasticity material object is required.');
  }
  const { E, nu, yieldStress, hardeningModulus, voce, kinematic } = material;
  if (![E, nu, yieldStress].every(Number.isFinite) || E <= 0 || nu <= -1 || nu >= 0.5 || yieldStress <= 0) {
    throw new RangeError('Require finite E > 0, -1 < nu < 0.5, yieldStress > 0.');
  }
  if (hardeningModulus !== undefined && (!Number.isFinite(hardeningModulus) || hardeningModulus < 0)) {
    throw new RangeError('hardeningModulus must be >= 0.');
  }
  if (voce !== undefined) {
    const { Rinf, b } = voce;
    if (!Number.isFinite(Rinf) || !Number.isFinite(b) || Rinf < 0 || b <= 0) {
      throw new RangeError('Voce hardening requires Rinf >= 0 and b > 0.');
    }
  }
  if (kinematic !== undefined) {
    if (!Array.isArray(kinematic)) {
      throw new TypeError('kinematic hardening must be an array of {C, gamma}.');
    }
    for (const k of kinematic) {
      if (!k || !Number.isFinite(k.C) || !Number.isFinite(k.gamma) || k.C <= 0 || k.gamma < 0) {
        throw new RangeError('Each backstress requires C > 0 and gamma >= 0.');
      }
    }
  }
  return material;
}

function yieldStress(material, p) {
  let sy = material.yieldStress + (material.hardeningModulus || 0) * p;
  if (material.voce) {
    sy += material.voce.Rinf * (1.0 - Math.exp(-material.voce.b * p));
  }
  return sy;
}

function yieldSlope(material, p) {
  let h = material.hardeningModulus || 0;
  if (material.voce) {
    h += material.voce.Rinf * material.voce.b * Math.exp(-material.voce.b * p);
  }
  return h;
}

function makeState(material) {
  validateMaterial(material);
  const nBack = material.kinematic ? material.kinematic.length : 0;
  const backstresses = [];
  for (let i = 0; i < nBack; i++) {
    backstresses.push([0, 0, 0, 0, 0, 0]);
  }
  return {
    strain: [0, 0, 0, 0, 0, 0],
    plasticStrain: [0, 0, 0, 0, 0, 0],
    backstresses,
    equivPlasticStrain: 0.0
  };
}

function cloneState(state) {
  const backstresses = state.backstresses.map(a => a.slice());
  return {
    strain: state.strain.slice(),
    plasticStrain: state.plasticStrain.slice(),
    backstresses,
    equivPlasticStrain: state.equivPlasticStrain
  };
}

function BSum(backs, gammaList, dg) {
  const s = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < backs.length; i++) {
    const denom = 1.0 + gammaList[i] * dg;
    for (let j = 0; j < 6; j++) {
      s[j] += gammaList[i] * backs[i][j] / denom;
    }
  }
  return s;
}

function BPrimeSum(backs, gammaList, dg) {
  const s = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < backs.length; i++) {
    const g = gammaList[i];
    const denom = 1.0 + g * dg;
    const c = -g * g / (denom * denom);
    for (let j = 0; j < 6; j++) {
      s[j] += c * backs[i][j];
    }
  }
  return s;
}

function HcValue(G, CList, gammaList, dg) {
  let h = 2.0 * G;
  for (let i = 0; i < CList.length; i++) {
    h += (2.0 / 3.0) * CList[i] / (1.0 + gammaList[i] * dg);
  }
  return h;
}

function HcPrime(CList, gammaList, dg) {
  let h = 0.0;
  for (let i = 0; i < CList.length; i++) {
    const g = gammaList[i];
    h -= (2.0 / 3.0) * CList[i] * g / (1.0 + g * dg) ** 2;
  }
  return h;
}

function qOf(material, G, xi, backs, CList, gammaList, p, dg) {
  const B = BSum(backs, gammaList, dg);
  const A = [
    xi[0] + dg * B[0],
    xi[1] + dg * B[1],
    xi[2] + dg * B[2],
    xi[3] + dg * B[3],
    xi[4] + dg * B[4],
    xi[5] + dg * B[5]
  ];
  const q = Math.sqrt(1.5) * norm(A) - 1.5 * dg * HcValue(G, CList, gammaList, dg);
  return { q, A };
}

function solvePlasticMultiplier(material, G, xi, backs, p) {
  const M = backs.length;
  const CList = material.kinematic.map(k => k.C);
  const gammaList = material.kinematic.map(k => k.gamma);
  const sy0 = yieldStress(material, p);
  const qTrial = Math.sqrt(1.5) * norm(xi);
  const gFunc = dg => qOf(material, G, xi, backs, CList, gammaList, p, dg).q - yieldStress(material, p + dg);
  let hi = Math.max(1e-12, (qTrial - sy0) / (3.0 * G + yieldSlope(material, p) + 1e-12));
  let guard = 0;
  while (gFunc(hi) > 0 && guard < 80) {
    hi *= 2.0;
    guard++;
  }
  if (gFunc(hi) > 0) {
    throw new Error('Plastic multiplier bracket failed: hardening too weak for the trial step.');
  }
  let lo = 0.0;
  for (let it = 0; it < 80; it++) {
    const mid = 0.5 * (lo + hi);
    if (gFunc(mid) > 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  let dg = 0.5 * (lo + hi);
  for (let it = 0; it < 12; it++) {
    const A0 = qOf(material, G, xi, backs, CList, gammaList, p, dg);
    const normA0 = norm(A0.A);
    const nA = A0.A.map(v => v / normA0);
    const B = BSum(backs, gammaList, dg);
    const Bp = BPrimeSum(backs, gammaList, dg);
    const D = B.map((v, j) => v + dg * Bp[j]);
    const dq = Math.sqrt(1.5) * dot(nA, D) - 1.5 * (HcValue(G, CList, gammaList, dg) + dg * HcPrime(CList, gammaList, dg));
    const dgDeriv = dq - yieldSlope(material, p + dg);
    const gVal = gFunc(dg);
    const step = gVal / dgDeriv;
    if (!Number.isFinite(step)) {
      break;
    }
    const next = dg - step;
    if (next <= lo || next >= hi) {
      break;
    }
    dg = next;
    if (Math.abs(step) < 1e-14 * Math.max(1.0, dg)) {
      break;
    }
  }
  return dg;
}

function elasticTangent(E, nu) {
  const G = E / (2.0 * (1.0 + nu));
  const K = E / (3.0 * (1.0 - 2.0 * nu));
  const T = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      T[i][j] = K + 2.0 * G * (i === j ? 1.0 : 0.0) - 2.0 * G / 3.0;
    }
  }
  for (let i = 3; i < 6; i++) {
    T[i][i] = G;
  }
  return T;
}

function integrate(material, state, deltaStrainEng) {
  validateMaterial(material);
  if (!state || !Array.isArray(deltaStrainEng) || deltaStrainEng.length !== 6 || !deltaStrainEng.every(Number.isFinite)) {
    throw new TypeError('Provide a valid state and six finite engineering strain increments.');
  }
  const E = material.E;
  const nu = material.nu;
  const G = E / (2.0 * (1.0 + nu));
  const K = E / (3.0 * (1.0 - 2.0 * nu));

  const de = [
    deltaStrainEng[0],
    deltaStrainEng[1],
    deltaStrainEng[2],
    0.5 * deltaStrainEng[3],
    0.5 * deltaStrainEng[4],
    0.5 * deltaStrainEng[5]
  ];
  const eOld = state.strain;
  const eTot = [
    eOld[0] + de[0],
    eOld[1] + de[1],
    eOld[2] + de[2],
    eOld[3] + de[3],
    eOld[4] + de[4],
    eOld[5] + de[5]
  ];
  const epOld = state.plasticStrain;
  const eElastTrial = [
    eTot[0] - epOld[0],
    eTot[1] - epOld[1],
    eTot[2] - epOld[2],
    eTot[3] - epOld[3],
    eTot[4] - epOld[4],
    eTot[5] - epOld[5]
  ];
  const devE = deviatoric(eElastTrial);
  const sTrial = devE.map(v => 2.0 * G * v);
  const trE = eTot[0] + eTot[1] + eTot[2];
  const pTrial = K * trE;

  let alphaSum = [0, 0, 0, 0, 0, 0];
  if (state.backstresses.length) {
    for (const a of state.backstresses) {
      for (let j = 0; j < 6; j++) {
        alphaSum[j] += a[j];
      }
    }
  }
  const xi = sTrial.map((v, j) => v - alphaSum[j]);
  const qTrial = Math.sqrt(1.5) * norm(xi);
  const pOld = state.equivPlasticStrain;
  const syCurrent = yieldStress(material, pOld);

  const next = cloneState(state);
  next.strain = eTot;

  if (qTrial <= syCurrent * (1.0 + 1e-12)) {
    const stress = [
      sTrial[0] + pTrial,
      sTrial[1] + pTrial,
      sTrial[2] + pTrial,
      sTrial[3],
      sTrial[4],
      sTrial[5]
    ];
    return {
      stress,
      state: next,
      isPlastic: false,
      deltaPlasticMultiplier: 0.0,
      vonMises: qTrial,
      yieldStress: syCurrent
    };
  }

  const dg = solvePlasticMultiplier(material, G, xi, state.backstresses, pOld);
  const B = BSum(state.backstresses, material.kinematic.map(k => k.gamma), dg);
  const A = xi.map((v, j) => v + dg * B[j]);
  const normA = norm(A);
  const nA = A.map(v => v / normA);
  const n = nA.map(v => Math.sqrt(1.5) * v);

  const sNew = sTrial.map((v, j) => v - 2.0 * G * dg * n[j]);
  const stress = [
    sNew[0] + pTrial,
    sNew[1] + pTrial,
    sNew[2] + pTrial,
    sNew[3],
    sNew[4],
    sNew[5]
  ];

  for (let j = 0; j < 6; j++) {
    next.plasticStrain[j] += dg * n[j];
  }
  next.equivPlasticStrain = pOld + dg;
  for (let i = 0; i < state.backstresses.length; i++) {
    const C = material.kinematic[i].C;
    const gamma = material.kinematic[i].gamma;
    const denom = 1.0 + gamma * dg;
    for (let j = 0; j < 6; j++) {
      next.backstresses[i][j] = (state.backstresses[i][j] + (2.0 / 3.0) * C * dg * n[j]) / denom;
    }
  }

  const syNext = yieldStress(material, next.equivPlasticStrain);
  return {
    stress,
    state: next,
    isPlastic: true,
    deltaPlasticMultiplier: dg,
    vonMises: syNext,
    yieldStress: syNext
  };
}

function algorithmicTangent(material, state, deltaStrainEng) {
  validateMaterial(material);
  if (!state || !Array.isArray(deltaStrainEng) || deltaStrainEng.length !== 6 || !deltaStrainEng.every(Number.isFinite)) {
    throw new TypeError('Provide a valid state and six finite engineering strain increments.');
  }
  const E = material.E;
  const nu = material.nu;
  const G = E / (2.0 * (1.0 + nu));
  const K = E / (3.0 * (1.0 - 2.0 * nu));

  const de = [
    deltaStrainEng[0],
    deltaStrainEng[1],
    deltaStrainEng[2],
    0.5 * deltaStrainEng[3],
    0.5 * deltaStrainEng[4],
    0.5 * deltaStrainEng[5]
  ];
  const eOld = state.strain;
  const eTot = [
    eOld[0] + de[0],
    eOld[1] + de[1],
    eOld[2] + de[2],
    eOld[3] + de[3],
    eOld[4] + de[4],
    eOld[5] + de[5]
  ];
  const epOld = state.plasticStrain;
  const eElastTrial = [
    eTot[0] - epOld[0],
    eTot[1] - epOld[1],
    eTot[2] - epOld[2],
    eTot[3] - epOld[3],
    eTot[4] - epOld[4],
    eTot[5] - epOld[5]
  ];
  const devE = deviatoric(eElastTrial);
  const sTrial = devE.map(v => 2.0 * G * v);
  const trE = eTot[0] + eTot[1] + eTot[2];
  const pTrial = K * trE;

  let alphaSum = [0, 0, 0, 0, 0, 0];
  if (state.backstresses.length) {
    for (const a of state.backstresses) {
      for (let j = 0; j < 6; j++) {
        alphaSum[j] += a[j];
      }
    }
  }
  const xi = sTrial.map((v, j) => v - alphaSum[j]);
  const qTrial = Math.sqrt(1.5) * norm(xi);
  const pOld = state.equivPlasticStrain;
  const syCurrent = yieldStress(material, pOld);

  const Dev = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      Dev[i][j] = (i === j ? 1.0 : 0.0) - 1.0 / 3.0;
    }
  }
  for (let i = 3; i < 6; i++) {
    Dev[i][i] = 1.0;
  }
  const J = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      J[i][j] = 1.0;
    }
  }
  const T = elasticTangent(E, nu);

  if (qTrial <= syCurrent * (1.0 + 1e-12)) {
    return T;
  }

  const dg = solvePlasticMultiplier(material, G, xi, state.backstresses, pOld);
  const B = BSum(state.backstresses, material.kinematic.map(k => k.gamma), dg);
  const Bp = BPrimeSum(state.backstresses, material.kinematic.map(k => k.gamma), dg);
  const D = B.map((v, j) => v + dg * Bp[j]);
  const A = xi.map((v, j) => v + dg * B[j]);
  const normA = norm(A);
  const nA = A.map(v => v / normA);
  const n = nA.map(v => Math.sqrt(1.5) * v);
  const Cn = [nA[0], nA[1], nA[2], 2.0 * nA[3], 2.0 * nA[4], 2.0 * nA[5]];

  const Hc = HcValue(G, material.kinematic.map(k => k.C), material.kinematic.map(k => k.gamma), dg);
  const Hcp = HcPrime(material.kinematic.map(k => k.C), material.kinematic.map(k => k.gamma), dg);
  const dq = Math.sqrt(1.5) * dot(nA, D) - 1.5 * (Hc + dg * Hcp);
  const kDeriv = dq - yieldSlope(material, pOld + dg);
  const m = Cn.map(v => -2.0 * G * Math.sqrt(1.5) * v / kDeriv);

  const P = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      P[i][j] = ((i === j ? 1.0 : 0.0) - nA[i] * METRIC[j] * nA[j]) / normA;
    }
  }
  const M1 = Dev.map(row => row.map((v, j) => 2.0 * G * v));
  const M2 = Array.from({ length: 6 }, (_, i) => D.map((v, j) => D[i] * m[j]));
  const dndeps = Array.from({ length: 6 }, (_, i) => new Array(6).fill(0));
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      let s = 0.0;
      for (let k = 0; k < 6; k++) {
        s += P[i][k] * (M1[k][j] + M2[k][j]);
      }
      dndeps[i][j] = s;
    }
  }
  const Sinv = [1, 1, 1, 0.5, 0.5, 0.5];
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      T[i][j] -= 2.0 * G * (n[i] * m[j] + dg * Math.sqrt(1.5) * dndeps[i][j]) * Sinv[j];
    }
  }
  return T;
}

module.exports = {
  J2PlasticityModel: {
    makeState,
    integrate,
    algorithmicTangent,
    elasticTangent
  },
  yieldStress,
  validateMaterial
};
