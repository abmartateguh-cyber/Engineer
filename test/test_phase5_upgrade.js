/**
 * OmniEng Phase 5 Verification Suite
 * GNC Multi-Rate Scheduler, MISRA-C/Rust Autocoder, experimental plant properties,
 * Experimental process-model and water-hammer examples.
 */

'use strict';

const assert = require('assert');
const {
  MultiRateScheduler,
  AlgebraicLoopSolver,
  ModernControlSynthesis
} = require('../src/core/dynamic_simulink/multi_rate_scheduler');
const { AutocoderCRust } = require('../src/core/dynamic_simulink/autocoder_c_rust');
const { ExperimentalPropertyDatabase } = require('../src/core/plant/dippr_database');
const { EXPERIMENTAL_PROPERTY_EXAMPLES } = require('./support/experimental_property_examples');
const { NaphtaliSandholmColumnSolver, WaterHammerMOC } = require('../src/core/plant/naphtali_sandholm_mesh');

function runPhase5Tests() {
  console.log('================================================================');
  console.log('   OmniEng Phase 5 GNC, Plant & Experimental implementation Suite         ');
  console.log('================================================================\n');

  let testsPassed = 0;
  let testsFailed = 0;

  function test(name, fn) {
    try {
      fn();
      testsPassed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      testsFailed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // ----------------------------------------------------
  // 1. Multi-Rate Scheduler & Modern Control Synthesis
  // ----------------------------------------------------
  console.log('1. Multi-Rate Scheduler, Algebraic Loops & Modern Control:');

  test('MultiRateScheduler executes dual-rate tasks (1000Hz and 100Hz) deterministically', () => {
    const scheduler = new MultiRateScheduler({ baseRateHz: 1000 });

    let fastCount = 0;
    let slowCount = 0;

    scheduler.addTask({
      id: 'fast_imu',
      name: 'IMU Attitude Filter',
      sampleRateHz: 1000,
      priority: 1,
      stepFn: (t, dt, inputs, state) => {
        fastCount++;
        return { accelZ: 9.81 + Math.sin(t * 10) };
      }
    });

    scheduler.addTask({
      id: 'slow_nav',
      name: 'GPS Waypoint Guidance',
      sampleRateHz: 100,
      priority: 2,
      stepFn: (t, dt, inputs, state) => {
        slowCount++;
        return { headingTargetDeg: 45.0 };
      }
    });

    scheduler.connectTasks('fast_imu', 'slow_nav');
    scheduler.connectTasks('slow_nav', 'fast_imu');

    const result = scheduler.run(0.1); // 0.1s duration = 100 base ticks

    assert.strictEqual(fastCount, 100, `Fast task should execute 100 times, got ${fastCount}`);
    assert.strictEqual(slowCount, 10, `Slow task should execute 10 times, got ${slowCount}`);
    assert.strictEqual(result.totalTicks, 100);
  });

  test('AlgebraicLoopSolver detects dependency cycle via Tarjan SCC', () => {
    const graph = {
      sensor: ['filter'],
      filter: ['controller'],
      controller: ['plant'],
      plant: ['feedback'],
      feedback: ['controller'], // Cycle: controller -> plant -> feedback -> controller
      display: []
    };

    const sccs = AlgebraicLoopSolver.findAlgebraicLoops(graph);
    assert(sccs.length >= 1, 'Should find at least 1 algebraic cycle');
    const cycle = sccs[0];
    assert(cycle.includes('controller') && cycle.includes('plant') && cycle.includes('feedback'));
  });

  test('AlgebraicLoopSolver solves non-linear loop f(x) - x = 0 via Broyden method', () => {
    // Non-linear coupled algebraic loop:
    // x1 = sqrt(x2 + 2)
    // x2 = 0.5 * x1 + 1.0
    const f = (x) => [Math.sqrt(Math.max(0, x[1]) + 2.0), 0.5 * x[0] + 1.0];

    const sol = AlgebraicLoopSolver.solveBroyden(f, [1.0, 1.0], { tol: 1e-7, maxIter: 30 });
    assert(sol.converged, 'Broyden solver should converge');
    assert(sol.residualNorm < 1e-6, `Residual norm should be < 1e-6, got ${sol.residualNorm}`);
    // Check exact consistency: x1 ~ 1.89898, x2 ~ 1.94949
    const fx = f(sol.x);
    assert(Math.abs(fx[0] - sol.x[0]) < 1e-5);
    assert(Math.abs(fx[1] - sol.x[1]) < 1e-5);
  });

  test('ModernControlSynthesis computes stabilizing continuous LQR gain', () => {
    // Double integrator: x_dot = [0, 1; 0, 0] * x + [0; 1] * u
    const A = [
      [0, 1],
      [0, 0]
    ];
    const B = [[0], [1]];
    const Q = [
      [10, 0],
      [0, 1]
    ];
    const R = [[1]];

    const lqr = ModernControlSynthesis.solveContinuousLQR(A, B, Q, R, 30, 1e-8);
    assert(lqr.K && lqr.K[0], 'LQR gain should exist');
    const [k1, k2] = lqr.K[0];
    assert(k1 > 0, `Proportional gain k1 should be positive, got ${k1}`);
    assert(k2 > 0, `Derivative gain k2 should be positive, got ${k2}`);
    // For double integrator with Q=diag(10,1), R=1: k1 = sqrt(10) ~ 3.162, k2 ~ 2.612
    assert(Math.abs(k1 - Math.sqrt(10)) < 0.1, `Expected k1 ~ 3.162, got ${k1}`);
  });

  test('ModernControlSynthesis computes stabilizing discrete LQR gain', () => {
    const dt = 0.01;
    const A = [
      [1, dt],
      [0, 1]
    ];
    const B = [[0.5 * dt * dt], [dt]];
    const Q = [
      [10, 0],
      [0, 1]
    ];
    const R = [[1]];

    const dlqr = ModernControlSynthesis.solveDiscreteLQR(A, B, Q, R);
    assert(dlqr.K && dlqr.K[0], 'Discrete LQR gain should exist');
    assert(dlqr.K[0][0] > 0 && dlqr.K[0][1] > 0);
  });

  // ----------------------------------------------------
  // 2. MISRA-C:2012 & Bare-Metal #![no_std] Rust Autocoder
  // ----------------------------------------------------
  console.log('\n2. Experimental C and #![no_std] Rust code examples:');

  test('AutocoderCRust emits a requested-label C example without a compliance claim', () => {
    const code = AutocoderCRust.generateMisraC({
      name: 'pitch_damper',
      A: [
        [0.99, 0.01],
        [-0.05, 0.95]
      ],
      B: [[0.001], [0.1]],
      C: [[1.0, 0.0]],
      K: [[2.5, 0.8]],
      sampleRateHz: 500
    });

    assert(code.headerCode.includes('#ifndef PITCH_DAMPER_H'), 'Header contains guard');
    assert(code.headerCode.includes('typedef float float32_t;'), 'Header defines float32_t');
    assert(code.headerCode.includes('void pitch_damper_step('), 'Header declares step function');
    assert(code.headerCode.includes('not assessed'), 'Header states that the requested standard label is not assessed');
    assert(!code.headerCode.includes('Hard Real-Time'), 'Header must not claim hard real-time qualification');

    assert(!code.sourceCode.includes('malloc('), 'Source must NOT contain dynamic malloc');
    assert(!code.sourceCode.includes('free('), 'Source must NOT contain free');
    assert(code.sourceCode.includes('K_GAIN'), 'Source contains static gain table');
    assert(code.sourceCode.includes('u_ctrl[i] > 100.0f'), 'Source contains saturation safeguard');
  });

  test('AutocoderCRust emits a #![no_std] example with unqualified resource behavior', () => {
    const rustCode = AutocoderCRust.generateNoStdRust({
      name: 'attitude_controller',
      A: [
        [0.98, 0.01],
        [-0.02, 0.97]
      ],
      B: [[0.0005], [0.05]],
      C: [[1.0, 0.0]],
      K: [[3.2, 1.1]],
      sampleRateHz: 1000
    });

    assert(rustCode.includes('#![no_std]'), 'Must declare #![no_std]');
    assert(
      rustCode.includes('have not been qualified'),
      'Generated Rust states that resource and safety behavior are not qualified'
    );
    assert(!rustCode.includes('Hard Real-Time Ready'), 'Generated Rust must not claim hard real-time qualification');
    assert(!rustCode.includes('alloc::'), 'Must not require heap alloc');
    assert(rustCode.includes('pub struct ControllerState'), 'Declares ControllerState');
    assert(rustCode.includes('pub fn step(&mut self,'), 'Implements mutable step function');
    assert(rustCode.includes('.clamp(-100.0_f32, 100.0_f32)'), 'Safe clamped outputs');
  });

  // ----------------------------------------------------
  // 3. Experimental property examples & 3-Phase VLLE calculation
  // ----------------------------------------------------
  console.log('\n3. Experimental Plant Property Calculations & 3-Phase VLLE Flash:');

  const dippr = new ExperimentalPropertyDatabase(EXPERIMENTAL_PROPERTY_EXAMPLES);

  test('Experimental property examples resolve by name, formula, and CAS', () => {
    const w1 = dippr.get('Water');
    const w2 = dippr.get('H2O');
    const w3 = dippr.get('7732-18-5');
    assert(w1 && w2 && w3);
    assert.strictEqual(w1.id, 'Water');
    assert.strictEqual(w2.id, 'Water');
    assert.strictEqual(w3.id, 'Water');

    const ch4 = dippr.get('Methane');
    assert(ch4 && ch4.mw === 16.043);

    const c6h6 = dippr.get('Benzene');
    assert(c6h6 && c6h6.family === 'Aromatic');
  });

  test('Experimental vapor-pressure example evaluates water near its normal boiling point', () => {
    const water = dippr.get('Water');
    const Pvap373 = water.getVaporPressure(373.15); // Pa
    // 1 atm = 101325 Pa. Error should be < 0.5%
    const errRel = Math.abs(Pvap373 - 101325.0) / 101325.0;
    assert(errRel < 0.005, `Expected ~101325 Pa, got ${Pvap373} (err=${(errRel * 100).toFixed(3)}%)`);
  });

  test('Experimental liquid-density example evaluates water near ambient conditions', () => {
    const water = dippr.get('Water');
    const rhoL = water.getLiquidDensity(298.15); // 25 C
    // Density of water at 25C is ~997 kg/m^3
    assert(Math.abs(rhoL - 997.0) < 5.0, `Expected ~997 kg/m^3, got ${rhoL}`);
  });

  test('Experimental ideal-gas heat-capacity example returns a finite methane value', () => {
    const ch4 = dippr.get('Methane');
    const cp = ch4.getIdealGasCp(300.0);
    assert(Math.abs(cp - 35.8) < 1.0, `Expected ~35.8 J/(mol*K), got ${cp}`);
  });

  test('Experimental VLLE calculation accepts in-range inputs and labels its output', () => {
    const vlle = dippr.solveVLLEFlash({
      components: ['Water', 'n-Hexane'],
      feedFractions: [0.5, 0.5],
      temperatureK: 340.0,
      pressurePa: 1.2e5 // 1.2 bar
    });

    assert.strictEqual(vlle.dataStatus, 'experimental');
    assert.strictEqual(typeof vlle.converged, 'boolean');
    const { aqueousLiquidL1, organicLiquidL2, vaporV } = vlle.phaseFractions;
    assert([aqueousLiquidL1, organicLiquidL2, vaporV].every(Number.isFinite), 'Phase fractions are finite');
    assert(Math.abs(aqueousLiquidL1 + organicLiquidL2 + vaporV - 1.0) < 1e-3, 'Fractions sum to 1');
  });

  // ----------------------------------------------------
  // 4. Naphtali-Sandholm MESH Distillation Column Solver
  // ----------------------------------------------------
  console.log('\n4. Naphtali-Sandholm Simultaneous MESH Column Solver:');

  test('NaphtaliSandholmColumnSolver converges on 15-stage multi-component distillation', () => {
    const col = NaphtaliSandholmColumnSolver.solve({
      stages: 15,
      feedStage: 8,
      components: ['Propane', 'n-Butane', 'n-Pentane'],
      feedFlows: [15.0, 20.0, 15.0],
      feedTemperatureK: 330.0,
      pressurePa: 1.01325e5,
      refluxRatio: 2.5,
      distillateRate: 25.0
    });

    assert(col.converged, 'Column solver should converge');
    assert(col.iterations <= 25, `Iterations should be <= 25, got ${col.iterations}`);
    assert.strictEqual(col.stages.length, 15);

    // Verify temperature profile monotonically increases from top to bottom
    const topT = col.stages[0].temperatureK;
    const botT = col.stages[14].temperatureK;
    assert(topT < botT, `Top temperature (${topT}K) must be cooler than bottom (${botT}K)`);

    // Verify light key (Propane, index 0) is concentrated in overhead distillate
    const topX = col.stages[0].liquidMoleFractions;
    const botX = col.stages[14].liquidMoleFractions;
    assert(topX[0] > botX[0], 'Propane mole fraction must be higher in overhead distillate than bottoms');
    // Verify heavy key (n-Pentane, index 2) is concentrated in bottoms
    assert(botX[2] > topX[2], 'n-Pentane mole fraction must be higher in bottoms than overhead');
  });

  // ----------------------------------------------------
  // 5. Experimental Dynamic Piping Water Hammer MOC
  // ----------------------------------------------------
  console.log('\n5. Experimental Water Hammer (Method of Characteristics):');

  test('WaterHammerMOC evaluates acoustic wave speed in 6" steel pipe ~1200-1400 m/s', () => {
    const a = WaterHammerMOC.computeWaveSpeed({
      fluidBulkModulusPa: 2.19e9,
      fluidDensityKgM3: 1000.0,
      pipeModulusPa: 200e9,
      pipeDiameterM: 0.168, // 6" pipe
      wallThicknessM: 0.00711 // Sch 40
    });

    assert(a > 1100 && a < 1450, `Wave speed should be 1100-1450 m/s, got ${a} m/s`);
  });

  test('WaterHammerMOC Joukowsky formula evaluates pressure surge ~35-45 bar for 3 m/s water', () => {
    const surge = WaterHammerMOC.computeJoukowskySurge(1000.0, 1300.0, 3.0);
    const deltaPBar = surge.pressureSurgePa / 1e5;
    assert(deltaPBar >= 35.0 && deltaPBar <= 45.0, `Expected ~39 bar, got ${deltaPBar} bar`);
    assert(surge.headSurgeM > 350.0);
  });

  test('WaterHammerMOC returns an experimental transient estimate without a code verdict', () => {
    const sim = WaterHammerMOC.simulateMOC({
      pipeLengthM: 400.0,
      initialVelocityMs: 2.5,
      initialPressurePa: 4.0e5, // 4 bar
      closureTimeSec: 0.15,
      frictionFactor: 0.02,
      totalTimeSec: 1.5
    });

    assert(sim.waveSpeedMs > 1000.0);
    assert(sim.peakPressureBar > 10.0, `Peak transient pressure should exceed 10 bar, got ${sim.peakPressureBar}`);
    assert.strictEqual(sim.validationLevel, 'experimental');
    assert.strictEqual(sim.screeningStatus, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(sim.codeAssessment, 'NOT_PERFORMED');
    assert(sim.pipeHoopStressEstimateMPa > 0.0);
    assert.strictEqual(Object.hasOwn(sim, 'passedAsmeB31_3'), false);
    assert.strictEqual(Object.hasOwn(sim, 'safetyFactor'), false);
    assert(sim.history.length > 5, 'Should generate transient waveform history');
  });

  console.log('\n================================================================');
  console.log(`Phase 5 Verification Finished: ${testsPassed} Passed (${testsFailed} Failed)`);
  console.log('================================================================\n');

  return { testsPassed, testsFailed };
}

if (require.main === module) {
  const result = runPhase5Tests();
  if (result.testsFailed > 0) process.exitCode = 1;
}

module.exports = { runPhase5Tests };
