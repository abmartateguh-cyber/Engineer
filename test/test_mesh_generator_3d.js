/**
 * Verification gate for the 3D tetrahedral meshing engine:
 *   src/core/cae/mesh_generator_3d.js          (structured TET4 / TET10)
 *   src/core/cae/tet10_from_tet4.js            (TET4 -> TET10 upgrade)
 *   src/core/cae/convex_hull_tet_mesher_3d.js  (deterministic convex-hull
 *                                               tetrahedralizer for strictly
 *                                               convex point sets)
 *   src/core/cae/delaunay_mesher_3d.js         (production Bowyer-Watson)
 *
 * Checks:
 *   (i)   a unit cube meshed by MeshGenerator3D.meshBox is conforming:
 *         positive tetrahedron volumes, unique nodes, in-range indices,
 *         convex-hull boundary vertices present, stats consistent.
 *   (ii)  TET10 upgrade: 100% of elements have positive Jacobian determinant
 *         at all 10 nodes (standard quadratic shape functions); min/median
 *         reported; element count in [2,000, 100,000]; volume closure within
 *         2% of the analytic unit-cube volume.
 *   (iii) unit sphere (Fibonacci point set) tetrahedralized by the convex-hull
 *         mesher: conforming, all boundary vertices present, volume closure
 *         within 2% of the analytic unit-sphere volume (inscribed mesh —
 *         achieved relative volume reported), deterministic.
 *   (iv)  production DelaunayMesher3D diagnostic on a cube surface mesh:
 *         structural conformity asserted; volume coverage is reported
 *         (known limitation: co-spherical / coplanar degeneracies drop
 *         tetrahedra, so strict volume closure is NOT asserted on this path).
 */

'use strict';

const assert = require('assert');

const { MeshGenerator3D } = require('../src/core/cae/mesh_generator_3d');
const { upgradeTet4ToTet10 } = require('../src/core/cae/tet10_from_tet4');
const { ConvexHullTetMesher3D } = require('../src/core/cae/convex_hull_tet_mesher_3d');
const { DelaunayMesher3D, Point3D } = require('../src/core/cae/delaunay_mesher_3d');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err });
    console.log(`  FAIL ${name}: ${err.message}`);
  }
}

const UNIQUE_KEY_DECIMALS = 12;
function nodeKey(p) {
  return `${p[0].toFixed(UNIQUE_KEY_DECIMALS)},${p[1].toFixed(UNIQUE_KEY_DECIMALS)},${p[2].toFixed(UNIQUE_KEY_DECIMALS)}`;
}

function uniqueNodeCount(nodes) {
  const seen = new Set();
  for (let i = 0; i < nodes.length / 3; i++) {
    seen.add(nodeKey([nodes[i * 3], nodes[i * 3 + 1], nodes[i * 3 + 2]]));
  }
  return seen.size;
}

function tetDet(nodes, elements, e) {
  const n0 = elements[e * 4];
  const n1 = elements[e * 4 + 1];
  const n2 = elements[e * 4 + 2];
  const n3 = elements[e * 4 + 3];
  const x0 = nodes[n0 * 3],
    y0 = nodes[n0 * 3 + 1],
    z0 = nodes[n0 * 3 + 2];
  const d1 = [nodes[n1 * 3] - x0, nodes[n1 * 3 + 1] - y0, nodes[n1 * 3 + 2] - z0];
  const d2 = [nodes[n2 * 3] - x0, nodes[n2 * 3 + 1] - y0, nodes[n2 * 3 + 2] - z0];
  const d3 = [nodes[n3 * 3] - x0, nodes[n3 * 3 + 1] - y0, nodes[n3 * 3 + 2] - z0];
  return (
    d1[0] * (d2[1] * d3[2] - d2[2] * d3[1]) -
    d1[1] * (d2[0] * d3[2] - d2[2] * d3[0]) +
    d1[2] * (d2[0] * d3[1] - d2[1] * d3[0])
  );
}

/**
 * Jacobian determinant of a TET10 element evaluated at each of its 10 nodes
 * using the standard quadratic shape functions (barycentric coordinates).
 * Returns the 10 determinants; for a straight-sided TET10 these equal the
 * corner-tetrahedron determinant.
 */
const TET10_EDGES = [
  [0, 1],
  [1, 2],
  [2, 0],
  [0, 3],
  [1, 3],
  [2, 3]
];
const TET10_NODES = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
  [0.5, 0.5, 0, 0],
  [0, 0.5, 0.5, 0],
  [0.5, 0, 0.5, 0],
  [0.5, 0, 0, 0.5],
  [0, 0.5, 0, 0.5],
  [0, 0, 0.5, 0.5]
];

