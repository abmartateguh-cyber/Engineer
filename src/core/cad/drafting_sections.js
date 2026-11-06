/**
 * OmniEng Section View Generator (Drafting)
 *
 * Produces section-view geometry for an engine-block-like solid:
 *   - A B-Rep-lite solid assembly of closed triangle meshes (box + cylinder
 *     bore + oil galley pocket as boolean-like void features).
 *   - Section cutting: intersect the meshes with a plane (or with the planes
 *     of a stepped cutting path) and trace the resulting cut contour loops.
 *   - Cross-hatching: ANSI/ISO 45-degree hatch lines filling the cut regions
 *     (scanline polygon filling with even-odd hole handling).
 *   - SVG / HTML rendering of the section view.
 *
 * Scope / limitations (documented honestly):
 *   - Boolean voids are modeled as closed meshes subtracted from the solid.
 *     The 2D section difference is resolved by loop classification: every
 *     void loop must lie strictly inside and add loop and may not intersect
 *     any other loop (validation throws otherwise). This covers the
 *     non-overlapping feature sets used by the engine-block model.
 *   - Mesh-plane intersection skips triangles coplanar with the cutting plane
 *     (caps/faces parallel to the section do not contribute contour edges).
 *   - The section contour is traced from edge crossings; faces split by
 *     triangulation diagonals may contribute extra collinear contour vertices
 *     (the traced polygon is geometrically identical).
 *
 * Deterministic, dependency-free (CommonJS, 'use strict').
 */

'use strict';

const EPS = 1e-9;
const SNAP = 1e-7;
const MIN_AREA = 1e-9;
const V3 = {
  sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  },
  add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  },
  scale(a, s) {
    return [a[0] * s, a[1] * s, a[2] * s];
  },
  dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  },
  cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  },
  len(a) {
    return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  },
  norm(a) {
    const l = V3.len(a);
    return l > EPS ? V3.scale(a, 1 / l) : [0, 0, 0];
  },
  lerp(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
};

function signedArea2D(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return s / 2;
}

function polygonArea3D(pts, plane) {
  const uv = pts.map((p) => plane.project(p));
  return signedArea2D(uv);
}

function pointInPolyEvenOdd(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function orient2(a, b, c) {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(v) < EPS) return 0;
  return v > 0 ? 1 : -1;
}

function onSegment2(a, b, p) {
  return (
    p[0] >= Math.min(a[0], b[0]) - SNAP &&
    p[0] <= Math.max(a[0], b[0]) + SNAP &&
    p[1] >= Math.min(a[1], b[1]) - SNAP &&
    p[1] <= Math.max(a[1], b[1]) + SNAP
  );
}

function segmentsIntersectProper(a, b, c, d) {
  const o1 = orient2(a, b, c);
  const o2 = orient2(a, b, d);
  const o3 = orient2(c, d, a);
  const o4 = orient2(c, d, b);
  if (o1 === 0 && onSegment2(a, b, c)) return true;
  if (o2 === 0 && onSegment2(a, b, d)) return true;
  if (o3 === 0 && onSegment2(c, d, a)) return true;
  if (o4 === 0 && onSegment2(c, d, b)) return true;
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function bbox2(pts) {
  const bb = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  };
  for (const p of pts) {
    if (p[0] < bb.minX) bb.minX = p[0];
    if (p[0] > bb.maxX) bb.maxX = p[0];
    if (p[1] < bb.minY) bb.minY = p[1];
    if (p[1] > bb.maxY) bb.maxY = p[1];
  }
  return bb;
}

/**
 * Closed triangle mesh (B-Rep-lite boundary representation).
 */
class TriangleMesh {
  constructor() {
    this.vertices = [];
    this.triangles = [];
  }

  addVertex(v) {
    this.vertices.push([v[0], v[1], v[2]]);
    return this.vertices.length - 1;
  }

  /**
   * @param {Array} a,b,c indices or 3D points
   */
  addTriangle(a, b, c) {
    const i = (p) => (typeof p === 'number' ? p : this.addVertex(p));
    this.triangles.push([i(a), i(b), i(c)]);
  }

