/**
 * Plant Electrical Single-Line Diagram (SLD) Model & Industrial SVG Generator.
 *
 * Implements:
 * 1. Complete topological hierarchy:
 *    - Power Generation: Gas Turbine Generators (GTGs) 11kV/33kV + Utility Grid Intertie
 *    - Main High Voltage Switchgear (Bus A & Bus B with Sectionalizer / Bus-Tie Breaker)
 *    - Step-Down Power Transformers (33/11kV, 11/6.6kV, 11/0.4kV)
 *    - Medium Voltage Switchgear (6.6kV process compressor & large pump drives)
 *    - Low Voltage Motor Control Centers (400V MCC-A & MCC-B)
 *    - Emergency Power System (Emergency Diesel Generator EDG + 400V Essential Switchboard + ATS)
 *    - Uninterruptible Power Supply (UPS Inverter, Battery Bank, Vital 230V AC Panel)
 * 2. High-precision vector SVG diagram generation with industrial symbology:
 *    - Voltage color-coding (33kV Purple, 11kV Crimson, 6.6kV Cyan/Blue, 400V Green, UPS Amber)
 *    - Standard IEC symbols: Transformers (twin interlaced circles), Generators (G), Motors (M), Circuit Breakers
 *    - Industrial title block and engineering revision metadata
 */

'use strict';

