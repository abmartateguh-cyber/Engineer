/**
 * 5-Axis Machine Kinematic Digital Twin Simulator.
 *
 * Implements a kinematic digital twin of a Table-Table AC trunnion 5-axis
 * machine tool:
 *
 * 1. Machine kinematics:
 *    - Forward: P_machine = R_A · R_C · P_work + T, where T = (X, Y, Z) are
 *      the linear axis positions, R_C is the rotary-table rotation about the
 *      machine Z axis (C), and R_A is the trunnion tilt about the machine X
 *      axis (A). The tool axis maps identically: u_machine = R_A · R_C ·
 *      u_work.
 *    - Inverse (RTCP): given a programmed tool tip point P_work and a unit
 *      tool axis vector u_work = (i, j, k) in workpiece coordinates, compute
 *      the machine axes (X, Y, Z, A, C) such that the tool tip remains on the
 *      programmed point and the tool axis aligns with the machine Z axis:
 *        A = atan2(sqrt(i^2 + j^2), k)
 *        C = atan2(i, j)
 *        T = R_A · R_C · P_work
 *      Round-trip recovery is exact: P_work = R^T · T and
 *      u_work = R^T · (0, 0, 1).
 *
 * 2. Axis limits: travel ranges, maximum velocity, and maximum acceleration
 *    for each axis (X/Y/Z in mm, mm/s, mm/s^2; A/C in deg, deg/s, deg/s^2).
 *
 * 3. Trajectory check: given a G-code-like path (a list of commands carrying
 *    target coordinates and feedrates), simulate the axis motion using simple
 *    trapezoidal motion profiles and flag:
 *    - over-travel (axis target outside its travel range),
 *    - over-velocity (required axis velocity exceeds the axis maximum),
 *    - over-acceleration (required axis acceleration exceeds the axis maximum).
 *
 * The simulation is deterministic and dependency-free.
 */

'use strict';

const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;

const AXIS_KEYS = ['x', 'y', 'z', 'a', 'c'];
const LINEAR_AXIS_KEYS = ['x', 'y', 'z'];

const DEFAULT_AXES = {
  x: { min: -600, max: 600, vMax: 333.3333, aMax: 4000 },
  y: { min: -450, max: 450, vMax: 333.3333, aMax: 4000 },
  z: { min: -400, max: 400, vMax: 333.3333, aMax: 4000 },
  a: { min: -120, max: 120, vMax: 20, aMax: 500 },
  c: { min: -360, max: 360, vMax: 40, aMax: 600 }
};

function matVec(M, v) {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]
  ];
}

function matMul(A, B) {
  const C = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
  }
  return C;
}

function matTranspose(M) {
  return [
    [M[0][0], M[1][0], M[2][0]],
    [M[0][1], M[1][1], M[2][1]],
    [M[0][2], M[1][2], M[2][2]]
  ];
}

function rotZ(thetaRad) {
  const c = Math.cos(thetaRad);
  const s = Math.sin(thetaRad);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1]
  ];
}

function rotX(alphaRad) {
  const c = Math.cos(alphaRad);
  const s = Math.sin(alphaRad);
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c]
  ];
}

class MachineSimulationDigitalTwin {
  constructor(options = {}) {
    this.axes = {};
    for (const key of AXIS_KEYS) {
      const configured = (options.axes || {})[key] || {};
      this.axes[key] = {
        min: configured.min !== undefined ? configured.min : DEFAULT_AXES[key].min,
        max: configured.max !== undefined ? configured.max : DEFAULT_AXES[key].max,
        vMax: configured.vMax !== undefined ? configured.vMax : DEFAULT_AXES[key].vMax,
        aMax: configured.aMax !== undefined ? configured.aMax : DEFAULT_AXES[key].aMax
      };
      if (!(this.axes[key].min <= this.axes[key].max)) {
        throw new TypeError(`MachineSimulationDigitalTwin: invalid travel range for axis '${key}'`);
      }
      if (!(this.axes[key].vMax > 0 && this.axes[key].aMax > 0)) {
        throw new TypeError(`MachineSimulationDigitalTwin: non-positive limit for axis '${key}'`);
      }
    }
  }

  _rotationMatrix(aDeg, cDeg) {
    return matMul(rotX(aDeg * DEG2RAD), rotZ(cDeg * DEG2RAD));
  }

