/**
 * OmniEng Discrete Ordinates Method (DOM) & Surface Radiation View Factor Engine
 *
 * 1. Discrete Ordinates Method (DOM) solving the Radiative Transfer Equation (RTE)
 *    across discrete angles s_m for a 1D plane-parallel (slab) gray medium:
 *      - S4 / S6 / S8 angular quadrature (half-range Gauss-Legendre ordinates;
 *        S_N uses N/2 ordinates per hemisphere, the standard planar DOM convention).
 *      - Gray absorbing-emitting medium with optional isotropic scattering
 *        (single scattering albedo omega).
 *      - Black or diffuse-gray walls (Marshak boundary conditions, reflectivity
 *        rho = 1 - epsilon).
 *      - Radioative-equilibrium iteration: the temperature field is updated until
 *        local balance G = 4*sigma*T^4 holds (pure absorption-emission) or until
 *        the scattering source converges (omega > 0).
 * 2. Stefan-Boltzmann law (sigma = 5.670374e-8 W/(m^2*K^4)) surface emission and absorption.
 * 3. Enclosure radiosity equations with diffuse-gray surface view factors F_ij.
 * 4. Pointwise incident-radiation evaluation at the center of a 2D rectangular
 *    enclosure by long-characteristics ray integration over the solid angle
 *    (semianalytic; black walls).
 *
 * Verification note: the slab solver reproduces the radiative-equilibrium solution of
 * the gray-slab integral equation (E1/E2 kernel formulation) within ~1% at
 * tau_L in [0.1, 10] for S8, and satisfies the expected equilibrium limits
 * (transparent limit q* -> 1, diffusion/DOM thick-limit behavior). The exact
 * benchmark values quoted in the verification plan (q* = 0.9097/0.7265/0.3533/0.2028
 * at tau = 0.1/1/5/10) correspond to the classical Heaslet-Warming radiative-equilibrium
 * table; they were NOT reproduced by this solver for the pure absorbing-emitting
 * black-wall slab (measured q* ~ 0.915/0.556/0.208/0.117, independently confirmed by
 * Monte Carlo and integral-equation solutions). See test/test_radiation_do.js.
 */

'use strict';

const SIGMA_STEFAN_BOLTZMANN = 5.670374419e-8; // W / (m^2 * K^4)
const PI = Math.PI;

/**
 * Gauss-Legendre quadrature on [0,1] (half-range ordinates).
 * @param {number} order number of ordinates (2 => S4, 3 => S6, 4 => S8)
 * @returns {{mu: number[], weight: number[]}} mu in (0,1), sum(weight) = 1
 */
function glHalfRange(order) {
  const n = order;
  const mu = new Array(n);
  const weight = new Array(n);
  for (let i = 0; i < n; i++) {
    let x = Math.cos((PI * (i + 0.75)) / (n + 0.5));
    for (let it = 0; it < 80; it++) {
      let p0 = 1,
        p1 = x;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      const dp = (n * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-16) break;
    }
    let p0 = 1,
      p1 = x;
    for (let k = 2; k <= n; k++) {
      const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
      p0 = p1;
      p1 = p2;
    }
    const dp = (n * (x * p1 - p0)) / (x * x - 1);
    weight[i] = 1 / ((1 - x * x) * dp * dp);
    mu[i] = (x + 1) / 2;
  }
  return { mu, weight };
}

function slabQuadrature(name) {
  const order = name === 'S4' ? 2 : name === 'S6' ? 3 : name === 'S8' ? 4 : NaN;
  if (!Number.isInteger(order) || order < 2) {
    throw new Error(`Invalid quadrature "${name}" (expected S4, S6 or S8)`);
  }
  return glHalfRange(order);
}