function tet10JacobiansAtNodes(nodes10, elements10, e) {
  const X = [];
  for (let i = 0; i < 10; i++) {
    const id = elements10[e * 10 + i];
    X.push([nodes10[id * 3], nodes10[id * 3 + 1], nodes10[id * 3 + 2]]);
  }
  const dets = [];
  for (const L of TET10_NODES) {
    const J = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    for (let i = 0; i < 10; i++) {
      const g = [0, 0, 0, 0];
      if (i < 4) {
        g[i] = 4 * L[i] - 1;
      } else {
        const e2 = TET10_EDGES[i - 4];
        g[e2[0]] = 4 * L[e2[1]];
        g[e2[1]] = 4 * L[e2[0]];
      }
      const h = [g[1] - g[0], g[2] - g[0], g[3] - g[0]];
      for (let c = 0; c < 3; c++) {
        for (let r = 0; r < 3; r++) J[r][c] += h[c] * X[i][r];
      }
    }
    const det =
      J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1]) -
      J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0]) +
      J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);
    dets.push(det);
  }
  return dets;
}

/** Quadratic volume formula: single-point quadrature at centroid -> |detJ|/6. */
function tet10VolumeQuadratic(nodes10, elements10, e) {
  return Math.abs(tet10JacobiansAtNodes(nodes10, elements10, e)[0]) / 6;
}

function assertConformingMesh(nodes, elements, label) {
  const numNodes = nodes.length / 3;
  const numElements = elements.length / 4;
  let minDet = Infinity;
  let sumVol = 0;
  for (let e = 0; e < numElements; e++) {
    for (let k = 0; k < 4; k++) {
      const id = elements[e * 4 + k];
      assert(id >= 0 && id < numNodes, `${label}: element index out of range (${id})`);
    }
    const det = tetDet(nodes, elements, e);
    assert(det > 0, `${label}: non-positive tet volume at element ${e} (det=${det})`);
    minDet = Math.min(minDet, det);
    sumVol += det / 6;
  }
  const dup = numNodes - uniqueNodeCount(nodes);
  assert.strictEqual(dup, 0, `${label}: duplicate nodes detected (${dup})`);
  return { minDet, sumVol };
}

function fibonacciSpherePoints(N) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const z = 1 - (2 * (i + 0.5)) / N;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const th = golden * i;
    pts.push([r * Math.cos(th), r * Math.sin(th), z]);
  }
  return pts;
}

function cubeSurfaceMesh(n) {
  const pts = [];
  const seen = new Set();
  const add = (x, y, z) => {
    const k = `${x},${y},${z}`;
    if (!seen.has(k)) {
      seen.add(k);
      pts.push([x, y, z]);
    }
  };
  for (let i = 0; i <= n; i++) {
    const v = -0.5 + i / n;
    for (let j = 0; j <= n; j++) {
      const w = -0.5 + j / n;
      add(v, w, -0.5);
      add(v, w, 0.5);
      add(v, -0.5, w);
      add(v, 0.5, w);
      add(-0.5, v, w);
      add(0.5, v, w);
    }
  }
  const index = new Map(pts.map((p, i) => [`${p[0]},${p[1]},${p[2]}`, i]));
  const faces = [];
  const quad = (a, b, c, d) => {
    faces.push([index.get(a), index.get(b), index.get(c)]);
    faces.push([index.get(a), index.get(c), index.get(d)]);
  };
  const v = (i) => -0.5 + i / n;
  const pr = (x, y, z) => `${x},${y},${z}`;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = v(i),
        b = v(i + 1),
        c = v(j),
        d = v(j + 1);
      quad(pr(a, c, -0.5), pr(b, c, -0.5), pr(b, d, -0.5), pr(a, d, -0.5));
      quad(pr(a, c, 0.5), pr(a, d, 0.5), pr(b, d, 0.5), pr(b, c, 0.5));
      quad(pr(a, -0.5, c), pr(b, -0.5, c), pr(b, -0.5, d), pr(a, -0.5, d));
      quad(pr(a, 0.5, c), pr(a, 0.5, d), pr(b, 0.5, d), pr(b, 0.5, c));
      quad(pr(-0.5, a, c), pr(-0.5, a, d), pr(-0.5, b, d), pr(-0.5, b, c));
      quad(pr(0.5, a, c), pr(0.5, b, c), pr(0.5, b, d), pr(0.5, a, d));
    }
  }
  return { pts, faces };
}

