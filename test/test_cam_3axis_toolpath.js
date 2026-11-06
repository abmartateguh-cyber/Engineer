'use strict';

/**
 * Honest verification of the real 3-axis contour-parallel CAM toolpath engine.
 *
 * Asserts:
 *  (i)   offset loops shrink monotonically and stay inside the boundary,
 *  (ii)  no loop self-intersections (production segment-intersection helpers),
 *  (iii) G-code parses: only G0/G1/G2/G3 motion with F values; bounding box fit,
 *  (iv)  finish pass follows the boundary contour at wall offset,
 *  (v)   retract plane is above stock top for every rapid move,
 *  (vi)  determinism: identical inputs -> identical outputs,
 *  (vii) adapter route executes end-to-end (new contour op + legacy op).
 */

const assert = require('assert');
const { CAMEngineAdapter } = require('../src/core/cam/cam_engine_adapter');
const { CNCToolpathEngine } = require('../src/core/cam/cnc_toolpath_engine');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');

const g = require('../src/core/cam/planar_offset_geometry');
const { pointInPolygonWinding, segmentsIntersectStrict } = require('../src/core/cae/delaunay_constrained_2d');

const boundary = [
  { x: 0, y: 0 },
  { x: 80, y: 0 },
  { x: 80, y: 40 },
  { x: 50, y: 40 },
  { x: 50, y: 80 },
  { x: 0, y: 80 }
];

const bounds = { minX: -10, maxX: 90, minY: -10, maxY: 90, minZ: 0, maxZ: 15 };

const toolOptions = {
  toolDiameter: 10,
  toolType: 'flat_endmill',
  spindleRpm: 9000,
  feedRateMmMin: 1200,
  plungeRateMmMin: 300,
  finishFeedRateMmMin: 500,
  stepoverMm: 6,
  stepdownMm: 3,
  safeZ: 25,
  retractPlane: 30,
  radialEngagementFraction: 0.4,
  cornerRadiusMm: 2.5
};

const toolR = toolOptions.toolDiameter / 2;
const wallOffset = toolR + 0;

function makeEngine(overrides = {}) {
  return new CNCToolpathEngine({ ...toolOptions, ...overrides });
}

function groupContours(layer) {
  const groups = [];
  let current = null;
  for (const pt of layer) {
    if (pt.type === 'rapid') {
      current = [];
      groups.push(current);
    } else if (pt.type === 'plunge') {
      current.kind = null;
    } else if (current) {
      if (current.kind === null && pt.type !== 'finish') current.kind = 'rough';
      if (pt.type === 'finish') current.kind = 'finish';
      current.push(pt);
    }
  }
  return groups.filter((grp) => grp.length > 0);
}

function closeLoop(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-9) continue;
    out.push({ x: p.x, y: p.y });
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 1e-9) {
    out.pop();
  }
  return out;
}

function expandArcs(loopPts) {
  const out = [];
  let prev = null;
  for (const p of loopPts) {
    if (prev && p.type === 'arc') {
      const r = Math.hypot(p.i, p.j);
      const cx = prev.x + p.i;
      const cy = prev.y + p.j;
      const a1 = Math.atan2(prev.y - cy, prev.x - cx);
      const a2 = Math.atan2(p.y - cy, p.x - cx);
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const ang = a1 + (a2 - a1) * t;
        out.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
      }
      prev = { x: p.x, y: p.y };
    } else {
      out.push({ x: p.x, y: p.y });
      prev = { x: p.x, y: p.y };
    }
  }
  return closeLoop(out);
}

function assertNoSelfIntersections(loop, label) {
  const n = loop.length;
  assert(n >= 3, `${label}: degenerate contour`);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = loop[i];
      const b = loop[(i + 1) % n];
      const c = loop[j];
      const d = loop[(j + 1) % n];
      const hit = g.segmentsIntersect(a, b, c, d);
      assert(
        !hit.intersects,
        `${label}: self-intersection between segment ${i} and ${j} at (${hit.point ? hit.point.x.toFixed(3) : '?'}, ${hit.point ? hit.point.y.toFixed(3) : '?'})`
      );
      const strict = segmentsIntersectStrict(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
      assert(!strict, `${label}: strict self-crossing between segment ${i} and ${j}`);
    }
  }
}

