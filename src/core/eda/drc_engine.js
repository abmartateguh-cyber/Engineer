/**
 * Experimental 2D design-rule screening helpers.
 * Two modes are provided:
 *   - "box"  : axis-aligned rectangle width-area-spacing screen (legacy).
 *   - "polygon": all-angle polygon DRC (width, spacing, area, enclosure,
 *               self-intersection validity) over closed vertex loops.
 * Neither mode implements foundry DRC or establishes tape-out readiness.
 */

'use strict';

const { Polygon2D } = require('./polygon_boolean_engine');

const GEOM_EPS = 1e-9;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function orient(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function pointOnSegment(ax, ay, bx, by, px, py) {
  return (
    Math.min(ax, bx) - GEOM_EPS <= px &&
    px <= Math.max(ax, bx) + GEOM_EPS &&
    Math.min(ay, by) - GEOM_EPS <= py &&
    py <= Math.max(ay, by) + GEOM_EPS
  );
}

/**
 * Segment-segment intersection test. Returns null when the open endpoints of
 * the two segments do not touch, otherwise { kind: 'point', x, y }.
 * Used for polygon self-intersection validation (sweep-pruned pairwise test).
 */
function segmentIntersection(a1, a2, b1, b2) {
  const d1 = orient(b1.x, b1.y, b2.x, b2.y, a1.x, a1.y);
  const d2 = orient(b1.x, b1.y, b2.x, b2.y, a2.x, a2.y);
  const d3 = orient(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y);
  const d4 = orient(a1.x, a1.y, a2.x, a2.y, b2.x, b2.y);

  if (
    ((d1 > GEOM_EPS && d2 < -GEOM_EPS) || (d1 < -GEOM_EPS && d2 > GEOM_EPS)) &&
    ((d3 > GEOM_EPS && d4 < -GEOM_EPS) || (d3 < -GEOM_EPS && d4 > GEOM_EPS))
  ) {
    const t = d3 / (d3 - d4);
    return { kind: 'point', x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
  }

  if (Math.abs(d1) <= GEOM_EPS && pointOnSegment(b1.x, b1.y, b2.x, b2.y, a1.x, a1.y)) {
    return { kind: 'point', x: a1.x, y: a1.y };
  }
  if (Math.abs(d2) <= GEOM_EPS && pointOnSegment(b1.x, b1.y, b2.x, b2.y, a2.x, a2.y)) {
    return { kind: 'point', x: a2.x, y: a2.y };
  }
  if (Math.abs(d3) <= GEOM_EPS && pointOnSegment(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y)) {
    return { kind: 'point', x: b1.x, y: b1.y };
  }
  if (Math.abs(d4) <= GEOM_EPS && pointOnSegment(a1.x, a1.y, a2.x, a2.y, b2.x, b2.y)) {
    return { kind: 'point', x: b2.x, y: b2.y };
  }
  return null;
}

/**
 * Closest points between two segments (Ericson, "Real-Time Collision
 * Detection" section 5.1.9). Returns { dist, p1, p2 } where p1 lies on the
 * first segment and p2 on the second.
 */
function closestPointsOnSegments(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const rx = p1.x - p3.x;
  const ry = p1.y - p3.y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  let s = 0;
  let t = 0;

  if (a <= GEOM_EPS && e <= GEOM_EPS) {
    // both segments degenerate to points
  } else if (a <= GEOM_EPS) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= GEOM_EPS) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = Math.abs(denom) > GEOM_EPS ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  const q1 = { x: p1.x + s * d1x, y: p1.y + s * d1y };
  const q2 = { x: p3.x + t * d2x, y: p3.y + t * d2y };
  const dx = q1.x - q2.x;
  const dy = q1.y - q2.y;
  return { dist: Math.hypot(dx, dy), p1: q1, p2: q2 };
}

/**
 * Normalize a shape into a closed vertex loop. Accepts either an explicit
 * vertices array (implicitly closed; a duplicated closing vertex is dropped)
 * or legacy axis-aligned box fields (x, y, w, h).
 */
function normalizePolygonVertices(shape) {
  let raw = null;
  if (Array.isArray(shape.vertices) && shape.vertices.length >= 3) {
    raw = shape.vertices;
  } else if (
    Number.isFinite(shape.x) &&
    Number.isFinite(shape.y) &&
    Number.isFinite(shape.w) &&
    Number.isFinite(shape.h) &&
    shape.w > 0 &&
    shape.h > 0
  ) {
    raw = [
      { x: shape.x, y: shape.y },
      { x: shape.x + shape.w, y: shape.y },
      { x: shape.x + shape.w, y: shape.y + shape.h },
      { x: shape.x, y: shape.y + shape.h }
    ];
  } else {
    return { error: 'requires a closed vertex loop (three or more vertices) or positive box dimensions' };
  }

  const vertices = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object' || !Number.isFinite(v.x) || !Number.isFinite(v.y)) {
      return { error: 'vertex coordinates must be finite numbers' };
    }
    const last = vertices[vertices.length - 1];
    if (last && Math.abs(v.x - last.x) < GEOM_EPS && Math.abs(v.y - last.y) < GEOM_EPS) {
      return { error: 'consecutive duplicate vertices produce a zero-length edge' };
    }
    vertices.push({ x: v.x, y: v.y });
  }
  const first = vertices[0];
  const lastVertex = vertices[vertices.length - 1];
  if (Math.abs(first.x - lastVertex.x) < GEOM_EPS && Math.abs(first.y - lastVertex.y) < GEOM_EPS) {
    vertices.pop();
  }
  if (vertices.length < 3) {
    return { error: 'fewer than 3 distinct vertices after closure normalization' };
  }
  return { vertices };
}

