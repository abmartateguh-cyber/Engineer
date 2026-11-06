'use strict';

/**
 * Six-Degree-of-Freedom rigid-body flight dynamics.
 *
 * Integrates the full 13-element rigid-body state
 *
 *   [ r (3) | v (3) | q (4) | omega (3) ]
 *
 * where
 *   - r      inertial position [m] (ECI, origin at Earth center for the
 *            inverse-square gravity model; flat-earth coordinates with
 *            z vertical for the constant-g model)
 *   - v      inertial velocity [m/s]
 *   - q      body-to-inertial attitude quaternion [qw, qx, qy, qz]
 *   - omega  body-frame angular-rate vector [p, q, r] [rad/s]
 *
 * Force models
 *   - gravity: inverse-square central field (mu_Earth) or flat-earth
 *     constant g0, selected per run with `gravityModel`
 *   - atmosphere: US Standard Atmosphere 1976 (documented constants below),
 *     density/temperature/pressure/sound-speed by geometric altitude
 *   - aerodynamics: caller-supplied CL/CD/Cm table vs angle of attack and
 *     Mach, bilinearly interpolated (edges clamped); lift/drag applied in
 *     body axes from the stability-frame decomposition
 *   - thrust: caller-supplied magnitude and body-frame direction, either
 *     constant or a piecewise-linear time profile
 *
 * Integration uses the production fixed-step RK4 solver (ODESolvers.solveRK4)
 * with a stability check over the whole trajectory (finiteness, quaternion
 * unit-norm drift, energy finiteness). Apogee (vertical-velocity sign change)
 * and impact (altitude <= 0) events are detected on the returned samples with
 * linear interpolation for event time and state capture.
 *
 * This is an experimental model, not flight-qualified software. No structural
 * flexibility, propellant depletion, wind, Earth rotation, or aeroelastic
 * coupling is modeled.
 */

const { ODESolvers } = require('../math/ode_solvers');

const G0 = 9.80665; // standard gravity, m/s^2
const MU_EARTH = 3.986004418e14; // Earth gravitational parameter, m^3/s^2
const R_EARTH = 6378137.0; // WGS84 equatorial radius, m
const R_GEOPOTENTIAL = 6356766.0; // mean Earth radius for geopotential altitude, m

const ATM = Object.freeze({
  P0: 101325.0, // sea-level pressure, Pa
  T0: 288.15, // sea-level temperature, K
  RHO0: 1.225, // sea-level density, kg/m^3
  R_SPEC: 287.05287, // specific gas constant for air, J/(kg K)
  GAMMA: 1.4, // ratio of specific heats
  // 1976 US Standard Atmosphere geopotential layers:
  // [baseGeopotentialAltitude_m, lapseRate_K_m, baseTemperature_K, basePressure_Pa]
  LAYERS: [
    [0.0, -0.0065, 288.15, 101325.0],
    [11000.0, 0.0, 216.65, 22632.1],
    [20000.0, 0.001, 216.65, 5474.89],
    [32000.0, 0.0028, 228.65, 868.019],
    [47000.0, 0.0, 270.65, 110.906],
    [51000.0, -0.0028, 270.65, 66.9389],
    [71000.0, -0.002, 214.65, 3.95642],
    [84852.0, 0.0, 186.87, 0.3734]
  ],
  MAX_ALTITUDE_M: 86000.0
});

function quatMul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
  ];
}

function quatConj(q) {
  return [q[0], -q[1], -q[2], -q[3]];
}

function quatRotate(q, v) {
  const r = quatMul(quatMul(q, [0, v[0], v[1], v[2]]), quatConj(q));
  return [r[1], r[2], r[3]];
}

