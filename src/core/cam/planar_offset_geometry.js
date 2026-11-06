'use strict';

/**
 * Planar polygon offset geometry for 3-axis contour-parallel toolpath generation.
 *
 * Provides:
 *  - miter-join inward offsetting (sequential polygon offsetting),
 *  - self-intersection resolution via planar-subdivision face extraction with an
 *    even-odd membership test (a light-weight alternative to a full straight
 *    skeleton / voronoi diagram),
 *  - rounded-corner arc fitting (G2/G3 style arc primitives),
 *  - production polygon predicates (point-in-polygon, segment intersection) that
 *    tests use to verify loop safety.
 */

const EPS = 1e-9;
const NODE_EPS = 1e-9;

function signedArea(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function isCcw(pts) {
  return signedArea(pts) > 0;
}

function toCcw(pts) {
  return isCcw(pts) ? pts : pts.slice().reverse();
}

function dedupeConsecutive(pts, eps = EPS) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < eps) continue;
    out.push({ x: p.x, y: p.y });
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < eps) {
    out.pop();
  }
  return out;
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a, b, p, eps = EPS) {
  return (
    Math.min(a.x, b.x) - eps <= p.x &&
    p.x <= Math.max(a.x, b.x) + eps &&
    Math.min(a.y, b.y) - eps <= p.y &&
    p.y <= Math.max(a.y, b.y) + eps
  );
}

function distancePointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const qx = a.x + t * dx;
  const qy = a.y + t * dy;
  return Math.hypot(p.x - qx, p.y - qy);
}

/**
 * Segment intersection test.
 * Returns { intersects, point, collinear }. Handles proper crossings, endpoint
 * touches, and collinear overlaps (representative midpoint for overlaps).
 */
function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) {
    const t = d3 / (d3 - d4);
    return {
      intersects: true,
      collinear: false,
      point: { x: p3.x + t * (p4.x - p3.x), y: p3.y + t * (p4.y - p3.y) }
    };
  }
  const pts = [];
  if (Math.abs(d1) < EPS && onSegment(p3, p4, p1)) pts.push(p1);
  if (Math.abs(d2) < EPS && onSegment(p3, p4, p2)) pts.push(p2);
  if (Math.abs(d3) < EPS && onSegment(p1, p2, p3)) pts.push(p3);
  if (Math.abs(d4) < EPS && onSegment(p1, p2, p4)) pts.push(p4);
  if (pts.length === 0) return { intersects: false, point: null, collinear: false };
  const collinear = Math.abs(d1) < EPS && Math.abs(d2) < EPS && Math.abs(d3) < EPS && Math.abs(d4) < EPS;
  const uniq = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const last = uniq[uniq.length - 1];
    if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) > EPS) uniq.push(pts[i]);
  }
  if (uniq.length === 1) return { intersects: true, point: uniq[0], collinear };
  return {
    intersects: true,
    collinear: true,
    point: {
      x: (uniq[0].x + uniq[uniq.length - 1].x) / 2,
      y: (uniq[0].y + uniq[uniq.length - 1].y) / 2
    }
  };
}

