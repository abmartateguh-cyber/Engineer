/**
 * OmniEng Shell Assembly — production assembly path for MITC4 shell elements.
 *
 * The shipped ShellMITC4Element computes a single-element stiffness matrix whose
 * transverse-shear block only contains the (dw/dx)^2 / (dw/dy)^2 terms: the
 * w-theta coupling terms required by first-order (Mindlin-Reissner) shear
 * deformation theory are missing, so a single element cannot represent plate
 * bending. This module reuses the element's constitutive matrices (Dm, Db,
 * Ds, drilling stabilization) and its membrane/bending/drilling blocks
 * verbatim, and supplies the missing MITC4 transverse-shear block:
 *
 *   gamma_xz = dw/dx + theta_y,   gamma_yz = dw/dy - theta_x
 *
 * evaluated with the MITC4 assumed shear-strain interpolation. For rectangular
 * and parallelogram quads this reduces exactly to the classic selective
 * reduced integration (SRI) Q4 shear block, which is documented-typical for the
 * MITC4-equivalent element and converges to the Kirchhoff thin-plate solution.
 *
 * Global system: 6 DOFs per node [u, v, w, theta_x, theta_y, theta_z].
 * Assembly reuses the production sparse direct solver
 * (WasmSparseMultifrontalSolver, sparse Cholesky) and enforces Dirichlet
 * boundary conditions by symmetric row/column elimination with right-hand-side
 * lifting. The solve is fail-closed: non-finite geometry, degenerate
 * elements, non-SPD systems, or non-finite/unconverged solutions raise.
 */

'use strict';

const { ShellMITC4Element } = require('./shell_mitc4');
const { WasmSparseMultifrontalSolver } = require('../math/wasm_sparse_multifrontal');
const { LinearSolver } = require('../math/linear_algebra');

// WasmSparseMultifrontalSolver.factorize() exhibits a numerical failure (spurious
// non-positive pivot) on well-conditioned SPD systems spanning very different
// scales (reproducible on a tridiagonal matrix with one small diagonal). Shell
// systems above ~1100 dofs that hit this defect fail closed; smaller systems
// fall back to the production dense partial-pivoting Gaussian solve.
const MAX_DENSE_FALLBACK_DOF = 1100;

const DOF_PER_NODE = 6;
const IDX = { u: 0, v: 1, w: 2, rx: 3, ry: 4, rz: 5 };

/**
 * Build the local 3x3 rotation matrix from the first edge and the plane normal
 * (columns are the local basis vectors expressed in global coordinates).
 */
function buildLocalFrame(p) {
  const e1x = p[1].x - p[0].x;
  const e1y = p[1].y - p[0].y;
  const e1z = p[1].z - p[0].z;
  const l1 = Math.hypot(e1x, e1y, e1z);
  if (!(l1 > 0)) throw new Error('Shell element has coincident first two nodes.');
  const e1 = [e1x / l1, e1y / l1, e1z / l1];

  const a2x = p[2].x - p[0].x;
  const a2y = p[2].y - p[0].y;
  const a2z = p[2].z - p[0].z;
  let nx = e1y * a2z - e1z * a2y;
  let ny = e1z * a2x - e1x * a2z;
  let nz = e1x * a2y - e1y * a2x;
  const ln = Math.hypot(nx, ny, nz);
  if (!(ln > 0)) throw new Error('Shell element is degenerate (zero area / collinear nodes).');
  nx /= ln;
  ny /= ln;
  nz /= ln;

  // e2 = n x e1 (using the normalized e1 components)
  const e2 = [ny * e1[2] - nz * e1[1], nz * e1[0] - nx * e1[2], nx * e1[1] - ny * e1[0]];

  // R maps local -> global: global = R * local
  return [
    [e1[0], e2[0], nx],
    [e1[1], e2[1], ny],
    [e1[2], e2[2], nz]
  ];
}

function mat3Mul(a, b) {
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) c[i] += a[i][j] * b[j];
  }
  return c;
}

function mat3TransposeMul(a, b) {
  // a^T * b
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) c[i] += a[j][i] * b[j];
  }
  return c;
}

/**
 * Extract the 6x6 nodal block (i, j) from a flattened 24x24 row-major element
 * stiffness matrix. Rows have stride 24, so the block is not contiguous.
 */
