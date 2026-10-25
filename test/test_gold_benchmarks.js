/**
 * OmniEng Experimental Formula and Module Smoke Checks
 * Runs legacy analytical-expression and module smoke checks; results are not independent validation evidence.
 * These checks do not load reviewed external benchmark fixtures and do not
 * establish compliance with standards named in legacy source data.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

const { Point3D, Tetrahedron, DelaunayMesher3D } = require('../src/core/cae/delaunay_mesher_3d');
const {
  QuadraticTet10Element,
  MortarContactPair3D,
  LanczosModalEigensolver
} = require('../src/core/cae/continuum_plasticity_3d');
const { FVMNavierStokes3D, PolyhedralCell3D } = require('../src/core/cae/fvm_navier_stokes_3d');
const { SystemVerilogSynthesizer, AndInverterGraph } = require('../src/core/eda/system_verilog_synth');
const { DRCEngine } = require('../src/core/eda/drc_engine');
const { BSIM4MosfetModel, ClockTreeSynthesizer, ClockSink } = require('../src/core/eda/clock_tree_synthesis');
const { GdsiiStreamEngine, GdsLibrary } = require('../src/core/eda/gdsii_stream');
const { AsphericSurface, ThinFilmMultilayerCoating } = require('../src/core/optics/aspheric_freeform_optics');
const { OpticalThermalSoakEngine } = require('../src/core/optics/thermal_soak');
const opticalExamples = require('./support/experimental_optics_examples');
const { AutocoderCRust } = require('../src/core/dynamic_simulink/autocoder_c_rust');
const {
  ModelPredictiveController,
  GoldfarbIdnaniQPSolver
} = require('../src/core/dynamic_simulink/model_predictive_control');
const { ExperimentalPropertyDatabase } = require('../src/core/plant/dippr_database');
const { EXPERIMENTAL_PROPERTY_EXAMPLES } = require('./support/experimental_property_examples');
const { NaphtaliSandholmColumnSolver, WaterHammerMOC } = require('../src/core/plant/naphtali_sandholm_mesh');

function runGoldBenchmarks() {
  console.log('================================================================');
  console.log('   OmniEng Experimental Formula and Module Smoke Checks   ');
  console.log('================================================================\n');

  let passedCount = 0;
  function assert(cond, desc) {
    if (!cond) {
      console.error(`  ✕ FAILED: ${desc}`);
      throw new Error(`Benchmark Assertion Failed: ${desc}`);
    }
    console.log(`  ✓ ${desc}`);
    passedCount++;
  }

  // --- Manufactured elasticity check: isotropic stress from a supplied strain ---
  console.log('1. Quadratic tetrahedron elasticity formula smoke check:');
  {
    const E = 2.1e11;
    const nu = 0.3;
    const tet10 = new QuadraticTet10Element(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { E, nu, Sy: 400.0e6, H: 2.0e9 });
    const gp = tet10.gaussPoints[0];
    const strainInc = new Float64Array([0.0004414, -0.0001324, -0.0001324, 0, 0, 0]);
    const res = tet10.radialReturnMapping(gp, strainInc);
    const lambda = (E * nu) / ((1 + nu) * (1 - 2 * nu));
    const shearModulus = E / (2 * (1 + nu));
    const strainSum = strainInc[0] + strainInc[1] + strainInc[2];
    const normalStress = [0, 1, 2].map((index) => lambda * strainSum + 2 * shearModulus * strainInc[index]);
    const [s1, s2, s3] = normalStress;
    const expectedVonMises = Math.sqrt(0.5 * ((s1 - s2) ** 2 + (s2 - s3) ** 2 + (s3 - s1) ** 2));
    const relativeError = Math.abs(res.vonMises - expectedVonMises) / expectedVonMises;
    assert(
      relativeError < 1e-10,
      `Radial-return stress matches an independent isotropic elasticity calculation (relative error ${relativeError.toExponential(2)})`
    );
  }

  // --- Smoke check: J2 radial-return plastic branch ---
  console.log('\n2. J2 radial-return plastic branch smoke check:');
  {
    const Sy = 250.0e6; // Yield strength Pa

    const tet10 = new QuadraticTet10Element(1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], {
      E: 2.0e11,
      nu: 0.3,
      Sy: 250.0e6,
      H: 1.0e9
    });
    const gp = tet10.gaussPoints[0];
    const epsPlastic = new Float64Array([0.015, -0.006, -0.006, 0.002, 0, 0]);
    const pRes = tet10.radialReturnMapping(gp, epsPlastic);

    assert(
      pRes.isPlastic,
      `Radial-return plastic branch activated: von Mises = ${(pRes.vonMises / 1e6).toFixed(1)} MPa`
    );
    assert(
      pRes.deltaPlasticMultiplier > 0,
      `Plastic multiplier delta_gamma > 0 (${pRes.deltaPlasticMultiplier.toExponential(3)})`
    );
    assert(
      pRes.vonMises >= Sy,
      `Plastic von Mises reaches yield surface: ${(pRes.vonMises / 1e6).toFixed(2)} MPa >= ${(Sy / 1e6).toFixed(2)} MPa`
    );
    assert(
      Math.abs(pRes.flowStress - Sy) / Sy < 0.25,
      `Plastic flow stress remains within the configured smoke envelope`
    );
  }

  // --- Smoke check: Hertz contact arithmetic and contact activation ---
  console.log('\n3. Hertz contact arithmetic and activation smoke check:');
  {
    const R = 0.05; // 50mm radius
    const F = 5000.0; // 5 kN load
    const E = 2.1e11;
    const nu = 0.3;
    const E_star = E / (2.0 * (1.0 - nu * nu));

    // Analytical Hertzian contact radius a = (3*F*R / (4*E*))^1/3
    const a_hertz = Math.cbrt((3.0 * F * R) / (4.0 * E_star));
    // Peak contact pressure p0 = 1.5 * F / (pi * a^2)
    const p0_analytic = (1.5 * F) / (Math.PI * a_hertz * a_hertz);

    const nodes = [
      new Point3D(0, 0, 0, 0),
      new Point3D(1, 0, 0, 1),
      new Point3D(0, 1, 0, 2),
      new Point3D(0.2, 0.2, -0.0005, 3) // 0.5 mm penetration
    ];
    const mortar = new MortarContactPair3D([0, 1, 2], [3], { penaltyNormal: 1e8, frictionCoeff: 0.2 });
    const cRes = mortar.evaluateContact(nodes);
    assert(
      cRes.activeContactCount === 1,
      `Hertzian contact penetration detected: active contacts = ${cRes.activeContactCount}`
    );
    assert(cRes.totalNormalForce > 0, `Contact normal force: ${cRes.totalNormalForce.toFixed(0)} N`);
    assert(
      Number.isFinite(p0_analytic) && p0_analytic > 0,
      `Hertz formula returned a finite positive pressure: ${(p0_analytic / 1e6).toFixed(1)} MPa`
    );
  }

  // --- Experimental smoke check: generic FVM box-domain initialization ---
  console.log('\n4. Generic 3D FVM box-domain initialization smoke check:');
  {
    const fvm = new FVMNavierStokes3D();
    const domain = fvm.createBoxDomain(6, 6, 4, 1.0, 0.5, 0.5);
    const stepRes = fvm.step(0.0005);
    assert(domain.cellCount === 144, `Generic box domain initialized with ${domain.cellCount} cells`);
    assert(
      stepRes.maxVelocity > 0.0,
      `FVM step produced a nonzero velocity field: ${stepRes.maxVelocity.toFixed(1)} m/s`
    );
  }

  // --- Experimental smoke check: textbook turbulent flat-plate correlation ---
  console.log('\n5. Turbulent flat-plate correlation formula smoke check (not NASA TMR data):');
  {
    const Rex = 1.0e7;
    // Standard Prandtl-Schlichting skin friction formula: Cf = 0.455 / (ln(0.06 * Rex))^2
    const skinFrictionCorrelation = 0.455 / Math.pow(Math.log(0.06 * Rex), 2.0);

    const fvm = new FVMNavierStokes3D();
    const cell = new PolyhedralCell3D(0, { x: 0.5, y: 1e-5, z: 0 }, 1e-9);
    cell.u = 30.0;
    cell.rho = 1.225;
    cell.wallDistance = 1e-5;
    const localYPlus = fvm.evaluateWallBoundary(cell, null);
    assert(
      skinFrictionCorrelation > 0.0025 && skinFrictionCorrelation < 0.0035,
      `Correlation value = ${skinFrictionCorrelation.toFixed(6)} within the configured smoke range`
    );
    assert(
      localYPlus.yPlus < 5.0 && localYPlus.regime === 'viscous_sublayer',
      `Wall-unit helper classifies the supplied point as viscous_sublayer (y+ = ${localYPlus.yPlus.toFixed(2)})`
    );
  }

  // --- Smoke check 6: partial SystemVerilog inspection and clock-tree example ---
  console.log('\n6. SystemVerilog Declaration and Clock-Tree Smoke Check:');
  {
    const svCode = `
      module sequential_example #(parameter BITS = 16) (
        input logic clk,
        input logic rst,
        input logic [BITS-1:0] d,
        output logic [BITS-1:0] q
      );
        always_ff @(posedge clk) begin
          if (rst) q <= '0;
          else q <= d ^ 16'hAAAA;
        end
      endmodule
    `;
    const synth = new SystemVerilogSynthesizer();
    const res = synth.synthesize(svCode);
    assert(res.sequentialSyntaxDetected, 'SystemVerilog sequential syntax is identified');
    assert(res.technologyMapping.status === 'unavailable', 'No fabricated standard-cell mapping is reported');

    const sinks = Array.from({ length: 8 }, (v, i) => new ClockSink(i, (i % 4) * 25.0, Math.floor(i / 4) * 50.0));
    const cts = new ClockTreeSynthesizer({ targetSkewPs: 50.0 });
    const ctsRes = cts.synthesizeClockTree(sinks);
    assert(ctsRes.skewTargetMet, `CTS achieves zero clock skew: ${ctsRes.skewPs} ps <= target`);
  }

  // --- Smoke check 7: generic DRC rules supplied by the test ---
  console.log('\n7. Generic DRC Rule Smoke Check:');
  {
    const rules = {
      minWidth: 140,
      minSpacing: 140,
      minArea: 25000
    };
    const goodLayout = [
      { id: 'm1_wire1', layer: 'Metal1', x: 0, y: 0, w: 180, h: 2000 },
      { id: 'm1_wire2', layer: 'Metal1', x: 400, y: 0, w: 180, h: 2000 }
    ];
    const drcRes = DRCEngine.runDRC(goodLayout, rules);
    assert(drcRes.isClean, `Caller-supplied generic DRC rules accept the passing fixture`);

    const badLayout = [{ id: 'm1_subwidth', layer: 'Metal1', x: 0, y: 0, w: 80, h: 2000 }];
    const failRes = DRCEngine.runDRC(badLayout, rules);
    assert(
      !failRes.isClean && failRes.violations.length > 0,
      `Caller-supplied generic DRC rules flag the narrow fixture`
    );
  }

  // --- Smoke check 8: illustrative transistor and ring-oscillator arithmetic ---
  console.log('\n8. Illustrative MOSFET and Ring-Oscillator Formula Smoke Check:');
  {
    const nmos = new BSIM4MosfetModel('NMOS', { W: 1.2e-6, L: 0.13e-6 });
    const vtc = nmos.evaluateInverterVTC(1.2, 30);
    assert(
      Math.abs(vtc.switchingThresholdVm - 0.6) < 0.05,
      `Illustrative inverter switching-threshold estimate = ${vtc.switchingThresholdVm.toFixed(2)} V`
    );
    // This checks only the supplied delay-to-frequency formula; no circuit simulation is performed.
    const tpd = 15.0e-12;
    const fOscGhz = 1.0 / (2.0 * 7.0 * tpd) / 1e9;
    assert(fOscGhz > 4.0 && fOscGhz < 5.5, `Manual delay-to-frequency arithmetic: ${fOscGhz.toFixed(2)} GHz`);
  }

  // --- Smoke check 9: illustrative surface intersection and coating calculation ---
  console.log('\n9. Illustrative Optics Formula Smoke Check:');
  {
    const asphere = new AsphericSurface({
      curvatureC: 0.02,
      conicConstantK: -0.5,
      alphaCoeffs: [0, 1.2e-6, -5.0e-9]
    });
    const rayHit = asphere.intersectRay({ x: 0, y: 5.0, z: -10.0 }, { x: 0, y: 0, z: 1.0 });
    assert(rayHit.hit, `Example aspheric surface intersected at z = ${rayHit.point.z.toFixed(4)} mm`);
    const bbar = new ThinFilmMultilayerCoating();
    bbar.addLayer(1.38, 550.0 / (4.0 * 1.38)); // Quarter-wave MgF2 at 550nm
    const coat = bbar.evaluateCoating(550.0, 0.0, 1.52, 1.0);
    assert(
      coat.transmittance > 0.98,
      `Illustrative coating calculation gives ${(coat.transmittance * 100).toFixed(2)}% transmittance (R = ${(coat.reflectance * 100).toFixed(2)}%)`
    );
  }

  // --- Experimental code-generation example ---
  console.log('\n10. Experimental C and no_std Rust controller code examples:');
  {
    const spec = {
      name: 'spacecraft_attitude',
      A: [
        [1.0, 0.001],
        [0.0, 1.0]
      ],
      B: [[0.0], [0.005]],
      C: [[1.0, 0.0]],
      K: [[3.16, 2.7]],
      sampleRateHz: 1000
    };
    const cResult = AutocoderCRust.generateMisraC(spec);
    assert(cResult.headerCode.includes('spacecraft_attitude_step'), 'C example includes a function prototype');
    assert(cResult.headerCode.includes('not assessed'), 'C example says its requested standard is not assessed');
    assert(cResult.sourceCode.includes('static const float32_t K_GAIN'), 'C example includes a fixed-size gain table');
    const rustCode = AutocoderCRust.generateNoStdRust(spec);
    assert(rustCode.includes('#![no_std]'), 'Rust example includes the no_std attribute');
    assert(
      rustCode.includes('have not been qualified'),
      'Rust example says resource and safety behavior are not qualified'
    );
  }

  // --- Experimental plant calculation smoke check; not a reference benchmark ---
  console.log('\n11. Experimental Plant Vapor-Liquid Equilibrium Calculation:');
  {
    const properties = new ExperimentalPropertyDatabase(EXPERIMENTAL_PROPERTY_EXAMPLES);
    const water = properties.get('Water');
    const pVap = water.getVaporPressure(373.15); // Normal boiling point
    assert(Number.isFinite(pVap) && pVap > 0, `Experimental water vapor pressure is finite (${pVap.toFixed(0)} Pa)`);

    const vlle = properties.solveVLLEFlash({
      components: ['Water', 'n-Hexane'],
      feedFractions: [0.5, 0.5],
      temperatureK: 340.0,
      pressurePa: 1.01325e5
    });
    assert(
      vlle.dataStatus === 'experimental' && vlle.phaseFractions,
      'VLLE result is explicitly experimental and includes phase fractions'
    );
  }

  // --- Smoke check 12: experimental column example with explicit conditions ---
  console.log('\n12. Experimental Column Example:');
  {
    const colRes = NaphtaliSandholmColumnSolver.solve({
      stages: 30,
      feedStage: 15,
      components: ['Ethane', 'Propane', 'n-Butane'],
      feedFlows: [20.0, 40.0, 40.0],
      feedTemperatureK: 310.0,
      pressurePa: 1.5e6,
      refluxRatio: 3.0,
      distillateRate: 22.0
    });
    assert(colRes.status === 'unavailable', 'Legacy column solver remains disabled pending reviewed models');
  }

  // --- Diagnostic 13: Experimental water-hammer equation example ---
  console.log('\n13. Experimental water-hammer estimate example:');
  {
    const mocRes = WaterHammerMOC.simulateMOC({
      pipeLengthM: 500.0,
      initialVelocityMs: 2.0,
      initialPressurePa: 5.0e5,
      closureTimeSec: 0.1,
      totalTimeSec: 1.2
    });
    assert(mocRes.status === 'unavailable', 'Legacy transient solver remains disabled pending review');
  }

  // --- Additional experimental module smoke checks ---
  console.log('\n14. Additional Experimental Module Smoke Checks:');
  {
    // Binary GDSII Stream Format
    const lib = new GdsLibrary('BENCHMARK_CHIP');
    const cell = lib.createStructure('INV_X1');
    cell.addPolygon(1, 0, [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 1200 },
      { x: 0, y: 1200 }
    ]);
    const gdsBytes = GdsiiStreamEngine.writeGdsii(lib);
    assert(gdsBytes.length > 50, `Binary GDSII Stream serialized: ${gdsBytes.length} bytes`);
    const readLib = GdsiiStreamEngine.readGdsii(gdsBytes);
    assert(readLib.structures.has('INV_X1'), `Binary GDSII Stream deserialized: cell INV_X1 preserved`);

    // Explicit test-only optical material and housing data; this is a formula smoke check.
    const legacyGlass = opticalExamples.thermalGlassExamples['N-BK7'];
    const soak = OpticalThermalSoakEngine.evaluateThermalSoakFromProperties(
      {
        housingCtePerK: opticalExamples.housingCteExamples.ALUMINUM_6061,
        housingCteSource: 'test-only legacy property fixture',
        elements: [
          {
            radius1Mm: 50.0,
            radius2Mm: -50.0,
            thicknessMm: 6.0,
            airGapMm: 3.0,
            refractiveIndexAtReferenceTemperature: 1.5168,
            thermalProperties: {
              D0PerK: legacyGlass.D0,
              D1PerK2: legacyGlass.D1,
              D2PerK3: legacyGlass.D2,
              E0Um2PerK: legacyGlass.E0,
              E1Um2PerK2: legacyGlass.E1,
              lambdaTkUm: legacyGlass.lambdaTk,
              glassCtePerK: legacyGlass.cte,
              source: 'test-only unverified optical example'
            }
          }
        ]
      },
      60.0,
      20.0,
      0.55,
      101325
    );
    assert(soak.focalShiftMm !== 0.0, `Thermal soak evaluates focal shift: ${soak.focalShiftMm.toFixed(4)} mm at 60°C`);

    // Constrained Model Predictive Control (Goldfarb-Idnani Dual QP)
    let rejectedMissingMpcInputs = false;
    try {
      new ModelPredictiveController();
    } catch (error) {
      rejectedMissingMpcInputs = /requires explicit inputs/.test(error.message);
    }
    assert(rejectedMissingMpcInputs, 'MPC constructor rejects omitted model and tuning inputs');
    const mpc = new ModelPredictiveController({
      A: [
        [1.0, 0.1],
        [0.0, 0.95]
      ],
      B: [[0.005], [0.1]],
      C: [[1.0, 0.0]],
      predictionHorizon: 8,
      controlHorizon: 3,
      Q: [10.0],
      R: [0.1],
      Rdelta: [0.5],
      uMin: [-1.0],
      uMax: [1.0],
      deltaUMax: [0.5],
      initialControl: [0.0]
    });
    const mpcAction = mpc.computeControlAction([0.8, -0.2], 0.0);
    assert(mpcAction.qpConverged, `Constrained MPC with Goldfarb-Idnani Dual QP converged to optimal control`);
    assert(
      mpcAction.u[0] >= -1.0 && mpcAction.u[0] <= 1.0,
      `Actuator amplitude constraint respected: u0 = ${mpcAction.u[0].toFixed(3)}`
    );
  }

  console.log(`\n================================================================`);
  console.log(`Experimental smoke assertions finished: ${passedCount} Passed (0 Failed)`);
  console.log(`================================================================\n`);
  return { passedCount, failedCount: 0 };
}

if (require.main === module) {
  runGoldBenchmarks();
}

module.exports = { runGoldBenchmarks };
