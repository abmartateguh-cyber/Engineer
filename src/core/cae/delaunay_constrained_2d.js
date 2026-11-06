/**
 * OmniEng constrained Delaunay triangulation (2D).
 *
 * Pipeline:
 *   1. Bowyer-Watson incremental Delaunay triangulation of the input point set
 *      (super-triangle seeded, deterministic insertion order).
 *   2. Constraint edge recovery: every boundary/constraint segment is forced
 *      into the triangulation via an edge-flip walk (Lawson flips across edges
 *      crossed by the missing segment). If a flip is blocked by a non-convex
 *      quad, a cavity retriangulation fallback is used. Constraint segments
 *      are first split at collinear vertices.
 *   3. Hole removal: triangles whose centroid lies inside the outer boundary
 *      and outside every hole are kept (winding-number classification).
 *   4. Orientation/cleanup: triangles are oriented CCW and node ids are
 *      compacted. Constrained edges are reported with final ids.
 *
 * Experimental implementation; not independently validated against ISO or
 * NAFEMS criteria.
 */

'use strict';

const DEFAULT_TOLERANCE = 1e-12;
const DEFAULT_SEED = 1337;

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

function orient2d(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function edgeKey(i, j) {
  return i < j ? `${i}-${j}` : `${j}-${i}`;
}

function pointInPolygonWinding(px, py, poly) {
  let wn = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = poly[i][0];
    const y1 = poly[i][1];
    const x2 = poly[j][0];
    const y2 = poly[j][1];
    if (y1 <= py) {
      if (y2 > py && orient2d(x1, y1, x2, y2, px, py) > 0) wn++;
    } else if (y2 <= py && orient2d(x1, y1, x2, y2, px, py) < 0) {
      wn--;
    }
  }
  return wn;
}