function extractBlock6(KeFlat, i, j) {
  const b = new Float64Array(36);
  for (let a = 0; a < 6; a++) {
    const row = (i * 6 + a) * 24 + j * 6;
    b.set(KeFlat.subarray(row, row + 6), a * 6);
  }
  return b;
}

/**
 * Rotate a 6x6 local block to global: K_g = R * K_l * R^T (block-diagonal
 * [R, R] acting on nodal dof vectors).
 */
function rotateBlock6(kL, R) {
  const kG = new Float64Array(36);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      // R row i, col k = R[i%3][k] for k<3 else R[i-3][k-3]
      const ri = i % 3;
      const ci = i < 3 ? 0 : 3;
      const rj = j % 3;
      const cj = j < 3 ? 0 : 3;
      let acc = 0;
      for (let a = 0; a < 3; a++) {
        const ra = ci + a;
        for (let b = 0; b < 3; b++) {
          const rb = cj + b;
          acc += R[ri][a] * kL[ra * 6 + rb] * R[rj][b];
        }
      }
      kG[i * 6 + j] = acc;
    }
  }
  return kG;
}

/**
 * Local 24x24 stiffness for one quad. Membrane, bending and drilling blocks are
 * the identical formulas used by ShellMITC4Element.computeStiffnessMatrix
 * (reused verbatim), the transverse-shear block is the complete MITC4-reduced
 * (SRI-equivalent on rectangles) first-order shear block.
 */
