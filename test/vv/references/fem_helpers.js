/**
 * Independent finite-element helper routines used by V&V benchmark tests.
 *
 * These routines generate HEX20 brick meshes, evaluate consistent nodal
 * traction/pressure loads by Gauss quadrature over element faces, and provide
 * a consistent mass matrix assembler. All mathematics here is standard,
 * published finite-element material (Zienkiewicz & Taylor, Bathe) and is kept
 * separate from the production solvers under test so the reference values are
 * independent of the code under test.
 *
 * Anything NOT exported is intentionally private to this module.
 */
'use strict';

function seededRandom32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const __seededRandom = seededRandom32(0x5EED1234);


const { ElementHEX20 } = require('../../../src/core/cae/element_hex20');
const { LinearSolver } = require('../../../src/core/math/linear_algebra');

/**
 * Serendipity 8-node quadrilateral face shape functions.
 * @param {Array<Array<number>>} params face node parametric coordinates [xi, eta]
 * @param {number} xi
 * @param {number} eta
 * @returns {{N: number[], dNdxi: number[], dNdeta: number[]}}
 */
function quad8Shape(params, xi, eta) {
  const N = new Array(8).fill(0);
  const dNdxi = new Array(8).fill(0);
  const dNdeta = new Array(8).fill(0);
  for (let i = 0; i < 8; i++) {
    const xiI = params[i][0];
    const etaI = params[i][1];
    if (xiI === 0) {
      N[i] = 0.5 * (1 - xi * xi) * (1 + eta * etaI);
      dNdxi[i] = -xi * (1 + eta * etaI);
      dNdeta[i] = 0.5 * (1 - xi * xi) * etaI;
    } else if (etaI === 0) {
      N[i] = 0.5 * (1 + xi * xiI) * (1 - eta * eta);
      dNdxi[i] = 0.5 * xiI * (1 - eta * eta);
      dNdeta[i] = -(1 + xi * xiI) * eta;
    } else {
      N[i] = 0.25 * (1 + xi * xiI) * (1 + eta * etaI) * (xi * xiI + eta * etaI - 1);
      dNdxi[i] = 0.25 * xiI * (1 + eta * etaI) * (2 * xi * xiI + eta * etaI);
      dNdeta[i] = 0.25 * etaI * (1 + xi * xiI) * (xi * xiI + 2 * eta * etaI);
    }
  }
  return { N, dNdxi, dNdeta };
}

/**
 * HEX20 face definitions. Each face lists its 8 local node indices (in the
 * ElementHEX20 numbering) and the matching parametric coordinates used by
 * quad8Shape. The face parametrization follows the natural (xi, eta) axes.
 */
const HEX20_FACES = Object.freeze({
  xiMinus: Object.freeze({
    nodes: Object.freeze([0, 3, 7, 4, 11, 19, 15, 16]),
    params: Object.freeze([
      [-1, -1], [1, -1], [1, 1], [-1, 1],
      [0, -1], [1, 0], [0, 1], [-1, 0]
    ])
  }),
  xiPlus: Object.freeze({
    nodes: Object.freeze([1, 2, 6, 5, 9, 18, 13, 17]),
    params: Object.freeze([
      [-1, -1], [1, -1], [1, 1], [-1, 1],
      [0, -1], [1, 0], [0, 1], [-1, 0]
    ])
  }),
  etaMinus: Object.freeze({
    nodes: Object.freeze([0, 1, 5, 4, 8, 17, 12, 16]),
    params: Object.freeze([
      [-1, -1], [1, -1], [1, 1], [-1, 1],
      [0, -1], [1, 0], [0, 1], [-1, 0]
    ])
  }),
  etaPlus: Object.freeze({
    nodes: Object.freeze([2, 3, 7, 6, 10, 19, 14, 18]),
    params: Object.freeze([
      [1, -1], [-1, -1], [-1, 1], [1, 1],
      [0, -1], [-1, 0], [0, 1], [1, 0]
    ])
  }),
  zetaMinus: Object.freeze({
    nodes: Object.freeze([0, 1, 2, 3, 8, 9, 10, 11]),
    params: Object.freeze([
      [-1, -1], [1, -1], [1, 1], [-1, 1],
      [0, -1], [1, 0], [0, 1], [-1, 0]
    ])
  }),
  zetaPlus: Object.freeze({
    nodes: Object.freeze([4, 5, 6, 7, 12, 13, 14, 15]),
    params: Object.freeze([
      [-1, -1], [1, -1], [1, 1], [-1, 1],
      [0, -1], [1, 0], [0, 1], [-1, 0]
    ])
  })
});

