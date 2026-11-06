/**
 * src/core/plant/pcf_export.js
 * Piping Component File (PCF) Exporter for ISOGEN / AVEVA isometric
 * generation.
 *
 * Emits an ASCII PCF document with structural parity to the documented
 * industry format:
 *
 *   UNITS            unit-of-measure block
 *   TEXT             document titles / line reference
 *   HDR ... END      component header (ELEM type, COMP id, REF key)
 *   DATA ... END     geometry records (POSITION, ORIENTATION,
 *                    END-POINT, CENTRE-POINT, ...)
 *   ATTR ... END     component attributes (wall thickness, end prep,
 *                    material grade, specification, ...)
 *   NODE ... END     connectivity entries (consecutive components share
 *                    node numbers)
 *
 * Standard ELEM record types: PIPE, ELBOW, TEE, REDUCER, FLANGE,
 * VALVE, WELD.
 *
 * Pure text generation: no runtime dependencies, no wall-clock reads,
 * no randomness. Identical input always yields byte-identical output.
 */
'use strict';

const COMPONENT_TYPES = Object.freeze(['PIPE', 'ELBOW', 'TEE', 'REDUCER', 'FLANGE', 'VALVE', 'WELD']);

const VALID_END_PREPS = Object.freeze(['BW', 'SW', 'TH']);

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function fmtNumber(v, label) {
  const n = Number(v);
  if (!isFiniteNumber(n)) {
    throw new TypeError(`PCF export: ${label} must be a finite number, got ${JSON.stringify(v)}`);
  }
  return String(parseFloat(n.toFixed(6)));
}

function assertCoords(p, label) {
  let x;
  let y;
  let z;
  if (Array.isArray(p)) {
    if (p.length < 3) {
      throw new TypeError(`PCF export: ${label} must be [x, y, z] (length >= 3)`);
    }
    x = p[0];
    y = p[1];
    z = p[2];
  } else if (p && typeof p === 'object') {
    x = p.x;
    y = p.y;
    z = p.z;
  } else {
    throw new TypeError(`PCF export: ${label} must be an array or {x, y, z}`);
  }
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    throw new TypeError(`PCF export: ${label} must contain finite numbers, got ${JSON.stringify(p)}`);
  }
  return [fmtNumber(x, `${label} x`), fmtNumber(y, `${label} y`), fmtNumber(z, `${label} z`)];
}

function assertStringValue(v, label, fallback) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  if (s.length === 0) {
    throw new TypeError(`PCF export: ${label} must not be empty`);
  }
  return s;
}

class PCFExporter {
  constructor(options = {}) {
    this.projectName = assertStringValue(options.projectName, 'projectName', 'OMNIENG_PLANT_PROJECT');
    this.pipelineRef = assertStringValue(options.pipelineRef, 'pipelineRef', 'LINE-1001');
    this.unitsBore = assertStringValue(options.unitsBore, 'unitsBore', 'MM');
    this.unitsCoords = assertStringValue(options.unitsCoords, 'unitsCoords', 'MM');
    this.unitsPressure = assertStringValue(options.unitsPressure, 'unitsPressure', 'BAR');
    this.unitsTemperature = assertStringValue(options.unitsTemperature, 'unitsTemperature', 'C');
    this.unitsWeight = assertStringValue(options.unitsWeight, 'unitsWeight', 'KG');
    this.unitsDim = assertStringValue(options.unitsDim, 'unitsDim', 'MM');
    // Optional ISOGEN driver-file directive. It is a top-level token outside any
    // section, so it is emitted only when an ISOGEN consumer explicitly asks for it.
    this.isogenHeader = options.isogenHeader === true;
  }

  _section(lines, name, body) {
    lines.push(name);
    for (const line of body) {
      lines.push(`  ${line}`);
    }
    lines.push('END');
    lines.push('');
  }

