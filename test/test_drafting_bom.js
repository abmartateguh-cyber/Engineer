'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeRolledBOM, extractBOM, generateBalloons, renderBOMTable } = require('../src/core/cad/drafting_bom');

function part(id, overrides = {}) {
  return Object.assign(
    {
      type: 'part',
      name: `Part ${id}`,
      partNumber: `PN-${id}`,
      description: `Description for part ${id}`,
      quantity: 1,
      material: 'Aluminum 6061',
      volume: 0.001,
      density: 2700,
      unit: 'kg'
    },
    overrides
  );
}

function assembly(id, children, overrides = {}) {
  return Object.assign(
    {
      type: 'assembly',
      name: `Assembly ${id}`,
      partNumber: `ASM-${id}`,
      description: `Subassembly ${id}`,
      quantity: 1,
      unit: 'kg',
      children
    },
    overrides
  );
}

function build25ItemTree() {
  const subs = [];
  for (let s = 1; s <= 5; s += 1) {
    const parts = [];
    for (let p = 1; p <= 5; p += 1) {
      parts.push(
        part(`${s}-${p}`, {
          volume: 0.001 * s + 0.0001 * p,
          density: 2700
        })
      );
    }
    subs.push(assembly(s, parts));
  }
  return assembly('TOP', subs, { name: 'Top Assembly', partNumber: 'ASM-TOP' });
}

test('25-item BOM from 5 subassemblies x 5 parts produces exactly 25 rows with item numbers 1-25', () => {
  const root = build25ItemTree();
  const bom = extractBOM(root);
  assert.equal(bom.rows.length, 25);
  const items = bom.rows.map((r) => r.item);
  assert.deepEqual(
    items,
    Array.from({ length: 25 }, (_, i) => i + 1)
  );
  assert.equal(new Set(items).size, 25);
  for (const row of bom.rows) {
    assert.equal(row.depth, 2);
    assert.match(row.partNumber, /^PN-\d+-\d+$/);
  }
});

test('quantity roll-up: subassembly used 2x containing 3 parts rolls each part to 2, total quantity 6', () => {
  const root = assembly('TOP', [assembly('SUB', [part('A'), part('B'), part('C')], { quantity: 2 })]);
  const bom = extractBOM(root);
  assert.equal(bom.rows.length, 3);
  for (const row of bom.rows) {
    assert.equal(row.qty, 2);
  }
  assert.equal(bom.totalQuantity, 6);
  const hierarchical = extractBOM(root, { includeAssemblies: true });
  const subRow = hierarchical.rows.find((r) => r.partNumber === 'ASM-SUB');
  assert.equal(subRow.qty, 2);
});

test('mass: volume x density per part matches to 1e-9 and assembly total equals sum of rolled totals', () => {
  const partMass = 0.002 * 7850;
  const root = assembly('TOP', [
    assembly('SUB', [part('X', { volume: 0.002, density: 7850 })], { quantity: 2 }),
    part('Y', { volume: 0.001, density: 2700 })
  ]);
  const bom = extractBOM(root);
  assert.ok(Math.abs(bom.rows[0].mass - partMass) <= 1e-9);
  assert.ok(Math.abs(bom.rows[0].totalMass - partMass * 2) <= 1e-9);
  const expectedTotal = partMass * 2 + 0.001 * 2700;
  assert.ok(Math.abs(bom.totalMass - expectedTotal) <= 1e-9);
  const expectedAssemblyUnit = partMass;
  assert.ok(Math.abs(bom.root.children[0].unitMass - expectedAssemblyUnit) <= 1e-9);
});

test('balloons: 25 unique indices, positions within bounds, leaders reach item centers within 2 mm', () => {
  const root = build25ItemTree();
  const bom = extractBOM(root);
  const positions = bom.rows.map((_, i) => ({
    x: 40 + (i % 5) * 45,
    y: 30 + Math.floor(i / 5) * 30
  }));
  const W = 297;
  const H = 210;
  const { balloons, radius } = generateBalloons(bom, {
    itemPositions: positions,
    sheetWidth: W,
    sheetHeight: H,
    balloonRadius: 4
  });
  assert.equal(balloons.length, 25);
  const indices = balloons.map((b) => b.index);
  assert.deepEqual(
    indices,
    Array.from({ length: 25 }, (_, i) => i + 1)
  );
  assert.equal(new Set(indices).size, 25);
  for (const b of balloons) {
    assert.ok(b.cx - radius >= 0 && b.cx + radius <= W, `balloon ${b.index} x out of bounds`);
    assert.ok(b.cy - radius >= 0 && b.cy + radius <= H, `balloon ${b.index} y out of bounds`);
    const dx = b.leader.x2 - b.target.x;
    const dy = b.leader.y2 - b.target.y;
    assert.ok(Math.hypot(dx, dy) <= 2, `balloon ${b.index} leader endpoint not at item`);
    const len = Math.hypot(b.leader.x1 - b.cx, b.leader.y1 - b.cy);
    assert.ok(Math.abs(len - radius) <= 1e-9, `balloon ${b.index} leader not on circle boundary`);
  }
  const r1 = generateBalloons(bom, { itemPositions: positions, sheetWidth: W, sheetHeight: H });
  const r2 = generateBalloons(bom, { itemPositions: positions, sheetWidth: W, sheetHeight: H });
  assert.deepEqual(r1, r2);
});

test('table output contains all 25 part numbers and reruns byte-identical', () => {
  const root = build25ItemTree();
  const bom = extractBOM(root);
  const t1 = renderBOMTable(bom);
  const t2 = renderBOMTable(bom);
  assert.equal(t1.svg, t2.svg);
  assert.equal(t1.html, t2.html);
  assert.deepEqual(t1, t2);
  for (const row of bom.rows) {
    assert.ok(t1.html.includes(row.partNumber), `html missing ${row.partNumber}`);
    assert.ok(t1.svg.includes(row.partNumber), `svg missing ${row.partNumber}`);
  }
  for (const header of ['Item', 'Part Number', 'Description', 'Qty', 'Material', 'Mass', 'Unit', 'Total Mass']) {
    assert.ok(t1.html.includes(header));
  }
  assert.ok(t1.html.includes('<table'));
  assert.ok(t1.svg.includes('<svg'));
});

test('hierarchical mode includes subassembly rows with roll-up quantities', () => {
  const root = build25ItemTree();
  const bom = extractBOM(root, { includeAssemblies: true });
  assert.equal(bom.rows.length, 30);
  assert.deepEqual(
    bom.rows.map((r) => r.item),
    Array.from({ length: 30 }, (_, i) => i + 1)
  );
  const subs = bom.rows.filter((r) => r.partNumber.startsWith('ASM-') && r.depth === 1);
  assert.equal(subs.length, 5);
  for (const sub of subs) {
    assert.equal(sub.qty, 1);
    assert.ok(sub.mass > 0);
  }
});
