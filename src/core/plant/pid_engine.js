'use strict';

/**
 * PIDEngine — self-contained P&ID (Piping & Instrumentation Diagram) generator
 * for oil & gas production facilities. Produces standards-conforming SVG
 * drawing sheets (ISO/ISA-5.1-style symbology), a full tag/line/instrument/
 * valve schedule, and a real validation report.
 *
 * Deterministic: identical config produces identical SVG. No randomness,
 * no Date.now() in geometry (the date comes from config), no external
 * dependencies, pure geometry.
 */

/* =============================== Constants =============================== */

const SHEET_W = 1189; // A0 landscape width (mm)
const SHEET_H = 841; // A0 landscape height (mm)
const MARGIN = 20; // border frame margin (mm)
const FRAME_INNER = 5; // inner frame offset from outer frame (mm)
const PLOT_TOP = 24;
const PLOT_BOTTOM = 640;
const TITLE_BLOCK_X = 810;
const TITLE_BLOCK_Y = 680;
const TITLE_BLOCK_W = 359;
const TITLE_BLOCK_H = 141;
const NOTES_X = 810;
const NOTES_Y = 518;
const NOTES_W = 359;
const LEGEND_X = 20;
const LEGEND_Y = 650;
const LEGEND_W = 380;
const LINECLASS_X = 410;
const LINECLASS_Y = 650;
const LINECLASS_W = 398;
const EQUIP_SPACING = 120;
const NOZZLE_STUB = 14;
const BUBBLE_D = 8;
const FONT = 'Arial, Helvetica, sans-serif';
const LINE_RE = /^[A-Z]{1,3}-\d{3,5}-\d{1,2}-[A-Z]{2}-\d{3}(-[A-Z0-9]+)?$/;
const VALID_CLASSES = new Set(['150', '300', '600', '900']);
const VALID_LOCATIONS = new Set(['field', 'local', 'panel', 'dcs']);
const VALVE_TYPES = new Set([
  'control',
  'gate',
  'globe',
  'ball',
  'butterfly',
  'check',
  'psv',
  'xv',
  'manual',
  'bsv',
  'needle',
  'plug',
  'spectacle_blind',
  'angle'
]);
const ACTUATORS = new Set([
  'hand',
  'motor',
  'pneumatic-fo',
  'pneumatic-fc',
  'spring',
  'hydraulic',
  'solenoid',
  'manual-wheel',
  'lever'
]);

const EQUIP_TYPES = new Set([
  'wellhead',
  'manifold',
  'slug_catcher',
  'horizontal_vessel',
  'vertical_separator',
  'heater_treater',
  'absorption_column',
  'scrubber',
  'filter_separator',
  'compressor',
  'pump',
  'heat_exchanger',
  'air_cooler',
  'storage_tank',
  'produced_water_tank',
  'flare',
  'pig_launcher',
  'pig_receiver',
  'meter_skid',
  'knockout_drum',
  'stabilizer_column',
  'battery_limit'
]);

const VESSEL_LIKE = new Set([
  'horizontal_vessel',
  'vertical_separator',
  'slug_catcher',
  'heater_treater',
  'absorption_column',
  'scrubber',
  'filter_separator',
  'knockout_drum',
  'stabilizer_column',
  'storage_tank',
  'produced_water_tank'
]);

const HYDROCARBON_RE =
  /oil|gas|condensate|hydrocarbon|glycol|crude|sales|fuel|well|vapor|vapour|export|recycle|production|multiphase/i;

const TYPE_DIMS = {
  wellhead: [30, 34],
  manifold: [70, 36],
  slug_catcher: [92, 34],
  horizontal_vessel: [80, 36],
  vertical_separator: [40, 70],
  heater_treater: [72, 58],
  absorption_column: [42, 88],
  scrubber: [35, 60],
  filter_separator: [48, 52],
  compressor: [42, 42],
  pump: [30, 30],
  heat_exchanger: [45, 30],
  air_cooler: [60, 44],
  storage_tank: [60, 50],
  produced_water_tank: [55, 45],
  flare: [24, 78],
  pig_launcher: [74, 34],
  pig_receiver: [74, 34],
  meter_skid: [64, 40],
  knockout_drum: [40, 55],
  stabilizer_column: [40, 100],
  battery_limit: [40, 28]
};

/* ============================== Small helpers ============================ */

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function r(n) {
  return Math.round(n * 10) / 10;
}

function pointsAttr(pts) {
  return pts.map((p) => `${r(p[0])},${r(p[1])}`).join(' ');
}

function text(x, y, str, opts) {
  const o = opts || {};
  const fs = o.size === undefined ? 3 : o.size;
  const weight = o.weight || 'normal';
  const anchor = o.anchor || 'middle';
  const fill = o.fill || '#1a1a1a';
  const rot = o.rotate || 0;
  const t =
    `<text x="${r(x)}" y="${r(y)}" font-size="${fs}" font-weight="${weight}" ` +
    `text-anchor="${anchor}" fill="${fill}"` +
    (rot ? ` transform="rotate(${rot} ${r(x)} ${r(y)})"` : '') +
    `>${esc(str)}</text>`;
  return t;
}

function cvsField(field) {
  const s = String(field === undefined || field === null ? '' : field);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(fields) {
  return fields.map(cvsField).join(',');
}

/* ============================ Geometry helpers =========================== */

const NOZZLE_DIR = {
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1]
};

function nozzlePoint(eq, nozzleId) {
  const nz = eq.nozzles[nozzleId];
  if (!nz) return null;
  const side = nz.side;
  const off = nz.offset || 0;
  if (side === 'left') return [eq.cx - eq.w / 2, eq.cy + off * eq.h];
  if (side === 'right') return [eq.cx + eq.w / 2, eq.cy + off * eq.h];
  if (side === 'top') return [eq.cx + off * eq.w, eq.cy - eq.h / 2];
  return [eq.cx + off * eq.w, eq.cy + eq.h / 2];
}

function routeLine(fromPt, fromSide, toPt, toSide) {
  const d1 = NOZZLE_DIR[fromSide];
  const d2 = NOZZLE_DIR[toSide];
  const a = [fromPt[0] + d1[0] * NOZZLE_STUB, fromPt[1] + d1[1] * NOZZLE_STUB];
  const b = [toPt[0] - d2[0] * NOZZLE_STUB, toPt[1] - d2[1] * NOZZLE_STUB];
  const pts = [fromPt, a];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (Math.abs(dx) >= 0.01 || Math.abs(dy) >= 0.01) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (Math.abs(dy) >= 0.01) pts.push([b[0], a[1]], [b[0], b[1]]);
      else pts.push([b[0], b[1]]);
    } else {
      if (Math.abs(dx) >= 0.01) pts.push([a[0], b[1]], [b[0], b[1]]);
      else pts.push([b[0], b[1]]);
    }
  }
  pts.push(toPt);
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 0.01 || Math.abs(last[1] - p[1]) > 0.01) {
      out.push(p);
    }
  }
  return out;
}

function segmentInfo(pts) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const x1 = pts[i][0];
    const y1 = pts[i][1];
    const x2 = pts[i + 1][0];
    const y2 = pts[i + 1][1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    total += len;
    segs.push({
      x1,
      y1,
      x2,
      y2,
      len,
      midX: (x1 + x2) / 2,
      midY: (y1 + y2) / 2,
      deg: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
    });
  }
  return { segs, total };
}

function pointAtLength(segs, target) {
  let acc = 0;
  for (const s of segs) {
    if (acc + s.len >= target) {
      const t = target - acc;
      const f = s.len > 0.001 ? t / s.len : 0;
      const x = s.x1 + (s.x2 - s.x1) * f;
      const y = s.y1 + (s.y2 - s.y1) * f;
      return { x, y, deg: s.deg };
    }
    acc += s.len;
  }
  const last = segs[segs.length - 1];
  return { x: last.midX, y: last.midY, deg: last.deg };
}

function longestSegment(segs) {
  let best = segs[0];
  for (const s of segs) if (s.len > best.len) best = s;
  return best;
}

/* ============================ Symbol fragments =========================== */

function symbWellhead() {
  return [
    '<circle cx="0" cy="0" r="10"/>',
    '<circle cx="0" cy="0" r="2.6" fill="#1a1a1a"/>',
    '<line x1="0" y1="-10" x2="0" y2="-16"/>',
    '<line x1="-4.5" y1="-13" x2="4.5" y2="-13"/>'
  ];
}

function symbManifold() {
  return [
    '<rect x="-35" y="-3" width="70" height="6" fill="#1a1a1a"/>',
    '<line x1="-20" y1="-3" x2="-20" y2="-12"/>',
    '<line x1="0" y1="-3" x2="0" y2="-12"/>',
    '<line x1="20" y1="-3" x2="20" y2="-12"/>',
    '<circle cx="-20" cy="-12" r="2.5"/>',
    '<circle cx="0" cy="-12" r="2.5"/>',
    '<circle cx="20" cy="-12" r="2.5"/>'
  ];
}

function symbSlugCatcher() {
  return [
    '<ellipse cx="-42" cy="0" rx="9" ry="12"/>',
    '<ellipse cx="42" cy="0" rx="9" ry="12"/>',
    '<line x1="-42" y1="-12" x2="42" y2="-12"/>',
    '<line x1="-42" y1="12" x2="42" y2="8"/>',
    '<path d="M-20 11 L-20 19"/>',
    '<path d="M20 9 L20 17"/>',
    '<path d="M-24 19 L-16 19"/>',
    '<path d="M16 17 L24 17"/>'
  ];
}

function symbHorizontalVessel() {
  return [
    '<ellipse cx="-40" cy="0" rx="8" ry="14"/>',
    '<ellipse cx="40" cy="0" rx="8" ry="14"/>',
    '<line x1="-40" y1="-14" x2="40" y2="-14"/>',
    '<line x1="-40" y1="14" x2="40" y2="14"/>',
    '<path d="M-24 14 L-18 20 L-30 20 Z"/>',
    '<path d="M24 14 L30 20 L18 20 Z"/>'
  ];
}

function symbVerticalSeparator() {
  return [
    '<ellipse cx="0" cy="-30" rx="14" ry="6"/>',
    '<ellipse cx="0" cy="30" rx="14" ry="6"/>',
    '<line x1="-14" y1="-30" x2="-14" y2="30"/>',
    '<line x1="14" y1="-30" x2="14" y2="30"/>',
    '<path d="M-8 30 L-4 38 L-12 38 Z"/>',
    '<path d="M8 30 L12 38 L4 38 Z"/>'
  ];
}

function symbHeaterTreater() {
  return [
    '<ellipse cx="-26" cy="0" rx="7" ry="17"/>',
    '<ellipse cx="26" cy="0" rx="7" ry="17"/>',
    '<line x1="-26" y1="-17" x2="26" y2="-17"/>',
    '<line x1="-26" y1="17" x2="26" y2="17"/>',
    '<rect x="-32" y="19" width="64" height="10"/>',
    '<line x1="-40" y1="24" x2="-32" y2="24"/>',
    '<line x1="32" y1="24" x2="40" y2="24"/>',
    '<path d="M0 1 L5.5 11 L0 21 L-5.5 11 Z" fill="#f5a623"/>'
  ];
}

function symbColumn(extra) {
  const parts = [
    '<ellipse cx="0" cy="-40" rx="16" ry="6"/>',
    '<ellipse cx="0" cy="40" rx="16" ry="6"/>',
    '<line x1="-16" y1="-40" x2="-16" y2="40"/>',
    '<line x1="16" y1="-40" x2="16" y2="40"/>',
    '<line x1="-16" y1="-20" x2="16" y2="-20" stroke-dasharray="4 3"/>',
    '<line x1="-16" y1="0" x2="16" y2="0" stroke-dasharray="4 3"/>',
    '<line x1="-16" y1="20" x2="16" y2="20" stroke-dasharray="4 3"/>',
    '<path d="M-6 40 L-2 48 L-10 48 Z"/>',
    '<path d="M6 40 L10 48 L2 48 Z"/>'
  ];
  return extra ? parts.concat(extra) : parts;
}

function symbScrubber() {
  return [
    '<ellipse cx="0" cy="-26" rx="14" ry="5"/>',
    '<ellipse cx="0" cy="26" rx="14" ry="5"/>',
    '<line x1="-14" y1="-26" x2="-14" y2="26"/>',
    '<line x1="14" y1="-26" x2="14" y2="26"/>',
    '<line x1="-10" y1="-16" x2="10" y2="-8" stroke-dasharray="3 2"/>',
    '<line x1="-10" y1="-8" x2="10" y2="-16" stroke-dasharray="3 2"/>',
    '<path d="M-7 26 L-3 33 L-11 33 Z"/>',
    '<path d="M7 26 L11 33 L3 33 Z"/>'
  ];
}

function symbFilterSeparator() {
  return [
    '<ellipse cx="0" cy="-26" rx="16" ry="5"/>',
    '<ellipse cx="0" cy="26" rx="16" ry="5"/>',
    '<line x1="-16" y1="-26" x2="-16" y2="26"/>',
    '<line x1="16" y1="-26" x2="16" y2="26"/>',
    '<line x1="-12" y1="-18" x2="12" y2="-8" stroke-dasharray="3 2"/>',
    '<line x1="-12" y1="-8" x2="12" y2="-18" stroke-dasharray="3 2"/>',
    '<path d="M-8 26 L-4 33 L-12 33 Z"/>',
    '<path d="M8 26 L12 33 L4 33 Z"/>'
  ];
}

function symbCompressor() {
  return [
    '<circle cx="0" cy="0" r="15"/>',
    '<rect x="-8" y="-8" width="16" height="16"/>',
    '<line x1="15" y1="-5" x2="21" y2="-5"/>',
    '<line x1="15" y1="5" x2="21" y2="5"/>',
    '<line x1="-21" y1="0" x2="-15" y2="0"/>'
  ];
}

function symbPump() {
  return ['<circle cx="0" cy="0" r="11"/>', '<path d="M0 -6 L7 5 L-7 5 Z"/>'];
}

function symbHeatExchanger() {
  return [
    '<circle cx="0" cy="0" r="12"/>',
    '<line x1="-12" y1="-15" x2="-12" y2="15"/>',
    '<line x1="12" y1="-15" x2="12" y2="15"/>'
  ];
}

function symbAirCooler() {
  return [
    '<rect x="-24" y="-14" width="48" height="28"/>',
    '<line x1="-24" y1="-10" x2="24" y2="-10" stroke-dasharray="3 2"/>',
    '<line x1="-24" y1="-4" x2="24" y2="-4" stroke-dasharray="3 2"/>',
    '<line x1="-24" y1="2" x2="24" y2="2" stroke-dasharray="3 2"/>',
    '<line x1="-24" y1="8" x2="24" y2="8" stroke-dasharray="3 2"/>',
    '<circle cx="0" cy="-24" r="7"/>',
    '<line x1="0" y1="-31" x2="0" y2="-17"/>',
    '<line x1="-7" y1="-24" x2="7" y2="-24"/>',
    '<path d="M-10 14 L-6 20 L-14 20 Z"/>',
    '<path d="M10 14 L14 20 L6 20 Z"/>'
  ];
}

function symbStorageTank() {
  return [
    '<rect x="-24" y="-12" width="48" height="24" rx="3"/>',
    '<path d="M-24 -12 L-16 -24 L16 -24 L24 -12 Z"/>',
    '<line x1="0" y1="-24" x2="0" y2="-29"/>',
    '<circle cx="0" cy="-29" r="1.6"/>',
    '<path d="M-20 12 L-17 18 L-23 18 Z"/>',
    '<path d="M20 12 L23 18 L17 18 Z"/>'
  ];
}

function symbWaterTank() {
  return [
    '<rect x="-22" y="-11" width="44" height="22" rx="3"/>',
    '<path d="M-22 -11 L-14 -22 L14 -22 L22 -11 Z"/>',
    '<line x1="0" y1="-22" x2="0" y2="-27"/>',
    '<circle cx="0" cy="-27" r="1.6"/>',
    '<path d="M-18 11 L-15 17 L-21 17 Z"/>',
    '<path d="M18 11 L21 17 L15 17 Z"/>'
  ];
}

function symbFlare() {
  return [
    '<line x1="0" y1="-30" x2="0" y2="26"/>',
    '<line x1="-12" y1="26" x2="12" y2="26"/>',
    '<line x1="0" y1="26" x2="0" y2="32"/>',
    '<line x1="-4" y1="-30" x2="-4" y2="26"/>',
    '<line x1="4" y1="-30" x2="4" y2="26"/>',
    '<path d="M0 -36 L6 -28 L0 -18 L-6 -28 Z" fill="#f5a623"/>',
    '<path d="M0 -32 L3 -27 L0 -23 L-3 -27 Z" fill="#f8e08e"/>'
  ];
}

function symbPigLauncher() {
  return [
    '<path d="M-30 -10 L-42 0 L-30 10 Z"/>',
    '<rect x="-30" y="-10" width="60" height="20" rx="6"/>',
    '<line x1="24" y1="-10" x2="24" y2="10"/>',
    '<circle cx="24" cy="10" r="1.8"/>',
    '<path d="M-42 0 L-50 0"/>'
  ];
}

function symbPigReceiver() {
  return [
    '<rect x="-30" y="-10" width="60" height="20" rx="6"/>',
    '<path d="M30 -10 L42 0 L30 10 Z"/>',
    '<line x1="-24" y1="-10" x2="-24" y2="10"/>',
    '<circle cx="-24" cy="10" r="1.8"/>',
    '<path d="M42 0 L50 0"/>'
  ];
}

function symbMeterSkid() {
  return [
    '<rect x="-30" y="-18" width="60" height="36"/>',
    '<line x1="-26" y1="-18" x2="-26" y2="18"/>',
    '<line x1="26" y1="-18" x2="26" y2="18"/>',
    '<path d="M0 -8 L8 0 L0 8 L-8 0 Z"/>',
    '<line x1="-42" y1="0" x2="-30" y2="0"/>',
    '<line x1="30" y1="0" x2="42" y2="0"/>'
  ];
}

function symbKnockoutDrum() {
  return [
    '<ellipse cx="0" cy="-24" rx="13" ry="5"/>',
    '<ellipse cx="0" cy="24" rx="13" ry="5"/>',
    '<line x1="-13" y1="-24" x2="-13" y2="24"/>',
    '<line x1="13" y1="-24" x2="13" y2="24"/>',
    '<path d="M-6 24 L-2 31 L-10 31 Z"/>',
    '<path d="M6 24 L10 31 L2 31 Z"/>'
  ];
}

function symbStabilizer() {
  return symbColumn([
    '<circle cx="0" cy="48" r="7"/>',
    '<line x1="0" y1="40" x2="0" y2="41"/>',
    '<path d="M-5 55 L-2 61 L-8 61 Z"/>',
    '<path d="M5 55 L8 61 L2 61 Z"/>'
  ]);
}

function symbBatteryLimit() {
  return [
    '<polygon points="-16,-12 8,-12 18,0 8,12 -16,12" fill="#f8fafc" stroke="#1e3a8a" stroke-width="1.3"/>',
    '<line x1="-16" y1="-14" x2="-16" y2="14" stroke="#1e3a8a" stroke-width="2.6"/>',
    '<line x1="8" y1="-12" x2="8" y2="12" stroke="#93c5fd" stroke-width="0.8" stroke-dasharray="1 1.5"/>'
  ];
}

