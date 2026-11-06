/**
 * 3D linear-elastic patch test on an irregular HEX20 mesh.
 *
 * A uniform constant-strain field is imposed through prescribed boundary
 * displacements on an affine-mapped (node-perturbed) mesh. The production
 * FEASolver + ElementHEX20 path must reproduce the exact constant stress
 * field to within the iterative-solver tolerance.
 *
 * Reference: independent isotropic Hooke's-law evaluation of the imposed
 * strain tensor (not computed by the production element code).
 */

'use strict';

const { FEASolver } = require('../../../src/core/cae/fea_structural');
const { populateSolver } = require('../references/fem_helpers');

const E = 200e9;
const NU = 0.3;
const G = E / (2 * (1 + NU));

function seededRandom32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function independentStress3D(eps, E, nu) {
  const f = E / ((1 + nu) * (1 - 2 * nu));
  return {
    sxx: f * ((1 - nu) * eps.exx + nu * (eps.eyy + eps.ezz)),
    syy: f * ((1 - nu) * eps.eyy + nu * (eps.ezz + eps.exx)),
    szz: f * ((1 - nu) * eps.ezz + nu * (eps.exx + eps.eyy)),
    sxy: G * eps.exy,
    syz: G * eps.eyz,
    sxz: G * eps.exz
  };
}

function buildIrregularCubeHex20(nx, ny, nz, seed) {
  const rand = seededRandom32(seed);
  const corners = new Map();
  const key = (i, j, k) => `${i}:${j}:${k}`;
  const isBoundaryCorner = (i, j, k) => i === 0 || i === nx || j === 0 || j === ny || k === 0 || k === nz;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      for (let k = 0; k <= nz; k++) {
        let x = i / nx;
        let y = j / ny;
        let z = k / nz;
        if (!isBoundaryCorner(i, j, k)) {
          x += (rand() - 0.5) * 0.14;
          y += (rand() - 0.5) * 0.14;
          z += (rand() - 0.5) * 0.14;
        }
        corners.set(key(i, j, k), { x, y, z });
      }
    }
  }
  const nodes = [];
  const nodeIds = new Map();
  const node = (type, i, j, k) => {
    const k0 = `${type}:${i}:${j}:${k}`;
    if (nodeIds.has(k0)) return nodeIds.get(k0);
    let p;
    if (type === 'C') {
      p = corners.get(key(i, j, k));
    } else if (type === 'X') {
      const a = corners.get(key(i, j, k));
      const b = corners.get(key(i + 1, j, k));
      p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    } else if (type === 'Y') {
      const a = corners.get(key(i, j, k));
      const b = corners.get(key(i, j + 1, k));
      p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    } else {
      const a = corners.get(key(i, j, k));
      const b = corners.get(key(i, j, k + 1));
      p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    }
    const id = nodes.length;
    nodes.push(p);
    nodeIds.set(k0, id);
    return id;
  };
  const elements = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        elements.push([
          node('C', i, j, k),
          node('C', i + 1, j, k),
          node('C', i + 1, j + 1, k),
          node('C', i, j + 1, k),
          node('C', i, j, k + 1),
          node('C', i + 1, j, k + 1),
          node('C', i + 1, j + 1, k + 1),
          node('C', i, j + 1, k + 1),
          node('X', i, j, k),
          node('Y', i + 1, j, k),
          node('X', i, j + 1, k),
          node('Y', i, j, k),
          node('X', i, j, k + 1),
          node('Y', i + 1, j, k + 1),
          node('X', i, j + 1, k + 1),
          node('Y', i, j, k + 1),
          node('Z', i, j, k),
          node('Z', i + 1, j, k),
          node('Z', i + 1, j + 1, k),
          node('Z', i, j + 1, k)
        ]);
      }
    }
  }
  return { nodes, elements };
}