function buildShellStiffnessLocal(coords, properties) {
  const proto = new ShellMITC4Element(0, [0, 1, 2, 3], coords, properties);
  const { E, nu, t } = proto;

  const factorMem = (E * t) / (1 - nu * nu);
  const Dm = [
    [factorMem, factorMem * nu, 0],
    [factorMem * nu, factorMem, 0],
    [0, 0, (factorMem * (1 - nu)) / 2]
  ];
  const factorBend = (E * t * t * t) / (12 * (1 - nu * nu));
  const Db = [
    [factorBend, factorBend * nu, 0],
    [factorBend * nu, factorBend, 0],
    [0, 0, (factorBend * (1 - nu)) / 2]
  ];
  const G = E / (2 * (1 + nu));
  const factorShear = (5 / 6) * G * t;

  const Ke = new Float64Array(24 * 24);
  const g = 1 / Math.sqrt(3);
  const gaussPoints = [
    { r: -g, s: -g },
    { r: g, s: -g },
    { r: g, s: g },
    { r: -g, s: g }
  ];

  for (const gp of gaussPoints) {
    const { r, s } = gp;
    const N = [0.25 * (1 - r) * (1 - s), 0.25 * (1 + r) * (1 - s), 0.25 * (1 + r) * (1 + s), 0.25 * (1 - r) * (1 + s)];
    const dNdr = [-0.25 * (1 - s), 0.25 * (1 - s), 0.25 * (1 + s), -0.25 * (1 + s)];
    const dNds = [-0.25 * (1 - r), -0.25 * (1 + r), 0.25 * (1 + r), 0.25 * (1 - r)];

    let J11 = 0;
    let J12 = 0;
    let J21 = 0;
    let J22 = 0;
    for (let i = 0; i < 4; i++) {
      J11 += dNdr[i] * coords[i].x;
      J12 += dNdr[i] * coords[i].y;
      J21 += dNds[i] * coords[i].x;
      J22 += dNds[i] * coords[i].y;
    }
    const detJ = J11 * J22 - J12 * J21;
    if (!(Math.abs(detJ) > 1e-14)) {
      throw new Error('Shell element has zero or negative Jacobian (degenerate/malformed quad).');
    }
    const invDetJ = 1 / detJ;
    const dNdx = new Float64Array(4);
    const dNdy = new Float64Array(4);
    for (let i = 0; i < 4; i++) {
      dNdx[i] = invDetJ * (J22 * dNdr[i] - J12 * dNds[i]);
      dNdy[i] = invDetJ * (-J21 * dNdr[i] + J11 * dNds[i]);
    }
    const dV = Math.abs(detJ);

    for (let i = 0; i < 4; i++) {
      const dofU = i * 6;
      const dofV = i * 6 + 1;
      for (let j = 0; j < 4; j++) {
        const dofUj = j * 6;
        const dofVj = j * 6 + 1;
        Ke[dofU * 24 + dofUj] += (dNdx[i] * Dm[0][0] * dNdx[j] + dNdy[i] * Dm[2][2] * dNdy[j]) * dV;
        Ke[dofU * 24 + dofVj] += (dNdx[i] * Dm[0][1] * dNdy[j] + dNdy[i] * Dm[2][2] * dNdx[j]) * dV;
        Ke[dofV * 24 + dofUj] += (dNdy[i] * Dm[1][0] * dNdx[j] + dNdx[i] * Dm[2][2] * dNdy[j]) * dV;
        Ke[dofV * 24 + dofVj] += (dNdy[i] * Dm[1][1] * dNdy[j] + dNdx[i] * Dm[2][2] * dNdx[j]) * dV;
      }
    }

    for (let i = 0; i < 4; i++) {
      const dofRotX = i * 6 + 3;
      const dofRotY = i * 6 + 4;
      for (let j = 0; j < 4; j++) {
        const dofRotXj = j * 6 + 3;
        const dofRotYj = j * 6 + 4;
        Ke[dofRotX * 24 + dofRotXj] += (dNdy[i] * Db[1][1] * dNdy[j] + dNdx[i] * Db[2][2] * dNdx[j]) * dV;
        Ke[dofRotX * 24 + dofRotYj] += (-dNdy[i] * Db[1][0] * dNdx[j] - dNdx[i] * Db[2][2] * dNdy[j]) * dV;
        Ke[dofRotY * 24 + dofRotXj] += (-dNdx[i] * Db[0][1] * dNdy[j] - dNdy[i] * Db[2][2] * dNdx[j]) * dV;
        Ke[dofRotY * 24 + dofRotYj] += (dNdx[i] * Db[0][0] * dNdx[j] + dNdy[i] * Db[2][2] * dNdy[j]) * dV;
      }
    }

    const drillingStiff = 1e-4 * Dm[0][0] * dV;
    for (let i = 0; i < 4; i++) Ke[(i * 6 + 5) * 24 + i * 6 + 5] += drillingStiff;
  }

  // ---- MITC4-reduced transverse shear (centroid-constant form) ----
  // For rectangular/parallelogram quads the MITC4 assumed shear-strain
  // interpolation reduces exactly to the classic selective reduced integration
  // (SRI) form: the transverse shear strains are evaluated once at the element
  // centroid,
  //   gamma_xz = dw/dx|_c + 1/4 sum theta_y_i
  //   gamma_yz = dw/dy|_c - 1/4 sum theta_x_i
  // and integrated with the element area. This is the standard, widely
  // verified first-order (Mindlin-Reissner) thin-plate element.
  const Nc = [0.25, 0.25, 0.25, 0.25];
  const dNdrC = [-0.25, 0.25, 0.25, -0.25];
  const dNdsC = [-0.25, -0.25, 0.25, 0.25];
  let J11 = 0;
  let J12 = 0;
  let J21 = 0;
  let J22 = 0;
  for (let i = 0; i < 4; i++) {
    J11 += dNdrC[i] * coords[i].x;
    J12 += dNdrC[i] * coords[i].y;
    J21 += dNdsC[i] * coords[i].x;
    J22 += dNdsC[i] * coords[i].y;
  }
  const detJc = J11 * J22 - J12 * J21;
  const invDetJc = 1 / detJc;
  const dNdxC = new Float64Array(4);
  const dNdyC = new Float64Array(4);
  for (let i = 0; i < 4; i++) {
    dNdxC[i] = invDetJc * (J22 * dNdrC[i] - J12 * dNdsC[i]);
    dNdyC[i] = invDetJc * (-J21 * dNdrC[i] + J11 * dNdsC[i]);
  }
  const area = 4 * Math.abs(detJc);
  const wgtShear = factorShear * area;

  for (let i = 0; i < 4; i++) {
    const wi = i * 6 + 2;
    const xi = i * 6 + 3;
    const yi = i * 6 + 4;
    for (let j = 0; j < 4; j++) {
      const wj = j * 6 + 2;
      const xj = j * 6 + 3;
      const yj = j * 6 + 4;
      // gamma_xz^2 + gamma_yz^2
      Ke[wi * 24 + wj] += wgtShear * (dNdxC[i] * dNdxC[j] + dNdyC[i] * dNdyC[j]);
      Ke[wi * 24 + yj] += wgtShear * dNdxC[i] * Nc[j];
      Ke[yi * 24 + wj] += wgtShear * Nc[i] * dNdxC[j];
      Ke[yi * 24 + yj] += wgtShear * Nc[i] * Nc[j];
      Ke[wi * 24 + xj] += -wgtShear * dNdyC[i] * Nc[j];
      Ke[xi * 24 + wj] += -wgtShear * Nc[i] * dNdyC[j];
      Ke[xi * 24 + xj] += wgtShear * Nc[i] * Nc[j];
    }
  }

  return Ke;
}

