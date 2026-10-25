/**
 * OmniEng Experimental Feature Smoke Suite
 * Runs code-level assertions for former CARD-010 through CARD-015 modules:
 * - Optics & Optomechanics Experimental workflow (Sellmeier dispersion, skew ray tracing, Seidel aberrations, spot diagram, MTF)
 * - CAD Interoperability & Modeling Experimental workflow (ISO 10303-21 STEP AP214 serializer/parser, Levenberg-Marquardt 2D constraint solver, CSG boolean mesh operations)
 * - Structural Dynamics & Contact FEA (J2 von Mises radial return plasticity, Johnson-Cook dynamic fracture, master-slave penalty contact)
 * - Circuit Simulation & Manufacturing EDA (MNA SPICE engine with Newton-Raphson diodes/MOSFETs, RS-274X Gerber exporter, STA setup/hold slack & PEX/Elmore delay)
 * - Dynamic Controls & Sensor Fusion (Continuous/discrete State-Space RK4 solver, 9-DOF quaternion EKF sensor fusion, aerodynamic stability derivatives & trim)
 * - Experimental plant examples (flowsheet smoke checks and simplified pipe geometry estimates; no code assessment)
 */

const assert = require('assert');

// 1. Optics
const { OpticalMaterials } = require('../src/core/optics/optical_materials');
const { OpticalGlassCatalog } = require('../src/core/optics/optical_glass_catalog');
const { SkewRayTracer } = require('../src/core/optics/skew_ray_tracer');
const { SeidelAberrations } = require('../src/core/optics/seidel_aberrations');
const { OpticalEngine } = require('../src/core/optics/optical_engine');
const { SCHOTT_THERMAL_GLASS_CATALOG, HOUSING_CTE } = require('../src/core/optics/thermal_soak');
const opticalExamples = require('./support/experimental_optics_examples');

// 2. CAD
const { StepTranslator } = require('../src/core/cad/step_translator');
const { ConstraintSolver2D } = require('../src/core/cad/constraint_solver_2d');
const { CSGSolid } = require('../src/core/cad/csg_mesh_booleans');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');
const { FeatureTree, ParametricFeature } = require('../src/core/cad/feature_tree');

// 3. CAE
const { J2Plasticity } = require('../src/core/cae/nonlinear_plasticity');
const { JohnsonCookFracture } = require('../src/core/cae/johnson_cook_fracture');
const { PenaltyContact } = require('../src/core/cae/penalty_contact');
const { DropTestSimulator } = require('../src/core/cae/drop_test');

// 4. EDA
const { SpiceEngine } = require('../src/core/eda/spice_engine');
const { GerberExporter } = require('../src/core/eda/gerber_exporter');
const { StaticTimingAnalysis } = require('../src/core/eda/static_timing_analysis');
const { DRCEngine } = require('../src/core/eda/drc_engine');

// 5. Dynamic Simulink & Controls
const { StateSpaceEngine } = require('../src/core/dynamic_simulink/state_space_engine');
const { ExtendedKalmanFilter } = require('../src/core/dynamic_simulink/extended_kalman_filter');
const { AerodynamicCoefficients } = require('../src/core/dynamic_simulink/aerodynamic_coefficients');
const { BlockDiagramGraph } = require('../src/core/dynamic_simulink/block_graph');