  /** Axis-aligned box. */
  static box(min, max) {
    const m = new TriangleMesh();
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const v = [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1]
    ];
    const idx = v.map((p) => m.addVertex(p));
    const faces = [
      [0, 2, 1, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7]
    ];
    for (const f of faces) {
      m.addTriangle(idx[f[0]], idx[f[1]], idx[f[2]]);
      m.addTriangle(idx[f[0]], idx[f[2]], idx[f[3]]);
    }
    return m;
  }

  /**
   * Closed cylinder. axis is a unit vector; center is the midpoint of the
   * axis span; radius r; height h (total length along the axis); segments is
   * the number of circumferential divisions.
   */
  static cylinder(center, axis, r, h, segments) {
    const m = new TriangleMesh();
    const a = V3.norm(axis);
    const u0 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = V3.norm(V3.cross(a, u0));
    const v = V3.cross(a, u);
    const bottom = V3.add(center, V3.scale(a, -h / 2));
    const top = V3.add(center, V3.scale(a, h / 2));
    const ringB = [];
    const ringT = [];
    for (let i = 0; i < segments; i++) {
      const th = (2 * Math.PI * i) / segments;
      const dir = V3.add(V3.scale(u, Math.cos(th)), V3.scale(v, Math.sin(th)));
      ringB.push(m.addVertex(V3.add(bottom, V3.scale(dir, r))));
      ringT.push(m.addVertex(V3.add(top, V3.scale(dir, r))));
    }
    const cB = m.addVertex(bottom);
    const cT = m.addVertex(top);
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      m.addTriangle(ringB[i], ringB[j], cB);
      m.addTriangle(ringT[i], cT, ringT[j]);
      // Side quad (B_i, T_i, T_j, B_j) split by diagonal B_i -> T_j so a
      // mid-plane cut sees two distinct crossing points per quad (the two
      // vertical legs and the diagonal), avoiding degenerate 2-point loops.
      m.addTriangle(ringB[i], ringT[i], ringT[j]);
      m.addTriangle(ringB[i], ringT[j], ringB[j]);
    }
    return m;
  }

  /** Rectangular prism (box) alias. */
  static prism(min, max) {
    return TriangleMesh.box(min, max);
  }
}

/**
 * A cutting plane: point + unit normal, with an orthonormal (u,v) frame.
 * If axes u,v are supplied they are used as-is (useful for stepped cuts
 * where u must be the segment direction); otherwise a canonical frame is
 * derived from the normal.
 */
class SectionPlane {
  constructor(point, normal, u, v) {
    this.point = [point[0], point[1], point[2]];
    this.normal = V3.norm(normal);
    if (u && v) {
      this.u = V3.norm(u);
      this.v = V3.norm(v);
    } else {
      const a = this.normal;
      if (Math.abs(a[2]) > 0.9) {
        this.u = [1, 0, 0];
        this.v = [0, 1, 0];
      } else {
        const u0 = Math.abs(a[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
        this.u = V3.norm(V3.cross(a, u0));
        this.v = V3.cross(a, this.u);
      }
    }
  }

  project(p) {
    const d = V3.sub(p, this.point);
    return [V3.dot(d, this.u), V3.dot(d, this.v)];
  }

  unproject(uv) {
    return V3.add(this.point, V3.add(V3.scale(this.u, uv[0]), V3.scale(this.v, uv[1])));
  }
}

function intersectTrianglePlane(tri, mesh, plane) {
  const d = tri.map((idx) => V3.dot(V3.sub(mesh.vertices[idx], plane.point), plane.normal));
  if (d.every((x) => Math.abs(x) <= EPS)) return null;
  const pts = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const di = d[i];
    const dj = d[j];
    if ((di > EPS && dj < -EPS) || (di < -EPS && dj > EPS)) {
      const t = di / (di - dj);
      pts.push(V3.lerp(mesh.vertices[tri[i]], mesh.vertices[tri[j]], t));
    }
  }
  if (pts.length !== 2) return null;
  return [pts[0], pts[1]];
}

function vkey(p) {
  const qx = Math.round(p[0] / SNAP);
  const qy = Math.round(p[1] / SNAP);
  const qz = Math.round(p[2] / SNAP);
  return `${qx},${qy},${qz}`;
}

function traceLoops(segments) {
  const adj = new Map();
  const push = (k, seg, end) => {
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k).push({ seg, end });
  };
  for (const s of segments) {
    push(vkey(s.a), s, 0);
    push(vkey(s.b), s, 1);
  }
  const used = new Set();
  const loops = [];
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    const loop = [segments[i].a, segments[i].b];
    used.add(i);
    // extend forward
    let changed = true;
    while (changed) {
      changed = false;
      const lastKey = vkey(loop[loop.length - 1]);
      const hits = adj.get(lastKey) || [];
      for (const h of hits) {
        if (used.has(h.seg.idx)) continue;
        used.add(h.seg.idx);
        if (h.end === 1) loop.push(h.seg.a);
        else loop.push(h.seg.b);
        changed = true;
        break;
      }
    }
    // extend backward
    changed = true;
    while (changed) {
      changed = false;
      const firstKey = vkey(loop[0]);
      const hits = adj.get(firstKey) || [];
      for (const h of hits) {
        if (used.has(h.seg.idx)) continue;
        used.add(h.seg.idx);
        if (h.end === 0) loop.unshift(h.seg.b);
        else loop.unshift(h.seg.a);
        changed = true;
        break;
      }
    }
    if (loop.length > 2 && vkey(loop[loop.length - 1]) === vkey(loop[0])) {
      loop.pop();
    }
    loops.push(loop);
  }
  return loops;
}

