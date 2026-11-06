/**
 * Verification gate for the Piping Component File (PCF) exporter
 * (src/core/plant/pcf_export.js).
 *
 * Coverage:
 *  1. PCF syntax: strict in-test grammar parse (headers balanced, all
 *     END markers matched, record types recognized, units block
 *     present, no stray tokens).
 *  2. Component records: a spool with 3 pipes, 2 elbows, 1 flange,
 *     1 valve, 4 welds yields exactly those ELEM records.
 *  3. Coordinates: a component at (x, y, z) appears with those
 *     coordinates (1e-6).
 *  4. Wall thickness / end preparation attributes for pipes (t, and
 *     BW/SW/TH codes).
 *  5. Material grade string preserved verbatim.
 *  6. NODE connectivity: consecutive components share node numbers.
 *  7. Determinism: same input -> byte-identical export.
 *  8. Fail-closed: invalid component type or missing coordinates throw.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PCFExporter, exportPCF, COMPONENT_TYPES, VALID_END_PREPS } = require('../src/core/plant/pcf_export');

const EPS = 1e-6;

const SECTION_KEYWORDS = new Set(['UNITS', 'TEXT', 'HDR', 'DATA', 'ATTR', 'NODE']);
const DATA_KEYWORDS = new Set([
  'COMP',
  'POSITION',
  'ORIENTATION',
  'END-POINT',
  'CENTRE-POINT',
  'BRANCH-POINT',
  'BEND-RADIUS',
  'ANGLE',
  'NOMINAL-SIZE'
]);
const ATTR_KEYWORDS = new Set([
  'COMP',
  'WALL-THICKNESS',
  'END-PREPARATION',
  'MATERIAL',
  'SPECIFICATION',
  'SKEY',
  'ITEM-CODE',
  'RATING',
  'FLANGE-FACE',
  'VALVE-TYPE',
  'WELD-TYPE'
]);
const UNITS_KEYWORDS = new Set(['BORE', 'CO-ORDS', 'PRESSURE', 'TEMPERATURE', 'WEIGHT', 'DIMENSIONS']);
const TEXT_KEYWORDS = new Set(['TITLE', 'PIPELINE-REFERENCE']);
const HDR_KEYWORDS = new Set(['ELEM', 'COMP', 'REF', 'SKEY']);
const NODE_KEYWORDS = new Set(['NODE']);

function parsePCF(text) {
  const stack = [];
  const elems = [];
  const unitsKeys = [];
  const nodes = [];
  const compData = new Map();
  const compAttr = new Map();
  let currentComp = null;

  const fail = (msg, line) => {
    throw new Error(`PCF grammar violation: ${msg} (near line: ${JSON.stringify(line)})`);
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const kw = parts[0];

    if (kw === 'END') {
      if (stack.length === 0) fail('END with no open section', line);
      stack.pop();
      continue;
    }
    if (kw === 'NODE' && parts.length > 1) {
      if (stack[stack.length - 1] !== 'NODE') fail('NODE record outside NODE section', line);
      const id = Number(parts[1]);
      const compId = Number(parts[2]);
      const side = parts[3];
      if (!Number.isInteger(id) || id < 1) fail(`bad node id ${parts[1]}`, line);
      if (!Number.isInteger(compId) || compId < 1) fail(`bad node component ${parts[2]}`, line);
      if (side !== 'START' && side !== 'END') fail(`bad node side ${parts[3]}`, line);
      nodes.push({ id, comp: compId, side });
      continue;
    }
    if (SECTION_KEYWORDS.has(kw)) {
      if (parts.length !== 1) fail(`section header ${kw} must stand alone`, line);
      if (stack.length !== 0) fail(`section ${kw} opened inside ${stack[stack.length - 1]}`, line);
      stack.push(kw);
      if (kw === 'NODE') currentComp = null;
      continue;
    }
    if (kw === 'ELEM') {
      if (stack[stack.length - 1] !== 'HDR') fail('ELEM outside HDR', line);
      const type = parts[1];
      if (type === undefined) fail('ELEM without type', line);
      if (!COMPONENT_TYPES.includes(type)) fail(`unrecognized record type ${type}`, line);
      elems.push(type);
      continue;
    }
    if (kw === 'COMP') {
      if (!['HDR', 'DATA', 'ATTR'].includes(stack[stack.length - 1])) fail('COMP outside HDR/DATA/ATTR', line);
      currentComp = Number(parts[1]);
      if (!Number.isInteger(currentComp) || currentComp < 1) fail(`bad COMP id ${parts[1]}`, line);
      if (stack[stack.length - 1] === 'DATA') compData.set(currentComp, []);
      if (stack[stack.length - 1] === 'ATTR') compAttr.set(currentComp, []);
      continue;
    }
    if (kw === 'REF') {
      if (stack[stack.length - 1] !== 'HDR') fail('REF outside HDR', line);
      continue;
    }
    if (kw === 'SKEY') {
      if (!['HDR', 'ATTR'].includes(stack[stack.length - 1])) fail('SKEY outside HDR/ATTR', line);
      continue;
    }

    if (
      kw === 'POSITION' ||
      kw === 'ORIENTATION' ||
      kw === 'END-POINT' ||
      kw === 'CENTRE-POINT' ||
      kw === 'BRANCH-POINT'
    ) {
      if (stack[stack.length - 1] !== 'DATA') fail(`${kw} outside DATA`, line);
      if (parts.length < 4) fail(`${kw} missing coordinates`, line);
      if (currentComp !== null && compData.has(currentComp)) {
        compData.get(currentComp).push({ kw, x: Number(parts[1]), y: Number(parts[2]), z: Number(parts[3]) });
      }
      continue;
    }
    if (DATA_KEYWORDS.has(kw)) {
      if (stack[stack.length - 1] !== 'DATA') fail(`${kw} outside DATA`, line);
      continue;
    }
    if (ATTR_KEYWORDS.has(kw)) {
      if (stack[stack.length - 1] !== 'ATTR') fail(`${kw} outside ATTR`, line);
      if (kw === 'MATERIAL' && parts.length < 2) fail('MATERIAL without value', line);
      continue;
    }
    if (UNITS_KEYWORDS.has(kw)) {
      if (stack[stack.length - 1] !== 'UNITS') fail(`${kw} outside UNITS`, line);
      unitsKeys.push(kw);
      continue;
    }
    if (TEXT_KEYWORDS.has(kw)) {
      if (stack[stack.length - 1] !== 'TEXT') fail(`${kw} outside TEXT`, line);
      continue;
    }
    fail(`stray token ${kw}`, line);
  }

  if (stack.length !== 0) {
    fail(`unclosed sections ${stack.join(', ')}`, '');
  }
  return { elems, unitsKeys, nodes, compData, compAttr };
}

function pipeFixtures() {
  return [
    {
      type: 'PIPE',
      position: [0, 0, 0],
      nps: 50,
      t: 6.35,
      endPrep: 'BW',
      material: 'A106 GR.B',
      spec: 'SPEC-01',
      skey: 'PIPE-50'
    },
    { type: 'PIPE', position: [3000, 0, 0], nps: 50, t: 4.78, endPrep: 'SW', material: 'A312 TP304L', spec: 'SPEC-02' },
    {
      type: 'ELBOW',
      position: [6000, 0, 0],
      nps: 50,
      radius: 76.2,
      angleDeg: 90,
      endPrep: 'BW',
      material: 'A234 WPB',
      spec: 'SPEC-01'
    },
    { type: 'PIPE', position: [6000, 0, 500], nps: 50, t: 6.35, endPrep: 'TH', material: 'A106 GR.B', spec: 'SPEC-01' },
    {
      type: 'ELBOW',
      position: [6000, 0, 2000],
      nps: 50,
      radius: 76.2,
      angleDeg: 45,
      endPrep: 'BW',
      material: 'A234 WPB',
      spec: 'SPEC-01'
    },
    {
      type: 'FLANGE',
      position: [6400, 0, 2000],
      nps: 50,
      rating: 'CL150',
      face: 'RF',
      endPrep: 'BW',
      material: 'A105',
      spec: 'SPEC-01'
    },
    {
      type: 'VALVE',
      position: [6800, 0, 2000],
      nps: 50,
      valveType: 'GATE',
      endPrep: 'BW',
      material: 'A216 WCB',
      spec: 'SPEC-01'
    },
    { type: 'WELD', position: [7200, 0, 2000], nps: 50, weldType: 'FIELD', material: 'E7018' },
    { type: 'WELD', position: [7300, 0, 2000], nps: 50, weldType: 'FIELD', material: 'E7018' },
    { type: 'WELD', position: [7400, 0, 2000], nps: 50, weldType: 'FIELD', material: 'E7018' },
    { type: 'WELD', position: [7500, 0, 2000], nps: 50, weldType: 'FIELD', material: 'E7018' }
  ];
}

function countByType(elems) {
  const counts = {};
  for (const t of elems) counts[t] = (counts[t] || 0) + 1;
  return counts;
}

describe('PCF exporter', () => {
  it('emits grammar-valid PCF with balanced headers and no stray tokens', () => {
    const doc = exportPCF(pipeFixtures());
    const parsed = parsePCF(doc);
    assert.ok(parsed.unitsKeys.includes('BORE'), 'UNITS block present with BORE');
    assert.ok(parsed.unitsKeys.includes('CO-ORDS'), 'UNITS block present with CO-ORDS');
    assert.ok(parsed.elems.length > 0, 'at least one ELEM record');
    assert.ok(doc.includes('UNITS\n'), 'UNITS section header present');
    assert.ok(doc.includes('HDR\n'), 'HDR section header present');
    assert.ok(doc.includes('ATTR\n'), 'ATTR section header present');
    assert.ok(doc.includes('NODE\n'), 'NODE section header present');
    const endCount = (doc.match(/^END$/gm) || []).length;
    assert.equal(
      endCount,
      3 + pipeFixtures().length * 3,
      'END markers match opened sections (UNITS, TEXT, NODE + HDR/DATA/ATTR per component)'
    );
  });

  it('emits exactly the expected component records by type', () => {
    const doc = exportPCF(pipeFixtures());
    const parsed = parsePCF(doc);
    const counts = countByType(parsed.elems);
    assert.equal(counts.PIPE, 3);
    assert.equal(counts.ELBOW, 2);
    assert.equal(counts.FLANGE, 1);
    assert.equal(counts.VALVE, 1);
    assert.equal(counts.WELD, 4);
    assert.equal(parsed.elems.length, 11);
    const typeCounts = {};
    for (const t of COMPONENT_TYPES) typeCounts[t] = (doc.match(new RegExp(`^ELEM ${t}$`, 'gm')) || []).length;
    assert.deepEqual(typeCounts, { PIPE: 3, ELBOW: 2, TEE: 0, REDUCER: 0, FLANGE: 1, VALVE: 1, WELD: 4 });
  });

  it('emits component coordinates within 1e-6', () => {
    const comps = [{ type: 'PIPE', position: [1.5, -2.25, 3.75], t: 6.35, endPrep: 'BW' }];
    const doc = exportPCF(comps);
    const parsed = parsePCF(doc);
    const data = parsed.compData.get(1);
    assert.ok(data, 'component 1 has DATA records');
    const pos = data.find((d) => d.kw === 'POSITION');
    assert.ok(pos, 'POSITION record present');
    assert.ok(Math.abs(pos.x - 1.5) <= EPS);
    assert.ok(Math.abs(pos.y - -2.25) <= EPS);
    assert.ok(Math.abs(pos.z - 3.75) <= EPS);
    assert.ok(doc.includes('POSITION 1.5 -2.25 3.75'), 'exact formatted coordinate line');
  });

  it('emits wall thickness and end preparation attributes for pipes', () => {
    const comps = [
      { type: 'PIPE', position: [0, 0, 0], t: 6.35, endPrep: 'BW' },
      { type: 'PIPE', position: [1000, 0, 0], t: 4.78, endPrep: 'SW' },
      { type: 'PIPE', position: [2000, 0, 0], t: 3.2, endPrep: 'TH' }
    ];
    const doc = exportPCF(comps);
    const parsed = parsePCF(doc);
    assert.equal(parsed.compAttr.size, 3);
    assert.ok(doc.includes('WALL-THICKNESS 6.35'));
    assert.ok(doc.includes('WALL-THICKNESS 4.78'));
    assert.ok(doc.includes('WALL-THICKNESS 3.2'));
    assert.ok(doc.includes('END-PREPARATION BW'));
    assert.ok(doc.includes('END-PREPARATION SW'));
    assert.ok(doc.includes('END-PREPARATION TH'));
    for (const prep of ['BW', 'SW', 'TH']) {
      assert.ok(VALID_END_PREPS.includes(prep), `${prep} is a valid end prep code`);
    }
  });

  it('preserves material grade strings verbatim', () => {
    const comps = [
      { type: 'PIPE', position: [0, 0, 0], material: 'A106 GR.B', t: 6.35 },
      { type: 'VALVE', position: [500, 0, 0], material: 'A216 WCB', valveType: 'GATE' },
      { type: 'PIPE', position: [1000, 0, 0], material: 'A312 TP304L SS', t: 4.78 }
    ];
    const doc = exportPCF(comps);
    assert.ok(doc.includes('MATERIAL A106 GR.B'), 'multi-word grade preserved');
    assert.ok(doc.includes('MATERIAL A216 WCB'));
    assert.ok(doc.includes('MATERIAL A312 TP304L SS'));
    const parsed = parsePCF(doc);
    assert.equal(parsed.compAttr.size, 3);
  });

  it('emits NODE connectivity where consecutive components share node numbers', () => {
    const comps = pipeFixtures();
    const doc = exportPCF(comps);
    const parsed = parsePCF(doc);
    assert.equal(parsed.nodes.length, comps.length * 2);
    const nodesByComp = {};
    for (const node of parsed.nodes) {
      (nodesByComp[node.comp] = nodesByComp[node.comp] || new Set()).add(node.id);
    }
    for (let i = 1; i < comps.length; i++) {
      const a = nodesByComp[i];
      const b = nodesByComp[i + 1];
      assert.ok(a && b, `components ${i} and ${i + 1} have NODE entries`);
      const shared = [...a].filter((id) => b.has(id));
      assert.ok(shared.length > 0, `components ${i} and ${i + 1} share a node number`);
    }
    for (let i = 1; i <= comps.length; i++) {
      assert.equal(nodesByComp[i].size, 2, `component ${i} has START and END nodes`);
    }
  });

  it('is deterministic: same input -> byte-identical export', () => {
    const comps = pipeFixtures();
    const docA = new PCFExporter().exportPCF(comps);
    const docB = new PCFExporter().exportPCF(comps);
    const docC = exportPCF(comps, { projectName: 'P', pipelineRef: 'L' });
    const docD = exportPCF(comps, { projectName: 'P', pipelineRef: 'L' });
    assert.equal(docA, docB);
    assert.equal(docC, docD);
    assert.ok(docA.length > 0);
    assert.ok(docA.endsWith('\n'), 'export ends with newline');
  });

  it('fails closed on invalid component type', () => {
    assert.throws(() => exportPCF([{ type: 'UNICORN', position: [0, 0, 0] }]), TypeError);
    assert.throws(() => exportPCF([{ type: 'PIPE-2', position: [0, 0, 0] }]), TypeError);
    assert.throws(() => exportPCF([{ position: [0, 0, 0] }]), TypeError);
    assert.throws(() => exportPCF('not-an-array'), TypeError);
  });

  it('fails closed on missing or malformed coordinates', () => {
    assert.throws(() => exportPCF([{ type: 'PIPE', t: 6.35 }]), TypeError);
    assert.throws(() => exportPCF([{ type: 'PIPE', position: [0, 0] }]), TypeError);
    assert.throws(() => exportPCF([{ type: 'PIPE', position: [0, 0, 'x'] }]), TypeError);
    assert.throws(() => exportPCF([{ type: 'PIPE', position: [0, 0, NaN] }]), TypeError);
    assert.throws(() => exportPCF([{ type: 'PIPE', position: null }]), TypeError);
    assert.throws(() => exportPCF([{ type: 'PIPE', position: [0, 0, 0], endPrep: 'XX' }]), TypeError);
  });
});
