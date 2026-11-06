/**
 * Test Suite: AdaptiveRoughingEngine (Constant-Engagement Verification Gate)
 *
 * Verifies:
 *   1. Exact engagement angle theta_eng = arccos(1 - 2*ae/D) (+ inverse round-trip)
 *   2. Full-slot case ae/D = 1 -> theta = pi rad (NOT 2*pi)
 *   3. Constant chip-thinning feed modulation F(theta) = F_prog * sin(theta_nom)/sin(theta)
 *   4. Pocket-clearing path keeps engagement <= theta_max (engine-reported and
 *      independently recomputed from consecutive tool positions)
 *   5. No corner spikes: engagement stays bounded through pocket corners
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AdaptiveRoughingEngine } = require('../src/core/cam/adaptive_roughing_engine');
const { FiveAxisSwarf } = require('../src/core/cam/five_axis_swarf');

const D_TOOL = 10.0;

test('AdaptiveRoughingEngine: exact engagement angle formula theta = arccos(1 - 2*ae/D)', () => {
  const cam = new AdaptiveRoughingEngine({ toolDiameter: D_TOOL });

  const cases = [
    [2.5, 60.0],
    [5.0, 90.0],
    [7.5, 120.0],
    [10.0, 180.0]
  ];

  for (const [ae, expectedDeg] of cases) {
    const reference = Math.acos(1.0 - (2.0 * ae) / D_TOOL) * (180.0 / Math.PI);
    const engineDeg = cam.calculateEngagementAngle(ae);
    assert.ok(Math.abs(engineDeg - reference) < 1e-9, `theta_eng(${ae}) = ${engineDeg}, expected ${reference}`);
    assert.ok(Math.abs(engineDeg - expectedDeg) < 1e-9, `theta_eng(${ae}) = ${engineDeg}, expected ${expectedDeg}`);
  }
});

test('AdaptiveRoughingEngine: full-slot ae/D = 1 -> theta = pi rad (NOT 2pi)', () => {
  const cam = new AdaptiveRoughingEngine({ toolDiameter: D_TOOL });

  const deg = cam.calculateEngagementAngle(D_TOOL);
  const rad = deg * (Math.PI / 180.0);
  assert.ok(Math.abs(rad - Math.PI) < 1e-9, `full-slot engagement ${rad} rad must equal pi (NOT 2pi)`);
  assert.ok(Math.abs(deg - 180.0) < 1e-9, `full-slot engagement ${deg} deg must equal 180`);

  const aeBack = cam.radialDepthFromEngagementAngle(deg);
  assert.ok(Math.abs(aeBack - D_TOOL) < 1e-9, `inverse full-slot ae = ${aeBack}, expected ${D_TOOL}`);
});

test('AdaptiveRoughingEngine: inverse engagement ae = D*(1 - cos(theta))/2 round-trips', () => {
  const cam = new AdaptiveRoughingEngine({ toolDiameter: D_TOOL });

  for (const ae of [0.5, 1.0, 2.5, 5.0, 7.5, 9.9]) {
    const theta = cam.calculateEngagementAngle(ae);
    const aeBack = cam.radialDepthFromEngagementAngle(theta);
    assert.ok(Math.abs(aeBack - ae) < 1e-9, `round-trip ae=${ae} -> theta=${theta} -> ae=${aeBack}`);
  }
});

test('AdaptiveRoughingEngine: feed modulation F(theta) = F_prog * sin(theta_nom)/sin(theta)', () => {
  const cam = new AdaptiveRoughingEngine({ toolDiameter: D_TOOL, nominalFeedRate: 1000.0 });
  const thetaNom = 60.0;
  const FProg = 1000.0;

  const F = (theta) => cam.calculateFeedModulation(theta, thetaNom, FProg);

  const FAtNom = F(thetaNom);
  assert.ok(Math.abs(FAtNom - FProg) < 1e-9, `F(theta_nom) = ${FAtNom}, expected exactly ${FProg}`);

  const FAt90 = F(90.0);
  const expectedAt90 = FProg * Math.sin((thetaNom * Math.PI) / 180.0);
  assert.ok(Math.abs(FAt90 - expectedAt90) < 1e-9, `F(90) = ${FAt90}, expected ${expectedAt90}`);

  let prev = FAtNom;
  for (let theta = thetaNom + 2.0; theta <= 90.0 + 1e-9; theta += 2.0) {
    const cur = F(theta);
    assert.ok(
      cur < prev,
      `F must decrease monotonically on [theta_nom, 90], F(${theta - 2})=${prev}, F(${theta})=${cur}`
    );
    prev = cur;
  }

  for (let theta = thetaNom; theta <= 90.0 + 1e-9; theta += 5.0) {
    const expected = (FProg * Math.sin((thetaNom * Math.PI) / 180.0)) / Math.sin((theta * Math.PI) / 180.0);
    assert.ok(Math.abs(F(theta) - expected) < 1e-9, `F(${theta}) = ${F(theta)}, expected ${expected}`);
  }
});

test('AdaptiveRoughingEngine: pocket clearing holds constant engagement <= theta_max (engine-reported)', () => {
  const cam = new AdaptiveRoughingEngine({
    toolDiameter: D_TOOL,
    stepoverMm: 1.0,
    maxEngagementDeg: 40.0
  });
  const result = cam.planAdaptivePocket(50.0, 40.0, 15.0);

  assert.ok(result.passes.length > 100, 'Pocket must generate a full clearing path');
  assert.ok(result.totalPathLengthMm > 100.0, 'Path length must be substantial');

  const thetaMax = 40.0;
  let maxReported = 0.0;
  for (const p of result.passes) {
    maxReported = Math.max(maxReported, p.engagementDeg);
    assert.ok(p.engagementDeg <= thetaMax + 1e-6, `pass engagement ${p.engagementDeg} exceeds theta_max ${thetaMax}`);
  }
  assert.ok(result.maxEngagementObservedDeg <= thetaMax + 1e-6, 'engine maxEngagementObservedDeg exceeds theta_max');
  assert.ok(maxReported <= thetaMax + 1e-6, 'reported per-pass max engagement exceeds theta_max');
});

test('AdaptiveRoughingEngine: pocket clearing engagement recomputed from consecutive tool positions <= theta_max', () => {
  const cam = new AdaptiveRoughingEngine({
    toolDiameter: D_TOOL,
    stepoverMm: 1.0,
    maxEngagementDeg: 40.0
  });
  const { passes } = cam.planAdaptivePocket(50.0, 40.0, 15.0);
  const thetaMax = 40.0;

  const engagementFromSeparation = (h) => {
    const ratio = Math.max(0.0, Math.min(1.0, h / D_TOOL));
    return Math.acos(1.0 - 2.0 * ratio) * (180.0 / Math.PI);
  };

  let maxPosEng = 0.0;
  for (let i = 2; i < passes.length; i++) {
    const a = passes[i - 2];
    const b = passes[i - 1];
    const c = passes[i];
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const l1 = Math.hypot(v1x, v1y);
    if (l1 < 1e-9) continue;
    const h = Math.abs(v1x * (c.y - a.y) - v1y * (c.x - a.x)) / l1;
    const eng = engagementFromSeparation(h);
    maxPosEng = Math.max(maxPosEng, eng);
    assert.ok(eng <= thetaMax + 1e-6, `position-computed engagement ${eng} exceeds theta_max ${thetaMax} at pass ${i}`);
  }
  assert.ok(maxPosEng > 0.0, 'position-computed engagement must be positive');
});

test('AdaptiveRoughingEngine: no corner spikes - engagement stays bounded at pocket corners', () => {
  const cam = new AdaptiveRoughingEngine({
    toolDiameter: D_TOOL,
    stepoverMm: 1.0,
    maxEngagementDeg: 40.0
  });
  const { passes } = cam.planAdaptivePocket(50.0, 40.0, 15.0);
  const thetaMax = 40.0;

  const engagementFromSeparation = (h) => {
    const ratio = Math.max(0.0, Math.min(1.0, h / D_TOOL));
    return Math.acos(1.0 - 2.0 * ratio) * (180.0 / Math.PI);
  };

  let cornerCount = 0;
  let maxCornerEng = 0.0;
  let maxTurnDeg = 0.0;
  let minTurnRadiusMm = Infinity;

  for (let i = 2; i < passes.length; i++) {
    const a = passes[i - 2];
    const b = passes[i - 1];
    const c = passes[i];
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-9 || l2 < 1e-9) continue;

    const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
    const turn = Math.acos(Math.max(-1.0, Math.min(1.0, dot))) * (180.0 / Math.PI);
    maxTurnDeg = Math.max(maxTurnDeg, turn);

    if (turn > 1.0) {
      const rho = l1 / (2.0 * Math.sin(turn * (Math.PI / 360.0)));
      minTurnRadiusMm = Math.min(minTurnRadiusMm, rho);
    }

    if (turn > 45.0) {
      cornerCount++;
      const h = Math.abs(v1x * (c.y - a.y) - v1y * (c.x - a.x)) / l1;
      const eng = engagementFromSeparation(h);
      maxCornerEng = Math.max(maxCornerEng, eng);
      assert.ok(eng <= thetaMax + 1e-6, `corner engagement ${eng} exceeds theta_max ${thetaMax} at pass ${i}`);
    }
  }

  assert.ok(cornerCount > 0, 'expected sharp turns at pocket corners');
  assert.ok(maxCornerEng <= thetaMax + 1e-6, 'corner engagement exceeds theta_max');
});

test('AdaptiveRoughingEngine: scales feed rate with radial chip thinning', () => {
  const cam = new AdaptiveRoughingEngine({ toolDiameter: 10.0, nominalFeedRate: 1000.0 });

  const fHalf = cam.calculateCompensatedFeedRate(5.0);
  assert.equal(fHalf, 1000.0, 'Half immersion feed rate must equal nominal');

  const fThin = cam.calculateCompensatedFeedRate(1.0);
  assert.ok(fThin > 1000.0, 'Thin cut feed rate must be boosted for chip thinning');
  assert.ok(fThin <= 3500.0, 'Boost factor must stay within safe bounds');
});

test('FiveAxisSwarf: Generates continuous 5-axis flank toolpath along ruled surface', () => {
  const swarf = new FiveAxisSwarf({ toolRadius: 5.0 });

  const botRail = [];
  const topRail = [];
  for (let k = 0; k <= 5; k++) {
    const x = k * 20.0;
    botRail.push([x, 0.0, 0.0]);
    topRail.push([x, 0.0, 20.0]);
  }

  const path = swarf.planSwarfToolpath(botRail, topRail);
  assert.equal(path.length, 6, 'Must generate 6 toolpath stations');

  for (const st of path) {
    assert.ok(Math.abs(st.toolAxis[0] - 0.0) < 1e-6);
    assert.ok(Math.abs(st.toolAxis[1] - 0.0) < 1e-6);
    assert.ok(Math.abs(st.toolAxis[2] - 1.0) < 1e-6);
    assert.equal(st.rulingLength, 20.0, 'Ruling length must be 20 mm');
  }
});
