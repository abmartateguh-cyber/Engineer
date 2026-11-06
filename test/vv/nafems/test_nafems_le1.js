/**
 * NAFEMS LE1: 2D plane-stress quarter-ellipse annular membrane benchmark.
 *
 * Official NAFEMS LE1 Problem Specification:
 * - Quarter annular membrane between inner ellipse (a1 = 2000 mm, b1 = 1000 mm)
 *   and outer ellipse (a2 = 3250 mm, b2 = 2750 mm).
 * - Thickness t = 100 mm (0.1 m).
 * - Material: E = 210 GPa, nu = 0.3.
 * - Boundary conditions:
 *     * Symmetry on x = 0 cut plane: u = 0.
 *     * Symmetry on y = 0 cut plane: v = 0.
 *     * Uniform outward normal pressure P = 10 MPa (10e6 Pa) on outer ellipse.
 * - Point D at inner ellipse apex on horizontal symmetry axis: (2.0 m, 0.0 m).
 * - Declared target: sigma_y(D) = 92.7 MPa (+-3.5% tolerance).
 *
 * Solver: PlaneStressQ8 (8-node quadratic serendipity quadrilateral).
 */

'use strict';

const { PlaneStressQ8, q8Shape } = require('../../../src/core/cae/fe2d_q8_plane_stress');

const E = 210e9;
const NU = 0.3;
const A1 = 2.0;
const B1 = 1.0;
const A2 = 3.25;
const B2 = 2.75;
const T = 0.1;
const P = 10e6;
const TARGET_SY = 92.7e6;
const TOLERANCE_PERCENT = 3.5;

function innerPoint(theta) {
  return [A1 * Math.cos(theta), B1 * Math.sin(theta)];
}

function outerPoint(theta) {
  return [A2 * Math.cos(theta), B2 * Math.sin(theta)];
}

function pointAt(s, theta) {
  const inP = innerPoint(theta);
  const outP = outerPoint(theta);
  return [inP[0] + s * (outP[0] - inP[0]), inP[1] + s * (outP[1] - inP[1])];
}

function buildMesh(nr, nt) {
  const nodes = [];
  const nodeIds = new Map();
  const key = (type, i, j) => `${type}:${i}:${j}`;
  const node = (type, i, j, x, y) => {
    const k0 = key(type, i, j);
    if (nodeIds.has(k0)) return nodeIds.get(k0);
    const id = nodes.length;
    nodes.push({ x, y });
    nodeIds.set(k0, id);
    return id;
  };

  for (let i = 0; i <= nr; i++) {
    for (let j = 0; j <= nt; j++) {
      const p = pointAt(i / nr, (j * Math.PI) / 2 / nt);
      node('C', i, j, p[0], p[1]);
    }
  }
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j <= nt; j++) {
      const p = pointAt((i + 0.5) / nr, (j * Math.PI) / 2 / nt);
      node('X', i, j, p[0], p[1]);
    }
  }
  for (let i = 0; i <= nr; i++) {
    for (let j = 0; j < nt; j++) {
      const p = pointAt(i / nr, ((j + 0.5) * Math.PI) / 2 / nt);
      node('Y', i, j, p[0], p[1]);
    }
  }

  const elements = [];
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nt; j++) {
      elements.push([
        node('C', i, j),
        node('C', i + 1, j),
        node('C', i + 1, j + 1),
        node('C', i, j + 1),
        node('X', i, j),
        node('Y', i + 1, j),
        node('X', i, j + 1),
        node('Y', i, j)
      ]);
    }
  }
  return { nodes, elements };
}

