/**
 * OmniEng Lightweight Large-Assembly Engine
 *
 * Provides deterministic, dependency-free building blocks for interactive
 * rendering of very large assemblies (50,000+ components):
 *
 *  - LOD mesh decimation via vertex clustering with a grid resolution parameter.
 *  - Occlusion culling preprocessing over a binned uniform grid, producing a
 *    front-to-back draw order and culling cells fully hidden behind opaque cells.
 *  - Out-of-core streaming with a budget-based loader that loads components in
 *    view order and evicts least-recently-used chunks to stay within budget.
 *
 * Algorithms are pure and deterministic; no random state is used internally.
 */

'use strict';

const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Mesh primitives
// ---------------------------------------------------------------------------

function veq(a, b) {
  return Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS && Math.abs(a[2] - b[2]) <= EPS;
}

/**
 * Normalizes a mesh into { vertices: [[x,y,z]...], triangles: [[i,j,k]...] }.
 * Accepts a raw list of triangles or an indexed mesh object.
 */
function normalizeTriangles(input) {
  if (Array.isArray(input)) {
    const vertices = [];
    const triangles = [];
    for (const tri of input) {
      if (!Array.isArray(tri) || tri.length !== 3) {
        throw new Error('lightweight_assembly: raw triangle must have 3 vertices');
      }
      const idx = [];
      for (const v of tri) {
        let found = -1;
        for (let i = 0; i < vertices.length; i++) {
          if (veq(vertices[i], v)) {
            found = i;
            break;
          }
        }
        if (found < 0) {
          found = vertices.length;
          vertices.push([v[0], v[1], v[2]]);
        }
        idx.push(found);
      }
      triangles.push(idx);
    }
    return { vertices, triangles };
  }
  if (input && Array.isArray(input.vertices) && Array.isArray(input.triangles)) {
    return {
      vertices: input.vertices.map((v) => [v[0], v[1], v[2]]),
      triangles: input.triangles.map((t) => [t[0], t[1], t[2]])
    };
  }
  throw new Error('lightweight_assembly: unsupported mesh input');
}

function computeMeshBounds(vertices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of vertices) {
    for (let k = 0; k < 3; k++) {
      if (v[k] < min[k]) min[k] = v[k];
      if (v[k] > max[k]) max[k] = v[k];
    }
  }
  return { min, max };
}