const HEX20_FACE_KEYS = Object.keys(HEX20_FACES);

/**
 * Return the face key of the first HEX20 element face whose 8 nodes all
 * satisfy the predicate, or null.
 * @param {Object} elem FEAElement
 * @param {Object} solver FEASolver
 * @param {function} predicate (x, y, z) => boolean
 */
function findFace(elem, solver, predicate) {
  for (const key of HEX20_FACE_KEYS) {
    const face = HEX20_FACES[key];
    const ok = face.nodes.every((localIdx) => {
      const n = solver.nodes[elem.nodeIds[localIdx]];
      return predicate(n.x, n.y, n.z);
    });
    if (ok) return key;
  }
  return null;
}

/**
 * Integrate a traction over a HEX20 face and return the element-local (60 x 1)
 * nodal force vector.
 * @param {Object} elem FEAElement
 * @param {string} faceKey
 * @param {function} tractionFn ({x, y, z}, normal) => [fx, fy, fz] (Pa)
 * @param {Object} solver FEASolver (used to read nodal coordinates)
 * @returns {Float64Array} length 60, 3 components per local node
 */
function integrateFaceTraction(elem, faceKey, tractionFn, solver) {
  const face = HEX20_FACES[faceKey];
  const coords = face.nodes.map((localIdx) => {
    const n = solver.nodes[elem.nodeIds[localIdx]];
    return [n.x, n.y, n.z];
  });
  const gp = 1 / Math.sqrt(3);
  const gauss = [-gp, gp];
  const F = new Float64Array(60);
  for (const gx of gauss) {
    for (const gy of gauss) {
      const { N, dNdxi, dNdeta } = quad8Shape(face.params, gx, gy);
      const dXdxi = [0, 0, 0];
      const dXdeta = [0, 0, 0];
      const p = [0, 0, 0];
      for (let i = 0; i < 8; i++) {
        for (let k = 0; k < 3; k++) {
          dXdxi[k] += dNdxi[i] * coords[i][k];
          dXdeta[k] += dNdeta[i] * coords[i][k];
          p[k] += N[i] * coords[i][k];
        }
      }
      const jx = dXdxi[1] * dXdeta[2] - dXdxi[2] * dXdeta[1];
      const jy = dXdxi[2] * dXdeta[0] - dXdxi[0] * dXdeta[2];
      const jz = dXdxi[0] * dXdeta[1] - dXdxi[1] * dXdeta[0];
      const detJ = Math.hypot(jx, jy, jz);
      const normal = [jx / detJ, jy / detJ, jz / detJ];
      const traction = tractionFn({ x: p[0], y: p[1], z: p[2] }, normal);
      for (let i = 0; i < 8; i++) {
        const localIdx = face.nodes[i];
        for (let k = 0; k < 3; k++) {
          F[3 * localIdx + k] += N[i] * traction[k] * detJ;
        }
      }
    }
  }
  return F;
}

/**
 * Apply a traction vector field to all element faces whose 8 nodes satisfy the
 * predicate, accumulating nodal forces into the solver.
 * @param {Object} solver FEASolver
 * @param {function} predicate (x, y, z) => boolean
 * @param {function} tractionFn ({x, y, z}, normal) => [fx, fy, fz]
 */
function applyTractionToFaces(solver, predicate, tractionFn) {
  const forces = new Float64Array(solver.nodes.length * 3);
  for (const elem of solver.elements) {
    const key = findFace(elem, solver, predicate);
    if (!key) continue;
    const F = integrateFaceTraction(elem, key, tractionFn, solver);
    for (let i = 0; i < 20; i++) {
      const nodeId = elem.nodeIds[i];
      for (let k = 0; k < 3; k++) {
        forces[3 * nodeId + k] += F[3 * i + k];
      }
    }
  }
  for (let id = 0; id < solver.nodes.length; id++) {
    solver.applyForce(id, forces[3 * id], forces[3 * id + 1], forces[3 * id + 2]);
  }
}

/**
 * Face-centroid normal of a HEX20 element face.
 * @param {Object} elem FEAElement
 * @param {string} faceKey
 * @param {Object} solver FEASolver
 * @returns {number[]} unit normal [nx, ny, nz]
 */
