'use strict';

const assert = require('assert');
const { PlaceAndRouteEngine } = require('../src/core/eda/place_and_route_engine');
const { DRCEngine } = require('../src/core/eda/drc_engine');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateNetlist(seed) {
  const rng = mulberry32(seed);
  const numCells = 20;
  const cells = [];
  for (let i = 0; i < numCells; i++) {
    cells.push({ id: `u${i}`, width: Math.round(6 + rng() * 9), height: 8 });
  }
  const nets = [];
  for (let i = 0; i < 18; i++) {
    const fanout = 2 + Math.floor(rng() * 3);
    const pins = [];
    const seen = new Set();
    while (pins.length < fanout) {
      const idx = Math.floor(rng() * numCells);
      if (!seen.has(idx)) {
        seen.add(idx);
        pins.push(`u${idx}`);
      }
    }
    nets.push({ name: `net${i}`, pins });
  }
  return { cells, nets };
}

function countOverlaps(placements) {
  const list = Object.values(placements);
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (dx > 1e-6 && dy > 1e-6) count++;
    }
  }
  return count;
}

function assertLegal(placements, coreWidth, coreHeight, rowHeight, cellHeight) {
  for (const p of Object.values(placements)) {
    assert(p.x >= -1e-6 && p.y >= -1e-6, `cell ${p.cellId} out of core bounds`);
    assert(p.x + p.width <= coreWidth + 1e-6, `cell ${p.cellId} exceeds core width`);
    assert(p.y + p.height <= coreHeight + 1e-6, `cell ${p.cellId} exceeds core height`);
    const rowIndex = Math.round(p.y / rowHeight);
    assert(Math.abs(p.y - rowIndex * rowHeight) < 1e-6, `cell ${p.cellId} off row grid`);
    assert(Math.abs(p.height - cellHeight) < 1e-6, `cell ${p.cellId} height changed`);
  }
  assert.strictEqual(countOverlaps(placements), 0, 'final placement must have zero overlaps');
}

(async () => {
  console.log('================================================================');
  console.log('  PLACEMENT ANNEALING: OPTIMIZATION-BASED P&R (20 cells / 3 rows)');
  console.log('================================================================\n');

  const coreWidth = 200;
  const coreHeight = 30;
  const stdCellHeight = 10;
  const cellHeight = 8;
  const circuit = generateNetlist(20241101);
  assert.strictEqual(circuit.cells.length, 20);

  const seeds = [101, 102, 103, 104, 105];
  const before = [];
  const after = [];
  const runtimes = [];

  let seed101Placements = null;
  for (const seed of seeds) {
    const engine = new PlaceAndRouteEngine({ coreWidth, coreHeight, stdCellHeight });
    const t0 = Date.now();
    const result = engine.runPlaceAndRoute(circuit, { optimizer: 'annealing', seed });
    const runtimeMs = Date.now() - t0;

    const metrics = result.telemetry.placementMetrics;
    before.push(metrics.hpwlBeforeMicrons);
    after.push(metrics.hpwlAfterMicrons);
    runtimes.push(runtimeMs);

    assert.strictEqual(result.status, 'EXPERIMENTAL_LAYOUT_ESTIMATE');
    assert.strictEqual(result.telemetry.optimizer, 'annealing');
    assert.strictEqual(result.telemetry.seed, seed);
    assert.strictEqual(result.cellsPlacedCount, 20);

    assertLegal(result.placements, coreWidth, coreHeight, stdCellHeight, cellHeight);
    assert.strictEqual(metrics.overlapCountAfter, 0);
    assert.strictEqual(metrics.overlapCountBefore, 0, 'greedy baseline is overlap-free');
    assert(runtimeMs < 5000, `seed ${seed} runtime ${runtimeMs}ms must be < 5000ms`);
    assert(Number.isInteger(metrics.iterations) && metrics.iterations > 0);
    assert.strictEqual(metrics.converged, true);

    console.log(
      `  seed=${seed}  HPWL ${metrics.hpwlBeforeMicrons} -> ${metrics.hpwlAfterMicrons} um` +
        `  (${metrics.iterations} iter, ${runtimeMs}ms)`
    );
    if (seed === 101) seed101Placements = result.placements;
  }

  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const beforeMean = mean(before);
  const afterMean = mean(after);
  console.log(`\n  mean HPWL before: ${beforeMean.toFixed(1)} um, after: ${afterMean.toFixed(1)} um`);
  assert(afterMean < beforeMean, `annealing must reduce HPWL on average (${afterMean} < ${beforeMean})`);

  // Determinism: same seed => identical placements.
  const engine = new PlaceAndRouteEngine({ coreWidth, coreHeight, stdCellHeight });
  const rerun = engine.runPlaceAndRoute(circuit, { optimizer: 'annealing', seed: 101 });
  assert.deepStrictEqual(rerun.placements, seed101Placements);
  const metricsNoRuntime = (m) => {
    const copy = { ...m };
    delete copy.runtimeMs;
    return copy;
  };
  assert.deepStrictEqual(
    metricsNoRuntime(rerun.telemetry.placementMetrics),
    metricsNoRuntime(engine.runPlaceAndRoute(circuit, { seed: 101 }).telemetry.placementMetrics)
  );
  console.log('  determinism: same seed -> identical placements and metrics ✓');

  // DRC on the final layout via the existing box DRC engine.
  const shapes = Object.values(seed101Placements).map((p) => ({
    id: p.cellId,
    layer: 'metal1',
    x: p.x,
    y: p.y,
    w: p.width,
    h: p.height
  }));
  const drc = DRCEngine.runDRC(shapes, { minWidth: 1, minSpacing: 2, minArea: 4 });
  assert.strictEqual(drc.success, true);
  assert.strictEqual(drc.violationCount, 0, `DRC violations: ${JSON.stringify(drc.violations)}`);
  assert.strictEqual(drc.clean, true);
  console.log('  DRC: final layout clean (0 violations) ✓');

  // Greedy path still works (backward compatibility).
  const greedy = engine.runPlaceAndRoute(circuit, { optimizer: 'greedy' });
  assert.strictEqual(greedy.telemetry.optimizer, 'greedy');
  assert.strictEqual(greedy.telemetry.placementMetrics.overlapCountAfter, 0);
  assert(greedy.telemetry.placementMetrics.hpwlAfterMicrons > 0);
  console.log('  greedy optimizer path still available and legal ✓');

  console.log('\n================================================================');
  console.log('  ALL PLACEMENT ANNEALING TESTS PASSED');
  console.log('================================================================\n');
})();
