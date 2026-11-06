/**
 * Weldment / structural frame generator.
 *
 * Input: a 3D skeleton of sketch lines (list of straight segments). Output:
 * a frame of beam members with standard structural profiles (I-beam, channel,
 * square/rectangular tube, angle), end-cut (miter / butt) details per joint,
 * an automatic cut-length table, total mass, and a deterministic ANSI/AWS
 * weld-symbol SVG diagram (fillet triangle + leg size + tail).
 *
 * Conventions:
 *  - All lengths in millimetres. Mass per meter in kg/m. Mass = length (m)
 *    × massPerMeterKg. The catalog is internally consistent: area (mm^2)
 *    × 7850 kg/m^3 / 1e6 = mass per meter (steel density).
 *  - Joints are junctions of member ends within TOL (1e-6 mm).
 *  - At a junction with exactly two members they miter (cut plane normal =
 *    the angle bisector). With more than two members the pair that forms the
 *    most "rail-like" corner (both members horizontal) miters; every other
 *    member butts flush.
 *  - Miter allowance along the member axis = (profile depth / 2) × tan(θ/2),
 *    where θ is the joint angle. Butt allowance = 0. Effective length =
 *    true length - end allowances; total reported mass uses true (as-bought)
 *    lengths.
 *  - Weld symbols: one miter fillet symbol per junction plus one fillet
 *    symbol at the foot of each column (near-vertical member). For the
 *    12-member skid frame this yields 12 weld symbols.
 *
 * No external runtime dependencies.
 */
'use strict';

const STEEL_DENSITY_KG_PER_M3 = 7850.0;
const TOL = 1e-6;
const M_ER_ANGLE = 5.0; // deg; below this, axes are considered collinear (splice / butt)

const PROFILE_DEFS = [
  {
    name: 'W200x27',
    type: 'ibeam',
    depthMm: 207,
    flangeWidthMm: 133,
    webThicknessMm: 6.4,
    areaMm2: 3450,
    massPerMeterKg: 27.0
  },
  {
    name: 'IPE 200',
    type: 'ibeam',
    depthMm: 200,
    flangeWidthMm: 100,
    webThicknessMm: 5.6,
    areaMm2: 2850,
    massPerMeterKg: 22.4
  },
  {
    name: 'C150x19',
    type: 'channel',
    depthMm: 152,
    flangeWidthMm: 48.8,
    webThicknessMm: 4.8,
    areaMm2: 2420,
    massPerMeterKg: 19.0
  },
  {
    name: 'SHS 100x100x5',
    type: 'shs',
    depthMm: 100,
    flangeWidthMm: 100,
    webThicknessMm: 5.0,
    areaMm2: 1900,
    massPerMeterKg: 14.92
  },
  {
    name: 'RHS 120x60x4',
    type: 'rhs',
    depthMm: 120,
    flangeWidthMm: 60,
    webThicknessMm: 4.0,
    areaMm2: 1376,
    massPerMeterKg: 10.8
  },
  {
    name: 'L50x50x5',
    type: 'angle',
    depthMm: 50,
    flangeWidthMm: 50,
    webThicknessMm: 5.0,
    areaMm2: 475,
    massPerMeterKg: 3.73
  }
];

function buildProfileCatalog(defs) {
  const catalog = {};
  const seen = new Set();
  for (const def of defs) {
    if (seen.has(def.name)) {
      throw new Error(`Profile catalog integrity: duplicate profile "${def.name}"`);
    }
    seen.add(def.name);
    catalog[def.name] = Object.freeze({
      name: def.name,
      type: def.type,
      depthMm: def.depthMm,
      flangeWidthMm: def.flangeWidthMm,
      webThicknessMm: def.webThicknessMm,
      areaMm2: def.areaMm2,
      massPerMeterKg: def.massPerMeterKg
    });
  }
  return Object.freeze(catalog);
}

const PROFILE_CATALOG = buildProfileCatalog(PROFILE_DEFS);

function validateProfileCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object') {
    throw new TypeError('Profile catalog must be an object');
  }
  const names = Object.keys(catalog);
  if (names.length === 0) {
    throw new Error('Profile catalog is empty');
  }
  for (const name of names) {
    const p = catalog[name];
    if (!p || typeof p !== 'object') {
      throw new Error(`Profile catalog integrity: "${name}" is not an object`);
    }
    for (const key of ['areaMm2', 'massPerMeterKg', 'depthMm', 'flangeWidthMm', 'webThicknessMm']) {
      const v = p[key];
      if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) {
        throw new Error(`Profile catalog integrity: "${name}" has non-positive or non-finite ${key}=${v}`);
      }
    }
  }
}

validateProfileCatalog(PROFILE_CATALOG);

function getProfile(name, catalog) {
  const cat = catalog || PROFILE_CATALOG;
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(cat, name)) {
    throw new Error(`Unknown profile "${name}" — fail-closed; available: ${Object.keys(cat).join(', ')}`);
  }
  return cat[name];
}

function assertFinitePoint(p, label) {
  if (!Array.isArray(p) || p.length < 3 || p.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new TypeError(`Invalid ${label}: expected [x, y, z] finite numbers`);
  }
}

function normalizeSegment(seg, index) {
  let start;
  let end;
  if (Array.isArray(seg)) {
    if (seg.length !== 2) {
      throw new TypeError(`Segment ${index}: expected [start, end]`);
    }
    start = seg[0];
    end = seg[1];
  } else if (seg && typeof seg === 'object') {
    start = seg.start || seg.from || seg.a;
    end = seg.end || seg.to || seg.b;
  }
  assertFinitePoint(start, `segment ${index}.start`);
  assertFinitePoint(end, `segment ${index}.end`);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  const lengthMm = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(lengthMm > TOL)) {
    throw new TypeError(`Segment ${index} is degenerate (zero length)`);
  }
  return { start, end, lengthMm };
}

function vecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vecNorm(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function vecUnit(v) {
  const n = vecNorm(v);
  if (n < TOL) {
    return [0, 0, 0];
  }
  return [v[0] / n, v[1] / n, v[2] / n];
}

function vecDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vecAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function ptClose(a, b) {
  return Math.abs(a[0] - b[0]) <= TOL && Math.abs(a[1] - b[1]) <= TOL && Math.abs(a[2] - b[2]) <= TOL;
}

function isVerticalAxis(u) {
  return Math.abs(u[2]) > 0.9;
}

function degToRad(d) {
  return (d * Math.PI) / 180.0;
}

function angleBetween(v1, v2) {
  const c = Math.max(-1, Math.min(1, vecDot(v1, v2)));
  return Math.acos(c);
}

function buildJoints(segments) {
  const joints = [];
  const jointOfEnd = []; // per segment: [startJointIndex|null, endJointIndex|null]
  const ids = new Map();

  const keyOf = (p) => `${p[0].toFixed(9)}|${p[1].toFixed(9)}|${p[2].toFixed(9)}`;

  for (const seg of segments) {
    const row = [null, null];
    for (let e = 0; e < 2; e++) {
      const p = e === 0 ? seg.start : seg.end;
      const key = keyOf(p);
      let j = ids.get(key);
      if (j === undefined) {
        j = joints.length;
        joints.push({ index: j, point: p.slice(), memberEnds: [] });
        ids.set(key, j);
      }
      row[e] = j;
      joints[j].memberEnds.push({ segmentIndex: seg.index, endIndex: e });
    }
    jointOfEnd.push(row);
  }
  joints.sort((a, b) => {
    for (let k = 0; k < 3; k++) {
      if (a.point[k] !== b.point[k]) return a.point[k] - b.point[k];
    }
    return a.index - b.index;
  });
  const remap = new Map(joints.map((j, i) => [j.index, i]));
  for (const j of joints) {
    j.index = remap.get(j.index);
    j.point = j.point.slice();
  }
  for (let s = 0; s < jointOfEnd.length; s++) {
    jointOfEnd[s] = [remap.get(jointOfEnd[s][0]), remap.get(jointOfEnd[s][1])];
  }
  return { joints, jointOfEnd };
}

function assignMemberProfile(segmentIndex, segment, options, catalog) {
  if (Array.isArray(options.profiles)) {
    if (options.profiles[segmentIndex] !== undefined) {
      return getProfile(options.profiles[segmentIndex], catalog);
    }
  }
  if (options.profiles && typeof options.profiles === 'object' && !Array.isArray(options.profiles)) {
    const p = options.profiles;
    const axis = vecUnit(vecSub(segment.end, segment.start));
    if (isVerticalAxis(axis)) {
      if (p.post) return getProfile(p.post, catalog);
    } else {
      if (p.rail) return getProfile(p.rail, catalog);
    }
  }
  return getProfile('W200x27', catalog);
}

function computeEndCuts(segmentIndex, segment, jointIdx, memberProfiles, joints, jointOfEnd, segments) {
  const joint = joints[jointIdx];
  const ends = joint.memberEnds.filter((me) => me.segmentIndex === segmentIndex);
  const endIndex = ends[0].endIndex;
  const outward = vecUnit(vecSub(endIndex === 0 ? segment.end : segment.start, joint.point));
  const halfLength = segment.lengthMm / 2.0;
  const partners = joint.memberEnds.filter((me) => me.segmentIndex !== segmentIndex);
  let type = 'butt';
  let cutAngleDeg = 90.0;
  let planeNormal = outward.slice();
  let allowanceMm = 0.0;
  let jointAngleDeg = 0.0;

  if (partners.length === 1) {
    const pseg = segments[partners[0].segmentIndex];
    const poutward = vecUnit(vecSub(partners[0].endIndex === 0 ? pseg.end : pseg.start, joint.point));
    const theta = angleBetween(outward, poutward);
    jointAngleDeg = (theta * 180.0) / Math.PI;
    if (theta > degToRad(M_ER_ANGLE) && theta < Math.PI - degToRad(M_ER_ANGLE)) {
      type = 'miter';
      cutAngleDeg = jointAngleDeg / 2.0;
      const bisector = vecAdd(outward, poutward);
      const b = vecNorm(bisector);
      if (b > TOL) {
        planeNormal = [bisector[0] / b, bisector[1] / b, bisector[2] / b];
      }
      const depth = memberProfiles[segmentIndex].depthMm;
      allowanceMm = (depth / 2.0) * Math.tan(degToRad(cutAngleDeg));
    }
  } else if (partners.length > 1) {
    const miterPair = selectMiterPair(joint, segments);
    if (miterPair !== null && miterPair.includes(segmentIndex)) {
      const other = miterPair[0] === segmentIndex ? miterPair[1] : miterPair[0];
      const oseg = segments[other];
      const oEnd = joint.memberEnds.find((me) => me.segmentIndex === other);
      const poutward = vecUnit(vecSub(oEnd.endIndex === 0 ? oseg.end : oseg.start, joint.point));
      const theta = angleBetween(outward, poutward);
      jointAngleDeg = (theta * 180.0) / Math.PI;
      if (theta > degToRad(M_ER_ANGLE) && theta < Math.PI - degToRad(M_ER_ANGLE)) {
        type = 'miter';
        cutAngleDeg = jointAngleDeg / 2.0;
        const bisector = vecAdd(outward, poutward);
        const b = vecNorm(bisector);
        if (b > TOL) {
          planeNormal = [bisector[0] / b, bisector[1] / b, bisector[2] / b];
        }
        const depth = memberProfiles[segmentIndex].depthMm;
        allowanceMm = (depth / 2.0) * Math.tan(degToRad(cutAngleDeg));
      }
    }
  }
  if (allowanceMm > halfLength) {
    allowanceMm = halfLength;
  }
  return { jointId: joint.index, endIndex, type, cutAngleDeg, planeNormal, allowanceMm, jointAngleDeg };
}

function selectMiterPair(joint, segments) {
  const me = joint.memberEnds;
  const dirs = new Map();
  for (const m of me) {
    const seg = segments[m.segmentIndex];
    const d = vecUnit(vecSub(m.endIndex === 0 ? seg.end : seg.start, joint.point));
    dirs.set(m.segmentIndex, d);
  }
  const idxs = me.map((m) => m.segmentIndex);
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < idxs.length; i++) {
    for (let k = i + 1; k < idxs.length; k++) {
      const a = idxs[i];
      const b = idxs[k];
      const theta = angleBetween(dirs.get(a), dirs.get(b));
      let score = theta;
      if (!isVerticalAxis(dirs.get(a)) && !isVerticalAxis(dirs.get(b))) {
        score += Math.PI;
      }
      if (score > bestScore) {
        bestScore = score;
        best = [a, b];
      }
    }
  }
  return best;
}

