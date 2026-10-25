/**
 * Experimental standard-cell library adapter.
 *
 * It preserves the LEF writer and RC delay estimate for explicitly supplied
 * library records. It bundles no SkyWater PDK data or timing corners.
 */

'use strict';

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an explicit object.`);
  }
  return value;
}

function requirePositiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be a finite positive number.`);
}

function validateLibraryData(library) {
  requireRecord(library, 'A standard-cell library');
  if (typeof library.libraryName !== 'string' || library.libraryName.trim() === '') {
    throw new TypeError('A standard-cell library requires an explicit libraryName.');
  }
  if (
    library.processName !== undefined &&
    (typeof library.processName !== 'string' || library.processName.trim() === '')
  ) {
    throw new TypeError('processName must be a non-empty string when supplied.');
  }
  for (const field of ['techNodeNm', 'siteHeightUm', 'siteWidthUm']) {
    if (library[field] !== undefined && library[field] !== null) requirePositiveFinite(library[field], field);
  }
  const provenance = requireRecord(library.provenance, 'Library provenance');
  for (const field of ['source', 'license']) {
    if (typeof provenance[field] !== 'string' || provenance[field].trim() === '') {
      throw new TypeError(`Library provenance requires a non-empty ${field} label.`);
    }
  }

  const layers = requireRecord(library.layers, 'Library layers');
  const cells = requireRecord(library.cells, 'Library cells');
  const cornerDerates = requireRecord(library.cornerDerates, 'Library corner derates');
  if (Object.keys(layers).length === 0 || Object.keys(cells).length === 0 || Object.keys(cornerDerates).length === 0) {
    throw new RangeError('A standard-cell library requires at least one layer, cell, and timing corner.');
  }

  for (const [key, layer] of Object.entries(layers)) {
    requireRecord(layer, `Layer '${key}'`);
    if (layer.name !== key) throw new TypeError(`Layer '${key}' must explicitly identify the same layer name.`);
    if (!['ROUTING', 'CUT', 'MASTERSLICE', 'OVERLAP'].includes(layer.type)) {
      throw new TypeError(`Layer '${key}' requires an explicit supported LEF type.`);
    }
    requirePositiveFinite(layer.pitchUm, `Layer '${key}' pitchUm`);
    requirePositiveFinite(layer.minWidthUm, `Layer '${key}' minWidthUm`);
  }

  for (const [key, cell] of Object.entries(cells)) {
    requireRecord(cell, `Cell '${key}'`);
    if (cell.name !== key) throw new TypeError(`Cell '${key}' must explicitly identify the same cell name.`);
    if (typeof cell.class !== 'string' || cell.class.trim() === '') {
      throw new TypeError(`Cell '${key}' requires an explicit LEF class.`);
    }
    requirePositiveFinite(cell.widthUm, `Cell '${key}' widthUm`);
    requirePositiveFinite(cell.heightUm, `Cell '${key}' heightUm`);
    const pins = requireRecord(cell.pins, `Cell '${key}' pins`);
    const timing = requireRecord(cell.timing, `Cell '${key}' timing`);
    if (Object.keys(pins).length === 0) throw new RangeError(`Cell '${key}' requires at least one pin.`);
    if (!Number.isFinite(timing.baseDelayPs) || timing.baseDelayPs < 0) {
      throw new TypeError(`Cell '${key}' baseDelayPs must be finite and non-negative.`);
    }
    if (!Number.isFinite(timing.driveResOhm) || timing.driveResOhm < 0) {
      throw new TypeError(`Cell '${key}' driveResOhm must be finite and non-negative.`);
    }
    for (const [pinName, pin] of Object.entries(pins)) {
      requireRecord(pin, `Cell '${key}' pin '${pinName}'`);
      if (pin.name !== pinName || !['INPUT', 'OUTPUT', 'INOUT'].includes(pin.direction)) {
        throw new TypeError(`Cell '${key}' pin '${pinName}' requires an explicit name and valid direction.`);
      }
      if (typeof pin.layer !== 'string' || !Object.hasOwn(layers, pin.layer)) {
        throw new TypeError(`Cell '${key}' pin '${pinName}' references an unknown layer.`);
      }
      if (!['SIGNAL', 'POWER', 'GROUND', 'CLOCK', 'TIEOFF', 'ANALOG'].includes(pin.use)) {
        throw new TypeError(`Cell '${key}' pin '${pinName}' requires an explicit supported LEF use.`);
      }
      if (!Array.isArray(pin.offsetUm) || pin.offsetUm.length !== 2 || !pin.offsetUm.every(Number.isFinite)) {
        throw new TypeError(`Cell '${key}' pin '${pinName}' requires a two-coordinate offsetUm.`);
      }
      if (
        pin.offsetUm[0] < 0 ||
        pin.offsetUm[1] < 0 ||
        pin.offsetUm[0] > cell.widthUm ||
        pin.offsetUm[1] > cell.heightUm
      ) {
        throw new RangeError(`Cell '${key}' pin '${pinName}' offset extends outside the supplied cell dimensions.`);
      }
      if (!Array.isArray(pin.rectUm) || pin.rectUm.length !== 4 || !pin.rectUm.every(Number.isFinite)) {
        throw new TypeError(`Cell '${key}' pin '${pinName}' requires four explicit rectUm coordinates.`);
      }
      const [x1, y1, x2, y2] = pin.rectUm;
      if (x2 <= x1 || y2 <= y1 || x1 < 0 || y1 < 0 || x2 > cell.widthUm || y2 > cell.heightUm) {
        throw new RangeError(
          `Cell '${key}' pin '${pinName}' rectUm must be a positive rectangle inside the supplied cell dimensions.`
        );
      }
    }
  }

  for (const [corner, derate] of Object.entries(cornerDerates)) {
    if (typeof corner !== 'string' || corner.trim() === '')
      throw new TypeError('Timing corner names must be non-empty.');
    requirePositiveFinite(derate, `Timing corner '${corner}' derate`);
  }

  return {
    libraryName: library.libraryName.trim(),
    processName: typeof library.processName === 'string' ? library.processName : null,
    techNodeNm: library.techNodeNm ?? null,
    siteHeightUm: library.siteHeightUm ?? null,
    siteWidthUm: library.siteWidthUm ?? null,
    provenance: { source: provenance.source.trim(), license: provenance.license.trim() },
    layers,
    cells,
    cornerDerates
  };
}

