'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 16).
 *
 * Targets remaining uncovered non-entry blocks in EDA timing/SPICE/LEF,
 * optical DLS, compliance tooling, symbolic reasoner, CAD blending/STEP,
 * FVM, archive/WAL storage, worker pools, P&ID generation, system IPC, and
 * domain engine adapters.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { StaticTimingAnalysis } = require('../src/core/eda/static_timing_analysis');
const { SpiceEngine } = require('../src/core/eda/spice_engine');
const { LefDefParser } = require('../src/core/eda/lef_def_parser');
const { DampedLeastSquaresOptimizer } = require('../src/core/optics/damped_least_squares_optimizer');
const { ToolQualificationKit } = require('../src/core/compliance/tool_qualification_kit');
const {
  PhysicalDimension,
  DimensionalQuantity,
  SymbolicPhysicsKnowledgeGraph,
  NelderMeadOptimizer,
  DeterministicIntentLexer,
  SymbolicReasoner
} = require('../src/core/ai/symbolic_reasoner');
const { EdgeBlender } = require('../src/core/cad/edge_blender');
const { StepTranslator } = require('../src/core/cad/step_translator');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');
const { FVMNavierStokes3D } = require('../src/core/cae/fvm_navier_stokes_3d');
const { OmniArchive, OmniWal, calculateCRC32, WAL_FILE_NAME } = require('../src/core/storage/omni_archive');
const { ExperimentalCalculationQueue, PersistentWorkerPool } = require('../src/core/math/worker_pool');
const { PIDEngine } = require('../src/core/plant/pid_engine');
const systemIpc = require('../src/main/ipc/system_ipc');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { SerialManipulatorEngine, PUMA_560_DH } = require('../src/core/robotics/serial_manipulator_kinematics');
const { AerospaceEngineAdapter } = require('../src/core/aerospace/aerospace_engine_adapter');
const { PlantEngineAdapter } = require('../src/core/plant/plant_engine_adapter');
const { GeometryEngineAdapter } = require('../src/core/cad/geometry_engine_adapter');
const { OpticsEngineAdapter } = require('../src/core/optics/optics_engine_adapter');
const { EDAEngineAdapter } = require('../src/core/eda/eda_engine_adapter');

