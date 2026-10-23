/**
 * OmniEng IEEE LEF 5.8 & DEF 5.8 Parser and Serializer
 * Complete Library Exchange Format & Design Exchange Format engine for standard cell place-and-route.
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
      version: '5.8',
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
        library.version = tokens[1] ? tokens[1].replace(';', '') : '5.8';
      }

      // LAYER
      else if (kw === 'LAYER' && !currentMacro) {
        const layerName = tokens[1] ? tokens[1].replace(';', '') : `layer_${Object.keys(library.layers).length}`;
        library.layers[layerName] = { name: layerName, type: 'ROUTING' };
      }

      // MACRO <cellName>
      else if (kw === 'MACRO') {
        const macroName = tokens[1];
        currentMacro = {
          name: macroName,
          class: 'CORE',
          origin: [0, 0],
          size: { width: 0, height: 0 },
          pins: {},
          obstructions: []
        };
        library.macros[macroName] = currentMacro;
      }

      // CLASS <classType>
      else if (kw === 'CLASS' && currentMacro) {
        currentMacro.class = tokens[1] ? tokens[1].replace(';', '') : 'CORE';
      }

      // ORIGIN <x> <y>
      else if (kw === 'ORIGIN' && currentMacro) {
        currentMacro.origin = [parseFloat(tokens[1]), parseFloat(tokens[2])];
      }

      // SIZE <w> BY <h>
      else if (kw === 'SIZE' && currentMacro) {
        const w = parseFloat(tokens[1]);
        const h = parseFloat(tokens[3]);
        currentMacro.size = { width: w, height: h };
      }

      // PIN <pinName>
      else if (kw === 'PIN' && currentMacro) {
        const pinName = tokens[1];
        currentPin = {
          name: pinName,
          direction: 'INPUT',
          use: 'SIGNAL',
          ports: []
        };
        currentMacro.pins[pinName] = currentPin;
      }

      // DIRECTION <IN | OUT | INOUT>
      else if (kw === 'DIRECTION' && currentPin) {
        currentPin.direction = tokens[1] ? tokens[1].replace(';', '') : 'INPUT';
      }

      // USE <SIGNAL | POWER | GROUND | CLOCK>
      else if (kw === 'USE' && currentPin) {
        currentPin.use = tokens[1] ? tokens[1].replace(';', '') : 'SIGNAL';
      }

      // LAYER <layerName> within PIN or OBS
      else if (kw === 'LAYER' && currentMacro) {
        currentLayer = tokens[1] ? tokens[1].replace(';', '') : 'met1';
      }

      // RECT <x1> <y1> <x2> <y2>
      else if (kw === 'RECT' && currentMacro) {
        const rect = [
          parseFloat(tokens[1]),
          parseFloat(tokens[2]),
          parseFloat(tokens[3]),
          parseFloat(tokens[4])
        ];
        if (currentPin) {
          currentPin.ports.push({ layer: currentLayer || 'met1', rect });
        } else if (currentObs) {
          currentMacro.obstructions.push({ layer: currentLayer || 'met1', rect });
        }
      }

      // OBS
      else if (kw === 'OBS' && currentMacro) {
        currentObs = true;
      }

      // END PIN
      else if (kw === 'END' && tokens[1] && currentPin && tokens[1].replace(';', '') === currentPin.name) {
        currentPin = null;
      }

      // END OBS
      else if (kw === 'END' && currentObs && (!tokens[1] || tokens[1] === 'OBS;')) {
        currentObs = false;
        currentLayer = null;
      }

      // END MACRO
      else if (kw === 'END' && tokens[1] && currentMacro && tokens[1].replace(';', '') === currentMacro.name) {
        currentMacro = null;
      }
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
      name: 'top',
      unitsDistanceMicrons: 1000,
      dieArea: { x1: 0, y1: 0, x2: 0, y2: 0 },
      components: [],
      nets: []
    };

    let section = null;
    let currentNet = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      const tokens = line.split(/\s+/);
      const kw = tokens[0].toUpperCase();

      // DESIGN <name>
      if (kw === 'DESIGN') {
        design.name = tokens[1] ? tokens[1].replace(';', '') : 'top';
      }

      // UNITS DISTANCE MICRONS <val>
      else if (kw === 'UNITS' && tokens[1] === 'DISTANCE' && tokens[2] === 'MICRONS') {
        design.unitsDistanceMicrons = parseInt(tokens[3].replace(';', ''), 10) || 1000;
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
        }
      }

      // COMPONENTS
      else if (kw === 'COMPONENTS') {
        section = 'COMPONENTS';
      } else if (kw === 'END' && tokens[1] === 'COMPONENTS') {
        section = null;
      }

      // NETS
      else if (kw === 'NETS') {
        section = 'NETS';
      } else if (kw === 'END' && tokens[1] === 'NETS') {
        section = null;
        currentNet = null;
      }

      // Parse component inside COMPONENTS
      else if (section === 'COMPONENTS' && line.startsWith('-')) {
        // - instName cellName + PLACED ( x y ) N ;
        const instName = tokens[1];
        const cellName = tokens[2];
        let status = 'PLACED';
        let x = 0, y = 0, orientation = 'N';

        const placeIdx = tokens.indexOf('+');
        if (placeIdx !== -1) {
          status = tokens[placeIdx + 1];
          // Find ( x y )
          const parenOpen = tokens.indexOf('(', placeIdx);
          if (parenOpen !== -1) {
            x = parseFloat(tokens[parenOpen + 1]);
            y = parseFloat(tokens[parenOpen + 2]);
            const parenClose = tokens.indexOf(')', parenOpen);
            if (parenClose !== -1 && tokens[parenClose + 1]) {
              orientation = tokens[parenClose + 1].replace(';', '');
            }
          }
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
          const netName = tokens[1];
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
              const pts = Array.from(ptMatches).map(m => [parseFloat(m[1]), parseFloat(m[2])]);
              if (pts.length >= 2) {
                currentNet.routedSegments.push({ layer, from: pts[0], to: pts[1] });
              }
            }
          }
        }
      }
    }

    return design;
  }

  /**
   * Serializes a design object into standard DEF 5.8 ASCII format
   * @param {Object} design
   * @returns {string} DEF text
   */
  static serializeDEF(design) {
    const scale = design.unitsDistanceMicrons || 1000;
    const die = design.dieArea || { x1: 0, y1: 0, x2: 100000, y2: 100000 };
    const comps = design.components || [];
    const nets = design.nets || [];

    const lines = [
      'VERSION 5.8 ;',
      `DESIGN ${design.name || 'top'} ;`,
      `UNITS DISTANCE MICRONS ${scale} ;`,
      `DIEAREA ( ${die.x1} ${die.y1} ) ( ${die.x2} ${die.y2} ) ;`,
      '',
      `COMPONENTS ${comps.length} ;`
    ];

    for (const comp of comps) {
      lines.push(`  - ${comp.id} ${comp.macro} + ${comp.status || 'PLACED'} ( ${Math.round(comp.x)} ${Math.round(comp.y)} ) ${comp.orientation || 'N'} ;`);
    }
    lines.push('END COMPONENTS', '');

    lines.push(`NETS ${nets.length} ;`);
    for (const net of nets) {
      let netStr = `  - ${net.name}`;
      if (net.connections && net.connections.length > 0) {
        for (const conn of net.connections) {
          netStr += ` ( ${conn.instance} ${conn.pin} )`;
        }
      }
      if (net.routedSegments && net.routedSegments.length > 0) {
        for (const seg of net.routedSegments) {
          netStr += ` + ROUTED ${seg.layer} ( ${Math.round(seg.from[0])} ${Math.round(seg.from[1])} ) ( ${Math.round(seg.to[0])} ${Math.round(seg.to[1])} )`;
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
