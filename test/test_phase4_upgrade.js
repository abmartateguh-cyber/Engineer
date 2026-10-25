/**
 * OmniEng Phase 4 Experimental Workflow Smoke Suite: EDA & High-Order Optics
 * Validates:
 * 1. Example aspheric optics, thin-film calculations, and tolerancing
 * 2. Standalone AIG operations and partial SystemVerilog declaration inspection
 * 3. Experimental clock-tree, maze-routing, and BSIM4 routines
 */

const {
  AsphericSurface,
  ThinFilmMultilayerCoating,
  MultiFieldRayFanAnalyzer,
  MonteCarloOpticalTolerancing
} = require('../src/core/optics/aspheric_freeform_optics');
const {
  SystemVerilogSynthesizer,
  AndInverterGraph,
  LIBERTY_LIBRARY,
  SKY130_STANDARD_CELLS,
  TechnologyMapper
} = require('../src/core/eda/system_verilog_synth');
const {
  ClockSink,
  ClockTreeSynthesizer,
  MazeRouterPathFinder,
  BSIM4MosfetModel
} = require('../src/core/eda/clock_tree_synthesis');
const { Vector3 } = require('../src/core/math/linear_algebra');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    testsFailed++;
    throw new Error(message);
  } else {
    console.log(`  ✓ ${message}`);
    testsPassed++;
  }
}

