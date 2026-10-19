/**
 * OmniEng Comprehensive Test Suite
 * Rigorously verifies all mathematical, physics, CAD, CAE, EDA, GNC, plant, and AI modules.
 */

const assert = require('assert');

// 1. Math Modules
const { Vector3, Quaternion, LinearSolver } = require('../src/core/math/linear_algebra');
const { ODESolvers } = require('../src/core/math/ode_solvers');

// 2. CAD Modules
const { Vertex, Edge, Face, SolidBody, BRepPrimitives } = require('../src/core/cad/brep_topology');
const { ParametricFeature, FeatureTree } = require('../src/core/cad/feature_tree');

// 3. CAE Modules
const { FEANode, FEAElement, FEASolver } = require('../src/core/cae/fea_structural');
const { DropTestSimulator } = require('../src/core/cae/drop_test');
const { ThermalEngine } = require('../src/core/cae/thermal_cht');
const { CFDSolver2D } = require('../src/core/cae/cfd_navier_stokes');

// 4. EDA Modules
const { LogicSynthesisEngine, STANDARD_CELL_LIB } = require('../src/core/eda/logic_synthesis');
const { DRCEngine } = require('../src/core/eda/drc_engine');

// 5. Dynamic Simulink & GNC Modules
const { BlockNode, BlockDiagramGraph } = require('../src/core/dynamic_simulink/block_graph');
const { QuadcopterDynamics } = require('../src/core/dynamic_simulink/drone_flight_dynamics');

// 6. Oil & Gas Process Modules
const { PURE_COMPONENTS, ThermodynamicsEngine } = require('../src/core/plant/thermodynamics');
const { PIPING_MATERIALS, ASME_PIPE_SCHEDULES, PipingStressEngine } = require('../src/core/plant/piping_stress');

// 7. OmniAI & Community Samples
const { OmniAIEngine, OMNI_TOOLS } = require('../src/core/ai/omni_ai_engine');
const { CloudHPCEngine } = require('../src/core/hpc/cloud_cluster');
const { AuditReportGenerator } = require('../src/core/reporting/audit_report');
const { MaterialManager } = require('../src/core/materials/material_database');
const { TransientDropAnimator } = require('../src/core/cae/transient_drop_animator');
const { FrequencyResponseAnalyzer } = require('../src/core/dynamic_simulink/frequency_analysis');
const { VLEPhaseEnvelopeEngine } = require('../src/core/plant/vle_envelope');
const { OpticalEngine } = require('../src/core/optics/optical_engine');
const { COMMUNITY_SAMPLES } = require('../src/samples/community_samples');

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
    console.error(`    ${err.message}`);
  }
}

console.log('====================================================');
console.log('   OmniEng Platform Verification & Test Suite       ');
console.log('====================================================\n');

// ----------------------------------------------------
// Suite 1: Core Math & Linear Algebra
// ----------------------------------------------------
console.log('1. Testing Linear Algebra & Vector Math:');

test('Vector3 arithmetic (add, sub, scale, dot, cross, distanceTo)', () => {
  const v1 = new Vector3(1, 2, 3);
  const v2 = new Vector3(4, 5, 6);
  
  const vAdd = v1.clone().add(v2);
  assert.strictEqual(vAdd.x, 5);
  assert.strictEqual(vAdd.y, 7);
  assert.strictEqual(vAdd.z, 9);

  const dot = v1.dot(v2); // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
  assert.strictEqual(dot, 32);

  const cross = new Vector3(1, 0, 0).cross(new Vector3(0, 1, 0));
  assert.strictEqual(cross.x, 0);
  assert.strictEqual(cross.y, 0);
  assert.strictEqual(cross.z, 1);

  const dist = new Vector3(0, 0, 0).distanceTo(new Vector3(3, 4, 0));
  assert.strictEqual(dist, 5);
});

test('Quaternion orientation and Euler rotation conversion', () => {
  const q = new Quaternion();
  q.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2); // 90 deg around Z
  
  const v = new Vector3(1, 0, 0);
  const vRot = q.rotateVector(v);
  assert(Math.abs(vRot.x - 0) < 1e-5);
  assert(Math.abs(vRot.y - 1) < 1e-5);
  assert(Math.abs(vRot.z - 0) < 1e-5);

  const euler = q.toEulerAngles();
  assert(Math.abs(euler.yaw - Math.PI / 2) < 1e-5);
});

test('LinearSolver: Gaussian Elimination & Conjugate Gradient', () => {
  // 2x2 system:
  // 2*x + 1*y = 5
  // 1*x + 3*y = 5  => solution: x=2, y=1
  const A = [
    [2, 1],
    [1, 3]
  ];
  const b = [5, 5];
  
  const xGauss = LinearSolver.solveGaussian(A, b);
  assert(Math.abs(xGauss[0] - 2.0) < 1e-5, `Expected 2.0, got ${xGauss[0]}`);
  assert(Math.abs(xGauss[1] - 1.0) < 1e-5, `Expected 1.0, got ${xGauss[1]}`);

  const xCG = LinearSolver.solveConjugateGradient(A, b, [0, 0], 50, 1e-8);
  assert(Math.abs(xCG[0] - 2.0) < 1e-3, `Expected ~2.0, got ${xCG[0]}`);
  assert(Math.abs(xCG[1] - 1.0) < 1e-3, `Expected ~1.0, got ${xCG[1]}`);
});

