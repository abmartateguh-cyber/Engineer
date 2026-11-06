/**
 * Experimental polygon helpers: convex-clipper intersection and a per-vertex
 * offset heuristic. Union, difference, XOR, foundry rule semantics, and
 * independent geometric validation are not implemented here.
 */

'use strict';

class Polygon2D {
  /**
   * @param {Array<{x: number, y: number}>} vertices - Ordered polygon boundary points
   */
  constructor(vertices = []) {
    this.vertices = vertices.map((v) => ({ x: v.x, y: v.y }));
  }

  area() {
    let a = 0;
    const n = this.vertices.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      a += (this.vertices[j].x + this.vertices[i].x) * (this.vertices[j].y - this.vertices[i].y);
    }
    return Math.abs(a * 0.5);
  }

  isPointInside(px, py) {
    let inside = false;
    const n = this.vertices.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = this.vertices[i].x,
        yi = this.vertices[i].y;
      const xj = this.vertices[j].x,
        yj = this.vertices[j].y;
      const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
}

class PolygonBooleanEngine {
  /**
   * Computes intersection between two axis-aligned or arbitrary 2D polygons
   * @param {Polygon2D} polyA
   * @param {Polygon2D} polyB
   * @returns {Polygon2D[]} Array of resulting intersection polygons
   */
  static intersect(polyA, polyB) {
    // Sutherland-Hodgman convex/general polygon clipping
    let outputList = polyA.vertices.map((v) => ({ ...v }));
    const nB = polyB.vertices.length;

    for (let i = 0; i < nB; i++) {
      const p1 = polyB.vertices[i];
      const p2 = polyB.vertices[(i + 1) % nB];
      const inputList = outputList;
      outputList = [];

      if (inputList.length === 0) break;

      let s = inputList[inputList.length - 1];
      for (const e of inputList) {
        if (this._isInsideEdge(e, p1, p2)) {
          if (this._isInsideEdge(s, p1, p2)) {
            outputList.push(e);
          } else {
            outputList.push(this._computeIntersection(s, e, p1, p2));
            outputList.push(e);
          }
        } else if (this._isInsideEdge(s, p1, p2)) {
          outputList.push(this._computeIntersection(s, e, p1, p2));
        }
        s = e;
      }
    }

    return outputList.length >= 3 ? [new Polygon2D(outputList)] : [];
  }

  static _isInsideEdge(p, p1, p2) {
    return (p2.x - p1.x) * (p.y - p1.y) - (p2.y - p1.y) * (p.x - p1.x) >= -1e-9;
  }

  static _computeIntersection(s, e, p1, p2) {
    const a1 = e.y - s.y;
    const b1 = s.x - e.x;
    const c1 = a1 * s.x + b1 * s.y;

    const a2 = p2.y - p1.y;
    const b2 = p1.x - p2.x;
    const c2 = a2 * p1.x + b2 * p1.y;

    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-12) return { x: s.x, y: s.y };

    return {
      x: (b2 * c1 - b1 * c2) / det,
      y: (a1 * c2 - a2 * c1) / det
    };
  }

  /**
   * Grows or shrinks (dilates or erodes) polygon boundaries by delta
   * @param {Polygon2D} poly
   * @param {number} delta - Positive = grow/expand, negative = shrink/erode (in nm or microns)
   * @returns {Polygon2D}
   */
  static sizePolygon(poly, delta = 10.0) {
    const n = poly.vertices.length;
    const newVerts = [];

    for (let i = 0; i < n; i++) {
      const pPrev = poly.vertices[(i + n - 1) % n];
      const pCur = poly.vertices[i];
      const pNext = poly.vertices[(i + 1) % n];

      // Edge 1 normal
      const e1x = pCur.x - pPrev.x,
        e1y = pCur.y - pPrev.y;
      const l1 = Math.hypot(e1x, e1y) || 1.0;
      const n1x = -e1y / l1,
        n1y = e1x / l1;

      // Edge 2 normal
      const e2x = pNext.x - pCur.x,
        e2y = pNext.y - pCur.y;
      const l2 = Math.hypot(e2x, e2y) || 1.0;
      const n2x = -e2y / l2,
        n2y = e2x / l2;

      // Average outward bisector normal
      let bx = n1x + n2x;
      let by = n1y + n2y;
      const bLen = Math.hypot(bx, by) || 1.0;
      bx /= bLen;
      by /= bLen;

      newVerts.push({
        x: pCur.x + delta * bx,
        y: pCur.y + delta * by
      });
    }

    return new Polygon2D(newVerts);
  }
}

module.exports = {
  Polygon2D,
  PolygonBooleanEngine
};
