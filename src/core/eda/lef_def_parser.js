/**
 * OmniEng IEEE LEF 5.8 & DEF 5.8 Parser and Serializer
 * Partial experimental LEF and DEF parser and serializer.
 *
 * Supports:
 * - LEF: MACRO, CLASS, SIZE, ORIGIN, PIN (DIRECTION, PORT, RECT), OBS (LAYER, RECT)
 * - DEF: DIEAREA, COMPONENTS (PLACED, UNPLACED, ORIENTATION), NETS (PINS, ROUTED WIRES)
 * - Serialization back to industry-standard DEF format.
 *
 * Zero external dependencies.
 */

'use strict';

class LefDefParser {
  /**
   * Parses LEF ASCII string into standard cell library model
   * @param {string} lefContent - LEF file content
   * @returns {Object} Library with layers and macros
   */
  static parseLEF(lefContent) {
    if (!lefContent || typeof lefContent !== 'string') {
      throw new Error('LEF content must be a non-empty string');
    }

    const lines = lefContent.split(/\r?\n/);
    const library = {
      version: null,
      layers: {},
      macros: {}
    };

    let currentMacro = null;
    let currentPin = null;
    let currentObs = false;
    let currentLayer = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      const tokens = line.split(/\s+/);
      const kw = tokens[0].toUpperCase();

      // VERSION
      if (kw === 'VERSION') {
        const version = tokens[1] ? tokens[1].replace(';', '') : '';
        if (!/^\d+(?:\.\d+)?$/.test(version)) {
          throw new Error(`Invalid LEF VERSION declaration at line ${i + 1}`);
        }
        library.version = version;
      }

      // LAYER
      else if (kw === 'LAYER' && !currentMacro) {
        const layerName = tokens[1] ? tokens[1].replace(';', '') : '';
        if (!layerName || Object.hasOwn(library.layers, layerName)) {
          throw new Error(`Invalid or duplicate LEF layer declaration at line ${i + 1}`);
        }
        library.layers[layerName] = { name: layerName, type: 'ROUTING' };
      }

      // MACRO <cellName>
      else if (kw === 'MACRO') {
        const macroName = tokens[1] ? tokens[1].replace(';', '') : '';
        if (!macroName || currentMacro || Object.hasOwn(library.macros, macroName)) {
          throw new Error(`Invalid, nested, or duplicate LEF MACRO declaration at line ${i + 1}`);
        }
        currentMacro = {
          name: macroName,
          class: null,
          origin: [0, 0],
          size: null,
          pins: {},
          obstructions: []
        };
        library.macros[macroName] = currentMacro;
      }

      // CLASS <classType>
      else if (kw === 'CLASS' && currentMacro) {
        currentMacro.class = tokens[1] ? tokens[1].replace(';', '') : null;
        if (!currentMacro.class) throw new Error(`Invalid LEF CLASS in macro '${currentMacro.name}' at line ${i + 1}`);
      }

      // ORIGIN <x> <y>
      else if (kw === 'ORIGIN' && currentMacro) {
        const origin = [parseFloat(tokens[1]), parseFloat(tokens[2])];
        if (!origin.every(Number.isFinite))
          throw new Error(`Invalid LEF ORIGIN in macro '${currentMacro.name}' at line ${i + 1}`);
        currentMacro.origin = origin;
      }

      // SIZE <w> BY <h>
      else if (kw === 'SIZE' && currentMacro) {
        const w = parseFloat(tokens[1]);
        const h = parseFloat(tokens[3]);
        if (tokens[2]?.toUpperCase() !== 'BY' || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
          throw new Error(`Invalid LEF SIZE in macro '${currentMacro.name}' at line ${i + 1}`);
        }
        currentMacro.size = { width: w, height: h };
      }

      // PIN <pinName>
      else if (kw === 'PIN' && currentMacro) {
        const pinName = tokens[1] ? tokens[1].replace(';', '') : '';
        if (!pinName || Object.hasOwn(currentMacro.pins, pinName)) {
          throw new Error(`Invalid or duplicate LEF PIN in macro '${currentMacro.name}' at line ${i + 1}`);
        }
        currentPin = {
          name: pinName,
          direction: null,
          use: 'SIGNAL',
          ports: []
        };
        currentMacro.pins[pinName] = currentPin;
        currentLayer = null;
      }

      // DIRECTION <IN | OUT | INOUT>
      else if (kw === 'DIRECTION' && currentPin) {
        currentPin.direction = tokens[1] ? tokens[1].replace(';', '').toUpperCase() : null;
        if (!['INPUT', 'OUTPUT', 'INOUT', 'FEEDTHRU'].includes(currentPin.direction)) {
          throw new Error(`Invalid LEF DIRECTION for pin '${currentPin.name}' at line ${i + 1}`);
        }
      }

      // USE <SIGNAL | POWER | GROUND | CLOCK>
      else if (kw === 'USE' && currentPin) {
        currentPin.use = tokens[1] ? tokens[1].replace(';', '') : 'SIGNAL';
      }

      // LAYER <layerName> within PIN or OBS
      else if (kw === 'LAYER' && currentMacro) {
        currentLayer = tokens[1] ? tokens[1].replace(';', '') : null;
        if (!currentLayer) throw new Error(`Invalid LEF LAYER in macro '${currentMacro.name}' at line ${i + 1}`);
      }

      // RECT <x1> <y1> <x2> <y2>
      else if (kw === 'RECT' && currentMacro) {
        const rect = [parseFloat(tokens[1]), parseFloat(tokens[2]), parseFloat(tokens[3]), parseFloat(tokens[4])];
        if (!rect.every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1]) {
          throw new Error(`Invalid LEF RECT in macro '${currentMacro.name}' at line ${i + 1}`);
        }
        if (currentPin) {
          if (!currentLayer) throw new Error(`LEF RECT for pin '${currentPin.name}' has no LAYER declaration`);
          currentPin.ports.push({ layer: currentLayer, rect });
        } else if (currentObs) {
          if (!currentLayer) throw new Error(`LEF obstruction rectangle has no LAYER declaration`);
          currentMacro.obstructions.push({ layer: currentLayer, rect });
        } else {
          throw new Error(`LEF RECT is outside a PIN or OBS section at line ${i + 1}`);
        }
      }