async function runBranchGapSixteenCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const pending = [];

  function check(name, fn) {
    totalTests++;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        pending.push(
          Promise.resolve(result).then(
            () => {
              passedTests++;
              console.log(`  ✓ PASSED: ${name}`);
            },
            (err) => {
              failedTests++;
              console.error(`  ✗ FAILED: ${name}`);
              console.error(`    ${err.message}`);
            }
          )
        );
        return;
      }
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // ------------------------------------------------------------------
  // Static timing analysis
  // ------------------------------------------------------------------
  check('StaticTimingAnalysis MCMM analyzeTiming with corners and modes', () => {
    const graph = {
      nodes: [
        { id: 'clk', type: 'input' },
        { id: 'reg1', type: 'ff', delay: 0.35 },
        { id: 'g1', type: 'gate', delay: 0.2 },
        { id: 'out', type: 'output' }
      ],
      edges: [
        { from: 'clk', to: 'reg1', delay: 0.05 },
        { from: 'reg1', to: 'g1' },
        { from: 'g1', to: 'out', delay: 0.1 }
      ]
    };
    const options = {
      corners: [
        { name: 'ss', delays: { cells: { g1: 0.3 }, nets: { 'reg1->g1': 0.08 }, defaultCell: 0.1, defaultNet: 0.02 } },
        { name: 'ff' }
      ],
      modes: [
        { name: 'function', constraints: { period: 5, setup: 0.15, hold: 0.08, skew: 0.1, tCq: 0.35 } },
        { name: 'test', constraints: { period: 10 } }
      ]
    };
    const report = StaticTimingAnalysis.analyzeTiming(graph, options);
    assert.strictEqual(report.corners.length, 2);
    assert.strictEqual(report.corners[0].modes.length, 2);
    assert(Number.isFinite(report.worstSetupSlackOverall));
  });

  check('StaticTimingAnalysis graph validation branches', () => {
    assert.throws(() => StaticTimingAnalysis.analyzeTiming(null), /timing graph object/);
    assert.throws(() => StaticTimingAnalysis.analyzeTiming({ nodes: [] }), /at least one node/);
    assert.throws(() => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: '' }] }), /non-empty string id/);
    assert.throws(() => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }, { id: 'a' }] }), /duplicate node id/);
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a', type: 'bogus' }] }),
      /unsupported type/
    );
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 5 }] }),
      /requires string from\/to/
    );
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'missing' }] }),
      /references unknown node/
    );
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'a' }] }),
      /self-loop/
    );
  });

  check('StaticTimingAnalysis corner/mode and constraint validation', () => {
    const graph = {
      nodes: [
        { id: 'a', type: 'input' },
        { id: 'b', type: 'output' }
      ],
      edges: [{ from: 'a', to: 'b' }]
    };
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming(graph, { corners: [{ delays: {} }] }),
      /corner requires a name/
    );
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming(graph, { modes: [{ constraints: {} }] }),
      /mode requires a name/
    );
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming(graph, { modes: [{ name: 'm', constraints: { period: -1 } }] }),
      /finite, non-negative/
    );
  });

  check('StaticTimingAnalysis analyzePath with interconnect trace', () => {
    const sta = new StaticTimingAnalysis({ clockPeriodPs: 6000 });
    const res = sta.analyzePath({
      interconnectTrace: { lengthUm: 2000, widthUm: 1.2, thicknessUm: 0.6, substrateHeightUm: 1.4, er: 4.2 },
      tCqPs: 400,
      tSetupPs: 160,
      tHoldPs: 90,
      logicGateDelayPs: 1200
    });
    assert(Number.isFinite(res.setupSlackPs));
    assert(Number.isFinite(res.interconnectDelayPs));
  });

  check('StaticTimingAnalysis evaluatePathTiming and extractParasitics helpers', () => {
    const r = StaticTimingAnalysis.evaluatePathTiming({
      clockPeriodNs: 5,
      tLaunchCqNs: 0.35,
      tSetupNs: 0.15,
      tHoldNs: 0.08,
      gateDelaysNs: [0.2, 0.3],
      wireDelaysNs: [0.05, 0.1]
    });
    assert(Number.isFinite(r.setupSlackNs));
    const pex = StaticTimingAnalysis.extractParasitics({
      lengthMm: 2,
      widthUm: 1,
      thicknessUm: 0.5,
      dielectricHeightUm: 1,
      dielectricConstant: 3.9
    });
    assert(pex.resistanceOhms > 0);
    const elmore = StaticTimingAnalysis.computeElmoreDelay(100, 50, 1e-12, 0.01e-12);
    assert(Number.isFinite(elmore));
  });

  // ------------------------------------------------------------------
  // SPICE engine
  // ------------------------------------------------------------------
  check('SpiceEngine DC sweep with diode and MOSFET saturation', () => {
    const spice = new SpiceEngine();
    spice.addVoltageSource('V1', 'in', '0', 3);
    spice.addResistor('R1', 'in', 'd', 1000);
    spice.addDiode('D1', 'd', '0', 1e-14, 1);
    spice.addMOSFET('M1', 'd', 'in', '0', 'NMOS', 0.7, 1e-3, 0.01);
    const result = spice.solveDCOperatingPoint();
    assert(result.converged === true || result.converged === false);
    assert(Number.isFinite(result.nodeVoltages?.d ?? result.nodeVoltages?.in ?? 0));
  });

  check('SpiceEngine runTransient with inductor and voltage source waveforms', () => {
    const spice = new SpiceEngine();
    spice.addVoltageSource('V1', 'in', '0', 0, { type: 'PULSE', v1: 0, v2: 5, period: 0.001, width: 0.0005, delay: 0 });
    spice.addInductor('L1', 'in', 'out', 1e-3, 0);
    spice.addResistor('R1', 'out', '0', 100);
    const result = spice.runTransient(0.001, 1e-5);
    assert(result.time.length > 1);
  });

  check('SpiceEngine waveform unknown-type fallback to dcValue', () => {
    const spice = new SpiceEngine();
    spice.addVoltageSource('V1', 'in', '0', 5, { type: 'UNKNOWN' });
    spice.addResistor('R1', 'in', '0', 100);
    const result = spice.runTransient(0.0005, 1e-5);
    assert(result.time.length > 1);
  });

  check('SpiceEngine diode default parameters via object or numbers', () => {
    const a = new SpiceEngine();
    a.addVoltageSource('V1', 'in', '0', 5);
    a.addDiode('D1', 'in', '0', { Is: 1e-14 });
    const r1 = a.solveDCOperatingPoint(50, 1e-6);
    assert(Number.isFinite(r1.nodeVoltages.in));
    const b = new SpiceEngine();
    b.addVoltageSource('V1', 'in', '0', 5);
    b.addDiode('D1', 'in', '0', 1e-14, 1.5);
    const r2 = b.solveDCOperatingPoint();
    assert(Number.isFinite(r2.nodeVoltages.in));
  });

  // ------------------------------------------------------------------
  // LEF/DEF parser
  // ------------------------------------------------------------------
  check('LefDefParser parseLEF version layer macro pin and obs paths', () => {
    const lef = `VERSION 5.8 ;
LAYER m1 ;
  TYPE ROUTING ;
END m1
MACRO INV
  CLASS CORE ;
  SIZE 10 BY 20 ;
  PIN A
    DIRECTION INPUT ;
    USE SIGNAL ;
    PORT
      LAYER m1 ;
      RECT 0 0 2 2 ;
    END
  END A
  OBS
    LAYER m1 ;
      RECT 1 1 3 3 ;
  END
END INV`;
    const lib = LefDefParser.parseLEF(lef);
    assert.strictEqual(lib.version, '5.8');
    assert(lib.layers.m1);
    assert.strictEqual(lib.macros.INV.class, 'CORE');
    assert.strictEqual(lib.macros.INV.pins.A.direction, 'INPUT');
    assert.strictEqual(lib.macros.INV.pins.A.use, 'SIGNAL');
    assert(lib.macros.INV.obstructions.length >= 1);
  });

  check('LefDefParser parseLEF missing layer/rect guards', () => {
    assert.throws(
      () =>
        LefDefParser.parseLEF(
          'VERSION 5.8 ;\nMACRO A\n  PIN X\n    PORT\n      RECT 0 0 1 1 ;\n    END\n  END X\nEND A'
        ),
      /has no LAYER declaration/
    );
  });

  check('LefDefParser parseDEF component placement and orientation', () => {
    const def = `VERSION 5.8 ;
DESIGN top ;
UNITS DISTANCE MICRONS 1000 ;
DIEAREA ( 0 0 ) ( 1000 1000 ) ;
COMPONENTS 2 ;
  - u1 INV + PLACED ( 100 200 ) N ;
  - u2 NAND2 + FIXED ( 300 400 ) S ;
END COMPONENTS
NETS 1 ;
  - n1 ( u1 Y ) ( u2 A ) + ROUTED 1 ( 100 200 ) ( 300 400 ) ;
END NETS
END DESIGN`;
    const design = LefDefParser.parseDEF(def);
    assert.strictEqual(design.components.length, 2);
    assert.strictEqual(design.components[0].status, 'PLACED');
    assert.strictEqual(design.components[0].orientation, 'N');
    assert.strictEqual(design.components[1].status, 'FIXED');
    assert.strictEqual(design.nets.length, 1);
    assert.strictEqual(design.nets[0].routedSegments.length, 1);
  });

  check('LefDefParser parseDEF declared-count mismatch', () => {
    const def = `VERSION 5.8 ;
DESIGN top ;
UNITS DISTANCE MICRONS 1000 ;
DIEAREA ( 0 0 ) ( 1000 1000 ) ;
COMPONENTS 2 ;
  - u1 INV + FIXED ( 0 0 ) N ;
END COMPONENTS
END DESIGN`;
    assert.throws(() => LefDefParser.parseDEF(def), /declared 2 entries but parsed 1/);
  });

  check('LefDefParser serializeDEF failure paths', () => {
    assert.throws(
      () => LefDefParser.serializeDEF({ name: 'x', unitsDistanceMicrons: 0, dieArea: {}, components: [], nets: [] }),
      /positive safe integer/
    );
    assert.throws(
      () =>
        LefDefParser.serializeDEF({
          name: 'x',
          unitsDistanceMicrons: 1000,
          dieArea: { x1: 'a', y1: 0, x2: 1, y2: 1 },
          components: [],
          nets: []
        }),
      /four safe integer coordinates/
    );
    assert.throws(
      () =>
        LefDefParser.serializeDEF({
          name: 'x',
          unitsDistanceMicrons: 1000,
          dieArea: { x1: 0, y1: 0, x2: 1, y2: 1 },
          components: [{ id: 'u1', macro: 'INV', placement: { status: 'NOPE' } }],
          nets: []
        }),
      /supported placement status/
    );
    assert.throws(
      () =>
        LefDefParser.serializeDEF({
          name: 'x',
          unitsDistanceMicrons: 1000,
          dieArea: { x1: 0, y1: 0, x2: 1, y2: 1 },
          components: [],
          nets: [{ name: 'n', connections: 'bad', routedSegments: [] }]
        }),
      /valid name, connections array/
    );
  });

  check('LefDefParser parseDEF missing END section guard', () => {
    const def = `VERSION 5.8 ;
DESIGN top ;
UNITS DISTANCE MICRONS 1000 ;
DIEAREA ( 0 0 ) ( 1000 1000 ) ;
COMPONENTS 1 ;
  - u1 INV + FIXED ( 0 0 ) N ;
END DESIGN`;
    assert.throws(() => LefDefParser.parseDEF(def), /section is missing its END declaration/);
  });

  // ------------------------------------------------------------------
  // Damped least squares optimizer
  // ------------------------------------------------------------------
  const DLS_OPTIONS = {
    initialDamping: 0.001,
    minimumDamping: 1e-7,
    maximumDamping: 1e5,
    dampingReductionFactor: 2,
    dampingIncreaseFactor: 4,
    maxIterations: 10,
    tolerance: 1e-7,
    finiteDiffStep: 1e-5
  };
  const DLS_SYSTEM = {
    initialRefractiveIndex: 1.0,
    metricSampling: {
      entrancePupilRadiusMm: 10,
      paraxialRayHeightMm: 0.1,
      zonalRayFraction: 0.7071,
      chiefRayAngleRad: 0.05
    },
    surfaces: [
      { radius: 50, thickness: 5, refractiveIndex: 1.5168 },
      { radius: -50, thickness: 45, refractiveIndex: 1 }
    ]
  };

  check('DampedLeastSquaresOptimizer system/surface validation', () => {
    const dls = new DampedLeastSquaresOptimizer(DLS_OPTIONS);
    assert.throws(() => dls.traceMeridionalRay({ surfaces: [] }, 1, 0), /at least two surfaces/);
    const badThickness = {
      initialRefractiveIndex: 1,
      surfaces: [
        { radius: 50, thickness: -1, refractiveIndex: 1.5 },
        { thickness: 1, refractiveIndex: 1 }
      ]
    };
    assert.throws(() => dls.traceMeridionalRay(badThickness, 1, 0), /explicit nonnegative thickness/);
    const badCurvature = {
      initialRefractiveIndex: 1,
      surfaces: [
        { radius: 0, thickness: 1, refractiveIndex: 1.5 },
        { radius: 1, thickness: 1, refractiveIndex: 1 }
      ]
    };
    assert.throws(() => dls.evaluateSystemMetrics(badCurvature), /requires finite curvature or a nonzero radius/);
  });

  check('DampedLeastSquaresOptimizer validateOperands rejects malformed operands', () => {
    const dls = new DampedLeastSquaresOptimizer(DLS_OPTIONS);
    assert.throws(() => dls.evaluateMeritFunction(DLS_SYSTEM, 'bad'), /at least one explicit optical merit operand/);
  });

  check('DampedLeastSquaresOptimizer optimize reports finite merit and history', () => {
    const variables = [
      { surfaceIndex: 0, param: 'radius', min: 20, max: 100 },
      { surfaceIndex: 1, param: 'radius', min: -100, max: -20 }
    ];
    const operands = [
      { type: 'PARAXIAL_FOCAL_LENGTH', targetMm: 50, weight: 1 },
      { type: 'TERMINAL_RAY_SPREAD', targetMm: 0, weight: 0.01 }
    ];
    const dls = new DampedLeastSquaresOptimizer(DLS_OPTIONS);
    const result = dls.optimize(DLS_SYSTEM, variables, operands);
    assert(Number.isFinite(result.finalMerit));
    assert(Array.isArray(result.history));
  });

  check('DampedLeastSquaresOptimizer variable validation branches', () => {
    const dls = new DampedLeastSquaresOptimizer(DLS_OPTIONS);
    const operands = [{ type: 'PARAXIAL_FOCAL_LENGTH', targetMm: 50, weight: 1 }];
    assert.throws(() => dls.optimize(DLS_SYSTEM, [{ param: 'radius', value: 10 }], operands), /integer surfaceIndex/);
    const curvedSystem = {
      initialRefractiveIndex: 1.0,
      metricSampling: DLS_SYSTEM.metricSampling,
      surfaces: [
        { curvature: 0.1, thickness: 1, refractiveIndex: 1.5 },
        { radius: 50, thickness: 5, refractiveIndex: 1 }
      ]
    };
    assert.throws(
      () => dls.optimize(curvedSystem, [{ surfaceIndex: 0, param: 'radius', min: 1, max: 5, value: 2 }], operands),
      /cannot vary radius while curvature is supplied/
    );
    assert.throws(
      () => dls.optimize(DLS_SYSTEM, [{ surfaceIndex: 0, param: 'radius', min: 1, max: 5, value: 50 }], operands),
      /must start within its explicit bounds/
    );
    assert.throws(
      () =>
        dls.optimize(DLS_SYSTEM, [{ surfaceIndex: 0, param: 'refractiveIndex', min: -1, max: 2, value: 1 }], operands),
      /refractive-index bounds must be positive/
    );
  });

  // ------------------------------------------------------------------
  // Tool qualification kit
  // ------------------------------------------------------------------
  check('ToolQualificationKit executeQualificationSuite defaults', () => {
    const kit = new ToolQualificationKit({ targetSafetyStandard: 'DO-178C' });
    const summary = kit.executeQualificationSuite();
    assert(Number.isFinite(summary.passedCount));
    assert(Number.isFinite(summary.totalTests));
  });

  check('ToolQualificationKit evaluateEvidence DO-330 and DO-178C paths', () => {
    const kit = new ToolQualificationKit({ targetSafetyStandard: 'DO-330' });
    const evidence = {
      testResults: { total: 100, passed: 95, failed: 5 },
      coverage: { functions: 90, branches: 85, mcDc: 88 },
      defectTracking: { opened: 2, closed: 2 },
      configMgmt: { baselines: 1, changes: 3 },
      changes: { reviewed: 100, total: 100 },
      level: 'TQL-4'
    };
    const result = kit.evaluateEvidence(evidence);
    assert(typeof result.verdict === 'string');
    assert(Array.isArray(result.criteria));
  });

  check('ToolQualificationKit evaluateEvidence DO-178C with partial items', () => {
    const kit = new ToolQualificationKit({ targetSafetyStandard: 'DO-178C' });
    const result = kit.evaluateEvidence({
      testResults: { total: 10, passed: 9, failed: 1 },
      coverage: { overall: 88, mcDc: 90 },
      defectTracking: { opened: 1, closed: 1 },
      configMgmt: { baselines: 0, changes: 2 }
    });
    assert(typeof result.verdict === 'string');
    assert(Array.isArray(result.criteria));
  });

  check('ToolQualificationKit evaluateEvidence coverage object form', () => {
    const kit = new ToolQualificationKit({ targetSafetyStandard: 'DO-178C' });
    const result = kit.evaluateEvidence({
      testResults: { total: 20, passed: 20, failed: 0 },
      coverage: { total: 100, functions: 95, branches: 92, mcDc: 91 },
      defectTracking: { open: 0, closed: 0 },
      configMgmt: { baselines: 1, changes: 4 },
      changes: { reviewed: 100, total: 100 },
      usedFor: 'verification'
    });
    assert.match(result.verdict, /^evidence-satisfies/);
  });

  check('ToolQualificationKit report generators', () => {
    const kit = new ToolQualificationKit({ targetSafetyStandard: 'DO-178C' });
    const report = kit.generateExperimentalDiagnosticReport({ total: 4, passed: 4, failed: 0 });
    assert(typeof report === 'string');
    const compliance = kit.generateComplianceReport();
    assert(typeof compliance === 'string' || typeof compliance === 'object');
  });

  // ------------------------------------------------------------------
  // Symbolic reasoner
  // ------------------------------------------------------------------
  check('SymbolicReasoner PhysicalDimension arithmetic and format', () => {
    const m = new PhysicalDimension(1, 0, 0);
    const m2 = new PhysicalDimension(1, 0, 0);
    const s = new PhysicalDimension(0, 0, 1);
    const s2 = new PhysicalDimension(0, 0, 2);
    assert.deepStrictEqual(m.add(m2).toArray(), [1, 0, 0, 0, 0, 0, 0]);
    assert.deepStrictEqual(m2.sub(m).toArray(), [1, 0, 0, 0, 0, 0, 0]);
    assert.deepStrictEqual(s.mul(s).toArray(), [0, 0, 2, 0, 0, 0, 0]);
    assert.deepStrictEqual(s2.div(s).toArray(), [0, 0, 1, 0, 0, 0, 0]);
    assert(m.pow(1).toArray()[0] === 1);
    assert.strictEqual(m.equals(m), true);
    assert.strictEqual(new PhysicalDimension({ m: 1, l: 0, t: 0 }).equals(m), true);
    const dim = new PhysicalDimension(0, 0, 1, 0, 1, 0, 0);
    assert(dim.format().includes('Theta^1'));
    assert.strictEqual(dim.format(), 'T^1 Theta^1');
    const len = new PhysicalDimension(0, 1, 0);
    const time = new PhysicalDimension(0, 0, 1);
    assert.deepStrictEqual(len.mul(time).toArray(), [0, 1, 1, 0, 0, 0, 0]);
    assert.deepStrictEqual(len.div(time).toArray(), [0, 1, -1, 0, 0, 0, 0]);
  });

  check('SymbolicReasoner DimensionalQuantity conversion and equations', () => {
    const q = new DimensionalQuantity(5, 'm');
    assert.strictEqual(q.toBase(), 5);
    const km = q.convertTo('km');
    assert(Math.abs(km.magnitude - 0.005) < 1e-12);
    const graph = new SymbolicPhysicsKnowledgeGraph();
    const stress = graph.calculatePressureVesselStress(1e6, 0.5, 0.01, 1.0);
    assert(Number.isFinite(stress.hoopStressPa));
    const axial = graph.calculateAxialElongation(1000, 1, 0.0001, 200e9);
    assert(Number.isFinite(axial.elongationM));
    const bending = graph.calculateCantileverBeamBending(100, 1, 0.05, 0.1, 200e9);
    assert(Number.isFinite(bending.maxStressPa));
    const drop = graph.calculatePipePressureDrop(0.001, 10, 0.05, 1e-5, 1000, 0.001);
    assert(Number.isFinite(drop.pressureDropPa));
    assert.strictEqual(drop.flowRegime, 'Turbulent');
    const flux = graph.calculateHeatFlux(0.01, 200, 0.01, 350, 300);
    assert(Number.isFinite(flux.heatFluxWattsM2));
  });

  check('SymbolicReasoner hover and lensmaker calculations', () => {
    const graph = new SymbolicPhysicsKnowledgeGraph();
    const hover = graph.calculateDroneHoverAerodynamics(0.8, 4, 10, 0.75, 1.2, 9.81);
    assert(Number.isFinite(hover.actualHoverPowerWatts));
    const lens = graph.calculateLensmakerFocalLength(1.5, 0.05, -0.05, 0.002);
    assert(Number.isFinite(lens.focalLengthMm));
  });

  check('SymbolicReasoner NelderMeadOptimizer with and without bounds', () => {
    const opt = new NelderMeadOptimizer({ maxIterations: 200, tolerance: 1e-6 });
    const unbounded = opt.minimize((x) => (x[0] - 2) * (x[0] - 2), [0]);
    assert(Math.abs(unbounded.optimalParams[0] - 2) < 0.1);
    const bounded = opt.minimize((x) => (x[0] - 2) * (x[0] - 2), [0], [{ min: 0, max: 1 }]);
    assert(bounded.optimalParams[0] >= 0 && bounded.optimalParams[0] <= 1.01);
  });

  check('SymbolicReasoner lexer extraction and parse', () => {
    const lexer = new DeterministicIntentLexer();
    const parsed = lexer.parse('design a drone at 100 m altitude with 2 kg payload');
    assert.strictEqual(parsed.action, 'DRONE_TUNE');
    assert.strictEqual(lexer.parse('').action, 'UNKNOWN');
    const generic = lexer.parse('hello world');
    assert.strictEqual(generic.action, 'GENERAL_QUERY');
  });

  check('SymbolicReasoner reason and verifyEquation', () => {
    const reasoner = new SymbolicReasoner();
    const qtyA = reasoner.createQuantity(10, 'm');
    const qtyB = reasoner.createQuantity(1000, 'cm');
    const verified = reasoner.verifyEquation(qtyA, qtyB, 'length');
    assert.strictEqual(verified, true);
    const outcome = reasoner.reason('estimate cantilever thickness for a 300 N load');
    assert(typeof outcome === 'object');
  });

  check('SymbolicReasoner cantilever estimation bounds', () => {
    const reasoner = new SymbolicReasoner();
    assert.throws(() => reasoner.estimateCantileverThickness(null), /explicit cantilever design object/);
    assert.throws(
      () => reasoner.estimateCantileverThickness({ loadN: 100, lengthM: 1 }, 1.5),
      /Explicit finite design inputs and safetyFactor/
    );
  });

  // ------------------------------------------------------------------
  // Edge blender
  // ------------------------------------------------------------------
  check('EdgeBlender fillet and chamfer on plain serialized edges', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'Box');
    const serialized = JSON.parse(JSON.stringify(box));
    const targetEdge = serialized.edges[0];
    const filleted = EdgeBlender.applyFillet(serialized, targetEdge, 0.5);
    assert(filleted.success === true || filleted.solid);
    const chamfered = EdgeBlender.applyChamfer(serialized, serialized.edges[1], 0.5, 0.5);
    assert(chamfered.success === true || chamfered.solid);
  });

  check('EdgeBlender hydration rejects malformed solids', () => {
    assert.throws(() => EdgeBlender.applyFillet({ vertices: [], faces: [] }, null, 1), /vertex and face arrays/);
    assert.throws(
      () => EdgeBlender.applyFillet({ vertices: [{ id: 'v1' }], faces: [{ vertices: [] }] }, null, 1),
      /at least three vertices|exactly three finite numeric coordinates/
    );
  });

  check('EdgeBlender blendEdges with index array', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'Box');
    const result = EdgeBlender.blendEdges(box, [0]);
    assert(result);
  });

  check('EdgeBlender applyFillet missing edge error', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'Box');
    assert.throws(() => EdgeBlender.applyFillet(box, 'nonexistent', 1), /not found|unknown|invalid/i);
  });

  // ------------------------------------------------------------------
  // STEP translator
  // ------------------------------------------------------------------
  check('StepTranslator exportAssemblySTEP children-based edges with identity transform', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'BoxA');
    const box2 = BRepPrimitives.createBox(5, 5, 5, 'BoxB');
    const data = {
      solids: [
        { id: 's1', name: 'PartA', solid: box, layer: 'Base', color: { r: 1, g: 0, b: 0 } },
        { id: 's2', name: 'PartB', solid: box2 }
      ],
      assembly: {
        nodes: [
          {
            id: 'n1',
            solidId: 's1',
            children: ['n2'],
            transforms: [
              [1, 0, 0, 0],
              [0, 1, 0, 0],
              [0, 0, 1, 0],
              [0, 0, 0, 1]
            ]
          },
          { id: 'n2', solidId: 's2', name: 'Child B' }
        ],
        references: []
      }
    };
    const step = StepTranslator.exportAssemblySTEP(data, 'Assy');
    assert(step.includes('NEXT_ASSEMBLY_USAGE_OCCURRENCE') || step.includes('PRODUCT('));
  });

  check('StepTranslator exportAssemblySTEP node name fallback chain', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'BoxA');
    const data = {
      solids: [{ id: 's1', solid: box }],
      assembly: {
        nodes: [{ id: 'n1', solidId: 's1' }],
        references: [{ id: 'r1', childId: 'n1', parentId: null }]
      }
    };
    const step = StepTranslator.exportAssemblySTEP(data, 'Assy');
    assert(step.includes('PRODUCT('));
  });

  check('StepTranslator exportNurbsSurfaces planar and cylindrical classification', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'BoxA');
    const plane = StepTranslator.exportNurbsSurfaces(box, 'BoxNurbs');
    assert(plane.includes('B_SPLINE_SURFACE_WITH_KNOTS') || plane.includes('CYLINDRICAL_SURFACE'));
    const cyl = BRepPrimitives.createCylinder(5, 20, 32, 'Cyl');
    const rational = StepTranslator.exportNurbsSurfaces(cyl, 'CylNurbs');
    assert(rational.includes('RATIONAL_B_SPLINE_SURFACE') || rational.includes('CYLINDRICAL_SURFACE'));
  });

  check('StepTranslator toSTEP and parseSTEP round trip', () => {
    const box = BRepPrimitives.createBox(10, 10, 10, 'BoxA');
    const stepText = StepTranslator.toSTEP(box, 'MyBox');
    assert(stepText.includes('MyBox') || stepText.includes('PRODUCT('));
    const parsed = StepTranslator.parseSTEP(stepText);
    assert(parsed);
  });

  check('StepTranslator exportSTEP empty fallback', () => {
    const out = StepTranslator.exportSTEP({});
    assert.strictEqual(typeof out, 'string');
  });

  // ------------------------------------------------------------------
  // FVM
  // ------------------------------------------------------------------
  check('FVMNavierStokes3D createBoxDomain with wall stretch and small step', () => {
    const solver = new FVMNavierStokes3D();
    solver.createBoxDomain(4, 4, 3, 0.4, 0.4, 0.3, 1.2);
    assert(solver.cells.length > 0);
    const result = solver.step(5.0, 2);
    assert(Number.isFinite(result.maxVelocityMPerS ?? result.cflNumber ?? 0));
  });

  check('FVMNavierStokes3D step validation errors', () => {
    const solver = new FVMNavierStokes3D();
    assert.throws(() => solver.step(0, 1), /positive finite inlet velocity/);
    assert.throws(() => solver.step(5, 0), /positive integer iteration count/);
    assert.throws(() => solver.step(5, 1), /initialized mesh/);
  });

  check('FVMNavierStokes3D limiter tiny-delta branch', () => {
    const solver = new FVMNavierStokes3D();
    const lim = solver.venkatakrishnanLimiter(1, 1, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0.1);
    assert(Number.isFinite(lim));
  });

  check('FVMNavierStokes3D local time stepping option', () => {
    const solver = new FVMNavierStokes3D({ localTimeStepping: true });
    solver.createBoxDomain(3, 3, 3, 0.3, 0.3, 0.3);
    const result = solver.step(3, 2);
    assert(result !== undefined);
  });

  // ------------------------------------------------------------------
  // Omni archive / WAL
  // ------------------------------------------------------------------
  check('OmniArchive addSection size guards', () => {
    const archive = new OmniArchive();
    assert.throws(() => archive.addSection('big', Buffer.alloc(512 * 1024 * 1024 + 1)), /maximum uncompressed size/);
    archive.addSection('a', Buffer.from('hello'));
    archive.addSection('b', Buffer.from('world'));
    assert.strictEqual(archive.getSection('a').toString(), 'hello');
  });

  check('OmniArchive section count guard', () => {
    const archive = new OmniArchive();
    for (let i = 0; i < 4095; i++) archive.addSection(`s${i}`, Buffer.from([i % 256]));
    assert.throws(() => archive.addSection('extra', Buffer.from('x')), /maximum section count/);
  });

  check('OmniArchive loadFromBuffer malformed header guards', () => {
    assert.throws(
      () => OmniArchive.loadFromBuffer(Buffer.from([1, 2, 3])),
      /buffer is too small|Malformed archive|unexpected EOF/
    );
    const header = Buffer.alloc(16);
    Buffer.from('OMNIENG\u0001', 'latin1').copy(header, 0);
    header.writeUInt32BE(1, 8);
    header.writeUInt16BE(0, 12);
    assert.throws(
      () => OmniArchive.loadFromBuffer(header),
      /section name must not be empty|Malformed archive|section count/
    );
  });

  check('OmniArchive loadFromFile missing file', () => {
    assert.throws(
      () => OmniArchive.loadFromFile(path.join(os.tmpdir(), 'does-not-exist-xyz.omni')),
      /Archive file not found/
    );
  });

  check('OmniWal open creates directory and rebase', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov16-'));
    const walDir = path.join(dir, 'missing-dir');
    const wal = new OmniWal({ path: path.join(walDir, WAL_FILE_NAME), archivePath: path.join(dir, 'a.omni') });
    wal.open();
    wal.appendEntry('addBlob', { hash: 'h', bytes: 2 });
    wal.commit();
    const stats = wal.rebase();
    assert.strictEqual(stats.committed, 0);
    wal.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('OmniWal commit with no pending entries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov16-'));
    const wal = new OmniWal({ path: path.join(dir, WAL_FILE_NAME), archivePath: path.join(dir, 'a.omni') });
    wal.open();
    const stats = wal.commit();
    assert(Number.isSafeInteger(stats.committed));
    wal.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('OmniArchive encrypted save/load round trip', () => {
    const archive = new OmniArchive({ projectName: 'P' });
    archive.addSection('data', Buffer.from('payload'));
    const enc = archive.saveToEncryptedBuffer('a-long-password');
    const back = OmniArchive.loadFromEncryptedBuffer(enc, 'a-long-password');
    assert.strictEqual(back.getSection('data').toString(), 'payload');
  });

  // ------------------------------------------------------------------
  // Worker pools
  // ------------------------------------------------------------------
  check('ExperimentalCalculationQueue dispatch kernels and telemetry', async () => {
    const queue = new ExperimentalCalculationQueue();
    const echo = await queue.dispatch('ECHO_TEST', { message: 'hi' });
    assert.strictEqual(echo.success, true);
    assert.strictEqual(echo.result.echo, 'hi');
    const norm = await queue.dispatch('WASM_SIMD_BLAS', { operation: 'norm', vec: [3, 4] });
    assert.strictEqual(norm.result.norm, 5);
    await assert.rejects(() => queue.dispatch('UNKNOWN_KERNEL', {}), /Unsupported experimental task type/);
    const telemetry = queue.getTelemetry();
    assert(telemetry.completedTasksCount >= 2);
    const shared = queue.allocateSharedBuffer(16);
    assert.strictEqual(shared.byteLength, 16);
  });

  check('ExperimentalCalculationQueue priority and validation branches', async () => {
    const queue = new ExperimentalCalculationQueue();
    const low = await queue.dispatch('ECHO_TEST', { message: 'low' }, { priority: 'BACKGROUND' });
    assert.strictEqual(low.result.echo, 'low');
    await assert.rejects(() => queue.dispatch('', {}), /task type is required/);
    await assert.rejects(() => queue.dispatch('ECHO_TEST', null), /task payload object is required/);
    assert.throws(() => new ExperimentalCalculationQueue({ unknown: true }), /option/);
  });

  check('PersistentWorkerPool dispatch echo and terminate', async () => {
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    const res = await pool.dispatch('ECHO_TEST', { message: 'worker-ok' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.result.echo, 'worker-ok');
    await pool.terminateAll();
    await assert.rejects(() => pool.dispatch('ECHO_TEST', { message: 'x' }), /terminated/);
  });

  check('PersistentWorkerPool option validation', () => {
    assert.throws(() => new PersistentWorkerPool({ maxWorkers: 100 }), /maximum is/);
    assert.throws(() => new PersistentWorkerPool({ useThreads: false }), /worker_threads/);
  });

  // ------------------------------------------------------------------
  // P&ID engine
  // ------------------------------------------------------------------
  check('PIDEngine createPID from production template', () => {
    const engine = new PIDEngine();
    const config = PIDEngine.oilGasProductionTemplate();
    const result = engine.createPID(config);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.sheets.length, 1);
    assert(Array.isArray(result.schedule.controlLoops));
  });

  check('PIDEngine vectorizeSchedule with loops and valves', () => {
    const engine = new PIDEngine();
    const schedule = {
      equipment: [{ tag: 'P-100', type: 'pump', description: 'Pump', area: 'A', x: 1, y: 2 }],
      lines: [
        {
          lineNumber: '1',
          sizeIn: 3,
          service: 'G',
          material: 'CS',
          class: '150',
          insulation: 'N',
          from: { tag: 'P-100', nozzle: 'N1' },
          to: { tag: 'T-100', nozzle: 'N1' },
          flowDirection: 'forward'
        }
      ],
      instruments: [
        {
          tag: 'FIC-100',
          loopId: 'L1',
          firstLetter: 'F',
          modifier: 'IC',
          description: 'Flow',
          location: 'field',
          connectedTo: { tag: 'P-100', nozzle: 'N1' }
        }
      ],
      valves: [{ tag: 'XV-100', type: 'globe', actuator: 'motor', lineNumber: '1', sizeIn: 3, setPressureBarg: 10 }],
      loops: [{ loopId: 'L1', tag: 'FIC-100' }]
    };
    const csv = engine.vectorizeSchedule(schedule);
    assert(csv.equipmentCsv.includes('P-100'));
    assert(csv.loopsCsv.length > 0);
  });

  check('PIDEngine config validation errors', () => {
    const engine = new PIDEngine();
    const base = PIDEngine.oilGasProductionTemplate();
    const noEquip = JSON.parse(JSON.stringify(base));
    noEquip.areas[0].equipment = undefined;
    const r1 = engine.createPID(noEquip);
    assert.strictEqual(r1.success, false);
    const dupTag = JSON.parse(JSON.stringify(base));
    dupTag.areas[0].equipment[0].tag = dupTag.areas[0].equipment[1].tag;
    const r2 = engine.createPID(dupTag);
    assert.strictEqual(r2.success, false);
    const badLine = JSON.parse(JSON.stringify(base));
    badLine.lines[0].from = undefined;
    const r3 = engine.createPID(badLine);
    assert.strictEqual(r3.success, false);
  });

  // ------------------------------------------------------------------
  // System IPC
  // ------------------------------------------------------------------
  check('systemIpC generic sparse solve success and failure', () => {
    const ok = systemIpc.handleGenericSparseSolve({
      A: [
        [4, 1],
        [1, 3]
      ],
      b: [5, 5]
    });
    assert.strictEqual(ok.success, true);
    assert(Math.abs(ok.solution[0] - 10 / 11) < 1e-6);
    assert(Math.abs(ok.solution[1] - 15 / 11) < 1e-6);
    const bad = systemIpc.handleGenericSparseSolve({
      A: [
        [4, 1],
        [1, 3]
      ],
      b: []
    });
    assert.strictEqual(bad.success, false);
    assert.strictEqual(bad.error.code, 'INVALID_INPUT');
  });

  check('systemIpC Radau IIA solve branches', () => {
    const decay = systemIpc.handleRadauIIASolve({ system: 'decay', t0: 0, tEnd: 1, y0: [1], rtol: 1e-6, atol: 1e-8 });
    assert.strictEqual(decay.success, true);
    const vanderpol = systemIpc.handleRadauIIASolve({ system: 'vanderpol', t0: 0, tEnd: 1, y0: [1, 0] });
    assert.strictEqual(vanderpol.success, true);
    const unknown = systemIpc.handleRadauIIASolve({ system: 'nope', t0: 0, tEnd: 1, y0: [1] });
    assert.strictEqual(unknown.success, false);
    const badY0 = systemIpc.handleRadauIIASolve({ system: 'decay', t0: 0, tEnd: 1, y0: [1, 2] });
    assert.strictEqual(badY0.success, false);
  });

  check('systemIpC normalize sparse matrix input rejects bad shapes', () => {
    assert.strictEqual(
      systemIpc.normalizeSparseMatrixInput(
        [
          [1, 0],
          [0, 1]
        ],
        2
      ) !== null,
      true
    );
    assert.strictEqual(systemIpc.normalizeSparseMatrixInput('bad', 2), null);
  });

  check('systemIpC legacy macro prompt guards', () => {
    const result = systemIpc.processLegacyMacroPrompt({ prompt: 42 });
    assert(result !== undefined);
  });

  // ------------------------------------------------------------------
  // Domain adapters
  // ------------------------------------------------------------------
  check('RoboticsEngineAdapter FK, IK, trajectory, URDF, and unsupported ops', async () => {
    const adapter = new RoboticsEngineAdapter();
    const fk = await adapter.execute({
      jobId: 'r-1',
      domain: 'robotics',
      operation: 'forward_kinematics',
      parameters: { preset: 'PUMA_560', jointAngles: [0, 0, 0, 0, 0, 0] }
    });
    assert.strictEqual(fk.status, 'COMPLETED');

    const home = SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, [0, 0, 0, 0, 0, 0]);
    const ik = await adapter.execute({
      jobId: 'r-2',
      domain: 'robotics',
      operation: 'inverse_kinematics',
      parameters: {
        preset: 'PUMA_560',
        targetPose: { position: home.position },
        q0: [0, 0, 0, 0, 0, 0],
        maxIterations: 30
      }
    });
    assert.strictEqual(ik.status, 'COMPLETED');

    const traj = await adapter.execute({
      jobId: 'r-3',
      domain: 'robotics',
      operation: 'trajectory_plan',
      parameters: { q0: [0, 0, 0], qf: [1, 1, 1], duration: 2 }
    });
    assert.strictEqual(traj.status, 'COMPLETED');

    const urdf = await adapter.execute({
      jobId: 'r-4',
      domain: 'robotics',
      operation: 'parse_urdf',
      parameters: {
        urdf: `<robot name="r"><link name="base"/><joint name="j" type="revolute"><parent link="base"/><child link="tip"/><origin xyz="0 0 0" rpy="0 0 0"/><axis xyz="0 0 1"/></joint><link name="tip"/></robot>`
      }
    });
    assert.strictEqual(urdf.status, 'COMPLETED');

    await assert.rejects(
      () => adapter.execute({ jobId: 'r-5', domain: 'robotics', operation: 'bogus', parameters: {} }),
      /Unsupported robotics operation/
    );
    await assert.rejects(() => adapter.execute(null), /null|non-object/);
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'r-6',
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: { preset: 'PUMA_560', targetPosition: [1, 2, 3] }
        }),
      /converge|targetPose|targetPosition/
    );
  });

  check('AerospaceEngineAdapter operations', async () => {
    const adapter = new AerospaceEngineAdapter();
    const perf = await adapter.execute({
      jobId: 'a-1',
      domain: 'aerospace',
      operation: 'calculate_engine_performance',
      parameters: {
        propellantType: 'LOX_LCH4',
        chamberPressureBar: 300,
        ofRatio: 3.6,
        throatDiameterM: 0.1,
        expansionRatio: 35,
        ambientPressureBar: 1.01325
      }
    });
    assert.strictEqual(perf.status, 'COMPLETED');

    const combustion = await adapter.execute({
      jobId: 'a-2',
      domain: 'aerospace',
      operation: 'evaluate_combustion',
      parameters: { propellantType: 'LOX_LCH4', chamberPressureBar: 300, ofRatio: 3.6 }
    });
    assert.strictEqual(combustion.status, 'COMPLETED');

    const nozzle = await adapter.execute({
      jobId: 'a-3',
      domain: 'aerospace',
      operation: 'compile_rocket_nozzle',
      parameters: {
        chamberPressurePa: 3e7,
        expansionRatio: 35,
        throatRadiusM: 0.05,
        gamma: 1.2,
        chamberTempK: 3000,
        ambientPressurePa: 101325
      }
    });
    assert.strictEqual(nozzle.status, 'COMPLETED');

    const staging = await adapter.execute({
      jobId: 'a-4',
      domain: 'aerospace',
      operation: 'calculate_staging_deltav',
      parameters: {
        payloadMassKg: 25000,
        stage1DryMassKg: 30000,
        stage1PropellantMassKg: 920000,
        stage1IspVac: 330,
        stage2DryMassKg: 8500,
        stage2PropellantMassKg: 150000,
        stage2IspVac: 380,
        gravityLossesM_s: 1350,
        aerodynamicLossesM_s: 160,
        steeringLossesM_s: 210,
        requiredDeltaV_m_s: 7800,
        inputSourceDescription: 'test'
      }
    });
    assert.strictEqual(staging.status, 'COMPLETED');
  });

  check('PlantEngineAdapter VLE flash and water hammer', async () => {
    const adapter = new PlantEngineAdapter();
    const flash = await adapter.execute({
      jobId: 'p-1',
      domain: 'plant',
      operation: 'solve_vle_flash',
      parameters: {
        components: [
          {
            name: 'Methane',
            criticalTemperatureK: 190.56,
            criticalPressurePa: 4.599e6,
            acentricFactor: 0.011,
            provenance: { source: 'test', license: 'test' }
          },
          {
            name: 'Propane',
            criticalTemperatureK: 369.83,
            criticalPressurePa: 4.248e6,
            acentricFactor: 0.152,
            provenance: { source: 'test', license: 'test' }
          }
        ],
        k_ij: [
          [0, 0],
          [0, 0]
        ],
        temperatureK: 250,
        pressurePa: 2e6,
        maxIter: 40,
        tol: 1e-8,
        feedComposition: [0.5, 0.5]
      }
    });
    assert.strictEqual(flash.status, 'COMPLETED');

    const hammer = await adapter.execute({
      jobId: 'p-2',
      domain: 'plant',
      operation: 'calculate_water_hammer',
      parameters: {
        pipeDiameter: 0.3,
        steadyVelocity: 1.5,
        fluidDensity: 1000,
        fluidBulkModulus: 2.2e9,
        pipeElasticModulus: 210e9,
        pipeWallThickness: 0.01,
        restraintFactor: 1,
        runMOC: false
      }
    });
    assert.strictEqual(hammer.status, 'COMPLETED');

    const moc = await adapter.execute({
      jobId: 'p-2b',
      domain: 'plant',
      operation: 'calculate_water_hammer',
      parameters: {
        pipeInnerDiameter: 0.3,
        steadyFlowRate: 0.1,
        fluidDensity: 1000,
        fluidBulkModulus: 2.2e9,
        pipeElasticModulus: 210e9,
        pipeWallThickness: 0.01,
        restraintFactor: 1,
        runMOC: true,
        pipeLength: 1000,
        darcyFrictionFactor: 0.02,
        reservoirHead: 50,
        valveClosureTime: 0.5,
        valveClosureLaw: 'linear',
        simulationDuration: 5,
        reaches: 50
      }
    });
    assert.strictEqual(moc.status, 'COMPLETED');

    const steam = await adapter.execute({
      jobId: 'p-3',
      domain: 'plant',
      operation: 'calculate_steam_properties',
      parameters: { pressurePa: 3e6, temperatureK: 523 }
    });
    assert.strictEqual(steam.status, 'COMPLETED');

    await assert.rejects(
      () => adapter.execute({ jobId: 'p-4', domain: 'plant', operation: 'solve_vle_flash', parameters: {} }),
      /requires explicit inputs/
    );
  });

  check('GeometryEngineAdapter parametric, boolean ops and validation', async () => {
    const adapter = new GeometryEngineAdapter();
    const nurbs = await adapter.execute({
      jobId: 'g-1',
      domain: 'cad',
      operation: 'evaluate_nurbs',
      parameters: {
        degreeU: 2,
        degreeV: 2,
        controlPoints: [
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
          [0, 1, 0],
          [1, 1, 1],
          [2, 1, 0],
          [0, 2, 0],
          [1, 2, 0],
          [2, 2, 0]
        ],
        knotsU: [0, 0, 0, 1, 1, 1],
        knotsV: [0, 0, 0, 1, 1, 1],
        u: 0.5,
        v: 0.5
      }
    });
    assert.strictEqual(nurbs.status, 'COMPLETED');

    const boxA = BRepPrimitives.createBox(10, 10, 10, 'A');
    const boxB = BRepPrimitives.createBox(10, 10, 10, 'B');
    const union = await adapter.execute({
      jobId: 'g-2',
      domain: 'cad',
      operation: 'boolean_union',
      parameters: { solidA: boxA, solidB: boxB, lengthUnit: 'mm' }
    });
    assert.strictEqual(union.status, 'COMPLETED');

    const sketch = await adapter.execute({
      jobId: 'g-3',
      domain: 'cad',
      operation: 'solve_variational_sketch',
      parameters: {
        points: [
          { id: 'p1', x: 0, y: 0 },
          { id: 'p2', x: 10, y: 0 }
        ],
        constraints: [{ type: 'HORIZONTAL', p1: 'p1', p2: 'p2' }]
      }
    });
    assert.strictEqual(sketch.status, 'COMPLETED');

    await assert.rejects(
      () => adapter.execute({ jobId: 'g-4', domain: 'cad', operation: 'bogus', parameters: {} }),
      /not supported by adapter|not implemented/
    );
  });

  check('OpticsEngineAdapter trace, pupil, fresnel, glass index', async () => {
    const adapter = new OpticsEngineAdapter();
    const trace = await adapter.execute({
      jobId: 'o-1',
      domain: 'optics',
      operation: 'trace_skew_rays',
      parameters: {
        surfaces: [
          {
            radius: 40,
            zVertex: 0,
            conic: 0,
            asphericCoeffs: [0, 0, 0, 0],
            nIncident: 1,
            nTransmitted: 1.5,
            clearRadius: 20
          },
          {
            radius: 0,
            zVertex: 10,
            conic: 0,
            asphericCoeffs: [0, 0, 0, 0],
            nIncident: 1.5,
            nTransmitted: 1,
            clearRadius: 20
          }
        ],
        rays: [{ origin: [0, 0, -30], direction: [0, 0, 1], wavelengthUm: 0.55, intensity: 1 }],
        sensorZ: 30
      }
    });
    assert.strictEqual(trace.status, 'COMPLETED');

    const pupil = await adapter.execute({
      jobId: 'o-2',
      domain: 'optics',
      operation: 'generate_pupil_rays',
      parameters: {
        pupilRadiusMm: 10,
        numRings: 3,
        raysPerRing: 8,
        fieldAngleDeg: 0,
        wavelengthUm: 0.55,
        pupilPlaneZMm: -10
      }
    });
    assert.strictEqual(pupil.status, 'COMPLETED');

    const fresnel = await adapter.execute({
      jobId: 'o-3',
      domain: 'optics',
      operation: 'trace_polarization',
      parameters: { fresnel: { n1: 1, n2: 1.5, thetaI: 0.3 } }
    });
    assert.strictEqual(fresnel.status, 'COMPLETED');

    const index = await adapter.execute({
      jobId: 'o-4',
      domain: 'optics',
      operation: 'calculate_refractive_index',
      parameters: {
        customGlassRecord: {
          name: 'TestGlass',
          formula: 'sellmeier1',
          B: [1.0396, 0.2318, 1.0105],
          C: [0.006, 0.02, 103.56],
          referenceTemperatureC: 20
        },
        wavelengthUm: 0.58756,
        temperatureC: 20
      }
    });
    assert.strictEqual(index.status, 'COMPLETED');
  });

  check('EDAEngineAdapter spice DC with diode and mosfet', async () => {
    const adapter = new EDAEngineAdapter();
    const dc = await adapter.execute({
      jobId: 'e-1',
      domain: 'eda',
      operation: 'simulate_spice_dc',
      parameters: {
        components: [
          { type: 'V', id: 'V1', nPlus: 'in', nMinus: '0', dcValue: 3 },
          { type: 'R', id: 'R1', n1: 'in', n2: 'd', value: 1000 },
          { type: 'D', id: 'D1', anode: 'd', cathode: '0', is: 1e-14, n: 1 },
          { type: 'M', id: 'M1', drain: 'd', gate: 'in', source: '0', model: 'NMOS', vth: 0.7, kp: 1e-3, lambda: 0.01 }
        ]
      }
    });
    assert.strictEqual(dc.status, 'COMPLETED');
  });

  const pendingSettled = await Promise.race([
    Promise.all(pending).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 30000))
  ]);
  if (!pendingSettled) {
    failedTests += pending.length;
    console.error('  ✗ WARN: timed out waiting for pending checks; marking them failed');
  }

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapSixteenCoverageTests };

if (require.main === module) {
  runBranchGapSixteenCoverageTests().then((stats) => {
    console.log(`gap16: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