function equipmentSymbolParts(type) {
  switch (type) {
    case 'wellhead':
      return symbWellhead();
    case 'manifold':
      return symbManifold();
    case 'slug_catcher':
      return symbSlugCatcher();
    case 'horizontal_vessel':
      return symbHorizontalVessel();
    case 'vertical_separator':
      return symbVerticalSeparator();
    case 'heater_treater':
      return symbHeaterTreater();
    case 'absorption_column':
      return symbColumn();
    case 'scrubber':
      return symbScrubber();
    case 'filter_separator':
      return symbFilterSeparator();
    case 'compressor':
      return symbCompressor();
    case 'pump':
      return symbPump();
    case 'heat_exchanger':
      return symbHeatExchanger();
    case 'air_cooler':
      return symbAirCooler();
    case 'storage_tank':
      return symbStorageTank();
    case 'produced_water_tank':
      return symbWaterTank();
    case 'flare':
      return symbFlare();
    case 'pig_launcher':
      return symbPigLauncher();
    case 'pig_receiver':
      return symbPigReceiver();
    case 'meter_skid':
      return symbMeterSkid();
    case 'knockout_drum':
      return symbKnockoutDrum();
    case 'stabilizer_column':
      return symbStabilizer();
    case 'battery_limit':
      return symbBatteryLimit();
    default:
      return [];
  }
}

/* ============================ Valve fragments ============================ */

function valveBodyParts(type) {
  switch (type) {
    case 'gate':
      return [
        '<path d="M-8 -5 L0 0 L-8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<path d="M8 -5 L0 0 L8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>'
      ];
    case 'globe':
      return [
        '<path d="M-8 -5 L0 0 L-8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<path d="M8 -5 L0 0 L8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<circle cx="0" cy="0" r="2.2" fill="#1a1a1a" stroke="#1a1a1a"/>'
      ];
    case 'ball':
      return [
        '<path d="M-8 -5 L0 0 L-8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<path d="M8 -5 L0 0 L8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<circle cx="0" cy="0" r="2.6" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>'
      ];
    case 'butterfly':
      return [
        '<path d="M-8 -5 L0 0 L-8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<path d="M8 -5 L0 0 L8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<line x1="-3" y1="4" x2="3" y2="-4" stroke="#1a1a1a" stroke-width="1.8"/>'
      ];
    case 'check':
      return [
        '<path d="M-8 -5 L0 0 L-8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<line x1="0" y1="-5.5" x2="0" y2="5.5" stroke="#1a1a1a" stroke-width="1.6"/>'
      ];
    case 'manual':
      return [
        '<path d="M-8 -5 L0 0 L-8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<path d="M8 -5 L0 0 L8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<line x1="0" y1="0" x2="0" y2="-7" stroke="#1a1a1a" stroke-width="1.0"/>',
        '<line x1="-5" y1="-7" x2="5" y2="-7" stroke="#1a1a1a" stroke-width="1.8"/>'
      ];
    case 'needle':
      return [
        '<path d="M-8 -5 L0 0 L-8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<path d="M8 -5 L0 0 L8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<line x1="0" y1="0" x2="0" y2="-7" stroke="#1a1a1a" stroke-width="1.0"/>',
        '<path d="M-2 -7 L2 -7 L0 -1 Z" fill="#1a1a1a" stroke="#1a1a1a"/>',
        '<line x1="-4" y1="-7" x2="4" y2="-7" stroke="#1a1a1a" stroke-width="1.5"/>'
      ];
    case 'bsv':
      return [
        '<path d="M-9 -4 L-2 0 L-9 4 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.0"/>',
        '<path d="M9 -4 L2 0 L9 4 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.0"/>',
        '<line x1="0" y1="0" x2="0" y2="6" stroke="#1a1a1a" stroke-width="1.0"/>',
        '<path d="M-3 6 L3 6 L0 9.5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="0.9"/>',
        '<line x1="-3" y1="11" x2="3" y2="11" stroke="#1a1a1a" stroke-width="1.2"/>'
      ];
    case 'spectacle_blind':
      return [
        '<circle cx="-4" cy="0" r="3.2" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<circle cx="4" cy="0" r="3.2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<line x1="-4" y1="-3.2" x2="4" y2="-3.2" stroke="#1a1a1a" stroke-width="1.0"/>',
        '<line x1="-4" y1="3.2" x2="4" y2="3.2" stroke="#1a1a1a" stroke-width="1.0"/>'
      ];
    case 'plug':
      return [
        '<path d="M-8 -5 L0 0 L-8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<path d="M8 -5 L0 0 L8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<rect x="-2" y="-3.5" width="4" height="7" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.0"/>'
      ];
    case 'psv':
    case 'angle':
      return [
        '<path d="M-4.5 7 L4.5 7 L0 0 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<path d="M0 0 L7 -4.5 L7 4.5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<line x1="0" y1="0" x2="0" y2="-4" stroke="#1a1a1a" stroke-width="1.0"/>',
        '<path d="M0 -4 L-2.5 -5.5 L2.5 -7 L-2.5 -8.5 L2.5 -10 L0 -11.5" fill="none" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<rect x="-3" y="-14" width="6" height="3" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.0"/>',
        '<line x1="0" y1="-14" x2="4" y2="-17" stroke="#1a1a1a" stroke-width="1.0"/>'
      ];
    case 'xv':
      return [
        '<path d="M-8 -5 L0 0 L-8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<path d="M8 -5 L0 0 L8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<line x1="0" y1="0" x2="0" y2="-8" stroke="#1a1a1a" stroke-width="1.0"/>',
        '<rect x="-4.5" y="-15" width="9" height="7" rx="1" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<text x="0" y="-10.2" font-size="3.2" font-weight="bold" text-anchor="middle" fill="#1a1a1a">S</text>'
      ];
    case 'control':
    default:
      return [
        '<path d="M-8 -5 L0 0 L-8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>',
        '<path d="M8 -5 L0 0 L8 5 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.1"/>'
      ];
  }
}

function actuatorParts(actuator) {
  switch (actuator) {
    case 'hand':
    case 'manual-wheel':
      return [
        '<line x1="0" y1="0" x2="0" y2="-7" stroke-width="1.0"/>',
        '<line x1="-5" y1="-7" x2="5" y2="-7" stroke-width="1.8"/>'
      ];
    case 'motor':
      return [
        '<line x1="0" y1="0" x2="0" y2="-7" stroke-width="1.0"/>',
        '<circle cx="0" cy="-12" r="5" fill="#ffffff" stroke-width="1.1"/>',
        '<text x="0" y="-10.2" font-size="3.2" font-weight="bold" text-anchor="middle" fill="#1a1a1a">M</text>'
      ];
    case 'pneumatic-fo':
      return [
        '<line x1="0" y1="0" x2="0" y2="-7" stroke-width="1.0"/>',
        '<path d="M-5 -13 A5 5 0 0 1 5 -13 Z" fill="#ffffff" stroke-width="1.1"/>',
        '<line x1="-5" y1="-13" x2="5" y2="-13" stroke-width="1.1"/>',
        '<path d="M-2 -10 L2 -10 L0 -7.5 Z" fill="#1a1a1a"/>'
      ];
    case 'pneumatic-fc':
      return [
        '<line x1="0" y1="0" x2="0" y2="-7" stroke-width="1.0"/>',
        '<path d="M-5 -13 A5 5 0 0 1 5 -13 Z" fill="#ffffff" stroke-width="1.1"/>',
        '<line x1="-5" y1="-13" x2="5" y2="-13" stroke-width="1.1"/>',
        '<path d="M-2 -7 L2 -7 L0 -9.5 Z" fill="#1a1a1a"/>'
      ];
    case 'spring':
      return [
        '<line x1="0" y1="0" x2="0" y2="-4" stroke-width="1.0"/>',
        '<path d="M0 -4 L-2.5 -6 L2.5 -8 L-2.5 -10 L2.5 -12 L0 -14" fill="none" stroke-width="1.1"/>'
      ];
    case 'hydraulic':
      return [
        '<line x1="0" y1="0" x2="0" y2="-7" stroke-width="1.0"/>',
        '<path d="M-4 -14 L4 -14 L0 -7 Z" fill="#1a1a1a"/>'
      ];
    case 'solenoid':
      return [
        '<line x1="0" y1="0" x2="0" y2="-7" stroke-width="1.0"/>',
        '<rect x="-4" y="-14" width="8" height="6" fill="#ffffff" stroke-width="1.1"/>',
        '<text x="0" y="-9.8" font-size="3.2" font-weight="bold" text-anchor="middle" fill="#1a1a1a">S</text>'
      ];
    case 'lever':
      return [
        '<line x1="0" y1="0" x2="0" y2="-7" stroke-width="1.0"/>',
        '<line x1="0" y1="-7" x2="6" y2="-11" stroke-width="1.8"/>'
      ];
    default:
      return [];
  }
}

/* ============================== Template data ============================ */

function nz(defs) {
  const out = [];
  const sides = ['left', 'right', 'top', 'bottom'];
  for (const side of sides) {
    if (!defs[side]) continue;
    for (const entry of defs[side]) {
      out.push({ id: entry[0], side, offset: entry[1] });
    }
  }
  return out;
}