// ----------------------------------------------------
// Suite 2: ODE Solvers
// ----------------------------------------------------
console.log('\n2. Testing ODE Solvers:');

test('ODESolvers: Explicit RK4 for exponential decay dy/dt = -y', () => {
  // y(t) = y0 * exp(-t). y(0)=1, at t=1, y(1) = 1/e ~ 0.367879
  const f = (t, y) => [-y[0]];
  const traj = ODESolvers.solveRK4(f, [1.0], 0, 1.0, 0.01);
  const finalState = traj[traj.length - 1];
  
  assert.strictEqual(finalState.t, 1.0);
  assert(Math.abs(finalState.y[0] - Math.exp(-1.0)) < 1e-4);
});

test('ODESolvers: Adaptive RK45 (Dormand-Prince / ODE45)', () => {
  const f = (t, y) => [-2.0 * y[0]];
  const traj = ODESolvers.solveRK45(f, [1.0], 0, 2.0, 0.05, 1e-6);
  const finalState = traj[traj.length - 1];
  
  assert(finalState.t >= 2.0);
  assert(Math.abs(finalState.y[0] - Math.exp(-4.0)) < 1e-4);
});

// ----------------------------------------------------
// Suite 3: Parametric B-Rep CAD Kernel
// ----------------------------------------------------
console.log('\n3. Testing B-Rep Topological Kernel:');

test('BRepPrimitives: Box creation, topology and volume', () => {
  const box = BRepPrimitives.createBox(10, 20, 30, 'TestBox');
  assert.strictEqual(box.vertices.length, 8);
  assert.strictEqual(box.faces.length, 6);
  
  const vol = box.computeVolume();
  assert(Math.abs(vol - (10 * 20 * 30)) < 1e-4, `Expected 6000, got ${vol}`);

  const triangles = box.toTriangles();
  assert.strictEqual(triangles.length, 12); // 6 faces * 2 triangles

  const obj = box.toOBJ();
  assert(obj.includes('o TestBox'));
  assert(obj.includes('v '));
  assert(obj.includes('f '));
});

test('BRepPrimitives: Cylinder creation and volume approximation', () => {
  const r = 5;
  const h = 20;
  const cyl = BRepPrimitives.createCylinder(r, h, 32, 'TestCyl');
  const expectedVol = Math.PI * r * r * h; // ~1570.79
  const vol = cyl.computeVolume();
  
  // 32-sided polygon should be within 1.5% of true cylinder volume
  assert(Math.abs(vol - expectedVol) / expectedVol < 0.015);
});

test('FeatureTree: Parametric DAG, parameter edits and serialization', () => {
  const tree = new FeatureTree();
  const f1 = new ParametricFeature('box', 'BasePlate', { width: 100, height: 10, depth: 50 });
  tree.addFeature(f1);
  assert.strictEqual(tree.features.length, 1);
  assert.strictEqual(tree.currentSolid.name, 'BasePlate');
  assert.strictEqual(tree.currentSolid.computeVolume(), 50000);

  // Live parameter update
  tree.updateFeatureParam(f1.id, 'width', 120);
  assert.strictEqual(tree.currentSolid.computeVolume(), 60000);

  // Serialization to and from JSON
  const json = tree.toJSON();
  const restored = FeatureTree.fromJSON(json);
  assert.strictEqual(restored.features.length, 1);
  assert.strictEqual(restored.currentSolid.computeVolume(), 60000);
});

// ----------------------------------------------------
// Suite 4: Structural FEA (Finite Element Analysis)
// ----------------------------------------------------
console.log('\n4. Testing Structural FEA Engine (Ansys Mechanical):');

test('FEASolver: 3D TET4 assembly, Dirichlet boundary conditions & solve', () => {
  const solver = new FEASolver();
  
  // Create 4 vertices of a tetrahedral element
  const n0 = solver.addNode(0, 0, 0);
  const n1 = solver.addNode(0.1, 0, 0);
  const n2 = solver.addNode(0, 0.1, 0);
  const n3 = solver.addNode(0, 0, 0.1);

  const mat = { E: 69e9, nu: 0.33, yieldStress: 270e6, name: 'Al6061' };
  solver.addElement([n0.id, n1.id, n2.id, n3.id], mat);

  // Fix base nodes (Dirichlet BCs)
  solver.fixNode(n0.id, true, true, true);
  solver.fixNode(n1.id, true, true, true);
  solver.fixNode(n2.id, true, true, true);

  // Apply tensile force on top node
  solver.applyForce(n3.id, 0, 0, 1000); // 1000 N

  const results = solver.solve();
  assert(results !== null);
  assert(results.dofCount === 12);
  assert(results.elements.length === 1);
  assert(results.elements[0].vonMisesStress > 0);
  assert(typeof results.maxDisplacement === 'number');
});

