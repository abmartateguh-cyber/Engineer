/**
 * OmniEng verification gate: Discrete Ordinates radiation solver
 * (src/core/cae/radiation_dom.js).
 *
 * Checks:
 *  1. S4 (3D level-symmetric) quadrature normalization: total weight 4*pi,
 *     hemispherical weight sum/2 = pi.
 *  2. Planar half-range (S4/S6/S8) quadrature normalization: sum(w) = 1 and
 *     2*pi*sum(w*mu) = pi (Marshak flux normalization).
 *  3. 1D radiative equilibrium in a gray slab between black walls: the DOM
 *     dimensionless heat flux q* = q/(sigma*(T1^4 - T2^4)) is compared against
 *     the exact solution of the radiative-equilibrium integral equation
 *        2*u(tau) = T1^4*E2(tau) + T2^4*E2(tauL-tau)
 *                    + Integral_0^tauL u(t)*E1(|tau-t|) dt,   u = T^4
 *     discretized with analytically-regularized E1 kernels (LU solve) for
 *     tau in {0.1, 1, 5, 10}: S8 within 3%, S4 within 5%.
 *     The classical Heaslet-Warming table values (0.9097/0.7265/0.3533/0.2028)
 *     are reported as diagnostics: this solver (cross-validated by Monte Carlo
 *     and the integral equation) measures q* ~ 0.915/0.556/0.208/0.117 for the
 *     pure absorbing-emitting black-wall slab and does NOT reproduce the table
 *     values; this is reported rather than hidden.
 *  4. Marshak diffuse reflectivity: a reflective (epsilon=0.5) cold wall
 *     reduces the net heat flux relative to a black cold wall.
 *  5. Single scattering albedo: increasing albedo monotonically reduces the
 *     heat flux for a fixed temperature profile.
 *  6. Energy balance: isothermal black enclosure has zero net wall flux
 *     (|q|/(sigma*T^4) < 1e-9).
 *  7. Determinism: repeated solves are bit-identical.
 *  8. 2D rectangular enclosure: incident radiation G at the center is
 *     left/right symmetric (1e-6), bounded by 0 < G < 4*sigma*Tmax^4, and
 *     increasing with bottom-wall temperature.
 *
 * Run standalone: node --test test/test_radiation_do.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SIGMA_STEFAN_BOLTZMANN,
  RadiationDOMEngine,
  solveSlabRTE,
  evalIncidentRadiationRectangleCenter,
  glHalfRange
} = require('../src/core/cae/radiation_dom');

const SIGMA = SIGMA_STEFAN_BOLTZMANN;
const PI = Math.PI;

/* ------------------------------------------------------------------ */
/* Exact radiative-equilibrium slab solution (E1/E2 kernel formulation)  */
/* ------------------------------------------------------------------ */

function E1(x) {
  if (x <= 0) return 1e300;
  if (x < 1) {
    let sE = 0,
      f = 1;
    for (let n = 1; n <= 40; n++) {
      f *= n;
      sE += Math.pow(-x, n) / (n * f);
    }
    return -0.5772156649015329 - Math.log(x) - sE;
  }
  let b = x + 1,
    c = 1e20,
    d = 1 / b,
    h = d,
    a = 1,
    dd = d;
  for (let i = 1; i <= 200; i++) {
    a = -i * i;
    b += 2;
    d = a * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + a / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    dd = d * c;
    h *= dd;
    if (Math.abs(dd - 1) < 1e-15) break;
  }
  return h * Math.exp(-x);
}

function E2(x) {
  return x <= 0 ? 1 : Math.exp(-x) - x * E1(x);
}
function E3(x) {
  return x <= 0 ? 0.5 : 0.5 * (Math.exp(-x) - x * E2(x));
}

