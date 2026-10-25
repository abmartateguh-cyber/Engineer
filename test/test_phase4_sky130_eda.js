/**
 * Experimental EDA library adapter and LEF/DEF syntax smoke suite.
 */

'use strict';

const assert = require('assert');
const { Sky130PdkAdapter } = require('../src/core/eda/sky130_pdk_adapter');
const { LefDefParser } = require('../src/core/eda/lef_def_parser');
const { StaticTimingAnalysis } = require('../src/core/eda/static_timing_analysis');
const { getExperimentalEdaLibraryExample } = require('./support/experimental_eda_library_example');
const {
  handleStandardCellLibraryRequest,
  handleLefParseRequest,
  handleDefParseRequest,
  handleDefSerializeRequest
} = require('../src/main/ipc/eda_ipc');

console.log('================================================================');
console.log('   RUNNING PHASE 4: EXPERIMENTAL LIBRARY AND LEF/DEF SMOKE CHECKS');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Synthetic test-only library and RC delay estimate.
// -----------------------------------------------------------------------------
console.log('[P4-1] Synthetic test-only library and caller-data RC delay estimate...');
const pdk = new Sky130PdkAdapter(getExperimentalEdaLibraryExample());
const unconfiguredAdapter = new Sky130PdkAdapter();
assert.strictEqual(unconfiguredAdapter.available, false);
assert.deepStrictEqual(unconfiguredAdapter.cells, {});
assert.throws(() => unconfiguredAdapter.generateLEF(), /caller-supplied library geometry/);
assert.strictEqual(handleStandardCellLibraryRequest({}).status, 'unavailable');
assert.strictEqual(handleStandardCellLibraryRequest(null).error.code, 'INVALID_INPUT');
assert.strictEqual(
  handleStandardCellLibraryRequest({ action: 'compute-delay', library: getExperimentalEdaLibraryExample() }).status,
  'invalid-input'
);
assert.strictEqual(handleLefParseRequest({}).error.code, 'INVALID_INPUT');
assert.strictEqual(handleLefParseRequest(null).error.code, 'INVALID_INPUT');
assert.strictEqual(handleDefParseRequest({}).error.code, 'INVALID_INPUT');
assert.strictEqual(handleDefSerializeRequest({}).error.code, 'INVALID_INPUT');
const missingPinGeometry = getExperimentalEdaLibraryExample();
delete missingPinGeometry.cells.demo_inv.pins.A.rectUm;
assert.throws(() => new Sky130PdkAdapter(missingPinGeometry), /four explicit rectUm coordinates/);

const invDelayTT = pdk.computeCellDelay('demo_inv', 10.0, 'typical');
const invDelaySS = pdk.computeCellDelay('demo_inv', 10.0, 'slow');
const invDelayFF = pdk.computeCellDelay('demo_inv', 10.0, 'fast');

assert.strictEqual(invDelayTT.dataStatus, 'caller-supplied-unverified');
assert(Math.abs(invDelayTT.totalDelayPs - 53.0) < 1e-9, 'The adapter must apply the supplied RC delay equation');
assert(invDelaySS.totalDelayPs > invDelayTT.totalDelayPs, 'The supplied slow-corner factor must increase the estimate');
assert(invDelayFF.totalDelayPs < invDelayTT.totalDelayPs, 'The supplied fast-corner factor must reduce the estimate');
assert.strictEqual(
  handleStandardCellLibraryRequest({
    action: 'compute-delay',
    library: getExperimentalEdaLibraryExample(),
    cellName: 'demo_inv',
    loadCapFf: 10,
    corner: 'typical'
  }).totalDelayPs,
  invDelayTT.totalDelayPs
);

const dffDelay = pdk.computeCellDelay('demo_dff', 15.0, 'typical');
assert(
  dffDelay.totalDelayPs > invDelayTT.totalDelayPs,
  'Synthetic sequential-cell fixture should have a larger base delay'
);

console.log(
  `  ✓ [P4-1] Synthetic-fixture RC estimates: typical = ${invDelayTT.totalDelayPs} ps, slow = ${invDelaySS.totalDelayPs} ps, fast = ${invDelayFF.totalDelayPs} ps`
);

// -----------------------------------------------------------------------------
// Test 2: IEEE LEF 5.8 Generation & Full AST Parsing
// -----------------------------------------------------------------------------
console.log('\n[P4-2] IEEE LEF 5.8 Generation & AST Parsing...');
const lefText = pdk.generateLEF();
assert(lefText.includes('VERSION 5.8 ;'), 'LEF must have VERSION 5.8');
assert(lefText.includes('MACRO demo_inv'), 'LEF must contain the supplied demo cell');
assert(lefText.includes('LAYER metal1'), 'LEF must serialize the supplied layer');
const suppliedRect = pdk.cells.demo_inv.pins.A.rectUm.map((coordinate) => coordinate.toFixed(3)).join(' ');
assert(
  lefText.includes(`RECT ${suppliedRect} ;`),
  'LEF must serialize the supplied pin rectangle without inventing geometry'
);

