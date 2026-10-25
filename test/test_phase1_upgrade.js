/**
 * Experimental Phase 1 module smoke checks; no independent validation evidence.
 * Tests:
 * 1. PhysicalDimension & Dimensional Algebra ([M, L, T, Theta, I])
 * 2. Symbolic Multi-Physics Knowledge Graph (Mechanics, Fluids, Heat, Optics, Drone, Circuits)
 * 3. Nelder-Mead Simplex Optimizer & experimental cantilever thickness estimate
 * 4. Deterministic Engineering Intent Lexer
 * 5. Single-File Universal .omni Archive (Compression, CRC32, Lossless Round-Trip)
 * 6. Non-Linear Command History Journal (Undo/Redo & Branching)
 * 7. Universal Guided Design Wizards & Plain-English Error Translator
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
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
const { OmniAIEngine, OMNI_TOOLS } = require('../src/core/ai/omni_ai_engine');
const { OpticalEngine } = require('../src/core/optics/optical_engine');
const { getStructuralRemediationUnavailableResult } = require('../src/main/ipc/system_ipc');

const {
  OmniArchive,
  CommandJournal,
  calculateCRC32,
  MAGIC_BYTES,
  MAX_ARCHIVE_SIZE_BYTES
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
    const res = kg.calculateCantileverBeamBending(1000.0, 1.0, 0.05, 0.1, 70e9);
    assert(Math.abs(res.maxStressMPa - 12.0) < 0.01, 'Max bending stress must be ~12 MPa');
    assert(res.maxDeflectionMm > 0, 'Deflection must be positive');
  });

  test('Darcy-Weisbach pipe pressure drop & flow regime', () => {
    // Laminar flow test
    const laminar = kg.calculatePipePressureDrop(0.0001, 10.0, 0.05, 1e-5, 1000.0, 0.05);
    assert.strictEqual(laminar.flowRegime, 'Laminar', 'Low velocity flow must be laminar');
    assert(laminar.pressureDropPa > 0, 'Pressure drop must be positive');

    // Turbulent flow test (Water at 2 m/s through 100mm pipe)
    const turbulent = kg.calculatePipePressureDrop(0.0157, 50.0, 0.1, 4.5e-5, 1000.0, 0.001);
    assert.strictEqual(turbulent.flowRegime, 'Turbulent', 'High velocity flow must be turbulent');
  });

  test('Drone actuator disk hover aerodynamics & power', () => {
    // 1.0 kg quadcopter (4 rotors), 5-inch props
    const aero = kg.calculateDroneHoverAerodynamics(1.0, 4, 5.0, 0.7, 1.225, 9.80665);
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
  // Group 3: Nelder-Mead Optimizer & experimental cantilever estimate
  // -------------------------------------------------------------
  console.log('\n3. Nelder-Mead Simplex Optimizer & Experimental Thickness Estimate:');

  test('Nelder-Mead converges on 2D parabolic quadratic bowl f(x,y) = (x-3)^2 + (y-5)^2', () => {
    const optimizer = new NelderMeadOptimizer({ maxIterations: 120, tolerance: 1e-5 });
    const obj = (p) => Math.pow(p[0] - 3.0, 2) + Math.pow(p[1] - 5.0, 2);
    const res = optimizer.minimize(obj, [0.0, 0.0]);
    assert(res.converged, 'Optimizer must converge');
    assert(Math.abs(res.optimalParams[0] - 3.0) < 0.01, 'x must converge to 3.0');
    assert(Math.abs(res.optimalParams[1] - 5.0) < 0.01, 'y must converge to 5.0');
    assert(res.optimalCost < 1e-4, 'Cost at optimum must be ~0');
  });

  test('Structural thickness helper is an explicit formula estimate and product remediation fails closed', () => {
    const reasoner = new SymbolicReasoner();
    const weakDesign = {
      wallThicknessMm: 0.8,
      loadN: 250.0,
      lengthMm: 140.0,
      widthMm: 70.0,
      yieldStrengthMPa: 503.0,
      youngsModulusGPa: 70.0,
      minThicknessMm: 0.5,
      maxThicknessMm: 10.0
    };

    const estimate = reasoner.estimateCantileverThickness(weakDesign, 1.5);
    assert.strictEqual(estimate.status, 'ESTIMATE_ONLY');
    assert.strictEqual(estimate.validationLevel, 'experimental');
    assert(Number.isFinite(estimate.estimate.candidateThicknessMm));
    assert(Number.isFinite(estimate.estimate.predictedBendingStressMPa));
    assert.strictEqual(Object.hasOwn(estimate, 'safetyFactorAchieved'), false);
    assert.strictEqual(Object.hasOwn(estimate, 'actionPayload'), false);
    assert.throws(
      () => reasoner.estimateCantileverThickness({ ...weakDesign, youngsModulusGPa: undefined }, 1.5),
      /youngsModulusGPa/
    );

    const routeResult = getStructuralRemediationUnavailableResult();
    assert.strictEqual(routeResult.available, false);
    assert.strictEqual(routeResult.error.code, 'UNSUPPORTED');

    const macro = new OmniAIEngine();
    const plan = macro.processPrompt('Please self-heal this structural design by thickening the wall.');
    assert.strictEqual(plan.result.status, 'unavailable');
    assert.strictEqual(plan.toolInput, null);
    assert.deepStrictEqual(plan.suggestedManualEdits, []);
    assert.strictEqual(macro.parseUserIntent('self-heal structural yield').matchedTool, 'self_heal_design');
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

  test('OmniArchive rejects malformed section tables and incomplete project manifests', () => {
    const archive = new OmniArchive({ projectName: 'ArchiveBoundaryCheck' });
    archive.addSection('alpha', { value: 1 });
    archive.addSection('bravo', { value: 2 });
    const validBuffer = archive.saveToBuffer();

    const getSectionOffsets = (buffer, targetName) => {
      let offset = 12;
      const count = buffer.readUInt32BE(8);
      for (let index = 0; index < count; index++) {
        const nameLength = buffer.readUInt16BE(offset);
        const nameOffset = offset + 2;
        const name = buffer.subarray(nameOffset, nameOffset + nameLength).toString('utf8');
        const metadataOffset = nameOffset + nameLength;
        if (name === targetName) return { nameOffset, metadataOffset, nameLength };
        const compressedLength = buffer.readUInt32BE(metadataOffset + 4);
        offset = metadataOffset + 12 + compressedLength;
      }
      throw new Error(`Test archive section not found: ${targetName}`);
    };

    const excessiveCount = Buffer.from(validBuffer);
    excessiveCount.writeUInt32BE(0xffffffff, 8);
    assert.throws(() => OmniArchive.loadFromBuffer(excessiveCount), /section count/i);

    const truncated = validBuffer.subarray(0, validBuffer.length - 1);
    assert.throws(() => OmniArchive.loadFromBuffer(truncated), /EOF|CRC checksum/i);

    const duplicateName = Buffer.from(validBuffer);
    const bravo = getSectionOffsets(duplicateName, 'bravo');
    Buffer.from('alpha', 'utf8').copy(duplicateName, bravo.nameOffset);
    assert.throws(() => OmniArchive.loadFromBuffer(duplicateName), /duplicate section/i);

    const missingManifest = Buffer.from(validBuffer);
    const manifest = getSectionOffsets(missingManifest, 'manifest');
    Buffer.from('metadata', 'utf8').copy(missingManifest, manifest.nameOffset);
    assert.throws(() => OmniArchive.loadFromBuffer(missingManifest), /required project manifest/i);

    const oversizedSection = Buffer.from(validBuffer);
    const firstSection = getSectionOffsets(oversizedSection, 'manifest');
    oversizedSection.writeUInt32BE(0xffffffff, firstSection.metadataOffset);
    assert.throws(() => OmniArchive.loadFromBuffer(oversizedSection), /uncompressed size/i);

    const trailingBytes = Buffer.concat([validBuffer, Buffer.from([0])]);
    assert.throws(() => OmniArchive.loadFromBuffer(trailingBytes), /trailing bytes/i);
  });

  test('OmniArchive file loading enforces the serialized-size limit before reading', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'omnieng-archive-limit-'));
    const validPath = path.join(tempDirectory, 'valid.omni');
    const oversizedPath = path.join(tempDirectory, 'oversized.omni');

    try {
      const archive = new OmniArchive({ projectName: 'FileLoadBoundaryCheck' });
      archive.addSection('result', { value: 42 });
      archive.saveToFile(validPath);
      assert.strictEqual(OmniArchive.loadFromFile(validPath).getSection('result').value, 42);

      const descriptor = fs.openSync(oversizedPath, 'w');
      try {
        fs.ftruncateSync(descriptor, MAX_ARCHIVE_SIZE_BYTES + 1);
      } finally {
        fs.closeSync(descriptor);
      }
      assert.throws(() => OmniArchive.loadFromFile(oversizedPath), /maximum serialized size/i);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
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

  test('DropTestWizard returns an experimental impact estimate without material verdicts', () => {
    const wizard = new DropTestWizard();
    const result = wizard.runWizard({
      phoneMassKg: 0.205,
      dropHeightM: 1.5,
      impactAngle: 'corner'
    });

    assert(result.physics.impactVelocityEstimateMs > 5.0, 'Impact velocity estimate must exceed 5 m/s');
    assert(result.plainSummary.length > 20, 'Plain summary must be generated');
    assert.strictEqual(result.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.deepStrictEqual(result.inputs, { phoneMassKg: 0.205, dropHeightM: 1.5, impactAngle: 'corner' });
    assert(result.modelAssumptions.gravityMPerS2 > 9.8);
    assert.strictEqual(Object.hasOwn(result.physics, 'safetyFactor'), false);
    assert.strictEqual(Object.hasOwn(result, 'remediation'), false);
    assert.throws(() => wizard.runWizard(), /phoneMassKg.*dropHeightM.*impactAngle/i);
  });

  test('DroneDesignWizard estimates hover power only from explicit inputs', () => {
    const wizard = new DroneDesignWizard();
    assert.throws(() => wizard.runWizard(), /explicit valid inputs/);
    const result = wizard.runWizard({
      payloadKg: 0.25,
      frameMassKg: 0.35,
      batteryMassKg: 0.2,
      propellerDiameterInches: 5.0,
      rotorCount: 4,
      figureOfMerit: 0.72,
      airDensityKgM3: 1.225,
      gravityMPerS2: 9.80665
    });

    assert.strictEqual(result.wizard, 'DroneDesignWizard');
    assert.strictEqual(result.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert(result.flightSpecs.hoverPowerWatts > 0, 'Hover power estimate must be positive');
    assert.strictEqual(result.inputs.allUpMassKg, 0.8);
    assert.match(result.plainSummary, /Endurance and thrust margin were not calculated/);
    assert.strictEqual(Object.hasOwn(result.flightSpecs, 'estimatedHoverMinutes'), false);
    assert.strictEqual(Object.hasOwn(result.flightSpecs, 'recommendedMotorKV'), false);
  });

  test('CameraLensWizard returns scalar estimates from explicit inputs only', () => {
    const wizard = new CameraLensWizard();
    assert.throws(
      () => wizard.runWizard(),
      /requires positive focalLengthMm, fStop, subjectDistM, wavelengthNm, and circleOfConfusionMm/
    );
    const result = wizard.runWizard({
      focalLengthMm: 50.0,
      fStop: 1.4,
      subjectDistM: 2.0,
      wavelengthNm: 550,
      circleOfConfusionMm: 0.029
    });

    assert.strictEqual(result.wizard, 'CameraLensWizard');
    assert.strictEqual(result.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(result.opticalSpecs.subjectDistM, 2.0);
    assert.strictEqual(result.opticalSpecs.wavelengthNm, 550);
    assert.strictEqual(result.opticalSpecs.circleOfConfusionMm, 0.029);
    assert.strictEqual(Object.hasOwn(result.opticalSpecs, 'estimatedRmsSpotRadiusUm'), false);
    assert.strictEqual(Object.hasOwn(result.opticalSpecs, 'estimatedMtfAt40lp_mm'), false);
    assert.throws(
      () => OpticalEngine.solveOpticalMetrics(),
      /requires positive focalLengthMm, fStop, subjectDistM, wavelengthNm, and circleOfConfusionMm/
    );
    assert(Number.isFinite(OpticalEngine.solveOpticalMetrics(50.0, 1.4, 2.0, 550, 0.029).depthOfField_m));

    const lensTool = OMNI_TOOLS.find((tool) => tool.name === 'design_camera_lens_optics');
    assert.deepStrictEqual(lensTool.parameters.required, [
      'focalLengthMm',
      'fStop',
      'subjectDistM',
      'wavelengthNm',
      'circleOfConfusionMm'
    ]);
    assert.strictEqual(Object.hasOwn(lensTool.parameters.properties.focalLengthMm, 'default'), false);
  });

  test('PCBDesignWizard returns only an experimental formula estimate', () => {
    const wizard = new PCBDesignWizard();
    assert.throws(() => wizard.runWizard(), /requires positive layerCount/);
    const result = wizard.runWizard({
      layerCount: 4,
      dielectricHeightMm: 0.2,
      targetImpedanceOhm: 50.0,
      er: 4.4,
      copperThicknessMm: 0.035
    });

    assert.strictEqual(result.wizard, 'PCBDesignWizard');
    assert.strictEqual(result.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(result.stackup.copperThicknessMm, 0.035);
    assert.strictEqual(Object.hasOwn(result.stackup, 'copperWeightOz'), false);
    assert(
      result.stackup.estimatedTraceWidthMm > 0.1 && result.stackup.estimatedTraceWidthMm < 1.0,
      'Trace width estimate must be positive for the example inputs'
    );
    assert.strictEqual(Object.hasOwn(result, 'generatedExampleFiles'), false);
    assert.match(result.plainSummary, /No board layout or manufacturing files were generated/);
  });

  test('Legacy optics prompts request missing engineering inputs instead of assuming them', () => {
    const macro = new OmniAIEngine();
    const missingLens = macro.processPrompt('Design a camera lens');
    assert.strictEqual(missingLens.result.status, 'INVALID_INPUT');
    assert.strictEqual(missingLens.inputOrigin, 'none');
    assert.match(
      missingLens.assistantMessage,
      /focal length.*f-number.*subject distance.*wavelength.*circle of confusion/
    );

    const circleOfConfusionIsNotFocalLength = macro.processPrompt(
      'Estimate a lens at f/2 focused at 3 m using wavelength 550 nm and circle of confusion 0.029 mm'
    );
    assert.strictEqual(circleOfConfusionIsNotFocalLength.result.status, 'INVALID_INPUT');
    assert.match(circleOfConfusionIsNotFocalLength.assistantMessage, /focal length \(mm\)/);

    const missingWizard = macro.processPrompt('Open the camera lens wizard');
    assert.strictEqual(missingWizard.result.status, 'INVALID_INPUT');
    assert.strictEqual(missingWizard.inputOrigin, 'none');

    const lens = macro.processPrompt(
      'Open the 50 mm f/2.8 lens wizard focused at 3 m using wavelength 550 nm and circle of confusion 0.029 mm'
    );
    assert.strictEqual(lens.result.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(lens.result.opticalSpecs.focalLengthMm, 50);
    assert.strictEqual(lens.result.opticalSpecs.fStop, 2.8);
    assert.strictEqual(lens.result.opticalSpecs.subjectDistM, 3);
    assert.strictEqual(lens.result.opticalSpecs.wavelengthNm, 550);
    assert.strictEqual(lens.result.opticalSpecs.circleOfConfusionMm, 0.029);
    assert.strictEqual(lens.inputOrigin, 'user-prompt');

    const micronInputs = macro.processPrompt(
      'Open a 50 mm camera lens wizard at f/2, subject distance 3 m, wavelength 0.55 µm, and circle of confusion 29 µm'
    );
    assert.strictEqual(micronInputs.result.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(micronInputs.result.opticalSpecs.wavelengthNm, 550);
    assert.strictEqual(micronInputs.result.opticalSpecs.circleOfConfusionMm, 0.029);
  });

  test('Legacy PCB prompts request the full illustrative stackup instead of assuming it', () => {
    const macro = new OmniAIEngine();
    const missing = macro.processPrompt('Open the PCB wizard');
    assert.strictEqual(missing.result.status, 'INVALID_INPUT');
    assert.strictEqual(missing.inputOrigin, 'none');

    const pcb = macro.processPrompt(
      'Open the 4-layer PCB wizard with 0.2 mm dielectric thickness, target impedance 50 ohm, er 4.4, and copper thickness 35 um'
    );
    assert.strictEqual(pcb.result.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(pcb.result.stackup.layerCount, 4);
    assert.strictEqual(pcb.result.stackup.dielectricHeightMm, 0.2);
    assert.strictEqual(pcb.result.stackup.targetImpedanceOhm, 50);
    assert.strictEqual(pcb.result.stackup.dielectricConstant, 4.4);
    assert.strictEqual(pcb.result.stackup.copperThicknessMm, 0.035);
    assert.strictEqual(pcb.inputOrigin, 'user-prompt');
  });

  test('PlainEnglishErrorTranslator summarizes diagnostic context without engineering actions', () => {
    const diag = PlainEnglishErrorTranslator.translate({
      domain: 'structural',
      code: 'STRESS_YIELD',
      context: { peakStressMPa: 620.0, yieldLimitMPa: 503.0, thicknessMm: 0.8 }
    });

    assert.strictEqual(diag.severity, 'INFO');
    assert(diag.plainEnglishAdvice.includes('Diagnostic code'), 'Must preserve supplied diagnostic code');
    assert.strictEqual(diag.oneClickAction, null);
    assert(diag.suggestedFix.includes('No automated engineering recommendation'));
  });

  console.log('\n================================================================');
  console.log(`Phase 1 smoke checks finished: ${passed}/${total} passed (${total - passed} failed)`);
  console.log('================================================================\n');

  return { total, passed, failed: total - passed };
}

if (require.main === module) {
  runPhase1Tests();
}

module.exports = { runPhase1Tests };