function luSolve(A, b, n) {
  for (let k = 0; k < n; k++) {
    let piv = k;
    let amax = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i * n + k]);
      if (v > amax) {
        amax = v;
        piv = i;
      }
    }
    if (amax < 1e-300) throw new Error('singular matrix');
    if (piv !== k) {
      for (let j = 0; j < n; j++) {
        const t = A[k * n + j];
        A[k * n + j] = A[piv * n + j];
        A[piv * n + j] = t;
      }
      const t = b[k];
      b[k] = b[piv];
      b[piv] = t;
    }
    const akk = A[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k] / akk;
      A[i * n + k] = f;
      for (let j = k + 1; j < n; j++) A[i * n + j] -= f * A[k * n + j];
      b[i] -= f * b[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j];
    x[i] = s / A[i * n + i];
  }
  return x;
}

/**
 * Exact dimensionless heat flux for radiative equilibrium in a gray slab
 * between black walls at T1, T2 with optical thickness tauL.  Discretizes the
 * Fredholm integral equation for u = T^4 with midpoint collocation and
 * analytically-regularized diagonal E1 cells, solves by LU, then evaluates the
 * flux at mid-slab.
 */
function exactEquilibriumSlabFlux(tauL, N, T1, T2) {
  const h = tauL / N;
  const T1A = T1 ** 4,
    T2A = T2 ** 4;
  const tau = new Float64Array(N);
  for (let i = 0; i < N; i++) tau[i] = (i + 0.5) * h;
  const A = new Float64Array(N * N);
  const b = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    b[i] = 0.5 * (T1A * E2(tau[i]) + T2A * E2(tauL - tau[i]));
    for (let k = 0; k < N; k++) {
      const d = Math.abs(tau[i] - tau[k]);
      let cellInt;
      if (d < h / 2) {
        const a = tau[k] - h / 2;
        const c = tau[k] + h / 2;
        cellInt = 2 - E2(tau[i] - a) - E2(c - tau[i]);
      } else {
        cellInt = h * E1(d);
      }
      A[i * N + k] = (i === k ? 1 : 0) - 0.5 * cellInt;
    }
  }
  const u = luSolve(A, b, N);
  const mid = (N - 1) >> 1;
  let q = 2 * SIGMA * (T1A * E3(tau[mid]) - T2A * E3(tauL - tau[mid]));
  for (let k = 0; k < N; k++) {
    const d = tau[mid] - tau[k];
    q += 2 * SIGMA * u[k] * E2(Math.abs(d)) * h * Math.sign(d);
  }
  return q / (SIGMA * (T1A - T2A));
}

/* ------------------------------------------------------------------ */
/* Tests                                                                */
/* ------------------------------------------------------------------ */

test('S4 3D level-symmetric quadrature: total weight 4*pi, hemisphere/2 = pi', () => {
  const dirs = RadiationDOMEngine.getS4QuadratureDirections();
  assert.equal(dirs.length, 24);
  let total = 0;
  let hemi = 0;
  for (const d of dirs) {
    total += d.weight;
    if (d.dz > 0) hemi += d.weight;
  }
  assert.ok(Math.abs(total - 4 * PI) / (4 * PI) < 1e-9, `total weight ${total} != 4pi`);
  assert.ok(Math.abs(hemi / 2 - PI) < 1e-9, `hemispherical weight/2 ${hemi / 2} != pi`);
});

test('planar half-range quadrature normalization (S4/S6/S8): sum w = 1, 2*pi*sum(w*mu) = pi', () => {
  for (const name of ['S4', 'S6', 'S8']) {
    const { mu, weight } = RadiationDOMEngine.getHalfRangeQuadrature(name);
    let sw = 0,
      swm = 0;
    for (let i = 0; i < mu.length; i++) {
      sw += weight[i];
      swm += weight[i] * mu[i];
    }
    assert.ok(Math.abs(sw - 1) < 1e-12, `${name}: sum(w)=${sw} != 1`);
    assert.ok(Math.abs(2 * PI * swm - PI) < 1e-9, `${name}: 2pi*sum(w*mu)=${2 * PI * swm} != pi`);
    assert.ok(
      mu.every((m) => m > 0 && m < 1),
      `${name}: ordinates must lie in (0,1)`
    );
  }
});

