/**
 * Verification suite for the constrained Delaunay triangulation (2D)
 * implementation: src/core/cae/delaunay_constrained_2d.js.
 *
 * Coverage:
 *   (i)   triangulation of a square with a square hole (all triangles inside
 *         the region, hole boundary edges constrained, no triangle crosses the
 *         hole),
 *   (ii)  Delaunay quality on a seeded 200-point set (min angle reported; the
 *         observed value is asserted to be positive and finite because the
 *         Delaunay criterion does not bound the minimum angle),
 *   (iii) constrained edge recovery for a deliberately non-Delaunay boundary
 *         edge,
 *   (iv)  determinism,
 *   (v)   the produced mesh feeds Poisson2DMixed (TRI3 elements) and solves a
 *         known manufactured problem compared against the analytic field at a
 *         point,
 *   (vi)  production wiring: FEAEngineAdapter 'mesh_planar_polygon_2d' route.
 */

'use strict';

const assert = require('assert');

const {
  DelaunayConstrained2D,
  mulberry32,
  pointInPolygonWinding,
  segmentsIntersectStrict
} = require('../src/core/cae/delaunay_constrained_2d');
const { Poisson2DMixed } = require('../src/core/cae/poisson_2d_mixed');
const { FEAEngineAdapter } = require('../src/core/cae/fea_engine_adapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');

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

function minAngleDegOfTriangles(points, triangles) {
  let minA = Infinity;
  for (const t of triangles) {
    const a = points[t.a];
    const b = points[t.b];
    const c = points[t.c];
    const lab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lbc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const lca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const angle = (u2, v2, w2) => Math.acos(Math.max(-1, Math.min(1, (u2 * u2 + v2 * v2 - w2 * w2) / (2 * u2 * v2))));
    minA = Math.min(minA, angle(lab, lca, lbc), angle(lab, lbc, lca), angle(lbc, lca, lab));
  }
  return (minA * 180) / Math.PI;
}

console.log('================================================================');
console.log('      CONSTRAINED DELAUNAY 2D (CDT) VERIFICATION');
console.log('================================================================\n');

const OUTER_SQUARE = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1]
];
const SQUARE_HOLE = [
  [0.3, 0.3],
  [0.7, 0.3],
  [0.7, 0.7],
  [0.3, 0.7]
];

// ---------------------------------------------------------------------------
// (i) square with a square hole
// ---------------------------------------------------------------------------
{
  const mesher = new DelaunayConstrained2D({});
  const mesh = mesher.triangulatePolygon(OUTER_SQUARE, [SQUARE_HOLE], { interiorSpacing: 0.125 });
  const nodes = mesh.nodes;

  check('(i) region coverage: all triangle centroids inside outer boundary, outside hole', () => {
    assert.ok(mesh.triangles.length > 0, 'expected a non-empty triangulation');
    for (const t of mesh.triangles) {
      const [i, j, k] = t.nodeIds;
      const cx = (nodes[i].x + nodes[j].x + nodes[k].x) / 3;
      const cy = (nodes[i].y + nodes[j].y + nodes[k].y) / 3;
      assert.notStrictEqual(pointInPolygonWinding(cx, cy, OUTER_SQUARE), 0, 'centroid outside outer boundary');
      assert.strictEqual(pointInPolygonWinding(cx, cy, SQUARE_HOLE), 0, 'centroid inside hole');
    }
  });

  check('(i) hole boundary edges are present in the constrained edge set', () => {
    const edgeSet = new Set(mesh.constrainedEdges.map((e) => e.join('-')));
    for (const [a, b] of [
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4]
    ]) {
      const key = [Math.min(a, b), Math.max(a, b)].join('-');
      assert.ok(edgeSet.has(key), `hole edge ${key} missing from constrainedEdges`);
    }
    assert.strictEqual(mesh.metrics.constrainedEdgeCount, 8, 'expected 4 outer + 4 hole constrained edges');
    assert.strictEqual(mesh.metrics.recoveredAllConstraints, true, 'all constraints must be recovered');
  });

  check('(i) no triangle edge strictly crosses the hole boundary', () => {
    let crossings = 0;
    for (const t of mesh.triangles) {
      const [i, j, k] = t.nodeIds;
      for (const [u, v] of [
        [i, j],
        [j, k],
        [k, i]
      ]) {
        for (let a = 0; a < SQUARE_HOLE.length; a++) {
          const b = (a + 1) % SQUARE_HOLE.length;
          if (
            segmentsIntersectStrict(
              nodes[u].x,
              nodes[u].y,
              nodes[v].x,
              nodes[v].y,
              SQUARE_HOLE[a][0],
              SQUARE_HOLE[a][1],
              SQUARE_HOLE[b][0],
              SQUARE_HOLE[b][1]
            )
          ) {
            crossings++;
          }
        }
      }
    }
    assert.strictEqual(crossings, 0, `found ${crossings} strict crossings with the hole`);
  });

  check('(i) consistent orientation and area conservation', () => {
    let nonPositive = 0;
    for (const t of mesh.triangles) {
      const [i, j, k] = t.nodeIds;
      const ar =
        (nodes[j].x - nodes[i].x) * (nodes[k].y - nodes[i].y) - (nodes[j].y - nodes[i].y) * (nodes[k].x - nodes[i].x);
      if (ar <= 0) nonPositive++;
    }
    assert.strictEqual(nonPositive, 0, 'all triangles must be CCW with positive area');
    const relErr = Math.abs(mesh.metrics.regionArea - mesh.metrics.triangulatedArea) / mesh.metrics.regionArea;
    assert.ok(relErr < 1e-12, `triangulated area deviates from region area by ${relErr}`);
  });
}

