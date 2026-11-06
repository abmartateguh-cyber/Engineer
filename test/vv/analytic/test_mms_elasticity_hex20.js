/**
 * Manufactured quadratic elasticity solution with body-force loading.
 *
 * A pure-quadratic displacement field (u = a*x^2, v = b*y^2, w = c*z^2) is
 * a member of the HEX20 serendipity space and equilibrates under constant
 * body forces derived independently from equilibrium div(sigma)+f = 0. The
 * body forces are applied as consistent nodal loads through the production
 * FEASolver; all boundary degrees of freedom are prescribed to the exact
 * field. Displacements and recovered element stresses are compared with the
 * manufactured solution. Mesh is rectilinear (affine mapping), so the check
 * isolates solver assembly/load-path correctness.
 */

'use strict';

const { FEASolver } = require('../../../src/core/cae/fea_structural');

const E = 200e9;
const NU = 0.3;
const L = 1.0;
const NX = 3;
const NY = 3;
const NZ = 3;
const AL = 1e-4;
const BE = -6e-5;
const GA = 4e-5;
const TOLERANCE = 1e-3;

const HEX20_NAT = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
  [0, -1, -1],
  [1, 0, -1],
  [0, 1, -1],
  [-1, 0, -1],
  [0, -1, 1],
  [1, 0, 1],
  [0, 1, 1],
  [-1, 0, 1],
  [-1, -1, 0],
  [1, -1, 0],
  [1, 1, 0],
  [-1, 1, 0]
];

function hex20ShapeValues(xi, eta, zeta) {
  const N = new Array(20);
  for (let i = 0; i < 20; i++) {
    const [a, b, c] = HEX20_NAT[i];
    if (a === 0) {
      N[i] = 0.25 * (1 - xi * xi) * (1 + eta * b) * (1 + zeta * c);
    } else if (b === 0) {
      N[i] = 0.25 * (1 + xi * a) * (1 - eta * eta) * (1 + zeta * c);
    } else if (c === 0) {
      N[i] = 0.25 * (1 + xi * a) * (1 + eta * b) * (1 - zeta * zeta);
    } else {
      N[i] = 0.125 * (1 + xi * a) * (1 + eta * b) * (1 + zeta * c) * (xi * a + eta * b + zeta * c - 2);
    }
  }
  return N;
}