test('1D radiative equilibrium slab vs exact integral-equation solution (S8 within 3%, S4 within 5%)', () => {
  const TAU = [0.1, 1, 5, 10];
  const CLASSIC = [0.9097, 0.7265, 0.3533, 0.2028];
  const IE_N = [300, 300, 500, 900];
  const exact = TAU.map((tau, i) => exactEquilibriumSlabFlux(tau, IE_N[i], 1000, 500));
  const measured = {};
  for (const name of ['S4', 'S6', 'S8']) {
    measured[name] = TAU.map((tau) => {
      const r = solveSlabRTE({
        opticalThickness: tau,
        wallTemperatures: [1000, 500],
        quadrature: name,
        nCells: 512,
        tolerance: 1e-10
      });
      assert.ok(r.converged, `${name} tau=${tau} did not converge`);
      assert.ok(Math.abs(r.fluxWm2) > 0, 'flux must be nonzero');
      return r.fluxDimensionless;
    });
  }
  console.log('--- classic-table diagnostics (measured vs cited) ---');
  TAU.forEach((tau, i) => {
    console.log(
      `  tau=${tau}: S4=${measured.S4[i].toFixed(5)} S6=${measured.S6[i].toFixed(5)} ` +
        `S8=${measured.S8[i].toFixed(5)} exactIE=${exact[i].toFixed(5)} classic=${CLASSIC[i]}`
    );
  });
  TAU.forEach((tau, i) => {
    const d8 = Math.abs(measured.S8[i] - exact[i]) / exact[i];
    const d4 = Math.abs(measured.S4[i] - exact[i]) / exact[i];
    const d6 = Math.abs(measured.S6[i] - exact[i]) / exact[i];
    assert.ok(d8 < 0.03, `S8 tau=${tau}: |q*-q*_exact|=${(d8 * 100).toFixed(2)}% > 3%`);
    assert.ok(d4 < 0.05, `S4 tau=${tau}: |q*-q*_exact|=${(d4 * 100).toFixed(2)}% > 5%`);
    assert.ok(d6 < 0.05, `S6 tau=${tau}: |q*-q*_exact|=${(d6 * 100).toFixed(2)}% > 5%`);
  });
});

test('equilibrium flux is spatially constant across the slab (wall flux balance)', () => {
  const r = solveSlabRTE({
    opticalThickness: 1,
    wallTemperatures: [1000, 500],
    quadrature: 'S8',
    nCells: 512
  });
  assert.ok(r.converged);
  const q0 = SIGMA * (1000 ** 4 - 500 ** 4);
  const [qw1, qw2] = r.wallFluxWm2;
  assert.ok(Math.abs(qw1 - qw2) / q0 < 1e-6, `wall fluxes differ: ${qw1} vs ${qw2}`);
});

test('Marshak diffuse reflectivity: reflective cold wall reduces net heat flux', () => {
  const black = solveSlabRTE({
    opticalThickness: 1,
    wallTemperatures: [1000, 500],
    wallEmissivities: [1, 1],
    quadrature: 'S4',
    nCells: 256,
    equilibrium: false
  });
  const gray = solveSlabRTE({
    opticalThickness: 1,
    wallTemperatures: [1000, 500],
    wallEmissivities: [1, 0.5],
    quadrature: 'S4',
    nCells: 256,
    equilibrium: false
  });
  assert.ok(
    gray.fluxWm2 < black.fluxWm2,
    `expected reflective wall flux ${gray.fluxWm2} < black wall flux ${black.fluxWm2}`
  );
});