class Sky130PdkAdapter {
  constructor(libraryData) {
    if (libraryData === undefined || libraryData === null) {
      this.libraryName = null;
      this.processName = null;
      this.techNodeNm = null;
      this.siteHeightUm = null;
      this.siteWidthUm = null;
      this.provenance = null;
      this.layers = Object.freeze({});
      this.cells = Object.freeze({});
      this.cornerDerates = Object.freeze({});
      this.available = false;
      this.validationLevel = 'experimental';
      this.dataStatus = 'unavailable';
      return;
    }

    const library = validateLibraryData(libraryData);
    this.libraryName = library.libraryName;
    this.processName = library.processName;
    this.techNodeNm = library.techNodeNm;
    this.siteHeightUm = library.siteHeightUm;
    this.siteWidthUm = library.siteWidthUm;
    this.provenance = library.provenance;
    this.layers = library.layers;
    this.cells = library.cells;
    this.cornerDerates = library.cornerDerates;
    this.available = true;
    this.validationLevel = 'experimental';
    this.dataStatus = 'caller-supplied-unverified';
  }

  /** Generates LEF 5.8 syntax from the explicitly supplied library geometry. */
  generateLEF() {
    if (!this.available) {
      const error = new Error('LEF generation is unavailable until caller-supplied library geometry is provided.');
      error.code = 'UNAVAILABLE';
      throw error;
    }
    const lines = ['VERSION 5.8 ;', 'BUSBITCHARS "[]" ;', 'DIVIDERCHAR "/" ;', ''];

    for (const [name, layer] of Object.entries(this.layers)) {
      lines.push(`LAYER ${name}`);
      lines.push(`  TYPE ${layer.type} ;`);
      lines.push(`  PITCH ${layer.pitchUm.toFixed(3)} ;`);
      lines.push(`  WIDTH ${layer.minWidthUm.toFixed(3)} ;`);
      lines.push(`END ${name}`, '');
    }

    for (const [name, cell] of Object.entries(this.cells)) {
      lines.push(`MACRO ${name}`);
      lines.push(`  CLASS ${cell.class} ;`);
      lines.push('  ORIGIN 0.000 0.000 ;');
      lines.push(`  SIZE ${cell.widthUm.toFixed(3)} BY ${cell.heightUm.toFixed(3)} ;`);

      for (const [pinName, pin] of Object.entries(cell.pins)) {
        lines.push(`  PIN ${pinName}`);
        lines.push(`    DIRECTION ${pin.direction} ;`);
        lines.push(`    USE ${pin.use} ;`);
        lines.push('    PORT');
        lines.push(`      LAYER ${pin.layer} ;`);
        const [x1Um, y1Um, x2Um, y2Um] = pin.rectUm;
        const x1 = x1Um.toFixed(3);
        const y1 = y1Um.toFixed(3);
        const x2 = x2Um.toFixed(3);
        const y2 = y2Um.toFixed(3);
        lines.push(`      RECT ${x1} ${y1} ${x2} ${y2} ;`);
        lines.push('    END');
        lines.push(`  END ${pinName}`);
      }

      lines.push(`END ${name}`, '');
    }

    return lines.join('\n');
  }