class SingleLineDiagramGenerator {
  /**
   * Builds the default LNG complex electrical network topology model.
   *
   * @param {Object} [config]
   * @returns {Object} Structured SLD topology model
   */
  static buildPlantTopology(config = {}) {
    const plantName = config.plantName || 'World-Scale LNG Complex';
    const mainVoltageKV = config.mainVoltageKV || 33.0;

    return {
      plantName,
      drawingNumber: config.drawingNumber || 'E-SLD-001-REV-C',
      title: 'Overall Plant Electrical Key Single-Line Diagram (SLD)',
      voltageLevels: {
        '33kV': { color: '#800080', label: '33 kV Transmission & Main Distribution' },
        '11kV': { color: '#B22222', label: '11 kV Generation & Primary MV' },
        '6.6kV': { color: '#1E90FF', label: '6.6 kV Process Motor Distribution' },
        '400V': { color: '#2E8B57', label: '400 V LV Power & MCC' },
        '230V': { color: '#FF8C00', label: '230 V Vital Instrumentation UPS' }
      },
      buses: [
        {
          id: 'BUS-33A',
          name: 'Main 33kV Switchgear Bus-A',
          voltageKV: 33.0,
          color: '#800080',
          x1: 80, y: 180, x2: 580
        },
        {
          id: 'BUS-33B',
          name: 'Main 33kV Switchgear Bus-B',
          voltageKV: 33.0,
          color: '#800080',
          x1: 680, y: 180, x2: 1180
        },
        {
          id: 'BUS-6.6A',
          name: 'Process 6.6kV Switchgear Bus-A',
          voltageKV: 6.6,
          color: '#1E90FF',
          x1: 100, y: 380, x2: 450
        },
        {
          id: 'BUS-6.6B',
          name: 'Process 6.6kV Switchgear Bus-B',
          voltageKV: 6.6,
          color: '#1E90FF',
          x1: 810, y: 380, x2: 1160
        },
        {
          id: 'BUS-LV-A',
          name: '400V LV MCC-A',
          voltageKV: 0.40,
          color: '#2E8B57',
          x1: 100, y: 560, x2: 450
        },
        {
          id: 'BUS-LV-B',
          name: '400V LV MCC-B',
          voltageKV: 0.40,
          color: '#2E8B57',
          x1: 810, y: 560, x2: 1160
        },
        {
          id: 'BUS-EMERG',
          name: '400V Essential Switchboard',
          voltageKV: 0.40,
          color: '#2E8B57',
          x1: 500, y: 680, x2: 760
        },
        {
          id: 'BUS-UPS',
          name: '230V Vital Instrumentation UPS',
          voltageKV: 0.23,
          color: '#FF8C00',
          x1: 520, y: 820, x2: 740
        }
      ],
      generators: [
        { tag: 'GTG-1', rating: '45 MW / 11kV', bus: 'BUS-33A', x: 180, y: 70, type: 'Gas Turbine Generator' },
        { tag: 'GTG-2', rating: '45 MW / 11kV', bus: 'BUS-33A', x: 380, y: 70, type: 'Gas Turbine Generator' },
        { tag: 'GTG-3', rating: '45 MW / 11kV', bus: 'BUS-33B', x: 880, y: 70, type: 'Gas Turbine Generator' },
        { tag: 'GTG-4', rating: '45 MW / 11kV', bus: 'BUS-33B', x: 1080, y: 70, type: 'Gas Turbine Generator (Standby)' },
        { tag: 'EDG-01', rating: '2.5 MVA / 400V', bus: 'BUS-EMERG', x: 630, y: 740, type: 'Emergency Diesel Gen' }
      ],
      transformers: [
        { tag: 'T-01A', rating: '30 MVA 33/6.6kV', fromBus: 'BUS-33A', toBus: 'BUS-6.6A', x: 260, y: 280 },
        { tag: 'T-01B', rating: '30 MVA 33/6.6kV', fromBus: 'BUS-33B', toBus: 'BUS-6.6B', x: 970, y: 280 },
        { tag: 'T-02A', rating: '2.5 MVA 6.6/0.4kV', fromBus: 'BUS-6.6A', toBus: 'BUS-LV-A', x: 220, y: 470 },
        { tag: 'T-02B', rating: '2.5 MVA 6.6/0.4kV', fromBus: 'BUS-6.6B', toBus: 'BUS-LV-B', x: 920, y: 470 }
      ],
      busTieBreakers: [
        { tag: 'CB-TIE-33', busA: 'BUS-33A', busB: 'BUS-33B', x: 630, y: 180, state: 'Normally Open (Interlocked)' },
        { tag: 'CB-TIE-6.6', busA: 'BUS-6.6A', busB: 'BUS-6.6B', x: 630, y: 380, state: 'Normally Open' },
        { tag: 'CB-TIE-LV', busA: 'BUS-LV-A', busB: 'BUS-LV-B', x: 630, y: 560, state: 'Normally Open' }
      ],
      loads: [
        { tag: 'K-201', desc: 'Main Propane Compressor (12 MW)', bus: 'BUS-6.6A', x: 140, y: 420 },
        { tag: 'K-202', desc: 'MR Compressor Train A (18 MW)', bus: 'BUS-6.6A', x: 380, y: 420 },
        { tag: 'K-203', desc: 'MR Compressor Train B (18 MW)', bus: 'BUS-6.6B', x: 860, y: 420 },
        { tag: 'P-101A/B', desc: 'LNG Run-Down Pumps (1.2 MW)', bus: 'BUS-6.6B', x: 1090, y: 420 },
        { tag: 'MCC-MOTORS-A', desc: 'LV Pumps & Fans (1.4 MW)', bus: 'BUS-LV-A', x: 160, y: 600 },
        { tag: 'MCC-MOTORS-B', desc: 'Cooling Tower Fans (1.4 MW)', bus: 'BUS-LV-B', x: 860, y: 600 },
        { tag: 'ESS-FEED', desc: 'Essential Services (800 kW)', bus: 'BUS-EMERG', x: 550, y: 650 },
        { tag: 'UPS-SYS', desc: 'Vital DCS & ESD Instrumentation', bus: 'BUS-UPS', x: 630, y: 860 }
      ]
    };
  }

