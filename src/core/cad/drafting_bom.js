/**
 * Automated BOM extraction, quantity roll-up, mass computation, balloon-leader
 * callout generation, and SVG/HTML BOM table rendering for 2D drawings.
 */

'use strict';

const DEFAULT_UNIT = 'kg';

function escapeXmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isLeaf(node) {
  return !Array.isArray(node.children) || node.children.length === 0;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function resolveUnit(node) {
  return typeof node.unit === 'string' && node.unit.length > 0 ? node.unit : DEFAULT_UNIT;
}

function computeNodeMass(node) {
  if (typeof node.unitMass === 'number' && Number.isFinite(node.unitMass)) {
    return node.unitMass;
  }
  let mass = 0;
  if (isLeaf(node)) {
    mass = toNumber(node.volume) * toNumber(node.density);
  } else {
    for (const child of node.children) {
      mass += computeNodeMass(child) * toNumber(child.quantity);
    }
  }
  node.unitMass = mass;
  return mass;
}

function computeRolledBOM(root, options = {}) {
  const includeAssemblies = !!options.includeAssemblies;
  computeNodeMass(root);
  const rows = [];
  const walk = (node, rolledQty, depth) => {
    node.rolledQty = rolledQty;
    if (depth > 0 && (includeAssemblies || isLeaf(node))) {
      rows.push({
        item: 0,
        name: node.name,
        partNumber: String(node.partNumber ?? ''),
        description: String(node.description ?? ''),
        qty: rolledQty,
        material: String(node.material ?? ''),
        mass: node.unitMass,
        unit: resolveUnit(node),
        totalMass: node.unitMass * rolledQty,
        depth
      });
    }
    if (!isLeaf(node)) {
      for (const child of node.children) {
        walk(child, rolledQty * toNumber(child.quantity), depth + 1);
      }
    }
  };
  walk(root, 1, 0);
  rows.forEach((row, index) => {
    row.item = index + 1;
  });
  const totalQuantity = rows.reduce((sum, row) => sum + row.qty, 0);
  const totalMass = rows.reduce((sum, row) => sum + row.totalMass, 0);
  return { rows, totalQuantity, totalMass, root };
}

function extractBOM(root, options) {
  return computeRolledBOM(root, options);
}

function generateBalloons(bomResult, options = {}) {
  const rows = bomResult.rows;
  const positions = Array.isArray(options.itemPositions) ? options.itemPositions : [];
  const sheetWidth = options.sheetWidth ?? 297;
  const sheetHeight = options.sheetHeight ?? 210;
  const radius = options.balloonRadius ?? 4;
  const gap = options.balloonGap ?? 3;
  const margin = Math.max(options.margin ?? 8, radius);
  const pitch = 2 * radius + gap;
  const perCol = Math.max(1, Math.floor((sheetHeight - 2 * margin) / pitch));
  const n = rows.length;
  const cols = Math.max(1, Math.ceil(n / perCol));
  const balloons = rows.map((row, i) => {
    const col = Math.floor(i / perCol);
    const idx = i % perCol;
    const cx = sheetWidth - margin - radius - col * pitch;
    const cy = margin + radius + idx * pitch;
    const target = positions[i] || { x: cx - (col + 1) * pitch, y: cy };
    const dx = toNumber(target.x) - cx;
    const dy = toNumber(target.y) - cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    return {
      index: row.item,
      cx,
      cy,
      r: radius,
      leader: {
        x1: cx + ux * radius,
        y1: cy + uy * radius,
        x2: toNumber(target.x),
        y2: toNumber(target.y)
      },
      target: { x: toNumber(target.x), y: toNumber(target.y) }
    };
  });
  return { balloons, sheetWidth, sheetHeight, radius, gap, margin };
}

function defaultFormatNumber(value) {
  return Number(value).toFixed(3);
}

function renderBOMTable(bomResult, options = {}) {
  const rows = bomResult.rows;
  const formatNumber = typeof options.formatNumber === 'function' ? options.formatNumber : defaultFormatNumber;
  const headers = ['Item', 'Part Number', 'Description', 'Qty', 'Material', 'Mass', 'Unit', 'Total Mass'];
  const widths = [8, 24, 36, 8, 18, 12, 8, 14];
  const rowHeight = 5;
  const headerHeight = 7;
  const fontSize = 3.4;
  const textY = (rowY) => rowY + fontSize;
  const cellX = (col) => widths.slice(0, col).reduce((a, b) => a + b, 0);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cellX(widths.length)}" height="${headerHeight + rows.length * rowHeight}" font-family="sans-serif" font-size="${fontSize}">\n`;
  svg += `  <rect x="0" y="0" width="${cellX(widths.length)}" height="${headerHeight}" fill="#1e293b"/>\n`;
  headers.forEach((h, col) => {
    svg += `  <text x="${cellX(col) + 1}" y="${headerHeight - 1.5}" fill="#e2e8f0" font-weight="bold">${escapeXmlText(h)}</text>\n`;
  });
  let y = headerHeight;
  for (const row of rows) {
    svg += `  <line x1="0" y1="${y}" x2="${cellX(widths.length)}" y2="${y}" stroke="#cbd5e1" stroke-width="0.2"/>\n`;
    const cells = [
      String(row.item),
      row.partNumber,
      row.description,
      String(row.qty),
      row.material,
      formatNumber(row.mass),
      row.unit,
      formatNumber(row.totalMass)
    ];
    cells.forEach((cell, col) => {
      svg += `  <text x="${cellX(col) + 1}" y="${textY(y)}" fill="#0f172a">${escapeXmlText(cell)}</text>\n`;
    });
    y += rowHeight;
  }
  svg += `</svg>\n`;

  let html = `<table class="bom-table">\n<thead>\n<tr>\n`;
  html += headers.map((h) => `  <th>${escapeXmlText(h)}</th>`).join('\n') + '\n';
  html += `</tr>\n</thead>\n<tbody>\n`;
  for (const row of rows) {
    const cells = [
      String(row.item),
      row.partNumber,
      row.description,
      String(row.qty),
      row.material,
      formatNumber(row.mass),
      row.unit,
      formatNumber(row.totalMass)
    ];
    html += `<tr>\n` + cells.map((c) => `  <td>${escapeXmlText(c)}</td>`).join('\n') + '\n';
    html += `</tr>\n`;
  }
  html += `</tbody>\n</table>\n`;

  return { svg, html, rows, totalQuantity: bomResult.totalQuantity, totalMass: bomResult.totalMass };
}

module.exports = {
  computeNodeMass,
  computeRolledBOM,
  extractBOM,
  generateBalloons,
  renderBOMTable,
  escapeXmlText,
  DEFAULT_UNIT
};
