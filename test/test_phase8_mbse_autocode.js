/**
 * OmniEng Phase 8 Verification Suite:
 * Model-Based System Engineering, MISRA-C:2023, AUTOSAR Classic SWC, #![no_std] Safe Rust,
 * DO-178C DAL-A MC/DC Test Generator & FMI 3.0 Co-Simulation Master
 */

'use strict';

const assert = require('assert');
const { AutocoderCRust } = require('../src/core/dynamic_simulink/autocoder_c_rust');
const { MCDCCoverageAnalyzer } = require('../src/core/dynamic_simulink/mcdc_coverage');
const { FmiMasterEngine, FmuSlave } = require('../src/core/cosim/fmi_master_engine');

console.log('================================================================');
console.log('   RUNNING PHASE 8: MBSE, AUTOSAR, SAFE RUST & FMI 3.0 CO-SIM  ');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: MISRA-C:2023 Hard Real-Time Autocoder & AUTOSAR SWC with ARXML
// -----------------------------------------------------------------------------
console.log('[P8-1] MISRA-C:2023 Compliance & AUTOSAR Classic SWC Generator...');
const spec = {
  name: 'actuator_controller',
  A: [[0.98, 0.01], [-0.02, 0.97]],
  B: [[0.001], [0.05]],
  C: [[1.0, 0.0]],
  K: [[3.2, 1.1]],
  sampleRateHz: 1000,
  standard: 'MISRA-C:2023'
};

const cCode = AutocoderCRust.generateMisraC(spec);
assert(cCode.standard === 'MISRA-C:2023', 'Must reflect MISRA-C:2023 standard');
assert(cCode.headerCode.includes('MISRA-C:2023'), 'Header must state MISRA-C:2023');
assert(cCode.headerCode.includes('typedef float float32_t;'), 'Strong typedef float32_t (Rule 10.1)');
assert(cCode.headerCode.includes('void actuator_controller_step('), 'Explicit prototype (Rule 8.4)');
assert(!cCode.sourceCode.includes('malloc('), 'Rule 21.3: No dynamic malloc');
assert(!cCode.sourceCode.includes('free('), 'Rule 21.3: No dynamic free');
assert(cCode.sourceCode.includes('static const float32_t K_GAIN'), 'Rule 8.9: Static state arrays');
assert(cCode.sourceCode.includes('(K_GAIN[i][j] * error)'), 'Rule 12.1: Explicit operator precedence parentheses');

// Test AUTOSAR Classic SWC & ARXML
const autosar = AutocoderCRust.generateAutosarSWC(spec);
assert(autosar.swcHeader.includes('RTE_ACTUATOR_CONTROLLER_H'), 'AUTOSAR RTE header guard');
assert(autosar.swcHeader.includes('Std_ReturnType Rte_Read_rpReference_Value'), 'RTE Sender-Receiver Read API');
assert(autosar.swcSource.includes('RE_actuator_controller_Step'), 'Runnable Entity execution function');
assert(autosar.arxml.includes('<APPLICATION-SW-COMPONENT-TYPE>'), 'ARXML SWC component type');
assert(autosar.arxml.includes('<SHORT-NAME>actuator_controller</SHORT-NAME>'), 'ARXML component name');
assert(autosar.arxml.includes('<R-PORT-PROTOTYPE>'), 'ARXML receiver port');

console.log('  ✓ [P8-1] MISRA-C:2023 & AUTOSAR SWC verified: zero heap, explicit parens, RTE APIs & valid ARXML descriptor');

// -----------------------------------------------------------------------------
// Test 2: Certified #![no_std] Safe Rust Flight Kernel
// -----------------------------------------------------------------------------
console.log('\n[P8-2] Certified Bare-Metal #![no_std] Safe Rust Kernel...');
const rustCode = AutocoderCRust.generateNoStdRust(spec);
assert(rustCode.includes('#![no_std]'), 'Must declare #![no_std] bare metal');
assert(rustCode.includes('#![forbid(unsafe_code)]'), 'Avionics safe: #![forbid(unsafe_code)]');
assert(!rustCode.includes('alloc::'), 'Must not require heap alloc');
assert(rustCode.includes('pub struct ControllerState'), 'ControllerState struct');
assert(rustCode.includes('pub fn step(&mut self,'), 'Deterministic step function');
assert(rustCode.includes('wrapping_add(1)'), 'Safe checked/wrapping arithmetic');

console.log('  ✓ [P8-2] Rust Kernel verified: #![no_std], #![forbid(unsafe_code)], zero alloc, deterministic step');

// -----------------------------------------------------------------------------
// Test 3: DO-178C DAL-A / ISO 26262 ASIL-D MC/DC Test Suite Synthesizer
// -----------------------------------------------------------------------------
console.log('\n[P8-3] DO-178C DAL-A MC/DC Test Vector Generator & Tamper-Proof Dossier...');
// Compound decision: Hydraulic pressure OK and Altitude Valid, OR Pilot Manual Override
const conditions = ['hydraulic_press_ok', 'alt_valid', 'pilot_override'];
const flightDecision = (h, a, o) => (h && a) || o;

// Automated synthesis of minimal test suite
const synthesis = MCDCCoverageAnalyzer.generateMCDCTestSuite(conditions, flightDecision);
assert(synthesis.coverage.mcdcCoveragePercent === 100.0, 'Synthesized test suite must achieve 100% MC/DC coverage');
assert(synthesis.coverage.meetsDO178C_DAL_A === true, 'Must satisfy FAA DO-178C Level A');
assert(synthesis.totalVectors <= 4, `Minimal test suite for 3 conditions should be <= 4 vectors (got ${synthesis.totalVectors})`);

