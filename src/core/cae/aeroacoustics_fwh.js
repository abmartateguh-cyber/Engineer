/**
 * Ffowcs Williams-Hawkings Aeroacoustics Engine (Farassat Formulation 1A).
 *
 * Time-domain acoustic analogy for sound radiated by a moving source surface
 * immersed in a quiescent medium. The acoustic pressure at the observer
 * p'(x,t) = p'_T(x,t) + p'_L(x,t) with:
 *
 *   Thickness (monopole) term, p'_T:
 *     ρ0/(4π) ∫_S [ ∂(v_n)/∂τ / (r (1−M_r)²)
 *                  + v_n (r Ṁ_r + c0 (M_r − M²)) / (r² (1−M_r)³) ] dS
 *
 *   Loading (dipole) term, p'_L:
 *     1/(4πc0) ∫_S [ ∂(l_r)/∂τ / (r (1−M_r)²)
 *                    + l_r (r Ṁ_r + c0 (M_r − M²)) / (r² (1−M_r)³) ] dS
 *
 * Symbols:
 *   x   observer position vector
 *   t   observer time
 *   y   source point on the surface at retarded time τ
 *   τ   retarded time, the solution of τ + |x − y(τ)|/c0 = t
 *   r   |x − y|, source-to-observer distance
 *   r̂   unit radiation direction (x − y)/r
 *   ρ0  freestream density
 *   c0  speed of sound
 *   v   local surface velocity vector
 *   v_n = v·n, surface normal velocity (n outward unit normal)
 *   M   = v/c0, local surface Mach vector, M² = |M|²
 *   M_r = v·r̂/c0, Mach number in the radiation direction
 *   Ṁ_r = dM_r/dτ
 *   l   aerodynamic loading per unit area on the surface (force density)
 *   l_r = l·r̂
 *
 * Verification modes:
 *   - Spherical propagation (compact source): point monopole with source
 *     strength rate Q̇(τ) (volume acceleration) radiates
 *     p'(r,t) = ρ0 Q̇(t − r/c0) / (4πr); a compact dipole with point force
 *     F(τ) radiates p'(r,t) = (1/(4πc0 r)) ∂F(t − r/c0)/∂t · e_r.
 *     Moving sources include the (1 − M_r)² convective factor.
 *   - Rotating dipole (drone propeller): a disk of N blades, each carrying a
 *     steady surface force and rotating at Ω, produces tonal loading noise at
 *     the blade-passing frequency BPF = N·Ω/(2π). A spectrum analysis (FFT)
 *     reports SPL, BPF localization and broadband floor.
 *
 * Deterministic and dependency-free (uses only the repo FFT module).
 */

'use strict';

const { fft1d } = require('../math/fft_spatial');

const TWO_PI = 2 * Math.PI;
const DEFAULT_RHO0 = 1.225;
const DEFAULT_C0 = 343.0;
const REF_PRESSURE = 2.0e-5;
const TOL_RETARDED = 1e-12;
const MAX_RETARDED_ITER = 16;

const STATIC_ORIGIN = {
  pos: () => [0, 0, 0],
  vel: () => [0, 0, 0],
  acc: () => [0, 0, 0]
};

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function norm(a) {
  return Math.sqrt(dot(a, a));
}

/**
 * Solve the retarded-time equation τ + |x − y(τ)|/c0 = t for the source
 * trajectory y(τ) by Newton iteration (subsonic: g' = 1 − M_r > 0).
 * Returns τ, or null when no causal retarded time exists (t before arrival).
 */
function solveRetardedTime(obs, src, t, c0) {
  let tau = t - norm(sub(obs, src.pos(t))) / c0;
  let r = 0;
  let resid = Infinity;
  for (let i = 0; i < MAX_RETARDED_ITER && Math.abs(resid) > TOL_RETARDED; i++) {
    const y = src.pos(tau);
    r = norm(sub(obs, y));
    resid = tau + r / c0 - t;
    const v = src.vel(tau);
    const mr = dot(v, sub(obs, y)) / (r * c0);
    const dg = 1 - mr;
    if (!Number.isFinite(dg) || Math.abs(dg) < 1e-12) break;
    const next = tau - resid / dg;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - tau) < 1e-15) {
      tau = next;
      break;
    }
    tau = next;
  }
  if (tau < -1e-9) return null;
  r = norm(sub(obs, src.pos(tau)));
  if (Math.abs(tau + r / c0 - t) > 1e-6) return null;
  return tau;
}