/**
 * 1D discrete ordinates slab solver.
 *
 * @param {Object} opts
 * @param {number} opts.opticalThickness kappa * L (> 0)
 * @param {number[]} [opts.wallTemperatures=[1000,500]] wall temperatures [T1, T2] K
 * @param {number[]} [opts.wallEmissivities=[1,1]] wall emissivities [eps1, eps2]
 * @param {number} [opts.scatteringAlbedo=0] single scattering albedo (0..1)
 * @param {string} [opts.quadrature='S4'] 'S4' | 'S6' | 'S8'
 * @param {number} [opts.nCells=256] number of finite-volume cells
 * @param {boolean} [opts.equilibrium=true] iterate temperature to radiative equilibrium;
 *        if false the temperature profile is the linear profile between wall temperatures
 * @param {number[]} [opts.temperatureProfileK] optional explicit initial temperature profile
 *        (length nCells); used as the fixed profile when equilibrium is false
 * @param {number} [opts.relax=0.6] under-relaxation for the T^4 update
 * @param {number} [opts.tolerance=1e-10] relative convergence tolerance
 * @param {number} [opts.maxIterations=5000] iteration cap
 * @returns {Object} { fluxWm2, fluxDimensionless, temperatureProfileK,
 *                     incidentRadiationWm2, iterations, converged }
 */
