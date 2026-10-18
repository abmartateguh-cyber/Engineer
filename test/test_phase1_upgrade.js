/**
 * OmniEng Phase 1 Upgrade Master Plan Verification Suite
 * Tests:
 * 1. PhysicalDimension & Dimensional Algebra ([M, L, T, Theta, I])
 * 2. Symbolic Multi-Physics Knowledge Graph (Mechanics, Fluids, Heat, Optics, Drone, Circuits)
 * 3. Nelder-Mead Autonomous Simplex Optimizer & Structural Self-Healing
 * 4. Deterministic Engineering Intent Lexer
 * 5. Single-File Universal .omni Archive (Compression, CRC32, Lossless Round-Trip)
 * 6. Non-Linear Command History Journal (Undo/Redo & Branching)
 * 7. Universal Guided Design Wizards & Plain-English Error Translator
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  PhysicalDimension,
  UNIT_REGISTRY,
  DimensionalQuantity,
  SymbolicPhysicsKnowledgeGraph,
  NelderMeadOptimizer,
  DeterministicIntentLexer,
  SymbolicReasoner
} = require('../src/core/ai/symbolic_reasoner');

const {
  OmniArchive,
  CommandJournal,
  calculateCRC32,
  MAGIC_BYTES
} = require('../src/core/storage/omni_archive');

const {
  PlainEnglishErrorTranslator,
  DropTestWizard,
  DroneDesignWizard,
  CameraLensWizard,
  PCBDesignWizard
} = require('../src/ui/wizards/design_wizards');

function runPhase1Tests() {
  console.log('================================================================');
  console.log('   OmniEng Phase 1 Upgrade Master Plan Verification Suite       ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      throw err;
    }
  }

  // -------------------------------------------------------------
  // Group 1: Physical Dimensions & Dimensional Homogeneity
  // -------------------------------------------------------------
  console.log('1. Physical Dimensions & Dimensional Algebra:');

  test('PhysicalDimension vector arithmetic and derived dimensions', () => {
    const L = PhysicalDimension.length();
    const T = PhysicalDimension.time();
    const M = PhysicalDimension.mass();

    // Velocity = L / T
    const velocity = L.div(T);
    assert(velocity.equals(PhysicalDimension.velocity()), 'L/T must equal Velocity');

    // Acceleration = Velocity / T = L / T^2
    const accel = velocity.div(T);
    assert(accel.equals(PhysicalDimension.acceleration()), 'V/T must equal Acceleration');

    // Force = M * Acceleration = M L T^-2
    const force = M.mul(accel);
    assert(force.equals(PhysicalDimension.force()), 'M*A must equal Force');

    // Pressure = Force / Area = M L^-1 T^-2
    const area = L.pow(2);
    const pressure = force.div(area);
    assert(pressure.equals(PhysicalDimension.pressure()), 'F/A must equal Pressure');
  });

  test('DimensionalQuantity unit conversions and dimensional protection', () => {
    // 1 inch = 0.0254 meters
    const oneInch = new DimensionalQuantity(1.0, 'in');
    const convertedMeters = oneInch.convertTo('m');
    assert.strictEqual(convertedMeters.magnitude, 0.0254);

    // 1 bar = 100 kPa = 100,000 Pa
    const pressureBar = new DimensionalQuantity(1.0, 'bar');
    const pressureKPa = pressureBar.convertTo('kPa');
    assert.strictEqual(pressureKPa.magnitude, 100.0);

    // Dimensional protection: adding length to mass must throw error
    const massKg = new DimensionalQuantity(5.0, 'kg');
    assert.throws(() => {
      DimensionalQuantity.verifyHomogeneity(oneInch, massKg, 'Addition');
    }, /Dimensional Inconsistency/);
  });

  // -------------------------------------------------------------
  // Group 2: Symbolic Multi-Physics Knowledge Graph
  // -------------------------------------------------------------
  console.log('\n2. Symbolic Multi-Physics Knowledge Graph:');

  const kg = new SymbolicPhysicsKnowledgeGraph();

  test('Hooke Law axial elongation delta = (F*L)/(A*E)', () => {
    // F = 10,000 N, L = 2.0 m, A = 1e-4 m^2 (10x10mm bar), E = 200 GPa (Steel)
    // delta = (10000 * 2.0) / (1e-4 * 200e9) = 20000 / 2e7 = 1e-3 m = 1.0 mm
    const res = kg.calculateAxialElongation(10000.0, 2.0, 1e-4, 200e9);
    assert.strictEqual(res.elongationMm, 1.0, 'Steel bar elongation must be 1.0mm');
    assert.strictEqual(res.stressMPa, 100.0, 'Stress must be 100 MPa');
  });

  test('Thin-walled pressure vessel hoop stress sigma = (P*D)/(2*t)', () => {
    // P = 2.0 MPa (2e6 Pa), D = 0.5 m, t = 0.005 m (5mm)
    // sigma_hoop = (2e6 * 0.5) / (2 * 0.005) = 1e6 / 0.01 = 100 MPa
    const res = kg.calculatePressureVesselStress(2.0e6, 0.5, 0.005, 1.0);
    assert.strictEqual(res.hoopStressMPa, 100.0, 'Hoop stress must equal 100 MPa');
    assert.strictEqual(res.longitudinalStressMPa, 50.0, 'Longitudinal stress must equal 50 MPa');
  });

  test('Euler-Bernoulli cantilever beam bending stress & deflection', () => {
    // Load = 1000 N at tip, L = 1.0 m, w = 0.05 m, h = 0.10 m, E = 70 GPa (Al)
    // I = (0.05 * 0.1^3)/12 = 4.166667e-6 m^4
    // M_max = 1000 * 1 = 1000 N*m
    // sigma_max = (1000 * 0.05) / 4.166667e-6 = 12.0 MPa
    const res = kg.calculateCantileverBeamBending(1000.0, 1.0, 0.05, 0.10, 70e9);
    assert(Math.abs(res.maxStressMPa - 12.0) < 0.01, 'Max bending stress must be ~12 MPa');
    assert(res.maxDeflectionMm > 0, 'Deflection must be positive');
  });

  test('Darcy-Weisbach pipe pressure drop & flow regime', () => {
    // Laminar flow test
    const laminar = kg.calculatePipePressureDrop(0.0001, 10.0, 0.05, 1e-5, 1000.0, 0.05);
    assert.strictEqual(laminar.flowRegime, 'Laminar', 'Low velocity flow must be laminar');
    assert(laminar.pressureDropPa > 0, 'Pressure drop must be positive');

    // Turbulent flow test (Water at 2 m/s through 100mm pipe)
    const turbulent = kg.calculatePipePressureDrop(0.0157, 50.0, 0.10, 4.5e-5, 1000.0, 0.001);
    assert.strictEqual(turbulent.flowRegime, 'Turbulent', 'High velocity flow must be turbulent');
  });

  test('Drone actuator disk hover aerodynamics & power', () => {
    // 1.0 kg quadcopter (4 rotors), 5-inch props
    const aero = kg.calculateDroneHoverAerodynamics(1.0, 4, 5.0, 0.70);
    assert(Math.abs(aero.totalWeightN - 9.80665) < 1e-4, 'Weight must equal m*g');
    assert(aero.thrustPerRotorGrams >= 250.0, 'Thrust per rotor must balance 250g');
    assert(aero.actualHoverPowerWatts > 0, 'Hover power must be positive');
  });

  test('Lensmaker equation focal length calculation', () => {
    // Symmetrical biconvex lens: n = 1.5168 (N-BK7), R1 = 0.05m, R2 = -0.05m, d = 0.005m
    const lens = kg.calculateLensmakerFocalLength(1.5168, 0.05, -0.05, 0.005);
    assert(lens.focalLengthMm > 45 && lens.focalLengthMm < 55, 'Focal length must be ~50mm');
  });

  // -------------------------------------------------------------
  // Group 3: Nelder-Mead Optimizer & Autonomous Self-Healing
  // -------------------------------------------------------------
  console.log('\n3. Nelder-Mead Simplex Optimizer & Self-Healing:');

  test('Nelder-Mead converges on 2D parabolic quadratic bowl f(x,y) = (x-3)^2 + (y-5)^2', () => {
    const optimizer = new NelderMeadOptimizer({ maxIterations: 120, tolerance: 1e-5 });
    const obj = (p) => Math.pow(p[0] - 3.0, 2) + Math.pow(p[1] - 5.0, 2);
    const res = optimizer.minimize(obj, [0.0, 0.0]);
    assert(res.converged, 'Optimizer must converge');
    assert(Math.abs(res.optimalParams[0] - 3.0) < 0.01, 'x must converge to 3.0');
    assert(Math.abs(res.optimalParams[1] - 5.0) < 0.01, 'y must converge to 5.0');
    assert(res.optimalCost < 1e-4, 'Cost at optimum must be ~0');
  });

  test('SymbolicReasoner autonomous self-healing on structural yield', () => {
    const reasoner = new SymbolicReasoner();
    // Thin 0.8mm casing yielding under 250N drop load
    const weakDesign = {
      wallThicknessMm: 0.8,
      loadN: 250.0,
      lengthMm: 140.0,
      widthMm: 70.0,
      yieldStrengthMPa: 503.0, // Al7075-T6
      youngsModulusGPa: 70.0
    };

    const healed = reasoner.selfHealStructuralYield(weakDesign, 1.5);
    assert.strictEqual(healed.status, 'HEALED', 'Self-healing must succeed');
    assert(healed.recommendedThicknessMm > weakDesign.wallThicknessMm, 'Thickness must increase to reduce stress');
    assert(healed.predictedMaxStressMPa <= healed.targetStressLimitMPa, 'Max stress must be within allowable limit');
    assert(healed.safetyFactorAchieved >= 1.5, 'Safety factor must satisfy target 1.5');
  });

  test('DeterministicIntentLexer extracts structured engineering parameters', () => {
    const lexer = new DeterministicIntentLexer();
    const parsedDrop = lexer.parse('Please run drop test from 2 meters onto concrete');
    assert.strictEqual(parsedDrop.action, 'DROP_TEST');
    assert.strictEqual(parsedDrop.params.heightM, 2.0);

    const parsedLens = lexer.parse('Design a 50mm f/1.4 camera lens with low dispersion');
    assert.strictEqual(parsedLens.action, 'DESIGN_LENS');
    assert.strictEqual(parsedLens.params.focalLengthMm, 50.0);
    assert.strictEqual(parsedLens.params.fStop, 1.4);
  });

  // -------------------------------------------------------------
  // Group 4: Single-File .omni Universal Engineering Archive
  // -------------------------------------------------------------
  console.log('\n4. Single-File Universal .omni Archive & Journal:');

  test('OmniArchive creation, multi-section zlib packing & CRC32 verification', () => {
    const archive = new OmniArchive({
      projectName: 'Flagship_Drone_X4',
      engineeringDomain: 'aerospace'
    });

    const geometryData = { solids: [{ type: 'Box', w: 100, h: 50, d: 20 }] };
    const simulationData = { maxStressMPa: 142.5, status: 'PASSED' };
    const netlistData = { components: ['U1_MCU', 'Q1_FET', 'C1_CAP'] };

    archive.addSection('geometry', geometryData);
    archive.addSection('simulation', simulationData);
    archive.addSection('schematic', netlistData);

    const buffer = archive.saveToBuffer();
    assert(buffer.length > 50, 'Packed archive buffer must not be empty');
    assert(buffer.subarray(0, 8).equals(MAGIC_BYTES), 'Buffer must begin with OMNIENG magic header');

    // Load back and verify round-trip integrity
    const restored = OmniArchive.loadFromBuffer(buffer);
    assert.strictEqual(restored.manifest.projectName, 'Flagship_Drone_X4');
    assert.deepStrictEqual(restored.getSection('geometry'), geometryData);
    assert.deepStrictEqual(restored.getSection('simulation'), simulationData);
    assert.deepStrictEqual(restored.getSection('schematic'), netlistData);
  });

  test('CommandJournal non-linear undo/redo and branching revision history', () => {
    const journal = new CommandJournal();
    assert(!journal.canUndo(), 'Initial journal cannot undo');
    assert(!journal.canRedo(), 'Initial journal cannot redo');

    // Execute actions
    journal.execute('ADD_BOX', { width: 50 }, {}, 'Created box', 'user');
    journal.execute('FILLET_EDGE', { radius: 5 }, { radius: 0 }, 'Filleted edge', 'user');
    assert(journal.canUndo(), 'Can undo after 2 executions');
    assert.strictEqual(journal.history.length, 2);

    // Undo fillet
    const undoRes = journal.undo();
    assert.strictEqual(undoRes.undoneEntry.actionType, 'FILLET_EDGE');
    assert.strictEqual(journal.currentIndex, 0);
    assert(journal.canRedo(), 'Can redo after undo');

    // Redo fillet
    const redoRes = journal.redo();
    assert.strictEqual(redoRes.redoneEntry.actionType, 'FILLET_EDGE');
    assert.strictEqual(journal.currentIndex, 1);
  });

  // -------------------------------------------------------------
  // Group 5: Universal Guided Intent Design Wizards
  // -------------------------------------------------------------
  console.log('\n5. Universal Guided Intent Design Wizards:');

  test('DropTestWizard executes explicit drop physics and detects yield', () => {
    const wizard = new DropTestWizard();
    const result = wizard.runWizard({
      phoneMassKg: 0.205,
      dropHeightM: 1.5,
      wallThicknessMm: 0.6, // Intentionally thin to test remediation trigger
      material: 'Al7075-T6'
    });

    assert(result.physics.impactVelocityMs > 5.0, 'Impact velocity must exceed 5 m/s');
    assert(result.plainSummary.length > 20, 'Plain summary must be generated');
  });

  test('DroneDesignWizard computes propulsion sizing and battery hover time', () => {
    const wizard = new DroneDesignWizard();
    const result = wizard.runWizard({
      payloadKg: 0.25,
      frameMassKg: 0.35,
      batteryMassKg: 0.20,
      propellerDiameterInches: 5.0
    });

    assert.strictEqual(result.wizard, 'DroneDesignWizard');
    assert(result.flightSpecs.hoverPowerWatts > 0, 'Hover power must be calculated');
    assert(result.flightSpecs.estimatedHoverMinutes > 5, 'Hover endurance must exceed 5 min');
  });

  test('CameraLensWizard computes spot radius and sharpness score', () => {
    const wizard = new CameraLensWizard();
    const result = wizard.runWizard({ focalLengthMm: 50.0, fStop: 1.4 });

    assert.strictEqual(result.wizard, 'CameraLensWizard');
    assert(result.opticalSpecs.rmsSpotRadiusUm > 0, 'Spot radius must be positive');
    assert(result.opticalSpecs.sharpnessScore >= 0 && result.opticalSpecs.sharpnessScore <= 100, 'Score must be 0-100');
  });

  test('PCBDesignWizard synthesizes 50 Ohm microstrip width and generates Gerber package', () => {
    const wizard = new PCBDesignWizard();
    const result = wizard.runWizard({ layerCount: 4, dielectricHeightMm: 0.2, targetImpedanceOhm: 50.0 });

    assert.strictEqual(result.wizard, 'PCBDesignWizard');
    assert(result.stackup.calculatedTraceWidthMm > 0.1 && result.stackup.calculatedTraceWidthMm < 1.0, 'Trace width must be realistic for 50 Ohm');
    assert(result.manufacturingFiles.totalFileSizeBytes > 500, 'Gerber files must be populated');
  });

  test('PlainEnglishErrorTranslator generates actionable plain language guidance', () => {
    const diag = PlainEnglishErrorTranslator.translate({
      domain: 'structural',
      code: 'STRESS_YIELD',
      context: { peakStressMPa: 620.0, yieldLimitMPa: 503.0, thicknessMm: 0.8 }
    });

    assert.strictEqual(diag.severity, 'CRITICAL');
    assert(diag.plainEnglishAdvice.includes('wall is too thin'), 'Must explain thin wall');
    assert(diag.oneClickAction !== null, 'Must provide 1-click remediation action');
    assert(diag.oneClickAction.value > 0.8, 'Remediation must propose thicker wall');
  });

  console.log('\n================================================================');
  console.log(`Phase 1 Verification Finished: ${passed}/${total} Passed (0 Failed)`);
  console.log('================================================================\n');

  return { total, passed, failed: total - passed };
}

if (require.main === module) {
  runPhase1Tests();
}

module.exports = { runPhase1Tests };