/**
 * Ffowcs Williams-Hawkings prediction engine.
 */
class FfowcsWilliamsHawkings {
  /**
   * @param {Object} [props]
   * @param {number} [props.rho0] freestream density, kg/m³
   * @param {number} [props.c0] speed of sound, m/s
   */
  constructor(props = {}) {
    this.rho0 = props.rho0 === undefined ? DEFAULT_RHO0 : props.rho0;
    this.c0 = props.c0 === undefined ? DEFAULT_C0 : props.c0;
  }

  /**
   * Compact monopole far-field pressure at observer time t.
   * @param {function(number):number} qDot source strength rate Q̇(τ) (volume acceleration)
   * @param {number} t observer time (s)
   * @param {number[]} [obs] observer position
   * @param {Object} [source] { pos(τ), vel(τ) }
   * @returns {number} p'(t)
   */
  monopolePressure(qDot, t, obs = [5, 0, 0], source = STATIC_ORIGIN) {
    const tau = solveRetardedTime(obs, source, t, this.c0);
    if (tau === null) return 0;
    const dx = sub(obs, source.pos(tau));
    const r = norm(dx);
    const mr = dot(source.vel(tau), dx) / (r * this.c0);
    return (this.rho0 * qDot(tau)) / (4 * Math.PI * r * (1 - mr) * (1 - mr));
  }

  /**
   * Compact dipole far-field pressure at observer time t. The point force is
   * characterized by its rate of change ∂F/∂τ (N/s), which is what radiates
   * in the far field: p'(x,t) = (1/(4πc0 r)) ∂F(t − r/c0)/∂t · e_r.
   * @param {function(number):number[]} dForceFn ∂F/∂τ at retarded time
   * @param {number} t observer time (s)
   * @param {number[]} [obs] observer position
   * @param {Object} [source] { pos(τ), vel(τ) }
   * @returns {number} p'(t)
   */
  dipolePressure(dForceFn, t, obs = [5, 0, 0], source = STATIC_ORIGIN) {
    const tau = solveRetardedTime(obs, source, t, this.c0);
    if (tau === null) return 0;
    const dx = sub(obs, source.pos(tau));
    const r = norm(dx);
    const e = [dx[0] / r, dx[1] / r, dx[2] / r];
    const mr = dot(source.vel(tau), e) / this.c0;
    return dot(dForceFn(tau), e) / (4 * Math.PI * this.c0 * r * (1 - mr) * (1 - mr));
  }

  /**
   * Spherical-propagation verification mode: evaluates the compact-source
   * radiation model over a grid of observer times.
   * @param {Object} opts
   * @param {'monopole'|'dipole'} opts.type
   * @param {function(number):number} [opts.qDot] monopole source strength rate Q̇
   * @param {function(number):number[]} [opts.dForce] dipole ∂F/∂τ (N/s)
   * @param {Object} [opts.source] moving-source trajectory
   * @param {number[]} [opts.obs] observer position
   * @param {number[]} opts.times observer times
   * @returns {{times: Float64Array, pressure: Float64Array}}
   */
  sphericalPropagationMode(opts) {
    const { type, qDot, dForce, source = STATIC_ORIGIN, obs = [5, 0, 0], times } = opts;
    const pressure = new Float64Array(times.length);
    for (let i = 0; i < times.length; i++) {
      pressure[i] =
        type === 'dipole'
          ? this.dipolePressure(dForce, times[i], obs, source)
          : this.monopolePressure(qDot, times[i], obs, source);
    }
    return { times: Float64Array.from(times), pressure };
  }