  _normalize(vec) {
    const len = Math.hypot(vec[0], vec[1], vec[2]);
    if (len < 1e-15) {
      return [0, 0, 1];
    }
    return [vec[0] / len, vec[1] / len, vec[2] / len];
  }

  /**
   * Forward kinematics: map a workpiece point and tool axis vector to machine
   * coordinates via the rotary table transform (Table-Table AC trunnion).
   *
   * P_machine = R_A · R_C · P_work + T, with T = (X, Y, Z).
   *
   * @param {Object} pose Machine pose { x, y, z, a, c } with A/C in degrees.
   * @param {Array<number>} workpiecePoint [x, y, z] in workpiece coordinates.
   * @param {Array<number>} [workpieceAxis] Tool axis vector in workpiece coordinates.
   * @returns {Object} { point: [x, y, z] (machine), axis: [i, j, k] (machine), matrix }
   */
  forwardKinematics(pose, workpiecePoint, workpieceAxis) {
    const R = this._rotationMatrix(pose.a, pose.c);
    const point = matVec(R, workpiecePoint);
    point[0] += pose.x;
    point[1] += pose.y;
    point[2] += pose.z;
    let axis = null;
    if (workpieceAxis) {
      axis = matVec(R, this._normalize(workpieceAxis));
    }
    return { point, axis, matrix: R };
  }

  /**
   * Inverse kinematics (RTCP): given a programmed tool tip point and tool axis
   * vector in workpiece coordinates, compute the machine axes (X, Y, Z, A, C)
   * such that the tool tip remains on the programmed point.
   *
   * @param {Array<number>} toolTipPoint [x, y, z] programmed point (workpiece).
   * @param {Array<number>} toolAxisVector [i, j, k] unit tool axis (workpiece).
   * @returns {Object} { x, y, z, aDeg, cDeg, aRad, cRad }
   */
  inverseKinematics(toolTipPoint, toolAxisVector) {
    const u = this._normalize(toolAxisVector);
    const [i, j, k] = u;
    const aRad = Math.atan2(Math.hypot(i, j), k);
    const cRad = Math.atan2(i, j);
    const R = matMul(rotX(aRad), rotZ(cRad));
    const t = matVec(R, toolTipPoint);
    return {
      x: t[0],
      y: t[1],
      z: t[2],
      aDeg: aRad * RAD2DEG,
      cDeg: cRad * RAD2DEG,
      aRad,
      cRad
    };
  }

  /**
   * Forward/inverse round trip: recover the workpiece pose from machine axes.
   *
   * @param {Array<number>} toolTipPoint Programmed point (workpiece).
   * @param {Array<number>} toolAxisVector Tool axis vector (workpiece).
   * @returns {Object} { point, axis, axes, error }
   */
  roundTrip(toolTipPoint, toolAxisVector) {
    const axes = this.inverseKinematics(toolTipPoint, toolAxisVector);
    const R = this._rotationMatrix(axes.aDeg, axes.cDeg);
    const Rt = matTranspose(R);
    const point = matVec(Rt, [axes.x, axes.y, axes.z]);
    const axis = matVec(Rt, [0, 0, 1]);
    const crossX = axis[1] * toolAxisVector[2] - axis[2] * toolAxisVector[1];
    const crossY = axis[2] * toolAxisVector[0] - axis[0] * toolAxisVector[2];
    const crossZ = axis[0] * toolAxisVector[1] - axis[1] * toolAxisVector[0];
    const crossNorm = Math.hypot(crossX, crossY, crossZ);
    const error = {
      pos: Math.hypot(point[0] - toolTipPoint[0], point[1] - toolTipPoint[1], point[2] - toolTipPoint[2]),
      ang: 2 * Math.asin(Math.min(1, Math.max(0, crossNorm / 2)))
    };
    return { point, axis, axes, error };
  }