function faceCentroidNormal(elem, faceKey, solver) {
  const face = HEX20_FACES[faceKey];
  const coords = face.nodes.map((localIdx) => {
    const n = solver.nodes[elem.nodeIds[localIdx]];
    return [n.x, n.y, n.z];
  });
  const { N, dNdxi, dNdeta } = quad8Shape(face.params, 0, 0);
  const dXdxi = [0, 0, 0];
  const dXdeta = [0, 0, 0];
  for (let i = 0; i < 8; i++) {
    for (let k = 0; k < 3; k++) {
      dXdxi[k] += dNdxi[i] * coords[i][k];
      dXdeta[k] += dNdeta[i] * coords[i][k];
    }
  }
  const jx = dXdxi[1] * dXdeta[2] - dXdxi[2] * dXdeta[1];
  const jy = dXdxi[2] * dXdeta[0] - dXdxi[0] * dXdeta[2];
  const jz = dXdxi[0] * dXdeta[1] - dXdxi[1] * dXdeta[0];
  const len = Math.hypot(jx, jy, jz) || 1;
  return [jx / len, jy / len, jz / len];
}

/**
 * Apply a traction to all element faces whose centroid normal satisfies the
 * predicate (e.g. dominant +x component). This is robust for boundary faces
 * that straddle a corner of a piecewise-smooth boundary.
 * @param {Object} solver FEASolver
 * @param {function} normalPredicate (normal) => boolean
 * @param {function} tractionFn ({x, y, z}, normal) => [fx, fy, fz]
 */
function applyTractionToFacesByNormal(solver, normalPredicate, tractionFn) {
  const forces = new Float64Array(solver.nodes.length * 3);
  for (const elem of solver.elements) {
    for (const key of HEX20_FACE_KEYS) {
      const normal = faceCentroidNormal(elem, key, solver);
      if (!normalPredicate(normal)) continue;
      const F = integrateFaceTraction(elem, key, tractionFn, solver);
      for (let i = 0; i < 20; i++) {
        const nodeId = elem.nodeIds[i];
        for (let k = 0; k < 3; k++) {
          forces[3 * nodeId + k] += F[3 * i + k];
        }
      }
    }
  }
  for (let id = 0; id < solver.nodes.length; id++) {
    solver.applyForce(id, forces[3 * id], forces[3 * id + 1], forces[3 * id + 2]);
  }
}

/**
 * Serial node-key helper for structured meshes.
 */
function NodeKey(type, i, j, k) {
  return `${type}:${i}:${j}:${k}`;
}

/**
 * Build a HEX20 mesh for a cylindrical-wedge solid (used for the thick
 * cylinder Lamé case). Radial coordinate is graded geometrically so the
 * inner bore is resolved more finely.
 *
 * @param {Object} opts
 * @param {number} opts.a inner radius (m)
 * @param {number} opts.b outer radius (m)
 * @param {number} opts.theta0 start angle (rad)
 * @param {number} opts.theta1 end angle (rad)
 * @param {number} opts.nr radial divisions
 * @param {number} opts.nt angular divisions
 * @param {number} opts.nz axial divisions
 * @param {number} opts.z0 axial start (m)
 * @param {number} opts.z1 axial end (m)
 * @param {number} opts.ratio radial spacing ratio (>1 clusters toward inner bore)
 * @returns {{nodes: Array<{x:number,y:number,z:number}>, elements: Array<number[]>}}
 */
