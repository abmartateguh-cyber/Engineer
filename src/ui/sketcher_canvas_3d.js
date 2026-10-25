/**
 * OmniEng In-Viewport 3D Parametric Sketcher Canvas
 * Projects 3D ray intersections onto active drafting planes (XY, XZ, YZ, or planar face),
 * manages rubber-band drafting gestures, and infers variational geometric constraints.
 *
 * Experimental viewport sketching helper. It does not claim compatibility or
 * feature parity with other CAD products.
 */

'use strict';

class SketcherCanvas3D {
  /**
   * @param {Object} options
   * @param {string|Object} [options.plane='XY'] - 'XY' | 'XZ' | 'YZ' or custom { origin, normal, uAxis }
   * @param {number} [options.snapTolerance=0.2] - Linear snap distance in sketch units
   * @param {number} [options.angularSnapTolRad=0.087] - ~5 degrees for H/V snapping
   */
  constructor(options = {}) {
    this.snapTolerance = options.snapTolerance || 0.2;
    this.angularSnapTolRad = options.angularSnapTolRad || 0.087;

    this.activeTool = 'line'; // 'line' | 'rectangle' | 'circle' | 'arc'
    this.isDrafting = false;
    this.draftStart = null;
    this.currentPointer = null;

    this.points = new Map(); // id -> { id, u, v, fixed }
    this.entities = [];      // lines, circles, arcs
    this.constraints = [];   // HORIZONTAL, VERTICAL, COINCIDENT, DISTANCE, etc.

    this.pointCounter = 1;
    this.entityCounter = 1;

    this.setPlane(options.plane || 'XY');
  }

  /**
   * Sets the active sketching plane
   * @param {string|Object} planeSpec
   */
  setPlane(planeSpec) {
    if (typeof planeSpec === 'string') {
      const p = planeSpec.toUpperCase();
      if (p === 'XY') {
        this.plane = { origin: [0, 0, 0], normal: [0, 0, 1], uAxis: [1, 0, 0], vAxis: [0, 1, 0] };
      } else if (p === 'XZ') {
        this.plane = { origin: [0, 0, 0], normal: [0, 1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, 1] };
      } else if (p === 'YZ') {
        this.plane = { origin: [0, 0, 0], normal: [1, 0, 0], uAxis: [0, 1, 0], vAxis: [0, 0, 1] };
      } else {
        throw new Error(`Unsupported plane string: ${planeSpec}`);
      }
    } else if (typeof planeSpec === 'object' && planeSpec.normal && planeSpec.uAxis) {
      this.plane = planeSpec;
    } else {
      throw new Error('Invalid plane specification');
    }
  }

  /**
   * Projects a 3D ray onto the sketch plane and returns 2D (u, v) coordinates
   * @param {Object} ray - { origin: [x,y,z], direction: [dx,dy,dz] }
   * @returns {Array<number>|null} [u, v]
   */
  projectRayToPlane(ray) {
    const { origin: p0, normal: n, uAxis: uA, vAxis: vA } = this.plane;
    const r0 = ray.origin;
    const d = ray.direction;

    // Ray-plane intersection: t = ((p0 - r0) . n) / (d . n)
    const denom = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    if (Math.abs(denom) < 1e-8) return null; // Ray parallel to plane

    const pDiff = [p0[0] - r0[0], p0[1] - r0[1], p0[2] - r0[2]];
    const t = (pDiff[0] * n[0] + pDiff[1] * n[1] + pDiff[2] * n[2]) / denom;
    if (t < 0) return null; // Behind ray origin

    const hit = [r0[0] + d[0] * t, r0[1] + d[1] * t, r0[2] + d[2] * t];

    // Project hit point relative to plane origin onto uAxis and vAxis
    const rel = [hit[0] - p0[0], hit[1] - p0[1], hit[2] - p0[2]];
    const u = rel[0] * uA[0] + rel[1] * uA[1] + rel[2] * uA[2];
    const v = rel[0] * vA[0] + rel[1] * vA[1] + rel[2] * vA[2];

    return [u, v];
  }

  /**
   * Sets active drafting tool
   * @param {'line'|'rectangle'|'circle'|'arc'} tool
   */
  setTool(tool) {
    this.activeTool = tool;
  }

  /**
   * Adds or snaps to a point in the sketch
   * @param {number} u
   * @param {number} v
   * @returns {Object} point object
   */
  getOrCreatePoint(u, v) {
    // Check snap to existing point
    for (const pt of this.points.values()) {
      const dist = Math.hypot(pt.u - u, pt.v - v);
      if (dist <= this.snapTolerance) {
        return pt;
      }
    }

    const id = `P${this.pointCounter++}`;
    const newPt = { id, u: Number(u.toFixed(4)), v: Number(v.toFixed(4)), fixed: this.points.size === 0 };
    this.points.set(id, newPt);
    return newPt;
  }

