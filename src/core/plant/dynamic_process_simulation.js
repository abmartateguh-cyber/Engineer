/**
 * OmniEng Dynamic Process Simulation: pressure-driven network with compressor
 * anti-surge control.
 *
 * Topology (single recycle loop):
 *
 *   feed --> suction vessel --> compressor --> discharge vessel --> main pipe --> sink
 *                                      ^                                |
 *                                      +--------- recycle valve ---------+
 *
 * Models:
 *   - Vessel: ideal-gas pressure dynamics dP/dt = (R_spec T / V)(sum in - sum out),
 *     with optional liquid holdup state (no liquid streams in this network, so
 *     holdup is conserved and remains constant).
 *   - Valve:  Q = x * Cv * sqrt(max(dP, 0))   (orifice-style).
 *   - Pipe:   dP = k Q^2, so Q = sqrt(max(dP,0)/k).
 *   - Compressor performance curve at speed N (fan-law scaling):
 *       Q_c(N, H) = N * qMax * max(0, 1 - H / (hShut N^2)),  H = P_d - P_s.
 *   - Surge line: Q_surge(N) = a N (linear in speed); surge margin
 *       M = (Q_c - Q_surge) / Q_surge.
 *   - Anti-surge PID (position form, output-limited to [0,1]) positions the
 *     recycle valve so that M stays above the threshold. The valve has a
 *     first-order actuator lag (dx/dt = (u - x)/tau) so its position moves
 *     smoothly toward the controller demand.
 *
 * Time integration: first-order implicit Euler on the pressure network, solved
 * each step by Newton iteration with a finite-difference Jacobian. The control
 * output is held during the step (zero-order hold) and updated from the state
 * measured at the start of the step. Pure, deterministic, no external deps.
 */

'use strict';

const DEFAULT = {
  gasConstantJPerKgK: 519.0, // methane, J/(kg K)
  temperatureK: 300.0,
  newtonTolPa: 1e-3,
  newtonMaxIter: 40
};

class DynamicProcessSimulator {
  /**
   * @param {Object} [options]
   * @param {number} [options.suctionVolume=2.0]      m^3
   * @param {number} [options.suctionPressure0=1.2e5] Pa
   * @param {number} [options.suctionHoldup0=0]       m^3 liquid
   * @param {number} [options.dischargeVolume=8.0]    m^3
   * @param {number} [options.dischargePressure0=3.6e5] Pa
   * @param {number} [options.dischargeHoldup0=0]     m^3 liquid
   * @param {number} [options.feedFlow=12.0]          kg/s into suction vessel
   * @param {number} [options.sinkPressure=1.01325e5] Pa
   * @param {number} [options.processPipeK=1796.3541667] Pa/(kg/s)^2
   * @param {number} [options.compressorQMax=20.0]    kg/s at N=1, zero head
   * @param {number} [options.compressorHShut=6.0e5] Pa shutoff head at N=1
   * @param {number} [options.surgeSlope=8.0]         kg/s per unit speed
   * @param {number} [options.recycleValveCv=0.05]    kg/s per sqrt(Pa)
   * @param {boolean} [options.controllerEnabled=true]
   * @param {number} [options.surgeThreshold=0.10]    margin setpoint
   * @param {number} [options.kp=40.0]                proportional gain
   * @param {number} [options.ki=2.0]                 integral gain (1/s)
   * @param {number} [options.kd=0.05]                derivative gain (s)
   * @param {number} [options.actuatorTimeConstant=0.03] s, recycle valve lag
   */
  constructor(options = {}) {
    this.R = options.gasConstantJPerKgK !== undefined ? options.gasConstantJPerKgK : DEFAULT.gasConstantJPerKgK;
    this.T = options.temperatureK !== undefined ? options.temperatureK : DEFAULT.temperatureK;

    this.Vs = options.suctionVolume !== undefined ? options.suctionVolume : 2.0;
    this.Vd = options.dischargeVolume !== undefined ? options.dischargeVolume : 8.0;
    this.pS = options.suctionPressure0 !== undefined ? options.suctionPressure0 : 1.2e5;
    this.pD = options.dischargePressure0 !== undefined ? options.dischargePressure0 : 3.6e5;
    this.holdupS = options.suctionHoldup0 !== undefined ? options.suctionHoldup0 : 0.0;
    this.holdupD = options.dischargeHoldup0 !== undefined ? options.dischargeHoldup0 : 0.0;

    this.feedFlow = options.feedFlow !== undefined ? options.feedFlow : 12.0;
    this.pSink = options.sinkPressure !== undefined ? options.sinkPressure : 1.01325e5;
    this.pipeK = options.processPipeK !== undefined ? options.processPipeK : 1796.3541667;

    this.qMax = options.compressorQMax !== undefined ? options.compressorQMax : 20.0;
    this.hShut = options.compressorHShut !== undefined ? options.compressorHShut : 6.0e5;
    this.surgeSlope = options.surgeSlope !== undefined ? options.surgeSlope : 8.0;

    this.recycleCv = options.recycleValveCv !== undefined ? options.recycleValveCv : 0.05;

    this.controllerEnabled = options.controllerEnabled !== undefined ? options.controllerEnabled : true;
    this.threshold = options.surgeThreshold !== undefined ? options.surgeThreshold : 0.1;
    this.kp = options.kp !== undefined ? options.kp : 40.0;
    this.ki = options.ki !== undefined ? options.ki : 2.0;
    this.kd = options.kd !== undefined ? options.kd : 0.05;
    this.actuatorTau = options.actuatorTimeConstant !== undefined ? options.actuatorTimeConstant : 0.03;

    this.newtonTol = options.newtonTolPa !== undefined ? options.newtonTolPa : DEFAULT.newtonTolPa;
    this.newtonMaxIter = options.newtonMaxIter !== undefined ? options.newtonMaxIter : DEFAULT.newtonMaxIter;

    this.xRC = 0.0;
    this.uDemand = 0.0;
    this.prevMargin = null;
    this.I = 0.0;
  }