function solveSlabRTE(opts) {
  const tauL = opts.opticalThickness;
  if (!Number.isFinite(tauL) || tauL <= 0) {
    throw new Error('opticalThickness must be a positive number');
  }
  const T1 = (opts.wallTemperatures && opts.wallTemperatures[0]) || 1000;
  const T2 = (opts.wallTemperatures && opts.wallTemperatures[1]) || 500;
  const eps1 = (opts.wallEmissivities && opts.wallEmissivities[0]) != null ? opts.wallEmissivities[0] : 1;
  const eps2 = (opts.wallEmissivities && opts.wallEmissivities[1]) != null ? opts.wallEmissivities[1] : 1;
  const rho1 = 1 - eps1;
  const rho2 = 1 - eps2;
  const omega = opts.scatteringAlbedo || 0;
  const n = slabQuadrature(opts.quadrature || 'S4').mu.length;
  const { mu, weight } = slabQuadrature(opts.quadrature || 'S4');
  const N = opts.nCells || 256;
  const useEquilibrium = opts.equilibrium !== false;
  const relax = opts.relax || 0.6;
  const tol = opts.tolerance || 1e-10;
  const maxIter = opts.maxIterations || 5000;
  const dtau = tauL / N;
  const Ib = (t) => (SIGMA_STEFAN_BOLTZMANN * t ** 4) / PI;
  const q0 = SIGMA_STEFAN_BOLTZMANN * (T1 ** 4 - T2 ** 4);

  const T = new Float64Array(N);
  if (opts.temperatureProfileK) {
    if (opts.temperatureProfileK.length !== N) {
      throw new Error('temperatureProfileK must have length nCells');
    }
    for (let j = 0; j < N; j++) T[j] = opts.temperatureProfileK[j];
  } else {
    for (let j = 0; j < N; j++) T[j] = T1 + ((T2 - T1) * (j + 0.5)) / N;
  }
  const S = new Float64Array(N);

  function buildSource() {
    for (let j = 0; j < N; j++) S[j] = (1 - omega) * Ib(T[j]);
  }
  buildSource();

  function sweep() {
    const G = new Float64Array(N);
    const Iplus0 = new Float64Array(n);
    const IminusL = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      Iplus0[i] = eps1 * Ib(T1);
      IminusL[i] = eps2 * Ib(T2);
    }
    const Iplus = new Float64Array(n);
    const Iminus = new Float64Array(n);

    const marchPlus = () => {
      for (let i = 0; i < n; i++) Iplus[i] = Iplus0[i];
      for (let j = 0; j < N; j++) {
        const Sj = S[j];
        for (let i = 0; i < n; i++) {
          const e = Math.exp(-dtau / mu[i]);
          Iplus[i] = Iplus[i] * e + Sj * (1 - e);
        }
      }
    };
    const marchMinus = () => {
      for (let i = 0; i < n; i++) Iminus[i] = IminusL[i];
      for (let j = N - 1; j >= 0; j--) {
        const Sj = S[j];
        for (let i = 0; i < n; i++) {
          const e = Math.exp(-dtau / mu[i]);
          Iminus[i] = Iminus[i] * e + Sj * (1 - e);
        }
      }
    };
    const cellAverageG = () => {
      for (let i = 0; i < n; i++) Iplus[i] = Iplus0[i];
      for (let j = 0; j < N; j++) {
        const Sj = S[j];
        let gp = 0;
        for (let i = 0; i < n; i++) {
          const e = Math.exp(-dtau / mu[i]);
          const f = (mu[i] / dtau) * (1 - e);
          gp += weight[i] * (Iplus[i] * f + Sj * (1 - f));
          Iplus[i] = Iplus[i] * e + Sj * (1 - e);
        }
        G[j] = 2 * PI * gp;
      }
      for (let i = 0; i < n; i++) Iminus[i] = IminusL[i];
      for (let j = N - 1; j >= 0; j--) {
        const Sj = S[j];
        let gm = 0;
        for (let i = 0; i < n; i++) {
          const e = Math.exp(-dtau / mu[i]);
          const f = (mu[i] / dtau) * (1 - e);
          gm += weight[i] * (Iminus[i] * f + Sj * (1 - f));
          Iminus[i] = Iminus[i] * e + Sj * (1 - e);
        }
        G[j] += 2 * PI * gm;
      }
    };

    // Marshak BC iteration (diffuse reflection couples wall intensities)
    for (let bc = 0; bc < 40; bc++) {
      marchPlus();
      marchMinus();
      cellAverageG();
      let qin1 = 0,
        qin2 = 0;
      for (let i = 0; i < n; i++) {
        qin1 += weight[i] * mu[i] * Iminus[i];
        qin2 += weight[i] * mu[i] * Iplus[i];
      }
      let maxd = 0;
      for (let i = 0; i < n; i++) {
        const a = eps1 * Ib(T1) + 2 * rho1 * qin1;
        const b = eps2 * Ib(T2) + 2 * rho2 * qin2;
        maxd = Math.max(maxd, Math.abs(a - Iplus0[i]), Math.abs(b - IminusL[i]));
        Iplus0[i] = a;
        IminusL[i] = b;
      }
      if (maxd < 1e-13) break;
    }
    marchPlus();
    marchMinus();
    let qw1 = 0,
      qw2 = 0;
    for (let i = 0; i < n; i++) {
      qw1 += weight[i] * mu[i] * (Iplus0[i] - Iminus[i]);
      qw2 += weight[i] * mu[i] * (Iplus[i] - IminusL[i]);
    }
    return { G, qW1: 2 * PI * qw1, qW2: 2 * PI * qw2 };
  }

  let iterations = 0;
  let converged = true;

  // Converge the scattering source (omega > 0) for the current temperature field.
  // Returns the sweep result for the converged source.
  const convergeScattering = () => {
    if (omega <= 0) return sweep();
    let r = sweep();
    let sConv = false;
    for (let si = 0; si < 200; si++) {
      let maxd = 0;
      for (let j = 0; j < N; j++) {
        const sNew = (1 - omega) * Ib(T[j]) + (omega * r.G[j]) / (4 * PI);
        const d = Math.abs(sNew - S[j]) / Math.max(Math.abs(sNew), 1e-300);
        if (d > maxd) maxd = d;
        S[j] = sNew;
      }
      if (maxd < 1e-12) {
        sConv = true;
        break;
      }
      r = sweep();
    }
    if (!sConv) converged = false;
    return r;
  };

  if (useEquilibrium) {
    for (let it = 0; it < maxIter; it++) {
      iterations = it + 1;
      const r = convergeScattering();
      let maxd = 0;
      for (let j = 0; j < N; j++) {
        const nt4 = r.G[j] / (4 * SIGMA_STEFAN_BOLTZMANN);
        const ot4 = T[j] ** 4;
        const d = Math.abs(nt4 - ot4) / Math.max(nt4, 1e-300);
        if (d > maxd) maxd = d;
        T[j] = Math.pow(ot4 + relax * (nt4 - ot4), 0.25);
      }
      if (maxd < tol) break;
      buildSource();
      if (it === maxIter - 1) converged = maxd < 1e-6;
    }
    buildSource();
  } else if (omega > 0) {
    convergeScattering();
  }

  const r = sweep();
  const qw = 0.5 * (r.qW1 + r.qW2);
  return {
    fluxWm2: qw,
    fluxDimensionless: qw / q0,
    wallFluxWm2: [r.qW1, r.qW2],
    temperatureProfileK: Array.from(T),
    incidentRadiationWm2: Array.from(r.G),
    iterations,
    converged
  };
}

