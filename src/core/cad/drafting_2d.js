/**
 * Experimental 2D drawing and dimension-label helpers. Complete ISO/ASME
 * drafting or GD&T conformance and independent geometric validation are not
 * established.
 */

const { Vector3 } = require('../math/linear_algebra');

function escapeXmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

class FeatureControlFrame {
  /**
   * @param {Object} spec
   * @param {string} spec.characteristic - 'POSITION', 'FLATNESS', 'PERPENDICULARITY', 'PARALLELISM', 'CONCENTRICITY', 'RUNOUT', 'CYLINDRICITY'
   * @param {number|string} spec.tolerance - Tolerance value (e.g. 0.05, '0.02')
   * @param {boolean} [spec.diameter=false] - Prepend diameter symbol (⌀)
   * @param {string} [spec.modifier=null] - Material condition modifier: 'M' (MMC), 'L' (LMC), 'S' (RFS)
   * @param {string} [spec.datumPrimary=null] - Primary datum reference (e.g. 'A')
   * @param {string} [spec.datumSecondary=null] - Secondary datum reference (e.g. 'B')
   * @param {string} [spec.datumTertiary=null] - Tertiary datum reference (e.g. 'C')
   */
  constructor(spec = {}) {
    this.characteristic = (spec.characteristic || 'POSITION').toUpperCase();
    this.tolerance = spec.tolerance !== undefined ? spec.tolerance : 0.05;
    this.diameter = !!spec.diameter;
    this.modifier = spec.modifier || null;
    this.datumPrimary = spec.datumPrimary || null;
    this.datumSecondary = spec.datumSecondary || null;
    this.datumTertiary = spec.datumTertiary || null;
  }

  /**
   * Returns standard unicode symbol for the geometric characteristic.
   */
  getSymbol() {
    const symbols = {
      POSITION: '⌖',
      FLATNESS: '⏥',
      PERPENDICULARITY: '⟂',
      PARALLELISM: '//',
      CONCENTRICITY: '◎',
      RUNOUT: '↗',
      TOTAL_RUNOUT: '⌰',
      CYLINDRICITY: '⌭',
      STRAIGHTNESS: '—',
      CIRCULARITY: '○'
    };
    return symbols[this.characteristic] || '⌖';
  }

  getModifierSymbol(mod) {
    if (mod === 'M') return 'Ⓜ';
    if (mod === 'L') return 'Ⓛ';
    if (mod === 'S') return 'Ⓢ';
    return '';
  }

  /**
   * Formats into text representation: | ⌖ | ⌀0.05 Ⓜ | A | B | C |
   */
  toString() {
    const sym = this.getSymbol();
    const tolStr =
      (this.diameter ? '⌀' : '') + this.tolerance + (this.modifier ? ' ' + this.getModifierSymbol(this.modifier) : '');
    const compartments = [sym, tolStr];
    if (this.datumPrimary) compartments.push(this.datumPrimary);
    if (this.datumSecondary) compartments.push(this.datumSecondary);
    if (this.datumTertiary) compartments.push(this.datumTertiary);
    return `[ ${compartments.join(' | ')} ]`;
  }

  /**
   * Generates SVG XML element for this Feature Control Frame.
   */
  toSVG(x, y, height = 24) {
    const sym = this.getSymbol();
    const tolStr =
      (this.diameter ? '⌀' : '') + this.tolerance + (this.modifier ? ' ' + this.getModifierSymbol(this.modifier) : '');
    const boxes = [
      { text: sym, width: 28 },
      { text: tolStr, width: 56 }
    ];
    if (this.datumPrimary) boxes.push({ text: this.datumPrimary, width: 24 });
    if (this.datumSecondary) boxes.push({ text: this.datumSecondary, width: 24 });
    if (this.datumTertiary) boxes.push({ text: this.datumTertiary, width: 24 });

    let curX = x;
    let svg = `<g class="gdt-fcf" font-family="monospace" font-size="${height * 0.55}">`;
    for (const b of boxes) {
      svg += `<rect x="${curX}" y="${y}" width="${b.width}" height="${height}" fill="#0f172a" stroke="#38bdf8" stroke-width="1.2"/>`;
      svg += `<text x="${curX + b.width / 2}" y="${y + height * 0.7}" text-anchor="middle" fill="#e0f2fe">${escapeXmlText(b.text)}</text>`;
      curX += b.width;
    }
    svg += '</g>';
    return { svg, totalWidth: curX - x, height };
  }
}