function memberIdFor(segmentIndex, options) {
  const prefix = options.memberIdPrefix || 'M';
  return `${prefix}${segmentIndex + 1}`;
}

function generateFrame(sketchLines, options) {
  const opts = options || {};
  const catalog = opts.catalog || PROFILE_CATALOG;
  validateProfileCatalog(catalog);
  if (!Array.isArray(sketchLines) || sketchLines.length === 0) {
    throw new TypeError('Sketch must contain at least one segment');
  }
  for (const name of opts.profiles || []) {
    getProfile(name, catalog);
  }
  const segments = sketchLines.map((seg, i) => Object.assign(normalizeSegment(seg, i), { index: i }));
  const { joints, jointOfEnd } = buildJoints(segments);
  const memberProfiles = segments.map((seg, i) => assignMemberProfile(i, seg, opts, catalog));
  const members = segments.map((seg) => {
    const cuts = [
      computeEndCuts(seg.index, seg, jointOfEnd[seg.index][0], memberProfiles, joints, jointOfEnd, segments),
      computeEndCuts(seg.index, seg, jointOfEnd[seg.index][1], memberProfiles, joints, jointOfEnd, segments)
    ];
    const allowanceSum = cuts.reduce((s, c) => s + c.allowanceMm, 0);
    return {
      id: memberIdFor(seg.index, opts),
      segmentIndex: seg.index,
      profile: memberProfiles[seg.index],
      start: seg.start.slice(),
      end: seg.end.slice(),
      trueLengthMm: seg.lengthMm,
      effectiveLengthMm: seg.lengthMm - allowanceSum,
      quantity: 1,
      endCuts: cuts
    };
  });

  const weldSymbols = [];
  for (const j of joints) {
    const miterEnds = j.memberEnds.filter((me) => {
      const c = members[me.segmentIndex].endCuts.find((cc) => cc.jointId === j.index);
      return c && c.type === 'miter';
    });
    if (miterEnds.length > 0) {
      weldSymbols.push({
        id: `J${j.index + 1}`,
        kind: 'junction-miter',
        anchor: j.point.slice(),
        legSizeMm: 6,
        designation: 'FI'
      });
    }
  }
  let footSymbolCounter = 0;
  for (const m of members) {
    const axis = vecUnit(vecSub(m.end, m.start));
    if (!isVerticalAxis(axis)) {
      continue;
    }
    const lowerJointIndex = m.start[2] <= m.end[2] ? jointOfEnd[m.segmentIndex][0] : jointOfEnd[m.segmentIndex][1];
    weldSymbols.push({
      id: `P${++footSymbolCounter}`,
      kind: 'column-foot-fillet',
      anchor: joints[lowerJointIndex].point.slice(),
      legSizeMm: 8,
      designation: 'FI'
    });
  }
  weldSymbols.sort((a, b) => {
    for (let k = 0; k < 3; k++) {
      if (a.anchor[k] !== b.anchor[k]) return a.anchor[k] - b.anchor[k];
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const totalMassKg = members.reduce((s, m) => s + (m.trueLengthMm / 1000.0) * m.profile.massPerMeterKg, 0);
  const cutLengthTable = {
    columns: ['memberId', 'profile', 'trueLengthMm', 'effectiveLengthMm', 'quantity'],
    rows: members.map((m) => [m.id, m.profile.name, m.trueLengthMm, m.effectiveLengthMm, m.quantity])
  };
  const svg = renderWeldSymbolsSvg(weldSymbols, opts);

  return {
    members,
    joints,
    weldSymbols,
    cutLengthTable,
    totalMassKg,
    svg,
    summary: {
      memberCount: members.length,
      jointCount: joints.length,
      weldSymbolCount: weldSymbols.length,
      totalTrueLengthMm: members.reduce((s, m) => s + m.trueLengthMm, 0),
      totalEffectiveLengthMm: members.reduce((s, m) => s + m.effectiveLengthMm, 0)
    }
  };
}

function renderWeldSymbolsSvg(symbols, opts) {
  const scale = opts.svgScale || 0.3;
  const margin = 40;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of symbols) {
    minX = Math.min(minX, s.anchor[0]);
    maxX = Math.max(maxX, s.anchor[0]);
    minY = Math.min(minY, s.anchor[1]);
    maxY = Math.max(maxY, s.anchor[1]);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 1;
    minY = 0;
    maxY = 1;
  }
  const px = (x) => margin + (x - minX) * scale;
  const py = (y) => margin + (y - minY) * scale;
  const W = margin * 2 + Math.max(1, maxX - minX) * scale;
  const H = margin * 2 + Math.max(1, maxY - minY) * scale;

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmtNum(W)}" height="${fmtNum(H)}" viewBox="0 0 ${fmtNum(W)} ${fmtNum(H)}">`
  );
  lines.push(`  <title>Weldment joint diagram (ANSI/AWS fillet weld symbols)</title>`);
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i];
    const x = px(s.anchor[0]);
    const y = py(s.anchor[1]);
    const size = 12;
    const tailLen = 46 + (i % 3) * 12;
    const dx = 1;
    const dy = 0;
    lines.push(
      `  <g id="weld-${s.id}" data-kind="${s.kind}" data-anchor="${fmtNum(s.anchor[0])},${fmtNum(s.anchor[1])},${fmtNum(s.anchor[2])}">`
    );
    lines.push(
      `    <line x1="${fmtNum(x)}" y1="${fmtNum(y)}" x2="${fmtNum(x + dx * tailLen)}" y2="${fmtNum(y + dy * tailLen)}" stroke="#334155" stroke-width="1.5" stroke-dasharray="4 3"/>`
    );
    lines.push(
      `    <path class="weld-fillet-triangle" data-aws-designation="FI" d="M ${fmtNum(x)} ${fmtNum(y)} L ${fmtNum(x + size)} ${fmtNum(y)} L ${fmtNum(x)} ${fmtNum(y - size)} Z" fill="#64748b" stroke="#0f172a" stroke-width="1"/>`
    );
    lines.push(
      `    <text x="${fmtNum(x + dx * tailLen + 4)}" y="${fmtNum(y + dy * tailLen + 4)}" font-family="monospace" font-size="11" fill="#0f172a">${s.legSizeMm} FI</text>`
    );
    lines.push(`  </g>`);
  }
  lines.push('</svg>');
  return lines.join('\n');
}