function pointInPolygonEvenOdd(p, loop) {
  let inside = false;
  const n = loop.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = loop[j];
    const b = loop[i];
    if (a.y > p.y !== b.y > p.y) {
      const xint = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (xint > p.x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Point-in-polygon (boundary counts as inside).
 */
function pointInPolygon(p, loop, eps = EPS) {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    if (distancePointToSegment(p, loop[i], loop[(i + 1) % n]) < eps) return true;
  }
  return pointInPolygonEvenOdd(p, loop);
}

/**
 * Miter-join inward offset of a CCW polygon.
 * Every edge is translated inward by dist along its interior normal, and each
 * offset vertex is the intersection of the offset lines of its two incident
 * edges. This yields the exact polygon offset (sharp mitered corners) for both
 * convex and reflex vertices; self-intersections introduced by concave regions
 * are removed later by resolveSelfIntersections.
 */
function offsetPolygonMiter(loop, dist) {
  const n = loop.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < EPS) {
      lines.push(null);
      continue;
    }
    const nx = -dy / l;
    const ny = dx / l;
    lines.push({ nx, ny, c: nx * a.x + ny * a.y + dist });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const L = lines[(i + n - 1) % n];
    const R = lines[i];
    if (!L || !R) continue;
    const det = L.nx * R.ny - R.nx * L.ny;
    if (Math.abs(det) < 1e-12) {
      const p = loop[i];
      const l = L;
      out.push({ x: p.x - l.nx * dist, y: p.y - l.ny * dist });
      continue;
    }
    out.push({
      x: (R.ny * L.c - L.ny * R.c) / det,
      y: (L.nx * R.c - R.nx * L.c) / det
    });
  }
  return out;
}

function addCut(cuts, segIdx, t, point) {
  if (!cuts.has(segIdx)) cuts.set(segIdx, []);
  cuts.get(segIdx).push({ t, point });
}

function onAnySegment(p, loop, eps = 1e-9) {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    if (distancePointToSegment(p, loop[i], loop[(i + 1) % n]) < eps) return true;
  }
  return false;
}

function minDistanceToBoundary(p, loop) {
  let md = Infinity;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const d = distancePointToSegment(p, loop[i], loop[(i + 1) % n]);
    if (d < md) md = d;
  }
  return md;
}

/**
 * Deterministically finds a point strictly inside a face of the planar
 * subdivision. For each elementary edge midpoint it probes both perpendicular
 * offsets; a probe is an interior sample if it is not on any loop segment and
 * has odd crossing parity with the original loop. The probe farthest from the
 * loop is chosen (most reliable), with the vertex centroid as fallback.
 */
function findInteriorSample(facePts, loop) {
  const m = facePts.length;
  let bestD = -1;
  let bestP = null;
  const tryCandidate = (p) => {
    const md = minDistanceToBoundary(p, loop);
    if (md < 1e-7) return;
    if (pointInPolygonEvenOdd(p, loop) && md > bestD) {
      bestD = md;
      bestP = p;
    }
  };
  for (let i = 0; i < m; i++) {
    const a = facePts[i];
    const b = facePts[(i + 1) % m];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < EPS) continue;
    const nx = -dy / l;
    const ny = dx / l;
    tryCandidate({ x: mx + 1e-6 * nx, y: my + 1e-6 * ny });
    tryCandidate({ x: mx - 1e-6 * nx, y: my - 1e-6 * ny });
  }
  if (bestP) return bestP;
  const cx = facePts.reduce((s, p) => s + p.x, 0) / m;
  const cy = facePts.reduce((s, p) => s + p.y, 0) / m;
  if (!onAnySegment({ x: cx, y: cy }, loop, 1e-7)) return { x: cx, y: cy };
  return null;
}

/**
 * Resolves self-intersections of a single closed polyline loop.
 *
 * 1. Splits every segment at all intersection points (nodes).
 * 2. Extracts the faces of the resulting planar subdivision by tracing directed
 *    elementary arcs (taking the next edge clockwise at each node).
 * 3. Keeps faces whose interior point has odd crossing parity with the original
 *    self-intersecting loop (even-odd rule), producing simple, non-crossing
 *    contours that cover the offset region.
 *
 * @returns {Array<Array<{x,y}>>} simple CCW loops
 */