function buildOilGasTemplate() {
  const eq = (tag, type, description, nozzles, inlets, outlets, vents, extra) => {
    const obj = {
      tag,
      type,
      description,
      x: 0,
      y: 0,
      nozzles: nz(nozzles),
      inletNozzles: inlets,
      outletNozzles: outlets,
      ventNozzles: vents
    };
    if (extra) Object.assign(obj, extra);
    return obj;
  };

  const areas = [
    {
      id: 'A-10',
      name: 'Gas Gathering',
      order: 1,
      notes: [
        'Wellhead ESD XV-1001/XV-1002 trip on site emergency shutdown signal.',
        'Slug catcher PSV-1010 (140 barg) discharges to the flare KO drum.'
      ],
      equipment: [
        eq(
          'W-1001',
          'wellhead',
          'Oil & gas production wellhead 1',
          { right: [['N1', 0]], top: [['N2', 0]] },
          [],
          ['N1'],
          ['N2']
        ),
        eq(
          'W-1002',
          'wellhead',
          'Oil & gas production wellhead 2',
          { right: [['N1', 0]], top: [['N2', 0]] },
          [],
          ['N1'],
          ['N2']
        ),
        eq(
          'M-1001',
          'manifold',
          'Production header manifold',
          {
            left: [
              ['N1', -0.33],
              ['N2', 0.33]
            ],
            right: [['N3', 0]]
          },
          ['N1', 'N2'],
          ['N3'],
          []
        ),
        eq(
          'V-1010',
          'slug_catcher',
          'Slugcatcher (two-phase separator)',
          { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]], bottom: [['N4', 0]] },
          ['N1'],
          ['N2'],
          ['N3']
        )
      ]
    },
    {
      id: 'A-20',
      name: 'Separation',
      order: 2,
      notes: [
        'HP separator PIC-1020 controls PCV-1020 on the gas outlet.',
        'Produced water is routed to T-1031; flare gas to V-1035.'
      ],
      equipment: [
        eq(
          'V-1020',
          'horizontal_vessel',
          'High-pressure production separator',
          {
            left: [['N1', 0]],
            right: [
              ['N2', -0.25],
              ['N3', 0.3]
            ],
            top: [['N4', 0]],
            bottom: [['N5', 0]]
          },
          ['N1'],
          ['N2', 'N3'],
          ['N4']
        ),
        eq(
          'V-1021',
          'horizontal_vessel',
          'Low-pressure production separator',
          {
            left: [['N1', 0]],
            right: [
              ['N2', -0.25],
              ['N3', 0.3]
            ],
            top: [['N4', 0]],
            bottom: [['N5', 0]]
          },
          ['N1'],
          ['N2', 'N3'],
          ['N4']
        ),
        eq(
          'H-1030',
          'heater_treater',
          'Heater treater (wellstream heating)',
          {
            left: [['N1', 0]],
            right: [
              ['N2', -0.25],
              ['N5', 0.3]
            ],
            top: [['N3', 0]],
            bottom: [['N4', 0]]
          },
          ['N1', 'N5'],
          ['N2'],
          ['N3']
        ),
        eq(
          'T-1031',
          'produced_water_tank',
          'Produced water storage tank',
          { left: [['N1', -0.2]], right: [['N2', -0.2]], top: [['N3', 0]] },
          ['N1'],
          ['N2'],
          ['N3']
        ),
        eq(
          'V-1035',
          'knockout_drum',
          'LP flare knockout drum',
          {
            left: [
              ['N1', -0.35],
              ['N2', -0.12],
              ['N3', 0.12],
              ['N4', 0.35]
            ],
            top: [
              ['N5', 0],
              ['N6', -0.35]
            ],
            bottom: [['N7', 0]]
          },
          ['N1', 'N2', 'N3', 'N4'],
          ['N5'],
          []
        )
      ]
    },
    {
      id: 'A-30',
      name: 'Dehydration',
      order: 3,
      notes: [
        'TEG contactor C-1040: lean glycol in from E-1043, rich glycol out to reboiler.',
        'Dry gas from C-1040 passes through E-1043 (gas/glycol exchanger).'
      ],
      equipment: [
        eq(
          'C-1040',
          'absorption_column',
          'TEG absorption column (contactor)',
          {
            left: [
              ['N1', 0.3],
              ['N6', -0.3]
            ],
            right: [['N3', 0]],
            top: [
              ['N2', 0],
              ['N7', -0.35]
            ],
            bottom: [['N5', -0.3]]
          },
          ['N1', 'N6'],
          ['N2', 'N5'],
          ['N7']
        ),
        eq(
          'E-1041',
          'heat_exchanger',
          'TEG regenerator reboiler',
          { left: [['N1', 0]], right: [['N2', -0.25]], top: [['N3', 0]] },
          ['N1'],
          ['N2'],
          ['N3']
        ),
        eq('P-1042', 'pump', 'Glycol circulation pump', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq(
          'E-1043',
          'heat_exchanger',
          'Gas/glycol exchanger',
          {
            left: [
              ['N1', -0.35],
              ['N3', 0],
              ['N5', 0.35]
            ],
            right: [
              ['N2', -0.35],
              ['N4', 0.35],
              ['N6', 0]
            ]
          },
          ['N1', 'N3', 'N5'],
          ['N2', 'N4', 'N6'],
          []
        ),
        eq(
          'V-1044',
          'filter_separator',
          'Filter separator (glycol carryover)',
          { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]], bottom: [['N4', 0]] },
          ['N1'],
          ['N2'],
          ['N3']
        )
      ]
    },
    {
      id: 'A-40',
      name: 'Compression',
      order: 4,
      notes: [
        'Reciprocating compressor K-1051 with anti-surge recycle line L-1054.',
        'Discharge cooled in E-1052 and scrubbed in V-1053 before export.'
      ],
      equipment: [
        eq(
          'V-1050',
          'scrubber',
          'Compressor suction scrubber',
          {
            left: [
              ['N1', 0],
              ['N5', -0.35]
            ],
            right: [['N2', 0]],
            top: [['N3', 0]],
            bottom: [['N4', 0]]
          },
          ['N1', 'N5'],
          ['N2'],
          ['N3']
        ),
        eq(
          'K-1051',
          'compressor',
          'Reciprocating gas compressor',
          {
            left: [['N1', 0]],
            right: [
              ['N2', -0.25],
              ['N3', 0.25]
            ]
          },
          ['N1'],
          ['N2', 'N3'],
          []
        ),
        eq(
          'E-1052',
          'air_cooler',
          'Compressor discharge air cooler',
          { left: [['N1', 0]], right: [['N2', 0]] },
          ['N1'],
          ['N2'],
          []
        ),
        eq(
          'V-1053',
          'scrubber',
          'Compressor discharge scrubber',
          { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]], bottom: [['N4', 0]] },
          ['N1'],
          ['N2'],
          ['N3']
        )
      ]
    },
    {
      id: 'A-50',
      name: 'Export & Utilities',
      order: 5,
      notes: [
        'Export pig launcher L-1060 then fiscal metering skid F-1061.',
        'Flare F-1070 receives relief gas via KO drum V-1035.'
      ],
      equipment: [
        eq(
          'L-1060',
          'pig_launcher',
          'Export pig launcher',
          { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', -0.3]] },
          ['N1'],
          ['N2'],
          ['N3']
        ),
        eq(
          'F-1061',
          'meter_skid',
          'Fiscal metering skid (orifice)',
          { left: [['N1', 0]], right: [['N2', 0]] },
          ['N1'],
          ['N2'],
          []
        ),
        eq('F-1070', 'flare', 'Elevated flare', { bottom: [['N1', 0]] }, ['N1'], [], []),
        eq(
          'V-1071',
          'knockout_drum',
          'Fuel gas knockout drum',
          {
            left: [['N1', 0]],
            right: [
              ['N2', -0.3],
              ['N3', 0.3]
            ],
            top: [['N4', 0]]
          },
          ['N1'],
          ['N2', 'N3'],
          ['N4']
        ),
        eq('BL-EXPORT', 'battery_limit', 'Battery limit - export sales gas', { left: [['N1', 0]] }, ['N1'], [], [], {
          isBoundary: true
        }),
        eq('BL-FGUSER', 'battery_limit', 'Battery limit - fuel gas users', { left: [['N1', 0]] }, ['N1'], [], [], {
          isBoundary: true
        })
      ]
    }
  ];

  const line = (lineNumber, from, to, sizeIn, service, material, cls, insulation, extra) =>
    Object.assign(
      {
        lineNumber,
        from,
        to,
        sizeIn,
        service,
        material,
        class: cls,
        insulation
      },
      extra || {}
    );

  const lines = [
    line(
      'L-1001-4-CS-150',
      { tag: 'W-1001', nozzle: 'N1' },
      { tag: 'M-1001', nozzle: 'N1' },
      4,
      'well fluids',
      'CS',
      '150',
      null,
      { streamNumber: 1, operatingPressureBarg: 45.0, operatingTemperatureC: 65.0, flowRateTH: 40.0, vaporFraction: 0.35 }
    ),
    line(
      'L-1002-4-CS-150',
      { tag: 'W-1002', nozzle: 'N1' },
      { tag: 'M-1001', nozzle: 'N2' },
      4,
      'well fluids',
      'CS',
      '150',
      null,
      { streamNumber: 2, operatingPressureBarg: 45.0, operatingTemperatureC: 65.0, flowRateTH: 40.0, vaporFraction: 0.35 }
    ),
    line(
      'L-1010-12-CS-300-A1F',
      { tag: 'M-1001', nozzle: 'N3' },
      { tag: 'V-1010', nozzle: 'N1' },
      12,
      'multiphase production',
      'CS',
      '300',
      'A1F',
      { streamNumber: 3, operatingPressureBarg: 42.0, operatingTemperatureC: 62.0, flowRateTH: 80.0, vaporFraction: 0.35 }
    ),
    line(
      'L-1011-12-CS-300-A1F',
      { tag: 'V-1010', nozzle: 'N2' },
      { tag: 'V-1020', nozzle: 'N1' },
      12,
      'hydrocarbon gas',
      'CS',
      '300',
      'A1F',
      { streamNumber: 4, operatingPressureBarg: 40.0, operatingTemperatureC: 58.0, flowRateTH: 25.0, vaporFraction: 1.0 }
    ),
    line(
      'L-1020-10-CS-300-A1F',
      { tag: 'V-1020', nozzle: 'N2' },
      { tag: 'H-1030', nozzle: 'N1' },
      10,
      'hydrocarbon gas',
      'CS',
      '300',
      'A1F',
      { streamNumber: 5, operatingPressureBarg: 25.0, operatingTemperatureC: 50.0, flowRateTH: 18.0, vaporFraction: 1.0 }
    ),
    line(
      'L-1022-6-CS-300-A1F',
      { tag: 'V-1020', nozzle: 'N3' },
      { tag: 'V-1021', nozzle: 'N1' },
      6,
      'crude oil',
      'CS',
      '300',
      'A1F',
      { streamNumber: 6, operatingPressureBarg: 25.0, operatingTemperatureC: 50.0, flowRateTH: 45.0, vaporFraction: 0.0 }
    ),
    line(
      'L-1030-6-CS-150-A1F',
      { tag: 'H-1030', nozzle: 'N2' },
      { tag: 'C-1040', nozzle: 'N1' },
      6,
      'wet gas',
      'CS',
      '150',
      'A1F',
      { streamNumber: 7, operatingPressureBarg: 5.0, operatingTemperatureC: 75.0, flowRateTH: 12.0, vaporFraction: 1.0 }
    ),
    line(
      'L-1040-6-CS-600-A1F',
      { tag: 'C-1040', nozzle: 'N2' },
      { tag: 'E-1043', nozzle: 'N1' },
      6,
      'dry gas',
      'CS',
      '600',
      'A1F',
      { streamNumber: 8, operatingPressureBarg: 65.0, operatingTemperatureC: 38.0, flowRateTH: 11.5, vaporFraction: 1.0 }
    ),
    line(
      'L-1041-6-CS-600-A1F',
      { tag: 'E-1043', nozzle: 'N2' },
      { tag: 'V-1044', nozzle: 'N1' },
      6,
      'dry gas',
      'CS',
      '600',
      'A1F',
      { streamNumber: 9, operatingPressureBarg: 64.0, operatingTemperatureC: 28.0, flowRateTH: 11.5, vaporFraction: 1.0 }
    ),
    line(
      'L-1042-6-CS-600-A1F',
      { tag: 'V-1044', nozzle: 'N2' },
      { tag: 'V-1050', nozzle: 'N1' },
      6,
      'gas',
      'CS',
      '600',
      'A1F',
      { streamNumber: 10, operatingPressureBarg: 63.5, operatingTemperatureC: 27.0, flowRateTH: 11.4, vaporFraction: 1.0 }
    ),
    line(
      'L-1050-6-CS-600',
      { tag: 'V-1050', nozzle: 'N2' },
      { tag: 'K-1051', nozzle: 'N1' },
      6,
      'suction gas',
      'CS',
      '600',
      null,
      { streamNumber: 11, operatingPressureBarg: 62.0, operatingTemperatureC: 25.0, flowRateTH: 11.4, vaporFraction: 1.0 }
    ),
    line(
      'L-1051-6-CS-600-A1F',
      { tag: 'K-1051', nozzle: 'N2' },
      { tag: 'E-1052', nozzle: 'N1' },
      6,
      'compressor discharge gas',
      'CS',
      '600',
      'A1F',
      { streamNumber: 12, operatingPressureBarg: 110.0, operatingTemperatureC: 115.0, flowRateTH: 11.4, vaporFraction: 1.0 }
    ),
    line(
      'L-1052-6-CS-600-A1F',
      { tag: 'E-1052', nozzle: 'N2' },
      { tag: 'V-1053', nozzle: 'N1' },
      6,
      'cooled gas',
      'CS',
      '600',
      'A1F',
      { streamNumber: 13, operatingPressureBarg: 108.0, operatingTemperatureC: 45.0, flowRateTH: 11.4, vaporFraction: 1.0 }
    ),
    line(
      'L-1053-8-CS-600-A1F',
      { tag: 'V-1053', nozzle: 'N2' },
      { tag: 'L-1060', nozzle: 'N1' },
      8,
      'sales gas',
      'CS',
      '600',
      'A1F',
      { streamNumber: 14, operatingPressureBarg: 106.0, operatingTemperatureC: 42.0, flowRateTH: 11.3, vaporFraction: 1.0 }
    ),
    line(
      'L-1054-4-CS-600',
      { tag: 'K-1051', nozzle: 'N3' },
      { tag: 'V-1050', nozzle: 'N5' },
      4,
      'recycle gas',
      'CS',
      '600',
      null
    ),
    line(
      'L-1060-8-CS-600-A1F',
      { tag: 'L-1060', nozzle: 'N2' },
      { tag: 'F-1061', nozzle: 'N1' },
      8,
      'sales gas',
      'CS',
      '600',
      'A1F',
      { streamNumber: 15, operatingPressureBarg: 105.0, operatingTemperatureC: 40.0, flowRateTH: 11.3, vaporFraction: 1.0 }
    ),
    line(
      'L-1061-8-CS-600-A1F',
      { tag: 'F-1061', nozzle: 'N2' },
      { tag: 'BL-EXPORT', nozzle: 'N1' },
      8,
      'export gas',
      'CS',
      '600',
      'A1F',
      { streamNumber: 16, operatingPressureBarg: 104.0, operatingTemperatureC: 40.0, flowRateTH: 11.3, vaporFraction: 1.0 }
    ),
    line(
      'TG-1045-2-SS-150-A1F',
      { tag: 'C-1040', nozzle: 'N5' },
      { tag: 'E-1043', nozzle: 'N3' },
      2,
      'rich triethylene glycol',
      'SS',
      '150',
      'A1F',
      { streamNumber: 17, operatingPressureBarg: 65.0, operatingTemperatureC: 40.0, flowRateTH: 3.5, vaporFraction: 0.0 }
    ),
    line(
      'TG-1046-2-SS-150-A1F',
      { tag: 'E-1043', nozzle: 'N4' },
      { tag: 'E-1041', nozzle: 'N1' },
      2,
      'rich triethylene glycol',
      'SS',
      '150',
      'A1F',
      { streamNumber: 18, operatingPressureBarg: 4.0, operatingTemperatureC: 85.0, flowRateTH: 3.5, vaporFraction: 0.0 }
    ),
    line(
      'TG-1047-2-SS-150-A1F',
      { tag: 'E-1041', nozzle: 'N2' },
      { tag: 'P-1042', nozzle: 'N1' },
      2,
      'lean triethylene glycol',
      'SS',
      '150',
      'A1F',
      { streamNumber: 19, operatingPressureBarg: 1.5, operatingTemperatureC: 130.0, flowRateTH: 3.4, vaporFraction: 0.0 }
    ),
    line(
      'TG-1048-2-SS-150-A1F',
      { tag: 'P-1042', nozzle: 'N2' },
      { tag: 'E-1043', nozzle: 'N5' },
      2,
      'lean triethylene glycol',
      'SS',
      '150',
      'A1F',
      { streamNumber: 20, operatingPressureBarg: 70.0, operatingTemperatureC: 131.0, flowRateTH: 3.4, vaporFraction: 0.0 }
    ),
    line(
      'TG-1049-2-SS-150-A1F',
      { tag: 'E-1043', nozzle: 'N6' },
      { tag: 'C-1040', nozzle: 'N6' },
      2,
      'lean triethylene glycol',
      'SS',
      '150',
      'A1F',
      { streamNumber: 21, operatingPressureBarg: 68.0, operatingTemperatureC: 45.0, flowRateTH: 3.4, vaporFraction: 0.0 }
    ),
    line(
      'PW-1021-6-CS-150',
      { tag: 'V-1021', nozzle: 'N3' },
      { tag: 'T-1031', nozzle: 'N1' },
      6,
      'produced water',
      'CS',
      '150',
      null,
      { streamNumber: 22, operatingPressureBarg: 2.0, operatingTemperatureC: 45.0, flowRateTH: 10.0, vaporFraction: 0.0 }
    ),
    line(
      'FG-1021-4-CS-150',
      { tag: 'V-1021', nozzle: 'N2' },
      { tag: 'V-1071', nozzle: 'N1' },
      4,
      'fuel gas',
      'CS',
      '150',
      null
    ),
    line(
      'FG-1030-2-CS-150',
      { tag: 'V-1071', nozzle: 'N3' },
      { tag: 'H-1030', nozzle: 'N5' },
      2,
      'fuel gas',
      'CS',
      '150',
      null
    ),
    line(
      'FG-1071-4-CS-150',
      { tag: 'V-1071', nozzle: 'N2' },
      { tag: 'BL-FGUSER', nozzle: 'N1' },
      4,
      'fuel gas',
      'CS',
      '150',
      null
    ),
    line(
      'FL-1010-6-CS-150',
      { tag: 'V-1010', nozzle: 'N3' },
      { tag: 'V-1035', nozzle: 'N1' },
      6,
      'flare gas',
      'CS',
      '150',
      null
    ),
    line(
      'FL-1020-4-CS-150',
      { tag: 'V-1020', nozzle: 'N4' },
      { tag: 'V-1035', nozzle: 'N2' },
      4,
      'flare gas',
      'CS',
      '150',
      null
    ),
    line(
      'FL-1021-4-CS-150',
      { tag: 'V-1021', nozzle: 'N4' },
      { tag: 'V-1035', nozzle: 'N3' },
      4,
      'flare gas',
      'CS',
      '150',
      null
    ),
    line(
      'FL-1030-4-CS-150',
      { tag: 'H-1030', nozzle: 'N3' },
      { tag: 'V-1035', nozzle: 'N4' },
      4,
      'flare gas',
      'CS',
      '150',
      null
    ),
    line(
      'FL-1031-2-CS-150',
      { tag: 'T-1031', nozzle: 'N3' },
      { tag: 'V-1035', nozzle: 'N1' },
      2,
      'flare gas',
      'CS',
      '150',
      null
    ),
    line(
      'FL-1034-3-CS-150',
      { tag: 'V-1035', nozzle: 'N6' },
      { tag: 'F-1070', nozzle: 'N1' },
      3,
      'flare gas',
      'CS',
      '150',
      null
    ),
    line(
      'FL-1035-16-CS-150',
      { tag: 'V-1035', nozzle: 'N5' },
      { tag: 'F-1070', nozzle: 'N1' },
      16,
      'flare gas',
      'CS',
      '150',
      null
    ),
    line(
      'FL-1040-4-CS-150',
      { tag: 'C-1040', nozzle: 'N7' },
      { tag: 'V-1035', nozzle: 'N2' },
      4,
      'flare gas',
      'CS',
      '150',
      null
    ),
    line(
      'FL-1050-4-CS-150',
      { tag: 'V-1050', nozzle: 'N3' },
      { tag: 'V-1035', nozzle: 'N3' },
      4,
      'flare gas',
      'CS',
      '150',
      null
    ),
    line(
      'FL-1053-4-CS-150',
      { tag: 'V-1053', nozzle: 'N4' },
      { tag: 'V-1035', nozzle: 'N4' },
      4,
      'flare gas',
      'CS',
      '150',
      null
    ),
    line(
      'FL-1060-3-CS-150',
      { tag: 'L-1060', nozzle: 'N3' },
      { tag: 'V-1035', nozzle: 'N1' },
      3,
      'flare gas',
      'CS',
      '150',
      null
    ),
    line(
      'FL-1071-3-CS-150',
      { tag: 'V-1071', nozzle: 'N4' },
      { tag: 'V-1035', nozzle: 'N2' },
      3,
      'flare gas',
      'CS',
      '150',
      null
    )
  ];

  const inst = (tag, firstLetter, modifier, loopId, suffix, description, location, connectedTo) => ({
    tag,
    firstLetter,
    modifier,
    loopId,
    suffix,
    description,
    location,
    connectedTo
  });

  const instruments = [
    inst('PT-1001', 'P', 'T', '1001', 'A', 'Slug catcher pressure transmitter', 'field', {
      tag: 'V-1010',
      nozzle: 'N3'
    }),
    inst('PIC-1001', 'P', 'I', '1001', '', 'Slug catcher pressure indicating controller', 'dcs', {
      tag: 'V-1010',
      nozzle: 'N3'
    }),
    inst('LT-1001', 'L', 'T', '1001', 'A', 'Slug catcher level transmitter', 'field', { tag: 'V-1010', nozzle: 'N4' }),
    inst('LIC-1001', 'L', 'I', '1001', '', 'Slug catcher level indicating controller', 'dcs', {
      tag: 'V-1010',
      nozzle: 'N4'
    }),
    inst('PG-1001', 'P', 'G', '1001', '', 'Slug catcher local pressure gauge', 'local', {
      tag: 'V-1010',
      nozzle: 'N3'
    }),
    inst('PT-1020', 'P', 'T', '1020', '', 'HP separator pressure transmitter', 'field', {
      tag: 'V-1020',
      nozzle: 'N4'
    }),
    inst('PIC-1020', 'P', 'I', '1020', '', 'HP separator pressure indicating controller', 'dcs', {
      tag: 'V-1020',
      nozzle: 'N4'
    }),
    inst('LT-1020', 'L', 'T', '1020', '', 'HP separator level transmitter', 'field', { tag: 'V-1020', nozzle: 'N5' }),
    inst('LIC-1020', 'L', 'I', '1020', '', 'HP separator level indicating controller', 'dcs', {
      tag: 'V-1020',
      nozzle: 'N5'
    }),
    inst('TT-1020', 'T', 'T', '1020', '', 'HP separator temperature transmitter', 'field', {
      tag: 'V-1020',
      nozzle: 'N1'
    }),
    inst('LG-1020', 'L', 'G', '1020', '', 'HP separator local level gauge', 'local', { tag: 'V-1020', nozzle: 'N5' }),
    inst('PG-1020', 'P', 'G', '1020', '', 'HP separator local pressure gauge', 'local', {
      tag: 'V-1020',
      nozzle: 'N4'
    }),
    inst('PT-1021', 'P', 'T', '1021', '', 'LP separator pressure transmitter', 'field', {
      tag: 'V-1021',
      nozzle: 'N4'
    }),
    inst('PIC-1021', 'P', 'I', '1021', '', 'LP separator pressure indicating controller', 'dcs', {
      tag: 'V-1021',
      nozzle: 'N4'
    }),
    inst('LT-1021', 'L', 'T', '1021', '', 'LP separator level transmitter', 'field', { tag: 'V-1021', nozzle: 'N5' }),
    inst('LIC-1021', 'L', 'I', '1021', '', 'LP separator level indicating controller', 'dcs', {
      tag: 'V-1021',
      nozzle: 'N5'
    }),
    inst('TT-1021', 'T', 'T', '1021', '', 'LP separator temperature transmitter', 'field', {
      tag: 'V-1021',
      nozzle: 'N1'
    }),
    inst('TT-1030', 'T', 'T', '1030', '', 'Heater treater outlet temperature transmitter', 'field', {
      tag: 'H-1030',
      nozzle: 'N1'
    }),
    inst('TIC-1030', 'T', 'I', '1030', '', 'Heater treater temperature indicating controller', 'dcs', {
      tag: 'H-1030',
      nozzle: 'N1'
    }),
    inst('LT-1030', 'L', 'T', '1030', '', 'Heater treater level transmitter', 'field', { tag: 'H-1030', nozzle: 'N4' }),
    inst('PT-1030', 'P', 'T', '1030', '', 'Heater treater pressure transmitter', 'field', {
      tag: 'H-1030',
      nozzle: 'N3'
    }),
    inst('PG-1030', 'P', 'G', '1030', '', 'Heater treater local pressure gauge', 'local', {
      tag: 'H-1030',
      nozzle: 'N3'
    }),
    inst('LT-1031', 'L', 'T', '1031', '', 'Produced water tank level transmitter', 'field', {
      tag: 'T-1031',
      nozzle: 'N3'
    }),
    inst('LIC-1031', 'L', 'I', '1031', '', 'Produced water tank level indicating controller', 'dcs', {
      tag: 'T-1031',
      nozzle: 'N3'
    }),
    inst('PT-1031', 'P', 'T', '1031', '', 'Produced water tank pressure transmitter', 'field', {
      tag: 'T-1031',
      nozzle: 'N3'
    }),
    inst('LT-1035', 'L', 'T', '1035', '', 'Flare KO drum level transmitter', 'field', { tag: 'V-1035', nozzle: 'N7' }),
    inst('LIC-1035', 'L', 'I', '1035', '', 'Flare KO drum level indicating controller', 'dcs', {
      tag: 'V-1035',
      nozzle: 'N7'
    }),
    inst('PT-1035', 'P', 'T', '1035', '', 'Flare KO drum pressure transmitter', 'field', {
      tag: 'V-1035',
      nozzle: 'N5'
    }),
    inst('LG-1035', 'L', 'G', '1035', '', 'Flare KO drum local level gauge', 'local', { tag: 'V-1035', nozzle: 'N7' }),
    inst('PT-1040', 'P', 'T', '1040', '', 'TEG contactor pressure transmitter', 'field', {
      tag: 'C-1040',
      nozzle: 'N7'
    }),
    inst('PIC-1040', 'P', 'I', '1040', '', 'TEG contactor pressure indicating controller', 'dcs', {
      tag: 'C-1040',
      nozzle: 'N7'
    }),
    inst('LT-1040', 'L', 'T', '1040', '', 'TEG contactor level transmitter', 'field', { tag: 'C-1040', nozzle: 'N5' }),
    inst('LIC-1040', 'L', 'I', '1040', '', 'TEG contactor level indicating controller', 'dcs', {
      tag: 'C-1040',
      nozzle: 'N5'
    }),
    inst('TT-1040', 'T', 'T', '1040', '', 'TEG contactor overhead temperature transmitter', 'field', {
      tag: 'C-1040',
      nozzle: 'N2'
    }),
    inst('LG-1040', 'L', 'G', '1040', '', 'TEG contactor local level gauge', 'local', { tag: 'C-1040', nozzle: 'N5' }),
    inst('TT-1041', 'T', 'T', '1041', '', 'Reboiler temperature transmitter', 'field', { tag: 'E-1041', nozzle: 'N3' }),
    inst('TIC-1041', 'T', 'I', '1041', '', 'Reboiler temperature indicating controller', 'dcs', {
      tag: 'E-1041',
      nozzle: 'N3'
    }),
    inst('LT-1041', 'L', 'T', '1041', '', 'Reboiler level transmitter', 'field', { tag: 'E-1041', nozzle: 'N1' }),
    inst('FT-1042', 'F', 'T', '1042', '', 'Glycol circulation flow transmitter', 'field', {
      tag: 'P-1042',
      nozzle: 'N2'
    }),
    inst('TT-1043', 'T', 'T', '1043', '', 'Lean glycol outlet temperature transmitter', 'field', {
      tag: 'E-1043',
      nozzle: 'N6'
    }),
    inst('LT-1044', 'L', 'T', '1044', '', 'Filter separator level transmitter', 'field', {
      tag: 'V-1044',
      nozzle: 'N4'
    }),
    inst('LIC-1044', 'L', 'I', '1044', '', 'Filter separator level indicating controller', 'dcs', {
      tag: 'V-1044',
      nozzle: 'N4'
    }),
    inst('PT-1044', 'P', 'T', '1044', '', 'Filter separator pressure transmitter', 'field', {
      tag: 'V-1044',
      nozzle: 'N3'
    }),
    inst('LT-1050', 'L', 'T', '1050', '', 'Suction scrubber level transmitter', 'field', {
      tag: 'V-1050',
      nozzle: 'N4'
    }),
    inst('LIC-1050', 'L', 'I', '1050', '', 'Suction scrubber level indicating controller', 'dcs', {
      tag: 'V-1050',
      nozzle: 'N4'
    }),
    inst('PT-1050', 'P', 'T', '1050', '', 'Suction pressure transmitter (anti-surge)', 'field', {
      tag: 'V-1050',
      nozzle: 'N3'
    }),
    inst('PIC-1050', 'P', 'I', '1050', '', 'Suction pressure indicating controller', 'dcs', {
      tag: 'V-1050',
      nozzle: 'N3'
    }),
    inst('TT-1051', 'T', 'T', '1051', '', 'Compressor discharge temperature transmitter', 'field', {
      tag: 'K-1051',
      nozzle: 'N2'
    }),
    inst('PT-1051', 'P', 'T', '1051', '', 'Compressor discharge pressure transmitter', 'field', {
      tag: 'K-1051',
      nozzle: 'N2'
    }),
    inst('TT-1052', 'T', 'T', '1052', '', 'Discharge cooler outlet temperature transmitter', 'field', {
      tag: 'E-1052',
      nozzle: 'N2'
    }),
    inst('LT-1053', 'L', 'T', '1053', '', 'Discharge scrubber level transmitter', 'field', {
      tag: 'V-1053',
      nozzle: 'N4'
    }),
    inst('LIC-1053', 'L', 'I', '1053', '', 'Discharge scrubber level indicating controller', 'dcs', {
      tag: 'V-1053',
      nozzle: 'N4'
    }),
    inst('PT-1053', 'P', 'T', '1053', '', 'Discharge scrubber pressure transmitter', 'field', {
      tag: 'V-1053',
      nozzle: 'N3'
    }),
    inst('PG-1053', 'P', 'G', '1053', '', 'Discharge scrubber local pressure gauge', 'local', {
      tag: 'V-1053',
      nozzle: 'N3'
    }),
    inst('PT-1060', 'P', 'T', '1060', '', 'Pig launcher pressure transmitter', 'field', {
      tag: 'L-1060',
      nozzle: 'N3'
    }),
    inst('FT-1061', 'F', 'T', '1061', 'A', 'Metering skid flow transmitter (orifice)', 'field', {
      tag: 'F-1061',
      nozzle: 'N2'
    }),
    inst('FIC-1061', 'F', 'I', '1061', '', 'Metering skid flow indicating controller', 'dcs', {
      tag: 'F-1061',
      nozzle: 'N2'
    }),
    inst('PT-1061', 'P', 'T', '1061', '', 'Metering skid pressure transmitter', 'field', {
      tag: 'F-1061',
      nozzle: 'N1'
    }),
    inst('LT-1071', 'L', 'T', '1071', '', 'Fuel gas KO drum level transmitter', 'field', {
      tag: 'V-1071',
      nozzle: 'N4'
    }),
    inst('LIC-1071', 'L', 'I', '1071', '', 'Fuel gas KO drum level indicating controller', 'dcs', {
      tag: 'V-1071',
      nozzle: 'N4'
    }),
    inst('PT-1071', 'P', 'T', '1071', '', 'Fuel gas KO drum pressure transmitter', 'field', {
      tag: 'V-1071',
      nozzle: 'N4'
    }),
    inst('PG-1071', 'P', 'G', '1071', '', 'Fuel gas KO drum local pressure gauge', 'local', {
      tag: 'V-1071',
      nozzle: 'N4'
    })
  ];

  const valve = (tag, type, actuator, lineNumber, sizeIn, setPressureBarg) => {
    const v = { tag, type, actuator, lineNumber, sizeIn };
    if (setPressureBarg !== undefined) v.setPressureBarg = setPressureBarg;
    return v;
  };

  const valves = [
    valve('PCV-1001', 'control', 'pneumatic-fc', 'L-1011-12-CS-300-A1F', 12),
    valve('PCV-1020', 'control', 'pneumatic-fc', 'L-1020-10-CS-300-A1F', 10),
    valve('LCV-1020', 'control', 'pneumatic-fo', 'L-1022-6-CS-300-A1F', 6),
    valve('LCV-1023', 'control', 'pneumatic-fo', 'PW-1021-6-CS-150', 6),
    valve('PCV-1021', 'control', 'pneumatic-fo', 'FG-1021-4-CS-150', 4),
    valve('TCV-1030', 'control', 'pneumatic-fo', 'FG-1030-2-CS-150', 2),
    valve('PCV-1040', 'control', 'pneumatic-fc', 'L-1040-6-CS-600-A1F', 6),
    valve('PCV-1050', 'control', 'pneumatic-fo', 'L-1054-4-CS-600', 4),
    valve('LCV-1053', 'control', 'pneumatic-fo', 'L-1053-8-CS-600-A1F', 8),
    valve('FCV-1061', 'control', 'pneumatic-fo', 'L-1061-8-CS-600-A1F', 8),
    valve('XV-1001', 'xv', 'solenoid', 'L-1001-4-CS-150', 4),
    valve('XV-1060', 'xv', 'solenoid', 'L-1053-8-CS-600-A1F', 8),
    valve('GV-1001', 'gate', 'hand', 'L-1002-4-CS-150', 4),
    valve('GV-1050', 'gate', 'hand', 'L-1050-6-CS-600', 6),
    valve('GV-1061', 'gate', 'hand', 'L-1061-8-CS-600-A1F', 8),
    valve('BV-1010', 'ball', 'hand', 'L-1010-12-CS-300-A1F', 12),
    valve('BV-1040', 'ball', 'hand', 'L-1041-6-CS-600-A1F', 6),
    valve('CV-1042', 'check', 'spring', 'TG-1048-2-SS-150-A1F', 2),
    valve('CV-1051', 'check', 'spring', 'L-1051-6-CS-600-A1F', 6),
    valve('PSV-1010', 'psv', 'spring', 'FL-1010-6-CS-150', 6, 140),
    valve('PSV-1020', 'psv', 'spring', 'FL-1020-4-CS-150', 4, 120),
    valve('PSV-1021', 'psv', 'spring', 'FL-1021-4-CS-150', 4, 20),
    valve('PSV-1030', 'psv', 'spring', 'FL-1030-4-CS-150', 4, 90),
    valve('PSV-1031', 'psv', 'spring', 'FL-1031-2-CS-150', 2, 3),
    valve('PSV-1035', 'psv', 'spring', 'FL-1034-3-CS-150', 3, 15),
    valve('PSV-1040', 'psv', 'spring', 'FL-1040-4-CS-150', 4, 90),
    valve('PSV-1050', 'psv', 'spring', 'FL-1050-4-CS-150', 4, 50),
    valve('PSV-1053', 'psv', 'spring', 'FL-1053-4-CS-150', 4, 80),
    valve('PSV-1060', 'psv', 'spring', 'FL-1060-3-CS-150', 3, 100),
    valve('PSV-1071', 'psv', 'spring', 'FL-1071-3-CS-150', 3, 10)
  ];

  const controlLoops = [
    {
      loopTag: 'PIC-1001',
      sensorTag: 'PT-1001',
      controllerTag: 'PIC-1001',
      finalElementTag: 'PCV-1001',
      type: 'feedback'
    },
    {
      loopTag: 'PIC-1020',
      sensorTag: 'PT-1020',
      controllerTag: 'PIC-1020',
      finalElementTag: 'PCV-1020',
      type: 'feedback'
    },
    {
      loopTag: 'LIC-1020',
      sensorTag: 'LT-1020',
      controllerTag: 'LIC-1020',
      finalElementTag: 'LCV-1020',
      type: 'feedback'
    },
    {
      loopTag: 'LIC-1021',
      sensorTag: 'LT-1021',
      controllerTag: 'LIC-1021',
      finalElementTag: 'LCV-1023',
      type: 'feedback'
    },
    {
      loopTag: 'PIC-1021',
      sensorTag: 'PT-1021',
      controllerTag: 'PIC-1021',
      finalElementTag: 'PCV-1021',
      type: 'feedback'
    },
    {
      loopTag: 'TIC-1030',
      sensorTag: 'TT-1030',
      controllerTag: 'TIC-1030',
      finalElementTag: 'TCV-1030',
      type: 'feedback'
    },
    {
      loopTag: 'PIC-1040',
      sensorTag: 'PT-1040',
      controllerTag: 'PIC-1040',
      finalElementTag: 'PCV-1040',
      type: 'feedback'
    },
    {
      loopTag: 'PIC-1050',
      sensorTag: 'PT-1050',
      controllerTag: 'PIC-1050',
      finalElementTag: 'PCV-1050',
      type: 'feedback'
    },
    {
      loopTag: 'LIC-1053',
      sensorTag: 'LT-1053',
      controllerTag: 'LIC-1053',
      finalElementTag: 'LCV-1053',
      type: 'feedback'
    },
    {
      loopTag: 'FIC-1061',
      sensorTag: 'FT-1061',
      controllerTag: 'FIC-1061',
      finalElementTag: 'FCV-1061',
      type: 'feedback'
    }
  ];

  return {
    project: {
      name: 'OmniEng Gas Gathering & Processing Facility',
      number: 'OMNI-PID-001',
      client: 'OmniEng EPC',
      location: 'Permian Basin, TX',
      revision: '0',
      date: '2026-10-28',
      drawnBy: 'OmniEng Engineering',
      checkedBy: 'OmniEng Engineering',
      approvedBy: 'OmniEng Engineering'
    },
    areas,
    lines,
    instruments,
    valves,
    controlLoops,
    options: { padInches: 0.25, gridMm: 10, showGrid: true }
  };
}

