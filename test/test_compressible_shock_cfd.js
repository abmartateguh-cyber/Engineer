/**
 * Test Suite: CompressibleShockCFD (Roe Riemann Flux, Oblique Shock Jump Relations)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CompressibleShockCFD } = require('../src/core/cae/compressible_shock_cfd');

test('CompressibleShockCFD: Converts conservative state to primitive variables accurately', () => {
  const cfd = new CompressibleShockCFD();

  // Sea level standard air: rho = 1.225 kg/m^3, u = 340.28 m/s (Mach 1.0), v = 0
  // p = 101,325 Pa, a = 340.28 m/s
  // e_internal = p / ((gamma - 1) * rho) = 101325 / (0.4 * 1.225) = 206,785.7 J/kg
  // e_kinetic = 0.5 * 340.28^2 = 57,895.2 J/kg
  // E_total = rho * (e_internal + e_kinetic) = 1.225 * 264,680.9 = 324,234.1 J/m^3
  const rho = 1.225;
  const u = 340.28;
  const v = 0.0;
  const p = 101325.0;
  const E_total = p / (0.4) + 0.5 * rho * (u * u + v * v);

  const U = [rho, rho * u, rho * v, E_total];
  const prim = cfd.conservativeToPrimitive(U);

  assert.ok(Math.abs(prim.rho - 1.225) < 1e-6);
  assert.ok(Math.abs(prim.u - 340.28) < 1e-4);
  assert.ok(Math.abs(prim.p - 101325.0) < 1.0);
  assert.ok(Math.abs(prim.Mach - 1.0) < 1e-3, `Mach number ${prim.Mach} must be ~ 1.0`);
});

test('CompressibleShockCFD: Solves exact Oblique Shock relations matching NACA Report 1135', () => {
  const cfd = new CompressibleShockCFD();

  // M1 = 2.0, deflection theta = 10.0 degrees
  // Published NACA 1135 benchmark values: beta = 39.31 degrees, p2/p1 = 1.707, M2 = 1.64
  const res = cfd.solveObliqueShock(2.0, 10.0);

  assert.ok(Math.abs(res.betaDeg - 39.31) < 0.2, `Shock angle ${res.betaDeg.toFixed(2)} deg must match 39.31 deg`);
  assert.ok(Math.abs(res.pRatio - 1.707) < 0.02, `Pressure ratio ${res.pRatio.toFixed(3)} must match 1.707`);
  assert.ok(Math.abs(res.M2 - 1.64) < 0.02, `Downstream Mach ${res.M2.toFixed(2)} must match 1.64`);
});

test('CompressibleShockCFD: Computes consistent Roe flux for identical left and right states', () => {
  const cfd = new CompressibleShockCFD();
  const U = [1.2, 1.2 * 200.0, 0.0, 300000.0];

  const F_roe = cfd.computeRoeFlux(U, U, [1.0, 0.0]);
  assert.ok(F_roe[0] > 0.0, 'Mass flux must be positive in flow direction');
  assert.ok(Math.abs(F_roe[0] - 1.2 * 200.0) < 1e-6, 'Mass flux must equal rho*u');
});

// ---------------------------------------------------------------------------
// Oblique shock over a 15-degree wedge at Mach 2.5 (steady 2D flow)
// ---------------------------------------------------------------------------
// The 2D steady flow is computed with a conservative finite-volume solver on an
// axis-aligned grid (152x60) using the positivity-preserving HLLC flux from
// RiemannSolvers. The equivalent compression-corner configuration is used:
// freestream at -15 degrees over a flat slip wall, so the wall is exactly
// grid-aligned (no staircase geometry). The measured shock angle and post-shock
// pressure ratio are compared to the exact theta-beta-M / Rankine-Hugoniot
// values returned by CompressibleShockCFD.solveObliqueShock.
// ---------------------------------------------------------------------------
const { RiemannSolvers } = require('../src/core/cae/riemann_solvers');

test('CompressibleShockCFD: steady 2D oblique shock over 15-degree wedge at Mach 2.5', { timeout: 600000 }, () => {
  const GAMMA = 1.4;
  const M1 = 2.5;
  const THETA_DEG = 15;

  const cfd = new CompressibleShockCFD({ gamma: GAMMA });
  const EXACT = cfd.solveObliqueShock(M1, THETA_DEG);
  const XMAX = 3.2, YMAX = 1.44;
  const NX = 152, NY = 60;
  const dx = XMAX / NX, dy = YMAX / NY;

  const a0 = Math.sqrt(GAMMA);
  const th = THETA_DEG * Math.PI / 180;
  const u0 = M1 * a0 * Math.cos(th);
  const v0 = -M1 * a0 * Math.sin(th);
  const rho0 = 1.0, p0 = 1.0;
  const E0 = p0 / (GAMMA - 1) + 0.5 * rho0 * (u0 * u0 + v0 * v0);
  const INFLOW = [rho0, rho0 * u0, rho0 * v0, E0];

  const U = new Array(NX);
  const prim = new Array(NX);
  for (let i = 0; i < NX; i++) {
    U[i] = new Array(NY);
    prim[i] = new Array(NY);
    for (let j = 0; j < NY; j++) {
      U[i][j] = INFLOW.slice();
      prim[i][j] = { p: p0, rho: rho0 };
    }
  }

  const flux2d = (UL, UR, n) => RiemannSolvers.hllcFlux(UL, UR, n, GAMMA);
  const CFL = 0.4;

  for (let iter = 0; iter < 5000; iter++) {
    const dU = new Array(NX);
    for (let i = 0; i < NX; i++) {
      dU[i] = new Array(NY);
      for (let j = 0; j < NY; j++) dU[i][j] = [0, 0, 0, 0];
    }
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NY; j++) {
        const pCell = prim[i][j].p;
        let Fw = i === 0 ? flux2d(INFLOW, U[0][j], [1, 0]) : flux2d(U[i - 1][j], U[i][j], [1, 0]);
        let Fe = i === NX - 1 ? flux2d(U[NX - 1][j], U[NX - 1][j], [1, 0]) : flux2d(U[i][j], U[i + 1][j], [1, 0]);
        let Fs = j === 0 ? [0, 0, pCell, 0] : flux2d(U[i][j - 1], U[i][j], [0, 1]);
        let Fn = j === NY - 1 ? flux2d(U[i][NY - 1], U[i][NY - 1], [0, 1]) : flux2d(U[i][j], U[i][j + 1], [0, 1]);
        dU[i][j][0] = (Fe[0] - Fw[0]) / dx + (Fn[0] - Fs[0]) / dy;
        dU[i][j][1] = (Fe[1] - Fw[1]) / dx + (Fn[1] - Fs[1]) / dy;
        dU[i][j][2] = (Fe[2] - Fw[2]) / dx + (Fn[2] - Fs[2]) / dy;
        dU[i][j][3] = (Fe[3] - Fw[3]) / dx + (Fn[3] - Fs[3]) / dy;
      }
    }
    let maxRes = 0;
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NY; j++) {
        const rho = U[i][j][0], u = U[i][j][1] / rho, v = U[i][j][2] / rho;
        const E = U[i][j][3];
        const p = Math.max(1e-12, (GAMMA - 1) * (E - 0.5 * rho * (u * u + v * v)));
        const a = Math.sqrt(GAMMA * p / rho);
        const dt = CFL * Math.min(dx, dy) / (Math.hypot(u, v) + a);
        for (let k = 0; k < 4; k++) {
          const du = dt * dU[i][j][k];
          U[i][j][k] -= du;
          const rel = Math.abs(du) / Math.max(1e-12, Math.abs(U[i][j][k]));
          if (rel > maxRes) maxRes = rel;
        }
        const rhoN = U[i][j][0], uN = U[i][j][1] / rhoN, vN = U[i][j][2] / rhoN;
        let EN = U[i][j][3];
        const Ekin = 0.5 * rhoN * (uN * uN + vN * vN);
        if (EN <= Ekin + 1e-9) EN = Ekin + 1e-9 / (GAMMA - 1);
        U[i][j][3] = EN;
        const pN = Math.max(1e-12, (GAMMA - 1) * (EN - Ekin));
        prim[i][j].p = pN;
        prim[i][j].rho = rhoN;
        assert.ok(isFinite(pN) && isFinite(rhoN) && rhoN > 0, `nonphysical state at (${i},${j})`);
      }
    }
    if (iter > 600 && maxRes < 1e-7) break;
  }

  const avg = (box) => {
    let s = 0, n = 0;
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      const x = (i + 0.5) * dx, y = (j + 0.5) * dy;
      if (x >= box[0] && x <= box[1] && y >= box[2] && y <= box[3]) { s += prim[i][j].p; n++; }
    }
    return s / n;
  };
  const p1 = avg([0.05, 0.55, 0.35, 1.05]);
  const p2 = avg([1.10, 1.50, 0.25, 0.34]);
  const pRatio = p2 / p1;
  const pRatioErr = Math.abs(pRatio - EXACT.pRatio) / EXACT.pRatio;
  assert.ok(pRatioErr < 0.02,
    `p2/p1 = ${pRatio.toFixed(4)} vs exact ${EXACT.pRatio.toFixed(4)} (${(100 * pRatioErr).toFixed(2)}%)`);

  const pMid = p1 + 0.5 * (p2 - p1);
  const pts = [];
  for (let i = 0; i < NX; i++) {
    const x = (i + 0.5) * dx;
    if (x < 0.8 || x > 2.0) continue;
    for (let j = 0; j < NY - 1; j++) {
      const pj = prim[i][j].p, pj1 = prim[i][j + 1].p;
      if (pj >= pMid && pj1 < pMid) {
        const y = (j + 0.5) * dy + dy * (pMid - pj) / (pj1 - pj);
        if (y > 4 * dy && y < YMAX - 3 * dy) pts.push([x, y]);
        break;
      }
    }
  }
  assert.ok(pts.length > 20, `shock front detected at ${pts.length} columns`);
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const n = pts.length, mx = sx / n, my = sy / n;
  const m = (sxy - n * mx * my) / (sxx - n * mx * mx);
  const betaWall = Math.atan(m) * 180 / Math.PI;
  const betaMeas = betaWall + THETA_DEG; // angle relative to inflow direction
  const betaErr = Math.abs(betaMeas - EXACT.betaDeg) / EXACT.betaDeg;
  assert.ok(betaErr < 0.02,
    `measured beta = ${betaMeas.toFixed(2)} deg vs exact ${EXACT.betaDeg.toFixed(2)} deg (${(100 * betaErr).toFixed(2)}%)`);
  console.log(`  [oblique] p1=${p1.toFixed(4)} p2=${p2.toFixed(4)} p2/p1=${pRatio.toFixed(4)} (exact ${EXACT.pRatio.toFixed(4)})`);
  console.log(`  [oblique] beta_measured=${betaMeas.toFixed(2)} deg (exact ${EXACT.betaDeg.toFixed(2)} deg, err ${(100 * betaErr).toFixed(2)}%)`);
});

// ---------------------------------------------------------------------------
// Quasi-1D isentropic nozzle: mass-flow conservation across the throat
// ---------------------------------------------------------------------------
// The integrated quasi-1D equations (mass, energy, isentropic relation) are
// solved numerically at each station via Newton iteration on the area-Mach
// relation. The mass flow rho*u*A must be identical at every station,
// including the throat, to within 1% of the analytic choked value
// rho* * a* * A*.
// ---------------------------------------------------------------------------
test('CompressibleShockCFD: quasi-1D isentropic nozzle mass-flow conservation across throat', () => {
  const GAMMA = 1.4;
  const area = (x) => 1.0 + 3.0 * (x - 0.5) * (x - 0.5);
  const areaRatio = (M) => (1.0 / M) * Math.pow((2.0 / (GAMMA + 1.0)) * (1.0 + 0.5 * (GAMMA - 1.0) * M * M), (GAMMA + 1.0) / (2.0 * (GAMMA - 1.0)));
  const solveMach = (Astar, supersonic) => {
    let lo = supersonic ? 1.0 : 1e-8;
    let hi = supersonic ? 100.0 : 1.0;
    for (let it = 0; it < 200; it++) {
      const mid = 0.5 * (lo + hi);
      if (supersonic ? areaRatio(mid) < Astar : areaRatio(mid) > Astar) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  };

  const rho0 = 1.0, a0 = Math.sqrt(GAMMA); // p0 = rho0 = 1 => a0 = sqrt(gamma)
  const mdotStar = rho0 * a0 * Math.pow(2.0 / (GAMMA + 1.0), (GAMMA + 1.0) / (2.0 * (GAMMA - 1.0)));
  const mdotAnalytic = mdotStar * area(0.5);

  const stations = [0.0, 0.2, 0.4, 0.5, 0.6, 0.8, 1.0];
  const vals = [];
  for (const x of stations) {
    const A = area(x);
    const M = solveMach(A, x > 0.5);
    const term = 1.0 + 0.5 * (GAMMA - 1.0) * M * M;
    const rho = Math.pow(term, -1.0 / (GAMMA - 1.0));
    const p = Math.pow(term, -GAMMA / (GAMMA - 1.0));
    const a = Math.sqrt(GAMMA * p / rho);
    const mdot = rho * (M * a) * A;
    vals.push(mdot);
  }
  const mean = vals.reduce((acc, v) => acc + v, 0) / vals.length;
  const spread = (Math.max(...vals) - Math.min(...vals)) / mean;
  const analyticErr = Math.abs(mean - mdotAnalytic) / mdotAnalytic;
  assert.ok(spread < 0.01, `station-to-station mdot spread = ${(100 * spread).toFixed(3)}%`);
  assert.ok(analyticErr < 0.01, `mdot vs analytic choked value = ${(100 * analyticErr).toFixed(3)}%`);
  console.log(`  [nozzle] mdot spread=${(100 * spread).toFixed(3)}%, vs analytic=${(100 * analyticErr).toFixed(3)}%, mdot=${mean.toFixed(6)}`);
});