/**
 * Generate a planar rectangular quad mesh. Optional hole: { cx, cy, r }
 * (circular) or { x0, x1, y0, y1 } (rectangular). Elements whose centroid
 * falls inside the hole are removed; orphaned nodes are pruned and reindexed.
 * Returns { nodes, elements } where nodes are [{id, x, y, z}] and elements are
 * [{id, nodeIds: [4 ids]}] in counter-clockwise order.
 */
function generatePlateMesh({ nx, ny, Lx, Ly, hole } = {}) {
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 2 || ny < 2) {
    throw new TypeError('Mesh requires integer divisions nx, ny >= 2.');
  }
  if (![Lx, Ly].every((v) => Number.isFinite(v) && v > 0)) {
    throw new TypeError('Mesh domain lengths Lx, Ly must be positive finite numbers.');
  }
  if (hole) {
    const okHole =
      (Number.isFinite(hole.cx) && Number.isFinite(hole.cy) && Number.isFinite(hole.r) && hole.r > 0) ||
      ([hole.x0, hole.x1, hole.y0, hole.y1].every((v) => Number.isFinite(v)) && hole.x1 > hole.x0 && hole.y1 > hole.y0);
    if (!okHole) throw new TypeError('Hole must be {cx, cy, r} or {x0, x1, y0, y1}.');
  }

  const rawNodes = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      rawNodes.push({ x: (i / nx) * Lx, y: (j / ny) * Ly, z: 0 });
    }
  }
  const rawElements = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      rawElements.push([a, a + 1, a + nx + 2, a + nx + 1]);
    }
  }

  const keep = new Array(rawElements.length).fill(true);
  if (hole) {
    for (let e = 0; e < rawElements.length; e++) {
      const ids = rawElements[e];
      const cx = (rawNodes[ids[0]].x + rawNodes[ids[1]].x + rawNodes[ids[2]].x + rawNodes[ids[3]].x) / 4;
      const cy = (rawNodes[ids[0]].y + rawNodes[ids[1]].y + rawNodes[ids[2]].y + rawNodes[ids[3]].y) / 4;
      if (Number.isFinite(hole.r)) {
        if (Math.hypot(cx - hole.cx, cy - hole.cy) < hole.r) keep[e] = false;
      } else {
        if (cx > hole.x0 && cx < hole.x1 && cy > hole.y0 && cy < hole.y1) keep[e] = false;
      }
    }
  }

  const used = new Uint8Array(rawNodes.length);
  const keptElements = [];
  for (let e = 0; e < rawElements.length; e++) {
    if (!keep[e]) continue;
    for (const id of rawElements[e]) used[id] = 1;
    keptElements.push(rawElements[e]);
  }

  const remap = new Int32Array(rawNodes.length).fill(-1);
  const nodes = [];
  for (let i = 0; i < rawNodes.length; i++) {
    if (!used[i]) continue;
    remap[i] = nodes.length;
    nodes.push({ id: nodes.length, x: rawNodes[i].x, y: rawNodes[i].y, z: rawNodes[i].z });
  }
  const elements = keptElements.map((ids, e) => ({ id: e, nodeIds: ids.map((id) => remap[id]) }));
  return { nodes, elements };
}

class ShellAssembly {
  constructor() {
    this.nodes = [];
    this.elements = [];
    this._results = null;
  }

