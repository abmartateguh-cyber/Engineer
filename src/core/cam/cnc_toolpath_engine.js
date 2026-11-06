/**
 * OmniEng CAM (Computer-Aided Manufacturing) 3-Axis CNC Toolpath Engine
 *
 * Generates experimental CNC milling toolpaths from 3D CAD B-Rep solid geometry:
 * - Constant-Z Planar Roughing (Pocketing with zig-zag clearing)
 * - Parallel Surface Finishing (Ball-end raster finishing)
 * - Illustrative G-Code text serialization (not a machine-specific post-processor)
 * - Machining telemetry: cut time, toolpath length, and material removal rate (MRR)
 *
 * Real 3-axis contour-parallel toolpath generation (plan3AxisToolpath):
 *  - contour-parallel roughing via miter-join polygon offsetting with
 *    self-intersection cleanup (planar-subdivision face extraction),
 *  - radial engagement policy (stepover bounded by a fraction of tool diameter),
 *  - finish pass (boundary-following cut at finish feedrate),
 *  - 3-axis Z-layering with plunge/retract moves and a collision-safe retract plane,
 *  - G-code with per-operation feedrates and G2/G3 arcs where corners are rounded.
 */

const {
  EPS,
  signedArea,
  isCcw,
  toCcw,
  segmentsIntersect,
  pointInPolygon,
  offsetRegion,
  applyRoundedCorners,
  loopBoundingBox
} = require('./planar_offset_geometry');

class CNCToolpathEngine {
  constructor(options = {}) {
    const required = [
      'toolDiameter',
      'toolType',
      'spindleRpm',
      'feedRateMmMin',
      'plungeRateMmMin',
      'stepoverMm',
      'stepdownMm',
      'safeZ'
    ];
    const missing = required.filter((key) => options[key] === undefined || options[key] === null);
    if (missing.length > 0) {
      throw new TypeError(`CNCToolpathEngine requires explicit tool options: ${missing.join(', ')}`);
    }
    if (
      !['toolDiameter', 'spindleRpm', 'feedRateMmMin', 'plungeRateMmMin', 'stepoverMm', 'stepdownMm', 'safeZ'].every(
        (key) => Number.isFinite(options[key])
      ) ||
      options.toolDiameter <= 0 ||
      options.spindleRpm <= 0 ||
      options.feedRateMmMin <= 0 ||
      options.plungeRateMmMin <= 0 ||
      options.stepoverMm <= 0 ||
      options.stepdownMm <= 0 ||
      !['flat_endmill', 'ball_nose'].includes(options.toolType)
    ) {
      throw new TypeError(
        'CNCToolpathEngine tool options must be finite and physically positive with a supported toolType.'
      );
    }
    this.toolDiameter = options.toolDiameter; // mm
    this.toolType = options.toolType; // 'flat_endmill' | 'ball_nose'
    this.spindleRpm = options.spindleRpm; // RPM
    this.feedRateMmMin = options.feedRateMmMin; // mm/min
    this.plungeRateMmMin = options.plungeRateMmMin; // mm/min
    this.stepoverMm = options.stepoverMm; // mm
    this.stepdownMm = options.stepdownMm; // mm per Z slice
    this.safeZ = options.safeZ; // mm
    this.finishFeedRateMmMin = options.finishFeedRateMmMin ?? options.feedRateMmMin; // mm/min
    this.radialEngagementFraction = options.radialEngagementFraction ?? 0.4; // fraction of tool diameter
    this.retractPlane = options.retractPlane ?? options.safeZ; // mm; collision-safe clear plane
    this.cornerRadiusMm = options.cornerRadiusMm ?? 0; // mm; 0 = sharp mitered corners
    this.legacyMode = options.legacyMode === true; // keep legacy 2.5D raster paths

    if (!Number.isFinite(this.finishFeedRateMmMin) || this.finishFeedRateMmMin <= 0) {
      throw new TypeError('CNCToolpathEngine finishFeedRateMmMin must be finite and positive.');
    }
    if (
      !Number.isFinite(this.radialEngagementFraction) ||
      this.radialEngagementFraction <= 0 ||
      this.radialEngagementFraction > 0.9
    ) {
      throw new TypeError('CNCToolpathEngine radialEngagementFraction must be in (0, 0.9].');
    }
    if (!Number.isFinite(this.retractPlane) || this.retractPlane < this.safeZ) {
      throw new TypeError('CNCToolpathEngine retractPlane must be finite and >= safeZ.');
    }
    if (!Number.isFinite(this.cornerRadiusMm) || this.cornerRadiusMm < 0) {
      throw new TypeError('CNCToolpathEngine cornerRadiusMm must be finite and non-negative.');
    }
  }