function buildLngTemplate() {
  const eq = (tag, type, description, nozzles, inlets, outlets, vents, extra) => {
    const obj = {
      tag,
      type,
      description,
      x: 0,
      y: 0,
      nozzles: nz(nozzles),
      inletNozzles: inlets,
      outletNozzles: outlets,
      ventNozzles: vents
    };
    if (extra) Object.assign(obj, extra);
    return obj;
  };

  const line = (lineNumber, from, to, sizeIn, service, material, cls, insulation, extra) =>
    Object.assign(
      {
        lineNumber,
        from,
        to,
        sizeIn,
        service,
        material,
        class: cls,
        insulation
      },
      extra || {}
    );

  const areas = [
    {
      id: 'A-10',
      name: 'Feed Gas Preparation',
      order: 1,
      notes: [
        'Inlet battery limit BL-1000; feed gas ESD valve XV-1001 on high-high pressure.',
        'Inlet separator V-1001 protects downstream equipment from liquid slugs; relief via PSV-1001.',
        'Filtration F-1001 removes particulates; fiscal metering via M-1001.'
      ],
      equipment: [
        eq('BL-1000', 'battery_limit', 'Feed gas battery limit', { left: [['N1', 0]] }, ['N1'], [], []),
        eq(
          'V-1001',
          'vertical_separator',
          'Inlet feed-gas separator (3-phase)',
          { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]], bottom: [['N4', 0]] },
          ['N1'],
          ['N2', 'N4'],
          ['N3']
        ),
        eq(
          'F-1001',
          'filter_separator',
          'Coalescing filter separator',
          { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]] },
          ['N1'],
          ['N2'],
          ['N3']
        ),
        eq('M-1001', 'meter_skid', 'Custody transfer fiscal metering skid', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], [])
      ]
    },
    {
      id: 'A-20',
      name: 'Acid Gas Removal (Amine)',
      order: 2,
      notes: [
        'Lean amine circulation via P-2001/2002; rich amine regenerated in T-2002.',
        'Acid gas vented to flare via V-2001 knockout drum.',
        'Absorber sweet gas routed from T-2001 overhead to dehydration.'
      ],
      equipment: [
        eq(
          'T-2001',
          'absorption_column',
          'Amine absorber (MDEA), 30 trays',
          { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]], bottom: [['N4', 0]] },
          ['N1', 'N4'],
          ['N2'],
          ['N3']
        ),
        eq('P-2001', 'pump', 'Lean amine circulation pump (100%)', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq('P-2002', 'pump', 'Lean amine circulation pump (100% spare)', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq('E-2001', 'heat_exchanger', 'Rich/lean amine heat exchanger', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq(
          'T-2002',
          'stabilizer_column',
          'Amine regenerator column with reboiler',
          { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]], bottom: [['N4', 0]] },
          ['N1'],
          ['N2', 'N4'],
          ['N3']
        ),
        eq('V-2001', 'knockout_drum', 'Acid gas knockout drum', { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]] }, ['N1'], ['N2'], ['N3'])
      ]
    },
    {
      id: 'A-30',
      name: 'Dehydration (Glycol)',
      order: 3,
      notes: [
        'Triethylene glycol (TEG) contactor T-3001 dries sweet gas to <0.1 ppmv water.',
        'Glycol regenerator T-3002 with stripping gas; circulation P-3001/3002.',
        'Heat recovery via rich/lean glycol exchanger E-3001.'
      ],
      equipment: [
        eq(
          'T-3001',
          'absorption_column',
          'TEG contactor, 16 trays',
          { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]], bottom: [['N4', 0]] },
          ['N1', 'N4'],
          ['N2'],
          ['N3']
        ),
        eq('P-3001', 'pump', 'Lean glycol circulation pump (100%)', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq('P-3002', 'pump', 'Lean glycol circulation pump (100% spare)', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq(
          'T-3002',
          'stabilizer_column',
          'Glycol regenerator with reboiler and stripping section',
          { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]], bottom: [['N4', 0]] },
          ['N1'],
          ['N2', 'N4'],
          ['N3']
        ),
        eq('E-3001', 'heat_exchanger', 'Rich/lean glycol heat exchanger', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], [])
      ]
    },
    {
      id: 'A-40',
      name: 'Liquefaction & Refrigeration',
      order: 4,
      notes: [
        'Propane pre-cooling cycle C-4001 (closed loop) chills feed to -35 degC.',
        'Mixed-refrigerant (MR) cycle C-4002/C-4003 cools through main cryogenic exchanger E-4001.',
        'MCHE cold end delivers LNG at -155 degC to the end flash drum V-4001.'
      ],
      equipment: [
        eq(
          'E-4001',
          'heat_exchanger',
          'Main cryogenic heat exchanger (MCHE / coil-wound)',
          { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]], bottom: [['N4', 0]] },
          ['N1', 'N3'],
          ['N2', 'N4'],
          []
        ),
        eq('C-4001', 'compressor', 'Propane refrigeration compressor (1 of 2)', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq('C-4002', 'compressor', 'Mixed-refrigerant compressor (stage 1)', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq('C-4003', 'compressor', 'Mixed-refrigerant compressor (stage 2)', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq('A-4001', 'air_cooler', 'Propane condenser / aftercooler', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq('A-4002', 'air_cooler', 'MR aftercooler', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq('V-4001', 'horizontal_vessel', 'LNG flash drum (end flash)', { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]] }, ['N1'], ['N2'], ['N3']),
        eq('V-4002', 'vertical_separator', 'Refrigerant suction drum (MR)', { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]] }, ['N1'], ['N2'], ['N3'])
      ]
    },
    {
      id: 'A-50',
      name: 'LNG Storage, Boil-off & Send-out',
      order: 5,
      notes: [
        'LNG storage T-5001/5002 at 1.15 barg, -161.5 degC; full-containment design.',
        'BOG compressor C-5001 returns boil-off gas to fuel gas or liquefaction loop.',
        'Submerged send-out pumps P-5001/5002 feed open-rack seawater vaporizer E-5001.',
        'High-pressure gas exported via fiscal metering skid M-5001 to pipeline.'
      ],
      equipment: [
        eq('V-5001', 'knockout_drum', 'Flare knockout drum', { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]] }, ['N1'], ['N2'], ['N3']),
        eq('F-5001', 'flare', 'Elevated relief flare', { left: [['N1', 0]], bottom: [['N2', 0]] }, ['N2'], [], ['N1']),
        eq('T-5001', 'storage_tank', 'LNG storage tank (full containment, 160 000 m3)', { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]] }, ['N1'], ['N2'], ['N3']),
        eq('T-5002', 'storage_tank', 'LNG storage tank (full containment, 160 000 m3)', { left: [['N1', 0]], right: [['N2', 0]], top: [['N3', 0]] }, ['N1'], ['N2'], ['N3']),
        eq('C-5001', 'compressor', 'Boil-off gas compressor', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq('P-5001', 'pump', 'LNG send-out primary pump', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq('P-5002', 'pump', 'LNG send-out spare pump', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], []),
        eq('E-5001', 'heat_exchanger', 'LNG vaporizer (open-rack seawater)', { left: [['N1', 0]], right: [['N2', 0]], bottom: [['N3', 0]] }, ['N1', 'N3'], ['N2'], []),
        eq('M-5001', 'meter_skid', 'LNG export custody transfer metering', { left: [['N1', 0]], right: [['N2', 0]] }, ['N1'], ['N2'], [])
      ]
    }
  ];

  /* Lines with ISO 10628 stream numbers, design pressures, temperatures, and flows */
  const lines = [
    line('L-1010-24-CS-600-A1F', { tag: 'BL-1000', nozzle: 'N1' }, { tag: 'V-1001', nozzle: 'N1' }, 24, 'Feed gas', 'CS', '600', 'A1F', { streamNumber: 101, operatingPressureBarg: 60.0, operatingTemperatureC: 35.0, flowRateTH: 320.0, vaporFraction: 1.0 }),
    line('L-1011-16-CS-600-A1F', { tag: 'V-1001', nozzle: 'N2' }, { tag: 'F-1001', nozzle: 'N1' }, 16, 'Feed gas', 'CS', '600', 'A1F', { streamNumber: 102, operatingPressureBarg: 59.5, operatingTemperatureC: 34.8, flowRateTH: 315.0, vaporFraction: 1.0 }),
    line('L-1012-16-CS-600-A1F', { tag: 'F-1001', nozzle: 'N2' }, { tag: 'M-1001', nozzle: 'N1' }, 16, 'Feed gas', 'CS', '600', 'A1F', { streamNumber: 103, operatingPressureBarg: 59.0, operatingTemperatureC: 34.5, flowRateTH: 315.0, vaporFraction: 1.0 }),
    line('L-1013-16-CS-600-A1F', { tag: 'M-1001', nozzle: 'N2' }, { tag: 'T-2001', nozzle: 'N1' }, 16, 'Feed gas', 'CS', '600', 'A1F', { streamNumber: 104, operatingPressureBarg: 58.5, operatingTemperatureC: 35.0, flowRateTH: 315.0, vaporFraction: 1.0 }),
    line('L-1014-4-CS-300-A1F', { tag: 'V-1001', nozzle: 'N4' }, { tag: 'V-5001', nozzle: 'N1' }, 4, 'Condensate', 'CS', '300', 'A1F', { streamNumber: 105, operatingPressureBarg: 5.0, operatingTemperatureC: 35.0, flowRateTH: 5.0, vaporFraction: 0.0 }),
    line('L-1020-8-CS-300-A1F', { tag: 'T-2001', nozzle: 'N3' }, { tag: 'V-2001', nozzle: 'N1' }, 8, 'Acid gas', 'CS', '300', 'A1F', { streamNumber: 201, operatingPressureBarg: 2.5, operatingTemperatureC: 45.0, flowRateTH: 12.5, vaporFraction: 1.0 }),
    line('L-1021-8-CS-300-A1F', { tag: 'V-2001', nozzle: 'N2' }, { tag: 'F-5001', nozzle: 'N2' }, 8, 'Acid gas', 'CS', '300', 'A1F', { streamNumber: 202, operatingPressureBarg: 0.8, operatingTemperatureC: 40.0, flowRateTH: 12.5, vaporFraction: 1.0 }),
    line('L-1022-6-CS-300-A1F', { tag: 'T-2001', nozzle: 'N4' }, { tag: 'P-2001', nozzle: 'N1' }, 6, 'Amine', 'CS', '300', 'A1F', { streamNumber: 203, operatingPressureBarg: 58.0, operatingTemperatureC: 52.0, flowRateTH: 180.0, vaporFraction: 0.0 }),
    line('L-1023-6-CS-300-A1F', { tag: 'T-2001', nozzle: 'N4' }, { tag: 'P-2002', nozzle: 'N1' }, 6, 'Amine', 'CS', '300', 'A1F', { streamNumber: 204, operatingPressureBarg: 58.0, operatingTemperatureC: 52.0, flowRateTH: 0.0, vaporFraction: 0.0 }),
    line('L-1024-6-CS-300-A1F', { tag: 'P-2001', nozzle: 'N2' }, { tag: 'E-2001', nozzle: 'N1' }, 6, 'Amine', 'CS', '300', 'A1F', { streamNumber: 205, operatingPressureBarg: 62.0, operatingTemperatureC: 53.0, flowRateTH: 180.0, vaporFraction: 0.0 }),
    line('L-1025-6-CS-300-A1F', { tag: 'E-2001', nozzle: 'N2' }, { tag: 'T-2002', nozzle: 'N1' }, 6, 'Amine', 'CS', '300', 'A1F', { streamNumber: 206, operatingPressureBarg: 3.0, operatingTemperatureC: 98.0, flowRateTH: 180.0, vaporFraction: 0.05 }),
    line('L-1026-6-CS-300-A1F', { tag: 'T-2002', nozzle: 'N4' }, { tag: 'E-2001', nozzle: 'N1' }, 6, 'Amine', 'CS', '300', 'A1F', { streamNumber: 207, operatingPressureBarg: 2.0, operatingTemperatureC: 125.0, flowRateTH: 167.5, vaporFraction: 0.0 }),
    line('L-1030-16-CS-600-A1F', { tag: 'T-2001', nozzle: 'N2' }, { tag: 'T-3001', nozzle: 'N1' }, 16, 'Sweet gas', 'CS', '600', 'A1F', { streamNumber: 301, operatingPressureBarg: 57.5, operatingTemperatureC: 38.0, flowRateTH: 302.5, vaporFraction: 1.0 }),
    line('L-1031-6-CS-300-A1F', { tag: 'T-3001', nozzle: 'N4' }, { tag: 'P-3001', nozzle: 'N1' }, 6, 'Glycol', 'CS', '300', 'A1F', { streamNumber: 302, operatingPressureBarg: 57.0, operatingTemperatureC: 40.0, flowRateTH: 15.0, vaporFraction: 0.0 }),
    line('L-1032-6-CS-300-A1F', { tag: 'T-3001', nozzle: 'N4' }, { tag: 'P-3002', nozzle: 'N1' }, 6, 'Glycol', 'CS', '300', 'A1F', { streamNumber: 303, operatingPressureBarg: 57.0, operatingTemperatureC: 40.0, flowRateTH: 0.0, vaporFraction: 0.0 }),
    line('L-1033-6-CS-300-A1F', { tag: 'P-3001', nozzle: 'N2' }, { tag: 'E-3001', nozzle: 'N1' }, 6, 'Glycol', 'CS', '300', 'A1F', { streamNumber: 304, operatingPressureBarg: 60.0, operatingTemperatureC: 41.0, flowRateTH: 15.0, vaporFraction: 0.0 }),
    line('L-1034-6-CS-300-A1F', { tag: 'E-3001', nozzle: 'N2' }, { tag: 'T-3002', nozzle: 'N1' }, 6, 'Glycol', 'CS', '300', 'A1F', { streamNumber: 305, operatingPressureBarg: 1.5, operatingTemperatureC: 110.0, flowRateTH: 15.0, vaporFraction: 0.02 }),
    line('L-1035-6-CS-300-A1F', { tag: 'T-3002', nozzle: 'N4' }, { tag: 'E-3001', nozzle: 'N1' }, 6, 'Glycol', 'CS', '300', 'A1F', { streamNumber: 306, operatingPressureBarg: 1.2, operatingTemperatureC: 204.0, flowRateTH: 14.2, vaporFraction: 0.0 }),
    line('L-1040-14-SS-600-A1F', { tag: 'T-3001', nozzle: 'N2' }, { tag: 'E-4001', nozzle: 'N1' }, 14, 'Dry gas', 'SS', '600', 'A1F', { streamNumber: 401, operatingPressureBarg: 56.5, operatingTemperatureC: 30.0, flowRateTH: 301.7, vaporFraction: 1.0 }),
    line('L-1041-14-SS-600-A1F', { tag: 'E-4001', nozzle: 'N2' }, { tag: 'V-4001', nozzle: 'N1' }, 14, 'LNG', 'SS', '600', 'A1F', { streamNumber: 402, operatingPressureBarg: 52.0, operatingTemperatureC: -155.0, flowRateTH: 301.7, vaporFraction: 0.0 }),
    line('L-1042-12-CS-600-A1F', { tag: 'C-4001', nozzle: 'N2' }, { tag: 'A-4001', nozzle: 'N1' }, 12, 'Propane', 'CS', '600', 'A1F', { streamNumber: 403, operatingPressureBarg: 18.0, operatingTemperatureC: 85.0, flowRateTH: 220.0, vaporFraction: 1.0 }),
    line('L-1043-12-CS-600-A1F', { tag: 'A-4001', nozzle: 'N2' }, { tag: 'E-4001', nozzle: 'N3' }, 12, 'Propane', 'CS', '600', 'A1F', { streamNumber: 404, operatingPressureBarg: 16.5, operatingTemperatureC: 40.0, flowRateTH: 220.0, vaporFraction: 0.0 }),
    line('L-1044-10-SS-600-A1F', { tag: 'C-4002', nozzle: 'N2' }, { tag: 'A-4002', nozzle: 'N1' }, 10, 'Mixed refrigerant', 'SS', '600', 'A1F', { streamNumber: 405, operatingPressureBarg: 48.0, operatingTemperatureC: 95.0, flowRateTH: 195.0, vaporFraction: 1.0 }),
    line('L-1045-10-SS-600-A1F', { tag: 'A-4002', nozzle: 'N2' }, { tag: 'V-4002', nozzle: 'N1' }, 10, 'Mixed refrigerant', 'SS', '600', 'A1F', { streamNumber: 406, operatingPressureBarg: 46.5, operatingTemperatureC: 38.0, flowRateTH: 195.0, vaporFraction: 0.85 }),
    line('L-1046-10-SS-600-A1F', { tag: 'V-4002', nozzle: 'N2' }, { tag: 'C-4002', nozzle: 'N1' }, 10, 'Mixed refrigerant', 'SS', '600', 'A1F', { streamNumber: 407, operatingPressureBarg: 4.5, operatingTemperatureC: -35.0, flowRateTH: 165.0, vaporFraction: 1.0 }),
    line('L-1047-10-SS-600-A1F', { tag: 'V-4002', nozzle: 'N2' }, { tag: 'C-4003', nozzle: 'N1' }, 10, 'Mixed refrigerant', 'SS', '600', 'A1F', { streamNumber: 408, operatingPressureBarg: 18.0, operatingTemperatureC: -10.0, flowRateTH: 165.0, vaporFraction: 1.0 }),
    line('L-1050-16-SS-600-A1F', { tag: 'V-4001', nozzle: 'N2' }, { tag: 'T-5001', nozzle: 'N1' }, 16, 'LNG', 'SS', '600', 'A1F', { streamNumber: 501, operatingPressureBarg: 1.15, operatingTemperatureC: -161.5, flowRateTH: 143.0, vaporFraction: 0.0 }),
    line('L-1051-16-SS-600-A1F', { tag: 'V-4001', nozzle: 'N2' }, { tag: 'T-5002', nozzle: 'N1' }, 16, 'LNG', 'SS', '600', 'A1F', { streamNumber: 502, operatingPressureBarg: 1.15, operatingTemperatureC: -161.5, flowRateTH: 143.0, vaporFraction: 0.0 }),
    line('L-1052-4-CS-150-A1F', { tag: 'T-5001', nozzle: 'N3' }, { tag: 'C-5001', nozzle: 'N1' }, 4, 'Boil-off gas', 'CS', '150', 'A1F', { streamNumber: 503, operatingPressureBarg: 1.05, operatingTemperatureC: -140.0, flowRateTH: 4.8, vaporFraction: 1.0 }),
    line('L-1053-16-SS-600-A1F', { tag: 'T-5001', nozzle: 'N2' }, { tag: 'P-5001', nozzle: 'N1' }, 16, 'LNG', 'SS', '600', 'A1F', { streamNumber: 504, operatingPressureBarg: 1.2, operatingTemperatureC: -161.0, flowRateTH: 140.0, vaporFraction: 0.0 }),
    line('L-1054-16-SS-600-A1F', { tag: 'T-5002', nozzle: 'N2' }, { tag: 'P-5002', nozzle: 'N1' }, 16, 'LNG', 'SS', '600', 'A1F', { streamNumber: 505, operatingPressureBarg: 1.2, operatingTemperatureC: -161.0, flowRateTH: 0.0, vaporFraction: 0.0 }),
    line('L-1055-16-SS-600-A1F', { tag: 'P-5001', nozzle: 'N2' }, { tag: 'E-5001', nozzle: 'N1' }, 16, 'LNG', 'SS', '600', 'A1F', { streamNumber: 506, operatingPressureBarg: 75.0, operatingTemperatureC: -159.5, flowRateTH: 140.0, vaporFraction: 0.0 }),
    line('L-1056-16-SS-600-A1F', { tag: 'E-5001', nozzle: 'N2' }, { tag: 'M-5001', nozzle: 'N1' }, 16, 'Natural gas', 'SS', '600', 'A1F', { streamNumber: 507, operatingPressureBarg: 72.0, operatingTemperatureC: 15.0, flowRateTH: 140.0, vaporFraction: 1.0 }),
    line('L-1057-16-SS-600-A1F', { tag: 'M-5001', nozzle: 'N2' }, { tag: 'BL-1000', nozzle: 'N1' }, 16, 'Natural gas', 'SS', '600', 'A1F', { streamNumber: 508, operatingPressureBarg: 70.0, operatingTemperatureC: 15.0, flowRateTH: 140.0, vaporFraction: 1.0 })
  ];

  /* Instruments (ISA-5.1 tags) */
  const instruments = [
    { tag: 'FIC-1001', loopId: 'FIC-1001', firstLetter: 'F', modifier: 'IC', description: 'Feed gas flow control to amine absorber', location: 'dcs', connectedTo: { tag: 'T-2001' } },
    { tag: 'PIC-1001', loopId: 'PIC-1001', firstLetter: 'P', modifier: 'IC', description: 'Inlet separator pressure control', location: 'dcs', connectedTo: { tag: 'V-1001' } },
    { tag: 'LIC-1001', loopId: 'LIC-1001', firstLetter: 'L', modifier: 'IC', description: 'Inlet separator level control', location: 'dcs', connectedTo: { tag: 'V-1001' } },
    { tag: 'TIC-1001', loopId: 'TIC-1001', firstLetter: 'T', modifier: 'IC', description: 'Feed pre-heat temperature control', location: 'dcs', connectedTo: { tag: 'E-2001' } },
    { tag: 'FIC-2001', loopId: 'FIC-2001', firstLetter: 'F', modifier: 'IC', description: 'Lean amine circulation flow control', location: 'dcs', connectedTo: { tag: 'P-2001' } },
    { tag: 'LIC-2001', loopId: 'LIC-2001', firstLetter: 'L', modifier: 'IC', description: 'Amine regenerator reboiler level control', location: 'dcs', connectedTo: { tag: 'T-2002' } },
    { tag: 'TIC-2001', loopId: 'TIC-2001', firstLetter: 'T', modifier: 'IC', description: 'Regenerator overhead temperature control', location: 'dcs', connectedTo: { tag: 'T-2002' } },
    { tag: 'FIC-3001', loopId: 'FIC-3001', firstLetter: 'F', modifier: 'IC', description: 'Glycol circulation flow control', location: 'dcs', connectedTo: { tag: 'P-3001' } },
    { tag: 'TIC-3001', loopId: 'TIC-3001', firstLetter: 'T', modifier: 'IC', description: 'Glycol regenerator temperature control', location: 'dcs', connectedTo: { tag: 'T-3002' } },
    { tag: 'PIC-4001', loopId: 'PIC-4001', firstLetter: 'P', modifier: 'IC', description: 'MR compressor suction pressure control', location: 'dcs', connectedTo: { tag: 'V-4002' } },
    { tag: 'TIC-4001', loopId: 'TIC-4001', firstLetter: 'T', modifier: 'IC', description: 'MCHE LNG outlet temperature control', location: 'dcs', connectedTo: { tag: 'E-4001' } },
    { tag: 'PIC-4002', loopId: 'PIC-4002', firstLetter: 'P', modifier: 'IC', description: 'LNG flash drum pressure control', location: 'dcs', connectedTo: { tag: 'V-4001' } },
    { tag: 'LIC-4001', loopId: 'LIC-4001', firstLetter: 'L', modifier: 'IC', description: 'LNG flash drum liquid level control', location: 'dcs', connectedTo: { tag: 'V-4001' } },
    { tag: 'PIC-5001', loopId: 'PIC-5001', firstLetter: 'P', modifier: 'IC', description: 'LNG tank 1 pressure control (BOG suction)', location: 'dcs', connectedTo: { tag: 'T-5001' } },
    { tag: 'LIC-5001', loopId: 'LIC-5001', firstLetter: 'L', modifier: 'IC', description: 'LNG tank 1 level monitoring', location: 'dcs', connectedTo: { tag: 'T-5001' } },
    { tag: 'LIC-5002', loopId: 'LIC-5002', firstLetter: 'L', modifier: 'IC', description: 'LNG tank 2 level monitoring', location: 'dcs', connectedTo: { tag: 'T-5002' } },
    { tag: 'FIC-5001', loopId: 'FIC-5001', firstLetter: 'F', modifier: 'IC', description: 'LNG send-out flow control', location: 'dcs', connectedTo: { tag: 'P-5001' } },
    { tag: 'TIC-5001', loopId: 'TIC-5001', firstLetter: 'T', modifier: 'IC', description: 'LNG vaporizer outlet gas temperature control', location: 'dcs', connectedTo: { tag: 'E-5001' } },
    { tag: 'PIC-5002', loopId: 'PIC-5002', firstLetter: 'P', modifier: 'IC', description: 'Export gas pipeline pressure control', location: 'dcs', connectedTo: { tag: 'M-5001' } }
  ];

  /* Valves */
  const valves = [
    { tag: 'XV-1001', type: 'xv', actuator: 'solenoid', lineNumber: 'L-1010-24-CS-600-A1F', sizeIn: 24 },
    { tag: 'PCV-1001', type: 'control', actuator: 'pneumatic-fo', lineNumber: 'L-1011-16-CS-600-A1F', sizeIn: 16 },
    { tag: 'FCV-1013', type: 'control', actuator: 'pneumatic-fc', lineNumber: 'L-1013-16-CS-600-A1F', sizeIn: 16 },
    { tag: 'LCV-1014', type: 'control', actuator: 'pneumatic-fc', lineNumber: 'L-1014-4-CS-300-A1F', sizeIn: 4 },
    { tag: 'PCV-1020', type: 'control', actuator: 'pneumatic-fo', lineNumber: 'L-1020-8-CS-300-A1F', sizeIn: 8 },
    { tag: 'FCV-1024', type: 'control', actuator: 'pneumatic-fc', lineNumber: 'L-1024-6-CS-300-A1F', sizeIn: 6 },
    { tag: 'TCV-1026', type: 'control', actuator: 'pneumatic-fc', lineNumber: 'L-1026-6-CS-300-A1F', sizeIn: 6 },
    { tag: 'FCV-1033', type: 'control', actuator: 'pneumatic-fc', lineNumber: 'L-1033-6-CS-300-A1F', sizeIn: 6 },
    { tag: 'TCV-1035', type: 'control', actuator: 'pneumatic-fc', lineNumber: 'L-1035-6-CS-300-A1F', sizeIn: 6 },
    { tag: 'JTV-1041', type: 'control', actuator: 'pneumatic-fc', lineNumber: 'L-1041-14-SS-600-A1F', sizeIn: 14 },
    { tag: 'PCV-1042', type: 'control', actuator: 'pneumatic-fo', lineNumber: 'L-1042-12-CS-600-A1F', sizeIn: 12 },
    { tag: 'PCV-1044', type: 'control', actuator: 'pneumatic-fo', lineNumber: 'L-1044-10-SS-600-A1F', sizeIn: 10 },
    { tag: 'LCV-1050', type: 'control', actuator: 'pneumatic-fc', lineNumber: 'L-1050-16-SS-600-A1F', sizeIn: 16 },
    { tag: 'LCV-1051', type: 'control', actuator: 'pneumatic-fc', lineNumber: 'L-1051-16-SS-600-A1F', sizeIn: 16 },
    { tag: 'PCV-1052', type: 'control', actuator: 'pneumatic-fo', lineNumber: 'L-1052-4-CS-150-A1F', sizeIn: 4 },
    { tag: 'FCV-1055', type: 'control', actuator: 'pneumatic-fc', lineNumber: 'L-1055-16-SS-600-A1F', sizeIn: 16 },
    { tag: 'PCV-1057', type: 'control', actuator: 'pneumatic-fo', lineNumber: 'L-1057-16-SS-600-A1F', sizeIn: 16 },
    { tag: 'PSV-1001', type: 'psv', actuator: 'spring', lineNumber: 'L-1010-24-CS-600-A1F', sizeIn: 4, setPressureBarg: 75.0 },
    { tag: 'PSV-2001', type: 'psv', actuator: 'spring', lineNumber: 'L-1020-8-CS-300-A1F', sizeIn: 3, setPressureBarg: 72.0 }
  ];

  /* Control loops */
  const controlLoops = [
    { loopTag: 'FIC-1001', sensorTag: 'FIC-1001', controllerTag: 'FIC-1001', finalElementTag: 'FCV-1013', type: 'feedback' },
    { loopTag: 'PIC-1001', sensorTag: 'PIC-1001', controllerTag: 'PIC-1001', finalElementTag: 'PCV-1001', type: 'feedback' },
    { loopTag: 'LIC-1001', sensorTag: 'LIC-1001', controllerTag: 'LIC-1001', finalElementTag: 'LCV-1014', type: 'feedback' },
    { loopTag: 'FIC-2001', sensorTag: 'FIC-2001', controllerTag: 'FIC-2001', finalElementTag: 'FCV-1024', type: 'feedback' },
    { loopTag: 'TIC-2001', sensorTag: 'TIC-2001', controllerTag: 'TIC-2001', finalElementTag: 'TCV-1026', type: 'feedback' },
    { loopTag: 'FIC-3001', sensorTag: 'FIC-3001', controllerTag: 'FIC-3001', finalElementTag: 'FCV-1033', type: 'feedback' },
    { loopTag: 'TIC-3001', sensorTag: 'TIC-3001', controllerTag: 'TIC-3001', finalElementTag: 'TCV-1035', type: 'feedback' },
    { loopTag: 'TIC-4001', sensorTag: 'TIC-4001', controllerTag: 'TIC-4001', finalElementTag: 'JTV-1041', type: 'feedback' },
    { loopTag: 'PIC-5001', sensorTag: 'PIC-5001', controllerTag: 'PIC-5001', finalElementTag: 'PCV-1052', type: 'feedback' },
    { loopTag: 'FIC-5001', sensorTag: 'FIC-5001', controllerTag: 'FIC-5001', finalElementTag: 'FCV-1055', type: 'feedback' }
  ];

  return {
    project: {
      name: 'LNG Receiving & Liquefaction Facility',
      number: 'PID-LNG-2026-001',
      client: 'Global Clean Energy Terminals',
      location: 'Cryogenic Liquefaction Train 1',
      revision: '0',
      date: '2026-11-03',
      drawnBy: 'OmniEng PIDEngine',
      checkedBy: 'Tier-1 Engineering Verification',
      approvedBy: 'Process Engineering Lead'
    },
    areas,
    lines,
    instruments,
    valves,
    controlLoops,
    options: { padInches: 0.25, gridMm: 10, showGrid: true }
  };
}