function interiorSample(loop) {
  let best = null;
  let bestD = -1;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-9) continue;
    const nx = -dy / l;
    const ny = dx / l;
    for (const s of [1, -1]) {
      const p = { x: mx + s * 1e-6 * nx, y: my + s * 1e-6 * ny };
      if (!g.pointInPolygon(p, loop)) continue;
      let md = Infinity;
      for (let k = 0; k < n; k++) {
        const d = g.distancePointToSegment(p, loop[k], loop[(k + 1) % n]);
        if (d < md) md = d;
      }
      if (md > bestD) {
        bestD = md;
        best = p;
      }
    }
  }
  return best || { x: loop[0].x, y: loop[0].y };
}

function samplePoints(loop) {
  const samples = [interiorSample(loop)];
  for (let i = 0; i < loop.length; i++) {
    samples.push(loop[i]);
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    samples.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return samples;
}

function assertChildInsideParent(child, parent, label) {
  for (const s of samplePoints(child)) {
    assert(g.pointInPolygon(s, parent), `${label}: sample escaped parent`);
  }
  for (let i = 0; i < child.length; i++) {
    for (let j = 0; j < parent.length; j++) {
      const a = child[i];
      const b = child[(i + 1) % child.length];
      const c = parent[j];
      const d = parent[(j + 1) % parent.length];
      const shareEndpoint =
        (Math.hypot(a.x - c.x, a.y - c.y) < 1e-9 && Math.hypot(b.x - d.x, b.y - d.y) < 1e-9) ||
        (Math.hypot(a.x - d.x, a.y - d.y) < 1e-9 && Math.hypot(b.x - c.x, b.y - c.y) < 1e-9);
      if (shareEndpoint) continue;
      const hit = g.segmentsIntersect(a, b, c, d);
      assert(!hit.intersects, `${label}: child edge ${i} crosses parent edge ${j}`);
    }
  }
}

function minDistanceToBoundary(loopPts) {
  let best = Infinity;
  for (const p of loopPts) {
    for (let i = 0; i < boundary.length; i++) {
      const d = g.distancePointToSegment(p, boundary[i], boundary[(i + 1) % boundary.length]);
      if (d < best) best = d;
    }
  }
  return best;
}

function parseGCode(gcode) {
  const motions = [];
  for (const rawLine of gcode.split('\n')) {
    const line = rawLine.replace(/\([^)]*\)/g, '').trim();
    if (!line) continue;
    const m = /^(G\d\d?)/.exec(line);
    if (!m) continue;
    const words = {};
    for (const w of line.matchAll(/([XYZIJF])(-?\d+(?:\.\d+)?)/g)) {
      words[w[1]] = Number(w[2]);
    }
    motions.push({ code: m[1], line, words });
  }
  return motions;
}