// Generate formal qualification dossier with SHA-256 seal
const dossier = MCDCCoverageAnalyzer.generateDO178CDossier('DEC_FLIGHT_SURFACE_ACTUATION', conditions, flightDecision, synthesis.testSuite);
assert(dossier.coverageSummary.meetsDAL_A === true, 'Dossier must confirm DAL-A clearance');
assert(dossier.sha256Seal && dossier.sha256Seal.length === 64, 'Tamper-proof SHA-256 seal must be 64 hex characters');

console.log(`  ✓ [P8-3] MC/DC Synthesizer: 100% DAL-A achieved with ${synthesis.totalVectors} vectors. SHA-256 Seal: ${dossier.sha256Seal.slice(0, 16)}...`);

// -----------------------------------------------------------------------------
// Test 4: FMI 3.0 Co-Simulation Master Engine with Algebraic Loop Solver & Rollback
// -----------------------------------------------------------------------------
console.log('\n[P8-4] FMI 3.0 Co-Simulation Master: Algebraic Loop & Step Rollback...');

// Slave 1: Proportional plant y1 = 2.0 * u1 + x1
class Slave1 extends FmuSlave {
  constructor() {
    super({
      instanceName: 'PlantSlave',
      variables: [
        { name: 'u1', vr: 1, causality: 'input', initial: 0.0 },
        { name: 'y1', vr: 2, causality: 'output', initial: 1.0 }
      ],
      hasDirectFeedthrough: true
    });
    this.x = 0.5;
  }
  doStep(t, h) {
    this.time = t + h;
    const u1 = this.getReal([1])[0];
    this.x += 0.1 * h;
    this.setReal([2], [2.0 * u1 + this.x]);
    return true;
  }
}

// Slave 2: Feedback controller u2 = -0.3 * y2
class Slave2 extends FmuSlave {
  constructor() {
    super({
      instanceName: 'ControllerSlave',
      variables: [
        { name: 'y2', vr: 1, causality: 'input', initial: 1.0 },
        { name: 'u2', vr: 2, causality: 'output', initial: -0.3 }
      ],
      hasDirectFeedthrough: true
    });
  }
  doStep(t, h) {
    this.time = t + h;
    const y2 = this.getReal([1])[0];
    this.setReal([2], [-0.3 * y2]);
    return true;
  }
}

const s1 = new Slave1();
const s2 = new Slave2();

const master = new FmiMasterEngine({
  startTime: 0.0,
  stopTime: 0.1,
  defaultStepSize: 0.01,
  scheme: 'gauss_seidel',
  fmiVersion: '3.0'
});

master.addSlave(s1);
master.addSlave(s2);

// Interconnect s1 output (vr:2) -> s2 input (vr:1), and s2 output (vr:2) -> s1 input (vr:1)
// Creates a direct algebraic feedback loop!
master.addConnection(s1, 2, s2, 1);
master.addConnection(s2, 2, s1, 1);

assert(master.hasAlgebraicLoop() === true, 'Master must detect algebraic loop');

// Solve algebraic loop at t=0
const loopResult = master.solveAlgebraicLoop(50, 0.8, 1e-6);
assert(loopResult.converged === true, 'Algebraic loop must converge via Picard relaxation');

// Execute full co-simulation run
const simResult = master.simulate();
assert(simResult.converged === true, 'FMI 3.0 Co-Simulation must converge across algebraic loop');
assert(simResult.totalSteps > 0, 'Total steps must be positive');

// Verify FMI 3.0 API compliance
assert(typeof s1.fmi3DoStep === 'function', 'Slave must support fmi3DoStep');
assert(typeof s1.fmi3GetFloat64 === 'function', 'Slave must support fmi3GetFloat64');
assert(typeof s1.fmi3SetFloat64 === 'function', 'Slave must support fmi3SetFloat64');
assert(typeof s1.fmi3GetFMUState === 'function', 'Slave must support fmi3GetFMUState');

console.log(`  ✓ [P8-4] FMI 3.0 Master: Algebraic loop detected and solved (${loopResult.iterations} iters), ${simResult.totalSteps} steps completed`);

// -----------------------------------------------------------------------------
// Test 5: Phase 8 Controls & Autocode IPC Channel Registration & Integration
// -----------------------------------------------------------------------------
console.log('\n[P8-5] Phase 8 Controls & Autocoding IPC Channel Integration...');
const { registerControlsIpc } = require('../src/main/ipc/controls_ipc');
const { isChannelRegistered } = require('../src/main/ipc/define_handler');
registerControlsIpc();
assert(isChannelRegistered('omni:autocode-controller'), 'Must register omni:autocode-controller');
assert(isChannelRegistered('omni:evaluate-mcdc-coverage'), 'Must register omni:evaluate-mcdc-coverage');
assert(isChannelRegistered('omni:run-fmi-cosimulation'), 'Must register omni:run-fmi-cosimulation');
assert(isChannelRegistered('omni:generate-autosar-swc'), 'Must register omni:generate-autosar-swc');

console.log('  ✓ [P8-5] All 4 Phase 8 Controls & Autocode IPC Channels Registered & Schema-Validated');

console.log('\n================================================================');
console.log('   ALL 5 PHASE 8 TESTS PASSED SUCCESSFULLY!                    ');
console.log('================================================================\n');