  /**
   * Plan a single-axis trapezoidal motion profile.
   *
   * @param {number} start Start position (axis units).
   * @param {number} target Target position (axis units).
   * @param {number} tAvail Available time budget (seconds).
   * @param {number} vMax Axis maximum velocity (axis units / s).
   * @param {number} aMax Axis maximum acceleration (axis units / s^2).
   * @returns {Object} { tTotal, vPeak, phases }
   */
  _planProfile(start, target, tAvail, vMax, aMax) {
    const d = target - start;
    const ad = Math.abs(d);
    if (ad < 1e-12) {
      return { tTotal: tAvail, vPeak: 0, phases: [] };
    }
    const dir = d >= 0 ? 1 : -1;
    const tMin = 2 * Math.sqrt(ad / aMax);
    const triangular = {
      tTotal: tMin,
      vPeak: Math.sqrt(ad * aMax),
      phases: [
        { type: 'accel', t: tMin / 2, a: aMax * dir },
        { type: 'decel', t: tMin / 2, a: -aMax * dir }
      ]
    };
    if (tAvail < tMin) {
      return triangular;
    }
    const tAcc = vMax / aMax;
    const dAcc = (vMax * vMax) / aMax;
    if (ad < dAcc) {
      return triangular;
    }
    const tCruise = (ad - dAcc) / vMax;
    const tTotal = 2 * tAcc + tCruise;
    if (tTotal > tAvail) {
      return triangular;
    }
    return {
      tTotal,
      vPeak: vMax,
      phases: [
        { type: 'accel', t: tAcc, a: aMax * dir },
        { type: 'cruise', t: tCruise, a: 0 },
        { type: 'decel', t: tAcc, a: -aMax * dir }
      ]
    };
  }

  _sampleProfile(profile, start, count) {
    const samples = [];
    for (let i = 0; i <= count; i++) {
      const t = profile.tTotal * (i / count);
      let pos = start;
      let vel = 0;
      let tPrev = 0;
      for (const phase of profile.phases) {
        const tEnd = Math.min(t, tPrev + phase.t);
        const dt = Math.max(0, tEnd - tPrev);
        pos += vel * dt + 0.5 * phase.a * dt * dt;
        vel += phase.a * dt;
        tPrev = tEnd;
        if (tPrev >= t) {
          break;
        }
      }
      samples.push({ t, pos });
    }
    return samples;
  }

