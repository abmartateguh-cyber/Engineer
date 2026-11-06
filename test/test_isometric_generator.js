/**
 * Verification gate for the automated 2D isometric piping spool drawing
 * generator (src/core/plant/piping_isometric_generator.js).
 *
 * Coverage:
 *  1. Projection: the unit box path (0,0,0)->(1,0,0)->(1,1,0)->(1,1,1)
 *     projects to the analytic 30/30 isometric coordinates (1e-9).
 *  2. Spool drawing: a 3-run spool (two 90 deg elbows, 2 flanges,
 *     1 gate valve, 2 field welds) emits exactly 3 LINEs, 2 elbow
 *     PATHs, 2 flange RECTs, 1 valve PATH, and 4 weld balloons at the
 *     expected projected locations.
 *  3. Dimensioning: a 5.0 m run along x labels "5000" mm and its
 *     dimension line endpoints project from the run endpoints.
 *  4. Fabrication length: straight-run true lengths sum to the input
 *     total (exact 1e-9) and the inter-weld cut-pipe length is
 *     accumulated on the centerline.
 *  5. Determinism and scale: two runs are byte-identical and every
 *     drawing coordinate lies inside the viewBox.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  PipingIsometricGenerator,
  generateIsometricSvg,
  sampleSpoolModel,
  analyzeSpool,
  COS30,
  SIN30,
  DEFAULT_OPTIONS
} = require('../src/core/plant/piping_isometric_generator');

const EPS = 1e-9;
const GEOM_EPS = 1e-6;

function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps === undefined ? EPS : eps);
}

function count(re, s) {
  return (s.match(re) || []).length;
}

function parseLabelled(svg, tag, cls) {
  const out = [];
  const re = new RegExp(`<${tag} class="${cls}"([^>]*)>`, 'g');
  let match;
  while ((match = re.exec(svg)) !== null) {
    const attrs = {};
    const attrRe = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
    let am;
    while ((am = attrRe.exec(match[1])) !== null) {
      const value = Number(am[2]);
      attrs[am[1]] = Number.isNaN(value) ? am[2] : value;
    }
    out.push(attrs);
  }
  return out;
}

describe('piping isometric generator', () => {
  it('projects the unit box path to the analytic isometric coordinates (1e-9)', () => {
    const path = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1]
    ];
    const expected = [
      [0, 0],
      [COS30, SIN30],
      [0, 1],
      [0, 2]
    ];
    let maxErr = 0;
    for (let i = 0; i < path.length; i++) {
      const p = PipingIsometricGenerator.projectXYZ(path[i][0], path[i][1], path[i][2]);
      assert.ok(approx(p.x, expected[i][0]), `x mismatch at ${i}: ${p.x} vs ${expected[i][0]}`);
      assert.ok(approx(p.y, expected[i][1]), `y mismatch at ${i}: ${p.y} vs ${expected[i][1]}`);
      maxErr = Math.max(maxErr, Math.abs(p.x - expected[i][0]), Math.abs(p.y - expected[i][1]));
    }
    assert.ok(maxErr <= EPS, `max projection error ${maxErr} > 1e-9`);
  });

  it('renders the 3-run spool with exact element counts and weld balloons at the 4 expected locations', () => {
    const model = sampleSpoolModel();
    const svg = generateIsometricSvg(model);

    assert.equal(count(/<line class="pipe-run"/g, svg), 3, '3 straight run LINEs');
    assert.equal(count(/<path class="elbow-arc"/g, svg), 2, '2 elbow PATH/ARC elements');
    assert.equal(count(/<rect class="flange"/g, svg), 2, '2 flange symbols');
    assert.equal(count(/<path class="valve"/g, svg), 1, '1 gate valve symbol');
    assert.equal(count(/<circle class="weld"/g, svg), 4, '4 weld circles');
    assert.equal(count(/<g class="weld-balloon"/g, svg), 4, '4 weld balloon groups');
    for (let i = 1; i <= 4; i++) {
      assert.ok(svg.includes(`>W${i}<`), `balloon label W${i} present`);
    }

    const circles = parseLabelled(svg, 'circle', 'weld');
    const m = DEFAULT_OPTIONS.mmPerMeter;
    const flangeStart = PipingIsometricGenerator.projectXYZ(0, 0, 0);
    const fw1 = PipingIsometricGenerator.projectXYZ(2.7 * m, 0, 0);
    const fw2 = PipingIsometricGenerator.projectXYZ(3 * m, 2 * m, 0.3 * m);
    const flangeEnd = PipingIsometricGenerator.projectXYZ(3 * m, 2 * m, 1.5 * m);
    const expected = [flangeStart, fw1, fw2, flangeEnd];
    assert.equal(circles.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.ok(approx(circles[i].cx, expected[i].x, GEOM_EPS), `weld ${i} x`);
      assert.ok(approx(circles[i].cy, expected[i].y, GEOM_EPS), `weld ${i} y`);
    }

    const runs = parseLabelled(svg, 'line', 'pipe-run');
    assert.equal(runs.length, 3);
    const expectedRunEndpoints = [
      [PipingIsometricGenerator.projectXYZ(0, 0, 0), PipingIsometricGenerator.projectXYZ(3 * m, 0, 0)],
      [PipingIsometricGenerator.projectXYZ(3 * m, 0, 0), PipingIsometricGenerator.projectXYZ(3 * m, 2 * m, 0)],
      [PipingIsometricGenerator.projectXYZ(3 * m, 2 * m, 0), PipingIsometricGenerator.projectXYZ(3 * m, 2 * m, 1.5 * m)]
    ];
    for (let i = 0; i < 3; i++) {
      assert.ok(approx(runs[i].x1, expectedRunEndpoints[i][0].x, GEOM_EPS));
      assert.ok(approx(runs[i].y1, expectedRunEndpoints[i][0].y, GEOM_EPS));
      assert.ok(approx(runs[i].x2, expectedRunEndpoints[i][1].x, GEOM_EPS));
      assert.ok(approx(runs[i].y2, expectedRunEndpoints[i][1].y, GEOM_EPS));
    }

    const elbows = parseLabelled(svg, 'path', 'elbow-arc');
    assert.equal(elbows.length, 2);
    for (const e of elbows) {
      assert.ok(e.d.startsWith('M '), 'elbow arc starts with a moveto');
      assert.ok((e.d.match(/ L /g) || []).length >= 2, 'elbow arc is sampled');
    }
  });

  it('dimensions a 5.0 m run with text 5000 mm and correctly projected dimension-line endpoints', () => {
    const model = {
      runs: [{ id: 'R1', start: [0, 0, 0], end: [5, 0, 0] }],
      elbows: [],
      flanges: [],
      valves: [],
      fieldWelds: []
    };
    const svg = generateIsometricSvg(model);
    assert.ok(svg.includes('>5000<'), 'dimension text shows 5000 mm');

    const dimLines = parseLabelled(svg, 'line', 'dimension-line');
    assert.equal(dimLines.length, 1);
    const m = DEFAULT_OPTIONS.mmPerMeter;
    const pA = PipingIsometricGenerator.projectXYZ(0, 0, 0);
    const pB = PipingIsometricGenerator.projectXYZ(5 * m, 0, 0);
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const px = -dy / len;
    const py = dx / len;
    const off = DEFAULT_OPTIONS.dimensionOffsetMm;
    const qA = { x: pA.x + px * off, y: pA.y + py * off };
    const qB = { x: pB.x + px * off, y: pB.y + py * off };
    assert.ok(approx(dimLines[0].x1, qA.x, GEOM_EPS), 'dimension endpoint A x');
    assert.ok(approx(dimLines[0].y1, qA.y, GEOM_EPS), 'dimension endpoint A y');
    assert.ok(approx(dimLines[0].x2, qB.x, GEOM_EPS), 'dimension endpoint B x');
    assert.ok(approx(dimLines[0].y2, qB.y, GEOM_EPS), 'dimension endpoint B y');
    assert.equal(count(/<line class="dimension-extension"/g, svg), 2, 'one run -> 2 extension lines');
  });

  it('sums straight-run true lengths exactly and accumulates fabrication length between field welds', () => {
    const info = analyzeSpool(sampleSpoolModel());
    assert.ok(approx(info.totalStraightLengthMm, 6500, 1e-9), '3 + 2 + 1.5 m = 6.5 m exactly');
    assert.equal(info.runLengthsMm.length, 3);
    assert.ok(approx(info.runLengthsMm[0], 3000, 1e-9));
    assert.ok(approx(info.runLengthsMm[1], 2000, 1e-9));
    assert.ok(approx(info.runLengthsMm[2], 1500, 1e-9));

    assert.equal(info.fabLengthsMm.length, 1);
    const arcMm = (Math.PI / 2) * 0.25 * 1000;
    const expectedFab = 3000 + arcMm + 2000 + arcMm + 0.2 * 1500 - 2.7 * 1000;
    assert.ok(approx(info.fabLengthsMm[0], expectedFab, 1e-6), 'inter-weld cut-pipe length accumulates through elbows');

    const svg = generateIsometricSvg(sampleSpoolModel());
    assert.ok(svg.includes(`>${Math.round(expectedFab)}<`), 'fabrication dimension text present');
    assert.equal(count(/<line class="fab-dimension-line"/g, svg), 1);
  });

  it('is fully deterministic: two runs produce byte-identical SVG', () => {
    const a = generateIsometricSvg(sampleSpoolModel());
    const b = generateIsometricSvg(sampleSpoolModel());
    assert.equal(a, b);
  });

  it('keeps all drawing coordinates inside the viewBox', () => {
    const svg = generateIsometricSvg(sampleSpoolModel());
    const vbMatch = svg.match(/viewBox="([^"]+)"/);
    assert.ok(vbMatch);
    const [minX, minY, vw, vh] = vbMatch[1].split(' ').map(Number);
    const maxX = minX + vw;
    const maxY = minY + vh;
    const inside = (x, y) => {
      assert.ok(x >= minX && x <= maxX, `x ${x} outside viewBox [${minX}, ${maxX}]`);
      assert.ok(y >= minY && y <= maxY, `y ${y} outside viewBox [${minY}, ${maxY}]`);
    };
    const pairRe = /([-+]?\d+(?:\.\d+)?),([-+]?\d+(?:\.\d+)?)/g;

    const lineRe = /<line class="[a-z-]+"([^>]*)>/g;
    let m;
    while ((m = lineRe.exec(svg)) !== null) {
      const attrs = m[1];
      const x1 = Number(attrs.match(/x1="([^"]+)"/)[1]);
      const y1 = Number(attrs.match(/y1="([^"]+)"/)[1]);
      const x2 = Number(attrs.match(/x2="([^"]+)"/)[1]);
      const y2 = Number(attrs.match(/y2="([^"]+)"/)[1]);
      inside(x1, y1);
      inside(x2, y2);
    }
    for (const c of parseLabelled(svg, 'circle', 'weld')) {
      inside(c.cx, c.cy);
    }
    const rectRe = /<rect class="flange"([^>]*)>/g;
    while ((m = rectRe.exec(svg)) !== null) {
      const t = m[1].match(/translate\(([-+]?\d+(?:\.\d+)?) ([-+]?\d+(?:\.\d+)?)\)/);
      inside(Number(t[1]), Number(t[2]));
    }
    for (const e of parseLabelled(svg, 'path', 'elbow-arc')) {
      let pm;
      while ((pm = pairRe.exec(String(e.d))) !== null) {
        inside(Number(pm[1]), Number(pm[2]));
      }
    }
  });
});
