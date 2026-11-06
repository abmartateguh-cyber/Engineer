/**
 * Thick-walled cylinder under internal pressure (Lamé problem), plane strain.
 *
 * A quarter annular wedge (HEX20 elements) is loaded by internal pressure on
 * the bore; symmetry planes and both end planes are restrained so the model
 * reproduces the closed-form Lamé plane-strain state. Radial displacement at
 * the bore, radial stress, and hoop stress are compared with the closed form
 * at the element natural-center sample points (the locations at which the
 * production element recovers stress). Discretization error on the curved
 * mesh is expected and covered by the declared tolerances.
 */

'use strict';

const { FEASolver } = require('../../../src/core/cae/fea_structural');
const { buildAnnularWedgeHex20, applyTractionToFaces, populateSolver } = require('../references/fem_helpers');

const E = 200e9;
const NU = 0.3;
const A_INNER = 1.0;
const A_OUTER = 2.0;
const LENGTH = 0.6;
const PRESSURE = 1e6;

function naturalCenter(nodes) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < 20; i++) {
    const w = i < 8 ? -0.25 : 0.25;
    x += w * nodes[i].x;
    y += w * nodes[i].y;
    z += w * nodes[i].z;
  }
  return { x, y, z };
}

function runLameCylinder() {
  const a = A_INNER;
  const b = A_OUTER;
  const L = LENGTH;
  const P = PRESSURE;
  const mesh = buildAnnularWedgeHex20({
    a,
    b,
    theta0: 0,
    theta1: Math.PI / 2,
    nr: 5,
    nt: 10,
    nz: 3,
    z0: 0,
    z1: L,
    ratio: 1.15
  });
  const solver = new FEASolver();
  populateSolver(solver, mesh, { E, nu: NU, yieldStress: 1e9 });

  applyTractionToFaces(
    solver,
    (x, y, z) => Math.abs(Math.hypot(x, y) - a) < 1e-6,
    (p, n) => {
      const r = Math.hypot(p.x, p.y);
      const er = [p.x / r, p.y / r, 0];
      const sign = n[0] * er[0] + n[1] * er[1] >= 0 ? 1 : -1;
      return [P * sign * er[0], P * sign * er[1], 0];
    }
  );

  for (let i = 0; i < solver.nodes.length; i++) {
    const n = solver.nodes[i];
    if (Math.abs(n.y) < 1e-12) solver.fixNode(i, false, true, false);
    if (Math.abs(n.x) < 1e-12) solver.fixNode(i, true, false, false);
    if (Math.abs(n.z) < 1e-12 || Math.abs(n.z - L) < 1e-12) solver.fixNode(i, false, false, true);
  }

  solver.solveStatic();

  const A = (P * a * a) / (b * b - a * a);
  const B = (P * a * a * b * b) / (b * b - a * a);
  const uAt = (r) => ((1 + NU) / E) * ((1 - 2 * NU) * A * r + B / r);
  const sigThetaAt = (r) => A + B / (r * r);
  const sigRAt = (r) => A - B / (r * r);

  let uMax = 0;
  let uSum = 0;
  let uCnt = 0;
  for (const n of solver.nodes) {
    const r = Math.hypot(n.x, n.y);
    if (Math.abs(r - a) < 1e-9 && Math.abs(n.z - L / 2) < 1e-9) {
      const theta = Math.atan2(n.y, n.x);
      if (theta < 0.15 || theta > Math.PI / 2 - 0.15) continue;
      const ur = n.displacement[0] * (n.x / r) + n.displacement[1] * (n.y / r);
      const rel = Math.abs(ur - uAt(r)) / Math.abs(uAt(r));
      uMax = Math.max(uMax, rel);
      uSum += rel;
      uCnt++;
    }
  }

  let thMax = 0;
  let thSum = 0;
  let thCnt = 0;
  let rMax = 0;
  let rSum = 0;
  let rCnt = 0;
  for (const el of solver.elements) {
    const hasBore = el.nodeIds.some((id) => Math.abs(Math.hypot(solver.nodes[id].x, solver.nodes[id].y) - a) < 1e-9);
    if (!hasBore) continue;
    const xs = el.nodeIds.map((id) => solver.nodes[id]);
    const c = naturalCenter(xs);
    if (Math.abs(c.z - L / 2) > L / 3) continue;
    const theta = Math.atan2(c.y, c.x);
    if (theta < 0.15 || theta > Math.PI / 2 - 0.15) continue;
    const rc = Math.hypot(c.x, c.y);
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    const s = el.stress;
    const sTheta = s.sxx * st * st + s.syy * ct * ct - 2 * s.sxy * st * ct;
    const sR = s.sxx * ct * ct + s.syy * st * st + 2 * s.sxy * st * ct;
    const relTh = Math.abs(sTheta - sigThetaAt(rc)) / Math.abs(sigThetaAt(rc));
    const relR = Math.abs(sR - sigRAt(rc)) / Math.abs(sigRAt(rc));
    thMax = Math.max(thMax, relTh);
    thSum += relTh;
    thCnt++;
    rMax = Math.max(rMax, relR);
    rSum += relR;
    rCnt++;
  }

  const checks = [
    { name: 'radial displacement u_r(a)', value: uMax, tolerance: 0.05, count: uCnt },
    { name: 'radial stress sigma_r (bore layer)', value: rMax, tolerance: 0.05, count: rCnt },
    { name: 'hoop stress sigma_theta (bore layer)', value: thMax, tolerance: 0.1, count: thCnt }
  ];
  const passed = checks.every((c) => Number.isFinite(c.value) && c.value <= c.tolerance);
  const maxError = Math.max(...checks.map((c) => c.value));
  const maxTolerance = Math.max(...checks.map((c) => c.tolerance));
  const meanHoop = thSum / Math.max(1, thCnt);
  const meanRadial = rSum / Math.max(1, rCnt);
  const meanU = uSum / Math.max(1, uCnt);

  return {
    id: 'LAME_CYLINDER_INTERNAL_PRESSURE',
    name: 'Thick-walled cylinder, internal pressure: Lamé plane-strain closed form vs production HEX20 FEA',
    targetValue: maxTolerance,
    calculatedValue: maxError,
    units: 'worst-case relative deviation',
    errorPercent: maxError * 100,
    tolerancePercent: maxTolerance * 100,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed ? undefined : 'Lamé closed-form comparison exceeds declared tolerances.',
    measured: {
      uRAtInnerBore: { maxRelativeError: uMax, meanRelativeError: meanU, sampleNodes: uCnt },
      radialStressBoreLayer: { maxRelativeError: rMax, meanRelativeError: meanRadial, sampleElements: rCnt },
      hoopStressBoreLayer: { maxRelativeError: thMax, meanRelativeError: meanHoop, sampleElements: thCnt },
      solverUsed: solver.results.solverUsed,
      dofCount: solver.nodes.length * 3,
      elementCount: solver.elements.length
    },
    expected: {
      uRAtInnerBoreM: uAt(a),
      hoopStressAtInnerBorePa: sigThetaAt(a),
      radialStressAtInnerBorePa: sigRAt(a)
    },
    details: {
      reference: 'Lamé closed-form plane-strain solution for internal pressure (independent analytic).',
      solver:
        'FEASolver HEX20 (production); pressure traction integrated by Gauss quadrature over bore faces; symmetry and end planes restrained (plane strain).',
      geometry: { innerRadiusM: a, outerRadiusM: b, lengthM: L, pressurePa: P, youngsModulusPa: E, poissonRatio: NU },
      mesh: { nr: 5, nt: 10, nz: 3, radialSpacingRatio: 1.15 },
      note: 'Comparisons are made at element natural-center sample points; curved-mesh discretization error is included in the declared tolerances. Not certification.'
    }
  };
}

module.exports = { runLameCylinder };