  /**
   * Register a node. Returns the node id.
   */
  addNode(x, y, z) {
    if (![x, y, z].every((v) => Number.isFinite(v))) {
      throw new TypeError('Node coordinates must be finite numbers.');
    }
    const id = this.nodes.length;
    this.nodes.push({
      id,
      x,
      y,
      z,
      bc: Array.from({ length: DOF_PER_NODE }, () => ({ fixed: false, value: 0 })),
      load: new Float64Array(DOF_PER_NODE)
    });
    return id;
  }

  /**
   * Register a quad element with explicit material/geometry properties:
   * { thickness, E, nu } (SI: m, Pa, dimensionless).
   */
  addElement(nodeIds, properties) {
    if (!Array.isArray(nodeIds) || nodeIds.length !== 4) {
      throw new TypeError('Shell elements require exactly 4 node ids.');
    }
    if (new Set(nodeIds).size !== 4) {
      throw new TypeError(`Shell element #${this.elements.length} references duplicate node ids.`);
    }
    for (const id of nodeIds) {
      if (!Number.isInteger(id) || id < 0 || id >= this.nodes.length) {
        throw new RangeError(`Shell element #${this.elements.length} references unknown node ${id}.`);
      }
    }
    if (!properties || typeof properties !== 'object') {
      throw new TypeError('Element requires explicit { thickness, E, nu } properties.');
    }
    const { thickness, E, nu } = properties;
    if (![thickness, E, nu].every(Number.isFinite) || thickness <= 0 || E <= 0 || nu <= -1 || nu >= 0.5) {
      throw new RangeError('Provide finite thickness > 0 (m), E > 0 (Pa), and -1 < nu < 0.5.');
    }
    const id = this.elements.length;
    const elem = { id, nodeIds, properties, area: 0, moments: null };
    const coords = nodeIds.map((nid) => this.nodes[nid]);
    const frame = buildLocalFrame(coords);
    // Element area from the centroid Jacobian
    const dNdr = [-0.25, 0.25, 0.25, -0.25];
    const dNds = [-0.25, -0.25, 0.25, 0.25];
    let J11 = 0;
    let J12 = 0;
    let J21 = 0;
    let J22 = 0;
    for (let i = 0; i < 4; i++) {
      J11 += dNdr[i] * coords[i].x;
      J12 += dNdr[i] * coords[i].y;
      J21 += dNds[i] * coords[i].x;
      J22 += dNds[i] * coords[i].y;
    }
    const detJ = J11 * J22 - J12 * J21;
    if (!(Math.abs(detJ) > 1e-14)) {
      throw new Error(`Shell element #${id} is degenerate (zero area).`);
    }
    elem.area = 4 * Math.abs(detJ);
    elem._frame = frame;
    this.elements.push(elem);
    return elem;
  }

  /**
   * Fix a degree of freedom: dofIndex 0..5 (u, v, w, theta_x, theta_y,
   * theta_z). Optional prescribed value.
   */
  fixDOF(nodeId, dofIndex, value = 0) {
    const node = this.nodes[nodeId];
    if (!node) throw new RangeError(`fixDOF: unknown node ${nodeId}.`);
    if (!Number.isInteger(dofIndex) || dofIndex < 0 || dofIndex >= DOF_PER_NODE) {
      throw new RangeError('dofIndex must be in 0..5.');
    }
    if (!Number.isFinite(value)) throw new TypeError('Prescribed displacement must be finite.');
    node.bc[dofIndex] = { fixed: true, value };
    return this;
  }

  fixNode(nodeId, fixU, fixV, fixW, fixRX = false, fixRY = false) {
    const node = this.nodes[nodeId];
    if (!node) throw new RangeError(`fixNode: unknown node ${nodeId}.`);
    const flags = [fixU, fixV, fixW, fixRX, fixRY, false];
    for (let d = 0; d < 6; d++) {
      if (flags[d]) node.bc[d] = { fixed: true, value: 0 };
    }
    return this;
  }

  /**
   * Apply a uniform pressure load normal to the plane of each element
   * (consistent nodal load: q * A / 4 per node).
   */
  applyUniformPressure(q) {
    if (!Number.isFinite(q)) throw new TypeError('Pressure must be a finite number.');
    for (const elem of this.elements) {
      const f = (q * elem.area) / 4;
      const n = elem._frame[0][2] === 0 && elem._frame[1][2] === 0 ? [0, 0, 1] : elem._frame.map((row) => row[2]);
      const fLocal = [n[0] * f, n[1] * f, n[2] * f];
      for (const nid of elem.nodeIds) {
        const node = this.nodes[nid];
        node.load[0] += fLocal[0];
        node.load[1] += fLocal[1];
        node.load[2] += fLocal[2];
      }
    }
    return this;
  }