/**
 * Self-intersection detection via an x-sorted segment sweep. Each edge is
 * compared only against currently active edges whose x-extents overlap its
 * own, which prunes the O(n^2) pairwise test while remaining exact for
 * proper crossings, endpoint touches, and collinear overlaps. Adjacent edges
 * (which legally share a vertex) are excluded.
 */
function findSelfIntersection(vertices) {
  const n = vertices.length;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    edges.push({
      i,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      minX: Math.min(a.x, b.x),
      maxX: Math.max(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxY: Math.max(a.y, b.y)
    });
  }
  edges.sort((p, q) => p.minX - q.minX || p.minY - q.minY || p.i - q.i);

  const active = [];
  for (const edge of edges) {
    while (active.length && active[0].maxX < edge.minX - GEOM_EPS) active.shift();
    for (const other of active) {
      const diff = Math.abs(other.i - edge.i);
      if (diff === 1 || diff === n - 1) continue;
      if (
        edge.minX > other.maxX + GEOM_EPS ||
        other.minX > edge.maxX + GEOM_EPS ||
        edge.minY > other.maxY + GEOM_EPS ||
        other.minY > edge.maxY + GEOM_EPS
      ) {
        continue;
      }
      const hit = segmentIntersection(
        { x: edge.x1, y: edge.y1 },
        { x: edge.x2, y: edge.y2 },
        { x: other.x1, y: other.y1 },
        { x: other.x2, y: other.y2 }
      );
      if (hit) {
        return {
          i: Math.min(edge.i, other.i),
          j: Math.max(edge.i, other.j),
          x: hit.x,
          y: hit.y,
          kind: hit.kind
        };
      }
    }
    active.push(edge);
  }
  return null;
}

/**
 * Minimum segment-segment distance between two polygons. Also returns the
 * closest point on each polygon for violation location reporting.
 */
function polygonSpacing(aVerts, bVerts) {
  let bestDist = Infinity;
  let bestP1 = null;
  let bestP2 = null;
  for (let i = 0; i < aVerts.length; i++) {
    const a1 = aVerts[i];
    const a2 = aVerts[(i + 1) % aVerts.length];
    for (let j = 0; j < bVerts.length; j++) {
      const b1 = bVerts[j];
      const b2 = bVerts[(j + 1) % bVerts.length];
      const hit = closestPointsOnSegments(a1, a2, b1, b2);
      if (hit.dist < bestDist) {
        bestDist = hit.dist;
        bestP1 = hit.p1;
        bestP2 = hit.p2;
      }
      if (bestDist <= GEOM_EPS) break;
    }
    if (bestDist <= GEOM_EPS) break;
  }
  return { dist: bestDist, p1: bestP1, p2: bestP2 };
}

/**
 * Minimum-width screening: for every unordered pair of non-adjacent edges,
 * the segment-segment distance is the local feature width for that pair.
 * Any pair closer than minWidth is reported (the notch/arm constriction).
 */