class DraftingEngine2D {
  /**
   * Projects a 3D solid body onto a 2D orthographic view plane.
   * Classifies edges into VISIBLE (solid) or HIDDEN (dashed) via normal analysis.
   * @param {SolidBody} solid
   * @param {string} [viewType='FRONT'] - 'FRONT', 'TOP', 'RIGHT', 'ISOMETRIC'
   * @returns {{ lines: Array<{ p1: [number, number], p2: [number, number], type: 'VISIBLE'|'HIDDEN' }>, bounds: Object }}
   */
  static projectOrthographic(solid, viewType = 'FRONT') {
    if (!solid.edges || solid.edges.length === 0) {
      if (typeof solid.buildEdges === 'function') solid.buildEdges();
    }

    const viewDir = DraftingEngine2D._getViewDirection(viewType);
    const lines = [];

    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;

    for (const edge of solid.edges) {
      const p1_3d = edge.start.point;
      const p2_3d = edge.end.point;

      const p1_2d = DraftingEngine2D._projectPoint(p1_3d, viewType);
      const p2_2d = DraftingEngine2D._projectPoint(p2_3d, viewType);

      // Determine visibility by testing adjacent face normals
      const adjFaces = solid.faces.filter(
        (f) =>
          f.vertices.some((v) => v.point.distanceTo(p1_3d) < 1e-4) &&
          f.vertices.some((v) => v.point.distanceTo(p2_3d) < 1e-4)
      );

      let isVisible = false;
      if (adjFaces.length === 0) {
        isVisible = true; // Silhouette/wireframe default
      } else {
        // If at least one adjacent face faces the viewer, it's a visible silhouette or front edge
        for (const f of adjFaces) {
          const n = f.normal || f.computeNormal();
          if (n.dot(viewDir) > 0.05) {
            isVisible = true;
            break;
          }
        }
      }

      const type = isVisible ? 'VISIBLE' : 'HIDDEN';
      lines.push({ p1: p1_2d, p2: p2_2d, type });

      minX = Math.min(minX, p1_2d[0], p2_2d[0]);
      maxX = Math.max(maxX, p1_2d[0], p2_2d[0]);
      minY = Math.min(minY, p1_2d[1], p2_2d[1]);
      maxY = Math.max(maxY, p1_2d[1], p2_2d[1]);
    }

    return {
      viewType,
      lines,
      bounds: { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY }
    };
  }

  static _getViewDirection(viewType) {
    switch (viewType.toUpperCase()) {
      case 'FRONT':
        return new Vector3(0, 0, 1);
      case 'TOP':
        return new Vector3(0, 1, 0);
      case 'RIGHT':
        return new Vector3(1, 0, 0);
      case 'ISOMETRIC':
        return new Vector3(1, 1, 1).normalize();
      default:
        return new Vector3(0, 0, 1);
    }
  }

  static _projectPoint(p3d, viewType) {
    switch (viewType.toUpperCase()) {
      case 'FRONT':
        return [p3d.x, p3d.y];
      case 'TOP':
        return [p3d.x, -p3d.z];
      case 'RIGHT':
        return [p3d.z, p3d.y];
      case 'ISOMETRIC': {
        // Standard 30 degree axonometric projection
        const cos30 = Math.cos(Math.PI / 6);
        const sin30 = Math.sin(Math.PI / 6);
        const isoX = (p3d.x - p3d.y) * cos30;
        const isoY = p3d.z + (p3d.x + p3d.y) * sin30;
        return [isoX, isoY];
      }
      default:
        return [p3d.x, p3d.y];
    }
  }

  /**
   * Generates a complete 4-view drawing sheet in standard SVG format with title block.
   * Layout:
   *  [TOP VIEW]      [ISOMETRIC VIEW]
   *  [FRONT VIEW]    [RIGHT VIEW]
   */
  static generateDrawingSheet(solid, options = {}) {
    const {
      title = solid.name || 'OmniEng Part',
      partNumber = 'OE-DWG-001',
      scale = '1:1',
      sheetWidth = 1200,
      sheetHeight = 850,
      gdtSpecs = []
    } = options;

    const front = DraftingEngine2D.projectOrthographic(solid, 'FRONT');
    const top = DraftingEngine2D.projectOrthographic(solid, 'TOP');
    const right = DraftingEngine2D.projectOrthographic(solid, 'RIGHT');
    const iso = DraftingEngine2D.projectOrthographic(solid, 'ISOMETRIC');

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheetWidth} ${sheetHeight}" width="100%" height="100%" style="background-color: #020617;">\n`;
    svg += `<defs>\n`;
    svg += `  <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
    svg += `    <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />\n`;
    svg += `  </marker>\n`;
    svg += `</defs>\n`;

    // Outer sheet border & title block grid
    svg += `<rect x="20" y="20" width="${sheetWidth - 40}" height="${sheetHeight - 40}" fill="none" stroke="#1e293b" stroke-width="2"/>\n`;
    svg += `<rect x="25" y="25" width="${sheetWidth - 50}" height="${sheetHeight - 50}" fill="none" stroke="#334155" stroke-width="1"/>\n`;

    // Render 4 Quadrants
    const viewWidth = 500;
    const viewHeight = 350;

    // Top view: (x: 80, y: 80)
    svg += DraftingEngine2D._renderViewSVG(top, 100, 80, viewWidth, viewHeight, 'TOP VIEW (FIRST ANGLE)');
    // Isometric view: (x: 650, y: 80)
    svg += DraftingEngine2D._renderViewSVG(iso, 680, 80, viewWidth, viewHeight, 'ISOMETRIC VIEW');
    // Front view: (x: 80, y: 440)
    svg += DraftingEngine2D._renderViewSVG(front, 100, 440, viewWidth, viewHeight, 'FRONT VIEW');
    // Right view: (x: 650, y: 440)
    svg += DraftingEngine2D._renderViewSVG(right, 680, 440, viewWidth, viewHeight, 'RIGHT VIEW');

    // Title Block (Lower Right)
    const tbX = sheetWidth - 380;
    const tbY = sheetHeight - 140;
    svg += `<g class="title-block" font-family="sans-serif">\n`;
    svg += `  <rect x="${tbX}" y="${tbY}" width="350" height="110" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5"/>\n`;
    svg += `  <line x1="${tbX}" y1="${tbY + 35}" x2="${tbX + 350}" y2="${tbY + 35}" stroke="#334155" stroke-width="1"/>\n`;
    svg += `  <line x1="${tbX}" y1="${tbY + 70}" x2="${tbX + 350}" y2="${tbY + 70}" stroke="#334155" stroke-width="1"/>\n`;
    svg += `  <line x1="${tbX + 175}" y1="${tbY + 35}" x2="${tbX + 175}" y2="${tbY + 110}" stroke="#334155" stroke-width="1"/>\n`;