function cutMeshWithPlane(mesh, plane) {
  const segments = [];
  for (let i = 0; i < mesh.triangles.length; i++) {
    const tri = mesh.triangles[i];
    const seg = intersectTrianglePlane(tri, mesh, plane);
    if (seg) segments.push({ a: seg[0], b: seg[1], idx: segments.length });
  }
  const raw = traceLoops(segments);
  const loops = [];
  for (const loop of raw) {
    const area = polygonArea3D(loop, plane);
    if (Math.abs(area) < MIN_AREA) continue;
    loops.push({ points: loop, area });
  }
  return loops;
}

function dedupePoints(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || V3.len(V3.sub(last, p)) > SNAP) out.push(p);
  }
  while (out.length > 1 && V3.len(V3.sub(out[0], out[out.length - 1])) <= SNAP) {
    out.pop();
  }
  return out;
}

/**
 * Sutherland-Hodgman clip of a 3D polygon by the two half-planes lo <=
 * dot(p - p0, along) <= hi (clipping in the segment-axis coordinate).
 */
function clipSegmentAlong(pts, p0, along, lo, hi) {
  const val = (p) => V3.dot(V3.sub(p, p0), along);
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const prev = pts[(i + n - 1) % n];
    const sc = val(cur);
    const sp = val(prev);
    const inC = sc >= lo - EPS && sc <= hi + EPS;
    const inP = sp >= lo - EPS && sp <= hi + EPS;
    if (inC !== inP) {
      const b = (!inP && sc > sp) || (inP && sc < sp) ? lo : hi;
      const t = (b - sp) / (sc - sp);
      out.push(V3.lerp(prev, cur, t));
    }
    if (inC) out.push(cur);
  }
  return dedupePoints(out);
}

function loopsOverlap(a, b) {
  const A = a.points;
  const B = b.points;
  for (let i = 0; i < A.length; i++) {
    const j = (i + 1) % A.length;
    for (let k = 0; k < B.length; k++) {
      const l = (k + 1) % B.length;
      if (A[i][0] === B[k][0] && A[i][1] === B[k][1] && A[j][0] === B[l][0] && A[j][1] === B[l][1]) {
        continue;
      }
      if (segmentsIntersectProper(A[i], A[j], B[k], B[l])) return true;
    }
  }
  return false;
}

function loopContainsLoop(outer, inner) {
  if (!pointInPolyEvenOdd(inner.points[0], outer.points)) return false;
  if (loopsOverlap(outer, inner)) return false;
  return true;
}