/* ============================ Config normalization ======================= */

function normalizeConfig(config) {
  const src = config && typeof config === 'object' ? config : {};
  const project = Object.assign(
    {
      name: 'Untitled Project',
      number: 'PID-0000',
      client: '',
      location: '',
      revision: '0',
      date: '',
      drawnBy: '',
      checkedBy: '',
      approvedBy: ''
    },
    src.project || {}
  );
  const areas = Array.isArray(src.areas) ? src.areas.slice() : [];
  const lines = Array.isArray(src.lines) ? src.lines.slice() : [];
  const instruments = Array.isArray(src.instruments) ? src.instruments.slice() : [];
  const valves = Array.isArray(src.valves) ? src.valves.slice() : [];
  const controlLoops = Array.isArray(src.controlLoops) ? src.controlLoops.slice() : [];
  const options = Object.assign({ padInches: 0.25, gridMm: 10, showGrid: true }, src.options || {});
  return { project, areas, lines, instruments, valves, controlLoops, options };
}

/* ================================ Validation ============================ */

function validateConfig(cfg) {
  const errors = [];
  const warnings = [];

  const sortedAreas = cfg.areas
    .map((a, i) => ({ area: a, seq: i }))
    .sort((a, b) => (a.area.order || a.seq) - (b.area.order || b.seq))
    .map((x) => x.area);

  if (sortedAreas.length === 0) {
    errors.push('Config must define at least one area');
  }

  const equipList = [];
  for (const area of sortedAreas) {
    if (!Array.isArray(area.equipment)) {
      errors.push(`Area ${area.id || '?'} has no equipment array`);
      continue;
    }
    for (const eqObj of area.equipment) {
      equipList.push({ eq: eqObj, area });
    }
  }

  const eqByTag = new Map();
  const eqTags = new Set();
  for (const { eq, area } of equipList) {
    const tag = eq.tag;
    if (!tag || typeof tag !== 'string') {
      errors.push(`Equipment in area ${area.id || '?'} is missing a tag`);
      continue;
    }
    if (eqTags.has(tag)) {
      errors.push(`Duplicate equipment tag "${tag}" defined in area ${area.id || '?'}`);
    } else {
      eqTags.add(tag);
      eqByTag.set(tag, { eq, area });
    }
    if (!EQUIP_TYPES.has(eq.type)) {
      errors.push(`Unsupported equipment type "${eq.type}" for tag "${tag}"`);
    }
    const x = eq.x;
    const y = eq.y;
    if (typeof x === 'number' && !Number.isFinite(x)) {
      errors.push(`Equipment ${tag}: non-finite coordinate x=${x}`);
    }
    if (typeof y === 'number' && !Number.isFinite(y)) {
      errors.push(`Equipment ${tag}: non-finite coordinate y=${y}`);
    }
    if (typeof x === 'number' && x < 0) {
      errors.push(`Equipment ${tag}: negative coordinate x=${x}`);
    }
    if (typeof y === 'number' && y < 0) {
      errors.push(`Equipment ${tag}: negative coordinate y=${y}`);
    }
    const nozzleIds = new Set((eq.nozzles || []).map((n) => n.id));
    for (const ref of [].concat(eq.inletNozzles || [], eq.outletNozzles || [], eq.ventNozzles || [])) {
      if (ref && !nozzleIds.has(ref)) {
        errors.push(`Equipment ${tag}: reference to undefined nozzle "${ref}" in inlet/outlet/vent lists`);
      }
    }
  }

  const lineNumbers = new Set();
  const lineByNumber = new Map();
  for (const ln of cfg.lines) {
    const num = ln.lineNumber;
    if (!num || typeof num !== 'string') {
      errors.push('Line entry is missing lineNumber');
      continue;
    }
    if (lineNumbers.has(num)) {
      errors.push(`Duplicate line number "${num}"`);
    } else {
      lineNumbers.add(num);
      lineByNumber.set(num, ln);
    }
    if (!LINE_RE.test(num)) {
      errors.push(`Line "${num}" does not match the ISA line number pattern (e.g. L-1010-12-CS-150-A1F)`);
    }
    if (ln.sizeIn === undefined || ln.sizeIn === null) {
      errors.push(`Line ${num}: missing sizeIn`);
    }
    if (!ln.material) {
      errors.push(`Line ${num}: missing material`);
    }
    if (!ln.class) {
      errors.push(`Line ${num}: missing class`);
    }
    const fromTag = ln.from && ln.from.tag;
    const toTag = ln.to && ln.to.tag;
    if (!fromTag) {
      errors.push(`Line ${num}: missing "from" endpoint tag`);
    } else if (!eqByTag.has(fromTag)) {
      errors.push(`Line ${num}: endpoint references nonexistent equipment tag "${fromTag}"`);
    } else {
      const nzId = ln.from.nozzle;
      const nozzleIds = new Set((eqByTag.get(fromTag).eq.nozzles || []).map((n) => n.id));
      if (nzId && !nozzleIds.has(nzId)) {
        errors.push(`Line ${num}: nozzle "${nzId}" does not exist on equipment "${fromTag}"`);
      }
    }
    if (!toTag) {
      errors.push(`Line ${num}: missing "to" endpoint tag`);
    } else if (!eqByTag.has(toTag)) {
      errors.push(`Line ${num}: endpoint references nonexistent equipment tag "${toTag}"`);
    } else {
      const nzId = ln.to.nozzle;
      const nozzleIds = new Set((eqByTag.get(toTag).eq.nozzles || []).map((n) => n.id));
      if (nzId && !nozzleIds.has(nzId)) {
        errors.push(`Line ${num}: nozzle "${nzId}" does not exist on equipment "${toTag}"`);
      }
    }
    if (HYDROCARBON_RE.test(String(ln.service || '')) && !ln.insulation) {
      warnings.push(`Line ${num}: hydrocarbon service has no insulation specified`);
    }
    if (typeof ln.sizeIn === 'number' && ln.sizeIn > 24) {
      warnings.push(`Line ${num}: size ${ln.sizeIn} in exceeds 24 in`);
    }
    if (ln.class && !VALID_CLASSES.has(String(ln.class))) {
      warnings.push(`Line ${num}: class "${ln.class}" is nonstandard (150/300/600/900)`);
    }
  }

  const instrumentTags = new Set();
  for (const ic of cfg.instruments) {
    const tag = ic.tag;
    if (!tag) {
      errors.push('Instrument entry is missing a tag');
      continue;
    }
    if (instrumentTags.has(tag)) {
      errors.push(`Duplicate instrument tag "${tag}"`);
    } else {
      instrumentTags.add(tag);
    }
    if (ic.location && !VALID_LOCATIONS.has(ic.location)) {
      warnings.push(`Instrument ${tag}: location "${ic.location}" is not standard (field/local/panel/dcs)`);
    }
    if (ic.connectedTo) {
      const pTag = ic.connectedTo.tag;
      if (!eqByTag.has(pTag)) {
        errors.push(`Instrument ${tag}: connectedTo references nonexistent equipment tag "${pTag}"`);
      } else {
        const nzId = ic.connectedTo.nozzle;
        const nozzleIds = new Set((eqByTag.get(pTag).eq.nozzles || []).map((n) => n.id));
        if (nzId && !nozzleIds.has(nzId)) {
          errors.push(`Instrument ${tag}: nozzle "${nzId}" does not exist on equipment "${pTag}"`);
        }
      }
    } else {
      warnings.push(`Instrument ${tag}: no connectedTo process connection defined`);
    }
  }

  const valveTags = new Set();
  const valveByTag = new Map();
  for (const v of cfg.valves) {
    const tag = v.tag;
    if (!tag) {
      errors.push('Valve entry is missing a tag');
      continue;
    }
    if (valveTags.has(tag)) {
      errors.push(`Duplicate valve tag "${tag}"`);
    } else {
      valveTags.add(tag);
      valveByTag.set(tag, v);
    }
    if (!VALVE_TYPES.has(v.type)) {
      errors.push(`Unsupported valve type "${v.type}" for tag "${tag}"`);
    }
    if (v.actuator && !ACTUATORS.has(v.actuator)) {
      warnings.push(`Valve ${tag}: actuator "${v.actuator}" is not a standard symbol`);
    }
    if (v.type === 'psv' && (v.setPressureBarg === undefined || v.setPressureBarg === null)) {
      errors.push(`Valve ${tag}: missing setPressureBarg (required for psv)`);
    }
    if (
      v.type === 'psv' &&
      typeof v.setPressureBarg === 'number' &&
      (!Number.isFinite(v.setPressureBarg) || v.setPressureBarg <= 0)
    ) {
      errors.push(`Valve ${tag}: setPressureBarg must be a positive finite number`);
    }
    if (!v.lineNumber || !lineByNumber.has(v.lineNumber)) {
      errors.push(`Valve ${tag}: references nonexistent line "${v.lineNumber || ''}"`);
    }
  }

  const loopTags = new Set();
  for (const lp of cfg.controlLoops) {
    const lt = lp.loopTag;
    if (!lt) {
      errors.push('Control loop entry is missing loopTag');
      continue;
    }
    if (loopTags.has(lt)) {
      errors.push(`Duplicate control loop tag "${lt}"`);
    } else {
      loopTags.add(lt);
    }
    for (const role of [
      ['sensorTag', 'sensor'],
      ['controllerTag', 'controller']
    ]) {
      const key = role[0];
      const label = role[1];
      if (!lp[key]) {
        errors.push(`Control loop ${lt}: missing ${label} tag`);
      } else if (!instrumentTags.has(lp[key])) {
        errors.push(`Control loop ${lt}: ${label} tag "${lp[key]}" does not exist`);
      }
    }
    if (!lp.finalElementTag) {
      errors.push(`Control loop ${lt}: missing final element tag`);
    } else if (!valveTags.has(lp.finalElementTag)) {
      errors.push(`Control loop ${lt}: final element tag "${lp.finalElementTag}" does not exist`);
    }
    if (lp.type && !['feedback', 'cascade', 'ratio'].includes(lp.type)) {
      warnings.push(`Control loop ${lt}: type "${lp.type}" is not a standard loop type`);
    }
  }

  if (cfg.project.revision !== '0') {
    warnings.push(`Project revision "${cfg.project.revision}" is not "0"`);
  }

  const psvCoveredTags = new Set();
  for (const v of cfg.valves) {
    if (v.type !== 'psv') continue;
    const ln = lineByNumber.get(v.lineNumber);
    if (!ln) continue;
    if (ln.from && ln.from.tag) psvCoveredTags.add(ln.from.tag);
    if (ln.to && ln.to.tag) psvCoveredTags.add(ln.to.tag);
  }

  const connectedNozzleKeys = new Set();
  for (const ln of cfg.lines) {
    if (ln.from && ln.from.tag && ln.from.nozzle) connectedNozzleKeys.add(`${ln.from.tag}:${ln.from.nozzle}`);
    if (ln.to && ln.to.tag && ln.to.nozzle) connectedNozzleKeys.add(`${ln.to.tag}:${ln.to.nozzle}`);
  }

  for (const { eq, area } of equipList) {
    if (VESSEL_LIKE.has(eq.type) && !psvCoveredTags.has(eq.tag)) {
      warnings.push(`Equipment ${eq.tag} (${area.id || '?'}): pressure vessel has no PSV relief device`);
    }
    for (const ventId of eq.ventNozzles || []) {
      if (!connectedNozzleKeys.has(`${eq.tag}:${ventId}`)) {
        warnings.push(`Equipment ${eq.tag}: vent nozzle ${ventId} is not connected`);
      }
    }
  }

  return { errors, warnings };
}