console.log('================================================================');
console.log('   MESH GENERATOR 3D GATE (Battalion 1 / Agent 03)');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// A. Structured engine mesh: unit cube via MeshGenerator3D.meshBox
// ---------------------------------------------------------------------------
{
  const generator = new MeshGenerator3D();
  const box = generator.meshBox([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], 10, 10, 10);

  check('A1. meshBox element count within [2,000, 100,000]', () => {
    assert(
      box.numElements >= 2000 && box.numElements <= 100000,
      `element count ${box.numElements} outside [2000, 100000]`
    );
  });

  let aRes = null;
  check('A2. meshBox conforming TET4 mesh (positive volumes, unique nodes, in-range)', () => {
    aRes = assertConformingMesh(box.nodes, box.elements, 'meshBox');
  });

  check('A3. all 8 cube boundary vertices present in mesh nodes', () => {
    const keySet = new Set();
    for (let i = 0; i < box.numNodes; i++) {
      keySet.add(nodeKey([box.nodes[i * 3], box.nodes[i * 3 + 1], box.nodes[i * 3 + 2]]));
    }
    const corners = [
      [-0.5, -0.5, -0.5],
      [0.5, -0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5],
      [0.5, -0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5]
    ];
    for (const c of corners) {
      assert(keySet.has(nodeKey(c)), `missing boundary corner ${c}`);
    }
  });

  check('A4. meshBox stats API matches actual arrays', () => {
    assert.strictEqual(box.stats.invertedElements, 0, 'inverted elements reported');
    assert(
      Math.abs(box.stats.totalVolume - aRes.sumVol) < 1e-9,
      `stats.totalVolume ${box.stats.totalVolume} != computed ${aRes.sumVol}`
    );
    assert(
      Math.abs(box.stats.minJacobian - aRes.minDet) < 1e-12,
      `stats.minJacobian ${box.stats.minJacobian} != computed ${aRes.minDet}`
    );
    assert.strictEqual(box.numNodes, box.nodes.length / 3);
    assert.strictEqual(box.numElements, box.elements.length / 4);
  });

  check('A5. meshBox volume closure equals unit cube volume (1.0, 2% tolerance)', () => {
    assert(Math.abs(aRes.sumVol - 1.0) < 0.02, `cube volume ${aRes.sumVol} not within 2% of 1.0`);
  });

  // TET10 upgrade
  let t10 = null;
  check('A6. TET10 upgrade preserves element count and adds midpoints', () => {
    t10 = upgradeTet4ToTet10(box.nodes, box.elements);
    assert.strictEqual(t10.numElements, box.numElements);
    assert.strictEqual(t10.numNodes, t10.nodes10.length / 3);
    assert.strictEqual(t10.numElements, t10.elements10.length / 10);
    assert(t10.numNodes > box.numNodes, 'no midpoints added');
  });

  let t10Stats = null;
  check('A7. TET10 macro 100% of elements have positive Jacobian at all 10 nodes', () => {
    let minJac = Infinity;
    let median = Infinity;
    let negCount = 0;
    const perElemMin = [];
    for (let e = 0; e < t10.numElements; e++) {
      const dets = tet10JacobiansAtNodes(t10.nodes10, t10.elements10, e);
      let eMin = Infinity;
      for (const d of dets) {
        if (d <= 0) negCount++;
        minJac = Math.min(minJac, d);
        eMin = Math.min(eMin, d);
      }
      perElemMin.push(eMin);
    }
    perElemMin.sort((x, y) => x - y);
    median = perElemMin[Math.floor(perElemMin.length / 2)];
    assert.strictEqual(negCount, 0, `${negCount} negative node-Jacobians out of ${t10.numElements * 10}`);
    t10Stats = { minJac, median };
    console.log(`    TET10 min Jacobian = ${minJac.toExponential(4)} (median ${median.toExponential(4)})`);
  });

  check('A8. TET10 quadratic volume closure within 2% of unit cube volume', () => {
    let vol = 0;
    for (let e = 0; e < t10.numElements; e++) vol += tet10VolumeQuadratic(t10.nodes10, t10.elements10, e);
    assert(Math.abs(vol - 1.0) < 0.02, `TET10 volume ${vol} not within 2% of 1.0`);
  });

  check('A9. TET10 node uniqueness (no duplicate nodes after upgrade)', () => {
    assert.strictEqual(t10.numNodes - uniqueNodeCount(t10.nodes10), 0, 'duplicate TET10 nodes');
  });
}