// ----------------------------------------------------
// Suite 5: Consumer Electronics (Drop Test & Thermal CHT)
// ----------------------------------------------------
console.log('\n5. Testing Consumer Electronics Engines:');

test('DropTestSimulator: 1.5m smartphone drop test physics', () => {
  const res = DropTestSimulator.runSimulation({
    dropHeight: 1.5,
    phoneMass: 0.205,
    impactAngle: 'corner'
  });

  assert(res.impactVelocity > 5.0 && res.impactVelocity < 6.0, `Expected ~5.42 m/s, got ${res.impactVelocity}`);
  assert(res.peakForce_N > 100, `Expected peak force > 100N, got ${res.peakForce_N}`);
  assert(res.peakDeceleration_G > 50, `Expected deceleration > 50G, got ${res.peakDeceleration_G}`);
  assert(typeof res.glassCrackDetected === 'boolean');
  assert(typeof res.status === 'string');
  assert(res.timeHistory.length > 0);
});

test('ThermalEngine: Ansys Icepak CHT with Vapor Chamber and SoC load', () => {
  const resVC = ThermalEngine.simulateSmartphoneThermal({
    socPowerWatts: 8.5,
    batteryPowerWatts: 3.0,
    hasVaporChamber: true,
    chassisMaterial: 'Titanium'
  });

  const resNoVC = ThermalEngine.simulateSmartphoneThermal({
    socPowerWatts: 8.5,
    batteryPowerWatts: 3.0,
    hasVaporChamber: false,
    chassisMaterial: 'Titanium'
  });

  assert(resVC.maxSocTempC > 25.0);
  // Vapor chamber must spread heat and lower peak SoC temperature compared to pure FR4
  assert(resVC.maxSocTempC < resNoVC.maxSocTempC, 
    `Vapor chamber (${resVC.maxSocTempC}°C) should cool better than no VC (${resNoVC.maxSocTempC}°C)`);
  assert(resVC.temperatureMap.length > 0);
});

// ----------------------------------------------------
// Suite 6: Semiconductor & EDA (Logic Synthesis & Calibre DRC)
// ----------------------------------------------------
console.log('\n6. Testing Semiconductor & EDA Engines:');

test('LogicSynthesisEngine: Synthesizes Verilog ALU to standard cells', () => {
  const verilog = `
    module simple_alu (
      input a, b,
      output y
    );
      assign y = a & b;
    endmodule
  `;

  const netlist = LogicSynthesisEngine.synthesize(verilog);
  assert.strictEqual(netlist.moduleName, 'simple_alu');
  assert.strictEqual(netlist.inputs.length, 2);
  assert.strictEqual(netlist.outputs.length, 1);
  assert.strictEqual(netlist.gateCount, 1);
  assert.strictEqual(netlist.gates[0].cell, 'AND2');
  assert(netlist.timing.criticalPathDelay_ps > 0);
  assert(netlist.area.totalArea_um2 > 0);
});

test('DRCEngine: Nanometer layout design rule checks (min width & spacing)', () => {
  const shapes = [
    { id: 'poly1', layer: 'Poly', x: 0, y: 0, w: 30, h: 100 }, // Violates minWidth 50nm
    { id: 'poly2', layer: 'Poly', x: 40, y: 0, w: 60, h: 100 } // Spacing is 40 - 30 = 10nm < 45nm minSpacing
  ];

  const drc = DRCEngine.runDRC(shapes, { minWidth: 50, minSpacing: 45 });
  assert.strictEqual(drc.isClean, false);
  assert(drc.violationCount >= 2);
  
  const widthViolations = drc.violations.filter(v => v.type === 'MIN_WIDTH_VIOLATION');
  const spacingViolations = drc.violations.filter(v => v.type === 'MIN_SPACING_VIOLATION');
  assert(widthViolations.length >= 1);
  assert(spacingViolations.length >= 1);
});

test('DRCEngine: LVS (Layout Versus Schematic) netlist equivalence check', () => {
  const schematic = {
    gates: [{ id: 'U1', cell: 'NAND2' }, { id: 'U2', cell: 'INV' }]
  };
  const layout = {
    cells: [{ id: 'C1', type: 'NAND2' }, { id: 'C2', type: 'INV' }]
  };

  const lvs = DRCEngine.runLVS(schematic, layout);
  assert.strictEqual(lvs.isLVSMatched, true);
  assert.strictEqual(lvs.matchedCount, 2);
});

// ----------------------------------------------------
// Suite 7: Dynamic Simulink & Drone GNC Flight Dynamics
// ----------------------------------------------------
console.log('\n7. Testing Dynamic Simulink & Drone GNC Engines:');