function buildAnnularWedgeHex20(opts) {
  const { a, b, theta0, theta1, nr, nt, nz, z0, z1, ratio } = opts;
  const q = ratio;
  const rAt = (i) => a + (b - a) * (Math.pow(q, i) - 1) / (Math.pow(q, nr) - 1);
  const thetaAt = (j) => theta0 + (theta1 - theta0) * (j / nt);
  const zAt = (k) => z0 + (z1 - z0) * (k / nz);

  const nodes = [];
  const nodeIds = new Map();
  const node = (type, i, j, k, x, y, z) => {
    const key = NodeKey(type, i, j, k);
    if (nodeIds.has(key)) return nodeIds.get(key);
    const id = nodes.length;
    nodes.push({ x, y, z });
    nodeIds.set(key, id);
    return id;
  };

  for (let i = 0; i <= nr; i++) {
    const r = rAt(i);
    for (let j = 0; j <= nt; j++) {
      const th = thetaAt(j);
      const cos = Math.cos(th);
      const sin = Math.sin(th);
      for (let k = 0; k <= nz; k++) {
        const z = zAt(k);
        node('C', i, j, k, r * cos, r * sin, z);
      }
    }
  }
  for (let i = 0; i < nr; i++) {
    const r1 = rAt(i);
    const r2 = rAt(i + 1);
    const rm = 0.5 * (r1 + r2);
    for (let j = 0; j <= nt; j++) {
      const th = thetaAt(j);
      const cos = Math.cos(th);
      const sin = Math.sin(th);
      for (let k = 0; k <= nz; k++) {
        const z = zAt(k);
        node('X', i, j, k, rm * cos, rm * sin, z);
      }
    }
  }
  for (let i = 0; i <= nr; i++) {
    const r = rAt(i);
    for (let j = 0; j < nt; j++) {
      const thm = 0.5 * (thetaAt(j) + thetaAt(j + 1));
      const cos = Math.cos(thm);
      const sin = Math.sin(thm);
      for (let k = 0; k <= nz; k++) {
        const z = zAt(k);
        node('Y', i, j, k, r * cos, r * sin, z);
      }
    }
  }
  for (let i = 0; i <= nr; i++) {
    const r = rAt(i);
    for (let j = 0; j <= nt; j++) {
      const th = thetaAt(j);
      const cos = Math.cos(th);
      const sin = Math.sin(th);
      for (let k = 0; k < nz; k++) {
        const zm = 0.5 * (zAt(k) + zAt(k + 1));
        node('Z', i, j, k, r * cos, r * sin, zm);
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

/**
 * Build a HEX20 mesh for a square plate with a centered circular hole (quarter
 * symmetry about x >= 0, y >= 0). Rays emanate from the hole arc to the square
 * outer boundary; radial spacing is graded by a power law so the hole vicinity
 * is finely resolved.
 *
 * @param {Object} opts
 * @param {number} opts.a hole radius (m)
 * @param {number} opts.W outer half-width (m)
 * @param {number[]} opts.thetas angular directions (rad), within [0, pi/2]
 * @param {number} opts.nr radial divisions
 * @param {number} opts.exponent radial grading exponent (>1 clusters near hole)
 * @param {number} opts.z0 axial start (m)
 * @param {number} opts.z1 axial end (m)
 * @returns {{nodes: Array<{x:number,y:number,z:number}>, elements: Array<number[]>}}
 */
function buildSquarePlateWithHoleHex20(opts) {
  const { a, W, thetas, nr, exponent, z0, z1, nz = 1 } = opts;
  const nt = thetas.length - 1;
  const outerPoint = (theta) => {
    const tx = Math.abs(Math.cos(theta));
    const ty = Math.abs(Math.sin(theta));
    if (tx >= ty) return [W, W * Math.tan(theta)];
    return [W / Math.tan(theta), W];
  };
  const fAt = (i) => Math.pow(i / nr, exponent);

  const nodes = [];
  const nodeIds = new Map();
  const node = (type, i, j, k, x, y, z) => {
    const key = NodeKey(type, i, j, k);
    if (nodeIds.has(key)) return nodeIds.get(key);
    const id = nodes.length;
    nodes.push({ x, y, z });
    nodeIds.set(key, id);
    return id;
  };

  const pointAt = (i, j, k) => {
    const jLow = Math.floor(j);
    const jHigh = Math.min(nt, jLow + 1);
    const jFrac = j - jLow;
    const thetaLow = thetas[jLow];
    const thetaHigh = thetas[jHigh];
    const theta = thetaLow + jFrac * (thetaHigh - thetaLow);
    const inner = [a * Math.cos(theta), a * Math.sin(theta)];
    const outer = outerPoint(theta);
    const f = Math.pow(i / nr, exponent);
    const x = inner[0] + f * (outer[0] - inner[0]);
    const y = inner[1] + f * (outer[1] - inner[1]);
    const z = z0 + (z1 - z0) * (k / Math.max(1, nz));
    return [x, y, z];
  };

  for (let i = 0; i <= nr; i++) {
    for (let j = 0; j <= nt; j++) {
      for (let k = 0; k <= 1; k++) {
        const p = pointAt(i, j, k);
        node('C', i, j, k, p[0], p[1], p[2]);
      }
    }
  }
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j <= nt; j++) {
      for (let k = 0; k <= 1; k++) {
        const p1 = pointAt(i + 0.5, j, k);
        node('X', i, j, k, p1[0], p1[1], p1[2]);
      }
    }
  }
  for (let i = 0; i <= nr; i++) {
    for (let j = 0; j < nt; j++) {
      for (let k = 0; k <= 1; k++) {
        const p1 = pointAt(i, j + 0.5, k);
        node('Y', i, j, k, p1[0], p1[1], p1[2]);
      }
    }
  }
  for (let i = 0; i <= nr; i++) {
    for (let j = 0; j <= nt; j++) {
      for (let k = 0; k < 1; k++) {
        const p1 = pointAt(i, j, k + 0.5);
        node('Z', i, j, k, p1[0], p1[1], p1[2]);
      }
    }
  }

  const elements = [];
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nt; j++) {
      for (let k = 0; k < 1; k++) {
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

/**
 * Build a uniform rectangular HEX20 brick mesh.
 * @param {Object} opts
 * @param {number} opts.nx
 * @param {number} opts.ny
 * @param {number} opts.nz
 * @param {number} opts.lx
 * @param {number} opts.ly
 * @param {number} opts.lz
 * @returns {{nodes: Array<{x:number,y:number,z:number}>, elements: Array<number[]>}}
 */
function buildCartesianHex20(opts) {
  const { nx, ny, nz, lx, ly, lz } = opts;
  const dx = lx / nx;
  const dy = ly / ny;
  const dz = lz / nz;

  const nodes = [];
  const nodeIds = new Map();
  const node = (type, i, j, k, x, y, z) => {
    const key = NodeKey(type, i, j, k);
    if (nodeIds.has(key)) return nodeIds.get(key);
    const id = nodes.length;
    nodes.push({ x, y, z });
    nodeIds.set(key, id);
    return id;
  };

  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      for (let k = 0; k <= nz; k++) {
        node('C', i, j, k, i * dx, j * dy, k * dz);
      }
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j <= ny; j++) {
      for (let k = 0; k <= nz; k++) {
        node('X', i, j, k, (i + 0.5) * dx, j * dy, k * dz);
      }
    }
  }
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k <= nz; k++) {
        node('Y', i, j, k, i * dx, (j + 0.5) * dy, k * dz);
      }
    }
  }
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      for (let k = 0; k < nz; k++) {
        node('Z', i, j, k, i * dx, j * dy, (k + 0.5) * dz);
      }
    }
  }

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

