'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DraftingProjectionEngine, createBox, createCube } = require('../src/core/cad/drafting_projection_engine');

const DEG = 180 / Math.PI;

function closeTo(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: expected ${expected} within ${tol}, got ${actual}`);
}

function buildHoleModel() {
  const outer = createBox([0, 0, 0], [1, 1, 1]);
  const z1 = 1;
  const z0 = 0;
  const near = [0.4, 0.6];
  const far = [0.3, 0.7];
  const quad = (pts) => [
    [pts[0], pts[1], pts[2]],
    [pts[0], pts[2], pts[3]]
  ];
  const triangles = outer.triangles.slice();
  triangles.push(
    ...quad([
      [0, 0, z1],
      [near[0], 0, z1],
      [near[0], 1, z1],
      [0, 1, z1]
    ])
  );
  triangles.push(
    ...quad([
      [near[1], 0, z1],
      [1, 0, z1],
      [1, 1, z1],
      [near[1], 1, z1]
    ])
  );
  triangles.push(
    ...quad([
      [near[0], 0, z1],
      [near[1], 0, z1],
      [near[1], near[0], z1],
      [near[0], near[0], z1]
    ])
  );
  triangles.push(
    ...quad([
      [near[0], near[1], z1],
      [near[1], near[1], z1],
      [near[1], 1, z1],
      [near[0], 1, z1]
    ])
  );
  triangles.push(
    ...quad([
      [0, 0, z0],
      [far[0], 0, z0],
      [far[0], 1, z0],
      [0, 1, z0]
    ])
  );
  triangles.push(
    ...quad([
      [far[1], 0, z0],
      [1, 0, z0],
      [1, 1, z0],
      [far[1], 1, z0]
    ])
  );
  triangles.push(
    ...quad([
      [far[0], 0, z0],
      [far[1], 0, z0],
      [far[1], far[0], z0],
      [far[0], far[0], z0]
    ])
  );
  triangles.push(
    ...quad([
      [far[0], far[1], z0],
      [far[1], far[1], z0],
      [far[1], 1, z0],
      [far[0], 1, z0]
    ])
  );
  triangles.push(
    ...quad([
      [near[0], near[0], z1],
      [near[0], near[1], z1],
      [far[0], far[1], z0],
      [far[0], far[0], z0]
    ])
  );
  triangles.push(
    ...quad([
      [near[1], near[0], z1],
      [near[1], near[1], z1],
      [far[1], far[1], z0],
      [far[1], far[0], z0]
    ])
  );
  triangles.push(
    ...quad([
      [near[0], near[0], z1],
      [near[1], near[0], z1],
      [far[1], far[0], z0],
      [far[0], far[0], z0]
    ])
  );
  triangles.push(
    ...quad([
      [near[0], near[1], z1],
      [near[1], near[1], z1],
      [far[1], far[1], z0],
      [far[0], far[1], z0]
    ])
  );
  const edges = outer.edges.slice();
  const nearEdges = [
    [
      [near[0], near[0], z1],
      [near[1], near[0], z1]
    ],
    [
      [near[1], near[0], z1],
      [near[1], near[1], z1]
    ],
    [
      [near[1], near[1], z1],
      [near[0], near[1], z1]
    ],
    [
      [near[0], near[1], z1],
      [near[0], near[0], z1]
    ]
  ];
  const farEdges = [
    [
      [far[0], far[0], z0],
      [far[1], far[0], z0]
    ],
    [
      [far[1], far[0], z0],
      [far[1], far[1], z0]
    ],
    [
      [far[1], far[1], z0],
      [far[0], far[1], z0]
    ],
    [
      [far[0], far[1], z0],
      [far[0], far[0], z0]
    ]
  ];
  edges.push(...nearEdges, ...farEdges);
  return { edges, triangles };
}

function mid(p, q) {
  return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
}

function angleDeg(v) {
  const a = Math.atan2(v[1], v[0]) * DEG;
  return a < 0 ? a + 360 : a;
}

function angleBetweenDeg(v1, v2) {
  const d = Math.abs(angleDeg(v1) - angleDeg(v2)) % 360;
  return Math.min(d, 360 - d);
}

test('cube front view: front square visible, far square hidden, connectors degenerate', () => {
  const engine = new DraftingProjectionEngine(createCube(), { convention: 'third-angle' });
  const analysis = engine.analyzeView('front');
  const byEdge = new Map();
  for (const seg of analysis.segments) {
    if (!byEdge.has(seg.edgeIndex)) byEdge.set(seg.edgeIndex, []);
    byEdge.get(seg.edgeIndex).push(seg);
  }
  for (let i = 0; i < 4; i++) {
    const segs = byEdge.get(i) || [];
    assert.equal(segs.length, 1, `bottom edge ${i} should be a single segment`);
    assert.equal(segs[0].cls, 'hidden', `bottom edge ${i} should be hidden`);
  }
  for (let i = 4; i < 8; i++) {
    const segs = byEdge.get(i) || [];
    assert.equal(segs.length, 1, `top edge ${i} should be a single segment`);
    assert.equal(segs[0].cls, 'visible', `top edge ${i} should be visible`);
  }
  for (let i = 8; i < 12; i++) {
    const segs = byEdge.get(i) || [];
    assert.equal(segs.length, 0, `vertical edge ${i} should project degenerate`);
  }
  const nonDegenerate = analysis.segments.filter((s) => !s.degenerate);
  const visible = nonDegenerate.filter((s) => s.cls === 'visible').length;
  const hidden = nonDegenerate.filter((s) => s.cls === 'hidden').length;
  assert.equal(visible, 4);
  assert.equal(hidden, 4);
  assert.equal(engine.isCovered('front', [0.5, 0, 0]), true);
  assert.equal(engine.isCovered('front', [0.5, 1, 0]), true);
  assert.equal(engine.isCovered('front', [0.5, 0.5, 1]), false);
  assert.equal(engine.isCovered('front', [0.5, 0, 1]), false);
});

test('block with through bore: near hole outline visible, far hole outline hidden', () => {
  const model = buildHoleModel();
  const engine = new DraftingProjectionEngine(model, { convention: 'third-angle' });
  const analysis = engine.analyzeView('front');
  const byEdge = new Map();
  for (const seg of analysis.segments) {
    if (!byEdge.has(seg.edgeIndex)) byEdge.set(seg.edgeIndex, []);
    byEdge.get(seg.edgeIndex).push(seg);
  }
  for (let i = 4; i < 8; i++) {
    const segs = byEdge.get(i) || [];
    assert.equal(segs.length, 1, `outer top edge ${i} should be a single segment`);
    assert.equal(segs[0].cls, 'visible', `outer top edge ${i} should be visible`);
  }
  for (let i = 12; i < 16; i++) {
    const segs = byEdge.get(i) || [];
    assert.equal(segs.length, 1, `near hole edge ${i} should be a single segment`);
    assert.equal(segs[0].cls, 'visible', `near hole edge ${i} should be visible`);
  }
  for (let i = 16; i < 20; i++) {
    const segs = byEdge.get(i) || [];
    assert.equal(segs.length, 1, `far hole edge ${i} should be a single segment`);
    assert.equal(segs[0].cls, 'hidden', `far hole edge ${i} should be hidden`);
  }
  const edges = model.edges;
  for (let i = 16; i < 20; i++) {
    const m = mid(edges[i][0], edges[i][1]);
    assert.equal(engine.isCovered('front', m), true, `far hole edge ${i} midpoint should be covered`);
  }
  for (let i = 12; i < 16; i++) {
    const m = mid(edges[i][0], edges[i][1]);
    assert.equal(engine.isCovered('front', m), false, `near hole edge ${i} midpoint should not be covered`);
  }
  const nonDegenerate = analysis.segments.filter((s) => !s.degenerate);
  assert.equal(nonDegenerate.filter((s) => s.cls === 'visible').length, 8);
  assert.equal(nonDegenerate.filter((s) => s.cls === 'hidden').length, 8);
});

test('orthographic projection correctness: cube corner maps to expected 2D', () => {
  const engine = new DraftingProjectionEngine(createCube(), { convention: 'third-angle' });
  const f = engine.projectPoint('front', [1, 1, 1]);
  closeTo(f[0], 1, 1e-9, 'front x');
  closeTo(f[1], 1, 1e-9, 'front y');
  const t = engine.projectPoint('top', [1, 1, 1]);
  closeTo(t[0], 1, 1e-9, 'top x');
  closeTo(t[1], -1, 1e-9, 'top y');
  const r = engine.projectPoint('right', [1, 1, 1]);
  closeTo(r[0], -1, 1e-9, 'right x');
  closeTo(r[1], 1, 1e-9, 'right y');
});

test('isometric axis directions are 120 deg apart', () => {
  const engine = new DraftingProjectionEngine(createCube(), { convention: 'third-angle' });
  const ax = engine.projectPoint('isometric', [1, 0, 0]);
  const ay = engine.projectPoint('isometric', [0, 1, 0]);
  const az = engine.projectPoint('isometric', [0, 0, 1]);
  closeTo(angleBetweenDeg(ax, ay), 120, 0.5, 'angle X-Y');
  closeTo(angleBetweenDeg(ay, az), 120, 0.5, 'angle Y-Z');
  closeTo(angleBetweenDeg(az, ax), 120, 0.5, 'angle Z-X');
});

test('first-angle vs third-angle layout order flips', () => {
  const cube = createCube();
  const third = new DraftingProjectionEngine(cube, { convention: 'third-angle' });
  const first = new DraftingProjectionEngine(cube, { convention: 'first-angle' });
  const t3 = third.analyzeView('top');
  const r3 = third.analyzeView('right');
  const t1 = first.analyzeView('top');
  const r1 = first.analyzeView('right');
  assert.ok(t3.offset.y > 0, 'third-angle top goes above front');
  assert.ok(r3.offset.x > 0, 'third-angle right goes right of front');
  assert.ok(t1.offset.y < 0, 'first-angle top goes below front');
  assert.ok(r1.offset.x < 0, 'first-angle right goes left of front');
  const p3r = third.projectPoint('right', [1, 1, 1]);
  const p1r = first.projectPoint('right', [1, 1, 1]);
  assert.equal(Math.sign(p3r[0]), -1);
  assert.equal(Math.sign(p1r[0]), 1);
  const p3t = third.projectPoint('top', [0, 0, 1]);
  const p1t = first.projectPoint('top', [0, 0, 1]);
  assert.equal(Math.sign(p3t[1]), -1);
  assert.equal(Math.sign(p1t[1]), 1);
});

test('partially hidden edge splits into visible/hidden/visible', () => {
  const plate = [
    [0.25, 0, 1],
    [0.75, 0, 1],
    [0.75, 1, 1],
    [0.25, 1, 1]
  ];
  const triangles = [
    [plate[0], plate[1], plate[2]],
    [plate[0], plate[2], plate[3]]
  ];
  const edges = [
    [
      [0.5, 1.5, 0.5],
      [0.5, -0.5, 0.5]
    ]
  ];
  const engine = new DraftingProjectionEngine({ edges, triangles }, { convention: 'third-angle' });
  const analysis = engine.analyzeView('front');
  const segs = analysis.segments.filter((s) => !s.degenerate);
  assert.equal(segs.length, 3);
  assert.deepEqual(
    segs.map((s) => s.cls),
    ['visible', 'hidden', 'visible']
  );
  assert.equal(engine.isCovered('front', [0.5, 0.5, 0.5]), true);
  assert.equal(engine.isCovered('front', [0.5, 1.25, 0.5]), false);
});

test('svg rendering is deterministic and contains hidden-line styling', () => {
  const engine = new DraftingProjectionEngine(createCube(), { convention: 'third-angle' });
  const svg1 = engine.renderSVG();
  const svg2 = engine.renderSVG();
  assert.equal(svg1, svg2);
  assert.ok(svg1.includes('<svg'));
  assert.ok(svg1.includes('stroke-dasharray'));
  assert.ok(svg1.includes('front'));
  assert.ok(svg1.includes('top'));
  assert.ok(svg1.includes('right'));
  assert.ok(svg1.includes('isometric'));
});

test('cube per-view HLR classification summary', () => {
  const engine = new DraftingProjectionEngine(createCube(), { convention: 'third-angle' });
  for (const name of ['front', 'top', 'right', 'isometric']) {
    const analysis = engine.analyzeView(name);
    const nonDegenerate = analysis.segments.filter((s) => !s.degenerate);
    const visible = nonDegenerate.filter((s) => s.cls === 'visible').length;
    const hidden = nonDegenerate.filter((s) => s.cls === 'hidden').length;
    console.log(
      `cube ${name}: visible=${visible} hidden=${hidden} degenerate=${analysis.segments.length - nonDegenerate.length}`
    );
  }
});
