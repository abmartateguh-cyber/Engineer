/**
 * Automated 2D isometric piping spool drawing generator.
 *
 * Experimental utility for plant detailing. Accepts a simple 3D piping
 * network model (straight runs, elbows, flanges, valves, field welds)
 * and renders a deterministic SVG isometric spool drawing with linear
 * dimensions, cut-pipe fabrication lengths between welds, and weld
 * callout balloons.
 *
 * The model is described in meters. Straight runs are ordered and must
 * connect: runs[i].end == elbows[i].at == runs[i+1].start (elbows are
 * 45 deg or 90 deg bends). Flanges sit at run endpoints (their weld is
 * automatically callout out); field welds are placed parametrically on
 * runs. All output geometry is in millimetres; projection is the
 * standard 30/30 isometric projection:
 *
 *   x' = (x - y) * cos(30 deg)
 *   y' = (x + y) * sin(30 deg) + z
 *
 * The SVG is emitted as a pure string with no external runtime
 * dependencies. PDF export is intentionally not implemented (no
 * external dependencies).
 */
'use strict';

const COS30 = Math.sqrt(3) / 2;
const SIN30 = 0.5;

const DEFAULT_OPTIONS = Object.freeze({
  mmPerMeter: 1000,
  elbowSamples: 32,
  dimensionOffsetMm: 70,
  marginMm: 100,
  flangeSymbolLengthMm: 110,
  flangeSymbolWidthMm: 36,
  valveLengthMm: 68,
  valveWidthMm: 32,
  weldDotRadiusMm: 10,
  arrowLengthMm: 8,
  dimensionFontSizeMm: 18,
  balloonFontSizeMm: 16
});

function assertFinitePoint(p, label) {
  if (!Array.isArray(p) || p.length < 3 || p.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new TypeError(`Invalid ${label}: expected [x, y, z] finite numbers`);
  }
}

function assertValidModel(model) {
  if (!model || typeof model !== 'object') {
    throw new TypeError('Piping model must be an object');
  }
  const runs = model.runs;
  if (!Array.isArray(runs) || runs.length < 1) {
    throw new TypeError('Model must contain at least one straight run');
  }
  const elbows = model.elbows || [];
  if (runs.length !== elbows.length + 1) {
    throw new TypeError(`Expected elbows.length (${elbows.length}) === runs.length - 1 (${runs.length - 1})`);
  }
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run || typeof run !== 'object') {
      throw new TypeError(`runs[${i}] must be an object`);
    }
    assertFinitePoint(run.start, `runs[${i}].start`);
    assertFinitePoint(run.end, `runs[${i}].end`);
    if (i > 0) {
      const elbow = elbows[i - 1];
      if (!elbow || typeof elbow !== 'object') {
        throw new TypeError(`elbows[${i - 1}] must be an object`);
      }
      assertFinitePoint(elbow.at, `elbows[${i - 1}].at`);
      if (typeof elbow.radius !== 'number' || elbow.radius <= 0 || !Number.isFinite(elbow.radius)) {
        throw new TypeError(`elbows[${i - 1}].radius must be a positive finite number`);
      }
      if (elbow.angleDeg !== 45 && elbow.angleDeg !== 90) {
        throw new TypeError(`elbows[${i - 1}].angleDeg must be 45 or 90`);
      }
      const prevRun = runs[i - 1];
      const withinEps = (a, b) => Math.abs(a - b) <= 1e-6;
      if (
        !withinEps(elbow.at[0], prevRun.end[0]) ||
        !withinEps(elbow.at[1], prevRun.end[1]) ||
        !withinEps(elbow.at[2], prevRun.end[2]) ||
        !withinEps(elbow.at[0], run.start[0]) ||
        !withinEps(elbow.at[1], run.start[1]) ||
        !withinEps(elbow.at[2], run.start[2])
      ) {
        throw new TypeError(`elbows[${i - 1}].at must connect runs[${i - 1}].end and runs[${i}].start`);
      }
    }
  }
  for (const flange of model.flanges || []) {
    assertFinitePoint(flange.at, 'flange.at');
    assertFinitePoint(flange.normal, 'flange.normal');
  }
  for (const valve of model.valves || []) {
    if (!Number.isInteger(valve.run) || valve.run < 0 || valve.run >= runs.length) {
      throw new TypeError('valve.run must be a valid run index');
    }
    if (typeof valve.t !== 'number' || valve.t < 0 || valve.t > 1 || !Number.isFinite(valve.t)) {
      throw new TypeError('valve.t must be in [0, 1]');
    }
  }
  for (const weld of model.fieldWelds || []) {
    if (!Number.isInteger(weld.run) || weld.run < 0 || weld.run >= runs.length) {
      throw new TypeError('fieldWeld.run must be a valid run index');
    }
    if (typeof weld.t !== 'number' || weld.t < 0 || weld.t > 1 || !Number.isFinite(weld.t)) {
      throw new TypeError('fieldWeld.t must be in [0, 1]');
    }
  }
}

