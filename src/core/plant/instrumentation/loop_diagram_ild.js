'use strict';

/**
 * ISA-5.4 Instrument Loop Diagram (ILD) Generator.
 *
 * Implements:
 * 1. Complete ISA-5.4 4-Zone Engineering Topology:
 *    - Zone 1: Field Area (sensor/transmitter, valve actuator, local terminals, cable gland)
 *    - Zone 2: Field Junction Box & Cable Routing (JB terminal strip, multi-pair trunk cable, tray)
 *    - Zone 3: Marshalling Cabinet (incomer terminals, galvanic IS barrier/isolator, cross-wiring)
 *    - Zone 4: System Cabinet / Control Room (DCS/SIS I/O module, slot/channel, 24VDC loop power, controller block)
 * 2. Structured JSON generation for digital-twin / database interoperability
 * 3. High-definition vector SVG engineering schematic generator matching industrial CAD deliverables
 * 4. Factory templates for 4-20mA Analog Input (AI), 4-20mA Analog Output (AO), and Discrete Safety Solenoid (DO)
 */

/**
 * Extract letter code and loop number for ISA-5.4 instrument bubble display.
 * e.g., "10-FT-1001A" -> { letters: 'FT', loopNumber: '1001A' }
 *       "FV-1201"     -> { letters: 'FV', loopNumber: '1201' }
 *       "10-ESDV-101" -> { letters: 'ESDV', loopNumber: '101' }
 */
function extractTagBubbleParts(tag) {
  if (!tag) return { letters: 'FT', loopNumber: '1001' };
  const clean = String(tag).trim().toUpperCase();
  const m = /^(?:[0-9A-Z]+-)?([A-Z]+)-?([0-9]+[A-Z]?)$/.exec(clean);
  if (m) {
    return { letters: m[1], loopNumber: m[2] };
  }
  const parts = clean.split('-');
  if (parts.length >= 3) {
    return { letters: parts[1], loopNumber: parts[2] };
  }
  if (parts.length === 2) {
    return { letters: parts[0], loopNumber: parts[1] };
  }
  return { letters: clean.slice(0, 2) || 'FT', loopNumber: clean.slice(2) || '1001' };
}