function resolveSelfIntersections(loop, minArea) {
  const n = loop.length;
  if (n < 3) return [];
  const segs = loop.map((p, i) => [p, loop[(i + 1) % n]]);
  const cuts = new Map();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const r = segmentsIntersect(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
      if (!r.intersects) continue;
      const A = segs[i][0];
      const B = segs[i][1];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < EPS) continue;
      const ti = Math.max(0, Math.min(1, ((r.point.x - A.x) * dx + (r.point.y - A.y) * dy) / len2));
      const C = segs[j][0];
      const D = segs[j][1];
      const ex = D.x - C.x;
      const ey = D.y - C.y;
      const len2j = ex * ex + ey * ey;
      if (len2j < EPS) continue;
      const tj = Math.max(0, Math.min(1, ((r.point.x - C.x) * ex + (r.point.y - C.y) * ey) / len2j));
      addCut(cuts, i, ti, r.point);
      addCut(cuts, j, tj, r.point);
    }
  }

  const nodePos = [];
  const nodeId = new Map();
  const nodeKey = (p) => `${Math.round(p.x / NODE_EPS)},${Math.round(p.y / NODE_EPS)}`;
  function getNodeId(p) {
    const k = nodeKey(p);
    if (nodeId.has(k)) return nodeId.get(k);
    const id = nodePos.length;
    nodePos.push({ x: p.x, y: p.y });
    nodeId.set(k, id);
    return id;
  }

  const arcs = [];
  for (let i = 0; i < n; i++) {
    const list = cuts.get(i) || [];
    const ts = [0];
    for (const c of list) ts.push(c.t);
    ts.push(1);
    ts.sort((p, q) => p - q);
    const merged = [];
    for (const t of ts) {
      const last = merged[merged.length - 1];
      if (last === undefined || Math.abs(t - last) > 1e-9) merged.push(t);
    }
    const A = segs[i][0];
    const B = segs[i][1];
    for (let k = 0; k + 1 < merged.length; k++) {
      const t1 = merged[k];
      const t2 = merged[k + 1];
      if (t2 - t1 < 1e-12) continue;
      const u = getNodeId({ x: A.x + t1 * (B.x - A.x), y: A.y + t1 * (B.y - A.y) });
      const v = getNodeId({ x: A.x + t2 * (B.x - A.x), y: A.y + t2 * (B.y - A.y) });
      if (u !== v) arcs.push({ u, v });
    }
  }

  const adj = new Map();
  for (const { u, v } of arcs) {
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u).push({ to: v, angle: Math.atan2(nodePos[v].y - nodePos[u].y, nodePos[v].x - nodePos[u].x) });
  }
  for (const list of adj.values()) list.sort((a, b) => a.angle - b.angle);

  const visited = new Set();
  const faces = [];
  for (const { u, v } of arcs) {
    const startKey = `${u}->${v}`;
    if (visited.has(startKey)) continue;
    const face = [];
    let cu = u;
    let cv = v;
    let key = startKey;
    let guard = 0;
    while (!visited.has(key)) {
      visited.add(key);
      face.push(cv);
      const revAngle = Math.atan2(nodePos[cu].y - nodePos[cv].y, nodePos[cu].x - nodePos[cv].x);
      const list = adj.get(cv);
      let next = null;
      for (let k = list.length - 1; k >= 0; k--) {
        if (list[k].angle < revAngle - 1e-12) {
          next = list[k];
          break;
        }
      }
      if (next === null) next = list[list.length - 1];
      cu = cv;
      cv = next.to;
      key = `${cu}->${cv}`;
      guard++;
      if (guard > arcs.length * 2 + 4) break;
    }
    if (face.length >= 3 && face[face.length - 1] === face[0]) face.pop();
    if (face.length >= 3) {
      faces.push({ pts: face.map((id) => nodePos[id]), area: signedArea(face.map((id) => nodePos[id])) });
    }
  }

  const out = [];
  for (const f of faces) {
    if (Math.abs(f.area) < Math.max(minArea, 1e-9)) continue;
    const sample = findInteriorSample(f.pts, loop);
    if (sample === null) continue;
    if (!pointInPolygonEvenOdd(sample, loop)) continue;
    let clean = dedupeConsecutive(f.pts);
    if (clean.length < 3) continue;
    if (!isCcw(clean)) clean.reverse();
    if (Math.abs(signedArea(clean)) < Math.max(minArea, 1e-9)) continue;
    out.push(clean);
  }
  return out;
}