  /** Compressor flow at speed N given suction/discharge pressures. */
  _qCompressorAt(N, pS, pD) {
    const H = Math.max(0.0, pD - pS);
    const denom = this.hShut * N * N;
    const factor = denom > 0.0 ? 1.0 - H / denom : 1.0;
    return Math.max(0.0, N * this.qMax * factor);
  }

  /** Recycle valve flow at opening x given pressures. */
  _qRecycleAt(x, pD, pS) {
    const dP = Math.max(0.0, pD - pS);
    return x * this.recycleCv * Math.sqrt(dP);
  }

  /** Main process pipe flow given discharge pressure. */
  _qProcessAt(pD) {
    return Math.sqrt(Math.max(0.0, pD - this.pSink) / this.pipeK);
  }

  /** Surge margin from compressor flow and speed. */
  margin(N, qC) {
    const qS = this.surgeSlope * N;
    if (qS <= 0.0) return 0.0;
    return (qC - qS) / qS;
  }

  /** Current surge margin at stored state. */
  currentMargin(N) {
    return this.margin(N, this._qCompressorAt(N, this.pS, this.pD));
  }

  /**
   * Pressure-network residual for implicit Euler.
   * Returns [rS, rD] in Pa.
   */
  _residual(pS, pD, pSOld, pDOld, dt, N, xRC) {
    const qC = this._qCompressorAt(N, pS, pD);
    const qRC = this._qRecycleAt(xRC, pD, pS);
    const qP = this._qProcessAt(pD);
    const kS = (this.R * this.T) / this.Vs;
    const kD = (this.R * this.T) / this.Vd;
    const rS = pS - pSOld - dt * kS * (this.feedFlow - qC + qRC);
    const rD = pD - pDOld - dt * kD * (qC - qP - qRC);
    return [rS, rD];
  }

  /**
   * Advance one implicit-Euler step with Newton iteration on [pS, pD].
   * Controller output xRC is held constant during the step.
   *
   * @param {number} dt  step size (s)
   * @param {number} N   compressor speed at end of step
   * @param {number} xRC recycle valve opening held during the step
   */
  step(dt, N, xRC) {
    const pSOld = this.pS;
    const pDOld = this.pD;

    let pS = pSOld;
    let pD = pDOld;
    const eps = 1e-6;

    for (let iter = 0; iter < this.newtonMaxIter; iter++) {
      const [rS, rD] = this._residual(pS, pD, pSOld, pDOld, dt, N, xRC);
      if (Math.max(Math.abs(rS), Math.abs(rD)) <= this.newtonTol) break;

      // Finite-difference Jacobian (2x2).
      const hS = Math.max(Math.abs(pS), 1.0) * eps;
      const hD = Math.max(Math.abs(pD), 1.0) * eps;
      const [rSS, rDS] = this._residual(pS + hS, pD, pSOld, pDOld, dt, N, xRC);
      const [rSD, rDD] = this._residual(pS, pD + hD, pSOld, pDOld, dt, N, xRC);
      const J11 = (rSS - rS) / hS;
      const J21 = (rDS - rD) / hS;
      const J12 = (rSD - rS) / hD;
      const J22 = (rDD - rD) / hD;

      const det = J11 * J22 - J12 * J21;
      if (Math.abs(det) < 1e-20) break;

      const dS = (rS * J22 - rD * J12) / det;
      const dD = (rD * J11 - rS * J21) / det;
      pS -= dS;
      pD -= dD;
    }

    this.pS = pS;
    this.pD = pD;
  }