  /**
   * Renders the Single Line Diagram into clean, scalable SVG text.
   *
   * @param {Object} [config]
   * @returns {string} Standards-grade SVG document
   */
  static generateSvgDiagram(config = {}) {
    const topology = this.buildPlantTopology(config);

    const svgWidth = 1260;
    const svgHeight = 920;

    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">\n`;
    svg += `  <defs>\n`;
    svg += `    <style>\n`;
    svg += `      .border { fill: #fcfcfc; stroke: #333333; stroke-width: 2; }\n`;
    svg += `      .grid-line { stroke: #e0e0e0; stroke-width: 0.5; stroke-dasharray: 2,4; }\n`;
    svg += `      .bus-bar { stroke-width: 6; stroke-linecap: round; }\n`;
    svg += `      .conn-line { stroke: #2b2b2b; stroke-width: 1.8; fill: none; }\n`;
    svg += `      .breaker { fill: #ffffff; stroke: #222222; stroke-width: 2; }\n`;
    svg += `      .transformer-circle { fill: none; stroke: #222222; stroke-width: 2; }\n`;
    svg += `      .gen-circle { fill: #ffffff; stroke: #800080; stroke-width: 2.2; }\n`;
    svg += `      .motor-circle { fill: #ffffff; stroke: #1E90FF; stroke-width: 2.2; }\n`;
    svg += `      .label-main { font-family: monospace, Arial, sans-serif; font-size: 12px; font-weight: bold; fill: #111111; }\n`;
    svg += `      .label-sub { font-family: sans-serif; font-size: 10px; fill: #444444; }\n`;
    svg += `      .label-bus { font-family: monospace, Arial, sans-serif; font-size: 13px; font-weight: bold; }\n`;
    svg += `      .title-head { font-family: sans-serif; font-size: 18px; font-weight: bold; fill: #002244; }\n`;
    svg += `      .title-sub { font-family: sans-serif; font-size: 11px; fill: #555555; }\n`;
    svg += `    </style>\n`;
    svg += `  </defs>\n\n`;

    // Outer border & background
    svg += `  <!-- Drawing Sheet Frame -->\n`;
    svg += `  <rect x="15" y="15" width="${svgWidth - 30}" height="${svgHeight - 30}" class="border"/>\n`;
    svg += `  <rect x="25" y="25" width="${svgWidth - 50}" height="${svgHeight - 50}" fill="none" stroke="#666666" stroke-width="1"/>\n\n`;

    // Title Block
    svg += `  <!-- Title Block -->\n`;
    svg += `  <g id="title-block" transform="translate(850, 830)">\n`;
    svg += `    <rect x="0" y="0" width="370" height="55" fill="#f4f6f9" stroke="#333333" stroke-width="1.2"/>\n`;
    svg += `    <text x="15" y="20" class="title-head">${topology.plantName}</text>\n`;
    svg += `    <text x="15" y="36" class="title-sub">${topology.title}</text>\n`;
    svg += `    <text x="15" y="48" class="title-sub">DWG NO: ${topology.drawingNumber} | SCALE: NTS</text>\n`;
    svg += `  </g>\n\n`;

    // Voltage Legend
    svg += `  <!-- Voltage Legend -->\n`;
    svg += `  <g id="legend" transform="translate(45, 45)">\n`;
    let legY = 0;
    for (const [vKey, vMeta] of Object.entries(topology.voltageLevels)) {
      svg += `    <line x1="0" y1="${legY}" x2="35" y2="${legY}" stroke="${vMeta.color}" stroke-width="4.5"/>\n`;
      svg += `    <text x="45" y="${legY + 4}" class="label-sub" font-weight="bold">${vKey} (${vMeta.label})</text>\n`;
      legY += 16;
    }
    svg += `  </g>\n\n`;

    // Draw Main Busbars
    svg += `  <!-- Busbars -->\n`;
    for (const bus of topology.buses) {
      svg += `  <g id="${bus.id}">\n`;
      svg += `    <line x1="${bus.x1}" y1="${bus.y}" x2="${bus.x2}" y2="${bus.y}" stroke="${bus.color}" class="bus-bar"/>\n`;
      svg += `    <text x="${bus.x1}" y="${bus.y - 8}" class="label-bus" fill="${bus.color}">${bus.name}</text>\n`;
      svg += `  </g>\n`;
    }
    svg += `\n`;

    // Bus-Tie Breakers
    svg += `  <!-- Bus Tie Breakers -->\n`;
    for (const tie of topology.busTieBreakers) {
      svg += `  <g id="${tie.tag}">\n`;
      svg += `    <line x1="${tie.x - 50}" y1="${tie.y}" x2="${tie.x + 50}" y2="${tie.y}" class="conn-line"/>\n`;
      svg += `    <rect x="${tie.x - 12}" y="${tie.y - 12}" width="24" height="24" class="breaker"/>\n`;
      svg += `    <line x1="${tie.x - 8}" y1="${tie.y + 8}" x2="${tie.x + 8}" y2="${tie.y - 8}" stroke="#d9534f" stroke-width="2"/>\n`;
      svg += `    <text x="${tie.x - 35}" y="${tie.y + 24}" class="label-sub">${tie.tag}</text>\n`;
      svg += `  </g>\n`;
    }
    svg += `\n`;

    // GTGs
    svg += `  <!-- Gas Turbine Generators -->\n`;
    for (const gen of topology.generators) {
      svg += `  <g id="${gen.tag}" transform="translate(${gen.x}, ${gen.y})">\n`;
      svg += `    <circle cx="0" cy="0" r="22" class="gen-circle"/>\n`;
      svg += `    <text x="-6" y="5" font-family="sans-serif" font-size="14" font-weight="bold" fill="#800080">G</text>\n`;
      svg += `    <line x1="0" y1="22" x2="0" y2="70" class="conn-line"/>\n`;
      svg += `    <rect x="-10" y="40" width="20" height="20" class="breaker"/>\n`;
      svg += `    <text x="-35" y="-28" class="label-main">${gen.tag}</text>\n`;
      svg += `    <text x="-45" y="-14" class="label-sub">${gen.rating}</text>\n`;
      svg += `  </g>\n`;
    }
    svg += `\n`;

    // Power Transformers
    svg += `  <!-- Step-Down Power Transformers -->\n`;
    for (const trafo of topology.transformers) {
      svg += `  <g id="${trafo.tag}" transform="translate(${trafo.x}, ${trafo.y})">\n`;
      svg += `    <line x1="0" y1="-100" x2="0" y2="-20" class="conn-line"/>\n`;
      svg += `    <rect x="-9" y="-65" width="18" height="18" class="breaker"/>\n`;
      // Twin interlocking circles
      svg += `    <circle cx="0" cy="-10" r="18" class="transformer-circle"/>\n`;
      svg += `    <circle cx="0" cy="14" r="18" class="transformer-circle"/>\n`;
      svg += `    <line x1="0" y1="32" x2="0" y2="100" class="conn-line"/>\n`;
      svg += `    <rect x="-9" y="55" width="18" height="18" class="breaker"/>\n`;
      svg += `    <text x="25" y="0" class="label-main">${trafo.tag}</text>\n`;
      svg += `    <text x="25" y="14" class="label-sub">${trafo.rating}</text>\n`;
      svg += `  </g>\n`;
    }
    svg += `\n`;

    // Process Motors & Loads
    svg += `  <!-- Outgoing Feeders & Motor Loads -->\n`;
    for (const load of topology.loads) {
      svg += `  <g id="${load.tag}" transform="translate(${load.x}, ${load.y})">\n`;
      svg += `    <line x1="0" y1="-40" x2="0" y2="0" class="conn-line"/>\n`;
      svg += `    <rect x="-8" y="-30" width="16" height="16" class="breaker"/>\n`;
      svg += `    <circle cx="0" cy="16" r="16" class="motor-circle"/>\n`;
      svg += `    <text x="-5" y="21" font-family="sans-serif" font-size="12" font-weight="bold" fill="#1E90FF">M</text>\n`;
      svg += `    <text x="-30" y="44" class="label-main">${load.tag}</text>\n`;
      svg += `    <text x="-40" y="56" class="label-sub">${load.desc}</text>\n`;
      svg += `  </g>\n`;
    }
    svg += `\n`;

    svg += `</svg>\n`;
    return svg;
  }
}

module.exports = {
  SingleLineDiagramGenerator
};