function findNarrowPairs(vertices, minWidth) {
  const n = vertices.length;
  const results = [];
  for (let i = 0; i < n; i++) {
    const a1 = vertices[i];
    const a2 = vertices[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const diff = j - i;
      if (diff === 1 || diff === n - 1) continue;
      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];
      const hit = closestPointsOnSegments(a1, a2, b1, b2);
      if (hit.dist < minWidth) {
        results.push({ i, j, dist: hit.dist, p1: hit.p1, p2: hit.p2 });
      }
    }
  }
  results.sort((a, b) => a.i - b.i || a.j - b.j);
  return results;
}

/**
 * Notch screening over closed edge loops. A notch is an inward indentation
 * (void trench) in a polygon boundary: two non-adjacent edges that bound an
 * empty pocket face each other across the void with a perpendicular gap
 * below minNotch. Distinct trenches are deduplicated by their gap interval,
 * so a U-shaped slit reports a single violation rather than one per edge
 * pair. The scan is exact for manhattan/orthogonal polygons, which is the
 * supported scope for this gate.
 */
function findNotchPairs(poly, minNotch) {
  const vertices = poly.vertices;
  const n = vertices.length;
  const results = [];
  const seenGaps = new Set();
  for (let i = 0; i < n; i++) {
    const a1 = vertices[i];
    const a2 = vertices[(i + 1) % n];
    const dxA = a2.x - a1.x;
    const dyA = a2.y - a1.y;
    for (let j = i + 1; j < n; j++) {
      const diff = j - i;
      if (diff === 1 || diff === n - 1) continue;
      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];
      const dxB = b2.x - b1.x;
      const dyB = b2.y - b1.y;
      if (Math.abs(dxA * dyB - dyA * dxB) > GEOM_EPS) continue;
      const cx = (a1.x + a2.x - b1.x - b2.x) / 2;
      const cy = (a1.y + a2.y - b1.y - b2.y) / 2;
      const nxA = -dyA;
      const nyA = dxA;
      const nxB = -dyB;
      const nyB = dxB;
      if (nxA * cx + nyA * cy <= GEOM_EPS) continue;
      if (nxB * cx + nyB * cy >= -GEOM_EPS) continue;
      const hit = closestPointsOnSegments(a1, a2, b1, b2);
      if (hit.dist >= minNotch) continue;
      let key = null;
      if (Math.abs(dyA) <= GEOM_EPS) {
        key = `h:${Math.min(a1.y, b1.y)},${Math.max(a1.y, b1.y)}`;
      } else {
        key = `v:${Math.min(a1.x, b1.x)},${Math.max(a1.x, b1.x)}`;
      }
      if (key !== null) {
        if (seenGaps.has(key)) continue;
        seenGaps.add(key);
      }
      results.push({ i, j, dist: hit.dist, p1: hit.p1, p2: hit.p2 });
    }
  }
  results.sort((a, b) => a.i - b.i || a.j - b.j);
  return results;
}

/**
 * Enclosure check: polygon `candidate` must lie fully inside one of the
 * `boundaries` polygons with at least `margin` clearance to boundary edges.
 */
function polygonInsideOther(candidate, boundaries, margin) {
  const m = margin > 0 ? margin : 0;
  for (const b of boundaries) {
    const host = new Polygon2D(b.vertices);
    let allInside = true;
    for (const v of candidate.vertices) {
      if (!host.isPointInside(v.x, v.y)) {
        allInside = false;
        break;
      }
    }
    if (!allInside) continue;
    const sp = polygonSpacing(candidate.vertices, b.vertices);
    if (sp.dist >= m - GEOM_EPS) return b;
  }
  return null;
}

class DRCEngine {
  /**
   * Run all-angle polygon Design Rule Checking on closed vertex loops.
   * @param {Array<Object>} shapes Array of polygons {id, layer, vertices}
   *   where vertices is an ordered array of {x, y} boundary points; legacy
   *   box shapes {x, y, w, h} are auto-converted to polygon loops.
   * @param {Object} rules Screening limits:
   *    minWidth: number, or per-layer map { layer: number }
   *    minSpacing: number (default for every layer pair)
   *    spacingByLayer: { "layerA:layerB": number } same/different-layer overrides
   *    minArea: number (optional), or per-layer map
   *    minNotch: number (optional), or per-layer map; when provided, void
   *      indentations below the limit are reported as NOTCH_VIOLATION and
   *      are no longer double-counted as width constrictions.
   *    enclosures: [{ layer, enclosingLayer, margin }] (optional)
   *    allowNegativeCoordinates: boolean (optional, default true); when
   *      false, polygons with any negative vertex coordinate fail closed.
   */
  static runPolygonDRC(shapes, rules) {
    const invalidInput = (message) => ({
      success: false,
      mode: 'polygon',
      validationLevel: 'experimental',
      error: { code: 'INVALID_INPUT', message }
    });

    if (!Array.isArray(shapes) || shapes.length === 0) {
      return invalidInput('A non-empty array of polygon shapes is required.');
    }
    if (shapes.length > 5000) {
      return invalidInput('At most 5,000 polygon shapes can be checked by this engine.');
    }
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
      return invalidInput('Explicit positive minWidth and minSpacing screening limits are required.');
    }