  /** Applies an experimental RC delay estimate to caller-supplied cell data. */
  computeCellDelay(cellName, loadCapFf, corner) {
    if (!this.available) {
      const error = new Error('Cell-delay calculation is unavailable until caller-supplied library data is provided.');
      error.code = 'UNAVAILABLE';
      throw error;
    }
    if (typeof cellName !== 'string' || !Object.hasOwn(this.cells, cellName)) {
      throw new RangeError(`Unknown caller-supplied library cell: ${cellName}`);
    }
    if (!Number.isFinite(loadCapFf) || loadCapFf < 0) {
      throw new TypeError('loadCapFf must be a finite, non-negative number supplied in femtofarads.');
    }
    if (typeof corner !== 'string' || !Object.hasOwn(this.cornerDerates, corner)) {
      throw new RangeError('A timing corner configured by the caller is required.');
    }

    const cell = this.cells[cellName];
    const pvtDerate = this.cornerDerates[corner];
    const loadCapF = loadCapFf * 1e-15;
    const loadDependentDelayPs = cell.timing.driveResOhm * loadCapF * 1e12;
    const totalDelayPs = (cell.timing.baseDelayPs + loadDependentDelayPs) * pvtDerate;
    if (![loadDependentDelayPs, totalDelayPs].every(Number.isFinite)) {
      throw new RangeError('Caller-supplied library values produced a non-finite delay estimate.');
    }

    return {
      cellName,
      libraryName: this.libraryName,
      corner,
      loadCapFf,
      baseDelayPs: cell.timing.baseDelayPs * pvtDerate,
      loadDependentDelayPs: loadDependentDelayPs * pvtDerate,
      totalDelayPs: Number(totalDelayPs.toFixed(2)),
      totalDelayNs: Number((totalDelayPs / 1000).toFixed(4)),
      provenance: this.provenance,
      validationLevel: this.validationLevel,
      dataStatus: this.dataStatus,
      model: 'Caller-data-driven base delay plus lumped output resistance and load capacitance estimate'
    };
  }
}

module.exports = { Sky130PdkAdapter, validateLibraryData };
