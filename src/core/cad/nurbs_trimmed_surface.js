/**
 * Trimmed NURBS surface kernel.
 *
 * A trimmed surface is a { surface: NurbsSurface, trims: [TrimLoop2D] }
 * pair: an untrimmed NURBS surface plus a set of closed 2D NURBS loops
 * (p-curves) in the parameter domain. Outer loops bound the material
 * region; inner loops are holes.
 *
 * Point classification uses a winding-number test against a dense polyline
 * sampling of the trim loops (robust in both directions), and tessellation
 * samples the parameter domain, classifies samples, and emits only
 * inside-trim triangles with surface normals.
 *
 * Numerics are experimental, as in the sibling NURBS modules.
 */

'use strict';

const { NurbsSurface, SurfaceSurfaceIntersection } = require('./nurbs_engine');

class NurbsCurve2D {
  /**
   * 2D NURBS curve. Control points are [u, v] pairs.
   */
  constructor({ degree = 2, controlPoints = [], weights = null, knots = null }) {
    this.degree = degree;
    this.controlPoints = controlPoints.map((p) => [Number(p[0]), Number(p[1])]);
    this.n = this.controlPoints.length - 1;
    if (this.n < this.degree) {
      throw new Error(`Insufficient 2D control points (${this.controlPoints.length}) for degree ${this.degree}`);
    }
    this.weights = weights ? [...weights] : new Array(this.controlPoints.length).fill(1.0);
    this.knots = knots ? [...knots] : NurbsCurve2D._generateClampedKnots(this.n, this.degree);
  }

  static _generateClampedKnots(n, p) {
    const knots = [];
    const m = n + p + 1;
    for (let i = 0; i <= p; i++) knots.push(0);
    const numInternal = m - 2 * p - 1;
    for (let i = 1; i <= numInternal; i++) knots.push(i / (numInternal + 1));
    for (let i = 0; i <= p; i++) knots.push(1);
    return knots;
  }

  static _basis(i, p, u, U) {
    if (p === 0) {
      if (u === U[U.length - 1] && u === U[i + 1]) return 1.0;
      return u >= U[i] && u < U[i + 1] ? 1.0 : 0.0;
    }
    let left = 0;
    let right = 0;
    const d1 = U[i + p] - U[i];
    if (Math.abs(d1) > 1e-12) left = ((u - U[i]) / d1) * NurbsCurve2D._basis(i, p - 1, u, U);
    const d2 = U[i + p + 1] - U[i + 1];
    if (Math.abs(d2) > 1e-12) right = ((U[i + p + 1] - u) / d2) * NurbsCurve2D._basis(i + 1, p - 1, u, U);
    return left + right;
  }

  evaluate(t) {
    t = Math.max(this.knots[0], Math.min(this.knots[this.knots.length - 1], t));
    let nu = 0;
    let nv = 0;
    let denom = 0;
    for (let i = 0; i <= this.n; i++) {
      const N = NurbsCurve2D._basis(i, this.degree, t, this.knots);
      if (Math.abs(N) < 1e-12) continue;
      const wN = this.weights[i] * N;
      nu += wN * this.controlPoints[i][0];
      nv += wN * this.controlPoints[i][1];
      denom += wN;
    }
    if (Math.abs(denom) < 1e-12) denom = 1.0;
    return { u: nu / denom, v: nv / denom };
  }

  /**
   * Exact rational quadratic circular arc in parameter space, from angle a0
   * to a1 (radians) about (cu, cv) with radius r. Weight = cos((a1-a0)/2).
   */
  static makeCircularArc(cu, cv, r, a0, a1) {
    const w = Math.cos((a1 - a0) / 2);
    const mid = (a0 + a1) / 2;
    const k = 1 / Math.cos((a1 - a0) / 2);
    return new NurbsCurve2D({
      degree: 2,
      controlPoints: [
        [cu + r * Math.cos(a0), cv + r * Math.sin(a0)],
        [cu + r * k * Math.cos(mid), cv + r * k * Math.sin(mid)],
        [cu + r * Math.cos(a1), cv + r * Math.sin(a1)]
      ],
      weights: [1, w, 1],
      knots: [0, 0, 0, 1, 1, 1]
    });
  }

