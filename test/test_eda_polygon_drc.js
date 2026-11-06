'use strict';

const assert = require('assert');
const { DRCEngine } = require('../src/core/eda/drc_engine');
const { EDAEngineAdapter } = require('../src/core/eda/eda_engine_adapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');

// Two 45-degree diamond polygons (radius 5). Their minimum separation is the
// distance between the parallel diagonal edges x+y=5 and x+y=13 => 8/sqrt(2).
const diamond1 = [
  { x: 5, y: 0 },
  { x: 0, y: 5 },
  { x: -5, y: 0 },
  { x: 0, y: -5 }
];
const diamond2 = [
  { x: 18, y: 5 },
  { x: 13, y: 10 },
  { x: 8, y: 5 },
  { x: 13, y: 0 }
];

const allEdgesDiagonal45 = (vertices) =>
  vertices.every((v, i) => {
    const w = vertices[(i + 1) % vertices.length];
    return Math.abs(w.x - v.x) === Math.abs(w.y - v.y) && Math.abs(w.x - v.x) > 0;
  });

const edgeKey = (e) => `${e.x1},${e.y1}->${e.x2},${e.y2}`;
const hasEdge = (violation, key) => Array.isArray(violation.edges) && violation.edges.some((e) => edgeKey(e) === key);