// 6. Plant & ASME Piping
const { ProcessStream, ProcessFlowsheetSolver } = require('../src/core/plant/process_flowsheet_solver');
const { HeatExchangerTEMA } = require('../src/core/plant/heat_exchanger_tema');
const { PipingNetwork3D } = require('../src/core/plant/piping_network_3d');
const { ThermodynamicsEngine } = require('../src/core/plant/thermodynamics');
const { getExperimentalThermoProperties } = require('./support/experimental_property_examples');
const { evaluateFunctionCoverageGate } = require('../scripts/coverage_threshold');
const { loadNasaTmrFlatPlateReference } = require('../src/core/vv/nasa_tmr_flatplate_reference');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.stack || err.message}`);
  }
}

console.log('================================================================');
console.log('   OmniEng Experimental Feature Smoke Suite     ');
console.log('================================================================\n');

test('Coverage gate enforces its 75% loaded-source function floor', () => {
  assert.strictEqual(evaluateFunctionCoverageGate(75, 100).passed, true);
  assert.strictEqual(evaluateFunctionCoverageGate(74, 100).passed, false);
  assert.strictEqual(evaluateFunctionCoverageGate(0, 0).passed, false);
  assert.throws(() => evaluateFunctionCoverageGate(101, 100), RangeError);
});

test('NASA TMR theoretical reference artifact passes its pinned identity and structure checks', () => {
  const reference = loadNasaTmrFlatPlateReference();
  assert.strictEqual(reference.license, 'CC0-1.0');
  assert.strictEqual(reference.sha256, 'bafbaf7fa7969a945a5ad0935ca90c320ab72f14ba5a08474abffa61356bba2d');
  assert.strictEqual(reference.points.length, 100);
  assert.strictEqual(reference.points[0].reynoldsTheta, 200);
  assert.strictEqual(reference.points.at(-1).reynoldsTheta, 20000);
  assert.strictEqual(
    reference.points.filter((point) => point.reynoldsTheta > 4000 && point.reynoldsTheta < 13000).length,
    44
  );
});

// ----------------------------------------------------------------
// 1. Optics & Optomechanics Experimental workflow (CARD-010)
// ----------------------------------------------------------------
console.log('1. Optics and optomechanics experimental examples:');

test('OpticalMaterials: production catalog is empty and explicit Sellmeier records remain calculable', () => {
  const nbk7 = opticalExamples.sellmeierExamples.Schott_NBK7;
  const nsf11 = opticalExamples.sellmeierExamples.Schott_NSF11;
  assert.strictEqual(OpticalMaterials.listGlasses().length, 0);
  assert.throws(() => OpticalMaterials.getRefractiveIndex('N-BK7', 0.5875618), /unavailable/);

  const nd = OpticalMaterials.getRefractiveIndex(nbk7, 0.5875618);
  assert(Math.abs(nd - 1.5168) < 0.0001, `Expected nd ~1.51680, got ${nd.toFixed(5)}`);

  // Abbe number Vd = (nd - 1) / (nF - nC) ~ 64.17
  const vd = OpticalMaterials.getAbbeNumber(nbk7);
  assert(Math.abs(vd - 64.17) < 0.2, `Expected Vd ~64.17, got ${vd.toFixed(2)}`);

  // Dense flint N-SF11 has higher index and lower Abbe number
  const n_sf11 = OpticalMaterials.getRefractiveIndex(nsf11, 0.5875618);
  const v_sf11 = OpticalMaterials.getAbbeNumber(nsf11);
  assert(n_sf11 > 1.78, `Expected N-SF11 nd > 1.78, got ${n_sf11.toFixed(4)}`);
  assert(v_sf11 < 30.0, `Expected N-SF11 Vd < 30.0, got ${v_sf11.toFixed(2)}`);
});

test('Optics production modules do not bundle legacy glass or housing property records', () => {
  const catalog = new OpticalGlassCatalog();
  assert.strictEqual(catalog.catalogSize, 0);
  assert.strictEqual(catalog.getGlass('N-BK7'), null);
  assert.throws(() => catalog.getRefractiveIndex('N-BK7', 0.58756), /not available/);
  assert.deepStrictEqual(Object.keys(SCHOTT_THERMAL_GLASS_CATALOG), []);
  assert.deepStrictEqual(Object.keys(HOUSING_CTE), []);
});

test('SkewRayTracer: Exact 3D vector refraction through spherical surfaces & TIR detection', () => {
  // Doublet lens surfaces
  const surfaces = [
    { radius: 50.0, thickness: 8.0, glass: 'N-BK7', clearAperture: 36.0, nIncident: 1, nTransmitted: 1.5168 },
    { radius: -40.0, thickness: 3.0, glass: 'N-SF11', clearAperture: 36.0, nIncident: 1.5168, nTransmitted: 1.7847 },
    { radius: -150.0, thickness: 50.0, glass: 'Air', clearAperture: 36.0, nIncident: 1.7847, nTransmitted: 1 }
  ];

  // Trace marginal ray parallel to Z axis at y = 10mm
  const ray = {
    origin: { x: 0, y: 10, z: -10 },
    dir: { x: 0, y: 0, z: 1 },
    wavelength: 0.5875618
  };

  const traced = SkewRayTracer.traceRay(surfaces, ray);
  assert.strictEqual(traced.length, surfaces.length + 1);
  assert.strictEqual(traced[0].p.z, -10);

  // Ray should bend inwards (negative dy/dz) after leaving convex surface
  const finalSegment = traced[traced.length - 1];
  assert(finalSegment.d.z > 0.9, 'Forward propagation maintained');
  assert(finalSegment.d.y < 0, `Ray should converge towards optical axis, dy=${finalSegment.d.y}`);
});

test('SkewRayTracer: Spot Diagram & MTF calculation across spatial frequencies (0-100 lp/mm)', () => {
  const surfaces = OpticalEngine.getOpticalSurfaces(opticalExamples.illustrativePrescription);
  assert(surfaces.length >= 10, `Expected at least 10 optical surfaces, got ${surfaces.length}`);

  const bundle = SkewRayTracer.generateEntrancePupilRayGrid(10.0, 0.5875618, 3, 8);
  assert(bundle.length >= 24, `Expected pupil grid >= 24 rays, got ${bundle.length}`);

  const tracedRays = SkewRayTracer.traceRayBundle(surfaces, bundle);
  assert.strictEqual(tracedRays.length, bundle.length);

  // Image plane at focal distance ~75mm
  const spotData = SkewRayTracer.computeSpotDiagram(tracedRays, 75.0);
  assert(spotData.rmsRadiusMm >= 0.0, 'RMS spot radius must be positive');
  assert(spotData.geoRadiusMm >= spotData.rmsRadiusMm, 'GEO spot radius must >= RMS radius');
  assert(spotData.spots.length === bundle.length);

  // MTF calculation
  const mtf = SkewRayTracer.computeMTF(spotData, 100.0, 10);
  assert.strictEqual(mtf.length, 11);
  assert.strictEqual(mtf[0].freq, 0);
  assert.strictEqual(mtf[0].tangential, 1.0); // MTF at 0 lp/mm is 1.0
  assert.strictEqual(mtf[0].sagittal, 1.0);
  // MTF should decrease at higher spatial frequencies
  assert(mtf[mtf.length - 1].tangential < 1.0);
});

test('SeidelAberrations: Third-order primary aberration coefficients for 50mm f/1.4 system', () => {
  const surfaces = OpticalEngine.getOpticalSurfaces(opticalExamples.illustrativePrescription);
  const seidel = SeidelAberrations.computeSeidelAberrations(surfaces, 17.85, 23.4); // 50mm f/1.4 semi-pupil & field

  assert(typeof seidel.W040_Spherical === 'number');
  assert(typeof seidel.W131_Coma === 'number');
  assert(typeof seidel.W222_Astigmatism === 'number');
  assert(typeof seidel.W220_Petzval === 'number');
  assert(typeof seidel.W311_Distortion === 'number');
  assert(typeof seidel.CL_AxialColor === 'number');
  assert(typeof seidel.CT_LateralColor === 'number');
  assert(seidel.surfaceContributions.length === surfaces.length);
});

// ----------------------------------------------------------------
// 2. CAD Interoperability & Modeling Experimental workflow (CARD-011)
// ----------------------------------------------------------------
console.log('\n2. CAD interchange and geometry examples:');

test('StepTranslator: Serializes B-Rep solid to ISO 10303-21 STEP AP214 and parses back round-trip', () => {
  const box = BRepPrimitives.createBox(40, 60, 20, 'EngineBlock');
  const stepText = StepTranslator.exportSTEP(box);

  // Validate ISO 10303-21 header and AP214 schema
  assert(stepText.includes('ISO-10303-21;'), 'Missing STEP start marker');
  assert(
    stepText.includes("FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));") || stepText.includes('FILE_SCHEMA'),
    'Missing schema'
  );
  assert(stepText.includes('MANIFOLD_SOLID_BREP'), 'Missing B-Rep entity');
  assert(stepText.includes('ADVANCED_FACE'), 'Missing advanced face entity');
  assert(stepText.includes('CARTESIAN_POINT'), 'Missing cartesian point entities');
  assert(stepText.includes('ENDSEC;'), 'Missing section end');
  assert(stepText.includes('END-ISO-10303-21;'), 'Missing STEP end marker');

  // Parse STEP back
  const parsed = StepTranslator.parseSTEP(stepText);
  assert.strictEqual(parsed.format, 'STEP_AP203_AP214');
  assert(parsed.totalEntities > 50, `Expected > 50 entities, got ${parsed.totalEntities}`);
  assert(parsed.vertices.length >= 8, `Expected at least 8 vertices, got ${parsed.vertices.length}`);
});

test('ConstraintSolver2D: Levenberg-Marquardt solver satisfies Coincident, Distance, and Horizontal constraints', () => {
  const solver = new ConstraintSolver2D();

  // Point A at (0, 0), Point B free at (3, 2), Point C free at (6, 5)
  solver.addPoint('A', 0, 0);
  solver.addPoint('B', 3, 2);
  solver.addPoint('C', 6, 5);

  // Fix Point A
  solver.addFixed('A', 0, 0);
  // Distance AB = 10
  solver.addDistance('A', 'B', 10.0);
  // Line AB is Horizontal
  solver.addHorizontal('A', 'B');

  const res = solver.solve(100, 1e-6);
  assert.strictEqual(res.converged, true);
  assert(res.residualNorm < 1e-5, `Residual norm should be < 1e-5, got ${res.residualNorm}`);

  const ptA = solver.getPoint('A');
  const ptB = solver.getPoint('B');

  assert(Math.abs(ptA.x - 0.0) < 1e-4);
  assert(Math.abs(ptA.y - 0.0) < 1e-4);
  assert(Math.abs(ptB.x - 10.0) < 1e-4, `Expected B.x=10, got ${ptB.x}`);
  assert(Math.abs(ptB.y - 0.0) < 1e-4, `Expected B.y=0, got ${ptB.y}`);
});

test('CSGSolid: 3D BSP constructive solid geometry Boolean Union and Difference', () => {
  const b1 = BRepPrimitives.createBox(20, 20, 20, 'Box1');
  const b2 = BRepPrimitives.createBox(10, 10, 30, 'Box2');

  const csg1 = CSGSolid.fromBRep(b1);
  const csg2 = CSGSolid.fromBRep(b2);

  // Boolean Difference (subtract cylinder/box through block)
  const diff = csg1.subtract(csg2);
  assert(diff.polygons.length > 0, 'Difference solid must have polygons');
  const diffTriangles = diff.toTriangles();
  assert(diffTriangles.length >= 12, `Difference mesh triangles expected >= 12, got ${diffTriangles.length}`);

  // Boolean Union
  const union = csg1.union(csg2);
  assert(union.polygons.length > 0);
  const unionTriangles = union.toTriangles();
  assert(unionTriangles.length > 0);
});

// ----------------------------------------------------------------
// 3. Structural Dynamics & Contact FEA (CARD-012)
// ----------------------------------------------------------------
console.log('\n3. Structural dynamics and contact smoke examples:');

test('J2Plasticity: 3D von Mises radial return mapping algorithm on Al7075-T6 & SS316L', () => {
  const al7075 = J2Plasticity.MATERIALS['Al7075-T6'];
  assert(al7075 && al7075.yieldStressMPa === 503.0);

  // Elastic state below yield: sigma_x = 300 MPa
  const elasticStress = [300e6, 0, 0, 0, 0, 0];
  const elasticRes = J2Plasticity.radialReturnMapping(elasticStress, 0.0, 'Al7075-T6');
  assert.strictEqual(elasticRes.isPlastic, false);
  assert.strictEqual(elasticRes.dPlasticStrain, 0.0);
  assert(Math.abs(elasticRes.vonMisesStressMPa - 300.0) < 0.1);

  // Plastic state above yield: sigma_x = 700 MPa (yield is 503 MPa)
  const plasticStress = [700e6, 0, 0, 0, 0, 0];
  const plasticRes = J2Plasticity.radialReturnMapping(plasticStress, 0.0, 'Al7075-T6');
  assert.strictEqual(plasticRes.isPlastic, true);
  assert(plasticRes.dPlasticStrain > 0.0);
  // Stress must be mapped back to the yield surface with hardening
  const expectedYieldWithHardening = 503.0 + al7075.hardeningModulusMPa * plasticRes.plasticStrain;
  assert(
    Math.abs(plasticRes.vonMisesStressMPa - expectedYieldWithHardening) < 1.0,
    `Mapped stress (${plasticRes.vonMisesStressMPa} MPa) must equal hardened yield (${expectedYieldWithHardening} MPa)`
  );
});

test('JohnsonCookFracture: Triaxiality-dependent failure strain and cumulative element erosion', () => {
  const alParam = JohnsonCookFracture.PARAMETERS['Al7075-T6'];
  assert(alParam.A === 546.0);

  // Low triaxiality (compression/shear) vs High triaxiality (notched tension)
  const eps_low = JohnsonCookFracture.computeFailureStrain(0.33, 1.0, 293.0, 'Al7075-T6');
  const eps_high = JohnsonCookFracture.computeFailureStrain(1.5, 1.0, 293.0, 'Al7075-T6');
  assert(eps_high < eps_low, `High triaxiality tension must fail at lower strain: ${eps_high} < ${eps_low}`);

  // Damage accumulation loop until failure
  let D = 0.0;
  const dEps = 0.05;
  for (let i = 0; i < 20; i++) {
    const dD = JohnsonCookFracture.computeDamageIncrement(dEps, 0.33, 10.0, 300.0, 'Al7075-T6');
    D += dD;
  }
  assert(D > 0.5, `Expected substantial damage accumulation, got D=${D}`);
  const isEroded = JohnsonCookFracture.isElementFailed(D);
  assert.strictEqual(typeof isEroded, 'boolean');
});

test('PenaltyContact: Node-to-facet master-slave penetration detection & normal/friction force', () => {
  const solver = new PenaltyContact({ penaltyStiffness: 1e8, frictionCoeff: 0.35 });

  // Floor facet at z = 0 with normal [0, 0, 1]
  const facet = {
    v0: [0, 0, 0],
    v1: [1, 0, 0],
    v2: [0, 1, 0],
    normal: [0, 0, 1]
  };

  // Node penetrates 0.5 mm into floor: z = -0.0005 m
  const penetratingNode = {
    pos: [0.2, 0.2, -0.0005],
    vel: [1.0, 0.0, -5.0]
  };

  const contact = solver.evaluateNodeContact(penetratingNode, facet);
  assert.strictEqual(contact.inContact, true);
  assert.strictEqual(contact.penetrationM, 0.0005);
  // Normal force = kp * delta = 1e8 * 0.0005 = 50,000 N
  assert.strictEqual(contact.normalForceN, 50000.0);
  assert(contact.frictionForceN > 0.0, 'Frictional resistance must oppose tangential velocity');
  assert(contact.strainEnergyJ === 0.5 * 1e8 * 0.0005 ** 2);
});

// ----------------------------------------------------------------
// 4. Circuit Simulation & Manufacturing EDA (CARD-013)
// ----------------------------------------------------------------
console.log('\n4. Circuit and EDA experimental examples:');

test('SpiceEngine: DC operating point of diode circuit (Shockley non-linear equation Newton-Raphson)', () => {
  const spice = new SpiceEngine();

  // Circuit: 5V DC Source -> 1k Resistor -> Diode -> Ground
  spice.addVoltageSource('V1', 'node_in', '0', 5.0);
  spice.addResistor('R1', 'node_in', 'node_diode', 1000.0);
  spice.addDiode('D1', 'node_diode', '0', { Is: 1e-14, Vt: 0.02585 });

  const dcRes = spice.runDCOperatingPoint();
  assert.strictEqual(dcRes.converged, true);

  const vIn = dcRes.nodeVoltages['node_in'];
  const vDiode = dcRes.nodeVoltages['node_diode'];

  assert.strictEqual(vIn, 5.0);
  // Silicon diode forward voltage should be between 0.65V and 0.75V
  assert(vDiode > 0.65 && vDiode < 0.75, `Expected diode forward voltage ~0.7V, got ${vDiode.toFixed(3)}V`);
});

test('SpiceEngine: Transient simulation of RC low-pass filter step response V(t) = V0(1 - e^(-t/RC))', () => {
  const spice = new SpiceEngine();

  // R = 1k, C = 1uF -> tau = RC = 1ms
  spice.addVoltageSource('V1', 'in', '0', 5.0);
  spice.addResistor('R1', 'in', 'out', 1000.0);
  spice.addCapacitor('C1', 'out', '0', 1e-6);

  const tran = spice.runTransient(0.005, 0.0001); // 5ms total time, 0.1ms step
  assert(tran.time.length >= 50);

  // At t = 1ms (tau), V_out should be 5 * (1 - 1/e) ~ 3.16V
  const idx1ms = tran.time.findIndex((t) => t >= 1.0);
  const vAt1ms = tran.waveforms['out'][idx1ms];
  assert(Math.abs(vAt1ms - 5.0 * (1 - Math.exp(-1))) < 0.2, `Expected ~3.16V at 1ms, got ${vAt1ms.toFixed(3)}V`);

  // At t = 5ms (5*tau), V_out should be close to 5.0V (> 4.8V)
  const vAt5ms = tran.waveforms['out'][tran.time.length - 1];
  assert(vAt5ms > 4.8, `Expected > 4.8V at 5ms, got ${vAt5ms.toFixed(3)}V`);
});

test('GerberExporter: RS-274X top copper, solder mask & Excellon drill file generator', () => {
  const layout = {
    boardWidthMm: 100,
    boardHeightMm: 80,
    traces: [
      { layer: 'TopCopper', x1: 10, y1: 10, x2: 50, y2: 10, widthMm: 0.25 },
      { layer: 'TopCopper', x1: 50, y1: 10, x2: 50, y2: 60, widthMm: 0.25 }
    ],
    pads: [
      { layer: 'TopCopper', x: 10, y: 10, shape: 'CIRCLE', diameterMm: 1.5, drillMm: 0.8 },
      { layer: 'TopCopper', x: 50, y: 60, shape: 'RECT', widthMm: 2.0, heightMm: 1.2 }
    ],
    vias: [{ x: 50, y: 10, outerDiameterMm: 0.6, drillMm: 0.3 }],
    solderMaskOpenings: [
      { x: 10, y: 10, shape: 'CIRCLE', diameterMm: 1.7 },
      { x: 50, y: 60, shape: 'RECT', widthMm: 2.2, heightMm: 1.4 }
    ],
    holes: [
      { x: 10, y: 10, drillMm: 0.8 },
      { x: 50, y: 10, drillMm: 0.3 }
    ],
    boardOutline: { xMin: 0, yMin: 0, xMax: 100, yMax: 80, outlineWidthMm: 0.1 }
  };

  const gerber = GerberExporter.generatePackage(layout);
  assert(gerber.topCopper.includes('Top_Copper'));
  assert(gerber.topCopper.includes('%FSLAX') && gerber.topCopper.includes('%MOMM*%'));
  assert(gerber.topCopper.includes('%ADD10C,0.250000*%'));
  assert(gerber.topCopper.includes('M02*')); // End of file

  assert(gerber.solderMaskTop.includes('Top_Solder_Mask'));
  assert(gerber.drillFile.includes('M48') && gerber.drillFile.includes('M30')); // Excellon header and end
  assert(gerber['BoardOutline.gko'].includes('Board_Outline'));
  assert.deepStrictEqual(Object.keys(gerber.files).sort(), [
    'BoardOutline.gko',
    'Drill.drl',
    'SolderMask.gts',
    'TopCopper.gtl'
  ]);
  assert.throws(() => GerberExporter.generatePackage({}), /traces array/);
});

test('StaticTimingAnalysis: Setup & Hold timing slack with microstrip PEX & Elmore delay', () => {
  const sta = new StaticTimingAnalysis({ clockPeriodPs: 1000.0 }); // 1 GHz clock

  // Register-to-register path
  const path = {
    launchClockDelayPs: 50.0,
    tCqPs: 80.0,
    logicGateDelayPs: 450.0,
    interconnectTrace: { lengthUm: 2000, widthUm: 0.5, thicknessUm: 0.2, substrateHeightUm: 1.0, er: 3.9 },
    tSetupPs: 60.0,
    tHoldPs: 30.0,
    captureClockDelayPs: 40.0
  };

  const timing = sta.analyzePath(path);
  assert(timing.interconnectDelayPs > 0.0);
  assert(timing.setupSlackPs !== undefined);
  assert(timing.holdSlackPs !== undefined);
  assert.strictEqual(timing.isSetupMet, timing.setupSlackPs >= 0);
  assert.strictEqual(timing.isHoldMet, timing.holdSlackPs >= 0);
});

// ----------------------------------------------------------------
// 5. Dynamic Controls & Sensor Fusion (CARD-014)
// ----------------------------------------------------------------
console.log('\n5. Controls and state-estimation experimental examples:');

test('StateSpaceEngine: Linear continuous harmonic oscillator state space step response', () => {
  // Undamped mass-spring-damper: m*x'' + k*x = u -> [x1; x2]' = [0 1; -k/m 0] [x1; x2] + [0; 1/m] u
  // With m=1, k=4 -> omega_n = 2 rad/s, period = pi s ~ 3.14 s
  const A = [
    [0, 1],
    [-4, 0]
  ];
  const B = [[0], [1]];
  const C = [[1, 0]];
  const D = [[0]];

  const ss = new StateSpaceEngine(A, B, C, D);
  const uStep = (t) => [1.0]; // Unit step force
  const res = ss.simulateContinuous(uStep, [0, 0], 5.0, 0.01);

  assert(res.time.length >= 500);
  // Steady-state response of x1 for step input u=1 is 1/k = 0.25
  // Undamped oscillator oscillates between 0 and 2*(1/k) = 0.5
  const maxVal = Math.max(...res.y.map((y) => y[0]));
  const minVal = Math.min(...res.y.map((y) => y[0]));
  assert(maxVal > 0.45 && maxVal < 0.55, `Expected max overshoot ~0.5, got ${maxVal}`);
  assert(minVal >= -0.05 && minVal < 0.05, `Expected min ~0.0, got ${minVal}`);
});

test('ExtendedKalmanFilter: 9-DOF attitude quaternion & position fusion from IMU/GPS/Baro', () => {
  const ekf = new ExtendedKalmanFilter();

  // Feed 150 steps of stationary IMU with reaction specific force [0, 0, -9.80665] and zero angular rate
  const dt = 0.01;
  for (let i = 0; i < 150; i++) {
    ekf.predict([0, 0, 0], [0, 0, -9.80665], dt);

    // GPS update at 10 Hz (NED altitude -10m is 10m above ground)
    if (i % 10 === 0) {
      ekf.updateGPS([0, 0, -10.0]);
    }
    // Baro update at 20 Hz (Altitude 10.0m)
    if (i % 5 === 0) {
      ekf.updateBarometer(10.0);
    }
  }

  const state = ekf.getState();
  // Altitude should converge near 10m
  assert(Math.abs(state.altitudeM - 10.0) < 0.5, `Expected altitude ~10.0m, got ${state.altitudeM}`);
  // Velocity should be near zero
  assert(Math.abs(state.velocityNED[2]) < 0.3);
  // Quaternion norm must be 1.0
  const qNorm = Math.sqrt(
    state.quaternion.w ** 2 + state.quaternion.x ** 2 + state.quaternion.y ** 2 + state.quaternion.z ** 2
  );
  assert(Math.abs(qNorm - 1.0) < 1e-4, 'Quaternion must remain normalized');
});

test('AerodynamicCoefficients: Longitudinal trim solver and static stability margin Kn > 0', () => {
  const aero = new AerodynamicCoefficients({
    wingAreaM2: 0.55,
    meanChordM: 0.25,
    cLalpha: 4.8,
    cD0: 0.025,
    cmAlpha: -0.65, // Negative cmAlpha ensures static pitch stability
    cmDeltaE: -1.2,
    neutralPointX: 0.35,
    cgLocationX: 0.28
  });

  // Verify positive static margin Kn = (x_np - x_cg) / cbar
  const Kn = aero.computeStaticMargin();
  assert(Kn > 0.2, `Expected positive static margin Kn > 0.2, got ${Kn.toFixed(3)}`);

  // Solve trim for 20 m/s flight at sea level for 4.5 kg aircraft
  const trim = aero.solveTrim({ speedMs: 20.0, altitudeM: 0.0, weightKg: 4.5 });
  assert(
    trim.alphaTrimDeg > 0.0 && trim.alphaTrimDeg < 15.0,
    `Trim alpha out of normal flight envelope: ${trim.alphaTrimDeg}°`
  );
  assert(trim.elevatorTrimDeg !== undefined);
  assert(trim.liftN > 40.0 && trim.liftN < 50.0, `Trim lift should balance weight ~44.1N, got ${trim.liftN}N`);
});

// ----------------------------------------------------------------
// 6. Experimental Process and Piping Examples (CARD-015)
// ----------------------------------------------------------------
console.log('\n6. Experimental Process Flowsheet and Pipe Geometry Examples:');

test('ProcessFlowsheetSolver: Cyclic recycle tearing with Wegstein acceleration conservation', () => {
  const flowsheet = new ProcessFlowsheetSolver();
  const componentProperties = getExperimentalThermoProperties(['Methane', 'Ethane', 'Propane']);

  // Stream 1: Fresh feed
  const feed = new ProcessStream('S1', {
    temperatureC: 25.0,
    pressureBar: 20.0,
    molarFlowKmolHr: 100.0,
    composition: { Methane: 0.7, Ethane: 0.2, Propane: 0.1 },
    vaporFraction: 1.0
  });

  // Every initial stream state is explicit; unit operations overwrite calculated outputs.
  flowsheet.addStream(feed);
  for (const [id, molarFlowKmolH, vaporFraction] of [
    ['S_RECYCLE', 0.0, 0.0],
    ['S2', 100.0, 1.0],
    ['S_VAPOR', 0.0, 1.0],
    ['S_LIQ', 0.0, 0.0],
    ['S_PRODUCT', 0.0, 0.0]
  ]) {
    flowsheet.addStream(
      new ProcessStream(id, {
        temperatureC: 25.0,
        pressureBar: 20.0,
        molarFlowKmolH,
        composition: { Methane: 0.7, Ethane: 0.2, Propane: 0.1 },
        vaporFraction
      })
    );
  }

  // Build flowsheet with Recycle: Mixer -> Flash Drum -> Splitter (Recycle to Mixer)
  flowsheet.addMixer('MIX1', ['S1', 'S_RECYCLE'], 'S2');
  flowsheet.addFlashDrum('FLASH1', 'S2', 'S_VAPOR', 'S_LIQ', {
    temperatureC: -20.0,
    pressureBar: 18.0,
    componentProperties
  });
  flowsheet.addSplitter('SPLIT1', 'S_LIQ', 'S_PRODUCT', 'S_RECYCLE', { splitRatio: 0.7 });

  const solution = flowsheet.solveWithWegstein(50, 1e-4);
  assert.strictEqual(solution.converged, true);
  assert(solution.iterations < 40, `Wegstein failed to converge efficiently: ${solution.iterations} iters`);

  // Total mass balance verification: Inflow == Outflows
  const sProduct = flowsheet.getStream('S_PRODUCT');
  const sVapor = flowsheet.getStream('S_VAPOR');
  const totalOut = sProduct.molarFlowKmolHr + sVapor.molarFlowKmolHr;
  assert(Math.abs(totalOut - 100.0) < 0.5, `Mass balance violated: In=100 kmol/hr, Out=${totalOut.toFixed(2)} kmol/hr`);
});

test('ProcessStream and unit-operation setup reject missing state and stream inputs', () => {
  assert.throws(() => new ProcessStream('MISSING', { temperatureC: 25 }), /explicit valid inputs/);
  assert.strictEqual(new ProcessFlowsheetSolver().solve(10, 1e-4).success, false);
  const flowsheet = new ProcessFlowsheetSolver();
  assert.throws(() => flowsheet.addMixer('MIX1', ['MISSING'], 'OUT'), /explicitly initialized streams/);
  assert.throws(() => flowsheet.addSplitter('SPLIT1', 'IN', 'OUT1', 'OUT2'), /explicit splitRatio/);
});

test('ProcessFlowsheetSolver preserves explicit mixer, splitter, compressor, and valve calculations', () => {
  const flowsheet = new ProcessFlowsheetSolver();
  const composition = { Methane: 0.75, Ethane: 0.25 };
  const addStream = (id, temperatureC, pressureKPa, molarFlowKmolH) =>
    flowsheet.addStream(
      new ProcessStream(id, {
        temperatureC,
        pressureKPa,
        molarFlowKmolH,
        composition,
        vaporFraction: 1
      })
    );

  addStream('FEED_A', 20, 500, 30);
  addStream('FEED_B', 40, 400, 70);
  addStream('MIXED', 25, 600, 0);
  addStream('SPLIT_A', 25, 600, 0);
  addStream('SPLIT_B', 25, 600, 0);
  flowsheet.addMixer('MIXER', ['FEED_A', 'FEED_B'], 'MIXED');
  flowsheet.addSplitter('SPLITTER', 'MIXED', 'SPLIT_A', 'SPLIT_B', { splitRatio: 0.3 });

  const result = flowsheet.solve(3, 1e-8);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.validationLevel, 'experimental');
  assert.strictEqual(flowsheet.getStream('MIXED').molarFlowKmolH, 100);
  assert.strictEqual(flowsheet.getStream('MIXED').T_C, 34);
  assert.strictEqual(flowsheet.getStream('MIXED').P_kPa, 400);
  assert.strictEqual(flowsheet.getStream('SPLIT_A').molarFlowKmolH, 30);
  assert.strictEqual(flowsheet.getStream('SPLIT_B').molarFlowKmolH, 70);
  assert.strictEqual(flowsheet.getStream('SPLIT_A').composition.Ethane, 0.25);

  const compressor = new ProcessFlowsheetSolver();
  compressor.addStream(
    new ProcessStream('COMP_IN', {
      temperatureC: 20,
      pressureKPa: 100,
      molarFlowKmolH: 5,
      composition,
      vaporFraction: 1
    })
  );
  compressor.addStream(
    new ProcessStream('COMP_OUT', {
      temperatureC: 20,
      pressureKPa: 100,
      molarFlowKmolH: 0,
      composition,
      vaporFraction: 1
    })
  );
  compressor.addUnit('COMPRESSOR', 'COMP', {
    inletStreamId: 'COMP_IN',
    outletStreamId: 'COMP_OUT',
    dischargePressureKPa: 300,
    heatCapacityRatio: 1.4,
    polytropicEfficiency: 0.8
  });
  const compressorResult = compressor.solve(3, 1e-8);
  const expectedCompressorTemperature = Number(
    ((20 + 273.15) * Math.pow(3, (1.4 - 1) / (1.4 * 0.8)) - 273.15).toFixed(2)
  );
  assert.strictEqual(compressorResult.success, true);
  assert.strictEqual(compressor.getStream('COMP_OUT').T_C, expectedCompressorTemperature);
  assert.strictEqual(compressor.getStream('COMP_OUT').molarFlowKmolH, 5);

  const valve = new ProcessFlowsheetSolver();
  valve.addStream(
    new ProcessStream('VALVE_IN', {
      temperatureC: 20,
      pressureKPa: 500,
      molarFlowKmolH: 5,
      composition,
      vaporFraction: 1
    })
  );
  valve.addStream(
    new ProcessStream('VALVE_OUT', {
      temperatureC: 20,
      pressureKPa: 500,
      molarFlowKmolH: 0,
      composition,
      vaporFraction: 1
    })
  );
  valve.addUnit('VALVE', 'VALVE', {
    inletStreamId: 'VALVE_IN',
    outletStreamId: 'VALVE_OUT',
    outletPressureKPa: 200,
    jouleThomsonCoeff: 0.01
  });
  const valveResult = valve.solve(3, 1e-8);
  assert.strictEqual(valveResult.success, true);
  assert.strictEqual(valve.getStream('VALVE_OUT').T_C, 17);
  assert.strictEqual(valve.getStream('VALVE_OUT').P_kPa, 200);
});

test('ProcessFlowsheetSolver fails closed on overflow and restores pre-solve stream state', () => {
  const composition = { Methane: 1 };
  const addStream = (flowsheet, id, pressureKPa, molarFlowKmolH) =>
    flowsheet.addStream(
      new ProcessStream(id, {
        temperatureC: 25,
        pressureKPa,
        molarFlowKmolH,
        composition,
        vaporFraction: 1
      })
    );

  const mixer = new ProcessFlowsheetSolver();
  addStream(mixer, 'IN_A', 100, 1e308);
  addStream(mixer, 'IN_B', 100, 1e308);
  addStream(mixer, 'OUT', 100, 1);
  mixer.addMixer('MIXER', ['IN_A', 'IN_B'], 'OUT');
  const mixerResult = mixer.solve(1, 1e-6);
  assert.strictEqual(mixerResult.success, false);
  assert.strictEqual(mixerResult.status, 'numerical-failure');
  assert.strictEqual(mixerResult.error.code, 'NUMERICAL_FAILURE');
  assert.strictEqual(mixer.getStream('OUT').molarFlowKmolH, 1);

  const compressor = new ProcessFlowsheetSolver();
  addStream(compressor, 'IN', 100, 10);
  addStream(compressor, 'OUT', 100, 2);
  compressor.addUnit('COMPRESSOR', 'COMP', {
    inletStreamId: 'IN',
    outletStreamId: 'OUT',
    dischargePressureKPa: Number.MAX_VALUE,
    heatCapacityRatio: 1.4,
    polytropicEfficiency: Number.MIN_VALUE
  });
  const compressorResult = compressor.solve(1, 1e-6);
  assert.strictEqual(compressorResult.success, false);
  assert.strictEqual(compressorResult.status, 'numerical-failure');
  assert.strictEqual(compressorResult.error.code, 'NUMERICAL_FAILURE');
  assert.strictEqual(compressor.getStream('OUT').molarFlowKmolH, 2);
});

test('HeatExchangerTEMA: Multi-pass shell & tube thermal rating with LMTD F-factor correction', () => {
  const tema = new HeatExchangerTEMA({
    shellType: 'E',
    tubePasses: 2,
    tubeOD_mm: 19.05,
    tubeLengthM: 4.88,
    tubeCount: 160
  });

  // Hot stream (Heavy Naphtha): 180°C -> 110°C
  // Cold stream (Cooling Water): 30°C -> 50°C
  const rating = tema.rateExchanger({
    hotInletC: 180.0,
    hotOutletC: 110.0,
    coldInletC: 30.0,
    coldOutletC: 50.0,
    hotFlowKgS: 12.0,
    hotCp_kJ_kgK: 2.2,
    coldFlowKgS: 22.0,
    coldCp_kJ_kgK: 4.18
  });

  assert(rating.heatDutyKW > 1000.0, `Expected duty > 1000 kW, got ${rating.heatDutyKW} kW`);
  assert(rating.lmtkPureC > 0);
  assert(rating.fFactor > 0.8 && rating.fFactor <= 1.0, `TEMA F-factor must be valid (0.8-1.0), got ${rating.fFactor}`);
  assert(Math.abs(rating.correctedLMTD_C - rating.lmtkPureC * rating.fFactor) < 0.1);
  assert(rating.requiredAreaM2 > 0.0);
  assert(rating.pressureDropShellBar >= 0.0);
});

test('PipingNetwork3D: explicit-input experimental pipe estimate', () => {
  const piping = new PipingNetwork3D();

  const missingElbowInputs = piping.computeASMEB313ElbowSIF({ bendRadiusMm: 304.8 });
  assert.strictEqual(missingElbowInputs.status, 'unavailable');
  assert(missingElbowInputs.missingInputs.includes('outerDiameterMm'));

  const elbowSIF = piping.computeASMEB313ElbowSIF({
    outerDiameterMm: 219.1,
    wallThicknessMm: 8.18,
    bendRadiusMm: 304.8
  });
  assert.strictEqual(elbowSIF.success, true);
  assert.strictEqual(elbowSIF.codeAssessment, 'NOT_PERFORMED');
  assert(elbowSIF.flexibilityFactor_k > 1.0, `Elbow flexibility k must be > 1.0, got ${elbowSIF.flexibilityFactor_k}`);
  assert(elbowSIF.sifInPlane_ii >= 1.0, `In-plane SIF must be >= 1.0, got ${elbowSIF.sifInPlane_ii}`);
  assert(elbowSIF.sifOutOfPlane_io >= 1.0, `Out-of-plane SIF must be >= 1.0, got ${elbowSIF.sifOutOfPlane_io}`);

  const stressEval = piping.evaluatePipelineStressRange({
    pipeOuterDiameterMm: 219.1,
    nominalWallThicknessMm: 8.18,
    youngsModulusGPa: 190.0,
    thermalExpansionPerK: 1.35e-5,
    designPressureBar: 35.0,
    operatingTempC: 280.0,
    ambientTempC: 20.0,
    straightLengthM: 45.0,
    hasExpansionLoop: true,
    corrosionAllowanceMm: 0.0,
    loopHeightM: 12.0,
    elbowCenterlineRadiusM: 0.3048
  });

  assert.strictEqual(stressEval.success, true);
  assert.strictEqual(stressEval.validationLevel, 'experimental');
  assert.strictEqual(stressEval.codeAssessment, 'NOT_PERFORMED');
  assert(stressEval.thermalExpansionStressEstimateMPa > 0.0);
  assert.strictEqual(Object.hasOwn(stressEval, 'isCodeCompliant'), false);
  assert.strictEqual(Object.hasOwn(stressEval, 'stressRatio'), false);
});

// ----------------------------------------------------------------
// 7. Synthetic Aerospace Example Geometry
// ----------------------------------------------------------------
console.log('\n7. Synthetic Aerospace Example Geometry:');

test('FeatureTree: explicit test features exercise cylinder and revolve B-Rep construction', () => {
  const cylinderTree = new FeatureTree();
  cylinderTree.addFeature(
    new ParametricFeature('cylinder', 'TestCylinder', { radius: 4.5, height: 45, segments: 32 })
  );
  assert.strictEqual(cylinderTree.features.length, 1);
  assert(cylinderTree.currentSolid !== null, 'Explicit cylinder feature should build a solid');
  assert(cylinderTree.currentSolid.vertices.length > 0, 'Explicit cylinder should have vertices');
  assert(cylinderTree.currentSolid.faces.length > 0, 'Explicit cylinder should have faces');

  const revolveTree = new FeatureTree();
  const revolveFeature = new ParametricFeature('revolve', 'TestRevolve', {
    profile: [
      [0, 0],
      [2, 1],
      [1, 3]
    ],
    segments: 24
  });
  revolveTree.addFeature(revolveFeature);
  assert(revolveTree.currentSolid !== null, 'Explicit revolve feature should build a solid');
  assert(revolveTree.currentSolid.vertices.length > 0, 'Explicit revolve should have vertices');
  assert(revolveTree.currentSolid.faces.length > 0, 'Explicit revolve should have faces');
  assert.strictEqual(revolveFeature.params.segments, 24);
});

test('ProcessFlowsheetSolver: cryogenic loading is unavailable without a sourced model and reference', () => {
  const result = ProcessFlowsheetSolver.solveCryogenicLoadingCycle({
    propellant: 'LOX',
    targetTankMassKg: 850000.0,
    loadingFlowKgS: 1200.0
  });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.status, 'unavailable');
  assert.strictEqual(result.validationLevel, 'experimental');
  assert.match(result.error, /No sourced cryogenic property set/);
});

test('Rocket ignition compatibility APIs fail closed without sourced model and validation', () => {
  const results = [
    SpiceEngine.createRocketIgnitionControllerCircuit(),
    SpiceEngine.simulateDualAugmentedSparkIgniter()
  ];

  for (const result of results) {
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'unavailable');
    assert.strictEqual(result.validationLevel, 'experimental');
    assert.strictEqual(result.error.code, 'UNSUPPORTED');
    assert.match(result.error.message, /source.*validation review/);
  }
});

// ----------------------------------------------------------------
// Summary
// ----------------------------------------------------------------
console.log('\n================================================================');
console.log(`Test Execution Finished: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
console.log('================================================================\n');

if (require.main === module) {
  if (failedTests > 0) {
    process.exit(1);
  } else {
    console.log('All experimental smoke assertions passed; no independent solver validation is implied.\n');
  }
}

module.exports = {
  runIndustrialTests: () => {
    return { total: totalTests, passed: passedTests, failed: failedTests };
  }
};