  /**
   * Four exact rational quadratic arcs forming a closed circle.
   */
  static makeCircle(cu, cv, r) {
    const arcs = [];
    for (let q = 0; q < 4; q++) {
      arcs.push(NurbsCurve2D.makeCircularArc(cu, cv, r, (q * Math.PI) / 2, ((q + 1) * Math.PI) / 2));
    }
    return arcs;
  }
}

class TrimLoop2D {
  constructor({ isOuter = false, curves = [] } = {}) {
    this.isOuter = isOuter;
    this.curves = curves.slice();
    this._polyline = null;
  }

  addCurve(curve) {
    this.curves.push(curve);
    this._polyline = null;
    return this;
  }

  samplePolyline(samplesPerCurve = 48) {
    if (this._polyline) return this._polyline;
    const pts = [];
    for (const c of this.curves) {
      for (let i = 0; i < samplesPerCurve; i++) {
        const p = c.evaluate(i / samplesPerCurve);
        pts.push([p.u, p.v]);
      }
    }
    this._polyline = pts;
    return pts;
  }

  /**
   * Signed winding number of the sampled loop about (u, v).
   */
  windingNumber(u, v) {
    const pts = this.samplePolyline();
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const dx1 = pts[i][0] - u;
      const dy1 = pts[i][1] - v;
      const dx2 = pts[j][0] - u;
      const dy2 = pts[j][1] - v;
      sum += Math.atan2(dx1 * dy2 - dy1 * dx2, dx1 * dx2 + dy1 * dy2);
    }
    return sum / (2 * Math.PI);
  }

  contains(u, v) {
    return Math.abs(this.windingNumber(u, v)) > 0.5;
  }

  distanceTo(u, v) {
    const pts = this.samplePolyline();
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const dx = pts[j][0] - pts[i][0];
      const dy = pts[j][1] - pts[i][1];
      const L2 = dx * dx + dy * dy;
      let t = L2 > 0 ? ((u - pts[i][0]) * dx + (v - pts[i][1]) * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = pts[i][0] + t * dx;
      const py = pts[i][1] + t * dy;
      best = Math.min(best, Math.hypot(u - px, v - py));
    }
    return best;
  }

  static circular(cu, cv, r, { isOuter = false } = {}) {
    const loop = new TrimLoop2D({ isOuter });
    for (const c of NurbsCurve2D.makeCircle(cu, cv, r)) loop.addCurve(c);
    return loop;
  }
}

class TrimmedNurbsSurface {
  constructor({ surface = null, trims = [] } = {}) {
    this.surface = surface;
    this.trims = trims.map((t) => (t instanceof TrimLoop2D ? t : new TrimLoop2D(t)));
  }

  addTrimLoop(loop) {
    this.trims.push(loop instanceof TrimLoop2D ? loop : new TrimLoop2D(loop));
    return this;
  }

  /**
   * Evaluates the surface at (u, v) and reports trimming status.
   * Returns { point, status: 'inside'|'outside'|'on', inRegion }.
   */
  pointOnTrimmedSurface(u, v) {
    const point = this.surface.evaluate(u, v);
    const outers = this.trims.filter((l) => l.isOuter);
    if (outers.length > 0) {
      let inOuter = false;
      for (const loop of outers) {
        if (loop.contains(u, v)) {
          inOuter = true;
          break;
        }
      }
      if (!inOuter) return { point, status: 'outside', inRegion: false };
    }
    for (const loop of this.trims) {
      if (loop.isOuter) continue;
      if (loop.contains(u, v)) return { point, status: 'outside', inRegion: false };
    }
    for (const loop of this.trims) {
      if (loop.distanceTo(u, v) < 1e-9) return { point, status: 'on', inRegion: true };
    }
    return { point, status: 'inside', inRegion: true };
  }