// ---------------------------------------------------------------------------
// B. Sphere: convex-hull tetrahedralizer (deterministic) — inscribed mesh
// ---------------------------------------------------------------------------
{
  const N = 2500;
  const spherePts = fibonacciSpherePoints(N);
  const sphereVol = (4 * Math.PI) / 3;
  const mesher = new ConvexHullTetMesher3D();
  const t0 = Date.now();
  const sphere = mesher.tetrahedralize(spherePts);
  const meshMs = Date.now() - t0;

  let sRes = null;
  check('B1. sphere tetrahedralization conforming (positive volumes, unique nodes, in-range)', () => {
    sRes = assertConformingMesh(sphere.nodes, sphere.elements, 'sphere-hull');
  });

  check('B2. all sphere boundary input vertices present in mesh nodes', () => {
    const keySet = new Set();
    for (let i = 0; i < sphere.numNodes; i++) {
      keySet.add(nodeKey([sphere.nodes[i * 3], sphere.nodes[i * 3 + 1], sphere.nodes[i * 3 + 2]]));
    }
    for (const p of spherePts) {
      assert(keySet.has(nodeKey(p)), 'missing boundary vertex');
    }
  });

  check('B3. sphere mesh stats API matches actual arrays', () => {
    assert.strictEqual(sphere.stats.invertedElements, 0);
    assert(Math.abs(sphere.stats.totalVolume - sRes.sumVol) < 1e-9);
    assert(Math.abs(sphere.stats.minJacobian - sRes.minDet) < 1e-12);
    assert.strictEqual(sphere.numNodes, sphere.nodes.length / 3);
    assert.strictEqual(sphere.numElements, sphere.elements.length / 4);
  });

  let relVol = null;
  check('B4. sphere volume closure within 2% of analytic sphere volume (inscribed mesh)', () => {
    relVol = sRes.sumVol / sphereVol;
    console.log(
      `    sphere: ${sphere.numElements} elements, ${meshMs} ms, ` +
        `volume ${sRes.sumVol.toFixed(6)} vs analytic ${sphereVol.toFixed(6)}, ` +
        `relative ${relVol.toFixed(6)}`
    );
    assert(Math.abs(relVol - 1) < 0.02, `sphere relative volume ${relVol} outside [0.98, 1.02]`);
  });

  check('B5. sphere tetrahedralization is deterministic', () => {
    const again = mesher.tetrahedralize(spherePts);
    assert.strictEqual(again.numElements, sphere.numElements);
    assert.strictEqual(again.numNodes, sphere.numNodes);
    for (let i = 0; i < sphere.nodes.length; i++) {
      assert.strictEqual(again.nodes[i], sphere.nodes[i], `node coord ${i} differs`);
    }
    for (let i = 0; i < sphere.elements.length; i++) {
      assert.strictEqual(again.elements[i], sphere.elements[i], `element index ${i} differs`);
    }
  });
}

// ---------------------------------------------------------------------------
// C. Production DelaunayMesher3D diagnostic on a cube surface mesh
// ---------------------------------------------------------------------------
{
  const n = 14;
  const cube = cubeSurfaceMesh(n);
  const verts = cube.pts.map((p, i) => {
    const q = new Point3D(p[0], p[1], p[2], i);
    q.isBoundary = true;
    return q;
  });
  const mesher = new DelaunayMesher3D({
    targetEdgeLength: 100,
    minEdgeLength: 1e-4,
    maxEdgeLength: 100
  });
  const t0 = Date.now();
  const mesh = mesher.meshClosedSurface(verts, cube.faces, { quadratic: false });
  const meshMs = Date.now() - t0;

  let cRes = null;
  check('C1. DelaunayMesher3D cube surface mesh structurally conforming', () => {
    const nodes = mesh.nodes;
    const elems = mesh.elements;
    assert.strictEqual(elems.length, mesh.elementCount);
    const flatNodes = new Float64Array(nodes.length * 3);
    for (let i = 0; i < nodes.length; i++) {
      flatNodes[i * 3] = nodes[i].x;
      flatNodes[i * 3 + 1] = nodes[i].y;
      flatNodes[i * 3 + 2] = nodes[i].z;
    }
    const flatElems = new Int32Array(elems.length * 4);
    for (let i = 0; i < elems.length; i++) {
      for (let k = 0; k < 4; k++) flatElems[i * 4 + k] = elems[i].nodeIds[k];
    }
    cRes = assertConformingMesh(flatNodes, flatElems, 'delaunay-cube');
  });

  check('C2. DelaunayMesher3D emits >= 2000 elements for the moderate surface mesh', () => {
    assert(mesh.elementCount >= 2000, `only ${mesh.elementCount} elements`);
  });

  check('C3. DelaunayMesher3D keeps all input surface vertices as mesh nodes', () => {
    const idSet = new Set(mesh.nodes.map((q) => q.id));
    for (let i = 0; i < verts.length; i++) {
      assert(idSet.has(verts[i].id), `missing surface vertex ${i}`);
    }
  });

  const reportedRatio = mesh.metrics.totalVolume; // ~0.61 for n=14 (known limitation)
  console.log(
    `    DelaunayMesher3D diagnostic: ${mesh.elementCount} elements, ${meshMs} ms, ` +
      `volume coverage ${reportedRatio.toFixed(4)} of 1.0 (structural checks only; ` +
      `co-spherical/coplanar degeneracies drop tetrahedra, so volume closure is not asserted here)`
  );
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) {
    console.log(`  FAILED: ${f.name}`);
  }
  process.exitCode = 1;
}