function unitVector(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len <= 1e-12) {
    throw new TypeError('Degenerate zero-length run segment');
  }
  return [dx / len, dy / len, dz / len];
}

function addScaled(a, b, s) {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}

function hypot3(dx, dy, dz) {
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

class PipingIsometricGenerator {
  /** Standard 30/30 isometric projection of 3D world coordinates. */
  static projectXYZ(x, y, z) {
    return { x: (x - y) * COS30, y: (x + y) * SIN30 + z };
  }

  static projectPoint(p) {
    return PipingIsometricGenerator.projectXYZ(p[0], p[1], p[2]);
  }

  /** Project a model point (meters) into drawing coordinates (mm). */
  static projectPointMm(p, mmPerMeter) {
    const m = mmPerMeter === undefined ? DEFAULT_OPTIONS.mmPerMeter : mmPerMeter;
    return PipingIsometricGenerator.projectXYZ(p[0] * m, p[1] * m, p[2] * m);
  }

  /** True 3D length between two points, in meters. */
  static trueLengthMeters(a, b) {
    return hypot3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }

  static toMm(valueMeters, mmPerMeter) {
    return valueMeters * (mmPerMeter === undefined ? DEFAULT_OPTIONS.mmPerMeter : mmPerMeter);
  }
}

/**
 * Analyze a spool model: straight-run true lengths, cumulative centerline
 * lengths (including elbow arc lengths), weld entries sorted by centerline
 * position, and fabrication (cut-pipe) lengths between consecutive field
 * welds. All lengths are in millimetres.
 */
function analyzeSpool(model, options) {
  assertValidModel(model);
  const opts = Object.assign({}, DEFAULT_OPTIONS, options || {});
  const m = opts.mmPerMeter;
  const runs = model.runs;
  const elbows = model.elbows || [];
  const runLengthsMm = [];
  const cumRunStartMm = [];
  const cumElbowMm = [];
  let cum = 0;
  for (let i = 0; i < runs.length; i++) {
    if (i > 0) {
      const elbow = elbows[i - 1];
      const angleRad = (elbow.angleDeg * Math.PI) / 180;
      cumElbowMm.push(cum);
      cum += angleRad * elbow.radius * m;
    }
    cumRunStartMm.push(cum);
    const lenMm = PipingIsometricGenerator.trueLengthMeters(runs[i].start, runs[i].end) * m;
    runLengthsMm.push(lenMm);
    cum += lenMm;
  }
  const totalStraightLengthMm = runLengthsMm.reduce((acc, len) => acc + len, 0);

  const weldEntries = [];
  for (const flange of model.flanges || []) {
    let attachedCum = null;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const atStart =
        Math.abs(flange.at[0] - run.start[0]) <= 1e-6 &&
        Math.abs(flange.at[1] - run.start[1]) <= 1e-6 &&
        Math.abs(flange.at[2] - run.start[2]) <= 1e-6;
      const atEnd =
        Math.abs(flange.at[0] - run.end[0]) <= 1e-6 &&
        Math.abs(flange.at[1] - run.end[1]) <= 1e-6 &&
        Math.abs(flange.at[2] - run.end[2]) <= 1e-6;
      if (atStart) {
        attachedCum = cumRunStartMm[i];
        break;
      }
      if (atEnd) {
        attachedCum = cumRunStartMm[i] + runLengthsMm[i];
        break;
      }
    }
    if (attachedCum === null) {
      throw new TypeError(`flange "${flange.id || '?'}" is not attached to a run endpoint`);
    }
    weldEntries.push({ type: 'flange-weld', id: flange.id || 'F', pointMeters: flange.at, cumMm: attachedCum });
  }
  for (const weld of model.fieldWelds || []) {
    const cumMm = cumRunStartMm[weld.run] + weld.t * runLengthsMm[weld.run];
    const pointMeters = addScaled(
      runs[weld.run].start,
      unitVector(runs[weld.run].start, runs[weld.run].end),
      weld.t * PipingIsometricGenerator.trueLengthMeters(runs[weld.run].start, runs[weld.run].end)
    );
    weldEntries.push({ type: 'field-weld', id: weld.id || 'W', pointMeters, cumMm });
  }
  weldEntries.sort((a, b) => a.cumMm - b.cumMm);

  const fieldWelds = weldEntries.filter((w) => w.type === 'field-weld');
  const fabLengthsMm = [];
  for (let i = 1; i < fieldWelds.length; i++) {
    fabLengthsMm.push(fieldWelds[i].cumMm - fieldWelds[i - 1].cumMm);
  }

  return {
    totalStraightLengthMm,
    runLengthsMm,
    cumRunStartMm,
    cumElbowMm,
    weldEntries,
    fieldWelds,
    fabLengthsMm
  };
}