/* ================================= Layout ================================ */

function computeLayout(cfg) {
  const sortedAreas = cfg.areas
    .map((a, i) => ({ area: a, seq: i }))
    .sort((a, b) => (a.area.order || a.seq) - (b.area.order || b.seq))
    .map((x) => x.area);

  const padInches = Number(cfg.options.padInches) || 0.25;
  const plotLeft = MARGIN + padInches * 25.4;
  const plotRight = 808;
  const plotTop = PLOT_TOP;
  const plotBottom = PLOT_BOTTOM;

  const areaCount = Math.max(1, sortedAreas.length);
  const bandW = (plotRight - plotLeft) / areaCount;

  const equip = [];
  const eqByTag = new Map();

  let eqIndex = 0;
  sortedAreas.forEach((area, ai) => {
    const bandLeft = plotLeft + ai * bandW;
    const list = Array.isArray(area.equipment) ? area.equipment : [];
    const numCols = list.length > 5 ? 2 : 1;
    const itemsPerCol = Math.ceil(list.length / numCols);

    list.forEach((eqObj, localIndex) => {
      const w = TYPE_DIMS[eqObj.type] ? TYPE_DIMS[eqObj.type][0] : 40;
      const h = TYPE_DIMS[eqObj.type] ? TYPE_DIMS[eqObj.type][1] : 40;
      const col = Math.floor(localIndex / itemsPerCol);
      const row = localIndex % itemsPerCol;
      const eqX =
        numCols === 1
          ? bandLeft + bandW * 0.38
          : col === 0
            ? bandLeft + bandW * 0.28
            : bandLeft + bandW * 0.72;
      const rowStep = (plotBottom - plotTop - 130) / Math.max(1, itemsPerCol - 1 || 1);
      const cy = itemsPerCol === 1 ? (plotTop + plotBottom) / 2 : plotTop + 65 + row * rowStep;

      const nozzleMap = {};
      for (const nz of eqObj.nozzles || []) {
        nozzleMap[nz.id] = { side: nz.side, offset: nz.offset || 0 };
      }
      const entry = {
        index: eqIndex,
        tag: eqObj.tag,
        type: eqObj.type,
        description: eqObj.description || '',
        area: area.id || '',
        cx: eqX,
        cy,
        w,
        h,
        nozzles: nozzleMap,
        inlets: (eqObj.inletNozzles || []).slice(),
        outlets: (eqObj.outletNozzles || []).slice(),
        vents: (eqObj.ventNozzles || []).slice(),
        isBoundary: !!eqObj.isBoundary || eqObj.type === 'battery_limit',
        toDwg: eqObj.toDwg,
        fromDwg: eqObj.fromDwg,
        toUnit: eqObj.toUnit,
        fromUnit: eqObj.fromUnit,
        continuation: eqObj.continuation,
        streamNumber: eqObj.streamNumber
      };
      const worldNozzles = {};
      for (const id of Object.keys(nozzleMap)) {
        worldNozzles[id] = nozzlePoint(entry, id);
      }
      entry.worldNozzles = worldNozzles;
      equip.push(entry);
      eqByTag.set(entry.tag, entry);
      eqIndex += 1;
    });
  });

  const lineLayouts = [];
  const valvesByTag = new Map();
  const valvesOnLine = new Map();

  for (const ln of cfg.lines) {
    const fromEq = eqByTag.get(ln.from && ln.from.tag);
    const toEq = eqByTag.get(ln.to && ln.to.tag);
    if (!fromEq || !toEq) continue;
    const fromP = fromEq.worldNozzles[ln.from.nozzle];
    const toP = toEq.worldNozzles[ln.to.nozzle];
    if (!fromP || !toP) continue;
    const fromSide = fromEq.nozzles[ln.from.nozzle].side;
    const toSide = toEq.nozzles[ln.to.nozzle].side;
    const path = routeLine(fromP, fromSide, toP, toSide);
    const { segs, total } = segmentInfo(path);
    const arrow = pointAtLength(segs, total / 2);
    const longSeg = longestSegment(segs);
    let label;
    if (Math.abs(longSeg.deg) > 45 && Math.abs(longSeg.deg) < 135) {
      label = { x: longSeg.midX, y: longSeg.midY, rotate: 90, axis: 'v' };
    } else {
      label = { x: longSeg.midX, y: longSeg.midY, rotate: 0, axis: 'h' };
    }
    const layout = { config: ln, path, segs, total, arrow, label };
    lineLayouts.push(layout);
  }

  // Group valves by line number to distribute multiple valves along process segments
  const valvesByLine = new Map();
  for (const v of cfg.valves) {
    if (!valvesByLine.has(v.lineNumber)) valvesByLine.set(v.lineNumber, []);
    valvesByLine.get(v.lineNumber).push(v);
  }

  for (const [lineNum, vList] of valvesByLine) {
    const idx = lineLayouts.findIndex((l) => l.config.lineNumber === lineNum);
    if (idx < 0) continue;
    const l = lineLayouts[idx];
    const longSeg = longestSegment(l.segs);
    const nValves = vList.length;

    vList.forEach((v, vIndex) => {
      let pos;
      let angle = longSeg ? longSeg.deg : 0;

      if (v.type === 'psv') {
        const s = l.segs[0];
        pos = { x: l.path[1][0], y: l.path[1][1] };
        angle = s.deg;
      } else {
        const ratio = v.positionRatio !== undefined ? v.positionRatio : (vIndex + 1) / (nValves + 1);
        if (longSeg && longSeg.len >= 16) {
          pos = {
            x: longSeg.x1 + (longSeg.x2 - longSeg.x1) * ratio,
            y: longSeg.y1 + (longSeg.y2 - longSeg.y1) * ratio
          };
          angle = longSeg.deg;
        } else {
          const targetSeg = l.segs[Math.min(vIndex, l.segs.length - 1)];
          pos = { x: targetSeg.midX, y: targetSeg.midY };
          angle = targetSeg.deg;
        }
      }

      valvesByTag.set(v.tag, {
        x: pos.x,
        y: pos.y,
        angle,
        type: v.type,
        actuator: v.actuator,
        tag: v.tag,
        sizeIn: v.sizeIn,
        state:
          v.state ||
          (v.actuator === 'pneumatic-fc'
            ? 'FC'
            : v.actuator === 'pneumatic-fo'
              ? 'FO'
              : v.type === 'manual' || v.type === 'gate'
                ? 'LO'
                : v.type === 'bsv'
                  ? 'NC'
                  : null),
        setPressureBarg: v.setPressureBarg,
        description: v.description,
        lineNumber: v.lineNumber
      });
    });
  }

  const instrumentLayouts = [];
  const instByTag = new Map();

  for (const eqEntry of equip) {
    const mine = cfg.instruments.filter((ic) => ic.connectedTo && ic.connectedTo.tag === eqEntry.tag);
    if (mine.length === 0) continue;
    const startY = eqEntry.cy - eqEntry.h / 2 - 6;
    mine.forEach((ic, i) => {
      const rawY = startY + i * 13;
      const y = Math.max(plotTop + 14, Math.min(plotBottom - 14, rawY));
      const isCtrl = ic.location === 'panel' || ic.location === 'dcs';
      const x = eqEntry.cx + eqEntry.w / 2 + (isCtrl ? 22 : 12);
      const entry = { config: ic, x, y, parent: eqEntry, isCtrl };
      instrumentLayouts.push(entry);
      instByTag.set(ic.tag, entry);
    });
  }

  const loopLayouts = [];
  for (const lp of cfg.controlLoops) {
    const sensor = instByTag.get(lp.sensorTag);
    const controller = instByTag.get(lp.controllerTag);
    const finalEl = valvesByTag.get(lp.finalElementTag);
    if (!sensor || !controller || !finalEl) continue;
    loopLayouts.push({ config: lp, sensor, controller, finalEl });
  }

  return {
    equip,
    eqByTag,
    lineLayouts,
    valvesByTag,
    instrumentLayouts,
    instByTag,
    loopLayouts,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    bandW,
    areaCount,
    sortedAreas
  };
}

/* ================================ Schedule ============================== */

