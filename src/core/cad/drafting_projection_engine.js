'use strict';

const EPSILON = 1e-9;
const EDGE_SAMPLES = 64;
const LAYOUT_GAP = 1.0;
const ISO_SHARED = 1 / Math.sqrt(3);
const ISO_X = 1 / Math.sqrt(2);
const ISO_Y = Math.sqrt(2 / 3);
const ISO_Z = 1 / Math.sqrt(6);

function buildViewMatrices(convention) {
  const third = convention !== 'first-angle';
  const front = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, -1]
  ];
  const top = third
    ? [
        [1, 0, 0],
        [0, 0, -1],
        [0, -1, 0]
      ]
    : [
        [1, 0, 0],
        [0, 0, 1],
        [0, -1, 0]
      ];
  const right = third
    ? [
        [0, 0, -1],
        [0, 1, 0],
        [-1, 0, 0]
      ]
    : [
        [0, 0, 1],
        [0, 1, 0],
        [-1, 0, 0]
      ];
  const isometric = [
    [ISO_X, 0, -ISO_X],
    [-ISO_Z, ISO_Y, -ISO_Z],
    [ISO_SHARED, ISO_SHARED, ISO_SHARED]
  ];
  return { front, top, right, isometric };
}

function matMulVec(m, p) {
  return [
    m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2],
    m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2],
    m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2]
  ];
}

function pointInTriangle(px, py, tri) {
  const ax = tri.a[0];
  const ay = tri.a[1];
  const bx = tri.b[0];
  const by = tri.b[1];
  const cx = tri.c[0];
  const cy = tri.c[1];
  const d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const d2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const d3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const hasNeg = d1 < -EPSILON || d2 < -EPSILON || d3 < -EPSILON;
  const hasPos = d1 > EPSILON || d2 > EPSILON || d3 > EPSILON;
  if (hasNeg && hasPos) return null;
  const sum = d1 + d2 + d3;
  if (Math.abs(sum) < EPSILON) return null;
  const wa = d1 / sum;
  const wb = d2 / sum;
  const wc = d3 / sum;
  return wa * tri.a[2] + wb * tri.b[2] + wc * tri.c[2];
}

function createBox(min, max) {
  const x0 = min[0];
  const y0 = min[1];
  const z0 = min[2];
  const x1 = max[0];
  const y1 = max[1];
  const z1 = max[2];
  const p000 = [x0, y0, z0];
  const p100 = [x1, y0, z0];
  const p110 = [x1, y1, z0];
  const p010 = [x0, y1, z0];
  const p001 = [x0, y0, z1];
  const p101 = [x1, y0, z1];
  const p111 = [x1, y1, z1];
  const p011 = [x0, y1, z1];
  const edges = [
    [p000, p100],
    [p100, p110],
    [p110, p010],
    [p010, p000],
    [p001, p101],
    [p101, p111],
    [p111, p011],
    [p011, p001],
    [p000, p001],
    [p100, p101],
    [p110, p111],
    [p010, p011]
  ];
  const quads = [
    [p000, p100, p110, p010],
    [p001, p011, p111, p101],
    [p000, p001, p101, p100],
    [p100, p101, p111, p110],
    [p110, p111, p011, p010],
    [p010, p011, p001, p000]
  ];
  const triangles = [];
  for (const q of quads) {
    triangles.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
  }
  return { edges, triangles };
}

function createCube() {
  return createBox([0, 0, 0], [1, 1, 1]);
}

class DraftingProjectionEngine {
  constructor(model, options) {
    const opts = options || {};
    this.convention = opts.convention || 'third-angle';
    if (this.convention !== 'third-angle' && this.convention !== 'first-angle') {
      throw new Error(`Unknown projection convention: ${this.convention}`);
    }
    this.edges = model.edges.map((e) => [e[0].slice(), e[1].slice()]);
    this.triangles = model.triangles.map((t) => [t[0].slice(), t[1].slice(), t[2].slice()]);
    this.matrices = buildViewMatrices(this.convention);
    this._viewCache = new Map();
  }

  viewMatrix(name) {
    return this.matrices[name];
  }

  projectPoint(name, p) {
    const matrix = this.matrices[name];
    if (!matrix) throw new Error(`Unknown view: ${name}`);
    return matMulVec(matrix, p);
  }