/** Canonical demo spool: 3 straight runs, two 90 deg elbows, 2 flanges, 1 gate valve, 2 field welds. */
function sampleSpoolModel() {
  return {
    runs: [
      { id: 'R1', start: [0, 0, 0], end: [3, 0, 0] },
      { id: 'R2', start: [3, 0, 0], end: [3, 2, 0] },
      { id: 'R3', start: [3, 2, 0], end: [3, 2, 1.5] }
    ],
    elbows: [
      { id: 'E1', at: [3, 0, 0], radius: 0.25, angleDeg: 90 },
      { id: 'E2', at: [3, 2, 0], radius: 0.25, angleDeg: 90 }
    ],
    flanges: [
      { id: 'F1', at: [0, 0, 0], normal: [1, 0, 0] },
      { id: 'F2', at: [3, 2, 1.5], normal: [0, 0, 1] }
    ],
    valves: [{ id: 'V1', run: 1, t: 0.5 }],
    fieldWelds: [
      { id: 'FW1', run: 0, t: 0.9 },
      { id: 'FW2', run: 2, t: 0.2 }
    ]
  };
}

function sampleElbowArc(elbow, prevRun, nextRun, mmPerMeter) {
  const u = unitVector(prevRun.start, prevRun.end);
  const v = unitVector(nextRun.start, nextRun.end);
  const bis = hypot3(u[0] + v[0], u[1] + v[1], u[2] + v[2]);
  if (bis <= 1e-12) {
    throw new TypeError('Elbow incoming/outgoing directions are opposite (180 deg turn unsupported)');
  }
  const radiusMeters = elbow.radius;
  const centerMeters = addScaled(elbow.at, [u[0] + v[0], u[1] + v[1], u[2] + v[2]], radiusMeters / bis);
  const angleRad = (elbow.angleDeg * Math.PI) / 180;
  const points = [];
  const samples = Math.max(8, Math.round(DEFAULT_OPTIONS.elbowSamples * (elbow.angleDeg / 90)));
  for (let i = 0; i <= samples; i++) {
    const ang = (i / samples) * angleRad;
    const cosT = Math.cos(ang);
    const sinT = Math.sin(ang);
    const p = [
      centerMeters[0] + radiusMeters * (-u[0] * cosT + v[0] * sinT),
      centerMeters[1] + radiusMeters * (-u[1] * cosT + v[1] * sinT),
      centerMeters[2] + radiusMeters * (-u[2] * cosT + v[2] * sinT)
    ];
    points.push(PipingIsometricGenerator.projectPointMm(p, mmPerMeter));
  }
  return points;
}