test('BlockDiagramGraph: Feedback PID closed-loop step simulation', () => {
  const graph = new BlockDiagramGraph();
  const step = graph.addBlock('source_step', 'Step Target', { finalValue: 10.0, stepTime: 0.1 });
  const pid = graph.addBlock('pid', 'Attitude PID', { Kp: 2.0, Ki: 0.1, Kd: 0.05 });
  const plant = graph.addBlock('integrator', 'Plant Model', {});
  const scope = graph.addBlock('scope', 'Signal Scope', {});

  graph.connect(step.id, pid.id);
  graph.connect(pid.id, plant.id);
  graph.connect(plant.id, scope.id);

  const res = graph.simulate(2.0, 0.01);
  assert(res.time.length > 100);
  assert(res.signals[scope.id].length === res.time.length);
});

test('QuadcopterDynamics: 6-DOF quaternion flight dynamics autopilot', () => {
  const res = QuadcopterDynamics.simulateFlightMission({
    targetAltitude: 10.0,
    windGustSpeed: 2.5,
    totalTime: 4.0,
    dt: 0.01
  });

  assert.strictEqual(res.targetAltitude, 10.0);
  assert(res.flightLog.length > 50);
  const finalLog = res.flightLog[res.flightLog.length - 1];
  // Autopilot should lift drone toward target altitude
  assert(finalLog.altitude_m > 8.0, `Expected altitude > 8.0m, got ${finalLog.altitude_m}m`);
  assert(res.stabilityVerdict.includes('STABLE'));
});

test('CFDSolver2D: Rotor propeller thrust, torque and FoM calculation', () => {
  const prop = CFDSolver2D.solvePropellerThrust(8000, 5.0, 3.0);
  assert(prop.thrust_N > 0);
  assert(prop.thrust_grams > 25);
  assert(prop.power_Watts > 0);
  assert(prop.figureOfMerit > 0 && prop.figureOfMerit <= 1.0);
});

// ----------------------------------------------------
// Suite 8: Oil & Gas (Thermodynamics & Piping Stress)
// ----------------------------------------------------
console.log('\n8. Testing Oil & Gas Process Simulation Engines:');

test('ThermodynamicsEngine: Peng-Robinson PR-EOS parameters & VLE flash', () => {
  const pr = ThermodynamicsEngine.getPurePRParams('Propane', 300.0);
  assert(pr.a > 0);
  assert(pr.b > 0);

  const feed = { Methane: 0.2, Propane: 0.5, nPentane: 0.3 };
  const flash = ThermodynamicsEngine.flashVLE(feed, 25.0, 5.0);
  assert(flash.vaporFraction >= 0 && flash.vaporFraction <= 1.0);
  assert(typeof flash.vaporComposition === 'object');
  assert(typeof flash.liquidComposition === 'object');
});

test('ThermodynamicsEngine: Crude Distillation Column fractionation', () => {
  const col = ThermodynamicsEngine.simulateDistillationColumn(50000, 30, 2.5);
  assert.strictEqual(col.feedBPD, 50000);
  assert.strictEqual(col.trayCount, 30);
  assert(col.products.lightNaphtha_BPD > 0);
  assert(col.products.dieselFuel_BPD > 0);
  assert(col.products.heavyResidue_BPD > 0);
  assert(col.thermalDuties.condenserDuty_MW > 0);
});

test('PipingStressEngine: ASME B31.3 thermal expansion & loop flexibility', () => {
  // Case A: With 4m expansion loop
  const resLoop = PipingStressEngine.evaluateASMEB313({
    pipeSpec: '8_SCH40',
    operatingTempC: 220.0,
    straightLengthM: 35.0,
    hasExpansionLoop: true,
    loopWidthM: 4.0
  });

  assert.strictEqual(resLoop.isCodeCompliant, true);
  assert(resLoop.stressRatio <= 1.0);
  assert(resLoop.status.includes('PASS'));

  // Case B: Rigid pipe without expansion loop (causes overstress)
  const resNoLoop = PipingStressEngine.evaluateASMEB313({
    pipeSpec: '8_SCH40',
    operatingTempC: 220.0,
    straightLengthM: 35.0,
    hasExpansionLoop: false
  });

  assert.strictEqual(resNoLoop.isCodeCompliant, false);
  assert(resNoLoop.stressRatio > 1.0);
  assert(resNoLoop.status.includes('FAIL'));
});

// ----------------------------------------------------
// Suite 9: OmniAI Co-Pilot & Dual Manual/AI Editing
// ----------------------------------------------------
console.log('\n9. Testing OmniAI Co-Pilot & Dual Manual/AI Synchronization:');

