'use strict';

/**
 * EDA DRC engine verification gate (test/test_eda_drc.js).
 *
 * Verifies the polygon DRC engine detects 10 intentional design-rule
 * violations (minimum width, minimum spacing, minimum area, enclosure) with
 * zero false positives on conforming companion geometries, and fails closed on
 * malformed input.
 */

const assert = require('assert');
const { DRCEngine } = require('../src/core/eda/drc_engine');

const r = (pts) => pts.map(([x, y]) => ({ x, y }));
const rect = (x0, y0, x1, y1) =>
  r([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1]
  ]);

let passed = 0;
let total = 0;

function check(name, condition, detail) {
  total++;
  try {
    assert(condition, detail);
    passed++;
    console.log(`  PASS ${name}${detail ? ` [${detail}]` : ''}`);
  } catch (err) {
    console.log(`  FAIL ${name} [${detail}]`);
    throw err;
  }
}

function runScene(name, shapes, rules) {
  const out = DRCEngine.runPolygonDRC(shapes, rules);
  const types = new Map();
  for (const v of out.violations) {
    const key = `${v.shapeId || '?'}:${v.type}`;
    types.set(key, (types.get(key) || 0) + 1);
  }
  return { out, types };
}

// --- Scene 1: minimum width (2 planted violations, 1 clean companion) ---
{
  const { out, types } = runScene(
    'width',
    [
      { id: 'WA', layer: 'W', vertices: rect(0, 0, 100, 3) },
      { id: 'WB', layer: 'W', vertices: rect(200, 0, 280, 3) },
      { id: 'WZ', layer: 'W', vertices: rect(400, 0, 460, 20) }
    ],
    { minWidth: 4, minSpacing: 3, minArea: 50 }
  );
  check('width: engine succeeds', out.success === true && out.violationCount === 2, `count=${out.violationCount}`);
  check('width: WA flagged once', types.get('WA:MIN_WIDTH_VIOLATION') === 1);
  check('width: WB flagged once', types.get('WB:MIN_WIDTH_VIOLATION') === 1);
  check('width: clean WZ has no violations', !types.has('WZ:'));
  check(
    'width: no stray violation types',
    [...types.keys()].every((k) => k.endsWith(':MIN_WIDTH_VIOLATION'))
  );
}

// --- Scene 2: minimum spacing (2 planted pairs -> 2 violations, 1 clean) ---
for (const [tag, x0] of [
  ['spacing-a', 0],
  ['spacing-b', 200]
]) {
  const { out, types } = runScene(
    tag,
    [
      { id: 'SA', layer: 'S', vertices: rect(x0, 0, x0 + 40, 10) },
      { id: 'SB', layer: 'S', vertices: rect(x0 + 42, 0, x0 + 82, 10) },
      { id: 'SE', layer: 'S', vertices: rect(x0 + 200, 0, x0 + 260, 10) }
    ],
    { minWidth: 2, minSpacing: 4, minArea: 10 }
  );
  check(
    `${tag}: exactly one spacing violation`,
    out.success === true && out.violationCount === 1,
    `count=${out.violationCount}`
  );
  check(`${tag}: violation is MIN_SPACING`, types.get('?:MIN_SPACING_VIOLATION') === 1);
  check(`${tag}: clean SE has no violations`, !types.has('SE:'));
}

// --- Scene 3: minimum area (2 planted violations, 1 clean) ---
{
  const { out, types } = runScene(
    'area',
    [
      { id: 'AA', layer: 'A', vertices: rect(0, 0, 5, 5) },
      { id: 'AB', layer: 'A', vertices: rect(20, 0, 25, 7) },
      { id: 'AC', layer: 'A', vertices: rect(60, 0, 100, 30) }
    ],
    { minWidth: 2, minSpacing: 4, minArea: 50 }
  );
  check(
    'area: engine succeeds with exactly 2 violations',
    out.success === true && out.violationCount === 2,
    `count=${out.violationCount}`
  );
  check('area: AA flagged once', types.get('AA:MIN_AREA_VIOLATION') === 1);
  check('area: AB flagged once', types.get('AB:MIN_AREA_VIOLATION') === 1);
  check('area: clean AC has no violations', !types.has('AC:'));
  check(
    'area: no stray violation types',
    [...types.keys()].every((k) => k.endsWith(':MIN_AREA_VIOLATION'))
  );
}

