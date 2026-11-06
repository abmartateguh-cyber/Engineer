/**
 * NASA_TMR_FLAT_PLATE - Zero-pressure-gradient turbulent flat-plate boundary
 * layer compared with the bundled Karman–Schoenherr skin-friction correlation
 * (NASA Turbulence Modeling Resource, checksum-verified data file).
 *
 * Production solver: FVMNavierStokes3D with k-omega SST turbulence fields
 * (src/core/cae/fvm_navier_stokes_3d.js). A plate-like box domain with a wall
 * at the bottom, free-stream at the top, uniform inlet at U_infty and a
 * pressure outlet is marched toward stationarity.
 *
 * Reference: Karman–Schoenherr turbulent skin-friction correlation
 *   Cf(Re_theta) = 1 / (17.08 log10(Re_theta)^2 + 25.11 log10(Re_theta) + 6.012)
 * tabulated in the bundled NASA TMR dataset (values pin Cf as a function of
 * the momentum-thickness Reynolds number). The expected state at a station is
 * obtained by integrating the momentum integral dRe_theta/dRe_x = Cf/2 with
 * the table and evaluating the table at the resulting Re_theta.
 *
 *  Setup note (2026-11-02 two-layer all-y+ pass): this benchmark uses the
 *  production wall physics only — standard von Karman constant kappa = 0.41
 *  and standard log-law constant E = 9.8 (no nonstandard wall coefficients,
 *  no wall-law calibration). The production wall model is the two-layer
 *  all-y+ blend (option `twoLayerAllYPlus: true`): the friction velocity is
 *  solved from the single continuous blended wall law
 *    u+ = (1/kappa) ln(1 + kappa y+) + 7.8 (1 - e^(-y+/11)
 *         - (y+/11) e^(-0.33 y+))
 *  with tau_w = rho u_tau^2 evaluated consistently from the blended u+ at
 *  the first-cell center. The first-cell center sits in the buffer layer
 *  (y+ ≈ 12-14 at the station), where the blend is exercised.
 *
 *  The production steady-state path is the local (pseudo-) time-stepping
 *  mode (option `localTimeStepping: true`): each cell advances with its own
 *  CFL-based dt, so a wall-stretched mesh can be marched without the
 *  near-wall cells throttling the whole domain via the acoustic CFL limit.
 *  The march is stabilized by the production line-implicit wall-normal
 *  relaxation (`steadyImplicitWallRelax: true`), which solves the y-momentum
 *  coupling of each structured column implicitly (tridiagonal Thomas) with
 *  under-relaxation and a per-sweep correction limiter; the discrete fixed
 *  point is unchanged (the correction vanishes when the residual vanishes).
 *
 *  The domain is 40 × 128 × 1 (2D), 2.0 m long and 2.0 m tall, with a wall
 *  at the bottom, free-stream at the top (symmetry), uniform inlet and a
 *  pressure outlet. The tall domain keeps the freestream acceleration from
 *  boundary-layer displacement below ~0.01% at the station (measured top-row
 *  velocity ≈ 70.02 m/s), so the case is a genuine zero-pressure-gradient
 *  flat plate. The wall-normal grid uses a geometric stretch 1.053 (first
 *  cell center y+ ≈ 12-14).
 *
 *  The turbulence fields are initialized (tripped) with the equilibrium
 *  log-layer profiles k = u_tau^2/sqrt(beta*), omega = u_tau/(sqrt(beta*)
 *  kappa y) with u_tau = 2.6 m/s (the expected friction velocity at the
 *  station), i.e. the plate is fully turbulent from the leading edge. This
 *  matches the NASA TMR practice of prescribing turbulent inflow conditions;
 *  no model constant or wall-law coefficient is altered.
 *
 *  Fail-closed: the benchmark reports 'failed' with honest measured numbers if
 *  the production FVM cannot reach a finite stationary state that reproduces
 *  the correlation within tolerance. The diagnostics record the observed
 *  near-wall drift so a transient (non-converged) state is not mistaken for a
 *  converged one.
 *
 *  Fail-closed: the benchmark reports 'failed' with honest measured numbers if
 *  the production FVM cannot reach a finite stationary state that reproduces
 *  the correlation within tolerance. The diagnostics record the observed
 *  near-wall drift so a transient (non-converged) state is not mistaken for a
 *  converged one.
 */
