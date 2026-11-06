/**
 * Verification gate for the in-process stock (dexel) model
 * (src/core/cam/in_process_stock.js).
 *
 * Deterministic; dependency-free. Runs under node:test.
 *
 * Covers:
 *  (i)  initial rectangular block stock -> all columns at block top z,
 *  (ii) single straight ball-end pass removes exactly the columns in the
 *        tool path (per-column values to 1e-9), columns outside the tool
 *        radius untouched,
 *  (iii) second overlapping pass removes further material, no column rises,
 *  (iv) pocket contour leaves corner columns un-machined; rest-finishing
 *        path includes every remaining-material column and excludes machined
 *        columns,
 *  (v)  rest path covers 100% of flagged columns, never visits columns that
 *        are already at target depth,
 *  (vi) determinism: identical pipelines produce identical state and paths,
 *  (vii) triangle-mesh initialization by ray casting (including a sloped
 *        top face).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DexelStock } = require('../src/core/cam/in_process_stock');

const TOL = 1e-9;

const GRID = { origin: [0, 0], spacing: [5, 5], nx: 10, ny: 10 };
const BLOCK = { min: [0, 0, 0], max: [50, 50, 20] };
const TOOL_R = 5; // Ø10 ball-end

function makeStock() {
  return DexelStock.fromBlock(BLOCK, GRID);
}

function everyColumn(stock, fn) {
  for (let j = 0; j < stock.ny; j++) {
    for (let i = 0; i < stock.nx; i++) {
      fn(i, j, stock.getTop(i, j));
    }
  }
}

test('initial block stock: all 100 columns at z=20', () => {
  const s = makeStock();
  everyColumn(s, (i, j, z) => {
    assert.equal(z, 20, `column (${i},${j}) top z`);
  });
});

test('single straight Ø10 ball-end pass at depth 15 across the middle strip', () => {
  const s = makeStock();
  // Pass along y=25 (row j=5), tip depth 15. Tool radius 5 -> only columns
  // on the path centerline are strictly inside the swept capsule.
  s.sweep(TOOL_R, { start: [-5, 25, 15], end: [50, 25, 15] });
  everyColumn(s, (i, j, z) => {
    const expected = j === 5 ? 15 : 20;
    assert.ok(Math.abs(z - expected) <= TOL, `column (${i},${j}) z=${z}, expected ${expected}`);
  });
});

test('second overlapping pass at depth 10 removes further material; no column rises', () => {
  const s = makeStock();
  s.sweep(TOOL_R, { start: [-5, 25, 15], end: [50, 25, 15] });
  const before = s.state().top;
  // Overlapping pass: row y=20 (j=4), tip depth 10. Its footprint (radius 5)
  // overlaps the first pass footprint (covers y=15..25).
  s.sweep(TOOL_R, { start: [-5, 20, 10], end: [50, 20, 10] });
  everyColumn(s, (i, j, z) => {
    const expected = j === 4 ? 10 : j === 5 ? 15 : 20;
    assert.ok(Math.abs(z - expected) <= TOL, `column (${i},${j}) z=${z}, expected ${expected}`);
    assert.ok(z <= before[j * s.nx + i] + TOL, `column (${i},${j}) rose`);
  });
});

test('pocket contour leaves corner columns un-machined; rest path covers remaining only', () => {
  const s = makeStock();
  // Rectangular pocket contour at depth 15, corners at (10,10),(35,10),(35,35),(10,35).
  const loop = [
    { start: [10, 10, 15], end: [35, 10, 15] },
    { start: [35, 10, 15], end: [35, 35, 15] },
    { start: [35, 35, 15], end: [10, 35, 15] },
    { start: [10, 35, 15], end: [10, 10, 15] }
  ];
  s.sweep(TOOL_R, loop);

  // Machined wall columns (on the contour) are at 15.
  for (const [i, j] of [
    [2, 2],
    [3, 2],
    [7, 2],
    [2, 4],
    [2, 7]
  ]) {
    assert.equal(s.getTop(i, j), 15, `wall column (${i},${j})`);
  }
  // Corner columns (inside the corner scallop, at distance exactly r from both
  // walls) and the pocket interior remain un-machined at 20.
  for (const [i, j] of [
    [3, 3],
    [4, 4],
    [3, 4],
    [4, 3],
    [1, 2],
    [2, 1]
  ]) {
    assert.equal(s.getTop(i, j), 20, `corner column (${i},${j})`);
  }

  const target = 15;
  const remaining = s.remaining(target);
  const flagged = new Set(remaining.map((c) => c.i + ',' + c.j));
  assert.equal(remaining.length, 80, 'remaining material columns');

  // Corner column flagged; machined wall column not flagged.
  assert.ok(flagged.has('3,3'), 'corner column flagged');
  assert.ok(!flagged.has('2,2'), 'machined column not flagged');

  const path = s.restPath(target);
  assert.equal(path.length, flagged.size, 'path visits exactly the flagged columns');
  const visited = new Set(path.map((p) => p.i + ',' + p.j));
  assert.equal(visited.size, flagged.size, 'path has no duplicate columns');
  for (const key of flagged) {
    assert.ok(visited.has(key), `remaining column ${key} covered (coverage 100%)`);
  }
  for (const key of visited) {
    assert.ok(flagged.has(key), `path column ${key} is not a remaining column`);
    assert.ok(s.getTop(...key.split(',').map(Number)) > target + TOL, `path column ${key} is not at target depth`);
  }
  assert.equal(path[0].z, target, 'path runs at target depth');
});

test('determinism: identical pipelines produce identical state and rest paths', () => {
  function run() {
    const s = makeStock();
    s.sweep(TOOL_R, { start: [-5, 25, 15], end: [50, 25, 15] });
    s.sweep(TOOL_R, { start: [-5, 20, 10], end: [50, 20, 10] });
    const loop = [
      { start: [10, 10, 15], end: [35, 10, 15] },
      { start: [35, 10, 15], end: [35, 35, 15] },
      { start: [35, 35, 15], end: [10, 35, 15] },
      { start: [10, 35, 15], end: [10, 10, 15] }
    ];
    s.sweep(TOOL_R, loop);
    const p = s.restPath(15);
    return { state: s.state(), path: p, remaining: s.remaining(15) };
  }
  const a = run();
  const b = run();
  assert.deepEqual(a.state.top, b.state.top, 'top surface identical');
  assert.deepEqual(a.state.bottom, b.state.bottom, 'bottom surface identical');
  assert.deepEqual(a.path, b.path, 'rest path identical');
  assert.deepEqual(a.remaining, b.remaining, 'remaining set identical');

  // Re-running the same sweep is idempotent.
  const s = makeStock();
  const seg = { start: [-5, 25, 15], end: [50, 25, 15] };
  s.sweep(TOOL_R, seg);
  const first = s.state().top.slice();
  s.sweep(TOOL_R, seg);
  assert.deepEqual(s.state().top, first, 'repeated sweep idempotent');
});

test('triangle-mesh initialization by ray casting', () => {
  const mesh = {
    vertices: [
      [0, 0, 20],
      [50, 0, 10],
      [50, 50, 10],
      [0, 50, 20]
    ],
    faces: [
      [0, 1, 2],
      [0, 2, 3]
    ]
  };
  const s = DexelStock.fromMesh(mesh, GRID, { topZ: 20, bottomZ: 0 });
  everyColumn(s, (i, j, z) => {
    const expected = 20 - i; // top plane z(x) = 20 - 0.2x, x = 5i
    assert.ok(Math.abs(z - expected) <= TOL, `mesh column (${i},${j}) z=${z}, expected ${expected}`);
  });
  // A closed box mesh initialized from the block behaves like the block.
  const box = {
    vertices: [
      [0, 0, 0],
      [50, 0, 0],
      [50, 50, 0],
      [0, 50, 0],
      [0, 0, 20],
      [50, 0, 20],
      [50, 50, 20],
      [0, 50, 20]
    ],
    faces: [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7]
    ]
  };
  const boxed = DexelStock.fromMesh(box, GRID, { topZ: 20, bottomZ: 0 });
  const fromBlock = makeStock();
  assert.deepEqual(boxed.state().top, fromBlock.state().top, 'box mesh matches block stock');
});