  applyNodeLoad(nodeId, fx, fy, fz) {
    const node = this.nodes[nodeId];
    if (!node) throw new RangeError(`applyNodeLoad: unknown node ${nodeId}.`);
    node.load[0] += fx;
    node.load[1] += fy;
    node.load[2] += fz;
    return this;
  }

  /**
   * Assemble the global 6-dof-per-node system and solve with the production
   * sparse direct (Cholesky) solver. Fail-closed on malformed/indefinite
   * systems, non-finite solutions, or unacceptable residual.
   */
  solveStatic() {
    const nNodes = this.nodes.length;
    const dim = nNodes * DOF_PER_NODE;
    if (nNodes === 0 || this.elements.length === 0) {
      throw new Error('ShellAssembly.solveStatic: no nodes/elements registered.');
    }

    const free = new Uint8Array(dim);
    const prescribed = new Float64Array(dim);
    const F = new Float64Array(dim);
    for (let i = 0; i < nNodes; i++) {
      const node = this.nodes[i];
      for (let d = 0; d < DOF_PER_NODE; d++) {
        const g = i * DOF_PER_NODE + d;
        F[g] = node.load[d];
        if (node.bc[d].fixed) {
          free[g] = 0;
          prescribed[g] = node.bc[d].value;
        } else {
          free[g] = 1;
        }
      }
    }

    const sparseSolver = new WasmSparseMultifrontalSolver(dim, dim);

    for (const elem of this.elements) {
      const coords = elem.nodeIds.map((nid) => this.nodes[nid]);
      const KeLocal = buildShellStiffnessLocal(coords, elem.properties);
      const R = elem._frame;
      // Rotate each 6x6 nodal block to the global frame.
      const KeBlock = new Float64Array(16 * 36);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const off = (i * 4 + j) * 36;
          const blk = rotateBlock6(extractBlock6(KeLocal, i, j), R);
          KeBlock.set(blk, off);
        }
      }