  /**
   * Begins a rubber-band drafting gesture at (u, v)
   */
  startDrafting(u, v) {
    this.isDrafting = true;
    this.draftStart = this.getOrCreatePoint(u, v);
    this.currentPointer = [u, v];
  }

  /**
   * Updates pointer position during rubber-band dragging with constraint inference preview
   */
  updateDrafting(u, v) {
    if (!this.isDrafting || !this.draftStart) return null;

    let targetU = u;
    let targetV = v;
    let inferredConstraint = null;

    // Check horizontal snap
    if (Math.abs(v - this.draftStart.v) < this.snapTolerance) {
      targetV = this.draftStart.v;
      inferredConstraint = 'HORIZONTAL';
    }
    // Check vertical snap
    else if (Math.abs(u - this.draftStart.u) < this.snapTolerance) {
      targetU = this.draftStart.u;
      inferredConstraint = 'VERTICAL';
    }

    this.currentPointer = [targetU, targetV];

    return {
      tool: this.activeTool,
      start: { u: this.draftStart.u, v: this.draftStart.v },
      current: { u: targetU, v: targetV },
      inferredConstraint
    };
  }

  /**
   * Commits the drafted entity and infers geometric constraints
   */
  commitDrafting(u, v) {
    if (!this.isDrafting || !this.draftStart) return null;

    const preview = this.updateDrafting(u, v);
    const finalU = preview ? preview.current.u : u;
    const finalV = preview ? preview.current.v : v;

    const endPoint = this.getOrCreatePoint(finalU, finalV);
    const entityId = `E${this.entityCounter++}`;

    let committedEntity = null;

    if (this.activeTool === 'line') {
      committedEntity = {
        id: entityId,
        type: 'LINE',
        p1: this.draftStart.id,
        p2: endPoint.id
      };
      this.entities.push(committedEntity);

      // Infer constraints
      if (preview && preview.inferredConstraint === 'HORIZONTAL') {
        this.constraints.push({ type: 'HORIZONTAL', point1: this.draftStart.id, point2: endPoint.id });
      } else if (preview && preview.inferredConstraint === 'VERTICAL') {
        this.constraints.push({ type: 'VERTICAL', point1: this.draftStart.id, point2: endPoint.id });
      }
    } else if (this.activeTool === 'circle') {
      const radius = Math.hypot(finalU - this.draftStart.u, finalV - this.draftStart.v);
      committedEntity = {
        id: entityId,
        type: 'CIRCLE',
        center: this.draftStart.id,
        radius: Number(radius.toFixed(4))
      };
      this.entities.push(committedEntity);
    } else if (this.activeTool === 'rectangle') {
      const p1 = this.draftStart;
      const p2 = this.getOrCreatePoint(finalU, p1.v);
      const p3 = endPoint;
      const p4 = this.getOrCreatePoint(p1.u, finalV);

      this.entities.push(
        { id: `E${this.entityCounter++}`, type: 'LINE', p1: p1.id, p2: p2.id },
        { id: `E${this.entityCounter++}`, type: 'LINE', p1: p2.id, p2: p3.id },
        { id: `E${this.entityCounter++}`, type: 'LINE', p1: p3.id, p2: p4.id },
        { id: `E${this.entityCounter++}`, type: 'LINE', p1: p4.id, p2: p1.id }
      );

      this.constraints.push(
        { type: 'HORIZONTAL', point1: p1.id, point2: p2.id },
        { type: 'VERTICAL', point1: p2.id, point2: p3.id },
        { type: 'HORIZONTAL', point1: p4.id, point2: p3.id },
        { type: 'VERTICAL', point1: p1.id, point2: p4.id }
      );

      committedEntity = { id: entityId, type: 'RECTANGLE', corners: [p1.id, p2.id, p3.id, p4.id] };
    }

    this.isDrafting = false;
    this.draftStart = null;
    this.currentPointer = null;

    return committedEntity;
  }

  /**
   * Exports the sketch as a VariationalConstraintSolver AST ready for Newton-Raphson SVD
   * @returns {Object} { points, constraints }
   */
  exportConstraintGraph() {
    const pointsObj = {};
    for (const [id, pt] of this.points.entries()) {
      pointsObj[id] = {
        x: pt.u,
        y: pt.v,
        fixed: pt.fixed,
        label: id
      };
    }

    return {
      points: pointsObj,
      constraints: [...this.constraints],
      entityCount: this.entities.length
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SketcherCanvas3D
  };
}
if (typeof window !== 'undefined') {
  window.SketcherCanvas3D = SketcherCanvas3D;
}