// ---------------------------------------------------------------------------
// (ii) Delaunay quality on a seeded 200-point set
// ---------------------------------------------------------------------------
{
  const mesher = new DelaunayConstrained2D({});
  const rnd = mulberry32(1337);
  const pts = [];
  for (let i = 0; i < 200; i++) pts.push([rnd(), rnd()]);
  const { triangles } = mesher.triangulatePoints(pts);
  const observedMinAngle = minAngleDegOfTriangles(pts, triangles);

  check('(ii) 200-point Delaunay triangulation is valid and min angle reported', () => {
    assert.ok(Number.isFinite(observedMinAngle), 'min angle must be finite');
    assert.ok(observedMinAngle > 0, 'min angle must be strictly positive');
    assert.ok(triangles.length > 0, 'expected a non-empty triangulation');
    console.log(`       observed min angle = ${observedMinAngle.toFixed(3)} deg (200 points, seed 1337)`);
    console.log('       note: Delaunay maximizes min angle but does not bound it; slivers are inherent');
  });
}

// ---------------------------------------------------------------------------
// (iii) constrained edge recovery for a deliberately non-Delaunay boundary edge
// ---------------------------------------------------------------------------
{
  const mesher = new DelaunayConstrained2D({});
  const HOUSE = [
    [0, 0],
    [2, 0],
    [2, 2],
    [1, 1],
    [0, 2]
  ];
  const interiorPoint = [1.3, 1.2];

  const unconstrained = mesher.triangulatePoints([...HOUSE, interiorPoint]);
  const preKey = new Set();
  for (const t of unconstrained.triangles) {
    preKey.add([t.a, t.b].sort((x, y) => x - y).join('-'));
    preKey.add([t.b, t.c].sort((x, y) => x - y).join('-'));
    preKey.add([t.c, t.a].sort((x, y) => x - y).join('-'));
  }
  const missingBoundaryEdge = '2-3';

  check('(iii) precondition: boundary edge 2-3 is absent from the unconstrained triangulation', () => {
    assert.ok(!preKey.has(missingBoundaryEdge), 'test precondition failed: edge 2-3 unexpectedly present');
  });

  const mesh = mesher.triangulatePolygon(HOUSE, [], { interiorPoints: [interiorPoint] });
  check('(iii) boundary edge 2-3 is recovered in the constrained triangulation', () => {
    const edgeSet = new Set(mesh.constrainedEdges.map((e) => e.join('-')));
    assert.ok(edgeSet.has(missingBoundaryEdge), 'constrained edge 2-3 not recovered');
    assert.strictEqual(mesh.metrics.recoveredAllConstraints, true, 'all constraints must be recovered');
    assert.ok(mesh.metrics.triangleCount > 0, 'expected a non-empty triangulation');
  });
}

// ---------------------------------------------------------------------------
// (iv) determinism
// ---------------------------------------------------------------------------
{
  const run = () =>
    new DelaunayConstrained2D({}).triangulatePolygon(OUTER_SQUARE, [SQUARE_HOLE], { interiorSpacing: 0.125 });
  const a = run();
  const b = run();
  check('(iv) identical output across runs (nodes/triangles/edges/metrics)', () => {
    assert.strictEqual(JSON.stringify(a.nodes), JSON.stringify(b.nodes), 'nodes differ between runs');
    assert.strictEqual(JSON.stringify(a.triangles), JSON.stringify(b.triangles), 'triangles differ between runs');
    assert.strictEqual(JSON.stringify(a.constrainedEdges), JSON.stringify(b.constrainedEdges), 'edges differ');
    assert.strictEqual(JSON.stringify(a.metrics), JSON.stringify(b.metrics), 'metrics differ');
  });
}