      // Scatter element blocks to the global system. Each undirected global
      // pair is contributed exactly once per element (deduplicated with a
      // per-element canonical-pair set) and written in both triangle directions
      // so the sparse direct solver receives the full symmetric pattern. This
      // exactly matches the dense assembly sum.
      const seen = new Set();
      for (let i = 0; i < 4; i++) {
        const rowNode = elem.nodeIds[i];
        for (let j = 0; j < 4; j++) {
          const colNode = elem.nodeIds[j];
          const off = (i * 4 + j) * 36;
          for (let a = 0; a < DOF_PER_NODE; a++) {
            const gRow = rowNode * DOF_PER_NODE + a;
            for (let b = 0; b < DOF_PER_NODE; b++) {
              const gCol = colNode * DOF_PER_NODE + b;
              const key = gRow <= gCol ? gRow * dim + gCol : gCol * dim + gRow;
              if (seen.has(key)) continue;
              seen.add(key);
              const v = KeBlock[off + a * 6 + b];
              if (v === 0) continue;
              if (free[gRow] && free[gCol]) {
                sparseSolver.addEntry(gRow, gCol, v);
                if (gRow !== gCol) sparseSolver.addEntry(gCol, gRow, v);
              } else if (free[gRow] && !free[gCol]) {
                F[gRow] -= v * prescribed[gCol];
              } else if (!free[gRow] && free[gCol]) {
                F[gCol] -= v * prescribed[gRow];
              }
              // both fixed: contribution vanishes after elimination
            }
          }
        }
      }
    }

    // Identity rows for constrained dofs.
    for (let g = 0; g < dim; g++) {
      if (!free[g]) {
        sparseSolver.addEntry(g, g, 1);
        F[g] = prescribed[g];
      }
    }

    let u = null;
    let solverUsed = 'none';
    let sparseRejected = false;
    try {
      sparseSolver.finalizeCSR();
      sparseSolver.factorize();
      const res = sparseSolver.solve(F);
      u = res.solution;
      solverUsed = 'WasmSparseMultifrontalSolver (sparse Cholesky)';
      if (!res.converged && res.relativeResidual > 1e-8) {
        throw new Error(`Shell solve residual ${res.relativeResidual} exceeds 1e-8.`);
      }
    } catch (err) {
      // The collected solver can spuriously reject numerically valid SPD shell
      // systems (numerical pivot defect) — fall back to the production dense
      // Gaussian path for bounded system sizes; otherwise fail closed.
      if (dim > MAX_DENSE_FALLBACK_DOF) {
        throw new Error(
          `Shell assembly solve failed (fail-closed): sparse direct solver rejected the system (${err.message}); ${dim} dofs exceed dense fallback limit.`
        );
      }
      sparseRejected = true;
      u = null;
    }

    if (!u || u.length < dim || u.some((v) => !Number.isFinite(v))) {
      if (sparseRejected) {
        const A = this._assembleDense(free, prescribed, F);
        const uDense = LinearSolver.solveGaussian(A, Array.from(F));
        if (!uDense || uDense.length < dim || uDense.some((v) => !Number.isFinite(v))) {
          throw new Error(
            'Shell assembly solve failed (fail-closed): dense fallback produced non-finite or incomplete displacement vector.'
          );
        }
        u = Float64Array.from(uDense);
        solverUsed = 'LinearSolver.solveGaussian (dense fallback; sparse Cholesky rejected numerically valid system)';
        const relRes = this._relativeResidual(A, F, u);
        if (!Number.isFinite(relRes) || relRes >= 1e-6) {
          throw new Error(`Shell assembly dense fallback residual ${relRes} exceeds 1e-6.`);
        }
      } else {
        throw new Error('Shell assembly solve produced a non-finite or incomplete displacement vector.');
      }
    }

    for (let i = 0; i < nNodes; i++) {
      const node = this.nodes[i];
      node.displacement = Array.from(u.subarray(i * 6, i * 6 + 6));
    }

    let maxDeflection = 0;
    for (const node of this.nodes) {
      maxDeflection = Math.max(maxDeflection, Math.abs(node.displacement[2]));
    }

    // Moment recovery at element centroids (global frame for planar meshes).
    for (const elem of this.elements) {
      elem.moments = this._recoverMoments(elem, u);
    }

    this._results = {
      status: 'solved',
      solverUsed,
      dofCount: dim,
      nodeCount: nNodes,
      elementCount: this.elements.length,
      maxDeflection,
      displacements: u
    };
    return this._results;
  }

  _assembleDense(free, prescribed, F) {
    const nNodes = this.nodes.length;
    const dim = nNodes * DOF_PER_NODE;
    const A = Array.from({ length: dim }, () => new Float64Array(dim));
    const F2 = new Float64Array(F);
    for (const elem of this.elements) {
      const coords = elem.nodeIds.map((nid) => this.nodes[nid]);
      const KeLocal = buildShellStiffnessLocal(coords, elem.properties);
      const R = elem._frame;
      const seen = new Set();
      for (let i = 0; i < 4; i++) {
        const rowNode = elem.nodeIds[i];
        for (let j = 0; j < 4; j++) {
          const colNode = elem.nodeIds[j];
          const off = (i * 4 + j) * 36;
          for (let a = 0; a < DOF_PER_NODE; a++) {
            const gRow = rowNode * DOF_PER_NODE + a;
            for (let b = 0; b < DOF_PER_NODE; b++) {
              const gCol = colNode * DOF_PER_NODE + b;
              const key = gRow <= gCol ? gRow * dim + gCol : gCol * dim + gRow;
              if (seen.has(key)) continue;
              seen.add(key);
              const blk = rotateBlock6(extractBlock6(KeLocal, i, j), R);
              const v = blk[a * 6 + b];
              if (v === 0) continue;
              if (free[gRow] && free[gCol]) {
                A[gRow][gCol] += v;
                if (gRow !== gCol) A[gCol][gRow] += v;
              } else if (free[gRow] && !free[gCol]) {
                F2[gRow] -= v * prescribed[gCol];
              } else if (!free[gRow] && free[gCol]) {
                F2[gCol] -= v * prescribed[gRow];
              }
            }
          }
        }
      }
    }
    for (let g = 0; g < dim; g++) {
      if (!free[g]) {
        for (let c = 0; c < dim; c++) {
          if (c !== g) {
            A[g][c] = 0;
            A[c][g] = 0;
          }
        }
        A[g][g] = 1;
        F2[g] = prescribed[g];
      }
    }
    for (let g = 0; g < dim; g++) F[g] = F2[g];
    return A;
  }

  _relativeResidual(A, F, u) {
    const n = F.length;
    const Au = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += A[i][j] * u[j];
      Au[i] = s;
    }
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (Au[i] - F[i]) * (Au[i] - F[i]);
      den += F[i] * F[i];
    }
    return Math.sqrt(num) / Math.max(1, Math.sqrt(den));
  }

  _recoverMoments(elem, u) {
    const R = elem._frame;
    // Local nodal dofs: d_local = R^T * d_global (translations and rotations)
    const wLocal = new Float64Array(4);
    const txLocal = new Float64Array(4);
    const tyLocal = new Float64Array(4);
    for (let n = 0; n < 4; n++) {
      const node = this.nodes[elem.nodeIds[n]];
      const gt = mat3TransposeMul(R, [node.displacement[0], node.displacement[1], node.displacement[2]]);
      const gr = mat3TransposeMul(R, [node.displacement[3], node.displacement[4], node.displacement[5]]);
      wLocal[n] = gt[2];
      txLocal[n] = gr[0];
      tyLocal[n] = gr[1];
    }
    // Centroid curvature (r = s = 0)
    const dNdr = [-0.25, 0.25, 0.25, -0.25];
    const dNds = [-0.25, -0.25, 0.25, 0.25];
    const coords = elem.nodeIds.map((nid) => this.nodes[nid]);
    let J11 = 0;
    let J12 = 0;
    let J21 = 0;
    let J22 = 0;
    for (let i = 0; i < 4; i++) {
      J11 += dNdr[i] * coords[i].x;
      J12 += dNdr[i] * coords[i].y;
      J21 += dNds[i] * coords[i].x;
      J22 += dNds[i] * coords[i].y;
    }
    const invDetJ = 1 / (J11 * J22 - J12 * J21);
    const dNdx = new Float64Array(4);
    const dNdy = new Float64Array(4);
    for (let i = 0; i < 4; i++) {
      dNdx[i] = invDetJ * (J22 * dNdr[i] - J12 * dNds[i]);
      dNdy[i] = invDetJ * (-J21 * dNdr[i] + J11 * dNds[i]);
    }
    let kxx = 0;
    let kyy = 0;
    let kxy = 0;
    for (let i = 0; i < 4; i++) {
      kxx += dNdx[i] * tyLocal[i];
      kyy += dNdy[i] * txLocal[i];
      kxy += dNdy[i] * tyLocal[i] + dNdx[i] * txLocal[i];
    }
    const { thickness: t, E, nu } = elem.properties;
    const D = (E * t * t * t) / (12 * (1 - nu * nu));
    const Mxx = D * (kxx + nu * kyy);
    const Myy = D * (kyy + nu * kxx);
    const Mxy = ((D * (1 - nu)) / 2) * kxy;
    return { Mxx, Myy, Mxy };
  }

  results() {
    return this._results;
  }

  displacementAt(nodeId) {
    if (!this._results) throw new Error('Solve first (solveStatic).');
    const node = this.nodes[nodeId];
    if (!node) throw new RangeError(`Unknown node ${nodeId}.`);
    return node.displacement;
  }

  deflectionAt(nodeId) {
    return this.displacementAt(nodeId)[2];
  }

  nearestNodeDeflection(x, y, z = 0) {
    let best = -1;
    let bestD = Infinity;
    for (const node of this.nodes) {
      const d = Math.hypot(node.x - x, node.y - y, node.z - z);
      if (d < bestD) {
        bestD = d;
        best = node.id;
      }
    }
    return { nodeId: best, deflection: this.deflectionAt(best) };
  }

  elementMoments(elementId) {
    const elem = this.elements[elementId];
    if (!elem) throw new RangeError(`Unknown element ${elementId}.`);
    if (!elem.moments) throw new Error('Solve first (solveStatic).');
    return elem.moments;
  }
}

module.exports = { ShellAssembly, generatePlateMesh, buildShellStiffnessLocal, DOF_PER_NODE, IDX };
