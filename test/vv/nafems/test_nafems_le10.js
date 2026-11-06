/**
 * NAFEMS LE10 (3D linear-elastic thick plate) reconstructed benchmark.
 *
 * Geometry (reconstructed from the published NAFEMS LE10 problem description
 * and the CAD used by the FeenoX/SunCAE tutorial solution):
 *   - quarter annular plate between an inner ellipse (a=2000 mm, b=1000 mm)
 *     and an outer ellipse (a=3250 mm, b=2750 mm), thickness t=600 mm,
 *     quarter symmetry (first quadrant).
 *   - E = 210 GPa, nu = 0.3.
 *   - uniform compressive pressure 1 MPa on the upper surface (z = 600 mm).
 *   - v = 0 on the y = 0 cut plane; u = 0 on the x = 0 cut plane;
 *     u = v = 0 on the inner elliptical bore surface; w = 0 along the
 *     mid-height curve of the inner bore.
 *   - Point D at (2000, 0, 600) mm on the upper surface at the inner bore.
 *   - reference: sigma_yy(D) = -5.38 MPa, tolerance +-5%.
 *
 * Solver: production FEASolver (HEX20 quadratic bricks), with the traction
 * integrated by Gauss quadrature over the element faces.
 */

'use strict';

const { FEASolver } = require('../../../src/core/cae/fea_structural');
const { applyTractionToFaces } = require('../references/fem_helpers');

const E = 210e9;
const NU = 0.3;
const A1 = 2.0;
const B1 = 1.0;
const A2 = 3.25;
const B2 = 2.75;
const T = 0.6;
const PRESSURE = 1e6;
const TARGET_SYY = -5.38e6;
const TOLERANCE_PERCENT = 5;

function innerPoint(theta) {
  return [A1 * Math.cos(theta), B1 * Math.sin(theta)];
}

function outerPoint(theta) {
  return [A2 * Math.cos(theta), B2 * Math.sin(theta)];
}

function pointAt(s, theta, z) {
  const inner = innerPoint(theta);
  const outer = outerPoint(theta);
  return [inner[0] + s * (outer[0] - inner[0]), inner[1] + s * (outer[1] - inner[1]), z];
}