function buildSchedule(cfg, layout) {
  const equipment = [];
  const lines = [];
  const instruments = [];
  const valves = [];
  const controlLoops = [];

  const sortedAreas = cfg.areas
    .map((a, i) => ({ area: a, seq: i }))
    .sort((a, b) => (a.area.order || a.seq) - (b.area.order || b.seq))
    .map((x) => x.area);

  for (const area of sortedAreas) {
    for (const eqObj of area.equipment || []) {
      let x = eqObj.x;
      let y = eqObj.y;
      if (layout) {
        const entry = layout.eqByTag.get(eqObj.tag);
        if (entry) {
          x = entry.cx;
          y = entry.cy;
        }
      }
      const equipmentRow = {
        tag: eqObj.tag,
        type: eqObj.type,
        description: eqObj.description || '',
        area: area.id || '',
        x,
        y,
        nozzles: (eqObj.nozzles || []).map((nz) => {
          const name = typeof nz === 'string' ? nz : (nz.id ?? nz.name ?? nz.n);
          return { id: String(name) };
        })
      };
      if (eqObj.isBoundary) equipmentRow.isBoundary = true;
      equipment.push(equipmentRow);
    }
  }

  for (const ln of cfg.lines) {
    const fromTag = ln.from && ln.from.tag ? ln.from.tag : '';
    const toTag = ln.to && ln.to.tag ? ln.to.tag : '';
    const row = {
      lineNumber: ln.lineNumber,
      sizeIn: ln.sizeIn,
      service: ln.service || '',
      material: ln.material || '',
      class: ln.class || '',
      insulation: ln.insulation || null,
      from: { tag: fromTag, nozzle: (ln.from && ln.from.nozzle) || '' },
      to: { tag: toTag, nozzle: (ln.to && ln.to.nozzle) || '' },
      flowDirection: `${fromTag} -> ${toTag}`
    };
    if (ln.streamNumber !== undefined) row.streamNumber = ln.streamNumber;
    if (ln.operatingPressureBarg !== undefined) row.operatingPressureBarg = ln.operatingPressureBarg;
    else if (ln.pressureBarg !== undefined) row.operatingPressureBarg = ln.pressureBarg;
    if (ln.operatingTemperatureC !== undefined) row.operatingTemperatureC = ln.operatingTemperatureC;
    else if (ln.temperatureC !== undefined) row.operatingTemperatureC = ln.temperatureC;
    if (ln.flowRateTH !== undefined) row.flowRateTH = ln.flowRateTH;
    else if (ln.flowRateKgH !== undefined) row.flowRateTH = Number((ln.flowRateKgH / 1000).toFixed(1));
    if (ln.vaporFraction !== undefined) row.vaporFraction = ln.vaporFraction;
    lines.push(row);
  }

  for (const ic of cfg.instruments) {
    instruments.push({
      tag: ic.tag,
      loopId: ic.loopId || '',
      firstLetter: ic.firstLetter || '',
      modifier: ic.modifier || '',
      description: ic.description || '',
      location: ic.location || '',
      connectedTo: ic.connectedTo ? { tag: ic.connectedTo.tag, nozzle: ic.connectedTo.nozzle || '' } : null
    });
  }

  for (const v of cfg.valves) {
    const row = {
      tag: v.tag,
      type: v.type,
      actuator: v.actuator || '',
      lineNumber: v.lineNumber || '',
      sizeIn: v.sizeIn
    };
    if (v.setPressureBarg !== undefined) row.setPressureBarg = v.setPressureBarg;
    valves.push(row);
  }

  for (const lp of cfg.controlLoops) {
    controlLoops.push({
      tag: lp.loopTag,
      loopId: lp.loopTag,
      loopTag: lp.loopTag,
      sensorTag: lp.sensorTag,
      controllerTag: lp.controllerTag,
      finalElementTag: lp.finalElementTag,
      sensor: lp.sensorTag,
      controller: lp.controllerTag,
      finalElement: lp.finalElementTag,
      type: lp.type || 'feedback'
    });
  }

  return { equipment, lines, instruments, valves, controlLoops };
}

/* ================================== Render ============================== */

function gridSvg(cfg) {
  if (!cfg.options.showGrid) return '';
  const minor = Math.max(2, Number(cfg.options.gridMm) || 10);
  const major = minor * 5;
  const parts = [];
  let minorLines = [];
  let majorLines = [];
  for (let x = MARGIN; x <= SHEET_W - MARGIN + 0.001; x += minor) {
    const isMajor = Math.abs((x - MARGIN) / major - Math.round((x - MARGIN) / major)) < 0.001;
    (isMajor ? majorLines : minorLines).push(`M${r(x)} ${MARGIN}L${r(x)} ${SHEET_H - MARGIN}`);
  }
  for (let y = MARGIN; y <= SHEET_H - MARGIN + 0.001; y += minor) {
    const isMajor = Math.abs((y - MARGIN) / major - Math.round((y - MARGIN) / major)) < 0.001;
    (isMajor ? majorLines : minorLines).push(`M${MARGIN} ${r(y)}L${SHEET_W - MARGIN} ${r(y)}`);
  }
  if (minorLines.length) {
    parts.push(`<path d="${minorLines.join('')}" stroke="#f0f0f0" stroke-width="0.2" fill="none"/>`);
  }
  if (majorLines.length) {
    parts.push(`<path d="${majorLines.join('')}" stroke="#e2e2e2" stroke-width="0.35" fill="none"/>`);
  }
  return parts.join('\n');
}

function frameSvg() {
  const parts = [];
  parts.push(
    `<rect x="${MARGIN}" y="${MARGIN}" width="${SHEET_W - 2 * MARGIN}" height="${SHEET_H - 2 * MARGIN}" fill="none" stroke="#1a1a1a" stroke-width="1.8"/>`
  );
  parts.push(
    `<rect x="${MARGIN + FRAME_INNER}" y="${MARGIN + FRAME_INNER}" width="${SHEET_W - 2 * (MARGIN + FRAME_INNER)}" height="${SHEET_H - 2 * (MARGIN + FRAME_INNER)}" fill="none" stroke="#1a1a1a" stroke-width="0.6"/>`
  );
  return parts.join('\n');
}

function plotAreaSvg(layout) {
  const parts = [];
  parts.push(
    `<rect x="${r(layout.plotLeft)}" y="${r(layout.plotTop)}" width="${r(layout.plotRight - layout.plotLeft)}" height="${r(layout.plotBottom - layout.plotTop)}" fill="none" stroke="#999" stroke-width="0.4" stroke-dasharray="2 2"/>`
  );
  for (let ai = 1; ai < layout.areaCount; ai += 1) {
    const x = layout.plotLeft + ai * layout.bandW;
    parts.push(
      `<line x1="${r(x)}" y1="${r(layout.plotTop)}" x2="${r(x)}" y2="${r(layout.plotBottom)}" stroke="#aaa" stroke-width="0.5" stroke-dasharray="1.5 2.5"/>`
    );
  }
  layout.sortedAreas.forEach((area, ai) => {
    const cx = layout.plotLeft + ai * layout.bandW + layout.bandW / 2;
    parts.push(text(cx, layout.plotTop + 8, area.name || area.id || '', { size: 4, weight: 'bold' }));
  });
  return parts.join('\n');
}

function renderEquipment(layout) {
  const parts = [];
  for (const eq of layout.equip) {
    const symbolParts = equipmentSymbolParts(eq.type);
    if (symbolParts.length === 0) continue;
    parts.push(`<g transform="translate(${r(eq.cx)},${r(eq.cy)})" stroke="#1a1a1a" stroke-width="1.1" fill="none">`);
    for (const p of symbolParts) parts.push('  ' + p);
    parts.push('</g>');

    if (!eq.isBoundary && eq.type !== 'battery_limit') {
      parts.push(text(eq.cx, eq.cy + eq.h / 2 + 7, eq.tag, { size: 3.5, weight: 'bold' }));
      if (eq.type === 'horizontal_vessel' || eq.type === 'vertical_separator' || eq.type === 'slug_catcher') {
        parts.push(text(eq.cx, eq.cy - eq.h / 2 - 4, eq.type.replace(/_/g, ' '), { size: 2.2, fill: '#666' }));
      }
    }

    parts.push(`<g stroke="#1a1a1a" stroke-width="0.5" fill="#ffffff">`);
    for (const id of Object.keys(eq.worldNozzles)) {
      const pt = eq.worldNozzles[id];
      parts.push(`  <circle cx="${r(pt[0])}" cy="${r(pt[1])}" r="1.3"/>`);
    }
    parts.push('</g>');

    if (eq.isBoundary || eq.type === 'battery_limit') {
      const desc = eq.description || '';
      const toMatch = desc.match(/\bto\s+([^,()]+)/i);
      const fromMatch = desc.match(/\bfrom\s+([^,()]+)/i);
      const targetUnit =
        eq.toUnit || (toMatch ? toMatch[1].trim() : eq.fromUnit || (fromMatch ? fromMatch[1].trim() : ''));
      const isFrom = !!(eq.fromUnit || fromMatch);
      const prefix = isFrom ? 'FROM' : 'TO';
      const dwgRef =
        eq.toDwg ||
        eq.fromDwg ||
        (eq.continuation && (eq.continuation.toDwg || eq.continuation.fromDwg)) ||
        '';

      parts.push(text(eq.cx, eq.cy - eq.h / 2 - 5, eq.tag, { size: 2.8, weight: 'bold', fill: '#1e3a8a' }));
      parts.push(
        text(
          eq.cx - 2,
          eq.cy - 1.5,
          `${prefix} ${targetUnit ? targetUnit.slice(0, 14) : 'BATTERY LIMIT'}`,
          { size: 2.3, weight: 'bold', fill: '#0f172a' }
        )
      );
      if (dwgRef) {
        parts.push(text(eq.cx - 2, eq.cy + 4.5, `DWG: ${dwgRef}`, { size: 2.0, weight: 'bold', fill: '#2563eb' }));
      }
      if (desc) {
        parts.push(text(eq.cx, eq.cy + eq.h / 2 + 7, desc, { size: 2.1, fill: '#475569' }));
      }
    }
  }
  return parts.join('\n');
}

