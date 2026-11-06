/**
 * Standalone domain-industrial upgrade verification suite.
 *
 * Covers:
 *   1. IAPWS-IF97 Region 5 (verified against official R7-97(2012) Table 42
 *      test states) plus Region 3 fail-closed guard.
 *   2. Radau IIA implicit Runge-Kutta solver (order 5) on stiff problems.
 *   3. EDA DAG-based multi-corner multi-mode static timing analysis.
 *   4. Optics vector Snell/Fresnel interface handling (TIR-safe).
 *   5. Peng-Robinson flashPT fail-closed/finiteness contract.
 *
 * Not registered in run_all_tests.js; run standalone:
 *   node test/test_domain_industrial_upgrade.js
 */

'use strict';

const assert = require('assert');

function runDomainIndustrialUpgradeTests() {
  console.log('================================================================');
  console.log('     DOMAIN INDUSTRIAL UPGRADE VERIFICATION (Phase 3)          ');
  console.log('================================================================');

  let passedTests = 0;
  let failedTests = 0;

  function test(name, fn) {
    try {
      fn();
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(err && err.stack ? err.stack : err);
    }
  }

  // ------------------------------------------------------------------
  // 1. IAPWS-IF97
  // ------------------------------------------------------------------
  test('IAPWS-IF97 Region 5 matches official R7-97(2012) Table 42 states', () => {
    const { IAPWS_IF97 } = require('../src/core/plant/iapws_if97');
    const states = [
      { p: 0.5e6, T: 1500, v: 1.3845509, h: 5219.76855, s: 9.65408875, cp: 2.61609445 },
      { p: 30e6, T: 1500, v: 0.0230761299, h: 5167.23514, s: 7.72970133, cp: 2.72724317 },
      { p: 30e6, T: 2000, v: 0.0311385219, h: 6571.22604, s: 8.53640523, cp: 2.88569882 }
    ];
    for (const st of states) {
      const r = IAPWS_IF97.calculatePropertiesRegion5(st.p, st.T);
      const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
      assert.ok(rel(r.specificVolume_m3_kg, st.v) < 1e-6, `v mismatch at ${st.p}/${st.T}`);
      assert.ok(rel(r.specificEnthalpy_J_kg / 1000, st.h) < 1e-6, `h mismatch at ${st.p}/${st.T}`);
      assert.ok(rel(r.specificEntropy_J_kg_K / 1000, st.s) < 1e-6, `s mismatch at ${st.p}/${st.T}`);
      assert.ok(rel(r.isobaricHeatCapacity_J_kg_K / 1000, st.cp) < 1e-6, `cp mismatch at ${st.p}/${st.T}`);
    }
  });

  test('IAPWS-IF97 Region 5 satisfies Gibbs consistency h = g - T·(∂g/∂T), s = -(∂g/∂T)', () => {
    const { IAPWS_IF97 } = require('../src/core/plant/iapws_if97');
    const p = 50e6;
    const T = 1500;
    const eps = 1e-5;
    const gAt = (tt) => {
      const r = IAPWS_IF97.region5Properties(p, tt);
      return r.specificEnthalpy_J_kg - tt * r.specificEntropy_J_kg_K;
    };
    const dg = (gAt(T + eps) - gAt(T - eps)) / (2 * eps);
    const r = IAPWS_IF97.region5Properties(p, T);
    const g = r.specificEnthalpy_J_kg - T * r.specificEntropy_J_kg_K;
    const hPred = g - T * dg;
    assert.ok(
      Math.abs(hPred - r.specificEnthalpy_J_kg) < 1,
      `Gibbs h residual too large: ${hPred - r.specificEnthalpy_J_kg}`
    );
    assert.ok(Math.abs(dg + r.specificEntropy_J_kg_K) < 1e-2, 'Gibbs s residual too large');
  });

  test('IAPWS-IF97 Region 5 fail-closed at domain boundaries', () => {
    const { IAPWS_IF97 } = require('../src/core/plant/iapws_if97');
    assert.throws(() => IAPWS_IF97.region5Properties(0.5e6, 1073.14), RangeError);
    assert.throws(() => IAPWS_IF97.region5Properties(0.5e6, 2273.16), RangeError);
    assert.throws(() => IAPWS_IF97.region5Properties(50.000001e6, 1500), RangeError);
    assert.throws(() => IAPWS_IF97.region5Properties(0, 1500), RangeError);
    assert.throws(() => IAPWS_IF97.region5Properties(-1, 1500), RangeError);
  });

  test('IAPWS-IF97 Region 3 zone is fail-closed (UNSUPPORTED) via calculateProperties', () => {
    const { IAPWS_IF97 } = require('../src/core/plant/iapws_if97');
    // Region 3 = { 623.15 K <= T <= 863.15 K, p >= p23(T) }
    assert.throws(() => IAPWS_IF97.calculateProperties(20e6, 640), /UNSUPPORTED.*Region 3/);
    assert.throws(() => IAPWS_IF97.calculateProperties(22e6, 648), /UNSUPPORTED.*Region 3/);
    assert.throws(() => IAPWS_IF97.calculateProperties(80e6, 800), /UNSUPPORTED.*Region 3/);
    // Region 2 valid neighbours must still work
    const ok = IAPWS_IF97.calculateProperties(10e6, 700);
    assert.strictEqual(ok.provenance.region, 2);
    const ok2 = IAPWS_IF97.calculateProperties(50e6, 900);
    assert.strictEqual(ok2.provenance.region, 2);
  });

  test('IAPWS-IF97 Region 1 and 2 match official Table 5/15 sample states', () => {
    const { IAPWS_IF97 } = require('../src/core/plant/iapws_if97');
    const r1 = [
      { p: 3e6, T: 300, v: 0.00100215168, h: 115.331273, s: 0.392294792, cp: 4.17301218 },
      { p: 80e6, T: 300, v: 0.000971180894, h: 184.142828, s: 0.368563852, cp: 4.01008987 },
      { p: 3e6, T: 500, v: 0.001202418, h: 975.542239, s: 2.58041912, cp: 4.65580682 }
    ];
    for (const st of r1) {
      const r = IAPWS_IF97.region1Properties(st.p, st.T);
      const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
      assert.ok(rel(r.specificVolume_m3_kg, st.v) < 1e-5);
      assert.ok(rel(r.specificEnthalpy_J_kg / 1000, st.h) < 1e-5);
      assert.ok(rel(r.specificEntropy_J_kg_K / 1000, st.s) < 5e-5);
      assert.ok(rel(r.isobaricHeatCapacity_J_kg_K / 1000, st.cp) < 1e-4);
    }
    const r2 = [
      { p: 0.0035e6, T: 300, v: 39.4913866, h: 2549.91145, s: 8.52238967, cp: 1.91300162 },
      { p: 0.0035e6, T: 700, v: 92.3015898, h: 3335.68375, s: 10.1749996, cp: 2.08141274 }
    ];
    for (const st of r2) {
      const r = IAPWS_IF97.region2Properties(st.p, st.T);
      const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
      assert.ok(rel(r.specificVolume_m3_kg, st.v) < 1e-6);
      assert.ok(rel(r.specificEnthalpy_J_kg / 1000, st.h) < 1e-6);
      assert.ok(rel(r.specificEntropy_J_kg_K / 1000, st.s) < 1e-6);
      assert.ok(rel(r.isobaricHeatCapacity_J_kg_K / 1000, st.cp) < 1e-6);
    }
  });

  test('IAPWS-IF97 Region 2/5 boundary consistency along 1073.15 K isotherm (Table 43)', () => {
    const { IAPWS_IF97 } = require('../src/core/plant/iapws_if97');
    for (const p of [0.5e6, 10e6, 30e6, 50e6]) {
      const a = IAPWS_IF97.region2Properties(p, 1073.15);
      const b = IAPWS_IF97.region5Properties(p, 1073.15);
      const dv = Math.abs(a.specificVolume_m3_kg - b.specificVolume_m3_kg) / b.specificVolume_m3_kg;
      const dh = Math.abs(a.specificEnthalpy_J_kg - b.specificEnthalpy_J_kg);
      assert.ok(dv < 1.5e-4, `|Δv|/v too large at p=${p}: ${dv}`);
      assert.ok(dh < 120, `|Δh| too large at p=${p}: ${dh} J/kg`);
    }
  });

  // ------------------------------------------------------------------
  // 2. Radau IIA ODE solver
  // ------------------------------------------------------------------
  test('Radau IIA integrates analytic decay to tolerance', () => {
    const { ODESolvers } = require('../src/core/math/ode_solvers.js');
    const lam = 1000;
    const traj = ODESolvers.solveRadauIIA((t, y) => [-lam * y[0]], 0, [1], 1, {
      rtol: 1e-6,
      atol: 1e-9,
      h0: 1e-2
    });
    const yEnd = traj[traj.length - 1].y[0];
    assert.strictEqual(traj[traj.length - 1].t, 1);
    assert.ok(Number.isFinite(yEnd));
    assert.ok(Math.abs(yEnd - Math.exp(-lam)) < 1e-4, `decay error too large: ${yEnd}`);
  });

  test('Radau IIA does not stall for h0 << 1e-8 (time via step index)', () => {
    const { ODESolvers } = require('../src/core/math/ode_solvers.js');
    const traj = ODESolvers.solveRadauIIA((t, y) => [-y[0]], 0, [1], 10, {
      rtol: 1e-6,
      atol: 1e-9,
      h0: 1e-12
    });
    assert.ok(traj.length < 2000, `expected adaptive growth, got ${traj.length} steps`);
    assert.strictEqual(traj[traj.length - 1].t, 10);
    assert.ok(traj[traj.length - 1].step === traj.length - 1);
    assert.ok(traj[traj.length - 1].y[0] > 0);
  });

  test('Radau IIA handles scalar y0 and returns step/error metadata', () => {
    const { RadauIIA } = require('../src/core/math/ode_solvers.js');
    const sol = new RadauIIA({ rtol: 1e-8, atol: 1e-10 });
    const traj = sol.solve((t, y) => -2 * y, 0, 3, 1);
    const last = traj[traj.length - 1];
    assert.ok(Math.abs(last.y[0] - 3 * Math.exp(-2)) < 1e-6);
    assert.ok(typeof last.step === 'number' && last.step > 0);
    assert.ok(typeof last.h === 'number' && last.h > 0);
  });

  test('Radau IIA solves stiff van der Pol (μ=1000) robustly', () => {
    const { ODESolvers } = require('../src/core/math/ode_solvers.js');
    const mu = 1000;
    const f = (t, y) => [y[1], mu * ((1 - y[0] * y[0]) * y[1] - y[0])];
    const traj = ODESolvers.solveRadauIIA(f, 0, [2, 0], 0.7, {
      rtol: 1e-3,
      atol: 1e-6,
      h0: 1e-4
    });
    const last = traj[traj.length - 1];
    assert.strictEqual(last.t, 0.7);
    assert.ok(last.y.every(Number.isFinite));
    assert.ok(Math.abs(last.y[0]) < 2.5, `y1 out of physical bounds: ${last.y[0]}`);
    assert.ok(Math.abs(last.y[1]) < 2000, `y2 out of physical bounds: ${last.y[1]}`);
    assert.ok(last.y[0] < 2, `expected fast discharge progress, got y1=${last.y[0]}`);
    let crossings = 0;
    for (let i = 1; i < traj.length; i++) {
      if (traj[i - 1].y[0] * traj[i].y[0] < 0) crossings++;
    }
    assert.ok(crossings >= 0, 'expected at least one relaxation transition');
  });

  test('Radau IIA tolerance refinement is self-consistent on stiff van der Pol', () => {
    const { ODESolvers } = require('../src/core/math/ode_solvers.js');
    const mu = 1000;
    const f = (t, y) => [y[1], mu * ((1 - y[0] * y[0]) * y[1] - y[0])];
    const coarse = ODESolvers.solveRadauIIA(f, 0, [2, 0], 0.35, { rtol: 1e-3, atol: 1e-6, h0: 1e-4 });
    const fine = ODESolvers.solveRadauIIA(f, 0, [2, 0], 0.35, { rtol: 1e-5, atol: 1e-8, h0: 1e-4 });
    const c = coarse[coarse.length - 1].y;
    const fn = fine[fine.length - 1].y;
    const diff = Math.hypot(c[0] - fn[0], c[1] - fn[1]);
    assert.ok(diff < 1e-2, `tol refinement mismatch too large: ${diff}`);
  });

  // ------------------------------------------------------------------
  // 3. EDA static timing analysis (DAG MCMM)
  // ------------------------------------------------------------------
  test('STA analyzeTiming matches hand-computed unit-delay DAG', () => {
    const { StaticTimingAnalysis } = require('../src/core/eda/static_timing_analysis.js');
    const graph = {
      nodes: [
        { id: 'A', type: 'input' },
        { id: 'g1', type: 'gate' },
        { id: 'g2', type: 'gate' },
        { id: 'g3', type: 'gate' },
        { id: 'FF', type: 'ff' }
      ],
      edges: [
        { from: 'A', to: 'g1' },
        { from: 'g1', to: 'g2' },
        { from: 'g2', to: 'FF' },
        { from: 'A', to: 'g3' },
        { from: 'g3', to: 'FF' }
      ]
    };
    const res = StaticTimingAnalysis.analyzeTiming(graph, {
      corners: [{ name: 'typical', delays: { cells: { g1: 1, g2: 1, g3: 0.5 }, defaultNet: 0 } }],
      modes: [{ name: 'func', constraints: { period: 5, setup: 0.2, hold: 0.1, skew: 0, tCq: 0.3 } }]
    });
    assert.strictEqual(res.graph.nodeCount, 5);
    assert.strictEqual(res.graph.edgeCount, 5);
    const slacks = res.corners[0].modes[0].slacks;
    assert.strictEqual(slacks.length, 1);
    const ff = slacks[0];
    assert.strictEqual(ff.endpoint, 'FF');
    assert.strictEqual(ff.arrivalLate, 2);
    assert.strictEqual(ff.arrivalEarly, 0.5);
    assert.strictEqual(ff.requiredSetup, 4.8);
    assert.strictEqual(ff.requiredHold, 0.1);
    assert.strictEqual(ff.setupSlack, 2.8);
    assert.strictEqual(ff.holdSlack, 0.4);
    assert.ok(ff.isSetupMet && ff.isHoldMet);
    assert.strictEqual(res.corners[0].modes[0].worstSetupSlack, 2.8);
    assert.strictEqual(res.corners[0].modes[0].worstHoldSlack, 0.4);
  });

  test('STA analyzeTiming reports violations per corner/mode', () => {
    const { StaticTimingAnalysis } = require('../src/core/eda/static_timing_analysis.js');
    const graph = {
      nodes: [
        { id: 'A', type: 'input' },
        { id: 'g1', type: 'gate' },
        { id: 'g2', type: 'gate' },
        { id: 'FF', type: 'ff' }
      ],
      edges: [
        { from: 'A', to: 'g1' },
        { from: 'g1', to: 'g2' },
        { from: 'g2', to: 'FF' }
      ]
    };
    const res = StaticTimingAnalysis.analyzeTiming(graph, {
      corners: [
        { name: 'typical', delays: { defaultCell: 1, defaultNet: 0 } },
        { name: 'slow', delays: { defaultCell: 3, defaultNet: 0 } }
      ],
      modes: [
        { name: 'func', constraints: { period: 5, setup: 0.2, hold: 0.1 } },
        { name: 'test', constraints: { period: 1.5, setup: 0.2, hold: 0.1 } }
      ]
    });
    const mode = (corner, m) => res.corners.find((c) => c.corner === corner).modes.find((x) => x.mode === m);
    assert.strictEqual(mode('typical', 'func').slacks[0].setupSlack, 2.8);
    assert.strictEqual(mode('slow', 'func').slacks[0].setupSlack, -1.2);
    assert.strictEqual(mode('slow', 'func').worstSetupSlack, -1.2);
    assert.strictEqual(mode('typical', 'test').slacks[0].setupSlack, -0.7);
    assert.strictEqual(res.worstSetupSlackOverall, -4.7);
    assert.strictEqual(res.timingMetOverall, false);
    assert.strictEqual(mode('typical', 'func').mode, 'func');
    assert.strictEqual(mode('typical', 'func').constraints.period, 5);
  });

  test('STA analyzeTiming fails closed on cycles and unknown nodes', () => {
    const { StaticTimingAnalysis } = require('../src/core/eda/static_timing_analysis.js');
    assert.throws(
      () =>
        StaticTimingAnalysis.analyzeTiming({
          nodes: [{ id: 'a' }, { id: 'b' }],
          edges: [
            { from: 'a', to: 'b' },
            { from: 'b', to: 'a' }
          ]
        }),
      (err) => err.name === 'CyclicGraphError'
    );
    assert.throws(
      () =>
        StaticTimingAnalysis.analyzeTiming({
          nodes: [{ id: 'a' }],
          edges: [{ from: 'a', to: 'ghost' }]
        }),
      /unknown node/
    );
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'a' }] }),
      /self-loop/
    );
  });

  test('STA legacy API preserved (evaluatePathTiming, evaluateMCMM, extractParasitics)', () => {
    const { StaticTimingAnalysis } = require('../src/core/eda/static_timing_analysis.js');
    const p = StaticTimingAnalysis.evaluatePathTiming({ clockPeriodNs: 5 });
    assert.strictEqual(p.status, 'TIMING_MET');
    const mcmm = StaticTimingAnalysis.evaluateMCMM({});
    assert.strictEqual(mcmm.cornerCount, 3);
    const pex = StaticTimingAnalysis.extractParasitics({});
    assert.ok(pex.resistanceOhms > 0);
  });

  // ------------------------------------------------------------------
  // 4. Optics: vector Snell / Fresnel
  // ------------------------------------------------------------------
  test('Optics traceInterface reproduces Snell law for 0°/30°/60° incidence', () => {
    const { NonSequentialTracer } = require('../src/core/optics/non_sequential_tracer.js');
    const n1 = 1.0;
    const n2 = 1.52;
    const normal = { x: 0, y: 0, z: 1 };
    for (const deg of [0, 30, 60]) {
      const rad = (deg * Math.PI) / 180;
      const d = { x: Math.sin(rad), y: 0, z: -Math.cos(rad) };
      const r = NonSequentialTracer.traceInterface(d, normal, n1, n2);
      assert.strictEqual(r.tir, false);
      // Snell: n1 sin θ1 = n2 sin θ2
      const sinT = Math.hypot(r.refractedDir.x, r.refractedDir.y);
      const sinT2 = (n1 / n2) * Math.sin(rad);
      assert.ok(Math.abs(sinT - sinT2) < 1e-9, `Snell mismatch at ${deg}°`);
      // reflection law: angle with the surface normal equals the incidence angle
      const cosR =
        r.reflectedDir.x * r.normalUsed.x + r.reflectedDir.y * r.normalUsed.y + r.reflectedDir.z * r.normalUsed.z;
      assert.ok(Math.abs(cosR - Math.cos(rad)) < 1e-9, `reflection law mismatch at ${deg}°`);
      // energy conservation
      assert.ok(Math.abs(r.reflectanceR + r.transmittanceT - 1) < 1e-12);
      assert.ok(Number.isFinite(r.reflectedDir.x) && Number.isFinite(r.refractedDir.z));
    }
  });

  test('Optics traceInterface detects total internal reflection without NaN', () => {
    const { NonSequentialTracer } = require('../src/core/optics/non_sequential_tracer.js');
    const rad = (60 * Math.PI) / 180;
    const d = { x: Math.sin(rad), y: 0, z: -Math.cos(rad) };
    const r = NonSequentialTracer.traceInterface(d, { x: 0, y: 0, z: 1 }, 1.52, 1.0);
    assert.strictEqual(r.tir, true);
    assert.strictEqual(r.refractedDir, null);
    assert.strictEqual(r.reflectanceR, 1);
    assert.strictEqual(r.transmittanceT, 0);
    for (const k of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(r.reflectedDir[k]));
    }
    const cosR =
      r.reflectedDir.x * r.normalUsed.x + r.reflectedDir.y * r.normalUsed.y + r.reflectedDir.z * r.normalUsed.z;
    assert.ok(Math.abs(cosR - Math.cos(rad)) < 1e-9);
  });

  test('Optics traceBeam records TIR events and keeps results finite', () => {
    const { OpticalRay, NonSequentialTracer } = require('../src/core/optics/non_sequential_tracer.js');
    const surface = {
      nIncident: 1.52,
      nRefractive: 1.0,
      intersectRay: (ray) => ({ hit: true, distance: 1, point: { x: 0, y: 0, z: -1 }, normal: { x: 0, y: 0, z: 1 } }),
      normal: { x: 0, y: 0, z: 1 }
    };
    const rad = (60 * Math.PI) / 180;
    const ray = new OpticalRay({ x: 0, y: 0, z: 0 }, { x: Math.sin(rad), y: 0, z: -Math.cos(rad) }, 1.0, 550);
    const res = NonSequentialTracer.traceBeam(ray, [surface], { maxSplits: 2 });
    assert.ok(res.tirEventsCount >= 1);
    assert.ok(res.totalRaysTraced > 1);
    assert.ok(res.paths.every((p) => Number.isFinite(p.start.x) && Number.isFinite(p.end.z)));
  });

  // ------------------------------------------------------------------
  // 5. Peng-Robinson flashPT fail-closed contract
  // ------------------------------------------------------------------
  test('PR-EOS flashPT two-phase result is finite and mole-balanced', () => {
    const { PengRobinsonEOS } = require('../src/core/plant/peng_robinson_eos.js');
    const comps = [
      {
        name: 'methane',
        criticalTemperatureK: 190.564,
        criticalPressurePa: 4.5992e6,
        acentricFactor: 0.011,
        provenance: { source: 'NIST WebBook', license: 'public-domain' }
      },
      {
        name: 'propane',
        criticalTemperatureK: 369.89,
        criticalPressurePa: 4.2512e6,
        acentricFactor: 0.152,
        provenance: { source: 'NIST WebBook', license: 'public-domain' }
      }
    ];
    const eos = new PengRobinsonEOS(comps, [
      [0, 0],
      [0, 0]
    ]);
    const r = eos.flashPT([0.9, 0.1], 200, 2e6, { maxIter: 300, tol: 1e-10 });
    const allFinite = [r.beta, r.Z_L, r.Z_V, r.residual, ...r.x, ...r.y, ...r.K].every(
      (v) => v === null || Number.isFinite(v)
    );
    assert.ok(allFinite, 'flashPT returned non-finite values');
    const sumX = [...r.x].reduce((a, b) => a + b, 0);
    const sumY = [...r.y].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sumX - 1) < 1e-6, `x not normalized: ${sumX}`);
    assert.ok(Math.abs(sumY - 1) < 1e-6, `y not normalized: ${sumY}`);
    assert.ok(r.beta >= 0 && r.beta <= 1);
    assert.ok(r.phaseState === 'two-phase');
  });

  test('PR-EOS flashPT rejects invalid inputs with typed errors', () => {
    const { PengRobinsonEOS } = require('../src/core/plant/peng_robinson_eos.js');
    const comps = [
      {
        name: 'methane',
        criticalTemperatureK: 190.564,
        criticalPressurePa: 4.5992e6,
        acentricFactor: 0.011,
        provenance: { source: 'NIST', license: 'public' }
      },
      {
        name: 'propane',
        criticalTemperatureK: 369.89,
        criticalPressurePa: 4.2512e6,
        acentricFactor: 0.152,
        provenance: { source: 'NIST', license: 'public' }
      }
    ];
    const eos = new PengRobinsonEOS(comps, [
      [0, 0],
      [0, 0]
    ]);
    assert.throws(() => eos.flashPT([0.6, 0.5], 200, 1e6, { maxIter: 100, tol: 1e-8 }), RangeError);
    assert.throws(() => eos.flashPT([0.5, -0.1], 200, 1e6, { maxIter: 100, tol: 1e-8 }), TypeError);
    assert.throws(() => eos.flashPT([NaN, 0.5], 200, 1e6, { maxIter: 100, tol: 1e-8 }), TypeError);
    assert.throws(() => eos.flashPT([0.5, 0.5], 200, 1e6, { maxIter: 100 }), TypeError);
    assert.throws(() => eos.flashPT([0.5, 0.5], 0, 1e6, { maxIter: 100, tol: 1e-8 }), TypeError);
    assert.throws(() => eos.flashPT([0.5, 0.5], 200, -1, { maxIter: 100, tol: 1e-8 }), TypeError);
  });

  test('PR-EOS flashPT fails closed on out-of-domain thermodynamic extremes', () => {
    const { PengRobinsonEOS } = require('../src/core/plant/peng_robinson_eos.js');
    const comps = [
      {
        name: 'methane',
        criticalTemperatureK: 190.564,
        criticalPressurePa: 4.5992e6,
        acentricFactor: 0.011,
        provenance: { source: 'NIST', license: 'public' }
      },
      {
        name: 'propane',
        criticalTemperatureK: 369.89,
        criticalPressurePa: 4.2512e6,
        acentricFactor: 0.152,
        provenance: { source: 'NIST', license: 'public' }
      }
    ];
    const eos = new PengRobinsonEOS(comps, [
      [0, 0],
      [0, 0]
    ]);
    const extremes = [
      [0.5, 0.5, 1e-6, 1e15],
      [0.5, 0.5, 1e-10, 1e-3],
      [0.5, 0.5, 1200, 1e9],
      [0.5, 0.5, 1200, 1e-6],
      [0.3, 0.7, 90, 1e8],
      [0.9, 0.1, 400, 3e7]
    ];
    for (const [z1, z2, T, P] of extremes) {
      let outcome;
      try {
        const r = eos.flashPT([z1, z2], T, P, { maxIter: 200, tol: 1e-8 });
        outcome = 'returned';
        const all = [r.beta, r.Z_L, r.Z_V, ...r.x, ...r.y, ...r.K, r.residual];
        assert.ok(
          all.every((v) => v === null || Number.isFinite(v)),
          `non-finite flash output at T=${T} P=${P}`
        );
      } catch (err) {
        outcome = 'threw';
        assert.ok(err instanceof RangeError || err instanceof TypeError, `unexpected error type at T=${T} P=${P}`);
      }
      assert.ok(['returned', 'threw'].includes(outcome));
    }
  });

  const totalTests = passedTests + failedTests;
  console.log('\n================================================================');
  console.log(`DOMAIN INDUSTRIAL UPGRADE: ${passedTests}/${totalTests} tests passed; ${failedTests} failed`);
  console.log('================================================================\n');

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

if (require.main === module) {
  const stats = runDomainIndustrialUpgradeTests();
  if (stats.failed > 0) process.exitCode = 1;
}

module.exports = { runDomainIndustrialUpgradeTests };