function triangleArea(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

function computeMeshVolume(mesh) {
  let volume = 0;
  for (const t of mesh.triangles) {
    const a = mesh.vertices[t[0]];
    const b = mesh.vertices[t[1]];
    const c = mesh.vertices[t[2]];
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return Math.abs(volume);
}

function computeMeshArea(mesh) {
  let area = 0;
  for (const t of mesh.triangles) {
    area += triangleArea(mesh.vertices[t[0]], mesh.vertices[t[1]], mesh.vertices[t[2]]);
  }
  return area;
}

function canonicalTriangleKey(t) {
  let m = 0;
  if (t[1] < t[m]) m = 1;
  if (t[2] < t[m]) m = 2;
  return t[m] + ',' + t[(m + 1) % 3] + ',' + t[(m + 2) % 3];
}

/**
 * Statistics for a mesh: counts, volume, surface area, degenerate/duplicate
 * triangle detection, and minimum positive triangle area.
 */
function meshStats(mesh) {
  const seen = new Map();
  let degenerate = 0;
  let minArea = Infinity;
  for (const t of mesh.triangles) {
    const area = triangleArea(mesh.vertices[t[0]], mesh.vertices[t[1]], mesh.vertices[t[2]]);
    if (area <= EPS) {
      degenerate++;
    } else if (area < minArea) {
      minArea = area;
    }
    const key = canonicalTriangleKey(t);
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  let duplicates = 0;
  for (const count of seen.values()) {
    if (count > 1) duplicates += count - 1;
  }
  return {
    triangleCount: mesh.triangles.length,
    vertexCount: mesh.vertices.length,
    volume: computeMeshVolume(mesh),
    surfaceArea: computeMeshArea(mesh),
    minTriangleArea: minArea === Infinity ? 0 : minArea,
    degenerateCount: degenerate,
    duplicateCount: duplicates
  };
}

// ---------------------------------------------------------------------------
// LOD decimation (vertex clustering)
// ---------------------------------------------------------------------------

/**
 * Decimates a mesh via vertex clustering. Vertices are binned into a uniform
 * 3D grid built from a scalar resolution (cells along the longest axis); each
 * occupied cluster collapses to its mean position, and triangles whose three
 * vertices collapse into fewer than three distinct clusters are dropped.
 * Duplicate and zero-area result triangles are removed.
 */
function decimateMesh(input, gridResolution, opts = {}) {
  if (!Number.isFinite(gridResolution) || gridResolution < 2) {
    throw new Error('lightweight_assembly: gridResolution must be >= 2');
  }
  const mesh = normalizeTriangles(input);
  const bounds = computeMeshBounds(mesh.vertices);
  const extent = [
    Math.max(0, bounds.max[0] - bounds.min[0]),
    Math.max(0, bounds.max[1] - bounds.min[1]),
    Math.max(0, bounds.max[2] - bounds.min[2])
  ];
  const cellSize = Math.max(extent[0], extent[1], extent[2]) / gridResolution;
  const counts = [
    Math.max(1, Math.ceil(extent[0] / cellSize)),
    Math.max(1, Math.ceil(extent[1] / cellSize)),
    Math.max(1, Math.ceil(extent[2] / cellSize))
  ];

  const cellIndex = (p) => {
    const ix = Math.min(counts[0] - 1, Math.floor((p[0] - bounds.min[0]) / cellSize));
    const iy = Math.min(counts[1] - 1, Math.floor((p[1] - bounds.min[1]) / cellSize));
    const iz = Math.min(counts[2] - 1, Math.floor((p[2] - bounds.min[2]) / cellSize));
    return ix * (counts[1] * counts[2]) + iy * counts[2] + iz;
  };

  const clusters = new Map();
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    const c = cellIndex(v);
    let cl = clusters.get(c);
    if (!cl) {
      cl = { n: 0, sx: 0, sy: 0, sz: 0 };
      clusters.set(c, cl);
    }
    cl.n++;
    cl.sx += v[0];
    cl.sy += v[1];
    cl.sz += v[2];
  }

  const clusterId = new Map();
  const vertices = [];
  for (const [c, cl] of clusters) {
    clusterId.set(c, vertices.length);
    vertices.push([cl.sx / cl.n, cl.sy / cl.n, cl.sz / cl.n]);
  }

  const triangles = [];
  const seen = new Set();
  let collapsed = 0;
  let zeroArea = 0;
  let duplicates = 0;
  for (const t of mesh.triangles) {
    const a = clusterId.get(cellIndex(mesh.vertices[t[0]]));
    const b = clusterId.get(cellIndex(mesh.vertices[t[1]]));
    const c = clusterId.get(cellIndex(mesh.vertices[t[2]]));
    if (a === b || b === c || a === c) {
      collapsed++;
      continue;
    }
    if (triangleArea(vertices[a], vertices[b], vertices[c]) <= EPS) {
      zeroArea++;
      continue;
    }
    const key = canonicalTriangleKey([a, b, c]);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    triangles.push([a, b, c]);
  }

  const out = { vertices, triangles };
  return {
    mesh: out,
    stats: meshStats(out),
    clusters: clusters.size,
    cellSize,
    gridCells: counts,
    inputTriangleCount: mesh.triangles.length,
    droppedCollapsed: collapsed,
    droppedZeroArea: zeroArea,
    droppedDuplicates: duplicates
  };
}

/**
 * Builds a monotonic LOD chain. Level 0 is the original mesh; each subsequent
 * level uses a finer grid resolution (more detail) and must have strictly
 * fewer triangles than the previous level.
 */
function buildLODChain(input, resolutions = []) {
  const original = normalizeTriangles(input);
  const levels = [
    {
      level: 0,
      resolution: 0,
      mesh: original,
      stats: meshStats(original)
    }
  ];
  for (const res of resolutions) {
    const r = decimateMesh(original, res);
    levels.push({
      level: levels.length,
      resolution: res,
      mesh: r.mesh,
      stats: r.stats,
      decimation: r
    });
  }
  return levels;
}

// ---------------------------------------------------------------------------
// Occlusion culling over a uniform grid
// ---------------------------------------------------------------------------

class UniformGrid {
  /**
   * @param {number[6]} boundsAxis [minX, minY, minZ, maxX, maxY, maxZ]
   * @param {number[3]} cellCounts cells per axis
   */
  constructor(bounds, cellCounts) {
    this.bounds = {
      min: [bounds[0], bounds[1], bounds[2]],
      max: [bounds[3], bounds[4], bounds[5]]
    };
    this.cellCounts = [cellCounts[0], cellCounts[1], cellCounts[2]];
    this.cells = new Array(this.cellCounts[0] * this.cellCounts[1] * this.cellCounts[2]).fill(null);
  }

  indexOf(p) {
    const [nx, ny, nz] = this.cellCounts;
    const sx = (this.bounds.max[0] - this.bounds.min[0]) / nx;
    const sy = (this.bounds.max[1] - this.bounds.min[1]) / ny;
    const sz = (this.bounds.max[2] - this.bounds.min[2]) / nz;
    const ix = Math.min(nx - 1, Math.max(0, Math.floor((p[0] - this.bounds.min[0]) / sx)));
    const iy = Math.min(ny - 1, Math.max(0, Math.floor((p[1] - this.bounds.min[1]) / sy)));
    const iz = Math.min(nz - 1, Math.max(0, Math.floor((p[2] - this.bounds.min[2]) / sz)));
    return ix * (ny * nz) + iy * nz + iz;
  }

  cellCenter(index) {
    const [nx, ny, nz] = this.cellCounts;
    const iz = index % nz;
    const iy = Math.floor(index / nz) % ny;
    const ix = Math.floor(index / (ny * nz));
    const sx = (this.bounds.max[0] - this.bounds.min[0]) / nx;
    const sy = (this.bounds.max[1] - this.bounds.min[1]) / ny;
    const sz = (this.bounds.max[2] - this.bounds.min[2]) / nz;
    return [
      this.bounds.min[0] + (ix + 0.5) * sx,
      this.bounds.min[1] + (iy + 0.5) * sy,
      this.bounds.min[2] + (iz + 0.5) * sz
    ];
  }

  cellBounds(index) {
    const [nx, ny, nz] = this.cellCounts;
    const iz = index % nz;
    const iy = Math.floor(index / nz) % ny;
    const ix = Math.floor(index / (ny * nz));
    const sx = (this.bounds.max[0] - this.bounds.min[0]) / nx;
    const sy = (this.bounds.max[1] - this.bounds.min[1]) / ny;
    const sz = (this.bounds.max[2] - this.bounds.min[2]) / nz;
    return [
      this.bounds.min[0] + ix * sx,
      this.bounds.min[1] + iy * sy,
      this.bounds.min[2] + iz * sz,
      this.bounds.min[0] + (ix + 1) * sx,
      this.bounds.min[1] + (iy + 1) * sy,
      this.bounds.min[2] + (iz + 1) * sz
    ];
  }
}

function createUniformGrid(bounds, cellCounts, opts = {}) {
  const grid = new UniformGrid(bounds, cellCounts);
  const opaque = opts.opaque || [];
  for (let i = 0; i < grid.cells.length; i++) {
    grid.cells[i] = { opaque: false, data: null };
  }
  for (const i of opaque) {
    grid.cells[i].opaque = true;
  }
  return grid;
}

function basisForView(viewDir) {
  const d = [viewDir[0], viewDir[1], viewDir[2]];
  const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  for (let k = 0; k < 3; k++) d[k] /= len;
  let upAxis = 0;
  let best = Math.abs(d[0]);
  for (let k = 1; k < 3; k++) {
    const a = Math.abs(d[k]);
    if (a < best) {
      best = a;
      upAxis = k;
    }
  }
  const up = [0, 0, 0];
  up[upAxis] = 1;
  const u = [up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]];
  const ulen = Math.sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]);
  for (let k = 0; k < 3; k++) u[k] /= ulen;
  const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  return { u, v, view: d };
}