      // OBS
      else if (kw === 'OBS' && currentMacro) {
        currentObs = true;
      }

      // END PIN
      else if (kw === 'END' && tokens[1] && currentPin && tokens[1].replace(';', '') === currentPin.name) {
        if (!currentPin.direction) throw new Error(`LEF PIN '${currentPin.name}' has no valid DIRECTION`);
        currentPin = null;
        currentLayer = null;
      }

      // END OBS
      else if (kw === 'END' && currentObs && (!tokens[1] || tokens[1].replace(';', '').toUpperCase() === 'OBS')) {
        currentObs = false;
        currentLayer = null;
      }

      // END MACRO
      else if (kw === 'END' && tokens[1] && currentMacro && tokens[1].replace(';', '') === currentMacro.name) {
        if (currentPin || currentObs)
          throw new Error(`LEF MACRO '${currentMacro.name}' has an unterminated PIN or OBS section`);
        if (!currentMacro.size) throw new Error(`LEF MACRO '${currentMacro.name}' has no valid SIZE declaration`);
        if (!currentMacro.class) throw new Error(`LEF MACRO '${currentMacro.name}' has no CLASS declaration`);
        currentMacro = null;
      }
    }

    if (currentMacro) throw new Error(`LEF MACRO '${currentMacro.name}' is missing its END declaration`);
    if (!library.version) throw new Error('LEF VERSION declaration is required');
    if (Object.keys(library.layers).length + Object.keys(library.macros).length === 0) {
      throw new Error('LEF contains no supported LAYER or MACRO declarations');
    }

    return library;
  }

  /**
   * Parses DEF ASCII string into design layout data
   * @param {string} defContent - DEF file content
   * @returns {Object} Design layout with components and nets
   */
  static parseDEF(defContent) {
    if (!defContent || typeof defContent !== 'string') {
      throw new Error('DEF content must be a non-empty string');
    }

    const lines = defContent.split(/\r?\n/);
    const design = {
      name: null,
      unitsDistanceMicrons: null,
      dieArea: null,
      components: [],
      nets: []
    };

    let section = null;
    let currentNet = null;
    let versionSeen = false;
    let endDesignSeen = false;
    let componentCount = null;
    let netCount = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      const tokens = line.split(/\s+/);
      const kw = tokens[0].toUpperCase();

      if (kw === 'VERSION') {
        versionSeen = /^\d+(?:\.\d+)?$/.test(tokens[1] ? tokens[1].replace(';', '') : '');
        if (!versionSeen) throw new Error(`Invalid DEF VERSION declaration at line ${i + 1}`);
      }

      // DESIGN <name>
      if (kw === 'DESIGN') {
        design.name = tokens[1] ? tokens[1].replace(';', '') : null;
        if (!design.name) throw new Error(`Invalid DEF DESIGN declaration at line ${i + 1}`);
      }

      // UNITS DISTANCE MICRONS <val>
      else if (kw === 'UNITS' && tokens[1] === 'DISTANCE' && tokens[2] === 'MICRONS') {
        design.unitsDistanceMicrons = Number(tokens[3] ? tokens[3].replace(';', '') : NaN);
        if (!Number.isSafeInteger(design.unitsDistanceMicrons) || design.unitsDistanceMicrons <= 0) {
          throw new Error(`Invalid DEF distance units declaration at line ${i + 1}`);
        }
      }

      // DIEAREA ( x1 y1 ) ( x2 y2 )
      else if (kw === 'DIEAREA') {
        const matches = line.match(/\(\s*([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/);
        if (matches) {
          design.dieArea = {
            x1: parseFloat(matches[1]),
            y1: parseFloat(matches[2]),
            x2: parseFloat(matches[3]),
            y2: parseFloat(matches[4])
          };
          if (
            !Object.values(design.dieArea).every(Number.isSafeInteger) ||
            design.dieArea.x2 <= design.dieArea.x1 ||
            design.dieArea.y2 <= design.dieArea.y1
          ) {
            throw new Error(`Invalid DEF DIEAREA declaration at line ${i + 1}`);
          }
        } else {
          throw new Error(`Invalid DEF DIEAREA declaration at line ${i + 1}`);
        }
      }

      // COMPONENTS
      else if (kw === 'COMPONENTS') {
        componentCount = Number(tokens[1] ? tokens[1].replace(';', '') : NaN);
        if (!Number.isSafeInteger(componentCount) || componentCount < 0) {
          throw new Error(`Invalid DEF COMPONENTS count at line ${i + 1}`);
        }
        section = 'COMPONENTS';
      } else if (kw === 'END' && tokens[1]?.toUpperCase() === 'COMPONENTS') {
        section = null;
      }

      // NETS
      else if (kw === 'NETS') {
        netCount = Number(tokens[1] ? tokens[1].replace(';', '') : NaN);
        if (!Number.isSafeInteger(netCount) || netCount < 0) {
          throw new Error(`Invalid DEF NETS count at line ${i + 1}`);
        }
        section = 'NETS';
      } else if (kw === 'END' && tokens[1]?.toUpperCase() === 'NETS') {
        section = null;
        currentNet = null;
      } else if (kw === 'END' && tokens[1]?.toUpperCase() === 'DESIGN') {
        endDesignSeen = true;
      }

      // Parse component inside COMPONENTS
      else if (section === 'COMPONENTS' && line.startsWith('-')) {
        // - instName cellName + PLACED ( x y ) N ;
        const instName = tokens[1];
        const cellName = tokens[2];
        const placeIdx = tokens.indexOf('+');
        if (!instName || !cellName || placeIdx === -1) {
          throw new Error(`Invalid DEF component declaration at line ${i + 1}`);
        }
        const status = tokens[placeIdx + 1]?.toUpperCase();
        let x = null;
        let y = null;
        let orientation = null;
        if (status !== 'UNPLACED') {
          const parenOpen = tokens.indexOf('(', placeIdx);
          const parenClose = tokens.indexOf(')', parenOpen);
          const xToken = tokens[parenOpen + 1];
          const yToken = tokens[parenOpen + 2];
          x = /^-?\d+$/.test(xToken || '') ? Number(xToken) : NaN;
          y = /^-?\d+$/.test(yToken || '') ? Number(yToken) : NaN;
          orientation = parenClose === -1 ? null : tokens[parenClose + 1]?.replace(';', '').toUpperCase();
          if (
            !['PLACED', 'FIXED', 'COVER'].includes(status) ||
            parenOpen === -1 ||
            parenClose === -1 ||
            !Number.isSafeInteger(x) ||
            !Number.isSafeInteger(y) ||
            !['N', 'S', 'E', 'W', 'FN', 'FS', 'FE', 'FW'].includes(orientation)
          ) {
            throw new Error(`Invalid DEF placement for component '${instName}' at line ${i + 1}`);
          }
        } else if (tokens.length > placeIdx + 2 && tokens[placeIdx + 2] !== ';') {
          throw new Error(`Unexpected placement coordinates for UNPLACED component '${instName}' at line ${i + 1}`);
        }

        design.components.push({
          id: instName,
          macro: cellName,
          status,
          x,
          y,
          orientation
        });
      }

      // Parse net inside NETS
      else if (section === 'NETS') {
        if (line.startsWith('-')) {
          const netName = tokens[1] ? tokens[1].replace(';', '') : '';
          if (!netName) throw new Error(`Invalid DEF net declaration at line ${i + 1}`);
          currentNet = {
            name: netName,
            connections: [],
            routedSegments: []
          };
          design.nets.push(currentNet);
        }

        if (currentNet) {
          // Parse any ( inst pin ) connections on the line (excluding points after ROUTED)
          const connPart = line.includes('+') ? line.substring(0, line.indexOf('+')) : line;
          const pinMatches = connPart.matchAll(/\(\s*([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_]+)\s*\)/g);
          for (const m of pinMatches) {
            currentNet.connections.push({ instance: m[1], pin: m[2] });
          }

          if (line.includes('+ ROUTED')) {
            const rTokens = line.split(/\s+/);
            const routedIdx = rTokens.indexOf('+');
            if (routedIdx !== -1 && rTokens[routedIdx + 1] === 'ROUTED') {
              const layer = rTokens[routedIdx + 2];
              const ptMatches = line.matchAll(/\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/g);
              const pts = Array.from(ptMatches).map((m) => [parseFloat(m[1]), parseFloat(m[2])]);
              if (!layer || pts.length < 2 || !pts.flat().every(Number.isFinite)) {
                throw new Error(`Invalid DEF routed segment at line ${i + 1}`);
              }
              currentNet.routedSegments.push({ layer, from: pts[0], to: pts[1] });
            }
          }
        }
      }
    }

    if (!versionSeen) throw new Error('DEF VERSION declaration is required');
    if (!design.name || !design.dieArea || !design.unitsDistanceMicrons || !endDesignSeen) {
      throw new Error('DEF requires explicit DESIGN, UNITS, DIEAREA, and END DESIGN declarations');
    }
    if (section !== null) throw new Error(`DEF ${section} section is missing its END declaration`);
    if (componentCount !== null && design.components.length !== componentCount) {
      throw new Error(`DEF COMPONENTS declared ${componentCount} entries but parsed ${design.components.length}`);
    }
    if (netCount !== null && design.nets.length !== netCount) {
      throw new Error(`DEF NETS declared ${netCount} entries but parsed ${design.nets.length}`);
    }

    return design;
  }

  /**
   * Serializes a design object into standard DEF 5.8 ASCII format
   * @param {Object} design
   * @returns {string} DEF text
   */
  static serializeDEF(design) {
    const fail = (message) => {
      throw new TypeError(`Invalid DEF data: ${message}`);
    };
    const validName = (value) => typeof value === 'string' && value.length > 0 && !/[\s\u0000-\u001f;()+#]/.test(value);
    if (!design || typeof design !== 'object' || Array.isArray(design)) fail('an object is required');
    if (!validName(design.name)) fail('name must be a non-empty DEF identifier');
    if (!Number.isSafeInteger(design.unitsDistanceMicrons) || design.unitsDistanceMicrons <= 0) {
      fail('unitsDistanceMicrons must be a positive safe integer');
    }
    const scale = design.unitsDistanceMicrons;
    const die = design.dieArea;
    if (!die || typeof die !== 'object' || !['x1', 'y1', 'x2', 'y2'].every((key) => Number.isSafeInteger(die[key]))) {
      fail('dieArea must contain four safe integer coordinates');
    }
    if (die.x2 <= die.x1 || die.y2 <= die.y1) fail('dieArea must have positive width and height');
    const comps = design.components;
    const nets = design.nets;
    if (!Array.isArray(comps) || !Array.isArray(nets)) fail('components and nets arrays are required');
    if (comps.length > 10000 || nets.length > 10000) fail('components and nets are limited to 10000 entries each');
    for (const [index, comp] of comps.entries()) {
      if (!comp || typeof comp !== 'object' || Array.isArray(comp)) fail(`component ${index} must be an object`);
      if (!validName(comp.id) || !validName(comp.macro))
        fail(`component ${index} requires valid id and macro identifiers`);
      if (comp.status === 'UNPLACED') {
        if (comp.x !== null || comp.y !== null || comp.orientation !== null) {
          fail(`unplaced component ${index} must not contain placement coordinates or orientation`);
        }
      } else {
        if (!['PLACED', 'FIXED', 'COVER'].includes(comp.status))
          fail(`component ${index} requires a supported placement status`);
        if (!Number.isSafeInteger(comp.x) || !Number.isSafeInteger(comp.y))
          fail(`component ${index} coordinates must be safe integers`);
        if (!['N', 'S', 'E', 'W', 'FN', 'FS', 'FE', 'FW'].includes(comp.orientation))
          fail(`component ${index} requires a valid orientation`);
      }
    }
    for (const [index, net] of nets.entries()) {
      if (!net || typeof net !== 'object' || Array.isArray(net)) fail(`net ${index} must be an object`);
      if (!validName(net.name) || !Array.isArray(net.connections) || !Array.isArray(net.routedSegments)) {
        fail(`net ${index} requires a valid name, connections array, and routedSegments array`);
      }
      for (const [connectionIndex, conn] of net.connections.entries()) {
        if (!conn || !validName(conn.instance) || !validName(conn.pin)) {
          fail(`net ${index} connection ${connectionIndex} requires valid instance and pin identifiers`);
        }
      }
      for (const [segmentIndex, seg] of net.routedSegments.entries()) {
        if (
          !seg ||
          !validName(seg.layer) ||
          !Array.isArray(seg.from) ||
          !Array.isArray(seg.to) ||
          seg.from.length !== 2 ||
          seg.to.length !== 2 ||
          ![...seg.from, ...seg.to].every(Number.isSafeInteger)
        ) {
          fail(`net ${index} route ${segmentIndex} requires a layer and two integer points`);
        }
      }
    }

    const lines = [
      'VERSION 5.8 ;',
      `DESIGN ${design.name} ;`,
      `UNITS DISTANCE MICRONS ${scale} ;`,
      `DIEAREA ( ${die.x1} ${die.y1} ) ( ${die.x2} ${die.y2} ) ;`,
      '',
      `COMPONENTS ${comps.length} ;`
    ];

    for (const comp of comps) {
      if (comp.status === 'UNPLACED') lines.push(`  - ${comp.id} ${comp.macro} + UNPLACED ;`);
      else lines.push(`  - ${comp.id} ${comp.macro} + ${comp.status} ( ${comp.x} ${comp.y} ) ${comp.orientation} ;`);
    }
    lines.push('END COMPONENTS', '');

    lines.push(`NETS ${nets.length} ;`);
    for (const net of nets) {
      let netStr = `  - ${net.name}`;
      if (net.connections.length > 0) {
        for (const conn of net.connections) {
          netStr += ` ( ${conn.instance} ${conn.pin} )`;
        }
      }
      if (net.routedSegments.length > 0) {
        for (const seg of net.routedSegments) {
          netStr += ` + ROUTED ${seg.layer} ( ${seg.from[0]} ${seg.from[1]} ) ( ${seg.to[0]} ${seg.to[1]} )`;
        }
      }
      netStr += ' ;';
      lines.push(netStr);
    }
    lines.push('END NETS', '');
    lines.push('END DESIGN');

    return lines.join('\n');
  }
}

module.exports = {
  LefDefParser
};