function fmtNum(n) {
  return Number(n).toFixed(2);
}

function generateSkidFrameSkeleton(options) {
  const o = options || {};
  const W = o.baseWidthMm || 2400;
  const D = o.baseDepthMm || 1200;
  const H = o.heightMm || 800;
  const z0 = o.baseZMm || 0;
  const z1 = z0 + H;
  const corners = [
    [0, 0, z0],
    [W, 0, z0],
    [W, D, z0],
    [0, D, z0]
  ];
  const top = corners.map((p) => [p[0], p[1], z1]);
  const segs = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    segs.push({ start: a, end: b });
  }
  for (let i = 0; i < 4; i++) {
    segs.push({ start: corners[i], end: top[i] });
  }
  for (let i = 0; i < 4; i++) {
    const a = top[i];
    const b = top[(i + 1) % 4];
    segs.push({ start: a, end: b });
  }
  return segs;
}

function generateSkidFrame(options) {
  const opts = options || {};
  const skeleton = generateSkidFrameSkeleton(opts);
  return generateFrame(skeleton, opts);
}

module.exports = {
  PROFILE_CATALOG,
  PROFILE_DEFS,
  buildProfileCatalog,
  validateProfileCatalog,
  getProfile,
  generateFrame,
  generateSkidFrame,
  generateSkidFrameSkeleton,
  STEEL_DENSITY_KG_PER_M3,
  TOL
};