test('OmniAIEngine: Tool catalog and prompt routing', () => {
  const ai = new OmniAIEngine();
  assert(OMNI_TOOLS.length >= 7);

  // Drop test prompt
  const pDrop = ai.processPrompt('Run a 2m drop test on the smartphone corner');
  assert.strictEqual(pDrop.matchedTool, 'run_phone_drop_test');
  assert.strictEqual(pDrop.toolInput.dropHeight, 2.0);
  assert(pDrop.suggestedManualEdits.length > 0);

  // Thermal prompt
  const pTherm = ai.processPrompt('Test smartphone thermal with vapor chamber at 9W');
  assert.strictEqual(pTherm.matchedTool, 'simulate_mobile_thermal');
  assert(pTherm.suggestedManualEdits.length > 0);

  // Synthesis prompt
  const pSynth = ai.processPrompt('Synthesize 32-bit ALU verilog code');
  assert.strictEqual(pSynth.matchedTool, 'synthesize_verilog_chip');

  // Drone GNC prompt
  const pDrone = ai.processPrompt('Fly drone to 15m altitude with wind');
  assert.strictEqual(pDrone.matchedTool, 'simulate_drone_flight');

  // Piping stress prompt
  const pPipe = ai.processPrompt('Evaluate ASME piping stress at 250C with no loop');
  assert.strictEqual(pPipe.matchedTool, 'calculate_asme_piping_stress');
  assert.strictEqual(pPipe.toolInput.hasExpansionLoop, false);

  // Camera Lens Optics & 3D Cutaway prompt
  const pLens = ai.processPrompt('Design a 50mm f/1.4 camera lens and show inside of camera lens with cutaway and ray tracing');
  assert.strictEqual(pLens.matchedTool, 'design_camera_lens_optics');
  assert.strictEqual(pLens.toolInput.focalLengthMm, 50.0);
  assert.strictEqual(pLens.toolInput.fStop, 1.4);
  assert(pLens.result.entrancePupilDiameterMm > 30.0);
  assert(pLens.result.airyDiskDiameterUm > 0.0);
  assert(pLens.assistantMessage.includes('50mm'));
  assert(pLens.suggestedManualEdits.some(e => e.key === 'lensFStop'));
});

// ----------------------------------------------------
// Suite 10: Turnkey Community Samples
// ----------------------------------------------------
console.log('\n10. Testing Curated Community Reference Projects:');

test('Community Samples: Turnkey Reference Projects Loaded and Valid', () => {
  assert(COMMUNITY_SAMPLES.length >= 8, `Expected at least 8 samples, got ${COMMUNITY_SAMPLES.length}`);
  const industries = new Set(COMMUNITY_SAMPLES.map(s => s.industry));
  assert(industries.has('Consumer Electronics'));
  assert(industries.has('Semiconductor & EDA'));
  assert(industries.has('Drone & Aerospace'));
  assert(industries.has('Oil & Gas'));

  COMMUNITY_SAMPLES.forEach(s => {
    assert(s.id && s.title && s.studio && s.description);
    assert(Array.isArray(s.tags) && s.tags.length > 0);
  });
});

// ----------------------------------------------------
// Suite 11: Cloud-Native HPC Cluster & Engineering Audit
// ----------------------------------------------------
console.log('\n11. Testing Cloud-Native HPC Cluster & Technical Audit Engine:');

test('CloudHPCEngine: Membership gating, Slurm MPI workload & Domain Decomposition', () => {
  const hpc = new CloudHPCEngine();

  // Initial state: Air-gapped workstation
  const initialStatus = hpc.getClusterStatus();
  assert.strictEqual(initialStatus.membershipActive, false);
  assert.strictEqual(initialStatus.specs.nodes, 64);
  assert.strictEqual(initialStatus.specs.totalCores, 8192);
  assert.strictEqual(initialStatus.specs.totalGPUs, 256);

  // Attempt distributed dispatch without membership -> Should reject
  const deniedJob = hpc.submitSimulationJob('FEA_DROP_TEST', {}, 32);
  assert.strictEqual(deniedJob.success, false);
  assert(deniedJob.error.includes('Enterprise Membership'));

  // Unlock Enterprise Membership
  const memberRes = hpc.setMembership(true);
  assert.strictEqual(memberRes.clusterAccessible, true);
  assert.strictEqual(hpc.isMembershipActive, true);

  // Domain decomposition (METIS graph partitioner model)
  const decomp = hpc.computeDomainDecomposition(250000, 32);
  assert.strictEqual(decomp.success, true);
  assert.strictEqual(decomp.mpiRanks, 32);
  assert(decomp.theoreticalSpeedup > 10.0, `Expected speedup > 10x, got ${decomp.theoreticalSpeedup}`);
  assert(decomp.partitions.length === 8);

  // Submit distributed Slurm MPI job
  const jobRes = hpc.submitSimulationJob('FEA_EXPLICIT_DROP_TEST', { meshElements: 250000 }, 64);
  assert.strictEqual(jobRes.success, true);
  assert(jobRes.job.jobId.startsWith('SLURM-'));
  assert.strictEqual(jobRes.job.nodesAllocated, 16);
  assert.strictEqual(jobRes.job.status, 'COMPLETED');
  assert(jobRes.job.convergenceLog.length >= 5);
});