/**
 * Inward offset of a CCW polygon with self-intersection cleanup and honest
 * erosion verification. Raw offset edges of non-adjacent boundary features can
 * interact in concave regions and produce "debris" loops that even-odd
 * decomposition would keep; each surviving contour vertex must therefore lie at
 * distance >= dist - tau from the parent boundary polyline (the true erosion
 * condition).
 * @returns {Array<Array<{x,y}>>} simple CCW loops of the offset region
 */
function offsetRegion(loop, dist, minArea, parent = null, tau = null) {
  const raw = offsetPolygonMiter(loop, dist);
  if (raw.length < 3) return [];
  let loops = resolveSelfIntersections(raw, minArea);
  if (loops.length === 0) return loops;
  const boundary = parent || loop;
  const tol = tau ?? Math.max(1e-6, 0.02 * dist);
  loops = loops.filter((lp) => {
    for (const p of lp) {
      let minDist = Infinity;
      for (let i = 0; i < boundary.length; i++) {
        const d = distancePointToSegment(p, boundary[i], boundary[(i + 1) % boundary.length]);
        if (d < minDist) minDist = d;
      }
      if (minDist < dist - tol) return false;
    }
    return true;
  });
  return loops;
}

/**
 * Replaces sharp corners with circular arcs tangent to both incident edges.
 * Arc points carry { i, j, arcDir } relative to the preceding tangent point.
 * @returns {Array<{x,y,arc?,i?,j?,arcDir?}>}
 */
function applyRoundedCorners(loop, radius) {
  if (!(radius > 0)) return loop.map((p) => ({ x: p.x, y: p.y }));
  const out = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const prev = loop[(i + n - 1) % n];
    const cur = loop[i];
    const next = loop[(i + 1) % n];
    const d1x = cur.x - prev.x;
    const d1y = cur.y - prev.y;
    const d2x = next.x - cur.x;
    const d2y = next.y - cur.y;
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    if (l1 < EPS || l2 < EPS) continue;
    const cross = d1x * d2y - d1y * d2x;
    if (cross < 0) {
      out.push({ x: cur.x, y: cur.y });
      continue;
    }
    const r = Math.min(radius, 0.49 * l1, 0.49 * l2);
    const n1x = -d1y / l1;
    const n1y = d1x / l1;
    const n2x = -d2y / l2;
    const n2y = d2x / l2;
    let bx = n1x + n2x;
    let by = n1y + n2y;
    const bl = Math.hypot(bx, by);
    if (bl < EPS) {
      out.push({ x: cur.x, y: cur.y });
      continue;
    }
    bx /= bl;
    by /= bl;
    const denom = bx * n1x + by * n1y;
    if (Math.abs(denom) < 1e-6) {
      out.push({ x: cur.x, y: cur.y });
      continue;
    }
    const cx = cur.x + (r * bx) / denom;
    const cy = cur.y + (r * by) / denom;
    const ax = cx - r * n1x;
    const ay = cy - r * n1y;
    const ex = cx - r * n2x;
    const ey = cy - r * n2y;
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - ax, last.y - ay) > EPS) {
      out.push({ x: ax, y: ay });
    }
    out.push({ x: ex, y: ey, arc: true, i: cx - ax, j: cy - ay, arcDir: cross > 0 ? 'CCW' : 'CW' });
  }
  return out;
}

function loopBoundingBox(loop) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of loop) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

module.exports = {
  EPS,
  signedArea,
  isCcw,
  toCcw,
  dedupeConsecutive,
  orient,
  onSegment,
  distancePointToSegment,
  segmentsIntersect,
  pointInPolygon,
  pointInPolygonEvenOdd,
  offsetPolygonMiter,
  resolveSelfIntersections,
  offsetRegion,
  applyRoundedCorners,
  loopBoundingBox
};