  _componentRecords(comp, index) {
    const lines = [];
    const id = index + 1;
    const type = comp.type;
    const skey = pick(comp, ['skey', 'skKey', 'key']);
    const ref = pick(comp, ['ref', 'reference']);
    lines.push('HDR');
    lines.push(`ELEM ${type}`);
    lines.push(`COMP ${id}`);
    if (ref !== undefined) lines.push(`REF ${assertStringValue(ref, 'ref')}`);
    if (skey !== undefined) lines.push(`SKEY ${assertStringValue(skey, 'skey')}`);
    lines.push('END');

    lines.push('DATA');
    lines.push(`COMP ${id}`);
    if (comp.position !== undefined) {
      const pos = assertCoords(comp.position, 'position');
      lines.push(`POSITION ${pos[0]} ${pos[1]} ${pos[2]}`);
    }
    const orient = pick(comp, ['orientation', 'orient']);
    if (orient !== undefined) {
      const o = assertCoords(orient, 'orientation');
      lines.push(`ORIENTATION ${o[0]} ${o[1]} ${o[2]}`);
    }
    if (comp.ep1 !== undefined || comp.end1 !== undefined) {
      const ep = assertCoords(comp.ep1 !== undefined ? comp.ep1 : comp.end1, 'ep1');
      lines.push(`END-POINT ${ep[0]} ${ep[1]} ${ep[2]}`);
    }
    if (comp.ep2 !== undefined || comp.end2 !== undefined) {
      const ep = assertCoords(comp.ep2 !== undefined ? comp.ep2 : comp.end2, 'ep2');
      lines.push(`END-POINT ${ep[0]} ${ep[1]} ${ep[2]}`);
    }
    if (comp.centre !== undefined || comp.cp !== undefined) {
      const c = assertCoords(comp.centre !== undefined ? comp.centre : comp.cp, 'centre');
      lines.push(`CENTRE-POINT ${c[0]} ${c[1]} ${c[2]}`);
    }
    if (comp.bp !== undefined) {
      const b = assertCoords(comp.bp, 'bp');
      lines.push(`BRANCH-POINT ${b[0]} ${b[1]} ${b[2]}`);
    }
    const nps = pick(comp, ['nps', 'nominalSize', 'dn']);
    if (nps !== undefined) lines.push(`NOMINAL-SIZE ${fmtNumber(nps, 'nps')}`);
    if (type === 'ELBOW') {
      const radius = pick(comp, ['radius', 'bendRadius']);
      if (radius !== undefined) lines.push(`BEND-RADIUS ${fmtNumber(radius, 'radius')}`);
      const angle = pick(comp, ['angleDeg', 'angle']);
      if (angle !== undefined) lines.push(`ANGLE ${fmtNumber(angle, 'angle')}`);
    }
    lines.push('END');

    lines.push('ATTR');
    lines.push(`COMP ${id}`);
    const t = pick(comp, ['t', 'wallThickness', 'wallThk']);
    if (t !== undefined) lines.push(`WALL-THICKNESS ${fmtNumber(t, 'wallThickness')}`);
    const endPrep = pick(comp, ['endPrep', 'endPreparation', 'connection', 'prep']);
    if (endPrep !== undefined) {
      const prep = assertStringValue(endPrep, 'endPrep').toUpperCase();
      if (!VALID_END_PREPS.includes(prep)) {
        throw new TypeError(
          `PCF export: invalid end preparation ${JSON.stringify(prep)}, expected one of ${VALID_END_PREPS.join('/')}`
        );
      }
      lines.push(`END-PREPARATION ${prep}`);
    }
    const material = pick(comp, ['material', 'materialGrade', 'grade']);
    if (material !== undefined) lines.push(`MATERIAL ${assertStringValue(material, 'material')}`);
    const spec = pick(comp, ['spec', 'specification', 'specCode']);
    if (spec !== undefined) lines.push(`SPECIFICATION ${assertStringValue(spec, 'spec')}`);
    const itemCode = pick(comp, ['itemCode', 'item']);
    if (itemCode !== undefined) lines.push(`ITEM-CODE ${assertStringValue(itemCode, 'itemCode')}`);
    if (type === 'FLANGE') {
      const rating = pick(comp, ['rating', 'pressureClass']);
      if (rating !== undefined) lines.push(`RATING ${assertStringValue(rating, 'rating')}`);
      const face = pick(comp, ['face', 'flangeFace']);
      if (face !== undefined) lines.push(`FLANGE-FACE ${assertStringValue(face, 'face')}`);
    }
    if (type === 'VALVE') {
      const valveType = pick(comp, ['valveType', 'style']);
      if (valveType !== undefined) lines.push(`VALVE-TYPE ${assertStringValue(valveType, 'valveType')}`);
    }
    if (type === 'WELD') {
      const weldType = pick(comp, ['weldType', 'kind']);
      if (weldType !== undefined) lines.push(`WELD-TYPE ${assertStringValue(weldType, 'weldType')}`);
    }
    lines.push('END');
    return lines;
  }