  /**
   * Position-form PID update of the recycle valve.
   *
   *   u = clamp( Kp e + Ki I + Kd de/dt, 0, 1 ),  e = threshold - margin
   *
   * The integrator I only accumulates while the valve demand is not saturated
   * full (or while the error is non-positive) and is clamped to [0, oo), so
   * the loop cannot wind up. Because e > 0 exactly when margin < threshold, the
   * valve demand becomes positive precisely as the margin falls below the
   * threshold.
   *
   * @param {number} margin current surge margin
   * @param {number} dt controller sample time (s)
   * @returns {number} new valve demand in [0, 1]
   */
  _updateController(margin, dt) {
    if (!this.controllerEnabled) {
      this.prevMargin = margin;
      this.uDemand = 0.0;
      this.I = 0.0;
      return this.uDemand;
    }
    const e = this.threshold - margin;
    if (this.uDemand < 1.0 || e <= 0.0) this.I += e * dt;
    if (this.I < 0.0) this.I = 0.0;
    const prevE = this.prevMargin !== null ? this.threshold - this.prevMargin : e;
    const dErr = dt > 0.0 ? (e - prevE) / dt : 0.0;
    const u = this.kp * e + this.ki * this.I + this.kd * dErr;
    this.uDemand = Math.max(0.0, Math.min(1.0, u));
    this.prevMargin = margin;
    return this.uDemand;
  }

  /**
   * Run a simulation.
   *
   * @param {Object} opts
   * @param {number} [opts.duration=8.0]  seconds
   * @param {number} [opts.dt=0.01]       seconds
   * @param {Function} [opts.speedFn]     (t) => speed N(t); default constant 1
   * @returns {Array<Object>} trajectory records:
   *   { t, N, pS, pD, qC, qProcess, qRC, xRC, xDemand, margin, mc }
   *   xRC is the recycle valve position used during the step, xDemand the
   *   controller demand for the next step, margin the post-step surge margin,
   *   and mc the margin measured at the decision time (start of the step).
   */
  run(opts = {}) {
    const duration = opts.duration !== undefined ? opts.duration : 8.0;
    const dt = opts.dt !== undefined ? opts.dt : 0.01;
    const speedFn = opts.speedFn || (() => 1.0);

    const records = [];
    let t = 0.0;

    this.xRC = 0.0;
    this.uDemand = 0.0;
    this.prevMargin = null;
    this.I = 0.0;

    for (;;) {
      const N = speedFn(t);
      const qC = this._qCompressorAt(N, this.pS, this.pD);
      const m = this.margin(N, qC);
      this._updateController(m, dt);

      const xHeld = this.xRC;
      this.step(dt, speedFn(t + dt), xHeld);
      this.holdupS += 0.0;
      this.holdupD += 0.0;

      const xNext = (xHeld + (dt / this.actuatorTau) * this.uDemand) / (1.0 + dt / this.actuatorTau);
      this.xRC = Math.max(0.0, Math.min(1.0, xNext));

      const NEnd = speedFn(t + dt);
      const qCEnd = this._qCompressorAt(NEnd, this.pS, this.pD);
      const mEnd = this.margin(NEnd, qCEnd);
      const qPEnd = this._qProcessAt(this.pD);
      const qRCEnd = this._qRecycleAt(xHeld, this.pD, this.pS);

      records.push({
        t: t + dt,
        N: NEnd,
        pS: this.pS,
        pD: this.pD,
        qC: qCEnd,
        qProcess: qPEnd,
        qRC: qRCEnd,
        xRC: xHeld,
        xDemand: this.uDemand,
        margin: mEnd,
        mc: m
      });

      t += dt;
      if (t + dt > duration + 1e-9) break;
    }

    return records;
  }
}

/**
 * Analytic steady-state solution of the network at speed N = 1 with the
 * recycle valve closed:
 *
 *   F = Q_c = Q_process
 *   H = P_d - P_s = hShut (1 - F / qMax)
 *   P_d = P_sink + k F^2
 *   P_s = P_d - H
 *   margin = (F - a) / a
 *
 * @param {Object} opts same constructor options as DynamicProcessSimulator
 * @returns {Object} { pS, pD, qC, qProcess, qRC, margin, H }
 */
function analyticSteadyState(opts = {}) {
  const qMax = opts.compressorQMax !== undefined ? opts.compressorQMax : 20.0;
  const hShut = opts.compressorHShut !== undefined ? opts.compressorHShut : 6.0e5;
  const surgeSlope = opts.surgeSlope !== undefined ? opts.surgeSlope : 8.0;
  const feed = opts.feedFlow !== undefined ? opts.feedFlow : 12.0;
  const pSink = opts.sinkPressure !== undefined ? opts.sinkPressure : 1.01325e5;
  const k = opts.processPipeK !== undefined ? opts.processPipeK : 1796.3541667;

  const qC = feed;
  const H = hShut * (1.0 - qC / qMax);
  const pD = pSink + k * qC * qC;
  const pS = pD - H;
  return {
    pS,
    pD,
    qC,
    qProcess: qC,
    qRC: 0.0,
    margin: (qC - surgeSlope) / surgeSlope,
    H
  };
}

module.exports = {
  DynamicProcessSimulator,
  analyticSteadyState
};
