/**
 * OmniEng experimental node-and-wire visual canvas helper
 * 
 * Supports block and port descriptors, midpoint-based orthogonal wire paths,
 * and SVG rendering. It does not simulate signals, detect algebraic loops,
 * route around obstacles, or calculate cycle-safe paths.
 * 
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

class CanvasBlockNode {
  constructor(id, type, x, y, width = 120, height = 70) {
    this.id = id;
    this.type = type; // 'Gain', 'Integrator', 'Sum', 'TransferFcn', 'Scope', 'Source'
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.inputs = [];  // Array of port IDs
    this.outputs = []; // Array of port IDs
    this.parameters = {};
    this.probedSignalValue = null;
  }

  addInputPort(name) {
    const port = { id: `${this.id}_in_${this.inputs.length}`, name, type: 'input' };
    this.inputs.push(port);
    return port;
  }

  addOutputPort(name) {
    const port = { id: `${this.id}_out_${this.outputs.length}`, name, type: 'output' };
    this.outputs.push(port);
    return port;
  }

  getPortPosition(portId) {
    const inIdx = this.inputs.findIndex(p => p.id === portId);
    if (inIdx >= 0) {
      return {
        x: this.x,
        y: this.y + (inIdx + 1) * (this.height / (this.inputs.length + 1))
      };
    }
    const outIdx = this.outputs.findIndex(p => p.id === portId);
    if (outIdx >= 0) {
      return {
        x: this.x + this.width,
        y: this.y + (outIdx + 1) * (this.height / (this.outputs.length + 1))
      };
    }
    return { x: this.x, y: this.y };
  }
}

class CanvasWireRoute {
  constructor(fromPort, toPort) {
    this.fromPort = fromPort;
    this.toPort = toPort;
    this.points = []; // Array of { x, y } waypoints for orthogonal routing
    this.signalValue = null;
  }
}

class InteractiveBlockCanvasEngine {
  constructor() {
    this.blocks = new Map();
    this.wires = [];
    this.selectedBlock = null;
    this.activeProbe = null;
  }

  createBlock(id, type, x, y) {
    const block = new CanvasBlockNode(id, type, x, y);
    this.blocks.set(id, block);
    return block;
  }

  connectPorts(fromPortId, toPortId) {
    const wire = new CanvasWireRoute(fromPortId, toPortId);
    this.wires.push(wire);
    this.computeOrthogonalRouting(wire);
    return wire;
  }

  /**
   * Computes clean Manhattan orthogonal path [p0, p1, p2, p3] between ports
   * @param {CanvasWireRoute} wire
   */
  computeOrthogonalRouting(wire) {
    let pStart = { x: 0, y: 0 };
    let pEnd = { x: 100, y: 100 };

    for (const b of this.blocks.values()) {
      if (b.outputs.some(p => p.id === wire.fromPort)) pStart = b.getPortPosition(wire.fromPort);
      if (b.inputs.some(p => p.id === wire.toPort)) pEnd = b.getPortPosition(wire.toPort);
    }

    const midX = (pStart.x + pEnd.x) / 2.0;
    wire.points = [
      { x: pStart.x, y: pStart.y },
      { x: midX, y: pStart.y },
      { x: midX, y: pEnd.y },
      { x: pEnd.x, y: pEnd.y }
    ];
  }

  /**
   * Generates clean SVG markup representation of the current block diagram
   * @returns {string} SVG xml
   */
  renderToSVG(width = 800, height = 600) {
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:#121820; font-family:sans-serif;">\n`;

    // 1. Grid lines
    svg += `  <defs>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1f2937" stroke-width="0.8"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#grid)" />\n`;

    // 2. Draw wires
    for (const wire of this.wires) {
      if (wire.points.length >= 2) {
        let pathD = `M ${wire.points[0].x} ${wire.points[0].y}`;
        for (let i = 1; i < wire.points.length; i++) {
          pathD += ` L ${wire.points[i].x} ${wire.points[i].y}`;
        }
        svg += `  <path d="${pathD}" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round"/>\n`;
      }
    }

    // 3. Draw blocks
    for (const b of this.blocks.values()) {
      svg += `  <g transform="translate(${b.x}, ${b.y})">
    <rect width="${b.width}" height="${b.height}" rx="6" fill="#1e293b" stroke="#3b82f6" stroke-width="1.8"/>
    <text x="${b.width / 2}" y="${b.height / 2 - 2}" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${b.id}</text>
    <text x="${b.width / 2}" y="${b.height / 2 + 14}" fill="#94a3b8" font-size="10" text-anchor="middle" dominant-baseline="middle">${b.type}</text>
  </g>\n`;
    }

    svg += `</svg>`;
    return svg;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CanvasBlockNode,
    CanvasWireRoute,
    InteractiveBlockCanvasEngine
  };
}
if (typeof window !== 'undefined') {
  window.CanvasBlockNode = CanvasBlockNode;
  window.CanvasWireRoute = CanvasWireRoute;
  window.InteractiveBlockCanvasEngine = InteractiveBlockCanvasEngine;
}