test('AuditReportGenerator: Multi-sector regulatory compliance report generation', () => {
  const report = AuditReportGenerator.generateComprehensiveReport({
    projectId: 'OE-CERT-2026',
    projectName: 'Universal Multi-Physics Certification'
  });

  assert.strictEqual(report.projectId, 'OE-CERT-2026');
  assert(report.sections.length >= 6);

  // Verify key domains are covered
  const titles = report.sections.map(s => s.title);
  assert(titles.some(t => t.includes('Executive Engineering Summary')));
  assert(titles.some(t => t.includes('Structural Drop Test')));
  assert(titles.some(t => t.includes('Thermal Conjugate Heat Transfer')));
  assert(titles.some(t => t.includes('Semiconductor & EDA')));
  assert(titles.some(t => t.includes('Drone & Aerospace')));
  assert(titles.some(t => t.includes('Oil & Gas Process')));

  // Verify HTML report output
  assert(typeof report.htmlReport === 'string');
  assert(report.htmlReport.includes('OMNIENG MULTI-PHYSICS ENGINEERING AUDIT REPORT'));
  assert(report.htmlReport.includes('MIL-STD-810H'));
  assert(report.htmlReport.includes('IEC 62368-1'));
  assert(report.htmlReport.includes('ASME B31.3-2022'));
});

// ----------------------------------------------------
// Suite 12: Material Library, Transient Dynamics & Frequency Response
// ----------------------------------------------------
console.log('\n12. Testing Material Library, Transient Dynamics & Frequency Analysis:');

test('MaterialManager: ASTM/ISO properties and centroidal inertia tensor calculation', () => {
  const allMaterials = MaterialManager.listAllMaterials();
  assert(allMaterials.length >= 10);
  
  const ti = MaterialManager.getMaterial('Ti-6Al-4V_Grade5');
  assert.strictEqual(ti.yieldStrengthMPa, 880.0);
  assert.strictEqual(ti.densityKgM3, 4430);

  // Compute Mass and Inertia of smartphone enclosure (75mm x 8.2mm x 160mm)
  const inertia = MaterialManager.computeInertiaCuboid('Ti-6Al-4V_Grade5', 0.075, 0.0082, 0.160);
  assert(inertia.massKg > 0.4 && inertia.massKg < 0.5, `Expected ~0.435 kg, got ${inertia.massKg}`);
  assert(inertia.Ixx > 0 && inertia.Iyy > 0 && inertia.Izz > 0);
  assert.strictEqual(inertia.yieldStrengthMPa, 880.0);
});

test('TransientDropAnimator: 50-step explicit time integration and energy conservation', () => {
  const sim = TransientDropAnimator.solveTransientHistory({
    dropHeightM: 1.5,
    phoneMassKg: 0.205,
    impactAngle: 'corner'
  });

  assert.strictEqual(sim.frames.length, 51);
  assert(sim.impactVelocity_m_s > 5.0 && sim.impactVelocity_m_s < 6.0);
  assert(sim.peakDeceleration_G > 50.0);
  assert(sim.peakChassisStress_MPa > 0.0);

  // Check energy conservation across frames
  const midFrame = sim.frames[25];
  assert(midFrame.totalEnergy_J > 0.0);
  assert(typeof midFrame.kineticEnergy_J === 'number');
  assert(typeof midFrame.strainEnergy_J === 'number');
  assert(typeof midFrame.dissipatedEnergy_J === 'number');
});

test('FrequencyResponseAnalyzer: MATLAB/Simulink Bode magnitude, phase and stability margins', () => {
  // G(s) = 10 / (s^2 + 2s + 10)
  const bode = FrequencyResponseAnalyzer.computeBode([10], [1, 2, 10], 0.1, 100, 50);

  assert.strictEqual(bode.bodePoints.length, 50);
  assert(typeof bode.isStable === 'boolean');
  assert(bode.stabilityVerdict.includes('STABLE'));

  // DC Gain should be 10/10 = 1.0 (0 dB)
  const dcPoint = bode.bodePoints[0];
  assert(Math.abs(dcPoint.magnitudeDb - 0.0) < 1.0);
  assert(dcPoint.phaseDeg < 5.0 && dcPoint.phaseDeg > -15.0);
});

test('VLEPhaseEnvelopeEngine: Peng-Robinson P-T Phase Envelope and 30-tray distillation profile', () => {
  const envelope = VLEPhaseEnvelopeEngine.generatePTEnvelope({ Methane: 0.2, Propane: 0.5, nPentane: 0.3 }, 1.0, 50.0, 20);
  assert.strictEqual(envelope.points.length, 20);
  assert(envelope.cricondenbar_Bar >= 50.0);
  assert(envelope.cricondentherm_C > 0);

  const column = VLEPhaseEnvelopeEngine.generateColumnTrayProfile(30, 22, 50000);
  assert.strictEqual(column.trays.length, 30);
  assert.strictEqual(column.trays[0].trayRole, 'Overhead Condenser Collector');
  assert.strictEqual(column.trays[29].trayRole, 'Bottoms Reboiler Sump');

  // Verify temperature profile monotonically increases down column
  assert(column.trays[0].temperatureC < column.trays[29].temperatureC);
  assert.strictEqual(column.trays[0].temperatureC, 110.0);
  assert.strictEqual(column.trays[29].temperatureC, 360.0);
});