function classifyLoops(addLoops, voidLoops) {
  const outer = [];
  const holes = [];
  for (const lp of addLoops) {
    const copy = { points: lp.points, area: Math.abs(lp.area), kind: 'outer' };
    if (Math.abs(lp.area) < MIN_AREA) continue;
    outer.push(copy);
  }
  for (const lp of voidLoops) {
    if (Math.abs(lp.area) < MIN_AREA) continue;
    let owner = null;
    for (const o of outer) {
      if (loopContainsLoop(o, { points: lp.points })) {
        owner = o;
        break;
      }
    }
    if (!owner) {
      throw new Error('drafting_sections: void loop not strictly contained in any solid loop (unsupported geometry)');
    }
    holes.push({
      points: lp.points,
      area: -Math.abs(lp.area),
      kind: 'hole',
      owner
    });
  }
  for (let i = 0; i < outer.length; i++) {
    for (let j = i + 1; j < outer.length; j++) {
      if (loopsOverlap(outer[i], outer[j])) {
        throw new Error('drafting_sections: overlapping solid loops (unsupported geometry)');
      }
    }
  }
  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      if (loopsOverlap({ points: holes[i].points }, { points: holes[j].points })) {
        throw new Error('drafting_sections: overlapping void loops (unsupported geometry)');
      }
    }
  }
  return { outer, holes };
}

function finalizeRegion(loops, plane) {
  const out = [];
  for (const lp of loops) {
    const uv = lp.points.map((p) => plane.project(p));
    let area = signedArea2D(uv);
    if (Math.abs(area) < MIN_AREA) continue;
    if (lp.kind === 'outer' && area < 0) {
      uv.reverse();
      area = -area;
    } else if (lp.kind === 'hole' && area > 0) {
      uv.reverse();
      area = -area;
    }
    out.push({ points: uv, area, kind: lp.kind });
  }
  let net = 0;
  for (const lp of out) net += lp.area;
  const bb = bbox2(out[0].points);
  for (let i = 1; i < out.length; i++) {
    const b = bbox2(out[i].points);
    bb.minX = Math.min(bb.minX, b.minX);
    bb.minY = Math.min(bb.minY, b.minY);
    bb.maxX = Math.max(bb.maxX, b.maxX);
    bb.maxY = Math.max(bb.maxY, b.maxY);
  }
  return { loops: out, area: net, bbox: bb, plane };
}

/**
 * Section view generator over a triangle-mesh solid assembly.
 */
class DraftingSections {
  constructor() {
    this.solids = [];
    this.voids = [];
  }

  addSolid(mesh) {
    this.solids.push(mesh);
  }

  addVoid(mesh) {
    this.voids.push(mesh);
  }

  /**
   * Engine-block-like part: a box with a vertical cylinder bore and an oil
   * galley pocket (both modeled as closed triangle meshes subtracted from the
   * solid).
   *
   * opts:
   *   box: {min:[x0,y0,z0], max:[x1,y1,z1]} (default 100x80x60 centered)
   *   bore: {center:[x,y], r, axis:[0,0,1], segments} (default r=15 at origin)
   *   galley: {min, max} prism pocket (default x 20..46, y 13..23, z 3..13)
   */
  static createEngineBlock(opts = {}) {
    const d = new DraftingSections();
    const box = opts.box || {
      min: [-50, -40, -30],
      max: [50, 40, 30]
    };
    d.addSolid(TriangleMesh.box(box.min, box.max));
    const bore = opts.bore || { center: [0, 0], r: 15 };
    const axis = bore.axis || [0, 0, 1];
    const segments = bore.segments || 48;
    d.addVoid(TriangleMesh.cylinder([bore.center[0], bore.center[1], 0], axis, bore.r, 60, segments));
    const galley = opts.galley || {
      min: [20, 13, 3],
      max: [46, 23, 13]
    };
    d.addVoid(TriangleMesh.prism(galley.min, galley.max));
    return d;
  }