  _nodeRecords(components) {
    const n = components.length;
    if (n === 0) return [];
    const lines = ['NODE'];
    for (let i = 0; i < n; i++) {
      const start = i === 0 ? 1 : i + 1;
      const end = i + 2;
      lines.push(`  NODE ${start} ${i + 1} START`);
      lines.push(`  NODE ${end} ${i + 1} END`);
    }
    lines.push('END');
    lines.push('');
    return lines;
  }

  /**
   * Generate a PCF document from an ordered list of spool components.
   * Components are assumed to be ordered along the spool; consecutive
   * components share node numbers in the NODE section.
   *
   * Each component must be an object with:
   *   type      (required) one of COMPONENT_TYPES
   *   position  (required) [x, y, z] or {x, y, z}
   *   orientation (optional) direction vector
   *   ep1/ep2, centre/cp, bp (optional) named geometry points
   *   nps, t, endPrep, material, spec, skey, itemCode
   *   radius, angleDeg (ELBOW); rating, face (FLANGE);
   *   valveType (VALVE); weldType (WELD)
   */
  exportPCF(components = []) {
    if (!Array.isArray(components)) {
      throw new TypeError('PCF export: components must be an array');
    }
    const lines = [];
    if (this.isogenHeader) lines.push('ISOGEN-FILES ISOGEN.FLS');
    this._section(lines, 'UNITS', [
      `BORE ${this.unitsBore}`,
      `CO-ORDS ${this.unitsCoords}`,
      `PRESSURE ${this.unitsPressure}`,
      `TEMPERATURE ${this.unitsTemperature}`,
      `WEIGHT ${this.unitsWeight}`,
      `DIMENSIONS ${this.unitsDim}`
    ]);
    this._section(lines, 'TEXT', [`TITLE ${this.projectName}`, `PIPELINE-REFERENCE ${this.pipelineRef}`]);
    components.forEach((comp, index) => {
      if (!comp || typeof comp !== 'object') {
        throw new TypeError(`PCF export: components[${index}] must be an object`);
      }
      let type = pick(comp, ['type', 'kind']);
      if (type === undefined || type === null) {
        throw new TypeError(`PCF export: components[${index}] is missing a type`);
      }
      type = assertStringValue(type, 'type').toUpperCase();
      if (!COMPONENT_TYPES.includes(type)) {
        throw new TypeError(
          `PCF export: invalid component type ${JSON.stringify(type)} at index ${index}, expected one of ${COMPONENT_TYPES.join('/')}`
        );
      }
      const normalized = Object.assign({}, comp, { type });
      if (
        normalized.position === undefined &&
        normalized.ep1 === undefined &&
        normalized.end1 === undefined &&
        normalized.centre === undefined &&
        normalized.cp === undefined
      ) {
        throw new TypeError(
          `PCF export: components[${index}] (${type}) is missing coordinates (position or endpoint/centre point)`
        );
      }
      for (const line of this._componentRecords(normalized, index)) {
        lines.push(line);
      }
      lines.push('');
    });
    lines.push(...this._nodeRecords(components));
    return (
      lines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim() + '\n'
    );
  }
}

/**
 * Convenience wrapper.
 * @returns {string} PCF document
 */
function exportPCF(components, options) {
  return new PCFExporter(options).exportPCF(components);
}

module.exports = {
  PCFExporter,
  exportPCF,
  COMPONENT_TYPES,
  VALID_END_PREPS
};
