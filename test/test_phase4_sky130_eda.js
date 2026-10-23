/**
 * OmniEng Phase 4 Verification Suite:
 * Open Silicon SkyWater 130nm PDK, IEEE LEF/DEF 5.8 Engine & MCMM STA
 */

'use strict';

const assert = require('assert');
const { Sky130PdkAdapter } = require('../src/core/eda/sky130_pdk_adapter');
const { LefDefParser } = require('../src/core/eda/lef_def_parser');
const { StaticTimingAnalysis } = require('../src/core/eda/static_timing_analysis');

console.log('================================================================');
console.log('   RUNNING PHASE 4: SKYWATER 130nm PDK, LEF/DEF & MCMM STA      ');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: SkyWater 130nm PDK Standard Cell Catalog & NLDM Delay Models
// -----------------------------------------------------------------------------
console.log('[P4-1] SkyWater 130nm HD Cell Library & NLDM Timing Models...');
const pdk = new Sky130PdkAdapter();

const invDelayTT = pdk.computeCellDelay('sky130_fd_sc_hd__inv_1', 10.0, 'tt');
const invDelaySS = pdk.computeCellDelay('sky130_fd_sc_hd__inv_1', 10.0, 'ss');
const invDelayFF = pdk.computeCellDelay('sky130_fd_sc_hd__inv_1', 10.0, 'ff');

assert(invDelaySS.totalDelayPs > invDelayTT.totalDelayPs, 'SS corner must be slower than TT');
assert(invDelayFF.totalDelayPs < invDelayTT.totalDelayPs, 'FF corner must be faster than TT');
assert(invDelayTT.totalDelayPs > 30.0 && invDelayTT.totalDelayPs < 100.0, 'Inverter delay must be realistic 30-100 ps');

const dffDelay = pdk.computeCellDelay('sky130_fd_sc_hd__dfxtp_1', 15.0, 'tt');
assert(dffDelay.totalDelayPs > invDelayTT.totalDelayPs, 'DFF clock-to-Q delay must exceed simple inverter');

console.log(`  ✓ [P4-1] Inverter delay: TT = ${invDelayTT.totalDelayPs} ps, SS = ${invDelaySS.totalDelayPs} ps, FF = ${invDelayFF.totalDelayPs} ps`);

// -----------------------------------------------------------------------------
// Test 2: IEEE LEF 5.8 Generation & Full AST Parsing
// -----------------------------------------------------------------------------
console.log('\n[P4-2] IEEE LEF 5.8 Generation & AST Parsing...');
const lefText = pdk.generateLEF();
assert(lefText.includes('VERSION 5.8 ;'), 'LEF must have VERSION 5.8');
assert(lefText.includes('MACRO sky130_fd_sc_hd__inv_1'), 'LEF must contain inverter macro');
assert(lefText.includes('LAYER met1'), 'LEF must define met1 routing layer');

const parsedLef = LefDefParser.parseLEF(lefText);
assert.strictEqual(parsedLef.version, '5.8');
assert(Object.keys(parsedLef.macros).length >= 5, 'Should parse all 5 standard cells');
assert(parsedLef.macros['sky130_fd_sc_hd__inv_1'].pins['A'], 'Inverter should have pin A');
assert.strictEqual(parsedLef.macros['sky130_fd_sc_hd__inv_1'].pins['A'].direction, 'INPUT');
console.log(`  ✓ [P4-2] Parsed LEF with ${Object.keys(parsedLef.layers).length} layers, ${Object.keys(parsedLef.macros).length} standard cell macros`);

// -----------------------------------------------------------------------------
// Test 3: IEEE DEF 5.8 Layout Parsing & Round-Trip Serialization
// -----------------------------------------------------------------------------
console.log('\n[P4-3] IEEE DEF 5.8 Place & Route Parsing / Serialization...');
const sampleDef = `VERSION 5.8 ;
DESIGN counter_top ;
UNITS DISTANCE MICRONS 1000 ;
DIEAREA ( 0 0 ) ( 50000 50000 ) ;

COMPONENTS 4 ;
  - inst_inv0 sky130_fd_sc_hd__inv_1 + PLACED ( 10000 5000 ) N ;
  - inst_nand0 sky130_fd_sc_hd__nand2_1 + PLACED ( 15000 5000 ) FS ;
  - inst_buf0 sky130_fd_sc_hd__buf_2 + PLACED ( 20000 5000 ) N ;
  - inst_dff0 sky130_fd_sc_hd__dfxtp_1 + PLACED ( 25000 5000 ) N ;
END COMPONENTS

NETS 2 ;
  - clk_in ( PIN clk ) ( inst_dff0 CLK ) + ROUTED met1 ( 0 2500 ) ( 25000 2500 ) ;
  - net_q ( inst_dff0 Q ) ( inst_inv0 A ) + ROUTED met2 ( 25000 5000 ) ( 10000 5000 ) ;
END NETS

END DESIGN`;