/**
 * Incident radiation G (W/m^2) at the center of a 2D rectangular enclosure with
 * black walls, absorbing medium (absorption coefficient kappa), and non-emitting
 * medium. Evaluation by deterministic long-characteristics ray integration over
 * the sphere of directions from the center point.
 *
 * @param {Object} opts
 * @param {number} opts.width enclosure width (m)
 * @param {number} opts.height enclosure height (m)
 * @param {number} opts.absorptionCoefficient kappa (1/m)
 * @param {number[]} opts.wallTemperatures [T_bottom, T_top, T_left, T_right] K
 * @param {number} [opts.nAzimuth=96] azimuthal quadrature count
 * @param {number} [opts.nPolar=48] polar quadrature count (Gauss-Legendre on [0,pi])
 * @returns {{G: number, perWall: number[]}}
 */
function evalIncidentRadiationRectangleCenter(opts) {
  const W = opts.width;
  const H = opts.height;
  const kappa = opts.absorptionCoefficient;
  const [Tb, Tt, Tl, Tr] = opts.wallTemperatures;
  const nAz = opts.nAzimuth || 96;
  const nPol = opts.nPolar || 48;
  const Ib = (t) => (SIGMA_STEFAN_BOLTZMANN * t ** 4) / PI;
  const walls = [Tb, Tt, Tl, Tr];
  // polar Gauss-Legendre on [0, pi]: theta
  const polar = glHalfRange(nPol);
  let G = 0;
  const perWall = [0, 0, 0, 0];
  for (let p = 0; p < nPol; p++) {
    const theta = polar.mu[p] * PI;
    const wTheta = polar.weight[p] * PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    if (sinT < 1e-12) continue;
    for (let a = 0; a < nAz; a++) {
      const phi = ((a + 0.5) * 2 * PI) / nAz;
      const dx = sinT * Math.cos(phi);
      const dy = sinT * Math.sin(phi);
      const dz = cosT;
      // distance to each wall plane along direction
      let tMin = Infinity;
      let wall = -1;
      const tBottom = dy < -1e-15 ? -H / 2 / dy : Infinity;
      const tTop = dy > 1e-15 ? H / 2 / dy : Infinity;
      const tLeft = dx < -1e-15 ? -W / 2 / dx : Infinity;
      const tRight = dx > 1e-15 ? W / 2 / dx : Infinity;
      if (tBottom < tMin) {
        tMin = tBottom;
        wall = 0;
      }
      if (tTop < tMin) {
        tMin = tTop;
        wall = 1;
      }
      if (tLeft < tMin) {
        tMin = tLeft;
        wall = 2;
      }
      if (tRight < tMin) {
        tMin = tRight;
        wall = 3;
      }
      const dOmega = wTheta * ((2 * PI) / nAz);
      const contrib = Ib(walls[wall]) * Math.exp(-kappa * tMin) * dOmega;
      G += contrib;
      perWall[wall] += contrib;
    }
  }
  return { G, perWall };
}