(async () => {
  console.log('==============================================================');
  console.log('   TESTING ALL-ANGLE POLYGON DRC (drc_engine + adapter)');
  console.log('==============================================================\n');

  // ---------------------------------------------------------------------
  // (i) Width violation: C/L-shaped metal with a 2-unit-wide right arm and
  //      minWidth 5. The narrow arm is bounded by the right outer edge and
  //      the right inner edge.
  // ---------------------------------------------------------------------
  const Cshape = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 38, y: 40 },
    { x: 38, y: 10 },
    { x: 12, y: 10 },
    { x: 12, y: 40 },
    { x: 0, y: 40 }
  ];
  const widthResult = DRCEngine.runPolygonDRC([{ id: 'C1', layer: 'metal1', vertices: Cshape }], {
    minWidth: 5,
    minSpacing: 1,
    minArea: 1
  });
  assert.strictEqual(widthResult.success, true);
  assert.strictEqual(widthResult.mode, 'polygon');
  assert.strictEqual(widthResult.clean, false);
  const widthViolations = widthResult.violations.filter((v) => v.type === 'MIN_WIDTH_VIOLATION');
  assert(widthViolations.length >= 1, 'expected at least one width violation');
  const correctPair = widthViolations.find((v) => hasEdge(v, '40,0->40,40') && hasEdge(v, '38,40->38,10'));
  assert(correctPair, 'width violation must be reported at the correct (outer/inner) edge pair');
  assert.strictEqual(correctPair.rule, 'minWidth');
  assert.strictEqual(correctPair.layer, 'metal1');
  assert.strictEqual(correctPair.shapeId, 'C1');
  assert.strictEqual(correctPair.ruleLimit, 5);
  assert(Math.abs(correctPair.foundValue - 2) < 1e-6, `measured width ${correctPair.foundValue} should be 2`);
  assert(Number.isFinite(correctPair.location.x) && Number.isFinite(correctPair.location.y));
  assert(typeof correctPair.message === 'string' && correctPair.message.length > 0);
  console.log('[1] PASS: L/C-shape notch width violation reported at correct edge pair (found=2, limit=5)\n');

  // ---------------------------------------------------------------------
  // (ii) Spacing violation between two diagonal 45-degree polygons.
  // ---------------------------------------------------------------------
  assert(allEdgesDiagonal45(diamond1) && allEdgesDiagonal45(diamond2), 'fixture diamonds must be 45-degree');
  const spacingShapes = [
    { id: 'd1', layer: 'metal1', vertices: diamond1 },
    { id: 'd2', layer: 'metal1', vertices: diamond2 }
  ];
  const spacingResult = DRCEngine.runPolygonDRC(spacingShapes, {
    minWidth: 3,
    minSpacing: 6,
    minArea: 1
  });
  assert.strictEqual(spacingResult.success, true);
  assert.strictEqual(spacingResult.clean, false);
  const spacingViolations = spacingResult.violations.filter((v) => v.type === 'MIN_SPACING_VIOLATION');
  assert.strictEqual(spacingViolations.length, 1);
  const sv = spacingViolations[0];
  assert.strictEqual(sv.rule, 'minSpacing');
  assert.strictEqual(sv.layer, 'metal1');
  assert.deepStrictEqual(sv.shapeIds, ['d1', 'd2']);
  assert.strictEqual(sv.ruleLimit, 6);
  assert(Math.abs(sv.foundValue - 8 / Math.sqrt(2)) < 1e-4, `measured spacing ${sv.foundValue} should be ~5.6569`);
  assert(Number.isFinite(sv.location.x) && Number.isFinite(sv.location.y));
  assert(Array.isArray(sv.edges) && sv.edges.length === 1);
  console.log(`[2] PASS: diagonal spacing violation (found=${sv.foundValue}, limit=6)\n`);

  // ---------------------------------------------------------------------
  // Different-layer spacing via spacingByLayer override.
  // ---------------------------------------------------------------------
  const crossLayerResult = DRCEngine.runPolygonDRC(
    [
      { id: 'm1', layer: 'metal1', x: 0, y: 0, w: 10, h: 10 },
      { id: 'm2', layer: 'metal2', x: 14, y: 0, w: 10, h: 10 }
    ],
    {
      minWidth: 2,
      minSpacing: 0.5,
      minArea: 1,
      spacingByLayer: { 'metal1:metal2': 6 }
    }
  );
  assert.strictEqual(crossLayerResult.success, true);
  const crossViolations = crossLayerResult.violations.filter((v) => v.type === 'MIN_SPACING_VIOLATION');
  assert.strictEqual(crossViolations.length, 1);
  assert.strictEqual(crossViolations[0].layer, 'metal1/metal2');
  assert(Math.abs(crossViolations[0].foundValue - 4) < 1e-6);
  console.log('[3] PASS: different-layer spacing via spacingByLayer (found=4, limit=6)\n');

  // ---------------------------------------------------------------------
  // (iii) Valid layout -> clean.
  // ---------------------------------------------------------------------
  const cleanResult = DRCEngine.runPolygonDRC(
    [
      { id: 'box1', layer: 'metal1', x: 0, y: 0, w: 30, h: 30 },
      {
        id: 'd1',
        layer: 'metal1',
        vertices: diamond1.map((p) => ({ x: p.x + 100, y: p.y + 100 }))
      },
      {
        id: 'd2',
        layer: 'metal1',
        vertices: diamond2.map((p) => ({ x: p.x + 100, y: p.y + 100 }))
      }
    ],
    { minWidth: 4, minSpacing: 5, minArea: 40 }
  );
  assert.strictEqual(cleanResult.success, true);
  assert.strictEqual(cleanResult.clean, true);
  assert.strictEqual(cleanResult.violationCount, 0);
  assert.deepStrictEqual(cleanResult.violations, []);
  assert.strictEqual(cleanResult.verdict, 'EXPERIMENTAL_POLYGON_SCREENING_CLEAR');
  console.log('[4] PASS: valid layout screens clean\n');

  // ---------------------------------------------------------------------
  // (iv) Self-intersecting polygon input -> typed validation error.
  // ---------------------------------------------------------------------
  const bowtie = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
    { x: 0, y: 10 }
  ];
  const bowResult = DRCEngine.runPolygonDRC([{ id: 'bow', layer: 'metal1', vertices: bowtie }], {
    minWidth: 1,
    minSpacing: 1,
    minArea: 1
  });
  assert.strictEqual(bowResult.success, false);
  assert.strictEqual(bowResult.error.code, 'INVALID_POLYGON_SELF_INTERSECTION');
  assert.strictEqual(bowResult.error.shapeId, 'bow');
  assert(Math.abs(bowResult.error.point.x - 5) < 1e-6 && Math.abs(bowResult.error.point.y - 5) < 1e-6);
  assert(Array.isArray(bowResult.error.edges) && bowResult.error.edges.length === 2);
  console.log('[5] PASS: self-intersecting polygon rejected with typed error at (5,5)\n');

  // ---------------------------------------------------------------------
  // Enclosure + area checks.
  // ---------------------------------------------------------------------
  const enclosureResult = DRCEngine.runPolygonDRC(
    [
      { id: 'bdry', layer: 'boundary', x: 0, y: 0, w: 100, h: 100 },
      {
        id: 'inside',
        layer: 'metal1',
        vertices: [
          { x: 25, y: 20 },
          { x: 20, y: 25 },
          { x: 15, y: 20 },
          { x: 20, y: 15 }
        ]
      },
      { id: 'out', layer: 'metal1', x: 200, y: 200, w: 10, h: 10 },
      {
        id: 'tiny',
        layer: 'metal1',
        vertices: [
          { x: 51, y: 50 },
          { x: 50, y: 51 },
          { x: 49, y: 50 },
          { x: 50, y: 49 }
        ]
      }
    ],
    {
      minWidth: 1,
      minSpacing: 1,
      minArea: 40,
      enclosures: [{ layer: 'metal1', enclosingLayer: 'boundary', margin: 1 }]
    }
  );
  assert.strictEqual(enclosureResult.success, true);
  const enclosureViolations = enclosureResult.violations.filter((v) => v.type === 'ENCLOSURE_VIOLATION');
  assert.strictEqual(enclosureViolations.length, 1);
  assert.strictEqual(enclosureViolations[0].shapeId, 'out');
  assert.strictEqual(enclosureViolations[0].rule, 'enclosure');
  const areaViolations = enclosureResult.violations.filter((v) => v.type === 'MIN_AREA_VIOLATION');
  assert.strictEqual(areaViolations.length, 1);
  assert.strictEqual(areaViolations[0].shapeId, 'tiny');
  assert(Math.abs(areaViolations[0].foundValue - 2) < 1e-6);
  console.log('[6] PASS: enclosure violation (outside boundary) and min-area warning\n');

  // ---------------------------------------------------------------------
  // (vi) Determinism.
  // ---------------------------------------------------------------------
  const firstRun = DRCEngine.runPolygonDRC(spacingShapes, {
    minWidth: 3,
    minSpacing: 6,
    minArea: 1
  });
  const secondRun = DRCEngine.runPolygonDRC(spacingShapes, {
    minWidth: 3,
    minSpacing: 6,
    minArea: 1
  });
  assert.deepStrictEqual(secondRun, firstRun);
  console.log('[7] PASS: repeated polygon DRC runs are byte-identical\n');

  // ---------------------------------------------------------------------
  // (vii) Adapter route end-to-end (polygon default + legacy box mode).
  // ---------------------------------------------------------------------
  const adapter = new EDAEngineAdapter();
  const polyReq = new JobRequest({
    domain: 'eda',
    operation: 'run_drc',
    parameters: {
      shapes: spacingShapes,
      rules: { minWidth: 3, minSpacing: 6, minArea: 1 }
    }
  });
  const polyRes = await adapter.execute(polyReq);
  assert.strictEqual(polyRes.status, JobStatus.SUCCEEDED);
  assert.strictEqual(polyRes.outputData.mode, 'polygon');
  assert.strictEqual(polyRes.outputData.success, true);
  assert.strictEqual(polyRes.outputData.violationCount, 1);
  assert.strictEqual(polyRes.outputData.violations[0].type, 'MIN_SPACING_VIOLATION');
  assert(typeof polyRes.outputData.inputSha256 === 'string');
  console.log('[8] PASS: adapter run_drc defaults to polygon mode end-to-end\n');

  const boxReq = new JobRequest({
    domain: 'eda',
    operation: 'run_drc',
    parameters: {
      mode: 'box',
      shapes: [
        { id: 'rect1', layer: 'metal1', x: 0, y: 0, w: 10, h: 5 },
        { id: 'rect2', layer: 'metal1', x: 20, y: 0, w: 10, h: 5 }
      ],
      rules: { minWidth: 2, minSpacing: 4, minArea: 8 }
    }
  });
  const boxRes = await adapter.execute(boxReq);
  assert.strictEqual(boxRes.status, JobStatus.SUCCEEDED);
  assert.strictEqual(boxRes.outputData.success, true);
  assert.strictEqual(boxRes.outputData.clean, true);
  assert(boxRes.outputData.scope.includes('axis-aligned'));
  console.log('[9] PASS: legacy box DRC mode still works via adapter\n');

  const defaultBoxReq = new JobRequest({
    domain: 'eda',
    operation: 'run_drc',
    parameters: {
      shapes: [
        { id: 'rect1', layer: 'metal1', x: 0, y: 0, w: 10, h: 5 },
        { id: 'rect2', layer: 'metal1', x: 20, y: 0, w: 10, h: 5 }
      ],
      rules: { minWidth: 2, minSpacing: 4, minArea: 8 }
    }
  });
  const defaultBoxRes = await adapter.execute(defaultBoxReq);
  assert.strictEqual(defaultBoxRes.status, JobStatus.SUCCEEDED);
  assert.strictEqual(defaultBoxRes.outputData.mode, 'polygon');
  assert.strictEqual(defaultBoxRes.outputData.clean, true);
  console.log('[10] PASS: box-shaped input auto-normalized to polygons in default mode\n');

  console.log('==============================================================');
  console.log('   ALL POLYGON DRC TESTS PASSED!');
  console.log('==============================================================\n');
})();