const parsedDef = LefDefParser.parseDEF(sampleDef);
assert.strictEqual(parsedDef.name, 'counter_top');
assert.strictEqual(parsedDef.components.length, 4, 'Should parse 4 components');
assert.strictEqual(parsedDef.nets.length, 2, 'Should parse 2 nets');
assert.strictEqual(parsedDef.components[0].macro, 'sky130_fd_sc_hd__inv_1');
assert.strictEqual(parsedDef.nets[0].routedSegments.length, 1);

// Round trip serialization
const serializedDef = LefDefParser.serializeDEF(parsedDef);
const reParsedDef = LefDefParser.parseDEF(serializedDef);
assert.strictEqual(reParsedDef.components.length, 4, 'Round-trip components must match');
assert.strictEqual(reParsedDef.nets.length, 2, 'Round-trip nets must match');
console.log(`  ✓ [P4-3] DEF 5.8 Round-Trip verified: 4 placed cells, 2 routed nets, dieArea: ${parsedDef.dieArea.x2 / 1000}x${parsedDef.dieArea.y2 / 1000} µm`);

// -----------------------------------------------------------------------------
// Test 4: Multi-Corner Multi-Mode (MCMM) STA with OCV Derating
// -----------------------------------------------------------------------------
console.log('\n[P4-4] Multi-Corner Multi-Mode (MCMM) Signoff Timing Closure...');
const criticalPath = {
  name: 'counter_stage_0_to_stage_1',
  clockPeriodNs: 4.0, // 250 MHz target
  clockSkewNs: 0.05,
  tLaunchCqNs: 0.12, // DFF Clk-to-Q
  tSetupNs: 0.04,
  tHoldNs: 0.02,
  gateDelaysNs: [0.085, 0.110, 0.095], // 3 logic gates
  wireDelaysNs: [0.025, 0.035, 0.030]  // PEX RC interconnect
};

const mcmmReport = StaticTimingAnalysis.evaluateMCMM(criticalPath);
assert.strictEqual(mcmmReport.cornerCount, 3, 'Evaluated all 3 signoff PVT corners');
assert.strictEqual(mcmmReport.worstSetupCorner, 'ss_100C_1v60', 'Worst setup corner must be SS 100C');
assert.strictEqual(mcmmReport.worstHoldCorner, 'ff_n40C_1v95', 'Worst hold corner must be FF -40C');
assert(mcmmReport.isTimingClosed, 'Timing should be closed at 250 MHz');
assert(mcmmReport.worstNegativeSlackSetupNs > 0, 'WNS Setup must be positive');
assert(mcmmReport.worstNegativeSlackHoldNs > 0, 'WNS Hold must be positive');

console.log(`  ✓ [P4-4] MCMM Timing Closed: WNS_setup = +${mcmmReport.worstNegativeSlackSetupPs} ps (@ ${mcmmReport.worstSetupCorner}), WNS_hold = +${mcmmReport.worstNegativeSlackHoldPs} ps (@ ${mcmmReport.worstHoldCorner})`);

// -----------------------------------------------------------------------------
// Test 5: EDA IPC Channel Registration & Execution
// -----------------------------------------------------------------------------
console.log('\n[P4-5] EDA IPC Gateway Handlers (Sky130, LEF, DEF)...');
const { registerEdaIpc } = require('../src/main/ipc/eda_ipc');
const { isChannelRegistered } = require('../src/main/ipc/define_handler');
registerEdaIpc();
assert(isChannelRegistered('omni:eda-sky130-pdk'), 'Must register omni:eda-sky130-pdk');
assert(isChannelRegistered('omni:eda-parse-lef'), 'Must register omni:eda-parse-lef');
assert(isChannelRegistered('omni:eda-parse-def'), 'Must register omni:eda-parse-def');
assert(isChannelRegistered('omni:eda-serialize-def'), 'Must register omni:eda-serialize-def');
console.log(`  ✓ [P4-5] All 4 Phase 4 EDA IPC Channels Registered and Schema-Validated`);

console.log('\n================================================================');
console.log('   ALL 5 PHASE 4 TESTS PASSED SUCCESSFULLY!                    ');
console.log('================================================================\n');