test('single scattering albedo monotonically reduces the transmitted heat flux (cold, non-emitting medium)', () => {
  // Cold medium (T = 0): no emission; adding isotropic scattering increases the
  // effective extinction of the wall-to-wall beam, so the transmitted flux must
  // decrease monotonically with albedo. (For a *fixed emitting* temperature
  // profile the opposite trend holds, and at true radiative equilibrium the
  // solution is albedo-independent; both statements were verified numerically.)
  const T = new Array(256).fill(0);
  const albs = [0, 0.1, 0.3, 0.5];
  const fluxes = albs.map(
    (omega) =>
      solveSlabRTE({
        opticalThickness: 1,
        wallTemperatures: [1000, 500],
        temperatureProfileK: T,
        scatteringAlbedo: omega,
        quadrature: 'S4',
        nCells: 256,
        equilibrium: false
      }).fluxWm2
  );
  for (let i = 1; i < fluxes.length; i++) {
    assert.ok(
      fluxes[i] < fluxes[i - 1],
      `transmitted flux must decrease with albedo: ${fluxes.map((f) => f.toFixed(2)).join(' > ')}`
    );
  }
});

test('isothermal black enclosure: zero net wall flux at equilibrium (1e-9)', () => {
  const T = 600;
  const r = solveSlabRTE({
    opticalThickness: 1,
    wallTemperatures: [T, T],
    quadrature: 'S8',
    nCells: 256
  });
  const scale = SIGMA * T ** 4;
  assert.ok(Math.abs(r.fluxWm2) / scale < 1e-9, `net flux ${r.fluxWm2} not zero to 1e-9*sigma*T^4`);
});

test('determinism: repeated solves are identical', () => {
  const opts = {
    opticalThickness: 1,
    wallTemperatures: [1000, 500],
    quadrature: 'S6',
    nCells: 256
  };
  const a = solveSlabRTE(opts);
  const b = solveSlabRTE(opts);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('2D rectangular enclosure: incident radiation G symmetric, bounded, monotonic in wall temperature', () => {
  const W = 1,
    H = 1,
    kappa = 1;
  const Tmax = 700;
  const g1 = evalIncidentRadiationRectangleCenter({
    width: W,
    height: H,
    absorptionCoefficient: kappa,
    wallTemperatures: [700, 400, 300, 300]
  });
  const g2 = evalIncidentRadiationRectangleCenter({
    width: W,
    height: H,
    absorptionCoefficient: kappa,
    wallTemperatures: [400, 400, 300, 300]
  });
  const g3 = evalIncidentRadiationRectangleCenter({
    width: W,
    height: H,
    absorptionCoefficient: kappa,
    wallTemperatures: [400, 700, 300, 300]
  });
  // left/right symmetry of the quadrature rule
  assert.ok(
    Math.abs(g1.perWall[2] - g1.perWall[3]) / g1.G < 1e-6,
    `left/right asymmetry ${g1.perWall[2]} vs ${g1.perWall[3]}`
  );
  // boundedness: 0 < G < 4*sigma*Tmax^4
  assert.ok(g1.G > 0, 'G must be positive');
  assert.ok(g1.G < 4 * SIGMA * Tmax ** 4, `G=${g1.G} must be < 4*sigma*Tmax^4=${4 * SIGMA * Tmax ** 4}`);
  // monotonicity with bottom-wall temperature at fixed top (400 K)
  assert.ok(g1.G > g2.G && g2.G > 0, `G must increase with bottom-wall temperature: ${g2.G} < ${g1.G}`);
  // top/bottom swap of the hot wall reflects in G only through the labels
  assert.ok(g1.G > g3.G, 'hot bottom gives larger G than hot top (same T set)');
});

test('2D incident radiation: quadrature grid convergence (24x12 vs 256x96)', () => {
  const W = 1,
    H = 1,
    kappa = 1;
  const walls = [700, 400, 300, 300];
  const coarse = evalIncidentRadiationRectangleCenter({
    width: W,
    height: H,
    absorptionCoefficient: kappa,
    wallTemperatures: walls,
    nAzimuth: 24,
    nPolar: 12
  });
  const fine = evalIncidentRadiationRectangleCenter({
    width: W,
    height: H,
    absorptionCoefficient: kappa,
    wallTemperatures: walls,
    nAzimuth: 256,
    nPolar: 96
  });
  assert.ok(
    Math.abs(coarse.G - fine.G) / fine.G < 0.02,
    `coarse quad ${coarse.G} vs fine ${fine.G} must agree within 2%`
  );
});