function pathFromPoints(points) {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

function fmt(n) {
  return String(n);
}

function generateIsometricSvg(model, options) {
  assertValidModel(model);
  const opts = Object.assign({}, DEFAULT_OPTIONS, options || {});
  const m = opts.mmPerMeter;
  const analysis = analyzeSpool(model, opts);

  const minX = { v: Infinity };
  const maxX = { v: -Infinity };
  const minY = { v: Infinity };
  const maxY = { v: -Infinity };
  const stamp = (x, y, pad) => {
    minX.v = Math.min(minX.v, x - pad);
    maxX.v = Math.max(maxX.v, x + pad);
    minY.v = Math.min(minY.v, y - pad);
    maxY.v = Math.max(maxY.v, y + pad);
  };

  const runLines = [];
  const elbowPaths = [];
  const flangeRects = [];
  const valvePaths = [];
  const weldGroups = [];
  const dimElements = [];

  const runs = model.runs;
  const elbows = model.elbows || [];

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const pA = PipingIsometricGenerator.projectPointMm(run.start, m);
    const pB = PipingIsometricGenerator.projectPointMm(run.end, m);
    runLines.push(`<line class="pipe-run" x1="${fmt(pA.x)}" y1="${fmt(pA.y)}" x2="${fmt(pB.x)}" y2="${fmt(pB.y)}"/>`);
    stamp(pA.x, pA.y, 2);
    stamp(pB.x, pB.y, 2);

    const trueLenMm = PipingIsometricGenerator.trueLengthMeters(run.start, run.end) * m;
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const off = opts.dimensionOffsetMm;
    const qA = { x: pA.x + px * off, y: pA.y + py * off };
    const qB = { x: pB.x + px * off, y: pB.y + py * off };
    stamp(qA.x, qA.y, 30);
    stamp(qB.x, qB.y, 30);

    dimElements.push(
      `<line class="dimension-extension" x1="${fmt(pA.x)}" y1="${fmt(pA.y)}" x2="${fmt(qA.x)}" y2="${fmt(qA.y)}"/>`
    );
    dimElements.push(
      `<line class="dimension-extension" x1="${fmt(pB.x)}" y1="${fmt(pB.y)}" x2="${fmt(qB.x)}" y2="${fmt(qB.y)}"/>`
    );
    dimElements.push(
      `<line class="dimension-line" x1="${fmt(qA.x)}" y1="${fmt(qA.y)}" x2="${fmt(qB.x)}" y2="${fmt(qB.y)}"/>`
    );
    const arrow = opts.arrowLengthMm;
    dimElements.push(
      `<line class="dimension-arrow" x1="${fmt(qA.x - ux * arrow - (px * arrow) / 2)}" y1="${fmt(qA.y - uy * arrow - (py * arrow) / 2)}" x2="${fmt(qA.x)}" y2="${fmt(qA.y)}"/>`
    );
    dimElements.push(
      `<line class="dimension-arrow" x1="${fmt(qA.x - ux * arrow + (px * arrow) / 2)}" y1="${fmt(qA.y - uy * arrow + (py * arrow) / 2)}" x2="${fmt(qA.x)}" y2="${fmt(qA.y)}"/>`
    );
    dimElements.push(
      `<line class="dimension-arrow" x1="${fmt(qB.x + ux * arrow - (px * arrow) / 2)}" y1="${fmt(qB.y + uy * arrow - (py * arrow) / 2)}" x2="${fmt(qB.x)}" y2="${fmt(qB.y)}"/>`
    );
    dimElements.push(
      `<line class="dimension-arrow" x1="${fmt(qB.x + ux * arrow + (px * arrow) / 2)}" y1="${fmt(qB.y + uy * arrow + (py * arrow) / 2)}" x2="${fmt(qB.x)}" y2="${fmt(qB.y)}"/>`
    );
    const midX = (qA.x + qB.x) / 2;
    const midY = (qA.y + qB.y) / 2;
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    dimElements.push(
      `<text class="dimension-text" x="${fmt(midX)}" y="${fmt(midY)}" text-anchor="middle" dominant-baseline="middle" font-size="${opts.dimensionFontSizeMm}" transform="rotate(${fmt(angleDeg)} ${fmt(midX)} ${fmt(midY)})">${Math.round(trueLenMm)}</text>`
    );
    stamp(midX, midY, 40);
  }

  for (let i = 0; i < elbows.length; i++) {
    const arcPoints = sampleElbowArc(elbows[i], runs[i], runs[i + 1], m);
    elbowPaths.push(`<path class="elbow-arc" d="${pathFromPoints(arcPoints)}"/>`);
    for (const pt of arcPoints) {
      stamp(pt.x, pt.y, 2);
    }
  }

  const flangeSymbolLengthMm = opts.flangeSymbolLengthMm;
  const flangeSymbolWidthMm = opts.flangeSymbolWidthMm;
  for (const flange of model.flanges || []) {
    const c = PipingIsometricGenerator.projectPointMm(flange.at, m);
    const nProj = PipingIsometricGenerator.projectPointMm(
      [flange.at[0] + flange.normal[0], flange.at[1] + flange.normal[1], flange.at[2] + flange.normal[2]],
      m
    );
    const angleDeg = (Math.atan2(nProj.y - c.y, nProj.x - c.x) * 180) / Math.PI;
    flangeRects.push(
      `<rect class="flange" x="${fmt(-flangeSymbolWidthMm / 2)}" y="${fmt(-flangeSymbolLengthMm / 2)}" width="${fmt(flangeSymbolWidthMm)}" height="${fmt(flangeSymbolLengthMm)}" transform="translate(${fmt(c.x)} ${fmt(c.y)}) rotate(${fmt(angleDeg)})"/>`
    );
    stamp(c.x, c.y, flangeSymbolLengthMm / 2 + 10);
  }

  const valveLengthMm = opts.valveLengthMm;
  const valveWidthMm = opts.valveWidthMm;
  for (const valve of model.valves || []) {
    const run = runs[valve.run];
    const pA = PipingIsometricGenerator.projectPointMm(run.start, m);
    const pB = PipingIsometricGenerator.projectPointMm(run.end, m);
    const ux = (pB.x - pA.x) / Math.sqrt((pB.x - pA.x) ** 2 + (pB.y - pA.y) ** 2);
    const uy = (pB.y - pA.y) / Math.sqrt((pB.x - pA.x) ** 2 + (pB.y - pA.y) ** 2);
    const pos = addScaled(
      run.start,
      unitVector(run.start, run.end),
      valve.t * PipingIsometricGenerator.trueLengthMeters(run.start, run.end)
    );
    const c = PipingIsometricGenerator.projectPointMm(pos, m);
    const angleDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
    const L = valveLengthMm / 2;
    const W = valveWidthMm / 2;
    const d = `M ${fmt(-L)} 0 L 0 ${fmt(-W)} L 0 ${fmt(W)} Z M ${fmt(L)} 0 L 0 ${fmt(-W)} L 0 ${fmt(W)} Z`;
    valvePaths.push(
      `<path class="valve" d="${d}" transform="translate(${fmt(c.x)} ${fmt(c.y)}) rotate(${fmt(angleDeg)})"/>`
    );
    stamp(c.x, c.y, L + 10);
  }

  for (let i = 0; i < analysis.weldEntries.length; i++) {
    const entry = analysis.weldEntries[i];
    const c = PipingIsometricGenerator.projectPointMm(entry.pointMeters, m);
    const r = opts.weldDotRadiusMm;
    const label = `W${i + 1}`;
    const tx = c.x + 24;
    const ty = c.y - 24;
    weldGroups.push(
      `<g class="weld-balloon">` +
        `<line class="weld-leader" x1="${fmt(c.x + r * 0.7071)}" y1="${fmt(c.y - r * 0.7071)}" x2="${fmt(tx - 8)}" y2="${fmt(ty + 8)}"/>` +
        `<circle class="weld" cx="${fmt(c.x)}" cy="${fmt(c.y)}" r="${fmt(r)}"/>` +
        `<text class="balloon-number" x="${fmt(tx)}" y="${fmt(ty)}" font-size="${opts.balloonFontSizeMm}" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${label}</text>` +
        `</g>`
    );
    stamp(c.x, c.y, 60);
  }

  for (let i = 0; i < analysis.fabLengthsMm.length; i++) {
    const a = analysis.fieldWelds[i];
    const b = analysis.fieldWelds[i + 1];
    const pA = PipingIsometricGenerator.projectPointMm(a.pointMeters, m);
    const pB = PipingIsometricGenerator.projectPointMm(b.pointMeters, m);
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const off = opts.dimensionOffsetMm * 1.6;
    const qA = { x: pA.x + px * off, y: pA.y + py * off };
    const qB = { x: pB.x + px * off, y: pB.y + py * off };
    stamp(qA.x, qA.y, 30);
    stamp(qB.x, qB.y, 30);
    dimElements.push(
      `<line class="dimension-extension" x1="${fmt(pA.x)}" y1="${fmt(pA.y)}" x2="${fmt(qA.x)}" y2="${fmt(qA.y)}"/>`
    );
    dimElements.push(
      `<line class="dimension-extension" x1="${fmt(pB.x)}" y1="${fmt(pB.y)}" x2="${fmt(qB.x)}" y2="${fmt(qB.y)}"/>`
    );
    dimElements.push(
      `<line class="fab-dimension-line" x1="${fmt(qA.x)}" y1="${fmt(qA.y)}" x2="${fmt(qB.x)}" y2="${fmt(qB.y)}"/>`
    );
    const midX = (qA.x + qB.x) / 2;
    const midY = (qA.y + qB.y) / 2;
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    dimElements.push(
      `<text class="fab-dimension-text" x="${fmt(midX)}" y="${fmt(midY)}" text-anchor="middle" dominant-baseline="middle" font-size="${opts.dimensionFontSizeMm}" transform="rotate(${fmt(angleDeg)} ${fmt(midX)} ${fmt(midY)})">${Math.round(analysis.fabLengthsMm[i])}</text>`
    );
    stamp(midX, midY, 40);
  }

  const margin = opts.marginMm;
  const vx = minX.v - margin;
  const vy = minY.v - margin;
  const vw = Math.max(1, maxX.v - minX.v + 2 * margin);
  const vh = Math.max(1, maxY.v - minY.v + 2 * margin);

  const lines = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vx)} ${fmt(vy)} ${fmt(vw)} ${fmt(vh)}" width="${fmt(vw)}" height="${fmt(vh)}" role="img" aria-label="Piping isometric spool drawing">`
  );
  lines.push(`<title>Piping Isometric Spool Drawing</title>`);
  lines.push(`<g id="isometric-spool" fill="none" stroke-linecap="round" stroke-linejoin="round">`);
  lines.push(`<g id="pipe-runs" stroke="#1a1a1a" stroke-width="4">${runLines.join('')}</g>`);
  lines.push(`<g id="elbows" stroke="#1a1a1a" stroke-width="4">${elbowPaths.join('')}</g>`);
  lines.push(`<g id="flanges" stroke="#333333" stroke-width="2.5">${flangeRects.join('')}</g>`);
  lines.push(`<g id="valves" stroke="#333333" stroke-width="2.5">${valvePaths.join('')}</g>`);
  lines.push(`<g id="weld-balloons" stroke="#cc0000" stroke-width="1.5" fill="none">${weldGroups.join('')}</g>`);
  lines.push(`<g id="dimensions" stroke="#005a9c" stroke-width="1.5" fill="#005a9c">${dimElements.join('')}</g>`);
  lines.push(`</g>`);
  lines.push(`</svg>`);
  return lines.join('');
}

module.exports = {
  PipingIsometricGenerator,
  generateIsometricSvg,
  sampleSpoolModel,
  analyzeSpool,
  COS30,
  SIN30,
  DEFAULT_OPTIONS
};