    const minWidthRule = rules.minWidth;
    const minWidthOk =
      (typeof minWidthRule === 'number' && Number.isFinite(minWidthRule) && minWidthRule > 0) ||
      (minWidthRule &&
        typeof minWidthRule === 'object' &&
        !Array.isArray(minWidthRule) &&
        Object.keys(minWidthRule).length > 0);
    const minSpacing = rules.minSpacing;
    if (!minWidthOk || !(Number.isFinite(minSpacing) && minSpacing > 0)) {
      return invalidInput('Explicit positive minWidth and minSpacing screening limits are required.');
    }

    const minAreaRule = rules.minArea;
    const minNotchRule = rules.minNotch;
    const notchActive =
      (typeof minNotchRule === 'number' && Number.isFinite(minNotchRule) && minNotchRule > 0) ||
      (minNotchRule &&
        typeof minNotchRule === 'object' &&
        !Array.isArray(minNotchRule) &&
        Object.keys(minNotchRule).length > 0);
    if (rules.allowNegativeCoordinates !== undefined && typeof rules.allowNegativeCoordinates !== 'boolean') {
      return invalidInput('allowNegativeCoordinates must be a boolean when supplied.');
    }
    const allowNegativeCoordinates = rules.allowNegativeCoordinates !== false;
    const spacingByLayer =
      rules.spacingByLayer && typeof rules.spacingByLayer === 'object' && !Array.isArray(rules.spacingByLayer)
        ? rules.spacingByLayer
        : {};
    const enclosures = Array.isArray(rules.enclosures) ? rules.enclosures : [];

    const seenIds = new Set();
    const polys = [];
    let totalVertices = 0;
    for (const shape of shapes) {
      if (!shape || typeof shape !== 'object' || Array.isArray(shape)) {
        return invalidInput('Each polygon must be an object with a unique id, layer, and closed vertex loop.');
      }
      if (typeof shape.id !== 'string' || shape.id.trim() === '' || seenIds.has(shape.id)) {
        return invalidInput('Each polygon requires a unique non-empty string id.');
      }
      if (typeof shape.layer !== 'string' || shape.layer.trim() === '') {
        return invalidInput('Each polygon requires a non-empty layer name.');
      }
      const norm = normalizePolygonVertices(shape);
      if (norm.error) {
        return invalidInput(`Polygon ${shape.id} geometry is invalid: ${norm.error}`);
      }
      if (!allowNegativeCoordinates) {
        for (const v of norm.vertices) {
          if (v.x < 0 || v.y < 0) {
            return invalidInput(`Polygon ${shape.id} contains negative coordinates, which are disallowed.`);
          }
        }
      }
      seenIds.add(shape.id);
      totalVertices += norm.vertices.length;
      if (totalVertices > 100000) {
        return invalidInput('At most 100,000 total polygon vertices can be checked by this engine.');
      }
      polys.push({ id: shape.id, layer: shape.layer, vertices: norm.vertices });
    }

    // 0. Validity: self-intersection detection via segment sweep.
    for (const poly of polys) {
      const bad = findSelfIntersection(poly.vertices);
      if (bad) {
        return {
          success: false,
          mode: 'polygon',
          validationLevel: 'experimental',
          error: {
            code: 'INVALID_POLYGON_SELF_INTERSECTION',
            message: `Polygon ${poly.id} on ${poly.layer} self-intersects between edge ${bad.j} and edge ${bad.i} at (${bad.x.toFixed(4)}, ${bad.y.toFixed(4)}).`,
            shapeId: poly.id,
            layer: poly.layer,
            edges: [bad.i, bad.j],
            point: { x: bad.x, y: bad.y }
          }
        };
      }
    }

