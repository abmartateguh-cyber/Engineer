/**
 * OmniEng verification gate for the Ffowcs Williams-Hawkings aeroacoustics
 * engine (src/core/cae/aeroacoustics_fwh.js).
 *
 * Covers, deterministically (no random, no wall-clock dependence):
 *   - Compact monopole vs analytic far-field p'(r,t) = ρ0 Q̇(t − r/c0)/(4πr)
 *     to 1e-6 relative at multiple observer times.
 *   - Compact dipole vs analytic far-field p'(r,t) =
 *     (1/(4πc0 r)) ∂F(t − r/c0)/∂t · e_r to 1e-6 relative.
 *   - Doppler shift for a source approaching at Mach 0.5: the spectral peak
 *     must sit at the exact Doppler factor 1/(1 − M) within one FFT bin, and
 *     at least at the linearized (1 + M) factor.
 *   - Propeller rotating-dipole: BPF = N·Ω/(2π) bin identification, harmonic
 *     rolloff at 3×BPF, broadband floor ≥ 10 dB below the fundamental, and
 *     deterministic (bit-identical) repeated runs.
 *   - Acoustic causality: zero pressure before the arrival time t = r/c0.
 *   - Full Formulation 1A surface integrator on a pulsating sphere matches the
 *     analytic monopole solution (quadrature-accuracy gate).
 *
 * Run standalone:  node --test test/test_aeroacoustics.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FfowcsWilliamsHawkings, solveRetardedTime } = require('../src/core/cae/aeroacoustics_fwh');
const { fft1d } = require('../src/core/math/fft_spatial');

const RHO0 = 1.225;
const C0 = 343.0;

test('FW-H monopole compact source matches analytic far-field to 1e-6', () => {
  const fwh = new FfowcsWilliamsHawkings({ rho0: RHO0, c0: C0 });
  const r = 5;
  const omega = 2 * Math.PI * 120;
  const A = 0.05;
  const qDot = (tau) => A * Math.sin(omega * tau);
  const obs = [r, 0, 0];
  const tArrive = r / C0;
  const times = [];
  for (let i = 1; i <= 16; i++) times.push(tArrive + i * 0.001);

  const { pressure } = fwh.sphericalPropagationMode({ type: 'monopole', qDot, obs, times });

  let maxRel = 0;
  for (let i = 0; i < times.length; i++) {
    const analytic = (RHO0 * A * Math.sin(omega * (times[i] - tArrive))) / (4 * Math.PI * r);
    const rel = Math.abs(pressure[i] - analytic) / Math.abs(analytic);
    maxRel = Math.max(maxRel, rel);
  }
  assert.ok(maxRel < 1e-6, `monopole max relative error ${maxRel} >= 1e-6`);
});

test('FW-H dipole compact source matches analytic far-field to 1e-6', () => {
  const fwh = new FfowcsWilliamsHawkings({ rho0: RHO0, c0: C0 });
  const r = 5;
  const omega = 2 * Math.PI * 90;
  const F0 = 2.5;
  const dForce = (tau) => [F0 * omega * Math.cos(omega * tau), 0, 0];
  const obs = [r, 0, 0];
  const tArrive = r / C0;
  const times = [];
  for (let i = 1; i <= 16; i++) times.push(tArrive + i * 0.001);

  const { pressure } = fwh.sphericalPropagationMode({ type: 'dipole', dForce, obs, times });

  let maxRel = 0;
  for (let i = 0; i < times.length; i++) {
    const analytic = (F0 * omega * Math.cos(omega * (times[i] - tArrive))) / (4 * Math.PI * C0 * r);
    const rel = Math.abs(pressure[i] - analytic) / Math.abs(analytic);
    maxRel = Math.max(maxRel, rel);
  }
  assert.ok(maxRel < 1e-6, `dipole max relative error ${maxRel} >= 1e-6`);
});

test('Doppler shift: Mach 0.5 source peak at exact 1/(1-M) within one FFT bin', () => {
  const fwh = new FfowcsWilliamsHawkings({ rho0: RHO0, c0: C0 });
  const M = 0.5;
  const v = M * C0;
  const x0 = -5;
  const obs = [5, 0, 0];
  const source = {
    pos: (tau) => [x0 + v * tau, 0, 0],
    vel: () => [v, 0, 0],
    acc: () => [0, 0, 0]
  };
  const f0 = 1000;
  const A = 0.02;
  const omega = 2 * Math.PI * f0;
  const qDot = (tau) => A * Math.cos(omega * tau);

  const N = 1024;
  const tStart = 0.0292;
  const tEnd = 0.0416;
  const times = new Float64Array(N);
  for (let i = 0; i < N; i++) times[i] = tStart + ((tEnd - tStart) * i) / (N - 1);

  const { pressure } = fwh.sphericalPropagationMode({ type: 'monopole', qDot, source, obs, times });

  const re = Float64Array.from(pressure);
  const im = new Float64Array(N);
  fft1d(re, im);
  const fs = (N - 1) / (tEnd - tStart);
  const df = fs / N;

  let peakK = 1;
  let best = 0;
  for (let k = 1; k < N / 2; k++) {
    const m = Math.hypot(re[k], im[k]);
    if (m > best) {
      best = m;
      peakK = k;
    }
  }
  const fPeak = peakK * df;
  const fExact = f0 / (1 - M);
  const fLin = f0 * (1 + M);

  assert.ok(best > 0, 'no spectral energy found');
  assert.ok(
    Math.abs(fPeak - fExact) <= df + 1e-9,
    `peak ${fPeak.toFixed(2)} Hz not within one bin of exact Doppler ${fExact.toFixed(2)} Hz`
  );
  assert.ok(fPeak >= fLin - df, `peak ${fPeak.toFixed(2)} Hz below linearized (1+M)f0 = ${fLin.toFixed(2)} Hz`);
});

test('Propeller rotating dipole: BPF bin, rolloff at 3xBPF, broadband floor, deterministic', () => {
  const fwh = new FfowcsWilliamsHawkings({ rho0: RHO0, c0: C0 });
  const res = fwh.rotatingPropeller({});

  const { bpF, df, binBPF, splBPF, spl3BPF, floorSpl, peakFreq, peakSpl, fs, N } = res;

  assert.ok(Math.abs(peakFreq - bpF) <= df + 1e-9, `spectral peak ${peakFreq.toFixed(3)} Hz not at BPF ${bpF} Hz`);
  assert.equal(binBPF, Math.round(bpF / df), 'BPF bin index mismatch');
  assert.ok(Math.abs(binBPF * df - bpF) <= df, `BPF bin ${binBPF} not at ${bpF} Hz`);

  assert.ok(
    splBPF > spl3BPF + 10,
    `SPL(${bpF} Hz) = ${splBPF.toFixed(2)} dB not > SPL(3*BPF) + 10 = ${(spl3BPF + 10).toFixed(2)} dB`
  );
  assert.ok(
    floorSpl <= splBPF - 10,
    `broadband floor ${floorSpl.toFixed(2)} dB not >= 10 dB below fundamental ${splBPF.toFixed(2)} dB`
  );

  assert.ok(Number.isFinite(peakSpl) && Number.isFinite(splBPF) && Number.isFinite(floorSpl));
  assert.ok(fs > 0 && N > 0 && N % 2 === 0);

  const res2 = fwh.rotatingPropeller({});
  for (let i = 0; i < N; i++) assert.equal(res.pressure[i], res2.pressure[i], `non-deterministic at sample ${i}`);
});

test('Causality: zero acoustic pressure before arrival time r/c0', () => {
  const fwh = new FfowcsWilliamsHawkings({ rho0: RHO0, c0: C0 });
  const r = 5;
  const times = [];
  for (let i = 1; i <= 10; i++) times.push(-i * 0.001);

  const qDot = () => 1e6;
  const { pressure } = fwh.sphericalPropagationMode({ type: 'monopole', qDot, obs: [r, 0, 0], times });
  for (const p of pressure) assert.equal(p, 0);

  const dForce = () => [1e6, 0, 0];
  const { pressure: p2 } = fwh.sphericalPropagationMode({ type: 'dipole', dForce, obs: [r, 0, 0], times });
  for (const p of p2) assert.equal(p, 0);
});

test('Causality: propeller pressure zero before first retarded arrival', () => {
  const fwh = new FfowcsWilliamsHawkings({ rho0: RHO0, c0: C0 });
  const res = fwh.rotatingPropeller({});
  const tArrive = (5 - 0.2) / C0;
  const nArrive = Math.floor(tArrive * res.fs) - 1;
  for (let i = 0; i <= nArrive; i++) assert.equal(res.pressure[i], 0, `nonzero pre-arrival pressure at sample ${i}`);
});

test('Formulation 1A surface integrator: pulsating sphere matches monopole', () => {
  const fwh = new FfowcsWilliamsHawkings({ rho0: RHO0, c0: C0 });
  const a = 0.02;
  const w = 2 * Math.PI * 120;
  const V0 = 0.2;
  const r = 5;
  const nPhi = 192;
  const nTheta = 96;
  const panels = [];
  for (let i = 0; i < nPhi; i++) {
    const phi = ((i + 0.5) * 2 * Math.PI) / nPhi;
    for (let j = 0; j < nTheta; j++) {
      const theta = ((j + 0.5) * Math.PI) / nTheta;
      const st = Math.sin(theta);
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      const n = [st * cp, st * sp, Math.cos(theta)];
      const dS = a * a * st * ((2 * Math.PI) / nPhi) * (Math.PI / nTheta);
      panels.push({
        area: dS,
        pos: () => [a * n[0], a * n[1], a * n[2]],
        vel: (tau) => [V0 * Math.sin(w * tau) * n[0], V0 * Math.sin(w * tau) * n[1], V0 * Math.sin(w * tau) * n[2]],
        acc: (tau) => [
          V0 * w * Math.cos(w * tau) * n[0],
          V0 * w * Math.cos(w * tau) * n[1],
          V0 * w * Math.cos(w * tau) * n[2]
        ],
        normal: () => n,
        dnormal: () => [0, 0, 0],
        load: () => [0, 0, 0]
      });
    }
  }

  // High-order Gauss-Legendre (80 pt/dimension) tensor product over the unit
  // sphere, giving a ~1e-12 accurate evaluation of the same continuum FW-H
  // thickness integral (with the exact a² surface-area factor). This isolates
  // pure quadrature error of the engine's midpoint panel rule; note the
  // far-field monopole formula itself carries physical O((ka)²) corrections
  // that the full surface integral legitimately includes.
  const nG = 80;
  const gx = new Float64Array(nG);
  const gw = new Float64Array(nG);
  for (let i = 0; i < (nG + 1) >> 1; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (nG + 0.5));
    let pp;
    for (;;) {
      let p1 = 1;
      let p2 = 0;
      let p = 0;
      for (let j = 0; j < nG; j++) {
        p = ((2 * j + 1) * z * p1 - j * p2) / (j + 1);
        p2 = p1;
        p1 = p;
      }
      pp = (nG * (z * p1 - p2)) / (z * z - 1);
      const z0 = z;
      z = z0 - p / pp;
      if (Math.abs(z - z0) < 1e-15) break;
    }
    gx[i] = -z;
    gx[nG - 1 - i] = z;
    gw[i] = 2 / ((1 - z * z) * pp * pp);
    gw[nG - 1 - i] = gw[i];
  }

  const refIntegral = (t) => {
    let acc = 0;
    for (let i = 0; i < nG; i++) {
      const theta = (Math.PI * (gx[i] + 1)) / 2;
      for (let j = 0; j < nG; j++) {
        const phi = Math.PI * (gx[j] + 1);
        const st = Math.sin(theta);
        const n = [st * Math.cos(phi), st * Math.sin(phi), Math.cos(theta)];
        const dist = Math.hypot(r - a * n[0], -a * n[1], -a * n[2]);
        const tau = t - dist / C0;
        const vdot = V0 * w * Math.cos(w * tau);
        acc += ((Math.PI * Math.PI) / 2) * st * gw[i] * gw[j] * (vdot / dist);
      }
    }
    return (RHO0 * a * a * acc) / (4 * Math.PI);
  };

  const times = [r / C0 + 0.005, r / C0 + 0.01];
  const { pressure } = fwh.formulation1A(times, [r, 0, 0], panels);

  for (let i = 0; i < times.length; i++) {
    const ref = refIntegral(times[i]);
    const rel = Math.abs(pressure[i] - ref) / Math.abs(ref);
    assert.ok(rel < 1e-4, `surface-integrator quadrature relative error ${rel} >= 1e-4`);
    const mono = (RHO0 * a * a * V0 * w * Math.cos(w * (times[i] - r / C0))) / r;
    const relMono = Math.abs(pressure[i] - mono) / Math.abs(mono);
    assert.ok(
      relMono < 1e-2,
      `surface-integrator deviation from far-field monopole ${relMono} >= 1e-2 (O((ka)^2) physics)`
    );
  }
});

test('Retarded-time solver: exact root for stationary and moving sources', () => {
  const fwh = new FfowcsWilliamsHawkings({ rho0: RHO0, c0: C0 });
  const obs = [5, 0, 0];
  const stationary = { pos: () => [0, 0, 0], vel: () => [0, 0, 0] };
  const t = 0.02;
  const tauStat = solveRetardedTime(obs, stationary, t, C0);
  assert.ok(tauStat !== null);
  assert.ok(Math.abs(tauStat - (t - 5 / C0)) < 1e-10);
  assert.ok(Math.abs(tauStat + 5 / C0 - t) < 1e-9);

  const M = 0.3;
  const v = M * C0;
  const moving = { pos: (tau) => [-3 + v * tau, 0, 0], vel: () => [v, 0, 0] };
  assert.ok(solveRetardedTime(obs, moving, 0.02, C0) === null, 'pre-arrival time must have no causal retarded time');
  const tMov = 0.03;
  const tauMov = solveRetardedTime(obs, moving, tMov, C0);
  assert.ok(tauMov !== null);
  const rMov = Math.hypot(5 - (-3 + v * tauMov), 0, 0);
  assert.ok(Math.abs(tauMov + rMov / C0 - tMov) < 1e-9);
});