  /**
   * Simulate a G-code-like path and check axis limits.
   *
   * Each command is an object with target axis coordinates and an optional
   * feedrate (mm/min, G-code convention). Two input modes are supported:
   * - Machine coordinates (default): { x, y, z, a, c, feed } with A/C in
   *   degrees; omitted axes hold their previous value.
   * - RTCP workpiece coordinates (options.useRtcp = true):
   *   { px, py, pz, i, j, k, feed } where (px, py, pz) is the programmed tool
   *   tip point and (i, j, k) the tool axis; machine axes are computed via
   *   inverse kinematics.
   *
   * Violations are reported with the 1-based command index of the offending
   * command, so over-travel is caught before any G-code is emitted.
   *
   * @param {Array<Object>} path List of commands.
   * @param {Object} [options]
   * @param {Object} [options.startPose] Home pose { x, y, z, a, c }.
   * @param {boolean} [options.useRtcp=false] Interpret commands as workpiece RTCP moves.
   * @param {number} [options.feedDefault=3000] Feedrate when a command omits it.
   * @param {number} [options.sampleCount=64] Profile samples per segment per axis.
   * @returns {Object} { valid, violations, diagnostics, summary, profiles, commands, finalPose, totalTime }
   */
  simulatePath(path, options = {}) {
    const startPose = options.startPose || { x: 0, y: 0, z: 0, a: 0, c: 0 };
    const sampleCount = options.sampleCount !== undefined ? options.sampleCount : 64;
    const feedDefault = options.feedDefault !== undefined ? options.feedDefault : 3000;
    const useRtcp = !!options.useRtcp;

    let prev = {
      x: startPose.x || 0,
      y: startPose.y || 0,
      z: startPose.z || 0,
      a: startPose.a || 0,
      c: startPose.c || 0
    };

    const violations = [];
    const diagnostics = {};
    for (const key of AXIS_KEYS) {
      diagnostics[key] = { overTravel: [], overVelocity: [], overAcceleration: [] };
    }

    const commands = [];
    const profiles = {};
    for (const key of AXIS_KEYS) {
      profiles[key] = [];
    }
    const axisCursor = {};
    for (const key of AXIS_KEYS) {
      axisCursor[key] = 0;
    }

    for (let idx = 0; idx < path.length; idx++) {
      const cmd = path[idx];
      const commandIndex = idx + 1;

      let target;
      if (useRtcp) {
        const P = [
          cmd.px !== undefined ? cmd.px : prev.x,
          cmd.py !== undefined ? cmd.py : prev.y,
          cmd.pz !== undefined ? cmd.pz : prev.z
        ];
        const u = [cmd.i !== undefined ? cmd.i : 0, cmd.j !== undefined ? cmd.j : 0, cmd.k !== undefined ? cmd.k : 1];
        const ik = this.inverseKinematics(P, u);
        target = { x: ik.x, y: ik.y, z: ik.z, a: ik.aDeg, c: ik.cDeg };
      } else {
        target = {
          x: cmd.x !== undefined ? cmd.x : prev.x,
          y: cmd.y !== undefined ? cmd.y : prev.y,
          z: cmd.z !== undefined ? cmd.z : prev.z,
          a: cmd.a !== undefined ? cmd.a : prev.a,
          c: cmd.c !== undefined ? cmd.c : prev.c
        };
      }
      commands.push(target);

      for (const key of AXIS_KEYS) {
        const ax = this.axes[key];
        const value = target[key];
        if (value < ax.min || value > ax.max) {
          violations.push({ type: 'over_travel', axis: key, commandIndex, value, min: ax.min, max: ax.max });
          diagnostics[key].overTravel.push(commandIndex);
        }
      }

      const dx = target.x - prev.x;
      const dy = target.y - prev.y;
      const dz = target.z - prev.z;
      const da = target.a - prev.a;
      const dc = target.c - prev.c;
      const pathLength = Math.hypot(dx, dy, dz);
      const feedMmMin = cmd.feed !== undefined ? cmd.feed : feedDefault;
      let tSeg = null;
      if (pathLength > 1e-9 && feedMmMin > 0) {
        tSeg = pathLength / (feedMmMin / 60.0);
      }

      const deltas = { x: dx, y: dy, z: dz, a: da, c: dc };
      for (const key of AXIS_KEYS) {
        const d = deltas[key];
        if (Math.abs(d) < 1e-12 || tSeg === null) {
          continue;
        }
        const ax = this.axes[key];
        const vReq = Math.abs(d) / tSeg;
        if (vReq > ax.vMax + 1e-9) {
          violations.push({ type: 'over_velocity', axis: key, commandIndex, value: vReq, limit: ax.vMax });
          diagnostics[key].overVelocity.push(commandIndex);
        }
        const aReq = (4.0 * Math.abs(d)) / (tSeg * tSeg);
        if (aReq > ax.aMax + 1e-9) {
          violations.push({ type: 'over_acceleration', axis: key, commandIndex, value: aReq, limit: ax.aMax });
          diagnostics[key].overAcceleration.push(commandIndex);
        }
      }

      for (const key of AXIS_KEYS) {
        const ax = this.axes[key];
        const start = prev[key];
        const targetValue = target[key];
        const tAvail = tSeg !== null ? tSeg : 1e9;
        const profile = this._planProfile(start, targetValue, tAvail, ax.vMax, ax.aMax);
        const samples = this._sampleProfile(profile, start, sampleCount);
        const segmentStart = axisCursor[key];
        for (const s of samples) {
          s.t += segmentStart;
        }
        axisCursor[key] += profile.tTotal;
        profiles[key].push({ commandIndex, start, target: targetValue, tTotal: profile.tTotal, samples });
      }

      prev = target;
    }

    let totalTime = 0;
    for (const key of AXIS_KEYS) {
      totalTime = Math.max(totalTime, axisCursor[key]);
    }

    const summary = {
      overTravel: violations.filter((v) => v.type === 'over_travel').length,
      overVelocity: violations.filter((v) => v.type === 'over_velocity').length,
      overAcceleration: violations.filter((v) => v.type === 'over_acceleration').length
    };

    return {
      valid: violations.length === 0,
      violations,
      diagnostics,
      summary,
      profiles,
      commands,
      finalPose: prev,
      totalTime
    };
  }
}

module.exports = {
  MachineSimulationDigitalTwin,
  DEFAULT_AXES,
  AXIS_KEYS
};
