'use strict';

const assert = require('assert');
const { computeWindowBounds } = require('../src/main/window_bounds');

const cases = [
  {
    name: '1440x900 display (work area 835px tall)',
    work: { width: 1440, height: 835 },
    target: { width: 1440, height: 835 }
  },
  { name: '1920x1080 display', work: { width: 1920, height: 1040 }, target: { width: 1440, height: 840 } },
  { name: '1280x800 display', work: { width: 1280, height: 720 }, target: { width: 1280, height: 720 } },
  { name: '1024x600 display', work: { width: 1024, height: 560 }, target: { width: 1024, height: 560 } },
  { name: '800x500 display', work: { width: 800, height: 460 }, target: { width: 800, height: 460 } },
  { name: 'no display info', work: null, target: { width: 1440, height: 840 } }
];

let passed = 0;
for (const c of cases) {
  const b = computeWindowBounds(c.work);
  const workW = c.work ? c.work.width : 1440;
  const workH = c.work ? c.work.height : 900;
  // (1) window never exceeds work area on either axis (no clipping)
  assert(b.width <= workW, `${c.name}: width ${b.width} exceeds work width ${workW}`);
  assert(b.height <= workH, `${c.name}: height ${b.height} exceeds work height ${workH}`);
  // (2) expected clamped values
  assert.strictEqual(b.width, c.target.width, `${c.name}: width expected ${c.target.width}, got ${b.width}`);
  assert.strictEqual(b.height, c.target.height, `${c.name}: height expected ${c.target.height}, got ${b.height}`);
  // (3) min sizes never exceed the work area either
  assert(b.minWidth <= workW, `${c.name}: minWidth ${b.minWidth} exceeds work width ${workW}`);
  assert(b.minHeight <= workH, `${c.name}: minHeight ${b.minHeight} exceeds work height ${workH}`);
  passed++;
}

console.log(`window_bounds: ${passed}/${cases.length} passed`);
process.exit(passed === cases.length ? 0 : 1);