function buildMesh() {
  const nodes = [];
  const ids = new Map();
  const node = (type, i, j, k, x, y, z) => {
    const key = `${type}:${i}:${j}:${k}`;
    if (ids.has(key)) return ids.get(key);
    const id = nodes.length;
    nodes.push({ x, y, z });
    ids.set(key, id);
    return id;
  };
  for (let i = 0; i <= NX; i++) {
    for (let j = 0; j <= NY; j++) {
      for (let k = 0; k <= NZ; k++) {
        node('C', i, j, k, (L * i) / NX, (L * j) / NY, (L * k) / NZ);
      }
    }
  }
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j <= NY; j++) {
      for (let k = 0; k <= NZ; k++) {
        node('X', i, j, k, (L * (i + 0.5)) / NX, (L * j) / NY, (L * k) / NZ);
      }
    }
  }
  for (let i = 0; i <= NX; i++) {
    for (let j = 0; j < NY; j++) {
      for (let k = 0; k <= NZ; k++) {
        node('Y', i, j, k, (L * i) / NX, (L * (j + 0.5)) / NY, (L * k) / NZ);
      }
    }
  }
  for (let i = 0; i <= NX; i++) {
    for (let j = 0; j <= NY; j++) {
      for (let k = 0; k < NZ; k++) {
        node('Z', i, j, k, (L * i) / NX, (L * j) / NY, (L * (k + 0.5)) / NZ);
      }
    }
  }
  const elements = [];
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NY; j++) {
      for (let k = 0; k < NZ; k++) {
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

function runMmsElasticityHex20() {
  const f = E / ((1 + NU) * (1 - 2 * NU));
  const uM = (x) => AL * x * x;
  const vM = (y) => BE * y * y;
  const wM = (z) => GA * z * z;
  const fx = -2 * AL * f * (1 - NU);
  const fy = -2 * BE * f * (1 - NU);
  const fz = -2 * GA * f * (1 - NU);

  const mesh = buildMesh();
  const solver = new FEASolver();
  for (const n of mesh.nodes) solver.addNode(n.x, n.y, n.z);
  for (const e of mesh.elements) solver.addElement(e, { E, nu: NU, yieldStress: 1e9 });

  const boundary = new Set();
  for (let nid = 0; nid < mesh.nodes.length; nid++) {
    const n = mesh.nodes[nid];
    if (Math.min(n.x, L - n.x) < 1e-12 || Math.min(n.y, L - n.y) < 1e-12 || Math.min(n.z, L - n.z) < 1e-12) {
      boundary.add(nid);
    }
  }

  const gp = 1 / Math.sqrt(3);
  const gauss = [-gp, gp];
  const loads = new Float64Array(mesh.nodes.length * 3);
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NY; j++) {
      for (let k = 0; k < NZ; k++) {
        const elIds = mesh.elements[i * NY * NZ + j * NZ + k];
        const detJ = ((L / NX) * (L / NY) * (L / NZ)) / 8;
        for (const gx of gauss) {
          for (const gy of gauss) {
            for (const gz of gauss) {
              const N = hex20ShapeValues(gx, gy, gz);
              for (let q = 0; q < 20; q++) {
                const nid = elIds[q];
                if (boundary.has(nid)) continue;
                loads[nid * 3] += N[q] * fx * detJ;
                loads[nid * 3 + 1] += N[q] * fy * detJ;
                loads[nid * 3 + 2] += N[q] * fz * detJ;
              }
            }
          }
        }
      }
    }
  }
  for (let nid = 0; nid < mesh.nodes.length; nid++) {
    if (boundary.has(nid)) continue;
    solver.applyForce(nid, loads[nid * 3], loads[nid * 3 + 1], loads[nid * 3 + 2]);
  }
  for (const nid of boundary) {
    const n = mesh.nodes[nid];
    solver.fixNode(nid, true, true, true, [uM(n.x), vM(n.y), wM(n.z)]);
  }

  solver.solveStatic();

  let maxDispRel = 0;
  for (let nid = 0; nid < mesh.nodes.length; nid++) {
    const n = mesh.nodes[nid];
    const d = solver.nodes[nid].displacement;
    const scale = Math.max(Math.abs(uM(n.x)), Math.abs(vM(n.y)), Math.abs(wM(n.z)), 1e-12);
    const rel = Math.max(Math.abs(d[0] - uM(n.x)), Math.abs(d[1] - vM(n.y)), Math.abs(d[2] - wM(n.z))) / scale;
    maxDispRel = Math.max(maxDispRel, rel);
  }

  const sigmaChar = f * (1 - NU) * 2 * Math.max(Math.abs(AL), Math.abs(BE), Math.abs(GA)) * L;
  let maxStressRel = 0;
  let sumStressRel = 0;
  for (const el of solver.elements) {
    const xs = el.nodeIds.map((id) => solver.nodes[id]);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < 20; i++) {
      const w = i < 8 ? -0.25 : 0.25;
      cx += w * xs[i].x;
      cy += w * xs[i].y;
      cz += w * xs[i].z;
    }
    const exx = 2 * AL * cx;
    const eyy = 2 * BE * cy;
    const ezz = 2 * GA * cz;
    const sxx = f * ((1 - NU) * exx + NU * (eyy + ezz));
    const syy = f * ((1 - NU) * eyy + NU * (ezz + exx));
    const szz = f * ((1 - NU) * ezz + NU * (exx + eyy));
    const s = el.stress;
    const absErr = Math.max(
      Math.abs(s.sxx - sxx),
      Math.abs(s.syy - syy),
      Math.abs(s.szz - szz),
      Math.abs(s.sxy),
      Math.abs(s.syz),
      Math.abs(s.sxz)
    );
    const rel = absErr / sigmaChar;
    maxStressRel = Math.max(maxStressRel, rel);
    sumStressRel += rel;
  }
  const meanStressRel = sumStressRel / Math.max(1, solver.elements.length);

  const passed =
    Number.isFinite(maxDispRel) &&
    maxDispRel <= TOLERANCE &&
    Number.isFinite(maxStressRel) &&
    maxStressRel <= TOLERANCE;
  const maxError = Math.max(maxDispRel, maxStressRel);

  return {
    id: 'MMS_ELASTICITY_HEX20_BODYFORCE',
    name: 'Manufactured quadratic elasticity solution with constant body forces (production HEX20 FEA)',
    targetValue: TOLERANCE,
    calculatedValue: maxError,
    units: 'max relative error (displacement / characteristic stress)',
    errorPercent: maxError * 100,
    tolerancePercent: TOLERANCE * 100,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed ? undefined : 'Manufactured elasticity solution is not reproduced within tolerance.',
    measured: {
      maxDisplacementRelativeError: maxDispRel,
      maxStressRelativeError: maxStressRel,
      meanStressRelativeError: meanStressRel,
      characteristicStressMpa: sigmaChar / 1e6,
      solverUsed: solver.results.solverUsed,
      dofCount: solver.nodes.length * 3,
      elementCount: solver.elements.length
    },
    expected: {
      manufacturedDisplacement: 'u = a x^2, v = b y^2, w = c z^2',
      bodyForceNPerM3: { fx, fy, fz }
    },
    details: {
      reference: 'Manufactured solution; body forces derived independently from equilibrium div(sigma)+f=0 (analytic).',
      solver: 'FEASolver HEX20 (production) with consistent body-force nodal loads and exact Dirichlet boundary data.',
      mesh: { nx: NX, ny: NY, nz: NZ, affine: true },
      note: 'Quadratic field is a member of the HEX20 space on affine meshes; check isolates assembly and load path. Not certification.'
    }
  };
}

module.exports = { runMmsElasticityHex20 };