function renderLines(layout, valvesByTag) {
  const parts = [];
  for (const l of layout.lineLayouts) {
    const isMajor =
      (l.config.sizeIn && l.config.sizeIn >= 8) ||
      (l.config.service && /gas|feed|liquid|lng|refrigerant|crude/i.test(l.config.service));
    const strokeW = isMajor ? '1.5' : '1.0';
    const strokeColor = isMajor ? '#111827' : '#374151';
    parts.push(`<polyline points="${pointsAttr(l.path)}" stroke="${strokeColor}" stroke-width="${strokeW}" fill="none"/>`);
    const a = l.arrow;
    const rad = (a.deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = 3.2 * cos;
    const dy = 3.2 * sin;
    const nx = 2.1 * -sin;
    const ny = 2.1 * cos;
    const p1 = `${r(a.x - dx + nx)},${r(a.y - dy + ny)}`;
    const p2 = `${r(a.x + dx)},${r(a.y + dy)}`;
    const p3 = `${r(a.x - dx - nx)},${r(a.y - dy - ny)}`;
    parts.push(`<polygon points="${p1} ${p2} ${p3}" fill="${strokeColor}"/>`);
    const lb = l.label;
    const labelText = l.config.lineNumber;
    parts.push(text(lb.x, lb.y - 2.6, labelText, { size: 2.8, rotate: lb.rotate, fill: '#1f2937' }));

    // Stream Number Diamond Flag & Operating Conditions Callout
    const sNum = l.config.streamNumber;
    if (sNum !== undefined && sNum !== null) {
      const sx = r(a.x - dx * 4);
      const sy = r(a.y - dy * 4);
      const dw = 4.5;
      const dh = 3.5;
      const dpts = `${r(sx)},${r(sy - dh)} ${r(sx + dw)},${r(sy)} ${r(sx)},${r(sy + dh)} ${r(sx - dw)},${r(sy)}`;
      parts.push(`<polygon points="${dpts}" fill="#ffffff" stroke="#004488" stroke-width="0.8"/>`);
      parts.push(text(sx, sy + 0.9, String(sNum), { size: 2.2, weight: 'bold', fill: '#004488' }));
    }

    const pBarg = l.config.operatingPressureBarg ?? l.config.pressureBarg;
    const tC = l.config.operatingTemperatureC ?? l.config.temperatureC;
    const flowVal =
      l.config.flowRateTH !== undefined
        ? `${l.config.flowRateTH} t/h`
        : l.config.flowRateKgH !== undefined
          ? `${(l.config.flowRateKgH / 1000).toFixed(1)} t/h`
          : null;
    if (pBarg !== undefined || tC !== undefined) {
      const condParts = [];
      if (pBarg !== undefined) condParts.push(`${pBarg} barg`);
      if (tC !== undefined) condParts.push(`${tC} °C`);
      if (flowVal) condParts.push(flowVal);
      const condText = condParts.join(' | ');
      parts.push(text(lb.x, lb.y + 4.2, condText, { size: 2.1, rotate: lb.rotate, fill: '#006699' }));
    }
  }
  return parts.join('\n');
}

function renderValves(valvesByTag) {
  const parts = [];
  for (const [tag, pos] of valvesByTag) {
    const type = pos.type || 'control';
    const angle = pos.angle || 0;
    parts.push(
      `<g transform="translate(${r(pos.x)},${r(pos.y)}) rotate(${r(angle)})" stroke="#1a1a1a" stroke-width="1.1" fill="none">`
    );
    for (const p of valveBodyParts(type)) parts.push('  ' + p);
    if (pos.actuator) {
      for (const p of actuatorParts(pos.actuator)) parts.push('  ' + p);
    }
    parts.push('</g>');

    // Tag (HV-1001A, FCV-1001, BSV-1001, etc.)
    const tagY = pos.y - 13;
    parts.push(text(pos.x, tagY, tag, { size: 2.6, weight: 'bold', fill: '#1a1a1a' }));

    // Size, State (LO, LC, NC, NO, FC, FO), and Set Pressure for PSVs
    const subParts = [];
    if (pos.sizeIn) subParts.push(`${pos.sizeIn}"`);
    if (pos.state) subParts.push(pos.state);
    if (type === 'psv' && pos.setPressureBarg !== undefined) {
      subParts.push(`Set: ${pos.setPressureBarg} barg`);
    }
    if (subParts.length > 0) {
      parts.push(text(pos.x, pos.y + 11.5, subParts.join(' '), { size: 2.2, weight: 'bold', fill: '#004488' }));
    }
  }
  return parts.join('\n');
}

function bubbleCompact(ic) {
  return String(ic.firstLetter || '') + String(ic.modifier || '');
}

function renderInstruments(layout) {
  const parts = [];
  for (const inst of layout.instrumentLayouts) {
    const ic = inst.config;
    const parent = inst.parent;
    const nozzlePt =
      parent && ic.connectedTo && ic.connectedTo.nozzle ? parent.worldNozzles[ic.connectedTo.nozzle] : null;
    if (nozzlePt) {
      parts.push(
        `<line x1="${r(inst.x)}" y1="${r(inst.y)}" x2="${r(nozzlePt[0])}" y2="${r(nozzlePt[1])}" stroke="#888" stroke-width="0.5"/>`
      );
    }
    const bubble = bubbleCompact(ic);
    parts.push(`<g transform="translate(${r(inst.x)},${r(inst.y)})" stroke="#1a1a1a" stroke-width="1.0" fill="none">`);
    if (ic.location === 'dcs') {
      parts.push(`  <rect x="-4.5" y="-4.5" width="9" height="9"/>`);
    } else if (ic.location === 'panel') {
      parts.push(`  <rect x="-4.5" y="-4.5" width="9" height="9" rx="2"/>`);
    } else if (ic.location === 'local') {
      parts.push(`  <circle cx="0" cy="0" r="4"/>`);
      parts.push(`  <line x1="-3.5" y1="5" x2="3.5" y2="5"/>`);
    } else {
      parts.push(`  <circle cx="0" cy="0" r="4"/>`);
    }
    parts.push(
      `  <text x="0" y="0.9" font-size="2.6" font-weight="bold" text-anchor="middle" fill="#1a1a1a">${esc(bubble)}</text>`
    );
    parts.push('</g>');
    parts.push(text(inst.x + 5.5, inst.y + 0.9, ic.tag, { size: 2.2, anchor: 'start', fill: '#333' }));
  }
  return parts.join('\n');
}

function loopStyle(type) {
  if (type === 'cascade') return { dash: '1 2', label: 'ELECTRIC SIGNAL' };
  if (type === 'ratio') return { dash: '8 3 1 3', label: 'SOFTWARE SIGNAL' };
  return { dash: '6 3', label: 'PNEUMATIC SIGNAL' };
}

function renderLoops(layout) {
  const parts = [];
  for (const lp of layout.loopLayouts) {
    const style = loopStyle(lp.config.type || 'feedback');
    const s = lp.sensor;
    const c = lp.controller;
    const f = lp.finalEl;
    parts.push(
      `<line x1="${r(s.x)}" y1="${r(s.y)}" x2="${r(c.x)}" y2="${r(c.y)}" stroke="#555" stroke-width="0.7" stroke-dasharray="${style.dash}"/>`
    );
    parts.push(
      `<line x1="${r(c.x)}" y1="${r(c.y)}" x2="${r(f.x)}" y2="${r(f.y)}" stroke="#666" stroke-width="0.7" stroke-dasharray="${style.dash}"/>`
    );
    const mx = (c.x + f.x) / 2;
    const my = (c.y + f.y) / 2;
    parts.push(text(mx, my - 2, style.label, { size: 2, fill: '#777' }));
  }
  return parts.join('\n');
}

function legendSvg(cfg) {
  const parts = [];
  parts.push(
    `<rect x="${LEGEND_X}" y="${LEGEND_Y}" width="${LEGEND_W}" height="170" fill="#fbfbfb" stroke="#1a1a1a" stroke-width="0.8"/>`
  );
  parts.push(text(LEGEND_X + 10, LEGEND_Y + 9, 'EQUIPMENT SYMBOLS', { size: 3.2, weight: 'bold', anchor: 'start' }));

  // Divider line
  const midX = LEGEND_X + 190;
  parts.push(`<line x1="${midX}" y1="${LEGEND_Y + 4}" x2="${midX}" y2="${LEGEND_Y + 166}" stroke="#cbd5e1" stroke-width="0.8"/>`);
  parts.push(text(midX + 10, LEGEND_Y + 9, 'VALVE & PIPING SYMBOL KEY (ISA-5.1)', { size: 3.2, weight: 'bold', anchor: 'start', fill: '#003366' }));

  const usedTypes = [];
  const seen = new Set();
  for (const area of cfg.areas) {
    for (const eqObj of area.equipment || []) {
      if (!seen.has(eqObj.type) && EQUIP_TYPES.has(eqObj.type)) {
        seen.add(eqObj.type);
        usedTypes.push(eqObj.type);
      }
    }
  }

  const leftColW = 85;
  const rowH = 13;
  usedTypes.slice(0, 22).forEach((type, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const gx = LEGEND_X + 6 + col * leftColW;
    const gy = LEGEND_Y + 18 + row * rowH;
    const slotX = gx + 8;
    const slotY = gy + rowH / 2;
    parts.push(
      `<g transform="translate(${r(slotX)},${r(slotY)}) scale(0.20)" stroke="#1a1a1a" stroke-width="1.1" fill="none">`
    );
    for (const p of equipmentSymbolParts(type)) parts.push('  ' + p);
    parts.push('</g>');
    parts.push(text(gx + 22, gy + rowH / 2 + 1, type.replace(/_/g, ' '), { size: 2.1, anchor: 'start' }));
  });

  // Right side: Industrial Valve & Piping Key
  const valveKeyItems = [
    { type: 'ball', actuator: null, label: 'Ball Valve (Full Bore, ISA-5.1)' },
    { type: 'manual', actuator: 'hand', label: 'Manual Gate Valve (Handwheel, LO)' },
    { type: 'check', actuator: null, label: 'Check Valve (Non-Return Swing)' },
    { type: 'psv', actuator: 'spring', label: 'Pressure Safety Relief Valve (API 520)' },
    { type: 'bsv', actuator: null, label: 'Bleed Safety Valve / DBB Station' },
    { type: 'control', actuator: 'pneumatic-fc', label: 'Control Valve (Pneumatic Fail-Close)' },
    { type: 'butterfly', actuator: null, label: 'Butterfly Throttle Valve' },
    { type: 'spectacle_blind', actuator: null, label: 'Spectacle Blind (Open / Blind)' },
    { type: 'xv', actuator: 'solenoid', label: 'Emergency Shutdown Valve (ESV / Solenoid)' }
  ];

  valveKeyItems.forEach((item, vi) => {
    const vy = LEGEND_Y + 22 + vi * 15.5;
    const vx = midX + 18;
    parts.push(
      `<g transform="translate(${r(vx)},${r(vy)}) scale(0.7)" stroke="#1a1a1a" stroke-width="1.2" fill="none">`
    );
    for (const p of valveBodyParts(item.type)) parts.push('  ' + p);
    if (item.actuator) {
      for (const p of actuatorParts(item.actuator)) parts.push('  ' + p);
    }
    parts.push('</g>');
    parts.push(text(vx + 20, vy + 1.2, item.label, { size: 2.3, anchor: 'start', fill: '#1f2937' }));
  });

  // Off-Page Chevron Legend Entry
  const opy = LEGEND_Y + 22 + valveKeyItems.length * 15.5;
  const opx = midX + 18;
  parts.push(
    `<g transform="translate(${r(opx)},${r(opy)}) scale(0.5)" stroke="#1e3a8a" stroke-width="1.4" fill="none">`
  );
  for (const p of symbBatteryLimit()) parts.push('  ' + p);
  parts.push('</g>');
  parts.push(text(opx + 20, opy + 1.2, 'Off-Page Continuation Chevron (ISO 10628)', { size: 2.3, weight: 'bold', anchor: 'start', fill: '#1e3a8a' }));

  return parts.join('\n');
}

function lineClassTableSvg(cfg) {
  const parts = [];
  const groups = new Map();
  for (const ln of cfg.lines) {
    const key = `${ln.material}|${ln.class}|${ln.insulation || ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        material: ln.material,
        class: ln.class,
        insulation: ln.insulation || null,
        service: ln.service || ''
      });
    }
  }
  const rows = Array.from(groups.values()).sort((a, b) => {
    const ca = Number(a.class) || 0;
    const cb = Number(b.class) || 0;
    if (ca !== cb) return ca - cb;
    return String(a.material).localeCompare(String(b.material));
  });
  const x0 = LINECLASS_X;
  const y0 = LINECLASS_Y;
  const w = LINECLASS_W;
  const headH = 8;
  const rowH = 8;
  const h = headH + rowH * rows.length;
  parts.push(
    `<rect x="${x0}" y="${y0}" width="${w}" height="${Math.max(60, h)}" fill="#fbfbfb" stroke="#1a1a1a" stroke-width="0.8"/>`
  );
  parts.push(text(x0 + 10, y0 + 9, 'LINE CLASSES', { size: 3.4, weight: 'bold', anchor: 'start' }));
  const cols = [64, 62, 80, 180];
  let cx = x0 + 10;
  const header = ['Class', 'Material', 'Insulation', 'Typical Service'];
  const ys = y0 + 18;
  parts.push(`<line x1="${x0 + 8}" y1="${ys}" x2="${x0 + w - 8}" y2="${ys}" stroke="#1a1a1a" stroke-width="0.5"/>`);
  header.forEach((hText, i) => {
    parts.push(text(cx + cols[i] / 2, ys - 2.5, hText, { size: 2.6, weight: 'bold' }));
    cx += cols[i];
  });
  rows.forEach((row, i) => {
    const ry = ys + 4 + i * rowH;
    const vals = [row.class, row.material, row.insulation || '-', row.service];
    let cx2 = x0 + 10;
    vals.forEach((v, j) => {
      parts.push(text(cx2 + cols[j] / 2, ry + 0.5, String(v), { size: 2.4, anchor: 'middle', fill: '#333' }));
      cx2 += cols[j];
    });
  });
  return parts.join('\n');
}

function streamTableSvg(cfg) {
  const parts = [];
  const x0 = 810;
  const y0 = 24;
  const w = 359;
  const h = 484;

  parts.push(
    `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#fcfcfc" stroke="#1a1a1a" stroke-width="0.8"/>`
  );
  // Title banner
  parts.push(`<rect x="${x0}" y="${y0}" width="${w}" height="14" fill="#003366"/>`);
  parts.push(
    text(x0 + w / 2, y0 + 9.5, 'HEAT & MATERIAL BALANCE (H&MB) — STREAM SUMMARY', {
      size: 3.4,
      weight: 'bold',
      fill: '#ffffff'
    })
  );
  parts.push(
    text(x0 + 10, y0 + 20, 'PROCESS DESIGN OPERATING CONDITIONS (ISO 10628 / PIP PIC001)', {
      size: 2.3,
      weight: 'bold',
      fill: '#333333',
      anchor: 'start'
    })
  );

  const cols = [24, 115, 26, 48, 44, 52, 38];
  const headers = ['Str', 'Service / Description', 'Ph', 'P (barg)', 'T (°C)', 'Flow (t/h)', 'β (Vap)'];
  const yH = y0 + 24;
  parts.push(
    `<rect x="${x0 + 6}" y="${yH}" width="${w - 12}" height="8" fill="#eef2f7" stroke="#cbd5e1" stroke-width="0.4"/>`
  );

  let hx = x0 + 10;
  headers.forEach((hdr, i) => {
    const anchor = i === 1 ? 'start' : 'middle';
    const tx = i === 1 ? hx + 2 : hx + cols[i] / 2;
    parts.push(text(tx, yH + 5.5, hdr, { size: 2.3, weight: 'bold', anchor, fill: '#002244' }));
    hx += cols[i];
  });

  const streamLines = (cfg.lines || []).filter(
    (l) =>
      l.streamNumber !== undefined ||
      l.operatingPressureBarg !== undefined ||
      l.pressureBarg !== undefined ||
      l.operatingTemperatureC !== undefined
  );
  const rows =
    streamLines.length > 0
      ? streamLines
      : (cfg.lines || []).slice(0, 32).map((l, idx) => Object.assign({ streamNumber: idx + 101 }, l));

  const maxRows = Math.min(34, rows.length);
  const rowH = 11.2;
  const startY = yH + 10;

  for (let rIdx = 0; rIdx < maxRows; rIdx++) {
    const l = rows[rIdx];
    const ry = startY + rIdx * rowH;
    const sNum = l.streamNumber !== undefined ? String(l.streamNumber) : String(rIdx + 1);
    const serv = String(l.service || '-');
    const vapFrac = Number.isFinite(l.vaporFraction) ? Number(l.vaporFraction).toFixed(2) : '-';
    const phase =
      l.vaporFraction === 1 ? 'V' : l.vaporFraction === 0 ? 'L' : Number.isFinite(l.vaporFraction) ? '2P' : '-';
    const press =
      l.operatingPressureBarg !== undefined
        ? Number(l.operatingPressureBarg).toFixed(1)
        : l.pressureBarg !== undefined
          ? Number(l.pressureBarg).toFixed(1)
          : '-';
    const temp =
      l.operatingTemperatureC !== undefined
        ? Number(l.operatingTemperatureC).toFixed(1)
        : l.temperatureC !== undefined
          ? Number(l.temperatureC).toFixed(1)
          : '-';
    const flow =
      l.flowRateTH !== undefined
        ? Number(l.flowRateTH).toFixed(1)
        : l.flowRateKgH !== undefined
          ? (Number(l.flowRateKgH) / 1000).toFixed(1)
          : '-';

    if (rIdx % 2 === 1) {
      parts.push(
        `<rect x="${x0 + 6}" y="${r(ry - 2.5)}" width="${w - 12}" height="${rowH}" fill="#f8fafc" opacity="0.7"/>`
      );
    }
    parts.push(
      `<line x1="${x0 + 6}" y1="${r(ry + rowH - 2.5)}" x2="${x0 + w - 6}" y2="${r(ry + rowH - 2.5)}" stroke="#e2e8f0" stroke-width="0.3"/>`
    );

    let rx = x0 + 10;
    // Diamond icon for stream number
    const dw = 3.5;
    const dh = 2.6;
    const dcx = rx + cols[0] / 2;
    const dcy = ry + 2;
    parts.push(
      `<polygon points="${r(dcx)},${r(dcy - dh)} ${r(dcx + dw)},${r(dcy)} ${r(dcx)},${r(dcy + dh)} ${r(dcx - dw)},${r(dcy)}" fill="#004488"/>`
    );
    parts.push(text(dcx, dcy + 0.8, sNum, { size: 1.9, weight: 'bold', fill: '#ffffff' }));
    rx += cols[0];

    // Service
    parts.push(
      text(rx + 2, ry + 2.8, serv.length > 20 ? serv.slice(0, 19) + '…' : serv, {
        size: 2.1,
        anchor: 'start',
        fill: '#1e293b'
      })
    );
    rx += cols[1];

    // Phase
    parts.push(
      text(rx + cols[2] / 2, ry + 2.8, phase, {
        size: 2.1,
        weight: 'bold',
        fill: phase === 'V' ? '#b45309' : phase === 'L' ? '#0369a1' : '#475569'
      })
    );
    rx += cols[2];

    // Pressure
    parts.push(text(rx + cols[3] / 2, ry + 2.8, press, { size: 2.1, fill: '#0f172a' }));
    rx += cols[3];

    // Temperature
    parts.push(text(rx + cols[4] / 2, ry + 2.8, temp, { size: 2.1, fill: '#0f172a' }));
    rx += cols[4];

    // Flow
    parts.push(text(rx + cols[5] / 2, ry + 2.8, flow, { size: 2.1, fill: '#0f172a' }));
    rx += cols[5];

    // Vapor fraction
    parts.push(text(rx + cols[6] / 2, ry + 2.8, vapFrac, { size: 2.1, fill: '#475569' }));
  }

  // Footer notes
  parts.push(
    text(
      x0 + 10,
      y0 + h - 4,
      'Notes: Operating conditions at 100% design throughput (MCR). Thermo calculated via Peng-Robinson PR-78.',
      { size: 2.0, fill: '#64748b', anchor: 'start' }
    )
  );

  return parts.join('\n');
}

function notesSvg() {
  const parts = [];
  const notes = [
    'SYMBOLOGY PER ISA-5.1 / ISO 14617',
    'NOMINAL SIZES IN INCHES',
    'INSTRUMENT LOCATIONS: FIELD/LOCAL/PANEL/DCS',
    'All PSV set pressures are design basis values; verification required before fabrication'
  ];
  parts.push(
    `<rect x="${NOTES_X}" y="${NOTES_Y}" width="${NOTES_W}" height="158" fill="#fbfbfb" stroke="#1a1a1a" stroke-width="0.8"/>`
  );
  parts.push(text(NOTES_X + 10, NOTES_Y + 9, 'NOTES', { size: 3.4, weight: 'bold', anchor: 'start' }));
  notes.forEach((n, i) => {
    const y = NOTES_Y + 22 + i * 14;
    parts.push(`<circle cx="${NOTES_X + 12}" cy="${y - 1.5}" r="1.2" fill="#1a1a1a"/>`);
    parts.push(text(NOTES_X + 20, y, n, { size: 2.6, anchor: 'start' }));
  });
  return parts.join('\n');
}

function titleBlockSvg(project, sheetNumber) {
  const parts = [];
  const x0 = TITLE_BLOCK_X;
  const y0 = TITLE_BLOCK_Y;
  const w = TITLE_BLOCK_W;
  const h = TITLE_BLOCK_H;
  parts.push(
    `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#fbfbfb" stroke="#1a1a1a" stroke-width="1.0"/>`
  );
  parts.push(text(x0 + w / 2, y0 + 8, 'OmniEng P&ID', { size: 3.6, weight: 'bold' }));
  const labelW = 105;
  const fields = [
    ['Project Name', project.name],
    ['Project Number', project.number],
    ['Client', project.client],
    ['Location', project.location],
    ['Document Number', `${project.number}-PID-${sheetNumber}`],
    ['Revision', project.revision],
    ['Date', project.date],
    ['Drawn', project.drawnBy],
    ['Checked', project.checkedBy],
    ['Approved', project.approvedBy],
    ['Scale', '1:50'],
    ['Sheet', `Sheet ${sheetNumber} of 1`]
  ];
  const rowH = (h - 18) / fields.length;
  fields.forEach((f, i) => {
    const y = y0 + 16 + i * rowH + rowH / 2;
    parts.push(
      `<line x1="${x0}" y1="${r(y - rowH / 2)}" x2="${x0 + w}" y2="${r(y - rowH / 2)}" stroke="#bbb" stroke-width="0.3"/>`
    );
    parts.push(text(x0 + 6, y + 0.8, f[0], { size: 2.6, weight: 'bold', anchor: 'start' }));
    parts.push(
      `<line x1="${x0 + labelW}" y1="${r(y - rowH / 2)}" x2="${x0 + labelW}" y2="${r(y + rowH / 2)}" stroke="#bbb" stroke-width="0.3"/>`
    );
    parts.push(text(x0 + labelW + 6, y + 0.8, f[1], { size: 2.6, anchor: 'start' }));
  });
  parts.push(`<line x1="${x0}" y1="${y0 + h}" x2="${x0 + w}" y2="${y0 + h}" stroke="#1a1a1a" stroke-width="0.6"/>`);
  return parts.join('\n');
}

function renderSheet(cfg, layout, sheetNumber) {
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}mm" height="${SHEET_H}mm" viewBox="0 0 ${SHEET_W} ${SHEET_H}" font-family="${FONT}" font-size="3">`
  );
  parts.push(`<rect width="${SHEET_W}" height="${SHEET_H}" fill="#ffffff"/>`);
  parts.push(gridSvg(cfg));
  parts.push(frameSvg());
  parts.push(plotAreaSvg(layout));
  parts.push(renderLines(layout));
  parts.push(renderValves(layout.valvesByTag));
  parts.push(renderEquipment(layout));
  parts.push(renderInstruments(layout));
  parts.push(renderLoops(layout));
  parts.push(legendSvg(cfg));
  parts.push(lineClassTableSvg(cfg));
  parts.push(streamTableSvg(cfg));
  parts.push(notesSvg());
  parts.push(titleBlockSvg(cfg.project, sheetNumber));
  parts.push('</svg>');
  return parts.join('\n');
}

/* ================================ Engine ================================ */

/**
 * PIDEngine — generates P&ID sheets, schedules, and validation reports.
 * Deterministic, dependency-free, CommonJS.
 */
class PIDEngine {
  /**
   * @param {object} [options] engine options (currently informational; layout
   *   options are read from the per-run config).
   */
  constructor(options) {
    this.options = Object.assign({ padInches: 0.25, gridMm: 10, showGrid: true }, options || {});
  }

  /**
   * Default full-scale oil & gas production facility config.
   * @returns {object} config object accepted by createPID().
   */
  static oilGasProductionTemplate() {
    return buildOilGasTemplate();
  }

  /**
   * Instance alias for PIDEngine.oilGasProductionTemplate().
   * @returns {object} config object accepted by createPID().
   */
  oilGasProductionTemplate() {
    return PIDEngine.oilGasProductionTemplate();
  }

  /**
   * Default full-scale LNG receiving and liquefaction facility config.
   * @returns {object} config object accepted by createPID().
   */
  static lngPlantTemplate() {
    return buildLngTemplate();
  }

  /**
   * Instance alias for PIDEngine.lngPlantTemplate().
   * @returns {object} config object accepted by createPID().
   */
  lngPlantTemplate() {
    return PIDEngine.lngPlantTemplate();
  }

  /**
   * Generate a P&ID drawing set from a config object.
   * @param {object} config
   * @returns {object} result { success, sheets, schedule, validation }
   */
  createPID(config) {
    const cfg = normalizeConfig(config);
    const validation = validateConfig(cfg);

    let layout = null;
    try {
      layout = computeLayout(cfg);
    } catch (err) {
      if (validation.errors.length === 0) {
        validation.errors.push(`Layout computation failed: ${err.message}`);
      }
    }

    const schedule = buildSchedule(cfg, layout);

    if (validation.errors.length > 0) {
      return { success: false, sheets: [], schedule, validation };
    }

    const sheetCount = 1;
    const sheets = [];
    const sheetTitle = `P&ID — ${cfg.project.name} — Sheet 1 of ${sheetCount}`;
    const svg = renderSheet(cfg, layout, 1);
    sheets.push({
      sheetNumber: 1,
      sheetTitle,
      format: 'A0',
      widthMm: SHEET_W,
      heightMm: SHEET_H,
      scale: '1:50',
      svg
    });

    return { success: true, sheets, schedule, validation };
  }

  /**
   * Serialize a schedule object (as returned by createPID) to CSV strings.
   * @param {object} schedule
   * @returns {object} { equipmentCsv, linesCsv, instrumentsCsv, valvesCsv, loopsCsv }
   */
  vectorizeSchedule(schedule) {
    const s = schedule || {};
    const equipmentCsv = [csvRow(['tag', 'type', 'description', 'area', 'x', 'y'])];
    for (const e of s.equipment || []) {
      equipmentCsv.push(csvRow([e.tag, e.type, e.description, e.area, e.x, e.y]));
    }
    const linesCsv = [
      csvRow(['lineNumber', 'sizeIn', 'service', 'material', 'class', 'insulation', 'from', 'to', 'flowDirection'])
    ];
    for (const l of s.lines || []) {
      linesCsv.push(
        csvRow([
          l.lineNumber,
          l.sizeIn,
          l.service,
          l.material,
          l.class,
          l.insulation,
          `${l.from.tag}:${l.from.nozzle}`,
          `${l.to.tag}:${l.to.nozzle}`,
          l.flowDirection
        ])
      );
    }
    const instrumentsCsv = [
      csvRow(['tag', 'loopId', 'firstLetter', 'modifier', 'description', 'location', 'connectedTo'])
    ];
    for (const i of s.instruments || []) {
      instrumentsCsv.push(
        csvRow([
          i.tag,
          i.loopId,
          i.firstLetter,
          i.modifier,
          i.description,
          i.location,
          i.connectedTo ? `${i.connectedTo.tag}:${i.connectedTo.nozzle}` : ''
        ])
      );
    }
    const valvesCsv = [csvRow(['tag', 'type', 'actuator', 'lineNumber', 'sizeIn', 'setPressureBarg'])];
    for (const v of s.valves || []) {
      valvesCsv.push(
        csvRow([
          v.tag,
          v.type,
          v.actuator,
          v.lineNumber,
          v.sizeIn,
          v.setPressureBarg !== undefined ? v.setPressureBarg : ''
        ])
      );
    }
    const loopsCsv = [csvRow(['loopTag', 'sensorTag', 'controllerTag', 'finalElementTag', 'type'])];
    for (const lp of s.controlLoops || []) {
      loopsCsv.push(csvRow([lp.loopTag, lp.sensorTag, lp.controllerTag, lp.finalElementTag, lp.type]));
    }
    const equipmentCsvText = equipmentCsv.join('\n');
    const linesCsvText = linesCsv.join('\n');
    const instrumentsCsvText = instrumentsCsv.join('\n');
    const valvesCsvText = valvesCsv.join('\n');
    const loopsCsvText = loopsCsv.join('\n');
    return {
      equipment: equipmentCsvText,
      lines: linesCsvText,
      instruments: instrumentsCsvText,
      valves: valvesCsvText,
      controlLoops: loopsCsvText,
      equipmentCsv: equipmentCsvText,
      linesCsv: linesCsvText,
      instrumentsCsv: instrumentsCsvText,
      valvesCsv: valvesCsvText,
      loopsCsv: loopsCsvText
    };
  }
}

PIDEngine.SUPPORTED_TEMPLATES = ['oilgas', 'lng'];

module.exports = { PIDEngine };