  /**
   * Full Farassat Formulation 1A surface integration over a quad mesh.
   * Each panel provides functions of retarded time τ: pos, vel, acc, normal,
   * dnormal (dn/dτ), load (l), dload (dl/dτ), and a constant area.
   * @param {number[]} times observer times
   * @param {number[]} obs observer position
   * @param {Array} panels surface panels
   * @returns {{times: Float64Array, pressure: Float64Array}}
   */
  formulation1A(times, obs, panels) {
    const c0 = this.c0;
    const rho0 = this.rho0;
    const pressure = new Float64Array(times.length);
    const k4pi = 4 * Math.PI;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      let acc = 0;
      for (let p = 0; p < panels.length; p++) {
        const pan = panels[p];
        const tau = solveRetardedTime(obs, pan, t, c0);
        if (tau === null) continue;
        const dx = sub(obs, pan.pos(tau));
        const r = norm(dx);
        const e = [dx[0] / r, dx[1] / r, dx[2] / r];
        const v = pan.vel(tau);
        const a = pan.acc ? pan.acc(tau) : [0, 0, 0];
        const mr = dot(v, e) / c0;
        const M2 = dot(v, v) / (c0 * c0);
        const ve = dot(v, e);
        const dedt = [(-v[0] + ve * e[0]) / r, (-v[1] + ve * e[1]) / r, (-v[2] + ve * e[2]) / r];
        const mdot = (dot(a, e) + dot(v, dedt)) / c0;
        const n = pan.normal(tau);
        const dn = pan.dnormal ? pan.dnormal(tau) : [0, 0, 0];
        const vn = dot(v, n);
        const vndot = dot(a, n) + dot(v, dn);
        const l = pan.load ? pan.load(tau) : [0, 0, 0];
        const dl = pan.dload ? pan.dload(tau) : [0, 0, 0];
        const lr = dot(l, e);
        const lrdot = dot(dl, e) + dot(l, dedt);
        const dS = pan.area;
        const den1 = r * (1 - mr) * (1 - mr);
        const den2 = r * r * (1 - mr) * (1 - mr) * (1 - mr);
        const common = r * mdot + c0 * (mr - M2);
        acc +=
          dS * (rho0 * (vndot / den1 + (vn * common) / den2) + (lrdot / den1 + (lr * common) / den2) / (c0 * k4pi));
      }
      pressure[i] = acc / k4pi;
    }
    return { times: Float64Array.from(times), pressure };
  }

  /**
   * Rotating-dipole (drone propeller) analysis: a disk of N blades, each with
   * a steady tangential surface force, rotating at Ω = 2π·fr. Runs the FW-H
   * integrator over a time window, then FFT (fft_spatial) to SPL spectrum.
   *
   * @param {Object} [opts]
   * @param {number} [opts.fr] rotational frequency, Hz (default 40)
   * @param {number} [opts.blades] blade count N (default 2)
   * @param {number} [opts.radius] rotor radius, m (default 0.2)
   * @param {number} [opts.hubRadius] hub radius, m (default 0.08)
   * @param {number} [opts.chord] blade chord, m (default 0.04)
   * @param {number} [opts.nRadial] radial panels per blade (default 6)
   * @param {number} [opts.nChord] chordwise panels per blade (default 4)
   * @param {number} [opts.tauForce] tangential force per area, Pa (default 600)
   * @param {number[]} [opts.obs] observer position (default [5,0,0])
   * @param {number} [opts.dur] recorded window length, s (default 0.8)
   * @param {number} [opts.fs] sample rate, Hz (default 5120)
   * @param {number} [opts.warmup] revolutions skipped before the analysis window
   *   (default 2; the first revolutions carry a causality startup transient
   *   while retarded times are still negative)
   * @returns {Object} analysis result
   */
  rotatingPropeller(opts = {}) {
    const fr = opts.fr === undefined ? 40 : opts.fr;
    const blades = opts.blades === undefined ? 2 : opts.blades;
    const radius = opts.radius === undefined ? 0.2 : opts.radius;
    const hubRadius = opts.hubRadius === undefined ? 0.08 : opts.hubRadius;
    const chord = opts.chord === undefined ? 0.04 : opts.chord;
    const nRadial = opts.nRadial === undefined ? 6 : opts.nRadial;
    const nChord = opts.nChord === undefined ? 4 : opts.nChord;
    const tauForce = opts.tauForce === undefined ? 600 : opts.tauForce;
    const obs = opts.obs === undefined ? [5, 0, 0] : opts.obs;
    const dur = opts.dur === undefined ? 0.8 : opts.dur;
    const fs = opts.fs === undefined ? 5120 : opts.fs;
    const warmup = opts.warmup === undefined ? 2 : opts.warmup;

    const omega = TWO_PI * fr;
    const N = Math.max(2, Math.round(dur * fs));
    const dRho = (radius - hubRadius) / nRadial;
    const panels = [];
    const dArea = dRho * (chord / nChord);

    for (let b = 0; b < blades; b++) {
      const psi0 = (b * Math.PI) / 1;
      for (let i = 0; i < nRadial; i++) {
        const rho = hubRadius + (i + 0.5) * dRho;
        for (let j = 0; j < nChord; j++) {
          const psiMid = psi0 + (j - (nChord - 1) / 2) * (chord / rho / nChord);
          panels.push({
            area: dArea,
            pos: (tau) => [rho * Math.cos(omega * tau + psiMid), rho * Math.sin(omega * tau + psiMid), 0],
            vel: (tau) => [
              -rho * omega * Math.sin(omega * tau + psiMid),
              rho * omega * Math.cos(omega * tau + psiMid),
              0
            ],
            acc: (tau) => [
              -rho * omega * omega * Math.cos(omega * tau + psiMid),
              -rho * omega * omega * Math.sin(omega * tau + psiMid),
              0
            ],
            normal: () => [0, 0, 1],
            dnormal: () => [0, 0, 0],
            load: (tau) => {
              const ps = omega * tau + psiMid;
              return [tauForce * Math.sin(ps), -tauForce * Math.cos(ps), 0];
            },
            dload: (tau) => {
              const ps = omega * tau + psiMid;
              return [tauForce * omega * Math.cos(ps), tauForce * omega * Math.sin(ps), 0];
            }
          });
        }
      }
    }

    const times = new Float64Array(N);
    for (let i = 0; i < N; i++) times[i] = i / fs;
    const { pressure } = this.formulation1A(times, obs, panels);

    const start = Math.min(N >> 1, Math.max(0, Math.ceil((warmup * fs) / fr)));
    const M = N - start;
    const re = new Float64Array(M);
    const im = new Float64Array(M);
    for (let i = 0; i < M; i++) re[i] = pressure[start + i];
    fft1d(re, im);
    const mag = new Float64Array(M);
    for (let k = 0; k < M; k++) mag[k] = Math.hypot(re[k], im[k]);

    const df = fs / M;
    const half = M >> 1;
    const spl = new Float64Array(half + 1);
    for (let k = 1; k < half; k++) {
      const amp = (2 * mag[k]) / M;
      spl[k] = 20 * Math.log10(amp / Math.SQRT2 / REF_PRESSURE);
    }

    let peakK = 1;
    let peakSpl = spl[1];
    for (let k = 2; k < half; k++) {
      if (spl[k] > peakSpl) {
        peakSpl = spl[k];
        peakK = k;
      }
    }

    const bpF = blades * fr;
    const binBPF = Math.round(bpF / df);
    const splBPF = spl[binBPF];
    const spl3BPF = spl[Math.round((3 * bpF) / df)];

    let floorSpl = -Infinity;
    for (let k = 1; k < half; k++) {
      const f = k * df;
      const nearestTonal = Math.round(f / bpF) * bpF;
      if (Math.abs(f - nearestTonal) <= df) continue;
      if (spl[k] > floorSpl) floorSpl = spl[k];
    }

    const freq = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) freq[k] = k * df;

    return {
      times,
      pressure,
      spectrum: { freq, spl, magnitude: mag },
      omega,
      rotFreq: fr,
      df,
      fs,
      N,
      analysisStart: start,
      analysisLength: M,
      half,
      bpF,
      binBPF,
      peakK,
      peakFreq: peakK * df,
      peakSpl,
      splBPF,
      spl3BPF,
      floorSpl
    };
  }
}

module.exports = {
  FfowcsWilliamsHawkings,
  solveRetardedTime,
  STATIC_ORIGIN
};
