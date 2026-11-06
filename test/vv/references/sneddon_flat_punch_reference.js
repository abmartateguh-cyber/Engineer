/**
 * Sneddon flat-punch indentation gold-slot reference.
 *
 * Analytic solution (closed form, Sneddon 1946; rigid flat punch of radius a
 * pressed a depth delta into an elastic half-space):
 *   P = 4 G a delta / (1 - nu)          (total load)
 *   p(r) = P / (2 pi a sqrt(a^2 - r^2)) (contact pressure, r < a)
 * The pressure is singular as r -> a; the center pressure is finite:
 *   p(0) = P / (2 pi a^2).
 *
 * Production path: the discrete production contact finite-element solver
 * ContactFEM3D (src/core/cae/contact_fem_3d.js, HEX8 + augmented-Lagrangian
 * node-to-node contact) solves a displacement-controlled flat-punch
 * indentation of a cylindrical elastic block (penny-shaped contact). The
 * measured contact pressures are read from the solved contact pairs and
 * compared to the closed form at the center and at the first interior ring.
 * Because linear hexahedral node-to-node contact cannot resolve the
 * square-root singular traction asymptote at the punch rim, the pointwise
 * comparison is restricted to the interior region r/a <= 0.35 (the singular
 * rim and the far field are reported in the measured table but are not part of
 * the pass criteria); the total transmitted load is additionally checked
 * against the closed form (discretization limit: finite block depth and
 * penalty contact).
 */

'use strict';

const { ContactFEM3D } = require('../../../src/core/cae/contact_fem_3d');

const E = 200e9;
const NU = 0.3;
const A_PUNCH = 1.0e-3; // punch radius (m)
const R_BLOCK = 3.0e-3; // block radius (m)
const H_BLOCK = 12.0e-3; // block depth (m)
const NR = 10; // radial rings (block)
const NPHI = 6; // circumferential divisions
const NZ = 12; // depth layers
const PUNCH_LAYERS = 2;
const DELTA = 1.0e-7; // indentation depth (m)
const PENALTY = 1.0e14;

const G = E / (2 * (1 + NU));
const P_ANALYTIC = (4 * G * A_PUNCH * DELTA) / (1 - NU);
const P0_ANALYTIC = P_ANALYTIC / (2 * Math.PI * A_PUNCH * A_PUNCH);
const P_MID_ANALYTIC = P_ANALYTIC / (2 * Math.PI * A_PUNCH * Math.sqrt(A_PUNCH * A_PUNCH - (0.3 * A_PUNCH) ** 2));

