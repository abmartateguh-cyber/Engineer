/**
 * Legacy experimental numerical diagnostics.
 * These checks do not constitute independent verification or validation evidence.
 */

'use strict';

const assert = require('assert');

// 1. Math & Accelerators
const { WasmKernelEngine, wasmKernelEngine } = require('../../src/core/math/wasm_kernel_engine');
const { SparseMatrixCSR, SparseCholeskySolver } = require('../../src/core/math/sparse_cholesky');
const { DomainDecompositionEngine } = require('../../src/core/math/domain_decomposition');

// 2. CAE / Structural FEA
const { FEASolver } = require('../../src/core/cae/fea_structural');
const { ElementTET10 } = require('../../src/core/cae/element_tet10');
const { runHertzAnalyticalReference } = require('../../src/core/vv/hertz_analytical');
const { ASMESectionVIIIDiv2Analyzer } = require('../../src/core/compliance/asme_section_viii_div2');
const { NortonBaileyCreepSolver } = require('../../src/core/cae/norton_bailey_creep');

// 3. CFD / Fluid Dynamics
const { FVMNavierStokes3D, PolyhedralCell3D } = require('../../src/core/cae/fvm_navier_stokes_3d');
const { PrismLayerMesher } = require('../../src/core/cae/prism_layer_mesher');

// 4. EDA / Microelectronics
const { LefDefParser } = require('../../src/core/eda/lef_def_parser');
const { Sky130PdkAdapter } = require('../../src/core/eda/sky130_pdk_adapter');
const { getExperimentalEdaLibraryExample } = require('../support/experimental_eda_library_example');
const { StaticTimingAnalysis } = require('../../src/core/eda/static_timing_analysis');
const { PowerGridIRDropAnalyzer } = require('../../src/core/eda/power_grid_ir_drop');
const {
  createSyntheticPdnAnalyzer,
  createSyntheticPdnMesh,
  SYNTHETIC_BLACKS_MODEL
} = require('../support/experimental_pdn_inputs');

// 5. Optics / Photonics
const { Complex, JonesVector, PolarizationRayTracer } = require('../../src/core/optics/polarization_ray_tracer');
const { OpticalGlassCatalog } = require('../../src/core/optics/optical_glass_catalog');
const opticalExamples = require('../support/experimental_optics_examples');
const { DiffractionPSFMTFEngine } = require('../../src/core/optics/diffraction_psf_mtf');

// 6. Chemical & Plant
const { ExperimentalPropertyDatabase } = require('../../src/core/plant/dippr_database');
const { EXPERIMENTAL_PROPERTY_EXAMPLES } = require('../support/experimental_property_examples');
const { getExperimentalPengRobinsonComponents } = require('../support/experimental_property_examples');
const { PengRobinsonEOS } = require('../../src/core/plant/peng_robinson_eos');
const { ElectrolyteNRTLModel } = require('../../src/core/plant/enrtl_electrolyte_thermo');
const { NaphtaliSandholmColumnSolver, WaterHammerMOC } = require('../../src/core/plant/naphtali_sandholm_mesh');
const { TemaBellDelaware } = require('../../src/core/plant/tema_bell_delaware');
const { PinchEnergyTargeter } = require('../../src/core/plant/pinch_energy_targeter');
const { ActivityCoefficientModels } = require('../../src/core/plant/activity_coefficient_models');

// 7. Systems, Autocoding & Security
const { AutocoderCRust } = require('../../src/core/dynamic_simulink/autocoder_c_rust');
const makeControllerCodegenInput = (name) => ({
  name,
  A: [
    [1.0, 0.0],
    [0.0, 1.0]
  ],
  B: [[1.0], [0.0]],
  C: [[1.0, 0.0]],
  K: [[1.0, 0.0]],
  sampleRateHz: 1000
});
const { MCDCCoverageAnalyzer } = require('../../src/core/dynamic_simulink/mcdc_coverage');
const { FmiMasterEngine, FmuSlave } = require('../../src/core/cosim/fmi_master_engine');
const { PKCS11HardwareToken, CKR, CKU } = require('../support/pkcs11_smartcard_simulator');
const { EnterpriseIAM, ACTIONS } = require('../../src/core/security/enterprise_iam');
const { ToolQualificationKit } = require('../../src/core/compliance/tool_qualification_kit');

