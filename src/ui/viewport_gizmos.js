/**
 * OmniEng Viewport 3D Transformation Gizmos Engine
 * Interactive 3D translation arrows, rotation rings, and scaling handles
 * for in-viewport direct modeling and assembly positioning.
 *
 * Experimental workflow: Onshape / Fusion 360 / Blender 3D Transform Gizmos.
 * Zero external dependencies.
 */

'use strict';

class ViewportGizmos {
  constructor(options = {}) {
    this.mode = options.mode || 'translate'; // 'translate' | 'rotate' | 'scale'
    this.position = options.position || [0, 0, 0];
    this.rotation = options.rotation || [0, 0, 0]; // Euler angles in radians
    this.scale = options.scale || [1, 1, 1];
    this.size = options.size || 1.5; // Gizmo visual extent in world units
    this.snapAngleRad = options.snapAngleRad || (Math.PI / 12); // 15-degree rotation snap
    this.snapDistance = options.snapDistance || 0.5; // 0.5 unit translation snap
    this.snappingEnabled = options.snappingEnabled !== false;

    this.activeAxis = null; // 'X' | 'Y' | 'Z' | 'XY' | 'XZ' | 'YZ' | 'CENTER'
    this.isDragging = false;
    this.dragStartPoint = null;
    this.initialTransform = null;

    this.callbacks = {
      onTransformStart: options.onTransformStart || null,
      onTransformDrag: options.onTransformDrag || null,
      onTransformEnd: options.onTransformEnd || null
    };

    // Color definitions
    this.colors = {
      x: '#ef4444', // Red
      y: '#22c55e', // Green
      z: '#3b82f6', // Blue
      center: '#f59e0b', // Amber/gold
      highlight: '#ffffff' // White
    };
  }

  /**
   * Sets the active gizmo transformation mode
   * @param {'translate'|'rotate'|'scale'} mode
   */
  setMode(mode) {
    if (!['translate', 'rotate', 'scale'].includes(mode)) {
      throw new Error(`Invalid gizmo mode: ${mode}`);
    }
    this.mode = mode;
  }

  /**
   * Sets gizmo target world position
   * @param {Array<number>} pos - [x, y, z]
   */
  setPosition(pos) {
    this.position = [...pos];
  }

  /**
   * Generates geometric geometry descriptors of gizmo elements for rendering in WebGL/Three.js
   * @returns {Object} Gizmo visual primitives
   */
  getGizmoGeometry() {
    const s = this.size;
    const p = this.position;

    return {
      mode: this.mode,
      origin: p,
      axes: {
        X: {
          start: p,
          end: [p[0] + s, p[1], p[2]],
          color: this.activeAxis === 'X' ? this.colors.highlight : this.colors.x,
          type: this.mode === 'translate' ? 'arrow' : (this.mode === 'rotate' ? 'ring' : 'box')
        },
        Y: {
          start: p,
          end: [p[0], p[1] + s, p[2]],
          color: this.activeAxis === 'Y' ? this.colors.highlight : this.colors.y,
          type: this.mode === 'translate' ? 'arrow' : (this.mode === 'rotate' ? 'ring' : 'box')
        },
        Z: {
          start: p,
          end: [p[0], p[1], p[2] + s],
          color: this.activeAxis === 'Z' ? this.colors.highlight : this.colors.z,
          type: this.mode === 'translate' ? 'arrow' : (this.mode === 'rotate' ? 'ring' : 'box')
        },
        CENTER: {
          position: p,
          color: this.activeAxis === 'CENTER' ? this.colors.highlight : this.colors.center,
          radius: s * 0.12
        }
      }
    };
  }

  /**
   * Evaluates raycasting hit-test against gizmo handles
   * @param {Object} ray - { origin: [x,y,z], direction: [dx,dy,dz] }
   * @param {number} [tolerance=0.25]
   * @returns {string|null} Hit axis handle ('X', 'Y', 'Z', 'CENTER')
   */
  hitTest(ray, tolerance = 0.25) {
    const s = this.size;
    const p = this.position;

    // Center handle hit test (sphere intersection)
    const distToCenter = this._distanceRayToPoint(ray, p);
    if (distToCenter < s * 0.20) {
      return 'CENTER';
    }

    // Axial handles (segment proximity)
    const endX = [p[0] + s, p[1], p[2]];
    const endY = [p[0], p[1] + s, p[2]];
    const endZ = [p[0], p[1], p[2] + s];

    const distX = this._distanceRayToSegment(ray, p, endX);
    const distY = this._distanceRayToSegment(ray, p, endY);
    const distZ = this._distanceRayToSegment(ray, p, endZ);

    let closestDist = Infinity;
    let hitAxis = null;

    if (distX < tolerance && distX < closestDist) {
      closestDist = distX;
      hitAxis = 'X';
    }
    if (distY < tolerance && distY < closestDist) {
      closestDist = distY;
      hitAxis = 'Y';
    }
    if (distZ < tolerance && distZ < closestDist) {
      closestDist = distZ;
      hitAxis = 'Z';
    }

    return hitAxis;
  }

  /**
   * Starts an interactive drag gesture on an axis
   */
  startDrag(axis, worldPoint) {
    this.activeAxis = axis;
    this.isDragging = true;
    this.dragStartPoint = [...worldPoint];
    this.initialTransform = {
      position: [...this.position],
      rotation: [...this.rotation],
      scale: [...this.scale]
    };

    if (this.callbacks.onTransformStart) {
      this.callbacks.onTransformStart({
        mode: this.mode,
        axis: this.activeAxis,
        initialTransform: this.initialTransform
      });
    }
  }