function quatNorm(q) {
  return Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * 1976 US Standard Atmosphere at geometric altitude z [m].
 * Returns { temperatureK, pressurePa, densityKgM3, speedOfSoundM_s } for
 * 0 <= z <= 86 km; returns null above 86 km (treated as vacuum by the
 * dynamics model).
 */
function standardAtmosphere1976(altitudeM) {
  if (!Number.isFinite(altitudeM) || altitudeM < 0) return null;
  if (altitudeM > ATM.MAX_ALTITUDE_M) return null;
  const h = (R_GEOPOTENTIAL * altitudeM) / (R_GEOPOTENTIAL + altitudeM);
  let layer = ATM.LAYERS[0];
  for (let k = ATM.LAYERS.length - 1; k >= 0; k--) {
    if (h >= ATM.LAYERS[k][0]) {
      layer = ATM.LAYERS[k];
      break;
    }
  }
  const [hB, lapse, tB, pB] = layer;
  const dh = h - hB;
  let T = tB;
  let P = pB;
  if (Math.abs(lapse) < 1e-8) {
    P = pB * Math.exp((-G0 * dh) / (ATM.R_SPEC * tB));
  } else {
    T = tB + lapse * dh;
    P = pB * Math.pow(T / tB, -G0 / (lapse * ATM.R_SPEC));
  }
  const rho = P / (ATM.R_SPEC * T);
  const a = Math.sqrt(ATM.GAMMA * ATM.R_SPEC * T);
  return { temperatureK: T, pressurePa: P, densityKgM3: rho, speedOfSoundM_s: a };
}

/**
 * Bilinear interpolation of a coefficient grid with clamped edges.
 * grid[row][col] with rows indexed by mach, columns by alphaDeg.
 */
function bilinearCoef(table, alphaDeg, mach) {
  const A = table.alphaDeg;
  const M = table.mach;
  const grid = table.values;
  const rows = M.length;
  const cols = A.length;
  const alpha = Math.min(Math.max(alphaDeg, A[0]), A[cols - 1]);
  const machV = Math.min(Math.max(mach, M[0]), M[rows - 1]);
  let j = 0;
  while (j < rows - 1 && machV > M[j + 1]) j++;
  let i = 0;
  while (i < cols - 1 && alpha > A[i + 1]) i++;
  if (rows === 1 && cols === 1) return grid[0][0];
  if (rows === 1) {
    const fA = (alpha - A[i]) / (A[i + 1] - A[i]);
    return grid[0][i] * (1 - fA) + grid[0][i + 1] * fA;
  }
  if (cols === 1) {
    const fM = (machV - M[j]) / (M[j + 1] - M[j]);
    return grid[j][0] * (1 - fM) + grid[j + 1][0] * fM;
  }
  const fA = (alpha - A[i]) / (A[i + 1] - A[i]);
  const fM = (machV - M[j]) / (M[j + 1] - M[j]);
  const v00 = grid[j][i];
  const v01 = grid[j][i + 1];
  const v10 = grid[j + 1][i];
  const v11 = grid[j + 1][i + 1];
  return v00 * (1 - fA) * (1 - fM) + v01 * fA * (1 - fM) + v10 * (1 - fA) * fM + v11 * fA * fM;
}

class SixDofDynamics {
  constructor() {
    this.G0 = G0;
    this.MU_EARTH = MU_EARTH;
    this.R_EARTH = R_EARTH;
    this.defaultDirectionBody = [1, 0, 0];
    this.defaultQuaternionDriftTol = 1e-6;
  }

  invalidInput(operation, missingInputs) {
    return {
      success: false,
      status: 'invalid-input',
      validationLevel: 'experimental',
      error: {
        code: 'INVALID_INPUT',
        message: `${operation} requires explicit valid inputs: ${missingInputs.join(', ')}`
      }
    };
  }

  numericalFailure(operation, diagnostic) {
    return {
      success: false,
      status: 'numerical-failure',
      validationLevel: 'experimental',
      error: {
        code: 'NUMERICAL_FAILURE',
        message: `${operation} produced invalid numerical output: ${diagnostic}`
      }
    };
  }

  _validateCoefficientTable(coefficients) {
    if (coefficients === null || coefficients === undefined) return null;
    if (typeof coefficients !== 'object' || Array.isArray(coefficients)) {
      return 'coefficients object (alphaDeg, mach, cl, cd, cm)';
    }
    const A = coefficients.alphaDeg;
    const M = coefficients.mach;
    if (!Array.isArray(A) || !Array.isArray(M) || A.length < 1 || M.length < 1) {
      return 'coefficients.alphaDeg / mach arrays with at least one point';
    }
    for (let k = 1; k < A.length; k++) {
      if (!Number.isFinite(A[k]) || A[k] <= A[k - 1]) return 'coefficients.alphaDeg strictly increasing and finite';
    }
    for (let k = 1; k < M.length; k++) {
      if (!Number.isFinite(M[k]) || M[k] <= M[k - 1]) return 'coefficients.mach strictly increasing and finite';
    }
    for (const key of ['cl', 'cd', 'cm']) {
      const grid = coefficients[key];
      if (!Array.isArray(grid) || grid.length !== M.length) {
        return `coefficients.${key} grid with ${M.length} mach rows`;
      }
      for (let r = 0; r < M.length; r++) {
        if (!Array.isArray(grid[r]) || grid[r].length !== A.length) {
          return `coefficients.${key} row ${r} with ${A.length} alpha columns`;
        }
        for (let c = 0; c < A.length; c++) {
          if (!Number.isFinite(grid[r][c])) return `coefficients.${key}[${r}][${c}] finite`;
        }
      }
    }
    return null;
  }

  _validateThrust(thrust) {
    if (thrust === null || thrust === undefined) return null;
    if (typeof thrust === 'object' && !Array.isArray(thrust) && Number.isFinite(thrust.magnitudeN)) {
      const dir = thrust.directionBody || this.defaultDirectionBody;
      if (!Array.isArray(dir) || dir.length !== 3 || !dir.every(Number.isFinite)) {
        return 'thrust.directionBody [x, y, z]';
      }
      return null;
    }
    if (Array.isArray(thrust)) {
      if (thrust.length < 2) return 'thrust profile array with at least two points';
      let prev = -Infinity;
      for (const point of thrust) {
        if (!point || !Number.isFinite(point.timeS) || !Number.isFinite(point.magnitudeN)) {
          return 'thrust profile points with finite timeS and magnitudeN';
        }
        if (point.timeS <= prev) return 'thrust profile timeS strictly increasing';
        prev = point.timeS;
        if (point.directionBody !== undefined) {
          const dir = point.directionBody;
          if (!Array.isArray(dir) || dir.length !== 3 || !dir.every(Number.isFinite)) {
            return 'thrust profile directionBody [x, y, z]';
          }
        }
      }
      return null;
    }
    return 'thrust magnitude profile (object or array)';
  }

  /**
   * Integrates the rigid-body 6-DOF state.
   */
  simulateSixDof(params = {}) {
    const op = '6-DOF simulation';
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return this.invalidInput(op, ['parameter object']);
    }
    const missingInputs = [];
    const state = params.initialState || {};
    if (!state || typeof state !== 'object') {
      missingInputs.push('initialState');
    } else {
      for (const key of ['positionM', 'velocityM_s', 'quaternion', 'angularRateRad_s']) {
        if (!Array.isArray(state[key]) || state[key].length !== 3 || !state[key].every(Number.isFinite)) {
          if (key === 'quaternion') {
            if (
              !Array.isArray(state.quaternion) ||
              state.quaternion.length !== 4 ||
              !state.quaternion.every(Number.isFinite)
            ) {
              missingInputs.push('initialState.quaternion [qw, qx, qy, qz]');
            }
          } else {
            missingInputs.push(`initialState.${key}`);
          }
        }
      }
    }
    if (!Number.isFinite(params.massKg) || params.massKg <= 0) missingInputs.push('massKg');
    if (
      !Array.isArray(params.inertiaKgM2) ||
      params.inertiaKgM2.length !== 3 ||
      !params.inertiaKgM2.every(Number.isFinite)
    ) {
      missingInputs.push('inertiaKgM2 [Ixx, Iyy, Izz]');
    } else if (params.inertiaKgM2.some((value) => value <= 0)) {
      missingInputs.push('positive inertiaKgM2 components');
    }
    if (!Number.isFinite(params.dt) || params.dt <= 0) missingInputs.push('dt > 0');
    if (!Number.isInteger(params.steps) || params.steps <= 0) missingInputs.push('positive integer steps');

    const gravityModel = params.gravityModel === 'constant' ? 'constant' : 'inverse-square';

    const thrustError = this._validateThrust(params.thrust);
    if (thrustError) missingInputs.push(thrustError);

    const coefficientsError = this._validateCoefficientTable(params.coefficients);
    if (coefficientsError) missingInputs.push(coefficientsError);

    if (params.coefficients) {
      if (!Number.isFinite(params.referenceAreaM2) || params.referenceAreaM2 <= 0)
        missingInputs.push('referenceAreaM2');
      if (!Number.isFinite(params.referenceLengthM) || params.referenceLengthM <= 0)
        missingInputs.push('referenceLengthM');
    }
    if (missingInputs.length > 0) return this.invalidInput(op, missingInputs);

    const r0 = [...state.positionM];
    const v0 = [...state.velocityM_s];
    const q0 = [...state.quaternion];
    const omega0 = [...state.angularRateRad_s];
    const q0Norm = quatNorm(q0);
    if (Math.abs(q0Norm - 1) > 1e-6) missingInputs.push('unit initialState.quaternion');
    if (missingInputs.length > 0) return this.invalidInput(op, missingInputs);
    if (gravityModel === 'inverse-square' && Math.hypot(r0[0], r0[1], r0[2]) < R_EARTH) {
      return this.invalidInput(op, [
        'initialState.positionM outside Earth (|r| >= R_EARTH) for inverse-square gravity'
      ]);
    }

    const mass = params.massKg;
    const Ixx = params.inertiaKgM2[0];
    const Iyy = params.inertiaKgM2[1];
    const Izz = params.inertiaKgM2[2];
    const J = [Ixx, Iyy, Izz];
    const Jinv = [1 / Ixx, 1 / Iyy, 1 / Izz];

    const dt = params.dt;
    const steps = params.steps;
    const refArea = params.referenceAreaM2 || 0;
    const refLength = params.referenceLengthM || 0;

    const thrustProfile = Array.isArray(params.thrust) ? params.thrust : null;
    const thrustConst = thrustProfile ? null : params.thrust || null;
    const thrustFallbackDir = params.thrustDirectionBody || this.defaultDirectionBody;

    const solveThrust = (t) => {
      if (!thrustConst && !thrustProfile) return null;
      if (thrustConst) {
        const mag = thrustConst.magnitudeN;
        const dir = thrustConst.directionBody || thrustFallbackDir;
        const norm = Math.hypot(dir[0], dir[1], dir[2]);
        return { magnitudeN: mag, directionBody: [dir[0] / norm, dir[1] / norm, dir[2] / norm] };
      }
      if (t <= thrustProfile[0].timeS) return this._thrustAtPoint(thrustProfile[0], thrustFallbackDir);
      const last = thrustProfile[thrustProfile.length - 1];
      if (t >= last.timeS) return this._thrustAtPoint(last, thrustFallbackDir);
      for (let k = 1; k < thrustProfile.length; k++) {
        const upper = thrustProfile[k];
        if (t <= upper.timeS) {
          const lower = thrustProfile[k - 1];
          const f = (t - lower.timeS) / (upper.timeS - lower.timeS);
          const mag = lower.magnitudeN + f * (upper.magnitudeN - lower.magnitudeN);
          let dir;
          if (lower.directionBody && upper.directionBody) {
            dir = [
              lower.directionBody[0] + f * (upper.directionBody[0] - lower.directionBody[0]),
              lower.directionBody[1] + f * (upper.directionBody[1] - lower.directionBody[1]),
              lower.directionBody[2] + f * (upper.directionBody[2] - lower.directionBody[2])
            ];
          } else {
            dir = (upper.directionBody || lower.directionBody || thrustFallbackDir).slice();
          }
          const norm = Math.hypot(dir[0], dir[1], dir[2]);
          return { magnitudeN: mag, directionBody: [dir[0] / norm, dir[1] / norm, dir[2] / norm] };
        }
      }
      return this._thrustAtPoint(last, thrustFallbackDir);
    };

    const altitudeOf = (r) => (gravityModel === 'constant' ? r[2] : Math.hypot(r[0], r[1], r[2]) - R_EARTH);

    const derivatives = (t, y) => {
      const r = [y[0], y[1], y[2]];
      const v = [y[3], y[4], y[5]];
      const q = [y[6], y[7], y[8], y[9]];
      const w = [y[10], y[11], y[12]];

      let ax = 0;
      let ay = 0;
      let az = 0;
      if (gravityModel === 'constant') {
        az = -G0;
      } else {
        const rMag = Math.hypot(r[0], r[1], r[2]);
        const inv = MU_EARTH / (rMag * rMag * rMag);
        ax = -inv * r[0];
        ay = -inv * r[1];
        az = -inv * r[2];
      }

      const thrust = solveThrust(t);
      if (thrust) {
        const fBody = [
          thrust.magnitudeN * thrust.directionBody[0],
          thrust.magnitudeN * thrust.directionBody[1],
          thrust.magnitudeN * thrust.directionBody[2]
        ];
        const fInertial = quatRotate(q, fBody);
        ax += fInertial[0] / mass;
        ay += fInertial[1] / mass;
        az += fInertial[2] / mass;
      }

      let Mx = 0;
      let My = 0;
      let Mz = 0;
      if (params.coefficients) {
        const altitude = altitudeOf(r);
        const atm = standardAtmosphere1976(altitude);
        if (atm) {
          const vBody = quatRotate(quatConj(q), v);
          const V = Math.hypot(vBody[0], vBody[1], vBody[2]);
          if (V > 1e-9 && atm.densityKgM3 > 0) {
            const alpha = Math.atan2(vBody[2], vBody[0]);
            const beta = Math.asin(Math.max(-1, Math.min(1, vBody[1] / V)));
            const mach = V / atm.speedOfSoundM_s;
            const alphaDeg = (alpha * 180) / Math.PI;
            const cl = bilinearCoef(
              {
                alphaDeg: params.coefficients.alphaDeg,
                mach: params.coefficients.mach,
                values: params.coefficients.cl
              },
              alphaDeg,
              mach
            );
            const cd = bilinearCoef(
              {
                alphaDeg: params.coefficients.alphaDeg,
                mach: params.coefficients.mach,
                values: params.coefficients.cd
              },
              alphaDeg,
              mach
            );
            const cm = bilinearCoef(
              {
                alphaDeg: params.coefficients.alphaDeg,
                mach: params.coefficients.mach,
                values: params.coefficients.cm
              },
              alphaDeg,
              mach
            );
            const qbar = 0.5 * atm.densityKgM3 * V * V;
            const L = qbar * refArea * cl;
            const D = qbar * refArea * cd;
            const eL = [Math.sin(alpha), 0, -Math.cos(alpha)];
            const fAeroBody = [
              -D * (vBody[0] / V) + L * eL[0],
              -D * (vBody[1] / V) + L * eL[1],
              -D * (vBody[2] / V) + L * eL[2]
            ];
            const fAeroInertial = quatRotate(q, fAeroBody);
            ax += fAeroInertial[0] / mass;
            ay += fAeroInertial[1] / mass;
            az += fAeroInertial[2] / mass;
            My = qbar * refArea * refLength * cm;
          }
        }
      }

      const h = cross3(w, [J[0] * w[0], J[1] * w[1], J[2] * w[2]]);
      const wDot = [Jinv[0] * (Mx - h[0]), Jinv[1] * (My - h[1]), Jinv[2] * (Mz - h[2])];

      const qDot = quatMul(q, [0, w[0], w[1], w[2]]);
      return [
        v[0],
        v[1],
        v[2],
        ax,
        ay,
        az,
        0.5 * qDot[0],
        0.5 * qDot[1],
        0.5 * qDot[2],
        0.5 * qDot[3],
        wDot[0],
        wDot[1],
        wDot[2]
      ];
    };

    const y0 = [r0[0], r0[1], r0[2], v0[0], v0[1], v0[2], q0[0], q0[1], q0[2], q0[3], omega0[0], omega0[1], omega0[2]];

    let trajectory;
    try {
      trajectory = ODESolvers.solveRK4(derivatives, 0, y0, dt, steps);
    } catch (err) {
      return this.numericalFailure(op, `RK4 integration failed: ${err.message}`);
    }

    const samples = trajectory.map((sample) => {
      const r = [sample.y[0], sample.y[1], sample.y[2]];
      const v = [sample.y[3], sample.y[4], sample.y[5]];
      const q = [sample.y[6], sample.y[7], sample.y[8], sample.y[9]];
      const w = [sample.y[10], sample.y[11], sample.y[12]];
      const altitude = altitudeOf(r);
      const atm = standardAtmosphere1976(altitude);
      const speed = Math.hypot(v[0], v[1], v[2]);
      const mach = atm && atm.speedOfSoundM_s > 0 ? speed / atm.speedOfSoundM_s : 0;
      return {
        timeS: sample.t,
        positionM: [r[0], r[1], r[2]],
        velocityM_s: [v[0], v[1], v[2]],
        quaternion: [q[0], q[1], q[2], q[3]],
        angularRateRad_s: [w[0], w[1], w[2]],
        altitudeM: altitude,
        machNumber: mach,
        dynamicPressurePa: atm ? 0.5 * atm.densityKgM3 * speed * speed : 0,
        densityKgM3: atm ? atm.densityKgM3 : 0,
        temperatureK: atm ? atm.temperatureK : 0
      };
    });

    let statesFinite = true;
    let quaternionDriftMax = 0;
    let maxSpeed = 0;
    let maxAngularRate = 0;
    for (const sample of samples) {
      const allFinite = sample.positionM
        .concat(sample.velocityM_s, sample.quaternion, sample.angularRateRad_s)
        .every(Number.isFinite);
      if (!allFinite) {
        statesFinite = false;
        break;
      }
      quaternionDriftMax = Math.max(quaternionDriftMax, Math.abs(quatNorm(sample.quaternion) - 1));
      maxSpeed = Math.max(maxSpeed, Math.hypot(sample.velocityM_s[0], sample.velocityM_s[1], sample.velocityM_s[2]));
      maxAngularRate = Math.max(
        maxAngularRate,
        Math.hypot(sample.angularRateRad_s[0], sample.angularRateRad_s[1], sample.angularRateRad_s[2])
      );
    }
    if (!statesFinite) {
      return this.numericalFailure(op, 'non-finite state detected in trajectory');
    }
    const energyOf = (sample) => {
      const r = sample.positionM;
      const v = sample.velocityM_s;
      if (gravityModel === 'constant') {
        return 0.5 * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) + G0 * r[2];
      }
      const rMag = Math.hypot(r[0], r[1], r[2]);
      return 0.5 * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) - MU_EARTH / rMag;
    };
    const energyStart = energyOf(samples[0]);
    const energyEnd = energyOf(samples[samples.length - 1]);

    const events = { apogee: null, impact: null };
    for (let k = 0; k < samples.length - 1; k++) {
      const a = samples[k];
      const b = samples[k + 1];
      if (!events.apogee && a.velocityM_s[2] > 0 && b.velocityM_s[2] <= 0) {
        const f = a.velocityM_s[2] / (a.velocityM_s[2] - b.velocityM_s[2]);
        const tEvent = a.timeS + f * dt;
        const altEvent = a.altitudeM + f * (b.altitudeM - a.altitudeM);
        const vEvent = a.velocityM_s[2] + f * (b.velocityM_s[2] - a.velocityM_s[2]);
        events.apogee = {
          detected: true,
          timeS: tEvent,
          altitudeM: altEvent,
          velocityM_s: vEvent,
          stepIndex: k
        };
      }
      if (!events.impact && a.altitudeM > 0 && b.altitudeM <= 0) {
        const f = a.altitudeM / (a.altitudeM - b.altitudeM);
        const tEvent = a.timeS + f * dt;
        const position = [
          a.positionM[0] + f * (b.positionM[0] - a.positionM[0]),
          a.positionM[1] + f * (b.positionM[1] - a.positionM[1]),
          a.positionM[2] + f * (b.positionM[2] - a.positionM[2])
        ];
        const velocity = [
          a.velocityM_s[0] + f * (b.velocityM_s[0] - a.velocityM_s[0]),
          a.velocityM_s[1] + f * (b.velocityM_s[1] - a.velocityM_s[1]),
          a.velocityM_s[2] + f * (b.velocityM_s[2] - a.velocityM_s[2])
        ];
        events.impact = {
          detected: true,
          timeS: tEvent,
          altitudeM: position[2],
          positionM: position,
          velocityM_s: velocity,
          stepIndex: k
        };
      }
    }

    const last = samples[samples.length - 1];
    return {
      success: true,
      status: 'computed',
      validationLevel: 'experimental',
      inputs: {
        gravityModel,
        massKg: mass,
        inertiaKgM2: [Ixx, Iyy, Izz],
        dt,
        steps,
        referenceAreaM2: refArea,
        referenceLengthM: refLength,
        coefficientTable: params.coefficients
          ? { alphaDeg: params.coefficients.alphaDeg, mach: params.coefficients.mach }
          : null,
        thrustType: thrustConst ? 'constant' : thrustProfile ? 'profile' : 'none'
      },
      assumptions: [
        'Rigid body; diagonal inertia tensor (zero products of inertia); no propellant depletion (constant mass)',
        `Gravity model: ${gravityModel === 'constant' ? 'flat-earth constant g0 = 9.80665 m/s^2' : 'inverse-square central field mu = 3.986004418e14 m^3/s^2'}`,
        'US Standard Atmosphere 1976 (0-86 km) for density/temperature/sound speed; above 86 km treated as vacuum',
        'Aerodynamic CL/CD/Cm table is bilinearly interpolated over angle of attack and Mach with clamped edges; no rotation derivatives, wind, or aeroelastic coupling',
        'Thrust acts through the center of gravity (no thrust moment); direction is in the body frame',
        'Fixed-step RK4 (ODESolvers.solveRK4) with post-hoc stability and event detection on sampled states'
      ],
      initialState: {
        positionM: [r0[0], r0[1], r0[2]],
        velocityM_s: [v0[0], v0[1], v0[2]],
        quaternion: [q0[0], q0[1], q0[2], q0[3]],
        angularRateRad_s: omega0
      },
      finalState: {
        positionM: last.positionM,
        velocityM_s: last.velocityM_s,
        quaternion: last.quaternion,
        angularRateRad_s: last.angularRateRad_s
      },
      events,
      stability: {
        statesFinite: true,
        quaternionNormDriftMax: quaternionDriftMax,
        quaternionNormDriftTol: this.defaultQuaternionDriftTol,
        maxSpeedM_s: maxSpeed,
        maxAngularRateRad_s: maxAngularRate,
        specificEnergyStartJ_Kg: energyStart,
        specificEnergyEndJ_Kg: energyEnd,
        energyChangeJ_Kg: energyEnd - energyStart
      },
      trajectory: samples
    };
  }

  _thrustAtPoint(point, fallbackDir) {
    const dir = point.directionBody || fallbackDir;
    const norm = Math.hypot(dir[0], dir[1], dir[2]);
    return { magnitudeN: point.magnitudeN, directionBody: [dir[0] / norm, dir[1] / norm, dir[2] / norm] };
  }
}

module.exports = {
  SixDofDynamics,
  standardAtmosphere1976,
  bilinearCoef,
  quatMul,
  quatRotate,
  ATM
};