  /**
   * Cut the assembly with a plane. Returns a region with traced loops
   * (outer loops CCW, hole loops CW) in plane (u,v) coordinates.
   */
  section(origin, normal) {
    const plane = new SectionPlane(origin, normal);
    const addLoops = [];
    for (const m of this.solids) {
      addLoops.push(...cutMeshWithPlane(m, plane));
    }
    const voidLoops = [];
    for (const m of this.voids) {
      voidLoops.push(...cutMeshWithPlane(m, plane));
    }
    const { outer, holes } = classifyLoops(addLoops, voidLoops);
    return finalizeRegion([...outer, ...holes], plane);
  }

  /**
   * Stepped section cut. `path` is a polyline of [x, z] points in the view
   * plane (view direction `viewDir`, default +Y). Each path segment defines a
   * cutting plane containing the segment and the view direction; the cut
   * region is clipped to the segment span. Segments parallel to the view
   * direction are step connectors (recorded, no material region).
   */
  steppedSection(path, viewDir = [0, 1, 0]) {
    const view = V3.norm(viewDir);
    const regions = [];
    const steps = [];
    let prevDir = null;
    for (let i = 0; i < path.length - 1; i++) {
      const p0 = [path[i][0], 0, path[i][1]];
      const p1 = [path[i + 1][0], 0, path[i + 1][1]];
      const alongRaw = V3.sub(p1, p0);
      const len = V3.len(alongRaw);
      if (len <= EPS) continue;
      const along = V3.scale(alongRaw, 1 / len);
      if (prevDir && Math.abs(V3.dot(along, prevDir)) <= 1 - EPS) {
        // Direction change (bend) between runs: a step connector, not a cut
        // region (conventional section views do not hatch the step surface).
        steps.push({ p0, p1, along, len });
        prevDir = null;
        continue;
      }
      prevDir = along;
      const n = V3.cross(along, view);
      const plane = new SectionPlane(p0, n, along, view);
      const addLoops = [];
      const voidLoops = [];
      for (const m of this.solids) addLoops.push(...cutMeshWithPlane(m, plane));
      for (const m of this.voids) voidLoops.push(...cutMeshWithPlane(m, plane));
      const { outer, holes } = classifyLoops(addLoops, voidLoops);
      const clipSeg = (lp) => clipSegmentAlong(lp.points, p0, along, 0, len);
      const clippedOuter = outer
        .map((lp) => ({ points: clipSeg(lp), kind: 'outer' }))
        .filter((lp) => lp.points.length >= 3);
      const clippedHoles = holes
        .map((lp) => ({ points: clipSeg(lp), kind: 'hole' }))
        .filter((lp) => lp.points.length >= 3);
      if (clippedOuter.length === 0) continue;
      const region = finalizeRegion([...clippedOuter, ...clippedHoles], plane);
      region.segment = { p0, p1, along, len };
      region.minAlong = 0;
      region.maxAlong = len;
      regions.push(region);
    }
    return { regions, steps };
  }