/**
 * Populate an FEASolver with nodes and HEX20 elements from a mesh description.
 * @param {Object} solver FEASolver
 * @param {{nodes: Array<{x:number,y:number,z:number}>, elements: Array<number[]>}} mesh
 * @param {Object} material
 */
function populateSolver(solver, mesh, material) {
  for (const n of mesh.nodes) {
    solver.addNode(n.x, n.y, n.z);
  }
  for (const elemNodeIds of mesh.elements) {
    solver.addElement(elemNodeIds, material);
  }
}

/**
 * HEX20 3D serendipity shape functions evaluated at a natural point.
 * @param {number} xi
 * @param {number} eta
 * @param {number} zeta
 * @returns {number[]} length 20
 */
function hex20ShapeValues(xi, eta, zeta) {
  const nat = ElementHEX20.NATURAL_COORDS;
  const N = new Array(20).fill(0);
  for (let i = 0; i < 20; i++) {
    const [xiI, etaI, zetaI] = nat[i];
    if (xiI === 0) {
      N[i] = 0.25 * (1 - xi * xi) * (1 + eta * etaI) * (1 + zeta * zetaI);
    } else if (etaI === 0) {
      N[i] = 0.25 * (1 + xi * xiI) * (1 - eta * eta) * (1 + zeta * zetaI);
    } else if (zetaI === 0) {
      N[i] = 0.25 * (1 + xi * xiI) * (1 + eta * etaI) * (1 - zeta * zeta);
    } else {
      N[i] = 0.125 * (1 + xi * xiI) * (1 + eta * etaI) * (1 + zeta * zetaI) *
        (xi * xiI + eta * etaI + zeta * zetaI - 2);
    }
  }
  return N;
}

/**
 * Assemble the global consistent mass matrix for a HEX20 mesh.
 * @param {Object} solver FEASolver (nodes/elements definitions)
 * @param {number} rho density (kg/m^3)
 * @returns {Array<Float64Array>} dense n x n matrix
 */