class InstrumentLoopDiagram {
  constructor(spec = {}) {
    this.loopTag = spec.loopTag || '10-FL-1001';
    this.primaryTag = spec.primaryTag || '10-FT-1001';
    this.serviceDescription = spec.serviceDescription || 'Feed Gas Flow to Acid Gas Absorber';
    this.projectName = spec.projectName || 'World-Scale LNG Complex';
    this.pandidNumber = spec.pandidNumber || 'PID-10-001';
    this.drawingNumber = spec.drawingNumber || `ILD-${this.loopTag}`;
    this.revision = spec.revision || '0';
    this.date = spec.date || '2026-11-06';
    this.loopType = spec.loopType || 'ANALOG_INPUT_4_20MA'; // 'ANALOG_INPUT_4_20MA', 'ANALOG_OUTPUT_4_20MA', 'DIGITAL_OUTPUT_SIS'
    this.system = spec.system || 'BPCS'; // 'BPCS' or 'SIS'

    // Zone 1: Field Area
    this.field = {
      deviceTag: this.primaryTag,
      deviceType: spec.field?.deviceType || 'Differential Pressure Transmitter',
      manufacturer: spec.field?.manufacturer || 'Yokogawa / Rosemount',
      model: spec.field?.model || 'EJX110A',
      hazardousRating: spec.field?.hazardousRating || 'Ex ia IIC T4 Ga',
      calibrationRange: spec.field?.calibrationRange || '0 - 500 kPa',
      outputSignal: spec.field?.outputSignal || '4-20mA HART',
      powerSupply: spec.field?.powerSupply || '24VDC Loop Powered',
      terminalNumbers: spec.field?.terminalNumbers || ['+', '-', 'SHIELD', 'GND'],
      cableGland: spec.field?.cableGland || 'M20 Ex d/e SS316',
      fieldCable: spec.field?.fieldCable || `${this.primaryTag}-CBL (1x2x1.5 mm2 XLPE/IS/OS/SWA)`
    };

    // Zone 2: Field Junction Box
    this.junctionBox = {
      tag: spec.junctionBox?.tag || '10-JB-01',
      type: spec.junctionBox?.type || 'SS316 IP66 Ex e Enclosure',
      terminalStrip: spec.junctionBox?.terminalStrip || 'TB-1',
      terminals: spec.junctionBox?.terminals || [
        { no: 1, signal: '+', wireColor: 'RD' },
        { no: 2, signal: '-', wireColor: 'BK' },
        { no: 3, signal: 'SHIELD', wireColor: 'GREEN_YELLOW' },
        { no: 4, signal: 'SPARE', wireColor: 'NC' }
      ],
      trunkCableTag: spec.junctionBox?.trunkCableTag || '10-TRK-01',
      trunkCableSpec: spec.junctionBox?.trunkCableSpec || '12-Pair 1.5 mm2 Individual/Overall Screened SWA',
      cableTrayTag: spec.junctionBox?.cableTrayTag || 'CT-10-N-01'
    };

    // Zone 3: Marshalling Cabinet
    this.marshalling = {
      cabinetTag: spec.marshalling?.cabinetTag || `MARSH-10-${this.system}`,
      location: spec.marshalling?.location || 'Auxiliary Instrument Room (AIR-01)',
      incomerStrip: spec.marshalling?.incomerStrip || 'TS-FIELD-01',
      incomerTerminals: spec.marshalling?.incomerTerminals || [
        { no: 101, signal: '+' },
        { no: 102, signal: '-' },
        { no: 103, signal: 'SHIELD' }
      ],
      barrierTag: spec.marshalling?.barrierTag || 'ISO-1001',
      barrierModel: spec.marshalling?.barrierModel || 'MTL 5541 / P&F KFD2-STC4-Ex1 (Galvanic Isolator)',
      barrierRating: spec.marshalling?.barrierRating || '[Ex ia Ga] IIC',
      crossWireTag: spec.marshalling?.crossWireTag || 'X-1001-A/B',
      systemStrip: spec.marshalling?.systemStrip || 'TS-SYS-01',
      systemTerminals: spec.marshalling?.systemTerminals || [
        { no: 201, signal: '+' },
        { no: 202, signal: '-' }
      ]
    };

    // Zone 4: System Cabinet / Control Room
    this.systemCabinet = {
      cabinetTag: spec.systemCabinet?.cabinetTag || `SYS-10-${this.system}`,
      location: spec.systemCabinet?.location || 'Central Control Room (CCR)',
      ioCardModel: spec.systemCabinet?.ioCardModel || 'FC-AI-01 (16-Channel 4-20mA HART)',
      rackNumber: spec.systemCabinet?.rackNumber || 'RACK-01',
      slotNumber: spec.systemCabinet?.slotNumber || 'SLOT-03',
      channelNumber: spec.systemCabinet?.channelNumber || 'CH-05',
      powerDistribution: spec.systemCabinet?.powerDistribution || '24VDC Redundant Feeder (PSU-A/B)',
      fuseRating: spec.systemCabinet?.fuseRating || '0.5A Quick-Blow',
      controllerTag: spec.systemCabinet?.controllerTag || 'FIC-1001',
      controllerBlock: spec.systemCabinet?.controllerBlock || 'PID with Anti-Reset Windup',
      graphicsDisplay: spec.systemCabinet?.graphicsDisplay || 'GRAPH-10-ABSORBER-01'
    };
  }

  /**
   * Return complete digital representation in JSON format.
   */
  toJson() {
    return {
      loopTag: this.loopTag,
      primaryTag: this.primaryTag,
      serviceDescription: this.serviceDescription,
      projectName: this.projectName,
      pandidNumber: this.pandidNumber,
      drawingNumber: this.drawingNumber,
      revision: this.revision,
      date: this.date,
      loopType: this.loopType,
      system: this.system,
      zones: {
        zone1_field: this.field,
        zone2_junctionBox: this.junctionBox,
        zone3_marshalling: this.marshalling,
        zone4_systemCabinet: this.systemCabinet
      }
    };
  }