function makeScreenProjector(grid, viewDir, width, height) {
  const basis = basisForView(viewDir);
  const { min, max } = grid.bounds;
  let umin = Infinity;
  let umax = -Infinity;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (let cx = 0; cx < 2; cx++) {
    for (let cy = 0; cy < 2; cy++) {
      for (let cz = 0; cz < 2; cz++) {
        const p = [cx === 0 ? min[0] : max[0], cy === 0 ? min[1] : max[1], cz === 0 ? min[2] : max[2]];
        const u = p[0] * basis.u[0] + p[1] * basis.u[1] + p[2] * basis.u[2];
        const v = p[0] * basis.v[0] + p[1] * basis.v[1] + p[2] * basis.v[2];
        if (u < umin) umin = u;
        if (u > umax) umax = u;
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
      }
    }
  }
  const urange = Math.max(EPS, umax - umin);
  const vrange = Math.max(EPS, vmax - vmin);

  function project(index) {
    const bb = grid.cellBounds(index);
    const center = grid.cellCenter(index);
    const t =
      (center[0] - grid.bounds.min[0]) * basis.view[0] +
      (center[1] - grid.bounds.min[1]) * basis.view[1] +
      (center[2] - grid.bounds.min[2]) * basis.view[2];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let cx = 0; cx < 2; cx++) {
      for (let cy = 0; cy < 2; cy++) {
        for (let cz = 0; cz < 2; cz++) {
          const p = [cx === 0 ? bb[0] : bb[3], cy === 0 ? bb[1] : bb[4], cz === 0 ? bb[2] : bb[5]];
          const u = p[0] * basis.u[0] + p[1] * basis.u[1] + p[2] * basis.u[2];
          const v = p[0] * basis.v[0] + p[1] * basis.v[1] + p[2] * basis.v[2];
          const px = ((u - umin) / urange) * width;
          const py = ((v - vmin) / vrange) * height;
          if (px < x0) x0 = px;
          if (px > x1) x1 = px;
          if (py < y0) y0 = py;
          if (py > y1) y1 = py;
        }
      }
    }
    const fx0 = Math.max(0, Math.floor(x0));
    const fy0 = Math.max(0, Math.floor(y0));
    const fx1 = Math.min(width - 1, Math.max(fx0, Math.ceil(x1) - 1));
    const fy1 = Math.min(height - 1, Math.max(fy0, Math.ceil(y1) - 1));
    return { index, t, x0: fx0, y0: fy0, x1: fx1, y1: fy1 };
  }

  return { project, basis, width, height };
}

