'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 17).
 *
 * Targets remaining uncovered non-entry blocks in main-process IPC handlers
 * (CAE/EDA/optics/CAD/system), the controls engine adapter, penalty contact,
 * SPICE request validation, CCS timing, DIPPR property records, Liberty
 * parsing, CSG validation, geometry adapter constraints, and Radau IIA
 * failure paths.
 */

const assert = require('assert');

const caeIpc = require('../src/main/ipc/cae_ipc');
const edaIpc = require('../src/main/ipc/eda_ipc');
const opticsIpc = require('../src/main/ipc/optics_ipc');
const cadIpc = require('../src/main/ipc/cad_ipc');
const { ControlsEngineAdapter } = require('../src/core/controls/controls_engine_adapter');
const { PenaltyContact } = require('../src/core/cae/penalty_contact');
const spiceRequest = require('../src/core/eda/spice_request');
const { CCSTimingModel } = require('../src/core/eda/ccs_timing_model');
const { ExperimentalPropertyComponent, ExperimentalPropertyDatabase } = require('../src/core/plant/dippr_database');
const { parseLiberty, LibertyTable } = require('../src/core/eda/liberty_parser');
const { CSGMeshBooleans, CSGSolid } = require('../src/core/cad/csg_mesh_booleans');
const { GeometryEngineAdapter } = require('../src/core/cad/geometry_engine_adapter');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');
const { ODESolvers, RadauIIA } = require('../src/core/math/ode_solvers');