function runPhase4Tests() {
  console.log('================================================================');
  console.log('   OmniEng Phase 4 EDA & High-Order Optics Experimental Workflow Smoke Suite   ');
  console.log('================================================================\n');

  // --- Group 1: High-Order Aspheric Optics & Thin Films ---
  console.log('1. High-Order Aspheric Optics, Thin-Film Coatings & Tolerancing:');
  {
    // Test 1.1: Even polynomial aspheric sag evaluation
    const asphere = new AsphericSurface({
      radius: 40.0,
      conic: -1.0, // Paraboloid base
      coefficients: { alpha4: 1.5e-6, alpha6: -2.0e-9 }
    });
    const sagCenter = asphere.evaluateSag(0.0);
    assert(Math.abs(sagCenter) < 1e-12, 'Aspheric sag at optical axis r = 0 evaluates exactly to 0.0');

    const sagEdge = asphere.evaluateSag(10.0);
    assert(sagEdge > 1.0, `Aspheric sag at r = 10mm evaluates smoothly: ${sagEdge.toFixed(4)} mm`);

    // Test 1.2: Newton-Raphson Ray-Surface Intersection
    const rayOrigin = new Vector3(5.0, 0.0, -10.0);
    const rayDir = new Vector3(0.0, 0.0, 1.0);
    const hit = asphere.intersectRay(rayOrigin, rayDir);
    assert(hit.hit === true, 'Newton-Raphson ray tracer successfully intersects aspheric surface');
    assert(hit.point.z > 0, `Intersection coordinate confirmed at z = ${hit.point.z.toFixed(4)} mm`);
    assert(hit.normal && Math.abs(hit.normal.length() - 1.0) < 1e-5, 'Surface normal vector is unit length');

    // Test 1.3: Multilayer Thin-Film Dielectric Coating (2x2 Matrix Method)
    // 4-layer Broadband Anti-Reflective (BBAR) coating: MgF2 / TiO2 stack
    const bbar = new ThinFilmMultilayerCoating('BBAR Anti-Reflective');
    bbar.addLayer('MgF2', 1.38, 99.6).addLayer('TiO2', 2.3, 119.56);

    const coatRes = bbar.evaluateCoating(550.0, 0.0, 1.52, 1.0);
    assert(
      coatRes.reflectance < 0.03,
      `BBAR coating achieves low reflectance at 550nm: ${(coatRes.reflectance * 100).toFixed(2)}% (< 3%)`
    );
    assert(coatRes.transmittance > 0.97, `BBAR coating transmittance: ${(coatRes.transmittance * 100).toFixed(2)}%`);

    // Test 1.4: Multi-field ray fans
    const fanAnalyzer = new MultiFieldRayFanAnalyzer([asphere], 50.0);
    const fans = fanAnalyzer.evaluateFieldFans([0.0, 7.0, 14.0, 20.0], 9);
    assert(fans.length === 4, 'Multi-field ray fans evaluated across 4 field angles');
    assert(fans[0].rayFan.length === 9, 'Ray fan contains 9 pupil samples');

    // Test 1.5: Monte Carlo manufacturing tolerancing
    const seed = 0x5eedc0de;
    const tolerancing = new MonteCarloOpticalTolerancing([asphere], { seed });
    const mcResults = tolerancing.runTrials(50);
    const repeatedResults = new MonteCarloOpticalTolerancing([asphere], { seed }).runTrials(50);
    assert(mcResults.numTrials === 50, 'Monte Carlo tolerancing executed 50 trials');
    assert(
      mcResults.meanRmsSpotUm > 0 &&
        mcResults.seed === seed &&
        mcResults.reproducible === true &&
        mcResults.randomAlgorithm === 'mulberry32-v1' &&
        JSON.stringify(mcResults) === JSON.stringify(repeatedResults),
      `Seeded Monte Carlo repeat is deterministic; mean RMS spot radius: ${mcResults.meanRmsSpotUm.toFixed(2)} um`
    );
  }

  // --- Group 2: Partial SystemVerilog Inspection and AIG Operations ---
  console.log('\n2. Partial SystemVerilog Inspection and AIG Operations:');
  {
    // Test 2.1: And-Inverter Graph (AIG) constant folding & idempotency
    const aig = new AndInverterGraph();
    const inA = aig.addPrimaryInput('a');
    const inB = aig.addPrimaryInput('b');
    const andNode = aig.addAnd(inA, false, inA, false); // a AND a = a
    assert(andNode.node.id === inA.id, 'AIG idempotency: a AND a collapses to a');

    // Test 2.2: Partial SystemVerilog declaration inspection
    const svCode = `
      module alu_core #(parameter WIDTH = 8) (
        input logic clk,
        input logic rst_n,
        input logic [WIDTH-1:0] a,
        input logic [WIDTH-1:0] b,
        output logic [WIDTH-1:0] sum
      );
        always_ff @(posedge clk or negedge rst_n) begin
          if (!rst_n) sum <= '0;
          else sum <= a + b;
        end
      endmodule
    `;

    const synth = new SystemVerilogSynthesizer();
    const synthResult = synth.synthesize(svCode);
    assert(synthResult.moduleName === 'alu_core', 'SystemVerilog module name elaborated correctly');
    assert(synthResult.parameters.WIDTH === 8, 'SystemVerilog parameter WIDTH=8 parsed');
    assert(
      synthResult.analysisStatus === 'experimental-partial',
      'SystemVerilog declaration inspection is labeled experimental'
    );
    assert(synthResult.aigMetrics.status === 'unavailable', 'RTL expressions are not reported as an elaborated AIG');
    assert(synthResult.technologyMapping.status === 'unavailable', 'Unimplemented Liberty mapping reports unavailable');
    assert(synthResult.technologyMapping.targetLibrary === null, 'No unsupported foundry library is claimed');
    assert(synthResult.registers.status === 'unavailable', 'No fabricated sequential register is returned');
    assert(
      LIBERTY_LIBRARY.available === false && Object.keys(LIBERTY_LIBRARY.cells).length === 0,
      'Legacy Liberty export contains no fabricated cells'
    );
    assert(SKY130_STANDARD_CELLS.available === false, 'Legacy SKY130 export is an unavailable sentinel');
    assert(
      TechnologyMapper.mapToLiberty(null, null).status === 'unavailable',
      'Legacy mapper returns an explicit unavailable result'
    );
  }

  // --- Group 3: Clock Tree Synthesis, Maze Routing & BSIM4 ---
  console.log('\n3. Clock Tree Synthesis (CTS), PathFinder Maze Routing & BSIM4:');
  {
    // Test 3.1: Clock Tree Synthesis with balanced H-tree / MMM
    const sinks = [
      new ClockSink(0, 10.0, 10.0),
      new ClockSink(1, 10.0, 90.0),
      new ClockSink(2, 90.0, 10.0),
      new ClockSink(3, 90.0, 90.0)
    ];
    const cts = new ClockTreeSynthesizer({ targetSkewPs: 50.0 });
    const ctsResult = cts.synthesizeClockTree(sinks);
    assert(ctsResult.sinkCount === 4, 'CTS synthesized clock tree for 4 sinks');
    assert(ctsResult.skewPs >= 0, `Clock skew evaluated: ${ctsResult.skewPs} ps`);
    assert(ctsResult.bufferCount > 0, `Clock buffers inserted: ${ctsResult.bufferCount}`);

    // Test 3.2: Multi-layer grid-based A* maze router (PathFinder)
    const router = new MazeRouterPathFinder(30, 30, 3);
    const routeRes = router.routeNet('NET_CLOCK', 2, 2, 0, 25, 25, 2);
    assert(routeRes.success === true, 'PathFinder maze router connects net across 3 metal layers');
    assert(routeRes.viaCount >= 2, `Layer transitions inserted ${routeRes.viaCount} vias`);
    assert(routeRes.wireLengthUm > 0, `Total routed wirelength: ${routeRes.wireLengthUm.toFixed(1)} um`);

    // Test 3.3: BSIM4 Advanced MOSFET Compact Model
    const nmos = new BSIM4MosfetModel('NMOS', { W: 1.2e-6, L: 0.13e-6 });
    // Cutoff regime
    const iCutoff = nmos.evaluateCurrent(0.1, 1.2);
    assert(Math.abs(iCutoff) < 1e-9, `Cutoff subthreshold leakage: ${Math.abs(iCutoff).toExponential(3)} A`);

    // Saturation regime
    const iSat = nmos.evaluateCurrent(1.2, 1.2);
    assert(iSat > 1e-4, `Saturation ON current: ${(iSat * 1e3).toFixed(3)} mA`);

    // Test 3.4: CMOS Inverter Voltage Transfer Characteristic (VTC)
    const vtc = nmos.evaluateInverterVTC(1.2, 20);
    assert(
      vtc.switchingThresholdVm > 0.4 && vtc.switchingThresholdVm < 0.8,
      `Inverter switching threshold Vm = ${vtc.switchingThresholdVm.toFixed(2)} V`
    );
    assert(vtc.noiseMarginHigh > 0, `Noise Margin High NM_H = ${vtc.noiseMarginHigh.toFixed(2)} V`);
  }

  console.log('\n================================================================');
  console.log(`Phase 4 Smoke Checks Finished: ${testsPassed} Passed (${testsFailed} Failed)`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
  return { testsPassed, testsFailed };
}

if (require.main === module) {
  runPhase4Tests();
}

module.exports = { runPhase4Tests };
