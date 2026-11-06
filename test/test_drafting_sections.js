/**
 * Test Suite: DraftingSections (section-view generator: stepped cuts,
 * cross-hatching, SVG rendering).
 *
 * Deterministic node:test tests. No external dependencies.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TriangleMesh,
  DraftingSections,
  helpers: { pointInPolyEvenOdd }
} = require('../src/core/cad/drafting_sections');

const TOL = 1e-6;

function regionLoops(region) {
  return region.loops.map((l) => ({
    kind: l.kind,
    area: l.area,
    points: l.points.map((p) => [p[0], p[1]])
  }));
}

test('DraftingSections: simple box cut by mid-plane yields exact cross-section rectangle', () => {
  const d = new DraftingSections();
  d.addSolid(TriangleMesh.box([-50, -40, -30], [50, 40, 30]));
  const r = d.section([0, 0, 0], [0, 0, 1]);

  assert.equal(r.loops.length, 1, 'must have exactly one contour loop');
  assert.equal(r.loops[0].kind, 'outer', 'box contour is an outer loop');
  assert.ok(r.loops[0].points.length >= 4, 'rectangle contour has at least 4 corners');
  assert.ok(Math.abs(r.bbox.maxX - r.bbox.minX - 100) < TOL, 'width must be 100');
  assert.ok(Math.abs(r.bbox.maxY - r.bbox.minY - 80) < TOL, 'height must be 80');
  assert.ok(Math.abs(r.area - 8000) < 1e-6, 'area must be exactly w x h = 8000');
  for (const p of r.loops[0].points) {
    assert.ok(Math.abs(Math.abs(p[0]) - 50) < TOL || Math.abs(Math.abs(p[1]) - 40) < TOL);
  }
});

test('DraftingSections: bore horizontal section shows rectangle + circle (two loops)', () => {
  const d = DraftingSections.createEngineBlock();
  const r = d.section([0, 0, 0], [0, 0, 1]);

  assert.equal(r.loops.length, 2, 'must have two loops: outer rectangle + inner circle');
  const outer = r.loops.find((l) => l.kind === 'outer');
  const hole = r.loops.find((l) => l.kind === 'hole');
  assert.ok(outer && hole, 'one outer loop and one hole loop');
  assert.ok(Math.abs(outer.area - 8000) < 1e-6, 'outer loop is the full rectangle');

  const cx = hole.points.reduce((s, p) => s + p[0], 0) / hole.points.length;
  const cy = hole.points.reduce((s, p) => s + p[1], 0) / hole.points.length;
  assert.ok(Math.abs(cx) < 1e-6, 'hole center x at bore center (0)');
  assert.ok(Math.abs(cy) < 1e-6, 'hole center y at bore center (0)');

  let meanR = 0;
  for (const p of hole.points) {
    const rad = Math.hypot(p[0] - cx, p[1] - cy);
    assert.ok(rad > 14.9 && rad < 15.1, `hole vertex radius ${rad} near bore radius 15`);
    meanR += rad;
  }
  meanR /= hole.points.length;
  assert.ok(Math.abs(meanR - 15) < 0.15, 'mean hole radius within 1% of bore radius');

  const expectedArea = 8000 - Math.PI * 15 * 15;
  assert.ok(Math.abs(r.area - expectedArea) / expectedArea < 0.01, 'net material area within 1% of analytic annulus');
});

test('DraftingSections: stepped cut produces two linked regions with correct geometry', () => {
  const d = DraftingSections.createEngineBlock({
    bore: { center: [-20, 0], r: 15 },
    galley: { min: [20, 13, -10], max: [46, 23, 0] }
  });
  const path = [
    [-50, 8],
    [10, 8],
    [10, -6],
    [50, -6]
  ];
  const s = d.steppedSection(path, [0, 1, 0]);

  assert.equal(s.steps.length, 1, 'one step connector segment');
  assert.equal(s.regions.length, 2, 'two cut regions');

  const r0 = s.regions[0];
  const r1 = s.regions[1];

  assert.equal(r0.loops.length, 2, 'region 1: outer rectangle + bore circle');
  assert.ok(Math.abs(r0.bbox.maxX - r0.bbox.minX - 60) < TOL, 'region 1 width 60');
  assert.ok(Math.abs(r0.bbox.maxY - r0.bbox.minY - 80) < TOL, 'region 1 depth 80');
  const circleArea = 0.5 * 48 * 15 * 15 * Math.sin((2 * Math.PI) / 48);
  const exp0 = 60 * 80 - circleArea;
  assert.ok(Math.abs(r0.area - exp0) / exp0 < 0.005, 'region 1 area within 0.5%');

  assert.equal(r1.loops.length, 2, 'region 2: outer rectangle + galley pocket');
  assert.ok(Math.abs(r1.bbox.maxX - r1.bbox.minX - 40) < TOL, 'region 2 width 40');
  assert.ok(Math.abs(r1.bbox.maxY - r1.bbox.minY - 80) < TOL, 'region 2 depth 80');
  assert.ok(Math.abs(r1.area - 2940) < 1e-6, 'region 2 area exactly 40x80 minus galley 26x10');

  const hole1 = r1.loops.find((l) => l.kind === 'hole');
  const hx = hole1.points.reduce((s, p) => s + p[0], 0) / hole1.points.length;
  const hy = hole1.points.reduce((s, p) => s + p[1], 0) / hole1.points.length;
  assert.ok(
    Math.abs(hx + r1.segment.p0[0] - 33) < TOL && Math.abs(hy - 18) < TOL,
    'galley hole center at world (33,18)'
  );

  const region0WorldMaxX = r0.segment.p0[0] + r0.maxAlong;
  const region1WorldMinX = r1.segment.p0[0] + r1.minAlong;
  assert.ok(Math.abs(region0WorldMaxX - region1WorldMinX) < TOL, 'regions link at the step line x=10');
  assert.ok(Math.abs(r0.bbox.minY - r1.bbox.minY) < TOL, 'both regions share the depth span');

  const expectedCut = 8000 - Math.PI * 15 * 15 - 260;
  const sumAreas = r0.area + r1.area;
  assert.ok(
    Math.abs(sumAreas - expectedCut) / expectedCut < 0.005,
    'sum of region areas within 0.5% of expected cut area'
  );
});

test('DraftingSections: cross-hatching lies inside polygons with uniform spacing', () => {
  const d = DraftingSections.createEngineBlock({
    bore: { center: [-20, 0], r: 15 },
    galley: { min: [20, 13, -10], max: [46, 23, 0] }
  });
  const s = d.steppedSection(
    [
      [-50, 8],
      [10, 8],
      [10, -6],
      [50, -6]
    ],
    [0, 1, 0]
  );

  const spacing = 5;
  const hatch = d.hatchRegion(s.regions[0], spacing, 45);
  assert.ok(hatch.segments.length > 10, 'enough hatch segments generated');

  const region = s.regions[0];
  const polys = region.loops.map((l) => l.points);
  let checked = 0;
  const midpoints = [];
  for (const seg of hatch.segments) {
    const mx = (seg[0] + seg[2]) / 2;
    const my = (seg[1] + seg[3]) / 2;
    let inside = false;
    for (const poly of polys) {
      if (pointInPolyEvenOdd([mx, my], poly)) inside = !inside;
    }
    assert.ok(inside, 'hatch segment midpoint must lie inside section material');
    checked += 1;
    midpoints.push([mx, my]);
  }
  assert.ok(checked === hatch.segments.length, '100% of hatch midpoints inside');

  const offsets = [];
  for (const p of midpoints) {
    const m = p[1] - p[0];
    if (offsets.length === 0 || Math.abs(m - offsets[offsets.length - 1]) > 1e-9) {
      offsets.push(m);
    }
  }
  offsets.sort((a, b) => a - b);
  const expected = Math.SQRT2 * spacing;
  for (let i = 1; i < offsets.length; i++) {
    const gap = offsets[i] - offsets[i - 1];
    assert.ok(Math.abs(gap - expected) / expected < 0.01, `hatch spacing gap ${gap} within 1% of ${expected}`);
  }
});

test('DraftingSections: deterministic output across runs', () => {
  const run = () => {
    const d = DraftingSections.createEngineBlock({
      bore: { center: [-20, 0], r: 15 },
      galley: { min: [20, 13, -10], max: [46, 23, 0] }
    });
    const cut = d.section([0, 0, 0], [0, 0, 1]);
    const stepped = d.steppedSection(
      [
        [-50, 8],
        [10, 8],
        [10, -6],
        [50, -6]
      ],
      [0, 1, 0]
    );
    const hatch = d.hatchRegion(stepped.regions[0], 5, 45);
    const svg = d.renderSVG({ regions: stepped.regions });
    const html = d.renderHTML({ regions: stepped.regions });
    return JSON.stringify({
      cut: regionLoops(cut),
      regions: stepped.regions.map((r) => ({
        loops: regionLoops(r),
        area: r.area,
        bbox: r.bbox,
        minAlong: r.minAlong,
        maxAlong: r.maxAlong
      })),
      hatch: { count: hatch.segments.length, first: hatch.segments[0] },
      svgLen: svg.length,
      htmlLen: html.length
    });
  };

  const a = run();
  const b = run();
  assert.equal(a, b, 'section/hatch/SVG output must be byte-identical between runs');
  assert.ok(a.length > 1000, 'snapshot is substantive');
});

test('DraftingSections: SVG rendering contains material, loops, and hatch strokes', () => {
  const d = DraftingSections.createEngineBlock();
  const r = d.section([0, 0, 0], [0, 0, 1]);
  r.hatch = d.hatchRegion(r, 5, 45);
  const svg = d.renderSVG(r);
  assert.ok(svg.startsWith('<?xml'), 'SVG document');
  assert.ok(svg.includes('<svg'), 'svg root');
  assert.ok(svg.includes('polygon'), 'filled material polygon');
  assert.ok(svg.includes('<line'), 'hatch lines');
  assert.ok(svg.includes('</svg>'), 'doc closes');
  const html = d.renderHTML(r);
  assert.ok(html.includes('<!DOCTYPE html>') && html.includes('<script') === false, 'standalone html');
});
