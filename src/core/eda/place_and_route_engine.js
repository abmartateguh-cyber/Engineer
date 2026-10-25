/**
 * Experimental placement and two-pin Manhattan routing for caller-supplied cells and nets.
 * It does not check overlap, timing, foundry rules, or commercial place-and-route conformance.
 */

class PlaceAndRouteEngine {
  constructor(options = {}) {
    const requiredDimensions = ['coreWidth', 'coreHeight', 'stdCellHeight'];
    if (
      !options ||
      requiredDimensions.some((key) => !Number.isFinite(options[key]) || options[key] <= 0) ||
      options.coreWidth <= 20 ||
      options.stdCellHeight > options.coreHeight
    ) {
      throw new TypeError('Explicit positive coreWidth, coreHeight, and stdCellHeight values are required.');
    }
    this.coreWidth = options.coreWidth; // microns
    this.coreHeight = options.coreHeight; // microns
    this.gridPitch = options.gridPitch; // retained as caller metadata; unused by this placement estimate
    this.stdCellHeight = options.stdCellHeight; // microns
  }

  /**
   * Run analytical placement and detailed routing on a netlist of cells and nets.
   * @param {Object} circuitData - { cells: [{id, width, height}], nets: [{name, pins: [cellId]}] }
   * @returns {Object} Placement coordinates, routing segments, and routing telemetry
   */
  runPlaceAndRoute(circuitData) {
    if (
      !circuitData ||
      !Array.isArray(circuitData.cells) ||
      circuitData.cells.length === 0 ||
      !Array.isArray(circuitData.nets)
    ) {
      return {
        success: false,
        status: 'unavailable',
        validationLevel: 'experimental',
        error: {
          code: 'INVALID_INPUT',
          message: 'Explicit cell and net arrays are required for this experimental estimate.'
        }
      };
    }
    const cells = circuitData.cells;
    const nets = circuitData.nets;

    // 1. Analytical Global Placement along rows
    const rowHeight = this.stdCellHeight;
    const numRows = Math.floor(this.coreHeight / rowHeight);
    const placements = {};

    let currentRow = 1;
    let currentX = 10.0;

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (currentX + cell.width > this.coreWidth - 10.0) {
        currentRow = (currentRow + 1) % numRows;
        currentX = 10.0;
      }
      const y = currentRow * rowHeight;
      placements[cell.id] = {
        cellId: cell.id,
        x: Math.round(currentX * 10) / 10,
        y: Math.round(y * 10) / 10,
        width: cell.width,
        height: cell.height
      };
      currentX += cell.width + 6.0; // Spacing
    }

    // 2. Multi-Layer Detailed Routing
    let totalWirelength = 0.0;
    let totalVias = 0;
    const routes = [];

    for (const net of nets) {
      if (net.pins.length < 2) continue;
      const p1 = placements[net.pins[0]];
      const p2 = placements[net.pins[1]];
      if (!p1 || !p2) continue;

      // Pin connection points (cell center)
      const x1 = p1.x + p1.width / 2;
      const y1 = p1.y + p1.height / 2;
      const x2 = p2.x + p2.width / 2;
      const y2 = p2.y + p2.height / 2;

      // Manhattan L-shaped routing (Metal 1 horizontal, Metal 2 vertical via transition)
      const intermediateX = x2;
      const intermediateY = y1;

      // Segment 1: M1 Horizontal (x1, y1) -> (intermediateX, intermediateY)
      const seg1Len = Math.abs(intermediateX - x1);
      // Segment 2: M2 Vertical (intermediateX, intermediateY) -> (x2, y2)
      const seg2Len = Math.abs(y2 - intermediateY);

      const netLength = seg1Len + seg2Len;
      totalWirelength += netLength;
      totalVias += 1; // Via connecting M1 and M2 at turn

      routes.push({
        net: net.name,
        segments: [
          { layer: 'M1', x1, y1, x2: intermediateX, y2: intermediateY, length: seg1Len },
          { layer: 'M2', x1: intermediateX, y1: intermediateY, x2, y2, length: seg2Len }
        ],
        via: { layer: 'V1', x: intermediateX, y: intermediateY },
        lengthMicrons: Math.round(netLength * 10) / 10
      });
    }

    const totalCellArea = cells.reduce((sum, c) => sum + c.width * c.height, 0);
    const coreArea = this.coreWidth * this.coreHeight;
    const coreUtilization = (totalCellArea / coreArea) * 100.0;

    return {
      status: 'EXPERIMENTAL_LAYOUT_ESTIMATE',
      validationLevel: 'experimental',
      designRuleCheck: 'not-run',
      coreWidth: this.coreWidth,
      coreHeight: this.coreHeight,
      cellsPlacedCount: cells.length,
      netsRoutedCount: routes.length,
      placements,
      routes,
      telemetry: {
        totalHpwlMicrons: Math.round(totalWirelength * 10) / 10,
        totalViaCount: totalVias,
        coreUtilizationPercent: Math.round(coreUtilization * 100) / 100
      }
    };
  }
}

module.exports = { PlaceAndRouteEngine };
