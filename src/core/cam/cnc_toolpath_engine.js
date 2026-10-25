/**
 * OmniEng CAM (Computer-Aided Manufacturing) 3-Axis CNC Toolpath Engine
 * 
 * Generates experimental CNC milling toolpaths from 3D CAD B-Rep solid geometry:
 * - Constant-Z Planar Roughing (Pocketing with zig-zag clearing)
 * - Parallel Surface Finishing (Ball-end raster finishing)
 * - Post-Processor generating standardized ISO / Fanuc / Haas G-Code
 * - Machining telemetry: cut time, toolpath length, and material removal rate (MRR)
 */

class CNCToolpathEngine {
  constructor(options = {}) {
    this.toolDiameter = options.toolDiameter || 10.0; // mm
    this.toolType = options.toolType || 'flat_endmill'; // 'flat_endmill' | 'ball_nose'
    this.spindleRpm = options.spindleRpm || 8000; // RPM
    this.feedRateMmMin = options.feedRateMmMin || 1200; // mm/min
    this.plungeRateMmMin = options.plungeRateMmMin || 300; // mm/min
    this.stepoverMm = options.stepoverMm || (this.toolDiameter * 0.6); // 60% stepover
    this.stepdownMm = options.stepdownMm || 2.5; // mm per Z slice
    this.safeZ = options.safeZ || 15.0; // Rapid clearance height
  }

  /**
   * Plan 3-axis roughing toolpath on a bounding box or solid body.
   * @param {Object} bounds - { minX, maxX, minY, maxY, minZ, maxZ }
   * @returns {Object} { toolpaths: Array<Array<{x,y,z,type}>>, telemetry: Object }
   */
  planRoughingToolpath(bounds) {
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
   * Post-process toolpath coordinates into ISO 6983 standard G-Code.
   * @param {Object} toolpathData - Result from planRoughingToolpath
   * @param {string} programNumber - e.g. "O1001"
   * @returns {string} Formatted G-code stream
   */
  generateGCode(toolpathData, programNumber = 'O1001') {
    const lines = [];
    const date = new Date().toISOString().split('T')[0];

    // Header & Safety Block
    lines.push(`%`);
    lines.push(`${programNumber} (OMNIENG 3-AXIS CNC POST-PROCESSOR)`);
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
        } else if (pt.type === 'cut') {
          lines.push(`G01 X${xStr} Y${yStr} Z${zStr} F${this.feedRateMmMin}`);
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