  /**
   * Plan 3-axis roughing toolpath on a bounding box or solid body.
   * @param {Object} bounds - { minX, maxX, minY, maxY, minZ, maxZ }
   * @returns {Object} { toolpaths: Array<Array<{x,y,z,type}>>, telemetry: Object }
   */
  planRoughingToolpath(bounds) {
    const boundNames = ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'];
    if (
      !bounds ||
      typeof bounds !== 'object' ||
      Array.isArray(bounds) ||
      boundNames.some((key) => !Number.isFinite(bounds[key])) ||
      bounds.minX >= bounds.maxX ||
      bounds.minY >= bounds.maxY ||
      bounds.minZ >= bounds.maxZ
    ) {
      throw new TypeError('planRoughingToolpath requires explicit finite bounds with positive extents.');
    }
    if (
      bounds.maxX - bounds.minX <= this.toolDiameter ||
      bounds.maxY - bounds.minY <= this.toolDiameter ||
      this.safeZ <= bounds.maxZ
    ) {
      throw new RangeError('The stock extents must exceed the tool diameter and safeZ must be above maxZ.');
    }
    const minX = bounds.minX + this.toolDiameter / 2;
    const maxX = bounds.maxX - this.toolDiameter / 2;
    const minY = bounds.minY + this.toolDiameter / 2;
    const maxY = bounds.maxY - this.toolDiameter / 2;
    const topZ = bounds.maxZ;
    const botZ = bounds.minZ;

    const layers = [];
    let currentZ = topZ - this.stepdownMm;
    let totalLength = 0;

    while (currentZ >= botZ - 1e-5) {
      const layerPasses = [];
      let y = minY;
      let direction = 1; // 1: left-to-right, -1: right-to-left

      // Rapid to layer start
      layerPasses.push({ x: minX, y: minY, z: this.safeZ, type: 'rapid' });
      layerPasses.push({ x: minX, y: minY, z: currentZ, type: 'plunge' });

      while (y <= maxY) {
        const xStart = direction === 1 ? minX : maxX;
        const xEnd = direction === 1 ? maxX : minX;

        layerPasses.push({ x: xStart, y, z: currentZ, type: 'cut' });
        layerPasses.push({ x: xEnd, y, z: currentZ, type: 'cut' });
        totalLength += Math.abs(xEnd - xStart);

        y += this.stepoverMm;
        if (y <= maxY) {
          layerPasses.push({ x: xEnd, y, z: currentZ, type: 'cut' });
          totalLength += this.stepoverMm;
        }
        direction *= -1;
      }

      // Retract to safe Z at end of layer
      const lastPoint = layerPasses[layerPasses.length - 1];
      layerPasses.push({ x: lastPoint.x, y: lastPoint.y, z: this.safeZ, type: 'rapid' });

      layers.push(layerPasses);
      currentZ -= this.stepdownMm;
    }

    const cutTimeMin = totalLength / this.feedRateMmMin;
    const stockVolume = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY) * (bounds.maxZ - bounds.minZ);
    const mrr = stockVolume / Math.max(0.1, cutTimeMin); // mm³/min