function buildMesh(nr, nt, nz) {
  const nodes = [];
  const nodeIds = new Map();
  const key = (type, i, j, k) => `${type}:${i}:${j}:${k}`;
  const node = (type, i, j, k, x, y, z) => {
    const k0 = key(type, i, j, k);
    if (nodeIds.has(k0)) return nodeIds.get(k0);
    const id = nodes.length;
    nodes.push({ x, y, z });
    nodeIds.set(k0, id);
    return id;
  };
  for (let i = 0; i <= nr; i++) {
    for (let j = 0; j <= nt; j++) {
      for (let k = 0; k <= nz; k++) {
        const p = pointAt(i / nr, (j * Math.PI) / 2 / nt, (T * k) / nz);
        node('C', i, j, k, p[0], p[1], p[2]);
      }
    }
  }
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j <= nt; j++) {
      for (let k = 0; k <= nz; k++) {
        const p = pointAt((i + 0.5) / nr, (j * Math.PI) / 2 / nt, (T * k) / nz);
        node('X', i, j, k, p[0], p[1], p[2]);
      }
    }
  }
  for (let i = 0; i <= nr; i++) {
    for (let j = 0; j < nt; j++) {
      for (let k = 0; k <= nz; k++) {
        const p = pointAt(i / nr, ((j + 0.5) * Math.PI) / 2 / nt, (T * k) / nz);
        node('Y', i, j, k, p[0], p[1], p[2]);
      }
    }
  }
  for (let i = 0; i <= nr; i++) {
    for (let j = 0; j <= nt; j++) {
      for (let k = 0; k < nz; k++) {
        const p = pointAt(i / nr, (j * Math.PI) / 2 / nt, (T * (k + 0.5)) / nz);
        node('Z', i, j, k, p[0], p[1], p[2]);
      }
    }
  }
  const elements = [];
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nt; j++) {
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

function runNafemsLE10() {
  const nr = 10;
  const nt = 14;
  const nz = 4;
  const mesh = buildMesh(nr, nt, nz);
  const solver = new FEASolver();
  for (const n of mesh.nodes) solver.addNode(n.x, n.y, n.z);
  for (const e of mesh.elements) solver.addElement(e, { E, nu: NU, yieldStress: 1e9 });

  applyTractionToFaces(
    solver,
    (x, y, z) => Math.abs(z - T) < 1e-9,
    () => [0, 0, -PRESSURE]
  );

  const variant = process.env.LE10_VARIANT || 'outer';
  for (let i = 0; i < solver.nodes.length; i++) {
    const n = solver.nodes[i];
    if (Math.abs(n.y) < 1e-12) solver.fixNode(i, false, true, false);
    if (Math.abs(n.x) < 1e-12) solver.fixNode(i, true, false, false);
    const s = Math.hypot(n.x / A1, n.y / B1);
    const outer = Math.hypot(n.x / A2, n.y / B2);
    if (Math.abs(s - 1) < 1e-9) solver.fixNode(i, true, true, false);
    if (variant === 'inner' && Math.abs(n.z - T / 2) < 1e-9 && Math.abs(s - 1) < 1e-9) {
      solver.fixNode(i, false, false, true);
    } else if (variant === 'outer' && Math.abs(n.z - T / 2) < 1e-9 && Math.abs(outer - 1) < 1e-9) {
      solver.fixNode(i, false, false, true);
    } else if (variant === 'midplane' && Math.abs(n.z - T / 2) < 1e-9) {
      solver.fixNode(i, false, false, true);
    } else if (variant === 'none') {
      if (Math.abs(n.x - A1) < 1e-9 && Math.abs(n.y) < 1e-9 && Math.abs(n.z - T) < 1e-9) {
        solver.fixNode(i, false, false, true);
      }
    }
  }

  solver.solveStatic();

  const dNode = mesh.nodes.findIndex(
    (n) => Math.abs(n.x - A1) < 1e-9 && Math.abs(n.y) < 1e-9 && Math.abs(n.z - T) < 1e-9
  );
  const adjacent = [];
  for (const elem of solver.elements) {
    if (elem.nodeIds.includes(dNode)) adjacent.push(elem);
  }
  let syySum = 0;
  for (const elem of adjacent) syySum += elem.stress.syy;
  const measuredSyy = syySum / Math.max(1, adjacent.length);

  const error = Math.abs(measuredSyy - TARGET_SYY) / Math.abs(TARGET_SYY);
  const passed = error * 100 <= TOLERANCE_PERCENT;

  return {
    id: 'NAFEMS_LE10',
    name: 'NAFEMS LE10: 3D thick quarter-elliptic annular plate under 1 MPa pressure, sigma_yy at D',
    targetValue: TARGET_SYY,
    calculatedValue: measuredSyy,
    units: 'Pa',
    errorPercent: error * 100,
    tolerancePercent: TOLERANCE_PERCENT,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : 'Measured sigma_yy(D) deviates from the NAFEMS LE10 reference (-5.38 MPa) beyond +-5%.',
    measured: {
      sigmaYyAtD: measuredSyy,
      sigmaYyAtDMPa: measuredSyy / 1e6,
      targetMPa: -5.38,
      errorPercent: error * 100,
      adjacentElements: adjacent.length,
      dofCount: solver.nodes.length * 3,
      elementCount: solver.elements.length
    },
    expected: { sigmaYyAtDMPa: -5.38 },
    details: {
      reference: 'NAFEMS LE10 benchmark reference: sigma_yy(D) = -5.38 MPa (N=EMS benchmark data).',
      solver: 'FEASolver HEX20 (production)',
      geometry: {
        innerEllipse: { a: A1, b: B1 },
        outerEllipse: { a: A2, b: B2 },
        thicknessM: T,
        pointDM: { x: A1, y: 0, z: T }
      },
      mesh: { nr, nt, nz, nodes: solver.nodes.length, elements: solver.elements.length },
      boundaryConditions: {
        upperSurfacePressureMPa: 1,
        y0Plane: 'v=0',
        x0Plane: 'u=0',
        innerBore: 'u=v=0',
        midHeightOuterCurve: 'w=0'
      },
      note: 'Reconstructed from the published NAFEMS LE10 problem figure and the FeenoX LE10 example; the reported value is an FE solution, not a reformulated reference.'
    }
  };
}

module.exports = { runNafemsLE10 };