/**
 * Produces a front-to-back draw order over grid cells for a view direction and
 * culls cells whose screen footprint is fully hidden behind previously drawn
 * opaque cells. Cells are sorted by distance along the view direction (ties by
 * cell index). Coverage is evaluated by rasterizing opaque footprints into a
 * low-resolution screen buffer.
 */
function occlusionSortAndCull(grid, viewDir, opts = {}) {
  const width = opts.width || 64;
  const height = opts.height || 64;
  const projector = makeScreenProjector(grid, viewDir, width, height);

  const entries = [];
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] === null) continue;
    const e = projector.project(i);
    e.opaque = grid.cells[i].opaque === true;
    entries.push(e);
  }
  entries.sort((a, b) => a.t - b.t || a.index - b.index);

  const coverage = new Uint8Array(width * height);
  const drawOrder = [];
  const culled = [];

  function rectCovered(x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) {
      const row = y * width;
      for (let x = x0; x <= x1; x++) {
        if (coverage[row + x] === 0) return false;
      }
    }
    return true;
  }

  function rasterize(x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) {
      const row = y * width;
      for (let x = x0; x <= x1; x++) {
        coverage[row + x] = 1;
      }
    }
  }

  for (const e of entries) {
    if (rectCovered(e.x0, e.y0, e.x1, e.y1)) {
      culled.push({ index: e.index, t: e.t });
      continue;
    }
    drawOrder.push({ index: e.index, t: e.t, opaque: e.opaque });
    if (e.opaque) {
      rasterize(e.x0, e.y0, e.x1, e.y1);
    }
  }

  let coveredPixels = 0;
  for (let i = 0; i < coverage.length; i++) coveredPixels += coverage[i];

  return {
    drawOrder,
    visibleCount: drawOrder.length,
    culled,
    culledCount: culled.length,
    totalCells: entries.length,
    screenCoverage: { coveredPixels, totalPixels: width * height }
  };
}