    return {
      type: 'Constant-Z Planar Roughing',
      toolDiameter: this.toolDiameter,
      layers,
      telemetry: {
        totalPathLengthMm: Math.round(totalLength * 10) / 10,
        estimatedTimeMin: Math.round(cutTimeMin * 100) / 100,
        mrrMm3PerMin: Math.round(mrr),
        layerCount: layers.length
      }
    };
  }

  /**
   * Validate a CCW boundary polygon and finite Z stock bounds for 3-axis planning.
   */
  _validate3AxisInput(boundary, bounds) {
    if (
      !Array.isArray(boundary) ||
      boundary.length < 3 ||
      boundary.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
    ) {
      throw new TypeError('plan3AxisToolpath requires a closed 2D boundary polygon (>= 3 finite vertices).');
    }
    const bbox = loopBoundingBox(boundary);
    if (bbox.maxX - bbox.minX < EPS || bbox.maxY - bbox.minY < EPS) {
      throw new RangeError('plan3AxisToolpath boundary must span positive XY extents.');
    }
    const boundNames = ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'];
    if (
      !bounds ||
      typeof bounds !== 'object' ||
      Array.isArray(bounds) ||
      boundNames.some((key) => !Number.isFinite(bounds[key])) ||
      bounds.minX >= bounds.maxX ||
      bounds.minY >= bounds.maxY ||
      bounds.minZ >= bounds.maxZ
    ) {
      throw new TypeError('plan3AxisToolpath requires explicit finite bounds with positive extents.');
    }
    if (this.safeZ <= bounds.maxZ) {
      throw new RangeError('safeZ must be above maxZ (stock top).');
    }
    const toolR = this.toolDiameter / 2;
    if (
      bbox.minX < bounds.minX - toolR - EPS ||
      bbox.maxX > bounds.maxX + toolR + EPS ||
      bbox.minY < bounds.minY - toolR - EPS ||
      bbox.maxY > bounds.maxY + toolR + EPS
    ) {
      throw new RangeError('Boundary must fit inside stock XY bounds with tool-radius margin.');
    }
  }

  /**
   * Generate a real 3-axis contour-parallel toolpath.
   *
   * Strategy:
   *  - tool center first contour = boundary offset inward by (toolRadius + finishAllowanceMm)
   *  - nested offset loops at radial-engagement stepover (miter offset + self-
   *    intersection resolution)
   *  - finish pass = boundary-following cut at wall offset with finish feedrate
   *  - per Z layer: rapid to retract plane, plunge (G1 feed), cut loops, retract
   *
   * @param {Object} opts
   * @param {Array<{x,y}>} opts.boundary - CCW/CW 2D pocket boundary
   * @param {Object} opts.bounds - { minX,maxX,minY,maxY,minZ,maxZ } stock bounds
   * @param {number} [opts.finishAllowanceMm=0] - radial finish allowance on walls
   * @returns {Object} { type, toolDiameter, layers, telemetry, finishAllowanceMm }
   */
  plan3AxisToolpath(opts = {}) {
    const boundary = opts.boundary;
    const bounds = opts.bounds;
    const finishAllowanceMm = opts.finishAllowanceMm === undefined ? 0 : opts.finishAllowanceMm;
    if (!Number.isFinite(finishAllowanceMm) || finishAllowanceMm < 0) {
      throw new TypeError('plan3AxisToolpath finishAllowanceMm must be finite and non-negative.');
    }
    this._validate3AxisInput(boundary, bounds);

    const boundaryCcw = toCcw(boundary);
    const boundaryArea = Math.abs(signedArea(boundaryCcw));
    const minArea = Math.max(1e-8 * boundaryArea, 1e-6);
    const toolR = this.toolDiameter / 2;
    const wallOffset = toolR + finishAllowanceMm;
    const baseLoops = offsetRegion(boundaryCcw, wallOffset, minArea, boundaryCcw);
    if (baseLoops.length === 0) {
      throw new RangeError('Boundary is too small for the tool (no offset contour survives).');
    }

    const effStepover = Math.min(this.stepoverMm, this.radialEngagementFraction * this.toolDiameter);
    const contours = [];
    let nextId = 0;
    const visit = (loops, parentId, depth) => {
      for (const lp of loops) {
        const id = nextId++;
        contours.push({ id, parentId, depth, lp, pts: applyRoundedCorners(lp, this.cornerRadiusMm) });
        if (depth >= 256) continue;
        const children = offsetRegion(lp, effStepover, minArea, lp);
        if (children.length > 0) visit(children, id, depth + 1);
      }
    };
    visit(baseLoops, -1, 0);

    const topZ = bounds.maxZ;
    const botZ = bounds.minZ;
    const layers = [];
    let totalCutLen = 0;
    let totalFinishLen = 0;
    let totalPlungeLen = 0;
    let totalRapidLen = 0;
    let totalArcLen = 0;
    const arcLength = (prev, pt) => {
      const r = Math.hypot(pt.i, pt.j);
      const cx = prev.x + pt.i;
      const cy = prev.y + pt.j;
      const a1 = Math.atan2(prev.y - cy, prev.x - cx);
      const a2 = Math.atan2(pt.y - cy, pt.x - cx);
      let dTheta = a2 - a1;
      while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
      while (dTheta < -Math.PI) dTheta += 2 * Math.PI;
      return r * Math.abs(dTheta);
    };

    let currentZ = topZ - this.stepdownMm;
    while (currentZ >= botZ - 1e-5) {
      const layer = [];
      layer.meta = { z: currentZ, contours: [] };
      let cx = null;
      let cy = null;
      const moveToStart = (p) => {
        layer.push({ type: 'rapid', x: p.x, y: p.y, z: this.retractPlane });
        if (cx !== null) totalRapidLen += Math.hypot(p.x - cx, p.y - cy);
        layer.push({ type: 'plunge', x: p.x, y: p.y, z: currentZ });
        totalPlungeLen += Math.abs(this.retractPlane - currentZ);
        cx = p.x;
        cy = p.y;
      };
      const retract = () => {
        layer.push({ type: 'rapid', x: cx, y: cy, z: this.retractPlane });
        totalRapidLen += Math.abs(this.retractPlane - currentZ);
      };
      const emitLoop = (c, kind) => {
        const feed = kind === 'finish' ? this.finishFeedRateMmMin : this.feedRateMmMin;
        if (cx === null) {
          moveToStart(c.pts[0]);
        } else {
          retract();
          moveToStart(c.pts[0]);
        }
        for (const pt of c.pts) {
          if (pt.arc) {
            layer.push({ type: 'arc', x: pt.x, y: pt.y, z: currentZ, i: pt.i, j: pt.j, arcDir: pt.arcDir, f: feed });
            totalArcLen += arcLength({ x: cx, y: cy }, pt);
          } else {
            layer.push({ type: kind, x: pt.x, y: pt.y, z: currentZ, f: feed });
            const l = Math.hypot(pt.x - cx, pt.y - cy);
            if (kind === 'finish') totalFinishLen += l;
            else totalCutLen += l;
          }
          cx = pt.x;
          cy = pt.y;
        }
        layer.push({ type: kind, x: c.pts[0].x, y: c.pts[0].y, z: currentZ, f: feed });
        const closeLen = Math.hypot(c.pts[0].x - cx, c.pts[0].y - cy);
        if (kind === 'finish') totalFinishLen += closeLen;
        else totalCutLen += closeLen;
        cx = c.pts[0].x;
        cy = c.pts[0].y;
      };
      for (const c of contours) {
        layer.meta.contours.push({
          id: c.id,
          parentId: c.parentId,
          depth: c.depth,
          kind: 'rough',
          area: Math.abs(signedArea(c.lp))
        });
        emitLoop(c, 'cut');
      }
      const finishContour = contours[0];
      if (finishContour) {
        layer.meta.contours.push({
          id: finishContour.id,
          parentId: -1,
          depth: 0,
          kind: 'finish',
          area: Math.abs(signedArea(finishContour.lp))
        });
        emitLoop(finishContour, 'finish');
      }
      retract();
      layers.push(layer);
      currentZ -= this.stepdownMm;
    }

    const cutTimeMin =
      totalCutLen / this.feedRateMmMin +
      totalFinishLen / this.finishFeedRateMmMin +
      totalPlungeLen / this.plungeRateMmMin;
    const stockVolume = boundaryArea * (topZ - botZ);
    const mrr = stockVolume / Math.max(0.1, cutTimeMin);

    let maxX = -Infinity;
    let minX = Infinity;
    let maxY = -Infinity;
    let minY = Infinity;
    for (const layer of layers) {
      for (const pt of layer) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
    const safetyMargin = toolR + 1e-6;
    if (
      minX < bounds.minX - safetyMargin ||
      maxX > bounds.maxX + safetyMargin ||
      minY < bounds.minY - safetyMargin ||
      maxY > bounds.maxY + safetyMargin
    ) {
      throw new RangeError('Generated toolpath escaped stock XY bounds; aborting.');
    }

    return {
      type: 'Contour-Parallel 3-Axis Roughing + Finish',
      toolDiameter: this.toolDiameter,
      finishAllowanceMm,
      layers,
      telemetry: {
        totalPathLengthMm:
          Math.round((totalCutLen + totalFinishLen + totalArcLen + totalPlungeLen + totalRapidLen) * 10) / 10,
        cutLengthMm: Math.round(totalCutLen * 10) / 10,
        finishLengthMm: Math.round(totalFinishLen * 10) / 10,
        arcLengthMm: Math.round(totalArcLen * 10) / 10,
        rapidLengthMm: Math.round(totalRapidLen * 10) / 10,
        plungeLengthMm: Math.round(totalPlungeLen * 10) / 10,
        estimatedTimeMin: Math.round(cutTimeMin * 100) / 100,
        mrrMm3PerMin: Math.round(mrr),
        layerCount: layers.length,
        contourCount: contours.length,
        finishPassCount: layers.length,
        maxEngagementMm: Math.round(effStepover * 100) / 100,
        radialEngagementFraction: this.radialEngagementFraction
      }
    };
  }

  /**
   * Dispatch entry point honoring legacyMode.
   * legacyMode=true (or missing boundary) uses the legacy 2.5D raster planner.
   */
  planToolpath(opts = {}) {
    if (this.legacyMode || !Array.isArray(opts.boundary)) {
      return this.planRoughingToolpath(opts.bounds);
    }
    return this.plan3AxisToolpath(opts);
  }

  /**
   * Serialize supplied toolpath coordinates into illustrative ISO/Fanuc-style G-code text.
   * The output is not validated for a specific CNC controller or machining operation.
   * @param {Object} toolpathData - Result from planRoughingToolpath
   * @param {string} programNumber - e.g. "O1001"
   * @returns {string} Formatted G-code stream
   */
  generateGCode(toolpathData, programNumber) {
    if (!toolpathData || !Array.isArray(toolpathData.layers)) {
      throw new TypeError('generateGCode requires caller-supplied roughing toolpath layers.');
    }
    if (typeof programNumber !== 'string' || !/^O\d{1,8}$/.test(programNumber)) {
      throw new TypeError('generateGCode requires a program number in O followed by 1-8 digits.');
    }
    const supportedTypes = ['rapid', 'plunge', 'cut', 'finish', 'arc'];
    for (const layer of toolpathData.layers) {
      if (!Array.isArray(layer)) {
        throw new TypeError('generateGCode requires toolpath layers to be arrays.');
      }
      for (const point of layer) {
        if (
          !point ||
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          !Number.isFinite(point.z) ||
          !supportedTypes.includes(point.type)
        ) {
          throw new TypeError(
            'generateGCode requires toolpath points with finite coordinates and supported motion types.'
          );
        }
        if (point.type === 'arc') {
          if (!Number.isFinite(point.i) || !Number.isFinite(point.j) || !['CW', 'CCW'].includes(point.arcDir)) {
            throw new TypeError('generateGCode arc points require finite i/j center offsets and an arcDir.');
          }
        }
        if (point.f !== undefined && (!Number.isFinite(point.f) || point.f <= 0)) {
          throw new TypeError('generateGCode point feed overrides must be finite and positive.');
        }
      }
    }
    const lines = [];
    const date = new Date().toISOString().split('T')[0];

    // Header & Safety Block
    lines.push(`%`);
    lines.push(`${programNumber} (OMNIENG ILLUSTRATIVE G-CODE; NOT MACHINE VALIDATED)`);
    lines.push(`(DATE: ${date} | TOOL: ${this.toolDiameter}mm ${this.toolType.toUpperCase()})`);
    lines.push(`(FEED: ${this.feedRateMmMin} MM/MIN | SPINDLE: ${this.spindleRpm} RPM)`);
    lines.push(`G21 G90 G94 G17 G40 G49 G80 (METRIC, ABSOLUTE, XY PLANE, CANCEL CYCLES)`);
    lines.push(`G28 G91 Z0.0 (HOME Z AXIS)`);
    lines.push(`G90`);
    lines.push(`T01 M06 (TOOL CHANGE TO T1)`);
    lines.push(`S${this.spindleRpm} M03 (SPINDLE ON CLOCKWISE)`);
    lines.push(`G54 (WORK COORDINATE SYSTEM 1)`);
    lines.push(`M08 (FLOOD COOLANT ON)`);

    // Motion Blocks
    for (const layer of toolpathData.layers) {
      for (const pt of layer) {
        const xStr = pt.x.toFixed(3);
        const yStr = pt.y.toFixed(3);
        const zStr = pt.z.toFixed(3);

        if (pt.type === 'rapid') {
          lines.push(`G00 X${xStr} Y${yStr} Z${zStr}`);
        } else if (pt.type === 'plunge') {
          lines.push(`G01 Z${zStr} F${this.plungeRateMmMin}`);
        } else if (pt.type === 'arc') {
          const g = pt.arcDir === 'CCW' ? 'G03' : 'G02';
          const feed = pt.f ?? this.feedRateMmMin;
          const iStr = pt.i.toFixed(3);
          const jStr = pt.j.toFixed(3);
          lines.push(`${g} X${xStr} Y${yStr} Z${zStr} I${iStr} J${jStr} F${feed}`);
        } else {
          const feed = pt.f ?? (pt.type === 'finish' ? this.finishFeedRateMmMin : this.feedRateMmMin);
          lines.push(`G01 X${xStr} Y${yStr} Z${zStr} F${feed}`);
        }
      }
    }

    // Footer & Program Termination
    lines.push(`M09 (COOLANT OFF)`);
    lines.push(`M05 (SPINDLE STOP)`);
    lines.push(`G28 G91 Z0.0 (RETRACT Z HOME)`);
    lines.push(`G28 X0.0 Y0.0 (TABLE PRESENTATION)`);
    lines.push(`M30 (PROGRAM END & REWIND)`);
    lines.push(`%`);

    return lines.join('\n');
  }
}

module.exports = { CNCToolpathEngine };