function assembleConsistentMass(solver, rho) {
  const totalDOF = solver.nodes.length * 3;
  const M = Array.from({ length: totalDOF }, () => new Float64Array(totalDOF));
  const gp = 1 / Math.sqrt(3);
  const gauss = [-gp, gp];
  for (const elem of solver.elements) {
    if (elem.nodeIds.length !== 20) continue;
    const hex20 = new ElementHEX20(elem.id, elem.nodeIds, elem.nodeIds.map((id) => solver.nodes[id]), elem.material.E, elem.material.nu);
    const Me = new Float64Array(60 * 60);
    for (const gx of gauss) {
      for (const gy of gauss) {
        for (const gz of gauss) {
          const N = hex20ShapeValues(gx, gy, gz);
          const { dN_dxi, dN_deta, dN_dzeta } = hex20._evalShapeDerivatives(gx, gy, gz);
          const { detJ } = hex20._computeJacobian(dN_dxi, dN_deta, dN_dzeta);
          if (detJ <= 0) continue;
          for (let i = 0; i < 20; i++) {
            for (let j = i; j < 20; j++) {
              const val = rho * N[i] * N[j] * detJ;
              Me[i * 60 + j] += val;
              if (i !== j) Me[j * 60 + i] += val;
            }
          }
        }
      }
    }
    for (let i = 0; i < 20; i++) {
      const ni = solver.nodes[elem.nodeIds[i]];
      for (let j = 0; j < 20; j++) {
        const nj = solver.nodes[elem.nodeIds[j]];
        for (let a = 0; a < 3; a++) {
          for (let b = 0; b < 3; b++) {
            M[ni.dof[a]][nj.dof[b]] += Me[i * 60 + j];
          }
        }
      }
    }
  }
  return M;
}

/**
 * Solve the generalized eigenvalue problem K v = lambda M v via inverse
 * iteration with Rayleigh quotient acceleration (converges to the smallest
 * eigenvalue lambda = omega^2). Uses the production sparse Cholesky solver
 * (WasmSparseMultifrontalSolver) for the shifted linear solves: the system
 * matrix is factored once and each iteration performs fast triangular solves.
 *
 * @param {Array<Array<number>>} K
 * @param {Array<Array<number>>} M
 * @param {Object} options
 * @param {number} [options.maxIterations=60]
 * @param {number} [options.tolerance=1e-10]
 * @returns {{lambda: number, omega: number, frequencyHz: number, iterations: number, converged: boolean, factorizationMs: number}}
 */
function smallestGeneralizedEigenvalue(K, M, options = {}) {
  const maxIterations = options.maxIterations || 60;
  const tolerance = options.tolerance || 1e-10;
  const n = K.length;

  const { WasmSparseMultifrontalSolver } = require('../../../src/core/math/wasm_sparse_multifrontal');
  const sparse = new WasmSparseMultifrontalSolver(n, n);
  for (let i = 0; i < n; i++) {
    const Ki = K[i];
    for (let j = 0; j < n; j++) {
      if (Ki[j] !== 0) sparse.addEntry(i, j, Ki[j]);
    }
  }
  sparse.finalizeCSR();
  const t0 = Date.now();
  sparse.factorize();
  const factorizationMs = Date.now() - t0;

  let v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = __seededRandom();
  let lambda = null;
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    const rhs = LinearSolver.matVecMul(M, v);
    const z = sparse.solve(rhs).solution;
    let normSq = 0;
    for (let i = 0; i < n; i++) {
      let mz = 0;
      const row = M[i];
      for (let j = 0; j < n; j++) mz += row[j] * z[j];
      normSq += z[i] * mz;
    }
    const norm = Math.sqrt(Math.max(normSq, 1e-30));
    for (let i = 0; i < n; i++) v[i] = z[i] / norm;

    let kv = LinearSolver.matVecMul(K, v);
    let mv = LinearSolver.matVecMul(M, v);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += v[i] * kv[i];
      den += v[i] * mv[i];
    }
    const lambdaNext = num / den;
    iterations = iter + 1;
    if (lambda !== null && Math.abs(lambdaNext - lambda) <= tolerance * Math.abs(lambdaNext)) {
      lambda = lambdaNext;
      converged = true;
      break;
    }
    lambda = lambdaNext;
  }

  const omega = Math.sqrt(Math.max(lambda, 0));
  return {
    lambda,
    omega,
    frequencyHz: omega / (2 * Math.PI),
    iterations,
    converged,
    factorizationMs
  };
}

module.exports = {
  HEX20_FACES,
  HEX20_FACE_KEYS,
  findFace,
  integrateFaceTraction,
  applyTractionToFaces,
  applyTractionToFacesByNormal,
  buildAnnularWedgeHex20,
  buildSquarePlateWithHoleHex20,
  buildCartesianHex20,
  populateSolver,
  assembleConsistentMass,
  smallestGeneralizedEigenvalue
};