  /**
   * Render high-definition vector SVG matching industrial ISA-5.4 ILD drawing standards.
   */
  toSvg(options = {}) {
    const width = options.width || 1200;
    const height = options.height || 800;

    // 4 Column Demarcation Boundaries
    const z1x = 40;
    const z1w = 260;

    const z2x = 320;
    const z2w = 230;

    const z3x = 570;
    const z3w = 270;

    const z4x = 860;
    const z4w = 300;

    const headerY = 60;
    const footerY = height - 110;

    const bubbleParts = extractTagBubbleParts(this.primaryTag);
    const barrierFunction = this.loopType === 'ANALOG_OUTPUT_4_20MA'
      ? 'AO Driver'
      : this.loopType === 'DIGITAL_OUTPUT_SIS'
        ? 'SOV Trip Driver'
        : '4-20mA Repeater';
    const pwrHeader = this.system === 'SIS' ? 'SIS 24VDC PWR' : 'DCS 24VDC PWR';
    const signalLabel = this.loopType === 'ANALOG_OUTPUT_4_20MA'
      ? 'Signal Type: 4-20mA HART Analog Output'
      : this.loopType === 'DIGITAL_OUTPUT_SIS'
        ? 'Signal Type: 24VDC Discrete Output (SIS De-energize)'
        : 'Signal Type: 4-20mA HART Direct Input';

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Roboto, 'Segoe UI', Arial, sans-serif">
  <defs>
    <style>
      .border { stroke: #00e5ff; stroke-width: 2; fill: none; }
      .grid-line { stroke: #1e293b; stroke-width: 1; }
      .zone-divider { stroke: #38bdf8; stroke-width: 1.5; stroke-dasharray: 6,4; }
      .zone-title { font-size: 13px; font-weight: bold; fill: #38bdf8; letter-spacing: 1.5px; text-anchor: middle; }
      .box { fill: #0f172a; stroke: #64748b; stroke-width: 1.5; rx: 4; }
      .box-highlight { fill: #1e293b; stroke: #00e5ff; stroke-width: 1.5; rx: 4; }
      .wire-pos { stroke: #ef4444; stroke-width: 2; fill: none; }
      .wire-neg { stroke: #3b82f6; stroke-width: 2; fill: none; }
      .wire-shield { stroke: #10b981; stroke-width: 1.5; stroke-dasharray: 4,3; fill: none; }
      .wire-label { font-size: 10px; font-weight: bold; fill: #cbd5e1; }
      .terminal { fill: #334155; stroke: #94a3b8; stroke-width: 1; }
      .terminal-text { font-size: 10px; font-weight: bold; fill: #f8fafc; text-anchor: middle; dominant-baseline: central; }
      .bubble { fill: #0284c7; stroke: #f8fafc; stroke-width: 2; }
      .bubble-text { font-size: 12px; font-weight: bold; fill: #ffffff; text-anchor: middle; dominant-baseline: central; }
      .text-heading { font-size: 11px; font-weight: bold; fill: #f8fafc; }
      .text-meta { font-size: 10px; fill: #94a3b8; }
      .title-block { fill: #090d16; stroke: #00e5ff; stroke-width: 1.5; }
    </style>
  </defs>

  <!-- Background Canvas -->
  <rect x="0" y="0" width="${width}" height="${height}" fill="#050811" />

  <!-- Outer Drawing Frame -->
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" class="border" />
  <rect x="26" y="26" width="${width - 52}" height="${height - 52}" stroke="#334155" stroke-width="1" fill="none" />

  <!-- Drawing Grid Coordinate References -->
  <text x="35" y="40" font-size="10" fill="#64748b">A</text>
  <text x="35" y="${height / 2}" font-size="10" fill="#64748b">B</text>
  <text x="35" y="${height - 40}" font-size="10" fill="#64748b">C</text>
  <text x="300" y="40" font-size="10" fill="#64748b">1</text>
  <text x="600" y="40" font-size="10" fill="#64748b">2</text>
  <text x="900" y="40" font-size="10" fill="#64748b">3</text>

  <!-- Zone Demarcation Vertical Lines -->
  <line x1="310" y1="50" x2="310" y2="${footerY + 15}" class="zone-divider" />
  <line x1="560" y1="50" x2="560" y2="${footerY + 15}" class="zone-divider" />
  <line x1="850" y1="50" x2="850" y2="${footerY + 15}" class="zone-divider" />

  <!-- Zone Headers -->
  <rect x="${z1x}" y="${headerY - 15}" width="${z1w}" height="26" fill="#0f172a" rx="4" />
  <text x="${z1x + z1w / 2}" y="${headerY + 2}" class="zone-title">ZONE 1: FIELD AREA</text>

  <rect x="${z2x}" y="${headerY - 15}" width="${z2w}" height="26" fill="#0f172a" rx="4" />
  <text x="${z2x + z2w / 2}" y="${headerY + 2}" class="zone-title">ZONE 2: JUNCTION BOX</text>

  <rect x="${z3x}" y="${headerY - 15}" width="${z3w}" height="26" fill="#0f172a" rx="4" />
  <text x="${z3x + z3w / 2}" y="${headerY + 2}" class="zone-title">ZONE 3: MARSHALLING</text>

  <rect x="${z4x}" y="${headerY - 15}" width="${z4w}" height="26" fill="#0f172a" rx="4" />
  <text x="${z4x + z4w / 2}" y="${headerY + 2}" class="zone-title">ZONE 4: SYSTEM CABINET</text>

  <!-- ===================================================================== -->
  <!-- ZONE 1: FIELD AREA ELEMENTS                                          -->
  <!-- ===================================================================== -->
  <g id="zone1_field">
    <!-- Transmitter Enclosure / Bubble -->
    <rect x="${z1x + 10}" y="120" width="${z1w - 20}" height="320" class="box-highlight" />
    <text x="${z1x + 25}" y="145" class="text-heading">${this.field.deviceType}</text>
    <text x="${z1x + 25}" y="162" class="text-meta">Tag: ${this.field.deviceTag}</text>
    <text x="${z1x + 25}" y="177" class="text-meta">Model: ${this.field.manufacturer} ${this.field.model}</text>
    <text x="${z1x + 25}" y="192" class="text-meta">Rating: ${this.field.hazardousRating}</text>
    <text x="${z1x + 25}" y="207" class="text-meta">Range: ${this.field.calibrationRange}</text>

    <!-- Instrument Bubble Circle -->
    <circle cx="${z1x + 75}" cy="275" r="32" class="bubble" />
    <line x1="${z1x + 43}" y1="275" x2="${z1x + 107}" y2="275" stroke="#ffffff" stroke-width="1.5" />
    <text x="${z1x + 75}" y="265" class="bubble-text">${bubbleParts.letters}</text>
    <text x="${z1x + 75}" y="290" class="bubble-text">${bubbleParts.loopNumber}</text>

    <!-- Field Terminals -->
    <rect x="${z1x + 165}" y="235" width="28" height="24" class="terminal" />
    <text x="${z1x + 179}" y="247" class="terminal-text">+</text>

    <rect x="${z1x + 165}" y="280" width="28" height="24" class="terminal" />
    <text x="${z1x + 179}" y="292" class="terminal-text">-</text>

    <rect x="${z1x + 165}" y="325" width="28" height="24" class="terminal" />
    <text x="${z1x + 179}" y="337" class="terminal-text">SH</text>

    <!-- Field Cable Gland & Label -->
    <text x="${z1x + 25}" y="390" class="text-heading">Field Cable Details:</text>
    <text x="${z1x + 25}" y="406" class="text-meta">${this.field.fieldCable}</text>
    <text x="${z1x + 25}" y="420" class="text-meta">Gland: ${this.field.cableGland}</text>
  </g>

  <!-- ===================================================================== -->
  <!-- ZONE 2: FIELD JUNCTION BOX                                            -->
  <!-- ===================================================================== -->
  <g id="zone2_jb">
    <rect x="${z2x + 10}" y="120" width="${z2w - 20}" height="320" class="box" />
    <text x="${z2x + 25}" y="145" class="text-heading">${this.junctionBox.tag}</text>
    <text x="${z2x + 25}" y="162" class="text-meta">Enclosure: ${this.junctionBox.type}</text>
    <text x="${z2x + 25}" y="177" class="text-meta">Terminal Strip: ${this.junctionBox.terminalStrip}</text>

    <!-- JB Terminal Strip -->
    <rect x="${z2x + 85}" y="235" width="35" height="24" class="terminal" />
    <text x="${z2x + 102}" y="247" class="terminal-text">TB-1</text>

    <rect x="${z2x + 85}" y="280" width="35" height="24" class="terminal" />
    <text x="${z2x + 102}" y="292" class="terminal-text">TB-2</text>

    <rect x="${z2x + 85}" y="325" width="35" height="24" class="terminal" />
    <text x="${z2x + 102}" y="337" class="terminal-text">TB-3</text>

    <rect x="${z2x + 85}" y="370" width="35" height="24" class="terminal" fill="#1e293b" />
    <text x="${z2x + 102}" y="382" class="terminal-text">SP</text>

    <text x="${z2x + 25}" y="415" class="text-meta">Trunk: ${this.junctionBox.trunkCableTag}</text>
    <text x="${z2x + 25}" y="428" class="text-meta">Tray: ${this.junctionBox.cableTrayTag}</text>
  </g>

  <!-- ===================================================================== -->
  <!-- ZONE 3: MARSHALLING CABINET                                           -->
  <!-- ===================================================================== -->
  <g id="zone3_marsh">
    <rect x="${z3x + 10}" y="120" width="${z3w - 20}" height="320" class="box" />
    <text x="${z3x + 25}" y="145" class="text-heading">${this.marshalling.cabinetTag}</text>
    <text x="${z3x + 25}" y="162" class="text-meta">Location: ${this.marshalling.location}</text>

    <!-- Incomer Terminals -->
    <rect x="${z3x + 25}" y="235" width="30" height="24" class="terminal" />
    <text x="${z3x + 40}" y="247" class="terminal-text">101</text>

    <rect x="${z3x + 25}" y="280" width="30" height="24" class="terminal" />
    <text x="${z3x + 40}" y="292" class="terminal-text">102</text>

    <!-- Galvanic Isolator / Barrier Module -->
    <rect x="${z3x + 80}" y="215" width="105" height="110" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5" rx="3" />
    <text x="${z3x + 132}" y="235" font-size="10" font-weight="bold" fill="#38bdf8" text-anchor="middle">IS BARRIER</text>
    <text x="${z3x + 132}" y="250" font-size="9" fill="#94a3b8" text-anchor="middle">${this.marshalling.barrierTag}</text>
    <text x="${z3x + 132}" y="265" font-size="8" fill="#cbd5e1" text-anchor="middle">${this.marshalling.barrierRating}</text>
    <text x="${z3x + 132}" y="280" font-size="8" fill="#10b981" text-anchor="middle">${barrierFunction}</text>

    <!-- Outgoing System Terminals -->
    <rect x="${z3x + 215}" y="235" width="30" height="24" class="terminal" />
    <text x="${z3x + 230}" y="247" class="terminal-text">201</text>

    <rect x="${z3x + 215}" y="280" width="30" height="24" class="terminal" />
    <text x="${z3x + 230}" y="292" class="terminal-text">202</text>

    <text x="${z3x + 25}" y="380" class="text-meta">Model: ${this.marshalling.barrierModel}</text>
    <text x="${z3x + 25}" y="395" class="text-meta">Cross Wire: ${this.marshalling.crossWireTag}</text>
  </g>

  <!-- ===================================================================== -->
  <!-- ZONE 4: SYSTEM CABINET (DCS / SIS)                                    -->
  <!-- ===================================================================== -->
  <g id="zone4_sys">
    <rect x="${z4x + 10}" y="120" width="${z4w - 20}" height="320" class="box-highlight" />
    <text x="${z4x + 25}" y="145" class="text-heading">${this.systemCabinet.cabinetTag} (${this.system})</text>
    <text x="${z4x + 25}" y="162" class="text-meta">Card: ${this.systemCabinet.ioCardModel}</text>
    <text x="${z4x + 25}" y="177" class="text-meta">Location: ${this.systemCabinet.rackNumber} / ${this.systemCabinet.slotNumber}</text>
    <text x="${z4x + 25}" y="192" font-size="11" font-weight="bold" fill="#00e5ff">Allocated: ${this.systemCabinet.channelNumber}</text>

    <!-- System Card Input Terminals -->
    <rect x="${z4x + 35}" y="235" width="28" height="24" class="terminal" />
    <text x="${z4x + 49}" y="247" class="terminal-text">CH+</text>

    <rect x="${z4x + 35}" y="280" width="28" height="24" class="terminal" />
    <text x="${z4x + 49}" y="292" class="terminal-text">CH-</text>

    <!-- 24VDC Loop Power Supply Block -->
    <rect x="${z4x + 105}" y="225" width="145" height="90" fill="#1e293b" stroke="#eab308" stroke-width="1.5" rx="3" />
    <text x="${z4x + 177}" y="245" font-size="10" font-weight="bold" fill="#eab308" text-anchor="middle">${pwrHeader}</text>
    <text x="${z4x + 177}" y="262" font-size="9" fill="#94a3b8" text-anchor="middle">${this.systemCabinet.powerDistribution}</text>
    <text x="${z4x + 177}" y="278" font-size="9" fill="#cbd5e1" text-anchor="middle">Fuse: ${this.systemCabinet.fuseRating}</text>
    <text x="${z4x + 177}" y="295" font-size="9" font-weight="bold" fill="#00e5ff" text-anchor="middle">${this.systemCabinet.controllerTag} (${this.systemCabinet.controllerBlock})</text>

    <text x="${z4x + 25}" y="380" class="text-meta">DCS Display Graphic: ${this.systemCabinet.graphicsDisplay}</text>
    <text x="${z4x + 25}" y="395" class="text-meta">${signalLabel}</text>
  </g>

  <!-- ===================================================================== -->
  <!-- WIRING INTERCONNECTIONS                                               -->
  <!-- ===================================================================== -->
  <g id="wires">
    <!-- Cable Tray Segment between JB and Marshalling -->
    <rect x="${z2x + 120}" y="315" width="${z3x - z2x - 95}" height="18" fill="#090d16" stroke="#475569" stroke-width="1" stroke-dasharray="3,2" rx="2" />
    <text x="${(z2x + 120 + z3x + 25) / 2}" y="327" font-size="8" fill="#38bdf8" text-anchor="middle">CABLE TRAY: ${this.junctionBox.cableTrayTag}</text>

    <!-- Field to JB (+) Wire 01 -->
    <path d="M ${z1x + 193} 247 L ${z2x + 85} 247" class="wire-pos" />
    <circle cx="${z1x + 193}" cy="247" r="3" fill="#ef4444" />
    <circle cx="${z2x + 85}" cy="247" r="3" fill="#ef4444" />
    <text x="${(z1x + 193 + z2x + 85) / 2}" y="240" class="wire-label" text-anchor="middle">W-01 (RD)</text>

    <!-- Field to JB (-) Wire 02 -->
    <path d="M ${z1x + 193} 292 L ${z2x + 85} 292" class="wire-neg" />
    <circle cx="${z1x + 193}" cy="292" r="3" fill="#3b82f6" />
    <circle cx="${z2x + 85}" cy="292" r="3" fill="#3b82f6" />
    <text x="${(z1x + 193 + z2x + 85) / 2}" y="285" class="wire-label" text-anchor="middle">W-02 (BK)</text>

    <!-- Field to JB Shield Wire -->
    <path d="M ${z1x + 193} 337 L ${z2x + 85} 337" class="wire-shield" />
    <circle cx="${z1x + 193}" cy="337" r="3" fill="#10b981" />
    <circle cx="${z2x + 85}" cy="337" r="3" fill="#10b981" />
    <text x="${(z1x + 193 + z2x + 85) / 2}" y="330" class="wire-label" text-anchor="middle">DRAIN / SH</text>

    <!-- JB to Marshalling Trunk (+) -->
    <path d="M ${z2x + 120} 247 L ${z3x + 25} 247" class="wire-pos" />
    <circle cx="${z2x + 120}" cy="247" r="3" fill="#ef4444" />
    <circle cx="${z3x + 25}" cy="247" r="3" fill="#ef4444" />
    <text x="${(z2x + 120 + z3x + 25) / 2}" y="240" class="wire-label" text-anchor="middle">TRK-P1 (RD)</text>

    <!-- JB to Marshalling Trunk (-) -->
    <path d="M ${z2x + 120} 292 L ${z3x + 25} 292" class="wire-neg" />
    <circle cx="${z2x + 120}" cy="292" r="3" fill="#3b82f6" />
    <circle cx="${z3x + 25}" cy="292" r="3" fill="#3b82f6" />
    <text x="${(z2x + 120 + z3x + 25) / 2}" y="285" class="wire-label" text-anchor="middle">TRK-P2 (BK)</text>

    <!-- Inside Marshalling: Terminals to Barrier -->
    <path d="M ${z3x + 55} 247 L ${z3x + 80} 247" class="wire-pos" />
    <path d="M ${z3x + 55} 292 L ${z3x + 80} 292" class="wire-neg" />

    <!-- Barrier to System Terminals -->
    <path d="M ${z3x + 185} 247 L ${z3x + 215} 247" class="wire-pos" />
    <path d="M ${z3x + 185} 292 L ${z3x + 215} 292" class="wire-neg" />

    <!-- Marshalling to System Cabinet Pre-fab Cable -->
    <path d="M ${z3x + 245} 247 L ${z4x + 35} 247" class="wire-pos" />
    <circle cx="${z3x + 245}" cy="247" r="3" fill="#ef4444" />
    <circle cx="${z4x + 35}" cy="247" r="3" fill="#ef4444" />
    <text x="${(z3x + 245 + z4x + 35) / 2}" y="240" class="wire-label" text-anchor="middle">PRE-FAB (+)</text>

    <path d="M ${z3x + 245} 292 L ${z4x + 35} 292" class="wire-neg" />
    <circle cx="${z3x + 245}" cy="292" r="3" fill="#3b82f6" />
    <circle cx="${z4x + 35}" cy="292" r="3" fill="#3b82f6" />
    <text x="${(z3x + 245 + z4x + 35) / 2}" y="285" class="wire-label" text-anchor="middle">PRE-FAB (-)</text>

    <!-- Card Terminals to Power / Controller Internal Loop -->
    <path d="M ${z4x + 63} 247 L ${z4x + 105} 247" class="wire-pos" />
    <path d="M ${z4x + 63} 292 L ${z4x + 105} 292" class="wire-neg" />
  </g>

  <!-- ===================================================================== -->
  <!-- TITLE BLOCK & REVISION BOX                                            -->
  <!-- ===================================================================== -->
  <g id="title_block">
    <!-- Drawing Notes Box -->
    <rect x="40" y="${footerY - 10}" width="500" height="90" fill="#090d16" stroke="#334155" stroke-width="1" rx="3" />
    <text x="50" y="${footerY + 10}" font-size="10" font-weight="bold" fill="#38bdf8">ENGINEERING NOTES:</text>
    <text x="50" y="${footerY + 26}" font-size="9" fill="#94a3b8">1. ALL WIRING TO ADHERE TO IEC 60079-14 INTRINSICALLY SAFE INSTALLATION STANDARDS.</text>
    <text x="50" y="${footerY + 40}" font-size="9" fill="#94a3b8">2. BLUE WIRE DUCTING UTILIZED IN MARSHALLING CABINET FOR ALL EX IA CIRCUITS.</text>
    <text x="50" y="${footerY + 54}" font-size="9" fill="#94a3b8">3. CABLE SHIELD DRAIN WIRE EARTHED AT MARSHALLING CABINET IS GROUND BUSBAR ONLY.</text>
    <text x="50" y="${footerY + 68}" font-size="9" fill="#94a3b8">4. CALIBRATION RANGE: ${this.field.calibrationRange} (LINEAR 4-20mA HART SIGNAL).</text>

    <!-- Main Title Block -->
    <rect x="560" y="${footerY - 10}" width="${width - 600}" height="90" class="title-block" rx="3" />
    <text x="575" y="${footerY + 12}" font-size="12" font-weight="bold" fill="#f8fafc">${this.projectName.toUpperCase()}</text>
    <text x="575" y="${footerY + 28}" font-size="11" fill="#38bdf8">INSTRUMENT LOOP DIAGRAM (ISA-5.4)</text>
    <text x="575" y="${footerY + 44}" font-size="11" font-weight="bold" fill="#00e5ff">LOOP: ${this.loopTag} — ${this.serviceDescription}</text>
    <text x="575" y="${footerY + 60}" font-size="9" fill="#94a3b8">P&amp;ID REF: ${this.pandidNumber} | SYSTEM: ${this.system} | DWG NO: ${this.drawingNumber}</text>
    <text x="575" y="${footerY + 74}" font-size="9" fill="#94a3b8">REV: ${this.revision} | DATE: ${this.date} | SHEET 1 OF 1 | SCALE: NTS</text>
  </g>
</svg>`;
  }
}

/**
 * Factory for 4-20mA HART Analog Input (AI) Loop Diagram.
 */
function createAnalogInputLoop(spec) {
  return new InstrumentLoopDiagram({
    ...spec,
    loopType: 'ANALOG_INPUT_4_20MA'
  });
}

/**
 * Factory for 4-20mA HART Analog Output (AO) Control Valve Loop Diagram.
 */
function createAnalogOutputLoop(spec) {
  return new InstrumentLoopDiagram({
    ...spec,
    loopType: 'ANALOG_OUTPUT_4_20MA',
    field: {
      deviceType: 'Globe Control Valve with Smart Positioner',
      manufacturer: 'Fisher / Flowserve',
      model: 'DVC6200 / Kammer',
      hazardousRating: 'Ex ia IIC T4',
      calibrationRange: '0 - 100 % Travel (4-20mA)',
      outputSignal: 'Pneumatic Actuation (3-15 psig)',
      powerSupply: 'Loop Powered 4-20mA',
      fieldCable: `${spec.primaryTag || 'FV-1001'}-CBL (1x2x1.5 mm2)`,
      ...spec.field
    }
  });
}

/**
 * Factory for Digital Output (DO) Shutdown Valve / Solenoid Loop Diagram (SIS).
 */
function createDigitalOutputLoop(spec) {
  return new InstrumentLoopDiagram({
    ...spec,
    loopType: 'DIGITAL_OUTPUT_SIS',
    system: 'SIS',
    field: {
      deviceType: 'Emergency Shutdown Valve Solenoid (SOV)',
      manufacturer: 'ASCO / Bimba',
      model: 'Redundant Low Power Ex d SOV',
      hazardousRating: 'Ex d IIC T6 Gb',
      calibrationRange: 'De-energize to Trip (0V / 24VDC)',
      outputSignal: 'Pneumatic Dump',
      powerSupply: '24VDC External Loop',
      fieldCable: `${spec.primaryTag || 'XV-1001'}-CBL (1x2x2.5 mm2)`,
      ...spec.field
    }
  });
}

module.exports = {
  InstrumentLoopDiagram,
  extractTagBubbleParts,
  createAnalogInputLoop,
  createAnalogOutputLoop,
  createDigitalOutputLoop
};