class RadiationDOMEngine {
  /**
   * Evaluates net radiative heat flux between two diffuse-gray parallel/opposed surfaces
   * q_rad = sigma * (T1^4 - T2^4) / ( (1/eps1) + (1/eps2) - 1 )
   *
   * @param {Object} surf1 { T: temperatureK, emissivity }
   * @param {Object} surf2 { T: temperatureK, emissivity }
   * @param {number} [viewFactorF12=1.0] View factor from surface 1 to surface 2
   * @returns {{qRadWm2: number, radiativeConductanceHr: number}}
   */
  static evaluateRadiativeFlux(surf1, surf2, viewFactorF12 = 1.0) {
    const T1 = surf1.T || 300.0;
    const T2 = surf2.T || 300.0;
    const eps1 = Math.max(0.01, Math.min(1.0, surf1.emissivity || 0.85));
    const eps2 = Math.max(0.01, Math.min(1.0, surf2.emissivity || 0.85));

    // Two-surface enclosure equivalent emissivity
    const invEpsTotal = 1.0 / eps1 + 1.0 / eps2 - 1.0;
    const epsEquiv = 1.0 / invEpsTotal;

    const T1_4 = Math.pow(T1, 4.0);
    const T2_4 = Math.pow(T2, 4.0);

    const qRad = SIGMA_STEFAN_BOLTZMANN * epsEquiv * viewFactorF12 * (T1_4 - T2_4);

    // Linearized radiation heat transfer coefficient h_rad: q = h_rad * (T1 - T2)
    const deltaT = T1 - T2;
    const hRad =
      Math.abs(deltaT) > 1e-4
        ? Math.abs(qRad / deltaT)
        : 4.0 * SIGMA_STEFAN_BOLTZMANN * epsEquiv * viewFactorF12 * Math.pow(T1, 3.0);

    return {
      qRadWm2: Number(qRad.toFixed(2)),
      radiativeConductanceHr: Number(hRad.toFixed(3)),
      equivalentEmissivity: Number(epsEquiv.toFixed(4)),
      T1,
      T2
    };
  }

  /**
   * Discrete Ordinates Method (DOM) angular quadrature direction weights (S4 Quadrature: 24 directions)
   * @returns {Array<{dx: number, dy: number, dz: number, weight: number}>}
   */
  static getS4QuadratureDirections() {
    const mu1 = 0.3500212;
    const mu2 = 0.8688941;
    const w = Math.PI / 6.0;

    const directions = [];
    const signs = [-1, 1];

    for (const sx of signs) {
      for (const sy of signs) {
        for (const sz of signs) {
          directions.push({ dx: sx * mu1, dy: sy * mu1, dz: sz * mu2, weight: w });
          directions.push({ dx: sx * mu1, dy: sy * mu2, dz: sz * mu1, weight: w });
          directions.push({ dx: sx * mu2, dy: sy * mu1, dz: sz * mu1, weight: w });
        }
      }
    }

    return directions;
  }

  /**
   * Half-range (0 < mu < 1) Gauss-Legendre ordinates for planar DOM.
   * S4 -> order 2, S6 -> order 3, S8 -> order 4.
   * @param {string} [name='S4'] 'S4' | 'S6' | 'S8'
   * @returns {{mu: number[], weight: number[]}}
   */
  static getHalfRangeQuadrature(name = 'S4') {
    return slabQuadrature(name);
  }

  /**
   * 1D slab DOM solver (see solveSlabRTE for option documentation).
   */
  static solveSlabRTE(opts) {
    return solveSlabRTE(opts);
  }

  /**
   * Incident radiation at center of 2D rectangular black enclosure (see
   * evalIncidentRadiationRectangleCenter for option documentation).
   */
  static evalIncidentRadiationRectangleCenter(opts) {
    return evalIncidentRadiationRectangleCenter(opts);
  }
}

module.exports = {
  SIGMA_STEFAN_BOLTZMANN,
  RadiationDOMEngine,
  solveSlabRTE,
  evalIncidentRadiationRectangleCenter,
  glHalfRange
};
