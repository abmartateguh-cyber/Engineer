/**
 * OmniEng gamma-Re_theta Transition Turbulence Model (simplified boundary-layer form)
 *
 * Implementation scope (Battalion 6, Agent 55):
 *   1. Langtry-Menter (LM) algebraic correlations:
 *      - Re_theta_t = 163 + exp(6.91 - Tu/0.1) for free-stream turbulence
 *        intensity Tu (in %), the standard LM free-stream transition onset
 *        momentum-thickness Reynolds number correlation.
 *      - Re_theta_c = f(Tu, lambda_theta): the critical momentum-thickness
 *        Reynolds number for onset, scaled by the pressure-gradient parameter
 *        lambda_theta = (theta^2/nu) dUe/dx.  A favorable pressure gradient
 *        (lambda_theta < 0) delays transition (Re_theta_c increases), an
 *        adverse gradient (lambda_theta > 0) promotes it (Re_theta_c
 *        decreases); the influence weakens as Tu grows.
 *   2. The intermittency gamma transport equation in a simplified 1D
 *      streamwise boundary-layer form:
 *          U d(gamma)/dx = P_gamma + D_gamma
 *          P_gamma = F_length c_a1 rho S [gamma F_onset]^0.5 (1 - c_e1 gamma)
 *          D_gamma = c_a2 rho Omega F_turb (c_e2 gamma - 1)
 *      with the standard LM local onset functions:
 *          F_onset1 = Re_theta / (2.193 Re_theta_c)
 *          F_onset2 = min(max(F_onset1, F_onset1^4), 2)
 *          F_onset3 = max(1 - (R_T/2.5)^3, 0)
 *          F_onset  = max(F_onset2 - F_onset3, 0)
 *          F_turb   = exp(-(R_T/4)^4)
 *      D_gamma is negative for gamma < 1/c_e2, which pins gamma to zero in
 *      the laminar region; after onset, P_gamma drives a logistic-like rise
 *      to gamma -> 1 as R_T -> large (F_turb -> 0) in the turbulent zone.
 *   3. Blended eddy viscosity: mu_t_total = mu_laminar + gamma mu_t,turbulent.
 *   4. Boundary-layer edge tracking helpers: from a flat-plate velocity
 *      profile, find delta_99, delta*, theta, Re_theta, and Tu.
 *   5. A deterministic 1D flat-plate transition march that integrates the
 *      gamma equation over a Blasius boundary layer and reports the
 *      predicted transition Reynolds number.
 *
 * All results are deterministic (no Math.random, fixed grids, fixed loop
 * order).  This is a demonstration/verification-grade model, not a
 * production 3D unstructured CFD transition closure.
 */

'use strict';

const TRANSITION_CONSTANTS = Object.freeze({
  cA1: 2.0,
  cA2: 0.06,
  cE1: 1.0,
  cE2: 50.0,
  fLength: 1.0,
  reThetaTOffset: 163.0,
  reThetaTCoef: 6.91,
  reThetaTTau: 0.1,
  onsetFirst: 2.193,
  rTOnset3: 2.5,
  rTTurb4: 4.0,
  reThetaCMinFactor: 0.05,
  reThetaCMaxFactor: 10.0,
  pressureGradientTau: 0.75,
  pressureGradientFavorableCoef: 8.0,
  pressureGradientAdverseCoef: 6.0,
  blasiusMomentumThickness: 0.664,
  blasiusDelta99Coef: 5.0,
  blasiusWallShearCoef: 0.332
});

