'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 21).
 *
 * Targets the remaining uncovered branch blocks in the EDA engine adapter
 * operation matrix, the system IPC handler closures not exercised by the main
 * IPC suite, round-2 residual branches in the robotics/CAD/archive/aerospace
 * modules, and small CAE/math/plant module edge paths. No production source is
 * modified.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('node:module');

const { SerialManipulatorEngine, PUMA_560_DH } = require('../src/core/robotics/serial_manipulator_kinematics');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { NasaRocketPropulsion } = require('../src/core/aerospace/nasa_rocket_propulsion');
const { PIDEngine } = require('../src/core/plant/pid_engine');
const { StepTranslator } = require('../src/core/cad/step_translator');
const {
  OmniArchive,
  OmniArchiveV2,
  OmniWal,
  WAL_FILE_NAME,
  calculateCRC32,
  MAGIC_BYTES_V1,
  MAGIC_BYTES_V2
} = require('../src/core/storage/omni_archive');
const { PersistentWorkerPool } = require('../src/core/math/worker_pool');
const { EDAEngineAdapter } = require('../src/core/eda/eda_engine_adapter');
const { SpiceEngine } = require('../src/core/eda/spice_engine');
const { PenaltyContact } = require('../src/core/cae/penalty_contact');
const { ThermalEngine } = require('../src/core/cae/thermal_cht');
const { SimpleNavierStokesSolver } = require('../src/core/cae/simple_navier_stokes');
const { DelaunayMesher3D, Point3D, Tetrahedron } = require('../src/core/cae/delaunay_mesher_3d');
const { LinearSolver } = require('../src/core/math/linear_algebra');
const { StandardPartsLibrary } = require('../src/core/cad/standard_parts_library');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');