function runNafemsLE1() {
  const nr = 8;
  const nt = 12;
  const mesh = buildMesh(nr, nt);
  const solver = new PlaneStressQ8({ E, nu: NU, thickness: T });
  for (const n of mesh.nodes) solver.addNode(n.x, n.y);
  for (const e of mesh.elements) solver.addQuad(e);

  for (let i = 0; i < solver.nodes.length; i++) {
    const n = solver.nodes[i];
    if (Math.abs(n.y) < 1e-9) solver.fixNode(i, false, true); // v = 0 on y=0
    if (Math.abs(n.x) < 1e-9) solver.fixNode(i, true, false); // u = 0 on x=0
  }

  // Outer boundary traction: uniform outward normal pressure P = 10 MPa
  for (let j = 0; j < nt; j++) {
    const theta0 = (j * Math.PI) / 2 / nt;
    const theta1 = ((j + 0.5) * Math.PI) / 2 / nt;
    const theta2 = ((j + 1) * Math.PI) / 2 / nt;
    const p0 = outerPoint(theta0);
    const p1 = outerPoint(theta1);
    const p2 = outerPoint(theta2);
    const dt = Math.PI / 2 / nt;
    const ds = Math.hypot(-A2 * Math.sin(theta1), B2 * Math.cos(theta1)) * dt;
    const nx = (B2 * Math.cos(theta1)) / Math.hypot(B2 * Math.cos(theta1), A2 * Math.sin(theta1));
    const ny = (A2 * Math.sin(theta1)) / Math.hypot(B2 * Math.cos(theta1), A2 * Math.sin(theta1));
    const totalF = P * ds * T;
    const fx = totalF * nx;
    const fy = totalF * ny;

    const n0 = mesh.nodes.findIndex((n) => Math.hypot(n.x - p0[0], n.y - p0[1]) < 1e-6);
    const n1 = mesh.nodes.findIndex((n) => Math.hypot(n.x - p1[0], n.y - p1[1]) < 1e-6);
    const n2 = mesh.nodes.findIndex((n) => Math.hypot(n.x - p2[0], n.y - p2[1]) < 1e-6);

    solver.applyNodalLoad(n0, fx / 6, fy / 6);
    solver.applyNodalLoad(n1, (4 * fx) / 6, (4 * fy) / 6);
    solver.applyNodalLoad(n2, fx / 6, fy / 6);
  }

  let result;
  try {
    result = solver.solve();
  } catch (err) {
    return {
      id: 'NAFEMS_LE1',
      name: 'NAFEMS LE1: 2D Q8 plane-stress quarter-ellipse, sigma_y at D',
      targetValue: TARGET_SY,
      calculatedValue: null,
      units: 'Pa',
      errorPercent: null,
      tolerancePercent: TOLERANCE_PERCENT,
      passed: false,
      status: 'failed',
      reason: `Plane-stress solve failed: ${err.message}`
    };
  }

  // Point D is at inner ellipse apex: (A1, 0)
  const dNode = mesh.nodes.findIndex((n) => Math.hypot(n.x - A1, n.y - 0) < 1e-6);

  // Evaluate nodal tangential stress sigma_y at Point D using Q8 shape functions at corner (-1, -1)
  const e0 = mesh.elements[0];
  const coords = e0.map((id) => mesh.nodes[id]);
  const ue = [];
  for (const id of e0) ue.push(result.displacement[id * 2], result.displacement[id * 2 + 1]);

  const { dNdxi, dNdeta } = q8Shape(-1, -1);
  let J00 = 0,
    J01 = 0,
    J10 = 0,
    J11 = 0;
  for (let i = 0; i < 8; i++) {
    J00 += dNdxi[i] * coords[i].x;
    J01 += dNdxi[i] * coords[i].y;
    J10 += dNdeta[i] * coords[i].x;
    J11 += dNdeta[i] * coords[i].y;
  }
  const detJ = J00 * J11 - J01 * J10;
  const inv = [
    [J11 / detJ, -J01 / detJ],
    [-J10 / detJ, J00 / detJ]
  ];
  const dNdx = new Float64Array(8);
  const dNdy = new Float64Array(8);
  for (let i = 0; i < 8; i++) {
    dNdx[i] = inv[0][0] * dNdxi[i] + inv[0][1] * dNdeta[i];
    dNdy[i] = inv[1][0] * dNdxi[i] + inv[1][1] * dNdeta[i];
  }
  let exx = 0,
    eyy = 0;
  for (let i = 0; i < 8; i++) {
    exx += dNdx[i] * ue[i * 2];
    eyy += dNdy[i] * ue[i * 2 + 1];
  }
  const D = solver._stiffness();
  const measuredSyy = D[1][0] * exx + D[1][1] * eyy;

  const error = Math.abs(measuredSyy - TARGET_SY) / Math.abs(TARGET_SY);
  const passed = error * 100 <= TOLERANCE_PERCENT;

  return {
    id: 'NAFEMS_LE1',
    name: 'NAFEMS LE1: 2D Q8 plane-stress quarter-ellipse, sigma_y at D',
    targetValue: TARGET_SY,
    calculatedValue: measuredSyy,
    units: 'Pa',
    errorPercent: error * 100,
    tolerancePercent: TOLERANCE_PERCENT,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : `Measured sigma_y(D) deviates from NAFEMS LE1 reference (92.7 MPa) by ${(error * 100).toFixed(2)}%.`,
    measured: {
      sigmaYAtD: measuredSyy,
      sigmaYAtDMPa: measuredSyy / 1e6,
      targetMPa: 92.7,
      errorPercent: error * 100,
      dofCount: result.dofCount,
      elementCount: solver.elements.length
    },
    expected: { sigmaYAtDMPa: 92.7 },
    details: {
      reference: 'NAFEMS LE1 published standard: sigma_y(D) = 92.7 MPa (+-3.5%).',
      geometry: 'quarter annular ellipse a1=2.0 m, b1=1.0 m, a2=3.25 m, b2=2.75 m, thickness 100 mm',
      solver: 'PlaneStressQ8 (self-contained)',
      material: { E, nu: NU, thicknessM: T },
      loadPa: P,
      mesh: { nr, nt, elements: solver.elements.length }
    }
  };
}

module.exports = { runNafemsLE1 };
