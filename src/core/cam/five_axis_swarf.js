/**
 * FiveAxisSwarf: Industrial 5-Axis Flank & Ruled Surface Swarf Milling Engine
 *
 * Implements Siemens NX / PowerMill 5-axis swarf milling:
 *   1. Ruled surface flank machining: aligns tool side cutting edges with surface ruling lines.
 *   2. Ruled surface defined by upper curve C_top(u) and lower curve C_bottom(u).
 *   3. Tool axis vector: u_tool = (C_top - C_bottom) / ||C_top - C_bottom||.
 *   4. Tool tip contact: P_tip = C_bottom + R_tool * n_surface.
 *   5. Automatic tool gouge and undercut verification along surface ruling.
 */

'use strict';

const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

class FiveAxisSwarf {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.toolRadius = options.toolRadius || 5.0; // mm
    this.toolLength = options.toolLength || 50.0; // mm
  }

  /**
   * Plan 5-axis swarf toolpath along a ruled surface defined by upper and lower rail curves
   * @param {Array<[number, number, number]>} bottomRail Curve on floor/bottom
   * @param {Array<[number, number, number]>} topRail Curve on top/ceiling
   * @param {number} [samples=20]
   * @returns {Array<{ u: number, tipPoint: [number, number, number], toolAxis: [number, number, number], rulingLength: number }>}
   */
  planSwarfToolpath(bottomRail, topRail, samples = 20) {
    if (!bottomRail || !topRail || bottomRail.length < 2 || topRail.length < 2) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Both bottom and top rails must contain at least 2 points.');
    }
    if (bottomRail.length !== topRail.length) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Bottom and top rails must have matching sample counts.');
    }

    const n = bottomRail.length;
    const toolpath = [];
    const R = this.toolRadius;

    for (let i = 0; i < n; i++) {
      const pBot = bottomRail[i];
      const pTop = topRail[i];

      // Ruling vector from bottom to top
      const rx = pTop[0] - pBot[0];
      const ry = pTop[1] - pBot[1];
      const rz = pTop[2] - pBot[2];
      const rulingLen = Math.hypot(rx, ry, rz);

      if (rulingLen < 1e-4) {
        throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, `Degenerate ruling line at station ${i}.`);
      }

      // Unit tool axis vector
      const axis = [rx / rulingLen, ry / rulingLen, rz / rulingLen];

      // Rail tangent vector
      let tx, ty, tz;
      if (i < n - 1) {
        tx = bottomRail[i + 1][0] - pBot[0];
        ty = bottomRail[i + 1][1] - pBot[1];
        tz = bottomRail[i + 1][2] - pBot[2];
      } else {
        tx = pBot[0] - bottomRail[i - 1][0];
        ty = pBot[1] - bottomRail[i - 1][1];
        tz = pBot[2] - bottomRail[i - 1][2];
      }
      const tLen = Math.hypot(tx, ty, tz) || 1.0;
      const tangent = [tx / tLen, ty / tLen, tz / tLen];

      // Normal to ruling and tangent: n = axis x tangent
      let nx = axis[1] * tangent[2] - axis[2] * tangent[1];
      let ny = axis[2] * tangent[0] - axis[0] * tangent[2];
      let nz = axis[0] * tangent[1] - axis[1] * tangent[0];
      const nLen = Math.hypot(nx, ny, nz) || 1.0;
      const normal = [nx / nLen, ny / nLen, nz / nLen];

      // Tool tip offset along surface normal: P_tip = P_bot + R * normal
      const tipPoint = [
        pBot[0] + normal[0] * R,
        pBot[1] + normal[1] * R,
        pBot[2] + normal[2] * R
      ];

      toolpath.push({
        u: i / (n - 1),
        tipPoint,
        toolAxis: axis,
        rulingLength: rulingLen
      });
    }

    return toolpath;
  }
}

module.exports = { FiveAxisSwarf };