  _projectedTriangles(name) {
    let cached = this._viewCache.get(name);
    if (cached) return cached;
    const matrix = this.matrices[name];
    const out = [];
    for (const tri of this.triangles) {
      const a = matMulVec(matrix, tri[0]);
      const b = matMulVec(matrix, tri[1]);
      const c = matMulVec(matrix, tri[2]);
      out.push({ a, b, c });
    }
    this._viewCache.set(name, out);
    return out;
  }

  isCovered(name, p) {
    const proj = this.projectPoint(name, p);
    const px = proj[0];
    const py = proj[1];
    const depth = proj[2];
    const triangles = this._projectedTriangles(name);
    for (const tri of triangles) {
      const triDepth = pointInTriangle(px, py, tri);
      if (triDepth !== null && triDepth < depth - EPSILON) return true;
    }
    return false;
  }

  _classifyEdge(name, edgeIndex, triangles) {
    const matrix = this.matrices[name];
    const a3 = this.edges[edgeIndex][0];
    const b3 = this.edges[edgeIndex][1];
    const pa = matMulVec(matrix, a3);
    const pb = matMulVec(matrix, b3);
    const ax = pa[0];
    const ay = pa[1];
    const bx = pb[0];
    const by = pb[1];
    const len2 = Math.hypot(bx - ax, by - ay);
    if (len2 < EPSILON) {
      return { degenerate: true, segments: [] };
    }
    const flags = new Array(EDGE_SAMPLES + 1);
    for (let i = 0; i <= EDGE_SAMPLES; i++) {
      const t = i / EDGE_SAMPLES;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const depth = pa[2] + (pb[2] - pa[2]) * t;
      let visible = true;
      for (const tri of triangles) {
        const triDepth = pointInTriangle(x, y, tri);
        if (triDepth !== null && triDepth < depth - EPSILON) {
          visible = false;
          break;
        }
      }
      flags[i] = visible;
    }
    const runs = [];
    let start = 0;
    for (let i = 1; i <= EDGE_SAMPLES; i++) {
      if (flags[i] !== flags[start]) {
        runs.push([start, i - 1, flags[start]]);
        start = i;
      }
    }
    runs.push([start, EDGE_SAMPLES, flags[start]]);
    const merged = [];
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (run[1] - run[0] + 1 >= 2) {
        merged.push(run);
        continue;
      }
      const prev = merged[merged.length - 1];
      if (prev) {
        prev[1] = run[1];
      } else if (i + 1 < runs.length) {
        runs[i + 1][0] = run[0];
      }
    }
    const segments = [];
    for (const run of merged) {
      const t0 = run[0] / EDGE_SAMPLES;
      const t1 = run[1] / EDGE_SAMPLES;
      segments.push({
        a: [ax + (bx - ax) * t0, ay + (by - ay) * t0],
        b: [ax + (bx - ax) * t1, ay + (by - ay) * t1],
        cls: run[2] ? 'visible' : 'hidden'
      });
    }
    return { degenerate: false, segments };
  }

  analyzeView(name) {
    if (!this.matrices[name]) throw new Error(`Unknown view: ${name}`);
    const triangles = this._projectedTriangles(name);
    const segments = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.edges.length; i++) {
      const res = this._classifyEdge(name, i, triangles);
      for (const seg of res.segments) {
        segments.push({
          edgeIndex: i,
          a: seg.a,
          b: seg.b,
          cls: seg.cls,
          worldA: this.edges[i][0],
          worldB: this.edges[i][1],
          degenerate: res.degenerate
        });
        const s = seg.a;
        const e = seg.b;
        if (s[0] < minX) minX = s[0];
        if (e[0] < minX) minX = e[0];
        if (s[0] > maxX) maxX = s[0];
        if (e[0] > maxX) maxX = e[0];
        if (s[1] < minY) minY = s[1];
        if (e[1] < minY) minY = e[1];
        if (s[1] > maxY) maxY = s[1];
        if (e[1] > maxY) maxY = e[1];
      }
    }
    if (minX === Infinity) {
      minX = 0;
      maxX = 0;
      minY = 0;
      maxY = 0;
    }
    return {
      name,
      convention: this.convention,
      offset: this._layoutOffset(name),
      extents: { minX, maxX, minY, maxY },
      segments
    };
  }

  _layoutOffset(name) {
    const third = this.convention !== 'first-angle';
    if (name === 'front') return { x: 0, y: 0 };
    const front = this._viewExtents('front');
    if (name === 'top') {
      const top = this._viewExtents('top');
      return third ? { x: 0, y: front.maxY - top.minY } : { x: 0, y: front.minY - top.maxY };
    }
    if (name === 'right') {
      const right = this._viewExtents('right');
      return third ? { x: front.maxX - right.minX, y: 0 } : { x: front.minX - right.maxX, y: 0 };
    }
    const rightOffset = this._layoutOffset('right');
    const rightExt = this._viewExtents('right');
    const rightMaxX = rightExt.maxX + rightOffset.x;
    const iso = this._viewExtents('isometric');
    const x = Math.max(front.maxX, rightMaxX) + LAYOUT_GAP - iso.minX;
    return { x, y: front.minY - iso.minY };
  }

  _viewExtents(name) {
    const tris = this._projectedTriangles(name);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const tri of tris) {
      for (const v of [tri.a, tri.b, tri.c]) {
        if (v[0] < minX) minX = v[0];
        if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1];
        if (v[1] > maxY) maxY = v[1];
      }
    }
    return { minX, maxX, minY, maxY };
  }

  renderSVG(options) {
    const opts = options || {};
    const scale = opts.scale || 80;
    const padding = opts.padding || 40;
    const views = ['front', 'top', 'right', 'isometric'];
    const analyses = views.map((v) => this.analyzeView(v));
    let gMinX = Infinity;
    let gMaxX = -Infinity;
    let gMinY = Infinity;
    let gMaxY = -Infinity;
    for (const an of analyses) {
      for (const seg of an.segments) {
        const ox = an.offset.x;
        const oy = an.offset.y;
        const mx1 = seg.a[0] + ox;
        const my1 = seg.a[1] + oy;
        const mx2 = seg.b[0] + ox;
        const my2 = seg.b[1] + oy;
        if (mx1 < gMinX) gMinX = mx1;
        if (mx2 < gMinX) gMinX = mx2;
        if (mx1 > gMaxX) gMaxX = mx1;
        if (mx2 > gMaxX) gMaxX = mx2;
        if (my1 < gMinY) gMinY = my1;
        if (my2 < gMinY) gMinY = my2;
        if (my1 > gMaxY) gMaxY = my1;
        if (my2 > gMaxY) gMaxY = my2;
      }
    }
    if (gMinX === Infinity) {
      gMinX = 0;
      gMaxX = 0;
      gMinY = 0;
      gMaxY = 0;
    }
    const width = Math.ceil((gMaxX - gMinX) * scale + 2 * padding);
    const height = Math.ceil((gMaxY - gMinY) * scale + 2 * padding);
    const fmt = (v) => v.toFixed(6);
    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`;
    for (const an of analyses) {
      const ox = an.offset.x;
      const oy = an.offset.y;
      const sx = (mx) => padding + (mx - gMinX) * scale;
      const sy = (my) => padding + (gMaxY - my) * scale;
      for (const seg of an.segments) {
        const x1 = sx(seg.a[0] + ox);
        const y1 = sy(seg.a[1] + oy);
        const x2 = sx(seg.b[0] + ox);
        const y2 = sy(seg.b[1] + oy);
        if (seg.cls === 'visible') {
          svg += `  <line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="#000000" stroke-width="1.5"/>\n`;
        } else {
          svg += `  <line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="#000000" stroke-width="1.5" stroke-dasharray="5 4"/>\n`;
        }
      }
      const boxMinX = padding + (an.extents.minX + ox - gMinX) * scale;
      const boxMaxX = padding + (an.extents.maxX + ox - gMinX) * scale;
      const boxMinY = padding + (gMaxY - (an.extents.maxY + oy)) * scale;
      const labelX = (boxMinX + boxMaxX) / 2;
      const labelY = boxMinY + 14;
      svg += `  <text x="${fmt(labelX)}" y="${fmt(labelY)}" font-family="monospace" font-size="12" fill="#333333" text-anchor="middle">${an.name}</text>\n`;
    }
    svg += `</svg>\n`;
    return svg;
  }
}

module.exports = {
  EPSILON,
  EDGE_SAMPLES,
  DraftingProjectionEngine,
  buildViewMatrices,
  createBox,
  createCube
};
