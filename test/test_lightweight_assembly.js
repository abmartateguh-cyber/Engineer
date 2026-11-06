/**
 * Verification gate for the lightweight large-assembly engine
 * (src/core/cad/lightweight_assembly.js): LOD decimation, occlusion culling
 * preprocessing, and out-of-core streaming. Deterministic; no external deps.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/core/cad/lightweight_assembly');

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function generateSphereMesh(radius, lonSeg, latSeg) {
  const vertices = [];
  const triangles = [];
  for (let j = 0; j <= latSeg; j++) {
    const phi = (Math.PI * j) / latSeg;
    for (let i = 0; i <= lonSeg; i++) {
      const theta = (2 * Math.PI * i) / lonSeg;
      vertices.push([
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi)
      ]);
    }
  }
  for (let j = 0; j < latSeg; j++) {
    for (let i = 0; i < lonSeg; i++) {
      const a = j * (lonSeg + 1) + i;
      const b = a + 1;
      const c = a + (lonSeg + 1);
      const d = c + 1;
      triangles.push([a, c, b], [b, c, d]);
    }
  }
  return { vertices, triangles };
}

function assertClose(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ${expected} +/- ${tol}, got ${actual}`);
}

// ---------------------------------------------------------------------------
// LOD decimation
// ---------------------------------------------------------------------------

test('decimation: 10k-triangle sphere at grid res 11 -> ~1k tris, volume within 5%', () => {
  const sphere = generateSphereMesh(10, 80, 64);
  assert.strictEqual(sphere.triangles.length, 10240);

  const baseStats = L.meshStats(sphere);
  const r = L.decimateMesh(sphere, 11);
  const s = r.stats;

  console.log(
    `[decimation] input=${baseStats.triangleCount} tris, output=${s.triangleCount} tris, ` +
      `clusters=${r.clusters}, ratio=${(s.triangleCount / baseStats.triangleCount).toFixed(3)}`
  );

  assert.ok(s.triangleCount <= 1100, `expected <= 1100 triangles, got ${s.triangleCount}`);
  assert.ok(s.triangleCount >= 800, `expected ~1000 triangles, got ${s.triangleCount}`);

  const volRatio = s.volume / baseStats.volume;
  console.log(
    `[decimation] volume ${baseStats.volume.toFixed(2)} -> ${s.volume.toFixed(2)} ` +
      `(${(volRatio * 100).toFixed(2)}% of original)`
  );
  assertClose(volRatio, 1, 0.05, 'decimated volume within 5% of original');

  assert.strictEqual(s.degenerateCount, 0, 'no degenerate triangles');
  assert.ok(s.minTriangleArea > 0, 'positive triangle area');
  assert.strictEqual(s.duplicateCount, 0, 'no duplicate triangles');
});

test('decimation: LOD chain of 4 levels is monotonic in triangle count', () => {
  const sphere = generateSphereMesh(10, 80, 64);
  const resolutions = [14, 11, 7];
  const chain = L.buildLODChain(sphere, resolutions);

  assert.strictEqual(chain.length, 4);
  assert.strictEqual(chain[0].stats.triangleCount, 10240);

  const counts = chain.map((level) => level.stats.triangleCount);
  console.log(`[lod-chain] counts=${counts.join(' > ')} (resolutions ${resolutions.join('/')})`);
  for (let i = 1; i < chain.length; i++) {
    assert.ok(
      counts[i] < counts[i - 1],
      `LOD${i} (${counts[i]}) must have fewer triangles than LOD${i - 1} (${counts[i - 1]})`
    );
  }
});

test('decimation: deterministic across runs', () => {
  const sphere = generateSphereMesh(10, 80, 64);
  const a = L.decimateMesh(sphere, 11);
  const b = L.decimateMesh(sphere, 11);
  assert.deepStrictEqual(a.mesh.vertices, b.mesh.vertices);
  assert.deepStrictEqual(a.mesh.triangles, b.mesh.triangles);
  assert.deepStrictEqual(a.stats, b.stats);
});

// ---------------------------------------------------------------------------
// Occlusion culling
// ---------------------------------------------------------------------------

test('culling: front-to-back order and cull of fully hidden cell', () => {
  const bounds = [0, 0, 0, 16, 16, 16];
  const counts = [4, 4, 4];

  const opaqueCell = 22; // (1,1,2): x/y [4,8], z [8,12]
  const hiddenCell = 23; // (1,1,3): x/y [4,8], z [12,16], fully behind opaque
  const nearCell = 20; // (1,1,0): x/y [4,8], z [0,4]
  const farOffsetCell = 63; // (3,3,3): x/y [12,16], z [12,16], not covered

  const grid = L.createUniformGrid(bounds, counts, { opaque: [opaqueCell] });

  const res = L.occlusionSortAndCull(grid, [0, 0, 1]);

  const drawIndices = res.drawOrder.map((e) => e.index);
  const byIndex = new Map(res.drawOrder.map((e) => [e.index, e]));

  console.log(
    `[culling] visible=${res.visibleCount} culled=${res.culledCount} ` +
      `coverage=${res.screenCoverage.coveredPixels}/${res.screenCoverage.totalPixels}px`
  );

  assert.ok(byIndex.has(opaqueCell), 'opaque cell is drawn');
  assert.ok(byIndex.has(nearCell), 'near cell is drawn');
  assert.ok(byIndex.has(farOffsetCell), 'offset non-covered far cell is drawn');
  assert.ok(!byIndex.has(hiddenCell), 'fully hidden cell is omitted from draw list');

  const culledIndices = res.culled.map((e) => e.index);
  assert.ok(culledIndices.includes(hiddenCell), `hidden cell ${hiddenCell} is culled`);
  assert.strictEqual(res.culledCount, 1, 'exactly one cell culled in probe scene');

  assert.ok(byIndex.get(nearCell).t < byIndex.get(opaqueCell).t, 'near cell drawn before opaque');
  assert.ok(byIndex.get(opaqueCell).t < byIndex.get(farOffsetCell).t, 'opaque drawn before far offset');
  assert.ok(byIndex.get(hiddenCell) === undefined);

  for (let i = 1; i < res.drawOrder.length; i++) {
    assert.ok(res.drawOrder[i].t >= res.drawOrder[i - 1].t, 'draw order is front-to-back');
  }
});

test('culling: deterministic across runs', () => {
  const gridA = L.createUniformGrid([0, 0, 0, 16, 16, 16], [4, 4, 4], { opaque: [22] });
  const gridB = L.createUniformGrid([0, 0, 0, 16, 16, 16], [4, 4, 4], { opaque: [22] });
  const a = L.occlusionSortAndCull(gridA, [0, 0, 1]);
  const b = L.occlusionSortAndCull(gridB, [0, 0, 1]);
  assert.deepStrictEqual(a.drawOrder, b.drawOrder);
  assert.deepStrictEqual(a.culled, b.culled);
});

// ---------------------------------------------------------------------------
// Out-of-core streaming
// ---------------------------------------------------------------------------

test('streaming: 5000-part assembly with 500-part budget', () => {
  const N = 5000;
  const BUDGET = 500;
  const rng = mulberry32(0xc0ffee);
  const ids = shuffle(
    Array.from({ length: N }, (_, i) => i),
    rng
  );

  const chunks = new Map();
  for (const id of ids) {
    chunks.set(id, { id, payload: `part-${id}` });
  }

  const loader = new L.LRUStreamingLoader({ chunks, budget: BUDGET });

  let delivered = 0;
  for (let i = 0; i < ids.length; i++) {
    const r = loader.load(ids[i]);
    assert.ok(r.chunk !== null, `part ${ids[i]} eventually delivered`);
    delivered++;
    assert.ok(loader.stats().residentCount <= BUDGET, 'resident never exceeds budget');
    if (i === 599) {
      assert.strictEqual(loader.stats().residentCount, BUDGET, 'resident at budget after warm-up');
      assert.strictEqual(loader.stats().evictions, 100, 'evictions keep pace after warm-up');
    }
  }

  assert.strictEqual(delivered, N);

  const stats = loader.stats();
  console.log(
    `[streaming] loads=${stats.loads} hits=${stats.hits} misses=${stats.misses} ` +
      `evictions=${stats.evictions} peakResident=${stats.peakResident}`
  );

  assert.strictEqual(stats.loads, N, 'each part loaded at least once');
  assert.strictEqual(stats.peakResident, BUDGET, 'peak resident == budget');
  assert.strictEqual(stats.evictions, N - BUDGET, 'every surplus load evicts one chunk');

  assert.deepStrictEqual(loader.evictedIds, ids.slice(0, N - BUDGET), 'evictions follow LRU request order');
  assert.deepStrictEqual(loader.residentIds(), ids.slice(N - BUDGET), 'resident set is the most recent budget');

  const reload = loader.load(ids[0]);
  assert.strictEqual(reload.fromCache, false, 'evicted part reloads on demand');
  assert.ok(reload.chunk !== null, 'reloaded chunk delivered');
  assert.strictEqual(loader.residentIds()[loader.residentIds().length - 1], ids[0], 'reloaded chunk becomes MRU');
  assert.strictEqual(loader.stats().residentCount, BUDGET, 'resident stays at budget after reload');

  const hit = loader.load(ids[4999]);
  assert.strictEqual(hit.fromCache, true, 'resident part served from cache');
  assert.strictEqual(loader.stats().hits, 1, 'exactly one cache hit in probe sequence');
});

test('streaming: deterministic across runs', () => {
  const N = 5000;
  const rng = mulberry32(0xc0ffee);
  const ids = shuffle(
    Array.from({ length: N }, (_, i) => i),
    rng
  );
  const chunks = new Map();
  for (const id of ids) chunks.set(id, { id });

  const a = new L.LRUStreamingLoader({ chunks, budget: 500 });
  const b = new L.LRUStreamingLoader({ chunks, budget: 500 });
  for (const id of ids) {
    a.load(id);
    b.load(id);
  }
  assert.deepStrictEqual(a.stats(), b.stats());
  assert.deepStrictEqual(a.residentIds(), b.residentIds());
  assert.deepStrictEqual(a.evictedIds, b.evictedIds);
});