    svg += `  <text x="${tbX + 12}" y="${tbY + 24}" fill="#38bdf8" font-size="14" font-weight="bold">OMNIENG EXPERIMENTAL DRAWING</text>\n`;
    svg += `  <text x="${tbX + 12}" y="${tbY + 54}" fill="#94a3b8" font-size="10">PART NAME:</text>\n`;
    svg += `  <text x="${tbX + 12}" y="${tbY + 65}" fill="#f8fafc" font-size="11" font-weight="bold">${escapeXmlText(title)}</text>\n`;
    svg += `  <text x="${tbX + 190}" y="${tbY + 54}" fill="#94a3b8" font-size="10">DWG NO:</text>\n`;
    svg += `  <text x="${tbX + 190}" y="${tbY + 65}" fill="#38bdf8" font-size="11" font-weight="bold">${escapeXmlText(partNumber)}</text>\n`;
    svg += `  <text x="${tbX + 12}" y="${tbY + 90}" fill="#94a3b8" font-size="10">SCALE: ${escapeXmlText(scale)}</text>\n`;
    svg += `  <text x="${tbX + 190}" y="${tbY + 90}" fill="#94a3b8" font-size="10">Experimental sample; standards unchecked</text>\n`;
    svg += `</g>\n`;

    // Render GD&T Feature Control Frames
    let fcfY = sheetHeight - 130;
    for (const spec of gdtSpecs) {
      const fcf = new FeatureControlFrame(spec);
      const res = fcf.toSVG(100, fcfY, 26);
      svg += res.svg + '\n';
      fcfY += 34;
    }

    svg += `</svg>`;
    return {
      svg,
      sheetWidth,
      sheetHeight,
      views: { front, top, right, iso }
    };
  }

  static _renderViewSVG(viewData, cx, cy, boxW, boxH, label) {
    const { lines, bounds } = viewData;
    let svg = `<g class="view-${viewData.viewType.toLowerCase()}">\n`;

    // View title label
    svg += `  <text x="${cx}" y="${cy}" fill="#64748b" font-family="sans-serif" font-size="12" font-weight="bold">${escapeXmlText(label)}</text>\n`;

    const spanX = Math.max(1e-4, bounds.width);
    const spanY = Math.max(1e-4, bounds.height);
    const scaleFactor = Math.min((boxW * 0.7) / spanX, (boxH * 0.7) / spanY);

    const midX = (bounds.minX + bounds.maxX) / 2;
    const midY = (bounds.minY + bounds.maxY) / 2;
    const targetCX = cx + boxW / 2;
    const targetCY = cy + boxH / 2;

    const toScreen = (p) => {
      const sx = targetCX + (p[0] - midX) * scaleFactor;
      const sy = targetCY - (p[1] - midY) * scaleFactor; // Invert Y for screen coordinates
      return [sx.toFixed(1), sy.toFixed(1)];
    };

    for (const line of lines) {
      const [x1, y1] = toScreen(line.p1);
      const [x2, y2] = toScreen(line.p2);

      if (line.type === 'VISIBLE') {
        svg += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/>\n`;
      } else {
        svg += `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#475569" stroke-width="1.2" stroke-dasharray="5,4"/>\n`;
      }
    }

    svg += `</g>\n`;
    return svg;
  }
}

module.exports = {
  FeatureControlFrame,
  DraftingEngine2D
};