const parsedLef = LefDefParser.parseLEF(lefText);
assert.strictEqual(parsedLef.version, '5.8');
assert(Object.keys(parsedLef.macros).length >= 5, 'Should parse the supplied synthetic cells');
assert(parsedLef.macros.demo_inv.pins.A, 'Synthetic inverter example should have pin A');
assert.strictEqual(parsedLef.macros.demo_inv.pins.A.direction, 'INPUT');
assert.strictEqual(handleLefParseRequest({ content: lefText }).macroCount, 5);
console.log(
  `  ✓ [P4-2] Parsed LEF with ${Object.keys(parsedLef.layers).length} layers, ${Object.keys(parsedLef.macros).length} standard cell macros`
);

// -----------------------------------------------------------------------------
// Test 3: IEEE DEF 5.8 Layout Parsing & Round-Trip Serialization
// -----------------------------------------------------------------------------
console.log('\n[P4-3] IEEE DEF 5.8 Place & Route Parsing / Serialization...');
const sampleDef = `VERSION 5.8 ;
DESIGN counter_top ;
UNITS DISTANCE MICRONS 1000 ;
DIEAREA ( 0 0 ) ( 50000 50000 ) ;

COMPONENTS 4 ;
  - inst_inv0 demo_inv + PLACED ( 10000 5000 ) N ;
  - inst_nand0 demo_nand2 + PLACED ( 15000 5000 ) FS ;
  - inst_buf0 demo_buf + PLACED ( 20000 5000 ) N ;
  - inst_dff0 demo_dff + PLACED ( 25000 5000 ) N ;
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
assert.strictEqual(parsedDef.components[0].macro, 'demo_inv');
assert.strictEqual(parsedDef.nets[0].routedSegments.length, 1);
assert.strictEqual(handleDefParseRequest({ content: sampleDef }).componentCount, 4);

// Round trip serialization
const serializedDef = LefDefParser.serializeDEF(parsedDef);
const reParsedDef = LefDefParser.parseDEF(serializedDef);
assert.strictEqual(reParsedDef.components.length, 4, 'Round-trip components must match');
assert.strictEqual(reParsedDef.nets.length, 2, 'Round-trip nets must match');
assert.strictEqual(handleDefSerializeRequest({ defData: parsedDef }).success, true);
console.log(
  `  ✓ [P4-3] DEF 5.8 Round-Trip verified: 4 placed cells, 2 routed nets, dieArea: ${parsedDef.dieArea.x2 / 1000}x${parsedDef.dieArea.y2 / 1000} µm`
);

// -----------------------------------------------------------------------------
// Test 4: Multi-Corner Multi-Mode (MCMM) STA with OCV Derating
// -----------------------------------------------------------------------------
console.log('\n[P4-4] Experimental multi-corner timing screening...');
const criticalPath = {
  name: 'counter_stage_0_to_stage_1',
  clockPeriodNs: 4.0, // 250 MHz target
  clockSkewNs: 0.05,
  tLaunchCqNs: 0.12, // DFF Clk-to-Q
  tSetupNs: 0.04,
  tHoldNs: 0.02,
  gateDelaysNs: [0.085, 0.11, 0.095], // 3 logic gates
  wireDelaysNs: [0.025, 0.035, 0.03] // PEX RC interconnect
};

const mcmmReport = StaticTimingAnalysis.evaluateMCMM(criticalPath);
assert.strictEqual(mcmmReport.cornerCount, 3, 'Evaluated the illustrative PVT corners');
assert.strictEqual(mcmmReport.worstSetupCorner, 'ss_100C_1v60', 'Worst setup corner must be SS 100C');
assert.strictEqual(mcmmReport.worstHoldCorner, 'ff_n40C_1v95', 'Worst hold corner must be FF -40C');
assert.strictEqual(mcmmReport.validationLevel, 'experimental');
assert(mcmmReport.screeningPassed, 'Illustrative timing screen should pass for this fixture');
assert(mcmmReport.worstNegativeSlackSetupNs > 0, 'Illustrative setup slack should be positive');
assert(mcmmReport.worstNegativeSlackHoldNs > 0, 'Illustrative hold slack should be positive');

console.log(
  `  ✓ [P4-4] Experimental timing screening: setup slack = +${mcmmReport.worstNegativeSlackSetupPs} ps, hold slack = +${mcmmReport.worstNegativeSlackHoldPs} ps`
);

// -----------------------------------------------------------------------------
// Test 5: EDA IPC Channel Registration & Execution
// -----------------------------------------------------------------------------
console.log('\n[P4-5] EDA IPC channel registration...');
const { registerEdaIpc } = require('../src/main/ipc/eda_ipc');
const { isChannelRegistered } = require('../src/main/ipc/define_handler');
registerEdaIpc();
assert(isChannelRegistered('omni:eda-sky130-pdk'), 'Must register omni:eda-sky130-pdk');
assert(isChannelRegistered('omni:eda-parse-lef'), 'Must register omni:eda-parse-lef');
assert(isChannelRegistered('omni:eda-parse-def'), 'Must register omni:eda-parse-def');
assert(isChannelRegistered('omni:eda-serialize-def'), 'Must register omni:eda-serialize-def');
console.log('  ✓ [P4-5] All 4 legacy EDA IPC channels remain registered');

console.log('\n================================================================');
console.log('   ALL 5 PHASE 4 TESTS PASSED SUCCESSFULLY!                    ');
console.log('================================================================\n');