function segmentsIntersectStrict(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = orient2d(cx, cy, dx, dy, ax, ay);
  const d2 = orient2d(cx, cy, dx, dy, bx, by);
  const d3 = orient2d(ax, ay, bx, by, cx, cy);
  const d4 = orient2d(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

class Point2D {
  constructor(x, y, id = -1) {
    this.x = x;
    this.y = y;
    this.id = id;
    this.isBoundary = false;
  }
}

class DelaunayConstrained2D {
  constructor(options = {}) {
    this.tolerance = options.tolerance !== undefined ? options.tolerance : DEFAULT_TOLERANCE;
    this.seed = options.seed !== undefined ? options.seed : DEFAULT_SEED;
  }

  _inCircle(ax, ay, bx, by, cx, cy, dx, dy) {
    const abx = bx - ax;
    const aby = by - ay;
    const acx = cx - ax;
    const acy = cy - ay;
    const adx = dx - ax;
    const ady = dy - ay;
    const det =
      abx * (acy * (adx * adx + ady * ady) - ady * (acx * acx + acy * acy)) -
      aby * (acx * (adx * adx + ady * ady) - adx * (acx * acx + acy * acy)) +
      (abx * abx + aby * aby) * (acx * ady - adx * acy);
    return det;
  }

  _edgeAdjacency(tris) {
    const adj = new Map();
    for (let t = 0; t < tris.length; t++) {
      const { a, b, c } = tris[t];
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a]
      ]) {
        const key = edgeKey(u, v);
        if (!adj.has(key)) adj.set(key, []);
        adj.get(key).push(t);
      }
    }
    return adj;
  }

  triangulatePoints(points, options = {}) {
    const pts = points.map((p, idx) => {
      const pt = p instanceof Point2D ? p : new Point2D(p[0], p[1], idx);
      pt.id = idx;
      return pt;
    });
    const n = pts.length;
    if (n < 3) {
      throw new Error('DelaunayConstrained2D requires at least 3 points');
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const diag = Math.hypot(maxX - minX, maxY - minY) || 1.0;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const s = diag * 10;

    const superId = n;
    const s1 = { x: midX - s, y: midY - s };
    const s2 = { x: midX + s, y: midY - s };
    const s3 = { x: midX, y: midY + s };
    pts.push(new Point2D(s1.x, s1.y, n), new Point2D(s2.x, s2.y, n + 1), new Point2D(s3.x, s3.y, n + 2));

    let tris = [{ a: superId, b: superId + 1, c: superId + 2 }];

    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const bad = [];
      for (let t = 0; t < tris.length; t++) {
        const tri = tris[t];
        const { a, b, c } = tri;
        if (this._inCircle(pts[a].x, pts[a].y, pts[b].x, pts[b].y, pts[c].x, pts[c].y, p.x, p.y) < this.tolerance) {
          bad.push(t);
        }
      }
      if (bad.length === 0) continue;

      const badSet = new Set(bad);
      const edgeInfo = new Map();
      for (const t of bad) {
        const { a, b, c } = tris[t];
        for (const [u, v] of [
          [a, b],
          [b, c],
          [c, a]
        ]) {
          const key = edgeKey(u, v);
          const e = edgeInfo.get(key);
          if (e) {
            e.count++;
          } else {
            edgeInfo.set(key, { count: 1, u, v });
          }
        }
      }

      const next = [];
      for (let t = 0; t < tris.length; t++) {
        if (!badSet.has(t)) next.push(tris[t]);
      }
      for (const [key, e] of edgeInfo.entries()) {
        if (e.count !== 1) continue;
        let u = e.u;
        let v = e.v;
        if (orient2d(pts[u].x, pts[u].y, pts[v].x, pts[v].y, p.x, p.y) <= this.tolerance) {
          const tmp = u;
          u = v;
          v = tmp;
        }
        if (orient2d(pts[u].x, pts[u].y, pts[v].x, pts[v].y, p.x, p.y) > this.tolerance) {
          next.push({ a: u, b: v, c: i });
        }
      }
      tris = next;
    }

    const superIds = new Set([superId, superId + 1, superId + 2]);
    let kept = tris.filter((t) => !superIds.has(t.a) && !superIds.has(t.b) && !superIds.has(t.c));
    kept = kept.filter((t) => {
      const ar = orient2d(pts[t.a].x, pts[t.a].y, pts[t.b].x, pts[t.b].y, pts[t.c].x, pts[t.c].y);
      return Math.abs(ar) > this.tolerance;
    });
    for (const t of kept) {
      if (orient2d(pts[t.a].x, pts[t.a].y, pts[t.b].x, pts[t.b].y, pts[t.c].x, pts[t.c].y) < 0) {
        const tmp = t.b;
        t.b = t.c;
        t.c = tmp;
      }
    }
    pts.length = n;
    return { points: pts, triangles: kept };
  }

  _splitConstraintAtCollinear(points, a, b) {
    const sub = [];
    const rest = [a, b];
    for (let i = 0; i < points.length; i++) {
      if (i === a || i === b) continue;
      const d1 = orient2d(points[a].x, points[a].y, points[b].x, points[b].y, points[i].x, points[i].y);
      if (Math.abs(d1) > this.tolerance * 1e3) continue;
      const dot =
        (points[i].x - points[a].x) * (points[b].x - points[a].x) +
        (points[i].y - points[a].y) * (points[b].y - points[a].y);
      const lenSq = (points[b].x - points[a].x) ** 2 + (points[b].y - points[a].y) ** 2;
      if (dot > this.tolerance && dot < lenSq - this.tolerance) rest.push(i);
    }
    rest.sort((p, q) => {
      const dxp = points[p].x - points[a].x;
      const dyp = points[p].y - points[a].y;
      const dxq = points[q].x - points[a].x;
      const dyq = points[q].y - points[a].y;
      return dxp * dxp + dyp * dyp - (dxq * dxq + dyq * dyq);
    });
    for (let i = 0; i < rest.length - 1; i++) sub.push([rest[i], rest[i + 1]]);
    return sub;
  }

  _doesSegmentCrossEdge(pa, pb, u, v) {
    return segmentsIntersectStrict(pa.x, pa.y, pb.x, pb.y, u.x, u.y, v.x, v.y);
  }

  _triangleContainsPointStrict(t, points, px, py) {
    const { a, b, c } = t;
    const va = points[a];
    const vb = points[b];
    const vc = points[c];
    const o1 = orient2d(va.x, va.y, vb.x, vb.y, px, py);
    const o2 = orient2d(vb.x, vb.y, vc.x, vc.y, px, py);
    const o3 = orient2d(vc.x, vc.y, va.x, va.y, px, py);
    return o1 > this.tolerance && o2 > this.tolerance && o3 > this.tolerance;
  }

  _triangleContainsPointIncl(t, points, px, py) {
    const { a, b, c } = t;
    const va = points[a];
    const vb = points[b];
    const vc = points[c];
    const o1 = orient2d(va.x, va.y, vb.x, vb.y, px, py);
    const o2 = orient2d(vb.x, vb.y, vc.x, vc.y, px, py);
    const o3 = orient2d(vc.x, vc.y, va.x, va.y, px, py);
    return o1 >= -this.tolerance && o2 >= -this.tolerance && o3 >= -this.tolerance;
  }

  _flipRecover(tris, points, a, b) {
    const pa = points[a];
    const pb = points[b];
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2;

    let cur = -1;
    for (let t = 0; t < tris.length; t++) {
      if (this._triangleContainsPointStrict(tris[t], points, mx, my)) {
        cur = t;
        break;
      }
    }
    if (cur < 0) {
      for (let t = 0; t < tris.length; t++) {
        if (this._triangleContainsPointIncl(tris[t], points, mx, my)) {
          cur = t;
          break;
        }
      }
    }
    if (cur < 0) return false;
    const targetKey = edgeKey(a, b);
    const edgePresent = () => {
      for (const t of tris) {
        if (edgeKey(t.a, t.b) === targetKey || edgeKey(t.b, t.c) === targetKey || edgeKey(t.c, t.a) === targetKey) {
          return true;
        }
      }
      return false;
    };

    const maxIter = tris.length * 200 + 2000;
    const seen = new Set();

    for (let iter = 0; iter < maxIter; iter++) {
      const t = tris[cur];
      if (edgePresent()) return true;
      if (seen.has(cur)) return false;
      seen.add(cur);

      const crossingEdges = [];
      for (const [u, v] of [
        [t.a, t.b],
        [t.b, t.c],
        [t.c, t.a]
      ]) {
        if (u === b || v === b) continue;
        if (this._doesSegmentCrossEdge(pa, pb, points[u], points[v])) {
          crossingEdges.push([u, v]);
        }
      }
      if (crossingEdges.length === 0) return false;

      let flipped = false;
      for (const crossEdge of crossingEdges) {
        const key = edgeKey(crossEdge[0], crossEdge[1]);
        const neighbors = this._edgeAdjacency(tris).get(key) || [];
        let other = -1;
        for (const nb of neighbors) {
          if (nb !== cur) {
            other = nb;
            break;
          }
        }
        if (other < 0) continue;

        const t2 = tris[other];
        const f = t.a + t.b + t.c - crossEdge[0] - crossEdge[1];
        const g = t2.a + t2.b + t2.c - crossEdge[0] - crossEdge[1];
        const u = crossEdge[0];
        const v = crossEdge[1];
        if (orient2d(points[f].x, points[f].y, points[g].x, points[g].y, points[u].x, points[u].y) <= this.tolerance) {
          continue;
        }
        if (orient2d(points[f].x, points[f].y, points[g].x, points[g].y, points[v].x, points[v].y) <= this.tolerance) {
          continue;
        }

        tris[cur] = { a: f, b: g, c: u };
        tris[other] = { a: f, b: g, c: v };
        flipped = true;
        break;
      }
      if (!flipped) return false;

      let next = -1;
      for (const cand of [cur, other]) {
        if (this._triangleContainsPointStrict(tris[cand], points, mx, my)) {
          next = cand;
          break;
        }
      }
      if (next < 0) {
        for (const cand of [cur, other]) {
          if (this._triangleContainsPointIncl(tris[cand], points, mx, my)) {
            next = cand;
            break;
          }
        }
      }
      if (next < 0) return false;
      cur = next;
    }
    return edgePresent();
  }

  _pointOnSegment(px, py, ax, ay, bx, by) {
    if (Math.abs(orient2d(ax, ay, bx, by, px, py)) > this.tolerance * 1e3) return false;
    const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
    const lenSq = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
    return dot > -this.tolerance && dot < lenSq + this.tolerance;
  }

  _triangleIntersectsSegment(tri, pa, pb, points) {
    const { a, b, c } = tri;
    if (a === b || b === c || c === a) return false;
    const va = points[a];
    const vb = points[b];
    const vc = points[c];
    for (const [u, v] of [
      [va, vb],
      [vb, vc],
      [vc, va]
    ]) {
      if (this._doesSegmentCrossEdge(pa, pb, u, v)) {
        return true;
      }
    }
    for (const p of [va, vb, vc]) {
      if (p.id === pa.id || p.id === pb.id) continue;
      if (this._pointOnSegment(p.x, p.y, pa.x, pa.y, pb.x, pb.y)) {
        return true;
      }
    }

    const probeScale = Math.max(1e-6, Math.hypot(pb.x - pa.x, pb.y - pa.y) * 1e-5);
    const probes = [];
    probes.push({ q: pa, dx: pb.x - pa.x, dy: pb.y - pa.y });
    probes.push({ q: pb, dx: pa.x - pb.x, dy: pa.y - pb.y });
    for (const { q, dx, dy } of probes) {
      const len = Math.hypot(dx, dy) || 1;
      const tx = q.x + (dx / len) * probeScale;
      const ty = q.y + (dy / len) * probeScale;
      if (this._triangleContainsPointStrict(tri, points, tx, ty)) return true;
    }
    return false;
  }

  _cavityRecover(tris, points, a, b) {
    const pa = points[a];
    const pb = points[b];

    const cavity = new Set();
    for (let t = 0; t < tris.length; t++) {
      if (this._triangleIntersectsSegment(tris[t], pa, pb, points)) cavity.add(t);
    }
    if (cavity.size === 0) return false;

    const edgeCount = new Map();
    for (const t of cavity) {
      const { a: xa, b: xb, c: xc } = tris[t];
      for (const [u, v] of [
        [xa, xb],
        [xb, xc],
        [xc, xa]
      ]) {
        const key = edgeKey(u, v);
        edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      }
    }
    const boundaryEdges = [];
    for (const [key, count] of edgeCount.entries()) {
      if (count !== 1) continue;
      const [u, v] = key.split('-').map(Number);
      boundaryEdges.push([u, v]);
    }

    const chains = this._boundaryChains(boundaryEdges, a, b);
    if (!chains) return false;

    const keep = [];
    let cavArea = 0;
    for (const t of cavity) {
      const { a: xa, b: xb, c: xc } = tris[t];
      cavArea +=
        Math.abs(orient2d(points[xa].x, points[xa].y, points[xb].x, points[xb].y, points[xc].x, points[xc].y)) / 2;
    }
    for (let t = 0; t < tris.length; t++) {
      if (!cavity.has(t)) keep.push(tris[t]);
    }
    let fanArea = 0;
    let dropped = 0;
    const fanTris = [];
    for (const chain of chains) {
      for (let i = 0; i < chain.length - 1; i++) {
        let u = chain[i];
        let v = chain[i + 1];
        if (u === a && v === b) continue;
        if (u === b && v === a) continue;
        if (u === v) continue;
        let o = orient2d(points[a].x, points[a].y, points[u].x, points[u].y, points[v].x, points[v].y);
        if (o < 0) {
          const tmp = u;
          u = v;
          v = tmp;
          o = -o;
        }
        if (o > this.tolerance) {
          fanTris.push({ a, b: u, c: v });
          fanArea += o / 2;
        } else {
          dropped++;
        }
      }
    }
    const areaTol = Math.max(1e-12, cavArea * 0.05);
    if (Math.abs(fanArea - cavArea) > areaTol) {
      return false;
    }
    keep.push(...fanTris);
    tris.length = 0;
    tris.push(...keep);
    return true;
  }

  _boundaryChains(boundaryEdges, a, b) {
    const adj = new Map();
    for (const [u, v] of boundaryEdges) {
      if (!adj.has(u)) adj.set(u, []);
      if (!adj.has(v)) adj.set(v, []);
      adj.get(u).push(v);
      adj.get(v).push(u);
    }
    for (const list of adj.values()) list.sort((x, y) => x - y);
    if (!adj.has(a) || !adj.has(b)) return null;

    const dfsPath = (start, target, adjacency) => {
      const visited = new Set([start]);
      const path = [start];
      const walk = (cur) => {
        for (const nb of adjacency.get(cur) || []) {
          if (visited.has(nb)) continue;
          if (nb === target) {
            path.push(nb);
            return true;
          }
          visited.add(nb);
          path.push(nb);
          if (walk(nb)) return true;
          path.pop();
          visited.delete(nb);
        }
        return false;
      };
      return walk(start) ? path : null;
    };

    const c1 = dfsPath(a, b, adj);
    if (!c1) return null;
    const usedEdges = new Set();
    for (let i = 0; i < c1.length - 1; i++) usedEdges.add(edgeKey(c1[i], c1[i + 1]));
    const remAdj = new Map();
    for (const [u, v] of boundaryEdges) {
      if (usedEdges.has(edgeKey(u, v))) continue;
      if (!remAdj.has(u)) remAdj.set(u, []);
      if (!remAdj.has(v)) remAdj.set(v, []);
      remAdj.get(u).push(v);
      remAdj.get(v).push(u);
    }
    for (const list of remAdj.values()) list.sort((x, y) => x - y);
    let c2 = dfsPath(b, a, remAdj);
    if (!c2) return null;
    if (c2[0] === b) c2 = c2.reverse();
    return [c1, c2];
  }

  _recoverConstraints(tris, points, constraints) {
    let recovered = true;
    const segments = [];
    for (const [a, b] of constraints) {
      segments.push(...this._splitConstraintAtCollinear(points, a, b));
    }
    for (const [a, b] of segments) {
      const key = edgeKey(a, b);
      let present = false;
      for (const t of tris) {
        if (edgeKey(t.a, t.b) === key || edgeKey(t.b, t.c) === key || edgeKey(t.c, t.a) === key) {
          present = true;
          break;
        }
      }
      if (present) continue;
      const okFlip = this._flipRecover(tris, points, a, b);
      if (!okFlip) {
        const okCavity = this._cavityRecover(tris, points, a, b);
        if (!okCavity) recovered = false;
      }
    }
    return { recovered, segments };
  }

  _filterRegion(tris, points, boundary, holes) {
    const inside = (px, py) => {
      if (pointInPolygonWinding(px, py, boundary) === 0) return false;
      for (const hole of holes) {
        if (pointInPolygonWinding(px, py, hole) !== 0) return false;
      }
      return true;
    };
    const kept = [];
    for (const t of tris) {
      const cx = (points[t.a].x + points[t.b].x + points[t.c].x) / 3;
      const cy = (points[t.a].y + points[t.b].y + points[t.c].y) / 3;
      if (inside(cx, cy)) kept.push(t);
    }
    return kept;
  }

  _metrics(tris, points) {
    let minAngle = Infinity;
    let maxAngle = -Infinity;
    let angleSum = 0;
    let minArea = Infinity;
    let maxArea = -Infinity;
    let areaSum = 0;
    for (const t of tris) {
      const ax = points[t.a].x;
      const ay = points[t.a].y;
      const bx = points[t.b].x;
      const by = points[t.b].y;
      const cx = points[t.c].x;
      const cy = points[t.c].y;
      const area = Math.abs(orient2d(ax, ay, bx, by, cx, cy)) / 2;
      minArea = Math.min(minArea, area);
      maxArea = Math.max(maxArea, area);
      areaSum += area;
      const lab = Math.hypot(bx - ax, by - ay);
      const lbc = Math.hypot(cx - bx, cy - by);
      const lca = Math.hypot(ax - cx, ay - cy);
      const angleAt = (u2, v2, w2) =>
        Math.acos(Math.max(-1, Math.min(1, (u2 * u2 + v2 * v2 - w2 * w2) / (2 * u2 * v2))));
      const an = angleAt(lab, lca, lbc);
      const bn = angleAt(lab, lbc, lca);
      const cn = angleAt(lbc, lca, lab);
      const locMin = Math.min(an, bn, cn);
      const locMax = Math.max(an, bn, cn);
      minAngle = Math.min(minAngle, locMin);
      maxAngle = Math.max(maxAngle, locMax);
      angleSum += an + bn + cn;
    }
    return {
      minAngleDeg: (minAngle * 180) / Math.PI,
      maxAngleDeg: (maxAngle * 180) / Math.PI,
      avgAngleDeg: (angleSum / (tris.length * 3 || 1)) * (180 / Math.PI),
      minArea,
      maxArea,
      areaSum
    };
  }

  _buildInteriorPoints(pts, boundary, holes, spacing) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of [boundary, ...holes].flat()) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
    const rnd = mulberry32(this.seed);
    const added = [];
    const nx = Math.max(1, Math.floor((maxX - minX) / spacing));
    const ny = Math.max(1, Math.floor((maxY - minY) / spacing));
    const jitter = spacing * 0.18;
    for (let ix = 1; ix < nx; ix++) {
      for (let iy = 1; iy < ny; iy++) {
        const x = minX + ix * spacing + (rnd() * 2 - 1) * jitter;
        const y = minY + iy * spacing + (rnd() * 2 - 1) * jitter;
        if (pointInPolygonWinding(x, y, boundary) === 0) continue;
        let inHole = false;
        for (const hole of holes) {
          if (pointInPolygonWinding(x, y, hole) !== 0) {
            inHole = true;
            break;
          }
        }
        if (inHole) continue;
        let tooClose = false;
        for (const p of pts) {
          if (Math.hypot(p.x - x, p.y - y) < spacing * 0.35) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) added.push(new Point2D(x, y));
      }
    }
    return added;
  }

  triangulatePolygon(boundary, holes = [], options = {}) {
    if (!Array.isArray(boundary) || boundary.length < 3) {
      throw new Error('DelaunayConstrained2D.triangulatePolygon requires a boundary polygon with >= 3 vertices');
    }
    const polyToPts = (poly) => poly.map((p, idx) => new Point2D(p[0], p[1], idx));
    const boundaryPts = polyToPts(boundary);
    let offset = boundaryPts.length;
    const holePts = holes.map((hole) => {
      const pts = polyToPts(hole);
      pts.forEach((p) => {
        p.id = offset++;
      });
      return pts;
    });
    const all = [...boundaryPts, ...holePts.flat()];
    boundaryPts.forEach((p) => {
      p.isBoundary = true;
    });
    holePts.forEach((hp) => hp.forEach((p) => (p.isBoundary = true)));

    const spacing = Number(options.interiorSpacing) || 0;
    if (spacing > 0) {
      const interior = this._buildInteriorPoints(all, boundary, holes, spacing);
      const startId = all.length;
      interior.forEach((p, idx) => {
        p.id = startId + idx;
      });
      all.push(...interior);
    }
    if (Array.isArray(options.interiorPoints)) {
      for (const p of options.interiorPoints) {
        all.push(new Point2D(p[0], p[1], all.length));
      }
    }

    const { points, triangles } = this.triangulatePoints(all);

    let boundaryEdges = [];
    for (let i = 0; i < boundary.length; i++) {
      boundaryEdges.push([i, (i + 1) % boundary.length]);
    }
    let holeBase = boundary.length;
    for (const hp of holePts) {
      for (let i = 0; i < hp.length; i++) {
        boundaryEdges.push([holeBase + i, holeBase + ((i + 1) % hp.length)]);
      }
      holeBase += hp.length;
    }
    const extraConstraints = Array.isArray(options.constraints) ? options.constraints : [];
    const constraints = [...boundaryEdges, ...extraConstraints];

    const recovery = this._recoverConstraints(triangles, points, constraints);
    const kept = this._filterRegion(triangles, points, boundary, holes);
    if (options.keepAllTriangles) {
      kept.length = 0;
      kept.push(...triangles);
    }

    const usedIds = new Set();
    for (const t of kept) {
      usedIds.add(t.a);
      usedIds.add(t.b);
      usedIds.add(t.c);
    }
    const idMap = new Map();
    const nodes = [];
    for (const p of points) {
      if (!usedIds.has(p.id)) continue;
      const newId = nodes.length;
      idMap.set(p.id, newId);
      nodes.push({ id: newId, x: p.x, y: p.y, isBoundary: p.isBoundary });
    }

    for (const t of kept) {
      t.a = idMap.get(t.a);
      t.b = idMap.get(t.b);
      t.c = idMap.get(t.c);
      if (orient2d(nodes[t.a].x, nodes[t.a].y, nodes[t.b].x, nodes[t.b].y, nodes[t.c].x, nodes[t.c].y) < 0) {
        const tmp = t.b;
        t.b = t.c;
        t.c = tmp;
      }
    }
    const trianglesOut = kept.map((t, idx) => ({ id: idx, nodeIds: [t.a, t.b, t.c] }));

    const constrainedEdges = [];
    const edgePresent = new Set();
    for (const t of kept) {
      edgePresent.add(edgeKey(t.a, t.b));
      edgePresent.add(edgeKey(t.b, t.c));
      edgePresent.add(edgeKey(t.c, t.a));
    }
    for (const [a, b] of recovery.segments) {
      const na = idMap.get(a);
      const nb = idMap.get(b);
      if (na === undefined || nb === undefined) continue;
      if (edgePresent.has(edgeKey(na, nb))) constrainedEdges.push(na < nb ? [na, nb] : [nb, na]);
    }
    constrainedEdges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

    const metrics = this._metrics(kept, nodes);
    const regionArea =
      Math.abs(
        boundary.reduce((s, p, i) => {
          const q = boundary[(i + 1) % boundary.length];
          return s + p[0] * q[1] - q[0] * p[1];
        }, 0)
      ) /
        2 -
      holes.reduce((s, hole) => {
        return (
          s +
          Math.abs(
            hole.reduce((h, p, i) => {
              const q = hole[(i + 1) % hole.length];
              return h + p[0] * q[1] - q[0] * p[1];
            }, 0)
          ) /
            2
        );
      }, 0);

    return {
      type: 'TRI3_CDT',
      nodes,
      triangles: trianglesOut,
      constrainedEdges,
      metrics: {
        nodeCount: nodes.length,
        triangleCount: trianglesOut.length,
        constrainedEdgeCount: constrainedEdges.length,
        constraintSegments: recovery.segments.length,
        recoveredAllConstraints: recovery.recovered,
        regionArea,
        triangulatedArea: metrics.areaSum,
        minAngleDeg: metrics.minAngleDeg,
        maxAngleDeg: metrics.maxAngleDeg,
        avgAngleDeg: metrics.avgAngleDeg,
        minArea: metrics.minArea,
        maxArea: metrics.maxArea
      }
    };
  }
}

module.exports = {
  Point2D,
  DelaunayConstrained2D,
  mulberry32,
  orient2d,
  edgeKey,
  pointInPolygonWinding,
  segmentsIntersectStrict
};