function clamp(value, lo, hi) {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Free-stream transition onset momentum-thickness Reynolds number (LM).
 * Re_theta_t = 163 + exp(6.91 - Tu/0.1), Tu in percent.
 * @param {number} tuPercent free-stream turbulence intensity in %
 * @returns {number} Re_theta_t (Infinity for Tu = 0)
 */
function reThetaT(tuPercent) {
  if (!(tuPercent > 0)) {
    return Infinity;
  }
  return (
    TRANSITION_CONSTANTS.reThetaTOffset +
    Math.exp(TRANSITION_CONSTANTS.reThetaTCoef - tuPercent / TRANSITION_CONSTANTS.reThetaTTau)
  );
}

/**
 * Pressure-gradient parameter lambda_theta = (theta^2/nu) dUe/dx.
 * @param {number} theta momentum thickness (m)
 * @param {number} kinematicViscosity nu (m^2/s)
 * @param {number} dUeDx edge-velocity streamwise gradient (1/s)
 * @returns {number} lambda_theta (dimensionless)
 */
function lambdaTheta(theta, kinematicViscosity, dUeDx) {
  if (!(kinematicViscosity > 0) || !(theta > 0)) {
    return 0;
  }
  return ((theta * theta) / kinematicViscosity) * dUeDx;
}

/**
 * Critical momentum-thickness Reynolds number for onset, Re_theta_c =
 * Re_theta_t * F(Tu, lambda_theta).  Favorable gradient (lambda < 0) ->
 * Re_theta_c increases; adverse (lambda > 0) -> decreases; monotone
 * non-increasing in lambda for fixed Tu.
 * @param {number} reThetaTValue Re_theta_t
 * @param {number} lambdaThetaVal lambda_theta
 * @param {number} tuPercent free-stream turbulence intensity in %
 * @returns {number} Re_theta_c
 */
function reThetaC(reThetaTValue, lambdaThetaVal, tuPercent) {
  const sensitivity = Math.exp(-tuPercent / TRANSITION_CONSTANTS.pressureGradientTau);
  let factor;
  if (lambdaThetaVal <= 0) {
    factor = 1 - TRANSITION_CONSTANTS.pressureGradientFavorableCoef * sensitivity * lambdaThetaVal;
  } else {
    factor = Math.exp(-TRANSITION_CONSTANTS.pressureGradientAdverseCoef * sensitivity * lambdaThetaVal);
  }
  factor = clamp(factor, TRANSITION_CONSTANTS.reThetaCMinFactor, TRANSITION_CONSTANTS.reThetaCMaxFactor);
  return reThetaTValue * factor;
}

/**
 * Local LM onset functions.
 * @param {number} reThetaLocal local momentum-thickness Reynolds number
 * @param {number} reThetaCritical Re_theta_c
 * @param {number} turbulentViscosityRatio R_T = nu_t/nu
 * @returns {Object} { fOnset1, fOnset2, fOnset3, fOnset, fTurb }
 */
function onsetFunctions(reThetaLocal, reThetaCritical, turbulentViscosityRatio) {
  const c = TRANSITION_CONSTANTS;
  const fOnset1 = reThetaLocal / (c.onsetFirst * reThetaCritical);
  const fOnset2 = clamp(Math.max(fOnset1, fOnset1 ** 4), 0, 2.0);
  const fOnset3 = Math.max(1 - Math.pow(turbulentViscosityRatio / c.rTOnset3, 3), 0);
  const fOnset = Math.max(fOnset2 - fOnset3, 0);
  const fTurb = Math.exp(-Math.pow(turbulentViscosityRatio / c.rTTurb4, 4));
  return { fOnset1, fOnset2, fOnset3, fOnset, fTurb };
}

/**
 * Volumetric source terms of the intermittency transport equation in the
 * simplified 1D streamwise form:
 *     U d(gamma)/dx = P_gamma - D_gamma
 *     P_gamma = F_length c_a1 rho S sqrt(F_onset) (1 - gamma)
 *     D_gamma = c_a2 rho Omega F_turb gamma
 * Pre-onset (F_onset = 0) both terms vanish, so gamma = 0 exactly; once
 * Re_theta exceeds the critical value, P_gamma drives a logistic-like rise
 * to gamma -> 1 as the turbulent viscosity ratio R_T grows and F_turb -> 0
 * (relaminarization damping fades).  gamma is bounded by [0, 1] by
 * construction for nonnegative coefficients.
 * @param {number} gamma intermittency in [0, 1]
 * @param {Object} opts
 * @param {number} opts.reTheta local momentum-thickness Reynolds number
 * @param {number} opts.reThetaCritical Re_theta_c
 * @param {number} opts.turbulentViscosityRatio R_T = nu_t/nu
 * @param {number} opts.rho density (kg/m^3)
 * @param {number} opts.strain strain-rate magnitude S (1/s)
 * @param {number} opts.vorticity vorticity magnitude Omega (1/s)
 * @param {number} [opts.fLength] F_length calibration (default 1)
 * @returns {Object} { production, destruction, fOnset, fTurb }
 */
function intermittencySource(gamma, opts) {
  const c = TRANSITION_CONSTANTS;
  const fLength = opts.fLength === undefined ? c.fLength : opts.fLength;
  const { fOnset, fTurb } = onsetFunctions(opts.reTheta, opts.reThetaCritical, opts.turbulentViscosityRatio);
  const production = fLength * c.cA1 * opts.rho * opts.strain * Math.sqrt(fOnset) * (1 - gamma);
  const destruction = c.cA2 * opts.rho * opts.vorticity * fTurb * gamma;
  return { production, destruction, fOnset, fTurb };
}

/**
 * One explicit streamwise step of the gamma equation:
 * gamma_{n+1} = gamma_n + dx/U * (P - D)/(rho), clamped to [0, 1].
 * @param {number} gamma current intermittency
 * @param {Object} opts same options as intermittencySource plus
 * @param {number} opts.velocity edge/streamwise velocity U (m/s)
 * @param {number} dx streamwise step (m)
 * @returns {number} updated gamma in [0, 1]
 */
function advanceIntermittency(gamma, opts, dx) {
  const { production, destruction } = intermittencySource(gamma, opts);
  const dGammaDx = (production - destruction) / (opts.rho * opts.velocity);
  return clamp(gamma + dx * dGammaDx, 0, 1);
}

/**
 * Blended eddy viscosity: mu_t_total = mu_lam + gamma mu_t,turbulent.
 * @param {number} muLaminar molecular dynamic viscosity (Pa s)
 * @param {number} muTTurbulent fully-turbulent eddy viscosity (Pa s)
 * @param {number} gamma intermittency
 * @returns {number} total effective (laminar + turbulent) viscosity
 */
function blendEddyViscosity(muLaminar, muTTurbulent, gamma) {
  return muLaminar + clamp(gamma, 0, 1) * muTTurbulent;
}

/**
 * Deterministic RK4 solution of the Blasius self-similar boundary-layer
 * equation 2 f''' + f f'' = 0 with f(0)=0, f'(0)=0, f'(inf)=1, via
 * shooting on f''(0).
 * @param {Object} [opts]
 * @param {number} [opts.etaMax] integration extent (default 9)
 * @param {number} [opts.nSteps] RK4 steps (default 9000)
 * @param {number} [opts.tol] shooting tolerance (default 1e-10)
 * @returns {Object} { eta, fp, f, fpp0, eta99, thetaIntegral, deltaStarIntegral }
 */
function blasiusSolve(opts) {
  const etaMax = opts && opts.etaMax !== undefined ? opts.etaMax : 9.0;
  const nSteps = opts && opts.nSteps !== undefined ? opts.nSteps : 9000;
  const tol = opts && opts.tol !== undefined ? opts.tol : 1e-10;
  const h = etaMax / nSteps;

  function integrate(fpp0) {
    const fp = new Float64Array(nSteps + 1);
    const f = new Float64Array(nSteps + 1);
    const fpp = new Float64Array(nSteps + 1);
    let f0 = 0;
    let fp0 = 0;
    let fpp0v = fpp0;
    fp[0] = 0;
    f[0] = 0;
    fpp[0] = fpp0;
    for (let i = 0; i < nSteps; i++) {
      const g1 = [fp0, fpp0v, -0.5 * f0 * fpp0v];
      const g2 = [
        fp0 + 0.5 * h * g1[0],
        fpp0v + 0.5 * h * g1[1],
        -0.5 * (f0 + 0.5 * h * g1[0]) * (fpp0v + 0.5 * h * g1[1])
      ];
      const g3 = [
        fp0 + 0.5 * h * g2[0],
        fpp0v + 0.5 * h * g2[1],
        -0.5 * (f0 + 0.5 * h * g2[0]) * (fpp0v + 0.5 * h * g2[1])
      ];
      const g4 = [fp0 + h * g3[0], fpp0v + h * g3[1], -0.5 * (f0 + h * g3[0]) * (fpp0v + h * g3[1])];
      f0 += (h / 6) * (g1[0] + 2 * g2[0] + 2 * g3[0] + g4[0]);
      fp0 += (h / 6) * (g1[1] + 2 * g2[1] + 2 * g3[1] + g4[1]);
      fpp0v += (h / 6) * (g1[2] + 2 * g2[2] + 2 * g3[2] + g4[2]);
      f[i + 1] = f0;
      fp[i + 1] = fp0;
      fpp[i + 1] = fpp0v;
    }
    return { fp, f, fpp, fppEnd: fp0 };
  }

  let lo = 0.3;
  let hi = 0.36;
  let fpp0 = 0.33206;
  for (let iter = 0; iter < 200; iter++) {
    const sol = integrate(fpp0);
    if (sol.fppEnd < 1 - tol || !Number.isFinite(sol.fppEnd)) {
      lo = fpp0;
    } else if (sol.fppEnd > 1 + tol) {
      hi = fpp0;
    } else {
      let thetaSum = 0;
      let deltaStarSum = 0;
      for (let i = 0; i <= nSteps; i++) {
        const w = i === 0 || i === nSteps ? 0.5 : 1;
        thetaSum += w * sol.fp[i] * (1 - sol.fp[i]);
        deltaStarSum += w * (1 - sol.fp[i]);
      }
      const thetaIntegral = thetaSum * h;
      const deltaStarIntegral = deltaStarSum * h;
      let eta99 = etaMax;
      for (let i = 0; i <= nSteps; i++) {
        if (sol.fp[i] >= 0.99) {
          const fm = i > 0 ? sol.fp[i - 1] : 0;
          const t = (0.99 - fm) / (sol.fp[i] - fm);
          eta99 = (i - 1 + Math.max(0, Math.min(1, t))) * h;
          break;
        }
      }
      return {
        eta: sol.fp,
        fp: sol.fp,
        f: sol.f,
        fpp: sol.fpp,
        fpp0,
        eta99,
        thetaIntegral,
        deltaStarIntegral
      };
    }
    fpp0 = 0.5 * (lo + hi);
  }
  throw new Error('Blasius shooting failed to converge');
}

/**
 * Sample the Blasius velocity profile at a streamwise station x.
 * @param {Object} opts
 * @param {number} opts.Ue edge velocity (m/s)
 * @param {number} opts.nu kinematic viscosity (m^2/s)
 * @param {number} opts.x streamwise coordinate (m)
 * @param {number} [opts.nPoints] number of wall-normal samples (default 2000)
 * @param {number} [opts.etaMax] (default 9)
 * @returns {Object} { points, Ue, nu, x, eta99, delta99, theta, deltaStar, reTheta }
 */
function blasiusProfile(opts) {
  const Ue = opts.Ue;
  const nu = opts.nu;
  const x = opts.x;
  const nPoints = opts.nPoints !== undefined ? opts.nPoints : 2000;
  const etaMax = opts.etaMax !== undefined ? opts.etaMax : 9.0;
  const sol = blasiusSolve({ etaMax });
  const scale = Math.sqrt(Ue / (nu * x));
  const points = new Array(nPoints + 1);
  const nSteps = sol.fp.length - 1;
  for (let i = 0; i <= nPoints; i++) {
    const eta = (i / nPoints) * etaMax;
    const y = eta / scale;
    const idx = Math.min(nSteps, Math.round((i / nPoints) * nSteps));
    points[i] = { y, u: Ue * sol.fp[idx] };
  }
  const delta99 = sol.eta99 / scale;
  const theta = sol.thetaIntegral / scale;
  const deltaStar = sol.deltaStarIntegral / scale;
  return {
    points,
    Ue,
    nu,
    x,
    eta99: sol.eta99,
    delta99,
    theta,
    deltaStar,
    reTheta: (Ue * theta) / nu
  };
}

/**
 * Boundary-layer edge tracking and integral diagnostics from a velocity
 * profile (ascending wall distance, u <= Ue).  Finds delta_99 by linear
 * interpolation where u = 0.99 Ue, then trapezoid-integrates displacement
 * and momentum thickness.
 * @param {Array} profile array of { y, u, k? } ascending in y
 * @param {number} Ue edge velocity (m/s); if omitted, taken as max u
 * @param {number} nu kinematic viscosity (m^2/s)
 * @returns {Object} { delta99, deltaStar, theta, reTheta, tuPercent, uEdge }
 */
function boundaryLayerDiagnostics(profile, Ue, nu) {
  const uEdge = Ue !== undefined && Ue > 0 ? Ue : Math.max(...profile.map((p) => p.u));
  const n = profile.length;
  let delta99 = NaN;
  for (let i = 1; i < n; i++) {
    if (profile[i].u >= 0.99 * uEdge) {
      const uPrev = profile[i - 1].u;
      const t = (0.99 * uEdge - uPrev) / (profile[i].u - uPrev);
      delta99 = profile[i - 1].y + t * (profile[i].y - profile[i - 1].y);
      break;
    }
  }
  let deltaStar = 0;
  let theta = 0;
  let kAvg = 0;
  for (let i = 0; i < n; i++) {
    const u = profile[i].u;
    const dStar = 1 - u / uEdge;
    const th = (u / uEdge) * dStar;
    if (i === 0 || i === n - 1) {
      deltaStar += 0.5 * dStar;
      theta += 0.5 * th;
    } else {
      deltaStar += dStar;
      theta += th;
    }
    kAvg += profile[i].k === undefined ? 0 : profile[i].k;
  }
  const dy = (profile[n - 1].y - profile[0].y) / (n - 1);
  deltaStar *= dy;
  theta *= dy;
  kAvg /= n;
  const tuPercent = kAvg > 0 ? (100 * Math.sqrt((2 / 3) * kAvg)) / uEdge : 0;
  return {
    delta99,
    deltaStar,
    theta,
    reTheta: (uEdge * theta) / nu,
    tuPercent,
    uEdge
  };
}

/**
 * Deterministic 1D flat-plate transition march: integrates gamma along a
 * Blasius boundary layer (zero pressure gradient, lambda_theta = 0).
 * @param {Object} [opts]
 * @param {number} [opts.UInf] free-stream velocity (default 10)
 * @param {number} [opts.nu] kinematic viscosity (default 1.5e-5)
 * @param {number} [opts.rho] density (default 1.225)
 * @param {number} [opts.tuPercent] free-stream Tu in % (default 5)
 * @param {number} [opts.xStart] (default 0.05)
 * @param {number} [opts.xEnd] (default 1.6)
 * @param {number} [opts.nStations] (default 600)
 * @param {number} [opts.rTFull] fully-turbulent nu_t/nu (default 25)
 * @param {number} [opts.fLength] F_length (default 1)
 * @returns {Object} { stations, reThetaT, reThetaC, transitionOnset, transitionMid }
 */
function flatPlateTransitionMarch(opts) {
  const UInf = opts && opts.UInf !== undefined ? opts.UInf : 10.0;
  const nu = opts && opts.nu !== undefined ? opts.nu : 1.5e-5;
  const rho = opts && opts.rho !== undefined ? opts.rho : 1.225;
  const tuPercent = opts && opts.tuPercent !== undefined ? opts.tuPercent : 5.0;
  const xStart = opts && opts.xStart !== undefined ? opts.xStart : 0.05;
  const xEnd = opts && opts.xEnd !== undefined ? opts.xEnd : 1.6;
  const nStations = opts && opts.nStations !== undefined ? opts.nStations : 600;
  const rTFull = opts && opts.rTFull !== undefined ? opts.rTFull : 25.0;
  const fLength = opts && opts.fLength !== undefined ? opts.fLength : 0.06;

  const reThetaTValue = reThetaT(tuPercent);
  const reThetaCValue = reThetaC(reThetaTValue, 0, tuPercent);

  const stations = [];
  let gamma = 0;
  const dx = (xEnd - xStart) / (nStations - 1);

  for (let i = 0; i < nStations; i++) {
    const x = xStart + i * dx;
    const reX = (UInf * x) / nu;
    const thetaB = TRANSITION_CONSTANTS.blasiusMomentumThickness * Math.sqrt((nu * x) / UInf);
    const reTheta = (UInf * thetaB) / nu;
    const delta99B = TRANSITION_CONSTANTS.blasiusDelta99Coef * Math.sqrt((nu * x) / UInf);
    const strain = UInf / delta99B;
    const rT = gamma * rTFull;
    const src = intermittencySource(gamma, {
      reTheta,
      reThetaCritical: reThetaCValue,
      turbulentViscosityRatio: rT,
      rho,
      strain,
      vorticity: strain,
      fLength
    });
    stations.push({
      x,
      reX,
      theta: thetaB,
      reTheta,
      delta99: delta99B,
      gamma,
      fOnset: src.fOnset,
      fTurb: src.fTurb,
      production: src.production,
      destruction: src.destruction
    });
    gamma = advanceIntermittency(
      gamma,
      {
        reTheta,
        reThetaCritical: reThetaCValue,
        turbulentViscosityRatio: rT,
        rho,
        strain,
        vorticity: strain,
        fLength,
        velocity: UInf
      },
      dx
    );
  }

  let onsetIndex = -1;
  let midIndex = -1;
  for (let i = 0; i < nStations; i++) {
    if (onsetIndex < 0 && stations[i].gamma > 0.01) {
      onsetIndex = i;
    }
    if (midIndex < 0 && stations[i].gamma >= 0.5) {
      midIndex = i;
    }
  }

  const transitionOnset =
    onsetIndex >= 0
      ? { x: stations[onsetIndex].x, reX: stations[onsetIndex].reX, gamma: stations[onsetIndex].gamma }
      : null;
  const transitionMid =
    midIndex >= 0 ? { x: stations[midIndex].x, reX: stations[midIndex].reX, gamma: stations[midIndex].gamma } : null;

  return {
    stations,
    reThetaT: reThetaTValue,
    reThetaC: reThetaCValue,
    transitionOnset,
    transitionMid,
    config: {
      UInf,
      nu,
      rho,
      tuPercent,
      xStart,
      xEnd,
      nStations,
      rTFull,
      fLength
    }
  };
}

module.exports = {
  TRANSITION_CONSTANTS,
  clamp,
  reThetaT,
  lambdaTheta,
  reThetaC,
  onsetFunctions,
  intermittencySource,
  advanceIntermittency,
  blendEddyViscosity,
  blasiusSolve,
  blasiusProfile,
  boundaryLayerDiagnostics,
  flatPlateTransitionMarch
};
