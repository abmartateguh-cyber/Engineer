/**
 * OmniEng Experimental SPEF Parsing and RC Network Example
 *
 * Handles a limited set of SPEF records and illustrative RC network calculations.
 * Format completeness, electrical accuracy, foundry correlation, and signoff use have not
 * been independently assessed.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

const EPSILON_0 = 8.8541878128e-12; // F/m

class SpefParasiticExtractor {
  /**
   * Constructs an experimental SPEF-shaped document from explicit net geometries
   * @param {Object} pexInput
   * @param {string} pexInput.designName - Top-level module name
   * @param {Array<Object>} pexInput.nets - Array of routed net specifications with explicit geometry
   * @param {Object} pexInput.techPdk - Caller-supplied layer resistance and capacitance values
   * @returns {Object} SPEF formatted string and extraction summary metrics
   */
  static extractDesignSPEF(pexInput) {
    if (!pexInput || typeof pexInput !== 'object' || Array.isArray(pexInput)) {
      throw new TypeError('An explicit SPEF extraction request object is required.');
    }
    const { designName, nets, techPdk: pdk } = pexInput;
    if (typeof designName !== 'string' || designName.trim() === '') {
      throw new TypeError('An explicit non-empty designName is required.');
    }
    if (!Array.isArray(nets)) throw new TypeError('An explicit nets array is required.');
    if (!pdk || typeof pdk !== 'object' || Array.isArray(pdk)) {
      throw new TypeError('Explicit layer property records are required in techPdk.');
    }
    if (typeof pdk.name !== 'string' || pdk.name.trim() === '') {
      throw new TypeError('An explicit technology or dataset name is required.');
    }
    if (
      !pdk.provenance ||
      typeof pdk.provenance.source !== 'string' ||
      pdk.provenance.source.trim() === '' ||
      typeof pdk.provenance.license !== 'string' ||
      pdk.provenance.license.trim() === ''
    ) {
      throw new TypeError('Explicit source and license labels are required for layer property records.');
    }
    if (!pdk.layers || typeof pdk.layers !== 'object' || Array.isArray(pdk.layers)) {
      throw new TypeError('An explicit layer property map is required.');
    }

    const requireFinite = (value, label, { positive = false } = {}) => {
      if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
        throw new RangeError(`${label} must be a finite ${positive ? 'positive' : 'non-negative'} number.`);
      }
    };
    for (const [layerName, layer] of Object.entries(pdk.layers)) {
      if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
        throw new TypeError(`Layer '${layerName}' must have an explicit property record.`);
      }
      requireFinite(layer.sheetResOhmSq, `${layerName}.sheetResOhmSq`, { positive: true });
      requireFinite(layer.capAreaFfUm2, `${layerName}.capAreaFfUm2`);
      requireFinite(layer.capFringeFfUm, `${layerName}.capFringeFfUm`);
      requireFinite(layer.viaResOhm, `${layerName}.viaResOhm`);
    }

    const lines = [];
    const dateStr = new Date().toUTCString();

    // 1. IEEE 1481 Mandatory Header
    lines.push('*SPEF "IEEE 1481-1999"');
    lines.push(`*DESIGN "${designName}"`);
    lines.push(`*DATE "${dateStr}"`);
    lines.push('*VENDOR "OmniEng EDA Systems"');
    lines.push('*PROGRAM "OmniEng PEX Extractor"');
    lines.push('*VERSION "3.2.0"');
    lines.push('*DIVIDER /');
    lines.push('*DELIMITER :');
    lines.push('*BUS_DELIMITER []');
    lines.push('*T_UNIT 1 PS');
    lines.push('*C_UNIT 1 FF');
    lines.push('*R_UNIT 1 OHM');
    lines.push('*L_UNIT 1 HENRY');
    lines.push('');

    let totalCapsFf = 0;
    let totalResOhms = 0;
    let totalCrossCapsFf = 0;
    const extractedNetsSummary = [];

    // 2. Process each D_NET
    for (const net of nets) {
      if (!net || typeof net !== 'object' || Array.isArray(net)) {
        throw new TypeError('Each SPEF net must be an explicit record.');
      }
      const { name: netName, pins, segments, crossCouplings } = net;
      if (typeof netName !== 'string' || netName.trim() === '') {
        throw new TypeError('Each SPEF net requires an explicit non-empty name.');
      }
      if (!Array.isArray(pins) || !Array.isArray(segments) || !Array.isArray(crossCouplings)) {
        throw new TypeError(`Net '${netName}' requires explicit pins, segments, and crossCouplings arrays.`);
      }

      let netCapFf = 0;
      let netResOhms = 0;

      const capEntries = [];
      const resEntries = [];
      let capIndex = 1;
      let resIndex = 1;

      // Extract segment resistances and ground capacitances
      segments.forEach((seg, sIdx) => {
        if (!seg || typeof seg !== 'object' || Array.isArray(seg)) {
          throw new TypeError(`Net '${netName}' segment ${sIdx} must be an explicit record.`);
        }
        const layer = pdk.layers[seg.layer];
        if (!layer) throw new TypeError(`Net '${netName}' segment ${sIdx} references an unknown layer.`);
        const { lengthUm: lenUm, widthUm, fromNode, toNode, hasVia } = seg;
        requireFinite(lenUm, `Net '${netName}' segment ${sIdx} lengthUm`, { positive: true });
        requireFinite(widthUm, `Net '${netName}' segment ${sIdx} widthUm`, { positive: true });
        if (
          typeof fromNode !== 'string' ||
          fromNode.trim() === '' ||
          typeof toNode !== 'string' ||
          toNode.trim() === ''
        ) {
          throw new TypeError(`Net '${netName}' segment ${sIdx} requires explicit fromNode and toNode names.`);
        }
        if (typeof hasVia !== 'boolean') {
          throw new TypeError(`Net '${netName}' segment ${sIdx} requires an explicit hasVia boolean.`);
        }

        // Segment resistance: R = sheetRes * (L / W) + viaRes
        const segRes = layer.sheetResOhmSq * (lenUm / widthUm) + (seg.hasVia ? layer.viaResOhm : 0.0);
        netResOhms += segRes;
        resEntries.push(`${resIndex++} ${fromNode} ${toNode} ${segRes.toFixed(4)}`);

        // Area + Fringe Ground Capacitance: C = (area * C_area) + (2 * L * C_fringe)
        const areaUm2 = lenUm * widthUm;
        const cGnd = areaUm2 * layer.capAreaFfUm2 + 2.0 * lenUm * layer.capFringeFfUm;
        netCapFf += cGnd;
        capEntries.push(`${capIndex++} ${fromNode} ${cGnd.toFixed(4)}`);
      });

      // Extract inter-wire cross-coupling capacitances (*CAP 1 netA:node1 netB:node2 c_val)
      crossCouplings.forEach((cc, ccIdx) => {
        if (!cc || typeof cc !== 'object' || Array.isArray(cc)) {
          throw new TypeError(`Net '${netName}' cross-coupling ${ccIdx} must be an explicit record.`);
        }
        const { capFf: cValFf, nodeA, nodeB } = cc;
        requireFinite(cValFf, `Net '${netName}' cross-coupling ${ccIdx} capFf`);
        if (typeof nodeA !== 'string' || nodeA.trim() === '' || typeof nodeB !== 'string' || nodeB.trim() === '') {
          throw new TypeError(`Net '${netName}' cross-coupling ${ccIdx} requires explicit nodeA and nodeB names.`);
        }
        netCapFf += cValFf;
        totalCrossCapsFf += cValFf;
        capEntries.push(`${capIndex++} ${nodeA} ${nodeB} ${cValFf.toFixed(4)}`);
      });

      totalCapsFf += netCapFf;
      totalResOhms += netResOhms;

      // Calculate Elmore delay (tau = sum(R_k * C_k))
      const lumpedRcTimeConstantPs = netResOhms * netCapFf * 1e-3; // Ohm * fF -> ps
      const lumpedFirstOrderSlew90Ps = lumpedRcTimeConstantPs * Math.log(9.0);

      extractedNetsSummary.push({
        netName,
        totalCapFf: Number(netCapFf.toFixed(4)),
        totalResOhms: Number(netResOhms.toFixed(4)),
        lumpedRcTimeConstantPs: Number(lumpedRcTimeConstantPs.toFixed(3)),
        lumpedFirstOrderSlew90Ps: Number(lumpedFirstOrderSlew90Ps.toFixed(3)),
        pinCount: pins.length,
        segmentCount: segments.length
      });

      // Write *D_NET entry
      lines.push(`*D_NET ${netName} ${netCapFf.toFixed(4)}`);

      // *CONN section
      lines.push('*CONN');
      for (const [pinIdx, pin] of pins.entries()) {
        if (!pin || typeof pin !== 'object' || Array.isArray(pin)) {
          throw new TypeError(`Net '${netName}' pin ${pinIdx} must be an explicit record.`);
        }
        if (typeof pin.name !== 'string' || pin.name.trim() === '') {
          throw new TypeError(`Net '${netName}' pin ${pinIdx} requires an explicit name.`);
        }
        if (!['input', 'output', 'inout'].includes(pin.direction) || typeof pin.isPort !== 'boolean') {
          throw new TypeError(`Net '${netName}' pin ${pinIdx} requires an explicit direction and isPort value.`);
        }
        if ((pin.x === undefined) !== (pin.y === undefined)) {
          throw new TypeError(`Net '${netName}' pin ${pinIdx} must provide both coordinates or neither.`);
        }
        if (pin.x !== undefined) {
          requireFinite(pin.x, `Net '${netName}' pin ${pinIdx} x`);
          requireFinite(pin.y, `Net '${netName}' pin ${pinIdx} y`);
        }
        // e.g. *P pin_name O or *I inst/pin I
        const dir = pin.direction === 'output' ? 'O' : pin.direction === 'inout' ? 'B' : 'I';
        const prefix = pin.isPort ? '*P' : '*I';
        let connLine = `${prefix} ${pin.name} ${dir}`;
        if (pin.x !== undefined && pin.y !== undefined) {
          connLine += ` *C ${pin.x} ${pin.y}`;
        }
        lines.push(connLine);
      }

      // *CAP section
      lines.push('*CAP');
      for (const c of capEntries) {
        lines.push(c);
      }

      // *RES section
      lines.push('*RES');
      for (const r of resEntries) {
        lines.push(r);
      }

      lines.push('*END');
      lines.push('');
    }

    const spefContent = lines.join('\n');

    return {
      success: true,
      designName,
      technologyOrDatasetName: pdk.name,
      dataStatus: 'caller-supplied-unverified',
      provenance: { ...pdk.provenance },
      netCount: nets.length,
      totalDesignCapacitanceFf: Number(totalCapsFf.toFixed(4)),
      totalInterconnectResistanceOhms: Number(totalResOhms.toFixed(4)),
      totalCrossCouplingCapacitanceFf: Number(totalCrossCapsFf.toFixed(4)),
      extractedNets: extractedNetsSummary,
      spefText: spefContent
    };
  }

  /**
   * Fast parser for IEEE 1481 SPEF files
   * @param {string} spefText - Non-empty SPEF text with a header
   * @returns {Object} Parsed nets, resistors, capacitors, and connections
   */
  static parseSPEF(spefText) {
    if (typeof spefText !== 'string' || spefText.trim() === '') {
      throw new TypeError('Explicit non-empty SPEF text is required.');
    }
    const lines = spefText.split(/\r?\n/);
    if (!lines.some((line) => line.trim().startsWith('*SPEF'))) {
      throw new TypeError('SPEF header is missing.');
    }
    const parsedNets = [];
    let currentNet = null;
    let currentSection = null;

    let design = null;

    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//')) continue;

      if (line.startsWith('*DESIGN')) {
        const match = line.match(/\*DESIGN\s+"([^"]+)"/);
        if (match) design = match[1];
        continue;
      }

      if (line.startsWith('*D_NET')) {
        const tokens = line.split(/\s+/);
        const totalCap = Number(tokens[2]);
        if (tokens.length < 3 || !Number.isFinite(totalCap) || totalCap < 0) {
          throw new TypeError('SPEF D_NET record requires a name and non-negative finite capacitance.');
        }
        currentNet = {
          name: tokens[1],
          totalCap,
          connections: [],
          caps: [],
          resistors: []
        };
        currentSection = null;
        continue;
      }

      if (line === '*CONN') {
        currentSection = 'CONN';
        continue;
      }
      if (line === '*CAP') {
        currentSection = 'CAP';
        continue;
      }
      if (line === '*RES') {
        currentSection = 'RES';
        continue;
      }

      if (line === '*END') {
        if (currentNet) {
          parsedNets.push(currentNet);
          currentNet = null;
        }
        currentSection = null;
        continue;
      }

      if (currentNet && currentSection === 'CONN') {
        const parts = line.split(/\s+/);
        currentNet.connections.push({
          type: parts[0],
          name: parts[1],
          dir: parts[2]
        });
      } else if (currentNet && currentSection === 'CAP') {
        const parts = line.split(/\s+/);
        if (parts.length === 3) {
          // Node to gnd: id node cap
          currentNet.caps.push({
            id: parts[0],
            node: parts[1],
            capFf: parseFloat(parts[2])
          });
        } else if (parts.length >= 4) {
          // Cross-coupling: id nodeA nodeB cap
          currentNet.caps.push({
            id: parts[0],
            nodeA: parts[1],
            nodeB: parts[2],
            capFf: parseFloat(parts[3]),
            isCrossCoupling: true
          });
        }
      } else if (currentNet && currentSection === 'RES') {
        const parts = line.split(/\s+/);
        currentNet.resistors.push({
          id: parts[0],
          fromNode: parts[1],
          toNode: parts[2],
          resOhms: parseFloat(parts[3])
        });
      }
    }

    return {
      success: true,
      design,
      designStatus: design === null ? 'unavailable' : 'provided',
      nets: parsedNets
    };
  }
}

module.exports = {
  EPSILON_0,
  SpefParasiticExtractor
};