  /**
   * Generate ANSI/ISO 45-degree hatch segments inside a region (even-odd
   * polygon filling with holes). Returns { segments, spacing, angleDeg }.
   */
  hatchRegion(region, spacing = 5, angleDeg = 45) {
    const ang = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const rot = (p) => [p[0] * cosA + p[1] * sinA, -p[0] * sinA + p[1] * cosA];
    const rotInv = (p) => [p[0] * cosA - p[1] * sinA, p[0] * sinA + p[1] * cosA];
    const outerRot = region.loops.filter((l) => l.kind === 'outer').map((l) => l.points.map(rot));
    const holeRot = region.loops.filter((l) => l.kind === 'hole').map((l) => l.points.map(rot));
    const all = [...outerRot, ...holeRot];
    if (all.length === 0) return { segments: [], spacing, angleDeg };
    const bb = bbox2(outerRot[0]);
    for (let i = 1; i < outerRot.length; i++) {
      const b = bbox2(outerRot[i]);
      bb.minX = Math.min(bb.minX, b.minX);
      bb.minY = Math.min(bb.minY, b.minY);
      bb.maxX = Math.max(bb.maxX, b.maxX);
      bb.maxY = Math.max(bb.maxY, b.maxY);
    }
    const xRanges = [];
    for (let k = 0; ; k++) {
      const y = bb.minY + (k + 0.5) * spacing;
      if (y > bb.maxY + EPS) break;
      const xs = [];
      for (const poly of all) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[i];
          const b = poly[j];
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
            const t = (y - a[1]) / (b[1] - a[1]);
            xs.push(a[0] + t * (b[0] - a[0]));
          }
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        if (xs[i + 1] - xs[i] > 1e-6) {
          xRanges.push({ y, x0: xs[i], x1: xs[i + 1] });
        }
      }
    }
    const segments = xRanges.map((r) => {
      const a = rotInv([r.x0, r.y]);
      const b = rotInv([r.x1, r.y]);
      return [a[0], a[1], b[0], b[1]];
    });
    return { segments, spacing, angleDeg };
  }

  /**
   * Render the section data as an SVG document string.
   * Input: a region (from section / steppedSection) or { regions: [...] }.
   */
  renderSVG(data, opts = {}) {
    const regions = data.regions || [data];
    const pad = opts.pad ?? 15;
    const scale = opts.scale ?? 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of regions) {
      for (const lp of r.loops) {
        for (const p of lp.points) {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }
        if (r.hatch) {
          for (const s of r.hatch.segments) {
            for (const v of [s[0], s[1], s[2], s[3]]) {
              if (v < minX) minX = v;
              if (v > maxX) maxX = v;
              if (v < minY) minY = v;
              if (v > maxY) maxY = v;
            }
          }
        }
      }
    }
    const width = (maxX - minX) * scale + 2 * pad;
    const height = (maxY - minY) * scale + 2 * pad;
    const tx = (x) => (x - minX) * scale + pad;
    const ty = (y) => (y - minY) * scale + pad;
    const pathOf = (pts) =>
      pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${tx(p[0]).toFixed(3)},${ty(p[1]).toFixed(3)}`).join(' ') + ' Z';
    const parts = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(2)}" height="${height.toFixed(2)}" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}">`,
      `  <!-- OmniEng drafting_sections section view (units: mm, scale ${scale}) -->`,
      `  <g stroke="#1a1a1a" stroke-width="1.2" fill="none">`
    ];
    let k = 0;
    for (const r of regions) {
      const id = `region-${k++}`;
      const hatch = r.hatch && r.hatch.segments.length ? r.hatch.segments : null;
      if (hatch && !opts.noFill) {
        parts.push(
          `    <polygon id="${id}" points="${r.loops
            .filter((l) => l.kind === 'outer')
            .map((l) => l.points.map((p) => `${tx(p[0]).toFixed(3)},${ty(p[1]).toFixed(3)}`).join(' '))
            .join(' ')}" fill="#d8d8d8" stroke="none"/>`
        );
      }
      for (const lp of r.loops) {
        parts.push(`    <path d="${pathOf(lp.points)}"/>`);
      }
      if (hatch) {
        parts.push(`    <g stroke="#444444" stroke-width="0.5" fill="none">`);
        for (const s of hatch) {
          parts.push(
            `      <line x1="${tx(s[0]).toFixed(3)}" y1="${ty(s[1]).toFixed(3)}" x2="${tx(s[2]).toFixed(3)}" y2="${ty(s[3]).toFixed(3)}"/>`
          );
        }
        parts.push(`    </g>`);
      }
    }
    parts.push(`  </g>`, `</svg>`);
    return parts.join('\n') + '\n';
  }

  /** Minimal standalone HTML document embedding the SVG. */
  renderHTML(data, opts = {}) {
    const svg = this.renderSVG(data, opts);
    return (
      `<!DOCTYPE html>\n<html><head><meta charset="utf-8">` +
      `<title>OmniEng Section View</title><style>body{font-family:system-ui;background:#f5f5f5;margin:16px}` +
      `h1{font-size:16px;color:#333}svg{background:#fff;border:1px solid #ccc}</style></head><body>` +
      `<h1>Section View (stepped cuts + cross-hatching)</h1>\n${svg}</body></html>\n`
    );
  }
}

module.exports = {
  TriangleMesh,
  SectionPlane,
  DraftingSections,
  helpers: {
    V3,
    cutMeshWithPlane,
    traceLoops,
    clipSegmentAlong,
    pointInPolyEvenOdd,
    signedArea2D
  }
};