function failedElasticityPatchResult(reason, eps) {
  return {
    id: 'ELASTICITY_PATCH_HEX20',
    name: '3D constant-strain patch test on an irregular HEX20 mesh (production FEASolver)',
    targetValue: 1e-3,
    calculatedValue: null,
    units: 'max relative stress error',
    errorPercent: null,
    tolerancePercent: 0.1,
    passed: false,
    status: 'failed',
    reason,
    measured: {
      maxRelativeStressError: null,
      peakStressMpa: null,
      elementCount: null,
      dofCount: null,
      solverUsed: null
    },
    expected: {
      strainTensor: eps,
      stressTensorMpa: null
    },
    details: {
      reference: 'Independent isotropic Hooke law evaluation of the imposed constant strain tensor (analytic).',
      solver:
        'FEASolver HEX20 (production), affine-mapped irregular mesh; constant-strain field is in the element space.',
      mesh: {
        nx: 3,
        ny: 3,
        nz: 3,
        perturb: 'interior corners only',
        nodes: null,
        elements: null
      },
      note: 'Patch verification of element/solver consistency only; not certification.'
    }
  };
}

function runElasticityPatch() {
  const mesh = buildIrregularCubeHex20(3, 3, 3, 0xc0ffee);
  const eps = { exx: 1e-3, eyy: -2e-4, ezz: 5e-4, exy: 3e-4, eyz: -1e-4, exz: 2e-4 };
  const solver = new FEASolver();
  populateSolver(solver, mesh, { E, nu: NU, yieldStress: 1e9 });
  const isBoundary = (n) => {
    const x = Math.min(n.x, 1 - n.x);
    const y = Math.min(n.y, 1 - n.y);
    const z = Math.min(n.z, 1 - n.z);
    return x < 1e-12 || y < 1e-12 || z < 1e-12;
  };
  for (let i = 0; i < solver.nodes.length; i++) {
    const n = solver.nodes[i];
    if (!isBoundary(n)) continue;
    const ux = eps.exx * n.x + 0.5 * eps.exy * n.y + 0.5 * eps.exz * n.z;
    const uy = 0.5 * eps.exy * n.x + eps.eyy * n.y + 0.5 * eps.eyz * n.z;
    const uz = 0.5 * eps.exz * n.x + 0.5 * eps.eyz * n.y + eps.ezz * n.z;
    solver.fixNode(i, true, true, true, [ux, uy, uz]);
  }
  let solveResult;
  try {
    solveResult = solver.solveStatic();
  } catch (err) {
    return failedElasticityPatchResult(`Elasticity patch solve failed: ${err.message}`, eps);
  }
  if (!solveResult || typeof solveResult !== 'object') {
    return failedElasticityPatchResult('Elasticity patch solve returned no result object.', eps);
  }
  const target = independentStress3D(eps, E, NU);
  let maxRelErr = 0;
  const components = ['sxx', 'syy', 'szz', 'sxy', 'syz', 'sxz'];
  for (const el of solver.elements) {
    for (const c of components) {
      const rel = Math.abs(el.stress[c] - target[c]) / Math.abs(target[c]);
      if (rel > maxRelErr) maxRelErr = rel;
    }
  }
  const tolerance = 1e-3;
  const passed = Number.isFinite(maxRelErr) && maxRelErr <= tolerance;
  return {
    id: 'ELASTICITY_PATCH_HEX20',
    name: '3D constant-strain patch test on an irregular HEX20 mesh (production FEASolver)',
    targetValue: tolerance,
    calculatedValue: maxRelErr,
    units: 'max relative stress error',
    errorPercent: maxRelErr * 100,
    tolerancePercent: tolerance * 100,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed ? undefined : 'Patch-test stress deviation exceeds the declared 0.1% tolerance.',
    measured: {
      maxRelativeStressError: maxRelErr,
      peakStressMpa:
        Math.max(...solver.elements.map((el) => Math.max(el.stress.sxx, el.stress.syy, el.stress.szz))) / 1e6,
      elementCount: solver.elements.length,
      dofCount: solver.nodes.length * 3,
      solverUsed: solveResult.solverUsed
    },
    expected: {
      strainTensor: eps,
      stressTensorMpa: { sxx: target.sxx / 1e6, syy: target.syy / 1e6, szz: target.szz / 1e6 }
    },
    details: {
      reference: 'Independent isotropic Hooke law evaluation of the imposed constant strain tensor (analytic).',
      solver:
        'FEASolver HEX20 (production), affine-mapped irregular mesh; constant-strain field is in the element space.',
      mesh: {
        nx: 3,
        ny: 3,
        nz: 3,
        perturb: 'interior corners only',
        nodes: solver.nodes.length,
        elements: solver.elements.length
      },
      note: 'Patch verification of element/solver consistency only; not certification.'
    }
  };
}

module.exports = { runElasticityPatch };