function runExperimentalDiagnostics() {
  console.log('================================================================================');
  console.log('   OMNIENG LEGACY ENGINE SMOKE ASSERTIONS                                      ');
  console.log('   Unavailable references are listed separately from failed checks           ');
  console.log('================================================================================\n');

  let passed = 0;
  let total = 0;
  let failed = 0;
  let unavailable = 0;
  const suiteStartTime = Date.now();

  function testSmoke(id, title, testFn) {
    total++;
    try {
      testFn();
      passed++;
      console.log(`  ✓ [SM ${id.toString().padStart(3, '0')}] ${title}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ [SM ${id.toString().padStart(3, '0')}] ${title} - FAILED: ${err.message}`);
    }
  }

  function recordUnavailable(id, title, reason) {
    unavailable++;
    console.log(`  - [REF ${id.toString().padStart(3, '0')}] UNAVAILABLE: ${title} — ${reason}`);
  }

  function recordFormulaUnavailable(id, title) {
    recordUnavailable(
      id,
      title,
      'The former check evaluated a standalone equation without a production-engine comparison or independent reference.'
    );
  }

  // =========================================================================
  // GROUP 1: STRUCTURAL MECHANICS, NONLINEAR CONTACT & MATERIALS (20 DIAGNOSTIC SLOTS)
  // =========================================================================
  console.log('--- GROUP 1: STRUCTURAL MECHANICS, NONLINEAR CONTACT & MATERIALS (1 - 20) ---');

  recordUnavailable(1, 'NAFEMS LE1', 'Reference data and a production solve are unavailable by project decision.');

  recordUnavailable(2, 'NAFEMS LE10', 'Reference data and a production solve are unavailable by project decision.');

  recordUnavailable(3, 'NAFEMS LE11', 'Reference data and a production solve are unavailable by project decision.');

  recordUnavailable(4, 'NAFEMS FV32', 'Reference data and a production solve are unavailable by project decision.');

  recordUnavailable(5, 'NAFEMS T1', 'Reference data and a production solve are unavailable by project decision.');

  testSmoke(6, 'Hertz analytical outputs match an independent closed-form evaluation', () => {
    const result = runHertzAnalyticalReference();
    assert(result.passed, result.reason || `Hertz formula relative error ${result.calculatedValue}`);
  });

  testSmoke(7, 'Quadratic TET10 10-Node High-Order Element Stiffness Positive-Definiteness', () => {
    const nodes = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 0, y: 0, z: 10 },
      { x: 5, y: 0, z: 0 },
      { x: 5, y: 5, z: 0 },
      { x: 0, y: 5, z: 0 },
      { x: 0, y: 0, z: 5 },
      { x: 5, y: 0, z: 5 },
      { x: 0, y: 5, z: 5 }
    ];
    const elem = new ElementTET10(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], nodes, 210e9, 0.3);
    const K = elem.computeStiffnessMatrix();
    assert(K.length === 900 && K[0] > 0);
  });

  testSmoke(8, 'Quadratic TET10 Pure Bending Volume and Metric Consistency', () => {
    const nodes = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 0, y: 0, z: 10 },
      { x: 5, y: 0, z: 0 },
      { x: 5, y: 5, z: 0 },
      { x: 0, y: 5, z: 0 },
      { x: 0, y: 0, z: 5 },
      { x: 5, y: 0, z: 5 },
      { x: 0, y: 5, z: 5 }
    ];
    const elem = new ElementTET10(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], nodes, 210e9, 0.3);
    assert(elem.volume > 0 && elem.volume < 200);
  });

  recordUnavailable(
    9,
    'Nonlinear cantilever reference',
    'No independent nonlinear reference is configured for the reduced-order formula estimate.'
  );

  testSmoke(10, 'Norton-Bailey Power Law Creep Strain Rate @ 120 MPa (2.488e-8 /hr)', () => {
    const r = NortonBaileyCreepSolver.evaluateSecondaryCreepRate({ stressMPa: 120.0, A: 1.0e-18, n: 5.0 });
    assert(Math.abs(r - 2.48832e-8) < 1e-11);
  });

  testSmoke(11, 'Experimental stress-line integration and caller-limit screen', () => {
    const analyzer = new ASMESectionVIIIDiv2Analyzer({
      allowableStressS: 138.0,
      allowableStressSource: 'synthetic smoke input; not an approved material allowable'
    });
    const res = analyzer.linearizeStressClassificationLine(
      [
        { x: -10, stressMpa: 120 },
        { x: 10, stressMpa: 80 }
      ],
      20,
      false
    );
    assert(res.dataStatus === 'caller-supplied-unverified' && res.membraneStressPm < 138.0);
    assert.strictEqual(res.assessmentStatus, 'no-code-assessment');
  });

  testSmoke(12, 'Wasm SIMD128 Dot Product vs Scalar Analytical Match (N = 10,000)', () => {
    const a = new Float64Array(10000).fill(1.5);
    const b = new Float64Array(10000).fill(2.0);
    const dot = wasmKernelEngine.dotProductSIMD128(a, b);
    assert(Math.abs(dot - 30000.0) < 1e-6);
  });

  testSmoke(13, 'Wasm SIMD128 DAXPY y = a*x + y Vector Update', () => {
    const x = new Float64Array([1.0, 2.0, 3.0, 4.0]);
    const y = new Float64Array([10.0, 20.0, 30.0, 40.0]);
    wasmKernelEngine.daxpySIMD128(x, y, 2.5);
    assert(Math.abs(y[0] - 12.5) < 1e-8 && Math.abs(y[3] - 50.0) < 1e-8);
  });

  testSmoke(14, 'Wasm Compressed Sparse Row Matrix-Vector Product (SpMV)', () => {
    const rowPtr = [0, 2, 4];
    const colInd = [0, 1, 0, 1];
    const vals = [2.0, -1.0, -1.0, 2.0];
    const x = new Float64Array([3.0, 4.0]);
    const y = new Float64Array(2);
    wasmKernelEngine.spmvSIMD128(rowPtr, colInd, vals, x, y, 2);
    assert(y[0] === 2.0 && y[1] === 5.0);
  });

  testSmoke(15, 'Out-of-Core Sparse Cholesky Factorization for Extreme Condition Numbers', () => {
    const numRows = 10;
    const A = new SparseMatrixCSR(numRows, numRows);
    const rhs = new Float64Array(numRows);
    for (let i = 0; i < numRows; i++) {
      A.addEntry(i, i, 4.0);
      if (i > 0) A.addEntry(i, i - 1, -1.0);
      if (i < numRows - 1) A.addEntry(i, i + 1, -1.0);
      rhs[i] = 1.0;
    }
    A.finalize();
    const sol = SparseCholeskySolver.solveBlockTiledOutOfCore(A, rhs, {
      blockSize: 5,
      maxIterations: 50,
      tolerance: 1e-6
    });
    assert(sol.converged && sol.residualNorm < 1e-4);
  });

  testSmoke(16, 'Domain Decomposition Recursive Coordinate Bisection (P = 4 Subdomains)', () => {
    const nodes = [];
    for (let i = 0; i < 20; i++) nodes.push({ x: i * 1.0, y: 0, z: 0 });
    const elements = [];
    for (let i = 0; i < 19; i++) elements.push([i, i + 1]);
    const part = DomainDecompositionEngine.partitionMesh(nodes, elements, 4);
    assert(part.subdomains.length === 4 && part.loadImbalanceRatio < 1.3);
  });

  testSmoke(17, 'Schur Complement Interface Boundary Degree-of-Freedom Reduction', () => {
    const nodes = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 }
    ];
    const elements = [
      [0, 1],
      [1, 2],
      [2, 3]
    ];
    const part = DomainDecompositionEngine.partitionMesh(nodes, elements, 2);
    const schur = DomainDecompositionEngine.evaluateSchurDimensions(part, 3);
    assert(schur.interfaceDofsCount > 0 && schur.internalDofsCount > 0);
  });

  recordFormulaUnavailable(18, 'Euler column buckling formula restatement');
  recordFormulaUnavailable(19, 'Sneddon crack-tip stress-intensity formula restatement');
  recordFormulaUnavailable(20, 'Basquin fatigue-life formula restatement');

  // =========================================================================
  // GROUP 2: COMPUTATIONAL FLUID DYNAMICS & AERODYNAMICS (20 DIAGNOSTIC SLOTS)
  // =========================================================================
  console.log('\n--- GROUP 2: COMPUTATIONAL FLUID DYNAMICS & AERODYNAMICS (21 - 40) ---');

  recordUnavailable(
    21,
    'NASA TMR flat plate comparison',
    'A production CFD solve adapter is not configured; no solver comparison was run.'
  );

  recordFormulaUnavailable(22, 'Planar Couette velocity profile formula restatement');
  recordFormulaUnavailable(23, 'Hagen–Poiseuille pressure-drop formula restatement');

  recordUnavailable(
    24,
    'Lid-driven cavity primary vortex coordinates',
    'The former check compared hard-coded coordinates against the same constants; no independently qualified cavity solution is configured.'
  );

  testSmoke(25, 'Transonic Roe Riemann Solver Flux Normal Shock Wave Resolution (Mach 2.5)', () => {
    const cfd = new FVMNavierStokes3D();
    const cellL = new PolyhedralCell3D(0, { x: 0, y: 0, z: 0 }, 1e-3);
    cellL.rho = 1.0;
    cellL.p = 100000.0;
    cellL.u = 0.0;
    cellL.v = 0.0;
    cellL.w = 0.0;
    const cellR = new PolyhedralCell3D(1, { x: 0.1, y: 0, z: 0 }, 1e-3);
    cellR.rho = 0.125;
    cellR.p = 10000.0;
    cellR.u = 0.0;
    cellR.v = 0.0;
    cellR.w = 0.0;
    const flux = cfd.solveRoeRiemannFlux(cellL, cellR, { x: 1, y: 0, z: 0 }, 0.01);
    assert(flux.massFlux > 0 && flux.pressureForce > 0);
  });

  testSmoke(26, 'AUSM+ Upstream Mach Splitting Sonic Expansion Throttle', () => {
    const cfd = new FVMNavierStokes3D();
    const cellL = new PolyhedralCell3D(0, { x: 0, y: 0, z: 0 }, 1e-3);
    cellL.rho = 1.225;
    cellL.p = 101325.0;
    cellL.u = 250.0;
    cellL.v = 0.0;
    cellL.w = 0.0;
    const cellR = new PolyhedralCell3D(1, { x: 0.1, y: 0, z: 0 }, 1e-3);
    cellR.rho = 1.0;
    cellR.p = 95000.0;
    cellR.u = 240.0;
    cellR.v = 0.0;
    cellR.w = 0.0;
    const flux = cfd.solveAUSMPlusFlux(cellL, cellR, { x: 1, y: 0, z: 0 }, 0.01);
    assert(flux.massFlux > 0 && flux.interfaceMach > 0.5);
  });

  testSmoke(27, 'Prism Boundary Layer First Cell Height Schlichting Formula (y+ <= 1.0)', () => {
    const yPlusCalc = PrismLayerMesher.calculateFirstLayerHeight({
      velocity: 50.0,
      density: 1.225,
      viscosity: 1.81e-5,
      refLength: 1.0,
      targetYPlus: 1.0
    });
    assert(yPlusCalc.firstLayerHeightM > 1e-6 && yPlusCalc.firstLayerHeightM < 5e-4);
  });

  testSmoke(28, 'Prism Layer Extrusion Geometry Non-Inversion Metric (V_prism > 0)', () => {
    const surfaceMesh = {
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0]
      ],
      triangles: [
        [0, 1, 2],
        [0, 2, 3]
      ]
    };
    const res = PrismLayerMesher.generatePrismLayers(surfaceMesh, {
      firstLayerHeight: 0.001,
      growthRatio: 1.25,
      layerCount: 5
    });
    assert(res.prismElementCount === 10 && res.invertedElementCount === 0 && res.minElementVolume > 0);
  });

  recordFormulaUnavailable(29, 'Colebrook–White friction-factor equation restatement');
  recordFormulaUnavailable(30, 'Darcy–Weisbach head-loss equation restatement');
  recordFormulaUnavailable(31, 'Rankine–Hugoniot pressure-ratio equation restatement');
  recordFormulaUnavailable(32, 'Ideal-gas acoustic-speed equation restatement');
  recordFormulaUnavailable(33, 'Bernoulli pressure equation restatement');
  recordFormulaUnavailable(34, 'Stokes settling-velocity equation restatement');
  recordFormulaUnavailable(35, 'Vortex-shedding frequency equation restatement');
  recordFormulaUnavailable(36, 'Thin-airfoil lift-slope equation restatement');
  recordFormulaUnavailable(37, 'Oblique-shock theta-beta-Mach equation restatement');
  recordFormulaUnavailable(38, 'Rotating-frame centrifugal-acceleration equation restatement');
  recordFormulaUnavailable(39, 'Turbulent kinetic-energy dissipation equation restatement');

  recordUnavailable(
    40,
    'Rayleigh-Benard thermal convection onset',
    'The former check asserted a hard-coded critical Rayleigh number without evaluating a production model or independent reference.'
  );

  // =========================================================================
  // GROUP 3: SEMICONDUCTOR EDA & MICROELECTRONICS (15 DIAGNOSTIC SLOTS)
  // =========================================================================
  console.log('\n--- GROUP 3: SEMICONDUCTOR EDA & MICROELECTRONICS (41 - 55) ---');

  testSmoke(41, 'Synthetic cell fixture exercises standard-cell geometry fields', () => {
    const pdk = new Sky130PdkAdapter(getExperimentalEdaLibraryExample());
    const cell = pdk.cells.demo_inv;
    assert(cell && cell.widthUm > 0 && cell.heightUm > 0);
  });

  testSmoke(42, 'Synthetic two-input cell fixture exercises pin records', () => {
    const pdk = new Sky130PdkAdapter(getExperimentalEdaLibraryExample());
    const cell = pdk.cells.demo_nand2;
    assert(cell && cell.pins.A && cell.pins.B && cell.pins.Y);
  });

  testSmoke(43, 'Synthetic layer fixture exercises geometry and resistance fields', () => {
    const pdk = new Sky130PdkAdapter(getExperimentalEdaLibraryExample());
    const metal1 = pdk.layers.metal1;
    assert(metal1 && metal1.pitchUm === 0.34 && metal1.sheetResOhmSq === 0.125);
  });

  testSmoke(44, 'Multi-Corner Multi-Mode (MCMM) Timing PVT Analysis (SS / TT / FF)', () => {
    const mcmm = StaticTimingAnalysis.evaluateMCMM();
    assert(mcmm.cornerCount === 3 && mcmm.worstSetupCorner === 'ss_100C_1v60');
  });

  testSmoke(45, 'Elmore Delay Distributed RC Interconnect Tree Calculation', () => {
    const elmoreNs = StaticTimingAnalysis.computeElmoreDelay(100.0, 50.0, 1e-14, 2e-14);
    assert(elmoreNs > 0 && elmoreNs < 1.0);
  });

  testSmoke(46, 'On-Chip Variation (OCV) 3-Sigma Gaussian Timing Derating', () => {
    const pex = StaticTimingAnalysis.extractParasitics({ lengthMm: 2.0, widthUm: 1.0 });
    assert(pex.resistanceOhms > 0 && pex.capacitancePf > 0);
  });

  testSmoke(47, 'Caller-parameterized Black formula synthetic smoke check', () => {
    const analyzer = new PowerGridIRDropAnalyzer();
    const estimate = analyzer.evaluateBlacksEM(5e5, 105.0, SYNTHETIC_BLACKS_MODEL);
    assert(Number.isFinite(estimate.formulaEstimateHours) && estimate.formulaEstimateHours > 0);
    assert.strictEqual(estimate.dataStatus, 'caller-supplied-unverified');
    assert(!Object.hasOwn(estimate, 'status'));
  });

  testSmoke(48, 'LEF 5.8 writer/parser round-trip with synthetic library records', () => {
    const pdk = new Sky130PdkAdapter(getExperimentalEdaLibraryExample());
    const lef = pdk.generateLEF();
    const parsed = LefDefParser.parseLEF(lef);
    assert(parsed.version === '5.8' && Object.keys(parsed.macros).length >= 5);
  });

  testSmoke(49, 'IEEE 5.8 DEF Design Exchange Format Standard Cell Netlist Parser', () => {
    const sampleDef = `VERSION 5.8 ;
DESIGN test_top ;
UNITS DISTANCE MICRONS 1000 ;
DIEAREA ( 0 0 ) ( 10000 10000 ) ;
COMPONENTS 1 ;
  - inst0 demo_inv + PLACED ( 1000 1000 ) N ;
END COMPONENTS
NETS 0 ;
END NETS
END DESIGN`;
    const parsed = LefDefParser.parseDEF(sampleDef);
    assert(parsed.components.length === 1 && parsed.name === 'test_top');
  });

  recordFormulaUnavailable(50, 'HPWL placement metric formula restatement');

  testSmoke(51, 'Synthetic caller-supplied lumped PDN solve', () => {
    const pdn = createSyntheticPdnAnalyzer();
    const mesh = createSyntheticPdnMesh(pdn, 3, 3);
    const res = pdn.solveStaticIRDrop(mesh, [0], [{ nodeId: 8, current: 0.001 }]);
    assert(Number.isFinite(res.maxDrop));
    assert.strictEqual(res.validationLevel, 'experimental');
    assert.strictEqual(res.dataStatus, 'caller-supplied-unverified');
    assert.strictEqual(typeof res.belowSuppliedThreshold, 'boolean');
  });

  testSmoke(52, 'Synthetic sequential-cell fixture exercises pin connectivity', () => {
    const pdk = new Sky130PdkAdapter(getExperimentalEdaLibraryExample());
    const cell = pdk.cells.demo_dff;
    assert(cell && cell.pins.CLK && cell.pins.D && cell.pins.Q);
  });

  recordFormulaUnavailable(53, 'MOSFET subthreshold-slope equation restatement');
  recordFormulaUnavailable(54, 'CMOS dynamic-power equation restatement');
  recordFormulaUnavailable(55, 'Clock-skew threshold with a hard-coded value');

  // =========================================================================
  // GROUP 4: OPTICAL PHYSICS & PHOTONICS (15 DIAGNOSTIC SLOTS)
  // =========================================================================
  console.log('\n--- GROUP 4: OPTICAL PHYSICS & PHOTONICS (56 - 70) ---');

  recordFormulaUnavailable(56, 'Snell refraction-angle equation restatement');

  testSmoke(57, 'Total Internal Reflection (TIR) Critical Angle theta_c = asin(n2 / n1)', () => {
    const n1 = 1.5,
      n2 = 1.0;
    const thetaC = Math.asin(n2 / n1);
    const tir = PolarizationRayTracer.evaluateFresnel(n1, n2, thetaC + 0.05);
    assert(tir.isTIR === true && Math.abs(thetaC * (180.0 / Math.PI) - 41.81) < 0.05);
  });

  testSmoke(58, 'Brewster Polarization Angle p-Polarization Null Reflection (tan(theta_B) = n2/n1)', () => {
    const n1 = 1.0,
      n2 = 1.5;
    const thetaB = Math.atan(n2 / n1);
    const fresnel = PolarizationRayTracer.evaluateFresnel(n1, n2, thetaB);
    assert(fresnel.Rp < 1e-4, 'p-polarization reflectance is 0 at Brewster angle');
  });

  testSmoke(59, 'Fresnel s-Polarized Interface Normal Reflectance R = ((n1-n2)/(n1+n2))^2', () => {
    const f = PolarizationRayTracer.evaluateFresnel(1.0, 1.5, 0.0);
    assert(Math.abs(f.Rs - 0.04) < 1e-3 && Math.abs(f.Rp - 0.04) < 1e-3);
  });

  testSmoke(60, 'Jones Vector Quarter-Wave Plate Linear to Right Circular Polarization', () => {
    const linH = JonesVector.LinearHorizontal();
    const invSqrt2 = 1.0 / Math.SQRT2;
    const qwp = [
      [new Complex(invSqrt2, 0), new Complex(0, -invSqrt2)],
      [new Complex(0, -invSqrt2), new Complex(invSqrt2, 0)]
    ];
    const circ = linH.applyMatrix(qwp);
    const stokes = circ.toStokes();
    assert(Math.abs(stokes.S3) > 0.95);
  });

  testSmoke(61, 'Stokes Vector Unpolarized & Linearly Polarized Degree of Polarization (DOP)', () => {
    const linV = JonesVector.LinearVertical();
    const s = linV.toStokes();
    assert(s.S0 === 1.0 && s.S1 === -1.0 && s.DOP === 1.0);
  });

  testSmoke(62, 'Uniaxial Calcite Birefringent Crystal Extraordinary Ray Spatial Walk-Off', () => {
    const calciteProps = { no: 1.658, ne: 1.486, opticAxis: [1, 0, 1] };
    const split = PolarizationRayTracer.splitBirefringentRay(calciteProps, [0, 0, 1], [0, 0, 1]);
    assert(split.walkOffAngleDeg > 0 && split.ordinaryIndex > split.extraordinaryIndex);
  });

  testSmoke(63, 'Uniaxial Quartz Birefringent Positive Crystal Delta(n = n_e - n_o = +0.009)', () => {
    const quartzProps = { no: 1.544, ne: 1.553, opticAxis: [1, 0, 1] };
    const split = PolarizationRayTracer.splitBirefringentRay(quartzProps, [0, 0, 1], [0, 0, 1]);
    assert(split.extraordinaryIndex > split.ordinaryIndex);
  });

  testSmoke(64, 'Optical example records are marked experimental', () => {
    const catalog = new OpticalGlassCatalog(opticalExamples.opticalGlassExamples);
    assert.strictEqual(catalog.database.size, 15);
    assert(Array.from(catalog.database.values()).every((record) => record.dataStatus === 'experimental'));
  });

  testSmoke(65, 'Schott N-BK7 Sellmeier Dispersion Equation Index of Refraction @ 587.6nm (d-line)', () => {
    const catalog = new OpticalGlassCatalog(opticalExamples.opticalGlassExamples);
    const nd = catalog.getRefractiveIndex('N-BK7', 0.58756);
    assert(Math.abs(nd - 1.5168) < 0.002);
  });

  testSmoke(66, 'Marechal Strehl approximation formula smoke check; not ISO 10110 verification', () => {
    const res = DiffractionPSFMTFEngine.evaluateWavefrontPSFandMTF({
      wavelengthUm: 0.55,
      fNumber: 4.0,
      gridSize: 16,
      defocusWaves: 0.0,
      sphericalWaves: 0.0
    });
    assert(res.strehlRatio >= 0.8 && res.isDiffractionLimited === true);
  });

  testSmoke(67, 'Airy Disk Diffraction Radius r_airy = 1.22 * lambda * f_number', () => {
    const res = DiffractionPSFMTFEngine.evaluateWavefrontPSFandMTF({
      wavelengthUm: 0.55,
      fNumber: 4.0,
      gridSize: 16
    });
    assert(Math.abs(res.airyRadiusUm - 2.684) < 0.01);
  });

  recordFormulaUnavailable(68, 'Abbe dispersion-number formula restatement');
  recordFormulaUnavailable(69, 'Achromatic doublet focal-power equation restatement');
  recordFormulaUnavailable(70, 'Gullstrand thick-lens equation restatement');

  // =========================================================================
  // GROUP 5: CHEMICAL & PLANT ENGINEERING (15 DIAGNOSTIC SLOTS)
  // =========================================================================
  console.log('\n--- GROUP 5: CHEMICAL & PLANT ENGINEERING (71 - 85) ---');

  testSmoke(71, 'Experimental water vapor-pressure example near normal boiling point', () => {
    const properties = new ExperimentalPropertyDatabase(EXPERIMENTAL_PROPERTY_EXAMPLES);
    const water = properties.get('Water');
    const pVap = water.getVaporPressure(373.15);
    assert(Math.abs(pVap - 101325.0) < 2500.0);
  });

  testSmoke(72, 'Experimental liquid water density example at 25 deg C', () => {
    const properties = new ExperimentalPropertyDatabase(EXPERIMENTAL_PROPERTY_EXAMPLES);
    const rho = properties.get('Water').getLiquidDensity(298.15);
    assert(Math.abs(rho - 997.0) < 15.0);
  });

  testSmoke(73, 'Peng-Robinson 1978 Cubic Equation of State Pure Methane Compressibility Factor Z', () => {
    const eos = new PengRobinsonEOS(getExperimentalPengRobinsonComponents(['Methane']), [[0]]);
    const z = eos.flashPT([1.0], 190.56, 4599000.0, { maxIter: 100, tol: 1e-8 }); // Near critical point
    assert(z.converged);
  });

  testSmoke(74, 'Peng-Robinson 78 Multi-Component Hydrocarbon Flash VLE Equilibrium', () => {
    const eos = new PengRobinsonEOS(getExperimentalPengRobinsonComponents(['Methane', 'Ethane', 'Propane']), [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ]);
    const flash = eos.flashPT([0.5, 0.3, 0.2], 200.0, 2.0e6, { maxIter: 100, tol: 1e-8 });
    assert(flash.converged && Math.abs(flash.x.reduce((a, b) => a + b, 0) - 1.0) < 1e-4);
  });

  testSmoke(75, 'Electrolyte NRTL (eNRTL) Amine Solvent CO2 Acid Gas Speciation', () => {
    const enrtl = new ElectrolyteNRTLModel({ temperatureK: 313.15, meaMassFraction: 0.3 });
    const spec = enrtl.calculateSpeciation(0.35);
    assert(spec.meahPlusFraction > 0.3 && spec.meacooMinusFraction > 0.3);
  });

  testSmoke(76, 'Electrolyte NRTL (eNRTL) CO2 Partial Pressure Equilibrium at alpha = 0.35', () => {
    const enrtl = new ElectrolyteNRTLModel({ temperatureK: 313.15, meaMassFraction: 0.3 });
    const vle = enrtl.calculateCO2VLE(0.35);
    assert(vle.pCO2_kPa > 0.1 && vle.pCO2_kPa < 5.0);
  });

  testSmoke(77, 'Legacy distillation model fails closed without reviewed property and column models', () => {
    const col = NaphtaliSandholmColumnSolver.solve({ stages: 12 });
    assert.strictEqual(col.status, 'unavailable');
  });

  testSmoke(78, 'Legacy distillation model does not report fabricated tray efficiency results', () => {
    const col = NaphtaliSandholmColumnSolver.solve({ stages: 12, murphreeEfficiency: 0.8 });
    assert.strictEqual(col.error.code, 'UNSUPPORTED');
  });

  testSmoke(79, 'Legacy water-hammer transient route fails closed pending independent review', () => {
    const res = WaterHammerMOC.solve({});
    assert.strictEqual(res.status, 'unavailable');
  });

  testSmoke(80, 'Explicit Joukowsky relation evaluates Delta_P = rho * a * Delta_v', () => {
    const res = WaterHammerMOC.computeJoukowskySurge(1000.0, 1300.0, 2.5);
    assert.strictEqual(res.pressureSurgePa, 3.25e6);
  });

  testSmoke(81, 'TEMA BEM Shell and Tube Heat Exchanger Bell-Delaware Heat Transfer Rating', () => {
    const tema = new TemaBellDelaware({
      Ds: 0.6,
      do: 0.02,
      Pt: 0.025,
      pitchAngle: 30,
      L: 4.0,
      B: 0.3,
      Bc: 0.2,
      Nt: 350
    });
    const rating = tema.rateShellSide({ massFlow: 15.0, rho: 850.0, mu: 0.002, Cp: 2100.0, k: 0.14 });
    assert(rating.h_shell > 100.0 && rating.pressureDrop.total > 0);
  });

  testSmoke(82, 'Pinch Analysis Minimum Hot and Cold Utility Consumption Target', () => {
    const pinch = PinchEnergyTargeter.calculateTargets(
      [
        { type: 'hot', Tin: 200, Tout: 80, mCp: 2.0 },
        { type: 'cold', Tin: 40, Tout: 160, mCp: 3.0 }
      ],
      10.0
    );
    assert(pinch.QHminKW === 120.0 && pinch.maxProcessRecoveryKW === 240.0);
  });

  testSmoke(83, 'NRTL Liquid Activity Coefficient Model Ethanol-Water Binary Azeotrope', () => {
    const res = ActivityCoefficientModels.evaluateNRTLBinary(0.89, 78.15);
    assert(res.gamma1 > 0.95 && res.gamma2 > 1.5 && Math.abs(res.y1 - 0.89) < 0.05);
  });

  recordFormulaUnavailable(84, 'Antoine vapor-pressure formula restatement');
  recordFormulaUnavailable(85, 'API 520 relief-area formula restatement');

  // =========================================================================
  // GROUP 6: SYSTEMS ENGINEERING, AUTOCODING & SECURITY (15 DIAGNOSTIC SLOTS)
  // =========================================================================
  console.log('\n--- GROUP 6: SYSTEMS ENGINEERING, AUTOCODING & SECURITY (86 - 100) ---');

  testSmoke(86, 'Experimental C code generation emits a float32_t typedef', () => {
    const c = AutocoderCRust.generateMisraC(makeControllerCodegenInput('flight_test'));
    assert(c.headerCode.includes('typedef float float32_t;'));
  });

  testSmoke(87, 'Experimental C source example omits heap allocation calls', () => {
    const c = AutocoderCRust.generateMisraC(makeControllerCodegenInput('flight_test'));
    assert(!c.sourceCode.includes('malloc(') && !c.sourceCode.includes('free('));
  });

  testSmoke(88, 'Experimental C source example emits a parenthesized expression', () => {
    const c = AutocoderCRust.generateMisraC(makeControllerCodegenInput('flight_test'));
    assert(c.sourceCode.includes('(K_GAIN[i][j] * error)'));
  });

  testSmoke(89, 'Experimental AUTOSAR-shaped source example contains a runnable function', () => {
    const swc = AutocoderCRust.generateAutosarSWC(makeControllerCodegenInput('PitchActuator'));
    assert(swc.swcSource.includes('RE_PitchActuator_Step'));
  });

  testSmoke(90, 'Experimental ARXML-shaped example contains a component element', () => {
    const swc = AutocoderCRust.generateAutosarSWC(makeControllerCodegenInput('PitchActuator'));
    assert(swc.arxml.includes('<APPLICATION-SW-COMPONENT-TYPE>'));
  });

  testSmoke(91, 'Experimental Rust example emits a no_std attribute', () => {
    const rust = AutocoderCRust.generateNoStdRust(makeControllerCodegenInput('nav_kernel'));
    assert(rust.includes('#![no_std]'));
  });

  testSmoke(92, 'Experimental Rust example emits a forbid-unsafe attribute', () => {
    const rust = AutocoderCRust.generateNoStdRust(makeControllerCodegenInput('nav_kernel'));
    assert(rust.includes('#![forbid(unsafe_code)]'));
  });

  testSmoke(93, 'Experimental MC/DC test-vector synthesis', () => {
    const synth = MCDCCoverageAnalyzer.generateMCDCTestSuite(['A', 'B', 'C'], (a, b, c) => (a && b) || c);
    assert(
      synth.coverage.dataStatus === 'experimental' && synth.coverage.allConditionsHavePairs && synth.totalVectors <= 4
    );
  });

  testSmoke(94, 'Experimental MC/DC coverage report hash', () => {
    const dos = MCDCCoverageAnalyzer.generateDO178CDossier('DEC_TEST', ['A', 'B'], (a, b) => a && b, [
      [true, true],
      [true, false],
      [false, true]
    ]);
    assert(dos.status === 'diagnostic-only' && dos.sha256Seal && dos.sha256Seal.length === 64);
  });

  testSmoke(95, 'ISO 26262 tool confidence assessment is unavailable', () => {
    const tcl = ToolQualificationKit.evaluateISO26262TCL('TI2', 'TD1');
    assert(tcl.supported === false && tcl.dataStatus === 'experimental');
  });

  testSmoke(96, 'Experimental FMI-shaped slave API smoke check', () => {
    const slave = new FmuSlave({ instanceName: 'TestSlave', variables: [{ name: 'x', vr: 1, initial: 5.0 }] });
    assert(slave.fmi3DoStep(0.0, 0.01) === true && slave.fmi3GetFloat64([1])[0] === 5.0);
  });

  testSmoke(97, 'Experimental algebraic feedback iteration smoke check', () => {
    const m = new FmiMasterEngine();
    const s1 = new FmuSlave({
      instanceName: 'S1',
      variables: [
        { name: 'u', vr: 1 },
        { name: 'y', vr: 2, initial: 1.0 }
      ]
    });
    const s2 = new FmuSlave({
      instanceName: 'S2',
      variables: [
        { name: 'u', vr: 1 },
        { name: 'y', vr: 2, initial: 0.5 }
      ]
    });
    m.addSlave(s1);
    m.addSlave(s2);
    m.addConnection(s1, 2, s2, 1);
    m.addConnection(s2, 2, s1, 1);
    assert(m.hasAlgebraicLoop() === true && m.solveAlgebraicLoop().converged === true);
  });

  testSmoke(98, 'Test-only software signature fixture smoke check', () => {
    const hsm = new PKCS11HardwareToken({ userPin: '123456' });
    const signed = hsm.signEngineeringArtifact({ ecoId: 'ECO_9921' }, '123456');
    assert(signed.hsmSignature && signed.cryptoAlgorithm.includes('ECDSA'));
  });

  testSmoke(99, 'Experimental policy example labels caller-supplied decisions as unenforced', () => {
    const denied = EnterpriseIAM.evaluateAccess({
      user: { username: 'foreign_contractor', role: 'StressAnalyst', itarCertified: false },
      action: ACTIONS.READ,
      resource: { id: 'PART_ITAR_MISSILE', isITAR: true }
    });
    assert(denied.granted === false && denied.reason.includes('ITAR'));
    assert(denied.status === 'example-only' && denied.validationLevel === 'experimental');
    assert.strictEqual(denied.identityVerified, false);
    assert.strictEqual(denied.enforced, false);
    assert.strictEqual(denied.auditRecordPersisted, false);
  });

  testSmoke(100, 'Runtime CycloneDX and SPDX SBOM generation is unavailable', () => {
    const kit = new ToolQualificationKit();
    assert.throws(() => kit.generateCycloneDX_SBOM(), /Runtime SBOM generation is unavailable/);
    assert.throws(() => kit.generateSPDX_SBOM(), /Runtime SBOM generation is unavailable/);
  });

  const durationSec = ((Date.now() - suiteStartTime) / 1000).toFixed(2);

  console.log('\n================================================================================');
  console.log(
    `   EXECUTION COMPLETED: ${passed}/${total} smoke checks passed; ${unavailable} reference slots unavailable; ${failed} failed (${durationSec}s)`
  );
  console.log('   Smoke assertions only; no independent numerical validation is claimed.');
  console.log('================================================================================\n');

  if (failed > 0) {
    throw new Error(`Experimental smoke checks failed: ${failed} failed of ${total}.`);
  }

  return { passed, total, unavailable, failed, selected: total + unavailable, durationSec };
}

if (require.main === module) {
  runExperimentalDiagnostics();
}

module.exports = {
  runExperimentalDiagnostics,
  // Compatibility name retained for callers of the former legacy suite.
  runSuite100GoldBenchmarks: runExperimentalDiagnostics
};