  /**
   * Updates drag transform given new mouse world point
   */
  updateDrag(currentWorldPoint) {
    if (!this.isDragging || !this.activeAxis) return null;

    const delta = [
      currentWorldPoint[0] - this.dragStartPoint[0],
      currentWorldPoint[1] - this.dragStartPoint[1],
      currentWorldPoint[2] - this.dragStartPoint[2]
    ];

    if (this.mode === 'translate') {
      const newPos = [...this.initialTransform.position];
      if (this.activeAxis === 'X' || this.activeAxis === 'CENTER') {
        let dx = delta[0];
        if (this.snappingEnabled && this.activeAxis === 'X') {
          dx = Math.round(dx / this.snapDistance) * this.snapDistance;
        }
        newPos[0] += dx;
      }
      if (this.activeAxis === 'Y' || this.activeAxis === 'CENTER') {
        let dy = delta[1];
        if (this.snappingEnabled && this.activeAxis === 'Y') {
          dy = Math.round(dy / this.snapDistance) * this.snapDistance;
        }
        newPos[1] += dy;
      }
      if (this.activeAxis === 'Z' || this.activeAxis === 'CENTER') {
        let dz = delta[2];
        if (this.snappingEnabled && this.activeAxis === 'Z') {
          dz = Math.round(dz / this.snapDistance) * this.snapDistance;
        }
        newPos[2] += dz;
      }
      this.position = newPos;
    } else if (this.mode === 'rotate') {
      const newRot = [...this.initialTransform.rotation];
      // Angle estimation based on tangential drag
      const angleDelta = (delta[0] + delta[1] + delta[2]) * 0.5;
      let snapAngle = angleDelta;
      if (this.snappingEnabled) {
        snapAngle = Math.round(angleDelta / this.snapAngleRad) * this.snapAngleRad;
      }

      if (this.activeAxis === 'X') newRot[0] += snapAngle;
      if (this.activeAxis === 'Y') newRot[1] += snapAngle;
      if (this.activeAxis === 'Z') newRot[2] += snapAngle;
      this.rotation = newRot;
    } else if (this.mode === 'scale') {
      const newScale = [...this.initialTransform.scale];
      const factor = 1.0 + (delta[0] + delta[1] + delta[2]) * 0.2;
      const safeFactor = Math.max(0.01, factor);

      if (this.activeAxis === 'X' || this.activeAxis === 'CENTER') newScale[0] *= safeFactor;
      if (this.activeAxis === 'Y' || this.activeAxis === 'CENTER') newScale[1] *= safeFactor;
      if (this.activeAxis === 'Z' || this.activeAxis === 'CENTER') newScale[2] *= safeFactor;
      this.scale = newScale;
    }

    const result = {
      mode: this.mode,
      axis: this.activeAxis,
      position: [...this.position],
      rotation: [...this.rotation],
      scale: [...this.scale]
    };

    if (this.callbacks.onTransformDrag) {
      this.callbacks.onTransformDrag(result);
    }

    return result;
  }

  /**
   * Concludes the drag gesture
   */
  endDrag() {
    if (!this.isDragging) return null;

    const finalState = {
      mode: this.mode,
      axis: this.activeAxis,
      position: [...this.position],
      rotation: [...this.rotation],
      scale: [...this.scale]
    };

    this.isDragging = false;
    this.activeAxis = null;
    this.dragStartPoint = null;

    if (this.callbacks.onTransformEnd) {
      this.callbacks.onTransformEnd(finalState);
    }

    return finalState;
  }

  // --- Internal Ray Math Helpers ---
  _distanceRayToPoint(ray, pt) {
    const v = [pt[0] - ray.origin[0], pt[1] - ray.origin[1], pt[2] - ray.origin[2]];
    const d = ray.direction;
    const proj = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
    const closest = [
      ray.origin[0] + d[0] * proj,
      ray.origin[1] + d[1] * proj,
      ray.origin[2] + d[2] * proj
    ];
    const diff = [pt[0] - closest[0], pt[1] - closest[1], pt[2] - closest[2]];
    return Math.sqrt(diff[0] * diff[0] + diff[1] * diff[1] + diff[2] * diff[2]);
  }

  _distanceRayToSegment(ray, p0, p1) {
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v = ray.direction;
    const w0 = [p0[0] - ray.origin[0], p0[1] - ray.origin[1], p0[2] - ray.origin[2]];

    const a = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    const b = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const c = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    const d = u[0] * w0[0] + u[1] * w0[1] + u[2] * w0[2];
    const e = v[0] * w0[0] + v[1] * w0[1] + v[2] * w0[2];

    const denom = a * c - b * b;
    let tc = 0.0;
    if (denom > 1e-12) {
      const t = (b * e - c * d) / denom;
      tc = Math.max(0.0, Math.min(1.0, t));
    } else {
      tc = a > 1e-12 ? Math.max(0.0, Math.min(1.0, -d / a)) : 0.0;
    }

    const sc = c > 1e-12 ? Math.max(0.0, (b * tc + e) / c) : 0.0;

    const ps = [p0[0] + tc * u[0], p0[1] + tc * u[1], p0[2] + tc * u[2]];
    const pr = [ray.origin[0] + sc * v[0], ray.origin[1] + sc * v[1], ray.origin[2] + sc * v[2]];

    const diff = [ps[0] - pr[0], ps[1] - pr[1], ps[2] - pr[2]];
    return Math.sqrt(diff[0] * diff[0] + diff[1] * diff[1] + diff[2] * diff[2]);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ViewportGizmos
  };
}
if (typeof window !== 'undefined') {
  window.ViewportGizmos = ViewportGizmos;
}