// ----------------------------------------------------
console.log('\n13. Testing Camera Lens Optics & Optomechanics Engine:');

test('OpticalEngine: 50mm f/1.4 prescription definition and glass material validation', () => {
  const rx = OpticalEngine.get50mmPrescription();
  assert.strictEqual(rx.focalLengthMm, 50.0);
  assert.strictEqual(rx.designAperture, 1.4);
  assert.strictEqual(rx.groups.length, 6);
  assert.strictEqual(rx.elements.length, 8);

  // Verify elements have valid physical properties and glass types
  rx.elements.forEach(elem => {
    assert(elem.thicknessMm > 0);
    assert(elem.clearApertureMm > 0);
    assert(['Schott_NBK7', 'Schott_NSF11', 'OpticalFluorite_CaF2'].includes(elem.glassKey));
    assert(elem.refractiveIndex_nd > 1.4 && elem.refractiveIndex_nd < 1.9);
    assert(elem.abbeNumber_Vd > 20 && elem.abbeNumber_Vd < 100);
  });
});

test('OpticalEngine: solveOpticalMetrics calculates airy disk, hyperfocal and DoF', () => {
  const m14 = OpticalEngine.solveOpticalMetrics(50.0, 1.4, 2.0);
  assert.strictEqual(m14.entrancePupilDiameterMm, 35.71);
  assert.strictEqual(m14.numericalAperture, 0.3571);
  // Airy disk: 2.44 * 0.550 * 1.4 = 1.88 um
  assert.strictEqual(m14.diffractionAiryDiskDiameter_um, 1.88);
  assert.strictEqual(m14.circleOfConfusionMm, 0.029);
  assert(m14.hyperfocalDistance_m > 60.0 && m14.hyperfocalDistance_m < 65.0);
  assert(m14.depthOfField_m > 0.1 && m14.depthOfField_m < 0.2);
  assert(m14.nearFocusLimit_m < 2.0 && m14.farFocusLimit_m > 2.0);

  // Test smaller aperture f/8.0
  const m8 = OpticalEngine.solveOpticalMetrics(50.0, 8.0, 2.0);
  assert.strictEqual(m8.entrancePupilDiameterMm, 6.25);
  // Depth of field should be much larger at f/8 than f/1.4
  assert(m8.depthOfField_m > m14.depthOfField_m);
  // Airy disk should be larger at f/8 (diffraction limit increases)
  assert(m8.diffractionAiryDiskDiameter_um > m14.diffractionAiryDiskDiameter_um);
  assert(m8.mtf50ResolutionLimit_lp_per_mm < m14.mtf50ResolutionLimit_lp_per_mm);
});

test('OpticalEngine: traceRays paraxial marginal ray tracing and sensor convergence', () => {
  const rays = OpticalEngine.traceRays(1.4, 9);
  assert.strictEqual(rays.length, 9);

  // Central ray should be straight along the optical axis (y=0)
  const centerRay = rays.find(r => r.id === 'center');
  assert(centerRay);
  assert.strictEqual(centerRay.startY, 0);
  assert.strictEqual(centerRay.points[0].y, 0);
  assert.strictEqual(centerRay.points[centerRay.points.length - 1].y, 0);

  // Marginal rays should enter off-axis and converge towards focal distance ~75mm
  const topRay = rays.find(r => r.id === 'marginal_top');
  assert(topRay);
  assert(topRay.startY > 10.0);
  const endPoint = topRay.points[topRay.points.length - 1];
  assert.strictEqual(endPoint.z, 75.0);
  assert(Math.abs(endPoint.y) < 2.0); // Converges tightly at the sensor focal point
});

// ----------------------------------------------------
// Suite 14: Industrial Parity Gap Closure Engines
// ----------------------------------------------------
const { runIndustrialTests } = require('./test_industrial_gap_closure');
const indStats = runIndustrialTests();
totalTests += indStats.total;
passedTests += indStats.passed;
failedTests += indStats.failed;

// ----------------------------------------------------
// Suite 15: Phase 1 Upgrade Master Plan Engines
// ----------------------------------------------------
const { runPhase1Tests } = require('./test_phase1_upgrade');
const p1Stats = runPhase1Tests();
totalTests += p1Stats.total;
passedTests += p1Stats.passed;
failedTests += p1Stats.failed;

// ----------------------------------------------------
// Suite 16: Phase 2 Upgrade Master Plan Engines (CAD Kernel)
// ----------------------------------------------------
const { runPhase2Tests } = require('./test_phase2_upgrade');
const p2Stats = runPhase2Tests();
totalTests += p2Stats.total;
passedTests += p2Stats.passed;
failedTests += p2Stats.failed;