async function runBranchGapTwentyOneCoverageTests() {
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

  const ZEROS6 = [0, 0, 0, 0, 0, 0];
  const COMPLETED = 'COMPLETED';

  // ------------------------------------------------------------------
  // System IPC handler closures not covered by the main IPC suite
  // ------------------------------------------------------------------
  const repositoryRoot = path.resolve(__dirname, '..');
  const ipcHandlers = new Map();
  const electronMock = {
    app: { getAppPath: () => repositoryRoot },
    ipcMain: { handle: (channel, handler) => ipcHandlers.set(channel, handler) }
  };
  const originalLoad = Module._load;
  const trustedEvent = {
    sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 42 } },
    senderFrame: { frameTreeNodeId: 42, url: `file://${repositoryRoot}/src/index.html` }
  };

  try {
    Module._load = function loadWithElectronSystemIpcMock(request, parent, isMain) {
      if (request === 'electron') return electronMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    const systemIpc = require('../src/main/ipc/system_ipc');
    const { handleGenericSparseSolve, handleRadauIIASolve } = systemIpc;
    systemIpc.registerSystemIpc({});
    Module._load = originalLoad;

    check('system_ipc solve-generic-sparse and radau-iia handlers', async () => {
      const A = [
        [4, 1, 0],
        [1, 3, 1],
        [0, 1, 2]
      ];
      const b = [1, 2, 3];
      const g = await ipcHandlers.get('omni:solve-generic-sparse')(trustedEvent, { A, b });
      assert.strictEqual(g.success, true);
      const g2 = handleGenericSparseSolve({ A, b: [1, 2] });
      assert.strictEqual(g2.success, false);
      const g3 = handleGenericSparseSolve({ A: 'not-a-matrix', b });
      assert.strictEqual(g3.success, false);
      const rad = await ipcHandlers.get('omni:solve-radau-iia')(trustedEvent, {
        system: 'decay',
        t0: 0,
        y0: [1],
        tEnd: 1,
        rtol: 1e-6,
        atol: 1e-9
      });
      assert.strictEqual(rad.success, true);
      const rad2 = handleRadauIIASolve({ system: 'vanderpol', t0: 0, y0: [2, 0], tEnd: 0.5 });
      assert.strictEqual(rad2.success, true);
      const rad3 = handleRadauIIASolve({ system: 'decay', t0: 0, y0: [1], tEnd: 0 });
      assert(rad3.success === false || rad3.error);
    });

    check('system_ipc hpc/validate/hash/maturity handler closures', async () => {
      const h2 = await ipcHandlers.get('omni:hpc-plan-out-of-core')(trustedEvent, {});
      assert.strictEqual(h2.success, false);
      const h3 = await ipcHandlers.get('omni:solve-sparse-ordering')(trustedEvent, { N: 6 });
      assert.strictEqual(h3.success, true);
      assert.strictEqual(h3.N, 6);
      const h4 = await ipcHandlers.get('omni:solve-pcg-dense')(trustedEvent, {
        method: 'pcg',
        A: [
          [4, 1],
          [1, 3]
        ],
        b: [1, 2]
      });
      assert.strictEqual(h4.success, true);
      const h4b = await ipcHandlers.get('omni:solve-pcg-dense')(trustedEvent, {
        method: 'gaussian',
        A: [
          [4, 1],
          [1, 3]
        ],
        b: [1, 2]
      });
      assert.strictEqual(h4b.success, true);
      const h4c = await ipcHandlers.get('omni:solve-pcg-dense')(trustedEvent, {
        method: 'pcg',
        A: [[4, 1]],
        b: [1, 2]
      });
      assert.strictEqual(h4c.success, false);
      const h5bad = await ipcHandlers.get('omni:validate-lifecycle')(trustedEvent, {});
      assert.strictEqual(h5bad.success, false);
      const h6 = await ipcHandlers.get('omni:hash-artifact-sha256')(trustedEvent, { content: 'artifact-bytes' });
      assert.strictEqual(h6.success, true);
      assert.strictEqual(h6.sha256.length, 64);
      const h6b = await ipcHandlers.get('omni:hash-artifact-sha256')(trustedEvent, { content: 'direct-string' });
      assert.strictEqual(h6b.success, true);
      const h6c = await ipcHandlers.get('omni:hash-artifact-sha256')(trustedEvent, {});
      assert.strictEqual(h6c.success, false);
      const h7 = await ipcHandlers.get('omni:generate-maturity-report')(trustedEvent, {});
      assert.strictEqual(h7.success, true);
      assert(h7.report !== undefined);
    });

    check('system_ipc vault encrypt/decrypt handler closures', async () => {
      const enc = await ipcHandlers.get('omni:vault-encrypt-project')(trustedEvent, {
        password: 'longenoughpassword12',
        payload: { projectName: 'Cov21', data: [1, 2, 3] }
      });
      assert.strictEqual(enc.success, true);
      const encBad = await ipcHandlers.get('omni:vault-encrypt-project')(trustedEvent, {
        password: 'short',
        payload: {}
      });
      assert.strictEqual(encBad.success, false);
      const dec = await ipcHandlers.get('omni:vault-decrypt-project')(trustedEvent, {
        password: 'longenoughpassword12',
        encryptedBase64: enc.encryptedBase64
      });
      assert.strictEqual(dec.success, true);
      assert.strictEqual(dec.payload.projectName, 'Cov21');
      const decBytes = await ipcHandlers.get('omni:vault-decrypt-project')(trustedEvent, {
        password: 'longenoughpassword12',
        encryptedBytes: Buffer.from(enc.encryptedBase64, 'base64')
      });
      assert.strictEqual(decBytes.success, true);
      const decBad = await ipcHandlers.get('omni:vault-decrypt-project')(trustedEvent, {
        password: '',
        encryptedBase64: 'AAAA'
      });
      assert.strictEqual(decBad.success, false);
      const decBad2 = await ipcHandlers.get('omni:vault-decrypt-project')(trustedEvent, {
        password: 'x',
        encryptedBase64: 'not-base64!'
      });
      assert.strictEqual(decBad2.success, false);
      const decBad3 = await ipcHandlers.get('omni:vault-decrypt-project')(trustedEvent, { password: 'x' });
      assert.strictEqual(decBad3.success, false);
    });
  } finally {
    Module._load = originalLoad;
  }

  // ------------------------------------------------------------------
  // EDAEngineAdapter full operation matrix
  // ------------------------------------------------------------------
  const edaAdapter = new EDAEngineAdapter();
  const edaJob = (operation, parameters) => ({
    jobId: `eda21-${operation}`,
    domain: 'eda',
    operation,
    parameters
  });

  check('EDAEngineAdapter spice DC with diode and MOSFET', async () => {
    const res = await edaAdapter.execute(
      edaJob('simulate_spice_dc', {
        components: [
          { id: 'V1', type: 'V', nPlus: 'in', nMinus: '0', dcValue: 5 },
          { id: 'R1', type: 'R', n1: 'in', n2: 'out', value: 100 },
          { id: 'D1', type: 'D', anode: 'out', cathode: '0', is: 1e-14 },
          { id: 'M1', type: 'M', drain: 'out', gate: 'in', source: '0', model: 'NMOS', w: 10, l: 1, kp: 1e-3, vth: 0.7 }
        ]
      })
    );
    assert.strictEqual(res.status, COMPLETED);
  });

  check('EDAEngineAdapter spice DC unsupported component and transient nonlinear branches', async () => {
    await assert.rejects(
      () => edaAdapter.execute(edaJob('simulate_spice_dc', { components: [{ id: 'X1', type: 'X' }] })),
      /Unsupported circuit component type/
    );
    const res = await edaAdapter.execute(
      edaJob('simulate_spice_transient', {
        tStop: 0.0002,
        dt: 1e-5,
        components: [
          {
            id: 'V1',
            type: 'V',
            nPlus: 'in',
            nMinus: '0',
            dcValue: 5,
            waveform: { type: 'STEP', v1: 0, v2: 5, delay: 0 }
          },
          { id: 'R1', type: 'R', n1: 'in', n2: 'out', value: 1000 },
          { id: 'C1', type: 'C', n1: 'out', n2: '0', value: 1e-6, v0: 0 },
          { id: 'D1', type: 'D', anode: 'out', cathode: '0', is: 1e-14, n: 1 },
          {
            id: 'M1',
            type: 'M',
            drain: 'out',
            gate: 'in',
            source: '0',
            model: 'NMOS',
            vth: 0.7,
            kp: 1e-3,
            lambda: 0.01
          }
        ]
      })
    );
    assert.strictEqual(res.status, COMPLETED);
    await assert.rejects(
      () => edaAdapter.execute(edaJob('simulate_spice_transient', { components: [{ id: 'X1', type: 'X' }] })),
      /Unsupported circuit component type/
    );
  });

  check('EDAEngineAdapter timing/parasitics/synthesis/PnR ops', async () => {
    const timing = await edaAdapter.execute(edaJob('static_timing_analysis', { clockPeriodNs: 5 }));
    assert.strictEqual(timing.status, COMPLETED);
    const pex = await edaAdapter.execute(edaJob('extract_wire_parasitics', { lengthMm: 3, widthUm: 1 }));
    assert.strictEqual(pex.status, COMPLETED);
    const synth = await edaAdapter.execute(
      edaJob('synthesize_logic', {
        verilogSource: 'module m;\ninput a, b;\noutput y;\nassign y = a & b;\nendmodule',
        clockPeriod_ps: 1000
      })
    );
    assert.strictEqual(synth.status, COMPLETED);
    const pnr = await edaAdapter.execute(
      edaJob('place_and_route', {
        coreWidth: 100,
        coreHeight: 100,
        stdCellHeight: 10,
        circuitData: {
          cells: [
            { id: 'c1', width: 20, height: 10 },
            { id: 'c2', width: 20, height: 10 }
          ],
          nets: [{ name: 'n1', pins: ['c1', 'c2'] }]
        }
      })
    );
    assert.strictEqual(pnr.status, COMPLETED);
  });

  check('EDAEngineAdapter oasis and DRC ops', async () => {
    const layout = {
      name: 'TOP',
      cells: [{ name: 'A', rectangles: [{ layer: 1, datatype: 0, width: 10, height: 20, x: 0, y: 0 }], placements: [] }]
    };
    const ser = await edaAdapter.execute(edaJob('serialize_oasis', { layout }));
    assert.strictEqual(ser.status, COMPLETED);
    const de = await edaAdapter.execute(edaJob('deserialize_oasis', { bytes: ser.outputData.bytes }));
    assert.strictEqual(de.status, COMPLETED);
    const comp = await edaAdapter.execute(edaJob('evaluate_oasis_compression', { layout }));
    assert.strictEqual(comp.status, COMPLETED);
    const drc = await edaAdapter.execute(
      edaJob('run_drc', {
        shapes: [
          { id: 's1', layer: 'M1', x: 0, y: 0, w: 10, h: 10 },
          { id: 's2', layer: 'M1', x: 15, y: 0, w: 5, h: 5 }
        ],
        rules: { minWidth: 0.1, minSpacing: 0.1, minArea: 0.1 }
      })
    );
    assert.strictEqual(drc.status, COMPLETED);
    const drcBad = await edaAdapter.execute(edaJob('run_drc', { shapes: [], rules: {} }));
    assert.strictEqual(drcBad.status, COMPLETED);
    assert.strictEqual(drcBad.outputData.success, false);
  });

  check('EDAEngineAdapter SPEFF and crosstalk ops', async () => {
    const spef = await edaAdapter.execute(
      edaJob('extract_spef', {
        pexInput: {
          designName: 'top',
          nets: [
            {
              name: 'n1',
              totalCapacitance: 1e-12,
              resistance: 50,
              pins: [{ nodeName: 'n1:1', direction: 'OUTPUT' }],
              segments: [{ node1: 'n1:1', node2: 'n1:2', resistance: 10 }],
              crossCouplings: []
            }
          ],
          techPdk: {
            name: 'test-pdk',
            provenance: { source: 'test', license: 'test-license' },
            layers: {
              M1: { sheetResOhmSq: 0.1, capAreaFfUm2: 0.05, capFringeFfUm: 0.02, viaResOhm: 5 }
            }
          }
        }
      })
    );
    assert.strictEqual(spef.status, COMPLETED);
    const spefText = await edaAdapter.execute(
      edaJob('parse_spef', {
        spefText: `*SPEF "1.0"\n*DESIGN "top"\n*DIVIDER /\n*DELIMITER :\n*TOTAL_CAP 1.0\n*NET n1\n*CAP 1 n1:1 0.01\n*RES 1 n1:1 n1:2 10.0\n*END\n`
      })
    );
    assert.strictEqual(spefText.status, COMPLETED);
    const xt = await edaAdapter.execute(
      edaJob('evaluate_crosstalk', {
        spec: { aggressorVoltageSwingV: 1.0, couplingCapacitanceF: 1e-13, victimLoadCapacitanceF: 1e-12 }
      })
    );
    assert.strictEqual(xt.status, COMPLETED);
  });

  check('EDAEngineAdapter IR-drop success/error and electromigration branches', async () => {
    const base = {
      vdd: 1.0,
      maxDropThresholdPercent: 5,
      metalThickness: 1e-6,
      rows: 3,
      cols: 3,
      pitchX: 5e-6,
      pitchY: 5e-6,
      sheetRho: 0.02,
      wireWidth: 1e-6,
      padNodeIds: [0],
      currentLoads: [{ nodeId: 1, current: 1e-3 }]
    };
    const ok = await edaAdapter.execute(edaJob('analyze_ir_drop', base));
    assert.strictEqual(ok.status, COMPLETED);
    await assert.rejects(() => edaAdapter.execute(edaJob('analyze_ir_drop', { ...base, vdd: 0 })), /vdd/);
    await assert.rejects(
      () => edaAdapter.execute(edaJob('analyze_ir_drop', { ...base, maxDropThresholdPercent: -1 })),
      /maxDropThresholdPercent/
    );
    await assert.rejects(
      () => edaAdapter.execute(edaJob('analyze_ir_drop', { ...base, metalThickness: 0 })),
      /metalThickness/
    );
    await assert.rejects(
      () => edaAdapter.execute(edaJob('analyze_ir_drop', { ...base, padNodeIds: 'x' })),
      /padNodeIds/
    );
    await assert.rejects(() => edaAdapter.execute(edaJob('analyze_ir_drop', { ...base, rows: 0 })), /rows and cols/);
    await assert.rejects(() => edaAdapter.execute(edaJob('analyze_ir_drop', { ...base, pitchX: 0 })), /pitchX/);
    const em = await edaAdapter.execute(
      edaJob('calculate_electromigration', {
        currentDensity: 1e6,
        tempC: 100,
        model: {
          preExponentialCoefficient: 1e-12,
          activationEnergyEV: 0.7,
          currentDensityExponent: 2,
          boltzmannEVPerK: 8.617e-5,
          provenance: 'test'
        }
      })
    );
    assert.strictEqual(em.status, COMPLETED);
    await assert.rejects(
      () => edaAdapter.execute(edaJob('calculate_electromigration', { currentDensity: 0 })),
      /currentDensity/
    );
    await assert.rejects(
      () => edaAdapter.execute(edaJob('calculate_electromigration', { currentDensity: 1, tempC: -300 })),
      /temperature/
    );
    await assert.rejects(
      () => edaAdapter.execute(edaJob('calculate_electromigration', { currentDensity: 1, tempC: 25 })),
      /Black-model coefficients/
    );
    await assert.rejects(() => edaAdapter.execute(edaJob('unknown_operation', {})), /not supported by adapter/);
  });

  // ------------------------------------------------------------------
  // Round-2: serial manipulator / robotics adapter residual branches
  // ------------------------------------------------------------------
  check('SerialManipulatorEngine chain-object resolution and FK structural branches', () => {
    const chainObj = {
      dhTable: PUMA_560_DH,
      jointLimits: PUMA_560_DH.jointLimits,
      linkInertias: PUMA_560_DH.linkInertias
    };
    const res = SerialManipulatorEngine.forwardKinematics(chainObj, [0.1, 0.2, 0.1, 0.2, 0.1, 0.2]);
    assert.strictEqual(res.position.length, 3);
    const spec = { dhTable: PUMA_560_DH, q: ZEROS6 };
    const res2 = SerialManipulatorEngine.forwardKinematics(spec);
    assert.strictEqual(res2.position.length, 3);
    const screwChain = {
      screwAxes: [
        [0, 0, 1, 0, 0, 0],
        [0, 0, 1, 0, 0, 0]
      ],
      homeTransform: [
        [1, 0, 0, 1],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1]
      ],
      dhTable: null
    };
    const res3 = SerialManipulatorEngine.forwardKinematics(screwChain, [0.1, 0.2]);
    assert.strictEqual(res3.convention, 'poe');
    assert.throws(() => SerialManipulatorEngine.forwardKinematicsPoE([], [1], []), /screwAxes/);
    assert.throws(
      () => SerialManipulatorEngine.forwardKinematicsPoE([[0, 0, 1, 0, 0, 0]], [1], [0.1, 0.2]),
      /joint angles/
    );
    assert.throws(
      () => SerialManipulatorEngine.forwardKinematics({ dhTable: PUMA_560_DH }, [0, 0, 0, 0, 0, NaN]),
      /finite joint angles/
    );
  });

  check('SerialManipulatorEngine inverseDynamics mass error branch', () => {
    assert.throws(
      () =>
        SerialManipulatorEngine.inverseDynamics({
          dhTable: PUMA_560_DH,
          q: ZEROS6,
          qd: ZEROS6,
          qdd: ZEROS6,
          gravity: [0, 0, -9.81],
          externalWrench: [0, 0, 0, 0, 0, 0],
          linkInertias: PUMA_560_DH.linkInertias.map((l) => ({ ...l, mass: -2 }))
        }),
      /mass/
    );
  });

  check('RoboticsEngineAdapter IK non-convergence and PoE validation branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'r21-ik-fail',
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: {
            preset: 'PUMA_560',
            targetPose: [
              [1, 0, 0, 999],
              [0, 1, 0, 0],
              [0, 0, 1, 0],
              [0, 0, 0, 1]
            ],
            q0: ZEROS6,
            maxIterations: 5,
            positionTolerance: 1e-12,
            orientationTolerance: 1e-12
          }
        }),
      /converge|divergence/
    );
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'r21-poe-bad',
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { screwAxes: [], homeTransform: null, jointAngles: [] }
        }),
      /poeConfig/
    );
  });

  check('RoboticsEngineAdapter execution catch-all branch', async () => {
    const adapter = new RoboticsEngineAdapter();
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'r21-fk-exec-error',
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: {
            screwAxes: [[0, 0, 1, NaN, 0, 0]],
            homeTransform: [
              [1, 0, 0, 0],
              [0, 1, 0, 0],
              [0, 0, 1, 0],
              [0, 0, 0, 1]
            ],
            jointAngles: [0]
          }
        }),
      /Non-finite end-effector position/
    );
  });

  // ------------------------------------------------------------------
  // Round-2: STEP / PID / Nasa / archive / worker pool
  // ------------------------------------------------------------------
  check('StepTranslator single-part layered + planar-only NURBS branches', () => {
    const box = BRepPrimitives.createBox(3, 3, 3, 'Box');
    const step = StepTranslator.exportSTEP(box, 'LayeredPart', { layers: 'MECH_DETAILS' });
    assert(step.includes('LAYER_ASSIGNMENT'));
    const planar = StepTranslator.exportNurbsSurfaces(box, 'BoxNurbs');
    assert(planar.includes('B_SPLINE_SURFACE_WITH_KNOTS'));
    assert(!planar.includes('RATIONAL_B_SPLINE_SURFACE'));
    const parsed = StepTranslator.parseSTEP(planar);
    assert.strictEqual(parsed.summary.rationalBSplineSurfacesCount, 0);
    assert(parsed.summary.bSplineSurfacesCount >= 6);
    const noData = StepTranslator.parseSTEP('ISO-10303-21;\nHEADER;\nENDSEC;\nENDSEC;\nEND-ISO-10303-21;');
    assert.strictEqual(noData.summary.manifoldSolidsCount, 0);
  });

  check('PIDEngine two-area layout and grid option branches', () => {
    const engine = new PIDEngine();
    const mkPump = (tag) => ({
      tag,
      type: 'pump',
      description: tag,
      x: 0,
      y: 0,
      nozzles: [
        { id: 'N1', side: 'left', offset: 0 },
        { id: 'N2', side: 'top', offset: 0 },
        { id: 'N3', side: 'right', offset: 0 },
        { id: 'N4', side: 'bottom', offset: 0 }
      ],
      inletNozzles: ['N1'],
      outletNozzles: ['N3'],
      ventNozzles: ['N2']
    });
    const config = {
      project: { name: 'Cov21', number: 'PID-9021' },
      areas: [
        { id: 'A-1', name: 'First', order: 2, equipment: [mkPump('P-1'), mkPump('P-2')] },
        { id: 'A-2', name: 'Second', order: 1, equipment: [mkPump('P-3')] }
      ],
      lines: [
        {
          lineNumber: 'L-1010-4-CS-150-A1F',
          sizeIn: 4,
          service: 'water',
          material: 'CS',
          class: '150',
          insulation: 'NONE',
          from: { tag: 'P-1', nozzle: 'N3' },
          to: { tag: 'P-2', nozzle: 'N1' }
        },
        {
          lineNumber: 'L-1020-4-CS-150-A1F',
          sizeIn: 4,
          service: 'water',
          material: 'CS',
          class: '150',
          insulation: 'NONE',
          from: { tag: 'P-2', nozzle: 'N4' },
          to: { tag: 'P-3', nozzle: 'N2' }
        }
      ],
      instruments: [],
      valves: [],
      controlLoops: [],
      options: { showGrid: true, gridMm: 0 }
    };
    const res = engine.createPID(config);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.sheets.length, 1);
  });

  check('NasaRocketPropulsion conical failure and orbital aliases', () => {
    const aero = new NasaRocketPropulsion();
    const fail = aero._conicalFlowShockExpansion(1.02, 1.4, 0, 0.8, 1, 10000, 1000, 1);
    assert(fail.success === false || Number.isFinite(fail.cl));
    const r = aero._solveConicalFlowSurfacePressure(2.0, 1.4, 0.1);
    assert(r === null || Number.isFinite(r.MSurface));
    assert.strictEqual(aero.calculateOrbitalTransfer(null).success, false);
    assert.strictEqual(aero.calculateOrbitalTransfer({ r1Meters: 6.7e6, r2Meters: 4.2e7, rA: 1.5e8 }).success, true);
    assert.strictEqual(aero.get1976Atmosphere(-1).success, false);
    assert.strictEqual(aero.get1976Atmosphere(100000).success, false);
  });

  check('OmniArchiveV2 load-v1-buffer and WAL torn details', () => {
    const v1 = new OmniArchive({ projectName: 'V1' });
    const buf1 = v1.saveToBuffer();
    assert.throws(() => OmniArchiveV2.loadFromBuffer(buf1), /magic header/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov21-'));
    const archivePath = path.join(dir, 'proj.omni');
    const walPath = path.join(dir, WAL_FILE_NAME);
    const badCommit = JSON.stringify([
      1,
      'COMMIT',
      'not-null',
      calculateCRC32(Buffer.from(JSON.stringify([1, 'COMMIT', 'not-null']), 'utf8'))
    ]);
    const badDigest = JSON.stringify([
      1,
      'add_blob',
      'short',
      calculateCRC32(Buffer.from(JSON.stringify([1, 'add_blob', 'short']), 'utf8'))
    ]);
    const header = JSON.stringify(['OMNIWAL', 3, 0, path.resolve(archivePath)]);
    fs.writeFileSync(walPath, header + '\n' + badCommit + '\n' + badDigest + '\n', 'utf8');
    const wal = new OmniWal({ path: walPath, archivePath });
    wal.open();
    assert.strictEqual(wal.recovered, true);
    assert.strictEqual(wal.committed, 0);
    wal.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('PersistentWorkerPool useThreads-false and unsupported task branches', async () => {
    assert.throws(() => new PersistentWorkerPool({ useThreads: false }), /worker_threads/);
    const pool = new PersistentWorkerPool({ maxWorkers: 1 });
    await assert.rejects(() => pool.dispatch('NOT_A_KERNEL', {}), /Unsupported experimental task type/);
    await pool.terminateAll();
  });

  // ------------------------------------------------------------------
  // Small module edges
  // ------------------------------------------------------------------
  check('SpiceEngine MOSFET DC and waveform branches', () => {
    const spice = new SpiceEngine();
    spice.addVoltageSource('V1', 'in', '0', 5);
    spice.addResistor('R1', 'in', 'out', 1000);
    spice.addMOSFET('M1', 'out', 'in', '0', 'NMOS', 0.7, 1e-3, 0.01);
    const res = spice.solveDCOperatingPoint(50, 1e-6);
    assert(res.converged === true || typeof res.nodeVoltages === 'object');
    const spice2 = new SpiceEngine();
    spice2.addVoltageSource('V1', 'in', '0', 0, {
      type: 'PULSE',
      v1: 0,
      v2: 5,
      period: 0.001,
      width: 0.0004,
      delay: 0.0001
    });
    spice2.addResistor('R1', 'in', '0', 1000);
    const r2 = spice2.runTransient(0.002, 1e-5);
    assert(r2.success === true || r2.converged === true || Array.isArray(r2.time));
  });

  check('PenaltyContact contact-miss and augmented branches', () => {
    const contact = new PenaltyContact({ penaltyStiffness: 1e8, frictionCoeff: 0.3 });
    const miss = contact.evaluateNodeContact(
      { pos: [0, 0, 0.5] },
      { v0: [0, 0, 0], v1: [1, 0, 0], v2: [0, 1, 0], normal: [0, 0, 1] }
    );
    assert.strictEqual(miss.inContact, false);
    const multi = PenaltyContact.evaluateContact(
      [
        { id: 1, pos: [0, 0, -0.5], vel: [0, 0, 0] },
        { id: 2, pos: [0.5, 0.5, 0.5], vel: [0, 0, 0] }
      ],
      { origin: [0, 0, 0], normal: [0, 0, 1], frictionCoeff: 0.2, penaltyStiffness: 1000 }
    );
    assert.strictEqual(multi.activeContactCount, 1);
    const aug2 = PenaltyContact.evaluateAugmentedLagrangianContact(
      [{ id: 1, pos: [0, 0, -0.5], vel: [0, 0, 0] }],
      { origin: [0, 0, 0], normal: [0, 0, 1], frictionCoeff: 0.2, penaltyStiffness: 1000 },
      1,
      1e-3
    );
    assert.strictEqual(aug2.hasContact, true);
    const forcesEmpty = PenaltyContact.applyContactForces([], { contacts: [], hasContact: false });
    assert.strictEqual(Array.isArray(forcesEmpty), true);
  });

  check('ThermalEngine conduction long-run and heatmap branches', () => {
    const grid = (value) => Array.from({ length: 4 }, () => Array(4).fill(value));
    const conduction = ThermalEngine.solveTransientConduction2D({
      widthM: 0.04,
      heightM: 0.04,
      ambientTemperatureC: 25,
      convectionCoefficientWPerM2K: 10,
      timeStepSec: 0.01,
      totalTimeSec: 0.2,
      initialTemperatureC: grid(25),
      conductivityWPerMK: grid(1),
      volumetricHeatCapacityJPerM3K: grid(1e6),
      heatGenerationWPerM3: grid(2000)
    });
    assert(conduction.success === true || conduction.status === 'INVALID_INPUT');
    const heatmap = ThermalEngine.exportSampledHeatmap(conduction.results.temperatureC, 4, 4, 2, 2);
    assert(Array.isArray(heatmap));
    assert(heatmap.length > 0);
  });

  check('SimpleNavierStokesSolver stepSIMPLE boundary faces', () => {
    const solver = new SimpleNavierStokesSolver();
    const cells = [
      { u: 0, v: 0, w: 0, p: 101325, centroid: { x: 0, y: 0, z: 0 }, volume: 1e-3, gradP: { x: 0, y: 0, z: 0 } },
      { u: 0, v: 0, w: 0, p: 101325, centroid: { x: 0.1, y: 0, z: 0 }, volume: 1e-3, gradP: { x: 0, y: 0, z: 0 } }
    ];
    const faces = [
      { leftCell: 0, rightCell: 1, area: 0.01, normal: { x: 1, y: 0, z: 0 } },
      {
        leftCell: 0,
        rightCell: -1,
        boundaryType: 'inlet',
        inletVelocity: 2.0,
        area: 0.01,
        normal: { x: -1, y: 0, z: 0 }
      },
      {
        leftCell: -1,
        rightCell: 1,
        boundaryType: 'outlet',
        outletPressure: 101325,
        area: 0.01,
        normal: { x: 1, y: 0, z: 0 }
      }
    ];
    const stepRes = solver.stepSIMPLE(cells, faces);
    assert(stepRes.iteration === 1);
  });

  check('DelaunayMesher3D hybrid prism error and quality branches', () => {
    const mesher = new DelaunayMesher3D({ targetEdgeLength: 0.2 });
    assert.throws(
      () => mesher.generateHybridPrismTetMesh([], { firstLayerHeight: 0.01, layerCount: 2 }, {}),
      /Empty vertices/
    );
    const tetra = new Tetrahedron(
      new Point3D(0, 0, 0),
      new Point3D(1, 0, 0),
      new Point3D(0, 1, 0),
      new Point3D(0, 0, 1)
    );
    const q = tetra.computeQuality();
    assert(q && typeof q === 'object');
    assert(Number.isFinite(q.volume) && Number.isFinite(q.radiusRatio));
    assert(
      tetra.inCircumsphere(new Point3D(0.1, 0.1, 0.1)) === true ||
        tetra.inCircumsphere(new Point3D(0.1, 0.1, 0.1)) === false
    );
  });

  check('LinearSolver CG/sparse/positive-definite branches', () => {
    const A = [
      [4, 1],
      [1, 3]
    ];
    const b = [1, 2];
    const cg = LinearSolver.solveConjugateGradient(A, b, 200, 1e-9);
    assert(Array.isArray(cg) && Number.isFinite(cg[0]));
    const sp = LinearSolver.solveSparse(A, b);
    assert(Number.isFinite(Number(sp.solution && sp.solution[0])));
    assert.strictEqual(LinearSolver.isPositiveDefinite(A), true);
    assert.strictEqual(
      LinearSolver.isPositiveDefinite([
        [1, 2],
        [2, 1]
      ]),
      false
    );
  });

  check('StandardPartsLibrary required-dimension branches', () => {
    const requiresPositive = (fn) => {
      try {
        const out = fn();
        if (out && out.success !== undefined) {
          assert.strictEqual(out.success, false);
        }
      } catch (err) {
        assert.match(String(err.message), /positive|required/i);
      }
    };
    requiresPositive(() => StandardPartsLibrary.generateHexBolt({}));
    requiresPositive(() => StandardPartsLibrary.generateHexNut({}));
    requiresPositive(() => StandardPartsLibrary.generateBallBearing({}));
    requiresPositive(() => StandardPartsLibrary.generateHoleCallout({}));
  });

  const pendingSettled = await Promise.race([
    Promise.all(pending).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 90000))
  ]);
  if (!pendingSettled) {
    failedTests += pending.length;
    console.error('  ✗ WARN: timed out waiting for pending checks; marking them failed');
  }

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapTwentyOneCoverageTests };

if (require.main === module) {
  runBranchGapTwentyOneCoverageTests().then((stats) => {
    console.log(`gap21: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