(async () => {
  console.log('================================================================');
  console.log('   TESTING REAL 3-AXIS CONTOUR-PARALLEL CAM TOOLPATH ENGINE     ');
  console.log('================================================================\n');

  // ---------------------------------------------------------------- planning
  const engine = makeEngine();
  const plan = engine.plan3AxisToolpath({ boundary, bounds, finishAllowanceMm: 0 });

  assert.strictEqual(plan.type, 'Contour-Parallel 3-Axis Roughing + Finish');
  assert.strictEqual(plan.telemetry.layerCount, 5);
  assert(plan.telemetry.contourCount >= 3, 'expected multiple nested offset contours');
  assert(plan.telemetry.maxEngagementMm <= Math.min(toolOptions.stepoverMm, 0.4 * toolOptions.toolDiameter) + 1e-9);

  // (i) + (ii): geometry safety per layer
  const firstLayer = plan.layers[0];
  const roughGroups = groupContours(firstLayer).filter((grp) => grp.kind === 'rough');
  const roughMeta = firstLayer.meta.contours.filter((c) => c.kind === 'rough');
  assert.strictEqual(roughGroups.length, roughMeta.length, 'meta/group contour parity');

  const loopById = new Map();
  roughMeta.forEach((meta, idx) => {
    loopById.set(meta.id, { meta, loop: expandArcs(roughGroups[idx]) });
  });

  for (const layer of plan.layers) {
    const groups = groupContours(layer).filter((grp) => grp.kind === 'rough');
    const meta = layer.meta.contours.filter((c) => c.kind === 'rough');
    assert.strictEqual(groups.length, meta.length);
    meta.forEach((m, idx) => {
      const loop = expandArcs(groups[idx]);
      assertNoSelfIntersections(loop, `layer z=${layer.meta.z.toFixed(1)} contour #${m.id}`);
      const loopArea = Math.abs(g.signedArea(loop));
      assert(loopArea > 0, 'contour must have positive area');
      assert(loopArea <= m.area + 1e-3 && loopArea >= m.area - 60, 'contour area close to sharp-polygon meta area');
      for (const s of samplePoints(loop)) {
        assert(g.pointInPolygon(s, boundary), `sample outside boundary (contour ${m.id})`);
        assert(
          pointInPolygonWinding(
            s.x,
            s.y,
            boundary.map((p) => [p.x, p.y])
          ) !== 0,
          `production winding helper disagrees (contour ${m.id})`
        );
      }
    });
  }

  for (const { meta, loop } of loopById.values()) {
    if (meta.parentId === -1) continue;
    const parent = loopById.get(meta.parentId);
    assert(parent, `missing parent ${meta.parentId}`);
    assert(meta.area < parent.meta.area - 1e-6, `contour ${meta.id} area did not shrink below parent ${meta.parentId}`);
    assertChildInsideParent(loop, parent.loop, `contour ${meta.id} vs parent ${meta.parentId}`);
  }

  // (iv) finish pass follows boundary contour at wall offset
  let finishLoop = null;
  let finishDiameter = 0;
  for (const layer of plan.layers) {
    const finishGroup = groupContours(layer).find((grp) => grp.kind === 'finish');
    assert(finishGroup, 'every layer must contain a finish pass');
    const loop = expandArcs(finishGroup);
    assertNoSelfIntersections(loop, `finish pass z=${layer.meta.z.toFixed(1)}`);
    finishLoop = loop;
    finishDiameter += 1;
  }
  assert.strictEqual(finishDiameter, plan.telemetry.layerCount);
  const finishDist = minDistanceToBoundary(finishLoop);
  assert(
    Math.abs(finishDist - wallOffset) < 0.05,
    `finish pass wall offset ${finishDist.toFixed(4)} mm; expected ${wallOffset} mm`
  );

  // (iii) G-code parse + bounding box fit
  const gcode = engine.generateGCode(plan, 'O7001');
  const motions = parseGCode(gcode);
  const motionSet = new Set(['G0', 'G00', 'G1', 'G01', 'G2', 'G02', 'G3', 'G03']);
  let arcs = 0;
  let finishFeedLines = 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const m of motions) {
    const hasCoord = m.words.X !== undefined || m.words.Y !== undefined || m.words.Z !== undefined;
    if (!hasCoord) continue;
    if (m.code === 'G28') continue;
    assert(motionSet.has(m.code), `unexpected motion code ${m.code} in: ${m.line}`);
    const feedMotions = ['G1', 'G01', 'G2', 'G02', 'G3', 'G03'];
    if (feedMotions.includes(m.code)) {
      assert(Number.isFinite(m.words.F), `feed move missing F: ${m.line}`);
      if (m.code === 'G2' || m.code === 'G02' || m.code === 'G3' || m.code === 'G03') arcs++;
      if (m.words.F === toolOptions.finishFeedRateMmMin) finishFeedLines++;
    } else {
      assert(m.words.F === undefined, `rapid must not carry F: ${m.line}`);
    }
    if (m.words.X !== undefined) {
      minX = Math.min(minX, m.words.X);
      maxX = Math.max(maxX, m.words.X);
    }
    if (m.words.Y !== undefined) {
      minY = Math.min(minY, m.words.Y);
      maxY = Math.max(maxY, m.words.Y);
    }
    if (m.words.Z !== undefined) {
      minZ = Math.min(minZ, m.words.Z);
      maxZ = Math.max(maxZ, m.words.Z);
    }
  }
  assert(arcs > 0, 'expected G2/G3 arc commands');
  assert(finishFeedLines > 0, 'expected finish feedrate lines');
  assert(minX >= bounds.minX - toolR - 1e-6 && maxX <= bounds.maxX + toolR + 1e-6, 'X bounding box exceeded stock');
  assert(minY >= bounds.minY - toolR - 1e-6 && maxY <= bounds.maxY + toolR + 1e-6, 'Y bounding box exceeded stock');
  assert(
    minZ >= bounds.minZ - 1e-6 && maxZ <= toolOptions.retractPlane + 1e-6,
    'Z bounding box exceeded stock/safe range'
  );

  // (v) every rapid at retract plane, above stock top
  for (const m of motions) {
    if (m.code === 'G0' || m.code === 'G00') {
      assert.strictEqual(m.words.Z, toolOptions.retractPlane, `rapid must be at retract plane: ${m.line}`);
    }
  }
  assert(toolOptions.retractPlane > bounds.maxZ, 'test setup: retract plane must clear stock top');

  // (vi) determinism
  const plan2 = engine.plan3AxisToolpath({ boundary, bounds, finishAllowanceMm: 0 });
  assert.deepStrictEqual(plan, plan2, 'repeated planning must be deterministic');
  const gcode2 = engine.generateGCode(plan2, 'O7001');
  const stripDate = (s) =>
    s
      .split('\n')
      .filter((l) => !/^\(DATE:/.test(l))
      .join('\n');
  assert.strictEqual(stripDate(gcode), stripDate(gcode2), 'repeated G-code must be deterministic');

  // ------------------------------------------------------------ adapter route
  const adapter = new CAMEngineAdapter();
  assert(adapter.describeCapabilities().supportedOperations.includes('plan_3axis_toolpath'));
  const req = new JobRequest({
    domain: 'cam',
    operation: 'plan_3axis_toolpath',
    parameters: { boundary, bounds, toolOptions, finishAllowanceMm: 0 }
  });
  const res = await adapter.execute(req);
  assert.strictEqual(res.status, JobStatus.SUCCEEDED);
  const gcodeReq = new JobRequest({
    domain: 'cam',
    operation: 'generate_gcode',
    parameters: { toolpaths: res.outputData, toolOptions, programNumber: 'O7002' }
  });
  const gcodeRes = await adapter.execute(gcodeReq);
  assert.strictEqual(gcodeRes.status, JobStatus.SUCCEEDED);
  assert(gcodeRes.outputData.gcode.includes('G02') || gcodeRes.outputData.gcode.includes('G03'));
  assert(gcodeRes.outputData.gcode.includes('M30'));

  // legacy 2.5D raster still works (engine direct + adapter default)
  const legacyEngine = makeEngine({ legacyMode: true, cornerRadiusMm: 0 });
  const legacyPlan = legacyEngine.planToolpath({ bounds });
  assert.strictEqual(legacyPlan.type, 'Constant-Z Planar Roughing');
  const legacyGcode = legacyEngine.generateGCode(legacyPlan, 'O7003');
  assert(!/\bG0[23]\b/.test(legacyGcode), 'legacy raster must not emit arcs');
  const legacyReq = new JobRequest({
    domain: 'cam',
    operation: 'plan_roughing_toolpath',
    parameters: { bounds, toolOptions }
  });
  const legacyRes = await adapter.execute(legacyReq);
  assert.strictEqual(legacyRes.status, JobStatus.SUCCEEDED);
  const legacyContourReq = new JobRequest({
    domain: 'cam',
    operation: 'plan_roughing_toolpath',
    parameters: { boundary, bounds, toolOptions, legacyMode: false }
  });
  const legacyContourRes = await adapter.execute(legacyContourReq);
  assert.strictEqual(legacyContourRes.status, JobStatus.SUCCEEDED);

  console.log(
    `  ✓ Contour-parallel roughing: ${plan.telemetry.contourCount} contours/layer, ${plan.telemetry.layerCount} Z layers`
  );
  console.log(
    `  ✓ Radial engagement policy: max stepover ${plan.telemetry.maxEngagementMm} mm (${plan.telemetry.radialEngagementFraction} x D)`
  );
  console.log(`  ✓ Finish pass: ${finishDiameter} boundary-following passes at wall offset ${wallOffset} mm`);
  console.log(`  ✓ G-code: ${motions.length} motion lines, ${arcs} arcs (G2/G3), ${finishFeedLines} finish-feed lines`);
  console.log(
    `  ✓ Bounding box fit: X[${minX.toFixed(2)},${maxX.toFixed(2)}] Y[${minY.toFixed(2)},${maxY.toFixed(2)}] Z[${minZ.toFixed(2)},${maxZ.toFixed(2)}]`
  );
  console.log(
    `  ✓ Telemetry: ${plan.telemetry.totalPathLengthMm} mm path, ~${plan.telemetry.estimatedTimeMin} min, MRR ${plan.telemetry.mrrMm3PerMin} mm3/min`
  );
  console.log('  ✓ All loop-safety, determinism, and adapter end-to-end assertions passed\n');

  console.log('================================================================');
  console.log('            ALL REAL 3-AXIS CAM TOOLPATH TESTS PASSED!          ');
  console.log('================================================================');
})();
