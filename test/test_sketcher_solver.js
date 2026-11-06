/**
 * Verification gate: variational sketcher constraint solver.
 *
 * Covers coincident/collinear/parallel/perpendicular, tangency,
 * symmetry, concentric, distance/angle dimensions, over-constrained and
 * under-constrained detection, plus a 50-constraint mechanism pattern
 * with a wall-clock bound.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SketcherConstraintSolver } = require('../src/core/cad/sketcher_constraint_solver');

function dist(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

function angleAt(ox, oy, ax, ay, bx, by) {
  const v1x = ax - ox;
  const v1y = ay - oy;
  const v2x = bx - ox;
  const v2y = by - oy;
  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  const c = (v1x * v2x + v1y * v2y) / (n1 * n2);
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

function lineDistance(ax, ay, bx, by, px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  return Math.abs(dx * (ay - py) - (ax - px) * dy) / len;
}

test('SketcherSolver: rectangle by lines, perpendicular, parallel, distances converges', () => {
  const s = new SketcherConstraintSolver();

  const p0 = s.addPoint('p0', 0, 0, true);
  const p1 = s.addPoint('p1', 3.2, 0.1);
  const p2 = s.addPoint('p2', 3.5, 2.3);
  const p3 = s.addPoint('p3', -0.2, 1.9);

  const l0 = s.addLine('l0', p0, p1);
  const l1 = s.addLine('l1', p1, p2);
  const l2 = s.addLine('l2', p2, p3);
  const l3 = s.addLine('l3', p3, p0);

  s.addHorizontal(l0);
  s.addPerpendicular(l0, l1);
  s.addPerpendicular(l1, l2);
  s.addPerpendicular(l3, l0);
  s.addParallel(l0, l2);
  s.addDistancePoints(p0, p1, 3);
  s.addDistancePoints(p1, p2, 2);

  const W = 3;
  const H = 2;

  const res = s.solve({ tolerance: 1e-11 });

  assert.equal(res.converged, true, `solver must converge, residual=${res.maxResidual}`);
  assert.ok(res.maxResidual < 1e-10, `residual < 1e-10, got ${res.maxResidual}`);

  const A = s.getPoint(p0);
  const B = s.getPoint(p1);
  const C = s.getPoint(p2);
  const D = s.getPoint(p3);

  assert.ok(Math.abs(dist(A.x, A.y, B.x, B.y) - W) < 1e-9, 'bottom side length');
  assert.ok(Math.abs(dist(B.x, B.y, C.x, C.y) - H) < 1e-9, 'right side length');
  assert.ok(Math.abs(dist(C.x, C.y, D.x, D.y) - W) < 1e-9, 'top side length');
  assert.ok(Math.abs(dist(D.x, D.y, A.x, A.y) - H) < 1e-9, 'left side length');

  assert.ok(Math.abs(angleAt(A.x, A.y, B.x, B.y, D.x, D.y) - Math.PI / 2) < 1e-9, 'angle at p0');
  assert.ok(Math.abs(angleAt(B.x, B.y, A.x, A.y, C.x, C.y) - Math.PI / 2) < 1e-9, 'angle at p1');
  assert.ok(Math.abs(angleAt(C.x, C.y, B.x, B.y, D.x, D.y) - Math.PI / 2) < 1e-9, 'angle at p2');
  assert.ok(Math.abs(angleAt(D.x, D.y, C.x, C.y, A.x, A.y) - Math.PI / 2) < 1e-9, 'angle at p3');

  assert.ok(Math.abs(A.y - B.y) < 1e-9, 'bottom edge horizontal');

  // spot check: p0 is still pinned exactly
  assert.equal(A.x, 0);
  assert.equal(A.y, 0);
});

test('SketcherSolver: line tangent to circle keeps center distance equal to radius', () => {
  const s = new SketcherConstraintSolver();

  const p0 = s.addPoint('p0', 0, 0, true);
  const p1 = s.addPoint('p1', 2, 0.5);
  const center = s.addPoint('center', 1, 1, true);
  const radius = 0.8;

  const line = s.addLine('line', p0, p1);
  const circle = s.addCircle('circle', center, radius);

  s.addTangentLineCircle(line, circle);

  const res = s.solve({ tolerance: 1e-11 });
  assert.equal(res.converged, true, `tangency solver must converge, residual=${res.maxResidual}`);
  assert.ok(res.maxResidual < 1e-10, `residual < 1e-10, got ${res.maxResidual}`);

  const A = s.getPoint(p0);
  const B = s.getPoint(p1);
  const C = s.getPoint(center);

  // distance from center to line == radius
  const dLine = lineDistance(A.x, A.y, B.x, B.y, C.x, C.y);
  assert.ok(Math.abs(dLine - radius) < 1e-9, 'center-to-line distance must equal radius');

  // foot of perpendicular from center to line lies on both line and circle
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  const t = ((C.x - A.x) * dx + (C.y - A.y) * dy) / len2;
  const Fx = A.x + t * dx;
  const Fy = A.y + t * dy;

  assert.ok(Math.abs(dist(Fx, Fy, C.x, C.y) - radius) < 1e-9, 'tangent point on circle');
  assert.ok(lineDistance(A.x, A.y, B.x, B.y, Fx, Fy) < 1e-9, 'tangent point on line');
});

test('SketcherSolver: symmetric points midpoint on axis and segment perpendicular to axis', () => {
  const s = new SketcherConstraintSolver();

  const q0 = s.addPoint('q0', 0, 0, true);
  const q1 = s.addPoint('q1', 1, 0.25, true);
  const a = s.addPoint('a', 0.5, 2);
  const b = s.addPoint('b', 0.5, 1);

  const axis = s.addLine('axis', q0, q1);
  s.addSymmetricPoints(a, b, axis);

  const res = s.solve({ tolerance: 1e-11 });
  assert.equal(res.converged, true, `symmetry solver must converge, residual=${res.maxResidual}`);
  assert.ok(res.maxResidual < 1e-10, `residual < 1e-10, got ${res.maxResidual}`);

  const A = s.getPoint(a);
  const B = s.getPoint(b);
  const Q0 = s.getPoint(q0);
  const Q1 = s.getPoint(q1);

  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  assert.ok(lineDistance(Q0.x, Q0.y, Q1.x, Q1.y, mx, my) < 1e-9, 'midpoint lies on axis');

  const adx = Q1.x - Q0.x;
  const ady = Q1.y - Q0.y;
  const difx = B.x - A.x;
  const dify = B.y - A.y;
  const dot = difx * adx + dify * ady;
  assert.ok(Math.abs(dot) < 1e-9, 'connecting segment perpendicular to axis');
});

test('SketcherSolver: concentric circles share center', () => {
  const s = new SketcherConstraintSolver();

  const c1 = s.addPoint('c1', 0, 0, true);
  const c2 = s.addPoint('c2', 3, 4);

  const circle1 = s.addCircle('circle1', c1, 1);
  const circle2 = s.addCircle('circle2', c2, 2);

  s.addConcentric(circle1, circle2);

  const res = s.solve({ tolerance: 1e-11 });
  assert.equal(res.converged, true, `concentric solver must converge, residual=${res.maxResidual}`);
  assert.ok(res.maxResidual < 1e-10, `residual < 1e-10, got ${res.maxResidual}`);

  const C1 = s.getPoint(c1);
  const C2 = s.getPoint(c2);
  assert.ok(Math.abs(C2.x - C1.x) < 1e-9, 'centers coincide x');
  assert.ok(Math.abs(C2.y - C1.y) < 1e-9, 'centers coincide y');
});

test('SketcherSolver: over-constrained system reports redundancy and still converges', () => {
  const s = new SketcherConstraintSolver();

  const p0 = s.addPoint('p0', 0, 0, true);
  const p1 = s.addPoint('p1', 4.1, 0.2);
  const p2 = s.addPoint('p2', 0.3, 3.2);

  const l0 = s.addLine('l0', p0, p1);
  const l1 = s.addLine('l1', p0, p2);

  // 4-DOF problem (p0 fixed): 3 distances + horizontal = 4 independent constraints
  s.addHorizontal(l0);
  s.addDistancePoints(p0, p1, 3);
  s.addDistancePoints(p0, p2, 4);
  s.addDistancePoints(p1, p2, 5);
  // 5th constraint: redundant angle dimension (3-4-5 right triangle already fixes angle)
  s.addAngleLines(l0, l1, Math.PI / 2);

  const res = s.solve({ tolerance: 1e-11 });
  assert.equal(res.converged, true, `over-constrained solver must still converge, residual=${res.maxResidual}`);
  assert.ok(res.overconstrained >= 1, `must detect redundancy, overconstrained=${res.overconstrained}`);
  assert.ok(res.maxResidual < 1e-10, `residual < 1e-10, got ${res.maxResidual}`);

  const A = s.getPoint(p0);
  const B = s.getPoint(p1);
  const C = s.getPoint(p2);

  assert.ok(Math.abs(dist(A.x, A.y, B.x, B.y) - 3) < 1e-9, 'side 3');
  assert.ok(Math.abs(dist(A.x, A.y, C.x, C.y) - 4) < 1e-9, 'side 4');
  assert.ok(Math.abs(dist(B.x, B.y, C.x, C.y) - 5) < 1e-9, 'side 5');
  assert.ok(Math.abs(angleAt(A.x, A.y, B.x, B.y, C.x, C.y) - Math.PI / 2) < 1e-9, 'right angle');
});

test('SketcherSolver: under-constrained system reports remaining degrees of freedom', () => {
  const s = new SketcherConstraintSolver();

  const p0 = s.addPoint('p0', 0, 0, true);
  const p1 = s.addPoint('p1', 2.7, 0.1);
  const p2 = s.addPoint('p2', 1, 2);

  s.addDistancePoints(p0, p1, 2);

  const res = s.solve({ tolerance: 1e-11 });
  assert.equal(res.converged, true, `under-constrained solver must converge, residual=${res.maxResidual}`);
  assert.ok(res.underconstrained === 3, `expected 3 free DOF, got ${res.underconstrained}`);

  const A = s.getPoint(p0);
  const B = s.getPoint(p1);
  assert.ok(Math.abs(dist(A.x, A.y, B.x, B.y) - 2) < 1e-9, 'applied distance holds');
});

test('SketcherSolver: 50-constraint mechanism pattern solves fast with tight residual', () => {
  const cols = [0, 1.3, 2.9, 4.2, 6.0];
  const rows = [0, 1.1, 2.4, 3.7];
  const nc = cols.length;
  const nr = rows.length;

  const s = new SketcherConstraintSolver();

  const P = [];
  for (let i = 0; i < nr; i++) {
    P.push([]);
    for (let j = 0; j < nc; j++) {
      const fixed = i === 0 && j === 0;
      const jx = (i + j) % 2 === 0 ? 1 : -1;
      const jy = i % 2 === 0 ? 1 : -1;
      const px = cols[j] + (fixed ? 0 : 0.07 * jx);
      const py = rows[i] + (fixed ? 0 : 0.05 * jy);
      P[i].push(s.addPoint(`p_${i}_${j}`, px, py, fixed));
    }
  }

  let count = 0;
  const add = (fn) => {
    fn();
    count++;
  };

  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nc - 1; j++) {
      const dx = cols[j + 1] - cols[j];
      add(() => s.addDistancePoints(P[i][j], P[i][j + 1], dx));
    }
  }
  for (let j = 0; j < nc; j++) {
    for (let i = 0; i < nr - 1; i++) {
      const dy = rows[i + 1] - rows[i];
      add(() => s.addDistancePoints(P[i][j], P[i + 1][j], dy));
    }
  }
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < nc - 1; j++) {
      const dx = cols[j + 1] - cols[j];
      const dy = rows[i + 1] - rows[i];
      const d = Math.sqrt(dx * dx + dy * dy);
      add(() => s.addDistancePoints(P[i][j], P[i + 1][j + 1], d));
    }
  }
  for (const i of [0, 2, 3]) {
    const l = s.addLine(`rowL_${i}`, P[i][0], P[i][1]);
    const l2 = s.addLine(`rowL2_${i}`, P[i][1], P[i][2]);
    add(() => s.addCollinear(l, l2));
  }
  for (let j = 0; j < nc - 1; j++) {
    const seg0 = s.addLine(`colA_${j}`, P[0][j], P[1][j]);
    const seg1 = s.addLine(`colB_${j}`, P[1][j], P[2][j]);
    add(() => s.addParallel(seg0, seg1));
  }

  assert.equal(count, 50, 'pattern must have exactly 50 constraints');

  const t0 = Date.now();
  const res = s.solve({ tolerance: 1e-9, maxIterations: 300 });
  const elapsedMs = Date.now() - t0;

  assert.equal(res.converged, true, `50-constraint solver must converge, residual=${res.maxResidual}`);
  assert.ok(res.maxResidual < 1e-8, `residual < 1e-8, got ${res.maxResidual}`);
  assert.ok(elapsedMs < 5000, `solve time < 5s, got ${elapsedMs}ms`);

  const a = s.getPoint(P[3][4]);
  const b = s.getPoint(P[3][3]);
  assert.ok(Math.abs(dist(a.x, a.y, b.x, b.y) - 1.8) < 1e-8, 'spot-check row spacing');

  const c = s.getPoint(P[2][1]);
  const d = s.getPoint(P[1][1]);
  assert.ok(Math.abs(dist(c.x, c.y, d.x, d.y) - 1.3) < 1e-8, 'spot-check column spacing');
});