// ---------------------------------------------------------------------------
// (v) mesh feeds Poisson2DMixed; manufactured problem
// ---------------------------------------------------------------------------
{
  const mesh = new DelaunayConstrained2D({}).triangulatePolygon(OUTER_SQUARE, [], { interiorSpacing: 0.125 });
  const boundaryIds = new Set();
  for (const [i, j] of mesh.constrainedEdges) {
    boundaryIds.add(i);
    boundaryIds.add(j);
  }

  // Manufactured harmonic field u = x + 2y (Laplace equation, zero RHS).
  // Linear TRI3 elements reproduce linear solutions exactly.
  const solveLinear = () => {
    const solver = Poisson2DMixed.fromConstrainedTriMesh(mesh, { conductivity: 1 });
    for (const id of boundaryIds) {
      const n = mesh.nodes[id];
      solver.setTemperature(id, n.x + 2 * n.y);
    }
    return solver.solve();
  };

  check('(v) Poisson2DMixed solves the CDT triangle mesh with finite values', () => {
    const res = solveLinear();
    assert.ok(Number.isFinite(res.nodeCount) && res.nodeCount > 0, 'no nodes solved');
    assert.ok(res.temperature.every(Number.isFinite), 'solver returned non-finite temperatures');
  });

  check('(v) linear manufactured field is reproduced at a point', () => {
    const res = solveLinear();
    const probe = mesh.nodes.reduce(
      (best, n) => {
        const d = Math.hypot(n.x - 0.5, n.y - 0.5);
        return d < best.d ? { n, d } : best;
      },
      { d: Infinity }
    ).n;
    const fem = res.temperature[probe.id];
    const exact = probe.x + 2 * probe.y;
    assert.ok(Math.abs(fem - exact) < 1e-9, `linear field error ${Math.abs(fem - exact)} at probe`);
    console.log(
      `       linear field probe (${probe.x.toFixed(4)}, ${probe.y.toFixed(4)}): FEM=${fem.toFixed(9)} exact=${exact.toFixed(9)}`
    );
  });

  check('(v) quadratic manufactured field converges at a point', () => {
    const solver = Poisson2DMixed.fromConstrainedTriMesh(mesh, { conductivity: 1 });
    for (const id of boundaryIds) {
      const n = mesh.nodes[id];
      solver.setTemperature(id, n.x * n.x - n.y * n.y);
    }
    const res = solver.solve();
    const probe = mesh.nodes.reduce(
      (best, n) => {
        const d = Math.hypot(n.x - 0.25, n.y - 0.75);
        return d < best.d ? { n, d } : best;
      },
      { d: Infinity }
    ).n;
    const fem = res.temperature[probe.id];
    const exact = probe.x * probe.x - probe.y * probe.y;
    assert.ok(Math.abs(fem - exact) < 0.05 * Math.abs(exact) + 1e-6, `quadratic field error ${Math.abs(fem - exact)}`);
    console.log(
      `       quadratic field probe (${probe.x.toFixed(4)}, ${probe.y.toFixed(4)}): FEM=${fem.toFixed(6)} exact=${exact.toFixed(6)}`
    );
  });
}

// ---------------------------------------------------------------------------
// (vi) production wiring: FEAEngineAdapter route
// ---------------------------------------------------------------------------
{
  check('(vi) FEAEngineAdapter exposes mesh_planar_polygon_2d', () => {
    const caps = new FEAEngineAdapter().describeCapabilities();
    assert.ok(caps.supportedOperations.includes('mesh_planar_polygon_2d'), 'route absent from capabilities');
  });

  check('(vi) FEAEngineAdapter route triangulates a polygon with a hole', async () => {
    const adapter = new FEAEngineAdapter();
    const req = new JobRequest({
      domain: 'cae',
      operation: 'mesh_planar_polygon_2d',
      parameters: {
        polygon: OUTER_SQUARE,
        holes: [SQUARE_HOLE],
        options: { interiorSpacing: 0.125 }
      }
    });
    const result = await adapter.execute(req);
    assert.strictEqual(result.status, JobStatus.SUCCEEDED);
    assert.strictEqual(result.outputData.type, 'TRI3_CDT');
    assert.ok(result.outputData.nodes.length > 0);
    assert.ok(result.outputData.triangles.length > 0);
    assert.strictEqual(result.outputData.metrics.recoveredAllConstraints, true);
    assert.strictEqual(result.outputData.constrainedEdges.length, 8);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.error.stack || f.error.message}`);
  process.exit(1);
}