function runSneddonFlatPunch() {
  const rhoGrid = [];
  for (let i = 0; i <= NR; i++) rhoGrid.push((R_BLOCK * i) / NR);
  let iA = 0;
  while (iA + 1 <= NR && rhoGrid[iA + 1] <= A_PUNCH + 1e-12) iA++;
  const tPunch = 0.2 * A_PUNCH;

  const solver = new ContactFEM3D({
    E,
    nu: NU,
    penalty: PENALTY,
    maxAugmentedIterations: 2000,
    tolerance: 1e-6,
    gapTolerance: 1e-14,
    relaxation: 0.7
  });

  const nidBlock = (k, j, i) => (k * (NPHI + 1) + j) * (NR + 1) + i;
  for (let k = 0; k <= NZ; k++) {
    for (let j = 0; j <= NPHI; j++) {
      for (let i = 0; i <= NR; i++) {
        solver.addNode(
          rhoGrid[i] * Math.cos((2 * Math.PI * j) / NPHI),
          rhoGrid[i] * Math.sin((2 * Math.PI * j) / NPHI),
          (-H_BLOCK * k) / NZ
        );
      }
    }
  }
  for (let k = 0; k < NZ; k++) {
    for (let j = 0; j < NPHI; j++) {
      for (let i = 0; i < NR; i++) {
        solver.addHex([
          nidBlock(k, j, i),
          nidBlock(k, j, i + 1),
          nidBlock(k, j + 1, i + 1),
          nidBlock(k, j + 1, i),
          nidBlock(k + 1, j, i),
          nidBlock(k + 1, j, i + 1),
          nidBlock(k + 1, j + 1, i + 1),
          nidBlock(k + 1, j + 1, i)
        ]);
      }
    }
  }

  const nBlock = solver.nodes.length;
  for (let id = 0; id < nBlock; id++) {
    const n = solver.nodes[id];
    if (n.z <= -H_BLOCK + 1e-9) solver.fixNode(id, false, false, true);
    if (Math.abs(n.y) < 1e-9) solver.fixNode(id, false, true, false);
    if (Math.abs(n.x) < 1e-9) solver.fixNode(id, true, false, false);
  }

  const punchOffset = solver.nodes.length;
  const nidPunch = (l, j, i) => punchOffset + (l * (NPHI + 1) + j) * (iA + 1) + i;
  for (let l = 0; l <= PUNCH_LAYERS; l++) {
    for (let j = 0; j <= NPHI; j++) {
      for (let i = 0; i <= iA; i++) {
        solver.addNode(
          rhoGrid[i] * Math.cos((2 * Math.PI * j) / NPHI),
          rhoGrid[i] * Math.sin((2 * Math.PI * j) / NPHI),
          (tPunch * l) / PUNCH_LAYERS
        );
      }
    }
  }
  for (let l = 0; l < PUNCH_LAYERS; l++) {
    for (let j = 0; j < NPHI; j++) {
      for (let i = 0; i < iA; i++) {
        solver.addHex([
          nidPunch(l, j, i),
          nidPunch(l, j, i + 1),
          nidPunch(l, j + 1, i + 1),
          nidPunch(l, j + 1, i),
          nidPunch(l + 1, j, i),
          nidPunch(l + 1, j, i + 1),
          nidPunch(l + 1, j + 1, i + 1),
          nidPunch(l + 1, j + 1, i)
        ]);
      }
    }
  }

  const areas = new Map();
  for (let j = 0; j < NPHI; j++) {
    for (let i = 0; i < NR; i++) {
      const A = (0.25 * (rhoGrid[i + 1] ** 2 - rhoGrid[i] ** 2) * (2 * Math.PI)) / NPHI;
      for (const [ci, cj] of [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1]
      ]) {
        const key = `${ci}:${cj}`;
        areas.set(key, (areas.get(key) || 0) + A);
      }
    }
  }

  for (let j = 0; j <= NPHI; j++) {
    for (let i = 0; i <= iA; i++) {
      const top = nidPunch(PUNCH_LAYERS, j, i);
      solver.fixNode(top, true, true, true);
      solver.prescribeDisplacement(top, 2, -DELTA);
      const bottom = nidPunch(0, j, i);
      solver.fixNode(bottom, true, true, false);
      const m = nidBlock(0, j, i);
      const area = areas.get(`${i}:${j}`) || 0;
      solver.addContactPair({ slave: bottom, master: m, area, normalAxis: 2 });
    }
  }

  let res;
  try {
    res = solver.solve();
  } catch (err) {
    return {
      id: 'SNEDDON_FLAT_PUNCH_CONTACT',
      status: 'failed',
      passed: false,
      reason: `Contact FEM solve failed: ${err.message}`
    };
  }

  const rings = new Map();
  for (const p of solver._pairs) {
    const i = (p.slave - punchOffset) % (iA + 1);
    const rr = rhoGrid[i];
    if (!(p.pressure > 0)) continue;
    if (!rings.has(rr)) rings.set(rr, []);
    rings.get(rr).push(p.pressure);
  }
  const ringMeans = [];
  for (const [r, ps] of [...rings.entries()].sort((a, b) => a[0] - b[0])) {
    const pAvg = ps.reduce((s, p) => s + p, 0) / ps.length;
    const rOverA = r / A_PUNCH;
    const pSn = P_ANALYTIC / (2 * Math.PI * A_PUNCH * Math.sqrt(A_PUNCH * A_PUNCH - r * r));
    ringMeans.push({
      rOverA: +rOverA.toFixed(3),
      pressureMeasuredPa: +pAvg.toExponential(4),
      pressureSneddonPa: +pSn.toExponential(4),
      errorPercent: +((Math.abs(pAvg - pSn) / pSn) * 100).toFixed(2)
    });
  }

  const centerRing = ringMeans.find((r) => r.rOverA === 0);
  const midRing = ringMeans.find((r) => Math.abs(r.rOverA - 0.3) < 1e-3);
  const p0Measured = centerRing ? centerRing.pressureMeasuredPa : NaN;
  const pMidMeasured = midRing ? midRing.pressureMeasuredPa : NaN;
  const p0ErrorPercent = centerRing ? centerRing.errorPercent : NaN;
  const pMidErrorPercent = midRing ? midRing.errorPercent : NaN;
  const forceErrorPercent = (Math.abs(res.totalContactForceN - P_ANALYTIC) / P_ANALYTIC) * 100;

  const tolP0 = 1.0;
  const tolPMid = 10.0;
  const tolForce = 15.0;
  const passed =
    Number.isFinite(p0ErrorPercent) &&
    p0ErrorPercent <= tolP0 &&
    Number.isFinite(pMidErrorPercent) &&
    pMidErrorPercent <= tolPMid &&
    forceErrorPercent <= tolForce &&
    res.converged === true;

  return {
    id: 'SNEDDON_FLAT_PUNCH_CONTACT',
    name: 'Sneddon flat-punch contact: production ContactFEM3D discrete solve vs closed form p(r)=P/(2 pi a sqrt(a^2-r^2))',
    targetValue: P0_ANALYTIC,
    calculatedValue: p0Measured,
    units: 'Pa',
    errorPercent: p0ErrorPercent,
    tolerancePercent: tolP0,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : `Sneddon center/ring pressure or total-load check exceeded declared tolerance (p0 err ${p0ErrorPercent.toFixed(2)}%, p_mid err ${pMidErrorPercent.toFixed(2)}%, F err ${forceErrorPercent.toFixed(2)}%).`,
    measured: {
      centerPressurePa: p0Measured,
      centerPressureAnalyticPa: P0_ANALYTIC,
      centerPressureErrorPercent: p0ErrorPercent,
      midRadiusPressurePa: pMidMeasured,
      midRadiusPressureAnalyticPa: P_MID_ANALYTIC,
      midRadiusErrorPercent: pMidErrorPercent,
      totalContactForceN: res.totalContactForceN,
      totalForceAnalyticN: P_ANALYTIC,
      totalForceErrorPercent: forceErrorPercent,
      converged: res.converged,
      iterations: res.iterations,
      activeContactPairs: res.activeContactPairs,
      dofCount: res.dofCount,
      elementCount: res.elementCount,
      punchRadiusM: A_PUNCH,
      indentationDepthM: DELTA,
      radialPressureTable: ringMeans
    },
    expected: {
      pressureClosedForm: 'p(r) = P/(2 pi a sqrt(a^2 - r^2)), P = 4 G a delta/(1 - nu)',
      passCriteria: 'p(0) <= 1%, p(0.3a) <= 10%, total force <= 15% (interior region r/a <= 0.35)'
    },
    details: {
      reference: 'Sneddon (1946) flat-punch closed form for a rigid punch on an elastic half-space.',
      solver: 'ContactFEM3D (production; HEX8 + augmented-Lagrangian node-to-node penalty contact)',
      discretizationLimits:
        'Linear hexahedral node-to-node contact cannot resolve the square-root singular rim asymptote (p -> infinity as r -> a); pointwise comparison is restricted to r/a <= 0.35. Finite block depth (H/a = 12, R/a = 3) and penalty stiffness contribute to the documented total-load deviation.',
      note: 'Radial table entries beyond r/a = 0.35 (including the singular rim) are reported as measured deviations and are intentionally excluded from the pass criteria.'
    }
  };
}

module.exports = { runSneddonFlatPunch, P_ANALYTIC, P0_ANALYTIC };
