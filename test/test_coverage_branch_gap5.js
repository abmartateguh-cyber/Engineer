'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 5).
 *
 * PID engine validation/symbol branches, propulsion invalid-input branches,
 * symbolic reasoner, ODE solvers, VOF solver, flowsheet solver, GPU PCG,
 * worker pool, archive storage, and CAD translation/blending error paths.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { PIDEngine } = require('../src/core/plant/pid_engine');
const { NasaRocketPropulsion } = require('../src/core/aerospace/nasa_rocket_propulsion');
const {
  PhysicalDimension,
  DimensionalQuantity,
  SymbolicPhysicsKnowledgeGraph
} = require('../src/core/ai/symbolic_reasoner');
const { ODESolvers, RadauIIA } = require('../src/core/math/ode_solvers');
const { VOFMultiphaseSolver } = require('../src/core/cae/vof_multiphase_solver');
const { ProcessStream, ProcessFlowsheetSolver } = require('../src/core/plant/process_flowsheet_solver');
const { GPUParallelPCGSolver } = require('../src/core/math/gpu_parallel_pcg_solver');
const { PersistentWorkerPool } = require('../src/core/math/worker_pool');
const { OmniVaultAES256, OmniWal, CommandJournal, saveAtomicSync } = require('../src/core/storage/omni_archive');
const { StepTranslator } = require('../src/core/cad/step_translator');
const { EdgeBlender, resolveFaceVertex, resolveEndpoint } = require('../src/core/cad/edge_blender');
const { Vertex, Face, SolidBody, BRepPrimitives } = require('../src/core/cad/brep_topology');

function runBranchGapFiveCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  function check(name, fn) {
    totalTests++;
    try {
      fn();
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // ---------------------------------------------------------------
  // PID engine validateConfig branches
  // ---------------------------------------------------------------
  check('PIDEngine validateConfig error branches', () => {
    const engine = new PIDEngine();
    const redundant = engine.createPID({
      project: { revision: '1' },
      areas: [
        {
          id: 'A-1',
          equipment: [
            {
              tag: 'E-1',
              type: 'bogus_type',
              x: -1,
              y: NaN,
              nozzles: [{ id: 'N1' }],
              inletNozzles: ['N2'],
              outletNozzles: ['N1']
            }
          ]
        }
      ],
      lines: [
        {
          lineNumber: 'BAD',
          sizeIn: 25,
          material: '',
          class: 'BAD',
          from: { tag: 'GHOST', nozzle: 'N1' },
          to: { tag: 'E-1', nozzle: 'N9' },
          service: 'hydrocarbon'
        }
      ],
      instruments: [
        { tag: 'X-1', location: 'bogus' },
        { tag: 'X-2', connectedTo: { tag: 'GHOST2', nozzle: 'N1' } },
        { tag: 'X-3', connectedTo: { tag: 'E-1', nozzle: 'N9' } }
      ],
      valves: [
        { tag: 'V-1', type: 'bogus', actuator: 'bogus', lineNumber: 'BAD' },
        { tag: 'V-2', type: 'psv', lineNumber: 'BAD' },
        { tag: 'V-3', type: 'psv', setPressureBarg: 0, lineNumber: 'BAD' }
      ],
      controlLoops: [
        { loopTag: 'L-1' },
        { loopTag: 'L-2', sensorTag: 'GHOST', controllerTag: 'GHOST2', finalElementTag: 'GHOST3', type: 'bogus' }
      ]
    });
    assert.strictEqual(redundant.success, false);
    assert(redundant.validation.errors.length >= 10);
    assert(redundant.validation.warnings.length >= 3);
  });

  check('PIDEngine symbol and layout branches', () => {
    const engine = new PIDEngine();
    const config = {
      project: { name: 'Sym', revision: '0' },
      areas: [
        {
          id: 'A-1',
          order: 1,
          equipment: [
            {
              tag: 'S-1',
              type: 'vertical_separator',
              x: 0,
              y: 0,
              nozzles: [],
              inletNozzles: [],
              outletNozzles: [],
              ventNozzles: []
            },
            {
              tag: 'T-1',
              type: 'storage_tank',
              x: 0,
              y: 0,
              nozzles: [],
              inletNozzles: [],
              outletNozzles: [],
              ventNozzles: []
            },
            {
              tag: 'P-1',
              type: 'pig_receiver',
              x: 0,
              y: 0,
              nozzles: [],
              inletNozzles: [],
              outletNozzles: [],
              ventNozzles: []
            },
            {
              tag: 'Z-1',
              type: 'stabilizer_column',
              x: 0,
              y: 0,
              nozzles: [],
              inletNozzles: [],
              outletNozzles: [],
              ventNozzles: []
            }
          ]
        }
      ],
      lines: [],
      instruments: [],
      valves: [{ tag: 'V-1', type: 'globe', lineNumber: 'L-1' }],
      controlLoops: []
    };
    const result = engine.createPID(config);
    assert.strictEqual(typeof result, 'object');
    const csv = engine.vectorizeSchedule(result.schedule);
    assert(csv.valves.includes('tag,type'));
  });

  // ---------------------------------------------------------------
  // NASA rocket invalid-input branches
  // ---------------------------------------------------------------
  check('NasaRocketPropulsion invalid input branches', () => {
    const rocket = new NasaRocketPropulsion();
    const invalid = rocket.calculateBartzRegenerativeCooling(rocket.calculateEnginePerformance({}), {});
    assert.strictEqual(invalid.success, false);
    const noThermo = rocket.calculateBartzRegenerativeCooling({ success: true }, {});
    assert.strictEqual(noThermo.success, false);
    const badGamma = rocket.calculateBartzRegenerativeCooling({ success: true, thermo: { gamma: 0.9 } }, {});
    assert.strictEqual(badGamma.success, false);
    const highCorrection = rocket.calculateBartzRegenerativeCooling(
      { success: true, thermo: { gamma: 1.2 } },
      { bartzCorrectionFactor: 1.5 }
    );
    assert.strictEqual(highCorrection.success, false);
    const lowRe = rocket.calculateBartzRegenerativeCooling(
      { success: true, thermo: { gamma: 1.2 } },
      { coolantRe: 5000 }
    );
    assert.strictEqual(lowRe.success, false);
    const turbopumpBad = rocket.calculateTurbopumpSystem(null, null, {});
    assert.strictEqual(turbopumpBad.success, false);
    const turbopumpNoCool = rocket.calculateTurbopumpSystem({ success: true, thermo: {} }, { success: false }, {});
    assert.strictEqual(turbopumpNoCool.success, false);
    const turbopumpBadPump = rocket.calculateTurbopumpSystem(
      { success: true, thermo: {} },
      { success: true, coolantPressureDropPa: 1e5 },
      {}
    );
    assert.strictEqual(turbopumpBadPump.success, false);
    const stagingBad = rocket.calculateStagingDeltaV(null);
    assert.strictEqual(stagingBad.success, false);
    const isogridBad = rocket.calculateIsogridTankBuckling(null);
    assert.strictEqual(isogridBad.success, false);
    const isogridBadF = rocket.calculateIsogridTankBuckling({
      radiusM: 1,
      skinThicknessM: 0.003,
      stiffenerPitchM: 0.1,
      materialYieldPa: 250e6,
      materialElasticModulusPa: 70e9,
      densityKgM3: 2700
    });
    assert.strictEqual(isogridBadF.success, false);
    const nozzleBad = rocket.compileRocketNozzle(null);
    assert.strictEqual(nozzleBad.success, false);
    const nozzleMissing = rocket.compileRocketNozzle({});
    assert.strictEqual(nozzleMissing.success, false);
    const cfdBad = rocket.runAerospaceCFD(null);
    assert.strictEqual(cfdBad.success, false);
    const ascentBad = rocket.simulateAscentTrajectory(null);
    assert.strictEqual(ascentBad.success, false);
    const ascentBadCount = rocket.simulateAscentTrajectory({
      stage1EngineCount: 1.5,
      stage1PropellantMassKg: 100,
      liftOffMassKg: 200,
      burnTimeS: 10,
      Isp_sl: 300,
      Isp_vac: 350
    });
    assert.strictEqual(ascentBadCount.success, false);
    const ascentBadProp = rocket.simulateAscentTrajectory({
      stage1EngineCount: 1,
      stage1PropellantMassKg: 200,
      liftOffMassKg: 200,
      burnTimeS: 10,
      Isp_sl: 300,
      Isp_vac: 350
    });
    assert.strictEqual(ascentBadProp.success, false);
    const ascentBadIsp = rocket.simulateAscentTrajectory({
      stage1EngineCount: 1,
      stage1PropellantMassKg: 100,
      liftOffMassKg: 200,
      burnTimeS: 10,
      Isp_sl: 350,
      Isp_vac: 300
    });
    assert.strictEqual(ascentBadIsp.success, false);
    const ascentBadFlow = rocket.simulateAscentTrajectory({
      stage1EngineCount: 1,
      stage1PropellantMassKg: 100,
      liftOffMassKg: 200,
      burnTimeS: 10,
      Isp_sl: 300,
      Isp_vac: 350,
      stage1EngineThrustN: 1e9
    });
    assert.strictEqual(ascentBadFlow.success, false);
  });

  // ---------------------------------------------------------------
  // Symbolic reasoner error branches
  // ---------------------------------------------------------------
  check('PhysicalDimension and DimensionalQuantity error branches', () => {
    const mass = PhysicalDimension.mass();
    const length = PhysicalDimension.length();
    assert.throws(() => mass.add(length), /Incompatible dimensions/);
    assert.throws(() => mass.sub(length), /Incompatible dimensions/);
    assert.strictEqual(
      new PhysicalDimension(1, 0, 0, 0, 0, 0, 0).equals(new PhysicalDimension(1, 0, 0, 0, 0, 0, 0)),
      true
    );
    assert.strictEqual(mass.equals('1 kg'), false);
    assert.strictEqual(PhysicalDimension.dimensionless().format(), 'Dimensionless');
    assert.strictEqual(new PhysicalDimension(0, 1, 0, 0, 0, 0, 0).format(), 'L^1');
    assert.throws(() => new DimensionalQuantity(5, 'bogus_unit'), /Unknown physical unit/);
    const q = new DimensionalQuantity(1, 'm');
    assert.throws(() => q.convertTo('bogus_unit'), /Unknown target unit/);
    assert.throws(() => new DimensionalQuantity(1, 'kg').convertTo('m'), /Dimension mismatch/);
    const qL = new DimensionalQuantity(1, 'm');
    assert.strictEqual(qL.convertTo('cm').magnitude, 100);
    const reasoner = new SymbolicPhysicsKnowledgeGraph();
    assert.throws(() => reasoner.calculateAxialElongation(100, 1, 0, 200e9), /positive/);
    assert.throws(() => reasoner.calculatePressureVesselStress(1, 1, 0), /positive/);
    assert.throws(
      () =>
        reasoner.calculateDroneHoverAerodynamics({
          rotorCount: 0,
          thrustPerRotorN: 1,
          airDensity: 1.2,
          rotorRadiusM: 0.5,
          figureOfMerit: 0.8,
          payloadN: 1,
          vehicleDryMassKg: 1
        }),
      /rotorCount/
    );
  });

  // ---------------------------------------------------------------
  // ODE solvers argument branches
  // ---------------------------------------------------------------
  check('ODESolvers RK4 and Radau argument branches', () => {
    const f = (t, y) => [-y[0]];
    const out = ODESolvers.rk4(f, 0, [1], 0.01, 100);
    assert(out && out.length > 1);
    const out2 = ODESolvers.solveRK4(f, 0, [1], 1, 0.01);
    assert(out2 && out2.length > 1);
    assert.throws(() => ODESolvers.solveRadauIIA(f, 0, [1], 1, { maxSteps: 0 }), /maxSteps/);
    const rad = ODESolvers.solveRadauIIA(f, 0, [1], 1, {});
    assert(rad && rad.length > 1);
    const radau = new RadauIIA({});
    assert(radau && typeof radau === 'object');
    const solved = radau.solve(f, 0, [1], 1);
    assert(solved && solved.length > 1);
  });

  // ---------------------------------------------------------------
  // VOF multi-phase solver branches
  // ---------------------------------------------------------------
  check('VOFMultiphaseSolver validation and branches', () => {
    assert.throws(
      () => new VOFMultiphaseSolver({ surfaceTensionNPerM: -1, rho1: 1000, rho2: 1.2, mu1: 1e-3, mu2: 1.8e-5 }),
      /surface tension cannot be negative/
    );
    assert.throws(
      () => new VOFMultiphaseSolver({ surfaceTensionNPerM: 0.07, rho1: 1000, rho2: 1.2, mu1: 0, mu2: 1.8e-5 }),
      /positive/
    );
    const solver = new VOFMultiphaseSolver({
      surfaceTensionNPerM: 0.07,
      rho1: 1000,
      rho2: 1.2,
      mu1: 1e-3,
      mu2: 1.8e-5
    });
    assert.throws(() => solver.getMixtureProperties(NaN), /phase-1 volume fraction/);
    assert(Number.isFinite(solver.getMixtureProperties(0.5).density));
    assert.throws(() => solver.simulateDamBreak({ columnWidth: 0, columnHeight: 1, timeSec: 1 }), /positive/);
    assert.throws(() => solver.simulateDamBreak({ columnWidth: 1, columnHeight: 1, timeSec: -1 }), /positive/);
    const sim = solver.simulateDamBreak({ columnWidth: 1, columnHeight: 1, timeSec: 0.1 });
    assert(sim && typeof sim === 'object');
  });

  // ---------------------------------------------------------------
  // Process flowsheet solver error paths
  // ---------------------------------------------------------------
  check('ProcessFlowsheetSolver error paths', () => {
    const solver = new ProcessFlowsheetSolver();
    assert.throws(
      () => solver.addStream('s1', { temperatureC: 25, pressureBar: 1, composition: { A: 1 }, molarFlowKmolH: 10 }),
      /addStream/
    );
    assert.throws(() => solver.addMixer('m1', [], ['s1']), /Mixer/);
    assert.throws(() => solver.addFlashDrum('f1', null), /Flash drum/);
    assert.throws(
      () =>
        solver.addFlashDrum('f1', 'feed', 'vapor', 'liquid', {
          pressureBar: 0,
          temperatureC: 25,
          componentProperties: {}
        }),
      /pressure/
    );
    assert.throws(
      () => solver.addFlashDrum('f1', 'feed', 'vapor', 'liquid', { pressureBar: 1, temperatureC: 25 }),
      /component property records/
    );
    const badStream = new ProcessStream('s9', {
      temperatureC: 25,
      pressureBar: 1,
      composition: { A: 1 },
      molarFlowKmolH: 10,
      vaporFraction: 0.5
    });
    assert(badStream && typeof badStream === 'object');
    const solveOut = solver.solve();
    assert.strictEqual(solveOut.status, 'invalid-input');
  });

  // ---------------------------------------------------------------
  // GPU PCG option validation
  // ---------------------------------------------------------------
  check('GPUParallelPCGSolver option validation branches', () => {
    assert.throws(() => new GPUParallelPCGSolver(null), /options/);
    assert.throws(() => new GPUParallelPCGSolver([]), /options/);
    assert.throws(() => new GPUParallelPCGSolver({ maxIterations: 0 }), /maxIterations/);
    assert.throws(() => new GPUParallelPCGSolver({ tolerance: 1 }), /tolerance/);
    assert.throws(() => new GPUParallelPCGSolver({ maxWorkers: 0 }), /maxWorkers/);
    const solver = new GPUParallelPCGSolver({});
    assert.throws(() => solver.solve([], [1]), /row/);
    assert.throws(
      () => solver.solve({ N: 2, rowPtr: [0, 1, 1], colIndices: [0], values: [2] }, [1, 1]),
      /positive diagonal/
    );
    assert.throws(
      () => solver.solve({ N: 2, rowPtr: [0, 1, 2], colIndices: [0, 5], values: [2, 3] }, [1, 1]),
      /column indices/
    );
    assert.throws(
      () => solver.solve({ N: 2, rowPtr: [0, 1, 2], colIndices: [0, 1], values: [2, NaN] }, [1, 1]),
      /finite/
    );
    assert.throws(() => solver.solve({ N: 2, rowPtr: [0, 1, 2], colIndices: [0, 1], values: [2, 3] }, [1]), /b/);
    assert.throws(
      () => solver.solve({ N: 2, rowPtr: [0, 1, 2], colIndices: [0, 1], values: [2, 3] }, [1, 1], [0]),
      /initial guess/
    );
    const ok = solver.solve({ N: 2, rowPtr: [0, 1, 2], colIndices: [0, 1], values: [2, 3] }, [1, 1]);
    assert.strictEqual(ok.converged, true);
  });

  // ---------------------------------------------------------------
  // Worker pool dispatch validation
  // ---------------------------------------------------------------
  check('PersistentWorkerPool error branches', () => {
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    assert.throws(() => pool.allocateSharedBuffer(-1), /byte length/);
    assert.throws(() => pool.allocateSharedFloat64Array(-1), /element count/);
    return pool.terminateAll().catch(() => {});
  });

  // ---------------------------------------------------------------
  // Storage archive branches
  // ---------------------------------------------------------------
  check('OmniVaultAES256 and Journal branches', () => {
    const vault = OmniVaultAES256;
    const plain = Buffer.from('archive payload bytes');
    const sealed = vault.encrypt(plain, 'correct horse battery staple');
    assert(sealed && Buffer.isBuffer(sealed));
    const opened = vault.decrypt(sealed, 'correct horse battery staple');
    assert.strictEqual(opened.toString(), plain.toString());
    assert.throws(() => vault.decrypt(sealed, 'wrong password'), /authentication|tag|decrypt/i);
    assert.throws(() => vault.decrypt(Buffer.from([1, 2, 3]), 'pw'), /payload shorter than cryptographic header/);
    assert.throws(() => vault.decrypt(Buffer.alloc(60), 'pw'), /Invalid vault header/);
    const walPath = path.join(os.tmpdir(), `omnieng-wal-${Date.now()}.log`);
    const archivePath = path.join(os.tmpdir(), `omnieng-archive-${Date.now()}.omni`);
    const wal = new OmniWal({ path: walPath, archivePath });
    wal.open();
    wal.appendEntry('write', { path: '/a' });
    const afterAppend = wal.stats();
    assert.strictEqual(afterAppend.pending, 1);
    wal.flush();
    wal.commit();
    assert.strictEqual(wal.stats().committed, 1);
    wal.close();
    fs.unlinkSync(walPath);
    const journal = new CommandJournal();
    journal.execute('insert', { target: 'x' }, { target: null });
    assert.strictEqual(journal.canUndo(), true);
    const undone = journal.undo();
    assert(undone && typeof undone === 'object');
    assert.strictEqual(journal.canRedo(), true);
    journal.redo();
    assert.strictEqual(journal.canRedo(), false);
    assert.strictEqual(journal.getHistory().length, 1);
    assert.strictEqual(journal.export().history.length, 1);
    assert.throws(() => journal.import({}), /Invalid journal import/);
    const tmp = path.join(os.tmpdir(), `omnieng-save-${Date.now()}.bin`);
    saveAtomicSync(tmp, Buffer.from('hello'));
    assert.strictEqual(fs.readFileSync(tmp).toString(), 'hello');
    fs.unlinkSync(tmp);
  });

  // ---------------------------------------------------------------
  // STEP translator branches
  // ---------------------------------------------------------------
  check('StepTranslator NURBS and assembly branches', () => {
    const solid = BRepPrimitives.createBox(1, 1, 1);
    const nurbs = StepTranslator.exportNurbsSurfaces(solid);
    assert(nurbs && typeof nurbs === 'string');
    const assembly = StepTranslator.exportAssemblySTEP({
      solids: [
        {
          id: 's1',
          name: 'Part1',
          faces: solid.faces,
          vertices: solid.vertices,
          edges: solid.edges,
          layer: 'L1',
          color: { r: 1, g: 0, b: 0 }
        }
      ],
      nodes: [{ id: 'n1', name: 'Occ1', solidId: 's1', layer: 'L1', color: { r: 0, g: 1, b: 0 } }],
      edges: []
    });
    assert(assembly && typeof assembly === 'string');
    const assemblyWithEdges = StepTranslator.exportAssemblySTEP({
      solids: [{ id: 's1', name: 'Part1', faces: solid.faces, vertices: solid.vertices, edges: solid.edges }],
      nodes: [
        { id: 'n1', solidId: 's1' },
        { id: 'n2', solidId: 's1' }
      ],
      edges: [{ parentId: 'n1', childId: 'n2', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }]
    });
    assert(assemblyWithEdges && typeof assemblyWithEdges === 'string');
    const parse = StepTranslator.parseSTEP(assembly);
    assert(parse && typeof parse === 'object');
  });

  // ---------------------------------------------------------------
  // Edge blender error paths
  // ---------------------------------------------------------------
  check('EdgeBlender hydration and blend error paths', () => {
    assert.throws(() => EdgeBlender._readPoint([1, 2]), /three finite numeric/);
    assert.throws(() => EdgeBlender._hydrateSolid(null), /Edge blending requires/);
    assert.throws(() => EdgeBlender._hydrateSolid({ vertices: [{}] }), /vertex/);
    assert.throws(
      () =>
        EdgeBlender._hydrateSolid({
          vertices: [
            { id: 0, point: { x: 0, y: 0, z: 0 } },
            { id: 1, point: { x: 1, y: 0, z: 0 } },
            { id: 2, point: { x: 0, y: 1, z: 0 } }
          ],
          faces: [{ vertices: [0, 1, 2] }],
          edges: 'bad'
        }),
      /Serialized edges/
    );
    const solid = BRepPrimitives.createBox(1, 1, 1);
    assert.throws(() => EdgeBlender.applyFillet(solid, { id: 'missing' }, 0.05), /shared by at least 2 faces/);
    assert.throws(() => EdgeBlender.applyChamfer(solid, { id: 'missing' }, 0.05), /2 adjacent faces/);
    assert.throws(() => EdgeBlender.applyChamfer(solid, solid.edges[0], 0), /positive/);
    const ok = EdgeBlender.applyFillet(solid, solid.edges[0], 0.05);
    assert(ok && typeof ok === 'object');
  });

  console.log('\n================================================================');
  console.log(`   BRANCH-GAP-5 RESULTS: ${passedTests}/${totalTests} passed; ${failedTests} failed`);
  console.log('================================================================');
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapFiveCoverageTests };

if (require.main === module) {
  const stats = runBranchGapFiveCoverageTests();
  if (stats.failed > 0) process.exitCode = 1;
}