  /**
   * Trimming-aware tessellation. Samples the parametric domain, classifies
   * samples against the trim loops, subdivides boundary cells, and emits
   * only inside-trim triangles with surface normals.
   */
  tessellate(resU = 64, resV = 64, { maxSubdiv = 3, samplesPerCurve = 48 } = {}) {
    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const triangles = [];

    const emitVertex = (u, v) => {
      const pt = this.surface.evaluate(u, v);
      const n = this.surface.evaluateNormal(u, v);
      vertices.push(pt);
      normals.push(n);
      uvs.push([u, v]);
      return vertices.length - 1;
    };

    const emitTriangle = (a, b, c) => {
      indices.push(a, b, c);
      triangles.push([a, b, c]);
    };

    const pushQuad = (u0, u1, v0, v1) => {
      const i00 = emitVertex(u0, v0);
      const i10 = emitVertex(u1, v0);
      const i01 = emitVertex(u0, v1);
      const i11 = emitVertex(u1, v1);
      emitTriangle(i00, i10, i01);
      emitTriangle(i10, i11, i01);
    };

    const classify = (u, v) => this.pointOnTrimmedSurface(u, v).inRegion;

    const processCell = (u0, u1, v0, v1, depth) => {
      const a = classify(u0, v0);
      const b = classify(u1, v0);
      const c = classify(u0, v1);
      const d = classify(u1, v1);
      if (a && b && c && d) {
        pushQuad(u0, u1, v0, v1);
        return;
      }
      if (!a && !b && !c && !d) return;
      if (depth < maxSubdiv) {
        const um = (u0 + u1) / 2;
        const vm = (v0 + v1) / 2;
        processCell(u0, um, v0, vm, depth + 1);
        processCell(um, u1, v0, vm, depth + 1);
        processCell(u0, um, vm, v1, depth + 1);
        processCell(um, u1, vm, v1, depth + 1);
        return;
      }
      const um = (u0 + u1) / 2;
      const vm = (v0 + v1) / 2;
      const fan = [
        [
          [u0, v0],
          [u1, v0],
          [um, vm]
        ],
        [
          [u1, v0],
          [u1, v1],
          [um, vm]
        ],
        [
          [u1, v1],
          [u0, v1],
          [um, vm]
        ],
        [
          [u0, v1],
          [u0, v0],
          [um, vm]
        ]
      ];
      for (const tri of fan) {
        const cu = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
        const cv = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
        if (classify(cu, cv))
          emitTriangle(
            emitVertex(tri[0][0], tri[0][1]),
            emitVertex(tri[1][0], tri[1][1]),
            emitVertex(tri[2][0], tri[2][1])
          );
      }
    };

    for (let i = 0; i < resU; i++) {
      const u0 = i / resU;
      const u1 = (i + 1) / resU;
      for (let j = 0; j < resV; j++) {
        const v0 = j / resV;
        const v1 = (j + 1) / resV;
        processCell(u0, u1, v0, v1, 0);
      }
    }

    let area = 0;
    for (const [ai, bi, ci] of triangles) {
      const ab = vertices[bi].clone().sub(vertices[ai]);
      const ac = vertices[ci].clone().sub(vertices[ai]);
      area += 0.5 * ab.cross(ac).length();
    }

    return { vertices, normals, uvs, indices, triangles, area };
  }

  /**
   * Surface-surface intersection fallback: delegates to the existing SSI
   * engine in nurbs_engine.js.
   */
  intersectWith(other, options = {}) {
    return SurfaceSurfaceIntersection.intersect(this.surface, other, options);
  }
}

module.exports = {
  NurbsCurve2D,
  TrimLoop2D,
  TrimmedNurbsSurface
};