// --- Scene 4: enclosure (2 planted violations, 2 clean controls) ---
{
  const badPair = [
    { id: 'HA', layer: 'H', vertices: rect(0, 0, 60, 60) },
    { id: 'CA', layer: 'E', vertices: rect(3, 3, 57, 57) }
  ];
  const badPair2 = [
    { id: 'HB', layer: 'H', vertices: rect(100, 0, 160, 60) },
    { id: 'CB', layer: 'E', vertices: rect(103, 3, 157, 57) }
  ];
  const badRules = {
    minWidth: 2,
    minSpacing: 2,
    minArea: 10,
    enclosures: [{ layer: 'E', enclosingLayer: 'H', margin: 4 }]
  };
  const { out: out1, types: t1 } = runScene('enclosure-bad1', badPair, badRules);
  check(
    'enclosure: bad pair 1 has exactly one violation',
    out1.success === true && out1.violationCount === 1,
    `count=${out1.violationCount}`
  );
  check('enclosure: CA flagged once', t1.get('CA:ENCLOSURE_VIOLATION') === 1);
  const { out: out2, types: t2 } = runScene('enclosure-bad2', badPair2, badRules);
  check(
    'enclosure: bad pair 2 has exactly one violation',
    out2.success === true && out2.violationCount === 1,
    `count=${out2.violationCount}`
  );
  check('enclosure: CB flagged once', t2.get('CB:ENCLOSURE_VIOLATION') === 1);

  const goodRules = {
    minWidth: 2,
    minSpacing: 2,
    minArea: 10,
    enclosures: [{ layer: 'E', enclosingLayer: 'H', margin: 4 }]
  };
  const good = [
    { id: 'HC', layer: 'H', vertices: rect(0, 0, 60, 60) },
    { id: 'CC', layer: 'E', vertices: rect(5, 5, 55, 55) }
  ];
  const { out: outGood } = runScene('enclosure-good', good, goodRules);
  check(
    'enclosure: conforming candidate has zero violations',
    outGood.success === true && outGood.violationCount === 0,
    `count=${outGood.violationCount}`
  );
}

// --- Scene 5: fail-closed malformed input ---
{
  const malformed = [
    { name: 'empty shapes', shapes: [], rules: { minWidth: 2, minSpacing: 2 } },
    { name: 'missing rules', shapes: [{ id: 'A', layer: 'M', vertices: rect(0, 0, 10, 10) }], rules: {} },
    {
      name: 'duplicate ids',
      shapes: [
        { id: 'A', layer: 'M', vertices: rect(0, 0, 10, 10) },
        { id: 'A', layer: 'M', vertices: rect(20, 0, 30, 10) }
      ],
      rules: { minWidth: 2, minSpacing: 2 }
    },
    {
      name: 'self-intersecting polygon',
      shapes: [
        {
          id: 'B',
          layer: 'M',
          vertices: r([
            [0, 0],
            [10, 10],
            [10, 0],
            [0, 10]
          ])
        }
      ],
      rules: { minWidth: 2, minSpacing: 2 }
    },
    {
      name: 'negative coordinates disallowed',
      shapes: [{ id: 'C', layer: 'M', vertices: rect(-5, 0, 5, 10) }],
      rules: { minWidth: 2, minSpacing: 2, allowNegativeCoordinates: false }
    }
  ];
  const FAIL_CLOSED_CODES = new Set(['INVALID_INPUT', 'INVALID_POLYGON_SELF_INTERSECTION']);
  for (const m of malformed) {
    const out = DRCEngine.runPolygonDRC(m.shapes, m.rules);
    check(
      `malformed: ${m.name} fails closed`,
      out.success === false && out.error && FAIL_CLOSED_CODES.has(out.error.code),
      out.error ? out.error.code : 'no error'
    );
  }
}

console.log(`\neda_drc: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