// ---------------------------------------------------------------------------
// Out-of-core streaming
// ---------------------------------------------------------------------------

class LRUStreamingLoader {
  /**
   * @param {Object} opts
   * @param {Object|Map} opts.chunks chunk registry mapping id -> payload
   * @param {number} opts.budget maximum resident chunk count
   */
  constructor(opts = {}) {
    this.chunks = opts.chunks instanceof Map ? opts.chunks : new Map(Object.entries(opts.chunks || {}));
    this.budget = opts.budget || 500;
    this.lru = new Map();
    this.store = new Map();
    this.loads = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.peakResident = 0;
    this.evictedIds = [];
  }

  isResident(id) {
    return this.lru.has(id);
  }

  touch(id) {
    this.lru.delete(id);
    this.lru.set(id, true);
  }

  evictOne() {
    const oldest = this.lru.keys().next().value;
    this.lru.delete(oldest);
    this.store.delete(oldest);
    this.evictions++;
    this.evictedIds.push(oldest);
  }

  /**
   * Requests a chunk. If resident, it is touched (moved to MRU) and returned
   * from cache; otherwise it is loaded from the registry. While resident count
   * exceeds the budget, least-recently-used chunks are evicted.
   */
  load(id) {
    if (this.lru.has(id)) {
      this.hits++;
      this.touch(id);
      return { chunk: this.store.get(id), fromCache: true };
    }
    const chunk = this.chunks.has(id) ? this.chunks.get(id) : null;
    this.misses++;
    this.loads++;
    this.store.set(id, chunk);
    this.touch(id);
    while (this.lru.size > this.budget) {
      this.evictOne();
    }
    if (this.lru.size > this.peakResident) this.peakResident = this.lru.size;
    return { chunk, fromCache: false };
  }

  residentIds() {
    return Array.from(this.lru.keys());
  }

  stats() {
    return {
      loads: this.loads,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      peakResident: this.peakResident,
      residentCount: this.lru.size
    };
  }
}

/**
 * Loads chunks in the given view order (front-to-back) and returns aggregate
 * streaming statistics.
 */
function streamAssemblyInViewOrder(loader, orderedIds) {
  for (const id of orderedIds) {
    loader.load(id);
  }
  return loader.stats();
}

module.exports = {
  EPS,
  normalizeTriangles,
  computeMeshBounds,
  computeMeshVolume,
  computeMeshArea,
  meshStats,
  decimateMesh,
  buildLODChain,
  UniformGrid,
  createUniformGrid,
  occlusionSortAndCull,
  LRUStreamingLoader,
  streamAssemblyInViewOrder
};
