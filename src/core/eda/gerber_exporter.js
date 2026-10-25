/**
 * Experimental Gerber RS-274X and Excellon exporter.
 * Manufacturing compatibility has not been independently verified.
 */

'use strict';

class GerberExporter {
  static formatCoord(valMm) {
    if (!Number.isFinite(valMm) || Math.abs(valMm) >= 1000) {
      throw new TypeError('Gerber coordinates must be finite and have magnitude below 1000 mm.');
    }
    const scaled = Math.round(valMm * 100000);
    const sign = scaled < 0 ? '-' : '';
    return `${sign}${Math.abs(scaled).toString().padStart(8, '0')}`;
  }

  static getGerberHeader(layerName) {
    if (typeof layerName !== 'string' || layerName.trim() === '') {
      throw new TypeError('A non-empty Gerber layer name is required.');
    }
    return [
      `G04 Layer: ${layerName}*`,
      'G04 Created by OmniEng experimental EDA exporter*',
      '%FSLAX35Y35*%',
      '%MOMM*%',
      '%IPPOS*%',
      '%LPD*%'
    ];
  }

  static requireLayoutRecord(layout) {
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
      throw new TypeError('An explicit PCB layout object is required.');
    }
    return layout;
  }

  static requireArray(layout, name) {
    if (!Object.hasOwn(layout, name) || !Array.isArray(layout[name])) {
      throw new TypeError(`An explicit ${name} array is required.`);
    }
    if (layout[name].length > 10000) throw new RangeError(`${name} may contain at most 10,000 records.`);
    return layout[name];
  }

  static requireTraceArray(layout) {
    if (Object.hasOwn(layout, 'traces')) return this.requireArray(layout, 'traces');
    if (Object.hasOwn(layout, 'tracks')) return this.requireArray(layout, 'tracks');
    throw new TypeError('An explicit traces array is required.');
  }

  static requireCoordinate(record, key, label) {
    if (!record || !Number.isFinite(record[key])) {
      throw new TypeError(`${label} requires a finite ${key} coordinate in millimeters.`);
    }
    return record[key];
  }

  static positive(value, label) {
    if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be a positive millimeter value.`);
    return value;
  }

  static normalizeAperture(shape, label) {
    if (!shape || typeof shape !== 'object' || Array.isArray(shape)) {
      throw new TypeError(`${label} must be an object.`);
    }
    const kind = String(shape.shape ?? shape.type ?? '').toUpperCase();
    if (['CIRCLE', 'CIRCULAR', 'ROUND'].includes(kind)) {
      const diameter = shape.diameterMm ?? shape.diameter ?? shape.widthMm ?? shape.width;
      return { kind: 'C', width: this.positive(diameter, `${label} diameter`), height: diameter };
    }
    if (['RECT', 'RECTANGLE', 'RECTANGULAR'].includes(kind)) {
      return {
        kind: 'R',
        width: this.positive(shape.widthMm ?? shape.width, `${label} width`),
        height: this.positive(shape.heightMm ?? shape.height, `${label} height`)
      };
    }
    throw new TypeError(`${label} shape must be CIRCLE or RECT.`);
  }

  static registerAperture(registry, shape) {
    const key = `${shape.kind}:${shape.width}:${shape.height}`;
    if (registry.has(key)) return registry.get(key).code;
    const code = 10 + registry.size;
    const width = shape.width.toFixed(6);
    const definition =
      shape.kind === 'C' ? `%ADD${code}C,${width}*%` : `%ADD${code}R,${width}X${shape.height.toFixed(6)}*%`;
    registry.set(key, { code, definition });
    return code;
  }

  static apertureDefinitions(registry) {
    return [...registry.values()].map((aperture) => aperture.definition);
  }

  static exportTopCopper(layout) {
    this.requireLayoutRecord(layout);
    const traces = this.requireTraceArray(layout);
    const pads = this.requireArray(layout, 'pads');
    const vias = this.requireArray(layout, 'vias');
    if (traces.length + pads.length + vias.length === 0) {
      throw new TypeError('At least one caller-supplied trace, pad, or via is required.');
    }

    const registry = new Map();
    const normalizedTraces = traces.map((trace) => {
      if (!trace || typeof trace !== 'object' || Array.isArray(trace))
        throw new TypeError('Each trace must be an object.');
      const width = this.positive(trace.widthMm ?? trace.width, 'Trace width');
      const code = this.registerAperture(registry, { kind: 'C', width, height: width });
      return {
        code,
        x1: this.formatCoord(this.requireCoordinate(trace, 'x1', 'Trace')),
        y1: this.formatCoord(this.requireCoordinate(trace, 'y1', 'Trace')),
        x2: this.formatCoord(this.requireCoordinate(trace, 'x2', 'Trace')),
        y2: this.formatCoord(this.requireCoordinate(trace, 'y2', 'Trace'))
      };
    });
    const normalizedPads = pads.map((pad) => {
      const code = this.registerAperture(registry, this.normalizeAperture(pad, 'Copper pad'));
      return {
        code,
        x: this.formatCoord(this.requireCoordinate(pad, 'x', 'Copper pad')),
        y: this.formatCoord(this.requireCoordinate(pad, 'y', 'Copper pad'))
      };
    });
    const normalizedVias = vias.map((via) => {
      if (!via || typeof via !== 'object' || Array.isArray(via)) throw new TypeError('Each via must be an object.');
      const diameter = this.positive(via.outerDiameterMm ?? via.diameterMm, 'Via outer diameter');
      const code = this.registerAperture(registry, { kind: 'C', width: diameter, height: diameter });
      return {
        code,
        x: this.formatCoord(this.requireCoordinate(via, 'x', 'Via')),
        y: this.formatCoord(this.requireCoordinate(via, 'y', 'Via'))
      };
    });

    const lines = [...this.getGerberHeader('Top_Copper_GTL'), ...this.apertureDefinitions(registry), 'G01*'];
    for (const trace of normalizedTraces) {
      lines.push(`D${trace.code}*`, `X${trace.x1}Y${trace.y1}D02*`, `X${trace.x2}Y${trace.y2}D01*`);
    }
    for (const pad of normalizedPads) lines.push(`D${pad.code}*`, `X${pad.x}Y${pad.y}D03*`);
    for (const via of normalizedVias) lines.push(`D${via.code}*`, `X${via.x}Y${via.y}D03*`);
    lines.push('M02*');
    return lines.join('\n');
  }

  static exportSolderMask(layout) {
    this.requireLayoutRecord(layout);
    const openings = this.requireArray(layout, 'solderMaskOpenings');
    const registry = new Map();
    const normalized = openings.map((opening) => {
      const code = this.registerAperture(registry, this.normalizeAperture(opening, 'Solder-mask opening'));
      return {
        code,
        x: this.formatCoord(this.requireCoordinate(opening, 'x', 'Solder-mask opening')),
        y: this.formatCoord(this.requireCoordinate(opening, 'y', 'Solder-mask opening'))
      };
    });
    const lines = [...this.getGerberHeader('Top_Solder_Mask_GTS'), ...this.apertureDefinitions(registry)];
    for (const opening of normalized) lines.push(`D${opening.code}*`, `X${opening.x}Y${opening.y}D03*`);
    lines.push('M02*');
    return lines.join('\n');
  }

  static exportNCDrill(layout) {
    this.requireLayoutRecord(layout);
    const holes = this.requireArray(layout, 'holes');
    const diameters = [...new Set(holes.map((hole) => hole?.diameterMm ?? hole?.drillMm))].sort((a, b) => a - b);
    if (diameters.some((diameter) => !Number.isFinite(diameter) || diameter <= 0)) {
      throw new TypeError('Each drill hole requires a positive diameterMm value.');
    }
    if (diameters.length > 99) throw new RangeError('At most 99 distinct drill diameters are supported.');
    const toolForDiameter = new Map(
      diameters.map((diameter, index) => [diameter, `T${String(index + 1).padStart(2, '0')}`])
    );
    const normalized = holes.map((hole) => {
      if (!hole || typeof hole !== 'object' || Array.isArray(hole))
        throw new TypeError('Each drill hole must be an object.');
      const diameter = hole.diameterMm ?? hole.drillMm;
      return {
        tool: toolForDiameter.get(diameter),
        x: (this.requireCoordinate(hole, 'x', 'Drill hole') * 1000).toFixed(0).padStart(6, '0'),
        y: (this.requireCoordinate(hole, 'y', 'Drill hole') * 1000).toFixed(0).padStart(6, '0')
      };
    });
    const lines = ['M48', '; OmniEng experimental Excellon drill export', 'METRIC,TZ', 'FMAT,2'];
    diameters.forEach((diameter, index) => lines.push(`T${String(index + 1).padStart(2, '0')}C${diameter.toFixed(3)}`));
    lines.push('%');
    let currentTool;
    for (const hole of normalized) {
      if (hole.tool !== currentTool) {
        currentTool = hole.tool;
        lines.push(currentTool);
      }
      lines.push(`X${hole.x}Y${hole.y}`);
    }
    lines.push('M30');
    return lines.join('\n');
  }

  static exportBoardOutline(layout) {
    this.requireLayoutRecord(layout);
    const outline = layout.boardOutline;
    if (!outline || typeof outline !== 'object' || Array.isArray(outline)) {
      throw new TypeError('An explicit boardOutline object is required.');
    }
    const width = this.positive(outline.outlineWidthMm, 'Board outline width');
    let points = outline.points;
    if (!Array.isArray(points)) {
      const bounds = [outline.xMin, outline.yMin, outline.xMax, outline.yMax];
      if (!bounds.every(Number.isFinite) || outline.xMax <= outline.xMin || outline.yMax <= outline.yMin) {
        throw new TypeError('boardOutline requires points or finite increasing xMin/yMin/xMax/yMax bounds.');
      }
      points = [
        { x: outline.xMin, y: outline.yMin },
        { x: outline.xMax, y: outline.yMin },
        { x: outline.xMax, y: outline.yMax },
        { x: outline.xMin, y: outline.yMax }
      ];
    }
    if (points.length < 3) throw new TypeError('boardOutline.points requires at least three vertices.');
    const normalized = points.map((point) => ({
      x: this.formatCoord(this.requireCoordinate(point, 'x', 'Board outline vertex')),
      y: this.formatCoord(this.requireCoordinate(point, 'y', 'Board outline vertex'))
    }));
    const lines = [
      ...this.getGerberHeader('Board_Outline_GKO'),
      `%ADD10C,${width.toFixed(6)}*%`,
      'D10*',
      'G01*',
      `X${normalized[0].x}Y${normalized[0].y}D02*`
    ];
    for (let index = 1; index < normalized.length; index++) {
      lines.push(`X${normalized[index].x}Y${normalized[index].y}D01*`);
    }
    lines.push(`X${normalized[0].x}Y${normalized[0].y}D01*`, 'M02*');
    return lines.join('\n');
  }

  static generateManufacturingPackage(layout) {
    this.requireLayoutRecord(layout);
    this.requireTraceArray(layout);
    for (const key of ['pads', 'vias', 'solderMaskOpenings', 'holes']) this.requireArray(layout, key);
    const files = {
      'TopCopper.gtl': this.exportTopCopper(layout),
      'SolderMask.gts': this.exportSolderMask(layout),
      'Drill.drl': this.exportNCDrill(layout),
      'BoardOutline.gko': this.exportBoardOutline(layout)
    };
    return {
      files,
      topCopper_GTL: files['TopCopper.gtl'],
      solderMask_GTS: files['SolderMask.gts'],
      ncDrill_NC: files['Drill.drl'],
      boardOutline_GKO: files['BoardOutline.gko'],
      topCopper: files['TopCopper.gtl'],
      solderMaskTop: files['SolderMask.gts'],
      solderMask: files['SolderMask.gts'],
      drill: files['Drill.drl'],
      drillFile: files['Drill.drl'],
      'TopCopper.gtl': files['TopCopper.gtl'],
      'SolderMask.gts': files['SolderMask.gts'],
      'Drill.drl': files['Drill.drl'],
      'BoardOutline.gko': files['BoardOutline.gko']
    };
  }

  static exportPackage(layout) {
    return this.generateManufacturingPackage(layout);
  }

  static generatePackage(layout) {
    return this.generateManufacturingPackage(layout);
  }

  exportPackage(layout) {
    return GerberExporter.generateManufacturingPackage(layout);
  }

  generateManufacturingPackage(layout) {
    return GerberExporter.generateManufacturingPackage(layout);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GerberExporter };
}