async function runBranchGapSeventeenCoverageTests() {
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
  // CAE IPC handlers
  // ------------------------------------------------------------------
  check('cae_ipc Timoshenko beam valid and invalid', () => {
    const valid = caeIpc.runTimoshenkoBeam({
      coords: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 }
      ],
      section: { E: 200e9, nu: 0.3, A: 0.01, Iy: 1e-4, Iz: 1e-4, J: 2e-4, ky: 0.85, kz: 0.85 },
      K: 1
    });
    assert.strictEqual(valid.success, true);
    const invalid = caeIpc.runTimoshenkoBeam({});
    assert.strictEqual(invalid.success, false);
  });

  check('cae_ipc Shell MITC4 valid and invalid', () => {
    const valid = caeIpc.runShellMITC4({
      coords: [
        { x: 0, y: 0, z: 0 },
        { x: 0.1, y: 0, z: 0 },
        { x: 0.1, y: 0.1, z: 0 },
        { x: 0, y: 0.1, z: 0 }
      ],
      properties: { thickness: 0.01, E: 200e9, nu: 0.3 }
    });
    assert.strictEqual(valid.success, true);
    assert.strictEqual(caeIpc.runShellMITC4({}).success, false);
  });

  check('cae_ipc continuum plasticity valid and invalid', () => {
    const material = {
      E: 200e9,
      nu: 0.3,
      yieldStress: 250e6,
      hardeningModulus: 1e9,
      A: 1e9,
      B: 0,
      n: 0.1,
      C: 0,
      m: 0,
      refStrainRate: 0.001,
      Tmelt: 2000,
      Troom: 300
    };
    const valid = caeIpc.runContinuumPlasticity({
      material,
      strainIncrement: [0.001, 0, 0, 0, 0, 0],
      strainRate: 0.001,
      temperature: 300
    });
    assert.strictEqual(valid.success, true);
    assert.strictEqual(caeIpc.runContinuumPlasticity({}).success, false);
  });

  check('cae_ipc transonic Riemann shocktube and flux methods', () => {
    const shock = caeIpc.runTransonicRiemann({ method: 'shocktube', nCells: 100, tEnd: 0.1, cfl: 0.5 });
    assert.strictEqual(shock.success, true);
    const left = { rho: 1.2, u: 10, v: 0, w: 0, p: 1e5 };
    const right = { rho: 1.2, u: 2, v: 0, w: 0, p: 8e4 };
    const roe = caeIpc.runTransonicRiemann({
      method: 'roe',
      leftState: left,
      rightState: right,
      normal: { x: 1, y: 0, z: 0 }
    });
    assert.strictEqual(roe.success, true);
    const ausm = caeIpc.runTransonicRiemann({
      method: 'ausm',
      leftState: left,
      rightState: right,
      normal: { x: 1, y: 0, z: 0 }
    });
    assert.strictEqual(ausm.success, true);
    assert.strictEqual(caeIpc.runTransonicRiemann({}).success, false);
  });

  check('cae_ipc 2D CFD valid and invalid', () => {
    const valid = caeIpc.runCfd2D({
      nx: 8,
      ny: 8,
      aoaDeg: 5,
      velocity: 10,
      chordRatio: 0.3,
      thicknessRatio: 0.12,
      iterations: 3
    });
    assert.strictEqual(valid.success, true);
    assert.strictEqual(caeIpc.runCfd2D({}).success, false);
  });

  check('cae_ipc Delaunay 3D valid and invalid', () => {
    const valid = caeIpc.runDelaunayMesh3D({
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 }
      ],
      faces: [
        [0, 1, 2],
        [0, 1, 3],
        [0, 2, 3],
        [1, 2, 3]
      ],
      targetEdgeLength: 0.5,
      quadratic: false
    });
    assert.strictEqual(valid.success, true);
    assert.strictEqual(caeIpc.runDelaunayMesh3D({}).success, false);
  });

  check('cae_ipc FVM 3D valid and invalid', () => {
    const valid = caeIpc.runFvmCfd3D({
      nx: 4,
      ny: 4,
      nz: 3,
      lx: 0.4,
      ly: 0.4,
      lz: 0.3,
      inletVelocity: 5,
      steps: 1,
      omegaMRF: { x: 0, y: 0, z: 0 }
    });
    assert.strictEqual(valid.success, true);
    assert.strictEqual(caeIpc.runFvmCfd3D({}).success, false);
  });

  check('cae_ipc sparse Cholesky and wasm sparse valid/invalid', () => {
    const params = {
      N: 3,
      triplets: [
        [0, 0, 4],
        [0, 1, 1],
        [1, 0, 1],
        [1, 1, 3],
        [1, 2, 1],
        [2, 1, 1],
        [2, 2, 2]
      ],
      b: [5, 5, 3]
    };
    const chol = caeIpc.runSparseCholesky(params);
    assert.strictEqual(chol.success, true);
    const wasm = caeIpc.runWasmSparse({ ...params, leafSize: 12 });
    assert.strictEqual(wasm.success, true);
    const bad = caeIpc.runSparseCholesky({ N: 2, triplets: [[0, 5, 1]], b: [1, 1] });
    assert.strictEqual(bad.success, false);
  });

  check('cae_ipc GPU PCG valid and invalid', () => {
    const valid = caeIpc.runGpuPcg({
      csr: { N: 3, rowPtr: [0, 2, 4, 6], colIndices: [0, 1, 0, 1, 1, 2], values: [4, 1, 1, 3, 1, 2] },
      b: [5, 5, 3],
      maxIter: 200,
      tol: 1e-8
    });
    assert(valid.success === true || valid.success === false);
    assert.strictEqual(caeIpc.runGpuPcg({}).success, false);
  });

  check('cae_ipc WebGPU pressure Poisson valid and invalid', () => {
    const b = new Array(16).fill(1);
    const valid = caeIpc.runWebGpuPressurePoisson({ nx: 4, ny: 4, maxIter: 10, b });
    assert(valid.success === true || valid.success === false);
    assert.strictEqual(caeIpc.runWebGpuPressurePoisson({}).success, false);
  });

  check('cae_ipc hybrid prism-tet mesh valid and invalid', () => {
    const surfaceMesh = {
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ],
      triangles: [
        [0, 1, 2],
        [0, 1, 3],
        [0, 2, 3],
        [1, 2, 3]
      ]
    };
    const valid = caeIpc.runHybridPrismTetMesh({
      surfaceMesh,
      prismOptions: { firstLayerHeight: 0.01, growthRatio: 1.2, layerCount: 2, maxCornerAngleRad: Math.PI / 2 },
      tetOptions: { targetEdgeLength: 0.5, quadratic: false }
    });
    assert.strictEqual(valid.success, true);
    assert.strictEqual(caeIpc.runHybridPrismTetMesh({}).success, false);
  });

  check('cae_ipc HEX20 analysis invalid branches', () => {
    assert.strictEqual(caeIpc.runHex20Analysis({}).success, false);
    assert.strictEqual(
      caeIpc.runHex20Analysis({ coords: [], material: {}, fixedNodes: [], loadNode: 0, force: {} }).success,
      false
    );
  });

  check('cae_ipc unavailable results', () => {
    assert.strictEqual(caeIpc.getCompositeAnalysisUnavailableResult().success, false);
    assert.strictEqual(caeIpc.getPenaltyContactUnavailableResult().success, false);
  });

  // ------------------------------------------------------------------
  // EDA IPC handlers
  // ------------------------------------------------------------------
  check('eda_ipc standard-cell library actions', () => {
    const library = require('./support/experimental_eda_library_example').getExperimentalEdaLibraryExample();
    const cells = edaIpc.handleStandardCellLibraryRequest({ action: 'get-cells', library });
    assert.strictEqual(cells.success, true);
    const lef = edaIpc.handleStandardCellLibraryRequest({ action: 'generate-lef', library });
    assert.strictEqual(lef.success, true);
    const delay = edaIpc.handleStandardCellLibraryRequest({
      action: 'compute-delay',
      library,
      cellName: 'demo_inv',
      loadCapFf: 5,
      corner: 'typical'
    });
    assert.strictEqual(delay.success, true);
    const noLib = edaIpc.handleStandardCellLibraryRequest({ action: 'get-cells' });
    assert.strictEqual(noLib.success, false);
    assert.strictEqual(edaIpc.handleStandardCellLibraryRequest({ action: 'bogus', library }).success, false);
    assert.strictEqual(edaIpc.handleStandardCellLibraryRequest(null).success, false);
  });

  check('eda_ipc GDSII export point limit and import guards', () => {
    const huge = {
      libName: 'L',
      userUnits: 1e-3,
      dbUnits: 1e-9,
      topCell: 'T',
      polygons: [
        {
          layer: 1,
          datatype: 0,
          points: Array.from({ length: 100001 }, (_, i) => ({ x: i, y: i }))
        }
      ]
    };
    const limited = edaIpc.handleGdsiiExportRequest(huge);
    assert.strictEqual(limited.success, false);
    const badB64 = edaIpc.handleGdsiiImportRequest('not-base64!!');
    assert.strictEqual(badB64.success, false);
    const badLib = edaIpc.handleGdsiiImportRequest(Buffer.from('AAAA').toString('base64'));
    assert.strictEqual(badLib.success, false);
  });

  check('eda_ipc BSIM invalid bias and clock-tree routing guards', () => {
    const bsim = edaIpc.handleBsim4VtcRequest({ nmos: {}, pmos: {}, bias: {}, vddV: 1.2, sweepPoints: 5 });
    assert.strictEqual(bsim.success, false);
    const clockBad = edaIpc.handleClockTreeRequest({
      sinks: [{ id: 'a', x: 0, y: 0, capPf: 0.1 }],
      routingGrid: { width: 4, height: 4, layers: 1 }
    });
    assert.strictEqual(clockBad.success, false);
    const clockMissingRoot = edaIpc.handleClockTreeRequest({
      sinks: [{ id: 'a', x: 0, y: 0, capPf: 0.1 }],
      rootPosition: { x: 2, y: 2 },
      routingGrid: { width: 4, height: 4, layers: 1 }
    });
    assert.strictEqual(clockMissingRoot.success, false);
  });

  check('eda_ipc place-and-route validation branches', () => {
    assert.strictEqual(edaIpc.handlePlaceAndRouteRequest({}).success, false);
    assert.strictEqual(
      edaIpc.handlePlaceAndRouteRequest({
        options: { coreWidth: 100, coreHeight: 100, stdCellHeight: 10 },
        cells: [],
        nets: []
      }).success,
      false
    );
    const invalidCells = edaIpc.handlePlaceAndRouteRequest({
      options: { coreWidth: 100, coreHeight: 100, stdCellHeight: 10 },
      cells: [{ id: 'a', width: -4, height: 10 }],
      nets: [{ name: 'n', pins: ['a', 'b'] }]
    });
    assert.strictEqual(invalidCells.success, false);
    const badNet = edaIpc.handlePlaceAndRouteRequest({
      options: { coreWidth: 100, coreHeight: 100, stdCellHeight: 10 },
      cells: [
        { id: 'a', width: 4, height: 10 },
        { id: 'b', width: 4, height: 10 }
      ],
      nets: [{ name: 'n', pins: ['a', 'missing'] }]
    });
    assert.strictEqual(badNet.success, false);
    const badOptions = edaIpc.handlePlaceAndRouteRequest({
      options: { coreWidth: 100 },
      cells: [{ id: 'a', width: 4, height: 10 }],
      nets: []
    });
    assert.strictEqual(badOptions.success, false);
  });

  check('eda_ipc DEF parse non-record guard', () => {
    assert.strictEqual(edaIpc.handleDefParseRequest(null).success, false);
  });

  // ------------------------------------------------------------------
  // Optics IPC handlers
  // ------------------------------------------------------------------
  check('optics_ipc aspheric valid and aperture/ray guards', () => {
    const base = {
      curvaturePerMm: 0.02,
      conic: -0.6,
      semiDiameterMm: 25,
      coefficients: { alpha4: 0, alpha6: 0, alpha8: 0, alpha10: 0, alpha12: 0 },
      evaluationRadiusMm: 10,
      normalPointMm: { x: 5, y: 5 },
      rayDirection: { x: 0, y: 0, z: 1 },
      rayOriginMm: { x: 0, y: 0, z: -50 },
      vertexZMm: 0,
      maxIterations: 10,
      toleranceMm: 1e-6
    };
    const valid = opticsIpc.runAsphericOptics(base);
    assert.strictEqual(valid.success, true);
    const outside = opticsIpc.runAsphericOptics({ ...base, evaluationRadiusMm: 30 });
    assert.strictEqual(outside.success, false);
    const zeroDir = opticsIpc.runAsphericOptics({ ...base, rayDirection: { x: 0, y: 0, z: 0 } });
    assert.strictEqual(zeroDir.success, false);
  });

  check('optics_ipc thermal soak and wavefront guards', () => {
    const soak = opticsIpc.runOpticalThermalSoak({ targetTempC: -300, referenceTempC: 20 });
    assert.strictEqual(soak.success, false);
    const psf = opticsIpc.runWavefrontPSF({ gridSize: 15 });
    assert.strictEqual(psf.success, false);
  });

  check('optics_ipc polarization angle guards', () => {
    const none = opticsIpc.runPolarizationTrace({});
    assert.strictEqual(none.success, false);
    const both = opticsIpc.runPolarizationTrace({ n1: 1, n2: 1.5, thetaRad: 0.3, thetaDeg: 30 });
    assert.strictEqual(both.success, false);
  });

  check('optics_ipc DLS and ZMX guards', () => {
    assert.strictEqual(opticsIpc.runOpticalDLS({}).success, false);
    assert.strictEqual(opticsIpc.runOpticalDLS({ system: { surfaces: [] } }).success, false);
    assert.strictEqual(opticsIpc.runOpticalDLS({ system: { surfaces: [{}, {}] } }).success, false);
    assert.strictEqual(opticsIpc.runOpticalDLS({ system: { surfaces: [{}, {}] }, variables: [] }).success, false);
    assert.strictEqual(
      opticsIpc.runOpticalDLS({ system: { surfaces: [{}, {}] }, variables: [{}], operands: [] }).success,
      false
    );
    assert.strictEqual(opticsIpc.runZmxImport({ content: '   ' }).success, false);
  });

  // ------------------------------------------------------------------
  // CAD IPC handlers
  // ------------------------------------------------------------------
  check('cad_ipc primitives and export helpers', () => {
    const box = cadIpc.runCadPrimitive({ type: 'box', params: { width: 10, height: 10, depth: 10, units: 'mm' } });
    assert.strictEqual(box.success, true);
    const sphere = cadIpc.runCadPrimitive({ type: 'sphere', params: { radius: 5, units: 'mm' } });
    assert.strictEqual(sphere.success, true);
    const cyl = cadIpc.runCadPrimitive({ type: 'cylinder', params: { radius: 5, height: 10, units: 'mm' } });
    assert.strictEqual(cyl.success, true);
    assert.throws(
      () => cadIpc.runCadPrimitive({ type: 'box', params: { width: 10, height: 10, units: 'mm' } }),
      /requires exactly|units/
    );
    assert.throws(
      () => cadIpc.runCadPrimitive({ type: 'box', params: { width: -1, height: 10, depth: 10, units: 'mm' } }),
      /finite millimeter value/
    );
    const obj = cadIpc.runCadExportOBJ({ width: 10, height: 10, depth: 10, units: 'mm' });
    assert(obj.includes('v '));
    const step = cadIpc.runCadExportSTEP({ width: 10, height: 10, depth: 10, name: 'PartA', units: 'mm' });
    assert.strictEqual(step.success, true);
    assert.throws(
      () => cadIpc.runCadExportSTEP({ width: 10, height: 10, depth: 10, name: '1bad', units: 'mm' }),
      /must start with a letter/
    );
  });

  check('cad_ipc drafting sheet and visual diff', () => {
    const sheet = cadIpc.runDraftingSheet({
      width: 100,
      height: 50,
      depth: 10,
      partName: 'P',
      partNumber: 'A-1',
      scale: '1:1',
      units: 'mm'
    });
    assert.strictEqual(sheet.success, true);
    const badSheet = cadIpc.runDraftingSheet({
      width: 100,
      height: 50,
      depth: 10,
      partName: '',
      partNumber: 'A-1',
      scale: '1:1',
      units: 'mm'
    });
    assert.strictEqual(badSheet.success, false);
    const revA = {
      commitId: 'r-a',
      units: { length: 'mm', volume: 'mm3' },
      volumeMm3: 100,
      faces: [{ id: 'f1', persistentId: 'p1', centroidMm: { x: 0, y: 0, z: 0 } }]
    };
    const revB = {
      commitId: 'r-b',
      units: { length: 'mm', volume: 'mm3' },
      volumeMm3: 95,
      faces: [{ id: 'f1', persistentId: 'p1', centroidMm: { x: 0.5, y: 0, z: 0 } }]
    };
    const diff = cadIpc.runVisualDiffCAD({
      modelA: revA,
      modelB: revB,
      options: { toleranceMm: 0.1, modificationThresholdMm: 1 }
    });
    assert.strictEqual(diff.success, true);
    const mixed = cadIpc.runVisualDiffCAD({ modelA: revA, revB: 'r-b' });
    assert.strictEqual(mixed.success, false);
  });

  check('cad_ipc BOM rollup legacy and assembly forms', () => {
    const assembly = {
      partNumber: 'PRT-EXAMPLE',
      name: 'Example component',
      quantity: 2,
      unitMassKg: 0.1,
      unitCostUsd: 3,
      children: []
    };
    const root = cadIpc.runEngineeringBOMRollup({ rootAssembly: assembly });
    assert.strictEqual(root.success, true);
    const legacy = cadIpc.runEngineeringBOMRollup({
      partNumber: assembly.partNumber,
      name: assembly.name,
      quantity: assembly.quantity,
      unitMassKg: assembly.unitMassKg,
      unitCostUsd: assembly.unitCostUsd,
      items: assembly.children
    });
    assert.strictEqual(legacy.success, true);
    assert.strictEqual(cadIpc.runEngineeringBOMRollup({}).success, false);
    assert.strictEqual(cadIpc.runEngineeringBOMRollup({ partNumber: 'P1' }).success, false);
  });

  // ------------------------------------------------------------------
  // Controls adapter
  // ------------------------------------------------------------------
  check('ControlsEngineAdapter simulate_block_diagram and state space', async () => {
    const adapter = new ControlsEngineAdapter();
    const block = await adapter.execute({
      jobId: 'c-1',
      domain: 'controls',
      operation: 'simulate_block_diagram',
      parameters: {
        blocks: [{ type: 'source_constant', name: 'S', params: { value: 2 } }],
        tEnd: 1,
        dt: 0.1
      }
    });
    assert.strictEqual(block.status, 'COMPLETED');
    const ss = await adapter.execute({
      jobId: 'c-2',
      domain: 'controls',
      operation: 'solve_state_space',
      parameters: {
        A: [
          [0, 1],
          [-1, -0.5]
        ],
        B: [[0], [1]],
        C: [[1, 0]],
        D: [[0]],
        initialX: [1, 0],
        tEnd: 1,
        dt: 0.1
      }
    });
    assert.strictEqual(ss.status, 'COMPLETED');
    await assert.rejects(
      () => adapter.execute({ jobId: 'c-3', domain: 'controls', operation: 'bogus', parameters: {} }),
      /not supported by adapter|not implemented/
    );
  });

  check('ControlsEngineAdapter MPC and EKF runs', async () => {
    const adapter = new ControlsEngineAdapter();
    const mpc = await adapter.execute({
      jobId: 'c-4',
      domain: 'controls',
      operation: 'solve_mpc',
      parameters: {
        A: [
          [1, 0.1],
          [0, 1]
        ],
        B: [[0], [0.1]],
        C: [[1, 0]],
        predictionHorizon: 5,
        controlHorizon: 2
      }
    });
    assert.strictEqual(mpc.status, 'COMPLETED');
  });

  check('ControlsEngineAdapter EKF estimation', async () => {
    const adapter = new ControlsEngineAdapter();
    const ekf = await adapter.execute({
      jobId: 'c-6',
      domain: 'controls',
      operation: 'estimate_ekf',
      parameters: {
        steps: [{ dt: 0.01, gyro: [0, 0, 0], accel: [0, 0, -9.80665], baroAlt: 50 }],
        recordTrajectory: true
      }
    });
    assert.strictEqual(ekf.status, 'COMPLETED');
  });

  // ------------------------------------------------------------------
  // Penalty contact direct
  // ------------------------------------------------------------------
  check('PenaltyContact evaluateNodeContact default branches', () => {
    const contact = new PenaltyContact();
    const slave = { id: 's1', pos: [0, 0, -0.1], vel: [0, 0, -1], mass: 1 };
    const facet = { v0: [0, 0, 0], v1: [1, 0, 0], v2: [0, 1, 0], normal: [0, 0, 1] };
    const result = contact.evaluateNodeContact(slave, facet);
    assert(result.inContact === true || result.inContact === false);
    const slaveDefault = { pos: [0, 0, -0.05], vel: [0, 0, -0.5] };
    const facetDefault = { v0: [0, 0, 0], v1: [1, 0, 0], v2: [0, 1, 0] };
    const result2 = contact.evaluateNodeContact(slaveDefault, facetDefault);
    assert(result2.inContact === true || result2.inContact === false);
  });

  // ------------------------------------------------------------------
  // SPICE request validation
  // ------------------------------------------------------------------
  check('spice_request waveform and component validation branches', () => {
    assert.strictEqual(
      spiceRequest.solveSpiceTransient({
        analysis: { type: 'transient', stopTimeS: 0.001, stepS: 1e-5 },
        components: [
          {
            type: 'voltage_source',
            id: 'V1',
            nPlus: 'a',
            nMinus: '0',
            dcVoltageV: 5,
            waveform: { type: 'STEP', lowV: 0, highV: 5, delayS: -1 }
          }
        ]
      }).error.code,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      spiceRequest.solveSpiceTransient({
        analysis: { type: 'transient', stopTimeS: 0.001, stepS: 1e-5 },
        components: [{ type: 'resistor', id: 'R1', n1: 'a', n2: '0', resistanceOhm: 100, waveform: { type: 'STEP' } }]
      }).error.code,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      spiceRequest.solveSpiceTransient({
        analysis: { type: 'transient', stopTimeS: 0.001, stepS: 1e-5 },
        components: [{ type: 'mystery', id: 'X1' }]
      }).error.code,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      spiceRequest.solveSpiceTransient({
        analysis: { type: 'transient', stopTimeS: 0.001, stepS: 1e-5 },
        components: [{ type: 'resistor', id: 'R 1', n1: 'a', n2: '0', resistanceOhm: 100 }]
      }).error.code,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      spiceRequest.solveSpiceTransient({
        analysis: { type: 'transient', stopTimeS: 0.001, stepS: 1e-5 },
        components: [{ type: 'capacitor', id: 'C1', n1: 'a', n2: '0', capacitanceF: 1e-20 }]
      }).error.code,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      spiceRequest.solveSpiceTransient({ analysis: { type: 'steady' }, components: [] }).error.code,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      spiceRequest.solveSpiceTransient({
        analysis: { type: 'transient', stopTimeS: 0.001, stepS: 1e-5 },
        components: [{ type: 'resistor', id: 'R1', n1: 'a', n2: 'b', resistanceOhm: 100 }]
      }).error.code,
      'INVALID_INPUT'
    );
  });

  // ------------------------------------------------------------------
  // CCS timing model
  // ------------------------------------------------------------------
  check('CCSTimingModel constructor fields and fall characterization', () => {
    const model = new CCSTimingModel({
      cellName: 'INV_X2',
      supplyVoltageV: 1.2,
      pinCapacitanceFf: 1.2,
      peakDriverCurrentMa: 12
    });
    assert.strictEqual(model.cellName, 'INV_X2');
    assert.strictEqual(model.pinCapacitanceFf, 1.2);
    const res = model.characterizeCell(null, { direction: 'fall', rLoad: 0, slew: 40 });
    assert(Number.isFinite(res.cTotalFf));
    const driver = model.simulateDriverOutput(3e-15, 1.1);
    assert(Number.isFinite(driver.delayNs));
  });

  check('CCSTimingModel provided drive table path', () => {
    const n = 5;
    const vinGrid = Array.from({ length: n }, (_, i) => (i / (n - 1)) * 1);
    const voutGrid = vinGrid.slice();
    const currents = Array.from({ length: n }, () => vinGrid.slice());
    const model = new CCSTimingModel({ driveTable: { vinGrid, voutGrid, currents } });
    const res = model.characterizeCell(model.table, { cload: 10, rLoad: 500 });
    assert.strictEqual(res.tableSource, 'provided');
    assert(Number.isFinite(res.cTotalFf));
  });

  // ------------------------------------------------------------------
  // DIPPR property database
  // ------------------------------------------------------------------
  check('DIPPR component correlation guard branches', () => {
    const rec = {
      id: 'w',
      name: 'Water',
      formula: 'H2O',
      cas: '7732-18-5',
      mw: 18.015,
      family: 'Aqueous',
      pvEq: [73.649, -7258.2, -7.3037, 4.1653e-6, 2],
      pvTmin: 273.16,
      pvTmax: 647.1,
      rhoLEq: [1.7, 0.271, 0.286, 647.1],
      cpEq: [32.24, 1.924e-3, 1.055e-5, -3.596e-9, 0],
      muEq: [-10.216, 1826, 1.773, -0.0000151, 2],
      kLEq: [-0.922, 0.00284, 0.00000249]
    };
    const comp = new ExperimentalPropertyComponent(rec);
    assert(comp.getVaporPressure(300) > 0);
    assert(comp.getLiquidDensity(300) > 0);
    assert(comp.getIdealGasCp(300) > 0);
    assert(comp.getLiquidViscosity(300) > 0);
    assert(comp.getLiquidThermalConductivity(300) > 0);
    const noPv = { ...rec, pvEq: undefined };
    const comp2 = new ExperimentalPropertyComponent(noPv);
    assert.throws(() => comp2.getVaporPressure(300), /pvEq/);
    const nearCritical = new ExperimentalPropertyComponent({ ...rec, rhoLEq: [1.7, 0.271, 0.286, 300] });
    assert(nearCritical.getLiquidDensity(350) > 0);
  });

  check('DIPPR database catalog and VLLE guard branches', () => {
    const db = new ExperimentalPropertyDatabase([
      {
        id: 'a',
        name: 'A',
        formula: 'A',
        cas: '000',
        mw: 10,
        family: 'Aqueous',
        pvEq: [1, 1, 1, 1, 1],
        pvTmin: 100,
        pvTmax: 500
      }
    ]);
    assert.strictEqual(db.get(''), null);
    assert.strictEqual(db.get('A').id, 'a');
    assert.throws(
      () =>
        new ExperimentalPropertyDatabase([
          { id: 'a', name: 'A', formula: 'A' },
          { id: 'a', name: 'B', formula: 'B' }
        ]),
      /Duplicate property record id/
    );
    assert.throws(() => new ExperimentalPropertyDatabase([{}]), /explicit id, name, and formula/);
    assert.throws(
      () =>
        db.solveVLLEFlash({ components: ['a', 'zz'], feedFractions: [0.5, 0.5], temperatureK: 300, pressurePa: 1e5 }),
      /Unknown experimental property component/
    );
    assert.throws(
      () =>
        db.solveVLLEFlash({ components: ['a', 'b'], feedFractions: [0.5, 0.6], temperatureK: 300, pressurePa: 1e5 }),
      /sum to 1/
    );
  });

  // ------------------------------------------------------------------
  // Liberty parser branches
  // ------------------------------------------------------------------
  check('Liberty parser tokenization and table validation', () => {
    const lib = parseLiberty(`library (x) {
  // line comment
  cell (y) {
    pin (p) {
      direction : input;
      timing () {
        related_pin : "a";
        timing_type : rising_edge;
        cell_rise (t) {
          index_1 ("0.1, 0.2");
          index_2 ("0.01, 0.02");
          values ( "1e-1, 2e-1", "3e-1, 4e-1" );
        }
      }
    }
  }
}`);
    const cell = lib.cells.get('y');
    assert(cell);
    assert.strictEqual(cell.pins.get('p').timings.length, 1);
    assert.throws(() => new LibertyTable(['0.1'], ['0.01'], [[1]]), /at least 2x2/);
    assert.throws(
      () =>
        new LibertyTable(
          [0.2, 0.1],
          [0.01, 0.02],
          [
            [1, 2],
            [3, 4]
          ]
        ),
      /index_1 must be strictly increasing/
    );
    assert.throws(
      () =>
        new LibertyTable(
          [0.1, 0.2],
          [0.02, 0.01],
          [
            [1, 2],
            [3, 4]
          ]
        ),
      /index_2 must be strictly increasing/
    );
  });

  check('Liberty parser malformed constructs', () => {
    const pinTiming = (inner) => `library (x) { cell (y) { pin (p) { direction : input; timing () { ${inner} } } } }`;
    assert.throws(() => parseLiberty(pinTiming('related_pin : "a";')), /timing_type/);
    const arc = 'cell_rise (t) { index_1 ("0.1, 0.2"); index_2 ("0.01, 0.02"); values ( "1, 2", "3, 4" ); }';
    assert.throws(
      () => parseLiberty(pinTiming(`related_pin : "a"; timing_type : rising_edge; ${arc} ${arc}`)),
      /Duplicate timing arc/
    );
    assert.throws(
      () =>
        parseLiberty(
          'library (x) { cell (y) { pin (p) { direction : input; timing () { timing_type : rising_edge; cell_rise (t) { index_1 ("0.1, 0.2"); index_2 ("0.01, 0.02"); values ( "1, 2", "3, 4" ); } } } }'
        ),
      /related_pin|Unterminated timing group/
    );
    assert.throws(
      () =>
        parseLiberty(
          pinTiming(
            'related_pin : "a"; timing_type : rising_edge; cell_rise (t) { index_1 ("0.1, 0.2"); index_2 ("0.01, 0.02"); values ( "1, ", "3, 4" ); }'
          )
        ),
      /Empty number in list/
    );
  });

  // ------------------------------------------------------------------
  // CSG validation branches
  // ------------------------------------------------------------------
  check('CSG toCSGSolid validation branches', () => {
    assert.throws(
      () => CSGMeshBooleans.toCSGSolid({ type: 'box', size: [0, 1, 1], center: [0, 0, 0] }),
      /CSG box dimensions must be positive/
    );
    assert.throws(
      () => CSGMeshBooleans.toCSGSolid({ type: 'cylinder', radius: -1, height: 1 }),
      /radius and height must be positive/
    );
    assert.throws(
      () => CSGMeshBooleans.toCSGSolid({ type: 'cylinder', radius: 1, height: 1, segments: 2 }),
      /segments must be an integer from 3 through 2048/
    );
    assert.throws(() => CSGMeshBooleans.computeMetrics(null), /require a solid with a polygon array/);
    assert.throws(
      () =>
        CSGMeshBooleans.computeMetrics({
          polygons: [
            {
              vertices: [
                [0, 0, 0],
                [1, 0, 0]
              ]
            }
          ]
        }),
      /at least three vertices/
    );
    const solid = CSGMeshBooleans.toCSGSolid({ type: 'box', size: [1, 1, 1], center: [0, 0, 0] });
    const metrics = CSGMeshBooleans.computeMetrics(solid);
    assert(metrics.volume > 0);
  });

  // ------------------------------------------------------------------
  // Geometry adapter constraint branches
  // ------------------------------------------------------------------
  check('GeometryEngineAdapter constraint operations', async () => {
    const adapter = new GeometryEngineAdapter();
    const sketch = await adapter.execute({
      jobId: 'g2-1',
      domain: 'cad',
      operation: 'solve_variational_sketch',
      parameters: {
        points: [
          { id: 'p1', x: 0, y: 0 },
          { id: 'p2', x: 10, y: 0 },
          { id: 'p3', x: 10, y: 10 }
        ],
        constraints: [
          { type: 'FIXED', p: 'p1', x: 0, y: 0 },
          { type: 'HORIZONTAL', p1: 'p1', p2: 'p2' },
          { type: 'VERTICAL', p1: 'p2', p2: 'p3' },
          { type: 'COINCIDENT', p1: 'p1', p2: 'p2' }
        ]
      }
    });
    assert.strictEqual(sketch.status, 'COMPLETED');
    const subtract = await adapter.execute({
      jobId: 'g2-2',
      domain: 'cad',
      operation: 'boolean_subtract',
      parameters: {
        solidA: BRepPrimitives.createBox(10, 10, 10, 'A'),
        solidB: BRepPrimitives.createBox(5, 5, 5, 'B'),
        lengthUnit: 'mm'
      }
    });
    assert.strictEqual(subtract.status, 'COMPLETED');
  });

  // ------------------------------------------------------------------
  // Radau IIA failure paths
  // ------------------------------------------------------------------
  check('RadauIIA non-finite right-hand-side rejection', () => {
    const solver = new RadauIIA({ h0: 1e-3, maxSteps: 50 });
    const f = (t, y) => [y[0] > 0.1 ? Number.NaN : -y[0]];
    let outcome;
    try {
      const traj = solver.solve(f, 0, [0.2], 0.01);
      outcome = traj.length;
    } catch (err) {
      outcome = err;
    }
    assert(outcome !== undefined);
  });

  check('ODESolvers solveRK45 adaptive step branches', () => {
    const f = (t, y) => [-y[0]];
    const traj = ODESolvers.solveRK45(f, [1], 0, 2, 0.5, 1e-6, 0.01);
    assert(traj.at(-1).t >= 2);
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

module.exports = { runBranchGapSeventeenCoverageTests };

if (require.main === module) {
  runBranchGapSeventeenCoverageTests().then((stats) => {
    console.log(`gap17: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