    const resolveLimit = (rule, layer) => {
      if (typeof rule === 'number') return Number.isFinite(rule) && rule > 0 ? rule : null;
      if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
        const v = rule[layer];
        return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
      }
      return null;
    };

    const violations = [];

    // 1. Minimum width and minimum area checks per polygon.
    for (const poly of polys) {
      const minWidth = resolveLimit(minWidthRule, poly.layer);
      if (minWidth !== null) {
        for (const pair of findNarrowPairs(poly.vertices, minWidth)) {
          violations.push({
            type: 'MIN_WIDTH_VIOLATION',
            rule: 'minWidth',
            layer: poly.layer,
            shapeId: poly.id,
            location: { x: (pair.p1.x + pair.p2.x) / 2, y: (pair.p1.y + pair.p2.y) / 2 },
            foundValue: +pair.dist.toFixed(6),
            ruleLimit: minWidth,
            severity: 'ERROR',
            edges: [
              {
                x1: poly.vertices[pair.i].x,
                y1: poly.vertices[pair.i].y,
                x2: poly.vertices[(pair.i + 1) % poly.vertices.length].x,
                y2: poly.vertices[(pair.i + 1) % poly.vertices.length].y
              },
              {
                x1: poly.vertices[pair.j].x,
                y1: poly.vertices[pair.j].y,
                x2: poly.vertices[(pair.j + 1) % poly.vertices.length].x,
                y2: poly.vertices[(pair.j + 1) % poly.vertices.length].y
              }
            ],
            message: `Polygon ${poly.id} on ${poly.layer} has width ${pair.dist.toFixed(3)} between edges ${pair.i} and ${pair.j}, below supplied minWidth ${minWidth}`
          });
        }
      }

      const minArea = resolveLimit(minAreaRule, poly.layer);
      if (minArea !== null) {
        const area = new Polygon2D(poly.vertices).area();
        if (area < minArea) {
          violations.push({
            type: 'MIN_AREA_VIOLATION',
            rule: 'minArea',
            layer: poly.layer,
            shapeId: poly.id,
            location: { x: poly.vertices[0].x, y: poly.vertices[0].y },
            foundValue: +area.toFixed(6),
            ruleLimit: minArea,
            severity: 'WARNING',
            message: `Polygon ${poly.id} on ${poly.layer} has area ${area.toFixed(3)}, below supplied minArea ${minArea}`
          });
        }
      }
    }

    // 2. Spacing between polygons (same and different layers).
    for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const a = polys[i];
        const b = polys[j];
        const key = [a.layer, b.layer].sort().join(':');
        const required =
          Number.isFinite(spacingByLayer[key]) && spacingByLayer[key] > 0 ? spacingByLayer[key] : minSpacing;
        const hit = polygonSpacing(a.vertices, b.vertices);
        const layerLabel = a.layer === b.layer ? a.layer : `${a.layer}/${b.layer}`;
        if (hit.dist <= GEOM_EPS) {
          violations.push({
            type: 'SHORT_CIRCUIT_OVERLAP',
            rule: 'minSpacing',
            layer: layerLabel,
            shapeIds: [a.id, b.id],
            location: { x: (hit.p1.x + hit.p2.x) / 2, y: (hit.p1.y + hit.p2.y) / 2 },
            severity: 'CRITICAL',
            message: `Short circuit detected between ${a.id} and ${b.id} on ${layerLabel}`
          });
        } else if (hit.dist < required) {
          violations.push({
            type: 'MIN_SPACING_VIOLATION',
            rule: 'minSpacing',
            layer: layerLabel,
            shapeIds: [a.id, b.id],
            location: { x: (hit.p1.x + hit.p2.x) / 2, y: (hit.p1.y + hit.p2.y) / 2 },
            foundValue: +hit.dist.toFixed(6),
            ruleLimit: required,
            severity: 'ERROR',
            edges: [{ x1: hit.p1.x, y1: hit.p1.y, x2: hit.p2.x, y2: hit.p2.y }],
            message: `Spacing ${hit.dist.toFixed(3)} between ${a.id} and ${b.id} on ${layerLabel} is below supplied minSpacing ${required}`
          });
        }
      }
    }

    // 3. Enclosure checks (e.g., metal enclosed by a boundary layer).
    for (const rule of enclosures) {
      if (
        !rule ||
        typeof rule !== 'object' ||
        typeof rule.layer !== 'string' ||
        typeof rule.enclosingLayer !== 'string'
      ) {
        continue;
      }
      const margin = Number.isFinite(rule.margin) && rule.margin >= 0 ? rule.margin : 0;
      const candidates = polys.filter((p) => p.layer === rule.layer);
      const boundaries = polys.filter((p) => p.layer === rule.enclosingLayer);
      if (boundaries.length === 0) {
        for (const c of candidates) {
          violations.push({
            type: 'ENCLOSURE_VIOLATION',
            rule: 'enclosure',
            layer: c.layer,
            shapeId: c.id,
            location: { x: c.vertices[0].x, y: c.vertices[0].y },
            severity: 'ERROR',
            message: `Polygon ${c.id} on ${c.layer} has no enclosing polygon on layer ${rule.enclosingLayer}`
          });
        }
        continue;
      }
      for (const c of candidates) {
        const host = polygonInsideOther(c, boundaries, margin);
        if (!host) {
          violations.push({
            type: 'ENCLOSURE_VIOLATION',
            rule: 'enclosure',
            layer: c.layer,
            shapeId: c.id,
            location: { x: c.vertices[0].x, y: c.vertices[0].y },
            severity: 'ERROR',
            message: `Polygon ${c.id} on ${c.layer} is not enclosed by layer ${rule.enclosingLayer} with margin ${margin}`
          });
        }
      }
    }

    violations.sort((a, b) => {
      const ak = `${a.type}|${a.layer}|${a.shapeId || (a.shapeIds || []).join(',')}`;
      const bk = `${b.type}|${b.layer}|${b.shapeId || (b.shapeIds || []).join(',')}`;
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    });

    const isClean = violations.length === 0;
    return {
      totalShapesChecked: polys.length,
      violationCount: violations.length,
      clean: isClean,
      isClean,
      success: true,
      mode: 'polygon',
      validationLevel: 'experimental',
      scope: 'all-angle polygon width-area-spacing-enclosure-validity screen',
      units: 'caller-defined; shape and rule units must match',
      verdict: isClean ? 'EXPERIMENTAL_POLYGON_SCREENING_CLEAR' : 'EXPERIMENTAL_POLYGON_SCREENING_FLAGS',
      violations
    };
  }

  /**
   * Run Design Rule Checking on layout geometries
   * @param {Array<Object>} shapes Array of 2D axis-aligned rectangles {id, layer, x, y, w, h}
   * @param {Object} rules Explicit rectangular screening limits; geometry and rule units must match
   */
  static runDRC(shapes, rules) {
    const invalidInput = (message) => ({
      success: false,
      validationLevel: 'experimental',
      error: { code: 'INVALID_INPUT', message }
    });
    if (!Array.isArray(shapes) || shapes.length === 0) {
      return invalidInput('A non-empty array of rectangle shapes is required.');
    }
    if (shapes.length > 2000) {
      return invalidInput('At most 2,000 rectangle shapes can be checked by this pairwise screen.');
    }
    if (
      !rules ||
      typeof rules !== 'object' ||
      Array.isArray(rules) ||
      !['minWidth', 'minSpacing', 'minArea'].every((key) => Number.isFinite(rules[key]) && rules[key] > 0)
    ) {
      return invalidInput('Explicit positive minWidth, minSpacing, and minArea screening limits are required.');
    }

    const seenShapeIds = new Set();
    for (const shape of shapes) {
      if (
        !shape ||
        typeof shape !== 'object' ||
        Array.isArray(shape) ||
        typeof shape.id !== 'string' ||
        shape.id.trim() === '' ||
        seenShapeIds.has(shape.id) ||
        typeof shape.layer !== 'string' ||
        shape.layer.trim() === '' ||
        !Number.isFinite(shape.x) ||
        !Number.isFinite(shape.y) ||
        !Number.isFinite(shape.w) ||
        shape.w <= 0 ||
        !Number.isFinite(shape.h) ||
        shape.h <= 0 ||
        !Number.isFinite(shape.x + shape.w) ||
        !Number.isFinite(shape.y + shape.h) ||
        !Number.isFinite(shape.w * shape.h)
      ) {
        return invalidInput(
          'Each rectangle requires a unique id, layer, finite origin, and positive finite width and height.'
        );
      }
      seenShapeIds.add(shape.id);
    }
    const { minWidth, minSpacing, minArea } = rules;

    const violations = [];

    // 1. Minimum Width & Area Checks
    for (const shape of shapes) {
      const w = shape.w;
      const h = shape.h;
      const area = w * h;

      if (w < minWidth || h < minWidth) {
        violations.push({
          type: 'MIN_WIDTH_VIOLATION',
          layer: shape.layer,
          shapeId: shape.id,
          location: { x: shape.x, y: shape.y },
          foundValue: Math.min(w, h),
          ruleLimit: minWidth,
          severity: 'ERROR',
          message: `Shape ${shape.id} on ${shape.layer} width ${Math.min(w, h)} is below supplied minWidth ${minWidth}`
        });
      }

      if (area < minArea) {
        violations.push({
          type: 'MIN_AREA_VIOLATION',
          layer: shape.layer,
          shapeId: shape.id,
          location: { x: shape.x, y: shape.y },
          foundValue: area,
          ruleLimit: minArea,
          severity: 'WARNING',
          message: `Shape ${shape.id} area ${area} is below supplied minArea ${minArea}`
        });
      }
    }

    // 2. Minimum spacing checks by pairwise rectangle bounds.
    const n = shapes.length;
    for (let i = 0; i < n; i++) {
      const s1 = shapes[i];
      for (let j = i + 1; j < n; j++) {
        const s2 = shapes[j];
        if (s1.layer !== s2.layer) continue; // Same-layer spacing only

        // Compute edge-to-edge distance between axis-aligned rectangles
        const dx = Math.max(0, Math.max(s1.x - (s2.x + s2.w), s2.x - (s1.x + s1.w)));
        const dy = Math.max(0, Math.max(s1.y - (s2.y + s2.h), s2.y - (s1.y + s1.h)));
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Check if shapes overlap or are closer than minSpacing
        const overlaps = s1.x < s2.x + s2.w && s1.x + s1.w > s2.x && s1.y < s2.y + s2.h && s1.y + s1.h > s2.y;

        if (overlaps) {
          violations.push({
            type: 'SHORT_CIRCUIT_OVERLAP',
            layer: s1.layer,
            shapeIds: [s1.id, s2.id],
            location: { x: Math.max(s1.x, s2.x), y: Math.max(s1.y, s2.y) },
            severity: 'CRITICAL',
            message: `Short circuit detected between ${s1.id} and ${s2.id} on layer ${s1.layer}`
          });
        } else if (dist < minSpacing) {
          violations.push({
            type: 'MIN_SPACING_VIOLATION',
            layer: s1.layer,
            shapeIds: [s1.id, s2.id],
            location: { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 },
            foundValue: +dist.toFixed(1),
            ruleLimit: minSpacing,
            severity: 'ERROR',
            message: `Spacing ${dist.toFixed(1)} between ${s1.id} and ${s2.id} is below supplied minSpacing ${minSpacing}`
          });
        }
      }
    }

    const isClean = violations.length === 0;
    return {
      totalShapesChecked: shapes.length,
      violationCount: violations.length,
      clean: isClean,
      isClean,
      success: true,
      validationLevel: 'experimental',
      scope: 'axis-aligned rectangle width-area-spacing screen',
      units: 'caller-defined; shape and rule units must match',
      verdict: isClean ? 'EXPERIMENTAL_RECTANGLE_SCREENING_CLEAR' : 'EXPERIMENTAL_RECTANGLE_SCREENING_FLAGS',
      violations
    };
  }

  /** Experimental one-to-one instance matching; this does not compare pins or nets. */
  static runLVS(schematicGates, layoutShapes) {
    const invalidInput = (message) => ({
      success: false,
      isLVSMatched: false,
      validationLevel: 'experimental',
      error: { code: 'INVALID_INPUT', message }
    });
    const readList = (value, fields) => {
      if (Array.isArray(value)) return value;
      if (!value || typeof value !== 'object') return null;
      for (const field of fields) {
        if (Object.hasOwn(value, field)) return Array.isArray(value[field]) ? value[field] : null;
      }
      return null;
    };

    const gates = readList(schematicGates, ['gates'], 'schematic gates');
    const shapes = readList(layoutShapes, ['cells', 'shapes'], 'layout instances');
    if (!gates || gates.length === 0) {
      return invalidInput('Provide at least one schematic gate with an instance id and cell type.');
    }
    if (!shapes || shapes.length === 0) {
      return invalidInput('Provide at least one extracted layout instance with an instance id and cell type.');
    }

    if (gates.length > 10000) {
      return invalidInput('At most 10,000 schematic gates are supported by this experimental matcher.');
    }
    if (shapes.length > 10000) {
      return invalidInput('At most 10,000 layout instances are supported by this experimental matcher.');
    }

    const seenGateIds = new Set();
    for (const gate of gates) {
      if (
        !gate ||
        typeof gate !== 'object' ||
        typeof gate.id !== 'string' ||
        gate.id.trim() === '' ||
        typeof gate.cell !== 'string' ||
        gate.cell.trim() === '' ||
        seenGateIds.has(gate.id)
      ) {
        return invalidInput('Each schematic gate must have a unique non-empty id and cell type.');
      }
      seenGateIds.add(gate.id);
    }

    const layoutInstances = [];
    const seenLayoutIds = new Set();
    for (const shape of shapes) {
      if (!shape || typeof shape !== 'object') {
        return invalidInput('Each layout instance must be an object with an id and cell type.');
      }
      const id = shape.id ?? shape.name;
      const cell = shape.cellType ?? shape.type ?? shape.cell;
      if (
        typeof id !== 'string' ||
        id.trim() === '' ||
        typeof cell !== 'string' ||
        cell.trim() === '' ||
        seenLayoutIds.has(id)
      ) {
        return invalidInput('Each layout instance must have a unique non-empty id and cell type.');
      }
      seenLayoutIds.add(id);
      layoutInstances.push({ id, cell });
    }

    // This remains a simple name/type heuristic, but each extracted instance can match once only.
    const matched = [];
    const unmatchedSchematic = [];
    const consumedLayout = new Set();
    const layoutByNameAndCell = new Map();
    const layoutIndicesByCell = new Map();
    for (let index = 0; index < layoutInstances.length; index++) {
      const instance = layoutInstances[index];
      layoutByNameAndCell.set(JSON.stringify([instance.id, instance.cell]), index);
      if (!layoutIndicesByCell.has(instance.cell)) layoutIndicesByCell.set(instance.cell, { indices: [], cursor: 0 });
      layoutIndicesByCell.get(instance.cell).indices.push(index);
    }

    for (const gate of gates) {
      const exactIndex = layoutByNameAndCell.get(JSON.stringify([gate.id, gate.cell]));
      let matchIndex = exactIndex !== undefined && !consumedLayout.has(exactIndex) ? exactIndex : -1;
      const compatible = layoutIndicesByCell.get(gate.cell);
      if (matchIndex < 0 && compatible) {
        while (
          compatible.cursor < compatible.indices.length &&
          consumedLayout.has(compatible.indices[compatible.cursor])
        ) {
          compatible.cursor++;
        }
        if (compatible.cursor < compatible.indices.length) matchIndex = compatible.indices[compatible.cursor++];
      }
      if (matchIndex >= 0) {
        const match = layoutInstances[matchIndex];
        consumedLayout.add(matchIndex);
        matched.push({ gate: gate.id, layout: match.id });
      } else {
        unmatchedSchematic.push(gate.id);
      }
    }

    const unmatchedLayout = layoutInstances
      .filter((_, index) => !consumedLayout.has(index))
      .map((instance) => instance.id);
    const isLVSMatched = unmatchedSchematic.length === 0 && unmatchedLayout.length === 0;

    return {
      isLVSMatched,
      success: true,
      validationLevel: 'experimental',
      matchScope: 'simple-name-and-cell-type-heuristic',
      matchedCount: matched.length,
      matched,
      unmatchedSchematic,
      unmatchedLayout,
      verdict: isLVSMatched ? 'EXPERIMENTAL_HEURISTIC_MATCH' : 'EXPERIMENTAL_HEURISTIC_MISMATCH'
    };
  }
}

const { SpiceEngine } = require('./spice_engine');
const { GerberExporter } = require('./gerber_exporter');
const { StaticTimingAnalysis } = require('./static_timing_analysis');

DRCEngine.Spice = SpiceEngine;
DRCEngine.Gerber = GerberExporter;
DRCEngine.STA = StaticTimingAnalysis;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DRCEngine,
    SpiceEngine,
    GerberExporter,
    StaticTimingAnalysis
  };
}
