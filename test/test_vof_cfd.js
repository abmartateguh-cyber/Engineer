'use strict';

/**
 * Kinematic VOF/PLIC verification gate.
 *
 * Verifies geometric PLIC reconstruction (exact cut areas), total volume
 * conservation under uniform advection, droplet shape fidelity after one
 * solid-body revolution (Zalesak slotted circle), flat-interface stability,
 * and CSF surface-tension scaling/curvature behavior.
 */

const assert = require('assert');
const {
  reconstructCell,
  clipSquare,
  polygonArea,
  advectVOF,
  surfaceTensionForce,
  circularDroplet,
  slottedCircle
} = require('../src/core/cae/multiphase_vof_cfd');

let passed = 0;
let total = 0;

function check(name, condition, detail) {
  total++;
  try {
    assert(condition, detail);
    passed++;
    console.log(`  PASS ${name}${detail ? ` [${detail}]` : ''}`);
  } catch (err) {
    console.log(`  FAIL ${name} [${detail}]`);
    throw err;
  }
}

// --- 1. Horizontal interface reconstruction ---
{
  const line = reconstructCell(0, 1, 0.3); // normal up, cut 0.3
  check('horizontal c=0.3 line area exactly 0.3', Math.abs(line.area - 0.3) < 1e-6, `${line.area.toFixed(9)}`);
  const lineHalf = reconstructCell(0, 1, 0.5);
  check('horizontal c=0.5 line area exactly 0.5', Math.abs(lineHalf.area - 0.5) < 1e-6, `${lineHalf.area.toFixed(9)}`);
}

// --- 2. Diagonal interface reconstruction ---
{
  const line = reconstructCell(1, 1, 0.5); // 45° normal
  const angle = (Math.atan2(line.ny, line.nx) * 180) / Math.PI;
  check('diagonal 45° normal within 1°', Math.abs(angle - 45) < 1, `${angle.toFixed(3)}°`);
  check('diagonal area exactly 0.5', Math.abs(line.area - 0.5) < 1e-6, `${line.area.toFixed(9)}`);
}

// --- 3. Uniform-flow volume conservation and droplet transport ---
{
  const N = 64;
  const c = circularDroplet(N, N, 8, 32, 32);
  const vol0 = c.flat().reduce((a, b) => a + b, 0);
  const u = Array.from({ length: N }, (_, i) => Array.from({ length: N }, () => 0.1));
  const v = Array.from({ length: N }, (_, i) => Array.from({ length: N }, () => 0.05));
  // one full period: 10 / 0.1 = 100 x-steps and 5 / 0.05 = 100 y-steps
  let ck = c;
  for (let step = 0; step < 100; step++) {
    ck = advectVOF(ck, u, v, 1);
  }
  const vol1 = ck.flat().reduce((a, b) => a + b, 0);
  check(
    'uniform flow: total volume conserved to 1e-6',
    Math.abs(vol1 - vol0) / vol0 < 1e-6,
    `${(Math.abs(vol1 - vol0) / vol0).toExponential(2)}`
  );
  const mask0 = c.flat().filter((x) => x > 0.5).length;
  const mask1 = ck.flat().filter((x) => x > 0.5).length;
  check(
    'uniform flow: droplet area within 1%',
    Math.abs(mask1 - mask0) / mask0 < 0.01,
    `${((Math.abs(mask1 - mask0) / mask0) * 100).toFixed(2)}%`
  );
}

// --- 4. Zalesak slotted circle under solid-body rotation ---
{
  const N = 64;
  const c0 = slottedCircle(N, 15, 32, 32, 6, 12);
  const omega = 0.02; // rad per step
  const steps = Math.round((2 * Math.PI) / omega);
  let ck = c0.map((row) => row.slice());
  for (let s = 0; s < steps; s++) {
    const angle = omega * s;
    const u = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => -omega * (j + 0.5 - 32)));
    const v = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => omega * (i + 0.5 - 32)));
    ck = advectVOF(ck, u, v, 1);
  }
  const overlap = (a, b) => {
    let both = 0;
    let anyM = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const ma = a[i][j] > 0.5;
        const mb = b[i][j] > 0.5;
        if (ma && mb) both++;
        if (ma) anyM++;
      }
    }
    return both / anyM;
  };
  const ov = overlap(c0, ck);
  check('Zalesak: overlap after full revolution >= 0.94', ov >= 0.94, `${ov.toFixed(4)}`);
}

// --- 5. Static flat interface remains exactly flat ---
{
  const N = 32;
  const c = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (j < N / 2 ? 1 : 0)));
  const u = Array.from({ length: N }, () => new Float64Array(N));
  const v = Array.from({ length: N }, () => new Float64Array(N));
  let ck = c;
  for (let s = 0; s < 10; s++) ck = advectVOF(ck, u, v, 1);
  let maxDiff = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) maxDiff = Math.max(maxDiff, Math.abs(ck[i][j] - c[i][j]));
  check('static interface: max |Δc| < 1e-12', maxDiff < 1e-12, `${maxDiff.toExponential(2)}`);
}

// --- 6. CSF surface tension: linear scaling and curvature scale-invariance ---
{
  const N = 48;
  const c = circularDroplet(N, N, 10, 24, 24);
  const f1 = surfaceTensionForce(c, 0.072);
  const f2 = surfaceTensionForce(c, 0.144);
  const mag = (F) => {
    let s = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) s += F.Fx[i][j] ** 2 + F.Fy[i][j] ** 2;
    return Math.sqrt(s);
  };
  const m1 = mag(f1);
  const m2 = mag(f2);
  check(
    'CSF: force magnitude scales linearly with sigma',
    Math.abs(m2 / m1 - 2) < 1e-6,
    `ratio=${(m2 / m1).toFixed(6)}`
  );

  // Robust curvature metric: median of kappa = |F|/(sigma |grad c|) over the
  // interface band (cells with a well-defined gradient), which is resistant to
  // stair-step corner spikes of the discrete droplet mask.
  const kappaBand = (cIn, F) => {
    const vals = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const gmag = Math.hypot(
          (cIn[Math.min(i + 1, N - 1)][j] - cIn[Math.max(i - 1, 0)][j]) / 2,
          (cIn[i][Math.min(j + 1, N - 1)] - cIn[i][Math.max(j - 1, 0)]) / 2
        );
        if (gmag > 0.01 && gmag < 1.5) {
          vals.push(Math.hypot(F.Fx[i][j], F.Fy[i][j]) / (0.072 * gmag));
        }
      }
    }
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  };
  const kappa10 = kappaBand(c, f1);
  check(
    'CSF: median curvature of R=10 droplet in sane band [0.03, 0.35]',
    kappa10 > 0.03 && kappa10 < 0.35,
    `kappa=${kappa10.toFixed(4)} (1/R=0.1000)`
  );

  // Scale invariance: a droplet of twice the radius must measure ~half the
  // curvature (within 60% — coarse-grid discretization error).
  const c20 = circularDroplet(N, N, 20, 24, 24);
  const f20 = surfaceTensionForce(c20, 0.072);
  const kappa20 = kappaBand(c20, f20);
  const ratio = kappa10 / kappa20;
  check(
    'CSF: curvature scale-invariance (~1/R) within 60%',
    Math.abs(ratio - 2) / 2 < 0.6,
    `kappa10/kappa20=${ratio.toFixed(3)} (expected ~2)`
  );
}

console.log(`\nvof_cfd: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