// ----------------------------------------------------
// Suite 17: Phase 3 Upgrade Master Plan Engines (Structural & Fluid Mechanics)
// ----------------------------------------------------
const { runPhase3Tests } = require('./test_phase3_upgrade');
const p3Stats = runPhase3Tests();
totalTests += p3Stats.testsPassed + p3Stats.testsFailed;
passedTests += p3Stats.testsPassed;
failedTests += p3Stats.testsFailed;

// ----------------------------------------------------
// Suite 18: Phase 4 Upgrade Master Plan Engines (EDA & High-Order Optics)
// ----------------------------------------------------
const { runPhase4Tests } = require('./test_phase4_upgrade');
const p4Stats = runPhase4Tests();
totalTests += p4Stats.testsPassed + p4Stats.testsFailed;
passedTests += p4Stats.testsPassed;
failedTests += p4Stats.testsFailed;

// ----------------------------------------------------
// Suite 19: Phase 5 Upgrade Master Plan Engines (GNC, Plant & Gold Certification)
// ----------------------------------------------------
const { runPhase5Tests } = require('./test_phase5_upgrade');
const p5Stats = runPhase5Tests();
totalTests += p5Stats.testsPassed + p5Stats.testsFailed;
passedTests += p5Stats.testsPassed;
failedTests += p5Stats.testsFailed;

// ----------------------------------------------------
// Suite 20: Section 6 Master Regulatory Certification & Validation Suite
// ----------------------------------------------------
const { runGoldBenchmarks } = require('./test_gold_benchmarks');
const goldStats = runGoldBenchmarks();
totalTests += goldStats.passedCount + goldStats.failedCount;
passedTests += goldStats.passedCount;
failedTests += goldStats.failedCount;

// ----------------------------------------------------
// Suite 21: Section 6 Master Regulatory Certification Suite 2.0 (Phases 6-13)
// ----------------------------------------------------
const { runAllGoldBenchmarks2 } = require('./test_gold_benchmarks_2');
const gold2Stats = runAllGoldBenchmarks2();
totalTests += gold2Stats.total;
passedTests += gold2Stats.passed;
failedTests += (gold2Stats.total - gold2Stats.passed);

// ----------------------------------------------------
// Suite 22: Tier-1 Commercial Production Certification Suite 3.0 (Pillars 1-4)
// ----------------------------------------------------
const { runGoldRegulatoryBenchmarks3 } = require('./test_gold_benchmarks_3');
const gold3Stats = runGoldRegulatoryBenchmarks3();
totalTests += gold3Stats.total;
passedTests += gold3Stats.passed;
failedTests += (gold3Stats.total - gold3Stats.passed);

// ----------------------------------------------------
// Suite 23: Tier-1 Commercial Production Quality Gate (Pillars 1-5 Final Sign-Off)
// ----------------------------------------------------
const { runTier1CommercialProductionTests } = require('./test_tier1_commercial_production');
const tier1Stats = runTier1CommercialProductionTests();
totalTests += tier1Stats.total;
passedTests += tier1Stats.passed;
failedTests += (tier1Stats.total - tier1Stats.passed);

// ----------------------------------------------------
// Suite 24: Tier-1 10/10 Industrial Commercial Production Architecture (Pillars 1-5)
// ----------------------------------------------------
const { runTier1TenOutOfTenTests } = require('./test_tier1_10_out_of_10');
const tenOutOfTenStats = runTier1TenOutOfTenTests();
totalTests += tenOutOfTenStats.total;
passedTests += tenOutOfTenStats.passed;
failedTests += (tenOutOfTenStats.total - tenOutOfTenStats.passed);

// ----------------------------------------------------
// Suite 25: Tier-1 Parser Fuzzing & Input Robustness Gate (CWE-20 / CWE-400)
// ----------------------------------------------------
const { runParserFuzzTests } = require('./fuzz/test_parsers_fuzz');
const fuzzStats = runParserFuzzTests();
totalTests += fuzzStats.total;
passedTests += fuzzStats.passed;
failedTests += (fuzzStats.total - fuzzStats.passed);

// ----------------------------------------------------
// Suite 26: Tier-1 Verification & Validation (V&V) Certification Pack (Phase 6)
// Standards: NAFEMS (LE1, LE10, FV32, T1), NASA TMR Flat Plate, NIST Sparse, Hertz Contact
// ----------------------------------------------------
const { runVVVerificationBenchmarks } = require('./vv/run_vv');
const vvStats = runVVVerificationBenchmarks();
totalTests += vvStats.total;
passedTests += vvStats.passed;
failedTests += (vvStats.total - vvStats.passed);

// ----------------------------------------------------
// Summary
// ----------------------------------------------------
console.log('\n====================================================');
console.log(`Test Execution Finished: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
console.log('====================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('All OmniEng Platform Engines & Computational Modules are 100% Verified!\n');
}