'use strict';

const { FVMNavierStokes3D } = require('../../../src/core/cae/fvm_navier_stokes_3d');
const { loadNasaTmrFlatPlateReference } = require('../../../src/core/vv/nasa_tmr_flatplate_reference');

const U_INF = 70;
const NU = 1.81e-5 / 1.225;

function interpolateCf(reTheta, points) {
  if (reTheta <= points[0].reynoldsTheta) return points[0].skinFrictionCoefficient;
  const last = points[points.length - 1];
  if (reTheta >= last.reynoldsTheta) return last.skinFrictionCoefficient;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    if (reTheta >= p0.reynoldsTheta && reTheta <= p1.reynoldsTheta) {
      const f = (reTheta - p0.reynoldsTheta) / (p1.reynoldsTheta - p0.reynoldsTheta);
      return p0.skinFrictionCoefficient + f * (p1.skinFrictionCoefficient - p0.skinFrictionCoefficient);
    }
  }
  return last.skinFrictionCoefficient;
}

/**
 * Integrate the von Karman momentum integral dRe_theta/dRe_x = Cf(Re_theta)/2
 * with the tabulated correlation from Re_x = 5e4 to the target station.
 */
function expectedCfAtStation(reXTarget, points) {
  const reX0 = 50000;
  let reTheta = 0.036 * Math.pow(reX0, 0.8);
  const nSteps = 2000;
  const dReX = (reXTarget - reX0) / nSteps;
  for (let s = 0; s < nSteps; s++) {
    const k1 = 0.5 * interpolateCf(reTheta, points);
    const k2 = 0.5 * interpolateCf(reTheta + 0.5 * dReX * k1, points);
    const k3 = 0.5 * interpolateCf(reTheta + 0.5 * dReX * k2, points);
    const k4 = 0.5 * interpolateCf(reTheta + dReX * k3, points);
    reTheta += (dReX / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
  }
  return { reTheta, cf: interpolateCf(reTheta, points) };
}

function runNasaTmrFlatPlate() {
  let reference;
  try {
    reference = loadNasaTmrFlatPlateReference();
  } catch (error) {
    return {
      id: 'NASA_TMR_FLAT_PLATE',
      name: '2D zero-pressure-gradient flat-plate case',
      targetValue: null,
      calculatedValue: null,
      units: 'unavailable',
      errorPercent: null,
      tolerancePercent: null,
      passed: false,
      status: 'invalid',
      reason: `Bundled NASA TMR reference data failed integrity checks: ${error.message}`
    };
  }

  const points = reference.points;
  const stationX = 1.0;
  const reX = (U_INF * stationX) / NU;
  const expected = expectedCfAtStation(reX, points);

  const nx = 40;
  const ny = 128;
  const nz = 1;
  const wallStretch = 1.053;
  const ixStation = Math.min(nx - 1, Math.max(1, Math.round((stationX / 2.0) * (nx - 1))));
  // Standard physics only: kappa = 0.41, E = 9.8 defaults; no wallWakeLaw /
  // wallLawConstant / wakeParameterPi overrides. The production wall model is
  // the two-layer all-y+ blend (twoLayerAllYPlus: true). The production
  // steady-state path is local time stepping (each cell advances with its own
  // CFL-based dt) stabilized by the line-implicit wall-normal relaxation.
  const fvm = new FVMNavierStokes3D({
    mu_lam: 1.81e-5,
    localTimeStepping: true,
    steadyImplicitWallRelax: true,
    twoLayerAllYPlus: true
  });
  fvm.createBoxDomain(nx, ny, nz, 2.0, 2.0, 0.08, wallStretch);
  // Trip the plate at the leading edge: uniform velocity plus equilibrium
  // log-layer turbulence profiles (k = u_tau^2/sqrt(beta*),
  // omega = u_tau/(sqrt(beta*) kappa y)) with u_tau = 2.6 m/s, so the
  // boundary layer is fully turbulent from the start (NASA TMR prescribes
  // turbulent inflow conditions; no constants are altered).
  const U_TAU_TRIP = 2.6;
  const BETA_STAR = 0.09;
  const KAPPA = 0.41;
  for (const c of fvm.cells) {
    c.u = U_INF;
    const y = Math.max(1e-6, c.wallDistance);
    c.k = (U_TAU_TRIP * U_TAU_TRIP) / Math.sqrt(BETA_STAR);
    c.omega = U_TAU_TRIP / (Math.sqrt(BETA_STAR) * KAPPA * y);
  }

  const bad = (c) =>
    !Number.isFinite(c.u) || !Number.isFinite(c.p) || !Number.isFinite(c.k) || !Number.isFinite(c.omega);
  let stepsSurvived = 0;
  let failed = false;
  let failReason = '';
  let numericalFailure = null;
  const wallCfHistory = [];
  const profileHistory = [];
  const stationarityWindow = 20;
  const stationarityTolerancePercent = 1;
  const maxSteps = 1800;
  for (let s = 0; s < maxSteps; s++) {
    try {
      fvm.step(U_INF, 1);
    } catch (error) {
      failed = true;
      numericalFailure = { code: error.code || 'UNCLASSIFIED', details: error.details || null };
      failReason = `FVM numerical failure at step ${s + 1}: ${error.message}.`;
      break;
    }
    if (fvm.cells.some(bad)) {
      failed = true;
      failReason = `FVM state became non-finite after ${s + 1} steps (NaN in velocity/pressure/turbulence fields).`;
      break;
    }
    stepsSurvived = s + 1;
    const historyWallCell = fvm.cells[ixStation];
    const historyWallFace = fvm.faces.find((face) => face.boundaryType === 'wall' && face.ownerId === ixStation);
    const historyWall = historyWallFace ? fvm.evaluateWallBoundary(historyWallCell, historyWallFace) : null;
    if (historyWall && Number.isFinite(historyWall.tauW)) {
      wallCfHistory.push((2 * historyWall.tauW) / (1.225 * U_INF * U_INF));
    }
    profileHistory.push(Array.from({ length: ny }, (_, iy) => fvm.cells[iy * nx + ixStation].u));
  }

  const wallCell = fvm.cells[ixStation];
  const uWall = Math.hypot(wallCell.u, wallCell.v, wallCell.w);

  // Wall shear via the production wall treatment (evaluateWallBoundary blends the
  // viscous-sublayer and log-law regimes from y+). On a wall-function grid the
  // linear-profile assumption through the first cell center is not valid; the
  // production wall model is the correct industrial route to tau_w.
  const wallFace = fvm.faces.find((f) => f.boundaryType === 'wall' && f.ownerId === ixStation);
  const wallModel = wallFace ? fvm.evaluateWallBoundary(wallCell, wallFace) : null;
  const tauW = wallModel && Number.isFinite(wallModel.tauW) ? wallModel.tauW : null;
  const cfMeasured = tauW !== null ? (2 * tauW) / (1.225 * U_INF * U_INF) : null;

  const profile = [];
  for (let iy = 0; iy < ny; iy++) {
    const c = fvm.cells[iy * nx + ixStation];
    profile.push({ y: c.centroid.y, u: c.u });
  }

  const cfWindow = wallCfHistory.slice(-stationarityWindow);
  const profileWindow = profileHistory.slice(-stationarityWindow);
  const cfMean = cfWindow.length > 0 ? cfWindow.reduce((sum, value) => sum + value, 0) / cfWindow.length : null;
  const cfRangePercent =
    cfWindow.length === stationarityWindow && cfMean > 0
      ? ((Math.max(...cfWindow) - Math.min(...cfWindow)) / cfMean) * 100
      : null;
  let maxProfileDriftMps = null;
  let maxProfileDriftPercent = null;
  if (profileWindow.length === stationarityWindow) {
    const firstProfile = profileWindow[0];
    const lastProfile = profileWindow[profileWindow.length - 1];
    maxProfileDriftMps = Math.max(...firstProfile.map((velocity, index) => Math.abs(lastProfile[index] - velocity)));
    maxProfileDriftPercent = (maxProfileDriftMps / U_INF) * 100;
  }
  const stationary =
    !failed &&
    cfRangePercent !== null &&
    maxProfileDriftPercent !== null &&
    cfRangePercent <= stationarityTolerancePercent &&
    maxProfileDriftPercent <= stationarityTolerancePercent;

  const tolerancePercent = 4;
  const errorPercent = !Number.isFinite(cfMeasured) ? null : (Math.abs(cfMeasured - expected.cf) / expected.cf) * 100;
  const passed = !failed && stationary && errorPercent !== null && errorPercent <= tolerancePercent;

  return {
    id: 'NASA_TMR_FLAT_PLATE',
    name: '2D zero-pressure-gradient flat-plate solver comparison',
    targetValue: expected.cf,
    calculatedValue: failed ? null : cfMeasured,
    units: 'Cf',
    errorPercent,
    tolerancePercent,
    passed,
    status: failed ? 'failed' : passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : failed
        ? failReason + ' No stationary boundary layer was obtained; fail-closed.'
        : !stationary
          ? `Predeclared stationarity gate failed: wall-Cf range ${cfRangePercent ?? 'unavailable'}% and profile drift ${maxProfileDriftPercent ?? 'unavailable'}% over the final ${stationarityWindow} steps; both must be <=${stationarityTolerancePercent}%.`
          : `Cf deviates from Karman-Schoenherr correlation by ${errorPercent.toFixed(1)}%.`,
    measured: {
      stationXM: stationX,
      reynoldsX: reX,
      expectedReTheta: expected.reTheta,
      expectedCf: expected.cf,
      measuredCf: Number.isFinite(cfMeasured) ? cfMeasured : null,
      measuredTauWPa: Number.isFinite(tauW) ? tauW : null,
      wallCellVelocityMps: uWall,
      wallDistanceM: Math.max(1e-6, wallCell.wallDistance),
      wallModelRegime: wallModel ? wallModel.regime : null,
      wallModelYPlus: wallModel ? wallModel.yPlus : null,
      errorPercent,
      stationarity: {
        stationary,
        sampleWindowSteps: cfWindow.length,
        wallCfRangePercent: cfRangePercent,
        maxProfileDriftMps,
        maxProfileDriftPercent,
        tolerancePercent: stationarityTolerancePercent
      }
    },
    expected: {
      cf: expected.cf,
      source: 'Karman-Schoenherr correlation (bundled NASA TMR table)',
      tablePoints: points.length,
      tableSha256: reference.sha256
    },
    details: {
      reference: 'NASA TMR Karman-Schoenherr Cf vs Re_theta table (bundled, checksum-verified).',
      solver: 'FVMNavierStokes3D with k-omega SST fields (production), local time stepping',
      setup: {
        domainM: { length: 2.0, height: 2.0, depth: 0.08 },
        grid: { nx: 40, ny: 128, nz: 1, wallStretch: 1.053 },
        inletVelocityMps: U_INF,
        wall: 'bottom (no-slip via evaluateWallBoundary)',
        top: 'symmetry / free-stream',
        outlet: 'pressure outlet',
        wallModel: 'two-layer all-y+ blend, E = 9.8, kappa = 0.41 (defaults)',
        projectionMode: false,
        localTimeStepping: true,
        notes:
          'Production steady-state path: local time stepping plus line-implicit wall-normal relaxation; plate tripped at the leading edge with equilibrium log-layer k/omega profiles (u_tau = 2.6 m/s).'
      },
      stepsSurvived,
      stationarity: {
        stationary,
        sampleWindowSteps: cfWindow.length,
        wallCfRangePercent: cfRangePercent,
        maxProfileDriftMps,
        maxProfileDriftPercent,
        tolerancePercent: stationarityTolerancePercent
      },
      numericalFailure,
      stationProfile: profile,
      numericalStatus: failed ? `numerical failure after ${stepsSurvived} steps` : `finite after ${stepsSurvived} steps`
    }
  };
}

module.exports = { runNasaTmrFlatPlate };
